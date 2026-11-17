/**
 * Live co-editing, in a form every editor can use. An editor says how its operations combine (a `SyncModel`); the
 * rest is the same for documents, sheets and decks: a sequencer on your server (`createAuthority`) puts operations in
 * one order and keeps them in a `DocumentStore`, and each client (`SyncClient`) keeps its own changes up to date
 * with that order.
 *
 * Everything here is plain JSON on the wire, over the same `Transport` as presence and comments.
 */

/** What an editor supplies so that its operations can be merged. */
export interface SyncModel<State, Op> {
  /** Applies one operation. Throws `PliError` with code `not_found` when the thing it works on is gone. */
  apply(state: State, op: Op): State;
  /**
   * Transforms two lists of operations made from the same state. `earlier` was accepted first. Returns `later` as it
   * must be applied after `earlier`, and `earlier` as it must be applied after `later`, so that both orders give
   * the same state.
   */
  transform(later: readonly Op[], earlier: readonly Op[]): [Op[], Op[]];
  /**
   * What a client does when something the server accepted arrives while it has changes of its own: those in
   * flight (sent, not yet accepted) and those waiting, written on top of them. Omit it to use `transform` for each.
   */
  rebase?(inflight: readonly Op[], pending: readonly Op[], incoming: readonly Op[]): { inflight: Op[]; pending: Op[]; incoming: Op[] };
  /**
   * Moves the editor state kept with undo steps (usually the selection) through operations that were applied
   * to the document. Omit it if nothing is kept.
   */
  mapMeta?(meta: any, ops: readonly Op[]): any;
  /**
   * Moves what other people have shared about themselves (their cursor, in presence) through operations that were
   * applied to the document, so a cursor stays with its text until they move it.
   */
  mapPresence?(state: Record<string, unknown>, ops: readonly Op[]): Record<string, unknown>;
  /** A short fingerprint of a state, which two equal states share. Clients send it now and then to catch a difference nobody noticed. */
  hash(state: State): string;
}

/** One accepted batch of operations, in the order of the shared history. */
export interface LogEntry<Op> {
  /** 1 for the first entry. The document is at version `n` after entry `n`. */
  version: number;
  /** The connection that made the change (`CollabRoom.client`). */
  client: string;
  /** Names the client's batch, so a batch sent twice is accepted once. */
  batch: string;
  /** The operations as accepted: already merged with what came before. */
  ops: Op[];
  /** True if some operation could not be applied and was left out. The client that made it reloads. */
  dropped?: boolean;
}

/** A whole document and the version it is at. */
export interface StoredDocument<State> {
  state: State;
  version: number;
}

/** What a client sends the sequencer. */
export type ClientSync =
  /** Asks to be brought up to date. `have` is the version the client has, or null for none. */
  | { type: "join"; have: number | null }
  /** A batch of changes made from the document at `base`. */
  | { type: "ops"; batch: string; base: number; ops: unknown[] }
  /** The client's fingerprint of the document at `version`. */
  | { type: "hash"; version: number; hash: string };

/** What the sequencer sends. Messages with `to` are for one client; everyone else ignores them. */
export type ServerSync =
  | { type: "entry"; version: number; client: string; batch: string; ops: unknown[]; dropped?: boolean }
  | { type: "snapshot"; to: string; version: number; state: unknown }
  | { type: "caught_up"; to: string; version: number; entries: { version: number; client: string; batch: string; ops: unknown[]; dropped?: boolean }[] }
  /** Reload from a snapshot. */
  | { type: "resync"; to: string; reason: string };

export type SyncMessage = ClientSync | ServerSync;

/** The kind under which sync messages travel as `custom` room messages. */
export const SYNC_KIND = "sync";
/** The `client` of an envelope sent by the sequencer. */
export const SERVER_CLIENT = "server";

/** A `rebase` made from `transform`: the changes in flight are transformed first, and the waiting ones on top. */
export function rebaseWith<Op>(transform: SyncModel<unknown, Op>["transform"]): NonNullable<SyncModel<unknown, Op>["rebase"]> {
  return (inflight, pending, incoming) => {
    const [inflightOut, afterInflight] = transform(inflight, incoming);
    const [pendingOut, applied] = transform(pending, afterInflight);
    return { inflight: inflightOut, pending: pendingOut, incoming: applied };
  };
}

/**
 * Whether a room message is for the sequencer (a join, a batch of changes, a fingerprint), so a server can pass those
 * to `createAuthority` and relay everything else (presence, comments) to the rest of the room.
 */
export function isSyncMessage(data: unknown): boolean {
  const message = (data as { message?: { type?: unknown; kind?: unknown } } | null)?.message;
  return message?.type === "custom" && message.kind === SYNC_KIND;
}
