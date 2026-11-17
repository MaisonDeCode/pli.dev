import { CF_Y_ONLY, CF_YUV_444, JxrError, SRC_RGB } from "./jxr-common";
import { encodeCodestream, rgbToPlanes, type PlanesInput } from "./jxr-encode";
import { decodeCodestream } from "./jxr-decode";
import type { Rgba } from "./png";

/*
 * JPEG XR pictures (`.wdp` / `.jxr`, "HD Photo"): the file around the codestream (a small TIFF-like table that says what the
 * pixels are and where the coded picture is), and the two ways in and out: Rgba pixels to a file, and a file to Rgba pixels.
 *
 * Excel keeps the unprocessed original of a picture with an artistic effect in a file like this.
 */

/** The content type of a `.wdp` file, the relationship type Office gives it, and its extension. */
export const WDP_CONTENT_TYPE = "image/vnd.ms-photo";
export const WDP_RELATIONSHIP = "http://schemas.microsoft.com/office/2007/relationships/hdphoto";

/** The pixel format ids (the same last byte means the same in every id). */
const FORMAT_BASE = [0x24, 0xc3, 0xdd, 0x6f, 0x03, 0x4e, 0xfe, 0x4b, 0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9];
const BGR24 = 0x0c;
const RGBA32 = [0x2d, 0xad, 0xc7, 0xf5, 0x8d, 0x6a, 0xdd, 0x43, 0xa7, 0xa8, 0xa2, 0x99, 0x35, 0x26, 0x1a, 0xe9];

const TAG = { pixelFormat: 0xbc01, transform: 0xbc02, width: 0xbc80, height: 0xbc81, xRes: 0xbc82, yRes: 0xbc83, imageOffset: 0xbcc0, imageBytes: 0xbcc1, alphaOffset: 0xbcc2, alphaBytes: 0xbcc3 };

/** Whether these bytes begin like a JPEG XR file ("II", 0xBC, version 1). */
export function isJxr(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0xbc && b[3] === 0x01;
}

/** Settings of the writer for the forms of file the format allows beyond the usual one (see `PlanesInput`); the usual one is what reads best. */
export type JxrOptions = Pick<PlanesInput, "overlap" | "frequency" | "tileWidths" | "tileHeights" | "subband" | "trimFlexBits"> & {
  /** Code the alpha in the same codestream as the colour, instead of as a second picture in the file. */
  interleavedAlpha?: boolean;
};

/** The Rgba pixels as a `.wdp` file: nothing lost. A picture with any transparency gets its alpha as a second coded plane. */
export function encodeJxr(pic: Rgba, options: JxrOptions = {}): Uint8Array {
  const { width, height, data } = pic;
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      alpha = true;
      break;
    }
  }
  const { interleavedAlpha, ...coding } = options;
  const alphaPlane = (): Int32Array => {
    const a = new Int32Array(width * height);
    for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3]! - 128;
    return a;
  };
  const color = encodeCodestream({
    width,
    height,
    cf: CF_YUV_444,
    srcCf: SRC_RGB,
    planes: rgbToPlanes(data, width, height, 4, "rgb"),
    ...(alpha && interleavedAlpha ? { alpha: alphaPlane() } : {}),
    ...coding,
  });
  // (the alpha picture of its own is coded without overlap, as the reference writes it)
  const alphaStream = alpha && !interleavedAlpha ? encodeCodestream({ width, height, cf: CF_Y_ONLY, srcCf: 0, planes: [alphaPlane()], ...coding, overlap: 0 }) : undefined;
  const entries: [number, number, number, Uint8Array | number][] = [
    [TAG.pixelFormat, 1, 16, 0],
    [TAG.transform, 4, 1, 0],
    [TAG.width, 4, 1, width],
    [TAG.height, 4, 1, height],
    [TAG.xRes, 11, 1, 0x42c00000],
    [TAG.yRes, 11, 1, 0x42c00000],
    [TAG.imageOffset, 4, 1, 0],
    [TAG.imageBytes, 4, 1, color.length],
  ];
  if (alphaStream) entries.push([TAG.alphaOffset, 4, 1, 0], [TAG.alphaBytes, 4, 1, alphaStream.length]);
  const ifdAt = 32;
  const dataAt = ifdAt + 2 + 12 * entries.length + 4;
  const out = new Uint8Array(dataAt + color.length + (alphaStream?.length ?? 0));
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 0xbc, 0x01]);
  dv.setUint32(4, ifdAt, true);
  out.set(alpha ? RGBA32.slice() : [...FORMAT_BASE, BGR24], 8);
  dv.setUint16(ifdAt, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifdAt + 2 + 12 * i;
    dv.setUint16(at, tag, true);
    dv.setUint16(at + 2, type, true);
    dv.setUint32(at + 4, count, true);
    let v = value as number;
    if (tag === TAG.pixelFormat) v = 8; // the id sits at offset 8
    else if (tag === TAG.imageOffset) v = dataAt;
    else if (tag === TAG.alphaOffset) v = dataAt + color.length;
    dv.setUint32(at + 8, v, true);
  });
  out.set(color, dataAt);
  if (alphaStream) out.set(alphaStream, dataAt + color.length);
  return out;
}

/** The parts of a JPEG XR file: what the pixels are (the id of the pixel format), the size, and the coded colour and alpha pictures. */
export interface JxrParts {
  format: Uint8Array;
  width: number;
  height: number;
  image: Uint8Array;
  alpha?: Uint8Array;
}

/** Reads the table of a JPEG XR file. */
export function readJxrParts(b: Uint8Array): JxrParts {
  if (!isJxr(b)) throw new JxrError("Not a JPEG XR file");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ifd = dv.getUint32(4, true);
  if (ifd + 2 > b.length) throw new JxrError("The table of the file is outside the file");
  const count = dv.getUint16(ifd, true);
  const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + 12 * i;
    if (at + 12 > b.length) throw new JxrError("The table of the file is cut short");
    tags.set(dv.getUint16(at, true), { type: dv.getUint16(at + 2, true), count: dv.getUint32(at + 4, true), value: dv.getUint32(at + 8, true), at: at + 8 });
  }
  const num = (tag: number): number | undefined => {
    const t = tags.get(tag);
    return t ? (t.type === 3 ? dv.getUint16(t.at, true) : t.value) : undefined;
  };
  const fmt = tags.get(TAG.pixelFormat);
  const formatAt = fmt ? (fmt.count > 4 ? fmt.value : fmt.at) : 8;
  const offset = num(TAG.imageOffset);
  const bytes = num(TAG.imageBytes);
  // (some writers put the end of the picture, not its length, in the byte counts: both are read as far as the file goes)
  if (offset === undefined || bytes === undefined || offset >= b.length) throw new JxrError("The picture is outside the file");
  const out: JxrParts = {
    format: b.slice(formatAt, formatAt + 16),
    width: num(TAG.width) ?? 0,
    height: num(TAG.height) ?? 0,
    image: b.subarray(offset, Math.min(b.length, offset + bytes)),
  };
  const aOffset = num(TAG.alphaOffset);
  const aBytes = num(TAG.alphaBytes);
  if (aOffset !== undefined && aBytes !== undefined && aOffset < b.length && aBytes > 0) out.alpha = b.subarray(aOffset, Math.min(b.length, aOffset + aBytes));
  return out;
}

const PREMULTIPLIED = [
  [0x24, 0xc3, 0xdd, 0x6f, 0x03, 0x4e, 0xfe, 0x4b, 0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x10], // 32 bits, blue first
  [0x50, 0xa6, 0xc4, 0x3c, 0x27, 0xa5, 0x37, 0x4d, 0xa9, 0x16, 0x31, 0x42, 0xc7, 0xeb, 0xed, 0xba], // 32 bits, red first
  [0x24, 0xc3, 0xdd, 0x6f, 0x03, 0x4e, 0xfe, 0x4b, 0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x17], // 64 bits
];
const isPremultiplied = (format: Uint8Array): boolean => PREMULTIPLIED.some((id) => id.every((v, i) => format[i] === v));

/** The pixels of a JPEG XR file, or null when it is damaged or in a form this does not read (see `decodeCodestream`). */
export function decodeJxr(bytes: Uint8Array): Rgba | null {
  try {
    const c = readJxrParts(bytes);
    const color = decodeCodestream(c.image);
    const w = color.width;
    const h = color.height;
    const out = new Uint8ClampedArray(w * h * 4);
    const planes = color.channels;
    let alpha: Uint8Array | undefined;
    if (c.alpha) {
      const a = decodeCodestream(c.alpha);
      if (a.width === w && a.height === h && a.channels === 1) alpha = a.data;
    }
    const premultiplied = isPremultiplied(c.format);
    for (let i = 0; i < w * h; i++) {
      if (planes === 1) {
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = color.data[i]!;
      } else {
        out[i * 4] = color.data[i * planes]!;
        out[i * 4 + 1] = color.data[i * planes + 1]!;
        out[i * 4 + 2] = color.data[i * planes + 2]!;
      }
      out[i * 4 + 3] = alpha ? alpha[i]! : planes === 4 ? color.data[i * planes + 3]! : 255;
      // (colours that were multiplied by the alpha are divided by it again)
      const a = out[i * 4 + 3]!;
      if (premultiplied && a > 0 && a < 255) for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round((out[i * 4 + k]! * 255) / a);
    }
    return { width: w, height: h, data: out };
  } catch (e) {
    if (e instanceof JxrError || e instanceof RangeError) return null;
    throw e;
  }
}
