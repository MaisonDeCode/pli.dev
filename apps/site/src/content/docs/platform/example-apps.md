---
title: Example apps
description: "Apps you can build and run: Pli in SwiftUI, in Jetpack Compose, and the full editor in a Capacitor app on iPhone and Android."
sidebar:
  order: 10
---

The `examples/` folder of the [repository](https://github.com/MaisonDeCode/pli.dev) has four small apps you can build and run on your own machine. Clone the repository, then follow the steps in each app's README.

| Example | Platform | What it is |
|---------|----------|------------|
| `swift-ios` | iPhone and iPad | Edits a document through the [Swift package](/documents/swift/). Open `PliExample.xcodeproj` in Xcode and press Run |
| `android-kotlin` | Android | The same app through the [Kotlin package](/documents/kotlin/), in Jetpack Compose. Open the folder in Android Studio and press Run |
| `swift-mac` | Mac | Pli's native blocks and toolbar in a Mac app (SwiftUI and AppKit). Run `swift run` in the folder, or open it in Xcode |
| `capacitor` | iPhone, iPad and Android | The full web editor in a [Capacitor](https://capacitorjs.com) app |

## The Swift and Kotlin apps

Each has three tabs. **Editor** is the whole editor in a few lines (`PliEditor(json: $document)` in SwiftUI, `PliEditor(json = …)` in Compose), saved to the app's files as you type. **Native** is the same editing built from Pli's [building blocks](/documents/swift/#native-building-blocks): native text blocks and a toolbar with menus, laid out by hand in a few lines so you can see where your own views would go. **Build your own** is the same documents through the language API, for when you want your own screens: a list of **blocks** read from the engine, with each list item's marker (`1.`, `a.`, `•`) as the engine numbers it. Tap a block to put the caret there. The toolbar calls the document the way an editor would: `toggleBold()`, `setHeading(1)`, `setListMarker(…)`, `setListStart(5)`, `insertTable(…)`, `undo()`. A field types at the caret with `typeText`. A second tab shows the document as `html()` in a web view, with its formatting. Files go out as DOCX, Markdown or HTML and a DOCX file comes in.

The last tab draws the blocks with stock SwiftUI and Compose and calls the document directly. Use it as a map of the API.

## The Capacitor app

The Capacitor app is the editor itself: `PliDocument` from `@pli.dev/react`, with its menus, toolbar, tables, lists, comments, and DOCX and PDF export, inside a native shell. It saves as you type, starts in the pageless view on a phone, keeps the toolbar above the keyboard (with the Capacitor Keyboard plugin shrinking the web view), and passes an `onDownload` function so that File > Download writes the file to the app's cache and shows the share sheet. A web view can't download a file by itself.

```tsx
<PliDocument
  session={session}
  onDownload={async (file) => {
    const written = await Filesystem.writeFile({ path: file.name, data: toBase64(file.data), directory: Directory.Cache });
    await Share.share({ title: file.name, url: written.uri });
  }}
/>
```

Without `onDownload`, the editor downloads files the way a web page does.

The example sits inside the repository and uses the packages from the workspace. In your own Capacitor app, install them from npm: `npm install @pli.dev/docs @pli.dev/react`.
