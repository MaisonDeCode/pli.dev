import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { DocumentSession, createDoc, fragmentToJson, fromDocx, image, paragraph, parseDoc, serializeDoc, table, toDocx, toHtml, validateDoc, type Block, type Doc } from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const wrapped = (wrap: "left" | "right") => ({ ...image(PNG, { width: 120, height: 60 }, { alt: "tiny" }), wrap });

const select = (s: DocumentSession, block: string) => s.select({ anchor: { block, offset: 0 }, focus: { block, offset: 0 } });

describe("text wrapped around a picture", () => {
  it("is saved, and refused when it isn't left or right", () => {
    const doc = createDoc("T", [wrapped("left"), paragraph("text")]);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    const bad = JSON.parse(serializeDoc(doc));
    bad.doc.blocks[0].wrap = "center";
    expect(() => parseDoc(JSON.stringify(bad))).toThrowError(/wrap/);
  });

  it("is set on the selected picture, undone in one step, and taken off with null", () => {
    const s = new DocumentSession(createDoc("T", [image(PNG, { width: 120, height: 60 }), paragraph("text")]));
    const id = s.state.blocks[0]!.id;
    select(s, id);
    expect(s.setImageWrap("right")).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ type: "image", wrap: "right" });
    expect(s.setImageWrap(null)).toBe(true);
    expect(s.state.blocks[0]).not.toHaveProperty("wrap");
    s.undo();
    expect(s.state.blocks[0]).toMatchObject({ wrap: "right" });
    validateDoc(s.state);
  });

  it("does nothing when no picture is selected, and works in a table cell", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("text")]));
    select(s, s.state.blocks[0]!.id);
    expect(s.setImageWrap("left")).toBe(false);
    const grid = table([["a"]]);
    const cell = grid.rows[0]!.cells[0]!;
    cell.blocks = [image(PNG, { width: 20, height: 20 }) as never, paragraph("beside it") as never];
    const t = new DocumentSession(createDoc("T", [grid]));
    select(t, cell.blocks[0]!.id);
    expect(t.setImageWrap("left")).toBe(true);
    const wrappedCell = (t.state.blocks[0] as { rows: { cells: { blocks: Block[] }[] }[] }).rows[0]!.cells[0]!.blocks[0]!;
    expect(wrappedCell).toMatchObject({ type: "image", wrap: "left" });
    validateDoc(t.state);
  });

  it("is copied with the picture", () => {
    const from = new DocumentSession(createDoc("T", [wrapped("left"), paragraph("text")]));
    const into = new DocumentSession(createDoc("T", [paragraph("")]));
    select(into, into.state.blocks[0]!.id);
    into.paste({ fragment: fragmentToJson(from.state.blocks) });
    expect(into.state.blocks.find((b) => b.type === "image")).toMatchObject({ wrap: "left" });
  });

  it("is a float in HTML", () => {
    const html = toHtml(createDoc("T", [wrapped("left"), wrapped("right"), image(PNG, { width: 10, height: 10 })]));
    expect(html).toContain('style="float:left;margin:0 14px 8px 0"');
    expect(html).toContain('style="float:right;margin:0 0 8px 14px"');
    expect(html.match(/<p><img/g)).toHaveLength(1);
  });
});

describe("text wrapped around a picture, in DOCX", () => {
  const xml = (doc: Doc) => strFromU8(unzipSync(toDocx(doc))["word/document.xml"]!);

  it("is written as an anchored picture with the text wrapped square, in the paragraph after it", () => {
    const body = xml(createDoc("T", [wrapped("left"), paragraph("Text beside it")]));
    expect(body).toContain("<wp:anchor");
    expect(body).toContain("<wp:wrapSquare wrapText=\"bothSides\"/>");
    expect(body).toContain("<wp:positionH relativeFrom=\"margin\"><wp:align>left</wp:align></wp:positionH>");
    expect(body.match(/<w:p>/g)).toHaveLength(1);
    expect(body.indexOf("<wp:anchor")).toBeLessThan(body.indexOf("Text beside it"));
  });

  it("goes on the right when it is on the right, and has a paragraph of its own when no text follows", () => {
    const body = xml(createDoc("T", [paragraph("First"), wrapped("right")]));
    expect(body).toContain("<wp:align>right</wp:align>");
    expect(body.match(/<w:p>/g)).toHaveLength(2);
  });

  it("is anchored to the column in a table cell, and comes back wrapped", () => {
    const grid = table([["a"]]);
    grid.rows[0]!.cells[0]!.blocks = [wrapped("left") as never, paragraph("Beside it") as never];
    const doc = createDoc("T", [grid]);
    expect(xml(doc)).toContain('<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>');
    const back = fromDocx(toDocx(doc)).doc.blocks[0] as { rows: { cells: { blocks: Block[] }[] }[] };
    expect(back.rows[0]!.cells[0]!.blocks[0]).toMatchObject({ type: "image", wrap: "left" });
  });

  it("comes back as the same wrap on the same side", () => {
    const original = createDoc("T", [wrapped("left"), paragraph("Beside"), wrapped("right"), paragraph("Other side"), image(PNG, { width: 10, height: 10 })]);
    const { doc } = fromDocx(toDocx(original));
    const pictures = doc.blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image");
    expect(pictures.map((p) => p.wrap)).toEqual(["left", "right", undefined]);
    expect(doc.blocks.map((b) => b.type)).toEqual(["image", "paragraph", "image", "paragraph", "image"]);
  });
});
