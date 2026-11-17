import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, validateWorkbook, type ConditionalRule } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Formatting", ["Sheet1", "Sheet2"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Item", "Qty"],
    ["apple", 5],
    ["pear", 12],
    ["fig", 7],
    ["apple", 20],
  ]);
  return s;
};

const border = (s: SheetSession, address: string) => s.cell("Sheet1", address)?.s?.border;
const red = { fill: "#ffc7ce", color: "#9c0006" };

describe("borders", () => {
  it("draws lines around a range and on the cells beside it", () => {
    const s = make();
    s.setBorders("Sheet1", "B2:B4", "outer");
    expect(border(s, "B2")).toEqual({ top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } });
    expect(border(s, "B3")).toEqual({ left: { style: "thin" }, right: { style: "thin" } });
    expect(border(s, "B4")).toEqual({ bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } });
    // The cell below shows the same line from its side; one with nothing in it gets no cell.
    expect(border(s, "B5")).toEqual({ top: { style: "thin" } });
    expect(s.cell("Sheet1", "B1")?.s?.border).toEqual({ bottom: { style: "thin" } });
    expect(s.cell("Sheet1", "C3")?.s?.border).toEqual({ left: { style: "thin" } });
  });

  it("keeps values and styles, and gives each line its own style and colour", () => {
    const s = make();
    s.setStyle("Sheet1", "B2", { bold: true });
    s.setBorders("Sheet1", "B2", "bottom", { style: "thick", color: "#FF0000" });
    expect(s.cell("Sheet1", "B2")).toEqual({ v: 5, s: { bold: true, border: { bottom: { style: "thick", color: "#ff0000" } } } });
    s.setBorders("Sheet1", "B2", "left", { style: "double" });
    expect(border(s, "B2")).toEqual({ bottom: { style: "thick", color: "#ff0000" }, left: { style: "double" } });
  });

  it("draws the lines between cells and every line at once", () => {
    const s = make();
    s.setBorders("Sheet1", "A2:B3", "horizontal");
    expect(border(s, "A2")).toEqual({ bottom: { style: "thin" } });
    expect(border(s, "A3")).toEqual({ top: { style: "thin" } });
    s.setBorders("Sheet1", "A2:B3", "all");
    expect(border(s, "B3")).toEqual({ top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } });
    expect(border(s, "A2")).toMatchObject({ right: { style: "thin" } });
  });

  it("takes lines away, and leaves no empty cells behind", () => {
    const s = make();
    s.setBorders("Sheet1", "D1:E2", "all");
    expect(Object.keys(s.state.sheets[0]!.cells).filter((k) => /^[DE]/.test(k)).length).toBeGreaterThan(0);
    s.setBorders("Sheet1", "D1:E2", "none");
    expect(Object.keys(s.state.sheets[0]!.cells).filter((k) => /^[DE]/.test(k))).toEqual([]);
    s.setBorders("Sheet1", "B2:B3", "outer");
    s.setBorders("Sheet1", "B2:B3", "top", null);
    expect(border(s, "B2")).toEqual({ left: { style: "thin" }, right: { style: "thin" } });
    expect(border(s, "B1")).toBeUndefined();
  });

  it("is one undo step", () => {
    const s = make();
    const before = s.state;
    s.setBorders("Sheet1", "A1:B5", "all");
    expect(s.undo()).toBe(true);
    expect(s.state.sheets[0]).toEqual(before.sheets[0]);
  });

  it("refuses a style that doesn't exist", () => {
    const s = make();
    expect(() => s.setBorders("Sheet1", "A1", "all", { style: "wavy" as never })).toThrow(/border style/);
    expect(() => s.setBorders("Sheet1", "A1", "all", { style: "thin", color: "red" })).toThrow(/colour/);
  });

  it("is checked when a workbook is read", () => {
    const s = make();
    s.setBorders("Sheet1", "A1:B2", "outer", { style: "medium", color: "#336699" });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].cells.A1.s.border.top.style = "wavy";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/style/);
  });
});

describe("merged cells", () => {
  it("shows the top-left cell over the range and empties the others", () => {
    const s = make();
    s.mergeCells("Sheet1", "A2:B3");
    expect(s.merges("Sheet1")).toEqual(["A2:B3"]);
    expect(s.mergeAt("Sheet1", "B3")).toBe("A2:B3");
    expect(s.mergeAt("Sheet1", "A4")).toBeNull();
    expect(s.cell("Sheet1", "A2")?.v).toBe("apple");
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.cell("Sheet1", "A3")).toBeUndefined();
  });

  it("keeps the formats of the cells it empties", () => {
    const s = make();
    s.setStyle("Sheet1", "B2", { fill: "#ffff00" });
    s.mergeCells("Sheet1", "A2:B2");
    expect(s.cell("Sheet1", "B2")).toEqual({ s: { fill: "#ffff00" } });
  });

  it("merges each row on its own across a range", () => {
    const s = make();
    s.mergeCells("Sheet1", "A2:C4", { across: true });
    expect(s.merges("Sheet1")).toEqual(["A2:C2", "A3:C3", "A4:C4"]);
  });

  it("does nothing for a single cell, and unmerges what the new range touches", () => {
    const s = make();
    s.mergeCells("Sheet1", "A2");
    expect(s.merges("Sheet1")).toEqual([]);
    s.mergeCells("Sheet1", "A1:B1");
    s.mergeCells("Sheet1", "B1:C2");
    expect(s.merges("Sheet1")).toEqual(["B1:C2"]);
  });

  it("unmerges every range a selection touches", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B1");
    s.mergeCells("Sheet1", "A3:B3");
    s.unmergeCells("Sheet1", "A1:A3");
    expect(s.merges("Sheet1")).toEqual([]);
  });

  it("is one undo step, with the emptied cells back", () => {
    const s = make();
    const before = s.state.sheets[0]!;
    s.mergeCells("Sheet1", "A2:B3");
    s.undo();
    expect(s.state.sheets[0]).toEqual(before);
    s.redo();
    expect(s.merges("Sheet1")).toEqual(["A2:B3"]);
  });

  it("doesn't let the operations overlap", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B2");
    expect(() => s.transact([{ type: "add_merge", sheet: s.sheet("Sheet1").id, range: "B2:C3" }])).toThrow(/already merged/);
    expect(() => s.transact([{ type: "add_merge", sheet: s.sheet("Sheet1").id, range: "D1" }])).toThrow(/two or more/);
    expect(() => s.transact([{ type: "remove_merge", sheet: s.sheet("Sheet1").id, range: "A1:C2" }])).toThrow(/isn't merged/);
  });

  it("grows, shrinks and moves with inserted and deleted rows and columns", () => {
    const s = make();
    s.mergeCells("Sheet1", "B2:D4");
    s.insertRows("Sheet1", 1);
    expect(s.merges("Sheet1")).toEqual(["B3:D5"]);
    s.insertRows("Sheet1", 4); // inside it
    expect(s.merges("Sheet1")).toEqual(["B3:D6"]);
    s.deleteColumns("Sheet1", 3);
    expect(s.merges("Sheet1")).toEqual(["B3:C6"]);
    s.deleteColumns("Sheet1", 3);
    expect(s.merges("Sheet1")).toEqual(["B3:B6"]);
    s.deleteRows("Sheet1", 4, 3);
    expect(s.merges("Sheet1")).toEqual([]); // one cell left is no longer a merge
    s.undo();
    expect(s.merges("Sheet1")).toEqual(["B3:B6"]);
  });

  it("goes along with copied and moved cells", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B1");
    s.copy({ sheet: "Sheet1", range: "A1:B2" }, { sheet: "Sheet1", at: "D1" });
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "D1:E1"]);
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet2", at: "A5" });
    expect(s.merges("Sheet2")).toEqual(["A5:B5"]);
    s.move({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "A8" });
    expect(s.merges("Sheet1")).toEqual(["D1:E1", "A8:B8"]);
  });

  it("can't be sorted", () => {
    const s = make();
    s.mergeCells("Sheet1", "A3:B3");
    expect(() => s.sort("Sheet1", "A2:B5")).toThrow(/merged/);
  });

  it("is checked when a workbook is read", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B2");
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].merges = ["A1:B2", "B2:C3"];
    expect(() => validateWorkbook(wb)).toThrow(/overlaps/);
    wb.sheets[0].merges = ["A1"];
    expect(() => validateWorkbook(wb)).toThrow(/two or more/);
  });
});

const effect = (s: SheetSession, address: string) => s.conditionalEffect("Sheet1", address);

describe("conditional formats", () => {
  it("styles cells by comparing them", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: red });
    expect(effect(s, "B2")).toBeUndefined();
    expect(effect(s, "B3")?.style).toEqual(red);
    expect(effect(s, "B5")?.style).toEqual(red);
    expect(effect(s, "A3")).toBeUndefined(); // outside the range
    s.setCell("Sheet1", "B2", 99); // follows the cells
    expect(effect(s, "B2")?.style).toEqual(red);
  });

  it("compares with a cell, between two values, and with text", () => {
    const s = make();
    s.setCell("Sheet1", "D1", 7);
    s.addRule("Sheet1", { kind: "cell", op: "equal", values: ["$D$1"], ranges: ["B2:B5"], style: red });
    expect(effect(s, "B4")?.style).toEqual(red);
    expect(effect(s, "B3")).toBeUndefined();
    s.addRule("Sheet1", { kind: "cell", op: "between", values: ["6", "13"], ranges: ["B2:B5"], style: { bold: true } });
    expect(effect(s, "B3")?.style).toEqual({ bold: true });
    expect(effect(s, "B2")).toBeUndefined();
    s.addRule("Sheet1", { kind: "cell", op: "equal", values: ['"pear"'], ranges: ["A2:A5"], style: { italic: true } });
    expect(effect(s, "A3")?.style).toEqual({ italic: true }); // text compares without regard to capitals
  });

  it("matches text, blanks and errors", () => {
    const s = make();
    s.setCell("Sheet1", "A6", "=1/0");
    s.addRule("Sheet1", { kind: "text", op: "beginsWith", text: "AP", ranges: ["A2:A5"], style: { bold: true } });
    s.addRule("Sheet1", { kind: "text", op: "contains", text: "e", ranges: ["A2:A5"], style: { italic: true } });
    s.addRule("Sheet1", { kind: "errors", ranges: ["A6"], style: { color: "#ff0000" } });
    s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C3"], style: { fill: "#eeeeee" } });
    expect(effect(s, "A2")?.style).toEqual({ bold: true, italic: true });
    expect(effect(s, "A4")).toBeUndefined();
    expect(effect(s, "A6")?.style).toEqual({ color: "#ff0000" });
    expect(effect(s, "C2")?.style).toEqual({ fill: "#eeeeee" });
  });

  it("formulas are relative to the top-left cell of the range", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "formula", formula: "$B2>10", ranges: ["A2:B5"], style: red });
    expect(effect(s, "A3")?.style).toEqual(red); // the row's B value is 12
    expect(effect(s, "B3")?.style).toEqual(red);
    expect(effect(s, "A4")).toBeUndefined();
    expect(effect(s, "A5")?.style).toEqual(red);
  });

  it("finds duplicates and unique values, the highest and lowest, and above average", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "duplicates", ranges: ["A2:A5"], style: { bold: true } });
    expect(effect(s, "A2")?.style).toEqual({ bold: true });
    expect(effect(s, "A3")).toBeUndefined();
    s.addRule("Sheet1", { kind: "uniques", ranges: ["A2:A5"], style: { italic: true } });
    expect(effect(s, "A3")?.style).toEqual({ italic: true });
    s.addRule("Sheet1", { kind: "top", rank: 2, ranges: ["B2:B5"], style: { fill: "#00ff00" } });
    expect([2, 3, 4, 5].map((r) => !!effect(s, `B${r}`)?.style?.fill)).toEqual([false, true, false, true]);
    s.addRule("Sheet1", { kind: "top", rank: 25, percent: true, bottom: true, ranges: ["B2:B5"], style: { fill: "#ff0000" } });
    expect(effect(s, "B2")?.style?.fill).toBe("#ff0000");
    s.addRule("Sheet1", { kind: "average", above: true, ranges: ["B2:B5"], style: { underline: true } });
    expect([2, 3, 4, 5].map((r) => !!effect(s, `B${r}`)?.style?.underline)).toEqual([false, true, false, true]);
  });

  it("matches dates by their place around today", () => {
    const s = make();
    // today is serial 45000 (the clock says 45000.5)
    s.setValues("Sheet1", "D1", [[44_999], [45_000], [45_001], [44_990]]);
    s.addRule("Sheet1", { kind: "dates", period: "today", ranges: ["D1:D4"], style: { bold: true } });
    s.addRule("Sheet1", { kind: "dates", period: "yesterday", ranges: ["D1:D4"], style: { italic: true } });
    s.addRule("Sheet1", { kind: "dates", period: "last7Days", ranges: ["D1:D4"], style: { underline: true } });
    expect(effect(s, "D1")?.style).toEqual({ italic: true, underline: true });
    expect(effect(s, "D2")?.style).toEqual({ bold: true, underline: true });
    expect(effect(s, "D3")).toBeUndefined();
    expect(effect(s, "D4")).toBeUndefined();
  });

  it("lets the first rule decide, and stops when asked", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { fill: "#111111", bold: true } });
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["0"], ranges: ["B2:B5"], style: { fill: "#222222", italic: true } });
    expect(effect(s, "B3")?.style).toEqual({ fill: "#111111", bold: true, italic: true });
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { color: "#333333" }, stop: true }, 0);
    expect(effect(s, "B3")?.style).toEqual({ color: "#333333" });
    expect(effect(s, "B2")?.style).toEqual({ fill: "#222222", italic: true });
  });

  it("makes colour scales, bars and icons from where a value stands", () => {
    const s = make();
    s.addRule("Sheet1", {
      kind: "colorScale",
      ranges: ["B2:B5"],
      stops: [
        { type: "min", color: "#000000" },
        { type: "max", color: "#ffffff" },
      ],
    });
    expect(effect(s, "B2")?.scale).toBe("#000000");
    expect(effect(s, "B5")?.scale).toBe("#ffffff");
    expect(effect(s, "B3")?.scale).toBe("#777777"); // 12 is 7/15 of the way from 5 to 20
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["B2:B5"], min: { type: "num", value: 0 }, max: { type: "num", value: 20 }, color: "#638ec6" });
    expect(effect(s, "B3")?.bar).toEqual({ from: 0, to: 0.6, color: "#638ec6" });
    s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["B2:B5"], thresholds: [{ type: "num", value: 8 }, { type: "num", value: 15 }] });
    expect([2, 3, 4, 5].map((r) => effect(s, `B${r}`)?.icon?.index)).toEqual([0, 1, 0, 2]);
    expect(effect(s, "B3")?.icon).toEqual({ set: "3Arrows", index: 1, count: 3 });
  });

  it("draws bars from zero when values go below it, and reverses and hides icons", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [[-10], [0], [10]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["D1:D3"], min: { type: "min" }, max: { type: "max" }, color: "#ff0000", hideValue: true });
    expect(effect(s, "D1")?.bar).toEqual({ from: 0, to: 0.5, color: "#ff0000", axis: 0.5 });
    expect(effect(s, "D3")?.bar).toEqual({ from: 0.5, to: 1, color: "#ff0000", axis: 0.5 });
    expect(effect(s, "D3")?.hideText).toBe(true);
    s.addRule("Sheet1", { kind: "iconSet", set: "3Flags", ranges: ["D1:D3"], reverse: true, thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });
    expect(effect(s, "D1")?.icon?.index).toBe(2);
    expect(effect(s, "D3")?.icon?.index).toBe(0);
  });

  it("ignores cells that aren't numbers for scales, bars and icons", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "colorScale", ranges: ["A1:B5"], stops: [{ type: "min", color: "#000000" }, { type: "max", color: "#ffffff" }] });
    expect(effect(s, "A2")).toBeUndefined();
    expect(effect(s, "B2")?.scale).toBe("#000000");
  });

  it("follows inserted rows and renamed sheets, and goes with the cells it covers", () => {
    const s = make();
    s.setCell("Sheet2", "A1", 10);
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["Sheet2!$A$1"], ranges: ["B2:B5"], style: red });
    s.insertRows("Sheet1", 1);
    expect(s.conditionalFormats("Sheet1")[0]!.ranges).toEqual(["B3:B6"]);
    expect(effect(s, "B4")?.style).toEqual(red);
    s.insertRows("Sheet2", 1);
    expect((s.conditionalFormats("Sheet1")[0] as { values: string[] }).values).toEqual(["Sheet2!$A$2"]);
    s.renameSheet("Sheet2", "Limits");
    expect((s.conditionalFormats("Sheet1")[0] as { values: string[] }).values).toEqual(["Limits!$A$2"]);
    s.deleteRows("Sheet1", 3, 4);
    expect(s.conditionalFormats("Sheet1")).toEqual([]); // every cell it covered is gone
  });

  it("can be changed, ordered and taken away, with undo", () => {
    const s = make();
    const a = s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C9"], style: { bold: true } });
    const b = s.addRule("Sheet1", { kind: "noBlanks", ranges: ["A1:A9"], style: { italic: true } });
    s.moveRule("Sheet1", b.id, 0);
    expect(s.conditionalFormats("Sheet1").map((r) => r.id)).toEqual([b.id, a.id]);
    s.updateRule("Sheet1", { ...a, ranges: ["C1:C3"] } as ConditionalRule);
    expect(s.conditionalFormats("Sheet1")[1]!.ranges).toEqual(["C1:C3"]);
    s.clearRules("Sheet1", "A1:A9");
    expect(s.conditionalFormats("Sheet1").map((r) => r.id)).toEqual([a.id]);
    s.deleteRule("Sheet1", a.id);
    expect(s.conditionalFormats("Sheet1")).toEqual([]);
    s.undo();
    s.undo();
    expect(s.conditionalFormats("Sheet1").map((r) => r.id)).toEqual([b.id, a.id]);
    expect(effect(s, "C5")?.style).toBeUndefined(); // the rule was cut back to C1:C3
    expect(effect(s, "C2")?.style).toEqual({ bold: true });
  });

  it("clears the part of a rule that is inside the range", () => {
    const s = make();
    const r = s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C3", "E1:E3"], style: { bold: true } });
    s.clearRules("Sheet1", "C1:C9");
    expect(s.conditionalFormats("Sheet1")[0]).toMatchObject({ id: r.id, ranges: ["E1:E3"] });
  });

  it("refuses rules that make no sense", () => {
    const s = make();
    const add = (rule: object) => () => s.addRule("Sheet1", { ranges: ["A1:A3"], style: {}, ...rule } as never);
    expect(add({ kind: "cell", op: "between", values: ["1"] })).toThrow(/two values/);
    expect(add({ kind: "cell", op: "greaterThan", values: ["1+"] })).toThrow(/formula/);
    expect(add({ kind: "text", op: "contains", text: "" })).toThrow(/text/);
    expect(add({ kind: "top", rank: 0 })).toThrow(/top/);
    expect(add({ kind: "cell", op: "equal", values: ["1"], ranges: ["nonsense"] })).toThrow(/range/);
    expect(add({ kind: "cell", op: "equal", values: ["1"], style: { fill: "red" } })).toThrow(/fill/);
    expect(add({ kind: "colorScale", stops: [{ type: "min", color: "#000000" }] })).toThrow(/two or three/);
    expect(add({ kind: "iconSet", set: "3Arrows", thresholds: [{ type: "num", value: 1 }] })).toThrow(/steps/);
    expect(add({ kind: "dates", period: "someday" })).toThrow(/period/);
  });

  it("is kept in a saved workbook and checked when read", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { fill: "#ffc7ce", border: { bottom: { style: "thin", color: "#ff0000" } } } });
    s.addRule("Sheet1", { kind: "iconSet", set: "4Rating", ranges: ["B2:B5"], thresholds: [{ type: "percent", value: 25 }, { type: "percent", value: 50, gte: false }, { type: "formula", value: "$B$1" }], reverse: true });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].conditional[0].colour = "red";
    expect(() => validateWorkbook(wb)).toThrow(/unknown field/);
  });
});

const parts = (data: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(data)).map(([k, v]) => [k, strFromU8(v)]));

describe("formatting in XLSX files", () => {
  it("writes borders, merges and conditional formats where Excel looks for them", () => {
    const s = make();
    s.setBorders("Sheet1", "A1:B1", "outer", { style: "medium", color: "#336699" });
    s.mergeCells("Sheet1", "D1:F1");
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true, border: { bottom: { style: "thin" } } } });
    const files = parts(toXlsx(s.state));
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<mergeCells count="1"><mergeCell ref="D1:F1"/></mergeCells>');
    expect(sheet).toContain('<conditionalFormatting sqref="B2:B5"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>');
    // Parts come in the order the format wants them.
    expect(sheet.indexOf("</sheetData>")).toBeLessThan(sheet.indexOf("<mergeCells"));
    expect(sheet.indexOf("<mergeCells")).toBeLessThan(sheet.indexOf("<conditionalFormatting"));
    const styles = files["xl/styles.xml"]!;
    expect(styles).toContain('<left style="medium"><color rgb="FF336699"/></left>');
    expect(styles).toContain('<dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor rgb="FFFFC7CE"/></patternFill></fill><border>');
    expect(styles).toMatch(/applyBorder="1"/);
  });

  it("reads back what it wrote", () => {
    const s = make();
    s.setBorders("Sheet1", "A1:B5", "all", { style: "thin" });
    s.setBorders("Sheet1", "A1:B1", "bottom", { style: "double", color: "#ff0000" });
    s.mergeCells("Sheet1", "D1:F2");
    const rules: ConditionalRule[] = [
      s.addRule("Sheet1", { kind: "cell", op: "between", values: ["5", "$D$9"], ranges: ["B2:B5", "D2:D5"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true, italic: true, underline: true, strike: true, border: { top: { style: "dashed", color: "#00ff00" } } }, stop: true }),
      s.addRule("Sheet1", { kind: "text", op: "notContains", text: 'a "b"', ranges: ["A2:A5"], style: { italic: true } }),
      s.addRule("Sheet1", { kind: "formula", formula: "AND($B2>5,MOD(ROW(),2)=0)", ranges: ["A2:B5"], style: { fill: "#eeeeee" } }),
      s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C5"], style: { fill: "#dddddd" } }),
      s.addRule("Sheet1", { kind: "noBlanks", ranges: ["C1:C5"], style: { bold: true } }),
      s.addRule("Sheet1", { kind: "errors", ranges: ["C1:C5"], style: { color: "#ff0000" } }),
      s.addRule("Sheet1", { kind: "noErrors", ranges: ["C1:C5"], style: { color: "#00ff00" } }),
      s.addRule("Sheet1", { kind: "duplicates", ranges: ["A2:A5"], style: { bold: true } }),
      s.addRule("Sheet1", { kind: "uniques", ranges: ["A2:A5"], style: { italic: true } }),
      s.addRule("Sheet1", { kind: "top", rank: 10, percent: true, bottom: true, ranges: ["B2:B5"], style: { fill: "#00ff00" } }),
      s.addRule("Sheet1", { kind: "average", above: false, equal: true, stdDev: 2, ranges: ["B2:B5"], style: { fill: "#0000ff" } }),
      s.addRule("Sheet1", { kind: "dates", period: "nextWeek", ranges: ["D1:D9"], style: { bold: true } }),
      s.addRule("Sheet1", { kind: "colorScale", ranges: ["B2:B5"], stops: [{ type: "min", color: "#f8696b" }, { type: "percentile", value: 50, color: "#ffeb84" }, { type: "formula", value: "$B$1", color: "#63be7b" }] }),
      s.addRule("Sheet1", { kind: "dataBar", ranges: ["B2:B5"], min: { type: "num", value: 0 }, max: { type: "percent", value: 90 }, color: "#638ec6", hideValue: true }),
      s.addRule("Sheet1", { kind: "iconSet", set: "5Quarters", ranges: ["B2:B5"], thresholds: [{ type: "percent", value: 20 }, { type: "percent", value: 40, gte: false }, { type: "num", value: 60 }, { type: "percentile", value: 80 }], reverse: true, hideValue: true }),
    ];
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const back = workbook.sheets[0]!;
    expect(back.merges).toEqual(["D1:F2"]);
    expect(back.cells["A1"]!.s!.border).toEqual(s.cell("Sheet1", "A1")!.s!.border);
    expect(back.cells["B5"]!.s!.border).toEqual(s.cell("Sheet1", "B5")!.s!.border);
    // Rules come back in order and with the same content (ids are new).
    const strip = (r: ConditionalRule) => ({ ...r, id: "" });
    expect(back.conditional!.map(strip)).toEqual(rules.map(strip));
  });

  it("keeps the order of rules by their priority", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C5"], style: { bold: true } });
    s.addRule("Sheet1", { kind: "noBlanks", ranges: ["A1:A5"], style: { italic: true } });
    s.moveRule("Sheet1", s.conditionalFormats("Sheet1")[1]!.id, 0);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.conditional!.map((r) => r.kind)).toEqual(["noBlanks", "blanks"]);
  });

  it("reads a file made by Excel: theme colours, tints, priorities and what it can't keep", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" s="1"><v>1</v></c><c r="B1" s="2"><v>2</v></c><c r="C1"><v>5</v></c></row>
        <row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c><c r="C2"><v>6</v></c></row>
      </sheetData>
      <mergeCells count="3"><mergeCell ref="A5:C5"/><mergeCell ref="B5:D6"/><mergeCell ref="E1"/></mergeCells>
      <conditionalFormatting sqref="A1:A2 C1:C2">
        <cfRule type="expression" dxfId="1" priority="3" stopIfTrue="1"><formula>$A1&gt;2</formula></cfRule>
        <cfRule type="top10" dxfId="0" priority="2" rank="1"/>
        <cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>_xlfn.IFNA(1,2)</formula></cfRule>
      </conditionalFormatting>
      <conditionalFormatting sqref="B1:B2">
        <cfRule type="iconSet" priority="4"><iconSet iconSet="3Triangles"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule>
        <cfRule type="dataBar" priority="5"><dataBar><cfvo type="min"/><cfvo type="max"/><color theme="4"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{AAAA}</x14:id></ext></extLst></cfRule>
      </conditionalFormatting>
      <extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings>
        <x14:conditionalFormatting><x14:cfRule type="dataBar" id="{AAAA}"/></x14:conditionalFormatting>
        <x14:conditionalFormatting><x14:cfRule type="expression" id="{BBBB}"/></x14:conditionalFormatting>
      </x14:conditionalFormattings></ext></extLst>
    </worksheet>`;
    const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/></patternFill></fill></fills>
      <borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>
        <border><left style="thin"><color indexed="64"/></left><right style="mediumDashed"><color rgb="FFFF0000"/></right><top style="thin"><color theme="1"/></top><bottom style="thick"><color auto="1"/></bottom><diagonal/></border>
        <border><left/><right/><top/><bottom style="hair"><color theme="0" tint="-0.499984740745262"/></bottom><diagonal/></border></borders>
      <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="2"/></cellXfs>
      <dxfs count="2">
        <dxf><font><b val="1"/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
        <dxf><font><i/><u/></font><border><left style="thin"><color auto="1"/></left><right/><top/><bottom/></border></dxf>
      </dxfs></styleSheet>`;
    const book = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
    const { workbook, warnings } = fromXlsx(zipSync({ "xl/workbook.xml": strToU8(book), "xl/_rels/workbook.xml.rels": strToU8(rels), "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/styles.xml": strToU8(styles) }));
    const s = new SheetSession(workbook);
    // Theme 4 is the Office accent blue, lightened.
    expect(s.cell("Data", "A1")!.s!.fill).toBe("#d9e1f2");
    expect(s.cell("Data", "A1")!.s!.border).toEqual({ left: { style: "thin" }, right: { style: "dashed", color: "#ff0000" }, top: { style: "thin" }, bottom: { style: "thick" } });
    expect(s.cell("Data", "B1")!.s!.border).toEqual({ bottom: { style: "hair", color: "#7f7f7f" } });
    expect(s.merges("Data")).toEqual(["A5:C5"]); // the overlapping one and the single cell are left out
    const rules = s.conditionalFormats("Data");
    expect(rules.map((r) => r.kind)).toEqual(["cell", "top", "formula", "iconSet", "dataBar"]); // by priority (3Triangles is read now)
    expect(rules[0]).toMatchObject({ kind: "cell", values: ["IFNA(1,2)"], ranges: ["A1:A2", "C1:C2"], style: { bold: true, color: "#9c0006", fill: "#ffc7ce" } });
    expect(rules[2]).toMatchObject({ kind: "formula", formula: "$A1>2", stop: true, style: { italic: true, underline: true, border: { left: { style: "thin" } } } });
    expect(rules[3]).toMatchObject({ kind: "iconSet", set: "3Triangles" });
    expect(rules[4]).toMatchObject({ kind: "dataBar", color: "#4472c4", minLength: 10, maxLength: 90 }); // the older form's bars run from 10% to 90%
    expect(warnings.join("\n")).toMatch(/Some merged ranges overlap/);
    expect(warnings.join("\n")).toMatch(/conditional formatting rules are of a kind/);
  });
});

describe("hidden and coloured sheets", () => {
  const three = () => new SheetSession(createWorkbook("t", ["One", "Two", "Three"]));

  it("hides sheets and shows them again, one undo step each", () => {
    const s = three();
    s.hideSheets(["Two", "Three"]);
    expect(s.state.sheets.map((x) => !!x.hidden)).toEqual([false, true, true]);
    s.undo();
    expect(s.state.sheets.some((x) => x.hidden)).toBe(false);
    s.hideSheets(["Two"]);
    s.hideSheets(["Two"], false);
    expect(s.sheet("Two").hidden).toBeUndefined();
  });

  it("keeps a sheet that is shown", () => {
    const s = three();
    s.hideSheets(["One", "Two"]);
    expect(() => s.hideSheets(["Three"])).toThrow(/isn't hidden/);
    expect(() => s.deleteSheet("Three")).toThrow(/isn't hidden/);
    expect(() => s.deleteSheets(["Three", "One", "Two"])).toThrow();
    expect(s.state.sheets).toHaveLength(3); // a failed step changes nothing
  });

  it("deletes several sheets in one step", () => {
    const s = three();
    s.setCell("One", "A1", "=Two!A1");
    s.deleteSheets(["Two", "Three"]);
    expect(s.state.sheets.map((x) => x.name)).toEqual(["One"]);
    s.undo();
    expect(s.state.sheets.map((x) => x.name)).toEqual(["One", "Two", "Three"]);
  });

  it("colours a tab", () => {
    const s = three();
    s.setTabColor("Two", "#1a56db");
    expect(s.sheet("Two").tabColor).toBe("#1a56db");
    s.setTabColor("Two", null);
    expect(s.sheet("Two").tabColor).toBeUndefined();
  });

  it("is checked when a workbook is read", () => {
    const s = three();
    s.hideSheets(["Two"]);
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    for (const x of wb.sheets) x.hidden = true;
    expect(() => validateWorkbook(wb)).toThrow(/isn't hidden/);
  });

  it("goes through an XLSX file", () => {
    const s = three();
    s.hideSheets(["Two"]);
    s.setTabColor("One", "#ff0000");
    s.setTabColor("Three", "#336699");
    const files = parts(toXlsx(s.state));
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Two" sheetId="2" state="hidden" r:id="rId2"/>');
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets.map((x) => [x.name, !!x.hidden, x.tabColor])).toEqual([["One", false, "#ff0000"], ["Two", true, undefined], ["Three", false, "#336699"]]);
  });
});
