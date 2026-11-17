// Contracts with the page writer, fonts, encrypted files, deleted threads.
import { readFileSync } from "node:fs";
import { Users } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { Overlay, PdfDict, PdfFile, PdfName, createPdf, emptyDoc, isArray, openPdf, readPdf, setPages, writeAnnotations } from "../src";
import type { Annotation, PdfDoc, WriteContext } from "../src";
import { WHITE, expectPixel, hex, newSession } from "./support/annots";
import { renderPdf } from "./support/render";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));
const settle = () => new Promise((r) => setTimeout(r, 0));

function context(overlay: Overlay, doc: PdfDoc, baseline: PdfDoc, extra: Partial<WriteContext> = {}): WriteContext {
  return { overlay, doc, baseline, main: null, sources: new Map(), pageRefs: new Map(), options: {}, rewrite: true, now: Date.UTC(2026, 10, 16), warnings: [], ...extra };
}

describe("pages that are not in the original file", () => {
  it("writes annotations on a new page from the page's own box", async () => {
    const overlay = createPdf();
    const page = overlay.add(new PdfDict({ Type: PdfName.of("Page"), MediaBox: [0, 0, 200, 100] }));
    setPages(overlay, [page]);
    const annot: Annotation = { id: "n:1", type: "square", rect: { x: 10, y: 10, w: 50, h: 30 }, stroke: { color: "#000000", width: 0 }, fill: "#0000ff" };
    const doc: PdfDoc = { ...emptyDoc("d"), pages: [{ id: "new", from: null, width: 200, height: 100, rotate: 0, annots: [annot] }] };
    const ctx = context(overlay, doc, { ...doc, pages: [] }, { pageRefs: new Map([["new", page]]) });
    writeAnnotations(ctx);
    expect(ctx.warnings).toEqual([]);
    const r = await renderPdf(overlay.rewrite(), 0, 2);
    expectPixel(r, 30, 25, [0, 0, 255], 10);
    expectPixel(r, 100, 25, WHITE, 5);
  });

  it("replaces the annotations a copied page brought with it by the ones in the document", () => {
    const main = PdfFile.open(fixture("annots-mupdf"));
    const read = readPdf(fixture("annots-mupdf")).doc;
    const overlay = new Overlay(main);
    const copy = overlay.importPage(main, 0);
    const page = { ...read.pages[0]!, id: "copy", annots: read.pages[0]!.annots.slice(0, 3) };
    const doc: PdfDoc = { ...read, pages: [page] };
    const ctx = context(overlay, doc, { ...read, pages: [] }, { main, pageRefs: new Map([["copy", copy]]) });
    writeAnnotations(ctx);
    const annots = overlay.get(overlay.get(copy) instanceof PdfDict ? (overlay.get(copy) as PdfDict).get("Annots") : null);
    expect(isArray(annots) ? annots.length : -1).toBe(3);
  });

  it("says so when a page has no object to write to", () => {
    const overlay = createPdf();
    const doc: PdfDoc = { ...emptyDoc("d"), pages: [{ id: "lost", from: null, width: 10, height: 10, rotate: 0, annots: [{ id: "x", type: "note", x: 1, y: 1 }] }] };
    const ctx = context(overlay, doc, { ...doc, pages: [] });
    writeAnnotations(ctx);
    expect(ctx.warnings.join(" ")).toMatch(/page lost/);
  });
});

describe("fonts", () => {
  it("embeds the font passed for a family and draws with it", async () => {
    const s = await newSession();
    s.annots.addFreeText("p:main:0", { x: 20, y: 100, w: 200, h: 40 }, "Embedded Lora", { family: "Lora", size: 20 });
    const result = await s.saveDetailed({ fonts: { Lora: lora } });
    expect(result.warnings).toEqual([]);
    const r = await renderPdf(result.bytes, 0, 2);
    expect(r.inkIn(20, 100, 200, 40)).toBeGreaterThan(200);
    const text = new TextDecoder("latin1").decode(result.bytes);
    expect(text).toContain("/CIDFontType2");
  });

  it("falls back to a standard font and says so when the font file is missing", async () => {
    const s = await newSession();
    s.annots.addFreeText("p:main:0", { x: 20, y: 100, w: 200, h: 40 }, "Fallback", { family: "Comic Neue", size: 20 });
    s.annots.addFreeText("p:main:0", { x: 20, y: 150, w: 200, h: 40 }, "Euro € and 漢", { size: 20 });
    const result = await s.saveDetailed();
    expect(result.warnings.some((w) => w.includes('"Comic Neue"'))).toBe(true);
    expect(result.warnings.some((w) => w.includes("not in the standard fonts"))).toBe(true);
    const r = await renderPdf(result.bytes, 0, 2);
    expect(r.inkIn(20, 100, 200, 40)).toBeGreaterThan(100);
  });
});

describe("other kinds of files", () => {
  it("saves annotations into an encrypted file and reads them back", async () => {
    const s = await openPdf(fixture("enc-aes-128"), { user: { id: "u1", name: "Test User" } });
    const page = s.doc.pages[0]!;
    s.annots.addShape(page.id, "square", { x: 10, y: 10, w: 30, h: 30 }, { color: "#000000", width: 0, fill: "#ff0000" });
    const result = await s.saveDetailed();
    const again = await openPdf(result.bytes);
    expect(again.doc.pages[0]!.annots.map((a) => a.type)).toEqual(["square"]);
  });

  it("removes the replies of a thread that was deleted, and the comment text of the annotation", async () => {
    const s = await openPdf(fixture("annots-reply"), { user: { id: "u1", name: "Test User" } });
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const hl = s.doc.pages[0]!.annots.find((a) => a.type === "highlight")!;
    s.comments.client!.reply(hl.thread!, "extra");
    await settle();
    let again = await openPdf(await s.save());
    expect(again.doc.comments![hl.thread!.replace(/\d+$/, (n) => n)] ?? Object.values(again.doc.comments!).find((t) => t.comments.length === 2)).toBeTruthy();
    // Now delete the thread from the document.
    s.comments.client!.deleteThread(hl.thread!);
    await settle();
    again = await openPdf(await s.save());
    const back = again.doc.pages[0]!.annots.find((a) => a.type === "highlight")!;
    expect(back.contents).toBeUndefined();
    expect(back.replies).toBeUndefined();
    expect(again.doc.comments?.[back.thread ?? ""]).toBeUndefined();
  });

  it("hidden and locked flags round trip, and hidden annotations are not drawn", async () => {
    const s = await newSession();
    const id = s.annots.addShape("p:main:0", "square", { x: 20, y: 100, w: 50, h: 50 }, { color: "#000000", width: 0, fill: "#ff0000" });
    s.annots.update(id, { hidden: true, locked: true });
    const out = await s.save();
    const r = await renderPdf(out, 0, 2);
    expectPixel(r, 40, 120, WHITE, 5);
    const back = (await openPdf(out)).doc.pages[0]!.annots[0]!;
    expect(back).toMatchObject({ hidden: true, locked: true });
    void hex;
  });

  it("keeps the picture of a picture annotation when only its place changes", async () => {
    const { solidPng } = await import("./support/annots");
    const s = await newSession();
    const id = s.annots.addImage("p:main:0", { x: 20, y: 100, w: 40, h: 40 }, { src: solidPng([255, 0, 0], 16) });
    const first = await s.save();
    const s2 = await openPdf(first);
    const a = s2.doc.pages[0]!.annots[0]!;
    s2.annots.moveBy([a.id], 30, 0);
    const second = await s2.save();
    const count = (b: Uint8Array) => (new TextDecoder("latin1").decode(b).match(/\/Subtype \/Image/g) ?? []).length;
    expect(count(second)).toBe(count(first));
    const r = await renderPdf(second, 0, 2);
    expectPixel(r, 70, 120, [255, 0, 0], 10);
    void id;
  });
});

describe("odd values", () => {
  it("saves and renders annotations with zero sizes, negative and huge numbers, empty lists and odd text", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const num = () => [0, 0.001, -5, 1e6, rnd() * 300, rnd() * 400, NaN][Math.floor(rnd() * 7)]!;
    const pt = (): [number, number] => [num(), num()];
    const rect = () => ({ x: num(), y: num(), w: num(), h: num() });
    const text = () => ["", "a", "line\nbreak\r\nand\rthree", "漢字 é €", "(parens) \\ backslash", "x".repeat(500)][Math.floor(rnd() * 6)]!;
    const stroke = () => ({ color: ["#000000", "#fff", "red", "#12345"][Math.floor(rnd() * 4)]!, width: num(), ...(rnd() < 0.3 ? { dash: [num(), num()] } : {}) });
    const makers: (() => Annotation)[] = [
      () => ({ id: "", type: "highlight", color: "#ffeb3b", rects: rnd() < 0.2 ? [] : [rect(), rect()] }),
      () => ({ id: "", type: "ink", strokes: rnd() < 0.2 ? [] : [[pt()], [pt(), pt(), pt()], []], stroke: stroke() }),
      () => ({ id: "", type: "square", rect: rect(), stroke: stroke(), ...(rnd() < 0.5 ? { fill: "#00ff00" } : {}) }),
      () => ({ id: "", type: "circle", rect: rect(), stroke: stroke() }),
      () => ({ id: "", type: "line", from: pt(), to: pt(), stroke: stroke(), startEnd: "arrow", endEnd: "diamond" }),
      () => ({ id: "", type: "polygon", points: rnd() < 0.2 ? [] : [pt(), pt(), pt()], stroke: stroke() }),
      () => ({ id: "", type: "freetext", rect: rect(), text: text(), style: { family: ["Helvetica", "Zapfino", ""][Math.floor(rnd() * 3)]!, size: num(), color: "#000000", align: "center" } }),
      () => ({ id: "", type: "note", x: num(), y: num(), contents: text() }),
      () => ({ id: "", type: "stamp", rect: rect(), stamp: { name: ["Approved", "weird name!", ""][Math.floor(rnd() * 3)]!, label: text() } }),
      () => ({ id: "", type: "signature", rect: rect(), mode: "draw", strokes: [[pt(), pt()]] }),
      () => ({ id: "", type: "signature", rect: rect(), mode: "type", text: text() }),
      () => ({ id: "", type: "image", rect: rect(), picture: { src: "https://example.com/x.png" } }),
      () => ({ id: "", type: "redact", rects: [rect()], overlay: text() }),
    ];
    const s = await newSession();
    for (let i = 0; i < 300; i++) {
      const a = makers[Math.floor(rnd() * makers.length)]!();
      s.annots.add("p:main:0", { ...a, id: `fuzz${i}`, ...(rnd() < 0.3 ? { opacity: num() } : {}) } as never, { select: false });
    }
    const result = await s.saveDetailed();
    // Everything that could be written was; the file opens and renders.
    const file = PdfFile.open(result.bytes);
    expect(file.pageCount()).toBe(1);
    const r = await renderPdf(result.bytes, 0, 1);
    expect(r.pages).toBe(1);
    const again = await openPdf(result.bytes);
    expect(again.doc.pages[0]!.annots.length + result.warnings.filter((w) => /could not be written/.test(w)).length).toBeGreaterThan(250);
    // A second save of what was read changes nothing (nothing differs from the file).
    expect(await again.save()).toEqual(result.bytes);
  });
});
