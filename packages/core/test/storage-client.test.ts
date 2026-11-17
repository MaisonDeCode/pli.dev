import { describe, expect, it, vi } from "vitest";
import { PliError, StorageClient, dataUriStorage, type BlobLike, type StorageAdapter, type UploadInfo } from "../src";

const file = (text: string, type = "image/png", name?: string): BlobLike & { name?: string } => {
  const bytes = new TextEncoder().encode(text);
  return { size: bytes.length, type, name, arrayBuffer: async () => bytes.slice().buffer };
};

const textOf = async (blob: BlobLike) => new TextDecoder().decode(await blob.arrayBuffer());

const rejected = async (promise: Promise<unknown>): Promise<PliError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PliError);
    return error as PliError;
  }
  throw new Error("expected a rejection");
};

/** An abort signal without needing AbortController in the test. */
function controller() {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    addEventListener: (_: "abort", l: () => void) => void listeners.add(l),
    removeEventListener: (_: "abort", l: () => void) => void listeners.delete(l),
  };
  return {
    signal,
    abort() {
      signal.aborted = true;
      [...listeners].forEach((l) => l());
    },
  };
}

describe("upload", () => {
  it("passes the file, its name and type to the adapter and returns the reference", async () => {
    const upload = vi.fn(async (_f: BlobLike, _i: UploadInfo) => ({ ref: "files/a.png", width: 40, height: 20 }));
    const client = new StorageClient({ upload });
    const result = await client.upload(file("x", "image/png", "a.png"));
    expect(result).toEqual({ ref: "files/a.png", width: 40, height: 20 });
    expect(upload.mock.calls[0]![1]).toMatchObject({ name: "a.png", type: "image/png" });
  });

  it("lets options override the name and type, and defaults the name", async () => {
    const seen: UploadInfo[] = [];
    const client = new StorageClient({ upload: async (_f, info) => (seen.push(info), { ref: "r" }) });
    await client.upload(file("x"), { name: "custom.png", type: "image/jpeg" });
    await client.upload(file("x"));
    expect(seen[0]).toMatchObject({ name: "custom.png", type: "image/jpeg" });
    expect(seen[1]!.name).toBe("file");
  });

  it("keeps a public url, drops nonsense sizes", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r", url: "https://x.dev/r", width: -3, height: Number.NaN }) });
    expect(await client.upload(file("x"))).toEqual({ ref: "r", url: "https://x.dev/r" });
  });

  it("refuses an adapter that returns no reference", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "" }) });
    expect((await rejected(client.upload(file("x")))).code).toBe("storage");
  });

  it("wraps adapter errors, keeping the cause", async () => {
    const boom = new Error("network down");
    const client = new StorageClient({ upload: async () => Promise.reject(boom) });
    const error = await rejected(client.upload(file("x")));
    expect(error.code).toBe("storage");
    expect(error.message).toContain("network down");
    expect(error.cause).toBe(boom);
  });

  it("passes through an adapter's own PliError", async () => {
    const own = new PliError("unsupported", "no");
    const client = new StorageClient({ upload: async () => Promise.reject(own) });
    expect(await rejected(client.upload(file("x")))).toBe(own);
  });

  it("keeps progress between 0 and 1 and never backwards, and ends at 1", async () => {
    const client = new StorageClient({
      upload: async (_f, info) => {
        [0.2, 0.1, 5, Number.NaN, -1, 0.9].forEach((n) => info.onProgress(n));
        return { ref: "r" };
      },
    });
    const seen: number[] = [];
    await client.upload(file("x"), { onProgress: (n) => seen.push(n) });
    // 0.2, then 0.1 (stays 0.2), 5 (capped to 1), NaN (ignored), -1 and 0.9 (stay 1), and the final 1.
    expect(seen).toEqual([0.2, 0.2, 1, 1, 1, 1]);
  });
});

describe("limits", () => {
  it("rejects files that are too big or the wrong type before calling the adapter", async () => {
    const upload = vi.fn(async () => ({ ref: "r" }));
    const client = new StorageClient({ upload }, { maxBytes: 3, allowedTypes: ["image/*", "application/pdf"] });
    expect((await rejected(client.upload(file("toolong")))).code).toBe("invalid_operation");
    expect((await rejected(client.upload(file("ab", "text/html")))).code).toBe("invalid_operation");
    expect((await rejected(client.upload(file("ab", "")))).code).toBe("invalid_operation");
    await client.upload(file("ab", "IMAGE/PNG"));
    await client.upload(file("ab", "application/pdf"));
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("check() can be used on its own", () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }) }, { maxBytes: 10 });
    expect(() => client.check({ size: 11, type: "image/png" })).toThrow(PliError);
    expect(() => client.check({ size: 10, type: "image/png" })).not.toThrow();
  });

  it("runs at most maxConcurrent uploads at once, in order", async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const client = new StorageClient(
      {
        upload: async (_f, info) => {
          running++;
          peak = Math.max(peak, running);
          order.push(info.name);
          await new Promise<void>((resolve) => gates.push(resolve));
          running--;
          return { ref: info.name };
        },
      },
      { maxConcurrent: 2 },
    );
    const all = ["a", "b", "c", "d"].map((n) => client.upload(file("x"), { name: n }));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a", "b"]);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["a", "b", "c"]);
    while (gates.length || running) {
      gates.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect((await Promise.all(all)).map((r) => r.ref)).toEqual(["a", "b", "c", "d"]);
    expect(peak).toBe(2);
  });
});

describe("cancelling", () => {
  it("rejects with 'cancelled' without calling the adapter if already aborted", async () => {
    const upload = vi.fn(async () => ({ ref: "r" }));
    const c = controller();
    c.abort();
    const client = new StorageClient({ upload });
    expect((await rejected(client.upload(file("x"), { signal: c.signal }))).code).toBe("cancelled");
    expect(upload).not.toHaveBeenCalled();
  });

  it("cancels an upload in progress, whether the adapter throws or finishes", async () => {
    const c = controller();
    const client = new StorageClient({
      upload: (_f, info) => new Promise((_, reject) => info.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    const pending = client.upload(file("x"), { signal: c.signal });
    c.abort();
    expect((await rejected(pending)).code).toBe("cancelled");

    const d = controller();
    const slow = new StorageClient({ upload: async () => (d.abort(), { ref: "r" }) });
    expect((await rejected(slow.upload(file("x"), { signal: d.signal }))).code).toBe("cancelled");
  });

  it("cancels an upload still waiting its turn, and frees the queue", async () => {
    const gates: (() => void)[] = [];
    const upload = vi.fn((_f: BlobLike, info: UploadInfo) => new Promise<{ ref: string }>((r) => gates.push(() => r({ ref: info.name }))));
    const client = new StorageClient({ upload }, { maxConcurrent: 1 });
    const first = client.upload(file("x"), { name: "first" });
    const c = controller();
    const queued = client.upload(file("x"), { name: "queued", signal: c.signal });
    const third = client.upload(file("x"), { name: "third" });
    await Promise.resolve();
    c.abort();
    expect((await rejected(queued)).code).toBe("cancelled");
    gates.shift()!();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    gates.shift()!();
    expect((await third).ref).toBe("third");
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe("resolve", () => {
  it("passes loadable addresses through when the adapter has no resolve, and refuses other refs", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }) });
    expect(await client.resolve("https://x.dev/a.png")).toBe("https://x.dev/a.png");
    expect(await client.resolve("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect((await rejected(client.resolve("files/a.png"))).code).toBe("storage");
  });

  it("asks the adapter, reuses the answer until it expires, and doesn't cache failures", async () => {
    let t = 0;
    let calls = 0;
    let fail = true;
    const client = new StorageClient(
      {
        upload: async () => ({ ref: "r" }),
        resolve: async (ref) => {
          calls++;
          if (fail) throw new Error("later");
          return `https://cdn.dev/${ref}?n=${calls}`;
        },
      },
      { resolveCacheMs: 1000, now: () => t },
    );
    expect((await rejected(client.resolve("a"))).code).toBe("storage");
    fail = false;
    expect(await client.resolve("a")).toBe("https://cdn.dev/a?n=2");
    expect(await client.resolve("a")).toBe("https://cdn.dev/a?n=2");
    t = 999;
    expect(await client.resolve("a")).toBe("https://cdn.dev/a?n=2");
    t = 1001;
    expect(await client.resolve("a")).toBe("https://cdn.dev/a?n=3");
    expect(await Promise.all([client.resolve("b"), client.resolve("b")])).toEqual(["https://cdn.dev/b?n=4", "https://cdn.dev/b?n=4"]);
  });

  it("calls the adapter for every address but data: and blob:", async () => {
    const resolve = vi.fn(async (ref: string) => ref);
    const client = new StorageClient({ upload: async () => ({ ref: "r" }), resolve });
    await client.resolve("https://bucket.example/key");
    await client.resolve("data:image/png;base64,AAAA");
    await client.resolve("blob:abc");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty answer", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }), resolve: async () => "" });
    expect((await rejected(client.resolve("a"))).code).toBe("storage");
  });
});

describe("read and delete", () => {
  it("throws, not an empty file, when the adapter can't read", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }) });
    expect(client.canRead).toBe(false);
    expect((await rejected(client.read("files/a.png"))).code).toBe("storage");
  });

  it("reads through the adapter and wraps its errors", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }), read: async (ref) => (ref === "ok" ? file("bytes") : Promise.reject(new Error("404"))) });
    expect(client.canRead).toBe(true);
    expect(await textOf(await client.read("ok"))).toBe("bytes");
    expect((await rejected(client.read("missing"))).message).toContain("404");
  });

  it("decodes data URIs itself, without an adapter", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }) });
    const blob = await client.read("data:text/plain;base64,aGVsbG8=");
    expect(blob.type).toBe("text/plain");
    expect(blob.size).toBe(5);
    expect(await textOf(blob)).toBe("hello");
    expect((await rejected(client.read("data:text/plain,hello"))).code).toBe("storage");
    expect((await rejected(client.read("data:text/plain;base64,@@@"))).code).toBe("storage");
  });

  it("deletes through the adapter, and does nothing when it can't or for data URIs", async () => {
    const remove = vi.fn(async () => {});
    const client = new StorageClient({ upload: async () => ({ ref: "r" }), delete: remove });
    expect(client.canDelete).toBe(true);
    await client.delete("files/a.png");
    await client.delete("data:image/png;base64,AAAA");
    expect(remove).toHaveBeenCalledTimes(1);
    const plain = new StorageClient({ upload: async () => ({ ref: "r" }) });
    expect(plain.canDelete).toBe(false);
    await expect(plain.delete("x")).resolves.toBeUndefined();
  });

  it("wraps a failing delete", async () => {
    const client = new StorageClient({ upload: async () => ({ ref: "r" }), delete: async () => Promise.reject(new Error("denied")) });
    expect((await rejected(client.delete("a"))).code).toBe("storage");
  });
});

describe("dataUriStorage", () => {
  it("round-trips any bytes through a data URI", async () => {
    const client = new StorageClient(dataUriStorage());
    for (const length of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255);
      const input: BlobLike = { size: bytes.length, type: "image/png", arrayBuffer: async () => bytes.slice().buffer };
      const { ref } = await client.upload(input);
      expect(ref.startsWith("data:image/png;base64,")).toBe(true);
      const back = new Uint8Array(await (await client.read(ref)).arrayBuffer());
      expect([...back]).toEqual([...bytes]);
    }
  });

  it("matches the platform's base64", async () => {
    const client = new StorageClient(dataUriStorage());
    const { ref } = await client.upload(file("Hello, Pli! ✓"));
    expect(ref).toBe(`data:image/png;base64,${Buffer.from("Hello, Pli! ✓").toString("base64")}`);
  });

  it("won't put a hostile type into the URI", async () => {
    const client = new StorageClient(dataUriStorage());
    const { ref } = await client.upload(file("x"), { type: "image/png;base64,evil<script>" });
    expect(ref.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("is a StorageAdapter that needs nothing else", async () => {
    const adapter: StorageAdapter = dataUriStorage();
    expect(adapter.resolve).toBeUndefined();
    expect(adapter.read).toBeUndefined();
  });
});
