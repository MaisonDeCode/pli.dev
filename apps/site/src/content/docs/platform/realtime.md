---
title: Realtime
description: Connect Pli to Socket.io, a WebSocket server, Redis, or any pipe that can carry JSON, for live comments and to show who else is here.
sidebar:
  order: 5
---

A **room** is everyone looking at the same file. Pli's part is small: it sends JSON to the room and reads JSON from it. **You** provide the pipe, with the server you already run. Pli never opens a connection of its own.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


```ts
import { CollabRoom, socketTransport } from "@pli.dev/docs";
import { io } from "socket.io-client";

const room = new CollabRoom({
  room: doc.id,                     // everyone with the same room id sees each other
  transport: socketTransport(io()), // your pipe
  users,                            // see Users and permissions
});

<PliDocument session={session} room={room} />;
```

`PliDocument` connects the room when it appears and disconnects it when it goes away. It also shares the session's comments through it. You can also drive a room yourself: `await room.connect()`, `room.disconnect()`.

## What a room does

- **Presence:** `room.peers` lists the other people, with the user and what they are doing. `PliDocument` shows their pictures in the title bar, and their cursors and selections on the page.
- **Comments:** every comment change is sent to the room once your store has kept it, and applied when it arrives.
- **Custom messages:** `room.sendCustom("kind", data)` and `room.onCustom("kind", fn)`, so another editor module (a sheet showing who is editing a cell) uses the same room.

It does not store anything, order anything or remember anything. A person who joins late sees who is here, and loads comments from the store.

## The pipe: `Transport`

This is the whole interface. Anything that can do these three things works.

```ts
interface Transport {
  connect(room: string, receive: (data: unknown) => void): void | Promise<void>;
  send(data: unknown): void;   // to everyone else in the room
  disconnect(): void;
}
```

`data` is JSON. A transport may deliver a message back to its sender; the room ignores its own.

### Ready-made

| Transport | For |
|-----------|-----|
| `socketTransport(socket, options?)` | Socket.io, or anything with `emit` and `on` |
| `webSocketTransport(ws)` | A plain browser `WebSocket` |
| `broadcastChannelTransport()` | Tabs of the same browser, with no server. Good for demos |
| `memoryHub().transport()` | Tests: every transport from one hub shares rooms |

### Socket.io

The client is `socketTransport(io())`. Your server puts each socket in the room it asks for, and passes messages on:

```ts
// server.ts
import { Server } from "socket.io";

const io = new Server(3000, { cors: { origin: "https://your.app" } });

io.on("connection", (socket) => {
  socket.on("pli:join", (room) => socket.join(room));
  socket.on("pli:leave", (room) => socket.leave(room));
  socket.on("pli", (room, data) => socket.to(room).emit("pli", room, data));
});
```

A socket that drops and comes back is a new connection to the server, so `socketTransport` tells it again which room it is in each time the socket reconnects.

To also edit the document live, the same server passes the changes to a sequencer: see [Live editing](/platform/live-editing/#1-the-server) for the few extra lines.

Check who may join in `pli:join` (read the socket's session or token) and who may send in `pli`.

### Redis, for more than one server

With several server processes, a user on one must reach users on another. Socket.io's Redis adapter does this, so the server above does not change:

```ts
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```

Without Socket.io, publish and subscribe to a Redis channel per room yourself:

```ts
// In your WebSocket server, for each connected socket in `room`:
sub.subscribe(`pli:${room}`, (message) => ws.send(JSON.stringify({ room, data: JSON.parse(message) })));
ws.on("message", (raw) => {
  const { room, data, join } = JSON.parse(raw);
  if (!join) pub.publish(`pli:${room}`, JSON.stringify(data));
});
```

### A plain WebSocket

`webSocketTransport(ws)` sends text frames `{"room": "…", "data": …}`. It sends `{"room": "…", "join": true}` first, and `{"room": "…", "leave": true}` when it disconnects. Your server relays `data` to the other sockets in that room, in the same envelope.

### Anything else

Ably, Pusher, Supabase Realtime, Firebase, your own: write the three functions.

```ts
import type { Transport } from "@pli.dev/docs";
import Ably from "ably";

export function ablyTransport(client: Ably.Realtime): Transport {
  let channel: Ably.RealtimeChannel | null = null;
  return {
    async connect(room, receive) {
      channel = client.channels.get(`pli:${room}`);
      await channel.subscribe((message) => receive(message.data));
    },
    send: (data) => void channel?.publish("pli", data),
    disconnect: () => channel?.detach(),
  };
}
```

## Presence helpers

`room.setPresence(state)` takes any JSON object, and each editor decides what goes in it. `@pli.dev/core` has the pieces every editor needs around it:

```ts
import { IdleTracker, bindActivity, presencePublisher, presentUsers, presenceColors, peerActivity } from "@pli.dev/core";

// Say what you are doing, politely: merged, repeats dropped, at most one message per 50 ms.
const idle = new IdleTracker({ idleAfter: 60_000, awayAfter: 300_000, onChange: () => presence.refresh() });
bindActivity(idle, window);                                   // keys, pointer, scroll and touch keep you "active"
const presence = presencePublisher(room, { idle });
presence.update({ surface: sheet.id, cursor: { x, y }, editing: "B2" });

// Read it: one entry per person (two tabs are one person), you left out, each with a colour and an activity.
presentUsers(room.peers, you);          // [{ user, color, peers, activity: "active" | "idle" | "away" }]
```

| Helper | What it does |
|--------|--------------|
| `presenceColors(users)` | A different colour for each person in a room, from a palette that is easy to tell apart on light and dark; the same people always get the same colours, and a colour your directory chose is kept. |
| `presentUsers(peers, you)` | The distinct people in a room, with colour and activity, in order of arrival. |
| `peerActivity(peer)` | `"active"`, `"idle"` or `"away"`, from what the peer says (`activity`, `lastActive`) or, failing that, when we last heard from it. |
| `IdleTracker`, `bindActivity` | Notices when the person stops doing anything, and sends that as `activity` and `lastActive`. |
| `presencePublisher(room)` | `update(patch)`, `set(state)`, `flush()`. Throttled and de-duplicated. |
| `throttle(send, ms)` | The primitive under it: the first call goes at once, the last of a burst goes when the time is up. |

The shared interface reads a few optional fields when they are there, and an editor may add its own beside them (a document sends `selection`, a PDF sends `page` and `tool`):

```ts
interface PresencePayload {
  surface?: string | null;                              // the page, sheet or slide being looked at
  cursor?: { surface?: string; x: number; y: number };  // a pointer, in the editor's own space (not screen pixels)
  selection?: unknown;                                  // text range, cell range, ids of selected objects
  editing?: string | null;                              // what is being edited right now: drawn as an outline
  activity?: "active" | "idle" | "away";
  lastActive?: number;                                  // milliseconds since 1970
}
```

`AvatarStack` fades people who are idle or away; `PeerCursor` and `PeerOutline` draw cursors and outlines in each person's colour (see [Shared interface](/platform/shared-ui/)).

## What is on the wire

Every message is an **envelope**:

```json
{ "v": 1, "client": "c_8f2k1x", "message": { … } }
```

`client` identifies one connection (one person with two tabs is two clients). Messages:

```jsonc
// "I am here, and this is what I'm doing." Sent on joining, on change, and every few seconds.
{ "type": "presence",
  "user": { "id": "u_42", "name": "Ana Reyes", "color": "#2f9e44" },
  "state": { "selection": { "anchor": { "block": "b_3", "offset": 4 }, "focus": { "block": "b_3", "offset": 9 } } } }

// "I'm leaving."
{ "type": "presence", "user": { "id": "u_42", "name": "Ana Reyes" }, "state": null }

// "Who is here?" Sent on joining; everyone answers with their presence.
{ "type": "hello" }

// A comment change; the same changes your store receives (see Comments).
{ "type": "comment", "change": { "type": "comment.add", "threadId": "th_k3j9x2", "comment": { … } } }

// Anything a module wants to say to the same module in other tabs.
{ "type": "custom", "kind": "cell", "data": { "at": "B2" } }
```

Someone who goes quiet for three heartbeats (30 seconds by default) is dropped from `room.peers`. Set `heartbeat` and `timeout` on the room to change that.

A server that wants to log or filter can read these envelopes; it never needs to understand them to relay them.

:::note
Messages from a room are **not trusted**. A peer can announce any name. If that matters, have your server stamp or check the user on `presence` messages, and check who may write in your `CommentStore.save`.
:::
