import type { LogEntry, StoredDocument } from "./sync";

/**
 * Where a shared document is kept: a snapshot, and the log of changes since it. Implement it over a table, a Redis
 * list, a file; the sequencer holds nothing of its own, so any number of server processes can use the same store.
 *
 * The one thing it must get right is `append`, which is a compare-and-set: it only succeeds if no one else has added
 * an entry first. A SQL `INSERT` with a unique key on `(room, version)`, or a Redis `WATCH`/`MULTI`, does it.
 */
export interface DocumentStore<State, Op> {
  /** The latest snapshot of a room's document, or null if the room has none yet. */
  load(room: string): Promise<StoredDocument<State> | null>;
  /**
   * The entries with a `version` above `since`, oldest first. Return null if you no longer have them (the log was
   * trimmed past `since`): the client is then sent a snapshot instead.
   */
  entries(room: string, since: number): Promise<LogEntry<Op>[] | null>;
  /**
   * Adds an entry, but only if the log is at `entry.version - 1`. Returns false (and adds nothing) if someone
   * else got there first: the sequencer then merges again and tries the next version.
   */
  append(room: string, entry: LogEntry<Op>): Promise<boolean>;
  /**
   * Saves a snapshot at a version, now and then, so the log doesn't have to be replayed from the start. You may
   * delete the entries up to that version afterwards, or keep them for history.
   */
  save(room: string, snapshot: StoredDocument<State>): Promise<void>;
}

/** Keeps documents in memory, copied as if they had been through a database. For tests and demos. */
export function memoryDocumentStore<State, Op>(options: { keepEntries?: number } = {}): DocumentStore<State, Op> & { head(room: string): number } {
  const rooms = new Map<string, { snapshot: StoredDocument<State> | null; log: LogEntry<Op>[] }>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const room = (name: string) => {
    let found = rooms.get(name);
    if (!found) rooms.set(name, (found = { snapshot: null, log: [] }));
    return found;
  };
  const headOf = (r: { snapshot: StoredDocument<State> | null; log: LogEntry<Op>[] }) => r.log[r.log.length - 1]?.version ?? r.snapshot?.version ?? 0;
  return {
    head: (name) => headOf(room(name)),
    async load(name) {
      const snapshot = room(name).snapshot;
      return snapshot ? clone(snapshot) : null;
    },
    async entries(name, since) {
      const r = room(name);
      const first = r.log[0]?.version;
      // Trimmed past what was asked for.
      if (first !== undefined && first > since + 1) return null;
      if (first === undefined && (r.snapshot?.version ?? 0) > since) return null;
      return clone(r.log.filter((e) => e.version > since));
    },
    async append(name, entry) {
      const r = room(name);
      if (headOf(r) !== entry.version - 1) return false;
      r.log.push(clone(entry));
      return true;
    },
    async save(name, snapshot) {
      const r = room(name);
      r.snapshot = clone(snapshot);
      if (options.keepEntries !== undefined) r.log = r.log.filter((e) => e.version > snapshot.version - options.keepEntries!);
    },
  };
}
