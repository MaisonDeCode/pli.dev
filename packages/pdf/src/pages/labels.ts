/**
 * Page labels (`ii`, `A-3`): the `/PageLabels` number tree. A label belongs to a position in the file, so when pages are
 * moved or deleted the labels have to be written again from the document's own labels (`Page.label`).
 */
import type { WriteContext } from "../context";
import type { PdfFile } from "../cos/file";
import { PdfDict, PdfName, isDict, isName, isString, pdfText, textOf } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { treeEntries } from "./dest";

// ---- numbering styles ----------------------------------------------------------------------------------------------

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

const roman = (n: number): string => {
  let s = "";
  for (const [v, t] of ROMAN) while (n >= v) (s += t), (n -= v);
  return s;
};

const fromRoman = (s: string): number => {
  let n = 0;
  let rest = s;
  for (const [v, t] of ROMAN) while (rest.startsWith(t)) (n += v), (rest = rest.slice(t.length));
  return rest === "" ? n : 0;
};

const letters = (n: number): string => String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);

const fromLetters = (s: string): number => (s.length > 0 && /^(.)\1*$/.test(s) ? (s.length - 1) * 26 + (s.charCodeAt(0) - 96) : 0);

type Style = "D" | "R" | "r" | "A" | "a";

function format(style: Style, n: number): string {
  switch (style) {
    case "D":
      return String(n);
    case "r":
      return roman(n);
    case "R":
      return roman(n).toUpperCase();
    case "a":
      return letters(n);
    case "A":
      return letters(n).toUpperCase();
  }
}

interface Range {
  /** The first page (0-based) of the range. */
  page: number;
  style?: Style;
  prefix: string;
  /** The number of the first page. */
  start: number;
}

/** What a label is made of: a prefix and a number in a style, or just a literal. */
interface Parsed {
  style?: Style;
  prefix: string;
  n: number;
}

function parseLabel(label: string): Parsed {
  const dec = /^(.*?)([1-9]\d{0,8}|0)$/s.exec(label);
  if (dec) return { style: "D", prefix: dec[1]!, n: Number(dec[2]) };
  for (const [re, style, parse] of [
    [/^(.*?)([ivxlcdm]+)$/s, "r", fromRoman],
    [/^(.*?)([IVXLCDM]+)$/s, "R", (s: string) => fromRoman(s.toLowerCase())],
    [/^(.*?)([a-z]+)$/s, "a", fromLetters],
    [/^(.*?)([A-Z]+)$/s, "A", (s: string) => fromLetters(s.toLowerCase())],
  ] as const) {
    const m = re.exec(label);
    if (!m) continue;
    const n = parse(m[2]!);
    if (n > 0 && format(style, n) === m[2]) return { style, prefix: m[1]!, n };
  }
  return { prefix: label, n: 0 };
}

/** The label of every page when pages without a label continue the numbering before them (the first one is `1`). */
export function effectiveLabels(labels: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  labels.forEach((l, i) => {
    if (l !== undefined) return void out.push(l);
    const prev = out[i - 1] === undefined ? undefined : parseLabel(out[i - 1]!);
    out.push(prev?.style ? prev.prefix + format(prev.style, prev.n + 1) : String(i + 1));
  });
  return out;
}

/** Number tree ranges that give exactly these labels. */
export function labelRanges(labels: readonly string[]): Range[] {
  const ranges: Range[] = [];
  let last: { range: Range; parsed: Parsed; label: string } | undefined;
  labels.forEach((label, page) => {
    const parsed = parseLabel(label);
    if (last) {
      const l = last.parsed;
      const continues = parsed.style !== undefined && parsed.style === l.style && parsed.prefix === l.prefix && parsed.n === l.n + 1;
      const same = parsed.style === undefined && l.style === undefined && label === last.label;
      if (continues || same) {
        last = { range: last.range, parsed, label };
        return;
      }
    }
    const range: Range = { page, style: parsed.style, prefix: parsed.prefix, start: parsed.style ? parsed.n : 1 };
    ranges.push(range);
    last = { range, parsed, label };
  });
  return ranges;
}

// ---- reading -------------------------------------------------------------------------------------------------------

/** The labels of the first `count` pages as the file's `/PageLabels` gives them; undefined when the file has none. */
export function readPageLabels(file: Pick<PdfFile, "get" | "catalog">, count: number): string[] | undefined {
  let tree: PdfObj | undefined;
  try {
    tree = file.catalog().get("PageLabels");
  } catch {
    return undefined;
  }
  if (tree === undefined || !isDict(file.get(tree))) return undefined;
  const entries = treeEntries(file, tree, "Nums")
    .filter(([k]) => typeof k === "number" && k >= 0)
    .map(([k, v]) => [k as number, file.get(v)] as const)
    .sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return undefined;
  const ranges = entries.map(([page, d]) => {
    const dict = isDict(d) ? d : new PdfDict();
    const s = file.get(dict.get("S"));
    const style = isName(s) && ["D", "R", "r", "A", "a"].includes(s.value) ? (s.value as Style) : undefined;
    const p = file.get(dict.get("P"));
    const st = file.get(dict.get("St"));
    return { page, style, prefix: isString(p) ? textOf(p) : "", start: typeof st === "number" && st >= 1 ? Math.floor(st) : 1 };
  });
  // Pages before the first entry are numbered in decimal from 1 (the standard says the tree must start at 0).
  const out: string[] = [];
  let at = -1;
  for (let i = 0; i < count; i++) {
    while (at + 1 < ranges.length && ranges[at + 1]!.page <= i) at++;
    const r = ranges[at];
    out.push(r ? r.prefix + (r.style ? format(r.style, r.start + i - r.page) : "") : String(i + 1));
  }
  return out;
}

// ---- writing -------------------------------------------------------------------------------------------------------

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Writes `/PageLabels` from the document's page labels when they differ from what the file shows for the new page
 * order. `owner` says which original page (0-based index in `main`) each page of the document is, when it is that page.
 */
export function writePageLabels(ctx: WriteContext, owner: readonly (number | undefined)[]): void {
  const { doc, baseline, main, overlay } = ctx;
  const n = doc.pages.length;
  const modelHas = doc.pages.some((p) => p.label !== undefined);
  const baselineHad = baseline.pages.some((p) => p.label !== undefined);
  const fileLabels = main ? readPageLabels(main, main.pageCount()) : undefined;
  let labels: (string | undefined)[];
  if (modelHas || baselineHad) labels = doc.pages.map((p) => p.label);
  else if (fileLabels) labels = doc.pages.map((_, i) => (owner[i] === undefined ? undefined : fileLabels[owner[i]!]));
  else return;
  const wanted = effectiveLabels(labels);
  const current = main && fileLabels ? readPageLabels(main, n)! : Array.from({ length: n }, (_, i) => String(i + 1));
  if (same(wanted, current)) return;
  const catalog = overlay.editCatalog();
  const isDefault = same(wanted, Array.from({ length: n }, (_, i) => String(i + 1)));
  if (isDefault) {
    catalog.delete("PageLabels");
    return;
  }
  const nums: PdfObj[] = [];
  for (const r of labelRanges(wanted)) {
    const d = new PdfDict();
    if (r.style) d.set("S", PdfName.of(r.style));
    if (r.prefix) d.set("P", pdfText(r.prefix));
    if (r.style && r.start !== 1) d.set("St", r.start);
    nums.push(r.page, d);
  }
  catalog.set("PageLabels", new PdfDict({ Nums: nums }));
}

