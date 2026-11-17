import { describe, expect, it } from "vitest";
import type { EditorSession } from "@pli.dev/core";
import { createDoc, DocumentSession, documentEditorSession, paragraph, Users } from "@pli.dev/docs";
import { PdfSession, pdfEditorSession } from "@pli.dev/pdf";
import { SheetSession, createWorkbook, sheetEditorSession } from "@pli.dev/sheets";
import { DeckSession, deckEditorSession } from "@pli.dev/decks";

/**
 * Every editor's session offers the same contract (`EditorSession`): so one script host, one sync helper, one set of
 * shared panels works with all of them. This runs the same checks over a document, a PDF, a sheet and a deck.
 */
interface Case {
  name: string;
  kind: string;
  make(): { editor: EditorSession<any, any, any>; ops: (title: string) => unknown[]; titleOf(state: any): unknown };
  comments: boolean;
}

const cases: Case[] = [
  {
    name: "Documents",
    kind: "document",
    comments: true,
    make: () => ({ editor: documentEditorSession(new DocumentSession(createDoc("T", [paragraph("a")]))), ops: (title) => [{ type: "set_title", title }], titleOf: (s) => s.title }),
  },
  {
    name: "PDF",
    kind: "pdf",
    comments: true,
    make: () => ({ editor: pdfEditorSession(new PdfSession()), ops: (title) => [{ type: "set_meta", patch: { title } }], titleOf: (s) => s.meta.title }),
  },
  {
    name: "Sheets",
    kind: "sheet",
    comments: true,
    make: () => {
      const wb = createWorkbook("T");
      return {
        editor: sheetEditorSession(new SheetSession(wb)),
        ops: (title) => [{ type: "set_cells", sheet: wb.sheets[0]!.id, cells: { A1: { v: title } } }],
        titleOf: (s) => s.sheets[0].cells.A1?.v,
      };
    },
  },
  {
    name: "Decks",
    kind: "deck",
    comments: false,
    make: () => ({ editor: deckEditorSession(new DeckSession()), ops: (title) => [{ type: "set_deck", patch: { title } }], titleOf: (s) => s.title }),
  },
];

describe.each(cases)("the editor session contract: $name", (c) => {
  it("is the editor kind its server model is registered under", () => {
    expect(c.make().editor.kind).toBe(c.kind);
  });

  it("applies, undoes, redoes and tells subscribers", () => {
    const { editor, ops, titleOf } = c.make();
    const origins: string[] = [];
    editor.subscribe((e) => origins.push(e.origin));
    editor.transact(ops("One") as never);
    expect(titleOf(editor.state)).toBe("One");
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(titleOf(editor.state)).not.toBe("One");
    expect(editor.redo()).toBe(true);
    expect(titleOf(editor.state)).toBe("One");
    expect(origins).toEqual(["local", "undo", "redo"]);
  });

  it("serializes and fingerprints the state the same way twice, and differently once it changes", () => {
    const { editor, ops } = c.make();
    const before = editor.hash();
    expect(editor.hash()).toBe(before);
    expect(JSON.parse(editor.serialize())).toBeTruthy();
    editor.transact(ops("Changed") as never);
    expect(editor.hash()).not.toBe(before);
  });

  it("runs a script as one undo step, takes it back on an error, and honours grants", () => {
    const { editor, ops, titleOf } = c.make();
    editor.script().run((ctx) => {
      ctx.apply(ops("First") as never);
      ctx.apply(ops("Second") as never);
    });
    expect(titleOf(editor.state)).toBe("Second");
    editor.undo();
    expect(titleOf(editor.state)).not.toBe("Second");
    expect(titleOf(editor.state)).not.toBe("First");

    expect(() =>
      editor.script().run((ctx) => {
        ctx.apply(ops("Doomed") as never);
        throw new Error("script failed");
      }),
    ).toThrow("script failed");
    expect(titleOf(editor.state)).not.toBe("Doomed");
    expect(() => editor.script({ grants: ["read"] }).run((ctx) => ctx.apply(ops("No") as never))).toThrow(/not allowed/);
  });

  it(c.comments ? "turns comments on" : "says whether comments are there yet, without breaking", () => {
    const { editor } = c.make();
    const users = new Users({ id: "u1", name: "Ana" });
    if (c.comments) {
      expect(editor.supportsComments).toBe(true);
      const client = editor.enableComments({ users });
      expect(editor.comments).toBe(client);
      expect(client.can("comment")).toBe(true);
    } else if (!editor.supportsComments) {
      expect(() => editor.enableComments({ users })).toThrow(/doesn't have comments/);
    } else {
      expect(editor.enableComments({ users })).toBeTruthy();
    }
  });
});
