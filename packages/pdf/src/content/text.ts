/**
 * Reading a page: runs of text with the box of every glyph, lines in reading order, pictures, and search.
 *
 * How text is put together (honest list of what it does and does not do):
 * - A "piece" is the glyphs of one show operator (`Tj`, `TJ`, `'`, `"`), cut where a `TJ` jumps by more than two ems
 *   or backwards. Pieces on the same baseline with the same font, size, colour and direction, less than two ems
 *   apart, form a run: the unit that text editing replaces.
 * - A space is added where the gap between two glyphs is wider than a quarter em and neither side is a space.
 * - Lines are runs with the same baseline (within 0.4 em); lines are sorted top to bottom, runs left to right. Text
 *   turned by a multiple of 90 degrees is read in its own direction, after the upright text. Columns are NOT
 *   detected: two columns side by side come out as alternating halves of lines. Right-to-left and vertical text are
 *   read in drawing order, not logical order.
 * - Hyphenation and ligatures: a hyphen at the end of a line stays; fi/fl ligature characters become `fi`/`fl`.
 */
import type { PdfDict } from "../cos/objects";
import { isArray, isName } from "../cos/objects";
import type { Rect } from "../model";
import { streamFilters } from "../cos/filters";
import type { ContentSource } from "./fontinfo";
import { Interpreter, opKey, unionRect, type ImagePlacement, type ShowOp } from "./interpreter";
import { pageOps, type PageGeom } from "./page";

export interface TextGlyph {
  char: string;
  box: Rect;
  /** A space that is not in the file: put in because of a gap. */
  virtual?: boolean;
}

export interface TextRun {
  /** `r:<page>:<operator>:<n>`: the same for the same bytes. */
  id: string;
  text: string;
  box: Rect;
  font: { name: string; /** The family without style words: `Arial` for `ArialMT` and `Arial-BoldMT`. */ family: string; size: number; bold?: boolean; italic?: boolean };
  /** `#rrggbb` of the fill, when it is a plain colour. */
  color?: string;
  glyphs: TextGlyph[];
  /** Where the first glyph starts, on its baseline, in page space. */
  origin: [number, number];
  /** Degrees clockwise on the page (0: left to right). */
  angle: number;
  vertical?: boolean;
  /** Whether `replaceText` can change it faithfully. */
  editable: boolean;
  reason?: string;
  /** Index of its line in `PageText.lines`. */
  line: number;
}

export interface TextLine {
  text: string;
  box: Rect;
  /** Ids of its runs, left to right. */
  runs: string[];
  /** For each run: whether there is a gap before it wide enough to be a space (the first run: false). */
  gaps: boolean[];
}

export interface PageImage {
  /** `i:Im0`, `i:inline1`... the same for the same bytes. */
  id: string;
  box: Rect;
  name: string;
  inline: boolean;
  /** Pixels. */
  width: number;
  height: number;
  filter?: string;
  colorSpace?: string;
  /** `Form1/Im0` when it sits inside a form. */
  form?: string;
}

export interface PageText {
  /** 0-based page index in its file. */
  page: number;
  /** The page's id, when read through a session. */
  pageId?: string;
  width: number;
  height: number;
  /** The text of the page, lines joined with a newline. */
  text: string;
  lines: TextLine[];
  runs: TextRun[];
  images: PageImage[];
}

/** A run before its text is cut: pieces of show operators. */
export interface Piece {
  op: ShowOp;
  /** Index of the piece in its operator (0 unless a `TJ` was cut). */
  n: number;
  from: number;
  to: number;
}

export interface RawRun {
  id: string;
  pieces: Piece[];
}

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
const normalize = (s: string): string => s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c]!);
const isSpace = (s: string): boolean => s === "" || /^\s+$/.test(s);

const dot = (a: readonly [number, number], b: readonly [number, number]): number => a[0] * b[0] + a[1] * b[1];

/** Cuts show operators into pieces: where a `TJ` moves on by more than two ems, or backwards by more than an em. */
export function pieces(shows: readonly ShowOp[]): Piece[] {
  const out: Piece[] = [];
  for (const op of shows) {
    if (op.glyphs.length === 0) continue;
    let from = 0;
    let n = 0;
    for (let i = 1; i <= op.glyphs.length; i++) {
      let cut = i === op.glyphs.length;
      if (!cut && !op.vertical) {
        const prev = op.glyphs[i - 1]!;
        const next = op.glyphs[i]!;
        const gap = dot([next.origin[0] - prev.end_[0], next.origin[1] - prev.end_[1]], op.dir);
        cut = gap > 2 * op.em || gap < -1 * op.em;
      }
      if (cut) {
        out.push({ op, n: n++, from, to: i });
        from = i;
      }
    }
  }
  return out;
}

function sameStyle(a: ShowOp, b: ShowOp): boolean {
  if (a.stream !== b.stream) return false;
  if (a.font !== b.font) return false;
  if (Math.abs(a.em - b.em) > 0.03 * Math.max(a.em, b.em)) return false;
  if (dot(a.dir, b.dir) < 0.999) return false;
  if (a.vertical !== b.vertical) return false;
  if ((a.render === 3) !== (b.render === 3)) return false;
  if (a.fill.css !== b.fill.css) return false;
  return true;
}

/** Groups pieces (in content order) into runs. */
export function groupRuns(all: readonly Piece[], pageIndex: number): RawRun[] {
  const runs: RawRun[] = [];
  let cur: RawRun | null = null;
  for (const p of all) {
    if (cur) {
      const last = cur.pieces[cur.pieces.length - 1]!;
      const lastGlyph = last.op.glyphs[last.to - 1]!;
      const first = p.op.glyphs[p.from]!;
      const op = p.op;
      let merge = !op.vertical && sameStyle(last.op, op);
      if (merge) {
        const d: [number, number] = [first.origin[0] - lastGlyph.end_[0], first.origin[1] - lastGlyph.end_[1]];
        const along = dot(d, op.dir);
        const across = Math.abs(d[0] * -op.dir[1] + d[1] * op.dir[0]);
        merge = across < 0.25 * op.em && along > -0.8 * op.em && along < 2 * op.em;
      }
      if (merge) {
        cur.pieces.push(p);
        continue;
      }
    }
    cur = { id: `r:${pageIndex}:${opKey(p.op.stream, p.op.local)}:${p.n}`, pieces: [p] };
    runs.push(cur);
  }
  return runs;
}

function whyNotEditable(raw: RawRun, text: string): string | undefined {
  const op = raw.pieces[0]!.op;
  if (op.render === 3) return "This text is invisible (a text layer from scanning): editing it would not change what is seen.";
  if (op.font.type3) return "This text uses a Type 3 font (glyphs drawn by small programs): it cannot be edited faithfully.";
  if (op.vertical) return "Vertical writing is not editable.";
  if (!text.trim()) return "This run holds only spaces.";
  if (/^\ufffd+$/.test(text.replace(/\s/g, ""))) return "The font gives no way to read this text.";
  return undefined;
}

/** The glyphs and text of a raw run. */
export function buildRun(raw: RawRun, lineIndex = 0): TextRun {
  const glyphs: TextGlyph[] = [];
  let prev: { op: ShowOp; g: ShowOp["glyphs"][number] } | null = null;
  const first = raw.pieces[0]!.op;
  for (const piece of raw.pieces) {
    for (let i = piece.from; i < piece.to; i++) {
      const g = piece.op.glyphs[i]!;
      const char = normalize(g.unicode);
      if (prev && !piece.op.vertical) {
        // letter spacing (`Tc`) is tracking, not a word break
        const tracking = prev.op === piece.op ? piece.op.tc * piece.op.th * (piece.op.em / (Math.abs(piece.op.size) || 1)) : 0;
        const gap = dot([g.origin[0] - prev.g.end_[0], g.origin[1] - prev.g.end_[1]], piece.op.dir) - tracking;
        const lastChar = glyphs[glyphs.length - 1]?.char ?? "";
        if (gap > 0.25 * piece.op.em && !isSpace(lastChar) && !isSpace(char)) {
          const a = prev.g.end_;
          const b = g.origin;
          const half = Math.max(prev.g.box.h, g.box.h) / 2;
          const cy = (a[1] + b[1]) / 2;
          glyphs.push({ char: " ", box: { x: Math.min(a[0], b[0]), y: cy - half, w: Math.abs(b[0] - a[0]), h: half * 2 }, virtual: true });
        }
      }
      glyphs.push({ char, box: g.box });
      prev = { op: piece.op, g };
    }
  }
  const real = glyphs.filter((g) => !g.virtual);
  let box = real[0]?.box ?? { x: 0, y: 0, w: 0, h: 0 };
  for (const g of real) box = unionRect(box, g.box);
  const text = glyphs.map((g) => g.char).join("");
  const firstGlyph = first.glyphs[raw.pieces[0]!.from]!;
  const reason = whyNotEditable(raw, text);
  const angle = (Math.atan2(first.dir[1], first.dir[0]) * 180) / Math.PI;
  return {
    id: raw.id,
    text,
    box,
    font: { name: first.font.baseFont.replace(/^[A-Z]{6}\+/, ""), family: first.font.name.family, size: round(first.em), ...(first.font.name.bold ? { bold: true } : {}), ...(first.font.name.italic ? { italic: true } : {}) },
    ...(first.fill.css ? { color: first.fill.css } : {}),
    glyphs,
    origin: firstGlyph.origin,
    angle: round(angle),
    ...(first.vertical ? { vertical: true } : {}),
    editable: reason === undefined,
    ...(reason ? { reason } : {}),
    line: lineIndex,
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Puts runs into lines and reading order. Mutates `run.line`. */
export function makeLines(runs: TextRun[], raws: RawRun[]): TextLine[] {
  interface Entry {
    run: TextRun;
    raw: RawRun;
    cls: number;
    along: number;
    across: number;
    em: number;
  }
  const entries: Entry[] = runs.map((run, i) => {
    const raw = raws[i]!;
    const op = raw.pieces[0]!.op;
    const u = op.dir;
    const normal: [number, number] = [-u[1], u[0]];
    const cls = ((Math.round(run.angle / 90) % 4) + 4) % 4;
    return { run, raw, cls, along: dot(run.origin, u), across: dot(run.origin, normal), em: op.em };
  });
  entries.sort((a, b) => a.cls - b.cls || a.across - b.across || a.along - b.along);
  const lines: { cls: number; across: number; em: number; entries: Entry[] }[] = [];
  for (const e of entries) {
    const line = lines.find((l) => l.cls === e.cls && Math.abs(l.across - e.across) < 0.4 * Math.min(l.em, e.em));
    if (line) line.entries.push(e);
    else lines.push({ cls: e.cls, across: e.across, em: e.em, entries: [e] });
  }
  const out: TextLine[] = [];
  lines.sort((a, b) => a.cls - b.cls || a.across - b.across);
  for (const line of lines) {
    line.entries.sort((a, b) => a.along - b.along);
    let text = "";
    let box: Rect | null = null;
    let prev: Entry | null = null;
    const gaps: boolean[] = [];
    for (const e of line.entries) {
      e.run.line = out.length;
      let wide = false;
      if (prev) {
        const gap = e.along - (prev.along + runLength(prev));
        wide = gap > 0.25 * e.em;
        if (wide && !text.endsWith(" ") && !e.run.text.startsWith(" ")) text += " ";
      }
      gaps.push(wide);
      text += e.run.text;
      box = box ? unionRect(box, e.run.box) : e.run.box;
      prev = e;
    }
    out.push({ text, box: box!, runs: line.entries.map((e) => e.run.id), gaps });
  }
  return out;
}

function runLength(e: { raw: RawRun }): number {
  const last = e.raw.pieces[e.raw.pieces.length - 1]!;
  const g = last.op.glyphs[last.to - 1]!;
  const first = e.raw.pieces[0]!.op.glyphs[e.raw.pieces[0]!.from]!;
  return dot([g.end_[0] - first.origin[0], g.end_[1] - first.origin[1]], last.op.dir);
}

function filterName(src: ContentSource, dict: PdfDict): string | undefined {
  const { names } = streamFilters(dict, (o) => src.get(o));
  return names[names.length - 1];
}

function csName(src: ContentSource, dict: PdfDict): string | undefined {
  const cs = src.get(dict.get("ColorSpace") ?? dict.get("CS"));
  if (isName(cs)) return cs.value;
  if (isArray(cs) && isName(src.get(cs[0]))) return (src.get(cs[0]) as { value: string }).value;
  if (src.get(dict.get("ImageMask") ?? dict.get("IM")) === true) return "ImageMask";
  return undefined;
}

export function pageImage(src: ContentSource, img: ImagePlacement): PageImage {
  const filter = filterName(src, img.dict);
  const cs = csName(src, img.dict);
  return {
    id: img.id,
    box: img.box,
    name: img.name,
    inline: img.inline,
    width: img.width,
    height: img.height,
    ...(filter ? { filter } : {}),
    ...(cs ? { colorSpace: cs } : {}),
    ...(img.stream ? { form: img.stream } : {}),
  };
}

/** Everything the interpreter can say about a page without changing it. */
export interface PageAnalysis {
  text: PageText;
  raws: RawRun[];
  interpreter: Interpreter;
  shows: ShowOp[];
  placements: ImagePlacement[];
}

export function analyzePage(src: ContentSource, geom: PageGeom, pageIndex: number): PageAnalysis {
  const ops = pageOps(src, geom);
  const interp = new Interpreter(src, geom.base, undefined, { width: geom.width, height: geom.height });
  interp.runPage(ops, geom.resources);
  const raws = groupRuns(pieces(interp.shows), pageIndex);
  const runs = raws.map((r) => buildRun(r));
  const lines = makeLines(runs, raws);
  // Reading order for the runs list too: by line, then position in line.
  const order = new Map<string, number>();
  lines.forEach((l, li) => l.runs.forEach((id, ri) => order.set(id, li * 10000 + ri)));
  const sorted = [...runs].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const images = interp.images.map((i) => pageImage(src, i));
  return {
    text: { page: pageIndex, width: geom.width, height: geom.height, text: lines.map((l) => l.text).join("\n"), lines, runs: sorted, images },
    raws,
    interpreter: interp,
    shows: interp.shows,
    placements: interp.images,
  };
}

// ---- search ---------------------------------------------------------------------------------------------------------

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Treat the query as a regular expression (JavaScript syntax). Otherwise it is plain text: runs of spaces match any white space, line breaks too. */
  regex?: boolean;
  /** Only these pages (0-based). */
  pages?: readonly number[];
}

export interface SearchHit {
  /** 0-based page index in its file. */
  page: number;
  /** The page id, when searching a session. */
  pageId?: string;
  /** One rectangle per line the match covers, in page space. */
  rects: Rect[];
  /** The matched text (a line break inside a match is a newline). */
  text: string;
}

interface Flat {
  text: string;
  /** For each UTF-16 unit of `text`: the glyph box and line it comes from, or null for inserted separators. */
  at: ({ box: Rect; line: number } | null)[];
}

function flatten(page: PageText): Flat {
  const byId = new Map(page.runs.map((r) => [r.id, r]));
  let text = "";
  const at: Flat["at"] = [];
  page.lines.forEach((line, li) => {
    if (li > 0) {
      text += "\n";
      at.push(null);
    }
    line.runs.forEach((id, ri) => {
      const run = byId.get(id)!;
      if (ri > 0 && !text.endsWith(" ") && !run.text.startsWith(" ") && line.gaps[ri]) {
        text += " ";
        at.push(null);
      }
      for (const g of run.glyphs) {
        for (let i = 0; i < g.char.length; i++) {
          text += g.char[i];
          at.push(g.virtual ? null : { box: g.box, line: li });
        }
      }
    });
  });
  return { text, at };
}

export function buildMatcher(query: string, options: SearchOptions): RegExp | null {
  if (query === "") return null;
  let source: string;
  if (options.regex) source = query;
  else source = query.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  return new RegExp(source, `gu${options.caseSensitive ? "" : "i"}`);
}

/** Matches in one page's text. */
export function searchPage(page: PageText, query: string, options: SearchOptions = {}): SearchHit[] {
  const re = buildMatcher(query, options);
  if (!re) return [];
  const flat = flatten(page);
  const hits: SearchHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat.text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = m.index + m[0].length;
    const byLine = new Map<number, Rect>();
    for (let i = start; i < end; i++) {
      const a = flat.at[i];
      if (!a) continue;
      const have = byLine.get(a.line);
      byLine.set(a.line, have ? unionRect(have, a.box) : a.box);
    }
    if (byLine.size) hits.push({ page: page.page, rects: [...byLine.values()], text: m[0] });
  }
  return hits;
}

export interface PageWord {
  text: string;
  box: Rect;
  /** Index of its line. */
  line: number;
  /** Degrees clockwise (0: left to right). */
  angle: number;
}

/** The words of a page (runs of characters between spaces) with their boxes, in reading order. */
export function pageWords(page: PageText): PageWord[] {
  const byId = new Map(page.runs.map((r) => [r.id, r]));
  const words: PageWord[] = [];
  page.lines.forEach((line, li) => {
    let text = "";
    let box: Rect | null = null;
    let angle = 0;
    const flush = () => {
      if (text) words.push({ text, box: box!, line: li, angle });
      text = "";
      box = null;
    };
    for (const [ri, id] of line.runs.entries()) {
      const run = byId.get(id)!;
      if (line.gaps[ri]) flush();
      angle = run.angle;
      for (const g of run.glyphs) {
        if (/^\s*$/.test(g.char)) {
          flush();
          continue;
        }
        text += g.char;
        box = box ? unionRect(box, g.box) : g.box;
      }
    }
    flush();
  });
  return words;
}
