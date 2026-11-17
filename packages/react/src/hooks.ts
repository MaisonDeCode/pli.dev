import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DocumentSession, selectionState, type Doc, type DocumentSessionOptions, type SelectionState } from "@pli.dev/docs";

/**
 * Re-renders when the session's document, selection or pending formatting changes, and returns
 * a number that changes each time.
 */
export function useSessionRevision(session: DocumentSession): number {
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const stopDoc = session.subscribe(onChange);
      const stopSelection = session.onSelectionChange(onChange);
      return () => {
        stopDoc();
        stopSelection();
      };
    },
    [session],
  );
  const read = () => session.revision;
  return useSyncExternalStore(subscribe, read, read);
}

/** The state a toolbar needs: which marks are active, the block type, alignment, and so on. */
export function useSelectionState(session: DocumentSession): SelectionState {
  const revision = useSessionRevision(session);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` stands in for the session's contents
  return useMemo(() => selectionState(session.state, session.selection, session.pendingMarks), [session, revision]);
}

/**
 * Creates a session once and keeps it for the life of the component. Pass `{ storage }` to send uploaded
 * files to your own storage instead of embedding them in the document.
 */
export function useDocumentSession(initial?: Doc | (() => Doc), options?: DocumentSessionOptions): DocumentSession {
  const [session] = useState(() => new DocumentSession(typeof initial === "function" ? initial() : initial, options));
  return session;
}

/** Whether a media query matches, such as `(max-width: 40rem)` for a phone. False where the browser can't say (a server, a test). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}

/** True on a phone-sized screen, where the toolbar puts the layout controls in its menu. */
export const PHONE_QUERY = "(max-width: 40rem)";

/**
 * Where the visible part of the page is while a touch keyboard covers the bottom of it, or null when no keyboard is up. On
 * iPhone the keyboard doesn't shrink the page, it slides over it, so what must stay in view (the toolbar, above all) has to be
 * fitted to the part that is left. On Android the page itself shrinks, and there is nothing to do.
 */
export function useKeyboardFrame(enabled: boolean): { top: number; height: number } | null {
  const [frame, setFrame] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !viewport) {
      setFrame(null);
      return;
    }
    const update = () => {
      // A keyboard takes well over a hundred pixels. Pinching to zoom changes the viewport too, and is not a keyboard.
      const open = viewport.scale <= 1.01 && window.innerHeight - viewport.height > 120;
      const next = open ? { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) } : null;
      setFrame((old) => (old?.top === next?.top && old?.height === next?.height ? old : next));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return frame;
}
