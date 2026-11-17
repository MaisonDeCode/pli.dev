import { describe, expect, it } from "vitest";
import { makeSamplePdf, openPdf } from "../src";
import { renderPdf } from "./support/render";

describe("makeSamplePdf", () => {
  it("makes a two page file with a form, links and bookmarks that opens and renders", async () => {
    const bytes = await makeSamplePdf();
    const s = await openPdf(bytes);
    expect(s.doc.pages).toHaveLength(2);
    expect(s.doc.meta.title).toBe("Pli.PDF sample");
    expect(s.doc.fields.map((f) => f.name).sort()).toEqual(["colour", "name", "signature", "subscribe"]);
    expect(s.forms.byName("colour")!.value).toBe("Green");
    const links = s.doc.pages.flatMap((p) => p.annots.filter((a) => a.type === "link"));
    expect(links).toHaveLength(3);
    expect(links.filter((a) => a.type === "link" && a.uri).map((a) => (a.type === "link" ? a.uri : ""))).toEqual(["https://example.com/"]);
    expect(s.doc.outline.map((o) => o.title)).toEqual(["Pli.PDF sample", "Sample form", "Page two"]);
    const r = await renderPdf(bytes, 0, 1);
    expect(r.text).toContain("Pli.PDF sample");
    expect(r.text).toContain("Sample form");
    expect(r.inkIn(150, 246, 240, 22)).toBeGreaterThan(20); // the field's border
    expect((await renderPdf(bytes, 1, 1)).text).toContain("quick brown fox");
  });
});
