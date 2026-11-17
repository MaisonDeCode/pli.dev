import { hashState, type SyncModel } from "@pli.dev/core";
import type { Doc } from "./model";
import { docReducer, type DocOp } from "./ops";
import { mapSelection, type Selection } from "./selection";
import { rebase, transformOps } from "./transform";

/** A short fingerprint of a document (FNV-1a over its canonical JSON, with its length). Equal documents have equal fingerprints. */
export const hashDoc = (doc: Doc): string => hashState(doc);

/**
 * How document operations combine, for `SyncClient` and `createAuthority`:
 *
 *     const sync = new SyncClient({ session, room, model: docSyncModel });
 *     const authority = createAuthority({ store, model: docSyncModel });
 */
export const docSyncModel: SyncModel<Doc, DocOp> = {
  apply: (doc, op) => docReducer.apply(doc, op).state,
  transform: transformOps,
  rebase,
  // Selections kept with undo steps, and other people's cursors, follow their text.
  mapMeta: (selection: Selection | null, ops) => (selection ? mapSelection(selection, ops) : selection),
  mapPresence: (state, ops) => {
    const selection = state.selection as Selection | null | undefined;
    if (!selection) return state;
    const moved = mapSelection(selection, ops);
    return moved === selection ? state : { ...state, selection: moved };
  },
  hash: hashDoc,
};
