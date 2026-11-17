/** Hand-made documents for the page tests. Page text is a code word, so a page can be found in a saved file. */
import { buildClassic, obj, simpleDoc, type Obj } from "./handmade";

export const WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];

const textOf = (words: string[]) => (i: number) => `BT /F1 12 Tf 20 100 Td (${words[i]}) Tj ET`;

/** A plain document, one word on each page. */
export function wordsDoc(words: string[], opts: { mediaBox?: string } = {}): Uint8Array {
  return buildClassic(simpleDoc(words.length, { text: textOf(words), mediaBox: opts.mediaBox })).bytes;
}

/**
 * Five pages (Alpha..Echo) with links (to Charlie, to Echo, to the web), a bookmark tree (Part One > Sub of One, Part Two
 * in red and bold, Part Three closed > Echo section), named destinations `first` and `target` (Echo), an open action
 * that goes to Echo, and information.
 */
export function fiveDoc(): Uint8Array {
  const base = simpleDoc(5, {
    text: textOf(WORDS),
    pageExtra: (i) => (i === 0 ? "/Annots [20 0 R]" : i === 1 ? "/Annots [21 0 R 22 0 R]" : ""),
  });
  const objs: Obj[] = [
    obj(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 30 0 R /Names << /Dests 40 0 R >> /OpenAction [7 0 R /Fit] /PageMode /UseOutlines >>"),
    ...base.slice(1),
    obj(20, "<< /Type /Annot /Subtype /Link /Rect [10 10 100 40] /Border [0 0 0] /Dest [5 0 R /XYZ 0 700 null] >>"),
    obj(21, "<< /Type /Annot /Subtype /Link /Rect [10 50 100 80] /Border [0 0 0] /Dest [7 0 R /Fit] >>"),
    obj(22, "<< /Type /Annot /Subtype /Link /Rect [10 90 100 120] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>"),
    obj(30, "<< /Type /Outlines /First 31 0 R /Last 33 0 R /Count 4 >>"),
    obj(31, "<< /Title (Part One) /Parent 30 0 R /Next 32 0 R /First 34 0 R /Last 34 0 R /Count 1 /Dest [3 0 R /XYZ null 742 null] >>"),
    obj(32, "<< /Title (Part Two) /Parent 30 0 R /Prev 31 0 R /Next 33 0 R /A << /S /GoTo /D [5 0 R /XYZ 0 500 null] >> /C [1 0 0] /F 2 >>"),
    obj(33, "<< /Title (Part Three) /Parent 30 0 R /Prev 32 0 R /First 35 0 R /Last 35 0 R /Count -1 /Dest (target) >>"),
    obj(34, "<< /Title (Sub of One) /Parent 31 0 R /Dest [4 0 R /Fit] >>"),
    obj(35, "<< /Title (Echo section) /Parent 33 0 R /Dest [7 0 R /Fit] >>"),
    obj(40, "<< /Names [(first) [3 0 R /Fit] (target) [7 0 R /Fit]] >>"),
    obj(50, "<< /Title (Five pages) /Author (Test Author) >>"),
  ];
  return buildClassic(objs, { info: 50 }).bytes;
}

/** One page with a highlight that has a comment, a web link and a square. */
export function notedDoc(): Uint8Array {
  const base = simpleDoc(1, { text: () => "BT /F1 12 Tf 20 100 Td (Noted) Tj ET", pageExtra: () => "/Annots [20 0 R 21 0 R 22 0 R]" });
  return buildClassic([
    ...base,
    obj(20, "<< /Type /Annot /Subtype /Highlight /Rect [72 690 120 710] /QuadPoints [72 710 120 710 72 690 120 690] /C [1 1 0] /Contents (check this) /T (Reviewer) /F 4 >>"),
    obj(21, "<< /Type /Annot /Subtype /Link /Rect [10 10 100 40] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>"),
    obj(22, "<< /Type /Annot /Subtype /Square /Rect [10 100 60 150] /C [1 0 0] /BS << /W 2 >> /F 4 >>"),
  ]).bytes;
}
