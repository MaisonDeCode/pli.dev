/** Saving bytes as files: a download, several downloads, or one ZIP of them. No dependencies. */
import { PliError } from "@pli.dev/core";
import { browseFiles } from "@pli.dev/react";

/** A file name that is safe on every system: no slashes or control characters, no leading dots, not empty. */
export function safeName(name: string, fallback = "document"): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").replace(/^\.+/, "").trim();
  return clean || fallback;
}

/** The name without `.pdf` (or any extension of up to five characters). */
export function fileStem(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** Hands bytes to the browser as a file download. Needs a browser (`URL.createObjectURL`). */
export function downloadBytes(bytes: Uint8Array, name: string, mime = "application/pdf"): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof document === "undefined") {
    throw new PliError("unsupported", "Downloads are not available here.");
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const link = Object.assign(document.createElement("a"), { href: url, download: safeName(name) });
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL?.(url), 4000);
}

export interface NamedFile {
  name: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP file holding the files as they are (stored, not compressed: PDFs are compressed already). */
export function makeZip(files: readonly NamedFile[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = (Math.max(0, now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const f of files) {
    let name = safeName(f.name, "file");
    for (let k = 2; used.has(name); k++) name = safeName(f.name).replace(/(\.[^.]*)?$/, `-${k}$1`);
    used.add(name);
    const nameBytes = enc.encode(name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, f.data);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, time, true);
    head.setUint16(14, date, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, f.data.length, true);
    head.setUint32(24, f.data.length, true);
    head.setUint16(28, nameBytes.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), nameBytes);
    offset += 30 + nameBytes.length + f.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reads the files out of a ZIP made by `makeZip` (stored entries only). For tests and for hosts that want to check one. */
export function readZip(bytes: Uint8Array): NamedFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out: NamedFile[] = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    out.push({ name, data: bytes.slice(start, start + size) });
    at = start + size;
  }
  return out;
}

/**
 * Downloads several files: one ZIP when `zip` is true (or by default for more than one), else one download after the
 * other. Returns the names of what was downloaded.
 */
export async function downloadFiles(files: readonly NamedFile[], options: { zip?: boolean; zipName?: string; download?: (bytes: Uint8Array, name: string, mime: string) => void | Promise<void> } = {}): Promise<string[]> {
  const send = options.download ?? downloadBytes;
  if (files.length === 0) return [];
  if (files.length > 1 && options.zip !== false) {
    const name = options.zipName ?? "pages.zip";
    await send(makeZip(files), name, "application/zip");
    return [name];
  }
  const names: string[] = [];
  for (const f of files) {
    await send(f.data, f.name, "application/pdf");
    names.push(f.name);
    // Browsers ask before allowing many downloads at once: leave a moment between them.
    if (files.length > 1) await new Promise((r) => setTimeout(r, 120));
  }
  return names;
}

/** The document's file name: the name it was given, or the name of the file it was opened from. */
export function documentName(doc: { name?: string; sources: readonly { id: string; name: string }[] }): string {
  const main = doc.sources.find((s) => s.id === "main") ?? doc.sources[0];
  return doc.name || main?.name || "document.pdf";
}

/** Shows the browser's file chooser and resolves with the chosen files (none when it is cancelled). Call it from a click. */
export function pickFiles(options: { accept: string; multiple?: boolean }): Promise<File[]> {
  return browseFiles(options);
}
