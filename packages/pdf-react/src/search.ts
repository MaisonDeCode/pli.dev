import type { Rect } from "@pli.dev/pdf";
import { runBounds, runSlice, type TextRun } from "./renderer";

export interface SearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

/** One match: where it is in the text of its page, and the rectangles (one per line) to highlight, in page space. */
export interface SearchHit {
  /** Position of the page in the list that was searched. */
  page: number;
  start: number;
  end: number;
  /** The text as it is on the page. */
  text: string;
  rects: Rect[];
}

interface Owner {
  run: number;
  offset: number;
}

/** The text of a page as one string, with where each character comes from. */
export interface PageText {
  text: string;
  /** For each character, the run and offset it comes from; null for a space added between runs. */
  owners: (Owner | null)[];
}

/**
 * Joins the runs of a page into text. Runs on the same line are joined directly if they touch and with a space if there is
 * a gap; a new line is a space, so a phrase that wraps is still found (its highlight is one rectangle per line).
 */
export function pageText(runs: readonly TextRun[]): PageText {
  let text = "";
  const owners: (Owner | null)[] = [];
  let prev: { run: TextRun; box: Rect } | null = null;
  runs.forEach((run, i) => {
    if (!run.str) return;
    const box = runBounds(run);
    if (prev) {
      const sameLine = !prev.run.eol && (prev.run.angle ?? 0) === (run.angle ?? 0) && Math.abs(box.y + box.h / 2 - (prev.box.y + prev.box.h / 2)) < 0.6 * Math.min(box.h, prev.box.h);
      const gap = box.x - (prev.box.x + prev.box.w);
      const spaced = /\s$/.test(text) || /^\s/.test(run.str);
      if (!spaced && (!sameLine || gap > 0.2 * Math.min(box.h, prev.box.h))) {
        text += " ";
        owners.push(null);
      }
    }
    for (let k = 0; k < run.str.length; k++) owners.push({ run: i, offset: k });
    text += run.str;
    prev = { run, box };
  });
  return { text, owners };
}

const MARKS = /\p{M}/gu;
const WORD = /[\p{L}\p{N}_]/u;

/** Folds case and diacritics and collapses white space, keeping for each character where it came from. */
export function normalize(text: string, options: SearchOptions = {}): { norm: string; from: number[]; to: number[] } {
  let norm = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const end = i + ch.length;
    let n = /\s/u.test(ch) ? " " : ch.normalize("NFKD").replace(MARKS, "");
    if (!options.matchCase) n = n.toLowerCase();
    if (n === " " && norm.endsWith(" ")) {
      to[to.length - 1] = end;
    } else {
      for (const c of n) {
        norm += c;
        for (let k = 0; k < c.length; k++) {
          from.push(i);
          to.push(end);
        }
      }
    }
    i = end;
  }
  return { norm, from, to };
}

/** Finds the query on one page. */
export function findInRuns(runs: readonly TextRun[], query: string, options: SearchOptions = {}): Omit<SearchHit, "page">[] {
  const q = normalize(query.trim(), options).norm;
  if (!q) return [];
  const joined = pageText(runs);
  const { norm, from, to } = normalize(joined.text, options);
  const hits: Omit<SearchHit, "page">[] = [];
  let at = 0;
  while ((at = norm.indexOf(q, at)) >= 0) {
    const end = at + q.length;
    if (options.wholeWord && ((at > 0 && WORD.test(norm[at - 1]!) && WORD.test(norm[at]!)) || (end < norm.length && WORD.test(norm[end]!) && WORD.test(norm[end - 1]!)))) {
      at += 1;
      continue;
    }
    const start = from[at]!;
    const stop = to[end - 1]!;
    hits.push({ start, end: stop, text: joined.text.slice(start, stop), rects: hitRects(runs, joined, start, stop) });
    at = end;
  }
  return hits;
}

/** The rectangles of text from `start` to `end` of a page's text: one per run, joined along a line. */
function hitRects(runs: readonly TextRun[], joined: PageText, start: number, end: number): Rect[] {
  const slices: { run: number; from: number; to: number }[] = [];
  for (let i = start; i < end; i++) {
    const o = joined.owners[i];
    if (!o) continue;
    const last = slices[slices.length - 1];
    if (last && last.run === o.run && last.to === o.offset) last.to = o.offset + 1;
    else slices.push({ run: o.run, from: o.offset, to: o.offset + 1 });
  }
  const rects: Rect[] = [];
  for (const s of slices) {
    const r = runSlice(runs[s.run]!, s.from, s.to);
    const last = rects[rects.length - 1];
    const sameLine = last && Math.abs(r.y + r.h / 2 - (last.y + last.h / 2)) < 0.5 * Math.min(r.h, last.h);
    if (last && sameLine) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      rects[rects.length - 1] = { x, y, w: Math.max(last.x + last.w, r.x + r.w) - x, h: Math.max(last.y + last.h, r.y + r.h) - y };
    } else rects.push(r);
  }
  return rects;
}

export interface SearchRequest extends SearchOptions {
  query: string;
  /** How many pages there are, and a way to get the text runs of each. */
  count: number;
  runs: (page: number) => Promise<readonly TextRun[]>;
  signal?: AbortSignal;
  /** Called with each page's matches as soon as it has been searched (including pages with none). */
  onPage?: (page: number, hits: SearchHit[]) => void;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Searches every page, one after the other, giving the browser a turn every ~12 ms so a large file does not freeze the
 * page, and stopping at once when `signal` is aborted. Resolves with all hits, in page order (or what was found so far,
 * if cancelled).
 */
export async function searchDocument(req: SearchRequest): Promise<SearchHit[]> {
  const all: SearchHit[] = [];
  if (!req.query.trim()) return all;
  let t0 = now();
  for (let page = 0; page < req.count; page++) {
    if (req.signal?.aborted) return all;
    let runs: readonly TextRun[] = [];
    try {
      runs = await req.runs(page);
    } catch {
      runs = [];
    }
    if (req.signal?.aborted) return all;
    const hits = findInRuns(runs, req.query, req).map((h) => ({ ...h, page }));
    all.push(...hits);
    req.onPage?.(page, hits);
    if (now() - t0 > 12) {
      await tick();
      t0 = now();
    }
  }
  return all;
}
