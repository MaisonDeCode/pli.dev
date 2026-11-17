import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type FilterRule } from "../src";
import { lintPackage } from "./excel-check/lint";

const RULES: Record<string, FilterRule> = {
  "contains": { kind: "custom", a: { op: "contains", value: "pie" } },
  "does not begin with": { kind: "custom", a: { op: "notBeginsWith", value: "app" } },
  "ends with": { kind: "custom", a: { op: "endsWith", value: "ie" } },
  "equals a pattern": { kind: "custom", a: { op: "equals", value: "a*e" } },
  "equals a number": { kind: "custom", a: { op: "equals", value: 25 } },
  "between": { kind: "custom", a: { op: "greaterThanOrEqual", value: 10 }, b: { op: "lessThan", value: 40 } },
  "either": { kind: "custom", a: { op: "lessThan", value: 5 }, b: { op: "greaterThan", value: 30 }, or: true },
  "blank": { kind: "custom", a: { op: "blank" } },
  "not blank": { kind: "custom", a: { op: "notBlank" } },
  "top 3": { kind: "top", n: 3 },
  "bottom 20 percent": { kind: "top", n: 20, bottom: true, percent: true },
  "above average": { kind: "average" },
  "below average": { kind: "average", below: true },
  "this month": { kind: "date", period: "thisMonth" },
  "year to date": { kind: "date", period: "yearToDate" },
  "quarter 2": { kind: "date", period: "q2" },
  "march": { kind: "date", period: "m3" },
  "a fill": { kind: "color", fill: "#ffff00" },
  "no fill": { kind: "color", fill: "none" },
  "a font colour": { kind: "color", font: "#0000ff" },
  "the automatic font colour": { kind: "color", font: "auto" },
};

const make = () => {
  const s = new SheetSession(createWorkbook("F", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Name", "Amount", "Day"], ["Apple pie", 10, 45_000], ["apple tart", 25, 44_999], ["Banana", 7, 45_001], ["Cherry pie", 40, 44_990], ["Pear", null, 44_960], ["Plum pie", 25, 44_600], ["Fig", 3, 45_040]]);
  s.setStyle("Sheet1", "A2:A3", { fill: "#ffff00", color: "#0000ff" });
  return s;
};
const text = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]!);

describe("filters by condition in XLSX files", () => {
  it("writes the filter column the way Excel does", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C8");
    s.filterColumnRule("Sheet1", 1, { kind: "custom", a: { op: "contains", value: "p*e" } });
    s.filterColumnRule("Sheet1", 2, RULES["between"]!);
    s.filterColumnRule("Sheet1", 3, RULES["this month"]!);
    const xml = text(toXlsx(s.state), "xl/worksheets/sheet1.xml");
    expect(xml).toContain('<filterColumn colId="0"><customFilters><customFilter operator="equal" val="*p~*e*"/></customFilters></filterColumn>');
    expect(xml).toContain('<customFilters and="1"><customFilter operator="greaterThanOrEqual" val="10"/><customFilter operator="lessThan" val="40"/></customFilters>');
    expect(xml).toContain('<filterColumn colId="2"><dynamicFilter type="thisMonth"/></filterColumn>');
    s.filterColumnRule("Sheet1", 1, RULES["blank"]!);
    s.filterColumnRule("Sheet1", 2, RULES["bottom 20 percent"]!);
    s.filterColumnRule("Sheet1", 3, RULES["march"]!);
    const again = text(toXlsx(s.state), "xl/worksheets/sheet1.xml");
    expect(again).toContain('<filterColumn colId="0"><filters blank="1"/></filterColumn>');
    expect(again).toContain('<top10 top="0" percent="1" val="20"/>');
    expect(again).toContain('<dynamicFilter type="M3"/>');
    s.filterColumnRule("Sheet1", 1, RULES["not blank"]!);
    expect(text(toXlsx(s.state), "xl/worksheets/sheet1.xml")).toContain('<customFilter operator="notEqual" val=" "/>');
  });

  for (const [label, rule] of Object.entries(RULES)) {
    it(`reads back a sheet filter: ${label}`, () => {
      const s = make();
      s.setFilter("Sheet1", "A1:C8");
      s.filterColumnRule("Sheet1", 2, rule);
      const bytes = toXlsx(s.state);
      expect(lintPackage(bytes)).toEqual([]);
      const back = fromXlsx(bytes);
      expect(back.warnings).toEqual([]);
      expect(back.workbook.sheets[0]!.filter!.columns!["B"]).toEqual(rule);
      // The rows it hid come back hidden.
      expect(back.workbook.sheets[0]!.rows).toEqual(s.state.sheets[0]!.rows);
    });
    it(`reads back a table filter: ${label}`, () => {
      const s = make();
      s.createTable("Sheet1", "A1:C8", { name: "Fruit" });
      s.filterTableRule("Fruit", "Amount", rule);
      const bytes = toXlsx(s.state);
      expect(lintPackage(bytes)).toEqual([]);
      const back = fromXlsx(bytes);
      expect(back.warnings).toEqual([]);
      expect(back.workbook.sheets[0]!.tables![0]!.filters).toEqual({ Amount: rule });
    });
  }

  it("keeps the colours of a colour filter as styles of the file", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C8");
    s.filterColumnRule("Sheet1", 1, { kind: "color", fill: "#ffff00" });
    s.filterColumnRule("Sheet1", 2, { kind: "color", font: "auto" });
    const bytes = toXlsx(s.state);
    const sheet = text(bytes, "xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<filterColumn colId="0"><colorFilter dxfId="\d+"\/>/);
    expect(sheet).toMatch(/<filterColumn colId="1"><colorFilter dxfId="\d+" cellColor="0"\/>/);
    expect(text(bytes, "xl/styles.xml")).toContain('<dxf><font><color auto="1"/></font></dxf>');
  });

  it("reads Excel's own forms of a pattern, a blank test and a list with blanks", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C8");
    const bytes = toXlsx(s.state);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const withCols = (cols: string) => {
      const copy = { ...files, "xl/worksheets/sheet1.xml": new TextEncoder().encode(sheet.replace(/<autoFilter ref="A1:C8"\s*\/>|<autoFilter ref="A1:C8">[\s\S]*?<\/autoFilter>/, `<autoFilter ref="A1:C8">${cols}</autoFilter>`)) };
      return fromXlsx(new Uint8Array(zip(copy))).workbook.sheets[0]!.filter?.columns ?? {};
    };
    expect(withCols('<filterColumn colId="0"><customFilters><customFilter operator="equal" val="*pie"/></customFilters></filterColumn>')["A"]).toEqual({ kind: "custom", a: { op: "endsWith", value: "pie" } });
    expect(withCols('<filterColumn colId="0"><customFilters><customFilter operator="notEqual" val="a*"/></customFilters></filterColumn>')["A"]).toEqual({ kind: "custom", a: { op: "notBeginsWith", value: "a" } });
    expect(withCols('<filterColumn colId="0"><customFilters><customFilter operator="equal" val="a*b*"/></customFilters></filterColumn>')["A"]).toEqual({ kind: "custom", a: { op: "equals", value: "a*b*" } });
    expect(withCols('<filterColumn colId="0"><customFilters><customFilter operator="equal" val="*50~*"/></customFilters></filterColumn>')["A"]).toEqual({ kind: "custom", a: { op: "endsWith", value: "50*" } });
    expect(withCols('<filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="5"/><customFilter operator="lessThan" val="9"/></customFilters></filterColumn>')["B"]).toEqual({ kind: "custom", a: { op: "greaterThan", value: 5 }, b: { op: "lessThan", value: 9 }, or: true });
    expect(withCols('<filterColumn colId="0"><filters blank="1"><filter val="Fig"/></filters></filterColumn>')["A"]).toEqual(["Fig", ""]);
  });

  it("says what it can't keep: dates in another calendar, three comparisons, a colour that isn't in the styles", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C8");
    const files = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const warn = (cols: string) => {
      const copy = { ...files, "xl/worksheets/sheet1.xml": new TextEncoder().encode(sheet.replace(/<autoFilter ref="A1:C8"\s*\/>|<autoFilter ref="A1:C8">[\s\S]*?<\/autoFilter>/, `<autoFilter ref="A1:C8">${cols}</autoFilter>`)) };
      return fromXlsx(new Uint8Array(zip(copy))).warnings.join("\n");
    };
    expect(warn('<filterColumn colId="2"><filters calendarType="hijri"><dateGroupItem year="1444" month="3" dateTimeGrouping="month"/></filters></filterColumn>')).toMatch(/picks dates in the hijri calendar/);
    expect(warn('<filterColumn colId="1"><customFilters><customFilter operator="equal" val="1"/><customFilter operator="equal" val="2"/><customFilter operator="equal" val="3"/></customFilters></filterColumn>')).toMatch(/compares in a way/);
    expect(warn('<filterColumn colId="0"><colorFilter dxfId="99"/></filterColumn>')).toMatch(/colour isn't in the file's styles/);
    expect(warn('<filterColumn colId="2"><dynamicFilter type="nextWeekend"/></filterColumn>')).toMatch(/picks dates by "nextWeekend"/);
  });
});

const zip = (files: Record<string, Uint8Array>) => zipSync(files);
