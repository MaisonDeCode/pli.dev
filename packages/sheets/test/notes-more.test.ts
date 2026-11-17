import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";
import { editNoteRuns, styleNoteRuns } from "../src/note";

const make = (options: { author?: string } = {}) => {
  const s = new SheetSession(createWorkbook("Notes", ["Sheet1", "Other"]), { now: () => 45_000.5, ...options });
  s.setValues("Sheet1", "A1", [["Pli", "docs"], ["x", null]]);
  return s;
};
const round = (s: SheetSession) => fromXlsx(toXlsx(s.state));
const cellOf = (s: SheetSession, a: string, sheet = "Sheet1") => s.cell(sheet, a);

describe("notes with a look", () => {
  it("keeps the text plain and the runs beside it, and adds them up", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "Hello big world", { runs: [{ text: "Hello " }, { text: "big", bold: true, color: "#FF0000" }, { text: " world" }] });
    expect(s.note("Sheet1", "A1")).toBe("Hello big world");
    expect(s.noteInfo("Sheet1", "A1")).toEqual({ text: "Hello big world", runs: [{ text: "Hello " }, { text: "big", bold: true, color: "#ff0000" }, { text: " world" }] });
    expect(() => s.setNote("Sheet1", "A1", "Hello", { runs: [{ text: "Bye", bold: true }] })).toThrow(/add up/);
    expect(() => s.setNote("Sheet1", "A1", "Hello", { runs: [{ text: "Hello", color: "red" }] })).toThrow(/colour/);
    expect(() => s.setNote("Sheet1", "A1", "Hello", { runs: [{ text: "Hello", size: 0 }] })).toThrow(/size/);
    expect(() => s.setNote("Sheet1", "A1", "Hello", { runs: [{ text: "Hello", blink: true } as never] })).toThrow(/blink/);
  });

  it("drops the runs when the text changes without new ones, and joins runs that look alike", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "ab", { runs: [{ text: "a", bold: true }, { text: "b", bold: true }] });
    expect(cellOf(s, "A1")?.noteRuns).toEqual([{ text: "ab", bold: true }]);
    s.setNote("Sheet1", "A1", "abc");
    expect(cellOf(s, "A1")?.noteRuns).toBeUndefined();
    s.setNote("Sheet1", "A1", "abc", { runs: [{ text: "abc" }] });
    expect(cellOf(s, "A1")?.noteRuns).toBeUndefined(); // all plain is a plain note
  });

  it("formats a stretch of the text, and takes it off, as undo steps", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "one two three");
    s.formatNote("Sheet1", "A1", 4, 7, { bold: true, size: 14 });
    expect(cellOf(s, "A1")?.noteRuns).toEqual([{ text: "one " }, { text: "two", bold: true, size: 14 }, { text: " three" }]);
    s.formatNote("Sheet1", "A1", 0, 13, { italic: true, font: "Georgia" });
    expect(cellOf(s, "A1")?.noteRuns?.every((r) => r.italic && r.font === "Georgia")).toBe(true);
    s.formatNote("Sheet1", "A1", 0, 13, { bold: null, size: null, italic: false, font: null });
    expect(cellOf(s, "A1")?.noteRuns).toBeUndefined();
    s.undo();
    expect(cellOf(s, "A1")?.noteRuns).toHaveLength(3);
    expect(() => s.formatNote("Sheet1", "B2", 0, 1, { bold: true })).toThrow(/no note/);
  });

  it("styles and edits runs as pure helpers", () => {
    expect(styleNoteRuns("abc", undefined, 1, 2, { underline: true })).toEqual([{ text: "a" }, { text: "b", underline: true }, { text: "c" }]);
    const edited = editNoteRuns("a BIG b", [{ text: "a " }, { text: "BIG", bold: true }, { text: " b" }], [{ start: 2, end: 5, text: "small" }]);
    expect(edited).toEqual({ note: "a small b", runs: [{ text: "a " }, { text: "small", bold: true }, { text: " b" }] });
  });

  it("goes along with copy, sort and Clear contents, and goes with Clear all and a merge", () => {
    const s = make({ author: "Ana" });
    s.setNote("Sheet1", "A1", "rich", { runs: [{ text: "ri", bold: true }, { text: "ch" }], box: { width: 200, show: true } });
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "C1" });
    expect(cellOf(s, "C1")).toMatchObject({ note: "rich", noteAuthor: "Ana", noteBox: { width: 200, show: true }, noteRuns: [{ text: "ri", bold: true }, { text: "ch" }] });
    s.clear("Sheet1", "A1", "contents");
    expect(cellOf(s, "A1")).toMatchObject({ note: "rich", noteAuthor: "Ana" });
    s.clear("Sheet1", "A1", "all");
    expect(cellOf(s, "A1")).toBeUndefined();
    s.mergeCells("Sheet1", "B1:C1");
    expect(cellOf(s, "C1")?.noteAuthor).toBeUndefined();
  });
});

describe("the author", () => {
  it("is the session's, for new notes only, and never invented", () => {
    const none = make();
    none.setNote("Sheet1", "A1", "n");
    expect(none.noteInfo("Sheet1", "A1")).toEqual({ text: "n" });
    const s = make({ author: "Ana" });
    s.setNote("Sheet1", "A1", "n");
    expect(s.noteInfo("Sheet1", "A1")?.author).toBe("Ana");
    s.author = "Bo";
    s.setNote("Sheet1", "A1", "edited");
    expect(s.noteInfo("Sheet1", "A1")?.author).toBe("Ana");
    s.setNote("Sheet1", "B2", "new");
    expect(s.noteInfo("Sheet1", "B2")?.author).toBe("Bo");
    s.setNote("Sheet1", "B2", "new", { author: "Cy" });
    expect(s.noteInfo("Sheet1", "B2")?.author).toBe("Cy");
    s.setNote("Sheet1", "B2", "new", { author: null });
    expect(s.noteInfo("Sheet1", "B2")?.author).toBeUndefined();
    expect(() => s.setNote("Sheet1", "B2", "x", { author: "a".repeat(256) })).toThrow(/255/);
  });
});

describe("the box", () => {
  it("is sized, placed and kept showing, as one undo step for all notes", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "one");
    s.setNote("Sheet1", "B2", "two");
    s.setNoteBox("Sheet1", "A1", { width: 300, height: 120, dx: 40, dy: 5 });
    expect(s.noteInfo("Sheet1", "A1")?.box).toEqual({ width: 300, height: 120, dx: 40, dy: 5 });
    expect(s.showNote("Sheet1", "A1")).toBe(true);
    expect(s.noteInfo("Sheet1", "A1")?.box).toEqual({ width: 300, height: 120, dx: 40, dy: 5, show: true });
    expect(s.showNote("Sheet1", "A1")).toBe(false);
    expect(s.showAllNotes("Sheet1")).toBe(2);
    expect(s.notes("Sheet1").every((n) => n.box?.show)).toBe(true);
    expect(s.showAllNotes("Sheet1")).toBe(0);
    s.undo();
    expect(s.notes("Sheet1").some((n) => n.box?.show)).toBe(false);
    s.showAllNotes("Sheet1");
    expect(s.showAllNotes("Sheet1", false)).toBe(2);
    expect(s.noteInfo("Sheet1", "B2")?.box).toBeUndefined();
    s.setNoteBox("Sheet1", "A1", null);
    expect(s.noteInfo("Sheet1", "A1")?.box).toBeUndefined();
  });

  it("limits sizes and refuses what is not a box", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "one");
    s.setNoteBox("Sheet1", "A1", { width: 1, height: 99999 });
    expect(s.noteInfo("Sheet1", "A1")?.box).toEqual({ width: 32, height: 2000 });
    expect(() => s.setNoteBox("Sheet1", "A1", { width: "wide" } as never)).toThrow(/pixels/);
    expect(() => s.setNoteBox("Sheet1", "A1", { colour: 1 } as never)).toThrow(/colour/);
    expect(() => s.setNoteBox("Sheet1", "C3", { width: 100 })).toThrow(/no note/);
  });

  it("moves with its cell when rows are inserted", () => {
    const s = make();
    s.setNote("Sheet1", "A2", "n", { box: { dx: 30, show: true } });
    s.insertRows("Sheet1", 1, 1);
    expect(s.noteInfo("Sheet1", "A3")?.box).toEqual({ dx: 30, show: true });
  });
});

describe("saving", () => {
  it("round-trips through the workbook text and refuses wrong shapes", () => {
    const s = make({ author: "Ana" });
    s.setNote("Sheet1", "A1", "ab", { runs: [{ text: "a", italic: true }, { text: "b" }], box: { width: 220, show: true } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.cells["A1"]).toMatchObject({ note: "ab", noteAuthor: "Ana", noteBox: { width: 220, show: true }, noteRuns: [{ text: "a", italic: true }, { text: "b" }] });
    const bad = JSON.parse(serializeWorkbook(s.state));
    const cell = bad.workbook.sheets[0].cells.A1;
    cell.noteRuns = [{ text: "zz", bold: true }];
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/add up/);
    cell.noteRuns = [{ text: "ab", bold: true }];
    cell.noteBox = { width: "x" };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    cell.noteBox = { show: true };
    delete cell.note;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/belong to a note/);
    // an old workbook, with only a plain note, still reads
    const old = JSON.parse(serializeWorkbook(make().state));
    old.workbook.sheets[0].cells.A1.note = "plain";
    expect(parseWorkbook(JSON.stringify(old)).sheets[0]!.cells["A1"]?.note).toBe("plain");
  });
});

describe("in XLSX files", () => {
  it("writes rich runs and the author the way Excel does (bold name first), and reads them back", () => {
    const s = make({ author: "Ana" });
    s.setNote("Sheet1", "B2", "Check the total now", { runs: [{ text: "Check the " }, { text: "total", bold: true, italic: true, underline: true, color: "#c00000", size: 12, font: "Arial" }, { text: " now" }] });
    s.setNote("Sheet1", "A1", "plain one", { author: null });
    const files = unzipSync(toXlsx(s.state));
    const comments = strFromU8(files["xl/comments1.xml"]!);
    expect(comments).toContain("<authors><author>Pli</author><author>Ana</author></authors>");
    expect(comments).toContain('<r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">Ana:</t></r>');
    expect(comments).toContain('<rPr><b/><i/><u/><sz val="12"/><color rgb="FFC00000"/><rFont val="Arial"/><family val="2"/></rPr><t xml:space="preserve">total</t>');
    expect(comments).toContain('<comment ref="A1" authorId="0"><text><t xml:space="preserve">plain one</t></text></comment>');
    const { workbook, warnings } = round(s);
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["B2"]).toMatchObject({ note: "Check the total now", noteAuthor: "Ana", noteRuns: [{ text: "Check the " }, { text: "total", bold: true, italic: true, underline: true, color: "#c00000", size: 12, font: "Arial" }, { text: " now" }] });
    expect(cells["A1"]?.noteAuthor).toBeUndefined();
    expect(cells["A1"]?.noteRuns).toBeUndefined();
  });

  it("writes the box to the drawing (size, place, Visible) and reads it back", () => {
    const s = make();
    s.setNote("Sheet1", "B2", "boxed", { box: { width: 260, height: 110, dx: 40, dy: 12, show: true } });
    s.setNote("Sheet1", "C3", "default box");
    s.setColumnWidth("Sheet1", 1, 20);
    const vml = strFromU8(unzipSync(toXlsx(s.state))["xl/drawings/vmlDrawing1.vml"]!);
    const first = vml.slice(vml.indexOf("<v:shape id"), vml.indexOf("</v:shape>"));
    expect(first).toContain("visibility:visible");
    expect(first).toContain("<x:Visible/>");
    expect(first).toContain("width:195pt;height:82.5pt");
    expect(vml.split("<x:Visible/>")).toHaveLength(2);
    const back = round(s).workbook.sheets[0]!.cells;
    expect(back["B2"]?.noteBox).toEqual({ width: 260, height: 110, dx: 40, dy: 12, show: true });
    expect(back["C3"]?.noteBox).toBeUndefined();
  });

  it("reads what Excel writes: rich runs with the author in front, a visible box, a size in the style only", () => {
    const comments =
      `<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Dana</author></authors><commentList>` +
      `<comment ref="A1" authorId="0"><text><r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t>Dana:</t></r><r><rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">\r\nCheck </t></r><r><rPr><b/><sz val="9"/><color rgb="FFFF0000"/><rFont val="Tahoma"/><family val="2"/></rPr><t>this</t></r></text></comment>` +
      `<comment ref="B2" authorId="0"><text><t>no prefix here</t></text></comment></commentList></comments>`;
    const vml =
      `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="s1" type="#t" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:150pt;height:60pt;z-index:1;visibility:visible"><x:ClientData ObjectType="Note"><x:Anchor>1, 15, 0, 10, 4, 5, 4, 2</x:Anchor><x:Row>0</x:Row><x:Column>0</x:Column><x:Visible/></x:ClientData></v:shape>` +
      `<v:shape id="s2" type="#t" style="width:2in;height:40pt;visibility:hidden"><x:ClientData ObjectType="Note"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>`;
    const base = unzipSync(toXlsx(make().state));
    const files: Record<string, Uint8Array> = { ...base };
    files["xl/comments1.xml"] = strToU8(comments);
    files["xl/drawings/vmlDrawing1.vml"] = strToU8(vml);
    const sheetXml = strFromU8(files["xl/worksheets/sheet1.xml"]!).replace("</worksheet>", '<legacyDrawing r:id="rId8"/></worksheet>');
    files["xl/worksheets/sheet1.xml"] = strToU8(sheetXml);
    files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`,
    );
    const { workbook } = fromXlsx(zipSync(files));
    const a1 = workbook.sheets[0]!.cells["A1"]!;
    expect(a1.note).toBe("Check this");
    expect(a1.noteAuthor).toBe("Dana");
    expect(a1.noteRuns).toEqual([{ text: "Check " }, { text: "this", bold: true, color: "#ff0000" }]);
    // anchor: from column B (+15px) row 1 (+10px) to column E (+5) row 5 (+2); the cell A1 is 64px wide
    expect(a1.noteBox).toEqual({ width: 3 * 64 + 5 - 15, height: 4 * 20 + 2 - 10, dy: 10, show: true });
    const b2 = workbook.sheets[0]!.cells["B2"]!;
    expect(b2.note).toBe("no prefix here");
    expect(b2.noteAuthor).toBe("Dana");
    expect(b2.noteBox).toEqual({ width: 192, height: 53 });
  });
});

describe("find and replace in notes", () => {
  const withNotes = () => {
    const s = make();
    s.setValues("Sheet1", "A3", [["Smith in a cell"]]);
    s.setNote("Sheet1", "A1", "Ask Smith about it", { runs: [{ text: "Ask " }, { text: "Smith", bold: true }, { text: " about it" }] });
    s.setNote("Sheet1", "B2", "nothing here");
    s.setNote("Other", "C3", "smith again, Smith");
    return s;
  };

  it("finds in the notes only, with counts, order and the note's text", () => {
    const s = withNotes();
    const found = s.find({ text: "smith", lookIn: "notes" });
    expect(found.map((f) => f.address)).toEqual(["A1", "C3"]);
    expect(found[0]).toMatchObject({ text: "Ask Smith about it", in: "note" });
    expect(s.find({ text: "smith" }).map((f) => f.address)).toEqual(["A3"]);
    expect(s.find({ text: "smith", lookIn: "notes", matchCase: true }).map((f) => f.address)).toEqual(["C3"]);
    expect(s.find({ text: "smith", lookIn: "notes", wholeCell: true })).toEqual([]);
    expect(s.find({ text: "*here", lookIn: "notes", wholeCell: true, scope: { sheet: "Sheet1" } }).map((f) => f.address)).toEqual(["B2"]);
    expect(s.find({ text: "x", lookIn: "notes", scope: { sheet: "Sheet1", range: "A1" } })).toEqual([]);
  });

  it("replaces in notes as one undo step, keeping the look where the text sits in one run", () => {
    const s = withNotes();
    const r = s.replace({ text: "smith", lookIn: "notes" }, "Jones");
    expect(r).toEqual({ cells: 2, occurrences: 3, skipped: 0 });
    expect(s.note("Sheet1", "A1")).toBe("Ask Jones about it");
    expect(s.cell("Sheet1", "A1")?.noteRuns).toEqual([{ text: "Ask " }, { text: "Jones", bold: true }, { text: " about it" }]);
    expect(s.note("Other", "C3")).toBe("Jones again, Jones");
    expect(s.value("Sheet1", "A3")).toBe("Smith in a cell"); // the cells themselves are untouched
    s.undo();
    expect(s.note("Sheet1", "A1")).toBe("Ask Smith about it");
    expect(s.note("Other", "C3")).toBe("smith again, Smith");
  });

  it("replaces across runs with the look of where the match began, in some cells only, and with groups", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "go big home", { runs: [{ text: "go " }, { text: "bi", bold: true }, { text: "g home", italic: true }] });
    s.replace({ text: "big", lookIn: "notes" }, "small");
    expect(s.cell("Sheet1", "A1")?.noteRuns).toEqual([{ text: "go " }, { text: "small", bold: true }, { text: " home", italic: true }]);
    s.setNote("Sheet1", "B2", "a1 b22");
    s.setNote("Sheet1", "A2", "a1");
    s.replace({ text: "([a-z])(\\d+)", regex: true, lookIn: "notes" }, "$2$1", [{ sheet: "Sheet1", address: "B2" }]);
    expect(s.note("Sheet1", "B2")).toBe("1a 22b");
    expect(s.note("Sheet1", "A2")).toBe("a1");
  });

  it("takes a note off when replacing leaves it empty, and keeps its author and box", () => {
    const s = make({ author: "Ana" });
    s.setNote("Sheet1", "A1", "gone", { box: { show: true } });
    s.setNote("Sheet1", "B1", "keep this");
    s.replace({ text: "this", lookIn: "notes" }, "that");
    expect(s.cell("Sheet1", "B1")).toMatchObject({ note: "keep that", noteAuthor: "Ana" });
    s.replace({ text: "gone", lookIn: "notes" }, "");
    expect(s.note("Sheet1", "A1")).toBeNull();
    s.setNote("Sheet1", "C1", "x", { box: { show: true } });
    s.replace({ text: "x", lookIn: "notes" }, "y");
    expect(s.noteInfo("Sheet1", "C1")).toMatchObject({ text: "y", author: "Ana", box: { show: true } });
  });

  it("is refused on a protected sheet that doesn't allow editing objects", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "find me");
    s.protectSheet("Sheet1", {});
    expect(() => s.replace({ text: "find", lookIn: "notes" }, "x")).toThrow();
    expect(s.note("Sheet1", "A1")).toBe("find me");
    expect(() => s.showNote("Sheet1", "A1")).toThrow();
  });
});
