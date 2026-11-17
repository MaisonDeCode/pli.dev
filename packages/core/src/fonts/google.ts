import { GOOGLE_DATA, GOOGLE_RANGES, GOOGLE_SUBSETS } from "./google-data";
import type { FontCategory, FontFamily } from "./types";

const CATEGORY: Record<string, FontCategory> = { s: "sans-serif", r: "serif", d: "display", m: "monospace", h: "handwriting" };

/** The unicode ranges of the scripts that are a single file each (`latin`, `cyrillic`, `hebrew`...). */
export const SUBSET_RANGES: Readonly<Record<string, string>> = GOOGLE_RANGES;

let cache: readonly FontFamily[] | undefined;

/**
 * The Google Fonts families Pli ships a list of (open licences only, most popular first). This is the catalogue, not
 * the files: nothing is downloaded until a family is used. Decoded on first use.
 */
export function googleFonts(): readonly FontFamily[] {
  if (cache) return cache;
  const subsetNames = GOOGLE_SUBSETS.split("|");
  const families: FontFamily[] = [];
  const lines = GOOGLE_DATA.split("\n");
  for (let rank = 0; rank < lines.length; rank++) {
    const [family, cat, weights, flags, subsets, id] = lines[rank]!.split(";") as [string, string, string, string, string, string | undefined];
    families.push({
      family,
      category: CATEGORY[cat] ?? "sans-serif",
      origin: "google",
      weights: [...weights].map((d) => Number(d) * 100),
      italic: flags.includes("i"),
      subsets: subsets === "" ? [] : subsets.split(",").map((n) => subsetNames[Number(n)]!),
      id: id ?? family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      rank,
      fallbacks: [],
    });
  }
  cache = families;
  return families;
}
