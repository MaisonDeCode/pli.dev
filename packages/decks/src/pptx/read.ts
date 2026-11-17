import { Inflate, strFromU8, unzipSync, type UnzipFileInfo } from "fflate";
import { PliError, child, childrenNamed, elements, encodeBase64, parseXml, textOf, type XmlElement } from "@pli.dev/core";
import { LIGHT_THEME, STOCK_PROMPT, buildMaster, newId } from "../build";
import { adjust, hslToRgb, parseHex, toHex } from "../color";
import { defaultSeriesColor } from "../chartscene";
import type {
  Align,
  Bullet,
  BulletScheme,
  ChartAxis,
  ChartDataLabels,
  ChartElement,
  ChartSeries,
  ChartType,
  Color,
  Crop,
  CustomCommand,
  CustomGeometry,
  CustomPath,
  DashStyle,
  Deck,
  Element,
  Fill,
  GradientStop,
  GroupElement,
  ImageElement,
  Layout,
  LayoutKind,
  LevelStyle,
  Line,
  Marks,
  Master,
  Paragraph,
  ParaProps,
  Placeholder,
  PlaceholderType,
  Run,
  Shadow,
  ShapeElement,
  Slide,
  SlideSize,
  TableCell,
  TableElement,
  TextBody,
  Theme,
  ThemeSlot,
  Transition,
  TransitionType,
} from "../model";
import { SIZE_WIDESCREEN, THEME_SLOTS } from "../model";
import { matchPlaceholder } from "../resolve";
import { unresolvedGuides } from "../custgeom";
import { pruneAnimations } from "../animation";
import { readTiming, type TimingTargetIn } from "./timing";
import { readComments, type ReadSlide } from "./comments";
import { markCommentedText } from "../comments";

// ---- Options and limits ------------------------------------------------------------------------------------------

export interface PptxImportOptions {
  /** The most the file may unpack to, in bytes (media included). Default 250 MB: a guard against files made to fill memory. */
  maxUnpackedBytes?: number;
  /** The most slides to read. Default 2000. */
  maxSlides?: number;
  /** The deck's title when the file has none. */
  title?: string;
  /**
   * Which user the author of a comment in the file is (a `PliUser.id`). Without it a comment's author is a made-up id
   * from the name (`pptx:ada-lovelace`), and `PptxImport.commentAuthors` lists them so you can add them to your users.
   */
  commentAuthor?: (author: { name: string; initials?: string; userId?: string }) => string;
}

export interface PptxImport {
  deck: Deck;
  /** Human-readable notes about whatever could not be read or was approximated. */
  warnings: string[];
  /** The authors of the comments that were read, by the id the threads use. */
  commentAuthors?: Record<string, { name: string; initials?: string }>;
}

const EMU = 12700;
const MAX_COORD = 200_000;
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_ELEMENTS_PER_TREE = 10_000;
const MAX_GROUP_DEPTH = 16;
const MAX_PARAGRAPHS = 5_000;
const MAX_WARNINGS = 200;
const MAX_TABLE_COLS = 100;
const MAX_TABLE_ROWS = 2_000;
const MAX_CUSTOM_COMMANDS = 20_000;
const MAX_CUSTOM_PATHS = 512;
const MAX_CUSTOM_GUIDES = 2_000;

// ---- Small helpers -----------------------------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function numAttr(el: XmlElement | undefined, name: string): number | undefined {
  const v = el?.attrs[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A length in EMU as points. */
function emuAttr(el: XmlElement | undefined, name: string): number | undefined {
  const n = numAttr(el, name);
  return n === undefined ? undefined : clamp(n / EMU, -MAX_COORD, MAX_COORD);
}

function boolAttr(el: XmlElement | undefined, name: string): boolean | undefined {
  const v = el?.attrs[name];
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

/** An attribute in a namespace prefix of the file's choosing (`r:id`, `r:embed`), found by its local name. */
function prefixedAttr(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  for (const [key, value] of Object.entries(el.attrs)) {
    const colon = key.indexOf(":");
    if (colon > 0 && key.slice(colon + 1) === name && !key.startsWith("xmlns") && !key.startsWith("xml:")) return value;
  }
  return undefined;
}

function findDesc(node: XmlElement | undefined, name: string, depth = 0): XmlElement | undefined {
  if (!node || depth > 40) return undefined;
  for (const c of elements(node)) {
    if (c.name === name) return c;
    const hit = findDesc(c, name, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function clean<T extends object>(obj: T): T {
  for (const k of Object.keys(obj) as (keyof T)[]) if (obj[k] === undefined) delete obj[k];
  return obj;
}

const isEmptyObject = (o: object): boolean => Object.keys(o).length === 0;
const normAngle = (deg: number): number => ((deg % 360) + 360) % 360;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---- The package -------------------------------------------------------------------------------------------------

interface Rel {
  id: string;
  /** The last part of the relationship type (`slide`, `image`, `hyperlink`…). */
  type: string;
  /** The package path of an internal target, or the URL of an external one. */
  target: string;
  external: boolean;
}

function normPath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

const dirOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

class Pkg {
  readonly files = new Map<string, Uint8Array>();
  private lower = new Map<string, string>();
  private xmls = new Map<string, XmlElement | null>();
  private relCache = new Map<string, Map<string, Rel>>();
  constructor(readonly warn: (message: string) => void) {}

  add(name: string, data: Uint8Array): void {
    const path = normPath(name);
    this.files.set(path, data);
    this.lower.set(path.toLowerCase(), path);
  }

  /** The path under which a part is stored, matching case-insensitively and with `%20`-style escapes undone. */
  find(path: string): string | undefined {
    const p = normPath(path);
    if (this.files.has(p)) return p;
    const lowered = this.lower.get(p.toLowerCase());
    if (lowered) return lowered;
    try {
      const decoded = normPath(decodeURIComponent(p));
      return this.files.has(decoded) ? decoded : this.lower.get(decoded.toLowerCase());
    } catch {
      return undefined;
    }
  }

  bytes(path: string): Uint8Array | undefined {
    const found = this.find(path);
    return found === undefined ? undefined : this.files.get(found);
  }

  xml(path: string): XmlElement | undefined {
    const found = this.find(path);
    if (found === undefined) return undefined;
    if (this.xmls.has(found)) return this.xmls.get(found) ?? undefined;
    let parsed: XmlElement | null = null;
    const data = this.files.get(found)!;
    if (data.length > MAX_XML_BYTES) this.warn(`"${found}" is too large to read and was skipped`);
    else {
      try {
        parsed = parseXml(strFromU8(data));
      } catch (cause) {
        this.warn(`"${found}" couldn't be read (${cause instanceof Error ? cause.message : "invalid XML"}) and was skipped`);
      }
    }
    this.xmls.set(found, parsed);
    return parsed ?? undefined;
  }

  /** The relationships of a part, by id. A part with none (or a broken file) has an empty map. */
  rels(part: string): Map<string, Rel> {
    const cached = this.relCache.get(part);
    if (cached) return cached;
    const map = new Map<string, Rel>();
    const dir = dirOf(part);
    const relsPath = `${dir}${dir ? "/" : ""}_rels/${part.slice(dir.length ? dir.length + 1 : 0)}.rels`;
    const root = this.xml(relsPath);
    for (const r of childrenNamed(root, "Relationship")) {
      const id = r.attrs.Id;
      const target = r.attrs.Target;
      if (!id || target === undefined) continue;
      const external = r.attrs.TargetMode === "External";
      const type = (r.attrs.Type ?? "").split("/").pop() ?? "";
      map.set(id, { id, type, target: external ? target : target.startsWith("/") ? normPath(target.slice(1)) : normPath(`${dir}/${target}`), external });
    }
    this.relCache.set(part, map);
    return map;
  }

  /** The first relationship of a type. */
  relOfType(part: string, type: string): Rel | undefined {
    for (const r of this.rels(part).values()) if (r.type === type) return r;
    return undefined;
  }
}

const WANTED = /\.(xml|rels)$/i;
const IMAGE_EXT = /\.(png|jpe?g|jfif|gif|bmp|dib|tiff?|svg|webp|emf|wmf|ico)$/i;
const SKIPPED_DIRS = /^(ppt\/(embeddings|activeX|fonts|printerSettings|ink)|customXml)\//i;

function inflateLimited(data: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflate = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new PliError("invalid_document", "The file is too large when unpacked");
    chunks.push(chunk);
  });
  inflate.push(data, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Reads the parts of a zip whose directory is missing or broken (a download cut short) by walking the local headers. */
function salvageZip(bytes: Uint8Array, limit: number, add: (name: string, data: Uint8Array) => void): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let found = 0;
  let total = 0;
  let i = 0;
  while (i + 30 <= bytes.length) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 3 || bytes[i + 3] !== 4) {
      i++;
      continue;
    }
    const flags = dv.getUint16(i + 6, true);
    const method = dv.getUint16(i + 8, true);
    const csize = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const start = i + 30 + nameLen + extraLen;
    if (start > bytes.length) break;
    const name = strFromU8(bytes.subarray(i + 30, i + 30 + nameLen));
    const sized = csize > 0 && (flags & 8) === 0;
    const end = sized ? start + csize : bytes.length;
    let data: Uint8Array | undefined;
    if (!name.endsWith("/") && !SKIPPED_DIRS.test(name) && (WANTED.test(name) || IMAGE_EXT.test(name)) && end <= bytes.length) {
      try {
        data = method === 0 ? bytes.subarray(start, end) : method === 8 ? inflateLimited(bytes.subarray(start, end), limit - total) : undefined;
      } catch (cause) {
        if (cause instanceof PliError) throw cause;
        data = undefined;
      }
    }
    if (data) {
      total += data.length;
      if (total > limit) throw new PliError("invalid_document", "The file is too large when unpacked");
      add(name, data);
      found++;
    }
    i = sized ? Math.max(end, i + 1) : start;
  }
  return found;
}

function openPackage(bytes: Uint8Array, limit: number, warn: (message: string) => void): Pkg {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new PliError("invalid_document", "Not a PowerPoint file: it isn't a zip archive");
  }
  const pkg = new Pkg(warn);
  let total = 0;
  let count = 0;
  let raw: Record<string, Uint8Array> | undefined;
  try {
    raw = unzipSync(bytes, {
      filter(file: UnzipFileInfo) {
        if (file.name.endsWith("/")) return false;
        if (++count > MAX_ENTRIES) throw new PliError("invalid_document", "The file has too many parts");
        if (SKIPPED_DIRS.test(file.name) || !(WANTED.test(file.name) || IMAGE_EXT.test(file.name))) return false;
        if (file.originalSize > MAX_PART_BYTES) {
          warn(`"${file.name}" is too large and was skipped`);
          return false;
        }
        total += file.originalSize;
        if (total > limit) throw new PliError("invalid_document", "The file is too large when unpacked");
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof PliError) throw cause;
    const found = salvageZip(bytes, limit, (name, data) => pkg.add(name, data));
    if (found === 0) throw new PliError("invalid_document", "Not a PowerPoint file: it couldn't be opened as a zip archive", { cause });
    warn(`The file is damaged (its zip directory couldn't be read, perhaps because it was cut short); ${found} parts were recovered`);
  }
  if (raw) for (const [name, data] of Object.entries(raw)) pkg.add(name, data);
  return pkg;
}

// ---- Theme, colours, fills -----------------------------------------------------------------------------------------

type ClrMap = Record<string, ThemeSlot>;

const DEFAULT_MAP: ClrMap = {
  bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2",
  accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6",
  hlink: "hlink", folHlink: "folHlink",
};

const isSlot = (v: string | undefined): v is ThemeSlot => !!v && (THEME_SLOTS as readonly string[]).includes(v);

function readClrMap(el: XmlElement | undefined, base: ClrMap = DEFAULT_MAP): ClrMap {
  if (!el) return base;
  const out: ClrMap = { ...base };
  for (const [k, v] of Object.entries(el.attrs)) if (k in DEFAULT_MAP && isSlot(v)) out[k] = v;
  return out;
}

/** A slide's or layout's `clrMapOvr`: its own mapping, or (for `masterClrMapping`/none) the one it inherits. */
function overrideMap(ovr: XmlElement | undefined, inherited: ClrMap): ClrMap {
  const over = child(ovr, "overrideClrMapping");
  return over ? readClrMap(over, inherited) : inherited;
}

const PRESET_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  dkGray: "#a9a9a9", ltGray: "#d3d3d3", orange: "#ffa500", cyan: "#00ffff", magenta: "#ff00ff", purple: "#800080", brown: "#a52a2a", pink: "#ffc0cb",
  dkBlue: "#00008b", dkGreen: "#006400", dkRed: "#8b0000", ltBlue: "#add8e6", ltGreen: "#90ee90", navy: "#000080", silver: "#c0c0c0",
};

const hex6 = (v: string | undefined): string | undefined => (v && /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : undefined);

/** The `#rrggbb` of a colour element that doesn't depend on a theme. */
function absoluteHex(el: XmlElement): string | undefined {
  switch (el.name) {
    case "srgbClr":
      return hex6(el.attrs.val);
    case "sysClr":
      return hex6(el.attrs.lastClr) ?? (el.attrs.val === "window" ? "#ffffff" : "#000000");
    case "prstClr":
      return PRESET_COLORS[el.attrs.val ?? ""] ?? "#000000";
    case "scrgbClr": {
      const c = (n: string) => Math.round(clamp((numAttr(el, n) ?? 0) / 100000, 0, 1) * 255);
      return toHex({ r: c("r"), g: c("g"), b: c("b"), a: 1 });
    }
    case "hslClr":
      return toHex(hslToRgb(clamp((numAttr(el, "hue") ?? 0) / 21600000, 0, 1), clamp((numAttr(el, "sat") ?? 0) / 100000, 0, 1), clamp((numAttr(el, "lum") ?? 0) / 100000, 0, 1)));
    default:
      return undefined;
  }
}

const COLOR_TAGS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "hslClr", "scrgbClr"]);

interface ThemeData {
  /** The theme part, whose relationships its own picture fills refer to. */
  path?: string;
  theme: Theme;
  fills: XmlElement[];
  lines: XmlElement[];
  effects: XmlElement[];
  bgFills: XmlElement[];
}

function parseTheme(root: XmlElement | undefined, path?: string): ThemeData {
  const els = child(root, "themeElements");
  const scheme = child(els, "clrScheme");
  const colors = { ...LIGHT_THEME.colors };
  for (const slot of THEME_SLOTS) {
    const c = elements(child(scheme, slot))[0];
    const hex = c ? absoluteHex(c) : undefined;
    if (hex) colors[slot] = hex;
  }
  const fonts = child(els, "fontScheme");
  const face = (which: string) => {
    const set = child(fonts, which);
    // a theme with no Latin font of its own (a placeholder name or an empty one) is set in its East Asian or complex-script font, else Arial
    for (const name of ["latin", "ea", "cs"]) {
      const t = child(set, name)?.attrs.typeface?.trim();
      if (t && !t.startsWith("+")) return t;
    }
    return "Arial";
  };
  const fmt = child(els, "fmtScheme");
  return {
    path,
    theme: { name: (root?.attrs.name || scheme?.attrs.name || "Imported theme").slice(0, 200), colors, fonts: { major: face("majorFont"), minor: face("minorFont") } },
    fills: elements(child(fmt, "fillStyleLst")),
    lines: elements(child(fmt, "lnStyleLst")),
    effects: elements(child(fmt, "effectStyleLst")),
    bgFills: elements(child(fmt, "bgFillStyleLst")),
  };
}

interface Shared {
  pkg: Pkg;
  warn: (message: string) => void;
  media: Map<string, string | null>;
  limit: number;
  /** The slide size, once the presentation part has been read. */
  size?: SlideSize;
}

interface Ctx {
  shared: Shared;
  /** The part being read, whose relationships resolve ids. */
  part: string;
  rels: Map<string, Rel>;
  theme: ThemeData;
  map: ClrMap;
  /** The colour `phClr` stands for while reading a style from the theme. */
  phClr?: Color;
  /** Prefix for warnings (`Slide 3`). */
  label: string;
  warn: (message: string) => void;
}

function makeCtx(shared: Shared, part: string, theme: ThemeData, map: ClrMap, label: string): Ctx {
  return {
    shared,
    part,
    rels: shared.pkg.rels(part),
    theme,
    map,
    label,
    warn: (m) => shared.warn(label ? `${label}: ${m}` : m),
  };
}

const alphaHex = (a: number): string => Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, "0");

function withAlpha(hex: string, a: number): string {
  return a >= 1 ? hex : `${hex.slice(0, 7)}${alphaHex(a)}`;
}

/** Applies the colour modifiers (lumMod, tint, alpha…) that are children of a colour element to a base colour. */
function applyMods(base: Color, el: XmlElement): Color {
  let color: Color = typeof base === "string" ? base : { ...base };
  for (const m of elements(el)) {
    const v = numAttr(m, "val");
    if (v === undefined) continue;
    const f = v / 100000;
    const step: { lumMod?: number; lumOff?: number; tint?: number; shade?: number; alpha?: number } = {};
    switch (m.name) {
      case "lumMod": step.lumMod = f; break;
      case "lumOff": step.lumOff = f; break;
      case "tint": step.tint = clamp(1 - f, 0, 1); break;
      case "shade": step.shade = clamp(1 - f, 0, 1); break;
      case "alpha": step.alpha = clamp(f, 0, 1); break;
      case "alphaMod": step.alpha = clamp(f, 0, 1); break;
      default: continue;
    }
    if (typeof color === "string") {
      const rgba = adjust(parseHex(color), step);
      color = withAlpha(toHex(rgba), rgba.a);
    } else {
      const c: typeof color = color;
      if (step.lumMod !== undefined) {
        c.lumMod = (c.lumMod ?? 1) * step.lumMod;
        if (c.lumOff !== undefined) c.lumOff *= step.lumMod;
      }
      if (step.lumOff !== undefined) c.lumOff = (c.lumOff ?? 0) + step.lumOff;
      if (step.tint !== undefined) c.tint = 1 - (1 - (c.tint ?? 0)) * (1 - step.tint);
      if (step.shade !== undefined) c.shade = 1 - (1 - (c.shade ?? 0)) * (1 - step.shade);
      if (step.alpha !== undefined) c.alpha = (c.alpha ?? 1) * step.alpha;
    }
  }
  return color;
}

function colorOf(el: XmlElement, ctx: Ctx): Color | undefined {
  let base: Color | undefined;
  if (el.name === "schemeClr") {
    const v = el.attrs.val ?? "";
    if (v === "phClr") base = ctx.phClr ?? { theme: "dk1" };
    else {
      const slot = ctx.map[v] ?? (isSlot(v) ? v : undefined);
      base = { theme: slot ?? "dk1" };
    }
  } else base = absoluteHex(el);
  return base === undefined ? undefined : applyMods(base, el);
}

/** The colour that is a child of this element (`solidFill`, `fillRef`…). */
function colorIn(parent: XmlElement | undefined, ctx: Ctx): Color | undefined {
  const el = elements(parent).find((c) => COLOR_TAGS.has(c.name));
  return el ? colorOf(el, ctx) : undefined;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", gif: "image/gif", bmp: "image/bmp", dib: "image/bmp",
  tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", webp: "image/webp", emf: "image/x-emf", wmf: "image/x-wmf", ico: "image/x-icon",
};

/** Base64 of a picture. Uses `btoa` in chunks where there is one (much faster for big pictures), else core's encoder. */
function toBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") return encodeBase64(bytes);
  const parts: string[] = [];
  const chunk = 0x6000; // a multiple of 3, so no chunk but the last needs padding
  for (let i = 0; i < bytes.length; i += chunk) parts.push(btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])));
  return parts.join("");
}

function sniffMime(b: Uint8Array): string | undefined {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  return undefined;
}

/** A picture part as a `data:` URI (null, with a warning, when it is missing or too big). */
function imageUri(ctx: Ctx, rid: string | undefined): string | undefined {
  if (!rid) return undefined;
  const rel = ctx.rels.get(rid);
  if (!rel || rel.external) {
    ctx.warn(rel?.external ? "a linked (not embedded) picture was skipped" : "a picture refers to a missing relationship and was skipped");
    return undefined;
  }
  const { pkg, media } = ctx.shared;
  const path = pkg.find(rel.target);
  if (path === undefined) {
    ctx.warn(`the picture "${rel.target}" is missing from the file and was skipped`);
    return undefined;
  }
  if (media.has(path)) return media.get(path) ?? undefined;
  const data = pkg.files.get(path)!;
  let uri: string | null = null;
  if (data.length > MAX_IMAGE_BYTES) ctx.warn(`the picture "${path}" is too large and was skipped`);
  else {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mime = MIME[ext] ?? sniffMime(data) ?? "application/octet-stream";
    if (mime === "image/x-emf" || mime === "image/x-wmf") ctx.warn(`the picture "${path}" is an EMF/WMF metafile, which many viewers can't draw`);
    uri = `data:${mime};base64,${toBase64(data)}`;
  }
  media.set(path, uri);
  return uri ?? undefined;
}

function cropOf(rect: XmlElement | undefined): Crop | undefined {
  if (!rect) return undefined;
  const f = (n: string) => {
    const v = numAttr(rect, n);
    return v === undefined || v === 0 ? undefined : clamp(v / 100000, -1, 1);
  };
  const crop = clean({ l: f("l"), t: f("t"), r: f("r"), b: f("b") });
  return isEmptyObject(crop) ? undefined : crop;
}

/** One fill element (`solidFill`, `gradFill`, `blipFill`, `noFill`, `pattFill`): a fill, `null` for none, `undefined` if not a fill. */
function fillElement(el: XmlElement, ctx: Ctx): Fill | null | undefined {
  switch (el.name) {
    case "noFill":
      return null;
    case "solidFill":
      return colorIn(el, ctx);
    case "pattFill":
      return colorIn(child(el, "fgClr"), ctx);
    case "gradFill": {
      const stops: GradientStop[] = [];
      for (const gs of childrenNamed(child(el, "gsLst"), "gs").slice(0, 64)) {
        const color = colorIn(gs, ctx);
        if (color !== undefined) stops.push({ at: clamp((numAttr(gs, "pos") ?? 0) / 100000, 0, 1), color });
      }
      if (stops.length === 0) return undefined;
      stops.sort((a, b) => a.at - b.at);
      const path = child(el, "path");
      if (path) {
        // The focus is the centre of the "fill to" rectangle, whose sides are insets from the shape's edges (an absent one is 0)
        const rect = child(path, "fillToRect");
        const inset = (name: string): number => {
          const raw = rect?.attrs[name];
          const n = raw === undefined ? NaN : parseFloat(raw);
          return Number.isFinite(n) ? clamp(raw!.trim().endsWith("%") ? n / 100 : n / 100000, 0, 1) : 0;
        };
        const center = rect ? { x: round2((inset("l") + 1 - inset("r")) / 2), y: round2((inset("t") + 1 - inset("b")) / 2) } : { x: 0.5, y: 0.5 };
        return { gradient: center.x === 0.5 && center.y === 0.5 ? { kind: "radial", stops } : { kind: "radial", center, stops } };
      }
      const lin = child(el, "lin");
      return { gradient: { kind: "linear", angle: round2(normAngle((numAttr(lin, "ang") ?? 0) / 60000)), stops } };
    }
    case "blipFill": {
      const blip = child(el, "blip");
      const src = imageUri(ctx, prefixedAttr(blip, "embed") ?? prefixedAttr(findDesc(blip, "svgBlip"), "embed"));
      if (!src) return undefined;
      const alphaMod = child(blip, "alphaModFix");
      const image: { src: string; mode?: "stretch" | "tile"; crop?: Crop; alpha?: number } = { src, mode: child(el, "tile") ? "tile" : "stretch" };
      const crop = cropOf(child(el, "srcRect"));
      if (crop) image.crop = crop;
      if (alphaMod) image.alpha = clamp((numAttr(alphaMod, "amt") ?? 100000) / 100000, 0, 1);
      return { image };
    }
    default:
      return undefined;
  }
}

/** The fill that is a child of a shape's properties (or `bgPr`): `undefined` when it has none. */
function fillIn(parent: XmlElement | undefined, ctx: Ctx): Fill | null | undefined {
  for (const c of elements(parent)) {
    const f = fillElement(c, ctx);
    if (f !== undefined) return f;
  }
  return undefined;
}

/** The fill a `fillRef`/`bgRef` index picks from the theme's format scheme. */
function themeFill(ctx: Ctx, idx: number, phClr: Color | undefined): Fill | null | undefined {
  if (idx === 0) return null;
  const el = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
  if (!el) return undefined;
  // A picture in the theme's own styles names a relationship of the theme part, not of the slide.
  const themeRels = ctx.theme.path ? { part: ctx.theme.path, rels: ctx.shared.pkg.rels(ctx.theme.path) } : {};
  return fillElement(el, { ...ctx, ...themeRels, phClr, warn: () => {} });
}

const DASHES: Record<string, DashStyle> = {
  solid: "solid", dot: "dot", dash: "dash", dashDot: "dashDot", lgDash: "longDash", lgDashDot: "longDashDot", lgDashDotDot: "longDashDot",
  sysDot: "sysDot", sysDash: "sysDash", sysDashDot: "dashDot", sysDashDotDot: "dashDot",
};

const ENDS: Record<string, Line["head"]> = { none: "none", triangle: "triangle", stealth: "stealth", diamond: "diamond", oval: "oval", arrow: "open" };

/** A line (`a:ln`) read on top of a base from the theme. `null` is no line; `undefined` is no colour known. */
function lineOf(ln: XmlElement, ctx: Ctx, base?: Line | null): Line | null | undefined {
  if (child(ln, "noFill")) return null;
  const out: Line = base ? { ...base } : {};
  const w = emuAttr(ln, "w");
  if (w !== undefined) out.width = Math.max(0, w);
  const fill = fillIn(ln, ctx);
  if (fill !== undefined && fill !== null) {
    if (typeof fill === "string" || "theme" in fill) out.color = fill;
    else if ("gradient" in fill) out.color = fill.gradient.stops[0]?.color;
  }
  const dash = child(ln, "prstDash")?.attrs.val;
  if (dash && DASHES[dash]) out.dash = DASHES[dash];
  const cap = ln.attrs.cap;
  if (cap === "rnd") out.cap = "round";
  else if (cap === "sq") out.cap = "square";
  else if (cap === "flat") out.cap = "flat";
  if (child(ln, "round")) out.join = "round";
  else if (child(ln, "bevel")) out.join = "bevel";
  else if (child(ln, "miter")) out.join = "miter";
  const head = ENDS[child(ln, "headEnd")?.attrs.type ?? ""];
  const tail = ENDS[child(ln, "tailEnd")?.attrs.type ?? ""];
  if (head) out.head = head;
  if (tail) out.tail = tail;
  if (out.color === undefined && base == null) return undefined;
  return clean(out);
}

function shadowOf(shdw: XmlElement | undefined, ctx: Ctx): Shadow | undefined {
  if (!shdw) return undefined;
  const dist = (numAttr(shdw, "dist") ?? 0) / EMU;
  const dir = ((numAttr(shdw, "dir") ?? 0) / 60000) * (Math.PI / 180);
  return clean({
    color: colorIn(shdw, ctx),
    blur: clamp((numAttr(shdw, "blurRad") ?? 0) / EMU, 0, 1000),
    dx: round3(clamp(dist * Math.cos(dir), -1000, 1000)),
    dy: round3(clamp(dist * Math.sin(dir), -1000, 1000)),
  });
}

// ---- Text --------------------------------------------------------------------------------------------------------

/** Text with letters but none of them Latin (Japanese, Arabic, Cyrillic...): what the East Asian and complex-script fonts are for. */
const nonLatinOnly = (text: string): boolean => /\p{L}/u.test(text) && !/[A-Za-z\u00c0-\u024f]/.test(text);

/**
 * The family a run is set in: `a:latin`, which may also be the theme's `+mj-lt` or `+mn-lt`. A run with no `a:latin` but
 * an `a:ea` or `a:cs` of its own is set in that font when its `text` has no Latin letters (the other theme references,
 * `+mn-ea`, `+mj-cs`... name no family, and Latin text keeps the font it inherits).
 */
function fontFamilyOf(rPr: XmlElement, text: string | undefined): string | undefined {
  const latin = child(rPr, "latin")?.attrs.typeface?.trim();
  if (latin && (!latin.startsWith("+") || latin === "+mj-lt" || latin === "+mn-lt")) return latin;
  if (text === undefined || !nonLatinOnly(text)) return undefined;
  for (const name of ["ea", "cs"]) {
    const face = child(rPr, name)?.attrs.typeface?.trim();
    if (face && !face.startsWith("+")) return face;
  }
  return undefined;
}

function readRPr(rPr: XmlElement | undefined, ctx: Ctx, text?: string): Marks {
  const m: Marks = {};
  if (!rPr) return m;
  const sz = numAttr(rPr, "sz");
  if (sz !== undefined) m.fontSize = clamp(sz / 100, 1, 4000);
  const b = boolAttr(rPr, "b");
  if (b !== undefined) m.bold = b;
  const i = boolAttr(rPr, "i");
  if (i !== undefined) m.italic = i;
  const u = rPr.attrs.u;
  if (u !== undefined) m.underline = u !== "none";
  const strike = rPr.attrs.strike;
  if (strike !== undefined) m.strike = strike !== "noStrike";
  const baseline = numAttr(rPr, "baseline");
  // an explicit 0 matters: it cancels a raised or lowered style it would otherwise inherit
  if (baseline !== undefined) m.baseline = baseline === 30000 ? "super" : baseline === -25000 ? "sub" : clamp(baseline / 1000, -100, 100);
  const cap = rPr.attrs.cap;
  if (cap === "all") m.allCaps = true;
  else if (cap === "small") m.smallCaps = true;
  else if (cap === "none") {
    m.allCaps = false;
    m.smallCaps = false;
  }
  const spc = numAttr(rPr, "spc");
  if (spc !== undefined) m.letterSpacing = clamp(spc / 100, -100, 100);
  const fill = child(rPr, "solidFill");
  if (fill) {
    const c = colorIn(fill, ctx);
    if (c !== undefined) m.color = c;
  }
  const hi = child(rPr, "highlight");
  if (hi) {
    const c = colorIn(hi, ctx);
    if (c !== undefined) m.highlight = c;
  }
  const face = fontFamilyOf(rPr, text);
  if (face) m.fontFamily = face;
  const link = child(rPr, "hlinkClick");
  if (link) {
    const url = linkTarget(link, ctx);
    if (url) {
      m.link = url;
      if (m.color === undefined) m.color = { theme: "hlink" };
      if (m.underline === undefined) m.underline = true;
    }
  }
  return m;
}

const SAFE_SCHEMES = /^(https?|mailto|tel|ftp|sms):/i;

function linkTarget(el: XmlElement, ctx: Ctx): string | undefined {
  const rid = prefixedAttr(el, "id");
  if (!rid) return undefined;
  const rel = ctx.rels.get(rid);
  if (!rel || !rel.external) return undefined;
  if (!SAFE_SCHEMES.test(rel.target)) {
    ctx.warn(`a link to "${rel.target.slice(0, 40)}" was dropped (only web and mail links are kept)`);
    return undefined;
  }
  return rel.target.slice(0, 2000);
}

const AUTONUM: Record<string, BulletScheme> = {
  arabicPeriod: "arabicPeriod", arabicParenR: "arabicParenR", arabicParenBoth: "arabicParenR", arabicPlain: "arabicPeriod",
  alphaLcPeriod: "alphaLcPeriod", alphaLcParenR: "alphaLcPeriod", alphaLcParenBoth: "alphaLcPeriod",
  alphaUcPeriod: "alphaUcPeriod", alphaUcParenR: "alphaUcPeriod", alphaUcParenBoth: "alphaUcPeriod",
  romanLcPeriod: "romanLcPeriod", romanLcParenR: "romanLcPeriod", romanLcParenBoth: "romanLcPeriod",
  romanUcPeriod: "romanUcPeriod", romanUcParenR: "romanUcPeriod", romanUcParenBoth: "romanUcPeriod",
};

/** Symbol-font bullet characters, as characters any font has. */
const SYMBOL_BULLETS: Record<string, string> = { "§": "▪", "Ø": "➢", "ü": "✓", v: "❖", q: "❑", "·": "•", "¨": "◻", "ý": "✗", "þ": "☑", "l": "●", n: "■", "p": "◆" };

function readBullet(pPr: XmlElement, ctx: Ctx, size: number): Bullet | null | undefined {
  if (child(pPr, "buNone")) return null;
  const clr = child(pPr, "buClr");
  const color = clr ? colorIn(clr, ctx) : undefined;
  const pct = numAttr(child(pPr, "buSzPct"), "val");
  const pts = numAttr(child(pPr, "buSzPts"), "val");
  const sizePct = pct !== undefined ? clamp(pct / 1000, 10, 400) : pts !== undefined ? clamp(((pts / 100) / size) * 100, 10, 400) : undefined;
  const font = child(pPr, "buFont")?.attrs.typeface;
  const chr = child(pPr, "buChar");
  if (chr) {
    let char = (chr.attrs.char ?? "•").slice(0, 4) || "•";
    let face = font && !font.startsWith("+") ? font : undefined;
    if (face && /^(symbol|wingdings( \d)?|webdings)$/i.test(face)) {
      char = SYMBOL_BULLETS[char] ?? "•";
      face = undefined;
    }
    return clean({ type: "char" as const, char, color, size: sizePct, font: face });
  }
  const auto = child(pPr, "buAutoNum");
  if (auto) {
    const start = numAttr(auto, "startAt");
    return clean({ type: "number" as const, scheme: AUTONUM[auto.attrs.type ?? ""] ?? "arabicPeriod", start: start !== undefined && start !== 1 ? clamp(Math.round(start), 1, 100000) : undefined, color });
  }
  if (child(pPr, "buBlip")) return { type: "char", char: "•" };
  return undefined;
}

interface ReadPPr {
  props: ParaProps;
  level?: number;
  marks?: Marks;
}

/** `pPr`, or one of the `lvlNpPr` of a list style. `size` converts percentages and fixed spacing into the model's units. */
function readPPr(pPr: XmlElement | undefined, ctx: Ctx, size: number): ReadPPr {
  const props: ParaProps = {};
  if (!pPr) return { props };
  const marks = readRPr(child(pPr, "defRPr"), ctx);
  const sz = marks.fontSize ?? size;
  const algn = pPr.attrs.algn;
  if (algn) props.align = ({ l: "left", ctr: "center", r: "right", just: "justify", justLow: "justify", dist: "justify", thaiDist: "justify" } as Record<string, Align>)[algn];
  const marL = emuAttr(pPr, "marL");
  if (marL !== undefined) props.marL = clamp(marL, -MAX_COORD, MAX_COORD);
  const indent = emuAttr(pPr, "indent");
  if (indent !== undefined) props.indent = indent;
  const rtl = boolAttr(pPr, "rtl");
  if (rtl) props.rtl = true;
  const lnSpc = child(pPr, "lnSpc");
  if (lnSpc) {
    const pct = numAttr(child(lnSpc, "spcPct"), "val");
    const pts = numAttr(child(lnSpc, "spcPts"), "val");
    if (pct !== undefined) props.lineSpacing = clamp(pct / 100000, 0.1, 10);
    else if (pts !== undefined) props.lineSpacing = clamp(pts / 100 / sz, 0.1, 10);
  }
  for (const [tag, key] of [["spcBef", "spaceBefore"], ["spcAft", "spaceAfter"]] as const) {
    const el = child(pPr, tag);
    if (!el) continue;
    const pct = numAttr(child(el, "spcPct"), "val");
    const pts = numAttr(child(el, "spcPts"), "val");
    if (pts !== undefined) props[key] = clamp(pts / 100, 0, 1000);
    else if (pct !== undefined) props[key] = round3(clamp((pct / 100000) * sz, 0, 1000));
  }
  const bullet = readBullet(pPr, ctx, sz);
  if (bullet !== undefined) props.bullet = bullet;
  const lvl = numAttr(pPr, "lvl");
  return { props, level: lvl === undefined ? undefined : clamp(Math.round(lvl), 0, 8), marks: isEmptyObject(marks) ? undefined : marks };
}

function levelsOf(parent: XmlElement | undefined, ctx: Ctx): Record<number, LevelStyle> {
  const levels: Record<number, LevelStyle> = {};
  for (const el of elements(parent)) {
    const m = /^lvl([1-9])pPr$/.exec(el.name);
    if (!m) continue;
    const { props, marks } = readPPr(el, ctx, 18);
    const style: LevelStyle = { ...props };
    if (marks) style.marks = marks;
    if (!isEmptyObject(style)) levels[Number(m[1]) - 1] = style;
  }
  return levels;
}

const FIELD_DATE = /^datetime/i;

function readRuns(p: XmlElement, ctx: Ctx): Run[] {
  const runs: Run[] = [];
  const push = (text: string, marks: Marks | undefined) => {
    if (text === "") return;
    const marksOrNone = marks && !isEmptyObject(marks) ? marks : undefined;
    const last = runs[runs.length - 1];
    if (last && !marksOrNone?.field && !last.marks?.field && JSON.stringify(last.marks ?? {}) === JSON.stringify(marksOrNone ?? {})) last.text += text;
    else runs.push(marksOrNone ? { text, marks: marksOrNone } : { text });
  };
  for (const node of elements(p)) {
    if (node.name === "r") {
      const t = textOf(child(node, "t"));
      push(t, readRPr(child(node, "rPr"), ctx, t));
    }
    else if (node.name === "br") push("\n", readRPr(child(node, "rPr"), ctx));
    else if (node.name === "fld") {
      const marks = readRPr(child(node, "rPr"), ctx);
      const type = node.attrs.type ?? "";
      let text = textOf(child(node, "t"));
      if (type === "slidenum") {
        marks.field = "slideNumber";
        text ||= "‹#›";
      } else if (FIELD_DATE.test(type)) {
        marks.field = "date";
        text ||= " ";
      }
      push(text, marks);
    }
  }
  return runs;
}

const STANDARD_PROMPT = STOCK_PROMPT;

function readPara(p: XmlElement, ctx: Ctx): Paragraph {
  const runs = readRuns(p, ctx);
  const endMarks = readRPr(child(p, "endParaRPr"), ctx);
  const size = runs.find((r) => r.marks?.fontSize)?.marks?.fontSize ?? endMarks.fontSize ?? 18;
  const { props, level } = readPPr(child(p, "pPr"), ctx, size);
  const para: Paragraph = { ...props, runs };
  if (level) para.level = level;
  if (!isEmptyObject(endMarks)) para.endMarks = endMarks;
  return para;
}

interface TextOptions {
  /** The text colour the shape's style gives (its `fontRef`), where nothing else says. */
  defaultColor?: Color;
  /** A placeholder on a layout or master: its stock text ("Click to edit Master title style") is not kept. */
  template?: boolean;
}

function readTextBody(tx: XmlElement, ctx: Ctx, opts: TextOptions = {}): TextBody {
  const bodyPr = child(tx, "bodyPr");
  const body: TextBody = { paragraphs: [] };
  const anchor = bodyPr?.attrs.anchor;
  if (anchor === "t") body.vAlign = "top";
  else if (anchor === "ctr") body.vAlign = "middle";
  else if (anchor === "b") body.vAlign = "bottom";
  const insets = clean({ l: emuAttr(bodyPr, "lIns"), t: emuAttr(bodyPr, "tIns"), r: emuAttr(bodyPr, "rIns"), b: emuAttr(bodyPr, "bIns") });
  if (!isEmptyObject(insets)) body.insets = insets;
  if (bodyPr?.attrs.wrap === "none") body.wrap = false;
  else if (bodyPr?.attrs.wrap === "square") body.wrap = true;
  if (child(bodyPr, "normAutofit")) body.autofit = "shrink";
  else if (child(bodyPr, "spAutoFit")) body.autofit = "resize";
  else if (child(bodyPr, "noAutofit")) body.autofit = "none";
  if (bodyPr?.attrs.vert && bodyPr.attrs.vert !== "horz") ctx.warn("vertical text is drawn horizontally");

  const levels = levelsOf(child(tx, "lstStyle"), ctx);
  if (opts.defaultColor !== undefined) {
    for (let i = 0; i < 9; i++) {
      const own = levels[i];
      if (own?.marks?.color === undefined) levels[i] = { ...own, marks: { color: opts.defaultColor, ...own?.marks } };
    }
  }
  if (!isEmptyObject(levels)) body.levels = levels;

  const paras = childrenNamed(tx, "p");
  if (paras.length > MAX_PARAGRAPHS) ctx.warn(`a text box with ${paras.length} paragraphs was cut to ${MAX_PARAGRAPHS}`);
  for (const p of paras.slice(0, MAX_PARAGRAPHS)) body.paragraphs.push(readPara(p, ctx));
  if (opts.template) {
    body.paragraphs = body.paragraphs.filter((p) => !p.runs.every((r) => STANDARD_PROMPT.test(r.text.trim())) || p.runs.length === 0);
    // A prompt that was only stock text leaves an empty paragraph, so the app's own "Click to add…" shows.
  }
  if (body.paragraphs.length === 0) body.paragraphs.push({ runs: [] });
  return body;
}

// ---- Shapes ------------------------------------------------------------------------------------------------------

type Owner = "slide" | "layout" | "master";

const PH_TYPES = new Set<string>(["title", "ctrTitle", "subTitle", "body", "dt", "ftr", "sldNum", "pic", "chart", "tbl", "obj", "media", "clipArt", "dgm", "hdr", "sldImg"]);

function readPlaceholder(ph: XmlElement | undefined): Placeholder | undefined {
  if (!ph) return undefined;
  const raw = ph.attrs.type;
  const type: PlaceholderType = raw === undefined ? "obj" : PH_TYPES.has(raw) ? (raw as PlaceholderType) : "obj";
  const idx = numAttr(ph, "idx");
  return idx === undefined ? { type } : { type, idx: Math.max(0, Math.round(idx)) };
}

interface Frame {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

function readFrame(xfrm: XmlElement | undefined): Frame {
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  const frame: Frame = {};
  const x = emuAttr(off, "x");
  const y = emuAttr(off, "y");
  const w = emuAttr(ext, "cx");
  const h = emuAttr(ext, "cy");
  if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) Object.assign(frame, { x, y, w: Math.abs(w), h: Math.abs(h) });
  const rot = numAttr(xfrm, "rot");
  if (rot) frame.rotation = round3(normAngle(rot / 60000));
  if (boolAttr(xfrm, "flipH")) frame.flipH = true;
  if (boolAttr(xfrm, "flipV")) frame.flipV = true;
  return frame;
}

// ---- Custom geometry ---------------------------------------------------------------------------------------------

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PATH_FILLS = new Set(["none", "lighten", "lightenLess", "darken", "darkenLess"]);

/** A coordinate or angle attribute: a number, or the name of a guide. A missing attribute is 0. */
function guideRef(el: XmlElement | undefined, name: string): number | string {
  const v = el?.attrs[name]?.trim();
  if (v === undefined || v === "") return 0;
  if (PLAIN_NUMBER.test(v)) return Number(v);
  return v.slice(0, 64);
}

function pointRef(pt: XmlElement | undefined): [number | string, number | string] {
  return [guideRef(pt, "x"), guideRef(pt, "y")];
}

const FULL_RECT = new Set(["l:t:r:b"]);

/** Reads `a:custGeom`. `frame` is the element's box, which sizes a path that gives no size of its own. Undefined if nothing in it can be drawn. */
function readCustGeom(cg: XmlElement, ctx: Ctx, frame: Frame): CustomGeometry | undefined {
  const custom: CustomGeometry = { paths: [] };
  const adjust: Record<string, number> = {};
  const guides: { name: string; fmla: string }[] = [];
  const addGuide = (gd: XmlElement, intoAdjust: boolean) => {
    const name = gd.attrs.name?.trim();
    const fmla = gd.attrs.fmla?.trim();
    if (!name || !fmla || guides.length >= MAX_CUSTOM_GUIDES) return;
    const m = /^val\s+(-?\d+(?:\.\d+)?)$/.exec(fmla);
    if (intoAdjust && m) adjust[name] = Number(m[1]);
    else guides.push({ name: name.slice(0, 64), fmla: fmla.slice(0, 400) });
  };
  for (const gd of childrenNamed(child(cg, "avLst"), "gd")) addGuide(gd, true);
  for (const gd of childrenNamed(child(cg, "gdLst"), "gd")) addGuide(gd, false);
  if (!isEmptyObject(adjust)) custom.adjust = adjust;
  if (guides.length) custom.guides = guides;

  const rect = child(cg, "rect");
  if (rect) {
    const r = { l: guideRef(rect, "l"), t: guideRef(rect, "t"), r: guideRef(rect, "r"), b: guideRef(rect, "b") };
    if (!FULL_RECT.has(`${r.l}:${r.t}:${r.r}:${r.b}`)) custom.rect = r;
  }

  const widthE = frame.w !== undefined ? Math.round(frame.w * EMU) : 0;
  const heightE = frame.h !== undefined ? Math.round(frame.h * EMU) : 0;
  let total = 0;
  let cut = false;
  for (const p of childrenNamed(child(cg, "pathLst"), "path")) {
    if (custom.paths.length >= MAX_CUSTOM_PATHS) {
      cut = true;
      break;
    }
    const commands: CustomCommand[] = [];
    for (const c of elements(p)) {
      if (total >= MAX_CUSTOM_COMMANDS) {
        cut = true;
        break;
      }
      const pts = childrenNamed(c, "pt");
      switch (c.name) {
        case "moveTo":
          if (pts[0]) commands.push(["M", ...pointRef(pts[0])]);
          break;
        case "lnTo":
          if (pts[0]) commands.push(["L", ...pointRef(pts[0])]);
          break;
        case "cubicBezTo":
          if (pts.length >= 3) commands.push(["C", ...pointRef(pts[0]), ...pointRef(pts[1]), ...pointRef(pts[2])]);
          break;
        case "quadBezTo":
          if (pts.length >= 2) commands.push(["Q", ...pointRef(pts[0]), ...pointRef(pts[1])]);
          break;
        case "arcTo":
          commands.push(["A", guideRef(c, "wR"), guideRef(c, "hR"), guideRef(c, "stAng"), guideRef(c, "swAng")]);
          break;
        case "close":
          commands.push(["Z"]);
          break;
      }
      total++;
    }
    if (commands.length < 2) continue;
    const w = numAttr(p, "w") ?? 0;
    const h = numAttr(p, "h") ?? 0;
    // A path with no size of its own is drawn in the element's EMU space. With plain numbers that is the box it has now,
    // so the drawing scales when the element is resized; with guides it stays "unsized", because the guides follow the element.
    const guided = commands.some((c) => c.slice(1).some((v) => typeof v === "string"));
    const path: CustomPath = { w: w > 0 ? w : guided ? 0 : widthE, h: h > 0 ? h : guided ? 0 : heightE, commands };
    const fill = p.attrs.fill;
    if (fill && PATH_FILLS.has(fill)) path.fill = fill as CustomPath["fill"];
    if (boolAttr(p, "stroke") === false) path.stroke = false;
    custom.paths.push(path);
  }
  if (cut) ctx.warn("a freeform shape was too complex and was cut short");
  if (custom.paths.length === 0) return undefined;
  const missing = unresolvedGuides(custom);
  if (missing.length) ctx.warn(`a freeform shape refers to ${missing.length === 1 ? "a guide" : "guides"} it doesn't define (${missing.slice(0, 3).join(", ")}); ${missing.length === 1 ? "it was" : "they were"} read as 0`);
  return custom;
}

function readAdjust(geom: XmlElement | undefined): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const gd of childrenNamed(child(geom, "avLst"), "gd")) {
    const m = /^val\s+(-?\d+)$/.exec(gd.attrs.fmla ?? "");
    if (gd.attrs.name && m) out[gd.attrs.name] = Number(m[1]);
  }
  return isEmptyObject(out) ? undefined : out;
}

interface Budget {
  count: number;
  warned: boolean;
}

function commonProps(cNvPr: XmlElement | undefined): { name?: string; alt?: string; hidden?: boolean } {
  const name = cNvPr?.attrs.name;
  return clean({
    name: name && !name.startsWith("Google Shape;") ? name.slice(0, 200) : undefined,
    alt: cNvPr?.attrs.descr ? cNvPr.attrs.descr.slice(0, 2000) : undefined,
    hidden: boolAttr(cNvPr, "hidden") ? true : undefined,
  });
}

function parseSp(sp: XmlElement, ctx: Ctx, owner: Owner): ShapeElement {
  const nv = elements(sp)[0];
  const cNvPr = child(nv, "cNvPr");
  const ph = readPlaceholder(child(child(nv, "nvPr"), "ph"));
  const spPr = child(sp, "spPr");
  const style = child(sp, "style");
  const txBody = child(sp, "txBody");
  const isCxn = sp.name === "cxnSp";

  let geometry = "rect";
  let custom: CustomGeometry | undefined;
  const frame = readFrame(child(spPr, "xfrm"));
  const prst = child(spPr, "prstGeom");
  if (prst?.attrs.prst) geometry = prst.attrs.prst === "straightConnector1" ? "line" : prst.attrs.prst;
  else if (child(spPr, "custGeom")) {
    custom = readCustGeom(child(spPr, "custGeom")!, ctx, frame);
    if (custom) geometry = "custom";
    else ctx.warn("a freeform shape without a drawable path was replaced by a rectangle");
  }

  const el: ShapeElement = { type: "shape", id: newId("e_"), geometry, ...commonProps(cNvPr), ...frame };
  if (custom) el.custom = custom;
  if (ph) el.placeholder = ph;
  if (boolAttr(child(nv, "cNvSpPr"), "txBox")) el.textBox = true;
  const adj = readAdjust(prst);
  if (adj) el.adjust = adj;
  const link = child(cNvPr, "hlinkClick");
  if (link) {
    const url = linkTarget(link, ctx);
    if (url) el.link = url;
  }

  // Paint: what the shape says, else what its style points at in the theme.
  if (!isCxn) {
    let fill = fillIn(spPr, ctx);
    const fr = child(style, "fillRef");
    if (fill === undefined && fr && numAttr(fr, "idx") !== undefined) fill = themeFill(ctx, numAttr(fr, "idx")!, colorIn(fr, ctx));
    if (fill !== undefined) el.fill = fill;
  }
  let baseLine: Line | null | undefined;
  const lr = child(style, "lnRef");
  if (lr && numAttr(lr, "idx") !== undefined) {
    const idx = numAttr(lr, "idx")!;
    const src = idx === 0 ? undefined : ctx.theme.lines[idx - 1];
    if (idx === 0) baseLine = null;
    else if (src) baseLine = lineOf(src, { ...ctx, phClr: colorIn(lr, ctx), warn: () => {} }) ?? undefined;
  }
  const ln = child(spPr, "ln");
  const line = ln ? lineOf(ln, ctx, baseLine) : baseLine;
  if (line !== undefined) el.line = line;

  const eff = child(spPr, "effectLst");
  if (eff) el.shadow = shadowOf(child(eff, "outerShdw"), ctx) ?? null;
  else {
    const er = child(style, "effectRef");
    const idx = numAttr(er, "idx") ?? 0;
    const src = idx > 0 ? child(ctx.theme.effects[idx - 1], "effectLst") : undefined;
    const shadow = shadowOf(child(src, "outerShdw"), { ...ctx, phClr: colorIn(er, ctx) });
    if (shadow) el.shadow = shadow;
  }

  if (txBody) {
    const defaultColor = ph ? undefined : colorIn(child(style, "fontRef"), ctx);
    const text = readTextBody(txBody, ctx, { defaultColor, template: !!ph && owner !== "slide" });
    const hasText = text.paragraphs.some((p) => p.runs.length > 0);
    if (ph || el.textBox || hasText) el.text = text;
  }
  return el;
}

function parsePic(pic: XmlElement, ctx: Ctx, fallbackFrame?: Frame): ImageElement | undefined {
  const nv = elements(pic)[0];
  const cNvPr = child(nv, "cNvPr");
  const nvPr = child(nv, "nvPr");
  const blipFill = child(pic, "blipFill");
  const blip = child(blipFill, "blip");
  // The svg is the better picture, but every viewer draws the PNG that comes with it.
  const src = imageUri(ctx, prefixedAttr(blip, "embed") ?? prefixedAttr(findDesc(blip, "svgBlip"), "embed") ?? prefixedAttr(blip, "link"));
  if (nvPr && (child(nvPr, "videoFile") || child(nvPr, "audioFile") || findDesc(nvPr, "media"))) ctx.warn("audio/video was not imported; the still picture was kept");
  if (!src) return undefined;
  const spPr = child(pic, "spPr");
  const frame = readFrame(child(spPr, "xfrm"));
  const geometry = child(spPr, "prstGeom")?.attrs.prst;
  const img: ImageElement = { type: "image", id: newId("e_"), src, ...commonProps(cNvPr), ...(frame.x !== undefined || !fallbackFrame ? frame : fallbackFrame) };
  const ph = readPlaceholder(child(nvPr, "ph"));
  if (ph) img.placeholder = ph;
  const crop = cropOf(child(blipFill, "srcRect"));
  if (crop) img.crop = crop;
  if (geometry && geometry !== "rect") img.geometry = geometry;
  const cg = child(spPr, "custGeom");
  if (!geometry && cg) {
    const custom = readCustGeom(cg, ctx, img);
    if (custom) img.custom = custom;
    else ctx.warn("a picture with a freeform mask without a drawable path was shown unmasked");
  }
  const ln = child(spPr, "ln");
  if (ln) {
    const line = lineOf(ln, ctx);
    if (line !== undefined) img.line = line;
  }
  const eff = child(spPr, "effectLst");
  const shadow = shadowOf(child(eff, "outerShdw"), ctx);
  if (shadow) img.shadow = shadow;
  const link = child(cNvPr, "hlinkClick");
  if (link) {
    const url = linkTarget(link, ctx);
    if (url) img.link = url;
  }
  return img;
}

function parseTable(tbl: XmlElement, frame: Frame, props: ReturnType<typeof commonProps>, ctx: Ctx): TableElement | undefined {
  const grid = childrenNamed(child(tbl, "tblGrid"), "gridCol").slice(0, MAX_TABLE_COLS);
  const trs = childrenNamed(tbl, "tr").slice(0, MAX_TABLE_ROWS);
  if (grid.length === 0 || trs.length === 0) {
    ctx.warn("an empty table was skipped");
    return undefined;
  }
  let columns = grid.map((g) => Math.max(1, emuAttr(g, "w") ?? 72));
  const total = columns.reduce((a, b) => a + b, 0);
  const width = frame.w ?? total;
  if (!(total > 0) || !Number.isFinite(total)) columns = columns.map(() => width / columns.length);
  const pr = child(tbl, "tblPr");
  const table: TableElement = {
    type: "table",
    id: newId("e_"),
    ...props,
    ...frame,
    columns,
    rows: trs.map((tr) => {
      const tcs = childrenNamed(tr, "tc");
      const cells: TableCell[] = [];
      for (let c = 0; c < columns.length; c++) {
        const tc = tcs[c];
        if (!tc) {
          cells.push({ paragraphs: [{ runs: [] }] });
          continue;
        }
        const tcPr = child(tc, "tcPr");
        const tx = child(tc, "txBody");
        const cell: TableCell = { paragraphs: tx ? readTextBody(tx, ctx).paragraphs : [{ runs: [] }] };
        const fill = fillIn(tcPr, ctx);
        if (fill !== undefined) cell.fill = fill;
        const span = numAttr(tc, "gridSpan");
        const rowSpan = numAttr(tc, "rowSpan");
        if (span && span > 1) cell.colSpan = Math.min(Math.round(span), columns.length - c);
        if (rowSpan && rowSpan > 1) cell.rowSpan = Math.min(Math.round(rowSpan), trs.length);
        if (boolAttr(tc, "hMerge") || boolAttr(tc, "vMerge")) {
          cell.covered = true;
          cell.paragraphs = [{ runs: [] }];
        }
        const anchor = tcPr?.attrs.anchor;
        if (anchor === "t") cell.vAlign = "top";
        else if (anchor === "ctr") cell.vAlign = "middle";
        else if (anchor === "b") cell.vAlign = "bottom";
        const borders: NonNullable<TableCell["borders"]> = {};
        for (const [tag, key] of [["lnT", "top"], ["lnR", "right"], ["lnB", "bottom"], ["lnL", "left"]] as const) {
          const ln = child(tcPr, tag);
          const line = ln ? lineOf(ln, ctx) : undefined;
          if (line !== undefined) borders[key] = line;
        }
        if (!isEmptyObject(borders)) cell.borders = borders;
        cells.push(cell);
      }
      return { h: Math.max(1, emuAttr(tr, "h") ?? 20), cells };
    }),
  };
  if (boolAttr(pr, "firstRow")) table.headerRow = true;
  if (boolAttr(pr, "bandRow")) table.banded = true;
  if (frame.x !== undefined) table.h = table.rows.reduce((a, r) => a + r.h, 0);
  return table;
}

/** The map from a group's child space to the space it sits in. */
interface GroupXf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  chx: number;
  chy: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

function boundsOfAll(els: Element[]): { x: number; y: number; w: number; h: number } | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    if (e.x === undefined || e.y === undefined || e.w === undefined || e.h === undefined) continue;
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w);
    y1 = Math.max(y1, e.y + e.h);
  }
  return x0 === Infinity ? undefined : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Moves an element read in a group's child space into the space of the group's parent (rotation and flips are baked in). */
function mapThrough(el: Element, g: GroupXf): void {
  if (el.type === "group") {
    for (const c of el.children) mapThrough(c, g);
    const b = boundsOfAll(el.children);
    if (b) Object.assign(el, b);
    return;
  }
  if (el.x === undefined || el.y === undefined || el.w === undefined || el.h === undefined) return;
  const w = el.w * g.sx;
  const h = el.h * g.sy;
  let cx = g.ox + (el.x - g.chx) * g.sx + w / 2;
  let cy = g.oy + (el.y - g.chy) * g.sy + h / 2;
  let rot = el.rotation ?? 0;
  let fh = !!el.flipH;
  let fv = !!el.flipV;
  const gcx = g.ox + g.w / 2;
  const gcy = g.oy + g.h / 2;
  if (g.flipH) { cx = 2 * gcx - cx; fh = !fh; rot = -rot; }
  if (g.flipV) { cy = 2 * gcy - cy; fv = !fv; rot = -rot; }
  if (g.rot) {
    const a = (g.rot * Math.PI) / 180;
    const dx = cx - gcx;
    const dy = cy - gcy;
    cx = gcx + dx * Math.cos(a) - dy * Math.sin(a);
    cy = gcy + dx * Math.sin(a) + dy * Math.cos(a);
    rot += g.rot;
  }
  el.w = w;
  el.h = h;
  el.x = cx - w / 2;
  el.y = cy - h / 2;
  rot = normAngle(rot);
  if (rot) el.rotation = round3(rot);
  else delete el.rotation;
  if (fh) el.flipH = true;
  else delete el.flipH;
  if (fv) el.flipV = true;
  else delete el.flipV;
}

function parseGroup(grp: XmlElement, ctx: Ctx, owner: Owner, depth: number, budget: Budget): GroupElement | undefined {
  if (depth >= MAX_GROUP_DEPTH) {
    ctx.warn("groups nested too deeply; the inner ones were skipped");
    return undefined;
  }
  const cNvPr = child(child(grp, "nvGrpSpPr"), "cNvPr");
  const xfrm = child(child(grp, "grpSpPr"), "xfrm");
  const children = parseNodes(elements(grp), ctx, owner, depth + 1, budget);
  if (children.length === 0) return undefined;
  const frame = readFrame(xfrm);
  const chExt = child(xfrm, "chExt");
  const chOff = child(xfrm, "chOff");
  if (frame.x !== undefined) {
    const cw = emuAttr(chExt, "cx") ?? frame.w!;
    const ch = emuAttr(chExt, "cy") ?? frame.h!;
    const g: GroupXf = {
      ox: frame.x,
      oy: frame.y!,
      sx: cw > 0 ? frame.w! / cw : 1,
      sy: ch > 0 ? frame.h! / ch : 1,
      chx: emuAttr(chOff, "x") ?? frame.x,
      chy: emuAttr(chOff, "y") ?? frame.y!,
      w: frame.w!,
      h: frame.h!,
      rot: frame.rotation ?? 0,
      flipH: !!frame.flipH,
      flipV: !!frame.flipV,
    };
    for (const c of children) mapThrough(c, g);
  }
  const group: GroupElement = { type: "group", id: newId("e_"), ...commonProps(cNvPr), children, ...(boundsOfAll(children) ?? {}) };
  return group;
}

// ---- Charts ------------------------------------------------------------------------------------------------------

const MAX_CHART_SERIES = 256;
const MAX_CHART_POINTS = 10_000;
const MAX_CHART_TOTAL = 100_000;
const CHART_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";

/** A boolean element (`<c:smooth/>` is true; a missing element is `undefined`). */
function chartBool(el: XmlElement | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.attrs.val;
  return v === undefined ? true : v === "1" || v === "true";
}

const chartVal = (el: XmlElement | undefined): string | undefined => el?.attrs.val;

/** The cached points of a `strRef`/`numRef`/`strLit`/`numLit`/`multiLvlStrRef`, by index. */
function chartPoints(src: XmlElement | undefined): { points: Map<number, string>; count: number; format?: string } {
  const points = new Map<number, string>();
  let node: XmlElement | undefined = src;
  if (node && (node.name === "strRef" || node.name === "numRef")) node = child(node, "strCache") ?? child(node, "numCache");
  else if (node && node.name === "multiLvlStrRef") node = child(child(node, "multiLvlStrCache"), "lvl");
  let count = 0;
  if (node) {
    count = clamp(Math.round(numAttr(child(node, "ptCount"), "val") ?? 0), 0, MAX_CHART_POINTS);
    for (const pt of childrenNamed(node, "pt").slice(0, MAX_CHART_POINTS)) {
      const idx = numAttr(pt, "idx");
      if (idx === undefined || idx < 0 || idx >= MAX_CHART_POINTS) continue;
      points.set(Math.round(idx), textOf(child(pt, "v")));
      count = Math.max(count, Math.round(idx) + 1);
    }
  }
  return { points, count, format: node ? textOf(child(node, "formatCode")) || undefined : undefined };
}

/** Text a spreadsheet date serial stands for, when the number format is a date format. */
function serialText(n: number, format: string | undefined): string {
  if (format && /[ymd]/i.test(format.replace(/"[^"]*"/g, "")) && !/[#0]/.test(format.replace(/"[^"]*"/g, ""))) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return String(Number(n.toPrecision(10)));
}

function chartNumbers(src: XmlElement | undefined): (number | null)[] {
  const { points, count } = chartPoints(src);
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const n = points.has(i) ? Number(points.get(i)!.trim()) : NaN;
    out.push(points.has(i) && points.get(i)!.trim() !== "" && Number.isFinite(n) ? n : null);
  }
  return out;
}

function chartStrings(src: XmlElement | undefined): string[] {
  const { points, count, format } = chartPoints(src);
  const numeric = src?.name === "numRef" || src?.name === "numLit";
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = points.get(i) ?? "";
    out.push((numeric && t.trim() !== "" && Number.isFinite(Number(t)) ? serialText(Number(t), format) : t).slice(0, 500));
  }
  return out;
}

/** The text of rich text (`c:rich`, or `c:tx` with `c:strRef`): paragraphs on lines. */
function chartRichText(tx: XmlElement | undefined): string | undefined {
  const rich = child(tx, "rich");
  if (rich) {
    const lines = childrenNamed(rich, "p").map((p) =>
      elements(p)
        .filter((r) => r.name === "r" || r.name === "fld")
        .map((r) => textOf(child(r, "t")))
        .join(""),
    );
    return lines.join("\n").slice(0, 1000);
  }
  const ref = child(tx, "strRef");
  if (ref) return chartStrings(ref)[0];
  const v = child(tx, "v");
  return v ? textOf(v).slice(0, 1000) : undefined;
}

interface ChartText {
  size?: number;
  color?: Color;
  family?: string;
}

/** The text style a `c:txPr` or `c:rich` sets: its first paragraph's default run properties. */
function chartTextStyle(node: XmlElement | undefined, ctx: Ctx): ChartText {
  const p = child(node, "p");
  const d = child(child(p, "pPr"), "defRPr") ?? child(child(p, "r"), "rPr");
  if (!d) return {};
  const m = readRPr(d, ctx);
  const family = m.fontFamily && !m.fontFamily.startsWith("+") ? m.fontFamily : undefined;
  return clean({ size: m.fontSize, color: m.color, family });
}

function chartFillColor(spPr: XmlElement | undefined, ctx: Ctx): Color | null | undefined {
  const f = fillIn(spPr, ctx);
  if (f === undefined || f === null) return f;
  if (typeof f === "string" || "theme" in f) return f;
  if ("gradient" in f) return f.gradient.stops[0]?.color;
  return undefined;
}

function chartLine(spPr: XmlElement | undefined, ctx: Ctx): { color?: Color; none: boolean; width?: number } | undefined {
  const ln = child(spPr, "ln");
  if (!ln) return undefined;
  if (child(ln, "noFill")) return { none: true };
  const l = lineOf(ln, ctx);
  return { none: false, color: l?.color, width: l?.width };
}

const CHART_KINDS = new Set(["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart", "pieChart", "pie3DChart", "doughnutChart", "scatterChart"]);
const CHART_UNSUPPORTED: Record<string, string> = {
  radarChart: "radar", surfaceChart: "surface", surface3DChart: "surface", stockChart: "stock", bubbleChart: "bubble", ofPieChart: "pie-of-pie",
};

interface ParsedChart {
  chart?: Omit<ChartElement, "id" | "type">;
  /** Why it could not be drawn, and the title to show on the stand-in box. */
  unsupported?: { kind: string; title?: string };
}

function parseChartSpace(root: XmlElement, ctx: Ctx): ParsedChart {
  const chartEl = child(root, "chart");
  const plotArea = child(chartEl, "plotArea");
  const titleEl = child(chartEl, "title");
  const plotKids = elements(plotArea);
  const titleText = (series: { name: string }[]): string | undefined => {
    if (!titleEl) return undefined;
    const explicit = chartRichText(child(titleEl, "tx"));
    if (explicit !== undefined) return explicit;
    if (chartBool(child(chartEl, "autoTitleDeleted"))) return undefined;
    return series.length === 1 ? series[0]!.name : "Chart Title";
  };
  const other = plotKids.find((k) => CHART_UNSUPPORTED[k.name]);
  const groups = plotKids.filter((k) => CHART_KINDS.has(k.name));
  if (other || groups.length === 0) {
    const firstSer = plotKids.flatMap((k) => childrenNamed(k, "ser"))[0];
    const name = chartRichText(child(firstSer, "tx")) ?? "";
    return { unsupported: { kind: other ? CHART_UNSUPPORTED[other.name]! : "empty", title: chartRichText(child(titleEl, "tx")) ?? (name || undefined) } };
  }

  type Kind = "column" | "line" | "area" | "pie" | "doughnut" | "scatter";
  const kindOf = (g: XmlElement): Kind => (/^bar/.test(g.name) ? "column" : /^line/.test(g.name) ? "line" : /^area/.test(g.name) ? "area" : /^pie/.test(g.name) ? "pie" : g.name === "doughnutChart" ? "doughnut" : "scatter");
  const horizontal = (g: XmlElement) => /^bar/.test(g.name) && chartVal(child(g, "barDir")) === "bar";
  // the chart's own type: bars first, else the first group; a pie, doughnut or scatter chart can't share its plot area
  const cartesian = groups.filter((g) => ["column", "line", "area"].includes(kindOf(g)));
  let used: XmlElement[] = groups;
  if (groups.length > 1 && cartesian.length !== groups.length) {
    used = [groups[0]!];
    ctx.warn("a chart that combines a pie, doughnut or scatter plot with other kinds was reduced to its first plot");
  }
  const baseGroup = used.find((g) => kindOf(g) === "column") ?? used[0]!;
  const baseKind = kindOf(baseGroup);
  const axisIds = new Set(used.map((g) => childrenNamed(g, "axId").map((a) => chartVal(a)).join(",")));
  if (axisIds.size > 1) ctx.warn("a chart with a secondary axis was drawn on one set of axes");

  const rawGrouping = chartVal(child(baseGroup, "grouping"));
  const grouping = rawGrouping === "stacked" ? "stacked" : rawGrouping === "percentStacked" ? "percentStacked" : undefined;
  const chartType: ChartType = baseKind === "column" ? (horizontal(baseGroup) ? "bar" : "column") : baseKind;

  const series: ChartSeries[] = [];
  let categories: string[] = [];
  let labels: ChartDataLabels | null | undefined;
  let total = 0;
  const readLabels = (dl: XmlElement | undefined): ChartDataLabels | null | undefined => {
    if (!dl) return undefined;
    if (chartBool(child(dl, "delete"))) return null;
    const value = chartBool(child(dl, "showVal")) ?? false;
    const percent = chartBool(child(dl, "showPercent")) ?? false;
    const category = chartBool(child(dl, "showCatName")) ?? false;
    const ser = chartBool(child(dl, "showSerName")) ?? false;
    if (!value && !percent && !category && !ser) return null;
    const fmt = child(dl, "numFmt");
    const format = fmt && fmt.attrs.sourceLinked !== "1" ? fmt.attrs.formatCode : undefined;
    const pos = { outEnd: "outside", inEnd: "inside", ctr: "center" }[chartVal(child(dl, "dLblPos")) ?? ""] as ChartDataLabels["position"] | undefined;
    return clean({ value: value || undefined, percent: percent || undefined, category: category || undefined, series: ser || undefined, format: format && format !== "General" ? format : undefined, position: pos });
  };
  let scatterLines = true;
  let scatterSmooth = false;
  for (const g of used) {
    const kind = kindOf(g);
    if (kind === "scatter") {
      const style = chartVal(child(g, "scatterStyle")) ?? "lineMarker";
      scatterLines = style !== "marker";
      scatterSmooth = style === "smoothMarker";
    }
    const groupLabels = readLabels(child(g, "dLbls"));
    if (labels === undefined && groupLabels !== undefined) labels = groupLabels;
    const groupMarker = chartBool(child(g, "marker"));
    for (const ser of childrenNamed(g, "ser")) {
      if (series.length >= MAX_CHART_SERIES) {
        ctx.warn(`a chart has more than ${MAX_CHART_SERIES} series; the rest were skipped`);
        break;
      }
      const position = series.length;
      const idx = numAttr(child(ser, "idx"), "val") ?? position;
      const name = (chartRichText(child(ser, "tx")) ?? "").trim() || `Series ${position + 1}`;
      const spPr = child(ser, "spPr");
      const s: ChartSeries = { name: name.slice(0, 200), values: [] };
      if (kind === "scatter") {
        const xs = elements(child(ser, "xVal"))[0];
        const xn = xs?.name === "numRef" || xs?.name === "numLit" ? chartNumbers(xs) : [];
        const ys = chartNumbers(elements(child(ser, "yVal"))[0]);
        s.values = ys;
        if (xn.length) s.x = ys.map((_, k) => xn[k] ?? k + 1);
        else if (xs) ctx.warn("a scatter chart's text X values were replaced by 1, 2, 3…");
      } else {
        s.values = chartNumbers(elements(child(ser, "val"))[0]);
        const cat = elements(child(ser, "cat"))[0];
        if (cat && categories.length === 0) categories = chartStrings(cat);
      }
      total += s.values.length;
      if (total > MAX_CHART_TOTAL) {
        ctx.warn("a chart has too many data points; the rest were skipped");
        break;
      }
      // colour: a fill for bars, areas and slices; a line for lines and scatter points
      const line = chartLine(spPr, ctx);
      const color: Color | undefined =
        kind === "line" || kind === "scatter"
          ? ((line && !line.none ? line.color : undefined) ?? (chartFillColor(child(child(ser, "marker"), "spPr"), ctx) || undefined))
          : (chartFillColor(spPr, ctx) ?? undefined);
      if (color !== undefined) s.color = color;
      else if (idx !== position && kind !== "pie" && kind !== "doughnut") s.color = defaultSeriesColor(idx);
      if (line?.width && (kind === "line" || kind === "scatter")) s.lineWidth = round2(line.width);
      if (kind === "pie" || kind === "doughnut") {
        const colors: Color[] = [];
        for (const dpt of childrenNamed(ser, "dPt").slice(0, MAX_CHART_POINTS)) {
          const k = numAttr(child(dpt, "idx"), "val");
          const c = chartFillColor(child(dpt, "spPr"), ctx);
          if (k !== undefined && k >= 0 && k < MAX_CHART_POINTS && c) colors[Math.round(k)] = c;
        }
        if (colors.some((c) => c !== undefined)) s.pointColors = Array.from({ length: Math.max(colors.length, s.values.length) }, (_, k) => colors[k] ?? defaultSeriesColor(k));
      }
      if (kind === "line" || kind === "scatter") {
        const smooth = chartBool(child(ser, "smooth"));
        if (kind === "line" && smooth !== undefined) s.smooth = smooth;
        if (kind === "scatter" && (smooth ?? scatterSmooth)) s.smooth = true;
        const mk = child(ser, "marker");
        const symbol = chartVal(child(mk, "symbol"));
        if (mk && symbol !== undefined) s.marker = symbol !== "none";
        else if (!mk) s.marker = kind === "scatter" ? true : (groupMarker ?? true);
        if (kind === "scatter") s.line = line ? !line.none : scatterLines;
      }
      const seriesLabels = readLabels(child(ser, "dLbls"));
      if ((labels === undefined || labels === null) && seriesLabels) labels = seriesLabels;
      if (kind !== baseKind && kind !== "pie" && kind !== "doughnut" && kind !== "scatter") s.type = kind;
      series.push(s);
    }
  }

  // axes
  const catAxes = elements(plotArea).filter((a) => a.name === "catAx" || a.name === "dateAx" || a.name === "serAx");
  const valAxes = elements(plotArea).filter((a) => a.name === "valAx");
  const readAxis = (a: XmlElement | undefined): ChartAxis | undefined => {
    if (!a) return undefined;
    const out: ChartAxis = {};
    if (chartBool(child(a, "delete"))) out.hidden = true;
    const scaling = child(a, "scaling");
    const min = numAttr(child(scaling, "min"), "val");
    const max = numAttr(child(scaling, "max"), "val");
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    const major = numAttr(child(a, "majorUnit"), "val");
    if (major !== undefined && major > 0) out.majorUnit = major;
    const nf = child(a, "numFmt");
    if (nf && nf.attrs.sourceLinked !== "1" && nf.attrs.formatCode && nf.attrs.formatCode !== "General") out.format = nf.attrs.formatCode;
    const grid = child(a, "majorGridlines");
    out.gridlines = !!grid;
    const gridColor = chartLine(child(grid, "spPr"), ctx);
    if (gridColor?.color) out.gridColor = gridColor.color;
    const t = child(a, "title");
    const text = t ? chartRichText(child(t, "tx")) : undefined;
    if (text) out.title = text;
    const line = chartLine(child(a, "spPr"), ctx);
    if (line?.none) out.line = null;
    else if (line?.color) out.line = line.color;
    return out;
  };
  let categoryAxis: ChartAxis | undefined;
  let valueAxis: ChartAxis | undefined;
  if (baseKind === "scatter") {
    categoryAxis = readAxis(valAxes[0]);
    valueAxis = readAxis(valAxes[1]);
  } else if (baseKind !== "pie" && baseKind !== "doughnut") {
    categoryAxis = readAxis(catAxes[0]);
    valueAxis = readAxis(valAxes[0]);
  }

  const chart: Omit<ChartElement, "id" | "type"> = { chartType, categories, series };
  if (baseKind === "column" || baseKind === "line" || baseKind === "area") if (grouping) chart.grouping = grouping;
  const title = titleText(series);
  if (title !== undefined && title.trim() !== "") {
    chart.title = title;
    const ts = chartTextStyle(child(titleEl, "txPr") ?? child(child(titleEl, "tx"), "rich"), ctx);
    if (ts.size) chart.titleSize = round2(ts.size);
  }
  const legend = child(chartEl, "legend");
  const pos = chartVal(child(legend, "legendPos")) ?? "r";
  chart.legend = !legend ? "none" : pos === "t" ? "top" : pos === "b" ? "bottom" : pos === "l" ? "left" : "right";
  if (categoryAxis) chart.categoryAxis = categoryAxis;
  if (valueAxis) chart.valueAxis = valueAxis;
  if (labels) chart.dataLabels = labels;
  const gap = numAttr(child(baseGroup, "gapWidth"), "val");
  if (gap !== undefined && baseKind === "column") chart.gapWidth = clamp(gap, 0, 500);
  const overlap = numAttr(child(baseGroup, "overlap"), "val");
  if (overlap !== undefined && baseKind === "column" && !(grouping && overlap === 100)) chart.overlap = clamp(overlap, -100, 100);
  if (baseKind === "doughnut") {
    const hole = numAttr(child(baseGroup, "holeSize"), "val");
    if (hole !== undefined) chart.holeSize = clamp(hole, 10, 90);
  }
  if (baseKind === "pie" || baseKind === "doughnut") {
    const first = numAttr(child(baseGroup, "firstSliceAng"), "val");
    if (first) chart.firstSliceAngle = clamp(first, 0, 360);
  }
  // text: the axis labels' style is what shows most, then the legend's, then the chart's own
  const styles = [chartTextStyle(child(catAxes[0] ?? valAxes[0], "txPr"), ctx), chartTextStyle(child(valAxes[0], "txPr"), ctx), chartTextStyle(child(legend, "txPr"), ctx), chartTextStyle(child(root, "txPr"), ctx)];
  const size = styles.find((t) => t.size)?.size;
  const color = styles.find((t) => t.color)?.color;
  const family = styles.find((t) => t.family)?.family;
  if (size) chart.textSize = round2(size);
  if (color) chart.textColor = color;
  if (family) chart.fontFamily = family;
  const fill = chartFillColor(child(root, "spPr"), ctx);
  if (fill) chart.fill = fill;
  const plotFill = chartFillColor(child(plotArea, "spPr"), ctx);
  if (plotFill) chart.plotFill = plotFill;
  return { chart };
}

/** A chart that can't be drawn: an empty dashed box named for it, showing its title. */
function chartPlaceholder(frame: Frame, props: ReturnType<typeof commonProps>, title: string | undefined): ShapeElement {
  const label = title?.trim() || props.name || "Chart";
  return {
    type: "shape",
    id: newId("e_"),
    ...props,
    ...frame,
    geometry: "rect",
    fill: null,
    line: { color: "#bfbfbf", width: 1, dash: "dash" },
    text: { paragraphs: [{ align: "center", runs: [{ text: label, marks: { color: "#7f7f7f" } }] }], vAlign: "middle" },
  };
}

function parseChartFrame(data: XmlElement | undefined, frame: Frame, props: ReturnType<typeof commonProps>, ph: Placeholder | undefined, ctx: Ctx): Element[] {
  const label = `a chart${props.name ? ` ("${props.name}")` : ""}`;
  const rid = prefixedAttr(findDesc(data, "chart"), "id");
  const rel = rid ? ctx.rels.get(rid) : undefined;
  const root = rel && !rel.external ? ctx.shared.pkg.xml(rel.target) : undefined;
  if (!root || root.name !== "chartSpace") {
    ctx.warn(`${label} could not be read (its chart part is missing); an empty box stands in for it`);
    return [chartPlaceholder(frame, props, undefined)];
  }
  const cctx = makeCtx(ctx.shared, rel!.target, ctx.theme, ctx.map, ctx.label);
  let parsed: ParsedChart;
  try {
    parsed = parseChartSpace(root, cctx);
  } catch (cause) {
    ctx.warn(`${label} couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}); an empty box stands in for it`);
    return [chartPlaceholder(frame, props, undefined)];
  }
  if (!parsed.chart) {
    const u = parsed.unsupported!;
    ctx.warn(u.kind === "empty" ? `${label} has nothing to draw` : `${label} is a ${u.kind} chart, which isn't supported; an empty box with its title stands in for it`);
    return [chartPlaceholder(frame, props, u.title)];
  }
  const el = { type: "chart", id: newId("e_"), ...props, ...frame, ...parsed.chart } as ChartElement;
  delete el.rotation;
  if (ph) el.placeholder = ph;
  return [el];
}

function parseGraphicFrame(gf: XmlElement, ctx: Ctx, owner: Owner, depth: number, budget: Budget): Element[] {
  const cNvPr = child(child(gf, "nvGraphicFramePr"), "cNvPr");
  const props = commonProps(cNvPr);
  const frame = readFrame(child(gf, "xfrm"));
  const data = findDesc(gf, "graphicData");
  const uri = data?.attrs.uri ?? "";
  const nvPr = child(child(gf, "nvGraphicFramePr"), "nvPr");
  const ph = readPlaceholder(child(nvPr, "ph"));
  const tbl = findDesc(data, "tbl");
  if (tbl) {
    const table = parseTable(tbl, frame, props, ctx);
    if (ph && table && frame.x === undefined) (table as TableElement).placeholder = ph;
    return table ? [table] : [];
  }
  if (uri === CHART_URI) return parseChartFrame(data, frame, props, ph, ctx);
  if (/chart/i.test(uri)) {
    // The newer chart kinds (waterfall, funnel, treemap…) keep their data in a different part: a fallback picture (when there is one) is used by the caller.
    ctx.warn(`a chart${props.name ? ` ("${props.name}")` : ""} of a newer kind was not imported`);
    return [];
  }
  if (/diagram/i.test(uri)) {
    const relIds = findDesc(data, "relIds");
    const dmRid = prefixedAttr(relIds, "dm");
    const dataPart = dmRid ? ctx.rels.get(dmRid) : undefined;
    const ext = dataPart && !dataPart.external ? findDesc(ctx.shared.pkg.xml(dataPart.target), "dataModelExt") : undefined;
    const drawingRel = ext?.attrs.relId ? ctx.rels.get(ext.attrs.relId) : undefined;
    const drawing = drawingRel && !drawingRel.external ? ctx.shared.pkg.xml(drawingRel.target) : undefined;
    if (drawing && frame.x !== undefined && drawingRel) {
      const sub = makeCtx(ctx.shared, drawingRel.target, ctx.theme, ctx.map, ctx.label);
      const kids = parseNodes(elements(child(drawing, "spTree")), sub, owner, depth + 1, budget);
      const g: GroupXf = { ox: frame.x, oy: frame.y!, sx: 1, sy: 1, chx: 0, chy: 0, w: frame.w!, h: frame.h!, rot: 0, flipH: false, flipV: false };
      for (const k of kids) mapThrough(k, g);
      if (kids.length) return [{ type: "group", id: newId("e_"), ...props, children: kids, ...(boundsOfAll(kids) ?? {}) }];
    }
    ctx.warn("a SmartArt diagram was not imported");
    return [];
  }
  // OLE objects, and anything else with a picture to stand in for it.
  const pic = findDesc(gf, "pic");
  if (pic) {
    const img = parsePic(pic, ctx, frame);
    if (img) {
      Object.assign(img, { ...props, ...(frame.x !== undefined ? frame : {}) });
      if (/ole/i.test(uri) || findDesc(data, "oleObj")) ctx.warn("an embedded object is shown as its picture only");
      return [img];
    }
  }
  ctx.warn(`${/ole/i.test(uri) || findDesc(data, "oleObj") ? "an embedded object" : "a graphic frame"}${props.name ? ` ("${props.name}")` : ""} was not imported`);
  return [];
}

/** The `id` of the `p:cNvPr` each element was read from: animations point at shapes by it. */
const SHAPE_IDS = new WeakMap<Element, string>();

function shapeIdOf(node: XmlElement): string | undefined {
  if (node.name !== "sp" && node.name !== "cxnSp" && node.name !== "pic" && node.name !== "grpSp" && node.name !== "graphicFrame") return undefined;
  return child(elements(node)[0], "cNvPr")?.attrs.id;
}

function parseNodes(nodes: XmlElement[], ctx: Ctx, owner: Owner, depth: number, budget: Budget): Element[] {
  const out: Element[] = [];
  for (const node of nodes) {
    if (budget.count >= MAX_ELEMENTS_PER_TREE) {
      if (!budget.warned) ctx.warn(`more than ${MAX_ELEMENTS_PER_TREE} shapes; the rest were skipped`);
      budget.warned = true;
      break;
    }
    const before = out.length;
    try {
      switch (node.name) {
        case "sp":
        case "cxnSp":
          budget.count++;
          out.push(parseSp(node, ctx, owner));
          break;
        case "pic": {
          budget.count++;
          const img = parsePic(node, ctx);
          if (img) out.push(img);
          break;
        }
        case "graphicFrame":
          budget.count++;
          out.push(...parseGraphicFrame(node, ctx, owner, depth, budget));
          break;
        case "grpSp": {
          budget.count++;
          const g = parseGroup(node, ctx, owner, depth, budget);
          if (g) out.push(g);
          break;
        }
        case "AlternateContent": {
          const collected: string[] = [];
          const quiet: Ctx = { ...ctx, warn: (m) => collected.push(m) };
          let got = parseNodes(elements(child(node, "Choice")), quiet, owner, depth, budget);
          const choiceWarnings = collected.splice(0);
          if (got.length === 0) {
            got = parseNodes(elements(child(node, "Fallback")), quiet, owner, depth, budget);
            for (const m of [...choiceWarnings, ...collected]) ctx.shared.warn(ctx.label ? `${ctx.label}: ${m}` : m);
            if (got.length > 0 && choiceWarnings.length) ctx.warn("a feature this app can't draw was replaced by its fallback picture");
          } else for (const m of choiceWarnings) ctx.shared.warn(ctx.label ? `${ctx.label}: ${m}` : m);
          out.push(...got);
          break;
        }
        case "contentPart":
          ctx.warn("ink or embedded content was not imported");
          break;
        default:
          break;
      }
      const spid = shapeIdOf(node);
      if (spid !== undefined && out.length === before + 1) SHAPE_IDS.set(out[before]!, spid);
    } catch (cause) {
      ctx.warn(`a shape couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}) and was skipped`);
    }
  }
  return out;
}

// ---- Backgrounds, transitions, notes ------------------------------------------------------------------------------

function readBackground(cSld: XmlElement | undefined, ctx: Ctx): Fill | undefined {
  const bg = child(cSld, "bg");
  if (!bg) return undefined;
  const pr = child(bg, "bgPr");
  if (pr) {
    const fill = fillIn(pr, ctx);
    return fill === null ? undefined : fill;
  }
  const ref = child(bg, "bgRef");
  const idx = numAttr(ref, "idx");
  if (ref && idx !== undefined) {
    const fill = themeFill(ctx, Math.round(idx), colorIn(ref, ctx));
    return fill === null ? undefined : fill;
  }
  return undefined;
}

const OPPOSITE: Record<string, "left" | "right" | "up" | "down"> = { l: "right", r: "left", u: "down", d: "up" };

const TRANSITION_TYPES: Record<string, TransitionType> = {
  fade: "fade", dissolve: "dissolve", cut: "none", push: "push", wipe: "wipe", zoom: "zoom",
  cover: "slide", pull: "slide", strips: "slide", comb: "slide", conveyor: "slide", doors: "slide", window: "slide", ferris: "slide", pan: "slide",
  split: "wipe", blinds: "wipe", randomBar: "wipe", checker: "wipe", wedge: "wipe", wheel: "wipe", wheelReverse: "wipe", circle: "wipe", diamond: "wipe", plus: "wipe", newsflash: "wipe",
  flip: "flip", switch: "flip", prism: "cube", gallery: "gallery",
};

function readTransition(sld: XmlElement): Transition | undefined {
  let tr: XmlElement | undefined;
  for (const ac of childrenNamed(sld, "AlternateContent")) {
    tr = child(child(ac, "Choice"), "transition") ?? child(child(ac, "Fallback"), "transition");
    if (tr) break;
  }
  tr ??= child(sld, "transition");
  if (!tr) return undefined;
  const kind = elements(tr).find((c) => c.name !== "sndAc");
  const type: TransitionType = kind ? (TRANSITION_TYPES[kind.name] ?? "fade") : "none";
  const out: Transition = { type };
  const dir = kind?.attrs.dir;
  if (dir && OPPOSITE[dir[0]!] && (type === "slide" || type === "push" || type === "wipe" || type === "flip" || type === "cube" || type === "gallery")) out.direction = OPPOSITE[dir[0]!];
  const dur = Number(prefixedAttr(tr, "dur"));
  if (prefixedAttr(tr, "dur") !== undefined && Number.isFinite(dur)) out.duration = clamp(Math.round(dur), 0, 60000);
  else if (tr.attrs.spd) out.duration = ({ fast: 500, med: 750, slow: 1000 } as Record<string, number>)[tr.attrs.spd];
  const adv = numAttr(tr, "advTm");
  if (adv !== undefined) out.advanceAfter = clamp(Math.round(adv), 0, 86_400_000);
  if (type === "none" && out.advanceAfter === undefined) return undefined;
  return clean(out);
}

function readNotes(slidePart: string, shared: Shared): string {
  const rel = shared.pkg.relOfType(slidePart, "notesSlide");
  if (!rel || rel.external) return "";
  const root = shared.pkg.xml(rel.target);
  if (!root) return "";
  for (const sp of childrenNamed(child(child(root, "cSld"), "spTree"), "sp")) {
    const ph = child(child(child(sp, "nvSpPr"), "nvPr"), "ph");
    if (!ph || ph.attrs.type !== "body") continue;
    const lines = childrenNamed(child(sp, "txBody"), "p").slice(0, MAX_PARAGRAPHS).map((p) =>
      elements(p).map((n) => (n.name === "br" ? "\n" : n.name === "r" || n.name === "fld" ? textOf(child(n, "t")) : "")).join(""),
    );
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }
  return "";
}

// ---- Layout kinds ------------------------------------------------------------------------------------------------

const norm = (name: string): string => name.toLowerCase().replace(/[_\-,]+/g, " ").replace(/\s+/g, " ").trim();

const TYPE_KINDS: Record<string, LayoutKind> = {
  title: "title", secHead: "sectionHeader", twoObj: "titleAndTwoColumns", twoColTx: "titleAndTwoColumns", titleOnly: "titleOnly", blank: "blank",
  obj: "titleAndBody", objTx: "captionLeft", picTx: "captionLeft",
};

function layoutKind(type: string | undefined, name: string, elements: Element[]): LayoutKind {
  const n = norm(name);
  if (n === "blank" || n.endsWith(" blank")) return "blank";
  if (n.includes("title only")) return "titleOnly";
  if (n.startsWith("section header") || n === "section") return "sectionHeader";
  if (n.includes("section title and description")) return "custom";
  if (/(two (columns?|content)|title and two)/.test(n)) return "titleAndTwoColumns";
  if (/^title (and|&) (body|content|text)$/.test(n) || n === "title content" || n === "content") return "titleAndBody";
  if (n === "one column text") return "oneColumnText";
  if (n.includes("caption")) return "captionLeft";
  if (n === "big number") return "bigNumber";
  if (n === "title slide" || n === "title" || n === "title page" || n === "cover") return "title";
  if (type && TYPE_KINDS[type]) return TYPE_KINDS[type]!;
  const holders = elements.filter((e): e is ShapeElement => e.type === "shape" && !!e.placeholder && !["dt", "ftr", "sldNum"].includes(e.placeholder.type));
  const titles = holders.filter((e) => e.placeholder!.type === "title");
  const bodies = holders.filter((e) => !["title", "ctrTitle", "subTitle"].includes(e.placeholder!.type));
  if (holders.some((e) => e.placeholder!.type === "ctrTitle")) return "title";
  if (holders.length === 0) return "blank";
  if (titles.length === 1 && bodies.length === 0 && holders.length === 1) return "titleOnly";
  if (titles.length === 1 && bodies.length === 1 && holders.length === 2) return "titleAndBody";
  if (titles.length === 1 && bodies.length === 2 && holders.length === 3) return "titleAndTwoColumns";
  return "custom";
}

const TYPE_NAMES: Record<string, string> = {
  title: "Title Slide", obj: "Title and Content", secHead: "Section Header", twoObj: "Two Content", titleOnly: "Title Only", blank: "Blank",
  tx: "Title and Text", objTx: "Content with Caption", picTx: "Picture with Caption",
};

// ---- Masters, layouts, slides --------------------------------------------------------------------------------------

interface MasterInfo {
  path: string;
  master: Master;
  theme: ThemeData;
  map: ClrMap;
  layouts: Map<string, { layout: Layout; map: ClrMap }>;
}

function readMasterParts(path: string, index: number, shared: Shared): MasterInfo | undefined {
  const root = shared.pkg.xml(path);
  if (!root) return undefined;
  const themeRel = shared.pkg.relOfType(path, "theme");
  const themeXml = themeRel && !themeRel.external ? shared.pkg.xml(themeRel.target) : undefined;
  if (!themeXml) shared.warn(`Master ${index + 1} has no readable theme; default colours and fonts are used`);
  const theme = parseTheme(themeXml, themeRel && !themeRel.external ? themeRel.target : undefined);
  const map = readClrMap(child(root, "clrMap"));
  const label = `Master ${index + 1}`;
  const ctx = makeCtx(shared, path, theme, map, label);
  const cSld = child(root, "cSld");
  const els = parseNodes(elements(child(cSld, "spTree")), ctx, "master", 0, { count: 0, warned: false });
  const tx = child(root, "txStyles");
  const master: Master = {
    id: newId("m_"),
    name: theme.theme.name,
    theme: theme.theme,
    elements: els,
    textStyles: { title: levelsOf(child(tx, "titleStyle"), ctx), body: levelsOf(child(tx, "bodyStyle"), ctx), other: levelsOf(child(tx, "otherStyle"), ctx) },
    layouts: [],
  };
  const background = readBackground(cSld, ctx);
  if (background !== undefined) master.background = background;
  return { path, master, theme, map, layouts: new Map() };
}

function readLayout(path: string, info: MasterInfo, shared: Shared, number: number): Layout | undefined {
  const root = shared.pkg.xml(path);
  if (!root) return undefined;
  const map = overrideMap(child(root, "clrMapOvr"), info.map);
  const ctx = makeCtx(shared, path, info.theme, map, `Layout ${number}`);
  const cSld = child(root, "cSld");
  const els = parseNodes(elements(child(cSld, "spTree")), ctx, "layout", 0, { count: 0, warned: false });
  const type = root.attrs.type;
  const name = (cSld?.attrs.name || (type && TYPE_NAMES[type]) || `Layout ${number}`).slice(0, 200);
  const layout: Layout = { id: newId("l_"), name, kind: layoutKind(type, name, els), elements: els };
  const background = readBackground(cSld, ctx);
  if (background !== undefined) layout.background = background;
  if (boolAttr(root, "showMasterSp") === false) layout.showMasterElements = false;
  info.layouts.set(path, { layout, map });
  return layout;
}

/** Gives a picture or table placeholder that has no frame of its own the frame of the layout's (the engine only does that for shapes). */
function inheritFrames(els: Element[], layout: Layout, master: Master): void {
  for (const e of els) {
    if (e.type === "shape" || e.type === "group" || !e.placeholder) continue;
    if (e.x === undefined) {
      const lp = matchPlaceholder(layout.elements, e.placeholder);
      const mp = matchPlaceholder(master.elements, e.placeholder);
      for (const k of ["x", "y", "w", "h"] as const) {
        const v = lp?.[k] ?? mp?.[k];
        if (v !== undefined) e[k] = v;
      }
    }
    // a picture keeps its link to the placeholder (it takes the layout's shape too); a table has no use for it
    if (e.type !== "image") delete e.placeholder;
  }
}

function readSlide(path: string, number: number, layoutOf: (p: string) => { layout: Layout; master: MasterInfo; map: ClrMap } | undefined, fallback: { layout: Layout; master: MasterInfo; map: ClrMap }, shared: Shared): Slide | undefined {
  const root = shared.pkg.xml(path);
  if (!root) return undefined;
  const label = `Slide ${number}`;
  const rel = shared.pkg.relOfType(path, "slideLayout");
  let found = rel && !rel.external ? layoutOf(rel.target) : undefined;
  if (!found) {
    shared.warn(`${label}: its layout couldn't be found; the first layout is used`);
    found = fallback;
  }
  const map = overrideMap(child(root, "clrMapOvr"), found.map);
  const ctx = makeCtx(shared, path, found.master.theme, map, label);
  const cSld = child(root, "cSld");
  const els = parseNodes(elements(child(cSld, "spTree")), ctx, "slide", 0, { count: 0, warned: false });
  inheritFrames(els, found.layout, found.master.master);
  const slide: Slide = { id: newId("s_"), layout: found.layout.id, elements: els, notes: readNotes(path, shared) };
  if (cSld?.attrs.name) slide.name = cSld.attrs.name.slice(0, 200);
  const bg = readBackground(cSld, ctx);
  if (bg !== undefined) slide.background = bg;
  const transition = readTransition(root);
  if (transition) slide.transition = transition;
  if (boolAttr(root, "show") === false) slide.skipped = true;
  if (boolAttr(root, "showMasterSp") === false) slide.showMasterElements = false;
  const timing = child(root, "timing");
  if (timing && elements(timing).length) {
    try {
      const animations = readSlideTiming(timing, els, shared.size ?? SIZE_WIDESCREEN, ctx.warn);
      if (animations.length) slide.animations = animations;
    } catch (cause) {
      ctx.warn(`its animations couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}) and were skipped`);
    }
  }
  return pruneAnimations(slide);
}

/** The animations of a slide's `p:timing`, pointed at the elements read from the shape tree. */
function readSlideTiming(timing: XmlElement, els: Element[], size: SlideSize, warn: (message: string) => void) {
  const targets = new Map<string, TimingTargetIn>();
  const nested = new Map<string, string | undefined>();
  const inside = (list: readonly Element[]) => {
    for (const e of list) {
      const spid = SHAPE_IDS.get(e);
      if (spid !== undefined && !nested.has(spid)) nested.set(spid, e.name);
      if (e.type === "group") inside(e.children);
    }
  };
  for (const e of els) {
    const spid = SHAPE_IDS.get(e);
    if (spid !== undefined && !targets.has(spid)) targets.set(spid, { id: e.id, name: e.name, paragraphs: e.type === "shape" && e.text ? Math.max(1, e.text.paragraphs.length) : 1 });
    if (e.type === "group") inside(e.children);
  }
  return readTiming(timing, { targets, nested, size, warn });
}

function readRelId(el: XmlElement): string | undefined {
  return prefixedAttr(el, "id");
}

/** Reads a presentation file (`.pptx`, `.potx`, `.ppsx`) into a deck. */
export function fromPptx(bytes: Uint8Array, options: PptxImportOptions = {}): PptxImport {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
    else if (warnings.length === MAX_WARNINGS) warnings.push("There were more warnings than are listed here");
  };
  const limit = options.maxUnpackedBytes ?? 250 * 1024 * 1024;
  const pkg = openPackage(bytes, limit, warn);
  const shared: Shared = { pkg, warn, media: new Map(), limit };

  // The presentation part: named by the root relationships, else the usual path.
  let presPath: string | undefined;
  const rootRel = [...pkg.rels("").values()].find((r) => r.type === "officeDocument" && !r.external);
  presPath = rootRel ? pkg.find(rootRel.target) : undefined;
  presPath ??= pkg.find("ppt/presentation.xml");
  if (!presPath) throw new PliError("invalid_document", "Not a PowerPoint presentation: it has no ppt/presentation.xml");
  const pres = pkg.xml(presPath);
  if (!pres || pres.name !== "presentation") throw new PliError("invalid_document", "Not a PowerPoint presentation: ppt/presentation.xml can't be read");

  // Slide size.
  const sldSz = child(pres, "sldSz");
  let size: SlideSize = SIZE_WIDESCREEN;
  const cx = emuAttr(sldSz, "cx");
  const cy = emuAttr(sldSz, "cy");
  if (cx !== undefined && cy !== undefined && cx >= 36 && cy >= 36 && cx <= 20_000 && cy <= 20_000) size = { width: round3(cx), height: round3(cy) };
  else warn("The slide size is missing or out of range; 16:9 widescreen is assumed");
  shared.size = size;

  // Masters.
  const presRels = pkg.rels(presPath);
  let masterPaths: string[] = [];
  for (const id of childrenNamed(child(pres, "sldMasterIdLst"), "sldMasterId")) {
    const rel = presRels.get(readRelId(id) ?? "");
    if (rel && !rel.external && pkg.find(rel.target)) masterPaths.push(pkg.find(rel.target)!);
  }
  if (masterPaths.length === 0) {
    masterPaths = [...presRels.values()].filter((r) => r.type === "slideMaster" && !r.external && pkg.find(r.target)).map((r) => pkg.find(r.target)!);
  }
  if (masterPaths.length === 0) masterPaths = [...pkg.files.keys()].filter((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(k)).sort(byNumber);
  const infos: MasterInfo[] = [];
  masterPaths.slice(0, 50).forEach((p, i) => {
    const info = readMasterParts(p, i, shared);
    if (info) infos.push(info);
  });

  // Layouts: those each master lists, then any that point at it but aren't listed.
  const allLayoutPaths = [...pkg.files.keys()].filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(k)).sort(byNumber);
  const claimed = new Set<string>();
  let layoutNumber = 0;
  infos.forEach((info) => {
    const root = pkg.xml(info.path);
    const rels = pkg.rels(info.path);
    const listed: string[] = [];
    for (const l of childrenNamed(child(root, "sldLayoutIdLst"), "sldLayoutId")) {
      const rel = rels.get(readRelId(l) ?? "");
      const p = rel && !rel.external ? pkg.find(rel.target) : undefined;
      if (p && !claimed.has(p)) listed.push(p);
    }
    for (const p of allLayoutPaths) {
      if (claimed.has(p) || listed.includes(p)) continue;
      const own = pkg.relOfType(p, "slideMaster");
      if (own && !own.external && pkg.find(own.target) === info.path) listed.push(p);
    }
    for (const p of listed) {
      claimed.add(p);
      const layout = readLayout(p, info, shared, ++layoutNumber);
      if (layout) info.master.layouts.push(layout);
    }
  });
  // Layouts nobody claims belong to the first master.
  for (const p of allLayoutPaths) {
    if (claimed.has(p) || infos.length === 0) continue;
    claimed.add(p);
    const layout = readLayout(p, infos[0]!, shared, ++layoutNumber);
    if (layout) infos[0]!.master.layouts.push(layout);
  }
  if (infos.length === 0) {
    warn("The file has no readable slide master; a default one is used");
    const master = buildMaster({ name: "Simple Light", theme: LIGHT_THEME, size });
    infos.push({ path: "", master, theme: parseTheme(undefined), map: DEFAULT_MAP, layouts: new Map() });
  }
  for (const info of infos) {
    if (info.master.layouts.length === 0) info.master.layouts.push({ id: newId("l_"), name: "Blank", kind: "blank", elements: [] });
  }

  const layoutByPath = (path: string) => {
    const p = pkg.find(path) ?? path;
    for (const info of infos) {
      const hit = info.layouts.get(p);
      if (hit) return { layout: hit.layout, master: info, map: hit.map };
    }
    return undefined;
  };
  const firstInfo = infos[0]!;
  const fallback = { layout: firstInfo.master.layouts[0]!, master: firstInfo, map: firstInfo.map };

  // Slides, in the order of the slide list.
  let slidePaths: string[] = [];
  for (const id of childrenNamed(child(pres, "sldIdLst"), "sldId")) {
    const rel = presRels.get(readRelId(id) ?? "");
    const p = rel && !rel.external ? pkg.find(rel.target) : undefined;
    if (p) slidePaths.push(p);
    else warn("A slide in the slide list is missing from the file");
  }
  if (!child(pres, "sldIdLst")) {
    slidePaths = [...pkg.files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k)).sort(byNumber);
    if (slidePaths.length) warn("The file has no slide list; the slides are read in file order");
  }
  const maxSlides = options.maxSlides ?? 2000;
  if (slidePaths.length > maxSlides) {
    warn(`The file has ${slidePaths.length} slides; only the first ${maxSlides} were read`);
    slidePaths = slidePaths.slice(0, maxSlides);
  }
  const slides: Slide[] = [];
  const readSlides: ReadSlide[] = [];
  slidePaths.forEach((p, i) => {
    try {
      const slide = readSlide(p, i + 1, layoutByPath, fallback, shared);
      if (slide) {
        slides.push(slide);
        readSlides.push({ id: slide.id, path: p, elementOf: (spid) => elementWithShapeId(slide.elements, String(spid)) });
      }
    } catch (cause) {
      warn(`Slide ${i + 1} couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}) and was skipped`);
    }
  });

  // The default text style applies to text that is not in a placeholder.
  const defaults = child(pres, "defaultTextStyle");
  const defCtx = makeCtx(shared, presPath, firstInfo.theme, firstInfo.map, "");
  const defaultTextStyle = defaults ? levelsOf(defaults, defCtx) : undefined;

  const core = pkg.xml("docProps/core.xml");
  const coreTitle = textOf(child(core, "title")).trim();
  const deck: Deck = {
    type: "deck",
    id: newId("d_"),
    title: (options.title ?? (coreTitle || firstTitle(slides) || "Untitled presentation")).slice(0, 300),
    size,
    masters: infos.map((i) => i.master),
    slides,
  };
  if (defaultTextStyle && !isEmptyObject(defaultTextStyle)) deck.defaultTextStyle = defaultTextStyle;
  const commentAuthors: Record<string, { name: string; initials?: string }> = {};
  try {
    const threads = readComments(
      pkg,
      presPath,
      readSlides,
      (a, known) => {
        // A file that Pli wrote names the user itself, and that is who it is.
        const id = known ?? (options.commentAuthor ? options.commentAuthor(a) : `pptx:${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown"}`);
        commentAuthors[id] = { name: a.name, ...(a.initials ? { initials: a.initials } : {}) };
        return id;
      },
      warn,
    );
    if (Object.keys(threads).length > 0) {
      deck.comments = threads;
      markCommentedText(deck);
    }
  } catch (cause) {
    warn(`Comments couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}) and were skipped`);
  }
  return { deck, warnings, ...(Object.keys(commentAuthors).length > 0 ? { commentAuthors } : {}) };
}

/** The element of a slide that was written with this shape id. */
function elementWithShapeId(list: readonly Element[], spid: string): string | undefined {
  for (const e of list) {
    if (SHAPE_IDS.get(e) === spid) return e.id;
    if (e.type === "group") {
      const inner = elementWithShapeId(e.children, spid);
      if (inner) return inner;
    }
  }
  return undefined;
}

function firstTitle(slides: Slide[]): string {
  const first = slides[0];
  const title = first?.elements.find((e): e is ShapeElement => e.type === "shape" && (e.placeholder?.type === "title" || e.placeholder?.type === "ctrTitle"));
  const text = title?.text?.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim();
  return text ?? "";
}

const byNumber = (a: string, b: string): number => Number(/(\d+)\.xml$/i.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/i.exec(b)?.[1] ?? 0);
