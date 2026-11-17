---
title: Pli.Documents roadmap
description: What Pli.Documents does today and what is still to do.
sidebar:
  order: 3
---

**Pli.Documents** is the first editor, and the shared foundations were made alongside it. It is the `@pli.dev/docs` engine and the React editor in `@pli.dev/react`. The order of all the editors, and what they share, is on the [main roadmap](/roadmap/).

## Still to do

Most of this needs real applications and devices, which the tests can't stand in for.

- [ ] **Google Docs page and section breaks on paste.** Google leaves them out of the HTML it puts on the clipboard (seen in Safari), so they don't arrive. Next: look for them in the extra data Chrome carries, or settle on the DOCX route. A [known issue](/documents/features/copy-and-paste/#not-supported-yet) until then
- [ ] **Fonts in real browsers:** load fonts from the CDN in Chrome, Safari and Firefox and look at the [font picker](/platform/fonts/#the-font-picker) (names drawn in their own fonts, the stand-in switching over, text measured again when a font arrives) and at print to PDF with a Google font. The fonts were written and tested without a browser
- [ ] **Word with Google fonts:** open a DOCX that names a Google font (`Lora`, say) in Word on a computer that doesn't have it, and see which font Word picks from the `fontTable.xml` hint (see [Fonts in files](/platform/fonts/#fonts-in-files)); also one written with `{ fonts: "office" }`
- [ ] **Input on real devices:** IME input, Safari, Firefox and mobile keyboards, including in Capacitor

## Later

- [ ] **Run the editor in the native apps for real.** Host the playground over a tunnel (such as ngrok) so it can be opened in Safari and Chrome on the iOS Simulator and Android emulator, and check input, selection and keyboards there
- [ ] **Try the example apps on real devices.** The Swift and Capacitor apps run on the iOS Simulator, and the Kotlin and Capacitor apps run on an Android 17 emulator (typing, saving, menus, the docked toolbar and the DOCX share sheet all work there). Still to see: the iOS share sheet, the on-screen keyboard on Android (the emulator used a hardware keyboard, so none appeared), and everything on a physical phone

Scripting for documents is on the [Pli.Scripts roadmap](/scripts/roadmap/).

## Done

- [x] Selection and editing commands: typing, Enter, Backspace, Delete, marks, block types, lists
- [x] Versioned JSON saving with validation
- [x] Typing with a pending format (Ctrl+B, then type), grouped undo for typing
- [x] React editor: `PliDocument` (ready-made UI), `PliEditor`, `EditorToolbar` and hooks for building your own
- [x] Page setup, real pagination with page breaks, and a pageless view
- [x] Headers, footers and page-number fields
- [x] Images: upload, paste, drop, resize, align; embedded in DOCX
- [x] Table of contents with live page numbers
- [x] Fonts, sizes, colors, spacing, title and subtitle styles
- [x] [Fonts](/platform/fonts/): the Office fonts and more than 2,000 open-licence Google families loaded on demand, a font picker, stand-ins and measuring again, font hints in DOCX, and fonts embedded in PDF
- [x] Find and replace, outline, word count, zoom, print
- [x] Tables: insert, edit in cells, Tab navigation, select across cells, rows and columns, merge and split, column and row resize, vertical alignment, header row, borders, shading, row-by-row pagination with repeated headers, export to DOCX, HTML and Markdown
- [x] Merged and split table cells, row heights, and vertical alignment in cells
- [x] File storage: send images to your own storage (S3, Supabase, your server) through a storage client, with upload progress, retry, limits and export support
- [x] Rich paste: keeps formatting from other editors, spreadsheets and web pages, pastes a spreadsheet range or web table as a real table, fills cells when pasting into a table, and copies tables as tables
- [x] Headers and footers that look and edit like a page's own text: formatting, images, columns, different first page, odd and even pages
- [x] Footnotes: numbered references, notes at the bottom of the page that cites them, edited in place, with DOCX, HTML and Markdown export
- [x] Section breaks and text columns: next-page and continuous breaks, two to four columns for a section or the selected text, with DOCX, HTML and print export
- [x] Per-section page setup and headers and footers, with link to previous, per-section first page, and DOCX and HTML export
- [x] Comments: threads on selected text, replies, resolve, a comments panel, storage in the document or your own database, role-based permissions, and DOCX export
- [x] People and presence: your own users, a pluggable realtime transport (Socket.io, WebSocket, Redis behind either, or your own), who is here and their cursors. Shared by every editor in `@pli.dev/core`
- [x] Live editing of text over the same transport: [guide](/platform/live-editing/) and [how it works](/platform/co-editing/)
  - [x] Make operations transformable: positional undo inverses, property-only block updates
  - [x] The transform for text, formatting, comments, blocks and tables, with a convergence fuzzer
  - [x] Sequencer and client in `@pli.dev/core` (`createAuthority`, `SyncClient`, `DocumentStore` with compare-and-set)
  - [x] Undo, selection and cursors that survive other people's edits
  - [x] Connection status in the interface, and a `sync` option on `PliDocument`
  - [x] A Socket.io demo server in the playground, and the playground's Collaboration mode on real live editing
  - [x] A how-to guide for live editing (server, store and client), with a tested SQL store
- [x] [Suggestions](/documents/features/suggestions/) (tracked changes): typing and deleting as proposals, accept and reject by role, DOCX tracked changes both ways
- [x] @mentions in comments: a picker fed by your user directory, ids kept with each comment for your notifications
- [x] A ruler with margin and indent handles, and paragraph indent controls
- [x] DOCX **import**: [`fromDocx`](/documents/guides/importing/) and File > Import DOCX, with text, formatting, lists, tables, pictures, sections, headers, footnotes, comments and styles
- [x] Document styles: named paragraph and character styles that can be based on each other, made from a selection, changed in one place, and carried through copy and paste, HTML and DOCX
- [x] PDF export that matches the editor exactly: [File > Download > PDF](/documents/guides/exporting/#pdf) reads the pages as the browser laid them out, with optional embedded TrueType fonts
- [x] Text wrapped around pictures (left or right): toolbar and Format menu, `session.setImageWrap`, paste from the web and other editors, DOCX and HTML export and import
- [x] Rich paste of page breaks, section breaks and contents lists from other editors: breaks become page and section breaks, and a list of links to headings becomes a real table of contents
- [x] [Swift](/documents/swift/) and [Kotlin](/documents/kotlin/) packages that run the engine ([reference](/platform/swift-and-kotlin/)), with a typed API generated from one catalog
- [x] DOCX checked in Microsoft Word and LibreOffice: Pli's files open in both, and files from LibreOffice and Apple tools import
- [x] [Numbered lists](/documents/features/lists/): letters and roman numerals, square and circle bullets, restart at 1, start at any number and continue, through the toolbar, paste, DOCX (read and written the way Word and LibreOffice number) and HTML
- [x] Headers and footers with pictures take exactly the room they show: the page's copy, the copy that measures the space, and the one being edited are the same size, in column layouts too
- [x] DOCX files saved by Microsoft Word import, comments and tracked changes included, and read back the same: its numbering (levels, restarts, a start at another number, capital letters and roman numerals), title and quote styles, contents list, table, picture, footnote, header and footer
- [x] Rich paste checked against real copies from Word (a whole document), Excel, Numbers, Pages and Google Docs, with their captures kept as test fixtures. Pages and other apps that offer only RTF are read from the RTF
- [x] [Example apps](/platform/example-apps/) for Swift (SwiftUI), Kotlin (Jetpack Compose) and Capacitor (iPhone, iPad and Android), and an `onDownload` option on `PliDocument` so File > Download works inside a native web view
- [x] A phone-friendly toolbar: docked at the bottom above the keyboard, the most used controls first, the menu pinned at the edge, and the layout and zoom in that menu
- [x] Native building blocks for Swift (UIKit and SwiftUI) and Kotlin (Compose): editable rich-text blocks, a toolbar and menus (`PliBlocksView`, `PliToolbarView`, `PliBlocks`, `PliToolbar`), each usable on its own, with `content()` and `format()` reads in the engine API
- [x] Native blocks: selecting across blocks and table cells by press and drag or Shift and the arrow keys, table editing (rows, columns, merge, header row, cell colour), and select all, cut, copy and paste
- [x] Native blocks: copy and paste that keep formatting (HTML and RTF in, HTML out), pictures from the photo picker, dragging a table's column edges, and no bar of arrows above the iPhone keyboard in the full editor
- [x] Native blocks: resizing a table's rows by dragging, and tapping a picture to select it, drag its corner to resize it, and a picture menu (size, delete)
- [x] Pictures can be cropped (a `crop` on the picture, kept in DOCX as `srcRect`, drawn in HTML, PDF and the editor), and the native blocks crop them by dragging edges or to a shape, and wrap text around them
- [x] Text wraps around a picture inside a table cell (web editor, DOCX in and out, and the native blocks), pasting a picture that comes with text on Android, and the Mac toolbar above the document
- [x] A crop control in the web editor (Picture options > Crop, dragging the edges, or to a shape), and line-by-line text wrapping around pictures in Compose
- [x] Native blocks for macOS, drawn with AppKit (`NSTextView`): the same blocks, toolbar, tables, pictures and selecting across blocks as on iPhone
- [x] `PliEditor` for Swift (SwiftUI) and Kotlin (Compose): the full editor from one line, with the document as a string you own, saving, exporting and the share sheet or a save dialog for files
- [x] AI agent skill (`skills/pli-documents`): an agent makes, converts and designs documents (Markdown, JSON or DOCX in; DOCX, JSON, HTML or Markdown out) and adds the editor to React, Capacitor, Swift and Kotlin apps; `fromMarkdown` in `@pli.dev/docs`; `llms.txt` and `llms-full.txt` for the docs
