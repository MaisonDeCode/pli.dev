import { isMonospace, lookupFont, widthFactor } from "@pli.dev/core";
import { parseTrueType, type TrueTypeFont } from "@pli.dev/docs";
import type { ResolvedBullet, ResolvedParagraph, ResolvedRun, ResolvedText } from "./resolve";
import { HELVETICA, HELVETICA_BOLD } from "./widths";

/*
 * Text layout without a browser: line breaking, indents, bullets, alignment, spacing, anchoring and autofit, from a
 * resolved text body. Pure and deterministic. Widths come from a `TextMeasurer` (the default estimates them from
 * Helvetica's metrics, scaled per font family); give the real one (a canvas, a font file) for exact lines.
 *
 * Coordinates are in points from the top left corner of the shape's box (so they include the insets). `y` of a line is
 * its baseline. Line height is `fontSize * 1.2 * lineSpacing` of the largest text on the line. Right-to-left text is
 * laid out left to right (not reordered).
 */

/** The text of a run's style a width depends on. The text passed in has capitals already applied (and the flags are then false). */
export type TextMeasurer = (text: string, run: Pick<ResolvedRun, "fontFamily" | "fontSize" | "bold" | "italic" | "letterSpacing" | "allCaps" | "smallCaps">) => number;

export interface LaidSegment {
  /** What is drawn (capitals applied for `allCaps`, `smallCaps`). */
  text: string;
  x: number;
  width: number;
  /** The run it came from (its `fontSize` is the unscaled size; use `fontSize` here). */
  run: ResolvedRun;
  /** The size it is drawn at: scaled by autofit, smaller for superscript, subscript and the small capitals of `smallCaps`. */
  fontSize: number;
  /** How far the text is moved down from the line's baseline (negative raises it). */
  dy: number;
}

export interface LaidBullet {
  label: string;
  x: number;
  width: number;
  /** The bullet's own look, as a run with the bullet's colour, size and font. */
  run: ResolvedRun;
  fontSize: number;
}

export interface LaidLine {
  /** Index of the paragraph in the text body. */
  paragraph: number;
  /** Left edge of the line's first segment. */
  x: number;
  /** Baseline. */
  y: number;
  /** Top of the line box. */
  top: number;
  /** Width of the text on the line (no trailing spaces). */
  width: number;
  /** Height of the line box. */
  height: number;
  segments: LaidSegment[];
  bullet?: LaidBullet;
}

export interface TextLayout {
  lines: LaidLine[];
  /** Height of all the lines with paragraph spacing, without the insets. */
  contentHeight: number;
  /** The font scale autofit chose (1 without it). */
  scale: number;
  /** How much autofit shrank the line spacing (0..0.2). */
  lineSpacingReduction: number;
  /** The text doesn't fit the box (after any shrinking). Never for `resize`. */
  overflow: boolean;
  /** Height the box needs to hold the text, insets included (what `resize` grows it to). */
  neededHeight: number;
}

// ---- Estimating widths -------------------------------------------------------------------------------------------

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b,
  0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99,
  0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** The factor for the families this file has always known by name (`undefined` for any other name). */
function knownFactor(family: string): number | undefined {
  const f = family.toLowerCase();
  if (/times|garamond|palatino|book antiqua|minion|baskerville/.test(f)) return 0.9;
  if (/georgia|cambria|charter|serif/.test(f) && !/sans/.test(f)) return 0.97;
  if (/verdana|tahoma|geneva/.test(f)) return 1.14;
  if (/trebuchet|segoe|open sans|lucida/.test(f)) return 1.04;
  if (/calibri|carlito|aptos|roboto|narrow|condensed/.test(f)) return 0.92;
  return undefined;
}

/**
 * How wide a family's text is compared with Helvetica's. Names this file knows (Times, Georgia, Verdana, Calibri...)
 * keep their numbers; any other family comes from the font catalogue of `@pli.dev/core` (its category and whether the name
 * says condensed or extended), and 1 when the catalogue knows nothing of it either.
 */
export function fontWidthFactor(family: string): number {
  const known = knownFactor(family);
  if (known !== undefined) return known;
  return widthFactor(family);
}

const KNOWN_MONO = /courier|consolas|menlo|monaco|mono|code/;
const isMono = (family: string) => KNOWN_MONO.test(family.toLowerCase()) || isMonospace(family);

/** The width of one character in thousandths of an em, for Helvetica (regular or bold). */
function glyphWidth(ch: string, bold: boolean): number {
  const code = ch.codePointAt(0)!;
  if (code === 9) return 4 * 278;
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const win = code >= 32 && code <= 126 ? code : code >= 160 && code <= 255 ? code : CP1252[code];
  if (win !== undefined) return table[win - 32] ?? 556;
  if (code < 32 || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) return 0;
  if (code >= 0x300 && code <= 0x36f) return 0; // combining marks
  if ((code >= 0x2e80 && code <= 0xd7ff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || code > 0x1f000) return 1000; // CJK, fullwidth, emoji
  if (code >= 0x2190 && code <= 0x2bff) return 700; // arrows, shapes and symbols
  if (code >= 0x0370 && code <= 0x058f) return 600; // Greek, Cyrillic, Armenian
  return 556;
}

/** The default measurer: Helvetica's widths, scaled for the family, plus letter spacing. */
export const defaultMeasure: TextMeasurer = (text, run) => {
  let units = 0;
  let count = 0;
  const mono = isMono(run.fontFamily);
  for (const ch of text) {
    count++;
    units += mono ? (glyphWidth(ch, false) === 0 ? 0 : 600) : glyphWidth(ch, run.bold);
  }
  const factor = mono ? 1 : fontWidthFactor(run.fontFamily);
  return (units / 1000) * run.fontSize * factor + run.letterSpacing * count;
};

// ---- Exact widths from font files ---------------------------------------------------------------------------------

/** What a PDF is drawn with: the TrueType files `toPdf` embeds, found the way its writer finds them (case does not matter). */
export interface FontFaces {
  /**
   * Widths from the font files: each character takes its glyph's advance. Families and styles that have no file, and
   * characters a file has no glyph for, are measured as `defaultMeasure` does (they are drawn in a standard PDF font).
   */
  measure: TextMeasurer;
  /** The family name the PDF writer finds a file under for this style (the name as written, or the catalogue's), or `undefined` when there is none. */
  face(family: string, bold: boolean, italic: boolean): string | undefined;
  /** Whether a file for the style has a glyph for every character of `text` (spaces, tabs and zero-width marks need none). `false` when there is no file. */
  covers(family: string, bold: boolean, italic: boolean, text: string): boolean;
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x200e, 0x200f]);

/** The files for `toPdf`'s `fonts` (`"Lora"`, `"Lora bold"`, `"Lora italic"`, `"Lora bold italic"`) as measuring and coverage. */
export function fontFaces(files: Record<string, Uint8Array>): FontFaces {
  const names = new Map<string, string>();
  for (const name of Object.keys(files)) names.set(name.toLowerCase(), name);
  const parsed = new Map<string, TrueTypeFont | null>();
  const fontOf = (name: string): TrueTypeFont | null => {
    let font = parsed.get(name);
    if (font === undefined) {
      try {
        font = parseTrueType(files[name]!);
      } catch {
        font = null;
      }
      parsed.set(name, font);
    }
    return font;
  };
  const find = (family: string, bold: boolean, italic: boolean): { name: string; font: TrueTypeFont; family: string } | undefined => {
    const style = `${bold ? " bold" : ""}${italic ? " italic" : ""}`;
    const tries = [family, lookupFont(family)?.family].filter((f): f is string => !!f);
    for (const f of tries) {
      const name = names.get((f + style).toLowerCase());
      const font = name ? fontOf(name) : null;
      if (name && font) return { name, font, family: name.slice(0, name.length - style.length) };
    }
    return undefined;
  };
  const covered = (font: TrueTypeFont, ch: string): boolean => {
    const code = ch.codePointAt(0)!;
    if (ZERO_WIDTH.has(code) || code === 32 || code === 9 || code === 10) return true;
    return font.glyphFor(code) !== 0;
  };
  const measure: TextMeasurer = (text, run) => {
    const hit = find(run.fontFamily, run.bold, run.italic);
    if (!hit) return defaultMeasure(text, run);
    const { font } = hit;
    let units = 0;
    let count = 0;
    for (const ch of text) {
      count++;
      const code = ch.codePointAt(0)!;
      if (ZERO_WIDTH.has(code)) continue;
      const glyph = code === 9 || code === 10 ? 0 : font.glyphFor(code);
      if (glyph !== 0 || code === 32) {
        units += (font.advance(glyph) * 1000) / font.unitsPerEm;
      } else {
        // No glyph: the standard font the PDF falls back to for this character, estimated.
        units += defaultMeasure(ch, { ...run, fontSize: 1000, letterSpacing: 0 });
      }
    }
    return (units / 1000) * run.fontSize + run.letterSpacing * count;
  };
  return {
    measure,
    face: (family, bold, italic) => find(family, bold, italic)?.family,
    covers: (family, bold, italic, text) => {
      const hit = find(family, bold, italic);
      if (!hit) return false;
      for (const ch of text) if (!covered(hit.font, ch)) return false;
      return true;
    },
  };
}

/**
 * A measurer with the real widths of TrueType fonts, so text is broken into lines as the PDF will draw it. `files` is
 * what `toPdf` takes as `fonts` (and what `FontRegistry.pdfFonts` returns): `"Lora"`, `"Lora bold"`, `"Lora italic"`,
 * `"Lora bold italic"`. Families and characters not in `files` are measured as `defaultMeasure` does.
 */
export function fontMeasurer(files: Record<string, Uint8Array>): TextMeasurer {
  return fontFaces(files).measure;
}

// ---- Atoms -------------------------------------------------------------------------------------------------------

interface Atom {
  text: string;
  run: ResolvedRun;
  size: number;
  dy: number;
  width: number;
  kind: "word" | "space" | "break";
  /** A word piece that ends in a hyphen: a line may break after it. */
  hyphen?: boolean;
}

interface Unit {
  atoms: Atom[];
  trailing: Atom[];
  forced: boolean;
}

const SUPER_SIZE = 0.667;
const LINE = 1.2;

interface Piece {
  text: string;
  size: number;
}

/** A run's text as it is drawn: capitals applied, small capitals as smaller pieces. */
function piecesOf(run: ResolvedRun, size: number): Piece[] {
  const t = run.text;
  if (run.allCaps) return [{ text: t.toUpperCase(), size }];
  if (!run.smallCaps) return [{ text: t, size }];
  const out: Piece[] = [];
  for (const ch of t) {
    const lower = ch !== ch.toUpperCase();
    const piece = { text: lower ? ch.toUpperCase() : ch, size: lower ? size * 0.8 : size };
    const last = out[out.length - 1];
    if (last && last.size === piece.size) last.text += piece.text;
    else out.push(piece);
  }
  return out;
}

/** Splits text at spaces, line breaks and after hyphens. */
function tokens(text: string): { text: string; kind: Atom["kind"]; hyphen?: boolean }[] {
  const out: { text: string; kind: Atom["kind"]; hyphen?: boolean }[] = [];
  let word = "";
  let spaces = "";
  const flushWord = (hyphen = false) => {
    if (word) out.push({ text: word, kind: "word", ...(hyphen ? { hyphen: true } : {}) });
    word = "";
  };
  const flushSpaces = () => {
    if (spaces) out.push({ text: spaces, kind: "space" });
    spaces = "";
  };
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === "\n" || ch === "\v" || ch === "\r") {
      flushWord();
      flushSpaces();
      out.push({ text: "", kind: "break" });
    } else if (ch === " " || ch === "\t" || ch === " " && false) {
      flushWord();
      spaces += ch;
    } else {
      flushSpaces();
      word += ch;
      const next = chars[i + 1];
      if ((ch === "-" || ch === "‐" || ch === "–" || ch === "—") && word.length > 1 && next !== undefined && next !== " " && next !== "-") flushWord(true);
    }
  }
  flushWord();
  flushSpaces();
  return out;
}

// ---- Laying out one pass -----------------------------------------------------------------------------------------

interface Pass {
  lines: LaidLine[];
  /** Total height from the first line's top to the last line's bottom. */
  height: number;
}

function baseRunOf(p: ResolvedParagraph): ResolvedRun {
  const r = p.runs.find((x) => x.text !== "") ?? p.runs[0];
  if (r) return r;
  return { text: "", fontFamily: "Arial", fontSize: p.endSize, bold: false, italic: false, underline: false, strike: false, color: "#000000", alpha: 1, baseline: 0, allCaps: false, smallCaps: false, letterSpacing: 0 };
}

function bulletRun(b: ResolvedBullet, base: ResolvedRun, size: number): ResolvedRun {
  return { ...base, text: b.label, fontFamily: b.fontFamily ?? base.fontFamily, fontSize: size, color: b.color, underline: false, strike: false, highlight: undefined, link: undefined, baseline: 0, allCaps: false, smallCaps: false, field: undefined };
}

function layoutPass(text: ResolvedText, boxWidth: number, measure: TextMeasurer, fontScale: number, spacingCut: number): Pass {
  const cache = new Map<string, number>();
  const width = (s: string, run: ResolvedRun, size: number): number => {
    if (s === "") return 0;
    const key = `${run.fontFamily}|${size}|${run.bold ? 1 : 0}${run.italic ? 1 : 0}|${run.letterSpacing}|${s}`;
    let w = cache.get(key);
    if (w === undefined) {
      w = measure(s, { fontFamily: run.fontFamily, fontSize: size, bold: run.bold, italic: run.italic, letterSpacing: run.letterSpacing, allCaps: false, smallCaps: false });
      if (!Number.isFinite(w) || w < 0) w = 0;
      cache.set(key, w);
    }
    return w;
  };

  const { l: insetL, r: insetR } = text.insets;
  const avail = Math.max(1, boxWidth - insetL - insetR);
  const lines: LaidLine[] = [];
  let y = 0;

  text.paragraphs.forEach((p, pi) => {
    const first = pi === 0;
    const base = baseRunOf(p);
    const baseSize = base.fontSize * fontScale;
    const hasBullet = !!p.bullet && p.runs.some((r) => r.text !== "");
    const bulletSize = p.bullet ? baseSize * (p.bullet.size / 100) : 0;
    const bRun = p.bullet && hasBullet ? bulletRun(p.bullet, base, bulletSize) : undefined;
    const bulletW = bRun ? width(p.bullet!.label, bRun, bulletSize) : 0;
    const marL = Math.max(0, p.marL);
    const bulletX = Math.max(0, marL + p.indent);
    // A bullet that fits before the margin leaves the text at the margin; one that doesn't pushes the text past it.
    const firstStart = bRun ? (bulletX + bulletW <= marL + 0.01 ? marL : bulletX + bulletW + 0.25 * baseSize) : Math.max(0, marL + p.indent);
    const restStart = marL;

    // atoms
    const atoms: Atom[] = [];
    for (const run of p.runs) {
      const raised = run.baseline !== 0;
      const size = run.fontSize * fontScale * (raised ? SUPER_SIZE : 1);
      const dy = -(run.baseline / 100) * run.fontSize * fontScale;
      for (const piece of piecesOf(run, size)) {
        for (const tk of tokens(piece.text)) {
          atoms.push({ text: tk.text, run, size: piece.size, dy, width: tk.kind === "break" ? 0 : width(tk.text, run, piece.size), kind: tk.kind, hyphen: tk.hyphen });
        }
      }
    }

    // units: runs of atoms with no break opportunity inside, then the spaces that follow
    const units: Unit[] = [];
    let cur: Unit | undefined;
    for (const a of atoms) {
      if (a.kind === "break") {
        if (!cur) cur = { atoms: [], trailing: [], forced: false };
        cur.forced = true;
        units.push(cur);
        cur = undefined;
      } else if (a.kind === "space") {
        if (!cur) cur = { atoms: [], trailing: [], forced: false };
        cur.trailing.push(a);
      } else {
        if (cur && cur.trailing.length) {
          units.push(cur);
          cur = undefined;
        }
        if (!cur) cur = { atoms: [], trailing: [], forced: false };
        cur.atoms.push(a);
        if (a.hyphen) {
          units.push(cur);
          cur = undefined;
        }
      }
    }
    if (cur) units.push(cur);

    // greedy breaking
    interface Row { atoms: Atom[]; width: number; forced: boolean }
    const rows: Row[] = [];
    let row: Row = { atoms: [], width: 0, forced: false };
    let pending: Atom[] = [];
    let pendingW = 0;
    const lineAvail = () => Math.max(1, avail - (rows.length === 0 ? firstStart : restStart));
    const commit = (forced: boolean) => {
      row.forced = forced;
      rows.push(row);
      row = { atoms: [], width: 0, forced: false };
      pending = [];
      pendingW = 0;
    };
    const wrap = text.wrap;

    for (const u of units) {
      let uAtoms = u.atoms;
      let uW = uAtoms.reduce((s, a) => s + a.width, 0);
      const trail = u.trailing;
      const trailW = trail.reduce((s, a) => s + a.width, 0);
      if (uAtoms.length === 0) {
        // only spaces (leading ones, or between line breaks)
        if (trail.length) {
          row.atoms.push(...pending, ...trail);
          row.width += pendingW + trailW;
          pending = [];
          pendingW = 0;
        }
        if (u.forced) commit(true);
        continue;
      }
      for (;;) {
        if (!wrap || row.width + pendingW + uW <= lineAvail() + 0.001) {
          row.atoms.push(...pending, ...uAtoms);
          row.width += pendingW + uW;
          pending = trail;
          pendingW = trailW;
          break;
        }
        if (row.atoms.length > 0) {
          commit(false);
          continue;
        }
        // a word wider than the line: split it where it fits (at least one character per line)
        const [head, rest] = splitAtoms(uAtoms, lineAvail(), width);
        row.atoms.push(...head);
        row.width = head.reduce((s, a) => s + a.width, 0);
        commit(false);
        uAtoms = rest;
        uW = rest.reduce((s, a) => s + a.width, 0);
        if (rest.length === 0) break;
      }
      if (u.forced) commit(true);
    }
    if (row.atoms.length > 0 || rows.length === 0 || (units.length > 0 && units[units.length - 1]!.forced)) commit(false);

    // lines
    const ls = Math.max(0.1, p.lineSpacing * (1 - spacingCut));
    if (!first) y += p.spaceBefore * (1 - spacingCut);
    rows.forEach((r, ri) => {
      const isFirst = ri === 0;
      const lineStart = isFirst ? firstStart : restStart;
      const room = Math.max(0, avail - lineStart);
      const maxSize = r.atoms.length ? Math.max(...r.atoms.map((a) => a.run.fontSize * fontScale)) : p.endSize * fontScale;
      const height = maxSize * LINE * ls;
      const top = y;
      const baseline = top + height - 0.25 * maxSize;
      let offset = 0;
      const last = ri === rows.length - 1 || r.forced;
      if (p.align === "center") offset = (room - r.width) / 2;
      else if (p.align === "right") offset = room - r.width;
      const x0 = insetL + lineStart + offset;

      // segments: neighbouring atoms of one style are drawn together
      const segments: LaidSegment[] = [];
      let x = x0;
      const justify = p.align === "justify" && !last && wrap;
      const gaps = justify ? r.atoms.filter((a) => a.kind === "space").reduce((n, a) => n + a.text.length, 0) : 0;
      const extra = justify && gaps > 0 ? Math.max(0, room - r.width) / gaps : 0;
      for (const a of r.atoms) {
        const w = a.width + (a.kind === "space" ? extra * a.text.length : 0);
        const prev = segments[segments.length - 1];
        const mergeable = prev && prev.run === a.run && prev.fontSize === a.size && prev.dy === a.dy && !(justify && (a.kind === "space" || prev.text.endsWith(" ")));
        if (mergeable) {
          prev.text += a.text;
          prev.width += w;
        } else segments.push({ text: a.text, x, width: w, run: a.run, fontSize: a.size, dy: a.dy });
        x += w;
      }
      const line: LaidLine = { paragraph: pi, x: x0, y: baseline, top, width: r.width, height, segments };
      if (isFirst && bRun) line.bullet = { label: p.bullet!.label, x: insetL + bulletX, width: bulletW, run: bRun, fontSize: bulletSize };
      lines.push(line);
      y += height;
    });
    if (pi < text.paragraphs.length - 1) y += p.spaceAfter * (1 - spacingCut);
  });

  return { lines, height: y };
}

/** Splits a too-wide unit's atoms at the character where the width runs out. */
function splitAtoms(atoms: Atom[], room: number, width: (s: string, run: ResolvedRun, size: number) => number): [Atom[], Atom[]] {
  const head: Atom[] = [];
  let used = 0;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    if (used + a.width <= room + 0.001) {
      head.push(a);
      used += a.width;
      continue;
    }
    const chars = [...a.text];
    let n = 0;
    let w = 0;
    while (n < chars.length) {
      const next = width(chars.slice(0, n + 1).join(""), a.run, a.size);
      if (used + next > room + 0.001) break;
      n++;
      w = next;
    }
    if (n === 0 && head.length === 0) {
      n = 1; // always make progress
      w = width(chars[0]!, a.run, a.size);
    }
    const rest: Atom[] = [];
    if (n > 0) head.push({ ...a, text: chars.slice(0, n).join(""), width: w });
    if (n < chars.length) {
      const tail = chars.slice(n).join("");
      rest.push({ ...a, text: tail, width: width(tail, a.run, a.size) });
    }
    return [head, [...rest, ...atoms.slice(i + 1)]];
  }
  return [head, []];
}

// ---- Public ------------------------------------------------------------------------------------------------------

/** PowerPoint's shrink steps: font scale and how much the line spacing is cut at each. */
const SHRINK_STEPS: [number, number][] = [[1, 0], [0.925, 0.1], [0.85, 0.2], [0.775, 0.2], [0.7, 0.2], [0.625, 0.2], [0.55, 0.2], [0.475, 0.2], [0.4, 0.2], [0.325, 0.2], [0.25, 0.2]];

/**
 * Lays text out in a box of `width` by `height` points (the box, not the area inside the insets). `autofit: "shrink"`
 * steps the font down (to 25%) and cuts line spacing (by at most 20%) until the text fits; `"resize"` keeps the size and
 * reports the height the box would need in `neededHeight`.
 */
export function layoutText(text: ResolvedText, width: number, height: number, measure: TextMeasurer = defaultMeasure): TextLayout {
  const { t, b } = text.insets;
  const inner = height - t - b;
  const run = (scale: number, cut: number) => layoutPass(text, width, measure, scale, cut);
  let scale = 1;
  let cut = 0;
  let pass = run(1, 0);
  if (text.autofit === "shrink") {
    for (const [s, c] of SHRINK_STEPS) {
      scale = s;
      cut = c;
      pass = run(s, c);
      if (pass.height <= inner + 0.01) break;
    }
  }
  const needed = pass.height + t + b;
  let shift = t;
  if (text.autofit !== "resize") {
    if (text.vAlign === "middle") shift = t + (inner - pass.height) / 2;
    else if (text.vAlign === "bottom") shift = t + (inner - pass.height);
  }
  const lines = pass.lines.map((l) => ({ ...l, y: l.y + shift, top: l.top + shift }));
  return {
    lines,
    contentHeight: pass.height,
    scale,
    lineSpacingReduction: cut,
    overflow: text.autofit === "resize" ? false : pass.height > inner + 0.01,
    neededHeight: needed,
  };
}
