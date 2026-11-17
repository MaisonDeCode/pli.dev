---
title: Table of contents
description: A contents list built from your headings that stays up to date by itself.
---

**Insert > Table of contents** adds a list of the document's headings. You choose how deep it goes: headings 1 to 2, 1 to 3, or all.

The list is generated, not typed:

- Add, rename or delete a heading and the list changes at once.
- In the pages view, each entry shows its **page number**, which updates as the layout changes.
- **Click** an entry to jump to that heading.

Delete the table of contents like any other block: click it and press Delete.

```ts
import { toc } from "@pli.dev/docs";

session.insertBlockAtCaret(toc(3));              // headings 1 to 3
session.insertBlockAtCaret(toc(2, "Contents"));  // with your own title; use "" for none
```

The **Title** and **Subtitle** styles are not listed. Only Heading 1 to 6 are.

## Pasting a contents list

A contents list pasted from another editor (a list of links to its own headings, as Google Docs and Word write them) becomes a real table of contents here, in the document's own style, rather than a block of blue underlined links. It lists the headings this document has, so it stays current as you edit. See [Copy and paste](/documents/features/copy-and-paste/).

## In exports

| Format | Result |
|--------|--------|
| DOCX | A native table of contents field. It is filled in with the current headings, and the application that opens the file offers to update it (including page numbers) |
| HTML | A list of links to each heading |
| Markdown | A list of links to each heading |

The page numbers shown in the editor aren't written to HTML or Markdown, since those formats have no pages. In DOCX, the application that opens the file works out the page numbers when it updates the field.
