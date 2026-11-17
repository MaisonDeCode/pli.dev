import type { LineEnd, NoteAnnot, Pt, StrokeStyle } from "@pli.dev/pdf";
import { lineEndSize, round2 } from "./annotGeometry";

/**
 * The pure parts of drawing annotations as SVG, in page space: the shapes of line ends, note icons, wrapped text. The
 * components (`AnnotationLayer`) only place these. The look follows the conventions of the PDF appearance streams the engine
 * writes: a highlight multiplies with the page, ink has round caps and joins, notes are 24 points square.
 */

const f = (n: number) => String(round2(n));

export interface EndShape {
  d: string;
  /** Filled with the line's colour (a solid arrow head) or only stroked. */
  fill: boolean;
}

/**
 * The decoration at one end of a line. `tip` is the end point, `from` the other end (or the previous vertex), so the
 * shape points away from `from`. Returns null for "none".
 */
export function lineEndShape(end: LineEnd | undefined, tip: Pt, from: Pt, width: number): EndShape | null {
  if (!end || end === "none") return null;
  const s = lineEndSize(width);
  let ux = tip[0] - from[0];
  let uy = tip[1] - from[1];
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  const nx = -uy;
  const ny = ux;
  const at = (a: number, b: number): string => `${f(tip[0] + ux * a + nx * b)} ${f(tip[1] + uy * a + ny * b)}`;
  switch (end) {
    case "arrow":
      return { d: `M${at(0, 0)}L${at(-s, s * 0.4)}L${at(-s, -s * 0.4)}Z`, fill: true };
    case "closed-arrow":
      return { d: `M${at(0, 0)}L${at(-s, s * 0.4)}L${at(-s, -s * 0.4)}Z`, fill: false };
    case "open-arrow":
      return { d: `M${at(-s, s * 0.4)}L${at(0, 0)}L${at(-s, -s * 0.4)}`, fill: false };
    case "circle": {
      const r = s / 2;
      return { d: `M${f(tip[0] - r)} ${f(tip[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`, fill: true };
    }
    case "square":
      return { d: `M${at(-s / 2, s / 2)}L${at(s / 2, s / 2)}L${at(s / 2, -s / 2)}L${at(-s / 2, -s / 2)}Z`, fill: true };
    case "diamond":
      return { d: `M${at(s / 2, 0)}L${at(0, s / 2)}L${at(-s / 2, 0)}L${at(0, -s / 2)}Z`, fill: true };
    case "butt":
      return { d: `M${at(0, s / 2)}L${at(0, -s / 2)}`, fill: false };
    case "slash": {
      // A stroke across the line, leaning 30 degrees.
      const a = Math.PI / 6;
      const h = s / 2;
      return { d: `M${at(-Math.sin(a) * h, Math.cos(a) * h)}L${at(Math.sin(a) * h, -Math.cos(a) * h)}`, fill: false };
    }
  }
}

/** The ends of a line or of a polyline (the first and last segment point outwards). */
export function endShapes(points: readonly Pt[], startEnd: LineEnd | undefined, endEnd: LineEnd | undefined, width: number): EndShape[] {
  if (points.length < 2) return [];
  const out: EndShape[] = [];
  const a = lineEndShape(startEnd, points[0]!, points[1]!, width);
  const b = lineEndShape(endEnd, points[points.length - 1]!, points[points.length - 2]!, width);
  if (a) out.push(a);
  if (b) out.push(b);
  return out;
}

/** `stroke-dasharray` for a stroke: none when solid. */
export const dashArray = (stroke: StrokeStyle): string | undefined => (stroke.dash && stroke.dash.length > 0 && stroke.dash.some((n) => n > 0) ? stroke.dash.join(" ") : undefined);

// ---- note icons -------------------------------------------------------------------------------------------------

export const NOTE_ICONS: readonly NonNullable<NoteAnnot["icon"]>[] = ["comment", "note", "help", "insert", "key", "paragraph"];

/** The parts of a note icon in a 24 by 24 box: a body drawn in the note's colour and marks drawn over it in dark ink. */
export interface NoteIconShape {
  body: string;
  marks: string;
  /** The body is a circle or similar that wants a thicker outline. */
  text?: string;
}

export function noteIconShape(icon: NoteAnnot["icon"]): NoteIconShape {
  switch (icon) {
    case "note":
      return { body: "M5 2.5h10l5 5v14H5z", marks: "M15 2.5v5h5M8 12h8M8 15.5h8M8 19h5" };
    case "help":
      return { body: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z", marks: "M9 9.4a3 3 0 1 1 4.4 2.6c-.9.5-1.4 1.1-1.4 2.2M12 17.2v.3" };
    case "insert":
      return { body: "M12 3 21.5 21h-19z", marks: "M12 9.5v6M9.5 12.5h5" };
    case "key":
      return { body: "M8 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z", marks: "M11.5 13.5 21 23M17 19l2.5-2.5M19.5 21.5 22 19M8 7.5a1.5 1.5 0 1 0 0 .01" };
    case "paragraph":
      return { body: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z", marks: "M10.5 17.5V7M14 17.5V7M14 7H10a3 3 0 0 0 0 6h3" };
    default:
      return { body: "M4 3h16a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 17h-8l-5 5v-5H4a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 4 3z", marks: "M6.5 8h11M6.5 12h7" };
  }
}

// ---- text -------------------------------------------------------------------------------------------------------

/** Width of a string in points, given a CSS font shorthand: measured with a canvas when there is one, else estimated. */
export type Measure = (text: string) => number;

let canvas: CanvasRenderingContext2D | null | undefined;
const measureCache = new Map<string, number>();

function context(): CanvasRenderingContext2D | null {
  if (canvas === undefined) {
    try {
      canvas = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
    } catch {
      canvas = null;
    }
  }
  return canvas;
}

/** A measuring function for a CSS font (`italic 700 12px "Lora", serif`) with the size it was written for. */
export function measurer(font: string, size: number): Measure {
  return (text: string) => {
    const ctx = context();
    if (!ctx) return text.length * size * 0.52;
    const key = `${font}\u0000${text}`;
    const known = measureCache.get(key);
    if (known !== undefined) return known;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (measureCache.size > 5000) measureCache.clear();
    measureCache.set(key, w);
    return w;
  };
}

/** The CSS font shorthand for a text style at `size` pixels (points, in the page's layer). */
export const cssFont = (stack: string, size: number, bold?: boolean, italic?: boolean): string => `${italic ? "italic " : ""}${bold ? "700 " : "400 "}${size}px ${stack}`;

/** Breaks `text` into lines no wider than `maxWidth`: at spaces, at line breaks, and inside a word only when it alone is too wide. */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (line === "" || measure((line + word).trimEnd()) <= maxWidth) {
        line += word;
      } else {
        lines.push(line.trimEnd());
        line = word;
      }
      if (measure(line.trimEnd()) > maxWidth) {
        // One word wider than the box: broken between letters.
        let chunk = "";
        for (const ch of Array.from(line.trimEnd())) {
          if (chunk !== "" && measure(chunk + ch) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The line height used for text boxes: the same factor in the editor, the drawing and the engine. */
export const LINE_HEIGHT = 1.2;
/** Space between a text box's edge and its text, points. */
export const TEXT_PAD = 3;

/** The height, in points, a text of `lineCount` lines needs. */
export const textHeight = (lineCount: number, size: number): number => lineCount * size * LINE_HEIGHT + 2 * TEXT_PAD;

/** The size at which a one-line text fits a box (signatures typed in a script font). */
export function fitFontSize(text: string, w: number, h: number, widthOfOne: (size: number) => number): number {
  let size = Math.max(4, h * 0.72);
  const natural = widthOfOne(size);
  if (natural > w * 0.96 && natural > 0) size = Math.max(4, (size * w * 0.96) / natural);
  void text;
  return round2(size);
}
