---
name: pli-documents
description: Make, design, convert and export documents (reports, proposals, letters, memos, notes, anything that would be a Word file) with Pli, and add Pli's document editor to React, Capacitor, Swift (iOS and Mac) and Kotlin (Android) apps. Use when the user wants a .docx, PDF-ready document, Markdown or HTML document produced or converted, wants a document designed or restructured, or wants an editor for documents built into an app with Pli (@pli.dev/docs, @pli.dev/react, the Pli Swift or Kotlin package).
---

# Pli documents

Pli is an open-source document engine plus editors for React, Swift and Kotlin. A document is plain JSON. The engine runs anywhere JavaScript runs, so you can make a document file without any app or browser: write it, check it, export it.

Two kinds of task, and each has its own workflow below:

- **A. Make a document** (a file for a person): follow [Making a document](#making-a-document).
- **B. Put an editor in an app**: follow [Adding the editor to an app](#adding-the-editor-to-an-app).

If the request is both (for example "build an app that edits proposals, and make a sample proposal"), do both.

## Making a document

The tool is `scripts/pli.mjs` in this skill's folder. It needs only Node 18 or later and nothing installed. Run `node scripts/pli.mjs help` for every option.

### 1. Know what is wanted

Before writing, settle: **what the document is for, who reads it, roughly how long, and where it ends up** (Word, print, the web, an app). If the user hasn't said, make a sensible choice and state it, unless the choice changes a lot (a legal letter and a menu are different documents). Ask one short question only if you can't guess.

### 2. Write it

- **Markdown by default.** Write `.md` for anything made of headings, paragraphs, lists, tables, quotes and code. It is the quickest route and the tool turns it into a properly structured document. Extras: `[TOC]` on its own line is a table of contents, `<!-- pagebreak -->` is a page break, `![alt](src){width=600 height=300}` sets a picture's size in pixels.
- **JSON when you need more than Markdown has:** headers and footers with page numbers, named styles, columns, sections with different pages, footnotes, merged table cells, cell shading, fonts and colours. The JSON can leave out ids and use shorthand (`"text"`, `"md"`, a table as rows of strings); the tool fills the rest. See [references/document-format.md](references/document-format.md).
- Page size, margins, a header line and a footer line with page numbers are command line options, so Markdown needs no JSON for them.

Design well: read [references/authoring.md](references/authoring.md) once per task. Its short form: one `#` title; a clear heading hierarchy that never skips a level; short paragraphs; real lists and real tables, not text lined up with spaces; a table of contents only when the document is long enough to need one (about four pages or more); page numbers on anything that will be printed.

### 3. Build and check

```sh
node scripts/pli.mjs build report.md --docx report.docx --json report.pli.json \
  --page a4 --footer "Page {page} of {pages}" --title-block
```

- Outputs: `--docx`, `--json` (Pli's own file, for the editor and for later changes), `--html`, `--md`. With none, it only checks and summarises.
- A mistake in JSON is reported with its place (`doc.blocks[3].level: expected 1 to 6`). Fix it and run again. The build exits with a non-zero status on any error, so treat success as "the file is valid".
- `node scripts/pli.mjs outline <file>` prints the heading structure and counts (words, tables, pictures). Read it: the outline is how you check the document says what you meant, in the order you meant.
- It also reads `.docx` files (`build in.docx --json out.json`), so an existing Word file can be changed: read it, edit the JSON, build again.

### 4. Look at it, if you can

If LibreOffice is installed (`soffice`), render the DOCX and look at the page:

```sh
soffice --headless --convert-to pdf --outdir out report.docx
```

then view the first pages of the PDF as an image (any PDF to image tool, such as `pdftoppm -png` or macOS `sips -s format png`). Check: headings are clearly bigger than text, tables are not cramped, nothing is cut off, the footer shows. If you can't render it, say so, and rely on `outline`.

### 5. Deliver

Give the user the files they asked for (usually the `.docx`), plus the `.pli.json` if they might edit it in a Pli editor, and say in a line or two what the document contains and any choices you made (page size, fonts, a table of contents). Don't paste the whole document back into the chat.

## Adding the editor to an app

Pick the platform from what the app is, then read the matching file for the code, the install steps and the pitfalls. Don't write from memory: the APIs are specific.

| App is | Read |
|---|---|
| React, Next.js, Vite, Capacitor (web content in an iOS or Android shell) | [references/react.md](references/react.md) |
| iPhone, iPad or Mac (SwiftUI, UIKit, AppKit) | [references/swift.md](references/swift.md) |
| Android (Jetpack Compose) | [references/kotlin.md](references/kotlin.md) |

Rules for every platform:

1. **Start with the finished editor** (`PliDocument` in React, `PliEditor` in Swift and Kotlin) unless the user wants their own look. It works in a few lines and has everything. Move to the pieces (toolbar, blocks) only when asked.
2. **Keep the document as a string you own** and save it on every change. The saved format is the same JSON on all platforms, so a file made by this skill's tool opens in any editor and the other way round.
3. **Install from the right place.** The JavaScript packages are on npm under the `@pli.dev` scope (`npm install @pli.dev/docs @pli.dev/react`); use the latest 1.x and don't write a version number you haven't looked up. The Swift and Kotlin packages are not on a registry: they are folders of the repository (`packages/swift`, `packages/kotlin-android`) that the app adds from a clone, as each reference says. Don't invent a Maven address, a Swift package URL other than the repository's, or a version for them.
4. **Verify**: build the app, and when you can, run it and look. Say plainly what you could and couldn't check.

## Facts that prevent mistakes

- **Positions in text are UTF-16 offsets** (a JavaScript string index, a Kotlin `String` index, a Swift `String.utf16` offset). Emoji count as two.
- **Ids must be unique** in a document. The tool fills missing ones; if you write full JSON, give every block, table row and table cell an id.
- **A table cell has at least one block**, tables don't nest, and a page break or table of contents can't be inside a cell.
- **Remote pictures (`https://…`) are not embedded in a DOCX**; a placeholder with the picture's address is written instead. For a picture that must travel with the file, use a `data:` URI.
- **PDF is made in the editor**, not by this tool (it needs a browser's layout). To get a PDF from a file: DOCX through LibreOffice as above, or the web editor's File > Download as PDF.
- **The title block and the table of contents are separate things.** `title` is the big text at the top and isn't listed in the contents; headings are.
- **Don't fake structure with formatting**: a bold line is not a heading, a row of tabs is not a table, a `-` typed in text is not a list. Use the real blocks, so the outline, the table of contents and Word's navigation work.

## Files

- `scripts/pli.mjs`: the tool (Markdown, JSON or DOCX in; DOCX, JSON, HTML or Markdown out).
- `references/authoring.md`: designing documents, the Markdown the tool reads, the JSON shorthand, document types.
- `references/document-format.md`: every field of the document JSON.
- `references/react.md`, `references/swift.md`, `references/kotlin.md`: adding the editor.
- `examples/report.md`, `examples/proposal.json`: working examples to build from (`node scripts/pli.mjs build examples/report.md --docx report.docx`).
- Full documentation: the repository's `apps/site/src/content/docs` folder (Markdown), which is also the docs site, under Pli.Documents.
