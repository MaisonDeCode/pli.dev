import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, isError, toXlsx, type Value } from "../src";

const make = (cells: Record<string, string | number | boolean> = {}) => {
  const s = new SheetSession(createWorkbook(), { now: () => 45000.5, random: () => 0.5 });
  s.setCells("Sheet1", cells);
  return s;
};
const calc = (f: string, cells: Record<string, string | number | boolean> = {}): Value => {
  const s = make({ ...cells, Z99: "=" + f });
  const v = s.value("Sheet1", "Z99");
  return isError(v) ? ({ error: v.error } as never) : v;
};
const grid = (f: string, range: string, cells: Record<string, string | number | boolean> = {}) => {
  const s = make({ ...cells, A20: "=" + f });
  return s.values("Sheet1", range).map((r) => r.map((v) => (isError(v) ? v.error : v)));
};

describe("text that LibreOffice doesn't have", () => {
  it("TEXTSPLIT in two directions, with options", () => {
    expect(grid("TEXTSPLIT(\"a,b;c,d,e\",\",\",\";\")", "A20:C21")).toEqual([["a", "b", "#N/A"], ["c", "d", "e"]]);
    expect(grid("TEXTSPLIT(\"a,,b\",\",\",,TRUE)", "A20:B20")).toEqual([["a", "b"]]);
    expect(grid("TEXTSPLIT(\"a1b2c\",{\"1\",\"2\"})", "A20:C20")).toEqual([["a", "b", "c"]]);
    expect(grid("TEXTSPLIT(\"A-b\",\"a\",,,1)", "A20:B20")).toEqual([["", "-b"]]);
    expect(grid("TEXTSPLIT(\"a,b;c\",\",\",\";\",,,\"-\")", "A20:B21")).toEqual([["a", "b"], ["c", "-"]]);
  });

  it("regular expressions", () => {
    expect(calc('REGEXTEST("abc123","\\d+")')).toBe(true);
    expect(calc('REGEXTEST("ABC","abc")')).toBe(false);
    expect(calc('REGEXTEST("ABC","abc",1)')).toBe(true);
    expect(calc('REGEXEXTRACT("order 123 and 456","\\d+")')).toBe("123");
    expect(grid('REGEXEXTRACT("order 123 and 456","\\d+",1)', "A20:A21")).toEqual([["123"], ["456"]]);
    expect(grid('REGEXEXTRACT("2024-03-05","(\\d+)-(\\d+)-(\\d+)",2)', "A20:C20")).toEqual([["2024", "03", "05"]]);
    expect(calc('REGEXEXTRACT("abc","\\d")')).toEqual({ error: "#N/A" });
    expect(calc('REGEXREPLACE("a1b22","\\d+","#")')).toBe("a#b#");
    expect(calc('REGEXREPLACE("a1b22","\\d+","#",2)')).toBe("a1b#");
    expect(calc('REGEXREPLACE("john smith","(\\w+) (\\w+)","$2, $1")')).toBe("smith, john");
    expect(calc('REGEXTEST("a","(")')).toEqual({ error: "#VALUE!" });
  });

  it("VALUETOTEXT and ARRAYTOTEXT", () => {
    expect(calc('VALUETOTEXT("hi")')).toBe("hi");
    expect(calc('VALUETOTEXT("hi",1)')).toBe('"hi"');
    expect(calc("VALUETOTEXT(1.5)")).toBe("1.5");
    expect(calc("VALUETOTEXT(TRUE)")).toBe("TRUE");
    expect(calc("ARRAYTOTEXT({1,2;3,4})")).toBe("1, 2, 3, 4");
    expect(calc('ARRAYTOTEXT({1,"a";3,4},1)')).toBe('{1,"a";3,4}');
  });
});

describe("information and arrays", () => {
  it("FORMULATEXT, SHEET, SHEETS, CELL, HYPERLINK, AREAS", () => {
    const s = make({ A1: 1, A2: "=A1+1" });
    s.addSheet("Other");
    s.setCells("Sheet1", { B1: "=FORMULATEXT(A2)", B2: "=FORMULATEXT(A1)", B3: "=SHEET()", B4: '=SHEET("Other")', B5: "=SHEETS()", B6: '=CELL("row",C7)', B7: '=CELL("address",C7)', B8: '=CELL("col",C7)', B9: '=HYPERLINK("https://pli.dev","Pli")', B10: "=AREAS(A1:B2)" });
    expect(s.values("Sheet1", "B1:B10").flat()).toEqual(["=A1+1", { error: "#N/A" }, 1, 2, 2, 7, "$C$7", 3, "Pli", 1].map((v) => (typeof v === "object" ? expect.objectContaining({ error: "#N/A" }) : v)));
  });

  it("FORMULATEXT and ISFORMULA follow the cell they look at", () => {
    const s = make({ B1: "=FORMULATEXT(A1)", B2: "=ISFORMULA(A1)" });
    expect(s.values("Sheet1", "B1:B2").flat()).toEqual([expect.objectContaining({ error: "#N/A" }), false]);
    s.setCell("Sheet1", "A1", "=1+1");
    expect(s.values("Sheet1", "B1:B2").flat()).toEqual(["=1+1", true]);
    s.setCell("Sheet1", "A1", 5);
    expect(s.value("Sheet1", "B2")).toBe(false);
  });

  it("MODE.MULT, FREQUENCY, TREND, MINVERSE and MUNIT spill", () => {
    expect(grid("MODE.MULT(A1:A6)", "A20:A22", { A1: 1, A2: 2, A3: 2, A4: 3, A5: 3, A6: 4 })).toEqual([[2], [3], [null]]);
    expect(grid("FREQUENCY(A1:A6,{2,3})", "A20:A23", { A1: 1, A2: 2, A3: 2, A4: 3, A5: 3, A6: 4 })).toEqual([[3], [2], [1], [null]]);
    const trend = grid("TREND(B1:B3,A1:A3,{4,5})", "A20:B20", { A1: 1, A2: 2, A3: 3, B1: 2, B2: 4, B3: 6 }); // the shape of the new x's, as in LibreOffice
    expect(trend.length).toBe(1);
    expect(trend[0]![0]).toBeCloseTo(8, 12);
    expect(trend[0]![1]).toBeCloseTo(10, 12);
    expect(grid("MINVERSE({4,7;2,6})", "A20:B21")).toEqual([[0.6, -0.7], [-0.2, 0.4]].map((r) => r.map((x) => expect.closeTo(x, 10) as never)));
    expect(grid("MUNIT(2)", "A20:B21")).toEqual([[1, 0], [0, 1]]);
    expect(calc("MDETERM({1,2;3,4})")).toBeCloseTo(-2, 10);
    expect(calc("MINVERSE({1,2;2,4})")).toEqual({ error: "#NUM!" });
  });

  it("errors on bad arguments", () => {
    expect(calc("NORM.S.INV(1.5)")).toEqual({ error: "#NUM!" });
    expect(calc("TAKE(A1:A3,0)")).toEqual({ error: "#CALC!" });
    expect(calc("FILTER(A1:A3,B1:B2)")).toEqual({ error: "#VALUE!" });
    expect(calc("CONVERT(1,\"m\",\"kg\")")).toEqual({ error: "#N/A" });
    expect(calc("DEC2BIN(600)")).toEqual({ error: "#NUM!" });
    expect(calc("BASE(5,1)")).toEqual({ error: "#NUM!" });
    expect(calc("SORT(A1:A3,5)")).toEqual({ error: "#VALUE!" });
  });
});

describe("array formulas in XLSX", () => {
  it("are written as array formulas over what they fill and read back", () => {
    const s = make({ A1: 3, A2: 1, A3: 2, C1: "=SORT(A1:A3)", E1: "=SUM(C1:C3)", E2: '=LET(x,A1,y,x*2,y+1)', E3: "=MAP(A1:A3,LAMBDA(v,v*10))" });
    const bytes = toXlsx(s.state, { now: () => 45000.5 });
    const { workbook, warnings } = fromXlsx(bytes);
    expect(warnings).toEqual([]);
    const t = new SheetSession(workbook, { now: () => 45000.5 });
    expect(t.cell("Sheet1", "C1")?.f).toBe("SORT(A1:A3)");
    expect(t.cell("Sheet1", "C2")).toBeUndefined(); // spilled values are results, not cells
    expect(t.values("Sheet1", "C1:C3")).toEqual([[1], [2], [3]]);
    expect(t.value("Sheet1", "E1")).toBe(6);
    expect(t.value("Sheet1", "E2")).toBe(7);
    expect(t.cell("Sheet1", "E2")?.f).toBe("LET(x,A1,y,x*2,y+1)");
    expect(t.cell("Sheet1", "E3")?.f).toBe("MAP(A1:A3,LAMBDA(v,v*10))");
  });
});
