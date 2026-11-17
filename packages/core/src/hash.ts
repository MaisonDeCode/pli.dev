/**
 * Fingerprints of editor state, shared by every editor's `SyncModel.hash`. Two states that are equal as JSON
 * have the same fingerprint, whatever order their object keys were written in.
 */

/** JSON with every object's keys in order and `undefined` left out, so two equal values have the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short fingerprint of a piece of text: FNV-1a with the text's length, so `a.b` differs from `b.a`. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}.${text.length.toString(36)}`;
}

/** A short fingerprint of any JSON state (FNV-1a over its canonical JSON). Equal states have equal fingerprints. */
export function hashState(state: unknown): string {
  return hashText(canonicalJson(state));
}
