import { blurPlane, boxPass, clamp01, edges, grain, gray, join, paint, sketch, split, type Plane } from "./artistic-kit";
import type { ArtisticKind } from "./model";
import type { Rgba } from "./png";

/*
 * The other ten of Excel's artistic effects: Marker, Chalk Sketch, Cement, Crisscross Etching, Light Screen, Pastels Smooth,
 * Plastic Wrap, Texturizer, Watercolor Sponge and Paint Strokes. Like the first twelve (`artistic.ts`) these are Pli's own
 * versions, close in spirit to Excel's and not pixel for pixel, worked in plain TypeScript and the same every time (the
 * textures come from a fixed noise, never from a random number). Alpha is never changed. Sizes follow the picture's longest
 * side, so an effect looks alike on a small picture and a big one.
 */

/** Smooth noise from 0 up to 1 as a plane: values at the points of a lattice `cell` pixels apart, blended smoothly between; always the same for the same `seed`. */
function noisePlane(w: number, h: number, cell: number, seed: number): Plane {
  const nx = Math.ceil(w / cell) + 2;
  const ny = Math.ceil(h / cell) + 2;
  const lattice = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lattice[j * nx + i] = grain(i + seed * 131, j + seed * 71);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const o = y0 * nx + x0;
      const top = lattice[o]! * (1 - sx) + lattice[o + 1]! * sx;
      const bottom = lattice[o + nx]! * (1 - sx) + lattice[o + nx + 1]! * sx;
      out[y * w + x] = top * (1 - sy) + bottom * sy;
    }
  }
  return out;
}

/** Three layers of `noisePlane`, each half the size and half as strong as the one before; from 0 up to 1. */
function fbmPlane(w: number, h: number, cell: number, seed: number): Plane {
  const a = noisePlane(w, h, cell, seed);
  const b = noisePlane(w, h, Math.max(1, cell / 2), seed + 1);
  const c = noisePlane(w, h, Math.max(1, cell / 4), seed + 2);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! * 4 + b[i]! * 2 + c[i]!) / 7;
  return a;
}

/** A plane made by working out each pixel from where it is. */
function fromSpot(w: number, h: number, f: (x: number, y: number) => number): Plane {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = f(x, y);
  return out;
}

/** The colours of a picture pushed away from (`k` above 1) or towards (below 1) their grey. */
function saturate(p: Plane[], k: number): Plane[] {
  const g = gray(p);
  return p.map((c) => {
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = g[i]! + (c[i]! - g[i]!) * k;
    return out;
  });
}

/** Each channel of every pixel worked out by `f` from its value, the pixel's place and the channel's number. */
const eachPixel = (p: Plane[], f: (v: number, i: number, channel: number) => number): Plane[] =>
  p.map((c, k) => {
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = f(c[i]!, i, k);
    return out;
  });

/** The slope of a plane going down and to the right, for lighting it from the top left: positive where it faces the light. */
function slope(p: Plane, w: number, h: number): { gx: Plane; gy: Plane } {
  const gx = new Float32Array(p.length);
  const gy = new Float32Array(p.length);
  const at = (x: number, y: number) => p[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      gx[y * w + x] = (at(x + 1, y) - at(x - 1, y)) / 2;
      gy[y * w + x] = (at(x, y + 1) - at(x, y - 1)) / 2;
    }
  }
  return { gx, gy };
}

export function applyMoreArtistic(r: Rgba, kind: ArtisticKind, level: number): Rgba {
  const { width: w, height: h } = r;
  const long = Math.max(w, h);
  const n = w * h;
  const unit = Math.max(1, long / 600);
  switch (kind) {
    case "marker": {
      // Flat bold colour, a little more colourful, with a thick dark outline where the picture changes.
      const flat = paint(r, Math.max(1, Math.min(10, Math.round((level * long) / 2500) + 1)));
      const p = saturate(split(flat), 1.35);
      const g = boxPass(gray(split(flat)), w, h, 1);
      const e = edges(g, w, h);
      let ink: Plane = fromSpot(w, h, (x, y) => (e[y * w + x]! > 70 ? 255 : 0));
      const thick = Math.max(1, Math.round((level * long) / 1800));
      ink = boxPass(ink, w, h, thick);
      return join(r, eachPixel(p, (v, i) => v * (1 - 0.7 * clamp01(ink[i]! / 128)) * 0.95));
    }
    case "chalkSketch": {
      // Dark strokes where the picture has outlines and shadow, on pale grey paper, with the broken look of chalk.
      const g = gray(split(r));
      const s = sketch(g, w, h, 20);
      const gain = 0.8 + level / 40;
      const roughness = fbmPlane(w, h, 2 * unit, 5);
      const out = fromSpot(w, h, (x, y) => {
        const i = y * w + x;
        const dark = clamp01(((255 - s[i]!) / 255) * gain + (1 - g[i]! / 255) * 0.25);
        return 244 - 215 * clamp01(dark * (0.55 + 0.9 * roughness[i]!));
      });
      return join(r, [out]);
    }
    case "cement": {
      // The picture's tones on rough grey concrete: a fine mottled surface, lit from the top left, with a few cracks.
      const cell = Math.max(3, (level * long) / 250 + 3);
      const g = gray(split(r));
      const bumps = fbmPlane(w, h, cell, 11);
      const faults = fbmPlane(w, h, cell * 5, 23);
      const { gx, gy } = slope(bumps, w, h);
      const c = split(r);
      const mid = fromSpot(w, h, (x, y) => {
        const i = y * w + x;
        const crack = Math.abs(faults[i]! - 0.5) < 0.005 ? 0.55 : 1;
        const lit = 1 + (-gx[i]! - gy[i]!) * 9;
        return crack * lit * (0.62 + 0.38 * bumps[i]!);
      });
      return join(r, eachPixel(c, (v, i) => {
        const tone = 0.45 * v + 0.55 * g[i]!;
        return Math.min(255, (0.3 * v + 0.7 * tone) * 0.5 * mid[i]! + 95 * mid[i]!);
      }));
    }
    case "crisscrossEtching": {
      // Black lines on white: the darker the picture, the more directions the lines cross in.
      const g = boxPass(gray(split(r)), w, h, 1);
      const gap = Math.max(3, Math.round(long / 180));
      const gain = 0.6 + level / 100;
      const out = fromSpot(w, h, (x, y) => {
        const dark = (1 - g[y * w + x]! / 255) * gain;
        const line = (a: number) => ((a % gap) + gap) % gap === 0;
        let ink = dark > 0.18 && line(x + y);
        if (dark > 0.4 && line(x - y)) ink = true;
        if (dark > 0.62 && line(x)) ink = true;
        if (dark > 0.82 && line(y)) ink = true;
        return ink ? 25 : 250;
      });
      return join(r, [out]);
    }
    case "lightScreen": {
      // A screen of small lit squares: each shows the colour of the part of the picture behind it, brighter in the middle, dark between.
      const cell = Math.max(4, Math.round((level * long) / 1200) + 3);
      const data = new Uint8ClampedArray(r.data.length);
      for (let by = 0; by < h; by += cell) {
        for (let bx = 0; bx < w; bx += cell) {
          const sum = [0, 0, 0];
          let count = 0;
          const ye = Math.min(h, by + cell);
          const xe = Math.min(w, bx + cell);
          for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++, count++) for (let c = 0; c < 3; c++) sum[c]! += r.data[(y * w + x) * 4 + c]!;
          for (let y = by; y < ye; y++) {
            for (let x = bx; x < xe; x++) {
              const o = (y * w + x) * 4;
              const dx = (x - bx + 0.5) / cell - 0.5;
              const dy = (y - by + 0.5) / cell - 0.5;
              const lit = 1.35 - 1.5 * (dx * dx + dy * dy);
              const joint = x === bx || y === by ? 0.2 : 1;
              for (let c = 0; c < 3; c++) data[o + c] = (sum[c]! / count) * lit * joint;
              data[o + 3] = r.data[o + 3]!;
            }
          }
        }
      }
      return { width: w, height: h, data };
    }
    case "pastelsSmooth": {
      // Soft, chalky colours: smoothed, a little paler, with the grain of the paper showing through.
      const smooth = paint(r, Math.max(1, Math.min(8, Math.round((level * long) / 1500) + 1)));
      const p = saturate(split(smooth), 0.8);
      const b = p.map((c) => blurPlane(c, w, h, unit));
      const grainy = fbmPlane(w, h, 1.5 * unit, 7);
      return join(r, eachPixel(b, (v, i) => (v * 0.86 + 255 * 0.14) * (0.9 + 0.2 * grainy[i]!)));
    }
    case "plasticWrap": {
      // The picture under shiny film: bright specks and streaks where a blurred copy of it slopes towards the light.
      const g = gray(split(r));
      const hgt = blurPlane(g, w, h, (level * long) / 140);
      const { gx, gy } = slope(hgt, w, h);
      const k = 0.07 + 0.015 * level;
      const light = [-0.45, -0.55, 0.7];
      const norm = Math.hypot(light[0]!, light[1]!, light[2]!);
      const half = [light[0]! / norm, light[1]! / norm, (light[2]! + norm) / norm];
      const halfLen = Math.hypot(half[0]!, half[1]!, half[2]!);
      const shine = fromSpot(w, h, (x, y) => {
        const i = y * w + x;
        const nx = -gx[i]! * k;
        const ny = -gy[i]! * k;
        const len = Math.hypot(nx, ny, 1);
        const d = (nx * half[0]! + ny * half[1]! + half[2]!) / (len * halfLen);
        return Math.pow(Math.max(0, d), 70);
      });
      const diffuse = fromSpot(w, h, (x, y) => {
        const i = y * w + x;
        const nx = -gx[i]! * k;
        const ny = -gy[i]! * k;
        return 0.85 + 0.25 * ((nx * light[0]! + ny * light[1]! + light[2]!) / (Math.hypot(nx, ny, 1) * norm));
      });
      return join(r, eachPixel(saturate(split(r), 1.1), (v, i) => v * diffuse[i]! + 255 * 0.95 * shine[i]!));
    }
    case "texturizer": {
      // The picture printed on rough canvas: a woven texture lit from the top left.
      const cell = Math.max(3, (level * long) / 900 + 3);
      const rough = fbmPlane(w, h, cell, 3);
      const weave = fromSpot(w, h, (x, y) => {
        const a = Math.sin((2 * Math.PI * x) / cell);
        const b = Math.sin((2 * Math.PI * y) / cell);
        return 0.5 * (a * Math.cos((2 * Math.PI * y) / (cell * 2)) + b * Math.cos((2 * Math.PI * x) / (cell * 2))) + 0.35 * (rough[y * w + x]! - 0.5);
      });
      const { gx, gy } = slope(weave, w, h);
      return join(r, eachPixel(split(r), (v, i) => v * (0.88 + (-gx[i]! - gy[i]!) * 0.5)));
    }
    case "watercolorSponge": {
      // Washes of colour: the picture moved about a little by a slow wobble, smoothed, brighter, pale where the sponge lifted paint and dark along the edges of the washes.
      const brush = level;
      const amp = (brush * long) / 220;
      const wobble = Math.max(4, long / 40);
      const moved = new Uint8ClampedArray(r.data.length);
      const wobbleX = fbmPlane(w, h, wobble, 31);
      const wobbleY = fbmPlane(w, h, wobble, 37);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.min(w - 1, Math.max(0, Math.round(x + (wobbleX[y * w + x]! - 0.5) * 2 * amp)));
          const sy = Math.min(h - 1, Math.max(0, Math.round(y + (wobbleY[y * w + x]! - 0.5) * 2 * amp)));
          const o = (y * w + x) * 4;
          const s = (sy * w + sx) * 4;
          moved[o] = r.data[s]!; moved[o + 1] = r.data[s + 1]!; moved[o + 2] = r.data[s + 2]!; moved[o + 3] = r.data[o + 3]!;
        }
      }
      const smooth = paint({ width: w, height: h, data: moved }, Math.max(1, Math.min(8, Math.round((brush * long) / 700) + 1)));
      const p = saturate(split(smooth), 1.25);
      const e = edges(boxPass(gray(p), w, h, 1), w, h);
      const sponge = fbmPlane(w, h, Math.max(3, long / 90), 41);
      return join(r, eachPixel(p, (v, i) => {
        const lifted = clamp01((sponge[i]! - 0.64) * 3.5);
        const edge = clamp01(e[i]! / 400);
        return (v * (1 - 0.35 * edge) * (1 - lifted * 0.55) + 255 * lifted * 0.55) * 1.04;
      }));
    }
    case "paintStrokes": {
      // Strokes of paint: each pixel is the average of the picture along a short line that runs the way the picture's edges do.
      const g = blurPlane(gray(split(r)), w, h, unit * 1.5);
      const { gx, gy } = slope(g, w, h);
      const sxx = new Float32Array(n);
      const syy = new Float32Array(n);
      const sxy = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        sxx[i] = gx[i]! * gx[i]!;
        syy[i] = gy[i]! * gy[i]!;
        sxy[i] = gx[i]! * gy[i]!;
      }
      const reach = Math.max(2, unit * 5);
      const bxx = blurPlane(sxx, w, h, reach);
      const byy = blurPlane(syy, w, h, reach);
      const bxy = blurPlane(sxy, w, h, reach);
      const half = Math.max(2, Math.round((level * long) / 130));
      // A long stroke is sampled every few pixels: the picture is smooth along it, and the cost stays about the same for any size.
      const every = Math.max(1, Math.floor(half / 10));
      const planes = split(r);
      const out = planes.map(() => new Float32Array(n));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          // The stroke runs along the edge: at right angles to the way the picture gets lighter.
          const theta = 0.5 * Math.atan2(2 * bxy[i]!, bxx[i]! - byy[i]!) + Math.PI / 2;
          const dx = Math.cos(theta);
          const dy = Math.sin(theta);
          const sum = [0, 0, 0];
          let count = 0;
          for (let t = -half; t <= half; t += every) {
            const px = Math.round(x + dx * t);
            const py = Math.round(y + dy * t);
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const j = py * w + px;
            for (let c = 0; c < 3; c++) sum[c]! += planes[c]![j]!;
            count++;
          }
          for (let c = 0; c < 3; c++) out[c]![i] = count ? sum[c]! / count : planes[c]![i]!;
        }
      }
      return join(r, eachPixel(saturate(out, 1.15), (v) => (v - 128) * 1.08 + 128));
    }
    default:
      return r;
  }
}
