import { footnoteIds, numberFootnotes } from "../footnotes";
import type { Block, Doc, HeadingBlock, Run, TableBlock } from "../model";
import { plainText } from "../runs";

const SPECIAL = /([\\`*_[\]<>])/g;

function escapeMarkdown(value: string): string {
  return value.replace(SPECIAL, "\\$1");
}

/** Keeps paragraph text from being re-read as a heading, bullet or numbered item. */
function escapeBlockStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6}|[-+])(?=\s)/, "$1\\$2")
    .replace(/^(\s*\d+)\.(?=\s)/, "$1\\.");
}

/** A line break inside a block: two trailing spaces make it a hard break rather than a space. */
function hardBreaks(text: string): string {
  return text.replace(/\n/g, "  \n");
}

function renderRun(run: Run): string {
  const m = run.marks;
  if (!m) return escapeMarkdown(run.text);
  // The text of a footnote reference is its number (see `numberFootnotes`).
  if (m.footnote) return `[^${run.text}]`;
  // Whitespace must stay outside emphasis markers or Markdown won't parse them.
  const lead = run.text.match(/^\s*/)![0];
  const trail = run.text.slice(lead.length).match(/\s*$/)![0];
  const core = run.text.slice(lead.length, run.text.length - trail.length);
  if (core === "") return run.text;

  let out = m.code ? "`" + core.replace(/`/g, "\\`") + "`" : escapeMarkdown(core);
  if (m.bold) out = `**${out}**`;
  if (m.italic) out = `*${out}*`;
  // Text someone proposes to delete reads as struck through; an addition is just text.
  if (m.strike || m.suggest?.kind === "delete") out = `~~${out}~~`;
  // Markdown has no underline or color; fall back to inline HTML.
  if (m.underline) out = `<u>${out}</u>`;
  if (m.superscript) out = `<sup>${out}</sup>`;
  if (m.subscript) out = `<sub>${out}</sub>`;
  if (m.link) out = `[${out}](${m.link.replace(/\)/g, "%29")})`;
  return lead + out + trail;
}

/** One block of a table cell as inline Markdown. Tables hold one line per cell, so structure is flattened. */
function cellBlockMarkdown(block: Block): string {
  switch (block.type) {
    case "image":
      return `![${escapeMarkdown(block.alt ?? "")}](${block.src.replace(/\)/g, "%29")})`;
    case "list_item":
      return "\u2022 " + block.runs.map(renderRun).join("");
    case "divider":
      return "";
    case "code_block":
      return "`" + plainText(block.runs).replace(/`/g, "\\`") + "`";
    default:
      return "runs" in block ? block.runs.map(renderRun).join("") : "";
  }
}

/**
 * A GitHub-flavoured Markdown table. That format always has a header row, so the first row is
 * used as one whether or not it is marked as a header. Several blocks in a cell are joined with a
 * line break, and cell shading, column widths and borders are dropped.
 */
function tableMarkdown(table: TableBlock): string[] {
  const text = (cell: TableBlock["rows"][number]["cells"][number]) =>
    cell.blocks
      .map(cellBlockMarkdown)
      .filter((part) => part !== "")
      .join("<br>")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>") || " ";
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const [head, ...body] = table.rows;
  if (!head) return [];
  return [
    line(head.cells.map(text)),
    line(head.cells.map(() => "---")),
    ...body.map((row) => line(row.cells.map(text))),
  ];
}

/** GitHub-style heading anchors, so table of contents links work where Markdown is rendered. */
function headingSlugs(doc: Doc): Map<string, string> {
  const slugs = new Map<string, string>();
  const used = new Map<string, number>();
  for (const block of doc.blocks) {
    if (block.type !== "heading") continue;
    const base =
      plainText(block.runs)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-") || "section";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    slugs.set(block.id, count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

/**
 * Exports to CommonMark with GFM strikethrough. Underline, superscript and subscript fall back
 * to inline HTML. Fonts, sizes, colors and page layout have no Markdown equivalent and are dropped.
 */
export function toMarkdown(source: Doc): string {
  const doc = numberFootnotes(source);
  const slugs = headingSlugs(doc);
  const lines: string[] = [];
  const counters: number[] = [];
  let previousWasList = false;

  for (const block of doc.blocks) {
    if (block.type !== "list_item") {
      counters.length = 0;
      if (previousWasList) lines.push("");
      previousWasList = false;
    }

    switch (block.type) {
      case "paragraph":
        lines.push(escapeBlockStart(hardBreaks(block.runs.map(renderRun).join(""))), "");
        break;
      case "heading":
        lines.push("#".repeat(block.level) + " " + block.runs.map(renderRun).join("").replace(/\n/g, " "), "");
        break;
      case "title":
        lines.push("# " + block.runs.map(renderRun).join("").replace(/\n/g, " "), "");
        break;
      case "subtitle":
        lines.push("_" + block.runs.map(renderRun).join("").replace(/\n/g, " ") + "_", "");
        break;
      case "image":
        // A picture placed on the page (a background, a logo in a corner) isn't part of the text.
        if (block.float) break;
        lines.push(`![${escapeMarkdown(block.alt ?? "")}](${block.src.replace(/\)/g, "%29")})`, "");
        break;
      case "table":
        // A text box is its text, as paragraphs.
        if (block.float) {
          for (const cellBlock of block.rows[0]!.cells[0]!.blocks) {
            const line = cellBlockMarkdown(cellBlock);
            if (line.trim() !== "") lines.push(line, "");
          }
          break;
        }
        lines.push(...tableMarkdown(block), "");
        break;
      case "section_break":
        // Markdown has no sections or columns.
        break;
      case "page_break":
        lines.push('<div style="page-break-after: always"></div>', "");
        break;
      case "toc": {
        const headings = doc.blocks.filter((b): b is HeadingBlock => b.type === "heading" && b.level <= block.levels);
        const title = block.title ?? "Table of contents";
        if (title) lines.push(`**${escapeMarkdown(title)}**`, "");
        for (const h of headings) {
          const label = escapeMarkdown(plainText(h.runs));
          lines.push(`${"  ".repeat(h.level - 1)}- [${label}](#${slugs.get(h.id)})`);
        }
        lines.push("");
        break;
      }
      case "quote":
        lines.push(
          ...block.runs
            .map(renderRun)
            .join("")
            .replace(/\n/g, "  \n")
            .split("\n")
            .map((l) => "> " + l),
          "",
        );
        break;
      case "code_block": {
        const source = plainText(block.runs);
        const fence = "`".repeat(Math.max(3, longestBacktickRun(source) + 1));
        lines.push(fence + (block.language ?? ""), source, fence, "");
        break;
      }
      case "divider":
        lines.push("---", "");
        break;
      case "list_item": {
        counters.length = block.depth + 1;
        let marker = "-";
        if (block.list === "ordered") {
          // Markdown numbers are numbers, so letters and roman numerals are written as the numbers they stand for.
          counters[block.depth] = block.start ?? (counters[block.depth] ?? 0) + 1;
          marker = `${counters[block.depth]}.`;
        } else {
          counters[block.depth] = 0;
        }
        const indentation = "   ".repeat(block.depth);
        const text = block.runs.map(renderRun).join("").replace(/\n/g, "  \n" + indentation + "  ");
        lines.push(indentation + marker + " " + text);
        previousWasList = true;
        break;
      }
    }
  }

  // Notes become GitHub-style footnote definitions; further paragraphs of a note are indented under it.
  footnoteIds(doc.blocks).forEach((id, i) => {
    const body = (doc.footnotes?.[id] ?? []).flatMap((b) => ("runs" in b ? [hardBreaks(b.runs.map(renderRun).join(""))] : []));
    if (body.length === 0) return;
    lines.push(`[^${i + 1}]: ${body[0]}`, ...body.slice(1).flatMap((paragraph) => ["", `    ${paragraph}`]), "");
  });

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}
