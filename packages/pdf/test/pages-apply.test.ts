import { describe, expect, it } from "vitest";
import { openPdf, PdfFile, type PdfSession } from "../src";
import { fiveDoc, WORDS, wordsDoc } from "./support/pagesdocs";
import { fileContains, seen, texts } from "./support/pdfinfo";

const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const ids = (s: PdfSession) => s.doc.pages.map((p) => p.id);
const tail = (out: Uint8Array, original: Uint8Array) => latin(out.subarray(original.length));

describe("applyPages: the pages of a file", () => {
  it("leaves the page tree alone when the pages did not change", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    s.core.transact([{ type: "set_meta", patch: { title: "Only the title" } }]);
    const out = await s.save();
    expect(out.subarray(0, bytes.length)).toEqual(bytes);
    expect(tail(out, bytes)).not.toContain("/Kids");
    expect(tail(out, bytes)).not.toContain("/Type /Page");
    expect(await texts(out)).toEqual(WORDS);
  });

  it("rotates pages by editing only those page objects, and undoes it", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    const before = s.doc;
    s.pages.rotate([ids(s)[1]!, ids(s)[3]!], 90);
    s.pages.rotate([ids(s)[1]!], 180);
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const v = await seen(result.bytes);
    expect(v.pages.map((p) => p.rotate)).toEqual([0, 270, 0, 90, 0]);
    expect(v.pages[1]).toMatchObject({ width: 792, height: 612, text: "Bravo" });
    expect(tail(result.bytes, bytes)).not.toContain("/Kids");
    // Back to 0 takes the entry off again.
    s.pages.rotate([ids(s)[1]!], 90);
    const back = await seen(await s.save());
    expect(back.pages.map((p) => p.rotate)).toEqual([0, 0, 0, 90, 0]);
    s.undo();
    s.undo();
    s.undo();
    expect(s.doc).toEqual(before);
    expect(await s.save()).toEqual(bytes);
  });

  it("turns a page back to 0 when its page tree gives it a turn", async () => {
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Rotate 90 /MediaBox [0 0 300 400] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>",
      "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
      "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    ].map((body, i) => ({ num: i + 1, body }));
    const { buildClassic, streamObj } = await import("./support/handmade");
    const bytes = buildClassic([...objs, streamObj(5, "", "BT /F1 12 Tf 20 300 Td (First) Tj ET"), streamObj(6, "", "BT /F1 12 Tf 20 300 Td (Second) Tj ET")]).bytes;
    const s = await openPdf(bytes);
    expect(s.doc.pages.map((p) => [p.rotate, p.width, p.height])).toEqual([[90, 300, 400], [90, 300, 400]]);
    s.pages.rotate([ids(s)[0]!], -90);
    s.pages.move([ids(s)[1]!], 0);
    const out = await s.save();
    const v = await seen(out);
    // The moved page keeps its inherited size, rotation and font.
    expect(v.pages.map((p) => [p.rotate, p.width, p.height, p.text])).toEqual([[90, 400, 300, "Second"], [0, 300, 400, "First"]]);
  });

  it("reorders pages and keeps the original bytes as a prefix", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    s.pages.move([ids(s)[4]!], 0);
    s.pages.move([ids(s)[2]!, ids(s)[3]!], 4);
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    expect(await texts(result.bytes)).toEqual(["Echo", "Alpha", "Delta", "Bravo", "Charlie"]);
    expect(PdfFile.open(result.bytes).pageCount()).toBe(5);
    // Reading it again gives the new order, and undo goes back to the exact first document.
    const again = await openPdf(result.bytes);
    expect(again.doc.pages.length).toBe(5);
    while (s.canUndo) s.undo();
    expect(await texts(await s.save())).toEqual(WORDS);
  });

  it("inserts blank pages (appended, not rewritten)", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    const a = s.pages.insertBlank(ids(s)[1]);
    const b = s.pages.insertBlank(null, { width: 200, height: 100 });
    const c = s.pages.insertBlank();
    expect(ids(s).slice(0, 2)).toEqual([b, "p:main:0"]);
    expect(ids(s).indexOf(a)).toBe(3);
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const v = await seen(result.bytes);
    expect(v.pages.map((p) => [p.width, p.height, p.text])).toEqual([
      [200, 100, ""],
      [612, 792, "Alpha"],
      [612, 792, "Bravo"],
      [612, 792, ""],
      [612, 792, "Charlie"],
      [612, 792, "Delta"],
      [612, 792, "Echo"],
      [612, 792, ""],
    ]);
    expect(c).toBeTruthy();
  });

  it("deletes pages by writing a new file without them, and without what pointed at them", async () => {
    const bytes = fiveDoc();
    expect(fileContains(bytes, "Echo")).toBe(true);
    const s = await openPdf(bytes);
    s.pages.remove(["p:main:4"]);
    const result = await s.saveDetailed();
    expect(result.mode).toBe("rewrite");
    const out = result.bytes;
    expect(await texts(out)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    // The page, its content and everything that went to it are gone from the file.
    expect(fileContains(out, "Echo")).toBe(false);
    const file = PdfFile.open(out);
    const cat = file.catalog();
    expect(cat.has("OpenAction")).toBe(false);
    const names = file.get(cat.get("Names"));
    expect(latin(out)).not.toContain("(target)");
    expect(names).toBeTruthy();
    const v = await seen(out, true);
    expect(v.outline).toEqual([
      { title: "Part One", page: 0, items: [{ title: "Sub of One", page: 1, items: [] }] },
      { title: "Part Two", page: 2, items: [] },
    ]);
    // The link to Echo is gone, the others stay.
    const re = await openPdf(out);
    expect(re.doc.pages.length).toBe(4);
    expect(re.doc.outline.map((o) => o.title)).toEqual(["Part One", "Part Two"]);
    // Undo brings every page back.
    s.undo();
    expect(s.doc.pages.length).toBe(5);
    expect(await texts(await s.save())).toEqual(WORDS);
  });

  it("keeps a deleted page's bookmarks out of the model too, and brings them back with undo", async () => {
    const s = await openPdf(fiveDoc());
    const before = s.doc;
    s.pages.remove(["p:main:4"]);
    expect(s.doc.outline.map((o) => o.title)).toEqual(["Part One", "Part Two"]);
    s.pages.remove(["p:main:1"]);
    expect(s.doc.outline[0]!.children).toEqual([]);
    expect(s.doc.outline[0]!.open).toBeUndefined();
    s.undo();
    s.undo();
    expect(s.doc).toEqual(before);
  });

  it("deletes a middle page, reorders what is left and rotates, in one save", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    s.pages.remove(["p:main:1"]);
    s.pages.move(["p:main:4"], 0);
    s.pages.rotate(["p:main:2"], 90);
    const out = await s.save();
    expect(fileContains(out, "Bravo")).toBe(false);
    const v = await seen(out, true);
    expect(v.pages.map((p) => [p.text, p.rotate])).toEqual([["Echo", 0], ["Alpha", 0], ["Charlie", 90], ["Delta", 0]]);
    expect(v.outline!.map((o) => [o.title, o.page])).toEqual([["Part One", 1], ["Part Two", 2], ["Part Three", 0]]);
    // "Sub of One" went to Bravo: it is gone, "Part One" stays.
    expect(v.outline![0]!.items).toEqual([]);
  });

  it("makes a new page object for a duplicate page id and for a second page that is from the same source page", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    const [first, second] = s.doc.pages;
    // The same id twice, and another id that is also from page 0.
    s.core.reset({ ...s.doc, pages: [first!, first!, { ...first!, id: "other" }, second!] });
    const out = await s.save();
    expect(await texts(out)).toEqual(["Alpha", "Alpha", "Alpha", "Bravo"]);
    const file = PdfFile.open(out);
    const kids = file.pages().map((p) => p.ref.num);
    expect(new Set(kids).size).toBe(4);
  });

  it("copies a page with the duplicate command, and the copy follows the last chosen page", async () => {
    const s = await openPdf(fiveDoc());
    const before = s.doc;
    const copies = s.pages.duplicate(["p:main:3", "p:main:1"]);
    expect(copies.length).toBe(2);
    expect(ids(s)).toEqual(["p:main:0", "p:main:1", "p:main:2", "p:main:3", ...copies, "p:main:4"]);
    expect(await texts(await s.save())).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Bravo", "Delta", "Echo"]);
    s.undo();
    expect(s.doc).toEqual(before);
  });

  it("builds a file from nothing", async () => {
    const { emptyDoc, PdfSession, savePdf } = await import("../src");
    const s = new PdfSession(emptyDoc("new"));
    s.saver = savePdf;
    const a = s.pages.insertBlank(undefined, { width: 300, height: 200 });
    s.pages.insertBlank();
    s.pages.rotate([a], 90);
    s.core.transact([{ type: "set_meta", patch: { title: "From nothing" } }]);
    const out = await s.save();
    const v = await seen(out);
    expect(v.pages.map((p) => [p.width, p.height, p.rotate])).toEqual([[200, 300, 90], [300, 200, 0]]);
    const again = await openPdf(out);
    expect(again.doc.meta.title).toBe("From nothing");
    expect(again.doc.pages.map((p) => p.width)).toEqual([300, 300]);
  });

  it("writes page labels from the document, and keeps them with the pages when they move", async () => {
    const bytes = wordsDoc(WORDS);
    const s = await openPdf(bytes);
    s.pages.numberPages(ids(s).slice(0, 2), "roman");
    s.pages.numberPages(ids(s).slice(2), "decimal", { prefix: "A-" });
    let v = await seen(await s.save());
    expect(v.labels).toEqual(["i", "ii", "A-1", "A-2", "A-3"]);
    s.pages.move(["p:main:0"], 4);
    v = await seen(await s.save());
    expect(v.labels).toEqual(["ii", "A-1", "A-2", "A-3", "i"]);
    s.pages.setLabel([ids(s)[4]!], null);
    s.pages.setLabel(ids(s).slice(0, 4), null);
    v = await seen(await s.save());
    expect(v.labels).toBeNull();
  });

  it("moves the labels the file has with their pages even though the model does not carry them", async () => {
    const { buildClassic, simpleDoc, obj } = await import("./support/handmade");
    const base = simpleDoc(4, { text: (i) => `BT /F1 12 Tf 72 700 Td (${WORDS[i]}) Tj ET` });
    const bytes = buildClassic([obj(1, "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /P (S-) /St 7 >>] >> >>"), ...base.slice(1)]).bytes;
    const s = await openPdf(bytes);
    expect((await seen(bytes)).labels).toEqual(["i", "ii", "S-7", "S-8"]);
    s.pages.move(["p:main:0"], 3);
    expect((await seen(await s.save())).labels).toEqual(["ii", "S-7", "S-8", "i"]);
    s.pages.remove(["p:main:1"]);
    expect((await seen(await s.save())).labels).toEqual(["S-7", "S-8", "i"]);
  });
});
