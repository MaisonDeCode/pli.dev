---
title: Introduction
description: What Pli is, and the two ways to use each editor in it.
---

Pli is an open-source SDK for adding documents, sheets, decks, boards, forms, PDFs and databases to your app, on the web, iOS and Android.

Every editor is built in two layers, and you choose how much of it to use:

| | Ready-made UI | Build your own |
|---|---|---|
| **What you get** | A complete editor with toolbar, keyboard shortcuts, clipboard and theming | The engine and the editing building blocks, with no UI |
| **Effort** | A few lines of code | You design the interface |
| **Good for** | Shipping quickly, internal tools, prototypes | A custom look, an unusual layout, a non-React framework, native apps |
| **Documents** | `PliDocument` from `@pli.dev/react`, a full document editor | `@pli.dev/docs`, plus `PliEditor` and hooks if you want help with the editing surface |

The two aren't separate products. The ready-made UI is built from the same public pieces you'd use yourself. You can start with it and replace one part at a time, for example the toolbar, and keep the rest.

## Install

Install the packages for the editor you want from npm. Each line is an engine and its React editor:

```sh
npm install @pli.dev/docs @pli.dev/react                    # Documents
npm install @pli.dev/sheets @pli.dev/sheets-react           # Sheets
npm install @pli.dev/decks @pli.dev/decks-react             # Decks
npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist      # PDF
```

The React editors need `react` and `react-dom` 18 or 19 in your app. All the packages share one version number and are released together; see [Releases and versioning](/platform/contributing/releases/) for what the number promises and what Pli supports, and [Package names](/platform/package-names/) for what each package is. For Swift and Kotlin, see [Swift](/documents/swift/) and [Kotlin](/documents/kotlin/).

## Pick an editor

Each editor has its own section and its own roadmap. Use the menu at the top of the sidebar to move between them.

- **[Documents](/documents/)**: rich text documents.
- **[Sheets](/sheets/)**: spreadsheets. Excel-compatible formulas, CSV and XLSX files, and a React grid editor.
- **[Decks](/decks/)**: presentations. Masters, layouts and themes, a Google Slides style editor, present mode, PPTX and PDF files, and template import.
- **[PDF](/pdf/)**: open, view, annotate, reorganise, fill, redact and save PDF files, with a React editor.
- **Boards, Forms, Databases**: planned, in that order. Their sections describe what each will cover.

See the [roadmap](/roadmap/) for status, and [Architecture](/platform/architecture/) for how the layers fit together.

## What every editor shares

- **A portable engine.** Written in TypeScript with no DOM or Node dependencies, so the same logic runs in browsers, iOS and Android.
- **Operations for every change.** Undo, history, export and scripting all build on one small set of JSON operations.
- **Export and import.** Each editor ships with the file formats people expect.
- **Scripting.** Your users can automate their documents, and you control what scripts may do. See [Pli Scripts](/platform/scripting/).
