import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, dateGroupContains, dateGroupLabel, fromXlsx, groupKey, nodeState, parseWorkbook, serializeWorkbook, toXlsx, type DateGroup } from "../src";

// 45000 is 2023-03-15.
const TODAY = 45_000;
const make = () => {
  const s = new SheetSession(createWorkbook("Dates", ["Sheet1"]), { now: () => TODAY + 0.5 });
  s.setValues("Sheet1", "A1", [
    ["Name", "Day"],
    ["a", TODAY], // 2023-03-15
    ["b", TODAY - 1], // 2023-03-14
    ["c", TODAY + 1], // 2023-03-16
    ["d", TODAY - 10], // 2023-03-05
    ["e", TODAY - 40], // 2023-02-03
    ["f", TODAY - 400], // 2022-02-09
    ["g", TODAY + 40], // 2023-04-24
    ["h", "n/a"],
    ["i", null],
  ]);
  s.setFormat("Sheet1", "B2:B10", "yyyy-mm-dd");
  s.setFilter("Sheet1", "A1:B10");
  s.createTable("Sheet1", "D1:E3", { name: "Tiny" });
  return s;
};
const shown = (s: SheetSession) => {
  const out: string[] = [];
  for (let r = 2; r <= 10; r++) if (!s.sheet("Sheet1").rows?.[String(r)]?.hidden) out.push(String(s.value("Sheet1", `A${r}`)));
  return out;
};
const G = (by: DateGroup["by"], year: number, month?: number, day?: number): DateGroup => ({ by, year, ...(month ? { month } : {}), ...(day ? { day } : {}) });

describe("the tree of dates in a filter menu", () => {
  it("lists years, the months in them and the days in those, with counts, and the other values flat", () => {
    const s = make();
    const tree = s.filterDateTree("Sheet1", 2)!;
    expect(tree.nodes.map((n) => [n.label, n.count])).toEqual([["2022", 1], ["2023", 6]]);
    const y23 = tree.nodes[1]!;
    expect(y23.children.map((n) => [n.label, n.count])).toEqual([["February", 1], ["March", 4], ["April", 1]]);
    expect(y23.children[1]!.children.map((n) => n.label)).toEqual(["5", "14", "15", "16"]);
    expect(y23.children[1]!.children[0]!.children).toEqual([]); // no times: days are the leaves
    expect(tree.nodes.every((n) => nodeState(n) === "all")).toBe(true);
    expect(tree.others.map((o) => [o.value, o.count])).toEqual([["", 1], ["n/a", 1]]);
    expect(s.filterDateTree("Sheet1", 1)).toBeNull(); // a column with no dates
  });

  it("goes down to hours, minutes and seconds for dates with a time", () => {
    const s = make();
    s.setValues("Sheet1", "B2", [[TODAY + 14 / 24 + 5 / 1440 + 9 / 86400]]);
    const tree = s.filterDateTree("Sheet1", 2)!;
    const day = tree.nodes[1]!.children[1]!.children.find((d) => d.label === "15")!;
    expect(day.children.map((n) => n.label)).toEqual(["14"]);
    expect(day.children[0]!.children[0]!.children[0]!.title).toBe("15 March 2023, 14:05:09");
  });

  it("filters by ticked leaves, picks a whole year or month when all its days are ticked, and hides the rest", () => {
    const s = make();
    const tree = s.filterDateTree("Sheet1", 2)!;
    const march = tree.nodes[1]!.children[1]!;
    s.filterColumnDates("Sheet1", 2, march.children.map((d) => groupKey(d.group)), []);
    expect(s.sheet("Sheet1").filter!.columns!.B).toEqual({ kind: "dateGroups", groups: [G("month", 2023, 3)] });
    expect(shown(s)).toEqual(["a", "b", "c", "d"]);
    // days of two months, and the year 2022, and the blanks
    const feb = tree.nodes[1]!.children[0]!;
    s.filterColumnDates("Sheet1", 2, [groupKey(feb.children[0]!.group), groupKey(march.children[1]!.group), groupKey(tree.nodes[0]!.children[0]!.children[0]!.group)], [""]);
    expect(s.sheet("Sheet1").filter!.columns!.B).toEqual({
      kind: "dateGroups",
      groups: [G("year", 2022), G("month", 2023, 2), G("day", 2023, 3, 14)], // February has one day, so it is picked whole
      values: [""],
    });
    expect(shown(s)).toEqual(["b", "e", "f", "i"]);
    // the tree now shows what is let through
    const again = s.filterDateTree("Sheet1", 2)!;
    expect(again.nodes.map(nodeState)).toEqual(["all", "some"]);
    expect(again.nodes[1]!.children.map(nodeState)).toEqual(["all", "some", "none"]);
    expect(again.others.map((o) => [o.value, o.selected])).toEqual([["", true], ["n/a", false]]);
    // ticking everything takes the filter off
    const every = again.nodes.flatMap((n) => n.children.flatMap((m) => m.children)).map((d) => groupKey(d.group));
    s.filterColumnDates("Sheet1", 2, every, ["", "n/a"]);
    expect(s.sheet("Sheet1").filter!.columns).toBeUndefined();
    expect(shown(s)).toHaveLength(9);
    // no date ticked is a plain list of the other values
    s.filterColumnDates("Sheet1", 2, [], ["n/a"]);
    expect(s.sheet("Sheet1").filter!.columns!.B).toEqual(["n/a"]);
    expect(shown(s)).toEqual(["h"]);
  });

  it("starts from a list of values: the dates whose text was let through are ticked", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["2023-03-15", "2023-03-14"]);
    const tree = s.filterDateTree("Sheet1", 2)!;
    expect(tree.nodes[1]!.children[1]!.children.map((d) => [d.label, nodeState(d)])).toEqual([["5", "none"], ["14", "all"], ["15", "all"], ["16", "none"]]);
  });

  it("works for a table, in one undo step", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [["Who", "When"], ["x", TODAY], ["y", TODAY - 400]]);
    s.setFormat("Sheet1", "E2:E3", "yyyy-mm-dd");
    const tree = s.tableFilterDateTree("Tiny", "When")!;
    expect(tree.nodes.map((n) => n.label)).toEqual(["2022", "2023"]);
    s.filterTableDates("Tiny", "When", [groupKey(tree.nodes[1]!.children[0]!.children[0]!.group)], []);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ When: { kind: "dateGroups", groups: [G("year", 2023)] } });
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBe(true);
    s.undo();
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBeUndefined();
    expect(() => s.filterTableDates("Tiny", "Who", [], [])).toThrow(/no dates/);
  });

  it("keeps filtering when the cells change (the rule is by date, not by text)", () => {
    const s = make();
    s.filterColumnRule("Sheet1", 2, { kind: "dateGroups", groups: [G("month", 2023, 3)] });
    s.setCell("Sheet1", "B5", TODAY + 100); // d leaves March
    s.reapplyFilter("Sheet1");
    expect(shown(s)).toEqual(["a", "b", "c"]);
  });
});

describe("date picks", () => {
  it("compare down to their level", () => {
    expect(dateGroupContains(G("year", 2023), TODAY)).toBe(true);
    expect(dateGroupContains(G("month", 2023, 2), TODAY)).toBe(false);
    expect(dateGroupContains(G("day", 2023, 3, 15), TODAY + 0.75)).toBe(true);
    expect(dateGroupContains({ by: "hour", year: 2023, month: 3, day: 15, hour: 18 }, TODAY + 0.75)).toBe(true);
    expect(dateGroupContains({ by: "hour", year: 2023, month: 3, day: 15, hour: 17 }, TODAY + 0.75)).toBe(false);
    expect(dateGroupLabel(G("month", 2023, 3), true)).toBe("March 2023");
  });

  it("are checked", () => {
    const s = make();
    const rule = (g: unknown) => () => s.filterColumnRule("Sheet1", 2, { kind: "dateGroups", groups: [g as DateGroup] });
    expect(rule({ by: "month", year: 2023 })).toThrow(/needs a month/);
    expect(rule({ by: "day", year: 2023, month: 2, day: 30 })).toThrow(/no day 30/);
    expect(rule({ by: "year", year: 1800 })).toThrow(/1900 to 9999/);
    expect(rule({ by: "week", year: 2023 })).toThrow(/one of/);
    // parts below the level are dropped
    s.filterColumnRule("Sheet1", 2, { kind: "dateGroups", groups: [{ by: "year", year: 2023, month: 3 }, G("year", 2023)] });
    expect(s.sheet("Sheet1").filter!.columns!.B).toEqual({ kind: "dateGroups", groups: [G("year", 2023)] });
  });

  it("are kept in a saved workbook", () => {
    const s = make();
    s.filterColumnRule("Sheet1", 2, { kind: "dateGroups", groups: [G("month", 2023, 3), G("day", 2022, 2, 9)], values: ["n/a"] });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state));
    wb.workbook.sheets[0].filter.columns.B.groups[0].month = 13;
    expect(() => parseWorkbook(JSON.stringify(wb))).toThrow();
  });
});

describe("date picks in XLSX", () => {
  const sheetXml = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);

  it("are written as dateGroupItem entries inside filters and read back", () => {
    const s = make();
    s.filterColumnRule("Sheet1", 2, { kind: "dateGroups", groups: [G("year", 2022), G("month", 2023, 3), G("day", 2023, 2, 3)], values: ["n/a", ""] });
    const xml = sheetXml(s);
    expect(xml).toContain('<filters blank="1"><filter val="n/a"/><dateGroupItem year="2022" dateTimeGrouping="year"/><dateGroupItem year="2023" month="3" dateTimeGrouping="month"/><dateGroupItem year="2023" month="2" day="3" dateTimeGrouping="day"/></filters>');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const t = new SheetSession(back.workbook);
    expect(t.sheet("Sheet1").filter!.columns!.B).toEqual(s.sheet("Sheet1").filter!.columns!.B);
    expect(t.sheet("Sheet1").rows?.["8"]?.hidden).toBe(true); // the hidden rows are the file's
  });

  it("with times, and in a table", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [["Who", "When"], ["x", TODAY], ["y", TODAY - 400]]);
    s.filterTableRule("Tiny", "When", { kind: "dateGroups", groups: [{ by: "second", year: 2023, month: 3, day: 15, hour: 14, minute: 5, second: 9 }] });
    const files = unzipSync(toXlsx(s.state));
    expect(strFromU8(files["xl/tables/table1.xml"]!)).toContain('<dateGroupItem year="2023" month="3" day="15" hour="14" minute="5" second="9" dateTimeGrouping="second"/>');
    const t = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(t.tables("Sheet1")[0]!.filters).toEqual(s.tables("Sheet1")[0]!.filters);
  });

  it("are read as Excel writes them, and a pick Excel couldn't have is left out with a warning", () => {
    const s = make();
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const withColumn = (col: string) => fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(xml.replace(/<autoFilter ref="A1:B10"\s*\/>|<autoFilter ref="A1:B10">[\s\S]*?<\/autoFilter>/, `<autoFilter ref="A1:B10">${col}</autoFilter>`)) }));
    const ok = withColumn('<filterColumn colId="1"><filters><dateGroupItem year="2023" month="3" dateTimeGrouping="month"/></filters></filterColumn>');
    expect(ok.warnings).toEqual([]);
    expect(ok.workbook.sheets[0]!.filter!.columns!.B).toEqual({ kind: "dateGroups", groups: [G("month", 2023, 3)] });
    const gregorian = withColumn('<filterColumn colId="1"><filters calendarType="gregorian"><dateGroupItem year="2023" dateTimeGrouping="year"/></filters></filterColumn>');
    expect(gregorian.workbook.sheets[0]!.filter!.columns!.B).toEqual({ kind: "dateGroups", groups: [G("year", 2023)] });
    expect(withColumn('<filterColumn colId="1"><filters><dateGroupItem year="2023" month="2" day="31" dateTimeGrouping="day"/></filters></filterColumn>').warnings.join()).toMatch(/isn't a date/);
    expect(withColumn('<filterColumn colId="1"><filters><dateGroupItem year="2023" dateTimeGrouping="week"/></filters></filterColumn>').warnings.join()).toMatch(/picks dates by "week"/);
  });
});
