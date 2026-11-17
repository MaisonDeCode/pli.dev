import { createEditorSession, type EditorSession } from "@pli.dev/core";
import type { Workbook } from "./model";
import type { SheetOp } from "./ops";
import type { SheetSession } from "./session";
import { sheetSyncModel } from "./sync";

/**
 * A sheet session as the editor-neutral `EditorSession` (the same calls as a document, a deck or a PDF): scripts, the shared
 * toolbar, `attachSync` and a server's registry work with it unchanged. `transact` is the sheet session's own, which stamps
 * what merging needs; comments are reported once `session.comments.enable` was called.
 */
export function sheetEditorSession(session: SheetSession): EditorSession<Workbook, SheetOp, undefined> {
  const editor = createEditorSession<Workbook, SheetOp, undefined>({
    kind: "sheet",
    core: session.core,
    model: sheetSyncModel,
    transact: (ops, options) => session.transact(ops, { ...(options?.merge ? { merge: true } : {}), ...(options?.history === false ? { history: false as const } : {}) }),
    comments: {
      get: () => session.comments.client,
      enable: (options) => session.comments.enable({ ...options, store: options.store ?? "document" }),
    },
  });
  return editor;
}

/** The editor definition a server registers so it can serve sheet rooms: `registry.register(sheetEditor)`. */
export const sheetEditor = {
  kind: "sheet",
  model: sheetSyncModel,
  create: (room: string): Workbook => ({ id: room, type: "workbook", title: "Untitled", sheets: [{ id: "sheet_1", name: "Sheet1", cells: {} }] }),
};
