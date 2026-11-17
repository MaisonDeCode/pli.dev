---
title: How live editing works
description: "The design behind live editing: why there is a sequencer, how changes are merged, what undo and cursors do, and how it is tested."
sidebar:
  order: 7
---

To set live editing up, read [Live editing](/platform/live-editing/). To see it run, open the Collaboration screen of the playground.

## The goal

Two or more people type in the same document and see each other's changes as they happen, with nobody's work lost and every copy ending up identical. It keeps the promises of the rest of Pli:

- **Your server, your database.** Pli supplies the logic; you supply the pipe (the same [`Transport`](/platform/realtime/)) and the storage.
- **Core, not Documents-only.** The sync machinery lives in `@pli.dev/core` and is generic over a model and its operations, so Sheets, Decks and PDF reuse it.
- **Portable.** Everything is plain JSON operations and messages, so Swift and Kotlin clients can speak the same protocol.

## What it builds on

Every change to a document is a small JSON operation (`insert_text`, `delete_block`, …) that can be inverted, and blocks are found by **id**, not by position. That is most of what live editing needs. The text operations are the only ones that use positions (`insert_text` at offset 12), and those are the ones that must be adjusted when two people edit the same paragraph.

## Why a sequencer

There are two well-known ways to make concurrent edits converge:

| | Operational transformation (OT) with a sequencer | CRDT (such as Yjs) |
|---|---|---|
| Where order is decided | One place, per document: a small piece of **your** server | Nowhere; every peer merges |
| Fits Pli's model | Yes. Pli already has operations; it adds a transform for each pair | No. Replaces the document model with the CRDT's, and every feature with it |
| Works over a dumb pipe | No: needs the sequencer in the loop | Yes |
| Native ports (Swift, Kotlin) | A small transform table and a protocol | A CRDT library per platform, plus the mapping |
| Undo, comments, exports | Keep working as they are | Rebuilt on top of the CRDT |

Pli uses **OT with a server-side sequencer**. It keeps the model, the exporters and undo intact, at the cost that your server does one small job beyond relaying messages.

## The shape of it

For each document, one number, the **version**, counts the changes accepted so far. Changes are accepted in a single order.

```
client A ──ops (based on v7)──▶ sequencer ──ops (now v8)──▶ everyone, including A
client B ──ops (based on v7)──▶ sequencer ──ops, transformed against A's (now v9)──▶ everyone
```

If a change arrives based on an older version, the sequencer transforms it past everything accepted since, then accepts it. Everyone receives the same changes in the same order.

The sequencer (`createAuthority`) keeps nothing that matters in memory: the document and its log are in a `DocumentStore`, whose `append` is compare-and-set, so any number of server processes can share one store.

Each client (`SyncClient`) keeps three things: the last version it knows, the batch it has sent and not had accepted (**in flight**, one at a time), and the changes made since then (**pending**). Its own changes show at once. What arrives from the sequencer is transformed past the in-flight and pending changes (`rebase`), then applied without becoming one of its own undo steps. Joining, reconnecting and de-duplication are described in [Live editing](/platform/live-editing/).

## Merging two changes

`transformPair(a, b)` takes two operations made from the same document, where `b` was accepted first, and returns `a` and `b` each rewritten to apply after the other, so that both orders give the same document. `transformOps` does it for lists, and `rebase(inflight, pending, incoming)` is what a client runs when something arrives from the server while it has changes of its own waiting.

| | |
|---|---|
| Two inserts in the same place | The one accepted first comes first |
| Insert vs delete | The insert moves; a delete split by an insert becomes two deletes, so the insert survives |
| Delete vs delete | Each loses what the other already removed |
| Format, restore marks or comment vs insert or delete | The range shifts and shrinks. Text typed inside a range is **not** formatted or commented, and is not touched when the range is reset |
| Two changes to the same mark | The later one wins on the overlap; the parts that don't conflict both apply |
| Restoring marks (undo of bold) vs a new comment | Comments are separate from formatting, so restoring marks never removes a comment |
| Two blocks inserted after the same block | In accepted order |
| A block inserted after a block that is deleted | It takes the place the deleted block had |
| A block deleted, or its table's rows rewritten, vs edits to what was in it | The deletion or rewrite wins; the edits are dropped, along with anything built on blocks that were dropped |
| Two changes to the same property of a block | The later wins; other properties both apply |

Operations on different blocks never interact. This is why blocks have ids.

Some operations carry a **hint** that lets them be merged without looking at the document: a `delete_block` remembers the block before it (`after`, `cell`) and what was inside it (`within`), and an `update_block` that rewrites a table's rows remembers the ids of what was there. Sessions fill these in. When one operation overrides another, it takes over the ids of whatever the other would have put there, so later edits to those are dropped too.


## Making every change safe to merge

Some operations are not safe to merge as they stand, so Pli never produces them:

- The inverse of `format_text` is `set_runs`, a snapshot of the whole paragraph. Used in undo after another person typed in the same paragraph, it would **erase their typing**. Instead the inverse is a positional operation (`restore_marks`) that records the old marks run by run.
- `replace_block` swaps a whole block. Commands like "turn into heading", "indent", and "make a list item" use it, and a concurrent keystroke in that block would be overwritten. A session applies them as an `update_block` operation that changes **properties only** and leaves the text alone (see [Operations](/documents/concepts/operations/#operations-that-leave-other-peoples-edits-alone)).
- Table structure changes (add a row, merge cells) also replace the whole table. They merge as **last writer wins**, so a row insert can drop a keystroke typed into that same table at the same moment. Cell text itself is fine, since cells hold ordinary blocks.


## Undo, your caret and their cursors

Undo must reverse **your** last change, not the document's. Your undo stack is a list of inverse operations, written for the document as it was. When other people's operations arrive, each step is transformed past them, from the top of the stack down (each step is also carried past the ones above it), so that undoing your typing removes your typing and leaves theirs. A step left with nothing to do is dropped, and a step that can't be applied is forgotten instead of failing. It is part of `@pli.dev/core` (`Session.rebaseHistory`), so every editor gets it; the sync client calls it for you.

The selection saved with each step, **your own caret**, and **other people's cursors** are moved the same way: a caret stays with its text when someone types above it, goes to the start of the gap when its text is deleted, and goes to the end of the block before it when its block is deleted. Your own changes move other people's cursors, as theirs move yours, until they next say where they are.


## Cells emptied at once

A table cell always has a block. If two people delete the last two blocks of a cell at the same moment, there is no order in which one of them can be refused, so the cell is left with an empty paragraph whose id is made from the cell's id (`<cell>~empty`), the same on every machine. Inserting into the cell replaces it. Nobody edits it directly: the session turns it into a real block before any change to it (typing, formatting, a change of block type), and the caret goes with it. A caret that was in the stand-in goes to the block that replaced it.


## A safety net

The algorithm is checked by a fuzzer, but a bug in a case nobody has thought of would show as two people seeing different documents. So the sync client sends a short **hash of its document** with its version now and then. The server compares it with its own at that version, and a client that differs reloads the snapshot. A client that can't apply something the server accepted does the same.


## Known conflicts

Some concurrent edits cannot be merged without losing someone's intent:

| Both people at once… | Result |
|----------------------|--------|
| Type in the same place | Both texts kept, in accepted order |
| One deletes text, one types inside it | The typing is kept, at the start of the gap |
| One deletes a paragraph, one types in it | The paragraph is deleted; the typing is lost |
| One joins two paragraphs, one types in the second | Joining deletes the second paragraph, so the typing is lost. Joins are worth a dedicated operation later |
| Both change the same property (heading level) | Last accepted wins |
| Both undo the deletion of the same block | One copy is kept: the later one replaces the earlier |
| Table structure and a keystroke in that table | Structure wins; the keystroke can be lost |
| Both resolve or edit the same comment | Last accepted wins |


## The messages

The payload of each, which travels as a `custom` room message of kind `"sync"` inside the [usual envelope](/platform/realtime/#what-is-on-the-wire):

```jsonc
// Client → sequencer
{ "type": "join", "have": 7 }                      // or null: "send me the document"
{ "type": "ops", "batch": "bt_9x2k", "base": 7, "ops": [ { "type": "insert_text", "block": "b_3", "offset": 4, "runs": [ { "text": "hi" } ] } ] }
{ "type": "hash", "version": 12, "hash": "1q2w3e.4r" }  // "my document at version 12 looks like this"

// Sequencer → everyone in the room (the sender's own batch comes back as its acknowledgement)
{ "type": "entry", "version": 8, "client": "c_8f2k1x", "batch": "bt_9x2k", "ops": [ … ] }   // plus "dropped": true if part was left out

// Sequencer → one client (`to` is that client's connection id; the others ignore it)
{ "type": "snapshot", "to": "c_8f2k1x", "version": 8, "state": { … } }
{ "type": "caught_up", "to": "c_8f2k1x", "version": 12, "entries": [ { "version": 9, … }, … ] }   // the reply to a join
{ "type": "resync", "to": "c_8f2k1x", "reason": "…" }
```

Entries come in order, one version at a time. A client that sees a gap reloads, so a lost message costs a reload, never a wrong document. The sequencer's envelopes have `"client": "server"`.


## Where it lives

| | |
|---|---|
| `@pli.dev/core` | `SyncClient`, `createAuthority`, `DocumentStore` and `memoryDocumentStore`, `SyncModel`, the message types, `Session.rebaseHistory` and `Session.reset`, `attachSync`, `hashState`, and `transformText` (the [text merge](/platform/live-editing/#merging-text-in-any-editor) any editor with rich text reuses) |
| `@pli.dev/docs` | `docSyncModel`, `transformPair`, `transformOps`, `rebase`, `canonicalOps`, and the operations they work on |
| `@pli.dev/react` | The `sync` option of `PliDocument`, `SyncIndicator` and `useSyncStatus` |

## How it is tested

There are two fuzzers. The first is a **convergence fuzzer** (`packages/docs/test/convergence.test.ts`). It makes random operations (typing, deleting, formatting, restoring marks, comments, inserting and deleting blocks, rewriting table rows, document settings) and checks them at three levels:

1. **Pairs and batches.** Two people make operations from the same document; applying them in either order after the transform must give the same document.
2. **Two to five clients and a sequencer.** A small version of the real algorithm: an in-memory server that puts operations in one order, and clients that keep one batch in flight and the rest waiting, over wires that deliver in order but take random time. After **every step**, each client must equal the server's document at its version plus its own unsent changes. At the end, all of them must be identical.
3. **Named cases.** Each row of the conflict tables has its own test (`transform.test.ts`).

By default it runs a few thousand cases in a couple of seconds. `FUZZ_RUNS=60 pnpm vitest run packages/docs/test/convergence.test.ts` runs 60 times as many (about 3 minutes), and every failure prints the seed that reproduces it. The fuzzer found real flaws while this was built (for example, a table rewrite that didn't cover blocks another person had created in it), which is why it exists.

The second (`packages/docs/test/sync.test.ts`) uses the real thing end to end: real `DocumentSession`s with `SyncClient`s, through a real sequencer and store, over a network that delays and loses messages, with people pressing undo, going offline and coming back, and two server processes sharing one store. At the end every client must hold the server's document, and nobody should have had to reload because of the algorithm. Whenever a case fails, `SHRINK=1` writes the failing schedule and `shrink.tool.test.ts` boils it down to the smallest one. The playground's server is covered by integration tests that use real Socket.io connections (`apps/playground/test`), and its SQL store by tests of the compare-and-set rule.

