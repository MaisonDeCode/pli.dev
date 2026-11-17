---
title: Comments
description: The shape of a comment thread, every change Pli sends your store, and how to keep comments in your own database or in the document.
sidebar:
  order: 4
---

A **thread** is a conversation about one place in a file. It has one or more **comments**, can be **resolved**, and is attached to an **anchor** that the editor understands (a text range in a document, a page and an annotation on it in a PDF).

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


## Where comments are kept

You choose. There are three options, and you can change your mind later because the thread format is the same.

| Option | Use it when | How |
|--------|-------------|-----|
| **In the document** (default) | Comments should travel with the file: a shared `.json` file, an exported document, a single-user app | `comments: { users }` |
| **Your own store** | You have a database, and comments belong to your app, not the file | `comments: { users, store }` |
| **Memory** | Demos and tests | `store: memoryCommentStore()` |

Either way, the **text a thread is attached to** is marked in the document, so highlights move with the text as it is edited. Only the conversation itself is stored by the store.

## What your store receives

Write two functions, `load` and `save`. Pli calls `load` once to get the threads, and `save` once for every change, in order.

```ts
import type { CommentStore, DocAnchor } from "@pli.dev/docs";

const store: CommentStore<DocAnchor> = {
  // Every thread of this file.
  async load(file) {
    return (await fetch(`/api/files/${file}/threads`)).json();
  },

  // One change. Throw (or reject) if you couldn't keep it: Pli takes it back and tells the user.
  async save(file, change) {
    const res = await fetch(`/api/files/${file}/comment-changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  // Optional: call back with changes made by other people (from your own push channel).
  subscribe(file, listener) {
    return myChannel.on(`comments:${file}`, listener);
  },
};

const session = new DocumentSession(doc, { comments: { users, store } });
```

`file` is the document's `id`.

### The changes

`change` is one of these seven, always plain JSON. This is everything Pli will ever send:

```jsonc
// A new thread, with its first comment.
{ "type": "thread.create",
  "thread": {
    "id": "th_k3j9x2",
    "createdAt": 1767225600000,
    "anchor": { "block": "b_12", "from": 6, "to": 10, "quote": "beta" },
    "comments": [
      { "id": "cm_a81f", "author": "u_42", "body": "Why beta?", "createdAt": 1767225600000 }
    ]
  } }

// A reply.
{ "type": "comment.add", "threadId": "th_k3j9x2",
  "comment": { "id": "cm_b72c", "author": "u_17", "body": "@Ana Reyes Because it is.", "mentions": ["u_42"], "createdAt": 1767225700000 } }

// An edit to the text of a comment.
{ "type": "comment.edit", "threadId": "th_k3j9x2", "commentId": "cm_b72c", "body": "Because it is new.", "at": 1767225800000 }   // "mentions": [...] too, when the new text has any

// A comment removed. (Removing the only comment removes the thread instead.)
{ "type": "comment.delete", "threadId": "th_k3j9x2", "commentId": "cm_b72c" }

// The thread marked done, and opened again.
{ "type": "thread.resolve", "threadId": "th_k3j9x2", "by": "u_42", "at": 1767225900000 }
{ "type": "thread.reopen", "threadId": "th_k3j9x2" }

// The thread and all its comments removed.
{ "type": "thread.delete", "threadId": "th_k3j9x2" }
```

Timestamps are milliseconds since 1970. `author` and `by` are your user ids, exactly as you gave them to `Users`.

### The thread

What `load` returns, and what a `thread.create` carries:

```ts
interface Thread<Anchor> {
  id: string;
  createdAt: number;
  anchor?: Anchor;                       // for a document: { block, from, to, quote }
  comments: Comment[];                   // oldest first
  resolved?: { by: string; at: number }; // present once resolved
}

interface Comment {
  id: string;
  author: string;      // a user id
  body: string;        // plain text, may contain line breaks
  createdAt: number;
  editedAt?: number;
  mentions?: string[]; // user ids of the people named in body with @Name, in order; absent when nobody is
}
```

A mention is written into `body` as `@` and the person's name, so the text reads the same everywhere it is shown or exported, and `mentions` lists their ids. **Pli does not notify anyone.** Your `save` sees every `comment.add` and `thread.create` with `mentions` on it, which is where you send the email or the push notification (an edit that adds a mention sends the new list too).

For a document, the anchor says where the text was **when the comment was made**: the `block` id, `from` and `to` offsets in it, and a `quote` of the text (up to 200 characters). The live position is the highlight in the document; the anchor is what is left when the text is gone, and how Pli puts the highlight back for someone whose copy lacks it.

### Keeping the changes in your database

The simplest store keeps a table of changes and builds threads from them, with Pli's own function doing the work:

```ts
import { applyCommentChange, type CommentChange, type Thread } from "@pli.dev/docs";

// Replay what you saved, in order.
function threadsFromLog(changes: CommentChange[]): Thread[] {
  return changes.reduce(applyCommentChange, [] as Thread[]);
}
```

Every change is **safe to apply twice**, and one that no longer fits (a reply to a thread that was deleted) is ignored, so you do not have to worry about duplicates or ordering races. Or keep one row per thread and update it; the changes are small and obvious.

## Letting everyone see changes live

A store that only saves does not tell other people. Two ways to do that:

- Give the store a `subscribe` that listens to your own push channel (Postgres changes, Firestore, a socket you already have).
- Or pass a `room` to the editor. Pli sends each change to the room **after your store has kept it**, and applies the ones it receives. See [Realtime](/platform/realtime/).

Changes that arrive from other people are applied to the screen but are **not saved again** by the receiver, so a change is saved exactly once, by the person who made it.

## Without a store: comments in the document

With no `store` (or `store: "document"`), threads are saved in the document, under `doc.comments`, and come back when you load it. Since the file is the record, a comment written by someone else is also saved into your copy when it arrives live.

```ts
const session = new DocumentSession(doc, { comments: { users } });
// …
const json = serializeDoc(session.state); // contains the comments
```

Comment changes made this way are not undo steps: pressing undo takes back the highlight you just added, not other people's replies.

## In a shared document

When the document is edited live (see [Live editing](/platform/live-editing/)), pass `synced: true` with the comments options:

```ts
new DocumentSession(doc, { comments: { users, store, synced: true } });
```

The highlight a comment puts on the text is then an ordinary change, sent to everyone with the rest of the edits, so the session doesn't put it back itself from the thread's anchor when a thread arrives. Deleting a thread takes its highlight off as a change that is sent too, and isn't an undo step. The threads themselves still go through your store and the room, as before.

## Threads that follow their content

A thread's `anchor` says where it is attached, and when people edit, that place moves. Each editor gives the shared machinery an `AnchorResolver` that knows how its own operations move its own anchors, and `AnchorTracker` keeps every thread's current anchor up to date:

```ts
import { AnchorTracker, textRangeResolver, type TextRangeAnchor } from "@pli.dev/core";

// For anchors on a range of text: say which operations are text edits, and in which text.
const resolver = textRangeResolver<DocOp>({
  textOf(op) {
    if (op.type === "insert_text") return { target: op.block, edits: [{ type: "insert", at: op.offset, text: plainText(op.runs) }] };
    if (op.type === "delete_text") return { target: op.block, edits: [{ type: "delete", from: op.from, to: op.to }] };
    return null;                                                  // not a text edit
  },
  removes: (op) => (op.type === "delete_block" ? op.id : null),   // the whole paragraph went
});

const anchors = new AnchorTracker(session, session.comments, resolver, {
  persist: (thread, anchor) => saveAnchor(thread.id, anchor),   // optional: store the new place with the thread
});
anchors.get(thread.id);          // where it is now; null once its content is gone
anchors.isAttached(thread.id);   // false: show "The commented text was deleted"
```

An `AnchorResolver<Anchor, Op, State>` is two functions: `map(anchor, ops, state)` returns the anchor after the operations (the same object if nothing moved, `null` if what it pointed at is gone), and an optional `describe` gives a label. A cell anchor maps through inserted and deleted rows and columns; a slide anchor goes when its element is removed; a PDF anchor goes with its annotation. The text one uses `mapRange` from the [text-edit transform](/platform/live-editing/#merging-text-in-any-editor): text typed at either edge of the range is outside it, and a range whose text was all deleted is detached.

`CommentThreads`, the shared comments panel, takes the tracker as `anchors`, so threads whose content is gone say so, in every editor.

## Using it from code

`session.comments` is a `CommentClient`. The editor's panel is built on it, and so can yours:

```ts
const thread = session.comment("Why beta?");            // on the selected text; null if nothing is selected
const client = session.comments!;
client.reply(thread.id, "Because it is.");
client.editComment(thread.id, commentId, "…");
client.resolve(thread.id);
client.reopen(thread.id);
client.deleteThread(thread.id);

client.threads;                                          // all threads, now
client.subscribe(() => render(client.threads));          // when anything changes
client.can("deleteThread", thread);                      // what the current user may do
client.status;                                           // "loading" | "ready" | "error"
```

Each method shows its change at once, then hands it to the store. If the store refuses, the change is taken back and your `onError(error, change)` is called with a `PliError` whose `code` is `"storage"`.
