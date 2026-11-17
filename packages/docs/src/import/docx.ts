import { strFromU8, unzipSync } from "fflate";
import { attr, child, childrenNamed, createId, elements, parseXml, PliError, textOf, type PliUser, type Thread, type XmlElement } from "@pli.dev/core";
import type {
  Align,
  Block,
  CellBlock,
  Columns,
  Doc,
  DocAnchor,
  DocStyle,
  ImageBlock,
  ListMarker,
  Marks,
  PageSetup,
  PageSize,
  ParagraphFormat,
  RegionName,
  Run,
  SectionBreakBlock,
  StyleMarks,
  Suggestion,
  TableBlock,
  TableCell,
  TableRow,
  TextBlock,
} from "../model";
import { commentRanges } from "../comments";
import { defaultMarker } from "../lists";
import { cleanNoteBlocks, FOOTNOTE_CHAR } from "../footnotes";
import { checkGrid, normalizeColumns } from "../grid";
import { PAGE_SIZES } from "../page";
import { regionName } from "../regions";
import { normalizeRuns, plainText } from "../runs";
import { validateDoc } from "../serialize";
import { STYLE_MARK_KEYS } from "../styles";
import { suggestionsIn } from "../suggestions";

// ---- Options and result ----------------------------------------------------------------------------------------

export interface DocxImportOptions extends DocxImportOptionsTracked {
  /** The most the file may unpack to, in bytes. Default 250 MB: a guard against files made to fill memory. */
  maxUnpackedBytes?: number;
  /** The title when the file has none. Default "Untitled". */
  title?: string;
  /**
   * The user id to give a comment's author, from the name the file has. Default: the name made into an id, such as
   * `ana-reyes`. Map names to your own users here.
   */
  userId?: (authorName: string) => string;
}

export interface DocxImportOptionsTracked {
  /**
   * What to do with tracked changes (insertions and deletions made with Word's review tools). `"keep"` (the default) makes
   * each one a [suggestion](/documents/features/suggestions/) to accept or reject; `"accept"` reads the text as it would
   * be with every change accepted.
   */
  trackedChanges?: "keep" | "accept";
}

export interface DocxImportResult {
  doc: Doc;
  /** The people who wrote the file's comments, by the ids used in the document. Give them to your `Users`. */
  authors: PliUser[];
  /** What was left out or changed, in words a person can read. */
  warnings: string[];
}

// ---- The file --------------------------------------------------------------------------------------------------

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

type Rels = Map<string, Relationship>;

class Package {
  readonly files: Record<string, Uint8Array>;
  constructor(bytes: Uint8Array, limit: number) {
    let total = 0;
    try {
      this.files = unzipSync(bytes, {
        filter(file) {
          total += file.originalSize;
          if (total > limit) throw new PliError("invalid_document", "The file is too large when unpacked");
          return true;
        },
      });
    } catch (cause) {
      if (cause instanceof PliError) throw cause;
      throw new PliError("invalid_document", "Not a .docx file: it couldn't be opened as a zip archive", { cause });
    }
  }

  has(path: string): boolean {
    return path in this.files;
  }

  text(path: string): string | undefined {
    const bytes = this.files[path];
    return bytes ? strFromU8(bytes) : undefined;
  }

  xml(path: string): XmlElement | undefined {
    const source = this.text(path);
    return source === undefined ? undefined : parseXml(source);
  }

  /** The relationships of a part, read from `_rels` beside it. */
  rels(part: string): Rels {
    const slash = part.lastIndexOf("/");
    return this.relsFile(`${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`);
  }

  relsFile(path: string): Rels {
    const root = this.xml(path);
    const out: Rels = new Map();
    for (const rel of childrenNamed(root, "Relationship")) {
      const id = rel.attrs["Id"];
      if (id) out.set(id, { type: rel.attrs["Type"] ?? "", target: rel.attrs["Target"] ?? "", external: rel.attrs["TargetMode"] === "External" });
    }
    return out;
  }
}

/** The path of a part a relationship points at, from the part that holds the relationship. */
function resolveTarget(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

// ---- Small readers ---------------------------------------------------------------------------------------------

const TWIPS_PER_PT = 20;
const EMU_PER_PX = 9525;

/** A toggle property such as bold: present and not switched off. */
function isOn(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const value = attr(el, "val");
  return value === undefined || !["0", "false", "off", "none"].includes(value.toLowerCase());
}

const num = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function hexColor(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === "auto") return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? `#${m[1]!.toLowerCase()}` : undefined;
}

const HIGHLIGHTS: Record<string, string> = {
  black: "#000000", blue: "#0000ff", cyan: "#00ffff", darkBlue: "#000080", darkCyan: "#008080", darkGray: "#808080",
  darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", green: "#00ff00",
  lightGray: "#c0c0c0", magenta: "#ff00ff", red: "#ff0000", white: "#ffffff", yellow: "#ffff00",
};

const slug = (text: string): string => text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encodes bytes as base64 without `btoa`, which JavaScriptCore and QuickJS may not provide. */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : BASE64[c & 63]!;
  }
  return out;
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

// ---- Styles and numbering --------------------------------------------------------------------------------------

interface WordStyle {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  pPr?: XmlElement;
  rPr?: XmlElement;
  /** The style Word pairs this one with (a heading and its "Heading 1 Char"), which is not a style of its own. */
  linked?: string;
  /** Marked `w:customStyle`: made by the author of the file, not Word. */
  custom: boolean;
  isDefault: boolean;
}

/** Names Word gives its own styles that Pli draws some other way, or has no use for. These are never imported as a named style. */
const BUILT_IN = new Set([
  "normal", "title", "subtitle", "quote", "intense quote", "list paragraph", "header", "footer", "toc heading", "footnote text",
  "footnote reference", "endnote text", "endnote reference", "annotation text", "annotation reference", "annotation subject",
  "hyperlink", "followedhyperlink", "default paragraph font", "balloon text", "page number", "line number", "code block", "source code",
  "table of figures", "macro text",
]);

function isBuiltInName(name: string): boolean {
  const lower = name.toLowerCase();
  return BUILT_IN.has(lower) || /^heading [1-9]$/.test(lower) || /^toc [1-9]$/.test(lower);
}

type Kind = { type: "paragraph" } | { type: "title" } | { type: "subtitle" } | { type: "quote" } | { type: "code" } | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 };

function kindOfName(name: string, id: string): Kind | null {
  const lower = name.toLowerCase();
  const heading = /^heading ([1-6])$/.exec(lower) ?? /^heading([1-6])$/i.exec(id);
  if (heading) return { type: "heading", level: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6 };
  if (lower === "title") return { type: "title" };
  if (lower === "subtitle") return { type: "subtitle" };
  if (lower === "quote" || lower === "intense quote") return { type: "quote" };
  if (lower === "code block" || lower === "source code") return { type: "code" };
  return null;
}

interface NumberingLevel {
  format: string;
  /** What the marker is written with, such as "•" or "%1.". */
  text: string;
  /** The number the first item of this level has. */
  start: number;
}

interface Numbering {
  /**
   * The levels of each numbering definition, by `numId`. Lists made from the same definition count on from each other, so
   * `abstractId` says which count a list belongs to, and `overrides` the numbers its levels restart at when first used.
   */
  nums: Map<string, { levels: Map<number, NumberingLevel>; abstractId: string; overrides: Map<number, number> }>;
}

function readNumbering(root: XmlElement | undefined): Numbering {
  const abstract = new Map<string, Map<number, NumberingLevel>>();
  for (const a of childrenNamed(root, "abstractNum")) {
    const levels = new Map<number, NumberingLevel>();
    for (const lvl of childrenNamed(a, "lvl")) {
      levels.set(num(attr(lvl, "ilvl")) ?? 0, {
        format: attr(child(lvl, "numFmt"), "val") ?? "decimal",
        text: attr(child(lvl, "lvlText"), "val") ?? "",
        start: Math.max(0, Math.round(num(attr(child(lvl, "start"), "val")) ?? 1)),
      });
    }
    abstract.set(attr(a, "abstractNumId") ?? "", levels);
  }
  const nums: Numbering["nums"] = new Map();
  for (const n of childrenNamed(root, "num")) {
    const abstractId = attr(child(n, "abstractNumId"), "val") ?? "";
    const levels = abstract.get(abstractId);
    if (!levels) continue;
    const overrides = new Map<number, number>();
    for (const o of childrenNamed(n, "lvlOverride")) {
      const start = num(attr(child(o, "startOverride"), "val"));
      if (start !== undefined) overrides.set(num(attr(o, "ilvl")) ?? 0, Math.max(0, Math.round(start)));
    }
    nums.set(attr(n, "numId") ?? "", { levels, abstractId, overrides });
  }
  return { nums };
}

const NUMBER_MARKER_OF: Record<string, ListMarker> = {
  decimal: "decimal",
  decimalZero: "decimal",
  lowerLetter: "lower-alpha",
  upperLetter: "upper-alpha",
  lowerRoman: "lower-roman",
  upperRoman: "upper-roman",
};

/** The marker a Word level draws. Bullet characters become the three bullets there are; anything unknown is left to the default. */
function markerOfLevel(level: NumberingLevel | undefined): { list: "bullet" | "ordered"; marker?: ListMarker } {
  if (!level) return { list: "ordered" };
  if (level.format === "bullet" || level.format === "none") {
    const text = level.text.trim();
    // "o" is Word's own circle; the square is a private-use Wingdings character or a black square.
    const marker: ListMarker | undefined = text === "o" || text === "◦" || text === "○" ? "circle" : /^[\uf0a7\u25aa\u25a0\u25fc]$/.test(text) ? "square" : text === "" ? undefined : "disc";
    return { list: "bullet", ...(marker && { marker }) };
  }
  const marker = NUMBER_MARKER_OF[level.format];
  return { list: "ordered", ...(marker && { marker }) };
}

// ---- Sections --------------------------------------------------------------------------------------------------

interface SectInfo {
  width: number;
  height: number;
  landscape: boolean;
  margins: PageSetup["margins"];
  columns?: Columns;
  continuous: boolean;
  titlePg: boolean;
  refs: { kind: "header" | "footer"; variant: "default" | "first" | "even"; rid: string }[];
}

type Item = Block | { section: SectInfo };

const isSection = (item: Item): item is { section: SectInfo } => "section" in item;

function readSectPr(el: XmlElement): SectInfo {
  const size = child(el, "pgSz");
  const mar = child(el, "pgMar");
  const cols = child(el, "cols");
  const twips = (value: string | undefined, fallback: number) => num(value) ?? fallback;
  const inches = (value: string | undefined, fallback: number) => clamp(Math.round((twips(value, fallback * 1440) / 1440) * 100) / 100, 0, 5);
  const w = twips(attr(size, "w"), 12240) / 1440;
  const h = twips(attr(size, "h"), 15840) / 1440;
  const count = num(attr(cols, "num")) ?? 1;
  const columns: Columns | undefined = count > 1 ? { count: clamp(Math.round(count), 1, 4), gap: clamp((num(attr(cols, "space")) ?? 720) / TWIPS_PER_PT, 0, 200), ...(isOn(cols) && attr(cols, "sep") && attr(cols, "sep") !== "0" ? { rule: true } : {}) } : undefined;
  return {
    width: w,
    height: h,
    landscape: attr(size, "orient") === "landscape" || w > h,
    margins: { top: inches(attr(mar, "top"), 1), right: inches(attr(mar, "right"), 1), bottom: inches(attr(mar, "bottom"), 1), left: inches(attr(mar, "left"), 1) },
    ...(columns && { columns }),
    continuous: attr(child(el, "type"), "val") === "continuous",
    titlePg: isOn(child(el, "titlePg")),
    refs: elements(el)
      .filter((c) => c.name === "headerReference" || c.name === "footerReference")
      .map((c) => ({ kind: c.name === "headerReference" ? ("header" as const) : ("footer" as const), variant: attr(c, "type") === "first" ? ("first" as const) : attr(c, "type") === "even" ? ("even" as const) : ("default" as const), rid: attr(c, "id", "r") ?? "" })),
  };
}

function sizeOf(info: SectInfo, warn: (message: string) => void): PageSize {
  const [short, long] = [Math.min(info.width, info.height), Math.max(info.width, info.height)];
  let best: PageSize = "letter";
  let distance = Infinity;
  for (const [name, dims] of Object.entries(PAGE_SIZES) as [PageSize, { width: number; height: number }][]) {
    const d = Math.abs(dims.width - short) + Math.abs(dims.height - long);
    if (d < distance) {
      distance = d;
      best = name;
    }
  }
  if (distance > 0.15) warn(`A page size of ${short.toFixed(2)} × ${long.toFixed(2)} inches isn't supported, so the nearest standard size was used`);
  return best;
}

// ---- Converting a part -----------------------------------------------------------------------------------------

interface Shared {
  pkg: Package;
  warnings: Set<string>;
  styles: Map<string, WordStyle>;
  numbering: Numbering;
  /** The last number given at each level of each list that counts on, as Word numbers them. */
  counters: Map<string, number[]>;
  /** The levels of each list (`numId:level`) that have had an item, to tell the first one, where a restart happens. */
  usedLevels: Set<string>;
  /** The number Word gives each numbered item, by block id. */
  wordNumbers: Map<string, number>;
  /** The word styles that something uses, and so must be imported. */
  used: Set<string>;
  /** Our thread for each of the file's comment ids, and the comments that have text to mark. */
  threadOf: Map<string, string>;
  footnotes: Map<string, string>;
  /** Footnotes that were referenced. */
  referencedNotes: Set<string>;
  /** The theme's Latin heading and body fonts, which runs refer to as `majorHAnsi` and `minorHAnsi`. */
  themeFonts?: { major?: string; minor?: string };
  /** Whether tracked changes are accepted as the file is read, rather than kept as suggestions. */
  acceptChanges: boolean;
  /** The user id for an author's name, remembering who has been seen. */
  authorOf: (name: string) => string;
}

type Mode = "body" | "cell" | "note" | "region";

interface Field {
  phase: "instr" | "result";
  instr: string;
  kind: "plain" | "page" | "pages" | "link" | "toc";
  link?: string;
}

type Piece =
  | { kind: "run"; run: Run }
  | { kind: "image"; block: ImageBlock }
  | { kind: "page_break" }
  | { kind: "toc"; levels: number };

interface ParagraphInfo {
  kind: Kind;
  /** The id of our style for the paragraph, when its Word style is one of the author's own. */
  style?: string;
  wordStyle?: string;
  align?: Align;
  format?: ParagraphFormat;
  list?: { list: "bullet" | "ordered"; depth: number; marker?: ListMarker; numId: string };
  pageBreakBefore: boolean;
  divider: boolean;
}

class Converter {
  /** Fields can run across paragraphs (a table of contents does), so their state lives here. */
  fields: Field[] = [];
  /** The Word ids of comment ranges now open. */
  open = new Set<string>();
  skipSpace = false;
  /** The tracked change being read, so its text is marked. */
  change: Suggestion | null = null;
  private changeCount = 0;

  constructor(
    readonly shared: Shared,
    /** The part being read, such as `word/document.xml`, for finding what its relationships point at. */
    readonly part: string,
    readonly rels: Rels,
    readonly mode: Mode,
  ) {}

  warn(message: string): void {
    this.shared.warnings.add(message);
  }

  /**
   * The Latin font a `w:rFonts` names, as written in the file. A theme reference (`w:asciiTheme="minorHAnsi"`) wins over
   * the name beside it, as it does in Word, and is looked up in the theme; one that can't be resolved falls back to the
   * name. A run that only names an East Asian or complex-script font has no Latin font of its own, so it gets none.
   */
  latinFont(el: XmlElement): string | undefined {
    const themed = (value: string | undefined): string | undefined => {
      const key = value && /^(major|minor)/.test(value) ? (value.startsWith("major") ? "major" : "minor") : undefined;
      const face = key && /^(major|minor)(Ascii|HAnsi)$/.test(value!) ? this.shared.themeFonts?.[key] : undefined;
      return face || undefined;
    };
    const font = themed(attr(el, "asciiTheme")) ?? attr(el, "ascii") ?? themed(attr(el, "hAnsiTheme")) ?? attr(el, "hAnsi");
    return font?.trim() || undefined;
  }

  // ---- Blocks ----

  blocks(nodes: readonly XmlElement[]): Item[] {
    const out: Item[] = [];
    for (const node of nodes) {
      switch (node.name) {
        case "p":
          this.paragraph(node, out);
          break;
        case "tbl":
          if (this.mode === "cell" || this.mode === "note") this.flattenTable(node, out);
          else out.push(this.table(node));
          break;
        case "sdt":
          out.push(...this.blocks(elements(child(node, "sdtContent"))));
          break;
        case "ins":
        case "moveTo":
        case "customXml":
          out.push(...this.blocks(elements(node)));
          break;
        default:
          break;
      }
    }
    return this.tidy(out);
  }

  /** Drops the empty paragraph Word needs between tables and after the last one: it isn't content. */
  private tidy(items: Item[]): Item[] {
    const out: Item[] = [];
    items.forEach((item, i) => {
      // A table of contents wrapped in a content control (as LibreOffice and Word write them) comes after its own heading paragraph.
      const before = out[out.length - 1];
      if (!isSection(item) && item.type === "toc" && item.title === "" && before && !isSection(before) && before.type === "paragraph" && this.tocHeadings.has(before.id)) {
        out.pop();
        out.push({ ...item, title: plainText(before.runs) });
        return;
      }
      if (!isSection(item) && item.type === "paragraph" && item.runs.length === 0 && !item.style && !item.align && !item.format) {
        const before = out[out.length - 1];
        const after = items[i + 1];
        const afterTable = before && !isSection(before) && before.type === "table";
        if (afterTable && (after === undefined || (!isSection(after) && after.type === "table"))) return;
      }
      out.push(item);
    });
    return out;
  }

  private flattenTable(node: XmlElement, out: Item[]): void {
    this.warn("A table inside a table, or inside a note, was turned into plain paragraphs");
    for (const row of childrenNamed(node, "tr")) {
      for (const cell of childrenNamed(row, "tc")) out.push(...this.blocks(elements(cell)).filter((i) => !isSection(i)));
    }
  }

  // ---- Paragraphs ----

  private info(pPr: XmlElement | undefined): ParagraphInfo {
    const styleId = attr(child(pPr, "pStyle"), "val");
    let kind: Kind = { type: "paragraph" };
    let style: string | undefined;
    let numPr = child(pPr, "numPr");
    const seen = new Set<string>();
    for (let id = styleId; id !== undefined && !seen.has(id); ) {
      seen.add(id);
      const word = this.shared.styles.get(id);
      if (!word) break;
      const found = kindOfName(word.name, word.id);
      if (found && kind.type === "paragraph") kind = found;
      numPr ??= child(word.pPr, "numPr");
      id = word.basedOn;
    }
    const own = styleId ? this.shared.styles.get(styleId) : undefined;
    if (own && own.type === "paragraph" && !isBuiltInName(own.name)) {
      this.shared.used.add(own.id);
      style = own.id;
    }

    let list: ParagraphInfo["list"];
    const numId = attr(child(numPr, "numId"), "val");
    if (numId && numId !== "0" && (kind.type === "paragraph" || kind.type === "quote")) {
      const ilvl = clamp(Math.round(num(attr(child(numPr, "ilvl"), "val")) ?? 0), 0, 8);
      const level = this.shared.numbering.nums.get(numId)?.levels.get(ilvl);
      const shown = markerOfLevel(level);
      list = { list: shown.list, depth: ilvl, numId, ...(shown.marker && { marker: shown.marker }) };
    }

    const jc = attr(child(pPr, "jc"), "val");
    const align: Align | undefined = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" || jc === "justify" ? "justify" : undefined;
    const format = this.formatOf(pPr);
    const border = child(child(pPr, "pBdr"), "bottom");
    return {
      kind,
      ...(style && { style }),
      ...(styleId && { wordStyle: styleId }),
      ...(align && { align }),
      ...(format && { format }),
      ...(list && { list }),
      pageBreakBefore: isOn(child(pPr, "pageBreakBefore")),
      divider: !!border && !["nil", "none"].includes(attr(border, "val") ?? "single"),
    };
  }

  formatOf(pPr: XmlElement | undefined): ParagraphFormat | undefined {
    const format: ParagraphFormat = {};
    const spacing = child(pPr, "spacing");
    const before = num(attr(spacing, "before"));
    const after = num(attr(spacing, "after"));
    const line = num(attr(spacing, "line"));
    if (before !== undefined) format.spaceBefore = clamp(before / TWIPS_PER_PT, 0, 1000);
    if (after !== undefined) format.spaceAfter = clamp(after / TWIPS_PER_PT, 0, 1000);
    if (line !== undefined && (attr(spacing, "lineRule") ?? "auto") === "auto") format.lineHeight = clamp(Math.round((line / 240) * 100) / 100, 0.5, 10);
    const ind = child(pPr, "ind");
    const left = num(attr(ind, "left") ?? attr(ind, "start"));
    const right = num(attr(ind, "right") ?? attr(ind, "end"));
    const first = num(attr(ind, "firstLine"));
    const hanging = num(attr(ind, "hanging"));
    if (left) format.indentLeft = clamp(left / TWIPS_PER_PT, 0, 1000);
    if (right) format.indentRight = clamp(right / TWIPS_PER_PT, 0, 1000);
    if (hanging) format.indentFirst = clamp(-hanging / TWIPS_PER_PT, -1000, 1000);
    else if (first) format.indentFirst = clamp(first / TWIPS_PER_PT, -1000, 1000);
    return Object.keys(format).length > 0 ? format : undefined;
  }

  private paragraph(p: XmlElement, out: Item[]): void {
    const pPr = child(p, "pPr");
    const info = this.info(pPr);
    const sectPr = child(pPr, "sectPr");
    const insideToc = this.fields.some((f) => f.kind === "toc");
    const pieces: Piece[] = [];
    this.inline(p, pieces, undefined);
    const stillInToc = this.fields.some((f) => f.kind === "toc");

    if (info.pageBreakBefore && this.mode === "body") out.push({ id: createId("b_"), type: "page_break" });

    let runs: Run[] = [];
    let emitted = false;
    const flush = (force = false) => {
      const clean = normalizeRuns(runs);
      runs = [];
      if (clean.length === 0 && !force) return;
      out.push(this.textBlock(info, clean));
      emitted = true;
    };
    for (const piece of pieces) {
      if (piece.kind === "run") runs.push(piece.run);
      else if (piece.kind === "image") {
        flush();
        out.push({ ...piece.block, ...(info.align && { align: info.align }) });
        emitted = true;
      } else if (piece.kind === "page_break") {
        flush();
        if (this.mode === "body") out.push({ id: createId("b_"), type: "page_break" });
        emitted = true;
      } else {
        flush();
        this.pushToc(piece.levels, out);
        emitted = true;
      }
    }
    if (runs.length > 0 || (!emitted && !insideToc && !stillInToc && !sectPr)) {
      if (!emitted && runs.length === 0 && info.divider && this.mode !== "note") {
        out.push({ id: createId("b_"), type: "divider" } as Block);
      } else {
        flush(true);
      }
    }
    if (sectPr && this.mode === "body") out.push({ section: readSectPr(sectPr) });
  }

  /** Puts a table of contents where the field began. A heading paragraph right before it becomes its title. */
  private pushToc(levels: number, out: Item[]): void {
    const last = out[out.length - 1];
    let title: string | undefined;
    if (last && !isSection(last) && last.type === "paragraph" && this.tocHeadings.has(last.id)) {
      title = plainText(last.runs);
      out.pop();
    }
    out.push({ id: createId("b_"), type: "toc", levels: clamp(levels, 1, 6) as 1 | 2 | 3 | 4 | 5 | 6, title: title ?? "" });
  }
  /** Paragraphs made from a "TOC Heading" style, which belong to the table of contents after them. */
  tocHeadings = new Set<string>();

  /** A list item, with the marker its level draws, and the number Word gives it noted for `withListStarts`. */
  private listItem(id: string, list: NonNullable<ParagraphInfo["list"]>, runs: Run[], formatted: object): Block {
    const { nums } = this.shared.numbering;
    const entry = nums.get(list.numId);
    if (list.list === "ordered" && entry) {
      const counters = this.shared.counters.get(entry.abstractId) ?? [];
      // A list that restarts a level does so where its first item at that level is.
      const restart = entry.overrides.get(list.depth);
      const first = !this.shared.usedLevels.has(`${list.numId}:${list.depth}`);
      this.shared.usedLevels.add(`${list.numId}:${list.depth}`);
      const n = restart !== undefined && first ? restart : counters[list.depth] === undefined ? entry.levels.get(list.depth)?.start ?? 1 : counters[list.depth]! + 1;
      counters.length = list.depth + 1;
      counters[list.depth] = n;
      this.shared.counters.set(entry.abstractId, counters);
      this.shared.wordNumbers.set(id, n);
    }
    const marker = list.marker && list.marker !== defaultMarker(list.list, list.depth) ? list.marker : undefined;
    return { id, type: "list_item", list: list.list, depth: list.depth, ...(marker && { marker }), runs, ...formatted } as Block;
  }

  private textBlock(info: ParagraphInfo, runs: Run[]): Block {
    const id = createId("b_");
    const formatted = { ...(info.align && { align: info.align }), ...(info.format && { format: info.format }), ...(info.style && { style: info.style }) };
    const word = info.wordStyle ? this.shared.styles.get(info.wordStyle) : undefined;
    let kind = info.kind;
    // Notes keep it simple, and a heading can't be a list item.
    if (this.mode === "note" && (kind.type === "heading" || kind.type === "title" || kind.type === "subtitle")) kind = { type: "paragraph" };
    if (kind.type === "code") return { id, type: "code_block", runs: runs.length > 0 ? [{ text: runs.map((r) => r.text).join("") }] : [] };
    if (info.list && (kind.type === "paragraph" || kind.type === "quote")) return this.listItem(id, info.list, runs, formatted);
    if (kind.type === "heading") return { id, type: "heading", level: kind.level, runs, ...formatted };
    if (kind.type === "title" || kind.type === "subtitle" || kind.type === "quote") return { id, type: kind.type, runs, ...formatted };
    const block: Block = { id, type: "paragraph", runs, ...formatted };
    if (word && /^toc ?heading$/i.test(word.name)) this.tocHeadings.add(id);
    return block;
  }

  // ---- Inline content ----

  private inline(node: XmlElement, out: Piece[], link: string | undefined): void {
    for (const el of elements(node)) {
      switch (el.name) {
        case "r":
          this.run(el, out, link);
          break;
        case "hyperlink": {
          const rid = attr(el, "id", "r");
          const rel = rid ? this.rels.get(rid) : undefined;
          const anchor = attr(el, "anchor");
          this.inline(el, out, rel?.target ?? (anchor ? `#${anchor}` : link));
          break;
        }
        case "fldSimple": {
          const field = this.classify(attr(el, "instr") ?? "");
          this.fields.push({ phase: "result", instr: attr(el, "instr") ?? "", ...field });
          this.inline(el, out, link);
          this.fields.pop();
          if (field.kind === "toc") out.push({ kind: "toc", levels: this.tocLevels(attr(el, "instr") ?? "") });
          break;
        }
        case "ins":
        case "moveTo":
          this.tracked(el, "insert", out, link);
          break;
        case "del":
        case "moveFrom":
          this.tracked(el, "delete", out, link);
          break;
        case "smartTag":
        case "sdtContent":
        case "customXml":
        case "dir":
        case "bdo":
          this.inline(el, out, link);
          break;
        case "sdt":
          this.inline(child(el, "sdtContent") ?? el, out, link);
          break;
        case "commentRangeStart": {
          const id = attr(el, "id");
          if (id !== undefined) this.open.add(id);
          break;
        }
        case "commentRangeEnd": {
          const id = attr(el, "id");
          if (id !== undefined) this.open.delete(id);
          break;
        }
        case "pict":
        case "object":
          this.warn("A drawing or embedded object that isn't a picture was left out");
          break;
        default:
          break;
      }
    }
  }

  /** An insertion or deletion made with the review tools: kept as a suggestion, or accepted as the file is read. */
  private tracked(el: XmlElement, kind: Suggestion["kind"], out: Piece[], link: string | undefined): void {
    if (this.shared.acceptChanges) {
      if (kind === "insert") this.inline(el, out, link);
      return;
    }
    const saved = this.change;
    const at = Date.parse(attr(el, "date") ?? "");
    this.change = { id: `sg_${attr(el, "id") ?? `n${this.changeCount++}`}_${kind}`, kind, by: this.shared.authorOf(attr(el, "author") ?? ""), at: Number.isFinite(at) && at >= 0 ? at : 0 };
    this.inline(el, out, link);
    this.change = saved;
  }

  private classify(instr: string): { kind: Field["kind"]; link?: string } {
    const word = /^\s*([A-Za-z]+)/.exec(instr)?.[1]?.toUpperCase();
    if (word === "PAGE") return { kind: "page" };
    if (word === "NUMPAGES") return { kind: "pages" };
    if (word === "TOC") return { kind: "toc" };
    if (word === "HYPERLINK") {
      const url = /"([^"]*)"/.exec(instr)?.[1];
      const anchor = /\\l\s+"([^"]*)"/.exec(instr)?.[1];
      const target = anchor && !url ? `#${anchor}` : url;
      return target ? { kind: "link", link: target } : { kind: "plain" };
    }
    return { kind: "plain" };
  }

  private tocLevels(instr: string): number {
    const range = /\\o\s+"(\d)-(\d)"/.exec(instr);
    return range ? Number(range[2]) : 3;
  }

  private run(r: XmlElement, out: Piece[], inheritedLink: string | undefined): void {
    const rPr = child(r, "rPr");
    const link = inheritedLink;
    const skipping = () => this.fields.some((f) => f.phase === "instr" || f.kind === "toc");
    const marks = (): Marks => {
      const m = this.marksOf(rPr);
      const style = this.charStyleOf(rPr);
      if (style) m.style = style;
      const active = [...this.fields].reverse().find((f) => f.phase === "result" && (f.kind === "link" || f.kind === "page" || f.kind === "pages"));
      const url = link ?? (active?.kind === "link" ? active.link : undefined);
      if (url) m.link = url;
      if (active && (active.kind === "page" || active.kind === "pages")) m.field = active.kind;
      if (this.change) m.suggest = this.change;
      const ids = [...this.open].flatMap((id) => this.shared.threadOf.get(id) ?? []);
      if (ids.length > 0) m.comment = [...new Set(ids)].sort();
      // A link is drawn underlined by its style; the underline isn't also the text's own.
      if (m.link && attr(child(rPr, "rStyle"), "val") === "Hyperlink") delete m.underline;
      return m;
    };
    let text = "";
    const flush = () => {
      if (text === "") return;
      const run: Run = { text };
      const m = marks();
      if (Object.keys(m).length > 0) run.marks = m;
      out.push({ kind: "run", run });
      text = "";
    };

    for (const el of elements(r)) {
      switch (el.name) {
        case "fldChar": {
          const type = attr(el, "fldCharType");
          if (type === "begin") {
            flush();
            this.fields.push({ phase: "instr", instr: "", kind: "plain" });
          } else if (type === "separate") {
            flush();
            const top = this.fields[this.fields.length - 1];
            if (top) {
              top.phase = "result";
              Object.assign(top, this.classify(top.instr));
              if (top.kind === "toc") out.push({ kind: "toc", levels: this.tocLevels(top.instr) });
            }
          } else if (type === "end") {
            flush();
            this.fields.pop();
          }
          break;
        }
        case "instrText": {
          const top = this.fields[this.fields.length - 1];
          if (top && top.phase === "instr") top.instr += textOf(el);
          break;
        }
        case "delText":
        case "t":
          if (el.name === "delText" && this.change?.kind !== "delete") break;
          if (!skipping()) {
            let value = textOf(el);
            if (this.skipSpace) {
              if (value.startsWith(" ")) value = value.slice(1);
              if (value !== "") this.skipSpace = false;
            }
            text += value;
          }
          break;
        case "tab":
          if (!skipping()) text += "\t";
          break;
        case "br": {
          if (skipping()) break;
          const kind = attr(el, "type");
          if (kind === "page") {
            flush();
            out.push({ kind: "page_break" });
          } else text += "\n";
          break;
        }
        case "cr":
          if (!skipping()) text += "\n";
          break;
        case "noBreakHyphen":
          if (!skipping()) text += "-";
          break;
        case "footnoteRef":
          this.skipSpace = true;
          break;
        case "footnoteReference": {
          if (skipping()) break;
          flush();
          const word = attr(el, "id") ?? "";
          const id = this.shared.footnotes.get(word);
          if (id && this.mode === "body") {
            this.shared.referencedNotes.add(word);
            out.push({ kind: "run", run: { text: FOOTNOTE_CHAR, marks: { footnote: id } } });
          } else if (this.mode !== "body") this.warn("A footnote reference inside a table, header or note was left out");
          break;
        }
        case "pict":
        case "object":
          if (!skipping()) this.warn("A drawing or embedded object that isn't a picture was left out");
          break;
        case "drawing": {
          if (skipping()) break;
          flush();
          const image = this.image(el);
          if (image) out.push({ kind: "image", block: image });
          break;
        }
        default:
          break;
      }
    }
    flush();
  }

  private charStyleOf(rPr: XmlElement | undefined): string | undefined {
    const id = attr(child(rPr, "rStyle"), "val");
    const word = id ? this.shared.styles.get(id) : undefined;
    if (!word || word.type !== "character" || isBuiltInName(word.name) || word.linked) return undefined;
    this.shared.used.add(word.id);
    return word.id;
  }

  marksOf(rPr: XmlElement | undefined): Marks {
    const m: Marks = {};
    if (!rPr) return m;
    let shade: string | undefined;
    for (const el of elements(rPr)) {
      switch (el.name) {
        case "b":
          if (isOn(el)) m.bold = true;
          break;
        case "i":
          if (isOn(el)) m.italic = true;
          break;
        case "strike":
        case "dstrike":
          if (isOn(el)) m.strike = true;
          break;
        case "u": {
          const value = attr(el, "val");
          if (value !== "none" && value !== "0") m.underline = true;
          break;
        }
        case "vertAlign": {
          const value = attr(el, "val");
          if (value === "superscript") m.superscript = true;
          else if (value === "subscript") m.subscript = true;
          break;
        }
        case "color": {
          const color = hexColor(attr(el, "val"));
          if (color) m.color = color;
          break;
        }
        case "sz": {
          const half = num(attr(el, "val"));
          if (half !== undefined && half > 0) m.fontSize = clamp(half / 2, 1, 400);
          break;
        }
        case "highlight": {
          const color = HIGHLIGHTS[attr(el, "val") ?? ""];
          if (color) m.highlight = color;
          break;
        }
        case "shd":
          shade = hexColor(attr(el, "fill"));
          break;
        case "rFonts": {
          const font = this.latinFont(el);
          if (font) m.fontFamily = font;
          break;
        }
        default:
          break;
      }
    }
    if (shade && !m.highlight) m.highlight = shade;
    return m;
  }

  private image(drawing: XmlElement): ImageBlock | null {
    const find = (node: XmlElement, name: string): XmlElement | undefined => {
      if (node.name === name) return node;
      for (const c of elements(node)) {
        const found = find(c, name);
        if (found) return found;
      }
      return undefined;
    };
    const blip = find(drawing, "blip");
    const extent = find(drawing, "extent");
    const docPr = find(drawing, "docPr");
    const alt = attr(docPr, "descr") || undefined;
    const rid = attr(blip, "embed", "r");
    const rel = rid ? this.rels.get(rid) : undefined;
    const width = clamp(Math.round((num(attr(extent, "cx")) ?? 0) / EMU_PER_PX), 1, 20000) || 100;
    const height = clamp(Math.round((num(attr(extent, "cy")) ?? 0) / EMU_PER_PX), 1, 20000) || 100;
    if (!rel || rel.external) {
      this.warn("A picture that is linked rather than stored in the file was left out");
      return null;
    }
    const path = resolveTarget(this.part, rel.target);
    const bytes = this.shared.pkg.files[path];
    const mime = IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
    if (!bytes || !mime) {
      this.warn("A picture in a format that can't be shown (such as EMF or TIFF) was left out");
      return null;
    }
    // A picture anchored with text wrapped round it (square, tight or through) is one the text wraps around here too, on the side it sits.
    const anchor = find(drawing, "anchor");
    let wrap: "left" | "right" | undefined;
    if (anchor && (this.mode === "body" || this.mode === "cell") && ["wrapSquare", "wrapTight", "wrapThrough"].some((name) => find(anchor, name))) {
      const horizontal = find(anchor, "positionH");
      const align = textOf(find(horizontal ?? anchor, "align")).trim().toLowerCase();
      const offset = num(textOf(find(horizontal ?? anchor, "posOffset")).trim());
      wrap = align === "right" || align === "outside" ? "right" : align === "left" || align === "inside" ? "left" : offset !== undefined && offset > 2_000_000 ? "right" : "left";
    }
    // Word crops a picture with `srcRect`: what is cut from each side, in thousandths of a percent. The size it shows is what is left.
    const rect = find(drawing, "srcRect");
    const side = (name: string) => clamp((num(attr(rect, name)) ?? 0) / 100000, 0, 0.9);
    const cut = { top: side("t"), right: side("r"), bottom: side("b"), left: side("l") };
    const crop = rect && (cut.top || cut.right || cut.bottom || cut.left) && cut.left + cut.right <= 0.95 && cut.top + cut.bottom <= 0.95 ? cut : undefined;
    return { id: createId("b_"), type: "image", src: `data:${mime};base64,${toBase64(bytes)}`, ...(alt && { alt }), width, height, ...(wrap && { wrap }), ...(crop && { crop }) };
  }

  // ---- Tables ----

  private table(tbl: XmlElement): TableBlock | Block {
    const grid = childrenNamed(child(tbl, "tblGrid"), "gridCol").map((c) => num(attr(c, "w")) ?? 0);
    const rowsXml = childrenNamed(tbl, "tr");
    // The grid may be missing or wrong; the widest row decides the number of columns.
    const rowWidths = rowsXml.map((tr) => childrenNamed(tr, "tc").reduce((n, tc) => n + clamp(Math.round(num(attr(child(child(tc, "tcPr"), "gridSpan"), "val")) ?? 1), 1, 63), 0) + (num(attr(child(child(tr, "trPr"), "gridBefore"), "val")) ?? 0));
    const columnsCount = clamp(Math.max(grid.length, ...rowWidths, 1), 1, 63);
    const widths = Array.from({ length: columnsCount }, (_, i) => (grid[i] && grid[i]! > 0 ? grid[i]! : 1));

    const rows: TableRow[] = [];
    /** For each column, the cell above that a vertical merge continues. */
    const open: ({ cell: TableCell; row: number } | null)[] = Array.from({ length: columnsCount }, () => null);

    rowsXml.forEach((tr, r) => {
      const trPr = child(tr, "trPr");
      const cells: TableCell[] = [];
      const skip = clamp(Math.round(num(attr(child(trPr, "gridBefore"), "val")) ?? 0), 0, columnsCount);
      let col = 0;
      const blank = (): TableCell => ({ id: createId("c_"), blocks: [{ id: createId("b_"), type: "paragraph", runs: [] }] });
      for (; col < skip; col++) cells.push(blank());
      for (const tc of childrenNamed(tr, "tc")) {
        if (col >= columnsCount) break;
        const tcPr = child(tc, "tcPr");
        const span = clamp(Math.round(num(attr(child(tcPr, "gridSpan"), "val")) ?? 1), 1, columnsCount - col);
        const merge = child(tcPr, "vMerge");
        const mergeKind = merge ? (attr(merge, "val") === "restart" ? "restart" : "continue") : null;
        if (mergeKind === "continue" && open[col]) {
          const origin = open[col]!;
          origin.cell.rowSpan = (origin.cell.rowSpan ?? 1) + 1;
          cells.push({ id: createId("c_"), blocks: [], covered: true });
        } else {
          const content = this.cellBlocks(tc);
          const cell: TableCell = { id: createId("c_"), blocks: content };
          const shade = hexColor(attr(child(tcPr, "shd"), "fill"));
          if (shade) cell.shade = shade;
          if (span > 1) cell.colSpan = span;
          const v = attr(child(tcPr, "vAlign"), "val");
          if (v === "center") cell.vAlign = "middle";
          else if (v === "bottom") cell.vAlign = "bottom";
          cells.push(cell);
          for (let k = 0; k < span; k++) open[col + k] = mergeKind === "restart" ? { cell, row: r } : null;
        }
        // The squares a cell spans sideways are covered placeholders.
        for (let k = 1; k < span; k++) cells.push({ id: createId("c_"), blocks: [], covered: true });
        col += span;
      }
      // A row that is short is padded with empty cells, and a column no cell reached ends a merge above it.
      while (cells.length < columnsCount) cells.push(blank());
      const height = num(attr(child(trPr, "trHeight"), "val"));
      rows.push({ id: createId("r_"), cells: cells.slice(0, columnsCount), ...(height ? { height: clamp(height / TWIPS_PER_PT, 1, 5000) } : {}) });
      for (let c = 0; c < columnsCount; c++) {
        const cell = rows[r]!.cells[c]!;
        if (open[c] && cell.covered === undefined && open[c]!.cell !== cell) open[c] = null;
      }
    });

    const borders = tableBorders(child(child(tbl, "tblPr"), "tblBorders"));
    const headerRow = !!rowsXml[0] && !!child(child(rowsXml[0], "trPr"), "tblHeader") && isOn(child(child(rowsXml[0], "trPr"), "tblHeader"));
    if (rows.length === 0) return { id: createId("b_"), type: "paragraph", runs: [] };
    // A header row drawn shaded by the exporter isn't a shade the author chose.
    if (headerRow) for (const cell of rows[0]!.cells) if (cell.shade === "#f3f4f6") delete cell.shade;
    let table: TableBlock = { id: createId("b_"), type: "table", rows, columns: normalizeColumns(widths), ...(headerRow && { headerRow: true }), ...(borders !== "all" && { borders }) };
    // Spans that don't make a regular grid (a malformed file) are dropped rather than refused.
    if (checkGrid(table)) {
      this.warn("A table whose merged cells couldn't be read was imported without merging");
      table = { ...table, rows: table.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => (cell.covered ? { id: cell.id, blocks: [{ id: createId("b_"), type: "paragraph" as const, runs: [] }] } : (({ colSpan: _c, rowSpan: _r, ...rest }) => rest)(cell))) })) };
    }
    return table;
  }

  private cellBlocks(tc: XmlElement): CellBlock[] {
    const inner = new Converter(this.shared, this.part, this.rels, "cell");
    inner.open = this.open;
    const blocks = inner.blocks(elements(tc)).filter((i): i is Block => !isSection(i));
    const allowed = blocks.filter((b): b is CellBlock => ["paragraph", "title", "subtitle", "quote", "heading", "list_item", "code_block", "image", "divider"].includes(b.type));
    return allowed.length > 0 ? allowed : [{ id: createId("b_"), type: "paragraph", runs: [] }];
  }
}

function tableBorders(el: XmlElement | undefined): "all" | "horizontal" | "none" {
  if (!el) return "all";
  const drawn = (name: string) => {
    const e = child(el, name);
    return !!e && !["nil", "none"].includes(attr(e, "val") ?? "single");
  };
  const horizontal = drawn("top") || drawn("bottom") || drawn("insideH");
  const vertical = drawn("left") || drawn("right") || drawn("insideV");
  if (!horizontal && !vertical) return "none";
  if (horizontal && !vertical) return "horizontal";
  return "all";
}

// ---- The whole file --------------------------------------------------------------------------------------------

const REL_TYPE = (name: string) => new RegExp(`/${name}$`);

function findRel(rels: Rels, type: string): { id: string; target: string } | undefined {
  for (const [id, rel] of rels) if (REL_TYPE(type).test(rel.type)) return { id, target: rel.target };
  return undefined;
}

/**
 * Reads a `.docx` file into a Pli document: text and its formatting, headings, lists, tables with merged cells,
 * pictures, headers and footers, footnotes, comments, a table of contents, section breaks with their pages and
 * columns, and the author's own named styles. What can't be carried over is listed in `warnings`; nothing in
 * the file can run code, and unknown parts are ignored.
 *
 * ```ts
 * const { doc, authors, warnings } = fromDocx(new Uint8Array(await file.arrayBuffer()));
 * ```
 */
export function fromDocx(bytes: Uint8Array, options: DocxImportOptions = {}): DocxImportResult {
  const pkg = new Package(bytes, options.maxUnpackedBytes ?? 250 * 1024 * 1024);
  const main = findRel(pkg.relsFile("_rels/.rels"), "officeDocument")?.target ?? "word/document.xml";
  const docPath = pkg.has(main) ? main : "word/document.xml";
  if (!pkg.has(docPath)) throw new PliError("invalid_document", "Not a Word document: it has no word/document.xml");
  const documentXml = pkg.xml(docPath)!;
  const body = child(documentXml, "body");
  if (!body) throw new PliError("invalid_document", "Not a Word document: its document.xml has no body");
  const rels = pkg.rels(docPath);
  const dir = (target: string) => resolveTarget(docPath, target);

  const warnings = new Set<string>();

  // Styles, numbering and settings.
  const styles = new Map<string, WordStyle>();
  const stylesPart = findRel(rels, "styles");
  const stylesXml = pkg.xml(stylesPart ? dir(stylesPart.target) : "word/styles.xml");
  for (const s of childrenNamed(stylesXml, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    styles.set(id, {
      id,
      type: attr(s, "type") ?? "paragraph",
      name: attr(child(s, "name"), "val") ?? id,
      basedOn: attr(child(s, "basedOn"), "val"),
      linked: attr(child(s, "link"), "val"),
      pPr: child(s, "pPr"),
      rPr: child(s, "rPr"),
      custom: attr(s, "customStyle") === "1" || attr(s, "customStyle") === "true",
      isDefault: attr(s, "default") === "1",
    });
  }
  const numberingPart = findRel(rels, "numbering");
  const numbering = readNumbering(pkg.xml(numberingPart ? dir(numberingPart.target) : "word/numbering.xml"));
  const settingsPart = findRel(rels, "settings");
  const settings = pkg.xml(settingsPart ? dir(settingsPart.target) : "word/settings.xml");
  const evenAndOdd = isOn(child(settings, "evenAndOddHeaders"));

  // Comments are read first, so the text they cover can be marked as it is read.
  const authors = new Map<string, PliUser>();
  const userId = options.userId ?? ((name: string) => slug(name) || "unknown");
  const authorOf = (name: string): string => {
    const id = userId(name);
    if (!authors.has(id)) authors.set(id, { id, name: name || id });
    return id;
  };
  const threadOf = new Map<string, string>();
  const threads: Thread<DocAnchor>[] = [];
  const commentsPart = findRel(rels, "comments");
  const commentsXml = pkg.xml(commentsPart ? dir(commentsPart.target) : "word/comments.xml");
  if (commentsXml) {
    const extendedPart = [...rels.values()].find((r) => /commentsExtended$/.test(r.type));
    const extended = pkg.xml(extendedPart ? dir(extendedPart.target) : "word/commentsExtended.xml");
    const parentOf = new Map<string, string | undefined>();
    const done = new Map<string, boolean>();
    for (const ex of childrenNamed(extended, "commentEx")) {
      const para = attr(ex, "paraId");
      if (!para) continue;
      parentOf.set(para, attr(ex, "paraIdParent"));
      done.set(para, attr(ex, "done") === "1" || attr(ex, "done") === "true");
    }
    interface WordComment { id: string; author: string; date: number; body: string; para?: string; }
    const all: WordComment[] = [];
    for (const c of childrenNamed(commentsXml, "comment")) {
      const id = attr(c, "id");
      if (id === undefined) continue;
      const paragraphs = childrenNamed(c, "p");
      const lines = paragraphs.map((p) => commentLine(p));
      while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const date = Date.parse(attr(c, "date") ?? "");
      all.push({ id, author: attr(c, "author") ?? "", date: Number.isFinite(date) ? date : 0, body: lines.join("\n"), para: attr(paragraphs[0], "paraId") });
    }
    const byPara = new Map(all.filter((c) => c.para).map((c) => [c.para!, c]));
    const rootOf = (c: WordComment): WordComment => {
      let at = c;
      for (let i = 0; i < 100; i++) {
        const parent = at.para ? parentOf.get(at.para) : undefined;
        const next = parent ? byPara.get(parent) : undefined;
        if (!next) break;
        at = next;
      }
      return at;
    };
    const byRoot = new Map<string, WordComment[]>();
    for (const c of all) {
      const root = rootOf(c);
      threadOf.set(c.id, `th_${root.id}`);
      byRoot.set(root.id, [...(byRoot.get(root.id) ?? []), c]);
    }
    for (const [rootId, list] of byRoot) {
      const root = all.find((c) => c.id === rootId)!;
      const comments = list.map((c) => ({ id: `cm_${c.id}`, author: authorOf(c.author), body: c.body, createdAt: c.date }));
      const isDone = root.para ? done.get(root.para) : false;
      const last = list[list.length - 1]!;
      threads.push({ id: `th_${rootId}`, createdAt: root.date, comments, ...(isDone && { resolved: { by: authorOf(last.author), at: last.date } }) });
    }
  }

  // Footnotes: which Word ids have text.
  const footnoteIdFor = new Map<string, string>();
  const footnotesPart = findRel(rels, "footnotes");
  const footnotesXml = pkg.xml(footnotesPart ? dir(footnotesPart.target) : "word/footnotes.xml");
  const noteElements = childrenNamed(footnotesXml, "footnote").filter((n) => !attr(n, "type") || attr(n, "type") === "normal");
  for (const n of noteElements) {
    const id = attr(n, "id");
    if (id !== undefined) footnoteIdFor.set(id, `fn_${id}`);
  }

  // The theme's fonts, for runs that name `minorHAnsi` instead of a family.
  const themePart = findRel(rels, "theme");
  const themeXml = pkg.xml(themePart ? dir(themePart.target) : "word/theme/theme1.xml");
  const scheme = child(child(themeXml, "themeElements"), "fontScheme");
  const latinOf = (name: "majorFont" | "minorFont") => attr(child(child(scheme, name), "latin"), "typeface")?.trim() || undefined;
  const themeFonts = { major: latinOf("majorFont"), minor: latinOf("minorFont") };
  const shared: Shared = { pkg, warnings, styles, numbering, counters: new Map(), usedLevels: new Set(), wordNumbers: new Map(), used: new Set(), threadOf, footnotes: footnoteIdFor, referencedNotes: new Set(), themeFonts, acceptChanges: options.trackedChanges === "accept", authorOf };

  const converter = new Converter(shared, docPath, rels, "body");
  const items = converter.blocks(elements(body).filter((n) => n.name !== "sectPr"));
  const finalSect = child(body, "sectPr");
  if (finalSect) items.push({ section: readSectPr(finalSect) });

  // Sections: each marker closes the section before it. The first section's settings are the document's.
  const sections: { info: SectInfo; blocks: Block[] }[] = [];
  let current: Block[] = [];
  for (const item of items) {
    if (isSection(item)) {
      sections.push({ info: item.section, blocks: current });
      current = [];
    } else current.push(item);
  }
  if (current.length > 0 || sections.length === 0) {
    sections.push({
      info: sections[sections.length - 1]?.info ?? { width: 8.5, height: 11, landscape: false, margins: { top: 1, right: 1, bottom: 1, left: 1 }, continuous: false, titlePg: false, refs: [] },
      blocks: current,
    });
  }

  const warn = (message: string) => warnings.add(message);
  const regionOf = (info: SectInfo, name: RegionName): Block[] | undefined => {
    const kind = name.startsWith("header") ? "header" : "footer";
    const variant = name.endsWith("First") ? "first" : name.endsWith("Even") ? "even" : "default";
    const ref = info.refs.find((r) => r.kind === kind && r.variant === variant);
    const rel = ref ? rels.get(ref.rid) : undefined;
    if (!rel) return undefined;
    const path = dir(rel.target);
    const xml = pkg.xml(path);
    if (!xml) return undefined;
    const part = new Converter(shared, path, pkg.rels(path), "region");
    const blocks = part.blocks(elements(xml)).filter((i): i is Block => !isSection(i) && i.type !== "page_break" && i.type !== "toc" && i.type !== "section_break");
    // A header that holds only the empty paragraph Word always has is no header.
    return blocks.every((b) => b.type === "paragraph" && b.runs.length === 0) ? [] : blocks;
  };

  const first = sections[0]!.info;
  const page: PageSetup = {
    size: sizeOf(first, warn),
    orientation: first.landscape ? "landscape" : "portrait",
    margins: first.margins,
    ...(first.columns && { columns: first.columns }),
    ...(first.titlePg && { differentFirstPage: true }),
    ...(evenAndOdd && { differentOddEven: true }),
  };

  const blocks: Block[] = [];
  sections.forEach((section, i) => {
    if (i > 0) {
      const prev = sections[i - 1]!.info;
      const here = section.info;
      const shape = { size: sizeOf(here, warn), orientation: here.landscape ? ("landscape" as const) : ("portrait" as const), margins: here.margins };
      const before = { size: sizeOf(prev, warn), orientation: prev.landscape ? ("landscape" as const) : ("portrait" as const), margins: prev.margins };
      const changed = shape.size !== before.size || shape.orientation !== before.orientation || (["top", "right", "bottom", "left"] as const).some((side) => shape.margins[side] !== before.margins[side]);
      const regions: SectionBreakBlock["regions"] = {};
      for (const kind of ["header", "footer"] as const) {
        for (const variant of ["default", "first", "even"] as const) {
          const name = regionName(kind, variant);
          const own = regionOf(here, name);
          if (own !== undefined) regions[name] = own;
        }
      }
      blocks.push({
        id: createId("b_"),
        type: "section_break",
        kind: here.continuous && !changed ? "continuous" : "next_page",
        ...(here.columns && { columns: here.columns }),
        ...(changed && { page: shape }),
        ...(here.titlePg && { differentFirstPage: true }),
        ...(Object.keys(regions).length > 0 && { regions }),
      });
    }
    blocks.push(...section.blocks);
  });
  if (blocks.length === 0) blocks.push({ id: createId("b_"), type: "paragraph", runs: [] });

  const title = textOf(child(pkg.xml("docProps/core.xml"), "title")).trim() || options.title || "Untitled";
  let doc: Doc = { id: createId("doc_"), type: "document", title, blocks, page };

  for (const name of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const) {
    const content = regionOf(first, name);
    if (content && content.length > 0) doc = { ...doc, [name]: content };
  }

  // Notes that are referenced, with their text.
  const notes: Record<string, Block[]> = {};
  for (const n of noteElements) {
    const word = attr(n, "id");
    if (word === undefined || !shared.referencedNotes.has(word)) continue;
    const part = new Converter(shared, footnotesPart ? dir(footnotesPart.target) : "word/footnotes.xml", pkg.rels(footnotesPart ? dir(footnotesPart.target) : "word/footnotes.xml"), "note");
    const content = part.blocks(elements(n)).filter((i): i is Block => !isSection(i));
    notes[footnoteIdFor.get(word)!] = cleanNoteBlocks(content);
  }
  if (Object.keys(notes).length > 0) doc = { ...doc, footnotes: notes };

  // Styles that something uses, with the ones they are based on.
  const imported = importStyles(shared);
  doc = remapStyles(doc, imported.ids);
  if (Object.keys(imported.styles).length > 0) doc = { ...doc, styles: imported.styles };

  // Comments: a thread is kept when its text is in the document, with its anchor read from the marks.
  const kept: Record<string, Thread<DocAnchor>> = {};
  for (const thread of threads) {
    const ranges = commentRanges(doc, thread.id);
    const range = ranges[0];
    if (!range) continue;
    const block = findBlock(doc.blocks, range.block);
    const quote = block ? plainText(block.runs).slice(range.from, range.to).slice(0, 200) : "";
    kept[thread.id] = { ...thread, anchor: { block: range.block, from: range.from, to: range.to, quote } };
  }
  // Marks for threads that have no comments in the file's comments part would dangle.
  const used = new Set(Object.keys(kept));
  doc = { ...doc, blocks: stripUnknownComments(doc.blocks, used) };
  if (Object.keys(kept).length > 0) doc = { ...doc, comments: kept };

  doc = withListStarts(doc, shared.wordNumbers);

  let valid: Doc;
  try {
    valid = validateDoc(doc);
  } catch (cause) {
    throw new PliError("invalid_document", `The file was read, but the result isn't a valid document: ${(cause as Error).message}`, { cause });
  }
  const suggesting = new Set(suggestionsIn(valid).map((s) => s.by));
  const people = [...authors.values()].filter((a) => suggesting.has(a.id) || Object.values(kept).some((t) => t.comments.some((c) => c.author === a.id)));
  return { doc: valid, authors: people, warnings: [...warnings] };
}

/**
 * Gives a numbered item a `start` where the number Word shows isn't the one the editor would count to: after a restart, in
 * a list Word continues past other paragraphs, or in one that begins at another number.
 */
function numberedLikeWord(blocks: readonly Block[], word: ReadonlyMap<string, number>): Block[] {
  const counters: number[] = [];
  return blocks.map((block) => {
    if (block.type === "table") {
      counters.length = 0;
      const rows = block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: numberedLikeWord(cell.blocks, word) as CellBlock[] })) }));
      return { ...block, rows };
    }
    if (block.type !== "list_item") {
      counters.length = 0;
      return block;
    }
    counters.length = block.depth + 1;
    if (block.list === "bullet") {
      counters[block.depth] = 0;
      return block;
    }
    const natural = (counters[block.depth] ?? 0) + 1;
    const wanted = word.get(block.id);
    if (wanted === undefined || wanted === natural) {
      counters[block.depth] = natural;
      return block;
    }
    counters[block.depth] = wanted;
    return { ...block, start: wanted };
  });
}

function withListStarts(doc: Doc, word: ReadonlyMap<string, number>): Doc {
  if (word.size === 0) return doc;
  const next: Doc = { ...doc, blocks: numberedLikeWord(doc.blocks, word) };
  for (const name of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const) {
    if (next[name]) next[name] = numberedLikeWord(next[name]!, word) as never;
  }
  if (next.footnotes) next.footnotes = Object.fromEntries(Object.entries(next.footnotes).map(([id, blocks]) => [id, numberedLikeWord(blocks, word)])) as never;
  next.blocks = next.blocks.map((b) =>
    b.type === "section_break" && b.regions ? { ...b, regions: Object.fromEntries(Object.entries(b.regions).map(([name, blocks]) => [name, numberedLikeWord(blocks as Block[], word)])) as never } : b,
  );
  return next;
}

function commentLine(p: XmlElement): string {
  let out = "";
  const walk = (node: XmlElement) => {
    for (const el of elements(node)) {
      if (el.name === "t") out += textOf(el);
      else if (el.name === "tab") out += "\t";
      else if (el.name === "br" || el.name === "cr") out += "\n";
      else if (el.name === "r" || el.name === "ins" || el.name === "hyperlink" || el.name === "smartTag") walk(el);
    }
  };
  walk(p);
  return out;
}

function findBlock(blocks: readonly Block[], id: string): TextBlock | undefined {
  for (const block of blocks) {
    if (block.id === id && "runs" in block) return block as TextBlock;
    if (block.type === "table") for (const row of block.rows) for (const cell of row.cells) {
      const inner = findBlock(cell.blocks, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

function stripUnknownComments(blocks: Block[], known: Set<string>): Block[] {
  const fix = (runs: Run[]): Run[] =>
    normalizeRuns(
      runs.map((run) => {
        const ids = run.marks?.comment?.filter((id) => known.has(id));
        if (!run.marks?.comment || ids?.length === run.marks.comment.length) return run;
        const { comment: _gone, ...rest } = run.marks;
        return { ...run, marks: ids && ids.length > 0 ? { ...rest, comment: ids } : Object.keys(rest).length > 0 ? rest : undefined } as Run;
      }),
    );
  const visit = <T extends Block | CellBlock>(block: T): T => {
    if (block.type === "table") return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as T;
    if ("runs" in block) return { ...block, runs: fix(block.runs) } as T;
    return block;
  };
  return blocks.map(visit);
}

/** The styles to import: those used by text, the author's own, and the ones they are based on. */
function importStyles(shared: Shared): { styles: Record<string, DocStyle>; ids: Map<string, string> } {
  const { styles, used } = shared;
  const wanted = new Set<string>(used);
  for (const [id, s] of styles) {
    if ((s.type === "paragraph" || s.type === "character") && s.custom && !isBuiltInName(s.name) && !(s.type === "character" && s.linked)) wanted.add(id);
  }
  const eligible = (id: string) => {
    const s = styles.get(id);
    // The character half of a linked pair (a heading and its "Heading 1 Char") is Word's own business, not a style of the author's.
    return !!s && (s.type === "paragraph" || s.type === "character") && !isBuiltInName(s.name) && !s.isDefault && !(s.type === "character" && s.linked);
  };
  // Pull in the bases of what is wanted.
  for (const id of [...wanted]) {
    const seen = new Set<string>([id]);
    for (let base = styles.get(id)?.basedOn; base !== undefined && !seen.has(base); base = styles.get(base)?.basedOn) {
      seen.add(base);
      if (eligible(base) && styles.get(base)!.type === styles.get(id)!.type) wanted.add(base);
    }
  }
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const id of wanted) {
    if (!eligible(id)) continue;
    const s = styles.get(id)!;
    const stripped = id.startsWith("Pli_") ? id.slice(4) : undefined;
    let ours = stripped && stripped.length > 0 ? stripped : slug(s.name) || slug(id) || "style";
    for (let n = 2; taken.has(ours); n++) ours = `${slug(s.name) || "style"}-${n}`;
    taken.add(ours);
    ids.set(id, ours);
  }
  const probe = new Converter(shared, "", new Map(), "body");
  const out: Record<string, DocStyle> = {};
  for (const [wordId, ours] of ids) {
    const s = styles.get(wordId)!;
    const kind = s.type === "character" ? "character" : "paragraph";
    let basedOn: string | undefined;
    const seen = new Set<string>([wordId]);
    for (let base = s.basedOn; base !== undefined && !seen.has(base); base = styles.get(base)?.basedOn) {
      seen.add(base);
      const target = ids.get(base);
      if (target && styles.get(base)!.type === s.type) {
        basedOn = target;
        break;
      }
    }
    const all = probe.marksOf(s.rPr);
    const marks: StyleMarks = {};
    for (const key of STYLE_MARK_KEYS) if (all[key] !== undefined) (marks as Record<string, unknown>)[key] = all[key];
    const style: DocStyle = { name: s.name || ours, kind, ...(basedOn && { basedOn }), ...(Object.keys(marks).length > 0 && { marks }) };
    if (kind === "paragraph") {
      const info = probeInfo(probe, s.pPr);
      if (info.align) style.align = info.align;
      if (info.format) style.format = info.format;
    }
    out[ours] = style;
  }
  return { styles: out, ids };
}

/** Points blocks and runs at our style ids instead of the file's, and drops a reference to a style that wasn't imported. */
function remapStyles(doc: Doc, ids: Map<string, string>): Doc {
  const fixRuns = (runs: Run[]): Run[] =>
    runs.map((run) => {
      const id = run.marks?.style;
      if (id === undefined) return run;
      const { style: _old, ...rest } = run.marks!;
      const ours = ids.get(id);
      const marks = ours ? { ...rest, style: ours } : rest;
      return Object.keys(marks).length > 0 ? { ...run, marks } : { text: run.text };
    });
  const visit = <T extends Block | CellBlock>(block: T): T => {
    if (block.type === "table") return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as T;
    if (block.type === "section_break" && block.regions) {
      return { ...block, regions: Object.fromEntries(Object.entries(block.regions).map(([k, v]) => [k, v.map(visit)])) } as T;
    }
    if (!("runs" in block)) return block;
    const next = { ...block, runs: fixRuns(block.runs) } as Record<string, unknown>;
    if ("style" in block && block.style !== undefined) {
      const ours = ids.get(block.style as string);
      if (ours) next.style = ours;
      else delete next.style;
    }
    return next as unknown as T;
  };
  const out: Doc = { ...doc, blocks: doc.blocks.map(visit) };
  for (const name of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const) if (doc[name]) out[name] = doc[name]!.map(visit);
  if (doc.footnotes) out.footnotes = Object.fromEntries(Object.entries(doc.footnotes).map(([k, v]) => [k, v.map(visit)]));
  return out;
}

/** Alignment and spacing of a style's own paragraph properties. */
function probeInfo(probe: Converter, pPr: XmlElement | undefined): { align?: Align; format?: ParagraphFormat } {
  const jc = attr(child(pPr, "jc"), "val");
  const align: Align | undefined = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" || jc === "justify" ? "justify" : undefined;
  const format = probe.formatOf(pPr);
  return { ...(align && { align }), ...(format && { format }) };
}
