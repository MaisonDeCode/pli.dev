import { resolveColor, rgbaCss, toHex, type Rgba } from "./color";
import type {
  CustomGeometry,
  ArrowEnd,
  ChartElement,
  Bullet,
  Color,
  Crop,
  DashStyle,
  Deck,
  Element,
  Fill,
  ImageElement,
  Layout,
  LevelStyle,
  Line,
  Marks,
  Master,
  Paragraph,
  ParaProps,
  Placeholder,
  PlaceholderType,
  Shadow,
  ShapeElement,
  Slide,
  TableElement,
  TextBody,
  Theme,
} from "./model";
import { STOCK_PROMPT } from "./build";
import { findLayout } from "./ops";
import { paragraphText } from "./text";

// ---- What a resolved slide is made of ---------------------------------------------------------------------------

export type ResolvedFill =
  | { kind: "none" }
  | { kind: "solid"; color: string; alpha: number }
  | { kind: "gradient"; gradientKind: "linear" | "radial"; angle: number; /** Radial: fractions of the shape; reaches the farthest corner. */ center?: { x: number; y: number }; stops: { at: number; color: string; alpha: number }[] }
  | { kind: "image"; src: string; mode: "stretch" | "tile"; crop?: Crop; alpha: number };

export interface ResolvedLine {
  color: string;
  alpha: number;
  width: number;
  dash: DashStyle;
  head: ArrowEnd;
  tail: ArrowEnd;
  cap: "flat" | "round" | "square";
  join: "round" | "bevel" | "miter";
}

export interface ResolvedShadow {
  color: string;
  alpha: number;
  blur: number;
  dx: number;
  dy: number;
}

export interface ResolvedRun {
  text: string;
  /** A real font family (theme references are resolved). */
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  alpha: number;
  highlight?: string;
  link?: string;
  /** Percentage of the font size the text is raised (negative lowers). */
  baseline: number;
  allCaps: boolean;
  smallCaps: boolean;
  letterSpacing: number;
  field?: "slideNumber" | "date" | "slideCount";
}

export interface ResolvedBullet {
  /** What is drawn before the text: the character, or the number as text (`3.`). */
  label: string;
  color: string;
  /** Percentage of the text size. */
  size: number;
  fontFamily?: string;
}

export interface ResolvedParagraph {
  runs: ResolvedRun[];
  level: number;
  align: "left" | "center" | "right" | "justify";
  marL: number;
  indent: number;
  bullet: ResolvedBullet | null;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number;
  rtl: boolean;
  /** Size of the paragraph's end mark; the height of an empty paragraph. */
  endSize: number;
}

export interface ResolvedText {
  paragraphs: ResolvedParagraph[];
  vAlign: "top" | "middle" | "bottom";
  insets: { l: number; t: number; r: number; b: number };
  wrap: boolean;
  autofit: "none" | "shrink" | "resize";
}

export interface ResolvedCell {
  text: ResolvedText;
  fill: ResolvedFill;
  colSpan: number;
  rowSpan: number;
  covered: boolean;
  borders: { top: ResolvedLine | null; right: ResolvedLine | null; bottom: ResolvedLine | null; left: ResolvedLine | null };
  /** Position inside the table, in points from the table's top left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResolvedTable {
  columns: number[];
  rows: { h: number; y: number; cells: ResolvedCell[] }[];
}

export interface ResolvedElement {
  id: string;
  kind: "shape" | "image" | "table" | "chart" | "group";
  /** Where it came from: only slides' own elements can be edited from the slide. */
  from: "slide" | "layout" | "master";
  source: Element;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  hidden: boolean;
  placeholder?: Placeholder;
  link?: string;
  alt?: string;
  geometry: string;
  adjust: Record<string, number>;
  /** A freeform outline: when set it wins over `geometry` (shapes and picture masks). */
  custom?: CustomGeometry;
  fill: ResolvedFill;
  line: ResolvedLine | null;
  shadow: ResolvedShadow | null;
  text?: ResolvedText;
  /** For an empty placeholder: the prompt the layout gives ("Click to add title"). */
  prompt?: string;
  src?: string;
  crop?: Crop;
  table?: ResolvedTable;
  /** The chart's data and options; draw it with `chartScene(chart, w, h, scene.theme)`. */
  chart?: ChartElement;
  children?: ResolvedElement[];
}

export interface Scene {
  width: number;
  height: number;
  theme: Theme;
  background: ResolvedFill;
  /** In drawing order: master shapes, layout shapes, then the slide's. */
  elements: ResolvedElement[];
}

export interface SceneContext {
  /** 1-based number of the slide, for slide number fields. */
  slideNumber?: number;
  slideCount?: number;
  /** Text shown for date fields that have no cached value. */
  date?: string;
}

// ---- Placeholders ------------------------------------------------------------------------------------------------

type Family = "title" | "body" | "dt" | "ftr" | "sldNum" | "pic" | "other";

export function placeholderFamily(type: PlaceholderType): Family {
  switch (type) {
    case "title":
    case "ctrTitle":
      return "title";
    case "subTitle":
    case "body":
    case "obj":
      return "body";
    case "dt":
    case "ftr":
    case "sldNum":
    case "pic":
      return type;
    default:
      return "other";
  }
}

/** The style set that text in a placeholder of this type uses. */
export function styleKindOf(type: PlaceholderType | undefined): "title" | "body" | "other" {
  if (!type) return "other";
  const f = placeholderFamily(type);
  return f === "title" ? "title" : f === "body" ? "body" : "other";
}

/** The placeholder on a layout (or master) that a placeholder of a slide takes its properties from. */
export function matchPlaceholder(elements: readonly Element[], ph: Placeholder): ShapeElement | undefined {
  const holders = elements.filter((e): e is ShapeElement => e.type === "shape" && !!e.placeholder);
  const fam = placeholderFamily(ph.type);
  const sameFamily = holders.filter((e) => placeholderFamily(e.placeholder!.type) === fam);
  const idxEq = (e: ShapeElement) => (e.placeholder!.idx ?? 0) === (ph.idx ?? 0);
  return (
    holders.find((e) => e.placeholder!.type === ph.type && idxEq(e)) ??
    sameFamily.find(idxEq) ??
    holders.find((e) => e.placeholder!.type === ph.type) ??
    (fam === "body" || fam === "pic" || fam === "other" ? sameFamily.find((e) => e.placeholder!.idx === ph.idx) : undefined) ??
    sameFamily[0]
  );
}

const DEFAULT_PROMPTS: Partial<Record<PlaceholderType, string>> = {
  title: "Click to add title",
  ctrTitle: "Click to add title",
  subTitle: "Click to add subtitle",
  body: "Click to add text",
  obj: "Click to add text",
  pic: "Click to add picture",
  chart: "Click to add chart",
  tbl: "Click to add table",
  media: "Click to add media",
  dt: "Date",
  ftr: "Footer",
  sldNum: "‹#›",
};

// ---- Inheritance chain -------------------------------------------------------------------------------------------

const BUILTIN: LevelStyle = { marks: { fontSize: 18, fontFamily: "+mn-lt", color: { theme: "dk1" } }, align: "left", marL: 0, indent: 0, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 };

function mergeLevel(base: LevelStyle, over: LevelStyle | undefined): LevelStyle {
  if (!over) return base;
  const out: LevelStyle = { ...base, ...over };
  if (base.marks || over.marks) out.marks = { ...base.marks, ...over.marks };
  for (const k of Object.keys(over) as (keyof LevelStyle)[]) if (over[k] === undefined) (out as Record<string, unknown>)[k] = (base as Record<string, unknown>)[k];
  return out;
}

interface Chain {
  /** From least to most specific. */
  levels: (Record<number, LevelStyle> | undefined)[];
  /** The TextBodys of placeholders up the chain, least specific first, for shape-level properties. */
  bodies: (TextBody | undefined)[];
}

function levelStyle(chain: Chain, level: number, deck: Deck): LevelStyle {
  let style = mergeLevel(BUILTIN, deck.defaultTextStyle?.[level] ?? deck.defaultTextStyle?.[0]);
  for (const levels of chain.levels) style = mergeLevel(style, levels?.[level]);
  return style;
}

function fontOf(family: string | undefined, theme: Theme): string {
  if (!family || family === "+mn-lt" || family === "+mn-ea" || family === "+mn-cs") return theme.fonts.minor;
  if (family === "+mj-lt" || family === "+mj-ea" || family === "+mj-cs") return theme.fonts.major;
  return family;
}

function roman(n: number, upper: boolean): string {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
  return upper ? s.toUpperCase() : s;
}

function alpha(n: number, upper: boolean): string {
  let s = "";
  let x = n;
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return upper ? s.toUpperCase() : s;
}

export function numberLabel(scheme: string, n: number): string {
  switch (scheme) {
    case "arabicParenR": return `${n})`;
    case "alphaLcPeriod": return `${alpha(n, false)}.`;
    case "alphaUcPeriod": return `${alpha(n, true)}.`;
    case "romanLcPeriod": return `${roman(n, false)}.`;
    case "romanUcPeriod": return `${roman(n, true)}.`;
    default: return `${n}.`;
  }
}

// ---- Resolving paint ---------------------------------------------------------------------------------------------

export function resolveFill(fill: Fill | null | undefined, theme: Theme): ResolvedFill {
  if (fill === null || fill === undefined) return { kind: "none" };
  if (typeof fill === "string" || "theme" in fill) {
    const c = resolveColor(fill as Color, theme);
    return { kind: "solid", color: toHex(c), alpha: c.a };
  }
  if ("gradient" in fill) {
    const g = fill.gradient;
    return {
      kind: "gradient",
      gradientKind: g.kind ?? "linear",
      angle: g.angle ?? 0,
      ...(g.center ? { center: g.center } : {}),
      stops: g.stops.map((s) => {
        const c = resolveColor(s.color, theme);
        return { at: s.at, color: toHex(c), alpha: c.a };
      }),
    };
  }
  return { kind: "image", src: fill.image.src, mode: fill.image.mode ?? "stretch", crop: fill.image.crop, alpha: fill.image.alpha ?? 1 };
}

export function resolveLine(line: Line | null | undefined, theme: Theme, fallbackColor: Color = { theme: "dk1" }): ResolvedLine | null {
  if (!line) return null;
  if (line.width === 0) return null;
  const c: Rgba = resolveColor(line.color ?? fallbackColor, theme);
  return { color: toHex(c), alpha: c.a, width: line.width ?? 1, dash: line.dash ?? "solid", head: line.head ?? "none", tail: line.tail ?? "none", cap: line.cap ?? "flat", join: line.join ?? "round" };
}

function resolveShadow(shadow: Shadow | null | undefined, theme: Theme): ResolvedShadow | null {
  if (!shadow) return null;
  const c = resolveColor(shadow.color ?? "#00000040", theme);
  return { color: toHex(c), alpha: c.a, blur: shadow.blur ?? 4, dx: shadow.dx ?? 2, dy: shadow.dy ?? 2 };
}

/**
 * Where a radial gradient with a focus point is drawn in a shape of this size, in points from its top left corner: the
 * focus, and a circle (not an ellipse) reaching the farthest corner of the shorter side's square, which is how PowerPoint
 * files made for soft corner glows are shown by other viewers. A gradient without a focus is an ellipse over the whole shape.
 */
export function radialExtent(center: { x: number; y: number } | undefined, w: number, h: number): { cx: number; cy: number; r: number } {
  if (!center) return { cx: w / 2, cy: h / 2, r: Math.hypot(w, h) / 2 };
  return { cx: center.x * w, cy: center.y * h, r: Math.min(w, h) * Math.hypot(Math.max(center.x, 1 - center.x), Math.max(center.y, 1 - center.y)) };
}

/** CSS for a resolved colour with opacity. */
export const cssColor = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return rgbaCss({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a });
};

// ---- Resolving text ----------------------------------------------------------------------------------------------

function runOf(text: string, marks: Marks | undefined, style: LevelStyle, theme: Theme, ctx: SceneContext): ResolvedRun {
  const m: Marks = { ...style.marks, ...marks };
  const c = resolveColor(m.color ?? { theme: "dk1" }, theme);
  let t = text;
  if (m.field === "slideNumber" && ctx.slideNumber !== undefined) t = String(ctx.slideNumber);
  else if (m.field === "slideCount" && ctx.slideCount !== undefined) t = String(ctx.slideCount);
  else if (m.field === "date" && !t && ctx.date) t = ctx.date;
  return {
    text: t,
    fontFamily: fontOf(m.fontFamily, theme),
    fontSize: m.fontSize ?? 18,
    bold: !!m.bold,
    italic: !!m.italic,
    underline: !!m.underline,
    strike: !!m.strike,
    color: toHex(c),
    alpha: c.a,
    highlight: m.highlight ? toHex(resolveColor(m.highlight, theme)) : undefined,
    link: m.link,
    baseline: m.baseline === "super" ? 30 : m.baseline === "sub" ? -25 : (m.baseline ?? 0),
    allCaps: !!m.allCaps,
    smallCaps: !!m.smallCaps,
    letterSpacing: m.letterSpacing ?? 0,
    field: m.field,
  };
}

function bulletOf(bullet: Bullet | null | undefined, number: number, firstRun: ResolvedRun | undefined, theme: Theme): ResolvedBullet | null {
  if (!bullet) return null;
  const color = bullet.color ? toHex(resolveColor(bullet.color, theme)) : (firstRun?.color ?? "#000000");
  if (bullet.type === "char") return { label: bullet.char, color, size: bullet.size ?? 100, fontFamily: bullet.font };
  return { label: numberLabel(bullet.scheme, number), color, size: 100 };
}

export function resolveText(body: TextBody | undefined, chain: Chain, deck: Deck, theme: Theme, ctx: SceneContext): ResolvedText {
  const bodies = [...chain.bodies, body];
  const pick = <K extends keyof TextBody>(key: K): TextBody[K] | undefined => {
    for (let i = bodies.length - 1; i >= 0; i--) if (bodies[i]?.[key] !== undefined) return bodies[i]![key];
    return undefined;
  };
  const insets = Object.assign({}, ...bodies.map((b) => b?.insets)) as { l?: number; t?: number; r?: number; b?: number };
  const counters: Record<number, { scheme: string; n: number }> = {};
  const full: Chain = { levels: [...chain.levels, body?.levels], bodies: chain.bodies };
  const paragraphs: ResolvedParagraph[] = (body?.paragraphs ?? []).map((p) => {
    const level = Math.min(8, Math.max(0, p.level ?? 0));
    const style = levelStyle(full, level, deck);
    const para: ParaProps = { ...style, ...definedProps(p) };
    const baseMarks = { ...style.marks };
    const runs = p.runs.map((r) => runOf(r.text, r.marks, { ...style, marks: baseMarks }, theme, ctx));
    const endRun = runOf("", p.endMarks, { ...style, marks: baseMarks }, theme, ctx);
    // numbering: consecutive paragraphs at a level count up; a break in the list or a shallower paragraph restarts it
    let number = 1;
    const b = para.bullet;
    for (const k of Object.keys(counters)) if (Number(k) > level) delete counters[Number(k)];
    if (b && b.type === "number") {
      const prev = counters[level];
      number = prev && prev.scheme === b.scheme ? prev.n + 1 : (b.start ?? 1);
      counters[level] = { scheme: b.scheme, n: number };
    } else delete counters[level];
    return {
      runs,
      level,
      align: para.align ?? "left",
      marL: para.marL ?? 0,
      indent: para.indent ?? 0,
      bullet: bulletOf(b, number, runs[0] ?? endRun, theme),
      spaceBefore: para.spaceBefore ?? 0,
      spaceAfter: para.spaceAfter ?? 0,
      lineSpacing: para.lineSpacing ?? 1,
      rtl: !!para.rtl,
      endSize: endRun.fontSize,
    };
  });
  return {
    paragraphs,
    vAlign: pick("vAlign") ?? "top",
    insets: { l: insets.l ?? 7.2, t: insets.t ?? 3.6, r: insets.r ?? 7.2, b: insets.b ?? 3.6 },
    wrap: pick("wrap") ?? true,
    autofit: pick("autofit") ?? "none",
  };
}

function definedProps(p: Paragraph): ParaProps {
  const out: ParaProps = {};
  for (const k of ["align", "marL", "indent", "bullet", "spaceBefore", "spaceAfter", "lineSpacing", "rtl"] as const) if (p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  return out;
}

// ---- Resolving elements ------------------------------------------------------------------------------------------

interface Env {
  deck: Deck;
  theme: Theme;
  master: Master;
  layout: Layout;
  ctx: SceneContext;
  /** Frames for slide placeholders that nothing on the layout or master gives a position to. */
  orphans?: Map<string, Frame>;
}

type Frame = { x: number; y: number; w: number; h: number };

type Origin = "slide" | "layout" | "master";

function inherited(el: ShapeElement, env: Env, origin: Origin): { chain: Chain; layoutPh?: ShapeElement; masterPh?: ShapeElement } {
  const ph = el.placeholder;
  if (!ph) return { chain: { levels: [], bodies: [] } };
  const masterPh = matchPlaceholder(env.master.elements, ph);
  const layoutPh = origin === "slide" ? matchPlaceholder(env.layout.elements, ph) : undefined;
  const kind = styleKindOf(ph.type);
  const levels: Record<number, LevelStyle>[] = [];
  const bodies: (TextBody | undefined)[] = [];
  levels.push(env.master.textStyles[kind]);
  if (origin !== "master" && masterPh && masterPh !== el) {
    levels.push(masterPh.text?.levels ?? {});
    bodies.push(masterPh.text);
  }
  if (origin === "slide" && layoutPh && layoutPh !== el) {
    levels.push(layoutPh.text?.levels ?? {});
    bodies.push(layoutPh.text);
  }
  return { chain: { levels, bodies }, layoutPh, masterPh };
}

function pickFill<K extends "fill" | "line" | "shadow">(key: K, el: ShapeElement, chain: (ShapeElement | undefined)[]): ShapeElement[K] | undefined {
  if (el[key] !== undefined) return el[key];
  for (const c of chain) if (c && c[key] !== undefined) return c[key];
  return undefined;
}

function frameOf(el: Element, chain: (Element | undefined)[], env: Env): Frame {
  const src = [el, ...chain];
  const pick = (k: "x" | "y" | "w" | "h") => src.find((e) => e && e[k] !== undefined)?.[k];
  const spare = env.orphans?.get(el.id);
  const w = pick("w") ?? spare?.w ?? env.deck.size.width / 2;
  const h = pick("h") ?? spare?.h ?? env.deck.size.height / 4;
  return { x: pick("x") ?? spare?.x ?? (env.deck.size.width - w) / 2, y: pick("y") ?? spare?.y ?? (env.deck.size.height - h) / 2, w, h };
}

const hasFrame = (e: Element | undefined): boolean => !!e && e.x !== undefined && e.y !== undefined && e.w !== undefined && e.h !== undefined;

/**
 * Slide placeholders that have no position anywhere (their layout and master have no placeholder like them, as after
 * switching to a theme whose layouts are only pictures and text boxes) would all fall on the same spot and print over
 * each other. They get a sensible arrangement instead: the title on top, other content in a row below it.
 */
function orphanFrames(slide: Slide, env: Env): Map<string, Frame> {
  const out = new Map<string, Frame>();
  const { width: W, height: H } = env.deck.size;
  const lost = slide.elements.filter((e): e is ShapeElement | ImageElement => {
    if ((e.type !== "shape" && e.type !== "image") || !e.placeholder) return false;
    if (hasFrame(e)) return false;
    return !hasFrame(matchPlaceholder(env.layout.elements, e.placeholder)) && !hasFrame(matchPlaceholder(env.master.elements, e.placeholder));
  });
  if (lost.length === 0) return out;
  const type = (e: Element) => (e as ShapeElement).placeholder!.type;
  const slots = slide.elements.filter((e) => (e.type === "shape" || e.type === "image") && e.placeholder);
  const cover = slots.some((e) => type(e) === "ctrTitle");
  const titled = slots.some((e) => placeholderFamily(type(e)) === "title");
  const content = lost.filter((e) => {
    const f = placeholderFamily(type(e));
    return f !== "title" && type(e) !== "subTitle" && f !== "dt" && f !== "ftr" && f !== "sldNum";
  });
  for (const e of lost) {
    const t = type(e);
    if (t === "ctrTitle") out.set(e.id, { x: W * 0.08, y: H * 0.26, w: W * 0.84, h: H * 0.24 });
    else if (t === "title") out.set(e.id, { x: W * 0.05, y: H * 0.07, w: W * 0.9, h: H * 0.16 });
    else if (t === "subTitle") out.set(e.id, { x: W * 0.08, y: H * 0.53, w: W * 0.84, h: H * 0.16 });
    else if (t === "dt") out.set(e.id, { x: W * 0.05, y: H * 0.92, w: W * 0.2, h: H * 0.06 });
    else if (t === "ftr") out.set(e.id, { x: W * 0.3, y: H * 0.92, w: W * 0.4, h: H * 0.06 });
    else if (t === "sldNum") out.set(e.id, { x: W * 0.85, y: H * 0.92, w: W * 0.1, h: H * 0.06 });
  }
  const top = titled && !cover ? 0.27 : cover ? 0.5 : 0.07;
  const area = { x: W * 0.05, y: H * top, w: W * 0.9, h: H * (0.9 - top) };
  const gap = W * 0.03;
  const colW = (area.w - gap * (content.length - 1)) / Math.max(1, content.length);
  content.forEach((e, i) => out.set(e.id, { x: area.x + i * (colW + gap), y: area.y, w: colW, h: area.h }));
  return out;
}

/** What a layout or master placeholder says to slides: its own text, unless that is the five style levels or PowerPoint's stock wording. */
function promptOf(text: TextBody | undefined): string {
  if (!text || text.paragraphs.some((p) => (p.level ?? 0) > 0)) return "";
  const lines = text.paragraphs.map(paragraphText);
  return lines.every((l) => STOCK_PROMPT.test(l.trim())) ? "" : lines.join("\n");
}

function resolveElement(el: Element, env: Env, origin: Origin): ResolvedElement {
  const { deck, theme } = env;
  const base = {
    id: el.id,
    from: origin,
    source: el,
    rotation: el.rotation ?? 0,
    flipH: !!el.flipH,
    flipV: !!el.flipV,
    hidden: !!el.hidden,
    placeholder: el.placeholder,
    link: el.link,
    alt: el.alt,
  };
  if (el.type === "shape") {
    const { chain, layoutPh, masterPh } = inherited(el, env, origin);
    const frame = frameOf(el, [layoutPh, masterPh], env);
    const up = [layoutPh, masterPh];
    const isTextBox = !!el.textBox;
    const fillSrc = pickFill("fill", el, up);
    const lineSrc = pickFill("line", el, up);
    const geometry = el.geometry ?? layoutPh?.geometry ?? masterPh?.geometry ?? "rect";
    const custom = el.custom;
    const text = el.text || layoutPh?.text || masterPh?.text ? resolveText(el.text, chain, deck, theme, env.ctx) : undefined;
    const empty = !el.text || el.text.paragraphs.every((p) => paragraphText(p) === "");
    const prompt = el.placeholder && empty ? (promptOf(layoutPh?.text) || promptOf(masterPh?.text) || DEFAULT_PROMPTS[el.placeholder.type]) : undefined;
    return {
      ...base,
      ...frame,
      kind: "shape",
      geometry,
      adjust: { ...masterPh?.adjust, ...layoutPh?.adjust, ...el.adjust },
      ...(custom ? { custom } : {}),
      fill: resolveFill(isTextBox && fillSrc === undefined ? null : (fillSrc ?? null), theme),
      line: resolveLine(lineSrc ?? undefined, theme),
      shadow: resolveShadow(pickFill("shadow", el, up) ?? undefined, theme),
      text,
      prompt: prompt || undefined,
    };
  }
  if (el.type === "image") {
    // A picture in a picture placeholder takes the placeholder's frame and shape (a round frame, say) unless it has its own
    const ph = el.placeholder;
    const layoutPh = ph && origin === "slide" ? matchPlaceholder(env.layout.elements, ph) : undefined;
    const masterPh = ph && origin !== "master" ? matchPlaceholder(env.master.elements, ph) : undefined;
    const frame = frameOf(el, [layoutPh, masterPh], env);
    const custom = el.custom ?? (el.geometry === undefined ? (layoutPh ?? masterPh)?.custom : undefined);
    const geometry = el.geometry ?? (custom ? "custom" : (layoutPh?.geometry ?? masterPh?.geometry ?? "rect"));
    return { ...base, ...frame, kind: "image", geometry, adjust: {}, ...(custom ? { custom } : {}), fill: { kind: "none" }, line: resolveLine(el.line ?? undefined, theme), shadow: resolveShadow(el.shadow, theme), src: el.src, crop: el.crop };
  }
  if (el.type === "table") {
    const frame = frameOf(el, [], env);
    return { ...base, ...frame, kind: "table", geometry: "rect", adjust: {}, fill: { kind: "none" }, line: null, shadow: null, table: resolveTable(el, env) };
  }
  if (el.type === "chart") {
    const frame = frameOf(el, [], env);
    return { ...base, ...frame, kind: "chart", geometry: "rect", adjust: {}, fill: { kind: "none" }, line: null, shadow: null, chart: el };
  }
  const frame = frameOf(el, [], env);
  return { ...base, ...frame, kind: "group", geometry: "rect", adjust: {}, fill: { kind: "none" }, line: null, shadow: null, children: el.children.map((c) => resolveElement(c, env, origin)) };
}

function resolveTable(el: TableElement, env: Env): ResolvedTable {
  const { theme, deck } = env;
  const colX: number[] = [];
  let x = 0;
  for (const w of el.columns) {
    colX.push(x);
    x += w;
  }
  const chain: Chain = { levels: [], bodies: [] };
  let y = 0;
  const rows = el.rows.map((row, ri) => {
    const rowY = y;
    y += row.h;
    return {
      h: row.h,
      y: rowY,
      cells: row.cells.map((cell, ci) => {
        const header = !!el.headerRow && ri === 0;
        const banded = !!el.banded && !header && ri % 2 === 1;
        const defaultFill: Fill | null = cell.fill !== undefined ? cell.fill : header ? { theme: "accent1" } : banded ? { theme: "lt2" } : null;
        const headerMarks: Marks | undefined = header && cell.fill === undefined ? { bold: true, color: { theme: "lt1" } } : undefined;
        const body: TextBody = { paragraphs: header && headerMarks ? cell.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, marks: { ...headerMarks, ...r.marks } })) })) : cell.paragraphs, vAlign: cell.vAlign ?? "top" };
        const span = cell.colSpan ?? 1;
        let w = 0;
        for (let k = 0; k < span; k++) w += el.columns[ci + k] ?? 0;
        let h = row.h;
        for (let k = 1; k < (cell.rowSpan ?? 1); k++) h += el.rows[ri + k]?.h ?? 0;
        // unset is the default thin grey line; null is no line
        const edge = (b: Line | null | undefined): Line | null => (b === undefined ? { width: 0.75, color: "#bfbfbf" } : b);
        const border = (b: Line | null | undefined) => resolveLine(b ?? undefined, theme, "#bfbfbf");
        return {
          text: resolveText(body, chain, deck, theme, env.ctx),
          fill: resolveFill(defaultFill, theme),
          colSpan: span,
          rowSpan: cell.rowSpan ?? 1,
          covered: !!cell.covered,
          borders: { top: border(edge(cell.borders?.top)), right: border(edge(cell.borders?.right)), bottom: border(edge(cell.borders?.bottom)), left: border(edge(cell.borders?.left)) },
          x: colX[ci] ?? 0,
          y: rowY,
          w,
          h,
        };
      }),
    };
  });
  return { columns: el.columns, rows };
}

// ---- Scenes ------------------------------------------------------------------------------------------------------

/** What a slide looks like once everything is inherited: ready for any renderer to draw. */
export function resolveSlide(deck: Deck, slide: Slide, ctx: SceneContext = {}): Scene {
  const found = findLayout(deck, slide.layout) ?? { master: deck.masters[0]!, layout: deck.masters[0]!.layouts[0]! };
  const { master, layout } = found;
  const theme = master.theme;
  const env: Env = { deck, theme, master, layout, ctx };
  env.orphans = orphanFrames(slide, env);
  const elements: ResolvedElement[] = [];
  // Master and layout shapes that are placeholders are templates for slides; only decorations are drawn.
  const background = slide.showMasterElements !== false;
  if (background && layout.showMasterElements !== false) for (const e of master.elements) if (!(e.type === "shape" && e.placeholder)) elements.push(resolveElement(e, env, "master"));
  if (background) for (const e of layout.elements) if (!(e.type === "shape" && e.placeholder)) elements.push(resolveElement(e, env, "layout"));
  for (const e of slide.elements) elements.push(resolveElement(e, env, "slide"));
  return { width: deck.size.width, height: deck.size.height, theme, background: resolveFill(slide.background ?? layout.background ?? master.background ?? "#ffffff", theme), elements };
}

/**
 * A layout or master as it is edited: its own placeholders are drawn too (with their prompt text), on top of the
 * master's decorations.
 */
export function resolveTemplate(deck: Deck, ownerId: string, ctx: SceneContext = {}): Scene {
  const found = findLayout(deck, ownerId);
  const master = found?.master ?? deck.masters.find((m) => m.id === ownerId) ?? deck.masters[0]!;
  const layout = found?.layout;
  const theme = master.theme;
  // A template's elements are resolved as if they were on a slide of their own, so that placeholders show their text.
  const env: Env = { deck, theme, master, layout: layout ?? { id: "", name: "", elements: [] }, ctx };
  const elements: ResolvedElement[] = [];
  if (!layout || layout.showMasterElements !== false) for (const e of master.elements) if (layout ? !(e.type === "shape" && e.placeholder) : true) elements.push(resolveElement(e, env, "master"));
  if (layout) for (const e of layout.elements) elements.push(resolveElement(e, env, "layout"));
  return { width: deck.size.width, height: deck.size.height, theme, background: resolveFill(layout?.background ?? master.background ?? "#ffffff", theme), elements };
}
