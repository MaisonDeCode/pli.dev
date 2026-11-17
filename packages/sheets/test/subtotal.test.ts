import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { ProtectionError, SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Sub", ["Sheet1", "Other"]));
  s.setValues("Sheet1", "A1", [
    ["Region", "Product", "Qty", "Amount"],
    ["East", "Ink", 1, 7],
    ["East", "Pen", 2, 10],
    ["East", "Pen", 3, 15],
    ["West", "Ink", 4, 20],
    ["West", "Pen", 5, 25],
  ]);
  s.setFormat("Sheet1", "D2:D2", "$#,##0.00");
  return s;
};
const texts = (s: SheetSession, rows: number, cols = "ABCD") => Array.from({ length: rows }, (_, i) => [...cols].map((c) => s.display("Sheet1", `${c}${i + 1}`).text).join("|"));
const formulas = (s: SheetSession, rows: number, col: string) => Array.from({ length: rows }, (_, i) => s.cell("Sheet1", `${col}${i + 1}`)?.f ?? "");
const levels = (s: SheetSession) => Object.fromEntries(Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.level).map(([k, d]) => [Number(k), d.level]));
const hidden = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([k]) => Number(k)).sort((a, b) => a - b);

describe("SUBTOTAL", () => {
  const sub = (formula: string, s = make()) => {
    s.setCell("Sheet1", "F1", "=" + formula);
    return s.value("Sheet1", "F1");
  };
  it("knows all eleven functions", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => sub(`SUBTOTAL(${n},C2:C6)`))).toEqual([3, 5, 5, 5, 1, 120, Math.sqrt(2.5), Math.sqrt(2), 15, 2.5, 2]);
    expect([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111].map((n) => sub(`SUBTOTAL(${n},C2:C6)`))).toEqual([3, 5, 5, 5, 1, 120, Math.sqrt(2.5), Math.sqrt(2), 15, 2.5, 2]);
  });
  it("refuses other numbers, and counts text and errors as COUNTA does", () => {
    expect(sub("SUBTOTAL(0,C2:C6)")).toEqual({ error: "#VALUE!" });
    expect(sub("SUBTOTAL(12,C2:C6)")).toEqual({ error: "#VALUE!" });
    expect(sub("SUBTOTAL(100,C2:C6)")).toEqual({ error: "#VALUE!" });
    expect(sub("SUBTOTAL(3,A1:B6)")).toBe(12);
    expect(sub("SUBTOTAL(2,A1:B6)")).toBe(0);
    expect(sub("SUBTOTAL(9,Z1:Z3)")).toBe(0);
    expect(sub("SUBTOTAL(1,Z1:Z3)")).toEqual({ error: "#DIV/0!" });
    expect(sub("SUBTOTAL(7,C2:C2)")).toEqual({ error: "#DIV/0!" });
    const s = make();
    s.setCell("Sheet1", "C3", "=1/0");
    expect(sub("SUBTOTAL(9,C2:C6)", s)).toEqual({ error: "#DIV/0!" });
    expect(sub("SUBTOTAL(2,C2:C6)", s)).toBe(4);
    expect(sub("SUBTOTAL(3,C2:C6)", s)).toBe(5);
  });
  it("leaves out the SUBTOTALs inside what it adds up", () => {
    const s = make();
    s.setCell("Sheet1", "C7", "=SUBTOTAL(9,C2:C6)");
    s.setCell("Sheet1", "C8", "=SUBTOTAL(9,C2:C7)");
    s.setCell("Sheet1", "C9", "=SUM(C2:C7)");
    expect(s.value("Sheet1", "C8")).toBe(15);
    expect(s.value("Sheet1", "C9")).toBe(30);
  });
  it("leaves out hidden rows in 101 to 111 only, and works again when rows are hidden or shown", () => {
    const s = make();
    s.setCell("Sheet1", "F1", "=SUBTOTAL(109,C2:C6)");
    s.setCell("Sheet1", "F2", "=SUBTOTAL(9,C2:C6)");
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "row", index: 3, hidden: true }]);
    expect(s.value("Sheet1", "F1")).toBe(13);
    expect(s.value("Sheet1", "F2")).toBe(15);
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "row", index: 3, hidden: null }]);
    expect(s.value("Sheet1", "F1")).toBe(15);
  });
  it("leaves out rows a filter hid, in both kinds", () => {
    const s = make();
    s.setCell("Sheet1", "F1", "=SUBTOTAL(109,C2:C6)");
    s.setCell("Sheet1", "F2", "=SUBTOTAL(9,C2:C6)");
    s.setFilter("Sheet1", "A1:D6");
    s.filterColumn("Sheet1", 1, ["West"]);
    expect(s.value("Sheet1", "F1")).toBe(9);
    expect(s.value("Sheet1", "F2")).toBe(9);
    s.filterColumn("Sheet1", 1, null);
    expect(s.value("Sheet1", "F2")).toBe(15);
  });
  it("adds up a row's cells whatever is hidden above it and takes text arguments as numbers", () => {
    expect(sub("SUBTOTAL(9,C2,D2)")).toBe(1 + 7);
    expect(sub("SUBTOTAL(9,{1,2,3})")).toBe(6);
  });
});

describe("the Subtotal command", () => {
  it("puts a SUBTOTAL row under each run of a column, and a grand total, as one undo step", () => {
    const s = make();
    const before = s.state;
    const r = s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty", "Amount"] });
    expect(r).toEqual({ groups: 2, added: 3, removed: 0, range: "A1:D9" });
    expect(texts(s, 9)).toEqual([
      "Region|Product|Qty|Amount",
      "East|Ink|1|$7.00",
      "East|Pen|2|10",
      "East|Pen|3|15",
      "East Total||6|$32.00",
      "West|Ink|4|20",
      "West|Pen|5|25",
      "West Total||9|$45.00",
      "Grand Total||15|$77.00",
    ]);
    expect(formulas(s, 9, "C")).toEqual(["", "", "", "", "SUBTOTAL(9,C2:C4)", "", "", "SUBTOTAL(9,C6:C7)", "SUBTOTAL(9,C2:C8)"]);
    expect(s.cell("Sheet1", "A5")!.s).toEqual({ bold: true });
    s.undo();
    expect(s.state).toEqual(before);
    s.redo();
    expect(s.display("Sheet1", "C9").text).toBe("15");
  });

  it("makes each run a group that folds into its subtotal row", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"] });
    expect(levels(s)).toEqual({ 2: 1, 3: 1, 4: 1, 6: 1, 7: 1 });
    expect(s.outlineGroups("Sheet1", "row").map((g) => [g.level, g.from, g.to, g.summary])).toEqual([[1, 2, 4, 5], [1, 6, 7, 8]]);
    s.showLevel("Sheet1", "row", 1);
    expect(hidden(s)).toEqual([2, 3, 4, 6, 7]);
    expect(s.value("Sheet1", "C9")).toBe(15);
    s.showLevel("Sheet1", "row", 2);
    expect(hidden(s)).toEqual([]);
  });

  it("takes the column and the columns by letter or heading, and any function", () => {
    const fns = { sum: [9, "Total", 15], count: [3, "Count", 5], countNums: [2, "Count", 5], average: [1, "Average", 3], max: [4, "Max", 5], min: [5, "Min", 1], product: [6, "Product", 120], var: [10, "Var", 2.5], varp: [11, "Varp", 2], stdDev: [7, "StdDev", Math.sqrt(2.5)], stdDevp: [8, "StdDevp", Math.sqrt(2)] } as const;
    for (const [fn, [code, label, grand]] of Object.entries(fns)) {
      const s = make();
      s.subtotal("Sheet1", "A1:D6", { by: "region", fn: fn as never, columns: ["qty"] });
      expect(s.cell("Sheet1", "C9")!.f).toBe(`SUBTOTAL(${code},C2:C8)`);
      expect(s.display("Sheet1", "A5").text).toBe(`East ${label}`);
      expect(s.display("Sheet1", "A9").text).toBe(`Grand ${label}`);
      expect(s.value("Sheet1", "C9"), fn).toBeCloseTo(grand, 9);
    }
  });

  it("can leave out the grand total, and put the subtotals over their groups", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"], grandTotal: false, summaryBelow: false });
    expect(texts(s, 8, "ABC")).toEqual(["Region|Product|Qty", "East Total||6", "East|Ink|1", "East|Pen|2", "East|Pen|3", "West Total||9", "West|Ink|4", "West|Pen|5"]);
    expect(s.sheet("Sheet1").outline).toEqual({ summaryAbove: true });
    expect(s.outlineGroups("Sheet1", "row").map((g) => [g.from, g.to, g.summary])).toEqual([[3, 5, 2], [7, 8, 6]]);
    const t = make();
    t.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"], summaryBelow: false });
    expect(texts(t, 9, "ABC")[1]).toBe("Grand Total||15");
    expect(t.cell("Sheet1", "C2")!.f).toBe("SUBTOTAL(9,C3:C9)");
    expect(t.value("Sheet1", "C2")).toBe(15);
  });

  it("replaces the subtotals that are there, so doing it again changes them", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"] });
    s.toggleGroup("Sheet1", "row", 5);
    const r = s.subtotal("Sheet1", "A1:D9", { by: "A", columns: ["D"], fn: "max" });
    expect(r).toMatchObject({ groups: 2, added: 3, removed: 3 });
    expect(texts(s, 9, "ABCD").map((t) => t.split("|").filter(Boolean).join("|"))).toEqual(["Region|Product|Qty|Amount", "East|Ink|1|$7.00", "East|Pen|2|10", "East|Pen|3|15", "East Max|$15.00", "West|Ink|4|20", "West|Pen|5|25", "West Max|$25.00", "Grand Max|$25.00"]);
    expect(hidden(s)).toEqual([]);
    expect(s.sheet("Sheet1").rows?.["5"]?.collapsed).toBeUndefined();
    s.undo();
    expect(s.display("Sheet1", "C5").text).toBe("6");
  });

  it("adds a level inside the groups when the subtotals are kept (nested subtotals)", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"] });
    const r = s.subtotal("Sheet1", "A1:D9", { by: "Product", columns: ["Qty"], replace: false });
    expect(r.groups).toBe(4);
    expect(r.added).toBe(4);
    expect(texts(s, 13, "ABC").map((t) => t.split("|").filter(Boolean).join("|"))).toEqual([
      "Region|Product|Qty",
      "East|Ink|1",
      "Ink Total|1",
      "East|Pen|2",
      "East|Pen|3",
      "Pen Total|5",
      "East Total|6",
      "West|Ink|4",
      "Ink Total|4",
      "West|Pen|5",
      "Pen Total|5",
      "West Total|9",
      "Grand Total|15",
    ]);
    expect(levels(s)).toEqual({ 2: 2, 3: 1, 4: 2, 5: 2, 6: 1, 8: 2, 9: 1, 10: 2, 11: 1 });
    expect(s.outlineDepth("Sheet1", "row")).toBe(2);
    expect(s.outlineGroups("Sheet1", "row").map((g) => [g.level, g.from, g.to, g.summary])).toEqual([[1, 2, 6, 7], [1, 8, 11, 12], [2, 2, 2, 3], [2, 4, 5, 6], [2, 8, 8, 9], [2, 10, 10, 11]]);
    // The outer subtotals skip the inner ones, and so does the grand total.
    expect(s.value("Sheet1", "C7")).toBe(6);
    expect(s.value("Sheet1", "C13")).toBe(15);
    expect(s.subtotalRows("Sheet1", "A1").rows).toEqual([3, 6, 7, 9, 11, 12, 13]);
    expect(s.subtotalRows("Sheet1", "A1").grand).toBe(13);
    // Collapsing level 1 shows only the region totals and the grand total.
    s.showLevel("Sheet1", "row", 1);
    expect(hidden(s)).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11]);
    expect(s.value("Sheet1", "C13")).toBe(15);
    s.undo();
    s.undo();
    s.undo();
    expect(s.sheet("Sheet1").rows).toBeUndefined();
  });

  it("takes every subtotal and the groups out with Remove All", () => {
    const s = make();
    const start = s.state;
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"] });
    s.subtotal("Sheet1", "A1:D9", { by: "Product", columns: ["Qty"], replace: false });
    s.showLevel("Sheet1", "row", 1);
    expect(s.removeSubtotals("Sheet1", "B3")).toBe(7);
    expect(texts(s, 6, "ABCD")).toEqual(["Region|Product|Qty|Amount", "East|Ink|1|$7.00", "East|Pen|2|10", "East|Pen|3|15", "West|Ink|4|20", "West|Pen|5|25"]);
    expect(s.sheet("Sheet1").rows).toBeUndefined();
    expect(s.removeSubtotals("Sheet1", "A1:D6")).toBe(0);
    s.undo();
    expect(s.subtotalRows("Sheet1", "A1:D13").rows.length).toBe(7);
    expect(start).not.toBe(s.state);
  });

  it("puts a page break between the groups, and takes it away again", () => {
    const s = make();
    s.setPageBreak("Sheet1", "row", 1);
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"], pageBreaks: true });
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([1, 5]);
    s.removeSubtotals("Sheet1", "A1:D9");
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([1]);
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"], pageBreaks: true, summaryBelow: false });
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([1, 6]);
    s.subtotal("Sheet1", "A1", { by: "Region", columns: ["Qty"] });
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([1]);
  });

  it("works on the block of data around a cell, and shifts formulas, merges and the rest of the sheet", () => {
    const s = make();
    s.setCell("Sheet1", "F8", "=SUM(C2:C6)+C6");
    s.setCell("Sheet1", "A12", "below");
    s.subtotal("Sheet1", "B3", { by: "A", columns: ["C"] });
    expect(s.cell("Sheet1", "A15")?.v).toBe("below");
    expect(s.display("Sheet1", "A9").text).toBe("Grand Total");
    expect(s.cell("Sheet1", "F11")!.f).toBe("SUM(C2:C7)+C7");
    expect(s.value("Sheet1", "F11")).toBe(26);
  });

  it("counts and labels what the cells show, a blank as (blank), and splits at every change", () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Year", "Sales"], [2024, 1], [2024, 2], [null, 3], [2025, 4], [2024, 5]]);
    s.subtotal("Sheet1", "A1:B6", { by: "Year", columns: ["Sales"] });
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => s.display("Sheet1", `A${r}`).text)).toEqual(["2024", "2024", "2024 Total", "", "(blank) Total", "2025", "2025 Total", "2024", "2024 Total"]);
  });

  it("refuses what it can't do", () => {
    const s = make();
    expect(() => s.subtotal("Sheet1", "A1:D6", { by: "Nope", columns: ["C"] })).toThrow(/no column "Nope"/);
    expect(() => s.subtotal("Sheet1", "A1:D6", { by: "H", columns: ["C"] })).toThrow(/outside the list/);
    expect(() => s.subtotal("Sheet1", "A1:D6", { by: "A", columns: [] })).toThrow(/at least one column/);
    expect(() => s.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"], fn: "median" as never })).toThrow(/sum, count/);
    expect(() => s.subtotal("Sheet1", "A1:D1", { by: "A", columns: ["C"] })).toThrow(/heading row and at least one row/);
    s.mergeCells("Sheet1", "C4:C5");
    expect(() => s.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"] })).toThrow(/merged cells C4:C5 run across/);
    const t = make();
    t.createTable("Sheet1", "A1:D6");
    expect(() => t.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"] })).toThrow(/table/);
    const u = make();
    u.protectSheet("Sheet1", { allow: [] });
    expect(() => u.subtotal("Sheet1", "A1:D6", { by: "A", columns: ["C"] })).toThrow(ProtectionError);
  });

  it("goes seven groups deep and no more", () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["K", "V"], ...Array.from({ length: 6 }, (_, i) => [`k${i}`, i])]);
    s.groupRows("Sheet1", 2, 7);
    for (let i = 0; i < 6; i++) s.groupRows("Sheet1", 2, 7);
    expect(s.outlineDepth("Sheet1", "row")).toBe(7);
    expect(() => s.subtotal("Sheet1", "A1:B7", { by: "K", columns: ["V"], replace: false })).toThrow(/7 deep/);
  });

  it("copes with hundreds of groups", () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["K", "V"], ...Array.from({ length: 900 }, (_, i) => [`g${Math.floor(i / 3)}`, i])]);
    const t = Date.now();
    const r = s.subtotal("Sheet1", "A1:B901", { by: "K", columns: ["V"] });
    expect(r.groups).toBe(300);
    expect(s.value("Sheet1", `B${r.groups * 4 + 2}`)).toBe((899 * 900) / 2);
    expect(Date.now() - t).toBeLessThan(20000);
  });
});

describe("subtotals in files", () => {
  it("are rows of SUBTOTAL formulas with outline levels, and read back as they were", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"] });
    s.subtotal("Sheet1", "A1:D9", { by: "Product", columns: ["Qty"], replace: false });
    s.showLevel("Sheet1", "row", 2);
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(xml).toContain("<f>SUBTOTAL(9,C2:C5)</f>");
    expect(xml).toMatch(/<row r="2" hidden="1" outlineLevel="2"/);
    expect(xml).toContain('outlineLevelRow="2"');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const sheet = back.workbook.sheets[0]!;
    expect(sheet.rows).toEqual(s.sheet("Sheet1").rows);
    expect(sheet.cells["C7"]!.f).toBe("SUBTOTAL(9,C2:C5)");
    const again = new SheetSession(back.workbook);
    expect(again.value("Sheet1", "C13")).toBe(15);
    expect(again.subtotalRows("Sheet1", "A1").rows).toEqual([3, 6, 7, 9, 11, 12, 13]);
    again.removeSubtotals("Sheet1", "A1");
    expect(again.value("Sheet1", "C6")).toBe(5);
  });

  it("keep where the summaries sit and the page breaks, and survive saving as JSON", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Qty"], summaryBelow: false, pageBreaks: true });
    const back = fromXlsx(toXlsx(s.state)).workbook;
    expect(back.sheets[0]!.outline).toEqual({ summaryAbove: true });
    expect(back.sheets[0]!.page?.rowBreaks).toEqual(s.pageSetup("Sheet1").rowBreaks);
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
  });
});
