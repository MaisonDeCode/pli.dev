package dev.pli

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

// Copying, pasting and pictures: what the toolbar's Edit and Insert menus and the text fields' own menus do.

private fun Context.clipboard() = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

/** Puts the selection on the clipboard, as plain text and as HTML that keeps its formatting. Returns false when nothing is selected. */
fun PliDocumentState.copyToClipboard(context: Context): Boolean {
    val content = runCatching { document.clipboard() }.getOrNull() ?: return false
    if (content.text.isEmpty()) return false
    context.clipboard().setPrimaryClip(ClipData.newHtmlText("Pli", content.text, content.html))
    return true
}

/** Copies the selection and removes it. */
fun PliDocumentState.cutToClipboard(context: Context) {
    if (copyToClipboard(context)) deleteSelection()
}

/**
 * Puts what the clipboard has in at the caret, over any selection, keeping formatting from HTML (a web page, Word, Google Docs,
 * another Pli document), tables from a spreadsheet's rows, and pictures as pictures.
 *
 * A clipboard can hold text and a picture together: several items (text in one, a picture's address in another), or one item with both.
 * The text goes in first and the pictures after it, in the order they were copied, unless the HTML already has the picture in it.
 */
fun PliDocumentState.pasteFromClipboard(context: Context) {
    val clip = context.clipboard().primaryClip ?: return
    if (clip.itemCount == 0) return
    var html: String? = null
    var text: String? = null
    val pictures = ArrayList<Uri>()
    for (index in 0 until clip.itemCount) {
        val item = clip.getItemAt(index)
        if (html == null) html = item.htmlText
        if (text.isNullOrEmpty()) text = item.text?.toString()
        val uri = item.uri
        // Only an address that is a picture: the clip says so, or the provider does.
        if (uri != null && (clip.description.hasMimeType("image/*") || context.contentResolver.getType(uri)?.startsWith("image/") == true)) pictures.add(uri)
    }
    // HTML that has its own pictures (`<img>`) doesn't need them again.
    if (html?.contains("<img", ignoreCase = true) == true) pictures.clear()
    if (!html.isNullOrEmpty() || !text.isNullOrEmpty()) {
        perform { paste(html, null, text) }
        focusRequest = selection?.focus?.block
    }
    // Several pictures go in one after another, each after the one before it.
    for (uri in pictures.distinct()) runCatching { insertPicture(context, uri) }
}

/**
 * Puts a picture in at the caret. It is scaled down so the document stays a size that can be saved, and shown at most 480 wide.
 * Reads on the calling thread, so for a very large picture call it from a background thread first or pass a smaller one.
 */
fun PliDocumentState.insertPicture(context: Context, uri: Uri, description: String? = null) {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return
    val longest = 1600
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= longest) sample *= 2
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return
    val scale = minOf(1f, longest.toFloat() / maxOf(decoded.width, decoded.height))
    val bitmap = if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt().coerceAtLeast(1), (decoded.height * scale).toInt().coerceAtLeast(1), true) else decoded
    val png = bitmap.hasAlpha()
    val bytes = ByteArrayOutputStream().also { bitmap.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    val source = "data:image/${if (png) "png" else "jpeg"};base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    val shown = minOf(bitmap.width, 480)
    val height = Math.round(bitmap.height.toFloat() * shown / bitmap.width)
    perform { insertImage(source, shown, height, description) }
    focusRequest = selection?.focus?.block
}

/**
 * Moves the edge between a table's column and the next, as it is dragged. [position] is from the table's left edge, 0 to 1.
 * [merge] is false for the first move of a drag and true after, so the whole drag is one step to undo.
 */
internal fun PliDocumentState.moveColumnEdge(table: String, column: Int, position: Double, merge: Boolean) {
    perform { setColumnEdge(table, column, position, merge) }
}

/** Sets the least height of a table row, in the document's points, as its bottom edge is dragged. */
internal fun PliDocumentState.setRowHeight(table: String, row: Int, points: Double?, merge: Boolean) {
    perform { setRowHeight(table, row, points, merge) }
}

/** Sets the size a picture is shown at, in pixels, as its corner is dragged. */
fun PliDocumentState.setImageSize(image: String, width: Int, height: Int, merge: Boolean = false) {
    perform { setImageSize(image, width, height, merge) }
}

/** Selects a picture, so the picture menu works on it and its corner can be dragged. */
internal fun PliDocumentState.selectPicture(image: String) {
    if (selection?.focus?.block == image) return
    perform { select(image, 0, image, 0) }
}

/** Deletes a picture. */
fun PliDocumentState.deletePicture(image: String) {
    perform { deleteImage(image) }
}

/** Sets how much is cut away from each edge of a picture. Its scale stays, so it gets smaller on the page as an edge is cut. */
internal fun PliDocumentState.setImageCrop(image: String, crop: PliCrop, merge: Boolean) {
    perform { setImageCrop(image, crop.top, crop.right, crop.bottom, crop.left, merge) }
}

/** Starts or ends setting a picture's crop by dragging its edges. */
fun PliDocumentState.setCropping(image: String, on: Boolean) {
    if (on) selectPicture(image)
    setCroppingPicture(if (on) image else null)
}

/** Crops a picture to a shape (width over height), centred on what it shows now, or shows all of it with null. */
fun PliDocumentState.cropPicture(image: String, aspect: Double?) {
    val block = findBlock(image) ?: return
    val width = block.width ?: return
    val height = block.height ?: return
    val was = block.crop ?: PliCrop.None
    if (aspect == null) {
        setImageCrop(image, PliCrop.None, false)
        return
    }
    // The whole picture is the shape to cut from.
    val fullWidth = width / (1 - was.left - was.right)
    val fullHeight = height / (1 - was.top - was.bottom)
    val next = if (aspect < fullWidth / fullHeight) {
        val side = (1 - aspect * fullHeight / fullWidth) / 2
        PliCrop(left = side, right = side)
    } else {
        val side = (1 - fullWidth / aspect / fullHeight) / 2
        PliCrop(top = side, bottom = side)
    }
    setImageCrop(image, next, false)
}

/** Makes text wrap around a picture, which then sits at the left or right edge, or puts it on a line of its own with null. */
fun PliDocumentState.wrapPicture(image: String, side: String?) {
    perform { setImageWrap(image, side) }
}
