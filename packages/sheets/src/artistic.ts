import { blurPlane, boxPass, clamp01, edges, grain, gray, join, paint, sketch, split, type Plane } from "./artistic-kit";
import { applyMoreArtistic } from "./artistic-more";
import { artisticLevel } from "./image-effects";
import type { ImageArtistic } from "./model";
import { decodeImage } from "./pixels";
import { encodePng, type Rgba } from "./png";

/*
 * Artistic effects, computed on the picture's own pixels in plain TypeScript (no canvas), so that the grid, a copy and an
 * .xlsx file all show the same picture, in a browser and in Node. They are Pli's own versions of Excel's effects of the same
 * names: close in spirit, not the same pixel for pixel. Alpha is never changed.
 */

/** The longest side, in pixels, a picture is worked at: a bigger one is scaled down first, so an effect costs about the same whatever the picture's size. */
export const MAX_ARTISTIC_SIDE = 1200;

/** The picture scaled down (by averaging) until neither side is longer than `side`; the picture itself when it is small enough. */
export function scaleDown(r: Rgba, side = MAX_ARTISTIC_SIDE): Rgba {
  const k = Math.max(r.width, r.height) / side;
  if (k <= 1) return r;
  const w = Math.max(1, Math.round(r.width / k));
  const h = Math.max(1, Math.round(r.height / k));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * r.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * r.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * r.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * r.width) / w));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * r.width + xx) * 4;
          sr += r.data[o]!; sg += r.data[o + 1]!; sb += r.data[o + 2]!; sa += r.data[o + 3]!;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      data[o] = sr / n; data[o + 1] = sg / n; data[o + 2] = sb / n; data[o + 3] = sa / n;
    }
  }
  return { width: w, height: h, data };
}


/** The picture with an artistic effect applied; the same size, and the same alpha. The picture given is not changed. */
export function applyArtistic(r: Rgba, artistic: ImageArtistic): Rgba {
  const { width: w, height: h } = r;
  const level = artisticLevel(artistic);
  const long = Math.max(w, h);
  const n = w * h;
  switch (artistic.kind) {
    case "marker":
    case "chalkSketch":
    case "cement":
    case "crisscrossEtching":
    case "lightScreen":
    case "pastelsSmooth":
    case "plasticWrap":
    case "texturizer":
    case "watercolorSponge":
    case "paintStrokes":
      return applyMoreArtistic(r, artistic.kind, level);
    case "blur": {
      const radius = Math.max(1, (level * long) / 600);
      return join(r, split(r).map((p) => blurPlane(p, w, h, radius)));
    }
    case "pencilGrayscale": {
      const g = gray(split(r));
      const s = sketch(g, w, h, level);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = 0.55 * s[i]! + 0.45 * g[i]!;
      return join(r, [out]);
    }
    case "pencilSketch": {
      const s = sketch(gray(split(r)), w, h, 10);
      const gamma = 1 + level / 40;
      for (let i = 0; i < n; i++) s[i] = 255 * Math.pow(clamp01(s[i]! / 255), gamma);
      return join(r, [s]);
    }
    case "mosaic": {
      const block = Math.max(2, Math.round((level * long) / 2000));
      const data = new Uint8ClampedArray(r.data.length);
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          const sum = [0, 0, 0, 0];
          let count = 0;
          const ye = Math.min(h, by + block);
          const xe = Math.min(w, bx + block);
          for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++, count++) for (let c = 0; c < 4; c++) sum[c]! += r.data[(y * w + x) * 4 + c]!;
          for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = c === 3 ? r.data[(y * w + x) * 4 + 3]! : sum[c]! / count;
        }
      }
      return { width: w, height: h, data };
    }
    case "glass": {
      // Small square lenses: each shows its own middle turned over and smaller, with a dark joint between lenses.
      const tile = Math.max(4, Math.round((level * long) / 1000));
      const data = new Uint8ClampedArray(r.data.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cx = (Math.floor(x / tile) + 0.5) * tile;
          const cy = (Math.floor(y / tile) + 0.5) * tile;
          const sx = Math.min(w - 1, Math.max(0, Math.round(cx - (x - cx) * 0.6)));
          const sy = Math.min(h - 1, Math.max(0, Math.round(cy - (y - cy) * 0.6)));
          const joint = x % tile === 0 || y % tile === 0 ? 0.8 : 1;
          const o = (y * w + x) * 4;
          const s = (sy * w + sx) * 4;
          data[o] = r.data[s]! * joint;
          data[o + 1] = r.data[s + 1]! * joint;
          data[o + 2] = r.data[s + 2]! * joint;
          data[o + 3] = r.data[o + 3]!;
        }
      }
      return { width: w, height: h, data };
    }
    case "paintBrush":
      return paint(r, Math.min(25, Math.max(1, Math.round((level * long) / 300))));
    case "cutout": {
      // Few flat shades: a light blur to lose the detail, then each channel kept to `level + 1` values.
      const steps = level + 1;
      return join(r, split(r).map((p) => {
        const b = boxPass(p, w, h, 1);
        for (let i = 0; i < b.length; i++) b[i] = (Math.round((b[i]! / 255) * (steps - 1)) * 255) / (steps - 1);
        return b;
      }));
    }
    case "filmGrain": {
      const cell = 1 + Math.floor(level / 40);
      const amount = 10 + level * 0.7;
      const p = split(r);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = (grain(Math.floor(x / cell), Math.floor(y / cell)) - 0.5) * 2 * amount;
          for (const c of p) c[y * w + x]! += d;
        }
      }
      return join(r, p);
    }
    case "photocopy": {
      const g = gray(split(r));
      const e = edges(boxPass(g, w, h, 1), w, h);
      const gain = 0.5 + level / 50;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const dark = 1 - g[i]! / 255;
        const score = 0.5 * clamp01((e[i]! / 306) * gain) + 0.5 * Math.pow(dark, 1.5);
        out[i] = 255 * (1 - clamp01((score - 0.25) / 0.2) * 0.9);
      }
      return join(r, [out]);
    }
    case "glowDiffused": {
      const radius = (level * long) / 150;
      const p = split(r);
      return join(r, p.map((c) => {
        const b = blurPlane(c, w, h, radius);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = 0.5 * c[i]! + 0.5 * (255 - ((255 - c[i]!) * (255 - b[i]!)) / 255);
        return out;
      }));
    }
    case "glowEdges": {
      const radius = (level * long) / 400;
      return join(r, split(r).map((c) => {
        const e = edges(blurPlane(c, w, h, radius), w, h);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = Math.min(255, e[i]! * (1.2 + 3 / level));
        return boxPass(out, w, h, 1);
      }));
    }
    case "lineDrawing": {
      const g = boxPass(gray(split(r)), w, h, 1);
      const e = edges(g, w, h);
      let ink: Plane = new Float32Array(n);
      for (let i = 0; i < n; i++) ink[i] = e[i]! > 80 ? 255 : 0;
      const thick = Math.max(0, Math.round(level / 3));
      if (thick) {
        ink = boxPass(ink, w, h, thick);
        for (let i = 0; i < n; i++) ink[i] = ink[i]! > 20 ? 255 : 0;
      }
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = 255 - ink[i]!;
      return join(r, [out]);
    }
  }
}

/** A PNG, JPEG or GIF with an artistic effect applied (worked at most `MAX_ARTISTIC_SIDE` pixels on a side), as the bytes of a new PNG. Null when the bytes aren't a picture of those kinds that this can read. */
export function artisticPng(bytes: Uint8Array, artistic: ImageArtistic): Uint8Array | null {
  const decoded = decodeImage(bytes);
  if (!decoded) return null;
  return encodePng(applyArtistic(scaleDown(decoded), artistic));
}
