import { createId, PliError } from "@pli.dev/core";
import { cellAddress, colName, colNumber, rangeAddress, type Bounds } from "./address";
import { formatValue } from "./format";
import type { HtmlCell, HtmlTable, HtmlTableMark } from "./html";
import { cellFromInput } from "./input";
import { cleanLink } from "./link";
import { cleanCellPicture } from "./image";
import { MAX_COLS, MAX_ROWS, type Cell, type CellBorders, type CellStyle, type Sheet, type Table, type Workbook } from "./model";
import { adoptFormulas, columnSizeOf, copiedTable, copyTableName, rowSizeOf, type PastedFormula, type PasteContent, type PasteOptions } from "./paste";
import { mergedRanges, overlaps } from "./rule";
import { allTables, checkTable } from "./table";
import { transposeCells, transposedBounds } from "./transpose";
import { cfPaste } from "./cfpaste";
import { tableLook } from "./tablestyle";
import type { SheetOp } from "./ops";
import { err, type Value } from "./values";

/*
 * Pasting an HTML table: where each cell lands, what is written (values, formulas, looks, merged cells), the widths and
 * heights of the source, and the tables of Pli's own that the HTML was copied from. `SheetSession.pasteHtml` runs the plan.
 */

export interface HtmlPaste {
  /** The cells to write, `null` clearing one. */
  cells: Record<string, Cell | null>;
  merges: Bounds[];
  /** Merged ranges that were in the way. */
  unmerge: Bounds[];
  target: Bounds;
  /** Operations that follow the cells: sizes, tables. */
  after: SheetOp[];
}

type Placed = { row: number; col: number; cell: HtmlCell };

/** Lays out the cells of a parsed table: a cell with a span covers the positions it spans, and the cells after it move over. */
export function layoutHtml(table: HtmlTable): { placed: Placed[]; width: number; height: number } {
  const taken = new Set<string>();
  const placed: Placed[] = [];
  let height = 0;
  let width = 0;
  table.rows.forEach((cells, i) => {
    let col = 0;
    for (const cell of cells) {
      while (taken.has(`${i}:${col}`)) col++;
      for (let r = 0; r < cell.rowspan; r++) for (let c = 0; c < cell.colspan; c++) taken.add(`${i + r}:${col + c}`);
      placed.push({ row: i, col, cell });
      width = Math.max(width, col + cell.colspan);
      height = Math.max(height, i + cell.rowspan);
      col += cell.colspan;
    }
  });
  return { placed, width, height };
}

const CONTENT_KEYS = ["v", "e", "f", "picture", "link"] as const;

/** A cell with the parts that are its contents taken out (what a paste of contents replaces), or null when nothing is left. */
function withoutContents(cell: Cell | undefined, keys: readonly (typeof CONTENT_KEYS)[number][]): Cell | null {
  if (!cell) return null;
  const rest: Record<string, unknown> = { ...cell };
  for (const k of keys) delete rest[k];
  return Object.keys(rest).length ? (rest as Cell) : null;
}

/** What the paste writes into a cell when only some of the copied cell comes: its contents, or its look. */
export function blendCell(content: PasteContent, old: Cell | undefined, incoming: Cell | null): Cell | null {
  if (content === "all") return incoming;
  if (content === "formats") {
    const { s: _s, fmt: _fmt, ...kept } = old ?? {};
    const next: Cell = { ...kept, ...(incoming?.s ? { s: incoming.s } : {}), ...(incoming?.fmt ? { fmt: incoming.fmt } : {}) };
    return Object.keys(next).length ? next : null;
  }
  // Values and formulas replace what the cell holds and leave its look; a number format the cell hasn't is the source's.
  const base = withoutContents(old, ["v", "e", "f", "picture", "link"]) ?? {};
  const next: Cell = { ...base };
  if (incoming) {
    if (incoming.v !== undefined) next.v = incoming.v;
    if (incoming.e) next.e = incoming.e;
    if (content === "formulas" && incoming.f !== undefined) next.f = incoming.f;
    if (!next.fmt && incoming.fmt) next.fmt = incoming.fmt;
  }
  return Object.keys(next).length ? next : null;
}

const sameLine = (a: { style: string; color?: string } | undefined, b: { style: string; color?: string } | undefined) => !!a && !!b && a.style === b.style && (a.color ?? "#000000") === (b.color ?? "#000000");

/** Takes off a cell what its table's style gives it anyway (a copy bakes the look into the cells). */
function unbake(style: CellStyle, look: ReturnType<typeof tableLook>): CellStyle {
  if (!look) return style;
  const next: CellStyle = { ...style };
  if (look.fill && next.fill === look.fill) delete next.fill;
  if (look.color && next.color === look.color) delete next.color;
  if (look.bold && next.bold) delete next.bold;
  if (look.border && next.border) {
    const border: CellBorders = { ...next.border };
    for (const side of ["top", "right", "bottom", "left"] as const) if (sameLine(border[side], look.border[side])) delete border[side];
    if (Object.keys(border).length) next.border = border;
    else delete next.border;
  }
  return next;
}

/** The value a pasted cell showed, to compare a formula's result with. */
function cachedOf(cell: Cell | null | undefined): Value | undefined {
  if (!cell) return undefined;
  if (cell.e) return err(cell.e);
  return cell.v;
}

export function planHtmlPaste(wb: Workbook, s: Sheet, origin: { row: number; col: number }, table: HtmlTable, options: PasteOptions = {}): HtmlPaste | null {
  const content = options.content ?? "all";
  const turn = options.transpose === true;
  // A transposed paste has no tables and no sizes of the source: rows and columns have changed places.
  if (turn) options = { ...options, asRange: true, widths: false };
  const { placed, width, height } = layoutHtml(table);
  if (!placed.length) return null;
  if (origin.row + (turn ? width : height) - 1 > MAX_ROWS || origin.col + (turn ? height : width) - 1 > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
  const cells: Record<string, Cell | null> = {};
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) cells[cellAddress(origin.row + r, origin.col + c)] = null;
  const merges: Bounds[] = [];
  const edges: [number, number, keyof NonNullable<CellStyle["border"]>, NonNullable<CellStyle["border"]>[keyof NonNullable<CellStyle["border"]>]][] = [];
  const at = (row: number, col: number) => cellAddress(origin.row + row, origin.col + col);
  const texts = new Map<string, string>();
  const parsedFmt = new Map<string, string | undefined>();
  for (const { row, col, cell } of placed) {
    const text = cell.text;
    let next: Cell | null = null;
    let fmt: string | undefined;
    if (text !== "" || cell.value !== undefined) {
      // Text the source says is text (Excel's Text format and `x:str`, Google Sheets' text values) stays text, whatever it looks like.
      const exact = typeof cell.value === "string" ? cell.value : cell.textFormat ? text : undefined;
      if (exact !== undefined) {
        if (exact !== "") next = cell.textFormat ? { v: exact, fmt: "@" } : { v: exact };
      } else {
        // A cell that shows "=A1" is text, not a formula.
        const parsed = cellFromInput(text.startsWith("=") ? "'" + text : text);
        if (typeof cell.value === "number") {
          next = { v: cell.value };
          // Excel's own format is trusted; Google Sheets' is taken when it shows the text the cell has.
          fmt = cell.excelFormat ?? (parsed && typeof parsed.v === "number" ? parsed.fmt : cell.format && formatValue(cell.value, cell.format).text === text ? cell.format : undefined);
          if (fmt) next.fmt = fmt;
        } else if (typeof cell.value === "boolean") next = { v: cell.value };
        else {
          next = parsed;
          if (cell.excelFormat && parsed && typeof parsed.v === "number" && formatValue(parsed.v, cell.excelFormat).text === text) next = { ...parsed, fmt: cell.excelFormat };
          fmt = next?.fmt;
        }
      }
    }
    texts.set(`${row}:${col}`, text);
    parsedFmt.set(`${row}:${col}`, fmt ?? next?.fmt);
    if (cell.link && content !== "values" && content !== "formulas") {
      try {
        next = { ...(next ?? {}), link: cleanLink({ to: cell.link }) };
      } catch {
        // an address that can't be a link is just left as the text
      }
    }
    if (cell.picture && content !== "formats") {
      try {
        const picture = cleanCellPicture(cell.picture);
        next = { ...(next ?? {}), v: picture.alt ?? "", picture };
      } catch {
        // a picture that isn't one of the kinds kept is left out
      }
    }
    const style: CellStyle = { ...cell.style };
    // Excel gives a link its Hyperlink look (blue, underlined) as plain formatting; here a link has that look by itself.
    if (cell.link && next?.link) {
      const own = style.color?.toLowerCase();
      if (own === "#0563c1" || own === "#954f72") {
        delete style.color;
        delete style.underline;
        if (own === "#954f72") next = { ...next, link: { ...next.link, followed: true } };
      }
    }
    const covers = cell.colspan > 1 || cell.rowspan > 1;
    if (Object.keys(style).length) next = { ...(next ?? {}), s: style };
    if (next) cells[at(row, col)] = next;
    if (covers) {
      const m: Bounds = { r1: origin.row + row, c1: origin.col + col, r2: origin.row + row + cell.rowspan - 1, c2: origin.col + col + cell.colspan - 1 };
      merges.push(m);
      // Every cell along an edge of a merged range holds that edge's line, as Excel keeps them.
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const line = style.border?.[side];
        if (!line) continue;
        for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if ((side === "top" && r === m.r1) || (side === "bottom" && r === m.r2) || (side === "left" && c === m.c1) || (side === "right" && c === m.c2)) edges.push([r, c, side, line]);
      }
    }
  }
  for (const [r, c, side, line] of edges) {
    const key = cellAddress(r, c);
    const here = cells[key] ?? {};
    cells[key] = { ...here, s: { ...here.s, border: { ...here.s?.border, [side]: line } } };
  }
  const target: Bounds = { r1: origin.row, c1: origin.col, r2: origin.row + height - 1, c2: origin.col + width - 1 };

  // Formulas the source wrote.
  if (content === "all" || content === "formulas") {
    const list: PastedFormula[] = [];
    for (const { row, col, cell } of placed) {
      if (!cell.formula) continue;
      const here = cells[at(row, col)];
      list.push({ row, col, text: cell.formula.text, r1c1: cell.formula.r1c1, ...(cell.formula.array !== undefined ? { array: cell.formula.array } : {}), cached: cachedOf(here), exact: cell.value !== undefined, fmt: parsedFmt.get(`${row}:${col}`), shown: texts.get(`${row}:${col}`) ?? "" });
    }
    if (list.length) {
      const grid = new Map(placed.map((p) => [`${p.row}:${p.col}`, cells[at(p.row, p.col)] ?? undefined]));
      // `source: "here"`: the formulas are taken as written, as if they were copied from where they land.
      const written = options.source ? /^\$?([A-Z]+)\$?(\d+)$/.exec(options.source.toUpperCase()) : null;
      const source = options.source === "here" ? { row: origin.row, col: origin.col } : written ? { row: Number(written[2]), col: colNumber(written[1]!) } : undefined;
      const { adopted, left } = adoptFormulas(list, {
        workbook: wb,
        origin,
        rows: height,
        cols: width,
        values: (r, c) => grid.get(`${r}:${c}`),
        ...(source ? { source } : {}),
        ...(options.notes ? { note: (text: string) => options.notes!.push(text) } : {}),
      });
      for (const [k, a] of adopted) {
        const [r, c] = k.split(":").map(Number) as [number, number];
        const key = at(r, c);
        const { v: _v, e: _e, picture: _p, ...rest } = cells[key] ?? {};
        cells[key] = { ...rest, f: a.f };
        // The cells an array formula fills hold its results, which are worked out again.
        if (a.extent) {
          for (let i = 0; i < a.extent.rows; i++)
            for (let j = 0; j < a.extent.cols; j++) {
              if (i === 0 && j === 0) continue;
              const spill = at(r + i, c + j);
              if (r + i >= height || c + j >= width) continue;
              const { v: _sv, e: _se, f: _sf, ...others } = cells[spill] ?? {};
              cells[spill] = Object.keys(others).length ? others : null;
            }
        }
      }
      if (left && options.notes) options.notes.push(`${left} formula${left === 1 ? "" : "s"} from the other program couldn't be brought over (they point outside what was copied, or use something Pli doesn't have), so those cells have their values. Edit > Paste special > Formulas from Excel… can read them as copied from a cell you name.`);
    }
  }

  const ops: SheetOp[] = [];
  // Tables of Pli's own, copied whole.
  const tables: Table[] = [];
  if (content === "all" && !options.asRange && table.tables?.length) {
    const taken: string[] = [];
    const after: Record<string, Cell> = { ...s.cells };
    for (const [k, v] of Object.entries(cells)) if (v) after[k] = v;
    const existing = (s.tables ?? []).map((t) => t.range);
    for (const mark of table.tables) {
      const made = tableFromMark(wb, s, mark, origin, taken);
      if (!made) continue;
      if (existing.some((r) => overlapsRange(r, made.range)) || tables.some((t) => overlapsRange(t.range, made.range))) continue;
      // Header cells of a table are text.
      if (made.headerRow !== false) mark.columns.forEach((name, i) => (cells[cellAddress(origin.row + mark.row, origin.col + mark.col + i)] = { ...(cells[cellAddress(origin.row + mark.row, origin.col + mark.col + i)] ?? {}), v: name }));
      const probe: Sheet = { ...s, cells: { ...after, ...Object.fromEntries(Object.entries(cells).filter(([, v]) => v) as [string, Cell][]) }, tables: [...(s.tables ?? []), ...tables] };
      try {
        checkTable(wb, probe, made);
      } catch (e) {
        if (e instanceof PliError) continue;
        throw e;
      }
      taken.push(made.name);
      tables.push(made);
    }
    // The look a table's style gives is baked into the copied cells; the table gives it again, so it comes off them.
    if (tables.length) {
      const probe: Sheet = { ...s, cells: { ...after, ...Object.fromEntries(Object.entries(cells).filter(([, v]) => v) as [string, Cell][]) }, tables: [...(s.tables ?? []), ...tables] };
      for (const t of tables) {
        const b = rangeOf(t.range);
        for (let r = b.r1; r <= b.r2; r++)
          for (let c = b.c1; c <= b.c2; c++) {
            const key = cellAddress(r, c);
            const cell = cells[key];
            if (!cell?.s) continue;
            const style = unbake(cell.s, tableLook(probe, r, c, wb.tableStyles));
            const { s: _s, ...rest } = cell;
            cells[key] = Object.keys(style).length ? { ...rest, s: style } : Object.keys(rest).length ? rest : null;
          }
      }
    }
  }

  // Transpose: everything laid out above turns about the top left corner of the paste.
  let landing: Bounds = target;
  let turned: Bounds[] = merges;
  if (turn) {
    const turnedCells = transposeCells(origin, cells);
    for (const k of Object.keys(cells)) delete cells[k];
    Object.assign(cells, turnedCells);
    const corner: Bounds = { r1: origin.row, c1: origin.col, r2: MAX_ROWS, c2: MAX_COLS };
    landing = transposedBounds(corner, origin, target);
    turned = merges.map((m) => transposedBounds(corner, origin, m));
  }

  // Contents only, or looks only: the cells keep the rest of what they are.
  if (content !== "all") for (const key of Object.keys(cells)) cells[key] = blendCell(content, s.cells[key], cells[key] ?? null);

  // Column widths and row heights.
  const widths = options.widths ?? "auto";
  if (widths !== false && content !== "values" && content !== "formulas" && (widths === true || content === "all")) {
    let wanted = widths === true;
    if (!wanted) {
      // Only into empty space: no cells where the paste lands.
      wanted = true;
      for (const k of Object.keys(s.cells)) {
        const m = /^([A-Z]+)(\d+)$/.exec(k)!;
        const col = colNumber(m[1]!);
        const row = Number(m[2]);
        if (row >= target.r1 && row <= target.r2 && col >= target.c1 && col <= target.c2) {
          wanted = false;
          break;
        }
      }
    }
    if (wanted) {
      const colPx: (number | undefined)[] = Array.from({ length: width }, (_, j) => table.cols?.[j]);
      const rowPx: (number | undefined)[] = Array.from({ length: height }, (_, i) => table.heights?.[i]);
      for (const { row, col, cell } of placed) {
        if (cell.colspan === 1 && colPx[col] === undefined && cell.width !== undefined) colPx[col] = cell.width;
        if (cell.rowspan === 1 && rowPx[row] === undefined && cell.height !== undefined) rowPx[row] = cell.height;
      }
      colPx.forEach((px, j) => {
        if (px === undefined || px <= 5) return;
        const col = origin.col + j;
        const have = s.columns?.[colName(col)];
        if (widths === "auto" && (have?.size !== undefined || Math.abs(px - 64) < 2)) return;
        ops.push({ type: "set_size", sheet: s.id, axis: "col", index: col, size: Math.abs(px - 64) < 1 ? null : columnSizeOf(px) });
      });
      rowPx.forEach((px, i) => {
        if (px === undefined || px < 2) return;
        const row = origin.row + i;
        const have = s.rows?.[String(row)];
        if (widths === "auto" && (have?.size !== undefined || Math.abs(px - 20) < 2)) return;
        ops.push({ type: "set_size", sheet: s.id, axis: "row", index: row, size: Math.abs(px - 20) < 1 ? null : rowSizeOf(px) });
      });
    }
  }
  for (const t of tables) ops.push({ type: "add_table", sheet: s.id, table: t });
  // Data bars and icon sets that Pli's own copy marked (or drew) come back as conditional formats.
  if ((content === "all" || content === "formats") && !turn) ops.push(...cfPaste(table, placed, origin, target, s, s.id).ops);

  const wantsMerges = content === "all" || content === "formats";
  const unmerge = wantsMerges ? mergedRanges(s).filter((m) => overlaps(m, landing)) : [];
  return { cells, merges: wantsMerges ? turned : [], unmerge: [...unmerge], target: landing, after: ops };
}

const rangeOf = (range: string): Bounds => {
  const [a, z = a] = range.split(":") as [string, string?];
  const p = (x: string) => /^([A-Z]+)(\d+)$/.exec(x)!;
  return { r1: Number(p(a)[2]), c1: colNumber(p(a)[1]!), r2: Number(p(z)[2]), c2: colNumber(p(z)[1]!) };
};
const overlapsRange = (a: string, b: string) => overlaps(rangeOf(a), rangeOf(b));

/** The table a mark describes, laid at `origin`; null when it can't be a table here. */
function tableFromMark(wb: Workbook, s: Sheet, mark: HtmlTableMark, origin: { row: number; col: number }, taken: readonly string[]): Table | null {
  const names = mark.columns;
  if (names.some((n) => n === "") || new Set(names.map((n) => n.toLowerCase())).size !== names.length) return null;
  const b: Bounds = { r1: origin.row + mark.row, c1: origin.col + mark.col, r2: origin.row + mark.row + mark.rows - 1, c2: origin.col + mark.col + mark.cols - 1 };
  const base: Table = {
    id: createId("table_"),
    name: "x",
    range: rangeAddress(b),
    ...(mark.style ? { style: mark.style } : {}),
    ...(mark.totals ? { totals: true as const } : {}),
    ...(mark.headerRow === false ? { headerRow: false as const, columns: [...names] } : {}),
    ...(mark.bandedRows === false ? { bandedRows: false as const } : {}),
    ...(mark.bandedColumns ? { bandedColumns: true as const } : {}),
    ...(mark.firstColumn ? { firstColumn: true as const } : {}),
    ...(mark.lastColumn ? { lastColumn: true as const } : {}),
    ...(mark.filterButtons === false ? { filterButtons: false as const } : {}),
    ...(mark.calculated ? { calculated: mark.calculated } : {}),
  };
  const used = new Set([...allTables(wb).map((t) => t.table.name.toLowerCase()), ...Object.keys(wb.names ?? {}).map((n) => n.toLowerCase()), ...taken.map((n) => n.toLowerCase())]);
  void s;
  return copiedTable(base, base.id, used.has(mark.name.toLowerCase()) ? copyTableName(wb, mark.name, taken) : mark.name, base.range);
}
