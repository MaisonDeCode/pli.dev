import { CollabRoom, SyncClient, Users, createAuthority, isSyncMessage, memoryDocumentStore } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { openPdf, pdfSyncModel, readPdf, type PdfAnchor, type PdfDoc, type PdfOp, type PdfSelection } from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

/** Comments kept in the document and a shared session: the thread must reach the server's copy, or a reload takes it away again. */
describe("comments kept in the document of a shared session", () => {
  const bytes = buildClassic(simpleDoc(2)).bytes;

  async function rig() {
    const store = memoryDocumentStore<PdfDoc, PdfOp>();
    const authority = createAuthority({ store, model: pdfSyncModel, create: () => readPdf(bytes).doc });
    const receivers: ((d: unknown) => void)[] = [];
    const transport = () => {
      let me = -1;
      return {
        connect: (_room: string, receive: (d: unknown) => void) => void (me = receivers.push(receive) - 1),
        send: (data: unknown) =>
          queueMicrotask(() => {
            const copy = JSON.parse(JSON.stringify(data)) as unknown;
            if (isSyncMessage(copy)) void authority.receive("r", copy, (env) => receivers.forEach((r) => r(JSON.parse(JSON.stringify(env)))));
            else receivers.forEach((r, i) => i !== me && r(copy));
          }),
        disconnect: () => {},
      };
    };
    const join = async (id: string) => {
      const users = new Users({ id, name: id });
      const session = await openPdf(bytes, { user: { id, name: id } });
      const client = session.comments.enable({ users });
      const room = new CollabRoom<PdfAnchor>({ room: "r", transport: transport(), users, comments: client });
      const sync = new SyncClient<PdfDoc, PdfOp, PdfSelection>({ session: session.core, room, model: pdfSyncModel, version: 0, verifyEvery: 0 });
      await room.connect();
      sync.start();
      return { session, client, sync };
    };
    const settle = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 3));
    };
    return { join, settle, store };
  }

  it("keeps a thread when the shared document is loaded again", async () => {
    const { join, settle } = await rig();
    const a = await join("a");
    const b = await join("b");
    await settle();
    const thread = a.session.comments.addNote(a.session.doc.pages[0]!.id, 100, 100, "First");
    await settle();
    b.client.reply(thread.id, "Second");
    await settle();
    const bodies = (s: typeof a) => Object.values(s.session.doc.comments ?? {}).map((t) => t.comments.map((c) => c.body));
    expect(bodies(a)).toEqual([["First", "Second"]]);
    expect(bodies(b)).toEqual([["First", "Second"]]);

    // What a fingerprint mismatch does: throw the document away and take the server's copy.
    b.sync.resync();
    await settle();
    expect(bodies(b)).toEqual([["First", "Second"]]);
    expect(b.client.thread(thread.id)?.comments).toHaveLength(2);
  });
});
