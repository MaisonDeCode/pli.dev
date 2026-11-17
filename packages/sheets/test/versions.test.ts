import { Users, VersionHistory, memoryVersionStorage, type PliUser } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, type Workbook, restoreSheetOps, sheetSyncModel, sheetVersionSupport, summarizeSheetDiff } from "../src";
import { same } from "./sync-helpers";

const ana: PliUser = { id: "ana", name: "Ana" };

describe("version history for sheets", () => {
  it("restores an older workbook as one undoable step", async () => {
    const s = new SheetSession(createWorkbook("Budget", ["Data", "Notes"]));
    s.setCell("Data", "A1", "10");
    s.setCell("Data", "A2", "=A1*2");
    const history = new VersionHistory({ file: "f", session: { get state() { return s.state; }, transact: (ops) => s.transact(ops) }, storage: memoryVersionStorage<Workbook>(), users: new Users({ current: ana }), support: sheetVersionSupport, hash: sheetSyncModel.hash, keepBeforeRestore: false });
    await history.ready;
    const v = await history.save("First");
    const before = s.state;
    s.setCell("Data", "A1", "99");
    s.deleteRows("Data", 1, 1);
    s.addSheet("Later");
    s.renameSheet("Notes", "Memo");
    await history.restore(v.id);
    expect(same(s.state, before)).toBe(true);
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.state.sheets.map((x) => x.name)).toEqual(["Data", "Memo", "Later"]);
  });

  it("leaves the comment threads as they are", async () => {
    const s = new SheetSession(createWorkbook("B", ["Data"]));
    s.setCell("Data", "A1", "1");
    const target = s.state;
    const client = s.comments.enable({ users: new Users({ current: ana }) });
    s.comments.commentOn("Data", "A1", "hello");
    await new Promise((r) => setTimeout(r, 0));
    const ops = restoreSheetOps(s.state, target);
    // The thread stays in the workbook; what the version had of cells is put back (the marker goes with its cell content).
    expect(JSON.stringify(ops)).not.toContain("set_thread");
    expect(client.threads).toHaveLength(1);
  });

  it("summarizes what changed", () => {
    const a = new SheetSession(createWorkbook("A", ["Data"]));
    const before = a.state;
    a.setCell("Data", "A1", "1");
    a.setCell("Data", "A2", "2");
    a.addSheet("More");
    const sum = summarizeSheetDiff(before, a.state);
    expect(sum.added).toBe(1);
    expect(sum.lines).toContain("Sheet Data: 2 cells changed");
    expect(sum.lines).toContain("Sheet More added");
  });
});
