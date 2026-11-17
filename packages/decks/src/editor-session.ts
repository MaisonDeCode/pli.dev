import { commentsPart, createEditorSession, type EditorSession } from "@pli.dev/core";
import type { Deck } from "./model";
import type { DeckOp } from "./ops";
import type { DeckSelection, DeckSession } from "./session";
import { deckSyncModel } from "./sync";

/**
 * A deck session as the editor-neutral `EditorSession` (the same calls as a document, a sheet or a PDF). `transact` is the
 * deck session's own, which tidies animations of removed elements. Comments are offered once the deck session has
 * `comments` and `enableComments`.
 */
export function deckEditorSession(session: DeckSession): EditorSession<Deck, DeckOp, DeckSelection> {
  return createEditorSession<Deck, DeckOp, DeckSelection>({
    kind: "deck",
    core: session.core,
    model: deckSyncModel,
    transact: (ops, options) => session.transact(ops, options),
    comments: commentsPart(session),
  });
}
