---
"@pli.dev/react": minor
"@pli.dev/sheets-react": minor
"@pli.dev/decks-react": minor
"@pli.dev/pdf-react": minor
---

Take over how files are saved, and keep the default when you want it. `onDownload` on `PliDocument`, `PliSheet`, `PliDeck` and `PliPdf` is now also given `browserDownload()`, the browser's own download, so one function can share a file from a native app and fall back on the web: `onDownload={(file, { browserDownload }) => (native ? share(file) : browserDownload())}`. The new `DownloadProvider` from `@pli.dev/react` sets the function once for every editor inside it, and an editor's own `onDownload` still wins. A function that throws or rejects now shows the person "The file couldn't be saved" with its reason in Documents, Sheets and Decks, as PDF already did. The Documents, Sheets and Decks download types are all `DownloadFile` now.
