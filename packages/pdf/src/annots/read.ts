/**
 * PDF annotations to JSON. Reading never throws: an annotation that cannot be understood is skipped (it stays in the
 * file, untouched), and so are the types Pli does not edit (widgets are the forms'; popups are folded into their note).
 */
import type { Thread } from "@pli.dev/core";
import type { ReadContext } from "../context";
import { decodeStreamPartial, streamFilters } from "../cos/filters";
import type { PageInfo } from "../cos/file";
import { PdfDict, PdfRef, PdfStream, isArray, isDict, isName, isStream, isString, textOf, type PdfObj } from "../cos/objects";
import { jpegInfo } from "../image";
import { extractText } from "../text";
import type { PageText } from "../content/text";
import type { Annotation, AnnotBase, AnnotReply, FreeTextAnnot, LineEnd, NoteAnnot, Page, PdfAnchor, PdfPicture, Pt, Rect, StrokeStyle, TextStyle } from "../model";
import { anchorOf, ptFromPdf, rectFromPdf, type Box } from "./geometry";
import { PLI_AUTHOR, PLI_BORDER, PLI_SIGNATURE, PLI_STAMP } from "./keys";
import { base64Encode, colorFromArray, dictOf, encodePng, nameOf, num, numbers, parseDate, stringOf, type Resolver } from "./util";

export interface ReadEnv {
  src: Resolver;
  decode(s: PdfStream): Uint8Array;
  sourceId: string;
  box: Box;
  pageIdByRef?: ReadonlyMap<string, string>;
  catalog?: PdfDict;
}

/** The subtypes Pli reads. */
export const READ_SUBTYPES: ReadonlySet<string> = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly", "Ink", "Square", "Circle", "Line", "Polygon", "PolyLine", "FreeText", "Text", "Stamp", "Link", "Redact"]);

/** The types whose `/Contents` is a comment (a free text box's or a stamp's is its own text). */
const COMMENTABLE = new Set(["highlight", "underline", "strikeout", "squiggly", "ink", "square", "circle", "line", "polygon", "polyline", "note"]);

const flagBits = (f: number | undefined) => ({ hidden: !!f && (f & 2) !== 0, locked: !!f && (f & 128) !== 0 });

const normalizeNewlines = (s: string): string => s.replace(/\r\n?/g, "\n");

function textEntry(src: Resolver, d: PdfDict, key: string): string | undefined {
  const v = src.get(d.get(key));
  if (isString(v)) return normalizeNewlines(textOf(v));
  return undefined;
}

/** A rich text string (`/RC`, XHTML) as plain text. */
function plainFromRich(src: Resolver, decode: (s: PdfStream) => Uint8Array, o: PdfObj | undefined): string | undefined {
  const v = src.get(o);
  let xml: string | undefined;
  if (isString(v)) xml = textOf(v);
  else if (isStream(v)) xml = new TextDecoder().decode(decode(v));
  if (xml === undefined) return undefined;
  const text = xml
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return normalizeNewlines(text).replace(/\n+$/, "");
}

function strokeOf(env: ReadEnv, d: PdfDict, color: string | undefined, defaultWidth = 1): StrokeStyle {
  const { src } = env;
  const bs = dictOf(src, d.get("BS"));
  let width: number | undefined = bs ? num(src.get(bs.get("W"))) : undefined;
  let dash: number[] | undefined;
  if (bs && nameOf(src, bs.get("S")) === "D") dash = numbers(src, bs.get("D")) ?? [3];
  const border = numbers(src, d.get("Border"));
  if (width === undefined && !bs && border && border.length >= 3) width = border[2];
  if (!bs && !dash) {
    const b = src.get(d.get("Border"));
    if (isArray(b) && b.length >= 4) {
      const pattern = numbers(src, b[3]);
      if (pattern && pattern.length > 0 && pattern.some((n) => n > 0)) dash = pattern;
    }
  }
  const w = Math.max(0, width ?? defaultWidth);
  return { color: color ?? "#000000", width: color === undefined ? 0 : w, ...(dash && dash.length > 0 && color !== undefined ? { dash } : {}) };
}

function lineEnd(name: string | undefined): LineEnd | undefined {
  switch (name) {
    case "OpenArrow":
    case "ROpenArrow":
      return "open-arrow";
    case "ClosedArrow":
    case "RClosedArrow":
      return "closed-arrow";
    case "Circle":
      return "circle";
    case "Square":
      return "square";
    case "Diamond":
      return "diamond";
    case "Butt":
      return "butt";
    case "Slash":
      return "slash";
    default:
      return undefined;
  }
}

// ---- Destinations ---------------------------------------------------------------------------------------------

function nameTreeLookup(src: Resolver, node: PdfObj | undefined, key: Uint8Array, depth = 0): PdfObj | undefined {
  const d = dictOf(src, node);
  if (!d || depth > 24) return undefined;
  const names = src.get(d.get("Names"));
  if (isArray(names)) {
    for (let i = 0; i + 1 < names.length; i += 2) {
      const k = src.get(names[i]);
      if (isString(k) && k.bytes.length === key.length && k.bytes.every((b, j) => b === key[j])) return names[i + 1];
    }
  }
  const kids = src.get(d.get("Kids"));
  if (isArray(kids)) {
    for (const kid of kids) {
      const r = nameTreeLookup(src, kid, key, depth + 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function namedDestination(env: ReadEnv, name: Uint8Array): PdfObj | undefined {
  const cat = env.catalog;
  if (!cat) return undefined;
  const text = String.fromCharCode(...name);
  const dests = dictOf(env.src, cat.get("Dests"));
  const direct = dests?.get(text);
  if (direct !== undefined) return direct;
  const tree = dictOf(env.src, cat.get("Names"))?.get("Dests");
  return nameTreeLookup(env.src, tree, name);
}

/** A destination (array, name, string or dictionary with `/D`) as a page and a distance from the top. */
export function readDestination(env: ReadEnv, dest: PdfObj | undefined, depth = 0): { page: string; y?: number } | undefined {
  if (depth > 4) return undefined;
  const v = env.src.get(dest);
  if (isName(v)) return readDestination(env, namedDestination(env, new TextEncoder().encode(v.value)), depth + 1);
  if (isString(v)) return readDestination(env, namedDestination(env, v.bytes), depth + 1);
  if (isDict(v)) return readDestination(env, v.get("D"), depth + 1);
  if (!isArray(v) || v.length < 2) return undefined;
  const first = v[0];
  if (!(first instanceof PdfRef)) return undefined;
  const page = env.pageIdByRef?.get(first.key);
  if (!page) return undefined;
  const kind = nameOf(env.src, v[1]);
  const at = (i: number): number | undefined => num(env.src.get(v[i]));
  let top: number | undefined;
  if (kind === "XYZ") top = at(3);
  else if (kind === "FitH" || kind === "FitBH") top = at(2);
  else if (kind === "FitR") top = at(5);
  return top === undefined ? { page } : { page, y: Math.max(0, env.box[3] - top) };
}

// ---- Pictures -------------------------------------------------------------------------------------------------

function activeAppearance(src: Resolver, d: PdfDict): PdfStream | undefined {
  const ap = dictOf(src, d.get("AP"));
  const n = src.get(ap?.get("N"));
  if (isStream(n)) return n;
  if (isDict(n)) {
    const state = nameOf(src, d.get("AS"));
    const pick = (state ? src.get(n.get(state)) : null) ?? null;
    if (isStream(pick)) return pick;
    for (const v of n.map.values()) {
      const s = src.get(v);
      if (isStream(s)) return s;
    }
  }
  return undefined;
}

/** The one image an appearance stream consists of, if it is a picture (a form with a single image, perhaps one form deeper). */
function singleImage(src: Resolver, form: PdfStream, depth = 0): PdfStream | undefined {
  const res = dictOf(src, form.dict.get("Resources"));
  const xo = dictOf(src, res?.get("XObject"));
  if (!xo || xo.map.size !== 1) return undefined;
  const x = src.get([...xo.map.values()][0]);
  if (!isStream(x)) return undefined;
  const sub = nameOf(src, x.dict.get("Subtype"));
  if (sub === "Image") return x;
  if (sub === "Form" && depth < 2) return singleImage(src, x, depth + 1);
  return undefined;
}

function componentsOf(src: Resolver, cs: PdfObj | undefined): number | undefined {
  const v = src.get(cs);
  if (isName(v)) {
    if (v.value === "DeviceRGB" || v.value === "CalRGB" || v.value === "RGB") return 3;
    if (v.value === "DeviceGray" || v.value === "CalGray" || v.value === "G") return 1;
    return undefined;
  }
  if (isArray(v) && v.length > 0) {
    const kind = nameOf(src, v[0]);
    if (kind === "ICCBased") {
      const s = src.get(v[1]);
      const n = isStream(s) ? num(src.get(s.dict.get("N"))) : undefined;
      return n === 1 || n === 3 ? n : undefined;
    }
    if (kind === "CalRGB") return 3;
    if (kind === "CalGray") return 1;
  }
  return undefined;
}

/** A picture (data URI) from an image XObject: JPEG as it is, other 8 bit RGB and grey images as PNG. Undefined when that isn't easy. */
export function pictureFromImage(env: Pick<ReadEnv, "src">, image: PdfStream): PdfPicture | undefined {
  const { src } = env;
  const width = num(src.get(image.dict.get("Width")));
  const height = num(src.get(image.dict.get("Height")));
  if (!width || !height || width * height > 40_000_000) return undefined;
  if (src.get(image.dict.get("ImageMask")) === true) return undefined;
  const filters = streamFilters(image.dict, (o) => src.get(o)).names;
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    const info = jpegInfo(image.data);
    if (!info || info.components === 4) return undefined;
    return { src: `data:image/jpeg;base64,${base64Encode(image.data)}`, width, height };
  }
  const partial = decodeStreamPartial(image, (o) => src.get(o));
  if (partial.remaining.length > 0) return undefined;
  if (num(src.get(image.dict.get("BitsPerComponent"))) !== 8) return undefined;
  const channels = componentsOf(src, image.dict.get("ColorSpace"));
  if (!channels) return undefined;
  if (src.get(image.dict.get("Decode")) !== null && src.get(image.dict.get("Decode")) !== undefined) return undefined;
  if (partial.data.length < width * height * channels) return undefined;
  let alpha: Uint8Array | undefined;
  const mask = src.get(image.dict.get("SMask"));
  if (isStream(mask)) {
    const mw = num(src.get(mask.dict.get("Width")));
    const mh = num(src.get(mask.dict.get("Height")));
    const m = decodeStreamPartial(mask, (o) => src.get(o));
    if (mw === width && mh === height && m.remaining.length === 0 && m.data.length >= width * height && num(src.get(mask.dict.get("BitsPerComponent"))) === 8) alpha = m.data;
  }
  const count = width * height;
  const out = new Uint8Array(count * (channels + (alpha ? 1 : 0)));
  if (!alpha) out.set(partial.data.subarray(0, count * channels));
  else for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++) out[i * (channels + 1) + c] = partial.data[i * channels + c]!;
    out[i * (channels + 1) + channels] = alpha[i]!;
  }
  const png = encodePng(width, height, (channels + (alpha ? 1 : 0)) as 1 | 2 | 3 | 4, out);
  return { src: `data:image/png;base64,${base64Encode(png)}`, width, height };
}

// ---- Text styles ----------------------------------------------------------------------------------------------

const DA_FONTS: Record<string, [string, boolean, boolean]> = {
  Helv: ["Helvetica", false, false],
  HeBo: ["Helvetica", true, false],
  HeOb: ["Helvetica", false, true],
  HeBO: ["Helvetica", true, true],
  TiRo: ["Times", false, false],
  TiBo: ["Times", true, false],
  TiIt: ["Times", false, true],
  TiBI: ["Times", true, true],
  Cour: ["Courier", false, false],
  CoBo: ["Courier", true, false],
  CoOb: ["Courier", false, true],
  CoBO: ["Courier", true, true],
};

/** A family, weight and slant from a font's PostScript name (`ABCDEF+Arial-BoldMT`, `Times-Roman`, `Helvetica-BoldOblique`). */
export function familyOfBaseFont(base: string): { family: string; bold: boolean; italic: boolean } {
  const clean = base.replace(/^[A-Z]{6}\+/, "");
  const bold = /bold|black|heavy|semibold/i.test(clean);
  const italic = /italic|oblique/i.test(clean);
  let family = clean.split(/[-,]/)[0]!.replace(/(MT|PS)$/, "");
  family = family.replace(/(Bold|Italic|Oblique|Regular|Roman)+$/i, "") || family;
  if (/^times/i.test(family)) family = /newroman/i.test(family) ? "Times New Roman" : "Times";
  else family = family.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/^helvetica|^arial$/i.test(family)) family = /^arial/i.test(family) ? "Arial" : "Helvetica";
  return { family: family || "Helvetica", bold, italic };
}

function readTextStyle(env: ReadEnv, d: PdfDict): TextStyle {
  const { src } = env;
  const style: TextStyle = { family: "Helvetica", size: 12, color: "#000000" };
  const da = stringOf(src, d.get("DA")) ?? "";
  const tok = da.split(/\s+/).filter(Boolean);
  let fontName: string | undefined;
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i]!;
    const n = (k: number) => Number(tok[i - k]);
    if (t === "Tf" && i >= 2) {
      fontName = tok[i - 2]!.replace(/^\//, "");
      if (Number.isFinite(n(1)) && n(1) > 0) style.size = n(1);
    } else if (t === "rg" && i >= 3) style.color = colorFromArray(src, [n(3), n(2), n(1)]) ?? style.color;
    else if (t === "g" && i >= 1) style.color = colorFromArray(src, [n(1)]) ?? style.color;
    else if (t === "k" && i >= 4) style.color = colorFromArray(src, [n(4), n(3), n(2), n(1)]) ?? style.color;
  }
  if (fontName) {
    const known = DA_FONTS[fontName];
    if (known) {
      style.family = known[0];
      if (known[1]) style.bold = true;
      if (known[2]) style.italic = true;
    } else {
      const dr = dictOf(src, dictOf(src, dictOf(src, env.catalog?.get("AcroForm"))?.get("DR"))?.get("Font"));
      const font = dictOf(src, dr?.get(fontName));
      const base = nameOf(src, font?.get("BaseFont")) ?? fontName;
      const f = familyOfBaseFont(base);
      style.family = f.family;
      if (f.bold) style.bold = true;
      if (f.italic) style.italic = true;
    }
  }
  const ds = stringOf(src, d.get("DS"));
  if (ds) {
    const font = /font:\s*([^;]*)/i.exec(ds)?.[1];
    if (font) {
      const words = font.replace(/\d+(\.\d+)?\s*(pt|px)/gi, " ").split(/[\s]+/).filter(Boolean);
      const bold = words.some((w) => /^bold$/i.test(w));
      const italic = words.some((w) => /^(italic|oblique)$/i.test(w));
      const family = words.filter((w) => !/^(bold|italic|oblique|normal|regular)$/i.test(w)).join(" ").split(",")[0]!.replace(/^["']|["']$/g, "").trim();
      if (family && !/^(sans-serif|serif|monospace)$/i.test(family)) style.family = family;
      if (bold) style.bold = true;
      if (italic) style.italic = true;
    }
  }
  const q = num(src.get(d.get("Q")));
  if (q === 1) style.align = "center";
  else if (q === 2) style.align = "right";
  return style;
}

// ---- One annotation -------------------------------------------------------------------------------------------

const ICONS: Record<string, NoteAnnot["icon"]> = { Comment: "comment", Note: "note", Help: "help", Insert: "insert", Key: "key", NewParagraph: "paragraph", Paragraph: "paragraph" };

function baseOf(env: ReadEnv, ref: PdfRef, d: PdfDict): AnnotBase {
  const { src } = env;
  const base: AnnotBase = { id: `a:${env.sourceId}:${ref.num}`, ref: ref.key };
  const author = stringOf(src, d.get(PLI_AUTHOR));
  if (author) base.author = author;
  const authorName = textEntry(src, d, "T");
  if (authorName) base.authorName = authorName;
  const created = parseDate(stringOf(src, d.get("CreationDate")));
  if (created !== undefined) base.created = created;
  const modified = parseDate(stringOf(src, d.get("M")));
  if (modified !== undefined) base.modified = modified;
  const contents = textEntry(src, d, "Contents");
  if (contents) base.contents = contents;
  const ca = num(src.get(d.get("CA")));
  if (ca !== undefined && ca < 1) base.opacity = Math.max(0, ca);
  if (stringOf(src, d.get("State")) === "Completed") base.resolved = true;
  const f = num(src.get(d.get("F")));
  const { hidden, locked } = flagBits(f);
  if (hidden) base.hidden = true;
  if (locked) base.locked = true;
  return base;
}

function quadRects(env: ReadEnv, d: PdfDict, rect: number[] | undefined): Rect[] {
  const q = numbers(env.src, d.get("QuadPoints"));
  const rects: Rect[] = [];
  if (q && q.length >= 8) {
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i]!, q[i + 2]!, q[i + 4]!, q[i + 6]!];
      const ys = [q[i + 1]!, q[i + 3]!, q[i + 5]!, q[i + 7]!];
      rects.push(rectFromPdf(env.box, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
    }
  } else if (rect) rects.push(rectFromPdf(env.box, rect));
  return rects;
}

function pairs(env: ReadEnv, flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(ptFromPdf(env.box, flat[i]!, flat[i + 1]!));
  return out;
}

/** Reads one annotation dictionary. Throws when it cannot be understood. */
export function readAnnotation(env: ReadEnv, ref: PdfRef, d: PdfDict): Annotation | undefined {
  const { src } = env;
  const subtype = nameOf(src, d.get("Subtype"));
  if (!subtype || !READ_SUBTYPES.has(subtype)) return undefined;
  const rectArr = numbers(src, d.get("Rect"));
  if (!rectArr || rectArr.length < 4) throw new Error("annotation without a Rect");
  const base = baseOf(env, ref, d);
  const rect = rectFromPdf(env.box, rectArr);
  const c = colorFromArray(src, d.get("C"));
  const ic = colorFromArray(src, d.get("IC"));
  switch (subtype) {
    case "Highlight":
    case "Underline":
    case "StrikeOut":
    case "Squiggly": {
      const rects = quadRects(env, d, rectArr);
      if (rects.length === 0) throw new Error("markup without quads");
      const type = subtype === "Highlight" ? "highlight" : subtype === "Underline" ? "underline" : subtype === "StrikeOut" ? "strikeout" : "squiggly";
      return { ...base, type, color: c ?? (type === "highlight" ? "#ffff00" : "#000000"), rects };
    }
    case "Ink": {
      const list = src.get(d.get("InkList"));
      if (!isArray(list)) throw new Error("ink without InkList");
      const strokes: Pt[][] = [];
      for (const s of list) {
        const flat = numbers(src, s);
        if (flat && flat.length >= 2) strokes.push(pairs(env, flat));
      }
      if (strokes.length === 0) throw new Error("ink without strokes");
      return { ...base, type: "ink", strokes, stroke: strokeOf(env, d, c ?? "#000000") };
    }
    case "Square":
    case "Circle": {
      const stroke = strokeOf(env, d, c);
      const rd = numbers(src, d.get("RD"));
      const half = stroke.width / 2;
      const [l, b, r, t] = rd && rd.length >= 4 ? (rd as [number, number, number, number]) : [half, half, half, half];
      // The shape is the Rect less RD; the box we keep is that shape with its stroke (so it is the Rect when RD is the stroke's half width).
      const w = Math.max(0, rect.w - l - r + stroke.width);
      const h = Math.max(0, rect.h - t - b + stroke.width);
      const shape: Rect = { x: rect.x + l - half, y: rect.y + t - half, w, h };
      return { ...base, type: subtype === "Square" ? "square" : "circle", rect: shape, stroke, ...(ic ? { fill: ic } : {}) };
    }
    case "Line": {
      const l = numbers(src, d.get("L"));
      if (!l || l.length < 4) throw new Error("line without L");
      const le = src.get(d.get("LE"));
      let startEnd: LineEnd | undefined;
      let endEnd: LineEnd | undefined;
      if (isArray(le)) {
        startEnd = lineEnd(nameOf(src, le[0]));
        endEnd = lineEnd(nameOf(src, le[1]));
      } else if (isName(le)) startEnd = endEnd = lineEnd(le.value);
      return { ...base, type: "line", from: ptFromPdf(env.box, l[0]!, l[1]!), to: ptFromPdf(env.box, l[2]!, l[3]!), stroke: strokeOf(env, d, c), ...(startEnd ? { startEnd } : {}), ...(endEnd ? { endEnd } : {}) };
    }
    case "Polygon":
    case "PolyLine": {
      const v = numbers(src, d.get("Vertices"));
      if (!v || v.length < 4) throw new Error("polygon without Vertices");
      return { ...base, type: subtype === "Polygon" ? "polygon" : "polyline", points: pairs(env, v), stroke: strokeOf(env, d, c), ...(ic ? { fill: ic } : {}) };
    }
    case "FreeText": {
      const style = readTextStyle(env, d);
      const rd = numbers(src, d.get("RD"));
      let box = rect;
      if (rd && rd.length >= 4 && rect.w - rd[0]! - rd[2]! > 0 && rect.h - rd[1]! - rd[3]! > 0) box = { x: rect.x + rd[0]!, y: rect.y + rd[3]!, w: rect.w - rd[0]! - rd[2]!, h: rect.h - rd[1]! - rd[3]! };
      const text = base.contents ?? plainFromRich(src, env.decode, d.get("RC")) ?? "";
      const bs = dictOf(src, d.get("BS"));
      const width = bs ? num(src.get(bs.get("W"))) : (numbers(src, d.get("Border")) ?? [])[2];
      const borderColor = stringOf(src, d.get(PLI_BORDER)) ?? "#000000";
      const out: FreeTextAnnot = { ...base, type: "freetext", rect: box, text, style };
      delete out.contents;
      if (c) out.fill = c;
      if (width !== undefined && width > 0) {
        const dash = strokeOf(env, d, borderColor, width).dash;
        out.stroke = { color: borderColor, width, ...(dash ? { dash } : {}) };
      }
      return out;
    }
    case "Text": {
      const name = nameOf(src, d.get("Name"));
      const note: NoteAnnot = { ...base, type: "note", x: rect.x, y: rect.y, icon: (name && ICONS[name]) || "note" };
      if (c) note.color = c;
      if (src.get(d.get("Open")) === true) note.open = true;
      return note;
    }
    case "Stamp": {
      const name = nameOf(src, d.get("Name")) ?? "Draft";
      const sig = dictOf(src, d.get(PLI_SIGNATURE));
      const ap = activeAppearance(src, d);
      const image = ap ? singleImage(src, ap) : undefined;
      const picture = image ? pictureFromImage(env, image) : undefined;
      if (sig) {
        const mode = nameOf(src, sig.get("Mode"));
        if (mode === "draw" || mode === "type" || mode === "image") {
          const strokes: Pt[][] = [];
          const list = src.get(sig.get("Strokes"));
          if (isArray(list)) for (const s of list) {
            const flat = numbers(src, s);
            if (flat) strokes.push(Array.from({ length: Math.floor(flat.length / 2) }, (_, i): Pt => [flat[2 * i]!, flat[2 * i + 1]!]));
          }
          const out: Annotation = { ...base, type: "signature", rect, mode };
          if (mode === "draw") out.strokes = strokes;
          const text = textEntry(src, sig, "Text");
          if (text !== undefined) out.text = text;
          const font = textEntry(src, sig, "Font");
          if (font) out.font = font;
          const color = textEntry(src, sig, "Color");
          if (color) out.color = color;
          const width = num(src.get(sig.get("W")));
          if (width !== undefined) out.width = width;
          const field = textEntry(src, sig, "Field");
          if (field) out.field = field;
          if (mode === "image" && picture) out.picture = picture;
          delete out.contents;
          if (mode !== "image" || picture) return out;
        }
      }
      if (name === "ImageAnnot" && picture) return { ...base, type: "image", rect, picture };
      if (picture) return { ...base, type: "stamp", rect, stamp: { picture } };
      const pliStamp = dictOf(src, d.get(PLI_STAMP));
      const label = pliStamp ? textEntry(src, pliStamp, "Label") : undefined;
      const stampColor = pliStamp ? textEntry(src, pliStamp, "Color") : undefined;
      const out: Annotation = { ...base, type: "stamp", rect, stamp: { name, ...(label ? { label } : {}), ...(stampColor ? { color: stampColor } : c && !pliStamp ? { color: c } : {}) } };
      if (out.contents === name) delete out.contents;
      return out;
    }
    case "Link": {
      const action = dictOf(src, d.get("A"));
      let uri: string | undefined;
      let dest: { page: string; y?: number } | undefined;
      if (action) {
        const s = nameOf(src, action.get("S"));
        if (s === "URI") {
          const v = src.get(action.get("URI"));
          if (isString(v)) uri = String.fromCharCode(...v.bytes);
        } else if (s === "GoTo") dest = readDestination(env, action.get("D"));
      } else if (d.has("Dest")) dest = readDestination(env, d.get("Dest"));
      if (uri) return { ...base, type: "link", rect, uri };
      if (dest) return { ...base, type: "link", rect, dest };
      return undefined;
    }
    case "Redact": {
      const rects = quadRects(env, d, rectArr);
      const overlay = textEntry(src, d, "OverlayText");
      return { ...base, type: "redact", rects, fill: ic ?? "#000000", ...(overlay ? { overlay } : {}) };
    }
  }
  return undefined;
}

// ---- A page -----------------------------------------------------------------------------------------------------

interface Raw {
  ref: PdfRef;
  dict: PdfDict;
}

/** The annotation entries of a page: references to dictionaries (direct dictionaries in the array cannot be replaced in place and are not read). */
export function pageAnnotEntries(src: Resolver, pageDict: PdfDict): Raw[] {
  const arr = src.get(pageDict.get("Annots"));
  const out: Raw[] = [];
  if (!isArray(arr)) return out;
  for (const e of arr) {
    if (!(e instanceof PdfRef)) continue;
    const d = src.get(e);
    if (isDict(d)) out.push({ ref: e, dict: d });
  }
  return out;
}

/** The thread id and first comment id of an annotation id (`a:main:12` gives `t:main:12`, `c:main:12`). */
export const threadIdOf = (annotId: string): string => `t${annotId.slice(1)}`;
export const commentIdOf = (annotId: string): string => `c${annotId.slice(1)}`;

/** The annotations of one page of a file, as JSON. Annotation types Pli does not edit are left out (and kept in the file). */
export function readAnnotations(ctx: ReadContext, page: PageInfo, pageId: string): Annotation[] {
  const out: Annotation[] = [];
  try {
    const { file } = ctx;
    let catalog: PdfDict | undefined;
    try {
      catalog = file.catalog();
    } catch {
      catalog = undefined;
    }
    const env: ReadEnv = { src: file, decode: (s) => file.decode(s), sourceId: ctx.sourceId, box: page.cropBox, pageIdByRef: ctx.pageIdByRef, catalog };
    void pageId;
    const entries = pageAnnotEntries(file, page.dict);
    const replyOf = new Map<string, Raw[]>();
    const isReply = new Set<string>();
    const rootKey = (e: Raw): string | undefined => {
      let cur: PdfObj | undefined = e.dict.get("IRT");
      for (let hops = 0; hops < 16 && cur instanceof PdfRef; hops++) {
        const target = file.get(cur);
        if (!isDict(target)) return undefined;
        if (!target.has("IRT")) return cur.key;
        cur = target.get("IRT");
      }
      return undefined;
    };
    for (const e of entries) {
      if (!e.dict.has("IRT")) continue;
      isReply.add(e.ref.key);
      if (nameOf(file, e.dict.get("Subtype")) !== "Text") continue;
      const root = rootKey(e);
      if (root) (replyOf.get(root) ?? replyOf.set(root, []).get(root)!).push(e);
    }
    const marked: Annotation[] = [];
    for (const e of entries) {
      if (isReply.has(e.ref.key)) continue;
      let annot: Annotation | undefined;
      try {
        annot = readAnnotation(env, e.ref, e.dict);
      } catch {
        annot = undefined;
      }
      if (!annot) continue;
      attachReplies(env, annot, replyOf.get(e.ref.key) ?? []);
      out.push(annot);
      if (annot.type === "highlight" || annot.type === "underline" || annot.type === "strikeout" || annot.type === "squiggly") marked.push(annot);
    }
    if (marked.length > 0) addQuotes(ctx, page, marked);
  } catch {
    // A damaged /Annots array: what was read stays.
  }
  return out;
}

/** The most pages per file whose text is read to find the quotes of markup: reading a page's text costs a pass over its content. */
const QUOTE_PAGES = 100;
const quoted = new WeakMap<object, number>();

/** The words under a markup's rectangles, for the comment list and search. Left out when the page has no text there (or too many pages ask). */
function addQuotes(ctx: ReadContext, page: PageInfo, marks: Annotation[]): void {
  const n = quoted.get(ctx.file) ?? 0;
  if (n >= QUOTE_PAGES) return;
  quoted.set(ctx.file, n + 1);
  let text: PageText;
  try {
    text = extractText(ctx.file, page.index);
  } catch {
    return;
  }
  const byId = new Map(text.runs.map((r) => [r.id, r]));
  for (const a of marks) {
    if (a.type !== "highlight" && a.type !== "underline" && a.type !== "strikeout" && a.type !== "squiggly") continue;
    const parts: string[] = [];
    for (const r of a.rects) {
      let line = "";
      let lastLine = -1;
      for (const [li, l] of text.lines.entries()) {
        if (l.box.y > r.y + r.h || l.box.y + l.box.h < r.y) continue;
        for (const id of l.runs) {
          const run = byId.get(id);
          if (!run) continue;
          for (const g of run.glyphs) {
            const cx = g.box.x + g.box.w / 2;
            const cy = g.box.y + g.box.h / 2;
            if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) continue;
            if (lastLine !== -1 && lastLine !== li) line += " ";
            lastLine = li;
            line += g.char;
          }
        }
      }
      if (line.trim()) parts.push(line.trim());
    }
    const quote = parts.join(" ").replace(/\s+/g, " ").trim();
    if (quote) a.quote = quote;
  }
}

function attachReplies(env: ReadEnv, annot: Annotation, replies: Raw[]): void {
  const { src } = env;
  const list: AnnotReply[] = [];
  let resolved: boolean | undefined;
  for (const r of replies) {
    const state = stringOf(src, r.dict.get("State"));
    if (state !== undefined) {
      resolved = state === "Completed";
      continue;
    }
    const reply: AnnotReply = { id: `c:${env.sourceId}:${r.ref.num}`, body: textEntry(src, r.dict, "Contents") ?? "", ref: r.ref.key };
    const authorName = textEntry(src, r.dict, "T");
    if (authorName) reply.authorName = authorName;
    const author = stringOf(src, r.dict.get(PLI_AUTHOR));
    if (author) reply.author = author;
    const created = parseDate(stringOf(src, r.dict.get("CreationDate"))) ?? parseDate(stringOf(src, r.dict.get("M")));
    if (created !== undefined) reply.created = created;
    list.push(reply);
  }
  if (list.length > 0) annot.replies = list;
  if (resolved !== undefined) annot.resolved = resolved || undefined;
  if (annot.resolved === undefined) delete annot.resolved;
  if (annot.type !== "link" && (list.length > 0 || (annot.contents && COMMENTABLE.has(annot.type)))) annot.thread = threadIdOf(annot.id);
}

/** Comment threads found in the annotations (a note's text and its replies), for `PdfDoc.comments`. */
export function readThreads(pages: readonly Page[]): Record<string, Thread<PdfAnchor>> {
  const out: Record<string, Thread<PdfAnchor>> = {};
  for (const page of pages) {
    for (const a of page.annots) {
      if (!a.thread || (!a.contents && !(a.replies && a.replies.length > 0))) continue;
      const first = { id: commentIdOf(a.id), author: a.author ?? a.authorName ?? "", body: a.contents ?? "", createdAt: a.created ?? 0 };
      const comments = [first, ...(a.replies ?? []).map((r) => ({ id: r.id, author: r.author ?? r.authorName ?? "", body: r.body, createdAt: r.created ?? a.created ?? 0 }))];
      const at = anchorOf(a);
      const thread: Thread<PdfAnchor> = {
        id: a.thread,
        anchor: { page: page.id, annot: a.id, x: at.x, y: at.y, ...(at.quote ? { quote: at.quote } : {}) },
        comments,
        createdAt: first.createdAt,
        ...(a.resolved ? { resolved: { by: a.authorName ?? "", at: a.modified ?? first.createdAt } } : {}),
      };
      out[thread.id] = thread;
    }
  }
  return out;
}

