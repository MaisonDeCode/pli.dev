---
title: Pli.PDF roadmap
description: What Pli.PDF does today, what needs a check on a real machine, what is still to build, and what is another area of work.
sidebar:
  order: 2
---

Pli.PDF reads, makes and edits PDF files. It is number 6 on the [main roadmap](/roadmap/). The engine and a React editor are built, tested and documented. See [PDF](/pdf/) for the packages.

Everything below was built and tested without Acrobat, Preview or a browser window. Files are checked by reading them back with pdf.js, qpdf (pikepdf), pypdf and MuPDF, and by comparing the pixels pdf.js draws. The editor is tested in a simulated browser that sends pointer, keyboard and drag events by hand. What is left needs a real program, a real device or real files from people, or is a feature that is not built.

## Already done

- [x] Read PDF files (damaged files are repaired, encrypted files open with a password) and write them: an update of the original that keeps its bytes, a new file, an optimised file, and flattening. See [Files](/pdf/files/)
- [x] Annotations: highlight, underline, strikethrough, squiggly, pen, shapes, lines, text boxes, notes, stamps, signatures, pictures, links and redaction marks, saved as real PDF annotations with appearances; pictures kept in your storage are fetched and embedded when saving. See [Annotations](/pdf/annotations/)
- [x] Pages: turn, delete, reorder, insert blank, duplicate, extract, split, merge, pictures to pages, labels and bookmarks, in code and in the editor (thumbnails, organise view, page menu, bookmark editing). See [Pages](/pdf/pages/)
- [x] Forms: read, fill, make and flatten form fields in the engine, and fill them in and prepare them (Prepare form) in the editor. See [Forms](/pdf/forms/)
- [x] Text extraction, search, redaction (a Redact tool, "Redact all matches" in the find bar, and a confirm dialog) and replacing text and pictures, in code and in the editor (click a word and retype it, swap or delete a picture, the Edits tab): see [Text, search and redaction](/pdf/text-and-redaction/)
- [x] A React viewer drawn by pdf.js, which works offline, with thumbnails, outline, text selection, search, zoom and layouts. See [Viewing](/pdf/viewing/)
- [x] `PdfEditor`: the whole editor in one component, with the same title row and menu bar as the other editors (File, Edit, View, Insert, Format, Tools, Help), undo and redo, zoom with fit, full screen (in the menus, with keys; a slim status bar with the page and the zoom; the top toolbar is a `topToolbar` option), a text bar for text boxes and edited text, find and replace, a keyboard help, document properties and word count (see [Toolbar and menus](/pdf/toolbar/)), fonts embedded on every save, read-only mode, light and dark themes, keyboard shortcuts, align and distribute for annotations and form fields, a pen eraser that cuts only the part of a stroke you drag over, and two-finger pinch to zoom. See [The PDF editor](/pdf/ready-made-ui/) and [Keyboard shortcuts](/pdf/shortcuts/)
- [x] Comments (kept in the PDF or your store), people and presence (who is here, their selections and their pointers), live editing, and file storage, through the same shared parts the other editors use. See [Collaboration](/pdf/collaboration/)
- [x] Named versions: save one, see what changed since it, and restore it as one undoable step that reaches everyone in a live session, in code and in the editor's History tab. See [Version history](/pdf/collaboration/#version-history)
- [x] Undo and redo, and a session that scripts can drive. See [How it works](/pdf/concepts/)
- [x] A playground screen with a sample file made by the engine: `pnpm playground`, then PDF. See [Try it](/pdf/ready-made-ui/#try-it)
- [x] Write a PDF from laid-out pages: `toPdf` in `@pli.dev/docs`, used by Pli.Documents for [File > Download > PDF](/documents/guides/exporting/#pdf) and by Pli.Decks
- [x] Swift and Kotlin: [`PliPdf`](/pdf/swift-and-kotlin/) for both, generated from one catalog and tested on JavaScriptCore and QuickJS: pages, annotations, forms, search and redaction, saving back as the original file plus your changes, comments, people, live editing and storage

## Needs a check on your machine

These need a real program, a real browser or device, or real files. Each item says what to look for.

### The viewer

- [ ] Chrome, Safari and Firefox, on a desktop and a phone: text selection and copy line up with the letters (the text layer fits each piece with the canvas's `measureText`), find, zoom and layouts, scrolling a file of a thousand pages, the speed of drawing, and a trackpad pinch and Ctrl with the wheel. The tests use a stand-in for the page canvas; pdf.js with a real `HTMLCanvasElement` is not run
- [ ] Annotations stay on the page, in real browsers (Chrome, Safari, Firefox; a Retina screen and a screen at 125% and 150%): resize the window, drag a sidebar open and shut, open the properties panel, zoom and fit while a drawing is held, and look for any shift of an ink stroke, highlight, text box, stamp or signature against the page's own text. The tests check the numbers the viewer gives the browser (jsdom) and the picture against the layers (pdf.js with a Node canvas); they cannot see how a browser rounds a transformed layer to the screen. Also try a real file with a crop box that has an origin, a user unit other than 1, and a page turned 90 or 270 degrees.
- [ ] A signed signature field in other programs: Acrobat, Preview and a browser's own viewer show a field signed with `forms.sign` as the signature alone (no caption, no mark of their own: the widget is empty and hidden, which MuPDF needed). The checks run pdf.js, MuPDF (PyMuPDF), pypdf, pikepdf and qpdf; Acrobat and Preview have not been tried.
- [ ] The frame in real browsers (Chrome, Safari, Firefox) at editor widths 375, 768 and 1280 (and 600 and 900, either side of the breakpoints), heights 400 and 800, and the playground's default window: the properties panel opens only for a selection and never covers or squeezes the sidebar (its tabs and lists stay reachable); dragging the sidebar edge feels right (no text selected while dragging, the cursor, touch and pen, the 200 and 400 pixel limits, double click); the sidebar drawer, the properties sheet and the bottom sheet open and close by backdrop, Esc and button, without the page behind scrolling; the container-based layout (`data-size`) follows a resize of a small box on a big screen, not only the window; the tools row, form bar, find bar and (with `topToolbar`) the toolbar wrap without clipping or covering the pages; the status bar pill stays centred at the bottom of the pages at 375 and 640 wide, does not hide the scroll bar or the toasts, and its zoom list opens inside a small host; menus, popovers, dialogs and toasts stay inside a small host and in the right order. jsdom lays nothing out: the tests check the structure, the state and the style sheet as text
- [ ] The menu bar, title row and text bar in real browsers (Chrome, Safari, Firefox) at editor widths 375, 640, 768 and 1280: the seven menus wrap instead of clipping; the rounded frame and pills (`--pli-chrome-radius`, `--pli-frame-radius`) look right in light and dark; a menu and its submenus open full width under the bar on a phone and beside it on a desktop, stay inside a small host, and sit above the pages, popovers and the sidebar drawer; the title row's Comments and Share show only their icons on a phone; the tools row, text bar and (with `topToolbar`) toolbar keep one row and scroll sideways at 375 and 640 wide (the wheel, a swipe, the arrow keys; the fade shows at the end that has more; a menu or picker opened from a scrolled bar is not cut off); the text bar sits under the tools row without covering the pages; opening the font list of the text bar while a text box is being typed in keeps the text and applies the font to the box (the tests press the other buttons of the bar, not the font list). jsdom lays nothing out
- [ ] Full screen in Chrome, Safari (an iPhone does not allow it for a page), and Firefox: the editor fills the screen, menus and dialogs still show over it (the top layer), Esc leaves it and the button follows, and the layout follows the new width. The tests stand in for the Fullscreen API
- [ ] Find and replace on real files: in files made by Word, InDesign, LaTeX and scanners, how many matches of common words are replaced and how many are reported as running across two pieces of text (a font change or a justified line often splits a phrase); the replaced text sits on the old baseline in the saved file and the old words cannot be found in Acrobat, Preview and Chrome. The tests use hand-made pages
- [ ] pdf.js in a real build: the worker, character maps, standard fonts and decoders found and loaded from a Vite build and from a webpack 5 build, with the files copied to a public folder as [Get started](/pdf/getting-started/#hosting-the-pdfjs-files) says
- [ ] Two-finger pinch on a real phone and tablet (iOS Safari, Android Chrome): the pages follow the fingers around their middle without the browser zooming the whole page or scrolling by itself (the viewer sets `touch-action: pan-x pan-y` on the pages and stops `touchmove` while two fingers are down), the page does not judder on a large file, one finger still scrolls, and a pinch while the Pen is on drops the stroke and draws nothing. The tests send the pointer events by hand
- [ ] Other people's pointers in two real browsers through a real server: the arrow and the name sit on the page where the other person points at 50%, 100% and 400%, on a turned page and in the two-page layout, they follow smoothly (a pointer is sent every 50 ms at most) and go when the person leaves the pages or closes the tab

### Annotation tools

- [ ] Highlights multiplied with the page look right on the canvas, in light and dark mode
- [ ] Edit text and pictures in Chrome, Safari and Firefox: the editor that opens on a piece of text sits exactly on it (also on a turned page and at 50%, 100% and 400%), its letters match the page's font closely enough that nothing seems to jump, the caret and an input method (IME) work in it, Enter and clicking away keep the text, and the white-box preview hides the old text on a page with a coloured background (the preview cannot show what the file will, which is the old letters cut out and the background left)
- [ ] Pictures: **Replace picture…** opens the system file chooser on a phone and a tablet, and a large JPEG (many megapixels) becomes a data address and a preview without freezing the window
- [ ] The pen eraser cuts a stroke cleanly with a mouse, an Apple Pencil and a finger (the cut ends sit where the pointer crossed, and a quick drag does not skip over a thin stroke); its reach (5 pixels, 9 for a finger) feels right
- [ ] The pen feels right with a mouse, an Apple Pencil and a finger, and a tap and a scroll are told apart on touch (`touch-action` is switched off only while an annotation is selected)
- [ ] The in-place text editor on a page that is turned and zoomed: where the caret is, the stacking over the page, and typing with an input method (IME)
- [ ] A text box with a web font wraps at the same places on screen and in the saved appearance
- [ ] Floating panels, the native `<dialog>` dialogs, focus order and the font picker menus
- [ ] Signature upload: trimming and "remove white" on a real picture (they need a canvas)
- [ ] The small bar over a selection copies to the clipboard, and a real picture file can be pasted and dropped
- [ ] Selecting text on iOS and Android, and a screen reader (VoiceOver, NVDA) through the editor, including the Edit tool's panel and the Edits tab
- [ ] The drawing on screen (SVG) and the saved file look the same side by side in pdf.js, Acrobat and Preview

### Page tools

- [ ] Drag pages in the thumbnails and the organise view, drop PDF and picture files onto them, and open the page menu (right click, long press); on a 375 px screen the menus must become sheets (the tests send the drag events by hand)
- [ ] Print from the File menu in Chrome, Safari and Firefox (the saved PDF is printed from a hidden frame, which each browser handles in its own way), and export pages as PNG and JPEG at 300 dpi from a large page (canvas size limits differ)
- [ ] Download several files at once (split, or page pictures without a ZIP), and leave the page with unsaved changes and the warning on: the browser may ask first, in its own words

### Forms in the editor

- [ ] Fill and prepare a form in Chrome, Safari and Firefox, on a desktop and a phone, at several zooms and with the view turned: the controls sit on the fields and scale with the page, typing keeps the cursor where it was (also with an input method), Tab and Shift with Tab cross pages, comb cells line up with the letters, drop-downs and lists open, and in Prepare form dragging and resizing with a finger and with the handles feels right

### Saved files in other readers

- [ ] Open a file with every kind of annotation, and one with a comment thread and replies, in Acrobat, Preview, Chrome and Firefox, and open a file annotated in Acrobat in Pli: shapes, highlights and stamps drawn the same, notes and replies shown as comments (pdf.js, qpdf, pypdf and MuPDF agree)
- [ ] Open a filled form, a form with new fields and a flattened form in Acrobat, Preview and Chrome, and compare with what pdf.js and MuPDF show
- [ ] Open a redacted file (also one made with "Redact all matches"), a file whose text was retyped with the Edit tool, in another font and size, and a file with a picture swapped or deleted in Acrobat, Preview and Chrome: the old words must not be found or selected, the new text must sit on the old baseline, and the black boxes must be where the words were
- [ ] A signed file in Acrobat: sign it, then add an annotation and fill a form with Pli (an update), and open it again. Is the signature still valid, and what does Acrobat say about the changes?

### Real files and real services

- [ ] A real collection of PDFs: open and save a few hundred files from many producers (scans, tagged files, files with Chinese, Japanese or Korean text, very large files, forms, files with odd fonts, damaged files) and see which do not open, lose text, or save as something other readers reject. The tests use made-up files
- [ ] A real font fetch: save with a `FontRegistry` that fetches from its CDN (a text box, a typed signature and a form field in different families), and open the file in other readers. The tests use a stand-in for the network
- [ ] A real `StorageClient` with signed, expiring addresses: pictures uploaded by the editor are fetched and embedded when saving, and PDF files merged in by one person are found by another through `storageSources`. A signed address that has expired by the time of the save comes out as a placeholder with a warning, which should be checked with your storage
- [ ] Two real browsers editing the same PDF through a real server and a real file store, with one going offline and coming back (the offline bar and the changes sent on return), and one restoring a named version from the History tab while the other keeps editing: both screens end on the same document and the restorer's undo brings the other version back for both

## Still to build

These are real gaps.

- [ ] A native PDF viewer for Swift and Kotlin: a page view over `PliPdf` with the annotation tools, as `PliBlocksView` is for documents. The engine API is built and tested; the view is separate work, and needs checking on a device or simulator

## Not planned, or another area

- Cryptographic signatures. Making and checking them needs keys, certificates and a list of who to trust, which belong to your server or the person's device. Pli.PDF keeps an existing signature valid, and can add an empty signature field for someone else to sign
- OCR. Reading the text of scanned pages
- XFA forms and form JavaScript. The ordinary form fields are read and filled; XFA data is removed when a value changes, and scripts (calculations, validation) are kept in the file but not run
- Redacting parts of JPEG, JPEG 2000, JBIG2 and fax pictures. They cannot be cut without a codec, so a picture of those kinds under a redaction box is removed whole, and the save says so
- Editing Type 3 and scanned-text fonts. `replaceText` refuses text it cannot rewrite faithfully
- PDF from [Pli.Boards](/boards/roadmap/). Documents and [Decks](/decks/roadmap/) already export PDF; Boards is not started
