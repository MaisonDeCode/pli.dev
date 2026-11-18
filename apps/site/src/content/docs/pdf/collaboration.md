---
title: Collaboration
description: Comments, people and presence, live editing, version history and file storage in Pli.PDF, with working code for each.
---

Comments, people, presence, live editing and file storage are shared by every Pli editor. They live in `@pli.dev/core` and know nothing about PDF. An editor connects to them by saying where a comment is anchored, how its operations combine, and where its files are stored. For Pli.PDF that is the table below. For the shared parts themselves see [Comments](/platform/comments/), [Users and permissions](/platform/users/), [Realtime](/platform/realtime/) and [Live editing](/platform/live-editing/).

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


| Shared part | What Pli.PDF adds |
|---|---|
| Comments (`CommentClient`, stores, permissions, @mentions) | `PdfAnchor`: which page, and which annotation, a thread is about. Threads are written into the PDF itself |
| People (`Users`) | Annotations carry who made them. The name goes to the PDF |
| Presence (`CollabRoom`) | What a person is doing: `{ page, selection, tool }` |
| Live editing (`SyncClient`, `createAuthority`) | `pdfSyncModel`: how PDF operations merge |
| File storage (`StorageClient`) | `SourceStore`: where the bytes of PDF files are kept |

## Comments

```ts
import { Users } from "@pli.dev/core";
import { openPdf } from "@pli.dev/pdf";

const users = new Users({ id: "u_1", name: "Sam" });
const session = await openPdf(bytes, { user: { id: "u_1", name: "Sam" } });
const comments = session.comments.enable({ users });      // a CommentClient<PdfAnchor>

const page = session.doc.pages[0]!.id;
const thread = session.comments.addNote(page, 400, 80, "Is this the final price?");   // a sticky note with a comment
comments.reply(thread.id, "Yes, see section 3.");
comments.resolve(thread.id);

const highlight = session.annots.addHighlight(page, [{ x: 72, y: 100, w: 150, h: 14 }], { quote: "total due" });
session.comments.commentOn(highlight, "Check this against the invoice");   // a thread on an existing annotation
```

`session.comments.enable({ users, store?, permissions?, onError? })` returns the same `CommentClient` as in every other editor, with `createThread`, `reply`, `edit`, `delete`, `resolve`, `reopen`, `thread(id)`, `subscribe`, and the same roles and permissions. `addNote` and `commentOn` create the annotation and the thread together as one undo step. Without `enable`, a session has no comments.

A thread's anchor is a `PdfAnchor`, plain JSON:

```ts
interface PdfAnchor {
  page: string;      // the page id
  annot?: string;    // the annotation it belongs to: a note, or a highlight with a comment
  x: number;         // where to show it, in page space
  y: number;
  quote?: string;    // the text it is about
}
```

If the page it is on is deleted, its threads are removed with it; deleting the last comment of a sticky note removes the note.

### Where comments are kept

| `store` | Use it when |
|---|---|
| `"document"` (the default) | Comments should travel with the file. They are saved inside the PDF and read back when it opens |
| A `CommentStore` of your own | Comments belong to your app and live in your database (the same two functions, `load` and `save`, as in [Comments](/platform/comments/#what-your-store-receives)) |

When comments are kept in the PDF, a thread is written the way other readers write conversations, so they show it as one: the annotation's text (`/Contents`) is the first comment, and each reply is a small note with `/IRT` pointing at it, with the author's name, the time and the review state (resolved is saved as the reviewed state). Opening the file reads those back into threads, so comments made in Acrobat or Preview appear as threads, and comments made here appear there. `Annotation.replies` and `Annotation.resolved` hold what was read until a thread takes over.

When comments are kept in your store, the file holds only the annotation (a note's text is its first comment) and the conversation is in your database. With `store`, nothing about comments is saved in the PDF.

An annotation that is not on a saved page, or a thread with no annotation, is not written, and the save warns.

## People and presence

`openPdf(bytes, { user: { id, name } })` stamps what you make with `author` (the `PliUser.id`) and `authorName`, and the name is written to the PDF as the annotation's title (`/T`), which is how other readers show who made it. The id is kept in the file too, so Pli can find the person again. `SaveOptions.authorNames` fills in names for other ids when you save.

Presence is what a person is doing, and each editor decides what that means. For a PDF it is:

```ts
{ page: "p:main:3", selection: ["a_k3j9x2"], tool: "highlight", cursor: { page: "p:main:3", x: 120.5, y: 300 } }
// the page shown, the annotations selected, the tool in hand, and where the pointer is (page space, or null)
```

`PdfEditor`, `AnnotatedPdf` and `PliPdf` do this when you give them a `room`. They tell the room what you are doing, show who is here in the title row and draw other people's selections and pointers. Comments, live editing and storage are props too, and [The PDF editor](/pdf/ready-made-ui/#comments-people-and-live-editing) has all of them together:

```tsx
import { PdfEditor, type PdfRenderer } from "@pli.dev/pdf-react";
import type { CollabRoom, Users } from "@pli.dev/core";
import type { PdfAnchor, PdfSession } from "@pli.dev/pdf";

export function Shared(props: { session: PdfSession; renderer: PdfRenderer; room: CollabRoom<PdfAnchor>; users: Users }) {
  return <PdfEditor session={props.session} renderer={props.renderer} users={props.users} room={props.room} comments sync={{ version: 0 }} />;
}
```

In your own layout, `AnnotatedPdf` takes the pieces by hand. `annotations.onPresence` says what the person is doing, and `annotations.presence` is what to draw.

```tsx
import { useSyncExternalStore } from "react";
import { AnnotatedPdf, presenceFromPeers, type PdfRenderer } from "@pli.dev/pdf-react";
import type { CollabRoom } from "@pli.dev/core";
import type { PdfAnchor, PdfSession } from "@pli.dev/pdf";

export function Annotated(props: { session: PdfSession; renderer: PdfRenderer; room: CollabRoom<PdfAnchor>; user: { id: string; name: string } }) {
  const { room, user } = props;
  const peers = useSyncExternalStore((fn) => room.subscribe(fn), () => room.peers);

  return (
    <AnnotatedPdf
      session={props.session}
      renderer={props.renderer}
      annotations={{
        onPresence: (state) => room.setPresence(state),
        presence: presenceFromPeers(peers, user.id),
      }}
    />
  );
}
```

Other people's selected annotations are outlined in their colour with their name, and their pointer is drawn on the page they are pointing at: an arrow in their colour with their name beside it, the same size at any zoom. The colour is the person's own (`PliUser.color`) or the one `userColor(id)` chooses, as in the "who is here" stack. The pointer's place is sent at most every 50 milliseconds, only while a `room` is given, and only for a mouse or a pen (a finger is scrolling, so it is left out). The pointer disappears when it leaves the pages. `presenceFromPeers` reads it into `cursor` for your own layout. `pdfSyncModel.mapPresence` moves a person off a page that was deleted, and takes their pointer with it.

## Live editing

Everyone sees each other's changes as they happen. It uses the same pieces as [Live editing](/platform/live-editing/): a sequencer on your server (`createAuthority`), a store for the document and its log, and a `SyncClient` in each browser, all generic over a `SyncModel`. Pli.PDF's is `pdfSyncModel`.

The server is the one in [Live editing](/platform/live-editing/#1-the-server), with the PDF's model and a document made from the file:

```ts
import { createAuthority } from "@pli.dev/core";
import { pdfSyncModel, readPdf, type PdfDoc, type PdfOp } from "@pli.dev/pdf";

const authority = createAuthority<PdfDoc, PdfOp>({
  store,                                                     // a DocumentStore<PdfDoc, PdfOp>
  model: pdfSyncModel,
  create: async (room) => readPdf(await loadPdfBytes(room)).doc,   // the file as read: version 0
});
```

The room's first version is the document as read from the file. Name the room after the document and keep the file's bytes under the same name.

The client opens the same bytes, then joins:

```ts
import { CollabRoom, SyncClient, Users, socketTransport, type SocketLike } from "@pli.dev/core";
import { openPdf, pdfSyncModel, type PdfAnchor, type PdfDoc, type PdfOp, type PdfSelection } from "@pli.dev/pdf";

export async function joinPdf(options: { documentId: string; bytes: Uint8Array; user: { id: string; name: string }; socket: SocketLike }) {
  const users = new Users(options.user);
  const session = await openPdf(options.bytes, { user: options.user });
  const comments = session.comments.enable({ users });
  const room = new CollabRoom<PdfAnchor>({ room: options.documentId, transport: socketTransport(options.socket), users, comments });
  const sync = new SyncClient<PdfDoc, PdfOp, PdfSelection>({ session: session.core, room, model: pdfSyncModel, version: 0 });

  options.socket.on("connect", () => sync.setOnline(true));
  options.socket.on("disconnect", () => sync.setOnline(false));
  await room.connect();
  sync.start();
  return { session, room, sync };
}
```

`version: 0` says "I have the file as read": the server then sends only what happened since (or its latest copy, if the log was trimmed). Because the session opened the real file, its `baseline` is right and `session.save()` still writes the original plus the difference. Give the session to the editor as usual, and every edit made through it, including with the annotation tools, is sent. With `PdfEditor` you can leave the `SyncClient` out of your code: pass the `room` and `sync={{ version: 0 }}`, and the editor makes the client, starts it and stops it (see [The PDF editor](/pdf/ready-made-ui/#comments-people-and-live-editing)).

Everyone must open the same bytes, the ones the server's `create` read. A client whose bytes differ gets the server's document, which names a different file, and will not draw or save it correctly. `session.doc.sources[0].hash` is a fingerprint to compare. To continue from a saved file, store the saved bytes under a new document id, which is a new room.

Source files that people merge in during the session are named in the operations (`insert_source`), but their bytes are not: other clients fetch them through the [`SourceStore`](/pdf/files/#storing-the-files). If every client uses the same store (the one over your file storage), a merged file shows up on every screen.

### What merges, and how conflicts resolve

Operations name things by id and by the thing they follow, never by position, so changes to different things never clash. Two people can annotate the same page, turn different pages, or fill different form fields at the same time, and everyone ends with all of it.

| Two people at the same moment | Result |
|---|---|
| Change different things | Both stand |
| Add annotations to the same page, after the same one | Both stay, in the same order for everyone |
| Insert pages at the same place | Both stay, in the same order for everyone |
| Turn or relabel the same page | Different properties both stand (a turn and a label); the same property goes to the later change |
| Change the same annotation, form field value, document information entry or bookmark list | The later change wins as a whole: two people changing different properties of one annotation at once keep only the later person's version |
| Edit the staged text edits and redactions of the same page | The later list replaces the earlier |
| Delete a page while another annotates it | The page goes, with the annotation |
| Both delete the same page or annotation | It is deleted once |
| Insert after a page that was just deleted | It follows the page the deleted one followed |

Undo and redo are each person's own: yours undoes what you did, and leaves others' work alone.

One case can come out different. If one person moves a page (or annotation) while another inserts something after the page that was moved, two clients can briefly disagree about the order. The client sends a fingerprint of its document to the server every 30 seconds (`verifyEvery`) when it has nothing waiting, and when the fingerprints differ it loads the server's copy again and tells you how many of its own unconfirmed changes that cost (`onResync`). In Pli.PDF's tests, a few pairs in hundreds of random simultaneous changes needed it. A lost message is repaired the same way. A reload never leaves a wrong document, but it can cost the last changes that had not been confirmed.

The page's content is not merged, because it is not edited live. Text and picture replacements and redactions are staged operations like the rest, and they are applied when someone saves.

What [Live editing](/platform/live-editing/) says about connections, offline work, access control and more than one server applies unchanged.

## Version history

A named version is a copy of the whole document with a name, who saved it and when ("Sent to legal"). It uses the shared [`VersionHistory`](/platform/versions/) of `@pli.dev/core`; `pdfVersionHistory` makes one for a PDF session:

```ts
import { Users, memoryVersionStorage } from "@pli.dev/core";
import { openPdf, pdfVersionHistory, type PdfDoc } from "@pli.dev/pdf";

export async function nameAndRestore(bytes: Uint8Array) {
  const users = new Users({ current: { id: "u_ana", name: "Ana" }, role: "editor" });
  const session = await openPdf(bytes, { user: { id: "u_ana", name: "Ana" } });
  const history = pdfVersionHistory(session, {
    storage: memoryVersionStorage<PdfDoc>(),   // your own VersionStorage in an app
    users,
  });

  const draft = await history.save("Sent to legal");
  session.pages.rotate([session.doc.pages[0]!.id], 90);
  history.compare(draft.id).lines;             // ["Rotated 1 page"]
  await history.restore(draft.id);             // one undo step
  session.undo();                              // back to the rotated page
}
```

Pass `autoSave` (`{ every, keep, baseline }`) to keep an *Autosaved* version after changes and an *Original* one when the file has none yet, and call `history.dispose()` when the editor goes away (`PdfEditor` does both for the history it makes from `versions`; see `autoSaveVersions`). Add `version: () => sync.version` when the file is live, so each version records its place in the shared log. Saving and restoring need the `editor` role in `users`; anyone can read the list.

### Restoring is an ordinary edit

`restore` does not swap the document behind the editor's back. `pdfVersionSupport.restoreOps(current, version)` returns the PDF operations that turn the document as it is into the version, and they are applied with `session.transact`. So a restore:

- is one undo step: undo puts the document back as it was just before, with the selection;
- changes only what differs: a page, annotation or form field that is the same in both is not touched, and an annotation that kept its place keeps it;
- puts pages and annotations back in the order of the version, with the fewest moves (each thing is placed after the one before it, so it merges with other people's changes like any edit);
- is sent to everyone like any other change, and is merged with what they are doing at that moment;
- first saves the current document as an automatic version named *Before restoring "Name"*, so undo is not the only way back, and saves the result as *Restored "Name"*, so the restore shows in the list in its place in time. Nothing is taken out of the list. Pass `keepBeforeRestore: false` or `keepAfterRestore: false` to turn either off.

It brings back pages (and their rotation, size and label), annotations of every type, form fields and their values, the bookmarks, staged text, picture and redaction edits, the document properties and name, and the comment threads kept in the document. It does not change the document's `id`, which names the file, not what is in it.

```ts
import { pdfReducer, restorePdfOps, summarizePdfOps, type PdfDoc } from "@pli.dev/pdf";

export function whatRestoreDoes(now: PdfDoc, version: PdfDoc) {
  const ops = restorePdfOps(now, version);          // ordinary PdfOps
  const line = summarizePdfOps(ops, now);           // "Added 3 annotations, deleted page 4", or "No changes"
  const result = ops.reduce((doc, op) => pdfReducer.apply(doc, op).state, now);
  return { ops, line, result };                     // result is the version
}
```

The panel's "changes since this version" uses the same line: "Rotated 2 pages, filled 5 form fields". Pages are numbered by where they were when the change came up.

### Looking at a version first

In `PdfEditor`, choosing a version in the History tab shows it in the viewer before anything changes: its pages in their order and turn, its annotations and its form values, read-only, under a bar with **Restore this version** and **Back to current**. The real document, its selection and its undo steps are not touched, and the editor's keys (undo, delete a page) leave it alone while a version is shown. **Current version** at the top of the list, **Back to current** and Escape return to the document. Someone who may not edit sees the preview and no Restore button.

A version keeps the list of its source files (name, size, hash) and never their bytes. The preview draws from the bytes the session's `SourceStore` holds, and the in-memory store keeps every file it was given, so a version with pages of a file that was removed later still shows them and restores. A store that lets go of files cannot show those pages: the preview says which file it is missing (`missingVersionSources(doc, store)` gives the list), and a restore still writes the right operations, with the pages waiting for the file as they do for a page a peer added.

### Pages from other files

A version holds the document's sources (name, size, hash, address) but never the bytes of a file. Pages that came from a file merged in are restored with their source entry, and the bytes come from the session's `SourceStore`, as for any page a peer merged in. If the store has the file (the same session, or `storageSources` over your file storage) the pages draw at once. If it cannot give it (a file this client never had, and the storage no longer has it), the restore still produces the right document and the pages show "Waiting for the file" until the store can supply it. So keep the files of a document in storage as long as its versions are kept.

### How big a version is

A version is the document as JSON, with no file bytes: pages, annotations, fields, bookmarks and threads, so its size follows the number of annotations and fields, not the size of the file. Pictures added to annotations are the exception. They are kept as data in the annotation, so they are part of every version of it. Give the editor a `storage` client ([Pictures](/pdf/annotations/#pictures)) and the version holds an address instead.

### In the editor

`PdfEditor` takes a `history` (any `VersionHistory<PdfDoc, PdfOp>`) or, shorter, `versions` and `users`:

```tsx
import { memoryVersionStorage, type CollabRoom, type Users } from "@pli.dev/core";
import { PdfEditor, type PdfRenderer } from "@pli.dev/pdf-react";
import type { PdfAnchor, PdfDoc, PdfSession } from "@pli.dev/pdf";

export function Editor(props: { session: PdfSession; renderer: PdfRenderer; users: Users; room: CollabRoom<PdfAnchor> }) {
  return (
    <PdfEditor
      session={props.session}
      renderer={props.renderer}
      users={props.users}
      room={props.room}
      sync={{ version: 0 }}
      versions={memoryVersionStorage<PdfDoc>()}   // a History tab and View > Version history
    />
  );
}
```

The editor makes the history with `pdfVersionSupport` and the live-editing position, and keeps *Autosaved* versions (turn that off with `autoSaveVersions={false}`). **View > Version history** opens the History tab. It is the shared panel: a box to name the current version, the list (named versions, automatic ones and restores), a **Current version** row, **Restore this version** (no confirmation: it adds a version and the way back stays in the list), and the "what changed" line. Choosing a version previews it, as described above. The restore applies as one undo step, the page shown stays valid (if it is gone, the page now at its place is shown), and with `sync` it reaches everyone as an ordinary change. Who may save and restore is the panel's own rule: the `editor` role in `users`. Give a person who only looks a `users` with role `viewer` and the panel lists the versions without Save or Restore.

### From the server

A server can save a version of the shared document with no editor open, and read the document at an earlier position of the log:

```ts
import { currentFromStore, stateAtVersion, versionFromStore, type DocumentStore, type VersionStorage } from "@pli.dev/core";
import { pdfSyncModel, restorePdfOps, type PdfDoc, type PdfOp } from "@pli.dev/pdf";

export async function nightly(store: DocumentStore<PdfDoc, PdfOp>, storage: VersionStorage<PdfDoc>, room: string) {
  const saved = await versionFromStore({ store, model: pdfSyncModel, storage, room, name: "Nightly", by: "system" });
  const earlier = await stateAtVersion(store, pdfSyncModel, room, saved.version! - 1);   // null if the log was trimmed
  const now = await currentFromStore(store, pdfSyncModel, room);
  return earlier && now ? restorePdfOps(now.state, earlier) : [];                       // what undoing the last change takes
}
```

## File storage

PDF files are kept through the `SourceStore`, which a `StorageClient` backs: [Files](/pdf/files/#storing-the-files) has a complete adapter, which can be the same client and adapter that Documents uses. Pictures that people add to annotations travel in the annotation as data by default. Give the editor a `storage` client and they are uploaded to it instead, so the document and the operations stay small; the annotation holds the address, and a save fetches and embeds it (see [Pictures](/pdf/annotations/#pictures)). `storageSources(storage)` is the same client keeping the PDF files.

## Tests

PDF sync is tested end to end in the repository with an in-memory server, two clients, comments and merging (`packages/pdf/test/sync.test.ts` and `comments-sync.test.ts`). Restoring a version is tested as a round trip over random documents and operations, and between two live clients (`packages/pdf/test/versions.test.ts`), and through the editor's History tab (`packages/pdf-react/test/versions.test.tsx`).
