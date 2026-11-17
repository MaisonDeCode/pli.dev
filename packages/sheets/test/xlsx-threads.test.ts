import { Users, type PliUser } from "@pli.dev/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";
import { guidOf } from "../src/xlsx-threads";

const ana: PliUser = { id: "u_ana", name: "Ana Ito" };
const ben: PliUser = { id: "u_ben", name: "Ben Ray" };
const names = new Map([ana, ben].map((u) => [u.id, u]));

async function made() {
  const s = new SheetSession(createWorkbook("Budget", ["Data"]));
  s.setCell("Data", "B2", "42");
  s.setNote("Data", "A1", "a classic note");
  const users = new Users({ current: ana, lookup: (ids: string[]) => ids.flatMap((i) => (names.get(i) ? [names.get(i)!] : [])) });
  const client = s.comments.enable({ users });
  const thread = s.comments.commentOn("Data", "B2", "Is 42 right? @Ben Ray", ["u_ben"]);
  client.reply(thread.id, "Checked it");
  const closed = s.comments.commentOn("Data", "C3", "Done already");
  client.resolve(closed.id);
  await new Promise((r) => setTimeout(r, 0));
  return { s, thread, closed };
}

describe("threaded comments in .xlsx files", () => {
  it("writes the parts Excel reads: threaded comments, people, and a classic note that stands for each thread", async () => {
    const { s, thread } = await made();
    const bytes = toXlsx(s.state, { users: (id) => names.get(id) });
    const files = unzipSync(bytes);
    const threaded = strFromU8(files["xl/threadedComments/threadedComment1.xml"]!);
    expect(threaded).toContain('ref="B2"');
    expect(threaded).toContain(`id="${guidOf(thread.id)}"`);
    expect(threaded).toContain(`parentId="${guidOf(thread.id)}"`);
    expect(threaded).toContain('done="1"');
    expect(threaded).toMatch(/<mention [^>]*startIndex="\d+" length="8"/);
    const persons = strFromU8(files["xl/persons/person.xml"]!);
    expect(persons).toContain('displayName="Ana Ito"');
    expect(persons).toContain('userId="u_ben"');
    const legacy = strFromU8(files["xl/comments1.xml"]!);
    expect(legacy).toContain("[Threaded comment]");
    expect(legacy).toContain(`tc=${guidOf(thread.id)}`);
    expect(legacy).toContain("a classic note");
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain("application/vnd.ms-excel.threadedcomments+xml");
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain("relationships/person");
    expect(strFromU8(files["xl/worksheets/_rels/sheet1.xml.rels"]!)).toContain("relationships/threadedComment");
  });

  it("reads them back: replies, resolved or open, mentions and authors, and the note is still a note", async () => {
    const { s, thread, closed } = await made();
    const back = fromXlsx(toXlsx(s.state, { users: (id) => names.get(id) }));
    expect(back.warnings).toEqual([]);
    expect(back.people.map((p) => p.id).sort()).toEqual(["u_ana", "u_ben"]);
    expect(back.people.find((p) => p.id === "u_ben")!.name).toBe("Ben Ray");
    const sheet = back.workbook.sheets[0]!;
    // The cell has a note only if it had one; the placeholders are not notes.
    expect(sheet.cells["A1"]?.note).toBe("a classic note");
    expect(sheet.cells["B2"]?.note).toBeUndefined();
    const t = back.workbook.comments![sheet.cells["B2"]!.thread!]!;
    expect(t.comments.map((c) => [c.author, c.body])).toEqual([["u_ana", "Is 42 right? @Ben Ray"], ["u_ana", "Checked it"]]);
    expect(t.comments[0]!.mentions).toEqual(["u_ben"]);
    expect(t.resolved).toBeUndefined();
    expect(t.anchor).toMatchObject({ cell: "B2", quote: "42" });
    const c = back.workbook.comments![sheet.cells["C3"]!.thread!]!;
    expect(c.resolved).toBeTruthy();
    expect(c.comments[0]!.createdAt).toBe(closed.comments[0]!.createdAt - (closed.comments[0]!.createdAt % 10));
    expect(Object.keys(back.workbook.comments!)).toHaveLength(2);
    // And a second round trip changes nothing.
    const again = fromXlsx(toXlsx(back.workbook, { users: (id) => names.get(id) }));
    const plain = (c: typeof back.workbook.comments) => JSON.parse(JSON.stringify(c).replace(/"sheet":"[^"]*"/g, '"sheet":""'));
    expect(plain(again.workbook.comments)).toEqual(plain(back.workbook.comments));
    expect(thread.id).toBeTruthy();
  });

  it("reads a file Excel wrote", () => {
    // The shape of Excel 365's parts, written by hand: a comment, a reply, a person, and the placeholder note.
    const g = (n: string) => `{00000000-0000-4000-8000-${n.padStart(12, "0")}}`;
    const wb = createWorkbook("x", ["S"]);
    wb.sheets[0]!.cells["B2"] = { v: 1, thread: g("1") };
    wb.comments = { [g("1")]: { id: g("1"), anchor: { sheet: wb.sheets[0]!.id, cell: "B2" }, createdAt: 1, comments: [{ id: g("1"), author: "someone", body: "first", createdAt: 1 }, { id: g("2"), author: "someone", body: "second", createdAt: 2000 }] } };
    const back = fromXlsx(toXlsx(wb));
    const t = back.workbook.comments![g("1")]!;
    expect(t.comments).toHaveLength(2);
    expect(t.comments[1]!.id).toBe(g("2"));
  });
});
