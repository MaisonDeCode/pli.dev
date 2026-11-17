import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SyncClient, SyncStatus } from "@pli.dev/core";
import { CollabIcons } from "./icons";

const LABELS: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  synced: "Saved",
  saving: "Saving…",
  offline: "Offline",
  resyncing: "Reloading…",
};

const TITLES: Record<SyncStatus, string> = {
  connecting: "Connecting to the shared document",
  synced: "All your changes are in the shared document",
  saving: "Sending your changes",
  offline: "You are offline. Your changes are kept and will be sent when you are back",
  resyncing: "Reloading the latest version of the document",
};

const ICONS: Record<SyncStatus, keyof typeof CollabIcons> = {
  connecting: "cloudSync",
  synced: "cloudDone",
  saving: "cloudSync",
  offline: "cloudOff",
  resyncing: "cloudSync",
};

export interface SyncIndicatorProps {
  status: SyncStatus;
  /** How many changes are waiting to be sent. */
  unsynced?: number;
}

/** A small "Saved" / "Saving…" / "Offline" label with a cloud, for a shared document. */
export function SyncIndicator({ status, unsynced = 0 }: SyncIndicatorProps) {
  const waiting = status === "offline" && unsynced > 0 ? ` · ${unsynced} ${unsynced === 1 ? "change" : "changes"} waiting` : "";
  return (
    <span className="pli-sync" data-status={status} role="status" aria-live="polite" title={TITLES[status]}>
      <span className="pli-sync-icon" aria-hidden="true">
        {CollabIcons[ICONS[status]]}
      </span>
      <span className="pli-sync-text">
        {LABELS[status]}
        {waiting}
      </span>
    </span>
  );
}

/**
 * A bar for the top of the editor while the connection is down: what is happening to the person's changes. Renders nothing
 * when online, so it can always be in the tree.
 */
export function OfflineBanner({ status, unsynced = 0, onRetry }: SyncIndicatorProps & { onRetry?: () => void }) {
  if (status !== "offline") return null;
  return (
    <div className="pli-offline-banner" role="status" aria-live="polite">
      <span className="pli-offline-icon" aria-hidden="true">
        {CollabIcons.cloudOff}
      </span>
      <span>
        You are offline.{" "}
        {unsynced > 0 ? `${unsynced} ${unsynced === 1 ? "change" : "changes"} will be sent when you are back.` : "Your changes are kept and will be sent when you are back."}
      </span>
      {onRetry && (
        <button type="button" className="pli-link-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export interface SyncState {
  status: SyncStatus;
  /** How many of your changes the server hasn't taken yet. */
  unsynced: number;
  /** The version of the shared document, or null while the first copy hasn't arrived. */
  version: number | null;
  /** The last time the document was reloaded from the server, and how many unconfirmed changes that cost. */
  lastResync: { reason: string; lost: number; at: number } | null;
}

const NOTHING: SyncState = { status: "synced", unsynced: 0, version: 0, lastResync: null };

/** What a sync client is doing, for an interface that shows it. Re-renders when it changes. */
export function useSyncStatus(sync: Pick<SyncClient<any, any, any>, "status" | "unsynced" | "version" | "lastResync" | "subscribe"> | null | undefined): SyncState {
  const last = useRef<SyncState>(NOTHING);
  const subscribe = useCallback((listener: () => void) => sync?.subscribe(listener) ?? (() => {}), [sync]);
  // The same object until something changes, which is what keeps the store from re-rendering forever.
  const read = (): SyncState => {
    if (!sync) return NOTHING;
    const next = { status: sync.status, unsynced: sync.unsynced, version: sync.version, lastResync: sync.lastResync };
    const old = last.current;
    if (old.status === next.status && old.unsynced === next.unsynced && old.version === next.version && old.lastResync === next.lastResync) return old;
    last.current = next;
    return next;
  };
  return useSyncExternalStore(subscribe, read, read);
}
