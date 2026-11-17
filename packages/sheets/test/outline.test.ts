import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ProtectionError, SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Outline", ["Sheet1"]));
  s.setValues("Sheet1", "A1", Array.from({ length: 12 }, (_, r) => Array.from({ length: 12 }, (_, c) => r * 100 + c)));
  return s;
};
const hidden = (s: SheetSession, axis: "rows" | "columns" = "rows") => Object.entries(s.sheet("Sheet1")[axis] ?? {}).filter(([, d]) => d.hidden).map(([k]) => k).sort((a, b) => (a.length - b.length) || (a < b ? -1 : 1));
const levels = (s: SheetSession, axis: "rows" | "columns" = "rows") => Object.fromEntries(Object.entries(s.sheet("Sheet1")[axis] ?? {}).filter(([, d]) => d.level).map(([k, d]) => [k, d.level]));

describe("groups of rows", () => {
  it("are made by grouping rows, with the row below as the summary, in one undo step", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 4);
    expect(levels(s)).toEqual({ "2": 1, "3": 1, "4": 1 });
    expect(s.outlineGroups("Sheet1", "row")).toEqual([{ axis: "row", level: 1, from: 2, to: 4, summary: 5, collapsed: false }]);
    expect(s.outlineDepth("Sheet1", "row")).toBe(1);
    s.undo();
    expect(s.sheet("Sheet1").rows).toBeUndefined();
  });

  it("collapse by their summary row, hiding their rows, and expand again", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 4);
    expect(s.toggleGroup("Sheet1", "row", 5)).toBe(true);
    expect(hidden(s)).toEqual(["2", "3", "4"]);
    expect(s.sheet("Sheet1").rows!["5"]).toEqual({ collapsed: true });
    expect(s.outlineGroups("Sheet1", "row")[0]!.collapsed).toBe(true);
    expect(s.toggleGroup("Sheet1", "row", 5)).toBe(false);
    expect(hidden(s)).toEqual([]);
    expect(s.sheet("Sheet1").rows!["5"]).toBeUndefined();
    expect(s.toggleGroup("Sheet1", "row", 9)).toBeNull();
    // Given a row inside a group, it is that group.
    expect(s.toggleGroup("Sheet1", "row", 3, true)).toBe(true);
    s.undo();
    expect(hidden(s)).toEqual([]);
  });

  it("nest, and an inner group stays collapsed when the outer one is expanded", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 6);
    s.groupRows("Sheet1", 3, 4);
    expect(levels(s)).toEqual({ "2": 1, "3": 2, "4": 2, "5": 1, "6": 1 });
    const groups = s.outlineGroups("Sheet1", "row");
    expect(groups.map((g) => [g.level, g.from, g.to, g.summary])).toEqual([[1, 2, 6, 7], [2, 3, 4, 5]]);
    s.toggleGroup("Sheet1", "row", 5); // the inner group, summed by row 5
    expect(hidden(s)).toEqual(["3", "4"]);
    s.toggleGroup("Sheet1", "row", 7); // the outer one
    expect(hidden(s)).toEqual(["2", "3", "4", "5", "6"]);
    s.toggleGroup("Sheet1", "row", 7); // open it again: the inner one is still closed
    expect(hidden(s)).toEqual(["3", "4"]);
  });

  it("show a level: level 1 collapses everything, the last level expands everything", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 6);
    s.groupRows("Sheet1", 3, 4);
    s.showLevel("Sheet1", "row", 1);
    expect(hidden(s)).toEqual(["2", "3", "4", "5", "6"]);
    s.showLevel("Sheet1", "row", 2);
    expect(hidden(s)).toEqual(["3", "4"]);
    s.showLevel("Sheet1", "row", 3);
    expect(hidden(s)).toEqual([]);
    expect(Object.values(s.sheet("Sheet1").rows!).some((d) => d.collapsed)).toBe(false);
    expect(() => s.showLevel("Sheet1", "row", 0)).toThrow(/level/);
    expect(() => s.showLevel("Sheet1", "row", 9)).toThrow(/level/);
  });

  it("ungroup shows the rows of a collapsed group and drops its mark", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 4);
    s.toggleGroup("Sheet1", "row", 5);
    s.ungroupRows("Sheet1", 2, 4);
    expect(s.sheet("Sheet1").rows).toBeUndefined();
    s.groupRows("Sheet1", 2, 6);
    s.groupRows("Sheet1", 3, 4);
    s.ungroupRows("Sheet1", 3, 6); // only rows 3 and 4 had a second level; rows 5 and 6 leave the first
    expect(levels(s)).toEqual({ "2": 1, "3": 1, "4": 1 });
  });

  it("go seven deep and no deeper", () => {
    const s = make();
    for (let i = 0; i < 7; i++) s.groupRows("Sheet1", 2, 3);
    expect(s.outlineDepth("Sheet1", "row")).toBe(7);
    expect(() => s.groupRows("Sheet1", 2, 3)).toThrow(/7 deep/);
    expect(() => s.groupRows("Sheet1", 0, 3)).toThrow(/rows of the sheet/);
    expect(() => s.ungroupRows("Sheet1", 5, 3)).toThrow(/rows of the sheet/);
  });

  it("follow inserted and deleted rows, and have no button when they sit at the edge", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 4);
    s.toggleGroup("Sheet1", "row", 5);
    s.insertRows("Sheet1", 1, 2);
    expect(s.outlineGroups("Sheet1", "row")).toEqual([{ axis: "row", level: 1, from: 4, to: 6, summary: 7, collapsed: true }]);
    expect(hidden(s)).toEqual(["4", "5", "6"]);
    s.undo();
    const t = make();
    t.groupRows("Sheet1", 1, 3);
    t.setOutlineSummary("Sheet1", { above: true });
    expect(t.outlineGroups("Sheet1", "row")[0]).toMatchObject({ summary: 0, collapsed: false });
    expect(() => t.toggleGroup("Sheet1", "row", 2, true)).toThrow(/no row or column beside it/);
  });

  it("can have their summaries above, which expands them first", () => {
    const s = make();
    s.groupRows("Sheet1", 3, 5);
    s.toggleGroup("Sheet1", "row", 6);
    expect(hidden(s)).toEqual(["3", "4", "5"]);
    s.setOutlineSummary("Sheet1", { above: true });
    expect(hidden(s)).toEqual([]);
    expect(s.sheet("Sheet1").outline).toEqual({ summaryAbove: true });
    expect(s.outlineGroups("Sheet1", "row")[0]).toMatchObject({ from: 3, to: 5, summary: 2 });
    s.toggleGroup("Sheet1", "row", 2);
    expect(hidden(s)).toEqual(["3", "4", "5"]);
    s.setOutlineSummary("Sheet1", { above: false });
    expect(s.sheet("Sheet1").outline).toBeUndefined();
  });
});

describe("groups of columns", () => {
  it("work as rows do, with the column to the right as the summary", () => {
    const s = make();
    s.groupColumns("Sheet1", 2, 3);
    expect(levels(s, "columns")).toEqual({ B: 1, C: 1 });
    expect(s.outlineGroups("Sheet1", "col")[0]).toMatchObject({ from: 2, to: 3, summary: 4 });
    s.toggleGroup("Sheet1", "col", 4);
    expect(hidden(s, "columns")).toEqual(["B", "C"]);
    expect(s.sheet("Sheet1").columns!["D"]).toEqual({ collapsed: true });
    s.setOutlineSummary("Sheet1", { left: true });
    expect(hidden(s, "columns")).toEqual([]);
    expect(s.outlineGroups("Sheet1", "col")[0]).toMatchObject({ summary: 1 });
    s.showLevel("Sheet1", "col", 1);
    expect(hidden(s, "columns")).toEqual(["B", "C"]);
    s.ungroupColumns("Sheet1", 2, 3);
    expect(s.sheet("Sheet1").columns).toBeUndefined();
  });

  it("keep the size of a column that is grouped", () => {
    const s = make();
    s.setColumnWidth("Sheet1", 2, 20);
    s.groupColumns("Sheet1", 2, 2);
    expect(s.sheet("Sheet1").columns!["B"]).toEqual({ size: 20, level: 1 });
    s.ungroupColumns("Sheet1", 2, 2);
    expect(s.sheet("Sheet1").columns!["B"]).toEqual({ size: 20 });
  });
});

describe("saving and protecting", () => {
  it("is saved with the workbook and checked when it is read", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 4);
    s.setOutlineSummary("Sheet1", { left: true });
    s.toggleGroup("Sheet1", "row", 5);
    const text = serializeWorkbook(s.state);
    expect(parseWorkbook(text).sheets[0]!.rows!["2"]).toEqual({ level: 1, hidden: true });
    const bad = JSON.parse(text);
    bad.workbook.sheets[0].rows["2"].level = 9;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/1 to 7/);
    bad.workbook.sheets[0].rows["2"].level = 1;
    bad.workbook.sheets[0].rows["5"].collapsed = false;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/expected true/);
    bad.workbook.sheets[0].rows["5"].collapsed = true;
    bad.workbook.sheets[0].outline = { summaryAbove: 1 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/expected true/);
  });

  it("is refused on a protected sheet that doesn't allow formatting rows and columns", () => {
    const s = make();
    s.protectSheet("Sheet1");
    expect(() => s.groupRows("Sheet1", 2, 3)).toThrow(ProtectionError);
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["formatRows"] });
    s.groupRows("Sheet1", 2, 3);
    expect(() => s.groupColumns("Sheet1", 2, 3)).toThrow(ProtectionError);
  });
});

describe("in XLSX files", () => {
  const files = (s: SheetSession) => unzipSync(toXlsx(s.state));
  const sheetXml = (s: SheetSession) => strFromU8(files(s)["xl/worksheets/sheet1.xml"]!);

  it("writes levels, collapsed groups and the depth, and reads them back as they were", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 6);
    s.groupRows("Sheet1", 3, 4);
    s.toggleGroup("Sheet1", "row", 5);
    s.groupColumns("Sheet1", 2, 3);
    s.toggleGroup("Sheet1", "col", 4);
    s.setColumnWidth("Sheet1", 2, 20);
    const xml = sheetXml(s);
    expect(xml).toContain('outlineLevelRow="2" outlineLevelCol="1"');
    expect(xml).toMatch(/<row r="3" hidden="1" outlineLevel="2"/);
    expect(xml).toMatch(/<row r="2" outlineLevel="1"/);
    expect(xml).toMatch(/<row r="5" outlineLevel="1" collapsed="1"|<row r="5" collapsed="1" outlineLevel="1"/);
    expect(xml).toMatch(/<col min="2" max="2" width="20" customWidth="1" hidden="1" outlineLevel="1"\/>/);
    expect(xml).toMatch(/<col min="4" max="4" width="8.43" collapsed="1"\/>/);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const sheet = back.workbook.sheets[0]!;
    expect(sheet.rows).toEqual(s.sheet("Sheet1").rows);
    expect(sheet.columns).toEqual(s.sheet("Sheet1").columns);
  });

  it("writes where the summaries sit, and reads it back", () => {
    const s = make();
    s.groupRows("Sheet1", 3, 5);
    s.setOutlineSummary("Sheet1", { above: true, left: true });
    expect(sheetXml(s)).toContain('<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>');
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.outline).toEqual({ summaryAbove: true, summaryLeft: true });
    s.setOutlineSummary("Sheet1", { above: false });
    expect(sheetXml(s)).toContain('<outlinePr summaryRight="0"/>');
    s.setTabColor("Sheet1", "#00ff00");
    expect(sheetXml(s)).toContain('<sheetPr><tabColor rgb="FF00FF00"/><outlinePr summaryRight="0"/></sheetPr>');
  });

  it("reads a file the way Excel writes a collapsed group, and caps levels at 7", () => {
    const s = make();
    s.groupRows("Sheet1", 2, 3);
    const f = files(s);
    f["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(f["xl/worksheets/sheet1.xml"]!).replace('<row r="4"', '<row r="4" collapsed="true"').replace('<row r="2" outlineLevel="1"', '<row r="2" hidden="true" outlineLevel="9"'));
    const rows = fromXlsx(zipSync(f)).workbook.sheets[0]!.rows!;
    expect(rows["2"]).toEqual({ hidden: true, level: 7 });
    expect(rows["4"]).toEqual({ collapsed: true });
  });
});
