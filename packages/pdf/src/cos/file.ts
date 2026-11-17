/**
 * `PdfFile`: reads a PDF. Finds objects through the cross-reference data (classic tables, xref streams, hybrid files,
 * `Prev` chains, object streams, incremental updates), rebuilds that data by scanning when it is missing or wrong
 * ("repair"), decrypts on the way, and flattens the page tree. Objects are parsed on first use and cached. The input
 * bytes are never changed.
 */
import { PliError } from "@pli.dev/core";
import { SecurityHandler } from "./crypt";
import { DEFAULT_MAX_STREAM_SIZE, decodeStream } from "./filters";
import { Keyword, Lexer, isRegular, isWhite } from "./lexer";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, type PdfObj } from "./objects";
import { Parser, PdfSyntaxError, indexOfWord, parseIndirectObject } from "./parser";

export interface PageInfo {
  index: number;
  ref: PdfRef;
  /** The page dictionary with the inherited `Resources`, `MediaBox`, `CropBox` and `Rotate` merged in. */
  dict: PdfDict;
  mediaBox: [number, number, number, number];
  /** The `CropBox` clipped to the `MediaBox` (the `MediaBox` itself when absent or empty). */
  cropBox: [number, number, number, number];
  rotate: 0 | 90 | 180 | 270;
}

export interface OpenOptions {
  /** The user or owner password. Default: the empty password. */
  password?: string;
  /** Largest size a single stream may decode to. Default 256 MB. */
  maxStreamSize?: number;
}

type Box = [number, number, number, number];
const LETTER: Box = [0, 0, 612, 792];
const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;
const MAX_TREE_DEPTH = 256;

interface XEntry {
  /** 0 free, 1 at a byte offset, 2 inside an object stream */
  t: 0 | 1 | 2;
  /** offset (t 1) or object stream number (t 2) */
  a: number;
  /** generation (t 1) or index in the object stream (t 2) */
  b: number;
}

interface ObjStm {
  data: Uint8Array;
  first: number;
  /** object number -> offset relative to `first` */
  offsets: Map<number, number>;
  order: number[];
}

interface Section {
  trailer: PdfDict;
  inUse: [number, XEntry][];
  free: [number, XEntry][];
}

const TRAILER_ONLY = ["Prev", "XRefStm", "W", "Index", "Filter", "DecodeParms", "Length", "Type"];

export class PdfFile {
  readonly bytes: Uint8Array;
  /** Where the `%PDF-` header starts. Offsets in the file are relative to it. */
  readonly headerOffset: number;
  #trailer = new PdfDict();
  #repaired = false;
  #startxref = 0;
  #size = 0;
  #version = "1.4";
  #encrypted = false;
  #base = 0;
  #xref = new Map<number, XEntry>();
  #cache = new Map<number, PdfObj>();
  #loading = new Set<number>();
  #objStms = new Map<number, ObjStm | null>();
  #handler: SecurityHandler | null = null;
  #encryptNum = -1;
  #pages?: PageInfo[];
  readonly #password: string;
  readonly #maxStream: number;

  private constructor(bytes: Uint8Array, options: OpenOptions) {
    this.bytes = bytes;
    this.#password = options.password ?? "";
    this.#maxStream = options.maxStreamSize ?? DEFAULT_MAX_STREAM_SIZE;
    const h = indexOfWord(bytes, "%PDF-", 0, Math.min(bytes.length, 4096));
    this.headerOffset = Math.max(0, h);
    if (h >= 0) {
      const m = /^(\d\.\d)/.exec(String.fromCharCode(...bytes.subarray(h + 5, h + 8)));
      if (m) this.#version = m[1]!;
    }
  }

  /** Opens a PDF. Throws `PliError("invalid_document")` for something that is not a PDF, `PliError("unsupported", "password required" | "wrong password")` for an encrypted file. */
  static open(bytes: Uint8Array, options: OpenOptions = {}): PdfFile {
    const f = new PdfFile(bytes, options);
    f.init();
    return f;
  }

  get trailer(): PdfDict {
    return this.#trailer;
  }
  get repaired(): boolean {
    return this.#repaired;
  }
  /** Offset of the newest xref section (what a new `/Prev` points to). 0 when the file was repaired. */
  get startxref(): number {
    return this.#startxref;
  }
  /** The next free object number. */
  get size(): number {
    return this.#size;
  }
  /** True when the file has an `Encrypt` dictionary (it has been opened with the password). */
  get encrypted(): boolean {
    return this.#encrypted;
  }
  /** `"1.7"`: the header version, or the catalog's `Version` when that is newer. */
  get version(): string {
    return this.#version;
  }

  // ---- opening ----------------------------------------------------------------------------------------------

  private init(): void {
    let ok = false;
    try {
      this.loadXrefChain();
      ok = this.validateRoot();
    } catch (e) {
      if (e instanceof PliError && e.code === "unsupported") throw e;
    }
    if (!ok) {
      this.repair();
      if (!this.validateRoot()) throw new PliError("invalid_document", "not a PDF file: no document catalog found");
    }
    const v = this.catalogOrNull()?.get("Version");
    if (v instanceof PdfName && /^\d\.\d$/.test(v.value) && v.value > this.#version) this.#version = v.value;
  }

  private catalogOrNull(): PdfDict | null {
    try {
      const c = this.get(this.#trailer.get("Root"));
      return c instanceof PdfDict ? c : null;
    } catch (e) {
      if (e instanceof PliError && e.code === "unsupported") throw e;
      return null;
    }
  }

  private validateRoot(): boolean {
    if (!(this.#trailer.get("Root") instanceof PdfRef)) return false;
    this.setupCrypt();
    return this.catalogOrNull() !== null;
  }

  private setupCrypt(): void {
    this.#handler = null;
    this.#encryptNum = -1;
    this.#encrypted = false;
    this.#cache.clear();
    const enc = this.#trailer.get("Encrypt");
    if (enc === undefined || enc === null) return;
    this.#encrypted = true;
    let d: PdfObj = enc;
    if (enc instanceof PdfRef) {
      this.#encryptNum = enc.num;
      d = this.loadObject(enc.num, false);
    }
    if (!(d instanceof PdfDict)) throw new PdfSyntaxError("bad Encrypt dictionary");
    const idArr = this.#trailer.get("ID");
    const id0 = Array.isArray(idArr) && idArr[0] instanceof PdfString ? idArr[0].bytes : new Uint8Array(0);
    this.#handler = SecurityHandler.open(d, id0, this.#password, (o) => (o instanceof PdfRef ? this.loadObject(o.num, false) : (o ?? null)));
  }

  // ---- cross-reference data ------------------------------------------------------------------------------------

  private findStartxref(): number {
    const b = this.bytes;
    const word = "startxref";
    for (let i = b.length - word.length; i >= 0; i--) {
      if (b[i] !== 0x73) continue;
      let k = 1;
      while (k < word.length && b[i + k] === word.charCodeAt(k)) k++;
      if (k < word.length) continue;
      const t = new Lexer(b, i + word.length).next();
      return typeof t === "number" && t >= 0 ? t : -1;
    }
    return -1;
  }

  private looksLikeSection(pos: number): boolean {
    if (pos < 0 || pos >= this.bytes.length) return false;
    const lx = new Lexer(this.bytes, pos);
    const t = lx.next();
    if (t instanceof Keyword) return t.value === "xref";
    if (typeof t !== "number") return false;
    const g = lx.next();
    const o = lx.next();
    return typeof g === "number" && o instanceof Keyword && o.value === "obj";
  }

  private loadXrefChain(): void {
    const sx = this.findStartxref();
    if (sx < 0) throw new PdfSyntaxError("no startxref");
    const bases = this.headerOffset > 0 ? [this.headerOffset, 0] : [0];
    const base = bases.find((b) => this.looksLikeSection(sx + b));
    if (base === undefined) throw new PdfSyntaxError("startxref points nowhere");
    this.#base = base;
    this.#startxref = sx;
    this.#xref.clear();
    const seen = new Set<number>();
    const trailers: PdfDict[] = [];
    let off = sx;
    let count = 0;
    while (off >= 0 && !seen.has(off) && count++ < 10000) {
      seen.add(off);
      const sec = this.readSection(off);
      trailers.push(sec.trailer);
      for (const [n, e] of sec.inUse) if (!this.#xref.has(n)) this.#xref.set(n, e);
      const stm = sec.trailer.get("XRefStm");
      if (typeof stm === "number" && !seen.has(stm)) {
        seen.add(stm);
        try {
          const s2 = this.readSection(stm);
          for (const [n, e] of s2.inUse) if (!this.#xref.has(n)) this.#xref.set(n, e);
          for (const [n, e] of s2.free) if (!this.#xref.has(n)) this.#xref.set(n, e);
        } catch (e) {
          if (e instanceof PliError) throw e;
        }
      }
      for (const [n, e] of sec.free) if (!this.#xref.has(n)) this.#xref.set(n, e);
      const prev = sec.trailer.get("Prev");
      off = typeof prev === "number" && Number.isFinite(prev) ? Math.floor(prev) : -1;
    }
    const merged = new PdfDict();
    for (const t of trailers.reverse()) for (const [k, v] of t.map) merged.map.set(k, v);
    for (const k of TRAILER_ONLY) merged.map.delete(k);
    this.#trailer = merged;
    this.updateSize();
  }

  private updateSize(): void {
    let max = 0;
    for (const [n, e] of this.#xref) if (e.t !== 0 && n > max) max = n;
    const s = this.#trailer.get("Size");
    this.#size = Math.max(max + 1, typeof s === "number" && s < 1e9 ? Math.floor(s) : 0);
  }

  private readSection(off: number): Section {
    const b = this.bytes;
    const pos = this.#base + off;
    const lx = new Lexer(b, pos);
    const first = lx.next();
    if (first instanceof Keyword && first.value === "xref") return this.readTable(lx);
    const r = parseIndirectObject(b, pos);
    if (!r || !(r.obj instanceof PdfStream)) throw new PdfSyntaxError("bad xref section");
    return this.readXrefStream(r.obj);
  }

  private readTable(lx: Lexer): Section {
    const inUse: [number, XEntry][] = [];
    const free: [number, XEntry][] = [];
    for (;;) {
      const t = lx.next();
      if (t instanceof Keyword) {
        if (t.value === "trailer") break;
        throw new PdfSyntaxError("bad xref table");
      }
      if (typeof t !== "number") throw new PdfSyntaxError("bad xref table");
      let start = t;
      const count = lx.next();
      if (typeof count !== "number") throw new PdfSyntaxError("bad xref table");
      for (let i = 0; i < count; i++) {
        const o = lx.next();
        const g = lx.next();
        const k = lx.next();
        if (typeof o !== "number" || typeof g !== "number" || !(k instanceof Keyword)) throw new PdfSyntaxError("bad xref entry");
        if (i === 0 && start === 1 && k.value === "f" && g === 65535) start = 0; // a common off-by-one
        const num = start + i;
        if (k.value === "n" && o > 0) inUse.push([num, { t: 1, a: o, b: g }]);
        else free.push([num, { t: 0, a: 0, b: g }]);
      }
    }
    const d = new Parser(lx).parse();
    if (!(d instanceof PdfDict)) throw new PdfSyntaxError("bad trailer");
    return { trailer: d, inUse, free };
  }

  private readXrefStream(s: PdfStream): Section {
    const d = s.dict;
    const t = d.get("Type");
    if (!(t instanceof PdfName) || t.value !== "XRef") throw new PdfSyntaxError("not an xref stream");
    const w = d.get("W");
    if (!Array.isArray(w) || w.length < 3 || !w.every((x) => typeof x === "number" && x >= 0 && x <= 8)) throw new PdfSyntaxError("bad W");
    const [w0, w1, w2] = w as [number, number, number];
    const size = typeof d.get("Size") === "number" ? (d.get("Size") as number) : 0;
    const idx = d.get("Index");
    const index: number[] = Array.isArray(idx) && idx.length >= 2 && idx.every((x) => typeof x === "number") ? (idx as number[]) : [0, size];
    const data = decodeStream(s, undefined, { maxSize: this.#maxStream });
    const rowLen = w0 + w1 + w2;
    const inUse: [number, XEntry][] = [];
    const free: [number, XEntry][] = [];
    if (rowLen === 0) throw new PdfSyntaxError("bad W");
    let p = 0;
    const field = (n: number): number => {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[p++]!;
      return v;
    };
    for (let k = 0; k + 1 < index.length; k += 2) {
      const start = index[k]!;
      const count = index[k + 1]!;
      for (let i = 0; i < count && p + rowLen <= data.length; i++) {
        const type = w0 === 0 ? 1 : field(w0);
        const a = field(w1);
        const b = field(w2);
        const num = start + i;
        if (type === 1) inUse.push([num, { t: 1, a, b }]);
        else if (type === 2) inUse.push([num, { t: 2, a, b }]);
        else if (type === 0) free.push([num, { t: 0, a: 0, b }]);
      }
    }
    return { trailer: d, inUse, free };
  }

  // ---- repair --------------------------------------------------------------------------------------------------

  /** Rebuilds the cross-reference data by scanning the file for `N G obj`. */
  private repair(): void {
    this.#repaired = true;
    this.#base = 0;
    this.#startxref = 0;
    this.#xref.clear();
    this.#cache.clear();
    this.#objStms.clear();
    this.#pages = undefined;
    const b = this.bytes;
    const n = b.length;
    const pos = new Map<number, number>();
    const trailers: PdfDict[] = [];
    const objStms: number[] = [];
    let catalog: PdfRef | null = null;
    let i = 0;
    while (i < n) {
      const c = b[i]!;
      if (c === 0x6f && b[i + 1] === 0x62 && b[i + 2] === 0x6a && (i + 3 >= n || !isRegular(b[i + 3]!))) {
        // `obj`: look back for `N G `
        let j = i - 1;
        while (j >= 0 && isWhite(b[j]!)) j--;
        const genEnd = j + 1;
        while (j >= 0 && b[j]! >= 0x30 && b[j]! <= 0x39) j--;
        const genStart = j + 1;
        while (j >= 0 && isWhite(b[j]!)) j--;
        const numEnd = j + 1;
        while (j >= 0 && b[j]! >= 0x30 && b[j]! <= 0x39) j--;
        const numStart = j + 1;
        if (genEnd > genStart && numEnd > numStart && genStart > numEnd && numEnd - numStart < 11 && (j < 0 || !isRegular(b[j]!))) {
          const r = parseIndirectObject(b, numStart);
          if (r && r.end > i) {
            this.#xref.set(r.num, { t: 1, a: numStart, b: r.gen });
            pos.set(r.num, numStart);
            const d = r.obj instanceof PdfStream ? r.obj.dict : r.obj instanceof PdfDict ? r.obj : null;
            if (d) {
              const t = d.get("Type");
              if (t instanceof PdfName) {
                if (t.value === "ObjStm") objStms.push(r.num);
                else if (t.value === "XRef") trailers.push(d);
                else if (t.value === "Catalog") catalog = new PdfRef(r.num, r.gen);
              }
            }
            i = r.end;
            continue;
          }
        }
        i += 3;
        continue;
      }
      if (c === 0x74 && b[i + 1] === 0x72 && b[i + 2] === 0x61 && b[i + 3] === 0x69 && b[i + 4] === 0x6c && b[i + 5] === 0x65 && b[i + 6] === 0x72) {
        try {
          const d = new Parser(new Lexer(b, i + 7)).parse();
          if (d instanceof PdfDict) trailers.push(d);
        } catch {
          // ignore
        }
        i += 7;
        continue;
      }
      i++;
    }
    const merged = new PdfDict();
    for (const t of trailers) for (const [k, v] of t.map) merged.map.set(k, v);
    for (const k of TRAILER_ONLY) merged.map.delete(k);
    if (!(merged.get("Root") instanceof PdfRef)) {
      // the last trailer with a Root wins, else any catalog object
      let root: PdfObj | undefined;
      for (const t of trailers) if (t.get("Root") instanceof PdfRef) root = t.get("Root");
      if (root instanceof PdfRef) merged.map.set("Root", root);
      else if (catalog) merged.map.set("Root", catalog);
    }
    this.#trailer = merged;
    if (!(merged.get("Root") instanceof PdfRef)) throw new PliError("invalid_document", "not a PDF file: no document catalog found");
    this.setupCrypt();
    // objects inside object streams
    for (const sn of objStms) {
      const st = this.loadObjStm(sn);
      if (!st) continue;
      const stPos = pos.get(sn) ?? 0;
      st.order.forEach((num, idx) => {
        const cur = this.#xref.get(num);
        if (!cur || cur.t === 0 || (cur.t === 1 && (pos.get(num) ?? 0) < stPos)) {
          this.#xref.set(num, { t: 2, a: sn, b: idx });
          pos.set(num, stPos);
        }
      });
    }
    this.#cache.clear();
    this.updateSize();
  }

  private repairQuietly(): void {
    if (this.#repaired) return;
    try {
      this.repair();
    } catch (e) {
      if (e instanceof PliError && e.code === "unsupported") throw e;
    }
  }

  // ---- objects -------------------------------------------------------------------------------------------------

  has(num: number): boolean {
    const e = this.#xref.get(num);
    return !!e && e.t !== 0;
  }

  generation(num: number): number {
    const e = this.#xref.get(num);
    return e && e.t === 1 ? e.b : 0;
  }

  objectNumbers(): number[] {
    const out: number[] = [];
    for (const [n, e] of this.#xref) if (e.t !== 0) out.push(n);
    return out.sort((a, b) => a - b);
  }

  /** Follows references (and chains of them). A missing object is `null`. Strings and streams are decrypted. */
  get(o: PdfObj | undefined): PdfObj {
    let hops = 0;
    while (o instanceof PdfRef) {
      if (++hops > 32) return null;
      const num = o.num;
      const c = this.#cache.get(num);
      if (c !== undefined || this.#cache.has(num)) o = c;
      else {
        const v = this.loadObject(num, true);
        // a load that triggered a repair may have cleared the cache: caching is still right
        this.#cache.set(num, v);
        o = v;
      }
    }
    return o === undefined ? null : o;
  }

  /**
   * For writing new objects into this (encrypted) file: functions that encrypt the strings and the stream data of
   * object `num` the way the file's own handler would. `stream` takes the stream dictionary so it can leave XRef
   * streams, unencrypted metadata and `Identity` crypt filter streams alone. Undefined for an unencrypted file.
   */
  encryptor(num: number, gen = 0): { string(bytes: Uint8Array): Uint8Array; stream(bytes: Uint8Array, dict?: PdfDict): Uint8Array } | undefined {
    const h = this.#handler;
    if (!h || num === this.#encryptNum) return undefined;
    return {
      string: (bytes) => h.encryptString(bytes, num, gen),
      stream: (bytes, dict) => (dict ? h.encryptStream(bytes, num, gen, dict, (o) => this.get(o)) : h.encryptStream(bytes, num, gen, new PdfDict(), (o) => this.get(o))),
    };
  }

  getRef(num: number, gen = 0): PdfObj {
    return this.get(new PdfRef(num, gen));
  }

  dictGet(d: PdfDict, key: string): PdfObj {
    return this.get(d.get(key));
  }

  private lengthOf = (ref: PdfRef): number | undefined => {
    const v = this.loadObject(ref.num, false);
    return typeof v === "number" ? v : undefined;
  };

  private loadObject(num: number, decrypt: boolean): PdfObj {
    if (this.#loading.has(num)) return null;
    const e = this.#xref.get(num);
    if (!e || e.t === 0) return null;
    this.#loading.add(num);
    try {
      if (e.t === 2) return this.loadCompressed(num, e);
      const r = parseIndirectObject(this.bytes, this.#base + e.a, { resolveLength: this.lengthOf });
      if (!r || r.num !== num) {
        if (this.#repaired) return null;
        this.#loading.delete(num);
        this.repairQuietly();
        return this.loadObject(num, decrypt);
      }
      if (decrypt && this.#handler && num !== this.#encryptNum) return this.decryptObject(r.obj, r.num, r.gen);
      return r.obj;
    } catch (err) {
      if (err instanceof PliError) throw err;
      return null;
    } finally {
      this.#loading.delete(num);
    }
  }

  private loadCompressed(num: number, e: XEntry): PdfObj {
    const st = this.loadObjStm(e.a);
    if (!st) return null;
    let off = st.offsets.get(num);
    if (off === undefined) {
      const viaIndex = st.order[e.b];
      if (viaIndex !== num) return null;
      off = st.offsets.get(num);
    }
    if (off === undefined) return null;
    try {
      const v = new Parser(new Lexer(st.data, st.first + off)).parse();
      return v instanceof Keyword ? null : v;
    } catch (err) {
      if (err instanceof PdfSyntaxError) return null;
      throw err;
    }
  }

  private loadObjStm(num: number): ObjStm | null {
    const cached = this.#objStms.get(num);
    if (cached !== undefined) return cached;
    this.#objStms.set(num, null);
    const s = this.getRef(num);
    if (!(s instanceof PdfStream)) return null;
    let data: Uint8Array;
    try {
      data = this.decode(s);
    } catch (err) {
      if (err instanceof PliError && err.code === "unsupported" && /larger/.test(err.message)) throw err;
      return null;
    }
    const n = this.get(s.dict.get("N"));
    const first = this.get(s.dict.get("First"));
    if (typeof n !== "number" || typeof first !== "number" || first < 0 || first > data.length) return null;
    const lx = new Lexer(data, 0, first);
    const offsets = new Map<number, number>();
    const order: number[] = [];
    for (let i = 0; i < n && i < data.length; i++) {
      const on = lx.next();
      const oo = lx.next();
      if (typeof on !== "number" || typeof oo !== "number") break;
      if (!offsets.has(on)) offsets.set(on, oo);
      order.push(on);
    }
    const st: ObjStm = { data, first, offsets, order };
    this.#objStms.set(num, st);
    return st;
  }

  private decryptObject(obj: PdfObj, num: number, gen: number): PdfObj {
    const h = this.#handler!;
    const map = (o: PdfObj): PdfObj => {
      if (o instanceof PdfString) return new PdfString(h.decryptString(o.bytes, num, gen), o.hex);
      if (Array.isArray(o)) return o.map(map);
      if (o instanceof PdfDict) {
        const d = new PdfDict();
        for (const [k, v] of o.map) d.map.set(k, map(v));
        return d;
      }
      return o;
    };
    if (obj instanceof PdfStream) {
      const t = obj.dict.get("Type");
      if (t instanceof PdfName && t.value === "XRef") return obj;
      const data = h.decryptStream(obj.data, num, gen, obj.dict, (o) => (o instanceof PdfRef ? this.loadObject(o.num, false) : (o ?? null)));
      return new PdfStream(map(obj.dict) as PdfDict, data);
    }
    return map(obj);
  }

  /** The decoded bytes of a stream. Image filters (DCT, JPX, JBIG2, CCITT) are not applied: see `decodeStreamPartial`. */
  decode(stream: PdfStream): Uint8Array {
    return decodeStream(stream, (o) => this.get(o), { maxSize: this.#maxStream });
  }

  // ---- document ------------------------------------------------------------------------------------------------

  catalog(): PdfDict {
    const c = this.get(this.#trailer.get("Root"));
    if (!(c instanceof PdfDict)) throw new PliError("invalid_document", "the document has no catalog");
    return c;
  }

  info(): PdfDict | null {
    const i = this.get(this.#trailer.get("Info"));
    return i instanceof PdfDict ? i : null;
  }

  pageCount(): number {
    return this.pages().length;
  }

  pages(): PageInfo[] {
    if (this.#pages) return this.#pages;
    let list = this.flatten();
    if (list.length === 0 && !this.#repaired) {
      this.repairQuietly();
      list = this.flatten();
    }
    if (list.length === 0) list = this.scanPages();
    return (this.#pages = list.map((p, index) => this.makePage(index, p.ref, p.dict)));
  }

  private flatten(): { ref: PdfRef; dict: PdfDict }[] {
    const out: { ref: PdfRef; dict: PdfDict }[] = [];
    let root: PdfObj;
    try {
      root = this.catalog().get("Pages") ?? null;
    } catch {
      return out;
    }
    const seen = new Set<number>();
    const visit = (node: PdfObj, inherited: PdfDict, depth: number): void => {
      if (depth > MAX_TREE_DEPTH || out.length > 5_000_000) return;
      if (!(node instanceof PdfRef)) return;
      if (seen.has(node.num)) return;
      seen.add(node.num);
      const d = this.get(node);
      if (!(d instanceof PdfDict)) return;
      const kids = this.get(d.get("Kids"));
      const type = this.get(d.get("Type"));
      const typeName = type instanceof PdfName ? type.value : null;
      if (Array.isArray(kids)) {
        const next = inherited.clone();
        for (const k of INHERITABLE) {
          const v = d.get(k);
          if (v !== undefined && v !== null) next.map.set(k, v);
        }
        for (const kid of kids) visit(kid, next, depth + 1);
        return;
      }
      if (typeName !== null && typeName !== "Page") return;
      const page = d.clone();
      for (const k of INHERITABLE) {
        const have = page.get(k);
        if ((have === undefined || have === null) && inherited.has(k)) page.map.set(k, inherited.get(k)!);
      }
      out.push({ ref: node, dict: page });
    };
    visit(root, new PdfDict(), 0);
    return out;
  }

  /** Last resort for a broken page tree: every object that says it is a page, in object number order. */
  private scanPages(): { ref: PdfRef; dict: PdfDict }[] {
    const out: { ref: PdfRef; dict: PdfDict }[] = [];
    for (const num of this.objectNumbers()) {
      let d: PdfObj;
      try {
        d = this.getRef(num);
      } catch {
        continue;
      }
      if (!(d instanceof PdfDict)) continue;
      const t = d.get("Type");
      if (!(t instanceof PdfName) || t.value !== "Page") continue;
      const page = d.clone();
      // inheritance through /Parent
      let parent = this.get(d.get("Parent"));
      for (let depth = 0; parent instanceof PdfDict && depth < 64; depth++) {
        for (const k of INHERITABLE) if (!page.has(k) && parent.has(k)) page.map.set(k, parent.get(k)!);
        parent = this.get(parent.get("Parent"));
      }
      out.push({ ref: new PdfRef(num, this.generation(num)), dict: page });
    }
    return out;
  }

  private rect(o: PdfObj | undefined): Box | null {
    const a = this.get(o);
    if (!Array.isArray(a) || a.length < 4) return null;
    const v: number[] = [];
    for (let i = 0; i < 4; i++) {
      const x = this.get(a[i]);
      if (typeof x !== "number" || !Number.isFinite(x)) return null;
      v.push(x);
    }
    return [Math.min(v[0]!, v[2]!), Math.min(v[1]!, v[3]!), Math.max(v[0]!, v[2]!), Math.max(v[1]!, v[3]!)];
  }

  private makePage(index: number, ref: PdfRef, dict: PdfDict): PageInfo {
    let media = this.rect(dict.get("MediaBox"));
    if (!media || media[2] - media[0] <= 0 || media[3] - media[1] <= 0) media = [...LETTER];
    let crop = this.rect(dict.get("CropBox"));
    if (crop) {
      crop = [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])];
      if (crop[2] - crop[0] <= 0 || crop[3] - crop[1] <= 0) crop = null;
    }
    const r = this.get(dict.get("Rotate"));
    let rotate = 0;
    if (typeof r === "number" && Number.isFinite(r)) rotate = (((Math.round(r / 90) * 90) % 360) + 360) % 360;
    return { index, ref, dict, mediaBox: media, cropBox: crop ?? [...media], rotate: rotate as 0 | 90 | 180 | 270 };
  }
}
