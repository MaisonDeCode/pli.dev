---
title: Package names
description: The npm packages Pli is split into, all under the @pli.dev scope, and which ones to install for each editor.
sidebar:
  order: 11
---

Every Pli package on npm lives under the `@pli.dev` scope, for example `@pli.dev/core` and `@pli.dev/react`. The unscoped name `pli` was already taken, so the scope carries the name.

There are nine packages. They are all at the same version, and a new release changes all of them together. [Releases and versioning](/platform/contributing/releases/) explains how, and what the version number promises.

## What to install

| You want | Install |
|---|---|
| Documents: the editor and the engine | `npm install @pli.dev/docs @pli.dev/react` |
| Sheets: the editor and the engine | `npm install @pli.dev/sheets @pli.dev/sheets-react` |
| Decks: the editor and the engine | `npm install @pli.dev/decks @pli.dev/decks-react` |
| PDF: the editor and the engine, with the pdf.js that draws the pages | `npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist` |
| An engine on its own, with no screen | The engine package only: `@pli.dev/docs`, `@pli.dev/sheets`, `@pli.dev/decks` or `@pli.dev/pdf` |

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

The packages an editor needs (`@pli.dev/core` and the engines under it) come along with it. If your own code imports from `@pli.dev/core`, for example for comments, people, live editing or fonts, install it too: `npm install @pli.dev/core`. The same goes for `@pli.dev/react`, when you load `@pli.dev/react/styles.css` next to the stylesheet of the Sheets, Decks or PDF editor. pnpm does not let your code import a package that only another package depends on, so with pnpm these steps are required. With npm, Yarn and Bun the packages are usually found anyway.

## Engines (no UI)

| Package | What it is |
|---|---|
| `@pli.dev/core` | The pieces every editor shares: operation sessions and history, ids and errors, people, comments, live editing, storage, fonts. |
| `@pli.dev/docs` | The document model, with export to Markdown, HTML and DOCX. |
| `@pli.dev/sheets` | The spreadsheet model, with Excel-compatible formulas and CSV and XLSX files. |
| `@pli.dev/decks` | The slide-deck model, with PPTX, template and PDF files. |
| `@pli.dev/pdf` | The PDF engine: reads, edits and saves real PDF files. |

The engines have no peer dependencies. Their only runtime dependencies are each other and `fflate`, a small compression library.

## React editors

| Package | What it is |
|---|---|
| `@pli.dev/react` | The document editor, and the shared toolbar, menus and styles every React editor builds on. Also `@pli.dev/react/styles.css` and `@pli.dev/react/collab`. |
| `@pli.dev/sheets-react` | The spreadsheet editor, and `@pli.dev/sheets-react/styles.css`. |
| `@pli.dev/decks-react` | The slide editor, and `@pli.dev/decks-react/styles.css`. |
| `@pli.dev/pdf-react` | The PDF viewer and editor, with `@pli.dev/pdf-react/styles.css`, `@pli.dev/pdf-react/pdfjs` (the pdf.js renderer) and `@pli.dev/pdf-react/testing` (a fake renderer for your tests). |

The React packages need `react` and `react-dom`, version 18 or 19, in your app. `@pli.dev/pdf-react` also uses `pdfjs-dist` (version 6.2.108 or later) to draw pages. It is an optional peer dependency, so install it when your app shows PDFs.

Each React package ships a `styles.css`. The one for the spreadsheet, slide and PDF editors already contains the shared toolbar, menus and colour pickers from `@pli.dev/react`, so import only the stylesheet of the editor you use.

```tsx
import "@pli.dev/sheets-react/styles.css";
```

## Swift and Kotlin

The Swift and Kotlin packages are not npm packages. Pli for Swift is a Swift package in the `packages/swift` folder of the [repository](https://github.com/MaisonDeCode/pli.dev), and Pli for Android is a Gradle module in `packages/kotlin-android`. You clone the repository and add them to your project, as [Swift](/documents/swift/#install) and [Kotlin](/documents/kotlin/#install) show.

They carry the engines as scripts that two private workspace packages build, `@pli.dev/native` and `@pli.dev/editor-host`. Those two are build tooling for the repository and are not published, so there is nothing to install from npm. See [Swift and Kotlin](/platform/swift-and-kotlin/) and, for working on them, [Working on Pli itself](/platform/contributing/).
