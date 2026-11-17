import { createId } from "./ids";
import { PliError } from "./errors";
import { canonicalJson } from "./hash";
import type { DocumentStore } from "./document-store";
import type { StoredDocument, SyncModel } from "./sync";
import type { Users } from "./users";

/**
 * Named versions: "Budget as sent to the board". A version is a copy of the whole state with a name, who saved it and
 * when; restoring one is an ordinary edit (a list of operations), so it is undoable, merged with what other people are
 * doing, and sent to everyone like any other change. Where versions are kept is up to you (`VersionStorage`); the sequencer
 * side (`stateAtVersion`, `versionFromStore`) reads the same shared document your `DocumentStore` holds.
 */

export interface NamedVersion<State = unknown> {
  id: string;
  name: string;
  /** Milliseconds since 1970. */
  at: number;
  /** The `PliUser.id` who saved it. */
  by: string;
  /** The position in the shared log when it was saved, for a shared file. */
  version?: number;
  /** A fingerprint of `state`. */
  hash: string;
  /** Free text the author added. */
  note?: string;
  /** Set on a version Pli made itself (before a restore) rather than a person. */
  automatic?: boolean;
  /** The whole state, as plain JSON. */
  state: State;
}

/** Where versions are kept. Implement it over a table, an object store, a folder of files. */
export interface VersionStorage<State = unknown> {
  list(file: string): NamedVersion<State>[] | Promise<NamedVersion<State>[]>;
  get(file: string, id: string): NamedVersion<State> | undefined | Promise<NamedVersion<State> | undefined>;
  save(file: string, version: NamedVersion<State>): void | Promise<void>;
  remove(file: string, id: string): void | Promise<void>;
}

/** Keeps versions in memory, copied as if they had been through a database. For tests and demos. */
export function memoryVersionStorage<State = unknown>(): VersionStorage<State> & { count(file: string): number } {
  const files = new Map<string, Map<string, NamedVersion<State>>>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const of = (file: string) => {
    let found = files.get(file);
    if (!found) files.set(file, (found = new Map()));
    return found;
  };
  return {
    count: (file) => of(file).size,
    list: (file) => [...of(file).values()].map(clone),
    get: (file, id) => {
      const found = of(file).get(id);
      return found ? clone(found) : undefined;
    },
    save: (file, version) => void of(file).set(version.id, clone(version)),
    remove: (file, id) => void of(file).delete(id),
  };
}

/** A short account of what differs between two states. */
export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  /** Sentences for a person: "3 paragraphs changed", "Sheet Budget: 12 cells changed". */
  lines: string[];
}

/** What an editor tells the version history about its own state. */
export interface VersionSupport<State, Op> {
  /** Operations that turn `current` into `target`. They are applied as one undoable step. */
  restoreOps(current: State, target: State): Op[];
  /** Says what differs, for the history panel's "what changed since this version". */
  summarize?(from: State, to: State): DiffSummary;
}

export interface VersionHistoryOptions<State, Op> {
  /** The file the versions belong to. */
  file: string;
  /** What the history works on: any editor session. */
  session: { readonly state: State; transact(ops: readonly Op[]): void };
  storage: VersionStorage<State>;
  users: Users;
  support: VersionSupport<State, Op>;
  /** A fingerprint of a state: the editor's `SyncModel.hash`. */
  hash: (state: State) => string;
  /** The current position in the shared log, if the file is shared (`SyncClient.version`). */
  version?: () => number | null;
  /** Save a version named "Before restoring ..." before each restore, so a restore can itself be taken back. Default true. */
  keepBeforeRestore?: boolean;
  now?: () => number;
}

type Listener = () => void;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The named versions of one file. Saving and restoring need an editor's role.
 *
 *     const history = new VersionHistory({ file, session, storage, users, support, hash });
 *     await history.save("Sent to the board");
 *     await history.restore(version.id);       // one undoable step
 */
export class VersionHistory<State, Op> {
  readonly #options: VersionHistoryOptions<State, Op>;
  #versions: NamedVersion<State>[] = [];
  #listeners = new Set<Listener>();
  #status: "loading" | "ready" | "error" = "loading";
  #ready: Promise<void>;

  constructor(options: VersionHistoryOptions<State, Op>) {
    this.#options = options;
    this.#ready = this.reload();
  }

  /** Who is using the file: the directory that names the authors of versions. */
  get users(): Users {
    return this.#options.users;
  }

  /** Resolves when the stored versions have loaded. */
  get ready(): Promise<void> {
    return this.#ready;
  }

  get status(): "loading" | "ready" | "error" {
    return this.#status;
  }

  /** The versions, newest first. */
  get versions(): readonly NamedVersion<State>[] {
    return this.#versions;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Whether the current user may save and restore versions (editors only, by default). */
  get canEdit(): boolean {
    return !!this.#options.users.current && this.#options.users.role === "editor";
  }

  /** Loads the stored versions again. */
  reload(): Promise<void> {
    this.#status = "loading";
    this.#emit();
    this.#ready = Promise.resolve(this.#options.storage.list(this.#options.file)).then(
      (list) => {
        this.#versions = [...list].sort((a, b) => b.at - a.at);
        this.#status = "ready";
        this.#emit();
      },
      () => {
        this.#status = "error";
        this.#emit();
      },
    );
    return this.#ready;
  }

  /** Saves the state as it is now under a name. */
  async save(name: string, options: { note?: string; automatic?: boolean } = {}): Promise<NamedVersion<State>> {
    const user = this.#need("save a version");
    const trimmed = name.trim();
    if (!trimmed) throw new PliError("invalid_operation", "A version needs a name");
    const state = clone(this.#options.session.state);
    const version = this.#options.version?.();
    const saved: NamedVersion<State> = {
      id: createId("ver_"),
      name: trimmed,
      at: (this.#options.now ?? Date.now)(),
      by: user,
      ...(typeof version === "number" ? { version } : {}),
      hash: this.#options.hash(state),
      ...(options.note ? { note: options.note } : {}),
      ...(options.automatic ? { automatic: true } : {}),
      state,
    };
    await this.#options.storage.save(this.#options.file, saved);
    this.#versions = [saved, ...this.#versions].sort((a, b) => b.at - a.at);
    this.#emit();
    return saved;
  }

  /**
   * Puts the file back as it was in a version, as one undoable change that is sent to everyone like any other. The state
   * before the restore is kept as a version of its own unless `keepBeforeRestore` is false.
   */
  async restore(id: string): Promise<NamedVersion<State>> {
    this.#need("restore a version");
    const target = this.#versions.find((v) => v.id === id) ?? (await this.#options.storage.get(this.#options.file, id));
    if (!target) throw new PliError("not_found", `No version "${id}"`);
    const current = this.#options.session.state;
    if (this.#options.keepBeforeRestore !== false && this.#options.hash(current) !== target.hash) {
      await this.save(`Before restoring "${target.name}"`, { automatic: true });
    }
    const ops = this.#options.support.restoreOps(clone(this.#options.session.state), clone(target.state));
    if (ops.length > 0) this.#options.session.transact(ops);
    return target;
  }

  /** Deletes a version. */
  async remove(id: string): Promise<void> {
    this.#need("delete a version");
    await this.#options.storage.remove(this.#options.file, id);
    this.#versions = this.#versions.filter((v) => v.id !== id);
    this.#emit();
  }

  /** What differs between a version and the file now. Empty lines when the editor has no `summarize`. */
  compare(id: string): DiffSummary {
    const version = this.#versions.find((v) => v.id === id);
    if (!version) throw new PliError("not_found", `No version "${id}"`);
    return this.#options.support.summarize?.(version.state, this.#options.session.state) ?? { added: 0, removed: 0, changed: 0, lines: [] };
  }

  #need(what: string): string {
    const user = this.#options.users.current;
    if (!user) throw new PliError("invalid_operation", `Sign in to ${what}`);
    if (this.#options.users.role !== "editor") throw new PliError("invalid_operation", `Only editors may ${what}`);
    return user.id;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

// ---- From the sequencer ---------------------------------------------------------------------------------------

/** The document of a room as the sequencer has it now: the store's snapshot with the log since it applied. Null if the room has none. */
export async function currentFromStore<State, Op>(store: DocumentStore<State, Op>, model: SyncModel<State, Op>, room: string): Promise<StoredDocument<State> | null> {
  const snapshot = await store.load(room);
  if (!snapshot) return null;
  const entries = (await store.entries(room, snapshot.version)) ?? [];
  const state = entries.reduce((s, e) => e.ops.reduce((x, op) => model.apply(x, op), s), snapshot.state);
  return { state, version: entries[entries.length - 1]?.version ?? snapshot.version };
}

/**
 * The document as it was at `version`, replayed from the store's snapshot and log. Null when the store no longer has the
 * entries that lead there (the log was trimmed past it), or the version is in the future.
 */
export async function stateAtVersion<State, Op>(store: DocumentStore<State, Op>, model: SyncModel<State, Op>, room: string, version: number): Promise<State | null> {
  const snapshot = await store.load(room);
  if (!snapshot || snapshot.version > version) return null;
  const entries = (await store.entries(room, snapshot.version)) ?? [];
  const upTo = entries.filter((e) => e.version <= version);
  if ((upTo[upTo.length - 1]?.version ?? snapshot.version) !== version) return null;
  return upTo.reduce((s, e) => e.ops.reduce((x, op) => model.apply(x, op), s), snapshot.state);
}

/**
 * Saves a named version of a room straight from the sequencer's store, with no editor open: what a server does for
 * "save version" from an admin screen or a schedule. The version records the log position it was taken at.
 */
export async function versionFromStore<State, Op>(options: {
  store: DocumentStore<State, Op>;
  model: SyncModel<State, Op>;
  storage: VersionStorage<State>;
  room: string;
  /** The file id the versions are kept under. Defaults to the room. */
  file?: string;
  name: string;
  by: string;
  note?: string;
  now?: () => number;
}): Promise<NamedVersion<State>> {
  const current = await currentFromStore(options.store, options.model, options.room);
  if (!current) throw new PliError("not_found", `No document for room "${options.room}"`);
  const saved: NamedVersion<State> = {
    id: createId("ver_"),
    name: options.name,
    at: (options.now ?? Date.now)(),
    by: options.by,
    version: current.version,
    hash: options.model.hash(current.state),
    ...(options.note ? { note: options.note } : {}),
    state: clone(current.state),
  };
  await options.storage.save(options.file ?? options.room, saved);
  return saved;
}

/** The serialized form of a version's state, for an export or a diff tool. */
export const versionJson = (version: NamedVersion): string => canonicalJson(version.state);
