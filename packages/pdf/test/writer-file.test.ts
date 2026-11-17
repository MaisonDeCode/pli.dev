import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfName, PdfRef, PdfStream, PdfString, bytesToLatin1, isDict, isName, pdfText, textOf } from "../src/cos";
import type { PdfObj } from "../src/cos";
import { Overlay, addStandardFont, createPdf, setPages, pageRefs } from "../src/write";
import { finishPage, newPage } from "./support/build";
import { renderPdf } from "./support/render";

const N = PdfName.of;

/** A small document: two pages of text, a red square on page 1, an info dictionary. */
function sample(): Uint8Array {
  const t = newPage(200, 200);
  const f = t.res.font(addStandardFont(t.overlay, "Helvetica"));
  t.content.save().fillColor("#ff0000").rect(10, 170, 30, 20).fill().restore();
  t.content.beginText().font(f, 14).textMove(10, 100).showText("First page").endText();
  finishPage(t);
  const o = t.overlay;
  const res = o.add(new PdfDict({ Font: new PdfDict({ F1: addStandardFont(o, "Helvetica") }) }));
  const c2 = o.add(new PdfStream(new PdfDict(), new TextEncoder().encode("BT /F1 14 Tf 10 100 Td (Second page) Tj ET")));
  const p2 = o.add(new PdfDict({ Type: N("Page"), MediaBox: [0, 0, 200, 200], Resources: res, Contents: c2 }));
  setPages(o, [...pageRefs(o), p2]);
  o.editInfo().set("Title", pdfText("Sample"));
  return o.rewrite();
}

const text = (b: Uint8Array) => bytesToLatin1(b);

describe("rewrite and reopen", () => {
  it("round-trips through the reader", async () => {
    const bytes = sample();
    const f = PdfFile.open(bytes);
    expect(f.pageCount()).toBe(2);
    expect(f.repaired).toBe(false);
    expect(f.version).toBe("1.7");
    expect(textOf(f.info()!.get("Title") as PdfString)).toBe("Sample");
    expect(f.trailer.get("ID")).toBeTruthy();
    const r = await renderPdf(bytes, 1);
    expect(r.text).toContain("Second page");
  });

  it("every option combination reopens with the same pages", async () => {
    const bytes = sample();
    for (const opts of [{}, { compress: true }, { xrefStream: true }, { objectStreams: true, compress: true }, { gc: false }]) {
      const out = new Overlay(PdfFile.open(bytes)).rewrite(opts);
      const f = PdfFile.open(out);
      expect(f.repaired, JSON.stringify(opts)).toBe(false);
      expect(f.pageCount()).toBe(2);
      expect(textOf(f.info()!.get("Title") as PdfString)).toBe("Sample");
      expect((await renderPdf(out, 0)).pixel(25, 20)).toEqual([255, 0, 0, 255]);
    }
  });

  it("collects garbage, renumbers densely and drops what it cannot reach", () => {
    const o = new Overlay(PdfFile.open(sample()));
    o.add(new PdfDict({ Orphan: 1 }));
    const before = o.objectNumbers().length;
    const out = new Overlay(PdfFile.open(o.rewrite()));
    const nums = out.objectNumbers();
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    expect(nums.length).toBeLessThan(before + 1);
    expect(text(o.rewrite())).not.toContain("/Orphan");
    expect(text(o.rewrite({ gc: false })).includes("/Orphan")).toBe(true);
  });

  it("drops dangling references", () => {
    const o = new Overlay(PdfFile.open(sample()));
    o.editCatalog().set("Dangling", new PdfRef(999));
    const f = PdfFile.open(o.rewrite());
    expect(f.catalog().get("Dangling")).toBeUndefined();
  });

  it("keeps the first ID element and writes a new second one", () => {
    const first = PdfFile.open(sample());
    const id1 = first.trailer.get("ID") as PdfString[];
    const second = PdfFile.open(new Overlay(first).rewrite());
    const id2 = second.trailer.get("ID") as PdfString[];
    expect(id2[0]!.bytes).toEqual(id1[0]!.bytes);
    expect(id2[1]!.bytes).not.toEqual(id1[1]!.bytes);
    const kept = PdfFile.open(new Overlay(first).rewrite({ id: false })).trailer.get("ID") as PdfString[];
    expect(kept[1]!.bytes).toEqual(id1[1]!.bytes);
  });
});

describe("incremental update", () => {
  it("keeps every original byte and adds the change", async () => {
    const base = sample();
    const o = new Overlay(PdfFile.open(base));
    o.editInfo().set("Title", pdfText("Changed"));
    const pageRef = pageRefs(o)[1]!;
    o.edit<PdfDict>(pageRef).set("Rotate", 90);
    const out = o.incremental();
    expect(out.length).toBeGreaterThan(base.length);
    expect(out.subarray(0, base.length)).toEqual(base);
    const f = PdfFile.open(out);
    expect(f.repaired).toBe(false);
    expect(textOf(f.info()!.get("Title") as PdfString)).toBe("Changed");
    expect(f.pages()[1]!.rotate).toBe(90);
    expect(f.pages()[0]!.rotate).toBe(0);
    expect(text(out.subarray(base.length))).toContain(`/Prev ${PdfFile.open(base).startxref}`);
    // the original second ID element is replaced, the first kept
    const id1 = PdfFile.open(base).trailer.get("ID") as PdfString[];
    const id2 = f.trailer.get("ID") as PdfString[];
    expect(id2[0]!.bytes).toEqual(id1[0]!.bytes);
    expect(id2[1]!.bytes).not.toEqual(id1[1]!.bytes);
    expect((await renderPdf(out, 1)).text).toContain("Second page");
  });

  it("returns the base bytes when nothing changed", () => {
    const base = sample();
    expect(new Overlay(PdfFile.open(base)).incremental()).toBe(PdfFile.open(base).bytes);
  });

  it("adds a newline when the base does not end with one, and survives a base without %%EOF newline", () => {
    const base = sample();
    let end = base.length;
    while (base[end - 1] === 0x0a) end--;
    const trimmed = base.subarray(0, end); // ends with %%EOF
    const o = new Overlay(PdfFile.open(trimmed));
    o.editInfo().set("Title", pdfText("T"));
    const out = o.incremental();
    expect(out.subarray(0, trimmed.length)).toEqual(trimmed);
    expect(out[trimmed.length]).toBe(0x0a);
    expect(textOf(PdfFile.open(out).info()!.get("Title") as PdfString)).toBe("T");
  });

  it("appends an xref stream when the base used one, and a table otherwise", () => {
    const stream = new Overlay(PdfFile.open(sample())).rewrite({ xrefStream: true, objectStreams: true, compress: true });
    const o = new Overlay(PdfFile.open(stream));
    o.editInfo().set("Title", pdfText("S"));
    o.edit<PdfDict>(pageRefs(o)[0]!).set("Rotate", 180); // this page lives in an object stream
    const out = o.incremental();
    const tail = text(out.subarray(stream.length));
    expect(tail).toContain("/Type /XRef");
    expect(tail).not.toContain("\nxref\n");
    const f = PdfFile.open(out);
    expect(f.repaired).toBe(false);
    expect(f.pages()[0]!.rotate).toBe(180);
    expect(textOf(f.info()!.get("Title") as PdfString)).toBe("S");
    // and again on top of that
    const o2 = new Overlay(f);
    o2.edit<PdfDict>(pageRefs(o2)[1]!).set("Rotate", 270);
    const out2 = o2.incremental();
    const g = PdfFile.open(out2);
    expect(g.repaired).toBe(false);
    expect([g.pages()[0]!.rotate, g.pages()[1]!.rotate]).toEqual([180, 270]);

    const base = sample();
    const table = new Overlay(PdfFile.open(base));
    table.editInfo().set("Title", pdfText("x"));
    const t = text(table.incremental().subarray(base.length));
    expect(t).toContain("xref\n");
    expect(t).not.toContain("/Type /XRef");
  });

  it("frees removed objects and writes new ones", () => {
    const o = new Overlay(PdfFile.open(sample()));
    const added = o.add(new PdfDict({ Hello: 1 }));
    const victim = o.editCatalog().get("Pages") as PdfRef;
    expect(o.has(victim)).toBe(true);
    const junk = o.add(pdfText("junk"));
    const first = o.incremental();
    const f = PdfFile.open(first);
    expect(f.has(added.num)).toBe(true);
    const o2 = new Overlay(f);
    o2.remove(junk);
    o2.remove(added);
    const second = PdfFile.open(o2.incremental());
    expect(second.has(junk.num)).toBe(false);
    expect(second.has(added.num)).toBe(false);
    expect(second.pageCount()).toBe(2);
    // numbers of freed objects are not reused by the next update
    expect(new Overlay(second).add(null).num).toBeGreaterThan(added.num);
  });

  it("a rewrite of an incrementally updated file keeps only the newest versions", () => {
    const base = sample();
    const o = new Overlay(PdfFile.open(base));
    o.editInfo().set("Title", pdfText("Newest"));
    const updated = o.incremental();
    const out = new Overlay(PdfFile.open(updated)).rewrite();
    const f = PdfFile.open(out);
    expect(textOf(f.info()!.get("Title") as PdfString)).toBe("Newest");
    expect(text(out)).not.toContain("(Sample)");
    expect(out.length).toBeLessThan(updated.length);
  });

  it("refuses an encrypted base that cannot encrypt its own changes", () => {
    const f = PdfFile.open(sample());
    const fake = {
      bytes: f.bytes,
      version: f.version,
      trailer: f.trailer,
      repaired: false,
      encrypted: true,
      startxref: f.startxref,
      size: f.size,
      has: (n: number) => f.has(n),
      get: (o: PdfObj | undefined) => f.get(o),
      getRef: (n: number, g?: number) => f.getRef(n, g),
      objectNumbers: () => f.objectNumbers(),
      generation: (n: number) => f.generation(n),
      catalog: () => f.catalog(),
      pageCount: () => f.pageCount(),
      pages: () => f.pages(),
    };
    const o = new Overlay(fake);
    o.editInfo().set("Title", pdfText("x"));
    expect(() => o.incremental()).toThrow(/encrypted/);
    // a rewrite still works and is not encrypted
    expect(PdfFile.open(o.rewrite()).encrypted).toBe(false);
  });
});

describe("page tree", () => {
  it("flattens a nested tree, keeps inherited attributes, reorders and drops pages", () => {
    const o = createPdf();
    const font = addStandardFont(o, "Helvetica");
    const mk = (i: number) => o.add(new PdfDict({ Type: N("Page"), Marker: i }));
    const [a, b, c] = [mk(1), mk(2), mk(3)] as PdfRef[];
    const mid = o.add(new PdfDict({ Type: N("Pages"), Kids: [a, b], Count: 2, MediaBox: [0, 0, 300, 300], Rotate: 90 }));
    const root = o.catalog().get("Pages") as PdfRef;
    o.edit<PdfDict>(a).set("Parent", mid);
    o.edit<PdfDict>(b).set("Parent", mid);
    o.edit<PdfDict>(c).set("Parent", root);
    o.edit<PdfDict>(root).set("Kids", [mid, c]).set("Count", 3).set("Resources", new PdfDict({ Font: new PdfDict({ F1: font }) }));
    expect(pageRefs(o).map((r) => r.num)).toEqual([a.num, b.num, c.num]);
    setPages(o, [c, b]);
    const f = PdfFile.open(o.rewrite());
    expect(f.pageCount()).toBe(2);
    const pages = f.pages();
    expect(pages[0]!.dict.get("Marker")).toBe(3);
    expect(pages[1]!.dict.get("Marker")).toBe(2);
    expect(pages[1]!.mediaBox).toEqual([0, 0, 300, 300]);
    expect(pages[1]!.rotate).toBe(90);
    expect(pages[0]!.mediaBox).toEqual([0, 0, 612, 792]);
    // the old middle node is gone and every page's parent is the root
    const pagesNode = f.catalog().get("Pages") as PdfRef;
    for (const p of pages) expect((f.dictGet(p.dict, "Parent") as PdfDict).get("Type")).toBe(N("Pages"));
    expect(f.get(pagesNode)).toBeTruthy();
    expect(isDict(f.get(pagesNode)) && (f.get(pagesNode) as PdfDict).get("Count")).toBe(2);
    expect(isName(pages[0]!.dict.get("Type"), "Page")).toBe(true);
  });
});

describe("damaged base files", () => {
  it("appends to a file whose cross-reference had to be rebuilt, and the result still opens with all pages", () => {
    const good = sample();
    // break the startxref offset and the xref keyword
    const broken = good.slice();
    const str = text(broken);
    const at = str.lastIndexOf("startxref");
    broken.set(new TextEncoder().encode("startxref\n7"), at);
    const f = PdfFile.open(broken);
    expect(f.repaired).toBe(true);
    const o = new Overlay(f);
    o.editInfo().set("Title", pdfText("After repair"));
    const out = o.incremental();
    expect(out.subarray(0, broken.length)).toEqual(broken);
    const g = PdfFile.open(out);
    expect(g.pageCount()).toBe(2);
    expect(textOf(g.info()!.get("Title") as PdfString)).toBe("After repair");
  });
});
