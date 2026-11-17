---
title: Headers, footers and page numbers
description: Text that repeats on every page, with fields for the page number and page count.
---

A header sits at the top of every page and a footer at the bottom. They are part of the document and are saved, exported and printed with it.

## Editing

- **Double-click** the top or bottom margin of any page, or use **Insert > Header** or **Insert > Footer**.
- The band lights up, the body steps back, and a tag shows which one you are editing (**Header**, **First page footer**, and so on) with **Options** and **Done** on its edge.
- Type as you would in the body. Everything you change shows on every page that uses it as you type.
- Click **Done**, press **Esc**, or click back into the body to finish.

If the header or footer is taller than the margin, the body makes room for it. With a first-page or even-page version, the body leaves room for the tallest one, so every page has the same text area. Headers and footers show in the pages view, not the pageless view.

## Formatting, images and columns

The toolbar and menus work in a header or footer as they do in the body: fonts, sizes, colors, bold and italic, alignment, links, lists and images. Text with no size of its own is 9 pt and grey, the usual default for a header, and the size box shows that.

Images can be added by upload, paste or drop, and go to your [storage](/documents/guides/storing-files/) if you set one up.

**Columns** are a borderless table. In the header or footer, choose **Options > Columns** for two columns (text on the left and right) or three (left, centre and right), and type in each one. Use it for a logo on the left, a title in the centre and the page number on the right. It is an ordinary table, so you can add more columns, change widths by dragging, or shade cells from the toolbar. The columns take the place of an empty line and leave no blank line under them. They sit flush with the text above, and a picture inserted into an empty cell fills it with no line left beneath, so a header is only as tall as what is in it.

## Different first page, and odd and even pages

In **Options** (or **File > Page setup**):

- **Different first page** gives page 1 its own header and footer. It starts empty, so a cover page has none until you add one.
- **Different odd and even pages** gives even pages their own. The ordinary header and footer then serve odd pages.

Both can be on at once, and the first page wins on page 1. Turning an option off keeps what you wrote, so turning it back on brings it back. From code:

```ts
session.setRegionOptions({ differentFirstPage: true, differentOddEven: true });
session.setRegion("headerFirst", [paragraph("Annual report")]);
session.setRegion("headerEven", [paragraph("Pli")]);
```

The six places are `header`, `footer`, `headerFirst`, `footerFirst`, `headerEven` and `footerEven`. `regionKeyFor(page, "header", 3)` tells you which one a page shows.

## Sections

After a [section break](/documents/features/columns-and-sections/), headers and footers are linked to the previous section until you give the section its own. Uncheck **Link to previous section** in **Options** to edit them separately, and **Different first page** is set for each section.

## Page numbers

A **field** shows a value that Pli works out for each page.

- **Insert > Page number** adds a centered page number to an empty footer. If the footer already has content, it opens the footer so you can place the number yourself.
- While editing a header or footer, **Insert > Page number** and **Insert > Page count** put a field at the caret. Combine them: `Page 3 of 12`.

In the editor a field is shown with a faint highlight. In the saved document it is a normal run of text carrying a `field` mark, and the text is the last value it had.

```ts
import { paragraph, text } from "@pli.dev/docs";

session.setRegion("footer", [
  paragraph(
    ["Page ", text("1", { field: "page" }), " of ", text("1", { field: "pages" })],
    "center",
  ),
]);

session.setRegion("footer", null); // remove it
```

## In exports

| Format | Header and footer | Page number fields |
|--------|-------------------|--------------------|
| DOCX | Native headers and footers, with first-page and even-page versions (`titlePg` and `evenAndOddHeaders`). Images, columns and formatting are kept | Real `PAGE` and `NUMPAGES` fields, so they stay current |
| HTML print | Page margin boxes (`@page`), including `:first`, `:left` and `:right` for the first, even and odd pages. First paragraph only | Page counters |
| HTML, Markdown | Not included | Not applicable |

For print, only the first paragraph of each header or footer is used, as plain text, because page margin boxes can't hold rich content. Images, columns and formatting appear in the DOCX export. A first-page or even-page version that is turned off, or empty, is left out of the DOCX file, so those pages have no header.

## Good to know

- An image still uploading when you click Done keeps its temporary address for a moment. The saved header switches to the stored file when the upload ends.
- Editing happens in a copy of the header or footer, so undo inside it is separate from the body's. After Done, one undo reverses the whole change.
