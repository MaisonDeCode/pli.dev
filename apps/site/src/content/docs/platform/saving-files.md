---
title: Saving files your way
description: By default a file an editor makes is downloaded by the browser. Take that over to keep it in your own storage, send it to a server, or show a phone's share sheet.
sidebar:
  order: 5.5
---

When someone chooses **File > Download**, the editor makes the file (a DOCX, an XLSX, a PDF…) and the browser saves it to their computer, the way any web page does. That is the default, and it needs no setup.

Often that isn't what an app wants. The file may belong in your own storage, or on your server. Inside a Capacitor, Swift or Kotlin app there is no download at all, and the right thing is the phone's share sheet. Every editor has an `onDownload` option for this. Give it a function and the editor calls it with the file, in place of the browser.

```tsx
<PliDocument
  session={session}
  onDownload={async (file) => {
    await fetch(`/api/files/${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "Content-Type": file.type }, body: file.data });
  }}
/>
```

`file` has three things: `name` (with the extension), `type` (the MIME type) and `data` (a `Uint8Array`).

## Keeping the default

The function's second argument has `browserDownload()`, which is the default: the browser saves the file. Call it for the files you don't want to handle, or for the web build of an app that has a native one.

```tsx
onDownload={(file, { browserDownload }) => (Capacitor.isNativePlatform() ? saveAndShare(file) : browserDownload())}
```

```tsx
// Keep spreadsheets in your storage, and let everything else download as usual.
onDownload={(file, { browserDownload }) => (file.name.endsWith(".xlsx") ? uploadToStorage(file) : browserDownload())}
```

## Setting it once

An app with several editors can set it once. Everything inside a `DownloadProvider` (Documents, Sheets, Decks and PDF) uses its function, unless an editor has its own `onDownload`, which wins.

```tsx
import { DownloadProvider } from "@pli.dev/react";

<DownloadProvider onDownload={(file, { browserDownload }) => (native ? shareSheet(file) : browserDownload())}>
  <PliDocument session={doc} />
  <PliSheet session={sheet} />
  <PliDeck session={deck} />
  <PliPdf session={pdf} />
</DownloadProvider>
```

## Where it applies

| Editor | The option | What goes through it |
|---|---|---|
| `PliDocument` | `onDownload(file, helpers)` | File > Download: DOCX, PDF, Markdown, HTML, Pli JSON |
| `PliSheet` | `onDownload(file, helpers)` | File > Download: XLSX, CSV, TSV, Pli JSON, and the PDF of the print preview |
| `PliDeck` | `onDownload(file, helpers)` | File > Download: PPTX, PDF, Pli JSON, and Save as theme |
| `PliPdf` | `onDownload(bytes, name, mime, helpers)` | A copy, the parts of a split (or one ZIP of them), pages as pictures, form data, a flattened file |

`PliPdf` takes the file as separate arguments, as it did before. With a `DownloadProvider` it is given the same `file` as the others.

Each file is one call, so a split into three parts is three calls (or one, for the ZIP). Printing is a separate option, and where it can be taken over it is `onPrint`: see [Sheets](/sheets/grid/) and [PDF](/pdf/ready-made-ui/).

## If it fails

Return a promise and the editor waits for it. If your function throws, or the promise rejects, the editor shows the person that the file couldn't be saved, with your error's message, so make the message something they can read: `throw new Error("You are over your storage limit")`.

Closing a share sheet or a save dialog without choosing anything isn't a failure: catch that in your function and return.

## More examples

**A phone's share sheet** (Capacitor). The file is written to the app's cache, and the sheet offers Save to Files, AirDrop, Mail and the rest:

```tsx
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

async function saveAndShare(file: DownloadFile) {
  let binary = "";
  for (let i = 0; i < file.data.length; i += 0x8000) binary += String.fromCharCode(...file.data.subarray(i, i + 0x8000));
  const written = await Filesystem.writeFile({ path: file.name, data: btoa(binary), directory: Directory.Cache });
  try {
    await Share.share({ title: file.name, url: written.uri });
  } catch (cause) {
    if (!/cancel/i.test(String((cause as Error)?.message ?? cause))) throw cause;   // closing the sheet is not an error
  }
}
```

The [Capacitor example](/platform/example-apps/) does exactly this. The Swift and Kotlin editors have an `onDownload` too; without it they show the share sheet on iOS, a save panel on a Mac and a save dialog on Android.

**A save dialog** (browsers that have one). The person picks where the file goes; other browsers download as usual:

```tsx
onDownload={async (file, { browserDownload }) => {
  if (!("showSaveFilePicker" in window)) return browserDownload();
  try {
    const handle = await (window as any).showSaveFilePicker({ suggestedName: file.name });
    const writable = await handle.createWritable();
    await writable.write(file.data);
    await writable.close();
  } catch (cause) {
    if ((cause as Error).name !== "AbortError") throw cause;   // closing the dialog is not an error
  }
}}
```

**A server of your own.** `file.data` is bytes, so it can be the body of a request as it is, or become a `Blob` or `FormData` part: `new Blob([file.data], { type: file.type })`.
