import type { ArrowEnd, Crop, DashStyle } from "@pli.dev/decks";
import { cssColor, type ResolvedFill } from "@pli.dev/decks";
import { fontStack as coreFontStack } from "@pli.dev/core";

/** Where the whole picture sits, in the shape's box, when `crop` of it is cut off (it overflows the box by the crop). */
export function cropBox(crop: Crop | undefined, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const l = clamp01(crop?.l ?? 0);
  const t = clamp01(crop?.t ?? 0);
  const r = clamp01(crop?.r ?? 0);
  const b = clamp01(crop?.b ?? 0);
  const kx = Math.max(0.01, 1 - l - r);
  const ky = Math.max(0.01, 1 - t - b);
  const fw = w / kx;
  const fh = h / ky;
  return { x: -l * fw, y: -t * fh, w: fw, h: fh };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** SVG stroke-dasharray for a dash style at a line width, in the unit of the width. */
export function dashArray(dash: DashStyle, width: number): string | undefined {
  const u = Math.max(width, 1);
  const pattern: Record<DashStyle, number[] | undefined> = {
    solid: undefined,
    dot: [1, 3],
    dash: [4, 3],
    dashDot: [4, 3, 1, 3],
    longDash: [8, 3],
    longDashDot: [8, 3, 1, 3],
    sysDot: [1, 1],
    sysDash: [3, 1],
  };
  const p = pattern[dash];
  return p ? p.map((n) => n * u).join(" ") : undefined;
}

/** The two ends of an objectBoundingBox gradient vector for a direction in degrees (0 runs left to right, clockwise). */
export function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a) / 2;
  const dy = Math.sin(a) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

/** CSS `background` for a resolved fill (pictures are drawn as elements, since they can be cropped). */
export function backgroundCss(fill: ResolvedFill): string | undefined {
  switch (fill.kind) {
    case "solid":
      return cssColor(fill.color, fill.alpha);
    case "gradient": {
      const stops = fill.stops.map((s) => `${cssColor(s.color, s.alpha)} ${Math.round(s.at * 1000) / 10}%`).join(", ");
      return fill.gradientKind === "radial" ? `radial-gradient(circle ${fill.center ? "farthest-corner" : "closest-side"} at ${fill.center ? `${Math.round(fill.center.x * 1000) / 10}% ${Math.round(fill.center.y * 1000) / 10}%` : "center"}, ${stops})` : `linear-gradient(${Math.round((fill.angle + 90) * 100) / 100}deg, ${stops})`;
    }
    default:
      return undefined;
  }
}

export interface MarkerSpec {
  id: string;
  end: ArrowEnd;
  color: string;
}

/** The path (in a 10 by 10 box, pointing right) and whether it is filled, for an arrowhead. */
export function arrowShape(end: ArrowEnd): { d: string; filled: boolean; refX: number } | null {
  switch (end) {
    case "triangle":
      return { d: "M0 0 L10 5 L0 10 Z", filled: true, refX: 8 };
    case "stealth":
      return { d: "M0 0 L10 5 L0 10 L3.5 5 Z", filled: true, refX: 7 };
    case "diamond":
      return { d: "M0 5 L5 0 L10 5 L5 10 Z", filled: true, refX: 5 };
    case "oval":
      return { d: "M5 0 A5 5 0 1 1 5 10 A5 5 0 1 1 5 0 Z", filled: true, refX: 5 };
    case "open":
      return { d: "M0 0 L10 5 L0 10", filled: false, refX: 9 };
    default:
      return null;
  }
}

/** Only these schemes become links; anything else (`javascript:`) is shown as plain text. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const h = href.trim();
  return /^(https?:|mailto:|tel:|#|\/)/i.test(h) ? h : undefined;
}

export const LINE_FACTOR = 1.2;

export function fontStack(family: string): string {
  return coreFontStack(family);
}
