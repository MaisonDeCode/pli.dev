import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, groupKey, parseWorkbook, periodEnd, periodStart, periodsBetween, rangeGroups, serializeWorkbook, toXlsx } from "../src";
import { dateSerial } from "../src/values";

const D = (y: number, m: number, d: number) => dateSerial(y, m, d)!;
const make = () => {
  const s = new SheetSession(createWorkbook("Timelines", ["Sheet1", "Other"]), { now: () => D(2023, 6, 1) });
  s.setValues("Sheet1", "A1", [
    ["Order", "Day", "Qty"],
    ["a", D(2022, 11, 20), 1],
    ["b", D(2023, 1, 5), 2],
    ["c", D(2023, 1, 31), 3],
    ["d", D(2023, 3, 15), 4],
    ["e", D(2023, 3, 16), 5],
    ["f", D(2023, 6, 30), 6],
    ["g", "n/a", 7],
  ]);
  s.setFormat("Sheet1", "B2:B8", "yyyy-mm-dd");
  s.createTable("Sheet1", "A1:C8", { name: "Orders" });
  return s;
};
const shown = (s: SheetSession) => {
  const out: string[] = [];
  for (let r = 2; r <= 8; r++) if (!s.sheet("Sheet1").rows?.[String(r)]?.hidden) out.push(String(s.value("Sheet1", `A${r}`)));
  return out;
};

describe("periods", () => {
  it("start and end at the edges of years, quarters, months and days", () => {
    expect([periodStart("years", D(2023, 5, 17)), periodEnd("years", D(2023, 5, 17))]).toEqual([D(2023, 1, 1), D(2023, 12, 31)]);
    expect([periodStart("quarters", D(2023, 5, 17)), periodEnd("quarters", D(2023, 5, 17))]).toEqual([D(2023, 4, 1), D(2023, 6, 30)]);
    expect([periodStart("months", D(2024, 2, 17)), periodEnd("months", D(2024, 2, 17))]).toEqual([D(2024, 2, 1), D(2024, 2, 29)]);
    expect([periodStart("days", D(2024, 2, 17) + 0.6), periodEnd("days", D(2024, 2, 17))]).toEqual([D(2024, 2, 17), D(2024, 2, 17)]);
    expect(periodsBetween("quarters", D(2022, 11, 20), D(2023, 2, 1)).map((p) => `${p.parent} ${p.label}`)).toEqual(["2022 Q4", "2023 Q1"]);
    expect(periodsBetween("days", D(2023, 1, 30), D(2023, 2, 2)).map((p) => `${p.parent} ${p.label}`)).toEqual(["Jan 2023 30", "Jan 2023 31", "Feb 2023 1", "Feb 2023 2"]);
  });

  it("make picks of dates, joined into whole months and years where the range holds them", () => {
    expect(rangeGroups("months", D(2023, 1, 20), D(2023, 3, 3))).toEqual([{ by: "month", year: 2023, month: 1 }, { by: "month", year: 2023, month: 2 }, { by: "month", year: 2023, month: 3 }]);
    expect(rangeGroups("years", D(2022, 5, 5), D(2023, 5, 5))).toEqual([{ by: "year", year: 2022 }, { by: "year", year: 2023 }]);
    expect(rangeGroups("quarters", D(2023, 1, 1), D(2023, 12, 31))).toEqual([{ by: "year", year: 2023 }]);
    expect(rangeGroups("days", D(2023, 1, 30), D(2023, 3, 1))).toEqual([{ by: "day", year: 2023, month: 1, day: 30 }, { by: "day", year: 2023, month: 1, day: 31 }, { by: "month", year: 2023, month: 2 }, { by: "day", year: 2023, month: 3, day: 1 }]);
  });
});

describe("a timeline on a table", () => {
  it("is put beside the table, has the table's date column, and lays out the periods of the data", () => {
    const s = make();
    const t = s.addTimeline("Sheet1", { table: "Orders", column: "Day" });
    expect(t).toMatchObject({ column: "Day", level: "months", from: { row: 1, col: 5 } });
    expect(t.table).toBe(s.tables("Sheet1")[0]!.id);
    const info = s.timelineInfo(t.id);
    expect(info.bounds).toEqual({ start: D(2022, 11, 20), end: D(2023, 6, 30) });
    expect(info.periods.map((p) => `${p.parent} ${p.label}:${p.count}`)).toEqual(["2022 Nov:1", "2022 Dec:0", "2023 Jan:2", "2023 Feb:0", "2023 Mar:2", "2023 Apr:0", "2023 May:0", "2023 Jun:1"]);
    expect(info.selection).toBeNull();
    expect(info.periods.every((p) => p.selected)).toBe(true);
  });

  it("picks a range by filtering the table's own column, hides the other rows, and is one undo step", () => {
    const s = make();
    const t = s.addTimeline("Sheet1", { table: "Orders", column: "Day" });
    s.timelineSelect(t.id, { start: D(2023, 1, 15), end: D(2023, 3, 2) });
    expect(s.tables("Sheet1")[0]!.filters).toEqual({
      Day: { kind: "dateGroups", groups: [{ by: "month", year: 2023, month: 1 }, { by: "month", year: 2023, month: 2 }, { by: "month", year: 2023, month: 3 }] },
    });
    expect(shown(s)).toEqual(["b", "c", "d", "e"]); // the text row and the dates outside are hidden
    const info = s.timelineInfo(t.id);
    expect(info.selection).toEqual({ start: D(2023, 1, 1), end: D(2023, 3, 31) });
    expect(info.periods.filter((p) => p.selected).map((p) => p.label)).toEqual(["Jan", "Feb", "Mar"]);
    s.undo();
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    expect(shown(s)).toHaveLength(7);
  });

  it("follows the level, picks everything with null or the whole range, and agrees with the header filter", () => {
    const s = make();
    const t = s.addTimeline("Sheet1", { table: "Orders", column: "Day", level: "years" });
    s.timelineSelect(t.id, { start: D(2023, 4, 4), end: D(2023, 4, 4) });
    expect(s.tables("Sheet1")[0]!.filters!.Day).toEqual({ kind: "dateGroups", groups: [{ by: "year", year: 2023 }] });
    expect(shown(s)).toEqual(["b", "c", "d", "e", "f"]);
    s.updateTimeline("Sheet1", { ...s.timelines("Sheet1")[0]!, level: "days" });
    expect(s.timelineInfo(t.id).periods).toHaveLength(D(2023, 6, 30) - D(2022, 11, 20) + 1);
    expect(s.timelineInfo(t.id).selection).toEqual({ start: D(2023, 1, 1), end: D(2023, 12, 31) });
    // the same filter, made from the header's tree, moves the timeline
    const tree = s.tableFilterDateTree("Orders", "Day")!;
    s.filterTableDates("Orders", "Day", [groupKey(tree.nodes[0]!.children[0]!.children[0]!.group)], []);
    // 2022 holds one date, so ticking it picks the whole year
    expect(s.timelineInfo(t.id).selection).toEqual({ start: D(2022, 1, 1), end: D(2022, 12, 31) });
    s.timelineSelect(t.id, { start: D(2000, 1, 1), end: D(2100, 1, 1) });
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    s.timelineSelect(t.id, { start: D(2023, 3, 15), end: D(2023, 3, 16) });
    expect(shown(s)).toEqual(["d", "e"]);
    s.timelineSelect(t.id, null);
    expect(shown(s)).toHaveLength(7);
  });

  it("is checked: a table and a date column, room on the sheet", () => {
    const s = make();
    expect(() => s.addTimeline("Sheet1", { table: "Orders", column: "Nope" })).toThrow();
    expect(() => s.addTimeline("Sheet1", { table: "Orders", column: "Day", width: 5 })).toThrow(/pixels/);
    expect(() => s.addTimeline("Sheet1", { table: "Nope", column: "Day" })).toThrow();
    expect(() => s.updateTimeline("Sheet1", { id: "x", table: "t", column: "Day", from: { row: 1, col: 1 }, width: 300, height: 100, level: "months" })).toThrow(/No timeline/);
    expect(() => s.addTimeline("Sheet1", { table: "Orders", column: "Day", level: "weeks" as never })).toThrow(/years, quarters/);
  });

  it("can be moved, resized, retitled and deleted, with undo", () => {
    const s = make();
    const t = s.addTimeline("Other", { table: "Orders", column: "Day", caption: "When" });
    expect(t.from).toEqual({ row: 1, col: 1 }); // a table on another sheet: the corner
    s.updateTimeline("Other", { ...t, from: { row: 3, col: 2, dx: 4 }, width: 500, height: 150, style: "TimeSlicerStyleDark1" });
    expect(s.timelines("Other")[0]).toMatchObject({ from: { row: 3, col: 2, dx: 4 }, width: 500, caption: "When", style: "TimeSlicerStyleDark1" });
    s.deleteTimeline("Other", t.id);
    expect(s.timelines("Other")).toEqual([]);
    s.undo();
    expect(s.timelines("Other")).toHaveLength(1);
  });

  it("stays on its cell when rows or columns are inserted, follows a renamed column, and goes with its table or column", () => {
    const s = make();
    const t = s.addTimeline("Sheet1", { table: "Orders", column: "Day", from: { row: 3, col: 6 } });
    s.insertRows("Sheet1", 2, 2);
    expect(s.timelines("Sheet1")[0]!.from).toMatchObject({ row: 5, col: 6 });
    s.insertColumns("Sheet1", 1, 1);
    expect(s.timelines("Sheet1")[0]!.from).toMatchObject({ row: 5, col: 7 });
    s.undo();
    s.undo();
    s.setCell("Sheet1", "B1", "When");
    expect(s.timelines("Sheet1")[0]!.column).toBe("When");
    s.deleteTable("Orders");
    expect(s.timelines("Sheet1")).toEqual([]);
    s.undo();
    expect(s.timelines("Sheet1")).toHaveLength(1);
    expect(t.id).toBe(s.timelines("Sheet1")[0]!.id);
    s.deleteColumns("Sheet1", 2, 1);
    expect(s.timelines("Sheet1")).toEqual([]);
  });

  it("is kept in a saved workbook", () => {
    const s = make();
    s.addTimeline("Sheet1", { table: "Orders", column: "Day", caption: "When", level: "quarters" });
    s.timelineSelect(s.timelines("Sheet1")[0]!.id, { start: D(2023, 1, 1), end: D(2023, 3, 31) });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state));
    wb.workbook.sheets[0].timelines[0].column = "Nope";
    expect(() => parseWorkbook(JSON.stringify(wb))).toThrow(/isn't a column/);
    wb.workbook.sheets[0].timelines[0].column = "Day";
    wb.workbook.sheets[0].timelines[0].level = "weeks";
    expect(() => parseWorkbook(JSON.stringify(wb))).toThrow(/years, quarters/);
  });
});

describe("a timeline in XLSX", () => {
  it("is written as the table's date filter plus a worksheet extension Excel passes by, and read back", () => {
    const s = make();
    const t = s.addTimeline("Sheet1", { table: "Orders", column: "Day", caption: "When", level: "quarters", from: { row: 2, col: 6, dx: 7 }, width: 400, height: 140, style: "TimeSlicerStyleDark1" });
    s.timelineSelect(t.id, { start: D(2023, 1, 1), end: D(2023, 3, 31) });
    const files = unzipSync(toXlsx(s.state));
    expect(strFromU8(files["xl/tables/table1.xml"]!)).toContain('<dateGroupItem year="2023" month="1" dateTimeGrouping="month"/>');
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain('<pli:timeline table="Orders" column="Day" caption="When" level="quarters" row="2" col="6" dx="7" width="400" height="140" style="TimeSlicerStyleDark1"/>');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const u = new SheetSession(back.workbook);
    expect(u.timelines("Sheet1")[0]).toMatchObject({ column: "Day", caption: "When", level: "quarters", from: { row: 2, col: 6, dx: 7 }, width: 400, height: 140, style: "TimeSlicerStyleDark1" });
    expect(u.timelines("Sheet1")[0]!.table).toBe(u.tables("Sheet1")[0]!.id);
    expect(u.timelineInfo(u.timelines("Sheet1")[0]!.id).selection).toEqual({ start: D(2023, 1, 1), end: D(2023, 3, 31) });
    expect(shown(u)).toEqual(["b", "c", "d", "e"]);
  });

  it("is left out with a warning when its table can't be read", () => {
    const s = make();
    s.addTimeline("Sheet1", { table: "Orders", column: "Day" });
    const files = unzipSync(toXlsx(s.state));
    const { strToU8, zipSync } = require("fflate") as typeof import("fflate");
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('table="Orders"', 'table="Nothing"'));
    const back = fromXlsx(zipSync(files));
    expect(back.warnings.join()).toMatch(/timeline on something that isn't a table/);
    expect(back.workbook.sheets[0]!.timelines).toBeUndefined();
  });
});
