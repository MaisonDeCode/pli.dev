import { PliError } from "./errors";
import type { ChangeEvent, TransactOptions } from "./session";

/**
 * What a script is allowed to do, and the one way it changes a file. A script never touches editor state: it receives a
 * `ScriptContext` whose `apply` issues operations through the session, so every action is undoable, synced to other people
 * and checked against the developer's grants. This is the contract the RFC in "Scripting" describes; the sandboxed
 * runtime that calls it is a separate piece.
 */

/** What a script may be given. Anything not granted does not exist in the script's context. */
export type ScriptCapability = "read" | "write" | "comments" | "create";

/** The part of a session a script host needs; every `EditorSession` has it. */
export interface ScriptableSession<State, Op, Meta> {
  readonly state: State;
  transact(ops: readonly Op[], options?: TransactOptions<Meta>): void;
  undo(): boolean;
  subscribe(listener: (event: ChangeEvent<State, Op, Meta>) => void): () => void;
}

export interface ScriptOptions<Op> {
  /** Default: `read` and `write`. */
  grants?: readonly ScriptCapability[];
  /** The most operations one run may apply. Default 10 000. */
  maxOps?: number;
  /** The longest one run may take, in milliseconds, checked each time it applies something. Default 5 000. */
  maxMs?: number;
  /** Refuse operations this returns false for (to keep a script out of, say, protected ranges). */
  allow?: (op: Op) => boolean;
  now?: () => number;
}

export interface ScriptContext<State, Op, Meta> {
  /** The current state, to read. Throws if `read` was not granted. */
  readonly state: State;
  /** How many operations this run has applied. */
  readonly applied: number;
  can(capability: ScriptCapability): boolean;
  /** Applies operations. All of a run's changes are one undo step. Throws if `write` was not granted, or a limit was passed. */
  apply(ops: readonly Op[], options?: { before?: Meta; after?: Meta }): void;
}

/**
 * Runs scripts against a session. One run is one undo step; a run that throws is taken back. Changes a script makes are
 * not reported to `onEdit` handlers, so a script that reacts to edits cannot start itself again.
 *
 *     const host = new ScriptHost(session, { grants: ["read", "write"], maxOps: 1000 });
 *     host.run((ctx) => ctx.apply(renameOps(ctx.state)));
 *     host.onEdit((event) => host.run((ctx) => keepTotalsUpToDate(ctx, event)));
 */
export class ScriptHost<State, Op, Meta = unknown> {
  readonly #session: ScriptableSession<State, Op, Meta>;
  readonly #options: ScriptOptions<Op>;
  #running = false;

  constructor(session: ScriptableSession<State, Op, Meta>, options: ScriptOptions<Op> = {}) {
    this.#session = session;
    this.#options = options;
  }

  get running(): boolean {
    return this.#running;
  }

  /** Runs `script` and returns what it returns. */
  run<T>(script: (context: ScriptContext<State, Op, Meta>) => T): T {
    if (this.#running) throw new PliError("invalid_operation", "A script is already running");
    const grants = new Set(this.#options.grants ?? ["read", "write"]);
    const maxOps = this.#options.maxOps ?? 10_000;
    const maxMs = this.#options.maxMs ?? 5_000;
    const now = this.#options.now ?? Date.now;
    const started = now();
    const session = this.#session;
    let applied = 0;
    const need = (capability: ScriptCapability) => {
      if (!grants.has(capability)) throw new PliError("invalid_operation", `Scripts are not allowed to ${capability} here`);
    };
    const context: ScriptContext<State, Op, Meta> = {
      get state() {
        need("read");
        return session.state;
      },
      get applied() {
        return applied;
      },
      can: (capability) => grants.has(capability),
      apply: (ops, options = {}) => {
        need("write");
        if (ops.length === 0) return;
        if (now() - started > maxMs) throw new PliError("invalid_operation", `The script ran for longer than ${maxMs} ms`);
        if (applied + ops.length > maxOps) throw new PliError("invalid_operation", `The script tried to apply more than ${maxOps} operations`);
        for (const op of ops) {
          if (this.#options.allow && !this.#options.allow(op)) throw new PliError("invalid_operation", "The script tried to make a change it is not allowed to");
        }
        // The first call starts the run's undo step; the rest join it.
        session.transact(ops, { ...options, ...(applied > 0 ? { merge: true } : {}) });
        applied += ops.length;
      },
    };
    this.#running = true;
    try {
      return script(context);
    } catch (error) {
      // Take back what the run did: it was one undo step.
      if (applied > 0) session.undo();
      throw error;
    } finally {
      this.#running = false;
    }
  }

  /**
   * Calls `handler` for changes to the file, except those a script made, so a handler that edits cannot loop. Changes from
   * other people are included unless `remote` is false.
   */
  onEdit(handler: (event: ChangeEvent<State, Op, Meta>) => void, options: { remote?: boolean } = {}): () => void {
    return this.#session.subscribe((event) => {
      if (this.#running) return;
      if (event.origin === "remote" && options.remote === false) return;
      handler(event);
    });
  }
}
