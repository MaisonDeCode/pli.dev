/**
 * `Overlay`: a mutable layer over a read-only `PdfFile` (or over nothing, to make a new file). Reads see the changes
 * first, then the base. Nothing in the base is ever touched: an object you want to change is copied into the layer
 * (`edit`), and `incremental()` / `rewrite()` write the result.
 */
import { PliError } from "@pli.dev/core";
import { Copier } from "./copy";
import { PdfDict, PdfRef, PdfStream, isArray, isDict, isRef } from "./objects";
import type { PdfObj } from "./objects";
import { writeIncremental, writeRewrite } from "./writer";
import type { IncrementalOptions, RewriteOptions, SerializeOptions } from "./writer";

/** What the overlay needs from a `PdfFile` (which satisfies it). */
export interface PdfFileLike {
  readonly bytes: Uint8Array;
  readonly version: string;
  readonly trailer: PdfDict;
  readonly repaired: boolean;
  readonly encrypted: boolean;
  readonly startxref: number;
  readonly size: number;
  has(num: number): boolean;
  get(refOrObj: PdfObj | undefined): PdfObj;
  getRef(num: number, gen?: number): PdfObj;
  objectNumbers(): number[];
  generation(num: number): number;
  catalog(): PdfDict;
  pageCount(): number;
  pages(): PageInfoLike[];
  /** Encrypts strings and streams of object `num gen` the way the file's own security handler does, when the reader has one. */
  encryptor?(num: number, gen: number): SerializeOptions["encrypt"];
}

export interface PageInfoLike {
  index: number;
  ref: PdfRef;
  dict: PdfDict;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotate: 0 | 90 | 180 | 270;
}

interface Slot {
  gen: number;
  /** undefined: the object is freed. */
  obj: PdfObj | undefined;
}

/** A copy of a direct object that shares nothing mutable with the original (streams keep their bytes). */
export function cloneDirect<T extends PdfObj>(o: T): T {
  if (isArray(o)) return o.map((e) => cloneDirect(e)) as T;
  if (o instanceof PdfDict) {
    const d = new PdfDict();
    for (const [k, v] of o.map) d.map.set(k, cloneDirect(v));
    return d as T;
  }
  if (o instanceof PdfStream) return new PdfStream(cloneDirect(o.dict), o.data) as T;
  return o;
}

export class Overlay {
  readonly base: PdfFileLike | null;
  /** What the new file's trailer is made from: `Root`, `Info`, `ID`. Change `Root`/`Info` to point elsewhere. */
  readonly trailer: PdfDict;
  readonly #slots = new Map<number, Slot>();
  readonly #owned = new Set<number>();
  readonly #changed = new Set<number>();
  #next: number;
  readonly #copiers = new Map<object, Copier>();
  readonly #baseRoot: string;
  readonly #baseInfo: string;

  constructor(base?: PdfFileLike) {
    this.base = base ?? null;
    this.trailer = new PdfDict();
    if (base) {
      for (const k of ["Root", "Info", "ID"]) {
        const v = base.trailer.get(k);
        if (v !== undefined && v !== null) this.trailer.set(k, v);
      }
      let max = base.size;
      for (const n of base.objectNumbers()) if (n + 1 > max) max = n + 1;
      this.#next = Math.max(max, 1);
    } else this.#next = 1;
    this.#baseRoot = String(this.trailer.get("Root"));
    this.#baseInfo = String(this.trailer.get("Info"));
  }

  /** Numbers added, replaced or removed. */
  get changed(): ReadonlySet<number> {
    return this.#changed;
  }

  /** The number the next `add` gets. */
  get nextNumber(): number {
    return this.#next;
  }

  /** Whether `incremental()` has anything to write. */
  isModified(): boolean {
    return this.#changed.size > 0 || String(this.trailer.get("Root")) !== this.#baseRoot || String(this.trailer.get("Info")) !== this.#baseInfo;
  }

  /** Follows references (also chains of them); a missing or freed object is `null`. */
  get(refOrObj: PdfObj | undefined): PdfObj {
    let o: PdfObj | undefined = refOrObj;
    for (let hops = 0; hops < 32 && isRef(o); hops++) {
      const slot = this.#slots.get(o.num);
      if (slot) o = slot.obj ?? null;
      else if (this.base && this.base.has(o.num)) o = this.base.getRef(o.num, o.gen);
      else return null;
    }
    return isRef(o) ? null : (o ?? null);
  }

  /** The value of a dictionary entry, references followed. */
  dictGet(d: PdfDict | PdfStream, key: string): PdfObj {
    return this.get((d instanceof PdfStream ? d.dict : d).get(key));
  }

  has(ref: PdfRef | number): boolean {
    const n = typeof ref === "number" ? ref : ref.num;
    const slot = this.#slots.get(n);
    if (slot) return slot.obj !== undefined;
    return !!this.base && this.base.has(n);
  }

  generation(num: number): number {
    return this.#slots.get(num)?.gen ?? this.base?.generation(num) ?? 0;
  }

  /** Every object number in use, ascending. */
  objectNumbers(): number[] {
    const set = new Set<number>(this.base ? this.base.objectNumbers() : []);
    for (const [n, s] of this.#slots) {
      if (s.obj === undefined) set.delete(n);
      else set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  /** Adds an object under a new number. */
  add(obj: PdfObj): PdfRef {
    const num = this.#next++;
    this.#slots.set(num, { gen: 0, obj });
    this.#owned.add(num);
    this.#changed.add(num);
    return new PdfRef(num, 0);
  }

  /** Replaces the object (same number and generation). */
  set(ref: PdfRef | number, obj: PdfObj): void {
    const num = typeof ref === "number" ? ref : ref.num;
    const gen = typeof ref === "number" ? this.generation(num) : ref.gen;
    this.#slots.set(num, { gen, obj });
    this.#owned.add(num);
    this.#changed.add(num);
    if (num >= this.#next) this.#next = num + 1;
  }

  /** Frees the object. */
  remove(ref: PdfRef | number): void {
    const num = typeof ref === "number" ? ref : ref.num;
    const gen = Math.min(this.generation(num) + 1, 65535);
    this.#slots.set(num, { gen, obj: undefined });
    this.#owned.delete(num);
    this.#changed.add(num);
  }

  /**
   * The object as a private, changeable copy that is part of this layer (made on the first call; the base's object is
   * left alone, also its nested dictionaries and arrays). Throws when there is no such object.
   */
  edit<T extends PdfObj = PdfDict>(ref: PdfRef): T {
    const slot = this.#slots.get(ref.num);
    if (slot && this.#owned.has(ref.num)) {
      if (slot.obj === undefined) throw new PliError("not_found", `Object ${ref.num} was removed.`);
      return slot.obj as T;
    }
    if (!this.has(ref)) throw new PliError("not_found", `There is no object ${ref.num}.`);
    const copy = cloneDirect(this.get(new PdfRef(ref.num, 0)));
    this.set(new PdfRef(ref.num, this.generation(ref.num)), copy);
    return copy as T;
  }

  /** The catalog (read it; use `editCatalog` to change it). */
  catalog(): PdfDict {
    const c = this.get(this.trailer.get("Root"));
    if (!isDict(c)) throw new PliError("invalid_document", "The document has no catalog.");
    return c;
  }
  editCatalog(): PdfDict {
    const r = this.trailer.get("Root");
    if (!isRef(r)) throw new PliError("invalid_document", "The document has no catalog.");
    return this.edit<PdfDict>(r);
  }
  /** The info dictionary, if there is one. */
  info(): PdfDict | null {
    const i = this.get(this.trailer.get("Info"));
    return isDict(i) ? i : null;
  }
  /** The info dictionary to change: made when there is none. */
  editInfo(): PdfDict {
    const r = this.trailer.get("Info");
    if (isRef(r) && isDict(this.get(r))) return this.edit<PdfDict>(r);
    const d = new PdfDict();
    this.trailer.set("Info", this.add(d));
    return d;
  }

  /**
   * Copies objects (and everything they refer to) from another file into this one and returns the roots with their
   * references mapped. See `Copier` for what is left out (page tree links, structure tree, back references).
   * Copying from the same source again reuses what was copied before.
   */
  copyFrom(other: PdfFileLike | Overlay, roots: PdfObj[]): PdfObj[] {
    let c = this.#copiers.get(other);
    if (!c) this.#copiers.set(other, (c = new Copier(this, other)));
    return roots.map((r) => c!.copy(r));
  }

  /**
   * Copies a page of another file in (not yet in the page tree: pass it to `setPages`). Resources, boxes and rotation the
   * page inherited are written on it. Annotations are copied fresh on each import.
   */
  importPage(from: PdfFileLike | Overlay, pageIndex: number): PdfRef {
    let c = this.#copiers.get(from);
    if (!c) this.#copiers.set(from, (c = new Copier(this, from)));
    return c.copyPage(pageIndex);
  }

  /** The changed objects, ascending: `[number, generation, object | undefined (freed)]`. */
  changedEntries(): [number, number, PdfObj | undefined][] {
    return [...this.#slots.entries()].sort((a, b) => a[0] - b[0]).map(([n, s]) => [n, s.gen, s.obj]);
  }

  /** Per-object encryption for `incremental()` when the base is encrypted; undefined when it isn't. */
  encryptorFor(): ((num: number, gen: number) => SerializeOptions["encrypt"]) | undefined {
    const base = this.base;
    if (!base || !base.encrypted) return undefined;
    if (!base.encryptor) throw new PliError("unsupported", "This file is encrypted and cannot be saved as an update to the original. Save it as a new file instead.");
    return (n, g) => base.encryptor!(n, g);
  }

  /**
   * The base file's bytes unchanged plus the changes. With no base this is `rewrite()`. When nothing changed the base's
   * own bytes come back.
   */
  incremental(options?: IncrementalOptions): Uint8Array {
    return writeIncremental(this, options);
  }

  /** A new file; see `RewriteOptions`. */
  rewrite(options?: RewriteOptions): Uint8Array {
    return writeRewrite(this, options);
  }
}

