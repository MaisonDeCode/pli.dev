---
title: Suggestions
description: Tracked changes. People propose edits that show in the text, and someone with the right role accepts or rejects them.
---

A suggestion is a change nobody has decided on yet. With **Suggesting** on, what you type is added as underlined text and what you delete stays, struck through, until someone **accepts** or **rejects** it. Each one knows who suggested it and when.

## Turn them on

Pass `suggestions` to the session, with the same [users](/platform/users/) you give comments:

```tsx
const session = useDocumentSession(doc, {
  comments: { users },
  suggestions: { users },
});

<PliDocument session={session} />
```

Without the option the document has no mode switch and no panel. Suggestions already in the text (from a DOCX file, say) are still drawn.

The title bar then has an **Editing / Suggesting** button, and a **Suggestions** button that opens the panel. They are also in **View** (Show suggestions, Suggest edits).

## Who may do what

| Role | Suggest | Accept | Reject |
|------|:-------:|:------:|:------:|
| `viewer` | | | |
| `commenter` | ✓ | | their own |
| `editor` | ✓ | ✓ | anyone's |

This is the same pattern as comments: reviewers propose, editors decide. Anyone can take back their own pending addition by deleting it, while suggesting.

## What is suggested

- **Typing.** Text goes in with the suggestion mark. Typing straight after your own suggestion adds to it. Typing after someone else's, or after a pause in a different place, starts another.
- **Deleting.** Backspace, Delete, and deleting a selection leave the text in place, struck through. Delete walks past text already struck. A selection across paragraphs is struck through in each, without joining them.
- **Replacing.** Typing over a selection strikes the selection and adds the new text after it.
- **Deleting your own suggested addition** removes it outright, since nobody had accepted it.
- **Pasting** adds the text as a suggestion. Pasted blocks come in as their text, and line breaks stay inside the paragraph.

## What is not

Suggestions cover the **text**. These happen directly and are not tracked:

- Formatting (bold, size, alignment), styles and block types.
- Enter, and Backspace or Delete at the edge of a paragraph where they would join two. Splitting and joining paragraphs is an edit.
- Tables, images, page setup, headers, footers and footnote text.
- Text typed by an input method that composes it (Chinese, Japanese, Korean), which is applied as it is composed.
- Text in code blocks, which can't show a suggestion.

## Accepting and rejecting

Accepting turns an addition into ordinary text and removes text proposed for deletion. Rejecting removes the addition and keeps the text proposed for deletion as it was. Each is **one undo step**, so a wrong click is one Ctrl+Z.

```ts
session.suggestions;                 // [{ id, kind, by, at, text, block, from }, …] in reading order
session.setSuggesting(true);         // false if this user can't suggest
session.typeText("Hello");           // added as a suggestion
session.acceptSuggestion(id);        // false if there is nothing to do or the role doesn't allow it
session.rejectSuggestion(id);
session.acceptAllSuggestions();      // those the current user may accept
session.canResolveSuggestion(s, "accept");
```

## How they are stored

A suggestion is a **mark on the text**, like bold or a comment, so it travels with the document, saves and exports with it, and **syncs live** with no new machinery:

```json
{ "text": "now clearer", "marks": { "suggest": { "id": "sg_k3j9", "kind": "insert", "by": "u_42", "at": 1767225600000 } } }
```

`kind` is `insert` or `delete`, `by` is a user id, and the runs of one suggestion share an `id`. Accepting and rejecting are ordinary text and mark operations, so two people accepting the same suggestion at once end with the same document. Look up the author of a suggestion with `session.suggestionUsers.get(by)`.

Pasted text loses its suggestion marks and keeps the words.

## Files

| Format | |
|--------|---|
| DOCX export | Tracked changes (`w:ins` and `w:del`) with the author's name and the date, which other programs show and let people accept. Pass `authorName` to say what name each user id goes by, as for comments |
| DOCX import | Tracked changes become suggestions, with their authors (returned as `authors`) and dates. Pass `trackedChanges: "accept"` to read the text as if everything were accepted. Opening a file in `PliDocument` does this for you |
| HTML | `<ins>` and `<del>`, with `data-by` and `datetime` |
| Markdown | Deletions struck through (`~~text~~`), additions as plain text |
| PDF | Drawn as the editor shows them, underlined and struck through in the author's color |

## Known limits

- Two people who edit the same suggested text at once get the usual text merge: both edits are kept, in accepted order.
- A suggestion that is only formatting (make this bold) can't be proposed yet.
- Rejecting someone's deletion that someone else has since edited inside gives the text as it is now.
