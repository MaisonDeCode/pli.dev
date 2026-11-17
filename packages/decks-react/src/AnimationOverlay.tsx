import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Animation, Scene } from "@pli.dev/decks";
import { animationsFor, describeAnimation, elementLabel } from "./motion";

type Point = { x: number; y: number };

export interface AnimationOverlayProps {
  scene: Scene;
  /** The animations of the slide, in order (their position is the number on the badge). */
  animations: readonly Animation[];
  /** Pixels per point. */
  scale: number;
  /** The elements selected on the slide: their badges show even when the Motion panel is closed. */
  selected: readonly string[];
  /** The Motion panel is open: every badge shows. */
  panelOpen: boolean;
  /** The animation selected in the panel. */
  active: string | null;
  readOnly?: boolean;
  /** A badge was clicked. */
  onPick: (id: string) => void;
  /** A point of the active motion path was moved (a drag ends, or an arrow key). */
  onPath?: (id: string, path: Point[]) => void;
}

const snapTo = (n: number) => Math.round(n * 2) / 2;

/**
 * What the editor draws over the slide for animations: a numbered badge by each animated element (like PowerPoint's tags),
 * and, for the selected motion path, its line with points to drag. Drawn only in the editor's canvas: never in thumbnails,
 * presenting or PDF.
 */
export function AnimationOverlay({ scene, animations, scale, selected, panelOpen, active, readOnly, onPick, onPath }: AnimationOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; index: number; path: Point[] } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const latest = useRef({ scale, onPath });
  latest.current = { scale, onPath };

  useEffect(() => {
    if (!drag) return;
    const to = (e: PointerEvent | MouseEvent) => {
      const box = ref.current?.getBoundingClientRect();
      return { x: (e.clientX - (box?.left ?? 0)) / latest.current.scale, y: (e.clientY - (box?.top ?? 0)) / latest.current.scale };
    };
    const move = (e: PointerEvent | MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const el = scene.elements.find((x) => animations.find((a) => a.id === d.id)?.target === x.id);
      if (!el) return;
      const pt = to(e);
      const next = d.path.map((p, i) => (i === d.index ? { x: snapTo(pt.x - (el.x + el.w / 2)), y: snapTo(pt.y - (el.y + el.h / 2)) } : p));
      setDrag({ ...d, path: next });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (d) latest.current.onPath?.(d.id, d.path);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.index]);

  if (animations.length === 0) return null;
  const px = (n: number) => n * scale;
  const els = new Map(scene.elements.filter((e) => e.from === "slide" && !e.hidden).map((e) => [e.id, e]));

  const badges: React.ReactNode[] = [];
  for (const el of els.values()) {
    const mine = animationsFor(animations, el.id);
    if (!mine.length || !(panelOpen || selected.includes(el.id))) continue;
    mine.forEach((a, k) => {
      const n = animations.indexOf(a) + 1;
      const left = Math.max(2, px(el.x) - 22 + k * 22);
      const top = Math.max(2, px(el.y) - 2);
      badges.push(
        <button
          key={a.id}
          type="button"
          className="pli-deck-anim-badge"
          data-animation-badge={a.id}
          data-element={el.id}
          data-class={a.class}
          data-active={a.id === active ? "" : undefined}
          aria-pressed={a.id === active}
          aria-label={`Animation ${n}: ${describeAnimation(a)} on ${elementLabel(el)}`}
          title={`${describeAnimation(a)} · ${elementLabel(el)}`}
          style={{ left, top }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPick(a.id);
          }}
        >
          {n}
        </button>,
      );
    });
  }

  let path: React.ReactNode = null;
  const activeAnim = panelOpen ? animations.find((a) => a.id === active && a.kind === "motion") : undefined;
  const target = activeAnim ? els.get(activeAnim.target) : undefined;
  if (activeAnim && target) {
    const pts = (drag && drag.id === activeAnim.id ? drag.path : activeAnim.path) ?? [];
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const at = (p: Point) => ({ x: px(cx + p.x), y: px(cy + p.y) });
    const line = pts.map((p) => at(p)).map((p) => `${p.x},${p.y}`).join(" ");
    const move = (index: number, dx: number, dy: number) => {
      const next = pts.map((p, i) => (i === index ? { x: p.x + dx, y: p.y + dy } : p));
      onPath?.(activeAnim.id, next);
    };
    const key = (e: ReactKeyboardEvent, index: number) => {
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (!v || readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      move(index, v[0], v[1]);
    };
    path = (
      <>
        <svg className="pli-deck-anim-path-line" width="100%" height="100%" aria-hidden="true" focusable="false">
          <polyline points={line} />
        </svg>
        {pts.map((p, i) => {
          const a = at(p);
          return (
            <div
              key={i}
              className="pli-deck-anim-point-handle"
              role="button"
              tabIndex={i === 0 || readOnly ? -1 : 0}
              aria-label={i === 0 ? "Motion path start" : `Motion path point ${i + 1}`}
              data-path-point={i}
              data-start={i === 0 ? "" : undefined}
              style={{ left: a.x, top: a.y }}
              onPointerDown={(e: ReactPointerEvent) => {
                e.stopPropagation();
                if (i === 0 || readOnly || (e.button !== undefined && e.button !== 0)) return;
                e.preventDefault();
                setDrag({ id: activeAnim.id, index: i, path: pts.map((q) => ({ ...q })) });
              }}
              onKeyDown={(e) => i > 0 && key(e, i)}
            />
          );
        })}
      </>
    );
  }

  return (
    <div ref={ref} className="pli-deck-anim-overlay" data-animation-overlay="">
      {path}
      {badges}
    </div>
  );
}
