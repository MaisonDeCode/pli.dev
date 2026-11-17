import { useSyncExternalStore } from "react";

/** A tiny observable: an object that tells React when it changed. The page tools and file commands are built on it. */
export class Store {
  private listeners = new Set<() => void>();
  private version = 0;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.version;
  protected emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}

/** A store nothing ever changes: for components whose store is optional. */
export const NO_STORE = new Store();

/** Re-renders when the store changes. */
export function useStore(store: Store): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

/** What the viewer tells the person: a short message that screen readers also hear, and a toast with an optional action (Undo). */
export class Notices extends Store {
  live = "";
  toast: Toast | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private next = 1;

  announce(message: string): void {
    this.live = message;
    this.emit();
  }

  show(message: string, options: { kind?: "info" | "error"; action?: Toast["action"]; ms?: number } = {}): void {
    clearTimeout(this.timer);
    const kind = options.kind ?? "info";
    this.toast = { id: this.next++, message, kind, action: options.action };
    this.live = message;
    this.timer = setTimeout(() => this.dismiss(), options.ms ?? (kind === "error" ? 12000 : 8000));
    this.emit();
  }

  error(message: string): void {
    this.show(message, { kind: "error" });
  }

  dismiss(): void {
    clearTimeout(this.timer);
    if (!this.toast) return;
    this.toast = null;
    this.emit();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

/** An error's message as a sentence for people: capital first letter, full stop at the end. */
export function plainMessage(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).trim();
  if (!text) return "Something went wrong.";
  const first = text[0]!.toUpperCase() + text.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
