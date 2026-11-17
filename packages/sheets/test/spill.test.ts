import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, isError, type Value } from "../src";

const make = (cells: Record<string, string | number | boolean> = {}) => {
  const s = new SheetSession(createWorkbook(), { now: () => 45000.5, random: () => 0.5 });
  s.setCells("Sheet1", cells);
  return s;
};
const col = (s: SheetSession, range: string) => s.values("Sheet1", range).map((r) => r.map((v) => (isError(v) ? v.error : v)));

describe("spilling", () => {
  it("a formula that gives several values fills the cells beside it", () => {
    const s = make({ A1: 1, A2: 2, A3: 3, B1: "=A1:A3*10" });
    expect(col(s, "B1:B4")).toEqual([[10], [20], [30], [null]]);
    expect(s.calculator.spillRange("Sheet1", 1, 2)).toEqual({ r1: 1, c1: 2, r2: 3, c2: 2 });
    expect(s.calculator.spillAt("Sheet1", 2, 2)).toEqual({ value: 20, owner: { row: 1, col: 2 } });
    expect(s.cell("Sheet1", "B2")).toBeUndefined(); // only B1 holds the formula
  });

  it("what reads the spilled cells follows them as they change", () => {
    const s = make({ A1: 1, A2: 2, A3: 3, B1: "=A1:A3*10", D1: "=SUM(B1:B5)", D2: "=B3+1", D3: "=COUNT(B:B)" });
    expect(s.value("Sheet1", "D1")).toBe(60);
    expect(s.value("Sheet1", "D2")).toBe(31);
    expect(s.value("Sheet1", "D3")).toBe(3);
    s.setCell("Sheet1", "A2", 5);
    expect(s.value("Sheet1", "D1")).toBe(90);
    s.setCell("Sheet1", "A4", 4); // the range the formula reads stays A1:A3, so nothing grows
    expect(s.value("Sheet1", "D3")).toBe(3);
    s.setCell("Sheet1", "B1", "=A1:A4*10"); // now it is longer
    expect(s.value("Sheet1", "D1")).toBe(130);
    expect(s.value("Sheet1", "D3")).toBe(4);
    s.setCell("Sheet1", "B1", null); // and when the formula goes, so do its results
    expect(s.value("Sheet1", "D1")).toBe(0);
    expect(s.value("Sheet1", "B2")).toBe(null);
    s.undo();
    expect(s.value("Sheet1", "D1")).toBe(130);
  });

  it("anything in the way gives #SPILL!, and clearing it lets the results in", () => {
    const s = make({ A1: 1, A2: 2, A3: 3, B2: "in the way", B1: "=A1:A3*2" });
    expect(col(s, "B1:B3")).toEqual([["#SPILL!"], ["in the way"], [null]]);
    s.setCell("Sheet1", "B2", null);
    expect(col(s, "B1:B3")).toEqual([[2], [4], [6]]);
    s.setCell("Sheet1", "B3", "typed"); // typing into a spilled cell blocks it again
    expect(col(s, "B1:B3")[0]).toEqual(["#SPILL!"]);
  });

  it("two formulas can't claim the same cells", () => {
    const s = make({ A5: "=SEQUENCE(1,3)", B4: "=SEQUENCE(3,1)" });
    const v = [...col(s, "A5:C5"), ...col(s, "B4:B6")].flat();
    expect(v.filter((x) => x === "#SPILL!")).toHaveLength(1); // whichever came second
  });

  it("two-dimensional results spill in both directions, and fit what reads them", () => {
    const s = make({ A1: "=SEQUENCE(2,3)", E1: "=SUM(A1:C2)", E2: "=INDEX(A1:C2,2,3)" });
    expect(col(s, "A1:C2")).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(s.value("Sheet1", "E1")).toBe(21);
    expect(s.value("Sheet1", "E2")).toBe(6);
    expect(s.usedRange("Sheet1")).toBe("A1:E2");
  });

  it("works across sheets and with structural changes", () => {
    const s = make({ A1: "=SEQUENCE(3)" });
    s.addSheet("Other");
    s.setCell("Other", "A1", "=SUM(Sheet1!A1:A3)");
    expect(s.value("Other", "A1")).toBe(6);
    s.insertRows("Sheet1", 1);
    expect(col(s, "A1:A5")).toEqual([[null], [1], [2], [3], [null]]);
    expect(s.value("Other", "A1")).toBe(6);
  });
});

describe("files", () => {
  it("CSV includes what formulas spilled", async () => {
    const { toCsv } = await import("../src");
    const s = make({ A1: "=SEQUENCE(3)" });
    expect(toCsv(s.calculator, "Sheet1")).toBe("1\n2\n3\n");
  });
});

describe("LET and LAMBDA", () => {
  const calc = (f: string, cells: Record<string, string | number> = {}): Value => {
    const s = make({ ...cells, Z9: "=" + f });
    return s.value("Sheet1", "Z9");
  };

  it("LET names values for the calculation, in order", () => {
    expect(calc("LET(x,5,y,x*2,x+y)")).toBe(15);
    expect(calc("LET(a,A1:A3,SUM(a)*2)", { A1: 1, A2: 2, A3: 3 })).toBe(12);
    expect(calc("LET(x,1,x+1)+LET(x,10,x)")).toBe(12);
    expect(isError(calc("LET(x,5)"))).toBe(true);
  });

  it("LAMBDA can be named and called, and passed to MAP, REDUCE, SCAN, BYROW, BYCOL and MAKEARRAY", () => {
    expect(calc("LET(double,LAMBDA(x,x*2),double(21))")).toBe(42);
    expect(calc("LET(f,LAMBDA(a,b,a*b+1),f(3,4))")).toBe(13);
    expect(calc("SUM(MAP(A1:A3,LAMBDA(v,v*v)))", { A1: 1, A2: 2, A3: 3 })).toBe(14);
    expect(calc("SUM(MAP(A1:A3,B1:B3,LAMBDA(a,b,a*b)))", { A1: 1, A2: 2, A3: 3, B1: 4, B2: 5, B3: 6 })).toBe(32);
    expect(calc("REDUCE(0,A1:A4,LAMBDA(acc,v,acc+v))", { A1: 1, A2: 2, A3: 3, A4: 4 })).toBe(10);
    expect(calc("REDUCE(1,A1:A4,LAMBDA(acc,v,acc*v))", { A1: 1, A2: 2, A3: 3, A4: 4 })).toBe(24);
    expect(calc("INDEX(SCAN(0,A1:A4,LAMBDA(acc,v,acc+v)),4)", { A1: 1, A2: 2, A3: 3, A4: 4 })).toBe(10);
    expect(calc("SUM(BYROW(A1:B2,LAMBDA(r,MAX(r))))", { A1: 1, B1: 9, A2: 5, B2: 3 })).toBe(14);
    expect(calc("MAX(BYCOL(A1:B2,LAMBDA(c,SUM(c))))", { A1: 1, B1: 9, A2: 5, B2: 3 })).toBe(12);
    expect(calc("SUM(MAKEARRAY(2,3,LAMBDA(r,c,r*c)))")).toBe(18);
    expect(isError(calc("LAMBDA(x,x)"))).toBe(true); // a function isn't a value
    expect(isError(calc("LET(f,LAMBDA(a,a),f(1,2))"))).toBe(true);
  });
});

describe("dynamic array functions", () => {
  const data = { A1: "b", A2: "a", A3: "c", A4: "a", B1: 2, B2: 1, B3: 3, B4: 1 };
  const out = (f: string, range = "D1:D6"): Value[][] => {
    const s = make({ ...data, D1: "=" + f });
    return col(s, range);
  };

  it("FILTER, SORT, SORTBY, UNIQUE", () => {
    expect(out("FILTER(A1:A4,B1:B4>1)", "D1:D3")).toEqual([["b"], ["c"], [null]]);
    expect(out('FILTER(A1:A4,B1:B4>9,"none")', "D1:D2")).toEqual([["none"], [null]]);
    expect(out("FILTER(A1:A4,B1:B4>9)", "D1:D1")).toEqual([["#CALC!"]]);
    expect(out("SORT(A1:A4)", "D1:D4")).toEqual([["a"], ["a"], ["b"], ["c"]]);
    expect(out("SORT(A1:B4,2,-1)", "D1:E4")).toEqual([["c", 3], ["b", 2], ["a", 1], ["a", 1]]);
    expect(out("SORTBY(A1:A4,B1:B4,-1)", "D1:D4")).toEqual([["c"], ["b"], ["a"], ["a"]]);
    expect(out("UNIQUE(A1:A4)", "D1:D4")).toEqual([["b"], ["a"], ["c"], [null]]);
    expect(out("UNIQUE(A1:A4,FALSE,TRUE)", "D1:D3")).toEqual([["b"], ["c"], [null]]);
    expect(out("UNIQUE(A1:B4)", "D1:E4")[2]).toEqual(["c", 3]);
  });

  it("TAKE, DROP, CHOOSECOLS, CHOOSEROWS, VSTACK, HSTACK, TOCOL, TOROW, WRAPROWS, EXPAND, TRANSPOSE", () => {
    expect(out("TAKE(A1:A4,2)", "D1:D3")).toEqual([["b"], ["a"], [null]]);
    expect(out("TAKE(A1:A4,-1)", "D1:D2")).toEqual([["a"], [null]]);
    expect(out("DROP(A1:A4,3)", "D1:D2")).toEqual([["a"], [null]]);
    expect(out("CHOOSECOLS(A1:B2,2)", "D1:D2")).toEqual([[2], [1]]);
    expect(out("CHOOSEROWS(A1:B4,-1,1)", "D1:E2")).toEqual([["a", 1], ["b", 2]]);
    expect(out("VSTACK(A1:A2,B1:B1)", "D1:D4")).toEqual([["b"], ["a"], [2], [null]]);
    expect(out("HSTACK(A1:A2,B1:B2)", "D1:E2")).toEqual([["b", 2], ["a", 1]]);
    expect(out("TOCOL(A1:B2)", "D1:D5")).toEqual([["b"], [2], ["a"], [1], [null]]);
    expect(out("TOROW(A1:A3)", "D1:F1")).toEqual([["b", "a", "c"]]);
    expect(out("WRAPROWS(B1:B4,3)", "D1:F2")).toEqual([[2, 1, 3], [1, "#N/A", "#N/A"]]);
    expect(out("EXPAND(B1:B2,3,2,0)", "D1:E3")).toEqual([[2, 0], [1, 0], [0, 0]]);
    expect(out("TRANSPOSE(B1:B3)", "D1:F1")).toEqual([[2, 1, 3]]);
    expect(out("RANDARRAY(2,2)", "D1:E2")).toEqual([[0.5, 0.5], [0.5, 0.5]]);
  });

  it("combine with other functions", () => {
    const s = make({ ...data, D1: "=SUM(FILTER(B1:B4,A1:A4=\"a\"))", D2: "=ROWS(UNIQUE(A1:A4))", D3: "=INDEX(SORT(B1:B4,1,-1),1)", D4: "=TEXTJOIN(\",\",TRUE,SORT(UNIQUE(A1:A4)))" });
    expect(s.values("Sheet1", "D1:D4")).toEqual([[2], [3], [3], ["a,b,c"]]);
  });
});
