import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const LIST = [
  ["Region", "Product", "Qty", "Amount"],
  ["East", "Ink", 1, 7],
  ["East", "Pen", 2, 10],
  ["West", "Ink", 4, 20],
  ["West", "Pen", 5, 25],
];
const make = (sheets = ["Sheet1", "Other"]) => {
  const s = new SheetSession(createWorkbook("Sub", sheets), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", LIST);
  return s;
};
const col = (s: SheetSession, c: string, rows: number, sheet = "Sheet1") => Array.from({ length: rows }, (_, i) => s.display(sheet, `${c}${i + 1}`).text);
const hide = (s: SheetSession, row: number, on = true) => s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "row", index: row, hidden: on ? true : null }]);

describe("Subtotal on a table", () => {
  const withTable = (totals = false) => {
    const s = make();
    s.createTable("Sheet1", "A1:D5", { name: "Sales" });
    if (totals) s.setTableTotals("Sales", true);
    s.setCell("Other", "A1", "=SUM(Sales[Qty])");
    return s;
  };

  it("is refused, naming the table and the way out, unless asked to convert it", () => {
    const s = withTable();
    expect(() => s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/"Sales" is a table.*can't be subtotalled.*into a range/);
    expect(() => s.subtotal("Sheet1", "B3", { by: "Region", columns: ["Qty"] })).toThrow(/is a table/);
    expect(() => s.removeSubtotals("Sheet1", "A1:D5")).toThrow(/is a table/);
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(s.canUndo).toBe(true); // only the table itself, nothing from the refused command
    expect(col(s, "A", 6)).toEqual(["Region", "East", "East", "West", "West", ""]);
  });

  it("turns the table into a range and subtotals it, as one undo step", () => {
    const s = withTable();
    const r = s.subtotal("Sheet1", "B3", { by: "Region", columns: ["Qty", "Amount"], convertTable: true });
    expect(r.groups).toBe(2);
    expect(s.tables("Sheet1")).toHaveLength(0);
    expect(col(s, "A", 8)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total"]);
    expect(s.value("Sheet1", "C8")).toBe(12);
    // Formulas that named the table read plain ranges now, and follow the inserted rows.
    expect(s.cell("Other", "A1")!.f).toBe("SUM(Sheet1!$C$2:$C$6)");
    s.undo();
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(s.tables("Sheet1")[0]!.name).toBe("Sales");
    expect(s.cell("Other", "A1")!.f).toBe("SUM(Sales[Qty])");
    expect(col(s, "A", 6)).toEqual(["Region", "East", "East", "West", "West", ""]);
  });

  it("leaves a totals row under the list, out of the subtotals, and keeps working", () => {
    const s = withTable(true);
    expect(s.cell("Sheet1", "D6")!.f).toBe("SUBTOTAL(109,Sales[Amount])");
    s.subtotal("Sheet1", "A1:D6", { by: "Region", columns: ["Amount"], convertTable: true });
    // East 2 rows, West 2 rows, grand total, then the old totals row.
    expect(col(s, "A", 9)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total", "Total"]);
    expect(s.value("Sheet1", "D8")).toBe(62);
    expect(s.cell("Sheet1", "D9")!.f).toBe("SUBTOTAL(109,$D$2:$D$6)");
    expect(s.value("Sheet1", "D9")).toBe(62); // other SUBTOTALs are left out, the same sum
    s.removeSubtotals("Sheet1", "A1:D8");
    expect(col(s, "A", 6)).toEqual(["Region", "East", "East", "West", "West", "Total"]);
  });

  it("ignores the flag for a list that is not over a table, and leaves other tables alone", () => {
    const s = withTable();
    s.setValues("Sheet1", "A20", [["K", "V"], ["a", 1], ["b", 2]]);
    s.subtotal("Sheet1", "A20:B22", { by: "K", columns: ["V"], convertTable: true });
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(col(s, "A", 5, "Sheet1").slice(1)).toEqual(["East", "East", "West", "West"]);
  });

  it("refuses a table that lies across the rows beside the list (rows go in whole)", () => {
    const s = withTable();
    s.setValues("Sheet1", "F1", [["K", "V"], ["a", 1], ["b", 2]]);
    expect(() => s.subtotal("Sheet1", "F1:G3", { by: "K", columns: ["V"] })).toThrow(/table Sales lies across rows where subtotals go/);
  });
});

describe("a table's totals row", () => {
  const withTotals = () => {
    const s = make();
    s.createTable("Sheet1", "A1:D5", { name: "Sales" });
    s.setTableTotals("Sales", true);
    return s;
  };

  it("takes any of Excel's functions as SUBTOTAL(101…111), per column", () => {
    const s = withTotals();
    s.setTableTotalsFunction("Sales", "Qty", "average");
    s.setTableTotalsFunction("Sales", "Amount", "max");
    s.setTableTotalsFunction("Sales", "Product", "count");
    expect(s.cell("Sheet1", "C6")!.f).toBe("SUBTOTAL(101,Sales[Qty])");
    expect(s.cell("Sheet1", "D6")!.f).toBe("SUBTOTAL(104,Sales[Amount])");
    expect(s.cell("Sheet1", "B6")!.f).toBe("SUBTOTAL(103,Sales[Product])");
    expect([s.value("Sheet1", "C6"), s.value("Sheet1", "D6"), s.value("Sheet1", "B6")]).toEqual([3, 25, 4]);
    expect(s.tableTotals("Sales")).toEqual({ Region: "label", Product: "count", Qty: "average", Amount: "max" });
    s.setTableTotalsFunction("Sales", "Qty", "none");
    expect(s.cell("Sheet1", "C6")).toBeUndefined();
    s.setTableTotalsFunction("Sales", "Qty", "=SUM(Sales[Qty])*2");
    expect(s.value("Sheet1", "C6")).toBe(24);
    expect(s.tableTotals("Sales").Qty).toBe("custom");
    expect(() => s.setTableTotalsFunction("Sales", "Nope", "sum")).toThrow(/isn't a column/);
    expect(() => s.setTableTotalsFunction("Sales", "Qty", "median" as never)).toThrow(/one of sum/);
    const plain = make();
    plain.createTable("Sheet1", "A1:D5", { name: "Sales" });
    expect(() => plain.setTableTotalsFunction("Sales", "Qty", "sum")).toThrow(/no totals row/);
  });

  it("leaves out hidden rows (the 100s) however they got hidden, and rows a filter hid", () => {
    const s = withTotals();
    s.setTableTotalsFunction("Sales", "Qty", "sum");
    s.setTableTotalsFunction("Sales", "Amount", "average");
    expect(s.value("Sheet1", "C6")).toBe(12);
    hide(s, 3);
    expect(s.value("Sheet1", "C6")).toBe(10);
    expect(s.value("Sheet1", "D6")).toBeCloseTo(52 / 3, 10);
    hide(s, 3, false);
    s.filterTable("Sales", "Region", ["West"]);
    expect(s.value("Sheet1", "C6")).toBe(9);
    expect(s.value("Sheet1", "D6")).toBe(22.5);
    // Plain SUMs of the same column don't care what is hidden.
    s.setCell("Sheet1", "F1", "=SUM(Sales[Qty])");
    expect(s.value("Sheet1", "F1")).toBe(12);
  });

  it("is written as Excel's function names and read back", () => {
    const s = withTotals();
    s.setTableTotalsFunction("Sales", "Qty", "average");
    s.setTableTotalsFunction("Sales", "Amount", "stdDev");
    s.setTableTotalsFunction("Sales", "Product", "countNums");
    const files = unzipSync(toXlsx(s.state));
    const part = strFromU8(files["xl/tables/table1.xml"]!);
    expect(part).toContain('name="Qty" totalsRowFunction="average"');
    expect(part).toContain('name="Amount" totalsRowFunction="stdDev"');
    expect(part).toContain('name="Product" totalsRowFunction="countNums"');
    expect(part).toContain('name="Region" totalsRowLabel="Total"');
    const back = fromXlsx(toXlsx(s.state));
    const t = new SheetSession(back.workbook);
    expect(t.tableTotals("Sales")).toEqual({ Region: "label", Product: "countNums", Qty: "average", Amount: "stdDev" });
    expect(t.value("Sheet1", "C6")).toBe(3);
  });
});

describe("Subtotal with merged cells", () => {
  it("reads a merged label down the group column as the name of every row it covers", () => {
    const s = make();
    s.mergeCells("Sheet1", "A2:A3");
    s.mergeCells("Sheet1", "A4:A5");
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    // The rows under a merged label hold nothing in column A, but belong to its group.
    expect(col(s, "A", 8)).toEqual(["Region", "East", "", "East Total", "West", "", "West Total", "Grand Total"]);
    expect(col(s, "C", 8)).toEqual(["Qty", "1", "2", "3", "4", "5", "9", "12"]);
    expect(s.sheet("Sheet1").merges).toEqual(["A2:A3", "A5:A6"]);
    s.removeSubtotals("Sheet1", "A1:D8");
    expect(s.sheet("Sheet1").merges).toEqual(["A2:A3", "A4:A5"]);
  });

  it("carries a merge across columns in the list with its row, and merges beside the list", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B1".replace("A1:B1", "F4:G4")); // beside the list, in a row of it
    s.mergeCells("Sheet1", "H1:I2");
    s.mergeCells("Sheet1", "F9:G10"); // under it
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    // F4:G4 was on the East/West boundary row (West Ink), it moves down one row with that row; H1:I2 is above the first insertion.
    expect(s.sheet("Sheet1").merges).toEqual(["F5:G5", "H1:I2", "F12:G13"]);
  });

  it("refuses a merge that a subtotal row would cut through, naming it", () => {
    const s = make();
    s.mergeCells("Sheet1", "C3:C4");
    expect(() => s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/merged cells C3:C4 run across a place where a subtotal goes/);
    const t = make();
    t.mergeCells("Sheet1", "F2:F5"); // beside the list, over all its rows: the whole rows go in through it
    expect(() => t.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/merged cells F2:F5/);
    const u = make();
    u.mergeCells("Sheet1", "A1:A2");
    expect(() => u.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/run past the edge of the list/);
    const v = make();
    v.mergeCells("Sheet1", "B5:B6");
    expect(() => v.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/run past the edge of the list/);
    // Nothing changed in any of them.
    expect(v.sheet("Sheet1").merges).toEqual(["B5:B6"]);
    expect(col(v, "A", 6)).toEqual(["Region", "East", "East", "West", "West", ""]);
  });

  it("is happy with a merge inside one group (it is not cut)", () => {
    const s = make();
    s.mergeCells("Sheet1", "C2:C3"); // both East rows
    s.mergeCells("Sheet1", "B4:C4"); // across two columns of one row
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Amount"] });
    expect(s.sheet("Sheet1").merges).toEqual(["C2:C3", "B5:C5"]);
    expect(s.value("Sheet1", "D4")).toBe(17);
  });

  it("will not take subtotals out through a merge across a subtotal row", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    s.mergeCells("Sheet1", "D3:D5");
    expect(() => s.removeSubtotals("Sheet1", "A1:D8")).toThrow(/merged cells D3:D5/);
    s.unmergeCells("Sheet1", "D3:D5");
    expect(s.removeSubtotals("Sheet1", "A1:D8")).toBe(3);
  });

  it("will not sort a list with merged cells first, and says so before changing anything", () => {
    const s = new SheetSession(createWorkbook("m", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["K", "V"], ["b", 1], ["a", 2], ["b", 3]]);
    s.mergeCells("Sheet1", "B4:C4");
    expect(() => s.subtotal("Sheet1", "A1:B4", { by: "K", columns: ["V"], sort: true })).toThrow(/merged/);
    expect(col(s, "A", 4)).toEqual(["K", "b", "a", "b"]);
  });
});

describe("Subtotal and pivot tables", () => {
  const withPivot = (anchor: string) => {
    const s = make(["Sheet1"]);
    s.createPivot("Sheet1", { name: "PT", source: "Sheet1!A1:D5", anchor, rows: ["Region"], values: [{ field: "Qty" }] });
    return s;
  };

  it("is refused over a pivot table, like Excel's greyed button, in both directions", () => {
    const s = withPivot("A8");
    expect(() => s.subtotal("Sheet1", "A8:B11", { by: "Row Labels", columns: ["Sum of Qty"] })).toThrow(/pivot table can't be subtotalled \(PT is in the way\).*subtotals of its own/);
    expect(() => s.subtotal("Sheet1", "A8", { by: "A", columns: ["B"] })).toThrow(/pivot table can't be subtotalled/);
    expect(() => s.removeSubtotals("Sheet1", "A8:B11")).toThrow(/pivot table/);
  });

  it("is refused where the pivot table lies across the rows that would get subtotals", () => {
    const s = withPivot("G2"); // beside the list, in its rows
    expect(() => s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] })).toThrow(/pivot table PT lies across rows where subtotals go/);
    expect(s.pivots("Sheet1")[0]!.range).toBe("G2:H5");
    expect(col(s, "A", 5)).toEqual(["Region", "East", "East", "West", "West"]);
  });

  it("leaves a pivot table below (or above) the list alone but for the move, GETPIVOTDATA cells included", () => {
    const s = withPivot("A12");
    s.setCell("Sheet1", "F1", '=GETPIVOTDATA("Sum of Qty",A12,"Region","West")');
    expect(s.value("Sheet1", "F1")).toBe(9);
    const before = s.values("Sheet1", "A12:B15");
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    // Three rows went in above it (two groups and the grand total).
    expect(s.pivots("Sheet1")[0]!.range).toBe("A15:B18");
    expect(s.pivots("Sheet1")[0]!.anchor).toBe("A15");
    expect(s.values("Sheet1", "A15:B18")).toEqual(before);
    expect(s.cell("Sheet1", "F1")!.f).toBe('GETPIVOTDATA("Sum of Qty",A15,"Region","West")');
    expect(s.value("Sheet1", "F1")).toBe(9);
    s.undo();
    expect(s.pivots("Sheet1")[0]!.range).toBe("A12:B15");
  });
});

describe("Subtotal sorting the list first", () => {
  const messy = () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["K", "V"], ["b", 1], ["a", 2], ["b", 3], ["a", 4], ["c", 5]]);
    return s;
  };

  it("sorts by the column and subtotals, as one undo step", () => {
    const s = messy();
    const r = s.subtotal("Sheet1", "A1:B6", { by: "K", columns: ["V"], sort: true });
    expect(r.groups).toBe(3);
    expect(col(s, "A", 10)).toEqual(["K", "a", "a", "a Total", "b", "b", "b Total", "c", "c Total", "Grand Total"]);
    expect(col(s, "B", 10)).toEqual(["V", "2", "4", "6", "1", "3", "4", "5", "5", "15"]);
    s.undo();
    expect(col(s, "A", 7)).toEqual(["K", "b", "a", "b", "a", "c", ""]);
    s.redo();
    expect(col(s, "A", 4)).toEqual(["K", "a", "a", "a Total"]);
  });

  it("can sort descending, and does without when the list is in order", () => {
    const s = messy();
    s.subtotal("Sheet1", "A1:B6", { by: "K", columns: ["V"], sort: "descending" });
    expect(col(s, "A", 5)).toEqual(["K", "c", "c Total", "b", "b"]);
  });

  it("asks nothing of the list when it is not asked to sort (a changing column makes more groups)", () => {
    const s = messy();
    expect(s.subtotal("Sheet1", "A1:B6", { by: "K", columns: ["V"] }).groups).toBe(5);
  });

  it("leaves the list as it was when the command is refused after the check", () => {
    const s = messy();
    s.setCell("Sheet1", "D1", "x");
    expect(() => s.subtotal("Sheet1", "A1:B6", { by: "Nope", columns: ["V"], sort: true })).toThrow(/no column/);
    expect(col(s, "A", 6)).toEqual(["K", "b", "a", "b", "a", "c"]);
  });

  it("works with a table converted first: the sorted rows keep their formulas", () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["K", "V", "W"], ["b", 1, null], ["a", 2, null]]);
    s.setCell("Sheet1", "C2", "=B2*2");
    s.setCell("Sheet1", "C3", "=B3*2");
    s.createTable("Sheet1", "A1:C3", { name: "T" });
    s.subtotal("Sheet1", "A1:C3", { by: "K", columns: ["V", "W"], sort: true, convertTable: true });
    expect(col(s, "A", 7)).toEqual(["K", "a", "a Total", "b", "b Total", "Grand Total", ""]);
    expect(col(s, "C", 6)).toEqual(["W", "4", "4", "2", "2", "6"]);
    expect(s.tables("Sheet1")).toHaveLength(0);
    s.undo();
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(col(s, "A", 3)).toEqual(["K", "b", "a"]);
  });
});

describe("SUBTOTAL, a collapsed group and a filter", () => {
  it("counts rows a group hid as hidden, not as filtered, even inside the filter's range", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:D5");
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    s.setCell("Sheet1", "F1", "=SUBTOTAL(9,C2:C8)");
    s.setCell("Sheet1", "F2", "=SUBTOTAL(109,C2:C8)");
    expect(s.value("Sheet1", "F1")).toBe(12);
    s.toggleGroup("Sheet1", "row", 4); // fold East
    expect(s.value("Sheet1", "F1")).toBe(12); // hidden by the group: 1 to 11 still count them
    expect(s.value("Sheet1", "F2")).toBe(9);
    s.toggleGroup("Sheet1", "row", 4);
    // Hidden by a filter of the sheet: neither kind counts them.
    s.filterColumn("Sheet1", 1, ["West"]);
    expect(s.value("Sheet1", "F1")).toBe(9);
    expect(s.value("Sheet1", "F2")).toBe(9);
  });
});

describe("Subtotal of a sheet with links, themes and the rest", () => {
  it("survives a round trip through JSON with the new options out of the model", () => {
    const s = make();
    s.subtotal("Sheet1", "A1:D5", { by: "Region", columns: ["Qty"] });
    const again = new SheetSession(parseWorkbook(serializeWorkbook(s.state)));
    expect(col(again, "A", 8)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total"]);
  });
});
