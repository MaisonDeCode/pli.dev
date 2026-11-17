import type { PdfClip, PdfItem, PdfPathCommand } from "@pli.dev/docs";

/*
 * Vector drawing for the PDF: the small SVG pictures Pli draws itself (the icons of conditional formats) as lines and curves in the
 * file, so they stay sharp at any zoom and need no canvas. Only the subset those pictures use is understood: `g` with `rotate`,
 * `path` (M L H V A and Z, upper or lower case), `circle` and `rect`, with fill, stroke, stroke width, caps and joins, and a
 * rectangle `clipPath`.
 */

type Pt = [number, number];
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m?.[1];
}

/** A paint as `#rrggbb`: hex stays, `rgba(0,0,0,.35)` is mixed with white, `none` is nothing. */
function paint(value: string | undefined): string | undefined {
  if (!value || value === "none" || value === "transparent") return undefined;
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return "#" + [rgba[1], rgba[2], rgba[3]].map((c) => Math.round(Number(c) * a + 255 * (1 - a)).toString(16).padStart(2, "0")).join("");
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

/** An SVG arc as cubic curves (the endpoint form, converted as the SVG standard says). */
function arc(from: Pt, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, to: Pt): PdfPathCommand[] {
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [["L", to[0], to[1]]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cos = Math.cos((phi * Math.PI) / 180);
  const sin = Math.sin((phi * Math.PI) / 180);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry;
  const cyp = (-k * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / parts;
  const out: PdfPathCommand[] = [];
  const point = (t: number): Pt => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number): Pt => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let i = 0; i < parts; i++) {
    const a = t1 + i * step;
    const b = a + step;
    const h = (4 / 3) * Math.tan((b - a) / 4);
    const p0 = point(a);
    const p3 = point(b);
    const d0 = deriv(a);
    const d3 = deriv(b);
    out.push(["C", p0[0] + h * d0[0], p0[1] + h * d0[1], p3[0] - h * d3[0], p3[1] - h * d3[1], p3[0], p3[1]]);
  }
  return out;
}

/** The commands of an SVG path `d` (absolute, in the picture's own units). */
export function svgPathCommands(d: string): PdfPathCommand[] {
  const out: PdfPathCommand[] = [];
  let at: Pt = [0, 0];
  let start: Pt = [0, 0];
  for (const m of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const cmd = m[1]!;
    const args = (m[2]!.match(NUM) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    if (up === "Z") {
      out.push(["Z"]);
      at = start;
      continue;
    }
    const size = { M: 2, L: 2, H: 1, V: 1, A: 7 }[up];
    if (!size) continue;
    for (let i = 0, first = true; i + size <= args.length; i += size, first = false) {
      const a = args.slice(i, i + size);
      if (up === "M") {
        const p: Pt = rel ? [at[0] + a[0]!, at[1] + a[1]!] : [a[0]!, a[1]!];
        out.push([first ? "M" : "L", p[0], p[1]]);
        at = p;
        if (first) start = p;
      } else if (up === "L" || up === "H" || up === "V") {
        const p: Pt = up === "L" ? (rel ? [at[0] + a[0]!, at[1] + a[1]!] : [a[0]!, a[1]!]) : up === "H" ? [rel ? at[0] + a[0]! : a[0]!, at[1]] : [at[0], rel ? at[1] + a[0]! : a[0]!];
        out.push(["L", p[0], p[1]]);
        at = p;
      } else {
        const p: Pt = rel ? [at[0] + a[5]!, at[1] + a[6]!] : [a[5]!, a[6]!];
        out.push(...arc(at, a[0]!, a[1]!, a[2]!, a[3] !== 0, a[4] !== 0, p));
        at = p;
      }
    }
  }
  return out;
}

const circle = (cx: number, cy: number, r: number): PdfPathCommand[] => {
  const k = 0.5522847498 * r;
  return [["M", cx + r, cy], ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r], ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy], ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r], ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy], ["Z"]];
};

/**
 * Draws a small SVG picture (of the subset above, in a 16 by 16 box) as PDF items at `box` (points).
 * `gray` turns every colour to its grey (black and white printing).
 */
export function svgToPdfItems(svg: string, box: { x: number; y: number; width: number; height: number }, gray?: (c: string) => string): PdfItem[] {
  const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const sx = box.width / Number(view?.[1] ?? 16);
  const sy = box.height / Number(view?.[2] ?? 16);
  const clips = new Map<string, PdfClip>();
  for (const m of svg.matchAll(/<clipPath id="([^"]+)">\s*<rect ([^>]*)\/>/g)) {
    const r = m[2]!;
    clips.set(m[1]!, { x: box.x + Number(attr(r, "x") ?? 0) * sx, y: box.y + Number(attr(r, "y") ?? 0) * sy, width: Number(attr(r, "width") ?? 0) * sx, height: Number(attr(r, "height") ?? 0) * sy });
  }
  const col = (c: string | undefined) => {
    const p = paint(c);
    return p && gray ? gray(p) : p;
  };
  const out: PdfItem[] = [];
  // A stack of rotations for the open `g` elements.
  const rotations: { a: number; cx: number; cy: number }[] = [];
  // What a `g` gives the shapes inside it to inherit.
  const INHERIT = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const;
  const inherited: Record<string, string | undefined>[] = [{}];
  const place = (cmds: PdfPathCommand[]): PdfPathCommand[] => {
    const map = (x: number, y: number): [number, number] => {
      for (let i = rotations.length - 1; i >= 0; i--) {
        const r = rotations[i]!;
        const c = Math.cos((r.a * Math.PI) / 180);
        const s = Math.sin((r.a * Math.PI) / 180);
        [x, y] = [r.cx + (x - r.cx) * c - (y - r.cy) * s, r.cy + (x - r.cx) * s + (y - r.cy) * c];
      }
      return [box.x + x * sx, box.y + y * sy];
    };
    return cmds.map((c): PdfPathCommand => {
      if (c[0] === "Z") return c;
      if (c[0] === "C") {
        const a = map(c[1], c[2]);
        const b = map(c[3], c[4]);
        const e = map(c[5], c[6]);
        return ["C", a[0], a[1], b[0], b[1], e[0], e[1]];
      }
      const p = map(c[1], c[2]);
      return [c[0], p[0], p[1]];
    });
  };
  for (const m of svg.matchAll(/<(\/?)(g|path|circle|rect)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, rest] = m;
    if (name === "g") {
      if (closing) {
        rotations.pop();
        inherited.pop();
      } else {
        const top = inherited[inherited.length - 1]!;
        inherited.push(Object.fromEntries(INHERIT.map((k) => [k, attr(rest!, k) ?? top[k]])));
        const r = /rotate\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)/.exec(attr(rest!, "transform") ?? "");
        rotations.push(r ? { a: Number(r[1]), cx: Number(r[2]), cy: Number(r[3]) } : { a: 0, cx: 0, cy: 0 });
      }
      continue;
    }
    if (closing) continue;
    const tag = rest!;
    const top = inherited[inherited.length - 1]!;
    const get = (k: string) => attr(tag, k) ?? top[k];
    let cmds: PdfPathCommand[];
    if (name === "path") cmds = svgPathCommands(attr(tag, "d") ?? "");
    else if (name === "circle") cmds = circle(Number(attr(tag, "cx")), Number(attr(tag, "cy")), Number(attr(tag, "r")));
    else {
      const x = Number(attr(tag, "x") ?? 0);
      const y = Number(attr(tag, "y") ?? 0);
      const w = Number(attr(tag, "width"));
      const h = Number(attr(tag, "height"));
      cmds = [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
    }
    const fillAttr = get("fill");
    const fill = name === "path" || name === "circle" || name === "rect" ? col(fillAttr === undefined ? "#000000" : fillAttr) : undefined;
    const stroke = col(get("stroke"));
    const clipRef = /url\(#([^)]+)\)/.exec(attr(tag, "clip-path") ?? "")?.[1];
    const clip = clipRef ? clips.get(clipRef) : undefined;
    if (!fill && !stroke) continue;
    const cap = get("stroke-linecap");
    const join = get("stroke-linejoin");
    out.push({
      type: "path",
      d: place(cmds),
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke, strokeWidth: Number(get("stroke-width") ?? 1) * Math.min(sx, sy) } : {}),
      ...(cap === "round" || cap === "square" ? { lineCap: cap } : {}),
      ...(join === "round" || join === "bevel" ? { lineJoin: join } : {}),
      ...(clip ? { clip } : {}),
    });
  }
  return out;
}
