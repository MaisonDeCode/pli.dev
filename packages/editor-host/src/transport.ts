/** What the editor tells the app around it. Every message is a JSON object with a `type`. */
export type HostMessage =
  | { type: "ready" }
  /** The document changed: the whole document, as the JSON `PliDocument(json:)` opens. Sent a moment after the last edit. */
  | { type: "change"; json: string }
  /** File > Download made a file. `base64` is its content. */
  | { type: "download"; name: string; mime: string; base64: string }
  /** The answer to a `call` from the app: `value` (a string) or `error`. */
  | { type: "response"; id: number; ok: true; value: string }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "error"; message: string };

interface WebKitWindow {
  webkit?: { messageHandlers?: { pli?: { postMessage(message: unknown): void } } };
  /** Android: a JavaScript interface added to the web view under this name. */
  PliAndroid?: { postMessage(message: string): void };
}

/** Sends a message to the app: through WKWebView on Apple platforms, the Android interface on Android, or to the parent page in a browser (for trying the page on its own). */
export function post(message: HostMessage): void {
  const w = window as unknown as WebKitWindow;
  if (w.webkit?.messageHandlers?.pli) w.webkit.messageHandlers.pli.postMessage(message);
  else if (w.PliAndroid) w.PliAndroid.postMessage(JSON.stringify(message));
  else if (window.parent !== window) window.parent.postMessage({ pli: message }, "*");
  else console.debug("[pli]", message);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
