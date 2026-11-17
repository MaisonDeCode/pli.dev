import { PliError, encodeBase64, type StorageClient } from "@pli.dev/core";
import type { Block, CellBlock, Doc, ImageBlock } from "./model";
import { REGION_NAMES } from "./regions";

/** The images in a list of blocks, with the ones named in `sources` pointed at a new `src`. Other blocks are returned as they were. */
export function withImageSources(blocks: readonly Block[], sources: ReadonlyMap<string, string>): Block[] {
  const image = (b: CellBlock): CellBlock => (b.type === "image" && sources.has(b.id) ? { ...b, src: sources.get(b.id)! } : b);
  return blocks.map((block) => {
    if (block.type === "image") return image(block) as Block;
    if (block.type !== "table") return block;
    return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => (c.covered ? c : { ...c, blocks: c.blocks.map(image) })) })) };
  });
}

/** The images among some blocks, including those in table cells. */
export function imagesIn(blocks: readonly Block[]): ImageBlock[] {
  return blocks.flatMap((b): ImageBlock[] =>
    b.type === "image" ? [b] : b.type === "table" ? b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.filter((x): x is ImageBlock => x.type === "image"))) : [],
  );
}

/** An image that couldn't be prepared. The image is left as it was. */
export interface FileFailure {
  blockId: string;
  src: string;
  error: PliError;
}

export interface PreparedDoc {
  doc: Doc;
  failed: FileFailure[];
}

const isInline = (src: string) => /^(data|blob):/i.test(src);

/** Applies `change` to every image in the document, including table cells, headers and footers. */
async function mapImages(doc: Doc, change: (image: ImageBlock) => Promise<ImageBlock>): Promise<Doc> {
  const cell = async (blocks: readonly CellBlock[]): Promise<CellBlock[]> =>
    Promise.all(blocks.map(async (b) => (b.type === "image" ? change(b) : b)));
  const list = async (blocks: readonly Block[]): Promise<Block[]> =>
    Promise.all(
      blocks.map(async (block): Promise<Block> => {
        if (block.type === "image") return change(block);
        if (block.type === "section_break" && block.regions) {
          // A section's own headers and footers can hold images too.
          const entries = await Promise.all(Object.entries(block.regions).map(async ([name, blocks]) => [name, await list(blocks)] as const));
          return { ...block, regions: Object.fromEntries(entries) };
        }
        if (block.type !== "table") return block;
        const rows = await Promise.all(
          block.rows.map(async (row) => ({
            ...row,
            cells: await Promise.all(row.cells.map(async (c) => (c.covered ? c : { ...c, blocks: await cell(c.blocks) }))),
          })),
        );
        return { ...block, rows };
      }),
    );
  const [blocks, ...regions] = await Promise.all([list(doc.blocks), ...REGION_NAMES.map((name) => (doc[name] ? list(doc[name]!) : undefined))]);
  const next: Doc = { ...doc, blocks };
  REGION_NAMES.forEach((name, i) => {
    if (regions[i]) next[name] = regions[i];
  });
  return next;
}

const asError = (error: unknown, src: string) =>
  error instanceof PliError ? error : new PliError("storage", `Couldn't prepare "${src}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });

/**
 * Swaps each image's stored reference for an address a browser can load, using the storage client. Use
 * it before `toHtml` or `toMarkdown`, which write addresses and don't call storage themselves. Images
 * that can't be resolved are left as they are and listed in `failed`.
 */
export async function resolveImages(doc: Doc, storage: StorageClient): Promise<PreparedDoc> {
  const failed: FileFailure[] = [];
  const next = await mapImages(doc, async (image) => {
    if (isInline(image.src)) return image;
    try {
      return { ...image, src: await storage.resolve(image.src) };
    } catch (error) {
      failed.push({ blockId: image.id, src: image.src, error: asError(error, image.src) });
      return image;
    }
  });
  return { doc: next, failed };
}

/** The type of an image from its first bytes, for storage that doesn't say. */
function sniff(bytes: Uint8Array): string | null {
  const at = (...codes: number[]) => codes.every((c, i) => bytes[i] === c);
  if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0x42, 0x4d)) return "image/bmp";
  if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Replaces each image's source with its bytes, as a `data:` URI, read through the storage client. Use it
 * before `toDocx`, which can only embed images it already has, or for a self-contained HTML file.
 * Images that can't be read (the adapter has no `read`, or the file is gone) are left as they are and
 * listed in `failed`; the exporters show a visible placeholder for those, never a blank.
 */
export async function embedImages(doc: Doc, storage: StorageClient): Promise<PreparedDoc> {
  const failed: FileFailure[] = [];
  const next = await mapImages(doc, async (image) => {
    if (isInline(image.src)) return image;
    try {
      const file = await storage.read(image.src);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = /^image\/[\w.+-]+$/.test(file.type) ? file.type : sniff(bytes);
      if (!type) throw new PliError("storage", `"${image.src}" doesn't look like an image.`);
      return { ...image, src: `data:${type};base64,${encodeBase64(bytes)}` };
    } catch (error) {
      failed.push({ blockId: image.id, src: image.src, error: asError(error, image.src) });
      return image;
    }
  });
  return { doc: next, failed };
}
