import SwiftUI
import Pli

/// The native building blocks: the document drawn as editable blocks (`PliBlocksView`), with a toolbar of buttons and menus
/// (`PliToolbarView`) bound to it. Both read and change one `PliDocumentModel`.
///
/// `PliNativeEditor(model)` puts the two together. Here they are laid out by hand, so you can see where your own views would go.
struct NativeEditorScreen: View {
    @StateObject private var model = Self.makeModel()

    private static func makeModel() -> PliDocumentModel {
        // swiftlint:disable:next force_try
        let model = try! PliDocumentModel(title: "Native")
        model.perform { doc in
            try doc.setTitle()
            try doc.typeText("Native building blocks")
            try doc.splitBlock()
            try doc.setParagraph()
            try doc.typeText("Type here. The toolbar below is made of the same pieces you can use on their own.")
        }
        // A small table to try the rows, columns and cells menu on: press and drag from one cell to another to merge them.
        model.perform { doc in
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
        // A picture to try resizing on: tap it, then drag the dot on its corner.
        let sample = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 180)).image { context in
            let colors = [UIColor.systemIndigo.cgColor, UIColor.systemTeal.cgColor] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 300, y: 180), options: [])
        }
        if let last = model.blocks.last(where: { $0.isText && $0.text.isEmpty }) ?? model.blocks.last(where: \.isText) {
            model.focus(block: last.id)
        }
        model.insertPicture(sample, description: "A gradient")
        // Text wraps around a picture set to wrap, like this one: choose it from the picture menu (Text wrapping), or crop it there.
        if let picture = model.blocks.first(where: { $0.type == "image" }) {
            model.setImageSize(picture.id, width: 150, height: 90, merge: false)
            model.wrapPicture(picture.id, "left")
            if let last = model.blocks.last(where: \.isText) {
                model.focus(block: last.id)
                model.perform { doc in
                    try doc.typeText("This text runs along the side of the picture, and carries on under it once it is past. ")
                    try doc.typeText("Pictures can be cropped from the picture menu, and text wrapped around them, as in a word processor. ")
                    try doc.typeText("Tap the picture to select it, then use the menu in the toolbar.")
                }
            }
        }
        // A picture in a table cell has text wrapped around it too: type the text first, then put the picture in front of it.
        if let last = model.blocks.last(where: \.isText) {
            model.focus(block: last.id)
            model.perform { try $0.splitBlock(); try $0.insertTable(rows: 1, columns: 1) }
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

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                PliBlocksView(model)
                PliToolbarView(model)
            }
            .navigationTitle("Native")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
