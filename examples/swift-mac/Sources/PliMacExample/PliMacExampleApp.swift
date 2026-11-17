import SwiftUI
import Pli

/// A Mac app made of Pli's native blocks: the document as editable text blocks (`PliBlocksView`) with a toolbar and menus
/// (`PliToolbarView`) bound to it. Both read and change one `PliDocumentModel`. `PliNativeEditor(model)` puts them together.
@main
struct PliMacExampleApp: App {
    @StateObject private var model = Self.makeModel()

    private static func makeModel() -> PliDocumentModel {
        // swiftlint:disable:next force_try
        let model = try! PliDocumentModel(title: "Mac")
        model.perform { doc in
            try doc.setTitle()
            try doc.typeText("Pli on the Mac")
            try doc.splitBlock()
            try doc.setParagraph()
            try doc.typeText("Native text blocks, a toolbar and menus. Press and drag from one block into another to select across them.")
            try doc.splitBlock()
            try doc.insertTable(rows: 2, columns: 3)
        }
        let labels = ["Item", "Qty", "Price", "Pens", "4", "$2"]
        for (cell, label) in zip(model.blocks.last(where: { $0.type == "table" })?.rows?.flatMap(\.cells) ?? [], labels) {
            guard let id = cell.blocks.first?.id else { continue }
            model.perform { doc in
                try doc.select(anchorBlock: id, anchorOffset: 0, focusBlock: id, focusOffset: 0)
                try doc.typeText(label)
            }
        }
        if let last = model.blocks.last(where: \.isText) { model.focus(block: last.id) }
        let sample = NSImage(size: NSSize(width: 300, height: 180), flipped: false) { rect in
            NSGradient(colors: [.systemIndigo, .systemTeal])?.draw(in: rect, angle: -35)
            return true
        }
        model.insertPicture(sample, description: "A gradient")
        if let picture = model.blocks.first(where: { $0.type == "image" }) {
            model.setImageSize(picture.id, width: 150, height: 90, merge: false)
            model.wrapPicture(picture.id, "left")
            if let last = model.blocks.last(where: \.isText) {
                model.focus(block: last.id)
                model.perform { doc in
                    try doc.typeText("This text runs along the side of the picture, and carries on under it once it is past. Click the picture to select it, then use the picture menu in the toolbar to crop it or change how text wraps. ")
                    try doc.typeText("Press and drag from here up into the table to select across blocks.")
                }
            }
        }
        // A picture in a table cell has text wrapped around it too: type the text first, then put the picture in front of it.
        if let last = model.blocks.last(where: \.isText) {
            model.focus(block: last.id)
            model.perform { try $0.splitBlock(); try $0.insertTable(rows: 1, columns: 2) }
            if let cell = model.blocks.last(where: { $0.type == "table" })?.rows?.first?.cells.first?.blocks.first {
                model.focus(block: cell.id)
                model.perform { try $0.typeText("Text in a table cell wraps around a picture in the same cell, just as it does in the body of the page.") }
                model.perform { try $0.select(anchorBlock: cell.id, anchorOffset: 0, focusBlock: cell.id, focusOffset: 0) }
                model.insertPicture(sample, description: "A gradient in a cell")
                if let pic = model.blocks.last(where: { $0.type == "table" })?.rows?.first?.cells.first?.blocks.first(where: { $0.type == "image" }) {
                    model.setImageSize(pic.id, width: 90, height: 54, merge: false)
                    model.wrapPicture(pic.id, "left")
                }
            }
        }
        return model
    }

    var body: some Scene {
        WindowGroup {
            PliNativeEditor(model)
                .frame(minWidth: 560, minHeight: 480)
        }
    }
}
