import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SheetSession, createWorkbook, isError, parseCsv, toXlsx, type Value } from "../src";

/** Where LibreOffice is, if it is installed (tests that need it are skipped without it). */
export const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);

/** A folder for LibreOffice's profile and files; remove it with `rmSync` when done. */
export const makeDir = (name: string) => (SOFFICE ? mkdtempSync(join(tmpdir(), `pli-${name}-`)) : "");
export const removeDir = (dir: string) => dir && rmSync(dir, { recursive: true, force: true });

/** Whether Pli's value is what LibreOffice wrote for the cell: an error matches any error, numbers to 1e-8 relative. */
export function same(a: Value, b: string): boolean {
  if (isError(a)) return /^(Err:|#)/.test(b);
  if (typeof a === "boolean") return b === (a ? "TRUE" : "FALSE") || b === (a ? "1" : "0");
  if (typeof a === "number") {
    const n = Number(b);
    if (b.trim() === "" || !Number.isFinite(n)) return false;
    return Math.abs(a - n) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(n));
  }
  return String(a ?? "") === b;
}

/**
 * Makes LibreOffice work out every formula of an XLSX file when it loads it. By default it shows the values the file caches
 * (a cell cached as 99 for =1+1 shows 99), so a comparison would only be Pli's answers read back.
 */
export function forceRecalculation(dir: string): void {
  mkdirSync(join(dir, "profile", "user"), { recursive: true });
  writeFileSync(
    join(dir, "profile", "user", "registrymodifications.xcu"),
    `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`,
  );
}

/** What LibreOffice makes of each formula (one per row of column A), with some cells of data in the sheet, as the text it would show. */
export function inLibreOffice(dir: string, formulas: string[], cells: Record<string, string | number> = {}): string[] {
  const s = new SheetSession(createWorkbook("lo"), { now: () => 45000.5 });
  s.setCells("Sheet1", cells);
  formulas.forEach((f, i) => s.setCell("Sheet1", `A${i + 1}`, "=" + f));
  forceRecalculation(dir);
  writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state, { now: () => 45000.5 }));
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "--outdir", dir, join(dir, "f.xlsx")], { stdio: "ignore", timeout: 300_000 });
  return parseCsv(readFileSync(join(dir, "f.csv"), "utf8")).map((r) => r[0] ?? "");
}

/** The disagreements between Pli and LibreOffice over these formulas, as lines of text (none when they agree). */
export function disagreements(dir: string, formulas: string[], cells: Record<string, string | number> = {}): string[] {
  const theirs = inLibreOffice(dir, formulas, cells);
  const s = new SheetSession(createWorkbook("pli"), { now: () => 45000.5 });
  s.setCells("Sheet1", cells);
  formulas.forEach((f, i) => s.setCell("Sheet1", `A${i + 1}`, "=" + f));
  const problems: string[] = [];
  formulas.forEach((f, i) => {
    const mine = s.value("Sheet1", `A${i + 1}`);
    if (!same(mine, theirs[i]!)) problems.push(`${f}\n    Pli: ${isError(mine) ? mine.error : JSON.stringify(mine)}   LibreOffice: ${theirs[i]}`);
  });
  return problems;
}
