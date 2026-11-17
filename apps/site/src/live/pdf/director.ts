import type { PdfSession } from "@pli.dev/pdf";
import { PDF_STEPS, showStep, type Plan } from "./script";

/** Delay before the first item of a step and between items: one thing at a time, so the page visibly gets worked on. */
export const FIRST_MS = 350;
export const GAP_MS = 500;

interface Track {
  settled: number | null;
}
const tracks = new WeakMap<PdfSession, Track>();

export const clampPdfStep = (step: number): number => Math.min(PDF_STEPS - 1, Math.max(0, Math.round(Number.isFinite(step) ? step : 0)));

/**
 * Plays the story of `script.ts` into a session. Forward by one step the new items are added one by one, `GAP_MS` apart;
 * any other move (backward, a jump, a step cut short) puts the document in the finished state of the step at once.
 * `stop`, `release` and `dispose` clear every timer.
 */
export class PdfDirector {
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #disposed = false;
  #running = false;
  #target = -1;

  constructor(
    readonly session: PdfSession,
    readonly plan: Plan,
    initial?: number,
  ) {
    if (!tracks.has(session)) tracks.set(session, { settled: initial === undefined ? null : clampPdfStep(initial) });
  }

  get #track(): Track {
    let t = tracks.get(this.session);
    if (!t) tracks.set(this.session, (t = { settled: null }));
    return t;
  }

  get settled(): number | null {
    return this.#track.settled;
  }

  stop(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    if (this.#running) this.#track.settled = null;
    this.#running = false;
  }

  dispose(): void {
    this.stop();
    this.#disposed = true;
  }

  /** The visitor takes the document: nothing more is scripted, and the next `goTo` rebuilds the step. */
  release(): void {
    this.stop();
    this.#track.settled = null;
  }

  goTo(step: number, animate: boolean): void {
    if (this.#disposed) return;
    const target = clampPdfStep(step);
    const track = this.#track;
    if (this.#running && this.#target === target) return;
    this.stop();
    if (track.settled === target) return;
    if (animate && track.settled !== null && track.settled === target - 1) {
      const todo = this.plan.items.filter((i) => i.step === target && !i.present(this.session));
      if (todo.length > 0) {
        this.#running = true;
        this.#target = target;
        track.settled = null;
        todo.forEach((item, n) => {
          const t = setTimeout(() => {
            this.#timers.delete(t);
            if (this.#disposed) return;
            try {
              item.apply(this.session);
            } catch {
              // an item that cannot be applied: the step still has to end in its state
              this.stop();
              showStep(this.session, this.plan, target);
              track.settled = target;
              return;
            }
            if (n === todo.length - 1) {
              this.#running = false;
              track.settled = target;
            }
          }, FIRST_MS + n * GAP_MS);
          this.#timers.add(t);
        });
        return;
      }
    }
    showStep(this.session, this.plan, target);
    track.settled = target;
  }
}
