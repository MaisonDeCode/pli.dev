import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildTimeline, type DeckSession, type Pose, type Slide, type Transition } from "@pli.dev/decks";
import { SlideView } from "./SlideView";
import { DeckIcons as I } from "./icons";
import { framesOf, posesFor, prefersReducedMotion, useStepPlayer } from "./motion";

export interface PresentModeProps {
  session: DeckSession;
  /** Index of the slide to start on (skipped slides are only shown if you start on one). */
  start?: number;
  onExit: () => void;
  /** Called by "Open presenter view in a new window"; hosts that can open a window put their own presenter view there. */
  onOpenPresenterWindow?: () => void;
  /** Start in the presenter view (current and next slide, notes, timer). */
  presenter?: boolean;
  /**
   * Tells the editor where this show is (the slide and how many animation steps have run) each time it moves, so other people can
   * follow it (see the `room` of `PliDeck`).
   */
  onPosition?: (position: { slide: string; step: number }) => void;
  /**
   * Follow someone else's show: this one goes to the slide and step it says whenever it changes. The viewer can still leave
   * with Escape; their own keys don't move it.
   */
  following?: { slide: string; step: number } | null;
  /** Go full screen through the browser's Fullscreen API when it is there. Default true. */
  fullscreen?: boolean;
  /** Play the slides' object animations (default true). Off shows every slide as it is drawn in the editor. */
  animations?: boolean;
  /** Finish each animation step the moment it starts (no movement). By default, whatever the system's reduced motion setting says. */
  reduceMotion?: boolean;
  className?: string;
}

interface Playing {
  from: Slide;
  transition: Transition;
  /** Where the slide that is leaving had got to with its animations. */
  poses?: Map<string, Pose>;
}

/** The next slide after `i` that isn't skipped (or -1). */
export function nextShown(slides: readonly Slide[], i: number): number {
  for (let j = i + 1; j < slides.length; j++) if (!slides[j]!.skipped) return j;
  return -1;
}
export function prevShown(slides: readonly Slide[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (!slides[j]!.skipped) return j;
  return -1;
}
export function lastShown(slides: readonly Slide[]): number {
  return prevShown(slides, slides.length);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Full-screen slideshow. Keys as in Google Slides: arrows, space, Page Up/Down, Home/End, a number and Enter to jump,
 * B and W for a black or white screen, L for the laser pointer, S for the presenter view, Escape to leave.
 *
 * Object animations: going forward (click, Space, Enter, N, Right/Down arrows, Page Down) plays the next animation step
 * and, when there are none left, goes to the next slide; going back (Left/Up arrows, Page Up, P, Backspace) undoes a step
 * (instantly) before it goes to the previous slide, which opens with all its animations done. A skips the slide's remaining
 * animations. Pressing forward while a step is running finishes it.
 */
export function PresentMode({ session, start = 0, onExit, onOpenPresenterWindow, onPosition, following, presenter: presenterProp = false, fullscreen = true, animations = true, reduceMotion, className }: PresentModeProps) {
  const slides = session.deck.slides;
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(start, slides.length - 1)));
  const [ended, setEnded] = useState(false);
  const [blank, setBlank] = useState<null | "black" | "white">(null);
  const [digits, setDigits] = useState("");
  const [laser, setLaser] = useState(false);
  const [laserAt, setLaserAt] = useState<{ x: number; y: number } | null>(null);
  const [presenter, setPresenter] = useState(presenterProp);
  const [showNotes, setShowNotes] = useState(presenterProp);
  const [chrome, setChrome] = useState(true);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [size, setSize] = useState(() => ({ w: typeof window === "undefined" ? 1280 : window.innerWidth || 1280, h: typeof window === "undefined" ? 720 : window.innerHeight || 720 }));
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [noteScale, setNoteScale] = useState(1);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const digitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enteredFullscreen = useRef(false);

  const slide = slides[index];
  const scene = useMemo(() => (slide ? session.scene(slide.id) : null), [session, slide]);
  const frames = useMemo(() => (scene ? framesOf(scene) : new Map()), [scene]);

  // The slide's animations: a timeline of steps, and where the show has got to in it.
  const reducedRef = useRef(reduceMotion);
  reducedRef.current = reduceMotion;
  const reduced = () => reducedRef.current ?? prefersReducedMotion();
  const player = useStepPlayer({ instant: () => reduced() });
  const stepsOf = useCallback((sl: Slide | undefined) => (animations && sl ? buildTimeline(sl) : []), [animations]);
  const initial = useRef(false);
  if (!initial.current) {
    initial.current = true;
    player.load(stepsOf(slide), "start");
  }

  // ---- Size, fullscreen -----------------------------------------------------------------------------------------

  useEffect(() => {
    const el = rootRef.current;
    const measure = () => {
      const r = el?.getBoundingClientRect();
      const w = r && r.width > 0 ? r.width : window.innerWidth;
      const h = r && r.height > 0 ? r.height : window.innerHeight;
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(measure);
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (fullscreen && el?.requestFullscreen) {
      el.requestFullscreen().then(() => (enteredFullscreen.current = true), () => undefined);
    }
    const onChange = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) onExit();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (enteredFullscreen.current && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // ---- Moving between slides ------------------------------------------------------------------------------------

  /** Shows another slide: `at` start is how it looks before its animations, end after them (going back to it). */
  const go = useCallback(
    (to: number, forward: boolean, at: "start" | "end" = "start") => {
      const target = slides[to];
      if (!target || to === index) return;
      setBlank(null);
      setEnded(false);
      clearTimeout(playTimer.current);
      const tr = target.transition;
      const leaving = slide && player.animated && scene ? posesFor(slide, scene, player.where()) : undefined;
      player.load(stepsOf(target), at);
      if (forward && tr && tr.type !== "none" && !reduced() && slide) {
        setPlaying({ from: slide, transition: tr, poses: leaving });
        // the slide's own animations wait until its transition is over
        playTimer.current = setTimeout(() => {
          setPlaying(null);
          player.startAuto();
        }, (tr.duration ?? 700) + 30);
      } else {
        setPlaying(null);
        player.startAuto();
      }
      setIndex(to);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slides, index, slide, scene, player, stepsOf],
  );

  /** Ends a slide transition now (a click during one). */
  const finishTransition = useCallback(() => {
    clearTimeout(playTimer.current);
    setPlaying(null);
    player.startAuto();
  }, [player]);

  /** Past the slide's animations: on to the next slide (or the end). */
  const nextSlide = useCallback(() => {
    const n = nextShown(slides, index);
    if (n < 0) setEnded(true);
    else go(n, true);
  }, [slides, index, go]);

  const next = useCallback(() => {
    if (blank) {
      setBlank(null);
      return;
    }
    if (ended) {
      onExit();
      return;
    }
    if (playing) finishTransition();
    if (player.advance()) return;
    nextSlide();
  }, [blank, ended, playing, player, finishTransition, nextSlide, onExit]);

  const prev = useCallback(() => {
    if (blank) {
      setBlank(null);
      return;
    }
    if (ended) {
      setEnded(false);
      return;
    }
    if (player.back()) return;
    const p = prevShown(slides, index);
    if (p >= 0) go(p, false, "end");
  }, [blank, ended, player, slides, index, go]);

  /** Shows the slide's animations all done. */
  const skipAnimations = useCallback(() => {
    if (playing) finishTransition();
    player.skipAll();
  }, [playing, finishTransition, player]);

  // Where the show is, for people who follow it.
  useEffect(() => {
    if (slide && !following) onPosition?.({ slide: slide.id, step: player.done });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.id, player.done, following]);

  // Following someone: be where they are.
  useEffect(() => {
    if (!following) return;
    const to = slides.findIndex((s) => s.id === following.slide);
    if (to < 0) return;
    if (to !== index) {
      go(to, to > index, "start");
      return;
    }
    for (let i = 0; i < 20 && player.done < following.step; i++) if (!player.advance()) break;
    while (player.done > following.step && player.back()) {
      // undone one step at a time
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following?.slide, following?.step, index]);

  // Animations that start by themselves as the first slide shows.
  useEffect(() => {
    if (!playing) player.startAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(playTimer.current), []);

  // Slides that advance on their own (to the next slide, whatever animations are left).
  useEffect(() => {
    const after = slide?.transition?.advanceAfter;
    if (!after || ended || blank) return;
    const t = setTimeout(nextSlide, after);
    return () => clearTimeout(t);
  }, [slide, ended, blank, nextSlide]);

  // The clock for the presenter view.
  useEffect(() => {
    if (!presenter || paused !== null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [presenter, paused]);

  // ---- Keys ---------------------------------------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      // Someone who follows another show leaves it with Escape; the show is moved by the presenter.
      if (following && k !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (/^[0-9]$/.test(k)) {
        e.preventDefault();
        setDigits((d) => (d + k).slice(0, 4));
        clearTimeout(digitTimer.current);
        digitTimer.current = setTimeout(() => setDigits(""), 3000);
        return;
      }
      if (k === "Enter" && digits) {
        e.preventDefault();
        const n = Number(digits);
        setDigits("");
        if (n >= 1 && n <= slides.length) go(n - 1, n - 1 > index, "start");
        return;
      }
      if (digits && k !== "Shift") setDigits("");
      const key = k.length === 1 ? k.toLowerCase() : k;
      switch (key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case "Enter":
        case "n":
        case " ":
          e.preventDefault();
          if (key === " " && e.shiftKey) prev();
          else next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          go(Math.max(0, nextShown(slides, -1)), false, "start");
          break;
        case "End":
          e.preventDefault();
          go(Math.max(0, lastShown(slides)), true, "start");
          break;
        case "a":
          e.preventDefault();
          skipAnimations();
          break;
        case "Escape":
          e.preventDefault();
          onExit();
          break;
        case "b":
        case ".":
          e.preventDefault();
          setBlank((b) => (b === "black" ? null : "black"));
          break;
        case "w":
        case ",":
          e.preventDefault();
          setBlank((b) => (b === "white" ? null : "white"));
          break;
        case "l":
          e.preventDefault();
          setLaser((v) => !v);
          break;
        case "s":
          e.preventDefault();
          setPresenter((v) => !v);
          setShowNotes(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digits, slides, index, next, prev, go, onExit, skipAnimations, following]);

  // ---- Chrome that comes and goes ---------------------------------------------------------------------------------

  const wake = () => {
    setChrome(true);
    clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 3000);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(chromeTimer.current);
  }, []);

  // ---- Drawing ---------------------------------------------------------------------------------------------------

  const nextIdx = nextShown(slides, index);
  const nextScene = useMemo(() => (nextIdx >= 0 ? session.scene(slides[nextIdx]!.id) : null), [session, slides, nextIdx]);
  const fromScene = useMemo(() => (playing ? session.scene(playing.from.id) : null), [session, playing]);
  if (!slide || !scene) return null;

  // Where the animated elements are at this moment (the same for the audience and the presenter view).
  const where = player.where();
  const poses = player.animated ? posesFor(slide, scene, where, frames) : undefined;
  const nextPoses = nextScene && nextIdx >= 0 && animations ? posesFor(slides[nextIdx]!, nextScene, { steps: buildTimeline(slides[nextIdx]!), step: 0, t: -1 }) : undefined;

  const deckW = scene.width;
  const deckH = scene.height;
  const k = Math.min(size.w / deckW, size.h / deckH);
  const elapsed = (paused ?? now) - startedAt + offset;

  const layer = (key: string, s: typeof scene, cls: string, tr?: Transition, layerPoses?: Map<string, Pose>) => (
    <div
      key={key}
      className={`pli-deck-present-layer ${cls}`}
      data-transition={tr?.type}
      data-direction={tr?.direction ?? "right"}
      style={{ ...(tr ? ({ "--pli-deck-dur": `${tr.duration ?? 700}ms` } as CSSProperties) : null), width: deckW * k, height: deckH * k }}
    >
      <SlideView scene={s} scale={k} links poses={layerPoses} label={`Slide ${index + 1}`} />
    </div>
  );

  const stage = (
    <div
      className="pli-deck-present-stage"
      data-animation-step={player.animated ? (player.running ? player.running.step + 0.5 : player.done) : undefined}
      data-animation-steps={player.animated ? player.steps.length : undefined}
      onPointerMove={(e) => {
        wake();
        if (laser) {
          const r = e.currentTarget.getBoundingClientRect();
          setLaserAt({ x: e.clientX - r.left, y: e.clientY - r.top });
        }
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, .pli-deck-present-bar")) return;
        next();
      }}
    >
      {blank ? (
        <div className="pli-deck-present-blank" data-blank={blank} />
      ) : ended ? (
        <div className="pli-deck-present-end" role="status">End of presentation. Click to exit.</div>
      ) : (
        <>
          {playing && fromScene && layer(`out-${playing.from.id}`, fromScene, "pli-deck-present-out", playing.transition, playing.poses)}
          {layer(`in-${slide.id}`, scene, playing ? "pli-deck-present-in" : "pli-deck-present-current", playing?.transition, poses)}
        </>
      )}
      {laser && laserAt && <div className="pli-deck-laser" style={{ left: laserAt.x, top: laserAt.y }} aria-hidden="true" />}
    </div>
  );

  const bar = (
    <div className="pli-deck-present-bar" data-visible={chrome ? "" : undefined} role="toolbar" aria-label="Presentation controls">
      <button type="button" className="pli-deck-pbtn" aria-label="Previous slide" onClick={prev}>{I.prev}</button>
      <span className="pli-deck-pcount" aria-live="polite">Slide {index + 1} / {slides.length}{digits ? ` — go to ${digits}` : ""}</span>
      <button type="button" className="pli-deck-pbtn" aria-label="Next slide" onClick={next}>{I.next}</button>
      {player.animated && player.remaining && <button type="button" className="pli-deck-pbtn" aria-label="Skip animations" aria-keyshortcuts="A" title="Skip animations (A)" onClick={skipAnimations}>{I.motion}</button>}
      <button type="button" className="pli-deck-pbtn" aria-label="Speaker notes" aria-pressed={showNotes} onClick={() => setShowNotes((v) => !v)}>{I.notes}</button>
      <button type="button" className="pli-deck-pbtn" aria-label="Laser pointer" aria-pressed={laser} onClick={() => setLaser((v) => !v)}>{I.laser}</button>
      <button type="button" className="pli-deck-pbtn" aria-label="Presenter view" aria-pressed={presenter} onClick={() => { setPresenter((v) => !v); setShowNotes(true); }}>{I.present}</button>
      {onOpenPresenterWindow && <button type="button" className="pli-deck-pbtn" aria-label="Open presenter view in a new window" onClick={onOpenPresenterWindow}>{I.fullscreen}</button>}
      <button type="button" className="pli-deck-pbtn" aria-label="Exit slideshow" onClick={onExit}>{I.close}</button>
    </div>
  );

  const notes = (
    <div className="pli-deck-present-notes" role="region" aria-label="Speaker notes" style={{ fontSize: `${noteScale}em` }}>
      {slide.notes ? slide.notes.split("\n").map((l, i) => <p key={i}>{l || " "}</p>) : <p className="pli-deck-muted">No speaker notes for this slide.</p>}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={className ? `pli-deck-present ${className}` : "pli-deck-present"}
      role="dialog"
      aria-modal="true"
      aria-label="Slideshow"
      data-presenter={presenter ? "" : undefined}
      tabIndex={-1}
    >
      {presenter ? (
        <div className="pli-deck-presenter">
          <div className="pli-deck-presenter-main">
            <div className="pli-deck-presenter-current" onClick={next}>
              <SlideView scene={scene} scale={Math.max(0.1, Math.min(size.w * 0.6, ((size.h - 160) * deckW) / deckH) / deckW)} links poses={poses} label="Current slide" />
              {(blank || ended) && <div className="pli-deck-presenter-flag">{ended ? "End of presentation" : blank === "black" ? "Screen is black" : "Screen is white"}</div>}
            </div>
            <div className="pli-deck-presenter-side">
              <div className="pli-deck-presenter-clock" aria-label="Elapsed time">
                <span className="pli-deck-timer" role="timer">{mmss(elapsed)}</span>
                <button type="button" className="pli-deck-pbtn" aria-label={paused === null ? "Pause timer" : "Resume timer"} onClick={() => (paused === null ? setPaused(Date.now()) : (setOffset((o) => o - (Date.now() - paused)), setPaused(null)))}>{paused === null ? "Pause" : "Resume"}</button>
                <button type="button" className="pli-deck-pbtn" aria-label="Reset timer" onClick={() => { setOffset(-(Date.now() - startedAt)); setPaused(null); setNow(Date.now()); }}>Reset</button>
              </div>
              <div className="pli-deck-presenter-next" aria-label="Next slide">
                <div className="pli-deck-muted">Next</div>
                {nextScene ? <SlideView scene={nextScene} scale={Math.min(240, size.w * 0.25) / deckW} poses={nextPoses} label="Next slide" /> : <div className="pli-deck-muted">End of presentation</div>}
              </div>
              <div className="pli-deck-presenter-text">
                <div className="pli-deck-presenter-notes-head">
                  <span>Speaker notes</span>
                  <button type="button" className="pli-deck-pbtn" aria-label="Smaller notes text" onClick={() => setNoteScale((n) => Math.max(0.7, n - 0.15))}>A-</button>
                  <button type="button" className="pli-deck-pbtn" aria-label="Larger notes text" onClick={() => setNoteScale((n) => Math.min(2.2, n + 0.15))}>A+</button>
                </div>
                {notes}
              </div>
            </div>
          </div>
          {bar}
        </div>
      ) : (
        <>
          {stage}
          {showNotes && <div className="pli-deck-present-notes-float">{notes}</div>}
          {bar}
          <button type="button" className="pli-deck-present-more" aria-label="Show controls" onClick={() => (chrome ? setChrome(false) : wake())}>{I.more}</button>
        </>
      )}
    </div>
  );
}
