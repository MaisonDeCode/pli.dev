import SwiftUI

@main
struct PliExampleApp: App {
    @StateObject private var editor = EditorModel()

    var body: some Scene {
        WindowGroup {
            TabView {
                // Day one: drop in the editor.
                FullEditorScreen()
                    .tabItem { Label("Editor", systemImage: "doc.richtext") }

                // Your own screens, with Pli's text blocks, toolbar and menus as the pieces.
                NativeEditorScreen()
                    .tabItem { Label("Native", systemImage: "square.and.pencil") }

                // The same documents, through the Swift API: the same documents, through the Swift API.
                EditorView()
                    .environmentObject(editor)
                    .tabItem { Label("Build your own", systemImage: "hammer") }
            }
        }
    }
}
