import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { PX_PER_INCH, pageDimensions, sectionShape, sectionsOf, type DocumentSession, type PageSetup } from "@pli.dev/docs";
import { useSelectionState, useSessionRevision } from "../hooks";

/** Points in an inch, and CSS pixels per point. Lengths in a document are in points; the page is drawn in pixels. */
const PT_PER_INCH = 72;
const PX_PER_PT = PX_PER_INCH / PT_PER_INCH;
/** Handles snap to sixteenths of an inch. */
const SNAP_PT = PT_PER_INCH / 16;
/** The narrowest the text area may be made, in points. */
const MIN_TEXT_PT = 2 * PT_PER_INCH;
const MAX_MARGIN_IN = 5;
export const RULER_HEIGHT = 22;

const snap = (pt: number) => Math.round(pt / SNAP_PT) * SNAP_PT;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const inches = (pt: number) => (pt / PT_PER_INCH).toFixed(2);

type Handle = "margin-left" | "margin-right" | "first-line" | "left-indent" | "right-indent";

export interface RulerProps {
  /** The document, whose page setup the margin handles change. */
  session: DocumentSession;
  /** Where the caret is: the document, or the header or footer being edited. Its paragraphs get the indent handles. */
  target: DocumentSession;
  zoom: number;
  readOnly?: boolean;
}

/**
 * A ruler across the top of the page, in inches from the left margin. Drag the margin edges to change the
 * page margins, and the markers to change the indents of the selected paragraphs: the top marker for the
 * first line, the bottom one for the left indent (which carries the first line with it) and the right one
 * for the right indent. Each marker can also be moved with the arrow keys.
 */
export function Ruler({ session, target, zoom, readOnly }: RulerProps) {
  useSessionRevision(session);
  const state = useSelectionState(target);
  // The margins and page width are the caret's section's.
  const page = sectionShape(session.state, sectionsOf(session.state), state.section);
  const { width: pageIn } = pageDimensions(page as PageSetup);
  const widthPt = pageIn * PT_PER_INCH;
  const marginLeftPt = page.margins.left * PT_PER_INCH;
  const marginRightPt = page.margins.right * PT_PER_INCH;
  const textPt = widthPt - marginLeftPt - marginRightPt;

  // The paragraph markers describe one paragraph; they can't describe a list item, a cell or a mixed selection.
  const editable = !readOnly && !state.table && state.block !== null && state.block.type !== "list_item" && state.block.type !== "title" && state.block.type !== "subtitle" && state.block.type !== "code_block";
  const format = state.format;
  const [drag, setDrag] = useState<{ handle: Handle; indentLeft: number; indentFirst: number; indentRight: number; marginLeft: number; marginRight: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const started = useRef(false);
  const ruler = useRef<HTMLDivElement>(null);

  const live = {
    indentLeft: drag?.indentLeft ?? format.indentLeft ?? 0,
    indentFirst: drag?.indentFirst ?? format.indentFirst ?? 0,
    indentRight: drag?.indentRight ?? format.indentRight ?? 0,
    marginLeft: drag?.marginLeft ?? marginLeftPt,
    marginRight: drag?.marginRight ?? marginRightPt,
  };
  const px = (pt: number) => pt * PX_PER_PT * zoom;
  const originPx = px(live.marginLeft);
  const textLivePt = widthPt - live.marginLeft - live.marginRight;

  /** Where a handle sits, in points from the left edge of the page. */
  const positionOf = (handle: Handle, v: NonNullable<typeof drag>): number => {
    switch (handle) {
      case "margin-left": return v.marginLeft;
      case "margin-right": return widthPt - v.marginRight;
      case "first-line": return v.marginLeft + v.indentLeft + v.indentFirst;
      case "left-indent": return v.marginLeft + v.indentLeft;
      case "right-indent": return widthPt - v.marginRight - v.indentRight;
    }
  };

  /** Where the pointer is, in points from the left edge of the page. */
  const pointerPt = (event: { clientX: number }): number => {
    const rect = ruler.current!.getBoundingClientRect();
    return (event.clientX - rect.left) / (PX_PER_PT * zoom);
  };

  /** Applies values to the document: the margins or the paragraph indents. The first change starts an undo step; the rest join it. */
  const apply = (next: NonNullable<typeof drag>) => {
    const merge = started.current;
    started.current = true;
    if (next.handle === "margin-left" || next.handle === "margin-right") {
      session.setPageShape(
        { ...page, margins: { ...page.margins, left: next.marginLeft / PT_PER_INCH, right: next.marginRight / PT_PER_INCH } },
        state.section,
        { merge },
      );
    } else {
      target.setParagraphFormat({ indentLeft: next.indentLeft || null, indentFirst: next.indentFirst || null, indentRight: next.indentRight || null }, { merge });
    }
  };

  /** The values after moving a handle to `pagePt` (points from the page's left edge), kept in range and snapped to sixteenths of an inch. */
  const moved = (handle: Handle, pagePt: number, from: NonNullable<typeof drag>): NonNullable<typeof drag> => {
    const next = { ...from, handle };
    const text = widthPt - from.marginLeft - from.marginRight;
    const pt = pagePt - from.marginLeft;
    switch (handle) {
      case "margin-left":
        next.marginLeft = snap(clamp(pagePt, 0, Math.min(MAX_MARGIN_IN * PT_PER_INCH, widthPt - from.marginRight - MIN_TEXT_PT)));
        break;
      case "margin-right":
        next.marginRight = snap(clamp(widthPt - pagePt, 0, Math.min(MAX_MARGIN_IN * PT_PER_INCH, widthPt - from.marginLeft - MIN_TEXT_PT)));
        break;
      case "first-line":
        next.indentFirst = snap(clamp(pt, 0, text - from.indentRight - 18)) - from.indentLeft;
        break;
      case "left-indent":
        // The first line moves with it, and neither may go past the margin.
        next.indentLeft = snap(clamp(pt, Math.max(0, -from.indentFirst), text - from.indentRight - 36));
        break;
      case "right-indent":
        next.indentRight = snap(clamp(text - pt, 0, text - from.indentLeft - 36));
        break;
    }
    return next;
  };

  const begin = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Keep the editor's focus and selection, which the markers act on.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    started.current = false;
    const from = { handle, ...live };
    dragRef.current = from;
    setDrag(from);
  };

  const move = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    const from = dragRef.current;
    if (!from || from.handle !== handle) return;
    const next = moved(handle, pointerPt(event), from);
    if (JSON.stringify(next) === JSON.stringify(from)) return;
    dragRef.current = next;
    setDrag(next);
    apply(next);
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDrag(null);
  };

  /** Arrow keys nudge a marker by a sixteenth of an inch, or half an inch with Shift. */
  const key = (handle: Handle) => (event: ReactKeyboardEvent<HTMLElement>) => {
    const dir = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    const from = { handle, ...live };
    started.current = false;
    apply(moved(handle, positionOf(handle, from) + dir * (event.shiftKey ? 36 : SNAP_PT), from));
  };

  const ticks: ReactElement[] = [];
  for (let i = -Math.ceil(live.marginLeft / (PT_PER_INCH / 8)); i * (PT_PER_INCH / 8) <= textLivePt + live.marginRight; i++) {
    const pt = i * (PT_PER_INCH / 8);
    const x = px(live.marginLeft + pt);
    const whole = i % 8 === 0;
    const half = i % 4 === 0;
    const length = whole ? 8 : half ? 6 : 3;
    ticks.push(<line key={i} x1={x} x2={x} y1={RULER_HEIGHT - length} y2={RULER_HEIGHT} />);
    if (whole && pt > 0 && pt < textLivePt) {
      ticks.push(
        <text key={`n${i}`} x={x} y={RULER_HEIGHT - 9} textAnchor="middle">
          {i / 8}
        </text>,
      );
    }
  }

  const handle = (name: Handle, className: string, left: number, label: string, valuePt: number, enabled = true) => (
    <div
      className={`pli-ruler-handle ${className}`}
      data-handle={name}
      data-active={drag?.handle === name || undefined}
      data-disabled={!enabled || undefined}
      style={{ left }}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(textLivePt / PT_PER_INCH * 100) / 100}
      aria-valuenow={Number(inches(valuePt))}
      aria-valuetext={`${inches(valuePt)} inches`}
      aria-disabled={!enabled || undefined}
      tabIndex={enabled ? 0 : -1}
      title={`${label}: ${inches(valuePt)} in`}
      onPointerDown={enabled ? begin(name) : undefined}
      onPointerMove={enabled ? move(name) : undefined}
      onPointerUp={enabled ? end : undefined}
      onPointerCancel={enabled ? end : undefined}
      onKeyDown={enabled ? key(name) : undefined}
    />
  );

  const widthPx = px(widthPt);
  return (
    <div className="pli-ruler-wrap" style={{ width: widthPx }}>
      <div className="pli-ruler" ref={ruler} style={{ height: RULER_HEIGHT }}>
        <div className="pli-ruler-margin" style={{ left: 0, width: originPx }} />
        <div className="pli-ruler-margin" style={{ right: 0, width: px(live.marginRight) }} />
        <svg className="pli-ruler-ticks" width={widthPx} height={RULER_HEIGHT} aria-hidden="true">
          {ticks}
        </svg>
        {!readOnly && handle("margin-left", "pli-ruler-margin-handle", originPx, "Left margin", live.marginLeft)}
        {!readOnly && handle("margin-right", "pli-ruler-margin-handle", widthPx - px(live.marginRight), "Right margin", live.marginRight)}
        {editable && (
          <>
            {handle("first-line", "pli-ruler-first", originPx + px(live.indentLeft + live.indentFirst), "First line indent", live.indentLeft + live.indentFirst)}
            {handle("left-indent", "pli-ruler-left", originPx + px(live.indentLeft), "Left indent", live.indentLeft)}
            {handle("right-indent", "pli-ruler-right", originPx + px(textLivePt - live.indentRight), "Right indent", live.indentRight)}
          </>
        )}
      </div>
      {drag && <div className="pli-ruler-guide" style={{ left: px(positionOf(drag.handle, { handle: drag.handle, ...live })) }} />}
    </div>
  );
}
