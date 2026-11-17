/** Test helpers for the annotation tests: a one page file to annotate, and colour checks on rendered pixels. */
import { expect } from "vitest";
import { openPdf, type PdfSession } from "../../src";
import { buildClassic, simpleDoc } from "./handmade";
import { makePng } from "./png";
import { base64Encode } from "../../src/annots/util";
import type { Rendered } from "./render";
import type { Annotation } from "../../src";

/** The annotation type(s) with this `type`. */
export type AnnotOf<T extends string> = Annotation extends infer A ? (A extends { type: infer U } ? (T extends U ? A : never) : never) : never;

/** A 300 by 400 page with a line of text near the top. */
export function blankPdf(opts: { mediaBox?: string; pageExtra?: string; text?: string } = {}): Uint8Array {
  return buildClassic(simpleDoc(1, { mediaBox: opts.mediaBox ?? "[0 0 300 400]", pageExtra: () => opts.pageExtra ?? "", text: () => opts.text ?? "BT /F1 14 Tf 20 360 Td (Hello annotated world) Tj ET" })).bytes;
}

export async function newSession(bytes: Uint8Array = blankPdf()): Promise<PdfSession> {
  return openPdf(bytes, { name: "t.pdf", user: { id: "u1", name: "Test User" }, now: () => Date.UTC(2026, 10, 16, 12, 0, 0) });
}

/** A PNG data URI of a solid colour, `size` pixels square. */
export function solidPng(rgb: [number, number, number], size = 4, alpha = 255): string {
  const png = makePng({ width: size, height: size, colorType: 6, depth: 8, sample: () => [rgb[0], rgb[1], rgb[2], alpha] });
  return `data:image/png;base64,${base64Encode(png)}`;
}

type RGB = [number, number, number];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Expects the rendered pixel at page point (x, y from the top left) to be about this colour. */
export function expectPixel(r: Rendered, x: number, y: number, rgb: RGB, tol = 40): void {
  const p = r.pixel(x, y);
  const ok = near(p[0], rgb[0], tol) && near(p[1], rgb[1], tol) && near(p[2], rgb[2], tol);
  expect(ok, `pixel (${x}, ${y}) is rgb(${p[0]}, ${p[1]}, ${p[2]}), expected about rgb(${rgb.join(", ")})`).toBe(true);
}

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const WHITE: RGB = [255, 255, 255];
