import type { DeckSession } from "@pli.dev/decks";
import { actionsFor, clampStep, slideShownAt, snapshotOf, type Stage } from "./script";

/** What the director knows about a deck it drives, kept per session so a remounted director (React StrictMode) carries on. */
interface Track {
  /** The step whose finished state the deck is in, or null when it is half way through a step or the visitor changed it. */
  settled: number | null;
}
const tracks = new WeakMap<DeckSession, Track>();

export interface DirectorOptions {
  /** Shows a slide in the editor (the editor's own current-slide call, which also redraws it). */
  show(session: DeckSession, slideId: string): void;
}

/**
 * Plays the story of `script.ts` into a session: forward one step with the real commands and their delays, anything else
 * (backward, a jump, after the visitor has had the document) by loading the deterministic snapshot of the step.
 * All its timers are cleared by `stop` and `dispose`; nothing runs after that.
 */
export class DeckDirector {
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #disposed = false;
  #gen = 0;

  constructor(
    readonly session: DeckSession,
    private readonly options: DirectorOptions,
    initial?: number,
  ) {
    if (!tracks.has(session)) tracks.set(session, { settled: initial === undefined ? null : clampStep(initial) });
  }

  get #track(): Track {
    let t = tracks.get(this.session);
    if (!t) tracks.set(this.session, (t = { settled: null }));
    return t;
  }

  /** The step the deck rests at (null while a step is playing or after the visitor took over). */
  get settled(): number | null {
    return this.#track.settled;
  }

  /** Cancels what is playing. The deck stays as it is, so it is no longer at a known step. */
  stop(): void {
    this.#gen++;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    if (this.#running) this.#track.settled = null;
    this.#running = false;
  }
  #running = false;

  dispose(): void {
    this.stop();
    this.#disposed = true;
  }

  /** The visitor takes the document: scripting stops and the next `goTo` rebuilds the step. */
  release(): void {
    this.stop();
    this.#track.settled = null;
  }

  /** Shows the state of `step`. Safe to call again for the same step, in either direction, at any time. */
  goTo(step: number, animate: boolean): void {
    if (this.#disposed) return;
    const target = clampStep(step);
    const track = this.#track;
    if (this.#running && this.#target === target) return; // already on its way there
    this.stop();
    if (track.settled === target) return;
    const stage: Stage = { show: (id) => this.options.show(this.session, id) };
    if (animate && track.settled !== null && track.settled === target - 1) {
      this.#play(target, stage);
      return;
    }
    this.session.load(snapshotOf(target));
    this.options.show(this.session, slideShownAt(this.session.deck, target));
    track.settled = target;
  }
  #target = -1;

  #play(target: number, stage: Stage): void {
    const track = this.#track;
    const gen = ++this.#gen;
    this.#running = true;
    this.#target = target;
    track.settled = null;
    const list = actionsFor(target);
    for (const a of list) {
      const run = () => {
        if (this.#disposed || gen !== this.#gen) return;
        try {
          a.run(this.session, stage);
        } catch {
          // a step that cannot be played still has to end in its state
          this.stop();
          this.session.load(snapshotOf(target));
          this.options.show(this.session, slideShownAt(this.session.deck, target));
          track.settled = target;
          return;
        }
        if (a === list[list.length - 1]) {
          this.#running = false;
          track.settled = target;
        }
      };
      if (a.at <= 0) run();
      else {
        const t = setTimeout(() => {
          this.#timers.delete(t);
          run();
        }, a.at);
        this.#timers.add(t);
      }
    }
    // an action list with only immediate actions has finished already
    if (list.every((a) => a.at <= 0)) {
      this.#running = false;
      track.settled = target;
    }
  }
}
