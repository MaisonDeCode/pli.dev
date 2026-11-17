---
title: Pages and layout
description: Real pages with page size, margins and page breaks, or one continuous column.
---

The editor shows your document in one of two layouts. Switch between them in the status bar or the **View** menu.

| | Pages | Pageless |
|---|---|---|
| Looks like | Sheets of paper with a gap between them | One continuous column |
| Header and footer | Repeated on every page | Hidden |
| Page numbers | Yes, including in the table of contents | No |
| Best for | Letters, reports, anything that gets printed or exported to DOCX | Notes, reading on a phone, wide screens |

## Page setup

**File > Page setup** (or `session.setPage()`) sets the paper size, orientation and margins. The settings are saved with the document.

```ts
session.setPage({
  size: "a4",                // "letter" | "a4" | "legal" | "a5"
  orientation: "landscape",
  margins: { top: 1, right: 1, bottom: 1, left: 1 }, // inches
});

session.setPage(null);       // back to the default: US Letter, portrait, 1 inch margins
```

`pageDimensions(page)` returns the width and height in inches with orientation applied, and `PAGE_SIZES` lists the sizes.

## How pages work

All the text lives in a single editor, so the caret, selection, undo and find move across page boundaries as they would in one long document. The page sheets are drawn behind it, and the editor measures the real, rendered text and inserts gaps so that content avoids the boundaries:

- **Paragraphs split between lines.** A paragraph that crosses the bottom of a page continues on the next one. At least two lines stay on each side, so you never get a lone first or last line (orphans and widows).
- **Headings stay with what follows.** A heading is never left alone at the bottom of a page.
- **Tables break between rows.** A row that doesn't fit moves to the next page, with a copy of the table's header row above it. Rows joined by a merged cell move together. See [Tables](/documents/features/tables/).
- **Images, tables of contents and other whole blocks move together.** If one doesn't fit, it starts on the next page. A block taller than a page is allowed to overflow instead.
- **Page breaks** (`Ctrl/Cmd+Enter`, or **Insert > Page break**) start the following content on a new page.

Layout updates as you type, resize an image, change the page setup or zoom. Zoom runs from 50% to 200%.

## Sections

A section break can start a section with its own page size, orientation and margins, and its own headers and footers. See [Columns and sections](/documents/features/columns-and-sections/).

## Printing and PDF

**File > Print** exports the document to HTML with its page size, margins, and header and footer, and opens the browser's print dialog. Choose "Save as PDF" there to make a PDF.

The browser paginates this copy itself, so a page break can fall in a slightly different place than it does in the editor. Headers and footers are printed through CSS page margin boxes, which Chrome and Edge support. In other browsers the document prints without them. For a PDF that matches the editor exactly, use **File > Download > PDF**. See [Exporting](/documents/guides/exporting/#pdf).

## Not supported yet

- Wrapped images in headers, footers and footnotes. Pictures there stay on their own line.
