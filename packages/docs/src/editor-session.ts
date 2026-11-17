import { createEditorSession, type EditorSession } from "@pli.dev/core";
import type { Doc } from "./model";
import type { DocOp } from "./ops";
import type { Selection } from "./selection";
import type { DocumentSession } from "./session";
import { docSyncModel } from "./sync";

/**
 * A document session as the editor-neutral `EditorSession` every Pli editor offers: transact, undo, subscribe, serialize,
 * comments, `attachSync` and a script host, the same calls for a sheet, a deck or a PDF. The document session itself is
 * the core session, so nothing is wrapped: this is a view of it.
 */
export function documentEditorSession(session: DocumentSession): EditorSession<Doc, DocOp, Selection | null> {
  return createEditorSession<Doc, DocOp, Selection | null>({
    kind: "document",
    core: session,
    model: docSyncModel,
    comments: {
      get: () => session.comments,
      // A document keeps its threads in the file unless a store is given; when shared, highlights are ordinary changes.
      enable: (options) => session.enableComments({ ...options, store: options.store ?? "document" }),
    },
  });
}
