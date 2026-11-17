import { PliError } from "./errors";
import type { DocumentStore } from "./document-store";
import { SERVER_CLIENT, SYNC_KIND, type ClientSync, type LogEntry, type ServerSync, type StoredDocument, type SyncModel } from "./sync";

export interface AuthorityOptions<State, Op> {
  store: DocumentStore<State, Op>;
  model: SyncModel<State, Op>;
  /** Makes the document for a room that has none yet. Without it, a room has to exist before anyone joins. */
  create?: (room: string) => State | Promise<State>;
  /** Decides whether a client may do what it asks (join, change the document). Return false to refuse. */
  authorize?: (request: { room: string; client: string; message: ClientSync }) => boolean | Promise<boolean>;
  /** Save a snapshot every this many entries. Default 100. */
  snapshotEvery?: number;
  /** A client more than this many entries behind is sent a snapshot instead. Default 500. */
  maxCatchUp?: number;
  /** Called when something unexpected went wrong. The client that caused it is told to reload. */
  onError?: (error: unknown, room: string) => void;
}

export interface Authority {
  /**
   * Handles one message from a room. Call it for every message your server relays, with a function that sends to
   * everyone in the room (including the sender). It returns when the message has been dealt with.
   */
  receive(room: string, data: unknown, send: (envelope: unknown) => void): Promise<void>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * The sequencer: it puts the changes of everyone in a room in one order, and keeps them in a `DocumentStore`.
 *
 * It keeps no state that matters. What it holds in memory is a cache of each room's document, checked against the
 * store on every message, so several processes can run it over the same store; when two of them accept a change at
 * once, `DocumentStore.append` lets one win and the other merges again.
 */
export function createAuthority<State, Op>(options: AuthorityOptions<State, Op>): Authority {
  const { store, model } = options;
  const snapshotEvery = options.snapshotEvery ?? 100;
  const maxCatchUp = options.maxCatchUp ?? 500;
  const cache = new Map<string, StoredDocument<State>>();
  // Messages for one room are dealt with one at a time, in the order they came.
  const queues = new Map<string, Promise<void>>();

  const replay = (state: State, entries: readonly LogEntry<Op>[]): State => entries.reduce((s, e) => e.ops.reduce((x, op) => model.apply(x, op), s), state);

  async function rebuild(room: string): Promise<StoredDocument<State>> {
    let snapshot = await store.load(room);
    if (!snapshot) {
      if (!options.create) throw new PliError("not_found", `No document for room "${room}"`);
      snapshot = { state: await options.create(room), version: 0 };
      await store.save(room, snapshot);
    }
    const entries = (await store.entries(room, snapshot.version)) ?? [];
    return { state: replay(snapshot.state, entries), version: entries[entries.length - 1]?.version ?? snapshot.version };
  }

  /** The room's document as it is now, which may include entries other processes added. */
  async function head(room: string): Promise<StoredDocument<State>> {
    const cached = cache.get(room);
    if (!cached) {
      const fresh = await rebuild(room);
      cache.set(room, fresh);
      return fresh;
    }
    const newer = await store.entries(room, cached.version);
    if (newer === null) {
      const fresh = await rebuild(room);
      cache.set(room, fresh);
      return fresh;
    }
    if (newer.length === 0) return cached;
    try {
      const next = { state: replay(cached.state, newer), version: newer[newer.length - 1]!.version };
      cache.set(room, next);
      return next;
    } catch {
      const fresh = await rebuild(room);
      cache.set(room, fresh);
      return fresh;
    }
  }

  const envelope = (data: ServerSync) => ({ v: 1, client: SERVER_CLIENT, message: { type: "custom", kind: SYNC_KIND, data } });

  async function handle(room: string, client: string, message: ClientSync, send: (envelope: unknown) => void): Promise<void> {
    const tell = (data: ServerSync) => send(envelope(data));
    const resync = (reason: string) => tell({ type: "resync", to: client, reason });
    if (options.authorize && !(await options.authorize({ room, client, message }))) return resync("not allowed");

    if (message.type === "join") {
      const current = await head(room);
      const have = message.have;
      const entries = typeof have === "number" && have >= 0 && have <= current.version ? await store.entries(room, have) : null;
      if (entries === null || entries.length > maxCatchUp) {
        tell({ type: "snapshot", to: client, version: current.version, state: current.state });
      } else {
        tell({ type: "caught_up", to: client, version: current.version, entries });
      }
      return;
    }

    if (message.type === "hash") {
      const current = await head(room);
      if (current.version === message.version && model.hash(current.state) !== message.hash) resync("your document differs from the server's");
      return;
    }

    // Changes from a client.
    const base = message.base;
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await head(room);
      if (!Number.isInteger(base) || base < 0 || base > current.version) return resync("unknown version");
      const since = await store.entries(room, base);
      if (since === null) return resync("too far behind");
      // Another process added an entry between the two reads: look again, so both are of the same moment.
      if (base + since.length !== current.version) continue;
      // A batch sent twice (after a reconnect) is accepted once.
      const again = since.find((e) => e.client === client && e.batch === message.batch);
      if (again) return tell({ type: "entry", ...again });

      const [merged] = model.transform(message.ops as Op[], since.flatMap((e) => e.ops));
      let state = current.state;
      const applied: Op[] = [];
      let dropped = false;
      for (const op of merged) {
        try {
          state = model.apply(state, op);
          applied.push(op);
        } catch (error) {
          // Something it works on is gone. Anything else means the change is wrong, and is refused.
          if (error instanceof PliError && error.code === "not_found") dropped = true;
          else throw error;
        }
      }
      const entry: LogEntry<Op> = { version: current.version + 1, client, batch: message.batch, ops: applied, ...(dropped ? { dropped: true } : {}) };
      if (await store.append(room, entry)) {
        cache.set(room, { state, version: entry.version });
        tell({ type: "entry", ...entry });
        if (entry.version % snapshotEvery === 0) await store.save(room, { state, version: entry.version });
        return;
      }
      // Someone else got there first. Look again and merge with their change too.
    }
    resync("too busy");
  }

  return {
    receive(room, data, send) {
      const env = data as { v?: unknown; client?: unknown; message?: unknown } | null;
      if (!isObject(env) || env.v !== 1 || typeof env.client !== "string" || env.client === SERVER_CLIENT) return Promise.resolve();
      const message = env.message;
      if (!isObject(message) || message.type !== "custom" || message.kind !== SYNC_KIND || !isObject(message.data)) return Promise.resolve();
      const sync = message.data as unknown as ClientSync;
      const valid =
        (sync.type === "join" && (sync.have === null || Number.isInteger(sync.have))) ||
        (sync.type === "ops" && typeof sync.batch === "string" && Array.isArray(sync.ops) && typeof sync.base === "number") ||
        (sync.type === "hash" && typeof sync.hash === "string" && typeof sync.version === "number");
      if (!valid) return Promise.resolve();
      const client = env.client;
      const previous = queues.get(room) ?? Promise.resolve();
      const next = previous.then(() =>
        handle(room, client, sync, send).catch((error) => {
          options.onError?.(error, room);
          // The cache may be behind or wrong after a failure.
          cache.delete(room);
          send(envelope({ type: "resync", to: client, reason: "error" }));
        }),
      );
      queues.set(room, next);
      return next;
    },
  };
}
