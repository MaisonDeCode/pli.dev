import { decodeBase64, encodeBase64 } from "./base64";
import { PliError } from "./errors";

/**
 * Files (images today, attachments later) don't have to live inside a document as base64. A document
 * holds a short reference to each file, and a storage client sends the bytes to wherever the app keeps
 * them (S3, Supabase, Firebase, your own server) and turns a reference back into something that can be
 * shown or exported.
 *
 * - A `StorageAdapter` is what you write: a few functions that talk to your storage.
 * - A `StorageClient` is what Pli calls: it wraps an adapter and adds limits, cancellation, queueing,
 *   caching and clear errors, so each adapter stays small.
 *
 * None of this is required. Without a client, images are embedded in the document as data URIs.
 *
 * Nothing here uses a platform API (no DOM, `Blob` class, `fetch`, timers or Node built-ins), so the
 * same code runs in JavaScriptCore and QuickJS. A browser `Blob` or `File` and `AbortSignal` fit the
 * shapes below as they are.
 */

/** The part of a `Blob` that storage needs. A browser `Blob` or `File` already fits. */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of an `AbortSignal` that storage needs. A browser `AbortSignal` already fits. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface UploadInfo {
  /** The file's name, such as `chart.png`. */
  name: string;
  /** Its MIME type, such as `image/png`. */
  type: string;
  /** Stop uploading if this aborts. */
  signal: AbortSignalLike;
  /** Report progress from 0 to 1. Optional to call; the client keeps it in range and never lets it go backwards. */
  onProgress(fraction: number): void;
}

export interface UploadResult {
  /**
   * What the document stores for this file. Use something stable: a storage key or path, not a link that
   * expires. If the file is public, the full `https://` address is fine.
   */
  ref: string;
  /**
   * An address that can be shown right away, when you have one (a public file). If you leave it out, the
   * editor asks `resolve` for it.
   */
  url?: string;
  /** Pixel size, if your storage knows it. */
  width?: number;
  height?: number;
}

/** What you implement to connect Pli to your storage. Only `upload` is required. */
export interface StorageAdapter {
  /** Stores the file and returns its reference. */
  upload(file: BlobLike, info: UploadInfo): Promise<UploadResult>;
  /**
   * Turns a stored reference into an address a browser can load, such as a signed URL. Leave it out
   * if your references are already public addresses. It is called for every reference except `data:`
   * and `blob:` addresses, including plain `https://` ones, so return those unchanged.
   */
  resolve?(ref: string): string | Promise<string>;
  /** Fetches the file's bytes. Needed to export a document (Word, PDF) with its stored images in it. */
  read?(ref: string): Promise<BlobLike>;
  /** Removes a stored file. Pli never calls this on its own, since other documents may use the file. */
  delete?(ref: string): Promise<void>;
}

export interface StorageLimits {
  /** The largest file accepted, in bytes. No limit if omitted. */
  maxBytes?: number;
  /** MIME types accepted, such as `["image/png", "image/*"]`. Any type if omitted. */
  allowedTypes?: readonly string[];
  /** Uploads that may run at once. Default 3. */
  maxConcurrent?: number;
}

export interface StorageClientOptions extends StorageLimits {
  /**
   * How long, in milliseconds, a resolved address is reused before `resolve` is called again. Set it
   * below the lifetime of your signed URLs. Default 5 minutes; 0 turns the cache off.
   */
  resolveCacheMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

export interface UploadOptions {
  /** Defaults to the file's own name, or `file`. */
  name?: string;
  /** Defaults to the file's own type. */
  type?: string;
  signal?: AbortSignalLike;
  onProgress?: (fraction: number) => void;
}

/** A signal that never aborts, for calls that didn't pass one. */
const NEVER: AbortSignalLike = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};

/**
 * A cancel switch whose `signal` goes to `upload`. It does what an `AbortController` does, for runtimes
 * that don't have one (JavaScriptCore and QuickJS).
 */
export function createAbortHandle(): { signal: AbortSignalLike; abort(): void } {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    addEventListener(_type: "abort", listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "abort", listener: () => void) {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

const cancelled = () => new PliError("cancelled", "The upload was cancelled.");

/** Files held in memory, such as what `read` returns for a data URI. */
class MemoryBlob implements BlobLike {
  readonly size: number;
  constructor(
    private readonly bytes: Uint8Array,
    readonly type: string,
  ) {
    this.size = bytes.length;
  }
  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.bytes.slice().buffer);
  }
}

const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is;

/** Reads a base64 `data:` URI into bytes, or null if it is something else. */
function readDataUri(ref: string): { type: string; bytes: Uint8Array } | null {
  const match = DATA_URI.exec(ref);
  if (!match || !/;base64$/i.test(match[2]!)) return null;
  const bytes = decodeBase64(match[3]!);
  return bytes ? { type: match[1]! || "application/octet-stream", bytes } : null;
}

/** References that already are something a browser can load, so no adapter is needed to resolve them. */
const isLoadable = (ref: string) => /^(https?:|data:|blob:)/i.test(ref);

function typeAllowed(type: string, allowed: readonly string[]): boolean {
  const t = type.toLowerCase();
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.endsWith("/*") ? t.startsWith(p.slice(0, -1)) : t === p;
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What Pli calls to upload, show, export and remove files. Wrap your adapter in one and give it to the
 * editor.
 *
 * ```ts
 * const storage = new StorageClient(myAdapter, { maxBytes: 10_000_000, allowedTypes: ["image/*"] });
 * const { ref } = await storage.upload(file, { onProgress });
 * const address = await storage.resolve(ref);
 * ```
 *
 * Every failure is a `PliError`: code `storage` when the adapter failed or can't do what was asked,
 * `invalid_operation` when a file breaks the limits, and `cancelled` when the caller aborted.
 */
export class StorageClient {
  readonly #adapter: StorageAdapter;
  readonly #limits: StorageLimits;
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #resolved = new Map<string, { at: number; value: Promise<string> }>();
  #active = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(adapter: StorageAdapter, options: StorageClientOptions = {}) {
    this.#adapter = adapter;
    this.#limits = options;
    this.#cacheMs = options.resolveCacheMs ?? 5 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  /** Whether stored files can be fetched back, which exporting a document with its images needs. */
  get canRead(): boolean {
    return !!this.#adapter.read;
  }

  /** Whether files can be removed. */
  get canDelete(): boolean {
    return !!this.#adapter.delete;
  }

  /**
   * Checks a file against the limits without uploading it. Throws a `PliError` (`invalid_operation`)
   * saying what is wrong. Call it early to refuse a file before showing anything for it.
   */
  check(file: Pick<BlobLike, "size" | "type">, type: string = file.type): void {
    const { maxBytes, allowedTypes } = this.#limits;
    if (allowedTypes && !typeAllowed(type, allowedTypes)) {
      throw new PliError("invalid_operation", `Files of type "${type || "unknown"}" aren't allowed here. Allowed: ${allowedTypes.join(", ")}.`);
    }
    if (maxBytes !== undefined && file.size > maxBytes) {
      throw new PliError("invalid_operation", `The file is ${file.size} bytes; the limit is ${maxBytes}.`);
    }
  }

  /** Uploads a file and returns its reference. At most `maxConcurrent` uploads run at once. */
  async upload(file: BlobLike & { name?: string }, options: UploadOptions = {}): Promise<UploadResult> {
    const signal = options.signal ?? NEVER;
    const type = options.type ?? file.type;
    const name = options.name ?? file.name ?? "file";
    this.check(file, type);

    await this.#acquire(signal);
    try {
      if (signal.aborted) throw cancelled();
      let reported = 0;
      const onProgress = (fraction: number) => {
        if (!Number.isFinite(fraction)) return;
        reported = Math.max(reported, Math.min(1, Math.max(0, fraction)));
        options.onProgress?.(reported);
      };

      let result: UploadResult;
      try {
        result = await this.#adapter.upload(file, { name, type, signal, onProgress });
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (error instanceof PliError) throw error;
        throw new PliError("storage", `Upload failed: ${message(error)}`, { cause: error });
      }
      if (signal.aborted) throw cancelled();
      if (!result || typeof result.ref !== "string" || result.ref === "") {
        throw new PliError("storage", "The storage adapter didn't return a reference for the uploaded file.");
      }
      onProgress(1);

      const positive = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
      const url = typeof result.url === "string" && result.url !== "" ? result.url : undefined;
      const width = positive(result.width);
      const height = positive(result.height);
      return { ref: result.ref, ...(url && { url }), ...(width && { width }), ...(height && { height }) };
    } finally {
      this.#release();
    }
  }

  /**
   * The address to show a stored file at. A reference that already is an `https://`, `data:` or `blob:`
   * address comes back as it is when the adapter has no `resolve`. Results are reused for `resolveCacheMs`.
   */
  resolve(ref: string): Promise<string> {
    const resolver = this.#adapter.resolve;
    if (!resolver) {
      return isLoadable(ref)
        ? Promise.resolve(ref)
        : Promise.reject(new PliError("storage", `Can't show "${ref}": the storage adapter has no resolve() to turn it into an address.`));
    }
    if (/^(data|blob):/i.test(ref)) return Promise.resolve(ref);

    const cached = this.#resolved.get(ref);
    if (cached && this.#cacheMs > 0 && this.#now() - cached.at < this.#cacheMs) return cached.value;

    const value = Promise.resolve()
      .then(() => resolver.call(this.#adapter, ref))
      .then((url) => {
        if (typeof url !== "string" || url === "") throw new PliError("storage", `resolve() returned no address for "${ref}".`);
        return url;
      })
      .catch((error: unknown) => {
        this.#resolved.delete(ref);
        throw error instanceof PliError ? error : new PliError("storage", `Couldn't resolve "${ref}": ${message(error)}`, { cause: error });
      });
    this.#resolved.set(ref, { at: this.#now(), value });
    return value;
  }

  /**
   * Remembers the address for a reference, so showing a file just uploaded doesn't call `resolve`. Used
   * with the `url` an upload returns.
   */
  prime(ref: string, url: string): void {
    this.#resolved.set(ref, { at: this.#now(), value: Promise.resolve(url) });
  }

  /**
   * The bytes of a stored file, for exporting. A `data:` URI is decoded here; anything else needs the
   * adapter's `read`. Throws a `PliError` (`storage`) if the file can't be read, rather than returning
   * an empty file that would quietly produce a blank image.
   */
  async read(ref: string): Promise<BlobLike> {
    const embedded = readDataUri(ref);
    if (embedded) return new MemoryBlob(embedded.bytes, embedded.type);
    if (/^data:/i.test(ref)) throw new PliError("storage", "That data URI isn't base64, so it can't be read.");

    const reader = this.#adapter.read;
    if (!reader) {
      throw new PliError("storage", `Can't read "${ref}": the storage adapter has no read(). Add it to export documents with stored files.`);
    }
    try {
      const file = await reader.call(this.#adapter, ref);
      if (!file || typeof file.arrayBuffer !== "function") throw new Error("read() didn't return a file");
      return file;
    } catch (error) {
      throw error instanceof PliError ? error : new PliError("storage", `Couldn't read "${ref}": ${message(error)}`, { cause: error });
    }
  }

  /** Removes a stored file, if the adapter can. Does nothing for a data URI or an adapter without `delete`. */
  async delete(ref: string): Promise<void> {
    const remove = this.#adapter.delete;
    if (!remove || /^(data|blob):/i.test(ref)) return;
    this.#resolved.delete(ref);
    try {
      await remove.call(this.#adapter, ref);
    } catch (error) {
      throw error instanceof PliError ? error : new PliError("storage", `Couldn't delete "${ref}": ${message(error)}`, { cause: error });
    }
  }

  #acquire(signal: AbortSignalLike): Promise<void> {
    if (signal.aborted) return Promise.reject(cancelled());
    if (this.#active < (this.#limits.maxConcurrent ?? 3)) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const turn = () => {
        signal.removeEventListener("abort", onAbort);
        this.#active++;
        resolve();
      };
      const onAbort = () => {
        const at = this.#waiting.indexOf(turn);
        if (at >= 0) this.#waiting.splice(at, 1);
        reject(cancelled());
      };
      this.#waiting.push(turn);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #release(): void {
    this.#active--;
    this.#waiting.shift()?.();
  }
}

/**
 * The default adapter: the file becomes a base64 `data:` URI that the document stores directly. Needs no
 * server, but makes documents large, so use a real store for anything beyond small images.
 */
export function dataUriStorage(): StorageAdapter {
  return {
    async upload(file, info) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(info.type) ? info.type : "application/octet-stream";
      info.onProgress(1);
      return { ref: `data:${type};base64,${encodeBase64(bytes)}` };
    },
  };
}
