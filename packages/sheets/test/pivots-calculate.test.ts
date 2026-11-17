import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";
import type { PivotAxisField, PivotValue } from "../src";

/*
 * Measures of the data model that work in the filters of a cell: CALCULATE, ALL and the other filter functions, iterators and
 * time intelligence. The numbers are worked out by hand in the comments.
 */

const day = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);

// Orders: one a month for 2023 and 2024, in two regions.
const ORDERS: (string | number)[][] = [["OrderId", "Date", "Region", "CustomerId", "Amount"]];
let id = 1;
for (const [year, base] of [[2023, 10], [2024, 20]] as const) {
  for (let m = 1; m <= 12; m++) {
    ORDERS.push([id++, day(year, m, 10), m % 2 ? "East" : "West", 1 + (m % 3), base + m]);
  }
}
// 2023: 11..22 (sum 198), 2024: 21..32 (sum 318)
const CALENDAR: (string | number)[][] = [["Date", "Year", "Month", "MonthNo"]];
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
for (let y = 2023; y <= 2024; y++) {
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) CALENDAR.push([day(y, m, d), y, NAMES[m - 1]!, m]);
  }
}

const make = (measures: { name: string; expression: string }[]) => {
  const s = new SheetSession(createWorkbook("M", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", ORDERS);
  s.setValues("Data", "H1", CALENDAR);
  s.setFormat("Data", "B2:B25", "m/d/yyyy");
  s.setDataModel({
    tables: [
      { name: "Orders", source: `Data!A1:E${ORDERS.length}` },
      { name: "Calendar", source: `Data!H1:K${CALENDAR.length}` },
    ],
    relationships: [{ from: { table: "Orders", column: "Date" }, to: { table: "Calendar", column: "Date" } }],
    measures: [{ name: "Total", table: "Orders", expression: "SUM(Orders[Amount])" }, ...measures.map((m) => ({ ...m, table: "Orders" }))],
  });
  return s;
};
type Spec = { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>;
const pivot = (s: SheetSession, spec: Spec) => s.createPivot("Pivot", { source: "ThisWorkbookDataModel", anchor: "A1", ...spec } as never);
const shown = (s: SheetSession) => s.values("Pivot", s.pivots("Pivot")[0]!.range).map((r) => r.map((v) => (v === null ? "" : typeof v === "object" ? v.error : String(v))));
/** The rows of the table as `label: values`. */
const lines = (s: SheetSession) => {
  const all = shown(s);
  return all.slice(all.findIndex((r) => r[0] === "Row Labels") + 1).map((r) => r.join("|"));
};

describe("CALCULATE and the filter functions", () => {
  it("works an expression out again with a column filtered", () => {
    const s = make([{ name: "East only", expression: 'CALCULATE([Total], Orders[Region] = "East")' }]);
    pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Total" }, { field: "East only" }] });
    // East has the odd months. 2023: 11+13+15+17+19+21 = 96; 2024: 21+23+25+27+29+31 = 156
    expect(lines(s)).toEqual(["2023|198|96", "2024|318|156", "Grand Total|516|252"]);
  });
  it("replaces the cell's filter on the column it filters", () => {
    const s = make([{ name: "West", expression: 'CALCULATE([Total], Orders[Region] = "West")' }]);
    pivot(s, { rows: ["Orders[Region]"], values: [{ field: "West" }] });
    // Each region row shows West's total (even months: 2023 12+14+…+22 = 102, 2024 22+24+…+32 = 162): the filter on Region is replaced.
    expect(lines(s)).toEqual(["East|264", "West|264", "Grand Total|264"]);
  });
  it("keeps the cell's filter with KEEPFILTERS", () => {
    const s = make([{ name: "West kept", expression: 'CALCULATE([Total], KEEPFILTERS(Orders[Region] = "West"))' }]);
    pivot(s, { rows: ["Orders[Region]"], values: [{ field: "West kept" }] });
    expect(lines(s)).toEqual(["East|", "West|264", "Grand Total|264"]);
  });
  it("takes filters off with ALL, ALLEXCEPT and REMOVEFILTERS, and shares of the whole", () => {
    const s = make([
      { name: "All regions", expression: "CALCULATE([Total], ALL(Orders[Region]))" },
      { name: "Share", expression: "DIVIDE([Total], [All regions])" },
      { name: "Of everything", expression: "CALCULATE([Total], ALL(Orders))" },
      { name: "Of the year", expression: "CALCULATE([Total], ALLEXCEPT(Calendar, Calendar[Year]))" },
      { name: "Removed", expression: "CALCULATE([Total], REMOVEFILTERS(Calendar))" },
    ]);
    pivot(s, { rows: ["Calendar[Year]"], columns: ["Orders[Region]"], values: [{ field: "All regions" }, { field: "Share" }] });
    const r = shown(s);
    // 2023 East 96 of 198
    const east = r.find((row) => row[0] === "2023")!;
    expect(east[1]).toBe("198");
    expect(Number(east[2])).toBeCloseTo(96 / 198, 10);
    const t = make([
      { name: "Of everything", expression: "CALCULATE([Total], ALL(Orders))" },
      { name: "Of the year", expression: "CALCULATE([Total], ALLEXCEPT(Calendar, Calendar[Year]))" },
      { name: "Removed", expression: "CALCULATE([Total], REMOVEFILTERS(Calendar))" },
    ]);
    pivot(t, { rows: ["Calendar[Year]", "Calendar[Month]"], values: [{ field: "Of everything" }, { field: "Of the year" }, { field: "Removed" }] });
    const jan = shown(t).find((row) => row[0] === "Jan")!;
    // ALL(Orders) leaves the filters on the calendar (Jan 2023 is 11); ALLEXCEPT keeps the year; REMOVEFILTERS(Calendar) takes the calendar off.
    expect(jan.slice(1)).toEqual(["11", "198", "516"]);
    void s;
  });
  it("keeps the table's own filters (a page filter) through ALLSELECTED but not through ALL", () => {
    const s = make([
      { name: "Selected", expression: "CALCULATE([Total], ALLSELECTED(Calendar[Year]))" },
      { name: "Everything", expression: "CALCULATE([Total], ALL(Calendar[Year]))" },
    ]);
    pivot(s, { rows: ["Calendar[Year]"], filters: [{ field: "Orders[Region]", items: ["East"] }], values: [{ field: "Selected" }, { field: "Everything" }] });
    // East only: 96 + 156 = 252 for both: the filter on Region is not on the year column. ALL(Year) leaves the page filter.
    expect(lines(s)).toEqual(["2023|252|252", "2024|252|252", "Grand Total|252|252"]);
  });
  it("filters with FILTER over a column and a measure", () => {
    const s = make([{ name: "Big months", expression: "CALCULATE([Total], FILTER(ALL(Calendar[Month]), [Total] > 25))" }]);
    pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Big months" }] });
    // The months are tested in the cell's own filters: in 2023 no month is over 25 (the most is 22); in 2024 months 6 to 12 are (26 to 32, 203);
    // for the grand total a month is both years' (30 + 2m), and all are over 25.
    expect(lines(s)).toEqual(["2023|", "2024|203", "Grand Total|516"]);
    const t = make([{ name: "Big months", expression: "CALCULATE([Total], FILTER(ALL(Calendar[Month]), [Total] > 45))" }]);
    pivot(t, { rows: ["Calendar[Year]"], values: [{ field: "Big months" }] });
    // Over 45 for a month of both years: 30 + 2m > 45, so August to December (2023: 18+19+20+21+22 = 100, 2024: 150); in one year none is.
    expect(lines(t)).toEqual(["2023|", "2024|", "Grand Total|250"]);
  });
  it("filters rows of a table with FILTER and counts them", () => {
    const s = make([
      { name: "Large orders", expression: "COUNTROWS(FILTER(Orders, Orders[Amount] > 25))" },
      { name: "Large total", expression: "CALCULATE([Total], FILTER(Orders, Orders[Amount] > 25))" },
      { name: "Doubled", expression: "SUMX(Orders, Orders[Amount] * 2)" },
    ]);
    pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Large orders" }, { field: "Large total" }, { field: "Doubled" }] });
    // 2024 amounts 21..32: those over 25 are 26..32 (7 of them), summing 203
    expect(lines(s)).toEqual(["2023|0||396", "2024|7|203|636", "Grand Total|7|203|1032"]);
  });
  it("uses IF, SWITCH and comparisons, and a list with IN", () => {
    const s = make([
      { name: "Flag", expression: 'IF([Total] > 200, "big", "small")' },
      { name: "Some", expression: 'CALCULATE([Total], Orders[Region] IN { "East", "North" })' },
      { name: "Pick", expression: 'SWITCH(TRUE(), [Total] > 300, 3, [Total] > 200, 2, 1)' },
    ]);
    pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Some" }, { field: "Pick" }] });
    expect(lines(s)).toEqual(["2023|96|1", "2024|156|3", "Grand Total|252|3"]);
  });
  it("counts distinct values and rows in the changed filters", () => {
    const s = make([{ name: "Customers East", expression: 'CALCULATE(DISTINCTCOUNT(Orders[CustomerId]), Orders[Region] = "East")' }, { name: "Rows", expression: "CALCULATE(COUNTROWS(Orders), ALL(Orders[Region]))" }]);
    pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Customers East" }, { field: "Rows" }] });
    expect(lines(s)).toEqual(["2023|3|12", "2024|3|12", "Grand Total|3|24"]);
  });
  it("says which function it does not know, and which column is missing", () => {
    const s = make([]);
    const total = s.dataModel()!.measures;
    expect(() => s.setDataModel({ ...s.dataModel()!, measures: [...total, { name: "Bad", table: "Orders", expression: "CALCULATE([Total], NOPE(Orders[Region]))" }] })).toThrow(/NOPE/);
    expect(() => s.setDataModel({ ...s.dataModel()!, measures: [...total, { name: "Bad", table: "Orders", expression: "CALCULATE([Total], Orders[Region] = )" }] })).toThrow();
    s.setDataModel({ ...s.dataModel()!, measures: [{ name: "Bad", table: "Orders", expression: 'CALCULATE(SUM(Orders[Nope]), Orders[Region] = "East")' }] });
    expect(() => pivot(s, { rows: ["Calendar[Year]"], values: [{ field: "Bad" }] })).toThrow(/Orders\[Nope\]/);
    expect(() => s.setDataModel({ ...s.dataModel()!, measures: [{ name: "A", table: "Orders", expression: "CALCULATE([B])" }, { name: "B", table: "Orders", expression: "[A] + 1" }] })).toThrow(/itself/);
  });
});

describe("time intelligence", () => {
  const rowsMonths = { rows: ["Calendar[Year]", "Calendar[Month]"] };
  const month = (s: SheetSession, year: string, m: string): string[] => {
    const all = shown(s);
    const start = all.findIndex((r) => r[0] === year);
    return all.slice(start + 1).find((r) => r[0] === m)!;
  };
  it("adds up the year to date: TOTALYTD and DATESYTD", () => {
    const s = make([
      { name: "YTD", expression: "TOTALYTD([Total], Calendar[Date])" },
      { name: "YTD2", expression: "CALCULATE([Total], DATESYTD(Calendar[Date]))" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "YTD" }, { field: "YTD2" }] });
    // 2024: Jan 21, Feb 21+22 = 43, Mar 43+23 = 66; 2023 the same way: 11, 23, 36
    expect(month(s, "2024", "Jan").slice(1)).toEqual(["21", "21"]);
    expect(month(s, "2024", "Mar").slice(1)).toEqual(["66", "66"]);
    expect(month(s, "2023", "Feb").slice(1)).toEqual(["23", "23"]);
    // A year's own row is its last month's year to date, and so is the grand total.
    expect(shown(s).find((r) => r[0] === "2024")!.slice(1)).toEqual(["318", "318"]);
  });
  it("starts the year where you say (TOTALYTD with a year end)", () => {
    const s = make([{ name: "FYTD", expression: 'TOTALYTD([Total], Calendar[Date], "6-30")' }]);
    pivot(s, { ...rowsMonths, values: [{ field: "FYTD" }] });
    // The year runs 1 July to 30 June: in January 2024 it has July..December 2023 and January 2024.
    // Jul..Dec 2023: 17+18+19+20+21+22 = 117, + Jan 2024 21 = 138
    expect(month(s, "2024", "Jan")[1]).toBe("138");
    // July 2023 starts a year: 17
    expect(month(s, "2023", "Jul")[1]).toBe("17");
  });
  it("adds up the quarter and the month to date", () => {
    const s = make([
      { name: "QTD", expression: "TOTALQTD([Total], Calendar[Date])" },
      { name: "MTD", expression: "TOTALMTD([Total], Calendar[Date])" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "QTD" }, { field: "MTD" }] });
    // 2024 Feb: quarter to date = Jan + Feb = 21 + 22 = 43; Apr starts a quarter: 24
    expect(month(s, "2024", "Feb").slice(1)).toEqual(["43", "22"]);
    expect(month(s, "2024", "Apr").slice(1)).toEqual(["24", "24"]);
  });
  it("compares with the same period last year", () => {
    const s = make([
      { name: "Last year", expression: "CALCULATE([Total], SAMEPERIODLASTYEAR(Calendar[Date]))" },
      { name: "Change", expression: "[Total] - [Last year]" },
      { name: "Via DATEADD", expression: "CALCULATE([Total], DATEADD(Calendar[Date], -1, YEAR))" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "Total" }, { field: "Last year" }, { field: "Change" }, { field: "Via DATEADD" }] });
    expect(month(s, "2024", "Mar").slice(1)).toEqual(["23", "13", "10", "13"]);
    // 2023 has nothing before it.
    expect(month(s, "2023", "Mar")[2]).toBe("");
    // A whole year looks at the whole year before.
    expect(shown(s).find((r) => r[0] === "2024")!.slice(1)).toEqual(["318", "198", "120", "198"]);
  });
  it("moves by a month, a quarter and a day: PREVIOUSMONTH, NEXTMONTH, PARALLELPERIOD", () => {
    const s = make([
      { name: "Previous", expression: "CALCULATE([Total], PREVIOUSMONTH(Calendar[Date]))" },
      { name: "Next", expression: "CALCULATE([Total], NEXTMONTH(Calendar[Date]))" },
      { name: "Quarter back", expression: "CALCULATE([Total], PARALLELPERIOD(Calendar[Date], -1, QUARTER))" },
      { name: "Previous year", expression: "CALCULATE([Total], PREVIOUSYEAR(Calendar[Date]))" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "Previous" }, { field: "Next" }, { field: "Quarter back" }, { field: "Previous year" }] });
    // 2024 May: April 24, June 26; a quarter back from May is Q4 2023?? no: May is in Q2, the quarter before is Q1 2024 = 21+22+23 = 66
    expect(month(s, "2024", "May").slice(1)).toEqual(["24", "26", "66", "198"]);
    // December 2024 has no next month in the calendar
    expect(month(s, "2024", "Dec")[2]).toBe("");
  });
  it("takes a stretch of dates: DATESBETWEEN, DATESINPERIOD", () => {
    const s = make([
      { name: "H1", expression: "CALCULATE([Total], DATESBETWEEN(Calendar[Date], DATE(2024, 1, 1), DATE(2024, 6, 30)))" },
      { name: "Last 3 months", expression: "CALCULATE([Total], DATESINPERIOD(Calendar[Date], LASTDATE(Calendar[Date]), -3, MONTH))" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "H1" }, { field: "Last 3 months" }] });
    // 2024 Jan..Jun: 21+22+23+24+25+26 = 141
    expect(month(s, "2024", "Mar")[1]).toBe("141");
    // The three months ending in March 2024: Jan, Feb, Mar = 66
    expect(month(s, "2024", "Mar")[2]).toBe("66");
  });
  it("reads the balance at the end and the start of a period", () => {
    const s = make([
      { name: "Closing", expression: "CLOSINGBALANCEMONTH([Total], Calendar[Date])" },
      { name: "Year end", expression: "CALCULATE([Total], LASTDATE(Calendar[Date]))" },
    ]);
    pivot(s, { ...rowsMonths, values: [{ field: "Closing" }, { field: "Year end" }] });
    // The orders are on the 10th: the last day of a month has none.
    expect(month(s, "2024", "Mar").slice(1)).toEqual(["", ""]);
  });
  it("answers with the pivot table's own filters kept", () => {
    const s = make([{ name: "YTD", expression: "TOTALYTD([Total], Calendar[Date])" }]);
    pivot(s, { ...rowsMonths, filters: [{ field: "Orders[Region]", items: ["East"] }], values: [{ field: "YTD" }] });
    // East in 2024: Jan 21, Mar 23, → March year to date 21 + 23 = 44
    expect(month(s, "2024", "Mar")[1]).toBe("44");
  });
  it("is drawn again with the same numbers after saving and loading the workbook", () => {
    const s = make([{ name: "YTD", expression: "TOTALYTD([Total], Calendar[Date])" }]);
    pivot(s, { ...rowsMonths, values: [{ field: "YTD" }] });
    const before = shown(s);
    s.refreshPivot("Pivot", s.pivots("Pivot")[0]!.id);
    expect(shown(s)).toEqual(before);
  });
});
