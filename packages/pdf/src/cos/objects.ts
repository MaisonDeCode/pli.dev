/**
 * The objects a PDF file is made of ("COS", the carousel object system of ISO 32000): null, booleans, numbers,
 * strings, names, arrays, dictionaries, streams and indirect references. The reader (`file.ts`) makes them from
 * bytes and the writer (`writer.ts`) turns them back into bytes. Nothing in this file touches bytes or I/O.
 */

/** A name such as `/Type`. `value` is without the slash and already decoded (`#20` is a space). */
export class PdfName {
  private constructor(readonly value: string) {}
  static #cache = new Map<string, PdfName>();
  /** Names are interned, so `PdfName.of("Type") === PdfName.of("Type")`. */
  static of(value: string): PdfName {
    let n = PdfName.#cache.get(value);
    if (!n) PdfName.#cache.set(value, (n = new PdfName(value)));
    return n;
  }
  toString(): string {
    return `/${this.value}`;
  }
}

/** A string. PDF strings are bytes; `hex` only says which syntax to write. Use `textOf`/`pdfText` for text. */
export class PdfString {
  constructor(
    readonly bytes: Uint8Array,
    readonly hex = false,
  ) {}
}

/** An indirect reference, `12 0 R`. */
export class PdfRef {
  constructor(
    readonly num: number,
    readonly gen = 0,
  ) {}
  get key(): string {
    return `${this.num} ${this.gen}`;
  }
  toString(): string {
    return `${this.num} ${this.gen} R`;
  }
}

export type PdfObj = null | boolean | number | PdfString | PdfName | PdfRef | PdfArray | PdfDict | PdfStream;
export type PdfArray = PdfObj[];

/** A dictionary. Keys are names without the slash. Insertion order is kept (and written). */
export class PdfDict {
  readonly map: Map<string, PdfObj>;
  constructor(entries?: Iterable<readonly [string, PdfObj]> | Record<string, PdfObj>) {
    this.map = new Map(entries && Symbol.iterator in Object(entries) ? (entries as Iterable<[string, PdfObj]>) : Object.entries((entries ?? {}) as Record<string, PdfObj>));
  }
  get(key: string): PdfObj | undefined {
    return this.map.get(key);
  }
  set(key: string, value: PdfObj | undefined): this {
    if (value === undefined) this.map.delete(key);
    else this.map.set(key, value);
    return this;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  delete(key: string): boolean {
    return this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
  entries(): [string, PdfObj][] {
    return [...this.map.entries()];
  }
  clone(): PdfDict {
    return new PdfDict(this.map);
  }
}

/**
 * A stream: a dictionary plus bytes. `data` is the bytes as they are in the file, so still compressed when the
 * dictionary has a `Filter` (the reader decrypts them first, if the file is encrypted). `decodeStream` in `filters.ts`
 * returns the decoded bytes. `Length` is not kept up to date: the writer sets it.
 */
export class PdfStream {
  constructor(
    public dict: PdfDict,
    public data: Uint8Array,
  ) {}
}

export const isName = (o: unknown, value?: string): o is PdfName => o instanceof PdfName && (value === undefined || o.value === value);
export const isRef = (o: unknown): o is PdfRef => o instanceof PdfRef;
export const isDict = (o: unknown): o is PdfDict => o instanceof PdfDict;
export const isStream = (o: unknown): o is PdfStream => o instanceof PdfStream;
export const isString = (o: unknown): o is PdfString => o instanceof PdfString;
export const isArray = (o: unknown): o is PdfArray => Array.isArray(o);
export const isNum = (o: unknown): o is number => typeof o === "number";

/** Shorthand constructors, for writing objects by hand. */
export const name = (value: string): PdfName => PdfName.of(value);
export const ref = (num: number, gen = 0): PdfRef => new PdfRef(num, gen);
export const dict = (entries?: Record<string, PdfObj | undefined>): PdfDict => {
  const d = new PdfDict();
  if (entries) for (const [k, v] of Object.entries(entries)) if (v !== undefined) d.map.set(k, v);
  return d;
};

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

/** A PDF string for a JavaScript string: PDFDocEncoding (here: Latin-1 when every character fits, else UTF-16BE with a byte order mark). */
export function pdfText(text: string, hex = false): PdfString {
  if (/^[\x20-\x7e\n\r\t\xa0-\xff]*$/.test(text)) {
    const b = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
    return new PdfString(b, hex);
  }
  const b = new Uint8Array(2 + text.length * 2);
  b[0] = 0xfe;
  b[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    b[2 + i * 2] = c >> 8;
    b[3 + i * 2] = c & 255;
  }
  return new PdfString(b, hex);
}

/** The text of a PDF text string (UTF-16BE or UTF-8 with a byte order mark, else PDFDocEncoding, treated as Latin-1 for 0xA0 and up). */
export function textOf(s: PdfString): string {
  const b = s.bytes;
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
    return out;
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    let out = "";
    for (let i = 2; i + 1 < b.length; i += 2) out += String.fromCharCode(b[i]! | (b[i + 1]! << 8));
    return out;
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder().decode(b.subarray(3));
  return latin1(b);
}

export { latin1 as bytesToLatin1 };
export const latin1Bytes = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
};
