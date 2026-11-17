import type { FontEnv, FontFaceSpec } from "./types";

// The browser's font loading, described only as far as it is used (this package is built without the DOM types).
interface FontFaceLike {
  load(): Promise<unknown>;
}
interface FontFaceSetLike {
  add(face: FontFaceLike): void;
  load(font: string, text?: string): Promise<unknown>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}
interface CanvasLike {
  getContext(type: "2d"): { font: string; measureText(text: string): { width: number } } | null;
}
interface DocumentLike {
  fonts?: FontFaceSetLike;
  createElement(tag: "canvas"): CanvasLike;
}

const FORMAT = { woff2: "woff2", woff: "woff", truetype: "truetype" } as const;

/**
 * The page's own font loading: `FontFace` and `document.fonts`. Without them (Node, a worker, a test renderer) it
 * loads nothing and says every family is installed, so documents lay out with their fallbacks and nothing waits.
 */
export function browserFontEnv(): FontEnv {
  const g = globalThis as unknown as { document?: DocumentLike; FontFace?: new (family: string, source: string, descriptors?: Record<string, string>) => FontFaceLike };
  const doc = g.document;
  const set = doc?.fonts;
  const Face = g.FontFace;
  const canLoad = !!set && typeof Face === "function";
  const registered = new Set<string>();
  const installed = new Map<string, boolean>();
  let canvas: ReturnType<CanvasLike["getContext"]> | undefined;

  const width = (font: string): number | undefined => {
    if (canvas === undefined) {
      try {
        canvas = doc?.createElement("canvas").getContext("2d") ?? null;
      } catch {
        canvas = null;
      }
    }
    if (!canvas) return undefined;
    canvas.font = font;
    return canvas.measureText("mmmmmmmmmmlliWW 0123456789 ÀÉ").width;
  };

  return {
    canLoad,
    register(spec: FontFaceSpec) {
      if (!canLoad) return;
      const key = `${spec.family}|${spec.weight}|${spec.style}|${spec.url}`;
      if (registered.has(key)) return;
      registered.add(key);
      const descriptors: Record<string, string> = { weight: String(spec.weight), style: spec.style, display: "swap" };
      if (spec.unicodeRange) descriptors.unicodeRange = spec.unicodeRange;
      const face = new Face!(spec.family, `url("${spec.url.replace(/"/g, "%22")}") format("${FORMAT[spec.format]}")`, descriptors);
      // Only registered: the browser downloads a file when text needs its characters. A face that fails is skipped, and the next font in the stack draws.
      set!.add(face);
    },
    async load(font, text) {
      if (!canLoad) return false;
      try {
        await set!.load(font, text);
        return true;
      } catch {
        return false;
      }
    },
    isInstalled(family) {
      if (!canLoad) return true;
      const cached = installed.get(family);
      if (cached !== undefined) return cached;
      const name = `"${family.replace(/"/g, "")}"`;
      const bases = ["monospace", "serif", "sans-serif"];
      let result: boolean | undefined;
      for (const base of bases) {
        const own = width(`72px ${name}, ${base}`);
        const plain = width(`72px ${base}`);
        if (own === undefined || plain === undefined) return true; // can't tell: assume it is, and download nothing
        if (Math.abs(own - plain) > 0.01) result = true;
      }
      installed.set(family, (result ??= false));
      return result;
    },
    subscribe(listener) {
      if (!set?.addEventListener) return () => undefined;
      set.addEventListener("loadingdone", listener);
      return () => set.removeEventListener?.("loadingdone", listener);
    },
  };
}

/** An environment that loads nothing: for hosts that don't want fonts fetched, and for server-side code. */
export const noFontEnv: FontEnv = {
  canLoad: false,
  register: () => undefined,
  load: async () => false,
  isInstalled: () => true,
};
