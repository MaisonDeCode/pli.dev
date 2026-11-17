import {
  marksAt,
  ordered,
  paragraphText,
  replaceRange,
  setParagraphProps,
  textLength,
  type Align,
  type Marks,
  type Paragraph,
  type ResolvedParagraph,
  type ResolvedText,
  type TextPos,
  type TextRange,
} from "@pli.dev/decks";

export const LINE_BREAK = "\n";

export const isCollapsed = (r: TextRange): boolean => r.from.p === r.to.p && r.from.o === r.to.o;
export const caretAt = (pos: TextPos): TextRange => ({ from: pos, to: { ...pos } });

export function endOf(ps: readonly Paragraph[]): TextPos {
  const p = Math.max(0, ps.length - 1);
  return { p, o: ps[p] ? textLength(ps[p]!) : 0 };
}

export const wholeRange = (ps: readonly Paragraph[]): TextRange => ({ from: { p: 0, o: 0 }, to: endOf(ps) });

/** Keeps a range inside the text. */
export function clampRange(ps: readonly Paragraph[], r: TextRange): TextRange {
  const fix = (pos: TextPos): TextPos => {
    const p = Math.min(Math.max(0, pos.p), Math.max(0, ps.length - 1));
    return { p, o: Math.min(Math.max(0, pos.o), ps[p] ? textLength(ps[p]!) : 0) };
  };
  return { from: fix(r.from), to: fix(r.to) };
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The offset of the character boundary before (`dir` -1) or after (+1) `offset`, treating an emoji or accented letter as one. */
export function stepOffset(text: string, offset: number, dir: -1 | 1): number {
  if (dir < 0 && offset <= 0) return 0;
  if (dir > 0 && offset >= text.length) return text.length;
  if (segmenter) {
    let prev = 0;
    for (const seg of segmenter.segment(text)) {
      const end = seg.index + seg.segment.length;
      if (dir < 0 && end >= offset) return seg.index < offset ? seg.index : prev;
      if (dir > 0 && seg.index >= offset) return end;
      if (dir > 0 && seg.index < offset && end > offset) return end;
      prev = seg.index;
    }
    return dir < 0 ? 0 : text.length;
  }
  const at = offset + dir;
  const code = text.charCodeAt(dir < 0 ? at : at - 1);
  if (dir < 0 && code >= 0xdc00 && code <= 0xdfff && at > 0) return at - 1;
  if (dir > 0 && code >= 0xd800 && code <= 0xdbff && at < text.length) return at + 1;
  return at;
}

export type DeleteUnit = "char" | "word" | "line";

export interface ListInfo {
  /** Whether the paragraph is a list item (it has a bullet or a number, or is indented). */
  listed: boolean;
  level: number;
}

export interface EditResult {
  paragraphs: Paragraph[];
  caret: TextPos;
}

/** What Backspace and Delete do. Backspace at the start of a list item first takes it out of the list. */
export function deleteContent(ps: readonly Paragraph[], range: TextRange, dir: -1 | 1, unit: DeleteUnit, list?: (p: number) => ListInfo): EditResult | null {
  const r = ordered(range);
  if (!isCollapsed(r)) return replaceRange(ps, r, "");
  const { p, o } = r.from;
  const para = ps[p];
  if (!para) return null;
  const text = paragraphText(para);
  if (dir < 0) {
    if (o === 0) {
      const info = list?.(p);
      if (info?.listed) return { paragraphs: unlist(ps, p, info), caret: { p, o: 0 } };
      if (p === 0) return null;
      const prevLen = textLength(ps[p - 1]!);
      return { paragraphs: replaceRange(ps, { from: { p: p - 1, o: prevLen }, to: { p, o: 0 } }, "").paragraphs, caret: { p: p - 1, o: prevLen } };
    }
    let start = stepOffset(text, o, -1);
    if (unit === "word") start = (text.slice(0, o).search(/\S+\s*$|\s+$/) >>> 0) || 0;
    if (unit === "line") start = 0;
    return replaceRange(ps, { from: { p, o: start }, to: { p, o } }, "");
  }
  if (o >= text.length) {
    if (p >= ps.length - 1) return null;
    return { paragraphs: replaceRange(ps, { from: { p, o }, to: { p: p + 1, o: 0 } }, "").paragraphs, caret: { p, o } };
  }
  let end = stepOffset(text, o, 1);
  if (unit === "word") {
    const m = /^\s*\S+|^\s+/.exec(text.slice(o));
    end = o + (m ? m[0].length : 1);
  }
  if (unit === "line") end = text.length;
  return replaceRange(ps, { from: { p, o }, to: { p, o: end } }, "");
}

/** Takes a list item out of its list: one level up, or (at the top) no bullet and no indent. */
function unlist(ps: readonly Paragraph[], p: number, info: ListInfo): Paragraph[] {
  const caret = caretAt({ p, o: 0 });
  if (info.level > 0) return changeIndent(ps, caret, -1, () => ({ level: info.level, marL: undefined }));
  return setParagraphProps(ps, caret, { bullet: null, marL: 0, indent: 0, level: null });
}

/** What Enter does: a new paragraph; on an empty list item it ends the list instead. */
export function pressEnter(ps: readonly Paragraph[], range: TextRange, list?: (p: number) => ListInfo, marks?: Marks): EditResult {
  const r = ordered(range);
  const info = list?.(r.from.p);
  const para = ps[r.from.p];
  if (isCollapsed(r) && para && textLength(para) === 0 && info?.listed) return { paragraphs: unlist(ps, r.from.p, info), caret: r.from };
  const out = replaceRange(ps, r, "\n", marks);
  // a new paragraph carries the same marks as the end of the one split, even when it is empty
  const next = out.paragraphs[out.caret.p];
  if (next && textLength(next) === 0) {
    const carry = marks ?? marksAt(ps, r.from);
    if (Object.keys(carry).length) out.paragraphs[out.caret.p] = { ...next, endMarks: carry };
  }
  return out;
}

export interface IndentInfo {
  level: number;
  marL?: number;
}

/** Indents (`delta` 1) or outdents (-1) the paragraphs the range touches. */
export function changeIndent(ps: readonly Paragraph[], range: TextRange, delta: number, resolved: (p: number) => IndentInfo): Paragraph[] {
  const { from, to } = ordered(range);
  const out = [...ps];
  for (let i = from.p; i <= to.p && i < out.length; i++) {
    const info = resolved(i);
    const level = Math.min(8, Math.max(0, info.level + delta));
    const marL = Math.max(0, (info.marL ?? 0) + delta * 18);
    out[i] = { ...out[i]!, level, ...(info.marL === undefined ? {} : { marL }) };
    if (level === 0) delete out[i]!.level;
  }
  return out;
}

export type BulletKind = "bullet" | "number";

/** Turns a bulleted or numbered list on or off for the paragraphs a range touches. */
export function toggleList(ps: readonly Paragraph[], range: TextRange, kind: BulletKind, current: (p: number) => ResolvedParagraph | undefined): Paragraph[] {
  const { from, to } = ordered(range);
  let all = true;
  for (let i = from.p; i <= to.p && i < ps.length; i++) {
    const b = current(i)?.bullet;
    const has = kind === "bullet" ? !!b && !/^\d|^[a-zA-Z]+[.)]$/.test(b.label) : !!b && /^\d+[.)]$|^[a-zA-Z]+[.)]$/.test(b.label);
    if (!has) all = false;
  }
  if (all) return setParagraphProps(ps, range, { bullet: null, marL: 0, indent: 0 });
  const out = [...ps];
  for (let i = from.p; i <= to.p && i < out.length; i++) {
    const cur = current(i);
    const level = cur?.level ?? 0;
    const marL = cur && cur.marL > 0 ? cur.marL : 18 * (level + 1);
    const indent = cur && cur.indent < 0 ? cur.indent : -18;
    out[i] = { ...out[i]!, bullet: kind === "bullet" ? { type: "char", char: "●", size: 100 } : { type: "number", scheme: "arabicPeriod" }, marL, indent };
  }
  return out;
}

// ---- What the toolbar shows ----------------------------------------------------------------------------------------

export interface TextFormat {
  fontFamily?: string;
  fontSize?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  highlight?: string;
  link?: string;
  baseline: number;
  align?: Align;
  bullet: "none" | "bullet" | "number" | "mixed";
  lineSpacing?: number;
  level: number;
  vAlign?: "top" | "middle" | "bottom";
}

const same = <T>(values: T[]): T | undefined => (values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined);

/** The formatting of the text in a range, read from the resolved text so that inherited styling shows too. */
export function formatOf(raw: readonly Paragraph[], text: ResolvedText | undefined, range: TextRange): TextFormat {
  const { from, to } = ordered(range);
  const found: import("@pli.dev/decks").ResolvedRun[] = [];
  const paras: ResolvedParagraph[] = [];
  if (text) {
    for (let pi = from.p; pi <= to.p && pi < raw.length; pi++) {
      const rp = text.paragraphs[pi];
      if (!rp) continue;
      paras.push(rp);
      const a = pi === from.p ? from.o : 0;
      const b = pi === to.p ? to.o : textLength(raw[pi]!);
      let at = 0;
      let before: import("@pli.dev/decks").ResolvedRun | undefined;
      let any = false;
      raw[pi]!.runs.forEach((run, ri) => {
        const end = at + run.text.length;
        const rr = rp.runs[ri];
        if (rr) {
          if (a === b) {
            // caret: the run it sits in or just after
            if (a > at && a <= end) {
              found.push(rr);
              any = true;
            } else if (a === 0 && at === 0 && !any) {
              before = rr;
            }
          } else if (end > a && at < b) {
            found.push(rr);
            any = true;
          }
        }
        at = end;
      });
      if (!any && before) found.push(before);
      if (!any && !before && rp.runs[0]) found.push(rp.runs[0]);
    }
  }
  const bulletKinds = paras.map((p) => (!p.bullet ? "none" : /^\d+[.)]$|^[a-zA-Z]+[.)]$/.test(p.bullet.label) ? "number" : "bullet"));
  const kind = same(bulletKinds);
  return {
    fontFamily: same(found.map((r) => r.fontFamily)),
    fontSize: same(found.map((r) => r.fontSize)) ?? (found.length === 0 ? paras[0]?.endSize : undefined),
    bold: found.length > 0 && found.every((r) => r.bold),
    italic: found.length > 0 && found.every((r) => r.italic),
    underline: found.length > 0 && found.every((r) => r.underline),
    strike: found.length > 0 && found.every((r) => r.strike),
    color: same(found.map((r) => r.color)),
    highlight: same(found.map((r) => r.highlight)),
    link: same(found.map((r) => r.link)),
    baseline: same(found.map((r) => r.baseline)) ?? 0,
    align: same(paras.map((p) => p.align)),
    bullet: kind ?? (paras.length ? "mixed" : "none"),
    lineSpacing: same(paras.map((p) => p.lineSpacing)),
    level: paras[0]?.level ?? 0,
    vAlign: text?.vAlign,
  };
}
