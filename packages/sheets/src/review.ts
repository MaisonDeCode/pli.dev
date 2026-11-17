import { PliError } from "@pli.dev/core";
import { cellAddress, colName, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import type { Cell, Sheet } from "./model";
import { mergedRanges } from "./rule";
import type { SheetSession } from "./session";
import type { SpellChecker } from "./spell";

/*
 * Review: the spelling check over cells, and the accessibility check. Both only read a session (and change it through its
 * ordinary methods, so each change is an undo step); the panels of the grid editor are a skin over these functions.
 */

// ---- spelling ----

export interface Misspelling {
  /** The sheet's name and the cell. */
  sheet: string;
  address: string;
  /** The word as written, and where it is in the cell's text. */
  word: string;
  start: number;
  end: number;
  /** The whole text of the cell (for showing the word in its context). */
  text: string;
}

export interface SpellScope {
  /** One sheet, by name or id (the default is every sheet that is shown). */
  sheet?: string;
  /** A range on that sheet, such as `A1:C20`; the whole sheet when left out. */
  range?: string;
  /** Include sheets that are hidden (only when no `sheet` is given). */
  hidden?: boolean;
}

/** Whether a cell holds text a person typed: not a formula, not a number, and not a cell a pivot table draws. */
function typedText(sheet: Sheet, address: string, cell: Cell): string | null {
  if (cell.f !== undefined || typeof cell.v !== "string" || cell.v === "") return null;
  if (cell.control) return null;
  const p = parseCell(address)!;
  for (const pv of sheet.pivots ?? []) {
    const b = parseRange(pv.range);
    if (b && p.row >= b.r1 && p.row <= b.r2 && p.col >= b.c1 && p.col <= b.c2) return null;
  }
  return cell.v;
}

/** The misspelt words in the cells of a scope, in reading order (rows, then columns), sheet by sheet. */
export function findMisspellings(session: SheetSession, checker: SpellChecker, scope: SpellScope = {}): Misspelling[] {
  const sheets = scope.sheet !== undefined ? [session.sheet(scope.sheet)] : session.state.sheets.filter((s) => scope.hidden || !s.hidden);
  const limit: Bounds | null = scope.range !== undefined ? parseRange(scope.range) : null;
  if (scope.range !== undefined && !limit) throw new PliError("out_of_range", `"${scope.range}" is not a range`);
  const out: Misspelling[] = [];
  for (const sheet of sheets) {
    const keyed: { address: string; row: number; col: number }[] = [];
    for (const address of Object.keys(sheet.cells)) {
      const p = parseCell(address)!;
      if (limit && (p.row < limit.r1 || p.row > limit.r2 || p.col < limit.c1 || p.col > limit.c2)) continue;
      keyed.push({ address, row: p.row, col: p.col });
    }
    keyed.sort((a, b) => a.row - b.row || a.col - b.col);
    for (const { address } of keyed) {
      const text = typedText(sheet, address, sheet.cells[address]!);
      if (text === null) continue;
      for (const w of checker.check(text)) out.push({ sheet: sheet.name, address, word: w.word, start: w.start, end: w.end, text });
    }
  }
  return out;
}

/**
 * Changes one misspelt word in its cell, as one undo step. Throws when the cell no longer holds that word there (it was
 * edited since the check), so a stale answer never lands on the wrong text.
 */
export function changeMisspelling(session: SheetSession, miss: Misspelling, replacement: string): void {
  const now = session.cell(miss.sheet, miss.address)?.v;
  if (typeof now !== "string" || now.slice(miss.start, miss.end) !== miss.word) throw new PliError("invalid_operation", `The cell ${miss.address} has changed since it was checked`);
  session.setCell(miss.sheet, miss.address, "'" + now.slice(0, miss.start) + replacement + now.slice(miss.end));
}

/** Changes every misspelling of the same word (the matching ones in `list`) to `replacement`, as one undo step. Returns how many were changed. */
export function changeAllMisspellings(session: SheetSession, list: readonly Misspelling[], word: string, replacement: string): number {
  const w = word.toLowerCase();
  const byCell = new Map<string, { sheet: string; address: string; hits: Misspelling[] }>();
  for (const m of list) {
    if (m.word.toLowerCase() !== w) continue;
    const key = `${m.sheet}!${m.address}`;
    (byCell.get(key) ?? byCell.set(key, { sheet: m.sheet, address: m.address, hits: [] }).get(key)!).hits.push(m);
  }
  let n = 0;
  const bySheet = new Map<string, Record<string, string>>();
  for (const { sheet, address, hits } of byCell.values()) {
    const now = session.cell(sheet, address)?.v;
    if (typeof now !== "string") continue;
    let text = now;
    // From the end, so that earlier places stay true.
    for (const h of [...hits].sort((a, b) => b.start - a.start)) {
      if (text.slice(h.start, h.end).toLowerCase() !== w) continue;
      text = text.slice(0, h.start) + replacement + text.slice(h.end);
      n++;
    }
    if (text !== now) (bySheet.get(sheet) ?? bySheet.set(sheet, {}).get(sheet)!)[address] = "'" + text;
  }
  for (const [sheet, inputs] of bySheet) session.setCells(sheet, inputs);
  return n;
}

// ---- accessibility ----

export type AccessKind = "missingAlt" | "mergedCells" | "blankRows" | "blankColumns" | "noHeaderRow" | "lowContrast" | "defaultSheetName";
export type AccessSeverity = "error" | "warning" | "tip";

export interface AccessIssue {
  /** Stable for the same problem in the same workbook, so a panel can keep its place. */
  id: string;
  kind: AccessKind;
  severity: AccessSeverity;
  /** The sheet's name and where the problem is: a cell or range, or (for a picture or chart) the cell it sits in. */
  sheet: string;
  where: string;
  /** A cell to go to for it (the first cell of `where`, or the first of a row or column). */
  cell: string;
  /** What is wrong, in a sentence. */
  message: string;
  /** What to do about it, in a sentence, when it can't be done for you. */
  hint?: string;
  /** What the Fix action does, when there is one. */
  fix?: string;
  /** For a picture or chart: which one. */
  object?: { kind: "image" | "chart"; id: string };
}

export interface AccessOptions {
  /** Check only these sheets (names); the default is every sheet. */
  sheets?: readonly string[];
  /** The lowest contrast ratio text may have against its background (WCAG's 4.5 for normal text by default; large text needs 3). */
  minContrast?: number;
}

function hexRgb(color: string | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG's relative luminance of a colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** The contrast ratio between two `#rrggbb` colours, 1 to 21; null when either isn't one. */
export function contrastRatio(a: string, b: string): number | null {
  const x = hexRgb(a);
  const y = hexRgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Black or white, whichever reads better on the colour. */
export function readableOn(background: string): string {
  const bg = hexRgb(background);
  if (!bg) return "#000000";
  return luminance(bg) > 0.179 ? "#000000" : "#ffffff";
}

/** The first cell of a place named as a cell, a range, whole rows (`5:7`) or whole columns (`C:D`). */
function cellOfWhere(where: string): string {
  const first = where.split(":")[0]!;
  return /^\d+$/.test(first) ? `A${first}` : /^[A-Z]+$/.test(first) ? `${first}1` : first;
}

const DEFAULT_NAME = /^(sheet|page|tab|worksheet)\s*\d+$/i;

/** Rows (or columns) that hold nothing, with data on both sides of them, as runs. */
function blankGaps(sheet: Sheet, axis: "row" | "col"): [number, number][] {
  const filled = new Set<number>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cell.v === undefined && cell.f === undefined && cell.e === undefined && cell.picture === undefined) continue;
    if (cell.v === "") continue;
    const p = parseCell(address)!;
    filled.add(axis === "row" ? p.row : p.col);
  }
  if (filled.size < 2) return [];
  const sorted = [...filled].sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]! - 1;
    // One blank line between blocks of data is how people lay a sheet out with spaces; that is what a screen reader trips on.
    if (gap >= 1) out.push([sorted[i - 1]! + 1, sorted[i]! - 1]);
  }
  return out;
}

/** The problems a person using a screen reader (or poor eyesight) would meet in the workbook. */
export function checkAccessibility(session: SheetSession, options: AccessOptions = {}): AccessIssue[] {
  const out: AccessIssue[] = [];
  const minContrast = options.minContrast ?? 4.5;
  const wanted = options.sheets ? new Set(options.sheets.map((n) => n.toLowerCase())) : null;
  for (const sheet of session.state.sheets) {
    if (wanted && !wanted.has(sheet.name.toLowerCase())) continue;
    const here = (kind: AccessKind, where: string, extra: Omit<AccessIssue, "id" | "kind" | "sheet" | "where" | "cell">) =>
      out.push({ id: `${kind}:${sheet.id}:${extra.object ? `${extra.object.kind}:${extra.object.id}` : where}`, kind, sheet: sheet.name, where, cell: cellOfWhere(where), ...extra });

    for (const image of sheet.images ?? []) {
      if (image.alt?.trim()) continue;
      here("missingAlt", cellAddress(image.from.row, image.from.col), { severity: "error", message: "A picture has no alternative text.", hint: "Describe what the picture shows (Format picture… > Description).", object: { kind: "image", id: image.id } });
    }
    for (const chart of sheet.charts ?? []) {
      if (chart.alt?.trim()) continue;
      here("missingAlt", cellAddress(chart.from.row, chart.from.col), { severity: "error", message: `The chart${chart.title ? ` "${chart.title}"` : ""} has no alternative text.`, hint: "Describe what the chart shows and what to take from it.", object: { kind: "chart", id: chart.id } });
    }
    for (const m of mergedRanges(sheet)) {
      here("mergedCells", rangeAddress(m), { severity: "warning", message: `The cells ${rangeAddress(m)} are merged, which makes it hard to move through the sheet with a keyboard or screen reader.`, fix: "Unmerge the cells" });
    }
    for (const table of sheet.tables ?? []) {
      if (table.headerRow !== false) continue;
      here("noHeaderRow", table.range, { severity: "error", message: `The table ${table.name} has no header row, so a screen reader can't say which column a cell is in.`, fix: "Turn on the header row" });
    }
    for (const axis of ["row", "col"] as const) {
      for (const [a, z] of blankGaps(sheet, axis)) {
        const label = axis === "row" ? (a === z ? `Row ${a}` : `Rows ${a} to ${z}`) : a === z ? `Column ${colName(a)}` : `Columns ${colName(a)} to ${colName(z)}`;
        const where = axis === "row" ? `${a}:${z}` : `${colName(a)}:${colName(z)}`;
        here(axis === "row" ? "blankRows" : "blankColumns", where, { severity: "tip", message: `${label} ${a === z ? "is" : "are"} blank, with data on both sides. Blank ${axis === "row" ? "rows" : "columns"} used for spacing make a screen reader think the data has ended.`, fix: `Delete the blank ${axis === "row" ? "row" : "column"}${a === z ? "" : "s"}` });
      }
    }
    // Text that is hard to read against its background: one issue for each pair of colours, with the cells it is in.
    const pairs = new Map<string, { color: string; fill: string; cells: string[]; ratio: number }>();
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const style = cell.s;
      if (!style || (style.color === undefined && style.fill === undefined)) continue;
      if (cell.v === undefined && cell.f === undefined) continue;
      if (cell.v === "") continue;
      const color = style.color ?? "#000000";
      const fill = style.fill ?? "#ffffff";
      const ratio = contrastRatio(color, fill);
      if (ratio === null) continue;
      const large = (style.fontSize ?? 11) >= 18 || ((style.fontSize ?? 11) >= 14 && style.bold === true);
      if (ratio >= (large ? Math.min(3, minContrast) : minContrast)) continue;
      const key = `${color}/${fill}`;
      const entry = pairs.get(key) ?? { color, fill, cells: [], ratio };
      entry.cells.push(address);
      pairs.set(key, entry);
    }
    for (const { color, fill, cells, ratio } of pairs.values()) {
      const sorted = cells.sort((x, y) => parseCell(x)!.row - parseCell(y)!.row || parseCell(x)!.col - parseCell(y)!.col);
      const shown = sorted.slice(0, 3).join(", ") + (sorted.length > 3 ? ` and ${sorted.length - 3} more` : "");
      here("lowContrast", sorted[0]!, { severity: "warning", message: `Text in ${shown} is hard to read: ${color} on ${fill} has a contrast of ${ratio.toFixed(1)} to 1 (it needs ${minContrast} to 1).`, fix: `Use ${readableOn(fill) === "#ffffff" ? "white" : "black"} text` });
      out[out.length - 1]!.id = `lowContrast:${sheet.id}:${color}/${fill}`;
    }
    if (DEFAULT_NAME.test(sheet.name.trim())) here("defaultSheetName", "A1", { severity: "tip", message: `The sheet is called "${sheet.name}", which says nothing about what is on it.`, hint: "Give the sheet a name that says what it holds (right-click its tab > Rename)." });
  }
  const rank = { error: 0, warning: 1, tip: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Does what an issue's `fix` says: unmerges, turns a table's header row on, deletes the blank rows or columns, or gives
 * the text a colour that reads on its background. One undo step. Throws for an issue that has no fix.
 */
export function fixAccessibility(session: SheetSession, issue: AccessIssue): void {
  if (!issue.fix) throw new PliError("invalid_operation", "That problem has to be fixed by hand: " + (issue.hint ?? issue.message));
  const sheet = session.sheet(issue.sheet);
  switch (issue.kind) {
    case "mergedCells":
      session.unmergeCells(issue.sheet, issue.where);
      return;
    case "noHeaderRow": {
      const table = (sheet.tables ?? []).find((t) => t.range === issue.where);
      if (!table) throw new PliError("not_found", "That table has changed since the check");
      session.setTableHeader(table.name, true);
      return;
    }
    case "blankRows":
    case "blankColumns": {
      const [a, z] = issue.where.split(":");
      const rows = issue.kind === "blankRows";
      const first = rows ? Number(a) : parseCell(`${a}1`)!.col;
      const last = rows ? Number(z) : parseCell(`${z}1`)!.col;
      if (rows) session.deleteRows(issue.sheet, first, last - first + 1);
      else session.deleteColumns(issue.sheet, first, last - first + 1);
      return;
    }
    case "lowContrast": {
      const [color, fill] = issue.id.slice(issue.id.lastIndexOf(":") + 1).split("/");
      const next = readableOn(fill!);
      const cells = Object.entries(sheet.cells).filter(([, c]) => (c.s?.color ?? "#000000") === color && (c.s?.fill ?? "#ffffff") === fill && c.s && (c.v !== undefined || c.f !== undefined) && c.v !== "").map(([a]) => a);
      for (const a of cells) session.setStyle(issue.sheet, a, { color: next === "#000000" ? null : next });
      return;
    }
    default:
      throw new PliError("invalid_operation", "That problem has to be fixed by hand");
  }
}

/** Fixes every issue that has a fix, one undo step each; returns how many were fixed. */
export function fixAllAccessibility(session: SheetSession, issues: readonly AccessIssue[]): number {
  let n = 0;
  // Deleting blank rows and columns shifts the places of later ones, so those go last-first.
  const order = [...issues].filter((i) => i.fix).sort((a, b) => {
    const gap = (i: AccessIssue) => (i.kind === "blankRows" || i.kind === "blankColumns" ? 1 : 0);
    if (gap(a) !== gap(b)) return gap(a) - gap(b);
    const start = (i: AccessIssue) => (gap(i) ? parseInt(i.where.split(":")[0]!, 10) || parseCell(`${i.where.split(":")[0]}1`)?.col || 0 : 0);
    return start(b) - start(a);
  });
  for (const i of order) {
    try {
      fixAccessibility(session, i);
      n++;
    } catch {
      // A problem that went away with an earlier fix (a table that was unmerged, a row already deleted) is not an error.
    }
  }
  return n;
}
