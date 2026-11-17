/**
 * PDF objects to bytes: `serializeObject`, and the two ways of writing a whole file from an `Overlay`: `writeIncremental`
 * (the original bytes untouched, changes appended) and `writeRewrite` (a new file from the reachable objects). The
 * `Overlay` methods `incremental()` and `rewrite()` call these.
 */
import { PliError } from "@pli.dev/core";
import { zlibSync } from "fflate";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, isArray, isDict, isName, isRef, isStream, latin1Bytes } from "./objects";
import type { PdfObj } from "./objects";
import { Overlay } from "./overlay";

// ---- bytes ---------------------------------------------------------------------------------------------------------

/** A growing byte buffer. */
export class ByteWriter {
  buf: Uint8Array;
  length = 0;
  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
  }
  #room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.#room(1);
    this.buf[this.length++] = b;
  }
  /** Writes a string of single-byte characters (anything above 255 is cut to its low byte). */
  ascii(s: string): void {
    this.#room(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i) & 255;
  }
  bytes(b: Uint8Array): void {
    this.#room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** A number the way a PDF writes it: no exponent, at most 5 decimals, trailing zeros trimmed. Not finite numbers give 0. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? String(n === 0 ? 0 : n) : BigInt(n).toString();
  if (Math.abs(n) >= 1e21) return BigInt(Math.round(n)).toString();
  const s = n.toFixed(5).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

const DELIMITERS = new Set("()<>[]{}/%#".split("").map((c) => c.charCodeAt(0)));
const utf8 = new TextEncoder();
const HEX = "0123456789abcdef";

/** What the writer does besides writing. */
export interface SerializeOptions {
  /** Called for every reference written: return the reference to write instead, or null to write `null`. */
  mapRef?: (ref: PdfRef) => PdfRef | null;
  /** Compress the data of streams that have no `Filter` with Flate (when that makes them smaller). */
  compress?: boolean;
  /** Encrypts every string and stream of an object (given the bytes, returns the bytes to write). */
  encrypt?: { string(bytes: Uint8Array): Uint8Array; stream(bytes: Uint8Array, dict?: PdfDict): Uint8Array };
}

function writeName(w: ByteWriter, value: string): void {
  w.byte(0x2f);
  for (const b of utf8.encode(value)) {
    if (b > 0x20 && b < 0x7f && !DELIMITERS.has(b)) w.byte(b);
    else {
      w.byte(0x23);
      w.byte(HEX.charCodeAt(b >> 4));
      w.byte(HEX.charCodeAt(b & 15));
    }
  }
}

function writeString(w: ByteWriter, s: PdfString, enc?: SerializeOptions["encrypt"]): void {
  const bytes = enc ? enc.string(s.bytes) : s.bytes;
  if (s.hex) {
    w.byte(0x3c);
    for (const b of bytes) {
      w.byte(HEX.charCodeAt(b >> 4));
      w.byte(HEX.charCodeAt(b & 15));
    }
    w.byte(0x3e);
    return;
  }
  w.byte(0x28);
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) {
      w.byte(0x5c);
      w.byte(b);
    } else if (b === 0x0a) w.ascii("\\n");
    else if (b === 0x0d) w.ascii("\\r");
    else if (b < 0x20 || b === 0x7f) w.ascii("\\" + b.toString(8).padStart(3, "0"));
    else w.byte(b);
  }
  w.byte(0x29);
}

/** The data a stream is written with: compressed when asked to and worth it, and its dictionary to match. */
function streamParts(s: PdfStream, options: SerializeOptions): { dict: PdfDict; data: Uint8Array } {
  const dict = s.dict.clone();
  let data = s.data;
  dict.delete("Length");
  if (options.compress && !dict.has("Filter") && data.length > 24 && !isName(dict.get("Type"), "XRef")) {
    const z = zlibSync(data, { level: 6 });
    if (z.length < data.length) {
      data = z;
      dict.set("Filter", PdfName.of("FlateDecode"));
      dict.delete("DecodeParms");
    }
  }
  return { dict, data };
}

function writeObject(w: ByteWriter, o: PdfObj | undefined, options: SerializeOptions): void {
  if (o === null || o === undefined) w.ascii("null");
  else if (typeof o === "boolean") w.ascii(o ? "true" : "false");
  else if (typeof o === "number") w.ascii(formatNumber(o));
  else if (o instanceof PdfName) writeName(w, o.value);
  else if (o instanceof PdfString) writeString(w, o, options.encrypt);
  else if (o instanceof PdfRef) {
    const r = options.mapRef ? options.mapRef(o) : o;
    if (r) w.ascii(`${r.num} ${r.gen} R`);
    else w.ascii("null");
  } else if (isArray(o)) {
    w.byte(0x5b);
    for (let i = 0; i < o.length; i++) {
      if (i) w.byte(0x20);
      writeObject(w, o[i], options);
    }
    w.byte(0x5d);
  } else if (o instanceof PdfDict) writeDict(w, o, options);
  else if (o instanceof PdfStream) {
    const { dict, data } = streamParts(o, options);
    const out = options.encrypt ? options.encrypt.stream(data, dict) : data;
    dict.set("Length", out.length);
    writeDict(w, dict, options);
    w.ascii("\nstream\n");
    w.bytes(out);
    w.ascii("\nendstream");
  } else w.ascii("null");
}

function writeDict(w: ByteWriter, d: PdfDict, options: SerializeOptions): void {
  w.ascii("<<");
  for (const [k, v] of d.map) {
    if (v === null || v === undefined) continue;
    if (v instanceof PdfRef && options.mapRef && !options.mapRef(v)) continue;
    w.byte(0x20);
    writeName(w, k);
    w.byte(0x20);
    writeObject(w, v, options);
  }
  w.ascii(" >>");
}

/** One object as bytes (a stream with its `Length` set, `stream` and `endstream`). Not the `n g obj` wrapper. */
export function serializeObject(obj: PdfObj, options: SerializeOptions = {}): Uint8Array {
  const w = new ByteWriter();
  writeObject(w, obj, options);
  return w.toBytes();
}

/** `n g obj ... endobj`, appended to `w`. */
export function writeIndirect(w: ByteWriter, num: number, gen: number, obj: PdfObj, options: SerializeOptions = {}): void {
  w.ascii(`${num} ${gen} obj\n`);
  writeObject(w, obj, options);
  w.ascii("\nendobj\n");
}

// ---- small helpers -------------------------------------------------------------------------------------------------

/** 16 random bytes (for the file `/ID`); uses the platform's secure generator when there is one. */
export function randomId(): Uint8Array {
  const out = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < 16; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const BINARY_COMMENT = Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);

function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  return (a[0]! - b[0]! || a[1]! - b[1]!) >= 0;
}

/** Bytes needed for a non-negative integer. */
const widthOf = (n: number) => (n < 256 ? 1 : n < 65536 ? 2 : n < 16777216 ? 3 : 4);

function putUint(into: number[], value: number, width: number): void {
  for (let i = width - 1; i >= 0; i--) into.push(Math.floor(value / 2 ** (8 * i)) & 255);
}

/** Row data of an xref stream with the PNG "Up" predictor (12) applied, then Flate. */
function packXref(rows: number[][], columns: number): Uint8Array {
  const out = new Uint8Array(rows.length * (columns + 1));
  let prev = new Array<number>(columns).fill(0);
  rows.forEach((row, r) => {
    const at = r * (columns + 1);
    out[at] = 2;
    for (let i = 0; i < columns; i++) out[at + 1 + i] = (row[i]! - prev[i]! + 256) & 255;
    prev = row;
  });
  return zlibSync(out, { level: 6 });
}

/** A new file's trailer `/ID`: `[first second]` as hex strings. */
function idArray(first: Uint8Array, second: Uint8Array): PdfObj {
  return [new PdfString(first, true), new PdfString(second, true)];
}

// ---- incremental update --------------------------------------------------------------------------------------------

export interface IncrementalOptions {
  /** The second element of `/ID` (default: random). */
  id?: Uint8Array;
}

/** Where the newest cross-reference section of a file is, and which kind it is; `undefined` when the offset is no good. */
function newestSection(bytes: Uint8Array, offset: number): "table" | "stream" | undefined {
  if (!(offset > 0 && offset < bytes.length)) return undefined;
  let i = offset;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0)) i++;
  const head = String.fromCharCode(...bytes.subarray(i, Math.min(i + 24, bytes.length)));
  if (head.startsWith("xref")) return "table";
  if (/^\d+\s+\d+\s+obj/.test(head)) return "stream";
  return undefined;
}

/** Subsections `[start, count][]` of an ascending list of object numbers. */
function runs(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === n) last[1]++;
    else out.push([n, 1]);
  }
  return out;
}

/**
 * The base file's bytes unchanged, then the changed objects, a new cross-reference section (a table, or a stream when the
 * base file's newest section was a stream) and a trailer whose `/Prev` points at the base's. For an encrypted base file
 * the new strings and streams are encrypted with the base file's own key (`base.encryptor`, from the reader); a base
 * that cannot do that makes this throw `PliError("unsupported")`.
 */
export function writeIncremental(o: Overlay, options: IncrementalOptions = {}): Uint8Array {
  const base = o.base;
  if (!base) return writeRewrite(o, {});
  if (!o.isModified()) return base.bytes;
  const encrypt = o.encryptorFor();
  const kind = newestSection(base.bytes, base.startxref);
  const useStream = kind === "stream";
  const w = new ByteWriter(base.bytes.length + 4096);
  const baseLen = base.bytes.length;
  const last = baseLen ? base.bytes[baseLen - 1] : 0x0a;
  const prefix = last === 0x0a || last === 0x0d ? 0 : 1;
  if (prefix) w.byte(0x0a);
  const offsets = new Map<number, number>();
  const freed: [number, number][] = [];
  const entries = o.changedEntries();
  for (const [num, gen, obj] of entries) {
    if (obj === undefined) {
      freed.push([num, gen]);
      continue;
    }
    offsets.set(num, baseLen + w.length);
    writeIndirect(w, num, gen, obj, { encrypt: encrypt?.(num, gen) });
  }
  // The free list of this update: 0 -> first freed -> ... -> 0.
  const freeNext = new Map<number, number>();
  if (freed.length) {
    freed.sort((a, b) => a[0] - b[0]);
    freeNext.set(0, freed[0]![0]);
    freed.forEach(([n], i) => freeNext.set(n, freed[i + 1]?.[0] ?? 0));
  }
  const freeGen = new Map(freed);
  const nums = [...offsets.keys(), ...freed.map((f) => f[0])];
  if (freed.length) nums.push(0);
  const prev = kind ? base.startxref : undefined;
  const root = o.trailer.get("Root");
  const info = o.trailer.get("Info");
  const baseId = base.trailer.get("ID");
  const first = isArray(baseId) && baseId[0] instanceof PdfString ? baseId[0].bytes : randomId();
  const second = options.id ?? randomId();
  const trailer = new PdfDict();
  const encryptEntry = base.trailer.get("Encrypt");
  const xrefNum = o.nextNumber;
  const size = Math.max(o.nextNumber, base.size) + (useStream ? 1 : 0);
  trailer.set("Size", size);
  trailer.set("Root", root ?? null);
  if (info) trailer.set("Info", info);
  if (encryptEntry) trailer.set("Encrypt", encryptEntry);
  trailer.set("ID", idArray(first, second));
  if (prev !== undefined) trailer.set("Prev", prev);
  const xrefAt = baseLen + w.length;
  if (!useStream) {
    nums.sort((a, b) => a - b);
    w.ascii("xref\n");
    for (const [start, count] of runs(nums)) {
      w.ascii(`${start} ${count}\n`);
      for (let n = start; n < start + count; n++) {
        if (n === 0) w.ascii(`${pad(freeNext.get(0) ?? 0, 10)} 65535 f \n`);
        else if (offsets.has(n)) w.ascii(`${pad(offsets.get(n)!, 10)} ${pad(0, 5)} n \n`);
        else w.ascii(`${pad(freeNext.get(n) ?? 0, 10)} ${pad(freeGen.get(n) ?? 1, 5)} f \n`);
      }
    }
    w.ascii("trailer\n");
    writeObject(w, trailer, {});
    w.ascii(`\nstartxref\n${xrefAt}\n%%EOF\n`);
  } else {
    nums.push(xrefNum);
    nums.sort((a, b) => a - b);
    offsets.set(xrefNum, xrefAt);
    const w2 = widthOf(Math.max(xrefAt, ...freeNext.values(), 0));
    const w3 = 2;
    const rows: number[][] = [];
    const index: number[] = [];
    for (const [start, count] of runs(nums)) {
      index.push(start, count);
      for (let n = start; n < start + count; n++) {
        const row: number[] = [];
        if (offsets.has(n)) {
          row.push(1);
          putUint(row, offsets.get(n)!, w2);
          putUint(row, 0, w3);
        } else {
          row.push(0);
          putUint(row, freeNext.get(n) ?? 0, w2);
          putUint(row, n === 0 ? 65535 : (freeGen.get(n) ?? 1), w3);
        }
        rows.push(row);
      }
    }
    const data = packXref(rows, 1 + w2 + w3);
    const dict = new PdfDict();
    dict.set("Type", PdfName.of("XRef"));
    for (const [k, v] of trailer.map) dict.set(k, v);
    dict.set("W", [1, w2, w3]);
    dict.set("Index", index);
    dict.set("Filter", PdfName.of("FlateDecode"));
    dict.set("DecodeParms", new PdfDict({ Predictor: 12, Columns: 1 + w2 + w3 }));
    writeIndirect(w, xrefNum, 0, new PdfStream(dict, data));
    w.ascii(`startxref\n${xrefAt}\n%%EOF\n`);
  }
  const out = new Uint8Array(baseLen + w.length);
  out.set(base.bytes, 0);
  out.set(w.buf.subarray(0, w.length), baseLen);
  return out;
}

// ---- rewrite -------------------------------------------------------------------------------------------------------

export interface RewriteOptions {
  /** Drop objects nothing refers to (default true). */
  gc?: boolean;
  /** Compress streams that are not compressed (default false). */
  compress?: boolean;
  /** Pack small objects into object streams (PDF 1.5; implies an xref stream). */
  objectStreams?: boolean;
  /** Write the cross-reference as a stream (PDF 1.5) instead of a table. */
  xrefStream?: boolean;
  /** The header version (default: the file's, at least 1.7; at least 1.5 with object or xref streams). */
  version?: string;
  /** Write a new second `/ID` element (default true; false keeps the file's ID as it is). */
  id?: boolean;
}

const isStructure = (o: PdfObj): boolean => isStream(o) && (isName(o.dict.get("Type"), "XRef") || isName(o.dict.get("Type"), "ObjStm"));

/** Calls `visit` on every reference directly inside `o` (not through references). */
function eachRef(o: PdfObj, visit: (r: PdfRef) => void): void {
  const stack: PdfObj[] = [o];
  while (stack.length) {
    const x = stack.pop()!;
    if (isRef(x)) visit(x);
    else if (isArray(x)) for (const e of x) stack.push(e);
    else if (isDict(x)) for (const v of x.map.values()) stack.push(v);
    else if (isStream(x)) for (const v of x.dict.map.values()) stack.push(v);
  }
}

/** The objects of a new file: reachable from the trailer (`gc`) or all in use, in write order, and their new numbers. */
function collect(o: Overlay, gc: boolean): { order: number[]; number: Map<number, number> } {
  const order: number[] = [];
  const seen = new Set<number>();
  const take = (n: number) => {
    if (seen.has(n) || n === 0) return;
    seen.add(n);
    order.push(n);
  };
  const roots: PdfObj[] = [o.trailer.get("Root") ?? null, o.trailer.get("Info") ?? null];
  for (const r of roots) if (isRef(r) && o.has(r)) take(r.num);
  if (gc) {
    for (let i = 0; i < order.length; i++) {
      const obj = o.get(new PdfRef(order[i]!, 0));
      eachRef(obj, (r) => {
        const target = o.get(r);
        if (o.has(r) && !isStructure(target)) take(r.num);
      });
    }
  } else {
    const enc = o.base?.trailer.get("Encrypt");
    for (const n of o.objectNumbers()) if (!(isRef(enc) && enc.num === n) && !isStructure(o.get(new PdfRef(n, 0)))) take(n);
  }
  const number = new Map<number, number>();
  order.forEach((n, i) => number.set(n, i + 1));
  return { order, number };
}

/**
 * A new file: the objects reachable from the catalog and the info dictionary (all of them when `gc` is false), numbered
 * from 1, optionally with compressed streams, object streams and an xref stream. Never encrypted; the original's
 * `/Encrypt` is dropped and a new `/ID` written.
 */
export function writeRewrite(o: Overlay, options: RewriteOptions = {}): Uint8Array {
  if (!isRef(o.trailer.get("Root"))) throw new PliError("invalid_document", "The document has no catalog.");
  const { order, number } = collect(o, options.gc !== false);
  const objectStreams = options.objectStreams === true;
  const xrefStream = objectStreams || options.xrefStream === true;
  let version = options.version ?? (o.base?.version && versionAtLeast(o.base.version, "1.7") ? o.base.version : "1.7");
  if (xrefStream && !versionAtLeast(version, "1.5")) version = "1.5";
  const mapRef = (r: PdfRef): PdfRef | null => {
    const n = number.get(r.num);
    return n === undefined ? null : new PdfRef(n, 0);
  };
  const ser: SerializeOptions = { mapRef, compress: options.compress === true };
  const w = new ByteWriter(1 << 16);
  w.ascii(`%PDF-${version}\n`);
  w.bytes(BINARY_COMMENT);
  const offsets: number[] = []; // new number -> offset (type 1)
  const inStream = new Map<number, [number, number]>(); // new number -> [stream number, index]
  let nextNum = order.length + 1;
  const packable: number[] = [];
  const objects = new Map<number, PdfObj>();
  for (const n of order) objects.set(n, o.get(new PdfRef(n, 0)));
  const encryptDictRef = o.base?.trailer.get("Encrypt");
  for (const n of order) {
    const obj = objects.get(n)!;
    if (objectStreams && !isStream(obj) && !(isRef(encryptDictRef) && encryptDictRef.num === n) && n !== 0) packable.push(n);
    else {
      offsets[number.get(n)!] = w.length;
      writeIndirect(w, number.get(n)!, 0, obj, ser);
    }
  }
  // Object streams of up to 100 objects each.
  for (let at = 0; at < packable.length; at += 100) {
    const group = packable.slice(at, at + 100);
    const head: string[] = [];
    const body = new ByteWriter();
    group.forEach((n, i) => {
      head.push(`${number.get(n)} ${body.length}`);
      writeObject(body, objects.get(n)!, ser);
      body.byte(0x0a);
      inStream.set(number.get(n)!, [nextNum, i]);
    });
    const headBytes = latin1Bytes(head.join(" ") + "\n");
    const data = new Uint8Array(headBytes.length + body.length);
    data.set(headBytes, 0);
    data.set(body.buf.subarray(0, body.length), headBytes.length);
    const d = new PdfDict({ Type: PdfName.of("ObjStm"), N: group.length, First: headBytes.length });
    offsets[nextNum] = w.length;
    writeIndirect(w, nextNum, 0, new PdfStream(d, data), { compress: true });
    nextNum++;
  }
  // The trailer.
  const baseId = o.trailer.get("ID");
  const oldFirst = isArray(baseId) && baseId[0] instanceof PdfString ? baseId[0].bytes : undefined;
  const oldSecond = isArray(baseId) && baseId[1] instanceof PdfString ? baseId[1].bytes : undefined;
  const fresh = options.id !== false || !oldFirst;
  const first = oldFirst ?? randomId();
  const second = fresh ? randomId() : (oldSecond ?? first);
  const trailer = new PdfDict();
  const root = mapRef(o.trailer.get("Root") as PdfRef);
  const infoRef = o.trailer.get("Info");
  const info = isRef(infoRef) ? mapRef(infoRef) : null;
  trailer.set("Root", root);
  if (info) trailer.set("Info", info);
  trailer.set("ID", idArray(first, second));
  const xrefAt = w.length;
  if (!xrefStream) {
    const size = nextNum;
    trailer.set("Size", size);
    w.ascii(`xref\n0 ${size}\n`);
    w.ascii(`${pad(0, 10)} 65535 f \n`);
    for (let n = 1; n < size; n++) w.ascii(`${pad(offsets[n] ?? 0, 10)} 00000 n \n`);
    const t = new PdfDict();
    t.set("Size", size);
    for (const [k, v] of trailer.map) if (k !== "Size") t.set(k, v);
    w.ascii("trailer\n");
    writeObject(w, t, {});
    w.ascii(`\nstartxref\n${xrefAt}\n%%EOF\n`);
  } else {
    const xrefNum = nextNum;
    const size = xrefNum + 1;
    offsets[xrefNum] = xrefAt;
    const w2 = widthOf(Math.max(xrefAt, size));
    const w3 = 2;
    const rows: number[][] = [];
    for (let n = 0; n < size; n++) {
      const row: number[] = [];
      const packed = inStream.get(n);
      if (n === 0) {
        row.push(0);
        putUint(row, 0, w2);
        putUint(row, 65535, w3);
      } else if (packed) {
        row.push(2);
        putUint(row, packed[0], w2);
        putUint(row, packed[1], w3);
      } else {
        row.push(1);
        putUint(row, offsets[n] ?? 0, w2);
        putUint(row, 0, w3);
      }
      rows.push(row);
    }
    const dict = new PdfDict();
    dict.set("Type", PdfName.of("XRef"));
    dict.set("Size", size);
    for (const [k, v] of trailer.map) dict.set(k, v);
    dict.set("W", [1, w2, w3]);
    dict.set("Filter", PdfName.of("FlateDecode"));
    dict.set("DecodeParms", new PdfDict({ Predictor: 12, Columns: 1 + w2 + w3 }));
    writeIndirect(w, xrefNum, 0, new PdfStream(dict, packXref(rows, 1 + w2 + w3)));
    w.ascii(`startxref\n${xrefAt}\n%%EOF\n`);
  }
  return w.toBytes();
}

// ---- new files -----------------------------------------------------------------------------------------------------

/** A new, empty PDF 1.7 document: a catalog and an empty page tree. Add pages with `setPages`. */
export function createPdf(): Overlay {
  const o = new Overlay();
  const pages = o.add(new PdfDict({ Type: PdfName.of("Pages"), Kids: [], Count: 0 }));
  const catalog = o.add(new PdfDict({ Type: PdfName.of("Catalog"), Pages: pages }));
  o.trailer.set("Root", catalog);
  return o;
}

export { PdfDict };
export type { PdfObj };
