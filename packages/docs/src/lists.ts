import type { Block, ListItemBlock, ListMarker } from "./model";

export const NUMBER_MARKERS = ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"] as const satisfies readonly ListMarker[];
export const BULLET_MARKERS = ["disc", "circle", "square"] as const satisfies readonly ListMarker[];

/** The largest number a list can start at. */
export const MAX_LIST_START = 99_999;

const SYMBOLS: Record<(typeof BULLET_MARKERS)[number], string> = { disc: "•", circle: "◦", square: "▪" };

/** What a list uses when it names no marker: 1. a. i. for numbers and • ◦ ▪ for bullets, by depth. */
export function defaultMarker(list: "bullet" | "ordered", depth: number): ListMarker {
  const step = depth % 3;
  return list === "bullet" ? BULLET_MARKERS[step]! : (["decimal", "lower-alpha", "lower-roman"] as const)[step]!;
}

/** The marker a list item shows, whether it says so or takes the default for its depth. A marker of the wrong kind is ignored. */
export function markerOf(item: Pick<ListItemBlock, "list" | "depth" | "marker">): ListMarker {
  const allowed: readonly ListMarker[] = item.list === "bullet" ? BULLET_MARKERS : NUMBER_MARKERS;
  return item.marker && allowed.includes(item.marker) ? item.marker : defaultMarker(item.list, item.depth);
}

function letters(n: number): string {
  let out = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(97 + ((i - 1) % 26)) + out;
  return out;
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

/** The number `n` written in a marker's style, without the trailing dot: 3 is "3", "c", "C", "iii" or "III". Letters and roman numerals start at 1, so 0 stays "0". */
export function numberText(n: number, marker: ListMarker): string {
  if (n < 1) return String(n);
  switch (marker) {
    case "lower-alpha":
      return letters(n);
    case "upper-alpha":
      return letters(n).toUpperCase();
    case "lower-roman":
      return roman(n);
    case "upper-roman":
      return roman(n).toUpperCase();
    default:
      return String(n);
  }
}

export interface ListLabel {
  /** The marker text as shown: "3.", "c.", "iii." or "•". */
  text: string;
  marker: ListMarker;
  /** The number of an ordered item. */
  number?: number;
}

/**
 * The number each ordered item takes, for every block (undefined for other blocks and for bullets).
 * Items count up from the one before at the same depth. An item with `start` takes that number instead and
 * the count carries on from it. A block that isn't a list item ends every list, and a shallower item ends the deeper ones.
 */
export function listNumbers(blocks: readonly Block[]): (number | undefined)[] {
  const counters: number[] = [];
  return blocks.map((block) => {
    if (block.type !== "list_item") {
      counters.length = 0;
      return undefined;
    }
    counters.length = block.depth + 1;
    if (block.list === "bullet") {
      counters[block.depth] = 0;
      return undefined;
    }
    const n = (counters[block.depth] = block.start ?? (counters[block.depth] ?? 0) + 1);
    return n;
  });
}

/** The marker of each block, for drawing and for exports that write their own numbers. */
export function listLabels(blocks: readonly Block[]): (ListLabel | undefined)[] {
  const numbers = listNumbers(blocks);
  return blocks.map((block, i) => {
    if (block.type !== "list_item") return undefined;
    const marker = markerOf(block);
    if (block.list === "bullet") return { text: SYMBOLS[marker as keyof typeof SYMBOLS], marker };
    const number = numbers[i]!;
    return { text: `${numberText(number, marker)}.`, marker, number };
  });
}

/**
 * The items that form one list with the one at `index`: those at its depth, from the first after a
 * non-list block, a shallower item or an item of the other kind, to the last before the next. Deeper items in between belong to it.
 */
export function listRun(blocks: readonly Block[], index: number): number[] {
  const item = blocks[index];
  if (!item || item.type !== "list_item") return [];
  const same = (b: Block | undefined): b is ListItemBlock => !!b && b.type === "list_item" && b.depth === item.depth && b.list === item.list;
  const out: number[] = [index];
  for (let i = index - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.type !== "list_item" || b.depth < item.depth) break;
    if (b.depth === item.depth) {
      if (!same(b)) break;
      out.unshift(i);
    }
  }
  for (let i = index + 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== "list_item" || b.depth < item.depth) break;
    if (b.depth === item.depth) {
      if (!same(b)) break;
      out.push(i);
    }
  }
  return out;
}

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanValue(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const here = ROMAN_VALUES[text[i]!]!;
    total += here < (ROMAN_VALUES[text[i + 1] ?? ""] ?? 0) ? -here : here;
  }
  return total;
}

/** The style and number a Word list label such as "3.", "c)", "IV." or "(ii)" shows. */
export function numberOfLabel(label: string): { marker: ListMarker; number: number } | null {
  const text = /^[\(\[]?([^.)\]]+)[.)\]]/.exec(label)?.[1];
  if (!text) return null;
  if (/^\d+$/.test(text)) return { marker: "decimal", number: Number(text) };
  const lower = text === text.toLowerCase();
  // A lone c, d, l or m is far more likely the third, fourth, twelfth or thirteenth letter than a number.
  const roman = /^[ivxlcdm]+$/i.test(text) && (text.length > 1 || /^[ivx]$/i.test(text));
  if (roman) return { marker: lower ? "lower-roman" : "upper-roman", number: romanValue(text.toLowerCase()) };
  if (/^[a-z]+$/i.test(text)) {
    const number = [...text.toLowerCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 96, 0);
    return { marker: lower ? "lower-alpha" : "upper-alpha", number };
  }
  return null;
}

export function bulletOfLabel(label: string): ListMarker | undefined {
  if (/^[o○◦]$/.test(label)) return "circle";
  if (/^[§▪■\uf0a7]$/.test(label)) return "square";
  return undefined;
}
