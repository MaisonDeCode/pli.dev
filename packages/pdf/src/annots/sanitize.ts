/** Makes an annotation safe to write: finite numbers, boxes with a positive size, usable colours and dash patterns. What is fixed is not reported: the values were not meaningful. */
import type { Annotation, Pt, Rect, StrokeStyle } from "../model";

const fin = (n: unknown, fallback = 0): number => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const color = (c: unknown, fallback = "#000000"): string => (typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : fallback);
const pt = (p: Pt | undefined): Pt => [fin(p?.[0]), fin(p?.[1])];
const rect = (r: Rect): Rect => {
  let { x, y, w, h } = { x: fin(r?.x), y: fin(r?.y), w: fin(r?.w), h: fin(r?.h) };
  if (w < 0) (x += w), (w = -w);
  if (h < 0) (y += h), (h = -h);
  return { x, y, w, h };
};

function stroke(s: StrokeStyle | undefined): StrokeStyle {
  const dash = Array.isArray(s?.dash) ? s!.dash.map((d) => Math.max(0, fin(d))) : [];
  return { color: color(s?.color), width: Math.max(0, fin(s?.width)), ...(dash.length > 0 && dash.some((d) => d > 0) ? { dash } : {}) };
}

export function sanitize(a: Annotation): Annotation {
  const base = a.opacity === undefined ? {} : { opacity: Math.min(1, Math.max(0, fin(a.opacity, 1))) };
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
      return { ...a, ...base, color: color(a.color, "#ffeb3b"), rects: (a.rects ?? []).map(rect) };
    case "redact":
      return { ...a, ...base, rects: (a.rects ?? []).map(rect), ...(a.fill ? { fill: color(a.fill) } : {}) };
    case "ink":
      return { ...a, ...base, strokes: (a.strokes ?? []).map((s) => (s ?? []).map(pt)), stroke: stroke(a.stroke) };
    case "square":
    case "circle":
      return { ...a, ...base, rect: rect(a.rect), stroke: stroke(a.stroke), ...(a.fill ? { fill: color(a.fill) } : {}) };
    case "line":
      return { ...a, ...base, from: pt(a.from), to: pt(a.to), stroke: stroke(a.stroke) };
    case "polygon":
    case "polyline":
      return { ...a, ...base, points: (a.points ?? []).map(pt), stroke: stroke(a.stroke), ...(a.fill ? { fill: color(a.fill) } : {}) };
    case "freetext": {
      const size = fin(a.style?.size, 12);
      return {
        ...a,
        ...base,
        rect: rect(a.rect),
        text: typeof a.text === "string" ? a.text : "",
        style: { ...a.style, family: a.style?.family || "Helvetica", size: size > 0 ? size : 12, color: color(a.style?.color) },
        ...(a.fill ? { fill: color(a.fill) } : {}),
        ...(a.stroke ? { stroke: stroke(a.stroke) } : {}),
      };
    }
    case "note":
      return { ...a, ...base, x: fin(a.x), y: fin(a.y), ...(a.color ? { color: color(a.color, "#ffd600") } : {}) };
    case "stamp":
      return { ...a, ...base, rect: rect(a.rect), stamp: "picture" in a.stamp ? a.stamp : { ...a.stamp, name: a.stamp.name || "Draft", ...(a.stamp.color ? { color: color(a.stamp.color) } : {}) } };
    case "signature":
      return { ...a, ...base, rect: rect(a.rect), ...(a.strokes ? { strokes: a.strokes.map((s) => (s ?? []).map(pt)) } : {}), ...(a.color ? { color: color(a.color) } : {}), ...(a.width !== undefined ? { width: Math.max(0, fin(a.width, 2)) } : {}) };
    case "image":
    case "link":
      return { ...a, ...base, rect: rect(a.rect) };
  }
}
