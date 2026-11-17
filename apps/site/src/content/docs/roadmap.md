---
title: Roadmap
description: The order the editors are built in, what they share, and where each one stands.
---

Documents, Sheets, Decks and PDF are on npm (`@pli.dev/docs`, `@pli.dev/sheets`, `@pli.dev/decks`, `@pli.dev/pdf` and their React editors), and what is still open in each is listed below. Boards, Forms, Databases and Scripts are planned and have no packages yet. Releases and the version rules are on [Releases and versioning](/platform/contributing/releases/).

Pli is built one editor at a time, and every editor reuses the session, operation, comments, people and export code in `@pli.dev/core`. This page gives the order, what is shared and the platforms. Each editor has its own roadmap with the detail.

| # | Product | Status | Roadmap |
|---|---------|--------|---------|
| 1 | **Pli.Documents** | **In progress.** The engine and a React editor: pages, tables, comments, suggestions, live editing, styles, and Markdown, HTML, DOCX and PDF files | [Pli.Documents roadmap](/documents/roadmap/) |
| 2 | **Pli.Sheets** | **In progress.** The engine (Excel-compatible formulas, 475 functions, history, CSV and XLSX files), a React grid editor, charts, borders, merged cells, conditional formats, data validation, tables, and copy and paste that keeps the look | [Pli.Sheets roadmap](/sheets/roadmap/) |
| 3 | **Pli.Decks** | **In progress.** The engine (masters, layouts, themes, operations, history), a React slide editor in the style of Google Slides, present mode, PPTX files in and out, template import (`.potx`, `.pptx`, Google Slides exports) and PDF export | [Pli.Decks roadmap](/decks/roadmap/) |
| 4 | **Pli.Boards** | Planned | [Pli.Boards roadmap](/boards/roadmap/) |
| 5 | **Pli.Forms** | Planned | [Pli.Forms roadmap](/forms/roadmap/) |
| 6 | **Pli.PDF** | **In progress.** The engine (read and write PDF files, annotations, pages, forms, text search and redaction, history) and `PdfEditor`, a React editor: viewer drawn by pdf.js, annotation tools, page tools, form filling and preparing, redaction, a File menu, and comments, people and live editing from the shared parts. No cryptographic signing and no screen for replacing text yet. The engine is there for Swift and Kotlin (`PliPdf`), without a native viewer | [Pli.PDF roadmap](/pdf/roadmap/) |
| 7 | **Pli.Databases** | Planned | [Pli.Databases roadmap](/databases/roadmap/) |
| 8 | **Pli.Scripts** | Proposed ([RFC](/platform/scripting/)) | [Pli.Scripts roadmap](/scripts/roadmap/) |

## Shared foundations

Built once in `@pli.dev/core` and `@pli.dev/docs`, for every editor. They were made alongside Pli.Documents, the first editor to use them.

- [x] Sessions, JSON operations, undo and redo, and versioned JSON saving with validation
- [x] File storage: send images and files to your own storage (S3, Supabase, your server) through a storage client, with progress, retry and limits
- [x] People and presence: your own users, a pluggable realtime transport (Socket.io, WebSocket, Redis behind either, or your own), who is here and their cursors
- [x] Comments: threads, replies, resolve, @mentions, role-based permissions, storage in the document or your own database
- [x] Live editing over the same transport: [guide](/platform/live-editing/) and [how it works](/platform/co-editing/)
- [x] Named styles, as a model other editors can use
- [x] [Fonts](/platform/fonts/): one font list (the Office fonts and more than 2,000 open-licence Google families), loader, picker and file hints for every editor, and [why it is built on Fontsource](/platform/fonts-decision/)
- [ ] Fonts, by hand: look at font loading in Chrome, Safari and Firefox (picker and print to PDF), open files that name Google fonts in Word, Excel and PowerPoint, and decide the licence terms before shipping fonts inside a product (Pli bundles no font files: a host that serves them keeps each family's licence text). Detail on the roadmaps of [Documents](/documents/roadmap/), [Sheets](/sheets/roadmap/) and [Decks](/decks/roadmap/)
- [x] Comments, presence and live editing in [Pli.PDF](/pdf/collaboration/): comments kept in the PDF or your store, presence, and live editing over the same server and transport
- [ ] Comments, presence and live editing in each other new editor (they arrive with it)

## Platform support

| Platform | Plan |
|----------|------|
| JavaScript (React, Capacitor, anything else) | Native TypeScript packages |
| Swift | Typed wrappers over the engines running in JavaScriptCore (`packages/swift`): documents, workbooks, decks and PDFs |
| Kotlin | Typed wrappers over the engines running in QuickJS (`packages/kotlin`): documents, workbooks, decks and PDFs |

The Swift and Kotlin APIs are generated from catalogs of commands (`packages/native/src/catalog.json` and `editors.json`), and the engines check every call against the same catalogs, so the three stay in step.

- [x] [Swift](/documents/swift/) and [Kotlin](/documents/kotlin/) packages that wrap the engine ([reference](/platform/swift-and-kotlin/)): a typed API over JavaScriptCore and QuickJS, generated from one catalog and tested on both
- [x] [Workbooks, decks and PDFs](/platform/swift-and-kotlin/) for Swift and Kotlin (`PliWorkbook`, `PliDeck`, `PliPdf`), with the shared features every editor has: people, comments with anchors for each editor, presence and live editing over a transport you write, storage, and scripts
- [x] The full editor for Swift (SwiftUI) and Kotlin (Compose), as the web editor in a web view: `PliEditor`
- [x] Native building blocks for Swift and Kotlin, drawn with UIKit, SwiftUI and Compose instead of a web view: rich-text blocks, a toolbar and menus to make your own editor (including selecting across blocks and table editing)
- [ ] Native views for Sheets, Decks and PDF in Swift and Kotlin (a grid, a slide canvas, a page viewer), as the building blocks are for Pli.Documents. The engine APIs are there; the views are separate work and need checking on a device or simulator
- [ ] The Android build of the Kotlin package (`kotlin-android`, with the Android build of QuickJS) run on an emulator or device: this repository tests the JVM build
- [ ] Capacitor: the web editor checked on real devices (see [Pli.Documents](/documents/roadmap/))

## Known limitations today

- Text offsets are UTF-16 code units, matching JavaScript strings. The Swift and Kotlin wrappers pass offsets through as they are, so a Swift `String.utf16` offset or a Kotlin `String` index is the right number.
- The native (Swift and Kotlin) packages have the engine API for every editor, and the editor views only for Pli.Documents: no native grid, slide canvas or page viewer yet. The limits of the Pli.Documents files (what DOCX export and import do and don't carry) are on its pages: [exporting](/documents/guides/exporting/) and [importing](/documents/guides/importing/).
- DOCX files from Pli open correctly in Microsoft Word, LibreOffice and macOS Quick Look (numbered-list restarts and contents page numbers included), and files from Word (comments and tracked changes included), LibreOffice and Apple tools import.

## The website

- [x] Landing page with a scroll story, live Documents, Sheets, Decks and PDF editors, product-page heroes and one design system. Checked by the site build, jsdom tests of every live editor, and a check of every internal link in the built site.
- [ ] Checked in real browsers: the look of the landing page and posters in light and dark, the scroll story's pinning, motion with and without `prefers-reduced-motion`, the phone layout, and loading speed on a real connection (the Sheets editor is a 1.8 MB chunk, loaded only when its chapter is near).
- [ ] A social sharing image (`og:image`).
