/**
 * One way to merge text edits, for every editor that has text: a document paragraph, a text box on a slide or a PDF
 * page, the text of a cell while it is being edited. Positions are character offsets (UTF-16 code units, the same as
 * JavaScript strings) into one run of text.
 *
 * An editor wraps these in its own operations (a document's `insert_text` is "insert, in block X"), calls
 * `transformText` for two edits to the same text, and uses `mapPosition` / `mapRange` to move cursors, selections and
 * comment anchors with the text. The properties its sync model needs hold for any two lists of edits made from the
 * same text: applying `earlier` then `later'`, or `later` then `earlier'`, give the same runs (`transformText` is tested
 * by a fuzzer that does exactly that).
 */

/** Formatting that goes with a piece of text. Opaque to this module: `null` in a `format` edit removes a key. */
export type TextAttrs = Record<string, unknown>;

export type TextOp<A extends TextAttrs = TextAttrs> =
  /** Puts `text` at `at`, with these attributes. */
  | { type: "insert"; at: number; text: string; attrs?: A }
  /** Removes `from` up to (not including) `to`. */
  | { type: "delete"; from: number; to: number }
  /** Changes attributes of `from` up to `to`: each key of `attrs` is set, or removed when its value is `null`. */
  | { type: "format"; from: number; to: number; attrs: { [K in keyof A]?: A[K] | null } };

/** A piece of text with one set of attributes. A list of runs is rich text. */
export interface TextRun<A extends TextAttrs = TextAttrs> {
  text: string;
  attrs?: A;
}

const hasKeys = (o: object | undefined): boolean => !!o && Object.keys(o).length > 0;
const sameAttrs = (a: TextAttrs | undefined, b: TextAttrs | undefined): boolean => {
  const ka = Object.keys(a ?? {}).filter((k) => (a as TextAttrs)[k] !== undefined);
  const kb = Object.keys(b ?? {}).filter((k) => (b as TextAttrs)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => JSON.stringify((a as TextAttrs)[k]) === JSON.stringify((b as TextAttrs)?.[k]));
};

/** The length of the text in some runs. */
export function runsLength(runs: readonly TextRun<any>[]): number {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

/** The plain text of some runs. */
export function runsText(runs: readonly TextRun<any>[]): string {
  return runs.map((r) => r.text).join("");
}

/** Runs with empty ones dropped and neighbours with the same attributes joined. */
export function normalizeTextRuns<A extends TextAttrs>(runs: readonly TextRun<A>[]): TextRun<A>[] {
  const out: TextRun<A>[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const last = out[out.length - 1];
    const attrs = hasKeys(run.attrs) ? run.attrs : undefined;
    if (last && sameAttrs(last.attrs, attrs)) last.text += run.text;
    else out.push(attrs ? { text: run.text, attrs } : { text: run.text });
  }
  return out;
}

function sliceRuns<A extends TextAttrs>(runs: readonly TextRun<A>[], from: number, to: number): TextRun<A>[] {
  const out: TextRun<A>[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    const a = Math.max(from, pos);
    const b = Math.min(to, end);
    if (a < b) out.push(run.attrs ? { text: run.text.slice(a - pos, b - pos), attrs: run.attrs } : { text: run.text.slice(a - pos, b - pos) });
    pos = end;
  }
  return out;
}

/** Applies one edit to some runs. Returns the new runs and the edits that undo it, in the order to apply them. */
export function applyTextOp<A extends TextAttrs>(runs: readonly TextRun<A>[], op: TextOp<A>): { runs: TextRun<A>[]; inverse: TextOp<A>[] } {
  const length = runsLength(runs);
  const bad = (what: string) => {
    throw new RangeError(`${what} is outside the text (length ${length})`);
  };
  if (op.type === "insert") {
    if (op.at < 0 || op.at > length) bad(`Insert at ${op.at}`);
    const before = sliceRuns(runs, 0, op.at);
    const after = sliceRuns(runs, op.at, length);
    const inserted: TextRun<A> = op.attrs ? { text: op.text, attrs: op.attrs } : { text: op.text };
    return { runs: normalizeTextRuns([...before, inserted, ...after]), inverse: op.text === "" ? [] : [{ type: "delete", from: op.at, to: op.at + op.text.length }] };
  }
  if (op.from < 0 || op.to > length || op.from > op.to) bad(`Range ${op.from}-${op.to}`);
  if (op.type === "delete") {
    const removed = sliceRuns(runs, op.from, op.to);
    let at = op.from;
    // Put back run by run, each in turn, so each keeps its own attributes.
    const inverse: TextOp<A>[] = removed.map((r) => {
      const insert: TextOp<A> = { type: "insert", at, text: r.text, ...(r.attrs ? { attrs: r.attrs } : {}) };
      at += r.text.length;
      return insert;
    });
    return { runs: normalizeTextRuns([...sliceRuns(runs, 0, op.from), ...sliceRuns(runs, op.to, length)]), inverse };
  }
  // format
  const inverse: TextOp<A>[] = [];
  const target = sliceRuns(runs, op.from, op.to);
  let at = op.from;
  const changed = target.map((r) => {
    const next: Record<string, unknown> = { ...(r.attrs ?? {}) };
    const undo: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(op.attrs)) {
      undo[key] = key in next && next[key] !== undefined ? next[key] : null;
      if (value === null || value === undefined) delete next[key];
      else next[key] = value;
    }
    inverse.push({ type: "format", from: at, to: at + r.text.length, attrs: undo as never });
    at += r.text.length;
    return hasKeys(next) ? { text: r.text, attrs: next as A } : { text: r.text };
  });
  return { runs: normalizeTextRuns([...sliceRuns(runs, 0, op.from), ...changed, ...sliceRuns(runs, op.to, length)]), inverse: inverse.reverse() };
}

/** Applies a list of edits in order. */
export function applyTextOps<A extends TextAttrs>(runs: readonly TextRun<A>[], ops: readonly TextOp<A>[]): TextRun<A>[] {
  return ops.reduce<TextRun<A>[]>((current, op) => applyTextOp(current, op).runs, [...runs]);
}

/** Applies edits that don't use attributes to a plain string. */
export function applyTextToString(text: string, ops: readonly TextOp<any>[]): string {
  return runsText(applyTextOps(text === "" ? [] : [{ text }], ops));
}

// ---- Transform ------------------------------------------------------------------------------------------------

/** Where a position goes when `from` up to `to` is deleted. */
const throughDelete = (x: number, from: number, to: number): number => (x <= from ? x : x >= to ? x - (to - from) : from);

/** A format edit as it is after a delete: clamped, or nothing if its whole range went. */
function formatAfterDelete(f: Extract<TextOp, { type: "format" }>, from: number, to: number): TextOp[] {
  const a = throughDelete(f.from, from, to);
  const b = throughDelete(f.to, from, to);
  return b > a ? [{ ...f, from: a, to: b }] : [];
}

/** A format edit as it is after an insert: shifted, or split around the new text so the new text stays as inserted. */
function formatAfterInsert(f: Extract<TextOp, { type: "format" }>, at: number, n: number): TextOp[] {
  if (at <= f.from) return [{ ...f, from: f.from + n, to: f.to + n }];
  if (at >= f.to) return [f];
  return [
    { ...f, from: f.from, to: at },
    { ...f, from: at + n, to: f.to + n },
  ];
}

/** A delete as it is after an insert: shifted, or split in two around the new text, which stays. */
function deleteAfterInsert(d: Extract<TextOp, { type: "delete" }>, at: number, n: number): TextOp[] {
  if (at <= d.from) return [{ ...d, from: d.from + n, to: d.to + n }];
  if (at >= d.to) return [d];
  // The later part goes first so the earlier part's positions are still right.
  return [
    { type: "delete", from: at + n, to: d.to + n },
    { type: "delete", from: d.from, to: at },
  ];
}

function deleteAfterDelete(d: Extract<TextOp, { type: "delete" }>, other: Extract<TextOp, { type: "delete" }>): TextOp[] {
  const from = throughDelete(d.from, other.from, other.to);
  const to = throughDelete(d.to, other.from, other.to);
  return to > from ? [{ type: "delete", from, to }] : [];
}

/** `earlier`'s format with the keys that `later` also sets taken out where the two overlap, so the later one wins there. */
function formatMinus(earlier: Extract<TextOp, { type: "format" }>, later: Extract<TextOp, { type: "format" }>): TextOp[] {
  const lo = Math.max(earlier.from, later.from);
  const hi = Math.min(earlier.to, later.to);
  if (lo >= hi) return [earlier];
  const out: TextOp[] = [];
  if (earlier.from < lo) out.push({ ...earlier, from: earlier.from, to: lo });
  const rest = Object.fromEntries(Object.entries(earlier.attrs).filter(([k]) => !(k in later.attrs)));
  if (hasKeys(rest)) out.push({ type: "format", from: lo, to: hi, attrs: rest });
  if (earlier.to > hi) out.push({ ...earlier, from: hi, to: earlier.to });
  return out;
}

type Ins = Extract<TextOp, { type: "insert" }>;
type Del = Extract<TextOp, { type: "delete" }>;
type Fmt = Extract<TextOp, { type: "format" }>;

/** Transforms one later edit and one earlier edit made from the same text. */
function pair(l: TextOp, e: TextOp): [TextOp[], TextOp[]] {
  if (l.type === "insert" && e.type === "insert") {
    // The earlier edit keeps its place; the later one goes after it.
    return [[{ ...l, at: e.at <= l.at ? l.at + e.text.length : l.at }], [{ ...e, at: l.at < e.at ? e.at + l.text.length : e.at }]];
  }
  if (l.type === "insert" && e.type === "delete") return [[{ ...l, at: throughDelete(l.at, e.from, e.to) }], deleteAfterInsert(e, l.at, l.text.length)];
  if (l.type === "delete" && e.type === "insert") return [deleteAfterInsert(l, e.at, e.text.length), [{ ...e, at: throughDelete(e.at, l.from, l.to) }]];
  if (l.type === "delete" && e.type === "delete") return [deleteAfterDelete(l, e), deleteAfterDelete(e, l)];
  if (l.type === "insert" && e.type === "format") return [[l], formatAfterInsert(e, l.at, l.text.length)];
  if (l.type === "format" && e.type === "insert") return [formatAfterInsert(l, e.at, e.text.length), [e]];
  if (l.type === "delete" && e.type === "format") return [[l], formatAfterDelete(e, l.from, l.to)];
  if (l.type === "format" && e.type === "delete") return [formatAfterDelete(l, e.from, e.to), [e]];
  // Two formats: the later one wins where they overlap.
  return [[l], formatMinus(e as Fmt, l as Fmt)];
}

/**
 * Transforms two lists of edits made from the same text. `earlier` was accepted first. Returns `later` as it must be
 * applied after `earlier`, and `earlier` as it must be applied after `later`, so both orders give the same text. This
 * is what `SyncModel.transform` needs for the text part of an editor's operations.
 */
export function transformText<A extends TextAttrs>(later: readonly TextOp<A>[], earlier: readonly TextOp<A>[]): [TextOp<A>[], TextOp<A>[]] {
  if (later.length === 0 || earlier.length === 0) return [[...later], [...earlier]];
  if (later.length === 1 && earlier.length === 1) return pair(later[0]!, earlier[0]!) as [TextOp<A>[], TextOp<A>[]];
  if (later.length > 1) {
    const [first, ...rest] = later;
    const [f, e1] = transformText([first!], earlier);
    const [r, e2] = transformText(rest, e1);
    return [[...f, ...r], e2];
  }
  const [first, ...rest] = earlier;
  const [l1, f] = transformText(later, [first!]);
  const [l2, r] = transformText(l1, rest);
  return [l2, [...f, ...r]];
}

// ---- Positions ------------------------------------------------------------------------------------------------

/**
 * Where a position in the text is after some edits. `assoc` says which way it leans when text is inserted exactly at
 * it: `1` (the default) stays before the new text's end, so a caret typed at moves on; `-1` stays before the new text.
 */
export function mapPosition(position: number, ops: readonly TextOp<any>[], assoc: 1 | -1 = 1): number {
  let pos = position;
  for (const op of ops) {
    if (op.type === "insert") {
      if (op.at < pos || (op.at === pos && assoc === 1)) pos += op.text.length;
    } else if (op.type === "delete") {
      pos = throughDelete(pos, op.from, op.to);
    }
  }
  return pos;
}

/**
 * Where a range is after some edits, for a selection or a comment's anchor. Text typed at either edge is outside the
 * range. Returns null when everything in the range was deleted.
 */
export function mapRange(range: { from: number; to: number }, ops: readonly TextOp<any>[]): { from: number; to: number } | null {
  if (range.from === range.to) {
    const at = mapPosition(range.from, ops, 1);
    return { from: at, to: at };
  }
  const from = mapPosition(range.from, ops, 1);
  const to = mapPosition(range.to, ops, -1);
  return to > from ? { from, to } : null;
}
