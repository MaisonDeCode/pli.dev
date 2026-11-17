import { memo, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { fontStack, type FontRegistry } from "@pli.dev/core";
import { useDocumentFonts, useFonts } from "@pli.dev/react";
import type { Annotation, FreeTextAnnot, LineAnnot, Pt, Rect } from "@pli.dev/pdf";
import { HANDLES, canResize, handlePoint, rectFromPoints, selectionBox, vertices, type Handle } from "./annotGeometry";
import { cssFont, dashArray, endShapes, measurer, noteIconShape, wrapText, fitFontSize, LINE_HEIGHT, TEXT_PAD } from "./annotSvg";
import { smoothPathData, squigglyPathData } from "./annotGeometry";
import { stampFontSize, stampText } from "./stamps";
import { scaleStrokes } from "./signatures";
import { useSessionRevision } from "./hooks";
import type { AnnotController, Draft, Placing } from "./annotController";
import type { PageContext } from "./extensions";

/**
 * Draws annotations in page space: one `<g>` per annotation with `data-annot` and `data-type`. The looks follow what the engine
 * writes into the PDF: a highlight multiplies with the page (so it lives in `BlendLayer`), ink has round caps and joins,
 * notes are 24 points square, a stamp is a bold upper-case label in a rounded box, a redaction mark is a hatched box.
 */

export type FontStacks = (family: string) => string;

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

export interface ShapeProps {
  annot: Annotation;
  stacks: FontStacks;
  /** The text of this box is being edited in a text area: do not draw it twice. */
  hideText?: boolean;
  /** Draw links (they are invisible in a PDF unless the reader asks). */
  showLinks?: boolean;
  /** A shape that is being drawn or placed (lighter, no hit area). */
  ghost?: boolean;
  onNote?: (id: string) => void;
}

function Strokes({ annot }: { annot: Extract<Annotation, { type: "ink" }> }) {
  const { stroke } = annot;
  return (
    <g fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashArray(stroke)}>
      {annot.strokes.map((s, i) => (
        <path key={i} d={smoothPathData(s)} />
      ))}
    </g>
  );
}

function Ends({ points, annot }: { points: readonly Pt[]; annot: Pick<LineAnnot, "startEnd" | "endEnd" | "stroke"> }) {
  const shapes = endShapes(points, annot.startEnd, annot.endEnd, annot.stroke.width);
  return (
    <>
      {shapes.map((s, i) => (
        <path key={i} d={s.d} fill={s.fill ? annot.stroke.color : "none"} stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </>
  );
}

function FreeText({ annot, stacks, hideText }: { annot: FreeTextAnnot; stacks: FontStacks; hideText?: boolean }) {
  const { rect, style } = annot;
  const stack = stacks(style.family);
  const size = style.size;
  const font = cssFont(stack, size, style.bold, style.italic);
  const lines = useMemo(() => wrapText(annot.text, Math.max(1, rect.w - 2 * TEXT_PAD), measurer(font, size)), [annot.text, rect.w, font, size]);
  const align = style.align ?? "left";
  const x = align === "left" ? rect.x + TEXT_PAD : align === "center" ? rect.x + rect.w / 2 : rect.x + rect.w - TEXT_PAD;
  const clip = `pli-clip-${safeId(annot.id)}`;
  return (
    <g>
      {annot.fill && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={annot.fill} />}
      {annot.stroke && annot.stroke.width > 0 && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} />}
      {!hideText && (
        <>
          <clipPath id={clip}>
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
          </clipPath>
          <text
            clipPath={`url(#${clip})`}
            fill={style.color}
            textAnchor={align === "left" ? "start" : align === "center" ? "middle" : "end"}
            style={{ fontFamily: stack, fontSize: size, fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal", whiteSpace: "pre" }}
          >
            {lines.map((line, i) => (
              <tspan key={i} x={x} y={rect.y + TEXT_PAD + size + i * size * LINE_HEIGHT}>
                {line === "" ? "​" : line}
              </tspan>
            ))}
          </text>
        </>
      )}
    </g>
  );
}

function Stamp({ annot, stacks }: { annot: Extract<Annotation, { type: "stamp" }>; stacks: FontStacks }) {
  const { rect, stamp } = annot;
  if ("picture" in stamp) return <image href={stamp.picture.src} x={rect.x} y={rect.y} width={rect.w} height={rect.h} preserveAspectRatio="xMidYMid meet" />;
  const color = stamp.color ?? "#c62828";
  const label = stampText(stamp);
  const size = stampFontSize(label, rect.w, rect.h);
  const inset = Math.max(1, Math.min(rect.w, rect.h) * 0.04);
  return (
    <g>
      <rect x={rect.x + inset} y={rect.y + inset} width={rect.w - 2 * inset} height={rect.h - 2 * inset} rx={Math.min(8, rect.h * 0.18)} fill="none" stroke={color} strokeWidth={Math.max(1.5, rect.h * 0.06)} />
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + size * 0.35} textAnchor="middle" fill={color} style={{ fontFamily: stacks("Helvetica"), fontSize: size, fontWeight: 700 }}>
        {label}
      </text>
    </g>
  );
}

function Signature({ annot, stacks }: { annot: Extract<Annotation, { type: "signature" }>; stacks: FontStacks }) {
  const { rect } = annot;
  const color = annot.color ?? "#0b2a6b";
  if (annot.mode === "image" && annot.picture) return <image href={annot.picture.src} x={rect.x} y={rect.y} width={rect.w} height={rect.h} preserveAspectRatio="xMidYMid meet" />;
  if (annot.mode === "type") {
    const stack = stacks(annot.font ?? "cursive");
    const text = annot.text ?? "";
    const size = fitFontSize(text, rect.w, rect.h, (s) => measurer(cssFont(stack, s), s)(text));
    return (
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + size * 0.3} textAnchor="middle" fill={color} style={{ fontFamily: stack, fontSize: size }}>
        {text}
      </text>
    );
  }
  return (
    <g transform={`translate(${rect.x} ${rect.y})`} fill="none" stroke={color} strokeWidth={annot.width ?? 2} strokeLinecap="round" strokeLinejoin="round">
      {(annot.strokes ?? []).map((s, i) => (
        <path key={i} d={smoothPathData(s)} />
      ))}
    </g>
  );
}

function Note({ annot }: { annot: Extract<Annotation, { type: "note" }> }) {
  const icon = noteIconShape(annot.icon);
  return (
    <g transform={`translate(${annot.x} ${annot.y})`}>
      <path d={icon.body} fill={annot.color ?? "#ffd400"} stroke="rgb(0 0 0 / 0.6)" strokeWidth={1.2} strokeLinejoin="round" />
      <path d={icon.marks} fill="none" stroke="rgb(0 0 0 / 0.65)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Redact({ annot }: { annot: Extract<Annotation, { type: "redact" }> }) {
  const id = `pli-hatch-${safeId(annot.id)}`;
  return (
    <g>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="rgb(217 48 37 / 0.10)" />
        <line x1={0} y1={0} x2={0} y2={6} stroke="#d93025" strokeWidth={1.4} />
      </pattern>
      {annot.rects.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${id})`} stroke="#d93025" strokeWidth={1} strokeDasharray="4 2" />
          {annot.overlay && r.w > 8 && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + Math.min(r.h * 0.3, 5)} textAnchor="middle" fill="#d93025" style={{ fontSize: Math.min(r.h * 0.7, 10), fontWeight: 700 }}>
              {annot.overlay}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function Body({ annot, stacks, hideText, showLinks }: ShapeProps) {
  switch (annot.type) {
    case "highlight":
      return (
        <g fill={annot.color}>
          {annot.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} />
          ))}
        </g>
      );
    case "underline":
    case "strikeout": {
      const width = (r: Rect) => Math.max(0.8, r.h * 0.07);
      return (
        <g stroke={annot.color} strokeLinecap="butt">
          {annot.rects.map((r, i) => {
            const y = annot.type === "underline" ? r.y + r.h - width(r) : r.y + r.h * 0.55;
            return <line key={i} x1={r.x} y1={y} x2={r.x + r.w} y2={y} strokeWidth={width(r)} />;
          })}
        </g>
      );
    }
    case "squiggly":
      return (
        <g fill="none" stroke={annot.color} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round">
          {annot.rects.map((r, i) => (
            <path key={i} d={squigglyPathData(r.x, r.x + r.w, r.y + r.h - 1.4)} />
          ))}
        </g>
      );
    case "ink":
      return <Strokes annot={annot} />;
    case "square":
      return <rect x={annot.rect.x} y={annot.rect.y} width={annot.rect.w} height={annot.rect.h} fill={annot.fill ?? "none"} stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} strokeLinejoin="miter" />;
    case "circle":
      return <ellipse cx={annot.rect.x + annot.rect.w / 2} cy={annot.rect.y + annot.rect.h / 2} rx={annot.rect.w / 2} ry={annot.rect.h / 2} fill={annot.fill ?? "none"} stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} />;
    case "line":
      return (
        <g>
          <line x1={annot.from[0]} y1={annot.from[1]} x2={annot.to[0]} y2={annot.to[1]} stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} strokeLinecap="round" />
          <Ends points={[annot.from, annot.to]} annot={annot} />
        </g>
      );
    case "polygon":
      return <polygon points={annot.points.map((p) => p.join(",")).join(" ")} fill={annot.fill ?? "none"} stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} strokeLinejoin="round" />;
    case "polyline":
      return <polyline points={annot.points.map((p) => p.join(",")).join(" ")} fill="none" stroke={annot.stroke.color} strokeWidth={annot.stroke.width} strokeDasharray={dashArray(annot.stroke)} strokeLinejoin="round" strokeLinecap="round" />;
    case "freetext":
      return <FreeText annot={annot} stacks={stacks} hideText={hideText} />;
    case "note":
      return <Note annot={annot} />;
    case "stamp":
      return <Stamp annot={annot} stacks={stacks} />;
    case "signature":
      return <Signature annot={annot} stacks={stacks} />;
    case "image":
      return <image href={annot.picture.src} x={annot.rect.x} y={annot.rect.y} width={annot.rect.w} height={annot.rect.h} preserveAspectRatio="none" />;
    case "link":
      return showLinks ? <rect x={annot.rect.x} y={annot.rect.y} width={annot.rect.w} height={annot.rect.h} fill="rgb(26 115 232 / 0.08)" stroke="#1a73e8" strokeWidth={1} strokeDasharray="4 2" /> : null;
    case "redact":
      return <Redact annot={annot} />;
  }
}

/** One annotation. Memoised: it redraws only when the annotation itself (or what it is drawn with) changes. */
export const AnnotShape = memo(function AnnotShape(props: ShapeProps) {
  const { annot, ghost, onNote } = props;
  if (annot.hidden) return null;
  const opacity = annot.opacity !== undefined && annot.opacity < 1 ? annot.opacity : undefined;
  return (
    <g
      className="pli-pdf-annot"
      data-annot={annot.id}
      data-type={annot.type}
      data-locked={annot.locked ? "" : undefined}
      opacity={ghost ? (opacity ?? 1) * 0.6 : opacity}
      data-pointer={annot.type === "note" && onNote ? "" : undefined}
      onPointerDown={annot.type === "note" && onNote ? (e) => (e.stopPropagation(), onNote(annot.id)) : undefined}
    >
      <Body {...props} />
    </g>
  );
});

// ---- fonts ------------------------------------------------------------------------------------------------------

/** The `font-family` stacks for the text of a page, loading the families it uses. */
export function useStacks(fonts: FontRegistry | false | undefined, families: readonly string[]): FontStacks {
  const registry = useFonts(fonts || undefined);
  const version = useDocumentFonts(registry, fonts === false ? [] : families);
  return useMemo<FontStacks>(() => (fonts === false ? (f) => fontStack(f) : (f) => registry.stack(f)), [fonts, registry, version]);
}

const textFamilies = (annots: readonly Annotation[]): string[] => {
  const out = new Set<string>();
  for (const a of annots) {
    if (a.type === "freetext") out.add(a.style.family);
    else if (a.type === "signature" && a.mode === "type" && a.font) out.add(a.font);
  }
  return [...out];
};

// ---- drafts -----------------------------------------------------------------------------------------------------

/** What a draft looks like as an annotation, so the layer can draw it with the same code. */
export function draftAnnotation(draft: Draft, placing: Placing | null): Annotation | null {
  const stroke = (s: { color: string; width: number; dash?: number[] }) => ({ color: s.color, width: s.width, ...(s.dash && s.dash.length ? { dash: s.dash } : {}) });
  switch (draft.type) {
    case "ink":
      return { id: "draft", type: "ink", strokes: [draft.points], stroke: stroke(draft.style) };
    case "poly": {
      const points = draft.hover ? [...draft.points, draft.hover] : draft.points;
      if (points.length < 2) return null;
      return draft.closed && points.length > 2
        ? { id: "draft", type: "polygon", points, stroke: stroke(draft.style), ...(draft.style.fill ? { fill: draft.style.fill } : {}) }
        : { id: "draft", type: "polyline", points, stroke: stroke(draft.style) };
    }
    case "box": {
      const rect = rectFromPoints(draft.from, draft.to);
      switch (draft.kind) {
        case "rectangle":
          return { id: "draft", type: "square", rect, stroke: stroke(draft.style), ...(draft.style.fill ? { fill: draft.style.fill } : {}) };
        case "ellipse":
          return { id: "draft", type: "circle", rect, stroke: stroke(draft.style), ...(draft.style.fill ? { fill: draft.style.fill } : {}) };
        case "line":
        case "arrow":
          return { id: "draft", type: "line", from: draft.from, to: draft.to, stroke: stroke(draft.style), startEnd: draft.style.startEnd, endEnd: draft.style.endEnd };
        case "redact":
          return { id: "draft", type: "redact", rects: [rect], fill: draft.style.fill };
        case "link":
          return { id: "draft", type: "link", rect };
        case "placing":
          return placing ? placedAnnotation(placing, rect, "draft") : null;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** The annotation a placement puts on a page, in `rect`. */
export function placedAnnotation(placing: Placing, rect: Rect, id: string): Annotation {
  switch (placing.kind) {
    case "stamp":
      return { id, type: "stamp", rect, stamp: placing.stamp };
    case "image":
      return { id, type: "image", rect, picture: placing.picture };
    case "signature": {
      const v = placing.value;
      if (v.mode === "draw") return { id, type: "signature", rect, mode: "draw", strokes: scaleStrokes(v, rect.w, rect.h), color: v.color, width: v.lineWidth };
      if (v.mode === "type") return { id, type: "signature", rect, mode: "type", text: v.text, font: v.font, color: v.color };
      return { id, type: "signature", rect, mode: "image", picture: v.picture };
    }
  }
}

// ---- selection --------------------------------------------------------------------------------------------------

/** The screen size of a handle and of the area that grabs it, in CSS pixels: the grab area is a finger wide. */
export const HANDLE_PX = 9;
export const GRAB_PX = 22;
/** The grab area for a finger: 44 CSS pixels. */
export const GRAB_TOUCH_PX = 44;

/** The handle of a box under a point (page space), given the scale, or null. */
export function handleAt(box: Rect, x: number, y: number, scale: number, grab = GRAB_PX): Handle | null {
  const reach = grab / scale / 2;
  let best: Handle | null = null;
  let bestD = Infinity;
  for (const h of HANDLES) {
    const [hx, hy] = handlePoint(box, h);
    const d = Math.max(Math.abs(hx - x), Math.abs(hy - y));
    if (d <= reach && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** The vertex of a line or polygon under a point, or -1. */
export function vertexAt(points: readonly Pt[], x: number, y: number, scale: number, grab = GRAB_PX): number {
  const reach = grab / scale / 2;
  let best = -1;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= reach && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

function Selection({ annots, scale }: { annots: readonly Annotation[]; scale: number }) {
  if (annots.length === 0) return null;
  const u = 1 / scale;
  const h = HANDLE_PX * u;
  const single = annots.length === 1 ? annots[0]! : null;
  const verts = single ? vertices(single) : null;
  return (
    <g className="pli-pdf-selection" data-count={annots.length}>
      {annots.map((a) => {
        const b = selectionBox(a);
        return <rect key={a.id} className="pli-pdf-selbox" x={b.x - u * 2} y={b.y - u * 2} width={b.w + u * 4} height={b.h + u * 4} fill="none" strokeWidth={1.5 * u} strokeDasharray={a.locked ? `${3 * u} ${3 * u}` : undefined} data-locked={a.locked ? "" : undefined} />;
      })}
      {single && verts
        ? verts.map((p, i) => <circle key={i} className="pli-pdf-handle" data-vertex={i} cx={p[0]} cy={p[1]} r={h * 0.6} strokeWidth={1.5 * u} />)
        : single &&
          canResize(single) &&
          HANDLES.map((handle) => {
            const [x, y] = handlePoint(selectionBox(single), handle);
            return <rect key={handle} className="pli-pdf-handle" data-handle={handle} x={x - h / 2} y={y - h / 2} width={h} height={h} rx={1.5 * u} strokeWidth={1.5 * u} />;
          })}
    </g>
  );
}

// ---- the layers -------------------------------------------------------------------------------------------------

function useController(controller: AnnotController): number {
  return useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
}

/** The annotations of a page, with the selection, the drafts being drawn and other people's selections. */
export function AnnotationLayer({ ctx, controller }: { ctx: PageContext; controller: AnnotController }): ReactNode {
  useSessionRevision(controller.session);
  useController(controller);
  const page = controller.pageById(ctx.page.id) ?? ctx.page;
  const stacks = useStacks(controller.options.fonts, textFamilies(page.annots));
  const selected = new Set(controller.session.selection.annots);
  const editingId = controller.editing?.page === page.id ? controller.editing.annot.id : null;
  const draft = controller.draft && controller.draft.page === page.id ? controller.draft : null;
  const ghost = draft ? draftAnnotation(draft, controller.placing) : null;
  const drawn = page.annots.filter((a) => a.type !== "highlight" && !controller.erased.has(a.id));
  const openNote = useMemo(() => (id: string) => controller.openComment(id), [controller]);
  const onNote = controller.toolId === null ? openNote : undefined;
  const shown = (a: Annotation) => controller.preview.get(a.id) ?? a;
  const selectedList = page.annots.filter((a) => selected.has(a.id) && !controller.erased.has(a.id)).map(shown);
  const dragging = controller.preview.size > 0;
  return (
    <g className="pli-pdf-annots" data-page={page.id} data-dragging={dragging ? "" : undefined}>
      {drawn.map((a) => (
        <AnnotShape key={a.id} annot={shown(a)} stacks={stacks} hideText={a.id === editingId} showLinks={controller.showLinks || controller.toolId === "link" || selected.has(a.id)} onNote={onNote} />
      ))}
      {ghost && <AnnotShape annot={ghost} stacks={stacks} ghost showLinks />}
      {draft?.type === "poly" && (
        <g className="pli-pdf-draft-points">
          {draft.points.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={3 / ctx.scale} className="pli-pdf-handle" strokeWidth={1.2 / ctx.scale} />
          ))}
        </g>
      )}
      {draft?.type === "note" && <AnnotShape annot={{ id: "draft", type: "note", x: draft.x, y: draft.y, color: draft.style.color, icon: draft.style.icon ?? "comment" }} stacks={stacks} ghost />}
      {draft?.type === "marquee" && <rect className="pli-pdf-marquee" x={draft.rect.x} y={draft.rect.y} width={draft.rect.w} height={draft.rect.h} strokeWidth={1 / ctx.scale} />}
      {draft?.type === "box" && draft.kind === "text" && (
        <rect className="pli-pdf-marquee" {...rectAttrs(rectFromPoints(draft.from, draft.to))} strokeWidth={1 / ctx.scale} />
      )}
      {!ctx.readOnly && <Selection annots={selectedList} scale={ctx.scale} />}
      <Presence page={page.id} controller={controller} scale={ctx.scale} />
    </g>
  );
}

const rectAttrs = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

/** The arrow of a pointer, 0 to 17 tall, its tip at the origin. */
const CURSOR_ARROW = "M0 0 L0 14.500 L3.800 11 L6.600 17 L9 15.900 L6.200 9.900 L11.200 9.700 Z";

/** One person's pointer: an arrow in their colour, and their name beside it. Drawn at a fixed size on the screen at any zoom. */
export function PointerCursor({ user, x, y, scale }: { user: { id: string; name: string; color?: string }; x: number; y: number; scale: number }) {
  const u = 1 / scale;
  const color = user.color ?? "#d9480f";
  const label = user.name.length > 24 ? `${user.name.slice(0, 23)}…` : user.name;
  const w = (label.length * 6.2 + 10) * u;
  return (
    <g className="pli-pdf-cursor" data-cursor={user.id} transform={`translate(${x} ${y}) scale(${u})`}>
      <path d={CURSOR_ARROW} fill={color} stroke="#ffffff" strokeWidth={1.2} strokeLinejoin="round" />
      <rect x={10} y={14} width={w / u} height={16} rx={4} fill={color} />
      <text x={15} y={25.500} fill="#ffffff" style={{ fontSize: 10.500, fontWeight: 600 }}>
        {label}
      </text>
    </g>
  );
}

/** Other people's selections (an outline in their colour with their name) and pointers. Set by the host from the room's presence. */
function Presence({ page, controller, scale }: { page: string; controller: AnnotController; scale: number }) {
  if (controller.presence.length === 0) return null;
  const u = 1 / scale;
  const pageData = controller.pageById(page);
  return (
    <g className="pli-pdf-presence">
      {controller.presence.flatMap((p) =>
        (p.annots ?? []).flatMap((id) => {
          const a = pageData?.annots.find((x) => x.id === id);
          if (!a) return [];
          const b = selectionBox(a);
          const color = p.user.color ?? "#d9480f";
          return [
            <g key={`${p.user.id}:${id}`} data-presence={p.user.id}>
              <rect x={b.x - 3 * u} y={b.y - 3 * u} width={b.w + 6 * u} height={b.h + 6 * u} fill="none" stroke={color} strokeWidth={1.5 * u} strokeDasharray={`${4 * u} ${2 * u}`} />
              <text x={b.x - 3 * u} y={b.y - 6 * u} fill={color} style={{ fontSize: 10 * u, fontWeight: 600 }}>
                {p.user.name}
              </text>
            </g>,
          ];
        }),
      )}
      {controller.presence.map((p) => (p.cursor && p.cursor.page === page ? <PointerCursor key={`cursor:${p.user.id}`} user={p.user} x={p.cursor.x} y={p.cursor.y} scale={scale} /> : null))}
    </g>
  );
}

/** The highlights of a page, in a layer that multiplies with the paper (see `PageView`'s `overlayBlend`). */
export function BlendLayer({ ctx, controller }: { ctx: PageContext; controller: AnnotController }): ReactNode {
  useSessionRevision(controller.session);
  const page = controller.pageById(ctx.page.id) ?? ctx.page;
  const list = page.annots.filter((a) => a.type === "highlight" && !a.hidden && !controller.erased.has(a.id));
  if (list.length === 0) return null;
  return (
    <g className="pli-pdf-blend">
      {list.map((a) => (
        <g key={a.id} className="pli-pdf-annot" data-annot={a.id} data-type="highlight" opacity={a.opacity !== undefined && a.opacity < 1 ? a.opacity : undefined}>
          <Body annot={a} stacks={(f) => f} />
        </g>
      ))}
    </g>
  );
}
