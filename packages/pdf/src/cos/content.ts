/**
 * A small typed builder for content streams: it appends operators to a string and keeps numbers short and exponent
 * free. Annotation appearances, page labels, watermarks and stamps are written with it.
 *
 * ```ts
 * const c = new ContentBuilder();
 * c.save().fillColor("#ff0000").rect(10, 10, 100, 40).fill().restore();
 * const stream = c.toStream({ Type: name("XObject"), Subtype: name("Form"), BBox: [0, 0, 120, 60] });
 * ```
 *
 * Coordinates are PDF's: origin at the bottom left, y up, in points.
 */
import { PdfDict, PdfName, PdfRef, PdfStream, latin1Bytes } from "./objects";
import type { PdfObj } from "./objects";
import { formatNumber } from "./writer";

/** `#rrggbb` or `#rgb` as three numbers from 0 to 1; throws on anything else. */
export function parseHexColor(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const n = formatNumber;

/** A string as a PDF literal string, for a string whose characters are all one byte (`é` is 0xE9, not UTF-8). */
export function literal(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? latin1Bytes(bytes) : bytes;
  let s = "(";
  for (const c of b) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += "\\" + String.fromCharCode(c);
    else if (c === 0x0a) s += "\\n";
    else if (c === 0x0d) s += "\\r";
    else if (c < 0x20 || c > 0x7e) s += "\\" + c.toString(8).padStart(3, "0");
    else s += String.fromCharCode(c);
  }
  return s + ")";
}

/** Bytes as a PDF hex string, for the 2-byte glyph codes of embedded fonts. */
export function hex(bytes: Uint8Array): string {
  let s = "<";
  for (const c of bytes) s += c.toString(16).padStart(2, "0");
  return s + ">";
}

export class ContentBuilder {
  #parts: string[] = [];

  /** Appends any operator text as it is (a space separates it from the one before). */
  raw(op: string): this {
    this.#parts.push(op);
    return this;
  }
  #op(operator: string, ...args: (number | string)[]): this {
    this.#parts.push(args.map((a) => (typeof a === "number" ? n(a) : a)).concat(operator).join(" "));
    return this;
  }

  // graphics state
  save(): this {
    return this.#op("q");
  }
  restore(): this {
    return this.#op("Q");
  }
  /** `cm`: multiplies the current matrix by [a b c d e f]. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.#op("cm", a, b, c, d, e, f);
  }
  translate(x: number, y: number): this {
    return this.transform(1, 0, 0, 1, x, y);
  }
  /** Rotation about the origin, counter-clockwise, in degrees. */
  rotate(degrees: number): this {
    const r = (degrees * Math.PI) / 180;
    return this.transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
  }
  lineWidth(w: number): this {
    return this.#op("w", w);
  }
  lineCap(cap: "butt" | "round" | "square"): this {
    return this.#op("J", cap === "butt" ? 0 : cap === "round" ? 1 : 2);
  }
  lineJoin(join: "miter" | "round" | "bevel"): this {
    return this.#op("j", join === "miter" ? 0 : join === "round" ? 1 : 2);
  }
  miterLimit(m: number): this {
    return this.#op("M", m);
  }
  /** Dash pattern; an empty array is a solid line. */
  dash(pattern: number[], phase = 0): this {
    return this.#op("d", `[${pattern.map(n).join(" ")}]`, phase);
  }
  /** `gs`: applies a named graphics state of the resources (see `ResourceNames.extGState`). */
  gs(resourceName: string): this {
    return this.#op("gs", "/" + resourceName);
  }

  // colour
  fillColor(color: string): this {
    return this.#op("rg", ...parseHexColor(color));
  }
  strokeColor(color: string): this {
    return this.#op("RG", ...parseHexColor(color));
  }
  fillGray(g: number): this {
    return this.#op("g", g);
  }
  strokeGray(g: number): this {
    return this.#op("G", g);
  }

  // paths
  rect(x: number, y: number, w: number, h: number): this {
    return this.#op("re", x, y, w, h);
  }
  moveTo(x: number, y: number): this {
    return this.#op("m", x, y);
  }
  lineTo(x: number, y: number): this {
    return this.#op("l", x, y);
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    return this.#op("c", x1, y1, x2, y2, x3, y3);
  }
  close(): this {
    return this.#op("h");
  }
  /** An ellipse inside the box, four Bezier curves. */
  ellipse(x: number, y: number, w: number, h: number): this {
    const k = 0.5522847498;
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    this.moveTo(cx + rx, cy);
    this.curveTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
    this.curveTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
    this.curveTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
    this.curveTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
    return this.close();
  }
  fill(evenOdd = false): this {
    return this.#op(evenOdd ? "f*" : "f");
  }
  stroke(): this {
    return this.#op("S");
  }
  fillStroke(evenOdd = false): this {
    return this.#op(evenOdd ? "B*" : "B");
  }
  closeStroke(): this {
    return this.#op("s");
  }
  /** `n`: ends the path without painting it. */
  endPath(): this {
    return this.#op("n");
  }
  /** `W n` (or `W* n`): the path just built becomes the clip. */
  clip(evenOdd = false): this {
    return this.#op(evenOdd ? "W*" : "W").#op("n");
  }

  // objects
  /** `Do`: paints an XObject (image or form) by its name in the resources. */
  doXObject(resourceName: string): this {
    return this.#op("Do", "/" + resourceName);
  }
  /** Paints an image or form so that its unit square covers the box (x, y, w, h). */
  drawXObject(resourceName: string, x: number, y: number, w: number, h: number): this {
    return this.save().transform(w, 0, 0, h, x, y).doXObject(resourceName).restore();
  }

  // text
  beginText(): this {
    return this.#op("BT");
  }
  endText(): this {
    return this.#op("ET");
  }
  font(resourceName: string, size: number): this {
    return this.#op("Tf", "/" + resourceName, size);
  }
  /** `Td` (moves from the start of the current line). */
  textMove(x: number, y: number): this {
    return this.#op("Td", x, y);
  }
  textMatrix(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.#op("Tm", a, b, c, d, e, f);
  }
  leading(l: number): this {
    return this.#op("TL", l);
  }
  nextLine(): this {
    return this.#op("T*");
  }
  charSpacing(v: number): this {
    return this.#op("Tc", v);
  }
  wordSpacing(v: number): this {
    return this.#op("Tw", v);
  }
  textRise(v: number): this {
    return this.#op("Ts", v);
  }
  /** 0 fill, 1 stroke, 2 both, 3 invisible (for OCR layers), 7 clip. */
  textMode(mode: number): this {
    return this.#op("Tr", mode);
  }
  /** `Tj` with a literal string: one byte per character (for standard fonts and WinAnsi text; see `encodeWinAnsi`). */
  showText(text: Uint8Array | string): this {
    return this.#op("Tj", literal(text));
  }
  /** `Tj` with a hex string: for the 2-byte glyph codes `EmbeddedFont.encode` returns. */
  showGlyphs(codes: Uint8Array): this {
    return this.#op("Tj", hex(codes));
  }

  get length(): number {
    return this.#parts.length;
  }
  toString(): string {
    return this.#parts.join("\n") + "\n";
  }
  toBytes(): Uint8Array {
    return latin1Bytes(this.toString());
  }
  /** A stream object with these operators (not compressed: the writer does that), and `extra` entries in its dictionary. */
  toStream(extra: Record<string, PdfObj> = {}): PdfStream {
    const d = new PdfDict();
    for (const [k, v] of Object.entries(extra)) d.set(k, v);
    return new PdfStream(d, this.toBytes());
  }
}

/**
 * Names for resources, kept in a resources dictionary: `ResourceNames` reads the dictionary you give it (which must be
 * a direct, changeable one) and adds `Font`, `XObject` and `ExtGState` entries when asked, never reusing a name.
 */
export class ResourceNames {
  constructor(readonly dict: PdfDict = new PdfDict()) {}

  #sub(category: string): PdfDict {
    let d = this.dict.get(category);
    if (!(d instanceof PdfDict)) this.dict.set(category, (d = new PdfDict()));
    return d;
  }
  #add(category: string, prefix: string, value: PdfObj): string {
    const sub = this.#sub(category);
    for (const [k, v] of sub.map) if (v instanceof PdfRef && value instanceof PdfRef && v.key === value.key) return k;
    let i = 1;
    while (sub.has(prefix + i)) i++;
    sub.set(prefix + i, value);
    return prefix + i;
  }
  /** The name of a font in the resources (added if it isn't there). */
  font(ref: PdfRef): string {
    return this.#add("Font", "F", ref);
  }
  /** The name of an image or form XObject. */
  xobject(ref: PdfRef): string {
    return this.#add("XObject", "Im", ref);
  }
  /**
   * A graphics state with the given fill opacity `ca`, stroke opacity `CA` (0 to 1) and blend mode (`Multiply`, `Screen`,
   * ... ); the same settings give the same name.
   */
  extGState(settings: { fillOpacity?: number; strokeOpacity?: number; blendMode?: string }): string {
    const sub = this.#sub("ExtGState");
    const want = new PdfDict({ Type: PdfName.of("ExtGState") });
    if (settings.fillOpacity !== undefined) want.set("ca", settings.fillOpacity);
    if (settings.strokeOpacity !== undefined) want.set("CA", settings.strokeOpacity);
    if (settings.blendMode) want.set("BM", PdfName.of(settings.blendMode));
    const key = JSON.stringify([...want.map].map(([k, v]) => [k, v instanceof PdfName ? v.value : v]));
    for (const [k, v] of sub.map) {
      if (v instanceof PdfDict && JSON.stringify([...v.map].map(([kk, vv]) => [kk, vv instanceof PdfName ? vv.value : vv])) === key) return k;
    }
    let i = 1;
    while (sub.has("GS" + i)) i++;
    sub.set("GS" + i, want);
    return "GS" + i;
  }
}
