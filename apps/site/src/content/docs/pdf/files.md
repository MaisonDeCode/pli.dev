---
title: Files
description: Save a PDF as an update of the original, a new file, an optimised file or a flattened one, what keeps digital signatures valid, encrypted files, fonts for text, and keeping source files in your own storage.
---

## Saving

```ts
const bytes = await session.save();                 // a Uint8Array

const result = await session.saveDetailed({ mode: "optimise" });
result.bytes;  result.mode;  result.warnings;
session.markSaved();                                 // session.dirty is false until the next change
```

`save` gives the bytes; `saveDetailed` also says how the file was written (`mode`: `"incremental"` or `"rewrite"`) and what could not be written exactly (`warnings`, plain sentences you can show). `save` does not call `markSaved`, because you may not have stored the bytes yet.

Saving does not change the session. Every save is the original file plus the difference between what was read and what the document is now, so you can save as often as you like.

| Option | |
|---|---|
| `mode` | `"auto"` (default), `"incremental"`, `"rewrite"` or `"optimise"`. See below |
| `flatten` | `true`, `"annotations"` or `"forms"`: draw them into the pages and remove them. Writes a new file |
| `fonts` | Font files for text boxes, signatures and form fields, by name. See [Fonts](#fonts) |
| `authorNames` | `{ [PliUser.id]: name }`, the names written to the PDF for comments and replies, when the `Users` directory is not at hand |
| `scrub` | Take what identifies the document out of a new file: information (title, author), XMP metadata, attached files, JavaScript, thumbnails and private application data. Needs `mode: "rewrite"`; `session.content.scrubMetadata()` does both |
| `fetch` | How to fetch pictures that are web addresses (annotation pictures kept in your storage, a replaced picture). Default `globalThis.fetch`. See [Pictures](/pdf/annotations/#pictures) |

### The modes

Incremental mode appends the new and changed objects and a new cross-reference section to the end of the original bytes. Everything that was in the file stays exactly as it was, byte for byte. It is small and fast, and it is what keeps digital signatures valid (see below). `auto` chooses it whenever nothing has to leave the file.

Rewrite writes a new file from the objects that are still used. `auto` does it when it must: pages were deleted, content was redacted or replaced, or `flatten` was asked for (an update could only hide that content, not remove it). `mode: "rewrite"` asks for it. Unused objects are dropped.

Optimise is a rewrite that also compresses streams that were not compressed, packs small objects into object streams and puts the cross-reference into a stream (PDF 1.5). It makes files smaller when they were written wastefully. It does not change pictures: nothing is resampled or recompressed lossily. A file that was already compact gains little.

Incremental mode fails with a `PliError` (`invalid_operation`) that says why when the change cannot be an update; `auto` never fails that way.

A file with no changes saves as the exact original bytes.

```ts
session.saveDetailed();                          // { mode: "incremental" } after highlighting
session.pages.remove([page]);
session.saveDetailed();                          // { mode: "rewrite" }: a page must go
session.save({ mode: "incremental" });           // throws: pages were deleted (their content must not stay in the file)
```

### Flatten

```ts
await session.save({ flatten: "annotations" });   // highlights, notes, shapes... become part of the page
await session.save({ flatten: "forms" });         // field values become part of the page; the form is gone
await session.save({ flatten: true });            // both
```

Each annotation's appearance is drawn into the page's content and the annotation is removed. Links stay links. The new file cannot be changed back, so do it on a copy. An annotation with no appearance cannot be drawn, and the save says how many were left.

### Document information

```ts
session.transact([{ type: "set_meta", patch: { title: "Service agreement", author: "Sam" } }]);
session.doc.meta;       // { title, author, subject, keywords, creator }
```

The modified date is set on every save. A file made from nothing (`emptyDoc`, then pages added) gets `Pli.PDF` as its producer.

### What the warnings say

`saveDetailed().warnings` lists things that were written differently from what you asked. For example:

| | |
|---|---|
| "No font file was given for "Lora": Helvetica is used instead…" | A text box or field asked for a font Pli does not have a file for. Pass `fonts` |
| "Some characters are not in the standard fonts and were written as ?" | The same, for characters the standard fonts lack |
| "A picture could not be embedded… a placeholder box is drawn" | A picture was neither a PNG nor a JPEG |
| "The picture … could not be fetched (…), so it is not embedded" | A picture's web address could not be fetched: the annotation is drawn as a placeholder box, and a picture replacement keeps the old picture. See [Pictures](/pdf/annotations/#pictures) |
| "The file has a digital signature. This save writes a new file, so the signature no longer matches it" | A rewrite or flatten of a signed file |
| "The original file is encrypted: the saved file is a new, unencrypted copy." | See [Encrypted files](#encrypted-files) |
| "The form has XFA data, which does not follow the changed values: it was removed…" | See [Forms](/pdf/forms/#saving) |
| Redaction notes: a JPEG removed whole, a drawing removed, text that is also in a title or bookmark | See [Text, search and redaction](/pdf/text-and-redaction/) |

## Digital signatures

A signed PDF stores a signature over the bytes of the file up to the end of the signed revision. An incremental update leaves those bytes alone, so the signature still checks out against them. That is why `auto` appends whenever it can, and why filling a form, adding annotations or comments, and merging pages in all keep a signature valid.

Two limits:

- A new file does not keep it. Rewrites and flattening change the bytes the signature covered. The save warns when the original has a signature field that is signed.
- What a reader accepts is up to the signature. A signature can say which later changes are allowed (none, form filling, or annotations too). Readers may show "changed after signing" for an update the signature does not allow. Pli.PDF does not read those permissions. A check in Acrobat is on the [roadmap](/pdf/roadmap/).

Pli.PDF does not make or check cryptographic signatures. It keeps the ones in a file and can add an empty signature field for someone else to sign (see [Forms](/pdf/forms/)). The signature annotation (a drawn, typed or uploaded signature placed on the page, or in a signature field with `forms.sign`) is a picture. Signing needs a private key and a certificate, which belong to your server or the person's device.

## Encrypted files

PDF passwords use the standard security handler: RC4 40 and 128 bit, AES 128 and AES 256. Pli.PDF reads all of them, with the empty user password or the one you give (the user or the owner password):

```ts
const session = await openPdf(bytes, { password: "…" });
```

- An update stays encrypted. New strings and streams are encrypted with the file's own key, and the original `/Encrypt` entry is kept, so the file still asks for the same password. The password is remembered for saving.
- A new file is not encrypted. A rewrite, optimise, flatten, extract or split writes an unencrypted file, and a page merged in from an encrypted file is stored unencrypted. If you need it encrypted, do that afterwards with your own tools. Pli.PDF cannot set passwords or permissions.
- Permission flags are not enforced. A file that forbids printing or copying with an owner password, but opens with an empty user password, opens and can be edited here. Respecting those flags is up to your app.

A wrong or missing password throws `PliError` with code `unsupported` and the message `password required` or `wrong password`.

## Fonts

Text in annotations (text boxes, typed signatures) and in form fields is drawn into the file, so it needs a font. The standard fonts (Helvetica, Times, Courier, bold and italic) need nothing and write Western European text. For anything else, give the font file as TrueType (a `.ttf`, or the first font of a `.ttc`), by the name the document uses. OpenType fonts with PostScript outlines (CFF) and fonts whose licence bits forbid embedding are not supported, and the save warns and uses a standard font:

```ts
const { bytes } = await session.saveDetailed({
  fonts: { Lora: regular, "Lora bold": bold, "Lora italic": italic, "Lora bold italic": boldItalic },
});
```

The names are the family, then `bold`, `italic` or `bold italic`, in any case. A missing bold or italic file uses the regular one and warns. The font is embedded in the file, cut down to the characters that were used, with a map so the text can still be selected and searched.

`FontRegistry.pdfFonts` from `@pli.dev/core` returns exactly this shape, for the same fonts the editor offers, and `documentFonts(session)` says which families and letters the document needs (text boxes, typed signatures, form fields and staged text edits; the standard fonts need no file):

```ts
import { defaultFonts } from "@pli.dev/core";
import { documentFonts } from "@pli.dev/pdf";

const { families, text } = await documentFonts(session);
const { fonts, warnings } = await defaultFonts().pdfFonts(families, { text });   // warnings: families it could not get
const bytes = await session.save({ fonts });
```

The registry loads font files from its source (by default a CDN; see [Fonts](/platform/fonts/)), so do this where the network is available, or give the registry your own source. Families it has no file for are left out, and Pli draws the nearest standard font and warns.

The editor does this for you. Give `PdfEditor` (or `PliPdf`) a `fonts` registry and every Save, Download, Print, flatten, extract and split fetches the files the document needs and embeds them; what could not be fetched is listed in the warnings dialog. See [The PDF editor](/pdf/ready-made-ui/#fonts). Text that you changed with `session.content.replaceText` uses the same fonts: `session.content.editFonts()` lists what those edits need, and `documentFonts` includes it.

## Storing the files

:::note
The code here and in the Fonts section above imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::

A document's JSON does not hold the bytes of the PDFs it uses, because operations would be huge and could not be sent to other people. The bytes are kept in a `SourceStore`, by source. The first source, `main`, is the file you opened, and every file you merge in becomes another.

```ts
interface SourceStore {
  get(source: Source): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  put(source: Source, bytes: Uint8Array): void | Promise<void> | Promise<{ location?: string }>;
}
```

A `Source` is `{ id, name, pages, size, hash, location? }`. `hash` is a fingerprint of the bytes, so two clients can check that they hold the same file. `location` is where the bytes can be fetched, set by your storage when `put` returns it.

`openPdf` puts the file in the store it is given. The default is `memorySourceStore()`, which keeps everything in memory:

```ts
import { memorySourceStore, openPdf } from "@pli.dev/pdf";

const session = await openPdf(bytes, { sources: memorySourceStore() });
```

`storageSources` is a `SourceStore` over the same [storage client](/documents/guides/storing-files/) that keeps the pictures of a document, so one adapter (S3, Supabase, your server) does both. It uploads each file once, under the name `<key>/<fingerprint>.pdf`, so the same file is stored once, and `put` returns where it went (`location`), which a merge records in the `Source` so that every client can find it. `get` finds the bytes by `source.location` (or by what this store uploaded itself), and checks that they are the file the source describes. This example runs against a map:

```ts
import { StorageClient, type StorageAdapter } from "@pli.dev/core";
import { openPdf, storageSources } from "@pli.dev/pdf";

const files = new Map<string, Uint8Array>();
const adapter: StorageAdapter = {
  async upload(file, { name }) {
    files.set(name, new Uint8Array(await file.arrayBuffer()));
    return { ref: name };
  },
  read: async (ref) => {
    const bytes = files.get(ref);
    if (!bytes) throw new Error(`no file ${ref}`);
    return { size: bytes.length, type: "application/pdf", arrayBuffer: async () => bytes.slice().buffer };
  },
};

const storage = new StorageClient(adapter, { allowedTypes: ["application/pdf"], maxBytes: 200_000_000 });
const sources = storageSources(storage, { key: "contracts/42" });
const session = await openPdf(bytes, { sources });          // the file is uploaded
const again = await session.mainBytes();                    // and read back from storage
```

Options of `storageSources(storage, options)`:

| Option | |
|---|---|
| `key` | The folder the files are named under (`<key>/<fingerprint>.pdf`): usually the document's id. Default `pdf` |
| `fetch(url)` | Fetch the bytes from the address `storage.resolve(location)` gives, with your own `fetch` (signed URLs, a token). Without it, the adapter's `read` is used |
| `verify` | Check that what comes back has the fingerprint of the source (default `true`) |

`session.mainBytes()` gives the bytes of the file that was opened. A save, a merge and the viewer all ask the store for the bytes they need, one file at a time; a store that cannot find one makes a save fail with a `PliError` (`storage`) that names the file.

Saved output is not kept by the session: store what `save` returns wherever your app keeps documents, and tell the session with `markSaved()`.

## Downloading

In a browser, hand the bytes to the user as a file:

```ts
function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}
```

## In the viewer: the File menu

The title row shows the document's name with a dot when there are unsaved changes (`session.dirty`). Click the name to rename the document. The name is kept in the session (and can be undone) and is used for downloads. The **File** menu is the first of the [menu bar](/pdf/toolbar/), and a **Save** button is at the end of the toolbar.

**Save** calls your `onSave(bytes, result)` after `session.saveDetailed()`. The document counts as saved (`session.markSaved()`, which clears the dot) only when the promise you return resolves. If it rejects, the dot stays and an error is shown. If the save had warnings (a font that could not be fetched, a picture that could not be fetched, a redaction note), a dialog lists them.

```tsx
<PdfEditor
  session={session}
  renderer={renderer}
  fonts={fonts}   // the font files the document needs are embedded on every save
  onSave={async (bytes) => {
    await fetch(`/files/${session.doc.id}`, { method: "PUT", body: bytes as BodyInit });
  }}
  onOpen={async (bytes, name) => setSession(await openPdf(bytes, { name }))}
  warnOnUnload
/>
```

`PliPdf` and `AnnotatedPdf` take the same props. The File menu has:

- **Open PDF** and **Create PDF from pictures** appear only when you give `onOpen`. They ask first when there are unsaved changes.
- **Download** is a submenu with **PDF document** (the file as it is), **Optimised PDF** (`-optimised`), **Flattened PDF** (`-flattened`: annotations and form fields drawn into the pages), **Form data (.json)** (the values of the fields, which Import data reads back; off when there is no form), **Pages as pictures**, and **More download options**, which opens the dialog with every choice: keep the original (an update at the end of the file, so signatures stay valid), a smaller file (`mode: "optimise"`), flatten annotations and form fields, or flatten form fields only, and an option to remove the author and other identifying data. When it is done the dialog shows the size next to the original's, whether the file was updated or rewritten, and any warnings.
- **Save a copy** downloads the document as it is as `name-copy.pdf`, without marking it saved.
- **Download > Pages as pictures** makes PNG or JPEG files of the selected pages, all pages or a range, at 72 to 600 dpi, as one ZIP or one by one, with progress and a Stop button. The pictures are drawn from the saved file, so annotations and filled-in fields are in them. A very large page is drawn smaller to keep the picture within what browsers can make.
- **Document properties** shows and sets the title, author, subject and keywords, and tells the page count and size, file size, PDF version and whether the file is protected.
- **Print** prints the saved file from a hidden frame, so the browser's own PDF viewer prints it. Where the browser cannot do this a message says so and suggests downloading.

`onDownload(bytes, name, mime, { browserDownload })` takes over every download (a native app's save dialog, say; call `browserDownload()` for the default), and `onPrint` takes over printing. A `DownloadProvider` sets the download for every editor in an app: see [Saving files your way](/platform/saving-files/). `downloadBytes`, `downloadFiles` and `makeZip` are exported for your own use.

