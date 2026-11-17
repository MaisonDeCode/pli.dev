---
title: Exporting
description: What Markdown, HTML and DOCX export each preserve.
---

All exporters are pure functions of a `Doc`. They never mutate it. To read a DOCX file back in, see [Importing DOCX files](/documents/guides/importing/).

If your app keeps images in its own storage, prepare the document first with `embedImages` or `resolveImages`. See [Storing files](/documents/guides/storing-files/#exporting).

```ts
import { toMarkdown, toHtml, toDocx } from "@pli.dev/docs";
```

## What each format keeps

| Feature | Markdown | HTML | DOCX |
|---------|:--------:|:----:|:----:|
| Title, subtitle, headings 1–6 | ✓ | ✓ | ✓ |
| Bold, italic, strike, code | ✓ | ✓ | ✓ |
| Underline, superscript, subscript | `<u>`, `<sup>`, `<sub>` | ✓ | ✓ |
| Font, size, text color, highlight | ✗ | ✓ | ✓ |
| Links | ✓ | ✓ (unsafe schemes blocked) | ✓ |
| Nested bulleted and numbered lists | ✓ | ✓ | ✓ |
| List styles and start numbers | Numbers only | `type`, `start`, `list-style-type` | Real numbering |
| Block quotes, code blocks, dividers | ✓ | ✓ | ✓ |
| Alignment, line spacing, indents | ✗ | ✓ | ✓ |
| Images | ✓ (as links) | ✓ | ✓ (embedded PNG, JPEG, GIF) |
| Text wrapped around a picture | ✗ | `float` | Anchored picture, square wrapping |
| Tables | GFM table | `<table>` | Table, header row repeats |
| Table of contents | Link list | Link list | Field |
| Suggestions | Deletions struck through | `<ins>` and `<del>` | Tracked changes |
| Page break | `<div>` | ✓ | ✓ |
| Page size, orientation, margins | ✗ | Print CSS (`fullDocument`) | ✓ |

| Header, footer, page numbers | ✗ | Print margin boxes | ✓ Real header, footer and fields |
| Document title | ✗ | `<title>` with `fullDocument` | Document properties |

PDF is separate, because it is a picture of the pages as the editor laid them out. See [PDF](#pdf).

## Markdown

Returns a string of CommonMark with GFM strikethrough. Text that would be re-read as markup (a paragraph starting with `# `, or `*` characters) is escaped, and emphasis markers never wrap leading or trailing spaces.

## HTML

Returns a fragment by default. Pass `{ fullDocument: true }` for a complete page. All text is escaped, and links using schemes like `javascript:` are replaced with `#`.

## DOCX

Returns a `Uint8Array` of a zipped Office Open XML package.

```ts
// Browser
const blob = new Blob([toDocx(doc)], {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// Node
import { writeFileSync } from "node:fs";
writeFileSync("report.docx", toDocx(doc));
```

Fonts are written by name: `Lora` stays `Lora`, with a hint in `fontTable.xml` so that a computer without it picks a similar font. Word has no Google fonts, so pass `{ fonts: "office" }` to write the nearest Office font instead. Font files are not embedded in the DOCX. See [Fonts](/platform/fonts/#fonts-in-files).

Separate ordered lists each restart at 1. Control characters that XML can't represent are removed. Page setup, headers and footers with `PAGE` and `NUMPAGES` fields, and embedded images are written as native DOCX structures, and the table of contents is a field that the application offers to refresh on open.

:::note
DOCX output is checked for package structure and well-formed XML, and read back with python-docx and macOS text tools (headings, styles, page setup, header and footer text, image sizes). Opened in Word and LibreOffice, a file shows its styles, lists (each numbered list restarting at 1), merged and shaded table cells, footnotes, headers and footers with page numbers, comments and replies, and tracked changes with their authors. A table of contents shows its headings and is filled in with page numbers when the application updates it (Word offers to).
:::

## PDF

**File > Download > PDF** saves the pages exactly as the editor shows them. Every line of text is where the browser put it, and every border, shading, picture, table, list marker, footnote, header and footer is where it was drawn, so the PDF breaks pages and lines where the editor does. It does not go through the print dialog.

It reads what the editor drew and writes it as a PDF with `toPdf`, a plain writer in `@pli.dev/docs`. Positions come from the browser's own layout, not from a second layout engine that might disagree. That is why it needs the **page view**: `PliDocument` switches to it while it reads the pages and switches back. Pages are read in a light theme, so a document read in dark mode still comes out black on white.

```tsx
import { exportPdf, downloadFile } from "@pli.dev/react";

const { bytes, warnings } = await exportPdf(document.querySelector(".pli-document")!, { title: doc.title });
downloadFile("report.pdf", bytes, "application/pdf");
```

### Fonts

PDF files have 14 built-in fonts: Helvetica, Times and Courier in four styles each. Text in any other font is drawn in the closest of them, **stretched or squeezed to the width the browser gave it**, so words land where they were laid out even when the letters differ a little. The built-in fonts hold the characters of Western European languages, with typographic quotes, dashes and the euro sign. Other characters come out as `?` and are listed in `warnings`.

The editor's own File > Download > PDF embeds the fonts the document uses for you when its [font registry](/platform/fonts/#pdf-files) has their files. To keep your fonts yourself, or to cover other scripts, pass TrueType files, named by family and style:

```tsx
<PliDocument
  session={session}
  pdfFonts={{
    Georgia: georgiaRegular,          // Uint8Array
    "Georgia bold": georgiaBold,
    "Georgia italic": georgiaItalic,
  }}
/>
```

The same option is `fonts` for `exportPdf` and `toPdf`. Fonts are embedded whole (no subsetting yet, so a large font makes a large file) and the text stays selectable and searchable.

### What is kept

Text with its font, size, color, bold, italic, underline and strikethrough; backgrounds, borders and rules; pictures (JPEG as they are, others re-encoded, never larger than twice the size shown); hyperlinks to web, mail and phone addresses; headers, footers, page numbers, footnotes and the table of contents. What is not: comment highlights and the editor's own markers, and text colors from a theme that the page doesn't apply.

### Without a browser

`toPdf(pages, options)` takes pages described as positioned text, rectangles, lines and pictures in points, and knows nothing about the DOM, so a native editor can write the same files from its own layout. Text, rectangles and lines take a `clip` (a rectangle, like a picture's) that they are cut off at, and `options.date` fixes the date written in the file, so the same pages always make the same bytes. [Pli.Sheets](/sheets/grid/#printing) uses it to print a sheet to PDF. On a server, load the document in a headless browser and call `exportPdf`, or use the browser's print to PDF with `printDocument`.
