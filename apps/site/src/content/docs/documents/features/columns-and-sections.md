---
title: Columns and sections
description: Put text in two, three or four columns, and start new sections with section breaks that can have their own page setup, headers and footers, with DOCX, HTML and print export.
---

A **section** is a run of text with its own columns, page setup, and headers and footers. A **section break** starts a new one. A document with no breaks is one section.

## Columns

**Format > Columns** gives you one, two or three columns. **More options…** has four columns, the space between them and a line between them.

- **With the caret in the text**, the columns apply to the section you are in, which is the whole document if it has no section breaks.
- **With text selected**, they apply to just what you selected. Section breaks are added above and below it where needed, so the text around it keeps its columns. Use this to put one part of a page in columns and leave the rest.

Choosing **One column** puts the text back.

The text flows from the bottom of one column to the top of the next, a page at a time, and the columns on each page are evened out. A paragraph can start at the bottom of one column and carry on in the next. Images and tables stay whole in one column, and a heading stays with the text after it.

## Section breaks

**Insert > Section break** adds one of two kinds:

| Kind | Starts the new section |
|------|------------------------|
| **Next page** | On a new page |
| **Continuous** | Right after the text above, on the same page. This is how a page changes from one column to two partway down |

A break shows as a dashed line with its kind. The new section keeps the columns of the one it was split from, until you change them. Press **Backspace** at the start of the text after a break to remove it and join the two sections. The text after it takes the columns of the section above. Undo puts it back.

A section break goes between paragraphs, not in a table cell, a header or footer, or a footnote.

## Page setup for a section

**File > Page setup** has an **Apply to** choice: **Whole document** or **This section**, the section the caret is in. Page size, orientation and margins can differ from one section to the next, so a landscape table can sit between portrait pages.

- A section whose pages are shaped differently from the one before always starts on a new page, even after a continuous break, since one page can't have two shapes.
- Setting one section leaves the others as they are.
- **Whole document** gives every section the same shape and clears the per-section settings.
- The ruler shows the margins of the section at the caret, and dragging them changes that section only.
- The continuous (pageless) view uses the first section's width.

## Headers and footers for a section

A section's header and footer are **linked to the previous section** until you write its own, so they carry on from page to page as before. Double-click a header or footer on a page of the section to edit it.

- In **Options**, **Link to previous section** is checked until you uncheck it. Unchecking it starts the section's own header from a copy of the one it followed. Checking it again goes back to following the previous section, and the copy is dropped.
- **Different first page** is per section, so a section can open with its own title page header, or not. Section 0's setting is the document's.
- Each of the six places (`header`, `footer`, `headerFirst`, `footerFirst`, `headerEven`, `footerEven`) links on its own.
- Odd and even pages are a setting for the whole document.

## In exports

| Format | Sections and columns |
|--------|----------------------|
| DOCX | Native sections. Each section's properties (`w:sectPr`) carry its columns (`w:cols`, with the space between and the line), whether it starts continuously, its page size, orientation and margins, `titlePg`, and its own header and footer parts. A section that is linked to the previous one refers to none, so it is linked there too |
| HTML | A wrapper with CSS `column-count`, `column-gap` and `column-rule` for each section with columns, and `break-before: page` for one that starts a new page. A section with a different page shape is a named CSS page (`@page`) with its own size and margins |
| Markdown | Not included, since the format has no columns |

## From code

```ts
import { sectionBreak } from "@pli.dev/docs";

session.setColumns({ count: 2, gap: 24, rule: true }); // the section at the caret, or the selected text
session.setColumns(null);                              // back to one column
session.insertSectionBreak("continuous");              // at the caret

// Page setup and headers for one section (0 is the first).
session.setPageShape({ size: "letter", orientation: "landscape", margins: { top: 1, bottom: 1, left: 1, right: 1 } }, 1);
session.setSectionRegion(1, "header", [paragraph("Appendix")]); // its own header
session.setSectionRegion(1, "header", null);                     // link to previous again
session.setSectionFirstPage(1, true);
```

In the document, the columns of the first section are `page.columns`. A `section_break` block holds the `kind`, the `columns`, an optional `page` (size, orientation and margins), `differentFirstPage` and `regions` (its own headers and footers) of the section after it. `sectionsOf(doc)` lists the sections and `columnsAt(doc, index)` gives the columns at a block.

## How the page layout handles it

In the pages view, a section in columns is drawn one page at a time. The paginator decides how much of it goes on each page, and the browser flows that text into the columns. A page of columns holds whole blocks, so a single paragraph longer than a page of columns will not fit on one page. Footnotes cited in columns appear at the bottom of the page, under both columns. In the pageless view the columns are evened out.

## Not supported yet

- Different odd and even page headers for one section. That setting is the whole document's.
- Columns of unequal widths, or a heading that spans all the columns.
- A column break to move text to the next column by hand.
- Splitting one very long paragraph across two pages inside columns.
