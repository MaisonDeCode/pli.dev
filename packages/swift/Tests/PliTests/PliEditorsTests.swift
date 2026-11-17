import XCTest
@testable import Pli

/// A directory of two people, which counts how often it is asked.
final class Locked<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ value: T) { self.value = value }
    func with<R>(_ body: (inout T) -> R) -> R { lock.lock(); defer { lock.unlock() }; return body(&value) }
}

final class TestDirectory: PliUserDirectory, @unchecked Sendable {
    private let asked = Locked<[[String]]>([])
    var calls: [[String]] { asked.with { $0 } }
    func lookup(ids: [String]) async throws -> [PliUser] {
        asked.with { $0.append(ids) }
        return ids.compactMap { $0 == "grace" ? PliUser(id: "grace", name: "Grace Hopper") : nil }
    }
}

/// A comment store that keeps what it is given, and fails when told to.
final class TestCommentStore: PliCommentStore, @unchecked Sendable {
    private let saved = Locked<[PliCommentChange]>([])
    private let broken = Locked(false)
    private let seed: [PliThread]
    init(seed: [PliThread] = []) { self.seed = seed }
    var failing: Bool { get { broken.with { $0 } } set { broken.with { $0 = newValue } } }
    var changes: [PliCommentChange] { saved.with { $0 } }
    func load(file: String) async throws -> [PliThread] { seed }
    func save(file: String, change: PliCommentChange) async throws {
        if failing { throw PliError(code: "storage", message: "database is down") }
        saved.with { $0.append(change) }
    }
}

final class TestStorage: PliStorageAdapter, @unchecked Sendable {
    private let files = Locked<[String: Data]>([:])
    func upload(_ data: Data, name: String, type: String) async throws -> PliUpload {
        files.with { $0["files/\(name)"] = data }
        return PliUpload(ref: "files/\(name)", url: "https://cdn.example/\(name)", width: 1, height: 1)
    }
    func resolve(ref: String) async throws -> String { "https://cdn.example/\(ref)?signed=1" }
    func read(ref: String) async throws -> (type: String, data: Data) {
        guard let data = files.with({ $0[ref] }) else { throw PliError(code: "not_found", message: "no \(ref)") }
        return ("application/octet-stream", data)
    }
}

final class PliWorkbookTests: XCTestCase {
    let ada = PliUser(id: "ada", name: "Ada")

    func testTypesCalculatesAndReads() throws {
        let book = try PliWorkbook(title: "Budget")
        XCTAssertEqual(try book.title(), "Budget")
        try book.setCells(sheet: "Sheet1", inputs: ["A1": 10, "A2": 32, "A3": "=SUM(A1:A2)", "B3": "=A3/0"])
        let cell = try book.cell(sheet: "Sheet1", address: "A3")
        XCTAssertEqual(cell.value, 42)
        XCTAssertEqual(cell.text, "42")
        XCTAssertEqual(cell.formula, "=SUM(A1:A2)")
        XCTAssertEqual(try book.cell(sheet: "sheet1", address: "B3").error, "#DIV/0!")
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "A3"), 42)
        XCTAssertEqual(try book.values(sheet: "Sheet1", range: "A1:A3"), [[10], [32], [42]])
        XCTAssertEqual(try book.usedRange("Sheet1"), "A1:B3")
        try book.setFormat(sheet: "Sheet1", range: "A3", format: "0.00")
        XCTAssertEqual(try book.text(sheet: "Sheet1", address: "A3"), "42.00")
        XCTAssertEqual(try book.sheets().map(\.name), ["Sheet1"])
    }

    func testEditsLikeASpreadsheet() throws {
        let book = try PliWorkbook()
        try book.setValues(sheet: "Sheet1", at: "A1", rows: [[3, "c"], [1, "a"], [2, "b"]])
        try book.sort(sheet: "Sheet1", range: "A1:B3", by: 1, descending: false, header: false)
        XCTAssertEqual(try book.values(sheet: "Sheet1", range: "A1:B3"), [[1, "a"], [2, "b"], [3, "c"]])
        try book.insertRows(sheet: "Sheet1", at: 2, count: 1)
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "A3"), 2)
        let second = try book.addSheet(name: "Second")
        try book.renameSheet(sheet: second.id, name: "Totals")
        try book.setCell(sheet: "Totals", address: "A1", value: "=Sheet1!A1*2")
        XCTAssertEqual(try book.value(sheet: "Totals", address: "A1"), 2)
        XCTAssertTrue(try book.undo())
        XCTAssertEqual(try book.value(sheet: "Totals", address: "A1"), nil)
        XCTAssertTrue(try book.redo())
        XCTAssertEqual(try book.value(sheet: "Totals", address: "A1"), 2)
        XCTAssertEqual(try book.find(text: "b").count, 1)
        XCTAssertThrowsError(try book.clear(sheet: "Nope", range: "A1", what: .all)) { XCTAssertEqual(($0 as? PliError)?.code, "not_found") }
    }

    func testOperationsAndAnyMethodByName() throws {
        let book = try PliWorkbook()
        let id = try book.sheets()[0].id
        try book.apply([["type": "set_cells", "sheet": .string(id), "cells": ["A1": ["v": 5], "A2": ["f": "A1*2"]]]])
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "A2"), 10)
        XCTAssertEqual(try book.call("value", ["Sheet1", "A2"]), 10)
        XCTAssertThrowsError(try book.call("constructor")) { XCTAssertEqual(($0 as? PliError)?.code, "not_found") }
        let reopened = try PliWorkbook(json: try book.documentJSON())
        XCTAssertEqual(try reopened.value(sheet: "Sheet1", address: "A2"), 10)
    }

    func testTellsYouAboutChanges() throws {
        let book = try PliWorkbook()
        var seen: [PliChange] = []
        let subscription = book.onChange { seen.append($0) }
        try book.setCell(sheet: "Sheet1", address: "A1", value: 1)
        try book.undo()
        XCTAssertEqual(seen.map(\.origin), ["local", "undo"])
        XCTAssertEqual(seen[0].operations.first?["type"]?.stringValue, "set_cells")
        XCTAssertTrue(seen[0].canUndo)
        XCTAssertTrue(seen[1].canRedo)
        subscription.cancel()
        try book.redo()
        XCTAssertEqual(seen.count, 2)
    }

    func testFiles() async throws {
        let book = try PliWorkbook(title: "Files")
        try book.setValues(sheet: "Sheet1", at: "A1", rows: [["Item", "Cost"], ["Pens", 12.5], ["Paper", 30]])
        try book.setCell(sheet: "Sheet1", address: "B4", value: "=SUM(B2:B3)")
        let xlsx = try book.exportXlsx()
        XCTAssertEqual(xlsx.prefix(2), Data("PK".utf8))
        let again = try PliWorkbook(xlsx: xlsx)
        XCTAssertEqual(try again.value(sheet: "Sheet1", address: "B4"), 42.5)
        XCTAssertEqual(try again.warnings(), [])
        XCTAssertTrue(try book.exportCsv(sheet: "Sheet1").contains("Pens,12.5"))
        XCTAssertTrue(try book.exportCsv(delimiter: ";").contains("Item;Cost"))
        let csv = try PliWorkbook(csv: "x,y\n1,2\n")
        XCTAssertEqual(try csv.values(sheet: "Sheet1", range: "A1:B2"), [["x", "y"], [1, 2]])
        try book.importCsv("a,b\n3,4\n")
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "B2"), 4)
        let pdf = try await book.exportPdf(sheet: "Sheet1")
        XCTAssertEqual(pdf.prefix(5), Data("%PDF-".utf8))
        XCTAssertThrowsError(try PliWorkbook(xlsx: Data([1, 2, 3, 4]))) { XCTAssertEqual(($0 as? PliError)?.code, "invalid_document") }
    }

    func testRefusesWrongArguments() throws {
        let book = try PliWorkbook()
        XCTAssertThrowsError(try book.call("insertRows", ["Sheet1", "x", 1])) { _ in }
        XCTAssertThrowsError(try book.run("setCell", ["Sheet1", "A1"]) as PliJSON) { XCTAssertEqual(($0 as? PliError)?.code, "invalid_operation") }
        XCTAssertThrowsError(try book.run("clear", ["Sheet1", "A1", "everything"]) as PliJSON) {
            XCTAssertTrue(($0 as? PliError)?.message.contains("one of all, contents, formats") ?? false)
        }
    }

    func testCommentsAnchoredToCells() throws {
        let book = try PliWorkbook(user: ada)
        var heard: [String] = []
        book.comments.onChange { origin, change in heard.append("\(origin):\(change.threadID.isEmpty ? "" : "x")") }
        try book.setCell(sheet: "Sheet1", address: "B2", value: 5)
        let thread = try book.commentOnRange(sheet: "Sheet1", range: "B2:C3", body: "Is this right? @Grace", mentions: ["grace"])
        XCTAssertEqual(thread.anchor?["range"]?.stringValue, "B2:C3")
        XCTAssertEqual(thread.comments[0].author, "ada")
        XCTAssertEqual(thread.comments[0].mentions, ["grace"])
        XCTAssertEqual(try book.threadsAt(sheet: "Sheet1", address: "C3").count, 1)
        XCTAssertEqual(try book.threadsAt(sheet: "Sheet1", address: "D4").count, 0)
        let reply = try book.comments.reply(to: thread.id, "Yes")
        try book.comments.resolve(thread.id)
        XCTAssertTrue(try book.comments.threads()[0].isResolved)
        try book.comments.reopen(thread.id)
        try book.comments.edit(thread: thread.id, comment: reply.id, body: "Yes, it is")
        XCTAssertEqual(try book.comments.threads()[0].comments.map(\.body), ["Is this right? @Grace", "Yes, it is"])
        XCTAssertEqual(heard.count, 5)
        try book.comments.delete(thread: thread.id, comment: reply.id)
        try book.comments.deleteThread(thread.id)
        XCTAssertEqual(try book.comments.threads().count, 0)

        // A viewer may read, and not write.
        try book.users.setCurrent(PliUser(id: "vee", name: "Vee"), role: .viewer)
        XCTAssertFalse(try book.comments.can(.comment))
        XCTAssertThrowsError(try book.comments.createThread("No")) { XCTAssertTrue(($0 as? PliError)?.message.contains("Not allowed") ?? false) }
        let me = try book.users.current()
        XCTAssertEqual(me.user?.id, "vee")
        XCTAssertEqual(me.role, .viewer)
    }

    func testWorkbooksStayInStep() async throws {
        let seed = try PliWorkbook(user: ada)
        let authority = try PliAuthority(editor: .sheets, initial: try seed.documentJSON())
        let hub = PliMemoryHub()
        hub.serve(authority, room: "book-room")
        let a = try PliWorkbook(json: try seed.documentJSON(), user: ada)
        let b = try PliWorkbook(json: try seed.documentJSON(), user: PliUser(id: "grace", name: "Grace"))
        try a.sync.start(room: "book-room", transport: hub.transport(), verifyEvery: 0)
        try b.sync.start(room: "book-room", transport: hub.transport(), verifyEvery: 0)
        await hub.settle()
        try a.setCell(sheet: "Sheet1", address: "A1", value: 10)
        try b.setCell(sheet: "Sheet1", address: "B1", value: "=A1*2")
        await hub.settle()
        XCTAssertEqual(try a.value(sheet: "Sheet1", address: "B1"), 20)
        XCTAssertEqual(try b.value(sheet: "Sheet1", address: "A1"), 10)
        try a.commentOnRange(sheet: "Sheet1", range: "A1", body: "Why ten?")
        await hub.settle()
        XCTAssertEqual(try b.comments.threads().count, 1)
        XCTAssertEqual(try b.threadsAt(sheet: "Sheet1", address: "A1").count, 1)
    }

    func testScriptsReadAndChangeThroughOperations() throws {
        let book = try PliWorkbook()
        let id = try book.sheets()[0].id
        let count = try book.scripts.run("""
            ctx.apply([{ type: "set_cells", sheet: "\(id)", cells: { A1: { v: 4 }, A2: { f: "A1*10" } } }]);
            return ctx.state.sheets.length;
            """)
        XCTAssertEqual(count, 1)
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "A2"), 40)
        XCTAssertTrue(try book.undo())   // one run, one undo step
        XCTAssertEqual(try book.value(sheet: "Sheet1", address: "A2"), .null)
        XCTAssertThrowsError(try book.scripts.run("return ctx.state.title", grants: [.write])) { XCTAssertTrue(($0 as? PliError)?.message.contains("not allowed to read") ?? false) }
        XCTAssertThrowsError(try book.scripts.run("throw new Error('no')")) { XCTAssertTrue(($0 as? PliError)?.message.contains("no") ?? false) }
        XCTAssertThrowsError(try book.scripts.run("this is not javascript")) { XCTAssertEqual(($0 as? PliError)?.code, "invalid_operation") }
        let doc = try PliDocument()
        XCTAssertEqual(try doc.scripts.run("return ctx.state.blocks.length"), 1)
    }
}

final class PliDeckTests: XCTestCase {
    let ada = PliUser(id: "ada", name: "Ada")

    func testMakesSlidesAndFillsThem() throws {
        let deck = try PliDeck(title: "Launch")
        XCTAssertEqual(try deck.title(), "Launch")
        let first = try deck.slides()[0]
        let second = try deck.addSlide(after: first.id)
        XCTAssertEqual(try deck.slides().count, 2)
        let box = try deck.addTextBox(slide: second.id, x: 40, y: 60, w: 300, h: 40, text: "Hello deck")
        XCTAssertEqual(try deck.elements(second.id).first { $0.id == box }?.text, "Hello deck")
        try deck.setText(slide: second.id, element: box, text: "Line one\nLine two")
        try deck.formatText(slide: second.id, ids: [box], patch: ["bold": true, "fontSize": 30])
        try deck.setFrame(slide: second.id, element: box, x: 10, rotation: 15)
        let moved = try deck.elements(second.id).first { $0.id == box }
        XCTAssertEqual(moved?.x, 10)
        XCTAssertEqual(moved?.rotation, 15)
        try deck.setNotes(slide: second.id, notes: "Say hello")
        XCTAssertEqual(try deck.notes(second.id), "Say hello")
        XCTAssertEqual(try deck.replaceAll(query: "Line", replacement: "Row", matchCase: true), 2)
        let shape = try deck.addShape(slide: second.id, geometry: "ellipse", x: 200, y: 120, w: 100, h: 100)
        try deck.setFill(slide: second.id, ids: [shape], fill: "#c00000")
        XCTAssertEqual(try deck.duplicateElements(slide: second.id, ids: [shape]).count, 1)
        try deck.deleteElements(slide: second.id, ids: [shape])
        XCTAssertTrue(try deck.undo())
        XCTAssertEqual(try deck.size(), PliDeckSize(width: 720, height: 405))
        XCTAssertThrowsError(try deck.addChart(slide: first.id, chartType: "radar"))
    }

    func testFiles() async throws {
        let deck = try PliDeck()
        let slide = try deck.slides()[0].id
        try deck.addTextBox(slide: slide, x: 40, y: 200, w: 400, h: 40, text: "Quarterly review")
        let pptx = try deck.exportPptx()
        XCTAssertEqual(pptx.prefix(2), Data("PK".utf8))
        let again = try PliDeck(pptx: pptx)
        let id = try again.slides()[0].id
        XCTAssertTrue(try again.elements(id).contains { $0.text == "Quarterly review" })
        XCTAssertEqual(try deck.exportPdf().prefix(5), Data("%PDF-".utf8))
        try deck.importPptx(pptx)
        XCTAssertEqual(try deck.slides().count, 1)
    }

    func testCommentsOnSlidesAndElements() throws {
        let deck = try PliDeck(user: ada)
        let slide = try deck.slides()[0].id
        let onSlide = try deck.commentOnSlide(slide: slide, body: "Title is long")
        XCTAssertEqual(onSlide.anchor?["slide"]?.stringValue, slide)
        let box = try deck.addTextBox(slide: slide, x: 0, y: 0, w: 10, h: 10, text: "x")
        try deck.commentOnElement(slide: slide, element: box, body: "Too small")
        XCTAssertEqual(try deck.threadsOn(slide: slide).count, 2)
        XCTAssertEqual(try deck.threadsOn(slide: slide, element: box).count, 1)
        XCTAssertThrowsError(try deck.commentOnElement(slide: slide, element: "nope", body: "x")) { XCTAssertEqual(($0 as? PliError)?.code, "not_found") }
    }
}

final class PliPdfTests: XCTestCase {
    let ada = PliUser(id: "ada", name: "Ada")

    func testAnnotatesAndWritesTheFileBack() async throws {
        let pdf = try PliPdf(user: ada)
        let page = try pdf.pages()[0]
        XCTAssertEqual(page.number, 1)
        XCTAssertEqual(page.width, 612)
        let note = try pdf.addNote(page: page.id, x: 100, y: 100, text: "Check this")
        try pdf.addHighlight(page: page.id, rects: [["x": 72, "y": 700, "w": 100, "h": 12]], kind: .underline, quote: "q")
        try pdf.addShape(page: page.id, kind: .circle, x: 50, y: 50, w: 80, h: 80, color: "#ff0000")
        XCTAssertEqual(try pdf.annotations(page.id).map(\.type), ["note", "underline", "circle"])
        try pdf.setAnnotationText(id: note, text: "Checked")
        try pdf.setMetadata(["title": "Renamed"])
        XCTAssertEqual(try pdf.metadata().title, "Renamed")
        let blank = try pdf.insertBlankPage(after: page.id)
        XCTAssertEqual(try pdf.pages().map(\.id), [page.id, blank])
        try pdf.rotatePages(ids: [blank], degrees: 90)
        XCTAssertEqual(try pdf.pages()[1].rotate, 90)
        try pdf.deletePages([blank])
        XCTAssertTrue(try pdf.isDirty())

        let saved = try await pdf.exportPdf()
        XCTAssertEqual(saved.prefix(5), Data("%PDF-".utf8))
        XCTAssertFalse(try pdf.isDirty())
        let again = try PliPdf(data: saved)
        let found = try again.annotations(try again.pages()[0].id)
        XCTAssertTrue(found.contains { $0.contents == "Checked" })
        XCTAssertEqual(try again.metadata().title, "Renamed")
        XCTAssertEqual(try again.text(try again.pages()[0].id), "")
        try pdf.importPdf(saved)
    }

    func testCommentsAreKeptInTheFile() async throws {
        let pdf = try PliPdf(user: ada)
        let page = try pdf.pages()[0].id
        let thread = try pdf.addComment(page: page, x: 120, y: 300, body: "Typo here")
        XCTAssertEqual(thread.anchor?["page"]?.stringValue, page)
        XCTAssertTrue(try pdf.annotations(page).contains { $0.type == "note" && $0.thread == thread.id })
        let hl = try pdf.addHighlight(page: page, rects: [["x": 72, "y": 600, "w": 50, "h": 10]], quote: "quoted")
        let onHighlight = try pdf.commentOnAnnotation(annotation: hl, body: "Why?")
        XCTAssertEqual(onHighlight.anchor?["annot"]?.stringValue, hl)
        let saved = try await pdf.exportPdf()
        let again = try PliPdf(data: saved, user: PliUser(id: "grace", name: "Grace"))
        XCTAssertEqual(try again.comments.threads().map { $0.comments[0].body }.sorted(), ["Typo here", "Why?"])
    }
}

final class PliSharedFeatureTests: XCTestCase {
    let ada = PliUser(id: "ada", name: "Ada")

    func testDocumentsHaveCommentsOnTheSelection() throws {
        let doc = try PliDocument(user: ada)
        try doc.typeText("Hello world")
        XCTAssertNil(try doc.commentOnSelection(body: "Nothing selected"))
        let id = try XCTUnwrap(doc.blocks().first?.id)
        try doc.select(anchorBlock: id, anchorOffset: 0, focusBlock: id, focusOffset: 5)
        let thread = try XCTUnwrap(try doc.commentOnSelection(body: "Greeting?", mentions: ["grace"]))
        XCTAssertEqual(thread.anchor?["quote"]?.stringValue, "Hello")
        XCTAssertEqual(try doc.commentRanges(thread.id), [PliCommentRange(block: id, from: 0, to: 5)])
        XCTAssertEqual(try doc.threadsAtSelection().map(\.id), [thread.id])
        XCTAssertEqual(try doc.comments.threads().count, 1)
        // The comment is in the document, so a copy has it.
        let copy = try PliDocument(json: try doc.json())
        XCTAssertEqual(try copy.comments.threads().map(\.id), [thread.id])
    }

    func testTheAppProvidesPeopleCommentsAndFiles() async throws {
        let directory = TestDirectory()
        let store = TestCommentStore()
        let storage = TestStorage()
        let host = PliHost(directory: directory, commentStore: store, storage: storage, storageMaxBytes: 1000, storageAllowedTypes: ["image/*"])
        let doc = try PliDocument(user: ada, host: host)

        // A person the engine doesn't know is asked for, and the answer arrives.
        XCTAssertEqual(try doc.users.user(id: "grace").name, "grace")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(try doc.users.user(id: "grace").name, "Grace Hopper")
        XCTAssertEqual(directory.calls, [["grace"]])

        // Comments reach the app's store, in order.
        let thread = try doc.comments.createThread("Stored by the app")
        try doc.comments.reply(to: thread.id, "And again")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(store.changes.count, 2)
        if case .createThread(let saved) = store.changes[0] { XCTAssertEqual(saved.comments[0].body, "Stored by the app") } else { XCTFail("the first change is the thread") }

        // A store that fails takes the change back.
        store.failing = true
        _ = try doc.comments.createThread("Lost")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(try doc.comments.threads().map { $0.comments[0].body }, ["Stored by the app"])
        store.failing = false

        // Files go to the app's storage, after the limits.
        let upload = try await doc.storage.upload(Data([1, 2, 3]), name: "dot.png", type: "image/png")
        XCTAssertEqual(upload.ref, "files/dot.png")
        let signed = try await doc.storage.resolve(upload.ref)
        XCTAssertEqual(signed, "https://cdn.example/files/dot.png?signed=1")
        let back = try await doc.storage.read(upload.ref)
        XCTAssertEqual(back.data, Data([1, 2, 3]))
        do {
            _ = try await doc.storage.upload(Data("x".utf8), name: "a.txt", type: "text/plain")
            XCTFail("a text file is refused")
        } catch let error as PliError {
            XCTAssertTrue(error.message.contains("aren't allowed"))
        }
    }

    func testLoadsTheStoresThreads() async throws {
        let seeded = PliThread.example
        let doc = try PliDocument(user: ada, host: PliHost(commentStore: TestCommentStore(seed: [seeded])))
        // The store loads in the background; the threads are there a moment later.
        try await Task.sleep(nanoseconds: 100_000_000)
        try await doc.comments.reload()
        XCTAssertEqual(try doc.comments.threads().map(\.id), ["th_seed"])
    }

    func testTwoDocumentsAndASequencerStayInStep() async throws {
        let seed = try PliDocument(user: ada, host: PliHost(), live: true)
        let authority = try PliAuthority(editor: .documents, initial: try seed.json())
        let hub = PliMemoryHub()
        hub.serve(authority, room: "room-1")

        let a = try PliDocument(json: try seed.json(), user: ada, live: true)
        let b = try PliDocument(json: try seed.json(), user: PliUser(id: "grace", name: "Grace"), live: true)
        var statuses: [PliSyncStatus] = []
        a.sync.onState { statuses.append($0.status) }
        var peers: [[PliPeer]] = []
        a.sync.onPeers { peers.append($0) }
        try a.sync.start(room: "room-1", transport: hub.transport(), verifyEvery: 0)
        try b.sync.start(room: "room-1", transport: hub.transport(), verifyEvery: 0)
        await hub.settle()
        XCTAssertEqual(try a.sync.state().status, .synced)

        try a.typeText("Hello from Ada")
        await hub.settle()
        XCTAssertEqual(try b.plainText(), "Hello from Ada")
        XCTAssertEqual(try a.sync.state().unsynced, 0)

        // Both type at once; both end up with the same text.
        try a.typeText("!")
        let id = try XCTUnwrap(b.blocks().first?.id)
        try b.select(anchorBlock: id, anchorOffset: 0, focusBlock: id, focusOffset: 0)
        try b.typeText(">> ")
        await hub.settle()
        XCTAssertEqual(try a.plainText(), ">> Hello from Ada!")
        XCTAssertEqual(try b.plainText(), ">> Hello from Ada!")
        XCTAssertEqual(try a.json(), try b.json())

        // Comments and presence travel the same room.
        let thread = try a.comments.createThread("Nice", anchor: ["block": .string(id)])
        try b.sync.setPresence(["note": "typing"])
        await hub.settle()
        XCTAssertEqual(try b.comments.threads().map(\.id), [thread.id])
        let seen = try a.sync.peers()
        XCTAssertEqual(seen.map(\.user.id), ["grace"])
        XCTAssertEqual(seen.first?.state["note"]?.stringValue, "typing")
        XCTAssertFalse(peers.isEmpty)
        XCTAssertTrue(statuses.contains(.saving))

        // Offline: changes are kept and sent when the connection is back.
        try b.sync.setOnline(false)
        try b.typeText("offline ")
        await hub.settle()
        XCTAssertEqual(try b.sync.state().status, .offline)
        XCTAssertFalse(try a.plainText().contains("offline"))
        try b.sync.setOnline(true)
        await hub.settle()
        XCTAssertTrue(try a.plainText().contains("offline"))
        XCTAssertEqual(try a.json(), try b.json())
        try b.sync.stop()
        XCTAssertEqual(try b.sync.state().room, "idle")
    }

    func testPdfsStayInStep() async throws {
        let seed = try PliPdf(user: ada)
        let file = try await seed.exportPdf()
        let authority = try PliAuthority(editor: .pdf, initial: try seed.documentJSON())
        let hub = PliMemoryHub()
        hub.serve(authority, room: "pdf-room")
        let a = try PliPdf(data: file, user: ada)
        let b = try PliPdf(data: file, user: PliUser(id: "grace", name: "Grace"))
        try a.sync.start(room: "pdf-room", transport: hub.transport(), verifyEvery: 0)
        try b.sync.start(room: "pdf-room", transport: hub.transport(), verifyEvery: 0)
        await hub.settle()
        let page = try a.pages()[0].id
        try a.addNote(page: page, x: 50, y: 50, text: "from a")
        try b.addComment(page: page, x: 80, y: 80, body: "from b")
        await hub.settle()
        XCTAssertEqual(try a.annotations(page).count, 2)
        XCTAssertEqual(try b.annotations(page).count, 2)
        XCTAssertEqual(try a.comments.threads().count, 1)
        XCTAssertEqual(try a.documentJSON(), try b.documentJSON())
    }

    func testEveryEngineStartsInJavaScriptCore() throws {
        // Each editor has its own script; each starts in a context with nothing but the language.
        _ = try PliDocument()
        _ = try PliWorkbook()
        _ = try PliDeck()
        _ = try PliPdf()
    }
}

extension PliThread {
    static var example: PliThread {
        try! JSONDecoder().decode(PliThread.self, from: Data(#"{"id":"th_seed","comments":[{"id":"cm_1","author":"grace","body":"From the store","createdAt":1}],"createdAt":1}"#.utf8))
    }
}
