/** Test helper: everything in a file as text, to prove that something is NOT in it. */
import { PdfFile } from "../../src/cos/file";
import { decodeStream } from "../../src/cos/filters";
import { PdfStream, bytesToLatin1 } from "../../src/cos/objects";
import { serializeObject } from "../../src/cos/writer";

/** The file's raw bytes, and every object (strings, names, dictionaries) and every decoded stream of every object, including those inside object streams. */
export function everything(bytes: Uint8Array): string[] {
  const out: string[] = [bytesToLatin1(bytes)];
  const file = PdfFile.open(bytes);
  for (const n of file.objectNumbers()) {
    const o = file.getRef(n);
    out.push(bytesToLatin1(serializeObject(o instanceof PdfStream ? o.dict : o)));
    if (o instanceof PdfStream) {
      try {
        out.push(bytesToLatin1(decodeStream(o, (x) => file.get(x))));
      } catch {
        out.push(bytesToLatin1(o.data));
      }
    }
  }
  return out;
}

/** True when `word` occurs anywhere in the file: plain, or as UTF-16BE (as PDF text strings and ToUnicode maps write it), or as hex. */
export function contains(bytes: Uint8Array, word: string): boolean {
  const utf16 = [...word].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const hex = [...word].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return everything(bytes).some((s) => s.includes(word) || s.toLowerCase().includes(utf16) || s.toLowerCase().includes(hex));
}
