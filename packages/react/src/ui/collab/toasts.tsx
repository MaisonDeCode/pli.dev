import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeActivity, type ActivityEvent, type ActivityFeed } from "@pli.dev/core";
import { CollabIcons } from "./icons";
import { useActivity } from "./hooks";

export interface ToastSpec {
  text: string;
  /** `error` is announced at once and stays until dismissed. Default `info`. */
  kind?: "info" | "success" | "error";
  /** A button in the toast ("Undo", "View"). */
  action?: { label: string; run: () => void };
  /** How long it stays, in ms. Default 6 seconds; 0 keeps it until dismissed. */
  timeout?: number;
}

interface Toast extends ToastSpec {
  id: number;
}

interface ToastApi {
  show(toast: ToastSpec): number;
  dismiss(id: number): void;
}

const Context = createContext<ToastApi | null>(null);

/** `show` and `dismiss`. Without a provider they do nothing, so a component can always call them. */
export function useToasts(): ToastApi {
  return useContext(Context) ?? NONE;
}
const NONE: ToastApi = { show: () => -1, dismiss: () => {} };

/**
 * Holds the toasts and draws them at the bottom left of the window, as Google's editors do: dark, rounded, with one action.
 * The region is a polite live region (errors are `alert`s), so a screen reader hears each toast once.
 */
export function ToastProvider({ children, max = 3 }: { children: ReactNode; max?: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);
  const show = useCallback(
    (spec: ToastSpec) => {
      const id = next.current++;
      setToasts((all) => [...all, { ...spec, id }].slice(-max));
      const ms = spec.timeout ?? (spec.kind === "error" ? 0 : 6000);
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss, max],
  );
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const timer of all.values()) clearTimeout(timer);
      all.clear();
    };
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <Context.Provider value={api}>
      {children}
      <div className="pli-toast-region" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className="pli-toast" data-kind={toast.kind ?? "info"} role={toast.kind === "error" ? "alert" : "status"}>
            <span className="pli-toast-text">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="pli-toast-action"
                onClick={() => {
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="pli-toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              {CollabIcons.close}
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}

/**
 * Shows a toast when something concerns the signed-in person: someone mentions them or replies to their comment. Put it
 * once inside a `ToastProvider`. Entries that were already in the feed when it mounted are not announced.
 */
export function ActivityToasts({ feed, user, onOpen }: { feed: ActivityFeed; user: string | null | undefined; onOpen?: (event: ActivityEvent) => void }) {
  const events = useActivity(feed);
  const { show } = useToasts();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    if (!user) return;
    for (const event of feed.notificationsFor(user)) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      show({ text: `${describeActivity(event, feed.users)}${event.excerpt ? `: “${event.excerpt}”` : ""}`, ...(onOpen ? { action: { label: "View", run: () => onOpen(event) } } : {}) });
    }
  }, [events, feed, user, show, onOpen]);
  return null;
}
