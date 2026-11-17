import { cellAddress, rangeAddress, type Bounds } from "./address";
import type { Pivot, RulePivot } from "./model";
import type { PivotRender } from "./pivot";

/** Why a pivot rule's scope doesn't fit its pivot table, or null. */
export function pivotScopeProblem(pivot: Pivot, scope: RulePivot): string | null {
  if (scope.value !== undefined && scope.value >= pivot.values.length) return `${pivot.name} has no value number ${scope.value + 1}`;
  if (scope.rows !== undefined && !pivot.rows.some((f) => f.field === scope.rows)) return `"${scope.rows}" isn't a row field of ${pivot.name}`;
  if (scope.columns !== undefined && !pivot.columns.some((f) => f.field === scope.columns)) return `"${scope.columns}" isn't a column field of ${pivot.name}`;
  for (const field of Object.keys(scope.items ?? {})) if (!pivot.rows.some((f) => f.field === field) && !pivot.columns.some((f) => f.field === field)) return `"${field}" isn't a row or column field of ${pivot.name}`;
  return null;
}

/**
 * The cells of a drawn pivot table that a rule's scope covers, as ranges on the sheet: the body's cells that show the value
 * (all of them when the scope names none), at the level of the row and column fields it names (any level when it names none).
 * `anchor` is the pivot table's top-left cell.
 */
export function pivotScopeRanges(pivot: Pivot, render: PivotRender, anchor: { row: number; col: number }, scope: RulePivot): string[] {
  const depth = (fields: readonly { field: string }[], name: string | undefined) => (name === undefined ? 0 : fields.findIndex((f) => f.field === name) + 1);
  const rowDepth = depth(pivot.rows, scope.rows);
  const colDepth = depth(pivot.columns, scope.columns);
  const sub = render.valuesOnRows ? 1 : Math.max(render.valueNames.length, 1);
  // Items a field is limited to: the cell's row (or column) must be under one of them, at that field's level or deeper.
  const limits = (fields: readonly { field: string }[]) => Object.entries(scope.items ?? {}).flatMap(([field, labels]) => (fields.findIndex((f) => f.field === field) >= 0 ? [{ depth: fields.findIndex((f) => f.field === field), labels: new Set(labels) }] : []));
  const rowLimits = limits(pivot.rows);
  const colLimits = limits(pivot.columns);
  const under = (path: readonly { label: string }[], ls: { depth: number; labels: Set<string> }[]) => ls.every((l) => path.length > l.depth && l.labels.has(path[l.depth]!.label));
  const hit = new Map<number, number[]>();
  const add = (col: number, row: number) => {
    const list = hit.get(col) ?? [];
    list.push(row);
    hit.set(col, list);
  };
  render.lines.forEach((line, li) => {
    if (line.entry === null) return;
    const re = render.rowEntries[line.entry];
    if (!re || re.kind === "blank") return;
    if (rowDepth && (re.path.length !== rowDepth || re.kind === "grand")) return;
    if (!under(re.path, rowLimits)) return;
    if (render.valuesOnRows && scope.value !== undefined && line.value !== scope.value) return;
    const row = render.bodyTop + render.headerRows + li;
    render.colEntries.forEach((ce, ci) => {
      if (ce.kind === "blank") return;
      if (colDepth && (ce.path.length !== colDepth || ce.kind === "grand")) return;
      if (!under(ce.path, colLimits)) return;
      for (let k = 0; k < sub; k++) {
        if (!render.valuesOnRows && scope.value !== undefined && k !== scope.value) continue;
        const col = render.labelCols + ci * sub + k;
        if (render.cells[row]?.[col]) add(col, row);
      }
    });
  });
  // Runs of rows in each column, and columns beside each other with the same runs make one range.
  const runs = new Map<number, [number, number][]>();
  for (const [col, rows] of hit) {
    rows.sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last[1] === r - 1) last[1] = r;
      else out.push([r, r]);
    }
    runs.set(col, out);
  }
  const key = (col: number) => JSON.stringify(runs.get(col));
  const result: Bounds[] = [];
  const cols = [...runs.keys()].sort((a, b) => a - b);
  for (let i = 0; i < cols.length; ) {
    let j = i;
    while (j + 1 < cols.length && cols[j + 1] === cols[j]! + 1 && key(cols[j + 1]!) === key(cols[i]!)) j++;
    for (const [r1, r2] of runs.get(cols[i]!)!) result.push({ r1: anchor.row + r1, r2: anchor.row + r2, c1: anchor.col + cols[i]!, c2: anchor.col + cols[j]! });
    i = j + 1;
  }
  return result.map(rangeAddress);
}

/** The range to leave a pivot rule on when nothing is left for it to cover: the pivot table's first cell. */
export const pivotRuleFallback = (anchor: { row: number; col: number }): string => cellAddress(anchor.row, anchor.col);

/**
 * The scope that follows the cells picked in a drawn pivot table, as Excel's rule for selected cells does: the value they
 * show (when it is one), the level of rows and columns they are on, and, for each field, the items they are under when
 * that is only some of its items. `bounds` are sheet coordinates; null when the selection isn't only cells of the body.
 */
export function pivotSelectionScope(pivot: Pivot, render: PivotRender, anchor: { row: number; col: number }, bounds: Bounds): RulePivot | null {
  const sub = render.valuesOnRows ? 1 : Math.max(render.valueNames.length, 1);
  const rowsAt = new Set<number>();
  const colsAt = new Set<number>();
  const values = new Set<number>();
  for (let r = bounds.r1; r <= bounds.r2; r++) {
    for (let c = bounds.c1; c <= bounds.c2; c++) {
      const row = r - anchor.row;
      const col = c - anchor.col;
      const li = row - render.bodyTop - render.headerRows;
      const line = render.lines[li];
      const ci = Math.floor((col - render.labelCols) / sub);
      const k = (col - render.labelCols) % sub;
      const re = line && line.entry !== null ? render.rowEntries[line.entry] : undefined;
      const ce = col >= render.labelCols ? render.colEntries[ci] : undefined;
      if (li < 0 || !line || !re || !ce || re.kind === "blank" || ce.kind === "blank" || !render.cells[row]?.[col]) return null;
      rowsAt.add(line.entry!);
      colsAt.add(ci);
      values.add(render.valuesOnRows ? (line.value ?? 0) : k);
    }
  }
  if (!rowsAt.size) return null;
  const found: RulePivot = { id: pivot.id };
  if (values.size === 1 && render.valueNames.length > 1) found.value = [...values][0]!;
  const side = (fields: readonly { field: string }[], entries: readonly { kind: string; path: readonly { label: string }[] }[], picked: number[]) => {
    const chosen = picked.map((i) => entries[i]!);
    const lengths = new Set(chosen.map((e) => (e.kind === "grand" ? 0 : e.path.length)));
    const out: { level?: string; items: Record<string, string[]> } = { items: {} };
    if (lengths.size === 1 && [...lengths][0]! > 0) {
      const all = entries.filter((e) => e.kind !== "grand" && e.kind !== "blank");
      // The level is only worth naming when the table has cells at other levels (subtotals) too.
      if (all.some((e) => e.path.length !== [...lengths][0]!)) out.level = fields[[...lengths][0]! - 1]?.field;
    }
    fields.forEach((f, d) => {
      if (!chosen.every((e) => e.kind !== "grand" && e.path.length > d)) return;
      const labels = [...new Set(chosen.map((e) => e.path[d]!.label))];
      const universe = new Set(entries.filter((e) => e.kind !== "grand" && e.kind !== "blank" && e.path.length > d).map((e) => e.path[d]!.label));
      if (labels.length < universe.size) out.items[f.field] = labels;
    });
    return out;
  };
  const rowSide = side(pivot.rows, render.rowEntries, [...rowsAt]);
  const colSide = side(pivot.columns, render.colEntries, [...colsAt]);
  if (rowSide.level) found.rows = rowSide.level;
  if (colSide.level) found.columns = colSide.level;
  const items = { ...rowSide.items, ...colSide.items };
  if (Object.keys(items).length) found.items = items;
  return found;
}
