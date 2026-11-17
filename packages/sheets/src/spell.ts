import { COMMON_WORDS } from "./spell-words";

/*
 * The spelling check's engine: a dictionary, the rules for which words it leaves alone, and suggestions. It knows nothing of
 * sheets (see `review.ts` for walking cells) and nothing of where a dictionary comes from: a host passes its own, as a list
 * of words or as an object with `has` (and, if it can, `suggest`).
 */

/** What a host can plug in as a dictionary. */
export interface SpellDictionary {
  /** Whether the word (as written, any capitals) is a word. */
  has(word: string): boolean;
  /** Words to offer for a misspelling, best first. Left out, the checker looks for close words among `words()`. */
  suggest?(word: string, max: number): string[];
  /** Every word, in lower case, when the dictionary can list them (this is what suggestions are drawn from). */
  words?(): Iterable<string>;
}

export interface SpellOptions {
  /** Leave words in capitals (`NASA`, `USD`) alone. On by default, as in Excel. */
  ignoreUppercase?: boolean;
  /** Leave words with digits in them (`B2B`, `x86`) alone. On by default. */
  ignoreNumbers?: boolean;
  /** Leave web and email addresses and file names alone. On by default. */
  ignoreAddresses?: boolean;
  /** Words the person added to their own dictionary. */
  custom?: Iterable<string>;
}

/** A word in a text and where it is (`start` is the index of its first character, `end` the index after its last). */
export interface WordAt {
  word: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const ADDRESS = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+|\S+\.(?:com|org|net|io|dev|xlsx?|csv|docx?|pdf|png|jpe?g|txt)\b/giu;

/** The words of a text, with their places. Apostrophes inside a word stay in it (`don't`). */
export function wordsIn(text: string): WordAt[] {
  const out: WordAt[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** A dictionary made from a list of words. */
export function wordList(words: Iterable<string> | string): SpellDictionary {
  const set = new Set<string>();
  for (const w of typeof words === "string" ? words.split(/\s+/) : words) {
    const t = w.trim().toLowerCase();
    if (t) set.add(t);
  }
  return { has: (w) => set.has(w.toLowerCase()), words: () => set };
}

/** The dictionary of common English words that comes with Pli. */
export const basicDictionary: SpellDictionary = wordList(COMMON_WORDS);

/** Candidate base words for an inflected one (`planned` -> `plan`, `cities` -> `city`, `making` -> `make`). */
function bases(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => s.length >= 2 && out.push(s);
  if (w.endsWith("'s") || w.endsWith("’s")) add(w.slice(0, -2));
  if (w.endsWith("s'") || w.endsWith("s’")) add(w.slice(0, -1));
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2)), add(w.slice(0, -1));
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    if (/(.)\1$/.test(w.slice(0, -2))) add(w.slice(0, -3));
  }
  if (w.endsWith("ing")) {
    const s = w.slice(0, -3);
    add(s);
    add(s + "e");
    if (/(.)\1$/.test(s)) add(s.slice(0, -1));
    if (s.endsWith("y") && s.length > 2) add(s.slice(0, -1) + "ie");
  }
  if (w.endsWith("ly")) add(w.slice(0, -2)), add(w.slice(0, -3) + "le"), add(w.endsWith("ily") ? w.slice(0, -3) + "y" : w.slice(0, -2));
  if (w.endsWith("er")) add(w.slice(0, -2)), add(w.slice(0, -1)), /(.)\1$/.test(w.slice(0, -2)) && add(w.slice(0, -3));
  if (w.endsWith("est")) add(w.slice(0, -3)), add(w.slice(0, -2)), /(.)\1$/.test(w.slice(0, -3)) && add(w.slice(0, -4));
  if (w.endsWith("ment") || w.endsWith("ness")) add(w.slice(0, -4));
  if (w.startsWith("un") || w.startsWith("re")) add(w.slice(2));
  if (w.startsWith("non")) add(w.slice(3));
  return out;
}

/** The edit distance between two words (a swap of neighbours counts as one). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[n]!;
}

/** The capitals of `like` (`Teh` -> `The`, `TEH` -> `THE`) given to `word`. */
function withCaseOf(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like[0] && like[0] === like[0].toUpperCase() && like[0] !== like[0].toLowerCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/**
 * Checks words against a dictionary. Words the person added (`addWord`) and words skipped for now (`ignoreAll`) count as
 * right. A word is also right when it is a plain inflection of a dictionary word (plural, `-ed`, `-ing`, `-ly`, `-er`, `-est`).
 */
export class SpellChecker {
  readonly dictionary: SpellDictionary;
  readonly options: Required<Omit<SpellOptions, "custom">>;
  readonly #custom = new Set<string>();
  readonly #ignored = new Set<string>();

  constructor(dictionary: SpellDictionary | Iterable<string> | string = basicDictionary, options: SpellOptions = {}) {
    this.dictionary = typeof dictionary === "string" || Symbol.iterator in Object(dictionary) ? wordList(dictionary as Iterable<string> | string) : (dictionary as SpellDictionary);
    this.options = { ignoreUppercase: options.ignoreUppercase !== false, ignoreNumbers: options.ignoreNumbers !== false, ignoreAddresses: options.ignoreAddresses !== false };
    for (const w of options.custom ?? []) this.#custom.add(w.toLowerCase());
  }

  /** Puts a word in the person's own dictionary: it is right from now on. */
  addWord(word: string): void {
    this.#custom.add(word.trim().toLowerCase());
  }

  /** Takes a word out of the person's own dictionary again. */
  removeWord(word: string): void {
    this.#custom.delete(word.trim().toLowerCase());
  }

  /** The words in the person's own dictionary (for the host to keep). */
  get customWords(): string[] {
    return [...this.#custom].sort();
  }

  /** Counts a word as right until `resetIgnored` (Excel's Ignore All). */
  ignoreAll(word: string): void {
    this.#ignored.add(word.trim().toLowerCase());
  }

  resetIgnored(): void {
    this.#ignored.clear();
  }

  /** Whether the word is spelt right (or is left alone by the options). */
  isCorrect(word: string): boolean {
    const w = word.replace(/’/g, "'");
    if (w.length < 2) return true;
    const lower = w.toLowerCase();
    if (this.#custom.has(lower) || this.#ignored.has(lower)) return true;
    if (this.options.ignoreUppercase && w === w.toUpperCase() && w !== w.toLowerCase()) return true;
    if (this.options.ignoreNumbers && /\d/.test(w)) return true;
    if (this.dictionary.has(w) || this.dictionary.has(lower)) return true;
    return bases(lower).some((b) => this.dictionary.has(b));
  }

  /** The misspelt words of a text, with where each is. */
  check(text: string): WordAt[] {
    const skip: [number, number][] = [];
    if (this.options.ignoreAddresses) for (const m of text.matchAll(ADDRESS)) skip.push([m.index!, m.index! + m[0].length]);
    return wordsIn(text).filter((w) => !skip.some(([a, b]) => w.start >= a && w.end <= b) && !this.isCorrect(w.word));
  }

  /** Words to offer for a misspelling, best first, in the capitals the word has. */
  suggest(word: string, max = 6): string[] {
    const lower = word.toLowerCase().replace(/’/g, "'");
    let found: string[] = [];
    if (this.dictionary.suggest) found = this.dictionary.suggest(word, max).map((s) => s.toLowerCase());
    if (found.length < max) {
      const pool = this.dictionary.words?.() ?? [];
      const scored: { w: string; d: number }[] = [];
      const limit = lower.length <= 4 ? 1 : 2;
      for (const w of pool) {
        if (Math.abs(w.length - lower.length) > limit) continue;
        const d = editDistance(lower, w);
        if (d <= limit) scored.push({ w, d: d - (w[0] === lower[0] ? 0.4 : 0) });
      }
      for (const w of this.#custom) if (Math.abs(w.length - lower.length) <= limit && editDistance(lower, w) <= limit) scored.push({ w, d: editDistance(lower, w) - 0.2 });
      scored.sort((a, b) => a.d - b.d || a.w.localeCompare(b.w));
      for (const { w } of scored) if (!found.includes(w)) found.push(w);
    }
    return found.slice(0, max).map((s) => withCaseOf(s, word));
  }
}

