import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { boundsOf, type Box, type DeckSession, type Line, type Pose, type ResolvedElement, type Scene, type TextRange } from "@pli.dev/decks";
import { SlideView, isPicturePlaceholder, type TextHighlight } from "./SlideView";
import { TextEditor, type TextEditApi, type TextEditState } from "./TextEditor";
import {
  HANDLES,
  HANDLE_DIR,
  angleTo,
  cropByHandle,
  frameOfElement,
  hitTest,
  inRect,
  normalizeAngle,
  resizeBounds,
  resizeFrame,
  scaleWithin,
  visualBounds,
  type Frame,
  type Handle,
} from "./geometry";
import { snap, type SnapGuide } from "./snap";
import { withFrames } from "./preview";
import { AnimationOverlay, type AnimationOverlayProps } from "./AnimationOverlay";

/** What the next drag on the canvas draws. */
export type Tool = null | { type: "text" } | { type: "shape"; geometry: string } | { type: "line"; geometry: string; arrow?: boolean };

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** The text being edited. */
export interface EditTarget {
  element: string;
  cell?: [number, number];
  range?: TextRange;
  /** Text typed to start the edit. */
  text?: string;
  /** Client coordinates of the click that started it. */
  point?: { x: number; y: number };
}

export interface SlideCanvasProps {
  session: DeckSession;
  /** The slide shown, or the layout or master being edited. */
  owner: string;
  scene: Scene;
  from: ResolvedElement["from"];
  selected: readonly string[];
  /** Pixels per point. */
  scale: number;
  readOnly?: boolean;
  tool: Tool;
  onTool: (tool: Tool) => void;
  editing: EditTarget | null;
  onEdit: (target: EditTarget | null) => void;
  cellRange: CellRange | null;
  onCellRange: (range: CellRange | null) => void;
  /** The picked picture's edges crop instead of resize. */
  cropping?: boolean;
  onSelect: (ids: string[]) => void;
  /** Snap to guides while dragging (default true). */
  guides?: boolean;
  highlights?: readonly TextHighlight[];
  textApiRef: MutableRefObject<TextEditApi | null>;
  onTextState: (state: TextEditState) => void;
  onFiles?: (files: File[], at: { x: number; y: number }) => void;
  /** A chart was double-clicked: open its data and options. */
  onChartOptions?: (id: string) => void;
  /** A click on an empty picture placeholder: the host opens its picture chooser and puts the choice in it. */
  onPickPicture?: (element: string) => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  /** Numbered animation badges and the motion path being edited (what the Motion panel puts over the slide). */
  animation?: Omit<AnimationOverlayProps, "scene" | "scale" | "readOnly" | "selected">;
  /** A preview of the slide's animations is playing: the elements are drawn in these poses and the canvas can't be edited until it stops. */
  poses?: ReadonlyMap<string, Pose> | null;
  /** Drawn over the slide, under the editing handles' pointer events: other people's selections and cursors, comment bubbles. */
  overlay?: ReactNode;
  className?: string;
}

type Gesture =
  | { type: "move"; ids: string[]; start: { x: number; y: number }; client: { x: number; y: number }; frames: Map<string, Frame>; moved: boolean; wasSelected: boolean; alt: boolean; duplicated: boolean; shift: boolean; hit: string; cell?: [number, number] }
  | { type: "resize"; handle: Handle; ids: string[]; frames: Map<string, Frame>; bounds: Frame; keepAspect: boolean }
  | { type: "rotate"; id: string; frame: Frame; startAngle: number }
  | { type: "crop"; id: string; handle: Handle; frame: Frame; crop: { l?: number; t?: number; r?: number; b?: number } }
  | { type: "marquee"; start: { x: number; y: number }; additive: boolean; base: string[] }
  | { type: "draw"; tool: NonNullable<Tool>; start: { x: number; y: number } }
  | { type: "cells"; id: string; origin: [number, number] }
  | { type: "border"; id: string; axis: "col" | "row"; index: number; sizes: number[]; start: number };

const THRESHOLD = 3;

const LINE_STYLE: Partial<Line> = { width: 2, color: { theme: "dk1" } };

function elementBox(f: Frame): Box {
  return { x: f.x, y: f.y, w: f.w, h: f.h };
}

/** The slide, with everything you do to its elements: select, move, resize, rotate, draw, crop, and type into shapes and tables. */
export function SlideCanvas(props: SlideCanvasProps) {
  const { session, owner, scene, from, selected, scale, readOnly, tool, onTool, editing, onEdit, cellRange, onCellRange, cropping, onSelect, guides: snapOn = true, highlights, textApiRef, onTextState, onFiles, onChartOptions, onPickPicture, onContextMenu, animation, poses, overlay, className } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Frame>>(new Map());
  const [guideLines, setGuideLines] = useState<SnapGuide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [drawing, setDrawing] = useState<{ box: Box; line?: { x1: number; y1: number; x2: number; y2: number } } | null>(null);
  const [borderGuide, setBorderGuide] = useState<{ axis: "col" | "row"; at: number } | null>(null);
  const latest = useRef({ scene, selected, owner, from, scale, snapOn, cropping, session, editing, tool });
  latest.current = { scene, selected, owner, from, scale, snapOn, cropping, session, editing, tool };

  const live = useMemo(() => withFrames(scene, overrides), [scene, overrides]);
  const byId = useMemo(() => new Map(live.elements.map((e) => [e.id, e])), [live]);

  const toSlide = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: (e.clientX - (rect?.left ?? 0)) / latest.current.scale, y: (e.clientY - (rect?.top ?? 0)) / latest.current.scale };
  }, []);

  const select = useCallback((ids: string[]) => onSelect(ids), [onSelect]);

  const finish = useCallback(() => {
    gesture.current = null;
    setOverrides(new Map());
    setGuideLines([]);
    setMarquee(null);
    setDrawing(null);
    setBorderGuide(null);
  }, []);

  // ---- Moving, resizing and the rest, tracked on the window so a drag can leave the slide -------------------------

  useEffect(() => {
    const onMove = (e: PointerEvent | MouseEvent) => {
      const g = gesture.current;
      if (!g) return;
      const { scene: sc, scale: sk, snapOn: snapping, session: s } = latest.current;
      const pt = toSlide(e);
      const dist = Math.hypot(e.clientX - (g.type === "move" ? g.client.x : 0), e.clientY - (g.type === "move" ? g.client.y : 0));
      const others = (ids: readonly string[]) => sc.elements.filter((x) => x.from === latest.current.from && !ids.includes(x.id) && !x.hidden).map((x) => visualBounds(frameOfElement(x)));
      const th = 5 / sk;

      if (g.type === "move") {
        if (!g.moved && dist < THRESHOLD) return;
        if (!g.moved && g.alt && !g.duplicated) {
          // alt-drag drags a copy and leaves the original
          const copies = s.duplicateElements(latest.current.owner, g.ids, 0);
          const frames = s.frames(latest.current.owner);
          g.frames = new Map(copies.map((id) => [id, { ...(frames.get(id) ?? { x: 0, y: 0, w: 0, h: 0 }), rotation: 0 }]));
          g.ids = copies;
          g.duplicated = true;
          select(copies);
        }
        g.moved = true;
        let dx = pt.x - g.start.x;
        let dy = pt.y - g.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const union = boundsOf([...g.frames.values()].map((f) => visualBounds(f)));
        let lines: SnapGuide[] = [];
        if (snapping && !(e.metaKey || e.ctrlKey)) {
          const r = snap({ ...union, x: union.x + dx, y: union.y + dy }, others(g.ids), sc, { threshold: th });
          dx += r.dx;
          dy += r.dy;
          lines = r.guides;
        }
        setGuideLines(lines);
        setOverrides(new Map([...g.frames].map(([id, f]) => [id, { ...f, x: f.x + dx, y: f.y + dy }])));
        return;
      }
      if (g.type === "resize") {
        const single = g.ids.length === 1;
        const aspect = g.keepAspect || e.shiftKey;
        let target = pt;
        let lines: SnapGuide[] = [];
        if (snapping && single && !g.bounds.rotation) {
          const [hx, hy] = HANDLE_DIR[g.handle];
          const r0 = resizeFrame(g.bounds, g.handle, pt.x, pt.y, { keepAspect: aspect, fromCenter: e.altKey });
          const r = snap(r0, others(g.ids), sc, { threshold: th, spacing: false, edges: { l: hx < 0, r: hx > 0, t: hy < 0, b: hy > 0 } });
          target = { x: pt.x + r.dx, y: pt.y + r.dy };
          lines = r.guides;
        }
        setGuideLines(lines);
        if (single) {
          const next = resizeFrame(g.bounds, g.handle, target.x, target.y, { keepAspect: aspect, fromCenter: e.altKey });
          setOverrides(new Map([[g.ids[0]!, next]]));
        } else {
          const nb = resizeBounds(g.bounds, g.handle, target.x, target.y, { keepAspect: aspect, fromCenter: e.altKey });
          setOverrides(new Map(g.ids.map((id) => [id, { ...scaleWithin(elementBox(g.frames.get(id)!), g.bounds, nb), rotation: g.frames.get(id)!.rotation }])));
        }
        return;
      }
      if (g.type === "rotate") {
        let rot = normalizeAngle(g.frame.rotation + angleTo(g.frame, pt.x, pt.y) - g.startAngle);
        if (e.shiftKey) rot = normalizeAngle(Math.round(rot / 15) * 15);
        setOverrides(new Map([[g.id, { ...g.frame, rotation: rot }]]));
        return;
      }
      if (g.type === "crop") {
        const r = cropByHandle(g.frame, g.crop, g.handle, pt.x, pt.y);
        setOverrides(new Map([[g.id, r.frame]]));
        (g as { crop: typeof g.crop; preview?: typeof g.crop }).preview = r.crop;
        return;
      }
      if (g.type === "marquee") {
        const x = Math.min(g.start.x, pt.x);
        const y = Math.min(g.start.y, pt.y);
        const box = { x, y, w: Math.abs(pt.x - g.start.x), h: Math.abs(pt.y - g.start.y) };
        setMarquee(box);
        const hits = inRect(sc, latest.current.from, box).map((x) => x.id);
        select(g.additive ? [...new Set([...g.base, ...hits])] : hits);
        return;
      }
      if (g.type === "draw") {
        let { x, y } = pt;
        let w = x - g.start.x;
        let h = y - g.start.y;
        if (g.tool.type === "line") {
          if (e.shiftKey) {
            // snap the direction to 45 degree steps
            const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(w, h);
            w = Math.cos(ang) * len;
            h = Math.sin(ang) * len;
          }
          setDrawing({ box: { x: Math.min(g.start.x, g.start.x + w), y: Math.min(g.start.y, g.start.y + h), w: Math.abs(w), h: Math.abs(h) }, line: { x1: g.start.x, y1: g.start.y, x2: g.start.x + w, y2: g.start.y + h } });
          return;
        }
        if (e.shiftKey && g.tool.type === "shape") {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        x = Math.min(g.start.x, g.start.x + w);
        y = Math.min(g.start.y, g.start.y + h);
        setDrawing({ box: { x, y, w: Math.abs(w), h: Math.abs(h) } });
        return;
      }
      if (g.type === "cells") {
        const el = latest.current.scene.elements.find((x) => x.id === g.id);
        const cell = el && cellAt(el, pt.x, pt.y);
        if (cell) onCellRange({ r1: Math.min(g.origin[0], cell[0]), c1: Math.min(g.origin[1], cell[1]), r2: Math.max(g.origin[0], cell[0]), c2: Math.max(g.origin[1], cell[1]) });
        return;
      }
      if (g.type === "border") {
        const el = latest.current.scene.elements.find((x) => x.id === g.id);
        if (!el) return;
        const at = g.axis === "col" ? pt.x - el.x : pt.y - el.y;
        setBorderGuide({ axis: g.axis, at: g.axis === "col" ? el.x + at : el.y + at });
      }
    };

    const onUp = (e: PointerEvent | MouseEvent) => {
      const g = gesture.current;
      if (!g) return;
      const { session: s, owner: o, scene: sc } = latest.current;
      const pt = toSlide(e);
      const done = new Map(overridesRef.current);
      finishRef.current();
      if (g.type === "move") {
        if (g.moved) {
          const first = g.ids[0]!;
          const f = done.get(first);
          const was = g.frames.get(first);
          if (f && was) {
            const dx = f.x - was.x;
            const dy = f.y - was.y;
            if (dx || dy) s.moveBy(o, g.ids, dx, dy, g.duplicated ? { merge: true } : {});
          }
        } else if (!g.shift) {
          // a click, not a drag: a click on a selected text shape or table cell puts the caret in it
          const el = sc.elements.find((x) => x.id === g.hit);
          if (el && g.ids.length === 1 && isPicturePlaceholder(el) && onPickPicture && !readOnly) onPickPicture(el.id);
          else if (el && g.wasSelected && g.ids.length === 1 && editable(el)) onEdit({ element: el.id, cell: g.cell, point: { x: e.clientX, y: e.clientY } });
          else if (el?.kind === "table" && g.cell) onEdit({ element: el.id, cell: g.cell, point: { x: e.clientX, y: e.clientY } });
          else if (g.ids.length > 1) select([g.hit]);
        }
        return;
      }
      if (g.type === "resize") {
        if (done.size === 0) return;
        applyFrames(s, o, sc, done);
        return;
      }
      if (g.type === "rotate") {
        const f = done.get(g.id);
        if (f && f.rotation !== g.frame.rotation) s.setFrames(o, { [g.id]: { rotation: f.rotation } });
        return;
      }
      if (g.type === "crop") {
        const f = done.get(g.id);
        const crop = (g as { preview?: typeof g.crop }).preview;
        if (f && crop) {
          s.updateElement(o, g.id, (el) => (el.type === "image" ? { ...el, x: f.x, y: f.y, w: f.w, h: f.h, crop } : el));
        }
        return;
      }
      if (g.type === "marquee") return;
      if (g.type === "draw") {
        create(g, pt, e.shiftKey);
        return;
      }
      if (g.type === "cells") {
        return;
      }
      if (g.type === "border") {
        const el = sc.elements.find((x) => x.id === g.id);
        if (!el) return;
        const delta = (g.axis === "col" ? pt.x : pt.y) - g.start;
        const sizes = [...g.sizes];
        const a = sizes[g.index]! + delta;
        const b = sizes[g.index + 1]! - delta;
        if (a < 12 || b < 12) return;
        sizes[g.index] = a;
        sizes[g.index + 1] = b;
        s.setTableSizes(o, g.id, g.axis === "col" ? { columns: sizes } : { rows: sizes });
      }
    };
    window.addEventListener("pointermove", onMove as EventListener);
    window.addEventListener("pointerup", onUp as EventListener);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove as EventListener);
      window.removeEventListener("pointerup", onUp as EventListener);
      window.removeEventListener("pointercancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const cancel = useCallback(() => finishRef.current(), []);

  function create(g: Extract<Gesture, { type: "draw" }>, pt: { x: number; y: number }, shift: boolean) {
    const { session: s, owner: o, scene: sc } = latest.current;
    const dx = pt.x - g.start.x;
    const dy = pt.y - g.start.y;
    const dragged = Math.hypot(dx, dy) > 6;
    onTool(null);
    if (g.tool.type === "text") {
      const box = dragged ? { x: Math.min(g.start.x, pt.x), y: Math.min(g.start.y, pt.y), w: Math.max(40, Math.abs(dx)), h: Math.max(24, Math.abs(dy)) } : { x: g.start.x, y: g.start.y, w: Math.min(200, sc.width - g.start.x - 10), h: 36 };
      const el = s.addTextBox(o, box);
      onEdit({ element: el.id });
      return;
    }
    if (g.tool.type === "line") {
      const end = dragged ? { x: g.start.x + dx, y: g.start.y + dy } : { x: g.start.x + 160, y: g.start.y };
      let ex = end.x;
      let ey = end.y;
      if (shift) {
        const ang = Math.round(Math.atan2(ey - g.start.y, ex - g.start.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(ex - g.start.x, ey - g.start.y);
        ex = g.start.x + Math.cos(ang) * len;
        ey = g.start.y + Math.sin(ang) * len;
      }
      const el = s.addShape(o, g.tool.geometry, { x: Math.min(g.start.x, ex), y: Math.min(g.start.y, ey), w: Math.abs(ex - g.start.x), h: Math.abs(ey - g.start.y) }, {
        line: { ...LINE_STYLE, ...(g.tool.arrow ? { tail: "triangle" as const } : {}) },
        ...(ex < g.start.x ? { flipH: true } : {}),
        ...(ey < g.start.y ? { flipV: true } : {}),
      });
      select([el.id]);
      return;
    }
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    let x = Math.min(g.start.x, pt.x);
    let y = Math.min(g.start.y, pt.y);
    if (!dragged) {
      w = 140;
      h = 100;
      x = g.start.x - w / 2;
      y = g.start.y - h / 2;
    } else if (shift) {
      const m = Math.max(w, h);
      w = m;
      h = m;
      x = dx < 0 ? g.start.x - m : g.start.x;
      y = dy < 0 ? g.start.y - m : g.start.y;
    }
    const el = s.addShape(o, g.tool.geometry, { x, y, w, h });
    select([el.id]);
  }

  // ---- Pressing ------------------------------------------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || (e.button !== undefined && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest(".pli-deck-editor")) return;
    const { scene: sc, selected: sel, tool: t } = latest.current;
    if (latest.current.editing) onEdit(null);
    const pt = toSlide(e);
    stageRef.current?.focus({ preventScroll: true });

    if (t) {
      gesture.current = { type: "draw", tool: t, start: pt };
      e.preventDefault();
      return;
    }
    const handleEl = target.closest<HTMLElement>("[data-handle]");
    if (handleEl) {
      const handle = handleEl.dataset.handle!;
      const els = sel.map((id) => byId.get(id)).filter((x): x is ResolvedElement => !!x && !x.source.locked);
      if (els.length === 0) return;
      e.preventDefault();
      if (handle === "rotate") {
        const f = frameOfElement(els[0]!);
        gesture.current = { type: "rotate", id: els[0]!.id, frame: f, startAngle: angleTo(f, pt.x, pt.y) };
        return;
      }
      if (handle === "move") {
        const frames = new Map(els.map((x) => [x.id, frameOfElement(x)]));
        gesture.current = { type: "move", ids: els.map((x) => x.id), start: pt, client: { x: e.clientX, y: e.clientY }, frames, moved: false, wasSelected: true, alt: e.altKey, duplicated: false, shift: false, hit: els[0]!.id };
        return;
      }
      const h = handle as Handle;
      if (latest.current.cropping && els.length === 1 && els[0]!.kind === "image") {
        gesture.current = { type: "crop", id: els[0]!.id, handle: h, frame: frameOfElement(els[0]!), crop: els[0]!.crop ?? {} };
        return;
      }
      const frames = new Map(els.map((x) => [x.id, frameOfElement(x)]));
      const bounds: Frame = els.length === 1 ? frameOfElement(els[0]!) : { ...boundsOf([...frames.values()].map(visualBounds)), rotation: 0 };
      gesture.current = { type: "resize", handle: h, ids: els.map((x) => x.id), frames, bounds, keepAspect: els.length === 1 && els[0]!.kind === "image" && HANDLE_DIR[h][0] !== 0 && HANDLE_DIR[h][1] !== 0 };
      return;
    }

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const hit = hitTest(sc, latest.current.from, pt.x, pt.y, 4 / latest.current.scale);
    if (hit) {
      // inside a selected table, the borders between rows and columns resize them
      if (hit.kind === "table" && sel.includes(hit.id) && !additive) {
        const b = borderAt(hit, pt.x, pt.y, 4 / latest.current.scale);
        if (b) {
          gesture.current = { type: "border", id: hit.id, axis: b.axis, index: b.index, sizes: b.axis === "col" ? [...hit.table!.columns] : hit.table!.rows.map((r) => r.h), start: b.axis === "col" ? pt.x : pt.y };
          e.preventDefault();
          return;
        }
      }
      const wasSelected = sel.includes(hit.id);
      let ids: string[];
      if (additive) {
        ids = wasSelected ? sel.filter((i) => i !== hit.id) : [...sel, hit.id];
        select(ids);
        if (wasSelected) return;
      } else {
        ids = wasSelected ? [...sel] : [hit.id];
        if (!wasSelected) select(ids);
      }
      const els = ids.map((id) => sc.elements.find((x) => x.id === id)).filter((x): x is ResolvedElement => !!x);
      const cell = hit.kind === "table" ? cellAt(hit, pt.x, pt.y) : undefined;
      if (hit.kind === "table" && cell && !additive) {
        onCellRange({ r1: cell[0], c1: cell[1], r2: cell[0], c2: cell[1] });
        // a drag across cells selects a block of them; the edge of the table moves it
        const onEdge = nearEdge(hit, pt.x, pt.y, 6 / latest.current.scale);
        if (!onEdge) {
          // a click (no drag) will start editing the cell: remember where
          const frames = new Map(els.map((x) => [x.id, frameOfElement(x)]));
          gesture.current = { type: "move", ids: [hit.id], start: pt, client: { x: e.clientX, y: e.clientY }, frames, moved: false, wasSelected: true, alt: false, duplicated: false, shift: false, hit: hit.id, cell };
          cellDrag.current = { id: hit.id, origin: cell };
          e.preventDefault();
          return;
        }
      }
      const movable = els.filter((x) => !x.source.locked);
      if (movable.length === 0) return;
      const frames = new Map(movable.map((x) => [x.id, frameOfElement(x)]));
      gesture.current = { type: "move", ids: movable.map((x) => x.id), start: pt, client: { x: e.clientX, y: e.clientY }, frames, moved: false, wasSelected, alt: e.altKey, duplicated: false, shift: additive, hit: hit.id, cell };
      e.preventDefault();
      return;
    }
    // empty space
    if (!additive) select([]);
    onCellRange(null);
    gesture.current = { type: "marquee", start: pt, additive, base: additive ? [...sel] : [] };
  };

  // A press on a table cell is a click (edit the cell) until it moves; moving across cells turns it into a block selection.
  const cellDrag = useRef<{ id: string; origin: [number, number] } | null>(null);
  useEffect(() => {
    const move = (e: Event) => {
      const cd = cellDrag.current;
      const g = gesture.current;
      if (!cd) return;
      if (!g || g.type !== "move") {
        cellDrag.current = null;
        return;
      }
      const ev = e as PointerEvent;
      const pt = toSlide(ev);
      const el = latest.current.scene.elements.find((x) => x.id === cd.id);
      const cell = el && cellAt(el, pt.x, pt.y);
      if (cell && (cell[0] !== cd.origin[0] || cell[1] !== cd.origin[1])) {
        gesture.current = { type: "cells", id: cd.id, origin: cd.origin };
        onCellRange({ r1: Math.min(cd.origin[0], cell[0]), c1: Math.min(cd.origin[1], cell[1]), r2: Math.max(cd.origin[0], cell[0]), c2: Math.max(cd.origin[1], cell[1]) });
        cellDrag.current = null;
      }
    };
    const up = () => {
      cellDrag.current = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest(".pli-deck-editor")) return;
    const pt = toSlide(e);
    const hit = hitTest(scene, from, pt.x, pt.y, 4 / scale);
    if (!hit) return;
    if (hit.kind === "image") return;
    if (hit.kind === "chart") {
      onChartOptions?.(hit.id);
      return;
    }
    if (hit.kind === "table") {
      const cell = cellAt(hit, pt.x, pt.y);
      if (cell) onEdit({ element: hit.id, cell, point: { x: e.clientX, y: e.clientY } });
      return;
    }
    if (hit.kind === "shape" && editable(hit)) {
      select([hit.id]);
      onEdit({ element: hit.id, point: { x: e.clientX, y: e.clientY } });
    }
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (!readOnly && onFiles && [...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault();
  };
  const onDrop = (e: ReactDragEvent) => {
    if (readOnly || !onFiles) return;
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    onFiles(files, toSlide(e));
  };

  const onContext = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly || !onContextMenu) return;
    e.preventDefault();
    const pt = toSlide(e);
    const hit = hitTest(scene, from, pt.x, pt.y, 4 / scale);
    if (hit && !selected.includes(hit.id)) select([hit.id]);
    onContextMenu({ x: e.clientX, y: e.clientY });
  };

  // ---- Drawing the overlay -----------------------------------------------------------------------------------------

  const selectedEls = selected.map((id) => byId.get(id)).filter((e): e is ResolvedElement => !!e && !e.hidden);
  const editEl = editing ? byId.get(editing.element) : undefined;
  const hideText = editing && editEl ? [editing.cell ? `${editEl.id}:${editing.cell[0]}:${editing.cell[1]}` : editEl.id] : [];
  const px = (n: number) => n * scale;

  const boxes: React.ReactNode[] = [];
  if (!readOnly && !editing && !poses && selectedEls.length > 0) {
    for (const el of selectedEls) {
      boxes.push(<div key={el.id} className="pli-deck-selbox" data-selection={el.id} style={{ left: px(el.x), top: px(el.y), width: px(el.w), height: px(el.h), transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }} />);
    }
    const locked = selectedEls.some((e) => e.source.locked);
    const single = selectedEls.length === 1;
    const frame: Frame = single ? frameOfElement(selectedEls[0]!) : { ...boundsOf(selectedEls.map((e) => visualBounds(frameOfElement(e)))), rotation: 0 };
    if (!single) boxes.push(<div key="bounds" className="pli-deck-selbox pli-deck-selbox-group" style={{ left: px(frame.x), top: px(frame.y), width: px(frame.w), height: px(frame.h) }} />);
    if (!locked) {
      const isLine = single && /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(selectedEls[0]!.geometry);
      const list = isLine ? (["nw", "se"] as Handle[]) : single && selectedEls[0]!.kind === "table" ? [] : HANDLES;
      boxes.push(
        <div key="handles" className={cropping ? "pli-deck-handles pli-deck-handles-crop" : "pli-deck-handles"} style={{ left: px(frame.x), top: px(frame.y), width: px(frame.w), height: px(frame.h), transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined }}>
          {list.map((h) => (
            <div key={h} className="pli-deck-handle" role="button" aria-label={handleLabel(h)} data-handle={h} style={{ left: `${(HANDLE_DIR[h][0] + 1) * 50}%`, top: `${(HANDLE_DIR[h][1] + 1) * 50}%` }} />
          ))}
          {single && !isLine && selectedEls[0]!.kind !== "table" && !cropping && <div className="pli-deck-handle pli-deck-handle-rotate" role="button" aria-label="Rotate" data-handle="rotate" style={{ left: "50%", top: 0 }} />}
          {single && selectedEls[0]!.kind === "table" && <div className="pli-deck-handle pli-deck-handle-move" role="button" aria-label="Move table" data-handle="move" />}
        </div>,
      );
    }
  }

  let cellBox: React.ReactNode = null;
  if (cellRange && selectedEls.length === 1 && selectedEls[0]!.table) {
    const t = selectedEls[0]!;
    const rows = t.table!.rows;
    const a = rows[cellRange.r1]?.cells[cellRange.c1];
    const b = rows[cellRange.r2]?.cells[cellRange.c2];
    if (a && b) {
      const x1 = Math.min(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const x2 = Math.max(a.x + a.w, b.x + b.w);
      const y2 = Math.max(a.y + a.h, b.y + b.h);
      cellBox = <div className="pli-deck-cellsel" style={{ left: px(t.x + x1), top: px(t.y + y1), width: px(x2 - x1), height: px(y2 - y1) }} />;
    }
  }

  return (
    <SlideView
      scene={live}
      scale={scale}
      prompts={!readOnly}
      hideText={hideText}
      highlights={highlights}
      poses={poses ?? undefined}
      className={className ? `pli-deck-canvas-slide ${className}` : "pli-deck-canvas-slide"}
      label="Slide"
    >
      <div
        ref={stageRef}
        className="pli-deck-stage"
        data-tool={tool ? tool.type : undefined}
        data-previewing={poses ? "" : undefined}
        tabIndex={-1}
        role="application"
        aria-label="Slide canvas"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContext}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {boxes}
        {cellBox}
        {editing && editEl && !readOnly && (
          <TextEditor
            key={`${editEl.id}:${editing.cell?.join(",") ?? ""}`}
            session={session}
            owner={owner}
            el={editEl}
            cell={editing.cell}
            scale={scale}
            initialRange={editing.range}
            initialText={editing.text}
            point={editing.point}
            apiRef={textApiRef}
            highlights={highlights}
            onExit={() => onEdit(null)}
            onState={onTextState}
            onTab={(back) => moveCell(editEl, editing.cell, back)}
          />
        )}
        {guideLines.map((g, i) => (
          <div
            key={i}
            className={`pli-deck-guide pli-deck-guide-${g.kind} pli-deck-guide-${g.axis}`}
            data-guide={g.axis}
            style={g.kind === "gap" ? (g.axis === "x" ? { left: px(g.from), top: px(g.pos), width: px(g.to - g.from) } : { left: px(g.pos), top: px(g.from), height: px(g.to - g.from) }) : g.axis === "x" ? { left: px(g.pos), top: px(g.from), height: px(g.to - g.from) } : { left: px(g.from), top: px(g.pos), width: px(g.to - g.from) }}
          />
        ))}
        {marquee && <div className="pli-deck-marquee" style={{ left: px(marquee.x), top: px(marquee.y), width: px(marquee.w), height: px(marquee.h) }} />}
        {drawing && !drawing.line && <div className="pli-deck-draw" style={{ left: px(drawing.box.x), top: px(drawing.box.y), width: px(drawing.box.w), height: px(drawing.box.h) }} />}
        {drawing?.line && (
          <svg className="pli-deck-draw-line" width="100%" height="100%" aria-hidden="true">
            <line x1={px(drawing.line.x1)} y1={px(drawing.line.y1)} x2={px(drawing.line.x2)} y2={px(drawing.line.y2)} />
          </svg>
        )}
        {borderGuide && <div className={`pli-deck-guide pli-deck-guide-${borderGuide.axis === "col" ? "x" : "y"}`} style={borderGuide.axis === "col" ? { left: px(borderGuide.at), top: 0, bottom: 0 } : { top: px(borderGuide.at), left: 0, right: 0 }} />}
      </div>
      {overlay}
      {animation && !poses && <AnimationOverlay {...animation} scene={live} scale={scale} selected={selected} readOnly={readOnly} />}
    </SlideView>
  );

  function moveCell(el: ResolvedElement, cell: [number, number] | undefined, back: boolean): boolean {
    if (!cell || !el.table) return false;
    const rows = el.table.rows;
    const cols = el.table.columns.length;
    let [r, c] = cell;
    for (let guard = 0; guard < rows.length * cols + 2; guard++) {
      c += back ? -1 : 1;
      if (c >= cols) {
        c = 0;
        r += 1;
      }
      if (c < 0) {
        c = cols - 1;
        r -= 1;
      }
      if (r < 0) return true;
      if (r >= rows.length) {
        // Tab in the last cell adds a row
        session.insertTableRows(owner, el.id, rows.length);
        onCellRange({ r1: r, c1: 0, r2: r, c2: 0 });
        onEdit({ element: el.id, cell: [r, 0] });
        return true;
      }
      if (!rows[r]!.cells[c]!.covered) {
        onCellRange({ r1: r, c1: c, r2: r, c2: c });
        onEdit({ element: el.id, cell: [r, c] });
        return true;
      }
    }
    return true;
  }
}

function handleLabel(h: Handle): string {
  const names: Record<Handle, string> = { nw: "top left", n: "top", ne: "top right", e: "right", se: "bottom right", s: "bottom", sw: "bottom left", w: "left" };
  return `Resize ${names[h]}`;
}

/** Whether a click on this element can start text editing. */
export function editable(el: ResolvedElement): boolean {
  if (isPicturePlaceholder(el) || (el.kind === "shape" && (el.placeholder?.type === "chart" || el.placeholder?.type === "tbl" || el.placeholder?.type === "media" || el.placeholder?.type === "dgm"))) return false;
  if (el.kind === "shape") return !/^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(el.geometry);
  return el.kind === "table";
}

/** The table cell `[row, col]` under a point (merged cells answer for their origin). */
export function cellAt(el: ResolvedElement, x: number, y: number): [number, number] | undefined {
  if (!el.table) return undefined;
  const lx = x - el.x;
  const ly = y - el.y;
  for (let r = 0; r < el.table.rows.length; r++)
    for (let c = 0; c < el.table.rows[r]!.cells.length; c++) {
      const cell = el.table.rows[r]!.cells[c]!;
      if (cell.covered) continue;
      if (lx >= cell.x && lx <= cell.x + cell.w && ly >= cell.y && ly <= cell.y + cell.h) return [r, c];
    }
  return undefined;
}

function nearEdge(el: ResolvedElement, x: number, y: number, tol: number): boolean {
  return x - el.x < tol || el.x + el.w - x < tol || y - el.y < tol || el.y + el.h - y < tol;
}

/** The border between two columns or rows of a table that a point is on. */
function borderAt(el: ResolvedElement, x: number, y: number, tol: number): { axis: "col" | "row"; index: number } | undefined {
  if (!el.table) return undefined;
  let at = 0;
  for (let i = 0; i < el.table.columns.length - 1; i++) {
    at += el.table.columns[i]!;
    if (Math.abs(x - el.x - at) <= tol && y >= el.y && y <= el.y + el.h) return { axis: "col", index: i };
  }
  at = 0;
  for (let i = 0; i < el.table.rows.length - 1; i++) {
    at += el.table.rows[i]!.h;
    if (Math.abs(y - el.y - at) <= tol && x >= el.x && x <= el.x + el.w) return { axis: "row", index: i };
  }
  return undefined;
}

/** Commits frames after a resize: tables scale their columns and rows; everything else takes the frame. */
function applyFrames(s: DeckSession, owner: string, scene: Scene, frames: ReadonlyMap<string, Frame>) {
  const plain: Record<string, Partial<Frame>> = {};
  const tables: [ResolvedElement, Frame][] = [];
  for (const [id, f] of frames) {
    const el = scene.elements.find((x) => x.id === id);
    if (el?.kind === "table") tables.push([el, f]);
    else plain[id] = { x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation };
  }
  if (Object.keys(plain).length) s.setFrames(owner, plain);
  for (const [el, f] of tables) {
    const sx = el.w ? f.w / el.w : 1;
    const sy = el.h ? f.h / el.h : 1;
    s.setTableSizes(owner, el.id, { columns: el.table!.columns.map((c) => c * sx), rows: el.table!.rows.map((r) => r.h * sy) });
    if (f.x !== el.x || f.y !== el.y) s.setFrames(owner, { [el.id]: { x: f.x, y: f.y } });
  }
}
