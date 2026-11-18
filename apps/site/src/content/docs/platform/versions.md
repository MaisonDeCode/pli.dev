---
title: Versions and activity
description: Named versions of any file, restoring one as an ordinary undoable edit, and an activity feed built from comments and edits.
sidebar:
  order: 8
---

Every Pli editor can keep **named versions** ("Sent to the board") and show an **activity feed** ("Ana mentioned Ben"). Both are built once in `@pli.dev/core` and work for documents, sheets, decks, PDFs and the editors to come. Like comments, they keep nothing of their own: you say where versions are stored, and Pli does the rest.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


## Named versions

A version is a copy of the whole state with a name, who saved it and when. `VersionHistory` is the client:

```ts
import { VersionHistory, memoryVersionStorage } from "@pli.dev/core";
import { docSyncModel, docVersionSupport, documentEditorSession } from "@pli.dev/docs";

const history = new VersionHistory({
  file: doc.id,
  session: documentEditorSession(session),   // anything with `state` and `transact`
  storage: myVersionStorage,                 // see below
  users,                                     // who is signed in, and their role
  support: docVersionSupport,                // how this editor restores and compares
  hash: docSyncModel.hash,
  version: () => sync.version,               // the position in the shared log, if shared
});

await history.save("Sent to the board");
history.versions;                            // newest first
await history.restore(history.versions[0].id);
history.compare(history.versions[1].id);     // { added, removed, changed, lines: ["3 blocks were edited"] }
```

Saving, restoring and deleting need the **editor** role. Anyone can read the list.

### Restoring is an ordinary edit

`restore` does not swap the state behind the editor's back. The editor's `VersionSupport.restoreOps(current, target)` returns **operations** that turn the file as it is into the version, and they are applied with `transact` like anything else. So a restore:

- is **one undo step**: press undo and you are back where you were;
- is **merged** with what other people are typing at that moment, and sent to everyone as a normal change;
- shows up in the **activity feed** and the sync log like any other edit.

Nothing is ever taken out of the list. Before it restores, `VersionHistory` saves the current state as an automatic version named *Before restoring "Name"*, so even undo is not the only way back. After it restores, it saves the result as a version of its own, named *Restored "Name"*, so the restore shows in the list in its place in time and the version you went back to stays where it was. Turn these off with `keepBeforeRestore: false` and `keepAfterRestore: false`.

### Autosaved versions

Named versions only exist when someone makes one. To keep a history without asking anyone to, turn on `autoSave`:

```ts
const history = new VersionHistory({ /* … */, autoSave: { every: 5 * 60_000, keep: 40 } });
// … when the editor goes away:
history.dispose();
```

A version named *Autosaved* is kept once changes have been quiet for `every` milliseconds (five minutes by default), unless the file is the same as the last version. The first time a file with no versions is opened, a version named *Original* is kept, so there is always something to go back to (`baseline: false` turns that off). Only the newest `keep` autosaved versions are kept (40 by default). Versions people named, and the ones made around a restore, are never removed. Autosaving needs a session that has `subscribe`, and it saves as the signed-in person, so it does nothing for viewers.

### What an editor supplies

```ts
interface VersionSupport<State, Op> {
  restoreOps(current: State, target: State): Op[];     // required
  summarize?(from: State, to: State): DiffSummary;     // for "what changed since this version"
}
```

`docVersionSupport` (in `@pli.dev/docs`) restores text, block types, the title and the page setup by replacing only what differs, and says "2 blocks were edited, 1 removed". An editor writes its own in terms of its own operations; `summarize` is optional, and without it the panel just shows the list.

### Where versions are kept

```ts
interface VersionStorage<State> {
  list(file: string): NamedVersion<State>[] | Promise<NamedVersion<State>[]>;
  get(file: string, id: string): NamedVersion<State> | undefined | Promise<NamedVersion<State> | undefined>;
  save(file: string, version: NamedVersion<State>): void | Promise<void>;
  remove(file: string, id: string): void | Promise<void>;
}
```

Over a table that is four statements. `memoryVersionStorage()` is there for tests and demos. A `NamedVersion` is plain JSON:

```json
{
  "id": "ver_k3j9x2",
  "name": "Sent to the board",
  "at": 1767225600000,
  "by": "u_42",
  "version": 118,
  "hash": "1k3f9a.2b7",
  "note": "Before the legal review",
  "state": { "…": "the whole document" }
}
```

`version` is the position in the [shared log](/platform/co-editing/) when it was saved, if the file is live. `automatic` is `true` for the ones Pli saved itself: before and after a restore, and by autosave.

### From the server, with no editor open

A server can save a version from the sequencer's own copy, which is what a schedule or an admin screen does:

```ts
import { versionFromStore, stateAtVersion, currentFromStore } from "@pli.dev/core";

await versionFromStore({ store, model: sheetSyncModel, storage, room: "sheet:budget", name: "Nightly", by: "system" });
await stateAtVersion(store, model, "sheet:budget", 118);   // the file as it was at log version 118, if the log still has it
await currentFromStore(store, model, "sheet:budget");       // the file as it is now
```

`stateAtVersion` replays the store's snapshot and log, so it works for any version the store has not trimmed. The playground's server exposes these over its socket (`lab:versions:*`), and `serverVersionStorage(socket, room)` in `apps/playground/src/collab/connection.ts` is the matching client.

### The interface

The ready-made editors show the history in **View > Version history**. It opens a side panel with a box to name the current version, and the list: *Current version* first, then every version with who saved it and when. Choosing a version **previews** it: the editor shows the file as it was, read-only, under a bar that says what changed since ("1 block was edited") and offers **Restore this version** and **Back to current**. Your real file is not touched while you look. Restoring applies the version as an ordinary undoable edit, adds the *Restored* version to the list, and returns to the editor.

Every editor takes the same props:

```tsx
<PliDocument session={session} users={users} versions={myVersionStorage} />            // makes the history for you, with autosave
<PliSheet    session={session} users={users} versions={myVersionStorage} autoSaveVersions={{ every: 60_000 }} />
<PliDeck     session={session} users={users} versions={myVersionStorage} autoSaveVersions={false} />
<PliPdf      session={session} users={users} history={history} />                         // or a `VersionHistory` you made
```

| Prop | What it does |
|------|--------------|
| `history` | A `VersionHistory` you made. Adds the View item and the panel. |
| `versions` | A `VersionStorage`. A shortcut that makes the `VersionHistory` for you (`documentVersionHistory`, `sheetVersionHistory`, `deckVersionHistory`, `pdfVersionHistory`), with autosave on. Needs `users`; `history` wins if you give both. |
| `autoSaveVersions` | With `versions`: `false` turns autosave off, or give `{ every, keep }`. |

Saving and restoring need the `editor` role in your `users`; everyone else can look at versions but sees no Restore button.

If you build your own interface, `VersionHistoryPanel` (the side panel) and `VersionPreviewBar` (the bar above an older version) are in `@pli.dev/react/collab` (see [Shared interface](/platform/shared-ui/)).

## Activity and notifications

`ActivityFeed` turns events Pli already has into entries:

```ts
import { ActivityFeed, describeActivity } from "@pli.dev/core";

const feed = new ActivityFeed({ file: doc.id, users, store: myActivityStore });
feed.trackComments(session.comments);   // threads, replies, edits, resolves, and every @mention in them
feed.trackEdits(session);               // a person's run of edits becomes one entry: "Ana made 14 changes"
feed.record({ kind: "version.saved", user: "u_42", ref: version.id });

feed.events;                            // newest first
feed.notificationsFor("u_7");           // mentions of Ben, and replies to his threads
describeActivity(event, users);         // "Ana mentioned Ben"
```

| `kind` | When |
|--------|------|
| `comment.created`, `comment.replied`, `comment.edited`, `comment.deleted` | A change to a thread's comments |
| `thread.resolved`, `thread.reopened`, `thread.deleted` | A thread's state |
| `mention` | A comment mentions someone: `target` is who |
| `edit` | A person's changes to the file, folded together; `count` says how many |
| `version.saved`, `version.restored` | Record them yourself next to `history.save` and `restore` |
| `share.granted`, `share.revoked`, `share.link` | Record them yourself from the `ShareClient`'s changes |

Edits by other people can't be told apart in a session (the operations don't say who made them), so they are recorded with an empty `user`, or with `whose(event)` if your sync layer can name them.

An `ActivityStore` (`append`, and `list` for history when the page opens) keeps the feed beyond the page, which makes it an **audit trail**; without one the feed lives in memory. Each entry is JSON:

```json
{ "id": "ev_8f2k1x", "at": 1767225600000, "kind": "mention", "user": "u_42", "target": "u_7", "ref": "th_k3j9x2", "excerpt": "Can @Ben check the totals?" }
```

`ActivityList` draws the feed, and `ActivityToasts` shows a toast when something concerns the signed-in person, so a mention is noticed without a panel being open. Pli never sends an email or a push notification: `notificationsFor` is where your server or app does that, from the same entries.

## Where it lives

| | |
|---|---|
| `@pli.dev/core` | `VersionHistory`, `VersionStorage`, `memoryVersionStorage`, `versionFromStore`, `stateAtVersion`, `currentFromStore`; `ActivityFeed`, `ActivityStore`, `describeActivity` |
| `@pli.dev/docs` | `docVersionSupport`, `restoreDocOps`, `summarizeDocDiff` |
| `@pli.dev/pdf` | `pdfVersionSupport`, `pdfVersionHistory`, `restorePdfOps`, `summarizePdfOps` ([PDF version history](/pdf/collaboration/#version-history)) |
| `@pli.dev/react` | `VersionHistoryPanel`, `ActivityList`, `ActivityToasts`, and the `history` option of `PliDocument` |
