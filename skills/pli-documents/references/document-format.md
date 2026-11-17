# The document format

A Pli document is JSON with no classes and no platform types. Saved files look like this, and every editor (React, Swift, Kotlin) opens them:

```json
{ "format": "pli.doc", "version": 1, "doc": { "id": "doc_1", "type": "document", "title": "Notes", "blocks": [ … ] } }
```

`node scripts/pli.mjs validate file.pli.json` checks a saved file and names the place of a mistake. Unknown fields are refused, so a misspelled field is an error, not silently ignored. (`node scripts/pli.mjs build file.json` accepts shorthand and fills ids; see authoring.md.)

## Document

| Field | |
|---|---|
| `id`, `type: "document"`, `title` | Required. `title` is the document's name (not the title block). |
| `blocks` | The content, in order. |
| `page` | `{ "size": "letter" / "a4" / "legal" / "a5", "orientation": "portrait" / "landscape", "margins": {top,right,bottom,left} in inches, "columns"?, "differentFirstPage"?, "differentOddEven"? }`. Without it: US Letter, portrait, 1 inch margins. |
| `header`, `footer` | Blocks repeated on every page (odd pages with `differentOddEven`). |
| `headerFirst`, `footerFirst` | The first page's own, used with `page.differentFirstPage`. Empty means none. |
| `headerEven`, `footerEven` | Even pages', used with `page.differentOddEven`. |
| `footnotes` | `{ "<id>": [blocks] }`: note text by id, shown for each run with a `footnote` mark. |
| `styles` | Named styles by id (below). |
| `comments` | Comment threads kept in the document. Leave to the editor. |

## Text and marks

Text lives in **runs**: `{ "text": "Hello ", "marks": { "bold": true } }`. Adjacent runs with equal marks are merged. Marks:

| Mark | Value |
|---|---|
| `bold`, `italic`, `underline`, `strike`, `code`, `superscript`, `subscript` | `true` |
| `link` | the address (`https://…`, `mailto:…`) |
| `color`, `highlight` | `"#rrggbb"` |
| `fontFamily` | `"Georgia"` |
| `fontSize` | points, 1 to 400 |
| `field` | `"page"` or `"pages"`: the run's text is a number the page shows (in headers and footers) |
| `footnote` | the id of a note in `doc.footnotes`; the run is one zero-width character (U+200B) |
| `style` | the id of a character style |

## Blocks

Every block has a unique `id` and a `type`.

**Text blocks** have `runs` and, except for code, optional `align` (`left`, `center`, `right`, `justify`), `format` and `style`:

| `type` | Extra fields |
|---|---|
| `paragraph` | |
| `heading` | `level` 1 to 6 |
| `title`, `subtitle` | Larger than any heading; not listed in a table of contents |
| `quote` | |
| `list_item` | `list`: `"bullet"` or `"ordered"`; `depth`: nesting from 0 (up to 8); `marker`: `decimal`, `lower-alpha`, `upper-alpha`, `lower-roman`, `upper-roman`, `disc`, `circle`, `square`; `start`: number an ordered item takes, so numbering restarts or begins there and carries on |
| `code_block` | `language`; marks are ignored |

A list is a run of consecutive `list_item` blocks. A paragraph between two items ends the first list.

`format` (paragraph spacing, all in points except `lineHeight`): `lineHeight` (a multiple, e.g. 1.15), `spaceBefore`, `spaceAfter`, `indentLeft`, `indentRight`, `indentFirst` (negative for a hanging indent).

**Other blocks:**

| `type` | Fields |
|---|---|
| `divider` | A horizontal rule. |
| `page_break` | Content after it starts on a new page. Not allowed in a table cell. |
| `toc` | `levels` 1 to 6; `title` optional. Built from the headings; pages are worked out by the editor and Word. |
| `image` | `src` (a URL or `data:` URI), `width`, `height` (CSS pixels, the size shown), `alt`, `align`, `wrap` (`"left"` / `"right"`: text runs beside it, also inside a table cell), `crop` `{top,right,bottom,left}` as shares 0 to 0.9 cut from each edge (width and height are the size of what is left). |
| `table` | below |
| `section_break` | below |

## Tables

```json
{ "id": "b_t", "type": "table", "headerRow": true, "borders": "all", "columns": [0.5, 0.25, 0.25],
  "rows": [ { "id": "r_1", "cells": [ { "id": "c_1", "blocks": [ { "id": "b_1", "type": "paragraph", "runs": [{"text":"Phase"}] } ] }, … ] } ] }
```

- `columns`: one fraction per column, adding up to 1. `headerRow`: the first row is a header (bold, shaded, repeated in Word). `borders`: `all` (default), `horizontal`, `none` (use `none` to lay things out, such as a resume's dates).
- **Every row has one cell per column**, including where cells are merged. A merged cell is the top-left cell with `colSpan` and/or `rowSpan`; the squares it covers hold cells marked `"covered": true` with no blocks.
- Cell: `blocks` (at least one; text blocks, images and dividers only), `shade` (`"#rrggbb"`), `vAlign` (`top`, `middle`, `bottom`). Row: `height` (a minimum, in points).
- Tables don't nest.

## Sections and columns

A `section_break` starts a new section: `kind` `"next_page"` or `"continuous"`; `columns` `{ "count": 1 to 4, "gap": points, "rule": true }`; `page` `{ size, orientation, margins }` for pages that differ from the section before; `differentFirstPage`; `regions` with that section's own `header`, `footer`, `headerFirst`… (anything not listed is the previous section's). The columns of the first section are `doc.page.columns`.

## Named styles

`doc.styles` maps ids to `{ "name": "Caption", "kind": "paragraph" / "character", "basedOn"?: id of a style of the same kind, "marks"?: {bold, italic, underline, strike, superscript, subscript, color, highlight, fontFamily, fontSize}, "align"?, "format"? }` (align and format are for paragraph styles). A block or run uses one with `"style": "<id>"`. What a block sets itself wins over its style. Styles can't be based on each other in a circle.

## Limits and rules the checker enforces

- Ids are unique across the whole document, including table rows and cells.
- Numbers are within range: heading `level` 1 to 6, list `depth` 0 to 8, `fontSize` 1 to 400, crop 0 to 0.9 and not cutting away more than 95%.
- A table's rows and cells form a regular grid.
- Offsets and positions anywhere (comments, selections) are UTF-16 code units.

## From code

In JavaScript, `@pli.dev/docs` has builders so you don't write ids by hand: `createDoc(title, blocks)`, `title`, `subtitle`, `heading(level, content)`, `paragraph(content)`, `listItem("bullet" / "ordered", content, depth)`, `quote`, `codeBlock`, `table(rows, { headerRow })`, `image(src, {width, height}, {alt})`, `toc(levels)`, `pageBreak()`, `divider()`, and inline `bold`, `italic`, `code`, `link(text, href)`. Then `serializeDoc(doc)`, `parseDoc(json)`, `toDocx(doc)`, `toHtml(doc)`, `toMarkdown(doc)`, `fromDocx(bytes)`, `fromMarkdown(text)`.
