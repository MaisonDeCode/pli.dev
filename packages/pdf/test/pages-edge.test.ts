import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDoc, openPdf, PdfFile, PdfSession, savePdf } from "../src";
import { buildClassic, buildXrefStreamPdf, obj, simpleDoc, streamObj, type Obj } from "./support/handmade";
import { fileContains, seen, texts } from "./support/pdfinfo";
import { fiveDoc, WORDS, wordsDoc } from "./support/pagesdocs";

const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

/** A page tree two levels deep: node A (MediaBox 300x300, Rotate 90) holds pages 1 and 2, node B (400x200) holds page 3. */
function nestedDoc(): Uint8Array {
  const font = "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>";
  const objs: Obj[] = [
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 3 >>"),
    obj(3, `<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 /MediaBox [0 0 300 300] /Rotate 90 ${font} >>`),
    obj(4, `<< /Type /Pages /Parent 2 0 R /Kids [7 0 R] /Count 1 /MediaBox [0 0 400 200] ${font} >>`),
    obj(5, "<< /Type /Page /Parent 3 0 R /Contents 8 0 R >>"),
    obj(6, "<< /Type /Page /Parent 3 0 R /Contents 9 0 R /Rotate 0 >>"),
    obj(7, "<< /Type /Page /Parent 4 0 R /Contents 10 0 R >>"),
    streamObj(8, "", "BT /F1 12 Tf 20 100 Td (One) Tj ET"),
    streamObj(9, "", "BT /F1 12 Tf 20 100 Td (Two) Tj ET"),
    streamObj(10, "", "BT /F1 12 Tf 20 100 Td (Three) Tj ET"),
  ];
  return buildClassic(objs).bytes;
}

describe("page trees", () => {
  it("reorders pages of a nested tree with inherited sizes, rotation and fonts", async () => {
    const s = await openPdf(nestedDoc());
    expect(s.doc.pages.map((p) => [p.width, p.height, p.rotate])).toEqual([[300, 300, 90], [300, 300, 0], [400, 200, 0]]);
    s.pages.move(["p:main:2"], 0);
    const out = await s.save();
    const v = await seen(out);
    expect(v.pages.map((p) => [p.text, p.width, p.height, p.rotate])).toEqual([["Three", 400, 200, 0], ["One", 300, 300, 90], ["Two", 300, 300, 0]]);
    const file = PdfFile.open(out);
    expect(file.pageCount()).toBe(3);
    // Page "Two" says Rotate 0 itself: it did not pick up the 90 of its old parent.
    s.pages.rotate(["p:main:0"], -90);
    const out2 = await s.save();
    expect((await seen(out2)).pages.map((p) => p.rotate)).toEqual([0, 0, 0]);
  });

  it("deletes from a nested tree and writes a clean one", async () => {
    const s = await openPdf(nestedDoc());
    s.pages.remove(["p:main:0", "p:main:1"]);
    const out = await s.save();
    expect(await texts(out)).toEqual(["Three"]);
    expect(fileContains(out, "One")).toBe(false);
    expect(fileContains(out, "Two")).toBe(false);
    expect(PdfFile.open(out).pageCount()).toBe(1);
  });

  it("copes with a page object listed twice in the tree", async () => {
    const base = simpleDoc(2, { text: (i) => `BT /F1 12 Tf 20 100 Td (${WORDS[i]}) Tj ET` });
    const objs = base.map((o) => (o.num === 2 ? obj(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>") : o));
    const s = await openPdf(buildClassic(objs).bytes);
    expect(s.doc.pages.length).toBe(2);
    s.pages.rotate(["p:main:1"], 90);
    expect((await seen(await s.save())).pages.map((p) => p.rotate)).toEqual([0, 90]);
  });
});

describe("what points at a deleted page", () => {
  const doc = (): Uint8Array => {
    const base = simpleDoc(3, {
      text: (i) => `BT /F1 12 Tf 20 100 Td (${WORDS[i]}) Tj ET`,
      pageExtra: (i) => (i === 0 ? "/Annots [20 0 R 21 0 R 22 0 R 23 0 R]" : ""),
    });
    return buildClassic(
      [
        obj(1, "<< /Type /Catalog /Pages 2 0 R /Names << /Dests 40 0 R >> /Dests 41 0 R /OpenAction << /S /GoTo /D [5 0 R /Fit] >> /Threads [60 0 R] >>"),
        ...base.slice(1),
        obj(20, "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoTo /D [5 0 R /Fit] >> >>"),
        obj(21, "<< /Type /Annot /Subtype /Link /Rect [0 20 10 30] /Dest (gone) >>"),
        obj(22, "<< /Type /Annot /Subtype /Link /Rect [0 40 10 50] /Dest (stays) >>"),
        obj(23, "<< /Type /Annot /Subtype /Link /Rect [0 60 10 70] /Dest /old >>"),
        // A name tree with two levels and limits.
        obj(40, "<< /Kids [42 0 R 43 0 R] >>"),
        obj(42, "<< /Limits [(gone) (stays)] /Names [(gone) [5 0 R /Fit] (stays) [4 0 R /Fit]] >>"),
        obj(43, "<< /Limits [(zzz) (zzz)] /Names [(zzz) << /D [5 0 R /XYZ 0 0 null] >>] >>"),
        obj(41, "<< /old [5 0 R /Fit] /keep [3 0 R /Fit] >>"),
        obj(60, "<< /Type /Thread /F 61 0 R >>"),
        obj(61, "<< /Type /Bead /T 60 0 R /N 61 0 R /V 61 0 R /P 5 0 R /R [0 0 10 10] >>"),
      ],
    ).bytes;
  };

  it("takes out links, the open action, named destinations and article threads that go to it", async () => {
    const bytes = doc();
    const s = await openPdf(bytes);
    s.pages.remove(["p:main:2"]);
    const out = await s.save();
    expect(await texts(out)).toEqual(["Alpha", "Bravo"]);
    expect(fileContains(out, "Charlie")).toBe(false);
    const file = PdfFile.open(out);
    const cat = file.catalog();
    expect(cat.has("OpenAction")).toBe(false);
    expect(cat.has("Threads")).toBe(false);
    // The old-style dictionary keeps what goes to pages that stay.
    const dests = file.get(cat.get("Dests")) as import("../src").PdfDict;
    expect(dests.keys()).toEqual(["keep"]);
    // The name tree keeps `stays`, and `gone` and the whole second node are out.
    const flat = latin(out);
    expect(flat).not.toContain("(gone)");
    expect(flat).not.toContain("(zzz)");
    expect(flat).toContain("(stays)");
    // The links on the page that stays: the ones to the deleted page are gone (the document drops them with the page), the other stays.
    const page = file.pages()[0]!;
    const annots = file.get(page.dict.get("Annots")) as unknown[];
    const dicts = annots.map((a) => file.get(a as never) as import("../src").PdfDict);
    expect(dicts.map((d) => [d.has("A"), d.has("Dest")])).toEqual([[false, true]]);
  });

  it("leaves everything alone when no page it goes to is deleted", async () => {
    const bytes = doc();
    const s = await openPdf(bytes);
    s.pages.remove(["p:main:1"]);
    const out = await s.save();
    const file = PdfFile.open(out);
    expect(file.catalog().has("OpenAction")).toBe(true);
    expect(file.catalog().has("Threads")).toBe(true);
    expect(await texts(out)).toEqual(["Alpha", "Charlie"]);
  });
});

describe("what belongs to a deleted page in the model", () => {
  it("takes links, form widgets and comment threads with the page, and undo brings them back", async () => {
    const s = await openPdf(wordsDoc(WORDS));
    s.core.transact([
      { type: "insert_annot", page: "p:main:0", annot: { id: "l1", type: "link", rect: { x: 0, y: 0, w: 10, h: 10 }, dest: { page: "p:main:3" } } },
      { type: "insert_annot", page: "p:main:0", annot: { id: "l2", type: "link", rect: { x: 0, y: 20, w: 10, h: 10 }, dest: { page: "p:main:3" }, uri: "https://example.com/" } },
      { type: "insert_annot", page: "p:main:0", annot: { id: "l3", type: "link", rect: { x: 0, y: 40, w: 10, h: 10 }, dest: { page: "p:main:1" } } },
      { type: "insert_annot", page: "p:main:3", annot: { id: "n1", type: "note", x: 5, y: 5, contents: "hello", thread: "t1" } },
      { type: "insert_field", field: { id: "f1", name: "a", type: "text", value: null, widgets: [{ id: "w1", page: "p:main:3", rect: { x: 0, y: 0, w: 10, h: 10 } }] } },
      { type: "insert_field", field: { id: "f2", name: "b", type: "radio", value: null, widgets: [{ id: "w2", page: "p:main:3", rect: { x: 0, y: 0, w: 10, h: 10 }, on: "x" }, { id: "w3", page: "p:main:1", rect: { x: 0, y: 0, w: 10, h: 10 }, on: "y" }] } },
      { type: "set_thread", id: "t1", thread: { id: "t1", anchor: { page: "p:main:3", annot: "n1", x: 5, y: 5 }, comments: [], createdAt: 1 } },
    ]);
    const before = s.doc;
    s.pages.remove(["p:main:3"]);
    const page0 = s.doc.pages[0]!.annots;
    expect(page0.map((a) => a.id)).toEqual(["l2", "l3"]);
    expect(page0[0]).toMatchObject({ uri: "https://example.com/" });
    expect((page0[0] as { dest?: unknown }).dest).toBeUndefined();
    expect(s.doc.fields.map((f) => [f.id, f.widgets.map((w) => w.id)])).toEqual([["f2", ["w3"]]]);
    expect(s.doc.comments).toBeUndefined();
    s.undo();
    expect(s.doc).toEqual(before);
  });
});

describe("encrypted and odd sources", () => {
  it("merges an encrypted file in as a plain copy", async () => {
    const enc = new Uint8Array(readFileSync(new URL("./fixtures/enc-aes-128.pdf", import.meta.url)));
    const s = await openPdf(wordsDoc(["Aa"]));
    await s.pages.insertFrom(enc);
    const out = await s.save();
    const v = await seen(out);
    expect(v.pages.length).toBe(2);
    expect(v.pages[1]!.text.length).toBeGreaterThan(0);
    expect(PdfFile.open(out).encrypted).toBe(false);
  });

  it("changes pages of a file that uses an xref stream and object streams, as an update", async () => {
    const objs = simpleDoc(3, { text: (i) => `BT /F1 12 Tf 20 100 Td (${WORDS[i]}) Tj ET` });
    const bytes = buildXrefStreamPdf(objs, { objStm: [1, 2, 3, 4, 5] }).bytes;
    const s = await openPdf(bytes);
    s.pages.move(["p:main:2"], 0);
    s.pages.rotate(["p:main:0"], 90);
    s.pages.insertBlank();
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const v = await seen(result.bytes);
    expect(v.pages.map((p) => [p.text, p.rotate])).toEqual([["Charlie", 0], ["Alpha", 90], ["Bravo", 0], ["", 0]]);
  });

  it("rotates a page of an encrypted file", async () => {
    const enc = new Uint8Array(readFileSync(new URL("./fixtures/enc-aes-128.pdf", import.meta.url)));
    const s = await openPdf(enc);
    s.pages.rotate([s.doc.pages[0]!.id], 90);
    const result = await s.saveDetailed();
    expect((await seen(result.bytes)).pages[0]!.rotate).toBe(90);
  });

  it("keeps a labelled blank page in the numbering the file has", async () => {
    const base = simpleDoc(4, { text: (i) => `BT /F1 12 Tf 20 100 Td (${WORDS[i]}) Tj ET` });
    const bytes = buildClassic([obj(1, "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /P (S-) /St 7 >>] >> >>"), ...base.slice(1)]).bytes;
    const s = await openPdf(bytes);
    s.pages.insertBlank("p:main:1");
    expect((await seen(await s.save())).labels).toEqual(["i", "ii", "iii", "S-7", "S-8"]);
  });

  it("saves an empty document with no pages as a valid file", async () => {
    const s = new PdfSession(emptyDoc("e"));
    s.saver = savePdf;
    const out = await s.save();
    expect(PdfFile.open(out).catalog().has("Pages")).toBe(true);
  });
});

describe("big documents", () => {
  it("reorders, deletes and merges hundreds of pages quickly", async () => {
    const n = 600;
    const bytes = buildClassic(simpleDoc(n, { text: (i) => `BT /F1 12 Tf 20 100 Td (P${i}Z) Tj ET` })).bytes;
    const started = Date.now();
    const s = await openPdf(bytes);
    s.pages.move(s.doc.pages.slice(0, 300).map((p) => p.id), 400);
    s.pages.remove(s.doc.pages.filter((_, i) => i % 3 === 0).map((p) => p.id));
    await s.pages.insertFrom(bytes, { pages: [0, 1, 2] });
    const out = await s.save();
    const file = PdfFile.open(out);
    expect(file.pageCount()).toBe(n - 200 + 3);
    expect(Date.now() - started).toBeLessThan(15000);
  });
});

describe("history", () => {
  it("every page and outline command is one step that undo and redo restore exactly", async () => {
    const s = await openPdf(fiveDoc());
    const states = [s.doc];
    const step = (fn: () => unknown) => {
      fn();
      states.push(s.doc);
    };
    step(() => s.pages.rotate(["p:main:0", "p:main:1"], 90));
    step(() => s.pages.move(["p:main:4"], 1));
    step(() => s.pages.insertBlank("p:main:2"));
    step(() => s.pages.duplicate(["p:main:3"]));
    step(() => s.pages.numberPages(["p:main:0", "p:main:1"], "ROMAN"));
    step(() => s.pages.setLabel(["p:main:2"], "Cover"));
    step(() => s.outline.add("New", "p:main:1", { y: 20 }));
    step(() => s.outline.indent(s.outline.items[1]!.id));
    step(() => s.outline.rename("o:0", "Renamed"));
    step(() => s.pages.remove(["p:main:2", "p:main:4"]));
    step(() => s.outline.outdent("o:0.0"));
    await s.pages.insertFrom(wordsDoc(["Aa", "Bb"]), { at: 2, bookmark: true, name: "extra.pdf" });
    states.push(s.doc);
    const after = states[states.length - 1]!;
    const bytes = await s.save();
    expect((await seen(bytes)).pages.length).toBe(s.doc.pages.length);
    for (let i = states.length - 2; i >= 0; i--) {
      expect(s.undo()).toBe(true);
      expect(s.doc).toEqual(states[i]);
    }
    expect(s.canUndo).toBe(false);
    for (let i = 1; i < states.length; i++) {
      expect(s.redo()).toBe(true);
      expect(s.doc).toEqual(states[i]);
    }
    expect(s.doc).toEqual(after);
    // (A new file gets a new id each time it is written, so compare what is in it.)
    expect(await texts(await s.save())).toEqual(await texts(bytes));
  });
});
