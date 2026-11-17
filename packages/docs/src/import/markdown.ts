import { createId } from "@pli.dev/core";
import type { Align, Block, Doc, ListItemBlock, Marks, Run, TableBlock } from "../model";
import { normalizeColumns } from "../grid";
import { normalizeRuns } from "../runs";

export interface MarkdownImportOptions {
  /** The document's title. Without it, the text of the first heading, or "Untitled". */
  title?: string;
  /** Make the first level 1 heading the document's title block (larger than a heading, and not in the table of contents). */
  firstHeadingAsTitle?: boolean;
  /** The size pictures are given when the Markdown doesn't say (`{width=600 height=400}` after the picture does), in pixels. */
  imageSize?: { width: number; height: number };
}

const DEFAULT_IMAGE = { width: 480, height: 270 };

/**
 * Reads Markdown into a document: headings, paragraphs, bold, italic, strikethrough, code, links, bullet and numbered lists
 * (nested by indentation), quotes, fenced code, tables, pictures, and horizontal rules.
 *
 * Three additions make it a way to write a designed document: a line with `[TOC]` is a table of contents, a line with
 * `<!-- pagebreak -->` (or `\pagebreak`) is a page break, and `![alt](src){width=600 height=400}` sets a picture's size in pixels.
 */
export function fromMarkdown(source: string, options: MarkdownImportOptions = {}): Doc {
  const blocks = new Reader(source.replace(/\r\n?/g, "\n"), options.imageSize ?? DEFAULT_IMAGE).read();
  if (options.firstHeadingAsTitle) {
    const first = blocks.findIndex((b) => b.type === "heading" && b.level === 1);
    const found = blocks[first];
    if (found && found.type === "heading") blocks[first] = { id: found.id, type: "title", runs: found.runs, ...(found.align && { align: found.align }) };
  }
  const heading = blocks.find((b) => b.type === "heading" || b.type === "title");
  const named = heading && "runs" in heading ? heading.runs.map((r) => r.text).join("") : "";
  return { id: createId("doc_"), type: "document", title: options.title ?? (named || "Untitled"), blocks };
}

// ---- Inline text ----

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Reads emphasis, code and links in a stretch of text. */
export function inlineMarkdown(text: string, marks: Marks = {}): Run[] {
  const out: Run[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push(Object.keys(marks).length > 0 ? { text: plain, marks: { ...marks } } : { text: plain });
    plain = "";
  };
  const push = (runs: Run[]) => {
    flush();
    out.push(...runs);
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    // A backslash makes the next punctuation character an ordinary one.
    if (c === "\\" && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!|~<>]/.test(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    // Code: the text between matching backticks is taken as it is.
    if (c === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const end = text.indexOf(fence, i + ticks);
      if (end > i + ticks) {
        push([{ text: text.slice(i + ticks, end).replace(/^ (.*) $/, "$1"), marks: { ...marks, code: true } }]);
        i = end + ticks;
        continue;
      }
    }
    // A link: [text](address "title")
    if (c === "[") {
      const close = matching(text, i, "[", "]");
      if (close > 0 && text[close + 1] === "(") {
        const end = matching(text, close + 1, "(", ")");
        if (end > 0) {
          const target = text.slice(close + 2, end).trim().replace(/\s+"[^"]*"$/, "").replace(/^<(.*)>$/, "$1");
          push(inlineMarkdown(text.slice(i + 1, close), { ...marks, link: target }));
          i = end + 1;
          continue;
        }
      }
    }
    // An address in angle brackets.
    if (c === "<") {
      const end = text.indexOf(">", i);
      const inside = end > i ? text.slice(i + 1, end) : "";
      if (/^(https?:\/\/|mailto:)[^\s]+$/.test(inside)) {
        push([{ text: inside, marks: { ...marks, link: inside } }]);
        i = end + 1;
        continue;
      }
    }
    // Strikethrough and strong emphasis, which come in pairs.
    const pair = text.startsWith("~~", i) ? "~~" : text.startsWith("**", i) ? "**" : text.startsWith("__", i) && !isWord(text[i - 1]) ? "__" : null;
    if (pair && !isSpace(text[i + 2])) {
      const end = closer(text, i + 2, pair);
      if (end > 0) {
        const mark: Marks = pair === "~~" ? { strike: true } : { bold: true };
        push(inlineMarkdown(text.slice(i + 2, end), { ...marks, ...mark }));
        i = end + 2;
        continue;
      }
    }
    // Emphasis: *text* or _text_ (but not the underscores inside a word).
    if ((c === "*" || (c === "_" && !isWord(text[i - 1]))) && !isSpace(text[i + 1])) {
      const end = closer(text, i + 1, c);
      if (end > 0) {
        push(inlineMarkdown(text.slice(i + 1, end), { ...marks, italic: true }));
        i = end + 1;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** The place of the bracket that closes the one at `from`, or -1. */
function matching(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** The place of the marker that closes emphasis opened before `from`, or -1. */
function closer(text: string, from: number, marker: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > 0) i = end;
    } else if (text.startsWith(marker, i) && !isSpace(text[i - 1])) {
      // A single marker must not be half of a double one.
      if (marker.length === 1 && (text[i + 1] === marker || text[i - 1] === marker)) continue;
      if (marker === "_" && isWord(text[i + 1])) continue;
      // In `***both***` the strong marker is the last two of the three.
      let at = i;
      if (marker.length === 2 && marker !== "~~") while (text[at + 2] === marker[0]) at++;
      return at;
    }
  }
  return -1;
}

// ---- Blocks ----

const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
    } else if (body[i] === "|") {
      out.push(current.trim());
      current = "";
    } else current += body[i];
  }
  out.push(current.trim());
  return out;
}

function indentOf(line: string): number {
  let width = 0;
  for (const c of line) {
    if (c === " ") width++;
    else if (c === "\t") width += 4;
    else break;
  }
  return width;
}

class Reader {
  private readonly lines: string[];
  private at = 0;
  private readonly blocks: Block[] = [];

  constructor(source: string, private readonly imageSize: { width: number; height: number }) {
    this.lines = source.split("\n");
  }

  read(): Block[] {
    while (this.at < this.lines.length) {
      const line = this.lines[this.at]!;
      if (line.trim() === "") {
        this.at++;
        continue;
      }
      this.block(line);
    }
    return this.blocks;
  }

  private block(line: string): void {
    const trimmed = line.trim();

    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
    if (fence) return this.code(fence[1]!.length, fence[2]!, fence[3]!);

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/.exec(line);
    if (heading) {
      this.at++;
      this.blocks.push({ id: createId("b_"), type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, runs: normalizeRuns(inlineMarkdown(heading[2]!)) });
      return;
    }

    if (/^\[(TOC|toc)\]$/.test(trimmed) || /^\[\[toc\]\]$/i.test(trimmed)) {
      this.at++;
      this.blocks.push({ id: createId("b_"), type: "toc", levels: 3 });
      return;
    }
    if (/^<!--\s*page-?break\s*-->$/i.test(trimmed) || trimmed === "\\pagebreak" || trimmed === "\\newpage") {
      this.at++;
      this.blocks.push({ id: createId("b_"), type: "page_break" });
      return;
    }
    if (RULE.test(line) && !BULLET.test(line)) {
      this.at++;
      this.blocks.push({ id: createId("b_"), type: "divider" });
      return;
    }

    const picture = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(\{[^}]*\})?$/.exec(trimmed);
    if (picture) {
      this.at++;
      const size = { ...this.imageSize };
      for (const match of (picture[3] ?? "").matchAll(/(width|height)\s*=\s*"?(\d+)"?/g)) {
        size[match[1] as "width" | "height"] = Math.min(Number(match[2]), 4000);
      }
      this.blocks.push({ id: createId("b_"), type: "image", src: picture[2]!, ...(picture[1] && { alt: picture[1] }), width: size.width, height: size.height });
      return;
    }

    if (trimmed.startsWith(">")) return this.quote();
    if (BULLET.test(line) || ORDERED.test(line)) return this.list();
    if (trimmed.includes("|") && this.lines[this.at + 1] !== undefined && TABLE_SEPARATOR.test(this.lines[this.at + 1]!) && this.lines[this.at + 1]!.includes("-")) return this.table();
    this.paragraph();
  }

  private code(indent: number, fence: string, language: string): void {
    this.at++;
    const body: string[] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at]!;
      this.at++;
      if (line.trim().startsWith(fence[0]!.repeat(fence.length)) && line.trim().replace(/[`~]/g, "") === "") break;
      body.push(line.slice(Math.min(indent, indentOf(line))));
    }
    const source = body.join("\n");
    this.blocks.push({ id: createId("b_"), type: "code_block", ...(language && { language }), runs: source === "" ? [] : [{ text: source }] });
  }

  private quote(): void {
    let paragraph: string[] = [];
    const emit = () => {
      if (paragraph.length > 0) this.blocks.push({ id: createId("b_"), type: "quote", runs: normalizeRuns(inlineMarkdown(paragraph.join(" "))) });
      paragraph = [];
    };
    while (this.at < this.lines.length && this.lines[this.at]!.trim().startsWith(">")) {
      const text = this.lines[this.at]!.trim().replace(/^>\s?/, "");
      if (text.trim() === "") emit();
      else paragraph.push(text.trim());
      this.at++;
    }
    emit();
  }

  private list(): void {
    // The indents of the items seen so far, outermost first: an item indented past the last one is a level deeper.
    const indents: number[] = [];
    const start: Record<number, number> = {};
    let current: ListItemBlock | null = null;
    let text = "";
    const finish = () => {
      if (current) current.runs = normalizeRuns(inlineMarkdown(text.trim()));
      current = null;
      text = "";
    };

    while (this.at < this.lines.length) {
      const line = this.lines[this.at]!;
      if (line.trim() === "") {
        // A blank line ends the list unless an indented item or line follows.
        const next = this.lines.slice(this.at + 1).find((l) => l.trim() !== "");
        if (next !== undefined && (BULLET.test(next) || ORDERED.test(next)) && indentOf(next) > 0) {
          this.at++;
          continue;
        }
        break;
      }
      const bullet = BULLET.exec(line);
      const ordered = bullet ? null : ORDERED.exec(line);
      const match = bullet ?? ordered;
      if (!match) {
        // Text indented under an item carries on that item.
        if (current && indentOf(line) > 0) {
          text += " " + line.trim();
          this.at++;
          continue;
        }
        if (current && !RULE.test(line) && !/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(line) && !line.includes("|")) {
          text += " " + line.trim();
          this.at++;
          continue;
        }
        break;
      }
      finish();
      const indent = indentOf(match[1]!);
      while (indents.length > 0 && indent < indents[indents.length - 1]!) indents.pop();
      if (indents.length === 0 || indent > indents[indents.length - 1]!) indents.push(indent);
      const depth = Math.min(indents.length - 1, 8);
      const kind = bullet ? "bullet" : "ordered";
      current = { id: createId("b_"), type: "list_item", list: kind, depth, runs: [] };
      if (ordered) {
        const number = Number(ordered[2]);
        // A list that doesn't start at 1 says where it starts; the items after it carry on from it.
        if (start[depth] === undefined && number !== 1) current.start = number;
        start[depth] = number;
      }
      this.blocks.push(current);
      text = match[3]!;
      this.at++;
    }
    finish();
  }

  private table(): void {
    const header = cells(this.lines[this.at]!);
    const aligns: (Align | undefined)[] = cells(this.lines[this.at + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined));
    this.at += 2;
    const rows = [header];
    while (this.at < this.lines.length && this.lines[this.at]!.trim() !== "" && this.lines[this.at]!.includes("|")) {
      rows.push(cells(this.lines[this.at]!));
      this.at++;
    }
    const width = header.length;
    const table: TableBlock = {
      id: createId("b_"),
      type: "table",
      headerRow: true,
      columns: normalizeColumns(Array.from({ length: width }, () => 1)),
      rows: rows.map((row) => ({
        id: createId("r_"),
        cells: Array.from({ length: width }, (_, i) => ({
          id: createId("c_"),
          blocks: [{ id: createId("b_"), type: "paragraph" as const, runs: normalizeRuns(inlineMarkdown(row[i] ?? "")), ...(aligns[i] && { align: aligns[i] }) }],
        })),
      })),
    };
    this.blocks.push(table);
  }

  private paragraph(): void {
    const parts: string[] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at]!;
      if (line.trim() === "") break;
      // Another kind of block starts a new paragraph.
      if (parts.length > 0 && (/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(line) || RULE.test(line) || BULLET.test(line) || ORDERED.test(line) || /^<!--\s*page-?break\s*-->$/i.test(line.trim()))) break;
      parts.push(line.trim().replace(/\s*\\$/, ""));
      this.at++;
    }
    this.blocks.push({ id: createId("b_"), type: "paragraph", runs: normalizeRuns(inlineMarkdown(parts.join(" "))) });
  }
}
