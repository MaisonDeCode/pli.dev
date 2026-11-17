---
title: Collaboration
description: Comments, people and presence, live editing and file storage in Pli.Decks, with code for each.
---

Comments, people, presence, live editing and file storage live in `@pli.dev/core` and are the same in every Pli editor. They know nothing about slides, so Pli.Decks tells them three things: where a comment is anchored, how its operations combine, and where its files are stored. For the parts themselves see [Comments](/platform/comments/), [Users and permissions](/platform/users/), [Realtime](/platform/realtime/) and [Live editing](/platform/live-editing/).

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


| Shared part | What Pli.Decks adds |
|---|---|
| Comments (`CommentClient`, stores, permissions, @mentions) | `DeckAnchor`: which slide, which object, which words or which place on the slide. Threads are saved in the deck and in the `.pptx` file |
| People (`Users`) | The authors of comments; their names go to PowerPoint |
| Presence (`CollabRoom`) | What a person is doing: `{ slide, selection, caret, present }` |
| Live editing (`SyncClient`, `createAuthority`) | `deckSyncModel`: how deck operations merge, down to the character |
| File storage (`StorageClient`) | `storeImages`, `saveDeck`, `storeTemplate`, `storageFontSource`: pictures, the deck, templates and fonts through your adapter |

## Comments

```ts
import { Users } from "@pli.dev/core";
import { DeckSession, createDeck } from "@pli.dev/decks";

const users = new Users({ id: "u_1", name: "Sam" });
const session = new DeckSession(createDeck());
const comments = session.comments.enable({ users });      // a CommentClient<DeckAnchor>

const slide = session.deck.slides[0]!.id;
const title = session.deck.slides[0]!.elements[0]!.id;

session.comments.commentOnSlide(slide, "Shorter intro, please", { x: 480, y: 40 });    // about the slide, at a place
const thread = session.comments.commentOnElement(slide, title, "Is this the final title?");
session.comments.commentOnText(slide, title, { from: { p: 0, o: 7 }, to: { p: 0, o: 11 } }, "Which plan?");   // about some words
comments.reply(thread.id, "Yes.");
comments.resolve(thread.id);
```

`session.comments.enable({ users, store?, permissions?, onError? })` returns the same `CommentClient` as in every other editor, with `createThread`, `reply`, `editComment`, `deleteComment`, `resolve`, `reopen`, `thread(id)`, `subscribe`, the same roles and permissions, and @mentions (`reply(id, body, mentions)`). Without `enable`, a session has no comments. Commenting is not an undo step: undo takes back what you typed, not what you said.

A thread's anchor is a `DeckAnchor`, plain JSON:

```ts
interface DeckAnchor {
  slide: string;                                          // the slide id
  element?: string;                                       // an object on it
  text?: { from: number; to: number; cell?: [number, number] };   // words inside it (in a table cell with `cell`)
  point?: { x: number; y: number };                       // a place on the slide, in points
  quote?: string;                                         // the words, or the object's text, kept short
}
```

The anchor keeps its place because it names things by id. Reordering slides, duplicating them (a copy does not copy the thread) or moving objects changes nothing. The words are marked in the text itself (`Marks.comment`), so the highlight follows them while other people type around them; `text.from` and `text.to` are only where the words were when the comment was made. `session.comments.anchorState(thread)` says where a thread is now:

| Gone | `orphan` | Shown |
|---|---|---|
| Nothing | `null` | On its slide, with its object or words |
| The words (the text was deleted) | `"text"` | On its object |
| The object | `"element"` | On its slide |
| The slide | `"slide"` | Under **All** and **Resolved**, labelled "Deleted slide"; undoing the delete brings it back |

`session.comments.threadsOn(slideId)` lists a slide's threads (orphans of its objects included), `orphans()` the threads of deleted slides.

### Where comments are kept

| `store` | Use it when |
|---|---|
| `"document"` (the default) | Comments travel with the deck: they are in `deck.comments`, in Pli JSON, in the `.pptx` file and in live editing |
| A `CommentStore` of your own | Comments belong to your app and live in your database (the same two functions, `load` and `save`, as in [Comments](/platform/comments/#what-your-store-receives)) |

With live editing on, the comments of the deck travel with its changes (a reply from one person and a resolve from another merge; see below), and the room's comment messages are not written into the deck a second time.

### In PowerPoint and Google Slides

`toPptx` writes the threads and `fromPptx` reads them, with replies, who wrote each, when, whether it is resolved, and the object or words it is about:

```ts
const bytes = toPptx(session.deck, {
  comments: "legacy",                                       // or "modern", or "none"
  commentAuthor: (id) => ({ name: directory.get(id).name }), // the name PowerPoint shows
});
const { deck, commentAuthors } = fromPptx(bytes, { commentAuthor: (a) => userIdFor(a.name) });
```

| `comments` | Written | Read by |
|---|---|---|
| `"legacy"` (default) | `ppt/commentAuthors.xml` and `ppt/comments/comment1.xml`…; a reply is a comment whose `p15:threadingInfo` names its parent | PowerPoint 2007 and later, Google Slides, LibreOffice |
| `"modern"` | `ppt/authors.xml` and `ppt/comments/modernComment_*.xml`: replies inside their comment, a resolved status, the shape or words a comment is about | Microsoft 365 |
| `"none"` | Nothing | |

Both forms are read whatever you write. Files made by PowerPoint have an author's name and no user id: `commentAuthor` says which of your users a name is (the default makes `pptx:ada-lovelace`), and `PptxImport.commentAuthors` lists the names so you can add them to your `Users`. What PowerPoint has no place for (which words, who is mentioned, Pli's own ids, a resolved state in legacy comments) is kept in an extension that PowerPoint ignores, so a deck written by Pli and read by Pli comes back unchanged; in a file made by PowerPoint a legacy comment is never resolved, and a comment about words is a comment about their shape. Threads on a slide that is gone are not written.

### In the editor

Give `PliDeck` the `users` and `comments`:

```tsx
<PliDeck session={session} users={users} comments />
```

- A **bubble** on the slide for each open thread: at its place, or at the top right of the object it is about. A resolved thread's bubble goes away. A thread whose object or words are gone shows a dashed bubble.
- A **count** on the filmstrip's thumbnail of each slide that has open threads.
- The **Comments panel** (Insert > Comment, right-click > Comment, **Ctrl+Alt+M**, or the Comments button in the title row) with a box for the comment being started and the tabs **This slide**, **All** and **Resolved**. Starting a comment while editing selected text comments on the words; with an object selected, on the object; otherwise on the slide. Each thread is the shared card from `@pli.dev/react`: replies, @mentions, edit, delete, resolve and reopen.
- Clicking a bubble or a thread goes to its slide, selects its object and highlights its words.

## People and presence

Presence is what a person is doing, and each editor decides what that means. For a deck it is:

```ts
{
  slide: "s_9k2",                                  // the slide shown (null in the master view)
  selection: ["e_41", "e_42"],                     // the selected objects
  caret: { element: "e_41", anchor: 5, focus: 9 }, // the text cursor or selection inside the text being edited (with `cell` in a table)
  present: { slide: "s_9k2", step: 1 },            // during a slideshow: the slide shown and how many animation steps have run
  surface: "s_9k2",                                // the same slide, under the name the shared interface reads
}
```

`PliDeck` does this when you give it a `room`: it tells the room what you are doing and shows the others:

```tsx
import { CollabRoom, Users, socketTransport } from "@pli.dev/core";

const users = new Users({ id: "u_1", name: "Sam" });
const room = new CollabRoom({ room: deck.id, transport: socketTransport(io()), users });

<PliDeck session={session} room={room} users={users} comments sync />;
```

- **Avatars** of who is in the deck, in the title row.
- A **coloured dot** on the filmstrip's thumbnail of the slide each person is on.
- Each person's selected objects as an **outline in their colour with their name**, on the slide you are both on.
- The **text cursor and selection** of someone typing in a text object, with their name; it stays with the words while you type above it (`deckSyncModel.mapPresence`).
- **Follow the presenter.** While someone gives a slideshow, a banner says so with a **Follow** button. Following opens a slideshow that goes to the slide and animation step they are on, whenever it changes; Esc leaves it, and it ends when theirs does. Someone who is presenting publishes `present`; nobody else's show moves with it unless they follow.

## Live editing

Everyone sees each other's changes as they happen. It uses the same pieces as [Live editing](/platform/live-editing/): a sequencer on your server (`createAuthority`), a store for the deck and its log, and a `SyncClient` in each browser, all generic over a `SyncModel`. The model for decks is `deckSyncModel`.

**The server** is the one in [Live editing](/platform/live-editing/#1-the-server), with the deck's model:

```ts
import { createAuthority } from "@pli.dev/core";
import { createDeck, deckSyncModel, type Deck, type DeckOp } from "@pli.dev/decks";

const authority = createAuthority<Deck, DeckOp>({
  store,                                  // a DocumentStore<Deck, DeckOp>
  model: deckSyncModel,
  create: async (room) => (await loadSavedDeck(room)) ?? createDeck(),   // the deck for a room nobody has opened
});
```

**The client** is one prop on the editor, which creates the `SyncClient` and starts and stops it:

```tsx
<PliDeck session={session} room={room} users={users} sync={{ onResync: ({ lost }) => toast(`Reloaded; ${lost} changes were not saved`) }} />
```

With the room connected, the title row shows the sync state (`SyncIndicator`, with `useSyncStatus` for your own). Without React, make the client yourself, with `session.core`:

```ts
import { SyncClient } from "@pli.dev/core";
import { deckSyncModel, type Deck, type DeckOp, type DeckSelection } from "@pli.dev/decks";

const sync = new SyncClient<Deck, DeckOp, DeckSelection>({ session: session.core, room, model: deckSyncModel });
session.syncing = true;          // comments then travel with the changes
sync.start();
```

The session stays scriptable: `session.setFrame`, `setText`, `addSlide` and all the other commands work as before, and each is sent as the small changes it makes. Undo and redo are **each person's own**: yours takes back what you did and leaves others' work alone (the undo history is rebased over what others did).

### What merges, and how conflicts resolve

A command that rewrites a whole object is turned into the changes it really makes: one change for each value that differs (`set_path`, for example the `x` of a shape) and one for the text (`edit_text`, a character-level edit with formatting). Changes to different things never clash.

| Two people at the same moment | Result |
|---|---|
| Move or resize a shape, recolour it, change its line | Everything stands |
| Change the **same property** of the same object (both move it) | The later change wins that property; the other properties of both stand |
| Type in the same text box (a shape or a table cell) | Both keep their words, character by character, formatting included; text typed at the same place goes in the order the server accepted it |
| Make a word bold while someone types in it | Both stand |
| Edit different table cells, or one cell | Cells merge; one cell's text merges as text |
| Edit different values of a chart's data, or its title and its series colours | Both stand |
| Replace a whole fill, a whole table structure (add a row or column), a whole series list | The replacing change wins over a change to a value inside it, whichever came first |
| Change different theme colours, fonts or text styles of a master, rename layouts | Both stand; the same value goes to the later change |
| Type in the speaker notes | Merged character by character |
| Insert, delete and move **slides**, **objects** (drawing order) or **layouts** | Every position is kept however they cross: two slides inserted at one place keep the order the server accepted; moving one slide twice goes to the later move |
| Delete an object, a slide or a layout while someone edits it | The edit is dropped; the delete stands. Deleting something twice deletes it once |
| Delete a layout while someone makes a slide with it | The new slide goes with the layout |
| Group, ungroup, rescale (everything on a slide rewritten at once) while someone edits that slide's objects | The rewrite wins |
| Reply to the same thread, edit different comments | All replies stay, in the order they were written |
| Resolve and reopen the same thread, or edit the same comment | The later change wins |
| Two people delete a different slide each and the deck is empty | Someone's editor adds a blank slide: a deck always has one |

Other people's changes also update your selection. Objects that were deleted leave it, and if the slide you were on is deleted you are shown the one that took its place. The text cursor in an object someone else is typing in moves with the words (`mapMeta`, `mapPresence`).

**Not merged:** someone deletes a layout or master while another person changes a slide to use the deleted layout. The server leaves the second change out and that person's editor reloads the deck (`onResync`), so nothing is left wrong. A change that rewrites a text box as a whole (pasting a different text over all of it) is merged as the characters it differs by, which can be more than the person meant when the old and new texts have little in common. When it has nothing waiting, the client sends a fingerprint of its deck to the server every 30 seconds. If the two differ, it loads the server's copy again.

Everything that was said about connections, offline work, access control and more than one server on [Live editing](/platform/live-editing/) applies unchanged.

## File storage

Pictures, the deck, the templates it was made from and its fonts can live in your storage instead of inside the deck as base64. The storage client (`StorageClient`) and adapter are the same ones Documents and PDF use. Without a client, pictures are embedded as `data:` addresses.

```ts
import { StorageClient, type StorageAdapter } from "@pli.dev/core";
import { inlineImages, loadDeck, resolveImages, saveDeck, storeImages, toPptx } from "@pli.dev/decks";

// An adapter is a few functions over your storage (here S3-style signed URLs).
const adapter: StorageAdapter = {
  async upload(file, info) {
    const key = `decks/${crypto.randomUUID()}-${info.name}`;
    await fetch(await signedPutUrl(key, info.type), { method: "PUT", body: await file.arrayBuffer() });
    return { ref: key };
  },
  resolve: (ref) => signedGetUrl(ref),
  async read(ref) {
    const bytes = await (await fetch(await signedGetUrl(ref))).arrayBuffer();
    return { size: bytes.byteLength, type: "application/octet-stream", arrayBuffer: async () => bytes };
  },
};
const storage = new StorageClient(adapter, { maxBytes: 20_000_000 });

const saved = await saveDeck(session.deck, storage, { name: "launch.deck.json" });   // pictures go up first; then the deck, with references
session.load(await loadDeck(saved.ref, storage));
const shown = await resolveImages(session.deck, storage);   // references become addresses a browser can load
const file = toPptx((await inlineImages(session.deck, storage)).deck);   // and become data for a PowerPoint or PDF file
```

| Function | What it does |
|---|---|
| `storeImages(deck, storage)` | Uploads the embedded pictures (equal pictures once) and returns the deck with their references; what can't be uploaded stays embedded and is listed in `failed` |
| `resolveImages(deck, storage)` | The deck with each reference replaced by an address to show |
| `inlineImages(deck, storage)` | The deck with each reference replaced by its data, for `toPptx` and `toPdf` (needs the adapter's `read`) |
| `saveDeck(deck, storage)` / `loadDeck(ref, storage)` | The deck as one JSON file in storage, its pictures stored first |
| `storeTemplate(file, storage)` / `loadTemplate(ref, storage)` | Keeps a `.pptx`/`.potx` template with the deck and imports masters and layouts from it |
| `storeFont(file, storage, face)` / `storageFontSource(fonts, storage)` | Font files of your own: the browser loads each from `storage.resolve`, and PDF export embeds the bytes from `storage.read` (give it to `createFonts({ source })`) |

`PliDeck`'s `uploadImage` prop (pictures that people add) is the same idea for one picture; pass `async (file) => (await storage.upload(file)).ref`.

## Check it works

The merge rules are tested in the repository with a fuzzer that makes random changes by random people and checks that every order gives the same deck (`packages/decks/test/convergence.test.ts`, scaled with `FUZZ_RUNS`), with named cases (`sync-cases.test.ts`), and with real `SyncClient`s and sessions over a network that loses messages (`sync.test.ts`). Comments, PowerPoint files and storage have their own tests (`comments.test.ts`, `pptx-comments.test.ts`, `storage.test.ts`), and the editor's (`packages/decks-react/test/collab.test.tsx`).
