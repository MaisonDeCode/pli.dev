import SwiftUI
import Pli

/// The whole editor, in a few lines: `PliEditor` is the same editor as the JavaScript package's `PliDocument`, with its menus,
/// toolbar, pages, tables, lists, comments, and DOCX and PDF files. It keeps the document in a string you own, so saving it is
/// writing that string somewhere.
struct FullEditorScreen: View {
    private static let file = URL.documentsDirectory.appending(path: "Editor.pli.json")

    @State private var document = (try? String(contentsOf: FullEditorScreen.file, encoding: .utf8)) ?? ""

    var body: some View {
        PliEditor(json: $document)
            .onChange(of: document) { saved in
                try? saved.write(to: FullEditorScreen.file, atomically: true, encoding: .utf8)
            }
    }
}
