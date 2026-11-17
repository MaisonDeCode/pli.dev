/**
 * Text as a stream of characters with attributes, and edits to it as a *delta*: keep so many characters (optionally
 * changing their attributes), insert some, delete some. Two deltas made from the same text can be merged character
 * by character, which is what lets two people type in the same text box. This is the same idea as Quill's
 * deltas, written here so that it stays small, JSON, and free of dependencies.
 *
 * A text body becomes one stream: every character of every paragraph with the character's marks as attributes,
 * and a `"\n"` after each paragraph that carries the paragraph's properties.
 */
import { PliError } from "@pli.dev/core";
import type { Marks, Paragraph, Run } from "./model";

/** Attribute changes: a value sets the attribute, `null` removes it. In a document stream there are no `null`s. */
export type Attrs = Record<string, unknown>;

export type DeltaOp = { insert: string; attrs?: Attrs } | { retain: number; attrs?: Attrs } | { delete: number };
export type Delta = DeltaOp[];

const isInsert = (op: DeltaOp): op is { insert: string; attrs?: Attrs } => "insert" in op;
const isRetain = (op: DeltaOp): op is { retain: number; attrs?: Attrs } => "retain" in op;
const isDelete = (op: DeltaOp): op is { delete: number } => "delete" in op;

const lengthOf = (op: DeltaOp): number => (isInsert(op) ? op.insert.length : isRetain(op) ? op.retain : op.delete);

/** JSON with sorted keys, so equal values have equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sameValue = (a: unknown, b: unknown): boolean => a === b || canonicalJson(a) === canonicalJson(b);

function nonEmpty(attrs: Attrs | undefined): Attrs | undefined {
  return attrs && Object.keys(attrs).length > 0 ? attrs : undefined;
}

const sameAttrs = (a: Attrs | undefined, b: Attrs | undefined): boolean => sameValue(a ?? {}, b ?? {});

/** Merges neighbouring operations of one kind with the same attributes, drops empty ones and trailing plain retains. */
export function normalizeDelta(delta: readonly DeltaOp[]): Delta {
  const out: Delta = [];
  for (const op of delta) {
    if (lengthOf(op) === 0) continue;
    const last = out[out.length - 1];
    if (last && isInsert(last) && isInsert(op) && sameAttrs(last.attrs, op.attrs)) out[out.length - 1] = { insert: last.insert + op.insert, ...(nonEmpty(op.attrs) ? { attrs: op.attrs } : {}) };
    else if (last && isRetain(last) && isRetain(op) && sameAttrs(last.attrs, op.attrs)) out[out.length - 1] = { retain: last.retain + op.retain, ...(nonEmpty(op.attrs) ? { attrs: op.attrs } : {}) };
    else if (last && isDelete(last) && isDelete(op)) out[out.length - 1] = { delete: last.delete + op.delete };
    else if (isInsert(op)) out.push(nonEmpty(op.attrs) ? { insert: op.insert, attrs: op.attrs } : { insert: op.insert });
    else if (isRetain(op)) out.push(nonEmpty(op.attrs) ? { retain: op.retain, attrs: op.attrs } : { retain: op.retain });
    else out.push({ delete: op.delete });
  }
  const last = out[out.length - 1];
  if (last && isRetain(last) && !last.attrs) out.pop();
  return out;
}

/** Whether a delta changes nothing. */
export const isNoop = (delta: readonly DeltaOp[]): boolean => normalizeDelta(delta).length === 0;

/** The characters a delta inserts and deletes: how far it moves a position after it. */
export function deltaShift(delta: readonly DeltaOp[]): number {
  return delta.reduce((n, op) => n + (isInsert(op) ? op.insert.length : isDelete(op) ? -op.delete : 0), 0);
}

/** A cursor over a delta that can hand out part of an operation. */
class Cursor {
  #index = 0;
  #offset = 0;
  constructor(readonly ops: readonly DeltaOp[]) {}
  hasNext(): boolean {
    return this.#index < this.ops.length;
  }
  /** `insert`, `retain` or `delete`; an exhausted cursor retains for ever. */
  kind(): "insert" | "retain" | "delete" {
    const op = this.ops[this.#index];
    return !op ? "retain" : isInsert(op) ? "insert" : isRetain(op) ? "retain" : "delete";
  }
  length(): number {
    const op = this.ops[this.#index];
    return op ? lengthOf(op) - this.#offset : Infinity;
  }
  next(length = Infinity): DeltaOp {
    const op = this.ops[this.#index];
    if (!op) return { retain: length };
    const offset = this.#offset;
    const available = lengthOf(op) - offset;
    const take = Math.min(length, available);
    if (take === available) {
      this.#index++;
      this.#offset = 0;
    } else this.#offset += take;
    if (isDelete(op)) return { delete: take };
    if (isRetain(op)) return op.attrs ? { retain: take, attrs: op.attrs } : { retain: take };
    const text = op.insert.slice(offset, offset + take);
    return op.attrs ? { insert: text, attrs: op.attrs } : { insert: text };
  }
}

/** Applies attribute changes to the attributes of a character: `null` removes. */
export function applyAttrs(base: Attrs | undefined, patch: Attrs | undefined): Attrs | undefined {
  if (!patch) return base;
  const out: Attrs = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return nonEmpty(out);
}

/** The change that takes attributes `a` to `b`. */
export function diffAttrs(a: Attrs | undefined, b: Attrs | undefined): Attrs | undefined {
  const out: Attrs = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = a?.[key];
    const y = b?.[key];
    if (!sameValue(x, y)) out[key] = y === undefined ? null : y;
  }
  return nonEmpty(out);
}

/** The attribute change that undoes `patch` on characters that had `base`. */
function invertAttrs(patch: Attrs, base: Attrs | undefined): Attrs {
  const out: Attrs = {};
  for (const key of Object.keys(patch)) out[key] = base?.[key] ?? null;
  return out;
}

/** Applies a delta to a document (a delta of inserts only). */
export function applyDelta(doc: readonly DeltaOp[], delta: readonly DeltaOp[]): Delta {
  const out: DeltaOp[] = [];
  const d = new Cursor(doc);
  for (const op of delta) {
    if (isInsert(op)) {
      out.push(op.attrs ? { insert: op.insert, attrs: applyAttrs(undefined, op.attrs) } : { insert: op.insert });
    } else if (isRetain(op)) {
      let left = op.retain;
      while (left > 0) {
        if (!d.hasNext()) throw new PliError("invalid_operation", "A text change reaches past the end of the text");
        const piece = d.next(left) as { insert: string; attrs?: Attrs };
        left -= piece.insert.length;
        out.push(op.attrs ? { insert: piece.insert, attrs: applyAttrs(piece.attrs, op.attrs) } : piece);
      }
    } else {
      let left = op.delete;
      while (left > 0) {
        if (!d.hasNext()) throw new PliError("invalid_operation", "A text change reaches past the end of the text");
        left -= lengthOf(d.next(left));
      }
    }
  }
  while (d.hasNext()) out.push(d.next());
  return normalizeDelta(out);
}

/** The delta that undoes `delta`, which was made for `doc`. */
export function invertDelta(delta: readonly DeltaOp[], doc: readonly DeltaOp[]): Delta {
  const out: DeltaOp[] = [];
  const d = new Cursor(doc);
  for (const op of delta) {
    if (isInsert(op)) out.push({ delete: op.insert.length });
    else if (isRetain(op)) {
      let left = op.retain;
      while (left > 0) {
        if (!d.hasNext()) throw new PliError("invalid_operation", "A text change reaches past the end of the text");
        const piece = d.next(left) as { insert: string; attrs?: Attrs };
        left -= piece.insert.length;
        out.push(op.attrs ? { retain: piece.insert.length, attrs: invertAttrs(op.attrs, piece.attrs) } : { retain: piece.insert.length });
      }
    } else {
      let left = op.delete;
      while (left > 0) {
        if (!d.hasNext()) throw new PliError("invalid_operation", "A text change reaches past the end of the text");
        const piece = d.next(left) as { insert: string; attrs?: Attrs };
        left -= piece.insert.length;
        out.push(piece.attrs ? { insert: piece.insert, attrs: piece.attrs } : { insert: piece.insert });
      }
    }
  }
  return normalizeDelta(out);
}

export interface TransformOptions {
  /** When both insert at the same place, the other's text goes first. */
  baseFirst: boolean;
  /** When both change the same attribute of the same character, this change wins. */
  selfWins: boolean;
}

/**
 * Rewrites `self`, made from the same text as `base`, so that it applies after `base`. Characters `base` deleted need
 * no further change; text inserted by `base` is kept in place. The result applied after `base`, and `base`'s transform
 * applied after `self` (with the opposite options), give the same text.
 */
export function transformDelta(self: readonly DeltaOp[], base: readonly DeltaOp[], options: TransformOptions): Delta {
  const a = new Cursor(self);
  const b = new Cursor(base);
  const out: DeltaOp[] = [];
  while (a.hasNext() || b.hasNext()) {
    if (b.kind() === "insert" && (options.baseFirst || a.kind() !== "insert")) {
      out.push({ retain: lengthOf(b.next()) });
    } else if (a.kind() === "insert") {
      out.push(a.next());
    } else {
      const n = Math.min(a.length(), b.length());
      const mine = a.next(n);
      const theirs = b.next(n);
      if (isDelete(theirs)) continue;
      if (isDelete(mine)) {
        out.push(mine);
        continue;
      }
      const attrs = (mine as { attrs?: Attrs }).attrs;
      const other = (theirs as { attrs?: Attrs }).attrs;
      let kept = attrs;
      if (attrs && other && !options.selfWins) kept = nonEmpty(Object.fromEntries(Object.entries(attrs).filter(([k]) => !(k in other))));
      out.push(kept ? { retain: n, attrs: kept } : { retain: n });
    }
  }
  return normalizeDelta(out);
}

/** Where a position in the text is after `delta`. A position at an insert moves along with it unless `before` says it stays in front. */
export function mapIndex(index: number, delta: readonly DeltaOp[], before = false): number {
  let at = 0;
  let out = index;
  for (const op of delta) {
    if (at > index) break;
    if (isInsert(op)) {
      const n = op.insert.length;
      if (at < index || (at === index && !before)) out += n;
      // An insert at a position before it doesn't move a position that stays in front.
    } else if (isDelete(op)) {
      const end = at + op.delete;
      if (end <= index) out -= op.delete;
      else if (at < index) out -= index - at;
      at = end;
    } else at += op.retain;
  }
  return out;
}

// ---- Documents --------------------------------------------------------------------------------------------------

/** A line break inside a paragraph is kept in the stream as this character, so `"\n"` always ends a paragraph. */
const SOFT = "\u000b";
const COMMENT = "comment:";

/** The attributes the marks of a run become. A run's comment threads are one attribute each, so two people can add one at once. */
export function marksToAttrs(marks: Marks | undefined): Attrs | undefined {
  if (!marks) return undefined;
  const out: Attrs = {};
  for (const [key, value] of Object.entries(marks)) {
    if (value === undefined || value === null) continue;
    if (key === "comment") for (const id of value as string[]) out[COMMENT + id] = true;
    else out[key] = value;
  }
  return nonEmpty(out);
}

export function attrsToMarks(attrs: Attrs | undefined): Marks | undefined {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  const comments: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(COMMENT)) comments.push(key.slice(COMMENT.length));
    else out[key] = value;
  }
  if (comments.length > 0) out.comment = comments.sort();
  return Object.keys(out).length > 0 ? (out as Marks) : undefined;
}

function paragraphAttrs(p: Paragraph): Attrs | undefined {
  const { runs: _runs, ...rest } = p;
  const out: Attrs = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) out[key] = value;
  return nonEmpty(out);
}

/** The text of paragraphs as a document stream. */
export function paragraphsToDoc(paragraphs: readonly Paragraph[]): Delta {
  const out: DeltaOp[] = [];
  for (const p of paragraphs) {
    for (const run of p.runs) {
      if (run.text === "") continue;
      const attrs = marksToAttrs(run.marks);
      out.push(attrs ? { insert: run.text.replace(/\n/g, SOFT), attrs } : { insert: run.text.replace(/\n/g, SOFT) });
    }
    const attrs = paragraphAttrs(p);
    out.push(attrs ? { insert: "\n", attrs } : { insert: "\n" });
  }
  return normalizeDelta(out);
}

/** Paragraphs from a document stream. Text after the last `"\n"` is a last paragraph with no properties. */
export function docToParagraphs(doc: readonly DeltaOp[]): Paragraph[] {
  const out: Paragraph[] = [];
  let runs: Run[] = [];
  const flush = (attrs: Attrs | undefined) => {
    out.push({ ...(attrs as object), runs } as Paragraph);
    runs = [];
  };
  for (const op of doc) {
    if (!isInsert(op)) continue;
    const parts = op.insert.split("\n");
    parts.forEach((part, i) => {
      if (part !== "") {
        const marks = attrsToMarks(op.attrs);
        const text = part.replace(/\u000b/g, "\n");
        const last = runs[runs.length - 1];
        // The same marks in a row are one run, except fields (each is its own run).
        if (last && !marks?.field && sameValue(last.marks ?? {}, marks ?? {})) last.text += text;
        else runs.push(marks ? { text, marks } : { text });
      }
      if (i < parts.length - 1) flush(op.attrs);
    });
  }
  if (runs.length > 0) out.push({ runs });
  return out;
}

/** The document stream of a plain string (the speaker notes). */
export const stringToDoc = (text: string): Delta => (text === "" ? [] : [{ insert: text }]);
export const docToString = (doc: readonly DeltaOp[]): string => doc.map((op) => (isInsert(op) ? op.insert : "")).join("");

/** Splits a document into characters with their attributes, for comparing. */
function chars(doc: readonly DeltaOp[]): { c: string; attrs: Attrs | undefined }[] {
  const out: { c: string; attrs: Attrs | undefined }[] = [];
  for (const op of doc) if (isInsert(op)) for (let i = 0; i < op.insert.length; i++) out.push({ c: op.insert[i]!, attrs: op.attrs });
  return out;
}

/**
 * The delta that takes document `a` to document `b`: the text both share at the start and at the end is kept, with
 * attribute changes, and what is between is replaced. Applying it to `a` gives `b`.
 */
export function diffDocs(a: readonly DeltaOp[], b: readonly DeltaOp[]): Delta {
  // Strings are compared in UTF-16 units, as `length` counts them.
  const xs = chars(a);
  const ys = chars(b);
  let start = 0;
  const limit = Math.min(xs.length, ys.length);
  while (start < limit && xs[start]!.c === ys[start]!.c) start++;
  let end = 0;
  while (end < limit - start && xs[xs.length - 1 - end]!.c === ys[ys.length - 1 - end]!.c) end++;
  const out: DeltaOp[] = [];
  const keep = (from: number, to: number, yFrom: number) => {
    for (let i = from; i < to; i++) {
      const change = diffAttrs(xs[i]!.attrs, ys[yFrom + i - from]!.attrs);
      out.push(change ? { retain: 1, attrs: change } : { retain: 1 });
    }
  };
  keep(0, start, 0);
  const inserted = ys.slice(start, ys.length - end);
  for (const e of inserted) out.push(e.attrs ? { insert: e.c, attrs: e.attrs } : { insert: e.c });
  const removed = xs.length - end - start;
  if (removed > 0) out.push({ delete: removed });
  keep(xs.length - end, xs.length, ys.length - end);
  return normalizeDelta(out);
}
