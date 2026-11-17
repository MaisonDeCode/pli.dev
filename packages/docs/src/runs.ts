import { PliError } from "@pli.dev/core";
import type { MarkPatch, Marks, Run } from "./model";

export function plainText(runs: readonly Run[]): string {
  let out = "";
  for (const run of runs) out += run.text;
  return out;
}

export function textLength(runs: readonly Run[]): number {
  let n = 0;
  for (const run of runs) n += run.text.length;
  return n;
}

export function marksEqual(a: Marks | undefined, b: Marks | undefined): boolean {
  const ka = a ? (Object.keys(a) as (keyof Marks)[]) : [];
  const kb = b ? (Object.keys(b) as (keyof Marks)[]) : [];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a![k];
    const y = b?.[k];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => v === y[i]);
    // A suggestion is a small object: equal when it says the same.
    if (x && y && typeof x === "object" && typeof y === "object") return JSON.stringify(x) === JSON.stringify(y);
    return x === y;
  });
}

/** The marks on the character at `index`, or undefined if it is unmarked or out of range. */
export function marksAt(runs: readonly Run[], index: number): Marks | undefined {
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (index >= pos && index < end) return run.marks;
    pos = end;
  }
  return undefined;
}

/** True when every character in [from, to) has the boolean mark set. Empty ranges are false. */
export function rangeHasMark(
  runs: readonly Run[],
  from: number,
  to: number,
  key: "bold" | "italic" | "underline" | "strike" | "code" | "superscript" | "subscript",
): boolean {
  if (to <= from) return false;
  return sliceRuns(runs, from, to).every((run) => run.marks?.[key] === true);
}

/** Drops empty runs, merges neighbours with equal marks, and strips empty mark objects. */
export function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const marks = run.marks && Object.keys(run.marks).length > 0 ? run.marks : undefined;
    const last = out[out.length - 1];
    if (last && marksEqual(last.marks, marks)) {
      last.text += run.text;
    } else {
      out.push(marks ? { text: run.text, marks: { ...marks } } : { text: run.text });
    }
  }
  return out;
}

export function checkRange(runs: readonly Run[], from: number, to: number): void {
  const len = textLength(runs);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > len) {
    throw new PliError("out_of_range", `Range ${from}-${to} is outside text of length ${len}`);
  }
}

/** Returns the runs covering [from, to). */
export function sliceRuns(runs: readonly Run[], from: number, to: number): Run[] {
  checkRange(runs, from, to);
  const out: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const start = pos;
    const end = pos + run.text.length;
    pos = end;
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (a < b) out.push({ text: run.text.slice(a - start, b - start), marks: run.marks });
  }
  return normalizeRuns(out);
}

export function insertRuns(runs: readonly Run[], offset: number, inserted: readonly Run[]): Run[] {
  checkRange(runs, offset, offset);
  return normalizeRuns([
    ...sliceRuns(runs, 0, offset),
    ...inserted,
    ...sliceRuns(runs, offset, textLength(runs)),
  ]);
}

export function deleteRange(runs: readonly Run[], from: number, to: number): Run[] {
  checkRange(runs, from, to);
  return normalizeRuns([
    ...sliceRuns(runs, 0, from),
    ...sliceRuns(runs, to, textLength(runs)),
  ]);
}

export function applyMarkPatch(marks: Marks | undefined, patch: MarkPatch): Marks | undefined {
  const next: Record<string, unknown> = { ...marks };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === false || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as Marks;
}

export function formatRange(
  runs: readonly Run[],
  from: number,
  to: number,
  patch: MarkPatch,
): Run[] {
  checkRange(runs, from, to);
  const len = textLength(runs);
  const middle = sliceRuns(runs, from, to).map((run) => ({
    text: run.text,
    marks: applyMarkPatch(run.marks, patch),
  }));
  return normalizeRuns([
    ...sliceRuns(runs, 0, from),
    ...middle,
    ...sliceRuns(runs, to, len),
  ]);
}

/** The marks of one stretch of text, for putting them back exactly. */
export interface MarkSegment {
  length: number;
  marks?: Marks;
}

/** Marks without the thread ids: those belong to comments (see `comment_text`), and formatting never touches them. */
function withoutComment(marks: Marks | undefined): Marks | undefined {
  if (!marks || !marks.comment) return marks;
  const { comment: _comment, ...rest } = marks;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** The marks across [from, to), one segment per run. Comment threads are not part of them. */
export function marksSegments(runs: readonly Run[], from: number, to: number): MarkSegment[] {
  const out: MarkSegment[] = [];
  for (const run of sliceRuns(runs, from, to)) {
    const marks = withoutComment(run.marks);
    const last = out[out.length - 1];
    // Runs that differ only by their comments have the same marks here.
    if (last && marksEqual(last.marks, marks)) last.length += run.text.length;
    else out.push(marks ? { length: run.text.length, marks } : { length: run.text.length });
  }
  return out;
}

/**
 * Sets the marks across [from, to) to exactly `segments`, leaving the text as it is, and the comments attached
 * to it. The segments must add up to the length of the range. The opposite of `formatRange` where that changes
 * marks by a patch.
 */
export function restoreMarks(runs: readonly Run[], from: number, to: number, segments: readonly MarkSegment[]): Run[] {
  checkRange(runs, from, to);
  const total = segments.reduce((n, s) => n + s.length, 0);
  if (total !== to - from) throw new PliError("invalid_operation", `Mark segments cover ${total} characters, not ${to - from}`);
  const existing = sliceRuns(runs, from, to);
  const text = plainText(existing);
  // Walk both lists at once, cutting wherever either changes.
  const ends = (lengths: number[]) => lengths.reduce<number[]>((all, n) => [...all, (all[all.length - 1] ?? 0) + n], []);
  const segmentEnds = ends(segments.map((s) => s.length));
  const runEnds = ends(existing.map((r) => r.text.length));
  const middle: Run[] = [];
  let pos = 0;
  let si = 0;
  let ri = 0;
  while (pos < total) {
    while (segmentEnds[si]! <= pos) si++;
    while (runEnds[ri]! <= pos) ri++;
    const next = Math.min(segmentEnds[si]!, runEnds[ri]!);
    const marks = { ...withoutComment(segments[si]!.marks), ...(existing[ri]!.marks?.comment ? { comment: existing[ri]!.marks!.comment } : {}) };
    middle.push({ text: text.slice(pos, next), marks: Object.keys(marks).length > 0 ? marks : undefined });
    pos = next;
  }
  return normalizeRuns([...sliceRuns(runs, 0, from), ...middle, ...sliceRuns(runs, to, textLength(runs))]);
}
