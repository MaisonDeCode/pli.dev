import { attr, child, isOfficeFont, officeHint, officeSubstitute, type XmlElement } from "@pli.dev/core";

/**
 * Font names in a file being written. A file always keeps the name a workbook has (`Lora` stays `Lora`) and carries, beside
 * it, a hint (`family`, `pitchFamily`) for computers that do not have the font. With `fonts: "office"` a family Office does
 * not ship is replaced by the nearest one it does.
 */
export type XlsxFontMode = "keep" | "office";

let mode: XlsxFontMode = "keep";

/** Sets how fonts are written until the next call (the file writer does this around each file it writes). */
export function setXlsxFontMode(next: XlsxFontMode | undefined): void {
  mode = next === "office" ? "office" : "keep";
}

/**
 * Families Windows and Office ship that the shared catalogue does not list, or that are not text at all (symbol fonts must
 * never be swapped for Arial). Theme references (`+mn-lt`) are kept as well.
 */
const OFFICE_ONLY = /^(\+|aptos|segoe|calibri|cambria|arial|times|courier|ms |microsoft|wingdings|webdings|symbol|marlett|bahnschrift|cascadia|sitka|nirmala|leelawadee|ebrima|gadugi|yu |meiryo|malgun|simsun|simhei|nsimsun|kaiti|fangsong|mingliu|batang|gulim|dotum|tw cen|perpetua|baskerville old|bodoni mt|calisto|goudy old|gloucester|haettenschweiler|maiandra|rockwell|lucida|palatino|trebuchet|verdana|georgia|tahoma|consolas|corbel|candara|constantia|franklin gothic|gill sans|garamond|book antiqua|bookman|century|impact|comic sans|brush script|monotype|niagara|onyx|playbill|stencil|vivaldi|vladimir|wide latin|algerian|bell mt|berlin sans|bernard|britannic|broadway|castellar|centaur|colonna|cooper black|copperplate|curlz|edwardian|elephant|engravers|eras|felix|footlight|forte|freestyle|french script|gigi|harrington|imprint|informal roman|jokerman|juice|kristen|magneto|matura|mistral|modern no|ocr a|old english|papyrus|parchment|pristina|ravie|rage|script mt|showcard|snap itc|tempus|viner|wingdings)/i;

/** The name to write for a family: itself, or under `fonts: "office"` the nearest font Office has when it has not the family. */
export function fileFont(name: string): string {
  if (mode !== "office" || isOfficeFont(name) || OFFICE_ONLY.test(name.trim())) return name;
  return officeSubstitute(name);
}

/** Excel's `<family val>` for a name written to the file (1 roman, 2 swiss, 3 modern, 4 script, 5 decorative). */
export function familyHint(name: string): number {
  return officeHint(name).xlsxFamily;
}

/** The `pitchFamily` DrawingML writes beside a typeface (`<a:latin typeface=… pitchFamily=… charset="0"/>`). */
export function pitchFamilyHint(name: string): number {
  return officeHint(name).pptxPitchFamily;
}

// ---- reading ----

/** The theme's font names, for a font that points at them (`<scheme val="minor"/>`) without naming one. */
let themeFonts: { major?: string; minor?: string } = {};

/** Notes the heading and body fonts of the theme part being read (`undefined` when the file has none). */
export function setThemeFonts(theme: XmlElement | undefined): void {
  const scheme = child(child(theme, "themeElements"), "fontScheme");
  const latin = (which: string) => {
    const face = attr(child(child(scheme, which), "latin"), "typeface");
    return face && !face.startsWith("+") ? face : undefined;
  };
  themeFonts = { major: latin("majorFont"), minor: latin("minorFont") };
}

/**
 * The family of a font element (`font` in a style sheet, `rPr` in rich text): the name it gives, or else the font of the
 * theme it points at. `nameTag` is `name` in styles and `rFont` in rich text.
 */
export function readFontName(font: XmlElement | undefined, nameTag: "name" | "rFont"): string | undefined {
  const name = attr(child(font, nameTag), "val");
  if (name) return name;
  const scheme = attr(child(font, "scheme"), "val");
  return scheme === "major" ? themeFonts.major : scheme === "minor" ? themeFonts.minor : undefined;
}
