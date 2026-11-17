/**
 * A page of a file as the interpreter needs it: its boxes, the resources, and its content streams joined and parsed.
 * Works on a `PdfFile` or an `Overlay` (anything that can `get` and `decode`).
 */
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfRef, PdfStream, isArray, isDict, isNum, isStream } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { inheritedPageAttr } from "../cos/pagetree";
import { parseContentStream, type ContentOp } from "../cos/parser";
import { decodeStream } from "../cos/filters";
import type { ContentSource } from "./fontinfo";
import type { Matrix } from "./interpreter";

export interface PageGeom {
  ref: PdfRef | null;
  dict: PdfDict;
  /** The visible box in PDF space: crop box inside the media box. */
  box: [number, number, number, number];
  rotate: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  /** User space to page space (y down, origin at the box's top left). */
  base: Matrix;
  resources: PdfDict;
  contents: PdfStream[];
}

/** A `ContentSource` over anything with `get` (a file or an overlay). */
export function sourceOf(reader: { get(o: PdfObj | undefined): PdfObj }, decode?: (s: PdfStream) => Uint8Array): ContentSource {
  return {
    get: (o) => reader.get(o),
    decode: decode ?? ((s) => decodeStream(s, (o) => reader.get(o))),
  };
}

function box(src: ContentSource, o: PdfObj | undefined): [number, number, number, number] | null {
  const a = src.get(o);
  if (!isArray(a) || a.length < 4) return null;
  const v = a.slice(0, 4).map((x) => src.get(x));
  if (!v.every((x): x is number => isNum(x) && Number.isFinite(x))) return null;
  return [Math.min(v[0]!, v[2]!), Math.min(v[1]!, v[3]!), Math.max(v[0]!, v[2]!), Math.max(v[1]!, v[3]!)];
}

export function pageGeometry(src: ContentSource, dict: PdfDict, ref: PdfRef | null): PageGeom {
  const get = (key: string) => inheritedPageAttr(src, dict, key);
  let media = box(src, get("MediaBox"));
  if (!media || media[2] - media[0] <= 0 || media[3] - media[1] <= 0) media = [0, 0, 612, 792];
  let crop = box(src, get("CropBox"));
  if (crop) {
    crop = [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])];
    if (crop[2] - crop[0] <= 0 || crop[3] - crop[1] <= 0) crop = null;
  }
  const b = crop ?? media;
  const r = src.get(get("Rotate"));
  const rotate = (isNum(r) ? (((Math.round(r / 90) * 90) % 360) + 360) % 360 : 0) as 0 | 90 | 180 | 270;
  const res = src.get(get("Resources"));
  const c = src.get(dict.get("Contents"));
  const contents: PdfStream[] = [];
  if (isStream(c)) contents.push(c);
  else if (isArray(c)) for (const e of c) {
    const s = src.get(e);
    if (isStream(s)) contents.push(s);
  }
  return {
    ref,
    dict,
    box: b,
    rotate,
    width: b[2] - b[0],
    height: b[3] - b[1],
    base: [1, 0, 0, -1, -b[0], b[3]],
    resources: isDict(res) ? res : new PdfDict(),
    contents,
  };
}

/** The page's content streams joined with a newline between them (tokens never span streams), then parsed. */
export function pageOps(src: ContentSource, geom: PageGeom, strict = false): ContentOp[] {
  const parts: Uint8Array[] = [];
  for (const s of geom.contents) {
    try {
      parts.push(src.decode(s));
    } catch (e) {
      // Reading goes on without it; rewriting must not (the page would lose what the stream drew).
      if (strict) throw new PliError("unsupported", `the page's content could not be decoded (${e instanceof Error ? e.message : "unknown error"}), so it cannot be redacted or edited safely`);
    }
  }
  let total = 0;
  for (const p of parts) total += p.length + 1;
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
    bytes[o++] = 0x0a;
  }
  return parseContentStream(bytes);
}
