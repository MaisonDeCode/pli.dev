import type { Workbook } from "./model";
import { sharing, whileSharing } from "./ghosts";
import { applyOp, ghostApply, placeAt, type SheetOp } from "./ops";

/**
 * Operations name sheets by id, but formulas name them by their name, and a list of things (charts, pictures, rules, tabs) is told
 * in positions. To merge a change with someone else's, the change has to say what the sheet was called and where in its list
 * the thing sat. `stampOps` fills that in from the workbook the operations are about to be applied to; the reducer does the
 * same in the operations that undo (see `ops.ts`). Operations without the stamps still apply: merging them just can't adjust the
 * formulas of the other sheets they meet, or the place in the list.
 *
 * It also writes down what rows, columns and sheets do on their own: inserting or deleting rows takes away every rule,
 * validation, table, sparkline or slicer that has nothing left to cover, and deleting a sheet takes slicers whose table was on
 * it. Those removals become `delete_…` operations that come first, so that another person's change to the same list sees
 * them and keeps every position right.
 */

const LISTS = {
  chart: "charts",
  rule: "conditional",
  table: "tables",
  slicer: "slicers",
  timeline: "timelines",
  image: "images",
  validation: "validations",
  sparklines: "sparklines",
  pivot: "pivots",
} as const;

type Kind = keyof typeof LISTS;
const KINDS = Object.keys(LISTS) as Kind[];

const itemOf = (op: SheetOp, kind: Kind): { id: string } => (op as unknown as Record<string, { id: string }>)[kind === "sparklines" ? "group" : kind]!;

const idsOf = (wb: Workbook, sheet: string, kind: Kind): string[] => ((wb.sheets.find((s) => s.id === sheet)?.[LISTS[kind]] ?? []) as { id: string }[]).map((x) => x.id);

const isStructural = (op: SheetOp) => op.type === "insert_rows" || op.type === "delete_rows" || op.type === "insert_cols" || op.type === "delete_cols" || op.type === "insert_row_runs" || op.type === "delete_row_runs";

/** The operations with what a merge needs to know added. The workbook is the one they are applied to, in order. */
export function stampOps(wb: Workbook, ops: readonly SheetOp[]): SheetOp[] {
  const names = new Map(wb.sheets.map((s) => [s.id, s.name]));
  // The workbook as the operations so far leave it: only kept when something in the batch needs it (a list, a tab, rows).
  let tracking = ops.some((o) => isStructural(o) || /^(add|delete|update)_/.test(o.type) || o.type === "move_sheet");
  let cur = wb;
  const out: SheetOp[] = [];

  const push = (op: SheetOp) => {
    out.push(op);
    if (!tracking) return;
    try {
      cur = ghostApply(cur, op);
    } catch {
      // It will not apply: nothing after it can be stamped from the workbook.
      tracking = false;
    }
  };

  /** What `op` takes away on its own, as explicit deletes (in the order that keeps each position right). */
  const vanished = (op: SheetOp): SheetOp[] => {
    if (!tracking) return [];
    let after: Workbook;
    try {
      after = applyOp(cur, op);
    } catch {
      return [];
    }
    const gone: SheetOp[] = [];
    for (const sheet of cur.sheets) {
      if (op.type === "delete_sheet" && op.id === sheet.id) continue;
      for (const kind of KINDS) {
        if (kind === "chart" || kind === "image") continue;
        const was = idsOf(cur, sheet.id, kind);
        if (!was.length) continue;
        const left = new Set(idsOf(after, sheet.id, kind));
        for (let i = was.length - 1; i >= 0; i--) if (!left.has(was[i]!)) gone.push({ type: `delete_${kind}` as "delete_rule", sheet: sheet.id, id: was[i]!, soft: true });
      }
    }
    return gone;
  };

  const stamp = (op: SheetOp): SheetOp => {
    switch (op.type) {
      case "insert_rows":
      case "delete_rows":
      case "insert_cols":
      case "delete_cols":
      case "insert_row_runs":
      case "delete_row_runs":
        return op.name === undefined && names.has(op.sheet) ? { ...op, name: names.get(op.sheet)! } : op;
      case "rename_sheet": {
        const from = op.from ?? names.get(op.id);
        names.set(op.id, op.name);
        return from === undefined || op.from !== undefined ? op : { ...op, from };
      }
      case "delete_sheet": {
        const name = op.name ?? names.get(op.id);
        const at = cur.sheets.findIndex((s) => s.id === op.id);
        const prev = at > 0 ? cur.sheets[at - 1]!.id : null;
        return { ...op, ...(name !== undefined ? { name } : {}), ...(at >= 0 && tracking ? { at, ...(op.prev === undefined ? { prev } : {}) } : {}) };
      }
      case "add_sheet": {
        names.set(op.sheet.id, op.sheet.name);
        if (!tracking) return op;
        const index = placeAt(cur.sheets, op.after, op.index);
        return { ...op, index, after: index > 0 ? cur.sheets[index - 1]!.id : null };
      }
      case "move_sheet": {
        if (!tracking) return op;
        const from = cur.sheets.findIndex((s) => s.id === op.id);
        return { ...op, ...(op.order ? {} : { order: cur.sheets.map((s) => s.id) }), ...(from >= 0 ? { from } : {}) };
      }
      case "add_chart": case "add_rule": case "add_table": case "add_slicer": case "add_timeline": case "add_image": case "add_validation": case "add_sparklines": case "add_pivot": {
        if (!tracking) return op;
        const kind = op.type.slice(4) as Kind;
        const list = (cur.sheets.find((s) => s.id === op.sheet)?.[LISTS[kind]] ?? []) as { id: string }[];
        const index = placeAt(list, op.after, op.index);
        return { ...op, index, after: index > 0 ? list[index - 1]!.id : null };
      }
      case "update_chart": case "update_rule": case "update_table": case "update_slicer": case "update_timeline": case "update_image": case "update_validation": case "update_sparklines": case "update_pivot": {
        if (!tracking || op.at !== undefined) return op;
        const at = idsOf(cur, op.sheet, op.type.slice(7) as Kind).indexOf(itemOf(op, op.type.slice(7) as Kind).id);
        return at < 0 ? op : { ...op, at };
      }
      case "delete_chart": case "delete_rule": case "delete_table": case "delete_slicer": case "delete_timeline": case "delete_image": case "delete_validation": case "delete_sparklines": case "delete_pivot": {
        if (!tracking) return op;
        const ids = idsOf(cur, op.sheet, op.type.slice(7) as Kind);
        const at = ids.indexOf(op.id);
        if (at < 0) return op;
        return { ...op, at, ...(op.prev === undefined ? { prev: at > 0 ? ids[at - 1]! : null } : {}) };
      }
      default:
        return op;
    }
  };

  /** The cells a table gets from inserted columns and rows (header names, calculated columns), as cells to write after the change. */
  const filled = (op: SheetOp): SheetOp[] => {
    if (!tracking || sharing() || !isStructural(op)) return [];
    let full: Workbook;
    let lean: Workbook;
    try {
      full = applyOp(cur, op);
      lean = whileSharing(() => applyOp(cur, op));
    } catch {
      return [];
    }
    const writes: SheetOp[] = [];
    full.sheets.forEach((sheet, i) => {
      const bare = lean.sheets[i];
      if (!bare || sheet.cells === bare.cells) return;
      const cells: Record<string, import("./model").Cell | null> = {};
      for (const address of new Set([...Object.keys(sheet.cells), ...Object.keys(bare.cells)])) if (sheet.cells[address] !== bare.cells[address] && JSON.stringify(sheet.cells[address]) !== JSON.stringify(bare.cells[address])) cells[address] = sheet.cells[address] ?? null;
      if (Object.keys(cells).length) writes.push({ type: "set_cells", sheet: sheet.id, cells });
    });
    return writes;
  };

  for (const op of ops) {
    if (isStructural(op) || op.type === "delete_sheet") for (const gone of vanished(op)) push(stamp(gone));
    const extra = filled(op);
    push(stamp(op));
    for (const write of extra) push(write);
  }
  return out;
}
