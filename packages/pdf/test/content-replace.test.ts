import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { PdfFile } from "../src/cos/file";
import { extractText } from "../src/text";
import { makePdf } from "./support/content";

// Two runs hold "cat", one holds "concatenate" (a match inside a word), and "ca" + "t" are two pieces of text on one line.
const BODY = "BT /F1 12 Tf 20 170 Td (The cat sat on the cat) Tj 0 -20 Td (Concatenate it) Tj 0 -20 Td (ca) Tj 40 0 Td (t) Tj ET";

describe("replaceAll", () => {
  it("replaces matches inside runs, as one undo step, and reports what it left alone", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    const dry = await s.content.replaceAll("cat", "dog", { dryRun: true });
    expect(dry.replaced).toBe(3);
    expect(s.dirty).toBe(false);
    const r = await s.content.replaceAll("cat", "dog");
    expect(r.replaced).toBe(3);
    expect(r.runs).toBe(2);
    expect(r.skipped).toEqual({ spanning: 0, notEditable: 0 });
    const out = await s.save();
    expect(extractText(PdfFile.open(out), 0).text).toContain("The dog sat on the dog");
    expect(extractText(PdfFile.open(out), 0).text).toContain("Condogenate it");
    // one undo step takes every replacement back
    expect(s.undo()).toBe(true);
    expect(s.doc.pages[0]!.edits ?? []).toHaveLength(0);
  });

  it("honours match case and whole words", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    expect((await s.content.replaceAll("CAT", "dog", { caseSensitive: true, dryRun: true })).replaced).toBe(0);
    expect((await s.content.replaceAll("cat", "dog", { wholeWord: true, dryRun: true })).replaced).toBe(2);
  });

  it("counts a match that runs across two pieces of text and leaves it alone", async () => {
    const s = await openPdf(makePdf({ content: "BT /F1 12 Tf 20 170 Td (The sat) Tj 80 0 Td (on it) Tj ET" }));
    const r = await s.content.replaceAll("sat on", "dog");
    expect(r.replaced).toBe(0);
    expect(r.skipped.spanning).toBe(1);
    expect(s.doc.pages[0]!.edits ?? []).toHaveLength(0);
  });

  it("works on top of an earlier edit of the run and keeps its style", async () => {
    const s = await openPdf(makePdf({ content: "BT /F1 12 Tf 20 170 Td (one cat) Tj ET" }));
    const run = (await s.content.runs(s.doc.pages[0]!.id))[0]!;
    await s.content.replaceText(run.id, "two cat", { size: 20 });
    const r = await s.content.replaceAll("cat", "dog");
    expect(r.replaced).toBe(1);
    const edit = s.doc.pages[0]!.edits!.find((e) => e.type === "text")!;
    expect(edit).toMatchObject({ text: "two dog", size: 20, oldText: "one cat" });
    expect(s.doc.pages[0]!.edits!.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("replaces only the match under a point with `at`, and takes a literal replacement", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    const hits = await s.content.search("cat", { wholeWord: true });
    const last = hits[1]!.rects[0]!;
    const r = await s.content.replaceAll("cat", "$& $1", { wholeWord: true, at: { page: 0, x: last.x + last.w / 2, y: last.y + last.h / 2 } });
    expect(r.replaced).toBe(1);
    const out = await s.save();
    expect(extractText(PdfFile.open(out), 0).text).toContain("The cat sat on the $& $1");
  });

  it("replaces matches one at a time in the same run, in any order, on top of what was replaced before", async () => {
    const s = await openPdf(makePdf({ content: "BT /F1 12 Tf 20 170 Td (a cat, a cat and a cat) Tj ET" }));
    const hits = await s.content.search("cat");
    const at = (i: number) => ({ page: 0, x: hits[i]!.rects[0]!.x + hits[i]!.rects[0]!.w / 2, y: hits[i]!.rects[0]!.y + hits[i]!.rects[0]!.h / 2 });
    const text = () => s.doc.pages[0]!.edits!.find((e) => e.type === "text")!.text;
    expect((await s.content.replaceAll("cat", "dog", { at: at(2) })).replaced).toBe(1);
    expect(text()).toBe("a cat, a cat and a dog");
    expect((await s.content.replaceAll("cat", "bird", { at: at(0) })).replaced).toBe(1);
    expect(text()).toBe("a bird, a cat and a dog");
    // a longer and a shorter replacement shift the text: the match under the point is still the one found
    expect((await s.content.replaceAll("cat", "x", { at: at(1) })).replaced).toBe(1);
    expect(text()).toBe("a bird, a x and a dog");
    // one that is replaced already is left alone
    const again = await s.content.replaceAll("cat", "nothing", { at: at(1) });
    expect(again.replaced).toBe(0);
    expect(text()).toBe("a bird, a x and a dog");
  });

  it("does nothing for an empty query", async () => {
    const s = await openPdf(makePdf({ content: BODY }));
    expect((await s.content.replaceAll("", "x")).replaced).toBe(0);
  });
});
