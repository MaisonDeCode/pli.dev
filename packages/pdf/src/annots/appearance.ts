/**
 * Appearance streams: what an annotation looks like, drawn by us so that every reader (also ones that ignore the
 * annotation dictionary) paints it the same. The stream is a form XObject whose `/BBox` is the annotation's `/Rect`, so
 * the drawing is in the page's own coordinates and no matrix is needed.
 */
import type { WriteContext } from "../context";
import { ContentBuilder, ResourceNames } from "../cos/content";
import { PdfDict, PdfName, PdfRef, PdfStream } from "../cos/objects";
import type { Overlay } from "../cos/overlay";
import { embedTrueType, type EmbeddedFont } from "../fonts/embed";
import { addStandardFont, encodeWinAnsi, measure, standardFamilyFor, winAnsiCode } from "../fonts/standard";
import { makeImageXObject, type ImageXObject } from "../image";
import type { Annotation, LineEnd, PdfPicture, Pt, Rect, StrokeStyle } from "../model";
import { NOTE_SIZE, bounds, endSize, rectToPdf, unionRects, type Box } from "./geometry";
import { parseDataUri } from "./util";

/** What is shared by every appearance written in one save: embedded fonts, pictures already in the file, warnings. */
export interface DrawState {
  overlay: Overlay;
  fonts: Record<string, Uint8Array>;
  warnings: string[];
  embedded: Map<string, EmbeddedFont | null>;
  images: Map<string, ImageXObject | null>;
  warned: Set<string>;
  empty?: PdfRef;
}

const states = new WeakMap<WriteContext, DrawState>();

export function drawState(ctx: WriteContext): DrawState {
  let s = states.get(ctx);
  if (!s) states.set(ctx, (s = { overlay: ctx.overlay, fonts: ctx.options.fonts ?? {}, warnings: ctx.warnings, embedded: new Map(), images: new Map(), warned: new Set() }));
  return s;
}

/** Writes the widths, glyph maps and font files of the fonts that were embedded. Call after the last appearance. */
export function finishState(st: DrawState): void {
  for (const f of st.embedded.values()) f?.finish();
}

function warnOnce(st: DrawState, message: string): void {
  if (st.warned.has(message)) return;
  st.warned.add(message);
  st.warnings.push(message);
}

export interface Appearance {
  /** The annotation's `/Rect` in PDF space. */
  rect: [number, number, number, number];
  stream: PdfStream;
}

// ---- Fonts ------------------------------------------------------------------------------------------------------

interface TextFont {
  /** The name in the stream's resources. */
  name: string;
  width(text: string, size: number): number;
  show(c: ContentBuilder, text: string): void;
  ascent: number;
  descent: number;
}

const STANDARD_METRICS = { Helvetica: [0.905, -0.212], Times: [0.891, -0.216], Courier: [0.805, -0.195] } as const;

const fontKey = (family: string, bold?: boolean, italic?: boolean): string => family + (bold ? " bold" : "") + (italic ? " italic" : "");

function findFontFile(st: DrawState, keys: string[]): { key: string; bytes: Uint8Array } | undefined {
  const lower = new Map(Object.keys(st.fonts).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real) return { key: real, bytes: st.fonts[real]! };
  }
  return undefined;
}

export function textFont(st: DrawState, res: ResourceNames, family: string, bold?: boolean, italic?: boolean, explicitKey?: string): TextFont {
  const keys = explicitKey ? [explicitKey] : [fontKey(family, bold, italic), ...(bold && italic ? [fontKey(family, true), fontKey(family, false, true)] : []), ...(bold || italic ? [family] : [])];
  const file = findFontFile(st, keys.concat(explicitKey ? [] : []));
  if (file) {
    let font = st.embedded.get(file.key);
    if (font === undefined) {
      try {
        font = embedTrueType(st.overlay, file.bytes, { family, bold, italic });
      } catch (error) {
        font = null;
        warnOnce(st, `The font "${file.key}" could not be embedded (${(error as Error).message}): a standard font is used instead.`);
      }
      st.embedded.set(file.key, font);
    }
    if (font) {
      const f = font;
      if ((bold || italic) && file.key.toLowerCase() === family.toLowerCase()) warnOnce(st, `No ${bold ? "bold" : ""}${bold && italic ? " " : ""}${italic ? "italic" : ""} font file for "${family}": the regular one is used.`);
      return { name: res.font(f.ref), width: (t, s) => f.width(t, s), show: (c, t) => void c.showGlyphs(f.encode(t)), ascent: f.ascent, descent: f.descent };
    }
  } else if (!/^(helvetica|arial|times|courier|sans|serif|mono)/i.test(family)) {
    warnOnce(st, `No font file was given for "${family}": ${standardFamilyFor(family)} is used instead. Pass the font in SaveOptions.fonts (key "${fontKey(family, bold, italic)}") to embed it.`);
  }
  const std = standardFamilyFor(family);
  const ref = addStandardFont(st.overlay, std, { bold, italic });
  const [ascent, descent] = STANDARD_METRICS[std];
  return {
    name: res.font(ref),
    width: (t, s) => measure(t, std, s, { bold, italic }),
    show: (c, t) => {
      for (const ch of t) if (winAnsiCode(ch) === 63 && ch !== "?") warnOnce(st, "Some characters are not in the standard fonts and were written as ?: pass a font file in SaveOptions.fonts to keep them.");
      c.showText(encodeWinAnsi(t));
    },
    ascent,
    descent,
  };
}

/** Lines of text broken at `maxWidth`: at line breaks, then at spaces, then (for a word too long for a line) anywhere. */
export function wrapText(text: string, width: (t: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.match(/\S+\s*|\s+/g) ?? []) {
      const trial = line + word;
      if (line === "" || width(trial.replace(/ +$/, "")) <= maxWidth) {
        line = trial;
        if (width(line.replace(/ +$/, "")) > maxWidth) {
          // Break a single long word by characters.
          let piece = "";
          for (const ch of line) {
            if (piece !== "" && width(piece + ch) > maxWidth) {
              lines.push(piece);
              piece = "";
            }
            piece += ch;
          }
          line = piece;
        }
      } else {
        lines.push(line.replace(/ +$/, ""));
        line = word;
        if (width(line.replace(/ +$/, "")) > maxWidth) {
          let piece = "";
          for (const ch of line) {
            if (piece !== "" && width(piece + ch) > maxWidth) {
              lines.push(piece);
              piece = "";
            }
            piece += ch;
          }
          line = piece;
        }
      }
    }
    lines.push(line.replace(/ +$/, ""));
  }
  return lines;
}

// ---- Pictures ---------------------------------------------------------------------------------------------------

/** The picture as an image XObject in the file (added once per save); undefined, with a warning, when it cannot be embedded. */
export function pictureObject(st: DrawState, picture: PdfPicture): ImageXObject | undefined {
  const known = st.images.get(picture.src);
  if (known !== undefined) return known ?? undefined;
  let image: ImageXObject | undefined;
  const data = parseDataUri(picture.src);
  try {
    if (!data) throw new Error("only pictures given as data: addresses can be embedded");
    const b = data.bytes;
    if (b[0] === 0xff && b[1] === 0xd8) image = makeImageXObject(st.overlay, { jpeg: b });
    else if (b[0] === 0x89 && b[1] === 0x50) image = makeImageXObject(st.overlay, { png: b });
    else throw new Error(`${data.mime} pictures are not supported (use PNG or JPEG)`);
  } catch (error) {
    warnOnce(st, `A picture could not be embedded (${(error as Error).message}); a placeholder box is drawn instead.`);
  }
  st.images.set(picture.src, image ?? null);
  return image;
}

// ---- Drawing ----------------------------------------------------------------------------------------------------

/** A drawing surface in page space: points go in with y down from the top of the visible box, and come out in PDF space. */
class Pen {
  constructor(
    readonly c: ContentBuilder,
    readonly box: Box,
  ) {}
  x(v: number): number {
    return this.box[0] + v;
  }
  y(v: number): number {
    return this.box[3] - v;
  }
  move(p: Pt): this {
    this.c.moveTo(this.x(p[0]), this.y(p[1]));
    return this;
  }
  line(p: Pt): this {
    this.c.lineTo(this.x(p[0]), this.y(p[1]));
    return this;
  }
  /** A rectangle path from page space. */
  rect(r: Rect): this {
    this.c.rect(this.x(r.x), this.y(r.y + r.h), r.w, r.h);
    return this;
  }
  ellipse(r: Rect): this {
    this.c.ellipse(this.x(r.x), this.y(r.y + r.h), r.w, r.h);
    return this;
  }
  curve(a: Pt, b: Pt, p: Pt): this {
    this.c.curveTo(this.x(a[0]), this.y(a[1]), this.x(b[0]), this.y(b[1]), this.x(p[0]), this.y(p[1]));
    return this;
  }
}

function setStroke(c: ContentBuilder, s: StrokeStyle): void {
  c.strokeColor(s.color).lineWidth(s.width).lineJoin("round").lineCap("butt");
  c.dash(s.dash && s.dash.length > 0 ? s.dash : []);
}

/** A smooth path through the points (Catmull-Rom splines as cubic curves), drawn with round caps by the caller. */
function smoothPath(pen: Pen, pts: readonly Pt[]): void {
  pen.move(pts[0]!);
  if (pts.length === 1) {
    pen.line([pts[0]![0] + 0.01, pts[0]![1]]);
    return;
  }
  if (pts.length === 2) {
    pen.line(pts[1]!);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    pen.curve([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2);
  }
}

function drawStrokes(pen: Pen, strokes: readonly (readonly Pt[])[], color: string, width: number, dash?: number[]): void {
  const c = pen.c;
  c.strokeColor(color).lineWidth(Math.max(0.1, width)).lineCap("round").lineJoin("round").dash(dash ?? []);
  for (const s of strokes) {
    if (s.length === 0) continue;
    smoothPath(pen, s);
    c.stroke();
  }
}

function drawEnd(pen: Pen, end: LineEnd | undefined, at: Pt, toward: Pt, stroke: StrokeStyle): void {
  if (!end || end === "none") return;
  const c = pen.c;
  const size = endSize(stroke.width);
  const ang = Math.atan2(toward[1] - at[1], toward[0] - at[0]); // from the end back along the line
  const pt = (d: number, a: number): Pt => [at[0] + d * Math.cos(ang + a), at[1] + d * Math.sin(ang + a)];
  c.save().fillColor(stroke.color).strokeColor(stroke.color).lineWidth(stroke.width).lineJoin("miter").lineCap("butt").dash([]);
  switch (end) {
    case "arrow":
    case "closed-arrow":
      pen.move(at).line(pt(size, 0.45)).line(pt(size, -0.45)).c.close().fillStroke();
      break;
    case "open-arrow":
      pen.move(pt(size, 0.45)).line(at).line(pt(size, -0.45)).c.stroke();
      break;
    case "circle":
      pen.ellipse({ x: at[0] - size / 2, y: at[1] - size / 2, w: size, h: size }).c.stroke();
      break;
    case "square": {
      const h = size / 2;
      pen.move([at[0] + h * Math.cos(ang) - h * Math.sin(ang), at[1] + h * Math.sin(ang) + h * Math.cos(ang)]);
      pen.line([at[0] + h * Math.cos(ang) + h * Math.sin(ang), at[1] + h * Math.sin(ang) - h * Math.cos(ang)]);
      pen.line([at[0] - h * Math.cos(ang) + h * Math.sin(ang), at[1] - h * Math.sin(ang) - h * Math.cos(ang)]);
      pen.line([at[0] - h * Math.cos(ang) - h * Math.sin(ang), at[1] - h * Math.sin(ang) + h * Math.cos(ang)]);
      c.closeStroke();
      break;
    }
    case "diamond": {
      const h = size / 2;
      pen.move(pt(h, 0)).line(pt(h, Math.PI / 2)).line(pt(h, Math.PI)).line(pt(h, -Math.PI / 2));
      c.closeStroke();
      break;
    }
    case "butt":
      pen.move(pt(size / 2, Math.PI / 2)).line(pt(size / 2, -Math.PI / 2)).c.stroke();
      break;
    case "slash":
      pen.move(pt(size / 2, Math.PI / 3)).line(pt(size / 2, Math.PI / 3 + Math.PI)).c.stroke();
      break;
  }
  c.restore();
}

/** The point where the line meets a closed arrow head (so the line does not poke through its tip). */
function lineStart(end: LineEnd | undefined, at: Pt, toward: Pt, width: number): Pt {
  if (end !== "arrow" && end !== "closed-arrow") return at;
  const size = endSize(width) * 0.8;
  const len = Math.hypot(toward[0] - at[0], toward[1] - at[1]);
  if (len < size * 1.5) return at;
  return [at[0] + ((toward[0] - at[0]) / len) * size, at[1] + ((toward[1] - at[1]) / len) * size];
}

function humanLabel(name: string): string {
  return name
    .replace(/^SB|^SH|^#/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toUpperCase();
}

const STAMP_COLORS: Record<string, string> = {
  Approved: "#2e7d32",
  ForPublicRelease: "#2e7d32",
  Final: "#2e7d32",
  Experimental: "#1565c0",
  ForComment: "#1565c0",
  Departmental: "#1565c0",
  Expired: "#c62828",
  NotApproved: "#c62828",
  NotForPublicRelease: "#c62828",
  Confidential: "#c62828",
  TopSecret: "#c62828",
  Draft: "#c62828",
  AsIs: "#c62828",
  Sold: "#c62828",
  Void: "#c62828",
};

function drawPicture(st: DrawState, pen: Pen, res: ResourceNames, picture: PdfPicture, rect: Rect): void {
  const image = pictureObject(st, picture);
  const c = pen.c;
  if (!image) {
    c.save().strokeColor("#888888").lineWidth(1).dash([3, 2]);
    pen.rect({ x: rect.x + 0.5, y: rect.y + 0.5, w: Math.max(0, rect.w - 1), h: Math.max(0, rect.h - 1) }).c.stroke();
    pen.move([rect.x, rect.y]).line([rect.x + rect.w, rect.y + rect.h]);
    c.stroke();
    pen.move([rect.x + rect.w, rect.y]).line([rect.x, rect.y + rect.h]);
    c.stroke().restore();
    return;
  }
  const s = Math.min(rect.w / image.width, rect.h / image.height);
  const w = image.width * s;
  const h = image.height * s;
  const name = res.xobject(image.ref);
  c.drawXObject(name, pen.x(rect.x + (rect.w - w) / 2), pen.y(rect.y + (rect.h + h) / 2), w, h);
}

function drawNoteIcon(st: DrawState, pen: Pen, res: ResourceNames, a: Extract<Annotation, { type: "note" }>): void {
  const c = pen.c;
  const fill = a.color ?? "#ffd600";
  const ox = pen.x(a.x);
  const oy = pen.y(a.y + NOTE_SIZE); // lower left of the icon in PDF space
  c.save().translate(ox, oy);
  c.fillColor(fill).strokeColor("#333333").lineWidth(1).lineJoin("round").lineCap("round");
  const icon = a.icon ?? "note";
  switch (icon) {
    case "comment":
      c.moveTo(4, 7).lineTo(4, 7).curveTo(1.5, 7, 1.5, 7, 1.5, 9.5).lineTo(1.5, 19.5).curveTo(1.5, 22, 1.5, 22, 4, 22).lineTo(20, 22).curveTo(22.5, 22, 22.5, 22, 22.5, 19.5).lineTo(22.5, 9.5).curveTo(22.5, 7, 22.5, 7, 20, 7).lineTo(11, 7).lineTo(5, 1.5).lineTo(6.5, 7).close().fillStroke();
      c.strokeColor("#333333").lineWidth(1).moveTo(6, 17.5).lineTo(18, 17.5).stroke().moveTo(6, 13.5).lineTo(15, 13.5).stroke();
      break;
    case "help": {
      c.ellipse(2, 2, 20, 20).fillStroke();
      const f = textFont(st, res, "Helvetica", true);
      c.fillColor("#333333").beginText().font(f.name, 16).textMove(8, 7).raw("(?) Tj").endText();
      break;
    }
    case "insert":
      c.moveTo(12, 21).lineTo(2.5, 5).lineTo(21.5, 5).close().fillStroke();
      break;
    case "key":
      c.ellipse(2, 11, 10, 10).fillStroke().moveTo(11, 14).lineTo(22, 14).stroke().moveTo(18, 14).lineTo(18, 9.5).stroke().moveTo(22, 14).lineTo(22, 10).stroke();
      break;
    case "paragraph": {
      c.ellipse(1.5, 1.5, 21, 21).fillStroke();
      const f = textFont(st, res, "Helvetica", true);
      c.fillColor("#333333").beginText().font(f.name, 15).textMove(7.5, 7.5).raw("<b6> Tj").endText();
      break;
    }
    default:
      // note: a sheet with a turned corner and lines of text
      c.moveTo(4, 1.5).lineTo(4, 22.5).lineTo(15.5, 22.5).lineTo(20, 18).lineTo(20, 1.5).close().fillStroke();
      c.moveTo(15.5, 22.5).lineTo(15.5, 18).lineTo(20, 18).stroke();
      c.lineWidth(0.9).moveTo(7, 15).lineTo(14, 15).stroke().moveTo(7, 11.5).lineTo(17, 11.5).stroke().moveTo(7, 8).lineTo(17, 8).stroke().moveTo(7, 4.5).lineTo(13, 4.5).stroke();
  }
  c.restore();
}

function drawFreeText(st: DrawState, pen: Pen, res: ResourceNames, a: Extract<Annotation, { type: "freetext" }>): void {
  const c = pen.c;
  const { rect, style } = a;
  const bw = a.stroke?.width ?? 0;
  if (a.fill) {
    c.save().fillColor(a.fill);
    pen.rect(rect).c.fill();
    c.restore();
  }
  if (a.stroke && bw > 0) {
    c.save();
    setStroke(c, a.stroke);
    pen.rect({ x: rect.x + bw / 2, y: rect.y + bw / 2, w: Math.max(0, rect.w - bw), h: Math.max(0, rect.h - bw) }).c.stroke();
    c.restore();
  }
  const pad = 2 + bw;
  const inner: Rect = { x: rect.x + pad, y: rect.y + pad, w: Math.max(1, rect.w - 2 * pad), h: Math.max(1, rect.h - 2 * pad) };
  const font = textFont(st, res, style.family, style.bold, style.italic);
  const size = Math.max(1, style.size);
  const lines = wrapText(a.text, (t) => font.width(t, size), inner.w);
  const pitch = Math.max(size * 1.2, (font.ascent - font.descent) * size);
  c.save();
  pen.rect(rect).c.clip();
  c.fillColor(style.color);
  lines.forEach((line, i) => {
    if (line === "") return;
    const w = font.width(line, size);
    const x = style.align === "center" ? inner.x + (inner.w - w) / 2 : style.align === "right" ? inner.x + inner.w - w : inner.x;
    const baseline = inner.y + font.ascent * size + i * pitch;
    c.beginText().font(font.name, size).textMove(pen.x(x), pen.y(baseline));
    font.show(c, line);
    c.endText();
  });
  c.restore();
}

function drawStamp(st: DrawState, pen: Pen, res: ResourceNames, a: Extract<Annotation, { type: "stamp" }>): void {
  const c = pen.c;
  if ("picture" in a.stamp) {
    drawPicture(st, pen, res, a.stamp.picture, a.rect);
    return;
  }
  const { name, label, color } = a.stamp;
  const col = color ?? STAMP_COLORS[name.replace(/^SB|^SH/, "")] ?? "#c62828";
  const { rect } = a;
  const text = (label ?? humanLabel(name)).toUpperCase();
  const stroke = Math.max(1.2, Math.min(rect.w, rect.h) * 0.045);
  c.save().strokeColor(col).lineWidth(stroke).lineJoin("round");
  const inset = stroke / 2 + 0.5;
  const rr = Math.min(rect.h * 0.18, 8);
  const x0 = pen.x(rect.x + inset);
  const y0 = pen.y(rect.y + rect.h - inset);
  const w = Math.max(1, rect.w - 2 * inset);
  const h = Math.max(1, rect.h - 2 * inset);
  const k = 0.5523 * rr;
  c.moveTo(x0 + rr, y0).lineTo(x0 + w - rr, y0).curveTo(x0 + w - rr + k, y0, x0 + w, y0 + rr - k, x0 + w, y0 + rr).lineTo(x0 + w, y0 + h - rr).curveTo(x0 + w, y0 + h - rr + k, x0 + w - rr + k, y0 + h, x0 + w - rr, y0 + h).lineTo(x0 + rr, y0 + h).curveTo(x0 + rr - k, y0 + h, x0, y0 + h - rr + k, x0, y0 + h - rr).lineTo(x0, y0 + rr).curveTo(x0, y0 + rr - k, x0 + rr - k, y0, x0 + rr, y0).close().stroke();
  const font = textFont(st, res, "Helvetica", true);
  const unit = font.width(text, 1);
  const size = Math.max(1, Math.min(rect.h * 0.5, unit > 0 ? (rect.w - 2 * (inset + rr * 0.6 + 2)) / unit : rect.h * 0.5));
  const tw = unit * size;
  c.fillColor(col).beginText().font(font.name, size).textMove(pen.x(rect.x + (rect.w - tw) / 2), pen.y(rect.y + rect.h / 2) - size * 0.36);
  font.show(c, text);
  c.endText().restore();
}

function drawSignature(st: DrawState, pen: Pen, res: ResourceNames, a: Extract<Annotation, { type: "signature" }>): void {
  const c = pen.c;
  const color = a.color ?? "#000000";
  const { rect } = a;
  if (a.mode === "draw") {
    const strokes = (a.strokes ?? []).map((s) => s.map((p): Pt => [rect.x + p[0], rect.y + p[1]]));
    drawStrokes(pen, strokes, color, a.width ?? 2);
  } else if (a.mode === "type") {
    const text = a.text ?? "";
    const font = a.font && findFontFile(st, [a.font]) ? textFont(st, res, a.font, false, false, a.font) : textFont(st, res, "Times", false, true);
    const unit = Math.max(0.001, font.width(text, 1));
    const size = Math.max(1, Math.min(rect.h * 0.7, (rect.w - 4) / unit));
    const tw = unit * size;
    c.save().fillColor(color).beginText().font(font.name, size).textMove(pen.x(rect.x + (rect.w - tw) / 2), pen.y(rect.y + rect.h / 2) - size * 0.3);
    font.show(c, text);
    c.endText().restore();
  } else if (a.picture) drawPicture(st, pen, res, a.picture, rect);
}

function drawPolyPath(pen: Pen, pts: readonly Pt[], close: boolean): void {
  pen.move(pts[0]!);
  for (let i = 1; i < pts.length; i++) pen.line(pts[i]!);
  if (close) pen.c.close();
}

/** The rectangle (page space) an annotation's `/Rect` covers: its bounds, a little larger where the drawing needs room. */
export function annotRect(a: Annotation): Rect {
  const b = bounds(a);
  switch (a.type) {
    case "underline":
    case "squiggly":
      return { x: b.x, y: b.y, w: b.w, h: b.h + 2 };
    case "strikeout":
      return b;
    case "note":
      return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
    default:
      return b.w >= 1 && b.h >= 1 ? b : { x: b.x - (b.w < 1 ? (1 - b.w) / 2 : 0), y: b.y - (b.h < 1 ? (1 - b.h) / 2 : 0), w: Math.max(1, b.w), h: Math.max(1, b.h) };
  }
}

/** The appearance stream of an annotation, or undefined for a type that has none (a link). */
export function buildAppearance(st: DrawState, box: Box, a: Annotation): Appearance | undefined {
  if (a.type === "link") return undefined;
  const rect = annotRect(a);
  const pdfRect = rectToPdf(box, rect);
  const c = new ContentBuilder();
  const res = new ResourceNames(new PdfDict());
  const pen = new Pen(c, box);
  const opacity = a.opacity ?? 1;
  const blend = a.type === "highlight" ? "Multiply" : undefined;
  if (opacity < 1 || blend) c.gs(res.extGState({ fillOpacity: opacity, strokeOpacity: opacity, blendMode: blend }));
  switch (a.type) {
    case "highlight": {
      c.fillColor(a.color);
      for (const r of a.rects) pen.rect(r);
      c.fill();
      break;
    }
    case "underline":
    case "strikeout":
    case "squiggly": {
      c.strokeColor(a.color).lineCap("butt").lineJoin("round").dash([]);
      for (const r of a.rects) {
        const w = Math.max(0.8, Math.min(2, r.h * 0.07));
        c.lineWidth(w);
        if (a.type === "strikeout") {
          const y = r.y + r.h * 0.55;
          pen.move([r.x, y]).line([r.x + r.w, y]);
        } else if (a.type === "underline") {
          const y = r.y + r.h - w / 2 - 0.5;
          pen.move([r.x, y]).line([r.x + r.w, y]);
        } else {
          const base = r.y + r.h + 0.2;
          const amp = 1.2;
          const step = 2;
          pen.move([r.x, base]);
          for (let x = r.x + step, up = true; x < r.x + r.w + step; x += step, up = !up) pen.line([Math.min(x, r.x + r.w), base + (up ? -amp : amp)]);
        }
        c.stroke();
      }
      break;
    }
    case "ink":
      drawStrokes(pen, a.strokes, a.stroke.color, a.stroke.width, a.stroke.dash);
      break;
    case "square":
    case "circle": {
      const w = a.stroke.width;
      const r: Rect = { x: a.rect.x + w / 2, y: a.rect.y + w / 2, w: Math.max(0, a.rect.w - w), h: Math.max(0, a.rect.h - w) };
      if (a.fill) c.fillColor(a.fill);
      if (w > 0) setStroke(c, a.stroke);
      if (a.type === "square") pen.rect(r);
      else pen.ellipse(r);
      if (a.fill && w > 0) c.fillStroke();
      else if (a.fill) c.fill();
      else if (w > 0) c.stroke();
      else c.endPath();
      break;
    }
    case "line": {
      if (a.stroke.width > 0) {
        setStroke(c, a.stroke);
        const from = lineStart(a.startEnd, a.from, a.to, a.stroke.width);
        const to = lineStart(a.endEnd, a.to, a.from, a.stroke.width);
        pen.move(from).line(to);
        c.stroke();
        drawEnd(pen, a.startEnd, a.from, a.to, a.stroke);
        drawEnd(pen, a.endEnd, a.to, a.from, a.stroke);
      }
      break;
    }
    case "polygon":
    case "polyline": {
      if (a.points.length === 0) break;
      const w = a.stroke.width;
      if (a.fill && a.type === "polygon") c.fillColor(a.fill);
      if (w > 0) setStroke(c, a.stroke);
      drawPolyPath(pen, a.points, a.type === "polygon");
      if (a.type === "polygon" && a.fill && w > 0) c.fillStroke();
      else if (a.type === "polygon" && a.fill) c.fill();
      else if (w > 0) c.stroke();
      else c.endPath();
      break;
    }
    case "freetext":
      drawFreeText(st, pen, res, a);
      break;
    case "note":
      drawNoteIcon(st, pen, res, a);
      break;
    case "stamp":
      drawStamp(st, pen, res, a);
      break;
    case "signature":
      drawSignature(st, pen, res, a);
      break;
    case "image":
      drawPicture(st, pen, res, a.picture, a.rect);
      break;
    case "redact": {
      const fill = a.fill ?? "#000000";
      c.fillColor(fill).strokeColor("#e53935").lineWidth(1).dash([3, 2]);
      const alpha = res.extGState({ fillOpacity: 0.35 * opacity, strokeOpacity: 1 });
      c.gs(alpha);
      for (const r of a.rects) pen.rect(r).c.fillStroke();
      break;
    }
  }
  const stream = c.toStream({ Type: PdfName.of("XObject"), Subtype: PdfName.of("Form"), BBox: pdfRect.map((v) => Math.round(v * 1e4) / 1e4), Resources: res.dict });
  return { rect: pdfRect, stream };
}

/** A stream with nothing in it, for annotations that must not be seen (replies). */
export function emptyAppearance(st: DrawState): PdfRef {
  if (!st.empty) st.empty = st.overlay.add(new ContentBuilder().toStream({ Type: PdfName.of("XObject"), Subtype: PdfName.of("Form"), BBox: [0, 0, 1, 1], Resources: new PdfDict() }));
  return st.empty;
}

export { unionRects };
