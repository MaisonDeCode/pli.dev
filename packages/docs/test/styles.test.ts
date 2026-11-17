import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  DocumentSession,
  bold,
  createDoc,
  docReducer,
  effectiveMarks,
  fragmentToJson,
  heading,
  newStyleId,
  paragraph,
  parseDoc,
  readPaste,
  resolveStyle,
  selectionState,
  serializeDoc,
  sliceSelection,
  styleList,
  text,
  toDocx,
  toHtml,
  validateDoc,
  withParagraphStyle,
  type Block,
  type Doc,
  type DocStyle,
  type Selection,
} from "../src";

const note: DocStyle = { name: "Note", kind: "paragraph", marks: { italic: true, color: "#336699" }, align: "center", format: { spaceAfter: 18, indentLeft: 36 } };
const loud: DocStyle = { name: "Loud", kind: "character", marks: { bold: true, color: "#cc0000" } };

function docWith(styles: Record<string, DocStyle>, ...blocks: Block[]): Doc {
  return { ...createDoc("T", blocks), styles };
}

const whole = (doc: Doc, index = 0): Selection => {
  const block = doc.blocks[index]!;
  const length = "runs" in block ? block.runs.reduce((n, r) => n + r.text.length, 0) : 0;
  return { anchor: { block: block.id, offset: 0 }, focus: { block: block.id, offset: length } };
};

describe("resolving a style", () => {
  it("lays a style over the one it is based on", () => {
    const doc = { styles: { base: { name: "Base", kind: "paragraph", marks: { bold: true, fontSize: 12 }, align: "left" }, kid: { name: "Kid", kind: "paragraph", basedOn: "base", marks: { fontSize: 18 }, format: { spaceAfter: 4 } } } } as unknown as Doc;
    expect(resolveStyle(doc, "kid")).toEqual({ marks: { bold: true, fontSize: 18 }, align: "left", format: { spaceAfter: 4 } });
  });

  it("knows nothing of a style that isn't there", () => {
    expect(resolveStyle({}, "x")).toBeNull();
    expect(resolveStyle({ styles: {} }, undefined)).toBeNull();
  });

  it("stops at a loop and at a base of the other kind", () => {
    const loop = { styles: { a: { name: "A", kind: "paragraph", basedOn: "b", marks: { bold: true } }, b: { name: "B", kind: "paragraph", basedOn: "a", marks: { italic: true } } } } as unknown as Doc;
    expect(resolveStyle(loop, "a")).toEqual({ marks: { italic: true, bold: true } });
    const wrong = { styles: { p: { name: "P", kind: "paragraph", basedOn: "c", marks: { bold: true } }, c: { name: "C", kind: "character", marks: { italic: true } } } } as unknown as Doc;
    expect(resolveStyle(wrong, "p")).toEqual({ marks: { bold: true } });
  });

  it("gives text the paragraph's marks, then the character style's, then its own", () => {
    const doc = { styles: { note, loud } } as unknown as Doc;
    expect(effectiveMarks(doc, undefined, "note")).toEqual({ italic: true, color: "#336699" });
    expect(effectiveMarks(doc, { style: "loud" }, "note")).toMatchObject({ italic: true, bold: true, color: "#cc0000" });
    expect(effectiveMarks(doc, { style: "loud", color: "#000000", bold: false }, "note")).toMatchObject({ bold: false, color: "#000000" });
  });

  it("fills in a paragraph's alignment and spacing where it sets none", () => {
    const doc = { styles: { note } } as unknown as Doc;
    const plain = withParagraphStyle(doc, { id: "a", type: "paragraph", runs: [], style: "note" });
    expect(plain).toMatchObject({ align: "center", format: { spaceAfter: 18, indentLeft: 36 } });
    const own = withParagraphStyle(doc, { id: "a", type: "paragraph", runs: [], style: "note", align: "right", format: { spaceAfter: 2 } });
    expect(own).toMatchObject({ align: "right", format: { spaceAfter: 2, indentLeft: 36 } });
  });

  it("makes ids that are free and readable", () => {
    expect(newStyleId({}, "Block Quote!")).toBe("block-quote");
    expect(newStyleId({ styles: { other: note } }, "Note")).toBe("note");
    expect(newStyleId({ styles: { note } }, "Note")).toBe("note-2");
    expect(newStyleId({ styles: { note, "note-2": note } } as unknown as Doc, "note")).toBe("note-3");
    expect(newStyleId({}, "???")).toBe("style");
  });

  it("lists styles of one kind by name", () => {
    const doc = { styles: { z: { ...note, name: "Zed" }, a: { ...note, name: "Able" }, c: loud } } as unknown as Doc;
    expect(styleList(doc, "paragraph").map((s) => s.id)).toEqual(["a", "z"]);
    expect(styleList(doc, "character").map((s) => s.id)).toEqual(["c"]);
  });
});

describe("the set_style operation", () => {
  it("defines, changes and removes a style, and inverts each", () => {
    const doc = createDoc("T", [paragraph("a")]);
    const added = docReducer.apply(doc, { type: "set_style", id: "note", style: note });
    expect(added.state.styles).toEqual({ note });
    const changed = docReducer.apply(added.state, { type: "set_style", id: "note", style: { ...note, name: "Aside" } });
    expect(changed.state.styles?.note?.name).toBe("Aside");
    expect(docReducer.apply(changed.state, changed.inverse).state).toEqual(added.state);
    const removed = docReducer.apply(added.state, { type: "set_style", id: "note", style: null });
    expect(removed.state.styles).toBeUndefined();
    expect(docReducer.apply(removed.state, removed.inverse).state).toEqual(added.state);
    expect(docReducer.apply(doc, added.inverse).state).toEqual(doc);
  });
});

describe("applying styles", () => {
  it("sets a paragraph style and clears the paragraph's own alignment and spacing so the style shows", () => {
    const session = new DocumentSession(docWith({ note }, { ...paragraph("Hello"), align: "right", format: { spaceAfter: 3 } }));
    session.select(whole(session.state));
    expect(session.applyParagraphStyle("note")).toBe(true);
    expect(session.state.blocks[0]).toMatchObject({ style: "note" });
    expect(session.state.blocks[0]).not.toHaveProperty("align");
    expect(session.state.blocks[0]).not.toHaveProperty("format");
    expect(selectionState(session.state, session.selection).paragraphStyle).toBe("note");
    session.undo();
    expect(session.state.blocks[0]).toMatchObject({ align: "right", format: { spaceAfter: 3 } });
    expect(session.state.blocks[0]).not.toHaveProperty("style");
  });

  it("refuses a style that doesn't exist or is the wrong kind", () => {
    const session = new DocumentSession(docWith({ note, loud }, paragraph("Hello")));
    session.select(whole(session.state));
    expect(session.applyParagraphStyle("missing")).toBe(false);
    expect(session.applyParagraphStyle("loud")).toBe(false);
    expect(session.applyCharacterStyle("note")).toBe(false);
  });

  it("takes a paragraph style off with null", () => {
    const session = new DocumentSession(docWith({ note }, { ...paragraph("Hello"), style: "note" }));
    session.select(whole(session.state));
    expect(session.applyParagraphStyle(null)).toBe(true);
    expect(session.state.blocks[0]).not.toHaveProperty("style");
  });

  it("styles text with a character style, and for the next typed character at a caret", () => {
    const session = new DocumentSession(docWith({ loud }, paragraph("Hello world")));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 5 } });
    expect(session.applyCharacterStyle("loud")).toBe(true);
    expect((session.state.blocks[0] as { runs: { text: string; marks?: object }[] }).runs).toEqual([{ text: "Hello", marks: { style: "loud" } }, { text: " world" }]);
    session.select({ anchor: { block: id, offset: 11 }, focus: { block: id, offset: 11 } });
    session.applyCharacterStyle("loud");
    session.typeText("!");
    expect((session.state.blocks[0] as { runs: { text: string }[] }).runs.at(-1)).toEqual({ text: "!", marks: { style: "loud" } });
  });

  it("is cleared by Clear formatting", () => {
    const session = new DocumentSession(docWith({ note, loud }, { ...paragraph([text("Hi", { style: "loud" })]), style: "note" }));
    session.select(whole(session.state));
    session.clearFormatting();
    expect(session.state.blocks[0]).toEqual(expect.not.objectContaining({ style: expect.anything() }));
    expect(JSON.stringify(session.state.blocks[0])).not.toContain("loud");
  });

  it("keeps a paragraph style when the paragraph becomes a list item, and drops it when a type is picked", () => {
    const session = new DocumentSession(docWith({ note }, { ...paragraph("Hello"), style: "note" }));
    session.select(whole(session.state));
    session.toggleBlockType({ type: "list_item", list: "bullet" });
    expect(session.state.blocks[0]).toMatchObject({ type: "list_item", style: "note" });
    session.setBlockType({ type: "heading", level: 2 });
    expect(session.state.blocks[0]).toMatchObject({ type: "heading" });
    expect(session.state.blocks[0]).not.toHaveProperty("style");
  });

  it("continues the style on the next paragraph when Enter is pressed", () => {
    const session = new DocumentSession(docWith({ note }, { ...paragraph("Hello"), style: "note" }));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 2 }, focus: { block: id, offset: 2 } });
    session.splitBlock();
    expect(session.state.blocks.map((b) => (b as { style?: string }).style)).toEqual(["note", "note"]);
  });
});

describe("making a style from the selection", () => {
  it("captures what the paragraph looks like and moves it from the text to the style", () => {
    const session = new DocumentSession(createDoc("T", [{ ...paragraph([text("Careful", { italic: true, fontSize: 14 })]), align: "center", format: { spaceAfter: 12 } }, paragraph("Plain")]));
    session.select(whole(session.state));
    const id = session.createStyle("Warning", "paragraph");
    expect(id).toBe("warning");
    expect(session.state.styles).toEqual({ warning: { name: "Warning", kind: "paragraph", marks: { italic: true, fontSize: 14 }, align: "center", format: { spaceAfter: 12 } } });
    expect(session.state.blocks[0]).toEqual(expect.objectContaining({ style: "warning", runs: [{ text: "Careful" }] }));
    expect(session.state.blocks[0]).not.toHaveProperty("align");
    session.undo();
    expect(session.state.styles).toBeUndefined();
    expect(session.state.blocks[0]).toMatchObject({ align: "center", runs: [{ text: "Careful", marks: { italic: true, fontSize: 14 } }] });
  });

  it("takes only what all of the paragraph's text has in common", () => {
    const session = new DocumentSession(createDoc("T", [paragraph([text("Both ", { italic: true }), text("some", { italic: true, bold: true })])]));
    session.select(whole(session.state));
    session.createStyle("Slanted", "paragraph");
    expect(session.state.styles?.slanted?.marks).toEqual({ italic: true });
    expect(session.state.blocks[0]).toMatchObject({ runs: [{ text: "Both " }, { text: "some", marks: { bold: true } }] });
  });

  it("makes a character style from selected text", () => {
    const session = new DocumentSession(createDoc("T", [paragraph([text("one ", {}), text("two", { bold: true, color: "#cc0000" }), text(" three")])]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 4 }, focus: { block: id, offset: 7 } });
    expect(session.createStyle("Alarm", "character")).toBe("alarm");
    expect(session.state.styles?.alarm).toEqual({ name: "Alarm", kind: "character", marks: { bold: true, color: "#cc0000" } });
    expect((session.state.blocks[0] as { runs: unknown[] }).runs).toContainEqual({ text: "two", marks: { style: "alarm" } });
  });

  it("builds on the paragraph's current style, so it isn't lost", () => {
    const session = new DocumentSession(docWith({ note }, { ...paragraph([text("Hi", { bold: true })]), style: "note" }));
    session.select(whole(session.state));
    session.createStyle("Note bold", "paragraph");
    expect(session.state.styles?.["note-bold"]?.marks).toEqual({ italic: true, color: "#336699", bold: true });
    expect(session.state.styles?.["note-bold"]).toMatchObject({ align: "center", format: { spaceAfter: 18, indentLeft: 36 } });
  });

  it("updates a style so everything using it follows", () => {
    const session = new DocumentSession(createDoc("T", [{ ...paragraph("Sample"), style: "note" }, { ...paragraph("Other"), style: "note" }]));
    session.setStyle("note", note);
    session.select({ ...whole(session.state, 0) });
    session.setMarks({ bold: true });
    expect(session.updateStyleFromSelection("note")).toBe(true);
    expect(session.state.styles?.note?.marks).toMatchObject({ bold: true, italic: true });
    const shown = effectiveMarks(session.state, undefined, (session.state.blocks[1] as { style?: string }).style);
    expect(shown.bold).toBe(true);
  });

  it("deletes a style and everything pointing at it", () => {
    const session = new DocumentSession(docWith({ note, loud, kid: { name: "Kid", kind: "paragraph", basedOn: "note", marks: { bold: true } } }, { ...paragraph([text("a", { style: "loud" })]), style: "note" }));
    expect(session.deleteStyle("note")).toBe(true);
    expect(session.state.styles?.note).toBeUndefined();
    expect(session.state.styles?.kid).toEqual({ name: "Kid", kind: "paragraph", marks: { bold: true } });
    expect(session.state.blocks[0]).not.toHaveProperty("style");
    expect(session.deleteStyle("loud")).toBe(true);
    expect(JSON.stringify(session.state.blocks)).not.toContain("loud");
    session.undo();
    expect(session.state.styles?.loud).toBeDefined();
    expect(JSON.stringify(session.state.blocks)).toContain("loud");
  });
});

describe("saving", () => {
  it("round-trips styles and the references to them", () => {
    const doc = docWith({ note, loud, kid: { name: "Kid", kind: "paragraph", basedOn: "note" } }, { ...paragraph([text("a", { style: "loud" })]), style: "kid" });
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it.each([
    ["a style with no name", { s: { name: "", kind: "paragraph" } }, /doc\.styles\.s\.name/],
    ["an unknown kind", { s: { name: "S", kind: "table" } }, /kind/],
    ["a mark a style can't set", { s: { name: "S", kind: "paragraph", marks: { link: "x" } } }, /can't set "link"/],
    ["a character style with alignment", { s: { name: "S", kind: "character", align: "left" } }, /character style can't/],
    ["a base that isn't there", { s: { name: "S", kind: "paragraph", basedOn: "nope" } }, /basedOn/],
    ["a base of the other kind", { s: { name: "S", kind: "paragraph", basedOn: "c" }, c: { name: "C", kind: "character" } }, /basedOn/],
    ["a circle", { a: { name: "A", kind: "paragraph", basedOn: "b" }, b: { name: "B", kind: "paragraph", basedOn: "a" } }, /circle/],
  ])("rejects %s", (_name, styles, message) => {
    expect(() => validateDoc({ ...createDoc("T", [paragraph("x")]), styles })).toThrowError(message);
  });
});

describe("copying and pasting", () => {
  it("carries the styles the text uses, and the ones they are based on", () => {
    const from = docWith({ note, kid: { name: "Kid", kind: "paragraph", basedOn: "note" }, unused: loud, loud }, { ...paragraph([text("a", { style: "loud" })]), style: "kid" });
    const slice = sliceSelection(from, whole(from));
    expect(Object.keys(slice.styles ?? {}).sort()).toEqual(["kid", "loud", "note"]);

    const into = new DocumentSession(createDoc("T", [paragraph("")]));
    into.select(whole(into.state));
    const pasted = readPaste({ fragment: fragmentToJson(slice.blocks, slice.footnotes, slice.styles) })!;
    expect(pasted.source).toBe("fragment");
    into.paste({ fragment: fragmentToJson(slice.blocks, slice.footnotes, slice.styles) });
    expect(Object.keys(into.state.styles ?? {}).sort()).toEqual(["kid", "loud", "note"]);
  });

  it("keeps the destination's own style when the id is already there", () => {
    const from = docWith({ note }, { ...paragraph("x"), style: "note" });
    const slice = sliceSelection(from, whole(from));
    const into = new DocumentSession(docWith({ note: { ...note, name: "Mine" } }, paragraph("")));
    into.select(whole(into.state));
    into.paste({ fragment: fragmentToJson(slice.blocks, slice.footnotes, slice.styles) });
    expect(into.state.styles?.note?.name).toBe("Mine");
  });
});

describe("exports", () => {
  const doc = (): Doc =>
    docWith(
      { note, loud },
      { ...paragraph([text("Careful ", {}), text("now", { style: "loud" })]), style: "note" },
      { ...heading(1, "Big"), style: "note" },
    );

  it("writes HTML with the style's look on the paragraph and its text", () => {
    const html = toHtml(doc());
    expect(html).toContain('<p data-style="note" style="text-align:center;margin-bottom:18pt;margin-left:36pt">');
    expect(html).toContain("<em>");
    expect(html).toContain('<span style="color:#cc0000"><em><strong>now</strong></em></span>');
    expect(html).toMatch(/<h1 id="[^"]+" data-style="note" style="text-align:center/);
  });

  it("leaves HTML for a document without styles as it was", () => {
    expect(toHtml(createDoc("T", [paragraph("x")]))).not.toContain("data-style");
  });

  it("writes real Word styles for the document's own, and uses them", () => {
    const files = unzipSync(toDocx(doc()));
    const styles = strFromU8(files["word/styles.xml"]!);
    expect(styles).toContain('w:styleId="Pli_note"');
    expect(styles).toContain('<w:name w:val="Note"/>');
    expect(styles).toMatch(/w:styleId="Pli_note"[^]*<w:jc w:val="center"\/>/);
    expect(styles).toContain('<w:style w:type="character" w:customStyle="1" w:styleId="Pli_loud">');
    const body = strFromU8(files["word/document.xml"]!);
    expect(body).toContain('<w:pStyle w:val="Pli_note"/>');
    expect(body).toContain('<w:rStyle w:val="Pli_loud"/>');
    // A heading keeps its own style and takes the look as direct formatting.
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
  });

  it("bases a style on the one it is based on", () => {
    const d = docWith({ note, kid: { name: "Kid", kind: "paragraph", basedOn: "note", marks: { bold: true } } }, { ...paragraph("x"), style: "kid" });
    const styles = strFromU8(unzipSync(toDocx(d))["word/styles.xml"]!);
    expect(styles).toMatch(/w:styleId="Pli_kid"><w:name w:val="Kid"\/><w:basedOn w:val="Pli_note"\/>/);
    expect(styles).toMatch(/w:styleId="Pli_note"><w:name w:val="Note"\/><w:basedOn w:val="Normal"\/>/);
  });
});

describe("bold helper still builds plain marks", () => {
  it("is unaffected", () => {
    expect(bold("x")).toEqual(expect.objectContaining({ text: "x" }));
  });
});
