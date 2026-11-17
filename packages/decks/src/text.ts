import type { Marks, Paragraph, Run } from "./model";

/** A point in a text body: a paragraph and a character offset into that paragraph's text. */
export interface TextPos {
  p: number;
  o: number;
}

export interface TextRange {
  from: TextPos;
  to: TextPos;
}

export type MarksPatch = { [K in keyof Marks]?: Marks[K] | null };

export const paragraphText = (p: Paragraph): string => p.runs.map((r) => r.text).join("");
export const plainText = (ps: readonly Paragraph[]): string => ps.map(paragraphText).join("\n");
export const textLength = (p: Paragraph): number => p.runs.reduce((n, r) => n + r.text.length, 0);
export const isEmptyText = (ps: readonly Paragraph[]): boolean => ps.every((p) => textLength(p) === 0);

/** Paragraphs from plain text (lines become paragraphs). */
export function paragraphsFromText(text: string, marks?: Marks, props: Partial<Paragraph> = {}): Paragraph[] {
  return text.split(/\r\n|\r|\n/).map((line) => ({
    ...props,
    runs: line === "" ? [] : [marks && Object.keys(marks).length ? { text: line, marks: { ...marks } } : { text: line }],
  }));
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function cleanMarks(marks: Marks | undefined): Marks | undefined {
  if (!marks) return undefined;
  const out: Marks = {};
  for (const [k, v] of Object.entries(marks)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export const sameMarks = (a: Marks | undefined, b: Marks | undefined): boolean => sameJson(cleanMarks(a) ?? {}, cleanMarks(b) ?? {});

/** Merges neighbouring runs with the same marks and drops empty ones. */
export function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const marks = cleanMarks(run.marks);
    const last = out[out.length - 1];
    if (last && sameMarks(last.marks, marks) && !marks?.field) last.text += run.text;
    else out.push(marks ? { text: run.text, marks } : { text: run.text });
  }
  return out;
}

/** Splits a paragraph's runs at an offset so that a run boundary falls there. Returns the index of the run starting at `offset`. */
function splitAt(runs: Run[], offset: number): number {
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const end = at + run.text.length;
    if (offset === at) return i;
    if (offset < end) {
      const cut = offset - at;
      runs.splice(i, 1, { ...run, text: run.text.slice(0, cut) }, { ...run, text: run.text.slice(cut) });
      return i + 1;
    }
    at = end;
  }
  return runs.length;
}

export function ordered(range: TextRange): TextRange {
  const { from, to } = range;
  return from.p < to.p || (from.p === to.p && from.o <= to.o) ? range : { from: to, to: from };
}

function mapRange(ps: readonly Paragraph[], range: TextRange, fn: (p: Paragraph, from: number, to: number) => Paragraph): Paragraph[] {
  const { from, to } = ordered(range);
  return ps.map((p, i) => {
    if (i < from.p || i > to.p) return p;
    const a = i === from.p ? from.o : 0;
    const b = i === to.p ? to.o : textLength(p);
    return fn(p, a, b);
  });
}

function patchMarks(base: Marks | undefined, patch: MarksPatch): Marks | undefined {
  const marks: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete marks[k];
    else marks[k] = v;
  }
  return cleanMarks(marks as Marks);
}

/** Sets or removes (with `null`) marks on a range of text. */
export function applyMarks(ps: readonly Paragraph[], range: TextRange, patch: MarksPatch): Paragraph[] {
  return mapRange(ps, range, (p, a, b) => {
    if (a >= b) return p;
    const runs = p.runs.map((r) => ({ ...r }));
    const start = splitAt(runs, a);
    const end = splitAt(runs, b);
    for (let i = start; i < end; i++) runs[i] = { text: runs[i]!.text, marks: patchMarks(runs[i]!.marks, patch) };
    return { ...p, runs: normalizeRuns(runs) };
  });
}

/** Marks all the text of a body, and the marks empty paragraphs and new text will carry. */
export function applyMarksAll(ps: readonly Paragraph[], patch: MarksPatch): Paragraph[] {
  return ps.map((p) => {
    const endMarks = patchMarks(p.endMarks, patch);
    const runs = normalizeRuns(p.runs.map((r) => ({ text: r.text, marks: patchMarks(r.marks, patch) })));
    const next: Paragraph = { ...p, runs };
    if (endMarks) next.endMarks = endMarks;
    else delete next.endMarks;
    return next;
  });
}

/** The marks that every character in the range has in common (for showing the toolbar's state). */
export function marksIn(ps: readonly Paragraph[], range: TextRange): Marks {
  const { from, to } = ordered(range);
  if (from.p === to.p && from.o === to.o) return marksAt(ps, from);
  let common: Record<string, unknown> | undefined;
  const take = (m: Marks | undefined) => {
    const c = (cleanMarks(m) ?? {}) as Record<string, unknown>;
    if (!common) {
      common = { ...c };
      return;
    }
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(common)) if (sameJson(c[k], v)) next[k] = v;
    common = next;
  };
  for (let i = from.p; i <= to.p && i < ps.length; i++) {
    const p = ps[i]!;
    const a = i === from.p ? from.o : 0;
    const b = i === to.p ? to.o : textLength(p);
    let at = 0;
    for (const run of p.runs) {
      const end = at + run.text.length;
      if (end > a && at < b) take(run.marks);
      at = end;
    }
  }
  return (common ?? {}) as Marks;
}

/** The marks that typing at this position would carry (the run before it, or the one after at the start). */
export function marksAt(ps: readonly Paragraph[], pos: TextPos): Marks {
  const p = ps[pos.p];
  if (!p) return {};
  let at = 0;
  let prev: Run | undefined;
  for (const run of p.runs) {
    const end = at + run.text.length;
    if (pos.o > at && pos.o <= end) return cleanMarks(run.marks) ?? {};
    if (pos.o <= at) return cleanMarks(prev ? prev.marks : run.marks) ?? {};
    prev = run;
    at = end;
  }
  return cleanMarks(prev?.marks ?? p.endMarks) ?? {};
}

export function sliceRuns(runs: readonly Run[], a: number, b: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    const s = Math.max(a, at);
    const e = Math.min(b, end);
    if (e > s) out.push({ ...run, text: run.text.slice(s - at, e - at) });
    at = end;
  }
  return out;
}

/** Replaces a range with text (which may contain newlines, making new paragraphs, unless `literal`). The inserted text takes the marks before it. */
export function replaceRange(ps: readonly Paragraph[], range: TextRange, text: string, marks?: Marks, options: { literal?: boolean } = {}): { paragraphs: Paragraph[]; caret: TextPos } {
  const { from, to } = ordered(range);
  const list: Paragraph[] = ps.length ? [...ps] : [{ runs: [] }];
  const first = list[from.p] ?? list[list.length - 1]!;
  const last = list[to.p] ?? first;
  const carry = marks ?? marksAt(list, from);
  const headRuns = sliceRuns(first.runs, 0, from.o);
  const tailRuns = sliceRuns(last.runs, to.o, textLength(last));
  // `literal` keeps newlines inside the run: a line break within the paragraph (Shift+Enter) rather than a new paragraph
  const lines = options.literal ? [text] : text.split(/\r\n|\r|\n/);
  const insert = (line: string): Run[] => (line === "" ? [] : [Object.keys(carry).length ? { text: line, marks: { ...carry } } : { text: line }]);
  const made: Paragraph[] = lines.map((line, i) => {
    const runs = [...(i === 0 ? headRuns : []), ...insert(line), ...(i === lines.length - 1 ? tailRuns : [])];
    // paragraphs made by splitting take the properties of the one split
    return { ...first, runs: normalizeRuns(runs) };
  });
  const out = [...list.slice(0, from.p), ...made, ...list.slice(to.p + 1)];
  const lastLine = lines[lines.length - 1]!;
  const caret: TextPos = lines.length === 1 ? { p: from.p, o: from.o + lastLine.length } : { p: from.p + lines.length - 1, o: lastLine.length };
  return { paragraphs: out, caret };
}

/** The text of a range, with newlines between paragraphs. */
export function textInRange(ps: readonly Paragraph[], range: TextRange): string {
  const { from, to } = ordered(range);
  const parts: string[] = [];
  for (let i = from.p; i <= to.p && i < ps.length; i++) {
    const t = paragraphText(ps[i]!);
    parts.push(t.slice(i === from.p ? from.o : 0, i === to.p ? to.o : t.length));
  }
  return parts.join("\n");
}

/** Sets paragraph properties on every paragraph the range touches. A `null` removes the property; for `bullet`, `null` means "no bullet". */
export function setParagraphProps(ps: readonly Paragraph[], range: TextRange, patch: { [K in Exclude<keyof Paragraph, "runs">]?: Paragraph[K] | null }): Paragraph[] {
  const { from, to } = ordered(range);
  return ps.map((p, i) => {
    if (i < from.p || i > to.p) return p;
    const next: Record<string, unknown> = { ...p };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "bullet" && v === null) next[k] = null;
      else if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    return next as unknown as Paragraph;
  });
}

/** Sets a whole body's text from a string, keeping the first paragraph's properties and first run's marks. */
export function setPlainText(ps: readonly Paragraph[], text: string): Paragraph[] {
  const first = ps[0];
  const marks = first?.runs[0]?.marks ?? first?.endMarks;
  const lines = paragraphsFromText(text, marks);
  return lines.map((p, i) => {
    const src = ps[i] ?? ps[ps.length - 1];
    const { runs: _runs, ...props } = src ?? ({ runs: [] } as Paragraph);
    return { ...props, ...p };
  });
}
