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

Before it restores, `VersionHistory` saves the current state as an automatic version named *Before restoring "Name"*, so even undo is not the only way back. Turn that off with `keepBeforeRestore: false`.

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

`version` is the position in the [shared log](/platform/co-editing/) when it was saved, if the file is live. `automatic` is `true` for the ones Pli saved before a restore.

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

`VersionHistoryPanel` (see [Shared interface](/platform/shared-ui/)) is the side panel: a box to name the current version, the list with who saved each and when, a confirmation before restoring, and the "what changed" lines. `PliDocument` takes it as `history={history}`.

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
