import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  DocumentSession,
  createDoc,
  floatingImage,
  fromDocx,
  generateDocument,
  image,
  isFloating,
  pageBackground,
  paragraph,
  parseDoc,
  plainText,
  selectionState,
  serializeDoc,
  table,
  templateFields,
  toHtml,
  toMarkdown,
  textBox,
  toDocx,
  validateDoc,
  type Block,
  type Doc,
  type Run,
} from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const txt = (blocks: unknown): string => plainText((blocks as { runs: Run[] }).runs);

const box = () =>
  textBox(["PREPARED FOR", "{{ client.name }}"], {
    x: { from: "margin", offset: 7 },
    y: { from: "page", offset: 350 },
    width: 590,
    height: 467,
    fill: "#ffffff",
    line: { color: "#000000", width: 12, style: "double" },
  });

const cover = (): Doc => {
  const bg = pageBackground(PNG, { width: 400, height: 800 }, undefined, { alt: "Blue and grey" });
  return createDoc("Cover", [bg, box(), paragraph("Report"), paragraph("Body")]);
};

describe("floating pictures and text boxes", () => {
  it("are saved and read back unchanged", () => {
    const doc = cover();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    expect(doc.blocks.filter(isFloating)).toHaveLength(2);
  });

  it("make a page background that covers the page and keeps the picture's proportions", () => {
    const bg = pageBackground(PNG, { width: 400, height: 800 });
    expect(bg).toMatchObject({ width: 816, height: 1056, float: { x: { from: "page" }, y: { from: "page" }, behind: true } });
    // Taller than a page: top and bottom are cut, not stretched.
    expect(bg.crop?.left).toBe(0);
    expect(bg.crop!.top).toBeGreaterThan(0.1);
    // A picture of the page's own shape needs no crop.
    expect(pageBackground(PNG, { width: 816, height: 1056 }).crop).toBeUndefined();
  });

  it("are refused when they are not well made", () => {
    const bad = (change: (blocks: any[]) => void) => {
      const json = JSON.parse(serializeDoc(cover()));
      change(json.doc.blocks);
      return () => parseDoc(JSON.stringify(json));
    };
    expect(bad((b) => (b[1].float.x.from = "paragraph"))).toThrowError(/float.x.from/);
    expect(bad((b) => (b[1].float.fill = "red"))).toThrowError(/fill/);
    expect(bad((b) => (b[1].float.width = 0))).toThrowError(/width/);
    expect(bad((b) => b[1].rows.push(structuredClone(b[1].rows[0])))).toThrowError(/one row and one column|ids|unique/);
    expect(bad((b) => (b[0].wrap = "left"))).toThrowError(/wrap/);
  });

  it("can't float inside a table cell", () => {
    const grid = table([["a"]]);
    (grid.rows[0]!.cells[0]!.blocks as Block[]) = [floatingImage(PNG, { width: 10, height: 10 }, { x: { from: "page" }, y: { from: "page" } }) as never];
    expect(() => validateDoc(createDoc("T", [grid]))).toThrowError(/can't float/);
  });

  it("get their text filled in when a document is generated, and are asked for like the rest", () => {
    const template = cover();
    expect(templateFields(template).fields.map((f) => f.path)).toContain("client.name");
    const { doc, issues } = generateDocument(template, { client: { name: "Ana Reyes" } }) as { doc: Doc; issues: unknown[] };
    expect(issues).toEqual([]);
    const made = doc.blocks.find((b) => b.type === "table")!;
    expect(isFloating(made)).toBe(true);
    expect(made.type === "table" && made.rows[0]!.cells[0]!.blocks.map(txt)).toEqual(["PREPARED FOR", "Ana Reyes"]);
    // Where it sits and how it looks are kept.
    expect(made).toMatchObject({ float: { fill: "#ffffff", width: 590, y: { from: "page", offset: 350 } } });
    validateDoc(doc);
  });

  it("can be left out of a generated document with a condition around them", () => {
    const logo = floatingImage("{{ logo }}", { width: 100, height: 40 }, { x: { from: "margin", align: "right" }, y: { from: "page", offset: 20 } });
    const template = createDoc("T", [paragraph("{{#if logo}}"), logo, paragraph("{{/if}}"), paragraph("Hello")]);
    const without = (generateDocument(template, {}) as { doc: Doc }).doc;
    expect(without.blocks.filter(isFloating)).toHaveLength(0);
    const withLogo = (generateDocument(template, { logo: PNG }) as { doc: Doc }).doc;
    expect(withLogo.blocks.filter(isFloating)).toMatchObject([{ type: "image", src: PNG }]);
  });
});

describe("floating objects in the session", () => {
  const select = (s: DocumentSession, block: string, offset = 0) => s.select({ anchor: { block, offset }, focus: { block, offset } });

  it("are inserted against the paragraph the caret is in, and undone in one step", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("One"), paragraph("Two")]));
    select(s, s.state.blocks[1]!.id, 1);
    expect(s.insertFloat(box())).toBe(true);
    // In front of the paragraph it belongs to, which is the one the caret was in.
    expect(s.state.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(s.state.blocks.filter(isFloating)).toHaveLength(1);
    // The caret is in the box's text, ready to type.
    expect(selectionState(s.state, s.selection).floating?.type).toBe("table");
    expect(selectionState(s.state, s.selection).table).toBeNull();
    s.undo();
    expect(s.state.blocks).toHaveLength(2);
  });

  it("are moved, resized and restyled, merging what is given into what they have", () => {
    const s = new DocumentSession(createDoc("T", [floatingImage(PNG, { width: 100, height: 50 }, { x: { from: "page", offset: 10 }, y: { from: "page" } }), paragraph("x")]));
    const id = s.state.blocks[0]!.id;
    expect(s.setFloat({ x: { from: "margin", align: "center" }, behind: true }, id)).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ float: { x: { from: "margin", align: "center" }, y: { from: "page" }, behind: true } });
    expect(s.setFloat({ width: 200, height: 100 }, id)).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ width: 200, height: 100 });
    expect((s.state.blocks[0] as { float: object }).float).not.toHaveProperty("width");
    validateDoc(s.state);
    expect(s.setFloat(null, id)).toBe(true);
    expect(s.state.blocks[0]).not.toHaveProperty("float");
    s.undo();
    expect(s.state.blocks[0]).toHaveProperty("float");
  });

  it("are changed from a caret in a text box's text", () => {
    const s = new DocumentSession(createDoc("T", [box(), paragraph("x")]));
    const inside = (s.state.blocks[0] as { rows: { cells: { blocks: Block[] }[] }[] }).rows[0]!.cells[0]!.blocks[0]!.id;
    select(s, inside, 2);
    expect(s.setFloat({ fill: "#ff0000", behind: true })).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ float: { fill: "#ff0000", behind: true, line: { style: "double" } } });
    expect(s.setFloat({ fill: undefined })).toBe(true);
    expect((s.state.blocks[0] as { float: object }).float).not.toHaveProperty("fill");
  });

  it("can be made from a picture in the text, which is no longer beside text or aligned", () => {
    const pic = { ...image(PNG, { width: 120, height: 60 }, { alt: "x", align: "center" }), wrap: "left" as const };
    const s = new DocumentSession(createDoc("T", [pic, paragraph("text")]));
    select(s, pic.id);
    expect(s.setFloat({})).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ type: "image", float: { x: { from: "column" }, y: { from: "paragraph" } } });
    expect(s.state.blocks[0]).not.toHaveProperty("wrap");
    expect(s.state.blocks[0]).not.toHaveProperty("align");
    validateDoc(s.state);
    // Wrapping text round it takes it off the page instead.
    expect(s.setImageWrap("right")).toBe(true);
    expect(s.state.blocks[0]).toMatchObject({ wrap: "right" });
    expect(s.state.blocks[0]).not.toHaveProperty("float");
    validateDoc(s.state);
    // An ordinary table isn't made into a text box.
    const grid = table([["a"]]);
    const t = new DocumentSession(createDoc("T", [grid, paragraph("x")]));
    select(t, grid.rows[0]!.cells[0]!.blocks[0]!.id);
    expect(t.setFloat({})).toBe(false);
  });

  it("lose their place when pasted into a table cell, where a picture can't float", () => {
    const grid = table([["a"]]);
    const s = new DocumentSession(createDoc("T", [grid, paragraph("x")]));
    select(s, grid.rows[0]!.cells[0]!.blocks[0]!.id);
    const logo = floatingImage(PNG, { width: 10, height: 10 }, { x: { from: "page" }, y: { from: "page" } });
    s.paste({ fragment: [logo, box()] });
    const cell = (s.state.blocks[0] as { rows: { cells: { blocks: Block[] }[] }[] }).rows[0]!.cells[0]!;
    expect(cell.blocks.some((b) => b.type === "image")).toBe(true);
    expect(cell.blocks.every((b) => !(b.type === "image" && b.float))).toBe(true);
    // The box's text came in as lines of text.
    expect(cell.blocks.map((b) => ("runs" in b ? txt(b) : "")).join("|")).toContain("PREPARED FOR");
    validateDoc(s.state);
  });

  it("are listed, and ordinary blocks are not floats", () => {
    const s = new DocumentSession(cover());
    expect(s.floats).toHaveLength(2);
    expect(s.setFloat({ behind: true }, s.state.blocks[2]!.id)).toBe(false);
    expect(s.setFloat({}, image(PNG, { width: 1, height: 1 }).id)).toBe(false);
  });
});

describe("floating objects in Word files", () => {
  const files = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

  it("are written as anchored pictures and text boxes, behind the text when they are", () => {
    const xml = files(toDocx(cover()))["word/document.xml"]!;
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toContain("<wp:wrapNone/>");
    expect(xml).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>');
    expect(xml).toContain("wps:wsp");
    expect(xml).toContain("<w:txbxContent>");
    expect(xml).toContain('prst="rect"');
    expect(xml).toContain('cmpd="dbl"');
    expect(xml).toContain("{{ client.name }}");
  });

  it("come back as they went", () => {
    const original = cover();
    const back = fromDocx(toDocx(original)).doc;
    const floats = (d: Doc) => d.blocks.filter(isFloating).map((b) => (b.type === "image" ? { type: b.type, float: b.float, width: b.width, height: b.height, crop: b.crop } : { type: b.type, float: b.float, text: b.rows[0]!.cells[0]!.blocks.map(txt) }));
    expect(floats(back)).toEqual(floats(original));
    // The ordinary text is where it was.
    expect(back.blocks.filter((b) => !isFloating(b)).map(txt).filter(Boolean)).toEqual(["Report", "Body"]);
  });

  it("are read when Word wraps them in the newer-and-older drawing pair, taking the newer one only", () => {
    const original = createDoc("T", [textBox("Only once", { x: { from: "page", offset: 5 }, y: { from: "page", offset: 6 }, width: 100, height: 40, fill: "#ffcc00" }), paragraph("body")]);
    const entries = unzipSync(toDocx(original));
    const xml = strFromU8(entries["word/document.xml"]!);
    // Word writes `mc:AlternateContent` round a text box: the drawing to use, and a VML copy for programs that can't read it.
    const wrapped = xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/, (drawing) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>Only once</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent>`);
    expect(wrapped).not.toBe(xml);
    entries["word/document.xml"] = strToU8(wrapped);
    const result = fromDocx(zipSync(entries));
    const boxes = result.doc.blocks.filter(isFloating);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ type: "table", float: { fill: "#ffcc00", x: { from: "page", offset: 5 } } });
    expect(result.doc.blocks.map((b) => (isFloating(b) ? "" : txt(b))).join("")).toBe("body");
    expect(result.warnings).toEqual([]);
  });

  it("keep a text box's vertical alignment, rounded corners and see-through fill", () => {
    const shaped = textBox("Hi", { x: { from: "column", align: "center" }, y: { from: "paragraph", offset: -20 }, width: 200, height: 100, shape: "ellipse", fill: "#336699", fillOpacity: 0.5, padding: { x: 4, y: 2 } });
    (shaped.rows[0]!.cells[0] as { vAlign?: string }).vAlign = "middle";
    const back = fromDocx(toDocx(createDoc("T", [shaped, paragraph("x")]))).doc.blocks[0]!;
    expect(back).toMatchObject({ type: "table", float: { shape: "ellipse", fill: "#336699", padding: { x: 4, y: 2 }, x: { from: "column", align: "center" }, y: { from: "paragraph", offset: -20 } } });
    expect((back as { float: { fillOpacity: number } }).float.fillOpacity).toBeCloseTo(0.5, 2);
    expect((back as { rows: { cells: { vAlign: string }[] }[] }).rows[0]!.cells[0]!.vAlign).toBe("middle");
  });
});

describe("editing around floating objects", () => {
  const caretAt = (s: DocumentSession, block: string, offset: number) => s.select({ anchor: { block, offset }, focus: { block, offset } });

  it("don't get removed or joined by Backspace at the start of the paragraph after them", () => {
    const logo = floatingImage(PNG, { width: 10, height: 10 }, { x: { from: "page" }, y: { from: "page" } });
    const s = new DocumentSession(createDoc("T", [paragraph("one"), logo, paragraph("two")]));
    caretAt(s, s.state.blocks[2]!.id, 0);
    expect(s.backspace()).toBe(true);
    // The paragraphs are joined, and the picture is still there, now in front of the joined paragraph.
    expect(s.state.blocks.map((b) => b.type)).toEqual(["image", "paragraph"]);
    expect(txt(s.state.blocks[1])).toBe("onetwo");
    expect(s.floats).toHaveLength(1);
    s.undo();
    expect(s.state.blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("don't get removed or joined by Delete at the end of the paragraph before them", () => {
    const box2 = textBox("box", { x: { from: "page" }, y: { from: "page" }, width: 10, height: 10 });
    const s = new DocumentSession(createDoc("T", [paragraph("one"), box2, paragraph("two")]));
    caretAt(s, s.state.blocks[0]!.id, 3);
    expect(s.deleteForward()).toBe(true);
    expect(s.state.blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
    expect(txt(s.state.blocks[1])).toBe("onetwo");
  });

  it("are removed by Backspace when they are the selected block", () => {
    const logo = floatingImage(PNG, { width: 10, height: 10 }, { x: { from: "page" }, y: { from: "page" } });
    const s = new DocumentSession(createDoc("T", [logo, paragraph("one")]));
    caretAt(s, logo.id, 0);
    s.backspace();
    expect(s.floats).toHaveLength(0);
  });
});

describe("floating objects in other formats", () => {
  it("are placed against their paragraph in HTML", () => {
    const html = toHtml(cover());
    expect(html).toContain('class="float"');
    expect(html).toContain("position:absolute");
    expect(html).toContain("z-index:-1");
    expect(html).toContain("border:12px double #000000");
    expect(html).toContain("{{ client.name }}");
  });

  it("leave the pictures out of Markdown and keep a text box's text", () => {
    const markdown = toMarkdown(cover());
    expect(markdown).not.toContain("![");
    expect(markdown).toContain("PREPARED FOR");
    expect(markdown).toContain("Report");
  });
});
