import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PliUser } from "@pli.dev/core";
import type { DeckSession, Slide } from "@pli.dev/decks";
import type { MenuEntry } from "@pli.dev/react";
import { SlideView } from "./SlideView";
import { useDeckRevision } from "./hooks";
import { DeckIcons as I } from "./icons";

export const FILMSTRIP_THUMB_WIDTH = 124;
const PAD = 8;

export interface FilmstripProps {
  session: DeckSession;
  /** The slide shown and the slides selected (the shown one is among them). */
  current: string | null;
  selected: readonly string[];
  onSelect: (current: string, selected: string[]) => void;
  readOnly?: boolean;
  /** Items of the context menu for the selected slides. */
  menuFor?: (ids: string[]) => MenuEntry[];
  onContextMenu?: (at: { x: number; y: number }, ids: string[]) => void;
  onNewSlide?: () => void;
  onDelete?: (ids: string[]) => void;
  onDuplicate?: (ids: string[]) => void;
  onCopy?: (ids: string[], cut: boolean) => void;
  onPaste?: () => void;
  /** Open comments on each slide (by slide id), for the badge on its thumbnail. */
  comments?: ReadonlyMap<string, number>;
  /** The other people on each slide (by slide id), for the coloured dots by its thumbnail. */
  people?: ReadonlyMap<string, readonly PliUser[]>;
  /** The badge was clicked. */
  onComments?: (slide: string) => void;
  className?: string;
}

interface Drag {
  ids: string[];
  startY: number;
  active: boolean;
  /** Gap index (before the slide at this index) the slides would land in. */
  to: number;
}

const Thumb = memo(function Thumb({ session, slide, index, width, rev }: { session: DeckSession; slide: Slide; index: number; width: number; rev: unknown }) {
  const scene = useMemo(() => session.scene(slide.id), [session, slide, rev, index]);
  return <SlideView scene={scene} scale={width / scene.width} label={`Slide ${index + 1}`} />;
});

/** The slides down the left side: thumbnails with numbers; click, shift-click, drag to reorder, keys to move and delete. */
export function Filmstrip({ session, current, selected, onSelect, readOnly, onContextMenu, onNewSlide, onDelete, onDuplicate, onCopy, onPaste, comments, people, onComments, className }: FilmstripProps) {
  useDeckRevision(session);
  const deck = session.deck;
  const slides = deck.slides;
  const width = FILMSTRIP_THUMB_WIDTH;
  const thumbH = (deck.size.height * width) / deck.size.width;
  const itemH = thumbH + PAD * 2;
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const anchor = useRef<string | null>(null);
  const latest = useRef({ slides, itemH, readOnly });
  latest.current = { slides, itemH, readOnly };
  // Thumbnails are redrawn when anything a slide depends on changes, not only when the slide object does.
  const dep = deck.masters;
  const sizeDep = deck.size;
  const rev = useMemo(() => ({ dep, sizeDep, n: slides.length }), [dep, sizeDep, slides.length]);

  const pick = (id: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const ids = slides.map((s) => s.id);
    if (e.shiftKey && (anchor.current ?? current)) {
      const a = ids.indexOf((anchor.current ?? current)!);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      onSelect(id, ids.slice(lo, hi + 1));
      return;
    }
    anchor.current = id;
    if (e.metaKey || e.ctrlKey) {
      const has = selected.includes(id);
      const next = has ? selected.filter((s) => s !== id) : [...selected, id];
      if (next.length === 0) return;
      onSelect(has ? (next.includes(current ?? "") ? current! : next[next.length - 1]!) : id, next);
      return;
    }
    onSelect(id, [id]);
  };

  const gapFor = (clientY: number) => {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    const y = clientY - top + (listRef.current?.scrollTop ?? 0);
    return Math.max(0, Math.min(latest.current.slides.length, Math.round(y / latest.current.itemH)));
  };

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    pick(id, e);
    if (readOnly || e.shiftKey || e.metaKey || e.ctrlKey) return;
    const ids = selected.includes(id) && selected.length > 1 ? [...selected] : [id];
    drag.current = { ids, startY: e.clientY, active: false, to: 0 };
  };

  useEffect(() => {
    const move = (e: PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.abs(e.clientY - d.startY) < 5) return;
      d.active = true;
      d.to = gapFor(e.clientY);
      setDropAt(d.to);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      setDropAt(null);
      if (!d?.active) return;
      const list = latest.current.slides;
      // the gap counted among the slides that stay
      const to = list.slice(0, d.to).filter((s) => !d.ids.includes(s.id)).length;
      const order = list.filter((s) => d.ids.includes(s.id)).map((s) => s.id);
      session.moveSlides(order, to);
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
  }, [session]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const ids = slides.map((s) => s.id);
    const at = current ? ids.indexOf(current) : -1;
    const mod = e.metaKey || e.ctrlKey;
    const go = (to: number) => {
      const next = ids[Math.max(0, Math.min(ids.length - 1, to))];
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        const a = ids.indexOf(anchor.current ?? current ?? next);
        const b = ids.indexOf(next);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        onSelect(next, ids.slice(lo, hi + 1));
      } else {
        anchor.current = next;
        onSelect(next, [next]);
      }
    };
    if (e.key === "ArrowDown" || e.key === "ArrowRight") return go(at + 1);
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") return go(at - 1);
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(ids.length - 1);
    if (readOnly) return;
    if (e.key === "Enter" && !mod) {
      e.preventDefault();
      e.stopPropagation();
      onNewSlide?.();
    } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
      e.preventDefault();
      e.stopPropagation();
      onDelete?.(selected.length ? [...selected] : current ? [current] : []);
    } else if (mod && e.key.toLowerCase() === "d" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onDuplicate?.(selected.length ? [...selected] : current ? [current] : []);
    } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      onCopy?.(selected.length ? [...selected] : current ? [current] : [], e.key.toLowerCase() === "x");
    } else if (mod && e.key.toLowerCase() === "v" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onPaste?.();
    }
  };

  return (
    <div
      ref={listRef}
      className={className ? `pli-deck-filmstrip ${className}` : "pli-deck-filmstrip"}
      role="listbox"
      aria-label="Slides"
      aria-multiselectable="true"
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {slides.map((slide, i) => {
        const isCurrent = slide.id === current;
        const isSelected = selected.includes(slide.id);
        return (
          <div
            key={slide.id}
            role="option"
            aria-selected={isSelected}
            aria-current={isCurrent ? "true" : undefined}
            aria-label={`Slide ${i + 1}${slide.skipped ? " (skipped)" : ""}`}
            className="pli-deck-film-item"
            data-slide-id={slide.id}
            data-current={isCurrent ? "" : undefined}
            data-selected={isSelected ? "" : undefined}
            data-skipped={slide.skipped ? "" : undefined}
            style={{ height: itemH }}
            onPointerDown={(e) => onPointerDown(e, slide.id)}
            onContextMenu={(e) => {
              if (readOnly || !onContextMenu) return;
              e.preventDefault();
              const ids = isSelected ? [...selected] : [slide.id];
              if (!isSelected) onSelect(slide.id, [slide.id]);
              onContextMenu({ x: e.clientX, y: e.clientY }, ids);
            }}
          >
            <span className="pli-deck-film-number" aria-hidden="true">{i + 1}</span>
            <div className="pli-deck-film-thumb" style={{ width, height: thumbH }}>
              <Thumb session={session} slide={slide} index={i} width={width} rev={rev} />
              {slide.skipped && <span className="pli-deck-film-skip" title="Skipped when presenting" aria-hidden="true">⊘</span>}
              {!!comments?.get(slide.id) && (
                <button
                  type="button"
                  className="pli-deck-film-comments"
                  aria-label={`${comments.get(slide.id)} open comment${comments.get(slide.id) === 1 ? "" : "s"} on slide ${i + 1}`}
                  title={`${comments.get(slide.id)} open comment${comments.get(slide.id) === 1 ? "" : "s"}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onComments?.(slide.id);
                  }}
                >
                  {comments.get(slide.id)}
                </button>
              )}
              {!!people?.get(slide.id)?.length && (
                <span className="pli-deck-film-people" role="group" aria-label={`${people.get(slide.id)!.map((u) => u.name).join(", ")} on slide ${i + 1}`}>
                  {people.get(slide.id)!.slice(0, 4).map((u) => (
                    <span key={u.id} className="pli-deck-film-dot" title={u.name} style={{ background: u.color }} />
                  ))}
                </span>
              )}
              {!!slide.animations?.length && <span className="pli-deck-film-anim" role="img" aria-label={`${slide.animations.length} animation${slide.animations.length === 1 ? "" : "s"}`} title={`${slide.animations.length} animation${slide.animations.length === 1 ? "" : "s"}`}>{I.motion}</span>}
            </div>
          </div>
        );
      })}
      {dropAt !== null && <div className="pli-deck-film-drop" data-drop-index={dropAt} style={{ top: dropAt * itemH - 1 }} aria-hidden="true" />}
    </div>
  );
}
