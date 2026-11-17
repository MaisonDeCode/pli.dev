/** The parts of a TrueType font a PDF needs: which glyph each character has, how wide it is, and how the font sits on a line. */
export interface TrueTypeFont {
  /** The font file, as it is stored in the PDF. */
  bytes: Uint8Array;
  unitsPerEm: number;
  glyphCount: number;
  /** The glyph for a code point, or 0 (the "missing" glyph) when the font has none. */
  glyphFor(codePoint: number): number;
  /** A glyph's advance, in font units. */
  advance(glyph: number): number;
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  bbox: [number, number, number, number];
  /** The PostScript name, used as the PDF font's name. */
  name: string;
}

const u16 = (v: DataView, at: number) => v.getUint16(at);
const i16 = (v: DataView, at: number) => v.getInt16(at);
const u32 = (v: DataView, at: number) => v.getUint32(at);

/**
 * Reads a TrueType font (`.ttf`, or the first font of a `.ttc`). Fonts with PostScript outlines (`.otf` with CFF) can't
 * go in a PDF this way and are refused, as is anything that isn't a font.
 */
export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string): never => {
    throw new Error(`Not a usable TrueType font: ${why}`);
  };
  if (bytes.length < 12) fail("too short");
  let base = 0;
  if (u32(view, 0) === 0x74746366) base = u32(view, 12); // 'ttcf': the first font
  const tag = u32(view, base);
  if (tag === 0x4f54544f) fail("it has PostScript outlines (OpenType CFF)");
  if (tag !== 0x00010000 && tag !== 0x74727565) fail("unknown file type");
  const count = u16(view, base + 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i;
    if (at + 16 > bytes.length) fail("the table directory runs off the end");
    const name = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    tables.set(name, { offset: u32(view, at + 8), length: u32(view, at + 12) });
  }
  const need = (name: string) => tables.get(name) ?? fail(`it has no '${name}' table`);
  const head = need("head");
  const hhea = need("hhea");
  const hmtx = need("hmtx");
  const maxp = need("maxp");
  const cmap = need("cmap");
  if (!tables.has("glyf")) fail("it has no outlines");
  const unitsPerEm = u16(view, head.offset + 18) || 1000;
  const glyphCount = u16(view, maxp.offset + 4);
  const bbox: [number, number, number, number] = [i16(view, head.offset + 36), i16(view, head.offset + 38), i16(view, head.offset + 40), i16(view, head.offset + 42)];
  const ascent = i16(view, hhea.offset + 4);
  const descent = i16(view, hhea.offset + 6);
  const metrics = u16(view, hhea.offset + 34);

  // The OS/2 table has the cap height in version 2 and later.
  let capHeight = Math.round(ascent * 0.7);
  const os2 = tables.get("OS/2");
  if (os2 && u16(view, os2.offset) >= 2 && os2.length >= 90) capHeight = i16(view, os2.offset + 88) || capHeight;
  const post = tables.get("post");
  const italicAngle = post ? view.getInt32(post.offset + 4) / 65536 : 0;

  // The best character map there is: Unicode with every plane, else the basic Unicode one.
  let chosen: { offset: number; format: number } | null = null;
  const subtables = u16(view, cmap.offset + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = u16(view, cmap.offset + 4 + 8 * i);
    const encoding = u16(view, cmap.offset + 6 + 8 * i);
    const offset = cmap.offset + u32(view, cmap.offset + 8 + 8 * i);
    const format = u16(view, offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!chosen || format === 12) chosen = { offset, format };
  }
  if (!chosen) fail("it has no Unicode character map");
  const map = chosen!;

  const glyphFor = (code: number): number => {
    if (map.format === 12) {
      const groups = u32(view, map.offset + 12);
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = map.offset + 16 + 12 * mid;
        if (code < u32(view, at)) hi = mid - 1;
        else if (code > u32(view, at + 4)) lo = mid + 1;
        else return u32(view, at + 8) + (code - u32(view, at));
      }
      return 0;
    }
    if (code > 0xffff) return 0;
    const segments = u16(view, map.offset + 6) / 2;
    const ends = map.offset + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      if (code > u16(view, ends + 2 * s)) continue;
      if (code < u16(view, starts + 2 * s)) return 0;
      const range = u16(view, ranges + 2 * s);
      if (range === 0) return (code + i16(view, deltas + 2 * s)) & 0xffff;
      const glyph = u16(view, ranges + 2 * s + range + 2 * (code - u16(view, starts + 2 * s)));
      return glyph === 0 ? 0 : (glyph + i16(view, deltas + 2 * s)) & 0xffff;
    }
    return 0;
  };

  const advance = (glyph: number): number => {
    const g = Math.min(Math.max(glyph, 0), Math.max(metrics - 1, 0));
    return u16(view, hmtx.offset + 4 * g);
  };

  // The PostScript name (name id 6), else a plain one.
  let name = "Embedded";
  const names = tables.get("name");
  if (names) {
    const stringsAt = names.offset + u16(view, names.offset + 4);
    for (let i = 0; i < u16(view, names.offset + 2); i++) {
      const at = names.offset + 6 + 12 * i;
      if (u16(view, at + 6) !== 6) continue;
      const platform = u16(view, at);
      const length = u16(view, at + 8);
      const start = stringsAt + u16(view, at + 10);
      let text = "";
      if (platform === 1) for (let k = 0; k < length; k++) text += String.fromCharCode(bytes[start + k]!);
      else for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(u16(view, start + k));
      if (text) name = text;
      break;
    }
  }
  name = name.replace(/[^A-Za-z0-9-]/g, "") || "Embedded";

  return { bytes, unitsPerEm, glyphCount, glyphFor, advance, ascent, descent, capHeight, italicAngle, bbox, name };
}
