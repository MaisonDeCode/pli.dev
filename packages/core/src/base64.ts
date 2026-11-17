// Base64 without btoa, atob, Buffer or FileReader, so it runs in JavaScriptCore and QuickJS too.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    parts.push(
      ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + (b === undefined ? "=" : ALPHABET[(n >> 6) & 63]!) + (c === undefined ? "=" : ALPHABET[n & 63]!),
    );
  }
  return parts.join("");
}

/** Decodes base64, ignoring whitespace. Returns null if it isn't valid. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  const body = clean.replace(/=+$/, "");
  if (clean.length - body.length > 2 || (clean.length % 4 !== 0 && clean.length !== body.length)) return null;
  if (body.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const char of body) {
    const value = LOOKUP.get(char);
    if (value === undefined) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
}
