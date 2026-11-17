/**
 * Runs rendering jobs a few at a time, the most important first. Pages in view come before pages near the view, and a
 * job whose page scrolled away is cancelled (its `AbortSignal` fires) so no time is spent on it.
 */
export interface QueueJob {
  /** Lower runs first. Can be changed while the job waits. */
  priority: number;
  /** Stops the job: removed if waiting, aborted if running. */
  cancel(): void;
  /** Settles when the job has finished (rejects if it failed; resolves quietly if it was cancelled). */
  readonly done: Promise<void>;
}

interface Pending {
  job: QueueJob;
  seq: number;
  run: (signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  resolve: () => void;
  reject: (e: unknown) => void;
  cancelled: boolean;
  started: boolean;
}

export class RenderQueue {
  private waiting: Pending[] = [];
  private running = 0;
  private seq = 0;
  readonly concurrency: number;
  /** For tests: how many jobs ran, and the most at once. */
  readonly stats = { started: 0, cancelled: 0, peak: 0 };

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  add(priority: number, run: (signal: AbortSignal) => Promise<void>): QueueJob {
    const controller = new AbortController();
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    done.catch(() => {});
    const entry: Pending = {
      job: undefined as unknown as QueueJob,
      seq: this.seq++,
      run,
      controller,
      resolve,
      reject,
      cancelled: false,
      started: false,
    };
    entry.job = {
      priority,
      done,
      cancel: () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        this.stats.cancelled++;
        controller.abort();
        if (!entry.started) {
          this.waiting = this.waiting.filter((w) => w !== entry);
          resolve();
        }
      },
    };
    this.waiting.push(entry);
    queueMicrotask(() => this.pump());
    return entry.job;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i]!;
        const b = this.waiting[best]!;
        if (a.job.priority < b.job.priority || (a.job.priority === b.job.priority && a.seq < b.seq)) best = i;
      }
      const next = this.waiting.splice(best, 1)[0]!;
      next.started = true;
      this.running++;
      this.stats.started++;
      this.stats.peak = Math.max(this.stats.peak, this.running);
      next
        .run(next.controller.signal)
        .then(next.resolve, (e) => (next.cancelled || (e instanceof Error && e.name === "AbortError") ? next.resolve() : next.reject(e)))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  /** Number of jobs waiting or running. */
  get size(): number {
    return this.waiting.length + this.running;
  }
}
