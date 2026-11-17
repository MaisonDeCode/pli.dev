# Pli for Mac: example app

A small Mac app made of Pli's native building blocks, drawn with AppKit and SwiftUI:

- `PliBlocksView(model)` is the document as editable text blocks, tables and pictures.
- `PliToolbarView(model)` is the toolbar and menus.
- `PliNativeEditor(model)` puts the two together. That is all this app shows (see `Sources/PliMacExample/PliMacExampleApp.swift`).

## Run it

```sh
swift run
```

or open this folder in Xcode 16 or later and press Run. It needs macOS 13 or later.

## Try

- Press and drag from one block into another to select across blocks (Shift and the arrow keys do the same).
- Click the picture, then use the picture menu in the toolbar: crop it by dragging its edges or to a shape, and choose how text wraps around it.
- Click in the table: grips appear on its column edges and row bottoms.
- Insert > Picture opens an open panel.
