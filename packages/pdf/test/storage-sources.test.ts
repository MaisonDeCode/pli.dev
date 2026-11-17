import { StorageClient, type StorageAdapter } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { hashBytes, openPdf, storageSources, type Source } from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

/** An adapter over a Map, like a bucket: refs are keys, addresses are `https://files.test/<ref>`. */
function bucket(opts: { read?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  const adapter: StorageAdapter = {
    async upload(file, info) {
      uploads.push(info.name);
      files.set(info.name, new Uint8Array(await file.arrayBuffer()));
      return { ref: info.name };
    },
    resolve: (ref) => `https://files.test/${ref}`,
    ...(opts.read ? { read: async (ref: string) => ({ size: files.get(ref)!.length, type: "application/pdf", arrayBuffer: async () => files.get(ref)!.slice().buffer as ArrayBuffer }) } : {}),
  };
  const fetch = async (url: string) => {
    const bytes = files.get(url.replace("https://files.test/", ""));
    return { ok: !!bytes, status: bytes ? 200 : 404, arrayBuffer: async () => (bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer };
  };
  return { files, uploads, client: new StorageClient(adapter), fetch };
}

const bytes = buildClassic(simpleDoc(2)).bytes;
const source = (over: Partial<Source> = {}): Source => ({ id: "main", name: "a.pdf", pages: 2, size: bytes.length, hash: hashBytes(bytes), ...over });

describe("storageSources", () => {
  it("uploads once per fingerprint and returns where the bytes went", async () => {
    const b = bucket();
    const store = storageSources(b.client, { key: "docs/1", fetch: b.fetch });
    const first = await store.put(source(), bytes);
    const second = await store.put(source({ id: "other" }), bytes);
    expect(first).toEqual({ location: `docs/1/${hashBytes(bytes)}.pdf` });
    expect(second).toEqual(first);
    expect(b.uploads).toHaveLength(1);
    expect(store.location(source())).toBe(first!.location);
  });

  it("fetches by the location a source carries, from a store that uploaded nothing itself", async () => {
    const b = bucket();
    const a = storageSources(b.client, { key: "k", fetch: b.fetch });
    const put = (await a.put(source(), bytes)) as { location: string };
    const other = storageSources(b.client, { key: "k", fetch: b.fetch });
    expect(await other.get(source())).toBeUndefined(); // no location known
    expect(await other.get(source({ location: put.location }))).toEqual(bytes);
    // and the second time from memory
    b.files.clear();
    expect(await other.get(source({ location: put.location }))).toEqual(bytes);
  });

  it("reads through the adapter when no fetch is given", async () => {
    const b = bucket({ read: true });
    const store = storageSources(b.client);
    const put = (await store.put(source(), bytes)) as { location: string };
    const other = storageSources(b.client);
    expect(await other.get(source({ location: put.location }))).toEqual(bytes);
  });

  it("refuses bytes that are not the file the source describes, and can try again after a failure", async () => {
    const b = bucket();
    const store = storageSources(b.client, { fetch: b.fetch });
    const wrong = source({ location: "pdf/x.pdf" });
    b.files.set("pdf/x.pdf", new TextEncoder().encode("%PDF-1.4 not it"));
    await expect(Promise.resolve(store.get(wrong))).rejects.toThrow(/fingerprint/);
    b.files.set("pdf/x.pdf", bytes);
    expect(await store.get(wrong)).toEqual(bytes);
    await expect(Promise.resolve(storageSources(b.client, { fetch: b.fetch }).get(source({ location: "missing" })))).rejects.toThrow(/HTTP 404/);
  });

  it("backs a session: the main file is uploaded when it is opened", async () => {
    const b = bucket();
    const sources = storageSources(b.client, { key: "s", fetch: b.fetch });
    const session = await openPdf(bytes, { sources });
    expect(b.uploads).toHaveLength(1);
    expect(await session.mainBytes()).toEqual(bytes);
  });
});
