import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { PdfFile } from "../src/cos/file";
import { extractText } from "../src/text";
import { makePdf } from "./support/content";

const SEED = "BT /F1 12 Tf 20 150 Td (Hello \\(World\\)) Tj 0 -20 Td [(Wo) 120 (rld) -600 (again)] TJ T* 3 Tc (more) ' ET q 2 0 0 2 0 0 cm 10 10 50 50 re f 0 0 m 30 30 l S Q BI /W 2 /H 2 /BPC 8 /CS /G ID abcd\nEI /Fm1 Do";

/** A tiny deterministic generator. */
function random(seed: number): () => number {
  let x = seed;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("broken content", () => {
  it("never throws when reading, whatever the stream says", () => {
    const rnd = random(7);
    for (let i = 0; i < 300; i++) {
      let s = SEED;
      for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) {
        const at = Math.floor(rnd() * s.length);
        const op = rnd();
        if (op < 0.4) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rnd() * 4));
        else if (op < 0.8) s = s.slice(0, at) + String.fromCharCode(32 + Math.floor(rnd() * 95)) + s.slice(at);
        else s = s.slice(0, at) + ["(", ")", "[", "]", "<<", ">>", "q", "Q", "BT", "ET", "Tf", "-1e9", "99999999999"][Math.floor(rnd() * 13)] + " " + s.slice(at);
      }
      const bytes = makePdf({ content: s });
      expect(() => extractText(PdfFile.open(bytes), 0), s).not.toThrow();
    }
  });

  it("redacts and edits broken streams without throwing", async () => {
    const rnd = random(11);
    for (let i = 0; i < 60; i++) {
      let s = SEED;
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
        const at = Math.floor(rnd() * s.length);
        s = rnd() < 0.5 ? s.slice(0, at) + s.slice(at + 1 + Math.floor(rnd() * 3)) : s.slice(0, at) + ["(", ")", "[", "q", "Q", "BT", "ET", "Tf"][Math.floor(rnd() * 8)] + " " + s.slice(at);
      }
      const s1 = await openPdf(makePdf({ content: s }));
      const page = s1.doc.pages[0]!.id;
      s1.content.markRedaction(page, [{ x: 0, y: 0, w: 120, h: 60 }]);
      s1.content.applyRedactions();
      const runs = await s1.content.runs(page);
      if (runs[0]?.editable) await s1.content.replaceText(runs[0].id, "changed");
      await expect(s1.save(), s).resolves.toBeInstanceOf(Uint8Array);
    }
  });
});
