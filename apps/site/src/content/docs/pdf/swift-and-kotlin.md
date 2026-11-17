---
title: Swift and Kotlin
description: "Open, annotate, fill in and save PDFs in an iPhone, iPad, Mac or Android app with PliPdf: pages, highlights and notes, forms, search and redaction, comments, and live editing."
---

`PliPdf` is Pli.PDF as an engine for Swift and Kotlin: the same PDF reading, annotating, form filling and writing as the [JavaScript package](/pdf/getting-started/), running in JavaScriptCore and QuickJS. It writes back the original file plus your changes, so what you didn't touch stays byte for byte and signatures stay valid. There is no page viewer yet: draw the pages with PDFKit, `PdfRenderer` or your own, and use `PliPdf` for what is on them. Install and setup are on the [Swift and Kotlin reference](/platform/swift-and-kotlin/), which also covers people, comments, live editing, storage and scripts for every editor.

**Swift**

```swift
import Pli

let pdf = try PliPdf(data: fileData, user: PliUser(id: "ada", name: "Ada"))
let page = try pdf.pages()[0]                       // id, number, width, height, rotate, label
try pdf.addHighlight(page: page.id, rects: [["x": 72, "y": 700, "w": 100, "h": 12]], kind: .highlight, color: "#ffeb3b")
try pdf.addNote(page: page.id, x: 100, y: 100, text: "Check this")
try pdf.fillForm(["name": "Ada", "subscribe": true])

let hits = try pdf.search(query: "total")                  // page id, text, rectangles
let saved = try await pdf.exportPdf()               // Data: the original file plus your changes
```

**Kotlin**

```kotlin
import dev.pli.*

PliPdf.open(fileBytes, user = PliUser("ada", "Ada")).use { pdf ->
    val page = pdf.pages()[0]
    pdf.addHighlight(page.id, listOf(mapOf("x" to 72, "y" to 700, "w" to 100, "h" to 12)), PliMarkupKind.HIGHLIGHT, "#ffeb3b")
    pdf.addNote(page.id, 100.0, 100.0, "Check this")
    pdf.fillForm(mapOf("name" to "Ada", "subscribe" to true))

    val hits = pdf.search("total")
    val saved: ByteArray = pdf.exportPdf()          // suspend: call it from a coroutine
}
```

Positions are in points in page space, as the PDF has them. `PliPdf(width:height:)` makes a new file with one blank page.

## What it does

| | Methods |
|---|---|
| Pages | `pages`, `rotatePages`, `deletePages`, `movePages`, `duplicatePages`, `insertBlankPage` |
| Annotations | `annotations(page)`, `addHighlight` (also underline, strikeout, squiggly), `addNote`, `addShape`, `addFreeText`, `addLink`, `setAnnotationText`, `moveAnnotations`, `removeAnnotations` |
| Forms | `fields`, `formData`, `fillForm`, `setFieldValue` |
| Text | `text(page)`, `search(query)` |
| Redaction | `markRedaction`, `markSearchRedactions`, `applyRedactions`: what is under the marks is removed for good, from the saved file |
| File | `metadata`, `setMetadata`, `outline`, `isDirty`, `exportPdf`, `importPdf` |

Everything else (outlines, page labels, picture annotations, signatures drawn on a page) is `call("annots.addStamp", …)` and the other methods of the session, and `apply(operations)` takes the JSON operations. `exportPdf` is `async` in Swift and `suspend` in Kotlin because it may wait for your storage (below). Opening an encrypted file takes the `password:`.

## Comments

Comments are kept in the PDF as notes and replies, which other PDF readers show, or in your own store.

```swift
let thread = try pdf.addComment(page: page.id, x: 120, y: 300, body: "Typo here")   // a sticky note plus a thread
let highlight = try pdf.addHighlight(page: page.id, rects: [["x": 72, "y": 600, "w": 50, "h": 10]], quote: "quoted")
try pdf.commentOnAnnotation(annotation: highlight, body: "Why?")
try pdf.comments.reply(to: thread.id, "Fixed")
```

```kotlin
val thread = pdf.addComment(page.id, 120.0, 300.0, "Typo here")
pdf.commentOnAnnotation(highlight, "Why?")
```

A thread's anchor is `{page, annot?, x, y, quote?}`. Saving writes the comments into the file, and opening it again reads them back.

## Storage

With a `PliStorageAdapter` in the `PliHost`, the PDF's own file (and any PDF merged in) is kept in your storage, and the document holds references; without one, the bytes stay in memory.

## Live editing

```swift
let pdf = try PliPdf(data: file, user: me)
try pdf.sync.start(room: "contract-17", transport: MySocket())
```

Two people annotating the same page both keep their notes, highlights and comments; page changes and form values merge too. The sequencer on your server is `createAuthority` with `pdfSyncModel`; see [PDF collaboration](/pdf/collaboration/).
