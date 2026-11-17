# Adding the editor to an Android app

The Pli package for Android is the Gradle module `packages/kotlin-android` (`dev.pli`). Jetpack Compose with Material 3; Android 8 (API 26) and later. For a plain JVM program (a server, tests) use `packages/kotlin` alone.

## Install

Pli for Android is a Gradle module in the `packages/kotlin-android` folder of the repository (https://github.com/MaisonDeCode/pli.dev). Clone it and include the module:

```kotlin
// settings.gradle.kts
include(":pli")
project(":pli").projectDir = file("../pli.dev/packages/kotlin-android")

// app/build.gradle.kts
dependencies { implementation(project(":pli")) }
```

The module compiles the engine API with the Android build of quickjs-kt and bundles the editor page. It is not on Maven, so don't invent a Maven address or a version.

## Choose

| Want | Use |
|---|---|
| The finished editor (menus, toolbar, pages, comments, DOCX and PDF) | `PliEditor` |
| An editor that looks native | `PliBlocks` with `PliToolbar` |
| No UI, just a document to edit and export | `PliDocument` |

Start with `PliEditor` unless the user wants a native look.

## The finished editor

```kotlin
var document by remember { mutableStateOf(saved ?: "") }      // "" is a new document
PliEditor(
    json = document,
    onJsonChange = { document = it; file.writeText(it) },
    modifier = Modifier.fillMaxSize().imePadding(),           // imePadding lets the keyboard shrink it
)
```

`document` is the same JSON the other platforms use. With a controller: `val editor = remember { PliEditorController(json = saved) }`, `editor.onChange = { … }`, `editor.onDownload = { file -> … }`, `PliEditor(editor, Modifier.fillMaxSize().imePadding())`, `editor.exportDocx()` from a coroutine.

## Native building blocks

```kotlin
val state = rememberPliDocumentState(json = saved)            // json = null for a new document
state.onChange = { json -> file.writeText(json) }

Column(Modifier.fillMaxSize().imePadding()) {
    PliBlocks(state, Modifier.weight(1f))
    PliToolbar(state)
}
```

All changes go through the state; the screen draws only what the document says:

```kotlin
Button(onClick = { state.perform { toggleBold() } }) { Text("Bold") }
// state.blocks, state.format (marks on at the caret, block kind, list, table, picture), state.selection
```

Pieces to use one at a time: `PliUndoRedoButtons`, `PliStyleMenu`, `PliMarkButtons`, `PliColorMenu(state, highlight = false)`, `PliListButtons`, `PliListMenu`, `PliAlignmentMenu`, `PliInsertMenu(state) { close -> your items }`, `PliFormatMenu`, `PliTableMenu`, `PliPictureMenu`, `PliEditMenu`, `PliToggleButton`. Look with `PliBlockStyle.default().copy(...)`. Selecting across blocks, tables, pictures (crop, wrap, resize) and copy and paste with formatting are built in. Compose can't flow text around a shape, so beside a wrapped picture each line is cut short where it would reach the picture (drawn only; the document text is unchanged).

## The engine on its own

```kotlin
PliDocument(title = "Notes").use { doc ->
    doc.typeText("Quarterly numbers"); doc.setHeading(1); doc.splitBlock()
    doc.typeText("Sales were "); doc.toggleBold(); doc.typeText("up")
    val markdown = doc.markdown()
    val file: ByteArray = doc.exportDocx()
    val saved = doc.json()                 // PliDocument(json = saved) opens it again
}
```

Commands return `true` when they changed something and throw `PliException` (with a `code`) only when the call itself is wrong. Positions are UTF-16 offsets (a Kotlin `String` index).

## Pitfalls

- Engine calls block while they run: off the main thread for large documents and imports. The state and `PliBlocks` use the main thread.
- Give the editor `Modifier.imePadding()` (or edge-to-edge insets) so the keyboard resizes it.
- Pasting a picture with text from the clipboard works through the Edit menu and the fields' own menu.
- A picture can't be placed after the last block of a cell or the document by tapping.
- The example app is `examples/android-kotlin` (three tabs: the editor, the blocks, the engine).
