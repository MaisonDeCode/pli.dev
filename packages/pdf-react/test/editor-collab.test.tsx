// @vitest-environment jsdom
// Two people editing the same file: two editors, one room, one authority. Both end up with the same document.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollabRoom, Users, createAuthority, userColor, isSyncMessage, memoryDocumentStore, memoryHub } from "@pli.dev/core";
import { hashPdfDoc, makeSamplePdf, memorySourceStore, openPdf, pdfSyncModel, readPdf, storageSources, type PdfAnchor, type PdfDoc, type PdfOp, type PdfSession } from "@pli.dev/pdf";
import { StorageClient } from "@pli.dev/core";
import { CSS_UNITS, PdfEditor, setSelection } from "../src";
import { fakeRenderer } from "../src/testing";
import { flush } from "./harness";
void flush;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = { width: 800, height: 600 };

interface Client {
  id: string;
  session: PdfSession;
  room: CollabRoom<PdfAnchor>;
  users: Users;
  host: HTMLElement;
  root: Root;
}

let clients: Client[] = [];
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  for (const c of clients) {
    act(() => c.root.unmount());
    c.host.remove();
  }
  clients = [];
});

async function setup() {
  const bytes = await makeSamplePdf();
  const hub = memoryHub();
  const store = memoryDocumentStore<PdfDoc, PdfOp>();
  const authority = createAuthority({ store, model: pdfSyncModel, create: () => readPdf(bytes, { name: "sample.pdf" }).doc });
  // The server: a member of the room that answers sync messages.
  const server = hub.transport();
  server.connect("file-1", (data) => {
    if (isSyncMessage(data)) void authority.receive("file-1", data as never, (envelope) => server.send(envelope));
  });

  const join = async (id: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> => {
    const users = new Users({ id, name });
    const session = await openPdf(bytes, { name: "sample.pdf", user: { id, name } });
    const room = new CollabRoom<PdfAnchor>({ room: "file-1", transport: hub.transport(), users, heartbeat: 60_000 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = { id, session, room, users, host, root };
    clients.push(client);
    await act(async () => {
      root.render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} defaultZoom={1} room={room} users={users} comments sync={{ verifyEvery: 0 }} annotations={{ storageKey: "" }} {...extra} />);
    });
    return client;
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 4))));
  };
  return { bytes, store, join, settle, authority };
}

const act_ = async (fn: () => void) => act(async () => fn());

describe("two people in one PDF", () => {
  it("join the room, take the shared document and see each other", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    const b = await join("u-b", "Ben Okafor");
    await settle();
    expect(a.room.status).toBe("connected");
    expect(a.room.peers.map((p) => p.user.id)).toEqual(["u-b"]);
    expect(b.room.peers.map((p) => p.user.id)).toEqual(["u-a"]);
    // who is here
    expect(a.host.querySelector(".pli-presence")?.getAttribute("aria-label")).toBe("1 other person here");
    expect(a.host.querySelector(".pli-sync")?.getAttribute("data-status")).toBe("synced");
    expect(hashPdfDoc(a.session.doc)).toBe(hashPdfDoc(b.session.doc));
    // nothing was changed yet: a save is still the original file, byte for byte
    expect(a.session.doc).toBe(a.session.baseline);
    expect(a.session.dirty).toBe(false);
  });

  it("converge after edits on both sides: annotations, a page turned, a form value, a comment thread", async () => {
    const { join, settle, store, bytes } = await setup();
    const a = await join("u-a", "Ana Reyes");
    const b = await join("u-b", "Ben Okafor");
    await settle();
    const [p1, p2] = a.session.doc.pages.map((p) => p.id) as [string, string];

    await act_(() => void a.session.annots.addHighlight(p1, [{ x: 72, y: 100, w: 100, h: 14 }], { color: "#ffeb3b" }));
    await act_(() => void b.session.pages.rotate([p2], 90));
    await act_(() => a.session.forms.setValue(a.session.forms.byName("name")!.id, "Sam Sample"));
    await act_(() => void b.session.annots.addFreeText(p2, { x: 72, y: 300, w: 200, h: 30 }, "From Ben", { size: 14 }));
    await settle();
    let thread!: { id: string };
    await act(async () => void (thread = a.session.comments.addNote(p1, 300, 300, "Is this right?")));
    await settle();
    await act_(() => void b.session.comments.client!.reply(thread.id, "Yes it is"));
    await settle();

    expect(hashPdfDoc(a.session.doc)).toBe(hashPdfDoc(b.session.doc));
    // the server's copy: its snapshot with the log replayed on it
    const snapshot = (await store.load("file-1"))!;
    const log = (await store.entries("file-1", snapshot.version)) ?? [];
    const server = log.reduce((doc, entry) => entry.ops.reduce((d, op) => pdfSyncModel.apply(d, op), doc), snapshot.state);
    expect(hashPdfDoc(server)).toBe(hashPdfDoc(a.session.doc));
    for (const c of [a, b]) {
      expect(c.session.doc.pages[1]!.rotate).toBe(90);
      expect(c.session.forms.byName("name")!.value).toBe("Sam Sample");
      expect(c.session.doc.pages[0]!.annots.filter((x) => x.type === "highlight")).toHaveLength(1);
      expect(c.session.doc.pages[1]!.annots.filter((x) => x.type === "freetext")).toHaveLength(1);
      expect(Object.values(c.session.doc.comments ?? {}).map((t) => t.comments.map((m) => m.body))).toEqual([["Is this right?", "Yes it is"]]);
    }
    // and the highlight is drawn on the other person's page
    expect(b.host.querySelector(".pli-pdf-page[data-page-id='" + p1 + "']")?.querySelectorAll("svg g").length).toBeGreaterThan(0);

    // Either person's save is the original file plus what both did.
    const out = await openPdf(await b.session.save(), {});
    expect(out.doc.pages[1]!.rotate).toBe(90);
    expect(out.forms.byName("name")!.value).toBe("Sam Sample");
    expect(out.doc.pages[0]!.annots.filter((x) => x.type === "highlight")).toHaveLength(1);
    expect(bytes.length).toBeLessThan((await a.session.save()).length);
  });

  it("shows the shared offline banner while the connection is down, with the changes waiting", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    await settle();
    expect(a.host.querySelector(".pli-offline-banner")).toBeNull();
    await act_(() => a.room.disconnect());
    await settle();
    await act_(() => void a.session.annots.addHighlight(a.session.doc.pages[0]!.id, [{ x: 72, y: 100, w: 100, h: 14 }]));
    await settle();
    const banner = a.host.querySelector(".pli-offline-banner");
    expect(banner?.textContent).toContain("You are offline");
    expect(banner?.textContent).toContain("1 change will be sent");
  });

  it("show where the other person is: page, selection and tool, and draw their selection", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    const b = await join("u-b", "Ben Okafor");
    await settle();
    const [p1, p2] = a.session.doc.pages.map((p) => p.id) as [string, string];
    let id = "";
    await act_(() => void (id = a.session.annots.addHighlight(p1, [{ x: 72, y: 100, w: 100, h: 14 }])));
    await settle();
    await act_(() => setSelection(b.session, { page: p2 }));
    await settle();
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state).toMatchObject({ page: p2, selection: [], tool: null });
    await act_(() => setSelection(b.session, { page: p1, annots: [id] }));
    await settle();
    const seen = a.room.peers.find((p) => p.user.id === "u-b")!;
    expect(seen.state).toMatchObject({ page: p1, selection: [id] });
    // the other person's selection is drawn on the page, with their name
    const mark = a.host.querySelector("[data-presence='u-b']");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("Ben");
    // when Ben chooses a tool, Ana is told
    await act_(() => b.host.querySelector<HTMLElement>(".pli-pdf-ribbon [aria-label='Pen']")!.click());
    await settle();
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state.tool).toBe("ink");
  });

  it("draws the other person's pointer on the page they are pointing at, in their colour with their name, and takes it away when they leave", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    const b = await join("u-b", "Ben Okafor");
    await settle();
    const [p1, p2] = a.session.doc.pages.map((p) => p.id) as [string, string];
    const pageOf = (c: Client, id: string) => c.host.querySelector<HTMLElement>(`.pli-pdf-page[data-page-id='${id}']`)!;
    const move = (el: Element, x: number, y: number, type = "mouse") => {
      const e = new MouseEvent("pointermove", { bubbles: true, clientX: x * CSS_UNITS, clientY: y * CSS_UNITS });
      Object.assign(e, { pointerId: 1, pointerType: type });
      el.dispatchEvent(e);
    };
    await act_(() => move(pageOf(b, p1), 100, 150));
    await settle();
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state.cursor).toEqual({ page: p1, x: 100, y: 150 });
    const mark = a.host.querySelector(`.pli-pdf-page[data-page-id='${p1}'] [data-cursor='u-b']`);
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Ben Okafor");
    expect(mark!.getAttribute("transform")).toMatch(/^translate\(100 150\)/);
    expect(mark!.querySelector("path")!.getAttribute("fill")).toBe(userColor("u-b"));
    // not on the other page, and not drawn for the person who owns it
    expect(a.host.querySelector(`.pli-pdf-page[data-page-id='${p2}'] [data-cursor]`)).toBeNull();
    expect(b.host.querySelector("[data-cursor='u-b']")).toBeNull();
    // it follows the pointer to another page
    await act_(() => move(pageOf(b, p2), 40, 60));
    await settle();
    expect(a.host.querySelector(`.pli-pdf-page[data-page-id='${p1}'] [data-cursor]`)).toBeNull();
    expect(a.host.querySelector(`.pli-pdf-page[data-page-id='${p2}'] [data-cursor='u-b']`)).not.toBeNull();
    // and goes when the pointer leaves the pages
    await act_(() => void b.host.querySelector(".pli-pdf-scroller")!.dispatchEvent(new Event("pointerleave")));
    await settle();
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state.cursor).toBeNull();
    expect(a.host.querySelector("[data-cursor]")).toBeNull();
    // a finger is not a pointer to show
    await act_(() => move(pageOf(b, p1), 10, 10, "touch"));
    await settle();
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state.cursor).toBeNull();
  });

  it("sends the pointer at most every 50 ms, and the last place is the one that counts", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    const b = await join("u-b", "Ben Okafor");
    await settle();
    const p1 = a.session.doc.pages[0]!.id;
    const page = b.host.querySelector<HTMLElement>(`.pli-pdf-page[data-page-id='${p1}']`)!;
    const spy = vi.spyOn(b.room, "setPresence");
    await act(async () => {
      for (let i = 1; i <= 20; i++) {
        const e = new MouseEvent("pointermove", { bubbles: true, clientX: i * 10 * CSS_UNITS, clientY: 50 * CSS_UNITS });
        Object.assign(e, { pointerId: 1, pointerType: "mouse" });
        page.dispatchEvent(e);
      }
    });
    await act(async () => void (await new Promise((r) => setTimeout(r, 90))));
    await settle();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(a.room.peers.find((p) => p.user.id === "u-b")!.state.cursor).toEqual({ page: p1, x: 200, y: 50 });
  });

  it("moves the pointer of a person away when their page is deleted", async () => {
    const mapped = pdfSyncModel.mapPresence!({ page: "p2", selection: [], tool: null, cursor: { page: "p2", x: 1, y: 2 } }, [{ type: "remove_page", id: "p2" } as never]);
    expect(mapped).toMatchObject({ page: null, cursor: null });
    const kept = pdfSyncModel.mapPresence!({ page: "p1", cursor: { page: "p1", x: 1, y: 2 } }, [{ type: "remove_page", id: "p2" } as never]);
    expect(kept.cursor).toEqual({ page: "p1", x: 1, y: 2 });
  });

  it("stops listening when the editor goes away, and takes the room down", async () => {
    const { join, settle } = await setup();
    const a = await join("u-a", "Ana Reyes");
    await settle();
    expect(a.room.status).toBe("connected");
    act(() => a.root.unmount());
    expect(a.room.status).toBe("idle");
    // edits after that are the person's own
    a.session.annots.addHighlight(a.session.doc.pages[0]!.id, [{ x: 72, y: 100, w: 100, h: 14 }]);
  });
});

describe("a file a peer added", () => {
  it("shows Waiting for the file until the bytes can be fetched, then draws the pages", async () => {
    const bytes = await makeSamplePdf();
    const other = await makeSamplePdf({ title: "Other" });
    // Ana merges a file in; Ben gets the change (the source is described in it, the bytes are not)
    const ana = await openPdf(bytes, { name: "sample.pdf" });
    await ana.pages.insertFrom(other, { name: "other.pdf", at: 0 });
    const store = memorySourceStore();
    const ben = await openPdf(bytes, { name: "sample.pdf", sources: store });
    ben.core.reset(ana.doc);
    expect(ben.doc.pages).toHaveLength(4);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PdfEditor session={ben} renderer={fakeRenderer({ pages: 4 })} viewport={viewport} defaultZoom={1} sourceRetryMs={10} annotations={{ storageKey: "" }} />);
    });
    await flush(4);
    const waiting = () => [...host.querySelectorAll(".pli-pdf-page[data-state=waiting]")];
    expect(waiting().length).toBeGreaterThan(0);
    expect(host.textContent).toContain("Waiting for the file");
    // the upload finishes: the pages ask again and are drawn
    store.put(ana.doc.sources[1]!, other);
    for (let i = 0; i < 30 && waiting().length > 0; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 15))));
    expect(waiting()).toHaveLength(0);
    expect(host.textContent).not.toContain("Waiting for the file");
    act(() => root.unmount());
    host.remove();
  });

  it("is served by storageSources: a second editor fetches the merged file from storage", async () => {
    const files = new Map<string, Uint8Array>();
    const storage = new StorageClient({
      upload: async (file, info) => (files.set(info.name, new Uint8Array(await file.arrayBuffer())), { ref: info.name }),
      resolve: (ref) => `https://files.test/${ref}`,
    });
    const fetchFile = async (url: string) => {
      const b = files.get(url.replace("https://files.test/", ""));
      return { ok: !!b, status: b ? 200 : 404, arrayBuffer: async () => b!.slice().buffer as ArrayBuffer };
    };
    const bytes = await makeSamplePdf();
    const other = await makeSamplePdf({ title: "Other" });
    const first = await openPdf(bytes, { sources: storageSources(storage, { key: "doc", fetch: fetchFile }) });
    await first.pages.insertFrom(other, { name: "other.pdf" });
    const source = first.doc.sources[1]!;
    expect(source.location).toBeTruthy();
    const second = await openPdf(bytes, { sources: storageSources(storage, { key: "doc", fetch: fetchFile }) });
    expect(await second.sources.get(source)).toEqual(other);
  });
});
