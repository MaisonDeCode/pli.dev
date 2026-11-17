import type { Animation, AnimationClass, AnimationEasing, AnimationKind, AnimationTrigger, Element, Slide } from "./model";

// ---- Defaults and what each kind can do -----------------------------------------------------------------------------

export const ANIMATION_KINDS: readonly AnimationKind[] = ["appear", "fade", "fly", "zoom", "wipe", "spin", "pulse", "grow", "motion"];
export const ANIMATION_CLASSES: readonly AnimationClass[] = ["entrance", "emphasis", "exit"];
export const ANIMATION_TRIGGERS: readonly AnimationTrigger[] = ["onClick", "withPrevious", "afterPrevious"];
export const ANIMATION_EASINGS: readonly AnimationEasing[] = ["linear", "easeIn", "easeOut", "easeInOut"];

/** The kinds that make sense in each class (what the editor offers). */
export const KINDS_BY_CLASS: Record<AnimationClass, readonly AnimationKind[]> = {
  entrance: ["appear", "fade", "fly", "zoom", "wipe", "spin"],
  emphasis: ["spin", "pulse", "grow", "motion"],
  exit: ["appear", "fade", "fly", "zoom", "wipe", "spin"],
};

export const ANIMATION_LABELS: Record<AnimationKind, string> = { appear: "Appear", fade: "Fade", fly: "Fly", zoom: "Zoom", wipe: "Wipe", spin: "Spin", pulse: "Pulse", grow: "Grow/Shrink", motion: "Motion path" };

export const DEFAULT_DURATION = 500;

/** The kinds that come from a side. */
export const hasDirection = (kind: AnimationKind): boolean => kind === "fly" || kind === "wipe";

export interface AnimationInput extends Partial<Animation> {
  target: string;
  kind: AnimationKind;
}

/** An animation with its unset fields filled in with what the editor starts with. */
export function makeAnimation(input: AnimationInput, id: string): Animation {
  const cls: AnimationClass = input.class ?? (input.kind === "pulse" || input.kind === "grow" || input.kind === "motion" ? "emphasis" : "entrance");
  const a: Animation = { ...input, id, class: cls, trigger: input.trigger ?? "onClick" };
  if (a.kind === "appear") a.duration = input.duration ?? 0;
  else a.duration = input.duration ?? DEFAULT_DURATION;
  if (hasDirection(a.kind) && !a.direction) a.direction = a.kind === "fly" ? "down" : "left";
  if (a.kind === "spin" && a.amount === undefined) a.amount = 360;
  if (a.kind === "grow" && a.amount === undefined) a.amount = 1.5;
  if (a.kind === "pulse" && a.amount === undefined) a.amount = 1.1;
  if (a.kind === "motion" && !a.path) a.path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  return a;
}

/** Whether an animation is one the model allows: the kind fits the class, a motion path has points. Returns what is wrong, or null. */
export function animationProblem(a: Animation): string | null {
  if (!ANIMATION_CLASSES.includes(a.class)) return `unknown class "${String(a.class)}"`;
  if (!ANIMATION_KINDS.includes(a.kind)) return `unknown kind "${String(a.kind)}"`;
  if (a.trigger !== undefined && !ANIMATION_TRIGGERS.includes(a.trigger)) return `unknown trigger "${String(a.trigger)}"`;
  if (a.easing !== undefined && !ANIMATION_EASINGS.includes(a.easing)) return `unknown easing "${String(a.easing)}"`;
  if (a.direction !== undefined && !["left", "right", "up", "down"].includes(a.direction)) return `unknown direction "${String(a.direction)}"`;
  for (const k of ["duration", "delay"] as const) if (a[k] !== undefined && !(typeof a[k] === "number" && a[k]! >= 0 && Number.isFinite(a[k]!))) return `${k} must be a number of milliseconds, 0 or more`;
  if (a.repeat !== undefined && !(typeof a.repeat === "number" && a.repeat >= 1 && Number.isFinite(a.repeat))) return "repeat must be 1 or more";
  if (a.text !== undefined && a.text !== "all" && a.text !== "paragraph") return `unknown text build "${String(a.text)}"`;
  if (a.amount !== undefined && !(typeof a.amount === "number" && Number.isFinite(a.amount))) return "amount must be a number";
  if (a.path !== undefined && (!Array.isArray(a.path) || a.path.some((p) => typeof p?.x !== "number" || typeof p?.y !== "number"))) return "path must be a list of points";
  if (a.kind === "motion" && (!a.path || a.path.length < 2)) return "a motion path needs at least two points";
  if (a.class !== "emphasis" && (a.kind === "pulse" || a.kind === "grow" || a.kind === "motion")) return `"${a.kind}" is only an emphasis`;
  return null;
}

// ---- Keeping animations tied to elements ----------------------------------------------------------------------------

/** The animations that point at elements that are still on the slide. */
export function liveAnimations(slide: Pick<Slide, "elements" | "animations">): Animation[] {
  const list = slide.animations ?? [];
  if (list.length === 0) return list;
  const ids = new Set(slide.elements.map((e) => e.id));
  return list.filter((a) => ids.has(a.target));
}

/** The same slide, without animations for elements that are gone (and without the field when none are left). */
export function pruneAnimations<T extends Pick<Slide, "elements" | "animations">>(slide: T): T {
  if (!slide.animations) return slide;
  const live = liveAnimations(slide);
  if (live.length === slide.animations.length) return slide;
  const { animations: _a, ...rest } = slide;
  return (live.length ? { ...rest, animations: live } : rest) as T;
}

/** The ids of animations on a slide that would be left over after elements are removed. */
export function animationsOf(slide: Pick<Slide, "animations">, targets: readonly string[]): Animation[] {
  return (slide.animations ?? []).filter((a) => targets.includes(a.target));
}

/** A copy of animations pointed at new elements (`map` gives each old target's new id) with new animation ids. Animations of unmapped targets are dropped. */
export function remapAnimations(list: readonly Animation[], map: ReadonlyMap<string, string>, newId: (prefix: string) => string): Animation[] {
  const out: Animation[] = [];
  for (const a of list) {
    const target = map.get(a.target);
    if (target === undefined) continue;
    out.push({ ...JSON.parse(JSON.stringify(a)), id: newId("a_"), target });
  }
  return out;
}

// ---- The timeline -----------------------------------------------------------------------------------------------------

export interface Effect {
  animation: Animation;
  /** With `text: "paragraph"`, the paragraph this effect is for. */
  paragraph?: number;
  /** Milliseconds from the start of its step. */
  start: number;
  end: number;
}

export interface Step {
  /** A step runs when the presenter clicks, except the first when its first animation is not on click: it runs as the slide shows. */
  auto: boolean;
  effects: Effect[];
  /** When the last effect of the step ends. */
  duration: number;
}

const durationOf = (a: Animation) => a.duration ?? (a.kind === "appear" ? 0 : DEFAULT_DURATION);

/** Paragraphs in an element's text (1 if it has none). */
function paragraphCount(el: Element | undefined): number {
  if (el?.type === "shape" && el.text) return Math.max(1, el.text.paragraphs.length);
  return 1;
}

/** The animations of a slide grouped into click steps, with when each effect starts and ends inside its step. */
export function buildTimeline(slide: Pick<Slide, "elements" | "animations">): Step[] {
  const steps: Step[] = [];
  let prevStart = 0;
  let prevEnd = 0;
  for (const a of liveAnimations(slide)) {
    const el = slide.elements.find((e) => e.id === a.target);
    const count = a.text === "paragraph" && a.kind !== "motion" ? paragraphCount(el) : 1;
    for (let i = 0; i < count; i++) {
      const trigger: AnimationTrigger = a.trigger ?? "onClick";
      let step = steps[steps.length - 1];
      if (!step || trigger === "onClick") {
        step = { auto: !!(steps.length === 0 && trigger !== "onClick"), effects: [], duration: 0 };
        steps.push(step);
        prevStart = 0;
        prevEnd = 0;
      }
      const base = trigger === "afterPrevious" ? prevEnd : trigger === "withPrevious" ? prevStart : 0;
      const start = base + (a.delay ?? 0);
      const end = start + durationOf(a) * Math.max(1, a.repeat ?? 1);
      step.effects.push({ animation: a, ...(count > 1 ? { paragraph: i } : {}), start, end });
      prevStart = base;
      prevEnd = end;
      step.duration = Math.max(step.duration, end);
    }
  }
  return steps;
}

/** How many times a click moves the show forward on this slide (steps that wait for a click). */
export const clickSteps = (steps: readonly Step[]): number => steps.filter((s) => !s.auto).length;

// ---- What an element looks like at a moment ---------------------------------------------------------------------------

export interface Pose {
  /** False while an element has not come in yet or has gone. */
  visible: boolean;
  opacity: number;
  /** Offset in points from its place. */
  dx: number;
  dy: number;
  scale: number;
  /** Degrees. */
  rotate: number;
  /** A wipe: the part shown grows from this side, `t` from 0 to 1. */
  clip?: { from: "left" | "right" | "up" | "down"; t: number };
  /** For text built by paragraph: how much of each paragraph shows (opacity 0 to 1). Missing paragraphs are fully shown. */
  paragraphs?: Record<number, number>;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Where {
  /** The slide's animations as steps. */
  steps: readonly Step[];
  /** Steps before this one are complete. */
  step: number;
  /** Milliseconds into step `step` (use `Infinity` for complete). */
  t: number;
}

export function ease(p: number, easing: AnimationEasing | undefined): number {
  const x = Math.min(1, Math.max(0, p));
  switch (easing) {
    case "easeIn":
      return x * x;
    case "easeOut":
      return 1 - (1 - x) * (1 - x);
    case "easeInOut":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default:
      return x;
  }
}

const identity = (): Pose => ({ visible: true, opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0 });

/** Where along a polyline of points (as a fraction of its length) the element is. */
export function pointOnPath(path: readonly { x: number; y: number }[], p: number): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return { ...path[0]! };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    lengths.push(l);
    total += l;
  }
  let want = Math.min(1, Math.max(0, p)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (want <= l || i === lengths.length - 1) {
      const f = l === 0 ? 0 : Math.min(1, want / l);
      const a = path[i]!;
      const b = path[i + 1]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    want -= l;
  }
  return { ...path[path.length - 1]! };
}

/** How far out of sight a `fly` starts: just off the edge it comes from. */
function flyOffset(from: "left" | "right" | "up" | "down", frame: Frame | undefined, size: { width: number; height: number }): { dx: number; dy: number } {
  const f = frame ?? { x: 0, y: 0, w: 0, h: 0 };
  switch (from) {
    case "left":
      return { dx: -(f.x + f.w), dy: 0 };
    case "right":
      return { dx: size.width - f.x, dy: 0 };
    case "up":
      return { dx: 0, dy: -(f.y + f.h) };
    default:
      return { dx: 0, dy: size.height - f.y };
  }
}

/** The pose of an element part-way through an entrance (`p` 0 hidden to 1 shown); an exit is the same run backwards. */
function inPose(a: Animation, p: number, frame: Frame | undefined, size: { width: number; height: number }): Pose {
  const pose = identity();
  if (p >= 1) return pose;
  switch (a.kind) {
    case "appear":
      pose.visible = p > 0;
      return pose;
    case "fade":
    case "pulse":
    case "motion":
      pose.opacity = p;
      return pose;
    case "fly": {
      const o = flyOffset(a.direction ?? "down", frame, size);
      pose.dx = o.dx * (1 - p);
      pose.dy = o.dy * (1 - p);
      return pose;
    }
    case "zoom":
    case "grow":
      pose.scale = p;
      pose.opacity = p;
      return pose;
    case "wipe":
      pose.clip = { from: a.direction ?? "left", t: p };
      return pose;
    case "spin":
      pose.rotate = -(a.amount ?? 360) * (1 - p);
      pose.scale = p;
      pose.opacity = p;
      return pose;
  }
}

/**
 * Where every animated element of a slide is at a moment of the slideshow. Elements with no animation are not in the
 * map (they are always shown as they are). An element whose first animation is an entrance is hidden until then.
 */
export function poseAt(slide: Pick<Slide, "elements" | "animations">, where: Where, frames: ReadonlyMap<string, Frame>, size: { width: number; height: number }): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  const firstClass = new Map<string, AnimationClass>();
  for (const step of where.steps) for (const e of step.effects) if (!firstClass.has(e.animation.target)) firstClass.set(e.animation.target, e.animation.class);
  const paragraphBuilt = new Set<string>();
  for (const step of where.steps) for (const e of step.effects) if (e.paragraph !== undefined) paragraphBuilt.add(e.animation.target);
  for (const [id, cls] of firstClass) {
    const pose = identity();
    if (cls === "entrance" && !paragraphBuilt.has(id)) pose.visible = false;
    poses.set(id, pose);
  }
  // paragraphs that come in start unseen
  const el = (id: string) => slide.elements.find((e) => e.id === id);
  for (const id of paragraphBuilt) {
    const pose = poses.get(id)!;
    pose.paragraphs = {};
    const n = paragraphCount(el(id));
    for (let i = 0; i < n; i++) {
      const first = where.steps.flatMap((s) => s.effects).find((e) => e.animation.target === id && e.paragraph === i);
      if (first?.animation.class === "entrance") pose.paragraphs[i] = 0;
    }
  }
  for (let si = 0; si < where.steps.length && si <= where.step; si++) {
    const step = where.steps[si]!;
    const now = si < where.step ? Infinity : where.t;
    for (const e of step.effects) {
      if (now < e.start) continue;
      const a = e.animation;
      const pose = poses.get(a.target);
      if (!pose) continue;
      const dur = durationOf(a);
      const reps = Math.max(1, a.repeat ?? 1);
      const done = now >= e.end || (dur === 0);
      const elapsed = Math.max(0, now - e.start);
      const cycle = dur === 0 ? 1 : Math.min(reps, elapsed / dur);
      const frac = done ? 1 : cycle - Math.floor(cycle);
      const p = ease(a.kind === "appear" ? (done ? 1 : 0) : frac, a.easing);
      applyEffect(pose, a, e.paragraph, done, p, reps, frames.get(a.target), size);
    }
  }
  return poses;
}

function applyEffect(pose: Pose, a: Animation, paragraph: number | undefined, done: boolean, p: number, reps: number, frame: Frame | undefined, size: { width: number; height: number }): void {
  if (a.class === "emphasis") {
    switch (a.kind) {
      case "spin":
        pose.rotate += (a.amount ?? 360) * (done ? reps : Math.min(1, p));
        break;
      case "grow":
        pose.scale *= 1 + ((a.amount ?? 1.5) - 1) * (done ? 1 : p);
        break;
      case "pulse":
        if (!done) pose.scale *= 1 + ((a.amount ?? 1.1) - 1) * Math.sin(Math.PI * p);
        break;
      case "motion": {
        const at = pointOnPath(a.path ?? [], done ? 1 : p);
        pose.dx += at.x;
        pose.dy += at.y;
        break;
      }
      case "fade":
        if (!done) pose.opacity *= 1 - 0.5 * Math.sin(Math.PI * p);
        break;
      default:
        break;
    }
    return;
  }
  const entering = a.class === "entrance";
  const progress = entering ? p : 1 - p;
  if (paragraph !== undefined && pose.paragraphs) {
    pose.paragraphs[paragraph] = a.kind === "appear" ? (progress > 0 ? 1 : 0) : Math.min(1, Math.max(0, progress));
    return;
  }
  const state = inPose(a, done ? (entering ? 1 : 0) : progress, frame, size);
  if (!entering && done) {
    pose.visible = false;
    return;
  }
  pose.visible = state.visible;
  pose.opacity = state.opacity;
  pose.dx = state.dx;
  pose.dy = state.dy;
  pose.scale = state.scale;
  pose.rotate = state.rotate;
  if (state.clip) pose.clip = state.clip;
  else delete pose.clip;
}

/** CSS-like transform text for a pose, in points about the element's centre (for renderers that want one). */
export function poseTransform(pose: Pose): string {
  const parts: string[] = [];
  if (pose.dx || pose.dy) parts.push(`translate(${round(pose.dx)}px, ${round(pose.dy)}px)`);
  if (pose.rotate) parts.push(`rotate(${round(pose.rotate)}deg)`);
  if (pose.scale !== 1) parts.push(`scale(${round(pose.scale)})`);
  return parts.join(" ");
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The poses once everything on the slide has run (what going back to a slide, or skipping the animations, shows). */
export function finalPoses(slide: Pick<Slide, "elements" | "animations">, frames: ReadonlyMap<string, Frame>, size: { width: number; height: number }): Map<string, Pose> {
  const steps = buildTimeline(slide);
  return poseAt(slide, { steps, step: steps.length, t: Infinity }, frames, size);
}
