---
title: Swift and Kotlin reference
description: "The engine API for Swift and Kotlin: documents, workbooks, decks and PDFs, every command, comments, people, live editing, files, scripts, setup, threads, and how the engines run in JavaScriptCore and QuickJS."
sidebar:
  order: 9
---

The same engines that run in the browser run in iOS and Android apps, behind an API written for each language: documents (`PliDocument`), workbooks (`PliWorkbook`), decks (`PliDeck`) and PDFs (`PliPdf`). A `PliDocument` is a document with a selection, and the methods on it are what an editor does:

**Swift**

```swift
import Pli

let doc = try PliDocument(title: "Notes")
try doc.typeText("Quarterly numbers")
try doc.setHeading(1)
try doc.splitBlock()
try doc.typeText("Sales were ")
try doc.toggleBold()
try doc.typeText("up")

print(try doc.markdown())        // "# Quarterly numbers\n\nSales were **up**\n"
let file = try doc.exportDocx()  // Data
```

**Kotlin**

```kotlin
import dev.pli.*

PliDocument(title = "Notes").use { doc ->
    doc.typeText("Quarterly numbers")
    doc.setHeading(1)
    doc.splitBlock()
    doc.typeText("Sales were ")
    doc.toggleBold()
    doc.typeText("up")

    println(doc.markdown())      // "# Quarterly numbers\n\nSales were **up**\n"
    val file: ByteArray = doc.exportDocx()
}
```

## The editors and the building blocks

Three ways in, from most finished to most your own: the full editor (`PliEditor`, the web editor in a web view), native building blocks (editable text, tables and pictures with a toolbar and menus, drawn with UIKit, AppKit, SwiftUI and Jetpack Compose), and the engine on its own (`PliDocument`, below). They read and write the same JSON, so a document made in one opens in the others and in the web editor.

- [Swift (iPhone, iPad and Mac)](/documents/swift/): install, `PliEditor`, `PliNativeEditor`, `PliBlocksView`, `PliToolbarView` and the menus, the model, pictures, tables and clipboard.
- [Kotlin (Android)](/documents/kotlin/): install, `PliEditor`, `PliBlocks`, `PliToolbar` and the menus, the state, pictures, tables and clipboard.
- [Example apps](/platform/example-apps/): small apps for each that you can build and run.
- [Workbooks](/sheets/swift-and-kotlin/), [decks](/decks/swift-and-kotlin/) and [PDFs](/pdf/swift-and-kotlin/): cells, slides and pages with the same shared features.

## What is there

The packages are the **engine** and a typed API over it for each editor: open, edit, read, save, import and export; the **editor** (documents); and **building blocks** for making your own editor (documents). For anything else you draw yourself, use what the engine tells you (`blocks()`, `content()`, `selection()`, `state()` for a document; `sheets()`, `cell(…)`, `values(…)` for a workbook; `slides()`, `elements(…)` for a deck; `pages()`, `annotations(…)` for a PDF).

| Editor | Swift | Kotlin | Opens | Files |
|---|---|---|---|---|
| Documents | `PliDocument` | `PliDocument` | JSON, new | `.docx` |
| Sheets | `PliWorkbook` | `PliWorkbook` | JSON, `.xlsx`, CSV, new | `.xlsx`, CSV, PDF |
| Decks | `PliDeck` | `PliDeck` | JSON, `.pptx`, new | `.pptx`, PDF |
| PDF | `PliPdf` | `PliPdf` | `.pdf`, new | `.pdf` (the original file plus your changes) |

All four share the same base, `PliEditorCore`, so the rest of this page is the same for each:

| | |
|---|---|
| **Open and save** | An initializer for a new file or a saved one (`documentJSON()` gives the JSON that opens again), and a file each editor reads |
| **Edit** | The typed methods below, **operations** (`apply([…])`, the JSON each editor's operations are, the same that live editing sends) and `call("method", args)` for any method of the editor's session by name |
| **Hear about changes** | `onChange { change in … }` with the operations, whether it was yours, undo, redo or someone else's, and `canUndo` and `canRedo` |
| **People** | `users`: who is using the file and what they may do |
| **Comments** | `comments`: threads anchored to a text range, a cell, a slide element or a point on a PDF page, with @mentions, roles and your own store |
| **Live editing** | `sync`: presence and shared editing over a transport you write, with a sequencer on your server (or in the app) |
| **Files** | `storage`: uploads to your storage, with limits |
| **Scripts** | `scripts.run(source)`: a script that reads and changes the file through operations, within limits |
| **Errors** | `PliError` (Swift) and `PliException` (Kotlin), each with a `code` such as `invalid_document` and a `message` |

Positions in a document are in UTF-16 units (a Swift `String.utf16` offset, a Kotlin `String` index). Documents saved by the native packages open in the web editor, and the other way round, because the file is the same JSON. The commands for a document, a workbook, a deck and a PDF are listed in the catalogs (below).

## Commands

Every command is a method on its editor's class in both languages. They are written from catalogs in `packages/native/src` (`catalog.json` for documents, `editors.json` for the rest), so a method added there appears in Swift, in Kotlin and in the engine's argument checks at once.

| Editor | Commands |
|--------|----------|
| Documents | Typing, text and paragraph formatting, lists, tables, pictures, styles, selection, suggestions: see below |
| Sheets | Cells (`setCell`, `setCells`, `setValues`, `clear`, `setFormat`, `setStyle`), reading (`cell`, `value`, `values`, `text`, `usedRange`, `find`, `replace`), `fill`, `autofill`, `copy`, `sort`, rows and columns, merges, notes, filters, names, sheets, charts, `undo`, `redo` |
| Decks | Slides (`addSlide`, `duplicateSlides`, `moveSlides`, `setNotes`, `setLayout`, `setBackground`), elements (`addTextBox`, `addShape`, `addImage`, `addTable`, `addChart`, `setText`, `formatText`, `setFrame`, `arrange`, `align`, `group`), `find`, `replaceAll`, `undo`, `redo` |
| PDF | Pages (`rotatePages`, `deletePages`, `movePages`, `insertBlankPage`), annotations (`addHighlight`, `addNote`, `addShape`, `addFreeText`, `addLink`), forms (`fields`, `fillForm`, `setFieldValue`), text (`text`, `search`), redaction (`markRedaction`, `applyRedactions`), `setMetadata`, `undo`, `redo` |

For everything the typed methods don't cover (a pivot table, a chart's series, a form field's appearance), `call("method", arguments)` runs any method of the editor's session by name, and `apply(operations)` applies operations directly. Both take and give JSON:

**Swift**

```swift
try book.call("groupRows", ["Sheet1", 2, 5])
try book.apply([["type": "set_frozen", "sheet": .string(id), "rows": 1, "cols": 0]])
```

**Kotlin**

```kotlin
book.call("groupRows", "Sheet1", 2, 5)
```

### Document commands

| Group | Commands |
|-------|----------|
| Typing | `typeText`, `pasteText`, `splitBlock`, `backspace`, `deleteForward`, `deleteSelection`, `undo`, `redo` |
| Text | `toggleBold`, `toggleItalic`, `toggleUnderline`, `toggleStrikethrough`, `toggleCode`, `toggleSuperscript`, `toggleSubscript`, `setTextColor`, `setHighlight`, `setFontFamily`, `setFontSize`, `setLink`, `clearFormatting` |
| Paragraphs | `setParagraph`, `setTitle`, `setSubtitle`, `setHeading`, `setQuote`, `setCodeBlock`, `toggleBulletedList`, `toggleNumberedList`, `setAlignment`, `indent`, `outdent`, `setLineSpacing`, `setSpaceBefore`, `setSpaceAfter` |
| Insert | `insertTable`, `insertPageBreak`, `insertDivider`, `insertImage`, `setImageSize`, `setImageCrop`, `setImageWrap`, `deleteImage`, `setDocumentTitle` |
| Tables | `addRowAbove`, `addRowBelow`, `addColumnLeft`, `addColumnRight`, `deleteRow`, `deleteColumn`, `deleteTable`, `mergeCells`, `splitCells`, `setHeaderRow`, `setCellShade`, `setColumnEdge`, `setRowHeight` |
| Styles | `applyParagraphStyle`, `applyCharacterStyle`, `createStyle`, `deleteStyle` |
| Selection | `select`, `selectAll` |
| Suggestions | `setSuggesting`, `acceptSuggestion`, `rejectSuggestion`, `acceptAllSuggestions`, `rejectAllSuggestions` |
| Comments | `commentOnSelection`, `commentRanges`, `threadsAtSelection` |

Commands return `true` when they changed something and `false` when there was nothing to do (backspace at the start of the document, a viewer asking to suggest). They throw only when the call itself is wrong.

## People, comments, live editing and files

Every editor has the same shared features, built once in the engine and handed to the app through four small interfaces you implement, so nothing depends on a server or a vendor. Each is optional.

| You provide | Interface | Used for |
|---|---|---|
| People | `PliUserDirectory` | Names and pictures for the ids stored in comments; search for @mentions |
| Comment storage | `PliCommentStore` | Keeping threads in your database instead of in the file |
| File storage | `PliStorageAdapter` | Uploading pictures (and PDF sources) to your storage |
| A pipe to a room | `PliTransport` | Presence, comments and live editing over your socket |

They go in a `PliHost` when you open a file. Every callback is `async` in Swift and `suspend` in Kotlin; the engine waits for your answer without blocking the caller of an edit.

### People

**Swift**

```swift
let book = try PliWorkbook(user: PliUser(id: "ada", name: "Ada"), host: PliHost(directory: MyDirectory()))
try book.users.setCurrent(PliUser(id: "vee", name: "Vee"), role: .viewer)   // a viewer can read, and not comment
let grace = try book.users.user(id: "grace")   // asks the directory; a placeholder named "grace" until it answers
```

**Kotlin**

```kotlin
val book = PliWorkbook(user = PliUser("ada", "Ada"), host = PliHost(directory = MyDirectory()))
book.users.setCurrent(PliUser("vee", "Vee"), PliRole.VIEWER)
val grace = book.users.user("grace")
```

### Comments

A thread is a conversation about one place in a file, and the place is its `anchor`, which each editor documents. The typed methods make the anchor for you. `comments` is the same for every editor: reply, edit, resolve, reopen, delete, ask what the current user may do, and hear about changes (yours at once, other people's as they arrive).

| Editor | Start a thread | Anchor (JSON) |
|---|---|---|
| Documents | `commentOnSelection(body:)` | `{block, from, to, quote}`: the text is highlighted and the highlight follows it |
| Sheets | `commentOnRange(sheet:range:body:)` | `{sheet, cell, range?}`: by the sheet's id, so renaming the sheet changes nothing |
| Decks | `commentOnSlide`, `commentOnElement` | `{slide, element?, text?, point?, quote?}` |
| PDF | `addComment(page:x:y:body:)`, `commentOnAnnotation` | `{page, annot?, x, y, quote?}`: a sticky note or a highlight, which other PDF readers show |

**Swift**

```swift
let thread = try book.commentOnRange(sheet: "Sheet1", range: "B2:C3", body: "Is this right? @Grace", mentions: ["grace"])
try book.comments.reply(to: thread.id, "Yes")
try book.comments.resolve(thread.id)
book.comments.onChange { origin, change in print(origin, change.threadID) }
```

**Kotlin**

```kotlin
val thread = book.commentOnRange("Sheet1", "B2:C3", "Is this right? @Grace", listOf("grace"))
book.comments.reply(thread.id, "Yes")
book.comments.resolve(thread.id)
book.comments.onChange { origin, change -> println("$origin ${change.threadId}") }
```

Where the threads are kept: in the file (documents and decks keep them inside it, PDFs as notes and replies), or in your `PliCommentStore`, which is asked to `load` them and to `save` each change in order. A store that fails takes the change back and the app hears of it.

### Live editing

`sync.start` joins a room over your transport. Presence (who is here, with what selection), comments and the file's own changes all travel it as JSON. A **sequencer** puts everyone's changes in one order: on your server it is `createAuthority` from `@pli.dev/core` over your database, and for sessions between devices (and tests) a `PliAuthority` runs it inside the app.

**Swift**

```swift
final class SocketTransport: PliTransport {
    func connect(room: String, receive: @escaping @Sendable (String) -> Void) async throws { /* join the room, call receive(json) for each message */ }
    func send(_ json: String) { /* send to everyone else in the room */ }
    func disconnect() { /* leave */ }
}

let doc = try PliDocument(json: saved, user: me, live: true)
try doc.sync.start(room: "doc-42", transport: SocketTransport())
doc.sync.onState { state in print(state.status, state.unsynced) }   // connecting, synced, saving, offline, resyncing
doc.sync.onPeers { peers in /* draw cursors */ }
try doc.sync.setOnline(false)   // changes made now are kept, and sent when it is back
```

**Kotlin**

```kotlin
class SocketTransport : PliTransport {
    override suspend fun connect(room: String, receive: (String) -> Unit) { /* join the room, call receive(json) for each message */ }
    override fun send(json: String) { /* send to everyone else in the room */ }
    override fun disconnect() { /* leave */ }
}

val doc = PliDocument(json = saved, user = me, live = true)
doc.sync.start(SocketTransport(), room = "doc-42")
doc.sync.onState { println("${it.status} ${it.unsynced}") }
doc.sync.onPeers { peers -> /* draw cursors */ }
doc.sync.setOnline(false)
```

The JSON on the wire is the same as the web packages send, with the same [`webSocketTransport` and `socketTransport` framing](/platform/realtime/), so a native app and a browser can be in one room. `live: true` on a document says it will be shared, so comment highlights travel as ordinary changes. `PliMemoryHub` joins transports in memory, for tests and demos:

```swift
let hub = PliMemoryHub()
hub.serve(try PliAuthority(editor: .documents, initial: try doc.json()), room: "doc-42")
try doc.sync.start(room: "doc-42", transport: hub.transport())
await hub.settle()
```

### Files

`storage` sends bytes to your `PliStorageAdapter` after checking the limits you gave (`storageMaxBytes`, `storageAllowedTypes`), and returns the reference to keep in the document. A document's pictures use it when one is given; a PDF keeps its own file there too.

```swift
let host = PliHost(storage: MyBucket(), storageMaxBytes: 5_000_000, storageAllowedTypes: ["image/*"])
let doc = try PliDocument(host: host)
let upload = try await doc.storage.upload(png, name: "logo.png", type: "image/png")   // upload.ref
```

### Scripts

`scripts.run` runs a piece of JavaScript against the file. It never touches the file directly: `ctx.apply(operations)` goes through the session, so everything it does is undoable (one run is one undo step), reaches other people when the file is shared, and stays within the grants and limits you set. A script that throws is taken back.

```swift
let cells = try book.scripts.run("""
    const sheet = ctx.state.sheets[0];
    ctx.apply([{ type: "set_cells", sheet: sheet.id, cells: { A1: { v: 4 } } }]);
    return Object.keys(sheet.cells).length;
    """, grants: [.read, .write], maxOps: 1000, maxMilliseconds: 2000)
```

```kotlin
val cells = book.scripts.run("return ctx.state.sheets.length", grants = listOf(PliScriptCapability.READ))
```

The script runs in the engine's own JavaScript world, which has no network and no files. That is not a barrier against hostile code, so run scripts your app wrote or has checked (the [Pli Scripts RFC](/platform/scripting/) describes the sandboxed runtime planned for scripts from users).

## Setting up

**Swift.** Clone the repository and add the `packages/swift` folder as a Swift package dependency (iOS 15, macOS 12 and later); see [Swift](/documents/swift/#install). It has no other dependencies: JavaScriptCore is part of the operating system.

**Kotlin.** From a clone of the repository, add `packages/kotlin` as a Gradle module (for the JVM), or `packages/kotlin-android` for an Android app, which adds the editor and the blocks; see [Kotlin](/documents/kotlin/#install). It depends on [quickjs-kt](https://github.com/dokar3/quickjs-kt): the JVM build is used in the module, and an Android app should depend on `io.github.dokar3:quickjs-kt` (the same library's Android build) in place of `quickjs-kt-jvm`. The Android build is the same API, but this repository tests the JVM one.

Both packages carry one script for each editor: `pli-engine.js` (documents, about 360 KB), `pli-sheets.js` (1.3 MB), `pli-decks.js` (about 470 KB) and `pli-pdf.js` (about 440 KB), each with no dependencies and no DOM. An editor's script is read and started the first time a file of that editor is opened, so an app that only opens PDFs never loads the spreadsheet engine (the files do ship inside the package). If you work on Pli itself, they are rebuilt with:

```sh
pnpm native
```

which also regenerates the typed methods. The tests of the three packages (the engines in an empty JavaScript world, Swift on JavaScriptCore, Kotlin on QuickJS) run with `pnpm native:test`, and fail if a generated file is out of date.

The tests run on a Mac with Swift and a JDK and need no simulator or device. What they can't show: the Android build of the library (`kotlin-android`) compiling and running on a device or emulator, and the packages inside a real app on a device.

## Threads

A file can be used from any thread, one call at a time. Calls take a millisecond or so but block while the engine runs, so on Android call them off the main thread. Files of one editor share one engine unless you give them their own (`PliEngine.create(kind)` in Kotlin), which a busy app might do to keep one file's work from waiting on another's. Callbacks you give (comment stores, storage, directories, transports) run on background threads and may take as long as they like; a method that waits for them (`storage.upload`, `exportPdf`) is `async` in Swift and `suspend` in Kotlin, and doesn't block its caller. Listeners (`onChange`, `comments.onChange`, `sync.onState`) are called on the thread that made the change, or the one that delivered it, after the engine has finished, so a listener may call the engine again.

## How it works

Each engine is the TypeScript of an editor package (`@pli.dev/docs`, `sheets`, `decks`, `pdf`) and `@pli.dev/core`, bundled with esbuild into one script (`packages/native/dist`). Its interface is a handful of functions that take and return text, so nothing but strings crosses between the languages:

```js
Pli.openEditor("sheets", "json", null, '{"title":"Budget"}')   // → {"ok":true,"value":1}   (a handle)
Pli.invoke(1, "setCell", '["Sheet1","A1",42]')                  // → {"ok":true,"value":null}
Pli.apply(1, '[{"type":"set_cells",…}]', '{}')                  // operations, as one undo step
Pli.exportFile(1, "xlsx", '{}')                                 // → base64
```

An answer is `{ok: true, value}` or `{ok: false, error: {code, message}}`; nothing throws across the boundary. The Swift and Kotlin layers turn those into types and exceptions.

Three things make the shared features work in an engine that can't call the app, has no timers and no network:

- **Events.** The engine never calls the app. It leaves *events* (a change, a comment, a request such as "save this comment" or "send this message to the room"), which ride back on the next reply as `events`. The app answers a request with `hostResolve`.
- **Pending work.** Something that isn't finished when a call returns (writing a PDF, waiting for your storage) comes back as `pending`; the wrapper asks again with `taskResult`, and waits without blocking in the `async` methods.
- **Time.** JavaScriptCore and QuickJS have no timers, so the engine keeps its own (a room's heartbeat) and runs them when the wrapper calls `tick`, which it does once a second while a room is open.

If you would rather call the scripts yourself, from any language that can run JavaScript, that is the whole interface.
