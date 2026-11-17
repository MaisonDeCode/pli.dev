/** Font file formats, and how to turn the web's (WOFF) into the one a PDF needs (TrueType). */

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const tag = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

export type FontFileFormat = "ttf" | "otf" | "ttc" | "woff" | "woff2" | "unknown";

/** What kind of font file some bytes are, by their first four bytes. */
export function fontFileFormat(bytes: Uint8Array): FontFileFormat {
  if (bytes.length < 4) return "unknown";
  const t = tag(bytes, 0);
  if (t === "wOFF") return "woff";
  if (t === "wOF2") return "woff2";
  if (t === "OTTO") return "otf";
  if (t === "ttcf") return "ttc";
  if (u32(bytes, 0) === 0x00010000 || t === "true") return "ttf";
  return "unknown";
}

type StreamCtor = new (format: string) => { readable: unknown; writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> } } };

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const g = globalThis as unknown as { DecompressionStream?: StreamCtor; Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> } };
  if (!g.DecompressionStream || !g.Response) throw new Error("This environment can't decompress WOFF files");
  const stream = new g.DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(data).catch(() => undefined);
  void writer.close().catch(() => undefined);
  return new Uint8Array(await new g.Response(stream.readable).arrayBuffer());
}

/**
 * The `.ttf` (or `.otf`) bytes of a WOFF file: its tables are stored compressed and are written back as they were. A
 * file that is already TrueType comes back as it is; WOFF2 (Brotli) can't be unpacked here and is refused.
 */
export async function woffToSfnt(woff: Uint8Array): Promise<Uint8Array> {
  const format = fontFileFormat(woff);
  if (format === "ttf" || format === "otf" || format === "ttc") return woff;
  if (format === "woff2") throw new Error("WOFF2 files can't be converted; use a TrueType or WOFF file");
  if (format !== "woff") throw new Error("Not a font file");
  const flavor = u32(woff, 4);
  const count = u16(woff, 12);
  const tables: { tag: string; data: Uint8Array; checksum: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const offset = u32(woff, at + 4);
    const comp = u32(woff, at + 8);
    const orig = u32(woff, at + 12);
    if (offset + comp > woff.length) throw new Error("The WOFF file is cut short");
    const raw = woff.subarray(offset, offset + comp);
    const data = comp === orig ? raw : await inflate(raw);
    if (data.length !== orig) throw new Error("A table of the WOFF file has the wrong size");
    tables.push({ tag: tag(woff, at), data, checksum: u32(woff, at + 16) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const headerSize = 12 + 16 * tables.length;
  let total = headerSize;
  for (const t of tables) total += (t.data.length + 3) & ~3;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor);
  view.setUint16(4, tables.length);
  let power = 1;
  let log = 0;
  while (power * 2 <= tables.length) (power *= 2), log++;
  view.setUint16(6, power * 16);
  view.setUint16(8, log);
  view.setUint16(10, tables.length * 16 - power * 16);
  let at = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    view.setUint32(rec + 4, t.checksum);
    view.setUint32(rec + 8, at);
    view.setUint32(rec + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  return out;
}

/** TrueType bytes for a font file in any format this can read (null when it can't be: WOFF2, or not a font). */
export async function toTrueType(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    return await woffToSfnt(bytes);
  } catch {
    return null;
  }
}
