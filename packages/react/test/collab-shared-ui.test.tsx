// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ActivityFeed,
  CommentClient,
  Session,
  ShareClient,
  Users,
  VersionHistory,
  memorySharingStore,
  memoryVersionStorage,
  presentUsers,
  type Peer,
  type PliUser,
} from "@pli.dev/core";
import {
  ActivityList,
  ActivityToasts,
  AvatarStack,
  CommentThreads,
  OfflineBanner,
  PeerCursor,
  PeerLayer,
  PeerOutline,
  Popover,
  ShareButton,
  ShareDialog,
  SyncIndicator,
  ToastProvider,
  VersionHistoryPanel,
  VersionPreviewBar,
  useToasts,
} from "../src/collab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ana: PliUser = { id: "ana", name: "Ana Reyes", email: "ana@example.test" };
const ben: PliUser = { id: "ben", name: "Ben Ito", email: "ben@example.test" };
const cy: PliUser = { id: "cy", name: "Cy Lund" };
const everyone = [ana, ben, cy];

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll(".pli-popover").forEach((n) => n.remove());
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttonNamed = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label || b.textContent?.trim().startsWith(label));
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (el: Element, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

const peer = (user: PliUser, extra: Partial<Peer> = {}): Peer => ({ client: `c_${user.id}`, user, state: {}, seen: Date.now(), ...extra });

describe("people", () => {
  it("shows overlapping avatars, a count of the rest, and the whole list from it", () => {
    const peers = Array.from({ length: 6 }, (_, i) => peer({ id: `p${i}`, name: `Person ${i}` }));
    const people = presentUsers(peers, ana);
    render(<AvatarStack people={people} max={3} />);
    expect(host.querySelector(".pli-presence")?.getAttribute("aria-label")).toBe("6 other people here");
    expect(host.querySelectorAll('.pli-avatar[role="img"]')).toHaveLength(3);
    const more = host.querySelector<HTMLButtonElement>(".pli-avatar-more")!;
    expect(more.textContent).toBe("+3");
    click(more);
    const list = document.querySelector(".pli-popover");
    expect(list?.querySelectorAll("li")).toHaveLength(6);
    // The list is a surface of its own, not see-through.
    expect(list?.classList.contains("pli-surface")).toBe(true);
    press(document.body, "Escape");
    expect(document.querySelector(".pli-popover")).toBeNull();
  });

  it("fades someone who is idle and says so", () => {
    const idle = peer(ben, { state: { activity: "idle" } });
    render(<AvatarStack people={presentUsers([idle], ana)} />);
    expect(host.querySelector(".pli-avatar")?.getAttribute("data-activity")).toBe("idle");
    expect(host.querySelector(".pli-avatar")?.getAttribute("title")).toBe("Ben Ito (idle)");
  });

  it("draws cursors and outlines in the person's colour, hidden from screen readers", () => {
    render(
      <PeerLayer>
        <PeerCursor user={{ ...ben, color: "#123456" }} x={10} y={20} />
        <PeerOutline user={{ ...ben, color: "#123456" }} rect={{ left: 1, top: 2, width: 30, height: 12 }} variant="cell" />
        <PeerOutline user={ben} rect={{ left: 0, top: 0, width: 5, height: 5 }} variant="range" />
      </PeerLayer>,
    );
    const layer = host.querySelector(".pli-peer-layer")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    const cursor = layer.querySelector<HTMLElement>(".pli-peer-cursor")!;
    expect(cursor.style.left).toBe("10px");
    expect(cursor.style.getPropertyValue("--pli-peer")).toBe("#123456");
    expect(cursor.querySelector(".pli-peer-flag")?.textContent).toBe("Ben Ito");
    expect(layer.querySelectorAll(".pli-peer-outline")).toHaveLength(2);
    // A range is a fill only: no name tag.
    expect(layer.querySelector('[data-variant="range"] .pli-peer-flag')).toBeNull();
  });
});

describe("comments for any editor", () => {
  type CellAnchor = { cell: string };
  function setup(role: "editor" | "viewer" = "editor") {
    const users = new Users({ current: ana, role });
    users.add([ben]);
    const client = new CommentClient<CellAnchor>({ file: "sheet", users });
    return { client, users };
  }

  it("lists threads with what the editor says they are about, and filters them", () => {
    const { client } = setup();
    const a = client.createThread("Check this", { cell: "B2" });
    const b = client.createThread("And this @Ana", { cell: "C3" }, undefined, ["ana"]);
    client.resolve(a.id);
    const activated: (string | null)[] = [];
    render(<CommentThreads client={client} activeId={null} onActivate={(id) => activated.push(id)} quote={(t) => `Cell ${t.anchor?.cell}`} filters="menu" />);
    expect([...host.querySelectorAll(".pli-thread-quote")].map((q) => q.textContent)).toEqual(["Cell C3"]);
    click(buttonNamed("Resolved")!);
    expect([...host.querySelectorAll(".pli-thread-quote")].map((q) => q.textContent)).toEqual(["Cell B2"]);
    click(buttonNamed("All")!);
    expect(host.querySelectorAll(".pli-thread")).toHaveLength(2);
    click(buttonNamed("Mentions")!);
    expect(host.querySelectorAll(".pli-thread")).toHaveLength(1);
    expect(host.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe(b.id);
    click(host.querySelector(".pli-thread-quote"));
    expect(activated).toEqual([b.id]);
  });

  it("says when a thread's content is gone, and starts a draft", () => {
    const { client } = setup();
    const t = client.createThread("Hello", { cell: "A1" });
    const submitted: unknown[] = [];
    render(
      <CommentThreads
        client={client}
        activeId={t.id}
        onActivate={() => {}}
        isAttached={() => false}
        draft={{ quote: "D4", onCancel: () => {}, onSubmit: (body, mentions) => submitted.push([body, mentions]) }}
      />,
    );
    expect(host.querySelector(".pli-thread:not(.pli-thread-draft) .pli-thread-quote")?.textContent).toBe("The commented text was deleted");
    const box = host.querySelector<HTMLTextAreaElement>(".pli-thread-draft textarea")!;
    type(box, "New one");
    click(buttonNamed("Comment"));
    expect(submitted).toEqual([["New one", []]]);
  });

  it("offers no composer to a viewer", () => {
    const { client } = setup("viewer");
    const editor = new CommentClient<CellAnchor>({ file: "x", users: new Users(ana), initial: [{ id: "t", comments: [{ id: "c", author: "ben", body: "Hi", createdAt: 1 }], createdAt: 1 }] });
    void editor;
    render(<CommentThreads client={client} activeId={null} onActivate={() => {}} />);
    expect(host.textContent).toContain("No comments yet.");
  });
});

describe("sharing", () => {
  function setup(role: "editor" | "viewer" = "editor") {
    const users = new Users({ current: ana, role, search: (q) => everyone.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) });
    users.add(everyone);
    const store = memorySharingStore({ f: { owner: role === "editor" ? "ana" : "zed", grants: [{ userId: "cy", role: "viewer", at: 1 }], link: { enabled: false, role: "viewer" } } });
    const client = new ShareClient({ file: "f", users, store, linkUrl: (f) => `https://example.test/${f}` });
    return { client, store };
  }

  it("lists who has access and lets an editor change a role or remove someone", async () => {
    const { client } = setup();
    await client.ready;
    render(<ShareDialog client={client} open onClose={() => {}} title="Budget" />);
    await flush();
    expect(document.querySelector(".pli-dialog-title")?.textContent).toBe("Share “Budget”");
    const names = [...document.querySelectorAll(".pli-share-person")].map((p) => p.querySelector(".pli-share-name span")?.textContent);
    expect(names).toEqual(["Ana Reyes (you)", "Cy Lund"]);
    const role = document.querySelector<HTMLSelectElement>('select[aria-label="Role of Cy Lund"]')!;
    expect(role.value).toBe("viewer");
    act(() => {
      role.value = "editor";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(client.settings.grants.find((g) => g.userId === "cy")?.role).toBe("editor");
    act(() => {
      role.value = "__remove";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(client.settings.grants).toHaveLength(0);
    await flush();
  });

  it("invites people found in the directory, with the role chosen", async () => {
    const { client } = setup();
    await client.ready;
    render(<ShareDialog client={client} open onClose={() => {}} />);
    await flush();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Add people"]')!;
    type(input, "be");
    await flush();
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(["BIBen Itoben@example.test"]);
    press(input, "Enter");
    expect(document.querySelector(".pli-share-chip")?.textContent).toContain("Ben Ito");
    const roleBox = document.querySelector<HTMLSelectElement>('select[aria-label="Role for the people you are adding"]')!;
    act(() => {
      roleBox.value = "commenter";
      roleBox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(buttonNamed("Send"));
    expect(client.settings.grants.find((g) => g.userId === "ben")?.role).toBe("commenter");
    await flush();
  });

  it("invites an address, and says so when the text is neither", async () => {
    const { client } = setup();
    await client.ready;
    render(<ShareDialog client={client} open onClose={() => {}} />);
    await flush();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Add people"]')!;
    type(input, "nobody here");
    press(input, "Enter");
    expect(document.querySelector(".pli-share-error")?.textContent).toContain("isn't someone in your directory");
    type(input, "new@example.test");
    press(input, "Enter");
    click(buttonNamed("Send"));
    expect(client.settings.grants.map((g) => g.email)).toContain("new@example.test");
    await flush();
  });

  it("turns the link on and copies it", async () => {
    const { client } = setup();
    await client.ready;
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
    const copied: string[] = [];
    render(<ShareDialog client={client} open onClose={() => {}} onCopyLink={(u) => copied.push(u)} />);
    expect(buttonNamed("Copy link")?.hasAttribute("disabled")).toBe(true);
    const audience = document.querySelector<HTMLSelectElement>('select[aria-label="Who can open the link"]')!;
    act(() => {
      audience.value = "anyone";
      audience.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(client.settings.link.enabled).toBe(true);
    click(buttonNamed("Copy link"));
    await flush();
    expect(written).toEqual(["https://example.test/f"]);
    expect(copied).toEqual(["https://example.test/f"]);
  });

  it("shows a viewer the list and nothing to change", async () => {
    const { client } = setup("viewer");
    await client.ready;
    render(<ShareDialog client={client} open onClose={() => {}} />);
    expect(document.querySelector('input[aria-label="Add people"]')).toBeNull();
    expect(document.querySelector("select")?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("only editors can change it");
  });

  it("has a button that opens it", () => {
    const clicks: number[] = [];
    render(<ShareButton onClick={() => clicks.push(1)} restricted={false} />);
    click(host.querySelector("button"));
    expect(clicks).toEqual([1]);
    expect(host.textContent).toBe("Share");
  });
});

describe("version history and activity", () => {
  it("names a version, lists it with its author, and restores it as a new version", async () => {
    const session = new Session<string, { t: "set"; to: string }>("one", { apply: (s, op) => ({ state: op.to, inverse: { t: "set", to: s } }) });
    const users = new Users({ current: ana, role: "editor" });
    const history = new VersionHistory({
      file: "f",
      session,
      storage: memoryVersionStorage<string>(),
      users,
      hash: (s) => s,
      support: { restoreOps: (_c, target) => [{ t: "set", to: target }], summarize: (a, b) => ({ added: 0, removed: 0, changed: 1, lines: [`"${a}" became "${b}"`] }) },
    });
    await history.ready;
    render(<VersionHistoryPanel history={history} />);
    type(host.querySelector<HTMLInputElement>('input[aria-label="Name for the current version"]')!, "First");
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector(".pli-version-name-text")?.textContent).toBe("First");
    expect(host.querySelector(".pli-version-meta")?.textContent).toContain("Ana Reyes");
    session.transact([{ t: "set", to: "two" }]);
    await act(async () => {
      click(buttonNamed("Restore this version"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(session.state).toBe("one");
    // The restore is a version of its own, and nothing that was there is gone.
    const names = [...host.querySelectorAll(".pli-version-name-text")].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(["First", 'Before restoring "First"', 'Restored "First"']));
  });

  it("lists the current version first, and previews a version when it is chosen", async () => {
    const session = new Session<string, { t: "set"; to: string }>("one", { apply: (s, op) => ({ state: op.to, inverse: { t: "set", to: s } }) });
    const users = new Users({ current: ana, role: "editor" });
    const history = new VersionHistory({ file: "f", session, storage: memoryVersionStorage<string>(), users, hash: (s) => s, support: { restoreOps: (_c, target) => [{ t: "set", to: target }] } });
    await history.ready;
    await history.save("First");
    const previews: (string | null)[] = [];
    render(<VersionHistoryPanel history={history} onPreview={(v) => previews.push(v?.name ?? null)} />);
    const rows = [...host.querySelectorAll(".pli-version-name-text")].map((n) => n.textContent);
    expect(rows[0]).toBe("Current version");
    click(host.querySelectorAll<HTMLElement>(".pli-version-main")[1]);
    click(host.querySelectorAll<HTMLElement>(".pli-version-main")[0]);
    expect(previews).toEqual(["First", null]);
  });

  it("shows what a previewed version is, restores it, or goes back", async () => {
    const session = new Session<string, { t: "set"; to: string }>("one", { apply: (s, op) => ({ state: op.to, inverse: { t: "set", to: s } }) });
    const users = new Users({ current: ana, role: "editor" });
    const history = new VersionHistory({ file: "f", session, storage: memoryVersionStorage<string>(), users, hash: (s) => s, support: { restoreOps: (_c, target) => [{ t: "set", to: target }], summarize: (a, b) => ({ added: 0, removed: 0, changed: 1, lines: [`"${a}" became "${b}"`] }) } });
    await history.ready;
    const first = await history.save("First");
    session.transact([{ t: "set", to: "two" }]);
    const back = vi.fn();
    const restored = vi.fn();
    render(<VersionPreviewBar history={history} version={first} onBack={back} onRestored={restored} />);
    const bar = host.querySelector(".pli-version-bar")!;
    expect(bar.textContent).toContain("First");
    expect(bar.textContent).toContain("Ana Reyes");
    expect(bar.textContent).toContain('"one" became "two"');
    click(buttonNamed("Back to current"));
    expect(back).toHaveBeenCalled();
    await act(async () => {
      click(buttonNamed("Restore this version"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(session.state).toBe("one");
    expect(restored).toHaveBeenCalledTimes(1);
  });

  it("offers no restore on the preview bar to a viewer", async () => {
    const users = new Users({ current: ana, role: "viewer" });
    const v = { id: "v", name: "Old", at: 1, by: "ana", hash: "x", state: "x" };
    const storage = memoryVersionStorage<string>();
    await storage.save("f", v);
    const history = new VersionHistory({ file: "f", session: { state: "x", transact: () => {} }, storage, users, hash: (s) => s, support: { restoreOps: () => [] } });
    await history.ready;
    render(<VersionPreviewBar history={history} version={v} onBack={() => {}} />);
    expect(buttonNamed("Restore this version")).toBeUndefined();
    expect(buttonNamed("Back to current")).toBeTruthy();
  });

  it("shows nothing to change to a viewer", async () => {
    const users = new Users({ current: ana, role: "viewer" });
    const history = new VersionHistory({ file: "f", session: { state: "x", transact: () => {} }, storage: memoryVersionStorage<string>(), users, hash: (s) => s, support: { restoreOps: () => [] } });
    await history.ready;
    render(<VersionHistoryPanel history={history} />);
    expect(host.querySelector("form")).toBeNull();
  });

  it("lists activity as sentences, and toasts a mention of you but not the old ones", async () => {
    const users = new Users({ current: ana, role: "editor" });
    users.add([ben]);
    const feed = new ActivityFeed({ file: "f", users });
    feed.record({ kind: "mention", user: "ben", target: "ana", excerpt: "earlier" });
    render(
      <ToastProvider>
        <ActivityToasts feed={feed} user="ana" />
        <ActivityList feed={feed} />
      </ToastProvider>,
    );
    expect(host.querySelector(".pli-activity-item")?.textContent).toContain("Ben Ito mentioned you");
    expect(document.querySelector(".pli-toast")).toBeNull();
    await act(async () => void feed.record({ kind: "mention", user: "ben", target: "ana", excerpt: "now" }));
    expect(document.querySelector(".pli-toast")?.textContent).toContain("Ben Ito mentioned you");
  });
});

describe("status and notifications", () => {
  it("labels the sync state, and shows the offline banner only while offline", () => {
    render(
      <>
        <SyncIndicator status="saving" />
        <OfflineBanner status="synced" />
      </>,
    );
    expect(host.querySelector(".pli-sync-text")?.textContent).toBe("Saving…");
    expect(host.querySelector(".pli-offline-banner")).toBeNull();
    render(<OfflineBanner status="offline" unsynced={2} />);
    expect(host.querySelector(".pli-offline-banner")?.textContent).toContain("2 changes will be sent when you are back");
    expect(host.querySelector(".pli-offline-banner")?.getAttribute("role")).toBe("status");
  });

  it("shows a toast with an action, announces errors, and dismisses on its own", async () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useToasts>;
    function Grab() {
      api = useToasts();
      return null;
    }
    render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    const undone: number[] = [];
    act(() => void api.show({ text: "Version saved", action: { label: "Undo", run: () => undone.push(1) } }));
    expect(document.querySelector(".pli-toast")?.getAttribute("role")).toBe("status");
    click(buttonNamed("Undo"));
    expect(undone).toEqual([1]);
    expect(document.querySelector(".pli-toast")).toBeNull();
    act(() => void api.show({ text: "Couldn't save", kind: "error" }));
    expect(document.querySelector(".pli-toast")?.getAttribute("role")).toBe("alert");
    act(() => void api.show({ text: "Fine" }));
    act(() => void vi.advanceTimersByTime(7000));
    expect(document.querySelectorAll(".pli-toast")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("puts a popover under its anchor on an opaque surface", () => {
    function Demo({ open }: { open: boolean }) {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref}>Anchor</button>
          <Popover open={open} onClose={() => {}} anchor={ref} label="Details">
            <p>Inside</p>
          </Popover>
        </>
      );
    }
    render(<Demo open />);
    const pop = document.querySelector<HTMLElement>(".pli-popover")!;
    expect(pop.getAttribute("role")).toBe("dialog");
    expect(pop.getAttribute("aria-label")).toBe("Details");
    expect(pop.textContent).toBe("Inside");
  });
});
