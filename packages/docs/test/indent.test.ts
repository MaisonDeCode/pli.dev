import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { DocumentSession, caret, createDoc, heading, listItem, paragraph, parseDoc, serializeDoc, title, toDocx, toHtml, validateDoc, type Block } from "../src";

const format = (s: DocumentSession, i = 0) => (s.state.blocks[i] as { format?: Record<string, number> }).format;
const at = (blocks: Block[], i = 0) => {
  const s = new DocumentSession(createDoc("T", blocks));
  s.select(caret(s.state.blocks[i]!.id, 0));
  return s;
};

describe("indenting paragraphs", () => {
  it("moves a paragraph half an inch at a time, and back", () => {
    const s = at([paragraph("a")]);
    s.indent();
    expect(format(s)).toEqual({ indentLeft: 36 });
    s.indent();
    expect(format(s)).toEqual({ indentLeft: 72 });
    s.outdent();
    s.outdent();
    expect(format(s)).toBeUndefined();
    expect(s.outdent()).toBe(false);
  });

  it("keeps other paragraph formatting, and removes the format object when nothing is left", () => {
    const s = at([{ ...paragraph("a"), format: { lineHeight: 1.5, indentLeft: 36 } }]);
    s.outdent();
    expect(format(s)).toEqual({ lineHeight: 1.5 });
  });

  it("stops at 10 inches and works on headings, but not on the title", () => {
    const s = at([heading(2, "h"), title("t")]);
    for (let i = 0; i < 30; i++) s.indent();
    expect(format(s)).toEqual({ indentLeft: 720 });
    s.select(caret(s.state.blocks[1]!.id, 0));
    expect(s.indent()).toBe(false);
  });

  it("still changes list depth for list items", () => {
    const s = at([listItem("bullet", "a"), listItem("bullet", "b")], 1);
    s.indent();
    expect((s.state.blocks[1] as { depth: number }).depth).toBe(1);
    expect(format(s, 1)).toBeUndefined();
    s.outdent();
    s.outdent();
    expect(s.state.blocks[1]!.type).toBe("paragraph");
  });

  it("indents every paragraph in a selection", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("a"), paragraph("b"), paragraph("c")]));
    s.select({ anchor: { block: s.state.blocks[0]!.id, offset: 0 }, focus: { block: s.state.blocks[2]!.id, offset: 1 } });
    s.indent();
    expect(s.state.blocks.map((_, i) => format(s, i)?.indentLeft)).toEqual([36, 36, 36]);
    s.undo();
    expect(s.state.blocks.map((_, i) => format(s, i))).toEqual([undefined, undefined, undefined]);
  });
});

describe("right and hanging indents", () => {
  const withIndents = () => ({ ...paragraph("quoted"), format: { indentLeft: 72, indentRight: 36, indentFirst: -18 } });

  it("are saved and validated", () => {
    const doc = createDoc("T", [withIndents()]);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    expect(() => validateDoc(createDoc("T", [{ ...paragraph("x"), format: { indentRight: -1 } }]))).toThrow(/indentRight/);
  });

  it("go to Word as w:ind with right and hanging", () => {
    const xml = strFromU8(unzipSync(toDocx(createDoc("T", [withIndents()])))["word/document.xml"]!);
    expect(xml).toContain('<w:ind w:left="1440" w:right="720" w:hanging="360"/>');
  });

  it("go to HTML as margins", () => {
    const html = toHtml(createDoc("T", [withIndents()]));
    expect(html).toContain("margin-left:72pt");
    expect(html).toContain("margin-right:36pt");
    expect(html).toContain("text-indent:-18pt");
  });

  it("are set by setParagraphFormat and cleared with null", () => {
    const s = at([paragraph("a")]);
    s.setParagraphFormat({ indentRight: 24 });
    expect(format(s)).toEqual({ indentRight: 24 });
    s.setParagraphFormat({ indentRight: null });
    expect(format(s)).toBeUndefined();
  });
});
