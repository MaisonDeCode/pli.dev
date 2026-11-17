import { useEffect, useMemo, useRef, useState } from "react";
import { createFonts } from "@pli.dev/core";
import { DeckSession } from "@pli.dev/decks";
import { PliDeck, setSelection } from "@pli.dev/decks-react";
import type { LiveBodyProps } from "./types";
import { DeckDirector } from "./decks/director";
import { clampStep, slideShownAt, snapshotOf } from "./decks/script";

/** Below this height the toolbar is left out so that the slide keeps a useful size. */
const TOOLBAR_MIN_HEIGHT = 520;

const showSlide = (session: DeckSession, id: string) => setSelection(session, { slide: id, slides: [id], elements: [] });

/**
 * The Pli.Decks editor for the site: the real `PliDeck` on a deck that builds itself as the story advances (see
 * `decks/script.ts` for the three steps and `decks/director.ts` for how they are played). Nothing is fetched: the fonts are
 * the system's own, which is all the built-in themes use.
 */
export default function DecksLive({ step, interactive, reducedMotion, onReady }: LiveBodyProps) {
  const fonts = useMemo(() => createFonts({ source: null, noGoogle: true, storage: null }), []);
  const initial = useRef(clampStep(step));
  const [session] = useState(() => {
    const deck = snapshotOf(initial.current);
    const s = new DeckSession(deck);
    s.selection = { slide: slideShownAt(deck, initial.current), slides: [slideShownAt(deck, initial.current)], elements: [] };
    return s;
  });

  // ---- the director ----
  const director = useRef<DeckDirector | null>(null);
  useEffect(() => {
    const d = new DeckDirector(session, { show: showSlide }, initial.current);
    director.current = d;
    return () => {
      d.dispose();
      if (director.current === d) director.current = null;
    };
  }, [session]);
  useEffect(() => {
    const d = director.current;
    if (!d) return;
    if (interactive) d.release();
    else d.goTo(step, !reducedMotion);
  }, [session, step, interactive, reducedMotion]);

  // ---- ready after the first frame (or soon after, where frames are not drawn, such as a hidden tab) ----
  useEffect(() => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        onReady();
      }
    };
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(go) : undefined;
    const timer = setTimeout(go, 400);
    return () => {
      done = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [onReady]);

  // ---- compact chrome: the toolbar only when there is room for it ----
  const box = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setToolbar(el.clientHeight === 0 || el.clientHeight >= TOOLBAR_MIN_HEIGHT);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="pli-live-decks" style={{ height: "100%", width: "100%", minWidth: 0, overflow: "hidden" }}>
      <PliDeck session={session} fonts={fonts} toolbar={toolbar} notes={false} readOnly={false} />
    </div>
  );
}
