/**
 * Draws the appearance streams of form widgets: the `/AP /N` form XObjects readers show. Text fields (single line,
 * multi line, comb, password), drop-downs, list boxes, push buttons, and the on and off looks of check boxes and radio
 * buttons. Everything is in the widget's own box: origin bottom left, the width and height of its `/Rect`.
 */
import { ContentBuilder } from "../cos/content";
import { PdfDict, PdfName, PdfStream } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { FieldAppearance } from "../model";
import type { FieldFont } from "./fonts";

export type BorderStyle = "S" | "D" | "B" | "I" | "U";

export interface BorderSpec {
  color?: string;
  width: number;
  style: BorderStyle;
  dash?: number[];
}

export interface BoxLook {
  w: number;
  h: number;
  fill?: string;
  border?: BorderSpec;
}

/** How far the border takes from the inside. Beveled and inset borders are twice as wide. */
export const insetOf = (b: BorderSpec | undefined): number => (!b || b.width <= 0 ? 0 : b.style === "B" || b.style === "I" ? b.width * 2 : b.width);

/** Background and border. `round` draws them as a circle (radio buttons). */
export function drawBox(c: ContentBuilder, look: BoxLook, round = false): void {
  const { w, h, fill, border } = look;
  if (fill) {
    c.save().fillColor(fill);
    if (round) c.ellipse(0, 0, w, h);
    else c.rect(0, 0, w, h);
    c.fill().restore();
  }
  if (!border || !border.color || border.width <= 0) return;
  const bw = border.width;
  c.save().strokeColor(border.color).lineWidth(bw);
  if (round) {
    c.ellipse(bw / 2, bw / 2, w - bw, h - bw).stroke().restore();
    return;
  }
  if (border.style === "U") {
    c.moveTo(0, bw / 2).lineTo(w, bw / 2).stroke().restore();
    return;
  }
  if (border.style === "D") c.dash(border.dash && border.dash.length > 0 ? border.dash : [3], 0);
  c.rect(bw / 2, bw / 2, w - bw, h - bw).stroke();
  c.restore();
  if (border.style === "B" || border.style === "I") {
    const light = border.style === "B" ? 1 : 0.5;
    const dark = border.style === "B" ? 0.5 : 0.75;
    const a = bw;
    const b = bw * 2;
    // top and left edges, then bottom and right edges, each a band of the border's width inside the border
    c.save().fillGray(light).moveTo(a, a).lineTo(a, h - a).lineTo(w - a, h - a).lineTo(w - b, h - b).lineTo(b, h - b).lineTo(b, b).close().fill().restore();
    c.save().fillGray(dark).moveTo(w - a, h - a).lineTo(w - a, a).lineTo(a, a).lineTo(b, b).lineTo(w - b, b).lineTo(w - b, h - b).close().fill().restore();
  }
}

export interface TextLook extends BoxLook {
  text: string;
  font: FieldFont;
  /** 0: fit the field. */
  size: number;
  color: string;
  align: 0 | 1 | 2;
  multiline?: boolean;
  comb?: boolean;
  maxLen?: number;
  password?: boolean;
}

const LINE = 1.15;
const PAD = 2;

/** Splits text into lines no wider than `max`, at spaces where possible (and inside a word that is too long). */
export function wrapText(text: string, font: FieldFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r\n|\r|\n/)) {
    if (para === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/( +)/)) {
      if (word === "") continue;
      const tryLine = line + word;
      if (font.width(tryLine, size) <= max || line === "") {
        line = tryLine;
        if (font.width(line, size) > max) {
          // a single word wider than the box: break it by characters
          let piece = "";
          for (const ch of line) {
            if (font.width(piece + ch, size) > max && piece !== "") {
              out.push(piece);
              piece = ch;
            } else piece += ch;
          }
          line = piece;
        }
      } else {
        out.push(line.replace(/ +$/, ""));
        line = word.trim() === "" ? "" : word;
        if (font.width(line, size) > max) {
          let piece = "";
          for (const ch of line) {
            if (font.width(piece + ch, size) > max && piece !== "") {
              out.push(piece);
              piece = ch;
            } else piece += ch;
          }
          line = piece;
        }
      }
    }
    out.push(line);
  }
  return out;
}

function fitSingle(font: FieldFont, text: string, innerW: number, innerH: number, size: number): number {
  if (size > 0) return size;
  let s = Math.max(4, Math.min(innerH * 0.75, 48));
  const w = font.width(text, s);
  if (w > innerW && w > 0) s = Math.max(4, (s * innerW) / w);
  return s;
}

function textAt(c: ContentBuilder, font: FieldFont, size: number, color: string, x: number, y: number, text: string): void {
  if (text === "") return;
  c.beginText().fillColor(color).font(font.name, size).textMove(x, y);
  font.show(c, text);
  c.endText();
}

/** The marked-content stream of a text field or the text of a drop-down. */
export function drawText(c: ContentBuilder, look: TextLook): void {
  const { w, h, font, color, align, border } = look;
  const inset = insetOf(border);
  const innerW = Math.max(0, w - 2 * inset);
  const innerH = Math.max(0, h - 2 * inset);
  drawBox(c, look);
  const text = look.password ? "•".repeat([...look.text.replace(/[\r\n]/g, "")].length) : look.text;
  c.raw("/Tx BMC").save().rect(inset, inset, innerW, innerH).clip();
  if (look.comb && look.maxLen && look.maxLen > 0) {
    const n = look.maxLen;
    const chars = [...text.replace(/[\r\n]+/g, " ")].slice(0, n);
    const cell = innerW / n;
    const size = look.size > 0 ? look.size : Math.max(4, Math.min(innerH * 0.75, cell * 1.2, 48));
    if (border?.color && border.width > 0) {
      c.save().strokeColor(border.color).lineWidth(Math.min(border.width, 1));
      for (let i = 1; i < n; i++) c.moveTo(inset + cell * i, inset).lineTo(inset + cell * i, h - inset).stroke();
      c.restore();
    }
    const offset = align === 1 ? (n - chars.length) / 2 : align === 2 ? n - chars.length : 0;
    const baseline = inset + (innerH - 0.72 * size) / 2;
    chars.forEach((ch, i) => textAt(c, font, size, color, inset + cell * (i + offset) + (cell - font.width(ch, size)) / 2, baseline, ch));
  } else if (look.multiline) {
    let size = look.size;
    let lines: string[];
    if (size > 0) lines = wrapText(text, font, size, innerW - 2 * PAD);
    else {
      size = 12;
      lines = wrapText(text, font, size, innerW - 2 * PAD);
      while (size > 4 && lines.length * size * LINE > innerH - 2 * PAD) {
        size -= 1;
        lines = wrapText(text, font, size, innerW - 2 * PAD);
      }
    }
    let y = h - inset - PAD - size * font.ascent;
    for (const line of lines) {
      const tw = font.width(line, size);
      const x = align === 1 ? (w - tw) / 2 : align === 2 ? w - inset - PAD - tw : inset + PAD;
      textAt(c, font, size, color, x, y, line);
      y -= size * LINE;
    }
  } else {
    const line = text.replace(/\r\n|\r|\n/g, " ");
    const size = fitSingle(font, line, innerW - 2 * PAD, innerH, look.size);
    const tw = font.width(line, size);
    const x = align === 1 ? (w - tw) / 2 : align === 2 ? w - inset - PAD - tw : inset + PAD;
    textAt(c, font, size, color, x, inset + (innerH - 0.72 * size) / 2, line);
  }
  c.restore().raw("EMC");
}

export interface ListLook extends BoxLook {
  /** What each row shows. */
  rows: string[];
  selected: ReadonlySet<number>;
  /** The first row shown. */
  top: number;
  font: FieldFont;
  size: number;
  color: string;
}

/** A list box: the rows, the chosen ones on a highlight. */
export function drawList(c: ContentBuilder, look: ListLook): void {
  const { w, h, font, color, border } = look;
  const inset = insetOf(border);
  const size = look.size > 0 ? look.size : 12;
  drawBox(c, look);
  c.raw("/Tx BMC").save().rect(inset, inset, w - 2 * inset, h - 2 * inset).clip();
  const rowH = size * LINE;
  let top = h - inset;
  for (let i = look.top; i < look.rows.length && top > inset - rowH; i++) {
    if (look.selected.has(i)) c.save().raw("0.6 0.757 0.855 rg").rect(inset, top - rowH, w - 2 * inset, rowH).fill().restore();
    textAt(c, font, size, color, inset + PAD, top - rowH + (rowH - 0.72 * size) / 2, look.rows[i]!);
    top -= rowH;
  }
  c.restore().raw("EMC");
}

export interface ButtonLook extends BoxLook {
  caption: string;
  font: FieldFont;
  size: number;
  color: string;
}

/** A push button: its box and the caption in the middle. */
export function drawPushButton(c: ContentBuilder, look: ButtonLook): void {
  const { w, h, font, border } = look;
  const inset = insetOf(border);
  drawBox(c, look);
  if (look.caption === "") return;
  const innerW = w - 2 * inset - 2 * PAD;
  const innerH = h - 2 * inset;
  const size = look.size > 0 ? look.size : fitSingle(font, look.caption, innerW, Math.min(innerH, 16), 0);
  const tw = font.width(look.caption, size);
  c.raw("/Tx BMC").save().rect(inset, inset, w - 2 * inset, innerH).clip();
  textAt(c, font, size, look.color, (w - tw) / 2, inset + (innerH - 0.72 * size) / 2, look.caption);
  c.restore().raw("EMC");
}

export type CheckStyle = NonNullable<FieldAppearance["checkStyle"]>;

/** The mark of a check box or radio button that is on, drawn in the middle of the box. */
export function drawMark(c: ContentBuilder, look: BoxLook, style: CheckStyle, color: string): void {
  const inset = insetOf(look.border);
  const pad = Math.max(1, Math.min(look.w, look.h) * 0.1);
  const x0 = inset + pad;
  const y0 = inset + pad;
  const w = Math.max(0, look.w - 2 * (inset + pad));
  const h = Math.max(0, look.h - 2 * (inset + pad));
  const s = Math.min(w, h);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  c.save().fillColor(color).strokeColor(color);
  switch (style) {
    case "check":
      c.lineWidth(Math.max(1, s * 0.13)).lineCap("round").lineJoin("round");
      c.moveTo(cx - s * 0.36, cy + s * 0.02).lineTo(cx - s * 0.1, cy - s * 0.3).lineTo(cx + s * 0.38, cy + s * 0.36).stroke();
      break;
    case "cross":
      c.lineWidth(Math.max(1, s * 0.12)).lineCap("round");
      c.moveTo(cx - s * 0.33, cy - s * 0.33).lineTo(cx + s * 0.33, cy + s * 0.33).stroke();
      c.moveTo(cx - s * 0.33, cy + s * 0.33).lineTo(cx + s * 0.33, cy - s * 0.33).stroke();
      break;
    case "circle":
      c.ellipse(cx - s * 0.25, cy - s * 0.25, s * 0.5, s * 0.5).fill();
      break;
    case "square":
      c.rect(cx - s * 0.3, cy - s * 0.3, s * 0.6, s * 0.6).fill();
      break;
    case "diamond":
      c.moveTo(cx, cy + s * 0.4).lineTo(cx + s * 0.4, cy).lineTo(cx, cy - s * 0.4).lineTo(cx - s * 0.4, cy).close().fill();
      break;
    case "star": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const r = (i % 2 === 0 ? 0.45 : 0.18) * s;
        const a = Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
      c.close().fill();
      break;
    }
  }
  c.restore();
}

/** The off and on looks of a check box (square) or radio button (round). */
export function drawToggle(c: ContentBuilder, look: BoxLook, radio: boolean, on: boolean, style: CheckStyle, color: string): void {
  drawBox(c, look, radio);
  if (on) {
    c.raw("q");
    drawMark(c, look, style, color);
    c.raw("Q");
  }
}

/**
 * The form XObject for a drawing made in the widget's box. `rotate` is the widget's `/MK /R`: the drawing is made in
 * the rotated box and the matrix turns it back.
 */
export function formStream(content: string, w: number, h: number, rotate: number, resources: PdfDict, extra: Record<string, PdfObj> = {}): PdfStream {
  const turned = rotate === 90 || rotate === 270;
  const d = new PdfDict({ Type: PdfName.of("XObject"), Subtype: PdfName.of("Form"), FormType: 1 });
  d.set("BBox", turned ? [0, 0, h, w] : [0, 0, w, h]);
  if (rotate === 90) d.set("Matrix", [0, 1, -1, 0, w, 0]);
  else if (rotate === 180) d.set("Matrix", [-1, 0, 0, -1, w, h]);
  else if (rotate === 270) d.set("Matrix", [0, -1, 1, 0, 0, h]);
  d.set("Resources", resources);
  for (const [k, v] of Object.entries(extra)) d.set(k, v);
  const stream = new PdfStream(d, new ContentBuilder().raw(content).toBytes());
  return stream;
}

/** The size of the box the drawing is made in (swapped when the widget is turned a quarter). */
export const boxFor = (w: number, h: number, rotate: number): [number, number] => (rotate === 90 || rotate === 270 ? [h, w] : [w, h]);
