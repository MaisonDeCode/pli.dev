import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "@pli.dev/react";
import type { Rect } from "@pli.dev/pdf";
import type { AnnotController } from "./annotController";
import { normRotation, rectToScreen, type PageFrame } from "./geometry";
import { unionRects } from "./annotGeometry";
import type { PdfViewContext } from "./extensions";

/** Re-renders when the controller changes (a tool, a draft, a popover, the live message). */
export function useController(c: AnnotController): number {
  return useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
}

/** How a page is shown right now: its size, the turn of the page and the view, and the scale. Null when it is not known. */
export function pageFrame(c: AnnotController, pageId: string): PageFrame | null {
  const page = c.pageById(pageId);
  const view = c.view;
  if (!page || !view) return null;
  return { width: page.width, height: page.height, rotation: normRotation(page.rotate + view.viewRotation), scale: view.scale };
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameScreenRect = (a: ScreenRect | null, b: ScreenRect | null) => a === b || (!!a && !!b && Math.abs(a.left - b.left) < 0.01 && Math.abs(a.top - b.top) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01);

/**
 * A rectangle of page space on the screen (fixed coordinates), kept in step with the page.
 *
 * It is measured AFTER each commit (a layout effect), when the page element has the size and place this render gave it, and
 * again when the pages scroll or the scroller, the page or the window is resized. It is never measured while rendering: the
 * page element still has the layout of the render before (the old zoom, the old width of the panels), and the new scale
 * applied to the old place leaves the anchor where the page used to be.
 */
export function useAnchor(c: AnnotController, pageId: string | null, rect: Rect | null): ScreenRect | null {
  const [anchor, setAnchor] = useState<ScreenRect | null>(null);
  const want = useRef({ pageId, rect });
  want.current = { pageId, rect };
  const measure = useCallback(() => {
    const { pageId: id, rect: r } = want.current;
    let next: ScreenRect | null = null;
    if (id && r) {
      const frame = pageFrame(c, id);
      const el = c.view?.pageElement(id);
      if (frame && el) {
        const box = el.getBoundingClientRect();
        const s = rectToScreen(frame, r);
        next = { left: box.left + s.x, top: box.top + s.y, width: s.w, height: s.h };
      }
    }
    setAnchor((old) => (sameScreenRect(old, next) ? old : next));
  }, [c]);
  // After every commit: the zoom, the layout and the rectangle itself are those of this render.
  useLayoutEffect(measure);
  const view = c.view;
  useEffect(() => {
    const scroller = view?.scroller();
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (scroller) watcher?.observe(scroller);
    const pageEl = pageId ? view?.pageElement(pageId) : null;
    if (pageEl) watcher?.observe(pageEl);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      watcher?.disconnect();
    };
  }, [measure, view, pageId]);
  return pageId && rect ? anchor : null;
}

/** Where floating panels are mounted: inside the viewer, so its colours and fonts apply. */
export function usePortalRoot(c: AnnotController): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setRoot(c.view?.scroller()?.closest<HTMLElement>(".pli-pdf") ?? null);
  }, [c, c.view]);
  return root;
}

export function Portal({ c, children }: { c: AnnotController; children: ReactNode }) {
  const root = usePortalRoot(c);
  return root ? createPortal(children, root) : null;
}

const FOCUSABLE = "textarea, input:not([type=hidden]), select, button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";

/**
 * A small floating panel next to something on a page. It takes focus when it opens and gives it back when it closes, closes
 * on Escape or a click outside, and stays inside the window.
 */
export function Popover({ anchor, label, onClose, children, className = "", role = "dialog", above = false }: { anchor: ScreenRect | null; label: string; onClose: () => void; children: ReactNode; className?: string; role?: "dialog" | "toolbar"; above?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useDismiss(true, onClose, ref);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    const a = anchor ?? { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
    const left = Math.max(margin, Math.min(a.left, window.innerWidth - box.width - margin));
    const below = a.top + a.height + 6;
    const over = a.top - 6 - box.height;
    const top = (above || below + box.height > window.innerHeight - margin) && over > margin ? over : Math.max(margin, Math.min(below, window.innerHeight - box.height - margin));
    setPlace((old) => (old && old.left === left && old.top === top ? old : { left, top }));
  });

  useEffect(() => {
    if (role !== "dialog") return;
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    return () => {
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [role]);

  return (
    <div
      ref={ref}
      className={`pli-pdf-popover pli-popover ${className}`}
      role={role}
      aria-label={label}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Keeps the bar over selected text in step with the browser's selection (only while no tool is active: tools take the pointer). */
export function useTextSelectionBar(c: AnnotController, view: PdfViewContext): void {
  useEffect(() => {
    const scroller = view.scroller();
    if (!scroller) return;
    const update = () => {
      if (c.toolId !== null || c.readOnly) return;
      const selected = c.readSelection();
      if (selected.length === 0) {
        if (c.textSelection) {
          c.textSelection = null;
          c.emit();
        }
        return;
      }
      const first = selected[0]!;
      const frame = pageFrame(c, first.page);
      const el = view.pageElement(first.page);
      if (!frame || !el) return;
      const box = el.getBoundingClientRect();
      const r = rectToScreen(frame, unionRects(first.rects));
      c.textSelection = { selected, at: { x: box.left + r.x, y: box.top + r.y, w: r.w, h: r.h } };
      c.emit();
    };
    const later = () => void setTimeout(update, 0);
    const change = () => {
      const s = window.getSelection?.();
      if ((!s || s.isCollapsed) && c.textSelection) {
        c.textSelection = null;
        c.emit();
      }
    };
    scroller.addEventListener("pointerup", later);
    scroller.addEventListener("keyup", later);
    document.addEventListener("selectionchange", change);
    return () => {
      scroller.removeEventListener("pointerup", later);
      scroller.removeEventListener("keyup", later);
      document.removeEventListener("selectionchange", change);
    };
  }, [c, view]);
}

