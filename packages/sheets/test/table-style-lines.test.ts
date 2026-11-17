import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, builtinTableStyle, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, tableLook, toXlsx, type TableStyleDef } from "../src";

const thin = { style: "thin" as const, color: "#336699" };
const thick = { style: "thick" as const, color: "#aa0000" };
const dashed = { style: "dashed" as const, color: "#00aa00" };

const make = (def: TableStyleDef, options: Parameters<SheetSession["setTableOptions"]>[1] = {}) => {
  const s = new SheetSession(createWorkbook("Lines", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty", "Total"],
    ["West", "Pens", 10, 1],
    ["East", "Paper", 4, 2],
    ["West", "Ink", 2, 3],
    ["North", "Pens", 7, 4],
  ]);
  s.createTable("Sheet1", "A1:D5", { name: "Sales" });
  s.setTableStyle("Mine", def);
  s.setTableOptions("Sales", { style: "Mine", ...options });
  return s;
};
const look = (s: SheetSession, row: number, col: number) => tableLook(s.sheet("Sheet1"), row, col, s.state.tableStyles)?.border;

describe("lines between cells in a table style of your own", () => {
  it("draws a part's edge lines at the edge of the block it covers and its inner lines between the cells in it", () => {
    const s = make({ wholeTable: { border: { top: thick, bottom: thick, left: thick, right: thick, horizontal: thin, vertical: dashed } } });
    // the top left corner: the table's edges on top and left, the inner lines below and to the right
    expect(look(s, 1, 1)).toEqual({ top: thick, left: thick, bottom: thin, right: dashed });
    // an inner cell has only inner lines
    expect(look(s, 3, 2)).toEqual({ top: thin, bottom: thin, left: dashed, right: dashed });
    // the bottom right corner
    expect(look(s, 5, 4)).toEqual({ top: thin, left: dashed, bottom: thick, right: thick });
  });

  it("covers the header row, the totals row, a column and the stripes as blocks of their own", () => {
    const s = make(
      {
        headerRow: { border: { bottom: thick, vertical: thin } },
        totalRow: { border: { top: thick } },
        firstColumn: { border: { right: dashed } },
        firstRowStripe: { border: { top: thin, bottom: thin } },
        secondRowStripe: { border: { horizontal: dashed } },
        rowStripeSize: 2,
      },
      { firstColumn: true },
    );
    s.setTableTotals("Sales", true);
    // Header cells: the vertical line is between header cells, the bottom is the header's own.
    expect(look(s, 1, 2)).toEqual({ bottom: thick, left: thin, right: thin });
    expect(look(s, 1, 1)).toEqual({ bottom: thick, right: thin }); // header's first cell: no line to its left; the first-column part adds its right
    // Totals: a thick line above the whole row.
    expect(look(s, 6, 3)).toEqual({ top: thick });
    // The first column's right line is at the column's edge, for every row of the table.
    expect(look(s, 3, 1)?.right).toEqual(dashed);
    // A stripe two rows wide: rows 2-3 are the first stripe (top at row 2, bottom at row 3); rows 4-5 the second (line between them).
    // The header's bottom line is the first row's top and the totals row's top line the last row's bottom (the part that names the edge wins); the first column's right line is the left line of the next.
    expect(look(s, 2, 2)).toEqual({ top: thick, left: dashed });
    expect(look(s, 3, 2)).toEqual({ bottom: thin, left: dashed });
    expect(look(s, 4, 2)).toEqual({ bottom: dashed, left: dashed });
    expect(look(s, 5, 2)).toEqual({ top: dashed, bottom: thick, left: dashed });
  });

  it("covers a stripe of columns", () => {
    const s = make({ firstColumnStripe: { border: { left: thin, right: thin, vertical: dashed } }, columnStripeSize: 2 }, { bandedColumns: true });
    expect(look(s, 2, 1)).toEqual({ left: thin, right: dashed });
    expect(look(s, 2, 2)).toEqual({ left: dashed, right: thin });
    expect(look(s, 2, 3)).toBeUndefined(); // the second stripe says nothing
  });

  it("has the same lines in a table with no header row and no style parts that add none", () => {
    const s = make({ wholeTable: { fill: "#eeeeee" } });
    expect(look(s, 2, 2)).toBeUndefined();
  });

  it("checks the lines between cells", () => {
    const s = make({});
    expect(() => s.setTableStyle("Bad", { wholeTable: { border: { horizontal: { style: "wavy" as never } } } })).toThrow(/border style/);
    expect(() => s.setTableStyle("Bad", { wholeTable: { border: { vertical: { style: "thin", color: "red" } } } })).toThrow(/#rrggbb/);
    expect(() => s.setTableStyle("Bad", { wholeTable: { border: { middle: thin } as never } })).toThrow(/not "middle"/);
    // a cell's own border can't have them
    expect(() => s.setBorders("Sheet1", "A1", { horizontal: thin } as never)).toThrow();
  });

  it("is undone in one step and kept in a saved workbook", () => {
    const s = make({ wholeTable: { border: { horizontal: thin, vertical: dashed } } });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    s.setTableStyle("Mine", { wholeTable: { border: { horizontal: thick } } });
    expect(s.tableStyles().Mine).toEqual({ wholeTable: { border: { horizontal: thick } } });
    s.undo();
    expect(s.tableStyles().Mine).toEqual({ wholeTable: { border: { horizontal: thin, vertical: dashed } } });
  });

  it("is drawn in copied HTML", () => {
    const s = make({ wholeTable: { border: { horizontal: thin, vertical: dashed } } });
    const html = s.toHtml("Sheet1", "A1:D5");
    expect(html).toMatch(/border-bottom:[^;"]*#336699/i);
    expect(html).toMatch(/border-right:[^;"]*dashed[^;"]*#00aa00/i);
  });
});

describe("lines between cells in XLSX", () => {
  const styles = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);

  it("writes them as the horizontal and vertical lines of the part's dxf, in the order Excel reads", () => {
    const s = make({ wholeTable: { border: { top: thick, bottom: thick, horizontal: thin, vertical: dashed } } });
    const xml = styles(s);
    expect(xml).toMatch(/<dxf><border><left\/><right\/><top style="thick"><color rgb="FFAA0000"\/><\/top><bottom style="thick"><color rgb="FFAA0000"\/><\/bottom><vertical style="dashed"><color rgb="FF00AA00"\/><\/vertical><horizontal style="thin"><color rgb="FF336699"\/><\/horizontal><\/border><\/dxf>/);
    expect(xml).toContain('<tableStyleElement type="wholeTable" dxfId=');
  });

  it("reads them back, with fills, fonts and the stripe sizes", () => {
    const def: TableStyleDef = {
      wholeTable: { border: { top: thick, bottom: thick, left: thick, right: thick, horizontal: thin, vertical: dashed } },
      headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff", border: { bottom: thick } },
      firstRowStripe: { fill: "#e6eef7", border: { horizontal: dashed } },
      rowStripeSize: 2,
    };
    const s = make(def);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.tableStyles).toEqual(s.state.tableStyles);
    expect(back.workbook.tableStyles!.Mine).toEqual(def);
  });

  it("reads lines between cells from a file a hand wrote, and leaves them out of conditional formats", () => {
    const s = make({ wholeTable: { border: { horizontal: thin } } });
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["5"], ranges: ["C2:C5"], style: { border: { bottom: thick } } });
    const files = unzipSync(toXlsx(s.state));
    let xml = strFromU8(files["xl/styles.xml"]!);
    // another file would have the lines between cells in a conditional format's dxf too (Excel's own editor can't make them); they aren't a cell's lines
    xml = xml.replace("</dxfs>", '<dxf><border><left/><right/><top/><bottom/><vertical style="thin"><color rgb="FF000000"/></vertical></border></dxf></dxfs>').replace(/<dxfs count="(\d+)"/, (_m, n) => `<dxfs count="${Number(n) + 1}"`);
    files["xl/styles.xml"] = strToU8(xml);
    const back = fromXlsx(zipSync(files));
    expect(back.workbook.tableStyles!.Mine).toEqual({ wholeTable: { border: { horizontal: thin } } });
    expect(new SheetSession(back.workbook).conditionalFormats("Sheet1")[0]).toMatchObject({ style: { border: { bottom: thick } } });
  });
});

const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-tablelines-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("lines between cells through LibreOffice", () => {
  it("opens a workbook whose table style has them, and writes the table back with the style's name", () => {
    const s = make({ wholeTable: { border: { top: thick, horizontal: thin, vertical: dashed } }, headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff" } });
    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    expect(back.workbook.sheets[0]!.tables![0]).toMatchObject({ name: "Sales", range: "A1:D5" });
    expect(back.workbook.sheets[0]!.cells["C2"]?.v).toBe(10);
  });
});

describe("Excel's built-in table styles", () => {
  const built = (style: string, options: Parameters<SheetSession["setTableOptions"]>[1] = {}) => {
    const s = new SheetSession(createWorkbook("Built", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Region", "Item", "Qty"], ["West", "Pens", 10], ["East", "Paper", 4], ["North", "Ink", 7], ["South", "Pens", 1]]);
    s.createTable("Sheet1", "A1:C5", { name: "Sales", style });
    if (Object.keys(options).length) s.setTableOptions("Sales", options);
    return (row: number, col: number) => tableLook(s.sheet("Sheet1"), row, col);
  };

  it("has all 60 styles and no others", () => {
    const names = [...Array.from({ length: 21 }, (_, i) => `TableStyleLight${i + 1}`), ...Array.from({ length: 28 }, (_, i) => `TableStyleMedium${i + 1}`), ...Array.from({ length: 11 }, (_, i) => `TableStyleDark${i + 1}`)];
    for (const n of names) expect(builtinTableStyle(n), n).not.toBeNull();
    expect(builtinTableStyle("TableStyleLight22")).toBeNull();
    expect(builtinTableStyle("TableStyleMedium29")).toBeNull();
    expect(builtinTableStyle("TableStyleDark12")).toBeNull();
    expect(builtinTableStyle("Mine")).toBeNull();
  });

  it("Light 1 to 7 draw a line above and below the table and under the header", () => {
    const at = built("TableStyleLight2");
    expect(at(1, 2)?.border).toMatchObject({ top: { style: "thin", color: "#4472c4" }, bottom: { style: "thin", color: "#4472c4" } });
    expect(at(5, 2)?.border?.bottom).toEqual({ style: "thin", color: "#4472c4" });
  });

  it("Light 8 to 14 draw a frame and lines round the stripes", () => {
    const at = built("TableStyleLight9");
    expect(at(2, 1)?.border).toMatchObject({ left: { color: "#4472c4" }, top: { color: "#4472c4" } });
    expect(at(2, 3)?.border?.right).toEqual({ style: "thin", color: "#4472c4" });
  });

  it("Light 15 to 21 draw a grid, Medium 2 to 14 lines between the cells in a pale shade of the colour", () => {
    expect(built("TableStyleLight16")(3, 2)?.border).toEqual({ top: { style: "thin", color: "#4472c4" }, bottom: { style: "thin", color: "#4472c4" }, left: { style: "thin", color: "#4472c4" }, right: { style: "thin", color: "#4472c4" } });
    // Medium 2: thin lines (Accent 1, lighter 40%) round the table and between its rows, and the shaded rows in Accent 1, lighter 80%
    const medium = built("TableStyleMedium2");
    expect(medium(3, 2)?.border).toEqual({ top: { style: "thin", color: "#8ea9db" }, bottom: { style: "thin", color: "#8ea9db" } });
    expect(medium(3, 1)?.border?.left).toEqual({ style: "thin", color: "#8ea9db" });
    expect(medium(2, 2)?.fill).toBe("#d9e1f2");
    expect(medium(3, 2)?.fill).toBeUndefined();
  });

  it("Medium 1 is black lines on white with a black header and grey stripes", () => {
    const at = built("TableStyleMedium1");
    expect(at(1, 2)).toMatchObject({ fill: "#000000", color: "#ffffff" });
    expect(at(3, 2)?.border).toEqual({ top: { style: "thin", color: "#000000" }, bottom: { style: "thin", color: "#000000" } });
    expect(at(2, 2)?.fill).toBe("#d9d9d9");
  });

  it("Medium 15 to 21 have a heavy line under the header, a grid and a black first column when asked", () => {
    const at = built("TableStyleMedium16", { firstColumn: true });
    expect(at(1, 2)?.border?.bottom).toEqual({ style: "medium", color: "#000000" });
    expect(at(2, 2)?.border?.top).toEqual({ style: "medium", color: "#000000" });
  });

  it("Medium 22 to 28 draw a pale body, a frame in a lighter shade and a medium line above the totals row", () => {
    const at = built("TableStyleMedium28");
    expect(at(1, 2)).toMatchObject({ bold: true });
    expect(at(3, 2)?.border?.left).toEqual({ style: "thin", color: "#a9d08e" });
    expect(at(2, 2)?.fill).toBe("#c6e0b4");
    expect(at(3, 2)?.fill).toBe("#e2efda");
  });

  it("the Dark styles fill the whole table, with a white line under the header and beside the first and last columns", () => {
    const at = built("TableStyleDark2", { firstColumn: true, lastColumn: true });
    expect(at(2, 2)?.fill).toBe("#305496"); // Accent 1, darker 25%
    expect(at(3, 2)?.fill).toBe("#4472c4");
    expect(at(2, 2)?.color).toBe("#ffffff");
    expect(at(1, 2)).toMatchObject({ fill: "#000000", bold: true, color: "#ffffff", border: { bottom: { style: "medium", color: "#ffffff" } } });
    expect(at(3, 1)?.border?.right).toEqual({ style: "medium", color: "#ffffff" });
    expect(at(3, 2)?.border?.left).toEqual({ style: "medium", color: "#ffffff" });
    expect(at(3, 3)?.border?.left).toEqual({ style: "medium", color: "#ffffff" });
    // Dark 9 to 11 use two accents each
    expect(built("TableStyleDark9")(1, 2)?.fill).toBe("#ed7d31");
    expect(built("TableStyleDark8")(1, 2)?.fill).toBe("#000000");
  });

  it("follows the workbook's theme when it has one", () => {
    const palette = ["#ffffff", "#000000", "#e7e6e6", "#44546a", "#c00000", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];
    expect(builtinTableStyle("TableStyleMedium2", palette)?.headerRow?.fill).toBe("#c00000");
    expect(builtinTableStyle("TableStyleMedium2")?.headerRow?.fill).toBe("#4472c4");
  });
});
