import { MAX_IMAGE_BYTES, sniffImage, toDataUri } from "@pli.dev/sheets";

const MB = MAX_IMAGE_BYTES / 1024 / 1024;

/** A name for a picture to describe it, from its file's name: `team-photo_2024.png` is `team photo 2024`. */
const describe = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

/** Draws a picture on a canvas of the given scale and gives the bytes of a PNG or JPEG of it. */
async function reencode(file: Blob, scale: number, as: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That picture can't be read here");
  // A JPEG has no transparency, so what was transparent becomes white rather than black.
  if (as === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as, 0.88));
  if (!blob) throw new Error("That picture can't be read here");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Reads a picture file for a sheet. PNG, JPEG and GIF are kept as they are; other kinds the browser can draw (WebP, BMP,
 * SVG…) are turned into PNG; and one that is too heavy is scaled down until it fits.
 */
export async function imageFromFile(file: File): Promise<{ src: string; alt: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const known = sniffImage(bytes);
  const alt = describe(file.name);
  if (known && bytes.length <= MAX_IMAGE_BYTES) return { src: toDataUri(bytes, known.type), alt };
  if (typeof createImageBitmap !== "function") throw new Error(known ? `A picture can weigh at most ${MB} MB` : "Only PNG, JPEG and GIF pictures can be added here");
  try {
    // Another kind becomes a PNG; a heavy one is scaled down (and, when it is a photo, saved as a JPEG) until it is light enough.
    let scale = 1;
    let as: "image/png" | "image/jpeg" = known?.type === "png" || !known ? "image/png" : "image/jpeg";
    for (let attempt = 0; attempt < 8; attempt++) {
      const out = await reencode(file, scale, as);
      const type = sniffImage(out)?.type;
      if (type && out.length <= MAX_IMAGE_BYTES) return { src: toDataUri(out, type), alt };
      scale *= 0.7;
      as = "image/jpeg";
    }
  } catch (e) {
    if (e instanceof Error && /can't be read/.test(e.message)) throw e;
    throw new Error("That file isn't a picture this browser can read");
  }
  throw new Error(`That picture is too big to keep (${MB} MB at most)`);
}
