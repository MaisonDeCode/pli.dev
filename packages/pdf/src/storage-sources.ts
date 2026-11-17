/**
 * A `SourceStore` on top of your file storage (`@pli.dev/core` `StorageClient`): the bytes of the PDF files a document uses live
 * in your storage, and other people who open the same shared document fetch them from there.
 *
 *     const sources = storageSources(storage, { key: "contracts/42", fetch: (url) => fetch(url) });
 *     const session = await openPdf(bytes, { sources });
 *
 * `put` uploads the bytes (once per fingerprint) and returns where they went (`location`), which `merge` records on the
 * `Source` so it travels with the document. `get` finds the bytes by `source.location`, or by what this store uploaded itself
 * for that fingerprint, and checks they are the file the source describes.
 */
import { PliError, type StorageClient } from "@pli.dev/core";
import type { Source } from "./model";
import { hashBytes, type SourceStore } from "./sources";

export interface StorageSourcesOptions {
  /** Names the uploaded files (`<key>/<hash>.pdf`): usually the document's id. Default `pdf`. */
  key?: string;
  /**
   * How to fetch the bytes of a stored file from the address `storage.resolve(location)` gives: your `fetch`. Without it
   * the store uses `storage.read(location)` (the adapter's `read`).
   */
  fetch?: (url: string) => Promise<{ ok?: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Check that fetched bytes have the fingerprint of the source (default true). */
  verify?: boolean;
}

/** A source store whose files are kept by `storage`. */
export function storageSources(storage: StorageClient, options: StorageSourcesOptions = {}): SourceStore & { location(source: Source): string | undefined } {
  const key = (options.key ?? "pdf").replace(/^\/+|\/+$/g, "");
  const known = new Map<string, string>(); // fingerprint -> location (what we uploaded, or learned from a source)
  const cache = new Map<string, Promise<Uint8Array | undefined>>(); // fingerprint -> bytes
  const uploading = new Map<string, Promise<{ location?: string }>>();

  const locationOf = (source: Source): string | undefined => source.location ?? known.get(source.hash);

  async function download(location: string): Promise<Uint8Array> {
    if (options.fetch) {
      const url = await storage.resolve(location);
      const res = await options.fetch(url);
      if (res.ok === false) throw new PliError("storage", `Could not fetch ${location} (HTTP ${res.status ?? "error"}).`);
      return new Uint8Array(await res.arrayBuffer());
    }
    return new Uint8Array(await (await storage.read(location)).arrayBuffer());
  }

  return {
    location: locationOf,

    get(source) {
      const cached = cache.get(source.hash);
      if (cached) return cached;
      const location = locationOf(source);
      if (!location) return undefined;
      const pending = download(location).then((bytes) => {
        if (options.verify !== false && source.hash && hashBytes(bytes) !== source.hash) throw new PliError("storage", `The stored file ${source.name || source.id} is not the one the document uses (its fingerprint differs).`);
        return bytes;
      });
      cache.set(source.hash, pending);
      pending.catch(() => cache.delete(source.hash)); // a failure can be tried again
      return pending;
    },

    async put(source, bytes) {
      cache.set(source.hash, Promise.resolve(bytes));
      const have = locationOf(source);
      if (have) return { location: have };
      let up = uploading.get(source.hash);
      if (!up) {
        const name = `${key}/${source.hash}.pdf`;
        const file = { size: bytes.length, type: "application/pdf", name, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
        up = storage.upload(file, { name, type: "application/pdf" }).then(
          (result) => {
            known.set(source.hash, result.ref);
            return { location: result.ref };
          },
          (error) => {
            uploading.delete(source.hash);
            throw error;
          },
        );
        uploading.set(source.hash, up);
      }
      return up;
    },
  };
}
