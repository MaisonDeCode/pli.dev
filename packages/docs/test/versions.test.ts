import { describe, expect, it } from "vitest";
import { Users, VersionHistory, memoryVersionStorage } from "@pli.dev/core";
import { DocumentSession, createDoc, docSyncModel, docVersionSupport, documentEditorSession, heading, paragraph, plainText, restoreDocOps, summarizeDocDiff, type Doc } from "../src";

const texts = (doc: Doc) => doc.blocks.map((b) => ("runs" in b ? plainText(b.runs) : b.type));

describe("restoring a version of a document", () => {
  const start = () => createDoc("Plan", [heading(1, "Goals"), paragraph("Ship it"), paragraph("Celebrate")]);

  it("puts back edited, deleted and added text, and the title", () => {
    const then = start();
    const session = new DocumentSession(structuredClone(then));
    const [h, p1, p2] = session.state.blocks.map((b) => b.id);
    session.deleteBlock(p2!);
    session.insertText(p1!, 0, "Really ");
    session.insertBlock(paragraph("Extra"), p1!);
    session.setTitle("Plan v2");
    expect(texts(session.state)).toEqual(["Goals", "Really Ship it", "Extra"]);
    session.transact(restoreDocOps(session.state, then));
    expect(texts(session.state)).toEqual(texts(then));
    expect(session.state.title).toBe("Plan");
    expect(session.state.blocks.map((b) => b.id)).toEqual([h, p1, p2]);
  });

  it("restores a different order, and is one undo step", () => {
    const then = start();
    const session = new DocumentSession(structuredClone(then));
    const ids = session.state.blocks.map((b) => b.id);
    session.deleteBlock(ids[0]!);
    session.insertBlock(then.blocks[0]!, ids[2]!);
    expect(texts(session.state)).toEqual(["Ship it", "Celebrate", "Goals"]);
    const before = JSON.stringify(session.state);
    session.transact(restoreDocOps(session.state, then));
    expect(texts(session.state)).toEqual(["Goals", "Ship it", "Celebrate"]);
    session.undo();
    expect(JSON.stringify(session.state)).toBe(before);
  });

  it("does nothing when nothing differs", () => {
    const doc = start();
    expect(restoreDocOps(doc, structuredClone(doc))).toEqual([]);
  });

  it("says what changed", () => {
    const then = start();
    const now = structuredClone(then);
    now.title = "Plan v2";
    now.blocks.pop();
    now.blocks.push(paragraph("New"));
    (now.blocks[1] as { runs: { text: string }[] }).runs = [{ text: "Ship it today" }];
    const summary = summarizeDocDiff(then, now);
    expect(summary).toMatchObject({ added: 1, removed: 1, changed: 1 });
    expect(summary.lines.join("\n")).toContain("The title changed from “Plan” to “Plan v2”");
    expect(summary.lines.join("\n")).toContain("1 block was edited");
  });

  it("works with a version history on a document session, and the restore reaches the model's hash", async () => {
    const session = new DocumentSession(start());
    const editor = documentEditorSession(session);
    const users = new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
    const history = new VersionHistory({ file: "d", session: editor, storage: memoryVersionStorage<Doc>(), users, support: docVersionSupport, hash: docSyncModel.hash });
    await history.ready;
    const version = await history.save("Draft 1");
    const first = session.state.blocks[1]!.id;
    session.deleteBlock(first);
    await history.restore(version.id);
    expect(texts(session.state)).toEqual(["Goals", "Ship it", "Celebrate"]);
    expect(docSyncModel.hash(session.state)).toBe(version.hash);
    expect(history.compare(version.id).lines).toEqual([]);
  });
});
