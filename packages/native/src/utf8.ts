/** UTF-8 without `TextEncoder` and `TextDecoder`, which JavaScriptCore and QuickJS don't have. */

export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Text(b: Uint8Array): string {
  let out = "";
  let chunk: number[] = [];
  for (let i = 0; i < b.length; ) {
    const a = b[i++]!;
    let c: number;
    if (a < 0x80) c = a;
    else if (a >= 0xc2 && a < 0xe0 && i < b.length) c = ((a & 31) << 6) | (b[i++]! & 63);
    else if (a >= 0xe0 && a < 0xf0 && i + 1 < b.length) c = ((a & 15) << 12) | ((b[i++]! & 63) << 6) | (b[i++]! & 63);
    else if (a >= 0xf0 && a < 0xf5 && i + 2 < b.length) c = ((a & 7) << 18) | ((b[i++]! & 63) << 12) | ((b[i++]! & 63) << 6) | (b[i++]! & 63);
    else c = 0xfffd;
    if (c >= 0x10000) {
      c -= 0x10000;
      chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else chunk.push(c);
    if (chunk.length > 4096) {
      out += String.fromCharCode(...chunk);
      chunk = [];
    }
  }
  return out + String.fromCharCode(...chunk);
}
