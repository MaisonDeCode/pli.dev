import { Users, type PliUser } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, sheetEditorSession, sheetSyncModel } from "../src";

const ana: PliUser = { id: "ana", name: "Ana Ito" };
const ben: PliUser = { id: "ben", name: "Ben Ray" };

function book() {
  const s = new SheetSession(createWorkbook("Budget", ["Data", "Other"]));
  s.setCell("Data", "A1", "Name");
  s.setCell("Data", "A2", "5");
  s.setCell("Data", "A3", "3");
  s.setCell("Data", "A4", "9");
  const client = s.comments.enable({ users: new Users({ current: ana, lookup: (ids: string[]) => [ana, ben].filter((u) => ids.includes(u.id)), search: (q: string) => [ana, ben].filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) }) });
  return { s, client };
}

describe("comments on cells", () => {
  it("starts a thread on a cell: the cell carries it, with replies, resolve and mentions", async () => {
    const { s, client } = book();
    const thread = s.comments.commentOn("Data", "A2", "Is this right? @Ben Ray", ["ben"]);
    expect(s.cell("Data", "A2")?.thread).toBe(thread.id);
    expect(thread.anchor).toMatchObject({ cell: "A2", quote: "5" });
    client.reply(thread.id, "Yes");
    client.resolve(thread.id);
    expect(client.thread(thread.id)!.comments).toHaveLength(2);
    expect(client.thread(thread.id)!.resolved?.by).toBe("ana");
    expect(client.thread(thread.id)!.comments[0]!.mentions).toEqual(["ben"]);
    client.reopen(thread.id);
    expect(client.thread(thread.id)!.resolved).toBeUndefined();
    // The threads are kept in the workbook, so they travel with it.
    await new Promise((r) => setTimeout(r, 0));
    expect(s.state.comments?.[thread.id]?.comments).toHaveLength(2);
    expect(s.comments.threadAt("Data", "A2")?.id).toBe(thread.id);
  });

  it("follows its cell through inserted and deleted rows and columns, sorting and moving", () => {
    const { s } = book();
    const t = s.comments.commentOn("Data", "A3", "three");
    s.insertRows("Data", 1, 2);
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A5" });
    s.insertColumns("Data", 1, 1);
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "B5" });
    s.session.undo();
    s.session.undo();
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A3" });
    s.sort("Data", "A2:A4", { descending: true });
    // The cell holding 3 is the last of three now.
    expect(s.cell("Data", s.comments.placeOf(t.id)!.cell)?.v).toBe(3);
    s.move({ sheet: "Data", range: s.comments.placeOf(t.id)!.cell }, { sheet: "Data", at: "D9" });
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "D9" });
  });

  it("survives a sheet being renamed, and is detached when its row or sheet is deleted (undo brings it back)", () => {
    const { s } = book();
    const t = s.comments.commentOn("Data", "A4", "nine");
    s.renameSheet("Data", "Figures");
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A4", sheet: s.sheet("Figures").id });
    s.deleteRows("Figures", 4, 1);
    expect(s.comments.isAttached(t.id)).toBe(false);
    expect(s.comments.detached().map((d) => d.id)).toEqual([t.id]);
    s.undo();
    expect(s.comments.isAttached(t.id)).toBe(true);
    s.deleteSheet("Figures");
    expect(s.comments.isAttached(t.id)).toBe(false);
    s.undo();
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A4" });
  });

  it("a copied cell does not copy the thread; a moved one takes it", () => {
    const { s } = book();
    const t = s.comments.commentOn("Data", "A2", "five");
    s.copy({ sheet: "Data", range: "A2" }, { sheet: "Data", at: "C2" });
    expect(s.cell("Data", "C2")?.thread).toBeUndefined();
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A2" });
    s.setCell("Data", "A2", "6");
    expect(s.cell("Data", "A2")?.thread).toBe(t.id);
    s.clear("Data", "A2", "contents");
    expect(s.cell("Data", "A2")?.thread).toBe(t.id);
  });

  it("undoing the start of a thread takes it off, redoing brings it back", () => {
    const { s, client } = book();
    const t = s.comments.commentOn("Data", "A3", "x");
    s.undo();
    expect(s.cell("Data", "A3")?.thread).toBeUndefined();
    expect(client.thread(t.id)).toBeUndefined();
    s.redo();
    expect(s.cell("Data", "A3")?.thread).toBe(t.id);
    expect(client.thread(t.id)?.comments[0]!.body).toBe("x");
  });

  it("keeps notes and comments apart, and converts between them", () => {
    const { s, client } = book();
    s.setNote("Data", "A2", "a classic note");
    const t = s.comments.noteToComment("Data", "A2");
    expect(s.cell("Data", "A2")?.note).toBeUndefined();
    expect(client.thread(t.id)!.comments[0]!.body).toBe("a classic note");
    s.comments.commentToNote("Data", "A2");
    expect(s.cell("Data", "A2")?.note).toContain("a classic note");
    expect(s.cell("Data", "A2")?.thread).toBeUndefined();
    expect(client.threads).toHaveLength(0);
    // A note and a thread on different cells live side by side.
    s.setNote("Data", "A3", "n");
    s.comments.commentOn("Data", "A4", "c");
    expect(s.cell("Data", "A3")?.note).toBe("n");
  });

  it("range threads keep their range for outlines and sit on the top left cell", () => {
    const { s } = book();
    const t = s.comments.commentOnRange("Data", "A2:B3", "this block");
    expect(s.cell("Data", "A2")?.thread).toBe(t.id);
    s.insertRows("Data", 1, 1);
    expect(s.comments.placeOf(t.id)).toMatchObject({ cell: "A3", range: "A3:B4" });
  });

  it("applies the permissions of the user", () => {
    const s = new SheetSession(createWorkbook("B"));
    const client = s.comments.enable({ users: new Users({ current: ana, role: "viewer" }) });
    expect(client.can("comment")).toBe(false);
    expect(() => s.comments.commentOn("Sheet1", "A1", "no")).toThrow();
  });

  it("is reported by the editor session once enabled", () => {
    const s = new SheetSession(createWorkbook("B"));
    const editor = sheetEditorSession(s);
    expect(editor.kind).toBe("sheet");
    expect(editor.supportsComments).toBe(true);
    expect(editor.comments).toBeNull();
    const client = editor.enableComments({ users: new Users(ana) });
    expect(editor.comments).toBe(client);
    expect(s.comments.client).toBe(client);
    editor.transact([{ type: "set_cells", sheet: s.sheet("Sheet1").id, cells: { A1: { v: 1 } } }]);
    expect(editor.hash()).toBe(sheetSyncModel.hash(s.state));
    expect(editor.canUndo).toBe(true);
  });
});
