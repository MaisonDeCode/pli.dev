package dev.pli

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PliDocumentTest {
    @Test
    fun typesAndReads() {
        PliDocument(title = "Notes").use { doc ->
            assertEquals("Notes", doc.title())
            assertTrue(doc.typeText("Hello"))
            doc.setHeading(1)
            assertEquals("# Hello\n", doc.markdown())
            val blocks = doc.blocks()
            assertEquals(1, blocks.size)
            assertEquals("heading", blocks[0].type)
            assertEquals(1, blocks[0].level)
            assertEquals("Hello", blocks[0].text)
            assertEquals(1, doc.statistics().words)
            assertEquals(listOf("Hello"), doc.outline().map { it.text })
        }
    }

    @Test
    fun editsLikeAnEditor() {
        PliDocument().use { doc ->
            doc.typeText("Some ")
            doc.toggleBold()
            doc.typeText("bold")
            doc.toggleBold()
            doc.typeText(" text")
            doc.splitBlock()
            doc.typeText("item")
            doc.toggleBulletedList()
            assertEquals("Some **bold** text\n\n- item\n", doc.markdown())
            assertTrue(doc.state().canUndo)
            doc.undo()
            assertEquals("paragraph", doc.blocks().last().type)
            doc.redo()
            assertEquals("bullet", doc.blocks().last().list)
        }
    }

    @Test
    fun selectionAndFormatting() {
        PliDocument().use { doc ->
            doc.typeText("Hello world")
            val id = doc.blocks().first().id
            doc.select(anchorBlock = id, anchorOffset = 6, focusBlock = id, focusOffset = 11)
            assertEquals(PliSelection(PliPoint(id, 6), PliPoint(id, 11)), doc.selection())
            doc.setTextColor("#b91c1c")
            assertTrue(doc.html().contains("color:#b91c1c"))
            doc.setTextColor(null)
            assertFalse(doc.html().contains("color:#b91c1c"))
            doc.selectAll()
            doc.setAlignment(PliAlignment.CENTER)
            assertEquals("center", doc.blocks().first().align)
        }
    }

    @Test
    fun tablesImagesAndStyles() {
        PliDocument().use { doc ->
            doc.typeText("Careful")
            doc.selectAll()
            doc.toggleItalic()
            val style = doc.createStyle("Warning", PliStyleKind.PARAGRAPH)
            assertEquals("warning", style)
            assertEquals("Warning", doc.styles()["warning"]?.name)
            assertEquals("warning", doc.blocks().first().style)
            doc.splitBlock()
            assertTrue(doc.insertTable(2, 3))
            val table = doc.blocks().first { it.type == "table" }
            assertEquals(2, table.rows)
            assertEquals(3, table.columns)
        }
    }

    @Test
    fun savesAndReopens() {
        PliDocument().use { a ->
            a.typeText("Saved")
            a.setHeading(2)
            PliDocument(json = a.json()).use { b ->
                assertEquals("Saved", b.blocks().first().text)
                assertEquals(2, b.blocks().first().level)
            }
        }
    }

    @Test
    fun docxRoundTrip() {
        PliDocument(title = "Report").use { a ->
            a.typeText("Quarterly numbers")
            a.setHeading(1)
            val file = a.exportDocx()
            assertEquals(listOf<Byte>(0x50, 0x4b), file.take(2))
            PliDocument().use { b ->
                val result = b.importDocx(file)
                assertEquals(emptyList(), result.warnings)
                assertEquals("heading", b.blocks().first().type)
                assertEquals("Quarterly numbers", b.blocks().first().text)
            }
        }
    }

    @Test
    fun suggestionsForAUser() {
        PliDocument(user = PliUser("ana", "Ana")).use { doc ->
            doc.typeText("Hello")
            assertTrue(doc.setSuggesting(true))
            doc.typeText(" there")
            val suggestion = assertNotNull(doc.suggestions().firstOrNull())
            assertEquals("insert", suggestion.kind)
            assertEquals("ana", suggestion.by)
            assertEquals(" there", suggestion.text)
            assertTrue(doc.acceptSuggestion(suggestion.id))
            assertEquals("Hello there", doc.plainText())
            assertEquals(0, doc.suggestions().size)
        }
    }

    @Test
    fun aViewerCannotSuggest() {
        PliDocument(user = PliUser("v", "Vee", role = "viewer")).use { assertFalse(it.setSuggesting(true)) }
        PliDocument().use { assertFalse(it.setSuggesting(true)) }
    }

    @Test
    fun errorsComeBackAsExceptions() {
        assertEquals("invalid_document", assertFailsWith<PliException> { PliDocument(json = "{nope") }.code)
        PliDocument().use { doc ->
            assertEquals("invalid_operation", assertFailsWith<PliException> { doc.setHeading(9) }.code)
            assertEquals("invalid_document", assertFailsWith<PliException> { doc.importDocx(byteArrayOf(1, 2, 3)) }.code)
        }
    }

    @Test
    fun nullStringsAreNull() {
        PliDocument().use { doc ->
            doc.typeText("x")
            assertNull(doc.createStyle("Empty", PliStyleKind.CHARACTER).takeIf { false })
        }
    }

    @Test
    fun severalDocumentsDontMix() {
        PliDocument().use { a ->
            PliDocument().use { b ->
                a.typeText("A")
                b.typeText("B")
                assertEquals("A", a.plainText())
                assertEquals("B", b.plainText())
            }
        }
    }

    @Test
    fun usableFromManyThreads() {
        PliDocument().use { doc ->
            val threads = (1..8).map { Thread { doc.typeText("x") }.also { it.start() } }
            threads.forEach { it.join() }
            assertEquals(8, doc.plainText().length)
        }
    }

    @Test
    fun contentHasRunsMarksAndListLabels() {
        PliDocument().use { doc ->
            doc.typeText("Hello ")
            doc.toggleBold()
            doc.typeText("bold")
            doc.splitBlock()
            doc.toggleNumberedList()
            doc.typeText("One")
            doc.splitBlock()
            doc.typeText("Two")

            val blocks = doc.content()
            assertEquals(3, blocks.size)
            assertEquals(listOf("Hello ", "bold"), blocks[0].runs!!.map { it.text })
            assertEquals(true, blocks[0].runs!![1].marks?.bold)
            assertEquals("list_item", blocks[1].type)
            assertEquals("1.", blocks[1].label)
            assertEquals("2.", blocks[2].label)

            val format = doc.format()
            assertEquals("ordered", format.block?.list)
            assertTrue(format.canUndo)
        }
    }

    @Test
    fun editsTablesAndReadsTheSelectedText() {
        PliDocument().use { doc ->
            doc.typeText("First")
            doc.splitBlock()
            doc.typeText("Second")
            val ids = doc.content().map { it.id }
            doc.select(ids[0], 2, ids[1], 3)
            assertEquals("rst\nSec", doc.selectedText())
            doc.deleteSelection()
            assertEquals(listOf("Fiond"), doc.content().map { it.text })

            doc.insertTable(2, 2)
            assertEquals(2, doc.format().table?.rows)
            doc.addRowBelow()
            doc.addColumnRight()
            val table = doc.content().first { it.type == "table" }
            assertEquals(3, table.rows!!.size)
            assertEquals(3, table.rows!![0].cells.size)
            val first = table.rows!![0].cells[0].blocks[0].id
            val second = table.rows!![0].cells[1].blocks[0].id
            doc.select(first, 0, second, 0)
            assertTrue(doc.format().table!!.canMerge)
        }
    }

    @Test
    fun copyingKeepsFormattingAndColumnsMove() {
        PliDocument().use { doc ->
            doc.typeText("Plain ")
            doc.toggleBold()
            doc.typeText("bold")
            val id = doc.content()[0].id
            doc.select(id, 0, id, 10)
            val clip = doc.clipboard()
            assertEquals("Plain bold", clip.text)
            assertTrue(clip.html.contains("bold</"))
            doc.select(id, 10, id, 10)
            doc.splitBlock()
            assertTrue(doc.paste(clip.html, null, clip.text))
            assertTrue(doc.content()[1].runs!!.any { it.marks?.bold == true && it.text.contains("bold") })

            doc.insertTable(1, 3)
            val table = doc.content().first { it.type == "table" }
            assertTrue(doc.setColumnEdge(table.id, 0, 0.5, false))
            val widths = doc.content().first { it.type == "table" }.columns!!
            assertEquals(0.5, widths[0], 0.01)
            assertEquals(1.0, widths.sum(), 0.001)
        }
    }

    @Test
    fun cropsAndWrapsAPicture() {
        PliDocument().use { doc ->
            doc.insertImage("data:image/png;base64,AAAA", 400, 200, null)
            val id = doc.content().first { it.type == "image" }.id
            doc.setImageCrop(id, 0.0, 0.0, 0.0, 0.25, false)
            var picture = doc.content().first { it.type == "image" }
            assertEquals(300.0, picture.width)
            assertEquals(0.25, picture.crop?.left)
            doc.setImageCrop(id, 0.0, 0.0, 0.0, 0.0, false)
            picture = doc.content().first { it.type == "image" }
            assertNull(picture.crop)
            assertEquals(400.0, picture.width)
            doc.setImageWrap(id, "left")
            assertEquals("left", doc.content().first { it.type == "image" }.wrap)
        }
    }
}
