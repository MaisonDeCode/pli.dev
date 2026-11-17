import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Dup", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty"],
    ["West", "Pens", 10],
    ["East", "Paper", 4],
    ["west", "PENS", 10],
    ["North", "Pens", 7],
    ["East", "Paper", 5],
    ["West", "Pens", 11],
  ]);
  s.createTable("Sheet1", "A1:C7", { name: "Sales" });
  return s;
};
const col = (s: SheetSession, c: string, rows: number[]) => rows.map((r) => s.value("Sheet1", `${c}${r}`));

describe("removing duplicate rows from a table", () => {
  it("keeps the first of rows that match in every column, ignoring capitals, and shrinks the table", () => {
    const s = make();
    expect(s.removeTableDuplicates("Sales")).toBe(1);
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:C6");
    expect(col(s, "C", [2, 3, 4, 5, 6])).toEqual([10, 4, 7, 5, 11]);
  });

  it("compares only the columns given (by name or number) and removes runs of rows", () => {
    const s = make();
    expect(s.removeTableDuplicates("Sales", ["Region", "Item"])).toBe(3);
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:C4");
    expect(col(s, "C", [2, 3, 4])).toEqual([10, 4, 7]);
    const t = make();
    expect(t.removeTableDuplicates("Sales", [2])).toBe(4);
    expect(col(t, "B", [2, 3])).toEqual(["Pens", "Paper"]);
    expect(t.tables("Sheet1")[0]!.range).toBe("A1:C3");
  });

  it("is one undo step, returns 0 when nothing repeats, and a total row stays", () => {
    const s = make();
    s.setTableTotals("Sales", true);
    expect(s.removeTableDuplicates("Sales", ["Region", "Item"])).toBe(3);
    expect(s.tables("Sheet1")[0]!.totals).toBe(true);
    s.undo();
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:C8");
    expect(s.removeTableDuplicates("Sales", ["Qty", "Region", "Item"])).toBe(1);
    expect(s.removeTableDuplicates("Sales", ["Qty", "Region", "Item"])).toBe(0);
  });

  it("refuses to lose cells beside the table, and asks for a column", () => {
    const s = make();
    s.setValues("Sheet1", "E4", [["note"]]);
    expect(() => s.removeTableDuplicates("Sales")).toThrow(/beside the table/);
    expect(() => s.removeTableDuplicates("Sales", [])).toThrow(/at least one column/);
    expect(() => s.removeTableDuplicates("Sales", ["Nope"])).toThrow();
  });
});

describe("removing duplicate rows from a range", () => {
  it("moves the rows below up and leaves the end empty, with the header kept", () => {
    const s = make();
    s.convertToRange("Sales");
    s.setValues("Sheet1", "D2", [["=C2*2"], [null], [null], [null], [null], ["=C7*2"]]);
    expect(s.removeDuplicates("Sheet1", "A1:D7", { header: true, columns: [1, 2, 3] })).toBe(1);
    expect(col(s, "C", [1, 2, 3, 4, 5, 6, 7])).toEqual(["Qty", 10, 4, 7, 5, 11, null]);
    expect(s.value("Sheet1", "D6")).toBe(22); // the formula moved with its row
    s.undo();
    expect(s.value("Sheet1", "C7")).toBe(11);
  });

  it("without a header box counts the first row too, and checks the columns", () => {
    const s = make();
    s.convertToRange("Sales");
    expect(s.removeDuplicates("Sheet1", "A1:A7")).toBe(3); // Region, West, East, west, North, East, West: the header is data
    expect(() => s.removeDuplicates("Sheet1", "A1:B7", { columns: [3] })).toThrow(/outside/);
    expect(() => s.removeDuplicates("Sheet1", "A1:B7", { columns: [] })).toThrow();
  });
});
