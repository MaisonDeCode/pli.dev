import { createId } from "./ids";
import type { CollabRoom } from "./collab";
import type { Session } from "./session";
import { SERVER_CLIENT, SYNC_KIND, rebaseWith, type ClientSync, type ServerSync, type SyncModel } from "./sync";

export type SyncStatus =
  /** Waiting to join, or to hear back. */
  | "connecting"
  /** Everything you did is in the shared document. */
  | "synced"
  /** You have changes the server hasn't taken yet. */
  | "saving"
  /** Not connected; your changes are kept and will be sent when you are. */
  | "offline"
  /** Reloading the document from the server. */
  | "resyncing";

export interface SyncClientOptions<State, Op, Meta> {
  session: Session<State, Op, Meta>;
  /** The room that carries the messages. It must be the same room (and so the same document) the server serves. */
  room: CollabRoom<any>;
  model: SyncModel<State, Op>;
  /**
   * The version of the document the session was loaded at, if you saved it with its version. The server then only
   * sends what has happened since. Without it, the server's copy replaces whatever the session holds.
   */
  version?: number | null;
  /** How often to send a fingerprint of the document to check it against the server's, in ms. Default 30 seconds; 0 for never. */
  verifyEvery?: number;
  /** Called when the session was reloaded from the server, and how many of your changes the server hadn't confirmed (some of them may have reached it). */
  onResync?: (info: { reason: string; lost: number }) => void;
}

/**
 * Keeps a session in step with a shared document. Changes you make are sent to the server one batch at a time and
 * shown at once; changes from other people arrive in the server's order and are merged with yours.
 *
 *     const sync = new SyncClient({ session, room, model });
 *     sync.start();
 *
 * It sends and receives through a `CollabRoom`, so it shares the connection with presence and comments.
 */
export class SyncClient<State, Op, Meta = undefined> {
  #options: SyncClientOptions<State, Op, Meta>;
  #session: Session<State, Op, Meta>;
  #model: SyncModel<State, Op>;
  #rebase: NonNullable<SyncModel<State, Op>["rebase"]>;
  #version: number | null;
  #joined = false;
  /** A join has been sent and not answered yet. */
  #asked = false;
  #started = false;
  #online = true;
  #inflight: { batch: string; ops: Op[] } | null = null;
  #pending: Op[] = [];
  #status: SyncStatus = "connecting";
  #listeners = new Set<() => void>();
  #cleanups: (() => void)[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastResync: { reason: string; lost: number; at: number } | null = null;

  constructor(options: SyncClientOptions<State, Op, Meta>) {
    this.#options = options;
    this.#session = options.session;
    this.#model = options.model;
    this.#rebase = options.model.rebase ?? rebaseWith<Op>(options.model.transform);
    this.#version = options.version ?? null;
  }

  /** The room this client talks through. */
  get room(): CollabRoom<any> {
    return this.#options.room;
  }

  /** The last time the session was reloaded from the server, and how many unconfirmed changes that cost. Null if it hasn't been. */
  get lastResync(): { reason: string; lost: number; at: number } | null {
    return this.#lastResync;
  }

  /** The version of the shared document this client has taken in, or null before it has joined. */
  get version(): number | null {
    return this.#version;
  }

  get status(): SyncStatus {
    return this.#status;
  }

  /** How many of your changes the server hasn't taken yet. */
  get unsynced(): number {
    return (this.#inflight?.ops.length ?? 0) + this.#pending.length;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts listening, and joins as soon as the room is connected. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const { room } = this.#options;
    this.#cleanups.push(
      this.#session.subscribe((event) => {
        // Our own reloads and what we apply from the server aren't changes to send.
        if (event.origin === "remote") return;
        this.#shiftCursors(event.ops);
        this.#pending.push(...event.ops);
        this.#update();
        this.#flush();
      }),
      room.onCustom(SYNC_KIND, (data) => this.#receive(data as ServerSync)),
      room.subscribe(() => {
        if (room.status === "connected" && !this.#joined && this.#online) this.#join();
        else if (room.status === "idle") this.#drop();
      }),
    );
    const every = this.#options.verifyEvery ?? 30_000;
    if (every > 0) this.#timer = setInterval(() => this.#verify(), every);
    if (room.status === "connected" && this.#online) this.#join();
    this.#update();
  }

  stop(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#started = false;
    this.#joined = false;
    this.#asked = false;
  }

  /** Tell it the connection was lost (a socket's `disconnect` event) or came back. Changes made offline are kept and sent later. */
  setOnline(online: boolean): void {
    if (online === this.#online) return;
    this.#online = online;
    if (online) {
      // A moment later, so that whatever else reacts to the connection coming back (a socket telling the server
      // which room it is in) has gone first: the server ignores a join from a connection that isn't in the room.
      void Promise.resolve().then(() => {
        if (this.#online && this.#started && this.#options.room.status === "connected") this.#join();
      });
    } else {
      this.#drop();
    }
    this.#update();
  }

  /** Throws away what this client has and loads the server's document. Unsent changes are lost. */
  resync(reason = "asked to"): void {
    const lost = this.unsynced;
    this.#inflight = null;
    this.#pending = [];
    this.#version = null;
    this.#joined = false;
    this.#asked = false;
    this.#status = "resyncing";
    this.#lastResync = { reason, lost, at: Date.now() };
    this.#emit();
    this.#options.onResync?.({ reason, lost });
    if (this.#online && this.#options.room.status === "connected") this.#join();
  }

  // ---- Sending --------------------------------------------------------------------------------------------

  #send(message: ClientSync): void {
    this.#options.room.sendCustom(SYNC_KIND, message);
  }

  #join(): void {
    if (this.#asked) return;
    this.#joined = false;
    this.#asked = true;
    this.#send({ type: "join", have: this.#version });
    this.#update();
  }

  /** Sends the waiting changes, if nothing is in flight. */
  #flush(): void {
    if (!this.#joined || !this.#online || this.#inflight || this.#pending.length === 0 || this.#version === null) return;
    this.#inflight = { batch: createId("bt_"), ops: this.#pending };
    this.#pending = [];
    this.#send({ type: "ops", batch: this.#inflight.batch, base: this.#version, ops: this.#inflight.ops });
  }

  #verify(): void {
    if (!this.#joined || !this.#online || this.#inflight || this.#pending.length > 0 || this.#version === null) return;
    this.#send({ type: "hash", version: this.#version, hash: this.#model.hash(this.#session.state) });
  }

  /** The connection is gone: what was sent may or may not have arrived, so it is sent again once back. */
  #drop(): void {
    this.#joined = false;
    this.#asked = false;
    this.#update();
  }

  // ---- Receiving ------------------------------------------------------------------------------------------

  #receive(message: ServerSync): void {
    if (!message || typeof message !== "object") return;
    if ("to" in message && message.to !== this.#options.room.client) return;
    switch (message.type) {
      case "snapshot": {
        const lost = this.unsynced;
        this.#version = message.version;
        this.#inflight = null;
        this.#pending = [];
        this.#session.reset(message.state as State);
        this.#joined = true;
        this.#asked = false;
        this.#update();
        if (lost > 0 && this.#status !== "resyncing") {
          this.#lastResync = { reason: "joined with changes the server doesn't have", lost, at: Date.now() };
          this.#options.onResync?.({ reason: this.#lastResync.reason, lost });
        }
        break;
      }
      case "caught_up": {
        this.#joined = true;
        this.#asked = false;
        for (const entry of message.entries) this.#entry(entry);
        // Anything still in flight didn't get in before the connection dropped: send it again (the server ignores a batch it has).
        if (this.#joined && this.#inflight && this.#version !== null) this.#send({ type: "ops", batch: this.#inflight.batch, base: this.#version, ops: this.#inflight.ops });
        this.#update();
        this.#flush();
        break;
      }
      case "entry":
        this.#entry(message);
        break;
      case "resync":
        this.resync(message.reason);
        break;
    }
  }

  #entry(entry: { version: number; client: string; batch: string; ops: unknown[]; dropped?: boolean }): void {
    if (this.#version === null) return;
    // Seen already (the server repeats an entry for a batch it was sent twice).
    if (entry.version <= this.#version) return;
    // A gap means a message was lost.
    if (entry.version !== this.#version + 1) return this.resync("missed an update");

    if (this.#inflight && entry.client === this.#options.room.client && entry.batch === this.#inflight.batch) {
      this.#inflight = null;
      this.#version = entry.version;
      // The server left something out, so our copy has more than it does.
      if (entry.dropped) return this.resync("the server left out part of a change");
      this.#update();
      this.#flush();
      return;
    }

    const next = this.#rebase(this.#inflight?.ops ?? [], this.#pending, entry.ops as Op[]);
    try {
      if (next.incoming.length > 0) {
        this.#session.transact(next.incoming, { origin: "remote" });
        // What can be undone is now relative to a document that has changed.
        this.#session.rebaseHistory(next.incoming, { transform: this.#model.transform, mapMeta: this.#model.mapMeta });
        this.#shiftCursors(next.incoming);
      }
    } catch {
      return this.resync("couldn't apply an update");
    }
    if (this.#inflight) this.#inflight = { batch: this.#inflight.batch, ops: next.inflight };
    this.#pending = next.pending;
    this.#version = entry.version;
    this.#update();
  }

  /** Keeps other people's cursors with their text when the document changes under them. */
  #shiftCursors(ops: readonly Op[]): void {
    const map = this.#model.mapPresence;
    if (map && ops.length > 0) this.#options.room.mapPresence((state) => map(state, ops));
  }

  #update(): void {
    const next: SyncStatus = !this.#online || this.#options.room.status === "idle" ? "offline" : !this.#joined ? (this.#status === "resyncing" ? "resyncing" : "connecting") : this.unsynced > 0 ? "saving" : "synced";
    this.#status = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

export { SERVER_CLIENT };
