import { isOfficeFont, officeSubstitute } from "@pli.dev/core";
import { LIGHT_THEME, buildMaster } from "../build";
import { isSymbolFont, mapFonts } from "../fonts";
import type { ChartElement, CustomGeometry, Deck, Element, GroupElement, ImageElement, Layout, LayoutKind, LevelStyle, Master, Paragraph, Placeholder, ShapeElement, Slide, TableCell, TableElement, TextBody, Theme, Transition } from "../model";
import { THEME_SLOTS } from "../model";
import { matchPlaceholder } from "../resolve";
import {
  custGeomXml,
  NS_ALL,
  attrs,
  blipFillXml,
  blipXml,
  effectXml,
  emu,
  fillXml,
  fontXml,
  hlinkClick,
  lineXml,
  listStyleXml,
  tag,
  txBodyXml,
  type Env,
  type Origin,
  type PptxOptions,
  type WriterContext,
} from "./emit";
import { CT, OpcPackage, Part, REL, XML_DECL, xmlEscape } from "./opc";
import { addChartParts, CHART_URI } from "./chartxml";
import { addCommentParts, slideHasThreads, type SlideForComments } from "./comments";
import { timingXml, type TimingTarget } from "./timing";

export type { PptxOptions } from "./emit";

/**
 * Writes a deck as a PPTX file: the package PowerPoint and Google Slides open. Masters become slide masters with their
 * themes, layouts become slide layouts, placeholders keep their link to the layout (and so inherit position and text
 * style from it), and everything else (shapes, text, pictures, tables, groups, notes, transitions) is written with
 * the element order of ECMA-376, which PowerPoint insists on.
 *
 * The bytes depend only on the deck and `options.date`.
 */
export function toPptx(deck: Deck, options: PptxOptions = {}): Uint8Array {
  return build(deck, options, false);
}

/** The same package as a template (`.potx`): the masters and layouts of the deck, and no slides. */
export function toPotx(deck: Deck, options: PptxOptions = {}): Uint8Array {
  return build(deck, options, true);
}

// ---- Constants ---------------------------------------------------------------------------------------------------

const FIRST_MASTER_ID = 2147483648;
const FIRST_SLIDE_ID = 256;
const NOTES_W = 6858000;
const NOTES_H = 9144000;

/** Every `ST_ShapeType` of ECMA-376: PowerPoint asks to repair a file that names any other preset. */
export const PRESET_NAMES: ReadonlySet<string> = new Set(
  (
    "line lineInv triangle rtTriangle rect diamond parallelogram trapezoid nonIsoscelesTrapezoid pentagon hexagon heptagon octagon decagon dodecagon star4 star5 star6 star7 star8 star10 star12 star16 star24 star32 " +
    "roundRect round1Rect round2SameRect round2DiagRect snipRoundRect snip1Rect snip2SameRect snip2DiagRect plaque ellipse teardrop homePlate chevron pieWedge pie blockArc donut noSmoking rightArrow leftArrow upArrow downArrow " +
    "stripedRightArrow notchedRightArrow bentUpArrow leftRightArrow upDownArrow leftUpArrow leftRightUpArrow quadArrow leftArrowCallout rightArrowCallout upArrowCallout downArrowCallout leftRightArrowCallout upDownArrowCallout " +
    "quadArrowCallout bentArrow uturnArrow circularArrow leftCircularArrow leftRightCircularArrow curvedRightArrow curvedLeftArrow curvedUpArrow curvedDownArrow swooshArrow cube can lightningBolt heart sun moon smileyFace " +
    "irregularSeal1 irregularSeal2 foldedCorner bevel frame halfFrame corner diagStripe chord arc leftBracket rightBracket leftBrace rightBrace bracketPair bracePair straightConnector1 bentConnector2 bentConnector3 bentConnector4 " +
    "bentConnector5 curvedConnector2 curvedConnector3 curvedConnector4 curvedConnector5 callout1 callout2 callout3 accentCallout1 accentCallout2 accentCallout3 borderCallout1 borderCallout2 borderCallout3 accentBorderCallout1 " +
    "accentBorderCallout2 accentBorderCallout3 wedgeRectCallout wedgeRoundRectCallout wedgeEllipseCallout cloudCallout cloud ribbon ribbon2 ellipseRibbon ellipseRibbon2 leftRightRibbon verticalScroll horizontalScroll wave " +
    "doubleWave plus flowChartProcess flowChartAlternateProcess flowChartDecision flowChartInputOutput flowChartPredefinedProcess flowChartInternalStorage flowChartDocument flowChartMultidocument flowChartTerminator " +
    "flowChartPreparation flowChartManualInput flowChartManualOperation flowChartConnector flowChartOffpageConnector flowChartPunchedCard flowChartPunchedTape flowChartSummingJunction flowChartOr flowChartCollate flowChartSort " +
    "flowChartExtract flowChartMerge flowChartOnlineStorage flowChartDelay flowChartMagneticTape flowChartMagneticDisk flowChartMagneticDrum flowChartDisplay actionButtonBlank actionButtonHome actionButtonHelp " +
    "actionButtonInformation actionButtonForwardNext actionButtonBackPrevious actionButtonEnd actionButtonBeginning actionButtonReturn actionButtonDocument actionButtonSound actionButtonMovie gear6 gear9 funnel mathPlus " +
    "mathMinus mathMultiply mathDivide mathEqual mathNotEqual cornerTabs squareTabs plaqueTabs chartX chartStar chartPlus"
  ).split(" "),
);

/** Names the editor's catalogue uses for presets that ECMA-376 calls something else. */
export const PRESET_ALIASES: Readonly<Record<string, string>> = { flowChartData: "flowChartInputOutput" };

const CONNECTORS = /^(line|straightConnector1|(bent|curved)Connector[2-5])$/;

const LAYOUT_TYPE: Partial<Record<LayoutKind, string>> = {
  title: "title",
  titleAndBody: "obj",
  sectionHeader: "secHead",
  titleAndTwoColumns: "twoObj",
  titleOnly: "titleOnly",
  oneColumnText: "objTx",
  blank: "blank",
};

const PH_NAMES: Record<string, string> = {
  title: "Title",
  ctrTitle: "Title",
  subTitle: "Subtitle",
  body: "Text Placeholder",
  obj: "Content Placeholder",
  dt: "Date Placeholder",
  ftr: "Footer Placeholder",
  sldNum: "Slide Number Placeholder",
  pic: "Picture Placeholder",
  chart: "Chart Placeholder",
  tbl: "Table Placeholder",
  media: "Media Placeholder",
  clipArt: "Clip Art Placeholder",
  dgm: "Diagram Placeholder",
  hdr: "Header Placeholder",
  sldImg: "Slide Image Placeholder",
};

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const GROUP_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

// ---- Frames ------------------------------------------------------------------------------------------------------

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hasOwnFrame = (e: Element): boolean => e.x !== undefined || e.y !== undefined || e.w !== undefined || e.h !== undefined;

/** The frame of an element, with unset parts taken from the placeholders above it, like the editor does. */
function frameOf(el: Element, chain: (Element | undefined)[], env: Env): Frame {
  const src = [el, ...chain];
  const pick = (k: "x" | "y" | "w" | "h") => src.find((e) => e && e[k] !== undefined)?.[k];
  const w = pick("w") ?? env.size.width / 2;
  const h = pick("h") ?? env.size.height / 4;
  return { x: pick("x") ?? (env.size.width - w) / 2, y: pick("y") ?? (env.size.height - h) / 2, w, h };
}

function xfrmXml(name: string, el: Element, f: Frame, group = false): string {
  const w = Math.max(0, emu(f.w));
  const h = Math.max(0, emu(f.h));
  const deg = ((((el.rotation ?? 0) % 360) + 360) % 360);
  const a = { rot: deg ? Math.round(deg * 60000) % 21600000 : undefined, flipH: el.flipH ? true : undefined, flipV: el.flipV ? true : undefined };
  const off = tag("a:off", { x: emu(f.x), y: emu(f.y) });
  const ext = tag("a:ext", { cx: w, cy: h });
  const child = group ? tag("a:chOff", { x: emu(f.x), y: emu(f.y) }) + tag("a:chExt", { cx: w, cy: h }) : "";
  return tag(name, a, off + ext + child);
}

// ---- Placeholders ------------------------------------------------------------------------------------------------

/** The idx each placeholder of a layout or master is written with: title 0, the others as given or numbered from 1. */
function assignIdx(elements: readonly Element[]): Map<unknown, number> {
  const map = new Map<unknown, number>();
  const phs = elements.filter((e) => e.placeholder);
  const taken = new Set<number>();
  const isTitle = (p: Placeholder) => p.type === "title" || p.type === "ctrTitle";
  for (const e of phs) {
    const p = e.placeholder!;
    if (p.idx !== undefined && p.idx !== 0) taken.add(p.idx);
  }
  let next = 1;
  const seen = new Set<string>();
  for (const e of phs) {
    const p = e.placeholder!;
    let v: number;
    if (isTitle(p) && !p.idx) v = 0;
    else if (p.idx !== undefined && p.idx !== 0) v = p.idx;
    else {
      while (taken.has(next)) next++;
      v = next;
      taken.add(v);
    }
    const key = `${p.type}:${v}`;
    if (seen.has(key)) {
      while (taken.has(next)) next++;
      v = next;
      taken.add(v);
    }
    seen.add(`${p.type}:${v}`);
    map.set(e, v);
  }
  return map;
}

function placeholderIdx(el: Element, env: Env): number {
  const ph = el.placeholder!;
  let idx: number | undefined;
  if (env.origin === "master") idx = env.masterIdx.get(el);
  else if (env.origin === "layout") idx = env.layoutIdx.get(el);
  else {
    const m = env.layout ? matchPlaceholder(env.layout.elements, ph) : undefined;
    idx = m ? env.layoutIdx.get(m) : ph.idx;
  }
  idx ??= 0;
  // two placeholders of a part with the same type and idx would be one to PowerPoint
  let key = `${ph.type}:${idx}`;
  for (let n = 100; env.usedPh.has(key); n++) {
    idx = n;
    key = `${ph.type}:${idx}`;
  }
  env.usedPh.add(key);
  return idx;
}

function phXml(el: Element, env: Env): string {
  const ph = el.placeholder!;
  return tag("p:ph", { type: ph.type, idx: placeholderIdx(el, env) || undefined });
}

/** The placeholders an element inherits from, nearest first. */
function inheritsFrom(el: Element, env: Env): (ShapeElement | undefined)[] {
  const ph = el.placeholder;
  if (!ph || env.origin === "master") return [];
  const master = matchPlaceholder(env.master.elements, ph);
  if (env.origin === "layout") return [master];
  return [env.layout ? matchPlaceholder(env.layout.elements, ph) : undefined, master];
}

// ---- Elements ----------------------------------------------------------------------------------------------------

function nameOf(el: Element, id: number, fallback: string): string {
  if (el.name) return el.name;
  const label = el.placeholder ? (PH_NAMES[el.placeholder.type] ?? "Placeholder") : fallback;
  return `${label} ${id - 1}`;
}

function cNvPr(el: Element, id: number, fallback: string, env: Env): string {
  return tag("p:cNvPr", { id, name: nameOf(el, id, fallback), descr: el.alt || undefined, hidden: el.hidden ? true : undefined }, hlinkClick(env, el.link));
}

function geometryXml(geometry: string | undefined, adjust: Record<string, number> | undefined, custom?: CustomGeometry): string {
  if (custom && custom.paths.length > 0) return custGeomXml(custom);
  const named = geometry ? (PRESET_ALIASES[geometry] ?? geometry) : "rect";
  const prst = PRESET_NAMES.has(named) ? named : "rect";
  const gds = Object.entries(adjust ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .map(([name, v]) => tag("a:gd", { name, fmla: `val ${Math.round(v)}` }))
    .join("");
  return tag("a:prstGeom", { prst }, tag("a:avLst", {}, gds));
}

function emptyText(el: ShapeElement): boolean {
  return !el.text || el.text.paragraphs.every((p) => p.runs.every((r) => r.text === ""));
}

/** An empty slide number placeholder on a master or layout carries the slide number field, which slides copy from it. */
function withNumberField(el: ShapeElement, env: Env): TextBody | undefined {
  if (env.origin === "slide" || el.placeholder?.type !== "sldNum" || !emptyText(el)) return el.text;
  const base: Paragraph = el.text?.paragraphs[0] ?? { runs: [] };
  return { ...el.text, paragraphs: [{ ...base, runs: [{ text: "‹#›", marks: { field: "slideNumber" } }] }] };
}

function shapeXml(el: ShapeElement, env: Env): string {
  const id = env.nextId++;
  const ph = el.placeholder;
  const up = inheritsFrom(el, env);
  const connector = !ph && CONNECTORS.test(el.geometry);
  const frame = frameOf(el, up, env);
  const own = !ph || hasOwnFrame(el);
  const unset = !ph;
  let spPr = own ? xfrmXml("a:xfrm", el, frame) : "";
  // A slide placeholder that says "rect" over a layout that says nothing else needs no geometry of its own.
  const inheritedGeo = up.find((u) => u)?.geometry;
  const needGeo = !ph || env.origin !== "slide" || el.geometry !== "rect" || !!el.custom || !!el.adjust || (inheritedGeo !== undefined && inheritedGeo !== "rect");
  if (needGeo) spPr += geometryXml(el.geometry, el.adjust, el.custom);
  spPr += fillXml(el.fill, env, unset);
  spPr += lineXml(el.line, "a:ln", unset);
  spPr += effectXml(el.shadow);
  if (connector) {
    return tag(
      "p:cxnSp",
      {},
      tag("p:nvCxnSpPr", {}, cNvPr(el, id, "Straight Connector", env) + tag("p:cNvCxnSpPr") + tag("p:nvPr")) + tag("p:spPr", {}, spPr),
    );
  }
  const cNvSpPr = ph ? tag("p:cNvSpPr", {}, tag("a:spLocks", { noGrp: true })) : tag("p:cNvSpPr", { txBox: el.textBox ? true : undefined });
  const nv = tag("p:nvSpPr", {}, cNvPr(el, id, el.textBox ? "TextBox" : "Shape", env) + cNvSpPr + tag("p:nvPr", {}, ph ? phXml(el, env) : ""));
  const text = withNumberField(el, env);
  const body = text || ph ? txBodyXml("p:txBody", text, env) : "";
  return tag("p:sp", {}, nv + tag("p:spPr", {}, spPr) + body);
}

function imageXml(el: ImageElement, env: Env): string {
  const blip = blipXml(env, el.src);
  if (!blip) return "";
  const id = env.nextId++;
  const ph = el.placeholder;
  const up = inheritsFrom(el, env);
  let spPr = !ph || hasOwnFrame(el) ? xfrmXml("a:xfrm", el, frameOf(el, up, env)) : "";
  spPr += geometryXml(el.geometry ?? "rect", undefined, el.custom);
  spPr += lineXml(el.line, "a:ln", false);
  spPr += effectXml(el.shadow);
  const nv = tag(
    "p:nvPicPr",
    {},
    cNvPr(el, id, "Picture", env) + tag("p:cNvPicPr", {}, tag("a:picLocks", { noChangeAspect: true, noGrp: ph ? true : undefined })) + tag("p:nvPr", {}, ph ? phXml(el, env) : ""),
  );
  return tag("p:pic", {}, nv + blipFillXml("p", blip, el.crop, false) + tag("p:spPr", {}, spPr));
}

const ANCHOR = { top: "t", middle: "ctr", bottom: "b" } as const;

function tableXml(el: TableElement, env: Env): string {
  const cols = el.columns.map((w) => Math.max(1, emu(w)));
  if (cols.length === 0 || el.rows.length === 0) return "";
  const id = env.nextId++;
  const nRows = el.rows.length;
  const nCols = cols.length;
  // which squares a spanning cell covers, and in which direction
  const covered: ({ h: boolean; v: boolean } | undefined)[][] = el.rows.map(() => Array<{ h: boolean; v: boolean } | undefined>(nCols).fill(undefined));
  const spans = el.rows.map((row, r) =>
    row.cells.map((cell, c) => {
      if (cell.covered) return { cs: 1, rs: 1 };
      const cs = Math.max(1, Math.min(cell.colSpan ?? 1, nCols - c));
      const rs = Math.max(1, Math.min(cell.rowSpan ?? 1, nRows - r));
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if ((dr || dc) && !covered[r + dr]![c + dc]) covered[r + dr]![c + dc] = { h: dc > 0, v: dr > 0 };
      return { cs, rs };
    }),
  );
  const gridXml = tag("a:tblGrid", {}, cols.map((w) => tag("a:gridCol", { w })).join(""));
  const rowsXml = el.rows
    .map((row, r) => {
      const cells = Array.from({ length: nCols }, (_, c) => row.cells[c] ?? ({ paragraphs: [{ runs: [] }] } as TableCell));
      const tcs = cells.map((cell, c) => {
        const cov = covered[r]![c];
        const span = spans[r]![c] ?? { cs: 1, rs: 1 };
        const header = !!el.headerRow && r === 0;
        const banded = !!el.banded && !header && r % 2 === 1;
        const fill = cell.fill !== undefined ? cell.fill : header ? { theme: "accent1" as const } : banded ? { theme: "lt2" as const } : null;
        const headerMarks = header && cell.fill === undefined ? { bold: true, color: { theme: "lt1" as const } } : undefined;
        const paragraphs: Paragraph[] = cov
          ? [{ runs: [] }]
          : headerMarks
            ? cell.paragraphs.map((p) => ({ ...p, runs: p.runs.map((run) => ({ ...run, marks: { ...headerMarks, ...run.marks } })) }))
            : cell.paragraphs;
        const side = (name: string, b: Parameters<typeof lineXml>[0]) => lineXml(b === undefined ? { width: 0.75, color: "#bfbfbf" } : b, name);
        const tcPr = tag(
          "a:tcPr",
          { anchor: cell.vAlign ? ANCHOR[cell.vAlign] : undefined },
          side("a:lnL", cell.borders?.left) + side("a:lnR", cell.borders?.right) + side("a:lnT", cell.borders?.top) + side("a:lnB", cell.borders?.bottom) + fillXml(fill, env, true),
        );
        return tag(
          "a:tc",
          { gridSpan: span.cs > 1 ? span.cs : undefined, rowSpan: span.rs > 1 ? span.rs : undefined, hMerge: cov?.h ? true : undefined, vMerge: cov?.v ? true : undefined },
          txBodyXml("a:txBody", { paragraphs }, env, paragraphs) + tcPr,
        );
      });
      return tag("a:tr", { h: Math.max(0, emu(row.h)) }, tcs.join(""));
    })
    .join("");
  const frame = frameOf(el, [], env);
  const w = cols.reduce((n, x) => n + x, 0);
  const h = el.rows.reduce((n, row) => n + Math.max(0, emu(row.h)), 0);
  const xfrm = tag("p:xfrm", {}, tag("a:off", { x: emu(frame.x), y: emu(frame.y) }) + tag("a:ext", { cx: w, cy: h }));
  const tbl = tag("a:tbl", {}, tag("a:tblPr", { firstRow: el.headerRow ? true : undefined, bandRow: el.banded ? true : undefined }) + gridXml + rowsXml);
  const graphic = tag("a:graphic", {}, tag("a:graphicData", { uri: "http://schemas.openxmlformats.org/drawingml/2006/table" }, tbl));
  const ph = el.placeholder;
  const nv = tag(
    "p:nvGraphicFramePr",
    {},
    cNvPr(el, id, "Table", env) + tag("p:cNvGraphicFramePr", {}, tag("a:graphicFrameLocks", { noGrp: true })) + tag("p:nvPr", {}, ph ? phXml(el, env) : ""),
  );
  return tag("p:graphicFrame", {}, nv + xfrm + graphic);
}

function chartXml(el: ChartElement, env: Env): string {
  const id = env.nextId++;
  const rid = addChartParts(el, env, env.ctx.addMedia);
  const frame = frameOf(el, [], env);
  const xfrm = tag("p:xfrm", {}, tag("a:off", { x: emu(frame.x), y: emu(frame.y) }) + tag("a:ext", { cx: Math.max(0, emu(frame.w)), cy: Math.max(0, emu(frame.h)) }));
  const chart = `<c:chart xmlns:c="${CHART_URI}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/>`;
  const graphic = tag("a:graphic", {}, tag("a:graphicData", { uri: CHART_URI }, chart));
  const ph = el.placeholder;
  const nv = tag("p:nvGraphicFramePr", {}, cNvPr(el, id, "Chart", env) + tag("p:cNvGraphicFramePr", {}, tag("a:graphicFrameLocks", { noGrp: true })) + tag("p:nvPr", {}, ph ? phXml(el, env) : ""));
  return tag("p:graphicFrame", {}, nv + xfrm + graphic);
}

function groupXml(el: GroupElement, env: Env): string {
  const id = env.nextId++;
  const nv = tag("p:nvGrpSpPr", {}, cNvPr(el, id, "Group", env) + tag("p:cNvGrpSpPr") + tag("p:nvPr"));
  const frame = frameOf(el, [], env);
  // children are in slide coordinates, so the child space is the group's own box
  const grpSpPr = tag("p:grpSpPr", {}, xfrmXml("a:xfrm", el, frame, true));
  return tag("p:grpSp", {}, nv + grpSpPr + el.children.map((c) => elementXml(c, env)).join(""));
}

export function elementXml(el: Element, env: Env): string {
  // every element takes the next shape id when it is written (a picture that can't be written takes none)
  const id = env.nextId;
  const xml = elementBody(el, env);
  if (env.ids && env.nextId > id) env.ids.set(el.id, id);
  return xml;
}

function elementBody(el: Element, env: Env): string {
  switch (el.type) {
    case "shape":
      return shapeXml(el, env);
    case "image":
      return imageXml(el, env);
    case "table":
      return tableXml(el, env);
    case "chart":
      return chartXml(el, env);
    case "group":
      return groupXml(el, env);
  }
}

function spTreeXml(elements: readonly Element[], env: Env): string {
  return tag("p:spTree", {}, GROUP_HEAD + elements.map((e) => elementXml(e, env)).join(""));
}

function backgroundXml(fill: Parameters<typeof fillXml>[0], env: Env): string {
  if (fill === undefined) return "";
  const f = fillXml(fill, env);
  return tag("p:bg", {}, tag("p:bgPr", {}, f + tag("a:effectLst")));
}

// ---- Theme -------------------------------------------------------------------------------------------------------

const phClr = (inner = "") => tag("a:schemeClr", { val: "phClr" }, inner);
const grad = (stops: [number, string][], ang: number) =>
  tag("a:gradFill", { rotWithShape: true }, tag("a:gsLst", {}, stops.map(([pos, mods]) => tag("a:gs", { pos }, phClr(mods))).join("")) + tag("a:lin", { ang, scaled: false }));
const themeLine = (w: number) => tag("a:ln", { w, cap: "flat", cmpd: "sng", algn: "ctr" }, tag("a:solidFill", {}, phClr()) + tag("a:prstDash", { val: "solid" }) + tag("a:miter", { lim: 800000 }));

function fmtSchemeXml(): string {
  const fills =
    tag("a:solidFill", {}, phClr()) +
    grad(
      [
        [0, '<a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/>'],
        [50000, '<a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/>'],
        [100000, '<a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/>'],
      ],
      5400000,
    ) +
    grad(
      [
        [0, '<a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/>'],
        [50000, '<a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/>'],
        [100000, '<a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/>'],
      ],
      5400000,
    );
  const shadow = tag(
    "a:effectStyle",
    {},
    tag("a:effectLst", {}, tag("a:outerShdw", { blurRad: 57150, dist: 19050, dir: 5400000, algn: "ctr", rotWithShape: false }, '<a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr>')),
  );
  const bg =
    tag("a:solidFill", {}, phClr()) +
    tag("a:solidFill", {}, phClr('<a:tint val="95000"/><a:satMod val="170000"/>')) +
    grad(
      [
        [0, '<a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/>'],
        [50000, '<a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/>'],
        [100000, '<a:shade val="63000"/><a:satMod val="120000"/>'],
      ],
      5400000,
    );
  return tag(
    "a:fmtScheme",
    { name: "Pli" },
    tag("a:fillStyleLst", {}, fills) +
      tag("a:lnStyleLst", {}, themeLine(6350) + themeLine(12700) + themeLine(19050)) +
      tag("a:effectStyleLst", {}, tag("a:effectStyle", {}, tag("a:effectLst")) + tag("a:effectStyle", {}, tag("a:effectLst")) + shadow) +
      tag("a:bgFillStyleLst", {}, bg),
  );
}

function themeXml(theme: Theme): string {
  const slot = (name: string) => {
    const hex = (theme.colors[name as keyof Theme["colors"]] ?? "#000000").replace(/^#/, "");
    const m = /^([0-9a-f]{6})/i.exec(hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex);
    return tag(`a:${name}`, {}, tag("a:srgbClr", { val: (m ? m[1]! : "000000").toUpperCase() }));
  };
  const font = (name: string, face: string) => tag(name, {}, fontXml("a:latin", face) + tag("a:ea", { typeface: "" }) + tag("a:cs", { typeface: "" }));
  return (
    XML_DECL +
    tag(
      "a:theme",
      { "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main", name: theme.name || "Pli" },
      tag(
        "a:themeElements",
        {},
        tag("a:clrScheme", { name: theme.name || "Pli" }, THEME_SLOTS.map(slot).join("")) +
          tag("a:fontScheme", { name: theme.name || "Pli" }, font("a:majorFont", theme.fonts.major) + font("a:minorFont", theme.fonts.minor)) +
          fmtSchemeXml(),
      ) +
        tag("a:objectDefaults") +
        tag("a:extraClrSchemeLst"),
    )
  );
}

// ---- Text styles -------------------------------------------------------------------------------------------------

const BUILTIN: LevelStyle = { marks: { fontSize: 18, fontFamily: "+mn-lt", color: { theme: "dk1" } }, align: "left", marL: 0, indent: 0, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 };

function mergeLevel(base: LevelStyle, over: LevelStyle | undefined): LevelStyle {
  const out: LevelStyle = { ...base };
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) if (v !== undefined && k !== "marks") (out as Record<string, unknown>)[k] = v;
  const marks = { ...base.marks };
  for (const [k, v] of Object.entries(over.marks ?? {})) if (v !== undefined) (marks as Record<string, unknown>)[k] = v;
  out.marks = marks;
  return out;
}

/** The deck's default text style for all nine levels: what text without a placeholder, and the end of every chain, uses. */
function defaultTextStyleXml(deck: Deck, env: Env): string {
  const levels: Record<number, LevelStyle> = {};
  for (let i = 0; i < 9; i++) levels[i] = mergeLevel(BUILTIN, deck.defaultTextStyle?.[i] ?? deck.defaultTextStyle?.[0]);
  return tag("p:defaultTextStyle", {}, listStyleXml(levels, env));
}

// ---- Transitions -------------------------------------------------------------------------------------------------

/** The direction a transition moves in is the opposite of where it comes from. */
const MOTION = { left: "r", right: "l", up: "d", down: "u" } as const;

function transitionXml(t: Transition | undefined): string {
  if (!t) return "";
  const dir = t.direction ? MOTION[t.direction] : undefined;
  let child = "";
  switch (t.type) {
    case "fade":
      child = tag("p:fade");
      break;
    case "dissolve":
      child = tag("p:dissolve");
      break;
    case "slide":
      child = tag("p:cover", { dir });
      break;
    case "push":
    case "flip":
    case "cube":
    case "gallery":
      // PowerPoint 2007 has no 3-D transitions; a push in the same direction is the nearest of the plain ones
      child = tag("p:push", { dir });
      break;
    case "wipe":
      child = tag("p:wipe", { dir });
      break;
    case "zoom":
      child = tag("p:zoom", { dir: "in" });
      break;
    case "none":
      break;
  }
  const spd = t.duration === undefined ? undefined : t.duration <= 600 ? "fast" : t.duration <= 1000 ? "med" : "slow";
  const advTm = t.advanceAfter !== undefined && t.advanceAfter >= 0 ? Math.round(t.advanceAfter) : undefined;
  if (child === "" && advTm === undefined) return "";
  const plain = tag("p:transition", { spd: child ? spd : undefined, advTm }, child);
  if (!child || t.duration === undefined) return plain;
  // The exact duration is a PowerPoint 2010 extension; older readers fall back to the plain speed word.
  const dur = Math.max(0, Math.round(t.duration));
  const modern = tag("p:transition", { spd, advTm, "p14:dur": dur }, child);
  return (
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
    `<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">${modern}</mc:Choice>` +
    `<mc:Fallback>${plain}</mc:Fallback></mc:AlternateContent>`
  );
}

// ---- Parts -------------------------------------------------------------------------------------------------------

function masterTextStyles(master: Master, env: Env): string {
  const style = (name: string, levels: Record<number, LevelStyle> | undefined) => tag(name, {}, listStyleXml(levels, env));
  return tag("p:txStyles", {}, style("p:titleStyle", master.textStyles.title) + style("p:bodyStyle", master.textStyles.body) + style("p:otherStyle", master.textStyles.other));
}

function noteMasterXml(deck: Deck): string {
  const sp = (id: number, name: string, ph: string, off: [number, number], ext: [number, number], extra: string, body: string, locks: Record<string, boolean> = { noGrp: true }) =>
    tag(
      "p:sp",
      {},
      tag("p:nvSpPr", {}, tag("p:cNvPr", { id, name }) + tag("p:cNvSpPr", {}, tag("a:spLocks", locks)) + tag("p:nvPr", {}, ph)) +
        tag("p:spPr", {}, tag("a:xfrm", {}, tag("a:off", { x: off[0], y: off[1] }) + tag("a:ext", { cx: ext[0], cy: ext[1] })) + tag("a:prstGeom", { prst: "rect" }, tag("a:avLst")) + extra) +
        body,
    );
  const text = (algn: string, inner: string) =>
    tag(
      "p:txBody",
      {},
      tag("a:bodyPr", { vert: "horz", lIns: 91440, tIns: 45720, rIns: 91440, bIns: 45720, rtlCol: false }) +
        tag("a:lstStyle", {}, tag("a:lvl1pPr", { algn }, tag("a:defRPr", { sz: 1200 }))) +
        tag("a:p", {}, inner),
    );
  const empty = tag("a:endParaRPr", { lang: "en-US" });
  const num = tag("a:fld", { id: "{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}", type: "slidenum" }, tag("a:rPr", { lang: "en-US" }) + tag("a:t", {}, "‹#›"));
  const slideH = Math.round((5486400 * deck.size.height) / deck.size.width);
  const tree =
    GROUP_HEAD +
    sp(2, "Header Placeholder 1", tag("p:ph", { type: "hdr", sz: "quarter" }), [0, 0], [2971800, 458788], "", text("l", empty)) +
    sp(3, "Date Placeholder 2", tag("p:ph", { type: "dt", idx: 1 }), [3884613, 0], [2971800, 458788], "", text("r", empty)) +
    sp(
      4,
      "Slide Image Placeholder 3",
      tag("p:ph", { type: "sldImg", idx: 2 }),
      [685800, 1143000],
      [5486400, slideH],
      tag("a:noFill") + tag("a:ln", { w: 12700 }, tag("a:solidFill", {}, tag("a:prstClr", { val: "black" }))),
      "",
      { noGrp: true, noRot: true, noChangeAspect: true },
    ) +
    sp(5, "Notes Placeholder 4", tag("p:ph", { type: "body", sz: "quarter", idx: 3 }), [685800, 4400550], [5486400, 3600450], "", text("l", empty)) +
    sp(6, "Footer Placeholder 5", tag("p:ph", { type: "ftr", sz: "quarter", idx: 4 }), [0, 8685213], [2971800, 458787], "", text("l", empty)) +
    sp(7, "Slide Number Placeholder 6", tag("p:ph", { type: "sldNum", sz: "quarter", idx: 5 }), [3884613, 8685213], [2971800, 458787], "", text("r", num));
  const level = (n: number) =>
    tag(`a:lvl${n}pPr`, { marL: (n - 1) * 457200, algn: "l", defTabSz: 914400, rtl: false, eaLnBrk: true, latinLnBrk: false, hangingPunct: true }, tag("a:defRPr", { sz: 1200, kern: 1200 }, tag("a:solidFill", {}, tag("a:schemeClr", { val: "tx1" })) + tag("a:latin", { typeface: "+mn-lt" })));
  return (
    XML_DECL +
    `<p:notesMaster ${NS_ALL}>` +
    (
      tag("p:cSld", {}, tag("p:bg", {}, tag("p:bgRef", { idx: 1001 }, tag("a:schemeClr", { val: "bg1" }))) + tag("p:spTree", {}, tree)) +
        CLR_MAP +
        tag("p:notesStyle", {}, Array.from({ length: 9 }, (_, i) => level(i + 1)).join(""))
    ) +
    "</p:notesMaster>"
  );
}

function notesSlideXml(notes: string): string {
  const paras = notes.split(/\r\n|\r|\n/).map((line) => tag("a:p", {}, line === "" ? tag("a:endParaRPr", { lang: "en-US" }) : tag("a:r", {}, tag("a:rPr", { lang: "en-US" }) + tag("a:t", {}, xmlEscape(line)))));
  const image = tag(
    "p:sp",
    {},
    tag("p:nvSpPr", {}, tag("p:cNvPr", { id: 2, name: "Slide Image Placeholder 1" }) + tag("p:cNvSpPr", {}, tag("a:spLocks", { noGrp: true, noRot: true, noChangeAspect: true })) + tag("p:nvPr", {}, tag("p:ph", { type: "sldImg" }))) +
      tag("p:spPr"),
  );
  const body = tag(
    "p:sp",
    {},
    tag("p:nvSpPr", {}, tag("p:cNvPr", { id: 3, name: "Notes Placeholder 2" }) + tag("p:cNvSpPr", {}, tag("a:spLocks", { noGrp: true })) + tag("p:nvPr", {}, tag("p:ph", { type: "body", idx: 1 }))) +
      tag("p:spPr") +
      tag("p:txBody", {}, tag("a:bodyPr") + tag("a:lstStyle") + paras.join("")),
  );
  return `${XML_DECL}<p:notes ${NS_ALL}>${tag("p:cSld", {}, tag("p:spTree", {}, GROUP_HEAD + image + body))}${tag("p:clrMapOvr", {}, tag("a:masterClrMapping"))}</p:notes>`;
}

// ---- The package -------------------------------------------------------------------------------------------------

const isoDate = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, "Z");

function build(source: Deck, options: PptxOptions, template: boolean): Uint8Array {
  const deck = options.fonts === "office" ? mapFonts(source, (name) => (isSymbolFont(name) || isOfficeFont(name) ? name : officeSubstitute(name))) : source;
  const date = options.date ?? new Date();
  const pkg = new OpcPackage();
  const parts: Part[] = [];
  const ctx: WriterContext = { options, media: new Map(), nextMedia: 0, addMedia: (p) => parts.push(p), nextGuid: 0, nextChart: 0, date };

  const masters: Master[] = deck.masters.length ? deck.masters : [buildMaster({ name: "Simple Light", theme: LIGHT_THEME, size: deck.size })];
  const layoutsOf = (m: Master): Layout[] => (m.layouts.length ? m.layouts : [{ id: `${m.id}-blank`, name: "Blank", kind: "blank", elements: [] }]);

  const pres = pkg.add(new Part("ppt/presentation.xml", template ? CT.template : CT.presentation));
  pkg.relate(REL.officeDocument, pres.name);
  pkg.relate(REL.coreProperties, "docProps/core.xml");
  pkg.relate(REL.extendedProperties, "docProps/app.xml");

  const makeEnv = (part: Part, origin: Origin, master: Master, layout?: Layout): Env => ({
    ctx,
    part,
    nextId: 2,
    origin,
    size: deck.size,
    master,
    layout,
    layoutIdx: layout ? assignIdx(layout.elements) : new Map(),
    masterIdx: assignIdx(master.elements),
    usedPh: new Set(),
  });

  // masters, themes and layouts
  let nextId = FIRST_MASTER_ID;
  const masterIds: number[] = [];
  const layoutInfo = new Map<string, { master: Master; layout: Layout; part: Part }>();
  const masterParts: Part[] = [];
  masters.forEach((master, mi) => {
    const mPart = pkg.add(new Part(`ppt/slideMasters/slideMaster${mi + 1}.xml`, CT.slideMaster));
    masterParts.push(mPart);
    masterIds.push(nextId++);
    pres.relate(REL.slideMaster, mPart.name);
  });
  const layoutIds = new Map<Part, number>();
  let layoutCount = 0;
  masters.forEach((master, mi) => {
    for (const layout of layoutsOf(master)) {
      const lPart = pkg.add(new Part(`ppt/slideLayouts/slideLayout${++layoutCount}.xml`, CT.slideLayout));
      layoutIds.set(lPart, nextId++);
      lPart.relate(REL.slideMaster, masterParts[mi]!.name);
      masterParts[mi]!.relate(REL.slideLayout, lPart.name);
      layoutInfo.set(layout.id, { master, layout, part: lPart });
      lPart.data = XML_DECL + layoutXml(layout, makeEnv(lPart, "layout", master, layout));
    }
  });
  masters.forEach((master, mi) => {
    const mPart = masterParts[mi]!;
    const themePart = pkg.add(new Part(`ppt/theme/theme${mi + 1}.xml`, CT.theme, themeXml(master.theme)));
    mPart.relate(REL.theme, themePart.name);
    const env = makeEnv(mPart, "master", master);
    const idList = layoutsOf(master).map((l) => {
      const info = layoutInfo.get(l.id)!;
      return tag("p:sldLayoutId", { id: layoutIds.get(info.part)!, "r:id": mPart.rels.find((r) => r.target === info.part.name)!.id });
    });
    const bg = backgroundXml(master.background ?? { theme: "lt1" }, env);
    const tree = spTreeXml(master.elements, env);
    mPart.data =
      XML_DECL +
      `<p:sldMaster ${NS_ALL}>` +
      tag("p:cSld", {}, bg + tree) +
      CLR_MAP +
      tag("p:sldLayoutIdLst", {}, idList.join("")) +
      masterTextStyles(master, env) +
      "</p:sldMaster>";
  });

  // notes master
  const notesTheme = pkg.add(new Part(`ppt/theme/theme${masters.length + 1}.xml`, CT.theme, themeXml(masters[0]!.theme)));
  const notesMaster = pkg.add(new Part("ppt/notesMasters/notesMaster1.xml", CT.notesMaster));
  notesMaster.relate(REL.theme, notesTheme.name);
  notesMaster.data = noteMasterXml(deck);
  const notesMasterRid = pres.relate(REL.notesMaster, notesMaster.name);

  // slides
  const slides = template ? [] : deck.slides;
  const sldIds: string[] = [];
  let notesCount = 0;
  let hidden = 0;
  const written: SlideForComments[] = [];
  slides.forEach((slide, si) => {
    const info = layoutInfo.get(slide.layout) ?? layoutInfo.get(layoutsOf(masters[0]!)[0]!.id)!;
    const part = pkg.add(new Part(`ppt/slides/slide${si + 1}.xml`, CT.slide));
    part.relate(REL.slideLayout, info.part.name);
    const rid = pres.relate(REL.slide, part.name);
    sldIds.push(tag("p:sldId", { id: FIRST_SLIDE_ID + si, "r:id": rid }));
    if (slide.notes.trim() !== "") {
      const notes = pkg.add(new Part(`ppt/notesSlides/notesSlide${++notesCount}.xml`, CT.notesSlide, notesSlideXml(slide.notes)));
      notes.relate(REL.notesMaster, notesMaster.name);
      notes.relate(REL.slide, part.name);
      part.relate(REL.notesSlide, notes.name);
    }
    if (slide.skipped) hidden++;
    const env = makeEnv(part, "slide", info.master, info.layout);
    // Comments about a shape name it by its shape id, so they are remembered while the slide is written.
    if (slideHasThreads(deck, slide.id)) env.ids = new Map();
    part.data = XML_DECL + slideXml(slide, env);
    written.push({ part, sldId: FIRST_SLIDE_ID + si, spids: env.ids ?? new Map() });
  });
  if (!template) addCommentParts(pkg, pres, deck, written, { mode: options.comments ?? "legacy", author: options.commentAuthor });

  // presentation properties
  const presProps = pkg.add(new Part("ppt/presProps.xml", CT.presProps, `${XML_DECL}<p:presentationPr ${NS_ALL}/>`));
  const viewProps = pkg.add(
    new Part(
      "ppt/viewProps.xml",
      CT.viewProps,
      `${XML_DECL}<p:viewPr ${NS_ALL}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    ),
  );
  const tableStyles = pkg.add(new Part("ppt/tableStyles.xml", CT.tableStyles, `${XML_DECL}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`));
  pres.relate(REL.presProps, presProps.name);
  pres.relate(REL.viewProps, viewProps.name);
  pres.relate(REL.theme, "ppt/theme/theme1.xml");
  pres.relate(REL.tableStyles, tableStyles.name);

  const sldSz = tag("p:sldSz", { cx: clampSize(emu(deck.size.width)), cy: clampSize(emu(deck.size.height)) });
  const masterIdList = masterParts.map((p, i) => tag("p:sldMasterId", { id: masterIds[i]!, "r:id": pres.rels.find((r) => r.target === p.name)!.id })).join("");
  pres.data =
    XML_DECL +
    `<p:presentation ${NS_ALL}>` +
    tag("p:sldMasterIdLst", {}, masterIdList) +
    tag("p:notesMasterIdLst", {}, tag("p:notesMasterId", { "r:id": notesMasterRid })) +
    (sldIds.length ? tag("p:sldIdLst", {}, sldIds.join("")) : "") +
    sldSz +
    tag("p:notesSz", { cx: NOTES_W, cy: NOTES_H }) +
    defaultTextStyleXml(deck, makeEnv(pres, "master", masters[0]!)) +
    "</p:presentation>";

  // document properties
  pkg.add(
    new Part(
      "docProps/core.xml",
      CT.core,
      `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${xmlEscape(deck.title)}</dc:title>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${isoDate(date)}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate(date)}</dcterms:modified>` +
        "</cp:coreProperties>",
    ),
  );
  pkg.add(
    new Part(
      "docProps/app.xml",
      CT.app,
      `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
        `<TotalTime>0</TotalTime><Application>Pli.Decks</Application><Slides>${slides.length}</Slides><Notes>${notesCount}</Notes><HiddenSlides>${hidden}</HiddenSlides></Properties>`,
    ),
  );
  for (const media of parts) pkg.add(media);
  return pkg.write({ date });
}

const clampSize = (n: number): number => Math.min(51206400, Math.max(914400, n));

function layoutXml(layout: Layout, env: Env): string {
  const type = (layout.kind && LAYOUT_TYPE[layout.kind]) || "cust";
  const bg = backgroundXml(layout.background, env);
  return (
    `<p:sldLayout ${NS_ALL}${attrs({ type, preserve: true, showMasterSp: layout.showMasterElements === false ? false : undefined })}>` +
    tag("p:cSld", { name: layout.name }, bg + spTreeXml(layout.elements, env)) +
    tag("p:clrMapOvr", {}, tag("a:masterClrMapping")) +
    "</p:sldLayout>"
  );
}

function slideXml(slide: Slide, env: Env): string {
  const bg = backgroundXml(slide.background, env);
  if (slide.animations?.length && !env.ids) env.ids = new Map();
  const tree = spTreeXml(slide.elements, env);
  return (
    `<p:sld ${NS_ALL}${attrs({ show: slide.skipped ? false : undefined, showMasterSp: slide.showMasterElements === false ? false : undefined })}>` +
    tag("p:cSld", { name: slide.name }, bg + tree) +
    tag("p:clrMapOvr", {}, tag("a:masterClrMapping")) +
    transitionXml(slide.transition) +
    timingOf(slide, env) +
    "</p:sld>"
  );
}

/** The animations of a slide (after its transition, as the schema has it), pointed at the shape ids just written. */
function timingOf(slide: Slide, env: Env): string {
  if (!env.ids) return "";
  const targets = new Map<string, TimingTarget>();
  for (const el of slide.elements) {
    const spid = env.ids.get(el.id);
    if (spid === undefined) continue;
    let bld: TimingTarget["bld"] = "none";
    let animBg = false;
    if (el.type === "chart") bld = "graphic";
    else if (el.type === "shape" && (el.placeholder || !CONNECTORS.test(el.geometry))) {
      // shapes written with a text body (connectors have none)
      bld = el.text || el.placeholder ? "text" : "none";
      animBg = !el.placeholder || el.fill !== undefined || el.line !== undefined;
    }
    targets.set(el.id, { spid, bld, animBg });
  }
  return timingXml(slide, targets, env.size);
}
