import { describe, expect, it } from "vitest";
import { openPdf, PdfFile } from "../src";
import { buildClassic, obj, simpleDoc } from "./support/handmade";

const sample = () => buildClassic([...simpleDoc(3), obj(20, "<< /Title (Three pages) /Author (Test Author) >>")], { info: 20 }).bytes;

describe("openPdf and save", () => {
  it("reads pages, sizes and information into the model", async () => {
    const s = await openPdf(sample(), { name: "three.pdf" });
    expect(s.doc.pages.map((p) => [p.id, p.width, p.height, p.rotate])).toEqual([
      ["p:main:0", 612, 792, 0],
      ["p:main:1", 612, 792, 0],
      ["p:main:2", 612, 792, 0],
    ]);
    expect(s.doc.sources[0]).toMatchObject({ id: "main", name: "three.pdf", pages: 3 });
    expect(s.dirty).toBe(false);
  });

  it("gives the same document and ids to everyone who opens the same bytes", async () => {
    const bytes = sample();
    expect((await openPdf(bytes)).doc).toEqual((await openPdf(bytes)).doc);
  });

  it("saves an untouched file as the original bytes", async () => {
    const bytes = sample();
    const s = await openPdf(bytes);
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.bytes).toEqual(bytes);
  });

  it("appends a metadata change to the original and keeps its bytes", async () => {
    const bytes = sample();
    const s = await openPdf(bytes);
    s.core.transact([{ type: "set_meta", patch: { title: "Renamed" } }]);
    const out = await s.save();
    expect(out.length).toBeGreaterThan(bytes.length);
    expect(out.subarray(0, bytes.length)).toEqual(bytes);
    const file = PdfFile.open(out);
    expect(file.pageCount()).toBe(3);
    const reopened = await openPdf(out);
    expect(reopened.doc.meta.title).toBe("Renamed");
    expect(reopened.doc.meta.author).toBe("Test Author");
  });
});
