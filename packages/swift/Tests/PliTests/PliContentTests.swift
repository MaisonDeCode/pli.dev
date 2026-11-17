import XCTest
@testable import Pli

final class PliContentTests: XCTestCase {
    func testContentHasRunsMarksAndListLabels() throws {
        let doc = try PliDocument(title: "T")
        try doc.typeText("Hello ")
        try doc.toggleBold()
        try doc.typeText("bold")
        try doc.splitBlock()
        try doc.toggleNumberedList()
        try doc.typeText("One")
        try doc.splitBlock()
        try doc.typeText("Two")

        let blocks = try doc.content()
        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[0].runs?.map(\.text), ["Hello ", "bold"])
        XCTAssertEqual(blocks[0].runs?[1].marks?.bold, true)
        XCTAssertEqual(blocks[1].type, "list_item")
        XCTAssertEqual(blocks[1].label, "1.")
        XCTAssertEqual(blocks[2].label, "2.")
        XCTAssertEqual(blocks[1].depth ?? 0, 0)

        let format = try doc.format()
        XCTAssertEqual(format.block?.list, "ordered")
        XCTAssertTrue(format.canUndo)
    }

    @MainActor
    func testModelReadsAgainAfterEachChange() throws {
        let model = try PliDocumentModel(title: "T")
        var saved: String?
        model.onChange = { saved = $0 }
        model.perform { doc in try doc.typeText("Hi") }
        XCTAssertEqual(model.blocks.first?.text, "Hi")
        XCTAssertNotNil(saved)
        model.replace(block: model.blocks[0].id, from: 1, to: 2, with: "ello")
        XCTAssertEqual(model.blocks.first?.text, "Hello")
        model.perform { try $0.toggleBold() }
        XCTAssertTrue(model.format.marks.bold)
    }

    @MainActor
    func testSelectingAcrossBlocksAndEditingTables() throws {
        let model = try PliDocumentModel(title: "T")
        model.perform { doc in
            try doc.typeText("First")
            try doc.splitBlock()
            try doc.typeText("Second")
        }
        let ids = model.blocks.map(\.id)
        model.selectRange(anchor: PliPoint(block: ids[0], offset: 2), focus: PliPoint(block: ids[1], offset: 3))
        XCTAssertTrue(model.isMultiBlock)
        XCTAssertEqual(model.selectedRange(in: ids[0]), NSRange(location: 2, length: 3))
        XCTAssertEqual(model.selectedRange(in: ids[1]), NSRange(location: 0, length: 3))
        XCTAssertEqual(model.selectedText(), "rst\nSec")
        model.replaceSelection(with: "X")
        XCTAssertEqual(model.blocks.map(\.text), ["FiXond"])
        XCTAssertFalse(model.isMultiBlock)

        model.perform { doc in try doc.insertTable(rows: 2, columns: 2) }
        XCTAssertEqual(model.format.table?.rows, 2)
        model.perform { doc in try doc.addRowBelow(); try doc.addColumnRight() }
        let table = model.blocks.first { $0.type == "table" }
        XCTAssertEqual(table?.rows?.count, 3)
        XCTAssertEqual(table?.rows?.first?.cells.count, 3)
        let first = table!.rows![0].cells[0].blocks[0].id, second = table!.rows![0].cells[1].blocks[0].id
        model.selectRange(anchor: PliPoint(block: first, offset: 0), focus: PliPoint(block: second, offset: 0))
        XCTAssertEqual(model.format.table?.canMerge, true)
    }

    @MainActor
    func testCopyingKeepsFormattingAndColumnsMove() throws {
        let doc = try PliDocument(title: "T")
        try doc.typeText("Plain ")
        try doc.toggleBold()
        try doc.typeText("bold")
        let id = try doc.content()[0].id
        try doc.select(anchorBlock: id, anchorOffset: 0, focusBlock: id, focusOffset: 10)
        let clip = try doc.clipboard()
        XCTAssertEqual(clip.text, "Plain bold")
        XCTAssertTrue(clip.html.contains("bold</"))
        try doc.select(anchorBlock: id, anchorOffset: 10, focusBlock: id, focusOffset: 10)
        try doc.splitBlock()
        XCTAssertTrue(try doc.paste(html: clip.html, rtf: nil, text: clip.text))
        let pasted = try doc.content()[1].runs ?? []
        XCTAssertTrue(pasted.contains { $0.marks?.bold == true && $0.text.contains("bold") })

        try doc.insertTable(rows: 1, columns: 3)
        let table = try doc.content().first { $0.type == "table" }!
        XCTAssertTrue(try doc.setColumnEdge(table: table.id, column: 0, position: 0.5, merge: false))
        let widths = try doc.content().first { $0.type == "table" }!.columns!
        XCTAssertEqual(widths[0], 0.5, accuracy: 0.01)
        XCTAssertEqual(widths.reduce(0, +), 1, accuracy: 0.001)
    }

    @MainActor
    func testResizingARowAndAPicture() throws {
        let model = try PliDocumentModel(title: "T")
        model.perform { _ = try $0.insertImage(source: "data:image/png;base64,AAAA", width: 480, height: 288) }
        let picture = model.blocks.first { $0.type == "image" }!
        XCTAssertEqual(picture.width, 480)
        model.setImageSize(picture.id, width: 240, height: 144, merge: false)
        XCTAssertEqual(model.blocks.first { $0.type == "image" }?.width, 240)
        model.setImageSize(picture.id, width: 200, height: 120, merge: true)
        model.perform { _ = try $0.undo() }
        XCTAssertEqual(model.blocks.first { $0.type == "image" }?.width, 480)
    }

    @MainActor
    func testCroppingAndWrappingAPicture() throws {
        let model = try PliDocumentModel(title: "T")
        model.perform { _ = try $0.insertImage(source: "data:image/png;base64,AAAA", width: 400, height: 200) }
        let id = model.blocks.first { $0.type == "image" }!.id
        model.setImageCrop(id, PliCrop(top: 0, right: 0, bottom: 0, left: 0.25), merge: false)
        var picture = model.blocks.first { $0.type == "image" }!
        XCTAssertEqual(picture.width, 300)
        XCTAssertEqual(picture.crop?.left, 0.25)
        model.cropPicture(id, toAspect: 1)
        picture = model.blocks.first { $0.type == "image" }!
        // The whole picture is 400 by 200; a square cut from it is 200 by 200.
        XCTAssertEqual(picture.width, 200)
        XCTAssertEqual(picture.height, 200)
        model.cropPicture(id, toAspect: nil)
        picture = model.blocks.first { $0.type == "image" }!
        XCTAssertNil(picture.crop)
        XCTAssertEqual(picture.width, 400)
        model.wrapPicture(id, "right")
        XCTAssertEqual(model.blocks.first { $0.type == "image" }?.wrap, "right")
        model.wrapPicture(id, nil)
        XCTAssertNil(model.blocks.first { $0.type == "image" }?.wrap)
    }

    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    @MainActor
    func testTintedTextIsNotTakenForPlainText() {
        // The tint on a selection across blocks starts partway into a block: it must be seen, or it never goes away.
        let plain = NSAttributedString(string: "Item", attributes: [.font: NSFont.systemFont(ofSize: 14)])
        let tinted = NSMutableAttributedString(attributedString: plain)
        tinted.addAttribute(.backgroundColor, value: NSColor.systemBlue, range: NSRange(location: 1, length: 3))
        XCTAssertFalse(PliMacTextBlockView.sameLook(tinted, plain))
        XCTAssertFalse(PliMacTextBlockView.sameLook(plain, tinted))
        XCTAssertTrue(PliMacTextBlockView.sameLook(plain, NSAttributedString(attributedString: plain)))
    }
    #endif
}
