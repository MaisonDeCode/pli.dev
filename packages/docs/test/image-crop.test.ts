import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { DocumentSession, createDoc, fromDocx, image, paragraph, parseDoc, serializeDoc, toDocx, toHtml, validateDoc, type Block } from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const crop = { top: 0.1, right: 0.2, bottom: 0.3, left: 0.25 };
const cropped = (): Block => ({ ...image(PNG, { width: 120, height: 60 }, { alt: "tiny" }), crop });

describe("a cropped picture", () => {
  it("is saved, and refused when it cuts away too much or isn't numbers", () => {
    const doc = createDoc("T", [cropped(), paragraph("text")]);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    const bad = JSON.parse(serializeDoc(doc));
    bad.doc.blocks[0].crop = { top: 0.6, right: 0, bottom: 0.6, left: 0 };
    expect(() => parseDoc(JSON.stringify(bad))).toThrowError(/crop/);
    bad.doc.blocks[0].crop = { top: "a", right: 0, bottom: 0, left: 0 };
    expect(() => parseDoc(JSON.stringify(bad))).toThrowError(/crop/);
  });

  it("is set on the selected picture in one undo step, and taken off with null", () => {
    const s = new DocumentSession(createDoc("T", [image(PNG, { width: 120, height: 60 }), paragraph("text")]));
    const id = s.state.blocks[0]!.id;
    s.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    expect(s.setImageCrop(crop)).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ type: "image", crop });
    expect(s.setImageCrop({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
    expect(s.state.blocks[0]).not.toHaveProperty("crop");
    s.undo();
    expect(s.state.blocks[0]).toMatchObject({ crop });
    validateDoc(s.state);
  });

  it("is drawn bigger than its box and shifted, in HTML", () => {
    const html = toHtml(createDoc("T", [cropped()]));
    // 120 wide is 55% of the picture, so the whole of it is 218.18 wide, and the left cut is 25% of that.
    expect(html).toContain("overflow:hidden");
    expect(html).toContain("width:218.18px");
    expect(html).toContain("left:-54.55px");
    const plain = toHtml(createDoc("T", [image(PNG, { width: 120, height: 60 })]));
    expect(plain).not.toContain("overflow:hidden");
  });

  it("is written to a Word file as srcRect and read back from it", () => {
    const bytes = toDocx(createDoc("T", [cropped(), paragraph("text")]));
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(xml).toContain('<a:srcRect l="25000" t="10000" r="20000" b="30000"/>');
    const back = fromDocx(bytes).doc.blocks.find((b) => b.type === "image");
    expect(back).toMatchObject({ crop });
  });
});

describe("setting a crop by dragging edges", () => {
  const select = (s: DocumentSession, id: string) => s.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });

  it("keeps the picture's scale when asked, so cutting an edge makes it smaller", () => {
    const s = new DocumentSession(createDoc("T", [image(PNG, { width: 400, height: 200 })]));
    const id = s.state.blocks[0]!.id;
    expect(s.cropImage(id, { top: 0, right: 0, bottom: 0, left: 0.25 }, { rescale: true })).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ width: 300, height: 200, crop: { left: 0.25 } });
    expect(s.cropImage(id, { top: 0.5, right: 0, bottom: 0, left: 0.25 }, { rescale: true, merge: true })).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ width: 300, height: 100 });
    expect(s.cropImage(id, null, { rescale: true })).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ width: 400, height: 200 });
    expect(s.state.blocks[0]).not.toHaveProperty("crop");
    // Without it the size stays and what is left is stretched to fit.
    s.cropImage(id, { top: 0, right: 0.5, bottom: 0, left: 0 });
    expect(s.state.blocks[0]).toMatchObject({ width: 400, height: 200, crop: { right: 0.5 } });
  });

  it("is a mode of the selected picture, which ends when the selection moves", () => {
    const s = new DocumentSession(createDoc("T", [image(PNG, { width: 40, height: 20 }), paragraph("text")]));
    const [picture, text] = s.state.blocks.map((b) => b.id) as [string, string];
    select(s, text);
    expect(s.setCropping(true)).toBe(false);
    select(s, picture);
    expect(s.setCropping(true)).toBe(true);
    expect(s.croppingImage).toBe(picture);
    select(s, text);
    expect(s.croppingImage).toBeNull();
  });
});
