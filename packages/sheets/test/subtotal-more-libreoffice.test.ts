import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, isError, parseCsv, toXlsx } from "../src";

/**
 * Subtotals over merged cells and converted tables, a table's totals row functions, and links in the theme's hyperlink colours,
 * through LibreOffice: the numbers must agree, the merges must stay where Pli put them, and the colours must come out the
 * theme's. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-subtotal-more-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const lo = (file: string, to: string, out: string) => execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", to, "--outdir", join(dir, out), join(dir, file)], { stdio: "ignore", timeout: 120_000 });

describe.skipIf(!SOFFICE)("subtotals more, through LibreOffice", () => {
  it("agree on the numbers over merged labels and a converted table, and keep the merges", () => {
    const s = new SheetSession(createWorkbook("m", ["Data"]));
    s.setValues("Data", "A1", [
      ["Region", "Product", "Qty", "Amount"],
      ["East", "Ink", 1, 7.5],
      [null, "Pen", 2, 10],
      ["West", "Ink", 4, 20],
      [null, "Pen", 5, 25],
      [null, "Pad", 6, 30],
    ]);
    s.mergeCells("Data", "A2:A3");
    s.mergeCells("Data", "A4:A6");
    s.mergeCells("Data", "F1:G1");
    s.createTable("Data", "A1:D6", { name: "Sales" });
    s.setTableTotals("Sales", true);
    s.setTableTotalsFunction("Sales", "Qty", "average");
    s.setTableTotalsFunction("Sales", "Amount", "sum");
    s.subtotal("Data", "A1:D7", { by: "Region", columns: ["Qty", "Amount"], convertTable: true });
    s.setCell("Data", "H1", "=SUBTOTAL(109,C2:C20)");
    writeFileSync(join(dir, "a.xlsx"), toXlsx(s.state));
    lo("a.xlsx", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "csv");
    const rows = parseCsv(readFileSync(join(dir, "csv", "a.csv"), "utf8"));
    const problems: string[] = [];
    const last = Number(s.usedRange("Data")!.replace(/^.*:[A-Z]+/, ""));
    for (let r = 1; r <= last; r++)
      for (const col of ["A", "B", "C", "D", "H"]) {
        const mine = s.value("Data", `${col}${r}`);
        const theirs = rows[r - 1]?.[col.charCodeAt(0) - 65] ?? "";
        if (mine === null) continue;
        const ok = typeof mine === "number" ? Math.abs(Number(theirs) - mine) < 1e-9 * Math.max(1, Math.abs(mine)) : isError(mine) ? theirs.startsWith("#") || theirs.startsWith("Err") : String(mine) === theirs;
        if (!ok) problems.push(`${col}${r}: Pli ${JSON.stringify(mine)}, LibreOffice ${theirs}`);
      }
    expect(problems).toEqual([]);
    // The merges: the labels cover their own rows (the subtotal rows went in between), and LibreOffice keeps them.
    expect(s.sheet("Data").merges).toEqual(["A2:A3", "A5:A7", "F1:G1"]);
    lo("a.xlsx", "xlsx:Calc MS Excel 2007 XML", "out");
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "a.xlsx")))).workbook.sheets[0]!;
    expect([...(back.merges ?? [])].sort()).toEqual(["A2:A3", "A5:A7", "F1:G1"]);
  }, 150_000);

  it("draw links in the theme's hyperlink colours", () => {
    const s = new SheetSession(createWorkbook("l", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["one", "two"]]);
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    s.setLink("Sheet1", "B1", { to: "https://pli.dev/two" });
    s.followLink("Sheet1", "B1");
    s.transact([{ type: "restore", workbook: { ...s.state, themeColors: ["#ffffff", "#000000", "#e7e6e6", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#008000", "#800080"] } }]);
    writeFileSync(join(dir, "l.xlsx"), toXlsx(s.state));
    lo("l.xlsx", "xlsx:Calc MS Excel 2007 XML", "outl");
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, "outl", "l.xlsx"))));
    const styles = strFromU8(files["xl/styles.xml"]!);
    // LibreOffice keeps the links as links with the theme's colours (10 and 11) rather than painting them one fixed colour...
    expect(styles).toContain('<color theme="10"/>');
    expect(styles).toContain('<color theme="11"/>');
    // ...and the theme it writes holds the workbook's own hyperlink colours.
    const theme = Object.entries(files).find(([name]) => /^xl\/theme\/theme\d+\.xml$/.test(name));
    expect(strFromU8(theme![1]).toUpperCase()).toMatch(/<A:HLINK><A:SRGBCLR VAL="008000"\/><\/A:HLINK><A:FOLHLINK><A:SRGBCLR VAL="800080"\/>/);
    // And reading what LibreOffice wrote gives back links that follow the theme.
    const back = new SheetSession(fromXlsx(new Uint8Array(readFileSync(join(dir, "outl", "l.xlsx")))).workbook);
    expect(back.state.themeColors?.[10]).toBe("#008000");
    expect(back.cell("Sheet1", "A1")!.link!.to).toMatch(/^https:\/\/pli.dev/);
    expect(back.cell("Sheet1", "A1")!.s?.color).toBeUndefined();
    expect(back.cell("Sheet1", "B1")!.link!.followed).toBe(true);
  }, 150_000);
});
