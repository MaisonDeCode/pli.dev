import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseFormula, parseWorkbook, printFormula, serializeWorkbook, toXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";

const orders = (s: SheetSession) => {
  s.setExternalTable("Prices.xlsx", { name: "Orders", sheet: "Sheet1", range: "A1:C5", columns: ["Item", "Qty", "Total"], totals: true });
  s.setExternalCells("Prices.xlsx", "Sheet1", { A1: "Item", B1: "Qty", C1: "Total", A2: "Pens", B2: 10, C2: 25, A3: "Paper", B3: 4, C3: 32, A4: "Ink", B4: 2, C4: 24.5, A5: "Total", B5: 16, C5: 81.5 });
};

describe("references to tables of other workbooks", () => {
  it("reads them in every form", () => {
    for (const f of ["SUM([Prices.xlsx]Orders[Total])", "SUM([Prices.xlsx]Sheet1!Orders[Total])", "SUM('[Old prices.xlsx]Sheet 1'!Orders[[#Data],[Qty]])", "[1]Sheet1!Orders[[#Headers],[Qty]:[Total]]", "SUM([1]!Orders[Total])"]) {
      const text = printFormula(parseFormula(f));
      expect(printFormula(parseFormula(text))).toBe(text);
    }
    expect(parseFormula("[Prices.xlsx]Orders[Total]")).toMatchObject({ t: "tref", sheet: "[Prices.xlsx]", table: "Orders", from: "Total", area: "data" });
    expect(parseFormula("[Prices.xlsx]Sheet1!Orders[[#Totals],[Qty]]")).toMatchObject({ sheet: "[Prices.xlsx]Sheet1", table: "Orders", area: "totals", from: "Qty" });
    // a sheet in front of a table of this workbook says nothing more
    expect(parseFormula("Sheet1!Orders[Total]")).toEqual({ t: "tref", table: "Orders", area: "data", from: "Total" });
  });

  it("works out from the kept cells and the table's place", () => {
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]));
    orders(s);
    s.setCell("Sheet1", "A1", "=SUM([Prices.xlsx]Orders[Total])");
    s.setCell("Sheet1", "A2", "=SUM([Prices.xlsx]Sheet1!Orders[Qty])");
    s.setCell("Sheet1", "A3", "=[Prices.xlsx]Orders[[#Totals],[Total]]");
    s.setCell("Sheet1", "A4", "=INDEX([Prices.xlsx]Orders[Item],2)");
    s.setCell("Sheet1", "A5", "=COUNTA([Prices.xlsx]Orders[[#Headers],[Item]:[Total]])");
    s.setCell("Sheet1", "A6", "=SUM([Prices.xlsx]Orders[Nothing])");
    s.setCell("Sheet1", "A7", "=SUM([Prices.xlsx]Nope[Qty])");
    s.setCell("Sheet1", "A8", "=SUM([Other.xlsx]Orders[Qty])");
    expect(s.value("Sheet1", "A1")).toBe(81.5);
    expect(s.value("Sheet1", "A2")).toBe(16);
    expect(s.value("Sheet1", "A3")).toBe(81.5);
    expect(s.value("Sheet1", "A4")).toBe("Paper");
    expect(s.value("Sheet1", "A5")).toBe(3);
    expect(s.value("Sheet1", "A6")).toEqual({ error: "#REF!" });
    expect(s.value("Sheet1", "A7")).toEqual({ error: "#REF!" });
    expect(s.value("Sheet1", "A8")).toEqual({ error: "#REF!" });
  });

  it("is not mixed up with a table of this workbook of the same name, nor renamed with it", () => {
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Item", "Qty", "Total"], ["x", 1, 100]]);
    s.createTable("Sheet1", "A1:C2", { name: "Orders" });
    orders(s);
    s.setCell("Sheet1", "E1", "=SUM([Prices.xlsx]Orders[Total])");
    s.setCell("Sheet1", "E2", "=SUM(Orders[Total])");
    expect(s.value("Sheet1", "E1")).toBe(81.5);
    expect(s.value("Sheet1", "E2")).toBe(100);
    s.renameTable("Orders", "Sales");
    expect(s.cell("Sheet1", "E1")?.f).toBe("SUM([Prices.xlsx]Orders[Total])");
    expect(s.cell("Sheet1", "E2")?.f).toBe("SUM(Sales[Total])");
  });

  it("is kept in the saved workbook, undone with the cells, and refused when wrong", () => {
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]));
    orders(s);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.externalBooks?.[0]?.tables).toEqual([{ name: "Orders", sheet: "Sheet1", range: "A1:C5", columns: ["Item", "Qty", "Total"], totals: true }]);
    expect(() => s.setExternalTable("Prices.xlsx", { name: "Bad", sheet: "Sheet1", range: "A1:C5", columns: ["a", "b"] })).toThrow(/columns/);
    expect(() => s.setExternalTable("Prices.xlsx", { name: "Bad name", sheet: "Sheet1", range: "A1:B2", columns: ["a", "b"] })).toThrow(/name/);
    s.undo();
    s.undo();
    expect(s.state.externalBooks?.[0]?.tables).toBeUndefined();
    expect(s.state.externalBooks?.[0]?.sheets["Sheet1"]).toEqual({});
  });

  it("is asked of the host: the place from externalTables, the cells from externalLists", async () => {
    const asked: string[] = [];
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]), {
      externalTables: (book, table) => (asked.push(`${book}:${table}`), book === "Prices.xlsx" && table === "Orders" ? { sheet: "Sheet1", range: "A1:C4", columns: ["Item", "Qty", "Total"] } : null),
      externalLists: (book, ref) => {
        asked.push(`${book}:${ref}`);
        return ref === "Sheet1!$C$2:$C$4" ? [25, 32, 24.5] : null;
      },
    });
    s.setCell("Sheet1", "A1", "=SUM([Prices.xlsx]Orders[Total])");
    s.setCell("Sheet1", "A2", "=SUM([Prices.xlsx]Missing[Total])");
    expect(s.value("Sheet1", "A1")).toEqual({ error: "#REF!" });
    const result = await s.refreshExternalLists();
    expect(asked).toContain("Prices.xlsx:Orders");
    expect(asked).toContain("Prices.xlsx:Sheet1!$C$2:$C$4");
    expect(result.failed.map((f) => f.ref)).toContain("Missing[]");
    expect(s.value("Sheet1", "A1")).toBe(81.5);
    expect(s.externalReferences().map((r) => r.range)).toContain("C2:C4");
  });

  it("goes into an XLSX file as the cells it stands for, with the cells kept and the table's place in Pli's extension", () => {
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]));
    orders(s);
    s.setCell("Sheet1", "A1", "=SUM([Prices.xlsx]Orders[Total])");
    s.setCell("Sheet1", "A2", "=COUNTA([Prices.xlsx]Orders[[#Headers],[Item]:[Total]])");
    s.setCell("Sheet1", "A3", "=SUM([Prices.xlsx]Nope[Total])");
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("<f>SUM([1]Sheet1!$C$2:$C$4)</f>");
    expect(sheet).toContain("<f>COUNTA([1]Sheet1!$A$1:$C$1)</f>");
    expect(sheet).toContain("<f>SUM(#REF!)</f>");
    const link = strFromU8(files["xl/externalLinks/externalLink1.xml"]!);
    expect(link).toContain('<cell r="C2"><v>25</v></cell>');
    expect(link).toContain('<pli:table name="Orders" sheet="Sheet1" range="A1:C5" totals="1">');
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    expect(back.workbook.externalBooks?.[0]?.tables).toEqual([{ name: "Orders", sheet: "Sheet1", range: "A1:C5", columns: ["Item", "Qty", "Total"], totals: true }]);
    const reopened = new SheetSession(back.workbook);
    expect(reopened.cell("Sheet1", "A1")?.f).toBe("SUM([Prices.xlsx]Sheet1!$C$2:$C$4)");
    expect(reopened.value("Sheet1", "A1")).toBe(81.5);
  });

  it("keeps the day the cells were read in an XLSX file (Pli's extension in the link)", () => {
    const s = new SheetSession(createWorkbook("Book", ["Sheet1"]));
    s.setExternalCells("Prices.xlsx", "Sheet1", { B2: 2.5 }, { read: "2026-11-09" });
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2*2");
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.externalBooks?.[0]?.read).toBe("2026-11-09");
  });
});
