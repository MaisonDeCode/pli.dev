---
title: Importing DOCX files
description: "Open a .docx file as a Pli document: what is read, what is left out, and how to wire it into your app."
---

`fromDocx` reads a `.docx` file into a Pli document. It is the other half of [`toDocx`](/documents/guides/exporting/): a document written by Pli and read back comes out the same, and files from other programs keep what Pli has a place for.

```ts
import { fromDocx } from "@pli.dev/docs";

const { doc, authors, warnings } = fromDocx(new Uint8Array(await file.arrayBuffer()));
```

| Returned | What it is |
|----------|-----------|
| `doc` | The document, already checked with `validateDoc` |
| `authors` | The people who wrote the file's comments, as users (`{ id, name }`). Give them to your [`Users`](/platform/users/) |
| `warnings` | What was left out or changed, in plain words, such as "A picture in a format that can't be shown was left out" |

It runs anywhere JavaScript does (the browser, Node, JavaScriptCore, QuickJS), has no dependencies on the DOM, and never runs anything from the file.

## In the editor

`PliDocument` has **File > Import DOCX…**. It reads the chosen file, replaces the document with it as **one undo step** (so a wrong choice is one Ctrl+Z away), adds the comment authors to the session's users, and shows the warnings in a notice above the page. Pass `onImported` to take over what happens with the result:

```tsx
<PliDocument session={session} onImported={({ doc, warnings }) => analytics.track("import", { warnings: warnings.length })} />
```

From code, the same replacement is `session.replaceDocument(doc)`. It needs block ids that are not already in the document, which is always true for what `fromDocx` returns. Comments saved in the document are replaced too. If you keep comments in [a store of your own](/platform/comments/), save `doc.comments` there yourself. The session leaves your store alone.

## What is read

| In the file | In the document |
|-------------|-----------------|
| Paragraphs, bold, italic, underline, strikethrough, superscript, subscript | The same |
| Font, size, text color, highlight and shading | `fontFamily`, `fontSize`, `color`, `highlight` |
| Title, subtitle, heading 1–6, quote and code styles | Title, subtitle, headings, quote and code blocks, through the style's name, including styles based on them |
| Bulleted and numbered lists, any level, with each level's style (numbers, letters, roman numerals, bullets), where it starts, restarts, and lists that carry on past other paragraphs | List items with a depth, a `marker` and a `start` |
| Alignment, spacing, line height, indents | `align` and `format` |
| Hyperlinks, including the long field form | Links |
| Tables: merged cells (across and down), column widths, row heights, header rows, shading, vertical alignment, borders | Tables, with covered cells for merges |
| Pictures stored in the file (PNG, JPEG, GIF, WebP, BMP), with size and description | Image blocks as `data:` URIs |
| Pictures with square, tight or through wrapping, on the left or right | Image blocks with [`wrap`](/documents/features/images/#wrapping-text-around-a-picture) |
| Page breaks and horizontal rules | Page break and divider blocks |
| Page size, orientation, margins, columns, section breaks, different first page, odd and even pages | Page setup and section breaks, with each section's own page and headers |
| Headers and footers, with page-number fields | Header and footer content |
| A table of contents field | A table of contents block at that place |
| Footnotes | Footnotes, numbered by where they are cited |
| Comments, replies, resolved threads, and the text each covers (a comment over several paragraphs is highlighted across them and anchored to its first one) | Comment threads and their highlights |
| The author's own named styles, based on each other | [Named styles](/documents/features/styles/), used as the file uses them |
| Tracked changes (insertions and deletions, with author and date) | [Suggestions](/documents/features/suggestions/), or with `trackedChanges: "accept"` the text as it would read with every change accepted |

Authors are given ids made from their names (`Ana Reyes` becomes `ana-reyes`). Map them to your own with the `userId` option:

```ts
fromDocx(bytes, { userId: (name) => directory.idFor(name) ?? name });
```

## What is left out

Left out with a warning, so nothing is silently lost:

- Pictures that are linked rather than stored, and formats that can't be shown (EMF, WMF, TIFF).
- Drawings, text boxes, charts, equations and embedded objects that aren't pictures.
- A table inside a table, or inside a note, which becomes plain paragraphs.
- Footnotes cited from a table, header or note.
- A page size that Pli doesn't have (it takes the nearest).

Left out without one, because Pli has nothing to put them in:

- Fonts, sizes and colors that come from **theme** or **document defaults** rather than from the text or its style. Text that has no formatting of its own comes in plain.
- Line numbers, bookmarks, form fields, macros, document protection, and headers or footers in sections that inherit them.
- Endnotes, and the exact numbering formats of lists (a numbered list is numbered with Pli's own).
- Anything in a part that isn't the main document, notes, comments, headers, footers, styles, numbering and settings.

## Safety

A `.docx` is a zip of XML files and can be made hostile, so the reader guards against that:

- The unpacked size is limited (`maxUnpackedBytes`, 250 MB by default), so a small file can't be made to fill memory.
- The XML reader defines no entities and ignores `<!DOCTYPE>`, so a file can't make it expand a name into something huge. Elements nested too deeply are refused.
- Nothing in the file is run. Link targets are kept as text and Pli's renderer blocks unsafe schemes when it draws them.
- Damaged files fail with a `PliError` whose code is `invalid_document`, or open with less in them. The tests run the reader over hundreds of files that were deliberately corrupted.

```ts
try {
  fromDocx(bytes);
} catch (error) {
  if (error instanceof PliError && error.code === "invalid_document") showMessage(error.message);
}
```
