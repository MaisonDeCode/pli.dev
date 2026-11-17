---
title: Kotlin (Android)
description: Add a document editor to a Jetpack Compose app with the Pli package for Android, as one composable or as pieces you arrange yourself.
---

The Pli package for Android gives a Jetpack Compose app a document editor, with the same documents as the JavaScript package. There are three ways to use it, from the most ready-made to the most customised:

| | What you get | Where |
|---|---|---|
| **The full editor** | The web editor's menus, toolbar, pages, comments and file export, in a `WebView` | `PliEditor` |
| **Native building blocks** | The document as editable native text, tables and pictures, with a toolbar and menus, in Compose | `PliBlocks`, `PliToolbar` |
| **The engine** | A document with a selection that you edit with methods, and draw however you like | `PliDocument` |

All three read and write the same JSON, so a document made in one opens in the others, and in the [web editor](/documents/ready-made-ui/).

## Install

Pli for Android is a Gradle module in the `packages/kotlin-android` folder of the [repository](https://github.com/MaisonDeCode/pli.dev). Clone it and include it in your project as a module. In `settings.gradle.kts`:

```kotlin
include(":pli")
project(":pli").projectDir = file("../pli.dev/packages/kotlin-android")
```

and in your app's `build.gradle.kts`:

```kotlin
dependencies {
    implementation(project(":pli"))
}
```

It needs Android 8 (API 26) and later and Jetpack Compose with Material 3. The module compiles the Kotlin engine API from `packages/kotlin` with the Android build of [quickjs-kt](https://github.com/dokar3/quickjs-kt), which runs the engine from one script inside the package, and adds the editor and the blocks. For a plain JVM program (a server, tests), use `packages/kotlin` on its own.

## The full editor

`PliEditor` is the whole web editor in a `WebView`. It keeps its document in a string you own:

```kotlin
var document by remember { mutableStateOf(saved ?: "") }     // a saved document, or empty for a new one

PliEditor(
    json = document,
    onJsonChange = { document = it; file.writeText(it) },
    modifier = Modifier.fillMaxSize().imePadding(),          // imePadding lets the keyboard shrink it
)
```

For more control, make a controller:

```kotlin
val editor = remember { PliEditorController(json = saved) }
editor.onChange = { json -> file.writeText(json) }           // a moment after each edit
editor.onDownload = { file -> share(file) }                  // File > Download; by default a save dialog

PliEditor(editor, Modifier.fillMaxSize().imePadding())
val docx = editor.exportDocx()                               // from a coroutine
val doc = editor.document()                                  // the same document, in the engine
```

## Native building blocks

When you want the editor to look and behave like part of your app, use the blocks. A state holds the document, and two composables draw it:

```kotlin
val state = rememberPliDocumentState(json = saved)
state.onChange = { json -> file.writeText(json) }

Column(Modifier.fillMaxSize().imePadding()) {
    PliBlocks(state, Modifier.weight(1f))     // the document, editable
    PliToolbar(state)                          // undo, style, bold…, lists, alignment, insert
}
```

The toolbar goes under the text so that it rides above the keyboard. Put `PliToolbar` first in the column to have it on top.

### The state

`PliDocumentState` holds the document and what a composable needs to draw it, and everything changes through it:

| | |
|---|---|
| `blocks` | The blocks to draw, with their text in runs that carry bold, colour, links and the rest |
| `format` | What is on at the selection: which marks, the kind of block, the alignment, the list, the table or picture the caret is in, whether undo and redo are possible |
| `selection` | Where the caret or selection is |
| `perform { … }` | Makes a change, then reads the document again |
| `onChange`, `onError` | Called with the whole document as JSON after each change, and with the engine's message when a command can't be done |
| `document` | The engine's `PliDocument`, for reading (`markdown()`, `html()`, `exportDocx()`) |

The screen only ever shows what the document says, so your own controls work the same way as the toolbar's. The state is read and changed on the main thread:

```kotlin
Button(onClick = { state.perform { toggleBold() } }) { Text("Bold") }
PliToggleButton("B", "Bold", state.format.marks.bold) { state.perform { toggleBold() } }   // lit while the caret is in bold text
```

Every command in the [command list](/platform/swift-and-kotlin/#commands) is a method on the document inside `perform`.

### Toolbar and menus

`PliToolbar` is a row of these, which you can also use one at a time:

| Composable | What it does |
|---|---|
| `PliUndoRedoButtons` | Undo and Redo |
| `PliStyleMenu` | Text, Title, Subtitle, headings, Quote, Code, with the current one checked |
| `PliMarkButtons` | Bold, italic, underline, strikethrough |
| `PliColorMenu(state)` | Text colour, or highlight with `highlight = true` |
| `PliListButtons` | Bulleted and numbered lists, indent and outdent |
| `PliListMenu` | 1. a. i. or bullets, restart at 1, continue numbering |
| `PliAlignmentMenu` | Left, centre, right, justified |
| `PliInsertMenu` | Picture, table, divider, page break, and your own items |
| `PliFormatMenu` | Code, superscript, subscript, line spacing, clear formatting |
| `PliTableMenu` | Rows and columns, merge and split cells, header row, cell colour. Shown while the caret is in a table |
| `PliPictureMenu` | Crop, wrapping, size, delete. Shown while a picture is selected |
| `PliEditMenu` | Select all, cut, copy, paste |
| `PliToggleButton` | A button of your own that shows whether something is on |

Your own items go in the Insert menu with a lambda:

```kotlin
PliInsertMenu(state) { close ->
    DropdownMenuItem(text = { Text("Take a photo…") }, onClick = { close(); takePhoto() })
}
```

The menus don't take the window's focus, so the keyboard stays up while you pick.

### How text looks

`PliBlockStyle` sets the sizes and colours of the blocks (body size, how a document's point sizes scale, text, secondary and link colours). It follows your Material theme, and you can change it with `copy`:

```kotlin
PliBlocks(state, style = PliBlockStyle.default().copy(bodySize = 18.sp))
```

To draw blocks yourself, `document.content()` gives each block with its text in runs, a list item's marker as it is shown, a table's cells and a picture's source, and `PliRichText.annotated(block, style)` turns a text block into an `AnnotatedString`.

### What the blocks do

- **Typing, Enter, Backspace** at the start of a block (which joins it to the one above), and the keyboard's autocorrect, all go through the document, with its own undo.
- **Selecting across blocks.** Press and hold on text, then drag. The selection can run from one paragraph into another, or from one table cell into the next. The covered text is tinted, and typing, Delete and formatting commands apply to all of it. With a keyboard, Shift and the arrow keys extend it, and the arrow keys move the caret into the next block.
- **Copy and paste keep formatting.** Copy writes plain text and HTML. Paste reads HTML (a web page, Word, Google Docs, another Pli document), spreadsheet rows as a table, plain text, or a copied picture. A clipboard that holds text and a picture together, in several items or one, goes in as the text and then the picture. The Edit menu and the text fields' own menu both do this. From code, use `state.copyToClipboard(context)`, `state.cutToClipboard(context)` and `state.pasteFromClipboard(context)`.
- **Tables.** Insert one from the menu. Drag a grip on a column edge or the bottom of a row to resize it; the whole drag is one undo step. Select from one cell to another to merge.
- **Pictures.** Insert opens the system photo picker (no permission needed), and `state.insertPicture(context, uri)` puts in an image you have. Tap a picture to select it. Drag the dot on its corner to resize it, crop it by dragging its edges or to a shape, make text wrap around it on the left or right (also inside a table cell), or delete it. The file keeps the whole picture, so a crop can be changed later, and it is kept in DOCX files.

Text can't flow around a shape in Compose. Beside a picture that text wraps around, each line is cut short where it would reach the picture (with a line break that is only drawn, not in the document), and the lines after it run at full width. On iPhone, iPad and Mac the text flows by itself.

## The engine

Without any composables, a `PliDocument` is a document you edit by calling methods and read back as data:

```kotlin
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

Calls are quick but block while the engine runs, so run a large document or an import off the main thread. Open what `json()` saved with `PliDocument(json = …)`, and bring in a Word file with `importDocx(bytes)`, which keeps tracked changes as suggestions or accepts them. Pass a `PliUser` to open a document that records suggestions. The [Swift and Kotlin reference](/platform/swift-and-kotlin/) has the full list of commands and reads, the threading rules, and how the engine runs.

Comments on the selected text (`commentOnSelection`), people, live editing with `sync.start`, files through your storage and scripts are on the same reference, with the same calls for [workbooks](/sheets/swift-and-kotlin/), [decks](/decks/swift-and-kotlin/) and [PDFs](/pdf/swift-and-kotlin/).

## Example app

`examples/android-kotlin` has three tabs: **Editor** is `PliEditor`, **Native** is `PliBlocks` and `PliToolbar`, and **Build your own** draws a document from the engine with stock Compose, calling it from a view model on a background thread. Open the folder in Android Studio and press Run. See [Example apps](/platform/example-apps/) for what each shows.

## Good to know

- Give the editor and the blocks `Modifier.imePadding()` (or edge-to-edge insets, as the example does with `safeDrawingPadding()`) so the keyboard resizes them.
- A picture can't be placed after the last block of a cell or of the document by tapping. Put the caret in the text and insert the picture in front of it.
- Documents made here open in the web editor and the other way round, because the file is the same JSON.
