import type { Rgba } from "./png";

/*
 * The pixel tools the artistic effects are built from: colour planes, blurs, edges, a pencil sketch, a painting filter and a
 * grain that is the same every time. Everything is plain TypeScript on `Rgba`, so it runs the same in a browser and in Node.
 */

export type Plane = Float32Array;

export const split = ({ width, height, data }: Rgba): Plane[] => {
  const n = width * height;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    out[0]![i] = data[i * 4]!;
    out[1]![i] = data[i * 4 + 1]!;
    out[2]![i] = data[i * 4 + 2]!;
  }
  return out;
};
export const gray = (p: Plane[]): Plane => {
  const out = new Float32Array(p[0]!.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * p[0]![i]! + 0.587 * p[1]![i]! + 0.114 * p[2]![i]!;
  return out;
};
/** The channels put back into a picture with the alpha of `like`. */
export const join = (like: Rgba, p: Plane[]): Rgba => {
  const data = new Uint8ClampedArray(like.data.length);
  for (let i = 0; i < like.width * like.height; i++) {
    data[i * 4] = p[0]![i]!;
    data[i * 4 + 1] = (p[1] ?? p[0]!)[i]!;
    data[i * 4 + 2] = (p[2] ?? p[0]!)[i]!;
    data[i * 4 + 3] = like.data[i * 4 + 3]!;
  }
  return { width: like.width, height: like.height, data };
};
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One box blur of a plane, `r` pixels each way (the edge pixel is repeated beyond the edge). */
export function boxPass(src: Plane, w: number, h: number, r: number): Plane {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = (r + 1) * src[row]!;
    for (let i = 1; i <= r; i++) sum += src[row + Math.min(i, w - 1)]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(x + r + 1, w - 1)]! - src[row + Math.max(x - r, 0)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = (r + 1) * tmp[x]!;
    for (let i = 1; i <= r; i++) sum += tmp[Math.min(i, h - 1) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(y + r + 1, h - 1) * w + x]! - tmp[Math.max(y - r, 0) * w + x]!;
    }
  }
  return out;
}
/** Three box blurs make a smooth blur of about `radius` pixels. */
export function blurPlane(p: Plane, w: number, h: number, radius: number): Plane {
  if (radius < 1) return p;
  const r = Math.max(1, Math.round(radius / 1.7));
  return boxPass(boxPass(boxPass(p, w, h, r), w, h, r), w, h, r);
}

/** How steep the picture is at each pixel (Sobel), 0 for flat up to about 1020 for black beside white. */
export function edges(p: Plane, w: number, h: number): Plane {
  const out = new Float32Array(p.length);
  const at = (x: number, y: number) => p[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Pencil: the picture dodged by a blurred negative of itself, which leaves only its outlines, dark on white. */
export function sketch(g: Plane, w: number, h: number, size: number): Plane {
  const inv = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) inv[i] = 255 - g[i]!;
  const b = blurPlane(inv, w, h, Math.max(1, (size / 100) * (Math.max(w, h) / 12)));
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.min(255, (g[i]! * 255) / Math.max(1, 255 - b[i]!));
  return out;
}

/** Paint: each pixel takes the average colour of whichever of the four squares round it is the smoothest (the Kuwahara filter). */
export function paint(r: Rgba, radius: number): Rgba {
  const { width: w, height: h } = r;
  const stride = w + 1;
  const chans = split(r);
  const lum = gray(chans);
  const sat = (f: (i: number) => number) => {
    const t = new Float64Array(stride * (h + 1));
    for (let y = 1; y <= h; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) {
        row += f((y - 1) * w + x - 1);
        t[y * stride + x] = t[(y - 1) * stride + x]! + row;
      }
    }
    return t;
  };
  const sr = sat((i) => chans[0]![i]!);
  const sg = sat((i) => chans[1]![i]!);
  const sb = sat((i) => chans[2]![i]!);
  const sl = sat((i) => lum[i]!);
  const sl2 = sat((i) => lum[i]! * lum[i]!);
  const box = (t: Float64Array, x0: number, y0: number, x1: number, y1: number) => t[(y1 + 1) * stride + x1 + 1]! - t[y0 * stride + x1 + 1]! - t[(y1 + 1) * stride + x0]! + t[y0 * stride + x0]!;
  const out: Plane[] = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - radius);
        const x1 = q & 1 ? Math.min(w - 1, x + radius) : x;
        const y0 = q & 2 ? y : Math.max(0, y - radius);
        const y1 = q & 2 ? Math.min(h - 1, y + radius) : y;
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = box(sl, x0, y0, x1, y1) / n;
        const variance = box(sl2, x0, y0, x1, y1) / n - m * m;
        if (variance < best) {
          best = variance;
          out[0]![y * w + x] = box(sr, x0, y0, x1, y1) / n;
          out[1]![y * w + x] = box(sg, x0, y0, x1, y1) / n;
          out[2]![y * w + x] = box(sb, x0, y0, x1, y1) / n;
        }
      }
    }
  }
  return join(r, out);
}

/** A number from 0 up to 1 for a spot, always the same for the same spot: the grain of a film. */
export function grain(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
