/**
 * The fonts form appearances are drawn with. A field names its font in `/DA` (`/Helv 12 Tf`), a resource of the
 * AcroForm's `/DR`. We reuse that font object when it can show the text, else a standard font (added to `/DR`), else a
 * TrueType file from `SaveOptions.fonts` (embedded whole, so that a reader that edits the field still has the glyphs).
 */
import type { WriteContext } from "../context";
import type { ContentBuilder } from "../cos/content";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isNum, isRef } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { addStandardFont, encodeWinAnsi, standardWidth, winAnsiCode } from "../fonts/standard";
import { embedTrueType } from "../fonts/embed";
import type { EmbeddedFont } from "../fonts/embed";
import { DR_NAMES, fileKeyFor, standardChoice, stripSubset } from "./names";
import { editChild } from "./edit";

/** A font as the appearance code uses it. */
export interface FieldFont {
  /** The name in the stream's `/Resources /Font`, and in `/DA`. */
  name: string;
  ref: PdfRef;
  /** The font's own name (`Helvetica`). */
  baseFont: string;
  width(text: string, size: number): number;
  show(c: ContentBuilder, text: string): void;
  canShow(text: string): boolean;
  /** Ascent as a fraction of the size (above the baseline). */
  ascent: number;
}

/** Whether WinAnsi has a character for every one in the text (a `?` that was typed is fine). */
export function winAnsiSupports(text: string): boolean {
  for (const ch of text) if (winAnsiCode(ch) === 63 && ch !== "?") return false;
  return true;
}

function simpleFont(name: string, ref: PdfRef, dict: PdfDict, get: (o: PdfObj | undefined) => PdfObj): FieldFont {
  const base = get(dict.get("BaseFont"));
  const baseFont = isName(base) ? stripSubset(base.value) : "Helvetica";
  const std = standardChoice(baseFont) ?? { family: "Helvetica" as const, style: { bold: /bold/i.test(baseFont), italic: /italic|oblique/i.test(baseFont) }, name: "Helvetica" };
  const subtype = get(dict.get("Subtype"));
  const symbolic = /symbol|dingbats/i.test(baseFont);
  const type0 = isName(subtype, "Type0") || isName(subtype, "Type3");
  const widthsObj = get(dict.get("Widths"));
  const widths = isArray(widthsObj) ? widthsObj.map((w) => (isNum(get(w)) ? (get(w) as number) : 0)) : undefined;
  const firstChar = get(dict.get("FirstChar"));
  const first = isNum(firstChar) ? firstChar : 0;
  const descriptor = get(dict.get("FontDescriptor"));
  const missing = isDict(descriptor) && isNum(get(descriptor.get("MissingWidth"))) ? (get(descriptor.get("MissingWidth")) as number) : undefined;
  const enc = get(dict.get("Encoding"));
  // Codes above 127 mean what WinAnsi says only when the font says WinAnsi.
  const winAnsi = isName(enc, "WinAnsiEncoding");
  const codeWidth = (code: number): number => {
    const i = code - first;
    if (widths && i >= 0 && i < widths.length) return widths[i]!;
    return missing ?? standardWidth(code, std.family, std.style);
  };
  const canShow = (text: string): boolean => {
    if (symbolic || type0) return false;
    for (const ch of text) {
      const code = winAnsiCode(ch);
      if (code === 63 && ch !== "?") return false;
      if (code > 127 && !winAnsi) return false;
    }
    return true;
  };
  return {
    name,
    ref,
    baseFont,
    ascent: 0.9,
    canShow,
    width(text, size) {
      let w = 0;
      for (const code of encodeWinAnsi(text)) w += codeWidth(code);
      return (w * size) / 1000;
    },
    show(c, text) {
      c.showText(encodeWinAnsi(text));
    },
  };
}

/** The fonts of one save: finds, adds and measures them. */
export class FormFonts {
  readonly #ctx: WriteContext;
  readonly #form: () => PdfDict;
  readonly #embedded = new Map<string, { font: EmbeddedFont; name: string }>();
  readonly #warned = new Set<string>();

  constructor(ctx: WriteContext, editForm: () => PdfDict) {
    this.#ctx = ctx;
    this.#form = editForm;
  }

  #get = (o: PdfObj | undefined): PdfObj => this.#ctx.overlay.get(o);

  /** `/DR /Font` as it is now (read only), or undefined. */
  #drFonts(): PdfDict | undefined {
    const catalog = this.#ctx.overlay.catalog();
    const form = this.#get(catalog.get("AcroForm"));
    if (!isDict(form)) return undefined;
    const dr = this.#get(form.get("DR"));
    const fonts = isDict(dr) ? this.#get(dr.get("Font")) : null;
    return isDict(fonts) ? fonts : undefined;
  }

  /** A font of the AcroForm's resources by its resource name. */
  byResource(resource: string): FieldFont | undefined {
    const fonts = this.#drFonts();
    const entry = fonts?.get(resource);
    if (!fonts || !isRef(entry)) return undefined;
    const d = this.#get(entry);
    return isDict(d) ? simpleFont(resource, entry, d, this.#get) : undefined;
  }

  /** A font of the AcroForm's resources by its `/BaseFont`. */
  byBaseFont(baseFont: string): FieldFont | undefined {
    const fonts = this.#drFonts();
    if (!fonts) return undefined;
    for (const [k, v] of fonts.map) {
      if (!isRef(v)) continue;
      const d = this.#get(v);
      if (!isDict(d)) continue;
      const b = this.#get(d.get("BaseFont"));
      if (isName(b) && stripSubset(b.value) === baseFont) return simpleFont(k, v, d, this.#get);
    }
    return undefined;
  }

  #register(name: string, ref: PdfRef): void {
    const fonts = editChild(this.#ctx.overlay, editChild(this.#ctx.overlay, this.#form(), "DR"), "Font");
    fonts.set(name, ref);
  }

  #freeName(base: string): string {
    const fonts = this.#drFonts();
    let n = base;
    for (let i = 2; fonts?.has(n); i++) n = `${base}${i}`;
    return n;
  }

  /** A standard font in the AcroForm's resources (added when it isn't there yet). */
  standard(name: string): FieldFont {
    const choice = standardChoice(name) ?? standardChoice("Helvetica")!;
    const known = this.byBaseFont(choice.name);
    if (known) return known;
    const ref = addStandardFont(this.#ctx.overlay, choice.family, choice.style);
    const resource = this.#freeName(DR_NAMES[choice.name] ?? "Helv");
    this.#register(resource, ref);
    const d = this.#get(ref);
    return simpleFont(resource, ref, d as PdfDict, this.#get);
  }

  /** ZapfDingbats for check marks (the font a checkbox's `/DA` names). */
  zapf(): string {
    const fonts = this.#drFonts();
    if (fonts?.has("ZaDb")) return "ZaDb";
    const ref = this.#ctx.overlay.add(new PdfDict({ Type: PdfName.of("Font"), Subtype: PdfName.of("Type1"), BaseFont: PdfName.of("ZapfDingbats") }));
    this.#register("ZaDb", ref);
    return "ZaDb";
  }

  #warnOnce(message: string): void {
    if (this.#warned.has(message)) return;
    this.#warned.add(message);
    this.#ctx.warnings.push(message);
  }

  #embed(family: string, text: string): FieldFont | undefined {
    const files = this.#ctx.options.fonts;
    if (!files) return undefined;
    const want = fileKeyFor(family);
    const keys = Object.keys(files);
    const styled = (k: string) => {
      const m = /^(.*?)(?: (bold italic|bold|italic))?$/.exec(k);
      return { family: m?.[1] ?? k, bold: !!m?.[2]?.includes("bold"), italic: !!m?.[2]?.includes("italic") };
    };
    const ranked = [...keys].sort((a, b) => {
      const score = (k: string) => {
        const s = styled(k);
        return (s.family.toLowerCase() === want.family.toLowerCase() ? 0 : 8) + (s.bold === want.bold ? 0 : 2) + (s.italic === want.italic ? 0 : 1);
      };
      return score(a) - score(b);
    });
    for (const key of ranked) {
      let slot = this.#embedded.get(key);
      if (!slot) {
        try {
          const s = styled(key);
          const font = embedTrueType(this.#ctx.overlay, files[key]!, { family: s.family, bold: s.bold, italic: s.italic, subset: false });
          const name = this.#freeName(`PliF${this.#embedded.size + 1}`);
          this.#register(name, font.ref);
          slot = { font, name };
          this.#embedded.set(key, slot);
        } catch {
          continue;
        }
      }
      const { font, name } = slot;
      let ok = true;
      for (const ch of text) if (ch.trim() !== "" && !font.hasGlyph(ch)) ok = false;
      if (!ok) continue;
      return {
        name,
        ref: font.ref,
        baseFont: font.family,
        ascent: font.ascent > 0 ? font.ascent : 0.9,
        canShow: (t) => [...t].every((ch) => ch.trim() === "" || font.hasGlyph(ch)),
        width: (t, size) => font.width(t, size),
        show: (c, t) => c.showGlyphs(font.encode(t)),
      };
    }
    return undefined;
  }

  /**
   * The font to draw `text` with. `resource` is what the field's `/DA` names, `family` the font asked for in the model
   * (`appearance.font`). `field` names the field in warnings.
   */
  resolve(req: { resource?: string; family?: string }, text: string, field: string): FieldFont {
    let current = req.resource ? this.byResource(req.resource) : undefined;
    if (req.family && (!current || stripSubset(current.baseFont) !== req.family)) {
      // the model asks for another font than the one /DA names
      const named = this.byBaseFont(req.family);
      if (named) current = named;
      else if (!standardChoice(req.family)) current = undefined;
      else if (!current || standardChoice(current.baseFont)?.name !== standardChoice(req.family)?.name) current = undefined;
    }
    if (current?.canShow(text)) return current;
    const family = req.family ?? current?.baseFont ?? "Helvetica";
    const std = standardChoice(family);
    if (!std) {
      const e = this.#embed(family, text);
      if (e) return e;
      this.#warnOnce(`The font ${family} (field ${field}) has no file: a standard font was used. Pass it in SaveOptions.fonts.`);
    }
    if (winAnsiSupports(text)) return this.standard(std?.name ?? "Helvetica");
    const e = this.#embed(family, text);
    if (e) return e;
    this.#warnOnce(`The text of field ${field} has characters outside Western European: they are drawn as ?. Pass a TrueType font in SaveOptions.fonts.`);
    return this.standard(std?.name ?? "Helvetica");
  }

  /** Writes the embedded fonts' tables: call it after the last appearance. */
  finish(): void {
    for (const { font } of this.#embedded.values()) font.finish();
  }
}
