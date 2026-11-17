import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DeckSession, createDeck, type Deck, type DeckSelection, type DeckSessionOptions } from "@pli.dev/decks";

const revisions = new WeakMap<DeckSession, number>();
const listeners = new WeakMap<DeckSession, Set<() => void>>();

function bump(session: DeckSession) {
  revisions.set(session, (revisions.get(session) ?? 0) + 1);
  listeners.get(session)?.forEach((l) => l());
}

/** Sets what is selected (the shown slide, selected slides and elements) and tells the editor to redraw. */
export function setSelection(session: DeckSession, selection: DeckSelection): void {
  session.selection = selection;
  bump(session);
}

/** Re-renders when the deck or the selection changes and returns a number that changes each time. */
export function useDeckRevision(session: DeckSession): number {
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

/** Creates a session once and keeps it for the life of the component. */
export function useDeckSession(initial?: Deck | (() => Deck), options?: DeckSessionOptions): DeckSession {
  const [session] = useState(() => new DeckSession(typeof initial === "function" ? initial() : (initial ?? createDeck()), options));
  return session;
}

/** Runs `fn` when the session changes, without re-rendering. */
export function useSessionEffect(session: DeckSession, fn: () => void): void {
  useEffect(() => session.subscribe(fn), [session, fn]);
}
