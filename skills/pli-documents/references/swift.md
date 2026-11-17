# Adding the editor to an iPhone, iPad or Mac app

The Pli package for Swift (`packages/swift`, library `Pli`) works in SwiftUI, UIKit and AppKit. iOS 15 and macOS 12 or later; no other dependencies.

## Install

Pli for Swift is a Swift package in the `packages/swift` folder of the repository (https://github.com/MaisonDeCode/pli.dev). Clone it and add it as a local package. In Xcode: **File > Add Package Dependencies… > Add Local…** and choose that folder, then add the `Pli` library to the app target. Or in `Package.swift`:

```swift
dependencies: [.package(path: "../pli.dev/packages/swift")],
targets: [.target(name: "MyApp", dependencies: [.product(name: "Pli", package: "swift")])]
```

It is not on a package registry and has no version tag to pin. Don't invent a package URL or a version.

## Choose

| Want | Use |
|---|---|
| The finished editor (menus, toolbar, pages, comments, DOCX and PDF) | `PliEditor` |
| An editor that looks native and part of the app | `PliNativeEditor`, or `PliBlocksView` with `PliToolbarView` |
| No UI, just a document to edit and export | `PliDocument` |

Start with `PliEditor` unless the user wants a native look.

## The finished editor

```swift
import Pli

struct NotesScreen: View {
    @State private var document = ""        // "" is a new document; otherwise a saved document's JSON
    var body: some View { PliEditor(json: $document) }
}
```

`document` is the same JSON the other platforms use. Save it (`onChange` of the string, or a controller). With a controller:

```swift
let editor = PliEditorController(json: saved)
editor.onChange = { json in save(json) }
editor.onDownload = { file in share(file) }   // File > Download: by default the share sheet (iOS) or a save panel (Mac)
PliEditorView(editor)
let docx = try await editor.exportDocx()
```

## Native building blocks

```swift
struct NotesScreen: View {
    @StateObject private var model = try! PliDocumentModel(json: saved)   // json: nil for a new document
    var body: some View {
        PliNativeEditor(model).onAppear { model.onChange = { json in save(json) } }
    }
}
```

`PliNativeEditor` puts the toolbar under the text above the keyboard on iPhone and iPad, and above the text on a Mac. To lay out yourself: `PliToolbarView(model, edge: .top)` and `PliBlocksView(model)`. In UIKit or AppKit use `PliBlocksScrollView(model:)`.

All changes go through the model, which draws only what the document says:

```swift
Button("Bold") { model.perform { _ = try $0.toggleBold() } }
// model.blocks, model.format (marks on at the caret, block kind, list, table, picture), model.selection
```

The toolbar pieces can be used one at a time: `PliUndoRedoButtons`, `PliStyleMenu`, `PliMarkButtons`, `PliColorMenu(model, target: .text / .highlight)`, `PliListButtons`, `PliListMenu`, `PliAlignmentMenu`, `PliInsertMenu(model) { your items }`, `PliFormatMenu`, `PliTableMenu`, `PliPictureMenu`, `PliEditMenu`, `PliToggleButton`. Look with `PliTextStyle`. Selecting across blocks, tables, pictures (crop, wrap, resize), and copy and paste with formatting are built in.

## The engine on its own

```swift
let doc = try PliDocument(title: "Notes")
try doc.typeText("Quarterly numbers"); try doc.setHeading(1); try doc.splitBlock()
try doc.typeText("Sales were "); try doc.toggleBold(); try doc.typeText("up")
let markdown = try doc.markdown()
let file = try doc.exportDocx()          // Data
let saved = try doc.json()               // PliDocument(json:) opens it again
```

Every command is a method (`setHeading`, `toggleBulletedList`, `insertTable(rows:columns:)`, `setAlignment(.center)`, `undo()`…). Commands return `true` when they changed something; they throw only when the call itself is wrong (`PliError` with a `code`). Read with `blocks()`, `content()`, `format()`, `selection()`, `plainText()`, `html()`. Positions are UTF-16 offsets (`String.utf16`).

## Pitfalls

- The model's calls run on the main thread; for a very large document or an import, use a `PliDocument` on a background queue and open its JSON in a model afterwards.
- A picture can't be placed after the last block of a cell or the document by tapping; put the caret in the text and insert the picture before it.
- On a Mac, `PliEditor` is a web view and the blocks are AppKit views; pictures come from an open panel.
- A Mac app made of the blocks is in `examples/swift-mac`; an iPhone app in `examples/swift-ios` (three tabs: the editor, the blocks, the engine).
