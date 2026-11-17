import { MAX_COLS, MAX_ROWS, colNumber, type Dimension } from "@pli.dev/sheets";

export const DEFAULT_COL_PX = 64;
export const DEFAULT_ROW_PX = 20;
export const MIN_SIZE_PX = 8;

/** A column width in characters (the unit files use) as pixels. */
export const colPx = (chars: number) => Math.round(chars * 7 + 5);
/** Pixels back to characters. */
export const colChars = (px: number) => Math.round(((px - 5) / 7) * 100) / 100;
/** A row height in points as pixels. */
export const rowPx = (points: number) => Math.round((points * 4) / 3);
export const rowPoints = (px: number) => Math.round(((px * 3) / 4) * 100) / 100;

/**
 * The sizes along one direction of the grid: items are `base` wide unless some are different (a few columns are
 * wider, some rows hidden). Positions are found without visiting every item, so a million rows cost nothing.
 * Items are numbered from 1.
 */
export class Axis {
  readonly base: number;
  readonly limit: number;
  /** The items with their own size, in order, and the extra space before each (the sum of how they differ from the base). */
  readonly #items: number[] = [];
  readonly #sizes: number[] = [];
  readonly #before: number[] = [];

  constructor(base: number, sizes: ReadonlyMap<number, number>, limit: number) {
    this.base = base;
    this.limit = limit;
    let extra = 0;
    for (const [i, size] of [...sizes].filter(([i]) => i >= 1 && i <= limit).sort((a, b) => a[0] - b[0])) {
      this.#items.push(i);
      this.#sizes.push(size);
      this.#before.push(extra);
      extra += size - base;
    }
    this.#total = extra;
  }
  readonly #total: number;

  /** How many of the items with their own size come before item `i`. */
  #count(i: number): number {
    let lo = 0;
    let hi = this.#items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#items[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  size(i: number): number {
    const k = this.#count(i);
    return this.#items[k] === i ? this.#sizes[k]! : this.base;
  }

  /** Where item `i` starts. */
  offset(i: number): number {
    const k = this.#count(i);
    const extra = k === 0 ? 0 : this.#before[k - 1]! + this.#sizes[k - 1]! - this.base;
    return (i - 1) * this.base + extra;
  }

  /** The item that contains the position `px`, clamped to the items there are. */
  indexAt(px: number): number {
    if (px <= 0) return 1;
    let lo = 1;
    let hi = this.limit;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.offset(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get total(): number {
    return this.limit * this.base + this.#total;
  }
}

export function columnAxis(columns: Record<string, Dimension> | undefined): Axis {
  const sizes = new Map<number, number>();
  for (const [name, d] of Object.entries(columns ?? {})) {
    const n = colNumber(name);
    if (n) sizes.set(n, d.hidden ? 0 : d.size !== undefined ? colPx(d.size) : DEFAULT_COL_PX);
  }
  return new Axis(DEFAULT_COL_PX, sizes, MAX_COLS);
}

/** `auto` gives the heights of rows that fit their content (wrapped text); a size the sheet sets for the row wins over it. */
export function rowAxis(rows: Record<string, Dimension> | undefined, auto?: ReadonlyMap<number, number>): Axis {
  const sizes = new Map<number, number>(auto);
  for (const [name, d] of Object.entries(rows ?? {})) {
    const n = Number(name);
    if (n) sizes.set(n, d.hidden ? 0 : d.size !== undefined ? rowPx(d.size) : DEFAULT_ROW_PX);
  }
  return new Axis(DEFAULT_ROW_PX, sizes, MAX_ROWS);
}

/**
 * How many lines `text` takes when wrapped in `width` pixels: at spaces, with line breaks kept and a word too long for a
 * line broken where it must be. `measure` gives a string's width.
 */
export function wrapLineCount(text: string, width: number, measure: (s: string) => number): number {
  if (width <= 0) return 1;
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    let line = 0;
    let used = 0;
    const space = measure(" ");
    for (const word of paragraph.split(" ")) {
      const w = measure(word);
      if (used === 0 && line === 0) line = 1;
      if (w > width) {
        // Breaks inside the word: what is left of the line, then full lines.
        const total = used + (used ? space : 0) + w;
        line += Math.max(0, Math.ceil(total / width) - 1);
        used = total % width || width;
      } else if (used === 0) used = w;
      else if (used + space + w <= width) used += space + w;
      else {
        line++;
        used = w;
      }
    }
    lines += Math.max(1, line);
  }
  return lines;
}
