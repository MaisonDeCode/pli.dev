---
title: Copy and paste
description: What copying puts on the clipboard, and how pasting keeps formatting from other editors, spreadsheets and web pages, including pasting a spreadsheet range as a real table.
---

Paste keeps what matters from where it came from: character formatting, headings, lists, links, images and tables. Pasting a range of spreadsheet cells, or a table from a web page, gives you a real table with its merged cells, shading and column widths.

## Pasting

| You paste | You get |
|-----------|---------|
| Something copied from a Pli document | An exact copy: every block, mark, table span and shade, whatever the other apps would have made of it |
| Another editor, a spreadsheet, or a web page | The formatting listed [below](#what-is-kept) |
| Cells copied from a spreadsheet, or tab-separated text | A table, one cell per value |
| Plain text | Text, with each line break starting a new paragraph |
| A screenshot, or an image copied from a page | An image, [embedded like any other](/documents/features/images/) |

When the clipboard holds several of these, the richest one that works is used, in the order above. Spreadsheets and other editors also put a picture of what you copied on the clipboard. Pli pastes the cells or text, not the picture.

**Paste without formatting** (`Ctrl+Shift+V`, or **Edit > Paste without formatting**) always pastes plain text.

Paste is one undo step. Images that don't say how big they are are measured once they load and fitted to the page, as part of the same step.

Some applications, Pages and TextEdit among them, put RTF and plain text on the clipboard but no HTML. When the browser hands over RTF and there is no usable HTML, it is read instead: paragraphs and bulleted or numbered lists, with bold, italic, underline, strikethrough, size, colour, font and alignment. RTF has no named styles, so a heading copied from Pages arrives as a bold, larger paragraph. Some browsers turn RTF into HTML themselves, and then the HTML is used.

### What is kept

- **Text**: bold, italic, underline, strikethrough, code, superscript and subscript, text color, highlight, font family and font size. A font or size that is the document's default (Arial, 11 pt) is left out so the text still follows the document if you change it. Very light text colors, and very light or very dark highlights, are dropped, because they are almost always a dark theme's white text, which would vanish on a white page.
- **Blocks**: paragraphs, headings (`h1` to `h6`), quotes, code blocks (with a language from a `language-xyz` class), horizontal rules, line breaks, and alignment.
- **Lists**: bulleted and numbered, nested to any depth, with their [style and numbering](/documents/features/lists/): a list that starts at 5 or restarts at 1, letters, roman numerals, and square or circle bullets. Lists from other editors, which are really paragraphs with list markup, become real lists, and the typed `1.` or bullet is not pasted as text.
- **Links**: `http`, `https`, `mailto` and `tel` only.
- **Images**: `http` and `https` addresses, and embedded PNG, JPEG, GIF, WebP and BMP images. Width and height are used if present. A picture that floats left or right in the source (a text-wrapped picture) comes in with [text wrapped around it](/documents/features/images/#wrapping-text-around-a-picture). A picture in the middle of a paragraph goes in front of that paragraph, so the sentence stays whole.
- **Page breaks and section breaks**: a break before or after a block (`page-break-before`, `page-break-after`, `break-before`, `break-after`), a `page-break` element, and a Word-style section break each become a page break or section break at that place.
- **Table of contents**: a list of links to headings in the same document, as in a Google Docs or Word contents list, becomes a real [table of contents](/documents/features/table-of-contents/) that updates as you edit. The "Table of contents" or "Contents" line above it becomes its title, and the indent of each line sets its level.
- **Word's own styles**: Title, Subtitle and Quote paragraphs become title, subtitle and quote blocks, and a picture keeps the size Word gave it.
- **Indents**: a left margin or padding on a paragraph becomes its left indent.
- **Tables**: rows and columns, `colspan` and `rowspan`, header cells, column widths, row heights, cell shading, vertical alignment, and a table that says it has no borders.

Styles written in a `<style>` block, such as Excel's `class="xl65"`, are applied for simple class, tag and id selectors.

### What is left out

Everything else, on purpose. Scripts, styles, event handlers (`onclick` and the like), forms, frames, embedded objects, hidden elements, comments, `javascript:` links, and images with any other kind of address are never read, so pasting from an untrusted page cannot put anything active into your document. Paragraph spacing and line height are not imported, so pasted text takes on the look of the document it lands in.

### Where it goes

- **One paragraph** goes into the text at the caret, taking on the formatting around it. In an empty paragraph, a single heading, list item, quote or code block keeps its kind.
- **Several blocks** split the paragraph at the caret. The first joins the text before the caret, the last joins the text after it, and the rest go between. At the very start of a paragraph nothing joins before.
- **A selection** is replaced.
- **Inside a table cell**, tables can't nest, so a pasted table becomes lines of text, one per row with a tab between cells. Tables of contents, page breaks and wrapped pictures are left out (the picture stays in line).

## Pasting a table into a table

With the caret in a table, or some cells selected, pasting a table fills the cells from there, like pasting a range into a spreadsheet. The table grows to fit: new rows at the bottom, new columns on the right. The pasted cells are then selected, so you can shade or format them straight away.

Cells that are merged can't be overwritten piece by piece. If the area you are pasting over has one, the table is pasted as lines of text instead. Delete or split the merged cell first to paste over it.

## Spreadsheet text

Text with tabs and line breaks is read the way spreadsheets write it, as long as it forms a rectangle. That means at least two rows and two columns, with every row the same width. A value in double quotes can hold tabs, line breaks and `""` for a quote. Anything else that happens to contain a tab, such as indented code, is pasted as text.

## Copying

Copy and cut write three things to the clipboard:

- `text/plain`: the text, one line per block. A table, or a range of cells, is tab-separated rows, with a quoted value where a cell holds a tab, a line break or a quote. It pastes cleanly into Excel and Numbers.
- `text/html`: the same HTML Pli exports, so other apps keep the formatting.
- `application/x-pli-fragment`: Pli's own format, for lossless copying between Pli documents.

What is copied depends on the selection. Dragging across cells copies just those cells as a table, with merged cells intact and the header row kept if the range starts at the top. A range that covers a whole table copies it as a table. A range that only touches part of a table copies that text as ordinary paragraphs.

## From code

```ts
// What a paste event offered, in whatever you have:
const result = session.paste({
  fragment: data.getData(FRAGMENT_MIME),
  html: data.getData("text/html"),
  text: data.getData("text/plain"),
  plain: false, // true for "paste without formatting"
});
result.applied;       // whether anything was pasted
result.unsizedImages; // ids of images whose size you may want to measure
```

`PliEditor` and `PliDocument` do this for you, including the copy side and measuring images. A custom editor that builds on `PliEditor` can call `ref.paste(input)` to paste from its own menu.

The pieces are also available on their own:

| Function | Does |
|----------|------|
| `htmlToFragment(html)` | Reads HTML into blocks, as described above, without touching a document. Safe on untrusted HTML |
| `parseTabSeparated(text)` | Reads spreadsheet text into a table, or returns `null` |
| `readPaste(input)` | Chooses what to paste from a clipboard's contents |
| `commands.insertFragment(blocks)` | The command behind paste: insert blocks at the caret, or fill cells |
| `sliceSelection(doc, selection)` | The selected part of a document, as a document |
| `fragmentToJson(blocks)`, `parseFragmentJson(json)` | Pli's clipboard format. Parsing validates, and returns `null` for anything malformed |
| `cloneBlocks(blocks)` | Copies blocks with new ids throughout |

Pasted blocks keep their ids unless the document already uses them, in which case they get new ones.

## Limits

Pasted tables are limited to 500 rows and 40 columns, and a merged cell to 40 squares in either direction. HTML is read to a depth of 256 elements and 400,000 nodes, and at most 20,000 blocks are taken. Pli's own format is limited to 32 MB. Anything past a limit is cut off or ignored, not an error.

## Not supported yet

- Paragraph spacing and line height from the source.
- **Known issue: page breaks and section breaks copied from Google Docs.** Google Docs does not put them in the HTML it places on the clipboard (checked with a copy from Safari), so they do not arrive when you paste. To keep them, use **File > Download > Microsoft Word (.docx)** in Google Docs and then [import the file](/documents/guides/importing/). Copies from Chrome may carry more, and this has not been looked at yet.
- Named styles, footnotes and comments from other editors.
- Pasting several different tables at once into a table. Only a lone table fills cells.
- **Edit > Paste** asks the browser for permission to read the clipboard and cannot read Pli's own format, so use `Ctrl+V` for an exact copy between Pli documents. If permission is refused, it pastes plain text.
