/**
 * The deck model is plain JSON: no classes, no DOM, no platform types. That keeps it serializable and identical on
 * every platform. Lengths are in points (1/72 inch) from the slide's top left corner; angles in degrees.
 *
 * A deck holds **masters** (what Google Slides calls a theme: colours, fonts, a background, shared shapes and text
 * styles) and each master holds its **layouts** (the arrangements of placeholders a slide can take). A slide picks a
 * layout by id. A placeholder on a slide is linked to the layout placeholder of the same type and index, which is
 * linked to the master's; whatever the slide leaves unset is inherited down that chain (see `resolve.ts`).
 */

// ---- Colour and paint --------------------------------------------------------------------------------------------

/** The twelve slots of a theme's colour scheme. `dk1` and `lt1` are the main text and background colours. */
export type ThemeSlot = "dk1" | "lt1" | "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6" | "hlink" | "folHlink";

export const THEME_SLOTS: readonly ThemeSlot[] = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/** A colour taken from the theme, optionally lightened or darkened (the way PowerPoint's "Lighter 40%" works). */
export interface ThemeColor {
  theme: ThemeSlot;
  /** Multiplies the colour's lightness (HSL). 0.75 darkens to three quarters. */
  lumMod?: number;
  /** Added to the lightness after `lumMod` (0..1). 0.4 with `lumMod` 0.6 is "Lighter 40%". */
  lumOff?: number;
  /** Mixes toward white by this fraction (0..1). */
  tint?: number;
  /** Mixes toward black by this fraction (0..1). */
  shade?: number;
  /** Opacity, 0..1. */
  alpha?: number;
}

/** `#rrggbb` (or `#rrggbbaa`), or a colour of the theme. */
export type Color = string | ThemeColor;

export interface GradientStop {
  /** 0..1 along the gradient. */
  at: number;
  color: Color;
}

export interface Gradient {
  kind?: "linear" | "radial";
  /** Direction in degrees, clockwise from left-to-right, for a linear gradient. */
  angle?: number;
  /** For a radial gradient: where it is centred, as fractions of the shape (0..1; default 0.5, 0.5). It reaches out to the farthest corner. */
  center?: { x: number; y: number };
  stops: GradientStop[];
}

export interface ImageFill {
  /** A `data:` URI or a URL. */
  src: string;
  /** `stretch` fills the shape, `tile` repeats it. Default `stretch`. */
  mode?: "stretch" | "tile";
  /** How much of the picture is cut off at each edge, as fractions (0..1). */
  crop?: Crop;
  alpha?: number;
}

/** Solid colour, gradient or picture. `null` where a fill is allowed means no fill, unset means inherit. */
export type Fill = Color | { gradient: Gradient } | { image: ImageFill };

export type DashStyle = "solid" | "dot" | "dash" | "dashDot" | "longDash" | "longDashDot" | "sysDot" | "sysDash";
export type ArrowEnd = "none" | "triangle" | "stealth" | "diamond" | "oval" | "open";

export interface Line {
  color?: Color;
  /** Width in points. */
  width?: number;
  dash?: DashStyle;
  head?: ArrowEnd;
  tail?: ArrowEnd;
  cap?: "flat" | "round" | "square";
  join?: "round" | "bevel" | "miter";
}

export interface Shadow {
  color?: Color;
  blur?: number;
  dx?: number;
  dy?: number;
}

export interface Crop {
  l?: number;
  t?: number;
  r?: number;
  b?: number;
}

// ---- Text --------------------------------------------------------------------------------------------------------

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Text colour. */
  color?: Color;
  /** Highlight colour behind the text. */
  highlight?: Color;
  /** A font family, or `+mj-lt` (the theme's heading font) or `+mn-lt` (its body font). */
  fontFamily?: string;
  /** Size in points. */
  fontSize?: number;
  /** A hyperlink target. */
  link?: string;
  /** Raised (`super`), lowered (`sub`) or by a percentage of the size (positive raises). */
  baseline?: "super" | "sub" | number;
  allCaps?: boolean;
  smallCaps?: boolean;
  /** Extra space between letters, in points. */
  letterSpacing?: number;
  /** A field the run shows instead of its text; the run's text is the last value it had. */
  field?: "slideNumber" | "date" | "slideCount";
  /**
   * The ids of the comment threads attached to this text (see `Deck.comments` and `DeckSession.comments`). The thread
   * itself lives where comments are stored; the text keeps only where it is attached, so the highlight follows the
   * words when people edit around them.
   */
  comment?: string[];
}

export interface Run {
  text: string;
  marks?: Marks;
}

export type BulletScheme =
  | "arabicPeriod"
  | "arabicParenR"
  | "alphaLcPeriod"
  | "alphaUcPeriod"
  | "romanLcPeriod"
  | "romanUcPeriod";

export type Bullet =
  | { type: "char"; char: string; color?: Color; size?: number; font?: string }
  | { type: "number"; scheme: BulletScheme; start?: number; color?: Color };

export type Align = "left" | "center" | "right" | "justify";

/** Paragraph properties. Every field is optional: unset fields are inherited. */
export interface ParaProps {
  align?: Align;
  /** Left margin of the paragraph, in points. */
  marL?: number;
  /** First line indent relative to `marL` (negative hangs the bullet). */
  indent?: number;
  /** `null` is no bullet; unset inherits. */
  bullet?: Bullet | null;
  /** Space above and below, in points. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** Line height as a multiple of the font size (1.15 is Google Slides' default). */
  lineSpacing?: number;
  rtl?: boolean;
}

export interface Paragraph extends ParaProps {
  /** Outline level 0..8; picks which level of the inherited text styles applies. */
  level?: number;
  runs: Run[];
  /** The marks that the paragraph's end mark carries; used to size an empty paragraph. */
  endMarks?: Marks;
}

/** What a level of a text style sets: character marks and paragraph properties together. */
export interface LevelStyle extends ParaProps {
  marks?: Marks;
}

export interface TextBody {
  paragraphs: Paragraph[];
  vAlign?: "top" | "middle" | "bottom";
  /** Space between the shape's edge and its text, in points. Default 7.2 left and right, 3.6 top and bottom. */
  insets?: { l?: number; t?: number; r?: number; b?: number };
  /** `shrink` scales text down to fit, `resize` grows the shape to the text, `none` lets it overflow. */
  autofit?: "none" | "shrink" | "resize";
  /** Wrap text at the shape's width. Default true. */
  wrap?: boolean;
  /** Per-level text style for this shape (set on layout and master placeholders and inherited by slides). */
  levels?: Record<number, LevelStyle>;
}

// ---- Elements ----------------------------------------------------------------------------------------------------

export type PlaceholderType =
  | "title"
  | "ctrTitle"
  | "subTitle"
  | "body"
  | "dt"
  | "ftr"
  | "sldNum"
  | "pic"
  | "chart"
  | "tbl"
  | "obj"
  | "media"
  | "clipArt"
  | "dgm"
  | "hdr"
  | "sldImg";

export interface Placeholder {
  type: PlaceholderType;
  /** Tells apart placeholders of one type on a layout (two bodies). */
  idx?: number;
}

interface ElementBase {
  id: string;
  name?: string;
  /** Position and size in points. Unset on a placeholder means "take it from the layout". */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** Not drawn (still selectable in the editor's outline). */
  hidden?: boolean;
  locked?: boolean;
  /** Alternative text for screen readers. */
  alt?: string;
  /** Makes the whole element a link. */
  link?: string;
  placeholder?: Placeholder;
}

// ---- Custom geometry ---------------------------------------------------------------------------------------------

/**
 * A number, or the name of a guide (a built-in such as `w`, `hc`, `ss`, one of the geometry's `adjust` values, or one of
 * its `guides`). Guide values are in the units of the path they are used in.
 */
export type GuideRef = number | string;

/**
 * One drawing command of a custom path, in the path's own coordinate space (`CustomPath.w` by `.h`). Arcs follow
 * OOXML's `arcTo`: the current point is on an ellipse of radii `wR` and `hR` at the angle `stAng`, and the arc sweeps
 * `swAng` clockwise (negative: counterclockwise). Angles are in 60000ths of a degree, as PowerPoint stores them.
 */
export type CustomCommand =
  | ["M", GuideRef, GuideRef]
  | ["L", GuideRef, GuideRef]
  | ["C", GuideRef, GuideRef, GuideRef, GuideRef, GuideRef, GuideRef]
  | ["Q", GuideRef, GuideRef, GuideRef, GuideRef]
  | ["A", GuideRef, GuideRef, GuideRef, GuideRef]
  | ["Z"];

export interface CustomPath {
  /**
   * The width and height of the space the commands use; the path is scaled to the element's box. 0 means the path is
   * drawn in the element's own EMU space (12700 per point), which is what a path made of guides wants.
   */
  w: number;
  h: number;
  /** `none` is stroke only; `lighten` and friends fill with a lighter or darker shade. Default `norm`. */
  fill?: "norm" | "none" | "lighten" | "lightenLess" | "darken" | "darkenLess";
  /** `false` leaves the path unstroked. Default true. */
  stroke?: boolean;
  commands: CustomCommand[];
}

/** A freeform outline (PowerPoint's `custGeom`): plain JSON, so it is invertible by `replace_element` and survives a round trip. */
export interface CustomGeometry {
  paths: CustomPath[];
  /** Adjustment values by guide name (PowerPoint's `avLst`: constants other formulas and commands can use). */
  adjust?: Record<string, number>;
  /** Named formulas in OOXML's own text (`+- r 0 x1`, `val 100`, a multiply-divide…), evaluated in order against the element's size in EMU. */
  guides?: { name: string; fmla: string }[];
  /** Where text goes, in the element's EMU space (numbers) or as guides. Default: the whole box. */
  rect?: { l: GuideRef; t: GuideRef; r: GuideRef; b: GuideRef };
}

/** Any shape from the preset catalogue (`rect`, `ellipse`, `rightArrow`, `line`…) with an optional text body. */
export interface ShapeElement extends ElementBase {
  type: "shape";
  /** A preset name, or `custom` for a shape with `custom` geometry. */
  geometry: string;
  /** A freeform outline. When set it wins over `geometry`. */
  custom?: CustomGeometry;
  /** The preset's adjustment handles by name (`adj`, `adj1`…), as PowerPoint stores them (0..100000 scale). */
  adjust?: Record<string, number>;
  /** `null` is no fill, unset inherits (and is no fill for a free shape). */
  fill?: Fill | null;
  line?: Line | null;
  shadow?: Shadow | null;
  text?: TextBody;
  /** Made with the text box tool: no fill and no line unless set, and it grows with its text. */
  textBox?: boolean;
}

export interface ImageElement extends ElementBase {
  type: "image";
  /** A `data:` URI or a URL. */
  src: string;
  crop?: Crop;
  /** Mask the picture to a preset shape (`ellipse`, `roundRect`…). */
  geometry?: string;
  /** Mask the picture to a freeform outline. When set it wins over `geometry`. */
  custom?: CustomGeometry;
  line?: Line | null;
  shadow?: Shadow | null;
}

export interface TableCell {
  paragraphs: Paragraph[];
  fill?: Fill | null;
  colSpan?: number;
  rowSpan?: number;
  /** A grid square covered by another cell's span: no content and not drawn. */
  covered?: true;
  vAlign?: "top" | "middle" | "bottom";
  borders?: { top?: Line | null; right?: Line | null; bottom?: Line | null; left?: Line | null };
}

export interface TableRow {
  /** Height in points; grows to fit the text. */
  h: number;
  cells: TableCell[];
}

export interface TableElement extends ElementBase {
  type: "table";
  /** Column widths in points. */
  columns: number[];
  rows: TableRow[];
  /** Style the first row as a header. */
  headerRow?: boolean;
  /** Shade alternate rows. */
  banded?: boolean;
}

// ---- Charts --------------------------------------------------------------------------------------------------------

/** What a chart draws. `column` and `bar` are vertical and horizontal bars; a combination chart sets a series' own `type`. */
export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";

/** How the series of a bar, line or area chart are put together. */
export type ChartGrouping = "clustered" | "stacked" | "percentStacked";

export const CHART_TYPES: readonly ChartType[] = ["column", "bar", "line", "area", "pie", "doughnut", "scatter"];

export interface ChartSeries {
  name: string;
  /** One value per category (a blank is `null`). For a scatter chart these are the Y values. */
  values: (number | null)[];
  /** Scatter charts: the X value of each point (default 1, 2, 3...). */
  x?: number[];
  /** The series' colour; by default the theme's accent colours in turn. */
  color?: Color;
  /** Pie and doughnut charts: a colour for each slice. */
  pointColors?: Color[];
  /** In a combination chart: how this series is drawn (the chart's own type is the default). Only `column`, `line` and `area` combine. */
  type?: "column" | "line" | "area";
  /** Lines: curve through the points instead of straight segments. */
  smooth?: boolean;
  /** Lines and scatter points: draw a marker on each point. */
  marker?: boolean;
  /** Lines: width in points (default 2.25). */
  lineWidth?: number;
  /** Scatter: join the points with a line (default no). */
  line?: boolean;
}

export interface ChartAxis {
  /** Don't draw the axis (its labels, line and ticks); gridlines stay unless turned off. */
  hidden?: boolean;
  /** Fixed ends of a value axis. */
  min?: number;
  max?: number;
  /** The distance between labelled steps of a value axis. */
  majorUnit?: number;
  /** A number format such as `0.0`, `#,##0`, `0%` or `$#,##0.00`; `General` (default) shows the number as it is. */
  format?: string;
  /** Lines across the plot at each step (default: on for the value axis, off for the category axis). */
  gridlines?: boolean;
  /** The colour of the gridlines (default: the text colour, faint). */
  gridColor?: Color;
  title?: string;
  /** The axis line; `null` hides it. */
  line?: Color | null;
}

export interface ChartDataLabels {
  value?: boolean;
  /** Pie and doughnut: the share of the whole. */
  percent?: boolean;
  category?: boolean;
  series?: boolean;
  /** A number format for the values. */
  format?: string;
  /** Where on a bar the label goes; others ignore it. Default: outside a clustered bar, centred in a stacked one. */
  position?: "outside" | "inside" | "center";
}

export type ChartLegend = "top" | "bottom" | "left" | "right" | "none";

/** A chart with its data inline: categories, series and how to draw them. Plain JSON. */
export interface ChartElement extends ElementBase {
  type: "chart";
  chartType: ChartType;
  /** Column, bar, line and area. Default `clustered`. */
  grouping?: ChartGrouping;
  /** The label of each category (the X axis of a column chart). Scatter charts have none. */
  categories: string[];
  series: ChartSeries[];
  /** The chart title; `null` or unset is none. */
  title?: string | null;
  titleSize?: number;
  /** Default: at the bottom, and none for a chart with a single series. */
  legend?: ChartLegend;
  /** The category axis (for a scatter chart: the horizontal value axis). */
  categoryAxis?: ChartAxis;
  /** The value axis (the vertical one, or the horizontal one of a `bar` chart). */
  valueAxis?: ChartAxis;
  /** `null` or unset is no data labels. */
  dataLabels?: ChartDataLabels | null;
  /** The gap between groups of bars, as a percentage of a bar's width (default 150). */
  gapWidth?: number;
  /** How far bars of one group overlap, in percent (default 0 clustered, 100 stacked). */
  overlap?: number;
  /** Lines: curve all of them (a series' `smooth` wins). */
  smooth?: boolean;
  /** Lines: markers on all points (a series' `marker` wins). Default on for scatter only. */
  markers?: boolean;
  /** Doughnut: the size of the hole in percent of the radius (default 55). */
  holeSize?: number;
  /** Pie and doughnut: where the first slice starts, in degrees clockwise from the top. */
  firstSliceAngle?: number;
  /** Colour and size of the chart's text. */
  textColor?: Color;
  textSize?: number;
  fontFamily?: string;
  /** The chart area's fill; unset or `null` is transparent. */
  fill?: Color | null;
  /** The plot area's fill; unset or `null` is transparent. */
  plotFill?: Color | null;
}

/** Children use slide coordinates, so moving a group moves them; the group's box is their bounds. */
export interface GroupElement extends ElementBase {
  type: "group";
  children: Element[];
}

export type Element = ShapeElement | ImageElement | TableElement | ChartElement | GroupElement;

// ---- Masters, layouts and slides --------------------------------------------------------------------------------

export interface Theme {
  name: string;
  /** `#rrggbb` for each slot. */
  colors: Record<ThemeSlot, string>;
  fonts: { major: string; minor: string };
}

export type LayoutKind =
  | "title"
  | "titleAndBody"
  | "sectionHeader"
  | "titleAndTwoColumns"
  | "titleOnly"
  | "oneColumnText"
  | "captionLeft"
  | "bigNumber"
  | "blank"
  | "custom";

export interface Layout {
  id: string;
  name: string;
  kind?: LayoutKind;
  background?: Fill;
  /** Placeholders (which slides link to) and plain decorations. */
  elements: Element[];
  /** Draw the master's non-placeholder shapes under this layout. Default true. */
  showMasterElements?: boolean;
}

/** Text styles shared by every slide of a master: titles, body text and everything else. */
export interface MasterTextStyles {
  title: Record<number, LevelStyle>;
  body: Record<number, LevelStyle>;
  other: Record<number, LevelStyle>;
}

export interface Master {
  id: string;
  name: string;
  theme: Theme;
  background?: Fill;
  /** Placeholders (title, body, date, footer, number) and decorations drawn on every slide. */
  elements: Element[];
  textStyles: MasterTextStyles;
  layouts: Layout[];
}

export type TransitionType = "none" | "fade" | "dissolve" | "slide" | "push" | "wipe" | "flip" | "cube" | "gallery" | "zoom";

export interface Transition {
  type: TransitionType;
  /** Where it moves from, for `slide`, `push`, `wipe`, `flip`, `cube` and `gallery`. */
  direction?: "left" | "right" | "up" | "down";
  /** Milliseconds. */
  duration?: number;
  /** Advance on its own after this many milliseconds. */
  advanceAfter?: number;
}

/** What an animation does with its element: it comes in (`entrance`), draws attention (`emphasis`) or goes away (`exit`). */
export type AnimationClass = "entrance" | "emphasis" | "exit";

/**
 * `appear`, `fade`, `fly` (from or to `direction`), `zoom`, `wipe` (from `direction`) and `spin` are entrances/exits;
 * `spin`, `pulse` and `grow` (to `amount` times the size) are emphasis; `motion` moves the element along `path` (any class is
 * allowed but it is an emphasis in effect).
 */
export type AnimationKind = "appear" | "fade" | "fly" | "zoom" | "wipe" | "spin" | "pulse" | "grow" | "motion";

/** `onClick` starts a new step of the slideshow; `withPrevious` starts with the one before; `afterPrevious` when the one before ends. */
export type AnimationTrigger = "onClick" | "withPrevious" | "afterPrevious";

export type AnimationEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface Animation {
  id: string;
  /** The id of a top-level element of the slide. */
  target: string;
  class: AnimationClass;
  kind: AnimationKind;
  /** Where `fly` and `wipe` come from (or go to, for exits). Default `down` for fly, `left` for wipe. */
  direction?: "left" | "right" | "up" | "down";
  /** Default `onClick`. The first animation of a slide that is `withPrevious` or `afterPrevious` starts when the slide appears. */
  trigger?: AnimationTrigger;
  /** Milliseconds. Default 500. */
  duration?: number;
  /** Milliseconds before it starts. */
  delay?: number;
  easing?: AnimationEasing;
  /** How many times it runs, 1 by default. */
  repeat?: number;
  /** For text: `paragraph` brings paragraphs in one after another (each on click, with the same trigger as the first otherwise). Default all at once. */
  text?: "all" | "paragraph";
  /** `spin`: degrees (360). `grow`/`pulse`: the scale reached (1.5 / 1.1). */
  amount?: number;
  /** `motion`: the points of the path, in points from where the element is (the first is 0,0), joined by straight lines. */
  path?: { x: number; y: number }[];
}

export interface Slide {
  id: string;
  /** The id of one of the layouts of the deck's masters. */
  layout: string;
  name?: string;
  background?: Fill;
  /** In drawing order, the last on top. */
  elements: Element[];
  /** Speaker notes: plain text, paragraphs split by newlines. */
  notes: string;
  transition?: Transition;
  /** What happens to elements while presenting, in order: a timeline of animations. */
  animations?: Animation[];
  /** Skipped when presenting. */
  skipped?: boolean;
  /** `false` hides the master's and the layout's decorations on this slide (PowerPoint's "Hide background graphics"). Placeholders are unaffected. */
  showMasterElements?: boolean;
}

export interface SlideSize {
  width: number;
  height: number;
}

export interface Deck {
  type: "deck";
  id: string;
  title: string;
  size: SlideSize;
  masters: Master[];
  slides: Slide[];
  /** Text style for text that isn't in a placeholder, by level. */
  defaultTextStyle?: Record<number, LevelStyle>;
  /**
   * Comment threads saved in the deck itself, by id (and in the `.pptx` file as comments). This is one place to keep
   * them; the other is a store of your own (see `DeckSession.comments`).
   */
  comments?: Record<string, import("@pli.dev/core").Thread<DeckAnchor>>;
}

/**
 * Where a comment thread is attached. `slide` is always set. With `element` the thread is about that element; with `text`
 * too, about words inside it (the words are marked with `Marks.comment`, which is where they are now; `from` and `to` are
 * only where they were when the comment was made, in the element's text counting a paragraph break as one character).
 * `point` is a place on the slide, for a comment that is about the slide itself. A thread whose slide, element or words
 * were deleted stays and is shown as an orphan on what is left (on its slide, or with the deleted slides).
 */
export interface DeckAnchor {
  slide: string;
  element?: string;
  /** Words inside a text element, or inside a table cell (`cell`: `[row, column]`). */
  text?: { from: number; to: number; cell?: [number, number] };
  /** A place on the slide in points from its top left. */
  point?: { x: number; y: number };
  /** The commented words or the element's text, kept short, so the thread makes sense after they change. */
  quote?: string;
}

/** 16:9, the default of PowerPoint (13.333 by 7.5 inches). */
export const SIZE_WIDESCREEN: SlideSize = { width: 960, height: 540 };
/** Google Slides' 16:9 (10 by 5.625 inches). */
export const SIZE_GOOGLE: SlideSize = { width: 720, height: 405 };
/** 4:3 (10 by 7.5 inches). */
export const SIZE_STANDARD: SlideSize = { width: 720, height: 540 };

export const SLIDE_SIZES: Record<string, SlideSize> = {
  "Widescreen (16:9)": SIZE_WIDESCREEN,
  "Google (16:9)": SIZE_GOOGLE,
  "Standard (4:3)": SIZE_STANDARD,
};

export const isShape = (e: Element): e is ShapeElement => e.type === "shape";
export const isImage = (e: Element): e is ImageElement => e.type === "image";
export const isTable = (e: Element): e is TableElement => e.type === "table";
export const isChart = (e: Element): e is ChartElement => e.type === "chart";
export const isGroup = (e: Element): e is GroupElement => e.type === "group";
