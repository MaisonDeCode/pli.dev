import { createEditorSession, type EditorSession } from "@pli.dev/core";
import type { PdfDoc } from "./model";
import type { PdfOp } from "./ops";
import type { PdfSession, PdfSelection } from "./session";
import { pdfSyncModel } from "./sync";

/**
 * A PDF session as the editor-neutral `EditorSession`: the same calls as a document, a sheet or a deck. `transact` is the
 * PDF session's own (it keeps the selection with each undo step).
 */
export function pdfEditorSession(session: PdfSession): EditorSession<PdfDoc, PdfOp, PdfSelection> {
  return createEditorSession<PdfDoc, PdfOp, PdfSelection>({
    kind: "pdf",
    core: session.core,
    model: pdfSyncModel,
    transact: (ops, options) => session.transact(ops, options),
    comments: {
      get: () => session.comments.client,
      enable: (options) => session.comments.enable({ ...options, store: options.store ?? "document" }),
    },
  });
}
