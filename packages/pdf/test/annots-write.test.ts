// Saving annotations into files that other tools made: in place, minimal, and without losing what we don't know.
import { readFileSync } from "node:fs";
import { Users } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfRef, openPdf, isArray, isDict } from "../src";
import type { Annotation, PdfSession } from "../src";
import { WHITE, expectPixel, hex, newSession, type AnnotOf } from "./support/annots";
import { renderPdf } from "./support/render";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const textOfDict = (d: PdfDict, key: string): string | undefined => {
  const v = d.get(key);
  return v && typeof v === "object" && "bytes" in v ? new TextDecoder().decode((v as { bytes: Uint8Array }).bytes) : undefined;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

async function open(name: string): Promise<PdfSession> {
  return openPdf(fixture(name), { name: `${name}.pdf`, user: { id: "u1", name: "Test User" }, now: () => Date.UTC(2026, 10, 16, 12, 0, 0) });
}

const annotsOf = (file: PdfFile, page = 0): PdfDict[] => {
  const arr = file.dictGet(file.pages()[page]!.dict, "Annots");
  return isArray(arr) ? arr.map((e) => file.get(e)).filter(isDict) : [];
};

describe("saving changes to annotations other tools made", () => {
  it("writes nothing for annotations that did not change", async () => {
    const bytes = fixture("annots-mupdf");
    const s = await open("annots-mupdf");
    s.core.transact([{ type: "set_meta", patch: { title: "Only the title" } }]);
    const out = await s.save();
    const file = PdfFile.open(out);
    const original = PdfFile.open(bytes);
    // Only the info dictionary (and the trailer) changed: no annotation object was touched.
    expect(out.subarray(0, bytes.length)).toEqual(bytes);
    expect(annotsOf(file).length).toBe(annotsOf(original).length);
    expect(file.pages()[0]!.dict.get("Annots")).toEqual(original.pages()[0]!.dict.get("Annots"));
    const appended = new TextDecoder("latin1").decode(out.subarray(bytes.length));
    expect(appended).not.toContain("/Subtype /Highlight");
  });

  it("replaces a changed annotation in place and keeps entries it does not own", async () => {
    const s = await open("annots-reply");
    const hl = s.doc.pages[0]!.annots.find((a) => a.type === "highlight")!;
    s.annots.restyle(hl.id, { color: "#00ff00" });
    s.annots.moveBy([hl.id], 10, 5);
    const out = await s.save();
    const file = PdfFile.open(out);
    const d = annotsOf(file).find((a) => (a.get("Subtype") as { value: string }).value === "Highlight")!;
    // The same object, the same entries Pli doesn't know about, a new colour and place.
    expect(String((file.pages()[0]!.dict.get("Annots") as unknown[]).find((e) => e instanceof PdfRef && file.get(e) === d))).toBe(hl.ref!.replace(" ", " ") + " R");
    expect(d.get("StructParent")).toBe(5);
    expect(d.has("Custom")).toBe(true);
    expect(d.get("C")).toEqual([0, 1, 0]);
    const again = await openPdf(out);
    const back = again.doc.pages[0]!.annots.find((a) => a.type === "highlight")!;
    expect(back).toMatchObject({ type: "highlight", color: "#00ff00", id: hl.id, contents: "On a highlight", rects: [{ x: 30, y: 285, w: 100, h: 20 }] });
    expect(again.doc.pages[0]!.annots).toHaveLength(s.doc.pages[0]!.annots.length);
  });

  it("removes an annotation with its popup and replies", async () => {
    const s = await open("annots-reply");
    const note = s.doc.pages[0]!.annots.find((a) => a.type === "note")!;
    const before = annotsOf(PdfFile.open(fixture("annots-reply"))).length;
    s.annots.remove([note.id]);
    const out = await s.save();
    const file = PdfFile.open(out);
    const subtypes = annotsOf(file).map((d) => (d.get("Subtype") as { value: string }).value);
    expect(subtypes).not.toContain("Popup");
    expect(subtypes).toEqual(["Highlight", "Caret", "Square", "Ink", "Widget", "Link"]);
    expect(before).toBe(11);
    // The unknown ones were left alone.
    const again = await openPdf(out);
    expect(again.doc.pages[0]!.annots.map((a) => a.type)).toEqual(["highlight", "link"]);
    expect(again.doc.comments?.["t:main:4"]).toBeUndefined();
  });

  it("changes the drawing order", async () => {
    const s = await open("annots-mupdf");
    const list = s.doc.pages[0]!.annots;
    const first = list[0]!;
    s.annots.bringToFront(first.id);
    const out = await s.save();
    const again = await openPdf(out);
    const ids = again.doc.pages[0]!.annots.map((a) => a.type);
    expect(ids[ids.length - 1]).toBe("highlight");
    expect(ids).toHaveLength(list.length);
  });

  it("adds new annotations after the existing ones and keeps the others in place", async () => {
    const s = await open("annots-mupdf");
    const n = s.doc.pages[0]!.annots.length;
    const id = s.annots.addShape("p:main:0", "square", { x: 10, y: 10, w: 30, h: 30 }, { color: "#ff0000", width: 2 });
    const out = await s.save();
    const file = PdfFile.open(out);
    const list = annotsOf(file).map((d) => (d.get("Subtype") as { value: string }).value);
    expect(list[list.length - 1]).toBe("Square");
    const again = await openPdf(out);
    expect(again.doc.pages[0]!.annots).toHaveLength(n + 1);
    expect(again.doc.pages[0]!.annots.at(-1)).toMatchObject({ type: "square", authorName: "Test User", rect: { x: 10, y: 10, w: 30, h: 30 } });
    void id;
  });

  it("uses the crop box origin, and the page's own rotation does not move annotations in page space", async () => {
    const original = await renderPdf(fixture("annots-crop"), 0, 2);
    // The highlight the other tool made is orange where the reader puts it.
    const s = await open("annots-crop");
    const hl = s.doc.pages[0]!.annots[0] as AnnotOf<"highlight">;
    expect(s.doc.pages[0]).toMatchObject({ width: 200, height: 300, rotate: 90 });
    const rect = hl.rects[0]!;
    // Page 90 degrees clockwise: (x, y) of the unrotated page lands at (height - y, x).
    const at = (x: number, y: number): [number, number] => [300 - y, x];
    const [cx, cy] = at(rect.x + rect.w / 2, rect.y + rect.h / 2);
    expectPixel(original, cx, cy, hex("#ff8000"), 60);
    // Our own annotation at the same place gets the same pixels.
    s.annots.addShape("p:main:0", "square", { x: 100, y: 150, w: 40, h: 40 }, { color: "#000000", width: 0, fill: "#0000ff" });
    const out = await s.save();
    const r = await renderPdf(out, 0, 2);
    const [bx, by] = at(120, 170);
    expectPixel(r, bx, by, [0, 0, 255], 10);
    const [ox, oy] = at(90, 170);
    expectPixel(r, ox, oy, WHITE, 5);
    // In PDF space the square is at the crop box origin (50, 40) plus the offset, measured up from the box's top (340).
    const file = PdfFile.open(out);
    const sq = annotsOf(file).find((d) => (d.get("Subtype") as { value: string }).value === "Square")!;
    expect(sq.get("Rect")).toEqual([150, 340 - 190, 190, 340 - 150]);
  });

  it("round-trips every annotation of the other tool's file when it is written again", async () => {
    const s = await open("annots-mupdf");
    // Touch every annotation so each one is rewritten from the JSON.
    for (const a of s.doc.pages[0]!.annots) s.annots.update(a.id, { locked: false });
    const out = await s.save();
    expect(s.doc.pages[0]!.annots.length).toBe(15);
    const again = await openPdf(out);
    const strip = (a: Annotation) => {
      const { id: _i, ref: _r, modified: _m, created: _c, thread: _t, locked: _l, ...rest } = a as Annotation & { thread?: string };
      return rest;
    };
    s.doc.pages[0]!.annots.forEach((a, i) => {
      const b = again.doc.pages[0]!.annots[i]!;
      const x = strip(a) as Record<string, unknown>;
      const y = strip(b) as Record<string, unknown>;
      // A stamp's name comes back, the free text keeps its look.
      expect(y.type).toBe(x.type);
      for (const key of Object.keys(x)) if (key !== "contents") expect(y[key], `${a.type}.${key}`).toEqual(x[key]);
    });
    const r = await renderPdf(out, 0, 2);
    expectPixel(r, 85, 40, [255, 255, 0], 40); // the highlight is still where it was
  });
});

describe("comment threads in the file", () => {
  it("reads replies and review state of a file into threads", async () => {
    const s = await open("annots-reply");
    const t = s.doc.comments!["t:main:4"]!;
    expect(t.comments.map((c) => [c.author, c.body])).toEqual([
      ["Ana Example", "First comment"],
      ["Ben Example", "Reply one"],
      ["Ana Example", "Reply two"],
    ]);
    expect(t.resolved).toBeTruthy();
    expect(s.doc.comments!["t:main:9"]!.comments).toHaveLength(1);
    expect(s.doc.pages[0]!.annots.some((a) => a.type === "note" && a.thread === "t:main:4")).toBe(true);
  });

  it("writes a new reply as a hidden text annotation that points at the note", async () => {
    const s = await open("annots-reply");
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const client = s.comments.client!;
    client.reply("t:main:4", "A new reply");
    await settle();
    expect(s.doc.comments!["t:main:4"]!.comments).toHaveLength(4);
    const out = await s.save();
    const file = PdfFile.open(out);
    const list = annotsOf(file);
    const note = list.find((d) => d.has("Popup"))!;
    const replies = list.filter((d) => d.has("IRT"));
    expect(replies).toHaveLength(4); // the state annotation, two replies and the new one
    const mine = replies.find((d) => textOfDict(d, "Contents") === "A new reply")!;
    expect(file.get(mine.get("IRT"))).toBe(note);
    expect(mine.get("RT")?.toString()).toBe("/R");
    const again = await openPdf(out);
    const t = again.doc.comments!["t:main:4"]!;
    expect(t.comments.map((c) => c.body)).toEqual(["First comment", "Reply one", "Reply two", "A new reply"]);
    expect(t.comments.at(-1)!.author).toBe("u1");
    expect(t.resolved).toBeTruthy();
  });

  it("edits and deletes replies in place, and reopens a thread", async () => {
    const s = await open("annots-reply");
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const client = s.comments.client!;
    const t = s.doc.comments!["t:main:4"]!;
    client.editComment(t.id, "c:main:6", "Edited reply");
    client.deleteComment(t.id, "c:main:7");
    client.reopen(t.id);
    await settle();
    const out = await s.save();
    const file = PdfFile.open(out);
    const again = await openPdf(out);
    expect(again.doc.comments!["t:main:4"]!.comments.map((c) => c.body)).toEqual(["First comment", "Edited reply"]);
    expect(again.doc.comments!["t:main:4"]!.resolved).toBeUndefined();
    // The edited reply is the same object, the deleted one is gone, and so is the old review state.
    const bodies = annotsOf(file).filter((d) => d.has("IRT")).map((d) => textOfDict(d, "Contents") ?? "(state)");
    expect(bodies).toEqual(["Edited reply"]);
    expect(file.has(7)).toBe(false);
  });

  it("saves a new note with its conversation and reads it back", async () => {
    const s = await newSession();
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const thread = s.comments.addNote("p:main:0", 100, 100, "Is this right?");
    s.comments.client!.reply(thread.id, "Yes.");
    await settle();
    s.comments.client!.resolve(thread.id);
    await settle();
    const out = await s.save();
    const r = await renderPdf(out, 0, 2);
    expect(r.inkIn(100, 100, 24, 24)).toBeGreaterThan(80); // the icon, and the reply draws nothing
    const again = await openPdf(out);
    const note = again.doc.pages[0]!.annots[0]!;
    expect(note).toMatchObject({ type: "note", x: 100, y: 100, contents: "Is this right?", authorName: "Test User", author: "u1" });
    const t = again.doc.comments![note.thread!]!;
    expect(t.comments.map((c) => [c.author, c.body])).toEqual([
      ["u1", "Is this right?"],
      ["u1", "Yes."],
    ]);
    expect(t.resolved).toBeTruthy();
    expect(t.anchor).toMatchObject({ page: "p:main:0", x: 100, y: 100 });
  });

  it("writes a comment on a highlight as its contents", async () => {
    const s = await newSession();
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const id = s.annots.addHighlight("p:main:0", [{ x: 20, y: 30, w: 100, h: 20 }]);
    const thread = s.comments.commentOn(id, "Please check");
    s.comments.client!.reply(thread.id, "Done");
    await settle();
    const again = await openPdf(await s.save());
    const hl = again.doc.pages[0]!.annots[0]!;
    expect(hl.contents).toBe("Please check");
    expect(again.doc.comments![hl.thread!]!.comments.map((c) => c.body)).toEqual(["Please check", "Done"]);
  });
});
