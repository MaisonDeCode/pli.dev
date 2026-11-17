# Pli for Kotlin: example app

An Android app with three tabs, all on the [Pli package for Android](../../packages/kotlin-android):

- **Editor** is the full Pli editor, the same one the JavaScript package has, in a few lines: `PliEditor(json = document, onJsonChange = { … })`. See `FullEditorScreen.kt`.
- **Native** is an editor made of Pli's building blocks: editable text blocks with their formatting, and a toolbar and menus, as `PliBlocks(state)` and `PliToolbar(state)`. See `NativeEditorScreen.kt`.
- **Build your own** edits a document through the engine's API (`PliDocument`), for when you want your own screens.

The engine runs in QuickJS, so everything the web editor can do to a document is a method on `PliDocument`. The editor runs in a `WebView` from one HTML file inside the package.

## Run it

1. Open this folder in Android Studio (Ladybug or later) and let it sync.
2. Choose an emulator or a device, and press Run.

From the command line, with an emulator running or a device plugged in:

```sh
./gradlew :app:installDebug
```

Gradle finds your Android SDK from `local.properties` (`sdk.dir=/path/to/Android/sdk`), which Android Studio writes for you, or from `ANDROID_HOME`.

## What the Build your own tab shows

- **Blocks** lists the document's blocks from `document.blocks()`, with each list item's marker (`1.`, `a.`, `•`) from the engine. Tap a block to move the caret there.
- **Preview** shows `document.html()` in a `WebView`: bold, lists in their styles, tables.
- The menus call the document: `toggleBold()`, `setHeading(1)`, `setListMarker(PliListMarker.UPPER_ROMAN)`, `setListStart(5)`, `insertTable(2, 3)`, `undo()`.
- **Type at the caret** calls `typeText`, `splitBlock` and `backspace`.
- **File** saves DOCX, Markdown or HTML (`exportDocx()`, `markdown()`, `html()`) and opens a DOCX file (`importDocx`).
- The document is saved in the app's files folder as JSON (`document.json()`) and opened again with `PliDocument(json = …)`.

The engine blocks while it works, so `EditorViewModel` makes every call on a background thread and reads the document again afterwards. `EditorScreen.kt` only draws what the view model holds.

## How the package is used here

`settings.gradle.kts` includes the repository's `packages/kotlin-android` folder as the module `:pli`, and the app depends on it with `implementation(project(":pli"))`. That module compiles the Kotlin engine API from `packages/kotlin` with the Android build of QuickJS and adds `PliEditor`. In your own app, clone the repository and add that module to your project the same way, and give the editor `Modifier.imePadding()` or edge-to-edge insets, as `MainActivity` does with `safeDrawingPadding()`.

## What it doesn't do

The Build your own tab draws the blocks with stock Compose and does not show inline bold or italic in the Blocks list (the Preview does); the Native tab does. The Editor tab has everything.
