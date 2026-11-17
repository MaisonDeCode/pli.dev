import { image, type ImageBlock } from "@pli.dev/docs";

export interface ImageOptions {
  /** Cap the inserted width, in CSS pixels. Usually the width of the page's text area. */
  maxWidth?: number;
  /**
   * Images with a longer side than this are scaled down before being stored, so a phone photo
   * doesn't put megabytes in the document. Default 1600.
   */
  maxDimension?: number;
  alt?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be loaded."));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

/** Scales an image down on a canvas, keeping PNG for transparency and JPEG otherwise. */
function downscale(img: HTMLImageElement, max: number, type: string): string | null {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= max) return null;
  const ratio = max / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type === "image/png" ? "image/png" : "image/jpeg", 0.88);
}

/** The size an image gets when it must fit in `maxWidth`, keeping its proportions. */
export function fitImage(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: Math.round(maxWidth), height: Math.round((height * maxWidth) / width) };
}

/** Reads an image file into an image block, embedded as a data URI. */
export async function imageBlockFromFile(file: File, options: ImageOptions = {}): Promise<ImageBlock> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  // GIFs would lose their animation on a canvas, so they are stored as they are.
  const src = file.type === "image/gif" ? original : (downscale(img, options.maxDimension ?? 1600, file.type) ?? original);
  const size = fitImage(img.naturalWidth, img.naturalHeight, options.maxWidth ?? 600);
  return image(src, size, { alt: options.alt ?? file.name.replace(/\.[^.]+$/, "") });
}

/** An image block for a URL. The image is loaded once to learn its size. */
export async function imageBlockFromUrl(url: string, options: ImageOptions = {}): Promise<ImageBlock> {
  const img = await loadImage(url);
  const size = fitImage(img.naturalWidth || 300, img.naturalHeight || 200, options.maxWidth ?? 600);
  return image(url, size, { alt: options.alt });
}

/** An image file ready to upload, with an address to show it at while that happens. */
export interface PreparedImage {
  /** The bytes to upload: the file itself, or a scaled-down copy of a large one. */
  blob: Blob;
  /** A `blob:` address of those bytes. Revoke it with `URL.revokeObjectURL` when the document no longer needs it. */
  previewUrl: string;
  size: { width: number; height: number };
  alt: string;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be scaled."))), type, 0.88));
}

/**
 * Reads an image file for uploading. Like `imageBlockFromFile`, a large image is scaled down first and a
 * GIF is left alone, but the result is a file to send to storage, not a data URI.
 */
export async function prepareImageFile(file: File, options: ImageOptions = {}): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const original = URL.createObjectURL(file);
  try {
    const img = await loadImage(original);
    const size = fitImage(img.naturalWidth, img.naturalHeight, options.maxWidth ?? 600);
    const alt = options.alt ?? file.name.replace(/\.[^.]+$/, "");
    const max = options.maxDimension ?? 1600;
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (file.type === "image/gif" || longest <= max) return { blob: file, previewUrl: original, size, alt };

    const ratio = max / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, file.type === "image/png" ? "image/png" : "image/jpeg");
    URL.revokeObjectURL(original);
    return { blob, previewUrl: URL.createObjectURL(blob), size, alt };
  } catch (error) {
    URL.revokeObjectURL(original);
    throw error;
  }
}
