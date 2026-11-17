import { isOfficeFont, officeHint } from "@pli.dev/core";
import { parseHex } from "../color";
import { isSymbolFont } from "../fonts";
import type { ArrowEnd, Bullet, Color, Crop, CustomGeometry, DashStyle, Fill, ImageFill, Layout, LevelStyle, Line, Marks, Master, ParaProps, Paragraph, Shadow, SlideSize, TextBody, ThemeSlot } from "../model";
import { xmlEscape, Part, REL } from "./opc";
import { transparentPng } from "./png";

/**
 * DrawingML and PresentationML pieces: colours, fills, lines, text. Everything here returns XML text in the exact
 * child order of the schema (ECMA-376 Part 1), because PowerPoint refuses (or "repairs") files that get it wrong.
 */

export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const NS_ALL = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

export const EMU_PER_PT = 12700;
export const emu = (pt: number): number => Math.round((Number.isFinite(pt) ? pt : 0) * EMU_PER_PT);
const int = (n: number): number => Math.round(Number.isFinite(n) ? n : 0);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Escapes an attribute value; line breaks are kept as character references because attributes normalise them. */
export const attrEsc = (value: string): string => xmlEscape(value).replace(/\r?\n/g, "&#10;").replace(/\t/g, "&#9;");

type AttrValue = string | number | boolean | undefined;

export function attrs(values: Record<string, AttrValue>): string {
  let out = "";
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out += ` ${k}="${typeof v === "string" ? attrEsc(v) : typeof v === "boolean" ? (v ? "1" : "0") : v}"`;
  }
  return out;
}

/** An element; self-closing when it has no content. */
export function tag(name: string, a: Record<string, AttrValue> = {}, inner = ""): string {
  return inner === "" ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${inner}</${name}>`;
}

// ---- Custom geometry ---------------------------------------------------------------------------------------------

const guideAttr = (v: unknown): string | number => (typeof v === "string" && v !== "" ? v : int(typeof v === "number" ? v : 0));

/** `a:custGeom` in schema order: avLst, gdLst, ahLst, cxnLst, rect, pathLst. */
export function custGeomXml(custom: CustomGeometry): string {
  const av = Object.entries(custom.adjust ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .map(([name, v]) => tag("a:gd", { name, fmla: `val ${int(v)}` }))
    .join("");
  const gd = (custom.guides ?? []).map((g) => tag("a:gd", { name: g.name, fmla: g.fmla })).join("");
  const r = custom.rect;
  const rect = tag("a:rect", { l: guideAttr(r?.l ?? "l"), t: guideAttr(r?.t ?? "t"), r: guideAttr(r?.r ?? "r"), b: guideAttr(r?.b ?? "b") });
  const paths = custom.paths
    .map((p) => {
      // The file format keeps whole numbers; a path drawn in small fractional units is scaled up to carry them.
      const nums = p.commands.flatMap((c) => c.slice(1).map((v, i) => (c[0] === "A" && i >= 2 ? Number.NaN : v)));
      const fractional = nums.some((v) => typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) || !Number.isInteger(p.w) || !Number.isInteger(p.h);
      const k = fractional && !nums.some((v) => typeof v === "string") && Math.max(p.w, p.h) * 1000 < 2_000_000_000 ? 1000 : 1;
      const at = (v: unknown): string | number => (typeof v === "number" ? int(v * k) : guideAttr(v));
      const pt = (x: unknown, y: unknown) => tag("a:pt", { x: at(x), y: at(y) });
      const body = p.commands
        .map((c) => {
          switch (c[0]) {
            case "M":
              return tag("a:moveTo", {}, pt(c[1], c[2]));
            case "L":
              return tag("a:lnTo", {}, pt(c[1], c[2]));
            case "C":
              return tag("a:cubicBezTo", {}, pt(c[1], c[2]) + pt(c[3], c[4]) + pt(c[5], c[6]));
            case "Q":
              return tag("a:quadBezTo", {}, pt(c[1], c[2]) + pt(c[3], c[4]));
            case "A":
              return tag("a:arcTo", { wR: at(c[1]), hR: at(c[2]), stAng: guideAttr(c[3]), swAng: guideAttr(c[4]) });
            case "Z":
              return tag("a:close");
            default:
              return "";
          }
        })
        .join("");
      return tag("a:path", { w: p.w > 0 ? int(p.w * k) : undefined, h: p.h > 0 ? int(p.h * k) : undefined, fill: p.fill && p.fill !== "norm" ? p.fill : undefined, stroke: p.stroke === false ? false : undefined }, body);
    })
    .join("");
  return tag("a:custGeom", {}, tag("a:avLst", {}, av) + tag("a:gdLst", {}, gd) + tag("a:ahLst") + tag("a:cxnLst") + rect + tag("a:pathLst", {}, paths));
}

// ---- Package-wide state ------------------------------------------------------------------------------------------

export interface MediaFile {
  part: Part;
}

export interface PptxOptions {
  /** Written as the created and modified time, and as the modification time of every zip entry. Default: now. */
  date?: Date;
  /** Turns an SVG picture into a PNG, so programs that don't read SVG have something to show (see `toPptx`). */
  rasterizeSvg?: (svg: string, width: number, height: number) => Uint8Array | undefined;
  /**
   * What to do with font families Office doesn't have (Google fonts, fonts of the host). `"keep"` (default) writes the
   * names as they are, with a `pitchFamily` hint so that a computer without the font picks a similar one. `"office"`
   * replaces every such family by the nearest Office font (Lora becomes Georgia, Roboto Mono becomes Consolas) in
   * runs, bullets, the theme fonts and chart text, for files that must look right on any computer.
   */
  fonts?: "keep" | "office";
  /**
   * How the deck's comment threads are written: `"legacy"` (the default: PowerPoint 2007 and later, Google Slides and
   * LibreOffice read them, replies included), `"modern"` (Microsoft 365: replies, a resolved state and the shape a comment is
   * about), or `"none"`.
   */
  comments?: "legacy" | "modern" | "none";
  /** The name and initials PowerPoint shows for the author of a comment (a `PliUser.id`). Without it the id is the name. */
  commentAuthor?: (id: string) => { name: string; initials?: string } | undefined;
}

export interface WriterContext {
  options: PptxOptions;
  /** Parts for pictures, by content, so equal pictures are stored once. */
  media: Map<string, Part>;
  nextMedia: number;
  addMedia: (part: Part) => void;
  nextGuid: number;
  /** Charts written so far (for part names). */
  nextChart: number;
  /** The date written into zip entries (the embedded workbooks use it too). */
  date: Date;
}

export type Origin = "slide" | "layout" | "master";

/** What an element needs to know about the part it is written into. */
export interface Env {
  ctx: WriterContext;
  part: Part;
  nextId: number;
  origin: Origin;
  size: SlideSize;
  master: Master;
  layout?: Layout;
  /** The idx written for each placeholder of the layout and master (title placeholders are 0). */
  layoutIdx: Map<unknown, number>;
  masterIdx: Map<unknown, number>;
  /** `type:idx` of the placeholders already written to this part. */
  usedPh: Set<string>;
  /** When set, the `id` of the `p:cNvPr` written for each element (by the element's id), for the animations of a slide. */
  ids?: Map<string, number>;
}

// ---- Colour ------------------------------------------------------------------------------------------------------

/** The scheme names the elements of a slide use. Pli writes the standard colour map: bg1=lt1, tx1=dk1, bg2=lt2, tx2=dk2. */
const SCHEME: Record<ThemeSlot, string> = {
  dk1: "tx1",
  lt1: "bg1",
  dk2: "tx2",
  lt2: "bg2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

export const hex6 = (r: number, g: number, b: number): string => [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase();

const pct = (n: number): number => Math.round(n * 100000);

/** `<a:srgbClr>` or `<a:schemeClr>` with the colour transforms the model has. */
export function colorXml(color: Color | undefined, fallback = "#000000"): string {
  const c = color ?? fallback;
  if (typeof c === "string") {
    const rgba = parseHex(c);
    return tag("a:srgbClr", { val: hex6(rgba.r, rgba.g, rgba.b) }, rgba.a < 1 ? tag("a:alpha", { val: clamp(pct(rgba.a), 0, 100000) }) : "");
  }
  let inner = "";
  if (c.lumMod !== undefined) inner += tag("a:lumMod", { val: Math.max(0, pct(c.lumMod)) });
  if (c.lumOff !== undefined) inner += tag("a:lumOff", { val: pct(c.lumOff) });
  // DrawingML's tint and shade are the share of the colour that stays; the model's are how far it moves to white or black.
  if (c.tint) inner += tag("a:tint", { val: clamp(pct(1 - c.tint), 0, 100000) });
  if (c.shade) inner += tag("a:shade", { val: clamp(pct(1 - c.shade), 0, 100000) });
  if (c.alpha !== undefined && c.alpha < 1) inner += tag("a:alpha", { val: clamp(pct(c.alpha), 0, 100000) });
  return tag("a:schemeClr", { val: SCHEME[c.theme] ?? "tx1" }, inner);
}

export const solidFill = (color: Color | undefined): string => tag("a:solidFill", {}, colorXml(color));

// ---- Pictures ----------------------------------------------------------------------------------------------------

interface Decoded {
  bytes: Uint8Array;
  /** The extension of the part: `png`, `jpeg`, `gif`, `svg`... */
  ext: string;
  key: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
// base64url too
B64_INDEX.set("-", 62);
B64_INDEX.set("_", 63);

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/_-]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | (B64_INDEX.get(ch) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function sniff(bytes: Uint8Array, mime: string): string | undefined {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) return "tiff";
  const head = new TextDecoder().decode(b.subarray(0, 512));
  if (/<svg[\s>]/i.test(head)) return "svg";
  const m = /^image\/(png|jpeg|jpg|gif|svg\+xml|webp|bmp|tiff)$/i.exec(mime);
  if (m) {
    const t = m[1]!.toLowerCase();
    return t === "jpg" ? "jpeg" : t === "svg+xml" ? "svg" : t;
  }
  return undefined;
}

/** Reads a `data:` URI. Anything else (a URL) is not embedded. */
export function decodeDataUri(src: string): Decoded | undefined {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is.exec(src);
  if (!m) return undefined;
  const mime = m[1]!;
  const isBase64 = /;base64/i.test(m[2]!);
  let bytes: Uint8Array;
  try {
    bytes = isBase64 ? base64Decode(m[3]!) : new TextEncoder().encode(decodeURIComponent(m[3]!));
  } catch {
    return undefined;
  }
  const ext = sniff(bytes, mime);
  if (!ext || bytes.length === 0) return undefined;
  return { bytes, ext, key: `${ext}:${isBase64 ? "b" : "t"}:${m[3]}` };
}

function mediaPart(env: Env, d: Decoded): Part {
  const found = env.ctx.media.get(d.key);
  if (found) return found;
  const part = new Part(`ppt/media/image${++env.ctx.nextMedia}.${d.ext}`, undefined, d.bytes);
  env.ctx.media.set(d.key, part);
  env.ctx.addMedia(part);
  return part;
}

/** Normalises a hyperlink target into an absolute URI, or undefined when it can't be one. */
export function hyperlinkTarget(link: string): string | undefined {
  const t = link.trim();
  if (!t || t.startsWith("#")) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    return new URL(withScheme).href;
  } catch {
    // keep what the person typed, with the characters a URI can't hold escaped
    return withScheme.replace(/[^\x21-\x7e]/g, (ch) => encodeURIComponent(ch)).replace(/[<>"{}|\\^`]/g, (ch) => encodeURIComponent(ch));
  }
}

export function hyperlinkRel(env: Env, link: string): string | undefined {
  const target = hyperlinkTarget(link);
  return target === undefined ? undefined : env.part.relate(REL.hyperlink, target, true);
}

export function hlinkClick(env: Env, link: string | undefined): string {
  if (!link) return "";
  const id = hyperlinkRel(env, link);
  return id ? tag("a:hlinkClick", { "r:id": id }) : "";
}

const SVG_EXT_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";
const SVG_NS = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

/** `<a:blip>` for a picture, or undefined when the source can't be stored in the file. */
export function blipXml(env: Env, src: string, alphaPct?: number): string | undefined {
  const mod = alphaPct !== undefined && alphaPct < 1 ? tag("a:alphaModFix", { amt: clamp(pct(alphaPct), 0, 100000) }) : "";
  const d = decodeDataUri(src);
  if (!d) {
    if (!/^https?:\/\//i.test(src)) return undefined;
    // a picture that lives on the web: PowerPoint keeps the link and shows it when it can reach it
    let href: string;
    try {
      href = new URL(src).href;
    } catch {
      return undefined;
    }
    return tag("a:blip", { "r:link": env.part.relate(REL.image, href, true) }, mod);
  }
  if (d.ext !== "svg") {
    const id = env.part.relate(REL.image, mediaPart(env, d).name);
    return tag("a:blip", { "r:embed": id }, mod);
  }
  // SVG: PowerPoint 2016+ reads the vector from an extension and everything else shows the PNG that stands in for it
  const svgText = new TextDecoder().decode(d.bytes);
  const dims = /viewBox\s*=\s*"[^"]*?([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(svgText);
  const w = dims ? Number(dims[1]) : 96;
  const h = dims ? Number(dims[2]) : 96;
  const png = env.ctx.options.rasterizeSvg?.(svgText, w, h) ?? transparentPng();
  const pngPart = mediaPart(env, { bytes: png, ext: "png", key: `png:svgfallback:${d.key}` });
  const svgPart = mediaPart(env, d);
  const pngId = env.part.relate(REL.image, pngPart.name);
  const svgId = env.part.relate(REL.image, svgPart.name);
  const ext = tag("a:extLst", {}, tag("a:ext", { uri: SVG_EXT_URI }, `<asvg:svgBlip xmlns:asvg="${SVG_NS}" r:embed="${svgId}"/>`));
  return tag("a:blip", { "r:embed": pngId }, mod + ext);
}

export function srcRectXml(crop: Crop | undefined): string {
  if (!crop) return "";
  const a: Record<string, number> = {};
  for (const k of ["l", "t", "r", "b"] as const) if (crop[k]) a[k] = pct(crop[k]!);
  return Object.keys(a).length ? tag("a:srcRect", a) : "";
}

/** `a:blipFill` (in a shape or background) or `p:blipFill` (in a picture). */
export function blipFillXml(prefix: "a" | "p", blip: string, crop: Crop | undefined, tile: boolean): string {
  const mode = tile ? tag("a:tile", { tx: 0, ty: 0, sx: 100000, sy: 100000, flip: "none", algn: "tl" }) : tag("a:stretch", {}, tag("a:fillRect"));
  return tag(`${prefix}:blipFill`, prefix === "a" ? { dpi: 0, rotWithShape: true } : {}, blip + srcRectXml(crop) + mode);
}

// ---- Fill, line, shadow ------------------------------------------------------------------------------------------

function gradientXml(g: { kind?: "linear" | "radial"; angle?: number; center?: { x: number; y: number }; stops: { at: number; color: Color }[] }): string {
  let stops = [...g.stops].sort((a, b) => a.at - b.at);
  if (stops.length === 0) stops = [{ at: 0, color: "#000000" }, { at: 1, color: "#ffffff" }];
  if (stops.length === 1) stops = [stops[0]!, { ...stops[0]!, at: 1 }];
  const gs = stops.map((s) => tag("a:gs", { pos: clamp(pct(s.at), 0, 100000) }, colorXml(s.color))).join("");
  const shape =
    g.kind === "radial"
      ? tag("a:path", { path: "circle" }, tag("a:fillToRect", { l: pct(g.center?.x ?? 0.5), t: pct(g.center?.y ?? 0.5), r: pct(1 - (g.center?.x ?? 0.5)), b: pct(1 - (g.center?.y ?? 0.5)) }))
      : tag("a:lin", { ang: Math.round((((g.angle ?? 0) % 360) + 360) % 360 * 60000) % 21600000, scaled: false });
  return tag("a:gradFill", { rotWithShape: true }, tag("a:gsLst", {}, gs) + shape);
}

/**
 * The fill element for a shape, background or table cell. `undefined` means "inherit" (nothing written) unless
 * `inheritNone` says to write `noFill`; `null` is no fill. Returns "" when nothing should be written.
 */
export function fillXml(fill: Fill | null | undefined, env: Env, noneWhenUnset = false): string {
  if (fill === undefined) return noneWhenUnset ? tag("a:noFill") : "";
  if (fill === null) return tag("a:noFill");
  if (typeof fill === "string" || "theme" in fill) return solidFill(fill);
  if ("gradient" in fill) return gradientXml(fill.gradient);
  const image: ImageFill = fill.image;
  const blip = blipXml(env, image.src, image.alpha);
  return blip ? blipFillXml("a", blip, image.crop, image.mode === "tile") : tag("a:noFill");
}

const DASH: Record<DashStyle, string> = { solid: "solid", dot: "dot", dash: "dash", dashDot: "dashDot", longDash: "lgDash", longDashDot: "lgDashDot", sysDot: "sysDot", sysDash: "sysDash" };
const ARROW: Record<ArrowEnd, string> = { none: "none", triangle: "triangle", stealth: "stealth", diamond: "diamond", oval: "oval", open: "arrow" };
const CAP = { flat: "flat", round: "rnd", square: "sq" } as const;

/**
 * An outline element (`a:ln`, or `a:lnL`... for a table cell). `null` and a width of 0 are no line; `undefined`
 * writes nothing unless `noneWhenUnset` is set.
 */
export function lineXml(line: Line | null | undefined, name = "a:ln", noneWhenUnset = false): string {
  if (line === undefined) return noneWhenUnset ? tag(name, {}, tag("a:noFill")) : "";
  if (line === null || line.width === 0) return tag(name, { w: 0 }, tag("a:noFill"));
  const w = clamp(emu(line.width ?? 1), 0, 20116800);
  let inner = solidFill(line.color ?? { theme: "dk1" });
  inner += tag("a:prstDash", { val: DASH[line.dash ?? "solid"] ?? "solid" });
  if (line.join) inner += line.join === "round" ? tag("a:round") : line.join === "bevel" ? tag("a:bevel") : tag("a:miter", { lim: 800000 });
  if (line.head && line.head !== "none") inner += tag("a:headEnd", { type: ARROW[line.head] });
  if (line.tail && line.tail !== "none") inner += tag("a:tailEnd", { type: ARROW[line.tail] });
  return tag(name, { w, cap: line.cap ? CAP[line.cap] : undefined }, inner);
}

export function effectXml(shadow: Shadow | null | undefined): string {
  if (!shadow) return "";
  const dx = shadow.dx ?? 2;
  const dy = shadow.dy ?? 2;
  const dist = Math.hypot(dx, dy);
  const dir = (((Math.atan2(dy, dx) * 180) / Math.PI) % 360 + 360) % 360;
  const shdw = tag(
    "a:outerShdw",
    { blurRad: Math.max(0, emu(shadow.blur ?? 4)), dist: Math.max(0, emu(dist)), dir: Math.round(dir * 60000) % 21600000, algn: "ctr", rotWithShape: false },
    colorXml(shadow.color ?? "#00000040"),
  );
  return tag("a:effectLst", {}, shdw);
}

// ---- Fonts -------------------------------------------------------------------------------------------------------

/**
 * A `CT_TextFont` element (`a:latin`, `a:buFont`...). A family Office doesn't have gets `pitchFamily` (and `charset`) as
 * PowerPoint writes them for fonts it knows, so a computer without the font picks a serif, sans or fixed-width one; the
 * name itself is always written as it is. Office fonts, theme references (`+mn-lt`) and symbol fonts stay a bare name.
 */
export function fontXml(element: string, face: string): string {
  if (face.startsWith("+") || isSymbolFont(face) || isOfficeFont(face)) return tag(element, { typeface: face });
  return tag(element, { typeface: face, pitchFamily: officeHint(face).pptxPitchFamily, charset: 0 });
}

// ---- Text --------------------------------------------------------------------------------------------------------

const UNDERLINE = "sng";

/** Character properties: `a:rPr`, `a:endParaRPr` or `a:defRPr`. */
export function charPropsXml(name: string, marks: Marks | undefined, env: Env | undefined, extra: Record<string, AttrValue> = {}): string {
  const m = marks ?? {};
  const a: Record<string, AttrValue> = { ...extra };
  if (m.fontSize !== undefined) a.sz = clamp(int(m.fontSize * 100), 100, 400000);
  if (m.bold !== undefined) a.b = m.bold;
  if (m.italic !== undefined) a.i = m.italic;
  if (m.underline !== undefined) a.u = m.underline ? UNDERLINE : "none";
  if (m.strike !== undefined) a.strike = m.strike ? "sngStrike" : "noStrike";
  if (m.allCaps) a.cap = "all";
  else if (m.smallCaps) a.cap = "small";
  else if (m.allCaps === false || m.smallCaps === false) a.cap = "none";
  if (m.letterSpacing !== undefined) a.spc = clamp(int(m.letterSpacing * 100), -400000, 400000);
  if (m.baseline !== undefined) a.baseline = m.baseline === "super" ? 30000 : m.baseline === "sub" ? -25000 : clamp(int(m.baseline * 1000), -100000, 100000);
  let inner = "";
  if (m.color !== undefined) inner += solidFill(m.color);
  if (m.highlight !== undefined) inner += tag("a:highlight", {}, colorXml(m.highlight));
  if (m.fontFamily) inner += fontXml("a:latin", m.fontFamily);
  if (env && m.link) inner += hlinkClick(env, m.link);
  return tag(name, a, inner);
}

const ALIGN = { left: "l", center: "ctr", right: "r", justify: "just" } as const;
const NUMBER_SCHEMES = new Set(["arabicPeriod", "arabicParenR", "alphaLcPeriod", "alphaUcPeriod", "romanLcPeriod", "romanUcPeriod"]);

function bulletXml(bullet: Bullet | null | undefined): string {
  if (bullet === undefined) return "";
  if (bullet === null) return tag("a:buNone");
  let out = "";
  if (bullet.color !== undefined) out += tag("a:buClr", {}, colorXml(bullet.color));
  if (bullet.type === "char") {
    if (bullet.size !== undefined) out += tag("a:buSzPct", { val: clamp(int(bullet.size * 1000), 25000, 400000) });
    if (bullet.font) out += fontXml("a:buFont", bullet.font);
    out += tag("a:buChar", { char: bullet.char });
  } else {
    out += tag("a:buAutoNum", { type: NUMBER_SCHEMES.has(bullet.scheme) ? bullet.scheme : "arabicPeriod", startAt: bullet.start !== undefined && bullet.start !== 1 ? clamp(int(bullet.start), 1, 32767) : undefined });
  }
  return out;
}

/** Paragraph properties; `a:pPr` for a paragraph, `a:lvl1pPr`... for a level of a list style. Returns "" when empty unless `force`. */
export function paraPropsXml(name: string, props: ParaProps & { level?: number }, defMarks: Marks | undefined, env: Env | undefined, force = false): string {
  const a: Record<string, AttrValue> = {};
  if (props.marL !== undefined) a.marL = clamp(emu(props.marL), 0, 51206400);
  if (props.level) a.lvl = clamp(int(props.level), 0, 8);
  if (props.indent !== undefined) a.indent = clamp(emu(props.indent), -51206400, 51206400);
  if (props.align) a.algn = ALIGN[props.align];
  if (props.rtl !== undefined) a.rtl = props.rtl;
  let inner = "";
  if (props.lineSpacing !== undefined) inner += tag("a:lnSpc", {}, tag("a:spcPct", { val: clamp(pct(props.lineSpacing), 0, 13200000) }));
  if (props.spaceBefore !== undefined) inner += tag("a:spcBef", {}, tag("a:spcPts", { val: clamp(int(props.spaceBefore * 100), 0, 158400) }));
  if (props.spaceAfter !== undefined) inner += tag("a:spcAft", {}, tag("a:spcPts", { val: clamp(int(props.spaceAfter * 100), 0, 158400) }));
  inner += bulletXml(props.bullet);
  if (defMarks && Object.keys(defMarks).length) inner += charPropsXml("a:defRPr", defMarks, env);
  if (!force && inner === "" && Object.keys(a).length === 0) return "";
  return tag(name, a, inner);
}

/** `a:lvl1pPr`... for each level of a style, in level order. */
export function listStyleXml(levels: Record<number, LevelStyle> | undefined, env: Env | undefined): string {
  if (!levels) return "";
  let out = "";
  for (const key of Object.keys(levels).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 8).sort((x, y) => x - y)) {
    const { marks, ...props } = levels[key]!;
    out += paraPropsXml(`a:lvl${key + 1}pPr`, props, marks, env, true);
  }
  return out;
}

const FIELD_TYPE = { slideNumber: "slidenum", date: "datetime1" } as const;

function guid(env: Env): string {
  const n = ++env.ctx.nextGuid;
  return `{${n.toString(16).toUpperCase().padStart(8, "0")}-0000-4000-8000-${"0".repeat(12)}}`;
}

export function paragraphXml(p: Paragraph, env: Env): string {
  const { runs: _runs, level, endMarks, ...props } = p;
  void _runs;
  let out = paraPropsXml("a:pPr", { ...props, level }, undefined, env);
  for (const run of p.runs) {
    const marks = run.marks;
    const field = marks?.field;
    if (field === "slideNumber" || field === "date") {
      const { field: _f, ...rest } = marks!;
      void _f;
      out += tag("a:fld", { id: guid(env), type: FIELD_TYPE[field] }, charPropsXml("a:rPr", rest, env) + tag("a:t", {}, xmlEscape(run.text)));
      continue;
    }
    const { field: _f, ...rest } = marks ?? {};
    void _f;
    const lines = run.text.split(/\r\n|\r|\n|\u000b/);
    lines.forEach((line, i) => {
      if (i > 0) out += tag("a:br", {}, charPropsXml("a:rPr", rest, undefined));
      if (line !== "") out += tag("a:r", {}, charPropsXml("a:rPr", rest, env) + tag("a:t", {}, xmlEscape(line)));
    });
  }
  const end = endMarks ? charPropsXml("a:endParaRPr", endMarks, undefined) : p.runs.length === 0 ? tag("a:endParaRPr") : "";
  return tag("a:p", {}, out + end);
}

const ANCHOR = { top: "t", middle: "ctr", bottom: "b" } as const;

export function bodyPrXml(body: TextBody | undefined): string {
  const a: Record<string, AttrValue> = {};
  if (body?.wrap !== undefined) a.wrap = body.wrap ? "square" : "none";
  if (body?.insets) {
    if (body.insets.l !== undefined) a.lIns = Math.max(0, emu(body.insets.l));
    if (body.insets.t !== undefined) a.tIns = Math.max(0, emu(body.insets.t));
    if (body.insets.r !== undefined) a.rIns = Math.max(0, emu(body.insets.r));
    if (body.insets.b !== undefined) a.bIns = Math.max(0, emu(body.insets.b));
  }
  if (body?.vAlign) a.anchor = ANCHOR[body.vAlign];
  const fit = body?.autofit === "shrink" ? tag("a:normAutofit") : body?.autofit === "resize" ? tag("a:spAutoFit") : body?.autofit === "none" ? tag("a:noAutofit") : "";
  return tag("a:bodyPr", a, fit);
}

/** The paragraphs, list style and body properties of a text body. `name` is `p:txBody` or `a:txBody`. */
export function txBodyXml(name: "p:txBody" | "a:txBody", body: TextBody | undefined, env: Env, paragraphs?: Paragraph[]): string {
  const ps = paragraphs ?? body?.paragraphs ?? [];
  const list = ps.length ? ps : [{ runs: [] }];
  return tag(name, {}, bodyPrXml(body) + tag("a:lstStyle", {}, listStyleXml(body?.levels, env)) + list.map((p) => paragraphXml(p, env)).join(""));
}
