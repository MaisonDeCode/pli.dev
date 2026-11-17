import { primaryFamily, standardPdfFamily } from "@pli.dev/core";
import { strToU8, zlibSync } from "fflate";
import { STANDARD_WIDTHS } from "./pdf-widths";
import { parseTrueType, type TrueTypeFont } from "./truetype";

// ---- What a page is made of ------------------------------------------------------------------------------------

/** A font, named the way CSS names it. */
export interface PdfFont {
  family: string;
  bold?: boolean;
  italic?: boolean;
}

/** A rectangle, in points from the page's top left corner. */
export interface PdfClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A step of a path: `M` move to, `L` line to, `C` cubic curve (two control points, then the end), `Z` close. */
export type PdfPathCommand = readonly ["M", number, number] | readonly ["L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

/**
 * Transparency, which any item can carry. `opacity` (0 clear to 1 solid, the default) covers everything the item paints;
 * `fillOpacity` and `strokeOpacity` scale just the fill or just the outline further (the two multiply). Text and pictures
 * only have a fill, a line only a stroke.
 */
export interface PdfOpacity {
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
}

/** Turning, which text and pictures can carry: `rotate` degrees clockwise about `origin` (the item's own `x`, `y` when left out). */
export interface PdfRotation {
  rotate?: number;
  /** The point to turn about, in points from the page's top left corner. */
  origin?: readonly [number, number];
}

/**
 * A color that changes smoothly, for filling a rectangle or a path in place of `fill`: along the line from `from` to
 * `to` (the color before and after it is that of the first and last stop), or out from `center` to `radius`. Each stop
 * has a position 0..1 along the way, a color and an `opacity` (1 by default), so a gradient can fade out. Points are in
 * points from the page's top left corner. The page holds it as a shading, not bands, so it is smooth at any zoom.
 */
export type PdfGradient = { stops: readonly { at: number; color: string; opacity?: number }[] } & (
  | { kind: "linear"; from: readonly [number, number]; to: readonly [number, number] }
  | { kind: "radial"; center: readonly [number, number]; radius: number }
);

/** One thing drawn on a page. Lengths are in points (1/72 inch), measured from the page's top left corner. */
export type PdfItem = (
  | {
      type: "text";
      x: number;
      /** The baseline. */
      y: number;
      text: string;
      font: PdfFont;
      size: number;
      color?: string;
      /**
       * How wide the text came out where it was laid out. The text is stretched or squeezed to this, so a PDF viewer's
       * font, which may differ from the one the layout used, puts every word where the layout did.
       */
      width?: number;
      /** Only this part of it shows (text cut off at the edge of its cell, say). */
      clip?: PdfClip;
    } & PdfRotation
  | { type: "rect"; x: number; y: number; width: number; height: number; fill?: string; /** Fills instead of `fill`. */ gradient?: PdfGradient; stroke?: string; strokeWidth?: number; /** Only this part of it shows. */ clip?: PdfClip }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color?: string; width?: number; dash?: number[]; /** Only this part of it shows. */ clip?: PdfClip }
  | {
      type: "path";
      /** Drawing commands in points from the page's top left corner: move, line, cubic curve, close. */
      d: readonly PdfPathCommand[];
      fill?: string;
      /** Fills instead of `fill`. */
      gradient?: PdfGradient;
      stroke?: string;
      strokeWidth?: number;
      lineCap?: "butt" | "round" | "square";
      lineJoin?: "miter" | "round" | "bevel";
      dash?: number[];
      /** Fill by the even-odd rule (the nonzero rule by default). */
      evenOdd?: boolean;
      /** Only this part of it shows. */
      clip?: PdfClip;
    }
  | ({
      type: "image";
      /** The top left corner of the picture's box (before it is turned). */
      x: number;
      y: number;
      width: number;
      height: number;
      image: PdfImage;
      /** Only this part of it shows (a cropped picture). Not turned with the picture. */
      clip?: { x: number; y: number; width: number; height: number };
      /** Only what is inside this outline shows (a picture cut to a shape), in page coordinates: not turned with the picture. */
      clipPath?: readonly PdfPathCommand[];
      /** Mirrored left to right or top to bottom within its box, before it is turned. */
      flipH?: boolean;
      flipV?: boolean;
    } & PdfRotation)
) &
  PdfOpacity;

/** Pixels for a picture: a JPEG file, as it is, or red, green, blue and alpha bytes. */
export type PdfImage =
  | { jpeg: Uint8Array; width: number; height: number; components: 1 | 3 | 4 }
  | { rgba: Uint8Array; width: number; height: number; /** Asks the viewer to smooth the picture when it is drawn larger than its pixels (a soft shadow, say). */ smooth?: boolean };

export interface PdfLink {
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfItem[];
  links?: PdfLink[];
}

export interface PdfOptions {
  title?: string;
  author?: string;
  /**
   * TrueType fonts to embed, by name: `"Georgia"`, `"Georgia bold"`, `"Georgia italic"`, `"Georgia bold italic"`.
   * Text in a font that isn't listed here is drawn in the nearest standard PDF font, which only has the characters
   * of Western European languages.
   */
  fonts?: Record<string, Uint8Array>;
  /** The date the file says it was made, so that the same pages always come out as the same bytes (the current time when left out). */
  date?: Date;
  /** Compress the pages. Default true. */
  compress?: boolean;
  /** Receives what couldn't be done as written, such as a character no font has. */
  warnings?: string[];
}

// ---- Fonts -----------------------------------------------------------------------------------------------------

type StandardName =
  | "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Helvetica-BoldOblique"
  | "Times-Roman" | "Times-Bold" | "Times-Italic" | "Times-BoldItalic"
  | "Courier" | "Courier-Bold" | "Courier-Oblique" | "Courier-BoldOblique";

/**
 * The standard PDF font nearest a family. Names that say what they are (`Courier`, `Georgia`, `Roboto Mono`) are told by
 * pattern; any other goes by what the font catalogue says its kind is (`Lora` is a serif, so Times; `Roboto` is Helvetica).
 */
function standardFor(font: PdfFont): StandardName {
  const family = font.family.toLowerCase();
  const style = (font.bold ? "B" : "") + (font.italic ? "I" : "");
  if (/courier|mono|consolas|menlo|monaco|code/.test(family)) return (["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"] as const)[(font.bold ? 1 : 0) + (font.italic ? 2 : 0)]!;
  if (/times|georgia|garamond|palatino|cambria|book|minion|charter|serif/.test(family) && !/sans/.test(family)) {
    return ({ "": "Times-Roman", B: "Times-Bold", I: "Times-Italic", BI: "Times-BoldItalic" } as const)[style as "" | "B" | "I" | "BI"];
  }
  const kind = standardPdfFamily(primaryFamily(font.family) || font.family);
  if (kind === "Courier") return (["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"] as const)[(font.bold ? 1 : 0) + (font.italic ? 2 : 0)]!;
  if (kind === "Times") return ({ "": "Times-Roman", B: "Times-Bold", I: "Times-Italic", BI: "Times-BoldItalic" } as const)[style as "" | "B" | "I" | "BI"];
  return ({ "": "Helvetica", B: "Helvetica-Bold", I: "Helvetica-Oblique", BI: "Helvetica-BoldOblique" } as const)[style as "" | "B" | "I" | "BI"];
}

function standardWidths(name: StandardName): readonly number[] | 600 {
  if (name.startsWith("Courier")) return 600;
  if (name.startsWith("Helvetica")) return name.includes("Bold") ? STANDARD_WIDTHS["Helvetica-Bold"] : STANDARD_WIDTHS["Helvetica"];
  return STANDARD_WIDTHS[name as "Times-Roman" | "Times-Bold" | "Times-Italic" | "Times-BoldItalic"];
}

/** Windows-1252, which is what the standard fonts are drawn with: the code each character has beyond ASCII and Latin-1. */
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Characters with no code of their own that read well as another: dashes, spaces and signs. */
const LOOKALIKES: Record<number, string> = {
  0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2015: "—", 0x2212: "-", 0x00ad: "", 0x2002: " ", 0x2003: " ", 0x2009: " ", 0x200a: " ",
  0x202f: " ", 0x2007: " ", 0x2008: " ", 0x2192: ">", 0x2190: "<", 0x2713: "v", 0x25cf: "•", 0x25e6: "•", 0x25aa: "•",
  0x2024: ".", 0x2027: "•", 0x00b7: "·", 0x2032: "'", 0x2033: '"', 0x02bc: "'", 0x2217: "*",
};

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x200e, 0x200f]);

/** The bytes a standard font draws for `text`, with what had no place in the font made `?` and counted. */
function winAnsi(text: string, missing: Set<string>): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13) code = 32;
    if (ZERO_WIDTH.has(code)) continue;
    const swap = LOOKALIKES[code];
    if (swap !== undefined) {
      for (const c of swap) out.push(WIN_ANSI[c.codePointAt(0)!] ?? c.codePointAt(0)!);
      continue;
    }
    if ((code >= 32 && code < 127) || (code >= 160 && code <= 255)) out.push(code);
    else if (WIN_ANSI[code] !== undefined) out.push(WIN_ANSI[code]!);
    else if (code >= 0x300 && code <= 0x36f) continue; // combining marks can't be drawn on their own
    else {
      missing.add(ch);
      out.push(0x3f);
    }
  }
  return out;
}

// ---- Colors and numbers ----------------------------------------------------------------------------------------

function rgb(color: string | undefined): [number, number, number] {
  if (!color) return [0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const fn = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(color.trim());
  if (fn) return [Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255];
  return [0, 0, 0];
}

const n = (value: number): string => {
  const text = (Math.round(value * 1000) / 1000).toFixed(3);
  return text.replace(/\.?0+$/, "") || "0";
};

const color = (c: string | undefined, op: "rg" | "RG"): string => `${rgb(c).map(n).join(" ")} ${op}`;

/** Opacity written as 0..1 (1, the default, when not given); anything that rounds to solid counts as solid. */
const clampAlpha = (v: number | undefined): number => (v === undefined || Number.isNaN(v) ? 1 : Math.min(1, Math.max(0, v)));

/** At this opacity and above, an item is drawn solid and no graphics state is needed. */
const OPAQUE = 0.9995;

/** Sine and cosine of a clockwise turn in degrees. */
const rotation = (degrees: number) => ({ cos: Math.cos((degrees * Math.PI) / 180), sin: Math.sin((degrees * Math.PI) / 180) });

/** The operators of a path, its points flipped to the PDF's bottom-left origin by `y`. */
function pathOps(d: readonly PdfPathCommand[], y: (top: number) => string): string {
  let p = "";
  for (const c of d) {
    if (c[0] === "M") p += `${n(c[1])} ${y(c[2])} m `;
    else if (c[0] === "L") p += `${n(c[1])} ${y(c[2])} l `;
    else if (c[0] === "C") p += `${n(c[1])} ${y(c[2])} ${n(c[3])} ${y(c[4])} ${n(c[5])} ${y(c[6])} c `;
    else p += "h ";
  }
  return p;
}

/** The function of a gradient: its stops' colors (or just their opacities) from 0 to 1, as a stitched exponential function. */
function gradientFunction(stops: PdfGradient["stops"], channel: "color" | "alpha"): string {
  const list = stops.map((s) => ({ at: Math.min(1, Math.max(0, Number.isFinite(s.at) ? s.at : 0)), color: s.color, opacity: clampAlpha(s.opacity) })).sort((a, b) => a.at - b.at);
  if (list.length === 0) list.push({ at: 0, color: "#000000", opacity: 0 });
  if (list[0]!.at > 0) list.unshift({ ...list[0]!, at: 0 });
  if (list[list.length - 1]!.at < 1) list.push({ ...list[list.length - 1]!, at: 1 });
  if (list.length === 2 && list[0]!.at === list[1]!.at) list[1]!.at = 1;
  // Between the first and last stop, the positions have to climb strictly (by more than the digits they are written with).
  for (let i = 1; i < list.length - 1; i++) list[i]!.at = Math.min(Math.max(list[i]!.at, list[i - 1]!.at + 2e-3), 1 - 2e-3 * (list.length - 1 - i));
  const value = (s: (typeof list)[number]) => (channel === "alpha" ? [s.opacity] : rgb(s.color)).map(n).join(" ");
  const piece = (a: (typeof list)[number], b: (typeof list)[number]) => `<< /FunctionType 2 /Domain [0 1] /C0 [${value(a)}] /C1 [${value(b)}] /N 1 >>`;
  if (list.length === 2) return piece(list[0]!, list[1]!);
  const pieces = list.slice(1).map((s, i) => piece(list[i]!, s));
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.join(" ")}] /Bounds [${list.slice(1, -1).map((s) => n(s.at)).join(" ")}] /Encode [${pieces.map(() => "0 1").join(" ")}] >>`;
}

/** A gradient as a shading dictionary, its points flipped to the PDF's bottom-left origin by `y`. */
function shadingDict(g: PdfGradient, y: (top: number) => string, channel: "color" | "alpha"): string {
  const fn = gradientFunction(g.stops, channel);
  const space = channel === "alpha" ? "/DeviceGray" : "/DeviceRGB";
  if (g.kind === "radial") return `<< /ShadingType 3 /ColorSpace ${space} /Coords [${n(g.center[0])} ${y(g.center[1])} 0 ${n(g.center[0])} ${y(g.center[1])} ${n(Math.max(g.radius, 1e-3))}] /Function ${fn} /Extend [true true] >>`;
  const flat = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) < 1e-6;
  return `<< /ShadingType 2 /ColorSpace ${space} /Coords [${n(g.from[0])} ${y(g.from[1])} ${n(g.to[0] + (flat ? 1e-3 : 0))} ${y(g.to[1])}] /Function ${fn} /Extend [true true] >>`;
}

function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, "\\$&")})`;
}

/** A text string as UTF-16 with a byte order mark, which PDF readers show as it is written. */
function unicodeString(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex.toUpperCase()}>`;
}

const hex = (bytes: ArrayLike<number>): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

// ---- The file --------------------------------------------------------------------------------------------------

class Writer {
  #chunks: Uint8Array[] = [];
  #length = 0;
  offsets: number[] = [];

  constructor() {
    this.#push(strToU8("%PDF-1.7\n%âãÏÓ\n", true));
  }

  #push(bytes: Uint8Array): void {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
  }

  /** Reserves an object number, so objects can refer to each other before they are written. */
  reserve(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }

  object(id: number, body: string): void {
    this.offsets[id - 1] = this.#length;
    this.#push(strToU8(`${id} 0 obj\n${body}\nendobj\n`, true));
  }

  stream(id: number, dict: string, data: Uint8Array, compress: boolean): void {
    const payload = compress ? zlibSync(data, { level: 6 }) : data;
    this.offsets[id - 1] = this.#length;
    this.#push(strToU8(`${id} 0 obj\n<< ${dict}${compress ? " /Filter /FlateDecode" : ""} /Length ${payload.length} >>\nstream\n`, true));
    this.#push(payload);
    this.#push(strToU8("\nendstream\nendobj\n", true));
  }

  finish(root: number, info: number): Uint8Array {
    const start = this.#length;
    const count = this.offsets.length + 1;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (const offset of this.offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${count} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    this.#push(strToU8(xref, true));
    const out = new Uint8Array(this.#length);
    let at = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

interface FontUse {
  /** The name in a page's resources: F1, F2… */
  resource: string;
  id: number;
  standard?: StandardName;
  embedded?: { font: TrueTypeFont; used: Map<number, number[]> };
}

/**
 * Writes pages as a PDF file. Text uses the standard PDF fonts (or fonts you give in `options.fonts`) stretched to the
 * width it had where it was laid out, so the pages come out as they were drawn. Hyperlinks are kept, as are JPEG
 * and PNG-style pictures. The pages don't have to come from Pli's editor: this is a plain writer.
 */
export function toPdf(pages: readonly PdfPage[], options: PdfOptions = {}): Uint8Array {
  const compress = options.compress !== false;
  const writer = new Writer();
  const catalog = writer.reserve();
  const pagesRoot = writer.reserve();
  const info = writer.reserve();
  const missing = new Set<string>();
  /** Characters an embedded font lacked that a standard font drew instead. */
  const fellBack = new Set<string>();
  const warn = (message: string) => options.warnings?.push(message);

  // Embedded fonts, found by name; anything else is a standard font.
  const files = new Map<string, TrueTypeFont | null>();
  const embeddedFor = (font: PdfFont): TrueTypeFont | null => {
    if (!options.fonts) return null;
    const style = `${font.bold ? " bold" : ""}${font.italic ? " italic" : ""}`;
    const wanted = (font.family + style).toLowerCase();
    for (const [name, bytes] of Object.entries(options.fonts)) {
      if (name.toLowerCase() !== wanted) continue;
      if (!files.has(name)) {
        try {
          files.set(name, parseTrueType(bytes));
        } catch (cause) {
          warn(`The font "${name}" couldn't be embedded: ${(cause as Error).message}`);
          files.set(name, null);
        }
      }
      return files.get(name) ?? null;
    }
    return null;
  };

  const fonts = new Map<string, FontUse>();
  const useFor = (key: string, make: (use: FontUse) => void): FontUse => {
    let use = fonts.get(key);
    if (!use) {
      use = { resource: `F${fonts.size + 1}`, id: writer.reserve() };
      make(use);
      fonts.set(key, use);
    }
    return use;
  };
  /** The standard font nearest a family, which is what draws text whose font isn't embedded, and characters an embedded one lacks. */
  const standardUse = (font: PdfFont): FontUse => {
    const standard = standardFor(font);
    return useFor(`std:${standard}`, (use) => (use.standard = standard));
  };
  const fontFor = (font: PdfFont): FontUse => {
    const ttf = embeddedFor(font);
    if (!ttf) return standardUse(font);
    return useFor(`ttf:${ttf.name}:${ttf.bytes.length}`, (use) => (use.embedded = { font: ttf, used: new Map() }));
  };

  // Pictures, each written once however often it is drawn.
  const images = new Map<PdfImage, { resource: string; id: number }>();
  const imageFor = (image: PdfImage) => {
    let use = images.get(image);
    if (!use) {
      use = { resource: `Im${images.size + 1}`, id: writer.reserve() };
      images.set(image, use);
    }
    return use;
  };

  const pageIds: number[] = [];
  for (const page of pages) {
    const height = page.height;
    const y = (top: number) => n(height - top);
    const uses = { fonts: new Set<FontUse>(), images: new Set<{ resource: string; id: number }>() };
    // Graphics states for transparency, one for each pair of fill and stroke opacities the page uses.
    const states = new Map<string, string>();
    const state = (fill: number, stroke: number, extra = ""): string => {
      const key = `/ca ${n(fill)} /CA ${n(stroke)}${extra}`;
      let name = states.get(key);
      if (!name) {
        name = `GS${states.size + 1}`;
        states.set(key, name);
      }
      return `/${name} gs`;
    };
    // Shadings painted on the page, by name.
    const shadings = new Map<string, string>();
    /** Paints a gradient inside the path `ops` (clipping to it), with the opacity its stops and `alpha` give. */
    const gradientFill = (g: PdfGradient, ops: string, evenOdd: boolean, alpha: number): string => {
      if (!ops) return "";
      const dict = shadingDict(g, y, "color");
      let name = shadings.get(dict);
      if (!name) {
        name = `Sh${shadings.size + 1}`;
        shadings.set(dict, name);
      }
      let extra = "";
      if (g.stops.some((s) => clampAlpha(s.opacity) < OPAQUE)) {
        // The stops' opacities are a luminosity mask: a gray shading over the page that says how much of the color shows where.
        const maskId = writer.reserve();
        writer.stream(maskId, `/Type /XObject /Subtype /Form /BBox [0 0 ${n(page.width)} ${n(page.height)}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /Sh0 ${shadingDict(g, y, "alpha")} >> >>`, strToU8("/Sh0 sh", true), compress);
        extra = ` /SMask << /Type /Mask /S /Luminosity /G ${maskId} 0 R >>`;
      }
      const see = extra || alpha < OPAQUE ? `${state(alpha, 1, extra)} ` : "";
      return `q ${see}${ops}${evenOdd ? "W*" : "W"} n /${name} sh Q\n`;
    };
    let content = "";
    // Whether a dash set by an earlier line is still in force for what is drawn next.
    let dashed = false;

    for (const item of page.items) {
      // Opacity of the fill and of the stroke: 1 is the default and writes nothing.
      const base = clampAlpha(item.opacity);
      const fillAlpha = base * clampAlpha(item.fillOpacity);
      const strokeAlpha = base * clampAlpha(item.strokeOpacity);
      const clip = item.type === "image" ? undefined : item.clip;
      if (clip) content += `q ${n(clip.x)} ${y(clip.y + clip.height)} ${n(clip.width)} ${n(clip.height)} re W n\n`;
      if (item.type === "rect") {
        const box = `${n(item.x)} ${y(item.y + item.height)} ${n(item.width)} ${n(item.height)} re`;
        const shade = item.gradient && fillAlpha > 0 ? gradientFill(item.gradient, `${box} `, false, fillAlpha) : "";
        const fill = item.fill && !item.gradient && fillAlpha > 0 ? `${color(item.fill, "rg")} ${box} f\n` : "";
        const reset = dashed && !clip && !(strokeAlpha < OPAQUE) ? "[] 0 d " : "";
        const stroke = item.stroke && strokeAlpha > 0 ? `${reset}${color(item.stroke, "RG")} ${n(item.strokeWidth ?? 1)} w ${box} S\n` : "";
        if (reset && stroke) dashed = false;
        content += shade;
        if (fillAlpha >= OPAQUE && strokeAlpha >= OPAQUE) content += fill + stroke;
        else if (fill || stroke) content += `q ${state(fillAlpha, strokeAlpha)}\n${fill}${stroke}Q\n`;
      } else if (item.type === "path") {
        const p = pathOps(item.d, y);
        if (item.gradient && fillAlpha > 0) content += gradientFill(item.gradient, p, !!item.evenOdd, fillAlpha);
        const fill = item.fill && !item.gradient && fillAlpha > 0 ? item.fill : undefined;
        const stroke = item.stroke && strokeAlpha > 0 ? item.stroke : undefined;
        if (p && (fill || stroke)) {
          const cap = { butt: 0, round: 1, square: 2 }[item.lineCap ?? "butt"];
          const join = { miter: 0, round: 1, bevel: 2 }[item.lineJoin ?? "miter"];
          const dash = item.dash && item.dash.length > 0 ? `[${item.dash.map(n).join(" ")}] 0 d ` : "";
          const paint = fill && stroke ? (item.evenOdd ? "B*" : "B") : fill ? (item.evenOdd ? "f*" : "f") : "S";
          const see = (fill && fillAlpha < OPAQUE) || (stroke && strokeAlpha < OPAQUE) ? `${state(fill ? fillAlpha : 1, stroke ? strokeAlpha : 1)} ` : "";
          content += `q ${see}${fill ? color(fill, "rg") + " " : ""}${stroke ? color(stroke, "RG") + " " : ""}${n(item.strokeWidth ?? 1)} w ${cap} J ${join} j ${dash}${p}${paint} Q\n`;
        }
      } else if (item.type === "line") {
        if (strokeAlpha > 0) {
          const hasDash = !!item.dash && item.dash.length > 0;
          const dash = hasDash ? `[${item.dash!.map(n).join(" ")}] 0 d` : "[] 0 d";
          const drawn = `${color(item.color, "RG")} ${n(item.width ?? 1)} w ${dash} ${n(item.x1)} ${y(item.y1)} m ${n(item.x2)} ${y(item.y2)} l S`;
          if (strokeAlpha >= OPAQUE) {
            content += `${drawn}\n`;
            if (!clip) dashed = hasDash;
          } else content += `q ${state(1, strokeAlpha)} ${drawn} Q\n`;
        }
      } else if (item.type === "image") {
        if (fillAlpha > 0) {
          const use = imageFor(item.image);
          uses.images.add(use);
          const cut = item.clip ? `${n(item.clip.x)} ${y(item.clip.y + item.clip.height)} ${n(item.clip.width)} ${n(item.clip.height)} re W n ` : "";
          const outline = item.clipPath && item.clipPath.length > 0 ? `${pathOps(item.clipPath, y)}W n ` : "";
          const see = fillAlpha < OPAQUE ? `${state(fillAlpha, 1)} ` : "";
          let matrix = `${n(item.width)} 0 0 ${n(item.height)} ${n(item.x)} ${y(item.y + item.height)}`;
          if (item.rotate || item.flipH || item.flipV) {
            // Where the picture's own unit square (left to right, bottom to top) lands on the page.
            const [ox, oy] = item.origin ?? [item.x, item.y];
            const turn = rotation(item.rotate ?? 0);
            const at = (s: number, t: number): [number, number] => {
              const dx = (item.flipH ? 1 - s : s) * item.width + item.x - ox;
              const dy = (item.flipV ? t : 1 - t) * item.height + item.y - oy;
              return [ox + dx * turn.cos - dy * turn.sin, oy + dx * turn.sin + dy * turn.cos];
            };
            const [e, f] = at(0, 0);
            const [x1, y1] = at(1, 0);
            const [x2, y2] = at(0, 1);
            matrix = `${n(x1 - e)} ${n(-(y1 - f))} ${n(x2 - e)} ${n(-(y2 - f))} ${n(e)} ${y(f)}`;
          }
          content += `q ${see}${cut}${outline}${matrix} cm /${use.resource} Do Q\n`;
        }
      } else if (item.text !== "" && item.size > 0 && fillAlpha > 0) {
        const use = fontFor(item.font);
        uses.fonts.add(use);
        // The text as pieces, each in one font: a single piece unless an embedded font lacks some of the characters.
        const pieces: { use: FontUse; shown: string }[] = [];
        let natural = 0;
        if (use.embedded) {
          const { font, used } = use.embedded;
          const std = standardUse(item.font);
          const widths = standardWidths(std.standard!);
          const segments: ({ glyphs: string } | { codes: number[] })[] = [];
          let advance = 0;
          for (const ch of item.text) {
            const code = ch.codePointAt(0)!;
            if (ZERO_WIDTH.has(code)) continue;
            const glyph = font.glyphFor(code === 9 || code === 10 ? 32 : code);
            if (glyph === 0 && code !== 32 && code !== 9 && code !== 10) {
              // The font has no glyph for it: the standard font draws it if it can (a euro, a curly quote), or a "?" if not.
              const codes = winAnsi(ch, missing);
              if (codes.length === 0) continue;
              if (!missing.has(ch)) fellBack.add(ch);
              const last = segments[segments.length - 1];
              if (last && "codes" in last) last.codes.push(...codes);
              else segments.push({ codes });
              continue;
            }
            const last = segments[segments.length - 1];
            const hexGlyph = glyph.toString(16).padStart(4, "0");
            if (last && "glyphs" in last) last.glyphs += hexGlyph;
            else segments.push({ glyphs: hexGlyph });
            advance += (font.advance(glyph) * 1000) / font.unitsPerEm;
            if (!used.has(glyph)) used.set(glyph, [code]);
          }
          for (const segment of segments) {
            if ("glyphs" in segment) pieces.push({ use, shown: `<${segment.glyphs.toUpperCase()}>` });
            else {
              uses.fonts.add(std);
              advance += segment.codes.reduce((total, c) => total + (widths === 600 ? 600 : (widths[c - 32] ?? 0) || 500), 0);
              pieces.push({ use: std, shown: `<${hex(segment.codes)}>` });
            }
          }
          natural = (advance * item.size) / 1000;
        } else {
          const codes = winAnsi(item.text, missing);
          const widths = standardWidths(use.standard!);
          const sum = codes.reduce((total, c) => total + (widths === 600 ? 600 : (widths[c - 32] ?? 0) || 500), 0);
          natural = (sum * item.size) / 1000;
          pieces.push({ use, shown: `<${hex(codes)}>` });
        }
        if (pieces.length === 0) pieces.push({ use, shown: "<>" });
        // Stretch to the width the layout gave it, within reason: a font that is far off is better left a little off.
        let scale = 100;
        if (item.width !== undefined && natural > 0.01 && item.width > 0) scale = Math.min(250, Math.max(40, (item.width / natural) * 100));
        // The text matrix: upright at the baseline's start, or turned clockwise about the origin (which moves the start too).
        let matrix = `1 0 0 1 ${n(item.x)} ${y(item.y)}`;
        if (item.rotate) {
          const [ox, oy] = item.origin ?? [item.x, item.y];
          const turn = rotation(item.rotate);
          const dx = item.x - ox;
          const dy = item.y - oy;
          matrix = `${n(turn.cos)} ${n(-turn.sin)} ${n(turn.sin)} ${n(turn.cos)} ${n(ox + dx * turn.cos - dy * turn.sin)} ${y(oy + dx * turn.sin + dy * turn.cos)}`;
        }
        const see = fillAlpha < OPAQUE ? `q ${state(fillAlpha, 1)} ` : "";
        // The first piece's font is set before the color, as a plain run has always been written; later pieces switch font.
        const [first, ...rest] = pieces;
        const drawn = `${first!.shown} Tj${rest.map((piece) => ` /${piece.use.resource} ${n(item.size)} Tf ${piece.shown} Tj`).join("")}`;
        content += `${see}BT /${first!.use.resource} ${n(item.size)} Tf ${color(item.color, "rg")} ${n(scale)} Tz ${matrix} Tm ${drawn} ET${see ? " Q" : ""}\n`;
      }
      if (clip) content += "Q\n";
    }

    const contentId = writer.reserve();
    writer.stream(contentId, "", strToU8(content, true), compress);
    const annots: number[] = [];
    for (const link of page.links ?? []) {
      if (!/^(https?:|mailto:|tel:)/i.test(link.url)) continue;
      const id = writer.reserve();
      const ascii = link.url.replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c));
      writer.object(
        id,
        `<< /Type /Annot /Subtype /Link /Rect [${n(link.x)} ${y(link.y + link.height)} ${n(link.x + link.width)} ${y(link.y)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(ascii)} >> >>`,
      );
      annots.push(id);
    }
    const pageId = writer.reserve();
    const resources =
      `/Font << ${[...uses.fonts].map((f) => `/${f.resource} ${f.id} 0 R`).join(" ")} >>` +
      (uses.images.size > 0 ? ` /XObject << ${[...uses.images].map((i) => `/${i.resource} ${i.id} 0 R`).join(" ")} >>` : "") +
      (shadings.size > 0 ? ` /Shading << ${[...shadings].map(([dict, name]) => `/${name} ${dict}`).join(" ")} >>` : "") +
      (states.size > 0 ? ` /ExtGState << ${[...states].map(([key, name]) => `/${name} << /Type /ExtGState ${key} >>`).join(" ")} >>` : "");
    writer.object(
      pageId,
      `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << ${resources} >> /Contents ${contentId} 0 R${annots.length > 0 ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : ""} >>`,
    );
    pageIds.push(pageId);
  }

  // Fonts: standard ones are a name; embedded ones carry the file and a map from glyphs back to text.
  for (const use of fonts.values()) {
    if (use.standard) {
      writer.object(use.id, `<< /Type /Font /Subtype /Type1 /BaseFont /${use.standard} /Encoding /WinAnsiEncoding >>`);
      continue;
    }
    const { font, used } = use.embedded!;
    const scale = 1000 / font.unitsPerEm;
    const fileId = writer.reserve();
    const descriptorId = writer.reserve();
    const cidId = writer.reserve();
    const toUnicodeId = writer.reserve();
    writer.stream(fileId, `/Length1 ${font.bytes.length}`, font.bytes, true);
    const flags = 4 | (font.italicAngle !== 0 ? 64 : 0);
    writer.object(
      descriptorId,
      `<< /Type /FontDescriptor /FontName /${font.name} /Flags ${flags} /FontBBox [${font.bbox.map((v) => Math.round(v * scale)).join(" ")}] /ItalicAngle ${n(font.italicAngle)} /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.capHeight * scale)} /StemV 80 /FontFile2 ${fileId} 0 R >>`,
    );
    const glyphs = [...used.keys()].sort((a, b) => a - b);
    writer.object(
      cidId,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${glyphs.map((g) => `${g} [${Math.round(font.advance(g) * scale)}]`).join(" ")}] >>`,
    );
    // So that copying text from the PDF gives text, not glyph numbers.
    const entries = glyphs.map((g) => `<${g.toString(16).padStart(4, "0")}> <${[...String.fromCodePoint(used.get(g)![0]!)].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`);
    const chunks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) chunks.push(`${Math.min(100, entries.length - i)} beginbfchar\n${entries.slice(i, i + 100).join("\n")}\nendbfchar`);
    const cmap =
      "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
      chunks.join("\n") +
      "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
    writer.stream(toUnicodeId, "", strToU8(cmap, true), compress);
    writer.object(use.id, `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`);
  }

  for (const [image, use] of images) {
    if ("jpeg" in image) {
      const space = image.components === 1 ? "/DeviceGray" : image.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const decode = image.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      writer.stream(use.id, `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${space} /BitsPerComponent 8${decode} /Filter /DCTDecode`, image.jpeg, false);
    } else {
      const pixels = image.width * image.height;
      const color = new Uint8Array(pixels * 3);
      const alpha = new Uint8Array(pixels);
      let translucent = false;
      for (let i = 0; i < pixels; i++) {
        color[i * 3] = image.rgba[i * 4]!;
        color[i * 3 + 1] = image.rgba[i * 4 + 1]!;
        color[i * 3 + 2] = image.rgba[i * 4 + 2]!;
        alpha[i] = image.rgba[i * 4 + 3]!;
        if (alpha[i] !== 255) translucent = true;
      }
      let mask = "";
      if (translucent) {
        const maskId = writer.reserve();
        writer.stream(maskId, `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8${image.smooth ? " /Interpolate true" : ""}`, alpha, true);
        mask = ` /SMask ${maskId} 0 R`;
      }
      writer.stream(use.id, `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${image.smooth ? " /Interpolate true" : ""}${mask}`, color, true);
    }
  }

  writer.object(pagesRoot, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  writer.object(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R /PageLayout /SinglePage >>`);
  const date = options.date ?? new Date();
  const stamp = `D:${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;
  writer.object(
    info,
    `<< /Producer ${pdfString("Pli")} /CreationDate ${pdfString(stamp)}${options.title ? ` /Title ${unicodeString(options.title)}` : ""}${options.author ? ` /Author ${unicodeString(options.author)}` : ""} >>`,
  );
  // One warning for the whole file, however many times the characters were drawn.
  if (fellBack.size > 0) {
    warn(`${fellBack.size === 1 ? "A character is" : `${fellBack.size} characters are`} not in the font that was given and was drawn in a standard PDF font instead: ${[...fellBack].slice(0, 8).join(" ")}${fellBack.size > 8 ? " …" : ""}.`);
  }
  if (missing.size > 0) {
    const shown = `${[...missing].slice(0, 8).join(" ")}${missing.size > 8 ? " …" : ""}`;
    const hint = options.fonts && Object.keys(options.fonts).length > 0 ? "None of the fonts given has them" : "Pass fonts that have them in `fonts` to draw them";
    warn(`${missing.size === 1 ? "A character has" : `${missing.size} characters have`} no place in the fonts and became "?": ${shown}. ${hint}.`);
  }
  return writer.finish(catalog, info);
}
