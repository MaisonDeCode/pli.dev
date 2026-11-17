// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, Users, createDoc, paragraph, type PliUser } from "@pli.dev/docs";
import { DocumentView } from "../src";
import { CommentsPanel, PresenceBar, timeAgo } from "../src/ui/comments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ana: PliUser = { id: "ana", name: "Ana Reyes" };
const ben: PliUser = { id: "ben", name: "Ben Ito" };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function setup(users: Users = new Users(ana)) {
  const session = new DocumentSession(createDoc("T", [paragraph("Alpha beta gamma"), paragraph("Delta")]), { comments: { users } });
  const [first] = session.state.blocks.map((b) => b.id);
  session.select({ anchor: { block: first!, offset: 6 }, focus: { block: first!, offset: 10 } });
  return session;
}

function mount(session: DocumentSession, props: { activeId?: string | null; draft?: { selection: NonNullable<DocumentSession["selection"]>; quote: string } | null } = {}) {
  const calls = { activated: [] as (string | null)[], draftDone: 0 };
  act(() =>
    root.render(
      <CommentsPanel
        session={session}
        client={session.comments!}
        activeId={props.activeId ?? null}
        onActivate={(id) => calls.activated.push(id)}
        draft={props.draft ?? null}
        onDraftDone={() => calls.draftDone++}
        onClose={() => {}}
      />,
    ),
  );
  return calls;
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

function type(textarea: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    set.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("highlight markup", () => {
  it("wraps commented text so a click can find its thread", () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    act(() => root.render(<DocumentView doc={session.state} />));
    const mark = host.querySelector(".pli-comment");
    expect(mark?.textContent).toBe("beta");
    expect(mark?.getAttribute("data-comments")).toBe(thread.id);
  });

  it("lists every thread of overlapping comments", () => {
    const session = setup();
    const a = session.comment("A")!;
    const [first] = session.state.blocks.map((b) => b.id);
    const b = session.comment("B", { anchor: { block: first!, offset: 8 }, focus: { block: first!, offset: 14 } })!;
    act(() => root.render(<DocumentView doc={session.state} />));
    const ids = [...host.querySelectorAll(".pli-comment")].map((m) => m.getAttribute("data-comments"));
    expect(ids).toContain([a.id, b.id].sort().join(" "));
  });
});

describe("CommentsPanel", () => {
  it("shows a thread with its quote, author and replies", async () => {
    const session = setup(new Users({ current: ana, lookup: () => [ben] }));
    const thread = session.comment("Why beta?")!;
    await flush();
    session.comments!.receive({ type: "comment.add", threadId: thread.id, comment: { id: "c2", author: "ben", body: "Because.", createdAt: Date.now() } });
    mount(session, { activeId: thread.id });
    expect(host.querySelector(".pli-thread-quote")?.textContent).toBe("beta");
    expect([...host.querySelectorAll(".pli-comment-body")].map((p) => p.textContent)).toEqual(["Why beta?", "Because."]);
    expect(host.querySelector(".pli-comment-author")?.textContent).toBe("Ana Reyes");
    // Ben is looked up, so he is a placeholder first.
    expect([...host.querySelectorAll(".pli-comment-author")].map((p) => p.textContent)[1]).toMatch(/ben|Ben Ito/);
  });

  it("starts a thread from a draft, on the selection it was opened for", () => {
    const session = setup();
    const selection = session.selection!;
    const calls = mount(session, { draft: { selection, quote: "beta" } });
    const box = host.querySelector<HTMLTextAreaElement>(".pli-thread-draft textarea")!;
    expect(button("Comment")!.disabled).toBe(true);
    type(box, "A first comment");
    expect(button("Comment")!.disabled).toBe(false);
    // The caret moves elsewhere before sending: the comment still goes on the right text.
    session.select({ anchor: { block: session.state.blocks[1]!.id, offset: 0 }, focus: { block: session.state.blocks[1]!.id, offset: 0 } });
    click(button("Comment"));
    expect(session.comments!.threads).toHaveLength(1);
    expect(session.comments!.threads[0]!.anchor?.quote).toBe("beta");
    expect(calls.draftDone).toBe(1);
    expect(calls.activated).toEqual([session.comments!.threads[0]!.id]);
  });

  it("cancels a draft without starting a thread", () => {
    const session = setup();
    const calls = mount(session, { draft: { selection: session.selection!, quote: "beta" } });
    click(button("Cancel"));
    expect(calls.draftDone).toBe(1);
    expect(session.comments!.threads).toHaveLength(0);
  });

  it("replies and resolves", () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    mount(session, { activeId: thread.id });
    type(host.querySelector<HTMLTextAreaElement>("textarea")!, "Because");
    click(button("Reply"));
    expect(session.comments!.threads[0]!.comments.map((c) => c.body)).toEqual(["Why?", "Because"]);
    click(button("Resolve"));
    expect(session.comments!.threads[0]!.resolved?.by).toBe("ana");
    // Resolved threads are tucked away until asked for.
    expect(host.querySelectorAll(".pli-thread")).toHaveLength(0);
    click(button("Show 1 resolved"));
    expect(host.querySelector(".pli-thread-resolved")?.textContent).toContain("Resolved by Ana Reyes");
    click(button("Reopen"));
    expect(session.comments!.threads[0]!.resolved).toBeUndefined();
  });

  it("asks before deleting a thread, then removes it and its highlight", () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    mount(session, { activeId: thread.id });
    click(button("Delete"));
    expect(host.querySelector(".pli-comment-confirm")?.textContent).toContain("Delete this comment and its thread?");
    expect(session.comments!.threads).toHaveLength(1);
    click(host.querySelector(".pli-comment-confirm .pli-danger"));
    expect(session.comments!.threads).toHaveLength(0);
    expect(session.state.blocks[0]).toMatchObject({ runs: [{ text: "Alpha beta gamma" }] });
  });

  it("edits a comment", () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    mount(session, { activeId: thread.id });
    click(button("Edit"));
    const box = host.querySelector<HTMLTextAreaElement>(".pli-comment-item textarea")!;
    expect(box.value).toBe("Why?");
    type(box, "Why not?");
    click(button("Save"));
    const comment = session.comments!.threads[0]!.comments[0]!;
    expect(comment.body).toBe("Why not?");
    expect(comment.editedAt).toBeTypeOf("number");
  });

  it("shows no write controls to a viewer", async () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    await flush();
    const viewer = new DocumentSession(session.state, { comments: { users: new Users({ current: ben, role: "viewer" }) } });
    mount(viewer, { activeId: thread.id });
    expect(host.querySelectorAll(".pli-thread")).toHaveLength(1);
    expect(button("Reply")).toBeUndefined();
    expect(button("Resolve")).toBeUndefined();
    expect(button("Edit")).toBeUndefined();
    expect(button("Delete")).toBeUndefined();
  });

  it("says when the commented text has gone", () => {
    const session = setup();
    const thread = session.comment("Why?")!;
    session.transact([{ type: "delete_text", block: session.state.blocks[0]!.id, from: 6, to: 10 }]);
    mount(session);
    expect(host.querySelector(".pli-thread-quote")?.textContent).toBe("The commented text was deleted");
    expect(thread.id).toBeTruthy();
  });
});

describe("PresenceBar and time", () => {
  it("shows other people once each, and not you", () => {
    const peer = (client: string, user: PliUser) => ({ client, user: { ...user, color: "#123456" }, state: {}, seen: 0 });
    act(() => root.render(<PresenceBar you={ana} peers={[peer("1", ben), peer("2", ben), peer("3", ana)]} />));
    expect([...host.querySelectorAll(".pli-avatar")].map((a) => a.getAttribute("aria-label"))).toEqual(["Ben Ito"]);
    act(() => root.render(<PresenceBar you={ana} peers={[]} />));
    expect(host.querySelector(".pli-presence")).toBeNull();
  });

  it("says how long ago", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0, 0);
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("@mentions", () => {
  const cleo: PliUser = { id: "cleo", name: "Cleo Park" };
  const team = [ben, cleo];
  const directory = () => new Users({ current: ana, lookup: (ids) => team.filter((u) => ids.includes(u.id)), search: (q) => team.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) });
  const press = (el: Element, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

  async function writeDraft(session: DocumentSession) {
    const selection = session.selection!;
    mount(session, { draft: { selection, quote: "beta" } });
    const box = host.querySelector("textarea")!;
    return box;
  }

  it("offers the people the directory finds after an @, and writes the name", async () => {
    const session = setup(directory());
    const box = await writeDraft(session);
    act(() => box.focus());
    type(box, "Can @be");
    box.setSelectionRange(7, 7);
    act(() => void box.dispatchEvent(new Event("select", { bubbles: true })));
    await flush();
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain("Ben Ito");
    act(() => void options[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(host.querySelector("textarea")!.value).toBe("Can @Ben Ito ");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("saves the ids of the people mentioned, and shows them picked out", async () => {
    const session = setup(directory());
    const box = await writeDraft(session);
    type(box, "Hi @Ben");
    box.setSelectionRange(7, 7);
    act(() => void box.dispatchEvent(new Event("select", { bubbles: true })));
    await flush();
    press(host.querySelector("textarea")!, "Enter");
    expect(host.querySelector("textarea")!.value).toBe("Hi @Ben Ito ");
    click(button("Comment"));
    const thread = session.comments!.threads[0]!;
    expect(thread.comments[0]).toMatchObject({ body: "Hi @Ben Ito", mentions: ["ben"] });
    await flush();
    expect(host.querySelector(".pli-mention")?.textContent).toBe("@Ben Ito");
  });

  it("drops a mention that was deleted before sending", async () => {
    const session = setup(directory());
    const box = await writeDraft(session);
    type(box, "Hi @Ben");
    box.setSelectionRange(7, 7);
    act(() => void box.dispatchEvent(new Event("select", { bubbles: true })));
    await flush();
    press(host.querySelector("textarea")!, "Tab");
    type(host.querySelector("textarea")!, "Hi there");
    click(button("Comment"));
    expect(session.comments!.threads[0]!.comments[0]!.mentions).toBeUndefined();
  });

  it("closes the list with Escape without cancelling the comment", async () => {
    const session = setup(directory());
    const box = await writeDraft(session);
    type(box, "@c");
    box.setSelectionRange(2, 2);
    act(() => void box.dispatchEvent(new Event("select", { bubbles: true })));
    await flush();
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    press(host.querySelector("textarea")!, "Escape");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector("textarea")).not.toBeNull();
  });

  it("offers nothing when the directory can't search", async () => {
    const session = setup(new Users(ana));
    const box = await writeDraft(session);
    type(box, "@b");
    box.setSelectionRange(2, 2);
    act(() => void box.dispatchEvent(new Event("select", { bubbles: true })));
    await flush();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(box.getAttribute("role")).toBeNull();
  });

  it("marks a mention of the current user", async () => {
    const users = directory();
    const session = setup(users);
    session.comment("Over to @Ana Reyes", undefined, ["ana"]);
    mount(session, { activeId: null });
    await flush();
    expect(host.querySelector(".pli-mention")?.getAttribute("data-self")).toBe("true");
  });
});
