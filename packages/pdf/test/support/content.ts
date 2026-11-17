/** Test helper: one-page PDFs made BY HAND (no writer), for the content engine tests. */
import { buildClassic, obj, streamObj, type Obj } from "./handmade";

export const STD_FONTS: Record<string, string> = {
  F1: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  F2: "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
  F3: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  F4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
};

export interface PdfSpec {
  /** One content stream per entry. */
  content: string | string[];
  fonts?: Record<string, string>;
  /** Extra objects (numbers 20 and up). */
  objs?: Obj[];
  mediaBox?: string;
  cropBox?: string;
  rotate?: number;
  /** Extra entries of the page dictionary. */
  pageExtra?: string;
  /** Extra entries of the resources (`/XObject << ... >>`). */
  resources?: string;
  flate?: boolean;
  /** Further pages: their content (same resources). */
  more?: string[];
  /** Extra entries of the catalog (`/AcroForm ...`). */
  catalog?: string;
  /** Extra entries of the further pages' dictionaries. */
  moreExtra?: string;
  /** Replaces the font resource entries' object numbers (default: 40...). */
}

/** Object numbers: 1 catalog, 2 pages, 3 page (4.. further pages), 10.. contents, 40.. fonts. */
export function makePdf(spec: PdfSpec): Uint8Array {
  const contents = Array.isArray(spec.content) ? spec.content : [spec.content];
  const fonts = spec.fonts ?? STD_FONTS;
  const fontNums = Object.keys(fonts).map((k, i) => [k, 40 + i] as const);
  const objs: Obj[] = [obj(1, `<< /Type /Catalog /Pages 2 0 R ${spec.catalog ?? ""} >>`)];
  const extraPages = spec.more ?? [];
  const pageNums = [3, ...extraPages.map((_, i) => 4 + i)];
  objs.push(obj(2, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`));
  const res = `/Resources << /Font << ${fontNums.map(([k, n]) => `/${k} ${n} 0 R`).join(" ")} >> ${spec.resources ?? ""} >>`;
  const box = `/MediaBox ${spec.mediaBox ?? "[0 0 300 200]"}${spec.cropBox ? ` /CropBox ${spec.cropBox}` : ""}${spec.rotate ? ` /Rotate ${spec.rotate}` : ""}`;
  const cref = contents.map((_, i) => `${10 + i} 0 R`).join(" ");
  objs.push(obj(3, `<< /Type /Page /Parent 2 0 R ${box} ${res} /Contents ${contents.length > 1 ? `[${cref}]` : cref} ${spec.pageExtra ?? ""} >>`));
  extraPages.forEach((_, i) => objs.push(obj(4 + i, `<< /Type /Page /Parent 2 0 R ${box} ${res} /Contents ${30 + i} 0 R ${spec.moreExtra ?? ""} >>`)));
  contents.forEach((c, i) => objs.push(streamObj(10 + i, "", c, spec.flate)));
  extraPages.forEach((c, i) => objs.push(streamObj(30 + i, "", c, spec.flate)));
  for (const [k, n] of fontNums) objs.push(obj(n, fonts[k]!));
  for (const o of spec.objs ?? []) objs.push(o);
  return buildClassic(objs).bytes;
}
