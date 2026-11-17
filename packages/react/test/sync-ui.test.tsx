// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CollabRoom,
  DocumentSession,
  SyncClient,
  Users,
  createAuthority,
  createDoc,
  docSyncModel,
  memoryDocumentStore,
  paragraph,
  plainText,
  type Doc,
  type DocOp,
  type Selection,
  type SyncStatus,
  type Transport,
} from "@pli.dev/docs";
import { ShareClient, VersionHistory, memorySharingStore, memoryVersionStorage } from "@pli.dev/core";
import { PliDocument, SyncIndicator, useSyncStatus } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Just enough of a sync client to drive the interface by hand. */
function fakeSync(initial: Partial<{ status: SyncStatus; unsynced: number; version: number | null; lastResync: { reason: string; lost: number; at: number } | null }> = {}) {
  const state = { status: "synced" as SyncStatus, unsynced: 0, version: 0 as number | null, lastResync: null as { reason: string; lost: number; at: number } | null, ...initial };
  const listeners = new Set<() => void>();
  const fake = {
    get status() { return state.status; },
    get unsynced() { return state.unsynced; },
    get version() { return state.version; },
    get lastResync() { return state.lastResync; },
    room: undefined,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    start: vi.fn(),
    stop: vi.fn(),
  };
  return {
    sync: fake as unknown as SyncClient<Doc, DocOp, Selection | null>,
    fake,
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      act(() => listeners.forEach((l) => l()));
    },
  };
}

const session = () => new DocumentSession(createDoc("T", [paragraph("Hello")]));
const label = () => host.querySelector(".pli-sync-text")?.textContent;
const editable = () => host.querySelector(".pli-body-editor")?.getAttribute("contenteditable");

describe("the connection indicator", () => {
  it("says Saved, Saving, Offline (with how many changes wait), and Reloading", () => {
    const { sync, set } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    expect(label()).toBe("Saved");
    expect(host.querySelector(".pli-sync")?.getAttribute("data-status")).toBe("synced");
    set({ status: "saving", unsynced: 2 });
    expect(label()).toBe("Saving…");
    set({ status: "offline", unsynced: 2 });
    expect(label()).toBe("Offline · 2 changes waiting");
    set({ status: "offline", unsynced: 1 });
    expect(label()).toBe("Offline · 1 change waiting");
    set({ status: "offline", unsynced: 0 });
    expect(label()).toBe("Offline");
    set({ status: "resyncing", unsynced: 0 });
    expect(label()).toBe("Reloading…");
    set({ status: "connecting" });
    expect(label()).toBe("Connecting…");
  });

  it("is not there without live editing", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(host.querySelector(".pli-sync")).toBeNull();
  });

  it("can be used on its own", () => {
    act(() => root.render(<SyncIndicator status="saving" />));
    expect(host.querySelector(".pli-sync")?.getAttribute("role")).toBe("status");
  });

  it("is a hook too, which doesn't re-render until something changes", () => {
    const { sync, set } = fakeSync();
    let renders = 0;
    function Probe() {
      renders++;
      const s = useSyncStatus(sync);
      return <span id="probe">{s.status}</span>;
    }
    act(() => root.render(<Probe />));
    const first = renders;
    set({ unsynced: 0 });
    expect(renders).toBe(first);
    set({ status: "saving", unsynced: 1 });
    expect(host.querySelector("#probe")?.textContent).toBe("saving");
  });
});

describe("sharing and history in the editor", () => {
  it("shows the offline bar while offline and takes it away when back", () => {
    const { sync, set } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    expect(host.querySelector(".pli-offline-banner")).toBeNull();
    set({ status: "offline", unsynced: 3 });
    expect(host.querySelector(".pli-offline-banner")?.textContent).toContain("3 changes will be sent when you are back");
    set({ status: "synced", unsynced: 0 });
    expect(host.querySelector(".pli-offline-banner")).toBeNull();
  });

  it("has a Share button that opens the Share dialog, and a Version history button that opens the panel", async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    const users = new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
    const share = new ShareClient({ file: "f", users, store: memorySharingStore() });
    const doc = session();
    const history = new VersionHistory({ file: "f", session: doc, storage: memoryVersionStorage<Doc>(), users, hash: (d) => String(d.blocks.length), support: { restoreOps: () => [] } });
    await act(async () => void (await history.ready));
    act(() => root.render(<PliDocument session={doc} share={share} history={history} />));
    const named = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
    act(() => void named("Share").click());
    expect(document.querySelector("dialog[open] .pli-dialog-title")?.textContent).toMatch(/^Share/);
    expect(host.querySelector(".pli-versions")).toBeNull();
    act(() => void named("Version history").click());
    expect(host.querySelector(".pli-versions")).not.toBeNull();
  });
});

describe("live editing in the editor", () => {
  it("starts with the editor and stops with it", () => {
    const { sync, fake } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    expect(fake.start).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(fake.stop).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it("is read-only until the first copy of the document has arrived", () => {
    const { sync, set } = fakeSync({ status: "connecting", version: null });
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    expect(editable()).toBe("false");
    expect(host.querySelector(".pli-document")?.hasAttribute("data-loading")).toBe(true);
    // The controls are there, waiting, rather than appearing later and moving the page.
    expect(host.querySelector(".pli-toolbar")).not.toBeNull();
    set({ status: "synced", version: 3 });
    expect(editable()).toBe("true");
    expect(host.querySelector(".pli-document")?.hasAttribute("data-loading")).toBe(false);
  });

  it("stays read-only for a document that is read-only", () => {
    const { sync } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} readOnly />));
    expect(editable()).toBe("false");
  });

  it("doesn't let you start a comment on the placeholder", () => {
    const { sync } = fakeSync({ version: null, status: "connecting" });
    const s = new DocumentSession(createDoc("T", [paragraph("Hello")]), { comments: { users: new Users({ id: "me", name: "Me" }) } });
    const id = s.state.blocks[0]!.id;
    s.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 3 } });
    act(() => root.render(<PliDocument session={s} sync={sync} />));
    const insert = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert")!;
    act(() => void insert.click());
    const item = [...host.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.startsWith("Comment"))!;
    expect(item.disabled).toBe(true);
  });

  it("asks before leaving the page with changes that haven't been sent", () => {
    const { sync, set } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    set({ status: "saving", unsynced: 3 });
    expect(leave()).toBe(true);
    set({ status: "synced", unsynced: 0 });
    expect(leave()).toBe(false);
  });

  it("says when the document was reloaded and what that cost", () => {
    const { sync, set } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    expect(host.querySelector(".pli-notice")).toBeNull();
    set({ lastResync: { reason: "missed an update", lost: 2, at: 1 } });
    expect(host.querySelector(".pli-notice")?.textContent).toContain("your last 2 changes");
  });

  it("stays quiet about a reload that cost nothing", () => {
    const { sync, set } = fakeSync();
    act(() => root.render(<PliDocument session={session()} sync={sync} />));
    set({ lastResync: { reason: "your document differs from the server's", lost: 0, at: 1 } });
    expect(host.querySelector(".pli-notice")).toBeNull();
  });
});

describe("with a real server in the same page", () => {
  /** The server is a function call away. */
  function loopback(authority: ReturnType<typeof createAuthority<Doc, DocOp>>): Transport {
    let receive: (data: unknown) => void = () => {};
    return {
      connect: (_room, r) => void (receive = r),
      send: (data) => void authority.receive("room", data, (envelope) => queueMicrotask(() => receive(envelope))),
      disconnect: () => {},
    };
  }
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  it("shows the server's document once it arrives, and saves what you type", async () => {
    const store = memoryDocumentStore<Doc, DocOp>();
    const authority = createAuthority<Doc, DocOp>({ store, model: docSyncModel, create: () => createDoc("Shared", [paragraph("From the server")]) });
    const local = new DocumentSession(createDoc("", []));
    const room = new CollabRoom<undefined>({ room: "room", transport: loopback(authority), users: new Users({ id: "me", name: "Me" }) });
    const sync = new SyncClient<Doc, DocOp, Selection | null>({ session: local, room: room as never, model: docSyncModel, verifyEvery: 0 });
    act(() => root.render(<PliDocument session={local} sync={sync} />));
    // Joined at once: loading, then the document.
    await settle();
    expect(host.querySelector(".pli-body-editor")?.textContent).toContain("From the server");
    expect(label()).toBe("Saved");
    expect(editable()).toBe("true");
    // A change goes to the server and is saved.
    local.select({ anchor: { block: local.state.blocks[0]!.id, offset: 0 }, focus: { block: local.state.blocks[0]!.id, offset: 0 } });
    act(() => void local.typeText(">> "));
    expect(label()).toBe("Saving…");
    await settle();
    expect(label()).toBe("Saved");
    const [entry] = (await store.entries("room", 0))!;
    expect(entry!.ops).toMatchObject([{ type: "insert_text", offset: 0 }]);
    const saved = (await store.load("room"))!;
    expect(plainText((saved.state.blocks[0] as unknown as { runs: { text: string }[] }).runs)).toBe("From the server");
  });
});
