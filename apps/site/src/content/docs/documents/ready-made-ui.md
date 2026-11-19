---
title: Ready-made editor
description: Drop in a complete document editor with PliDocument, and customize it.
---

`@pli.dev/react` provides a complete document editor. It needs React 18 or 19.

```tsx
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import "@pli.dev/react/styles.css";

export function Editor() {
  const session = useDocumentSession();
  return (
    <div style={{ height: "100vh" }}>
      <PliDocument session={session} autoFocus />
    </div>
  );
}
```

`PliDocument` fills the height of its container, so give it one. `useDocumentSession` creates a session once for the component. Pass an initial document, or a function that returns one, to start with content:

```tsx
const session = useDocumentSession(() => parseDoc(savedJson));
```

## What's included

| Part | What it does |
|------|--------------|
| **Document title** | Rename the document at the top left. |
| **Menu bar** | File (download as DOCX, Markdown, HTML or JSON; page setup; print), Edit, View, Insert, Format. |
| **Toolbar** | Undo and redo, print, paragraph style, font (a picker over the Office fonts and 2,000 Google families, see [Fonts](/platform/fonts/)) and size, bold, italic, underline, text and highlight color, link, image, table, alignment, lists and indent buttons, and a **More** menu for strikethrough, superscript, subscript, line spacing, page break and clear formatting. Buttons show their state for the selection. |
| **Ruler** | Drag the margins and the paragraph indent markers. See [Ruler and indents](/documents/features/ruler-and-indents/). |
| **Pages or pageless** | Real pages with a header and footer, or one continuous column. See [Pages and layout](/documents/features/pages-and-layout/). |
| **Header and footer** | Double-click the top or bottom of a page. Includes page-number fields. See [Headers and footers](/documents/features/headers-and-footers/). |
| **Images** | Upload, paste or drop, then resize and align. See [Images](/documents/features/images/). |
| **Tables** | Pick a size, type, Tab between cells, drag across cells, merge and split, resize columns and rows, vertical alignment, shade, header row. See [Tables](/documents/features/tables/). |
| **Table of contents** | Generated from headings, with page numbers. See [Table of contents](/documents/features/table-of-contents/). |
| **Find and replace** | `Ctrl/Cmd+F` or `+H`, with the matches highlighted on the page. |
| **Outline** | A side panel of the headings that jumps to each one. |
| **Status bar** | Page and word count, layout switch and zoom. |
| **Clipboard** | Copy and cut put plain text, HTML and Pli's own format on the clipboard. Paste keeps formatting from other editors, spreadsheets and web pages, and turns a spreadsheet range or web table into a real table. See [Copy and paste](/documents/features/copy-and-paste/). |
| **Themes** | The interface and the pages follow the system's light or dark setting. On a dark page, black text is shown in the page's text color, and highlighted text (and text in a shaded table cell) stays dark so it can be read. Exports and printing are unaffected. Set `paper="light"` to keep the pages white in a dark interface. |
| **Small screens** | The menu bar, toolbar and status bar fit a phone. Menus open full width, and submenus unfold in place (or open on whichever side has room). The status bar shows `2 / 6` and drops the word count. The toolbar opens with undo, bold, italic and the list buttons, scrolls sideways for the rest (style and font last), and keeps its **More** menu pinned at the right edge. It sits at the bottom of the editor, under the status bar, so it stays in reach while you type. When a touch keyboard slides over the page (as on iPhone in Safari), the editor fits itself to the part that is left, so the toolbar rides just above the keyboard. The **More** menu also holds **Pages**, **Pageless** and **Zoom**, which the status bar leaves out on a phone. |

Every shortcut is listed in [Keyboard shortcuts](/documents/features/keyboard-shortcuts/).

## Props

| Prop | Type | |
|------|------|---|
| `session` | `DocumentSession` | Required. |
| `readOnly` | `boolean` | Hides the toolbar's controls and makes the document non-editable. |
| `defaultView` | `"pages" \| "continuous"` | Starting layout. Default `"pages"`. |
| `defaultZoom` | `number` | `1` is 100%. |
| `menu`, `toolbar`, `statusBar` | `boolean` | Set any to `false` to hide it. All default to `true`. |
| `defaultOutlineOpen` | `boolean` | Start with the outline panel open. |
| `paper` | `"auto" \| "light"` | `"light"` keeps the pages white in dark mode. Default `"auto"`. |
| `theme` | `"auto" \| "light" \| "dark"` | The look of the editor. `"auto"` follows `<html data-theme>` or the system. See [Theme and your own buttons](/platform/theme-and-buttons/). |
| `extraMenus` | `ExtraMenus` | Items for the menus and menus of your own: `{ File: [{ label: "Share…", onSelect }], AI: [...] }`. See [Your own menus and file chooser](/platform/menus-and-file-pickers/). |
| `placeholders` | `boolean \| { fields }` | For editing a template that [makes documents from answers](/documents/guides/documents-from-answers/): draws each `{{ … }}` as a chip (red when it can't be read) and adds **Field**, **Only if…** and **Repeat for each…** to Insert. `fields` lists your answers by name: `{ fields: ["client.name", { path: "start", label: "Start date" }] }`, and `labels: true` shows each tag as a plain name with the code hidden. Only the drawing changes, not the text. |
| `onDownload` | `(file, { browserDownload }) => void \| Promise<void>` | Takes over File > Download. The editor calls it with each file (`{ name, type, data }`) instead of the browser downloading it: keep it in your own storage, or show a phone's share sheet. `browserDownload()` is the default, for what you don't handle. If it throws, the editor says the file couldn't be saved. A `DownloadProvider` sets it for every editor in your app. See [Saving files your way](/platform/saving-files/). |
| `menuLabels` | `Record<string, string \| false>` | New text for the built-in menus, or `false` to take an item out: `{ "File > Download": "Export", "Insert > Page break": false }`. A key is the text as it is now, or a path of them. Also how to translate the menus. See [Your own menus and file chooser](/platform/menus-and-file-pickers/#rename-or-remove-built-in-items). |
| `filePicker` | `FilePicker` | Your own way of choosing a file, for Insert > Image and File > Import DOCX, instead of the browser's. Return the chosen `File`. See [Your own menus and file chooser](/platform/menus-and-file-pickers/). |
| `history` | `VersionHistory` | Adds **View > Version history** and its side panel: look at older versions (the page shows them, read-only) and restore one. Restoring adds a new version and keeps every earlier one. See [Versions and activity](/platform/versions/). |
| `versions`, `autoSaveVersions`, `users` | `VersionStorage`, `boolean \| { every, keep }`, `Users` | A shortcut for `history`: say where versions are kept (and who is signed in) and the editor makes the history for you, keeping a version by itself now and then. `autoSaveVersions={false}` turns that off. |
| `startActions`, `actions`, `endActions` | `ReactNode` | Your own buttons in the title row: at the far left before the name, beside Comments and Share, and at the far right after Share. |
| `sync` | `SyncClient` | Live editing: keeps the session in step with a shared document and shows whether it is saved. See [Live editing](/platform/live-editing/#4-in-the-editor). |
| `room` | `CollabRoom` | Who else is here, and their cursors, and shared comments. Connected for you. With `sync`, its room is used if you leave this out. |
| `defaultCommentsOpen` | `boolean` | Start with the comments panel open. |
| `fonts` | `FontRegistry` | The fonts the picker offers and how they load: `fonts={createFonts({ only: [...] })}`. Default: every font, from a CDN. See [Fonts](/platform/fonts/#giving-the-registry-to-the-editors). |
| `placeholder` | `string` | Shown while the document is empty. |
| `autoFocus` | `boolean` | Focus the editor on mount. |
| `onImported` | `(result) => void` | Called after File > Import DOCX replaced the document, with what was read (`doc`, `authors`, `warnings`; see [Importing](/documents/guides/importing/)). Without it, what could not be carried over appears in a notice above the page. |
| `onSave` | `(doc) => void` | Called for `Ctrl/Cmd+S`. Without it the shortcut does nothing. |
| `className` | `string` | Added to the outer element. |
| `aria-label` | `string` | Name for the editing area. |

## Saving

The session is the source of truth, so save it whenever it changes:

```tsx
useEffect(
  () => session.subscribe(() => localStorage.setItem("doc", serializeDoc(session.state))),
  [session],
);
```

For a server, debounce the call. See [Saving and loading](/documents/guides/saving-and-loading/).

## Theming

Colors, fonts and the page are driven by CSS custom properties. Override them on `.pli-document`, or any ancestor:

```css
.pli-document {
  --pli-accent: #0f766e;
  --pli-accent-soft: #ccfbf1;
  --pli-font: "Inter", system-ui, sans-serif;   /* interface */
  --pli-doc-font: "Georgia", serif;             /* default font of the text */
}
```

| Property | Controls |
|----------|----------|
| `--pli-bg`, `--pli-chrome`, `--pli-canvas` | The page behind everything, the menu and toolbar, and the area around the pages |
| `--pli-fg`, `--pli-muted`, `--pli-border`, `--pli-hover` | Text, secondary text, lines, hover |
| `--pli-accent`, `--pli-accent-soft` | Active buttons, focus, selection |
| `--pli-paper`, `--pli-paper-fg`, `--pli-paper-muted` | The page and its text. Dark in dark mode |
| `--pli-paper-line`, `--pli-paper-tint`, `--pli-quote-line`, `--pli-quote-fg`, `--pli-table-line` | Rules, the header row of a table, quotes, table borders |
| `--pli-ink` | The dark text color used on highlights and shaded cells |
| `--pli-doc-font`, `--pli-mono` | Default font of the text, and code |
| `--pli-link`, `--pli-code-bg` | Links, code |

Set the `theme` prop to match your app, or force a theme for the whole page with `data-theme="light"` or `data-theme="dark"` on `<html>`.

## Replacing parts

`PliDocument` is built from public pieces: `EditorToolbar`, `MenuBar`, `PageCanvas`, `OutlinePanel`, `FindPanel`, `StatusBar` and the dialogs. Use them directly to rearrange the layout, leave one out, or swap in your own. See [Build your own](/documents/build-your-own/).

## Current limitations

- Verified in Chrome. Safari, Firefox, IME input (Chinese, Japanese, Korean and similar) and mobile keyboards, including inside a Capacitor app, are implemented but not yet checked on real devices.
