import { withLevelPrompts } from "../build";
import type { Deck, Element, Fill, LevelStyle, Marks, Master, Paragraph, ParaProps, Slide, SlideSize, TextBody } from "../model";
import { fromPptx, type PptxImportOptions } from "./read";

export interface TemplateImport {
  /** Every slide master of the file, with its theme, background, decorations, text styles and layouts. */
  masters: Master[];
  /** The slide size the masters are drawn for (the file's own). Use `scaleMaster` to move them to another size. */
  size: SlideSize;
  warnings: string[];
  /** The file's own slides on its masters, when it has any (a template often carries sample slides). */
  sampleDeck?: Deck;
}

/**
 * Reads a template: a `.potx`, a `.pptx`, or a Google Slides `.pptx` export. Each slide master becomes a Pli.Decks
 * `Master` that `DeckSession.applyTheme` takes. The slides' content is not part of the template; it comes back as
 * `sampleDeck` for showing what the template looks like.
 */
export function importTemplate(bytes: Uint8Array, options: PptxImportOptions = {}): TemplateImport {
  const { deck, warnings } = fromPptx(bytes, options);
  const names = new Map<string, number>();
  const masters = deck.masters.map((raw) => {
    const m = withLevelPrompts(raw);
    const base = m.name || "Imported master";
    const n = (names.get(base) ?? 0) + 1;
    names.set(base, n);
    return n === 1 ? m : { ...m, name: `${base} (${n})` };
  });
  const result: TemplateImport = { masters, size: deck.size, warnings };
  if (deck.slides.length > 0) result.sampleDeck = { ...deck, masters };
  return result;
}

// ---- Scaling a master to another slide size ----------------------------------------------------------------------

/**
 * Moves a master to a slide of another size. Positions and sizes follow the slide (x with the width, y with the height,
 * so full-width bands and footers stay put); font sizes, spacing, insets and line widths scale with the smaller of the
 * two ratios so that text keeps its proportions to the slide.
 */
export function scaleMaster(master: Master, from: SlideSize, to: SlideSize): Master {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  if (!Number.isFinite(kx) || !Number.isFinite(ky) || kx <= 0 || ky <= 0) return structuredClone(master);
  if (kx === 1 && ky === 1) return structuredClone(master);
  const k = Math.min(kx, ky);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const sx = (n: number | undefined) => (n === undefined ? undefined : round(n * kx));
  const sy = (n: number | undefined) => (n === undefined ? undefined : round(n * ky));
  const sk = (n: number | undefined) => (n === undefined ? undefined : round(n * k));

  const marks = (m: Marks | undefined): Marks | undefined => {
    if (!m) return m;
    const out = { ...m };
    if (out.fontSize !== undefined) out.fontSize = round(out.fontSize * k);
    if (out.letterSpacing !== undefined) out.letterSpacing = round(out.letterSpacing * k);
    return out;
  };
  const para = <T extends ParaProps>(p: T): T => {
    const out = { ...p };
    if (out.marL !== undefined) out.marL = round(out.marL * k);
    if (out.indent !== undefined) out.indent = round(out.indent * k);
    if (out.spaceBefore !== undefined) out.spaceBefore = round(out.spaceBefore * k);
    if (out.spaceAfter !== undefined) out.spaceAfter = round(out.spaceAfter * k);
    return out;
  };
  const level = (l: LevelStyle): LevelStyle => {
    const out = para(l);
    if (l.marks) out.marks = marks(l.marks);
    return out;
  };
  const levels = (ls: Record<number, LevelStyle> | undefined): Record<number, LevelStyle> | undefined => {
    if (!ls) return ls;
    const out: Record<number, LevelStyle> = {};
    for (const [i, l] of Object.entries(ls)) out[Number(i)] = level(l);
    return out;
  };
  const text = (t: TextBody | undefined): TextBody | undefined => {
    if (!t) return t;
    const out: TextBody = { ...t, paragraphs: t.paragraphs.map((p) => ({ ...para(p), runs: p.runs.map((r) => (r.marks ? { ...r, marks: marks(r.marks) } : r)), ...(p.endMarks ? { endMarks: marks(p.endMarks) } : {}) })) };
    if (t.insets) {
      out.insets = {};
      if (t.insets.l !== undefined) out.insets.l = round(t.insets.l * k);
      if (t.insets.t !== undefined) out.insets.t = round(t.insets.t * k);
      if (t.insets.r !== undefined) out.insets.r = round(t.insets.r * k);
      if (t.insets.b !== undefined) out.insets.b = round(t.insets.b * k);
    }
    if (t.levels) out.levels = levels(t.levels);
    return out;
  };
  const scaleLine = (l: { width?: number } | null | undefined) => {
    if (l && l.width !== undefined) l.width = round(l.width * k);
  };
  const scaleParas = (ps: Paragraph[]) => {
    for (const p of ps) {
      Object.assign(p, para(p));
      for (const r of p.runs) if (r.marks) r.marks = marks(r.marks);
      if (p.endMarks) p.endMarks = marks(p.endMarks);
    }
  };
  /** Scales an element in place (it is a copy). */
  const scale = (e: Element): void => {
    if (e.x !== undefined) e.x = sx(e.x);
    if (e.y !== undefined) e.y = sy(e.y);
    if (e.w !== undefined) e.w = sx(e.w);
    if (e.h !== undefined) e.h = sy(e.h);
    switch (e.type) {
      case "shape":
        if (e.text) e.text = text(e.text);
        scaleLine(e.line);
        if (e.shadow) e.shadow = { ...e.shadow, blur: sk(e.shadow.blur), dx: sk(e.shadow.dx), dy: sk(e.shadow.dy) };
        break;
      case "image":
        scaleLine(e.line);
        break;
      case "table":
        e.columns = e.columns.map((c) => round(c * kx));
        for (const r of e.rows) {
          r.h = round(r.h * ky);
          for (const c of r.cells) scaleParas(c.paragraphs);
        }
        break;
      case "group":
        e.children.forEach(scale);
        break;
    }
  };
  const element = (e: Element): Element => {
    const copy = structuredClone(e);
    scale(copy);
    return copy;
  };
  const fill = (f: Fill | undefined): Fill | undefined => f;

  const out: Master = {
    ...structuredClone(master),
    elements: master.elements.map(element),
    textStyles: { title: levels(master.textStyles.title)!, body: levels(master.textStyles.body)!, other: levels(master.textStyles.other)! },
    layouts: master.layouts.map((l) => ({ ...structuredClone(l), elements: l.elements.map(element), ...(l.background !== undefined ? { background: fill(l.background) } : {}) })),
  };
  return out;
}

export { withFreshIds } from "../build";

export type { Slide };
