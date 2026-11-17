---
title: Comments
description: Comment on selected text, reply, resolve, and see who else is in the document, with DOCX export. Comments are stored in the document or in your own database.
---

Select some text and add a comment. The text is highlighted, the conversation appears in a panel beside the page, and anyone with access can reply or resolve it.

For what your server and database see, read the [platform pages](/platform/collaboration/).

## Turn them on

Pass `comments` to the session, with the users from [Users and permissions](/platform/users/):

```tsx
const session = useDocumentSession(doc, { comments: { users } });

<PliDocument session={session} />
```

Without this option the document has no comments, and nothing about comments appears in the editor. With it:

- **Insert > Comment** (or **Ctrl/Cmd+Alt+M**, or the toolbar button) starts a comment on the selected text.
- The **Comments** button in the title bar, and **View > Show comments**, open the panel.
- Clicking highlighted text opens its thread. With the caret inside commented text, the thread is shown in the panel.
- **Reply**, **Edit**, **Delete** and **Resolve** are in the panel, for the people allowed to ([roles](/platform/users/#roles)).
- Resolved threads are hidden from the list and lose their highlight. **Show resolved** brings them back, and **Reopen** makes one active again.

Comments can be added to a read-only document (`readOnly`). That is how review works: nobody can change the text, and everyone who may comment can.

## Mentions

Typing `@` in a comment, reply or edit offers the people your [`search`](/platform/users/) finds, as a list under the box. The arrow keys move through the list, **Enter** or **Tab** (or a click) picks, and **Esc** closes it. The comment keeps the name as text (`@Ben Ito`) and the person's id in the comment's `mentions`. The name is shown highlighted, and a mention of the current user is highlighted more strongly. Delete the name from the text and the person is dropped from the list.

Pli doesn't notify anyone. Your store sees each comment with its `mentions` (see [what your store receives](/platform/comments/#what-your-store-receives)), and sending the email or push notification is your app's job. If you don't give your users a `search`, nothing is offered. From code:

```ts
session.comment("@Ben Ito can you check?", undefined, ["u_ben"]);  // mentions are the last argument
session.comments!.reply(thread.id, "@Ben Ito done", ["u_ben"]);
import { mentionsIn } from "@pli.dev/docs";
mentionsIn("Hi @Ben Ito", [ben, cleo]); // ["u_ben"]: which of these people the text names
```

## Where they are kept

By default, **inside the document**, so they are saved, exported and loaded with it. To keep them in your own database, give the options a [`store`](/platform/comments/#what-your-store-receives):

```ts
new DocumentSession(doc, { comments: { users, store: myStore } });
```

Either way, the highlight is part of the document's text, so it follows the text as it is edited and survives undo and redo.

## Live

Give `PliDocument` a [room](/platform/realtime/) to see who is in the document, where their cursors are, and each other's comments as they are written:

```tsx
<PliDocument session={session} room={room} />
```

Text edits are shared live too, once you add the pieces described in [Live editing](/platform/live-editing/). See [what works live](/platform/collaboration/#what-works-live).

## What happens to the highlight

| What you do | What happens to the comment |
|-------------|-----------------------------|
| Type inside commented text | The highlight grows with it |
| Edit text before it | The highlight moves with the text |
| Delete all of the commented text | The thread stays in the panel as "The commented text was deleted" |
| Undo the comment (right after adding it) | The highlight goes; the thread stays, attached to nothing |
| Copy and paste commented text | The copy is plain text; the thread stays with the original |
| Delete the thread | The highlight goes, and cannot be undone |
| Open a document whose highlight is missing (comments from your store) | Pli finds the quoted text in the block and highlights it again |

## Overlapping comments

Two comments can cover the same words. The text shows one highlight, clicking it opens the first open thread, and the caret anywhere in it lists them all in the panel.

## In exports

| Format | Comments |
|--------|----------|
| DOCX | Native comments, with their range, author, date, replies as replies, and resolved threads as resolved |
| HTML, Markdown | Not included |

The DOCX export writes the comments saved in the document. If they are in your own store, pass them in:

```ts
toDocx(session.state, {
  comments: session.comments?.threads,
  authorName: (id) => users.get(id).name, // the name shown in the file
});
```

A thread whose text has been deleted has nowhere to go in a DOCX file and is left out.

## From code

```ts
const thread = session.comment("Why beta?");  // on the selection; null if nothing is selected
session.comments!.reply(thread!.id, "Because it is.");

import { commentRanges, commentIdsIn, commentsAt } from "@pli.dev/docs";
commentRanges(session.state, thread.id); // where its text is now: [{ block, from, to }, …]
commentsAt(session.state, session.selection); // the threads at the caret
```

In the document, the highlight is the `comment` mark on a run: a sorted list of thread ids. Threads saved in the document are in `doc.comments`, keyed by id. `comment_text` and `set_thread` are the operations that change them.

## Limits

- A thread is anchored to text. Comments on images, table cells as a whole, headers and footers, and footnotes are not supported yet.
- A thread across several paragraphs is highlighted across all of them, but if its highlight has to be restored from the anchor, only the first paragraph's part is.
- Mentions are of people your directory can search for, by their full name as typed. A person whose name changes later is still found by id in `mentions`, but the old name stays in the text.
- To propose changes to the text rather than discuss it, see [Suggestions](/documents/features/suggestions/).
