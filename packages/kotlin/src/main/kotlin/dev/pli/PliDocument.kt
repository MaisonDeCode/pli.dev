package dev.pli

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64

/**
 * A document you can edit and read, backed by the Pli engine.
 *
 * It edits the way an editor does: there is a selection, [typeText] types at it, [toggleBold] formats it, [undo] undoes the
 * last step. Everything that changes the document is in `Commands.generated.kt` (see [PliCommands]); this file is how it
 * is opened, read and saved.
 *
 * ```kotlin
 * PliDocument(title = "Notes").use { doc ->
 *     doc.typeText("Hello")
 *     doc.setHeading(1)
 *     println(doc.markdown())   // "# Hello\n"
 *     val file: ByteArray = doc.exportDocx()
 * }
 * ```
 *
 * Calls are quick but not free, and block while the engine runs: on Android call them off the main thread. A document may be used
 * from any thread, one call at a time.
 *
 * @param json A saved document ([json] gave it earlier). Without it, a new one is made.
 * @param title The title of a new document.
 * @param user Who is editing: needed for suggestions (tracked changes), and decides who may accept them.
 * @param engine The engine to run in. Documents share one unless given another.
 * @param host What your app provides: a comment store, a storage adapter for pictures, a directory of people.
 * @param live Say so when the document will be shared with `sync.start`: highlights of comments are then ordinary changes that go to everyone.
 */
class PliDocument(
    json: String? = null,
    title: String = "Untitled",
    user: PliUser? = null,
    engine: PliEngine = PliEngine.shared,
    host: PliHost = PliHost(),
    live: Boolean = false,
) : PliEditorCore(engine, host, { PliEditorCore.start(engine, PliEditorKind.DOCUMENTS, "json", json, mapOf("title" to title, "live" to live), host, user) }), PliCommands {
    // Reading.

    /** The document as JSON text, to save and open again with the constructor. */
    fun json(): String = read("document").jsonPrimitive.content
    fun title(): String = read("title").jsonPrimitive.content
    fun plainText(): String = read("plainText").jsonPrimitive.content
    fun markdown(): String = read("markdown").jsonPrimitive.content
    fun html(): String = read("html").jsonPrimitive.content

    /** The blocks in reading order, table cells included. */
    fun blocks(): List<PliBlock> = decode(ListSerializer(PliBlock.serializer()), read("blocks"))
    fun outline(): List<PliOutlineEntry> = decode(ListSerializer(PliOutlineEntry.serializer()), read("outline"))
    fun statistics(): PliStatistics = decode(PliStatistics.serializer(), read("statistics"))
    fun selection(): PliSelection? = read("selection").takeUnless { it is JsonNull }?.let { decode(PliSelection.serializer(), it) }
    fun suggestions(): List<PliSuggestion> = decode(ListSerializer(PliSuggestion.serializer()), read("suggestions"))
    fun styles(): Map<String, PliStyle> = decode(MapSerializer(String.serializer(), PliStyle.serializer()), read("styles"))
    fun state(): PliState = decode(PliState.serializer(), read("state"))

    // Files.

    /** The document as a .docx file. */
    fun exportDocx(): ByteArray = Base64.getDecoder().decode(engine.call("exportDocx", handle)!!.jsonPrimitive.content)

    /** Replaces the document with a .docx file, as one undo step. */
    fun importDocx(data: ByteArray, trackedChanges: PliTrackedChanges? = null): PliImportResult {
        val options = buildJsonObject { if (trackedChanges != null) put("trackedChanges", trackedChanges.wire) }
        return decode(PliImportResult.serializer(), engine.call("importDocx", handle, Base64.getEncoder().encodeToString(data), options.toString())!!)
    }

    // The commands.

    override fun <T> invoke(name: String, vararg args: Any?, read: (JsonElement?) -> T): T {
        val values: JsonArray = buildJsonArray {
            for (arg in args) add(
                when (arg) {
                    null -> JsonNull
                    is String -> JsonPrimitive(arg)
                    is Boolean -> JsonPrimitive(arg)
                    is Int -> JsonPrimitive(arg)
                    is Double -> JsonPrimitive(arg)
                    else -> throw IllegalArgumentException("Can't pass ${arg::class} to $name")
                },
            )
        }
        return read(engine.call("invoke", handle, name, values.toString()))
    }

    private fun read(what: String): JsonElement = engine.call("read", handle, what) ?: JsonNull

    /** A read, as JSON text. */
    internal fun readJson(what: String): String = read(what).toString()

    private fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, element: JsonElement): T = lenient.decodeFromJsonElement(serializer, element)

    private companion object {
        val lenient = Json { ignoreUnknownKeys = true }
    }
}
