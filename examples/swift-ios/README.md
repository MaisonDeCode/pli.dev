# Pli for Swift: example app

An iPhone and iPad app with three tabs, all on the [Pli Swift package](../../packages/swift):

- **Editor** is the full Pli editor, the same one the JavaScript package has, in a few lines: `PliEditor(json: $document)`. See `FullEditorScreen.swift`.
- **Native** is an editor made of Pli's building blocks: editable text blocks with their formatting, and a toolbar and menus, as `PliBlocksView(model)` and `PliToolbarView(model)`. See `NativeEditorScreen.swift`.
- **Build your own** edits a document through the engine's API (`PliDocument`), for when you want your own screens.

The engine runs in JavaScriptCore, so everything the web editor can do to a document is a method on `PliDocument`. The editor runs in a web view from one HTML file inside the package.

## Run it

1. Open `PliExample.xcodeproj` in Xcode 16 or later.
2. Pick an iPhone or iPad simulator, and press Run.

It needs nothing else: no packages to download, no signing for the simulator. To run on a device, set your team in **Signing & Capabilities**.

From the command line:

```sh
xcodebuild -project PliExample.xcodeproj -scheme PliExample \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build
```

## What the Build your own tab shows

- **Blocks** lists the document's blocks from `document.blocks()`, with each list item's marker (`1.`, `a.`, `•`) from the engine. Tap a block to move the caret there.
- **Preview** shows `document.html()` in a web view: bold, lists in their styles, tables.
- The toolbar calls the document: `toggleBold()`, `setHeading(1)`, `setListMarker(.upperRoman)`, `setListStart(5)`, `insertTable(rows:columns:)`, `undo()`.
- **Type at the caret** calls `typeText`, `splitBlock` and `backspace`.
- **Share** exports DOCX, Markdown or HTML (`exportDocx()`, `markdown()`, `html()`); **Open a DOCX file** calls `importDocx(_:)`.
- The document is saved to the app's documents folder as JSON (`document.json()`) and opened again with `PliDocument(json:)`.

The code is small: `EditorModel.swift` wraps a `PliDocument` and reads it again after every change, and `EditorView.swift` draws it.

## What it doesn't do

The Build your own tab draws the blocks with stock SwiftUI and does not show inline bold or italic in the Blocks list (the Preview does); the Native tab does. The Editor tab has everything.

## Use Pli in your own app

Pli for Swift is the `packages/swift` folder of the [repository](https://github.com/MaisonDeCode/pli.dev). Clone it, then in Xcode choose **File > Add Package Dependencies… > Add Local…**, pick that folder, and import `Pli`:

```swift
import Pli

let doc = try PliDocument(title: "Notes")
try doc.typeText("Hello")
try doc.setHeading(1)
let file = try doc.exportDocx()
```
