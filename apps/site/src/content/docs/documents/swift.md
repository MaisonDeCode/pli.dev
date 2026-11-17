---
title: Swift (iPhone, iPad and Mac)
description: Add a document editor to a SwiftUI or UIKit app with the Pli package for Swift, as one view or as pieces you arrange yourself.
---

The Pli package for Swift gives an iPhone, iPad or Mac app a document editor, with the same documents as the JavaScript package. There are three ways to use it, from the most ready-made to the most customised:

| | What you get | Where |
|---|---|---|
| **The full editor** | The web editor's menus, toolbar, pages, comments and file export, in a web view | `PliEditor` |
| **Native building blocks** | The document as editable native text, tables and pictures, with a toolbar and menus, drawn with UIKit (AppKit on a Mac) and SwiftUI | `PliNativeEditor`, `PliBlocksView`, `PliToolbarView` |
| **The engine** | A document with a selection that you edit with methods, and draw however you like | `PliDocument` |

All three read and write the same JSON, so a document made in one opens in the others, and in the [web editor](/documents/ready-made-ui/).

## Install

Pli for Swift is a Swift package in the `packages/swift` folder of the [repository](https://github.com/MaisonDeCode/pli.dev). Clone it and add it as a local package. In Xcode, choose **File > Add Package Dependencies…**, press **Add Local…** and pick that folder, then add the `Pli` library to your app. Or in a `Package.swift`:

```swift
dependencies: [.package(path: "../pli.dev/packages/swift")],
targets: [.target(name: "MyApp", dependencies: [.product(name: "Pli", package: "swift")])]
```

It needs iOS 15 or macOS 12 and later, and has no other dependencies. The engine runs in JavaScriptCore, which is part of the system, from one script inside the package.

## The full editor

`PliEditor` is the whole web editor in a web view. It keeps its document in a string you own:

```swift
import Pli

struct NotesScreen: View {
    @State private var document = ""        // a saved document, or empty for a new one

    var body: some View {
        PliEditor(json: $document)
    }
}
```

Saving is writing `document` somewhere. For more control, make a controller:

```swift
let editor = PliEditorController(json: saved)
editor.onChange = { json in save(json) }        // a moment after each edit
editor.onDownload = { file in share(file) }     // File > Download; by default the share sheet, or a save panel on a Mac
PliEditorView(editor)

let docx = try await editor.exportDocx()
let doc = try await editor.document()           // the same document, in the engine, to read or change
```

On iPhone the editor's toolbar sits at the bottom and rides above the keyboard, and the bar of arrows and Done that iOS adds above the keyboard for a web page is hidden (`editor.hidesKeyboardAccessoryBar = false` brings it back).

## Native building blocks

When you want the editor to look and behave like part of your app, use the blocks. The shortest way is one view:

```swift
struct NotesScreen: View {
    @StateObject private var model = try! PliDocumentModel(json: saved)

    var body: some View {
        PliNativeEditor(model)
            .onAppear { model.onChange = { json in save(json) } }
    }
}
```

`PliNativeEditor` is the blocks with a toolbar: under the text and above the keyboard on iPhone and iPad, and above the text on a Mac, like a document window's toolbar. To lay it out yourself, use the two views on their own:

```swift
VStack(spacing: 0) {
    PliToolbarView(model, edge: .top)     // undo, style, bold…, lists, alignment, insert; `.bottom` puts its dividing line on top
    PliBlocksView(model)                  // the document, editable
}
```

`PliBlocksView` is for SwiftUI. In UIKit (or AppKit) use `PliBlocksScrollView(model:)`, a `UIScrollView` (an `NSScrollView` on a Mac) you add to your own view.

### The model

`PliDocumentModel` holds the document and what a view needs to draw it, and everything changes through it:

| | |
|---|---|
| `blocks` | The blocks to draw, with their text in runs that carry bold, colour, links and the rest |
| `format` | What is on at the selection: which marks, the kind of block, the alignment, the list, the table or picture the caret is in, whether undo and redo are possible |
| `selection` | Where the caret or selection is |
| `perform { doc in … }` | Makes a change, then reads the document again |
| `onChange`, `onError` | Called with the whole document as JSON after each change, and with the engine's message when a command can't be done |
| `document` | The engine's `PliDocument`, for reading (`markdown()`, `html()`, `exportDocx()`) |

The screen only ever shows what the document says, so your own controls work the same way as the toolbar's:

```swift
Button("Bold") { model.perform { _ = try $0.toggleBold() } }
    .foregroundColor(model.format.marks.bold ? .accentColor : .primary)   // lit while the caret is in bold text
```

Every command in the [command list](/platform/swift-and-kotlin/#commands) is a method on the document you get in `perform`.

### Toolbar and menus

`PliToolbarView` is a row of these, which you can also use one at a time:

| View | What it does |
|---|---|
| `PliUndoRedoButtons` | Undo and Redo |
| `PliStyleMenu` | Text, Title, Subtitle, headings, Quote, Code, with the current one checked |
| `PliMarkButtons` | Bold, italic, underline, strikethrough |
| `PliColorMenu(model, target: .text)` | Text colour or highlight (`.highlight`) |
| `PliListButtons` | Bulleted and numbered lists, indent and outdent |
| `PliListMenu` | 1. a. i. or bullets, restart at 1, continue numbering |
| `PliAlignmentMenu` | Left, centre, right, justified |
| `PliInsertMenu` | Picture, table, divider, page break, and your own items |
| `PliFormatMenu` | Code, superscript, subscript, line spacing, clear formatting |
| `PliTableMenu` | Rows and columns, merge and split cells, header row, cell colour. Shown while the caret is in a table |
| `PliPictureMenu` | Crop, wrapping, size, delete. Shown while a picture is selected |
| `PliEditMenu` | Select all, cut, copy, paste |
| `PliToggleButton` | A button of your own that shows whether something is on |

Your own items go in the Insert menu with a closure, for example a camera:

```swift
PliInsertMenu(model) {
    Button("Take a photo…") { showCamera = true }
}
```

### How text looks

`PliTextStyle` sets the sizes and colours of the blocks (body size, how a document's point sizes scale, text, secondary and link colours); pass a changed copy:

```swift
var style = PliTextStyle()
style.bodySize = 18
PliBlocksView(model, style: style)
```

To draw blocks yourself, `document.content()` gives each block with its text in runs, a list item's marker as it is shown, a table's cells and a picture's source, and `PliRichText.attributedString(for:style:)` turns a text block into an `NSAttributedString`.

### What the blocks do

- **Typing, Enter, Backspace** at the start of a block (which joins it to the one above), and the system keyboard's autocorrect, all go through the document, with its own undo.
- **Selecting across blocks.** Press and hold on text, then drag. The selection can run from one paragraph into another, or from one table cell into the next. The covered text is tinted, and typing, Delete and formatting commands apply to all of it. Shift and the arrow keys extend it, and the arrow keys move the caret into the next block. `model.selectRange(anchor:focus:)` does it from code.
- **Copy and paste keep formatting.** Copy writes plain text and HTML. Paste reads HTML (a web page, Word, Google Docs, another Pli document), RTF (Pages, TextEdit), spreadsheet rows as a table, plain text, or a copied picture. `model.copy()`, `model.cut()` and `model.paste()` do the same from code.
- **Tables.** Insert one from the menu. Drag a grip on a column edge or the bottom of a row to resize it; the whole drag is one undo step. Select from one cell to another to merge.
- **Pictures.** Insert opens the system photo picker (no permission needed; an open panel on a Mac), and `model.insertPicture(image)` puts in an image you have. Tap a picture to select it. Drag the dot on its corner to resize it, crop it by dragging its edges or to a shape, make text wrap around it on the left or right (also inside a table cell), or delete it. The file keeps the whole picture, so a crop can be changed later, and it is kept in DOCX files.

### On a Mac

The blocks are `NSTextView` and AppKit views, with the same names. The toolbar is above the text, pictures come from an open panel (`model.choosePicture()`), and the mouse selects across blocks as it does with a finger. `examples/swift-mac` is a small app made of them.

## The engine

Without any views, a `PliDocument` is a document you edit by calling methods and read back as data:

```swift
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

Open what `json()` saved with `PliDocument(json:)`, and bring in a Word file with `importDocx(_:)`, which keeps tracked changes as suggestions or accepts them. Pass a `PliUser` to open a document that records suggestions. The [Swift and Kotlin reference](/platform/swift-and-kotlin/) has the full list of commands and reads, the threading rules, and how the engine runs.

Comments on the selected text (`commentOnSelection`), people, live editing with `sync.start`, files through your storage and scripts are on the same reference, with the same calls for [workbooks](/sheets/swift-and-kotlin/), [decks](/decks/swift-and-kotlin/) and [PDFs](/pdf/swift-and-kotlin/).

## Example apps

The repository's `examples/` folder has two Swift apps you can run:

- `swift-ios` has three tabs: **Editor** is `PliEditor`, **Native** is the blocks and toolbar, and **Build your own** draws a document from the engine with stock SwiftUI. Open `PliExample.xcodeproj` and press Run.
- `swift-mac` is the native blocks in a Mac app. Run `swift run` in the folder, or open it in Xcode.

See [Example apps](/platform/example-apps/) for what each shows.

## Good to know

- A picture can't be placed after the last block of a cell or of the document by tapping. Put the caret in the text and insert the picture in front of it.
- The engine takes about a millisecond per call and a document can be used from any thread, one call at a time. The model makes its calls on the main thread, which is fine for the size of document a person types into. For very large documents or imports, use a `PliDocument` on a background queue and open its JSON in a model afterwards.
- Documents made here open in the web editor and the other way round, because the file is the same JSON.
