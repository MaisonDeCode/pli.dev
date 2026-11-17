/**
 * What the engine's code expects of the language that JavaScriptCore and QuickJS don't have: `TextEncoder` and `TextDecoder` (UTF-8
 * only, which is all the engines use them for). A web view or Node has them already and keeps its own. Every bridge imports this
 * first, so it runs before any engine code does.
 */
import { utf8Bytes, utf8Text } from "./utf8";

const g = globalThis as Record<string, unknown>;

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class TextEncoder {
    readonly encoding = "utf-8";
    encode(text = ""): Uint8Array {
      return utf8Bytes(String(text));
    }
  };
}

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class TextDecoder {
    constructor(readonly encoding = "utf-8") {}
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input === undefined) return "";
      const bytes = input instanceof Uint8Array ? input : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      const text = utf8Text(bytes);
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }
  };
}
