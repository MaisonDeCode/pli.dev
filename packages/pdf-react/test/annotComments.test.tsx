// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { Users, type Thread } from "@pli.dev/core";
import type { Annotation, PdfAnchor } from "@pli.dev/pdf";
import { annots, byLabel, click, enableComments, flush, host, key, mount, q, qa, run, setValue, tap, tool, useAnnotHost } from "./annotHarness";

useAnnotHost();

const P0 = "p:main:0";
const P1 = "p:main:1";
const scroller = () => q(".pli-pdf-scroller");
const type = async (el: HTMLTextAreaElement, text: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.setSelectionRange?.(text.length, text.length);
  });
};
const button = (label: string, within: ParentNode = host) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === label)!;
const lastButton = (label: string, within: ParentNode = host) => [...within.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent!.trim() === label).at(-1)!;
const comments = () => q("[aria-label=Comments].pli-pdf-comments", host);
const mountComments = async (o: Parameters<typeof mount>[0] = {}, role: "viewer" | "commenter" | "editor" = "editor") => {
  const m = await mount({ ...o, props: { defaultSidebar: "comments", ...o.props } });
  const setup = enableComments(m.session, { id: "u1", name: "Ana Reyes" }, role);
  await flush();
  return { ...m, ...setup };
};

describe("sticky notes and comments", () => {
  it("a note with comments turned on is a thread: the first comment is the note's text, replies come after", async () => {
    const m = await mountComments();
    await tool("Note");
    await tap([150, 200]);
    await type(q("[aria-label='New note'] textarea", host) as HTMLTextAreaElement, "Is this number right?");
    await click(button("Add note", q("[aria-label='New note']", host)));
    const note = annots(m.session)[0] as Annotation & Record<string, any>;
    expect(note).toMatchObject({ type: "note", x: 150, y: 200, contents: "Is this number right?", icon: "comment", color: "#ffd400" });
    expect(note.thread).toBeTruthy();
    expect(m.client.threads).toHaveLength(1);
    expect(m.client.threads[0]).toMatchObject({ anchor: { page: P0, annot: note.id, x: 150, y: 200 } });
    expect(m.client.threads[0]!.comments[0]).toMatchObject({ author: "u1", body: "Is this number right?" });
    // one undo step takes the whole note back
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(0);
  });

  it("opens the thread of a note when it is clicked with no tool active, and replies to it", async () => {
    const m = await mountComments();
    const thread = await run(() => m.session.comments.addNote(P0, 100, 100, "First", []));
    await flush();
    const g = q("[data-type=note]");
    await act(async () => void g.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    const box = q("[role=dialog]", host);
    expect(box.getAttribute("aria-label")).toBe("Note comment");
    expect(box.textContent).toContain("First");
    expect(box.textContent).toContain("Ana Reyes");
    await type(q("textarea", box) as HTMLTextAreaElement, "A reply");
    await click(button("Reply", box));
    expect(m.client.thread(thread.id)!.comments.map((c) => c.body)).toEqual(["First", "A reply"]);
  });

  it("starts a thread on a highlight from the bar over it", async () => {
    const m = await mountComments();
    const id = await run(() => m.session.annots.add(P0, { type: "highlight", color: "#ffe14d", rects: [{ x: 72, y: 110, w: 60, h: 12 }], quote: "Hello" } as never, { select: false }));
    await tool("Select");
    await tap([90, 116]);
    expect(m.session.selection.annots).toEqual([id]);
    const bar = q("[role=toolbar][aria-label='Highlight actions']", host);
    await click(byLabel("Add comment", bar));
    const box = q("[aria-label='Highlight comment']", host);
    await type(q("textarea", box) as HTMLTextAreaElement, "Why this word?");
    await click(button("Comment", box));
    const h = m.session.annots.get(id) as any;
    expect(h.thread).toBeTruthy();
    expect(h.contents).toBe("Why this word?");
    expect(m.client.thread(h.thread)).toMatchObject({ anchor: { page: P0, annot: id, quote: "Hello" } });
  });

  it("keeps the thread in the document by default, so it travels with the file", async () => {
    const m = await mount();
    const users = new Users({ id: "u1", name: "Ana Reyes" });
    m.session.comments.enable({ users });
    await tool("Note");
    await tap([150, 200]);
    await type(q("[aria-label='New note'] textarea", host) as HTMLTextAreaElement, "In the file");
    await click(button("Add note", q("[aria-label='New note']", host)));
    await flush();
    const note = annots(m.session)[0] as any;
    expect(Object.values(m.session.doc.comments ?? {})).toHaveLength(1);
    expect(m.session.doc.comments![note.thread]).toMatchObject({ anchor: { annot: note.id } });
  });

  it("lets a read-only viewer read a note's thread, but not write", async () => {
    const m = await mount({ kit: { readOnly: true }, props: { readOnly: true } });
    const { client } = enableComments(m.session, { id: "u1", name: "Ana Reyes" }, "viewer");
    const thread: Thread<PdfAnchor> = { id: "th_r", createdAt: 1, anchor: { page: P0, annot: "a_r", x: 10, y: 10 }, comments: [{ id: "cm_r", author: "u2", body: "Please review", createdAt: 1 }] };
    await run(() => {
      m.session.annots.add(P0, { id: "a_r", type: "note", x: 100, y: 100, contents: "Please review", thread: "th_r" } as never, { select: false });
      client.receive({ type: "thread.create", thread });
    });
    await flush();
    await act(async () => void q("[data-type=note]").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    const box = q("[role=dialog][aria-label='Note comment']", host);
    expect(box.textContent).toContain("Please review");
    expect(qa("textarea", box)).toHaveLength(0);
    expect(button("Resolve", box)).toBeUndefined();
  });

  it("without comments turned on, a note keeps its text as the annotation's contents and can be edited", async () => {
    const m = await mount({ user: { id: "u1", name: "Ana Reyes" } });
    await tool("Note");
    await tap([150, 200]);
    await type(q("[aria-label='New note'] textarea", host) as HTMLTextAreaElement, "Plain note");
    await click(button("Add note", q("[aria-label='New note']", host)));
    const note = annots(m.session)[0] as any;
    expect(note).toMatchObject({ type: "note", contents: "Plain note", author: "u1", authorName: "Ana Reyes" });
    expect(note.thread).toBeUndefined();
    await tool("Select");
    await run(() => m.c().openComment(note.id));
    const box = q("[aria-label='Note comment']", host);
    expect((q("textarea", box) as HTMLTextAreaElement).value).toBe("Plain note");
    await type(q("textarea", box) as HTMLTextAreaElement, "Edited");
    await click(button("Save", box));
    expect((m.session.annots.get(note.id) as any).contents).toBe("Edited");
  });

  it("closes the box with Escape, gives focus back, and a click away closes it too", async () => {
    const m = await mount();
    await tool("Note");
    await tap([150, 200]);
    const area = q("[aria-label='New note'] textarea", host) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    await key(area, "Escape");
    expect(document.querySelector("[aria-label='New note']")).toBeNull();
    expect(annots(m.session)).toHaveLength(0);
    await tap([300, 300]);
    expect(document.querySelector("[aria-label='New note']")).toBeTruthy();
    await act(async () => void document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector("[aria-label='New note']")).toBeNull();
  });
});

describe("Comments tab", () => {
  const seed = async (m: Awaited<ReturnType<typeof mountComments>>) => {
    const a = await run(() => m.session.comments.addNote(P0, 100, 300, "On page one, lower", []));
    const b = await run(() => m.session.comments.addNote(P0, 100, 100, "On page one, upper", []));
    const c = await run(() => m.session.comments.addNote(P1, 100, 100, "On page two", []));
    await flush();
    return { a, b, c };
  };
  const items = () => qa(".pli-thread", comments());

  it("lists threads by page, each page's in the order they appear on it", async () => {
    const m = await mountComments();
    await seed(m);
    expect(qa(".pli-pdf-pagehead", comments()).map((h) => h.textContent)).toEqual(["Page 1", "Page 2"]);
    expect(items().map((i) => i.textContent)).toEqual([expect.stringContaining("On page one, upper"), expect.stringContaining("On page one, lower"), expect.stringContaining("On page two")]);
    expect(q(".pli-comments-count", comments()).textContent).toBe("3");
  });

  it("goes to the annotation and selects it when its thread is clicked", async () => {
    const m = await mountComments();
    const { c } = await seed(m);
    await click(q("button.pli-thread-quote", items()[2]!));
    const note = annots(m.session, 1)[0]!;
    expect(m.session.selection).toMatchObject({ page: P1, annots: [note.id] });
    expect(items()[2]!.hasAttribute("data-active")).toBe(true);
    expect(c.id).toBe(note.thread);
    expect(scroller().scrollTop).toBeGreaterThan(900);
  });

  it("filters: mine, and unresolved", async () => {
    const m = await mountComments();
    const { a } = await seed(m);
    // someone else's thread
    const other: Thread<PdfAnchor> = { id: "th_other", createdAt: 1, anchor: { page: P0, x: 10, y: 10 }, comments: [{ id: "cm_o", author: "u2", body: "From Ben", createdAt: 1 }] };
    await run(() => m.client.receive({ type: "thread.create", thread: other }));
    await flush();
    expect(items()).toHaveLength(4);
    await click(button("Mine", comments()));
    expect(items()).toHaveLength(3);
    expect(comments().textContent).not.toContain("From Ben");
    await click(button("All", comments()));
    await run(() => m.client.resolve(a.id));
    await click(button("Unresolved", comments()));
    expect(items()).toHaveLength(3);
    expect(comments().textContent).not.toContain("lower");
    expect(q(".pli-comments-count", comments()).textContent).toBe("3");
    await click(button("All", comments()));
    expect(items().find((i) => i.hasAttribute("data-resolved"))!.textContent).toContain("Resolved by Ana Reyes");
  });

  it("replies, edits, deletes, resolves and reopens, as far as the user is allowed", async () => {
    const m = await mountComments();
    const { b } = await seed(m);
    const card = () => items().find((i) => i.dataset.thread === b.id)!;
    await click(q("button.pli-thread-quote", card()));
    await type(q("textarea", card()) as HTMLTextAreaElement, "Second");
    await click(button("Reply", card()));
    expect(m.client.thread(b.id)!.comments).toHaveLength(2);
    await click(lastButton("Edit", card()));
    await type(q("textarea", card()) as HTMLTextAreaElement, "Second, edited");
    await click(button("Save", card()));
    expect(m.client.thread(b.id)!.comments[1]).toMatchObject({ body: "Second, edited" });
    expect(card().textContent).toContain("(edited)");
    await click(button("Resolve", card()));
    expect(m.client.thread(b.id)!.resolved).toMatchObject({ by: "u1" });
    await click(button("Reopen", card()));
    expect(m.client.thread(b.id)!.resolved).toBeUndefined();
    // deleting the only comment of a thread takes the note off the page
    const only = items().find((i) => i.textContent!.includes("On page two"))!;
    await click(button("Delete", only));
    await click(button("Delete", q(".pli-comment-confirm", only)));
    expect(annots(m.session, 1)).toHaveLength(0);
    expect(m.client.threads).toHaveLength(2);
  });

  it("offers a viewer no way to write or resolve, and a commenter only their own comments", async () => {
    const m = await mountComments({}, "viewer");
    // a viewer cannot write, so the thread comes from someone else
    const thread: Thread<PdfAnchor> = { id: "th_x", createdAt: 1, anchor: { page: P0, annot: "a_x", x: 10, y: 10 }, comments: [{ id: "cm_x", author: "u2", body: "From Ben", createdAt: 1 }] };
    await run(() => {
      m.session.annots.add(P0, { id: "a_x", type: "note", x: 10, y: 10, contents: "From Ben", thread: "th_x" } as never, { select: false });
      m.client.receive({ type: "thread.create", thread });
    });
    await flush();
    await click(q("button.pli-thread-quote", items()[0]!));
    expect(qa("textarea", comments())).toHaveLength(0);
    expect(button("Resolve", comments())).toBeUndefined();
    expect(button("Edit", comments())).toBeUndefined();
  });

  it("lets a person mention others with @, and records who", async () => {
    const m = await mountComments();
    const { b } = await seed(m);
    const card = () => items().find((i) => i.dataset.thread === b.id)!;
    await click(q("button.pli-thread-quote", card()));
    const area = q("textarea", card()) as HTMLTextAreaElement;
    await type(area, "Ping @Be");
    await flush();
    const option = q("[role=option]", card());
    expect(option.lastElementChild!.textContent).toBe("Ben Okafor");
    await act(async () => void option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await click(button("Reply", card()));
    const reply = m.client.thread(b.id)!.comments[1]!;
    expect(reply.body).toBe("Ping @Ben Okafor");
    expect(reply.mentions).toEqual(["u2"]);
    await flush();
    expect(card().querySelector(".pli-mention")!.textContent).toBe("@Ben Okafor");
  });

  it("without comments turned on, it lists the text of annotations and says it is read-only", async () => {
    const m = await mount({ props: { defaultSidebar: "comments" } });
    await run(() => {
      m.session.annots.add(P0, { type: "note", x: 10, y: 10, contents: "A plain note", author: "u1", authorName: "Ana Reyes" } as never, { select: false });
      m.session.annots.add(P0, { type: "highlight", color: "#ff0", rects: [{ x: 1, y: 1, w: 5, h: 5 }], quote: "Quoted text", contents: "Because" } as never, { select: false });
      m.session.annots.add(P0, { type: "square", rect: { x: 1, y: 1, w: 5, h: 5 }, stroke: { color: "#000", width: 1 } } as never, { select: false });
    });
    await flush();
    expect(comments().textContent).toContain("read-only");
    expect(items()).toHaveLength(2);
    // by place on the page: the highlight is above the note
    expect(items()[0]!.textContent).toContain("Quoted text");
    expect(items()[1]!.textContent).toContain("A plain note");
    expect(qa("textarea", comments())).toHaveLength(0);
    await click(q("button.pli-thread-quote", items()[0]!));
    expect(m.session.selection.annots).toHaveLength(1);
  });

  it("shows an empty list kindly", async () => {
    await mountComments();
    expect(comments().textContent).toContain("No comments yet.");
  });
});

describe("Annotations tab", () => {
  it("lists every annotation with its kind, page, author and time, and selects on click", async () => {
    const m = await mount({ props: { defaultSidebar: "annotations" }, user: { id: "u1", name: "Ana Reyes" } });
    const [a, b] = await run(() => [
      m.session.annots.add(P0, { type: "square", rect: { x: 10, y: 10, w: 50, h: 50 }, stroke: { color: "#000", width: 1 }, authorName: "Ana Reyes", created: Date.now() - 2 * 60_000, modified: Date.now() - 2 * 60_000 } as never, { select: false }),
      m.session.annots.add(P1, { type: "freetext", rect: { x: 10, y: 10, w: 50, h: 50 }, text: "Remember the date", style: { family: "Helvetica", size: 12, color: "#000" }, authorName: "Ben Okafor", locked: true } as never, { select: false }),
    ]);
    await flush();
    const rows = qa("[data-annot-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Rectangle");
    expect(rows[0]!.textContent).toContain("Page 1");
    expect(rows[0]!.textContent).toContain("Ana Reyes");
    expect(rows[0]!.textContent).toContain("2m ago");
    expect(rows[1]!.textContent).toContain("Text box");
    expect(rows[1]!.textContent).toContain("Remember the date");
    expect(rows[1]!.textContent).toContain("Locked");
    expect(qa(".pli-pdf-pagehead").map((h) => h.textContent)).toEqual(["Page 1", "Page 2"]);
    await click(rows[1]!);
    expect(m.session.selection).toMatchObject({ page: P1, annots: [b] });
    expect(rows[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("false");
    // by kind
    const select = q("select[aria-label='Show kind']") as HTMLSelectElement;
    await act(async () => {
      select.value = "square";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(qa("[data-annot-row]")).toHaveLength(1);
    expect(a).toBeTruthy();
  });

  it("says when there is nothing", async () => {
    await mount({ props: { defaultSidebar: "annotations" } });
    expect(q(".pli-pdf-annotlist").textContent).toContain("Nothing has been added");
    expect(setValue).toBeTruthy();
  });
});
