import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice reads and writes borders, merged cells and conditional formats on its own. A file Pli writes must open there
 * with all of them, and when LibreOffice writes it back (in its own layout) Pli must read the same formatting. Runs only
 * where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-format-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("formatting through LibreOffice", () => {
  it("opens Pli's formatting and writes it back as the same formatting", () => {
    const s = new SheetSession(createWorkbook("format", ["Data"]));
    s.setValues("Data", "A1", [["Item", "Qty", "Note"], ["apple", 5, "x"], ["pear", 12, "y"], ["fig", 7, ""], ["apple", 20, "z"]]);
    s.setBorders("Data", "A1:C5", "all", { style: "thin" });
    s.setBorders("Data", "A1:C1", "bottom", { style: "thick", color: "#cc0000" });
    s.setBorders("Data", "A5:C5", "top", { style: "double" });
    s.setValues("Data", "E1", [["Title"]]);
    s.mergeCells("Data", "E1:G2");
    s.mergeCells("Data", "E4:F4");
    s.addRule("Data", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
    s.addRule("Data", { kind: "text", op: "beginsWith", text: "ap", ranges: ["A2:A5"], style: { italic: true } });
    s.addRule("Data", { kind: "formula", formula: "$B2<8", ranges: ["C2:C5"], style: { fill: "#ddeeff" } });
    s.addRule("Data", { kind: "duplicates", ranges: ["A2:A5"], style: { underline: true } });
    s.addRule("Data", { kind: "top", rank: 2, ranges: ["B2:B5"], style: { fill: "#c6efce" } });
    s.addRule("Data", { kind: "colorScale", ranges: ["B2:B5"], stops: [{ type: "min", color: "#f8696b" }, { type: "percentile", value: 50, color: "#ffeb84" }, { type: "max", color: "#63be7b" }] });
    s.addRule("Data", { kind: "dataBar", ranges: ["B2:B5"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" });
    s.addRule("Data", { kind: "iconSet", set: "3TrafficLights1", ranges: ["B2:B5"], thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const sheet = back.workbook.sheets[0]!;

    expect(sheet.merges?.slice().sort()).toEqual(["E1:G2", "E4:F4"]);
    expect(sheet.cells["E1"]?.v).toBe("Title");
    // Borders: the header's bottom line, the last row's top line, and the thin lines between.
    expect(sheet.cells["B1"]?.s?.border?.bottom).toEqual({ style: "thick", color: "#cc0000" });
    expect(sheet.cells["B5"]?.s?.border?.top).toEqual({ style: "double" });
    expect(sheet.cells["B3"]?.s?.border).toMatchObject({ top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" } });

    const rules = sheet.conditional ?? [];
    const kinds = rules.map((r) => r.kind);
    for (const k of ["cell", "text", "formula", "duplicates", "top", "colorScale", "dataBar", "iconSet"]) expect(kinds, k).toContain(k);
    const cell = rules.find((r) => r.kind === "cell")!;
    expect(cell).toMatchObject({ op: "greaterThan", values: ["10"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
    expect(rules.find((r) => r.kind === "text")).toMatchObject({ op: "beginsWith", text: "ap", style: { italic: true } });
    expect(rules.find((r) => r.kind === "formula")).toMatchObject({ formula: "$B2<8" });
    expect(rules.find((r) => r.kind === "top")).toMatchObject({ rank: 2 });
    expect(rules.find((r) => r.kind === "colorScale")).toMatchObject({ stops: [{ type: "min", color: "#f8696b" }, { type: "percentile", value: 50, color: "#ffeb84" }, { type: "max", color: "#63be7b" }] });
    expect(rules.find((r) => r.kind === "iconSet")).toMatchObject({ set: "3TrafficLights1", thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });
    // And Pli judges the same cells the same way after the trip.
    const t = new SheetSession(back.workbook);
    expect(t.conditionalEffect("Data", "B3")?.style?.fill).toBe("#ffc7ce");
    expect(t.conditionalEffect("Data", "B4")?.style?.fill).toBeUndefined();
  }, 180_000);

  it("reads the formatting of a file LibreOffice made", () => {
    // A workbook typed as Flat ODS-free CSV can't carry formatting, so make one with LibreOffice from Pli's own file and
    // check the layout differences (its own style table order, merged cells listed with covered cells) read cleanly.
    const s = new SheetSession(createWorkbook("format", ["Data"]));
    s.setValues("Data", "A1", [["h1", "h2"], [1, 2], [3, 4]]);
    s.mergeCells("Data", "A1:B1");
    s.setBorders("Data", "A2:B3", "outer", { style: "medium" });
    writeFileSync(join(dir, "g.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "g.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook, warnings } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "g.xlsx"))));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.merges).toEqual(["A1:B1"]);
    expect(workbook.sheets[0]!.cells["A2"]!.s!.border).toMatchObject({ top: { style: "medium" }, left: { style: "medium" } });
  }, 180_000);

  it("opens Pli's data validation and writes it back as the same rules", () => {
    const s = new SheetSession(createWorkbook("valid", ["Data", "Lists"]));
    s.setValues("Lists", "A1", [["red"], ["green"], ["blue"]]);
    s.setValues("Data", "A1", [["Qty", "Colour", "Code"]]);
    s.addValidation("Data", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A2:A9"], alert: "warning", errorTitle: "Hmm", error: "1 to 10", promptTitle: "Qty", prompt: "Whole numbers" });
    s.addValidation("Data", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"] });
    s.addValidation("Data", { kind: "textLength", op: "lessThanOrEqual", values: ["5"], ranges: ["C2:C9"], noBlank: true });
    s.addValidation("Data", { kind: "decimal", op: "greaterThan", values: ["A2"], ranges: ["D2:D9"] });
    s.addValidation("Data", { kind: "custom", formula: "ISNUMBER(E2)", ranges: ["E2:E9"] });
    writeFileSync(join(dir, "v.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "v.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook, warnings } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "v.xlsx"))));
    expect(warnings).toEqual([]);
    const rules = workbook.sheets[0]!.validations ?? [];
    const by = (kind: string) => rules.find((r) => r.kind === kind)!;
    expect(by("whole")).toMatchObject({ op: "between", values: ["1", "10"], alert: "warning", errorTitle: "Hmm", error: "1 to 10", promptTitle: "Qty", prompt: "Whole numbers" });
    expect(by("list")).toMatchObject({ source: "Lists!$A$1:$A$3" });
    expect(by("textLength")).toMatchObject({ op: "lessThanOrEqual", values: ["5"], noBlank: true });
    expect(by("decimal")).toMatchObject({ op: "greaterThan", values: ["A2"] });
    expect(by("custom")).toMatchObject({ formula: "ISNUMBER(E2)" });
    // The same entries are refused after the trip.
    const t = new SheetSession(workbook);
    expect(t.checkEntry("Data", "A3", 11)?.alert).toBe("warning");
    expect(t.checkEntry("Data", "B3", "pink")?.alert).toBe("stop");
    expect(t.checkEntry("Data", "B3", "green")).toBeNull();
  }, 180_000);

  it("opens Pli's tables, works their formulas out the same, and writes them back as tables", () => {
    const s = new SheetSession(createWorkbook("tables", ["Data"]), { now: () => 45000.5 });
    s.setValues("Data", "A1", [["Item", "Qty", "Price", "Total"], ["Pens", 10, 1.5, "=[@Qty]*[@Price]"], ["Paper", 4, 8, "=[@Qty]*[@Price]"], ["Ink", 2, 20, "=[@Qty]*[@Price]"]]);
    s.createTable("Data", "A1:D4", { name: "Orders" });
    s.setTableTotals("Orders", true);
    s.setValues("Data", "F1", [["=SUM(Orders[Qty])"], ["=SUM(Orders[[Qty]:[Price]])"], ["=ROWS(Orders)"], ["=Orders[[#Headers],[Item]]"], ["=INDEX(Orders[Total],2)"]]);
    writeFileSync(join(dir, "t.xlsx"), toXlsx(s.state, { now: () => 45000.5 }));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "t.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "t.xlsx"))));
    const t = new SheetSession(workbook, { now: () => 45000.5 });
    // LibreOffice kept the table, and its numbers agree with ours.
    expect(t.tables("Data").map((x) => [x.name, x.range, !!x.totals])).toEqual([["Orders", "A1:D5", true]]);
    for (const a of ["F1", "F2", "F3", "F4", "F5", "D2", "D5"]) expect(t.value("Data", a), a).toEqual(s.value("Data", a));
  }, 180_000);

  it("opens the Excel 2010 settings Pli writes, and writes them back", () => {
    const s = new SheetSession(createWorkbook("ext", ["Data", "Limits"]));
    s.setValues("Data", "A1", [[5], [-3], [12], [0]]);
    s.setCell("Limits", "A1", 10);
    s.setBorders("Data", "C1", "diagonalDown", { style: "thin", color: "#cc0000" });
    s.addRule("Data", { kind: "dataBar", ranges: ["A1:A4"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", negativeColor: "#ff0000", solid: true, axis: "middle" });
    s.addRule("Data", { kind: "iconSet", set: "3Stars", ranges: ["B1:B4"], thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });
    s.addRule("Data", { kind: "cell", op: "greaterThan", values: ["Limits!$A$1"], ranges: ["D1:D4"], style: { fill: "#ffc7ce", bold: true } });
    s.addRule("Data", { kind: "cell", op: "lessThan", values: ["0"], ranges: ["E1:E4"], style: { fmt: "0.00%", color: "#cc0000" } });
    writeFileSync(join(dir, "x.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "x.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "x.xlsx"))));
    const sheet = workbook.sheets[0]!;
    expect(sheet.cells["C1"]?.s?.border?.diagonalDown).toMatchObject({ style: "thin", color: "#cc0000" });
    const rules = sheet.conditional ?? [];
    const bar = rules.find((r) => r.kind === "dataBar");
    expect(bar).toMatchObject({ color: "#638ec6", negativeColor: "#ff0000", solid: true, axis: "middle" });
    expect(rules.find((r) => r.kind === "iconSet")).toMatchObject({ set: "3Stars" });
    expect(rules.find((r) => r.kind === "cell" && r.ranges[0] === "D1:D4")).toMatchObject({ op: "greaterThan", values: ["Limits!$A$1"], style: { fill: "#ffc7ce", bold: true } });
    expect(rules.find((r) => r.kind === "cell" && r.ranges[0] === "E1:E4")).toMatchObject({ style: { fmt: "0.00%", color: "#cc0000" } });
  }, 180_000);
});
