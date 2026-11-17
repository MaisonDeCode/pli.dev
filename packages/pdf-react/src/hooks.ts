import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { flushSync } from "react-dom";
import { PdfSession, type PdfSelection } from "@pli.dev/pdf";

const revisions = new WeakMap<PdfSession, number>();
const listeners = new WeakMap<PdfSession, Set<() => void>>();
function bump(session: PdfSession) {
  revisions.set(session, (revisions.get(session) ?? 0) + 1);
  listeners.get(session)?.forEach((l) => l());
}

/** Sets what is selected (the page shown, annotations, fields) and tells the editor to redraw. */
export function setSelection(session: PdfSession, selection: Partial<PdfSelection>): void {
  session.select(selection);
  bump(session);
}

/**
 * The pages selected in the thumbnails (for the page tools: rotate, delete, move): `session.selection.pages`, so undo brings
 * the selection back with the change. Ids of pages that are no longer in the document are left out. The shown page is always
 * counted among them by the tools.
 */
export function getPageSelection(session: PdfSession): string[] {
  const ids = session.selection.pages ?? [];
  if (ids.length === 0) return [];
  const live = new Set(session.doc.pages.map((p) => p.id));
  return ids.every((id) => live.has(id)) ? ids : ids.filter((id) => live.has(id));
}

export function setPageSelection(session: PdfSession, ids: readonly string[]): void {
  session.select({ pages: [...ids] });
  bump(session);
}

/** Re-renders when the document or the selection changes and returns a number that changes each time. */
export function useSessionRevision(session: PdfSession): number {
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      let set = listeners.get(session);
      if (!set) listeners.set(session, (set = new Set()));
      set.add(onChange);
      const off = session.subscribe((event) => {
        // Undo and redo bring back the selection the change was made with.
        if ((event.origin === "undo" || event.origin === "redo") && event.meta) session.selection = event.meta;
        bump(session);
      });
      return () => {
        set!.delete(onChange);
        off();
      };
    },
    [session],
  );
  const read = () => revisions.get(session) ?? 0;
  return useSyncExternalStore(subscribe, read, read);
}

/** The pages selected in the thumbnails, and a way to change them. Redraws when they change. */
export function usePageSelection(session: PdfSession): [string[], (ids: readonly string[]) => void] {
  useSessionRevision(session);
  const set = useCallback((ids: readonly string[]) => setPageSelection(session, ids), [session]);
  return [getPageSelection(session), set];
}

/** Runs `fn` when the session changes, without re-rendering. */
export function useSessionEffect(session: PdfSession, fn: () => void): void {
  useEffect(() => session.subscribe(fn), [session, fn]);
}

export interface Box {
  width: number;
  height: number;
}

/**
 * The size of an element, kept up to date. Where the browser reports no size (a test, or an element that is hidden) the
 * `fallback` is used, so the layout and which pages to draw can be worked out without a screen.
 */
export function useElementBox(ref: RefObject<HTMLElement | null>, fallback: Box): Box {
  const [box, setBox] = useState<Box>(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (sync = false) => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const next = w > 0 && h > 0 ? { width: w, height: h } : fallback;
      const apply = () => setBox((old) => (old.width === next.width && old.height === next.height ? old : next));
      // From the observer: apply it before the browser paints, so the pages are laid out for the size the window now has in the same frame
      // (a frame with the old zoom on the new window is a frame in which the page is the wrong size under the controls that follow it).
      if (sync) flushSync(apply);
      else apply();
    };
    read();
    const onResize = () => read(true);
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    watcher?.observe(el);
    window.addEventListener("resize", onResize);
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, fallback.width, fallback.height]);
  return box;
}

/**
 * The width of an element (the whole viewer), kept up to date and worked out before the first paint, so the layout that
 * depends on it (drawers on a phone, the properties panel as a sheet) is right at once. Where the browser reports no width
 * (a test, a hidden host) the `fallback` is used.
 */
export function useHostWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (sync = false) => {
      const w = el.clientWidth;
      const next = w > 0 ? Math.round(w) : fallback;
      const apply = () => setWidth((old) => (old === next ? old : next));
      // From the observer: before the browser paints (see `useElementBox`).
      if (sync) flushSync(apply);
      else apply();
    };
    read();
    const onResize = () => read(true);
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    watcher?.observe(el);
    window.addEventListener("resize", onResize);
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [ref, fallback]);
  return width;
}
