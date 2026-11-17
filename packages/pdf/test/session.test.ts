import { describe, expect, it } from "vitest";
import { emptyDoc, PdfSession, type Annotation, type PdfDoc } from "../src";

function sample(): PdfSession {
  const doc: PdfDoc = {
    ...emptyDoc("doc"),
    sources: [],
    pages: ["a", "b", "c"].map((id) => ({ id, from: null, width: 200, height: 300, rotate: 0 as const, annots: [] })),
  };
  return new PdfSession(doc, { now: () => 1000, user: { id: "u1", name: "Ana" } });
}

describe("PdfSession", () => {
  it("adds annotations as one undoable step, stamped with the user", () => {
    const s = sample();
    const id = s.annots.add("a", { type: "highlight", color: "#ffeb3b", rects: [{ x: 1, y: 2, w: 30, h: 10 }] });
    const annot = s.annots.get(id) as Annotation;
    expect(annot).toMatchObject({ type: "highlight", author: "u1", authorName: "Ana", created: 1000 });
    expect(s.selection.annots).toEqual([id]);
    s.undo();
    expect(s.annots.get(id)).toBeUndefined();
    s.redo();
    expect(s.annots.get(id)).toEqual(annot);
  });

  it("updates and removes annotations invertibly", () => {
    const s = sample();
    const id = s.annots.add("b", { type: "square", rect: { x: 0, y: 0, w: 10, h: 10 }, stroke: { color: "#000000", width: 1 } });
    s.annots.update(id, { opacity: 0.5 });
    expect(s.annots.get(id)?.opacity).toBe(0.5);
    s.annots.remove([id]);
    expect(s.annots.get(id)).toBeUndefined();
    s.undo();
    s.undo();
    expect(s.annots.get(id)?.opacity).toBeUndefined();
    expect(s.dirty).toBe(true);
  });

  it("rotates, moves, inserts and removes pages and undoes them", () => {
    const s = sample();
    const before = s.doc;
    s.pages.rotate(["a", "b"], 90);
    expect(s.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 0]);
    s.pages.rotate(["a"], -90);
    expect(s.doc.pages[0]!.rotate).toBe(0);
    s.pages.move(["c"], 0);
    expect(s.doc.pages.map((p) => p.id)).toEqual(["c", "a", "b"]);
    const blank = s.pages.insertBlank("a");
    expect(s.doc.pages.map((p) => p.id)).toEqual(["c", "a", blank, "b"]);
    s.pages.remove(["a", "b"]);
    expect(s.doc.pages.map((p) => p.id)).toEqual(["c", blank]);
    expect(() => s.pages.remove(["c", blank])).toThrow();
    while (s.canUndo) s.undo();
    expect(s.doc).toEqual(before);
  });

  it("fills a form field and undoes it", () => {
    const s = sample();
    s.core.transact([{ type: "insert_field", field: { id: "f1", name: "name", type: "text", value: null, widgets: [{ id: "w1", page: "a", rect: { x: 0, y: 0, w: 50, h: 12 } }] } }]);
    s.forms.setValue("f1", "Ana");
    expect(s.forms.byName("name")?.value).toBe("Ana");
    s.undo();
    expect(s.forms.get("f1").value).toBeNull();
  });

  it("sets metadata and the outline", () => {
    const s = sample();
    s.core.transact([{ type: "set_meta", patch: { title: "Hello", name: "hello.pdf" } }]);
    expect(s.doc.meta.title).toBe("Hello");
    expect(s.doc.name).toBe("hello.pdf");
    s.outline.set([{ id: "o1", title: "One", dest: { page: "a" }, children: [] }]);
    s.undo();
    s.undo();
    expect(s.doc.meta.title).toBeUndefined();
    expect(s.doc.name).toBeUndefined();
    expect(s.doc.outline).toEqual([]);
  });
});
