import type { Color, Theme, ThemeColor } from "./model";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** Reads `#rgb`, `#rrggbb` or `#rrggbbaa`. Anything else is black. */
export function parseHex(value: string): Rgba {
  let h = value.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/** `#rrggbb` (alpha is left out; use `rgbaCss` for it). */
export function toHex({ r, g, b }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function rgbaCss({ r, g, b, a }: Rgba): string {
  return a >= 1 ? toHex({ r, g, b, a }) : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
}

export function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number, a = 1): Rgba {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255, a };
}

/** A theme colour's own `#rrggbb`, before any adjustment. */
export function slotHex(theme: Theme, slot: ThemeColor["theme"]): string {
  return theme.colors[slot] ?? "#000000";
}

/** Applies a theme colour's lightness, tint, shade and opacity to a base colour. */
export function adjust(base: Rgba, c: Pick<ThemeColor, "lumMod" | "lumOff" | "tint" | "shade" | "alpha">): Rgba {
  let out = { ...base };
  if (c.lumMod !== undefined || c.lumOff !== undefined) {
    const [h, s, l] = rgbToHsl(out);
    out = hslToRgb(h, s, clamp01(l * (c.lumMod ?? 1) + (c.lumOff ?? 0)), out.a);
  }
  if (c.tint) out = { ...out, r: out.r + (255 - out.r) * c.tint, g: out.g + (255 - out.g) * c.tint, b: out.b + (255 - out.b) * c.tint };
  if (c.shade) out = { ...out, r: out.r * (1 - c.shade), g: out.g * (1 - c.shade), b: out.b * (1 - c.shade) };
  if (c.alpha !== undefined) out = { ...out, a: out.a * clamp01(c.alpha) };
  return out;
}

/** The colour a `Color` stands for under a theme. */
export function resolveColor(color: Color | undefined, theme: Theme, fallback = "#000000"): Rgba {
  if (color === undefined) return parseHex(fallback);
  if (typeof color === "string") return parseHex(color);
  return adjust(parseHex(slotHex(theme, color.theme)), color);
}

/** `#rrggbb` for a colour under a theme (opacity is dropped). */
export function resolveHex(color: Color | undefined, theme: Theme, fallback = "#000000"): string {
  return toHex(resolveColor(color, theme, fallback));
}

/** Black or white, whichever reads better on this colour. */
export function contrastOn(color: Rgba): "#000000" | "#ffffff" {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
  return lum > 0.4 ? "#000000" : "#ffffff";
}
