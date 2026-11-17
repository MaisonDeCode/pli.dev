import { useEffect, useState } from "react";
import { MAX_ARTISTIC_SIDE, applyArtistic, artisticPng, readImage, scaleDown, toDataUri, type ImageArtistic } from "@pli.dev/sheets";

/*
 * A picture with an artistic effect is drawn from a copy with the effect applied (the same pixel code that writes the effect
 * to an .xlsx file, so the sheet, a print and a file all agree). The copy is made when the picture first shows, a moment after,
 * and kept by picture and effect so that drawing the grid again doesn't make it again.
 */

const done = new Map<string, string | null>();
const key = (src: string, a: ImageArtistic) => `${a.kind}:${a.level ?? ""}:${src.length}:${src.slice(32, 112)}:${src.slice(-64)}`;

/** Loads a picture the browser can draw and reads its pixels, scaled down to the longest side a copy is worked at. */
function pixelsOf(src: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, MAX_ARTISTIC_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ width: d.width, height: d.height, data: d.data });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The picture with the effect applied, as a `data:` URI of a PNG; null when it can't be made here. */
export async function artisticSrc(src: string, artistic: ImageArtistic): Promise<string | null> {
  const k = key(src, artistic);
  if (done.has(k)) return done.get(k)!;
  let out: string | null = null;
  try {
    // A PNG, JPEG or GIF is read and drawn by the engine's own code, with no canvas, so it looks as it does in an .xlsx file; a picture that code can't read goes through the browser's canvas.
    const bytes = artisticPng(readImage(src).bytes, artistic);
    out = bytes ? toDataUri(bytes, "png") : null;
    if (!out) {
      const pixels = await pixelsOf(src);
      if (pixels && typeof document !== "undefined") {
        const result = applyArtistic(scaleDown(pixels), artistic);
        const canvas = document.createElement("canvas");
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const image = ctx.createImageData(result.width, result.height);
          image.data.set(result.data);
          ctx.putImageData(image, 0, 0);
          out = canvas.toDataURL("image/png");
        }
      }
    }
  } catch {
    out = null;
  }
  if (done.size > 24) done.clear();
  done.set(k, out);
  return out;
}

/** What to show for a picture: its own `src` until the copy with the effect is ready (a moment), then the copy. */
export function useArtisticSrc(src: string, artistic: ImageArtistic | undefined): string {
  const k = artistic ? key(src, artistic) : "";
  const [ready, setReady] = useState<{ key: string; src: string } | null>(() => (k && done.get(k) ? { key: k, src: done.get(k)! } : null));
  useEffect(() => {
    if (!artistic) return;
    const hit = done.get(k);
    if (hit) {
      setReady({ key: k, src: hit });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void artisticSrc(src, artistic).then((out) => live && out && setReady({ key: k, src: out }));
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return artistic && ready?.key === k ? ready.src : src;
}
