import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";
import type { PivotAxisField, PivotValue } from "../src";

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["East", "Apple", 2, 20],
  ["North", "Plum", 4, 44],
  ["South", "Plum", 1, 11],
];
const make = () => {
  const s = new SheetSession(createWorkbook("Pivots", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
const shown = (s: SheetSession, range: string) => s.values("Pivot", range).map((r) => r.map((v) => (v === null ? "" : typeof v === "object" ? v.error : String(v))));
const pivot = (s: SheetSession, spec: { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>, source = "Data!A1:D8") => s.createPivot("Pivot", { source, anchor: "A1", ...spec } as never);
const now = (s: SheetSession) => s.pivots("Pivot")[0]!.range;

describe("pivot data from outside the workbook", () => {
  it("reads a named block of rows, kept in the workbook", () => {
    const s = make();
    s.setDataBlock("data:Sales", DATA);
    pivot(s, { rows: ["Region"], values: ["Sales"] }, "data:Sales");
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["East", "160"], ["North", "44"], ["South", "11"], ["West", "103"], ["Grand Total", "318"]]);
    expect(s.dataBlock("DATA:sales")?.from).toBe("host");
  });
  it("reads CSV into a block with numbers and dates typed", () => {
    const s = make();
    const block = s.importCsv("data:Csv", "Region,Date,Amount\nEast,2024-01-05,10\nWest,2024-02-06,20.5\nEast,2024-03-07,\n");
    expect(block.rows[1]).toEqual(["East", expect.any(Number), 10]);
    expect(block.formats?.[1]).toMatch(/y/);
    pivot(s, { rows: ["Region"], values: ["Amount"] }, "data:Csv");
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Amount"], ["East", "10"], ["West", "20.5"], ["Grand Total", "30.5"]]);
  });
  it("reads a range of another workbook through the block that holds its cells", () => {
    const s = make();
    const source = "[Prices.xlsx]Sheet1!$A$1:$B$4";
    s.setDataBlock(source, [["Item", "Price"], ["Pen", 2], ["Ink", 9], ["Pen", 3]]);
    const p = pivot(s, { rows: ["Item"], values: ["Price"] }, source);
    expect(p.source).toBe(source);
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Price"], ["Ink", "9"], ["Pen", "5"], ["Grand Total", "14"]]);
  });
  it("says what is missing when the block has not been read", () => {
    const s = make();
    expect(() => pivot(s, { rows: ["Region"], values: ["Sales"] }, "data:Nope")).toThrow(/has not been read/);
  });
  it("refreshes from the host and draws the pivot tables that read it again", async () => {
    const s = make();
    let sales = 100;
    s.pivotData = async ({ kind, name }) => (kind === "data" && name === "Live" ? [["Region", "Sales"], ["East", sales], ["West", 1]] : null);
    s.setDataBlock("data:Live", [["Region", "Sales"], ["East", 1], ["West", 1]]);
    pivot(s, { rows: ["Region"], values: ["Sales"] }, "data:Live");
    expect(shown(s, now(s))[1]).toEqual(["East", "1"]);
    const r1 = await s.refreshPivotData();
    expect(r1).toMatchObject({ updated: 1, unchanged: 0, failed: [], pivots: 1 });
    expect(shown(s, now(s))[1]).toEqual(["East", "100"]);
    sales = 100;
    expect(await s.refreshPivotData()).toMatchObject({ updated: 0, unchanged: 1, pivots: 0 });
    expect(s.dataBlock("data:Live")?.read).toBe("2023-03-15");
  });
  it("answers a host that gives CSV, and keeps the rows when the host cannot find the data", async () => {
    const s = make();
    s.setDataBlock("data:Feed", [["Region", "Sales"], ["East", 1]]);
    pivot(s, { rows: ["Region"], values: ["Sales"] }, "data:Feed");
    s.pivotData = async () => ({ csv: "Region;Sales\nEast;7\nWest;8" });
    await s.refreshPivotData();
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["East", "7"], ["West", "8"], ["Grand Total", "15"]]);
    s.pivotData = async () => null;
    const r = await s.refreshPivotData();
    expect(r.failed).toHaveLength(1);
    expect(shown(s, now(s))[1]).toEqual(["East", "7"]);
    s.pivotData = async () => {
      throw new Error("offline");
    };
    expect((await s.refreshPivotData()).failed[0]!.reason).toBe("offline");
  });
  it("does nothing without a host", async () => {
    const s = make();
    expect((await s.refreshPivotData()).offline).toBe(true);
  });
  it("undoes and keeps the block when saved as JSON", () => {
    const s = make();
    s.setDataBlock("data:Sales", DATA);
    s.undo();
    expect(s.dataBlocks()).toHaveLength(0);
    s.redo();
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.dataBlocks?.[0]?.rows).toHaveLength(8);
    expect(() => parseWorkbook(serializeWorkbook({ ...s.state, dataBlocks: [{ source: "Sheet1!A1:B2", rows: [] }] }))).toThrow(/data block/);
  });
});

const ORDERS = [
  ["OrderId", "CustomerId", "ProductId", "Qty", "Amount"],
  [1, 10, 100, 2, 20],
  [2, 10, 101, 1, 30],
  [3, 11, 100, 5, 50],
  [4, 12, 101, 4, 120],
  [5, 11, 101, 1, 30],
  [6, 99, 100, 1, 10],
];
const CUSTOMERS = [
  ["Id", "Name", "Region"],
  [10, "Ann", "East"],
  [11, "Bo", "West"],
  [12, "Cy", "East"],
  [13, "Di", "North"],
];
const PRODUCTS = [
  ["Id", "Title", "Category"],
  [100, "Pen", "Office"],
  [101, "Desk", "Furniture"],
];
const model = () => {
  const s = make();
  s.setValues("Data", "A20", ORDERS);
  s.setValues("Data", "H20", CUSTOMERS);
  s.setValues("Data", "L20", PRODUCTS);
  s.setDataModel({
    tables: [
      { name: "Orders", source: "Data!A20:E26" },
      { name: "Customers", source: "Data!H20:J24" },
      { name: "Products", source: "Data!L20:N22" },
    ],
    relationships: [
      { from: { table: "Orders", column: "CustomerId" }, to: { table: "Customers", column: "Id" } },
      { from: { table: "Orders", column: "ProductId" }, to: { table: "Products", column: "Id" } },
    ],
    measures: [
      { name: "Total sales", table: "Orders", expression: "SUM(Orders[Amount])", fmt: "$#,##0" },
      { name: "Customers served", table: "Orders", expression: "DISTINCTCOUNT(Orders[CustomerId])" },
      { name: "Average order", table: "Orders", expression: "DIVIDE([Total sales], COUNTROWS(Orders))" },
      { name: "Per customer", table: "Orders", expression: "[Total sales] / [Customers served]" },
    ],
  });
  return s;
};

describe("the data model", () => {
  it("sums a column by the fields of a related table", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Orders[Amount]" }] }, "ThisWorkbookDataModel");
    // The order for customer 99 has no customer: its region is blank.
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Orders[Amount]"], ["East", "170"], ["West", "80"], ["(blank)", "10"], ["Grand Total", "260"]]);
  });
  it("counts different values and works out measures in terms of each other", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Total sales" }, { field: "Customers served" }, { field: "Average order" }, { field: "Per customer" }] }, "ThisWorkbookDataModel");
    const rows = shown(s, now(s));
    expect(rows[1]).toEqual(["Row Labels", "Total sales", "Customers served", "Average order", "Per customer"]);
    expect(rows[2]).toEqual(["East", "170", "2", "56.666666666666664", "85"]);
    expect(rows[3]).toEqual(["West", "80", "1", "40", "80"]);
    expect(rows[4]).toEqual(["(blank)", "10", "1", "10", "10"]);
    expect(rows.at(-1)).toEqual(["Grand Total", "260", "4", "43.333333333333336", "65"]);
  });
  it("uses fields of two related tables at once and a measure's format", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], columns: ["Products[Category]"], values: [{ field: "Total sales" }] }, "ThisWorkbookDataModel");
    expect(s.pivots("Pivot")[0]!.values[0]!.fmt).toBeUndefined();
    const rows = shown(s, now(s));
    expect(rows[1]).toEqual(["Row Labels", "Furniture", "Office", "Grand Total"]);
    expect(rows[2]).toEqual(["East", "150", "20", "170"]);
    expect(rows[3]).toEqual(["West", "30", "50", "80"]);
  });
  it("counts the rows of the table a measure names, and keeps tables that no value reads out of the table", () => {
    const s = model();
    s.setDataModel({ ...s.dataModel()!, measures: [...s.dataModel()!.measures, { name: "Orders placed", table: "Orders", expression: "COUNTROWS(Orders)" }, { name: "Known customers", table: "Customers", expression: "COUNTROWS(Customers)" }] });
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Known customers" }] }, "ThisWorkbookDataModel");
    // Di (North) has no orders but is a customer; a measure over the customer table lists her region.
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Row Labels|Known customers", "East|2", "North|1", "West|1", "Grand Total|4"]);
  });
  it("is drawn again when the model changes, and refuses a bad model or measure", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Total sales" }] }, "ThisWorkbookDataModel");
    const m = s.dataModel()!;
    s.setDataModel({ ...m, measures: [{ name: "Total sales", table: "Orders", expression: "SUM(Orders[Amount]) * 2" }] });
    expect(shown(s, now(s))[1]).toEqual(["East", "340"]);
    expect(() => s.setDataModel({ ...m, relationships: [{ from: { table: "Orders", column: "CustomerId" }, to: { table: "Nope", column: "Id" } }] })).toThrow(/isn't a table/);
    expect(() => s.setDataModel({ ...m, measures: [{ name: "Bad", table: "Orders", expression: "CALCULATE(SUM(Orders[Amount])" }] })).toThrow(/isn't closed/);
    expect(() => s.setDataModel({ ...m, measures: [{ name: "Loop", table: "Orders", expression: "[Loop] + 1" }] })).toThrow(/isn't a measure|itself/);
    expect(() => s.setDataModel(null)).toThrow(/delete them first/);
    s.undo();
    expect(shown(s, now(s))[1]).toEqual(["East", "170"]);
  });
  it("says so when a measure names a column the table does not have", () => {
    const s = model();
    s.setDataModel({ ...s.dataModel()!, measures: [{ name: "Bad", table: "Orders", expression: "SUM(Orders[Nope])" }] });
    expect(() => pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Bad" }] }, "ThisWorkbookDataModel")).toThrow(/Orders\[Nope\]/);
  });
  it("can read a table from a block of outside data", () => {
    const s = model();
    s.setDataBlock("data:Cust", CUSTOMERS);
    s.setDataModel({ ...s.dataModel()!, tables: s.dataModel()!.tables.map((t) => (t.name === "Customers" ? { ...t, source: "data:Cust" } : t)) });
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Total sales" }] }, "ThisWorkbookDataModel");
    expect(shown(s, now(s))[1]).toEqual(["East", "170"]);
  });
  it("shows distinct counts in an ordinary pivot table too", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: [{ field: "Product", fn: "distinctCount" }] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Distinct Count of Product"], ["East", "2"], ["North", "1"], ["South", "1"], ["West", "2"], ["Grand Total", "3"]]);
  });
  it("follows the cells of its tables when it asks to", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Total sales" }], autoRefresh: true }, "ThisWorkbookDataModel");
    s.setValues("Data", "E21", [[1000]]);
    expect(shown(s, now(s))[1]).toEqual(["East", "1150"]);
  });
  it("saves in JSON", () => {
    const s = model();
    pivot(s, { rows: ["Customers[Region]"], values: [{ field: "Total sales" }] }, "ThisWorkbookDataModel");
    const back = new SheetSession(parseWorkbook(serializeWorkbook(s.state)), { now: () => 45_000.5 });
    back.refreshPivot("Pivot", back.pivots("Pivot")[0]!.id);
    expect(shown(back, now(back))[1]).toEqual(["East", "170"]);
  });
});
