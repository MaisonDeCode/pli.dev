---
title: Storing files
description: Send images to your own storage (S3, Supabase, your server) instead of embedding them in the document, with upload progress, retries and export support.
---

By default an image becomes a base64 `data:` URI inside the document, so a document is one self-contained file. That is fine for a few small images, but the file grows fast. A **storage client** lets your app keep files where it already keeps files, and the document stores only a short reference to each one. Nothing changes unless you set one up.

## Quick start

You write a small *adapter*, which is a set of functions that talk to your storage. Pli wraps it in a `StorageClient`.

```ts
import { StorageClient, type StorageAdapter } from "@pli.dev/docs";

const adapter: StorageAdapter = {
  // Required. Store the file and return a reference to save in the document.
  async upload(file, { name, type, signal, onProgress }) {
    const { uploadUrl, key } = await createUpload(name, type); // e.g. a presigned S3 URL from your server
    await putFile(uploadUrl, file, { signal, onProgress });
    return { ref: key };
  },
  // Turn a reference into an address a browser can show. Leave out if your references are public URLs.
  resolve: (key) => signedUrlFor(key),
  // Fetch the bytes, so DOCX and PDF exports can include the image.
  read: (key) => downloadFile(key),
};

const storage = new StorageClient(adapter, { maxBytes: 10_000_000, allowedTypes: ["image/*"] });
```

Give it to the session, and the editor uses it for pasted, dropped and uploaded images:

```tsx
const session = useDocumentSession(initialDoc, { storage });
return <PliDocument session={session} />;
```

`fetch` can't report upload progress. If you want a progress bar, use `XMLHttpRequest` for the upload and call `onProgress` with a number from 0 to 1. If you don't, the image shows as uploading until it is done.

## What the document stores

The document keeps the `ref` your adapter returned, in the image's `src`. Make it something **stable**: a storage key or path, not a link that expires. If the file is public, the full `https://` address works too.

To show an image, Pli calls `resolve(ref)` and caches the answer for five minutes (`resolveCacheMs`), so signed URLs are refreshed without a request for every redraw. Pasted images from other pages keep their own `https://` address. Those go through `resolve` as well, so return an address you don't recognize as it is.

If an adapter returns a `url` from `upload` as well as a `ref`, that address is used straight away and `resolve` isn't called for it.

## What happens when someone adds an image

1. The file is checked against your limits. A file that is too big or the wrong type is refused with a message, before anything is shown.
2. A large image is scaled down first, as without storage.
3. The image **appears immediately**, from the file on the person's computer, dimmed with a progress bar.
4. It uploads in the background. Up to three uploads run at once.
5. When it finishes, the document points at the stored file. If nothing else was edited in the meantime, that joins the insert's undo step, so one undo removes the image.
6. If it fails, the image stays with **Retry** and **Remove** buttons. Nothing is lost.

While an upload is running, the document holds a temporary `blob:` address for that image. Don't save the document in that moment, or wait for it:

```ts
await session.whenUploadsSettle(); // resolves when no upload is running
const json = serializeDoc(session.state);
session.pendingUploads;            // how many are running right now
```

The built-in File menu waits for uploads before downloading or printing.

### Messages for refused files

`PliDocument` shows a notice above the page when a file is refused. To show it your own way, pass `onStorageError`:

```tsx
<PliDocument session={session} onStorageError={(error, file) => toast(error.message)} />
```

`error.code` is `invalid_operation` for a limit, `storage` for a problem with your adapter, and `cancelled` when an upload was stopped.

## Exporting

DOCX and PDF need the actual bytes, and Markdown and HTML need addresses. The exporters are plain synchronous functions, so you prepare the document first:

```ts
import { embedImages, resolveImages, toDocx, toMarkdown } from "@pli.dev/docs";

const { doc, failed } = await embedImages(session.state, storage);  // bytes as data: URIs, for DOCX or a standalone HTML file
const docx = toDocx(doc);

const links = await resolveImages(session.state, storage);          // addresses, for Markdown or hosted HTML
const md = toMarkdown(links.doc);
```

`failed` lists any image that couldn't be fetched, with the reason. Those images stay as they were, so the export shows a visible placeholder, never a blank. `embedImages` needs your adapter's `read`. DOCX can embed PNG, JPEG and GIF images, and other types are listed in `failed`.

The File menu in `PliDocument` does this for you and reports failures in the notice.

## Without React, and in scripts

The session does the work, so anything that can run it can upload:

```ts
session.insertBlockAtCaret(image(previewUrl, { width: 300, height: 200 }));
await session.uploadImage(block.id, file); // { status: "stored" | "failed" | "gone", merged }
session.uploadState(block.id);             // { status: "uploading", progress } or { status: "failed", error }
session.retryUpload(block.id);
session.cancelUpload(block.id);
```

Nothing in the storage code uses the DOM, `Blob`, `fetch`, timers or Node. Files are described by a small `BlobLike` shape (`size`, `type`, `arrayBuffer()`) that a browser `Blob` already fits, so the same client runs in JavaScriptCore and QuickJS for the Swift and Kotlin packages.

## Good to know

- **Files are never deleted for you.** Another document, or an undo, may still use a file. The adapter can offer `delete`, and you can call `storage.delete(ref)` when you know a file is unused.
- **Uploads in a header or footer** are tracked separately while you edit it. Leave header and footer editing only after they finish.
- **Images pasted from another web page** keep their original address. They are not copied into your storage.
- **A document with stored references** shows broken images where there is no storage client (a viewer that didn't set one up), because there is nothing to turn the reference into an address. Give read-only viewers the same client.
- **Default adapter.** `dataUriStorage()` is what you get without configuration, and you can pass it explicitly to keep the same code path in development.
