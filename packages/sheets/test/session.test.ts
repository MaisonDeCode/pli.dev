import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromCsv, parseCsv, parseWorkbook, serializeWorkbook, shiftFormula, toCsv, validateWorkbook, cellFromInput, isError } from "../src";

const make = (cells: Record<string, string | number | boolean> = {}) => {
  const s = new SheetSession(createWorkbook("t"));
  s.setCells("Sheet1", cells);
  return s;
};

describe("typing into cells", () => {
  it("reads typed text like Excel", () => {
    expect(cellFromInput("=SUM(A1:A2)")).toEqual({ f: "SUM(A1:A2)" });
    expect(cellFromInput("42")).toEqual({ v: 42 });
    expect(cellFromInput("-1.5e3")).toEqual({ v: -1500 });
    expect(cellFromInput("true")).toEqual({ v: true });
    expect(cellFromInput("#n/a")).toEqual({ e: "#N/A" });
    expect(cellFromInput("12%")).toEqual({ v: 0.12, fmt: "0%" });
    expect(cellFromInput("12.5%")).toEqual({ v: 0.125, fmt: "0.0%" });
    expect(cellFromInput("$1,234.50")).toEqual({ v: 1234.5, fmt: "$#,##0.00" });
    expect(cellFromInput("1,234")).toEqual({ v: 1234, fmt: "#,##0" });
    expect(cellFromInput("2024-03-05")).toEqual({ v: 45356, fmt: "yyyy-mm-dd" });
    expect(cellFromInput("3/5/2024")).toEqual({ v: 45356, fmt: "m/d/yyyy" });
    expect(cellFromInput("14:30")).toEqual({ v: 14.5 / 24, fmt: "h:mm" });
    expect(cellFromInput("'123")).toEqual({ v: "123" });
    expect(cellFromInput("hello")).toEqual({ v: "hello" });
    expect(cellFromInput("")).toBeNull();
    expect(cellFromInput("1e")).toEqual({ v: "1e" });
    expect(cellFromInput("=SUM(A1:A3")).toEqual({ f: "SUM(A1:A3)" }); // closing brackets are added
    expect(cellFromInput("=IF(A1>1,SUM(B1:B2")).toEqual({ f: "IF(A1>1,SUM(B1:B2))" });
    expect(cellFromInput('=CONCAT("(",A1')).toEqual({ f: 'CONCAT("(",A1)' });
    expect(cellFromInput("=1+")).toEqual({ f: "1+" }); // other mistakes are left as typed
  });

  it("keeps a cell's format and style when its content changes", () => {
    const s = make({ A1: 1 });
    s.setFormat("Sheet1", "A1", "0.00");
    s.setStyle("Sheet1", "A1", { bold: true, fill: "#ffff00" });
    s.setCell("Sheet1", "A1", 2);
    expect(s.cell("Sheet1", "A1")).toEqual({ v: 2, fmt: "0.00", s: { bold: true, fill: "#ffff00" } });
    expect(s.display("Sheet1", "A1").text).toBe("2.00");
    s.setCell("Sheet1", "A1", null);
    expect(s.cell("Sheet1", "A1")).toEqual({ fmt: "0.00", s: { bold: true, fill: "#ffff00" } });
    s.clear("Sheet1", "A1");
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
  });

  it("undoes and redoes with formulas following", () => {
    const s = make({ A1: 1, B1: "=A1*2" });
    s.setCell("Sheet1", "A1", 10);
    expect(s.value("Sheet1", "B1")).toBe(20);
    s.undo();
    expect(s.value("Sheet1", "B1")).toBe(2);
    s.redo();
    expect(s.value("Sheet1", "B1")).toBe(20);
  });

  it("rejects bad input", () => {
    const s = make();
    expect(() => s.setCell("Sheet1", "ZZZZ1", 1)).toThrow();
    expect(() => s.setCell("Nope", "A1", 1)).toThrow(/No sheet/);
  });
});

describe("copy, fill and sort", () => {
  it("shifts relative references and keeps absolute ones", () => {
    expect(shiftFormula("A1+$B$2+C$3+$D4", 1, 1)).toBe("B2+$B$2+D$3+$D5");
    expect(shiftFormula("SUM(A1:B2)", 2, 0)).toBe("SUM(A3:B4)");
    expect(shiftFormula("A1", -1, 0)).toBe("#REF!");
    expect(shiftFormula("Sheet2!A1+'My Sheet'!B2", 1, 1)).toBe("Sheet2!B2+'My Sheet'!C3");
  });

  it("copies and cuts", () => {
    const s = make({ A1: 1, A2: "=A1+1", B1: 5 });
    s.copy({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "C1" });
    expect(s.cell("Sheet1", "C2")?.f).toBe("C1+1");
    expect(s.value("Sheet1", "C2")).toBe(2);
    s.copy({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "D5" }, { cut: true });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.cell("Sheet1", "D6")?.f).toBe("A1+1"); // moved, not copied: references stay
    s.undo();
    expect(s.cell("Sheet1", "A1")).toEqual({ v: 1 });
    expect(s.cell("Sheet1", "D6")).toBeUndefined();
  });

  it("fills down and right", () => {
    const s = make({ A1: "=B1*2", B1: 3, B2: 4, B3: 5 });
    s.fill("Sheet1", "A1:A3", "down");
    expect(s.cell("Sheet1", "A3")?.f).toBe("B3*2");
    expect(s.value("Sheet1", "A3")).toBe(10);
    s.fill("Sheet1", "A1:C1", "right");
    expect(s.cell("Sheet1", "C1")?.f).toBe("D1*2");
  });

  it("sorts rows, moving formulas with them", () => {
    const s = make({ A1: "name", B1: "n", A2: "c", B2: 3, A3: "a", B3: 1, A4: "b", B4: "=B3+10", A5: "" });
    s.sort("Sheet1", "A1:B4", { header: true });
    expect(s.values("Sheet1", "A1:B4")).toEqual([["name", "n"], ["a", 1], ["b", 11], ["c", 3]]);
    s.sort("Sheet1", "A1:B4", { header: true, by: 2, descending: true });
    expect(s.values("Sheet1", "A2:A4")).toEqual([["b"], ["c"], ["a"]]);
  });
});

describe("rows, columns and sheets", () => {
  it("insert and delete rows rewrite formulas", () => {
    const s = make({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)", B2: "=A3", B3: "=A2" });
    s.insertRows("Sheet1", 2, 2);
    expect(s.cell("Sheet1", "A4")).toEqual({ v: 2 });
    expect(s.cell("Sheet1", "B1")?.f).toBe("SUM(A1:A5)");
    expect(s.cell("Sheet1", "B4")?.f).toBe("A5");
    expect(s.value("Sheet1", "B1")).toBe(6);
    s.undo();
    expect(s.cell("Sheet1", "B1")?.f).toBe("SUM(A1:A3)");
    s.deleteRows("Sheet1", 2, 1);
    expect(s.cell("Sheet1", "B1")?.f).toBe("SUM(A1:A2)");
    expect(s.cell("Sheet1", "A2")).toEqual({ v: 3 }); // row 3 moved up into the gap
    expect(s.cell("Sheet1", "B2")?.f).toBe("#REF!"); // was B3, =A2, which pointed at the deleted row
    expect(isError(s.value("Sheet1", "B2"))).toBe(true);
    expect(s.cell("Sheet1", "B3")).toBeUndefined();
    s.undo();
    expect(s.cell("Sheet1", "B3")?.f).toBe("A2");
  });

  it("insert and delete columns", () => {
    const s = make({ A1: 1, B1: 2, C1: "=A1+B1", D1: "=SUM(A1:C1)" });
    s.insertColumns("Sheet1", 2);
    expect(s.cell("Sheet1", "D1")?.f).toBe("A1+C1");
    expect(s.cell("Sheet1", "E1")?.f).toBe("SUM(A1:D1)");
    s.deleteColumns("Sheet1", 1);
    expect(s.cell("Sheet1", "C1")?.f).toBe("#REF!+B1");
  });

  it("references on other sheets follow structural changes", () => {
    const s = make({ A1: 1, A2: 2 });
    s.addSheet("Other");
    s.setCell("Other", "A1", "=Sheet1!A2*10");
    s.insertRows("Sheet1", 1);
    expect(s.cell("Other", "A1")?.f).toBe("Sheet1!A3*10");
    expect(s.value("Other", "A1")).toBe(20);
  });

  it("renaming a sheet rewrites references, deleting one breaks them", () => {
    const s = make({ A1: 7 });
    s.addSheet("Data");
    s.setCell("Data", "A1", "=Sheet1!A1+1");
    s.renameSheet("Sheet1", "Main sheet");
    expect(s.cell("Data", "A1")?.f).toBe("'Main sheet'!A1+1");
    expect(s.value("Data", "A1")).toBe(8);
    s.deleteSheet("Main sheet");
    expect(s.cell("Data", "A1")?.f).toBe("#REF!+1");
    s.undo();
    expect(s.value("Data", "A1")).toBe(8);
    expect(() => s.renameSheet("Data", "main SHEET")).toThrow(/already/);
    expect(() => s.renameSheet("Data", "a/b")).toThrow();
    s.deleteSheet("Data");
    expect(() => s.deleteSheet("Main sheet")).toThrow(/at least one/);
  });

  it("sizes, freezing and moving sheets", () => {
    const s = make();
    s.setColumnWidth("Sheet1", 3, 20);
    s.setRowHeight("Sheet1", 2, 30);
    s.setFrozen("Sheet1", 1, 1);
    expect(s.state.sheets[0]).toMatchObject({ columns: { C: { size: 20 } }, rows: { "2": { size: 30 } }, frozen: { rows: 1, cols: 1 } });
    s.insertColumns("Sheet1", 1);
    expect(s.state.sheets[0]!.columns).toEqual({ D: { size: 20 } });
    s.undo();
    s.undo();
    s.undo();
    s.undo();
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    s.addSheet("Two");
    s.moveSheet("Two", 0);
    expect(s.state.sheets.map((x) => x.name)).toEqual(["Two", "Sheet1"]);
  });
});

describe("saving", () => {
  it("round-trips a workbook", () => {
    const s = make({ A1: 1, B1: "=A1+1", C1: "hi" });
    s.setFormat("Sheet1", "A1", "0.0");
    s.defineName("Rate", "Sheet1!$A$1");
    const text = serializeWorkbook(s.state, 2);
    const back = parseWorkbook(text);
    expect(back).toEqual(s.state);
    const t = new SheetSession(back);
    expect(t.value("Sheet1", "B1")).toBe(2);
  });

  it("names the place of a mistake", () => {
    const good = JSON.parse(serializeWorkbook(createWorkbook("x")));
    const bad = (mutate: (wb: any) => void) => {
      const copy = structuredClone(good);
      mutate(copy.workbook);
      return () => parseWorkbook(JSON.stringify(copy));
    };
    expect(bad((w) => (w.sheets[0].cells.a1 = { v: 1 }))).toThrow(/cells\.a1/);
    expect(bad((w) => (w.sheets[0].cells.A1 = { v: 1, f: "2" }))).toThrow(/not more than one/);
    expect(bad((w) => (w.sheets[0].cells.A1 = { f: "=1" }))).toThrow(/without the leading/);
    expect(bad((w) => (w.sheets[0].cells.A1 = { x: 1 }))).toThrow(/unknown field "x"/);
    expect(bad((w) => (w.sheets[0].name = "a/b"))).toThrow(/sheets\[0\]\.name/);
    expect(bad((w) => w.sheets.push({ ...w.sheets[0], id: "z" }))).toThrow(/already a sheet/);
    expect(() => parseWorkbook("{}")).toThrow(/format/);
    expect(() => validateWorkbook(null)).toThrow();
  });
});

describe("CSV", () => {
  it("parses quotes, line breaks in fields and delimiters", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",3\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "3"]]);
    expect(parseCsv("a;b\r\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
    expect(parseCsv("a,,c\n\nd")).toEqual([["a", "", "c"], [], ["d"]]);
  });

  it("reads typed values and writes values back", () => {
    const wb = fromCsv('name,qty,price,when,ok\nWidget,3,"$1,200.50",2024-03-05,TRUE\n=cmd|x,5%,,,\n');
    const s = new SheetSession(wb);
    s.setCell("Sheet1", "G2", "=B2*2");
    expect(s.values("Sheet1", "A2:E2")).toEqual([["Widget", 3, 1200.5, 45356, true]]);
    expect(s.cell("Sheet1", "A3")).toEqual({ v: "=cmd|x" }); // never a live formula
    expect(s.cell("Sheet1", "B3")).toEqual({ v: 0.05, fmt: "0%" });
    const csv = toCsv(s.calculator, "Sheet1", { range: "A1:G2" });
    expect(csv).toBe("name,qty,price,when,ok,,\nWidget,3,1200.5,45356,TRUE,,6\n");
    expect(toCsv(s.calculator, "Sheet1", { range: "C2:D2", formatted: true })).toBe('"$1,200.50",2024-03-05\n');
  });

  it("quotes what needs it", () => {
    const s = new SheetSession(createWorkbook());
    s.setCells("Sheet1", { A1: "'a,b", B1: "'say \"x\"", C1: "'  pad" });
    expect(toCsv(s.calculator, "Sheet1")).toBe('"a,b","say ""x""","  pad"\n');
  });
});
