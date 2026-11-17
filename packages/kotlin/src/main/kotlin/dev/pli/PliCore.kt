package dev.pli

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.serializer
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

// What every editor has in common: opening, operations, changes, people, comments, live editing and files. A document, a
// workbook, a deck and a PDF each extend `PliEditorCore`; what is particular to each (its commands, anchors for comments) is
// in `Commands.generated.kt` and the files generated for the other editors.

internal val lenient = Json { ignoreUnknownKeys = true; explicitNulls = false }

/** What can be an argument of an enum: its text on the wire. */
interface PliWire {
    val wire: String
}

/** Anything the app has as an argument, as JSON: text, numbers, booleans, lists, maps, enums and JSON itself. */
fun toJsonElement(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is PliWire -> JsonPrimitive(value.wire)
    is Enum<*> -> JsonPrimitive(value.name.lowercase())
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to toJsonElement(v) })
    is Iterable<*> -> JsonArray(value.map { toJsonElement(it) })
    is Array<*> -> JsonArray(value.map { toJsonElement(it) })
    else -> throw IllegalArgumentException("Can't pass ${value::class} to the engine")
}

/** The JSON text of a value, for the engine. */
internal fun jsonText(value: Any?): String = toJsonElement(value).toString()

/** What a person may do, as [PliUsers] sets it. */
enum class PliRole(val wire: String) {
    /** Reads, and can't comment. */
    VIEWER("viewer"),

    /** Reads and comments. */
    COMMENTER("commenter"),

    /** Edits, comments and moderates comments. */
    EDITOR("editor");

    companion object {
        fun of(wire: String?): PliRole = entries.firstOrNull { it.wire == wire } ?: EDITOR
    }
}

// ---- Comments ----------------------------------------------------------------------------------------------------

@Serializable
data class PliComment(
    val id: String,
    /** The [PliUser.id] of the author. */
    val author: String,
    val body: String,
    /** Milliseconds since 1970. */
    val createdAt: Double,
    val editedAt: Double? = null,
    /** The ids of the people the body mentions with `@Name`. */
    val mentions: List<String>? = null,
)

/**
 * A conversation about one place in a file. What the place is (a text range, a cell, a slide element, a point on a page) is the
 * [anchor], which each editor documents.
 */
@Serializable
data class PliThread(
    val id: String,
    val anchor: JsonElement? = null,
    /** Oldest first; the first starts the thread. */
    val comments: List<PliComment>,
    val resolved: Resolution? = null,
    val createdAt: Double,
) {
    val isResolved: Boolean get() = resolved != null

    @Serializable
    data class Resolution(val by: String, val at: Double)
}

/** One change to a file's comments: the whole vocabulary a store saves and a room carries. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("type")
sealed class PliCommentChange {
    /** The thread this change is about. */
    abstract val threadId: String

    @Serializable
    @SerialName("thread.create")
    data class CreateThread(val thread: PliThread) : PliCommentChange() {
        override val threadId: String get() = thread.id
    }

    @Serializable
    @SerialName("thread.delete")
    data class DeleteThread(override val threadId: String) : PliCommentChange()

    @Serializable
    @SerialName("thread.resolve")
    data class ResolveThread(override val threadId: String, val by: String, val at: Double) : PliCommentChange()

    @Serializable
    @SerialName("thread.reopen")
    data class ReopenThread(override val threadId: String) : PliCommentChange()

    @Serializable
    @SerialName("comment.add")
    data class AddComment(override val threadId: String, val comment: PliComment) : PliCommentChange()

    @Serializable
    @SerialName("comment.edit")
    data class EditComment(override val threadId: String, val commentId: String, val body: String, val at: Double, val mentions: List<String>? = null) : PliCommentChange()

    @Serializable
    @SerialName("comment.delete")
    data class DeleteComment(override val threadId: String, val commentId: String) : PliCommentChange()
}

/** What a comment's author or a moderator may do (the engine decides by role; [PliComments.can] asks). */
enum class PliCommentAction(val wire: String) { COMMENT("comment"), REPLY("reply"), EDIT("edit"), DELETE("delete"), RESOLVE("resolve"), DELETE_THREAD("deleteThread") }

// ---- Live editing ------------------------------------------------------------------------------------------------

/** Someone else in the room. */
@Serializable
data class PliPeer(
    /** This connection's id (not a user id: one person may have several). */
    val client: String,
    val user: PliUser,
    /** What they have said about themselves: a document puts its selection here. */
    val state: JsonElement,
    val seen: Double,
)

@Serializable
enum class PliSyncStatus {
    /** Waiting to join, or to hear back. */
    @SerialName("connecting") CONNECTING,

    /** Everything you did is in the shared document. */
    @SerialName("synced") SYNCED,

    /** You have changes the server hasn't taken yet. */
    @SerialName("saving") SAVING,

    /** Not connected: your changes are kept and sent when you are. */
    @SerialName("offline") OFFLINE,

    /** Reloading the document from the server. */
    @SerialName("resyncing") RESYNCING,
}

@Serializable
data class PliSyncState(
    /** `idle`, `connecting` or `connected`. */
    val room: String = "connected",
    val status: PliSyncStatus,
    /** How many of your changes the server hasn't taken yet. */
    val unsynced: Int = 0,
    val version: Int? = null,
)

/** A change to the document, as the editor's operations (JSON) say it. */
class PliChange(
    /** `local` (yours), `undo`, `redo` or `remote` (someone else's, or a reload). */
    val origin: String,
    /** True when the whole document was replaced (a reload from the server). */
    val reset: Boolean,
    val operations: List<JsonElement>,
    val canUndo: Boolean,
    val canRedo: Boolean,
)

/**
 * A pipe to the other people in a room: all Pli asks of your realtime stack. Carry this JSON text to everyone else who joined the
 * same room (a WebSocket, Socket.io, a Redis channel behind either of them).
 */
interface PliTransport {
    /** Joins [room] and calls [receive] with every message other people send to it. Return when connected. */
    suspend fun connect(room: String, receive: (String) -> Unit)

    /** Sends to everyone else in the room. */
    fun send(json: String)

    /** Leaves the room. */
    fun disconnect()
}

// ---- What the app provides ----------------------------------------------------------------------------------------

/** Who the people are. Comments store only user ids; names and pictures are asked for here. */
interface PliUserDirectory {
    suspend fun lookup(ids: List<String>): List<PliUser>

    /** For @mentions. */
    suspend fun search(query: String): List<PliUser> = emptyList()
}

/** Where comments are kept: a table, an API, Room. [save] is called once per change, in order, and should throw if it couldn't keep it. */
interface PliCommentStore {
    suspend fun load(file: String): List<PliThread>
    suspend fun save(file: String, change: PliCommentChange)
}

/** What a stored file gives back. */
@Serializable
data class PliUpload(
    /** What the document stores for the file: a key or path, not a link that expires. */
    val ref: String,
    /** An address that can be shown right away, if there is one. */
    val url: String? = null,
    val width: Int? = null,
    val height: Int? = null,
)

/** Where files go (S3, Supabase, your own server). A document holds a short reference to each file. */
interface PliStorageAdapter {
    suspend fun upload(data: ByteArray, name: String, type: String): PliUpload

    /** Turns a reference into an address that can be shown, such as a signed URL. Return plain addresses unchanged. */
    suspend fun resolve(ref: String): String = ref
    suspend fun read(ref: String): PliStoredFile = throw PliException("storage", "This storage can't read files back")
    suspend fun delete(ref: String): Unit = throw PliException("storage", "This storage can't delete files")
}

class PliStoredFile(val type: String, val data: ByteArray)

/**
 * What the app provides to a document, workbook, deck or PDF. Each is optional: without a comment store, comments live in the
 * file (or in memory); without storage, pictures are embedded; without a directory, people show as their ids.
 */
data class PliHost(
    val directory: PliUserDirectory? = null,
    val commentStore: PliCommentStore? = null,
    val storage: PliStorageAdapter? = null,
    /** The most a file may be (in bytes), and what kinds (a list such as `image/png`, or `image/` and a star for every picture type). Checked before the adapter is asked. */
    val storageMaxBytes: Int? = null,
    val storageAllowedTypes: List<String>? = null,
) {
    internal val services: List<String>
        get() = listOfNotNull("directory".takeIf { directory != null }, "storage".takeIf { storage != null }, "comments".takeIf { commentStore != null })
}

// ---- Listeners ---------------------------------------------------------------------------------------------------

/** Cancels a listener. */
class PliSubscription internal constructor(private val action: () -> Unit) {
    @Volatile private var done = false

    /** Stops calling the listener. */
    fun cancel() {
        if (done) return
        done = true
        action()
    }
}

internal class PliListeners<T> {
    private val all = CopyOnWriteArrayList<(T) -> Unit>()

    /** Called with true when the first listener arrives and false when the last leaves. */
    var onUsed: ((Boolean) -> Unit)? = null

    fun add(listener: (T) -> Unit): PliSubscription {
        val first = synchronized(this) { all.add(listener); all.size == 1 }
        if (first) onUsed?.invoke(true)
        return PliSubscription {
            val empty = synchronized(this) { all.remove(listener); all.isEmpty() }
            if (empty) onUsed?.invoke(false)
        }
    }

    fun send(value: T) {
        for (listener in all) listener(value)
    }
}

// ---- The editor core ---------------------------------------------------------------------------------------------

/** What a document, a workbook, a deck and a PDF have in common. Subclasses open the file; the commands for each are generated. */
abstract class PliEditorCore internal constructor(
    internal val engine: PliEngine,
    internal var host: PliHost,
    opener: () -> Int,
) : PliEventTarget, AutoCloseable {
    /** The engine's number for this file. */
    val handle: Int = opener()
    internal var transport: PliTransport? = null
    internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var ticker: kotlinx.coroutines.Job? = null
    private val changes = PliListeners<PliChange>()
    private val commentChanges = PliListeners<Pair<String, PliCommentChange>>()
    private val peerChanges = PliListeners<List<PliPeer>>()
    private val syncChanges = PliListeners<PliSyncState>()
    private val resyncs = PliListeners<Pair<String, Int>>()
    private val failures = PliListeners<PliException>()
    @Volatile private var closed = false

    init {
        changes.onUsed = { on -> watch("change", on) }
        commentChanges.onUsed = { on -> watch("comments", on) }
        peerChanges.onUsed = { on -> watch("peers", on) }
        syncChanges.onUsed = { on -> watch("sync", on) }
        engine.route(handle, this)
    }

    private fun watch(what: String, on: Boolean) {
        if (!closed) runCatching { engine.call("watch", handle, what, on) }
    }

    /** Closes the file, freeing what the engine holds for it. */
    override fun close() {
        if (closed) return
        closed = true
        ticker?.cancel()
        scope.cancel()
        engine.unroute(handle)
        engine.call("close", handle)
    }

    // Operations.

    /**
     * Applies operations (the JSON each editor's operations are, the same live editing sends) as one undoable step.
     * With [merge], the step is folded into the one before, so one undo reverts both.
     */
    fun apply(operations: List<JsonElement>, merge: Boolean = false) {
        engine.call("apply", handle, jsonText(operations), if (merge) """{"merge":true}""" else "{}")
    }

    /** Calls a method of the editor's session by name, for what the typed API doesn't cover: `"setCell"`, `"annots.add"`. The arguments and the result are JSON. */
    fun call(method: String, vararg arguments: Any?): JsonElement = engine.call("call", handle, method, jsonText(arguments.toList())) ?: JsonNull

    /** The whole file as JSON text, which the editor's constructor opens again. */
    fun documentJson(): String = engine.call("read", handle, "document")!!.jsonPrimitive.content

    /** What the engine says about the file now: whether there is something to undo or redo, and what each editor adds. */
    fun stateJson(): JsonObject = engine.call("read", handle, "state")!!.jsonObject

    /** The file in a format, as bytes. */
    fun exportFile(format: String, options: Map<String, Any?> = emptyMap()): ByteArray =
        Base64.getDecoder().decode(engine.call("exportFile", handle, format, jsonText(options.filterValues { it != null }))!!.jsonPrimitive.content)

    /** Like [exportFile], for formats that take a moment or wait for the app's storage (a PDF). */
    suspend fun exportFileAsync(format: String, options: Map<String, Any?> = emptyMap()): ByteArray =
        Base64.getDecoder().decode(engine.callAsync("exportFile", handle, format, jsonText(options.filterValues { it != null }))!!.jsonPrimitive.content)

    /** Replaces the file with one in a format. Returns what the editor says about it (warnings). */
    fun importFile(format: String, data: ByteArray, options: Map<String, Any?> = emptyMap()): PliFileImport {
        val base64 = Base64.getEncoder().encodeToString(data)
        return decodeJson(PliFileImport.serializer(), engine.call("importFile", handle, format, base64, jsonText(options.filterValues { it != null }))!!)
    }

    /** Like [importFile], for the formats that are text (CSV). */
    fun importFileText(format: String, text: String, options: Map<String, Any?> = emptyMap()): PliFileImport =
        decodeJson(PliFileImport.serializer(), engine.call("importFile", handle, format, text, jsonText(options.filterValues { it != null }))!!)

    // Plumbing for the generated methods.

    internal fun invokeRaw(name: String, args: Array<out Any?>): JsonElement = engine.call("invoke", handle, name, jsonText(args.toList())) ?: JsonNull

    internal fun <T> decodeJson(serializer: KSerializer<T>, element: JsonElement): T = lenient.decodeFromJsonElement(serializer, element)

    // Hearing about changes.

    /** Calls [listener] after every change to the file: yours, undo and redo, and what other people did. The operations are the JSON live editing sends. */
    fun onChange(listener: (PliChange) -> Unit): PliSubscription = changes.add(listener)

    /** Calls [listener] when something goes wrong in the background (a transport that couldn't connect, a sequencer's error). */
    fun onError(listener: (PliException) -> Unit): PliSubscription = failures.add(listener)

    // Events.

    override fun receive(event: JsonObject) {
        fun text(key: String) = event[key]?.takeUnless { it is JsonNull }?.jsonPrimitive?.contentOrNull
        when (text("type")) {
            "change" -> changes.send(
                PliChange(
                    origin = text("origin") ?: "local",
                    reset = event["reset"]?.jsonPrimitive?.booleanOrNull ?: false,
                    operations = (event["ops"] as? JsonArray)?.toList() ?: emptyList(),
                    canUndo = event["canUndo"]?.jsonPrimitive?.booleanOrNull ?: false,
                    canRedo = event["canRedo"]?.jsonPrimitive?.booleanOrNull ?: false,
                ),
            )
            "comments" -> runCatching { lenient.decodeFromJsonElement(PliCommentChange.serializer(), event["change"]!!) }.onSuccess { commentChanges.send((text("origin") ?: "local") to it) }
            "peers" -> runCatching { lenient.decodeFromJsonElement(ListSerializer(PliPeer.serializer()), event["peers"]!!) }.onSuccess { peerChanges.send(it) }
            "sync" -> syncChanges.send(
                PliSyncState(
                    room = "connected",
                    status = runCatching { lenient.decodeFromJsonElement(PliSyncStatus.serializer(), event["status"]!!) }.getOrDefault(PliSyncStatus.CONNECTING),
                    unsynced = event["unsynced"]?.jsonPrimitive?.intOrNull ?: 0,
                    version = event["version"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.intOrNull,
                ),
            )
            "resync" -> resyncs.send((text("reason") ?: "") to (event["lost"]?.jsonPrimitive?.intOrNull ?: 0))
            "error" -> failures.send(PliException(text("code") ?: "error", text("message") ?: ""))
            "transport.send" -> text("json")?.let { transport?.send(it) }
            "transport.disconnect" -> transport?.disconnect()
            "host" -> {
                val id = event["id"]?.jsonPrimitive?.intOrNull ?: return
                val kind = text("kind") ?: return
                val payload = event["payload"] ?: JsonNull
                scope.launch {
                    try {
                        answer(id, serve(kind, payload), null)
                    } catch (error: PliException) {
                        answer(id, null, error)
                    } catch (error: Throwable) {
                        answer(id, null, PliException("storage", error.message ?: error.toString()))
                    }
                }
            }
        }
    }

    private fun answer(id: Int, result: String?, error: PliException?) {
        if (closed) return
        val failure = error?.let { buildJsonObject { put("code", it.code); put("message", it.message) }.toString() }
        runCatching { engine.call("hostResolve", id, result ?: "null", failure) }
    }

    private suspend fun serve(kind: String, payload: JsonElement): String {
        fun field(name: String) = payload.jsonObject[name]?.takeUnless { it is JsonNull }?.jsonPrimitive?.contentOrNull
        return when (kind) {
            "users.lookup" -> {
                val directory = host.directory ?: throw PliException("unsupported", "No user directory")
                val ids = (payload.jsonObject["ids"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
                lenient.encodeToString(ListSerializer(PliUser.serializer()), directory.lookup(ids))
            }
            "users.search" -> lenient.encodeToString(ListSerializer(PliUser.serializer()), host.directory?.search(field("query") ?: "") ?: emptyList())
            "comments.load" -> lenient.encodeToString(ListSerializer(PliThread.serializer()), host.commentStore?.load(field("file") ?: "") ?: emptyList())
            "comments.save" -> {
                val store = host.commentStore ?: throw PliException("storage", "No comment store")
                store.save(field("file") ?: "", lenient.decodeFromJsonElement(PliCommentChange.serializer(), payload.jsonObject["change"]!!))
                "null"
            }
            "storage.upload" -> {
                val storage = host.storage ?: throw PliException("storage", "No storage")
                val bytes = Base64.getDecoder().decode(field("data") ?: "")
                lenient.encodeToString(PliUpload.serializer(), storage.upload(bytes, field("name") ?: "file", field("type") ?: "application/octet-stream"))
            }
            "storage.resolve" -> JsonPrimitive((host.storage ?: throw PliException("storage", "No storage")).resolve(field("ref") ?: "")).toString()
            "storage.read" -> {
                val file = (host.storage ?: throw PliException("storage", "No storage")).read(field("ref") ?: "")
                buildJsonObject { put("type", file.type); put("data", Base64.getEncoder().encodeToString(file.data)) }.toString()
            }
            "storage.delete" -> {
                (host.storage ?: throw PliException("storage", "No storage")).delete(field("ref") ?: "")
                "null"
            }
            "transport.connect" -> {
                val transport = transport ?: throw PliException("unsupported", "No transport: pass one to sync.start")
                transport.connect(field("room") ?: "") { json -> runCatching { engine.call("transportReceive", handle, json) } }
                "null"
            }
            else -> throw PliException("unsupported", "The app can't do $kind")
        }
    }

    // Shared features.

    /** Who is using the file, and the people it knows. */
    val users: PliUsers get() = PliUsers(this)

    /** Comment threads. */
    val comments: PliComments get() = PliComments(this)

    /** Presence and live editing. */
    val sync: PliSync get() = PliSync(this)

    /** Files, through the storage adapter the file was opened with. */
    val storage: PliStorage get() = PliStorage(this)

    /** Scripts that read and change the file, within the limits you give. */
    val scripts: PliScripts get() = PliScripts(this)

    internal fun commentListeners() = commentChanges
    internal fun peerListeners() = peerChanges
    internal fun syncListeners() = syncChanges
    internal fun resyncListeners() = resyncs

    internal fun startTicking() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                delay(1000)
                runCatching { engine.call("tick") }
            }
        }
    }

    internal fun stopTicking() {
        ticker?.cancel()
        ticker = null
    }

    internal companion object {
        /** Opens a file in the engine and returns its handle. `format` is `json` or a file format; `data` is text for text formats and base64 for the rest. */
        fun start(engine: PliEngine, kind: PliEditorKind, format: String, data: String?, options: Map<String, Any?>, host: PliHost, user: PliUser?): Int {
            val all = LinkedHashMap<String, Any?>(options)
            if (user != null) all["user"] = lenient.encodeToJsonElement(PliUser.serializer(), user)
            all["host"] = host.services
            val storage = LinkedHashMap<String, Any?>()
            host.storageMaxBytes?.let { storage["maxBytes"] = it }
            host.storageAllowedTypes?.let { storage["allowedTypes"] = it }
            if (storage.isNotEmpty()) all["storage"] = storage
            return engine.call("openEditor", kind.editor, format, data, jsonText(all.filterValues { it != null }))?.jsonPrimitive?.intOrNull
                ?: throw PliException("engine", "The engine didn't open a file")
        }
    }
}

/** A typed answer from a generated method. */
internal inline fun <reified T> PliEditorCore.invokeAs(name: String, vararg args: Any?): T = decodeJson(serializer<T>(), invokeRaw(name, args))

internal fun PliEditorCore.invokeUnit(name: String, vararg args: Any?) {
    invokeRaw(name, args)
}

/** What importing a file found. */
@Serializable
data class PliFileImport(
    /** What couldn't be carried over, in plain words. */
    val warnings: List<String> = emptyList(),
)

// ---- People ------------------------------------------------------------------------------------------------------

/** Who is using the file, for comments, suggestions and what the person may do. Pli has no accounts: your app says who the user is. */
class PliUsers internal constructor(private val core: PliEditorCore) {
    /** The person using the file, and what they may do. */
    fun current(): Pair<PliUser?, PliRole> {
        val found = core.engine.call("currentUser", core.handle)!!.jsonObject
        val user = found["user"]?.takeUnless { it is JsonNull }?.let { lenient.decodeFromJsonElement(PliUser.serializer(), it) }
        return user to PliRole.of(found["role"]?.jsonPrimitive?.contentOrNull)
    }

    /** Says who is using the file now. A viewer can't comment; a commenter can comment and reply; an editor can also moderate. */
    fun setCurrent(user: PliUser?, role: PliRole = PliRole.EDITOR) {
        core.engine.call("setUser", core.handle, user?.let { lenient.encodeToString(PliUser.serializer(), it) }, role.wire)
    }

    /** Tells the engine about people you already have (the ones in the room, the authors of comments). */
    fun add(users: List<PliUser>) {
        core.engine.call("addUsers", core.handle, lenient.encodeToString(ListSerializer(PliUser.serializer()), users))
    }

    /** A person by id. One the engine doesn't know yet comes back named by their id, and the directory is asked. */
    fun user(id: String): PliUser = core.decodeJson(PliUser.serializer(), core.engine.call("getUser", core.handle, id)!!)

    /** Finds people by name, for @mentions, through the directory. */
    suspend fun search(query: String): List<PliUser> = core.decodeJson(ListSerializer(PliUser.serializer()), core.engine.callAsync("searchUsers", core.handle, query)!!)
}

// ---- Comments ----------------------------------------------------------------------------------------------------

/**
 * The comments of a file. Changes show at once and are then handed to the comment store; the same changes travel the room when
 * the file is shared.
 */
class PliComments internal constructor(private val core: PliEditorCore) {
    /** The threads now, oldest first. */
    fun threads(): List<PliThread> = core.decodeJson(ListSerializer(PliThread.serializer()), core.engine.call("comments", core.handle)!!)

    /**
     * Starts a thread with its first comment. [anchor] says where: use the editor's own methods (`commentOnRange`,
     * `commentOnSlide`, `addComment`, `commentOnSelection`) when they fit.
     */
    fun createThread(body: String, anchor: Any? = null, mentions: List<String>? = null): PliThread =
        core.decodeJson(PliThread.serializer(), core.engine.call("commentsCreate", core.handle, body, anchor?.let { jsonText(it) }, mentions?.let { jsonText(it) })!!)

    fun reply(thread: String, body: String, mentions: List<String>? = null): PliComment =
        core.decodeJson(PliComment.serializer(), core.engine.call("commentsReply", core.handle, thread, body, mentions?.let { jsonText(it) })!!)

    fun edit(thread: String, comment: String, body: String, mentions: List<String>? = null) {
        core.engine.call("commentsEdit", core.handle, thread, comment, body, mentions?.let { jsonText(it) })
    }

    /** Deletes a comment; deleting the only comment of a thread deletes the thread. */
    fun delete(thread: String, comment: String) {
        core.engine.call("commentsDelete", core.handle, thread, comment)
    }

    fun deleteThread(thread: String) {
        core.engine.call("commentsDelete", core.handle, thread, null)
    }

    fun resolve(thread: String) {
        core.engine.call("commentsResolve", core.handle, thread, true)
    }

    fun reopen(thread: String) {
        core.engine.call("commentsResolve", core.handle, thread, false)
    }

    /** Whether the current user may do this. Use it to hide buttons; the methods check it too. */
    fun can(action: PliCommentAction, thread: String? = null): Boolean = core.engine.call("commentsCan", core.handle, action.wire, thread)?.jsonPrimitive?.booleanOrNull ?: false

    /** Takes in a change made by someone else, such as from your own store's feed. It isn't saved or sent on. */
    fun receive(change: PliCommentChange) {
        core.engine.call("commentsReceive", core.handle, lenient.encodeToString(PliCommentChange.serializer(), change))
    }

    /** Loads the store's threads again, for after a lost connection. */
    suspend fun reload() {
        core.engine.callAsync("commentsReload", core.handle)
    }

    /** Calls [listener] with every change as it shows: yours at once, other people's as they arrive. */
    fun onChange(listener: (origin: String, change: PliCommentChange) -> Unit): PliSubscription = core.commentListeners().add { listener(it.first, it.second) }
}

// ---- Live editing ------------------------------------------------------------------------------------------------

/**
 * Presence and live editing: who else is here, and keeping the file in step with everyone's over your transport and a sequencer
 * (`createAuthority` on your server, or a [PliAuthority] in the app).
 */
class PliSync internal constructor(private val core: PliEditorCore) {
    /**
     * Joins a room. Presence and comments always travel it; the file's own changes do too unless [live] is false.
     * @param room Everyone in the same room sees each other. By default the file's id.
     * @param transport Carries the JSON messages.
     * @param version The version of the shared document the file was loaded at, if you saved it with its version: the server then sends only what happened since.
     * @param verifyEverySeconds How often to check the file against the server's (0 for never).
     */
    fun start(transport: PliTransport, room: String? = null, version: Int? = null, verifyEverySeconds: Double = 30.0, heartbeatSeconds: Double? = null, live: Boolean = true) {
        core.transport = transport
        val options = buildJsonObject {
            put("verifyEvery", verifyEverySeconds * 1000)
            put("live", live)
            if (room != null) put("room", room)
            if (version != null) put("version", version)
            if (heartbeatSeconds != null) put("heartbeat", heartbeatSeconds * 1000)
        }
        core.engine.call("syncStart", core.handle, options.toString())
        core.startTicking()
    }

    fun stop() {
        core.stopTicking()
        core.engine.call("syncStop", core.handle)
    }

    /** Where the room and the file's sync stand now. */
    fun state(): PliSyncState = core.decodeJson(PliSyncState.serializer(), core.engine.call("syncStatus", core.handle)!!)

    /** Tell it the connection was lost or came back. Changes made offline are kept and sent when it is back. */
    fun setOnline(online: Boolean) {
        core.engine.call("syncOnline", core.handle, online)
    }

    /** Throws away this copy and loads the server's. Unsent changes are lost. */
    fun resync() {
        core.engine.call("syncResync", core.handle)
    }

    /** Tells everyone what you are doing now (for a document, the selection goes along; add what you like). */
    fun setPresence(state: Map<String, Any?> = emptyMap()) {
        core.engine.call("setPresence", core.handle, jsonText(state))
    }

    /** The other people here. */
    fun peers(): List<PliPeer> = core.decodeJson(ListSerializer(PliPeer.serializer()), core.engine.call("peers", core.handle)!!)

    fun onPeers(listener: (List<PliPeer>) -> Unit): PliSubscription = core.peerListeners().add(listener)

    fun onState(listener: (PliSyncState) -> Unit): PliSubscription = core.syncListeners().add(listener)

    /** Called when this copy was replaced by the server's, and how many of your changes the server hadn't confirmed. */
    fun onResync(listener: (reason: String, lost: Int) -> Unit): PliSubscription = core.resyncListeners().add { listener(it.first, it.second) }
}

// ---- Files -------------------------------------------------------------------------------------------------------

/** Files, through the storage adapter the file was opened with ([PliHost.storage]). Limits are checked before the adapter is asked. */
class PliStorage internal constructor(private val core: PliEditorCore) {
    suspend fun upload(data: ByteArray, name: String, type: String): PliUpload =
        core.decodeJson(PliUpload.serializer(), core.engine.callAsync("storageUpload", core.handle, name, type, Base64.getEncoder().encodeToString(data))!!)

    /** An address that can be shown for a stored reference. */
    suspend fun resolve(ref: String): String = core.engine.callAsync("storageResolve", core.handle, ref)!!.jsonPrimitive.content

    suspend fun read(ref: String): PliStoredFile {
        val file = core.engine.callAsync("storageRead", core.handle, ref)!!.jsonObject
        return PliStoredFile(file["type"]?.jsonPrimitive?.contentOrNull ?: "application/octet-stream", Base64.getDecoder().decode(file["data"]!!.jsonPrimitive.content))
    }

    suspend fun delete(ref: String) {
        core.engine.callAsync("storageDelete", core.handle, ref)
    }
}

// ---- Scripts -----------------------------------------------------------------------------------------------------

/** What a script may be given. Anything not granted doesn't exist in the script's context. */
enum class PliScriptCapability(val wire: String) { READ("read"), WRITE("write"), COMMENTS("comments"), CREATE("create") }

/**
 * Scripts: a piece of JavaScript that reads the file and changes it through operations, so everything it does is undoable, synced to
 * other people and within the limits you set. One run is one undo step; a run that throws is taken back.
 *
 * ```kotlin
 * val count = book.scripts.run("return Object.keys(ctx.state.sheets[0].cells).length")
 * ```
 *
 * The script is the body of a function of `ctx`: `ctx.state` is the file as JSON, `ctx.apply(operations)` changes it, `ctx.can("write")`
 * asks what was granted. It runs in the engine's own JavaScript world, which has no network and no files, but that is not a barrier
 * against hostile code: run scripts your app wrote or has checked.
 */
class PliScripts internal constructor(private val core: PliEditorCore) {
    /**
     * @param grants What the script may do (read and write by default).
     * @param maxOps The most operations one run may apply (10 000 by default).
     * @param maxMilliseconds The longest a run may take, checked each time it applies something (5 000 by default).
     * @return What the script returned, as JSON.
     */
    fun run(source: String, grants: List<PliScriptCapability>? = null, maxOps: Int? = null, maxMilliseconds: Int? = null): JsonElement {
        val options = buildJsonObject {
            if (grants != null) put("grants", JsonArray(grants.map { JsonPrimitive(it.wire) }))
            if (maxOps != null) put("maxOps", maxOps)
            if (maxMilliseconds != null) put("maxMs", maxMilliseconds)
        }
        return core.engine.call("scriptRun", core.handle, source, options.toString()) ?: JsonNull
    }
}

// ---- A sequencer in the app, and a hub for tests ------------------------------------------------------------------------

/**
 * The sequencer of live editing running in the app: it puts everyone's changes in one order and keeps the document in memory.
 * Use it for sessions between devices when no server is involved, and in tests. For real use, run `createAuthority` over your
 * own store on your server.
 *
 * @param editor Which editor's changes it orders.
 * @param initial The document a room starts from (`documentJson()` of a file), or null for an empty one where the editor has one.
 */
class PliAuthority(editor: PliEditorKind, initial: String? = null) : PliEventTarget, AutoCloseable {
    private val engine = PliEngine.shared(editor)
    private val handle: Int = engine.call("authorityOpen", editor.editor, initial)!!.jsonPrimitive.intOrNull!!

    /** Called with what the sequencer sends to everyone in the room. */
    @Volatile var onSend: ((room: String, json: String) -> Unit)? = null

    init {
        engine.route(handle, this)
    }

    /** Hands it a message from a client in a room (the JSON a transport carried). */
    fun receive(room: String, json: String) {
        engine.call("authorityReceive", handle, room, json)
    }

    override fun receive(event: JsonObject) {
        if (event["type"]?.jsonPrimitive?.contentOrNull == "authority.send") {
            val room = event["room"]?.jsonPrimitive?.contentOrNull ?: return
            val json = event["json"]?.jsonPrimitive?.contentOrNull ?: return
            onSend?.invoke(room, json)
        }
    }

    override fun close() {
        engine.unroute(handle)
        engine.call("authorityClose", handle)
    }
}

/** Rooms in memory, for tests and demos: every transport made by one hub is in the same rooms, and an authority can serve them. */
class PliMemoryHub {
    private val queue: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "pli-hub").apply { isDaemon = true } }
    private val members = HashMap<String, MutableMap<Int, (String) -> Unit>>()
    private val authorities = HashMap<String, PliAuthority>()
    private var nextMember = 0
    private val busy = AtomicInteger()

    /** Lets an authority order the changes of a room. */
    fun serve(authority: PliAuthority, room: String) {
        synchronized(this) { authorities[room] = authority }
        authority.onSend = { r, json -> deliver(r, json, null) }
    }

    /** A transport that joins this hub's rooms. */
    fun transport(): PliTransport = Member()

    /** Waits until every message in flight has been delivered and answered. */
    suspend fun settle() {
        var quiet = 0
        while (quiet < 3) {
            delay(3)
            queue.submit {}.get()
            quiet = if (busy.get() == 0) quiet + 1 else 0
        }
    }

    private fun enqueue(work: () -> Unit) {
        busy.incrementAndGet()
        queue.execute {
            try {
                work()
            } finally {
                busy.decrementAndGet()
            }
        }
    }

    private fun deliver(room: String, json: String, except: Int?) {
        enqueue {
            val receivers = synchronized(this) { members[room].orEmpty().filterKeys { it != except }.values.toList() }
            for (receive in receivers) receive(json)
        }
    }

    private inner class Member : PliTransport {
        private var id = -1
        private var room: String? = null

        override suspend fun connect(room: String, receive: (String) -> Unit) {
            synchronized(this@PliMemoryHub) {
                id = nextMember++
                members.getOrPut(room) { HashMap() }[id] = receive
            }
            this.room = room
        }

        override fun send(json: String) {
            val room = room ?: return
            deliver(room, json, id)
            val authority = synchronized(this@PliMemoryHub) { authorities[room] }
            if (authority != null) enqueue { authority.receive(room, json) }
        }

        override fun disconnect() {
            val room = room ?: return
            synchronized(this@PliMemoryHub) { members[room]?.remove(id) }
            this.room = null
        }
    }
}
