import { describe, expect, it } from "vitest";
import { StorageClient, encodeBase64, type StorageAdapter } from "@pli.dev/core";
import {
  DeckSession,
  createDeck,
  fromPptx,
  imageSources,
  inlineImages,
  loadDeck,
  loadTemplate,
  resolveImages,
  saveDeck,
  storageFontSource,
  storeFont,
  storeImages,
  storeTemplate,
  toPptx,
  type Deck,
  type ImageElement,
} from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==";

/** An in-memory adapter, as a developer would write one over S3 or Supabase: upload, resolve and read. */
function memoryAdapter(options: { failUpload?: (name: string) => boolean } = {}): StorageAdapter & { files: Map<string, { bytes: Uint8Array; type: string }>; uploads: string[] } {
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const uploads: string[] = [];
  return {
    files,
    uploads,
    async upload(file, info) {
      if (options.failUpload?.(info.name)) throw new Error("the bucket is full");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ref = `bucket/${files.size}-${info.name}`;
      files.set(ref, { bytes, type: info.type });
      uploads.push(ref);
      return { ref };
    },
    resolve: (ref) => `https://files.example.com/${ref}?signed=1`,
    async read(ref) {
      const f = files.get(ref);
      if (!f) throw new Error("no such file");
      return { size: f.bytes.length, type: f.type, arrayBuffer: async () => f.bytes.slice().buffer as ArrayBuffer };
    },
  };
}

function deckWithPictures(): { deck: Deck; slide: string } {
  const s = new DeckSession(createDeck());
  const slide = s.deck.slides[0]!.id;
  s.addImage(slide, PNG, { w: 50, h: 50 });
  s.addImage(slide, PNG, { w: 50, h: 50 });
  s.addShape(slide, "rect", { x: 10, y: 100, w: 50, h: 50 }, { fill: { image: { src: PNG } } });
  s.setBackground([slide], { image: { src: PNG } });
  return { deck: s.deck, slide };
}

describe("a deck's files in storage", () => {
  it("moves the pictures out of the deck and back, once per picture", async () => {
    const { deck } = deckWithPictures();
    const adapter = memoryAdapter();
    const storage = new StorageClient(adapter);
    expect([...imageSources(deck)]).toEqual([PNG]);
    const stored = await storeImages(deck, storage);
    expect(stored.failed).toEqual([]);
    expect(adapter.uploads).toHaveLength(1);
    expect([...imageSources(stored.deck)]).toEqual([adapter.uploads[0]]);
    expect(JSON.stringify(stored.deck)).not.toContain("base64");
    const shown = await resolveImages(stored.deck, storage);
    expect([...imageSources(shown.deck)]).toEqual([`https://files.example.com/${adapter.uploads[0]}?signed=1`]);
    const inline = await inlineImages(stored.deck, storage);
    expect([...imageSources(inline.deck)][0]).toMatch(/^data:image\/png;base64,/);
    // the exported file has the pictures in it
    expect(fromPptx(toPptx(inline.deck)).deck.slides[0]!.elements.some((e) => e.type === "image")).toBe(true);
  });

  it("leaves a picture embedded when it can't be uploaded, and says which", async () => {
    const { deck } = deckWithPictures();
    const storage = new StorageClient(memoryAdapter({ failUpload: () => true }));
    const stored = await storeImages(deck, storage);
    expect(stored.failed).toHaveLength(1);
    expect(stored.failed[0]!.error.code).toBe("storage");
    expect([...imageSources(stored.deck)]).toEqual([PNG]);
  });

  it("reports a stored file that can't be read when exporting", async () => {
    const { deck } = deckWithPictures();
    const storage = new StorageClient({ upload: async () => ({ ref: "x/1" }) });
    const stored = await storeImages(deck, storage);
    const inline = await inlineImages(stored.deck, storage);
    expect(inline.failed[0]!.error.message).toMatch(/no read/);
    expect([...imageSources(inline.deck)]).toEqual(["x/1"]);
  });

  it("saves a deck and loads it again", async () => {
    const { deck } = deckWithPictures();
    const adapter = memoryAdapter();
    const storage = new StorageClient(adapter);
    const saved = await saveDeck(deck, storage, { name: "talk.deck.json" });
    const loaded = await loadDeck(saved.ref, storage);
    expect(loaded).toEqual(saved.deck);
    expect((loaded.slides[0]!.elements.find((e) => e.type === "image") as ImageElement).src).toMatch(/^bucket\//);
  });

  it("keeps a template with the deck and imports it from storage", async () => {
    const adapter = memoryAdapter();
    const storage = new StorageClient(adapter);
    const bytes = toPptx(createDeck());
    const { ref } = await storeTemplate({ size: bytes.length, type: "", name: "brand.potx", arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }, storage);
    const template = await loadTemplate(ref, storage);
    expect(template.masters.length).toBe(1);
  });

  it("serves fonts from storage to the browser and to PDF", async () => {
    const adapter = memoryAdapter();
    const storage = new StorageClient(adapter);
    const bytes = new Uint8Array([0, 1, 0, 0, 1, 2, 3]);
    const stored = await storeFont({ size: bytes.length, type: "font/ttf", name: "Brand.ttf", arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }, storage, { family: "Brand", weight: 700 });
    const source = storageFontSource([stored], storage);
    const family = { family: "Brand" } as never;
    const faces = await source.faces(family, { weight: 700, style: "normal" });
    expect(faces[0]).toMatchObject({ family: "Brand", weight: 700, format: "truetype", url: expect.stringContaining("https://files.example.com/") });
    expect(Array.from((await source.file!(family, { weight: 700, style: "normal", text: "" }))!)).toEqual(Array.from(bytes));
    expect(await source.faces({ family: "Other" } as never, { weight: 400, style: "normal" })).toEqual([]);
    void encodeBase64;
  });
});
