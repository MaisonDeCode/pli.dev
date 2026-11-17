package dev.pli

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ConcurrentHashMap
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertContentEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val ada = PliUser("ada", "Ada")

private fun num(value: JsonElement) = value.jsonPrimitive.content.toDouble()
private fun text(value: JsonElement) = value.jsonPrimitive.content
private fun bytes(vararg s: String) = s.joinToString("").toByteArray()
private fun ByteArray.starts(prefix: String) = size >= prefix.length && String(copyOf(prefix.length)) == prefix

class TestDirectory : PliUserDirectory {
    val calls = CopyOnWriteArrayList<List<String>>()
    override suspend fun lookup(ids: List<String>): List<PliUser> {
        calls.add(ids)
        return ids.filter { it == "grace" }.map { PliUser("grace", "Grace Hopper") }
    }
}

class TestCommentStore(private val seed: List<PliThread> = emptyList()) : PliCommentStore {
    val changes = CopyOnWriteArrayList<PliCommentChange>()
    @Volatile var failing = false
    override suspend fun load(file: String) = seed
    override suspend fun save(file: String, change: PliCommentChange) {
        if (failing) throw PliException("storage", "database is down")
        changes.add(change)
    }
}

class TestStorage : PliStorageAdapter {
    private val files = ConcurrentHashMap<String, ByteArray>()
    override suspend fun upload(data: ByteArray, name: String, type: String): PliUpload {
        files["files/$name"] = data
        return PliUpload("files/$name", "https://cdn.example/$name", 1, 1)
    }

    override suspend fun resolve(ref: String) = "https://cdn.example/$ref?signed=1"
    override suspend fun read(ref: String) = PliStoredFile("application/octet-stream", files[ref] ?: throw PliException("not_found", "no $ref"))
}

class PliWorkbookTest {
    @Test
    fun typesCalculatesAndReads() {
        PliWorkbook(title = "Budget").use { book ->
            assertEquals("Budget", book.title())
            book.setCells("Sheet1", mapOf("A1" to 10, "A2" to 32, "A3" to "=SUM(A1:A2)", "B3" to "=A3/0"))
            val cell = book.cell("Sheet1", "A3")
            assertEquals(42.0, num(cell.value))
            assertEquals("42", cell.text)
            assertEquals("=SUM(A1:A2)", cell.formula)
            assertEquals("#DIV/0!", book.cell("sheet1", "B3").error)
            assertEquals(42.0, num(book.value("Sheet1", "A3")))
            assertEquals("[[10],[32],[42]]", book.values("Sheet1", "A1:A3").toString())
            assertEquals("A1:B3", book.usedRange("Sheet1"))
            book.setFormat("Sheet1", "A3", "0.00")
            assertEquals("42.00", book.text("Sheet1", "A3"))
            assertEquals(listOf("Sheet1"), book.sheets().map { it.name })
        }
    }

    @Test
    fun editsLikeASpreadsheet() {
        PliWorkbook().use { book ->
            book.setValues("Sheet1", "A1", listOf(listOf(3, "c"), listOf(1, "a"), listOf(2, "b")))
            book.sort("Sheet1", "A1:B3", by = 1, descending = false, header = false)
            assertEquals("""[[1,"a"],[2,"b"],[3,"c"]]""", book.values("Sheet1", "A1:B3").toString())
            book.insertRows("Sheet1", 2, 1)
            assertEquals(2.0, num(book.value("Sheet1", "A3")))
            val second = book.addSheet("Second")
            book.renameSheet(second.id, "Totals")
            book.setCell("Totals", "A1", "=Sheet1!A1*2")
            assertEquals(2.0, num(book.value("Totals", "A1")))
            assertTrue(book.undo())
            assertEquals(JsonNull, book.value("Totals", "A1"))
            assertTrue(book.redo())
            assertEquals(1, book.find("b").size)
            val error = assertFailsWith<PliException> { book.clear("Nope", "A1", PliClearWhat.ALL) }
            assertEquals("not_found", error.code)
        }
    }

    @Test
    fun operationsAndAnyMethodByName() {
        PliWorkbook().use { book ->
            val id = book.sheets()[0].id
            book.apply(listOf(buildJsonObject {
                put("type", "set_cells"); put("sheet", id)
                put("cells", buildJsonObject { put("A1", buildJsonObject { put("v", 5) }); put("A2", buildJsonObject { put("f", "A1*2") }) })
            }))
            assertEquals(10.0, num(book.value("Sheet1", "A2")))
            assertEquals(10.0, num(book.call("value", "Sheet1", "A2")))
            assertEquals("not_found", assertFailsWith<PliException> { book.call("constructor") }.code)
            PliWorkbook(json = book.documentJson()).use { assertEquals(10.0, num(it.value("Sheet1", "A2"))) }
        }
    }

    @Test
    fun tellsYouAboutChanges() {
        PliWorkbook().use { book ->
            val seen = CopyOnWriteArrayList<PliChange>()
            val subscription = book.onChange { seen.add(it) }
            book.setCell("Sheet1", "A1", 1)
            book.undo()
            assertEquals(listOf("local", "undo"), seen.map { it.origin })
            assertEquals("set_cells", seen[0].operations.first().jsonObject["type"]!!.jsonPrimitive.content)
            assertTrue(seen[0].canUndo)
            assertTrue(seen[1].canRedo)
            subscription.cancel()
            book.redo()
            assertEquals(2, seen.size)
        }
    }

    @Test
    fun files() = runBlocking {
        PliWorkbook(title = "Files").use { book ->
            book.setValues("Sheet1", "A1", listOf(listOf("Item", "Cost"), listOf("Pens", 12.5), listOf("Paper", 30)))
            book.setCell("Sheet1", "B4", "=SUM(B2:B3)")
            val xlsx = book.exportXlsx()
            assertTrue(xlsx.starts("PK"))
            PliWorkbook.fromXlsx(xlsx).use { again ->
                assertEquals(42.5, num(again.value("Sheet1", "B4")))
                assertEquals(emptyList(), again.warnings())
            }
            assertTrue(book.exportCsv("Sheet1").contains("Pens,12.5"))
            assertTrue(book.exportCsv(delimiter = ";").contains("Item;Cost"))
            PliWorkbook.fromCsv("x,y\n1,2\n").use { assertEquals("""[["x","y"],[1,2]]""", it.values("Sheet1", "A1:B2").toString()) }
            book.importCsv("a,b\n3,4\n")
            assertEquals(4.0, num(book.value("Sheet1", "B2")))
            assertTrue(book.exportPdf("Sheet1").starts("%PDF-"))
            assertEquals("invalid_document", assertFailsWith<PliException> { PliWorkbook.fromXlsx(byteArrayOf(1, 2, 3, 4)) }.code)
        }
    }

    @Test
    fun refusesWrongArguments() {
        PliWorkbook().use { book ->
            assertTrue(assertFailsWith<PliException> { book.invokeRaw("setCell", arrayOf("Sheet1", "A1")) }.message.contains("takes 3 arguments"))
            assertTrue(assertFailsWith<PliException> { book.invokeRaw("clear", arrayOf("Sheet1", "A1", "everything")) }.message.contains("one of all, contents, formats"))
        }
    }

    @Test
    fun commentsAnchoredToCells() {
        PliWorkbook(user = ada).use { book ->
            val heard = CopyOnWriteArrayList<String>()
            book.comments.onChange { origin, change -> heard.add("$origin:${change.threadId.isNotEmpty()}") }
            book.setCell("Sheet1", "B2", 5)
            val thread = book.commentOnRange("Sheet1", "B2:C3", "Is this right? @Grace", listOf("grace"))
            assertEquals("B2:C3", thread.anchor!!.jsonObject["range"]!!.jsonPrimitive.content)
            assertEquals("ada", thread.comments[0].author)
            assertEquals(listOf("grace"), thread.comments[0].mentions)
            assertEquals(1, book.threadsAt("Sheet1", "C3").size)
            assertEquals(0, book.threadsAt("Sheet1", "D4").size)
            val reply = book.comments.reply(thread.id, "Yes")
            book.comments.resolve(thread.id)
            assertTrue(book.comments.threads()[0].isResolved)
            book.comments.reopen(thread.id)
            book.comments.edit(thread.id, reply.id, "Yes, it is")
            assertEquals(listOf("Is this right? @Grace", "Yes, it is"), book.comments.threads()[0].comments.map { it.body })
            assertEquals(5, heard.size)
            book.comments.delete(thread.id, reply.id)
            book.comments.deleteThread(thread.id)
            assertEquals(0, book.comments.threads().size)

            book.users.setCurrent(PliUser("vee", "Vee"), PliRole.VIEWER)
            assertFalse(book.comments.can(PliCommentAction.COMMENT))
            assertTrue(assertFailsWith<PliException> { book.comments.createThread("No") }.message.contains("Not allowed"))
            val (user, role) = book.users.current()
            assertEquals("vee", user!!.id)
            assertEquals(PliRole.VIEWER, role)
        }
    }

    @Test
    fun workbooksStayInStep() = runBlocking {
        val seed = PliWorkbook(user = ada)
        val authority = PliAuthority(PliEditorKind.SHEETS, seed.documentJson())
        val hub = PliMemoryHub()
        hub.serve(authority, "book-room")
        val a = PliWorkbook(json = seed.documentJson(), user = ada)
        val b = PliWorkbook(json = seed.documentJson(), user = PliUser("grace", "Grace"))
        a.sync.start(hub.transport(), room = "book-room", verifyEverySeconds = 0.0)
        b.sync.start(hub.transport(), room = "book-room", verifyEverySeconds = 0.0)
        hub.settle()
        a.setCell("Sheet1", "A1", 10)
        b.setCell("Sheet1", "B1", "=A1*2")
        hub.settle()
        assertEquals(20.0, num(a.value("Sheet1", "B1")))
        assertEquals(10.0, num(b.value("Sheet1", "A1")))
        a.commentOnRange("Sheet1", "A1", "Why ten?")
        hub.settle()
        assertEquals(1, b.comments.threads().size)
        assertEquals(1, b.threadsAt("Sheet1", "A1").size)
        listOf(a, b, seed).forEach { it.close() }
        authority.close()
    }

    @Test
    fun scriptsReadAndChangeThroughOperations() {
        PliWorkbook().use { book ->
            val id = book.sheets()[0].id
            val count = book.scripts.run(
                """
                ctx.apply([{ type: "set_cells", sheet: "$id", cells: { A1: { v: 4 }, A2: { f: "A1*10" } } }]);
                return ctx.state.sheets.length;
                """.trimIndent(),
            )
            assertEquals(1.0, num(count))
            assertEquals(40.0, num(book.value("Sheet1", "A2")))
            assertTrue(book.undo())   // one run, one undo step
            assertEquals(JsonNull, book.value("Sheet1", "A2"))
            assertTrue(assertFailsWith<PliException> { book.scripts.run("return ctx.state.title", grants = listOf(PliScriptCapability.WRITE)) }.message.contains("not allowed to read"))
            assertTrue(assertFailsWith<PliException> { book.scripts.run("throw new Error('no')") }.message.contains("no"))
            assertEquals("invalid_operation", assertFailsWith<PliException> { book.scripts.run("this is not javascript") }.code)
        }
        PliDocument().use { assertEquals(1.0, num(it.scripts.run("return ctx.state.blocks.length"))) }
    }
}

class PliDeckTest {
    @Test
    fun makesSlidesAndFillsThem() {
        PliDeck(title = "Launch").use { deck ->
            assertEquals("Launch", deck.title())
            val first = deck.slides()[0]
            val second = deck.addSlide(after = first.id)
            assertEquals(2, deck.slides().size)
            val box = deck.addTextBox(second.id, 40.0, 60.0, 300.0, 40.0, "Hello deck")
            assertEquals("Hello deck", deck.elements(second.id).first { it.id == box }.text)
            deck.setText(second.id, box, "Line one\nLine two")
            deck.formatText(second.id, listOf(box), mapOf("bold" to true, "fontSize" to 30))
            deck.setFrame(second.id, box, x = 10.0, rotation = 15.0)
            val moved = deck.elements(second.id).first { it.id == box }
            assertEquals(10.0, moved.x)
            assertEquals(15.0, moved.rotation)
            deck.setNotes(second.id, "Say hello")
            assertEquals("Say hello", deck.notes(second.id))
            assertEquals(2, deck.replaceAll("Line", "Row", matchCase = true))
            val shape = deck.addShape(second.id, "ellipse", 200.0, 120.0, 100.0, 100.0)
            deck.setFill(second.id, listOf(shape), "#c00000")
            assertEquals(1, deck.duplicateElements(second.id, listOf(shape)).size)
            deck.deleteElements(second.id, listOf(shape))
            assertTrue(deck.undo())
            assertEquals(PliDeckSize(720.0, 405.0), deck.size())
            assertFailsWith<PliException> { deck.addChart(first.id, "radar") }
        }
    }

    @Test
    fun files() {
        PliDeck().use { deck ->
            val slide = deck.slides()[0].id
            deck.addTextBox(slide, 40.0, 200.0, 400.0, 40.0, "Quarterly review")
            val pptx = deck.exportPptx()
            assertTrue(pptx.starts("PK"))
            PliDeck.fromPptx(pptx).use { again ->
                assertTrue(again.elements(again.slides()[0].id).any { it.text == "Quarterly review" })
            }
            assertTrue(deck.exportPdf().starts("%PDF-"))
            deck.importPptx(pptx)
            assertEquals(1, deck.slides().size)
        }
    }

    @Test
    fun commentsOnSlidesAndElements() {
        PliDeck(user = ada).use { deck ->
            val slide = deck.slides()[0].id
            val onSlide = deck.commentOnSlide(slide, "Title is long")
            assertEquals(slide, onSlide.anchor!!.jsonObject["slide"]!!.jsonPrimitive.content)
            val box = deck.addTextBox(slide, 0.0, 0.0, 10.0, 10.0, "x")
            deck.commentOnElement(slide, box, "Too small")
            assertEquals(2, deck.threadsOn(slide).size)
            assertEquals(1, deck.threadsOn(slide, box).size)
            assertEquals("not_found", assertFailsWith<PliException> { deck.commentOnElement(slide, "nope", "x") }.code)
        }
    }
}

class PliPdfTest {
    @Test
    fun annotatesAndWritesTheFileBack() = runBlocking {
        PliPdf(user = ada).use { pdf ->
            val page = pdf.pages()[0]
            assertEquals(1, page.number)
            assertEquals(612.0, page.width)
            val note = pdf.addNote(page.id, 100.0, 100.0, "Check this")
            pdf.addHighlight(page.id, listOf(mapOf("x" to 72, "y" to 700, "w" to 100, "h" to 12)), PliMarkupKind.UNDERLINE, quote = "q")
            pdf.addShape(page.id, PliShapeKind.CIRCLE, 50.0, 50.0, 80.0, 80.0, "#ff0000")
            assertEquals(listOf("note", "underline", "circle"), pdf.annotations(page.id).map { it.type })
            pdf.setAnnotationText(note, "Checked")
            pdf.setMetadata(mapOf("title" to "Renamed"))
            assertEquals("Renamed", pdf.metadata().title)
            val blank = pdf.insertBlankPage(after = page.id)
            assertEquals(listOf(page.id, blank), pdf.pages().map { it.id })
            pdf.rotatePages(listOf(blank), 90)
            assertEquals(90, pdf.pages()[1].rotate)
            pdf.deletePages(listOf(blank))
            assertTrue(pdf.isDirty())

            val saved = pdf.exportPdf()
            assertTrue(saved.starts("%PDF-"))
            assertFalse(pdf.isDirty())
            PliPdf.open(saved).use { again ->
                assertTrue(again.annotations(again.pages()[0].id).any { it.contents == "Checked" })
                assertEquals("Renamed", again.metadata().title)
            }
            pdf.importPdf(saved)
        }
    }

    @Test
    fun commentsAreKeptInTheFile() = runBlocking {
        PliPdf(user = ada).use { pdf ->
            val page = pdf.pages()[0].id
            val thread = pdf.addComment(page, 120.0, 300.0, "Typo here")
            assertEquals(page, thread.anchor!!.jsonObject["page"]!!.jsonPrimitive.content)
            assertTrue(pdf.annotations(page).any { it.type == "note" && it.thread == thread.id })
            val hl = pdf.addHighlight(page, listOf(mapOf("x" to 72, "y" to 600, "w" to 50, "h" to 10)), quote = "quoted")
            assertEquals(hl, pdf.commentOnAnnotation(hl, "Why?").anchor!!.jsonObject["annot"]!!.jsonPrimitive.content)
            val saved = pdf.exportPdf()
            PliPdf.open(saved, user = PliUser("grace", "Grace")).use { again ->
                assertEquals(listOf("Typo here", "Why?"), again.comments.threads().map { it.comments[0].body }.sorted())
            }
        }
    }
}

class PliSharedFeaturesTest {
    @Test
    fun documentsHaveCommentsOnTheSelection() {
        PliDocument(user = ada).use { doc ->
            doc.typeText("Hello world")
            assertNull(doc.commentOnSelection("Nothing selected"))
            val id = doc.blocks()[0].id
            doc.select(id, 0, id, 5)
            val thread = assertNotNull(doc.commentOnSelection("Greeting?", listOf("grace")))
            assertEquals("Hello", thread.anchor!!.jsonObject["quote"]!!.jsonPrimitive.content)
            assertEquals(listOf(PliCommentRange(id, 0, 5)), doc.commentRanges(thread.id))
            assertEquals(listOf(thread.id), doc.threadsAtSelection().map { it.id })
            assertEquals(1, doc.comments.threads().size)
            PliDocument(json = doc.json()).use { copy -> assertEquals(listOf(thread.id), copy.comments.threads().map { it.id }) }
        }
    }

    @Test
    fun theAppProvidesPeopleCommentsAndFiles() = runBlocking {
        val directory = TestDirectory()
        val store = TestCommentStore()
        val storage = TestStorage()
        val host = PliHost(directory, store, storage, storageMaxBytes = 1000, storageAllowedTypes = listOf("image/png", "image/jpeg"))
        PliDocument(user = ada, host = host).use { doc ->
            // A person the engine doesn't know is asked for, and the answer arrives.
            assertEquals("grace", doc.users.user("grace").name)
            delay(150)
            assertEquals("Grace Hopper", doc.users.user("grace").name)
            assertEquals(listOf(listOf("grace")), directory.calls.toList())

            // Comments reach the app's store, in order.
            val thread = doc.comments.createThread("Stored by the app")
            doc.comments.reply(thread.id, "And again")
            delay(150)
            assertEquals(2, store.changes.size)
            assertEquals("Stored by the app", (store.changes[0] as PliCommentChange.CreateThread).thread.comments[0].body)

            // A store that fails takes the change back.
            store.failing = true
            doc.comments.createThread("Lost")
            delay(200)
            assertEquals(listOf("Stored by the app"), doc.comments.threads().map { it.comments[0].body })
            store.failing = false

            // Files go to the app's storage, after the limits.
            val upload = doc.storage.upload(byteArrayOf(1, 2, 3), "dot.png", "image/png")
            assertEquals("files/dot.png", upload.ref)
            assertEquals("https://cdn.example/files/dot.png?signed=1", doc.storage.resolve(upload.ref))
            assertContentEquals(byteArrayOf(1, 2, 3), doc.storage.read(upload.ref).data)
            val refused = runCatching { doc.storage.upload("x".toByteArray(), "a.txt", "text/plain") }.exceptionOrNull()
            assertTrue(refused is PliException && refused.message.contains("aren't allowed"))
        }
    }

    @Test
    fun loadsTheStoresThreads() = runBlocking {
        val seeded = lenient.decodeFromString(PliThread.serializer(), """{"id":"th_seed","comments":[{"id":"cm_1","author":"grace","body":"From the store","createdAt":1}],"createdAt":1}""")
        PliDocument(user = ada, host = PliHost(commentStore = TestCommentStore(listOf(seeded)))).use { doc ->
            delay(150)
            doc.comments.reload()
            assertEquals(listOf("th_seed"), doc.comments.threads().map { it.id })
        }
    }

    @Test
    fun twoDocumentsAndASequencerStayInStep() = runBlocking {
        val seed = PliDocument(user = ada, live = true)
        val authority = PliAuthority(PliEditorKind.DOCUMENTS, seed.json())
        val hub = PliMemoryHub()
        hub.serve(authority, "room-1")
        val a = PliDocument(json = seed.json(), user = ada, live = true)
        val b = PliDocument(json = seed.json(), user = PliUser("grace", "Grace"), live = true)
        val statuses = CopyOnWriteArrayList<PliSyncStatus>()
        a.sync.onState { statuses.add(it.status) }
        val peerLists = CopyOnWriteArrayList<List<PliPeer>>()
        a.sync.onPeers { peerLists.add(it) }
        a.sync.start(hub.transport(), room = "room-1", verifyEverySeconds = 0.0)
        b.sync.start(hub.transport(), room = "room-1", verifyEverySeconds = 0.0)
        hub.settle()
        assertEquals(PliSyncStatus.SYNCED, a.sync.state().status)

        a.typeText("Hello from Ada")
        hub.settle()
        assertEquals("Hello from Ada", b.plainText())
        assertEquals(0, a.sync.state().unsynced)

        // Both type at once; both end up with the same text.
        a.typeText("!")
        val id = b.blocks()[0].id
        b.select(id, 0, id, 0)
        b.typeText(">> ")
        hub.settle()
        assertEquals(">> Hello from Ada!", a.plainText())
        assertEquals(">> Hello from Ada!", b.plainText())
        assertEquals(a.json(), b.json())

        // Comments and presence travel the same room.
        val thread = a.comments.createThread("Nice", mapOf("block" to id))
        b.sync.setPresence(mapOf("note" to "typing"))
        hub.settle()
        assertEquals(listOf(thread.id), b.comments.threads().map { it.id })
        val seen = a.sync.peers()
        assertEquals(listOf("grace"), seen.map { it.user.id })
        assertEquals("typing", seen[0].state.jsonObject["note"]!!.jsonPrimitive.content)
        assertTrue(peerLists.isNotEmpty())
        assertTrue(PliSyncStatus.SAVING in statuses)

        // Offline: changes are kept and sent when the connection is back.
        b.sync.setOnline(false)
        b.typeText("offline ")
        hub.settle()
        assertEquals(PliSyncStatus.OFFLINE, b.sync.state().status)
        assertFalse(a.plainText().contains("offline"))
        b.sync.setOnline(true)
        hub.settle()
        assertTrue(a.plainText().contains("offline"))
        assertEquals(a.json(), b.json())
        b.sync.stop()
        assertEquals("idle", b.sync.state().room)
        listOf(a, b, seed).forEach { it.close() }
        authority.close()
    }

    @Test
    fun pdfsStayInStep() = runBlocking {
        val seed = PliPdf(user = ada)
        val file = seed.exportPdf()
        val authority = PliAuthority(PliEditorKind.PDF, seed.documentJson())
        val hub = PliMemoryHub()
        hub.serve(authority, "pdf-room")
        val a = PliPdf.open(file, user = ada)
        val b = PliPdf.open(file, user = PliUser("grace", "Grace"))
        a.sync.start(hub.transport(), room = "pdf-room", verifyEverySeconds = 0.0)
        b.sync.start(hub.transport(), room = "pdf-room", verifyEverySeconds = 0.0)
        hub.settle()
        val page = a.pages()[0].id
        a.addNote(page, 50.0, 50.0, "from a")
        b.addComment(page, 80.0, 80.0, "from b")
        hub.settle()
        assertEquals(2, a.annotations(page).size)
        assertEquals(2, b.annotations(page).size)
        assertEquals(1, a.comments.threads().size)
        assertEquals(a.documentJson(), b.documentJson())
        listOf(a, b, seed).forEach { it.close() }
        authority.close()
    }

    @Test
    fun everyEngineStartsInQuickJs() {
        PliDocument().close()
        PliWorkbook().close()
        PliDeck().close()
        PliPdf().close()
    }
}
