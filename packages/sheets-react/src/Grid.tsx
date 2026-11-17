import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type MutableRefObject, type RefObject } from "react";
import {
  MAX_COLS,
  MAX_ROWS,
  activeCell,
  addRange,
  cellAddress,
  colName,
  caret,
  expandToMerges,
  leaveMerge,
  moveSelection,
  rangeAddress,
  selectAll,
  inSelection,
  isTicked,
  parseRange,
  selectionBounds,
  selectionRanges,
  spansColumns,
  spansRows,
  wholeColumns,
  wholeRows,
  advance,
  isSingleCell,
  parseCell,
  mergeAt,
  mergedRanges,
  type Bounds,
  type Border,
  type BorderStyle,
  type Cell,
  type CellBorders,
  type CellLink,
  linkedStyle,
  type CellEffect,
  type ConditionalStyle,
  formatValue,
  tableLook,
  type Chart,
  type ChartView3d,
  type OutlineGroup,
  groupsOf,
  sparklineSvg,
  type SheetImage,
  type ImageCrop,
  type Slicer,
  type Timeline,
  hasHeader,
  MIN_CHART_SIZE,
  type Direction,
  type GridSelection,
  sheetRef,
  type Sheet,
  type SheetSession,
  type Value,
  type PasteOptions,
} from "@pli.dev/sheets";
import { fontStack } from "@pli.dev/core";
import { useFonts, useFontsVersion } from "@pli.dev/react";
import { ChartView } from "./ChartView";
import { ShapeHandles } from "./ShapeHandles";
import { ChartMarkPanel } from "./ChartMarkPanel";
import { describeMark, labelAt, listMarks, markAt, plot3dOf, stepMark, turnedView, type MarkRef } from "./chartmarks";
import { PictureBody, pictureAsPng, pictureBoxStyle } from "./PictureView";
import { cardChip, hasPicker, pillsOf, textOn, type ChipKind, type Pill } from "./chips";
import type { ChipCardInfo } from "./ChipCard";
import { CfIcon } from "./icons";
import type { CellCardInfo } from "./CellCard";
import { NoteBoxes, type ShownNote } from "./NoteBoxes";
import { PeerOutline } from "@pli.dev/react";
import type { PeerMark } from "./collab";
import type { ThreadMark } from "./comments";
import { SlicerView, slicerHit, slicerLayout, type SlicerItem } from "./SlicerView";
import { TimelineView, timelineHit, timelineLayout } from "./TimelineView";
import { TableTimelineView, type TimelineGeometry } from "./TableTimelineView";
import { expectsReference, referencesInText } from "./edit";
import { cropWords, nudgeCrop, panCrop } from "./cropKeys";
import { pointStep, type PointState } from "./pointing";
import { PageBreakLayer, type PageBreakView, type PageGhost } from "./PageBreakLayer";
import { Axis, colChars, columnAxis, colPx, rowAxis, rowPoints, wrapLineCount, MIN_SIZE_PX } from "./layout";

export const HEADER_W = 48;
export const HEADER_H = 24;

/** A cell being typed into. */
export interface EditState {
  row: number;
  col: number;
  text: string;
  /** `enter`: just started typing, so arrow keys finish the entry; `edit`: arrow keys move the text cursor. */
  mode: "enter" | "edit";
  from: "grid" | "bar";
  /** The id of the sheet the cell is on. The entry carries on when another sheet is shown, so cells there can be clicked into a formula. */
  sheet: string;
}

export interface CopiedRange {
  sheet: string;
  /** The copied rectangles. Only a single one comes back with formulas and formats; several paste as the text they show. */
  ranges: Bounds[];
  cut: boolean;
  /** The text put on the clipboard, to tell our own copy from one made elsewhere. */
  text: string;
  /** When it is a picture that was copied rather than cells: its id (and `ranges` is empty). */
  picture?: string;
}

export interface GridProps {
  session: SheetSession;
  sheetId: string;
  revision: number;
  selection: GridSelection;
  onSelect(selection: GridSelection): void;
  edit: EditState | null;
  onEdit(edit: EditState | null): void;
  onCommit(move: Direction | null): void;
  copied: CopiedRange | null;
  onCopied(copied: CopiedRange | null): void;
  readOnly: boolean;
  /** The hidden text field that has the keyboard's focus, which becomes the editor while typing. */
  sinkRef: RefObject<HTMLTextAreaElement | null>;
  /** Called for a right click, with where it was (in the window). */
  onContextMenu(point: { x: number; y: number }): void;
  /** Called when a filter button is pressed, with the column and where the button is (in the window). */
  onFilterMenu(info: { col: number; x: number; y: number; table?: string }): void;
  /** Called for a right click on a slicer, with where it was (in the window). */
  onSlicerMenu?(info: { id: string; x: number; y: number }): void;
  /** Called for a right click on a timeline, with where it was (in the window). */
  onTimelineMenu?(info: { id: string; x: number; y: number }): void;
  /** Called when the button beside a cell that doesn't follow its calculated column is pressed, with where it is (in the window). */
  onExceptionMenu?(info: { row: number; col: number; x: number; y: number }): void;
  /** Filled in by the grid with things the menus can ask it to do. */
  actions: MutableRefObject<GridActions | null>;
  /** The help for a formula being typed, drawn under the editor. */
  assist?: ReactNode;
  /** Gets each key before the editor does, and returns true to take it (to pick a completion, say). */
  onAssistKey?(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean;
  /** Called when the caret in the editor moves, with where it is in the text. */
  onCaret?(position: number): void;
  /** What the kinds of badge an app uses mean (see `ChipKind`). */
  chips?: Readonly<Record<string, ChipKind>>;
  /** Called to open the card of a badge whose kind has one (`ChipKind.card`): when the badge is clicked, or Space or Alt+Enter is pressed on its cell. */
  onChipCard?(info: ChipCardInfo): void;
  /** The badge whose card is open, so that clicking it again closes the card. */
  chipCard?: { row: number; col: number; value: string } | null;
  /** Called when the button on a dropdown or badge cell is pressed, with the cell and where the button is (in the window). */
  onChoiceMenu?(info: { row: number; col: number; x: number; y: number }): void;
  /** The chart that is selected, if one is. Selecting cells and selecting a chart exclude each other. */
  chartId?: string | null;
  onChartSelect?(id: string | null): void;
  /** Called for a right click on a chart, with where it was (in the window). */
  onChartMenu?(info: { id: string; x: number; y: number }): void;
  /** Called when a chart is double-clicked. */
  onChartEdit?(id: string): void;
  /** The picture that is in crop mode, if one is (it is also `chartId`): its edges crop it, dragging inside it moves it under the frame, the whole picture shows dimmed, and Enter or Escape lets go. */
  cropId?: string | null;
  onCropExit?(): void;
  /** The C key was pressed on a picked picture: put it in crop mode (the app sets `cropId`). */
  onCropEnter?(id: string): void;
  /** The note a data validation shows beside the active cell. */
  prompt?: { title?: string; text: string } | null;
  /** Cells to circle in red, because what they hold breaks a data validation. */
  invalid?: readonly { row: number; col: number }[];
  /** Page breaks to draw: after which rows and columns, and whether they were made by hand (drawn darker) or fall where a page is full. */
  pageBreaks?: { rows: { after: number; manual: boolean }[]; cols: { after: number; manual: boolean }[] } | undefined;
  /** The page break preview: the print ranges outlined, page numbers over the pages, and breaks and range edges that can be dragged. */
  pageView?: PageBreakView | undefined;
  /** Cells to mark as found by Find, as `row:col`. The one that is active shows as the current one. */
  found?: ReadonlySet<string>;
  /** Called with the cell a link or note card is about (the selected one, or the one the pointer rests on) and where it is in the window, or null when there is none. */
  onCellCard?(info: CellCardInfo | null): void;
  /** Called to follow a link: Alt+Enter on a cell that has one. */
  onLinkOpen?(link: CellLink, address?: string): void;
  /** Called with picture files that were pasted (when nothing else was on the clipboard) or dropped onto the grid, with the cell they landed on (the active one for a paste). */
  onImageFiles?(files: File[], at: { row: number; col: number }): void;
  /** Draw the pictures that `IMAGE` formulas fetch from the web (default false: opening a workbook shouldn't contact other sites; the cell shows its text instead). */
  remoteImages?: boolean;
  /** A filter view showing for this person: rows to hide and to show on top of what the sheet's own filter does. Nothing in the workbook changes. */
  viewRows?: { hide: readonly number[]; show: readonly number[] } | null;
  /** Called to say why an entry was refused (a checkbox that was typed over, a value a dropdown doesn't allow). */
  onProblem?(message: string): void;
  /** Called when a note box that stays showing is double-clicked: the note of the (now selected) cell is to be edited. */
  onNoteEdit?(): void;
  /** Cells that have a comment thread: each gets a mark in its corner, and the card shows the thread when the pointer rests on it. */
  threads?: readonly ThreadMark[];
  /** What other people have selected and are typing in on this sheet: drawn as outlines with their names. */
  peers?: readonly PeerMark[];
  /** Called instead of `onProblem` when the cell is in a range that people may edit with a password they haven't given: ask for it. */
  onEditRange?(range: { sheet: string; name: string }): void;
}

export interface GridActions {
  /** Paste special > Values: the values of the copy made here (formulas as what they work out to), keeping the formats and data validation of the cells they land on; plain text pastes as it always does. */
  /**
   * Pastes at the selection: the copy made here if `text` is the same text, else the HTML table if there is one (with its looks),
   * else the text as tab-separated values. `options` is Paste special: values only, formulas, formats, source widths, no table.
   */
  paste(text: string, html?: string, options?: PasteOptions): void;
  /** Starts editing the active cell, with `text` in it and the caret `back` characters from its end. */
  edit(text?: string, back?: number): void;
  /** Scrolls the sheet so the cell is in view. */
  reveal(row: number, col: number): void;
}

type Hit =
  | { kind: "corner" }
  | { kind: "col"; col: number; resize?: number }
  | { kind: "row"; row: number; resize?: number }
  | { kind: "cell"; row: number; col: number }
  | { kind: "filter"; col: number; x: number; y: number; table?: string }
  | { kind: "exception"; row: number; col: number; x: number; y: number }
  | { kind: "slicer"; id: string; part: "move" | "grip" | "clear" | "item" | "body"; value?: string }
  | { kind: "checkbox"; row: number; col: number }
  | { kind: "choice"; row: number; col: number; x: number; y: number }
  | { kind: "border" }
  | { kind: "fill" }
  /** The outline of a reference in the formula being typed: its edge moves the reference, its bottom right corner stretches it. */
  | { kind: "refdrag"; index: number; part: "edge" | "corner" }
  | { kind: "chart"; id: string; mode: ChartGrip }
  | { kind: "outline"; axis: "row" | "col"; index: number }
  /** A 1 2 3 button in the outline margin: shows the rows or columns down to this level. */
  | { kind: "level"; axis: "row" | "col"; level: number }
  /** The outline margin, between its buttons. */
  | { kind: "margin" }
  /** A page break line in the page break preview, and an edge of a print range. */
  | { kind: "pbreak"; axis: "row" | "col"; after: number; manual: boolean }
  | { kind: "parea"; index: number; edge: "top" | "bottom" | "left" | "right" };

/** Where a chart is held: `move` by its body, or one of its corners and edges to resize it. */
type ChartGrip = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
interface ChartBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

const GRIP_CURSOR: Record<ChartGrip, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
/** The least a picture may be dragged down to, in pixels. */
const MIN_PICTURE_SIZE = 16;
/** How long a finger rests on a cell before it counts as a long press, and how far it may wander and still be a tap (not a scroll). */
const LONG_PRESS_MS = 500;
const TAP_SLOP = 10;
const GRIPS: ChartGrip[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The corner or edge point of a chart's box that a grip sits on. */
function gripPoint(b: ChartBox, g: ChartGrip): { x: number; y: number } {
  const x = g.includes("w") ? b.left : g.includes("e") ? b.left + b.w : b.left + b.w / 2;
  const y = g.includes("n") ? b.top : g.includes("s") ? b.top + b.h : b.top + b.h / 2;
  return { x, y };
}

type Drag =
  | { kind: "select"; anchor: { row: number; col: number }; more?: Bounds[] }
  | { kind: "cols"; from: number; more?: Bounds[] }
  | { kind: "rows"; from: number; more?: Bounds[] }
  | { kind: "move"; source: Bounds; grab: { row: number; col: number }; copy: boolean }
  | { kind: "point"; start: { row: number; col: number }; at: number; length: number; prefix: string }
  | { kind: "ref"; part: "edge" | "corner"; at: number; length: number; bounds: Bounds; grab: { row: number; col: number }; prefix: string; absolute: [boolean, boolean, boolean, boolean] }
  | { kind: "resize"; axis: "col" | "row"; index: number; startPx: number; startSize: number }
  | { kind: "fill"; source: Bounds }
  | { kind: "chart" | "slicer"; id: string; mode: ChartGrip; vx: number; vy: number; box: ChartBox; moved: boolean; last?: ChartBox; /** A picture: smaller sizes are allowed, and a corner keeps its proportions. */ image?: boolean; /** A rotated picture's turn, in degrees: its edges are pulled along its own axes. */ rot?: number; /** Alt held on an edge of a picture: the edge crops it. Its crop when the drag began, which way it is mirrored, and the crop now. */ crop?: ImageCrop; mirror?: { h: boolean; v: boolean }; cropNow?: ImageCrop; /** In crop mode, dragging inside the picture moves the picture under its frame instead of moving the frame. */ pan?: boolean; /** The mark under the pointer when it went down (null: none); a click that doesn't move picks it. */ pick?: MarkRef | null; /** A selected 3-D chart pressed inside its plot: dragging turns it. Its view when the drag began, and now. */ turn?: ChartView3d; turnNow?: ChartView3d; /** A trendline label pressed: dragging moves it (its offset when the drag began, the size of the chart, and the offset now). */ tlabel?: { series: number; trend: number; x: number; y: number; w: number; h: number }; labelNow?: { x: number; y: number } }
  | { kind: "pbreak"; axis: "row" | "col"; after: number }
  | { kind: "parea"; index: number; edge: "top" | "bottom" | "left" | "right" };

/** Keeps the pointer's events coming to the grid while it is dragged. A pointer that is already gone (a synthetic event, a touch that ended) just isn't captured. */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture?.(id);
  } catch {
    /* nothing to capture */
  }
}

const hasContent = (cell: Cell | undefined) => !!cell && (cell.v !== undefined || cell.e !== undefined || cell.f !== undefined);

let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = (typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")) ?? null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const fontOf = (s: Cell["s"]) => `${s?.italic ? "italic " : ""}${s?.bold ? "bold " : ""}${s?.fontSize ? Math.round((s.fontSize * 4) / 3) : 13}px ${s?.fontFamily ? fontStack(s.fontFamily) : "ui-sans-serif, system-ui, sans-serif"}`;

interface CellViewProps {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
  /** A `*` in the number format: where in `text` the character repeats to fill the cell. */
  fillAt?: { at: number; char: string };
  /** Wider than the cell: how far the text may run over empty cells to the right. */
  spill: number;
  kind: "number" | "text" | "center";
  cell: Cell | undefined;
  color: string | undefined;
  /** A checkbox: ticked or not. */
  box?: boolean;
  /** Badges, for a dropdown or badge cell. */
  pills?: Pill[];
  /** What the conditional formats do to the cell. */
  effect?: CellEffect | undefined;
  /** How the style of the table the cell is in looks on it. */
  look?: ConditionalStyle | undefined;
}

const CellView = memo(function CellView({ left, top, width, height, text, fillAt, spill, kind, cell, color, box, pills, effect, look }: CellViewProps) {
  const s = cell?.s;
  const es = effect?.style;
  const align = s?.align ?? (kind === "number" ? "right" : kind === "center" ? "center" : "left");
  const style: CSSProperties = { left, top, width, height };
  const fill = es?.fill ?? effect?.scale ?? s?.fill ?? look?.fill;
  if (fill) style.background = fill;
  const inner: CSSProperties = {};
  if (es?.bold || s?.bold || look?.bold) inner.fontWeight = 700;
  if (es?.italic || s?.italic) inner.fontStyle = "italic";
  const deco = [es?.underline || s?.underline ? "underline" : "", es?.strike || s?.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) inner.textDecoration = deco;
  const ink = es?.color ?? color ?? s?.color ?? look?.color;
  if (ink) inner.color = ink;
  const size = es?.fontSize ?? s?.fontSize;
  const family = es?.fontFamily ?? s?.fontFamily;
  if (size) inner.fontSize = `${size}pt`;
  if (family) inner.fontFamily = fontStack(family);
  inner.textAlign = align;
  if (s?.vAlign) inner.alignItems = s.vAlign === "top" ? "flex-start" : s.vAlign === "bottom" ? "flex-end" : "center";
  if (effect?.icon) inner.paddingLeft = 22;
  if (s?.indent && align !== "center") inner[align === "right" ? "paddingRight" : "paddingLeft"] = (effect?.icon && align === "left" ? 22 : 0) + s.indent * 9;
  if (s?.wrap) {
    inner.whiteSpace = "pre-wrap";
    inner.overflowWrap = "anywhere";
  } else if (spill > 0 && align === "left") inner.width = width + spill;
  if (box !== undefined) {
    return (
      <div className="pli-cell" style={style} data-has="">
        <div className="pli-cell-checkbox" data-on={box ? "" : undefined} role="checkbox" aria-checked={box}>
          {box && (
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="m2.5 6.5 2.3 2.3 4.7-5.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
    );
  }
  if (pills) {
    return (
      <div className="pli-cell" style={style} data-has="">
        <div className="pli-cell-pills" style={{ justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start", ...(s?.wrap ? { flexWrap: "wrap", alignContent: "center" } : {}) }}>
          {pills.map((p, i) =>
            p.node ? (
              <span key={i} className="pli-pill-custom" data-chip={p.card ? p.value : undefined}>
                {p.node}
              </span>
            ) : (
              <span key={i} className="pli-pill" data-chip={p.card ? p.value : undefined} style={p.color ? { background: p.color, color: textOn(p.color) } : undefined}>
                {p.image && <img className="pli-pill-image" src={p.image} alt="" draggable={false} />}
                <span className="pli-pill-label">{p.label}</span>
              </span>
            ),
          )}
        </div>
      </div>
    );
  }
  const bar = effect?.bar;
  const shown = effect?.hideText ? "" : text;
  return (
    <div className="pli-cell" style={style} data-has={shown !== "" || effect?.icon || bar ? "" : undefined}>
      {bar && <div className="pli-cell-bar" style={{ left: `${bar.from * 100}%`, width: `${(bar.to - bar.from) * 100}%`, background: bar.solid ? bar.color : `linear-gradient(${bar.rtl ? 270 : 90}deg, ${bar.color}, color-mix(in srgb, ${bar.color} 35%, #fff))`, ...(bar.border ? { border: `1px solid ${bar.borderColor ?? `color-mix(in srgb, ${bar.color} 70%, #000)`}` } : {}) }} />}
      {bar?.axis !== undefined && <div className="pli-cell-axis" style={{ left: `${bar.axis * 100}%`, ...(bar.axisColor ? { background: bar.axisColor } : {}) }} />}
      {effect?.icon && <CfIcon set={effect.icon.set} index={effect.icon.index} count={effect.icon.count} />}
      {shown !== "" && fillAt && !s?.wrap && !effect?.hideText ? (
        <div className="pli-cell-text pli-cell-filled" style={inner}>
          <span>{shown.slice(0, fillAt.at)}</span>
          <span className="pli-cell-fillmid" aria-hidden="true">{fillAt.char.repeat(400)}</span>
          <span>{shown.slice(fillAt.at + fillAt.char.length)}</span>
        </div>
      ) : (
        shown !== "" && (
          <div className="pli-cell-text" style={inner}>
            {shown}
          </div>
        )
      )}
    </div>
  );
});

/** The pixels a border line is thick, and how a line that isn't solid is drawn. */
const LINES: Record<BorderStyle, { t: number; css?: "dashed" | "dotted" | "double" }> = {
  thin: { t: 1 },
  medium: { t: 2 },
  thick: { t: 3 },
  hair: { t: 1, css: "dotted" },
  dotted: { t: 1, css: "dotted" },
  dashed: { t: 1, css: "dashed" },
  double: { t: 3, css: "double" },
};

/** The lines of a cell's (or a merged range's) borders, each drawn on the edge it belongs to so two cells that share an edge draw it in one place. */
function borderLines(key: string, b: CellBorders, left: number, top: number, w: number, h: number): ReactNode[] {
  const out: ReactNode[] = [];
  // A diagonal crosses the cell corner to corner.
  for (const side of ["diagonalUp", "diagonalDown"] as const) {
    const line = b[side];
    if (!line) continue;
    const { t, css } = LINES[line.style];
    const color = line.color ?? "var(--pli-fg)";
    const [x1, y1, x2, y2] = side === "diagonalDown" ? [0, 0, w, h] : [0, h, w, 0];
    out.push(
      <svg key={`${key}${side}`} className="pli-cell-line pli-cell-diagonal" style={{ left, top, width: w, height: h }} width={w} height={h} aria-hidden="true">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={t} {...(css === "dashed" ? { strokeDasharray: "4 3" } : css === "dotted" ? { strokeDasharray: "1.5 2.5" } : {})} />
      </svg>,
    );
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const line = b[side];
    if (!line) continue;
    const { t, css } = LINES[line.style];
    const color = line.color ?? "var(--pli-fg)";
    const horizontal = side === "top" || side === "bottom";
    // The line is centred on the edge (a thin one lies on the cell's own grid line), and runs a little past the corners so lines meet.
    const edge = side === "top" ? top : side === "bottom" ? top + h : side === "left" ? left : left + w;
    const grow = Math.floor(t / 2);
    const style: CSSProperties = horizontal
      ? { left: left - grow, top: edge - Math.ceil(t / 2), width: w + 2 * grow, height: t }
      : { left: edge - Math.ceil(t / 2), top: top - grow, width: t, height: h + 2 * grow };
    if (css) style[horizontal ? "borderTop" : "borderLeft"] = `${t}px ${css} ${color}`;
    else style.background = color;
    out.push(<div key={`${key}${side}`} className="pli-cell-line" style={style} />);
  }
  return out;
}

interface BodyProps {
  session: SheetSession;
  sheet: Sheet;
  revision: number;
  rows: [number, number];
  cols: [number, number];
  colAxis: Axis;
  rowAxis: Axis;
  chips?: Readonly<Record<string, ChipKind>> | undefined;
  /** Whether pictures that `IMAGE` formulas fetch from the web are drawn. */
  remoteImages?: boolean | undefined;
}

/** The cells of one rectangle of the grid. Re-drawn only when the data or what is in view changes, not when the selection moves. */
/** The width of one level of the outline margin, and so of its 1 2 3 buttons. */
export const OUTLINE_LEVEL = 14;

/** The brackets along a group and the plus or minus on its summary row or column, drawn in the outline margin. */
function OutlineMarks({ groups, axis, visible, offset, size }: { groups: OutlineGroup[]; axis: "row" | "col"; visible: readonly number[]; offset(i: number): number; size(i: number): number }) {
  const shown = new Set(visible);
  const first = visible[0] ?? 1;
  const last = visible[visible.length - 1] ?? 1;
  const near = groups.filter((g) => shown.has(g.summary) || shown.has(g.from) || shown.has(g.to) || (g.from < first && g.to > last));
  return (
    <>
      {near.map((g) => {
        const start = offset(g.from);
        const end = offset(g.to) + size(g.to);
        const line = (g.level - 1) * OUTLINE_LEVEL + OUTLINE_LEVEL / 2;
        const bracket = end - start > 2 ? (axis === "row" ? <div className="pli-outline-line" style={{ left: line, top: start + 1, height: end - start - 2 }} /> : <div className="pli-outline-line pli-outline-line-col" style={{ top: line, left: start + 1, width: end - start - 2 }} />) : null;
        const button = g.summary ? (
          axis === "row" ? (
            <div className="pli-outline-button" data-collapsed={g.collapsed ? "" : undefined} style={{ left: g.level * OUTLINE_LEVEL + 1, top: offset(g.summary) + size(g.summary) / 2 - 6 }}>{g.collapsed ? "+" : "\u2212"}</div>
          ) : (
            <div className="pli-outline-button" data-collapsed={g.collapsed ? "" : undefined} style={{ top: g.level * OUTLINE_LEVEL + 1, left: offset(g.summary) + size(g.summary) - 15 }}>{g.collapsed ? "+" : "\u2212"}</div>
          )
        ) : null;
        return (
          <span key={`${g.level}:${g.from}`}>
            {bracket}
            {button}
          </span>
        );
      })}
    </>
  );
}

const Body = memo(function Body({ session, sheet, rows, cols, colAxis: ca, rowAxis: ra, chips, remoteImages }: BodyProps) {
  const out: ReactNode[] = [];
  const lines: ReactNode[] = [];
  const ruled = !!sheet.conditional?.length;
  const tabled = !!sheet.tables?.length;
  // Merged ranges that reach into this rectangle are drawn once, from their top-left cell, and cover the cells under them.
  const merges = mergedRanges(sheet).filter((m) => m.r2 >= rows[0] && m.r1 <= rows[1] && m.c2 >= cols[0] && m.c1 <= cols[1]);
  const covered = new Set<number>();
  for (const m of merges)
    for (let r = Math.max(m.r1, rows[0]); r <= Math.min(m.r2, rows[1]); r++) for (let c = Math.max(m.c1, cols[0]); c <= Math.min(m.c2, cols[1]); c++) covered.add(r * 16385 + c);

  /** One cell, `w` by `h` pixels (more than a grid cell when it is a merged range). */
  const draw = (r: number, c: number, left: number, top: number, w: number, h: number, merged: boolean) => {
    const address = cellAddress(r, c);
    const own = sheet.cells[address];
    // A link is drawn as one, in blue and underlined unless the cell has a colour or underline of its own.
    const linked = own?.link ?? (own?.f !== undefined && HYPERLINK_FORMULA.test(own.f) ? session.link(sheet.id, address) : null);
    const cell = linked && own ? { ...own, s: linkedStyle({ ...own, link: linked }, session.state.themeColors) } : own;
    // A picture in the cell, placed there or asked for by an IMAGE formula. One from the web is drawn only when that is allowed; otherwise its text shows.
    const picture = own?.picture || (own?.f !== undefined && IMAGE_FORMULA.test(own.f)) ? session.cellPicture(sheet.id, address) : null;
    const drawnPicture = picture && (picture.src.startsWith("data:") || remoteImages) ? picture : null;
    const effect = ruled ? session.conditionalEffect(sheet.id, address) : undefined;
    const look = tabled ? tableLook(sheet, r, c, session.state.tableStyles, session.state.themeColors) : undefined;
    let text = "";
    let kind: CellViewProps["kind"] = "text";
    let color: string | undefined;
    let fillAt: CellViewProps["fillAt"];
    let spill = 0;
    const key = `${r}:${c}`;
    if (cell?.control?.type === "checkbox") {
      out.push(<CellView key={key} left={left} top={top} width={w} height={h} text="" spill={0} kind="center" cell={cell} color={undefined} box={isTicked(cell)} effect={effect} look={look} />);
    } else if (cell?.control) {
      out.push(<CellView key={key} left={left} top={top} width={w} height={h} text="" spill={0} kind="text" cell={cell} color={undefined} pills={pillsOf(cell, chips)} effect={effect} look={look} />);
    } else {
      const spilled = !hasContent(cell) && session.calculator.spillAt(sheet.id, r, c) !== undefined;
      if (hasContent(cell) || cell?.fmt || spilled) {
        const value: Value = session.value(sheet.id, address);
        // A conditional format may show the number another way.
        const shown = effect?.style?.fmt ? formatValue(value, effect.style.fmt) : session.display(sheet.id, address);
        text = shown.text;
        fillAt = shown.fill;
        color = shown.color ? COLORS[shown.color.toLowerCase()] : undefined;
        kind = typeof value === "number" ? "number" : typeof value === "boolean" || (value !== null && typeof value === "object") ? "center" : "text";
        if (text !== "" && kind === "number" && !cell?.s?.wrap && textWidth(text, fontOf(cell?.s)) > w - 8) {
          text = "#".repeat(Math.max(1, Math.floor((w - 8) / 7)));
          fillAt = undefined;
        }
        else if (!merged && text !== "" && kind === "text" && !cell?.s?.wrap && !text.includes("\n") && textWidth(text, fontOf(cell?.s)) > w - 8) {
          // Text runs on over the empty cells to its right.
          let c2 = c + 1;
          while (c2 <= cols[1] + 12 && c2 <= MAX_COLS && !hasContent(sheet.cells[cellAddress(r, c2)]) && !mergeAt(sheet, r, c2) && spill < 1200) {
            spill += ca.size(c2);
            c2++;
          }
        }
      }
      if (drawnPicture) {
        text = "";
        fillAt = undefined;
        spill = 0;
      }
      out.push(<CellView key={key} left={left} top={top} width={w} height={h} text={text} fillAt={fillAt} spill={spill} kind={kind} cell={cell} color={color} effect={effect} look={look} />);
      if (drawnPicture) out.push(<CellPictureView key={`p${key}`} left={left} top={top} width={w} height={h} picture={drawnPicture} />);
    }
    // A sparkline is drawn over the cell it sits in.
    if (sheet.sparklines?.length || session.calculator.hasSparklineFormulas(sheet.id)) {
      const shape = session.sparklineShape(sheet.id, address, Math.max(1, w), Math.max(1, h));
      if (shape) out.push(<div key={`s${key}`} className="pli-cell-spark" style={{ left, top, width: w, height: h }} dangerouslySetInnerHTML={{ __html: sparklineSvg(shape) }} />);
    }
    // Lines: the cell's own, over by those a conditional format draws. A merged range takes each side from the cells along that edge.
    let borders = cell?.s?.border;
    if (merged) {
      const m = mergeAt(sheet, r, c)!;
      const at = (row: number, col: number) => sheet.cells[cellAddress(row, col)]?.s?.border;
      const merged4: CellBorders = {};
      const top1 = at(m.r1, m.c1)?.top;
      const left1 = at(m.r1, m.c1)?.left;
      const right1 = at(m.r1, m.c2)?.right;
      const bottom1 = at(m.r2, m.c1)?.bottom;
      const anchorLines = at(m.r1, m.c1);
      if (anchorLines?.diagonalUp) merged4.diagonalUp = anchorLines.diagonalUp;
      if (anchorLines?.diagonalDown) merged4.diagonalDown = anchorLines.diagonalDown;
      if (top1) merged4.top = top1;
      if (left1) merged4.left = left1;
      if (right1) merged4.right = right1;
      if (bottom1) merged4.bottom = bottom1;
      borders = merged4;
    }
    const all = effect?.style?.border || look?.border ? { ...look?.border, ...borders, ...effect?.style?.border } : borders;
    if (all) lines.push(...borderLines(key, all, left, top, w, h));
  };

  for (const m of merges) {
    const left = ca.offset(m.c1);
    const top = ra.offset(m.r1);
    draw(m.r1, m.c1, left, top, ca.offset(m.c2 + 1) - left, ra.offset(m.r2 + 1) - top, true);
  }
  for (let r = rows[0]; r <= rows[1]; r++) {
    const h = ra.size(r);
    if (h === 0) continue;
    const top = ra.offset(r);
    for (let c = cols[0]; c <= cols[1]; c++) {
      const w = ca.size(c);
      if (w === 0 || (covered.size && covered.has(r * 16385 + c))) continue;
      draw(r, c, ca.offset(c), top, w, h, false);
    }
  }
  return (
    <>
      {out}
      {lines}
    </>
  );
});

/** A formula that makes its cell a link. */
const HYPERLINK_FORMULA = /^\s*HYPERLINK\s*\(/i;
/** A formula that may show a picture in its cell. */
const IMAGE_FORMULA = /\bIMAGE\s*\(/i;

/** Whether a picture from the web loaded or didn't, by address, so that drawing the grid again doesn't ask for it again. A failure is forgotten after a minute. */
const loaded = new Map<string, { ok: boolean; at: number }>();
const FORGET_FAILURE_AFTER = 60_000;
const known = (src: string): boolean | undefined => {
  const hit = loaded.get(src);
  if (!hit) return undefined;
  if (!hit.ok && Date.now() - hit.at > FORGET_FAILURE_AFTER) {
    loaded.delete(src);
    return undefined;
  }
  return hit.ok;
};

/** A picture in a cell: fitted to it (kept in proportion), stretched to fill it, at its own size, or at a size given. One from the web that doesn't load shows its description (or address) in its place. */
function CellPictureView({ left, top, width, height, picture }: { left: number; top: number; width: number; height: number; picture: { src: string; alt?: string; sizing: 0 | 1 | 2 | 3; width?: number; height?: number } }) {
  const [ok, setOk] = useState<boolean | undefined>(() => (picture.src.startsWith("data:") ? true : known(picture.src)));
  useEffect(() => setOk(picture.src.startsWith("data:") ? true : known(picture.src)), [picture.src]);
  const style: CSSProperties =
    picture.sizing === 3 && picture.width !== undefined ? { width: picture.width, height: picture.height, objectFit: "fill" } : { width: "100%", height: "100%", objectFit: picture.sizing === 1 ? "fill" : picture.sizing === 2 ? "none" : "contain" };
  if (ok === false) {
    return (
      <div className="pli-cell-picture pli-cell-picture-missing" style={{ left, top, width, height }} title="That picture couldn't be loaded">
        {picture.alt || picture.src}
      </div>
    );
  }
  return (
    <div className="pli-cell-picture" style={{ left, top, width, height }}>
      <img
        src={picture.src}
        alt={picture.alt ?? ""}
        draggable={false}
        style={style}
        onLoad={() => {
          loaded.set(picture.src, { ok: true, at: Date.now() });
        }}
        onError={() => {
          loaded.set(picture.src, { ok: false, at: Date.now() });
          setOk(false);
        }}
      />
    </div>
  );
}

const COLORS: Record<string, string> = { red: "#d93025", blue: "#1a56db", green: "#188038", black: "#000000", white: "#ffffff", cyan: "#00acc1", magenta: "#c2185b", yellow: "#b08900" };

const range = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;

/** The cells of `found` (`row:col`) inside the rows and columns shown. */
function foundIn(found: ReadonlySet<string>, rows: readonly [number, number], cols: readonly [number, number]): [number, number][] {
  const out: [number, number][] = [];
  if (found.size < (rows[1] - rows[0] + 1) * (cols[1] - cols[0] + 1)) {
    for (const key of found) {
      const [row, col] = key.split(":").map(Number) as [number, number];
      if (row >= rows[0] && row <= rows[1] && col >= cols[0] && col <= cols[1]) out.push([row, col]);
    }
  } else {
    for (let row = rows[0]; row <= rows[1]; row++) for (let col = cols[0]; col <= cols[1]; col++) if (found.has(`${row}:${col}`)) out.push([row, col]);
  }
  return out;
}

export function Grid({ session, sheetId, revision, selection, onSelect: onSelectProp, edit, onEdit, onCommit, copied, onCopied, readOnly, sinkRef, onContextMenu, onFilterMenu, onSlicerMenu, onExceptionMenu, actions, assist, onAssistKey, onCaret, chips, onChoiceMenu, onProblem, chartId = null, onChartSelect, onChartMenu, onChartEdit, cropId = null, onCropExit, onCropEnter, prompt = null, invalid = [], found, pageBreaks, onCellCard, onLinkOpen, onImageFiles, remoteImages = false, onNoteEdit, onChipCard, chipCard = null, viewRows = null, onTimelineMenu, pageView, onEditRange, threads, peers }: GridProps) {
  // A font that has just loaded changes how wide text is, so what depends on text widths is worked out again.
  const fontsVersion = useFontsVersion(useFonts());
  const sheet = useMemo(() => session.state.sheets.find((s) => s.id === sheetId) ?? session.state.sheets[0]!, [session, sheetId, revision]);
  /** Selecting a merged cell takes the whole merged range. */
  const merges = mergedRanges(sheet);
  const onSelect = (next: GridSelection) => onSelectProp(expandToMerges(next, merges));
  const viewport = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [extent, setExtent] = useState({ rows: 100, cols: 26 });
  const [preview, setPreview] = useState<{ axis: "col" | "row"; index: number; px: number } | null>(null);
  const [fillTarget, setFillTarget] = useState<Bounds | null>(null);
  const [moveTarget, setMoveTarget] = useState<Bounds | null>(null);
  /** Why dropping the cells where they are held would be refused (merged cells in the way, a locked cell), if it would. */
  const [dropRefused, setDropRefused] = useState<string | null>(null);
  const [pageGhost, setPageGhost] = useState<PageGhost>(null);
  const drag = useRef<Drag | null>(null);
  /** The reference an arrow key is moving through the formula being typed (Point mode): where it is in the text, and the cells it covers. */
  /** A click that began on a badge with a card, which opens it if the pointer comes up on the same cell. */
  /** Touch input: set by the first finger on the grid, cleared by a mouse or pen. The selection handles and the header grips are drawn only then. */
  const [touch, setTouch] = useState(false);
  /** A finger that is down on a cell or heading and has not yet become a tap, a long press or a scroll. */
  const press = useRef<{ id: number; x: number; y: number; moved: boolean; fired: boolean; timer: ReturnType<typeof setTimeout> | undefined; replay: React.PointerEvent } | null>(null);
  const lastLongPress = useRef(0);
  const chipTap = useRef<{ row: number; col: number; value: string; wasOpen: boolean } | null>(null);
  const pointing = useRef<PointState | null>(null);
  /** A chart being dragged or resized, shown where it would land until the pointer is let go. */
  const [chartDrag, setChartDrag] = useState<{ id: string; box: ChartBox; crop?: ImageCrop } | null>(null);
  /** The mark of the picked chart that is picked, a 3-D chart being turned (shown at this view until the pointer is let go), and a trendline label being moved. */
  const [pickedMark, setPickedMark] = useState<(MarkRef & { chart: string }) | null>(null);
  const mark = pickedMark && pickedMark.chart === chartId ? pickedMark : null;
  const setMark = (m: MarkRef | null, chart: string | null = chartId) => setPickedMark(m && chart ? { series: m.series, point: m.point, chart } : null);
  const [turning, setTurning] = useState<{ id: string; view: ChartView3d } | null>(null);
  const [labelMove, setLabelMove] = useState<{ id: string; series: number; trend: number; x: number; y: number } | null>(null);
  /** What a screen reader is told about the picture being picked or cropped (a polite live region by the grid). */
  const [announcement, setAnnouncement] = useState("");
  const announce = (text: string) => setAnnouncement((was) => (was === text ? `${text}\u00a0` : text));
  /** There is an entry in progress, on whichever sheet. */
  const live = edit !== null;
  useEffect(() => {
    if (!live) pointing.current = null;
  }, [live]);
  /** The entry is on the sheet shown, so its editor is drawn here. */
  const editing = live && edit!.sheet === sheet.id;

  // ---- sizes ----
  const colAx0 = useMemo(() => columnAxisOf(sheet), [sheet]);
  const colAx = useMemo(() => (preview?.axis === "col" ? withSize(colAx0, sheet, "col", preview.index, preview.px) : colAx0), [colAx0, sheet, preview]);
  // Rows with wrapped text grow to hold it, unless the sheet gives the row a height.
  const autoRows = useMemo(() => {
    const auto = new Map<number, number>();
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!cell.s?.wrap || !hasContent(cell)) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(address)!;
      const row = Number(m[2]);
      if (sheet.rows?.[m[2]!]?.size !== undefined || sheet.rows?.[m[2]!]?.hidden) continue;
      const col = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const font = fontOf(cell.s);
      const lines = wrapLineCount(session.display(sheet.id, address).text, colAx0.size(col) - 8, (t) => textWidth(t, font));
      const line = cell.s.fontSize ? Math.round((cell.s.fontSize * 4) / 3 * 1.25) : 16;
      auto.set(row, Math.max(auto.get(row) ?? 20, lines * line + 4));
    }
    return auto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheet, revision, colAx0, fontsVersion]);
  // A filter view being shown hides and shows rows for this person only: the sheet's own row settings are laid over with it.
  const shownRows = useMemo(() => {
    if (!viewRows || (!viewRows.hide.length && !viewRows.show.length)) return sheet.rows;
    const rows = { ...sheet.rows };
    for (const r of viewRows.hide) rows[String(r)] = { ...rows[String(r)], hidden: true };
    for (const r of viewRows.show) {
      const { hidden: _gone, ...rest } = rows[String(r)] ?? {};
      if (Object.keys(rest).length) rows[String(r)] = rest;
      else delete rows[String(r)];
    }
    return rows;
  }, [sheet, viewRows]);
  const rowAx = useMemo(() => {
    const base = rowAxis(shownRows, autoRows);
    return preview?.axis === "row" ? withSize(base, shownRows === sheet.rows ? sheet : { ...sheet, rows: shownRows }, "row", preview.index, preview.px, autoRows) : base;
  }, [sheet, shownRows, preview, autoRows]);
  const charts = sheet.charts ?? [];
  const images = sheet.images ?? [];
  const boxOf = (c: { id: string; from: { row: number; col: number; dx?: number; dy?: number }; width: number; height: number; placement?: string; to?: { row: number; col: number; dx?: number; dy?: number } }): ChartBox => {
    if (chartDrag?.id === c.id) return chartDrag.box;
    const left = colAx.offset(c.from.col) + (c.from.dx ?? 0);
    const top = rowAx.offset(c.from.row) + (c.from.dy ?? 0);
    // A picture that sizes with its cells is as big as the cells between its corners are now.
    if (c.placement === "size" && c.to) return { left, top, w: Math.max(MIN_PICTURE_SIZE, colAx.offset(c.to.col) + (c.to.dx ?? 0) - left), h: Math.max(MIN_PICTURE_SIZE, rowAx.offset(c.to.row) + (c.to.dy ?? 0) - top) };
    return { left, top, w: c.width, h: c.height };
  };
  /** A point on the grid as it is in the frame of a picture that is turned: where it would be if the picture were upright. */
  const inFrameOf = (c: { rotation?: number }, box: ChartBox, X: number, Y: number): { X: number; Y: number } => {
    if (!c.rotation) return { X, Y };
    const rad = (c.rotation * Math.PI) / 180;
    const cx = box.left + box.w / 2;
    const cy = box.top + box.h / 2;
    const dx = X - cx;
    const dy = Y - cy;
    return { X: cx + dx * Math.cos(rad) + dy * Math.sin(rad), Y: cy - dx * Math.sin(rad) + dy * Math.cos(rad) };
  };
  const chartData = useMemo(() => new Map(charts.map((c) => [c.id, session.chartData(sheet.id, c.id)])), [session, sheet, revision]);
  /** Slicers of tables that are still there, with the buttons each shows now. */
  const slicers = useMemo(() => [...(sheet.slicers ?? []).filter((x) => session.state.sheets.some((t) => t.tables?.some((tb) => tb.id === x.table))), ...session.pivotPanelsAsSlicers(sheet.id)], [session, sheet, revision]);
  const slicerItems = useMemo(() => new Map<string, SlicerItem[]>(slicers.map((x) => [x.id, session.slicerItems(x.id)])), [session, slicers, revision]);
  const [slicerScroll, setSlicerScroll] = useState<Record<string, number>>({});
  const slicerBoxOf = (x: Slicer): ChartBox => (chartDrag?.id === x.id ? chartDrag.box : { left: colAx.offset(x.from.col) + (x.from.dx ?? 0), top: rowAx.offset(x.from.row) + (x.from.dy ?? 0), w: x.width, h: x.height });
  /** Timelines of tables that are still there, with the periods each draws now. */
  const timelines = useMemo(() => (sheet.timelines ?? []).filter((x) => session.state.sheets.some((t) => t.tables?.some((tb) => tb.id === x.table))), [session, sheet, revision]);
  const timelineData = useMemo(() => new Map(timelines.map((x) => [x.id, session.timelineInfo(x.id)])), [session, timelines, revision]);
  const [timelineGeo, setTimelineGeo] = useState<{ id: string; change: TimelineGeometry } | null>(null);
  const timelineBoxOf = (x: Timeline): ChartBox => {
    const g = timelineGeo?.id === x.id ? timelineGeo.change : null;
    return { left: Math.max(0, colAx.offset(x.from.col) + (x.from.dx ?? 0) + (g?.dx ?? 0)), top: Math.max(0, rowAx.offset(x.from.row) + (x.from.dy ?? 0) + (g?.dy ?? 0)), w: g?.w ?? x.width, h: g?.h ?? x.height };
  };
  /** Moves or resizes a timeline as its own pointer drag says; the sheet takes the new place when the drag ends. */
  const placeTimeline = (x: Timeline, change: TimelineGeometry | null, final: boolean) => {
    if (!final) return setTimelineGeo(change ? { id: x.id, change } : null);
    setTimelineGeo(null);
    if (!change || readOnly) return;
    const left = Math.max(0, colAx.offset(x.from.col) + (x.from.dx ?? 0) + change.dx);
    const top = Math.max(0, rowAx.offset(x.from.row) + (x.from.dy ?? 0) + change.dy);
    const col = colAx.indexAt(left);
    const row = rowAx.indexAt(top);
    try {
      session.updateTimeline(sheet.id, { ...x, from: { row, col, ...(left - colAx.offset(col) >= 1 ? { dx: Math.round(left - colAx.offset(col)) } : {}), ...(top - rowAx.offset(row) >= 1 ? { dy: Math.round(top - rowAx.offset(row)) } : {}) }, width: Math.round(change.w), height: Math.round(change.h) });
    } catch (error) {
      onProblem?.((error as Error).message);
    }
  };
  /** Cells of calculated columns that hold something other than the column's formula. */
  /** The groups of rows and of columns, whose brackets and buttons are drawn in the headers. */
  const rowGroups = useMemo(() => groupsOf(sheet, "row"), [sheet]);
  const colGroups = useMemo(() => groupsOf(sheet, "col"), [sheet]);
  // The outline margin: a band left of the row headings and above the column headings, with a bracket for each group and 1 2 3 buttons in its corner.
  const rowDepth = rowGroups.reduce((m, g) => Math.max(m, g.level), 0);
  const colDepth = colGroups.reduce((m, g) => Math.max(m, g.level), 0);
  const mgW = rowDepth ? (rowDepth + 1) * OUTLINE_LEVEL : colDepth ? OUTLINE_LEVEL + 2 : 0;
  const mgH = colDepth ? (colDepth + 1) * OUTLINE_LEVEL + (rowDepth ? OUTLINE_LEVEL : 0) : rowDepth ? OUTLINE_LEVEL + 2 : 0;
  const hw = HEADER_W + mgW;
  const hh = HEADER_H + mgH;
  /** Cells that have a note, which get a mark in their corner. */
  const noted = useMemo(
    () =>
      Object.entries(sheet.cells)
        .filter(([, c]) => c.note !== undefined)
        .map(([a]) => parseCell(a)!),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet],
  );
  /** Notes that are kept showing, with their cells. */
  const shownNotes = useMemo(
    () =>
      Object.entries(sheet.cells)
        .filter(([, c]) => c.note !== undefined && c.noteBox?.show)
        .map(([address]) => ({ address, ...parseCell(address)!, info: session.noteInfo(sheet.id, address)! })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet],
  );
  const exceptions = useMemo(() => (sheet.tables?.some((t) => t.calculated) ? session.calculatedExceptions(sheet.id).map((e) => parseCell(e.address)!) : []), [session, sheet, revision]);
  const fr = sheet.frozen?.rows ?? 0;
  const fc = sheet.frozen?.cols ?? 0;
  const frozenW = fc ? colAx.offset(fc + 1) : 0;
  const frozenH = fr ? rowAx.offset(fr + 1) : 0;
  const bodyW = Math.max(0, size.w - hw);
  const bodyH = Math.max(0, size.h - hh);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // ---- what is in view ----
  const view = useMemo(() => {
    const x0 = frozenW + scroll.x;
    const y0 = frozenH + scroll.y;
    const c1 = Math.max(fc + 1, colAx.indexAt(x0));
    const c2 = Math.min(MAX_COLS, colAx.indexAt(x0 + bodyW - frozenW) + 1);
    const r1 = Math.max(fr + 1, rowAx.indexAt(y0));
    const r2 = Math.min(MAX_ROWS, rowAx.indexAt(y0 + bodyH - frozenH) + 1);
    return { c1, c2, r1, r2 };
  }, [colAx, rowAx, scroll, frozenW, frozenH, fc, fr, bodyW, bodyH]);

  // The sheet is as large as what is used plus some room, and grows as you scroll or move to its edge.
  const usedRows = useMemo(() => {
    let r = 0;
    let c = 0;
    for (const a of Object.keys(sheet.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(a)!;
      r = Math.max(r, Number(m[2]));
      let n = 0;
      for (const ch of m[1]!) n = n * 26 + ch.charCodeAt(0) - 64;
      c = Math.max(c, n);
    }
    return { r, c };
  }, [sheet]);
  useEffect(() => {
    const active = selection.focus;
    const rows = Math.min(MAX_ROWS, Math.max(100, usedRows.r + 30, active.row + 20, view.r2 + 30));
    const cols = Math.min(MAX_COLS, Math.max(26, usedRows.c + 5, Math.min(active.col, MAX_COLS - 5) + 5, view.c2 + 5));
    setExtent((e) => (e.rows >= rows && e.cols >= cols ? e : { rows: Math.max(e.rows, rows), cols: Math.max(e.cols, cols) }));
  }, [usedRows, selection.focus, view.r2, view.c2]);

  const contentW = colAx.offset(extent.cols + 1);
  const contentH = rowAx.offset(extent.rows + 1);

  // ---- geometry helpers ----
  const cellRect = useCallback(
    (row: number, col: number) => {
      const X = colAx.offset(col);
      const Y = rowAx.offset(row);
      return { x: hw + (col <= fc ? X : X - scroll.x), y: hh + (row <= fr ? Y : Y - scroll.y), w: colAx.size(col), h: rowAx.size(row) };
    },
    [colAx, rowAx, fc, fr, scroll],
  );

  const contentX = (vx: number) => (vx - hw < frozenW ? vx - hw : vx - hw + scroll.x);
  const contentY = (vy: number) => (vy - hh < frozenH ? vy - hh : vy - hh + scroll.y);

  const bounds = selectionBounds(selection);
  const ranges = selectionRanges(selection);
  const single = isSingleCell(selection) && ranges.length === 1;
  const active = activeCell(selection);
  /** The cells a formula in the active cell fills, if it fills any beside itself. */
  const spillBox = session.calculator.spillRange(sheet.id, active.row, active.col);
  const spill = spillBox && (spillBox.r2 > spillBox.r1 || spillBox.c2 > spillBox.c1) ? spillBox : undefined;
  /** A cell that opens a list: a dropdown or badge, or one a data validation takes its list for. */
  const pickable = (row: number, col: number): boolean => {
    if (hasPicker(sheet.cells[cellAddress(row, col)], chips)) return true;
    if (!sheet.validations?.length) return false;
    const rule = session.validationAt(sheet.id, cellAddress(row, col));
    return rule?.kind === "list" && !rule.hideArrow;
  };
  /** Every header row that has filter buttons: the sheet's own filter, and each table's. */
  const filterAreas = useMemo(() => {
    const out: { table?: string; header: number; c1: number; c2: number; on(col: number): boolean; sorted(col: number): "ascending" | "descending" | undefined }[] = [];
    if (sheet.filter) {
      const r = parseRange(sheet.filter.range)!;
      out.push({ header: r.r1, c1: r.c1, c2: r.c2, on: (col) => !!sheet.filter!.columns?.[colName(col)], sorted: () => undefined });
    }
    for (const t of sheet.tables ?? []) {
      if (!hasHeader(t) || t.filterButtons === false) continue;
      const b = parseRange(t.range)!;
      const names = session.tableColumnNames(t);
      out.push({
        table: t.id,
        header: b.r1,
        c1: b.c1,
        c2: b.c2,
        on: (col) => !!t.filters?.[names[col - b.c1] ?? ""],
        sorted: (col) => (t.sort && t.sort.column === names[col - b.c1] ? (t.sort.descending ? "descending" : "ascending") : undefined),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheet]);
  const typedRefs = useMemo(() => (edit ? referencesInText(edit.text) : []), [edit]);

  const hitTest = (vx: number, vy: number): Hit => {
    // In the page break preview, the lines of the breaks and the edges of the print ranges are held first.
    if (pageView && !readOnly && vx > hw && vy > hh) {
      const X = contentX(vx);
      const Y = contentY(vy);
      for (const b of pageView.rows) if (Math.abs(Y - rowAx.offset(b.after + 1)) <= 3 && X >= colAx.offset(b.from) - 3 && X <= colAx.offset(b.to + 1) + 3) return { kind: "pbreak", axis: "row", after: b.after, manual: b.manual };
      for (const b of pageView.cols) if (Math.abs(X - colAx.offset(b.after + 1)) <= 3 && Y >= rowAx.offset(b.from) - 3 && Y <= rowAx.offset(b.to + 1) + 3) return { kind: "pbreak", axis: "col", after: b.after, manual: b.manual };
      for (const [index, a] of pageView.areas.entries()) {
        const [x1, x2, y1, y2] = [colAx.offset(a.c1), colAx.offset(a.c2 + 1), rowAx.offset(a.r1), rowAx.offset(a.r2 + 1)];
        const along = X >= x1 - 3 && X <= x2 + 3;
        const down = Y >= y1 - 3 && Y <= y2 + 3;
        if (along && Math.abs(Y - y1) <= 3) return { kind: "parea", index, edge: "top" };
        if (along && Math.abs(Y - y2) <= 3) return { kind: "parea", index, edge: "bottom" };
        if (down && Math.abs(X - x1) <= 3) return { kind: "parea", index, edge: "left" };
        if (down && Math.abs(X - x2) <= 3) return { kind: "parea", index, edge: "right" };
      }
    }
    // A slicer is over the charts: its header moves it, its corner resizes it, its buttons filter.
    if (slicers.length && vx > hw && vy > hh) {
      const X = contentX(vx);
      const Y = contentY(vy);
      for (let i = slicers.length - 1; i >= 0; i--) {
        const x = slicers[i]!;
        const box = slicerBoxOf(x);
        if (X < box.left || X > box.left + box.w || Y < box.top || Y > box.top + box.h) continue;
        const hit = x.timeline ? timelineHit(slicerItems.get(x.id) ?? [], box.w, box.h, X - box.left, Y - box.top, slicerScroll[x.id] ?? 0) : slicerHit(x, slicerItems.get(x.id) ?? [], box.w, box.h, X - box.left, Y - box.top, slicerScroll[x.id] ?? 0);
        return { kind: "slicer", id: x.id, part: hit.part, ...(hit.part === "item" ? { value: hit.value } : {}) };
      }
    }
    // A chart is over the cells, so it is looked at first: its grips if it is selected, then the chart itself, topmost first.
    if ((charts.length || images.length) && vx > hw && vy > hh) {
      const X = contentX(vx);
      const Y = contentY(vy);
      // Pictures lie under the charts: bottom to top.
      const floating = [...images, ...charts];
      const picked = floating.find((c) => c.id === chartId);
      if (picked && !readOnly) {
        const box = boxOf(picked);
        const p = inFrameOf(picked as { rotation?: number }, box, X, Y);
        for (const g of GRIPS) {
          const pt = gripPoint(box, g);
          if (Math.abs(p.X - pt.x) <= 6 && Math.abs(p.Y - pt.y) <= 6) return { kind: "chart", id: picked.id, mode: g };
        }
      }
      for (let i = floating.length - 1; i >= 0; i--) {
        const box = boxOf(floating[i]!);
        const p = inFrameOf(floating[i] as { rotation?: number }, box, X, Y);
        if (p.X >= box.left && p.X <= box.left + box.w && p.Y >= box.top && p.Y <= box.top + box.h) return { kind: "chart", id: floating[i]!.id, mode: "move" };
      }
    }
    // The outline of a reference in the formula being typed: its edge moves the reference, its bottom right corner stretches it.
    if (live && !readOnly && edit!.text.startsWith("=") && vx > hw && vy > hh) {
      for (let i = typedRefs.length - 1; i >= 0; i--) {
        const r = typedRefs[i]!;
        if (r.sheet === undefined ? !editing : r.sheet.toLowerCase() !== sheet.name.toLowerCase()) continue;
        const a = cellRect(r.bounds.r1, r.bounds.c1);
        const b = cellRect(r.bounds.r2, r.bounds.c2);
        const [x1, y1, x2, y2] = [a.x, a.y, b.x + b.w, b.y + b.h];
        if (Math.abs(vx - x2) <= 5 && Math.abs(vy - y2) <= 5) return { kind: "refdrag", index: i, part: "corner" };
        const near = (v: number, edge: number) => Math.abs(v - edge) <= 3;
        if (((near(vx, x1) || near(vx, x2)) && vy >= y1 - 3 && vy <= y2 + 3) || ((near(vy, y1) || near(vy, y2)) && vx >= x1 - 3 && vx <= x2 + 3)) return { kind: "refdrag", index: i, part: "edge" };
      }
    }
    // The fill handle sits on the selection's bottom right corner.
    if (!editing && !readOnly && !spansColumns(bounds) && !spansRows(bounds)) {
      const r = cellRect(bounds.r2, bounds.c2);
      if (Math.abs(vx - (r.x + r.w)) <= 5 && Math.abs(vy - (r.y + r.h)) <= 5 && vx > hw && vy > hh) return { kind: "fill" };
    }
    // The edge of the selection drags it somewhere else.
    if (!editing && !readOnly && ranges.length === 1 && !spansColumns(bounds) && !spansRows(bounds) && vx > hw && vy > hh) {
      const a = cellRect(bounds.r1, bounds.c1);
      const b = cellRect(bounds.r2, bounds.c2);
      const x1 = a.x;
      const y1 = a.y;
      const x2 = b.x + b.w;
      const y2 = b.y + b.h;
      const near = (v: number, edge: number) => Math.abs(v - edge) <= 3;
      if (((near(vx, x1) || near(vx, x2)) && vy >= y1 - 3 && vy <= y2 + 3) || ((near(vy, y1) || near(vy, y2)) && vx >= x1 - 3 && vx <= x2 + 3)) return { kind: "border" };
    }
    if (mgW > 0 || mgH > 0) {
      if (vx < mgW && vy < mgH) {
        // The 1 2 3 buttons: for the rows along the bottom of the corner, for the columns down its left.
        if (rowDepth && vy >= mgH - OUTLINE_LEVEL) {
          const level = Math.floor(vx / OUTLINE_LEVEL) + 1;
          if (level <= rowDepth + 1) return { kind: "level", axis: "row", level };
        }
        if (colDepth && vx < OUTLINE_LEVEL) {
          const level = Math.floor(vy / OUTLINE_LEVEL) + 1;
          if (level <= colDepth + 1) return { kind: "level", axis: "col", level };
        }
        return { kind: "margin" };
      }
      if (vy < mgH && vx >= hw) {
        // The plus or minus of a column group sits by the right of its summary column.
        const col = colAx.indexAt(contentX(vx));
        const left = hw + (col <= fc ? colAx.offset(col) : colAx.offset(col) - scroll.x);
        const g = colGroups.find((x) => x.summary === col);
        if (g && vx >= left + colAx.size(col) - 16 && vx <= left + colAx.size(col) - 3 && vy >= g.level * OUTLINE_LEVEL && vy <= g.level * OUTLINE_LEVEL + OUTLINE_LEVEL) return { kind: "outline", axis: "col", index: col };
        return { kind: "margin" };
      }
      if (vx < mgW && vy >= hh) {
        const row = rowAx.indexAt(contentY(vy));
        const top = hh + (row <= fr ? rowAx.offset(row) : rowAx.offset(row) - scroll.y);
        const mid = top + rowAx.size(row) / 2;
        const g = rowGroups.find((x) => x.summary === row);
        if (g && vx >= g.level * OUTLINE_LEVEL && vx <= g.level * OUTLINE_LEVEL + OUTLINE_LEVEL && Math.abs(vy - mid) <= 7) return { kind: "outline", axis: "row", index: row };
        return { kind: "margin" };
      }
    }
    if (vx < hw && vy < hh) return { kind: "corner" };
    if (vy < hh) {
      const X = contentX(vx);
      const col = colAx.indexAt(X);
      if (!readOnly) {
        if (Math.abs(X - colAx.offset(col + 1)) <= 4) return { kind: "col", col, resize: col };
        if (col > 1 && Math.abs(X - colAx.offset(col)) <= 4) return { kind: "col", col, resize: col - 1 };
      }
      return { kind: "col", col };
    }
    if (vx < hw) {
      const Y = contentY(vy);
      const row = rowAx.indexAt(Y);
      if (!readOnly) {
        if (Math.abs(Y - rowAx.offset(row + 1)) <= 3) return { kind: "row", row, resize: row };
        if (row > 1 && Math.abs(Y - rowAx.offset(row)) <= 3) return { kind: "row", row, resize: row - 1 };
      }
      return { kind: "row", row };
    }
    const row = rowAx.indexAt(contentY(vy));
    const col = colAx.indexAt(contentX(vx));
    const area = filterAreas.find((a) => a.header === row && col >= a.c1 && col <= a.c2);
    if (area) {
      const r = cellRect(row, col);
      if (vx >= r.x + r.w - 20 && vx <= r.x + r.w && vy >= r.y + r.h - 20) return { kind: "filter", col, x: r.x + r.w - 20, y: r.y + r.h, ...(area.table ? { table: area.table } : {}) };
    }
    // The button beside the active cell, when it holds something other than its calculated column's formula.
    if (single && !editing && !readOnly && exceptions.some((p) => p.row === active.row && p.col === active.col)) {
      const r = cellRect(active.row, active.col);
      if (vx >= r.x - 20 && vx < r.x && vy >= r.y && vy <= r.y + r.h) return { kind: "exception", row: active.row, col: active.col, x: r.x - 20, y: r.y + r.h };
    }
    const target = sheet.cells[cellAddress(row, col)];
    if (target?.control?.type === "checkbox") {
      const r = cellRect(row, col);
      if (Math.abs(vx - (r.x + r.w / 2)) <= 10 && Math.abs(vy - (r.y + r.h / 2)) <= 10) return { kind: "checkbox", row, col };
    }
    if (single && !editing && !readOnly && row === active.row && col === active.col && pickable(row, col)) {
      const r = cellRect(row, col);
      if (vx >= r.x + r.w - 22 && vx <= r.x + r.w) return { kind: "choice", row, col, x: r.x + r.w - 22, y: r.y + r.h };
    }
    return { kind: "cell", row, col };
  };

  // The wheel over a slicer that has more buttons than fit scrolls the buttons, not the sheet.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => {
    if (!slicers.length) return;
    const el = scroller.current;
    if (!el) return;
    const rectEl = el.getBoundingClientRect();
    const vx = e.clientX - rectEl.left;
    const vy = e.clientY - rectEl.top;
    const hit = hitTest(vx, vy);
    if (hit.kind !== "slicer") return;
    const x = slicers.find((t) => t.id === hit.id)!;
    const box = slicerBoxOf(x);
    const max = (x.timeline ? timelineLayout(box.w, box.h, slicerItems.get(x.id)?.length ?? 0) : slicerLayout(x, box.w, box.h, slicerItems.get(x.id)?.length ?? 0)).max;
    if (max <= 0) return;
    e.preventDefault();
    setSlicerScroll((now) => ({ ...now, [x.id]: Math.max(0, Math.min(max, (now[x.id] ?? 0) + (x.timeline && e.deltaX ? e.deltaX : e.deltaY))) }));
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  // ---- keeping the active cell in view ----
  const reveal = useCallback(
    (row: number, col: number) => {
      const el = scroller.current;
      if (!el) return;
      let { x, y } = { x: el.scrollLeft, y: el.scrollTop };
      if (col > fc) {
        const left = colAx.offset(col) - frozenW;
        const right = colAx.offset(col + 1) - frozenW;
        const room = bodyW - frozenW;
        if (left < x) x = left;
        else if (right > x + room) x = right - room;
      }
      if (row > fr) {
        const top = rowAx.offset(row) - frozenH;
        const bottom = rowAx.offset(row + 1) - frozenH;
        const room = bodyH - frozenH;
        if (top < y) y = top;
        else if (bottom > y + room) y = bottom - room;
      }
      if (x !== el.scrollLeft) el.scrollLeft = x;
      if (y !== el.scrollTop) el.scrollTop = y;
    },
    [colAx, rowAx, fc, fr, frozenW, frozenH, bodyW, bodyH],
  );
  const lastFocus = useRef(selection.focus);
  useLayoutEffect(() => {
    const f = editing ? active : selection.focus;
    if (lastFocus.current.row !== f.row || lastFocus.current.col !== f.col) {
      lastFocus.current = f;
      if (!(spansColumns(bounds) && f.row === MAX_ROWS) && !(spansRows(bounds) && f.col === MAX_COLS)) reveal(f.row, f.col);
    }
  });

  // ---- a shaped picture's yellow handles ----
  const [adjusting, setAdjustingState] = useState<{ id: string; adjust: Record<string, number> | undefined } | null>(null);
  const setAdjusting = setAdjustingState;

  // ---- links and notes: the card ----
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [slicerHover, setSlicerHover] = useState<{ id: string; value: string } | null>(null);
  const hoverKey = useRef("");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The ids of the threads that are on this sheet (comments on). */
  const threadCells = useMemo(() => new Set(threads?.map((t) => sheet.cells[cellAddress(t.row, t.col)]?.thread).filter((id): id is string => id !== undefined)), [threads, sheet]);
  const cardWorthy = (row: number, col: number): boolean => {
    const c = sheet.cells[cellAddress(row, col)];
    // A note that stays showing is on the sheet already.
    return !!c && ((c.note !== undefined && !c.noteBox?.show) || c.link !== undefined || (c.thread !== undefined && threadCells.has(c.thread)));
  };
  useEffect(() => {
    clearTimeout(hoverTimer.current);
    hoverKey.current = "";
    setHover(null);
  }, [scroll.x, scroll.y, sheetId]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  // The pointer can travel from the cell to its card (to click a link in a note): the card stays while the pointer is on it, and goes a moment after the pointer leaves both.
  const graceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeHover = () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(graceTimer.current);
    hoverKey.current = "";
    setHover(null);
  };
  const graceClose = () => {
    clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => {
      if (!document.querySelector(".pli-cellcard:hover")) closeHover();
    }, 300);
  };
  useEffect(() => {
    window.addEventListener("pli-cellcard-left", closeHover);
    return () => {
      window.removeEventListener("pli-cellcard-left", closeHover);
      clearTimeout(graceTimer.current);
    };
  }, []);
  const lastCard = useRef("");
  useLayoutEffect(() => {
    if (!onCellCard) return;
    const own = sheet.cells[cellAddress(active.row, active.col)];
    const activeHas = single && !editing && !!own && (own.note !== undefined || own.link !== undefined || (own.thread !== undefined && threadCells.has(own.thread)) || (own.f !== undefined && HYPERLINK_FORMULA.test(own.f) && session.link(sheet.id, cellAddress(active.row, active.col)) !== null));
    let target: { row: number; col: number; active: boolean } | null = null;
    if (hover && !editing && !(activeHas && hover.row === active.row && hover.col === active.col) && cardWorthy(hover.row, hover.col)) target = { ...hover, active: false };
    else if (activeHas) target = { row: active.row, col: active.col, active: true };
    let info: CellCardInfo | null = null;
    const box = viewport.current?.getBoundingClientRect();
    if (target && box) {
      const r = cellRect(target.row, target.col);
      if (r.w > 0 && r.h > 0 && r.x + r.w > hw && r.y + r.h > hh && r.x < viewport.current!.clientWidth && r.y < viewport.current!.clientHeight) info = { ...target, left: box.left + r.x, top: box.top + r.y, right: box.left + r.x + r.w, bottom: box.top + r.y + r.h };
    }
    const key = JSON.stringify(info);
    if (key === lastCard.current) return;
    lastCard.current = key;
    onCellCard(info);
  });
  useEffect(() => () => onCellCard?.(null), []);

  // ---- pointer ----
  const viewportPoint = (e: { clientX: number; clientY: number }) => {
    const r = viewport.current!.getBoundingClientRect();
    return { vx: e.clientX - r.left, vy: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== scroller.current) return;
    const el = scroller.current!;
    const { vx, vy } = viewportPoint(e);
    if (vx >= el.clientWidth || vy >= el.clientHeight) return; // a scrollbar
    const isTouch = e.pointerType === "touch";
    const replayed = (e as { replayed?: true }).replayed === true;
    if (!replayed && isTouch !== touch) setTouch(isTouch);
    let hit = hitTest(vx, vy);
    // A finger is too big for the fill handle, the selection's edge and the heading edges (the handles and grips are there for that): they are just the cell or heading.
    if (isTouch && (hit.kind === "fill" || hit.kind === "border")) hit = { kind: "cell", row: rowAx.indexAt(contentY(vy)), col: colAx.indexAt(contentX(vx)) };
    else if (isTouch && (hit.kind === "col" || hit.kind === "row") && hit.resize !== undefined) hit = hit.kind === "col" ? { kind: "col", col: hit.col } : { kind: "row", row: hit.row };
    if (hit.kind === "pbreak" || hit.kind === "parea") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      capture(el, e.pointerId);
      drag.current = hit.kind === "pbreak" ? { kind: "pbreak", axis: hit.axis, after: hit.after } : { kind: "parea", index: hit.index, edge: hit.edge };
      return;
    }
    if (hit.kind === "outline") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      if (!readOnly) {
        try {
          session.toggleGroup(sheet.id, hit.axis, hit.index);
        } catch (error) {
          reportProblem(error);
        }
      }
      return;
    }
    if (hit.kind === "level" || hit.kind === "margin") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      if (hit.kind === "level" && !readOnly) {
        try {
          session.showLevel(sheet.id, hit.axis, hit.level);
        } catch (error) {
          reportProblem(error);
        }
      }
      return;
    }
    if (hit.kind !== "chart" && chartId) onChartSelect?.(null);
    if (hit.kind === "slicer") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      const x = slicers.find((t) => t.id === hit.id)!;
      if (readOnly) return;
      if (hit.part === "item" && hit.value !== undefined && x.timeline) {
        // A timeline: a period picks its dates; shift or ctrl stretches the dates already picked to it.
        const items = slicerItems.get(x.id) ?? [];
        const at = items.find((i) => i.value === hit.value);
        if (!at || at.start === undefined || at.end === undefined) return;
        const t = x.timeline;
        const stretch = (e.ctrlKey || e.metaKey || e.shiftKey) && t.start !== undefined && t.end !== undefined;
        const same = t.start === at.start && t.end === at.end;
        try {
          if (stretch) session.pivotTimelineSelect(x.id, Math.min(t.start!, at.start), Math.max(t.end!, at.end));
          else if (same) session.pivotTimelineSelect(x.id, null, null);
          else session.pivotTimelineSelect(x.id, at.start, at.end);
        } catch (error) {
          onProblem?.((error as Error).message);
        }
      } else if (hit.part === "item" && hit.value !== undefined) {
        const items = slicerItems.get(x.id) ?? [];
        const now = items.filter((i) => i.selected).map((i) => i.value);
        const multi = e.ctrlKey || e.metaKey || e.shiftKey;
        let next: string[] | null;
        if (multi) next = now.includes(hit.value) ? now.filter((v) => v !== hit.value) : [...now, hit.value];
        else next = now.length === 1 && now[0] === hit.value ? null : [hit.value];
        if (next && !next.length) next = null;
        try {
          session.slicerSelect(x.id, next);
        } catch (error) {
          reportProblem(error);
        }
      } else if (hit.part === "clear") {
        try {
          session.slicerSelect(x.id, null);
        } catch (error) {
          reportProblem(error);
        }
      } else if (hit.part === "move" || hit.part === "grip") {
        capture(el, e.pointerId);
        drag.current = { kind: "slicer", id: x.id, mode: hit.part === "grip" ? "se" : "move", vx, vy, box: slicerBoxOf(x), moved: false };
      }
      return;
    }
    if (hit.kind === "exception") {
      e.preventDefault();
      const box = viewport.current!.getBoundingClientRect();
      onExceptionMenu?.({ row: hit.row, col: hit.col, x: box.left + hit.x, y: box.top + hit.y });
      return;
    }
    if (hit.kind === "chart") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      onChartSelect?.(hit.id);
      const picture = images.find((c) => c.id === hit.id);
      const chart = picture ?? charts.find((c) => c.id === hit.id)!;
      // On a chart: a mark under the pointer is picked by a click, a trendline label is moved by dragging it, and a selected 3-D chart is turned by dragging its plot.
      let chartExtra: Partial<Extract<Drag, { kind: "chart" | "slicer" }>> = {};
      if (!picture && hit.mode === "move") {
        const c = chart as Chart;
        const svg = viewport.current?.querySelector(`[data-chart="${hit.id}"] svg`);
        const here = boxOf(c);
        const lx = contentX(vx) - here.left;
        const ly = contentY(vy) - here.top;
        if (svg) {
          const label = hit.id === chartId && !readOnly ? labelAt(svg, lx, ly) : null;
          const plot = plot3dOf(svg);
          const offset = label ? c.series[label.series]?.trendlines?.[label.trend]?.label : undefined;
          if (label) chartExtra = { tlabel: { series: label.series, trend: label.trend, x: offset?.x ?? 0, y: offset?.y ?? 0, w: here.w, h: here.h } };
          else if (c.view3d && hit.id === chartId && !readOnly && plot && lx >= plot.x && lx <= plot.x + plot.w && ly >= plot.y && ly <= plot.y + plot.h) chartExtra = { turn: c.view3d };
          chartExtra = { ...chartExtra, pick: markAt(svg, lx, ly) };
        }
      }
      if (readOnly && chartExtra.pick !== undefined) setMark(chartExtra.pick, hit.id);
      if (!readOnly) {
        capture(el, e.pointerId);
        drag.current = { ...chartExtra, kind: "chart", id: hit.id, mode: hit.mode, vx, vy, box: boxOf(chart), moved: false, ...(picture ? { image: true } : {}), ...(picture?.rotation ? { rot: picture.rotation } : {}), ...(picture && (e.altKey || cropId === picture.id) && (hit.mode !== "move" || cropId === picture.id) ? { crop: picture.crop ?? {}, mirror: { h: !!picture.flipH, v: !!picture.flipV }, ...(hit.mode === "move" ? { pan: true } : {}) } : {}) };
      }
      return;
    }
    // The outline of a reference being typed is dragged to change where it points.
    if (hit.kind === "refdrag") {
      e.preventDefault();
      capture(el, e.pointerId);
      const r = typedRefs[hit.index]!;
      const written = edit!.text.slice(r.start, r.end);
      const prefix = /^(?:'(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)/.exec(written)?.[0] ?? "";
      const flags = /^(\$?)[A-Za-z]{1,3}(\$?)\d+(?::(\$?)[A-Za-z]{1,3}(\$?)\d+)?$/.exec(written.slice(prefix.length));
      const has = (i: number) => flags?.[i] === "$";
      const absolute: [boolean, boolean, boolean, boolean] = flags?.[3] !== undefined ? [has(1), has(2), has(3), has(4)] : [has(1), has(2), has(1), has(2)];
      pointing.current = null;
      drag.current = { kind: "ref", part: hit.part, at: r.start, length: r.end - r.start, bounds: r.bounds, grab: { row: rowAx.indexAt(contentY(vy)), col: colAx.indexAt(contentX(vx)) }, prefix, absolute };
      return;
    }
    // Clicking a cell while typing a formula puts its address in the formula.
    const sink = sinkRef.current;
    if (live && hit.kind === "cell" && sink && expectsReference(edit!.text, sink.selectionStart ?? edit!.text.length)) {
      e.preventDefault();
      capture(el, e.pointerId);
      const placed = insertReference(hit.row, hit.col);
      if (placed) drag.current = { kind: "point", start: { row: hit.row, col: hit.col }, at: placed.at, length: placed.length, prefix: placed.prefix };
      return;
    }
    if (hit.kind === "checkbox") {
      e.preventDefault();
      if (live) onCommit(null);
      sinkRef.current?.focus({ preventScroll: true });
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) onSelect(caret({ row: hit.row, col: hit.col }));
      if (!readOnly && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
        try {
          session.toggleCheckbox(sheet.id, cellAddress(hit.row, hit.col));
        } catch (error) {
          reportProblem(error);
        }
      }
      return;
    }
    if (hit.kind === "choice") {
      e.preventDefault();
      const box = viewport.current!.getBoundingClientRect();
      onChoiceMenu?.({ row: hit.row, col: hit.col, x: box.left + hit.x, y: box.top + hit.y });
      return;
    }
    if (hit.kind === "filter") {
      e.preventDefault();
      if (live) onCommit(null);
      const box = viewport.current!.getBoundingClientRect();
      onFilterMenu({ col: hit.col, x: box.left + hit.x, y: box.top + hit.y, ...(hit.table ? { table: hit.table } : {}) });
      return;
    }
    // A finger on a cell or heading waits to see what it is: a tap selects (when it is lifted), a long press opens the menu, and moving scrolls.
    if (isTouch && !replayed && (hit.kind === "cell" || hit.kind === "col" || hit.kind === "row" || hit.kind === "corner")) {
      if (press.current) clearTimeout(press.current.timer);
      const replay = { button: 0, target: e.target, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: "touch", replayed: true, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() {} } as unknown as React.PointerEvent;
      const held = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, fired: false, timer: undefined as ReturnType<typeof setTimeout> | undefined, replay };
      held.timer = setTimeout(() => {
        if (press.current !== held || held.moved) return;
        held.fired = true;
        lastLongPress.current = Date.now();
        // The menu is for what was pressed: a cell or heading outside the selection becomes the selection first.
        if (hit.kind !== "cell" || !inSelection(selection, hit.row, hit.col)) {
          onPointerDown(replay);
          drag.current = null;
        }
        sinkRef.current?.focus({ preventScroll: true });
        onContextMenu({ x: held.x, y: held.y });
      }, LONG_PRESS_MS);
      press.current = held;
      return;
    }
    if (live) onCommit(null);
    e.preventDefault();
    sinkRef.current?.focus({ preventScroll: true });
    capture(el, e.pointerId);
    if (hit.kind === "fill") {
      drag.current = { kind: "fill", source: bounds };
      return;
    }
    if (hit.kind === "border") {
      const X = contentX(vx);
      const Y = contentY(vy);
      const grab = { row: Math.min(bounds.r2, Math.max(bounds.r1, rowAx.indexAt(Y))), col: Math.min(bounds.c2, Math.max(bounds.c1, colAx.indexAt(X))) };
      drag.current = { kind: "move", source: bounds, grab, copy: e.ctrlKey || e.altKey };
      return;
    }
    // Ctrl (Cmd) + click on a link follows it, as in Excel; on any other cell it adds the cell to the selection.
    if (hit.kind === "cell" && (e.ctrlKey || e.metaKey) && !e.shiftKey && onLinkOpen) {
      const link = session.link(sheet.id, cellAddress(hit.row, hit.col));
      if (link) {
        onSelect(caret({ row: hit.row, col: hit.col }));
        onLinkOpen(link, cellAddress(hit.row, hit.col));
        return;
      }
    }
    const adding = (e.ctrlKey || e.metaKey) && !e.shiftKey;
    const more = adding ? selectionRanges(selection) : undefined;
    if (hit.kind === "corner") {
      onSelect(selectAll());
      return;
    }
    if (hit.kind === "col") {
      if (hit.resize !== undefined) {
        drag.current = { kind: "resize", axis: "col", index: hit.resize, startPx: e.clientX, startSize: colAx.size(hit.resize) };
        setPreview({ axis: "col", index: hit.resize, px: colAx.size(hit.resize) });
        return;
      }
      const from = e.shiftKey ? selection.anchor.col : hit.col;
      drag.current = { kind: "cols", from, ...(more ? { more } : {}) };
      const next = wholeColumns(from, hit.col, e.shiftKey ? selection.anchor.row : 1);
      onSelect(more ? { ...next, more } : next);
      return;
    }
    if (hit.kind === "row") {
      if (hit.resize !== undefined) {
        drag.current = { kind: "resize", axis: "row", index: hit.resize, startPx: e.clientY, startSize: rowAx.size(hit.resize) };
        setPreview({ axis: "row", index: hit.resize, px: rowAx.size(hit.resize) });
        return;
      }
      const from = e.shiftKey ? selection.anchor.row : hit.row;
      drag.current = { kind: "rows", from, ...(more ? { more } : {}) };
      const next = wholeRows(from, hit.row, e.shiftKey ? selection.anchor.col : 1);
      onSelect(more ? { ...next, more } : next);
      return;
    }
    const pos = { row: hit.row, col: hit.col };
    // A plain click on a badge that has a card opens it when the pointer is let go (a drag still selects).
    chipTap.current = null;
    if (hit.kind === "cell" && onChipCard && !e.shiftKey && !e.altKey && !more && cardChip(sheet.cells[cellAddress(hit.row, hit.col)], chips) !== undefined) {
      const el = chipAt(e.clientX, e.clientY);
      if (el?.dataset.chip !== undefined) chipTap.current = { row: hit.row, col: hit.col, value: el.dataset.chip, wasOpen: chipCard?.row === hit.row && chipCard.col === hit.col && chipCard.value === el.dataset.chip };
    }
    if (e.shiftKey) {
      drag.current = { kind: "select", anchor: selection.anchor, ...(selection.more ? { more: selection.more } : {}) };
      onSelect({ ...selection, focus: pos });
    } else if (more) {
      // Ctrl+click adds another range, or takes a single cell out of the ones there are when it is already selected alone.
      drag.current = { kind: "select", anchor: pos, more };
      onSelect(addRange(selection, caret(pos)));
    } else {
      drag.current = { kind: "select", anchor: pos };
      onSelect(caret(pos));
    }
  };

  /** The row or column a page break dropped at this point comes after: the nearest line between rows or columns. */
  const lineAt = (axis: "row" | "col", at: number) => {
    const ax = axis === "row" ? rowAx : colAx;
    const i = ax.indexAt(at);
    return at - ax.offset(i) >= ax.size(i) / 2 ? i : i - 1;
  };
  /** Where a dragged break or print range edge would land: the line that is shown, and what it means. */
  const pageDragTarget = (d: Extract<Drag, { kind: "pbreak" | "parea" }>, X: number, Y: number): PageGhost => {
    if (d.kind === "pbreak") {
      const after = lineAt(d.axis, d.axis === "row" ? Y : X);
      return after >= 1 && after < (d.axis === "row" ? MAX_ROWS : MAX_COLS) ? { axis: d.axis, after } : null;
    }
    const axis = d.edge === "top" || d.edge === "bottom" ? "row" : "col";
    const line = lineAt(axis, axis === "row" ? Y : X);
    // The line the edge sits on: after which row or column the range begins (a top or left edge) or ends.
    return line >= 0 && line < (axis === "row" ? MAX_ROWS : MAX_COLS) ? { axis, after: line } : null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const held = press.current;
    if (held && held.id === e.pointerId && !held.moved && Math.hypot(e.clientX - held.x, e.clientY - held.y) > TAP_SLOP) {
      // The finger moved before it was lifted: it is scrolling, not tapping.
      held.moved = true;
      clearTimeout(held.timer);
    }
    const { vx, vy } = viewportPoint(e);
    const d = drag.current;
    if (!d) {
      const hit = hitTest(vx, vy);
      const el = scroller.current!;
      el.style.cursor = hit.kind === "pbreak" ? (hit.axis === "row" ? "row-resize" : "col-resize") : hit.kind === "parea" ? (hit.edge === "top" || hit.edge === "bottom" ? "row-resize" : "col-resize") : hit.kind === "chart" ? (readOnly ? "default" : GRIP_CURSOR[hit.mode]) : hit.kind === "fill" ? "crosshair" : hit.kind === "border" ? "move" : hit.kind === "filter" || hit.kind === "exception" || hit.kind === "outline" || hit.kind === "level" ? "pointer" : hit.kind === "slicer" ? (readOnly ? "default" : hit.part === "grip" ? "nwse-resize" : hit.part === "move" ? "move" : hit.part === "item" || hit.part === "clear" ? "pointer" : "default") : hit.kind === "col" && hit.resize !== undefined ? "col-resize" : hit.kind === "row" && hit.resize !== undefined ? "row-resize" : hit.kind === "cell" ? "cell" : "default";
      // A slicer style of your own colours the button under the pointer.
      const over = hit.kind === "slicer" && hit.part === "item" ? { id: hit.id, value: hit.value as string } : null;
      if (over?.id !== slicerHover?.id || over?.value !== slicerHover?.value) setSlicerHover(over);
      el.style.cursor = hit.kind === "pbreak" ? (hit.axis === "row" ? "row-resize" : "col-resize") : hit.kind === "parea" ? (hit.edge === "top" || hit.edge === "bottom" ? "row-resize" : "col-resize") : hit.kind === "chart" ? (readOnly ? "default" : GRIP_CURSOR[hit.mode]) : hit.kind === "fill" ? "crosshair" : hit.kind === "border" ? "move" : hit.kind === "refdrag" ? (hit.part === "corner" ? "nwse-resize" : "move") : hit.kind === "filter" || hit.kind === "exception" || hit.kind === "outline" || hit.kind === "level" ? "pointer" : hit.kind === "slicer" ? (readOnly ? "default" : hit.part === "grip" ? "nwse-resize" : hit.part === "move" ? "move" : hit.part === "item" || hit.part === "clear" ? "pointer" : "default") : hit.kind === "col" && hit.resize !== undefined ? "col-resize" : hit.kind === "row" && hit.resize !== undefined ? "row-resize" : hit.kind === "cell" ? "cell" : "default";
      // Resting on a cell with a note or a link for a moment shows it.
      const key = hit.kind === "cell" ? `${hit.row}:${hit.col}` : "";
      if (key !== hoverKey.current) {
        hoverKey.current = key;
        clearTimeout(hoverTimer.current);
        // A card that is showing waits a moment, in case the pointer is on its way to it.
        if (hover && hit.kind === "cell" && hit.row === hover.row && hit.col === hover.col) clearTimeout(graceTimer.current);
        else if (hover) graceClose();
        else setHover(null);
        if (hit.kind === "cell" && cardWorthy(hit.row, hit.col) && !(hover && hit.row === hover.row && hit.col === hover.col)) {
          const { row, col } = hit;
          hoverTimer.current = setTimeout(() => setHover({ row, col }), 400);
        }
      }
      return;
    }
    if (d.kind === "pbreak" || d.kind === "parea") {
      setPageGhost(pageDragTarget(d, contentX(vx), contentY(vy)));
      return;
    }
    // Scroll when dragging past an edge.
    const el = scroller.current!;
    if (d.kind === "chart" && (d.turn || d.tlabel)) {
      const dx = vx - d.vx;
      const dy = vy - d.vy;
      const moved = d.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
      if (d.turn) {
        const view = turnedView(d.turn, dx, dy);
        drag.current = { ...d, moved, turnNow: view };
        if (moved) setTurning({ id: d.id, view });
      } else if (d.tlabel) {
        const t = d.tlabel;
        const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 1000) / 1000));
        const now = { x: clamp(t.x + dx / t.w), y: clamp(t.y + dy / t.h) };
        drag.current = { ...d, moved, labelNow: now };
        if (moved) setLabelMove({ id: d.id, series: t.series, trend: t.trend, ...now });
      }
      return;
    }
    if (d.kind === "chart" || d.kind === "slicer") {
      // Move the chart, or pull the edges it is held by, but keep it at least a little size and on the sheet.
      const dx = vx - d.vx;
      const dy = vy - d.vy;
      const g = d.mode;
      const rad = ((d.rot ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // The edges of a turned picture are pulled along the picture's own axes, not the screen's.
      const turned = !!d.rot && g !== "move";
      const ldx = turned ? dx * cos + dy * sin : dx;
      const ldy = turned ? -dx * sin + dy * cos : dy;
      let { left, top, w, h } = d.box;
      let crop: ImageCrop | undefined;
      const least = d.image ? MIN_PICTURE_SIZE : MIN_CHART_SIZE;
      if (g === "move" && d.pan && d.crop) {
        // In crop mode, dragging inside the picture slides the picture under its frame: the frame stays, the crop moves.
        const c = d.crop;
        const [cl, cr, ct, cb] = [c.left ?? 0, c.right ?? 0, c.top ?? 0, c.bottom ?? 0];
        const fullW = d.box.w / (1 - cl - cr);
        const fullH = d.box.h / (1 - ct - cb);
        const px = d.rot ? dx * cos + dy * sin : dx;
        const py = d.rot ? -dx * sin + dy * cos : dy;
        const sx = Math.min(Math.max(-(d.mirror?.h ? -px : px) / fullW, -cl), cr);
        const sy = Math.min(Math.max(-(d.mirror?.v ? -py : py) / fullH, -ct), cb);
        crop = { left: cl + sx, right: cr - sx, top: ct + sy, bottom: cb - sy };
      } else if (g === "move") {
        left += dx;
        top += dy;
      } else if (d.crop) {
        // Alt on an edge or corner of a picture cuts it (or, pulled outward, gives back what was cut); the picture keeps its scale.
        const c = d.crop;
        const [cl, cr, ct, cb] = [c.left ?? 0, c.right ?? 0, c.top ?? 0, c.bottom ?? 0];
        const fullW = d.box.w / (1 - cl - cr);
        const fullH = d.box.h / (1 - ct - cb);
        const least = 0.05;
        const next = { left: cl, right: cr, top: ct, bottom: cb };
        // A mirrored picture is cut on the side opposite the one on screen.
        const sideX = (side: "w" | "e") => ((side === "w") !== !!d.mirror?.h ? "left" : "right");
        const sideY = (side: "n" | "s") => ((side === "n") !== !!d.mirror?.v ? "top" : "bottom");
        const clamp = (v: number, hi: number) => Math.min(Math.max(0, v), Math.max(0, hi));
        if (g.includes("w")) next[sideX("w")] = clamp((sideX("w") === "left" ? cl : cr) + ldx / fullW, 1 - least - (sideX("w") === "left" ? cr : cl));
        if (g.includes("e")) next[sideX("e")] = clamp((sideX("e") === "left" ? cl : cr) - ldx / fullW, 1 - least - (sideX("e") === "left" ? cr : cl));
        if (g.includes("n")) next[sideY("n")] = clamp((sideY("n") === "top" ? ct : cb) + ldy / fullH, 1 - least - (sideY("n") === "top" ? cb : ct));
        if (g.includes("s")) next[sideY("s")] = clamp((sideY("s") === "top" ? ct : cb) - ldy / fullH, 1 - least - (sideY("s") === "top" ? cb : ct));
        w = fullW * (1 - next.left - next.right);
        h = fullH * (1 - next.top - next.bottom);
        // The edge on screen that isn't pulled stays put: the box's left moves by what the screen-left side lost.
        const lostLeft = (d.mirror?.h ? next.right - cr : next.left - cl) * fullW;
        const lostTop = (d.mirror?.v ? next.bottom - cb : next.top - ct) * fullH;
        left = d.box.left + lostLeft;
        top = d.box.top + lostTop;
        crop = next;
      } else if (d.image && g.length === 2) {
        // A corner of a picture keeps its proportions: the width follows the pointer and the height follows the width.
        const ratio = d.box.w / d.box.h;
        w = Math.max(least, Math.max(least * ratio, d.box.w + (g.includes("e") ? ldx : -ldx)));
        h = Math.max(least, w / ratio);
        w = h * ratio;
        if (g.includes("w")) left = d.box.left + d.box.w - w;
        if (g.includes("n")) top = d.box.top + d.box.h - h;
      } else {
        if (g.includes("e")) w += ldx;
        if (g.includes("s")) h += ldy;
        if (g.includes("w")) {
          const next = Math.min(w - least, ldx);
          left += next;
          w -= next;
        }
        if (g.includes("n")) {
          const next = Math.min(h - least, ldy);
          top += next;
          h -= next;
        }
        w = Math.max(least, w);
        h = Math.max(least, h);
      }
      if (turned) {
        // The corner or edge opposite the one pulled stays where it is on the screen, so the picture grows from it.
        const turn = (p: { x: number; y: number }, c: { x: number; y: number }) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos });
        const fixedIn = (b: ChartBox) => ({ x: g.includes("e") ? b.left : g.includes("w") ? b.left + b.w : b.left + b.w / 2, y: g.includes("s") ? b.top : g.includes("n") ? b.top + b.h : b.top + b.h / 2 });
        const was = d.box;
        const now: ChartBox = { left, top, w, h };
        const before = turn(fixedIn(was), { x: was.left + was.w / 2, y: was.top + was.h / 2 });
        const after = turn(fixedIn(now), { x: now.left + now.w / 2, y: now.top + now.h / 2 });
        left += before.x - after.x;
        top += before.y - after.y;
      }
      left = Math.max(0, left);
      top = Math.max(0, top);
      const moved = d.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
      const last = { left, top, w: Math.round(w), h: Math.round(h) };
      drag.current = { ...d, moved, last, ...(crop ? { cropNow: crop } : {}) };
      if (moved) setChartDrag({ id: d.id, box: last, ...(crop ? { crop } : {}) });
      return;
    }
    if (d.kind !== "resize" && d.kind !== "point" && d.kind !== "ref") {
      if (vx > size.w - 12) el.scrollLeft += 24;
      else if (vx < hw + frozenW + 12 && el.scrollLeft > 0) el.scrollLeft -= 24;
      if (vy > size.h - 12) el.scrollTop += 24;
      else if (vy < hh + frozenH + 12 && el.scrollTop > 0) el.scrollTop -= 24;
    }
    const X = Math.min(contentX(Math.max(hw, vx)), colAx.offset(MAX_COLS + 1) - 1);
    const Y = Math.min(contentY(Math.max(hh, vy)), rowAx.offset(MAX_ROWS + 1) - 1);
    const col = colAx.indexAt(X);
    const row = rowAx.indexAt(Y);
    if (d.kind === "select") onSelect({ anchor: d.anchor, focus: { row, col }, ...(d.more ? { more: d.more } : {}) });
    else if (d.kind === "cols") onSelect({ ...wholeColumns(d.from, col, selection.anchor.row), ...(d.more ? { more: d.more } : {}) });
    else if (d.kind === "rows") onSelect({ ...wholeRows(d.from, row, selection.anchor.col), ...(d.more ? { more: d.more } : {}) });
    else if (d.kind === "move") {
      const h = d.source.r2 - d.source.r1;
      const w = d.source.c2 - d.source.c1;
      const r1 = Math.max(1, Math.min(MAX_ROWS - h, row - (d.grab.row - d.source.r1)));
      const c1 = Math.max(1, Math.min(MAX_COLS - w, col - (d.grab.col - d.source.c1)));
      const unmoved = r1 === d.source.r1 && c1 === d.source.c1;
      setMoveTarget(unmoved ? null : { r1, c1, r2: r1 + h, c2: c1 + w });
      setDropRefused(unmoved ? null : session.relocateProblem({ sheet: sheet.id, range: rangeAddress(d.source) }, { sheet: sheet.id, at: cellAddress(r1, c1) }, { copy: d.copy }));
    } else if (d.kind === "ref" && edit) {
      const h = d.bounds.r2 - d.bounds.r1;
      const w = d.bounds.c2 - d.bounds.c1;
      const b: Bounds =
        d.part === "edge"
          ? (() => {
              const r1 = Math.max(1, Math.min(MAX_ROWS - h, d.bounds.r1 + row - d.grab.row));
              const c1 = Math.max(1, Math.min(MAX_COLS - w, d.bounds.c1 + col - d.grab.col));
              return { r1, c1, r2: r1 + h, c2: c1 + w };
            })()
          : { ...d.bounds, r2: Math.max(d.bounds.r1, row), c2: Math.max(d.bounds.c1, col) };
      const [ca1, ra1, ca2, ra2] = d.absolute;
      const one = `${ca1 ? "$" : ""}${colName(b.c1)}${ra1 ? "$" : ""}${b.r1}`;
      const token = d.prefix + (b.r1 === b.r2 && b.c1 === b.c2 ? one : `${one}:${ca2 ? "$" : ""}${colName(b.c2)}${ra2 ? "$" : ""}${b.r2}`);
      if (token !== edit.text.slice(d.at, d.at + d.length)) {
        onEdit({ ...edit, text: edit.text.slice(0, d.at) + token + edit.text.slice(d.at + d.length) });
        drag.current = { ...d, length: token.length };
        onCaret?.(d.at + token.length);
        requestAnimationFrame(() => sinkRef.current?.setSelectionRange(d.at + token.length, d.at + token.length));
      }
    } else if (d.kind === "point" && edit) {
      const token = d.prefix + (d.start.row === row && d.start.col === col ? cellAddress(row, col) : rangeAddress({ r1: Math.min(d.start.row, row), c1: Math.min(d.start.col, col), r2: Math.max(d.start.row, row), c2: Math.max(d.start.col, col) }));
      onEdit({ ...edit, text: edit.text.slice(0, d.at) + token + edit.text.slice(d.at + d.length), mode: "enter" });
      drag.current = { ...d, length: token.length };
      requestAnimationFrame(() => sinkRef.current?.setSelectionRange(d.at + token.length, d.at + token.length));
    }
    else if (d.kind === "resize") {
      const delta = (d.axis === "col" ? e.clientX : e.clientY) - d.startPx;
      setPreview({ axis: d.axis, index: d.index, px: Math.max(MIN_SIZE_PX, d.startSize + delta) });
    } else if (d.kind === "fill") {
      const s = d.source;
      const dr = row > s.r2 ? row - s.r2 : row < s.r1 ? s.r1 - row : 0;
      const dc = col > s.c2 ? col - s.c2 : col < s.c1 ? s.c1 - col : 0;
      if (dr === 0 && dc === 0) setFillTarget(null);
      else {
        const target = dr >= dc ? (row > s.r2 ? { ...s, r2: row } : { ...s, r1: row }) : col > s.c2 ? { ...s, c2: col } : { ...s, c1: col };
        setFillTarget(target);
        setDropRefused(session.fillProblem(sheet.id, rangeAddress(s), rangeAddress(target)));
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const held = press.current;
    if (held && held.id === e.pointerId) {
      press.current = null;
      clearTimeout(held.timer);
      // Lifted without moving or waiting for the long press: a tap, which selects as a click would.
      if (!held.moved && !held.fired && e.type !== "pointercancel") onPointerDown(held.replay);
    }
    const d = drag.current;
    drag.current = null;
    try {
      if (scroller.current?.hasPointerCapture?.(e.pointerId)) scroller.current.releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const tap = chipTap.current;
    chipTap.current = null;
    if (d?.kind === "select" && tap && !tap.wasOpen && onChipCard) {
      const { vx, vy } = viewportPoint(e);
      const at = hitTest(vx, vy);
      if (at.kind === "cell" && at.row === tap.row && at.col === tap.col) openChipCard(tap.row, tap.col, tap.value);
    }
    if (!d) return;
    if (d.kind === "pbreak" || d.kind === "parea") {
      const { vx, vy } = viewportPoint(e);
      const target = pageDragTarget(d, contentX(vx), contentY(vy));
      setPageGhost(null);
      if (!target || !pageView) return;
      try {
        if (d.kind === "pbreak") {
          if (target.after !== d.after) pageView.onMoveBreak(d.axis, d.after, target.after);
        } else pageView.onMoveAreaEdge(d.index, d.edge, d.edge === "top" || d.edge === "left" ? target.after + 1 : target.after);
      } catch (error) {
        onProblem?.((error as Error).message);
      }
      return;
    }
    if (d.kind === "slicer") {
      const box = d.last;
      setChartDrag(null);
      const x = slicers.find((t) => t.id === d.id);
      if (box && x && d.moved && !readOnly) {
        const col = colAx.indexAt(box.left);
        const row = rowAx.indexAt(box.top);
        session.updateSlicer(sheet.id, { ...x, from: { row, col, ...(box.left - colAx.offset(col) >= 1 ? { dx: Math.round(box.left - colAx.offset(col)) } : {}), ...(box.top - rowAx.offset(row) >= 1 ? { dy: Math.round(box.top - rowAx.offset(row)) } : {}) }, width: box.w, height: box.h });
      }
      return;
    }
    if (d.kind === "chart") {
      const box = d.last;
      setChartDrag(null);
      setTurning(null);
      setLabelMove(null);
      if (!d.moved && d.pick !== undefined) setMark(d.pick, d.id);
      if (d.moved && !readOnly && d.turnNow) {
        try {
          session.updateChart(sheet.id, d.id, { view3d: d.turnNow });
        } catch (error) {
          reportProblem(error);
        }
        return;
      }
      if (d.moved && !readOnly && d.tlabel && d.labelNow) {
        const c = charts.find((x) => x.id === d.id);
        const t = d.tlabel;
        if (c) {
          const series = c.series.map((s, i) => (i !== t.series ? s : { ...s, trendlines: s.trendlines?.map((tl, j) => (j !== t.trend ? tl : { ...tl, label: { ...tl.label, x: d.labelNow!.x, y: d.labelNow!.y } })) }));
          try {
            session.updateChart(sheet.id, d.id, { series });
          } catch (error) {
            reportProblem(error);
          }
        }
        return;
      }
      if (box && d.moved && !readOnly) {
        if (d.cropNow) cropTo(d.id, box, d.cropNow);
        else placeFloating(d.id, !!d.image, box);
      }
      return;
    }
    if (d.kind === "resize" && preview) {
      const chars = (d.axis === "col" ? colChars : rowPoints)(preview.px);
      if (d.axis === "col") {
        const picked = spansColumns(bounds) && d.index >= bounds.c1 && d.index <= bounds.c2 ? [bounds.c1, bounds.c2] : [d.index, d.index];
        session.transact(Array.from({ length: Math.min(picked[1]! - picked[0]! + 1, 200) }, (_, i) => ({ type: "set_size" as const, sheet: sheet.id, axis: "col" as const, index: picked[0]! + i, size: chars })));
      } else {
        const picked = spansRows(bounds) && d.index >= bounds.r1 && d.index <= bounds.r2 ? [bounds.r1, bounds.r2] : [d.index, d.index];
        session.transact(Array.from({ length: Math.min(picked[1]! - picked[0]! + 1, 500) }, (_, i) => ({ type: "set_size" as const, sheet: sheet.id, axis: "row" as const, index: picked[0]! + i, size: chars })));
      }
      setPreview(null);
    } else if (d.kind === "move") {
      const t = moveTarget;
      setMoveTarget(null);
      setDropRefused(null);
      // A gesture the browser took over (pointercancel) puts nothing down.
      if (t && !readOnly && e.type !== "pointercancel") {
        const from = { sheet: sheet.id, range: rangeAddress(d.source) };
        const to = { sheet: sheet.id, at: cellAddress(t.r1, t.c1) };
        try {
          if (d.copy) session.copy(from, to);
          else session.move(from, to);
          onSelect({ anchor: { row: t.r1, col: t.c1 }, focus: { row: t.r2, col: t.c2 } });
        } catch (error) {
          onProblem?.((error as Error).message);
        }
      }
    } else if (d.kind === "fill") {
      const t = fillTarget;
      setFillTarget(null);
      setDropRefused(null);
      if (t && !readOnly) {
        try {
          session.autofill(sheet.id, rangeAddress(d.source), rangeAddress(t));
          onSelect({ anchor: { row: t.r1, col: t.c1 }, focus: { row: t.r2, col: t.c2 } });
        } catch (error) {
          onProblem?.((error as Error).message);
        }
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== scroller.current || readOnly) return;
    const { vx, vy } = viewportPoint(e);
    const hit = hitTest(vx, vy);
    if (hit.kind === "chart") {
      onChartEdit?.(hit.id);
      return;
    }
    if (hit.kind === "col" && hit.resize !== undefined) autofit(hit.resize);
    else if (hit.kind === "cell" || hit.kind === "choice") {
      if (hasPicker(sheet.cells[cellAddress(hit.kind === "cell" ? hit.row : hit.row, hit.col)], chips)) openChoices(hit.row, hit.col);
      else startEdit("edit", undefined, hit.row, hit.col);
    }
  };

  const autofit = (col: number) => {
    let widest = 0;
    let n = 0;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(address)!;
      if (m[1] !== colName(col) || !hasContent(cell) || ++n > 3000) continue;
      widest = Math.max(widest, textWidth(session.display(sheet.id, address).text, fontOf(cell.s)) + 14);
    }
    if (widest > 0) session.setColumnWidth(sheet.id, col, colChars(Math.min(600, Math.max(MIN_SIZE_PX * 3, widest))));
  };

  /** A finger on one of the touch handles: the round ones stretch the selection from its opposite corner, the square one fills. */
  const grabHandle = (e: React.PointerEvent<HTMLElement>, which: "start" | "end" | "fill") => {
    e.preventDefault();
    e.stopPropagation();
    if (live) onCommit(null);
    sinkRef.current?.focus({ preventScroll: true });
    capture(e.currentTarget, e.pointerId);
    drag.current = which === "fill" ? { kind: "fill", source: bounds } : { kind: "select", anchor: which === "end" ? { row: bounds.r1, col: bounds.c1 } : { row: bounds.r2, col: bounds.c2 } };
  };
  /**
   * A finger on the move handle beside the selection: dragging it moves the selected cells by as far as the finger goes (the
   * mouse does this from the selection's edge). The cells land where the outline shows when the finger is lifted.
   */
  const grabMove = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (live) onCommit(null);
    sinkRef.current?.focus({ preventScroll: true });
    capture(e.currentTarget, e.pointerId);
    const { vx, vy } = viewportPoint(e);
    // The handle is outside the selection, so the cell under the finger is not clamped to it: the selection moves by the distance the finger does.
    drag.current = { kind: "move", source: bounds, grab: { row: rowAx.indexAt(contentY(vy)), col: colAx.indexAt(contentX(vx)) }, copy: false };
  };
  /** A finger on the edge of a column or row heading, which it pulls to resize (a mouse does this at the edge itself). */
  const grabGrip = (e: React.PointerEvent<HTMLElement>, axis: "col" | "row", index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (live) onCommit(null);
    capture(e.currentTarget, e.pointerId);
    const ax = axis === "col" ? colAx : rowAx;
    drag.current = { kind: "resize", axis, index, startPx: axis === "col" ? e.clientX : e.clientY, startSize: ax.size(index) };
    setPreview({ axis, index, px: ax.size(index) });
  };

  /** The badge on the screen under a point in the window, if it is one that opens a card. */
  const chipAt = (x: number, y: number): HTMLElement | null => {
    for (const el of viewport.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  };
  /** Opens the card of the badge for `value` in a cell, under the badge (or under the cell when the badge can't be found). */
  const openChipCard = (row: number, col: number, value: string) => {
    const box = viewport.current!.getBoundingClientRect();
    const c = cellRect(row, col);
    const cell = { left: box.left + c.x, top: box.top + c.y, right: box.left + c.x + c.w, bottom: box.top + c.y + c.h };
    let near: DOMRect | undefined;
    for (const el of viewport.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? []) {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (el.dataset.chip === value && r.width > 0 && cx >= cell.left && cx <= cell.right && cy >= cell.top && cy <= cell.bottom) {
        near = r;
        break;
      }
    }
    onChipCard?.({ row, col, value, ...(near ? { left: near.left, top: near.top, right: near.right, bottom: near.bottom } : cell) });
  };

  /** Opens the list or picker of a dropdown or badge cell. */
  const openChoices = (row: number, col: number) => {
    if (readOnly || !onChoiceMenu) return;
    const r = cellRect(row, col);
    const box = viewport.current!.getBoundingClientRect();
    onChoiceMenu({ row, col, x: box.left + r.x, y: box.top + r.y + r.h });
  };

  // ---- editing ----
  /** Says why a cell can't be changed (or asks for the password of the range it is in) and returns true, or returns false when it can. */
  const blocked = (row: number, col: number): boolean => {
    const why = session.editBlock(sheet.id, cellAddress(row, col));
    if (!why) return false;
    if (why.editRange && onEditRange) onEditRange(why.editRange);
    else onProblem?.(why.message);
    return true;
  };
  const reportProblem = (e: unknown) => {
    const range = (e as { editRange?: { sheet: string; name: string } }).editRange;
    if (range && onEditRange) onEditRange(range);
    else onProblem?.((e as Error).message);
  };
  const startEdit = (mode: "enter" | "edit", text: string | undefined, row = active.row, col = active.col, back = 0) => {
    if (readOnly) return;
    if (blocked(row, col)) return;
    const cell = sheet.cells[cellAddress(row, col)];
    // A formula that is hidden (on a protected sheet) isn't shown to be edited; what is typed replaces it.
    const current = session.formulaHidden(sheet.id, cellAddress(row, col)) ? "" : cell?.f !== undefined ? "=" + cell.f : cell?.v !== undefined ? String(cell.v) : cell?.e ?? "";
    // Dates and percentages are edited the way they show, as in Excel.
    let initial = text ?? current;
    if (text === undefined && typeof cell?.v === "number" && cell.fmt) {
      const shown = session.display(sheet.id, cellAddress(row, col)).text;
      if (/%$/.test(shown) || /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(shown)) initial = shown;
    }
    onEdit({ row, col, text: initial, mode, from: "grid", sheet: sheet.id });
    requestAnimationFrame(() => {
      const el = sinkRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (text === undefined || back > 0) el.setSelectionRange(el.value.length - back, el.value.length - back);
    });
  };

  /** Puts a cell's address in the formula being typed, in place of a reference just before the cursor if there is one. */
  const insertReference = (row: number, col: number): { at: number; length: number; prefix: string } | null => {
    if (!edit) return null;
    const sink = sinkRef.current;
    const at = sink?.selectionStart ?? edit.text.length;
    const end = sink?.selectionEnd ?? at;
    // From another sheet, the address says which sheet it is on.
    const prefix = edit.sheet !== sheet.id ? `${sheetRef(sheet.name)}!` : "";
    const ref = prefix + cellAddress(row, col);
    const prev = edit.text.slice(0, at).replace(/\s+$/, "");
    const lastToken = /(?:'(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)?[A-Za-z$0-9:]+$/.exec(prev)?.[0];
    const replaceFrom = lastToken && /^(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?[A-Za-z$]*\$?\d+(:[A-Za-z$0-9]+)?$/.test(lastToken) ? at - lastToken.length : at;
    const text = edit.text.slice(0, replaceFrom) + ref + edit.text.slice(end);
    onEdit({ ...edit, text, mode: "enter" });
    requestAnimationFrame(() => sink?.setSelectionRange(replaceFrom + ref.length, replaceFrom + ref.length));
    return { at: replaceFrom, length: ref.length, prefix };
  };

  /** Puts a chart or picture where `box` is on the grid: its corner in the cell there, and the size. */
  const placeFloating = (id: string, picture: boolean, box: ChartBox) => {
    const col = colAx.indexAt(box.left);
    const row = rowAx.indexAt(box.top);
    const change = {
      from: { row, col, dx: Math.max(0, Math.round(box.left - colAx.offset(col))), dy: Math.max(0, Math.round(box.top - rowAx.offset(row))) },
      width: Math.round(box.w),
      height: Math.round(box.h),
    };
    if (picture) session.updateImage(sheet.id, id, change);
    else session.updateChart(sheet.id, id, change);
  };
  /** Crops a picture by dragging: its new box and the crop that goes with it, in one step. */
  const cropTo = (id: string, box: ChartBox, crop: ImageCrop) => {
    const col = colAx.indexAt(box.left);
    const row = rowAx.indexAt(box.top);
    const cut = (crop.left ?? 0) + (crop.right ?? 0) + (crop.top ?? 0) + (crop.bottom ?? 0) > 0.0005;
    session.updateImage(sheet.id, id, {
      from: { row, col, dx: Math.max(0, Math.round(box.left - colAx.offset(col))), dy: Math.max(0, Math.round(box.top - rowAx.offset(row))) },
      width: Math.round(box.w),
      height: Math.round(box.h),
      crop: cut ? crop : undefined,
    });
  };
  /** Shows a chart or picture: scrolls the sheet to its top left cell if it is out of view. */
  const revealBox = (box: ChartBox) => reveal(Math.max(1, rowAx.indexAt(box.top)), Math.max(1, colAx.indexAt(box.left)));

  // ---- keyboard ----
  const filled = (r: number, c: number) => hasContent(sheet.cells[cellAddress(r, c)]);

  /**
   * Point mode: while a formula is being typed where a reference could go (or one has just been pointed at), an arrow key
   * moves the reference instead of the text cursor. Shift extends it to a range, Ctrl (Cmd) jumps to the edge of the data.
   * Returns false when the key is not for pointing.
   */
  const pointWithArrow = (e: ReactKeyboardEvent<HTMLTextAreaElement>, key: string): boolean => {
    if (!edit) return false;
    const el = e.currentTarget;
    const here = edit.sheet === sheet.id ? { row: edit.row, col: edit.col } : active;
    const step = pointStep({
      text: edit.text,
      selStart: el.selectionStart ?? edit.text.length,
      selEnd: el.selectionEnd ?? el.selectionStart ?? edit.text.length,
      was: pointing.current,
      here,
      key,
      shift: e.shiftKey,
      mod: e.ctrlKey || e.metaKey,
      filled,
      ...(edit.sheet !== sheet.id ? { otherSheet: sheet.name } : {}),
    });
    if (!step) return false;
    e.preventDefault();
    pointing.current = step.state;
    onEdit({ ...edit, text: step.text, mode: "enter" });
    reveal(step.state.focus.row, step.state.focus.col);
    onCaret?.(step.caret);
    requestAnimationFrame(() => sinkRef.current?.setSelectionRange(step.caret, step.caret));
    return true;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    // The paste event that follows Ctrl+Shift+V doesn't say Shift was down.
    valuesOnly.current = mod && e.shiftKey && !e.altKey && key.toLowerCase() === "v";
    // Pictures and charts can be reached from the keyboard: Alt+Shift+Down and Up step through them, and so does Tab once one is picked.
    const floating = [...images, ...charts];
    const pick = (step: 1 | -1) => {
      if (!floating.length) return false;
      const at = floating.findIndex((c) => c.id === chartId);
      const next = floating[at < 0 ? (step === 1 ? 0 : floating.length - 1) : (at + step + floating.length) % floating.length]!;
      onChartSelect?.(next.id);
      revealBox(boxOf(next));
      announce(pickedWords(next, floating.indexOf(next) + 1, floating.length));
      return true;
    };
    if (!live && e.altKey && e.shiftKey && !mod && (key === "ArrowDown" || key === "ArrowUp") && pick(key === "ArrowDown" ? 1 : -1)) {
      e.preventDefault();
      return;
    }
    if (chartId && !live) {
      const picked = floating.find((c) => c.id === chartId);
      const cropped = images.find((i) => i.id === chartId);
      if (cropped && !readOnly && cropId !== chartId && !mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "c") {
        // C puts a picked picture in crop mode.
        e.preventDefault();
        onCropEnter?.(chartId);
        announce(`Crop mode, ${cropped.alt || "picture"}. ${cropWords(cropped.crop, boxOf(cropped))} Arrow keys cut the side they name, Shift with an arrow gives it back, Alt with an arrow slides the picture under the frame, Control or Command makes the step small, Enter or Escape finishes.`);
        return;
      }
      if (cropId === chartId && (key === "Enter" || key === "Escape") && !mod && !e.altKey) {
        // Crop mode ends with Enter or Escape; the picture stays picked.
        e.preventDefault();
        onCropExit?.();
        announce(`Crop mode off. ${cropped ? cropWords(cropped.crop, boxOf(cropped)) : ""}`);
        return;
      }
      if (cropped && cropId === chartId && (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown")) {
        // In crop mode the arrow keys crop: an arrow cuts the side it names (Shift gives back what was cut, Alt slides the picture under the frame), 10 pixels at a time, or 1 with Ctrl or Cmd.
        e.preventDefault();
        if (readOnly) return;
        const step = mod ? 1 : 10;
        const box = boxOf(cropped);
        const mirror = { h: !!cropped.flipH, v: !!cropped.flipV };
        const screen = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "top" : "bottom";
        try {
          if (e.altKey) {
            const dx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
            const dy = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;
            const moved = panCrop(box, cropped.crop, dx, dy, mirror);
            if (!moved) return announce("The picture can't slide any further that way.");
            cropTo(cropped.id, box, moved);
            announce(`Picture slid ${screen === "left" ? "left" : screen === "right" ? "right" : screen === "top" ? "up" : "down"}. ${cropWords(moved, box)}`);
            return;
          }
          const result = nudgeCrop(box, cropped.crop, screen, e.shiftKey ? -step : step, mirror);
          if (!result) return announce(e.shiftKey ? `Nothing cut off the ${screen} to give back.` : `The ${screen} can't be cut any more.`);
          cropTo(cropped.id, result.box, result.crop);
          announce(`${e.shiftKey ? "Gave back" : "Cut"} the ${screen}. ${cropWords(result.crop, result.box)}`);
        } catch (error) {
          reportProblem(error);
        }
        return;
      }
      // Marks of a picked chart: M picks the first, the arrow keys move between them (left and right along a series, up and down between series), Escape lets go. Alt with an arrow turns a 3-D chart.
      const pickedChart = picked && !cropped ? charts.find((c) => c.id === chartId) : undefined;
      const chartSvg = pickedChart ? viewport.current?.querySelector(`[data-chart="${chartId}"] svg`) : null;
      if (pickedChart && chartSvg && !mod) {
        const isArrow = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
        if (mark && key === "Escape") {
          e.preventDefault();
          setMark(null);
          return;
        }
        if (mark && isArrow && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          const next = stepMark(listMarks(chartSvg), mark, key);
          setMark(next);
          const shownData = chartData.get(pickedChart.id);
          if (shownData) announce(describeMark(pickedChart, shownData, next));
          return;
        }
        if (!mark && (key === "m" || key === "M") && !e.altKey && !e.shiftKey) {
          const first = listMarks(chartSvg)[0];
          e.preventDefault();
          if (!first) return announce("This chart has no marks to pick.");
          setMark(first);
          const shownData = chartData.get(pickedChart.id);
          if (shownData) announce(describeMark(pickedChart, shownData, first));
          return;
        }
        if (pickedChart.view3d && isArrow && e.altKey && !e.shiftKey) {
          e.preventDefault();
          if (readOnly) return;
          const v = pickedChart.view3d;
          const view = { ...v, rotY: (((v.rotY + (key === "ArrowRight" ? 5 : key === "ArrowLeft" ? -5 : 0)) % 360) + 360) % 360, rotX: Math.max(0, Math.min(90, v.rotX + (key === "ArrowUp" ? 5 : key === "ArrowDown" ? -5 : 0))) };
          try {
            session.updateChart(sheet.id, pickedChart.id, { view3d: view });
            announce(`Tilt ${view.rotX} degrees, rotation ${view.rotY} degrees`);
          } catch (error) {
            reportProblem(error);
          }
          return;
        }
      }
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        if (!readOnly) {
          if (images.some((i) => i.id === chartId)) session.deleteImage(sheet.id, chartId);
          else session.deleteChart(sheet.id, chartId);
        }
        onChartSelect?.(null);
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        onChartSelect?.(null);
        return;
      }
      if (key === "Tab" && !mod && !e.altKey) {
        e.preventDefault();
        pick(e.shiftKey ? -1 : 1);
        return;
      }
      if ((key === "Enter" || key === "F2") && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!readOnly) onChartEdit?.(chartId);
        return;
      }
      if (picked && !e.altKey && (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown")) {
        // Arrows move it 10 pixels (Ctrl or Cmd: 1); with Shift they stretch its right and bottom edges instead.
        e.preventDefault();
        if (readOnly) return;
        const step = mod ? 1 : 10;
        const sx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
        const sy = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;
        const box = boxOf(picked);
        const least = images.some((i) => i.id === chartId) ? MIN_PICTURE_SIZE : MIN_CHART_SIZE;
        const next: ChartBox = e.shiftKey ? { ...box, w: Math.max(least, box.w + sx), h: Math.max(least, box.h + sy) } : { ...box, left: Math.max(0, box.left + sx), top: Math.max(0, box.top + sy) };
        try {
          placeFloating(chartId, images.some((i) => i.id === chartId), next);
          revealBox(next);
        } catch (error) {
          reportProblem(error);
        }
        return;
      }
      if (!mod && key.length > 0 && key !== "Shift" && key !== "Control" && key !== "Meta" && key !== "Alt") onChartSelect?.(null);
    }
    if (live) {
      if (onAssistKey?.(e)) return;
      if (key === "Escape") {
        e.preventDefault();
        onEdit(null);
        sinkRef.current?.focus();
      } else if (key === "Enter" && !(e.altKey || (e.shiftKey && false))) {
        e.preventDefault();
        onCommit(e.shiftKey ? "up" : "down");
      } else if (key === "Enter" && e.altKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const t = edit!.text.slice(0, el.selectionStart) + "\n" + edit!.text.slice(el.selectionEnd);
        onEdit({ ...edit!, text: t });
      } else if (key === "Tab") {
        e.preventDefault();
        onCommit(e.shiftKey ? "left" : "right");
      } else if (key === "F2" && !e.shiftKey) {
        e.preventDefault();
        pointing.current = null;
        onEdit({ ...edit!, mode: edit!.mode === "enter" ? "edit" : "enter" });
      } else if (edit!.mode === "enter" && !e.altKey && (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight")) {
        // Mid-formula (where a reference could go), an arrow key points at a cell, as in Excel: it moves the reference being typed.
        // A finished entry: an arrow key accepts it and moves on.
        if (pointWithArrow(e, key)) return;
        if (mod) return;
        e.preventDefault();
        onCommit(key.slice(5).toLowerCase() as Direction);
      }
      return;
    }
    if (key === "Enter" && e.altKey && !mod && single) {
      const link = session.link(sheet.id, cellAddress(active.row, active.col));
      if (link) {
        e.preventDefault();
        onLinkOpen?.(link, cellAddress(active.row, active.col));
        return;
      }
    }
    // Space or Alt+Enter on a cell with a badge that has a card opens the card.
    if (!mod && single && onChipCard && ((key === " " && !e.altKey && !e.shiftKey) || (key === "Enter" && e.altKey))) {
      const value = cardChip(sheet.cells[cellAddress(active.row, active.col)], chips);
      if (value !== undefined) {
        e.preventDefault();
        openChipCard(active.row, active.col, value);
        return;
      }
    }
    // Alt+Shift+Right groups the selected rows (or columns, when whole columns are selected); Alt+Shift+Left takes them out of the group.
    if (e.altKey && e.shiftKey && !mod && (key === "ArrowRight" || key === "ArrowLeft")) {
      e.preventDefault();
      if (readOnly) return;
      try {
        const columns = spansColumns(bounds) && !spansRows(bounds);
        if (key === "ArrowRight") columns ? session.groupColumns(sheet.id, bounds.c1, bounds.c2) : session.groupRows(sheet.id, bounds.r1, bounds.r2);
        else columns ? session.ungroupColumns(sheet.id, bounds.c1, bounds.c2) : session.ungroupRows(sheet.id, bounds.r1, bounds.r2);
      } catch (error) {
        reportProblem(error);
      }
      return;
    }
    if (key === "ArrowDown" && e.altKey && pickable(active.row, active.col)) {
      e.preventDefault();
      openChoices(active.row, active.col);
      return;
    }
    if (key === " " && !mod && !readOnly && sheet.cells[cellAddress(active.row, active.col)]?.control?.type === "checkbox") {
      // Space ticks or unticks the checkboxes that are selected, all to the opposite of the active one.
      e.preventDefault();
      const to = !isTicked(sheet.cells[cellAddress(active.row, active.col)]);
      try {
        session.batch(() => {
          for (const b of ranges) {
            for (const [address, cell] of Object.entries(sheet.cells)) {
              if (cell.control?.type !== "checkbox") continue;
              const m = /^([A-Z]+)(\d+)$/.exec(address)!;
              const r = Number(m[2]);
              const c = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
              if (r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2) session.toggleCheckbox(sheet.id, address, to);
            }
          }
        });
      } catch (error) {
        reportProblem(error);
      }
      return;
    }
    const arrow = key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : null;
    if (arrow) {
      e.preventDefault();
      onSelect(moveSelection(e.shiftKey ? selection : leaveMerge(selection, arrow, merges), arrow, { extend: e.shiftKey, ...(mod ? { filled } : {}) }));
    } else if (key === "Enter") {
      e.preventDefault();
      onSelect(advance(leaveMerge(selection, e.shiftKey ? "up" : "down", merges), e.shiftKey ? "up" : "down"));
    } else if (key === "Tab") {
      e.preventDefault();
      onSelect(advance(leaveMerge(selection, e.shiftKey ? "left" : "right", merges), e.shiftKey ? "left" : "right"));
    } else if (key === "Home") {
      e.preventDefault();
      onSelect(mod ? caret({ row: 1, col: 1 }) : e.shiftKey ? { anchor: selection.anchor, focus: { row: selection.focus.row, col: 1 } } : caret({ row: active.row, col: 1 }));
    } else if (key === "End" && mod) {
      e.preventDefault();
      onSelect(caret({ row: Math.max(1, usedRows.r), col: Math.max(1, usedRows.c) }));
    } else if (key === "PageDown" || key === "PageUp") {
      e.preventDefault();
      const rows = Math.max(1, Math.floor((bodyH - frozenH) / 20) - 1);
      onSelect(moveSelection(selection, key === "PageDown" ? "down" : "up", { extend: e.shiftKey, amount: rows }));
    } else if (mod && (key === "a" || key === "A")) {
      e.preventDefault();
      onSelect(selectAll());
    } else if (mod && (key === "z" || key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) session.redo();
      else session.undo();
    } else if (mod && (key === "y" || key === "Y")) {
      e.preventDefault();
      session.redo();
    } else if (mod && (key === "d" || key === "D") && !readOnly) {
      e.preventDefault();
      fillFrom("down");
    } else if (mod && (key === "r" || key === "R") && !readOnly) {
      e.preventDefault();
      fillFrom("right");
    } else if ((key === "b" || key === "B") && mod && !readOnly) {
      e.preventDefault();
      toggleStyle("bold");
    } else if ((key === "i" || key === "I") && mod && !readOnly) {
      e.preventDefault();
      toggleStyle("italic");
    } else if ((key === "u" || key === "U") && mod && !readOnly) {
      e.preventDefault();
      toggleStyle("underline");
    } else if ((key === "Delete" || key === "Backspace") && !readOnly) {
      e.preventDefault();
      session.batch(() => ranges.forEach((b) => session.clear(sheet.id, rangeAddress(clampToUsed(b)), "contents")));
    } else if (key === "F2" && !e.shiftKey) {
      e.preventDefault();
      if (hasPicker(sheet.cells[cellAddress(active.row, active.col)], chips)) openChoices(active.row, active.col);
      else startEdit("edit", undefined);
    } else if (key === "Escape") {
      onCopied(null);
    }
  };

  const clampToUsed = (b: Bounds): Bounds => ({
    ...b,
    r2: spansColumns(b) ? Math.max(b.r1, Math.min(b.r2, Math.max(usedRows.r, 200))) : b.r2,
    c2: spansRows(b) ? Math.max(b.c1, Math.min(b.c2, Math.max(usedRows.c, 26))) : b.c2,
  });

  const fillFrom = (dir: "down" | "right") => {
    session.batch(() =>
      ranges.forEach((r) => {
        const b = clampToUsed(r);
        if (dir === "down" ? b.r1 !== b.r2 : b.c1 !== b.c2) session.fill(sheet.id, rangeAddress(b), dir);
      }),
    );
  };

  const toggleStyle = (key: "bold" | "italic" | "underline") => {
    const on = !!sheet.cells[cellAddress(active.row, active.col)]?.s?.[key];
    session.batch(() => ranges.forEach((b) => session.setStyle(sheet.id, rangeAddress(clampToUsed(b)), { [key]: on ? null : true })));
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (!live && sheet.cells[cellAddress(active.row, active.col)]?.control?.type === "checkbox") {
      onProblem?.("A checkbox is ticked by clicking it or pressing Space");
      return;
    }
    if (!live && e.target.value !== "" && blocked(active.row, active.col)) return;
    onCaret?.(e.target.selectionStart ?? e.target.value.length);
    pointing.current = null;
    if (live) onEdit({ ...edit!, text: e.target.value, mode: edit!.mode });
    else if (e.target.value !== "") onEdit({ row: active.row, col: active.col, text: e.target.value, mode: "enter", from: "grid", sheet: sheet.id });
  };

  // ---- clipboard ----
  /** What several selected rectangles copy as, if they line up: the same rows side by side, or the same columns one over the other. Excel can't copy any other shape. */
  const combinedText = (): { text: string; html: string; ranges: Bounds[] } | null => {
    const parts = ranges.map(clampToUsed);
    if (parts.length === 1) {
      const address = rangeAddress(parts[0]!);
      return { text: session.toText(sheet.id, address), html: session.toHtml(sheet.id, address), ranges: parts };
    }
    const sameRows = parts.every((p) => p.r1 === parts[0]!.r1 && p.r2 === parts[0]!.r2);
    const sameCols = parts.every((p) => p.c1 === parts[0]!.c1 && p.c2 === parts[0]!.c2);
    if (!sameRows && !sameCols) return null;
    const sorted = [...parts].sort((x, y) => (sameRows ? x.c1 - y.c1 : x.r1 - y.r1));
    const texts = sorted.map((p) => session.toText(sheet.id, rangeAddress(p)).split("\n"));
    const lines = sameRows ? texts[0]!.map((_, i) => texts.map((t) => t[i]).join("\t")) : texts.flat();
    const text = lines.join("\n");
    const html = `<table><tbody>${lines.map((l) => `<tr>${l.split("\t").map((c) => `<td>${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return { text, html, ranges: sorted };
  };

  const valuesOnly = useRef(false);
  const copyOut = (e: React.ClipboardEvent, cut: boolean) => {
    if (live) return;
    e.preventDefault();
    // A picture that is picked is what gets copied. Its description goes on the clipboard as text, so other programs get something.
    const pic = chartId ? images.find((i) => i.id === chartId) : undefined;
    if (pic) {
      const text = `${pic.alt?.trim().slice(0, 200) || "Picture"}\u200b`;
      e.clipboardData.setData("text/plain", text);
      // Other programs get the picture as it looks on the sheet, as an image in the HTML (Word, Docs, Mail and the like paste that as a picture).
      const box = boxOf(pic);
      const el = viewport.current?.querySelector<HTMLImageElement>(`[data-picture="${pic.id}"] img`);
      const src = (el && pictureAsPng(pic, el, box.w, box.h)) || pic.src;
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      e.clipboardData.setData("text/html", `<meta charset="utf-8"><img src="${esc(src)}" alt="${esc(pic.alt ?? "")}" width="${Math.round(box.w)}" height="${Math.round(box.h)}">`);
      onCopied({ sheet: sheet.id, ranges: [], cut: cut && !readOnly, text, picture: pic.id });
      return;
    }
    const out = combinedText();
    if (!out) return; // ranges that don't line up can't be copied together
    e.clipboardData.setData("text/plain", out.text);
    e.clipboardData.setData("text/html", out.html);
    // Formulas that are hidden don't travel with a copy made here: pasting brings the values.
    const hides = out.ranges.some((r) => session.anyFormulaHidden(sheet.id, rangeAddress(r)));
    if (hides) onCopied(null);
    else onCopied({ sheet: sheet.id, ranges: out.ranges, cut: cut && !readOnly, text: out.text });
  };

  const pasteText = (text: string, html?: string, options: PasteOptions = {}) => {
    if (live || readOnly) return;
    const origin = cellAddress(bounds.r1, bounds.c1);
    if (copied?.picture && text === copied.text) {
      // Our own copy of a picture: it lands at the active cell, on this sheet or another; a cut takes it from where it was.
      const picture = copied.picture;
      try {
        let made: SheetImage | undefined;
        session.batch(() => {
          made = session.copyImage(copied.sheet, picture, { sheet: sheet.id, from: { row: bounds.r1, col: bounds.c1 } });
          if (copied.cut) session.deleteImage(copied.sheet, picture);
        });
        if (copied.cut) onCopied(null);
        if (made) onChartSelect?.(made.id);
      } catch (error) {
        reportProblem(error);
      }
      return;
    }
    if (copied && copied.ranges.length === 1 && text.replace(/\r?\n$/, "") === copied.text.replace(/\r?\n$/, "")) {
      // Our own copy: formulas and formats come along, and a cut moves the cells.
      const range = copied.ranges[0]!;
      const from = { sheet: copied.sheet, range: rangeAddress(range) };
      if (copied.cut && !options.transpose) session.move(from, { sheet: sheet.id, at: origin });
      else session.copy(from, { sheet: sheet.id, at: origin }, copied.cut ? { ...options, cut: true } : options);
      // A transposed paste is as many rows tall as the copy was columns wide.
      onSelect({ anchor: { row: bounds.r1, col: bounds.c1 }, focus: options.transpose ? { row: bounds.r1 + range.c2 - range.c1, col: bounds.c1 + range.r2 - range.r1 } : { row: bounds.r1 + range.r2 - range.r1, col: bounds.c1 + range.c2 - range.c1 } });
      if (copied.cut) onCopied(null);
      return;
    }
    // From another program: its HTML table brings fills, fonts, borders and merged cells along.
    let pasted: string | null = null;
    try {
      const notes: string[] = [];
      if (html && !(copied && text.replace(/\r?\n$/, "") === copied.text.replace(/\r?\n$/, ""))) pasted = session.pasteHtml(sheet.id, origin, html, { ...options, notes });
      if (notes.length) onProblem?.(notes.join(" "));
    } catch (e) {
      reportProblem(e);
      return;
    }
    pasted ??= session.pasteText(sheet.id, origin, text, options.transpose ? { transpose: true } : {});
    if (pasted) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(pasted);
      if (m) {
        const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        onSelect({ anchor: { row: bounds.r1, col: bounds.c1 }, focus: { row: Number(m[4]), col: col(m[3]!) } });
      }
    }
  };

  const pasteValues = (text: string) => {
    if (live || readOnly) return;
    if (copied && copied.ranges.length === 1 && !copied.picture && text.replace(/\r?\n$/, "") === copied.text.replace(/\r?\n$/, "")) {
      const range = copied.ranges[0]!;
      session.pasteValues({ sheet: copied.sheet, range: rangeAddress(range) }, { sheet: sheet.id, at: cellAddress(bounds.r1, bounds.c1) });
      onSelect({ anchor: { row: bounds.r1, col: bounds.c1 }, focus: { row: bounds.r1 + range.r2 - range.r1, col: bounds.c1 + range.c2 - range.c1 } });
      return;
    }
    pasteText(text);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (live || readOnly) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const html = e.clipboardData.getData("text/html");
    // A copied range comes with a picture of itself as well as its cells, so a picture counts only when nothing else is there.
    const files = text === "" && html === "" ? [...e.clipboardData.files].filter((f) => f.type.startsWith("image/")) : [];
    if (files.length && onImageFiles) return onImageFiles(files, { row: active.row, col: active.col });
    // Ctrl+Shift+V pastes the values only, as in Google Sheets.
    const plain = valuesOnly.current;
    valuesOnly.current = false;
    pasteText(text, html, plain ? { content: "values" } : {});
  };
  actions.current = { paste: (text, html, options) => pasteText(text, html, options), edit: (text, back) => startEdit("edit", text, active.row, active.col, back ?? 0), reveal };

  /** Runs a handler, and says why when the sheet refuses what it did (a locked cell, a permission the sheet lacks). */
  const safely =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      try {
        fn(...args);
      } catch (e) {
        if (e instanceof Error && (e.name === "ProtectionError" || e.name === "PliError")) reportProblem(e);
        else throw e;
      }
    };

  // ---- drawing ----
  const quads = [
    fr && fc ? { id: "tl", left: hw, top: hh, w: frozenW, h: frozenH, x0: 0, y0: 0, rows: [1, fr] as [number, number], cols: [1, fc] as [number, number] } : null,
    fr ? { id: "tr", left: hw + frozenW, top: hh, w: bodyW - frozenW, h: frozenH, x0: frozenW + scroll.x, y0: 0, rows: [1, fr] as [number, number], cols: [view.c1, view.c2] as [number, number] } : null,
    fc ? { id: "bl", left: hw, top: hh + frozenH, w: frozenW, h: bodyH - frozenH, x0: 0, y0: frozenH + scroll.y, rows: [view.r1, view.r2] as [number, number], cols: [1, fc] as [number, number] } : null,
    { id: "br", left: hw + frozenW, top: hh + frozenH, w: bodyW - frozenW, h: bodyH - frozenH, x0: frozenW + scroll.x, y0: frozenH + scroll.y, rows: [view.r1, view.r2] as [number, number], cols: [view.c1, view.c2] as [number, number] },
  ].filter((q): q is NonNullable<typeof q> => q !== null && q.w > 0 && q.h > 0);

  const rect = (b: Bounds) => ({ left: colAx.offset(b.c1), top: rowAx.offset(b.r1), width: colAx.offset(b.c2 + 1) - colAx.offset(b.c1), height: rowAx.offset(b.r2 + 1) - rowAx.offset(b.r1) });

  const headerCols: number[] = [];
  for (let c = 1; c <= fc; c++) headerCols.push(c);
  for (let c = view.c1; c <= view.c2; c++) headerCols.push(c);
  const headerRows: number[] = [];
  for (let r = 1; r <= fr; r++) headerRows.push(r);
  for (let r = view.r1; r <= view.r2; r++) headerRows.push(r);

  const colSelected = (c: number) => ranges.some((b) => c >= b.c1 && c <= b.c2);
  const rowSelected = (r: number) => ranges.some((b) => r >= b.r1 && r <= b.r2);

  // The text field sits over the active cell: invisible while navigating, the editor while typing.
  const at = cellRect(active.row, active.col);
  // A merged cell is edited over the whole of it.
  const activeMerge = mergeAt(sheet, active.row, active.col);
  if (activeMerge) {
    const far = cellRect(activeMerge.r2, activeMerge.c2);
    at.w = far.x + far.w - at.x;
    at.h = far.y + far.h - at.y;
  }
  const editor: CSSProperties = editing
    ? { left: at.x, top: at.y, minWidth: at.w, minHeight: at.h, width: Math.min(Math.max(at.w, textWidth(edit!.text.split("\n").reduce((a, b) => (a.length > b.length ? a : b), ""), "13px sans-serif") + 24), Math.max(at.w, size.w - at.x - 4)), height: Math.max(at.h, 20 * (edit!.text.split("\n").length)) }
    : { left: at.x, top: at.y, width: Math.max(1, at.w), height: Math.max(1, at.h) };
  const activeStyle = sheet.cells[cellAddress(active.row, active.col)]?.s;
  if (editing) {
    editor.font = fontOf(activeStyle);
    if (activeStyle?.color) editor.color = activeStyle.color;
  }
  const colored = editing && edit!.text.startsWith("=");
  // The references typed into a formula, outlined on the sheet they point at in the colour the text is drawn in.
  const outlines = typedRefs.filter((r) => (r.sheet === undefined ? editing : r.sheet.toLowerCase() === sheet.name.toLowerCase()));
  const mirror: ReactNode[] = [];
  if (colored) {
    let from = 0;
    typedRefs.forEach((r, i) => {
      if (r.start > from) mirror.push(edit!.text.slice(from, r.start));
      mirror.push(<span key={i} style={{ color: r.color }}>{edit!.text.slice(r.start, r.end)}</span>);
      from = r.end;
    });
    mirror.push(edit!.text.slice(from) + (edit!.text.endsWith("\n") ? " " : ""));
  }

  return (
    <div className="pli-grid" ref={viewport} data-editing={editing ? "" : undefined}>
      {quads.map((q) => (
        <div key={q.id} className="pli-grid-quad" style={{ left: q.left, top: q.top, width: q.w, height: q.h }}>
          <div className="pli-grid-inner" style={{ transform: `translate(${-q.x0}px, ${-q.y0}px)` }}>
            <Body session={session} sheet={sheet} revision={revision} rows={q.rows} cols={q.cols} colAxis={colAx} rowAxis={rowAx} chips={chips} remoteImages={remoteImages} />
            {copied && copied.sheet === sheet.id && copied.ranges.map((r, i) => <div key={`c${i}`} className="pli-grid-copied" style={rect(r)} />)}
            {single && spill && <div className="pli-grid-spill" style={rect(spill)} />}
            {ranges.map((r, i) => <div key={`r${i}`} className="pli-grid-range" style={rect(r)} data-multi={single ? undefined : ""} />)}
            {outlines.map((r, i) => <div key={`f${i}`} className="pli-grid-ref" style={{ ...rect(r.bounds), borderColor: r.color, background: `color-mix(in srgb, ${r.color} 10%, transparent)` }} />)}
            {filterAreas.map((a) =>
              Array.from({ length: a.c2 - a.c1 + 1 }, (_, i) => a.c1 + i).map((c) => {
                if (colAx.size(c) === 0 || rowAx.size(a.header) === 0) return null;
                const sorted = a.sorted(c);
                return (
                  <div key={`b${a.table ?? "sheet"}:${c}`} className="pli-grid-filterbtn" data-on={a.on(c) ? "" : undefined} data-sort={sorted} style={{ left: colAx.offset(c + 1) - 19, top: rowAx.offset(a.header + 1) - 19 }}>
                    {sorted === "ascending" ? "\u25B2" : sorted === "descending" ? "\u25BC" : "\u25BE"}
                  </div>
                );
              }),
            )}
            {pageView && <PageBreakLayer view={pageView} rowAt={(n) => rowAx.offset(n)} colAt={(n) => colAx.offset(n)} endRow={extent.rows + 1} endCol={extent.cols + 1} rows={q.rows} cols={q.cols} ghost={pageGhost} />}
            {pageBreaks?.rows.filter((b) => b.after + 1 >= q.rows[0] && b.after <= q.rows[1]).map((b) => <div key={`pr${b.after}`} className="pli-grid-break" data-manual={b.manual ? "" : undefined} style={{ left: 0, top: rowAx.offset(b.after + 1) - 1, width: contentW, height: 0 }} />)}
            {pageBreaks?.cols.filter((b) => b.after + 1 >= q.cols[0] && b.after <= q.cols[1]).map((b) => <div key={`pc${b.after}`} className="pli-grid-break pli-grid-break-col" data-manual={b.manual ? "" : undefined} style={{ left: colAx.offset(b.after + 1) - 1, top: 0, width: 0, height: contentH }} />)}
            {noted.filter((p) => p.row >= q.rows[0] && p.row <= q.rows[1] && p.col >= q.cols[0] && p.col <= q.cols[1]).map((p) => <div key={`n${p.row}:${p.col}`} className="pli-grid-note" style={{ left: colAx.offset(p.col + 1) - 7, top: rowAx.offset(p.row) }} />)}
            {threads?.filter((p) => p.row >= q.rows[0] && p.row <= q.rows[1] && p.col >= q.cols[0] && p.col <= q.cols[1]).map((p) => <div key={`t${p.row}:${p.col}`} className="pli-grid-thread" data-resolved={p.resolved ? "" : undefined} data-active={p.active ? "" : undefined} style={{ left: colAx.offset(p.col + 1) - 7, top: rowAx.offset(p.row) }} />)}
            {peers?.map((m) => (
              <div key={`peer${m.client}`} className="pli-grid-peers" style={{ ["--pli-peer" as string]: m.color }}>
                {m.ranges.filter((b) => b.r2 >= q.rows[0] && b.r1 <= q.rows[1] && b.c2 >= q.cols[0] && b.c1 <= q.cols[1]).map((b, i) => <PeerOutline key={i} user={m.user} color={m.color} rect={rect(b)} variant="range" />)}
                {m.active && !m.editing && m.active.row >= q.rows[0] && m.active.row <= q.rows[1] && m.active.col >= q.cols[0] && m.active.col <= q.cols[1] && <PeerOutline user={m.user} color={m.color} rect={rect({ r1: m.active.row, c1: m.active.col, r2: m.active.row, c2: m.active.col })} variant="cell" />}
                {m.editing && <PeerOutline user={m.user} color={m.color} rect={rect({ r1: m.editing.row, c1: m.editing.col, r2: m.editing.row, c2: m.editing.col })} variant="cell" label={`${m.user.name} is typing\u2026`} />}
              </div>
            ))}
            {exceptions.filter((p) => p.row >= q.rows[0] && p.row <= q.rows[1] && p.col >= q.cols[0] && p.col <= q.cols[1]).map((p) => <div key={`x${p.row}:${p.col}`} className="pli-grid-exception" style={{ left: colAx.offset(p.col), top: rowAx.offset(p.row) }} />)}
            {single && !editing && !readOnly && exceptions.some((p) => p.row === active.row && p.col === active.col) && (
              <div className="pli-grid-exceptionbtn" title="This cell doesn't follow its column's formula" style={{ left: colAx.offset(active.col) - 20, top: rowAx.offset(active.row) + Math.max(1, (rowAx.size(active.row) - 18) / 2) }}>!</div>
            )}
            {single && !editing && !readOnly && pickable(active.row, active.col) && (
              <div className="pli-grid-choicebtn" style={{ left: colAx.offset(active.col + 1) - 21, top: rowAx.offset(active.row) + Math.max(1, (rowAx.size(active.row) - 18) / 2) }}>{"\u25BE"}</div>
            )}
            {invalid.filter((p) => p.row >= q.rows[0] && p.row <= q.rows[1] && p.col >= q.cols[0] && p.col <= q.cols[1]).map((p) => <div key={`i${p.row}:${p.col}`} className="pli-grid-invalid" style={rect({ r1: p.row, c1: p.col, r2: p.row, c2: p.col })} />)}
            {found?.size
              ? foundIn(found, q.rows, q.cols).map(([row, col]) => <div key={`f${row}:${col}`} className="pli-grid-found" data-current={row === active.row && col === active.col ? "" : undefined} style={rect({ r1: row, c1: col, r2: row, c2: col })} />)
              : null}
            {moveTarget && <div className="pli-grid-fill-preview" style={rect(moveTarget)} data-move="" {...(dropRefused ? { "data-refused": "", title: dropRefused } : {})} />}
            <div className="pli-grid-active" style={rect({ r1: active.row, c1: active.col, r2: active.row, c2: active.col })} />
            {fillTarget && <div className="pli-grid-fill-preview" style={rect(fillTarget)} {...(dropRefused ? { "data-refused": "", title: dropRefused } : {})} />}
            {!editing && !readOnly && !spansColumns(bounds) && !spansRows(bounds) && !selection.more?.length && <div className="pli-grid-handle" style={{ left: colAx.offset(bounds.c2 + 1) - 4, top: rowAx.offset(bounds.r2 + 1) - 4 }} />}
            {images.map((image) => {
              const box = boxOf(image);
              if (box.left > q.x0 + q.w || box.left + box.w < q.x0 || box.top > q.y0 + q.h || box.top + box.h < q.y0) return null;
              return (
                <div key={image.id} data-picture={image.id} className="pli-grid-chart pli-grid-image" {...(image.id === chartId ? { role: "img", "aria-label": `${image.alt || "Picture"}${image.id === cropId ? ", crop mode" : ", selected"}` } : {})} data-selected={image.id === chartId ? "" : undefined} data-cropping={image.id === cropId && image.id === chartId ? "" : undefined} style={{ left: box.left, top: box.top, width: box.w, height: box.h, ...pictureBoxStyle(image) }}>
                  <PictureBody image={adjusting?.id === image.id ? { ...image, ...(adjusting.adjust ? { shapeAdjust: adjusting.adjust } : { shapeAdjust: undefined }) } : chartDrag?.id === image.id && chartDrag.crop ? { ...image, crop: chartDrag.crop } : image} w={box.w} h={box.h} cropping={image.id === cropId && image.id === chartId} />
                  {image.id === chartId && !readOnly && image.id !== cropId && image.shape && (
                    <ShapeHandles
                      image={image}
                      w={box.w}
                      h={box.h}
                      onPreview={(adjust) => setAdjusting(adjust === null ? null : { id: image.id, adjust })}
                      onCommit={(adjust) => {
                        setAdjusting(null);
                        try {
                          session.formatImage(sheet.id, image.id, { shapeAdjust: adjust ?? null });
                        } catch (error) {
                          reportProblem(error);
                        }
                      }}
                    />
                  )}
                  {image.id === chartId && !readOnly && image.id !== cropId && GRIPS.map((g) => {
                    const pt = gripPoint({ left: 0, top: 0, w: box.w, h: box.h }, g);
                    return <div key={g} className="pli-grid-charthandle" style={{ left: pt.x, top: pt.y }} />;
                  })}
                  {image.id === chartId && !readOnly && image.id === cropId && GRIPS.map((g) => {
                    // Crop marks: an L on each corner and a bar on each edge, drawn on the outside of the frame like Excel's.
                    const pt = gripPoint({ left: 0, top: 0, w: box.w, h: box.h }, g);
                    const sx = g.includes("w") ? -1 : g.includes("e") ? 1 : 0;
                    const sy = g.includes("n") ? -1 : g.includes("s") ? 1 : 0;
                    const bar = (key: string, x: number, y: number, bw: number, bh: number) => <div key={key} className="pli-grid-cropmark" data-crop-handle={g} style={{ left: x, top: y, width: bw, height: bh }} />;
                    if (sx && sy) return [bar(`${g}h`, sx < 0 ? pt.x - 3 : pt.x - 11, sy < 0 ? pt.y - 3 : pt.y, 14, 3), bar(`${g}v`, sx < 0 ? pt.x - 3 : pt.x, sy < 0 ? pt.y - 3 : pt.y - 11, 3, 14)];
                    return sx ? bar(g, sx < 0 ? pt.x - 3 : pt.x, pt.y - 7, 3, 14) : bar(g, pt.x - 7, sy < 0 ? pt.y - 3 : pt.y, 14, 3);
                  })}
                </div>
              );
            })}
            {charts.map((c) => {
              const box = boxOf(c);
              const data = chartData.get(c.id);
              // Only the quarters of the grid the chart reaches into paint it.
              if (!data || box.left > q.x0 + q.w || box.left + box.w < q.x0 || box.top > q.y0 + q.h || box.top + box.h < q.y0) return null;
              const sized = box.w === c.width && box.h === c.height ? c : { ...c, width: box.w, height: box.h };
              const shown = turning?.id === c.id ? { ...sized, view3d: turning.view } : sized;
              // A trendline label being dragged is drawn where it is now.
              const shownData =
                labelMove?.id === c.id
                  ? { ...data, series: data.series.map((s, i) => (i !== labelMove.series ? s : { ...s, trendlines: s.trendlines?.map((t, j) => (j !== labelMove.trend ? t : { ...t, labelOffset: { x: labelMove.x, y: labelMove.y } })) })) }
                  : data;
              return (
                <div key={c.id} className="pli-grid-chart" data-chart={c.id} data-selected={c.id === chartId ? "" : undefined} style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
                  <ChartView chart={shown} data={shownData} mark={c.id === chartId ? mark : null} />
                  {c.id === chartId && mark && (
                    <ChartMarkPanel chart={c} data={data} mark={mark} readOnly={readOnly} below={box.h} onChange={(patch) => session.updateChart(sheet.id, c.id, patch)} onClose={() => setMark(null)} />
                  )}
                  {c.id === chartId && !readOnly && GRIPS.map((g) => {
                    const pt = gripPoint({ left: 0, top: 0, w: box.w, h: box.h }, g);
                    return <div key={g} className="pli-grid-charthandle" style={{ left: pt.x, top: pt.y }} />;
                  })}
                </div>
              );
            })}
            {slicers.map((x) => {
              const box = slicerBoxOf(x);
              if (box.left > q.x0 + q.w || box.left + box.w < q.x0 || box.top > q.y0 + q.h || box.top + box.h < q.y0) return null;
              const items = slicerItems.get(x.id) ?? [];
              const layout = x.timeline ? timelineLayout(box.w, box.h, items.length) : slicerLayout(x, box.w, box.h, items.length);
              return (
                <div key={x.id} className="pli-grid-slicer" style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
                  {x.timeline ? (
                    <TimelineView slicer={x} items={items} width={box.w} height={box.h} scroll={Math.min(slicerScroll[x.id] ?? 0, layout.max)} filtered={x.timeline.start !== undefined || x.timeline.end !== undefined} />
                  ) : (
                    <SlicerView slicer={x} look={x.style ? session.state.slicerStyles?.[x.style] : undefined} hovered={slicerHover?.id === x.id ? slicerHover.value : undefined} items={items} width={box.w} height={box.h} scroll={Math.min(slicerScroll[x.id] ?? 0, layout.max)} filtered={items.some((i) => !i.selected)} />
                  )}
                </div>
              );
            })}
            {timelines.map((x) => {
              const box = timelineBoxOf(x);
              const data = timelineData.get(x.id);
              if (!data || box.left > q.x0 + q.w || box.left + box.w < q.x0 || box.top > q.y0 + q.h || box.top + box.h < q.y0) return null;
              return (
                <div key={x.id} className="pli-grid-timeline" style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
                  <TableTimelineView
                    timeline={x}
                    data={data}
                    width={box.w}
                    height={box.h}
                    readOnly={readOnly}
                    onSelect={(range) => {
                      try {
                        session.timelineSelect(x.id, range);
                      } catch (error) {
                        onProblem?.((error as Error).message);
                      }
                    }}
                    onLevel={(level) => session.updateTimeline(sheet.id, { ...x, level })}
                    onGeometry={(change, final) => placeTimeline(x, change, final)}
                    onMenu={(at) => onTimelineMenu?.({ id: x.id, ...at })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {(mgW > 0 || mgH > 0) && (
        <>
          <div className="pli-grid-margin pli-grid-margin-top" style={{ left: 0, top: 0, width: size.w, height: mgH }} />
          <div className="pli-grid-margin pli-grid-margin-left" style={{ left: 0, top: 0, width: mgW, height: size.h }} />
          {rowDepth > 0 && Array.from({ length: rowDepth + 1 }, (_, i) => <div key={`r${i}`} className="pli-outline-level" style={{ left: i * OUTLINE_LEVEL, top: mgH - OUTLINE_LEVEL }}>{i + 1}</div>)}
          {colDepth > 0 && Array.from({ length: colDepth + 1 }, (_, i) => <div key={`c${i}`} className="pli-outline-level" style={{ left: 0, top: i * OUTLINE_LEVEL }}>{i + 1}</div>)}
          <div className="pli-grid-marginclip" style={{ left: hw, top: 0, width: bodyW, height: mgH }}>
            {colGroups.length > 0 && <OutlineMarks groups={colGroups} axis="col" visible={headerCols} offset={(i) => (i <= fc ? colAx.offset(i) : colAx.offset(i) - scroll.x)} size={(i) => colAx.size(i)} />}
          </div>
          <div className="pli-grid-marginclip" style={{ left: 0, top: hh, width: mgW, height: bodyH }}>
            {rowGroups.length > 0 && <OutlineMarks groups={rowGroups} axis="row" visible={headerRows} offset={(i) => (i <= fr ? rowAx.offset(i) : rowAx.offset(i) - scroll.y)} size={(i) => rowAx.size(i)} />}
          </div>
        </>
      )}
      <div className="pli-grid-corner" style={{ left: mgW, top: mgH, width: HEADER_W, height: HEADER_H }} />
      <div className="pli-grid-colheads" style={{ left: hw, top: mgH, height: HEADER_H, width: bodyW }}>
        {headerCols.map((c) => {
          const w = colAx.size(c);
          if (w === 0) return null;
          const x = c <= fc ? colAx.offset(c) : colAx.offset(c) - scroll.x;
          return (
            <div key={c} className="pli-grid-colhead" data-selected={colSelected(c) ? "" : undefined} data-whole={spansColumns(bounds) && colSelected(c) ? "" : undefined} style={{ left: x, width: w, zIndex: c <= fc ? 2 : 1 }}>
              {colName(c)}
            </div>
          );
        })}
      </div>
      <div className="pli-grid-rowheads" style={{ left: mgW, top: hh, width: HEADER_W, height: bodyH }}>
        {headerRows.map((r) => {
          const h = rowAx.size(r);
          if (h === 0) return null;
          const y = r <= fr ? rowAx.offset(r) : rowAx.offset(r) - scroll.y;
          return (
            <div key={r} className="pli-grid-rowhead" data-selected={rowSelected(r) ? "" : undefined} data-whole={spansRows(bounds) && rowSelected(r) ? "" : undefined} style={{ top: y, height: h, zIndex: r <= fr ? 2 : 1 }}>
              {r}
            </div>
          );
        })}
      </div>
      {fc > 0 && <div className="pli-grid-freeze" style={{ left: hw + frozenW - 1, top: 0, width: 1, height: size.h }} />}
      {fr > 0 && <div className="pli-grid-freeze" style={{ left: 0, top: hh + frozenH - 1, width: size.w, height: 1 }} />}

      <div
        className="pli-grid-scroller"
        ref={scroller}
        onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          clearTimeout(hoverTimer.current);
          hoverKey.current = "";
          if (hover) graceClose();
          else setHover(null);
        }}
        onPointerUp={safely(onPointerUp)}
        onPointerCancel={safely(onPointerUp)}
        onDragOver={(e) => {
          if (!readOnly && onImageFiles && [...e.dataTransfer.items].some((i) => i.kind === "file" && i.type.startsWith("image/"))) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (readOnly || !onImageFiles || !files.length) return;
          e.preventDefault();
          const { vx, vy } = viewportPoint(e);
          onImageFiles(files, { row: Math.max(1, rowAx.indexAt(contentY(Math.max(hh, vy)))), col: Math.max(1, colAx.indexAt(contentX(Math.max(hw, vx)))) });
        }}
        onDoubleClick={safely(onDoubleClick)}
        onContextMenu={(e) => {
          // The grid has its own menu. A right click inside the selection leaves it as it is; outside it, it selects what was clicked.
          if (e.target !== scroller.current) return;
          e.preventDefault();
          // A long press on a touch screen can raise this event too: the press has already opened the menu, or this opens it and the press stands down.
          if (Date.now() - lastLongPress.current < 1000) return;
          if (press.current) {
            clearTimeout(press.current.timer);
            press.current.fired = true;
          }
          const { vx, vy } = viewportPoint(e);
          const hit = hitTest(vx, vy);
          if (live) onCommit(null);
          if (hit.kind === "chart") {
            onChartSelect?.(hit.id);
            sinkRef.current?.focus({ preventScroll: true });
            onChartMenu?.({ id: hit.id, x: e.clientX, y: e.clientY });
            return;
          }
          if (hit.kind === "slicer") {
            sinkRef.current?.focus({ preventScroll: true });
            onSlicerMenu?.({ id: hit.id, x: e.clientX, y: e.clientY });
            return;
          }
          if (chartId) onChartSelect?.(null);
          if (hit.kind === "pbreak" || hit.kind === "parea") {
            // The menu of the page break preview is about the cell under the pointer; a break line belongs to the cell after it.
            const row = hit.kind === "pbreak" && hit.axis === "row" ? hit.after + 1 : Math.max(1, rowAx.indexAt(contentY(vy)));
            const col = hit.kind === "pbreak" && hit.axis === "col" ? hit.after + 1 : Math.max(1, colAx.indexAt(contentX(vx)));
            if (!inSelection(selection, row, col)) onSelect(caret({ row, col }));
          } else if (hit.kind === "cell" && !inSelection(selection, hit.row, hit.col)) onSelect(caret({ row: hit.row, col: hit.col }));
          else if (hit.kind === "col" && !(spansColumns(bounds) && colSelected(hit.col))) onSelect(wholeColumns(hit.col, hit.col));
          else if (hit.kind === "row" && !(spansRows(bounds) && rowSelected(hit.row))) onSelect(wholeRows(hit.row, hit.row));
          sinkRef.current?.focus({ preventScroll: true });
          onContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onMouseDown={() => requestAnimationFrame(() => sinkRef.current?.focus({ preventScroll: true }))}
      >
        <div style={{ width: hw + contentW, height: hh + contentH, pointerEvents: "none" }} />
      </div>
      {shownNotes.length > 0 && (
        <NoteBoxes
          notes={shownNotes.flatMap((n): ShownNote[] => {
            const r = cellRect(n.row, n.col);
            return r.w > 0 && r.h > 0 ? [{ address: n.address, row: n.row, col: n.col, info: n.info, anchorX: r.x + r.w, anchorY: r.y }] : [];
          })}
          clip={{ left: hw, top: hh, width: bodyW, height: bodyH }}
          selected={single ? cellAddress(active.row, active.col) : null}
          readOnly={readOnly}
          onSelect={(row, col) => {
            if (live) onCommit(null);
            onSelect(caret({ row, col }));
            sinkRef.current?.focus({ preventScroll: true });
          }}
          onEdit={() => onNoteEdit?.()}
          onOpenLink={(to) => onLinkOpen?.({ to })}
          onChange={(address, box) => {
            try {
              session.setNoteBox(sheet.id, address, box);
            } catch (e) {
              onProblem?.((e as Error).message);
            }
          }}
        />
      )}

      {touch && !editing && !readOnly && !spansColumns(bounds) && !spansRows(bounds) && !selection.more?.length && !chartId && (
        <>
          {(["start", "end", "fill"] as const).map((which) => {
            const first = cellRect(bounds.r1, bounds.c1);
            const last = cellRect(bounds.r2, bounds.c2);
            // Round handles outside the top left and bottom right corners stretch the selection; the square one under it fills.
            const x = which === "start" ? first.x : which === "end" ? last.x + last.w : (first.x + last.x + last.w) / 2;
            const y = which === "start" ? first.y : which === "end" ? last.y + last.h : last.y + last.h + 20;
            if (x < hw - 2 || y < hh - 2 || x > size.w + 2 || y > size.h + 2) return null;
            return (
              <div
                key={which}
                className="pli-grid-touchhandle"
                data-handle={which}
                role="presentation"
                style={{ left: x, top: y }}
                onPointerDown={(e) => grabHandle(e, which)}
                onPointerMove={onPointerMove}
                onPointerUp={safely(onPointerUp)}
                onPointerCancel={safely(onPointerUp)}
              />
            );
          })}
        </>
      )}
      {touch && !editing && !readOnly && !spansColumns(bounds) && !spansRows(bounds) && !selection.more?.length && !chartId && (() => {
        // The move handle sits above the selection, or beside it when there is no room above.
        const first = cellRect(bounds.r1, bounds.c1);
        const last = cellRect(bounds.r2, bounds.c2);
        const cx = (first.x + last.x + last.w) / 2;
        const cy = (first.y + last.y + last.h) / 2;
        const spot = [{ x: cx, y: first.y - 24 }, { x: first.x - 24, y: cy }, { x: last.x + last.w + 24, y: cy }].find((p) => p.x >= hw + 2 && p.y >= hh + 2 && p.x <= size.w - 2 && p.y <= size.h - 2);
        if (!spot) return null;
        return (
          <div
            className="pli-grid-touchmove"
            data-handle="move"
            role="presentation"
            style={{ left: spot.x, top: spot.y }}
            onPointerDown={grabMove}
            onPointerMove={onPointerMove}
            onPointerUp={safely(onPointerUp)}
            onPointerCancel={safely(onPointerUp)}
          />
        );
      })()}
      {touch && !readOnly && (
        <>
          {headerCols.map((c) => {
            const w = colAx.size(c);
            if (w === 0) return null;
            const x = hw + (c <= fc ? colAx.offset(c) : colAx.offset(c) - scroll.x) + w;
            if (x < hw || x > size.w + 10) return null;
            return <div key={`gc${c}`} className="pli-grid-touchgrip" data-grip="col" data-index={c} style={{ left: x - 11, top: mgH, width: 22, height: HEADER_H }} onPointerDown={(e) => grabGrip(e, "col", c)} onPointerMove={onPointerMove} onPointerUp={safely(onPointerUp)} onPointerCancel={safely(onPointerUp)} />;
          })}
          {headerRows.map((r) => {
            const h = rowAx.size(r);
            if (h === 0) return null;
            const y = hh + (r <= fr ? rowAx.offset(r) : rowAx.offset(r) - scroll.y) + h;
            if (y < hh || y > size.h + 10) return null;
            return <div key={`gr${r}`} className="pli-grid-touchgrip" data-grip="row" data-index={r} style={{ left: mgW, top: y - 11, width: HEADER_W, height: 22 }} onPointerDown={(e) => grabGrip(e, "row", r)} onPointerMove={onPointerMove} onPointerUp={safely(onPointerUp)} onPointerCancel={safely(onPointerUp)} />;
          })}
        </>
      )}

      {colored && (
        <div className="pli-grid-mirror" aria-hidden="true" style={editor}>
          {mirror}
        </div>
      )}
      {prompt && !(editing && assist) && (
        <div className="pli-grid-prompt" role="note" style={{ left: Math.max(4, Math.min(at.x, size.w - 230)), top: at.y + Math.max(at.h, editing ? 20 * edit!.text.split("\n").length : 0) + 4 }}>
          {prompt.title && <strong>{prompt.title}</strong>}
          <span>{prompt.text}</span>
        </div>
      )}
      {editing && edit!.from === "grid" && assist && (
        <div className="pli-grid-assist" style={{ left: Math.max(4, Math.min(at.x, size.w - 560)), ...(at.y + at.h + 300 > size.h && at.y > 300 ? { bottom: size.h - at.y + 2 } : { top: at.y + Math.max(at.h, 20 * edit!.text.split("\n").length) + 2 }) }}>
          {assist}
        </div>
      )}
      <div className="pli-grid-announce" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <textarea
        ref={sinkRef}
        className="pli-grid-sink"
        data-editing={editing ? "" : undefined}
        data-formula={colored ? "" : undefined}
        style={editor}
        value={edit ? edit.text : ""}
        readOnly={readOnly}
        rows={1}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={editing ? "Cell" : `${cellAddress(active.row, active.col)}${hasContent(sheet.cells[cellAddress(active.row, active.col)]) ? ", " + session.display(sheet.id, cellAddress(active.row, active.col)).text : ", empty"}${onChipCard && cardChip(sheet.cells[cellAddress(active.row, active.col)], chips) !== undefined ? ", press Space for details" : ""}`}
        onChange={onInput}
        onSelect={(e) => {
          const at = e.currentTarget.selectionStart ?? 0;
          // The cursor moved away from the reference an arrow key was pointing at: the next arrow key starts again.
          if (pointing.current && (at < pointing.current.at || at > pointing.current.at + pointing.current.length)) pointing.current = null;
          if (live) onCaret?.(at);
        }}
        onKeyDown={safely(onKeyDown)}
        onCopy={(e) => copyOut(e, false)}
        onCut={(e) => copyOut(e, true)}
        onPaste={safely(onPaste)}
      />
    </div>
  );
}

/** What a screen reader is told when a picture or chart is picked from the keyboard. */
function pickedWords(thing: { alt?: string; src?: string; title?: string }, index: number, count: number): string {
  const kind = thing.src !== undefined ? "Picture" : "Chart";
  return `${kind} ${index} of ${count}${thing.alt ? `, ${thing.alt}` : ""}, selected. Arrow keys move it${thing.src !== undefined ? ", C crops it" : ""}.`;
}

function columnAxisOf(sheet: Sheet): Axis {
  return columnAxis(sheet.columns);
}

function withSize(base: Axis, sheet: Sheet, axis: "col" | "row", index: number, px: number, auto?: ReadonlyMap<number, number>): Axis {
  const sizes = new Map<number, number>(auto);
  const dims = axis === "col" ? sheet.columns : sheet.rows;
  const baseSize = axis === "col" ? 64 : 20;
  for (const [k, d] of Object.entries(dims ?? {})) {
    const n = axis === "col" ? [...k].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) : Number(k);
    sizes.set(n, d.hidden ? 0 : d.size !== undefined ? (axis === "col" ? colPx(d.size) : Math.round((d.size * 4) / 3)) : baseSize);
  }
  sizes.set(index, px);
  return new Axis(base.base, sizes, base.limit);
}
