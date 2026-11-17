import { PliError } from "@pli.dev/core";
import type { ArtisticKind, ImageArtistic, ImageGlow, ImageReflection } from "./model";

/*
 * A picture's glow, soft edges, reflection and artistic effect: what they may be, and the checks that keep them to that.
 * (How they are drawn is in the grid, in `artistic.ts` for the pixels and in `xlsx-image.ts` for the file.)
 */

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The farthest a glow reaches, the widest soft edge, and the greatest blur and distance of a reflection, in pixels. */
export const MAX_EFFECT_REACH = 100;
export const DEFAULT_GLOW = { color: "#4472c4", radius: 10, opacity: 0.4 } as const;
export const DEFAULT_REFLECTION = { blur: 0.5, startOpacity: 0.5, endOpacity: 0, distance: 0, size: 0.5 } as const;

/** A glow made ready to keep; each part that is the usual one is left out. */
export function cleanGlow(glow: ImageGlow): ImageGlow {
  if (!glow || typeof glow !== "object") return bad("A picture's glow says how it looks");
  const out: ImageGlow = {};
  if (glow.color !== undefined) {
    if (typeof glow.color !== "string" || !HEX.test(glow.color)) bad("A picture's glow colour is like #rrggbb");
    if (glow.color.toLowerCase() !== DEFAULT_GLOW.color) out.color = glow.color.toLowerCase();
  }
  if (glow.radius !== undefined) {
    if (typeof glow.radius !== "number" || !(glow.radius >= 0 && glow.radius <= MAX_EFFECT_REACH)) bad(`A picture's glow reaches 0 to ${MAX_EFFECT_REACH} pixels`);
    if (glow.radius !== DEFAULT_GLOW.radius) out.radius = glow.radius;
  }
  if (glow.opacity !== undefined) {
    if (typeof glow.opacity !== "number" || !(glow.opacity >= 0 && glow.opacity <= 1)) bad("A picture's glow opacity is 0 to 1");
    if (glow.opacity !== DEFAULT_GLOW.opacity) out.opacity = glow.opacity;
  }
  return out;
}

/** Soft edges made ready to keep: a number of pixels, more than 0. Null when it is 0 (nothing to soften). */
export function cleanSoftEdge(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_EFFECT_REACH) return bad(`A picture's soft edges are 0 to ${MAX_EFFECT_REACH} pixels`);
  return value > 0 ? Math.round(value * 100) / 100 : null;
}

/** A reflection made ready to keep; each part that is the usual one is left out. */
export function cleanReflection(reflection: ImageReflection): ImageReflection {
  if (!reflection || typeof reflection !== "object") return bad("A picture's reflection says how it looks");
  const out: ImageReflection = {};
  const num = (k: "blur" | "distance" | "startOpacity" | "endOpacity" | "size", lo: number, hi: number, what: string) => {
    const v = reflection[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) bad(`A picture's reflection ${what} is ${lo} to ${hi}`);
    if (v !== DEFAULT_REFLECTION[k]) out[k] = v;
  };
  num("blur", 0, 50, "blur");
  num("startOpacity", 0, 1, "start opacity");
  num("endOpacity", 0, 1, "end opacity");
  num("distance", 0, MAX_EFFECT_REACH, "distance");
  num("size", 0.01, 1, "size");
  return out;
}

/** The artistic effects Pli draws: what Excel calls them, the element and attribute that hold them in a file, and the range of `level` (which is the attribute's number). */
export const ARTISTIC: Record<ArtisticKind, { label: string; element: string; attribute: string; min: number; max: number; usual: number }> = {
  blur: { label: "Blur", element: "artisticBlur", attribute: "radius", min: 1, max: 100, usual: 10 },
  pencilGrayscale: { label: "Pencil grayscale", element: "artisticPencilGrayscale", attribute: "pencilSize", min: 1, max: 100, usual: 10 },
  pencilSketch: { label: "Pencil sketch", element: "artisticPencilSketch", attribute: "pressure", min: 1, max: 100, usual: 25 },
  mosaic: { label: "Mosaic", element: "artisticMosiaicBubbles", attribute: "spacing", min: 1, max: 100, usual: 50 },
  glass: { label: "Glass", element: "artisticGlass", attribute: "scaling", min: 1, max: 100, usual: 25 },
  paintBrush: { label: "Paint brush", element: "artisticPaintBrush", attribute: "brushSize", min: 1, max: 10, usual: 5 },
  cutout: { label: "Cutout", element: "artisticCutout", attribute: "numberOfShades", min: 1, max: 6, usual: 3 },
  filmGrain: { label: "Film grain", element: "artisticFilmGrain", attribute: "grainSize", min: 1, max: 100, usual: 50 },
  photocopy: { label: "Photocopy", element: "artisticPhotocopy", attribute: "pressure", min: 1, max: 100, usual: 50 },
  glowDiffused: { label: "Glow diffused", element: "artisticGlowDiffused", attribute: "intensity", min: 1, max: 10, usual: 5 },
  glowEdges: { label: "Glow edges", element: "artisticGlowEdges", attribute: "smoothness", min: 1, max: 10, usual: 5 },
  lineDrawing: { label: "Line drawing", element: "artisticLineDrawing", attribute: "pencilSize", min: 1, max: 10, usual: 5 },
  marker: { label: "Marker", element: "artisticMarker", attribute: "size", min: 1, max: 100, usual: 20 },
  chalkSketch: { label: "Chalk sketch", element: "artisticChalkSketch", attribute: "pressure", min: 1, max: 100, usual: 25 },
  cement: { label: "Cement", element: "artisticCement", attribute: "crackSpacing", min: 1, max: 100, usual: 25 },
  crisscrossEtching: { label: "Crisscross etching", element: "artisticCrisscrossEtching", attribute: "pressure", min: 1, max: 100, usual: 50 },
  lightScreen: { label: "Light screen", element: "artisticLightScreen", attribute: "gridSize", min: 1, max: 100, usual: 25 },
  pastelsSmooth: { label: "Pastels smooth", element: "artisticPastelsSmooth", attribute: "scaling", min: 1, max: 100, usual: 10 },
  plasticWrap: { label: "Plastic wrap", element: "artisticPlasticWrap", attribute: "smoothness", min: 1, max: 10, usual: 5 },
  texturizer: { label: "Texturizer", element: "artisticTexturizer", attribute: "scaling", min: 1, max: 100, usual: 50 },
  watercolorSponge: { label: "Watercolor sponge", element: "artisticWatercolorSponge", attribute: "brushSize", min: 1, max: 10, usual: 5 },
  paintStrokes: { label: "Paint strokes", element: "artisticPaintStrokes", attribute: "intensity", min: 1, max: 10, usual: 5 },
};
export const ARTISTIC_KINDS = Object.keys(ARTISTIC) as ArtisticKind[];

/** An artistic effect made ready to keep: `level` is a whole number in the effect's range, and is left out when it is the usual one. */
export function cleanArtistic(artistic: ImageArtistic): ImageArtistic {
  if (!artistic || typeof artistic !== "object" || !ARTISTIC_KINDS.includes(artistic.kind)) return bad(`A picture's artistic effect is one of ${ARTISTIC_KINDS.join(", ")}`);
  const range = ARTISTIC[artistic.kind];
  const out: ImageArtistic = { kind: artistic.kind };
  if (artistic.level !== undefined) {
    if (typeof artistic.level !== "number" || !Number.isInteger(artistic.level) || artistic.level < range.min || artistic.level > range.max) bad(`The level of "${artistic.kind}" is a whole number from ${range.min} to ${range.max}`);
    if (artistic.level !== range.usual) out.level = artistic.level;
  }
  return out;
}

/** How strong an artistic effect is: its `level`, or the usual one. */
export const artisticLevel = (a: ImageArtistic): number => a.level ?? ARTISTIC[a.kind].usual;
