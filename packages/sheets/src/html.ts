import type { Border, BorderStyle, CellBorders, CellStyle, Scalar } from "./model";
import { readCfMarks, type CfMark } from "./cfpaste";
import { fromMsoNumberFormat, toMsoNumberFormat } from "./msoformat";

/*
 * Spreadsheets put an HTML table on the clipboard beside the plain text: Excel with its styles in a <style> block and
 * classes on the cells, Google Sheets with inline styles, a browser with whatever the page had. This reads such a table
 * into cells with the look they had (fills, fonts, alignment, borders, merged cells) and writes one back out.
 */

export interface HtmlCell {
  /** What the cell shows. */
  text: string;
  style: CellStyle;
  colspan: number;
  rowspan: number;
  /** A number or other value the source gave exactly, where the text may be rounded by its format. */
  value?: Scalar;
  /** A number format the source named, such as Google Sheets' `0.0%`. */
  format?: string;
  /** Excel's `mso-number-format`, as a Pli number format: what the cell is shown with, which is trusted whatever the text says. */
  excelFormat?: string;
  /** Excel's Text format (`mso-number-format:"\@"`): the cell holds text, whatever it looks like. */
  textFormat?: true;
  /** Where the first link in the cell goes. */
  link?: string;
  /** A picture in the cell, as a `data:` URI, and what it says it shows. */
  picture?: { src: string; alt?: string };
  /**
   * The formula the source gave: Excel's `x:fmla` (A1 style, as it reads in the source workbook, which doesn't say where
   * that was) or Google Sheets' `data-sheets-formula` (R1C1 style, relative to the cell, so it needs no source). `array`
   * is the range an Excel array formula fills.
   */
  formula?: { text: string; r1c1: boolean; array?: string };
  /** The width the cell (or its column) was given, in pixels, and the height. */
  width?: number;
  height?: number;
  /** The `background-image` of a cell that has an icon or a bar drawn in it (what Pli's copy writes for a conditional format). */
  background?: string;
}

/** A table of Pli's own that was copied: where it sits in the HTML table and what makes it the table it was. */
export interface HtmlTableMark {
  name: string;
  /** Zero-based row and column of its top left cell in the HTML table, and how many rows and columns it covers. */
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** The names of its columns, in order. */
  columns: string[];
  style?: string;
  totals?: true;
  headerRow?: false;
  bandedRows?: false;
  bandedColumns?: true;
  firstColumn?: true;
  lastColumn?: true;
  filterButtons?: false;
  calculated?: Record<string, string>;
}

export interface HtmlTable {
  /** Rows of cells as written; a cell with a span is one entry and covers the positions its neighbours leave out. */
  rows: HtmlCell[][];
  /** The widths the `<col>` elements gave, in pixels, by column (a hole where none did). */
  cols?: (number | undefined)[];
  /** The heights the rows gave, in pixels, by row. */
  heights?: (number | undefined)[];
  /** Tables of Pli's own that the HTML was copied from (`data-pli-tables`). */
  tables?: HtmlTableMark[];
  /** The data bars and icon sets of Pli's own that covered the cells (`data-pli-cf`). */
  cf?: CfMark[];
}

// ================= reading =================

// The Latin-1 letters and signs (Excel writes some of them as names), by code from 160.
const LATIN1 = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
const ENTITIES: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCharCode(160 + i)])), amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", copy: "©", reg: "®", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", plusmn: "±", times: "×", divide: "÷", hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  maroon: "#800000", navy: "#000080", orange: "#ffa500", purple: "#800080", teal: "#008080", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff",
  magenta: "#ff00ff", olive: "#808000", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
};

/** `#rrggbb` from a CSS colour, or null for none, transparent or the system's text colour. */
export function cssColor(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{6})$/.exec(t))) return "#" + m[1];
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t))) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  if ((m = /^rgba?\(\s*(\d+(?:\.\d+)?)(%?)[\s,]+(\d+(?:\.\d+)?)(%?)[\s,]+(\d+(?:\.\d+)?)(%?)(?:[\s,/]+(\d*\.?\d+)(%?))?\s*\)$/.exec(t))) {
    if (m[7] !== undefined && Number(m[7]) * (m[8] ? 0.01 : 1) < 0.05) return null;
    const ch = (v: string, pct: string) => Math.max(0, Math.min(255, Math.round(pct ? (Number(v) * 255) / 100 : Number(v))));
    return "#" + [ch(m[1]!, m[2]!), ch(m[3]!, m[4]!), ch(m[5]!, m[6]!)].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  return NAMED_COLORS[t] ?? null;
}

/** The first colour in a value such as `#fff url(x.png) no-repeat`. */
function firstColor(value: string): string | null {
  const tokens = value.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,6}\b|[a-zA-Z]+/g) ?? [];
  for (const t of tokens) {
    const c = cssColor(t);
    if (c) return c;
  }
  return null;
}

/** The declarations of a `style` attribute or a rule's body, by lowercase property. */
function declarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let from = 0;
  let quote = "";
  const take = (end: number) => {
    const part = text.slice(from, end);
    const colon = part.indexOf(":");
    if (colon > 0) out[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).replace(/!important/i, "").trim();
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    // A backslash escapes the next character (Excel writes `\;` inside a number format), and a quoted string runs to its closing quote.
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      take(i);
      from = i + 1;
    }
  }
  take(text.length);
  return out;
}

/** The rules of the `<style>` blocks of a page: `.xl65 { … }`, `td { … }`, `td.x { … }`, by selector. */
function styleSheet(html: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = block[1]!.replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const decl = declarations(rule[2]!);
      for (const selector of rule[1]!.split(",")) {
        const key = selector.trim().toLowerCase();
        if (key) rules.set(key, { ...rules.get(key), ...decl });
      }
    }
  }
  return rules;
}

const LINE_STYLES: Record<string, BorderStyle | undefined> = { solid: "thin", dashed: "dashed", dotted: "dotted", double: "double", groove: "thin", ridge: "thin", inset: "thin", outset: "thin" };

/** A border from a CSS shorthand such as `1px solid #000` or `.5pt solid windowtext`; null for none. */
function cssBorder(value: string | undefined, styleOnly?: string, widthOnly?: string, colorOnly?: string): Border | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" && !styleOnly) return null;
  let style: string | undefined = styleOnly?.toLowerCase();
  let widthText: string | undefined = widthOnly;
  let color: string | null = cssColor(colorOnly);
  for (const token of v.match(/rgba?\([^)]*\)|#[0-9a-f]{3,6}\b|[^\s]+/g) ?? []) {
    if (/^(none|hidden)$/.test(token)) return null;
    if (LINE_STYLES[token] !== undefined || token === "none") style = token;
    else if (/^[\d.]+(px|pt|em|mm|cm)?$/.test(token)) widthText = token;
    else if (/^(thin|medium|thick)$/.test(token)) widthText = token;
    else {
      const c = cssColor(token);
      if (c) color = c;
    }
  }
  const line = style ? LINE_STYLES[style] : undefined;
  if (!line) return null;
  let px = 1;
  const w = /^([\d.]+)(px|pt)?$/.exec(widthText ?? "");
  if (w) px = Number(w[1]) * (w[2] === "pt" ? 4 / 3 : 1);
  else if (widthText === "medium") px = 2;
  else if (widthText === "thick") px = 3;
  if (px <= 0) return null;
  // Excel's lines are .5pt (thin), 1.5pt (medium) and 2pt (thick); Google Sheets' are 1, 2 and 3 pixels.
  const kind: BorderStyle = line === "thin" ? (px >= 2.5 ? "thick" : px >= 1.5 ? "medium" : "thin") : line;
  return { style: kind, ...(color && color !== "#000000" ? { color } : {}) };
}

const DEFAULT_FAMILIES = new Set(["calibri", "arial", "helvetica", "sans-serif", "roboto", "segoe ui", "system-ui", "-apple-system", "verdana", "tahoma", "serif"]);

/** What CSS declarations say about a cell's look. */
function cellStyleOf(d: Record<string, string>): CellStyle {
  const s: CellStyle = {};
  const color = cssColor(d["color"]);
  if (color && color !== "#000000") s.color = color;
  const bg = d["background-color"] ?? d["background"];
  const fill = bg === undefined ? null : d["background-color"] !== undefined ? cssColor(bg) : firstColor(bg);
  if (fill && fill !== "#ffffff") s.fill = fill;
  const weight = (d["font-weight"] ?? "").toLowerCase();
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) s.bold = true;
  if (/italic|oblique/i.test(d["font-style"] ?? "")) s.italic = true;
  const deco = `${d["text-decoration"] ?? ""} ${d["text-decoration-line"] ?? ""}`.toLowerCase();
  if (deco.includes("underline")) s.underline = true;
  if (deco.includes("line-through")) s.strike = true;
  const align = (d["text-align"] ?? "").toLowerCase();
  if (align === "left" || align === "center" || align === "right") s.align = align;
  const vertical = (d["vertical-align"] ?? "").toLowerCase();
  if (vertical === "top") s.vAlign = "top";
  else if (vertical === "middle" || vertical === "center") s.vAlign = "middle";
  const size = /^([\d.]+)(pt|px)$/.exec((d["font-size"] ?? "").trim().toLowerCase());
  if (size) {
    const pt = Math.round((size[2] === "px" ? Number(size[1]) * 0.75 : Number(size[1])) * 2) / 2;
    if (pt >= 1 && pt <= 400 && pt !== 10 && pt !== 11) s.fontSize = pt;
  }
  const family = (d["font-family"] ?? "").split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (family && !DEFAULT_FAMILIES.has(family.toLowerCase())) s.fontFamily = family;
  if (/^(normal|pre-wrap|pre-line|break-spaces)$/i.test(d["white-space"] ?? "")) s.wrap = true;
  const borders: CellBorders = {};
  const all = cssBorder(d["border"], d["border-style"], d["border-width"], d["border-color"]);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const line = d[`border-${side}`] !== undefined || d[`border-${side}-style`] !== undefined ? cssBorder(d[`border-${side}`], d[`border-${side}-style`] ?? d["border-style"], d[`border-${side}-width`] ?? d["border-width"], d[`border-${side}-color`] ?? d["border-color"]) : all;
    if (line) borders[side] = line;
  }
  for (const [which, key] of [["up", "diagonalUp"], ["down", "diagonalDown"]] as const) {
    const line = diagonalOf(d, which);
    if (line) borders[key] = line;
  }
  if (Object.keys(borders).length) s.border = borders;
  return s;
}

/** A CSS length in pixels (`143`, `50px`, `107pt`, `1in`), or undefined for anything else (percentages, `auto`). */
export function cssLength(text: string | undefined): number | undefined {
  const m = /^\s*(\d*\.?\d+)\s*(px|pt|in|cm|mm|pc)?\s*$/i.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "px").toLowerCase();
  const px = unit === "pt" ? (n * 4) / 3 : unit === "in" ? n * 96 : unit === "cm" ? (n * 96) / 2.54 : unit === "mm" ? (n * 96) / 25.4 : unit === "pc" ? n * 16 : n;
  return Number.isFinite(px) && px > 0 && px < 100000 ? Math.round(px * 100) / 100 : undefined;
}

/** The line a diagonal border draws, from Excel's `mso-diagonal-*` or (when only the picture is left) Pli's own gradient. */
function diagonalOf(d: Record<string, string>, which: "up" | "down"): Border | null {
  const own = d[`mso-diagonal-${which}`];
  if (own !== undefined) return cssBorder(own);
  const image = d["background-image"] ?? "";
  const direction = which === "down" ? "to top right" : "to bottom right";
  for (const layer of image.matchAll(/linear-gradient\(\s*([^,]+),\s*transparent calc\(50% - ([\d.]+)px\),\s*(#[0-9a-f]{6}) calc/gi)) {
    if (layer[1]!.trim().toLowerCase() !== direction) continue;
    const thick = Number(layer[2]) * 2;
    const color = layer[3]!.toLowerCase();
    return { style: thick >= 2.8 ? "thick" : thick >= 1.8 ? "medium" : "thin", ...(color !== "#000000" ? { color } : {}) };
  }
  return null;
}

const SKIP_CELLS = 5000 * 200;

/** Reads the first table of an HTML fragment, or null when there is none (or it holds nothing). */
export function parseHtmlTable(html: string): HtmlTable | null {
  const start = html.search(/<table[\s>]/i);
  if (start < 0) return null;
  const rules = styleSheet(html);
  // Google Sheets' stylesheet draws the grid (`td {border: 1px solid #cccccc}`); only the borders a cell's own style gives are borders.
  const tdRule = { ...rules.get("td") };
  if (/google-sheets-html-origin|data-sheets-root|data-sheets-value/i.test(html)) for (const k of Object.keys(tdRule)) if (k.startsWith("border")) delete tdRule[k];
  const rows: HtmlCell[][] = [];
  let row: HtmlCell[] | null = null;
  let cell: { html: HtmlCell; text: string; skipText: number; fresh: boolean; flags: { b: boolean; i: boolean; u: boolean; s: boolean }; open: { b: number; i: number; u: number; s: number }; pre: boolean; spans: boolean[]; spaces: number } | null = null;
  let depth = 0;
  let rowDecl: Record<string, string> = {};
  let tableDecl: Record<string, string> = {};
  let count = 0;
  const cols: (number | undefined)[] = [];
  const heights: (number | undefined)[] = [];
  let marks: HtmlTableMark[] | undefined;
  let cf: CfMark[] | undefined;
  let rowHeight: number | undefined;
  let rowHidden = false;

  const finishCell = () => {
    if (!cell || !row) return;
    // Line breaks in the markup are spaces; the ones that were <br> (kept as \u0001) are line breaks.
    const t = (cell.pre ? cell.text : cell.text.replace(/[ \t\r\n\u00a0]+/g, " ")).replace(/ ?\u0001 ?/g, "\n");
    // Spaces Excel marks as meant (`<span style='mso-spacerun:yes'>`) were kept apart from the markup's own.
    cell.html.text = t.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, "").replace(/\u0002/g, " ");
    if (cell.flags.b) cell.html.style.bold = true;
    if (cell.flags.i) cell.html.style.italic = true;
    if (cell.flags.u) cell.html.style.underline = true;
    if (cell.flags.s) cell.html.style.strike = true;
    row.push(cell.html);
    cell = null;
  };
  const finishRow = () => {
    finishCell();
    // Excel (on Windows) ends a table with a hidden row of empty cells that only fixes the columns' widths: it is no row.
    if (row && rowHidden && row.every((c) => c.text === "" && c.value === undefined && c.picture === undefined && c.link === undefined)) row = null;
    if (row && row.length) {
      // A row's height is what it says, or else the tallest cell that stands on that row alone.
      const own = rowHeight ?? row.reduce<number | undefined>((h, c) => (c.rowspan === 1 && c.height !== undefined && (h === undefined || c.height > h) ? c.height : h), undefined);
      heights[rows.length] = own;
      rows.push(row);
    }
    row = null;
  };

  const tag = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  tag.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    if (m[0]!.startsWith("<!--")) continue;
    if (m[3] !== undefined) {
      if (cell && cell.skipText === 0 && depth === 1) {
        const text = decode(m[3]);
        const nonBlank = /[^\s ]/.test(text);
        if (nonBlank && cell.fresh) {
          cell.fresh = false;
          if (cell.open.b > 0) cell.flags.b = true;
          if (cell.open.i > 0) cell.flags.i = true;
          if (cell.open.u > 0) cell.flags.u = true;
          if (cell.open.s > 0) cell.flags.s = true;
        }
        cell.text += cell.spaces > 0 ? text.replace(/ /g, "\u0002") : text;
      }
      continue;
    }
    const name = m[1]!.toLowerCase();
    const closing = m[0]!.startsWith("</");
    const attrText = m[2] ?? "";
    if (name === "style" || name === "script") {
      if (!closing) {
        const end = html.toLowerCase().indexOf(`</${name}`, tag.lastIndex);
        tag.lastIndex = end < 0 ? html.length : end;
      }
      continue;
    }
    if (name === "table") {
      if (closing) {
        if (depth === 1) {
          finishRow();
          break;
        }
        depth = Math.max(0, depth - 1);
      } else {
        depth++;
        if (depth === 1) {
          const a = attributes(attrText);
          tableDecl = { ...rules.get("table"), ...classRules(rules, "table", a["class"]), ...declarations(a["style"] ?? "") };
          marks = marksOf(a["data-pli-tables"]);
          cf = readCfMarks(a["data-pli-cf"]);
        }
      }
      continue;
    }
    if (depth !== 1) continue; // a table inside a cell is left out
    if (name === "col" && !closing) {
      // The width of the column or columns (`span`) it stands for.
      const a = attributes(attrText);
      const decl = { ...rules.get("col"), ...classRules(rules, "col", a["class"]), ...declarations(a["style"] ?? "") };
      const width = cssLength(a["width"]) ?? cssLength(decl["width"]);
      for (let k = 0; k < span(a["span"]) && cols.length < 16384; k++) cols.push(width);
      continue;
    }
    if (name === "tr") {
      finishRow();
      if (!closing) {
        row = [];
        const a = attributes(attrText);
        rowDecl = { ...rules.get("tr"), ...classRules(rules, "tr", a["class"]), ...declarations(a["style"] ?? "") };
        rowHeight = cssLength(a["height"]) ?? cssLength(rowDecl["height"]);
        rowHidden = /^none$/i.test(rowDecl["display"] ?? "");
      }
    } else if (name === "td" || name === "th") {
      if (!closing) {
        if (!row) row = [];
        finishCell();
        if (++count > SKIP_CELLS) return null;
        const a = attributes(attrText);
        const decl: Record<string, string> = { ...tableDecl, ...rowDecl, ...tdRule, ...(name === "th" ? { "font-weight": "bold", "text-align": "center", ...rules.get("th") } : {}), ...classRules(rules, name, a["class"]), ...declarations(a["style"] ?? "") };
        if (a["bgcolor"] && decl["background-color"] === undefined) decl["background-color"] = a["bgcolor"];
        if (a["align"] && decl["text-align"] === undefined) decl["text-align"] = a["align"];
        if (a["valign"] && decl["vertical-align"] === undefined) decl["vertical-align"] = a["valign"];
        const html: HtmlCell = { text: "", style: cellStyleOf(decl), colspan: span(a["colspan"]), rowspan: span(a["rowspan"]) };
        const value = valueOf(a);
        if (value !== undefined) html.value = value;
        else if (a["x:str"] !== undefined) {
          // Excel's mark for text: its value (after an apostrophe, when the text looks like something else) is the text exactly.
          const raw = a["x:str"];
          if (raw !== "") html.value = raw.startsWith("'") ? raw.slice(1) : raw;
          else html.textFormat = true;
        }
        const format = formatOf(a);
        if (format) html.format = format;
        const mso = fromMsoNumberFormat(decl["mso-number-format"]);
        if (mso === "@") html.textFormat = true;
        else if (mso && mso !== "General") html.excelFormat = mso;
        const formula = formulaOf(a);
        if (formula) html.formula = formula;
        const picture = decl["background-image"] ?? decl["background"];
        if (picture && /data:image\/svg\+xml|linear-gradient\(90deg/.test(picture)) html.background = picture;
        const width = cssLength(a["width"]) ?? cssLength(decl["width"]);
        if (width !== undefined) html.width = width;
        const height = cssLength(a["height"]) ?? cssLength(decl["height"]);
        if (height !== undefined) html.height = height;
        cell = { html, text: "", skipText: 0, fresh: true, flags: { b: false, i: false, u: false, s: false }, open: { b: 0, i: 0, u: 0, s: 0 }, pre: /^pre/i.test(decl["white-space"] ?? ""), spans: [], spaces: 0 };
      } else finishCell();
    } else if (cell) {
      if (name === "a" && !closing && cell.html.link === undefined) {
        const href = hrefOf(attributes(attrText)["href"]);
        if (href) cell.html.link = href;
      } else if (name === "img" && !closing && cell.html.picture === undefined) {
        const a = attributes(attrText);
        if (a["src"] && /^data:image\/(?:png|jpeg|gif);base64,/i.test(a["src"].trim())) cell.html.picture = { src: a["src"].trim(), ...(a["alt"] ? { alt: decode(a["alt"]) } : {}) };
      } else if (name === "br") cell.text += "\u0001";
      else if ((name === "p" || name === "div" || name === "li") && !closing && cell.text !== "" && !cell.text.endsWith("\u0001")) cell.text += "\u0001";
      else if (name === "b" || name === "strong") cell.open.b += closing ? -1 : 1;
      else if (name === "i" || name === "em") cell.open.i += closing ? -1 : 1;
      else if (name === "u") cell.open.u += closing ? -1 : 1;
      else if (name === "s" || name === "strike" || name === "del") cell.open.s += closing ? -1 : 1;
      else if (name === "span" || name === "font") {
        if (name === "span") {
          if (closing) {
            if (cell.spans.pop()) cell.spaces--;
          } else {
            const kept = /mso-spacerun\s*:\s*yes/i.test(attributes(attrText)["style"] ?? "");
            cell.spans.push(kept);
            if (kept) cell.spaces++;
          }
        }
        if (!closing && cell.fresh) {
          const a = attributes(attrText);
          // (Excel keeps the look of a run of rich text in a class: `<font class=font5>`.)
          const inner: Record<string, string> = { ...classRules(rules, name, a["class"]), ...declarations(a["style"] ?? ""), ...(a["color"] ? { color: a["color"] } : {}) };
          const color = cssColor(inner["color"]);
          if (color && color !== "#000000" && cell.html.style.color === undefined) cell.html.style.color = color;
          if (/bold|^[6-9]00$/.test(inner["font-weight"] ?? "")) cell.flags.b = true;
        }
      }
    }
  }
  finishRow();
  if (!rows.length) return null;
  return { rows, ...(cols.some((w) => w !== undefined) ? { cols } : {}), ...(heights.some((h) => h !== undefined) ? { heights } : {}), ...(marks?.length ? { tables: marks } : {}), ...(cf?.length ? { cf } : {}) };
}

/** The tables of Pli's own a copy marked (`data-pli-tables`, a JSON list), as far as it holds what it should. */
function marksOf(json: string | undefined): HtmlTableMark[] | undefined {
  if (!json) return undefined;
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const int = (v: unknown, min: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v < 100000 ? v : null);
  const out: HtmlTableMark[] = [];
  for (const raw of list.slice(0, 50)) {
    const t = raw as Record<string, unknown>;
    const row = int(t["row"], 0);
    const col = int(t["col"], 0);
    const nrows = int(t["rows"], 1);
    const ncols = int(t["cols"], 1);
    if (!t || typeof t["name"] !== "string" || row === null || col === null || nrows === null || ncols === null) continue;
    const columns = Array.isArray(t["columns"]) && t["columns"].every((c) => typeof c === "string") ? (t["columns"] as string[]) : [];
    if (columns.length !== ncols) continue;
    const calculated: Record<string, string> = {};
    if (t["calculated"] && typeof t["calculated"] === "object") for (const [k, v] of Object.entries(t["calculated"] as Record<string, unknown>)) if (typeof v === "string" && columns.includes(k)) calculated[k] = v;
    out.push({
      name: t["name"],
      row,
      col,
      rows: nrows,
      cols: ncols,
      columns,
      ...(typeof t["style"] === "string" ? { style: t["style"] } : {}),
      ...(t["totals"] === true ? { totals: true as const } : {}),
      ...(t["headerRow"] === false ? { headerRow: false as const } : {}),
      ...(t["bandedRows"] === false ? { bandedRows: false as const } : {}),
      ...(t["bandedColumns"] === true ? { bandedColumns: true as const } : {}),
      ...(t["firstColumn"] === true ? { firstColumn: true as const } : {}),
      ...(t["lastColumn"] === true ? { lastColumn: true as const } : {}),
      ...(t["filterButtons"] === false ? { filterButtons: false as const } : {}),
      ...(Object.keys(calculated).length ? { calculated } : {}),
    });
  }
  return out;
}

/** A formula the source put on the cell: Excel's `x:fmla` (and `x:fmla-range` for an array) or Google Sheets' `data-sheets-formula`. */
function formulaOf(a: Record<string, string>): HtmlCell["formula"] | undefined {
  const sheets = a["data-sheets-formula"]?.trim();
  if (sheets && sheets.startsWith("=") && sheets.length > 1) return { text: sheets, r1c1: true };
  let excel = a["x:fmla"]?.trim();
  if (!excel) return undefined;
  let array = a["x:fmla-range"]?.trim().replace(/\$/g, "");
  // An old-style array formula is written in braces.
  if (excel.startsWith("{") && excel.endsWith("}")) {
    excel = excel.slice(1, -1).trim();
    array ??= "";
  }
  if (!excel.startsWith("=") || excel.length < 2) return undefined;
  return { text: excel, r1c1: /R\[-?\d+\]|C\[-?\d+\]|\bR\d+C\d*\b/.test(excel), ...(array !== undefined ? { array } : {}) };
}

/** A link's address as written in the markup; Google's redirect (`google.com/url?q=…`) gives the address it stands for. */
function hrefOf(href: string | undefined): string | undefined {
  const h = href?.trim();
  if (!h) return undefined;
  const redirect = /^https?:\/\/(?:www\.)?google\.com\/url\?(.*)$/i.exec(h);
  if (redirect) {
    const q = new URLSearchParams(redirect[1]).get("q");
    if (q) return q;
  }
  return h;
}

function span(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 1000) : 1;
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

function classRules(rules: Map<string, Record<string, string>>, tagName: string, classes: string | undefined): Record<string, string> {
  let out: Record<string, string> = {};
  for (const c of (classes ?? "").split(/\s+/).filter(Boolean)) out = { ...out, ...rules.get(`.${c.toLowerCase()}`), ...rules.get(`${tagName}.${c.toLowerCase()}`) };
  return out;
}

/** An exact value the source gave: Excel's `x:num`, `x:bool`, and Google Sheets' `data-sheets-value`. */
function valueOf(a: Record<string, string>): Scalar | undefined {
  // A bare `x:num` says the cell is a number and that its text is the number.
  if (a["x:num"] !== undefined && a["x:num"] !== "") {
    const n = Number(a["x:num"]);
    if (Number.isFinite(n)) return n;
  }
  if (a["x:bool"] !== undefined) return a["x:bool"].toUpperCase() === "TRUE";
  const sheets = a["data-sheets-value"];
  if (sheets) {
    try {
      const j = JSON.parse(sheets) as Record<string, unknown>;
      if (j["1"] === 3 && typeof j["3"] === "number" && Number.isFinite(j["3"])) return j["3"];
      // Text is text, whatever it looks like (`00123`, `1e3`, `=A1`).
      if (j["1"] === 2 && typeof j["2"] === "string") return j["2"];
      // A boolean is written as `true`/`false` or as 1/0.
      if (j["1"] === 4 && (typeof j["4"] === "boolean" || j["4"] === 1 || j["4"] === 0)) return typeof j["4"] === "boolean" ? j["4"] : j["4"] === 1;
    } catch {
      /* not JSON: the text is used */
    }
  }
  return undefined;
}

function formatOf(a: Record<string, string>): string | undefined {
  const f = a["data-sheets-numberformat"];
  if (!f) return undefined;
  try {
    const j = JSON.parse(f) as Record<string, unknown>;
    return typeof j["2"] === "string" && j["2"] !== "" ? j["2"] : undefined;
  } catch {
    return undefined;
  }
}

// ================= writing =================

const px = (s: BorderStyle) => ({ thin: 1, medium: 2, thick: 3, dashed: 1, dotted: 1, double: 3, hair: 1 })[s];
const cssLine = (s: BorderStyle) => (s === "dashed" ? "dashed" : s === "dotted" || s === "hair" ? "dotted" : s === "double" ? "double" : "solid");

/** CSS for a cell's look, as a `style` attribute's content. */
export function cellCss(s: CellStyle | undefined, fill?: string, ink?: string, bold?: boolean): string {
  const out: string[] = [];
  const color = ink ?? s?.color;
  if (s?.bold || bold) out.push("font-weight:bold");
  if (s?.italic) out.push("font-style:italic");
  const deco = [s?.underline ? "underline" : "", s?.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) out.push(`text-decoration:${deco}`);
  if (color) out.push(`color:${color}`);
  if (s?.fill ?? fill) out.push(`background-color:${fill ?? s?.fill}`);
  if (s?.fontSize) out.push(`font-size:${s.fontSize}pt`);
  if (s?.fontFamily) out.push(`font-family:${s.fontFamily.replace(/[;"<>]/g, "")}`);
  if (s?.align) out.push(`text-align:${s.align}`);
  if (s?.indent) out.push(`padding-${s.align === "right" ? "right" : "left"}:${s.indent * 9}px`);
  if (s?.vAlign) out.push(`vertical-align:${s.vAlign}`);
  if (s?.wrap) out.push("white-space:normal;word-wrap:break-word");
  return out.join(";");
}

/** CSS for borders. */
export function borderCss(b: CellBorders | undefined): string {
  if (!b) return "";
  const out: string[] = [];
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const l = b[side];
    if (l) out.push(`border-${side}:${px(l.style)}px ${cssLine(l.style)} ${l.color ?? "#000000"}`);
  }
  return out.join(";");
}
