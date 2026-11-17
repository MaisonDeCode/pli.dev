import { toPdf as writePdf, type PdfGradient, type PdfImage, type PdfItem, type PdfLink, type PdfPage, type PdfPathCommand } from "@pli.dev/docs";
import { parseHex, toHex } from "./color";
import { chartScene, type PathCmd } from "./chartscene";
import type { Deck, Slide, Theme } from "./model";
import { decodePng, jpegInfo, readDataUri, shadowRaster, toPdfImage } from "./pdf-image";
import { customPdfPath, customTextRect } from "./custgeom";
import { presetPdfPath, presetTextRect, type PresetPdfPath, type PresetShade } from "./presets";
import { radialExtent, resolveSlide, type ResolvedElement, type ResolvedFill, type ResolvedLine, type ResolvedText, type Scene } from "./resolve";
import { standardPdfFamily } from "@pli.dev/core";
import { defaultMeasure, fontFaces, layoutText, type FontFaces, type LaidBullet, type TextMeasurer } from "./textlayout";

/*
 * Decks as a PDF file: every slide's resolved scene (the same one the editor draws) becomes a page of the slide's size
 * in points. What a PDF page made of `@pli.dev/docs` items can't hold is approximated, and said so in `warnings` where it
 * changes how the slide looks:
 *
 *  - Opacity (fills, lines, text, picture fills) is real PDF transparency.
 *  - Gradients are PDF shadings clipped to the shape's outline (linear, or radial out to the frame's corners), smooth at any
 *    zoom; stops with opacity become a luminosity mask, so a gradient that fades to nothing really fades.
 *  - Shadows follow the shape's own outline, offset by the shadow's distance. A blur is a Gaussian (half the blur is its
 *    standard deviation) drawn as a small picture with an alpha channel under the shape; a blurred line with no fill is
 *    eight nested translucent copies of the line, each wider and fainter than the next.
 *  - Text in a turned shape is turned with it (text in a shape flipped top to bottom turns upside down, as in PowerPoint);
 *    flips never mirror text.
 *  - Pictures are turned, mirrored and cut to the shape (or to their crop) by the PDF itself, JPEG included.
 *  - Pictures this can't read (other formats, web addresses) come from `options.rasterize`; without it, or when it
 *    gives nothing, a labelled grey box stands in (warning).
 *  - A picture used as a shape's fill is drawn stretched over the shape's frame and cut to the shape.
 *  - Line ends (arrowheads) are drawn as filled triangles, diamonds, ovals and open vees.
 *  - Text is laid out with the real widths of the fonts in `options.fonts` (or with `options.measure`); families without a
 *    file are estimated as Helvetica, Times or Courier, which is what they are drawn in.
 *  - A character the embedded font of its run has no glyph for (a Latin-only font and Cyrillic text) is drawn in the
 *    standard PDF font instead, without moving the rest of the line. Characters no font has (all of them, without
 *    `options.fonts`, outside Western European text) become "?", with one warning for the whole file.
 */

export interface DeckPdfOptions {
  /** Only these slides (by id), in deck order. Slides marked skipped are left out unless listed here. */
  slides?: string[];
  /** TrueType fonts to embed, as `toPdf` of `@pli.dev/docs` takes them. */
  fonts?: Record<string, Uint8Array>;
  /**
   * Measures text for line breaking. By default the embedded `fonts` are measured exactly (see `fontMeasurer`), and
   * without fonts the estimate of `defaultMeasure` is used.
   */
  measure?: TextMeasurer;
  title?: string;
  author?: string;
  /** The date written in the file and shown by date fields without a value. */
  date?: Date;
  /** Not supported yet; leave out. */
  handout?: undefined;
  /** One portrait page for each slide: the slide on top and its notes underneath (long notes continue on extra pages). */
  notes?: boolean;
  /** Compress the page streams. Default true. */
  compress?: boolean;
  /** Draws a picture this can't read itself (PNG that is interlaced, GIF, SVG, WebP, web addresses) as pixels or JPEG. */
  rasterize?: (src: string) => PdfImage | undefined | Promise<PdfImage | undefined>;
}

export interface DeckPdfResult {
  bytes: Uint8Array;
  warnings: string[];
}

// ---- Colour and geometry helpers ---------------------------------------------------------------------------------

type Pt = [number, number];

const mixHex = (a: string, b: string, t: number): string => {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
};

const SHADE: Record<PresetShade, [string, number]> = {
  lighten: ["#ffffff", 0.35],
  lightenLess: ["#ffffff", 0.2],
  darken: ["#000000", 0.35],
  darkenLess: ["#000000", 0.2],
};

function dashFor(dash: ResolvedLine["dash"], width: number): number[] | undefined {
  const u = Math.max(width, 0.75);
  switch (dash) {
    case "dot":
    case "sysDot": return [u, u * 1.5];
    case "dash": return [u * 4, u * 3];
    case "sysDash": return [u * 3, u];
    case "longDash": return [u * 8, u * 3];
    case "dashDot": return [u * 4, u * 3, u, u * 3];
    case "longDashDot": return [u * 8, u * 3, u, u * 3];
    default: return undefined;
  }
}

type Cmds = PdfPathCommand[];

/** A local-to-page mapping of a point. */
type Mapper = (x: number, y: number) => Pt;

function mapCmds(cmds: readonly PdfPathCommand[], f: Mapper): Cmds {
  return cmds.map((c): PdfPathCommand => {
    if (c[0] === "Z") return ["Z"];
    if (c[0] === "C") {
      const a = f(c[1], c[2]);
      const b = f(c[3], c[4]);
      const e = f(c[5], c[6]);
      return ["C", a[0], a[1], b[0], b[1], e[0], e[1]];
    }
    const p = f(c[1], c[2]);
    return [c[0], p[0], p[1]];
  });
}

/** A path's subpaths as polygons (curves flattened). */
function flatten(cmds: readonly PdfPathCommand[], steps = 14, minPoints = 3): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let at: Pt = [0, 0];
  const end = () => {
    if (cur.length >= minPoints) out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    if (c[0] === "M") {
      end();
      at = [c[1], c[2]];
      cur = [at];
    } else if (c[0] === "L") {
      at = [c[1], c[2]];
      cur.push(at);
    } else if (c[0] === "C") {
      const [x0, y0] = at;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        cur.push([u * u * u * x0 + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y0 + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
      }
      at = [c[5], c[6]];
    }
  }
  end();
  return out;
}

// ---- The page being drawn ----------------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A turn about a point, in slide points: clockwise degrees. */
interface Spin {
  angle: number;
  cx: number;
  cy: number;
}

/** An opacity as the writer wants it: left out when solid. */
const alphaOpt = (a: number | undefined): number | undefined => (a === undefined || a >= 0.999 ? undefined : Math.max(0, a));

interface PaintAlpha {
  fillAlpha?: number;
  strokeAlpha?: number;
}

/** A gradient with its points in slide points. */
type SlideGradient = { stops: PdfGradient["stops"] } & ({ kind: "linear"; from: Pt; to: Pt } | { kind: "radial"; center: Pt; radius: number });

/** Collects the items of one page; everything is given in slide points and scaled/moved onto the page here. */
class Canvas {
  items: PdfItem[] = [];
  links: PdfLink[] = [];
  private spin: Spin | undefined;
  constructor(readonly s = 1, readonly ox = 0, readonly oy = 0) {}

  private X = (v: number) => this.ox + v * this.s;
  private Y = (v: number) => this.oy + v * this.s;
  private clipOf = (c?: Box) => (c ? { x: this.X(c.x), y: this.Y(c.y), width: c.w * this.s, height: c.h * this.s } : undefined);

  /** What `draw` puts on the page is turned clockwise by `spin.angle` about its centre (nothing is turned for `undefined`). */
  turned(spin: Spin | undefined, draw: () => void): void {
    const before = this.spin;
    this.spin = spin;
    try {
      draw();
    } finally {
      this.spin = before;
    }
  }

  /** A point of the slide, turned if a turn is in force. */
  private at(x: number, y: number): Pt {
    const t = this.spin;
    if (!t) return [x, y];
    const r = (t.angle * Math.PI) / 180;
    const dx = x - t.cx;
    const dy = y - t.cy;
    return [t.cx + dx * Math.cos(r) - dy * Math.sin(r), t.cy + dx * Math.sin(r) + dy * Math.cos(r)];
  }

  private page(x: number, y: number): Pt {
    const p = this.at(x, y);
    return [this.X(p[0]), this.Y(p[1])];
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; strokeWidth?: number; clip?: Box } & PaintAlpha = {}): void {
    if (this.spin) return this.path([["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]], o);
    this.items.push({ type: "rect", x: this.X(x), y: this.Y(y), width: w * this.s, height: h * this.s, fill: o.fill, stroke: o.stroke, strokeWidth: (o.strokeWidth ?? 1) * this.s, clip: this.clipOf(o.clip), fillOpacity: alphaOpt(o.fillAlpha), strokeOpacity: alphaOpt(o.strokeAlpha) });
  }

  path(cmds: readonly PdfPathCommand[], o: { fill?: string; gradient?: SlideGradient; stroke?: string; strokeWidth?: number; dash?: number[]; cap?: "butt" | "round" | "square"; join?: "miter" | "round" | "bevel"; evenOdd?: boolean; clip?: Box } & PaintAlpha): void {
    if (cmds.length < 2 || (!o.fill && !o.gradient && !o.stroke)) return;
    const g = o.gradient;
    this.items.push({
      type: "path",
      d: mapCmds(cmds, (x, y) => this.page(x, y)),
      fill: o.fill,
      gradient: g && (g.kind === "radial" ? { kind: "radial", stops: g.stops, center: this.page(...g.center), radius: g.radius * this.s } : { kind: "linear", stops: g.stops, from: this.page(...g.from), to: this.page(...g.to) }),
      stroke: o.stroke,
      strokeWidth: (o.strokeWidth ?? 1) * this.s,
      lineCap: o.cap,
      lineJoin: o.join,
      dash: o.dash?.map((d) => d * this.s),
      evenOdd: o.evenOdd,
      clip: this.clipOf(o.clip),
      fillOpacity: alphaOpt(o.fillAlpha),
      strokeOpacity: alphaOpt(o.strokeAlpha),
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash?: number[], alpha?: number): void {
    const a = this.page(x1, y1);
    const b = this.page(x2, y2);
    this.items.push({ type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], color, width: width * this.s, dash: dash?.map((d) => d * this.s), opacity: alphaOpt(alpha) });
  }

  text(x: number, y: number, text: string, font: { family: string; bold: boolean; italic: boolean }, size: number, color: string, width: number, alpha?: number): void {
    const t = this.spin;
    this.items.push({ type: "text", x: this.X(x), y: this.Y(y), text, font, size: size * this.s, color, width: width * this.s, opacity: alphaOpt(alpha), ...(t && t.angle % 360 !== 0 ? { rotate: t.angle, origin: [this.X(t.cx), this.Y(t.cy)] as const } : {}) });
  }

  /** A picture in its (unturned) box; `o.origin` and `o.clipPath` are in slide points. */
  image(image: PdfImage, x: number, y: number, w: number, h: number, o: { clip?: Box; clipPath?: readonly PdfPathCommand[]; flipH?: boolean; flipV?: boolean; rotate?: number; origin?: Pt; opacity?: number } = {}): void {
    this.items.push({
      type: "image",
      image,
      x: this.X(x),
      y: this.Y(y),
      width: w * this.s,
      height: h * this.s,
      clip: this.clipOf(o.clip),
      clipPath: o.clipPath ? mapCmds(o.clipPath, (px, py) => [this.X(px), this.Y(py)]) : undefined,
      flipH: o.flipH || undefined,
      flipV: o.flipV || undefined,
      ...(o.rotate && o.rotate % 360 !== 0 ? { rotate: o.rotate, origin: [this.X((o.origin ?? [x + w / 2, y + h / 2])[0]), this.Y((o.origin ?? [x + w / 2, y + h / 2])[1])] as const } : {}),
      opacity: alphaOpt(o.opacity),
    });
  }

  link(x: number, y: number, w: number, h: number, url: string): void {
    const corners = [this.at(x, y), this.at(x + w, y), this.at(x + w, y + h), this.at(x, y + h)];
    const x0 = Math.min(...corners.map((p) => p[0]));
    const y0 = Math.min(...corners.map((p) => p[1]));
    this.links.push({ x: this.X(x0), y: this.Y(y0), width: (Math.max(...corners.map((p) => p[0])) - x0) * this.s, height: (Math.max(...corners.map((p) => p[1])) - y0) * this.s, url });
  }
}

// ---- Pictures ----------------------------------------------------------------------------------------------------

interface Pic {
  pdf: PdfImage;
  width: number;
  height: number;
}

function picFromPdf(img: PdfImage): Pic {
  return { pdf: img, width: img.width, height: img.height };
}

function picFromLocal(src: string): Pic | undefined {
  const data = readDataUri(src);
  if (!data) return undefined;
  const jpg = jpegInfo(data.bytes);
  if (jpg) return { pdf: { jpeg: data.bytes, ...jpg }, width: jpg.width, height: jpg.height };
  const png = decodePng(data.bytes);
  if (png) return { pdf: toPdfImage(png), width: png.width, height: png.height };
  return undefined;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/** Every picture address a scene draws. */
function sourcesOf(scene: Scene): string[] {
  const out: string[] = [];
  if (scene.background.kind === "image") out.push(scene.background.src);
  const walk = (els: readonly ResolvedElement[]) => {
    for (const e of els) {
      if (e.hidden) continue;
      if (e.kind === "image" && e.src) out.push(e.src);
      if (e.fill.kind === "image") out.push(e.fill.src);
      if (e.kind === "group" && e.children) walk(e.children);
      if (e.table) for (const r of e.table.rows) for (const c of r.cells) if (c.fill.kind === "image") out.push(c.fill.src);
    }
  };
  walk(scene.elements);
  return out;
}

// ---- Drawing a scene ---------------------------------------------------------------------------------------------

interface Ctx {
  cv: Canvas;
  theme: Theme;
  pics: Map<string, Pic | null>;
  warn: (message: string) => void;
  /** The embedded fonts, when `options.fonts` has any. */
  faces?: FontFaces;
  /** How wide text is (what lines were broken with). */
  measure: TextMeasurer;
}

/**
 * Draws text in a font of the PDF. When the embedded font of the run lacks some of the characters, they are drawn
 * in the standard font the PDF falls back to (piece by piece, each piece as wide as it measures) instead of as the
 * font's "missing" box; characters not even that font has become "?" and are reported by the PDF writer.
 */
function putText(ctx: Ctx, x: number, y: number, text: string, font: { family: string; bold: boolean; italic: boolean }, size: number, color: string, width: number, alpha?: number): void {
  const faces = ctx.faces;
  const face = faces?.face(font.family, font.bold, font.italic);
  if (!faces || face === undefined) return ctx.cv.text(x, y, text, font, size, color, width, alpha);
  const own = { ...font, family: face };
  if (faces.covers(font.family, font.bold, font.italic, text)) return ctx.cv.text(x, y, text, own, size, color, width, alpha);
  const fallback = { ...font, family: standardPdfFamily(font.family) };
  const pieces: { text: string; std: boolean; width: number }[] = [];
  for (const ch of text) {
    const std = !faces.covers(font.family, font.bold, font.italic, ch);
    const last = pieces[pieces.length - 1];
    if (last && (last.std === std || ch.trim() === "")) last.text += ch;
    else pieces.push({ text: ch, std, width: 0 });
  }
  const run = { fontSize: size, bold: font.bold, italic: font.italic, letterSpacing: 0, allCaps: false, smallCaps: false };
  let total = 0;
  for (const p of pieces) total += p.width = ctx.measure(p.text, { ...run, fontFamily: p.std ? font.family : face });
  const k = total > 0 && width > 0 ? width / total : 1;
  let at = x;
  for (const p of pieces) {
    const w = p.width * k;
    if (p.text.trim() !== "") ctx.cv.text(at, y, p.text, p.std ? fallback : own, size, color, w, alpha);
    at += w;
  }
}

const BULLET_VECTOR = new Set(["●", "○", "■", "□", "▪", "▫", "◆", "◇", "▶", "►", "▸", "★", "✔", "✓", "◼", "◻", "⚫", "⚪", "∙", "·"]);
const isLatin = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 32 && c < 127) || (c >= 160 && c <= 255) || [0x2022, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x20ac].includes(c);
};

function drawBullet(ctx: Ctx, b: LaidBullet, originX: number, baseline: number): void {
  const run = b.run;
  const color = run.color;
  const alpha = run.alpha;
  const size = b.fontSize;
  const cx = originX + b.x + b.width / 2;
  const cy = baseline - 0.32 * size;
  const ch = [...b.label][0] ?? "•";
  const r = size * 0.27;
  const cv = ctx.cv;
  const fill = { fill: color, fillAlpha: alpha };
  const outline = { stroke: color, strokeWidth: Math.max(0.6, size * 0.06), strokeAlpha: alpha };
  const covered = !!ctx.faces?.covers(run.fontFamily, run.bold, run.italic, ch);
  if (!covered || BULLET_VECTOR.has(ch)) {
    if (["●", "⚫", "∙", "·"].includes(ch)) return cv.path(mapCmds(presetPdfPath("ellipse", 2 * r, 2 * r)[0]!.commands, (x, y) => [x + cx - r, y + cy - r]), fill);
    if (["○", "⚪"].includes(ch)) return cv.path(mapCmds(presetPdfPath("ellipse", 2 * r, 2 * r)[0]!.commands, (x, y) => [x + cx - r, y + cy - r]), outline);
    if (["■", "◼", "▪"].includes(ch)) return cv.rect(cx - r * (ch === "▪" ? 0.8 : 1), cy - r * (ch === "▪" ? 0.8 : 1), 2 * r * (ch === "▪" ? 0.8 : 1), 2 * r * (ch === "▪" ? 0.8 : 1), fill);
    if (["□", "◻", "▫"].includes(ch)) return cv.rect(cx - r, cy - r, 2 * r, 2 * r, outline);
    if (["◆", "◇"].includes(ch)) return cv.path([["M", cx, cy - r * 1.2], ["L", cx + r * 1.2, cy], ["L", cx, cy + r * 1.2], ["L", cx - r * 1.2, cy], ["Z"]], ch === "◆" ? fill : outline);
    if (["▶", "►", "▸"].includes(ch)) return cv.path([["M", cx - r * 0.8, cy - r], ["L", cx + r, cy], ["L", cx - r * 0.8, cy + r], ["Z"]], fill);
    if (ch === "★") return cv.path(mapCmds(presetPdfPath("star5", 2.4 * r, 2.4 * r)[0]!.commands, (x, y) => [x + cx - 1.2 * r, y + cy - 1.2 * r]), fill);
    if (ch === "✔" || ch === "✓") return cv.path([["M", cx - r, cy], ["L", cx - r * 0.3, cy + r * 0.8], ["L", cx + r * 1.1, cy - r]], { stroke: color, strokeWidth: Math.max(0.8, size * 0.09), strokeAlpha: alpha });
  }
  // A character the standard fonts can't show becomes a dot rather than a question mark.
  const label = [...b.label].every((c) => isLatin(c)) || ctx.faces?.covers(run.fontFamily, run.bold, run.italic, b.label) ? b.label : "•";
  putText(ctx, originX + b.x, baseline, label, { family: run.fontFamily, bold: run.bold, italic: run.italic }, size, color, b.width, alpha);
}

/** Draws text laid out in `box`; with `spin` the whole box turns clockwise about its centre with it. */
function drawText(ctx: Ctx, text: ResolvedText, box: Box, spin?: Spin): void {
  if (!text.paragraphs.some((p) => p.runs.some((r) => r.text !== ""))) return;
  const lay = layoutText(text, box.w, box.h, ctx.measure);
  const cv = ctx.cv;
  cv.turned(spin, () => {
    for (const line of lay.lines) {
      const baseline = box.y + line.y;
      if (line.bullet) drawBullet(ctx, line.bullet, box.x, baseline);
      for (const seg of line.segments) {
        const run = seg.run;
        const fs = seg.fontSize;
        const y = baseline + seg.dy;
        const x = box.x + seg.x;
        const color = run.color;
        if (run.highlight) cv.rect(x, y - 0.95 * fs, seg.width, 1.2 * fs, { fill: run.highlight, fillAlpha: run.alpha });
        if (seg.text.trim() !== "") putText(ctx, x, y, seg.text, { family: run.fontFamily, bold: run.bold, italic: run.italic }, fs, color, seg.width, run.alpha);
        if (run.underline) cv.line(x, y + 0.13 * fs, x + seg.width, y + 0.13 * fs, color, Math.max(0.5, fs * 0.055), undefined, run.alpha);
        if (run.strike) cv.line(x, y - 0.3 * fs, x + seg.width, y - 0.3 * fs, color, Math.max(0.5, fs * 0.055), undefined, run.alpha);
        if (run.link) cv.link(x, y - 0.95 * fs, seg.width, 1.2 * fs, run.link);
      }
    }
  });
}

function frameMapper(el: Pick<ResolvedElement, "x" | "y" | "w" | "h" | "rotation" | "flipH" | "flipV">): Mapper {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (x, y) => {
    const dx = (el.flipH ? el.w - x : x) - el.w / 2;
    const dy = (el.flipV ? el.h - y : y) - el.h / 2;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
}

function drawArrowEnd(cv: Canvas, kind: ResolvedLine["head"], tip: Pt, from: Pt, width: number, color: string, alpha: number): void {
  if (kind === "none") return;
  let dx = tip[0] - from[0];
  let dy = tip[1] - from[1];
  const len0 = Math.hypot(dx, dy);
  if (len0 < 1e-9) return;
  dx /= len0;
  dy /= len0;
  const L = Math.max(width * 3.2, 5.5);
  const hw = L * 0.5;
  const px = -dy;
  const py = dx;
  const at = (back: number, side: number): Pt => [tip[0] - dx * back + px * side, tip[1] - dy * back + py * side];
  const poly = (pts: Pt[]): PdfPathCommand[] => [["M", pts[0]![0], pts[0]![1]], ...pts.slice(1).map((p): PdfPathCommand => ["L", p[0], p[1]]), ["Z"]];
  const fill = { fill: color, fillAlpha: alpha };
  if (kind === "triangle") cv.path(poly([tip, at(L, hw), at(L, -hw)]), fill);
  else if (kind === "stealth") cv.path(poly([tip, at(L, hw), at(L * 0.7, 0), at(L, -hw)]), fill);
  else if (kind === "diamond") cv.path(poly([tip, at(L / 2, hw), at(L, 0), at(L / 2, -hw)]), fill);
  else if (kind === "oval") {
    const c = at(L / 2, 0);
    cv.path(mapCmds(presetPdfPath("ellipse", L, L)[0]!.commands, (x, y) => [x + c[0] - L / 2, y + c[1] - L / 2]), fill);
  } else if (kind === "open") cv.path([["M", ...at(L, hw)], ["L", tip[0], tip[1]], ["L", ...at(L, -hw)]], { stroke: color, strokeWidth: Math.max(width, 0.75), join: "miter", strokeAlpha: alpha });
}

/** A frame's place on the slide, for what has to be turned and mirrored with it. */
interface Turn {
  x: number;
  y: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

interface StrokeWith {
  color: string;
  alpha: number;
  width: number;
  dash?: number[];
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
}

/** How much of what is behind a fill shows through it, on average (for the shadow it casts). */
function fillAlphaOf(fill: ResolvedFill): number {
  if (fill.kind === "solid" || fill.kind === "image") return fill.alpha;
  if (fill.kind === "gradient") return fill.stops.length ? fill.stops.reduce((total, s) => total + s.alpha, 0) / fill.stops.length : 0;
  return 1;
}

/** Paints a fill over a shape given as local path commands. Returns whether it also stroked the outline. */
function paintFill(ctx: Ctx, fill: ResolvedFill, cmds: Cmds, frame: { w: number; h: number }, f: Mapper, evenOdd: boolean, shade: PresetShade | undefined, strokeWith?: StrokeWith, turn?: Turn): boolean {
  const cv = ctx.cv;
  const shaded = (c: string) => (shade ? mixHex(c, SHADE[shade][0], SHADE[shade][1]) : c);
  if (fill.kind === "solid") {
    cv.path(mapCmds(cmds, f), { fill: shaded(fill.color), fillAlpha: fill.alpha, stroke: strokeWith?.color, strokeAlpha: strokeWith?.alpha, strokeWidth: strokeWith?.width, dash: strokeWith?.dash, cap: strokeWith?.cap, join: strokeWith?.join, evenOdd });
    return !!strokeWith;
  }
  if (fill.kind === "gradient") {
    const stops = fill.stops.map((s) => ({ at: s.at, color: shaded(s.color), opacity: s.alpha }));
    if (fill.gradientKind === "radial") {
      const { cx, cy, r } = radialExtent(fill.center, frame.w, frame.h);
      cv.path(mapCmds(cmds, f), { gradient: { kind: "radial", stops, center: f(cx, cy), radius: r }, evenOdd });
    }
    else {
      // The axis runs through the centre at the gradient's angle, as long as the frame is along it.
      const a = (fill.angle * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const half = (Math.abs(frame.w * dx) + Math.abs(frame.h * dy) || 1) / 2;
      const cx = frame.w / 2;
      const cy = frame.h / 2;
      cv.path(mapCmds(cmds, f), { gradient: { kind: "linear", stops, from: f(cx - dx * half, cy - dy * half), to: f(cx + dx * half, cy + dy * half) }, evenOdd });
    }
    return false;
  }
  if (fill.kind === "image") {
    const pic = ctx.pics.get(fill.src);
    if (pic) {
      // The picture is stretched over the frame, turned and mirrored with it, and cut to the shape.
      const origin = turn ? ([turn.x, turn.y] as Pt) : f(0, 0);
      const flipH = !!turn?.flipH;
      const flipV = !!turn?.flipV;
      const c = fill.crop;
      // What a crop cuts from the left of a mirrored picture is what ends up on its right.
      const l = (flipH ? c?.r : c?.l) ?? 0;
      const r = (flipH ? c?.l : c?.r) ?? 0;
      const t = (flipV ? c?.b : c?.t) ?? 0;
      const b = (flipV ? c?.t : c?.b) ?? 0;
      const fw = frame.w / Math.max(0.01, 1 - l - r);
      const fh = frame.h / Math.max(0.01, 1 - t - b);
      cv.image(pic.pdf, origin[0] - l * fw, origin[1] - t * fh, fw, fh, { clipPath: mapCmds(cmds, f), flipH, flipV, rotate: turn?.rotation, origin: [origin[0] + frame.w / 2, origin[1] + frame.h / 2], opacity: fill.alpha });
    } else {
      cv.path(mapCmds(cmds, f), { fill: "#d9d9d9" });
      ctx.warn("A picture fill couldn't be drawn and was left grey.");
    }
  }
  return false;
}

// ---- Shadows -----------------------------------------------------------------------------------------------------

/** The copies of an outline a blurred line's shadow is painted in: how far each grows it and its opacity. */
const SHADOW_LAYERS = 8;

function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/**
 * A Gaussian blur of `blur` points (its standard deviation is half of that) as nested copies of a shape, outermost first:
 * where `n` copies lie over each other their opacities add up to what the blurred edge has there. `grow` is how far a
 * copy's edge lies beyond the shape's (negative inside it).
 */
function shadowLayers(blur: number, alpha: number): { grow: number; alpha: number }[] {
  if (!(blur > 0.75)) return [{ grow: 0, alpha }];
  const sigma = blur / 2;
  const z = Array.from({ length: SHADOW_LAYERS }, (_, k) => 2 - (4 * k) / (SHADOW_LAYERS - 1));
  const out: { grow: number; alpha: number }[] = [];
  let behind = 0; // the opacity the copies painted so far give inside the next one
  for (let k = 0; k < SHADOW_LAYERS; k++) {
    // between this copy's edge and the next copy's edge the blurred shadow has about its value halfway
    const mid = k === SHADOW_LAYERS - 1 ? -3 : (z[k]! + z[k + 1]!) / 2;
    const want = alpha * (1 - normalCdf(mid));
    out.push({ grow: z[k]! * sigma, alpha: Math.max(0, 1 - (1 - want) / (1 - behind)) });
    behind = want;
  }
  return out;
}

/**
 * The shadow of a shape, in the shadow's colour, moved by its offset. A hard shadow is a copy of the outline. A soft one
 * is a small picture of the blurred shape (a Gaussian of half the blur, as pixels with an alpha channel, so that the
 * fall-off is smooth); a blurred outline with no fill is nested copies of the line instead, each wider and fainter.
 * Only areas and outlines the shape itself paints are copied (what is painted over them, such as a shade, is left out).
 */
function drawShadow(ctx: Ctx, el: ResolvedElement, subs: readonly PresetPdfPath[], f: Mapper, o: { filled: boolean; stroke?: { width: number; dash?: number[] } }): void {
  const sh = el.shadow;
  if (!sh) return;
  const cv = ctx.cv;
  const A = Math.max(0, Math.min(1, sh.alpha * (o.filled ? fillAlphaOf(el.fill) : 1)));
  if (A <= 0) return;
  const soft = sh.blur > 0.75;
  const moved: Mapper = (x, y) => {
    const p = f(x, y);
    return [p[0] + sh.dx, p[1] + sh.dy];
  };
  const areas = o.filled ? subs.filter((p) => p.fill && !p.shade) : [];
  if (soft && areas.length > 0) {
    const shadow = shadowRaster(areas.map((p) => flatten(mapCmds(p.commands, moved), 16, 3)), sh.blur / 2, sh.color, A);
    if (shadow) cv.image({ ...toPdfImage(shadow.raster), smooth: true }, shadow.x, shadow.y, shadow.w, shadow.h);
  }
  for (const layer of shadowLayers(sh.blur, A)) {
    if (layer.alpha < 0.002) continue;
    for (const p of subs) {
      if (p.shade) continue;
      if (p.fill && o.filled) {
        if (!soft) cv.path(mapCmds(p.commands, moved), { fill: sh.color, fillAlpha: layer.alpha, evenOdd: p.evenOdd });
      } else if (p.stroke && o.stroke) {
        const width = o.stroke.width + 2 * layer.grow;
        if (width <= 0.05) continue;
        cv.path(mapCmds(p.commands, moved), { stroke: sh.color, strokeAlpha: layer.alpha, strokeWidth: width, dash: o.stroke.dash, join: "round" });
      }
    }
  }
}

/** The outline(s) of an element in its own frame: its freeform geometry when it has one, else the preset's. */
function shapePaths(el: ResolvedElement): PresetPdfPath[] {
  return el.custom ? customPdfPath(el.custom, el.w, el.h) : presetPdfPath(el.geometry, el.w, el.h, el.adjust);
}

function drawShape(ctx: Ctx, el: ResolvedElement): void {
  const cv = ctx.cv;
  const f = frameMapper(el);
  const subs = shapePaths(el);
  const line = el.line;
  const lineDash = line ? dashFor(line.dash, line.width) : undefined;
  const cap = line?.cap === "flat" ? "butt" : (line?.cap ?? "butt");
  const stroke: StrokeWith | undefined = line ? { color: line.color, alpha: line.alpha, width: line.width, dash: lineDash, cap: cap as "butt" | "round" | "square", join: line.join } : undefined;
  const turn: Turn = { x: el.x, y: el.y, rotation: el.rotation, flipH: el.flipH, flipV: el.flipV };

  drawShadow(ctx, el, subs, f, { filled: el.fill.kind !== "none", stroke: stroke && { width: stroke.width, dash: stroke.dash } });

  for (const p of subs) {
    const open = p.commands[p.commands.length - 1]?.[0] !== "Z";
    const wantFill = p.fill && el.fill.kind !== "none" && !(open && !p.fill);
    let stroked = false;
    if (wantFill) stroked = paintFill(ctx, el.fill, p.commands, el, f, p.evenOdd, p.shade, p.stroke ? stroke : undefined, turn);
    if (p.stroke && stroke && !stroked) cv.path(mapCmds(p.commands, f), { stroke: stroke.color, strokeAlpha: stroke.alpha, strokeWidth: stroke.width, dash: stroke.dash, cap: stroke.cap, join: stroke.join });
    if (line && stroke && p.stroke && !p.fill && open && (line.head !== "none" || line.tail !== "none")) {
      const pts = flatten(p.commands, 8, 2)[0];
      // the path's own ends: first and last points of the open subpath
      const path = mapCmds(p.commands, f);
      const first = path.find((c) => c[0] === "M") as readonly ["M", number, number] | undefined;
      const flat = pts?.map(([x, y]) => f(x, y)) ?? [];
      if (first && flat.length >= 2) {
        const start: Pt = [first[1], first[2]];
        const next = flat.find((q) => Math.hypot(q[0] - start[0], q[1] - start[1]) > 0.01) ?? flat[1]!;
        const last = path[path.length - 1]!;
        const endPt: Pt = last[0] === "C" ? [last[5], last[6]] : last[0] === "Z" ? start : [last[1], last[2]];
        const prev = [...flat].reverse().find((q) => Math.hypot(q[0] - endPt[0], q[1] - endPt[1]) > 0.01) ?? flat[flat.length - 2]!;
        drawArrowEnd(cv, line.head, start, next, line.width, line.color, line.alpha);
        drawArrowEnd(cv, line.tail, endPt, prev, line.width, line.color, line.alpha);
      }
    }
  }

  if (el.text) {
    // The text box turns with the shape (and upside down when the shape is flipped top to bottom); a flip left to right doesn't mirror it.
    const tr = el.custom ? customTextRect(el.custom, el.w, el.h) : presetTextRect(el.geometry, el.w, el.h, el.adjust);
    const c = f(tr.x + tr.w / 2, tr.y + tr.h / 2);
    const angle = (((el.rotation + (el.flipV ? 180 : 0)) % 360) + 360) % 360;
    drawText(ctx, el.text, { x: c[0] - tr.w / 2, y: c[1] - tr.h / 2, w: tr.w, h: tr.h }, angle ? { angle, cx: c[0], cy: c[1] } : undefined);
  }
  if (el.link) {
    const pts = [f(0, 0), f(el.w, 0), f(el.w, el.h), f(0, el.h)];
    const x0 = Math.min(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1]));
    cv.link(x0, y0, Math.max(...pts.map((p) => p[0])) - x0, Math.max(...pts.map((p) => p[1])) - y0, el.link);
  }
}

function placeholderPicture(ctx: Ctx, el: ResolvedElement, why: string): void {
  const f = frameMapper(el);
  ctx.cv.path(mapCmds(presetPdfPath("rect", el.w, el.h)[0]!.commands, f), { fill: "#d9d9d9", stroke: "#a6a6a6", strokeWidth: 0.75 });
  const label = el.alt || el.source.name || "Picture";
  const size = Math.max(6, Math.min(14, el.h / 4));
  ctx.cv.turned(el.rotation % 360 !== 0 ? { angle: el.rotation, cx: el.x + el.w / 2, cy: el.y + el.h / 2 } : undefined, () => ctx.cv.text(el.x + 6, el.y + el.h / 2 + size * 0.35, label.slice(0, 60), { family: "Arial", bold: false, italic: false }, size, "#595959", Math.min(el.w - 12, label.length * size * 0.5)));
  ctx.warn(`${why}: "${label}" is drawn as a grey box.`);
}

function drawImage(ctx: Ctx, el: ResolvedElement): void {
  const cv = ctx.cv;
  const f = frameMapper(el);
  const pic = el.src ? ctx.pics.get(el.src) : undefined;
  const subs = shapePaths(el);
  drawShadow(ctx, el, subs, f, { filled: true });
  if (!pic) placeholderPicture(ctx, el, el.src && /^https?:/i.test(el.src) ? "A picture from the web can't be read here" : "A picture of a kind that can't be read here");
  else {
    const c = el.crop ?? {};
    // A mirrored picture shows its crop from the other side.
    const l = (el.flipH ? c.r : c.l) ?? 0;
    const r = (el.flipH ? c.l : c.r) ?? 0;
    const t = (el.flipV ? c.b : c.t) ?? 0;
    const b = (el.flipV ? c.t : c.b) ?? 0;
    const rotated = el.rotation % 360 !== 0;
    const masked = !!el.custom || el.geometry !== "rect";
    const cropped = !!(l || t || r || b);
    const fw = el.w / Math.max(0.01, 1 - l - r);
    const fh = el.h / Math.max(0.01, 1 - t - b);
    const outline = masked ? mapCmds(subs.filter((p) => p.fill).flatMap((p) => p.commands), f) : undefined;
    // A cut to the frame is a rectangle on the page while the picture is upright, and the turned frame otherwise.
    const clipPath = outline ?? (cropped && rotated ? mapCmds(presetPdfPath("rect", el.w, el.h)[0]!.commands, f) : undefined);
    cv.image(pic.pdf, el.x - l * fw, el.y - t * fh, fw, fh, {
      clip: !clipPath && cropped ? { x: el.x, y: el.y, w: el.w, h: el.h } : undefined,
      clipPath,
      flipH: el.flipH,
      flipV: el.flipV,
      rotate: el.rotation,
      origin: [el.x + el.w / 2, el.y + el.h / 2],
    });
  }
  if (el.line) {
    const line = el.line;
    for (const p of subs) if (p.stroke && !p.shade) cv.path(mapCmds(p.commands, f), { stroke: line.color, strokeAlpha: line.alpha, strokeWidth: line.width, dash: dashFor(line.dash, line.width) });
  }
  if (el.link) cv.link(el.x, el.y, el.w, el.h, el.link);
}

function drawTable(ctx: Ctx, el: ResolvedElement): void {
  const t = el.table;
  if (!t) return;
  const cv = ctx.cv;
  const rect = (x: number, y: number, w: number, h: number): Cmds => [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  const cells = t.rows.flatMap((r) => r.cells).filter((c) => !c.covered);
  for (const c of cells) {
    if (c.fill.kind === "none") continue;
    paintFill(ctx, c.fill, rect(0, 0, c.w, c.h), c, (x, y) => [el.x + c.x + x, el.y + c.y + y], false, undefined);
  }
  for (const c of cells) {
    const x = el.x + c.x;
    const y = el.y + c.y;
    const edge = (l: ResolvedLine | null, x1: number, y1: number, x2: number, y2: number) => {
      if (l) cv.line(x1, y1, x2, y2, l.color, l.width, dashFor(l.dash, l.width), l.alpha);
    };
    edge(c.borders.top, x, y, x + c.w, y);
    edge(c.borders.right, x + c.w, y, x + c.w, y + c.h);
    edge(c.borders.bottom, x, y + c.h, x + c.w, y + c.h);
    edge(c.borders.left, x, y, x, y + c.h);
  }
  for (const c of cells) drawText(ctx, c.text, { x: el.x + c.x, y: el.y + c.y, w: c.w, h: c.h });
}

/** A chart: the same scene the editor draws, with its text placed by measured width. */
function drawChart(ctx: Ctx, el: ResolvedElement): void {
  if (!el.chart) return;
  const cv = ctx.cv;
  const f = frameMapper(el);
  const sc = chartScene(el.chart, el.w, el.h, ctx.theme, ctx.measure);
  const paint = (p: { color: string; alpha: number } | undefined) => (p ? { fill: p.color, fillAlpha: p.alpha } : {});
  const strokeOf = (st: { color: string; alpha: number; width: number; dash?: number[]; cap?: "butt" | "round"; join?: "round" | "miter" } | undefined) =>
    st ? { stroke: st.color, strokeAlpha: st.alpha, strokeWidth: st.width, dash: st.dash, cap: st.cap, join: st.join } : {};
  for (const it of sc.items) {
    if (it.kind === "rect") {
      const cmds: PathCmd[] = [["M", it.x, it.y], ["L", it.x + it.w, it.y], ["L", it.x + it.w, it.y + it.h], ["L", it.x, it.y + it.h], ["Z"]];
      cv.path(mapCmds(cmds, f), { ...paint(it.fill), ...strokeOf(it.stroke) });
    } else if (it.kind === "path") {
      cv.path(mapCmds(it.d, f), { ...paint(it.fill), ...strokeOf(it.stroke) });
    } else if (it.kind === "line") {
      const a = f(it.x1, it.y1);
      const b = f(it.x2, it.y2);
      cv.line(a[0], a[1], b[0], b[1], it.stroke.color, it.stroke.width, it.stroke.dash, it.stroke.alpha);
    } else {
      const width = ctx.measure(it.text, { fontFamily: sc.fontFamily, fontSize: it.size, bold: it.bold, italic: false, letterSpacing: 0, allCaps: false, smallCaps: false });
      const shift = it.anchor === "middle" ? width / 2 : it.anchor === "end" ? width : 0;
      const r = ((it.rotate ?? 0) * Math.PI) / 180;
      const start = f(it.x - shift * Math.cos(r), it.y - shift * Math.sin(r));
      const angle = (((it.rotate ?? 0) + el.rotation) % 360 + 360) % 360;
      const draw = () => putText(ctx, start[0], start[1], it.text, { family: sc.fontFamily, bold: it.bold, italic: false }, it.size, it.color, width, it.alpha);
      if (angle) cv.turned({ angle, cx: start[0], cy: start[1] }, draw);
      else draw();
    }
  }
  if (el.link) cv.link(el.x, el.y, el.w, el.h, el.link);
}

function drawElement(ctx: Ctx, el: ResolvedElement): void {
  if (el.hidden) return;
  if (el.kind === "group") for (const c of el.children ?? []) drawElement(ctx, c);
  else if (el.kind === "chart") drawChart(ctx, el);
  else if (el.kind === "table") drawTable(ctx, el);
  else if (el.kind === "image") drawImage(ctx, el);
  else drawShape(ctx, el);
}

function drawScene(cv: Canvas, scene: Scene, pics: Map<string, Pic | null>, warn: (m: string) => void, faces: FontFaces | undefined, measure: TextMeasurer): void {
  const ctx: Ctx = { cv, theme: scene.theme, pics, warn, faces, measure };
  const full: Cmds = [["M", 0, 0], ["L", scene.width, 0], ["L", scene.width, scene.height], ["L", 0, scene.height], ["Z"]];
  const bg = scene.background;
  if (bg.kind === "image") {
    const pic = pics.get(bg.src);
    if (pic) cv.image(pic.pdf, 0, 0, scene.width, scene.height, { opacity: bg.alpha });
    else {
      cv.path(full, { fill: "#ffffff" });
      warn("The slide background picture couldn't be read.");
    }
  } else if (bg.kind === "none") cv.path(full, { fill: "#ffffff" });
  else paintFill(ctx, bg, full, { w: scene.width, h: scene.height }, (x, y) => [x, y], false, undefined);
  for (const el of scene.elements) drawElement(ctx, el);
}

// ---- The file ----------------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jan 5, 2026". QuickJS (Android) has no `Intl`, so the same text is written out when it is missing. */
const dateText = (d: Date) =>
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d)
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

const LETTER = { width: 612, height: 792 };

function notesText(notes: string): ResolvedText {
  const run = { fontFamily: "Arial", fontSize: 11, bold: false, italic: false, underline: false, strike: false, color: "#222222", alpha: 1, baseline: 0, allCaps: false, smallCaps: false, letterSpacing: 0 };
  return {
    paragraphs: notes.split(/\r\n|\r|\n/).map((line) => ({ runs: line ? [{ ...run, text: line }] : [], level: 0, align: "left" as const, marL: 0, indent: 0, bullet: null, spaceBefore: 0, spaceAfter: 4, lineSpacing: 1.1, rtl: false, endSize: 11 })),
    vAlign: "top",
    insets: { l: 0, t: 0, r: 0, b: 0 },
    wrap: true,
    autofit: "none",
  };
}

function build(deck: Deck, options: DeckPdfOptions, pics: Map<string, Pic | null>): DeckPdfResult {
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);
  const date = options.date ?? new Date();
  const wanted = options.slides ? new Set(options.slides) : undefined;
  const chosen: { slide: Slide; index: number }[] = [];
  deck.slides.forEach((slide, index) => {
    if (wanted ? wanted.has(slide.id) : !slide.skipped) chosen.push({ slide, index });
  });
  const faces = options.fonts && Object.keys(options.fonts).length > 0 ? fontFaces(options.fonts) : undefined;
  const measure = options.measure ?? faces?.measure ?? defaultMeasure;
  const pages: PdfPage[] = [];
  for (const { slide, index } of chosen) {
    const scene = resolveSlide(deck, slide, { slideNumber: index + 1, slideCount: deck.slides.length, date: dateText(date) });
    if (!options.notes) {
      const cv = new Canvas();
      drawScene(cv, scene, pics, warn, faces, measure);
      pages.push({ width: scene.width, height: scene.height, items: cv.items, links: cv.links });
      continue;
    }
    const margin = 54;
    const s = Math.min((LETTER.width - 2 * margin) / scene.width, 330 / scene.height);
    const ox = (LETTER.width - scene.width * s) / 2;
    const cv = new Canvas(s, ox, margin);
    drawScene(cv, scene, pics, warn, faces, measure);
    cv.items.push({ type: "rect", x: ox, y: margin, width: scene.width * s, height: scene.height * s, stroke: "#999999", strokeWidth: 0.75 });
    const items = cv.items;
    const links = cv.links;
    let top = margin + scene.height * s + 24;
    const notes = slide.notes.trim() === "" ? undefined : layoutText(notesText(slide.notes), LETTER.width - 2 * margin, 1e6);
    items.push({ type: "text", x: margin, y: top - 6, text: "Notes", font: { family: "Arial", bold: true, italic: false }, size: 10, color: "#666666" });
    let page: PdfPage = { width: LETTER.width, height: LETTER.height, items, links };
    pages.push(page);
    if (notes) {
      const bottom = LETTER.height - margin;
      let shift = top - 0; // the layout's y is from 0
      let base = 0;
      for (const line of notes.lines) {
        if (line.top - base + line.height + shift > bottom) {
          page = { width: LETTER.width, height: LETTER.height, items: [], links: [] };
          pages.push(page);
          base = line.top;
          shift = margin;
          top = margin;
        }
        const y = line.y - base + shift;
        for (const seg of line.segments) {
          if (seg.text.trim() !== "") page.items.push({ type: "text", x: margin + seg.x, y, text: seg.text, font: { family: "Arial", bold: false, italic: false }, size: seg.fontSize, color: "#222222", width: seg.width });
        }
      }
    }
  }
  const docsWarnings: string[] = [];
  const bytes = writePdf(pages, { title: options.title ?? deck.title, author: options.author, fonts: options.fonts, date, compress: options.compress, warnings: docsWarnings });
  for (const w of docsWarnings) warnings.add(w);
  return { bytes, warnings: [...warnings] };
}

function slidesFor(deck: Deck, options: DeckPdfOptions): Scene[] {
  const wanted = options.slides ? new Set(options.slides) : undefined;
  return deck.slides.filter((s) => (wanted ? wanted.has(s.id) : !s.skipped)).map((s) => resolveSlide(deck, s));
}

/** Makes the pictures every slide needs ready: decoded here when possible, else asked of `rasterize` (awaited when asked to). */
async function preparePictures(deck: Deck, options: DeckPdfOptions, wait: boolean): Promise<{ pics: Map<string, Pic | null>; warnings: string[] }> {
  const pics = new Map<string, Pic | null>();
  const warnings: string[] = [];
  const srcs = new Set(slidesFor(deck, options).flatMap(sourcesOf));
  for (const src of srcs) {
    const local = picFromLocal(src);
    if (local) {
      pics.set(src, local);
      continue;
    }
    let result: PdfImage | undefined;
    if (options.rasterize) {
      try {
        const r = options.rasterize(src);
        if (isThenable(r)) {
          if (wait) result = (await r) as PdfImage | undefined;
          else warnings.push("A picture needs an asynchronous rasterizer; use deckToPdf.");
        } else result = r;
      } catch (cause) {
        warnings.push(`A picture couldn't be drawn: ${(cause as Error).message}`);
      }
    }
    pics.set(src, result ? picFromPdf(result) : null);
  }
  return { pics, warnings };
}

/** Writes the deck as a PDF, waiting for `options.rasterize` where a picture needs it. */
export async function deckToPdf(deck: Deck, options: DeckPdfOptions = {}): Promise<DeckPdfResult> {
  const { pics, warnings } = await preparePictures(deck, options, true);
  const out = build(deck, options, pics);
  return { bytes: out.bytes, warnings: [...warnings, ...out.warnings] };
}

/**
 * The same, without waiting: a `rasterize` that returns a promise isn't used (a warning says so). PNG and JPEG pictures
 * need no rasterizer.
 */
export function toPdf(deck: Deck, options: DeckPdfOptions = {}): DeckPdfResult {
  const sync = { ...options };
  const srcs = new Set(slidesFor(deck, options).flatMap(sourcesOf));
  const pics = new Map<string, Pic | null>();
  const warnings: string[] = [];
  for (const src of srcs) {
    const local = picFromLocal(src);
    let result: PdfImage | undefined;
    if (!local && sync.rasterize) {
      try {
        const r = sync.rasterize(src);
        if (isThenable(r)) warnings.push("A picture needs an asynchronous rasterizer; use deckToPdf.");
        else result = r;
      } catch (cause) {
        warnings.push(`A picture couldn't be drawn: ${(cause as Error).message}`);
      }
    }
    pics.set(src, local ?? (result ? picFromPdf(result) : null));
  }
  const out = build(deck, options, pics);
  return { bytes: out.bytes, warnings: [...warnings, ...out.warnings] };
}
