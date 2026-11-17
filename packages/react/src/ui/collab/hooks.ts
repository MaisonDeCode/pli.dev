import { useCallback, useRef, useSyncExternalStore } from "react";
import type { ActivityFeed, CollabRoom, CommentClient, Peer, PliUser, PresentUser, ShareClient, VersionHistory } from "@pli.dev/core";
import { presentUsers } from "@pli.dev/core";

/** Re-renders when `subscribe`'s source changes, and returns `read()`. The same object until something changes. */
export function useStore<T>(subscribe: ((listener: () => void) => () => void) | null | undefined, read: () => T): T {
  const sub = useCallback((listener: () => void) => subscribe?.(listener) ?? (() => {}), [subscribe]);
  return useSyncExternalStore(sub, read, read);
}

const NO_PEERS: readonly Peer[] = [];

/** The people in a room, kept up to date. */
export function useRoomPeers(room: Pick<CollabRoom<any>, "subscribe" | "peers"> | null | undefined): readonly Peer[] {
  return useSyncExternalStore(
    (listener) => room?.subscribe(listener) ?? (() => {}),
    () => room?.peers ?? NO_PEERS,
    () => NO_PEERS,
  );
}

/**
 * The distinct people in a room, you left out, each with a colour (no two the same) and how active they are. Recomputed
 * when people come and go or change what they are doing; activity is looked at again every `refresh` ms (default 15 s).
 */
export function usePresentUsers(room: Pick<CollabRoom<any>, "subscribe" | "peers"> | null | undefined, you?: PliUser | null): PresentUser[] {
  const peers = useRoomPeers(room);
  const last = useRef<{ peers: readonly Peer[]; you: PliUser | null | undefined; at: number; value: PresentUser[] } | null>(null);
  const now = Date.now();
  const old = last.current;
  // Activity is time-based, so a result is reused for a few seconds, not forever; and for the same people at once.
  if (old && old.peers === peers && old.you === you && now - old.at < 5000) return old.value;
  const value = presentUsers(peers, you, now);
  last.current = { peers, you, at: now, value };
  return value;
}

/** The threads of a client, kept up to date. */
export function useThreads<A>(client: CommentClient<A>) {
  return useStore(useCallback((l: () => void) => client.subscribe(l), [client]), () => client.threads);
}

/** The sharing settings of a client, kept up to date. */
export function useShareSettings(client: ShareClient) {
  return useStore(useCallback((l: () => void) => client.subscribe(l), [client]), () => client.settings);
}

/** The named versions of a history, newest first. */
export function useVersions<S, O>(history: VersionHistory<S, O>) {
  return useStore(useCallback((l: () => void) => history.subscribe(l), [history]), () => history.versions);
}

/** The entries of an activity feed, newest first. */
export function useActivity(feed: ActivityFeed) {
  return useStore(useCallback((l: () => void) => feed.subscribe(l), [feed]), () => feed.events);
}
