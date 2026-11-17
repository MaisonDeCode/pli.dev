/** Test helper: asks MuPDF (through python, when `PLI_PDF_PYTHON` is set) which words it finds. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageWord } from "../../src/content/text";

export const python = process.env.PLI_PDF_PYTHON;
const script = new URL("../../scripts/pdftext.py", import.meta.url).pathname;

export interface MuWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function mupdfWords(bytes: Uint8Array): { pages: { rotation: number; text: string; words: MuWord[]; images: number }[] } {
  const dir = mkdtempSync(join(tmpdir(), "pli-pdf-"));
  const path = join(dir, "file.pdf");
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync(python!, ["-I", script, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

/**
 * Compares MuPDF's words with ours: every MuPDF word must be one of ours with the same text, the same centre (within
 * `tolerance` along the line and 15% of the height across it: MuPDF's boxes are taller than ours) and the same length.
 */
export function compareWords(mine: PageWord[], theirs: MuWord[], tolerance = 3): string[] {
  const problems: string[] = [];
  for (const w of theirs) {
    const text = w.text.normalize("NFKC");
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    const hit = mine.find((m) => {
      if (m.text.normalize("NFKC") !== text) return false;
      const mx = m.box.x + m.box.w / 2;
      const my = m.box.y + m.box.h / 2;
      const vertical = Math.abs(Math.sin((m.angle * Math.PI) / 180)) > 0.7;
      const long = vertical ? m.box.h : m.box.w;
      const theirLong = vertical ? w.y1 - w.y0 : w.x1 - w.x0;
      const alongTol = tolerance;
      const acrossTol = Math.max(tolerance, 0.15 * Math.min(w.x1 - w.x0, w.y1 - w.y0, 1000) + 0.15 * (vertical ? m.box.w : m.box.h));
      return Math.abs(mx - cx) <= (vertical ? acrossTol : alongTol) && Math.abs(my - cy) <= (vertical ? alongTol : acrossTol) && Math.abs(long - theirLong) <= tolerance * 2;
    });
    if (!hit) problems.push(`MuPDF word "${w.text}" at ${w.x0.toFixed(1)},${w.y0.toFixed(1)}-${w.x1.toFixed(1)},${w.y1.toFixed(1)} not found (ours: ${mine.filter((m) => m.text === text).map((m) => `${m.box.x.toFixed(1)},${m.box.y.toFixed(1)}-${(m.box.x + m.box.w).toFixed(1)},${(m.box.y + m.box.h).toFixed(1)}`).join(" | ") || "none"})`);
  }
  return problems;
}
