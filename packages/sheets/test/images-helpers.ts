import { zlibSync } from "fflate";
import { toDataUri } from "../src";

let table: number[] | undefined;
const crc32 = (bytes: Uint8Array): number => {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: Uint8Array): number[] => {
  const body = new Uint8Array([...[...type].map((c) => c.charCodeAt(0)), ...data]);
  return [...be32(data.length), ...body, ...be32(crc32(body))];
};

/** A real PNG, `width` by `height`, filled with one colour. */
export function png(width: number, height: number, [r, g, b] = [200, 40, 40]): Uint8Array {
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", new Uint8Array([...be32(width), ...be32(height), 8, 2, 0, 0, 0])),
    ...chunk("IDAT", zlibSync(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

export const pngUri = (width: number, height: number, color?: number[]) => toDataUri(png(width, height, color as [number, number, number]), "png");

/** A 1 by 1 JPEG and a 1 by 1 GIF, as data URIs. */
export const JPEG_1X1 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
export const GIF_1X1 = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
