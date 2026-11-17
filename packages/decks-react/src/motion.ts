import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ANIMATION_LABELS, buildTimeline, hasDirection, poseAt, type Animation, type DeckSession, type Frame, type Pose, type ResolvedElement, type Scene, type Slide, type Step, type Where } from "@pli.dev/decks";

// ---- Small helpers -------------------------------------------------------------------------------------------------------

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for less movement. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION).matches;
}

/** Where each element of a slide is (what the poses are measured from). */
export function framesOf(scene: Scene): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  for (const e of scene.elements) if (e.from === "slide") frames.set(e.id, { x: e.x, y: e.y, w: e.w, h: e.h });
  return frames;
}

/** The poses at a moment of the slideshow (undefined when the slide has no animations, which draws it as it is). */
export function posesFor(slide: Pick<Slide, "elements" | "animations">, scene: Scene, where: Where, frames: ReadonlyMap<string, Frame> = framesOf(scene)): Map<string, Pose> | undefined {
  if (where.steps.length === 0) return undefined;
  return poseAt(slide, where, frames, { width: scene.width, height: scene.height });
}

const GEOMETRY_NAMES: Record<string, string> = {
  rect: "Rectangle",
  roundRect: "Rounded rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  rtTriangle: "Right triangle",
  diamond: "Diamond",
  line: "Line",
  straightConnector1: "Line",
  bentConnector3: "Elbow connector",
  curvedConnector3: "Curved connector",
  rightArrow: "Arrow",
  leftArrow: "Arrow",
  star5: "Star",
  chevron: "Chevron",
  homePlate: "Pentagon",
  hexagon: "Hexagon",
  parallelogram: "Parallelogram",
  trapezoid: "Trapezoid",
  cloud: "Cloud",
  heart: "Heart",
};

const humanize = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\d+$/, "").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Shape";
};

/** The first few words of an element's text (empty when it has none). */
export function firstWords(el: Pick<ResolvedElement, "text">, max = 24): string {
  const text = (el.text?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 8 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** What to call an element in the Motion panel: "Title", the first words of its text, or its kind ("Rectangle", "Picture"). */
export function elementLabel(el: ResolvedElement): string {
  const ph = el.placeholder?.type;
  if (ph === "title" || ph === "ctrTitle") return "Title";
  if (ph === "subTitle") return "Subtitle";
  const words = el.kind === "shape" ? firstWords(el) : "";
  if (words) return words;
  switch (el.kind) {
    case "image":
      return "Picture";
    case "table":
      return "Table";
    case "chart":
      return "Chart";
    case "group":
      return "Group";
    default:
      if (ph === "pic" || ph === "clipArt") return "Picture";
      if (ph === "body" || ph === "obj") return "Content";
      if (el.source.type === "shape" && el.source.textBox) return "Text box";
      return GEOMETRY_NAMES[el.geometry] ?? humanize(el.geometry);
  }
}

export const seconds = (ms: number | undefined, fallback = 0) => `${Math.round(((ms ?? fallback) / 1000) * 100) / 100} s`;

/** One line for an animation: "Fade in", "Fly in from left", "Spin" (entrance, emphasis or exit). */
export function describeAnimation(a: Animation): string {
  const name = ANIMATION_LABELS[a.kind];
  if (a.class === "emphasis") return name;
  const dir = hasDirection(a.kind) && a.direction ? ` ${a.class === "exit" ? "to" : "from"} ${a.direction === "up" ? "top" : a.direction === "down" ? "bottom" : a.direction}` : "";
  return `${name} ${a.class === "exit" ? "out" : "in"}${dir}`;
}

/** The animations that point at an element, in order. */
export const animationsFor = (list: readonly Animation[], element: string): Animation[] => list.filter((a) => a.target === element);

// ---- Stepping through a timeline -----------------------------------------------------------------------------------------

export interface StepPlayerOptions {
  /** Milliseconds, steadily increasing. Default `performance.now()`. */
  now?: () => number;
  /** When true, steps finish the moment they start (reduced motion). */
  instant?: () => boolean;
  /** Pause between steps when `autoplay` is on. */
  gap?: number;
}

type Listener = () => void;

/**
 * Where a slideshow is in a slide's animations. A slide's timeline is a list of steps; `done` of them are complete and at most
 * one is running. `advance` is what a click does, `back` what going back does, `skipAll` shows the end. It drives itself
 * with `requestAnimationFrame` and tells its listeners each frame; `where()` gives the moment for `poseAt`.
 */
export class StepPlayer {
  steps: readonly Step[] = [];
  /** Steps complete. */
  done = 0;
  running: { step: number; startedAt: number } | null = null;
  /** The auto step (the first, when it is not on click) has been started for this showing of the slide. */
  autoStarted = false;
  /** Run the steps one after another by themselves (a preview, not a slideshow). */
  autoplay = false;
  /** Called when `autoplay` has run the last step. */
  onComplete?: () => void;
  instant?: () => boolean;
  gap: number;
  #now: () => number;
  #listeners = new Set<Listener>();
  #frame: unknown = undefined;
  #frameIsRaf = false;
  #gapTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: StepPlayerOptions = {}) {
    this.#now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.instant = options.instant;
    this.gap = options.gap ?? 350;
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** True when the slide has animations. */
  get animated(): boolean {
    return this.steps.length > 0;
  }

  /** True while there is something left to play on this slide (a step running or steps not yet played). */
  get remaining(): boolean {
    return this.running !== null || this.done < this.steps.length;
  }

  /** The moment to draw: for `poseAt`. */
  where(): Where {
    const r = this.running;
    if (r) return { steps: this.steps, step: r.step, t: Math.max(0, this.#now() - r.startedAt) };
    return { steps: this.steps, step: this.done, t: -1 };
  }

  /** Starts over on a slide: at its first state (`start`: animated elements waiting) or its last (`end`: all played). */
  load(steps: readonly Step[], at: "start" | "end" = "start"): void {
    this.#cancel();
    this.steps = steps;
    this.running = null;
    this.autoplay = false;
    this.done = at === "end" ? steps.length : 0;
    this.autoStarted = at === "end";
    this.#emit();
  }

  /** Keeps the same place when the slide's animations are edited. */
  setSteps(steps: readonly Step[]): void {
    this.steps = steps;
    if (this.done > steps.length) this.done = steps.length;
    if (this.running && this.running.step >= steps.length) this.running = null;
    this.#emit();
  }

  /** Runs the first step if it starts by itself (call when the slide has appeared). Returns whether it did. */
  startAuto(): boolean {
    if (this.autoStarted) return false;
    this.autoStarted = true;
    if (this.done === 0 && !this.running && this.steps[0]?.auto) {
      this.#start(0);
      return true;
    }
    return false;
  }

  /** What a click does: finishes the step that is running, or starts the next one. False when there is nothing left on the slide. */
  advance(): boolean {
    if (this.running) {
      this.#complete();
      return true;
    }
    if (this.done >= this.steps.length) return false;
    this.#start(this.done);
    return true;
  }

  /** Goes back one step, to how the slide was before it (no animation). False when there is no step to go back over. */
  back(): boolean {
    this.#clearGap();
    const floor = this.steps[0]?.auto ? 1 : 0;
    if (this.running) {
      const k = this.running.step;
      if (k < floor) return false;
      this.#cancelFrame();
      this.running = null;
      this.done = k;
      this.#emit();
      return true;
    }
    if (this.done > floor) {
      this.done -= 1;
      this.#emit();
      return true;
    }
    return false;
  }

  /** Shows every animation of the slide finished. */
  skipAll(): void {
    this.#cancel();
    this.autoplay = false;
    this.running = null;
    this.done = this.steps.length;
    this.#emit();
  }

  /** Stops timers (the state stays as it is). */
  dispose(): void {
    this.#cancel();
    this.autoplay = false;
  }

  // ---- inside ----

  #start(i: number): void {
    const step = this.steps[i];
    if (!step) return;
    if (this.instant?.() || step.duration <= 0) {
      this.running = null;
      this.done = i + 1;
      this.#emit();
      this.#afterStep();
      return;
    }
    this.running = { step: i, startedAt: this.#now() };
    this.#emit();
    this.#schedule();
  }

  #complete(): void {
    const r = this.running;
    if (!r) return;
    this.#cancelFrame();
    this.running = null;
    this.done = r.step + 1;
    this.#emit();
    this.#afterStep();
  }

  #afterStep(): void {
    if (!this.autoplay) return;
    if (this.done >= this.steps.length) {
      this.autoplay = false;
      this.onComplete?.();
      return;
    }
    this.#clearGap();
    this.#gapTimer = setTimeout(() => {
      this.#gapTimer = undefined;
      if (this.autoplay && !this.running && this.done < this.steps.length) this.#start(this.done);
    }, this.gap);
  }

  #schedule(): void {
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame.bind(globalThis) : undefined;
    const tick = () => {
      this.#frame = undefined;
      const r = this.running;
      if (!r) return;
      const step = this.steps[r.step];
      if (!step || this.#now() - r.startedAt >= step.duration) this.#complete();
      else {
        this.#emit();
        this.#schedule();
      }
    };
    if (raf) {
      this.#frameIsRaf = true;
      this.#frame = raf(tick);
    } else {
      this.#frameIsRaf = false;
      this.#frame = setTimeout(tick, 16);
    }
  }

  #cancelFrame(): void {
    if (this.#frame === undefined) return;
    if (this.#frameIsRaf && typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(this.#frame as number);
    else clearTimeout(this.#frame as ReturnType<typeof setTimeout>);
    this.#frame = undefined;
  }

  #clearGap(): void {
    if (this.#gapTimer !== undefined) clearTimeout(this.#gapTimer);
    this.#gapTimer = undefined;
  }

  #cancel(): void {
    this.#cancelFrame();
    this.#clearGap();
  }

  #emit(): void {
    for (const l of [...this.#listeners]) l();
  }
}

/** A player that re-renders its component each time it changes, and stops its timers when the component goes. */
export function useStepPlayer(options: StepPlayerOptions = {}): StepPlayer {
  const [player] = useState(() => new StepPlayer(options));
  const [, force] = useReducer((n: number) => n + 1, 0);
  player.instant = options.instant;
  useEffect(() => player.subscribe(force), [player]);
  useEffect(() => () => player.dispose(), [player]);
  return player;
}

// ---- Adding animations -------------------------------------------------------------------------------------------------

/** Gives each of the elements a default entrance (fade, on click). Returns the animations made. */
export function addAnimations(session: DeckSession, slideId: string, elements: readonly string[]): Animation[] {
  const made: Animation[] = [];
  for (const id of elements) made.push(session.addAnimation(slideId, { target: id, kind: "fade" }));
  return made;
}

// ---- A preview on the canvas -------------------------------------------------------------------------------------------

export interface MotionPreview {
  /** The poses to draw on the canvas, or null when it is not playing. */
  poses: Map<string, Pose> | null;
  playing: boolean;
  play: () => void;
  stop: () => void;
}

/**
 * Plays a slide's animations on the editor's canvas: every step one after another, with no clicks. With reduced motion it
 * jumps to the end state. It stops by itself a moment after the last step, when the slide or the deck changes, or on `stop`.
 */
export function useMotionPreview(session: DeckSession, slideId: string | null, scene: Scene | null, reduceMotion?: boolean): MotionPreview {
  const player = useStepPlayer();
  const [active, setActive] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slide = slideId ? session.deck.slides.find((s) => s.id === slideId) : undefined;
  const frames = useMemo(() => (scene ? framesOf(scene) : new Map<string, Frame>()), [scene]);

  const stop = useCallback(() => {
    player.dispose();
    clearTimeout(hold.current);
    hold.current = undefined;
    setActive(false);
  }, [player]);

  const play = () => {
    if (!slide) return;
    const steps = buildTimeline(slide);
    if (steps.length === 0) return;
    stop();
    const reduced = reduceMotion ?? prefersReducedMotion();
    setActive(true);
    const finish = () => {
      hold.current = setTimeout(stop, reduced ? 1500 : 800);
    };
    if (reduced) {
      player.load(steps, "end");
      finish();
      return;
    }
    player.load(steps, "start");
    player.autoplay = true;
    player.onComplete = finish;
    player.startAuto();
    if (!player.running && player.done === 0) player.advance();
  };

  // anything that changes the deck or the shown slide ends the preview
  useEffect(() => stop, [stop]);
  useEffect(() => stop(), [slideId, stop]);
  useEffect(() => session.subscribe(stop), [session, stop]);

  const poses = active && slide && scene ? (posesFor(slide, scene, player.where(), frames) ?? null) : null;
  return { poses, playing: active && !!poses, play, stop };
}
