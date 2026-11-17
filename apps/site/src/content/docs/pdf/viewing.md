---
title: Viewing
description: How Pli.PDF draws pages, why it uses pdf.js and does not write its own renderer, what it costs in size, how it works offline, how to swap the renderer, and what the viewer does for zoom, layouts, text, search and speed.
---

Showing a PDF is two jobs. One is drawing the page: running its content and painting text, images, colours and shadings. The other is everything around it: layout, zoom, selecting text, finding words, thumbnails, outline, and the annotations people add. Pli.PDF does the second job itself and gives the first to a renderer behind a small interface. The renderer it comes with is [pdf.js](https://mozilla.github.io/pdf.js/).

## Why pdf.js

Pages are drawn by pdf.js, loaded on demand, behind the `PdfRenderer` interface. Pli does not write its own page renderer.

A renderer that matches Acrobat has to do all of this:

- Run the page's drawing instructions with the full graphics state: clipping, blend modes, transparency groups and soft masks.
- Read every kind of font program (TrueType, Type 1, CFF, OpenType, Type 3, CID fonts with character maps) and paint its glyphs, with the standard 14 fonts as stand-ins.
- Handle every colour space (ICC profiles, Lab, indexed, separation, DeviceN), shadings and tiling patterns.
- Decode every image format a PDF may hold: JPEG, JPEG 2000, JBIG2, fax (CCITT), with masks.

That is years of work, and real files are often malformed in odd ways. The pdf.js team has spent years on exactly this. So Pli does the parts that do not need to paint glyphs and keeps them headless:

| Pli does (the engine, no screen needed) | pdf.js does (the viewer only) |
|---|---|
| Parse and write the file, keep every change as JSON | Draw the content of a page onto a canvas |
| Annotations: the JSON, the appearance streams written into the file, the SVG drawn over the page | Give the text of a page with positions, for selecting and finding |
| Forms, page changes, merging, extracting | Read the bookmarks of a file the engine did not read |
| Text with a box for every letter, search, redaction, text and picture replacement | |

pdf.js is also the oracle in Pli's tests: files the engine saves are drawn with it and compared with what was expected.

**Licence.** pdf.js is Apache-2.0, the same as Pli, and you install it yourself as the `pdfjs-dist` package. The package also holds a few files with their own licences: a JPEG 2000 and a JBIG2 decoder under BSD terms, the Liberation fonts under the SIL Open Font Licence, and a colour management module under MIT. Each has its licence file next to it. All of them allow shipping in a product. Keep each licence file with what you ship, and mention them in your own notices.

### Size and offline

Measured on `pdfjs-dist` 5.7.284, the files a viewer ships:

| File | Size | Gzipped | Loaded |
|---|---|---|---|
| `build/pdf.min.mjs`, the library | 435 KB | 124 KB | when the first file opens |
| `build/pdf.worker.min.mjs`, the worker | 1.2 MB | 362 KB | when the first file opens |
| `cmaps/`, 168 character maps | 1.6 MB in all | | one file when a font needs it |
| `standard_fonts/`, 14 fonts | 800 KB in all | | one file when a file names a font it does not embed |
| `wasm/` decoders for JPEG 2000 (252 KB), JBIG2 (105 KB) and colour profiles (89 KB) | 446 KB | | when a page uses one |

(`wasm/` also holds `quickjs-eval.wasm`, 432 KB, which runs scripts inside PDFs. Pli does not turn scripting on, so you can leave it out.) For comparison, `@pli.dev/pdf` as a whole is 381 KB minified and 138 KB gzipped, and `@pli.dev/pdf-react` with the parts of the engine and `@pli.dev/react` it uses is 260 KB and 89 KB gzipped, without React and pdf.js.

Nothing is loaded until a PDF is opened, because Pli imports `pdfjs-dist` only then. A page that never shows a PDF does not pay for it.

**Offline.** pdf.js needs no network once its files are on your server. The worker, the character maps, the standard fonts and the decoders are files you host and point to, and Pli never fetches from a CDN. See [Hosting the pdf.js files](/pdf/getting-started/#hosting-the-pdfjs-files). Put them in a service worker's cache and the viewer works with no connection at all. The one exception is the font pickers of the annotation tools, which by default fetch Google fonts through the `@pli.dev/core` font registry. Pass `annotations={{ fonts: false }}` to `AnnotatedPdf` for a plain list of the standard fonts, or give the registry your own source (see [Fonts](/platform/fonts/)).

**The worker.** pdf.js parses and decodes in a worker, so a big file does not freeze the page. `disableWorker: true` runs it on the page itself, for places where workers do not exist; the page is blocked while it parses. To own the worker, create it yourself and pass `worker`.

### Other renderers

| Renderer | Licence | Why it is not the default |
|---|---|---|
| **PDFium** (Chrome's), compiled to WebAssembly | Permissive | Mature (it is the reader in Chrome), but you build and host the WebAssembly yourself. A good fit if you already ship it |
| **MuPDF** | AGPL, or a paid licence from Artifex | The AGPL's terms reach the whole app that uses it, so it cannot be the default. Fine in an app that takes the commercial licence |
| **A server** that renders pages to pictures | Yours | Nothing to download, but every page is a round trip and needs a connection |
| **A native view** (PDFKit, Android's `PdfRenderer`) | The platform's | The right choice inside a Swift or Kotlin app |

Any of them fits behind the same interface.

### Replacing the renderer

`PliPdf` needs only this from a PDF library:

```ts
interface PdfRenderer {
  open(bytes: Uint8Array, options?: { password?: string }): Promise<RenderedDocument>;
}
interface RenderedDocument {
  readonly pages: number;
  page(index: number): Promise<RenderedPage>;          // 0-based
  outline?(): Promise<RenderedOutlineItem[]>;           // only for `fallbackOutline`
  destroy(): void | Promise<void>;
}
interface RenderedPage {
  readonly width: number;                               // points, not turned
  readonly height: number;
  readonly rotate: number;                              // the file's own /Rotate (information)
  render(options: { canvas: HTMLCanvasElement; scale: number; rotation: number; signal?: AbortSignal }): Promise<void>;
  text(): Promise<TextRun[]>;                           // the text, in page space, in content order
  destroy(): void;
}
```

A renderer has to follow four rules:

1. Draw the page's content only. Do not draw annotations or form fields: Pli draws them from the session, so a change shows at once and nothing is drawn twice. (pdf.js is opened with its annotation mode off.)
2. `rotation` replaces the file's own rotation. The document says how each page is turned (`Page.rotate`), and the renderer draws it that way.
3. Reject with an `AbortError` when `signal` aborts, and stop the work. The viewer cancels pages that scroll away. `abortError()` and `isAbort()` are exported.
4. Draw the page so that it fills the whole canvas, at the size the page has in `width` and `height` (not in some other unit). The canvas is the page's size times `scale`, **rounded up** to whole pixels, and the viewer stretches it over the page's box; every layer over the page (annotations, text, form fields) is scaled by exactly `scale`. A picture drawn `scale` big in a canvas a fraction of a pixel bigger would sit a fraction of a pixel short of the layers, up to a pixel at the far edge. The pdf.js renderer stretches the page by the rounding (pdf.js's `transform` option), and divides the scale by the page's `/UserUnit` (pdf.js would draw a page with a user unit of 2 four times as big as asked for). The renderer tests check the four corners of pages with crop boxes that have an origin, user units and turns.

A `TextRun` is a piece of text with its box in page space (`{ str, x, y, w, h, eol?, dir?, angle? }`). It is what selecting and finding use.

The fake renderer in `@pli.dev/pdf-react/testing` draws labelled rectangles instead of pages, with deterministic text, so tests of your own code need neither a PDF file nor a canvas:

```ts
import { fakeRenderer, testSession } from "@pli.dev/pdf-react/testing";

const session = testSession({ pages: 3 });
const renderer = fakeRenderer({ pages: 3 });
// render <PliPdf session={session} renderer={renderer} /> in your test
// renderer.stats: how many pages were opened, drawn and freed
```

### Why the annotations stay on the page

Page space is points from the top left of the page's visible box. The page's box on the screen, and the transform of every layer over it (annotations, the text layer, form fields, tools), come from the same two numbers in the same render: the page's size in points and the scale (CSS pixels per point), unrounded. A layer has no left, top or size of its own in pixels. When the editor is resized, zoomed or turned, or a panel opens beside it, the viewer reads the new size before the browser paints (a resize is applied in the observer's own callback), so the box and the layers change together and an annotation keeps its place on the page. What floats next to an annotation (its colour bar, the bar over selected text) is placed after the render from the page element as it is then, and again when the pages scroll or anything is resized; it never uses a place measured earlier. The tests (`overlayLock.test.tsx`) check that at every size, zoom, fit mode and turn, while a stroke is being drawn and while a page is still being drawn.

## What Pli draws, what pdf.js draws

Everything on top of the page comes from the session, as SVG in page space: annotations (a `<g>` for each, with highlights multiplied with the page so the text stays readable), the selection handles, other people's selections, and the text layer for selecting. Change an annotation and the overlay changes with it, without drawing the page again. What a saved file looks like in other readers is a separate drawing, made when you save: see [Annotations](/pdf/annotations/#saved-as-real-annotations).

## The viewer

`PliPdf` is the viewer, with the page tools and the File menu. `AnnotatedPdf` and `PdfEditor` are `PliPdf` with more tools added through its extension points, and they take all of its props ([The PDF editor](/pdf/ready-made-ui/)).

```tsx
import { PliPdf } from "@pli.dev/pdf-react";

<PliPdf session={session} renderer={renderer} />
```

| Prop | |
|---|---|
| `session`, `renderer` | The `PdfSession` and the renderer (required) |
| `readOnly` | Look through, search and select only; tools that edit are hidden |
| `defaultZoom` | A number (`1` is 100%), `"fit-width"` (default) or `"fit-page"` |
| `defaultViewMode` | `"continuous"` (default), `"single"` or `"spread"` (two pages, with `spreadCover` the first page alone) |
| `defaultSidebar` | `"thumbnails"` (default), `"outline"`, another tab's id, or `null` for a closed sidebar |
| `fallbackOutline` | Show the outline pdf.js reads when the session has none (for a file the engine did not read) |
| `password` | The password of an encrypted file, for the renderer |
| `theme` | `"auto"` (follows the system), `"light"` or `"dark"`. Pages are always drawn on white paper |
| `onSave(bytes, result)` | Called by Save (the button, the File menu, Ctrl or Cmd with S) with the saved file. The document counts as saved when the promise you return resolves. See [Files](/pdf/files/#in-the-viewer-the-file-menu) |
| `onDownload(bytes, name, mime)`, `onPrint` | Take over downloads (a copy, split files, page pictures) and printing. Without them the browser downloads, and prints from a hidden frame |
| `onOpen(bytes, name)` | Gives the File menu Open PDF and Create PDF from pictures. You make the new session, because the session is yours |
| `warnOnUnload` | Ask the browser to confirm leaving the page while there are unsaved changes |
| `pageTools` | `false` turns off the page tools, the File menu and bookmark editing (thumbnails and outline are then look-only). See [Pages](/pdf/pages/#in-the-viewer) |
| `onPageChange`, `onPagesSelected` | The page shown, and the pages selected in the thumbnails |
| `user`, `users`, `comments`, `room`, `sync`, `storage`, `fonts`, `sourceRetryMs` | People, comments, live editing, your file storage and fonts: see [The PDF editor](/pdf/ready-made-ui/#props) |
| `tools`, `toolbar`, `sidebar`, `rightPanel`, `ribbon`, `formatBar`, `banner`, `pageOverlay` | Places to add your own tools and panels; `AnnotatedPdf` fills them with the annotation tools |
| `menu`, `menus`, `menusChanged`, `actions`, `onShare`, `replace`, `onThemeChange` | The title row, the menu bar (File, Edit, View, Insert, Format, Tools, Help), the Share button and find and replace: see [Toolbar and menus](/pdf/toolbar/) |
| `rightPanelKey` | What `rightPanel` would show now, as a string, or `null` for nothing: the panel opens when it appears. Leave it out for a panel that is always open. See [Layout and panels](/pdf/ready-made-ui/#layout-and-panels) |
| `hostWidth` | The width to lay out for where the browser reports none (tests). Default 1280 |

A `ref` gives a `PliPdfHandle` for hosts that drive the view: `goToPage(page, y?)`, `setZoom(zoom)`, `setViewMode(mode)`, `rotateView(degrees)`, `find(query?)`, `scroller()`, `toggleProperties(open?)` and `toggleSidebar(open?)`.

The page shown is `session.selection.page`. Change it and the view scrolls there. Scroll and it changes. Turning the view (`rotateView`) only changes how you look at the document. Turning a page for good is `session.pages.rotate`, and that is saved.

**Zoom** runs from 10% to 800%, with fit width and fit page. **Layouts** are continuous scrolling, one page at a time, and two pages side by side. Pages of different sizes and turns each take their own size.

**Text.** An invisible text layer over each page makes the text selectable and copyable, with the file's own reading order and line ends. `selectionRects(range)` gives a selection as rectangles in page space, which is how highlights are made from selected text.

**Find** (Ctrl or Cmd with F) searches the text pdf.js gives, matching case and whole words as you choose, marks every match on its page and steps through them. To search without a screen, see [Text, search and redaction](/pdf/text-and-redaction/). It uses Pli's own text reader, which agrees with pdf.js on the test files it was compared on.

**Outline and thumbnails.** The sidebar shows the document's bookmarks and a small picture of every page. The engine reads the bookmarks, so one you add or edit appears at once.

**Keyboard.** Ctrl or Cmd with F finds, plus and minus zoom, Page Down and Page Up change page, and S saves. The annotation tools have their own keys. The whole list is on [Keyboard shortcuts](/pdf/shortcuts/).

### Speed and memory

- Only pages near the view exist. In a continuous layout the viewer mounts the pages from one screen above to one screen below the visible area. The others are empty boxes of the right size, so a 2,000 page file scrolls like a short one.
- Pages are drawn two at a time, the ones in view first, then the ones next to them. A page that scrolls away before it was drawn is cancelled (the renderer is told with an `AbortSignal`).
- A canvas never has more than 16 million pixels. At a high zoom on a large page the picture is drawn at a lower resolution than the screen's, rather than running out of memory.
- The device's pixel ratio is respected, so text is sharp on high density screens.
- Pages nobody is looking at are freed. The viewer keeps up to 24 pages that are out of view and tells the renderer to release the rest. A source file that leaves the document (after you delete its last page) is closed.
- Thumbnails are drawn small and kept, and they queue after the pages in view.

These numbers are the viewer's defaults. The code is `layout.ts`, `renderQueue.ts` and `engine.ts` in `packages/pdf-react/src`.
