import type { Source } from "./model";

/**
 * Where the bytes of the PDF files a document uses are kept. Operations carry only a `Source` (name, size, hash);
 * the bytes stay out of the JSON, so changes stay small and can be sent to other people. A client that sees a source
 * it does not have fetches it with `get`, which a host app backs with its file storage (see `storeSources`).
 */
export interface SourceStore {
  /** The bytes of a source, or undefined if this store does not have them. */
  get(source: Source): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  /** Keeps the bytes of a source (a PDF just opened, or one merged in). May return where they went. */
  put(source: Source, bytes: Uint8Array): void | Promise<void> | Promise<{ location?: string }>;
}

/** A store that keeps everything in memory. The default. */
export function memorySourceStore(initial: Record<string, Uint8Array> = {}): SourceStore & { has(id: string): boolean; ids(): string[] } {
  const files = new Map<string, Uint8Array>(Object.entries(initial));
  return {
    get: (source) => files.get(source.id),
    put: (source, bytes) => void files.set(source.id, bytes),
    has: (id) => files.has(id),
    ids: () => [...files.keys()],
  };
}

/** A fingerprint of some bytes (FNV-1a, 64 bits as two halves, with the length), so equal files have equal fingerprints. */
export function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i]!, 0x01000193) >>> 0;
    b = Math.imul(b ^ (bytes[i]! + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}.${bytes.length.toString(36)}`;
}
