import { cellAddress, colName, parseRange, type Bounds } from "./address";
import { backgroundCss } from "./cfhtml";
import { cfMarkAttribute } from "./cfpaste";
import { hasHeader, tableColumns } from "./table";
import type { Calculator } from "./calc";
import { formatValue } from "./format";
import type { CellEffect } from "./conditional";
import { borderCss, cellCss, type HtmlTableMark } from "./html";
import type { CellBorders, CellStyle, ConditionalRule, ConditionalStyle, Sheet, Workbook } from "./model";
import { columnPixels, rowPixelsOf } from "./image";
import { isPlace, linkedStyle } from "./link";
import { mergedRanges } from "./rule";
import { monoCss, monoSvg, overflowFor, printedError, type PrintOverflow, type PrintedCell } from "./print-more";
import { isError } from "./values";
import { cellFromInput } from "./input";
import { toMsoNumberFormat } from "./msoformat";

/** Splits tab-separated text (what spreadsheets put on the clipboard) into rows of fields; quoted fields may hold tabs and line breaks. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fresh = true; // at the start of a field, where a quote opens a quoted one
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && fresh) {
      quoted = true;
      fresh = false;
    } else if (c === "\t") {
      row.push(field);
      field = "";
      fresh = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fresh = true;
    } else {
      field += c;
      fresh = false;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quoteTsv(t: string): string {
  return /[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shown(calc: Calculator, wb: Workbook, sheetId: string, row: number, col: number): string {
  const address = cellAddress(row, col);
  const v = calc.value(sheetId, address);
  if (v === null) return "";
  if (isError(v)) return v.error;
  return formatValue(v, wb.sheets.find((s) => s.id === sheetId)?.cells[address]?.fmt).text;
}

/** A range as it shows, as tab-separated text, the way spreadsheets copy to the clipboard. */
export function rangeToTsv(calc: Calculator, sheetId: string, b: Bounds): string {
  const lines: string[] = [];
  for (let r = b.r1; r <= b.r2; r++) {
    const fields: string[] = [];
    for (let c = b.c1; c <= b.c2; c++) fields.push(quoteTsv(shown(calc, calc.workbook, sheetId, r, c)));
    lines.push(fields.join("\t"));
  }
  return lines.join("\n");
}

/** What a copy puts in the HTML besides each cell's own look: what conditional formats and a table's style add. */
export interface HtmlLook {
  /** A colour scale, or a conditional style, over the cell. */
  effect?(row: number, col: number): CellEffect | undefined;
  /** The look the table the cell is in gives it. */
  table?(row: number, col: number): ConditionalStyle | undefined;
  /** An `<svg>` to show in the cell: its sparkline. Only used on paper, where the cell has a size. */
  sparkline?(row: number, col: number): string | undefined;
  /** The conditional formats of the sheet: its data bars and icon sets that cover the copied cells go in the HTML as `data-pli-cf`, so that pasting it back makes them rules again. */
  rules?: readonly ConditionalRule[];
  /** Whether a picture an `IMAGE` formula fetches from the web goes into the HTML (as an address the reader loads); a `data:` picture always does. */
  remoteImages?: boolean;
}

/**
 * A range as an HTML table that other spreadsheets and documents paste as a table, with each cell's look as inline
 * styles (so Excel and Google Sheets keep fills, fonts and borders) and merged ranges as spans.
 */
export function rangeToHtml(calc: Calculator, sheetId: string, b: Bounds, look: HtmlLook = {}): string {
  const rows = Array.from({ length: b.r2 - b.r1 + 1 }, (_, i) => b.r1 + i);
  const cols = Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => b.c1 + i);
  return `<meta charset="utf-8">${cellsToTable(calc, sheetId, rows, cols, look)}`;
}

/** How a page is printed: the size of each row and column in points, and what is added around the cells. */
export interface PrintTable {
  width(col: number): number;
  height(row: number): number;
  gridlines: boolean;
  /** Row numbers down the left and column letters along the top. */
  headings: { width: number; height: number } | null;
  /** How errors print: left out, as `--` or as `#N/A` (as they show when missing). */
  errors?: "blank" | "dash" | "na";
  /** Black and white: no fills, black text and lines. */
  mono?: boolean;
  /** Draft quality: no pictures in cells. */
  noGraphics?: boolean;
  /** Called for each cell whose text runs on into the empty cells beside it. */
  overflow?(o: PrintOverflow): void;
  /** Called for each cell with what it is: its place, text and look as numbers, for drawing without the HTML. */
  cell?(cell: PrintedCell): void;
}

/** Whether text would be something else when typed or pasted into a spreadsheet: a number, a date, a formula, TRUE, an error. */
function typedLooking(text: string): boolean {
  const typed = cellFromInput(text);
  return !!typed && (typed.f !== undefined || typed.e !== undefined || typeof typed.v !== "string" || typed.fmt !== undefined);
}

const columnLetters = (n: number): string => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * The cells at these rows and columns (in the order given, which need not touch: title rows come before the rest of a page)
 * as an HTML table, each cell with its look. A merged range is one cell, and is cut off where the rows or columns stop.
 * With `print`, the table has the sizes of the cells and the other things a printed page has.
 */
export function cellsToTable(calc: Calculator, sheetId: string, rowList: readonly number[], colList: readonly number[], look: HtmlLook = {}, print?: PrintTable): string {
  const sheet = calc.workbook.sheets.find((s) => s.id === sheetId);
  const merges = sheet ? mergedRanges(sheet) : [];
  const rows: string[] = [];
  const inside = (list: readonly number[], a: number, z: number) => list.filter((x) => x >= a && x <= z);
  // Tables of Pli's own that are copied whole are marked, so that pasting them back makes a table again.
  const marks = print || !sheet?.tables?.length ? [] : tableMarks(sheet, rowList, colList);
  // Sizes are written when the sheet gives the cells any of their own.
  const sizedCols = !print && !!sheet?.columns && colList.some((c) => sheet.columns![colName(c)] !== undefined);
  const sizedRows = !print && !!sheet?.rows && rowList.some((r) => sheet.rows![String(r)] !== undefined);
  const headerRows = new Set(marks.filter((m) => m.header).map((m) => m.sheetRow));
  /** Whether nothing is in a cell, so that the text beside it may run on over it. */
  const emptyAt = (r: number, c: number) => {
    const cl = sheet?.cells[cellAddress(r, c)];
    return calc.value(sheetId, cellAddress(r, c)) === null && !cl?.picture && !cl?.control && !merges.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
  };
  // Where each row and column starts, in points, when the cells are wanted as numbers too.
  const rowAt = new Map<number, number>();
  const colAt = new Map<number, number>();
  if (print?.cell) {
    let at = 0;
    for (const r of rowList) (rowAt.set(r, at), (at += print.height(r)));
    at = 0;
    for (const c of colList) (colAt.set(c, at), (at += print.width(c)));
  }
  for (const r of rowList) {
    const cells: string[] = [];
    for (const c of colList) {
      const m = merges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
      // A merged range is one cell, from its top-left (or the first cell of it inside what is copied).
      if (m && !(r === inside(rowList, m.r1, m.r2)[0] && c === inside(colList, m.c1, m.c2)[0])) continue;
      const cell = sheet?.cells[cellAddress(r, c)];
      const effect = look.effect?.(r, c);
      const tbl = look.table?.(r, c);
      const s = linkedStyle(cell, calc.workbook.themeColors);
      const v = calc.value(sheetId, cellAddress(r, c));
      const base: CellStyle = { ...s, ...(s?.align === undefined && typeof v === "number" ? { align: "right" as const } : {}), ...(effect?.style?.fontFamily ? { fontFamily: effect.style.fontFamily } : {}), ...(effect?.style?.fontSize ? { fontSize: effect.style.fontSize } : {}) };
      const own = cellCss(base, effect?.style?.fill ?? effect?.scale ?? (s?.fill ? undefined : tbl?.fill), effect?.style?.color ?? (s?.color ? undefined : tbl?.color), !!effect?.style?.bold || (!s?.bold && !!tbl?.bold));
      const extra = [effect?.style?.italic ? "font-style:italic" : "", effect?.style?.underline ? "text-decoration:underline" : ""].filter(Boolean).join(";");
      // The lines of a merged range are those along its edges.
      let borders = s?.border;
      if (m) {
        const at = (row: number, col: number) => sheet?.cells[cellAddress(row, col)]?.s?.border;
        borders = { ...(at(m.r1, m.c1)?.top ? { top: at(m.r1, m.c1)!.top! } : {}), ...(at(m.r1, m.c1)?.left ? { left: at(m.r1, m.c1)!.left! } : {}), ...(at(m.r1, m.c2)?.right ? { right: at(m.r1, m.c2)!.right! } : {}), ...(at(m.r2, m.c1)?.bottom ? { bottom: at(m.r2, m.c1)!.bottom! } : {}) };
      }
      const printed = print ? `padding:0 2pt;overflow:hidden;white-space:nowrap;position:relative;${print.gridlines ? "border:0.5pt solid #bfbfbf;" : ""}` : "";
      const lines = { ...borders, ...effect?.style?.border };
      const heading = headerRows.has(r) && marks.some((m) => m.header && m.sheetRow === r && c >= m.sheetCol && c < m.sheetCol + m.mark.cols);
      // A header cell is a `<th>`, which readers make bold and centred unless told otherwise: so it says what it is.
      const headerLook = heading ? [/font-weight/.test(own) ? "" : "font-weight:normal", /text-align/.test(own) ? "" : "text-align:left"].filter(Boolean).join(";") : "";
      const borderStyle = borderCss({ ...tbl?.border, ...borders, ...effect?.style?.border });
      const background = backgroundCss(effect, m ? { ...lines, ...(at0(m, sheet)?.diagonalUp ? { diagonalUp: at0(m, sheet)!.diagonalUp! } : {}), ...(at0(m, sheet)?.diagonalDown ? { diagonalDown: at0(m, sheet)!.diagonalDown! } : {}) } : lines);
      // Excel shows the cell with its number format (`mso-number-format`); text that it would turn into a number, date or formula when pasted is marked as text.
      let mso = "";
      if (!print) {
        const code = typeof v === "string" && typedLooking(v) ? '"\\@"' : toMsoNumberFormat(effect?.style?.fmt ?? cell?.fmt);
        if (code) mso = `mso-number-format:${code}`;
      }
      let css = print?.mono ? printed + monoCss([own, extra, headerLook, borderStyle].filter(Boolean).join(";")) : [printed + own, extra, headerLook, borderStyle, background, mso].filter(Boolean).join(";");
      const colspan = m ? inside(colList, m.c1, m.c2).length : 1;
      const rowspan = m ? inside(rowList, m.r1, m.r2).length : 1;
      let shownText = effect?.hideText ? "" : effect?.style?.fmt && v !== null && !isError(v) ? formatValue(v, effect.style.fmt).text : shown(calc, calc.workbook, sheetId, r, c);
      if (print?.errors && v !== null && isError(v)) shownText = printedError(print.errors, shownText);
      let spark = print ? look.sparkline?.(r, c) : undefined;
      if (spark && print?.mono) spark = monoSvg(spark);
      const sparkHtml = spark ? spark.replace('width="100%" height="100%"', `style="display:block;position:absolute;left:0;top:0" width="${print!.width(c)}pt" height="${print!.height(r)}pt"`) : "";
      // A picture in the cell, placed there or made by IMAGE, takes the place of its text.
      const pic = cell?.picture ? { src: cell.picture.src, alt: cell.picture.alt } : cell?.f !== undefined && /\bIMAGE\s*\(/i.test(cell.f) ? calc.imageAt(sheetId, cellAddress(r, c)) : undefined;
      const picHtml =
        pic && !print?.noGraphics && (pic.src.startsWith("data:") || look.remoteImages)
          ? print
            ? `<img src="${escapeHtml(pic.src)}" alt="${escapeHtml(pic.alt ?? "")}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain">`
            : `<img src="${escapeHtml(pic.src)}" alt="${escapeHtml(pic.alt ?? "")}" width="${sheet ? columnPixels(sheet, c) : 64}" height="${sheet ? rowPixelsOf(sheet, r) : 20}" style="object-fit:contain">`
          : "";
      let inner = picHtml || sparkHtml + escapeHtml(shownText).replace(/\n/g, "<br>");
      let room: { left: number; right: number } | undefined;
      // Text wider than its cell runs on over the empty cells beside it, as it does on the screen: it is a box laid over them.
      if (print && !m && !picHtml && !sparkHtml && !pic && typeof v === "string" && shownText !== "" && !s?.wrap && !shownText.includes("\n")) {
        const align = s?.align === "right" || s?.align === "center" ? s.align : "left";
        const run = overflowFor({ colList, index: colList.indexOf(c), width: (x) => print.width(x), empty: (x) => emptyAt(r, x), text: shownText, size: effect?.style?.fontSize ?? s?.fontSize ?? 11, bold: !!(s?.bold || effect?.style?.bold || tbl?.bold), align });
        if (run && (run.left > 0 || run.right > 0)) {
          room = { left: run.left, right: run.right };
          const w = print.width(c);
          const deco = [s?.underline || effect?.style?.underline ? "underline" : "", s?.strike || effect?.style?.strike ? "line-through" : ""].filter(Boolean).join(" ");
          const place =
            run.side === "right" ? `left:0;width:${w + run.right}pt;justify-content:flex-start` : run.side === "left" ? `right:0;width:${w + run.left}pt;justify-content:flex-end` : `left:${-run.left}pt;width:${run.left + w + run.right}pt;justify-content:center;padding-left:${2 + Math.max(0, run.left - run.right)}pt;padding-right:${2 + Math.max(0, run.right - run.left)}pt`;
          const vert = s?.vAlign === "top" ? "flex-start" : s?.vAlign === "middle" ? "center" : "flex-end";
          inner = `<span class="pli-print-run" style="position:absolute;top:0;bottom:0;z-index:1;display:flex;align-items:${vert};box-sizing:border-box;padding:0 2pt;overflow:hidden;white-space:nowrap;${place}${deco ? `;text-decoration:${deco}` : ""}">${escapeHtml(shownText)}</span>`;
          css = `${css};overflow:visible`;
          if (run.wider) print.overflow?.({ row: r, col: c, side: run.side, from: Math.min(c, ...run.reached.left), to: Math.max(c, ...run.reached.right), over: run.reached.left.length + run.reached.right.length, room: w + run.left + run.right });
        }
      }
      if (print?.cell) {
        const fill = print.mono ? undefined : effect?.style?.fill ?? effect?.scale ?? s?.fill ?? tbl?.fill;
        const ink = print.mono ? undefined : effect?.style?.color ?? s?.color ?? tbl?.color;
        const edge = (b: { style: string; color?: string } | undefined) => (b ? { ...b, color: print.mono ? "#000000" : b.color ?? "#000000" } : undefined);
        const sides = { ...tbl?.border, ...borders, ...effect?.style?.border } as Record<string, { style: string; color?: string } | undefined>;
        const diag = m ? at0(m, sheet) : s?.border;
        const lined: PrintedCell["borders"] = {};
        for (const k of ["top", "right", "bottom", "left"] as const) {
          const e = edge(sides[k]);
          if (e) lined[k] = e as never;
        }
        for (const k of ["diagonalUp", "diagonalDown"] as const) {
          const e = edge(diag?.[k]);
          if (e) lined[k] = e as never;
        }
        const widthOf = (list: readonly number[], a: number, z: number, size: (n: number) => number) => inside(list, a, z).reduce((n, x) => n + size(x), 0);
        const bar = effect?.bar;
        const info: PrintedCell = {
          row: r,
          col: c,
          x: colAt.get(c) ?? 0,
          y: rowAt.get(r) ?? 0,
          width: m ? widthOf(colList, m.c1, m.c2, print.width) : print.width(c),
          height: m ? widthOf(rowList, m.r1, m.r2, print.height) : print.height(r),
          text: picHtml ? "" : shownText,
          size: effect?.style?.fontSize ?? s?.fontSize ?? 11,
          align: base.align ?? "left",
          vAlign: s?.vAlign ?? "bottom",
          wrap: !!s?.wrap,
          indent: s?.indent ?? 0,
          borders: lined,
        };
        if (fill) info.fill = fill;
        if (ink && ink.toLowerCase() !== "#000000") info.color = ink;
        if (s?.bold || effect?.style?.bold || (!s?.bold && tbl?.bold)) info.bold = true;
        if (s?.italic || effect?.style?.italic) info.italic = true;
        if (s?.underline || effect?.style?.underline) info.underline = true;
        if (s?.strike || effect?.style?.strike) info.strike = true;
        const family = effect?.style?.fontFamily ?? s?.fontFamily;
        if (family) info.font = family;
        if (bar && bar.to > bar.from) info.bar = { from: bar.from, to: bar.to, color: print.mono ? "#000000" : bar.color, ...(bar.axis !== undefined ? { axis: bar.axis, axisColor: bar.axisColor ?? "#808080" } : {}) };
        if (effect?.icon && !print.noGraphics) info.icon = effect.icon;
        if (picHtml && pic) info.picture = { src: pic.src, ...(pic.alt ? { alt: pic.alt } : {}) };
        if (room) info.room = room;
        if (cell?.link && !isPlace(cell.link.to)) info.link = cell.link.to;
        print.cell(info);
      }
      const text = cell?.link && !isPlace(cell.link.to) ? `<a href="${escapeHtml(cell.link.to)}">${inner}</a>` : inner;
      const tag = heading ? "th" : "td";
      cells.push(`<${tag}${print && inner.startsWith('<span class="pli-print-run"') ? ' data-overflow=""' : ""}${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${css ? ` style="${css.replace(/"/g, "&quot;")}"` : ""}>${text}</${tag}>`);
    }
    if (print?.headings) cells.unshift(`<th style="width:${print.headings.width}pt;background:#f0f0f0;border:0.5pt solid #999;font-weight:normal;font-size:9pt">${r}</th>`);
    const tall = !print && sheet && sizedRows ? rowPixelsOf(sheet, r) : 0;
    rows.push(`<tr${print ? ` style="height:${print.height(r)}pt"` : tall > 0 ? ` height="${tall}" style="height:${tall}px"` : ""}>${cells.join("")}</tr>`);
  }
  if (!print) {
    // The widths of the columns, which a paste can keep.
    const group = sheet && sizedCols ? `<colgroup>${colList.map((c) => (columnPixels(sheet, c) > 0 ? `<col width="${columnPixels(sheet, c)}" style="width:${columnPixels(sheet, c)}px">` : "<col>")).join("")}</colgroup>` : "";
    const attr = (marks.length ? ` data-pli-tables="${escapeHtml(JSON.stringify(marks.map((m) => m.mark)))}"` : "") + cfMarkAttribute(look.rules, rowList, colList);
    return `<table${attr}>${group}<tbody>${rows.join("")}</tbody></table>`;
  }
  if (print.headings) {
    const letters = colList.map((c) => `<th style="background:#f0f0f0;border:0.5pt solid #999;font-weight:normal;font-size:9pt">${columnLetters(c)}</th>`).join("");
    rows.unshift(`<tr style="height:${print.headings.height}pt"><th style="width:${print.headings.width}pt;background:#f0f0f0;border:0.5pt solid #999"></th>${letters}</tr>`);
  }
  const widths = colList.reduce((n, c) => n + print.width(c), print.headings?.width ?? 0);
  const group = `<colgroup>${print.headings ? `<col style="width:${print.headings.width}pt">` : ""}${colList.map((c) => `<col style="width:${print.width(c)}pt">`).join("")}</colgroup>`;
  return `<table style="border-collapse:collapse;table-layout:fixed;width:${widths}pt">${group}<tbody>${rows.join("")}</tbody></table>`;
}

/** The diagonal lines of a cell. */
function at0(m: Bounds, sheet: { cells: Record<string, { s?: CellStyle }> } | undefined): CellBorders | undefined {
  return sheet?.cells[cellAddress(m.r1, m.c1)]?.s?.border;
}

/** The tables lying wholly inside the rows and columns copied: what marks them in the HTML, and where their headers are. */
function tableMarks(sheet: Sheet, rowList: readonly number[], colList: readonly number[]): { mark: HtmlTableMark; header: boolean; sheetRow: number; sheetCol: number }[] {
  const out: { mark: HtmlTableMark; header: boolean; sheetRow: number; sheetCol: number }[] = [];
  const r0 = rowList[0]!;
  const c0 = colList[0]!;
  for (const table of sheet.tables ?? []) {
    const b = parseRange(table.range);
    if (!b || rowList[b.r1 - r0] !== b.r1 || rowList[b.r2 - r0] !== b.r2 || colList[b.c1 - c0] !== b.c1 || colList[b.c2 - c0] !== b.c2) continue;
    const mark: HtmlTableMark = {
      name: table.name,
      row: b.r1 - r0,
      col: b.c1 - c0,
      rows: b.r2 - b.r1 + 1,
      cols: b.c2 - b.c1 + 1,
      columns: tableColumns(sheet, b, table),
      ...(table.style ? { style: table.style } : {}),
      ...(table.totals ? { totals: true as const } : {}),
      ...(table.headerRow === false ? { headerRow: false as const } : {}),
      ...(table.bandedRows === false ? { bandedRows: false as const } : {}),
      ...(table.bandedColumns ? { bandedColumns: true as const } : {}),
      ...(table.firstColumn ? { firstColumn: true as const } : {}),
      ...(table.lastColumn ? { lastColumn: true as const } : {}),
      ...(table.filterButtons === false ? { filterButtons: false as const } : {}),
      ...(table.calculated && Object.keys(table.calculated).length ? { calculated: table.calculated } : {}),
    };
    out.push({ mark, header: hasHeader(table), sheetRow: b.r1, sheetCol: b.c1 });
  }
  return out;
}
