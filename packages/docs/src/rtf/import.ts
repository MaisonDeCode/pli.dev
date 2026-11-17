import { createId, lookupFont } from "@pli.dev/core";
import { bulletOfLabel, defaultMarker, numberOfLabel } from "../lists";
import { withoutNaturalStarts } from "../html/import";
import type { Align, Block, ListMarker, Marks, Run, TextBlock } from "../model";
import { normalizeRuns } from "../runs";

const MAX_RTF = 8_000_000;
const MAX_BLOCKS = 20_000;
const MAX_DEPTH = 64;

/** The characters Windows-1252 puts where Latin-1 has control codes: what `\'hh` escapes mean for 0x80 to 0x9f. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  /** Half-points. */
  size?: number;
  color?: number;
  font?: number;
  /** Text isn't shown: a group the format says to skip, or one that holds a table of fonts or colours. */
  skip: boolean;
  /** How many characters follow a `\u` escape as a stand-in for old readers. */
  uc: number;
}

interface Paragraph {
  align?: Align;
  /** Set by `\ls`: this paragraph is a list item. */
  list: boolean;
  depth: number;
  indent?: number;
}

/** Groups that hold settings or tables, not text. */
const SKIPPED = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "expandedcolortbl", "rsidtbl", "generator", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "fldinst", "private", "object", "falt", "panose"]);

/**
 * Reads RTF (what Pages, TextEdit, Notes and many Word copies put on the clipboard when they offer no HTML) into
 * blocks: paragraphs and list items with bold, italic, underline, strike, size, colour and font, and alignment.
 * Styles' names, pictures and tables are not read. Anything it can't read is left out, never an error.
 */
export function rtfToBlocks(rtf: string): Block[] {
  if (rtf.length > MAX_RTF || !/^\s*\{\\rtf/.test(rtf)) return [];
  const fonts = new Map<number, string>();
  const colors: string[] = [];
  const blocks: Block[] = [];

  let style: Style = { bold: false, italic: false, underline: false, strike: false, superscript: false, subscript: false, skip: false, uc: 1 };
  const stack: Style[] = [];
  let paragraph: Paragraph = { list: false, depth: 0 };
  let runs: Run[] = [];
  /** The marker Pages and Word draw before a list item, kept to know its kind and number. */
  let label = "";
  let inLabel = 0;
  let table: "fonts" | "colors" | null = null;
  let tableDepth = 0;
  let fontId = -1;
  let color = { r: -1, g: -1, b: -1 };
  let fontName = "";
  let skipRemaining = 0;

  const marksOf = (): Marks | undefined => {
    const marks: Marks = {};
    if (style.bold) marks.bold = true;
    if (style.italic) marks.italic = true;
    if (style.underline) marks.underline = true;
    if (style.strike) marks.strike = true;
    if (style.superscript) marks.superscript = true;
    if (style.subscript) marks.subscript = true;
    if (style.size !== undefined && style.size !== 22 && style.size > 0) marks.fontSize = style.size / 2;
    const c = style.color !== undefined && style.color > 0 ? colors[style.color] : undefined;
    if (c && c !== "#000000") marks.color = c;
    const family = style.font !== undefined ? fonts.get(style.font) : undefined;
    if (family) marks.fontFamily = family;
    return Object.keys(marks).length > 0 ? marks : undefined;
  };

  const addText = (text: string): void => {
    if (text === "" || style.skip) return;
    if (inLabel > 0) {
      label += text;
      return;
    }
    const marks = marksOf();
    runs.push(marks ? { text, marks } : { text });
  };

  const endParagraph = (): void => {
    if (blocks.length >= MAX_BLOCKS) return;
    const content = normalizeRuns(runs);
    runs = [];
    const shown = label.replace(/[\s\u00a0]+/g, "");
    label = "";
    const base = { id: createId("b_"), runs: content, ...(paragraph.align && { align: paragraph.align }) };
    if (paragraph.list && shown !== "") {
      const numbered = numberOfLabel(shown);
      const depth = Math.min(8, paragraph.depth);
      const marker: ListMarker | undefined = numbered ? numbered.marker : bulletOfLabel(shown);
      blocks.push({
        ...base,
        type: "list_item",
        list: numbered ? "ordered" : "bullet",
        depth,
        ...(marker && marker !== defaultMarker(numbered ? "ordered" : "bullet", depth) && { marker }),
        ...(numbered && { start: numbered.number }),
      } as TextBlock);
      return;
    }
    const indent = paragraph.indent && paragraph.indent > 0 ? Math.round(paragraph.indent / 20 * 100) / 100 : undefined;
    blocks.push({ ...base, type: "paragraph", ...(indent && { format: { indentLeft: indent } }) } as TextBlock);
  };

  const control = (word: string, arg: number | undefined): void => {
    if (table === "fonts" || table === "colors") {
      if (table === "fonts" && word === "f" && arg !== undefined) fontId = arg;
      if (table === "colors") {
        if (word === "red") color.r = arg ?? 0;
        if (word === "green") color.g = arg ?? 0;
        if (word === "blue") color.b = arg ?? 0;
      }
      return;
    }
    switch (word) {
      case "b": style.bold = arg !== 0; break;
      case "i": style.italic = arg !== 0; break;
      case "ul": case "uld": case "uldb": case "ulth": case "ulw": style.underline = arg !== 0; break;
      case "ulnone": style.underline = false; break;
      case "strike": case "striked": style.strike = arg !== 0; break;
      case "super": style.superscript = true; style.subscript = false; break;
      case "sub": style.subscript = true; style.superscript = false; break;
      case "nosupersub": style.superscript = false; style.subscript = false; break;
      case "fs": if (arg !== undefined) style.size = arg; break;
      case "cf": if (arg !== undefined) style.color = arg; break;
      case "f": if (arg !== undefined) style.font = arg; break;
      case "uc": style.uc = arg ?? 1; break;
      case "plain": style = { ...style, bold: false, italic: false, underline: false, strike: false, superscript: false, subscript: false, size: undefined, color: undefined, font: undefined }; break;
      case "pard": paragraph = { list: false, depth: 0 }; break;
      case "qc": paragraph.align = "center"; break;
      case "qr": paragraph.align = "right"; break;
      case "qj": paragraph.align = "justify"; break;
      case "ql": paragraph.align = undefined; break;
      case "ls": paragraph.list = true; break;
      case "ilvl": paragraph.depth = arg ?? 0; break;
      case "li": paragraph.indent = arg; break;
      case "par": endParagraph(); break;
      case "line": addText("\n"); break;
      case "tab": addText("\t"); break;
      case "emspace": case "enspace": case "~": addText("\u00a0"); break;
      case "endash": addText("–"); break;
      case "emdash": addText("—"); break;
      case "lquote": addText("‘"); break;
      case "rquote": addText("’"); break;
      case "ldblquote": addText("“"); break;
      case "rdblquote": addText("”"); break;
      case "bullet": addText("•"); break;
      case "listtext": inLabel = stack.length; break;
      default: break;
    }
  };

  const n = rtf.length;
  let i = 0;
  while (i < n) {
    const ch = rtf[i]!;
    if (ch === "{") {
      if (stack.length >= MAX_DEPTH) return blocks;
      stack.push({ ...style });
      i++;
      // A group that opens with `\*` (an extension) or a name we know holds no text.
      const dest = /^\\\*?\\?([a-z]+)/i.exec(rtf.slice(i, i + 40));
      if (rtf[i] === "\\" && rtf[i + 1] === "*") style.skip = true;
      else if (dest && SKIPPED.has(dest[1]!.toLowerCase())) {
        const name = dest[1]!.toLowerCase();
        if (name === "fonttbl") { table = "fonts"; tableDepth = stack.length; fontId = -1; fontName = ""; }
        else if (name === "colortbl") { table = "colors"; tableDepth = stack.length; color = { r: -1, g: -1, b: -1 }; }
        else style.skip = true;
      }
      continue;
    }
    if (ch === "}") {
      const closing = stack.length;
      if (inLabel === closing) inLabel = 0;
      if (table && closing === tableDepth) {
        if (table === "fonts" && fontId >= 0 && fontName.trim() !== "") fonts.set(fontId, fontName.trim());
        table = null;
      }
      style = stack.pop() ?? style;
      i++;
      if (stack.length === 0 && closing === 1) break;
      continue;
    }
    if (ch === "\\") {
      const next = rtf[i + 1] ?? "";
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        i += 4;
        if (skipRemaining > 0) { skipRemaining--; continue; }
        if (Number.isNaN(code)) continue;
        const text = code >= 0x80 && code <= 0x9f ? CP1252[code - 0x80]! : String.fromCharCode(code);
        if (table === "fonts") fontName += text;
        else addText(text);
        continue;
      }
      if (next === "\n" || next === "\r") {
        i += 2;
        if (next === "\r" && rtf[i] === "\n") i++;
        if (!style.skip && table === null) endParagraph();
        continue;
      }
      if (/[\\{}]/.test(next)) {
        i += 2;
        if (skipRemaining > 0) { skipRemaining--; continue; }
        if (table === "fonts") fontName += next;
        else addText(next);
        continue;
      }
      if (next === "~" || next === "-" || next === "_") {
        i += 2;
        addText(next === "~" ? "\u00a0" : next === "_" ? "‑" : "");
        continue;
      }
      const match = /^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(rtf.slice(i, i + 40));
      if (!match) { i++; continue; }
      i += match[0].length;
      const word = match[1]!;
      const arg = match[2] !== undefined ? Number(match[2]) : undefined;
      if (word === "u" && arg !== undefined) {
        const code = arg < 0 ? arg + 65536 : arg;
        if (table === "fonts") fontName += String.fromCharCode(code);
        else addText(String.fromCharCode(code));
        skipRemaining = style.uc;
        continue;
      }
      control(word, arg);
      continue;
    }
    if (ch === "\n" || ch === "\r") { i++; continue; }
    // Plain text, up to the next control character.
    let end = i;
    while (end < n && !"\\{}\r\n".includes(rtf[end]!)) end++;
    let text = rtf.slice(i, end);
    i = end;
    while (skipRemaining > 0 && text.length > 0) { text = text.slice(1); skipRemaining--; }
    if (table === "fonts") {
      // A font entry is `\f0\fnil\fcharset0 Name;`. The name runs to the semicolon.
      const semicolon = text.indexOf(";");
      fontName += semicolon >= 0 ? text.slice(0, semicolon) : text;
      if (semicolon >= 0 && fontId >= 0 && fontName.trim() !== "") {
        fonts.set(fontId, fontName.trim());
        fontName = "";
      }
    } else if (table === "colors") {
      for (const part of text) {
        if (part === ";") {
          if (color.r >= 0) colors.push(`#${[color.r, color.g, color.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`);
          else colors.push("");
          color = { r: -1, g: -1, b: -1 };
        }
      }
    } else addText(text);
  }
  if (runs.length > 0 || label !== "") endParagraph();
  return withoutNaturalStarts(tidy(blocks));
}

/**
 * Font names as the font book shows them: "HelveticaNeue-Bold" is Helvetica Neue, "ArialMT" is Arial. A name the font
 * catalogue knows is written the way the catalogue does; others are split at the humps of their camel case.
 */
function familyOf(name: string): string {
  const known = lookupFont(name);
  if (known) return known.family;
  const base = name.split("-")[0]!;
  const spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2");
  return lookupFont(spaced)?.family ?? spaced;
}

/** A last blank paragraph that only ends the text isn't kept, and font names are tidied. */
function tidy(blocks: Block[]): Block[] {
  const out = blocks.map((b) => {
    if (!("runs" in b)) return b;
    return { ...b, runs: b.runs.map((r) => (r.marks?.fontFamily ? { ...r, marks: { ...r.marks, fontFamily: familyOf(r.marks.fontFamily) } } : r)) } as Block;
  });
  while (out.length > 1) {
    const last = out[out.length - 1]!;
    if (last.type === "paragraph" && last.runs.length === 0) out.pop();
    else break;
  }
  return out;
}
