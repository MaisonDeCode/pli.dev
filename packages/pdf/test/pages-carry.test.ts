// What goes along with pages: annotations, comment threads and form fields, when pages are merged, copied and extracted.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergePdfs, openPdf, type Annotation } from "../src";
import { notedDoc as noted, WORDS, wordsDoc } from "./support/pagesdocs";
import { fileContains, seen } from "./support/pdfinfo";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const kinds = (list: readonly Annotation[]) => list.map((a) => a.type).sort();

describe("annotations travel with their pages", () => {
  it("merge: the annotations and their comment are in the merged file, once", async () => {
    const out = await mergePdfs([wordsDoc(["Aa"]), noted()]);
    const again = await openPdf(out);
    expect(again.doc.pages.length).toBe(2);
    expect(kinds(again.doc.pages[1]!.annots)).toEqual(["highlight", "link", "square"]);
    expect(again.doc.pages[0]!.annots).toEqual([]);
    const highlight = again.doc.pages[1]!.annots.find((a) => a.type === "highlight")!;
    expect(highlight).toMatchObject({ contents: "check this", authorName: "Reviewer" });
    expect(Object.values(again.doc.comments ?? {}).map((t) => t.comments[0]?.body)).toEqual(["check this"]);
  });

  it("merge twice and duplicate: each copy has its own annotations", async () => {
    const bytes = noted();
    const s = await openPdf(wordsDoc(["Aa"]));
    await s.pages.insertFrom(bytes);
    await s.pages.insertFrom(bytes);
    const [dup] = s.pages.duplicate([s.doc.pages[1]!.id]);
    const out = await s.save();
    const again = await openPdf(out);
    expect(again.doc.pages.map((p) => p.annots.length)).toEqual([0, 3, 3, 3]);
    const all = again.doc.pages.flatMap((p) => p.annots.map((a) => a.id));
    expect(new Set(all).size).toBe(9);
    expect(dup).toBeTruthy();
    expect((await seen(out)).pages.length).toBe(4);
  });

  it("an annotation edited on a merged page is saved once", async () => {
    const s = await openPdf(wordsDoc(["Aa"]));
    const [page] = await s.pages.insertFrom(noted());
    const id = s.doc.pages.find((p) => p.id === page)!.annots.find((a) => a.type === "square")!.id;
    s.annots.update(id, { opacity: 0.5 });
    const again = await openPdf(await s.save());
    expect(again.doc.pages[1]!.annots.filter((a) => a.type === "square")).toHaveLength(1);
  });

  it("the original's annotations stay when pages are reordered or others are deleted", async () => {
    const s = await openPdf(noted());
    await s.pages.insertFrom(wordsDoc(["Aa"]), { at: 0 });
    s.pages.remove([s.doc.pages[0]!.id]);
    const again = await openPdf(await s.save());
    expect(kinds(again.doc.pages[0]!.annots)).toEqual(["highlight", "link", "square"]);
  });

  it("extract keeps the annotations of the pages it takes", async () => {
    const s = await openPdf(noted());
    await s.pages.insertFrom(wordsDoc(["Aa"]));
    const out = await s.pages.extract([s.doc.pages[0]!.id]);
    const again = await openPdf(out);
    expect(again.doc.pages.length).toBe(1);
    expect(kinds(again.doc.pages[0]!.annots)).toEqual(["highlight", "link", "square"]);
  });
});

describe("form fields travel with their pages", () => {
  it("merge: fields of the other file are in the merged file", async () => {
    const form = fixture("forms-basic.pdf");
    const formDoc = await openPdf(form);
    const names = formDoc.doc.fields.map((f) => f.name);
    expect(names.length).toBeGreaterThan(0);
    const out = await mergePdfs([wordsDoc(WORDS.slice(0, 1)), form]);
    const again = await openPdf(out);
    expect(again.doc.fields.map((f) => f.name).sort()).toEqual([...names].sort());
    const pageIds = new Set(again.doc.pages.map((p) => p.id));
    for (const f of again.doc.fields) for (const w of f.widgets) expect(pageIds.has(w.page)).toBe(true);
    // The widgets are on the page that came from the form, not the first.
    expect(again.doc.fields[0]!.widgets[0]!.page).toBe(again.doc.pages[1]!.id);
  });

  it("merging a form twice gives the second one other names", async () => {
    const form = fixture("forms-basic.pdf");
    const s = await openPdf(form);
    const names = s.doc.fields.map((f) => f.name);
    await s.pages.insertFrom(form);
    expect(s.doc.fields.length).toBe(names.length * 2);
    expect(new Set(s.doc.fields.map((f) => f.name)).size).toBe(names.length * 2);
    const again = await openPdf(await s.save());
    expect(again.doc.fields.length).toBe(names.length * 2);
  });

  it("duplicating a page copies its fields under other names, and the copy can be filled in separately", async () => {
    const form = fixture("forms-basic.pdf");
    const s = await openPdf(form);
    const before = s.doc;
    const names = s.doc.fields.map((f) => f.name);
    const [copy] = s.pages.duplicate([s.doc.pages[0]!.id]);
    expect(s.doc.fields.length).toBe(names.length * 2);
    expect(s.doc.fields.slice(names.length).every((f) => f.widgets.every((w) => w.page === copy))).toBe(true);
    const out = await s.save();
    const again = await openPdf(out);
    expect(again.doc.pages.length).toBe(2);
    expect(again.doc.fields.length).toBe(names.length * 2);
    expect(new Set(again.doc.fields.map((f) => f.name)).size).toBe(names.length * 2);
    s.undo();
    expect(s.doc).toEqual(before);
  });

  it("extracting the other pages leaves the fields behind", async () => {
    const form = fixture("forms-basic.pdf");
    const s = await openPdf(wordsDoc(["Aa"]));
    await s.pages.insertFrom(form);
    const fieldName = s.doc.fields[0]!.name;
    const out = await s.pages.extract([s.doc.pages[0]!.id]);
    const again = await openPdf(out);
    expect(again.doc.fields).toEqual([]);
    expect(fileContains(out, fieldName)).toBe(false);
    // And extracting the form page keeps its fields.
    const formPage = await s.pages.extract([s.doc.pages[1]!.id]);
    expect((await openPdf(formPage)).doc.fields.map((f) => f.name)).toEqual(s.doc.fields.map((f) => f.name));
  });
});
