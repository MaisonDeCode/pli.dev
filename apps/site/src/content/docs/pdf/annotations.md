---
title: Annotations
description: "Highlights, drawings, shapes, text boxes, notes, stamps, signatures, pictures, links and redaction marks in Pli.PDF: the JSON of each, the commands that make them, how they are saved so other readers show them, and the React tools."
---

An annotation is something laid on a page without changing the page's own content: a highlight, a drawing, a sticky note. Pli.PDF keeps them as plain JSON in `session.doc.pages[n].annots`, changes them with undoable operations, and writes them to the file as real PDF annotations with their own appearance, so Acrobat, Preview, Chrome and other readers show them.

```ts
const page = session.doc.pages[0]!.id;
const id = session.annots.addHighlight(page, [{ x: 72, y: 100, w: 150, h: 14 }], { quote: "total due", contents: "Is this right?" });
session.annots.restyle(id, { color: "#a5d6a7" });
session.annots.remove([id]);
session.undo();                       // the highlight is back, green
```

## Page space

Every position is in page space: points (1/72 inch) measured from the top left corner of the page's visible box (its CropBox, or MediaBox without one), with x to the right and y down, before the page is turned. The page's `rotate` only changes how it is shown, so an annotation stays where it was put when a page is turned. PDF itself counts from the bottom left; the engine converts when it reads and writes. A `Rect` is `{ x, y, w, h }` and a point is `[x, y]`.

## The kinds

Every annotation has these (all optional but `id` and `type`):

| | |
|---|---|
| `id` | A string. Annotations read from a file get an id made from the file (`a:main:42`), so everyone who opens the same file agrees on them. New ones get a random id |
| `author`, `authorName` | The `PliUser.id` of who made it, and the name saved in the PDF's `/T` entry that other readers show |
| `created`, `modified` | Milliseconds since 1970 |
| `contents` | The text other readers show: a note's text, or a markup's comment |
| `opacity` | 0 clear to 1 solid |
| `thread` | The id of its [comment thread](/pdf/collaboration/#comments) |
| `locked`, `hidden` | The annotation's Locked and Hidden flags |
| `replies`, `resolved` | Replies and review state as the file has them (read only; see [Replies](#replies-and-comments)) |
| `ref` | The object it was read from (`12 0`). It lets a save replace the annotation in place |

And these, by `type`:

```jsonc
// Marks text. One rectangle for each line. highlight | underline | strikeout | squiggly
{ "type": "highlight", "color": "#ffeb3b", "rects": [{ "x": 72, "y": 100, "w": 150, "h": 14 }], "quote": "total due" }

// Freehand. Each stroke is a list of points.
{ "type": "ink", "strokes": [[[72, 220], [90, 240], [120, 225]]], "stroke": { "color": "#1e88e5", "width": 3 } }

// A rectangle or an ellipse. square | circle
{ "type": "circle", "rect": { "x": 72, "y": 120, "w": 160, "h": 60 }, "stroke": { "color": "#e53935", "width": 2 }, "fill": "#fff59d" }

// A line. Ends: none | arrow | open-arrow | closed-arrow | circle | square | diamond | butt | slash
{ "type": "line", "from": [72, 300], "to": [200, 360], "stroke": { "color": "#e53935", "width": 2, "dash": [4, 2] }, "endEnd": "arrow" }

// A shape of straight lines. polygon (closed) | polyline (open)
{ "type": "polygon", "points": [[250, 300], [300, 300], [275, 350]], "stroke": { "color": "#2e7d32", "width": 1 }, "fill": "#c8e6c9" }

// A text box.
{ "type": "freetext", "rect": { "x": 72, "y": 400, "w": 200, "h": 40 }, "text": "Pay by Friday",
  "style": { "family": "Helvetica", "size": 14, "color": "#222222", "bold": true, "align": "left" }, "fill": "#ffffff" }

// A sticky note: an icon 24 points square at x, y (its top left).
{ "type": "note", "x": 400, "y": 80, "contents": "Remember to check this", "icon": "comment", "color": "#ffd600" }

// A stamp: a standard one by name (Approved, NotApproved, Draft, Final, Confidential, ForPublicRelease, Void, Completed),
// your own label, or a picture.
{ "type": "stamp", "rect": { "x": 380, "y": 400, "w": 120, "h": 44 }, "stamp": { "name": "Approved" } }
{ "type": "stamp", "rect": { ... }, "stamp": { "name": "Custom", "label": "Reviewed", "color": "#1565c0" } }
{ "type": "stamp", "rect": { ... }, "stamp": { "picture": { "src": "data:image/png;base64,..." } } }

// A signature somebody drew, typed or uploaded. It is a picture of a signature, not a cryptographic one.
{ "type": "signature", "rect": { ... }, "mode": "draw", "strokes": [[[2, 30], [20, 5], [40, 28]]], "color": "#0d47a1", "width": 2 }
{ "type": "signature", "rect": { ... }, "mode": "type", "text": "A. Example", "font": "Dancing Script" }
{ "type": "signature", "rect": { ... }, "mode": "image", "picture": { "src": "data:image/png;base64,..." } }

// A picture on the page. PNG or JPEG.
{ "type": "image", "rect": { ... }, "picture": { "src": "data:image/png;base64,...", "width": 600, "height": 300 } }

// A link: to a web address, or to a page of this document and how far down it.
{ "type": "link", "rect": { ... }, "uri": "https://example.com" }
{ "type": "link", "rect": { ... }, "dest": { "page": "p:main:4", "y": 120 } }

// A mark for redaction. It shows a box until the redactions are applied.
{ "type": "redact", "rects": [{ ... }], "fill": "#000000", "overlay": "REDACTED" }
```

Colours are `#rrggbb`. A stroke is `{ color, width, dash? }`, with `dash` as PDF writes it: lengths of dash, gap, dash, gap. The TypeScript types are `Annotation` (the union) and its members `MarkupAnnot`, `InkAnnot`, `ShapeAnnot`, `LineAnnot`, `PolyAnnot`, `FreeTextAnnot`, `NoteAnnot`, `StampAnnot`, `SignatureAnnot`, `ImageAnnot`, `LinkAnnot` and `RedactAnnot`, all exported by `@pli.dev/pdf`.

## Making and changing them

`session.annots` has a builder for each kind. Each one is one undo step and returns the new annotation's id. Every builder takes `options` with `contents`, `opacity`, `id`, `select` (default `true`: select the new annotation) and `merge` (join the last undo step, for drawing that goes on).

| Builder | |
|---|---|
| `addHighlight(page, rects, { type?, color?, quote? })` | `type` is `highlight` (default), `underline`, `strikeout` or `squiggly` |
| `addInk(page, strokes, { color?, width?, dash? })` | |
| `addShape(page, "square" \| "circle", rect, { color?, width?, dash?, fill? })` | |
| `addLine(page, from, to, { color?, width?, dash?, startEnd?, endEnd? })` | |
| `addPoly(page, points, { closed?, color?, width?, dash?, fill? })` | `closed: false` makes a polyline |
| `addFreeText(page, rect, text, { family?, size?, bold?, italic?, color?, align?, fill?, stroke? })` | Helvetica 14 black by default |
| `addNote(page, x, y, text, { icon?, color? })` | A note without a conversation; for one with replies see [Collaboration](/pdf/collaboration/#comments) |
| `addStamp(page, rect, stamp)` | `stamp` is a standard name (`"Approved"`), `{ name, label?, color? }` or `{ picture }` |
| `addSignature(page, rect, signature)` | `{ mode: "draw", strokes }`, `{ mode: "type", text, font? }` or `{ mode: "image", picture }` |
| `addImage(page, rect, picture)` | `picture` is `{ src }`, a PNG or JPEG data URI |
| `addLink(page, rect, target)` | `{ uri }` or `{ page, y? }` |
| `markRedaction(page, rects, { fill?, overlay? })` | See [Text, search and redaction](/pdf/text-and-redaction/) |

The default colours: highlight yellow, underline blue, strikeout and squiggly red, ink black, shapes and lines red, stroke 2 points wide.

To change what exists:

| | |
|---|---|
| `get(id)`, `list(page)`, `at(page, point, tolerance?)`, `bounds(id)` | Read one, read a page's (bottom to top), find the top one at a point, the box around one |
| `update(id, patch)` | Change any properties. `modified` is set |
| `restyle(id, { color?, width?, dash?, fill?, opacity?, size?, family?, bold?, italic?, align? })` | Change what applies to the kind: `fill: null` takes the fill off, `size` and the rest are for text boxes |
| `setText(id, text)` | A text box's text, a typed signature's name, or the comment text |
| `moveBy(ids, dx, dy)`, `resize(id, rect)` | Move several; stretch one so that what covered its box covers `rect` |
| `reorder(id, after)`, `bringToFront(id)`, `sendToBack(id)` | Drawing order |
| `remove(ids)` | |
| `add(page, annotation)` | Any annotation as JSON; the builders use it |

`moveBy`, `resize`, `update` and `restyle` take `{ merge: true }` to join the last undo step, so a drag is one step however many moves it has.

```ts
const note = session.annots.addNote(page, 400, 80, "Remember to check this");
session.annots.moveBy([note], 20, 0);
session.annots.at(page, [425, 100])?.type;    // "note"
```

## Saved as real annotations

On `save`, each annotation becomes a standard PDF annotation dictionary with an appearance stream that Pli draws itself, so a reader that ignores annotation details still paints it the same:

| Pli | PDF subtype |
|---|---|
| `highlight`, `underline`, `strikeout`, `squiggly` | `/Highlight`, `/Underline`, `/StrikeOut`, `/Squiggly` (highlights multiply with the page, so the text stays dark) |
| `ink`, `square`, `circle`, `line`, `polygon`, `polyline` | `/Ink`, `/Square`, `/Circle`, `/Line`, `/Polygon`, `/PolyLine` |
| `freetext` | `/FreeText` |
| `note` | `/Text` |
| `stamp`, `signature`, `image` | `/Stamp`. A standard stamp keeps its name; a signature keeps what it was made from (strokes or typed text) so Pli can edit it again; a picture is an image in the appearance |
| `link` | `/Link` with a URI or a destination |
| `redact` | `/Redact` |

Only what changed since the file was read is written. Annotations you did not touch stay byte for byte as they were, and a new or changed one goes after them: the original file is kept, which is what keeps [digital signatures valid](/pdf/files/#saving). Pli's own extras (who made it, how a signature was drawn) go in entries with names other readers ignore.

The tests open saved files with pdf.js, pikepdf (qpdf), pypdf and MuPDF, and compare the pixels pdf.js draws with what was expected. Checking by hand in Acrobat, Preview and Chrome is on the [roadmap](/pdf/roadmap/).

### What comes in from other tools

Pli reads annotations that other programs made: all the subtypes in the table above. They become JSON like any other, can be moved, restyled and deleted, and are written back to the same place in the file when you change them. Details a reader has no place for in the JSON (rich text in a text box, a custom appearance) are replaced by Pli's own drawing when you change that annotation. An annotation you leave alone is not rewritten.

Subtypes Pli does not edit (file attachments, carets, sound, movies, 3D, and the like) are kept untouched in the file. They are not in `annots`, and saving does not remove or change them. Form widgets belong to [Forms](/pdf/forms/), and pop-up windows are folded into the annotation they belong to. An annotation that cannot be understood is skipped without an error and stays in the file.

### Pictures

A picture is `{ src }`, where `src` is a data URI (`data:image/png;base64,...` or `image/jpeg`) or a web address. Only PNG and JPEG can be written. A JPEG goes into the file as it is, and a PNG is decoded and stored without loss, with its transparency.

Addresses are fetched when you save. A save looks for pictures whose `src` is not a data URI (the editor's `storage` option makes them: see below), fetches each address once, finds out from the bytes whether it is a PNG or a JPEG (the server's content type is not trusted), and embeds it in the PDF. The session's document is not changed: the save works on a copy with the addresses replaced, so you can save again later.

```ts
// By default the save uses globalThis.fetch. Give your own to add a token, or to read from a private store.
const { bytes, warnings } = await session.saveDetailed({
  fetch: async (url) => {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()) };
  },
});
```

`fetch(url)` returns `{ bytes, mime? }`. If an address cannot be fetched (no network, an error status, or something that is not a PNG or JPEG), the save does not fail: it draws an empty placeholder box where the picture goes and adds a warning that names the address, so the person can fix it and save again. The same fetching applies to the pictures of stamps and signatures, and to pictures put in with [replace picture](/pdf/text-and-redaction/#replace-pictures) (there, a picture that cannot be fetched leaves the old one in place).

If you give the editor a `storage` client, it keeps a picture the person adds as the address your storage gives, and the annotation holds that address. Your storage must be reachable from where the save runs, or give `fetch` an address resolver that is. Without `storage`, the editor embeds pictures as data from the start, and nothing is fetched.

### Fonts for text boxes

Text boxes and typed signatures use the standard fonts (Helvetica, Times, Courier) with no setup, and these draw Western European text. Other characters would be written as `?`; the save warns, and you pass the font file: `session.save({ fonts: { Lora: bytes, "Lora bold": boldBytes } })`. See [Files](/pdf/files/#fonts).

## Replies and comments

A conversation about an annotation is a comment thread, as in the other Pli editors. It is written into the PDF as the annotation's `contents` and as reply notes (`/IRT`) that other readers show as replies. Threads, who may comment and how to put them in your own database are on [Collaboration](/pdf/collaboration/#comments). Replies and review states that were already in a file are read into `replies` and `resolved`, and become threads when you open the file.

## Flatten

`session.save({ flatten: "annotations" })` draws every annotation into its page and removes it, so nobody can move or delete it any more. It writes a new file. Links stay links. An annotation that has no appearance cannot be drawn: it stays, and the save says how many. `flatten: true` does the same for form fields as well (see [Files](/pdf/files/#flatten)).

## Limits

- Only PNG and JPEG pictures can be written (a GIF or WebP address is warned about and drawn as a placeholder).
- A picture in a stamp read from a file becomes a data URI when that is easy (a JPEG as it is, an 8 bit grey or RGB image as PNG); for other pictures the stamp is read without its picture.
- Fonts: text boxes need a font file for anything beyond the standard fonts, as above.
- Rich text (several fonts in one text box) is read as plain text.
- Locked annotations keep the flag. The editor will not move, resize or delete them; the engine's commands do not check it, so your own code can.

## The editor

`PdfEditor` ([The PDF editor](/pdf/ready-made-ui/)) includes these tools. `AnnotatedPdf` is [`PliPdf`](/pdf/viewing/) with only the annotation tools. It has one ribbon of tools, a text bar for text boxes (font, size, bold, italic, colours, alignment, border), the Insert, Edit, View, Format and Tools entries of the [menu bar](/pdf/toolbar/), a properties panel on the right (it opens when something is selected, and from the Properties button: [Layout and panels](/pdf/ready-made-ui/#layout-and-panels)), and Comments and Annotations lists in the sidebar. Pass `annotations={{ … }}` to either with the options below.

```tsx
import { AnnotatedPdf } from "@pli.dev/pdf-react";

<AnnotatedPdf
  session={session}
  renderer={renderer}
  user={{ id: "u_1", name: "Sam" }}
  annotations={{ storage, tools: ["select", "highlight", "ink", "note", "stamp"] }}
/>
```

| Tool | Key | |
|---|---|---|
| Select | V | Click to select, drag to move, drag a handle to resize, drag on empty space to select several |
| Highlight, underline, strikethrough, squiggly | H, U, S, W | Select text, then the mark is made; a small bar over a selection offers them too |
| Pen, eraser | P, E | Draw freehand; drag over annotations to remove them. Over a pen stroke the eraser cuts out only the part you drag over |
| Rectangle, ellipse, line, arrow, polyline, polygon | R, O, L, A, Y, G | Shift keeps a square, a circle or a straight line |
| Text box | T | Click or drag, then type |
| Note | N | Click where it goes, then write the comment |
| Stamp, signature, picture | M, F, I | Standard stamps, a date stamp and your own; a signature drawn, typed or uploaded and kept for next time; a picture from a file, pasted or dropped |
| Link | K | Drag a box, then give an address or a page |
| Redact | X | Drag a box; nothing is removed until you apply the redactions |

The eraser removes any annotation it passes over, but cuts a pen stroke only where it passes. The stroke is split at the erased part into pieces (the same annotation, with the same colour, width and opacity, and more strokes), and a stroke that is erased completely is removed. What is left is shown while you drag, the whole drag is one undo step, and the reach is 5 screen pixels on each side of the pointer (9 for a finger or a pen), plus half the line width. Locked annotations are left alone.

**Align and distribute.** With two or more annotations selected, the properties panel has **Align** buttons (left, centre, right, top, middle, bottom) and, with three or more, **Distribute** buttons (horizontally, vertically). Align lines the annotations up on an edge or a middle line of the box around all of them. Distribute makes the gaps between them equal and keeps the outer two where they are. Locked annotations and text markup (highlights, underlines) stay where they are, and each action is one undo step. Boxes are the drawn boxes, a line's width included. The same buttons work on form fields in [Prepare form](/pdf/forms/#in-the-editor).

The usual keys work: Delete removes, arrows nudge (Shift for 10 points), Ctrl or Cmd with C, X, V, D copy, cut, paste and duplicate, with Z undo and Shift Z redo, and Escape puts the tool down. Each drag, stroke and typing run is one undo step.

`annotations` takes: `tools` (which tools exist), `storage` (a `StorageClient` from `@pli.dev/core`: pictures are uploaded to your storage, and the annotation then holds an address that [the save fetches and embeds](#pictures)), `fonts` (a `FontRegistry`, or `false` for the standard fonts), `stamps`, `popover` and `selectionBar` (the small bars over a selection), `properties` (the right panel, default on), `storageKey` (the prefix for what is kept in the browser: tool styles and saved signatures; `""` keeps nothing), and `onPresence`, which says what the person is doing for [presence](/pdf/collaboration/#people-and-presence). In `PdfEditor`, `AnnotatedPdf` and `PliPdf` the person, `storage`, `fonts` and the room's presence are taken from the props of the same names, so you rarely need to repeat them here.

For your own layout, `useAnnotationKit(session, options)` returns the pieces as props for `PliPdf` and `hostProps` (keyboard, paste and drop) for an element around it. The `AnnotController` behind it is a plain object you can drive from your own buttons.
