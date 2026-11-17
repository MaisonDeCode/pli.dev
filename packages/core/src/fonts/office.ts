import type { FontCategory, FontFamily } from "./types";

type Row = [family: string, category: FontCategory, weights: string, italic: boolean, fallbacks: string[], aliases?: string[]];

/**
 * The fonts Word, Excel, PowerPoint and the common operating systems ship with. They are never downloaded, and the
 * fallbacks are what a computer without the font draws: first a metric-compatible open font (same width for every
 * character, so lines break in the same places), then the nearest installed look.
 *
 * Metric-compatible pairs: Calibri/Carlito, Cambria/Caladea, Arial/Arimo, Times New Roman/Tinos, Courier New/Cousine,
 * Georgia/Gelasio. The other fallbacks are only similar.
 */
const ROWS: Row[] = [
  ["Arial", "sans-serif", "47", true, ["Arimo", "Liberation Sans", "Helvetica", "Helvetica Neue"], ["ArialMT", "Arial MT"]],
  ["Arial Black", "sans-serif", "9", false, ["Arial", "Archivo Black", "Helvetica"]],
  ["Arial Narrow", "sans-serif", "47", true, ["Arimo", "Liberation Sans Narrow", "Roboto Condensed", "Arial"]],
  ["Aptos", "sans-serif", "3467", true, ["Segoe UI", "Calibri", "Carlito", "Arial"]],
  ["Aptos Display", "sans-serif", "4", false, ["Aptos", "Segoe UI", "Calibri", "Arial"]],
  ["Book Antiqua", "serif", "47", true, ["Palatino Linotype", "Palatino", "Tinos", "Georgia"]],
  ["Bookman Old Style", "serif", "47", true, ["Bookman", "Georgia", "Tinos"]],
  ["Calibri", "sans-serif", "347", true, ["Carlito", "Segoe UI", "Open Sans", "Arial"]],
  ["Calibri Light", "sans-serif", "3", true, ["Carlito", "Calibri", "Segoe UI", "Arial"]],
  ["Cambria", "serif", "47", true, ["Caladea", "Georgia", "Times New Roman"]],
  ["Candara", "sans-serif", "47", true, ["Calibri", "Carlito", "Segoe UI", "Arial"]],
  ["Century Gothic", "sans-serif", "47", true, ["Questrial", "Poppins", "Avenir", "Arial"]],
  ["Comic Sans MS", "handwriting", "47", true, ["Comic Neue", "Chalkboard SE", "Comic Sans"]],
  ["Consolas", "monospace", "47", true, ["Inconsolata", "Menlo", "Courier New"]],
  ["Constantia", "serif", "47", true, ["Georgia", "Gelasio", "Times New Roman"]],
  ["Corbel", "sans-serif", "47", true, ["Calibri", "Carlito", "Segoe UI", "Arial"]],
  ["Courier", "monospace", "47", true, ["Courier New", "Cousine"]],
  ["Courier New", "monospace", "47", true, ["Cousine", "Liberation Mono", "Courier"]],
  ["Franklin Gothic Medium", "sans-serif", "5", true, ["Libre Franklin", "Arial"]],
  ["Garamond", "serif", "47", true, ["EB Garamond", "Cormorant Garamond", "Georgia", "Times New Roman"]],
  ["Georgia", "serif", "47", true, ["Gelasio", "Times New Roman"]],
  ["Gill Sans MT", "sans-serif", "47", true, ["Gill Sans", "Lato", "Arial"]],
  ["Helvetica", "sans-serif", "47", true, ["Arial", "Arimo", "Liberation Sans"]],
  ["Helvetica Neue", "sans-serif", "1234567", true, ["Helvetica", "Arial", "Arimo"]],
  ["Impact", "display", "5", false, ["Anton", "Haettenschweiler", "Arial Black"]],
  ["Lucida Console", "monospace", "4", false, ["Courier New", "Cousine", "Monaco"]],
  ["Lucida Sans Unicode", "sans-serif", "4", false, ["Lucida Grande", "Arial", "Arimo"]],
  ["Menlo", "monospace", "47", true, ["Monaco", "Consolas", "Courier New"]],
  ["Monaco", "monospace", "4", false, ["Menlo", "Consolas", "Courier New"]],
  ["Palatino Linotype", "serif", "47", true, ["Palatino", "Book Antiqua", "Tinos", "Georgia"], ["Palatino"]],
  ["Rockwell", "serif", "47", true, ["Roboto Slab", "Zilla Slab", "Georgia"]],
  ["Brush Script MT", "handwriting", "4", true, ["Dancing Script", "Pacifico", "Comic Sans MS"]],
  ["Segoe Print", "handwriting", "47", false, ["Caveat", "Comic Neue", "Comic Sans MS"]],
  ["Segoe Script", "handwriting", "47", false, ["Dancing Script", "Pacifico", "Comic Sans MS"]],
  ["Segoe UI", "sans-serif", "3467", true, ["Selawik", "Open Sans", "Helvetica Neue", "Arial"]],
  ["Tahoma", "sans-serif", "47", false, ["Noto Sans", "DejaVu Sans", "Verdana", "Arial"]],
  ["Times New Roman", "serif", "47", true, ["Tinos", "Liberation Serif", "Times"], ["Times", "TimesNewRomanPSMT"]],
  ["Trebuchet MS", "sans-serif", "47", true, ["Fira Sans", "Lucida Grande", "Arial"]],
  ["Verdana", "sans-serif", "47", true, ["DejaVu Sans", "Geneva", "Arial"]],
];

const WEIGHTS = (digits: string) => [...digits].map((d) => Number(d) * 100);

/** The Office and web-safe families, in the order a picker shows them. */
export const SYSTEM_FONTS: readonly FontFamily[] = ROWS.map(([family, category, weights, italic, fallbacks, aliases]) => ({
  family,
  category,
  origin: "system" as const,
  weights: WEIGHTS(weights),
  italic,
  subsets: [],
  fallbacks,
  ...(aliases ? { aliases } : {}),
  office: family,
}));

/**
 * The older names fonts have in files (and what generic CSS names mean), mapped to the family they are. Anything
 * not listed keeps its own name.
 */
export const FONT_ALIASES: Readonly<Record<string, string>> = {
  arialmt: "Arial",
  "arial mt": "Arial",
  "arial-boldmt": "Arial",
  "times": "Times New Roman",
  timesnewromanpsmt: "Times New Roman",
  "times new roman ps": "Times New Roman",
  "courier new ps": "Courier New",
  couriernewpsmt: "Courier New",
  "helvetica neue light": "Helvetica Neue",
  "segoe ui light": "Segoe UI",
  "segoe ui semibold": "Segoe UI",
  "calibri (body)": "Calibri",
  "calibri (headings)": "Calibri Light",
  "cambria (headings)": "Cambria",
  "cambria (body)": "Cambria",
  "system-ui": "Segoe UI",
  "-apple-system": "Helvetica Neue",
  "sans-serif": "Arial",
  serif: "Times New Roman",
  monospace: "Courier New",
};
