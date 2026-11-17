import { FOOTNOTE_CHAR } from "./footnotes";
import { isTextBlock, type Doc, type Run } from "./model";
import type { DocOp } from "./ops";
import { marksAt, plainText } from "./runs";
import { caret, type Selection } from "./selection";
import { flattenBlocks, locate } from "./tree";
import type { Command } from "./commands";

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

/** One occurrence of the search text: a range inside a single block. */
export interface Match {
  block: string;
  from: number;
  to: number;
}

const WORD = /[\p{L}\p{N}_]/u;

/** All occurrences of `query` in the document body, in order. Matches never span blocks. */
export function findAll(doc: Doc, query: string, options: FindOptions = {}): Match[] {
  if (query === "") return [];
  const needle = options.matchCase ? query : query.toLowerCase();
  const matches: Match[] = [];
  for (const block of flattenBlocks(doc.blocks)) {
    if (!isTextBlock(block)) continue;
    const text = plainText(block.runs);
    const haystack = options.matchCase ? text : text.toLowerCase();
    // Lowercasing can change length for a few characters; fall back to the original then.
    if (haystack.length !== text.length) continue;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      const end = at + needle.length;
      if (options.wholeWord && (WORD.test(text[at - 1] ?? "") || WORD.test(text[end] ?? ""))) continue;
      matches.push({ block: block.id, from: at, to: end });
    }
  }
  return matches;
}

/** The selection that covers a match. */
export function matchSelection(match: Match): Selection {
  return { anchor: { block: match.block, offset: match.from }, focus: { block: match.block, offset: match.to } };
}

/**
 * Replaces matches with `replacement`. Replaced text keeps the formatting of the first character
 * it replaces. The caret ends after the last replacement.
 */
export function replaceMatches(matches: readonly Match[], replacement: string): Command {
  return (doc, selection) => {
    if (matches.length === 0) return null;
    const ops: DocOp[] = [];
    // Work backwards so earlier offsets stay valid, inside each block.
    for (const match of [...matches].reverse()) {
      const block = locate(doc, match.block)?.block;
      if (!block || !isTextBlock(block)) continue;
      const marks = marksAt(block.runs, match.from);
      ops.push({ type: "delete_text", block: match.block, from: match.from, to: match.to });
      if (replacement !== "") {
        const run: Run = marks ? { text: replacement, marks } : { text: replacement };
        ops.push({ type: "insert_text", block: match.block, offset: match.from, runs: [run] });
      }
    }
    if (ops.length === 0) return null;
    const last = matches[matches.length - 1]!;
    const shifted = matches.filter((m) => m.block === last.block).length - 1;
    // Earlier matches in the same block moved the last one by their length difference.
    const delta = (replacement.length - (last.to - last.from)) * shifted;
    return { ops, selection: caret(last.block, last.from + delta + replacement.length) };
  };
}

export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

/** Counts words and characters in the document body. */
export function documentStats(doc: Doc): DocumentStats {
  let words = 0;
  let characters = 0;
  let charactersNoSpaces = 0;
  for (const block of flattenBlocks(doc.blocks)) {
    if (!isTextBlock(block)) continue;
    // A footnote reference is a zero-width character, not part of the text.
    const text = plainText(block.runs).replaceAll(FOOTNOTE_CHAR, "");
    characters += text.length;
    charactersNoSpaces += text.replace(/\s/g, "").length;
    words += text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return { words, characters, charactersNoSpaces };
}
