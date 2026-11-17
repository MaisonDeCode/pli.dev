package dev.pli

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Base64

/** A file the editor made, such as the DOCX from File > Download. */
class PliDownload(val name: String, val mimeType: String, val data: ByteArray)

/**
 * The editor on screen, seen from your app.
 *
 * [PliEditor] shows the full Pli editor: menus, toolbar, pages, tables, comments and the rest. A controller is how your app talks
 * to it: open a document, hear about changes, ask for the document back or as a file.
 *
 * ```kotlin
 * val editor = remember { PliEditorController(json = savedJson) }
 * editor.onChange = { json -> file.writeText(json) }
 *
 * PliEditor(editor, Modifier.fillMaxSize().imePadding())   // in a composable
 * val docx = editor.exportDocx()                           // from a coroutine
 * ```
 *
 * The editor itself runs in a web view, from one HTML file inside this module, so it needs nothing from the network. Call everything
 * here on the main thread.
 */
class PliEditorController(json: String? = null, readOnly: Boolean = false) {
    private var startJson: String? = json
    private var startReadOnly: Boolean = readOnly
    private var webView: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private val waiting = HashMap<Int, CompletableDeferred<String>>()
    private var nextId = 1

    private val _isReady = MutableStateFlow(false)

    /** True once the editor has loaded and the document is open in it. */
    val isReady: StateFlow<Boolean> = _isReady

    private val _latestJson = MutableStateFlow<String?>(null)

    /** The document as of the last change you were told about: the JSON `PliDocument(json = …)` opens. Null until something changes. */
    val latestJson: StateFlow<String?> = _latestJson

    /** Called a moment after each edit, with the whole document as JSON, so you can save it. */
    var onChange: ((String) -> Unit)? = null

    /** Called with each file File > Download makes. Without it, [PliEditor] asks the person where to save the file. */
    var onDownload: ((PliDownload) -> Unit)? = null

    /** Called when the editor can't do something, such as open a document that isn't one. */
    var onError: ((String) -> Unit)? = null

    /** Replaces the document in the editor. Pass null for an empty one. */
    fun load(json: String?) {
        startJson = json
        if (_isReady.value) run("pliHost.load(${literal(json)})")
    }

    /** Turns editing off or on. */
    fun setReadOnly(readOnly: Boolean) {
        startReadOnly = readOnly
        if (_isReady.value) run("pliHost.setReadOnly($readOnly)")
    }

    /** The document as it is now, as JSON. */
    suspend fun currentJson(): String = call("json")

    /** The document as a .docx file. */
    suspend fun exportDocx(): ByteArray = Base64.getDecoder().decode(call("exportDocx"))

    suspend fun exportMarkdown(): String = call("exportMarkdown")

    suspend fun exportHtml(): String = call("exportHtml")

    /** The document as it is now, opened in the engine, to read or change through [PliDocument]'s methods. Close it when you are done. */
    suspend fun document(): PliDocument = PliDocument(json = currentJson())

    // Plumbing.

    private suspend fun call(name: String): String {
        if (!_isReady.value) throw PliException("not_ready", "The editor hasn't loaded yet")
        val answer = CompletableDeferred<String>()
        val id = nextId++
        waiting[id] = answer
        run("pliHost.call($id, ${literal(name)}, \"\")")
        return answer.await()
    }

    private fun run(script: String) {
        main.post { webView?.evaluateJavascript(script, null) }
    }

    /** A string as JavaScript source: quoted, with what needs escaping escaped. */
    private fun literal(value: String?): String = if (value == null) "null" else JsonPrimitive(value).toString()

    /** Connects a web view that shows the editor page. [PliEditor] does this for you. */
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun attach(view: WebView) {
        webView = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.addJavascriptInterface(Bridge(), "PliAndroid")
        // In a debuggable app, the editor's console goes to Logcat (tag "PliEditor") and chrome://inspect can open it.
        if (view.context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
            view.webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.d("PliEditor", "${message.message()} (${message.sourceId().takeLast(40)}:${message.lineNumber()})")
                    return true
                }
            }
        }
        val page = view.context.assets.open("pli-editor.html").use { it.readBytes().toString(Charsets.UTF_8) }
        view.loadDataWithBaseURL("https://pli.invalid/", page, "text/html", "utf-8", null)
    }

    /** Lets go of the web view. */
    fun detach() {
        webView?.removeJavascriptInterface("PliAndroid")
        webView = null
        _isReady.value = false
    }

    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(message: String) {
            main.post { receive(message) }
        }
    }

    private fun receive(message: String) {
        val body = runCatching { Json.parseToJsonElement(message).jsonObject }.getOrNull() ?: return
        when (body["type"]?.jsonPrimitive?.contentOrNull) {
            "ready" -> {
                _isReady.value = true
                run("pliHost.load(${literal(startJson)})")
                if (startReadOnly) run("pliHost.setReadOnly(true)")
            }
            "change" -> body.text("json")?.let {
                _latestJson.value = it
                onChange?.invoke(it)
            }
            "download" -> {
                val name = body.text("name")
                val mime = body.text("mime")
                val data = body.text("base64")?.let { Base64.getDecoder().decode(it) }
                if (name != null && mime != null && data != null) onDownload?.invoke(PliDownload(name, mime, data)) ?: pendingDownload(PliDownload(name, mime, data))
            }
            "response" -> {
                val id = body["id"]?.jsonPrimitive?.intOrNull ?: return
                val answer = waiting.remove(id) ?: return
                if (body["ok"]?.jsonPrimitive?.booleanOrNull == true) answer.complete(body.text("value") ?: "")
                else answer.completeExceptionally(PliException("editor", body.text("error") ?: "The editor couldn't answer"))
            }
            "error" -> onError?.invoke(body.text("message") ?: "The editor reported an error")
        }
    }

    private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

    /** Set by [PliEditor], which can ask where to save a file. */
    internal var pendingDownload: (PliDownload) -> Unit = {}
}

/**
 * The full Pli editor, in Jetpack Compose. It is the same editor as the JavaScript package's `PliDocument`, running in a web view.
 * Give it `Modifier.imePadding()` (and edge-to-edge insets as your app needs) so the keyboard doesn't cover it.
 *
 * The shortest way to use it keeps the document in a string you own:
 *
 * ```kotlin
 * var document by remember { mutableStateOf(saved ?: "") }     // a saved document, or empty for a new one
 * PliEditor(json = document, onJsonChange = { document = it }, modifier = Modifier.fillMaxSize().imePadding())
 * ```
 *
 * For more (saving to a file, exporting, reading the document with [PliDocument]), make a [PliEditorController] and pass it.
 */
@Composable
fun PliEditor(json: String, onJsonChange: (String) -> Unit, modifier: Modifier = Modifier, readOnly: Boolean = false) {
    val controller = remember { PliEditorController(json = json.ifEmpty { null }, readOnly = readOnly) }
    val latest by controller.latestJson.collectAsState()
    DisposableEffect(controller) {
        controller.onChange = onJsonChange
        onDispose { controller.onChange = null }
    }
    // Something other than the editor changed the string: open it.
    LaunchedEffect(json) {
        if (json != latest && json != "") controller.load(json)
    }
    LaunchedEffect(readOnly) { controller.setReadOnly(readOnly) }
    PliEditor(controller, modifier)
}

/** The editor for a [PliEditorController], as a composable. */
@Composable
fun PliEditor(controller: PliEditorController, modifier: Modifier = Modifier) {
    val context: Context = LocalContext.current
    var offered by remember { mutableStateOf<PliDownload?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val file = offered
        if (uri != null && file != null) context.contentResolver.openOutputStream(uri)?.use { it.write(file.data) }
        offered = null
    }
    DisposableEffect(controller) {
        controller.pendingDownload = { file ->
            offered = file
            save.launch(file.name)
        }
        onDispose { controller.pendingDownload = {} }
    }
    AndroidView(
        modifier = modifier,
        // The web view must fill the space it is given. Left to wrap its content, it sizes itself to the page, and the page, which fills its window, to nothing.
        factory = {
            WebView(it).also { view ->
                view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                controller.attach(view)
            }
        },
        onRelease = { controller.detach() },
    )
}
