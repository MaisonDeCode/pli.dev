import { isSyncMessage, type Authority, type Transport } from "../src";

/**
 * An in-process "server": every transport made from it joins rooms, messages for the sequencer go to the authority and
 * its answers go to everyone, everything else is relayed to the rest of the room. What `apps/playground` does with
 * Socket.io, without the network.
 */
export function serverHub(authority: Authority) {
  const rooms = new Map<string, Set<(data: unknown) => void>>();
  const pending = new Set<Promise<void>>();
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    /** Resolves when the server has answered everything it was sent. */
    async idle(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending]);
      await new Promise((r) => setTimeout(r, 0));
      if (pending.size > 0) await this.idle();
    },
    transport(): Transport {
      let joined: { room: string; receive: (data: unknown) => void } | null = null;
      return {
        connect(room, receive) {
          joined = { room, receive };
          const set = rooms.get(room) ?? new Set();
          rooms.set(room, set);
          set.add(receive);
        },
        send(data) {
          if (!joined) return;
          const { room, receive: self } = joined;
          const members = rooms.get(room) ?? new Set();
          if (isSyncMessage(data)) {
            const p = authority
              .receive(room, copy(data), (envelope) => {
                for (const member of members) member(copy(envelope));
              })
              .finally(() => pending.delete(p));
            pending.add(p);
          } else {
            for (const member of members) if (member !== self) member(copy(data));
          }
        },
        disconnect() {
          if (joined) rooms.get(joined.room)?.delete(joined.receive);
          joined = null;
        },
      };
    },
  };
}
