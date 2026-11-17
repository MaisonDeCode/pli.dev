/**
 * Pictures given as web addresses. The writers draw only `data:` pictures, so a save first fetches the others (the
 * annotation tools' `storage` option makes them) and writes from a COPY of the document with the addresses replaced: the
 * session's document is never touched.
 */
import type { Annotation, PageEdit, PdfDoc, PdfPicture } from "./model";
import type { FetchedPicture, SaveOptions } from "./save";
import { base64Encode } from "./annots/util";

const isData = (src: string): boolean => /^data:/i.test(src);

/** What a picture's bytes are, by their first bytes. */
export function sniffPicture(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}

/** The pictures of an annotation. */
function annotPictures(a: Annotation): PdfPicture[] {
  if (a.type === "image") return [a.picture];
  if (a.type === "signature") return a.picture ? [a.picture] : [];
  if (a.type === "stamp" && "picture" in a.stamp) return [a.stamp.picture];
  return [];
}

function editPicture(e: PageEdit): PdfPicture | null {
  return e.type === "image" ? e.picture : null;
}

/** Every address (not `data:`) a document's pictures use, once each. */
export function pictureAddresses(doc: PdfDoc): string[] {
  const out = new Set<string>();
  for (const p of doc.pages) {
    for (const a of p.annots) for (const pic of annotPictures(a)) if (pic.src && !isData(pic.src)) out.add(pic.src);
    for (const e of p.edits ?? []) {
      const pic = editPicture(e);
      if (pic && pic.src && !isData(pic.src)) out.add(pic.src);
    }
  }
  return [...out];
}

/** The fetch used when `SaveOptions.fetch` is not given: `globalThis.fetch`, or null when there is none. */
export function defaultFetch(): ((url: string) => Promise<FetchedPicture>) | null {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== "function") return null;
  return async (url) => {
    const res = await f.call(globalThis, url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? undefined };
  };
}

function swap(pic: PdfPicture, uris: ReadonlyMap<string, string>): PdfPicture {
  const uri = uris.get(pic.src);
  return uri ? { ...pic, src: uri } : pic;
}

function swapAnnot(a: Annotation, uris: ReadonlyMap<string, string>): Annotation {
  if (a.type === "image") {
    const picture = swap(a.picture, uris);
    return picture === a.picture ? a : { ...a, picture };
  }
  if (a.type === "signature" && a.picture) {
    const picture = swap(a.picture, uris);
    return picture === a.picture ? a : { ...a, picture };
  }
  if (a.type === "stamp" && "picture" in a.stamp) {
    const picture = swap(a.stamp.picture, uris);
    return picture === a.stamp.picture ? a : { ...a, stamp: { picture } };
  }
  return a;
}

function swapDoc(doc: PdfDoc, uris: ReadonlyMap<string, string>): PdfDoc {
  let changed = false;
  const pages = doc.pages.map((p) => {
    const annots = p.annots.map((a) => swapAnnot(a, uris));
    const edits = p.edits?.map((e) => {
      if (e.type !== "image" || !e.picture) return e;
      const picture = swap(e.picture, uris);
      return picture === e.picture ? e : { ...e, picture };
    });
    const same = annots.every((a, i) => a === p.annots[i]) && (!edits || edits.every((e, i) => e === p.edits![i]));
    if (same) return p;
    changed = true;
    return { ...p, annots, ...(edits ? { edits } : {}) };
  });
  return changed ? { ...doc, pages } : doc;
}

/**
 * Fetches the pictures that are web addresses and returns copies of the document and its baseline with them as `data:`
 * addresses. A picture that cannot be fetched (or is not PNG or JPEG) stays as it is (an annotation draws a placeholder box, a
 * picture replacement keeps the old picture), and a warning names its address.
 */
export async function resolvePictures(doc: PdfDoc, baseline: PdfDoc, options: SaveOptions): Promise<{ doc: PdfDoc; baseline: PdfDoc; warnings: string[] }> {
  const urls = pictureAddresses(doc);
  const warnings: string[] = [];
  if (urls.length === 0) return { doc, baseline, warnings };
  const fetcher = options.fetch ?? defaultFetch();
  const uris = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      if (!fetcher) {
        warnings.push(`The picture ${url} was not fetched (no fetch function is available), so it is not embedded.`);
        return;
      }
      try {
        const got = await fetcher(url);
        const mime = sniffPicture(got.bytes);
        if (!mime) throw new Error("it is not a PNG or JPEG picture");
        uris.set(url, `data:${mime};base64,${base64Encode(got.bytes)}`);
      } catch (error) {
        warnings.push(`The picture ${url} could not be fetched (${(error as Error).message}), so it is not embedded.`);
      }
    }),
  );
  if (uris.size === 0) return { doc, baseline, warnings };
  return { doc: swapDoc(doc, uris), baseline: baseline === doc ? swapDoc(doc, uris) : swapDoc(baseline, uris), warnings };
}
