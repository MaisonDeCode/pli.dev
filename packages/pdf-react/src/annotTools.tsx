import type { Annotation, InkAnnot, Pt, Rect } from "@pli.dev/pdf";
import { AnnotIcons as I } from "./annotIcons";
import { annotsInRect, boundsOfAll, canMove, canResize, clampRect, constrainAngle, constrainSquare, finishStroke, moveBy, moveVertex, normRect, rectFromPoints, resizeBy, round2, selectionBox, topAnnotAt, vertices, type Handle } from "./annotGeometry";
import { GRAB_PX, GRAB_TOUCH_PX, handleAt, placedAnnotation, vertexAt } from "./AnnotationLayer";
import { MIN_DRAG, type AnnotController, type ToolId } from "./annotController";
import type { StyleKey } from "./annotStyles";
import { screenToPage } from "./geometry";
import type { PagePointerEvent, PdfTool } from "./extensions";
import { textHeight } from "./annotSvg";
import { eraseStrokes } from "./inkErase";

/**
 * The tools, as `PdfTool`s for the viewer's `tools` prop. Each draws nothing itself: it turns pointer events (already in
 * page space, at any zoom and turn of the view) into the controller's drafts, and a finished gesture into one undo step.
 */

/** The page-space points of a pointer event, including the ones the browser batched (a fast pen stroke arrives in groups). */
export function pointsOf(e: PagePointerEvent): Pt[] {
  const native = e.native.nativeEvent as PointerEvent;
  const target = e.native.currentTarget as HTMLElement | null;
  const batch = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
  if (batch.length > 1 && target) {
    const box = target.getBoundingClientRect();
    return batch.map((p) => screenToPage(e.frame, p.clientX - box.left, p.clientY - box.top).map(round2) as unknown as Pt);
  }
  return [[round2(e.x), round2(e.y)]];
}

const pt = (e: PagePointerEvent): Pt => [round2(e.x), round2(e.y)];
const far = (a: Pt, b: Pt, scale: number, px = MIN_DRAG) => Math.hypot(a[0] - b[0], a[1] - b[1]) * scale >= px;
const primary = (e: PagePointerEvent) => e.button === 0 || e.button === undefined;
const insidePage = (e: PagePointerEvent, p: Pt): Pt => [round2(Math.max(0, Math.min(e.width, p[0]))), round2(Math.max(0, Math.min(e.height, p[1])))];

type Meta = { label: string; shortcut: string; hint: string; icon: PdfTool["icon"]; cursor?: string };

/** Names, keys, hints and icons of every tool: the toolbar, the tooltips and the docs table come from here. */
export const TOOL_INFO: Record<ToolId, Meta> = {
  select: { label: "Select", shortcut: "V", hint: "Click an annotation to select it. Drag to move, drag a handle to resize, drag on empty space to select several.", icon: I.select, cursor: "default" },
  highlight: { label: "Highlight", shortcut: "H", hint: "Select text to highlight it.", icon: I.highlight, cursor: "text" },
  underline: { label: "Underline", shortcut: "U", hint: "Select text to underline it.", icon: I.underline, cursor: "text" },
  strikeout: { label: "Strikethrough", shortcut: "S", hint: "Select text to strike it out.", icon: I.strikeout, cursor: "text" },
  squiggly: { label: "Squiggly underline", shortcut: "W", hint: "Select text to underline it with a wavy line.", icon: I.squiggly, cursor: "text" },
  ink: { label: "Pen", shortcut: "P", hint: "Draw freehand. Press Escape to stop.", icon: I.pen, cursor: "crosshair" },
  eraser: { label: "Eraser", shortcut: "E", hint: "Drag over annotations to remove them. Pen strokes are cut where you drag.", icon: I.eraser, cursor: "cell" },
  rectangle: { label: "Rectangle", shortcut: "R", hint: "Drag to draw a rectangle. Hold Shift for a square.", icon: I.rectangle },
  ellipse: { label: "Ellipse", shortcut: "O", hint: "Drag to draw an ellipse. Hold Shift for a circle.", icon: I.ellipse },
  line: { label: "Line", shortcut: "L", hint: "Drag to draw a line. Hold Shift to keep it straight.", icon: I.line },
  arrow: { label: "Arrow", shortcut: "A", hint: "Drag to draw an arrow. Hold Shift to keep it straight.", icon: I.arrow },
  polyline: { label: "Polyline", shortcut: "Y", hint: "Click each point. Double-click or press Enter to finish.", icon: I.polyline },
  polygon: { label: "Polygon", shortcut: "G", hint: "Click each corner. Double-click, press Enter or click the first point to finish.", icon: I.polygon },
  text: { label: "Text box", shortcut: "T", hint: "Click or drag to place a text box, then type.", icon: I.text, cursor: "text" },
  note: { label: "Note", shortcut: "N", hint: "Click where the note goes, then write your comment.", icon: I.note, cursor: "copy" },
  stamp: { label: "Stamp", shortcut: "M", hint: "Click to place the stamp, or drag to size it.", icon: I.stamp },
  signature: { label: "Signature", shortcut: "F", hint: "Click to place the signature, or drag to size it.", icon: I.signature },
  image: { label: "Picture", shortcut: "I", hint: "Click to place the picture, or drag to size it.", icon: I.image },
  link: { label: "Link", shortcut: "K", hint: "Drag a box, then choose where it goes.", icon: I.link },
  redact: { label: "Redact", shortcut: "X", hint: "Drag a box over what must go. Nothing is removed until you apply the redactions.", icon: I.redact },
};

/** Keys that choose a tool (single letters; ignored while typing in a field). */
export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries((Object.entries(TOOL_INFO) as [ToolId, Meta][]).map(([id, m]) => [m.shortcut.toLowerCase(), id]));

const MARKUP: ToolId[] = ["highlight", "underline", "strikeout", "squiggly"];

export function createTools(c: AnnotController): PdfTool[] {
  const tools: PdfTool[] = [];
  const add = (id: ToolId, extra: Omit<PdfTool, "id" | "label" | "icon" | "shortcut" | "needsEdit" | "hidden">) => {
    if (!c.tools.has(id)) return;
    const m = TOOL_INFO[id];
    tools.push({ id, label: m.label, icon: m.icon, shortcut: m.shortcut, cursor: m.cursor, needsEdit: true, hidden: true, hint: m.hint, ...extra });
  };

  // ---- select ----------------------------------------------------------------------------------------------------

  type Gesture =
    | { kind: "move"; start: Pt; originals: Annotation[]; moved: boolean }
    | { kind: "resize"; start: Pt; original: Annotation; handle: Handle; moved: boolean }
    | { kind: "vertex"; start: Pt; original: Annotation; index: number; moved: boolean }
    | { kind: "marquee"; start: Pt; base: string[]; page: string };
  let gesture: Gesture | null = null;
  let lastClick: { id: string; time: number; x: number; y: number } | null = null;

  add("select", {
    onCancel() {
      gesture = null;
      c.preview = new Map();
      c.draft = null;
      c.emit();
    },
    onPointer(e) {
      const page = c.pageById(e.page.id);
      if (!page) return;
      const tol = 5 / e.scale;
      if (e.type === "down") {
        if (!primary(e)) return;
        const onPage = new Set(page.annots.map((x) => x.id));
        const here = c.selected.filter((a) => onPage.has(a.id));
        const start = pt(e);
        if (here.length === 1 && !here[0]!.locked) {
          const a = here[0]!;
          const verts = vertices(a);
          const grab = e.pointerType === "touch" || e.pointerType === "pen" ? GRAB_TOUCH_PX : GRAB_PX;
          const vi = verts ? vertexAt(verts, e.x, e.y, e.scale, grab) : -1;
          if (vi >= 0) return void (gesture = { kind: "vertex", start, original: a, index: vi, moved: false });
          const h = !verts && canResize(a) ? handleAt(selectionBox(a), e.x, e.y, e.scale, grab) : null;
          if (h) return void (gesture = { kind: "resize", start, original: a, handle: h, moved: false });
        }
        const hit = topAnnotAt(page.annots, e.x, e.y, tol);
        if (hit) {
          const now = Date.now();
          const again = lastClick && lastClick.id === hit.id && now - lastClick.time < 450 && Math.hypot(lastClick.x - e.x, lastClick.y - e.y) * e.scale < 8;
          lastClick = { id: hit.id, time: now, x: e.x, y: e.y };
          if (again) {
            gesture = null;
            if (hit.type === "freetext") c.beginEdit(page.id, hit, false);
            else c.openComment(hit.id);
            return;
          }
          if (e.shiftKey) {
            const mine = here.map((a) => a.id);
            const ids = mine.includes(hit.id) ? mine.filter((x) => x !== hit.id) : [...mine, hit.id];
            c.select(ids, page.id);
            gesture = null;
            return;
          }
          if (!c.selectedIds.includes(hit.id)) c.select([hit.id], page.id);
          const movable = c.selected.filter(canMove);
          gesture = movable.length > 0 ? { kind: "move", start, originals: movable, moved: false } : null;
          c.popover = null;
          c.emit();
          return;
        }
        lastClick = null;
        const base = e.shiftKey ? here.map((a) => a.id) : [];
        if (!e.shiftKey) c.select([], page.id);
        c.popover = null;
        gesture = { kind: "marquee", start, base, page: page.id };
        c.draft = { type: "marquee", page: page.id, rect: { x: e.x, y: e.y, w: 0, h: 0 } };
        c.emit();
        return;
      }
      if (!gesture) return;
      const g = gesture;
      if (e.type === "move") {
        if (g.kind === "marquee") {
          c.draft = { type: "marquee", page: g.page, rect: rectFromPoints(g.start, pt(e)) };
          c.emit();
          return;
        }
        if (!g.moved && !far(g.start, pt(e), e.scale)) return;
        g.moved = true;
        let dx = e.x - g.start[0];
        let dy = e.y - g.start[1];
        if (g.kind === "move") {
          if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
          const box = boundsOfAll(g.originals);
          dx = Math.max(-box.x, Math.min(page.width - box.x - box.w, dx));
          dy = Math.max(-box.y, Math.min(page.height - box.y - box.h, dy));
          c.preview = new Map(g.originals.map((a) => [a.id, moveBy(a, round2(dx), round2(dy))]));
        } else if (g.kind === "resize") {
          c.preview = new Map([[g.original.id, resizeBy(g.original, g.handle, dx, dy, e.shiftKey ? { keepAspect: true } : {})]]);
        } else {
          let target = insidePage(e, pt(e));
          const verts = vertices(g.original);
          const other = verts && g.original.type === "line" ? verts[g.index === 0 ? 1 : 0] : undefined;
          if (e.shiftKey && other) target = constrainAngle(other, target);
          c.preview = new Map([[g.original.id, moveVertex(g.original, g.index, target[0], target[1])]]);
        }
        c.emit();
        return;
      }
      // up
      gesture = null;
      if (g.kind === "marquee") {
        const rect = rectFromPoints(g.start, pt(e));
        c.draft = null;
        if (far([rect.x, rect.y], [rect.x + rect.w, rect.y + rect.h], e.scale)) {
          const ids = annotsInRect(page.annots, rect).map((a) => a.id);
          c.select([...new Set([...g.base, ...ids])], page.id);
        } else c.emit();
        return;
      }
      if (g.moved) c.commitPreview(g.kind === "move" ? "Moved" : "Resized");
      else {
        c.preview = new Map();
        c.emit();
      }
    },
  });

  // ---- markup from selected text -----------------------------------------------------------------------------------

  for (const id of MARKUP) {
    const type = id as "highlight" | "underline" | "strikeout" | "squiggly";
    add(id, {
      selectText: true,
      onTextSelected(selection) {
        if (c.markup(type, selection).length > 0) c.finishTool(type);
      },
    });
  }

  // ---- pen and eraser ----------------------------------------------------------------------------------------------

  let pen = false;
  add("ink", {
    onCancel() {
      pen = false;
      c.draft = null;
      c.emit();
    },
    onPointer(e) {
      if (e.type === "down") {
        if (!primary(e)) return;
        pen = true;
        c.draft = { type: "ink", page: e.page.id, points: [pt(e)], style: c.style("ink") };
      } else if (!pen || c.draft?.type !== "ink") {
        return; // the pointer moving over the page with no button down
      } else {
        c.draft = { ...c.draft, points: [...c.draft.points, ...pointsOf(e)] };
        if (e.type === "up") {
          pen = false;
          const d = c.draft;
          c.draft = null;
          const strokes = [finishStroke(d.points.map((p): Pt => insidePage(e, p)))];
          const s = d.style;
          c.add(d.page, { type: "ink", strokes, stroke: { color: s.color, width: s.width, ...(s.dash && s.dash.length ? { dash: s.dash } : {}) }, ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}) } as never, { select: !s.sticky });
          c.finishTool("ink");
          return;
        }
      }
      c.emit();
    },
  });

  // The eraser removes whole annotations it passes over, and cuts pen strokes where it passes: what is left of a drawing
  // is shown at once (as a preview), and the whole drag is one undo step when the pointer lets go.
  let erasing = false;
  let last: Pt | null = null;
  const erase = (e: PagePointerEvent, from: Pt, to: Pt) => {
    const page = c.pageById(e.page.id);
    if (!page) return;
    const reach = (e.pointerType === "touch" || e.pointerType === "pen" ? 9 : 5) / e.scale;
    for (const a of page.annots) {
      if (a.locked || c.erased.has(a.id)) continue;
      if (a.type === "ink") {
        const now = (c.preview.get(a.id) ?? a) as InkAnnot;
        const left = eraseStrokes(now.strokes, from, to, reach + a.stroke.width / 2);
        if (!left) continue;
        if (left.length === 0) {
          c.preview.delete(a.id);
          c.erased.add(a.id);
        } else c.preview.set(a.id, { ...now, strokes: left });
      } else {
        // Along the stretch the pointer moved, not only where it ended: a quick drag must not skip a thin line.
        const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (reach / 2)));
        for (let i = 1; i <= steps; i++) {
          if (topAnnotAt([a], from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, reach)) {
            c.erased.add(a.id);
            break;
          }
        }
      }
    }
  };
  add("eraser", {
    onCancel() {
      erasing = false;
      last = null;
      c.erased = new Set();
      c.preview = new Map();
      c.emit();
    },
    onPointer(e) {
      if (e.type === "down") {
        if (!primary(e)) return;
        erasing = true;
        last = pt(e);
        erase(e, last, last);
      } else if (!erasing) {
        return;
      } else {
        for (const p of pointsOf(e)) {
          erase(e, last ?? p, p);
          last = p;
        }
        if (e.type === "up") {
          erasing = false;
          last = null;
          c.commitErase();
        }
      }
      c.emit();
    },
  });

  // ---- shapes and boxes -----------------------------------------------------------------------------------------------

  type Kind = "rectangle" | "ellipse" | "line" | "arrow" | "redact" | "link" | "text";
  const dragTool = (id: Kind & ToolId, commit: (page: string, rect: Rect, from: Pt, to: Pt, click: boolean, e: PagePointerEvent) => void) => {
    let from: Pt | null = null;
    add(id, {
      onCancel() {
        from = null;
        c.draft = null;
        c.emit();
      },
      onPointer(e) {
        if (e.type === "down") {
          if (!primary(e)) return;
          c.popover = null;
          from = insidePage(e, pt(e));
          c.draft = { type: "box", kind: id, page: e.page.id, from, to: from, style: c.style(id === "link" ? "note" : id) };
          return c.emit();
        }
        if (!from || c.draft?.type !== "box") return;
        let to = insidePage(e, pt(e));
        if (e.shiftKey) to = id === "line" || id === "arrow" ? constrainAngle(from, to) : id === "rectangle" || id === "ellipse" ? constrainSquare(from, to) : to;
        if (e.type === "move") {
          c.draft = { ...c.draft, to };
          return c.emit();
        }
        const start = from;
        from = null;
        const rect = clampRect(normRect(rectFromPoints(start, to)), e.width, e.height);
        const click = !far(start, to, e.scale);
        c.draft = null;
        commit(e.page.id, rect, start, to, click, e);
        c.emit();
      },
    });
  };

  const stroke = (key: StyleKey) => {
    const s = c.style(key);
    return { color: s.color, width: s.width, ...(s.dash && s.dash.length ? { dash: s.dash } : {}) };
  };
  const opacity = (key: StyleKey) => {
    const o = c.style(key).opacity;
    return o !== undefined && o < 1 ? { opacity: o } : {};
  };
  const fill = (key: StyleKey) => (c.style(key).fill ? { fill: c.style(key).fill } : {});

  dragTool("rectangle", (page, rect, _f, _t, click) => {
    if (click) return;
    c.add(page, { type: "square", rect, stroke: stroke("rectangle"), ...fill("rectangle"), ...opacity("rectangle") } as never, { select: !c.style("rectangle").sticky });
    c.finishTool("rectangle");
  });
  dragTool("ellipse", (page, rect, _f, _t, click) => {
    if (click) return;
    c.add(page, { type: "circle", rect, stroke: stroke("ellipse"), ...fill("ellipse"), ...opacity("ellipse") } as never, { select: !c.style("ellipse").sticky });
    c.finishTool("ellipse");
  });
  for (const id of ["line", "arrow"] as const) {
    dragTool(id, (page, _r, from, to, click) => {
      if (click) return;
      const s = c.style(id);
      c.add(page, { type: "line", from: [round2(from[0]), round2(from[1])], to: [round2(to[0]), round2(to[1])], stroke: stroke(id), ...(s.startEnd && s.startEnd !== "none" ? { startEnd: s.startEnd } : {}), ...(s.endEnd && s.endEnd !== "none" ? { endEnd: s.endEnd } : {}), ...opacity(id) } as never, { select: !s.sticky });
      c.finishTool(id);
    });
  }
  dragTool("redact", (page, rect, _f, _t, click) => {
    if (click) return;
    c.add(page, { type: "redact", rects: [rect], ...fill("redact") } as never, { select: !c.style("redact").sticky, say: "Marked for redaction. Nothing is removed until you apply the redactions." });
    c.finishTool("redact");
  });
  dragTool("link", (page, rect, _f, _t, click) => {
    if (click) return;
    c.draft = { type: "box", kind: "link", page, from: [rect.x, rect.y], to: [rect.x + rect.w, rect.y + rect.h], style: c.style("note") };
    c.popover = { kind: "link", page, rect };
  });
  dragTool("text", (page, rect, from, _t, click, e) => {
    const size = c.style("text").size;
    const h = textHeight(1, size);
    const box = click ? clampRect({ x: from[0], y: from[1], w: 160, h }, e.width, e.height) : { ...rect, w: Math.max(rect.w, 40), h: Math.max(rect.h, h) };
    c.beginEdit(page, c.newTextBox({ x: round2(box.x), y: round2(box.y), w: round2(box.w), h: round2(box.h) }), true);
  });

  // ---- polyline and polygon -----------------------------------------------------------------------------------------

  for (const closed of [false, true]) {
    const id = closed ? "polygon" : "polyline";
    let last: { time: number; p: Pt } | null = null;
    add(id, {
      onCancel() {
        c.draft = null;
        last = null;
        c.emit();
      },
      onPointer(e) {
        const d = c.draft?.type === "poly" && c.draft.page === e.page.id ? c.draft : null;
        let p = insidePage(e, pt(e));
        if (d && e.shiftKey && d.points.length > 0) p = constrainAngle(d.points[d.points.length - 1]!, p);
        if (e.type === "move") {
          if (d) {
            c.draft = { ...d, hover: p };
            c.emit();
          }
          return;
        }
        if (e.type !== "down" || !primary(e)) return;
        const now = Date.now();
        if (!d) {
          c.popover = null;
          c.draft = { type: "poly", page: e.page.id, closed, points: [p], hover: p, style: c.style(id) };
          last = { time: now, p };
          return c.emit();
        }
        const dbl = last && now - last.time < 450 && far(last.p, p, e.scale, 0) && Math.hypot(last.p[0] - p[0], last.p[1] - p[1]) * e.scale < 8;
        const closing = closed && d.points.length >= 3 && Math.hypot(d.points[0]![0] - p[0], d.points[0]![1] - p[1]) * e.scale < 10;
        if (dbl || closing) {
          last = null;
          c.finishPoly();
          return c.emit();
        }
        c.draft = { ...d, points: [...d.points, p], hover: p };
        last = { time: now, p };
        c.emit();
      },
    });
  }

  // ---- notes -----------------------------------------------------------------------------------------------------

  add("note", {
    onCancel() {
      c.draft = null;
      c.popover = null;
      c.emit();
    },
    onPointer(e) {
      if (e.type !== "down" || !primary(e)) return;
      const x = round2(Math.max(0, Math.min(e.width - 24, e.x)));
      const y = round2(Math.max(0, Math.min(e.height - 24, e.y)));
      c.draft = { type: "note", page: e.page.id, x, y, style: c.style("note") };
      c.popover = { kind: "new-note", page: e.page.id, x, y };
      c.emit();
    },
  });

  // ---- things chosen from a menu and placed: stamps, signatures, pictures ------------------------------------------------

  for (const id of ["stamp", "signature", "image"] as const) {
    let from: Pt | null = null;
    add(id, {
      cursor: "copy",
      onCancel() {
        from = null;
        c.draft = null;
        c.placing = null;
        c.emit();
      },
      onPointer(e) {
        const placing = c.placing;
        if (!placing) return;
        const ratio = placing.kind === "signature" ? placing.ratio : placing.w / Math.max(1, placing.h);
        const lock = placing.kind !== "stamp" || "picture" in placing.stamp;
        const size = placing.kind === "signature" ? { w: placing.w, h: placing.w / placing.ratio } : { w: placing.w, h: placing.h };
        const ghost = (center: Pt): [Pt, Pt] => [[center[0] - size.w / 2, center[1] - size.h / 2], [center[0] + size.w / 2, center[1] + size.h / 2]];
        if (e.type === "move" && !from) {
          const [a, b] = ghost(pt(e));
          c.draft = { type: "box", kind: "placing", page: e.page.id, from: a, to: b, style: c.style("stamp") };
          return c.emit();
        }
        if (e.type === "down") {
          if (!primary(e)) return;
          from = insidePage(e, pt(e));
          c.draft = { type: "box", kind: "placing", page: e.page.id, from, to: from, style: c.style("stamp") };
          return c.emit();
        }
        if (!from) return;
        let to = insidePage(e, pt(e));
        if (lock) {
          const w = Math.abs(to[0] - from[0]);
          to = [to[0], from[1] + (to[1] >= from[1] ? 1 : -1) * (w / ratio)];
        }
        if (e.type === "move") {
          c.draft = { type: "box", kind: "placing", page: e.page.id, from, to, style: c.style("stamp") };
          return c.emit();
        }
        const start = from;
        from = null;
        let rect: Rect;
        if (!far(start, to, e.scale)) {
          const [a, b] = ghost(start);
          rect = clampRect(normRect(rectFromPoints(a, b)), e.width, e.height);
        } else rect = clampRect(normRect(rectFromPoints(start, to)), e.width, e.height);
        rect = { x: round2(rect.x), y: round2(rect.y), w: round2(Math.max(rect.w, 8)), h: round2(Math.max(rect.h, 8)) };
        c.draft = null;
        c.placing = null;
        const { id: _id, ...placed } = placedAnnotation(placing, rect, "");
        c.add(e.page.id, placed as never, { say: `${placing.kind === "stamp" ? "Stamp" : placing.kind === "image" ? "Picture" : "Signature"} placed` });
        c.setTool("select");
      },
    });
  }

  return tools;
}
