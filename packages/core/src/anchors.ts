import type { CommentClient, Thread } from "./comments";
import type { ChangeEvent } from "./session";
import { mapRange, type TextOp } from "./text-ops";

/**
 * How a comment thread follows its content. A thread's `anchor` says where it is attached (a text range, a cell, a slide
 * element, a PDF annotation); when people edit, the place moves or goes away. Each editor supplies an `AnchorResolver`
 * that knows how its own operations move its own anchors, and `AnchorTracker` keeps every thread's current anchor up to
 * date from the session's changes, so any interface can ask "where is this thread now, and is its content still there?".
 */
export interface AnchorResolver<Anchor, Op, State = unknown> {
  /**
   * Moves an anchor through operations that were applied to the file. Returns the anchor as it is now (the same object
   * if nothing moved) or null when the thing it pointed at is gone. Must not throw.
   */
  map(anchor: Anchor, ops: readonly Op[], state: State): Anchor | null;
  /** A short label to show with the thread (a quote of the text, a cell address). */
  describe?(anchor: Anchor, state: State): string | undefined;
}

export interface AnchorTrackerOptions<Anchor> {
  /** Called when a thread's anchor moved or went away (null), so the editor can store the new place with the thread. */
  persist?(thread: Thread<Anchor>, anchor: Anchor | null): void;
}

/**
 * Follows the anchors of a client's threads through a session's changes.
 *
 *     const anchors = new AnchorTracker(session, client, resolver);
 *     anchors.get(thread.id);        // where it is now, or null if its content is gone
 */
export class AnchorTracker<Anchor, State, Op, Meta = unknown> {
  readonly #session: { readonly state: State; subscribe(listener: (event: ChangeEvent<State, Op, Meta>) => void): () => void };
  readonly #client: CommentClient<Anchor>;
  readonly #resolver: AnchorResolver<Anchor, Op, State>;
  readonly #options: AnchorTrackerOptions<Anchor>;
  /** The current anchor of every thread; null once what it was attached to is gone. */
  #anchors = new Map<string, Anchor | null>();
  /** The anchor each thread had when we last read it from the thread, to tell a changed one from one we moved. */
  #seen = new Map<string, Anchor | undefined>();
  #listeners = new Set<() => void>();
  #cleanups: (() => void)[] = [];

  constructor(
    session: { readonly state: State; subscribe(listener: (event: ChangeEvent<State, Op, Meta>) => void): () => void },
    client: CommentClient<Anchor>,
    resolver: AnchorResolver<Anchor, Op, State>,
    options: AnchorTrackerOptions<Anchor> = {},
  ) {
    this.#session = session;
    this.#client = client;
    this.#resolver = resolver;
    this.#options = options;
    this.#sync();
    this.#cleanups.push(
      session.subscribe((event) => this.#changed(event)),
      client.subscribe(() => this.#sync()),
    );
  }

  /** Where the thread is now. `null`: its content is gone. `undefined`: the thread isn't attached to anything, or isn't known. */
  get(threadId: string): Anchor | null | undefined {
    return this.#anchors.get(threadId);
  }

  /** Whether the thread is attached to content that still exists. A thread with no anchor counts as attached (it is about the file). */
  isAttached(threadId: string): boolean {
    return this.#anchors.get(threadId) !== null;
  }

  /** A label for the thread's place, from the resolver. */
  describe(threadId: string): string | undefined {
    const anchor = this.#anchors.get(threadId);
    return anchor ? this.#resolver.describe?.(anchor, this.#session.state) : undefined;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#listeners.clear();
  }

  /** Threads are the source of truth for threads we haven't followed yet, or whose anchor was changed from outside. */
  #sync(): void {
    const ids = new Set<string>();
    let changed = false;
    for (const thread of this.#client.threads) {
      ids.add(thread.id);
      if (!this.#seen.has(thread.id) || this.#seen.get(thread.id) !== thread.anchor) {
        this.#seen.set(thread.id, thread.anchor);
        if (thread.anchor !== undefined) {
          // A thread we had moved keeps what we know unless the stored anchor is a new one.
          this.#anchors.set(thread.id, thread.anchor);
          changed = true;
        }
      }
    }
    for (const id of [...this.#anchors.keys()]) {
      if (!ids.has(id)) {
        this.#anchors.delete(id);
        this.#seen.delete(id);
        changed = true;
      }
    }
    if (changed) this.#emit();
  }

  #changed(event: ChangeEvent<State, Op, Meta>): void {
    if (event.ops.length === 0 && !event.reset) return;
    let changed = false;
    for (const thread of this.#client.threads) {
      const anchor = this.#anchors.get(thread.id);
      // Already gone, or never anchored: nothing to follow.
      if (!anchor) continue;
      let next: Anchor | null;
      try {
        next = event.reset ? anchor : this.#resolver.map(anchor, event.ops, event.state);
      } catch {
        next = anchor;
      }
      if (next !== anchor) {
        this.#anchors.set(thread.id, next);
        this.#options.persist?.(thread, next);
        changed = true;
      }
    }
    if (changed) this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

// ---- A resolver for anchors on a run of text ------------------------------------------------------------------

/** An anchor on a range of one run of text: a paragraph of a document, a text box, a cell's text. */
export interface TextRangeAnchor {
  /** The id of the thing that holds the text (a block id, a text box id, a cell address). */
  target: string;
  from: number;
  to: number;
  /** The text at the anchor when the thread was made, to show and to find the place again. */
  quote?: string;
}

/**
 * A resolver for `TextRangeAnchor`s. `textOf` says which text edits an editor operation is, and for which target: for a
 * document, `insert_text` in block X is `{ target: "X", edits: [{ type: "insert", at, text }] }`; an operation that is not a
 * text edit returns null. Operations that remove the target itself are reported with `removes`.
 */
export function textRangeResolver<Op, State = unknown>(handlers: {
  textOf(op: Op): { target: string; edits: TextOp[] } | null;
  removes?(op: Op): string | null;
}): AnchorResolver<TextRangeAnchor, Op, State> {
  return {
    map(anchor, ops) {
      let range: { from: number; to: number } | null = { from: anchor.from, to: anchor.to };
      for (const op of ops) {
        if (handlers.removes?.(op) === anchor.target) return null;
        const text = handlers.textOf(op);
        if (!text || text.target !== anchor.target) continue;
        range = mapRange(range, text.edits);
        if (!range) return null;
      }
      return range.from === anchor.from && range.to === anchor.to ? anchor : { ...anchor, ...range };
    },
    describe: (anchor) => anchor.quote,
  };
}
