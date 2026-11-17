# Changelog

Every release of the `@pli.dev/*` packages, newest first. The nine packages share one version number, so each entry here covers all of them. The detail for a single package is in the `CHANGELOG.md` inside it.

## 1.0.0

First release on npm.

- **Documents**: `@pli.dev/docs` (the document model, operations, history, Markdown, HTML, DOCX and PDF export, DOCX import) and `@pli.dev/react` (the editor, with `@pli.dev/react/collab` for live editing and `@pli.dev/react/styles.css`).
- **Sheets**: `@pli.dev/sheets` (workbook model, Excel-compatible formulas, CSV and XLSX files) and `@pli.dev/sheets-react` (the grid editor).
- **Decks**: `@pli.dev/decks` (slide model, themes, layouts, PPTX files, PDF export) and `@pli.dev/decks-react` (the slide editor).
- **PDF**: `@pli.dev/pdf` (reads and writes PDF files, annotations, pages, form values) and `@pli.dev/pdf-react` (the viewer and editor; `pdfjs-dist` is an optional peer dependency).
- **Shared**: `@pli.dev/core` (operation sessions, history, comments, people, live editing and storage primitives that every product uses).
- ES modules only, with TypeScript declarations. Node 20 or later. React 18 and 19 for the editors.
