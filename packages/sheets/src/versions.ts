import { VersionHistory, type AutoSaveOptions, type DiffSummary, type Users, type VersionStorage, type VersionSupport } from "@pli.dev/core";
import type { Workbook } from "./model";
import { deepEqual, diffWorkbooks } from "./ops-diff";
import type { SheetOp } from "./ops";
import type { SheetSession } from "./session";
import { sheetSyncModel } from "./sync";

/**
 * The operations that turn `current` into `target`, for `VersionHistory.restore`: sheets that were added or deleted since,
 * renamed and reordered sheets, every cell, size, merge, rule, table and object that differs. They are ordinary operations, so a
 * restore is one undoable step that is sent to everyone like any other edit. Comment threads are left as they are now (a
 * restore brings back the cells, not the conversation about them); a cell that carried a thread keeps the thread's marker only
 * while the thread exists. When the difference can't be told in smaller operations the whole workbook is put back.
 */
export function restoreSheetOps(current: Workbook, target: Workbook): SheetOp[] {
  // Threads are not part of what a version brings back.
  const wanted: Workbook = { ...target };
  if (current.comments) wanted.comments = current.comments;
  else delete wanted.comments;
  const ops = diffWorkbooks(current, wanted);
  return ops ?? [{ type: "restore", workbook: wanted }];
}

/** Counts what differs between two workbooks: sheets added and removed, cells changed per sheet, and what else changed. */
export function summarizeSheetDiff(from: Workbook, to: Workbook): DiffSummary {
  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  const before = new Map(from.sheets.map((s) => [s.id, s]));
  const after = new Map(to.sheets.map((s) => [s.id, s]));
  for (const s of to.sheets) if (!before.has(s.id)) {
    added++;
    lines.push(`Sheet ${s.name} added`);
  }
  for (const s of from.sheets) if (!after.has(s.id)) {
    removed++;
    lines.push(`Sheet ${s.name} removed`);
  }
  for (const s of to.sheets) {
    const was = before.get(s.id);
    if (!was) continue;
    if (was.name !== s.name) {
      changed++;
      lines.push(`Sheet ${was.name} renamed ${s.name}`);
    }
    let cells = 0;
    for (const key of new Set([...Object.keys(was.cells), ...Object.keys(s.cells)])) if (!deepEqual(was.cells[key], s.cells[key])) cells++;
    if (cells) {
      changed += cells;
      lines.push(`Sheet ${s.name}: ${cells} ${cells === 1 ? "cell" : "cells"} changed`);
    }
    const others = (["charts", "images", "conditional", "validations", "tables", "pivots", "merges", "sparklines", "slicers", "timelines", "columns", "rows", "filter", "frozen", "page"] as const).filter((k) => !deepEqual(was[k], s[k]));
    if (others.length) {
      changed += others.length;
      lines.push(`Sheet ${s.name}: ${others.join(", ")} changed`);
    }
  }
  if (from.title !== to.title) {
    changed++;
    lines.push(`Title changed to ${to.title}`);
  }
  if (!deepEqual(from.names, to.names)) {
    changed++;
    lines.push("Defined names changed");
  }
  return { added, removed, changed, lines };
}

/** What `VersionHistory` needs of Sheets: `new VersionHistory({ ..., support: sheetVersionSupport, hash: sheetSyncModel.hash })`. */
export const sheetVersionSupport: VersionSupport<Workbook, SheetOp> = { restoreOps: restoreSheetOps, summarize: summarizeSheetDiff };

export interface SheetVersionHistoryOptions {
  /** Where versions are kept. */
  storage: VersionStorage<Workbook>;
  /** Who is signed in and what they may do: saving and restoring need the `editor` role. */
  users: Users;
  /** The id the versions are kept under. Default: the workbook's id. */
  file?: string;
  /** The position in the shared log, for a shared file: `() => sync.version`. */
  version?: () => number | null;
  /** Keep the workbook as it was before each restore as a version of its own (default true). */
  keepBeforeRestore?: boolean;
  /** Keep the restore itself as a version, so it shows in the list in its place in time (default true). */
  keepAfterRestore?: boolean;
  /** Keep a version now and then without anyone asking, so the history shows how the workbook changed. */
  autoSave?: AutoSaveOptions;
  now?: () => number;
}

/**
 * A `VersionHistory` for a sheet session, with `sheetVersionSupport`. A restore is one undoable step, and with live editing it
 * reaches everyone as an ordinary change.
 *
 *     const history = sheetVersionHistory(session, { storage, users });
 *     await history.save("Sent to the board");
 *     await history.restore(history.versions[0].id);
 */
export function sheetVersionHistory(session: SheetSession, options: SheetVersionHistoryOptions): VersionHistory<Workbook, SheetOp> {
  return new VersionHistory<Workbook, SheetOp>({
    file: options.file ?? session.state.id,
    session: {
      get state() {
        return session.state;
      },
      transact: (ops) => session.transact(ops),
      subscribe: (listener) => session.subscribe(listener),
    },
    storage: options.storage,
    users: options.users,
    support: sheetVersionSupport,
    hash: sheetSyncModel.hash,
    version: options.version,
    keepBeforeRestore: options.keepBeforeRestore,
    keepAfterRestore: options.keepAfterRestore,
    autoSave: options.autoSave,
    now: options.now,
  });
}
