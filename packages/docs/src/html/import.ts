import { createId, lookupFont } from "@pli.dev/core";
import { checkGrid, normalizeColumns } from "../grid";
import type {
  Align,
  Block,
  CellBlock,
  ImageBlock,
  ListMarker,
  Marks,
  ParagraphBlock,
  Run,
  TableBlock,
  TableCell,
  TableRow,
  TextBlock,
} from "../model";
import { BULLET_MARKERS, MAX_LIST_START, NUMBER_MARKERS, bulletOfLabel, defaultMarker, numberOfLabel } from "../lists";
import { normalizeRuns } from "../runs";
import { tocFromLinks } from "./toc";
import { parseColor, parseDeclarations, parseLengthPt, parseStylesheet, ruleMatches, type Declarations, type Rule } from "./css";
import { isBlockTag, parseHtml, textOf, type HElement, type HNode } from "./tree";

export interface ImportOptions {
  /** Text at this size, in points, gets no explicit size. Default 11. */
  defaultFontSize?: number;
  /** Text in this font gets no explicit font. Default "Arial". */
  defaultFontFamily?: string;
}

/** What was read from the HTML. */
export interface Fragment {
  blocks: Block[];
  /**
   * Ids of image blocks whose size the HTML didn't give. They hold a placeholder size, and a caller
   * that can load images should measure them and update `width` and `height`.
   */
  unsizedImages: string[];
}

/** Ceilings that keep a hostile or enormous page from producing an enormous document. */
const MAX_BLOCKS = 20_000;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 40;
const MAX_SPAN = 40;

type MarkState = { [K in keyof Marks]?: Marks[K] | null };

interface Style {
  marks: MarkState;
  white: "normal" | "pre" | "pre-line";
  align?: Align;
  link?: string;
  /** How far in the text is from the left margin, in points, from the `margin-left` of the paragraph and what it is in. */
  indent?: number;
}

type Kind =
  | { type: "paragraph" }
  | { type: "quote" }
  | { type: "title" }
  | { type: "subtitle" }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "list_item"; list: "bullet" | "ordered"; depth: number; marker?: ListMarker; start?: number };

interface Buffer {
  kind: Kind;
  align?: Align;
  indent?: number;
  runs: Run[];
  /** True if the last character added was a collapsible space, so another one is dropped. */
  endsInSpace: boolean;
}

/** Elements whose content is never text to read. */
const SKIP = new Set([
  "head", "script", "style", "title", "meta", "link", "noscript", "template", "iframe", "object", "embed", "svg", "canvas",
  "video", "audio", "select", "button", "input", "textarea", "map", "math", "base", "datalist", "dialog",
]);

const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 14, 4: 12, 5: 11, 6: 11 };
const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
  "ui-rounded", "inherit", "initial", "unset", "-apple-system", "blinkmacsystemfont", "emoji", "math", "fangsong",
]);
/** `<font size="1…7">` as points. */
const FONT_TAG_SIZES = [0, 7.5, 10, 12, 13.5, 18, 24, 36];

const safeLink = (href: string | undefined): string | undefined => {
  const value = href?.trim();
  // A link to a place in the same document (`#heading=…`) is kept while the paste is read, to tell a table of contents from other text; `tocFromLinks` removes it.
  return value && (/^(https?:|mailto:|tel:)/i.test(value) || /^#.+/.test(value)) && value.length <= 2048 ? value : undefined;
};

const safeImageSource = (src: string | undefined): string | undefined => {
  const value = src?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) && value.length <= 4096) return value;
  if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value) && value.length <= 8_000_000) return value.replace(/\s+/g, "");
  return undefined;
};

/** Relative luminance, 0 (black) to 1 (white), of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** The color a `background` or `background-color` declaration paints, if it is a plain color. */
function backgroundOf(css: Declarations): string | null {
  const direct = parseColor(css["background-color"]);
  if (direct) return direct;
  const first = css.background?.trim().split(/\s+(?![^()]*\))/)[0];
  return first ? parseColor(first) : null;
}

function weight(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "bold" || v === "bolder") return true;
  if (v === "normal" || v === "lighter") return false;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n >= 600 : undefined;
}

function alignOf(value: string | undefined): Align | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "center" || v === "right" || v === "justify") return v;
  return undefined;
}

/**
 * The first real family of a CSS `font-family` list: `"Lora", Georgia, serif` is `Lora`. Quotes, `!important` and generic
 * names (`sans-serif`, `system-ui`...) are not part of a name, and a list of generic names alone gives no family. A
 * family the font catalogue knows by another case (`lora`) is written the way the catalogue does (`Lora`).
 */
function firstFont(value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const raw of value.replace(/!\s*important/gi, "").split(",")) {
    const name = raw.trim().replace(/^["']|["']$/g, "").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim();
    if (name && !GENERIC_FONTS.has(name.toLowerCase())) {
      const known = lookupFont(name);
      return (known && known.family.toLowerCase() === name.toLowerCase() ? known.family : name).slice(0, 64);
    }
  }
  return undefined;
}

/** The family list of a `font` shorthand (`italic 12pt/1.4 Georgia, serif`): what follows the size. */
function shorthandFamily(value: string | undefined): string | undefined {
  const m = value && /(?:^|\s)(?:\d*\.?\d+(?:px|pt|em|rem|%|ex|ch|cm|mm|in|pc|vw|vh)|(?:xx?-)?(?:small|large)|xxx-large|medium|smaller|larger)(?:\/\S+)?\s+(.+)$/i.exec(value.trim());
  return m ? firstFont(m[1]) : undefined;
}

const isHidden = (css: Declarations, el: HElement): boolean =>
  "hidden" in el.attrs ||
  css.display?.trim().toLowerCase() === "none" ||
  css.visibility?.trim().toLowerCase() === "hidden" ||
  css["mso-hide"]?.trim().toLowerCase() === "all";

class Importer {
  readonly blocks: Block[] = [];
  readonly unsized: string[] = [];
  private buffer: Buffer | null = null;
  private readonly kinds: Kind[] = [{ type: "paragraph" }];
  /** The lists the walk is inside: what kind, how its items are marked, and whether its first item is still to come. */
  private readonly lists: { list: "bullet" | "ordered"; marker?: ListMarker; start: number; first: boolean }[] = [];

  constructor(
    private readonly rules: readonly Rule[],
    private readonly options: Required<ImportOptions>,
    /** Inside a table cell, tables are flattened and only cell-safe blocks are produced. */
    private readonly inCell = false,
    /** For HTML with no block elements (a selection from inside a paragraph): spaces at the ends are real. */
    private readonly inline = false,
  ) {}

  // ---- styles ----

  private declarations(el: HElement): Declarations {
    const classes = (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
    const matched = this.rules
      .filter((rule) => ruleMatches(rule, el.tag, classes, el.attrs.id))
      .sort((a, b) => a.specificity - b.specificity);
    const out: Declarations = {};
    for (const rule of matched) Object.assign(out, rule.declarations);
    if (el.attrs.style) Object.assign(out, parseDeclarations(el.attrs.style));
    return out;
  }

  private styleFor(el: HElement, parent: Style, css: Declarations): Style {
    const marks: MarkState = { ...parent.marks };
    let link = parent.link;
    let align = parent.align;
    let white = parent.white;

    switch (el.tag) {
      case "b": case "strong": marks.bold = true; break;
      case "i": case "em": case "cite": case "dfn": case "var": marks.italic = true; break;
      case "u": case "ins": marks.underline = true; break;
      case "s": case "strike": case "del": marks.strike = true; break;
      case "code": case "kbd": case "samp": case "tt": marks.code = true; break;
      case "sup": marks.superscript = true; marks.subscript = null; break;
      case "sub": marks.subscript = true; marks.superscript = null; break;
      case "mark": marks.highlight = "#ffff00"; break;
      case "a": link = safeLink(el.attrs.href) ?? link; break;
      case "center": align = "center"; break;
      case "font": {
        const face = firstFont(el.attrs.face);
        if (face) marks.fontFamily = face;
        const color = parseColor(el.attrs.color);
        if (color) marks.color = color;
        const size = FONT_TAG_SIZES[Number(el.attrs.size)];
        if (size) marks.fontSize = size;
        break;
      }
    }

    const bold = weight(css["font-weight"]);
    if (bold !== undefined) marks.bold = bold ? true : null;
    const italic = css["font-style"]?.trim().toLowerCase();
    if (italic) marks.italic = italic === "italic" || italic === "oblique" ? true : italic === "normal" ? null : marks.italic;
    // Links are underlined by default; only an underline asked for on something else counts.
    const decoration = (css["text-decoration-line"] ?? css["text-decoration"] ?? "").toLowerCase();
    if (decoration && el.tag !== "a") {
      marks.underline = decoration.includes("underline") ? true : decoration.includes("none") ? null : marks.underline;
      marks.strike = decoration.includes("line-through") ? true : decoration.includes("none") ? null : marks.strike;
    }
    const color = parseColor(css.color);
    if (color) marks.color = luminance(color) > 0.75 || color === "#000000" ? null : color;
    else if (css.color && /^(inherit|initial|unset|windowtext|currentcolor)$/i.test(css.color.trim())) marks.color = null;
    const background = backgroundOf(css);
    if (background) marks.highlight = luminance(background) > 0.9 || luminance(background) < 0.1 ? null : background;
    const family = firstFont(css["font-family"]) ?? shorthandFamily(css.font);
    if (family) marks.fontFamily = family;
    const size = parseLengthPt(css["font-size"]);
    if (size && size > 0 && size <= 400) marks.fontSize = Math.round(size * 2) / 2;
    const vertical = css["vertical-align"]?.trim().toLowerCase();
    if (vertical === "super") { marks.superscript = true; marks.subscript = null; }
    else if (vertical === "sub") { marks.subscript = true; marks.superscript = null; }
    else if (vertical === "baseline") { marks.superscript = null; marks.subscript = null; }

    const textAlign = css["text-align"] ?? el.attrs.align;
    if (textAlign) align = alignOf(textAlign) ?? (/^(left|start)$/i.test(textAlign.trim()) ? undefined : align);

    const space = css["white-space"]?.trim().toLowerCase();
    if (el.tag === "pre") white = "pre";
    else if (space === "pre" || space === "pre-wrap" || space === "break-spaces") white = "pre";
    else if (space === "pre-line") white = "pre-line";
    else if (space === "normal" || space === "nowrap") white = "normal";

    // Indentation adds up through what a paragraph is inside.
    const margin = parseLengthPt(css["margin-left"] ?? css["padding-left"]);
    const indent = margin && margin > 0 && margin <= 720 && !/^(blockquote|li|ul|ol|td|th)$/.test(el.tag) ? (parent.indent ?? 0) + margin : parent.indent;

    return { marks, white, align, link, indent };
  }

  /** The marks a run gets: set values only, minus the document's own defaults. */
  private marksFor(style: Style, inHeading: number | null): Marks | undefined {
    const out: Marks = {};
    for (const [key, value] of Object.entries(style.marks)) {
      if (value === null || value === undefined || value === false) continue;
      (out as Record<string, unknown>)[key] = value;
    }
    if (style.link) out.link = style.link;
    if (out.fontSize === this.options.defaultFontSize) delete out.fontSize;
    if (inHeading !== null) {
      // Headings are already bold and sized; keeping those as marks would make them hard to restyle.
      delete out.bold;
      if (out.fontSize === HEADING_SIZE[inHeading]) delete out.fontSize;
    }
    if (out.fontFamily && out.fontFamily.toLowerCase() === this.options.defaultFontFamily.toLowerCase()) delete out.fontFamily;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  // ---- text blocks ----

  private get kind(): Kind {
    return this.kinds[this.kinds.length - 1]!;
  }

  private add(block: Block): void {
    if (this.blocks.length < MAX_BLOCKS) this.blocks.push(block);
  }

  private addText(raw: string, style: Style): void {
    let text = raw.replace(/\r\n?/g, "\n");
    if (style.white === "normal") text = text.replace(/[ \t\n\f]+/g, " ");
    else if (style.white === "pre-line") text = text.replace(/[ \t\f]+/g, " ");

    const buffer = this.buffer;
    if (style.white !== "pre") {
      // A space at the start of a block, or after another space, shows nothing.
      if (!this.inline && text.startsWith(" ") && (!buffer || buffer.endsInSpace || buffer.runs.length === 0)) text = text.slice(1);
    }
    if (text === "") return;

    const open = buffer ?? this.open(style);
    const kindLevel = open.kind.type === "heading" ? open.kind.level : null;
    open.runs.push({ text: text.replace(/ /g, " "), marks: this.marksFor(style, kindLevel) });
    open.endsInSpace = style.white !== "pre" && text.endsWith(" ");
  }

  private open(style: Style): Buffer {
    this.buffer = { kind: this.kind, align: style.align, indent: style.indent, runs: [], endsInSpace: !this.inline };
    return this.buffer;
  }

  /** Ends the open text block, if any. Returns whether a block was produced. */
  private flush(force = false): boolean {
    const buffer = this.buffer;
    this.buffer = null;
    // A floated picture in the middle of a paragraph is anchored to it, so it goes in front of the paragraph.
    for (const image of this.anchored.splice(0)) this.add(image);
    if (!buffer && !force) return false;
    const runs = buffer ? normalizeRuns(this.inline ? buffer.runs : trimEnd(buffer.runs)) : [];
    if (runs.length === 0 && !force) return false;
    this.add(textBlock(buffer?.kind ?? this.kind, runs, buffer?.align, buffer?.indent));
    return true;
  }

  /** Runs `body`, then makes sure it produced a block (an empty one if not), so `<p></p>` stays a blank line. */
  private block(style: Style, body: () => void, force: boolean): void {
    this.flush();
    const before = this.blocks.length;
    this.buffer = null;
    body();
    this.flush();
    if (force && this.blocks.length === before) {
      this.add(textBlock(this.kind, [], style.align, style.indent));
    }
  }

  // ---- walking ----

  walk(node: HNode, style: Style): void {
    if (this.blocks.length >= MAX_BLOCKS) return;
    if (node === this.marker) return;
    if (node.kind === "text") {
      this.addText(node.text, style);
      return;
    }
    this.element(node, style);
  }

  /** The number or bullet Word puts in front of a list item. It can sit inside other spans, so it is left out wherever the walk meets it. */
  private marker: HNode | null = null;

  private children(el: HElement, style: Style, skip?: HNode): void {
    if (skip) this.marker = skip;
    for (const child of el.children) if (child !== skip) this.walk(child, style);
  }

  /** The sides pictures are floated to by the elements around the one being read, innermost last. */
  private readonly floats: ("left" | "right" | null)[] = [];
  /** Floated pictures found inside a paragraph, added in front of it when it ends. */
  private readonly anchored: ImageBlock[] = [];

  /**
   * Breaks that an element asks for with CSS (`page-break-before`, `break-after`, Word's `mso-break-type`), which are done
   * around the element, even one that is hidden: applications hide the rule that carries the break.
   */
  private breakAround(el: HElement, css: Declarations): { before: "page_break" | "section_break" | null; after: "page_break" | null; kind: "next_page" | "continuous" } {
    const asks = (value: string | undefined) => !!value && /^(always|page|left|right|recto|verso)$/.test(value.trim().toLowerCase());
    const section = (css["mso-break-type"] ?? "").trim().toLowerCase() === "section-break";
    const pageBefore = asks(css["page-break-before"]) || asks(css["break-before"]) || /\bpage-?break\b/i.test(el.attrs.class ?? "");
    return {
      before: section ? "section_break" : pageBefore ? "page_break" : null,
      after: asks(css["page-break-after"]) || asks(css["break-after"]) ? "page_break" : null,
      kind: pageBefore ? "next_page" : "continuous",
    };
  }

  private addBreak_(kind: "page_break" | "section_break", sectionKind: "next_page" | "continuous"): void {
    // A document doesn't start with a break, and two in a row are one; a cell can't hold either.
    if (this.inCell) return;
    this.flush();
    const last = this.blocks[this.blocks.length - 1];
    if (!last || last.type === "page_break" || last.type === "section_break") return;
    this.add(kind === "page_break" ? { id: createId("b_"), type: "page_break" } : { id: createId("b_"), type: "section_break", kind: sectionKind });
  }

  private element(el: HElement, parent: Style): void {
    if (SKIP.has(el.tag)) return;
    const css = this.declarations(el);
    const around = this.breakAround(el, css);
    if (around.before) this.addBreak_(around.before, around.kind);
    const float = css.float === "left" || css.float === "right" ? css.float : (el.attrs.align === "left" || el.attrs.align === "right") && el.tag === "img" ? (el.attrs.align as "left" | "right") : null;
    this.floats.push(float);
    // A rule or line break that only carries a break is the break, not a line.
    this.elementInner(el, parent, css, (el.tag === "hr" || el.tag === "br") && (around.before !== null || around.after !== null));
    this.floats.pop();
    if (around.after) this.addBreak_(around.after, "next_page");
  }

  private elementInner(el: HElement, parent: Style, css: Declarations, onlyABreak: boolean): void {
    if (onlyABreak) return;
    if (isHidden(css, el)) return;
    const style = this.styleFor(el, parent, css);

    switch (el.tag) {
      case "br":
        this.addBreak(style);
        return;
      case "hr":
        this.flush();
        this.add({ id: createId("b_"), type: "divider" });
        return;
      case "img":
        this.image(el, css);
        return;
      case "table":
        this.flush();
        this.table(el, style);
        return;
      case "pre":
        this.flush();
        this.code(el);
        return;
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        this.kinds.push({ type: "heading", level: Number(el.tag[1]) as 1 | 2 | 3 | 4 | 5 | 6 });
        this.block(style, () => this.children(el, style), true);
        this.kinds.pop();
        return;
      }
      case "blockquote":
        this.kinds.push({ type: "quote" });
        this.block(style, () => this.children(el, style), false);
        this.kinds.pop();
        return;
      case "ul": case "ol": {
        this.flush();
        const list = el.tag === "ol" ? "ordered" : "bullet";
        const start = Number.parseInt(el.attrs.start ?? "", 10);
        this.lists.push({
          list,
          ...(listMarker(list, css["list-style-type"] ?? css["list-style"], el.attrs.type) && { marker: listMarker(list, css["list-style-type"] ?? css["list-style"], el.attrs.type)! }),
          // An ordered list says where it starts, or starts at 1. A list right after another one doesn't carry on from it.
          start: Number.isInteger(start) && start >= 0 && start <= MAX_LIST_START ? start : 1,
          first: true,
        });
        this.children(el, style);
        this.flush();
        this.lists.pop();
        return;
      }
      case "li": {
        const list = this.lists[this.lists.length - 1];
        const value = Number.parseInt(el.attrs.value ?? "", 10);
        const own = listMarker(list?.list ?? "bullet", css["list-style-type"] ?? css["list-style"], undefined);
        const start = list?.list === "ordered" ? (Number.isInteger(value) && value >= 0 && value <= MAX_LIST_START ? value : list.first ? list.start : undefined) : undefined;
        if (list) list.first = false;
        const marker = own ?? list?.marker;
        this.kinds.push({ type: "list_item", list: list?.list ?? "bullet", depth: Math.max(0, this.lists.length - 1), ...(marker && { marker }), ...(start !== undefined && { start }) });
        this.block(style, () => this.children(el, style), true);
        this.kinds.pop();
        return;
      }
      case "p": {
        const word = this.wordList(el, css);
        if (word) {
          this.kinds.push({ type: "list_item", list: word.list, depth: word.depth, ...(word.style && { marker: word.style }), ...(word.start !== undefined && { start: word.start }) });
          this.block(style, () => this.children(el, style, word.marker), true);
          this.kinds.pop();
          return;
        }
        // Word's own styles for a title, a subtitle and a quotation are named in the paragraph's class.
        const named = /(?:^|\s)Mso(Title|Subtitle|Quote|IntenseQuote)(?:\s|$)/.exec(el.attrs.class ?? "")?.[1];
        if (named) {
          this.kinds.push({ type: named === "Title" ? "title" : named === "Subtitle" ? "subtitle" : "quote" });
          this.block(style, () => this.children(el, style), true);
          this.kinds.pop();
          return;
        }
        this.block(style, () => this.children(el, style), true);
        return;
      }
      case "div": case "section": case "article": case "header": case "footer": case "main": case "aside": case "nav":
      case "figure": case "figcaption": case "form": case "fieldset": case "address": case "details": case "summary":
      case "center": case "dl": case "dt": case "dd": case "caption": case "hgroup": case "menu": {
        const word = this.wordList(el, css);
        if (word) {
          this.kinds.push({ type: "list_item", list: word.list, depth: word.depth, ...(word.style && { marker: word.style }), ...(word.start !== undefined && { start: word.start }) });
          this.block(style, () => this.children(el, style, word.marker), true);
          this.kinds.pop();
          return;
        }
        this.block(style, () => this.children(el, style), false);
        return;
      }
      default:
        // Inline elements, and tags we don't know (Word's <o:p>, <font>, <span>): read through them.
        this.children(el, style);
    }
  }

  private addBreak(style: Style): void {
    const buffer = this.buffer ?? this.open(style);
    buffer.runs.push({ text: "\n", marks: undefined });
    buffer.endsInSpace = true;
  }

  /**
   * Word writes list items as ordinary paragraphs styled `mso-list: l0 level2 lfo1`, with the visible
   * bullet or number in an element marked `mso-list: Ignore`. This reads the level and the kind of
   * marker, and returns that marker so it isn't pasted as text.
   */
  private wordList(el: HElement, css: Declarations): { depth: number; list: "bullet" | "ordered"; marker?: HNode; style?: ListMarker; start?: number } | null {
    const spec = css["mso-list"];
    if (!spec || /^\s*(none|ignore)/i.test(spec)) return null;
    const level = /level(\d+)/i.exec(spec)?.[1];
    if (!level) return null;
    const findMarker = (node: HElement): HElement | undefined => {
      for (const child of node.children) {
        if (child.kind !== "el") continue;
        if (/ignore/i.test(parseDeclarations(child.attrs.style ?? "")["mso-list"] ?? "")) return child;
        const deeper = findMarker(child);
        if (deeper) return deeper;
      }
      return undefined;
    };
    const marker = findMarker(el);
    const label = marker ? textOf(marker).replace(/[\s ]+/g, "") : "";
    const ordered = /^[\(\[]?(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)\]]/.test(label);
    const depth = Math.min(8, Math.max(0, Number(level) - 1));
    if (!ordered) return { depth, list: "bullet", marker, ...(bulletOfLabel(label) && { style: bulletOfLabel(label)! }) };
    const shown = numberOfLabel(label);
    return { depth, list: "ordered", marker, ...(shown && { style: shown.marker, start: shown.number }) };
  }

  private code(el: HElement): void {
    let text = textOf(el).replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\n+$/, "");
    text = text.replace(/ /g, " ");
    if (text.trim() === "") return;
    const codeEl = el.children.find((c): c is HElement => c.kind === "el" && c.tag === "code");
    const language = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(`${el.attrs.class ?? ""} ${codeEl?.attrs.class ?? ""}`)?.[1];
    this.add({ id: createId("b_"), type: "code_block", runs: [{ text }], ...(language && { language: language.slice(0, 24) }) });
  }

  private image(el: HElement, css: Declarations): void {
    const src = safeImageSource(el.attrs.src);
    if (!src) return;
    const length = (value: string | undefined): number | null => {
      if (!value) return null;
      // Word writes the size of a picture it copies in points, though it gives no unit (the picture has a `v:shapes` link to its shape).
      const bare = /^[\d.]+$/.test(value.trim());
      const pt = parseLengthPt(bare ? `${value.trim()}${el.attrs["v:shapes"] !== undefined ? "pt" : "px"}` : value);
      return pt && pt > 0 ? Math.round((pt * 4) / 3) : null;
    };
    const width = length(css.width ?? el.attrs.width);
    const height = length(css.height ?? el.attrs.height);
    const sized = width !== null && height !== null;
    const image: ImageBlock = {
      id: createId("b_"),
      type: "image",
      src,
      width: Math.min(4000, width ?? 300),
      height: Math.min(4000, height ?? 200),
      ...(el.attrs.alt && { alt: el.attrs.alt.slice(0, 500) }),
    };
    // Text wraps around a picture that is floated, by its own style or the element around it.
    const wrap = [...this.floats].reverse().find((f) => f !== null);
    if (wrap) image.wrap = wrap;
    if (this.inCell && image.type !== "image") return;
    if (image.wrap && this.buffer && this.buffer.runs.length > 0) this.anchored.push(image);
    else {
      this.flush();
      this.add(image);
    }
    if (!sized) this.unsized.push(image.id);
  }

  // ---- tables ----

  private table(el: HElement, style: Style): void {
    const built = buildTable(el, this.rules, this.options, this.declarations(el));
    if (!built) return;
    if (this.inCell) {
      // A cell can't hold a table: keep its text, one line per row.
      for (const row of built.rows) {
        const text = row.cells.filter((c) => !c.covered).map((c) => c.blocks.map((b) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "")).join(" ")).join("  ");
        if (text.trim()) this.add({ id: createId("b_"), type: "paragraph", runs: [{ text }], ...(style.align && { align: style.align }) });
      }
      return;
    }
    this.add(built);
  }
}

function trimEnd(runs: Run[]): Run[] {
  const out = runs.slice();
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const text = last.text.replace(/[ \n]+$/, "");
    if (text === "") out.pop();
    else {
      out[out.length - 1] = { ...last, text };
      break;
    }
  }
  return out;
}

/** The marker a `list-style-type` (or an `ol`'s `type`) names, for a list of that kind. */
function listMarker(list: "bullet" | "ordered", cssValue: string | undefined, typeAttr: string | undefined): ListMarker | undefined {
  const named = (cssValue ?? "").toLowerCase().split(/\s+/).find((word) => word in MARKER_NAMES);
  const found = named ? MARKER_NAMES[named] : typeAttr ? TYPE_ATTRIBUTE[typeAttr] : undefined;
  return found && (list === "bullet" ? BULLET_MARKERS : NUMBER_MARKERS).includes(found as never) ? found : undefined;
}

const MARKER_NAMES: Record<string, ListMarker> = {
  decimal: "decimal",
  "lower-alpha": "lower-alpha",
  "lower-latin": "lower-alpha",
  "upper-alpha": "upper-alpha",
  "upper-latin": "upper-alpha",
  "lower-roman": "lower-roman",
  "upper-roman": "upper-roman",
  disc: "disc",
  circle: "circle",
  square: "square",
};
const TYPE_ATTRIBUTE: Record<string, ListMarker> = { "1": "decimal", a: "lower-alpha", A: "upper-alpha", i: "lower-roman", I: "upper-roman" };

/** Drops the start number of a numbered item that the count would have reached anyway, so only restarts and other starts stay. */
export function withoutNaturalStarts(blocks: Block[]): Block[] {
  const counters: number[] = [];
  return blocks.map((block) => {
    if (block.type === "table") {
      counters.length = 0;
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: withoutNaturalStarts(cell.blocks as Block[]) as CellBlock[] })) })) };
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
    counters[block.depth] = block.start ?? natural;
    if (block.start === natural) {
      const { start: _start, ...rest } = block;
      return rest;
    }
    return block;
  });
}

function textBlock(kind: Kind, runs: Run[], align: Align | undefined, indent?: number): TextBlock {
  const id = createId("b_");
  // A list item's place is its list's; a paragraph, heading or quote keeps the indent it was copied with.
  const common = { id, runs, ...(align && { align }), ...(indent && kind.type !== "list_item" && { format: { indentLeft: Math.round(indent * 100) / 100 } }) };
  switch (kind.type) {
    case "heading": return { ...common, type: "heading", level: kind.level };
    case "quote": return { ...common, type: "quote" };
    case "title": return { ...common, type: "title" };
    case "subtitle": return { ...common, type: "subtitle" };
    case "list_item": {
      // A marker the list would show anyway isn't worth keeping.
      const marker = kind.marker && kind.marker !== defaultMarker(kind.list, kind.depth) ? kind.marker : undefined;
      return { ...common, type: "list_item", list: kind.list, depth: kind.depth, ...(marker && { marker }), ...(kind.start !== undefined && kind.list === "ordered" && { start: kind.start }) };
    }
    default: return { ...common, type: "paragraph" };
  }
}

const emptyParagraph = (): ParagraphBlock => ({ id: createId("b_"), type: "paragraph", runs: [] });

/** The weight of a width for sizing columns: pixels, or percent, whichever the markup used. */
function widthWeight(value: string | undefined): { amount: number; percent: boolean } | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const percent = /^([\d.]+)%$/.exec(v);
  if (percent) return { amount: parseFloat(percent[1]!), percent: true };
  const pt = parseLengthPt(/^[\d.]+$/.test(v) ? `${v}px` : v);
  return pt ? { amount: (pt * 4) / 3, percent: false } : null;
}

function descendants(el: HElement, tags: Set<string>, stopAt: Set<string>, out: HElement[] = []): HElement[] {
  for (const child of el.children) {
    if (child.kind !== "el") continue;
    if (tags.has(child.tag)) out.push(child);
    else if (!stopAt.has(child.tag)) descendants(child, tags, stopAt, out);
  }
  return out;
}

/** Reads an HTML table into the document's table model, spans and all. Null if it has no cells. */
function buildTable(el: HElement, rules: readonly Rule[], options: Required<ImportOptions>, tableCss: Declarations): TableBlock | null {
  const importer = new Importer(rules, options, true);
  const decl = (node: HElement): Declarations => (importer as unknown as { declarations(e: HElement): Declarations }).declarations(node);

  const rowEls = descendants(el, new Set(["tr"]), new Set(["table"])).filter((tr) => !("hidden" in tr.attrs) && decl(tr).display?.trim() !== "none");
  const rowCount = Math.min(rowEls.length, MAX_TABLE_ROWS);
  if (rowCount === 0) return null;

  interface Placed { el: HElement; row: number; col: number; rowSpan: number; colSpan: number }
  const occupied: boolean[][] = Array.from({ length: rowCount }, () => []);
  const placed: Placed[] = [];
  let columnCount = 0;

  rowEls.slice(0, rowCount).forEach((tr, r) => {
    let c = 0;
    for (const cell of descendants(tr, new Set(["td", "th"]), new Set(["table", "tr"]))) {
      while (occupied[r]![c]) c++;
      if (c >= MAX_TABLE_COLUMNS) break;
      const attr = (name: string) => Math.max(1, Math.min(MAX_SPAN, parseInt(cell.attrs[name] ?? "1", 10) || 1));
      const rowSpan = Math.min(attr("rowspan"), rowCount - r);
      const colSpan = Math.min(attr("colspan"), MAX_TABLE_COLUMNS - c);
      for (let rr = r; rr < r + rowSpan; rr++) for (let cc = c; cc < c + colSpan; cc++) occupied[rr]![cc] = true;
      placed.push({ el: cell, row: r, col: c, rowSpan, colSpan });
      columnCount = Math.max(columnCount, c + colSpan);
      c += colSpan;
    }
  });
  if (placed.length === 0 || columnCount === 0) return null;

  const grid: (TableCell | null)[][] = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => null));
  const anyBorder = { value: false };
  for (const p of placed) {
    const css = decl(p.el);
    const sub = new Importer(rules, options, true);
    const base: Style = { marks: {}, white: "normal", align: alignOf(css["text-align"] ?? p.el.attrs.align) };
    // Cell content: the cell's own style, then its children.
    const cellStyle = (sub as unknown as { styleFor(e: HElement, s: Style, c: Declarations): Style }).styleFor(p.el, base, css);
    for (const child of p.el.children) sub.walk(child, cellStyle);
    (sub as unknown as { flush(): boolean }).flush();
    const blocks = sub.blocks.filter((b): b is CellBlock => b.type !== "table" && b.type !== "toc" && b.type !== "page_break");
    // A lone empty trailing paragraph from a trailing <br> is noise.
    while (blocks.length > 1 && blocks[blocks.length - 1]!.type === "paragraph" && (blocks[blocks.length - 1] as ParagraphBlock).runs.length === 0) blocks.pop();

    const cell: TableCell = { id: createId("c_"), blocks: blocks.length > 0 ? blocks : [emptyParagraph()] };
    const shade = backgroundOf(css) ?? parseColor(p.el.attrs.bgcolor);
    if (shade && luminance(shade) < 0.97 && luminance(shade) > 0.05) cell.shade = shade;
    const valign = (css["vertical-align"] ?? p.el.attrs.valign ?? "").trim().toLowerCase();
    if (valign === "middle" || valign === "center") cell.vAlign = "middle";
    else if (valign === "bottom") cell.vAlign = "bottom";
    if (p.rowSpan > 1) cell.rowSpan = p.rowSpan;
    if (p.colSpan > 1) cell.colSpan = p.colSpan;
    for (const key of Object.keys(css)) {
      if (key.startsWith("border") && !/^(none|0|0px|hidden)$/i.test(css[key]!.trim().split(/\s+/)[0] ?? "")) anyBorder.value = true;
    }
    grid[p.row]![p.col] = cell;
    for (let rr = p.row; rr < p.row + p.rowSpan; rr++) {
      for (let cc = p.col; cc < p.col + p.colSpan; cc++) {
        if (rr !== p.row || cc !== p.col) grid[rr]![cc] = { id: createId("c_"), blocks: [], covered: true };
      }
    }
  }

  const rows: TableRow[] = grid.map((line, r) => {
    const css = decl(rowEls[r]!);
    const row: TableRow = { id: createId("r_"), cells: line.map((cell) => cell ?? { id: createId("c_"), blocks: [emptyParagraph()] }) };
    const pt = parseLengthPt(css.height ?? (rowEls[r]!.attrs.height ? `${rowEls[r]!.attrs.height}px` : undefined));
    if (pt && pt >= 6 && pt <= 2000) row.height = Math.round(pt * 2) / 2;
    return row;
  });

  // Column widths: from <col> elements, else from the first row's cells.
  const cols = descendants(el, new Set(["col"]), new Set(["table"]));
  const weights: ({ amount: number; percent: boolean } | null)[] = Array.from({ length: columnCount }, (): { amount: number; percent: boolean } | null => null);
  let at = 0;
  for (const col of cols) {
    const span = Math.max(1, parseInt(col.attrs.span ?? "1", 10) || 1);
    const w = widthWeight(decl(col).width ?? col.attrs.width);
    for (let k = 0; k < span && at < columnCount; k++) weights[at++] = w;
  }
  if (!weights.some((w) => w !== null)) {
    for (const p of placed) {
      if (p.row === 0 && p.colSpan === 1) weights[p.col] = widthWeight(decl(p.el).width ?? p.el.attrs.width);
    }
  }
  const percent = weights.some((w) => w?.percent);
  const known = weights.filter((w): w is { amount: number; percent: boolean } => !!w && w.percent === percent);
  const average = known.length > 0 ? known.reduce((sum, w) => sum + w.amount, 0) / known.length : 1;
  const columns = normalizeColumns(weights.map((w) => (w && w.percent === percent && w.amount > 0 ? w.amount : average)));

  // The first row is a header if it holds only <th> cells, or the table has a <thead>.
  const firstRowCells = placed.filter((p) => p.row === 0);
  const hasHead = descendants(el, new Set(["thead"]), new Set(["table"])).length > 0;
  const headerRow = firstRowCells.length > 0 && (firstRowCells.every((p) => p.el.tag === "th") || (hasHead && rowCount > 1));

  const border = (tableCss["border-style"] ?? tableCss.border ?? "").trim().toLowerCase();
  const noBorders = !anyBorder.value && (el.attrs.border === "0" || /^(none|0|hidden)/.test(border) || (el.attrs.border === undefined && !border));
  const block: TableBlock = {
    id: createId("b_"),
    type: "table",
    rows,
    columns,
    ...(headerRow && { headerRow: true }),
    ...(noBorders && el.attrs.border === "0" && { borders: "none" as const }),
  };
  return checkGrid(block) ? null : block;
}

/**
 * Reads HTML from the clipboard into blocks. Handles what Google Docs, Word, Excel and web pages
 * actually put there: inline styles and `<style>` classes, Word's list markup, nested lists, tables with
 * merged cells, links, images, preformatted text and line breaks. Only a fixed set of properties is kept
 * (text marks, alignment, structure, link and image addresses); scripts, event handlers and everything
 * else are dropped, so the result is safe to insert.
 */
export function htmlToFragment(html: string, options: ImportOptions = {}): Fragment {
  const resolved: Required<ImportOptions> = {
    defaultFontSize: options.defaultFontSize ?? 11,
    defaultFontFamily: options.defaultFontFamily ?? "Arial",
  };
  const root = parseHtml(html);

  const sheets: string[] = [];
  const collect = (node: HElement) => {
    for (const child of node.children) {
      if (child.kind !== "el") continue;
      if (child.tag === "style") sheets.push(textOf(child));
      else collect(child);
    }
  };
  collect(root);
  const rules = parseStylesheet(sheets.join("\n"));

  const hasBlocks = (node: HElement): boolean =>
    node.children.some((c) => c.kind === "el" && !SKIP.has(c.tag) && (isBlockTag(c.tag) || c.tag === "li" || c.tag === "img" || hasBlocks(c)));
  const importer = new Importer(rules, resolved, false, !hasBlocks(root));
  const start: Style = { marks: {}, white: "normal" };
  for (const child of root.children) importer.walk(child, start);
  (importer as unknown as { flush(): boolean }).flush();

  const blocks = withoutNaturalStarts(tocFromLinks(importer.blocks.slice()));
  const empty = (b: Block) => b.type === "paragraph" && b.runs.every((r) => r.text.trim() === "");
  while (blocks.length > 0 && empty(blocks[0]!)) blocks.shift();
  while (blocks.length > 0 && empty(blocks[blocks.length - 1]!)) blocks.pop();
  return { blocks, unsizedImages: importer.unsized.filter((id) => blocks.some((b) => b.id === id)) };
}
