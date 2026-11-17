/** Font names and check marks: the small vocabularies forms use. */
import { isDict, isName } from "../cos/objects";
import type { PdfDict } from "../cos/objects";
import type { FieldAppearance } from "../model";
import { standardFamilyFor, standardFontName } from "../fonts/standard";
import type { FontStyle, StandardFamily } from "../fonts/standard";
import type { Getter } from "./tree";

/** The resource names Acrobat gives the standard fonts in `/AcroForm /DR`. */
export const DR_NAMES: Record<string, string> = {
  "Helvetica": "Helv",
  "Helvetica-Bold": "HeBo",
  "Helvetica-Oblique": "HeOb",
  "Helvetica-BoldOblique": "HeBO",
  "Times-Roman": "TiRo",
  "Times-Bold": "TiBo",
  "Times-Italic": "TiIt",
  "Times-BoldItalic": "TiBI",
  "Courier": "Cour",
  "Courier-Bold": "CoBo",
  "Courier-Oblique": "CoOb",
  "Courier-BoldOblique": "CoBO",
};

const BY_RESOURCE = new Map(Object.entries(DR_NAMES).map(([k, v]) => [v, k]));

/** The base font name without the six letters and plus sign that mark a subset (`ABCDEF+Arial` is `Arial`). */
export const stripSubset = (name: string): string => name.replace(/^[A-Z]{6}\+/, "");

/** `/BaseFont` of a font dictionary, without a subset prefix. */
export function fontFamilyOfDict(g: Getter, font: PdfDict): string | undefined {
  const b = g.get(font.get("BaseFont"));
  return isName(b) ? stripSubset(b.value) : undefined;
}

export interface StandardChoice {
  family: StandardFamily;
  style: FontStyle;
  /** The PostScript name: `Helvetica-Bold`. */
  name: string;
}

/** The standard font a name stands for (`Helvetica`, `Arial-BoldMT`, `Helv`, `Times New Roman`), or undefined when it needs a font file. */
export function standardChoice(fontName: string | undefined): StandardChoice | undefined {
  if (!fontName) return undefined;
  const resource = BY_RESOURCE.get(fontName);
  const n = resource ?? stripSubset(fontName);
  if (!/^(helvetica|arial|helv|times|courier|cour)/i.test(n) && !resource) return undefined;
  const style: FontStyle = { bold: /bold|bo$/i.test(n), italic: /italic|oblique|ob$|it$/i.test(n) };
  const family = standardFamilyFor(n);
  return { family, style, name: standardFontName(family, style) };
}

/** The style and family a font name asks for, for picking a file out of `SaveOptions.fonts` (`Lora-Bold` is `Lora` bold). */
export function fileKeyFor(fontName: string): { family: string; bold: boolean; italic: boolean } {
  const n = stripSubset(fontName);
  const bold = /bold|black|heavy/i.test(n);
  const italic = /italic|oblique/i.test(n);
  const family = n.replace(/[-_ ]?(bold|italic|oblique|regular|roman|black|heavy|mt|ps)+$/gi, "").replace(/[-_]+$/, "") || n;
  return { family, bold, italic };
}

// ZapfDingbats characters of /MK /CA: check, cross, circle, square, diamond, star.
const STYLE_BY_CHAR: Record<string, NonNullable<FieldAppearance["checkStyle"]>> = { "4": "check", "8": "cross", "l": "circle", "n": "square", "u": "diamond", "H": "star" };
const CHAR_BY_STYLE: Record<NonNullable<FieldAppearance["checkStyle"]>, string> = { check: "4", cross: "8", circle: "l", square: "n", diamond: "u", star: "H" };

export const checkStyleOfChar = (c: string): FieldAppearance["checkStyle"] | undefined => STYLE_BY_CHAR[c.charAt(0)];
export const charOfCheckStyle = (s: NonNullable<FieldAppearance["checkStyle"]>): string => CHAR_BY_STYLE[s];

export { isDict };
