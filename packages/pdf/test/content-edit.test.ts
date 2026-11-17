import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeBase64 } from "@pli.dev/core";
import { openPdf } from "../src";
import { PdfFile } from "../src/cos/file";
import { PdfDict, PdfName, PdfStream } from "../src/cos/objects";
import { embedTrueType } from "../src/fonts/embed";
import { pageWords } from "../src/content/text";
import { extractText } from "../src/text";
import { finishPage, newPage } from "./support/build";
import { makePdf } from "./support/content";
import { streamObj } from "./support/handmade";
import { contains } from "./support/leak";
import { makePng } from "./support/png";
import { renderPdf } from "./support/render";

const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));
const BODY = "BT /F1 12 Tf 20 170 Td (Hello World) Tj 0 -20 Td (Second line stays) Tj /F2 14 Tf 0 -20 Td [(Kern) 80 (ed) -300 (words)] TJ ET";

async function runOf(s: Awaited<ReturnType<typeof openPdf>>, text: string) {
  const runs = await s.content.runs(s.doc.pages[0]!.id);
  const r = runs.find((x) => x.text === text);
  if (!r) throw new Error(`no run "${text}" among ${runs.map((x) => x.text).join(" | ")}`);
  return r;
}

describe("replacing text", () => {
  it("cuts the old glyphs and draws the new text on the same baseline, in the same font", async () => {
    const bytes = makePdf({ content: BODY });
    const s = await openPdf(bytes);
    const run = await runOf(s, "Hello World");
    await s.content.replaceText(run.id, "Goodbye");
    const saved = await s.saveDetailed();
    expect(saved.warnings).toEqual([]);
    const out = saved.bytes;
    expect(contains(out, "Hello")).toBe(false);
    const after = extractText(PdfFile.open(out), 0);
    expect(after.text).toBe("Goodbye\nSecond line stays\nKerned words");
    const goodbye = after.runs.find((r) => r.text === "Goodbye")!;
    expect(goodbye.origin[0]).toBeCloseTo(run.origin[0], 2);
    expect(goodbye.origin[1]).toBeCloseTo(run.origin[1], 2);
    expect(goodbye.font).toMatchObject({ name: "Helvetica", size: 12 });
    // the other lines did not move
    const was = extractText(PdfFile.open(bytes), 0);
    for (const t of ["Second line stays", "Kerned words"]) expect(after.runs.find((r) => r.text === t)!.box).toEqual(was.runs.find((r) => r.text === t)!.box);
    const r = await renderPdf(out, 0, 2);
    expect(r.text).toContain("Goodbye");
    expect(r.text).not.toContain("Hello");
  });

  it("replaces a run made of several pieces (kerning and a wide gap) and an empty text removes it", async () => {
    const bytes = makePdf({ content: BODY });
    const s = await openPdf(bytes);
    await s.content.replaceText((await runOf(s, "Kerned words")).id, "");
    await s.content.replaceText((await runOf(s, "Second line stays")).id, "2nd");
    const out = await s.save();
    const text = extractText(PdfFile.open(out), 0).text;
    expect(text).toBe("Hello World\n2nd");
  });

  it("warns when the new text is wider, and narrows it when asked", async () => {
    const bytes = makePdf({ content: BODY });
    const s = await openPdf(bytes);
    const run = await runOf(s, "Hello World");
    const plan = await s.content.planText(run.id, "A much longer replacement text");
    expect(plan.fits).toBe(false);
    expect(plan.font.kind).toBe("same");
    await s.content.replaceText(run.id, "A much longer replacement text");
    const wide = await s.saveDetailed();
    expect(wide.warnings.join(" ")).toMatch(/wider than the old/);
    await s.content.replaceText(run.id, "A much longer replacement text", { fit: "shrink" });
    const narrow = await s.saveDetailed();
    const a = extractText(PdfFile.open(wide.bytes), 0).runs.find((r) => r.text.startsWith("A much"))!;
    const b = extractText(PdfFile.open(narrow.bytes), 0).runs.find((r) => r.text.startsWith("A much"))!;
    expect(b.box.w).toBeLessThan(a.box.w * 0.75);
    expect(b.box.w).toBeGreaterThan(a.box.w * 0.69);
    expect(narrow.warnings.join(" ")).toMatch(/still wider/);
  });

  it("substitutes a standard font, with a warning, when the characters or the family are not available", async () => {
    const bytes = makePdf({ content: BODY });
    const s = await openPdf(bytes);
    const run = await runOf(s, "Hello World");
    await s.content.replaceText(run.id, "Café Ж", { family: "Lora" });
    const saved = await s.saveDetailed();
    expect(saved.warnings.join(" ")).toMatch(/Lora/);
    expect(saved.warnings.join(" ")).toMatch(/cannot be written/);
    expect(extractText(PdfFile.open(saved.bytes), 0).text).toContain("Café ?");
  });

  it("uses an embedded font from the save options for the requested family", async () => {
    const bytes = makePdf({ content: BODY });
    const s = await openPdf(bytes);
    const run = await runOf(s, "Hello World");
    await s.content.replaceText(run.id, "Café ñ", { family: "Lora", color: "#cc0000", size: 20 });
    const plan = await s.content.planText(run.id, "Café ñ", { family: "Lora" }, { Lora: lora });
    expect(plan.font.kind).toBe("embedded");
    const saved = await s.saveDetailed({ fonts: { Lora: lora } });
    expect(saved.warnings).toEqual([]);
    const page = extractText(PdfFile.open(saved.bytes), 0);
    const run2 = page.runs.find((r) => r.text === "Café ñ")!;
    expect(run2).toBeDefined();
    expect(run2.font.name).toMatch(/Lora/);
    expect(run2.font.size).toBe(20);
    expect(run2.color).toBe("#cc0000");
    const r = await renderPdf(saved.bytes, 0, 2);
    expect(r.text).toContain("Café");
  });

  it("keeps the font of an embedded subset when the new text only needs glyphs the page already used", async () => {
    const t = newPage(300, 200);
    const font = embedTrueType(t.overlay, lora, { family: "Lora" });
    t.content.beginText().font(t.res.font(font.ref), 16).textMove(20, 150).showGlyphs(font.encode("Cafe bar")).endText();
    font.finish();
    finishPage(t);
    const bytes = t.overlay.rewrite();
    const s = await openPdf(bytes);
    const run = (await s.content.runs(s.doc.pages[0]!.id))[0]!;
    expect((await s.content.planText(run.id, "bar Cafe")).font.kind).toBe("same");
    // a letter the subset does not have: not the same font
    const plan = await s.content.planText(run.id, "bar Zebra");
    expect(plan.font.kind).toBe("standard");
    expect(plan.warnings.join(" ")).toMatch(/only the characters already used/);
    await s.content.replaceText(run.id, "bar Cafe");
    const out = await s.save();
    expect(extractText(PdfFile.open(out), 0).text).toBe("bar Cafe");
  });

  it("works on turned text and text inside a form", async () => {
    const form = streamObj(20, "/Type /XObject /Subtype /Form /BBox [0 0 200 60] /Matrix [1 0 0 1 20 100] /Resources << /Font << /F1 40 0 R >> >>", "BT /F1 12 Tf 0 30 Td (Inside form) Tj ET");
    const bytes = makePdf({ content: "/Fm1 Do BT /F2 12 Tf 0 1 -1 0 250 40 Tm (Going up) Tj ET", resources: "/XObject << /Fm1 20 0 R >>", objs: [form] });
    const s = await openPdf(bytes);
    const up = await runOf(s, "Going up");
    const inForm = await runOf(s, "Inside form");
    await s.content.replaceText(up.id, "Rising");
    await s.content.replaceText(inForm.id, "Changed");
    const out = await s.save();
    const page = extractText(PdfFile.open(out), 0);
    const rising = page.runs.find((r) => r.text === "Rising")!;
    expect(rising.angle).toBeCloseTo(up.angle, 1);
    expect(rising.origin[0]).toBeCloseTo(up.origin[0], 1);
    expect(rising.origin[1]).toBeCloseTo(up.origin[1], 1);
    const changed = page.runs.find((r) => r.text === "Changed")!;
    expect(changed.origin[0]).toBeCloseTo(inForm.origin[0], 1);
    expect(changed.origin[1]).toBeCloseTo(inForm.origin[1], 1);
    expect(contains(out, "Inside")).toBe(false);
    expect(contains(out, "Going")).toBe(false);
  });

  it("is undone, redone and cleared as one step", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    const id = s.doc.pages[0]!.id;
    const before = s.doc;
    await s.content.replaceText((await runOf(s, "Hello World")).id, "x");
    expect(s.doc.pages[0]!.edits).toHaveLength(1);
    s.undo();
    expect(s.doc).toEqual(before);
    s.redo();
    s.content.clearEdits(id);
    expect(s.doc.pages[0]!.edits).toBeUndefined();
  });

  it("takes back one edit by its id and leaves the others", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    const first = await s.content.replaceText((await runOf(s, "Hello World")).id, "one");
    const second = await s.content.replaceText((await runOf(s, "Second line stays")).id, "two");
    s.content.removeEdit("e_unknown"); // not there: nothing happens
    expect(s.doc.pages[0]!.edits).toHaveLength(2);
    s.content.removeEdit(first);
    expect(s.doc.pages[0]!.edits!.map((e) => e.id)).toEqual([second]);
    s.undo();
    expect(s.doc.pages[0]!.edits!.map((e) => e.id)).toEqual([first, second]);
    s.content.removeEdit(first);
    s.content.removeEdit(second);
    expect(s.doc.pages[0]!.edits).toBeUndefined();
  });
});

describe("replacing pictures", () => {
  const original = (): Uint8Array => {
    const d = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) d.set([200, 10, 10], i * 3);
    return d;
  };
  const object = streamObj(20, "/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8", original());
  const draw = "q 100 0 0 50 50 100 cm /Im1 Do Q BT /F1 12 Tf 20 20 Td (caption) Tj ET";
  const blue = (w: number, h: number): string => "data:image/png;base64," + encodeBase64(makePng({ width: w, height: h, colorType: 2, depth: 8, sample: () => [0, 0, 255] }));

  const images = (bytes: Uint8Array): { data: Uint8Array; w: number }[] => {
    const f = PdfFile.open(bytes);
    const res = f.get(f.pages()[0]!.dict.get("Resources")) as PdfDict;
    const xo = f.get(res.get("XObject")) as PdfDict | null;
    return [...(xo?.map.values() ?? [])].map((r) => f.get(r)).filter((o): o is PdfStream => o instanceof PdfStream && (f.get(o.dict.get("Subtype")) as PdfName).value === "Image").map((o) => ({ data: o.data, w: o.dict.get("Width") as number }));
  };

  it("puts a new picture in the same box (contained, centred) and drops the old one from the file", async () => {
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [object] });
    const s = await openPdf(bytes);
    const [img] = await s.content.images(s.doc.pages[0]!.id);
    expect(img).toMatchObject({ id: "i:Im1", width: 4, height: 4 });
    await s.content.replaceImage(img!.id, { src: blue(20, 10) });
    const out = await s.save();
    expect(images(out)).toHaveLength(1);
    expect(images(out)[0]!.w).toBe(20);
    const r = await renderPdf(out, 0, 2);
    // box: x 50..150, y 50..100 (page space); a 2:1 picture fills it
    expect(r.pixel(100, 75).slice(0, 3)).toEqual([0, 0, 255]);
    expect(r.pixel(55, 55).slice(0, 3)).toEqual([0, 0, 255]);
    expect(r.text).toContain("caption");
    expect(contains(out, String.fromCharCode(200, 10, 10))).toBe(false);
  });

  it("fetches a replacement picture that is a web address", async () => {
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [object] });
    const s = await openPdf(bytes);
    const [img] = await s.content.images(s.doc.pages[0]!.id);
    const url = "https://files.example.test/new.png";
    await s.content.replaceImage(img!.id, { src: url });
    const png = makePng({ width: 20, height: 10, colorType: 2, depth: 8, sample: () => [0, 0, 255] });
    const out = await s.save({ fetch: async () => ({ bytes: png }) });
    const r = await renderPdf(out, 0, 2);
    expect(r.pixel(100, 75).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it("fits a square picture inside a wide box, or stretches it", async () => {
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [object] });
    const s = await openPdf(bytes);
    const id = "i:Im1";
    await s.content.replaceImage(id, { src: blue(8, 8) });
    let r = await renderPdf(await s.save(), 0, 2);
    expect(r.pixel(100, 75).slice(0, 3)).toEqual([0, 0, 255]);
    expect(r.pixel(52, 75)[0]).toBeGreaterThan(200); // the sides stay empty
    await s.content.replaceImage(id, { src: blue(8, 8) }, { fit: "stretch" });
    r = await renderPdf(await s.save(), 0, 2);
    expect(r.pixel(52, 75).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it("removes a picture with null, and warns about a web address", async () => {
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [object] });
    const s = await openPdf(bytes);
    await s.content.replaceImage("i:Im1", null);
    const out = await s.save();
    expect(images(out)).toHaveLength(0);
    expect(contains(out, String.fromCharCode(200, 10, 10))).toBe(false);
    await s.content.replaceImage("i:Im1", { src: "https://example.test/a.png" });
    // a web address that cannot be fetched keeps the old picture and warns (no real network in the test)
    const saved = await s.saveDetailed({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(saved.warnings.join(" ")).toMatch(/could not be fetched.*old picture was kept/);
    expect(images(saved.bytes)).toHaveLength(1);
  });
});

describe("words", () => {
  it("lists words with boxes", () => {
    const page = extractText(PdfFile.open(makePdf({ content: BODY })), 0);
    expect(pageWords(page).map((w) => w.text)).toEqual(["Hello", "World", "Second", "line", "stays", "Kerned", "words"]);
  });
});

describe("fonts for edits", () => {
  it("names the families and characters a host has to fetch before saving", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    await s.content.replaceText((await runOf(s, "Hello World")).id, "Bonjour");
    await s.content.replaceText((await runOf(s, "Kerned words")).id, "Café", { family: "Lora" });
    expect(await s.content.editFonts()).toEqual({ families: ["Helvetica", "Lora"], text: "BonjourféC".length ? (await s.content.editFonts()).text : "" });
    const { text } = await s.content.editFonts();
    expect([...text].sort().join("")).toBe([..."BonjourCafé"].filter((c, i, a) => a.indexOf(c) === i).sort().join(""));
  });
});
