/**
 * A reducer applies one operation to an immutable state and returns the new
 * state plus the operation that undoes it. Documents, sheets, decks and the
 * rest each supply their own reducer; history, transactions and events are
 * shared here.
 */
export interface Reducer<State, Op> {
  apply(state: State, op: Op): { state: State; inverse: Op };
}

export type ChangeOrigin = "local" | "undo" | "redo" | "remote";

export interface ChangeEvent<State, Op, Meta = undefined> {
  state: State;
  /** True when the whole state was replaced (see `Session.reset`) rather than changed by `ops`. */
  reset?: boolean;
  ops: readonly Op[];
  origin: ChangeOrigin;
  /**
   * For local changes, the `after` meta passed to `transact`. For undo and redo, the meta
   * to restore (e.g. the selection from before or after the original edit).
   */
  meta?: Meta;
}

export interface TransactOptions<Meta> {
  origin?: ChangeOrigin;
  /** Editor state to restore when this change is undone, such as the selection. */
  before?: Meta;
  /** Editor state that results from this change, restored again on redo. */
  after?: Meta;
  /**
   * Apply this change as a local one (it is sent to other people, if the session is shared) but don't make it an undo
   * step. For changes that follow from something else, such as taking a deleted comment's highlight off the text.
   */
  history?: false;
  /**
   * Fold this change into the previous undo step, so one undo reverts both. Used to group
   * consecutive keystrokes. Ignored if there is no previous step.
   */
  merge?: boolean;
}

/** One undoable step: ops that revert it, plus the meta to restore after running them. */
interface Step<Op, Meta> {
  ops: Op[];
  restore: Meta | undefined;
  /** The meta that applies to the opposite direction (kept so undo and redo can swap). */
  other: Meta | undefined;
}

export class Session<State, Op, Meta = undefined> {
  #state: State;
  #reducer: Reducer<State, Op>;
  #undo: Step<Op, Meta>[] = [];
  #redo: Step<Op, Meta>[] = [];
  #listeners = new Set<(event: ChangeEvent<State, Op, Meta>) => void>();

  constructor(initial: State, reducer: Reducer<State, Op>) {
    this.#state = initial;
    this.#reducer = reducer;
  }

  get state(): State {
    return this.#state;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Apply ops as one atomic, undoable step. If any op throws, the state is
   * left untouched and nothing is recorded.
   */
  transact(ops: readonly Op[], options: TransactOptions<Meta> = {}): void {
    if (ops.length === 0) return;
    const origin = options.origin ?? "local";
    const { state, inverse } = this.#run(ops);
    this.#state = state;
    // Only local edits are undoable; remote ops don't enter this user's history.
    if (origin === "local" && options.history !== false) {
      const previous = options.merge ? this.#undo[this.#undo.length - 1] : undefined;
      if (previous) {
        // Undo runs this change's inverse first, then the earlier step's.
        previous.ops = [...inverse, ...previous.ops];
        previous.other = options.after;
      } else {
        this.#undo.push({ ops: inverse, restore: options.before, other: options.after });
      }
      this.#redo = [];
    }
    this.#emit({ state, ops, origin, meta: options.after });
  }

  /**
   * Replaces the whole state and forgets the history, as when a shared document is reloaded from the server.
   * Listeners hear it as a `remote` change with no ops and `reset: true`.
   */
  reset(state: State): void {
    this.#state = state;
    this.#undo = [];
    this.#redo = [];
    this.#emit({ state, ops: [], origin: "remote", reset: true });
  }

  /**
   * Brings the undo and redo history up to date after other people's operations were applied. Each step's
   * operations were written for the document as it was; `transform` rewrites them for the document as it is now,
   * so undoing your last change takes back your change and leaves theirs. Steps left with nothing to do are dropped.
   *
   * `remote` is what was applied to the current state. `transform(a, b)` is the editor's: it returns `a` as it must
   * be applied after `b`, and `b` as it must be applied after `a`. `mapMeta` moves the editor state saved with a
   * step (the selection) through operations.
   */
  rebaseHistory(
    remote: readonly Op[],
    algebra: { transform(a: readonly Op[], b: readonly Op[]): [Op[], Op[]]; mapMeta?(meta: Meta, ops: readonly Op[]): Meta },
  ): void {
    if (remote.length === 0) return;
    const map = (meta: Meta | undefined, ops: readonly Op[]) => (meta === undefined || !algebra.mapMeta ? meta : algebra.mapMeta(meta, ops));
    const walk = (stack: Step<Op, Meta>[]): Step<Op, Meta>[] => {
      // The top step applies to the document as it is. The one below it applies after that one has run, so what
      // happened to the document is carried down past each step on the way.
      let carried: readonly Op[] = remote;
      const kept: Step<Op, Meta>[] = [];
      for (let i = stack.length - 1; i >= 0; i--) {
        const step = stack[i]!;
        const [ops, next] = algebra.transform(step.ops, carried);
        step.restore = map(step.restore, next);
        step.other = map(step.other, carried);
        step.ops = ops;
        carried = next;
        if (ops.length > 0) kept.push(step);
      }
      return kept.reverse();
    };
    this.#undo = walk(this.#undo);
    this.#redo = walk(this.#redo);
  }

  undo(): boolean {
    const step = this.#undo.pop();
    if (!step) return false;
    const attempt = this.#try(step.ops);
    // A step that no longer fits the document (what it worked on is gone) is forgotten, not an error.
    if (!attempt) return false;
    const { state, inverse } = attempt;
    this.#state = state;
    this.#redo.push({ ops: inverse, restore: step.other, other: step.restore });
    this.#emit({ state, ops: step.ops, origin: "undo", meta: step.restore });
    return true;
  }

  redo(): boolean {
    const step = this.#redo.pop();
    if (!step) return false;
    const attempt = this.#try(step.ops);
    if (!attempt) return false;
    const { state, inverse } = attempt;
    this.#state = state;
    this.#undo.push({ ops: inverse, restore: step.other, other: step.restore });
    this.#emit({ state, ops: step.ops, origin: "redo", meta: step.restore });
    return true;
  }

  subscribe(listener: (event: ChangeEvent<State, Op, Meta>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #try(ops: readonly Op[]): { state: State; inverse: Op[] } | null {
    try {
      return this.#run(ops);
    } catch {
      return null;
    }
  }

  /** Returns the final state and a batch of ops that, applied in order, reverts it. */
  #run(ops: readonly Op[]): { state: State; inverse: Op[] } {
    let state = this.#state;
    const inverse: Op[] = [];
    for (const op of ops) {
      const result = this.#reducer.apply(state, op);
      state = result.state;
      inverse.unshift(result.inverse);
    }
    return { state, inverse };
  }

  #emit(event: ChangeEvent<State, Op, Meta>): void {
    for (const listener of this.#listeners) listener(event);
  }
}
