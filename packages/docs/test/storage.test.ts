import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import {
  DocumentSession,
  PliError,
  StorageClient,
  caret,
  createDoc,
  dataUriStorage,
  embedImages,
  image,
  paragraph,
  resolveImages,
  table,
  toDocx,
  toHtml,
  type BlobLike,
  type Block,
  type StorageAdapter,
  type TableBlock,
  type UploadInfo,
} from "../src";

const file = (text: string, type = "image/png"): BlobLike & { name?: string } => {
  const bytes = new TextEncoder().encode(text);
  return { size: bytes.length, type, name: "pic.png", arrayBuffer: async () => bytes.slice().buffer };
};

/** An adapter whose uploads finish when the test says so. */
function gated(refFor: (info: UploadInfo) => string = () => "files/pic.png") {
  const pending: { info: UploadInfo; finish(): void; fail(error: unknown): void }[] = [];
  const adapter: StorageAdapter = {
    upload: (_f, info) =>
      new Promise((resolve, reject) => {
        pending.push({ info, finish: () => resolve({ ref: refFor(info) }), fail: reject });
      }),
    resolve: (ref) => `https://cdn.dev/${ref}`,
    read: async (ref) => file(`bytes of ${ref}`),
  };
  return { adapter, pending };
}

const setup = (adapter: StorageAdapter, extra: Block[] = []) => {
  const picture = image("blob:preview", { width: 100, height: 50 });
  const session = new DocumentSession(createDoc("T", [paragraph("hello"), ...extra]), { storage: new StorageClient(adapter) });
  session.select(caret(session.state.blocks[0]!.id, 5));
  session.insertBlockAtCaret(picture);
  return { session, picture };
};

const srcOf = (session: DocumentSession, id: string) => (session.state.blocks.find((b) => b.id === id) as { src: string }).src;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("uploading an image for a block", () => {
  it("points the block at the stored file when done, in the insert's undo step", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    expect(session.uploadState(picture.id)).toEqual({ status: "uploading", progress: 0 });
    expect(session.pendingUploads).toBe(1);
    pending[0]!.finish();
    expect(await done).toEqual({ status: "stored", merged: true });
    expect(srcOf(session, picture.id)).toBe("files/pic.png");
    expect(session.uploadState(picture.id)).toBeUndefined();
    expect(session.pendingUploads).toBe(0);

    // One undo removes the image; redo brings it back already pointing at the stored file.
    session.undo();
    expect(session.state.blocks.some((b) => b.id === picture.id)).toBe(false);
    session.redo();
    expect(srcOf(session, picture.id)).toBe("files/pic.png");
  });

  it("is its own undo step when something else changed first, and undo goes back to the preview", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    session.select(caret(session.state.blocks[0]!.id, 0));
    session.typeText("A");
    pending[0]!.finish();
    expect(await done).toEqual({ status: "stored", merged: false });
    expect(srcOf(session, picture.id)).toBe("files/pic.png");
    session.undo();
    expect(srcOf(session, picture.id)).toBe("blob:preview");
  });

  it("reports progress in steps", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const seen: number[] = [];
    session.onSelectionChange(() => {
      const state = session.uploadState(picture.id);
      if (state?.status === "uploading") seen.push(state.progress);
    });
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    pending[0]!.info.onProgress(0.01);
    pending[0]!.info.onProgress(0.3);
    pending[0]!.info.onProgress(0.31);
    pending[0]!.info.onProgress(0.6);
    pending[0]!.finish();
    await done;
    expect(seen).toEqual([0, 0.3, 0.6, 1].slice(0, seen.length));
    expect(seen).toContain(0.3);
    expect(seen).not.toContain(0.31);
  });

  it("primes the address when the adapter returns a url, so nothing is resolved", async () => {
    const resolve = vi.fn(async (ref: string) => `https://cdn.dev/${ref}`);
    const adapter: StorageAdapter = { upload: async () => ({ ref: "k", url: "https://public.dev/k" }), resolve };
    const { session, picture } = setup(adapter);
    await session.uploadImage(picture.id, file("x"));
    expect(await session.storage!.resolve("k")).toBe("https://public.dev/k");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the block and reports a failure, then retries with the same file", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const first = session.uploadImage(picture.id, file("x"));
    await flush();
    pending[0]!.fail(new Error("offline"));
    const outcome = await first;
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("storage");
    expect(session.uploadState(picture.id)).toMatchObject({ status: "failed" });
    expect(session.pendingUploads).toBe(0);
    expect(srcOf(session, picture.id)).toBe("blob:preview");

    const retry = session.retryUpload(picture.id)!;
    await flush();
    expect(session.uploadState(picture.id)).toMatchObject({ status: "uploading" });
    pending[1]!.finish();
    expect((await retry).status).toBe("stored");
    expect(session.retryUpload(picture.id)).toBeNull();
  });

  it("can be cancelled, and shows as failed with code 'cancelled'", async () => {
    const adapter: StorageAdapter = {
      upload: (_f, info) => new Promise((_, reject) => info.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const { session, picture } = setup(adapter);
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    session.cancelUpload(picture.id);
    const outcome = await done;
    expect(outcome.error?.code).toBe("cancelled");
    session.dismissUpload(picture.id);
    expect(session.uploadState(picture.id)).toBeUndefined();
  });

  it("drops the result if the image was removed meanwhile", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    session.transact([{ type: "delete_block", id: picture.id }]);
    pending[0]!.finish();
    expect(await done).toEqual({ status: "gone", merged: false });
    expect(session.uploadState(picture.id)).toBeUndefined();
  });

  it("whenUploadsSettle waits for running uploads, not failed ones", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const done = session.uploadImage(picture.id, file("x"));
    await flush();
    let settled = false;
    void session.whenUploadsSettle().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    pending[0]!.fail(new Error("no"));
    await done;
    await flush();
    expect(settled).toBe(true);
  });

  it("shares a running upload instead of starting a second", async () => {
    const { adapter, pending } = gated();
    const { session, picture } = setup(adapter);
    const a = session.uploadImage(picture.id, file("x"));
    const b = session.uploadImage(picture.id, file("x"));
    await flush();
    expect(a).toBe(b);
    pending[0]!.finish();
    await a;
    expect(pending).toHaveLength(1);
  });

  it("needs a storage client", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    expect(() => session.uploadImage("b", file("x"))).toThrow(PliError);
    expect(session.storage).toBeNull();
    session.setStorage(new StorageClient(dataUriStorage()));
    expect(session.storage).not.toBeNull();
  });
});

describe("preparing images for export", () => {
  const withImages = () => {
    const cell = table([["a"]]);
    (cell.rows[0]!.cells[0]!.blocks as Block[]).push(image("files/in-cell.png", { width: 10, height: 10 }) as never);
    return {
      ...createDoc("T", [image("files/a.png", { width: 10, height: 10 }), image("data:image/png;base64,AAAA", { width: 10, height: 10 }), cell, paragraph("x")]),
      header: [image("files/header.png", { width: 5, height: 5 })],
    };
  };

  it("resolves stored references to addresses everywhere, leaving inline images alone", async () => {
    const storage = new StorageClient({ upload: async () => ({ ref: "r" }), resolve: (ref) => `https://cdn.dev/${ref}` });
    const { doc, failed } = await resolveImages(withImages(), storage);
    expect(failed).toEqual([]);
    expect((doc.blocks[0] as { src: string }).src).toBe("https://cdn.dev/files/a.png");
    expect((doc.blocks[1] as { src: string }).src).toBe("data:image/png;base64,AAAA");
    const cellImage = (doc.blocks[2] as TableBlock).rows[0]!.cells[0]!.blocks[1] as { src: string };
    expect(cellImage.src).toBe("https://cdn.dev/files/in-cell.png");
    expect((doc.header![0] as { src: string }).src).toBe("https://cdn.dev/files/header.png");
    expect(toHtml(doc)).toContain('src="https://cdn.dev/files/a.png"');
  });

  it("embeds the bytes as data URIs, sniffing the type when storage doesn't say", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const storage = new StorageClient({
      upload: async () => ({ ref: "r" }),
      read: async () => ({ size: png.length, type: "", arrayBuffer: async () => png.slice().buffer }),
    });
    const { doc, failed } = await embedImages(withImages(), storage);
    expect(failed).toEqual([]);
    expect((doc.blocks[0] as { src: string }).src).toMatch(/^data:image\/png;base64,/);
    expect((doc.header![0] as { src: string }).src).toMatch(/^data:image\/png;base64,/);
  });

  it("lists images it couldn't prepare and leaves them as they were", async () => {
    const noRead = new StorageClient({ upload: async () => ({ ref: "r" }) });
    const original = withImages();
    const { doc, failed } = await embedImages(original, noRead);
    expect(failed.map((f) => f.src).sort()).toEqual(["files/a.png", "files/header.png", "files/in-cell.png"]);
    expect(failed.every((f) => f.error.code === "storage")).toBe(true);
    expect((doc.blocks[0] as { src: string }).src).toBe("files/a.png");

    const notAnImage = new StorageClient({ upload: async () => ({ ref: "r" }), read: async () => file("<html>", "text/html") });
    const second = await embedImages(createDoc("T", [image("files/x", { width: 1, height: 1 })]), notAnImage);
    expect(second.failed[0]!.error.message).toContain("doesn't look like an image");
  });

  it("round-trips through a data-URI client", async () => {
    const storage = new StorageClient(dataUriStorage());
    const { ref } = await storage.upload(file("pixels"));
    const { doc } = await embedImages(createDoc("T", [image(ref, { width: 1, height: 1 })]), storage);
    expect((doc.blocks[0] as { src: string }).src).toBe(ref);
  });

  it("puts a stored image into a Word file, which can't be done without preparing the document", async () => {
    // A real 1x1 PNG.
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const storage = new StorageClient({
      upload: async () => ({ ref: "files/one.png" }),
      read: async () => ({ size: png.length, type: "image/png", arrayBuffer: async () => png.slice().buffer }),
    });
    const doc = createDoc("T", [image("files/one.png", { width: 40, height: 40 })]);
    const media = (bytes: Uint8Array) => Object.keys(unzipSync(bytes)).filter((name) => name.startsWith("word/media/"));
    expect(media(toDocx(doc))).toEqual([]);
    const { doc: ready } = await embedImages(doc, storage);
    expect(media(toDocx(ready))).toEqual(["word/media/image1.png"]);
  });
});
