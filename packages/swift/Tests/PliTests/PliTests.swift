import XCTest
@testable import Pli

final class PliTests: XCTestCase {
    func testTypesAndReads() throws {
        let doc = try PliDocument(title: "Notes")
        XCTAssertEqual(try doc.title(), "Notes")
        XCTAssertTrue(try doc.typeText("Hello"))
        try doc.setHeading(1)
        XCTAssertEqual(try doc.markdown(), "# Hello\n")
        let blocks = try doc.blocks()
        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].type, "heading")
        XCTAssertEqual(blocks[0].level, 1)
        XCTAssertEqual(blocks[0].text, "Hello")
        XCTAssertEqual(try doc.statistics().words, 1)
        XCTAssertEqual(try doc.outline().map(\.text), ["Hello"])
    }

    func testEditsLikeAnEditor() throws {
        let doc = try PliDocument()
        try doc.typeText("Some ")
        try doc.toggleBold()
        try doc.typeText("bold")
        try doc.toggleBold()
        try doc.typeText(" text")
        try doc.splitBlock()
        try doc.typeText("item")
        try doc.toggleBulletedList()
        XCTAssertEqual(try doc.markdown(), "Some **bold** text\n\n- item\n")
        XCTAssertTrue(try doc.state().canUndo)
        try doc.undo()
        XCTAssertEqual(try doc.blocks().last?.type, "paragraph")
        try doc.redo()
        XCTAssertEqual(try doc.blocks().last?.list, "bullet")
    }

    func testSelectionAndFormatting() throws {
        let doc = try PliDocument()
        try doc.typeText("Hello world")
        let id = try XCTUnwrap(doc.blocks().first?.id)
        try doc.select(anchorBlock: id, anchorOffset: 6, focusBlock: id, focusOffset: 11)
        XCTAssertEqual(try doc.selection(), PliSelection(anchor: PliPoint(block: id, offset: 6), focus: PliPoint(block: id, offset: 11)))
        try doc.setTextColor("#b91c1c")
        XCTAssertTrue(try doc.html().contains("color:#b91c1c"))
        try doc.setTextColor(nil)
        XCTAssertFalse(try doc.html().contains("color:#b91c1c"))
        try doc.selectAll()
        try doc.setAlignment(.center)
        XCTAssertEqual(try doc.blocks().first?.align, "center")
    }

    func testTablesImagesAndStyles() throws {
        let doc = try PliDocument()
        try doc.typeText("Careful")
        try doc.selectAll()
        try doc.toggleItalic()
        let style = try doc.createStyle(name: "Warning", kind: .paragraph)
        XCTAssertEqual(style, "warning")
        XCTAssertEqual(try doc.styles()["warning"]?.name, "Warning")
        XCTAssertEqual(try doc.blocks().first?.style, "warning")
        try doc.splitBlock()
        XCTAssertTrue(try doc.insertTable(rows: 2, columns: 3))
        let table = try XCTUnwrap(doc.blocks().first { $0.type == "table" })
        XCTAssertEqual(table.rows, 2)
        XCTAssertEqual(table.columns, 3)
    }

    func testSavesAndReopens() throws {
        let a = try PliDocument()
        try a.typeText("Saved")
        try a.setHeading(2)
        let b = try PliDocument(json: try a.json())
        XCTAssertEqual(try b.blocks().first?.text, "Saved")
        XCTAssertEqual(try b.blocks().first?.level, 2)
    }

    func testDocxRoundTrip() throws {
        let a = try PliDocument(title: "Report")
        try a.typeText("Quarterly numbers")
        try a.setHeading(1)
        let file = try a.exportDocx()
        XCTAssertEqual(file.prefix(2), Data([0x50, 0x4b]))   // a zip
        let b = try PliDocument()
        let result = try b.importDocx(file)
        XCTAssertEqual(result.warnings, [])
        XCTAssertEqual(try b.blocks().first?.type, "heading")
        XCTAssertEqual(try b.blocks().first?.text, "Quarterly numbers")
    }

    func testSuggestionsForAUser() throws {
        let doc = try PliDocument(user: PliUser(id: "ana", name: "Ana"))
        try doc.typeText("Hello")
        XCTAssertTrue(try doc.setSuggesting(true))
        try doc.typeText(" there")
        let suggestion = try XCTUnwrap(doc.suggestions().first)
        XCTAssertEqual(suggestion.kind, "insert")
        XCTAssertEqual(suggestion.by, "ana")
        XCTAssertEqual(suggestion.text, " there")
        XCTAssertTrue(try doc.acceptSuggestion(suggestion.id))
        XCTAssertEqual(try doc.plainText(), "Hello there")
        XCTAssertEqual(try doc.suggestions().count, 0)
    }

    func testAViewerCannotSuggest() throws {
        let doc = try PliDocument(user: PliUser(id: "v", name: "Vee", role: "viewer"))
        XCTAssertFalse(try doc.setSuggesting(true))
        let anonymous = try PliDocument()
        XCTAssertFalse(try anonymous.setSuggesting(true))
    }

    func testErrorsComeBackAsSwiftErrors() throws {
        XCTAssertThrowsError(try PliDocument(json: "{nope")) { error in
            XCTAssertEqual((error as? PliError)?.code, "invalid_document")
        }
        let doc = try PliDocument()
        XCTAssertThrowsError(try doc.setHeading(9)) { error in
            XCTAssertEqual((error as? PliError)?.code, "invalid_operation")
        }
        XCTAssertThrowsError(try doc.importDocx(Data([1, 2, 3]))) { error in
            XCTAssertEqual((error as? PliError)?.code, "invalid_document")
        }
    }

    func testSeveralDocumentsDontMix() throws {
        let a = try PliDocument()
        let b = try PliDocument()
        try a.typeText("A")
        try b.typeText("B")
        XCTAssertEqual(try a.plainText(), "A")
        XCTAssertEqual(try b.plainText(), "B")
    }

    func testUsableFromManyThreads() throws {
        let doc = try PliDocument()
        let done = expectation(description: "typed")
        done.expectedFulfillmentCount = 8
        for _ in 0..<8 {
            DispatchQueue.global().async {
                _ = try? doc.typeText("x")
                done.fulfill()
            }
        }
        wait(for: [done], timeout: 10)
        XCTAssertEqual(try doc.plainText().count, 8)
    }

    func testTheEditorPageIsInThePackage() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "pli-editor", withExtension: "html"))
        let page = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(page.contains("pliHost"))
        XCTAssertTrue(page.contains("messageHandlers"))
        XCTAssertFalse(page.contains("<script src"))
    }
}
