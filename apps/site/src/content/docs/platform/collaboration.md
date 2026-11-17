---
title: Comments and collaboration
description: How comments, people and live presence work in every Pli editor, and which parts your app supplies.
sidebar:
  order: 2
---

Comments and collaboration are part of Pli's core, shared by every editor: Documents, [PDF](/pdf/collaboration/), Sheets and Decks use the same pieces, and Boards, Forms and Databases will. They fit around what your app already has.

Your app almost certainly has **users**, somewhere to **keep comments**, and maybe a **realtime server**. Pli asks for each of these through a small interface, and ships working defaults for the demo case.

| You already have | Pli asks for | Page |
|------------------|--------------|------|
| Accounts and a user list | A `UserDirectory`: who is signed in, and how to look people up | [Users and permissions](/platform/users/) |
| A database or an API | A `CommentStore`: load threads, and save one change at a time | [Comments](/platform/comments/) |
| Socket.io, a WebSocket server, Redis, Ably, Pusher | A `Transport`: carry JSON to everyone else in a room | [Realtime](/platform/realtime/) |
| A place that says who may open a file | A `SharingStore`: load the settings, save one change at a time | [Sharing](/platform/users/#sharing) |
| Somewhere to keep copies of a file | A `VersionStorage`: list, get, save, remove | [Versions](/platform/versions/) |

You can use any one without the others. Comments work with no server at all (they live in the document). Presence needs only a transport. A viewer who isn't signed in can read comments but not write them.

## What is shared and what is not

Everything that does not depend on the kind of file lives in `@pli.dev/core`:

- `Users`, `PliUser`, roles and permissions, and `ShareClient` for who a file is shared with
- `Thread`, `Comment`, `CommentChange`, `CommentStore` and `CommentClient`, and `AnchorTracker` so threads follow their content
- `Transport`, `CollabRoom`, presence (colours, idle and away, throttling), and the ready-made transports
- Live editing: `SyncClient`, `createAuthority`, `DocumentStore`, `attachSync`, and the text-edit transform that rich text of any editor reuses
- `VersionHistory` and `ActivityFeed`: named versions and a feed of comments, mentions and edits
- `EditorSession` and `ScriptHost`: the one contract every editor's session offers, and a safe way for scripts to drive it
- `StorageClient` for files

The interface for all of it is shared too: avatars, comment threads, the Share dialog, version history, sync and offline indicators and toasts, in `@pli.dev/react/collab` ([Shared interface](/platform/shared-ui/)).

What is different per editor is only the **anchor**: where a thread is attached. A thread in a document is attached to a range of text. A thread in a PDF is attached to a page and an annotation on it, one in a sheet is attached to a cell, and one in a deck to an object on a slide. The anchor is plain JSON that only that editor reads, so the same stores, servers and payloads work for all of them. And the **merge rules**: how two people's operations combine is each editor's `SyncModel`.

| | Documents | PDF | Sheets | Decks |
|---|---|---|---|---|
| `EditorSession` adapter | `documentEditorSession` | `pdfEditorSession` | `sheetEditorSession` | `deckEditorSession` |
| Sync model | `docSyncModel` | `pdfSyncModel` | `sheetSyncModel` | `deckSyncModel` |
| Comments | yes | yes | yes: on a cell or range; threaded comments in `.xlsx` files too | yes: on a slide, an object or words; in `.pptx` files too |
| Version support | `docVersionSupport` | `pdfVersionSupport` | `sheetVersionSupport` | not yet |

## Quick start (Documents)

```ts
import { DocumentSession, Users, CollabRoom, socketTransport } from "@pli.dev/docs";
import { PliDocument } from "@pli.dev/react";
import { io } from "socket.io-client";

// 1. Tell Pli who the user is. Your app already knows.
const users = new Users({
  current: { id: "u_42", name: "Ana Reyes", avatar: "https://…/ana.png" },
  lookup: (ids) => fetch(`/api/users?ids=${ids.join(",")}`).then((r) => r.json()),
});

// 2. Turn comments on. With no store, threads are saved inside the document.
const session = new DocumentSession(doc, { comments: { users } });

// 3. Optional: a room, for live comments, who is here, and their cursors.
const room = new CollabRoom({ room: doc.id, transport: socketTransport(io()), users });

<PliDocument session={session} room={room} />;
```

## Try it

The playground has a **Collaboration** screen (from a clone of the repository: `pnpm playground`, then **Collaboration** on the landing page; invitation links open it directly at `#/collaboration`). It does live co-editing through a small Socket.io server that `pnpm playground` starts with the dev server (`apps/playground/server/collab-server.ts`, a worked example of the [server recipe](/platform/live-editing/#1-the-server)). Your document is in a room with simulated teammates (Ben, Cleo and Dev), and each of them is a full participant: their own connection to the server, their own copy of the document, their own sync client, comment client and cursor. They move their cursors, type in their own notes, edit your paragraphs, start comment threads and reply to yours, and their changes are merged with yours as you type.

- **Type while they type.** Put your caret in a paragraph, start a teammate on "Edit your text", and keep typing. Nothing is lost, and your caret stays with your text.
- **Invite someone** gives a link that opens another tab, window or browser as a second person (Mia, Noah or Zoe). You edit the same document, and see each other's cursors and comments. A tab that joins late gets the document as it is and the comments so far.
- **Go offline** cuts your connection. Keep typing (the indicator says how many changes are waiting), then reconnect: your changes are merged with what everyone did meanwhile.
- **On the wire** lists what the room and the comment store see, with the JSON for each message: the changes going to the server and accepted by it, cursors, comments, and what your own `CommentStore` would be asked to save.
- **Autopilot** makes the teammates act on their own at a calm, normal or busy pace.

The **Share** button opens the Share dialog (people from the lab's directory, roles, link access) and **Version history** names and restores versions of the document, both kept by the server like the comments. The server keeps everything in memory, so it is forgotten when it stops.

## What works live

[Text edits](/platform/live-editing/), formatting, tables, comments, cursors and who is here all work live. Text edits need the extra pieces described in [Live editing](/platform/live-editing/): a sequencer on your server and somewhere to keep the document. Without them, people, cursors and comments still work, and each person has their own copy of the text until your app saves and loads it.

When a comment reaches someone whose copy of the document has no highlight for it, and the document isn't being synced, Pli finds the quoted text and puts the highlight there. With live editing the highlight is an ordinary change and arrives on its own (`comments: { synced: true }`).

## Design notes

- **Pli never talks to your server by itself.** It calls the functions you give it, and the transport you give it. Nothing is sent anywhere by default.
- **Everything is JSON.** A comment, a change, a presence message: you can log them, queue them, and write them to any database. The payloads are documented on each page.
- **Every change is safe to apply twice**, so a store that also pushes changes, plus a transport, do not double comments.
- **Failures are taken back, not hidden.** If your store refuses a change, the change disappears from the screen and `onError` tells you why.
