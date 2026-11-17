import { decodeGif } from "./gif";
import { decodeJpeg } from "./jpeg";
import { decodePng, type Rgba } from "./png";

/** The pixels of a PNG, JPEG or GIF (found by what the bytes begin with), or null when they are none of those or can't be read here. */
export function decodeImage(bytes: Uint8Array): Rgba | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return decodeGif(bytes);
  return null;
}
