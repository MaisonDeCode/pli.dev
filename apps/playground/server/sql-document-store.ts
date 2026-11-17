import type { DocumentStore, LogEntry, StoredDocument } from "@pli.dev/docs";

/** The part of a database connection this store uses. `node:sqlite`'s `DatabaseSync` has it; so does `better-sqlite3`. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint };
  };
}

/** The tables the store needs. Run it once. The same statements work in Postgres with `jsonb` for `state` and `ops`. */
export const SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS pli_snapshots (
  room    TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pli_entries (
  room    TEXT NOT NULL,
  version INTEGER NOT NULL,
  client  TEXT NOT NULL,
  batch   TEXT NOT NULL,
  ops     TEXT NOT NULL,
  dropped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room, version)
);`;

/**
 * A `DocumentStore` over two SQL tables: the latest snapshot of each room's document, and the log of accepted changes.
 *
 * The one thing a store must get right is `append`: an entry for version `n` goes in only if the log is at `n - 1`.
 * Here that is a single `INSERT … SELECT … WHERE` guarded by the table's primary key, so two server processes that
 * race can't both succeed. With Postgres, write the same statement with `$1…` parameters and `await` each call.
 */
export function sqlDocumentStore<State, Op>(db: SqlDatabase, options: { keepEntries?: number } = {}): DocumentStore<State, Op> {
  db.exec(SQL_SCHEMA);
  const loadSnapshot = db.prepare("SELECT state, version FROM pli_snapshots WHERE room = ?");
  const saveSnapshot = db.prepare("INSERT INTO pli_snapshots (room, version, state) VALUES (?, ?, ?) ON CONFLICT (room) DO UPDATE SET version = excluded.version, state = excluded.state");
  const entriesAfter = db.prepare("SELECT version, client, batch, ops, dropped FROM pli_entries WHERE room = ? AND version > ? ORDER BY version");
  const snapshotVersion = db.prepare("SELECT version FROM pli_snapshots WHERE room = ?");
  const pruneBefore = db.prepare("DELETE FROM pli_entries WHERE room = ? AND version <= ?");
  // `?1` is the room and `?2` the new version. The row goes in only if the log's head is the version before it.
  const append = db.prepare(`
    INSERT INTO pli_entries (room, version, client, batch, ops, dropped)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6
    WHERE COALESCE((SELECT MAX(version) FROM pli_entries WHERE room = ?1), (SELECT version FROM pli_snapshots WHERE room = ?1), 0) = ?2 - 1
    ON CONFLICT DO NOTHING`);

  return {
    async load(room): Promise<StoredDocument<State> | null> {
      const row = loadSnapshot.get(room) as { state: string; version: number } | undefined;
      return row ? { state: JSON.parse(row.state) as State, version: Number(row.version) } : null;
    },

    async entries(room, since): Promise<LogEntry<Op>[] | null> {
      const rows = entriesAfter.all(room, since) as { version: number; client: string; batch: string; ops: string; dropped: number }[];
      // Trimmed past what was asked for: say so, and the client is sent the snapshot instead.
      if (rows.length > 0 && Number(rows[0]!.version) > since + 1) return null;
      if (rows.length === 0) {
        const snap = snapshotVersion.get(room) as { version: number } | undefined;
        if (snap && Number(snap.version) > since) return null;
      }
      return rows.map((row) => ({
        version: Number(row.version),
        client: row.client,
        batch: row.batch,
        ops: JSON.parse(row.ops) as Op[],
        ...(row.dropped ? { dropped: true } : {}),
      }));
    },

    async append(room, entry) {
      const result = append.run(room, entry.version, entry.client, entry.batch, JSON.stringify(entry.ops), entry.dropped ? 1 : 0);
      return Number(result.changes) === 1;
    },

    async save(room, snapshot) {
      saveSnapshot.run(room, snapshot.version, JSON.stringify(snapshot.state));
      // The log before a snapshot is only needed for history; drop it, keeping a little for clients that are slightly behind.
      if (options.keepEntries !== undefined) pruneBefore.run(room, snapshot.version - options.keepEntries);
    },
  };
}
