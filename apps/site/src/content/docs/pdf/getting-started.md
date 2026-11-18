---
title: Get started
description: Install Pli.PDF, open a PDF, change it and save it, show it in a React app with pdf.js running offline, and use the engine from Node and native apps.
---

Install the engine and the React editor, and pdf.js to draw the pages:

```sh
npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist
```

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. The editor needs `react` and `react-dom` 18 or 19 in your app. Its stylesheet already includes the shared toolbar and menu styles from `@pli.dev/react`. `pdfjs-dist` (version 6.2.108 or later) is an optional peer dependency: you need it to show PDF pages, and can leave it out in code that only uses the engine. The engine, `@pli.dev/pdf`, has no peer dependencies and runs in Node 20 or later and in browsers. Both Pli packages are ESM and ship their own TypeScript types; [Releases and versioning](/platform/contributing/releases/) has the rest. Code on this page that imports `PliError` from `@pli.dev/core` needs `npm install @pli.dev/core` too.

## Open, change, save

```ts
import { openPdf } from "@pli.dev/pdf";

const session = await openPdf(bytes, { name: "contract.pdf" });   // bytes: a Uint8Array

session.doc.pages.length;          // 12
session.doc.meta.title;            // "Service agreement"
session.doc.pages[0];              // { id: "p:main:0", width: 612, height: 792, rotate: 0, annots: [...], ... }

const page = session.doc.pages[0]!.id;
session.annots.addHighlight(page, [{ x: 72, y: 90, w: 140, h: 14 }], { quote: "Invoice number", contents: "Check the number" });
session.pages.rotate([page], 90);
session.undo();                    // takes the turn back

const saved = await session.save();   // a Uint8Array: the original file plus the highlight
session.markSaved();                  // session.dirty is false again
```

`openPdf` reads the whole file into a `PdfDoc`: plain JSON with the pages, the annotations on each page, the form fields, the bookmarks and the document information. After that, every change goes through undoable operations on the JSON, and `save` writes the difference back into the file. See [How it works](/pdf/concepts/).

Positions are in page space: points (1/72 inch) from the top left corner of the page, with y growing down, whatever the page's own coordinate system is.

A file that is not a PDF throws a `PliError` with code `invalid_document`. An encrypted file opens with an empty password. If it needs another one, pass `{ password }`. A missing or wrong password throws `PliError("unsupported", "password required")` or `"wrong password"`:

```ts
import { PliError } from "@pli.dev/core";
import { openPdf } from "@pli.dev/pdf";

try {
  await openPdf(bytes);
} catch (error) {
  if (error instanceof PliError && error.code === "unsupported") {
    await openPdf(bytes, { password: askForPassword() });
  }
}
```

The options of `openPdf`:

| Option | |
|---|---|
| `name` | The file's name, kept in the document and used for downloads |
| `password` | The user or owner password of an encrypted file. It is used again when saving |
| `user` | `{ id, name }` of who is editing. Annotations are stamped with it, and the name is written to the PDF |
| `sources` | Where the bytes of the file are kept. Memory by default; see [Files](/pdf/files/#storing-the-files) |
| `id` | The document's id for comments and storage. By default a fingerprint of the bytes, so everyone who opens the same file agrees |
| `now` | The clock, for `created` and `modified` (tests) |

## A React app

```tsx
import { useEffect, useMemo, useState } from "react";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import "@pli.dev/pdf-react/styles.css";

export function Editor({ url }: { url: string }) {
  const renderer = useMemo(
    () =>
      pdfjsRenderer({
        workerSrc: new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString(),
        cMapUrl: "/pdfjs/cmaps/",
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
      }),
    [],
  );
  const [session, setSession] = useState<PdfSession | null>(null);

  useEffect(() => {
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buffer) => openPdf(new Uint8Array(buffer), { name: "document.pdf" }))
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
          await fetch("/api/document", { method: "PUT", body: bytes as BodyInit });
        }}
      />
    </div>
  );
}
```

`PdfEditor` is the whole editor. It has the viewer with thumbnails, bookmarks and search, the page tools, the annotation tools, form filling and preparing, and a menu bar (File, Edit, View, Insert, Format, Tools, Help) for saving, downloading, printing and exporting pages. It fills its parent, so give the parent a height. `onSave` receives the bytes when the person saves, and the document counts as saved once the promise it returns resolves. The editor follows the session: change the session from anywhere (a button, a script, another person) and the pages redraw. Its props, fonts, comments and live editing are on [The PDF editor](/pdf/ready-made-ui/).

For a viewer with no editing tools, use `PliPdf`. It takes the same props and shows pages, thumbnails, outline, search and zoom, and `readOnly` stops people changing anything. `AnnotatedPdf` is `PliPdf` with only the annotation tools. See [Viewing](/pdf/viewing/), [Annotations](/pdf/annotations/), [Pages](/pdf/pages/#in-the-viewer), [Forms](/pdf/forms/) and [Files](/pdf/files/#in-the-viewer-the-file-menu).

```tsx
import { PliPdf } from "@pli.dev/pdf-react";

<PliPdf session={session} renderer={renderer} readOnly />
```

### Hosting the pdf.js files

pdf.js (`pdfjs-dist`) is an optional peer dependency. It loads the first time a file opens, so a page that never shows a PDF does not download it. Install it next to your app with `npm install pdfjs-dist` (the install line at the top of this page has it). Pli never fetches anything from a CDN, so you host the files pdf.js needs:

| Option | What it is | Where it is in `pdfjs-dist` |
|---|---|---|
| `workerSrc` | The worker that parses and decodes pages (1.3 MB) | `build/pdf.worker.min.mjs` |
| `cMapUrl` | Character maps for Chinese, Japanese and Korean fonts that are not embedded | `cmaps/`, a folder |
| `standardFontDataUrl` | Fonts for files that name Helvetica, Times or Courier without embedding them | `standard_fonts/`, a folder |
| `wasmUrl` | Decoders for JPEG 2000, JBIG2 and colour profiles | `wasm/`, a folder |

Without `workerSrc` (or a `worker` of your own), a browser cannot start the worker, and opening a file fails with a message that says so. The folder options end with a slash, and the folders must be served as plain static files. Copy the folders into your public directory when you build, for example `cp -r node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm} public/pdfjs/`.

With Vite, `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"` gives the address of the file the build copies, and `new URL(..., import.meta.url)` does the same in webpack 5 and Rollup. If you leave out `cMapUrl`, `standardFontDataUrl` or `wasmUrl`, only files that need them are affected. Most Western documents with embedded fonts draw without any of the three. Sizes are on [Viewing](/pdf/viewing/#size-and-offline).

## Without a screen

The engine has no DOM and uses no Node built-ins. In Node:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { extractText, mergePdfs, openPdf } from "@pli.dev/pdf";

const bytes = new Uint8Array(await readFile("report.pdf"));

const session = await openPdf(bytes, { name: "report.pdf" });
const page = await extractText(session, 0);                       // the text of page 1, with a box for every letter
const hits = await session.content.search("total due");           // where it is, as rectangles

session.pages.remove([session.doc.pages[1]!.id]);                 // delete page 2
await writeFile("report-short.pdf", await session.save());

await writeFile("both.pdf", await mergePdfs([bytes, bytes]));     // no session needed
```

Reading, annotating, form filling, page changes, merging, searching, redacting and saving all work this way. Without a renderer it cannot draw a page as a picture. See [Viewing](/pdf/viewing/#replacing-the-renderer) for how to plug one in.

## Swift and Kotlin

The engine is plain TypeScript with no browser or Node dependency, so it runs in JavaScriptCore (iOS) and QuickJS (Android), as the other editors do in the [native packages](/platform/swift-and-kotlin/). `PliPdf` wraps it for Swift and Kotlin: open, annotate, fill, search, redact and save. There is no native page viewer yet. See [Swift and Kotlin](/pdf/swift-and-kotlin/).

## What next

- [The PDF editor](/pdf/ready-made-ui/): the props of `PdfEditor`, fonts, comments and live editing, theming, read-only, and the parts to build your own. [Keyboard shortcuts](/pdf/shortcuts/).
- [Viewing](/pdf/viewing/): pdf.js, workers, zoom, layouts, search, performance, replacing the renderer.
- [Annotations](/pdf/annotations/), [Pages](/pdf/pages/), [Forms](/pdf/forms/), [Text, search and redaction](/pdf/text-and-redaction/).
- [Files](/pdf/files/): save modes, encrypted files, fonts, storage.
- [Collaboration](/pdf/collaboration/): comments, people and live editing.
