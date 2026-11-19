# Adding the editor to a React or Capacitor app

`@pli.dev/react` is a finished document editor for React 18 and 19. `@pli.dev/docs` is the engine under it. In a Capacitor app the same editor runs in the native shell's web view.

## Install

Both packages are on npm:

```sh
npm install @pli.dev/docs @pli.dev/react
```

(`pnpm add`, `yarn add` and `bun add` work the same.) The app needs `react` and `react-dom` 18 or 19. The packages are ESM with TypeScript types, so Vite, Next and other bundlers use them as they are. Both packages are released together and always have the same version number. If the code imports from `@pli.dev/core` directly, install that too (pnpm does not hoist it).

## The editor in a few lines

```tsx
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import "@pli.dev/react/styles.css";               // required: the editor's styles

export function Editor() {
  const session = useDocumentSession();       // a new empty document
  return (
    <div style={{ height: "100vh" }}>         {/* it fills its container: give it a height */}
      <PliDocument session={session} autoFocus />
    </div>
  );
}
```

Start from a saved document: `useDocumentSession(() => parseDoc(savedJson))`. The session is the source of truth.

## Save it

```tsx
import { parseDoc, serializeDoc } from "@pli.dev/docs";

useEffect(() => {
  let timer: ReturnType<typeof setTimeout>;
  const stop = session.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem("doc", serializeDoc(session.state)), 400);
  });
  return () => { stop(); clearTimeout(timer); };
}, [session]);
```

For a server, send `serializeDoc(session.state)` the same way. `parseDoc` validates on the way in and throws a `PliError` that says where a saved file is wrong; wrap loading in `try/catch` and fall back to a new document.

## Props worth knowing

`session` (required), `readOnly`, `defaultView` (`"pages"` or `"continuous"`), `menu`/`toolbar`/`statusBar` (set `false` to hide), `placeholder`, `autoFocus`, `onSave` (called for Ctrl/Cmd+S; without it the shortcut does nothing), `onImported` (after File > Import DOCX), `onDownload` (takes over File > Download; to save files in your own storage or share them, see Capacitor; `DownloadProvider` sets it for every editor), `menuLabels` (rename or remove menu items: `{ "File > Download": "Export", "Insert > Page break": false }`; also for translating), `paper="light"` to keep white pages in dark mode, `sync` and `room` for live co-editing.

Theme with CSS custom properties on `.pli-document`: `--pli-accent`, `--pli-font`, `--pli-doc-font` and the rest listed on the docs page "Ready-made editor".

## Files in and out

File > Download offers DOCX, PDF, Markdown, HTML and JSON, and File > Import reads DOCX. From code, headless: `toDocx(session.state)` (bytes), `toMarkdown`, `toHtml(doc, { fullDocument: true })`, `fromDocx(bytes)`. PDF export is the editor's (it needs the browser's layout).

## Make the editor your own

`PliDocument` is assembled from public pieces (`EditorToolbar`, `MenuBar`, `PageCanvas`, `OutlinePanel`, `FindPanel`, `StatusBar`). Use `PliEditor` with your own toolbar, or `@pli.dev/docs` alone with your own view. Read the docs pages "Build your own" and "Selection and commands" before writing a custom surface: edits are operations (`session.transact`) or selection commands (`typeText`, `toggleMark`, `splitBlock`, `setBlockType`…), and the DOM is only a view.

## Capacitor (iOS and Android shells)

The web editor runs unchanged. Three things make it right on a phone (see `examples/capacitor`):

1. `@capacitor/keyboard` with `Keyboard: { resize: KeyboardResize.Native }` in `capacitor.config.ts`, so the web view shrinks above the keyboard and the toolbar (at the bottom on a phone) rides above it.
2. `maximum-scale=1` in the page's viewport meta, so iOS doesn't zoom when a field is focused.
3. A web view can't download files. Pass `onDownload` (or wrap the app in `<DownloadProvider onDownload>`) and write the file to the cache with `@capacitor/filesystem`, then `@capacitor/share`; its second argument has `browserDownload()` for the web build. On iOS, `Keyboard.setAccessoryBarVisible({ isVisible: false })` hides the bar of arrows above the keyboard.

## Pitfalls

- Forgetting `@pli.dev/react/styles.css` gives an unstyled editor.
- A parent with no height gives an editor with no height.
- Don't mutate `session.state`; it is immutable. Change it through the session.
- Text offsets are UTF-16 code units.
- Input methods (Chinese, Japanese, Korean), Safari, Firefox and mobile keyboards are implemented but not yet checked on real devices; say so if the user relies on them.
