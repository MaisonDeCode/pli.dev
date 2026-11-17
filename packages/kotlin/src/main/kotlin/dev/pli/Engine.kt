package dev.pli

import com.dokar.quickjs.QuickJs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

/** What went wrong, as the engine says it: a short [code] such as `invalid_document` or `not_found`, and a [message] for a person. */
class PliException(val code: String, override val message: String) : RuntimeException("$code: $message")

/** Which engine script an editor runs: each has its own, so an app that only opens PDFs doesn't load a spreadsheet. */
enum class PliEditorKind(internal val script: String, internal val editor: String) {
    DOCUMENTS("pli-engine", "docs"),
    SHEETS("pli-sheets", "sheets"),
    DECKS("pli-decks", "decks"),
    PDF("pli-pdf", "pdf"),
}

/** Something that hears the events the engine leaves for a handle. */
internal interface PliEventTarget {
    fun receive(event: JsonObject)
}

/**
 * Runs a Pli engine in QuickJS. One engine holds any number of documents.
 *
 * Everything crosses to JavaScript as text, so nothing can throw from the other side: each answer is
 * `{"ok":true,"value":…}` or `{"ok":false,"error":{…}}`, and an error becomes a [PliException]. An answer may also carry `events`
 * (changes, comments, requests for the app to do something) and `pending`, a task that isn't finished: the engine never calls
 * the app, it leaves events for it.
 */
class PliEngine private constructor(private val kind: PliEditorKind) : AutoCloseable {
    private val js: QuickJs = QuickJs.create(Dispatchers.Default)
    private val routes = ConcurrentHashMap<Int, WeakReference<PliEventTarget>>()
    /** Events for a handle nobody listens to yet (the ones that come with the reply that opens it), kept until somebody does. */
    private val orphans = HashMap<Int, MutableList<JsonObject>>()

    init {
        val script = PliEngine::class.java.getResourceAsStream("/${kind.script}.js")?.readBytes()?.toString(Charsets.UTF_8)
            ?: throw PliException("engine", "${kind.script}.js is missing from the package")
        runBlocking { js.evaluate<Any?>(script, "${kind.script}.js", false) }
    }

    internal fun route(handle: Int, target: PliEventTarget) {
        val waiting = synchronized(orphans) {
            routes[handle] = WeakReference(target)
            orphans.remove(handle) ?: emptyList<JsonObject>()
        }
        for (event in waiting) target.receive(event)
    }

    internal fun unroute(handle: Int) {
        routes.remove(handle)
        synchronized(orphans) { orphans.remove(handle) }
    }

    private fun deliver(events: JsonArray?) {
        for (element in events ?: return) {
            val event = element as? JsonObject ?: continue
            val handle = event["handle"]?.jsonPrimitive?.intOrNull ?: continue
            val target = synchronized(orphans) {
                val found = routes[handle]?.get()
                if (found == null) orphans.getOrPut(handle) { mutableListOf() }.add(event)
                found
            }
            target?.receive(event)
        }
    }

    private class Reply(val ok: Boolean, val value: JsonElement?, val error: JsonObject?, val events: JsonArray?, val pending: Int?, val raw: String)

    private fun callOnce(function: String, arguments: Array<out Any?>): Reply {
        val reply = callRaw(function, arguments)
        deliver(reply.events)
        // Promises settle after a call returns, and what they set going (a comment sent to the app's store) leaves events
        // behind: collect them now rather than at the next call.
        if (function != "pump") deliver(callRaw("pump", emptyArray()).events)
        return reply
    }

    private fun callRaw(function: String, arguments: Array<out Any?>): Reply {
        val expression = "Pli.$function(${arguments.joinToString(", ") { literal(it) }})"
        val text = synchronized(this) { runBlocking { js.evaluate<String>(expression, "call.js", false) } }
        val answer = Json.parseToJsonElement(text).jsonObject
        return Reply(
            ok = answer["ok"]?.jsonPrimitive?.boolean == true,
            value = answer["value"],
            error = answer["error"] as? JsonObject,
            events = answer["events"] as? JsonArray,
            pending = answer["pending"]?.jsonPrimitive?.intOrNull,
            raw = text,
        )
    }

    private fun value(reply: Reply): JsonElement? {
        if (reply.ok) return reply.value?.takeUnless { it is JsonNull }
        throw PliException(reply.error?.get("code")?.jsonPrimitive?.content ?: "engine", reply.error?.get("message")?.jsonPrimitive?.content ?: reply.raw)
    }

    /**
     * Calls a function of the engine with text and numbers, and returns the `value` of its answer. Work the engine hasn't finished
     * (a PDF being written, a request the app is answering) is waited for.
     */
    internal fun call(function: String, vararg arguments: Any?): JsonElement? {
        var reply = callOnce(function, arguments)
        val deadline = System.currentTimeMillis() + 120_000
        while (reply.pending != null) {
            if (System.currentTimeMillis() > deadline) throw PliException("engine", "$function didn't finish")
            Thread.sleep(1)
            reply = callOnce("taskResult", arrayOf(reply.pending))
        }
        return value(reply)
    }

    /** Like [call], for work that waits for the app (storage, comment stores): the caller isn't blocked while it waits. */
    internal suspend fun callAsync(function: String, vararg arguments: Any?): JsonElement? {
        var reply = callOnce(function, arguments)
        val deadline = System.currentTimeMillis() + 600_000
        while (reply.pending != null) {
            if (System.currentTimeMillis() > deadline) throw PliException("engine", "$function didn't finish")
            delay(1)
            reply = callOnce("taskResult", arrayOf(reply.pending))
        }
        return value(reply)
    }

    @Synchronized
    override fun close() {
        js.close()
    }

    private fun literal(value: Any?): String = when (value) {
        null -> "null"
        is String -> JsonPrimitive(value).toString()
        is Boolean, is Int, is Long -> value.toString()
        is Double -> if (value.isFinite()) value.toString() else "null"
        else -> throw IllegalArgumentException("Can't pass ${value::class} to the engine")
    }

    companion object {
        private val engines = ConcurrentHashMap<PliEditorKind, PliEngine>()

        /** The documents engine, which documents share unless given one of their own: starting one costs a few milliseconds and some memory. */
        val shared: PliEngine get() = shared(PliEditorKind.DOCUMENTS)

        /** The engine of an editor, shared by that editor's files. */
        fun shared(kind: PliEditorKind): PliEngine = engines.computeIfAbsent(kind) { PliEngine(it) }

        /** A new engine, for a document that should not share. Close it when done. */
        fun create(kind: PliEditorKind = PliEditorKind.DOCUMENTS): PliEngine = PliEngine(kind)
    }
}
