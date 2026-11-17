import { MAX_COLS, MAX_ROWS } from "./model";
import { parseFormula, printFormula, type Node, type Pt } from "./formula";
import { runMap, type Run } from "./runs";

type RefNode = Extract<Node, { t: "ref" }>;

const REF_ERROR: Node = { t: "err", v: "#REF!" };

/** Rewrites every node of a tree bottom-up; `fn` returns a replacement, or the node itself. */
export function mapNodes(node: Node, fn: (n: Node) => Node): Node {
  switch (node.t) {
    case "call":
      return fn({ ...node, args: node.args.map((a) => mapNodes(a, fn)) });
    case "unary":
    case "percent":
    case "paren":
      return fn({ ...node, arg: mapNodes(node.arg, fn) });
    case "binary":
      return fn({ ...node, left: mapNodes(node.left, fn), right: mapNodes(node.right, fn) });
    case "array":
      return fn({ ...node, rows: node.rows.map((r) => r.map((c) => mapNodes(c, fn))) });
    default:
      return fn(node);
  }
}

/** Every reference in a formula, in order. */
export function refsIn(node: Node, out: RefNode[] = []): RefNode[] {
  switch (node.t) {
    case "ref":
      out.push(node);
      break;
    case "call":
      node.args.forEach((a) => refsIn(a, out));
      break;
    case "unary":
    case "percent":
    case "paren":
      refsIn(node.arg, out);
      break;
    case "binary":
      refsIn(node.left, out);
      refsIn(node.right, out);
      break;
    case "array":
      node.rows.forEach((r) => r.forEach((c) => refsIn(c, out)));
      break;
  }
  return out;
}

// ---- moving a formula (copy, paste, fill) ----

function shiftPt(p: Pt, dRow: number, dCol: number): Pt | null {
  const col = p.col === null || p.colAbs ? p.col : p.col + dCol;
  const row = p.row === null || p.rowAbs ? p.row : p.row + dRow;
  if ((col !== null && (col < 1 || col > MAX_COLS)) || (row !== null && (row < 1 || row > MAX_ROWS))) return null;
  return { ...p, col, row };
}

/**
 * The formula as it reads when copied `dRow` rows down and `dCol` columns across: relative references move with it,
 * `$` ones stay. A reference pushed off the sheet becomes `#REF!`.
 */
export function shiftFormula(source: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return source;
  const tree = mapNodes(parseFormula(source), (n) => {
    if (n.t !== "ref") return n;
    const a = shiftPt(n.a, dRow, dCol);
    const b = n.b ? shiftPt(n.b, dRow, dCol) : undefined;
    if (!a || (n.b && !b)) return REF_ERROR;
    return { ...n, a, ...(b ? { b } : {}) };
  });
  return printFormula(tree);
}

// ---- inserting and deleting rows and columns ----

export interface Structure {
  /** The sheet whose rows or columns change. */
  sheet: string;
  axis: "row" | "col";
  /** `insert`: `count` new ones at `at`. `delete`: the `count` from `at` go. */
  kind: "insert" | "delete";
  at: number;
  count: number;
  /** Many places at once (rows only): each `[at, count]` in the coordinates before the change. `at` and `count` are then those of the first. */
  runs?: readonly Run[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Where a span `[from, to]` ends up; null when all of it is deleted. */
function moveSpan(from: number, to: number, s: Structure): [number, number] | null {
  if (s.runs) {
    const m = runMap(s.kind, s.runs);
    const start = m.lo(from);
    const end = m.hi(to);
    return start > end ? null : [start, end];
  }
  if (s.kind === "insert") {
    return [from >= s.at ? from + s.count : from, to >= s.at ? to + s.count : to];
  }
  const last = s.at + s.count - 1;
  if (from >= s.at && to <= last) return null;
  const start = from > last ? from - s.count : from >= s.at ? s.at : from;
  const end = to > last ? to - s.count : to >= s.at ? s.at - 1 : to;
  return [start, end];
}

/** The formula as it must read after rows or columns are inserted or deleted on `s.sheet`; `home` is the sheet it sits on. */
export function adjustFormula(source: string, home: string, s: Structure): string {
  let changed = false;
  const tree = mapNodes(parseFormula(source), (n) => {
    if (n.t !== "ref") return n;
    if (!same(n.sheet ?? home, s.sheet)) return n;
    const key = s.axis === "row" ? "row" : "col";
    const lo = n.a[key];
    const hi = (n.b ?? n.a)[key];
    if (lo === null || hi === null) return n; // a whole column when rows change (or the other way round) doesn't move
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    const moved = moveSpan(from, to, s);
    if (!moved) {
      changed = true;
      return REF_ERROR;
    }
    if (moved[0] === from && moved[1] === to) return n;
    changed = true;
    const flipped = lo > hi;
    const a = { ...n.a, [key]: flipped ? moved[1] : moved[0] };
    const b = n.b ? { ...n.b, [key]: flipped ? moved[0] : moved[1] } : undefined;
    return { ...n, a, ...(b ? { b } : {}) };
  });
  return changed ? printFormula(tree) : source;
}

// ---- renaming and deleting sheets ----

export function renameSheetInFormula(source: string, from: string, to: string): string {
  let changed = false;
  const tree = mapNodes(parseFormula(source), (n) => {
    if (n.t === "ref" && n.sheet !== undefined && same(n.sheet, from)) {
      changed = true;
      return { ...n, sheet: to };
    }
    return n;
  });
  return changed ? printFormula(tree) : source;
}

/** References to a sheet that no longer exists become `#REF!`. */
export function dropSheetFromFormula(source: string, name: string): string {
  let changed = false;
  const tree = mapNodes(parseFormula(source), (n) => {
    if (n.t === "ref" && n.sheet !== undefined && same(n.sheet, name)) {
      changed = true;
      return REF_ERROR;
    }
    return n;
  });
  return changed ? printFormula(tree) : source;
}

// ---- moving cells ----

export interface Move {
  /** The sheet the cells are moved from, and the cells. */
  sheet: string;
  bounds: { r1: number; c1: number; r2: number; c2: number };
  /** The sheet they go to, by name, and how far they go. */
  toSheet: string;
  dRow: number;
  dCol: number;
}

/**
 * The formula as it must read after cells are moved (cut and pasted, or dragged): a reference to cells that are all
 * inside the moved block follows them, wherever the formula is. A reference that takes in only some of them stays.
 */
export function moveReferences(source: string, home: string, m: Move): string {
  let changed = false;
  const tree = mapNodes(parseFormula(source), (n) => {
    if (n.t !== "ref" || !same(n.sheet ?? home, m.sheet)) return n;
    const b = n.b ?? n.a;
    if (n.a.row === null || n.a.col === null || b.row === null || b.col === null) return n;
    const r1 = Math.min(n.a.row, b.row);
    const r2 = Math.max(n.a.row, b.row);
    const c1 = Math.min(n.a.col, b.col);
    const c2 = Math.max(n.a.col, b.col);
    if (r1 < m.bounds.r1 || r2 > m.bounds.r2 || c1 < m.bounds.c1 || c2 > m.bounds.c2) return n;
    changed = true;
    const a = { ...n.a, row: n.a.row + m.dRow, col: n.a.col + m.dCol };
    const e = n.b ? { ...n.b, row: b.row + m.dRow, col: b.col + m.dCol } : undefined;
    const moved = { ...n, a, ...(e ? { b: e } : {}) };
    if (same(m.toSheet, home)) delete moved.sheet;
    else moved.sheet = m.toSheet;
    return moved;
  });
  return changed ? printFormula(tree) : source;
}
