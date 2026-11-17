/**
 * A workbook, its pictures and the data blocks of its pivot tables in your file storage (`@pli.dev/core` `StorageClient`), the
 * same adapter every Pli editor uses (S3, Supabase, Firebase, your own server).
 *
 * While a workbook is open its pictures are `data:` addresses (the editor reads their bytes to size, crop and draw them), so what
 * the storage changes is the file: `saveWorkbook` puts each picture in storage once and the workbook, with short references in
 * place of the pictures and the rows of its data blocks, after them; `loadWorkbook` reads it back and fetches what it refers to.
 *
 *     const { ref } = await saveWorkbook(session.state, storage);
 *     const workbook = await loadWorkbook(ref, storage);
 *     const session = new SheetSession(workbook, { pivotData: storageData(storage, refs) });
 *
 * Nothing here is required: without a client, a workbook is JSON with its pictures embedded.
 */
import { PliError, decodeBase64, encodeBase64, type BlobLike, type StorageClient } from "@pli.dev/core";
import type { Cell, DataBlock, HeaderFooterPicture, HeaderFooterPictures, PageSetup, Sheet, Workbook } from "./model";
import type { PivotDataAnswer, PivotDataRequest, PivotDataResolver } from "./pivot-external";
import { parseWorkbook, serializeWorkbook } from "./serialize";

const isInline = (src: string) => /^(data|blob):/i.test(src);
const bytesOf = async (blob: BlobLike): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());
const memoryFile = (bytes: Uint8Array, type: string, name: string): BlobLike & { name: string } => ({ size: bytes.length, type, name, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer });
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/bmp": "bmp" };

/** A picture that couldn't be put in or got out of storage. The picture is left as it was. */
export interface FileFailure {
  src: string;
  error: PliError;
}

const asError = (error: unknown, src: string): PliError =>
  error instanceof PliError ? error : new PliError("storage", `Couldn't prepare "${src.slice(0, 60)}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });

function dataUri(src: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is.exec(src);
  if (!m || !/;base64$/i.test(m[2]!)) return null;
  const bytes = decodeBase64(m[3]!);
  return bytes ? { type: m[1] || "application/octet-stream", bytes } : null;
}

// ---- Where the pictures are ------------------------------------------------------------------------------------

type Mapper = (src: string) => string;

function mapPictures(pictures: HeaderFooterPictures | undefined, map: Mapper): HeaderFooterPictures | undefined {
  if (!pictures) return pictures;
  const out: HeaderFooterPictures = {};
  for (const [section, parts] of Object.entries(pictures)) {
    const next: Record<string, HeaderFooterPicture> = {};
    for (const [part, picture] of Object.entries(parts ?? {})) if (picture) next[part] = { ...picture, src: map(picture.src) };
    (out as Record<string, unknown>)[section] = next;
  }
  return out;
}

function mapCell(cell: Cell, map: Mapper): Cell {
  let next = cell;
  if (cell.picture) next = { ...next, picture: { ...cell.picture, src: map(cell.picture.src) } };
  if (cell.noteBox?.picture) next = { ...next, noteBox: { ...cell.noteBox, picture: map(cell.noteBox.picture) } };
  return next;
}

/** The workbook with every picture address passed through `map`: pictures on the sheets, pictures in cells, the pictures that fill notes, and the ones in headers and footers. */
export function mapPictureSources(wb: Workbook, map: Mapper): Workbook {
  const sheet = (s: Sheet): Sheet => {
    let next = s;
    if (s.images?.length) next = { ...next, images: s.images.map((i) => ({ ...i, src: map(i.src) })) };
    let cells: Record<string, Cell> | undefined;
    for (const [address, cell] of Object.entries(s.cells)) {
      if (!cell.picture && !cell.noteBox?.picture) continue;
      (cells ??= { ...s.cells })[address] = mapCell(cell, map);
    }
    if (cells) next = { ...next, cells };
    if (s.page?.pictures) next = { ...next, page: { ...s.page, pictures: mapPictures(s.page.pictures, map) } as PageSetup };
    return next;
  };
  return { ...wb, sheets: wb.sheets.map(sheet) };
}

/** Every picture address a workbook uses. */
export function pictureSources(wb: Workbook): Set<string> {
  const into = new Set<string>();
  mapPictureSources(wb, (src) => {
    into.add(src);
    return src;
  });
  return into;
}

// ---- The workbook as a file ------------------------------------------------------------------------------------

/** What a stored workbook holds besides the workbook: where the rows of its data blocks are. */
interface StoredFiles {
  data?: Record<string, string>;
}

/** The kind of file a stored workbook is. */
export const STORED_TYPE = "application/vnd.pli.sheet+json";

/**
 * A source of picture bytes on top of your file storage: the same picture is uploaded once, and what was uploaded (or learned
 * from a workbook) is found again without asking the adapter. Pass it to `saveWorkbook` and `loadWorkbook` to share the cache.
 */
export interface PictureStore {
  /** Puts a picture (a `data:` address) in storage and returns its reference. */
  put(src: string, name?: string): Promise<string>;
  /** The picture a reference stands for, as a `data:` address. */
  get(ref: string): Promise<string>;
}

export function pictureStore(storage: StorageClient, options: { prefix?: string } = {}): PictureStore {
  const prefix = (options.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const known = new Map<string, Promise<string>>(); // data address -> reference
  const loaded = new Map<string, Promise<string>>(); // reference -> data address
  let count = 0;
  return {
    put(src, name) {
      const hit = known.get(src);
      if (hit) return hit;
      const data = dataUri(src);
      if (!data) return Promise.reject(new PliError("storage", "Only a picture embedded as a base64 data: address can be stored."));
      const file = `${prefix ? `${prefix}/` : ""}${name ?? `picture-${++count}`}.${EXTENSION[data.type] ?? "bin"}`;
      const up = storage.upload(memoryFile(data.bytes, data.type, file), { name: file, type: data.type }).then((result) => {
        if (result.url) storage.prime(result.ref, result.url);
        loaded.set(result.ref, Promise.resolve(src));
        return result.ref;
      });
      known.set(src, up);
      up.catch(() => known.delete(src));
      return up;
    },
    get(ref) {
      const hit = loaded.get(ref);
      if (hit) return hit;
      const read = storage.read(ref).then(async (blob) => `data:${blob.type || "application/octet-stream"};base64,${encodeBase64(await bytesOf(blob))}`);
      loaded.set(ref, read);
      read.catch(() => loaded.delete(ref));
      return read;
    },
  };
}

export interface SavedWorkbook {
  /** The reference to load it with. */
  ref: string;
  /** The workbook as stored: pictures are references, and data blocks keep only their field names. */
  workbook: Workbook;
  /** The references of the data blocks' rows, by the source a pivot table names (what `storageData` reads). */
  data: Record<string, string>;
  /** The pictures that stayed embedded because they couldn't be uploaded. */
  failed: FileFailure[];
}

/**
 * Saves a workbook as one file in storage: its pictures go to storage (equal pictures once), the rows of its data blocks go to
 * their own files, and the workbook, as JSON with references, goes after them. Pictures that can't be uploaded stay embedded
 * and are listed in `failed`.
 */
export async function saveWorkbook(wb: Workbook, storage: StorageClient, options: { name?: string; pictures?: PictureStore } = {}): Promise<SavedWorkbook> {
  const name = options.name ?? `${wb.id}.sheet.json`;
  const pictures = options.pictures ?? pictureStore(storage, { prefix: name.replace(/\.[^.]*$/, "").replace(/\.sheet$/, "") });
  const failed: FileFailure[] = [];
  const map = new Map<string, string>();
  await Promise.all(
    [...pictureSources(wb)]
      .filter(isInline)
      .map(async (src) => {
        try {
          map.set(src, await pictures.put(src));
        } catch (error) {
          failed.push({ src, error: asError(error, src) });
        }
      }),
  );
  let stored = mapPictureSources(wb, (src) => map.get(src) ?? src);
  const data: Record<string, string> = {};
  if (wb.dataBlocks?.length) {
    const blocks = await Promise.all(
      wb.dataBlocks.map(async (block, i): Promise<DataBlock> => {
        const file = `${name.replace(/\.[^.]*$/, "")}-data-${i + 1}.json`;
        const text = JSON.stringify({ source: block.source, rows: block.rows, ...(block.formats ? { formats: block.formats } : {}) });
        const result = await storage.upload(memoryFile(new TextEncoder().encode(text), "application/json", file), { name: file, type: "application/json" });
        data[block.source] = result.ref;
        // The rows are in their own file; the workbook keeps the field names so that it stays a valid workbook.
        return { ...block, rows: block.rows.slice(0, 1) };
      }),
    );
    stored = { ...stored, dataBlocks: blocks };
  }
  const files: StoredFiles = Object.keys(data).length ? { data } : {};
  const text = JSON.stringify({ ...(JSON.parse(serializeWorkbook(stored)) as object), files });
  const result = await storage.upload(memoryFile(new TextEncoder().encode(text), STORED_TYPE, name), { name, type: STORED_TYPE });
  return { ref: result.ref, workbook: stored, data, failed };
}

export interface LoadedWorkbook {
  workbook: Workbook;
  /** The references of the rows of each data block, by source (give them to `storageData`). */
  data: Record<string, string>;
  /** Pictures that could not be fetched (they are left as references). */
  failed: FileFailure[];
}

/**
 * Loads a workbook saved with `saveWorkbook`: pictures are fetched (a few at a time, the client limits it) and put back as `data:`
 * addresses, and the rows of data blocks are read back. A picture that can't be fetched makes the workbook fail to open, unless
 * `lenient` is set, which leaves the picture out and lists it in `failed`.
 */
export async function loadWorkbook(ref: string, storage: StorageClient, options: { pictures?: PictureStore; lenient?: boolean } = {}): Promise<LoadedWorkbook> {
  const raw = JSON.parse(new TextDecoder().decode(await bytesOf(await storage.read(ref)))) as { workbook: Workbook; files?: StoredFiles };
  const pictures = options.pictures ?? pictureStore(storage);
  const failed: FileFailure[] = [];
  const map = new Map<string, string>();
  await Promise.all(
    [...pictureSources(raw.workbook)]
      .filter((src) => !isInline(src))
      .map(async (src) => {
        try {
          map.set(src, await pictures.get(src));
        } catch (error) {
          if (!options.lenient) throw asError(error, src);
          failed.push({ src, error: asError(error, src) });
        }
      }),
  );
  let workbook = mapPictureSources(raw.workbook, (src) => map.get(src) ?? src);
  if (options.lenient && failed.length) workbook = dropPictures(workbook, new Set(failed.map((f) => f.src)));
  const data = raw.files?.data ?? {};
  if (workbook.dataBlocks?.length) {
    workbook = {
      ...workbook,
      dataBlocks: await Promise.all(
        workbook.dataBlocks.map(async (block) => {
          const file = data[block.source];
          if (!file) return block;
          const read = JSON.parse(new TextDecoder().decode(await bytesOf(await storage.read(file)))) as { rows: DataBlock["rows"]; formats?: string[] };
          return { ...block, rows: read.rows, ...(read.formats ? { formats: read.formats } : {}) };
        }),
      ),
    };
  }
  return { workbook: parseWorkbook(serializeWorkbook(workbook)), data, failed };
}

/** The workbook without the pictures at these addresses (what `lenient` leaves of the ones that couldn't be fetched). */
function dropPictures(wb: Workbook, missing: ReadonlySet<string>): Workbook {
  const kept = (src: string) => !missing.has(src);
  return {
    ...wb,
    sheets: wb.sheets.map((s) => {
      const next: Sheet = { ...s };
      if (s.images) next.images = s.images.filter((i) => kept(i.src));
      const cells: Record<string, Cell> = {};
      for (const [a, c] of Object.entries(s.cells)) {
        let cell = c;
        if (cell.picture && !kept(cell.picture.src)) {
          const { picture: _p, ...rest } = cell;
          cell = rest;
        }
        if (cell.noteBox?.picture && !kept(cell.noteBox.picture)) {
          const { picture: _p, ...box } = cell.noteBox;
          cell = { ...cell, noteBox: box };
        }
        cells[a] = cell;
      }
      next.cells = cells;
      return next;
    }),
  };
}

// ---- Data blocks, on demand ------------------------------------------------------------------------------------

/**
 * A pivot-data resolver that reads the rows of `data:` sources from storage, given where each is (`SavedWorkbook.data`, or what you
 * keep): a refresh of a pivot table then fetches the current file instead of using the rows kept in the workbook.
 *
 *     const session = new SheetSession(workbook, { pivotData: storageData(storage, saved.data) });
 */
export function storageData(storage: StorageClient, refs: Record<string, string> | ((request: PivotDataRequest) => string | undefined)): PivotDataResolver {
  return async (request): Promise<PivotDataAnswer> => {
    const ref = typeof refs === "function" ? refs(request) : refs[request.source];
    if (!ref) return null;
    const read = JSON.parse(new TextDecoder().decode(await bytesOf(await storage.read(ref)))) as { rows: DataBlock["rows"]; formats?: string[] };
    return { rows: read.rows, ...(read.formats ? { formats: read.formats } : {}) };
  };
}
