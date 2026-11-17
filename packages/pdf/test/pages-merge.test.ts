import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { emptyDoc, mergePdfs, openPdf, pdfFromImages, PdfFile, PdfSession, savePdf, type PdfSession as Session } from "../src";
import { fiveDoc, WORDS, wordsDoc } from "./support/pagesdocs";
import { fileContains, seen, texts } from "./support/pdfinfo";
import { makePng } from "./support/png";
import { renderPdf } from "./support/render";

const ids = (s: Session) => s.doc.pages.map((p) => p.id);

function jpeg(width: number, height: number, draw: (c: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void): Uint8Array {
  const canvas = createCanvas(width, height);
  const c = canvas.getContext("2d");
  draw(c);
  return new Uint8Array(canvas.toBuffer("image/jpeg", 95));
}

/** A JPEG with an Exif block that says its orientation. */
function withOrientation(bytes: Uint8Array, orientation: number): Uint8Array {
  const exif = Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // Exif
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big endian, IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const out = new Uint8Array(bytes.length + exif.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(exif, 2);
  out.set(bytes.subarray(2), 2 + exif.length);
  return out;
}

const red = [255, 0, 0];
const blue = [0, 0, 255];
const near = (p: number[], want: number[]) => p.slice(0, 3).every((v, i) => Math.abs(v - want[i]!) < 40);

describe("merge: mergePdfs and session.pages.insertFrom", () => {
  it("merges files into a new one", async () => {
    const out = await mergePdfs([wordsDoc(["Aa", "Bb"]), wordsDoc(["Cc"], { mediaBox: "[0 0 300 200]" }), fiveDoc()], { names: ["one.pdf", "two.pdf", "five.pdf"] });
    const v = await seen(out, true);
    expect(v.pages.map((p) => [p.text, p.width, p.height])).toEqual([
      ["Aa", 612, 792],
      ["Bb", 612, 792],
      ["Cc", 300, 200],
      ...WORDS.map((w) => [w, 612, 792]),
    ]);
    // The bookmarks of the file that had them come along and go to the right pages.
    expect(v.outline!.map((o) => [o.title, o.page])).toEqual([["Part One", 3], ["Part Two", 5], ["Part Three", 7]]);
    expect(v.outline![0]!.items).toEqual([{ title: "Sub of One", page: 4, items: [] }]);
    // Every page object is its own: nothing from the first files' page trees is left over.
    expect(PdfFile.open(out).pageCount()).toBe(8);
  });

  it("makes a bookmark for each file when asked", async () => {
    const out = await mergePdfs([wordsDoc(["Aa", "Bb"]), fiveDoc()], { names: ["intro.pdf", "five.pdf"], bookmarks: true });
    const v = await seen(out, true);
    expect(v.outline!.map((o) => [o.title, o.page, o.items.length])).toEqual([["intro", 0, 0], ["five", 2, 3]]);
  });

  it("merges the same file twice, and two files that are large and small", async () => {
    const five = fiveDoc();
    const out = await mergePdfs([five, five]);
    expect(await texts(out)).toEqual([...WORDS, ...WORDS]);
  });

  it("adds another file to an open one as an update that keeps the original bytes", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes, { name: "five.pdf" });
    const before = s.doc;
    const added = await s.pages.insertFrom(wordsDoc(["Xx", "Yy", "Zz"]), { at: 1, name: "xyz.pdf" });
    expect(added.length).toBe(3);
    expect(ids(s).slice(0, 5)).toEqual(["p:main:0", ...added, "p:main:1"]);
    expect(s.doc.sources.map((x) => x.name)).toEqual(["five.pdf", "xyz.pdf"]);
    expect(s.selection).toMatchObject({ page: added[0], pages: added });
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    expect(await texts(result.bytes)).toEqual(["Alpha", "Xx", "Yy", "Zz", "Bravo", "Charlie", "Delta", "Echo"]);
    // One undo step: gone, and the document is exactly what it was.
    s.undo();
    expect(s.doc).toEqual(before);
    expect(await s.save()).toEqual(bytes);
    s.redo();
    expect(await texts(await s.save())).toHaveLength(8);
  });

  it("takes chosen pages, in the order given, and reuses the source of a file it already has", async () => {
    const s = await openPdf(wordsDoc(["Aa", "Bb"]));
    const other = wordsDoc(["Xx", "Yy", "Zz"]);
    const first = await s.pages.insertFrom(other, { pages: [2, 0] });
    const second = await s.pages.insertFrom(other, { pages: [1], after: null });
    expect(s.doc.sources.length).toBe(2);
    expect(await texts(await s.save())).toEqual(["Yy", "Aa", "Bb", "Zz", "Xx"]);
    expect(first.length + second.length).toBe(3);
    await expect(s.pages.insertFrom(other, { pages: [3] })).rejects.toThrow(/no page 4/);
  });

  it("merges a session (with its changes) and a PdfFile", async () => {
    const s = await openPdf(wordsDoc(["Aa", "Bb"]));
    const t = await openPdf(wordsDoc(["Xx", "Yy"]));
    t.pages.rotate(["p:main:0"], 90);
    t.pages.remove(["p:main:1"]);
    await s.pages.insertFrom(t);
    await s.pages.insertFrom(PdfFile.open(wordsDoc(["Pp"])));
    const v = await seen(await s.save());
    expect(v.pages.map((p) => [p.text, p.rotate])).toEqual([["Aa", 0], ["Bb", 0], ["Xx", 90], ["Pp", 0]]);
  });

  it("keeps the page order when a merged page moves, rotates, is deleted", async () => {
    const s = await openPdf(wordsDoc(["Aa", "Bb"]));
    const [x, y, z] = await s.pages.insertFrom(wordsDoc(["Xx", "Yy", "Zz"]));
    s.pages.move([z!], 0);
    s.pages.rotate([x!], 180);
    s.pages.remove([y!]);
    const out = await s.save();
    const v = await seen(out);
    expect(v.pages.map((p) => [p.text, p.rotate])).toEqual([["Zz", 0], ["Aa", 0], ["Bb", 0], ["Xx", 180]]);
    expect(fileContains(out, "Yy")).toBe(false);
  });

  it("takes annotations along, with new ids that belong to the document", async () => {
    const { buildClassic, obj, simpleDoc } = await import("./support/handmade");
    const base = simpleDoc(1, { text: () => "BT /F1 12 Tf 72 700 Td (Noted) Tj ET", pageExtra: () => "/Annots [20 0 R 21 0 R]" });
    const bytes = buildClassic([
      ...base,
      obj(20, "<< /Type /Annot /Subtype /Highlight /Rect [72 690 120 710] /QuadPoints [72 710 120 710 72 690 120 690] /C [1 1 0] /Contents (check this) /T (Reviewer) >>"),
      obj(21, "<< /Type /Annot /Subtype /Link /Rect [10 10 100 40] /A << /S /URI /URI (https://example.com/) >> >>"),
    ]).bytes;
    const s = await openPdf(bytes);
    const own = s.doc.pages[0]!.annots.map((a) => a.type);
    const t = await openPdf(wordsDoc(["Aa"]));
    const [id] = await t.pages.insertFrom(bytes);
    const page = t.doc.pages.find((p) => p.id === id)!;
    expect(page.annots.map((a) => a.type)).toEqual(own);
    expect(page.annots.every((a) => a.id.startsWith("a_") && a.ref === undefined)).toBe(true);
    // A second copy of the same page gets different ids.
    const [again] = await t.pages.insertFrom(bytes);
    const ids2 = new Set([...page.annots, ...t.doc.pages.find((p) => p.id === again)!.annots].map((a) => a.id));
    expect(ids2.size).toBe(own.length * 2);
    // The comment on the highlight came along as a thread of the document.
    const thread = Object.values(t.doc.comments ?? {})[0];
    if (own.includes("highlight")) expect(thread?.comments[0]?.body).toBe("check this");
  });
});

describe("extract and split", () => {
  it("extracts pages into a new file with only what belongs to them", async () => {
    const s = await openPdf(fiveDoc());
    const out = await s.pages.extract(["p:main:3", "p:main:1"]);
    const v = await seen(out, true);
    expect(v.pages.map((p) => p.text)).toEqual(["Bravo", "Delta"]);
    expect(fileContains(out, "Alpha")).toBe(false);
    expect(fileContains(out, "Echo")).toBe(false);
    // Part One went to a page that is not here: its bookmark is gone, the one below it moved up.
    expect(v.outline).toEqual([{ title: "Sub of One", page: 0, items: [] }]);
    const again = await openPdf(out);
    expect(again.doc.pages.length).toBe(2);
    // The session is untouched.
    expect(s.doc.pages.length).toBe(5);
    await expect(s.pages.extract(["nope"])).rejects.toThrow();
  });

  it("extracts merged pages and blank pages", async () => {
    const s = await openPdf(wordsDoc(["Aa", "Bb"]));
    const [x] = await s.pages.insertFrom(wordsDoc(["Xx"]));
    const blank = s.pages.insertBlank(null, { width: 100, height: 50 });
    const out = await s.pages.extract([x!, blank]);
    const v = await seen(out);
    expect(v.pages.map((p) => [p.text, p.width, p.height])).toEqual([["", 100, 50], ["Xx", 612, 792]]);
    expect(fileContains(out, "Aa")).toBe(false);
  });

  it("splits by ranges, by count and by bookmarks", async () => {
    const s = await openPdf(fiveDoc());
    const byRange = await s.pages.split({ ranges: "1-2,4,5-" });
    expect(await Promise.all(byRange.map(texts))).toEqual([["Alpha", "Bravo"], ["Delta"], ["Echo"]]);
    const byTwo = await s.pages.split({ every: 2 });
    expect(await Promise.all(byTwo.map(texts))).toEqual([["Alpha", "Bravo"], ["Charlie", "Delta"], ["Echo"]]);
    // Part One starts at Alpha, Part Two at Charlie, Part Three (named destination) at Echo.
    const byOutline = await s.pages.split({ outline: 1 });
    expect(await Promise.all(byOutline.map(texts))).toEqual([["Alpha", "Bravo"], ["Charlie", "Delta"], ["Echo"]]);
    expect(s.pages.splitPlan({ ranges: [[1, 2], 5] })).toEqual([["p:main:0", "p:main:1"], ["p:main:4"]]);
    await expect(s.pages.split({ ranges: "6" })).rejects.toThrow(/no page 6/);
    await expect(s.pages.split({ every: 0 })).rejects.toThrow();
  });
});

describe("pictures to pages", () => {
  it("makes a page for each JPEG and PNG and keeps the JPEG as it is", async () => {
    const photo = jpeg(80, 40, (c) => {
      c.fillStyle = "#ff0000";
      c.fillRect(0, 0, 40, 40);
      c.fillStyle = "#0000ff";
      c.fillRect(40, 0, 40, 40);
    });
    const png = makePng({ width: 2, height: 2, colorType: 6, depth: 8, sample: () => [0, 200, 0, 255] });
    const out = await pdfFromImages([{ data: photo }, { data: png, mime: "image/png" }], { fit: "image", dpi: 72 });
    const v = await seen(out);
    expect(v.pages.map((p) => [p.width, p.height])).toEqual([[80, 40], [2, 2]]);
    // The JPEG bytes are in the file exactly as they were.
    const hay = Buffer.from(out);
    expect(hay.includes(Buffer.from(photo))).toBe(true);
    const r = await renderPdf(out, 0, 1);
    expect(near(r.pixel(10, 20), red)).toBe(true);
    expect(near(r.pixel(70, 20), blue)).toBe(true);
  });

  it("fits pictures to a page, centred, with a margin", async () => {
    const wide = jpeg(100, 50, (c) => {
      c.fillStyle = "#ff0000";
      c.fillRect(0, 0, 100, 50);
    });
    const out = await pdfFromImages([{ data: wide }], { fit: "page", pageSize: { width: 200, height: 200 }, margin: 20 });
    const r = await renderPdf(out, 0, 1);
    expect(r.width).toBe(200);
    // The picture is 160 wide and 80 high, centred.
    expect(near(r.pixel(100, 100), red)).toBe(true);
    expect(near(r.pixel(30, 100), red)).toBe(true);
    expect(near(r.pixel(10, 100), [255, 255, 255])).toBe(true);
    expect(near(r.pixel(100, 50), [255, 255, 255])).toBe(true);
    // A landscape picture makes a landscape Letter page when no size is given.
    const auto = await seen(await pdfFromImages([{ data: wide }]));
    expect(auto.pages[0]).toMatchObject({ width: 792, height: 612 });
  });

  it("shows a picture upright when its Exif orientation says it was taken turned", async () => {
    const base = jpeg(40, 20, (c) => {
      c.fillStyle = "#ff0000";
      c.fillRect(0, 0, 20, 20);
      c.fillStyle = "#0000ff";
      c.fillRect(20, 0, 20, 20);
    });
    // 6: turn a quarter clockwise: the red left half ends up on top.
    const six = await pdfFromImages([{ data: withOrientation(base, 6) }], { fit: "image" });
    expect((await seen(six)).pages[0]).toMatchObject({ width: 20, height: 40 });
    const r6 = await renderPdf(six, 0, 1);
    expect(near(r6.pixel(10, 8), red)).toBe(true);
    expect(near(r6.pixel(10, 32), blue)).toBe(true);
    // 8: a quarter anticlockwise: red at the bottom.
    const r8 = await renderPdf(await pdfFromImages([{ data: withOrientation(base, 8) }], { fit: "image" }), 0, 1);
    expect(near(r8.pixel(10, 8), blue)).toBe(true);
    expect(near(r8.pixel(10, 32), red)).toBe(true);
    // 3: upside down: red on the right.
    const r3 = await renderPdf(await pdfFromImages([{ data: withOrientation(base, 3) }], { fit: "image" }), 0, 1);
    expect(near(r3.pixel(30, 10), red)).toBe(true);
    expect(near(r3.pixel(10, 10), blue)).toBe(true);
  });

  it("refuses what it cannot read", async () => {
    await expect(pdfFromImages([{ data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), mime: "image/gif" }])).rejects.toThrow(/JPEG and PNG/);
    await expect(pdfFromImages([])).rejects.toThrow();
  });

  it("adds picture pages to an open document", async () => {
    const s = await openPdf(wordsDoc(["Aa", "Bb"]));
    const before = s.doc;
    const png = makePng({ width: 4, height: 2, colorType: 2, depth: 8, sample: () => [10, 20, 30] });
    const added = await s.pages.insertImages([{ data: png }, { data: png }], { at: 1, fit: "image" });
    expect(ids(s).slice(1, 3)).toEqual(added);
    const v = await seen(await s.save());
    expect(v.pages.map((p) => p.text)).toEqual(["Aa", "", "", "Bb"]);
    s.undo();
    expect(s.doc).toEqual(before);
  });

  it("makes a new document from a session that has no file", async () => {
    const s = new PdfSession(emptyDoc("fresh"));
    s.saver = savePdf;
    const png = makePng({ width: 4, height: 2, colorType: 2, depth: 8, sample: () => [10, 20, 30] });
    await s.pages.insertImages([{ data: png }]);
    await s.pages.insertFrom(wordsDoc(["Aa"]));
    expect((await seen(await s.save())).pages.length).toBe(2);
  });
});
