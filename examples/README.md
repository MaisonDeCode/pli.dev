# Examples

Small apps you can build and run to try Pli on a real platform. They are in the [repository](https://github.com/MaisonDeCode/pli.dev), so clone it first. Each one has its own README.

| Example | Platform | What it is |
|---------|----------|------------|
| [swift-ios](swift-ios) | iPhone and iPad (SwiftUI) | The full editor in a few lines (`PliEditor`), a tab with Pli's native building blocks (text blocks, toolbar, menus), and one that edits through the Swift API. Open `PliExample.xcodeproj` and press Run |
| [android-kotlin](android-kotlin) | Android (Jetpack Compose) | The same three tabs on Android. Open the folder in Android Studio and press Run |
| [swift-mac](swift-mac) | Mac (SwiftUI and AppKit) | Pli's native blocks, toolbar and menus in a Mac app. Run `swift run` in the folder, or open it in Xcode |
| [capacitor](capacitor) | iPhone, iPad and Android | The full web editor inside a Capacitor app, with DOCX and PDF saving through the share sheet |

The Swift and Kotlin apps have three parts: the full editor from one line (it is the web editor, in a web view inside the package), native building blocks for your own editor, and the engine's API for your own screens. The Capacitor app runs the same web editor in a Capacitor shell.
