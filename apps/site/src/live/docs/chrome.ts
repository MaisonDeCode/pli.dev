import type { CollabRoom, DocAnchor, Selection } from "@pli.dev/docs";
import type { Chrome } from "./script";

/**
 * The parts of the Documents editor that are not in the document: the comments panel, which the editor opens when a
 * highlighted comment is clicked (so that is what this does, the way a visitor would), and the teammate's presence in the
 * room. Everything it waits for is a timer it can cancel.
 */
export class DocsChrome implements Chrome {
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #busy: Promise<void> = Promise.resolve();
  #ended = false;
  readonly #root: () => HTMLElement | null;
  readonly #teammate: CollabRoom<DocAnchor>;

  constructor(root: () => HTMLElement | null, teammate: CollabRoom<DocAnchor>) {
    this.#root = root;
    this.#teammate = teammate;
  }

  comments(open: boolean): void {
    if (this.#ended) return;
    if (!open) {
      this.#root()?.querySelector<HTMLElement>(".pli-comments-head button[aria-label^='Close']")?.click();
      return;
    }
    // The highlight is drawn a moment after the comment is made; the editor opens the panel when it is clicked.
    this.#busy = new Promise<void>((resolve) => {
      let tries = 0;
      const attempt = () => {
        const mark = this.#root()?.querySelector<HTMLElement>(".pli-comment");
        if (mark) {
          mark.click();
          resolve();
        } else if (++tries > 40) {
          resolve();
        } else {
          this.#later(attempt, 25);
        }
      };
      attempt();
    });
  }

  teammate(selection: Selection | null): void {
    if (this.#ended) return;
    if (!selection) {
      this.#teammate.disconnect();
      return;
    }
    this.#teammate.setPresence({ selection });
    void Promise.resolve(this.#teammate.connect()).catch(() => {});
  }

  /** Resolves once the panel has been asked to open (or it is clear it cannot). */
  idle(): Promise<void> {
    return this.#busy;
  }

  #later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.#timers.delete(t);
      if (!this.#ended) fn();
    }, ms);
    this.#timers.add(t);
  }

  /** Runs `fn` after the browser has drawn what was just changed. */
  afterPaint(fn: () => void): void {
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
    if (!raf) return this.#later(fn, 32);
    raf(() => raf(() => !this.#ended && fn()));
  }

  /** Forgets what is still being waited for, and stays usable. */
  cancel(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }

  dispose(): void {
    this.#ended = true;
    this.cancel();
    this.#teammate.disconnect();
  }
}
