import { createId } from "@pli.dev/core";
import type { Block, Run, TextBlock } from "../model";
import { normalizeRuns, plainText } from "../runs";

/** A link to somewhere in the same document: what the entries of a table of contents are made of, wherever it was written. */
const INTERNAL = /(^#|#|%23)(heading(=|%3D)|h\.|_toc|__refheading|bookmark(=|%3D)|toc|_ref|id\.)/i;

const TITLE = /^\s*(table of )?contents\s*$/i;

/** Text that is only what joins a heading to its page number: spaces, tabs, dots and the number. */
const LEADER_AND_NUMBER = /^[\s .·•…_\-–—\d]*$/;

function isTocLine(block: Block): block is TextBlock {
  if (block.type !== "paragraph" && block.type !== "list_item") return false;
  const links = block.runs.filter((r) => r.marks?.link && INTERNAL.test(safeDecode(r.marks.link)));
  if (links.length === 0) return false;
  const linked = links.map((r) => r.text).join("");
  if (linked.trim() === "") return false;
  const rest = block.runs.filter((r) => !links.includes(r)).map((r) => r.text).join("");
  return LEADER_AND_NUMBER.test(rest);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Finds the table of contents in pasted blocks and makes it one. What Google Docs, Word and LibreOffice put on the clipboard for
 * one is a run of paragraphs, each a link to a heading followed by dots and a page number: pasted as they are they are text
 * with stray dots and numbers that go stale. Two or more such lines in a row (or one under a "Table of contents" title) become
 * a `toc` block, which lists the headings of the document it is in and keeps itself current. The title above it becomes its title.
 */
export function tocFromLinks(blocks: Block[]): Block[] {
  return withoutLinksToHeadings(findToc(blocks));
}

/** Links to a heading of the document the text came from go nowhere here, so what is left of them is text. */
function withoutLinksToHeadings(blocks: Block[]): Block[] {
  const fix = (runs: readonly Run[]): Run[] =>
    runs.map((run) => {
      const link = run.marks?.link;
      if (!link || !(link.startsWith("#") || INTERNAL.test(safeDecode(link)))) return run;
      const { link: _gone, ...rest } = run.marks!;
      return Object.keys(rest).length > 0 ? { ...run, marks: rest } : { text: run.text };
    });
  return blocks.map((b) => (b.type === "table" || !("runs" in b) || !b.runs.some((r) => r.marks?.link) ? b : { ...b, runs: normalizeRuns(fix(b.runs)) }) as Block);
}

function findToc(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i]!;
    if (!isTocLine(start)) {
      out.push(start);
      continue;
    }
    let end = i;
    while (end + 1 < blocks.length && isTocLine(blocks[end + 1]!)) end++;
    const lines = blocks.slice(i, end + 1) as TextBlock[];
    const title = out[out.length - 1];
    const titled = !!title && (title.type === "paragraph" || title.type === "heading") && TITLE.test(plainText(title.runs));
    if (lines.length < 2 && !titled) {
      out.push(start);
      continue;
    }
    // Each level an entry is indented to is a level of heading the contents go down to.
    const indents = new Set(lines.map((l) => ("format" in l ? (l.format?.indentLeft ?? 0) : 0) + ("depth" in l ? (l.depth as number) * 36 : 0)));
    const levels = Math.min(6, Math.max(1, indents.size)) as 1 | 2 | 3 | 4 | 5 | 6;
    let name = "";
    if (titled) {
      name = plainText((title as TextBlock).runs).trim();
      out.pop();
    }
    out.push({ id: createId("b_"), type: "toc", levels, title: name });
    i = end;
  }
  return out;
}
