import { StorageClient, type StorageAdapter } from "@pli.dev/docs";

/**
 * A stand-in for a real file store, so the playground shows the whole flow: an upload that takes a
 * moment and reports progress, references saved in the document, and addresses resolved on display.
 * Files live in memory, so they are gone after a reload. Name a file with "fail" in it to see an upload fail.
 */
const files = new Map<string, Blob>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const adapter: StorageAdapter = {
  async upload(file, info) {
    for (let step = 1; step <= 10; step++) {
      await sleep(120);
      if (info.signal.aborted) throw new Error("aborted");
      info.onProgress(step / 10);
    }
    if (info.name.includes("fail")) throw new Error("Simulated network error");
    const ref = `demo/${Date.now().toString(36)}-${info.name}`;
    files.set(ref, file as Blob);
    return { ref };
  },
  resolve(ref) {
    const file = files.get(ref);
    if (!file) throw new Error(`No file stored as ${ref}`);
    return URL.createObjectURL(file);
  },
  async read(ref) {
    const file = files.get(ref);
    if (!file) throw new Error(`No file stored as ${ref}`);
    return file;
  },
};

export const demoStorage = new StorageClient(adapter, { maxBytes: 8_000_000, allowedTypes: ["image/*"] });
