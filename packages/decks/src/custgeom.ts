import type { PdfPathCommand } from "@pli.dev/docs";
import type { CustomCommand, CustomGeometry, CustomPath, GuideRef } from "./model";
import { Path, toSvg, type Cmd, type PresetPath, type PresetPdfPath, type PresetShade } from "./presets";

/*
 * Custom (freeform) geometry: PowerPoint's `custGeom` as plain JSON, turned into the same paths the presets give
 * (`customPath` and `customPdfPath` return the shapes `presetPath` and `presetPdfPath` do), so every renderer draws
 * them alike. Pure functions: points, origin top left, y down, never throwing on malformed input.
 *
 * Coordinates: each path has its own space (`w` by `h`) that is scaled to the element's box. Guides are evaluated
 * the way OOXML does, with the element's size in EMU (`w`, `h`, `wd2`, `ss`…) and angles in 60000ths of a degree; the
 * value of a guide used in a path is a coordinate in that path's space.
 */

const EMU = 12700;
const RAD = Math.PI / 180;
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

// ---- Guides ------------------------------------------------------------------------------------------------------

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const SIZED = /^(w|h|ss)d(\d+)$/;

/** The built-in guide names (everything but the `w`-`h`-`ss` divisions, which `SIZED` covers). */
const FIXED_NAMES = new Set(["l", "t", "r", "b", "w", "h", "hc", "vc", "ss", "ls", "cd2", "cd4", "cd8", "3cd4", "3cd8", "5cd8", "7cd8"]);

function builtin(name: string, wE: number, hE: number): number | undefined {
  switch (name) {
    case "l":
    case "t":
      return 0;
    case "r":
    case "w":
      return wE;
    case "b":
    case "h":
      return hE;
    case "hc":
      return wE / 2;
    case "vc":
      return hE / 2;
    case "ss":
      return Math.min(wE, hE);
    case "ls":
      return Math.max(wE, hE);
    case "cd2":
      return 10800000;
    case "cd4":
      return 5400000;
    case "cd8":
      return 2700000;
    case "3cd4":
      return 16200000;
    case "3cd8":
      return 8100000;
    case "5cd8":
      return 13500000;
    case "7cd8":
      return 18900000;
  }
  const m = SIZED.exec(name);
  if (m) {
    const n = Number(m[2]);
    if (n > 0) return (m[1] === "w" ? wE : m[1] === "h" ? hE : Math.min(wE, hE)) / n;
  }
  return undefined;
}

const toRad = (angle60k: number): number => (angle60k / 60000) * RAD;
const fromRad = (rad: number): number => (rad / RAD) * 60000;

/** Evaluates one OOXML formula (such as `+- w 0 x1`) given a way to read its operands. Unknown operators and bad arithmetic give 0. */
function formula(fmla: string, arg: (token: string) => number): number {
  const parts = fmla.trim().split(/\s+/);
  const op = parts[0] ?? "";
  const a = (i: number): number => (parts[i + 1] === undefined ? 0 : arg(parts[i + 1]!));
  let v: number;
  switch (op) {
    case "val":
      v = a(0);
      break;
    case "*/":
      v = a(2) === 0 ? 0 : (a(0) * a(1)) / a(2);
      break;
    case "+-":
      v = a(0) + a(1) - a(2);
      break;
    case "+/":
      v = a(2) === 0 ? 0 : (a(0) + a(1)) / a(2);
      break;
    case "?:":
      v = a(0) > 0 ? a(1) : a(2);
      break;
    case "abs":
      v = Math.abs(a(0));
      break;
    case "at2":
      v = fromRad(Math.atan2(a(1), a(0)));
      break;
    case "cat2":
      v = a(0) * Math.cos(Math.atan2(a(2), a(1)));
      break;
    case "sat2":
      v = a(0) * Math.sin(Math.atan2(a(2), a(1)));
      break;
    case "cos":
      v = a(0) * Math.cos(toRad(a(1)));
      break;
    case "sin":
      v = a(0) * Math.sin(toRad(a(1)));
      break;
    case "tan":
      v = a(0) * Math.tan(toRad(a(1)));
      break;
    case "max":
      v = Math.max(a(0), a(1));
      break;
    case "min":
      v = Math.min(a(0), a(1));
      break;
    case "mod":
      v = Math.sqrt(a(0) * a(0) + a(1) * a(1) + a(2) * a(2));
      break;
    case "pin":
      v = a(1) < a(0) ? a(0) : a(1) > a(2) ? a(2) : a(1);
      break;
    case "sqrt":
      v = Math.sqrt(Math.max(0, a(0)));
      break;
    default:
      v = 0;
  }
  return finite(v);
}

/** Looks up guides by name for an element of `w` by `h` points, evaluating formulas on demand (cycles read as 0). */
export function guideResolver(custom: CustomGeometry, w: number, h: number): (ref: GuideRef) => number {
  const wE = finite(w) * EMU;
  const hE = finite(h) * EMU;
  const defs = new Map<string, string>();
  for (const g of custom.guides ?? []) if (g && typeof g.name === "string" && typeof g.fmla === "string" && !defs.has(g.name)) defs.set(g.name, g.fmla);
  const memo = new Map<string, number>();
  const busy = new Set<string>();
  const byName = (name: string): number => {
    const adj = custom.adjust?.[name];
    if (typeof adj === "number" && Number.isFinite(adj)) return adj;
    const hit = memo.get(name);
    if (hit !== undefined) return hit;
    const fm = defs.get(name);
    if (fm === undefined) return finite(builtin(name, wE, hE) ?? 0);
    if (busy.has(name)) return 0;
    busy.add(name);
    const v = formula(fm, token);
    busy.delete(name);
    memo.set(name, v);
    return v;
  };
  const token = (t: string): number => (NUMBER.test(t) ? finite(Number(t)) : byName(t));
  return (ref) => (typeof ref === "number" ? finite(ref) : typeof ref === "string" ? byName(ref) : 0);
}

/** The guide names the geometry's commands and text rectangle use that nothing defines (a typo, or a file made by something odd). */
export function unresolvedGuides(custom: CustomGeometry): string[] {
  const known = (name: string): boolean =>
    NUMBER.test(name) || FIXED_NAMES.has(name) || (SIZED.test(name) && Number(SIZED.exec(name)![2]) > 0) || (custom.adjust !== undefined && name in custom.adjust) || (custom.guides ?? []).some((g) => g.name === name);
  const out = new Set<string>();
  const check = (ref: unknown) => {
    if (typeof ref === "string" && !known(ref)) out.add(ref);
  };
  for (const p of custom.paths) for (const c of p.commands) if (Array.isArray(c)) for (const ref of c.slice(1)) check(ref);
  if (custom.rect) for (const ref of [custom.rect.l, custom.rect.t, custom.rect.r, custom.rect.b]) check(ref);
  for (const g of custom.guides ?? []) for (const tok of g.fmla.trim().split(/\s+/).slice(1)) check(tok);
  return [...out];
}

// ---- Paths -------------------------------------------------------------------------------------------------------

interface Built {
  cmds: Cmd[];
  fill: boolean;
  stroke: boolean;
  evenOdd: boolean;
  shade?: PresetShade;
}

const SHADES: Record<string, PresetShade> = { lighten: "lighten", lightenLess: "lightenLess", darken: "darken", darkenLess: "darkenLess" };

function buildOne(p: CustomPath, w: number, h: number, ref: (r: GuideRef) => number): Built | undefined {
  if (!p || !Array.isArray(p.commands)) return undefined;
  // A path without a size of its own is drawn in the element's EMU space.
  const sx = p.w > 0 ? w / p.w : 1 / EMU;
  const sy = p.h > 0 ? h / p.h : 1 / EMU;
  const path = new Path((x, y) => [x * sx, y * sy]);
  let started = false;
  let moves = 0;
  for (const c of p.commands as readonly CustomCommand[]) {
    if (!Array.isArray(c)) continue;
    const r = (i: number): number => ref(c[i] as GuideRef);
    switch (c[0]) {
      case "M":
        path.M(r(1), r(2));
        started = true;
        moves++;
        break;
      case "L":
        if (started) path.L(r(1), r(2));
        break;
      case "C":
        if (started) path.C(r(1), r(2), r(3), r(4), r(5), r(6));
        break;
      case "Q":
        if (started) path.Q(r(1), r(2), r(3), r(4));
        break;
      case "A":
        // Angles that are guides are already in 60000ths, like the numbers.
        if (started) path.arcTo(r(1), r(2), r(3) / 60000, r(4) / 60000);
        break;
      case "Z":
        if (started) path.Z();
        break;
    }
  }
  if (path.cmds.length < 2) return undefined;
  const fillMode = p.fill ?? "norm";
  return { cmds: path.cmds, fill: fillMode !== "none", stroke: p.stroke !== false, evenOdd: moves > 1, shade: SHADES[fillMode] };
}

function build(custom: CustomGeometry | undefined, w: number, h: number): Built[] {
  const W = Math.max(0, finite(w));
  const H = Math.max(0, finite(h));
  const out: Built[] = [];
  if (custom && Array.isArray(custom.paths)) {
    const ref = guideResolver(custom, W, H);
    for (const p of custom.paths) {
      const b = buildOne(p, W, H, ref);
      if (b) out.push(b);
    }
  }
  // Nothing drawable (an empty or broken outline): fall back to the bounding box so the element still shows and clips.
  if (out.length === 0) out.push({ cmds: [["M", 0, 0], ["L", W, 0], ["L", W, H], ["L", 0, H], ["Z"]], fill: true, stroke: true, evenOdd: false });
  return out;
}

/** The outline in a box of `w` by `h` points, as SVG paths (the same shape `presetPath` returns). Never throws. */
export function customPath(custom: CustomGeometry, w: number, h: number): PresetPath[] {
  return build(custom, w, h).map((s) => {
    const out: PresetPath = { d: toSvg(s.cmds), fill: s.fill, stroke: s.stroke };
    if (s.evenOdd) out.evenOdd = true;
    if (s.shade) out.shade = s.shade;
    return out;
  });
}

/** The same outline as PDF path commands (the same shape `presetPdfPath` returns). */
export function customPdfPath(custom: CustomGeometry, w: number, h: number): PresetPdfPath[] {
  return build(custom, w, h).map((s) => {
    const out: PresetPdfPath = { commands: s.cmds.map((c) => [...c] as unknown as PdfPathCommand), fill: s.fill, stroke: s.stroke, evenOdd: s.evenOdd };
    if (s.shade) out.shade = s.shade;
    return out;
  });
}

/** The rectangle text goes in, in points: the geometry's `rect`, or the whole box. */
export function customTextRect(custom: CustomGeometry, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const W = Math.max(0, finite(w));
  const H = Math.max(0, finite(h));
  const r = custom?.rect;
  if (!r) return { x: 0, y: 0, w: W, h: H };
  const ref = guideResolver(custom, W, H);
  const at = (v: GuideRef, max: number): number => Math.min(max, Math.max(0, ref(v) / EMU));
  const x = at(r.l, W);
  const y = at(r.t, H);
  return { x, y, w: Math.max(0, at(r.r, W) - x), h: Math.max(0, at(r.b, H) - y) };
}

/** Whether any path of the geometry is open and unfilled (a line or curve), which decides how a renderer treats arrowheads. */
export function customIsOpen(custom: CustomGeometry): boolean {
  return custom.paths.length > 0 && custom.paths.every((p) => p.fill === "none");
}
