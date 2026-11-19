import { createContext, useContext, type ReactNode } from "react";
import { downloadFile } from "../print";

/** A file an editor made for someone to keep: DOCX, PDF, XLSX, PPTX, CSV, JSON and so on. */
export interface DownloadFile {
  /** The file name, with its extension. */
  name: string;
  /** The MIME type, such as `application/pdf`. */
  type: string;
  data: Uint8Array;
}

/** What a download function can call. */
export interface DownloadHelpers {
  /**
   * What happens when there is no download function: the browser saves the file. Call it from yours for the files you don't want
   * to handle, or when the app is running on the web: `(file, { browserDownload }) => native ? share(file) : browserDownload()`.
   */
  browserDownload(): void;
}

/**
 * Takes over File > Download (and everything else that makes a file for someone to keep). Save the file in your own storage,
 * send it to a server, or show the phone's share sheet. Return a promise and the editor waits for it. If it throws or rejects, the
 * editor tells the person the file couldn't be saved, with your error's message.
 */
export type DownloadHandler = (file: DownloadFile, helpers: DownloadHelpers) => void | Promise<void>;

/** The function every editor below a {@link DownloadProvider} uses unless it is given its own. */
export const DownloadContext = createContext<DownloadHandler | undefined>(undefined);

/**
 * Sets how files are saved for every editor inside it (Documents, Sheets, Decks and PDF), so an app with several editors says it
 * once. An editor's own `onDownload` wins over this one. Without either, the browser downloads the file.
 *
 * ```tsx
 * <DownloadProvider onDownload={(file, { browserDownload }) => (Capacitor.isNativePlatform() ? saveAndShare(file) : browserDownload())}>
 *   <PliDocument session={doc} />
 *   <PliSheet session={sheet} />
 * </DownloadProvider>
 * ```
 */
export function DownloadProvider({ onDownload, children }: { onDownload: DownloadHandler | undefined; children: ReactNode }) {
  return <DownloadContext.Provider value={onDownload}>{children}</DownloadContext.Provider>;
}

/** The function to save files with: the editor's own `onDownload` if it has one, otherwise the nearest {@link DownloadProvider}'s. */
export function useDownloadHandler(own?: DownloadHandler): DownloadHandler | undefined {
  const inherited = useContext(DownloadContext);
  return own ?? inherited;
}

/** Bytes for whatever an export gave: text becomes UTF-8, and a buffer or typed array is viewed as bytes. */
export function bytesOf(data: BlobPart): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

/**
 * Gives a made file to `handler`, or to the browser to download when there is none. Resolves when the handler has finished, and
 * rejects with its error, so the editor can say the file couldn't be saved. A handler that throws before its first `await` is
 * treated the same as one that rejects.
 */
export async function handOver(handler: DownloadHandler | undefined, name: string, data: BlobPart, type: string): Promise<void> {
  if (!handler) return downloadFile(name, data, type);
  const bytes = bytesOf(data);
  await handler({ name, type, data: bytes }, { browserDownload: () => downloadFile(name, bytes as BlobPart, type) });
}

/** The words for a file that couldn't be saved, with the reason the handler gave. */
export function saveFailure(cause: unknown): string {
  return `The file couldn't be saved${cause instanceof Error && cause.message ? `: ${cause.message}` : ""}`;
}
