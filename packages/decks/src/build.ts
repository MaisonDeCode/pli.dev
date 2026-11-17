import { createId } from "@pli.dev/core";
import type { Color, Deck, Element, Fill, Layout, LayoutKind, LevelStyle, Master, Paragraph, Placeholder, ShapeElement, Slide, SlideSize, TextBody, Theme } from "./model";
import { SIZE_GOOGLE } from "./model";

/** Google Slides' "Simple Light" colours, with Pli's own accent set. */
export const LIGHT_THEME: Theme = {
  name: "Simple Light",
  colors: {
    dk1: "#000000",
    lt1: "#ffffff",
    dk2: "#434343",
    lt2: "#efefef",
    accent1: "#4285f4",
    accent2: "#ea4335",
    accent3: "#fbbc04",
    accent4: "#34a853",
    accent5: "#ff6d01",
    accent6: "#46bdc6",
    hlink: "#1155cc",
    folHlink: "#744da9",
  },
  fonts: { major: "Arial", minor: "Arial" },
};

export interface MasterSpec {
  name: string;
  theme: Theme;
  size: SlideSize;
  background?: Fill;
  /** Title and body sizes in points for a slide as wide as `SIZE_GOOGLE`; scaled for wider slides. */
  titleSize?: number;
  bodySize?: number;
  titleBold?: boolean;
  titleAlign?: "left" | "center" | "right";
  titleColor?: Color;
  bodyColor?: Color;
  /** Shapes drawn on every slide, under the layout's. */
  decorations?: (size: SlideSize) => Element[];
  /** Extra shapes per layout kind. */
  layoutDecorations?: Partial<Record<LayoutKind, (size: SlideSize) => Element[]>>;
  /** Where the title sits: `top` is the Google layout; `middle` centres it vertically in its band. */
  titleAnchor?: "top" | "middle" | "bottom";
  /** Colour of subtitles, footers, dates and slide numbers. Default the theme's `dk2`. */
  mutedColor?: Color;
  /** The bullet characters of the first three levels of body text (they repeat). Default ● ○ ■. */
  bulletChars?: [string, string, string];
  bulletColor?: Color;
  /** Called with the finished master, to adjust what the spec can't say (a layout's background, a placeholder's colour…). */
  tweak?: (master: Master, size: SlideSize) => void;
}

export const newId = (prefix: string): string => createId(prefix);

/** Makes a placeholder element. */
export function placeholder(ph: Placeholder, box: { x: number; y: number; w: number; h: number }, text?: Partial<TextBody>, extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    type: "shape",
    id: newId("e_"),
    geometry: "rect",
    placeholder: ph,
    ...box,
    text: { paragraphs: [{ runs: [] }], ...text },
    ...extra,
  };
}

/** A plain text paragraph list. */
export const paragraphs = (...lines: string[]): Paragraph[] => lines.map((t) => ({ runs: t ? [{ text: t }] : [] }));

/** A shape with text, a rectangle with a fill, and so on, with an id made for it. */
export function shape(geometry: string, box: { x: number; y: number; w: number; h: number }, props: Partial<ShapeElement> = {}): ShapeElement {
  return { type: "shape", id: newId("e_"), geometry, ...box, ...props };
}

const BULLETS = ["●", "○", "■"];

/** The prompt PowerPoint shows in a master's title placeholder. */
export const MASTER_TITLE_PROMPT = "Click to edit Master title style";
/** The five prompt levels of a master's body placeholder: each paragraph is at its own level so that every level's style can be edited. */
export const LEVEL_PROMPTS = ["Click to edit Master text styles", "Second level", "Third level", "Fourth level", "Fifth level"] as const;

/** Stock text of a template's placeholders; it is never a real prompt for slides. */
export const STOCK_PROMPT = /^(click to edit master .*|(second|third|fourth|fifth|sixth|seventh|eighth|ninth) level|edit master .*)$/i;

/** The five paragraphs (levels 0 to 4) of a master body placeholder. */
export const levelPromptParagraphs = (): Paragraph[] => LEVEL_PROMPTS.map((t, i) => ({ ...(i ? { level: i } : {}), runs: [{ text: t }] }));

const hasNoText = (t: TextBody | undefined): boolean => !t || t.paragraphs.every((p) => p.runs.every((r) => r.text === ""));

/**
 * The master (or one of its layouts' lists) with the prompts a person edits styles through: a master title says "Click to
 * edit Master title style" and body placeholders (on the master and its layouts) show five paragraphs at levels 0 to 4,
 * as PowerPoint's Slide Master view does. Placeholders that already have text are left alone. Returns the same object when
 * nothing needed adding.
 */
export function withLevelPrompts(master: Master): Master {
  let changed = false;
  const fix = (e: Element, onMaster: boolean): Element => {
    if (e.type !== "shape" || !e.placeholder || !hasNoText(e.text)) return e;
    const t = e.placeholder.type;
    const isBody = t === "body" || t === "obj";
    if (isBody) {
      // a single-level prompt (list-less caption) still shows the five levels: they are what the styles are edited through
      changed = true;
      return { ...e, text: { ...e.text, paragraphs: levelPromptParagraphs() } };
    }
    if (onMaster && (t === "title" || t === "ctrTitle")) {
      changed = true;
      return { ...e, text: { ...e.text, paragraphs: [{ runs: [{ text: MASTER_TITLE_PROMPT }] }] } };
    }
    return e;
  };
  const elements = master.elements.map((e) => fix(e, true));
  const layouts = master.layouts.map((l) => {
    const els = l.elements.map((e) => fix(e, false));
    return els.some((e, i) => e !== l.elements[i]) ? { ...l, elements: els } : l;
  });
  return changed ? { ...master, elements, layouts } : master;
}

/** The same master with fresh ids, so it can be added to a deck that already has the original. */
export function withFreshIds(master: Master): Master {
  const copy = JSON.parse(JSON.stringify(master)) as Master;
  copy.id = newId("m_");
  for (const l of copy.layouts) l.id = newId("l_");
  const fresh = (els: Element[]) => {
    for (const e of els) {
      e.id = newId("e_");
      if (e.type === "group") fresh(e.children);
    }
  };
  fresh(copy.elements);
  for (const l of copy.layouts) fresh(l.elements);
  return copy;
}

function bodyLevels(size: number, color: Color | undefined, bullets: readonly string[] = BULLETS, bulletColor?: Color): Record<number, LevelStyle> {
  const levels: Record<number, LevelStyle> = {};
  for (let i = 0; i < 9; i++) {
    levels[i] = {
      marks: { fontSize: Math.max(10, size - Math.min(i, 3) * 2), ...(color ? { color } : {}) },
      marL: 18 * (i + 1) + 0,
      indent: -14,
      bullet: { type: "char", char: bullets[i % 3]!, size: 100, ...(bulletColor ? { color: bulletColor } : {}) },
      spaceBefore: i === 0 ? 0 : 4,
      spaceAfter: 0,
      lineSpacing: 1.15,
      align: "left",
    };
  }
  return levels;
}

/** The standard family of layouts, drawn to the size of the slide. */
export function buildMaster(spec: MasterSpec): Master {
  const { size } = spec;
  const k = size.width / SIZE_GOOGLE.width;
  const W = size.width;
  const H = size.height;
  const m = 36 * k;
  const titleSize = (spec.titleSize ?? 32) * k;
  const bodySize = (spec.bodySize ?? 16) * k;
  const align = spec.titleAlign ?? "left";
  const anchor = spec.titleAnchor ?? "top";
  const masterId = newId("m_");
  const titleStyle: Record<number, LevelStyle> = {
    0: { marks: { fontSize: titleSize, fontFamily: "+mj-lt", bold: !!spec.titleBold, ...(spec.titleColor ? { color: spec.titleColor } : {}) }, align, lineSpacing: 1, bullet: null, marL: 0, indent: 0 },
  };
  const other: Record<number, LevelStyle> = { 0: { marks: { fontSize: 12 * k } } };
  const muted: Color = spec.mutedColor ?? { theme: "dk2" };
  const small = { levels: { 0: { marks: { fontSize: 10 * k, color: muted }, align: "right" as const, bullet: null } } };

  const titleBox = { x: m, y: 22 * k, w: W - 2 * m, h: 64 * k };
  const bodyBox = { x: m, y: 98 * k, w: W - 2 * m, h: H - 98 * k - 40 * k };
  const T = (box = titleBox, vAlign: "top" | "middle" | "bottom" = anchor, type: "title" | "ctrTitle" = "title") => placeholder({ type }, box, { vAlign });
  const B = (box = bodyBox, idx?: number, type: "body" | "subTitle" = "body") => placeholder(idx === undefined ? { type } : { type, idx }, box);

  const masterElements: Element[] = [
    ...(spec.decorations?.(size) ?? []),
    T(),
    B(),
    placeholder({ type: "dt", idx: 10 }, { x: m, y: H - 30 * k, w: 150 * k, h: 20 * k }, { levels: { 0: { marks: { fontSize: 10 * k, color: muted }, align: "left", bullet: null } } }),
    placeholder({ type: "ftr", idx: 11 }, { x: W / 2 - 150 * k, y: H - 30 * k, w: 300 * k, h: 20 * k }, { levels: { 0: { marks: { fontSize: 10 * k, color: muted }, align: "center", bullet: null } } }),
    placeholder({ type: "sldNum", idx: 12 }, { x: W - m - 60 * k, y: H - 30 * k, w: 60 * k, h: 20 * k }, small),
  ];

  const extra = (kind: LayoutKind) => spec.layoutDecorations?.[kind]?.(size) ?? [];
  const layout = (kind: LayoutKind, name: string, elements: Element[]): Layout => ({ id: newId("l_"), name, kind, elements: [...extra(kind), ...elements] });
  const half = (W - 2 * m - 24 * k) / 2;
  // The caption layout sits low on the slide but must end above the footers, whatever the slide's height.
  const captionY = Math.min(H * 0.62, H - 38 * k - 166 * k);
  const sectionTitle = { x: m, y: H * 0.3, w: W * 0.7, h: 80 * k };

  const layouts: Layout[] = [
    layout("title", "Title slide", [
      placeholder({ type: "ctrTitle" }, { x: m, y: H * 0.24, w: W - 2 * m, h: 100 * k }, { vAlign: "bottom", levels: { 0: { marks: { fontSize: titleSize * 1.5 } } } }),
      placeholder({ type: "subTitle", idx: 1 }, { x: m, y: H * 0.24 + 112 * k, w: W - 2 * m, h: 60 * k }, { levels: { 0: { marks: { fontSize: bodySize * 1.4, color: muted }, bullet: null, marL: 0, indent: 0 } } }),
    ]),
    layout("titleAndBody", "Title and body", [T(), B(bodyBox, 1)]),
    layout("sectionHeader", "Section header", [
      placeholder({ type: "title" }, sectionTitle, { vAlign: "bottom", levels: { 0: { marks: { fontSize: titleSize * 1.4 } } } }),
      placeholder({ type: "body", idx: 1 }, { x: m, y: H * 0.3 + 92 * k, w: W * 0.7, h: 50 * k }, { levels: { 0: { marks: { fontSize: bodySize * 1.2, color: muted }, bullet: null, marL: 0, indent: 0 } } }),
    ]),
    layout("titleAndTwoColumns", "Title and two columns", [
      T(),
      B({ x: m, y: bodyBox.y, w: half, h: bodyBox.h }, 1),
      B({ x: m + half + 24 * k, y: bodyBox.y, w: half, h: bodyBox.h }, 2),
    ]),
    layout("titleOnly", "Title only", [T()]),
    layout("oneColumnText", "One column text", [
      T({ x: m, y: 22 * k, w: W * 0.3, h: H - 70 * k }, "top"),
      B({ x: m + W * 0.3 + 24 * k, y: 22 * k, w: W - 2 * m - W * 0.3 - 24 * k, h: H - 70 * k }, 1),
    ]),
    layout("captionLeft", "Caption", [
      placeholder({ type: "title" }, { x: m, y: captionY, w: W * 0.36, h: 90 * k }, { vAlign: "top", levels: { 0: { marks: { fontSize: titleSize * 0.8 } } } }),
      placeholder({ type: "body", idx: 1 }, { x: m, y: captionY + 96 * k, w: W * 0.36, h: 70 * k }, { levels: { 0: { bullet: null, marL: 0, indent: 0, marks: { fontSize: bodySize * 0.9 } } } }),
    ]),
    layout("bigNumber", "Big number", [
      placeholder({ type: "title" }, { x: m, y: H * 0.18, w: W - 2 * m, h: 130 * k }, { vAlign: "bottom", levels: { 0: { marks: { fontSize: titleSize * 3.6 }, align: "center" } } }),
      placeholder({ type: "body", idx: 1 }, { x: m, y: H * 0.18 + 140 * k, w: W - 2 * m, h: 60 * k }, { levels: { 0: { bullet: null, marL: 0, indent: 0, align: "center", marks: { fontSize: bodySize * 1.3 } } } }),
    ]),
    layout("blank", "Blank", []),
  ];

  // The first layout's text is bigger, so the generic title style stays at titleSize.
  const master: Master = {
    id: masterId,
    name: spec.name,
    theme: spec.theme,
    background: spec.background ?? { theme: "lt1" },
    elements: masterElements,
    textStyles: { title: titleStyle, body: bodyLevels(bodySize, spec.bodyColor, spec.bulletChars, spec.bulletColor), other },
    layouts,
  };
  spec.tweak?.(master, size);
  return withLevelPrompts(master);
}

export interface CreateDeckOptions {
  title?: string;
  size?: SlideSize;
  /** A master to start from; the default is Pli's "Simple Light". */
  master?: Master;
  /** Make the first slide (a title slide). Default true. */
  firstSlide?: boolean;
}

/** Makes the slide a layout starts from: its placeholders, empty and linked to the layout. */
export function slideFromLayout(layout: Layout, id: string = newId("s_")): Slide {
  const elements: Element[] = layout.elements
    .filter((e): e is ShapeElement => e.type === "shape" && !!e.placeholder && e.placeholder.type !== "dt" && e.placeholder.type !== "ftr" && e.placeholder.type !== "sldNum")
    .map((e) => ({ type: "shape", id: newId("e_"), geometry: "rect", placeholder: { ...e.placeholder! }, text: { paragraphs: [{ runs: [] }] } }));
  return { id, layout: layout.id, elements, notes: "" };
}

export function createDeck(options: CreateDeckOptions = {}): Deck {
  const size = options.size ?? SIZE_GOOGLE;
  const master = options.master ?? buildMaster({ name: "Simple Light", theme: LIGHT_THEME, size });
  const deck: Deck = { type: "deck", id: newId("d_"), title: options.title ?? "Untitled presentation", size, masters: [master], slides: [] };
  if (options.firstSlide !== false) deck.slides.push(slideFromLayout(master.layouts[0]!));
  return deck;
}
