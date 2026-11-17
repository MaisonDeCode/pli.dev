import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";
import { sheetReducer, type SheetOp } from "../src/ops";

const apply = (s: SheetSession, op: SheetOp) => sheetReducer.apply(s.state, op);

describe("rows put in or taken out at many places at once", () => {
  const make = () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1", "Other"]));
    s.setValues("Sheet1", "A1", [["h"], [1], [2], [3], [4], [5]]);
    s.setCell("Sheet1", "B1", "=SUM(A2:A6)");
    s.setCell("Sheet1", "B2", "=A3");
    s.setCell("Other", "A1", "=Sheet1!A6");
    return s;
  };
  it("insert_row_runs gives the same sheet as the same inserts one after another", () => {
    const s = make();
    const batched = apply(s, { type: "insert_row_runs", sheet: s.sheet("Sheet1").id, runs: [[3, 1], [5, 2], [2, 1]] }).state;
    let one = s.state;
    // From the bottom up, each in the rows as they were.
    for (const [at, count] of [[5, 2], [3, 1], [2, 1]] as const) one = sheetReducer.apply(one, { type: "insert_rows", sheet: s.sheet("Sheet1").id, at, count }).state;
    expect(batched).toEqual(one);
    expect(batched.sheets[0]!.cells["B1"]!.f).toBe("SUM(A3:A10)");
    expect(batched.sheets[1]!.cells["A1"]!.f).toBe("Sheet1!A10");
  });
  it("delete_row_runs gives the same sheet as the same deletes one after another", () => {
    const s = make();
    const id = s.sheet("Sheet1").id;
    const batched = apply(s, { type: "delete_row_runs", sheet: id, runs: [[2, 1], [4, 2]] }).state;
    let one = s.state;
    for (const [at, count] of [[4, 2], [2, 1]] as const) one = sheetReducer.apply(one, { type: "delete_rows", sheet: id, at, count }).state;
    expect(batched).toEqual(one);
    expect(batched.sheets[0]!.cells["B1"]!.f).toBe("SUM(A2:A3)");
    expect(batched.sheets[0]!.cells["B2"]).toBeUndefined();
  });
  it("moves everything that points at rows the way the one-at-a-time inserts do", () => {
    const s = make();
    const id = s.sheet("Sheet1").id;
    s.mergeCells("Sheet1", "D3:E5");
    s.setPrintArea("Sheet1", ["A1:B6"]);
    s.setPageBreak("Sheet1", "row", 4);
    s.addChart("Sheet1", { series: [{ values: "Sheet1!A2:A6" }] });
    s.addSparklines("Sheet1", { location: "C7", data: "A2:A6" });
    s.createTable("Sheet1", "F8:G12");
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: [2], ranges: ["A2:A6"], style: { bold: true } } as never);
    s.groupRows("Sheet1", 3, 4);
    const ins = [[2, 2], [4, 1], [6, 3]] as const;
    const batched = apply(s, { type: "insert_row_runs", sheet: id, runs: ins.map((r) => [...r] as [number, number]) }).state;
    let one = s.state;
    for (const [at, count] of [...ins].reverse()) one = sheetReducer.apply(one, { type: "insert_rows", sheet: id, at, count }).state;
    expect(batched).toEqual(one);
    const gone = [[2, 1], [3, 2], [6, 1]] as const;
    const b2 = apply(s, { type: "delete_row_runs", sheet: id, runs: gone.map((r) => [...r] as [number, number]) }).state;
    let two = s.state;
    for (const [at, count] of [...gone].reverse()) two = sheetReducer.apply(two, { type: "delete_rows", sheet: id, at, count }).state;
    expect(b2).toEqual(two);
  });
  it("undoes as one step", () => {
    const s = make();
    const before = JSON.stringify(s.state);
    s.subtotal("Sheet1", "A1:A6", { by: "A", columns: ["A"] });
    s.undo();
    expect(JSON.stringify(s.state)).toBe(before);
  });
});

describe("a big list is subtotalled in one go", () => {
  it("40,000 rows in 8,000 groups, with no cap", () => {
    const s = new SheetSession(createWorkbook("n", ["Sheet1"]));
    const rows = Array.from({ length: 40_000 }, (_, i) => [`g${Math.floor(i / 5)}`, i + 1]);
    s.setValues("Sheet1", "A1", [["K", "V"], ...rows]);
    const t = Date.now();
    const r = s.subtotal("Sheet1", "A1:B40001", { by: "K", columns: ["V"] });
    const took = Date.now() - t;
    expect(r.groups).toBe(8_000);
    expect(r.added).toBe(8_001);
    // The first group's subtotal is the sum of 1..5; the grand total is the sum of everything.
    expect(s.value("Sheet1", "B7")).toBe(15);
    expect(s.value("Sheet1", `B${40_001 + 8_001}`)).toBe((40_000 * 40_001) / 2);
    expect(took).toBeLessThan(15_000);
    const u = Date.now();
    s.removeSubtotals("Sheet1", "A1:B48002");
    expect(s.value("Sheet1", "B40001")).toBe(40_000);
    expect(Date.now() - u).toBeLessThan(15_000);
  });
});
