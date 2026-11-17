/**
 * Files of a deck in your file storage (`@pli.dev/core` `StorageClient`): pictures, fonts, the deck itself and the
 * templates it was made from live in your storage (S3, Supabase, Firebase, your own server) instead of inside the deck as
 * base64, and are loaded, saved and uploaded through the same adapter every Pli editor uses.
 *
 *     const storage = new StorageClient(myAdapter);
 *     const stored = await storeImages(session.deck, storage);   // pictures go to storage; the deck keeps short references
 *     const shown = await resolveImages(stored.deck, storage);   // references become addresses a browser can load
 *     const file = await inlineImages(stored.deck, storage);     // references become data, for toPptx and toPdf
 *
 * Nothing here is required: without a client, pictures are embedded as `data:` addresses.
 */
import { PliError, decodeBase64, encodeBase64, type BlobLike, type FontFamily, type FontFaceSpec, type FontSource, type StorageClient } from "@pli.dev/core";
import type { Deck, Element, Fill, Layout, Master, Slide } from "./model";
import { parseDeck, serializeDeck } from "./serialize";
import { importTemplate, type TemplateImport } from "./pptx/template";
import type { PptxImportOptions } from "./pptx/read";

const isInline = (src: string) => /^(data|blob):/i.test(src);

const bytesOf = async (blob: BlobLike): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

function fillSources(fill: Fill | null | undefined, into: Set<string>): void {
  if (fill && typeof fill === "object" && "image" in fill && fill.image.src) into.add(fill.image.src);
}

function elementSources(el: Element, into: Set<string>): void {
  if (el.type === "image" && el.src) into.add(el.src);
  if (el.type === "shape") fillSources(el.fill, into);
  if (el.type === "table") for (const row of el.rows) for (const c of row.cells) fillSources(c.fill, into);
  if (el.type === "group") el.children.forEach((c) => elementSources(c, into));
}

/** Every picture address a deck uses: pictures, picture fills, backgrounds of slides, layouts and masters. */
export function imageSources(deck: Deck): Set<string> {
  const into = new Set<string>();
  const list = (elements: readonly Element[]) => elements.forEach((e) => elementSources(e, into));
  for (const s of deck.slides) {
    fillSources(s.background, into);
    list(s.elements);
  }
  for (const m of deck.masters) {
    fillSources(m.background, into);
    list(m.elements);
    for (const l of m.layouts) {
      fillSources(l.background, into);
      list(l.elements);
    }
  }
  return into;
}

function mapFill<F extends Fill | null | undefined>(fill: F, map: ReadonlyMap<string, string>): F {
  if (fill && typeof fill === "object" && "image" in fill && map.has(fill.image.src)) return { ...fill, image: { ...fill.image, src: map.get(fill.image.src)! } } as F;
  return fill;
}

function mapElement(el: Element, map: ReadonlyMap<string, string>): Element {
  switch (el.type) {
    case "image":
      return map.has(el.src) ? { ...el, src: map.get(el.src)! } : el;
    case "shape":
      return el.fill && typeof el.fill === "object" && "image" in el.fill ? { ...el, fill: mapFill(el.fill, map) } : el;
    case "table":
      return { ...el, rows: el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.fill && typeof c.fill === "object" && "image" in c.fill ? { ...c, fill: mapFill(c.fill, map) } : c)) })) };
    case "group":
      return { ...el, children: el.children.map((c) => mapElement(c, map)) };
    default:
      return el;
  }
}

/** The deck with picture addresses replaced as `map` says (an address not in it stays). */
export function replaceImageSources(deck: Deck, map: ReadonlyMap<string, string>): Deck {
  if (map.size === 0) return deck;
  const bg = <T extends { background?: Fill }>(x: T): T => (x.background !== undefined ? { ...x, background: mapFill(x.background, map) } : x);
  const slide = (s: Slide): Slide => ({ ...bg(s), elements: s.elements.map((e) => mapElement(e, map)) });
  const layout = (l: Layout): Layout => ({ ...bg(l), elements: l.elements.map((e) => mapElement(e, map)) });
  const master = (m: Master): Master => ({ ...bg(m), elements: m.elements.map((e) => mapElement(e, map)), layouts: m.layouts.map(layout) });
  return { ...deck, slides: deck.slides.map(slide), masters: deck.masters.map(master) };
}

/** A picture that couldn't be prepared. It is left as it was. */
export interface FileFailure {
  src: string;
  error: PliError;
}

export interface PreparedDeck {
  deck: Deck;
  failed: FileFailure[];
}

const asError = (error: unknown, src: string): PliError =>
  error instanceof PliError ? error : new PliError("storage", `Couldn't prepare "${src.slice(0, 60)}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });

function dataUri(src: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is.exec(src);
  if (!m || !/;base64$/i.test(m[2]!)) return null;
  const bytes = decodeBase64(m[3]!);
  return bytes ? { type: m[1] || "application/octet-stream", bytes } : null;
}

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/bmp": "bmp" };

/** Runs `work` on each item, a few at a time (the client limits uploads itself). */
async function all<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  return Promise.all(items.map(work));
}

/**
 * Uploads the pictures embedded in a deck (`data:` addresses) and returns the deck with the references the storage gave.
 * Equal pictures are uploaded once. Pictures that can't be uploaded stay embedded and are listed in `failed`. Addresses that
 * are already references or links are left alone.
 */
export async function storeImages(deck: Deck, storage: StorageClient, options: { prefix?: string } = {}): Promise<PreparedDeck> {
  const embedded = [...imageSources(deck)].filter((s) => isInline(s));
  const failed: FileFailure[] = [];
  const map = new Map<string, string>();
  const prefix = (options.prefix ?? "").replace(/\/+$/, "");
  await all(embedded, async (src) => {
    const data = dataUri(src);
    if (!data) return;
    try {
      const name = `${prefix ? `${prefix}/` : ""}image-${map.size + failed.length}.${EXTENSION[data.type] ?? "bin"}`;
      const file = { size: data.bytes.length, type: data.type, name, arrayBuffer: async () => data.bytes.slice().buffer as ArrayBuffer };
      const result = await storage.upload(file, { name, type: data.type });
      if (result.url) storage.prime(result.ref, result.url);
      map.set(src, result.ref);
    } catch (error) {
      failed.push({ src, error: asError(error, src) });
    }
  });
  return { deck: replaceImageSources(deck, map), failed };
}

/** The deck with each stored picture's reference replaced by an address a browser can load (what the editor shows). */
export async function resolveImages(deck: Deck, storage: StorageClient): Promise<PreparedDeck> {
  const failed: FileFailure[] = [];
  const map = new Map<string, string>();
  await all([...imageSources(deck)].filter((s) => !isInline(s)), async (src) => {
    try {
      const url = await storage.resolve(src);
      if (url !== src) map.set(src, url);
    } catch (error) {
      failed.push({ src, error: asError(error, src) });
    }
  });
  return { deck: replaceImageSources(deck, map), failed };
}

/** The deck with each stored picture's reference replaced by its data, for `toPptx` and `toPdf` (which write bytes). Needs the adapter's `read`. */
export async function inlineImages(deck: Deck, storage: StorageClient): Promise<PreparedDeck> {
  const failed: FileFailure[] = [];
  const map = new Map<string, string>();
  await all([...imageSources(deck)].filter((s) => !isInline(s) && !/^https?:/i.test(s)), async (src) => {
    try {
      const blob = await storage.read(src);
      map.set(src, `data:${blob.type || "application/octet-stream"};base64,${encodeBase64(await bytesOf(blob))}`);
    } catch (error) {
      failed.push({ src, error: asError(error, src) });
    }
  });
  return { deck: replaceImageSources(deck, map), failed };
}

// ---- The deck itself, fonts and templates ----------------------------------------------------------------------

const memoryFile = (bytes: Uint8Array, type: string, name: string): BlobLike & { name: string } => ({ size: bytes.length, type, name, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer });

/**
 * Saves a deck as one file in storage: its pictures go to storage and the deck, as JSON with references, goes after them.
 * Returns the reference to load it with `loadDeck`, and the deck as saved.
 */
export async function saveDeck(deck: Deck, storage: StorageClient, options: { name?: string } = {}): Promise<{ ref: string; deck: Deck; failed: FileFailure[] }> {
  const stored = await storeImages(deck, storage, { prefix: options.name?.replace(/\.[^.]*$/, "") });
  const name = options.name ?? `${deck.id}.deck.json`;
  const result = await storage.upload(memoryFile(new TextEncoder().encode(serializeDeck(stored.deck)), "application/json", name), { name, type: "application/json" });
  return { ref: result.ref, deck: stored.deck, failed: stored.failed };
}

/** Loads a deck saved with `saveDeck`. Pictures keep their references: `resolveImages` makes them showable. */
export async function loadDeck(ref: string, storage: StorageClient): Promise<Deck> {
  const blob = await storage.read(ref);
  return parseDeck(new TextDecoder().decode(await bytesOf(blob)));
}

/** Uploads a `.pptx`, `.potx` or Google Slides file, so the template the deck was made from stays with it. Returns its reference. */
export async function storeTemplate(file: BlobLike & { name?: string }, storage: StorageClient, options: { name?: string } = {}): Promise<{ ref: string }> {
  const name = options.name ?? file.name ?? "template.potx";
  const type = file.type || "application/vnd.openxmlformats-officedocument.presentationml.template";
  const { ref } = await storage.upload(file, { name, type });
  return { ref };
}

/** Reads a stored template back into masters and layouts (see `importTemplate`). */
export async function loadTemplate(ref: string, storage: StorageClient, options: PptxImportOptions = {}): Promise<TemplateImport> {
  return importTemplate(await bytesOf(await storage.read(ref)), options);
}

/** A font file kept in storage and the family it is. */
export interface StoredFont {
  family: string;
  /** 100 to 900. Default 400. */
  weight?: number;
  style?: "normal" | "italic";
  /** What `storage.upload` returned for the file. */
  ref: string;
  format?: "woff2" | "woff" | "truetype";
}

/** Uploads a font file and describes it, for `storageFontSource`. */
export async function storeFont(file: BlobLike & { name?: string }, storage: StorageClient, face: { family: string; weight?: number; style?: "normal" | "italic" }): Promise<StoredFont> {
  const name = file.name ?? `${face.family}.ttf`;
  const format = /\.woff2$/i.test(name) ? "woff2" : /\.woff$/i.test(name) ? "woff" : "truetype";
  const { ref } = await storage.upload(file, { name, type: file.type || "font/ttf" });
  return { ...face, ref, format };
}

/**
 * A font source for `createFonts({ source })` or `extra` families whose files are in your storage. The browser loads each file
 * from `storage.resolve(ref)`; PDF export gets the bytes from `storage.read(ref)` (so a deck's custom fonts are embedded).
 */
export function storageFontSource(fonts: readonly StoredFont[], storage: StorageClient): FontSource {
  const key = (f: { family: string }) => f.family.toLowerCase();
  const pick = (family: FontFamily, wanted: { weight: number; style: "normal" | "italic" }) => {
    const mine = fonts.filter((f) => key(f) === family.family.toLowerCase());
    return [...mine].sort((a, b) => Math.abs((a.weight ?? 400) - wanted.weight) + ((a.style ?? "normal") === wanted.style ? 0 : 1000) - (Math.abs((b.weight ?? 400) - wanted.weight) + ((b.style ?? "normal") === wanted.style ? 0 : 1000)))[0];
  };
  return {
    name: "storage",
    async faces(family, wanted) {
      const f = pick(family, wanted);
      if (!f) return [];
      const spec: FontFaceSpec = { family: family.family, weight: f.weight ?? 400, style: f.style ?? "normal", url: await storage.resolve(f.ref), format: f.format ?? "truetype" };
      return [spec];
    },
    async file(family, wanted) {
      const f = pick(family, wanted);
      return f ? bytesOf(await storage.read(f.ref)) : null;
    },
  };
}

/** The families a deck uses that `fonts` doesn't cover, for deciding what to upload. */
export function missingFonts(used: Iterable<string>, fonts: readonly StoredFont[]): string[] {
  const have = new Set(fonts.map((f) => f.family.toLowerCase()));
  return [...new Set(used)].filter((f) => !have.has(f.toLowerCase()));
}
