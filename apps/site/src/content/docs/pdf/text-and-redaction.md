---
title: Text, search and redaction
description: Read and search the text of a PDF, remove text, pictures and drawings for good, and replace text and pictures, with Pli.PDF. What each one can and cannot do.
---

Pli.PDF reads what a page draws: every piece of text with a box for each letter, and every picture with its box. With that it can search, redact (remove what is under a box so it is not in the saved file any more), and replace text and pictures. All of it runs without a screen: in Node, in a browser or in a native app. The React editor adds a Redact tool with a confirm dialog, **Redact all matches** in the find bar, and the **Edit text and pictures** tool (see [In the editor](#in-the-editor)).

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


```ts
import { openPdf, extractText, searchText } from "@pli.dev/pdf";

const page = extractText(bytes, 0);            // bytes or a PdfFile: { text, lines, runs, images }
page.runs[0]!.glyphs[0];                       // { char: "H", box: { x, y, w, h } }
searchText(bytes, "invoice", { wholeWord: true });   // [{ page, rects, text }]

const session = await openPdf(bytes);
const runs = await session.content.runs(session.doc.pages[0]!.id);
```

Boxes are in page space, like everything else in Pli.PDF: points from the top left of the page's visible box, y growing down, before any turn of the page.

## Reading text

A run is a stretch of text in one font, size and colour on one line, which is what a person would call a piece of text. A run has an id (`r:0:12:0`) made from where it is in the page's content, so everyone who opens the same file gets the same ids. Lines are put in reading order: top to bottom, then left to right. Spaces are added where the gap between two letters is wider than a quarter of the font size.

This was compared with pdf.js and MuPDF on made-up files (several fonts, kerning, letter and word spacing, turned text, a crop box, a turned page, forms drawn inside the page): the same words, in the same places.

It does not find columns, so two columns side by side are read line by line across the page. Right-to-left and vertical text come out in the order they are drawn. Fonts with a predefined Asian code table (`UniJIS-UCS2-H` and the like) give text only when the font also has a `ToUnicode` map. Text in scanned pages is not there unless the file has a text layer; Pli.PDF does not read pictures of text.

## Search

```ts
await session.content.search("account number", { caseSensitive: false });
```

Each hit has a rectangle for every line it covers, so a phrase that wraps gives two. `regex: true` takes a JavaScript regular expression; without it, spaces in the query match any white space, line breaks too.

## Redaction

Mark what to remove, look at the marks, then apply them:

```ts
await session.content.markSearch("4711-0042");                        // one mark per match, one undo step
session.content.markRedaction(pageId, [{ x: 72, y: 120, w: 200, h: 14 }], { fill: "#000000", overlay: "REDACTED" });
session.content.applyRedactions();                                    // one undo step
const bytes = await session.save();                                   // a new file, not an update
```

Until you apply them, marks are `redact` annotations (other readers show them as boxes). Applying turns each into an edit, and the content is cut when the file is saved. The save is always a new file, because an update would keep the old content inside the file.

In the saved file, under every rectangle:

- Text is cut out of the drawing instructions letter by letter, and the rest of the line stays exactly where it was. This includes text that cannot be seen (a text layer under a scan) and text in forms drawn inside the page. The page's `/ActualText` and `/Alt` text and the alternative text of its tagged structure are removed too.
- Pictures that are fully covered are removed. A picture that is partly covered is replaced by a copy with the covered pixels set to black (any bit depth, gray, RGB, CMYK, indexed, with its transparency masks). JPEG, JPEG 2000, JBIG2 and fax pictures cannot be cut because this package has no decoder for them: the whole picture is removed, and the save says so.
- Drawings: a line or curve that touches the box is removed whole (a path made of several lines loses only the ones that touch it), and the save says so. A plain rectangle (a table cell, a background) is kept and cut around the box. Clipping paths are left alone.
- Annotations and form fields under the box are removed, with their form field. Notes and comments of your own under a box are removed when you apply.
- A filled box is painted last, with the text you gave in it.

The page gets one new content stream; the old streams, pictures and forms are not written to the new file. Forms drawn on several pages are copied for the page that is redacted, so the other pages keep theirs.

The tests search every object of the saved file (including those inside object streams, with every stream decoded) for the removed words, extract text with pdf.js and MuPDF, and check the pixels of renderings.

It does not change the document information (title, author), bookmarks, form field values, comments on other pages, and the text of metadata. The save warns when text that was removed also appears in the title, the bookmarks, a field or a comment. `session.content.scrubMetadata()` saves a file without the information, XMP metadata, attached files, JavaScript and thumbnails. Pictures drawn by a pattern fill and the content of tiling patterns are not looked into.

## Replace text

```ts
import { defaultFonts } from "@pli.dev/core";

const run = (await session.content.runs(pageId)).find((r) => r.text === "Invoice");
await session.content.replaceText(run!.id, "Credit note");
const { families, text } = await session.content.editFonts();        // what to fetch for the save
const { fonts } = await defaultFonts().pdfFonts(families, { text });
const bytes = await session.save({ fonts });
```

The editor's `fonts` prop does the fetching for you on every save ([The PDF editor](/pdf/ready-made-ui/#fonts)).

When the file is saved, the old letters are cut out as in redaction and the new text is drawn on the same baseline, in the same size and colour. The font is chosen in this order:

1. The font the text had, if it can write every new character. A standard font can write any character it has a code for. An embedded font that holds only the letters used in the file (a subset, the usual case) can only write letters that the page already uses, because the font program is not opened to look for more.
2. An embedded font from the `fonts` you pass to `save` that matches `family` (or the family the run had), if it has every character.
3. The nearest standard PDF font (Helvetica, Times or Courier). The save then warns that the font was replaced, and characters it cannot write come out as `?`.

If the new text is wider than the old, its size is kept and the save says so. `fit: "shrink"` narrows it by up to 30 percent. `session.content.planText(run.id, text, options, fonts)` tells you all of this before you save.

Some text cannot be edited faithfully, and `replaceText` refuses it: text in Type 3 fonts (letters drawn by small programs), invisible text layers (what editing could not show), and vertical writing. `session.content.editableRuns(pageId)` says which runs, and why.

## Find and replace

`replaceAll` replaces every match of a search with other words, as text edits, in one undo step:

```ts
const dry = await session.content.replaceAll("cat", "dog", { dryRun: true });   // count first, change nothing
// { replaced: 3, runs: 2, pages: ["p:main:0"], skipped: { spanning: 0, notEditable: 0 } }
const done = await session.content.replaceAll("cat", "dog", { caseSensitive: false, wholeWord: false });
```

A match is replaced when it lies inside one piece of text of the page (a *run*); each run that changes gets one text edit, exactly as `replaceText` makes it, so everything above about fonts and sizes holds. An earlier edit of the run (and its font, size and colour) is kept and worked on, so replacing again does not undo the first time. The replacement is plain text: `$&` or `$1` mean themselves.

What is not replaced is counted, not guessed: `skipped.spanning` is matches that run across two pieces of text (a font change or a gap between two runs splits a phrase), and `skipped.notEditable` is matches in text that cannot be edited faithfully. `at: { page, x, y }` (page space; `page` is 0-based) replaces only the match under that point, which is how the editor's **Replace** works one match at a time, in any order, on top of what was replaced before.

## Replace pictures

```ts
const [picture] = await session.content.images(pageId);              // ids like "i:Im0", "i:inline1"
await session.content.replaceImage(picture!.id, { src: dataUri });   // or null to remove it
```

The new picture goes into the same box, kept in proportion and centred, or stretched with `fit: "stretch"`. It is a PNG or JPEG data URI, or a web address: an address is fetched when the file is saved and embedded (`SaveOptions.fetch`, by default `globalThis.fetch`; see [Pictures](/pdf/annotations/#pictures)). The old picture is not in the saved file. If the new one is not a PNG or JPEG, or its address cannot be fetched, the old picture is kept and the save warns.

## In the editor

[`PdfEditor`](/pdf/ready-made-ui/) has redaction and editing of text and pictures. `AnnotatedPdf` has redaction only. The edit tool belongs to `PdfEditor`, or to `useContentEditKit` in your own layout.

### Redaction

1. Mark. Choose the Redact tool (key X) and drag a box over what must go, or select text and choose **Mark selected text** in the ribbon's Redaction menu. The mark is a `redact` annotation, drawn as a box with the fill colour and an optional text over it ("REDACTED"; set both in the properties panel). Marks can be moved, resized and deleted like any annotation, and the menu's badge counts them.
2. Mark every match. Open the find bar (Ctrl or ⌘ with F), type the words, and press **Redact all matches** (the box icon next to Close). It marks every match in the whole file, with the find bar's Match case and Whole words switches, in one undo step, and then asks as in step 3. Cancel keeps the marks, so you can look at them and delete the ones you do not want.
3. Apply. **Apply redactions…** (in the Redaction menu) opens a dialog that says how many marks on how many pages will be applied and that it cannot be undone once the file is saved. Confirming calls `session.content.applyRedactions()`: one undo step, and a message says how many notes and comments under the marks were removed too.
4. Save. The content is cut when the file is saved, and the save writes a new file (a signed file loses its signature; the save warns). Download, Save a copy and Print do the same.

Removing the author and other identifying data (`scrub`) is in the Download dialog.

### Edit text and pictures

Choose **Edit text and pictures** in the ribbon (key Q). A faint box appears round every piece of text and every picture of the page, and a stronger one under the pointer.

- Text. Click a piece of text. An editor opens right on it, in the same font, size and colour, turned and zoomed with the page. Type the new text and press Enter (or click away) to keep it. Esc gives it up. An empty text removes the piece. The change is shown on the page at once (a white box over the old text and the new text on it, in the browser's version of the font), and is undone and redone like any change.
- Font, size, colour. While the editor is open, or with the text selected, the text bar under the ribbon sets the font (with the families of the `fonts` prop), size, bold, italic and colour, and the panel on the right has **Shrink to fit**, which narrows text that is wider than the old by up to 30 percent. What you do not change stays as the page has it. **Keep the original text** takes the change away. (Underline, fill and alignment are not there: the text of a page is placed by the file.)
- Find and replace. Ctrl or ⌘ with H (or the replace button of the find bar) opens a **Replace with** row. **Replace** does the match the find bar is on. **Replace all** counts and asks first, and is one undo step. Matches that run across two pieces of text, or are in text that cannot be edited, are reported and left alone ([Toolbar and menus](/pdf/toolbar/#find-and-replace)).
- Keyboard. Tab walks through the pieces of text and pictures of the page in reading order (each is a button with a name such as "Edit text: Invoice"), Enter or Space opens the editor on text or selects a picture, and Enter or Esc in the editor gives the focus back to the same piece.
- Text that cannot be edited (Type 3 fonts, invisible text layers, vertical writing) has a grey box. Pointing at it or clicking it says why, and no editor opens.
- Pictures. Click a picture. The panel offers **Replace picture…** (a PNG or JPEG file), **Delete picture**, and how the new one fits the old one's box: **Keep proportions** or **Stretch to fill**. The page shows the new picture, or an empty box, at once. **Keep the original** takes the change away.
- The Edits tab in the sidebar lists every change waiting for the save, with its page. Click one to go there; the bin button takes one back, and **Remove all edits** takes them all back in one undo step. Under a change the tab says what the save will warn about, before you save: that the new text is wider than the old, or that its font is not in the file and will be replaced by a standard one.
- Saving. A file with edits is always written as a new file: the old text and pictures are cut out of the pages, which an update could not do. The editor says so once after the first save, and always in the Download dialog. A signed file loses its signature. The fonts the new text needs are fetched from the editor's `fonts` prop on every save, like those of text boxes.

The on-page preview differs from the saved file in two ways. The browser's font can be a little different from the font in the file, and a white box hides what was under the old text, such as a coloured background or a picture behind it. The saved file has neither problem, because it cuts the old letters out and leaves what is behind them.

```tsx
import { useState } from "react";
import { PdfEditor, PliPdf, useContentEditKit, type PdfRenderer } from "@pli.dev/pdf-react";
import type { PdfSession } from "@pli.dev/pdf";

// The whole editor has it; leave it out with edit={false}.
export const Everything = ({ session, renderer }: { session: PdfSession; renderer: PdfRenderer }) => <PdfEditor session={session} renderer={renderer} edit={{ fonts: false }} />;

// Or put the pieces in your own layout (the third argument is the id of the tool the viewer has on).
export function Mine({ session, renderer }: { session: PdfSession; renderer: PdfRenderer }) {
  const [tool, setTool] = useState<string | null>(null);
  const edit = useContentEditKit(session, {}, tool);
  return (
    <div style={{ display: "contents" }} {...edit.hostProps}>
      <PliPdf session={session} renderer={renderer} tool={tool} onToolChange={setTool} {...edit.props} toolbar={(view) => edit.group(view)} />
    </div>
  );
}
```

`edit.controller` is a plain `EditController` you can drive: `controller.pending()` lists the changes, `controller.remove(id)` and `removeAll()` take them back, `controller.selected` and `editing` say what is chosen.

## Take edits back

`session.content.removeEdit(editId)` takes one staged edit back (the ids come from `page.edits`, and `replaceText` and `replaceImage` return them), and `session.content.clearEdits(pageId)` takes back all the staged edits of a page, applied redactions included. Undo works on each step. Nothing in the file changes until you save.
