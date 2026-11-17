---
title: Live editing
description: Set up the server, the store and the editor so several people can edit the same document at once, with Socket.io, SQL and React.
sidebar:
  order: 6
---

With live editing, everyone in a document sees each other's changes as they happen, nobody's work is lost, and every copy ends up the same. Typing, formatting, tables, undo and comments all merge, and a person who goes offline keeps working and is merged back in when they return.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


It uses the same pipe as [presence and comments](/platform/realtime/), plus a small piece on your server that puts everyone's changes in one order. For how it works and what happens when two people clash, see [How live editing works](/platform/co-editing/).

:::tip
Try it first. In a clone of the repository, `pnpm playground`, then **Collaboration** on the landing page, runs everything on this page: a Socket.io server, simulated teammates, invited tabs, going offline. The code is in `apps/playground/server/` and `apps/playground/src/collab/`.
:::

## What you provide

| Piece | What it is | Where it goes |
|-------|------------|---------------|
| **The pipe** | Socket.io, a WebSocket server, anything that can carry JSON to everyone in a room. You probably have it from [Realtime](/platform/realtime/) | Server and browser |
| **The sequencer** | `createAuthority`: a few lines on your server that take everyone's changes, put them in one order and keep them | Server |
| **The store** | Somewhere to keep each document and the log of changes: a `DocumentStore` over your database | Server |
| **The client** | `SyncClient`, which keeps a `DocumentSession` in step with the server | Browser |

Pli never opens a connection of its own, and never stores anything: the server code is yours, and the database is yours.

## 1. The server

Wherever your Socket.io server relays Pli's messages, send the ones that are about the document to the sequencer, and everything else to the rest of the room as before:

```ts
import { Server } from "socket.io";
import { createAuthority, docSyncModel, isSyncMessage } from "@pli.dev/docs";

const io = new Server(httpServer);

const authority = createAuthority({
  store,                                 // 2. below
  model: docSyncModel,                   // how document changes combine
  create: (room) => loadOrCreateDocument(room),
});

io.on("connection", (socket) => {
  socket.on("pli:join", (room) => socket.join(room));
  socket.on("pli:leave", (room) => socket.leave(room));
  socket.on("pli", (room, data) => {
    if (!socket.rooms.has(room)) return;          // only people in a room may speak in it
    if (isSyncMessage(data)) {
      // The sequencer's answers go to *everyone* in the room, the sender too: that is how it learns its change was taken.
      void authority.receive(room, data, (envelope) => io.to(room).emit("pli", room, envelope));
    } else {
      socket.to(room).emit("pli", room, data);    // presence and comments, as before
    }
  });
});
```

The working version is `apps/playground/server/collab-server.ts` in the repository, about fifty lines.

- **`create(room)`** returns the document for a room nobody has opened yet (it may be async). Load it from your own database if the document already exists there. Without `create`, joining an unknown room is an error.
- **Everything is one room per document.** Use the document's id as the room name.
- **`authorize`** is optional: see [who may do what](#who-may-do-what).
- **`onError(error, room)`** is called when something unexpected went wrong; the client that caused it is told to reload its copy.
- **`snapshotEvery`** (default 100): how often a snapshot is saved, so a document is never replayed from the start. **`maxCatchUp`** (default 500): a client more than this many changes behind is sent the whole document instead.

Not using Socket.io? `authority.receive(room, data, send)` is all there is: call it with each message your server receives from a client (it ignores anything that isn't its own), and make `send` deliver its envelope to everyone in the room. The [Realtime](/platform/realtime/) page has the same relay for a plain WebSocket and for Redis.

## 2. The store

The sequencer holds nothing that matters in memory. A **`DocumentStore`** is where the document lives, as a snapshot and a log of the changes since it:

```ts
interface DocumentStore<State, Op> {
  load(room: string): Promise<{ state: State; version: number } | null>;      // the latest snapshot
  entries(room: string, since: number): Promise<LogEntry<Op>[] | null>;       // changes after `since`, oldest first
  append(room: string, entry: LogEntry<Op>): Promise<boolean>;                // add the next change, if nobody beat us to it
  save(room: string, snapshot: { state: State; version: number }): Promise<void>;
}
```

The one rule is that **`append` is compare-and-set**: an entry for version `n` goes in only if the log is at `n - 1`, and `false` comes back if it isn't. That is what lets you run several servers over one database: when two of them take a change at the same moment, one is told its version is taken, merges its change with the other's, and tries the next. Everything else is plain reading and writing.

`entries` returns `null` when you no longer have what was asked for (you trimmed the log). The client is then sent the snapshot.

### On SQL

Two tables, and one statement that matters. `apps/playground/server/sql-document-store.ts` is a complete, tested store written for SQLite; the same statements work in Postgres with `jsonb` columns and `$1` parameters (`await` each call):

```sql
CREATE TABLE pli_snapshots (room TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);
CREATE TABLE pli_entries (
  room TEXT NOT NULL, version INTEGER NOT NULL, client TEXT NOT NULL, batch TEXT NOT NULL,
  ops TEXT NOT NULL, dropped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room, version)
);
```

`append` is one `INSERT … SELECT … WHERE`, guarded by the primary key:

```sql
INSERT INTO pli_entries (room, version, client, batch, ops, dropped)
SELECT :room, :version, :client, :batch, :ops, :dropped
WHERE COALESCE(
  (SELECT MAX(version) FROM pli_entries   WHERE room = :room),
  (SELECT version      FROM pli_snapshots WHERE room = :room),
  0) = :version - 1
ON CONFLICT DO NOTHING
```

If it inserted a row, return `true`; if not, `false`. The `WHERE` makes sure versions go in order, and the primary key makes sure two racing servers can't both win.

- **Saving a snapshot** is an upsert into `pli_snapshots`. You can then delete entries up to its version (`keepEntries` in the example keeps a few for clients that are slightly behind), or keep them all as a history of the document.
- **Your own document table.** If the document already lives in your database, `load` can read from it and `save` can write back to it. The log is only needed between snapshots.

### Other databases

- **Redis** (not in the playground): keep a list of entries per room and a key for the snapshot. `append` is a `WATCH` on the list, a check that its length is `n - 1`, then `MULTI`/`RPUSH`/`EXEC`; if `EXEC` comes back null, return `false`.
- **For tests and demos:** `memoryDocumentStore()` is built in. It forgets everything when the process stops.

## 3. The client

In the browser, a client keeps a session in step with the server:

```ts
import { CollabRoom, DocumentSession, SyncClient, Users, createDoc, docSyncModel, socketTransport } from "@pli.dev/docs";
import { io } from "socket.io-client";

const socket = io();
const users = new Users(currentUser);                                        // see Users and permissions
const store = myCommentStore;                                                // your CommentStore, see Comments
const session = new DocumentSession(createDoc("", []), { comments: { users, store, synced: true } });
const room = new CollabRoom({ room: documentId, transport: socketTransport(socket), users });
const sync = new SyncClient({ session, room, model: docSyncModel });

socket.on("connect", () => sync.setOnline(true));
socket.on("disconnect", () => sync.setOnline(false));
```

The session starts as a placeholder: the server's copy replaces it when the client joins. If you have a copy of the document you saved earlier **with the version it was at**, pass both (`new DocumentSession(doc)` and `version: 41`) and only what has happened since is sent.

| `SyncClient` option | |
|---------------------|--|
| `session` | The session to keep in step. |
| `room` | A `CollabRoom` on the same pipe and room name as the server. |
| `model` | `docSyncModel` for documents. |
| `version` | The version a stored copy was at. Leave it out to take the server's copy. |
| `verifyEvery` | How often to check a fingerprint of the document against the server's, in ms. Default 30 seconds, `0` for never. |
| `onResync` | Called with `{ reason, lost }` when the document is reloaded from the server, and how many unconfirmed changes that cost. |

| On the client | |
|---------------|--|
| `start()` / `stop()` | Begin and end. `PliDocument` does this for you. |
| `setOnline(boolean)` | Tell it the connection dropped or came back. |
| `status` | `"connecting"`, `"synced"`, `"saving"`, `"offline"` or `"resyncing"`. |
| `unsynced` | How many of your changes the server hasn't taken yet. |
| `version` | The version of the shared document taken in, or `null` before it has joined. |
| `subscribe(fn)` | Hear about any of the above changing. |
| `resync()` | Throw away local state and load the server's document. |

## 4. In the editor

```tsx
<PliDocument session={session} sync={sync} />
```

`PliDocument` starts the client when it appears and stops it when it goes away, and connects the client's room, so presence and comments work from the same connection. It also:

- shows a **connection indicator** next to the title: *Saved*, *Saving…*, *Offline · 2 changes waiting*, *Connecting…*, *Reloading…*;
- keeps the page **read-only until the document has arrived** (and again while it reloads), with the toolbar greyed in place so nothing jumps;
- asks before you **leave the page with changes that haven't been sent**;
- tells you if the document was **reloaded and it cost you changes** ("your last 2 changes may not have been saved"). A reload that cost nothing says nothing.

To put the status elsewhere in your interface, use `useSyncStatus(sync)` (it returns `{ status, unsynced, version, lastResync }`) or the `SyncIndicator` component.

## Going offline and coming back

Tell the client when the connection drops and returns (`setOnline`, as above). While offline, people keep typing: their changes are kept, the indicator says how many are waiting, and the page isn't locked. When the connection returns, the client asks the server what it missed, merges what it did with what everyone else did, and sends its changes. A batch that was sent just before the connection dropped is sent again, and the server takes it only once.

This is built for connections that drop and return, not for days of offline work. If a client is very far behind, it is sent the whole document and its unsent changes are lost (you are told how many with `onResync`).

## Comments, cursors and who is here

They travel through the same room, and need nothing extra. Two settings go with live editing:

- Give the session `comments: { users, store, synced: true }`. A comment's highlight is then an ordinary change that goes to everyone with the rest of the edits, instead of being put back from the comment's position.
- Give `PliDocument` the room (or let it use the sync client's) so it can show who is here and where their cursors are. Cursors, and each person's caret, stay with their text as others edit.

Comments themselves are kept the way [Comments](/platform/comments/) describes, in your store.

## Running more than one server

Because the sequencer keeps nothing that matters in memory and `append` is compare-and-set, any number of server processes can share one store. Two things to arrange:

1. **The same store** for all of them (one database).
2. **Messages reach everyone in the room**, whichever server they are connected to. With Socket.io, use its [Redis adapter](/platform/realtime/#redis-for-more-than-one-server), so `io.to(room).emit` crosses servers.

There is no need for a room to stick to one server.

## Who may do what

The browser can't be trusted, so enforce access on the server:

- **Who may join** a room: check in your `pli:join` handler, before `socket.join`.
- **Who may change the document**: pass `authorize` to `createAuthority`. It is asked about each message, and a `false` answer makes the sequencer ignore it and tell that client to reload:

```ts
// Which socket each connection id belongs to: the id a browser puts on its messages (`room.client`) is only a claim, so
// tie it to the first socket that uses it, and ignore anyone else who claims it.
const owner = new Map<string, Socket>();

io.on("connection", (socket) => {
  socket.on("pli", (room, data) => {
    const id = (data as { client?: unknown } | null)?.client;
    if (typeof id !== "string" || (owner.get(id) ?? socket) !== socket) return;
    owner.set(id, socket);
    // …then as above
  });
  socket.on("disconnect", () => { for (const [id, s] of owner) if (s === socket) owner.delete(id); });
});

const authority = createAuthority({
  store,
  model: docSyncModel,
  authorize: async ({ room, client, message }) => {
    const user = owner.get(client)?.data.user;               // whatever your sign-in put on the socket
    const role = user ? await roleOf(user, room) : null;
    return message.type === "ops" ? role === "editor" : role !== null;   // viewers can join but not change
  },
});
```

- **Viewers** should also get `readOnly` on `PliDocument`, so the editor doesn't let them type changes that would be refused.

What a client sends is checked as it is applied: a change that doesn't fit the document is refused, never half-kept.

## What to expect

- **Everyone ends up with the same document.** This is tested by a fuzzer that makes random edits from several people, with delays, dropped messages and undo, and checks the result thousands of times over.
- **Both people's work is kept** wherever that makes sense. Two people typing in the same place both get their text; one person deleting a paragraph while another types in it loses the typing. The [full list of how clashes resolve](/platform/co-editing/#known-conflicts) is on the next page.
- **A lost message costs a reload, never a wrong document.** A client that sees a gap, can't apply a change, or whose fingerprint differs from the server's reloads the server's copy.

## When something is wrong

| You see | Likely cause |
|---------|--------------|
| **Connecting…** and the page stays read-only | The server isn't answering joins. Check that sync messages reach `authority.receive` (the `isSyncMessage` branch), that the socket joined the room (`pli:join`), and that the browser and server use the same room name. In the playground, the **On the wire** panel shows the join and the reply. |
| **Saving…** that never turns to **Saved** | The sequencer's answers aren't reaching the sender. A common cause is sending them with `socket.to(room)`, which leaves the sender out: use `io.to(room)`. Or `authorize` returned `false`, or the authority threw (see `onError`). |
| It keeps **Reloading…** | Messages are being lost or arriving out of order: a transport that doesn't keep order, or several servers without a shared adapter. Or `append` isn't really compare-and-set, so two servers wrote the same version. |
| Someone's changes appear only after a reload | They never reached the room: check the relay for messages that aren't sync messages, and whether the sender is in the room. |
| "No document for room …" in `onError` | You gave no `create`, and the room has no document. |
| It never shows **Offline** | The client only knows what you tell it: call `setOnline(false)` from the socket's `disconnect` event. |

## For another editor

`SyncClient`, `createAuthority` and `DocumentStore` know nothing about documents. A sheet, a deck or a board gives them a `SyncModel`: how to apply one of its operations, how to `transform` two lists of them, how to `hash` its state, and optionally how to move a selection or a cursor through changes. Everything on this page then works the same. [Pli.PDF](/pdf/collaboration/#live-editing) does exactly this, with `pdfSyncModel`.

### Going live in one call

`attachSync` does what an editor's mount code does by hand: it starts a `SyncClient`, shares the file's comments through the room, connects the room if nobody has, and follows the socket's connection state.

```ts
import { attachSync } from "@pli.dev/core";

const live = attachSync(session, sheetSyncModel, { room, comments: session.comments, socket });
await live.ready;        // the shared copy has arrived
live.sync.status;        // "synced" | "saving" | "offline" …
live.stop();             // stops syncing, takes the comments off the room, disconnects a room it connected
```

Every editor session also offers it as `editorSession.attachSync(room, options)`: see [Scripting and the editor session](/platform/scripting/).

### Merging text in any editor

An editor with rich text (a paragraph, a text box on a slide, a PDF text edit, a cell being edited) does not need to write the text merge again. `@pli.dev/core` has one:

```ts
import { transformText, applyTextOps, mapPosition, mapRange, type TextOp } from "@pli.dev/core";

// Edits to one run of text: insert, delete, and format (attributes set, or removed with null).
const mine: TextOp[]   = [{ type: "insert", at: 5, text: "very ", attrs: { bold: true } }];
const theirs: TextOp[] = [{ type: "delete", from: 0, to: 3 }];

const [mineAfterTheirs, theirsAfterMine] = transformText(mine, theirs);   // theirs was accepted first
applyTextOps(applyTextOps(runs, theirs), mineAfterTheirs);                // same runs as the other order

mapPosition(caret, theirs);          // where a caret goes
mapRange({ from: 4, to: 9 }, theirs) // where a selection or a comment's anchor goes; null if its text was all deleted
```

The editor wraps these in its own operations (`insert_text` in block X is "insert, in X") and calls `transformText` when two operations name the same text. Rules: text typed at the same place goes in the order the server accepted it; text typed inside a range someone deleted is kept; two formats of the same attribute on the same text go to the later one; text typed inside a formatted range is not formatted. It is tested with a fuzzer that checks both orders give the same runs, attributes included, over hundreds of random edit lists.

### One server, any editor

The playground's server (`apps/playground/server/collab-server.ts`) serves every editor from one process, with the same `createAuthority` and the same `DocumentStore`. A room is named for its editor, `kind:id` (`sheet:budget`, `deck:launch`, `pdf:contract`; a plain name is a `document`), and each kind is registered with the model that merges it:

```ts
import { EditorRegistry } from "@pli.dev/core";
import { attachCollabServer } from "./collab-server";

const editors = new EditorRegistry([
  { kind: "document", model: docSyncModel, create: () => emptyDoc() },
  { kind: "sheet", model: sheetSyncModel, create: (room) => createWorkbook(room) },
  { kind: "kanban", model: boardSyncModel, create: () => emptyBoard() },     // an editor of your own
]);

attachCollabServer(httpServer, {
  editors,
  store: sqlDocumentStore(db),              // one store for every kind: the room name keeps the files apart
  authorize: ({ socket, room, kind, action, message }) => canDo(socket.data.user, room, action, message),
});
```

`create` makes the file for a room nobody has opened; a kind that is not registered is refused on joining (`pli:refused`). `authorize` is asked when a connection joins a room, for every sync message (`message.type` is `join`, `ops` or `hash`, so a viewer can join and read but not change), and for each comments, versions and sharing call. The server also keeps comments, named versions and sharing settings per room, and the client side has an adapter for each over the same socket (`serverCommentStore`, `serverVersionStorage`, `serverSharingStore` in `apps/playground/src/collab/connection.ts`): the pattern your own database would follow.

The integration tests (`apps/playground/test/multi-editor-server.test.ts`) run real Socket.io connections, in process, for two people on a sheet-like and a deck-like model that the test defines (so the server is tested without the real editors), and for the real document, PDF, sheet and deck models.

## Not yet

- **Long offline editing**, merging days of divergence.
- **Suggestions** (tracked changes).
- **Sheets** have their own rules for what merges ([Pli.Sheets collaboration](/sheets/collaboration/#what-merges-and-how-conflicts-resolve)); a table or pivot table edited by two people at once is last one wins as a whole object.
- **Table structure edits** in a document merge by "last one wins": a row inserted at the same moment someone types in that table can drop the keystroke. Cell text itself merges fine.
- **Headers, footers and footnotes** are edited in their own box and saved when you finish, then synced as a whole. They don't merge character by character.
- **Joining two paragraphs** while someone types in the second one loses that typing.
