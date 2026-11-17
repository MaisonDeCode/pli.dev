import { child, childrenNamed, elements, textOf, type XmlElement } from "@pli.dev/core";
import { animationProblem, buildTimeline, makeAnimation, type AnimationInput } from "../animation";
import { newId } from "../build";
import type { Animation, AnimationClass, AnimationEasing, AnimationKind, AnimationTrigger, Element, Slide, SlideSize } from "../model";
import { tag } from "./emit";

/**
 * Object animations in PresentationML (`p:timing`), the way PowerPoint writes them: a main sequence of click steps, each
 * holding groups that start together, each holding one effect per animated shape with its behaviours. Only the effects
 * Pli can play are written; reading maps PowerPoint's presets to the nearest of them and reports what it approximated.
 *
 * Presets written (PowerPoint's own ids, so it shows them by name in its animation pane):
 *
 *   entrance / exit   appear 1, fade 10, fly 2 (subtype 1 top, 2 right, 4 bottom, 8 left), wipe 22 (same subtypes),
 *                     zoom 53 (subtype 16), spin 31 ("Grow & Turn": it grows while it turns)
 *   emphasis          spin 8, pulse 26, grow/shrink 6
 *   motion path       class `path`, id 0, an `animMotion` path in fractions of the slide
 */

// ---- Shared tables -------------------------------------------------------------------------------------------------

type Dir = "left" | "right" | "up" | "down";

const NODE_TYPE: Record<AnimationTrigger, string> = { onClick: "clickEffect", withPrevious: "withEffect", afterPrevious: "afterEffect" };
const DIR_SUBTYPE: Record<Dir, number> = { up: 1, right: 2, down: 4, left: 8 };
const SUBTYPE_DIR: Record<number, Dir> = { 1: "up", 2: "right", 4: "down", 8: "left" };

/** PowerPoint's names for the presets it has (for the notes about what was approximated). */
const ENTRANCE_NAMES: Record<number, string> = {
  1: "Appear", 2: "Fly In", 3: "Blinds", 4: "Box", 5: "Checkerboard", 6: "Circle", 7: "Crawl In", 8: "Diamond", 9: "Dissolve In", 10: "Fade", 11: "Flash Once", 12: "Peek In", 13: "Plus", 14: "Random Bars",
  15: "Spiral In", 16: "Split", 17: "Stretch", 18: "Strips", 19: "Swivel", 20: "Wedge", 21: "Wheel", 22: "Wipe", 23: "Zoom", 25: "Boomerang", 26: "Bounce", 27: "Color Typewriter", 28: "Credits", 29: "Ease In",
  30: "Float", 31: "Grow & Turn", 34: "Light Speed", 35: "Pinwheel", 37: "Rise Up", 38: "Swish", 39: "Thin Line", 40: "Unfold", 41: "Whip", 42: "Ascend", 43: "Center Revolve", 45: "Fade Swivel", 47: "Descend",
  48: "Sling", 49: "Spinner", 50: "Compress", 51: "Zip", 52: "Curve Up", 53: "Fade Zoom",
};
const EXIT_NAMES: Record<number, string> = { ...ENTRANCE_NAMES, 1: "Disappear", 2: "Fly Out", 7: "Crawl Out", 9: "Dissolve Out", 12: "Peek Out", 15: "Spiral Out" };
const EMPHASIS_NAMES: Record<number, string> = {
  1: "Fill Color", 2: "Font", 3: "Font Color", 4: "Font Size", 5: "Font Style", 6: "Grow/Shrink", 7: "Line Color", 8: "Spin", 9: "Transparency", 10: "Bold Flash", 14: "Blast", 15: "Bold Reveal", 16: "Brush On Color",
  18: "Underline", 19: "Color Blend", 20: "Color Pulse", 21: "Complementary Color", 23: "Contrasting Color", 24: "Darken", 25: "Desaturate", 26: "Pulse", 27: "Flicker", 28: "Grow With Color", 29: "Lighten",
  31: "Teeter", 32: "Vertical Highlight", 33: "Wave", 34: "Blink", 35: "Shimmer",
};

// ---- Writing --------------------------------------------------------------------------------------------------------

/** What the writer needs to know about an element that was written to the slide. */
export interface TimingTarget {
  /** The `id` of its `p:cNvPr`. */
  spid: number;
  /** How the build list names it: text shapes (`bldP`), charts (`bldGraphic`), or not at all. */
  bld: "text" | "graphic" | "none";
  /** A text shape with a fill or outline animates that too. */
  animBg: boolean;
}

/** Whether an animation can be written as a PowerPoint preset. */
function expressible(a: Animation): boolean {
  if (animationProblem(a) !== null) return false;
  if (a.class === "emphasis") return a.kind === "spin" || a.kind === "pulse" || a.kind === "grow" || a.kind === "motion";
  return a.kind !== "pulse" && a.kind !== "grow" && a.kind !== "motion";
}

const fixed = (n: number): string => String(Number(n.toFixed(8)));
const ms = (n: number | undefined, fallback: number): number => Math.max(0, Math.round(Number.isFinite(n ?? NaN) ? (n as number) : fallback));

type Val = { f: number } | string;

/**
 * The `p:timing` of a slide: `tnLst` with the main sequence and `bldLst`. Empty when no animation can be written. Ids of
 * `p:cTn` run 1, 2, 3… in document order, as PowerPoint numbers them.
 */
export function timingXml(slide: Pick<Slide, "elements" | "animations">, targets: ReadonlyMap<string, TimingTarget>, size: SlideSize): string {
  const list = (slide.animations ?? []).filter((a) => targets.has(a.target) && expressible(a));
  if (list.length === 0) return "";
  const steps = buildTimeline({ elements: slide.elements as Element[], animations: list });
  let n = 2; // 1 is the root and 2 the main sequence
  const next = () => ++n;
  const bld = new Map<number, { target: TimingTarget; byParagraph: boolean }>();

  const effectXml = (animation: Animation, paragraph: number | undefined, trigger: AnimationTrigger): string => {
    const a = animation;
    const t = targets.get(a.target)!;
    const byParagraph = paragraph !== undefined || (a.text === "paragraph" && t.bld === "text" && a.kind !== "motion");
    const para = byParagraph ? (paragraph ?? 0) : undefined;
    if (t.bld !== "none") {
      const seen = bld.get(t.spid);
      bld.set(t.spid, { target: t, byParagraph: byParagraph || (seen?.byParagraph ?? false) });
    }
    const spTgt = tag("p:spTgt", { spid: t.spid }, para === undefined ? "" : tag("p:txEl", {}, tag("p:pRg", { st: para, end: para })));
    const tgtEl = tag("p:tgtEl", {}, spTgt);
    const attrNames = (names: string[]) => tag("p:attrNameLst", {}, names.map((v) => tag("p:attrName", {}, v)).join(""));
    const cond = (delay: number) => tag("p:stCondLst", {}, tag("p:cond", { delay }));

    const id = next();
    const dur = ms(a.duration, a.kind === "appear" ? 0 : 500);
    const bdur = Math.max(1, dur);
    const cls = a.class;
    const rep = a.repeat !== undefined && a.repeat > 1 ? Math.round(a.repeat * 1000) : undefined;
    const easing: AnimationEasing = a.easing ?? "linear";
    const accel = easing === "easeIn" ? 100000 : easing === "easeInOut" ? 50000 : undefined;
    const decel = easing === "easeOut" ? 100000 : easing === "easeInOut" ? 50000 : undefined;

    const set = (visible: boolean, delay: number): string => {
      const sid = next();
      return tag("p:set", {}, tag("p:cBhvr", {}, tag("p:cTn", { id: sid, dur: 1, fill: "hold" }, cond(delay)) + tgtEl + attrNames(["style.visibility"])) + tag("p:to", {}, tag("p:strVal", { val: visible ? "visible" : "hidden" })));
    };
    const val = (v: Val) => tag("p:val", {}, typeof v === "string" ? tag("p:strVal", { val: v }) : tag("p:fltVal", { val: fixed(v.f) }));
    const anim = (attr: string, from: Val, to: Val, additive?: "base"): string => {
      const aid = next();
      return tag(
        "p:anim",
        { calcmode: "lin", valueType: "num" },
        tag("p:cBhvr", { additive }, tag("p:cTn", { id: aid, dur: bdur, fill: "hold" }) + tgtEl + attrNames([attr])) + tag("p:tavLst", {}, tag("p:tav", { tm: 0 }, val(from)) + tag("p:tav", { tm: 100000 }, val(to))),
      );
    };
    const animEffect = (transition: "in" | "out", filter: string): string => {
      const eid = next();
      return tag("p:animEffect", { transition, filter }, tag("p:cBhvr", {}, tag("p:cTn", { id: eid, dur: bdur }) + tgtEl));
    };

    let preset = 0;
    let presetClass = cls === "entrance" ? "entr" : cls === "exit" ? "exit" : "emph";
    let subtype = 0;
    let body = "";
    const entering = cls === "entrance";
    // one move: in from (or out to) a value; an exit runs the same pair backwards
    const pair = (attr: string, away: Val, home: Val, additive?: "base") => (entering ? anim(attr, away, home, additive) : anim(attr, home, away, additive));
    if (cls === "emphasis") {
      switch (a.kind) {
        case "spin": {
          preset = 8;
          const rid = next();
          body = tag("p:animRot", { by: Math.round((a.amount ?? 360) * 60000) }, tag("p:cBhvr", {}, tag("p:cTn", { id: rid, dur: bdur, fill: "hold" }) + tgtEl + attrNames(["r"])));
          break;
        }
        case "pulse": {
          preset = 26;
          const pid = next();
          const k = Math.round((a.amount ?? 1.1) * 100000);
          body = tag("p:animScale", {}, tag("p:cBhvr", {}, tag("p:cTn", { id: pid, dur: Math.max(1, Math.round(bdur / 2)), autoRev: true, fill: "hold" }) + tgtEl) + tag("p:by", { x: k, y: k }));
          break;
        }
        case "grow": {
          preset = 6;
          const gid = next();
          const k = Math.round((a.amount ?? 1.5) * 100000);
          body = tag("p:animScale", {}, tag("p:cBhvr", {}, tag("p:cTn", { id: gid, dur: bdur, fill: "hold" }) + tgtEl) + tag("p:by", { x: k, y: k }));
          break;
        }
        case "motion": {
          presetClass = "path";
          const mid = next();
          const pts = (a.path ?? []).map((p) => `${fixed(p.x / size.width)} ${fixed(p.y / size.height)}`);
          const path = `M ${pts[0] ?? "0 0"}${pts.slice(1).map((p) => ` L ${p}`).join("")} E`;
          body = tag("p:animMotion", { origin: "layout", path, pathEditMode: "relative", rAng: 0 }, tag("p:cBhvr", {}, tag("p:cTn", { id: mid, dur: bdur, fill: "hold" }) + tgtEl + attrNames(["ppt_x", "ppt_y"])));
          break;
        }
      }
    } else {
      const inOut = entering ? "in" : "out";
      const hide = () => (entering ? "" : set(false, Math.max(0, dur - 1)));
      const show = () => (entering ? set(true, 0) : "");
      switch (a.kind) {
        case "appear":
          preset = 1;
          body = set(entering, 0);
          break;
        case "fade":
          preset = 10;
          body = show() + animEffect(inOut, "fade") + hide();
          break;
        case "fly": {
          preset = 2;
          const dir = a.direction ?? "down";
          subtype = DIR_SUBTYPE[dir];
          const horizontal = dir === "left" || dir === "right";
          const away = dir === "left" ? "0-#ppt_w/2" : dir === "right" ? "1+#ppt_w/2" : dir === "up" ? "0-#ppt_h/2" : "1+#ppt_h/2";
          body = show() + (horizontal ? pair("ppt_x", away, "#ppt_x", "base") + anim("ppt_y", "#ppt_y", "#ppt_y", "base") : anim("ppt_x", "#ppt_x", "#ppt_x", "base") + pair("ppt_y", away, "#ppt_y", "base")) + hide();
          break;
        }
        case "wipe": {
          preset = 22;
          const dir = a.direction ?? "left";
          subtype = DIR_SUBTYPE[dir];
          body = show() + animEffect(inOut, `wipe(${dir})`) + hide();
          break;
        }
        case "zoom":
          preset = 53;
          subtype = 16;
          body = show() + pair("ppt_w", { f: 0 }, "#ppt_w") + pair("ppt_h", { f: 0 }, "#ppt_h") + animEffect(inOut, "fade") + hide();
          break;
        case "spin":
          preset = 31;
          body = show() + pair("ppt_w", { f: 0 }, "#ppt_w") + pair("ppt_h", { f: 0 }, "#ppt_h") + pair("style.rotation", { f: -(a.amount ?? 360) }, { f: 0 }) + animEffect(inOut, "fade") + hide();
          break;
      }
    }
    const ctn = tag(
      "p:cTn",
      { id, presetID: presetClass === "path" ? 0 : preset, presetClass, presetSubtype: subtype, accel, decel, repeatCount: rep, fill: "hold", grpId: t.bld === "none" ? undefined : 0, nodeType: NODE_TYPE[trigger] },
      cond(ms(a.delay, 0)) + tag("p:childTnLst", {}, body),
    );
    return tag("p:par", {}, ctn);
  };

  const stepXml = steps
    .map((step) => {
      const sid = next();
      // effects that start together share a group; an effect that follows the one before starts a new group
      const groups: { delay: number; effects: (typeof step.effects)[number][] }[] = [];
      for (const e of step.effects) {
        const t = e.animation.trigger ?? "onClick";
        if (groups.length === 0 || t === "afterPrevious") groups.push({ delay: Math.max(0, Math.round(e.start - (e.animation.delay ?? 0))), effects: [] });
        groups[groups.length - 1]!.effects.push(e);
      }
      const inner = groups
        .map((g) => {
          const gid = next();
          const effects = g.effects.map((e) => effectXml(e.animation, e.paragraph, e.animation.trigger ?? "onClick")).join("");
          return tag("p:par", {}, tag("p:cTn", { id: gid, fill: "hold" }, tag("p:stCondLst", {}, tag("p:cond", { delay: g.delay })) + tag("p:childTnLst", {}, effects)));
        })
        .join("");
      const start = tag("p:cond", { delay: "indefinite" }) + (step.auto ? tag("p:cond", { evt: "onBegin", delay: 0 }, tag("p:tn", { val: 2 })) : "");
      return tag("p:par", {}, tag("p:cTn", { id: sid, fill: "hold" }, tag("p:stCondLst", {}, start) + tag("p:childTnLst", {}, inner)));
    })
    .join("");

  const slideTgt = tag("p:tgtEl", {}, tag("p:sldTgt"));
  const seq = tag(
    "p:seq",
    { concurrent: true, nextAc: "seek" },
    tag("p:cTn", { id: 2, dur: "indefinite", nodeType: "mainSeq" }, tag("p:childTnLst", {}, stepXml)) +
      tag("p:prevCondLst", {}, tag("p:cond", { evt: "onPrev", delay: 0 }, slideTgt)) +
      tag("p:nextCondLst", {}, tag("p:cond", { evt: "onNext", delay: 0 }, slideTgt)),
  );
  const root = tag("p:par", {}, tag("p:cTn", { id: 1, dur: "indefinite", restart: "never", nodeType: "tmRoot" }, tag("p:childTnLst", {}, seq)));
  const blds = [...bld.values()].map(({ target, byParagraph }) => {
    if (target.bld === "graphic") return tag("p:bldGraphic", { spid: target.spid, grpId: 0 }, tag("p:bldAsOne"));
    return tag("p:bldP", { spid: target.spid, grpId: 0, animBg: byParagraph ? undefined : target.animBg || undefined, build: byParagraph ? "p" : undefined });
  });
  return tag("p:timing", {}, tag("p:tnLst", {}, root) + (blds.length ? tag("p:bldLst", {}, blds.join("")) : ""));
}

// ---- Reading --------------------------------------------------------------------------------------------------------

/** A top-level shape of the slide that an effect can point at. */
export interface TimingTargetIn {
  /** The id of the element in the deck. */
  id: string;
  name?: string;
  /** Paragraphs in its text (1 if it has none). */
  paragraphs: number;
}

export interface TimingReadEnv {
  /** Top-level shapes of the slide by the `id` of their `p:cNvPr`. */
  targets: ReadonlyMap<string, TimingTargetIn>;
  /** The shapes inside groups (they cannot be animated one by one here). */
  nested: ReadonlyMap<string, string | undefined>;
  size: SlideSize;
  /** Adds a note about something that was approximated or left out (the caller prefixes the slide). */
  warn: (message: string) => void;
}

const MAX_EFFECTS = 5000;
const MAX_DEPTH = 64;
const MAX_REPEAT = 100;
const MAX_MS = 3_600_000;

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const EFFECT_NODES = new Set(["clickEffect", "withEffect", "afterEffect"]);
const BEHAVIOURS = new Set(["set", "anim", "animEffect", "animScale", "animRot", "animMotion", "animClr", "audio", "video", "cmd"]);
const PRESET_CLASSES: Record<string, "entr" | "exit" | "emph" | "path" | "mediacall"> = { entr: "entr", exit: "exit", emph: "emph", path: "path", mediacall: "mediacall" };

interface Behaviour {
  name: string;
  node: XmlElement;
  ctn: XmlElement | undefined;
  attrs: string[];
  tavs: { tm?: number; str?: string; flt?: number }[];
}

interface Raw {
  node: XmlElement;
  cls: "entr" | "exit" | "emph" | "path" | "mediacall" | undefined;
  id: number | undefined;
  subtype: number | undefined;
  nodeType: string | undefined;
  /** The first effect of a click step. */
  first: boolean;
  step: number;
  spid: string | undefined;
  /** The paragraphs it is for (when it is for part of the text). */
  paras: { st: number; end: number } | undefined;
  partial: boolean;
  behaviours: Behaviour[];
}

function behavioursOf(node: XmlElement, out: Behaviour[] = [], depth = 0): Behaviour[] {
  if (depth > MAX_DEPTH) return out;
  for (const c of elements(node)) {
    if (BEHAVIOURS.has(c.name)) {
      const ctn = child(child(c, "cBhvr"), "cTn");
      const tavs = childrenNamed(child(c, "tavLst"), "tav").map((tav) => {
        const v = child(tav, "val");
        const s = child(v, "strVal")?.attrs.val;
        const f = num(child(v, "fltVal")?.attrs.val ?? child(v, "intVal")?.attrs.val);
        return { tm: num(tav.attrs.tm), str: s, flt: f };
      });
      out.push({ name: c.name, node: c, ctn, attrs: childrenNamed(child(child(c, "cBhvr"), "attrNameLst"), "attrName").map((x) => textOf(x).trim()), tavs });
    } else if (c.name !== "stCondLst" && c.name !== "endCondLst") behavioursOf(c, out, depth + 1);
  }
  return out;
}

const classOf = (v: string | undefined) => (v === undefined ? undefined : PRESET_CLASSES[v]);

/** Every effect node of the main sequence in order, with the click step it belongs to. */
function collect(node: XmlElement, step: number, out: Raw[], depth: number, state: { first: boolean; media: boolean }): void {
  if (depth > MAX_DEPTH || out.length > MAX_EFFECTS) return;
  for (const c of elements(node)) {
    if (c.name === "cTn" && (EFFECT_NODES.has(c.attrs.nodeType ?? "") || (c.attrs.presetClass !== undefined && c.attrs.presetID !== undefined))) {
      const behaviours = behavioursOf(child(c, "childTnLst") ?? c);
      const tgt = findTarget(c);
      const rg = tgt?.rg;
      out.push({
        node: c,
        cls: classOf(c.attrs.presetClass),
        id: num(c.attrs.presetID),
        subtype: num(c.attrs.presetSubtype),
        nodeType: c.attrs.nodeType,
        first: state.first,
        step,
        spid: tgt?.spid,
        paras: rg,
        partial: tgt?.partial ?? false,
        behaviours,
      });
      state.first = false;
      if (behaviours.some((b) => b.name === "audio" || b.name === "video" || b.name === "cmd")) state.media = true;
    } else if (c.name === "audio" || c.name === "video" || c.name === "cmd") state.media = true;
    else collect(c, step, out, depth + 1, state);
  }
}

function findDescendant(node: XmlElement | undefined, name: string, depth = 0): XmlElement | undefined {
  if (!node || depth > MAX_DEPTH) return undefined;
  for (const c of elements(node)) {
    if (c.name === name) return c;
    const hit = findDescendant(c, name, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

interface Tgt {
  spid: string | undefined;
  rg: { st: number; end: number } | undefined;
  /** Targets part of a shape other than whole paragraphs (letters, a chart series). */
  partial: boolean;
}

function findTarget(effect: XmlElement): Tgt | undefined {
  const sp = findDescendant(effect, "spTgt");
  if (!sp) return undefined;
  let rg: Tgt["rg"];
  let partial = false;
  const tx = child(sp, "txEl");
  if (tx) {
    const p = child(tx, "pRg");
    const st = num(p?.attrs.st);
    const end = num(p?.attrs.end);
    if (p && st !== undefined && end !== undefined && st >= 0 && end >= st) rg = { st, end };
    else partial = true;
    if (child(tx, "charRg")) partial = true;
  }
  if (child(sp, "graphicEl") || child(sp, "subSp") || child(sp, "bg") || child(sp, "oleChartEl")) partial = true;
  return { spid: sp.attrs.spid, rg, partial };
}

interface Mapped {
  kind: AnimationKind;
  class: AnimationClass;
  direction?: Dir;
  amount?: number;
  path?: { x: number; y: number }[];
  /** When the preset is not one Pli has: what was used instead. */
  approx?: string;
}

const nameOf = (cls: Raw["cls"], id: number | undefined): string => {
  const table = cls === "emph" ? EMPHASIS_NAMES : cls === "exit" ? EXIT_NAMES : ENTRANCE_NAMES;
  const label = cls === "emph" ? "emphasis" : cls === "exit" ? "exit" : cls === "path" ? "motion path" : "entrance";
  return id !== undefined && table[id] ? `"${table[id]}" (${label} preset ${id})` : `${label} preset ${id ?? "?"}`;
};

/** Where a fly starts from, read off its x and y animations (`0-#ppt_w/2` is off the left edge). */
function flyDirection(bs: Behaviour[], exit: boolean): Dir | undefined {
  for (const b of bs) {
    if (b.name !== "anim") continue;
    const attr = b.attrs[0];
    if (attr !== "ppt_x" && attr !== "ppt_y") continue;
    const tav = exit ? b.tavs[b.tavs.length - 1] : b.tavs[0];
    const s = tav?.str?.replace(/\s+/g, "");
    if (!s) continue;
    if (s.startsWith("0-")) return attr === "ppt_x" ? "left" : "up";
    if (s.startsWith("1+")) return attr === "ppt_x" ? "right" : "down";
  }
  return undefined;
}

function wipeDirection(bs: Behaviour[]): Dir | undefined {
  for (const b of bs) {
    const m = b.name === "animEffect" ? /^wipe\((left|right|up|down)\)$/.exec((b.node.attrs.filter ?? "").trim()) : null;
    if (m) return m[1] as Dir;
  }
  return undefined;
}

/** A direction from a preset subtype (1 top, 2 right, 4 bottom, 8 left); corners (sums) take their vertical side. */
function subtypeDirection(subtype: number | undefined): { dir: Dir | undefined; exact: boolean } {
  if (subtype === undefined) return { dir: undefined, exact: false };
  if (SUBTYPE_DIR[subtype]) return { dir: SUBTYPE_DIR[subtype], exact: true };
  if (subtype & 1) return { dir: "up", exact: false };
  if (subtype & 4) return { dir: "down", exact: false };
  if (subtype & 8) return { dir: "left", exact: false };
  if (subtype & 2) return { dir: "right", exact: false };
  return { dir: undefined, exact: false };
}

/** A motion path (`M 0 0 L 0.1 0.2 C …  E`, in fractions of the slide) as points; curves are sampled. */
function readPath(path: string | undefined, size: SlideSize): { points: { x: number; y: number }[]; curved: boolean } | undefined {
  if (!path) return undefined;
  const tokens = path.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return undefined;
  const points: { x: number; y: number }[] = [];
  let curved = false;
  let cmd = "";
  let at = { x: 0, y: 0 };
  let i = 0;
  const read = (k: number): number[] | undefined => {
    const v: number[] = [];
    for (let j = 0; j < k; j++) {
      const x = Number(tokens[i + j]);
      if (tokens[i + j] === undefined || !Number.isFinite(x)) return undefined;
      v.push(x);
    }
    i += k;
    return v;
  };
  const push = (x: number, y: number) => {
    at = { x, y };
    points.push({ x: round3(x * size.width), y: round3(y * size.height) });
  };
  for (let guard = 0; i < tokens.length && guard < 10_000; guard++) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "E" || cmd === "e") break;
      if (cmd === "Z" || cmd === "z" || cmd === "N" || cmd === "n") continue;
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const base = rel ? at : { x: 0, y: 0 };
    if (upper === "M" || upper === "L") {
      const v = read(2);
      if (!v) break;
      push(base.x + v[0]!, base.y + v[1]!);
      if (upper === "M") cmd = rel ? "l" : "L";
    } else if (upper === "C") {
      const v = read(6);
      if (!v) break;
      curved = true;
      const p0 = at;
      const [c1, c2, p1] = [{ x: base.x + v[0]!, y: base.y + v[1]! }, { x: base.x + v[2]!, y: base.y + v[3]! }, { x: base.x + v[4]!, y: base.y + v[5]! }];
      for (let s = 1; s <= 8; s++) {
        const u = s / 8;
        const w = 1 - u;
        push(w * w * w * p0.x + 3 * w * w * u * c1.x + 3 * w * u * u * c2.x + u * u * u * p1.x, w * w * w * p0.y + 3 * w * w * u * c1.y + 3 * w * u * u * c2.y + u * u * u * p1.y);
      }
    } else {
      // an arc or other segment: skip its numbers
      curved = true;
      i++;
    }
  }
  return points.length >= 2 ? { points, curved } : undefined;
}

/** What an effect is, in Pli's terms. `null` when it can't be used at all. */
function mapEffect(raw: Raw, env: TimingReadEnv, warn: (m: string) => void): Mapped | null {
  const bs = raw.behaviours;
  const has = (name: string) => bs.some((b) => b.name === name);
  const motion = bs.find((b) => b.name === "animMotion");
  const attrOf = (name: string) => bs.some((b) => b.name === "anim" && b.attrs.includes(name));
  let cls: Raw["cls"] = raw.cls;
  if (cls === "mediacall") return null;
  // without a class: a set to hidden (or an animEffect out) is an exit, a set to visible an entrance, else an emphasis
  if (cls === undefined) {
    const toVal = bs.find((b) => b.name === "set")?.node;
    const v = child(child(toVal, "to"), "strVal")?.attrs.val;
    const out = bs.some((b) => b.name === "animEffect" && b.node.attrs.transition === "out");
    cls = out || v === "hidden" ? "exit" : v === "visible" || bs.some((b) => b.name === "animEffect" && b.node.attrs.transition === "in") ? "entr" : motion ? "path" : "emph";
  }
  const exit = cls === "exit";
  const klass: AnimationClass = cls === "entr" ? "entrance" : exit ? "exit" : "emphasis";
  const known = raw.id;

  if (cls === "path" || (cls === "emph" && motion)) {
    const p = readPath(motion?.node.attrs.path, env.size);
    if (!p) {
      warn(`a motion path animation could not be read and was dropped`);
      return null;
    }
    if (p.curved) warn(`a curved motion path was replaced by straight lines`);
    return { kind: "motion", class: "emphasis", path: p.points };
  }

  if (cls === "emph") {
    const scale = bs.find((b) => b.name === "animScale");
    const rot = bs.find((b) => b.name === "animRot");
    const spinAmount = () => {
      const by = num(rot?.node.attrs.by);
      const to = num(rot?.node.attrs.to);
      const from = num(rot?.node.attrs.from) ?? 0;
      const deg = by !== undefined ? by / 60000 : to !== undefined ? (to - from) / 60000 : 360;
      return clampN(deg === 0 ? 360 : deg, -36000, 36000);
    };
    const scaleAmount = (fallback: number) => {
      const p = child(scale?.node, "by") ?? child(scale?.node, "to");
      const x = num(p?.attrs.x);
      const y = num(p?.attrs.y);
      if (x !== undefined && y !== undefined && Math.abs(x - y) > 1) warn(`a Grow/Shrink animation with different horizontal and vertical sizes was drawn with the horizontal one`);
      return x === undefined || x <= 0 ? fallback : clampN(x / 100000, 0.01, 100);
    };
    if (known === 8 && rot) return { kind: "spin", class: klass, amount: spinAmount() };
    if (known === 26 && scale) return { kind: "pulse", class: klass, amount: scaleAmount(1.1) };
    if (known === 6 && scale) return { kind: "grow", class: klass, amount: scaleAmount(1.5) };
    // not one of the three: by what it does
    if (rot) return { kind: "spin", class: klass, amount: spinAmount(), approx: "Spin" };
    if (scale) return { kind: "grow", class: klass, amount: scaleAmount(1.5), approx: "Grow/Shrink" };
    return { kind: "pulse", class: klass, amount: 1.1, approx: "Pulse" };
  }

  // entrances and exits
  const wipe = wipeDirection(bs);
  const fly = flyDirection(bs, exit);
  const sub = subtypeDirection(raw.subtype);
  const spinsOnEntry = attrOf("style.rotation") || bs.some((b) => b.name === "animRot");
  const sizes = attrOf("ppt_w") || attrOf("ppt_h") || bs.some((b) => b.name === "animScale");
  const rotation = (): number => {
    // an entrance starts turned by -amount and ends at 0; an exit runs the same pair backwards
    const b = bs.find((x) => x.name === "anim" && x.attrs.includes("style.rotation"));
    const v = b ? (exit ? b.tavs[b.tavs.length - 1]?.flt : b.tavs[0]?.flt) : undefined;
    if (v !== undefined && v !== 0) return clampN(-v, -36000, 36000);
    const by = num(bs.find((x) => x.name === "animRot")?.node.attrs.by);
    return by !== undefined && by !== 0 ? clampN(by / 60000, -36000, 36000) : 360;
  };
  switch (known) {
    case 1:
      return { kind: "appear", class: klass };
    case 10:
      return { kind: "fade", class: klass };
    case 2: {
      const dir = fly ?? sub.dir;
      if (!dir) return { kind: "fly", class: klass, direction: "down", approx: "Fly" };
      return { kind: "fly", class: klass, direction: dir, ...(fly || sub.exact ? {} : { approx: "Fly from a side" }) };
    }
    case 22: {
      const dir = wipe ?? sub.dir;
      return { kind: "wipe", class: klass, direction: dir ?? "left", ...(wipe || sub.exact ? {} : { approx: "Wipe from a side" }) };
    }
    case 53:
      return { kind: "zoom", class: klass };
    case 31:
      return { kind: "spin", class: klass, amount: rotation() };
    default:
      break;
  }
  // a preset Pli does not have: by what its behaviours do
  if (fly && !sizes) return { kind: "fly", class: klass, direction: fly, approx: "Fly" };
  if (wipe) return { kind: "wipe", class: klass, direction: wipe, approx: "Wipe" };
  if (spinsOnEntry && sizes) return { kind: "spin", class: klass, amount: rotation(), approx: "Grow & Turn" };
  if (sizes) return { kind: "zoom", class: klass, approx: "Zoom" };
  if (bs.some((b) => b.name === "animEffect")) return { kind: "fade", class: klass, approx: "Fade" };
  if (bs.length > 0 && bs.every((b) => b.name === "set")) return { kind: "appear", class: klass, approx: "Appear" };
  return { kind: "fade", class: klass, approx: "Fade" };
}

const signature = (r: Raw): string => `${r.cls}|${r.id}|${r.subtype}|${r.node.attrs.repeatCount}|${r.node.attrs.accel}|${r.node.attrs.decel}|${r.spid}|${JSON.stringify(child(child(r.node, "stCondLst"), "cond")?.attrs ?? {})}|${r.behaviours.map((b) => b.ctn?.attrs.dur ?? "").join(",")}`;

/**
 * The animations of one slide: the main sequence of `p:timing` as Pli animations. Never throws on markup it does not
 * know: what it can't use is skipped and reported through `warn`.
 */
export function readTiming(timing: XmlElement, env: TimingReadEnv): Animation[] {
  const warn = env.warn;
  const tnLst = child(timing, "tnLst");
  const root = child(child(tnLst, "par"), "cTn");
  const seqs = elements(child(root, "childTnLst")).filter((e) => e.name === "seq");
  let main: XmlElement | undefined;
  let interactive = false;
  for (const s of seqs) {
    const nt = child(s, "cTn")?.attrs.nodeType;
    if (nt === "mainSeq" && !main) main = child(s, "cTn");
    else interactive = true;
  }
  if (interactive) warn("an animation started by clicking a shape was not imported");
  if (!main) return [];

  const raws: Raw[] = [];
  const state = { first: false, media: false };
  const outer = elements(child(main, "childTnLst")).filter((e) => e.name === "par" || e.name === "seq" || e.name === "excl");
  outer.forEach((o, i) => {
    state.first = true;
    collect(o, i, raws, 0, state);
  });
  if (raws.length >= MAX_EFFECTS) warn(`more than ${MAX_EFFECTS} animation effects; the rest were skipped`);
  if (state.media) warn("sounds and media commands in the animations were not imported");

  const out: Animation[] = [];
  for (let i = 0; i < raws.length; ) {
    const raw = raws[i]!;
    // the effects that are one paragraph at a time (the same effect, one paragraph after another)
    let run = [raw];
    if (raw.paras && raw.spid !== undefined) {
      const sig = signature(raw);
      let end = raw.paras.end;
      while (i + run.length < raws.length) {
        const nx = raws[i + run.length]!;
        if (!nx.paras || nx.spid !== raw.spid || signature(nx) !== sig || nx.paras.st !== end + 1) break;
        run.push(nx);
        end = nx.paras.end;
      }
    }
    i += run.length;

    const label = nameOf(raw.cls, raw.id);
    const target = raw.spid === undefined ? undefined : env.targets.get(raw.spid);
    if (!target) {
      if (raw.spid !== undefined && env.nested.has(raw.spid)) {
        const name = env.nested.get(raw.spid);
        warn(`the ${label} animation of ${name ? `"${name}"` : "a shape"} inside a group was not imported (only whole shapes of the slide can be animated)`);
      } else if (raw.spid !== undefined) warn(`the ${label} animation of a shape that is not on the slide was dropped`);
      else warn(`the ${label} animation does not point at a shape and was dropped`);
      continue;
    }
    const who = target.name ? `"${target.name}"` : "a shape";
    const mapped = mapEffect(raw, env, (m) => warn(`${m} (${who})`));
    if (!mapped) continue;
    if (mapped.approx) warn(`the ${label} animation of ${who} is not supported and was replaced by ${mapped.approx}`);
    if (raw.cls === undefined) warn(`an animation of ${who} had no preset and was read from what it does`);

    // text builds
    let text: "paragraph" | undefined;
    if (raw.partial) warn(`the ${label} animation of ${who} is for part of its content (letters, or a chart's series); the whole shape is animated`);
    if (raw.paras) {
      const first = run[0]!.paras!.st;
      const last = run[run.length - 1]!.paras!.end;
      const whole = first === 0 && last === target.paragraphs - 1;
      if (whole && (run.length > 1 || target.paragraphs === 1) && mapped.kind !== "motion") {
        text = "paragraph";
        if (run.some((r) => r.nodeType !== run[0]!.nodeType)) warn(`the ${label} animation of ${who} starts its paragraphs in different ways (such as the first on click and the rest after it); they all start like the first`);
      }
      else if (!whole) warn(`the ${label} animation of ${who} is for some paragraphs only; all of its text is animated`);
    }

    const bs = raw.behaviours;
    const ctn = raw.node;
    // trigger
    let trigger: AnimationTrigger = raw.nodeType === "withEffect" ? "withPrevious" : raw.nodeType === "afterEffect" ? "afterPrevious" : "onClick";
    if (raw.nodeType === undefined || !EFFECT_NODES.has(raw.nodeType)) trigger = raw.first ? "onClick" : "withPrevious";
    // the first effect of a later click step is what the click starts
    if (raw.first && raw.step !== raws[0]!.step) trigger = "onClick";
    // delay
    const cond = elements(child(ctn, "stCondLst")).find((c) => c.name === "cond" && num(c.attrs.delay) !== undefined && c.attrs.evt === undefined);
    const delay = clampN(num(cond?.attrs.delay) ?? 0, 0, MAX_MS);
    // duration
    let dur: number | undefined;
    for (const b of bs) {
      if (b.name === "set" || b.name === "audio" || b.name === "video" || b.name === "cmd") continue;
      const d = num(b.ctn?.attrs.dur);
      if (d !== undefined) dur = Math.max(dur ?? 0, d);
    }
    if (dur !== undefined && mapped.kind === "pulse" && bs.some((b) => b.ctn?.attrs.autoRev === "1" || b.ctn?.attrs.autoRev === "true")) dur *= 2;
    const duration = clampN(Math.round(dur ?? (mapped.kind === "appear" ? 0 : 500)), 0, MAX_MS);
    // repeat
    const rcRaw = ctn.attrs.repeatCount ?? bs.find((b) => b.name !== "set" && b.ctn?.attrs.repeatCount !== undefined)?.ctn?.attrs.repeatCount;
    let repeat: number | undefined;
    if (rcRaw === "indefinite") warn(`the ${label} animation of ${who} repeats until the end of the slide; it runs once`);
    else {
      const rc = num(rcRaw);
      if (rc !== undefined && rc > 1000) repeat = round3(clampN(rc / 1000, 1, MAX_REPEAT));
    }
    // easing
    const accel = (num(ctn.attrs.accel) ?? num(bs.find((b) => b.name !== "set")?.ctn?.attrs.accel) ?? 0) > 0;
    const decel = (num(ctn.attrs.decel) ?? num(bs.find((b) => b.name !== "set")?.ctn?.attrs.decel) ?? 0) > 0;
    const easing: AnimationEasing | undefined = accel && decel ? "easeInOut" : accel ? "easeIn" : decel ? "easeOut" : undefined;

    const input: AnimationInput = { target: target.id, kind: mapped.kind, class: mapped.class, trigger, duration };
    if (delay > 0) input.delay = delay;
    if (easing) input.easing = easing;
    if (repeat !== undefined) input.repeat = repeat;
    if (text) input.text = text;
    if (mapped.direction) input.direction = mapped.direction;
    if (mapped.amount !== undefined) input.amount = mapped.amount;
    if (mapped.path) input.path = mapped.path;
    const a = makeAnimation(input, newId("a_"));
    const problem = animationProblem(a);
    if (problem) {
      warn(`the ${label} animation of ${who} was dropped (${problem})`);
      continue;
    }
    out.push(a);
  }
  return out;
}
