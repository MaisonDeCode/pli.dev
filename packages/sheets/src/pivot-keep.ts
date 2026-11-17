import { PliError } from "@pli.dev/core";
import type { Cell, CellStyle, Pivot, PivotAxisField, PivotFormat } from "./model";
import { axisHeading, type PivotCell, type PivotEntry, type PivotLine, type PivotRender } from "./pivot";

/*
 * Formatting you give the cells of a pivot table. The cells are drawn again whenever the table is refreshed or changed, so a
 * look is kept not on the cell but on what the cell stands for: the items of its row and its column (`Pivot.formats`; Excel's
 * "Preserve cell formatting on update"). The look follows the cell when the layout changes, and is out of view when the item is
 * no longer shown.
 */

/** The parts of a drawn table a format is found by. */
export interface KeepGeometry {
  bodyTop: number;
  headerRows: number;
  labelCols: number;
  /** The columns of data under each item of the columns (one for each value, unless the values run down the rows). */
  sub: number;
  lines: readonly PivotLine[];
  rowEntries: readonly PivotEntry[];
  colEntries: readonly PivotEntry[];
  /** The tabular or outline layout: a column of labels for each row field. */
  sideBySide: boolean;
  onRows: boolean;
  /** The heading of each row field and each column field, which names it in a format. */
  rowFields: string[];
  columnFields: string[];
}

/** What a cell of a drawn table is, as a format names it; null when it is not a cell a look can be kept on. */
export type KeepArea = Pick<PivotFormat, "part" | "items" | "value">;

const norm = (items: readonly { field: string; item: string }[]) => [...items].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)).map((i) => ({ field: i.field, item: i.item }));
const itemsOf = (fields: readonly string[], e: PivotEntry, upTo = e.path.length) => (e.kind === "grand" ? [] : e.path.slice(0, upTo).map((it, i) => ({ field: fields[i]!, item: it.label })));

/** The area of the cell at this row and column of the table (counted from the pivot table's top-left cell). */
export function areaAt(g: KeepGeometry, r: number, c: number): KeepArea | null {
  if (r < g.bodyTop || c < 0) return null;
  const hr = r - g.bodyTop;
  if (hr < g.headerRows) {
    // A column heading: the item (or total) the heading at this level stands for.
    if (c < g.labelCols || hr < 1 || hr > g.columnFields.length) return null;
    const e = g.colEntries[Math.floor((c - g.labelCols) / g.sub)];
    if (!e || e.kind === "blank") return null;
    const f = hr - 1;
    if (e.kind === "grand") return f === 0 ? { part: "label", items: [] } : null;
    if (e.kind === "subtotal" ? f !== e.path.length - 1 : e.path.length <= f) return null;
    return { part: "label", items: norm(itemsOf(g.columnFields, e, f + 1)) };
  }
  const line = g.lines[hr - g.headerRows];
  if (!line || line.entry === null) return null;
  const re = g.rowEntries[line.entry];
  if (!re || re.kind === "blank") return null;
  if (c < g.labelCols) {
    if (!g.sideBySide) return { part: "label", items: norm(itemsOf(g.rowFields, re)) };
    // A column of labels for each row field: the label shown in this column.
    if (c >= Math.max(g.rowFields.length, 1)) return null;
    if (re.kind === "grand") return c === 0 ? { part: "label", items: [] } : null;
    if (re.kind === "subtotal" ? c !== re.path.length - 1 : re.path.length <= c) return null;
    return { part: "label", items: norm(itemsOf(g.rowFields, re, c + 1)) };
  }
  const ci = Math.floor((c - g.labelCols) / g.sub);
  const ce = g.colEntries[ci];
  if (!ce || ce.kind === "blank") return null;
  const value = g.onRows ? line.value : (c - g.labelCols) % g.sub;
  return { part: "data", items: norm([...itemsOf(g.rowFields, re), ...itemsOf(g.columnFields, ce)]), ...(value !== undefined ? { value } : {}) };
}

const sameItems = (a: readonly { field: string; item: string }[], b: readonly { field: string; item: string }[]): boolean => a.length === b.length && a.every((x, i) => x.field === b[i]!.field && x.item === b[i]!.item);

/** Whether a kept format covers the cell an area describes. */
export function covers(f: PivotFormat, a: KeepArea, grand?: { row: boolean; column: boolean }): boolean {
  if (f.part !== a.part) return false;
  if (f.items !== undefined && !sameItems(norm(f.items), a.items ?? [])) return false;
  if (f.value !== undefined && f.value !== a.value) return false;
  if (f.grand === "row" && !grand?.row) return false;
  if (f.grand === "column" && !grand?.column) return false;
  return true;
}

const sameArea = (f: PivotFormat, a: KeepArea): boolean => f.part === a.part && f.value === a.value && f.grand === undefined && f.items !== undefined && sameItems(norm(f.items), a.items ?? []);

/** Draws the looks you gave over the cells of a table just worked out. */
export function applyFormats(formats: readonly PivotFormat[], cells: (PivotCell | undefined)[][], g: KeepGeometry, width: number): void {
  if (!formats.length) return;
  for (let r = g.bodyTop; r < cells.length; r++) {
    const line = g.lines[r - g.bodyTop - g.headerRows];
    const rowGrand = !!line && line.entry !== null && g.rowEntries[line.entry]?.kind === "grand";
    for (let c = 0; c < width; c++) {
      const area = areaAt(g, r, c);
      if (!area) continue;
      const colGrand = area.part === "data" && g.colEntries[Math.floor((c - g.labelCols) / g.sub)]?.kind === "grand";
      const hits = formats.filter((f) => covers(f, area, { row: rowGrand, column: colGrand }));
      if (!hits.length) continue;
      const cell: PivotCell = { ...(cells[r]![c] ?? {}) };
      const given: CellStyle = { ...cell.given };
      for (const f of hits) {
        for (const [k, v] of Object.entries(f.style ?? {})) {
          if (v === null) {
            // Taken off: neither the table's look nor an earlier format shows.
            delete (given as Record<string, unknown>)[k];
            delete (cell as Record<string, unknown>)[k];
          } else (given as Record<string, unknown>)[k] = v;
        }
        if (f.fmt !== undefined) {
          if (f.fmt === "General") delete cell.fmt;
          else cell.fmt = f.fmt;
        }
      }
      if (Object.keys(given).length) cell.given = given;
      else delete cell.given;
      // A cell with only a look is still a cell (an empty one that is coloured).
      cells[r]![c] = cell;
    }
  }
}

/**
 * The look a change made to a drawn cell adds: what the new cell's style and number format have that the old one's don't.
 * Null when the change is to something other than the look (the value, a link, a note…).
 */
export function lookChange(before: Cell | undefined, after: Cell | null): { style: NonNullable<PivotFormat["style"]>; fmt?: string } | null {
  const strip = (c: Cell | null | undefined) => {
    const { s: _s, fmt: _f, ...rest } = c ?? {};
    return JSON.stringify(rest);
  };
  if (strip(before) !== strip(after)) return null;
  const style: NonNullable<PivotFormat["style"]> = {};
  const was = (before?.s ?? {}) as Record<string, unknown>;
  const now = (after?.s ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[k]) === JSON.stringify(now[k])) continue;
    (style as Record<string, unknown>)[k] = k in now ? now[k] : null;
  }
  const out: { style: NonNullable<PivotFormat["style"]>; fmt?: string } = { style };
  if (before?.fmt !== after?.fmt) out.fmt = after?.fmt ?? "General";
  return out;
}

/** The formats of a pivot table with this look added for this area (an area that has a look already is changed). */
export function withLook(list: readonly PivotFormat[] | undefined, area: KeepArea, look: { style: NonNullable<PivotFormat["style"]>; fmt?: string }): PivotFormat[] {
  const out = (list ?? []).map((f) => ({ ...f }));
  const at = out.findIndex((f) => sameArea(f, area));
  if (at < 0) {
    out.push({ part: area.part, items: area.items ?? [], ...(area.value !== undefined ? { value: area.value } : {}), ...(Object.keys(look.style).length ? { style: look.style } : {}), ...(look.fmt !== undefined ? { fmt: look.fmt } : {}) });
    return out;
  }
  const old = out[at]!;
  const style = { ...old.style, ...look.style };
  const next: PivotFormat = { ...old };
  if (Object.keys(style).length) next.style = style;
  else delete next.style;
  if (look.fmt !== undefined) next.fmt = look.fmt;
  out[at] = next;
  return out;
}

/** Checks a pivot table's formats and makes them ready to keep. */
export function cleanFormats(list: readonly PivotFormat[], valueCount: number): PivotFormat[] {
  if (!Array.isArray(list) || list.length > 20_000) throw new PliError("invalid_operation", "A pivot table's formats are a list");
  return list.map((f) => {
    if (!f || (f.part !== "data" && f.part !== "label")) throw new PliError("invalid_operation", "A format of a pivot table is for the data or the labels");
    const out: PivotFormat = { part: f.part };
    if (f.items !== undefined) {
      const given = f.items as unknown;
      if (!Array.isArray(given) || !given.every((i: { field?: unknown; item?: unknown } | null) => i && typeof i.field === "string" && typeof i.item === "string")) throw new PliError("invalid_operation", "The items of a format are fields with the item each shows");
      out.items = (given as { field: string; item: string }[]).map((i) => ({ field: i.field, item: i.item }));
    }
    if (f.grand !== undefined) {
      if (f.grand !== "row" && f.grand !== "column") throw new PliError("invalid_operation", "A format's grand total is the row or the column");
      if (f.part !== "data" || f.items !== undefined) throw new PliError("invalid_operation", "Only a format for the data, with no items, can name the grand total row or column");
      out.grand = f.grand;
    }
    if (f.value !== undefined) {
      if (!Number.isInteger(f.value) || f.value < 0 || f.value >= Math.max(valueCount, 1)) throw new PliError("invalid_operation", "A format names one of the values (counting from 0)");
      out.value = f.value;
    }
    if (f.style !== undefined) {
      if (!f.style || typeof f.style !== "object") throw new PliError("invalid_operation", "A format's look is an object");
      const style: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f.style)) {
        if (v === undefined) continue;
        if (!["bold", "italic", "underline", "strike", "color", "fill", "fontFamily", "fontSize", "align", "vAlign", "wrap", "indent", "border"].includes(k)) throw new PliError("invalid_operation", `A format can't keep "${k}"`);
        style[k] = v;
      }
      if (Object.keys(style).length) out.style = style as NonNullable<PivotFormat["style"]>;
    }
    if (f.fmt !== undefined) {
      if (typeof f.fmt !== "string") throw new PliError("invalid_operation", "A number format is text");
      out.fmt = f.fmt;
    }
    return out;
  });
}

/** A render's parts as the geometry formats are found by. */
export function geometryOf(p: Pick<Pivot, "tabular" | "outline" | "columns" | "rows">, r: Pick<PivotRender, "bodyTop" | "headerRows" | "labelCols" | "lines" | "rowEntries" | "colEntries" | "valuesOnRows" | "valueNames">): KeepGeometry {
  const key = (f: PivotAxisField) => axisHeading(f);
  return {
    bodyTop: r.bodyTop,
    headerRows: r.headerRows,
    labelCols: r.labelCols,
    sub: r.valuesOnRows ? 1 : Math.max(r.valueNames.length, 1),
    lines: r.lines,
    rowEntries: r.rowEntries,
    colEntries: r.colEntries,
    sideBySide: !!(p.tabular || p.outline),
    onRows: r.valuesOnRows,
    rowFields: p.rows.map(key),
    columnFields: p.columns.map(key),
  };
}
