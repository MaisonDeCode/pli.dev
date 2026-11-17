/**
 * Pictures to PDF pages: `pdfFromImages` makes a new file with one page per picture. JPEG pictures are stored as they
 * are (no recompression), PNG pictures are decoded and stored losslessly (see `makeImageXObject`).
 */
import { PliError } from "@pli.dev/core";
import { ContentBuilder, ResourceNames } from "../cos/content";
import { PdfDict, PdfName, pdfText } from "../cos/objects";
import { setPages } from "../cos/pagetree";
import { createPdf } from "../cos/writer";
import { jpegInfo, makeImageXObject } from "../image";

export interface ImageInput {
  data: Uint8Array;
  /** `image/jpeg` or `image/png`. Found from the bytes when left out. */
  mime?: string;
}

export interface PdfFromImagesOptions {
  /**
   * `page` (default): every page is `pageSize` (Letter, turned the way the picture is when no size is given) and the
   * picture is scaled to fit it. `image`: every page is as big as its picture.
   */
  fit?: "page" | "image";
  /** The page size in points for `fit: "page"`. */
  pageSize?: { width: number; height: number };
  /** Empty space around the picture, in points. */
  margin?: number;
  /** Pixels per inch for `fit: "image"` when the picture does not say (72 by default). */
  dpi?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** Which kind of picture some bytes are, from their first bytes (and the `mime` hint when they say nothing). */
export function sniffImage(data: Uint8Array, mime?: string): "jpeg" | "png" {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data.length > 7 && PNG_SIGNATURE.every((v, i) => data[i] === v)) return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/png") return "png";
  throw new PliError("unsupported", `Only JPEG and PNG pictures can be turned into pages${mime ? ` (this one is ${mime})` : ""}.`);
}

/** The pixels per inch a picture says it has (JPEG JFIF density, PNG pHYs), or undefined. */
export function imageDpi(data: Uint8Array, kind: "jpeg" | "png"): number | undefined {
  const ok = (v: number) => (v >= 10 && v <= 5000 ? v : undefined);
  if (kind === "jpeg") {
    if (data.length > 20 && data[2] === 0xff && data[3] === 0xe0 && data[6] === 0x4a && data[7] === 0x46 && data[8] === 0x49 && data[9] === 0x46) {
      const units = data[13]!;
      const x = (data[14]! << 8) | data[15]!;
      if (units === 1) return ok(x);
      if (units === 2) return ok(x * 2.54);
    }
    return undefined;
  }
  let i = 8;
  while (i + 12 <= data.length) {
    const len = ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
    const type = String.fromCharCode(data[i + 4]!, data[i + 5]!, data[i + 6]!, data[i + 7]!);
    if (type === "pHYs" && len >= 9) {
      const x = ((data[i + 8]! << 24) | (data[i + 9]! << 16) | (data[i + 10]! << 8) | data[i + 11]!) >>> 0;
      return data[i + 16] === 1 ? ok(x * 0.0254) : undefined;
    }
    if (type === "IDAT" || type === "IEND") return undefined;
    i += 12 + len;
  }
  return undefined;
}

/** The orientation (1 to 8) from a JPEG's Exif block, or 1. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === 0xda || marker === 0xd9) return 1;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif") {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[t + o]! | (b[t + o + 1]! << 8) : (b[t + o]! << 8) | b[t + o + 1]!);
      const u32 = (o: number) => (le ? (b[t + o]! | (b[t + o + 1]! << 8) | (b[t + o + 2]! << 16) | (b[t + o + 3]! << 24)) >>> 0 : ((b[t + o]! << 24) | (b[t + o + 1]! << 16) | (b[t + o + 2]! << 8) | b[t + o + 3]!) >>> 0);
      if (t + 8 > b.length) return 1;
      const ifd = u32(4);
      if (t + ifd + 2 > b.length) return 1;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (t + e + 12 > b.length) break;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/**
 * Makes a PDF with one page for each picture. JPEG and PNG only. A JPEG that says it was taken turned (Exif
 * orientation 3, 6 or 8) is shown upright.
 */
export async function pdfFromImages(images: readonly ImageInput[], options: PdfFromImagesOptions = {}): Promise<Uint8Array> {
  if (images.length === 0) throw new PliError("invalid_operation", "There are no pictures to make pages from.");
  const o = createPdf();
  const margin = Math.max(0, options.margin ?? 0);
  const fit = options.fit ?? "page";
  const pages = images.map((img) => {
    const kind = sniffImage(img.data, img.mime);
    const x = makeImageXObject(o, kind === "jpeg" ? { jpeg: img.data } : { png: img.data });
    const turn = kind === "jpeg" ? jpegOrientation(img.data) : 1;
    const swap = turn === 6 || turn === 8 || turn === 5 || turn === 7;
    // The picture as shown: width and height after turning.
    const pw = swap ? x.height : x.width;
    const ph = swap ? x.width : x.height;
    let pageW: number;
    let pageH: number;
    let w: number;
    let h: number;
    if (fit === "image") {
      const dpi = imageDpi(img.data, kind) ?? options.dpi ?? 72;
      w = (pw * 72) / dpi;
      h = (ph * 72) / dpi;
      pageW = w + 2 * margin;
      pageH = h + 2 * margin;
    } else {
      const size = options.pageSize ?? (pw > ph ? { width: 792, height: 612 } : { width: 612, height: 792 });
      pageW = size.width;
      pageH = size.height;
      const availW = Math.max(1, pageW - 2 * margin);
      const availH = Math.max(1, pageH - 2 * margin);
      const scale = Math.min(availW / pw, availH / ph);
      w = pw * scale;
      h = ph * scale;
    }
    const left = (pageW - w) / 2;
    const bottom = (pageH - h) / 2;
    const res = new ResourceNames(new PdfDict());
    const name = res.xobject(x.ref);
    const c = new ContentBuilder().save();
    // The unit square of the picture is mapped into the box (left, bottom, w, h), turned as the Exif orientation says.
    if (turn === 3) c.transform(-w, 0, 0, -h, left + w, bottom + h);
    else if (turn === 6) c.transform(0, -h, w, 0, left, bottom + h);
    else if (turn === 8) c.transform(0, h, -w, 0, left + w, bottom);
    else c.transform(w, 0, 0, h, left, bottom);
    c.doXObject(name).restore();
    const content = o.add(c.toStream());
    return o.add(new PdfDict({ Type: PdfName.of("Page"), MediaBox: [0, 0, round(pageW), round(pageH)], Resources: res.dict, Contents: content }));
  });
  setPages(o, pages);
  o.editInfo().set("Producer", pdfText("Pli.PDF"));
  return o.rewrite({ compress: true });
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
