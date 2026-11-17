---
title: The PDF editor
description: "PdfEditor, the React editor for PDF files: viewer, page tools, annotation tools and forms in one component, with its props, fonts, comments and live editing, read-only mode, theming, accessibility and the parts to build your own."
---

`PdfEditor` is a PDF editor for React. It has a viewer with thumbnails, bookmarks and search, page tools (turn, delete, reorder, extract, split, merge), annotation tools (highlight, pen, shapes, text boxes, notes, stamps, signatures, pictures, links, redaction marks), forms (fill in, and prepare a form), and the same menu bar as the other Pli editors (File, Edit, View, Insert, Format, Tools, Help; see [Toolbar and menus](/pdf/toolbar/)). It works on a [`PdfSession`](/pdf/getting-started/) and draws the pages with [pdf.js](/pdf/viewing/#why-pdfjs) behind a small interface you can replace. The document lives in the session, and the editor hands you the bytes when the person saves.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


Install it with `npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist` (it needs `react` and `react-dom` in your app). The playground has a demo in `apps/playground/src/pdf` (see [Try it](#try-it)).

```tsx
import { useEffect, useMemo, useState } from "react";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import "@pli.dev/pdf-react/styles.css";

export function Editor({ url, workerSrc }: { url: string; workerSrc: string }) {
  const renderer = useMemo(() => pdfjsRenderer({ workerSrc }), [workerSrc]);
  const [session, setSession] = useState<PdfSession | null>(null);

  useEffect(() => {
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buffer) => openPdf(new Uint8Array(buffer), { name: "contract.pdf" }))
      .then(setSession);
  }, [url]);

  if (!session) return <p>Loading…</p>;
  return (
    <div style={{ height: "100vh" }}>
      <PdfEditor
        session={session}
        renderer={renderer}
        user={{ id: "u_1", name: "Sam" }}
        onSave={async (bytes) => {
          await fetch(`/files/${session.doc.id}`, { method: "PUT", body: bytes as BodyInit });
        }}
        warnOnUnload
      />
    </div>
  );
}
```

The editor fills its parent, so give the parent a height. [Get started](/pdf/getting-started/#hosting-the-pdfjs-files) shows how to host the files pdf.js needs (the worker, character maps and fonts). Nothing is fetched from a CDN, so the editor works offline once they are on your server.

`PdfEditor` and `FormsPdf` are the same component. The smaller ones are `PliPdf` (the viewer, with page tools) and `AnnotatedPdf` (the viewer with the annotation tools). See [Build your own](#build-your-own).

## What is in it

- **Title row** and **menu bar** on top, as in Pli.Documents, Sheets and Decks. The title row has the document's name (click to rename) with a dot while there are unsaved changes, who else is here when there is a room, **Comments**, your `actions` and **Share** (when you give `onShare`). The menus are File, Edit, View, Insert, Format, Tools and Help. [Toolbar and menus](/pdf/toolbar/) covers them all, with a table of what each editor has and why a function is or is not in a PDF editor.
- **Tools row** under the menu bar: the annotation tools in one row, and the **Edit text and pictures** tool. There is no toolbar above it. Every command the toolbar used to have (Undo and Redo, Print, the sidebar, zoom, fit, layout, turn the view, go to a page, find, full screen, the properties panel, the Form menu, Save) is in the menu bar with its key, and the page and the zoom are in the status bar. `topToolbar` brings the toolbar back.
- **Status bar**: a slim pill at the bottom of the pages. It shows the page the reader is on (**1 / 12**; click it and type a page, Enter goes there, Esc gives up), zoom out, the zoom (**109%**, a list of 10% to 800%, **Fit width**, **Fit page**, **Actual size**), zoom in, and the **Properties** button (with a dot while a panel is waiting). `statusBar={false}` leaves it out.
- **Text bar** under the ribbon, only while there is text to format. For a text box it has font, size, bold, italic, text colour, fill, alignment and border. For text edited with the Edit tool it has font, size, bold, italic and colour.
- **Sidebar** on the left: Thumbnails, Outline (bookmarks), Comments, Annotations and Edits (the text and picture changes waiting for the save). The thumbnails and the **Organise pages** view are the [page tools](/pdf/pages/#in-the-viewer). It can be folded away and dragged wider or narrower. See [Layout and panels](#layout-and-panels).
- **Pages** in the middle, with the text selectable and annotations and form fields drawn on top.
- **Properties panel** on the right for what is selected: colour, line, fill, order, comment, and Align and Distribute when several are selected. While **Prepare form** is on, it shows the properties of the selected form field instead. While the Edit tool is on, it shows the choices for the picture and *Shrink to fit* for text. (The font, size, style and alignment of text are in the text bar.) It is only there when it has something to show. See [Layout and panels](#layout-and-panels).
- **A form bar** above the pages when the file has form fields.
- **Find and replace**: the find bar can replace text (Ctrl or ⌘ with H), with a count, one undo step and a report of what it could not replace. See [Toolbar and menus](/pdf/toolbar/#find-and-replace).

## Layout and panels

The editor is a row: the sidebar, the pages and the properties panel. The pages take whatever room the two panels leave, and the panels never cover each other, so the sidebar's tabs and lists can always be reached.

The properties panel is not always open. It opens by itself when something is selected that it can show: an annotation, a form field in Prepare form, or a text or picture edit. It closes when nothing is selected. Choosing a drawing tool does not open it, because it would cover the page you are about to draw on. Press **Properties** to set how the tool draws.

- Close it with the close button in its header, or with Esc while the focus is inside it. If you close it while something is selected, it stays closed until you select something else.
- Open it by hand with the **Properties** button of the status bar (also View > Show properties panel), or with Alt+Shift+P (Option+Shift+P on a Mac). Opened by hand, it stays open until you close it, even with nothing selected, and shows a short note and how many annotations the document has. The button shows a small dot while something is selected and the panel is closed.
- It remembers your choice. The choice is kept for the document while the editor is open (also if the editor is shown again), and in the browser for the next document.
- A read-only editor has no panel and no button.

The sidebar folds away with the Sidebar button or Alt+Shift+S, and comes back the way it was (its tab and its width). Drag its right edge to change the width (from 200 to 400 pixels, and never more than 40% of the editor), or focus the edge and use Left and Right (16 pixels, or 64 with Shift), Home and End. A double click puts it back to the usual 240 pixels. The tabs show as icons when the sidebar is narrow (their names are in the tooltips), and a row of many tabs scrolls sideways. The tab content scrolls by itself.

Narrow editors. The layout follows the width of the editor itself, not the window, so it also holds when you put the editor in a small box on a big screen.

| Width of the editor | Sidebar | Properties panel |
|---|---|---|
| 900 pixels or more | Next to the pages | Next to the pages; opens by itself |
| 640 to 899 | Next to the pages (never more than 40%) | A sheet over the right edge with a dimmed backdrop. It does not open by itself; the Properties button shows a dot when something is selected. Click the backdrop, press Esc or use the close button to dismiss it |
| Under 640 | A drawer over the left edge, closed to start with. The button is always there; the backdrop and Esc close it | A sheet from the bottom edge. Only one of the drawer and the sheet is open at a time |

The bars (tools row, optional toolbar, text bar, page tools) keep one row and scroll sideways when the editor is narrow, with a fade at the end that has more. The wheel, a swipe, Left and Right and Tab move along them, and the tool you choose scrolls into view. The menu bar, the title row, the form bar and the find bar wrap. On a phone the menus open full width under the bar. The shape of the bars and of the editor's frame (a rounded pill, 20px, a rounded frame) comes from the variables shared with Docs, Sheets and Decks (`--pli-chrome-radius`, `--pli-frame-radius`, ..., or `data-pli-chrome="square"`): see [Shared interface](/platform/shared-ui/#the-shape-of-the-chrome). Menus, popovers and dialogs stay inside the screen; toasts are above them.

Each part is described on its own page: [Viewing](/pdf/viewing/), [Annotations](/pdf/annotations/#the-editor), [Pages](/pdf/pages/#in-the-viewer), [Forms](/pdf/forms/#in-the-editor) and [Files](/pdf/files/#in-the-viewer-the-file-menu). Every key is on [Keyboard shortcuts](/pdf/shortcuts/).

The editor also edits the text and pictures of a page: click text to retype it, swap or delete a picture, and redact every match of a search from the find bar. [Text, search and redaction](/pdf/text-and-redaction/#in-the-editor) explains how these work and what the save does.

## Props

`PdfEditor` takes everything `PliPdf` takes, plus `forms` and `annotations`. Only `session` and `renderer` are required.

The document:

| Prop | |
|---|---|
| `session` | The `PdfSession` to edit |
| `renderer` | A `PdfRenderer`: `pdfjsRenderer({ workerSrc, … })` from `@pli.dev/pdf-react/pdfjs`, or your own ([Viewing](/pdf/viewing/#replacing-the-renderer)) |
| `password` | The password of an encrypted file, for the renderer (the session has its own, given to `openPdf`) |
| `readOnly` | Look through, search, select, print and download; no tools that edit, no filling in. See [Read-only](#read-only) |

Files (see [Files](/pdf/files/#in-the-viewer-the-file-menu))

| Prop | |
|---|---|
| `onSave(bytes, result)` | Called by Save (the button, the File menu, Ctrl or ⌘ with S) with the saved file. The document counts as saved when the promise you return resolves; if it rejects the dot stays and an error is shown. `result.warnings` lists what could not be written exactly |
| `onDownload(bytes, name, mime)` | Takes over every download: a copy, split files, page pictures, form data, a flattened file. Without it the browser downloads |
| `onPrint()` | Takes over printing. Without it the saved file is printed from a hidden frame |
| `onOpen(bytes, name)` | Gives the File menu Open PDF and Create PDF from pictures. You make the new session, because the session is yours |
| `warnOnUnload` | Ask the browser to confirm leaving the page while there are unsaved changes |
| `pageTools` | `false` turns off the page tools, the File menu and bookmark editing (thumbnails and outline are then look-only) |

People and sharing (see [Comments, people and live editing](#comments-people-and-live-editing))

| Prop | |
|---|---|
| `user` | `{ id, name }` of who is editing. Annotations are stamped with it. Taken from `users.current` when left out |
| `users` | A `Users` from `@pli.dev/core`: the people of this window |
| `comments` | `true` turns on comments (needs `users`), or `{ users?, store?, permissions?, onError? }` |
| `room` | A `CollabRoom`. The editor connects it, attaches the comments to it, and disconnects it when it goes away. It says what you are doing and shows who is here |
| `sync` | `true`, or `{ version?, verifyEvery?, onResync? }`: live editing over `room` (needs `room`) |
| `storage` | A `StorageClient` from `@pli.dev/core`: pictures people add (stamps, signatures, images) are uploaded and kept as addresses instead of data. A save fetches and embeds them |
| `sourceRetryMs` | How long to wait before asking again for a file a peer merged in that is not in the store yet (default 1000, doubling to 30 seconds) |
| `onShare()` | Draws the shared **Share** button in the title row and calls this when it is pressed |
| `shareClient` | A `ShareClient` from `@pli.dev/core`: the Share button opens the shared Share dialog for it ([Shared interface](/platform/shared-ui/#sharing)) |
| `history` | A `VersionHistory<PdfDoc, PdfOp>` from `@pli.dev/core` (make one with `pdfVersionHistory(session, { storage, users })`): adds a History tab and File > Version history (the shared panel, [Versions](/platform/versions/)). A restore is one undo step and, with `sync`, reaches everyone ([Version history](/pdf/collaboration/#version-history)) |
| `versions` | A `VersionStorage<PdfDoc>`: the shorter way. The editor makes the history itself with `pdfVersionSupport`, from `users` and the live-editing position. `history` wins when both are given |
| `actions` | More controls at the right end of the title row, before Share (the same prop Documents, Sheets and Decks have) |

Fonts:

| Prop | |
|---|---|
| `fonts` | A `FontRegistry`. The font pickers (the text bar, Prepare form) offer its families, and every write of the file embeds the font files the text uses. See [Fonts](#fonts) |

Tools and kits:

| Prop | |
|---|---|
| `annotations` | Options of the annotation tools, or `false` for the editor without them. Takes `tools` (which exist), `stamps`, `popover` and `selectionBar` (the small bars over a selection), `properties` (the right panel), `storageKey` (the prefix of what is kept in the browser: tool styles and saved signatures; `""` keeps nothing), `onPresence`, and `storage`, `fonts` and `user`, which are taken from the props above when left out. See [Annotations](/pdf/annotations/#the-editor) |
| `edit` | Options of the Edit text and pictures tool (`fonts`: a `FontRegistry`, or `false` for the standard fonts; it follows the `fonts` prop when left out), or `false` to leave the tool, the Edits tab and its panel out. See [Text, search and redaction](/pdf/text-and-redaction/#edit-text-and-pictures) |
| `forms` | Options of the form tools: `onSign(field, widget)` (a signature field was clicked; with the annotation tools in, the signature dialog opens by default and the signature is put inside the field: see [Forms](/pdf/forms/#signing-a-signature-field)), `onFlatten(bytes, { name })`, `download`, `highlight`. See [Forms](/pdf/forms/#in-the-editor) |

Menus and chrome (see [Toolbar and menus](/pdf/toolbar/)):

| Prop | |
|---|---|
| `menu` | `false` leaves out the title row and the menu bar (the name, the people and a File menu are then in the toolbar, which comes back by itself). Default `true` |
| `topToolbar` | Show the top toolbar (sidebar, undo and redo, print, page, zoom, layout, turn, find, full screen, properties, the Form menu, your tools, Save) under the menu bar. Default `false`; on when `menu` is `false`. With it on the status bar is left out (the toolbar has the page box and the zoom) |
| `statusBar` | `false` leaves out the status bar (the page box and the zoom). Default `true` |
| `menus` | Entries for the menus: an object (`{ Tools: [...] }`) adds them to the end of those menus; a function `(base, ctx) => menus` gets the editor's own and returns the ones to show |
| `menusChanged(listener)` | Tells the menus to be read again when something of yours changed (return a function that stops listening) |
| `replace` | Turns find and replace on or off. Default: on while the Edit tool is in and the editor is not read-only |
| `formatBar` | Your own text bar (a node or a function), instead of the editor's |
| `onThemeChange(theme)` | The person chose a theme in View > Theme |

Places to add your own (see [Extension points](#extension-points)):

| Prop | |
|---|---|
| `tools`, `tool`, `onToolChange` | Your tools, added to the built-in ones. `tool` is the active one (controlled), or leave it out and the editor keeps it |
| `toolbar`, `host`, `sidebar`, `rightPanel` | More toolbar content (shown with `topToolbar`), parts that must be on screen with or without a toolbar (dialogs, a file input, live messages), more sidebar tabs, a panel on the right. Yours are added to the editor's, except `rightPanel`, which replaces it |
| `rightPanelKey` | What your `rightPanel` would show now, as a string (the ids of what is selected), or `null` for nothing. The panel opens by itself when it changes to something it has not been closed for, and the Properties button shows a dot while it waits. Leave it out for a panel that always has something to show: it then starts open, and the person can close it and bring it back with the button |
| `ribbon`, `banner` | A row under the menu bar (and the toolbar, when it is on), and a slot between it and the pages. When you give one, it replaces the editor's |
| `findActions(find, view)` | More buttons in the find bar, next to Close. The editor puts "Redact all matches" there; yours replaces it |
| `pageOverlay`, `pageOverlayDom`, `pageOverlayBlend` | SVG, HTML and multiplied SVG drawn in each page, in page space. Added to the editor's |

How it starts and looks:

| Prop | |
|---|---|
| `defaultZoom` | A number (`1` is 100%), `"fit-width"` (default) or `"fit-page"` |
| `defaultViewMode` | `"continuous"` (default), `"single"` or `"spread"` |
| `spreadCover` | In the two-page layout, show the first page alone, as a cover |
| `defaultSidebar` | `"thumbnails"` (default), `"outline"`, another tab's id, or `null` for a closed sidebar (it starts closed when the editor is under 640 pixels wide). What the person chose later wins: the sidebar's state, tab and width are kept per session |
| `theme` | `"auto"` (follows the system), `"light"` or `"dark"`. View > Theme lets the person choose for themselves (`onThemeChange` hears it) |
| `fallbackOutline` | Show the outline pdf.js reads when the session has none (a file the engine did not read) |
| `viewport` | The size to lay out for where the browser reports none (tests, hidden panels). Default 800 by 600 |
| `hostWidth` | The width of the whole editor to lay out for where the browser reports none (tests, hidden hosts). Decides whether the panels are docked, a sheet or a drawer. Default 1280 |
| `className` | Added to the editor's root element |
| `onPageChange(index)`, `onPagesSelected(ids)` | The page shown, and the pages selected in the thumbnails |

A `ref` gives a `PliPdfHandle` for hosts that drive the view: `goToPage(page, y?)`, `setZoom(zoom)`, `setViewMode(mode)`, `rotateView(degrees)`, `find(query?)`, `scroller()`, `toggleProperties(open?)` and `toggleSidebar(open?)`.

## Fonts

Text in a PDF is drawn with a font, and a font that is not one of the 14 standard ones has to be inside the file for another reader to show it. The editor embeds fonts for you when you give it a `FontRegistry`, the same registry the other Pli editors use ([Fonts](/platform/fonts/)).

```tsx
import { createFonts } from "@pli.dev/core";

const fonts = createFonts({ only: ["Inter", "Lora", "Roboto Mono"] });   // or defaultFonts() for all of them

<PdfEditor session={session} renderer={renderer} fonts={fonts} onSave={save} />
```

With `fonts`:

- The font pickers of the text bar (text boxes and edited text), the typed signatures and Prepare form offer the registry's families.
- Every way of writing the file (Save, Download, Save a copy, Print, flatten, extract, split, page pictures) first finds out which families the document uses: text boxes, typed signatures, form fields and staged text edits. It fetches those font files from the registry and passes them to the save as `SaveOptions.fonts`, so the file holds them, cut down to the letters used.
- A family the registry cannot get is not an error. The save draws the nearest standard font, and the warnings dialog lists it ("No font file was given for…"). The same dialog shows any other warning of the save.

Without `fonts` the pickers use the shared default registry (which fetches Google fonts from a CDN), but nothing is embedded, so saved text in other fonts is drawn in a standard font and the save warns. Text in Helvetica, Times and Courier needs nothing. For a plain list with no network, pass `annotations={{ fonts: false }}`. To fetch the files yourself, use `documentFonts(session)` and `registry.pdfFonts(...)` as shown on [Files](/pdf/files/#fonts).

## Comments, people and live editing

These come from `@pli.dev/core` and are switched on by props. [Collaboration](/pdf/collaboration/) covers the server side and how comments are kept. This section covers the editor side, including storage for the PDF files and for pictures.

```tsx
import { useMemo } from "react";
import { CollabRoom, StorageClient, Users, createFonts, socketTransport, type SocketLike, type StorageAdapter } from "@pli.dev/core";
import { openPdf, storageSources, type PdfAnchor, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";

const renderer = pdfjsRenderer({ workerSrc: "/pdfjs/pdf.worker.min.mjs" });
const fonts = createFonts({ only: ["Inter", "Lora"] });

/** One client for the PDF files and the pictures. Your adapter decides where they go. */
export const makeStorage = (adapter: StorageAdapter) =>
  new StorageClient(adapter, { allowedTypes: ["application/pdf", "image/png", "image/jpeg"], maxBytes: 100_000_000 });

/** Everyone opens the SAME bytes, and the PDF files are kept in your storage so that others can fetch them. */
export function openShared(bytes: Uint8Array, documentId: string, storage: StorageClient, user: { id: string; name: string }) {
  return openPdf(bytes, { name: `${documentId}.pdf`, user, sources: storageSources(storage, { key: documentId }) });
}

export function SharedPdf(props: { documentId: string; session: PdfSession; socket: SocketLike; storage: StorageClient; user: { id: string; name: string } }) {
  const { documentId, session, socket, storage, user } = props;
  const users = useMemo(() => new Users(user), [user.id, user.name]);
  const room = useMemo(() => new CollabRoom<PdfAnchor>({ room: documentId, transport: socketTransport(socket), users }), [documentId, socket, users]);

  return (
    <PdfEditor
      session={session}
      renderer={renderer}
      user={user}
      users={users}
      comments                  // threads live in the PDF (the default); pass { store } to keep them in your database
      room={room}               // who is here, what they look at; connected and disconnected by the editor
      sync={{ version: 0 }}     // live editing over the room: this session opened the file as it is
      storage={storage}         // pictures go to your storage and are fetched back when the file is saved
      fonts={fonts}
      onSave={async (bytes) => {
        await fetch(`/files/${documentId}`, { method: "PUT", body: bytes as BodyInit });
      }}
    />
  );
}
```

What each prop does:

- `comments` turns on `session.comments`, with the people from `users`. The Comments tab lists the threads, a note or a comment on a highlight starts one, and replies, resolving and @mentions work as in the other editors. Pass `{ store, permissions, onError }` to keep threads in your database or to limit who may comment. Without `comments` the Comments tab has nothing to show.
- `room` and `users` give presence: the title row shows who is here, other people's selected annotations are outlined in their colour with their name, and the editor tells the room `{ page, selection, tool }` as you move around. The editor connects the room when it appears and disconnects it when it goes.
- `sync` keeps the session in step with the shared document through a `SyncClient` with `pdfSyncModel`, and stops it when the editor goes. `version: 0` means "I have the file as read", which is what `openPdf` gives you. It needs a `room`, and everyone must open the same bytes ([Collaboration](/pdf/collaboration/#live-editing)).
- `storage` changes where pictures go: a stamp, signature or picture the person adds is uploaded, and the annotation keeps the address `storage.resolve` gives. When the file is saved, the editor fetches those addresses and embeds the pictures in the PDF (`SaveOptions.fetch`, see [Annotations](/pdf/annotations/#pictures)). Without `storage`, pictures are embedded as data from the start. `storageSources` keeps the PDF files themselves, so a page that someone merged in shows up on every screen ([Files](/pdf/files/#storing-the-files)). If a file is not in the store yet, its pages say "Waiting for the file" and the editor asks again (`sourceRetryMs`).

## Read-only

`readOnly` turns the editor into a viewer that people can look through, search, select, print and download from. The annotation ribbon, the properties panel, the page and bookmark editing, form filling, renaming and the Save button are off, and the pages cannot change. The Comments and Annotations tabs stay, so people can see what is on the file. Keys that edit do nothing.

```tsx
<PdfEditor session={session} renderer={renderer} readOnly />
```

Download and print stay in the File menu. To give a person fewer tools without turning editing off, use `annotations={{ tools: ["select", "highlight", "note"] }}`, `pageTools={false}` or `annotations={false}`.

## Look and theme

The look is a set of CSS variables on `.pli-pdf` (`--pli-pdf-blue`, `--pli-pdf-app`, `--pli-pdf-workspace`, `--pli-pdf-line`, `--pli-pdf-text`, `--pli-pdf-muted`, `--pli-pdf-hover`, `--pli-pdf-paper`, `--pli-pdf-selection`, `--pli-pdf-shadow`, and the form colours `--pli-form-*`), with light and dark values in `@pli.dev/pdf-react/styles.css`. Menus, dialogs and buttons come from `@pli.dev/react/styles.css`, which the other editors use too, so import both.

```css
.my-editor .pli-pdf { --pli-pdf-blue: #0b7a57; --pli-pdf-workspace: #e9e6df; }
```

`theme="auto"` (the default) follows the system's light or dark setting. `theme="light"` or `"dark"` forces one, for an app with its own switch. Pages are always drawn on white paper, because that is what the file says, and the editor around them goes dark. Highlights are multiplied with the page, so text stays readable on white, and the found-text marks change in dark mode.

## Accessibility

- Keyboard: everything has a key (the list is on [Keyboard shortcuts](/pdf/shortcuts/)). Tools, menus, dialogs, the thumbnails and the outline are reachable with Tab and the arrow keys; Esc leaves a menu, dialog, tool or text box. Pages can be moved without a mouse (Alt with the arrow keys).
- Roles and labels: the menu bar, toolbar, ribbon, text bar, sidebar tabs, outline (a tree), find bar and dialogs have roles and names, and every button has a tooltip and a name (the tests check this, and that no two buttons in a bar share an icon). Dialogs are native `<dialog>` elements, which trap the focus.
- Announcements: page changes (turned, deleted, moved, extracted, labelled), saves and errors are spoken through a polite live region, and the find bar says how many matches there are.
- Forms use native controls: text boxes, check boxes, radio buttons, drop-downs and lists are native inputs with a label from the field's name or tooltip, `aria-required` and `aria-invalid`, and a message that says what is wrong. Tab follows the reading order of the fields.
- Touch targets: the buttons grow to 44 pixels when the device's main pointer is coarse (a finger), and the few animations stop when the person asks for reduced motion.
- Text: the pages' text layer lets a screen reader and the keyboard select and copy text. Whether a file is tagged (has a structure for screen readers) is up to the file. Pli keeps the tags of a file it saves as an update, and does not make them.

Not yet tried: a real screen reader (VoiceOver, NVDA) on the editor. This is on the [roadmap](/pdf/roadmap/#annotation-tools).

## Touch and phones

The editor uses pointer events, so a finger, a pen and a mouse all work, and the layout changes with the width of the editor ([Layout and panels](#layout-and-panels)): under 900 pixels the properties panel is a sheet over the page, under 640 the sidebar is a drawer and the panel comes up from the bottom, menus become sheets from the bottom, and the buttons are bigger. Some limits:

- Two fingers zoom the pages, around the middle of the fingers (and moving the middle scrolls), like a trackpad pinch or Ctrl with the wheel. The browser's own page zoom is switched off over the pages (`touch-action: pan-x pan-y`). A stroke or drag that one finger had begun is dropped when the second finger comes down. One finger still scrolls, and draws when a drawing tool is on.
- While an annotation is selected, dragging on it moves it; otherwise a touch scrolls the page. To draw, choose the Pen first; then touches draw.
- Selecting text with a finger depends on the browser (iOS and Android differ), and the long-press menu is the browser's.
- Dragging pages in the thumbnails with a finger is the browser's drag and drop, which is not the same everywhere; the page menu (long press) and **Move to** do the same without dragging.

Tests send touch events by hand to cover these, but they have not been tried on real phones and tablets. See the [roadmap](/pdf/roadmap/).

## Build your own

`PdfEditor` is made of parts you can use one at a time. Every one of them is exported.

| Part | What it is |
|---|---|
| `PliPdf` | The viewer: pages, thumbnails, outline, find, zoom, layouts, the page tools and the File menu, and the places to plug things into |
| `AnnotatedPdf` | `PliPdf` plus the annotation tools |
| `FormsPdf` (`PdfEditor`) | `AnnotatedPdf` plus the form tools; `annotations={false}` leaves the annotation tools out |
| `useAnnotationKit(session, options)` | The annotation tools as props for `PliPdf`, with `hostProps` (keyboard, paste, drop) for an element around it. Its `controller` is a plain object you can drive from your own buttons |
| `useContentEditKit(session, options, tool)` | The Edit text and pictures tool as props for `PliPdf` (the tool, the preview on the pages, the in-place editor, the Edits tab, the panel), with `group(view)` for its button and `hostProps` for the Q key |
| `useFormsKit(session, options)` | The form tools as props for `PliPdf` (the controls on the pages, the form bar, Prepare form and its properties panel), with `hostProps` |
| `usePageToolsKit(options)` | The controllers behind the thumbnails and the File menu (`tools`, `files`, `outline`, `notices`); `PliPdf` makes one for you, and `usePageTools()` inside the viewer gives it to your own components |
| `Thumbnails`, `OrganiseGrid`, `Outline`, `PageToolbar`, `PageDialogs`, `FileMenu`, `SaveButton`, `FindBar`, `PdfToolbar`, `PdfStatusBar`, `PageView` | The pieces of the viewer, for your own layout |
| `buildCommands`, `buildMenus`, `LiveMenuBar`, `TitleBar`, `CommandButton`, `commandItem`, `mergeMenus`, `weaveMenus` | The commands the toolbar and the menus are made from, and the menu bar and title row, for your own layout |
| `FormatBar`, `formatMenu`, `ReplaceRow`, `useReplace`, `ShortcutsDialog`, `PropertiesDialog`, `WordCountDialog` | The text bar, find and replace, and the dialogs of Help and Tools |

A viewer with only the annotation tools, in your own layout:

```tsx
import { PliPdf, useAnnotationKit, type PdfRenderer } from "@pli.dev/pdf-react";
import type { PdfSession } from "@pli.dev/pdf";

export function Annotator({ session, renderer }: { session: PdfSession; renderer: PdfRenderer }) {
  const kit = useAnnotationKit(session, { user: { id: "u_1", name: "Sam" }, tools: ["select", "highlight", "ink", "note"] });
  return (
    <div style={{ display: "contents" }} {...kit.hostProps}>
      <PliPdf session={session} renderer={renderer} {...kit.props} />
    </div>
  );
}
```

### Extension points

`PliPdf` has these places to plug into. The annotation, form and edit tools use only these:

- The tool registry (`tools`, `tool`, `onToolChange`). A `PdfTool` has a button in the toolbar (with `topToolbar`) or, with no toolbar, in a row of its own under the menu bar. While it is active, every page covers itself with a layer that gives the tool pointer events in page space (points, y down, not turned, at any zoom and turn of the view) and draws the tool's `overlay`. `selectText: true` keeps the text selectable and `onTextSelected` receives the selection as rectangles.
- Overlays on each drawn page: `pageOverlay` (SVG in page space: annotations), `pageOverlayDom` (HTML, in a layer of the page's size in points: form fields, the text editor) and `pageOverlayBlend` (SVG multiplied with the page: highlights). They are called for the pages near the view only.
- Slots: `toolbar` (with `topToolbar`), `host`, `ribbon` (a row of its own), `formatBar` (the text bar), `banner` (between the ribbon and the pages), `sidebar` (more tabs), `rightPanel` (with `rightPanelKey`: when it opens), `findActions` (buttons in the find bar), `actions` (the title row) and `menus` (the menu bar).
- `usePdfView()`, inside any of these, gives the viewer's state and commands: the page shown, zoom, `goToPage`, `setTool`, the pages selected, `pageElement(id)` and more.

```tsx
import { PdfEditor, type PdfPanel, type PdfTool } from "@pli.dev/pdf-react";

// A tool that puts a small red dot where you click.
const dot: PdfTool = {
  id: "dot",
  label: "Dot",
  shortcut: "D",
  onPointer(e) {
    if (e.type !== "down") return;
    e.session.annots.addShape(e.page.id, "circle", { x: e.x - 5, y: e.y - 5, w: 10, h: 10 }, { color: "#e53935", fill: "#e53935" });
  },
};

// A tab in the sidebar.
const info: PdfPanel = { id: "info", label: "Info", render: (view) => <p>Page {view.pageIndex + 1} of {view.pageCount}</p> };

<PdfEditor session={session} renderer={renderer} tools={[dot]} sidebar={[info]} />;
```

Because every change goes through the session, a tool of your own can be undone, saved and shared like the built-in ones, and other readers draw its output. The session and its commands are on [How it works](/pdf/concepts/).

## Try it

The playground has the editor on a sample file. From a clone of the repository, run:

```sh
pnpm playground
```

and open **PDF**, then **PDF editor**. The engine makes the sample in your browser (`makeSamplePdf()` from `@pli.dev/pdf`): two Letter pages of text, bookmarks, a small form (a name, a choice, a check box and a signature field) and links. Highlight and draw on it, add notes and stamps, fill in the form, turn Prepare form on, redact a word, click a word with the Edit tool (Q) and retype it, move pages in the thumbnails, and press Save to download the result. **Open PDF** (or dropping a file on the page) opens your own file, **Sample file** brings the sample back and **Read only** turns the editing off.

To make the same file in your own code, for tests and first tries:

```ts
import { makeSamplePdf, openPdf } from "@pli.dev/pdf";

const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
session.doc.pages.length;   // 2
session.doc.fields.length;  // 4
```

## Not there yet

What is missing, and what still needs a check on real machines and phones, is on the [roadmap](/pdf/roadmap/).
