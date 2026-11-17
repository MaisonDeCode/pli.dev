import { lookupFont, primaryFamily } from "./catalogue";
import type { FontCategory, FontFamily } from "./types";

const GENERIC: Record<FontCategory, string> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  monospace: "monospace",
  display: "sans-serif",
  handwriting: "cursive",
};

const quote = (name: string) => (/^[A-Za-z][A-Za-z0-9-]*$/.test(name) && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(name) ? name : `"${name.replace(/["\\]/g, "")}"`);

/** The category of a name the catalogue doesn't know, guessed from the name (so unknown fonts still fall back sensibly). */
export function guessCategory(name: string): FontCategory {
  const n = name.toLowerCase();
  if (/mono|courier|consolas|menlo|monaco|code|typewriter|terminal/.test(n)) return "monospace";
  if (/script|hand|brush|marker|cursive|calligraph/.test(n)) return "handwriting";
  if (/times|georgia|garamond|palatino|cambria|book|minion|charter|baskerville|didot|bodoni|serif/.test(n) && !/sans/.test(n)) return "serif";
  return "sans-serif";
}

/** The category of a family: the catalogue's if it has the family, a guess from the name if not. */
export function categoryOf(name: string): FontCategory {
  return lookupFont(name)?.category ?? guessCategory(name);
}

/** Whether every character of the family is the same width (so text can be measured without the font). */
export function isMonospace(name: string): boolean {
  return categoryOf(name) === "monospace";
}

/**
 * The CSS `font-family` value for a family: its own name, the fonts that stand in for it, and a generic family last,
 * so text is never drawn without a font. `"Calibri"` gives `Calibri, Carlito, "Segoe UI", "Open Sans", Arial, sans-serif`.
 * `extra` goes before the generic family (a host's own fallback, or the editor's default font).
 */
export function fontStack(name: string, extra: readonly string[] = [], known?: FontFamily): string {
  const family = known ?? lookupFont(name);
  const names = [primaryFamily(name) || name, ...(family?.fallbacks ?? []), ...extra];
  const unique = [...new Set(names.filter(Boolean))];
  return [...unique.map(quote), GENERIC[family?.category ?? guessCategory(name)]].join(", ");
}

/**
 * How wide a family's text is compared with Helvetica's (1 is the same), as far as can be told without the font file.
 * An estimate for laying text out before a font has loaded; the editors measure again once it has. Monospace is
 * handled by `isMonospace` (a fixed 0.6 em), not by this number.
 */
export function widthFactor(name: string): number {
  const family = lookupFont(name);
  const n = name.toLowerCase();
  if (/narrow|condensed|compressed|cond\b/.test(n)) return 0.82;
  if (/extended|expanded|wide/.test(n)) return 1.18;
  if (family?.origin === "system") return 1;
  switch (family?.category ?? guessCategory(name)) {
    case "serif":
      return 0.96;
    case "display":
      return 1.06;
    case "handwriting":
      return 0.97;
    default:
      return 1;
  }
}

/** The nearest of the 14 standard PDF fonts' families: what a PDF falls back to when a font's file isn't embedded. */
export function standardPdfFamily(name: string): "Helvetica" | "Times" | "Courier" {
  const category = categoryOf(name);
  return category === "monospace" ? "Courier" : category === "serif" ? "Times" : "Helvetica";
}

// ---- Office -------------------------------------------------------------------------------------------------------

/** What the Office formats write beside a font name so that a computer without the font picks a similar one. */
export interface OfficeHint {
  /** Word's `w:family` in `fontTable.xml`. */
  docxFamily: "roman" | "swiss" | "modern" | "script" | "decorative";
  /** Word's `w:pitch`. */
  docxPitch: "fixed" | "variable";
  /** Excel's `<family val>` (1 roman, 2 swiss, 3 modern, 4 script, 5 decorative). */
  xlsxFamily: 1 | 2 | 3 | 4 | 5;
  /** PowerPoint's `pitchFamily` on `<a:latin>`: the pitch in the low bits, the family in the high ones (34 for Arial). */
  pptxPitchFamily: number;
}

export function officeHint(name: string): OfficeHint {
  switch (categoryOf(name)) {
    case "serif":
      return { docxFamily: "roman", docxPitch: "variable", xlsxFamily: 1, pptxPitchFamily: 18 };
    case "monospace":
      return { docxFamily: "modern", docxPitch: "fixed", xlsxFamily: 3, pptxPitchFamily: 49 };
    case "handwriting":
      return { docxFamily: "script", docxPitch: "variable", xlsxFamily: 4, pptxPitchFamily: 66 };
    case "display":
      return { docxFamily: "decorative", docxPitch: "variable", xlsxFamily: 5, pptxPitchFamily: 82 };
    default:
      return { docxFamily: "swiss", docxPitch: "variable", xlsxFamily: 2, pptxPitchFamily: 34 };
  }
}

/** Popular Google families and the Office font whose look is nearest. Everything else is chosen by category. */
const OFFICE_FOR: Record<string, string> = {
  roboto: "Arial", "open sans": "Segoe UI", lato: "Calibri", montserrat: "Century Gothic", poppins: "Century Gothic", inter: "Segoe UI",
  "source sans 3": "Calibri", "source sans pro": "Calibri", "noto sans": "Segoe UI", raleway: "Century Gothic", nunito: "Calibri", "nunito sans": "Calibri",
  "work sans": "Arial", "fira sans": "Trebuchet MS", "ubuntu": "Trebuchet MS", "pt sans": "Calibri", "dm sans": "Arial", "mulish": "Calibri",
  "rubik": "Arial", "karla": "Arial", "barlow": "Arial", "quicksand": "Century Gothic", "josefin sans": "Century Gothic", "oswald": "Impact",
  "bebas neue": "Impact", "anton": "Impact", "archivo black": "Arial Black", "lora": "Georgia", "merriweather": "Georgia", "playfair display": "Georgia",
  "pt serif": "Georgia", "crimson text": "Garamond", "eb garamond": "Garamond", "cormorant garamond": "Garamond", "libre baskerville": "Georgia",
  "noto serif": "Georgia", "source serif 4": "Georgia", "roboto slab": "Rockwell", "zilla slab": "Rockwell", "bitter": "Rockwell", "arvo": "Rockwell",
  "roboto mono": "Consolas", "source code pro": "Consolas", "fira code": "Consolas", "jetbrains mono": "Consolas", "inconsolata": "Consolas",
  "ibm plex mono": "Consolas", "space mono": "Courier New", "courier prime": "Courier New", "dancing script": "Segoe Script", "pacifico": "Segoe Script",
  "caveat": "Segoe Print", "lobster": "Segoe Script", "comic neue": "Comic Sans MS", "carlito": "Calibri", "caladea": "Cambria", "arimo": "Arial",
  "tinos": "Times New Roman", "cousine": "Courier New", "gelasio": "Georgia",
};

/**
 * The Office font a file should name for a family when it will be opened by people who may not have it: the family
 * itself for an Office font, a metric-compatible twin's original (Carlito is Calibri), the nearest look for a popular
 * Google family, and otherwise Arial, Times New Roman, Courier New or Comic Sans MS by category.
 */
export function officeSubstitute(name: string): string {
  const family = lookupFont(name);
  if (family?.origin === "system") return family.family;
  const named = OFFICE_FOR[(family?.family ?? name).toLowerCase()];
  if (named) return named;
  switch (family?.category ?? guessCategory(name)) {
    case "serif":
      return "Times New Roman";
    case "monospace":
      return "Courier New";
    case "handwriting":
      return "Comic Sans MS";
    default:
      return "Arial";
  }
}

/** Whether Word, Excel and PowerPoint have the font (so a file naming it needs no stand-in). */
export function isOfficeFont(name: string): boolean {
  return lookupFont(name)?.origin === "system";
}

/** Convenience: the entry for a name, if any. */
export function fontInfo(name: string): FontFamily | undefined {
  return lookupFont(name);
}
