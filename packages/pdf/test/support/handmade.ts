/**
 * Builds small PDFs BY HAND (strings and bytes), independent of the writer: classic xref, xref streams with object
 * streams, incremental updates, hybrid files, broken files and encrypted files. Used by the reader tests.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { zlibSync } from "fflate";

export const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
export const textOf = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

export function concat(...parts: (string | Uint8Array)[]): Uint8Array {
  const bs = parts.map((p) => (typeof p === "string" ? bytesOf(p) : p));
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** An indirect object: `body` is what goes between `obj` and `endobj`. */
export interface Obj {
  num: number;
  gen?: number;
  body: string | Uint8Array;
}

export const obj = (num: number, body: string | Uint8Array, gen = 0): Obj => ({ num, gen, body });

/** A stream object. `extra` is more dictionary entries; with `flate` the data is compressed (and `/Filter` added). */
export function streamObj(num: number, extra: string, data: string | Uint8Array, flate = false): Obj {
  let d = typeof data === "string" ? bytesOf(data) : data;
  let ex = extra;
  if (flate) {
    d = zlibSync(d);
    ex = `/Filter /FlateDecode ${ex}`;
  }
  return { num, body: concat(`<< /Length ${d.length} ${ex} >>\nstream\n`, d, "\nendstream") };
}

const HEADER = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
export const ID_BYTES = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ID_ENTRY = `/ID [<${hex(ID_BYTES)}> <${hex(ID_BYTES)}>]`;

export interface Built {
  bytes: Uint8Array;
  /** offset of each object, relative to the `%PDF-` header */
  offsets: Map<number, number>;
  xrefOffset: number;
}

export interface ClassicOptions {
  root?: number;
  info?: number;
  trailerExtra?: string;
  header?: string;
  /** junk before the header; offsets then are relative to the header */
  prefix?: string | Uint8Array;
  /** junk after %%EOF */
  suffix?: string | Uint8Array;
  /** no xref table, trailer or startxref at all */
  omitXref?: boolean;
  /** write this value after `startxref` instead of the real one */
  startxref?: number;
  /** extra text inserted right before the `xref` keyword */
  size?: number;
}

function xrefTable(offsets: Map<number, number>, size: number, gens: Map<number, number> = new Map()): string {
  let t = `xref\n0 ${size}\n`;
  for (let i = 0; i < size; i++) {
    const o = offsets.get(i);
    if (i === 0) t += "0000000000 65535 f \n";
    else if (o === undefined) t += "0000000000 00000 f \n";
    else t += `${String(o).padStart(10, "0")} ${String(gens.get(i) ?? 0).padStart(5, "0")} n \n`;
  }
  return t;
}

export function buildClassic(objs: Obj[], o: ClassicOptions = {}): Built {
  const prefix = o.prefix === undefined ? new Uint8Array(0) : typeof o.prefix === "string" ? bytesOf(o.prefix) : o.prefix;
  const parts: Uint8Array[] = [prefix, bytesOf(o.header ?? HEADER)];
  let pos = prefix.length + parts[1]!.length;
  const offsets = new Map<number, number>();
  for (const ob of objs) {
    offsets.set(ob.num, pos - prefix.length);
    const b = concat(`${ob.num} ${ob.gen ?? 0} obj\n`, ob.body, "\nendobj\n");
    parts.push(b);
    pos += b.length;
  }
  const size = o.size ?? Math.max(...objs.map((x) => x.num)) + 1;
  const xrefOffset = pos - prefix.length;
  if (!o.omitXref) {
    const root = o.root ?? 1;
    const gens = new Map(objs.map((x) => [x.num, x.gen ?? 0] as const));
    const t = `${xrefTable(offsets, size, gens)}trailer\n<< /Size ${size} /Root ${root} 0 R ${o.info ? `/Info ${o.info} 0 R ` : ""}${ID_ENTRY} ${o.trailerExtra ?? ""} >>\nstartxref\n${o.startxref ?? xrefOffset}\n%%EOF\n`;
    parts.push(bytesOf(t));
  }
  if (o.suffix !== undefined) parts.push(typeof o.suffix === "string" ? bytesOf(o.suffix) : o.suffix);
  return { bytes: concat(...parts), offsets, xrefOffset };
}

/** A catalog, a flat page tree and `n` pages, each with a content stream. Object numbers: 1 catalog, 2 pages, 3.. pages, then contents. */
export function simpleDoc(n: number, opts: { mediaBox?: string; pageExtra?: (i: number) => string; pagesExtra?: string; text?: (i: number) => string } = {}): Obj[] {
  const objs: Obj[] = [obj(1, "<< /Type /Catalog /Pages 2 0 R >>")];
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(" ");
  objs.push(obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} ${opts.pagesExtra ?? ""} >>`));
  for (let i = 0; i < n; i++) {
    objs.push(obj(3 + i, `<< /Type /Page /Parent 2 0 R /MediaBox ${opts.mediaBox ?? "[0 0 612 792]"} /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${3 + n + i} 0 R ${opts.pageExtra?.(i) ?? ""} >>`));
  }
  for (let i = 0; i < n; i++) objs.push(streamObj(3 + n + i, "", opts.text?.(i) ?? `BT /F1 12 Tf 72 700 Td (Page ${i + 1}) Tj ET`));
  return objs;
}

// ---- xref streams, object streams --------------------------------------------------------------------------------

export interface XrefStreamOptions {
  /** numbers of objects (non-stream, generation 0) to store in an object stream */
  objStm?: number[];
  compress?: boolean;
  /** use the PNG "Up" predictor on the xref stream */
  predictor?: boolean;
  root?: number;
  prefix?: string | Uint8Array;
  trailerExtra?: string;
  /** pretend `Length` of the xref stream is an indirect object (not allowed by the standard, accepted by some readers) */
}

function objStmObj(num: number, members: Obj[], compress: boolean): Obj {
  let head = "";
  let body = "";
  for (const m of members) {
    head += `${m.num} ${body.length} `;
    body += `${typeof m.body === "string" ? m.body : textOf(m.body)}\n`;
  }
  return streamObj(num, `/Type /ObjStm /N ${members.length} /First ${head.length}`, head + body, compress);
}

function pngUp(rows: Uint8Array[]): Uint8Array {
  const out: number[] = [];
  let prev: Uint8Array = new Uint8Array(rows[0]!.length);
  for (const r of rows) {
    out.push(2);
    for (let i = 0; i < r.length; i++) out.push((r[i]! - prev[i]!) & 255);
    prev = r;
  }
  return Uint8Array.from(out);
}

/** Entries of an xref stream with W [1 4 2]. */
function xrefRows(entries: Map<number, [number, number, number]>, size: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < size; i++) {
    const e = entries.get(i) ?? [0, 0, i === 0 ? 65535 : 0];
    rows.push(Uint8Array.of(e[0], (e[1] >>> 24) & 255, (e[1] >>> 16) & 255, (e[1] >>> 8) & 255, e[1] & 255, (e[2] >> 8) & 255, e[2] & 255));
  }
  return rows;
}

export function buildXrefStreamPdf(objs: Obj[], o: XrefStreamOptions = {}): Built {
  const prefix = o.prefix === undefined ? new Uint8Array(0) : typeof o.prefix === "string" ? bytesOf(o.prefix) : o.prefix;
  const compress = o.compress ?? true;
  const inStm = new Set(o.objStm ?? []);
  const maxNum = Math.max(...objs.map((x) => x.num));
  const direct = objs.filter((x) => !inStm.has(x.num));
  const members = objs.filter((x) => inStm.has(x.num));
  let next = maxNum + 1;
  const stmNum = members.length ? next++ : -1;
  const xrefNum = next++;
  const all = [...direct];
  if (members.length) all.push(objStmObj(stmNum, members, compress));
  const parts: Uint8Array[] = [prefix, bytesOf(HEADER)];
  let pos = prefix.length + parts[1]!.length;
  const offsets = new Map<number, number>();
  for (const ob of all) {
    offsets.set(ob.num, pos - prefix.length);
    const b = concat(`${ob.num} 0 obj\n`, ob.body, "\nendobj\n");
    parts.push(b);
    pos += b.length;
  }
  const xrefOffset = pos - prefix.length;
  offsets.set(xrefNum, xrefOffset);
  const entries = new Map<number, [number, number, number]>();
  for (const [n, off] of offsets) entries.set(n, [1, off, 0]);
  members.forEach((m, idx) => entries.set(m.num, [2, stmNum, idx]));
  const size = xrefNum + 1;
  const rows = xrefRows(entries, size);
  let data = o.predictor ? pngUp(rows) : concat(...rows);
  let filter = "";
  if (compress) {
    data = zlibSync(data);
    filter = "/Filter /FlateDecode ";
  }
  const parms = o.predictor ? "/DecodeParms << /Predictor 12 /Columns 7 >> " : "";
  const xs = concat(
    `${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root ${o.root ?? 1} 0 R ${ID_ENTRY} ${filter}${parms}${o.trailerExtra ?? ""} /Length ${data.length} >>\nstream\n`,
    data,
    "\nendstream\nendobj\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  parts.push(xs);
  return { bytes: concat(...parts), offsets, xrefOffset };
}

/** A hybrid file: a classic table where the objects in the object stream are listed as free, plus an `XRefStm`. */
export function buildHybrid(objs: Obj[], inStm: number[], o: { listHiddenAsFree?: boolean } = {}): Built {
  const set = new Set(inStm);
  const members = objs.filter((x) => set.has(x.num));
  const direct = objs.filter((x) => !set.has(x.num));
  const maxNum = Math.max(...objs.map((x) => x.num));
  const stmNum = maxNum + 1;
  const xsNum = maxNum + 2;
  const size = xsNum + 1;
  const parts: Uint8Array[] = [bytesOf(HEADER)];
  let pos = parts[0]!.length;
  const offsets = new Map<number, number>();
  const emit = (ob: Obj): void => {
    offsets.set(ob.num, pos);
    const b = concat(`${ob.num} 0 obj\n`, ob.body, "\nendobj\n");
    parts.push(b);
    pos += b.length;
  };
  for (const ob of direct) emit(ob);
  emit(objStmObj(stmNum, members, true));
  // the xref stream lists only the compressed objects (the table has them as free)
  const rows = members.map((m, idx) => Uint8Array.of(2, 0, 0, (stmNum >> 8) & 255, stmNum & 255, 0, idx));
  const data = zlibSync(concat(...rows));
  const xsOffset = pos;
  const index = members.map((m) => `${m.num} 1`).join(" ");
  emit({ num: xsNum, body: concat(`<< /Type /XRef /Size ${size} /W [1 4 2] /Index [${index}] /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, data, "\nendstream") });
  const xrefOffset = pos;
  // the table has no entries for the objects in the object stream (`hiddenAsFree`: or lists them as free)
  const present = [0, ...[...offsets.keys(), ...(o.listHiddenAsFree ? members.map((m) => m.num) : [])].sort((a, b) => a - b)];
  let table = "xref\n";
  for (let i = 0; i < present.length; ) {
    let j = i;
    while (j + 1 < present.length && present[j + 1] === present[j]! + 1) j++;
    table += `${present[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) table += present[k] === 0 ? "0000000000 65535 f \n" : !offsets.has(present[k]!) ? "0000000000 00000 f \n" : `${String(offsets.get(present[k]!)).padStart(10, "0")} 00000 n \n`;
    i = j + 1;
  }
  const t = `${table}trailer\n<< /Size ${size} /Root 1 0 R ${ID_ENTRY} /XRefStm ${xsOffset} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(bytesOf(t));
  return { bytes: concat(...parts), offsets, xrefOffset };
}

/** Appends an incremental update with a classic xref section: `objs` replace or add objects. */
export function appendUpdate(base: Uint8Array, objs: Obj[], o: { size?: number; root?: number; free?: number[]; xrefStreamPrev?: boolean } = {}): Built {
  const tail = textOf(base.subarray(Math.max(0, base.length - 200)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!m) throw new Error("no startxref in base");
  const prev = Number(m[1]);
  const parts: Uint8Array[] = [base, bytesOf("\n")];
  let pos = base.length + 1;
  const offsets = new Map<number, number>();
  for (const ob of objs) {
    offsets.set(ob.num, pos);
    const b = concat(`${ob.num} ${ob.gen ?? 0} obj\n`, ob.body, "\nendobj\n");
    parts.push(b);
    pos += b.length;
  }
  const xrefOffset = pos;
  const nums = [...offsets.keys(), ...(o.free ?? [])].sort((a, b) => a - b);
  let t = "xref\n";
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    t += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) {
      const off = offsets.get(nums[k]!);
      t += off === undefined ? "0000000000 00001 f \n" : `${String(off).padStart(10, "0")} ${String(0).padStart(5, "0")} n \n`;
    }
    i = j + 1;
  }
  const size = o.size ?? Math.max(...nums) + 1;
  t += `trailer\n<< /Size ${size} /Root ${o.root ?? 1} 0 R /Prev ${prev} ${ID_ENTRY} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(bytesOf(t));
  return { bytes: concat(...parts), offsets, xrefOffset };
}

// ---- encryption (written against the PDF spec, with node:crypto for MD5/SHA/AES) ----------------------------------------

export type EncMode = "rc4-40" | "rc4-128" | "aes-128" | "aes-256-r5" | "aes-256-r6";

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const md5 = (...p: Uint8Array[]): Uint8Array => new Uint8Array(createHash("md5").update(concat(...p)).digest());
const sha = (alg: string, ...p: Uint8Array[]): Uint8Array => new Uint8Array(createHash(alg).update(concat(...p)).digest());

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

function aesCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad: boolean): Uint8Array {
  const c = createCipheriv(key.length === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
  c.setAutoPadding(pad);
  return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

function hash2B(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha("sha256", pw, salt, udata);
  for (let i = 0; ; i++) {
    const k1 = concat(pw, k, udata);
    const rep = concat(...Array.from({ length: 64 }, () => k1));
    const e = aesCbc(k.subarray(0, 16), k.subarray(16, 32), rep, false);
    const m = Array.from(e.subarray(0, 16)).reduce((a, b) => a + b, 0) % 3;
    k = sha(m === 0 ? "sha256" : m === 1 ? "sha384" : "sha512", e);
    if (i >= 63 && e[e.length - 1]! <= i - 31) break;
  }
  return k.subarray(0, 32);
}

export interface EncryptorOptions {
  userPassword?: string;
  ownerPassword?: string;
  encryptMetadata?: boolean;
  permissions?: number;
}

const latin = (s: string): Uint8Array => bytesOf(s);
const padded = (s: string): Uint8Array => {
  const b = latin(s).subarray(0, 32);
  return concat(b, PAD.subarray(0, 32 - b.length));
};

/** Encrypts objects as a PDF writer would. Make the encryptor, build objects with `stream`/`str`, then `buildClassic(objs.concat(enc.encryptObj), { trailerExtra: enc.trailerExtra })`. */
export class Encryptor {
  readonly key: Uint8Array;
  readonly encryptNum: number;
  readonly encryptObj: Obj;
  readonly trailerExtra: string;
  private readonly aes: boolean;
  private readonly v5: boolean;

  constructor(
    readonly mode: EncMode,
    options: EncryptorOptions = {},
    encryptNum = 99,
  ) {
    const user = options.userPassword ?? "";
    const owner = options.ownerPassword ?? "owner-secret";
    const P = options.permissions ?? -44;
    const em = options.encryptMetadata ?? true;
    this.encryptNum = encryptNum;
    this.v5 = mode === "aes-256-r5" || mode === "aes-256-r6";
    this.aes = mode === "aes-128" || this.v5;
    const R = mode === "rc4-40" ? 2 : mode === "rc4-128" ? 3 : mode === "aes-128" ? 4 : mode === "aes-256-r5" ? 5 : 6;
    const V = mode === "rc4-40" ? 1 : mode === "rc4-128" ? 2 : mode === "aes-128" ? 4 : 5;
    const hexs = (b: Uint8Array): string => `<${hex(b)}>`;
    if (!this.v5) {
      const n = mode === "rc4-40" ? 5 : 16;
      // owner entry (algorithm 3)
      let oh = md5(padded(owner));
      if (R >= 3) for (let i = 0; i < 50; i++) oh = md5(oh);
      const okey = oh.subarray(0, n);
      let O = rc4(okey, padded(user));
      if (R >= 3) for (let i = 1; i <= 19; i++) O = rc4(okey.map((b) => b ^ i), O);
      // file key (algorithm 2)
      const p4 = new Uint8Array(4);
      new DataView(p4.buffer).setInt32(0, P, true);
      let h = md5(padded(user), O, p4, ID_BYTES, R >= 4 && !em ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0));
      if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
      this.key = h.slice(0, n);
      let U: Uint8Array;
      if (R === 2) U = rc4(this.key, PAD);
      else {
        let x = rc4(this.key, md5(PAD, ID_BYTES));
        for (let i = 1; i <= 19; i++) x = rc4(this.key.map((b) => b ^ i), x);
        U = concat(x, new Uint8Array(16));
      }
      const cf = mode === "aes-128" ? ` /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF` : "";
      this.encryptObj = obj(encryptNum, `<< /Filter /Standard /V ${V} /R ${R} /Length ${n * 8} /P ${P} /O ${hexs(O)} /U ${hexs(U)}${em ? "" : " /EncryptMetadata false"}${cf} >>`);
    } else {
      this.key = Uint8Array.from(randomBytes(32));
      const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8").subarray(0, 127));
      const hash = R === 5 ? (pw: Uint8Array, salt: Uint8Array, ud: Uint8Array) => sha("sha256", pw, salt, ud) : hash2B;
      const none = new Uint8Array(0);
      const uvs = Uint8Array.from(randomBytes(8));
      const uks = Uint8Array.from(randomBytes(8));
      const U = concat(hash(utf8(user), uvs, none), uvs, uks);
      const zero = new Uint8Array(16);
      const UE = aesCbc(hash(utf8(user), uks, none), zero, this.key, false);
      const ovs = Uint8Array.from(randomBytes(8));
      const oks = Uint8Array.from(randomBytes(8));
      const O = concat(hash(utf8(owner), ovs, U), ovs, oks);
      const OE = aesCbc(hash(utf8(owner), oks, U), zero, this.key, false);
      const perms = new Uint8Array(16);
      new DataView(perms.buffer).setInt32(0, P, true);
      perms.set([0xff, 0xff, 0xff, 0xff, em ? 0x54 : 0x46, 0x61, 0x64, 0x62], 4);
      const Perms = aesCbc(this.key, zero, perms, false); // ECB of one block == CBC with zero iv
      const cf = ` /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF`;
      this.encryptObj = obj(encryptNum, `<< /Filter /Standard /V 5 /R ${R} /Length 256 /P ${P} /O ${hexs(O)} /U ${hexs(U)} /OE ${hexs(OE)} /UE ${hexs(UE)} /Perms ${hexs(Perms)}${em ? "" : " /EncryptMetadata false"}${cf} >>`);
    }
    this.trailerExtra = `/Encrypt ${encryptNum} 0 R`;
  }

  private objKey(num: number, gen: number): Uint8Array {
    if (this.v5) return this.key;
    const ext = [num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255];
    if (this.aes) ext.push(0x73, 0x41, 0x6c, 0x54);
    return md5(this.key, Uint8Array.from(ext)).subarray(0, Math.min(this.key.length + 5, 16));
  }

  /** Encrypts bytes belonging to object `num`. */
  encrypt(num: number, data: Uint8Array, gen = 0): Uint8Array {
    const key = this.objKey(num, gen);
    if (!this.aes) return rc4(key, data);
    const iv = Uint8Array.from(randomBytes(16));
    return concat(iv, aesCbc(key, iv, data, true));
  }

  /** `<hex>` for a string of object `num`. */
  str(num: number, text: string): string {
    return `<${hex(this.encrypt(num, bytesOf(text)))}>`;
  }

  stream(num: number, extra: string, data: string | Uint8Array, flate = false): Obj {
    let d = typeof data === "string" ? bytesOf(data) : data;
    let ex = extra;
    if (flate) {
      d = zlibSync(d);
      ex = `/Filter /FlateDecode ${ex}`;
    }
    const e = this.encrypt(num, d);
    return { num, body: concat(`<< /Length ${e.length} ${ex} >>\nstream\n`, e, "\nendstream") };
  }
}
