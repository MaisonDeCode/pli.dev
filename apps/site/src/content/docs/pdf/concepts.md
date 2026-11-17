---
title: How it works
description: "The model, operations and session behind Pli.PDF: a PDF as plain JSON, every change as an invertible operation, ids that come from the file, and saving as the original plus a difference. With a table of every operation."
---

Every change in Pli.PDF, from an editor button to a script, goes through the same path:

```
  PDF bytes ──openPdf──▶  PdfDoc (plain JSON)
                              ▲  │
              PdfOp (JSON) ───┘  └──▶ session.save() ──▶ PDF bytes
              session.transact([...])    original + difference
```

The editor ([`PdfEditor`](/pdf/ready-made-ui/)), the commands (`session.annots`, `session.pages`…) and the sync are all built on this. If you write your own interface, you work with the same parts.

## The document

`openPdf` reads a file into a `PdfDoc`, which is JSON you can read, copy, store and compare.

```ts
interface PdfDoc {
  id: string;                          // names the document for comments and storage
  name?: string;
  meta: { title?, author?, subject?, keywords?, creator? };
  sources: Source[];                   // the PDF files whose pages are used: { id, name, pages, size, hash, location? }
  pages: Page[];                       // in order
  outline: OutlineItem[];              // bookmarks, a tree
  fields: FormField[];                 // form fields, each with its widgets
  comments?: Record<string, Thread<PdfAnchor>>;   // threads kept in the document
}

interface Page {
  id: string;
  from: { source: string; index: number } | null;   // a page of a source file, or null for a blank page
  width: number; height: number;                     // points, before turning
  rotate: 0 | 90 | 180 | 270;                         // how it is shown
  label?: string;
  annots: Annotation[];                               // bottom to top
  edits?: PageEdit[];                                 // staged changes to the page's content (redactions, text, pictures)
}
```

The document does not hold the pages' drawings or the bytes of the files. A page says which page of which file it is, and the bytes are in the [source store](/pdf/files/#storing-the-files). That keeps the JSON and the operations small, and it lets a page come from a different file than the one that was opened.

Every number is in points, every position in [page space](/pdf/annotations/#page-space), every colour `#rrggbb`.

### Ids come from the file

Things read from a file get ids made from where they are in the file: `p:main:3` (page 4 of the `main` source), `a:main:42` (the annotation in object 42), `f:person.name` (a field), `w:main:77` (a widget), `c:main:90` (a reply), `o:0.2.1` (a bookmark, by its place in the tree). So two people who open the same bytes agree on every id without coordinating, and that is what lets one person's operations apply to another's copy. New things get random ids (`p_x3k…`, `a_…`).

## Operations

Every change is a `PdfOp`, a small JSON object, applied by the reducer `pdfReducer`. It is a pure function. Given a document and an operation, it returns the new document and the operation that undoes it.

```ts
import { pdfReducer, emptyDoc } from "@pli.dev/pdf";

const { state, inverse } = pdfReducer.apply(doc, { type: "patch_page", id: "p:main:0", patch: { rotate: 90 } });
// inverse: { type: "patch_page", id: "p:main:0", patch: { rotate: 0 } }
```

Because every operation has an inverse, undo and redo come with it. Because operations are JSON, they can be logged, stored, replayed and sent to other people. An operation that cannot be applied (a page that does not exist) throws a `PliError` (`not_found` or `invalid_operation`) and changes nothing.

Operations position things by what they follow, not by number: `insert_page` takes `after` (the id of the page before it; `null` for first; left out for last). Two people who insert after the same page at the same moment cannot collide on an index.

### Every operation

| Operation | What it does |
|---|---|
| `set_meta { patch }` | Changes document information (`title`, `author`, `subject`, `keywords`, `creator`) and `name`. A value of `null` removes it |
| `insert_source { source }`, `remove_source { id }`, `patch_source { id, patch }` | The PDF files the pages come from |
| `insert_page { page, after? }` | Puts a page after another (`null`: first, left out: last) |
| `remove_page { id, prev? }` | Removes a page. `prev` is the page it followed, so that undo puts it back in place |
| `move_page { id, after }` | Moves a page after another (`null`: to the front) |
| `patch_page { id, patch }` | Changes `rotate`, `label` (`null` removes it), `width` or `height` |
| `insert_annot { page, annot, after? }` | Puts an annotation on a page, above `after` (`null`: at the bottom, left out: on top) |
| `remove_annot { page, id, prev? }` | Removes an annotation |
| `replace_annot { annot }` | Replaces the annotation with the same id, wherever it is |
| `move_annot { id, after }` | Changes its drawing order on its page |
| `insert_field { field, after? }`, `remove_field { id, prev? }`, `replace_field { field }` | Form fields, with their widgets, options and flags |
| `set_value { id, value }` | A form field's value |
| `set_outline { items }` | Replaces the whole outline |
| `set_edits { page, edits }` | Replaces a page's staged content edits |
| `set_thread { id, thread }` | Sets or (with `null`) removes a comment thread kept in the document |

The commands you saw on the other pages make these for you: `session.annots.addHighlight(…)` is an `insert_annot`, `session.pages.remove(ids)` is `remove_page`s plus the widgets, links, bookmarks and threads that went with the pages, all in one step.

## The session

`PdfSession` holds the current document, the history and the commands.

```ts
import { openPdf } from "@pli.dev/pdf";

const session = await openPdf(bytes);

session.transact([{ type: "patch_page", id: "p:main:0", patch: { rotate: 90 } }]);   // one undo step
session.doc;                       // the new PdfDoc: a new object, so `===` tells whether anything changed
session.undo();                    // true if there was something to undo
session.redo();
session.canUndo;
session.dirty;                     // changed since opened or last markSaved()
```

| | |
|---|---|
| `transact(ops, options?)` | Applies operations as one atomic undo step. If one throws, none is applied. `options.merge` joins the previous step (for drawing that goes on); `options.history: false` applies it as a normal change that is not an undo step |
| `subscribe(listener)` | Called after every change with `{ state, ops, origin, reset?, meta }`. `origin` is `"local"`, `"undo"`, `"redo"` or `"remote"`. Returns how to stop. This is how an interface redraws |
| `selection` | `{ page, annots, fields?, pages? }`: what is selected, saved with each undo step so that undo puts the selection back too |
| `select(partial)` | Changes the selection without making an undo step |
| `reset(doc)` | Replaces the whole document and forgets the history, as when a shared document is reloaded |
| `baseline` | The document as it was read from the file |
| `core` | The `Session` from `@pli.dev/core` underneath, which `SyncClient` is given |
| `sources`, `options` | The source store and the options `openPdf` was given |

The commands are plain methods that build operations and call `transact`: `session.annots`, `session.pages`, `session.forms`, `session.outline`, `session.content` and `session.comments`. You can use them or make your own operations directly. There is no other way to change a document.

To redraw on every change:

```ts
const off = session.subscribe((event) => {
  console.log(event.origin, event.ops.map((op) => op.type));
  render(event.state);
});
```

## Saving is the original plus a difference

`session.baseline` is the document as read. A save compares `session.doc` with it object by object, by id, and writes only what differs: a changed annotation replaces its object in place (`Annotation.ref` remembers which), a new one is added, a removed one is taken out of the page. Nothing else in the file is touched. So:

- An unchanged document saves as the exact original bytes.
- Appending the changes to the end of the file (an incremental update) keeps everything that was there, including digital signatures.
- Content that must leave the file (deleted pages, redactions) needs a new file. [Files](/pdf/files/) has the rules.

A client that opens the same file can also join a live session: its baseline is the file, and the operations take it from there. See [Collaboration](/pdf/collaboration/).

## Where things are

| In `@pli.dev/pdf` | |
|---|---|
| `model.ts` | The `PdfDoc` types |
| `ops.ts` | `PdfOp` and `pdfReducer` |
| `session.ts`, `commands/` | `PdfSession` and its commands |
| `open.ts`, `saver.ts` | `openPdf`, and writing a document back |
| `annots/`, `forms/`, `pages/`, `content/` | Reading and writing annotations, form fields, page changes and outline, and page content (text, search, redaction) |
| `cos/`, `fonts/` | The PDF file format itself: parsing, writing, encryption, fonts, pictures. Exported too (`PdfFile`, `Overlay`, `createPdf`…) for writing PDFs from scratch |
| `sync.ts` | `pdfSyncModel`: how operations merge for live editing |
| `versions.ts` | `pdfVersionSupport`, `pdfVersionHistory`: restoring a named version as a list of operations, and saying what changed ([Version history](/pdf/collaboration/#version-history)) |
| `sources.ts`, `storage-sources.ts` | The `SourceStore` for the bytes of the files: in memory, or over your `StorageClient` ([Files](/pdf/files/#storing-the-files)) |
| `pictures.ts`, `fonts-used.ts` | Fetching pictures that are web addresses when saving ([Annotations](/pdf/annotations/#pictures)), and which fonts a document needs ([Files](/pdf/files/#fonts)) |
| `sample.ts` | `makeSamplePdf()`: a small file with text, bookmarks, a form and links, for tests and first tries |

The file format layer is not part of the editing model, but it is public. `PdfFile.open(bytes)` reads any file, and `createPdf()` makes an empty one to build with `ContentBuilder` and `embedTrueType`.
