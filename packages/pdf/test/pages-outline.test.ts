import { describe, expect, it } from "vitest";
import { openPdf, PdfFile, type OutlineItem } from "../src";
import { fiveDoc, WORDS, wordsDoc } from "./support/pagesdocs";
import { seen, texts } from "./support/pdfinfo";

const strip = (items: readonly OutlineItem[]): unknown[] => items.map((i) => ({ ...i, id: "-", children: strip(i.children) }));

describe("outline: reading", () => {
  it("reads titles, destinations, colour, style, open state and paths", async () => {
    const s = await openPdf(fiveDoc());
    expect(s.doc.outline).toEqual([
      {
        id: "o:0",
        title: "Part One",
        dest: { page: "p:main:0", y: 50 },
        open: true,
        children: [{ id: "o:0.0", title: "Sub of One", dest: { page: "p:main:1" }, children: [] }],
      },
      { id: "o:1", title: "Part Two", dest: { page: "p:main:2", y: 292 }, color: "#ff0000", bold: true, children: [] },
      // A destination that is a name in the file's name tree.
      { id: "o:2", title: "Part Three", dest: { page: "p:main:4" }, open: false, children: [{ id: "o:2.0", title: "Echo section", dest: { page: "p:main:4" }, children: [] }] },
    ]);
  });

  it("reads web links, old-style named destinations, broken trees and files with no outline", async () => {
    const { buildClassic, obj, simpleDoc } = await import("./support/handmade");
    const base = simpleDoc(2);
    const bytes = buildClassic([
      obj(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 30 0 R /Dests 41 0 R >>"),
      ...base.slice(1),
      obj(30, "<< /Type /Outlines /First 31 0 R /Last 32 0 R /Count 2 >>"),
      obj(31, "<< /Title <FEFF00480069> /Parent 30 0 R /Next 32 0 R /A << /S /URI /URI (https://example.com/a) >> >>"),
      // A loop: the next item is itself. And a destination in the old /Dests dictionary.
      obj(32, "<< /Title (Loop) /Parent 30 0 R /Prev 31 0 R /Next 32 0 R /Dest /where >>"),
      obj(41, "<< /where [4 0 R /FitH 300] >>"),
    ]).bytes;
    const s = await openPdf(bytes);
    expect(s.doc.outline).toEqual([
      { id: "o:0", title: "Hi", uri: "https://example.com/a", children: [] },
      { id: "o:1", title: "Loop", dest: { page: "p:main:1", y: 492 }, children: [] },
    ]);
    const plain = await openPdf(wordsDoc(WORDS));
    expect(plain.doc.outline).toEqual([]);
  });
});

describe("outline: commands", () => {
  it("adds, renames, moves, indents, outdents and removes, each as one undo step", async () => {
    const s = await openPdf(wordsDoc(WORDS));
    const start = s.doc;
    const a = s.outline.add("Intro", "p:main:0");
    const b = s.outline.add("Methods", "p:main:2", { y: 100, bold: true });
    const c = s.outline.add("Results", "p:main:3");
    const sub = s.outline.add("Detail", "p:main:3", { parent: b, color: "#00aa00" });
    const head = s.outline.add("Heading only", null, { index: 0 });
    expect(strip(s.doc.outline)).toEqual([
      { title: "Heading only" , children: [], id: "-" },
      { title: "Intro", dest: { page: "p:main:0" }, children: [], id: "-" },
      { title: "Methods", dest: { page: "p:main:2", y: 100 }, bold: true, open: true, children: [{ title: "Detail", dest: { page: "p:main:3" }, color: "#00aa00", children: [], id: "-" }], id: "-" },
      { title: "Results", dest: { page: "p:main:3" }, children: [], id: "-" },
    ]);
    s.outline.rename(a, "Introduction");
    s.outline.indent(c);
    expect(s.outline.get(b).children.map((x) => x.id)).toEqual([sub, c]);
    s.outline.outdent(sub);
    expect(s.doc.outline.map((x) => x.id)).toEqual([head, a, b, sub, ]);
    s.outline.move(c, null, 0);
    expect(s.doc.outline.map((x) => x.id)).toEqual([c, head, a, b, sub]);
    expect(() => s.outline.move(b, b)).toThrow(/itself/);
    expect(() => s.outline.add("x", "nope")).toThrow(/not found/);
    s.outline.retarget(a, "p:main:4", 12);
    expect(s.outline.get(a).dest).toEqual({ page: "p:main:4", y: 12 });
    s.outline.remove(b, { promote: true });
    s.outline.remove(head);
    expect(s.doc.outline.map((x) => x.title)).toEqual(["Results", "Introduction", "Detail"]);
    while (s.canUndo) s.undo();
    expect(s.doc).toEqual(start);
  });
});

describe("outline: saving", () => {
  it("writes new bookmarks as an update and every reader sees them", async () => {
    const bytes = wordsDoc(WORDS);
    const s = await openPdf(bytes);
    const part = s.outline.add("Part", "p:main:1", { y: 100 });
    s.outline.add("Chapter", "p:main:2", { parent: part });
    s.outline.add("Closed", "p:main:3");
    s.outline.add("Closed child", "p:main:4", { parent: s.outline.items[1]!.id });
    s.outline.update(s.outline.items[1]!.id, { open: false });
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const v = await seen(result.bytes, true);
    expect(v.outline).toEqual([
      { title: "Part", page: 1, items: [{ title: "Chapter", page: 2, items: [] }] },
      { title: "Closed", page: 3, items: [{ title: "Closed child", page: 4, items: [] }] },
    ]);
    const file = PdfFile.open(result.bytes);
    const root = file.get(file.catalog().get("Outlines")) as import("../src").PdfDict;
    expect(file.get(root.get("Count"))).toBe(3);
    // The dictionary of the closed one says -1; its destination has the point converted to PDF space (792 - 100).
    const first = file.get(root.get("First")) as import("../src").PdfDict;
    const dest = file.get(first.get("Dest")) as unknown[];
    expect(dest.slice(1)).toEqual([expect.objectContaining({ value: "XYZ" }), null, 692, null]);
    // Read back, the outline is what was written (ids aside).
    const again = await openPdf(result.bytes);
    expect(strip(again.doc.outline)).toEqual(strip(s.doc.outline).map((x) => x));
  });

  it("round-trips an outline read from a file, and an unchanged outline is not rewritten", async () => {
    const bytes = fiveDoc();
    const s = await openPdf(bytes);
    s.pages.rotate(["p:main:0"], 90);
    const out = await s.save();
    expect(Array.from(out.subarray(out.length - 400)).map((c) => String.fromCharCode(c)).join("")).not.toContain("Outlines");
    expect(Buffer.from(out.subarray(bytes.length)).toString("latin1")).not.toContain("/Title");
    // Change one thing and the written outline reads back the same.
    s.outline.rename("o:1", "Second part");
    const out2 = await s.save();
    const again = await openPdf(out2);
    expect(strip(again.doc.outline)).toEqual(strip(s.doc.outline));
    const v = await seen(out2, true);
    expect(v.outline!.map((o) => [o.title, o.page])).toEqual([["Part One", 0], ["Second part", 2], ["Part Three", 4]]);
    // Colour and style survive.
    expect(again.doc.outline[1]).toMatchObject({ color: "#ff0000", bold: true });
    expect(again.doc.outline[2]!.open).toBe(false);
  });

  it("keeps bookmarks on the right pages when pages move, and drops them when the pages go", async () => {
    const s = await openPdf(fiveDoc());
    s.pages.move(["p:main:4"], 0);
    s.pages.move(["p:main:0"], 4);
    let v = await seen(await s.save(), true);
    expect(await texts(await s.save())).toEqual(["Echo", "Bravo", "Charlie", "Delta", "Alpha"]);
    expect(v.outline!.map((o) => [o.title, o.page])).toEqual([["Part One", 4], ["Part Two", 2], ["Part Three", 0]]);
    s.pages.remove(["p:main:2", "p:main:0"]);
    v = await seen(await s.save(), true);
    // Part One (Alpha) and Part Two (Charlie) are gone; the bookmark under Part One moves up.
    expect(v.outline!.map((o) => o.title)).toEqual(["Sub of One", "Part Three"]);
    expect(v.outline![1]!.items).toEqual([{ title: "Echo section", page: 0, items: [] }]);
    expect(v.pages.map((p) => p.text)).toEqual(["Echo", "Bravo", "Delta"]);
  });

  it("removes the outline entirely when it is emptied", async () => {
    const s = await openPdf(fiveDoc());
    s.outline.set([]);
    const out = await s.save();
    expect(PdfFile.open(out).catalog().has("Outlines")).toBe(false);
    expect((await openPdf(out)).doc.outline).toEqual([]);
  });

  it("writes a URI bookmark and a bookmark on a merged page", async () => {
    const s = await openPdf(wordsDoc(["Aa"]));
    const [x] = await s.pages.insertFrom(wordsDoc(["Xx"]));
    s.outline.add("Merged", x!);
    s.outline.set([...s.doc.outline, { id: "u", title: "Web", uri: "https://example.com/", children: [] }]);
    const out = await s.save();
    const again = await openPdf(out);
    expect(again.doc.outline).toMatchObject([{ title: "Merged", dest: { page: "p:main:1" } }, { title: "Web", uri: "https://example.com/" }]);
  });
});
