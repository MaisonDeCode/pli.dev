# Designing and writing documents

How to make a document that reads well, in Markdown or JSON, and what the tool understands.

## Design rules

**Structure first.** Write the outline before the prose: the title, the sections, what each section must say. Then fill it in. A reader should be able to understand the document from its headings alone.

- **One title.** Use a `title` block (Markdown: a `#` heading with `--title-block`) or a single `#` heading. Don't repeat it as the first line of text.
- **Headings are a hierarchy.** `#` then `##` then `###`. Never skip a level to get a smaller size. A section with only one subsection should usually have none. Keep headings short, and make them say something ("Revenue grew 12%" beats "Results") when the document argues something.
- **Paragraphs are short**: three to five sentences. One idea each. Put the conclusion first when the reader is busy.
- **Lists are for parallel items**, not for sentences that belong together. Keep items the same grammatical shape. Don't nest more than two levels. Use a numbered list only when order matters or items are referred to by number.
- **Tables are for comparing values.** Give every table a header row and keep it to what fits on a page width (about six columns). Right-align numbers (`---:` in Markdown). Put a sentence before the table saying what to notice in it; a table never explains itself.
- **Emphasis is rare.** Bold the one thing in a paragraph that must not be missed, not whole sentences. Italic for titles and terms. Don't underline (it looks like a link).
- **Quotes** for quoted words only. Code blocks for code, commands and exact text.
- **A table of contents** when the document has about four pages or more, or more than six sections. Not for a one-page letter.
- **Page numbers** (`--footer "Page {page} of {pages}"`) on anything printed or sent as a file. A header line (company, document name) on anything with more than two pages. Leave the first page's header off for letters (`differentFirstPage`, JSON only).
- **Page breaks** between major parts (a cover, an appendix) and never to push a heading to the top by hand; let the pages flow.
- **Page size** follows the reader: `a4` outside North America, `letter` inside it. Margins of 1 inch (2.5 cm) are the default; go to 0.75 for dense material and 1.25 for a short, airy document.
- **Fonts and colours**: leave the defaults unless the user asks. If they do, choose one family for text and at most one for headings, keep body text 10 to 12 points, and use colour only for links, a single accent in headings, or table header shading. Make sure text stays readable in black and white.
- **Plain language.** Cut every sentence that doesn't help the reader act or understand. Define a term the first time it appears.
- **Placeholders**: if a fact isn't known (a name, a date, a figure), don't invent it. Write `[Client name]` so it is obvious, and tell the user what is missing.

## Document types: what each needs

| Document | Shape |
|---|---|
| **Report** | Title block, optional subtitle and date, contents if long, summary first (the answer), then sections, figures in tables, appendix after a page break. |
| **Proposal** | Title and who it's for, overview (the problem and the offer), scope (list), timeline, price (table with a total row), terms, next steps with a date. |
| **Letter** | No title block, no contents. Sender, date, recipient, greeting, body of three to four short paragraphs, closing, name. First page without a header. |
| **Memo** | A short header table or lines (To, From, Date, Subject), then the point in the first paragraph, then support. One to two pages. |
| **Meeting notes** | Title with date and people, decisions first, then action items as a list or a table (who, what, by when), then discussion. |
| **How-to / guide** | Numbered steps in order, one action per step, warnings before the step they apply to, a short "before you start" list. |
| **Resume / CV** | One to two pages, headings per section, dates right-aligned in a table with no borders (`"borders":"none"`), bullet points of results with numbers. |
| **Policy / terms** | Numbered sections, defined terms in bold at first use, a short summary at the top. |

## What the Markdown reader understands

| Write | You get |
|---|---|
| `# Title` … `###### Small` | Headings (levels 1 to 6). `--title-block` makes the first `#` the document's title block. |
| Blank-line separated text | Paragraphs. Lines within one paragraph are joined with a space. |
| `**bold**`, `*italic*` or `_italic_`, `~~strike~~`, `` `code` `` | Marks. They nest: `**bold and *both***`. Backslash escapes: `\*`. |
| `[text](https://…)`, `<https://…>` | A link. |
| `- item`, `* item`, `+ item`; indent two spaces to nest | A bulleted list. |
| `1. item`, `1) item` | A numbered list. A list that starts at another number (`3.`) starts there. |
| `> quote` | A quote. |
| ` ``` ` fences, with a language after the first | A code block. |
| `\| a \| b \|` rows with a `\|---\|---\|` line under the first | A table, header row first. `:---`, `:---:`, `---:` align a column left, centre, right. |
| `---` alone on a line | A horizontal rule (a divider). |
| `[TOC]` alone | A table of contents of headings to level 3. |
| `<!-- pagebreak -->` alone | A page break. |
| `![alt](address){width=600 height=300}` alone on a line | A picture, sized in pixels (default 480 by 270). Use a `data:` address for a picture that must be inside a DOCX. |

Not in Markdown: headers and footers (use `--header` and `--footer`), fonts, colours, columns, merged cells, footnotes, comments. For those, write JSON.

## The JSON shorthand

`node scripts/pli.mjs build file.json …` accepts a document in the full format (see [document-format.md](document-format.md)) with these conveniences, which the tool expands:

- **No ids needed.** Missing `id`s are filled in.
- **`"text": "plain"`** or **`"md": "with **bold** and [links](https://…)"`** instead of `runs`, on any text block. `runs` can be a list of strings.
- **A table as rows of strings**: `"rows": [["Phase","Weeks"],["Design","3"]]`, with `"headerRow": true`. A cell can be a string (Markdown), a block, a list of blocks, or a full cell. `columns` defaults to equal widths; give fractions that add up to 1 to change them.
- **`header` and `footer` as a string**: `"footer": "Page {page} of {pages}"`. `{page}` and `{pages}` become page-number fields. Also `headerFirst`, `footerFirst`, `headerEven`, `footerEven`.
- **A block can be a string** (a paragraph in Markdown).
- The file can be a bare list of blocks, or `{ "title": "…", "blocks": […] }`, or a full saved document.

Example:

```json
{
  "title": "Meeting notes",
  "footer": "Page {page} of {pages}",
  "blocks": [
    { "type": "title", "text": "Product meeting" },
    { "type": "paragraph", "md": "**Date:** 4 March. **Present:** Ana, Ben, Chloe." },
    { "type": "heading", "level": 1, "text": "Decisions" },
    { "type": "list_item", "list": "ordered", "depth": 0, "text": "Ship the reporting module in April." },
    { "type": "heading", "level": 1, "text": "Actions" },
    { "type": "table", "headerRow": true, "columns": [0.5, 0.25, 0.25],
      "rows": [["Action", "Who", "By"], ["Draft the announcement", "Chloe", "10 March"]] }
  ]
}
```

## Checking your work

1. `node scripts/pli.mjs outline file` shows the headings in order, and the counts. Does it read like the plan you made? Are there headings that are really sentences, or sections with one line?
2. For anything long, build the DOCX and render a PDF to look at it (see SKILL.md).
3. Read the text once as the recipient: is the first paragraph enough if they stop there? Is every placeholder marked? Are numbers consistent between the text and the tables?

## Changing an existing document

Read it (`build in.docx --json doc.json`), edit the JSON (or rebuild from edited Markdown that you export with `--md`), build again. State what you changed. Word features Pli doesn't have are listed as warnings when a DOCX is read; tell the user if anything was dropped. Tracked changes in the file come in as suggestions rather than being applied; don't accept them unless asked.
