import type { CommentChange, CommentStore, DocAnchor, Transport } from "@pli.dev/docs";
import { nameOf } from "./people";

/** One thing that crossed the wire, or reached the store. */
export interface WireEvent {
  id: number;
  at: number;
  /** `in` and `out` are the transport; `store` is what your CommentStore is asked to save. */
  dir: "in" | "out" | "store";
  kind: "presence" | "comment" | "hello" | "sync" | "custom" | "save";
  who: string;
  summary: string;
  data: unknown;
  /** How many identical-looking updates were folded into this one (cursor movements). */
  count: number;
}

/** A short record of what the room and the store have seen, to show what an app's server would see. */
export class WireLog {
  #events: WireEvent[] = [];
  #next = 1;
  #listeners = new Set<() => void>();
  #snapshot: readonly WireEvent[] = [];

  get events(): readonly WireEvent[] {
    return this.#snapshot;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  clear(): void {
    this.#events = [];
    this.#publish();
  }

  record(dir: "in" | "out", data: unknown): void {
    const envelope = data as { client?: string; message?: { type?: string; [key: string]: unknown } } | null;
    const message = envelope?.message;
    if (!message?.type) return;
    switch (message.type) {
      case "presence": {
        const user = message.user as { name?: string } | undefined;
        const left = message.state === null;
        this.#add({ dir, kind: "presence", who: user?.name ?? "Someone", summary: left ? "left" : message.state && (message.state as { selection?: unknown }).selection ? "moved their cursor" : "is here", data, key: `${dir}:${envelope!.client}:${left}` });
        break;
      }
      case "hello":
        this.#add({ dir, kind: "hello", who: "Someone", summary: "asks who is here", data });
        break;
      case "comment": {
        const change = message.change as CommentChange<DocAnchor>;
        this.#add({ dir, kind: "comment", who: commentAuthor(change), summary: describe(change), data });
        break;
      }
      case "custom": {
        if (message.kind === "sync") {
          const sync = message.data as { type?: string; ops?: unknown[]; version?: number; entries?: unknown[]; have?: number | null; reason?: string; dropped?: boolean };
          const n = sync.ops?.length ?? 0;
          const changes = `${n} ${n === 1 ? "change" : "changes"}`;
          const summary =
            sync.type === "ops"
              ? `sent ${changes} to the server`
              : sync.type === "entry"
                ? `v${sync.version}: ${changes} accepted${sync.dropped ? " (some left out)" : ""}`
                : sync.type === "join"
                  ? `asked to join (has ${sync.have === null ? "nothing yet" : `v${sync.have}`})`
                  : sync.type === "snapshot"
                    ? `got the whole document at v${sync.version}`
                    : sync.type === "caught_up"
                      ? `got ${sync.entries?.length ?? 0} missed ${(sync.entries?.length ?? 0) === 1 ? "entry" : "entries"}, now at v${sync.version}`
                      : sync.type === "resync"
                        ? `was told to reload: ${sync.reason}`
                        : sync.type === "hash"
                          ? "sent a fingerprint to check against the server's"
                          : String(sync.type);
          // Typing arrives as a stream of one-letter batches; one line with a count says as much.
          const key = sync.type === "ops" || sync.type === "entry" ? `${dir}:${sync.type}` : undefined;
          this.#add({ dir, kind: "sync", who: dir === "out" ? "You" : "Server", summary, data, key });
        } else {
          this.#add({ dir, kind: "custom", who: "Someone", summary: String(message.kind ?? message.type), data });
        }
        break;
      }
      default:
        this.#add({ dir, kind: "custom", who: "Someone", summary: String(message.type), data });
    }
  }

  recordSave(change: CommentChange<DocAnchor>): void {
    this.#add({ dir: "store", kind: "save", who: commentAuthor(change), summary: describe(change), data: change });
  }

  #add(event: Omit<WireEvent, "id" | "at" | "count"> & { key?: string }): void {
    const { key, ...rest } = event;
    // Typing and cursor movements arrive as a stream, and in between there are other messages; the newest of the same
    // kind among the last few lines takes the count, so one line says "×40".
    const recent = key ? this.#events.slice(-8).reverse().find((e) => (e as WireEvent & { key?: string }).key === key) : undefined;
    if (recent) {
      recent.count++;
      recent.at = Date.now();
      recent.data = event.data;
      recent.summary = event.summary;
    } else {
      this.#events.push({ id: this.#next++, at: Date.now(), count: 1, ...rest, ...(key ? { key } : {}) } as WireEvent);
      if (this.#events.length > 120) this.#events.shift();
    }
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = [...this.#events];
    for (const listener of this.#listeners) listener();
  }
}

const trim = (text: string, n = 48) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function commentAuthor(change: CommentChange<DocAnchor>): string {
  switch (change.type) {
    case "thread.create":
      return nameOf(change.thread.comments[0]?.author ?? "");
    case "comment.add":
      return nameOf(change.comment.author);
    case "thread.resolve":
      return nameOf(change.by);
    default:
      return "Someone";
  }
}

function describe(change: CommentChange<DocAnchor>): string {
  switch (change.type) {
    case "thread.create":
      return `started a thread on “${trim(change.thread.anchor?.quote ?? "", 24)}”: ${trim(change.thread.comments[0]?.body ?? "")}`;
    case "comment.add":
      return `replied: ${trim(change.comment.body)}`;
    case "comment.edit":
      return `edited a comment: ${trim(change.body)}`;
    case "comment.delete":
      return "deleted a comment";
    case "thread.resolve":
      return "resolved a thread";
    case "thread.reopen":
      return "reopened a thread";
    case "thread.delete":
      return "deleted a thread";
  }
}

/** A transport that lets a `WireLog` see everything that is sent and received. */
export function loggedTransport(inner: Transport, log: WireLog): Transport {
  return {
    connect: (room, receive) =>
      inner.connect(room, (data) => {
        log.record("in", data);
        receive(data);
      }),
    send(data) {
      log.record("out", data);
      inner.send(data);
    },
    disconnect: () => inner.disconnect(),
  };
}

/** A comment store that tells a `WireLog` what it is asked to save. */
export function loggedStore(inner: CommentStore<DocAnchor>, log: WireLog): CommentStore<DocAnchor> {
  return {
    load: (file) => inner.load(file),
    async save(file, change) {
      await inner.save(file, change);
      log.recordSave(change);
    },
    subscribe: inner.subscribe?.bind(inner),
  };
}
