---
title: Lists
description: Bulleted and numbered lists, their styles, and starting or restarting the numbers.
---

## Making a list

- The **Bulleted list** and **Numbered list** buttons in the toolbar, or `Ctrl+Shift+8` and `Ctrl+Shift+7`, turn the selected paragraphs into list items. Press the same button again to turn them back.
- Press **Enter** for the next item. Pressing it on an empty item takes you up a level, and out of the list at the top level.
- **Tab** and **Shift+Tab**, or the indent buttons, move an item in and out. Lists nest up to nine levels.

## Styles

A list's marker changes with its level: 1. a. i. for numbered lists, and • ◦ ▪ for bullets. To choose another, put the caret in the list and open the menu next to the list buttons (or **Format > Lists**).

| Numbered | Bulleted |
|----------|----------|
| 1. 2. 3. | • Disc |
| a. b. c. | ◦ Circle |
| A. B. C. | ▪ Square |
| i. ii. iii. | |
| I. II. III. | |

The style applies to the whole list at that level, not only the item you are in. Items in a nested list keep their own style.

## Numbering

Items count up from the one before. A numbered list starts again from 1 after any other paragraph, and a nested list starts again under each item. The same menu lets you change that:

- **Restart at 1** makes the item you are in number 1, and the items after it count on from there.
- **Start at…** takes any number from 0 to 99,999. In a list written in letters or roman numerals, 3 is c or iii.
- **Continue numbering** takes the item back into the count of the list above it, undoing a restart.

Use these for a list that carries on after a paragraph (say, step 4 after a note) or one that starts at another number (an appendix numbered from 5).

```ts
session.setListMarker("upper-roman"); // I. II. III.
session.setListMarker(null);          // back to the default for the level
session.setListStart(5);              // the selected item is 5, and the items after it count on
session.continueNumbering();          // undo that
```

In the document, a list item can carry a `marker` and, for a numbered item, a `start`. An item without them takes the default for its level, and counts on from the item before. `listLabels(blocks)` gives the marker text the editor draws for each block ("3.", "iv.", "•"), for your own views and exports.

```ts
import { listItem, listLabels } from "@pli.dev/docs";

const items = [listItem("ordered", "One"), { ...listItem("ordered", "Two"), start: 7 }, listItem("ordered", "Three")];
listLabels(items).map((l) => l?.text); // ["1.", "7.", "8."]
```

## In exports and when pasting

| Format | Result |
|--------|--------|
| DOCX | Real Word numbering: the style of each level, and a restart or a start number as a numbered list of its own that begins where you said. Word and LibreOffice show the same numbers |
| HTML | `<ol>` with `start` and `list-style-type`, and `value` on an item that restarts in the middle of a list |
| Markdown | The numbers the list shows. Letters and roman numerals are written as the numbers they stand for, because Markdown has no other kind, and a restart in the middle of a list can't be expressed |

DOCX import reads each level's style, the number it starts at, restarts, and lists that carry on past other paragraphs, counting the way Word and LibreOffice do. Pasted HTML keeps `start`, `type`, `list-style-type` and `value`, and so do lists copied from Word, whose labels (`iii.`, `C.`, `7.`) give the style and number.

## Good to know

- A DOCX file has one style per level per list. If items at the same level of one list have different styles, the first one's style is written for all of them.
- A list item copied from Google Docs that holds a heading becomes a heading, so its number is lost.
