/**
 * Plays a scripted story on a live editor: a list of segments (one per step), each a list of small actions with a pause
 * before it. Used by the Documents and Sheets bodies; it knows nothing about either editor.
 *
 *   goTo(1)   from step 0, with `animate`: plays segment 1 action by action
 *   goTo(2)   while segment 1 is still playing: the rest of 1 is applied at once, then segment 2 plays
 *   goTo(0)   from anywhere else, or without `animate`: `reset()`, then segments 0..step are applied at once
 *
 * Whichever way a step is reached the same actions have run, so the document ends the same. `stop()` hands the document to
 * the visitor (nothing more is scripted, and the next `goTo` starts over from `reset()`); `dispose()` ends it for good. Every
 * pending timer is cancelled by both.
 */
export interface Action {
  /** Milliseconds to wait before running, when the step is played. */
  ms: number;
  run(): void;
}
export type Segment = readonly Action[];

export interface PlayerOptions {
  segments: readonly Segment[];
  /** Puts the document in its starting state. May return a promise: nothing is applied until it settles. */
  reset(): void | Promise<void>;
  /** Called after each action that was played with pauses (to keep the caret in view, say). */
  afterAction?(): void;
  /** Called whenever a step has been fully applied, by playing or by jumping. */
  settled?(step: number): void;
}

export class Player {
  #options: PlayerOptions;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever pending work must be forgotten: an older jump that is still waiting does nothing. */
  #turn = 0;
  #queue: Action[] = [];
  /** The action whose pause is running: it has left the queue but has not run yet. */
  #waiting: Action | null = null;
  #playing: number | null = null;
  #at: number | null = null;
  #goal: number | null = null;
  #ended = false;

  constructor(options: PlayerOptions) {
    this.#options = options;
  }

  /** The step the document is fully in, or null while it is being played, rebuilt, or after the visitor took over. */
  get at(): number | null {
    return this.#at;
  }

  goTo(step: number, animate: boolean): void {
    if (this.#ended) return;
    const last = this.#options.segments.length - 1;
    step = Math.max(0, Math.min(last, step));
    if (step === this.#goal) return;
    if (animate && this.#playing !== null && step === this.#playing + 1) {
      // Still typing the step before: finish it at once, then play this one.
      this.#flush();
      this.#play(step);
    } else if (animate && this.#playing === null && this.#at !== null && step === this.#at + 1) {
      this.#play(step);
    } else {
      this.#jump(step);
    }
  }

  /** The visitor took over: nothing more is played, and the document is left as it is. */
  stop(): void {
    this.#cancel();
    this.#playing = null;
    this.#at = null;
    this.#goal = null;
  }

  dispose(): void {
    this.#ended = true;
    this.#cancel();
  }

  #cancel(): void {
    this.#turn++;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#waiting = null;
    this.#queue = [];
  }

  #flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const rest = this.#waiting ? [this.#waiting, ...this.#queue] : this.#queue;
    this.#waiting = null;
    this.#queue = [];
    for (const action of rest) action.run();
    this.#at = this.#playing;
    this.#playing = null;
  }

  #play(step: number): void {
    this.#goal = step;
    this.#playing = step;
    this.#at = null;
    this.#queue = [...this.#options.segments[step]!];
    this.#next(step, this.#turn);
  }

  #next(step: number, turn: number): void {
    if (this.#queue.length === 0) {
      this.#playing = null;
      this.#at = step;
      this.#options.settled?.(step);
      return;
    }
    const action = this.#queue.shift()!;
    this.#waiting = action;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#waiting = null;
      if (turn !== this.#turn || this.#ended) return;
      action.run();
      this.#options.afterAction?.();
      this.#next(step, turn);
    }, action.ms);
  }

  #jump(step: number): void {
    this.#cancel();
    const turn = this.#turn;
    this.#playing = null;
    this.#at = null;
    this.#goal = step;
    const apply = () => {
      if (turn !== this.#turn || this.#ended) return;
      for (let i = 0; i <= step; i++) for (const action of this.#options.segments[i]!) action.run();
      this.#at = step;
      this.#options.settled?.(step);
    };
    const waiting = this.#options.reset();
    if (waiting) void waiting.then(apply);
    else apply();
  }
}
