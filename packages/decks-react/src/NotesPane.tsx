import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { DeckSession } from "@pli.dev/decks";
import { useDeckRevision } from "./hooks";

export interface NotesPaneProps {
  session: DeckSession;
  slideId: string | null;
  readOnly?: boolean;
  /** Height of the text area in pixels. */
  height: number;
  onResize: (height: number) => void;
  className?: string;
}

export const NOTES_MIN = 40;
export const NOTES_MAX = 480;

/** Speaker notes under the slide, with a divider to drag. Typing is one undo step until you stop or leave. */
export function NotesPane({ session, slideId, readOnly, height, onResize, className }: NotesPaneProps) {
  useDeckRevision(session);
  const slide = slideId ? session.deck.slides.find((s) => s.id === slideId) : undefined;
  const stored = slide?.notes ?? "";
  const [value, setValue] = useState(stored);
  const burst = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef<{ y: number; h: number } | null>(null);

  // Show the slide's notes again when the slide changes or the text changed elsewhere (undo, find and replace).
  useEffect(() => {
    setValue(stored);
  }, [stored, slideId]);
  useEffect(() => {
    burst.current = false;
  }, [slideId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (text: string) => {
    setValue(text);
    if (!slideId || readOnly) return;
    session.setNotes(slideId, text, { merge: burst.current });
    burst.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      burst.current = false;
    }, 2000);
  };

  const onDown = (e: ReactPointerEvent) => {
    dragging.current = { y: e.clientY, h: height };
    const move = (ev: PointerEvent | MouseEvent) => {
      const d = dragging.current;
      if (d) onResize(Math.max(NOTES_MIN, Math.min(NOTES_MAX, d.h - (ev.clientY - d.y))));
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener("pointermove", move as EventListener);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move as EventListener);
    window.addEventListener("pointerup", up);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowUp") onResize(Math.min(NOTES_MAX, height + 16));
    else if (e.key === "ArrowDown") onResize(Math.max(NOTES_MIN, height - 16));
    else return;
    e.preventDefault();
  };

  return (
    <section className={className ? `pli-deck-notes ${className}` : "pli-deck-notes"} aria-label="Speaker notes">
      <div
        className="pli-deck-notes-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize speaker notes"
        aria-valuenow={height}
        aria-valuemin={NOTES_MIN}
        aria-valuemax={NOTES_MAX}
        tabIndex={0}
        onPointerDown={onDown}
        onKeyDown={onKey}
      />
      <textarea
        className="pli-deck-notes-text"
        aria-label="Speaker notes"
        placeholder="Click to add speaker notes"
        value={value}
        readOnly={readOnly}
        disabled={!slideId}
        style={{ height }}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          burst.current = false;
        }}
      />
    </section>
  );
}
