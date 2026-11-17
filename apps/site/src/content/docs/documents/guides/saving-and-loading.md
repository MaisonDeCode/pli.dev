---
title: Saving and loading
description: Store a document as JSON and validate anything you load.
---

A document is plain JSON. Pli provides a versioned wrapper for storing it.

```ts
import { serializeDoc, parseDoc } from "@pli.dev/docs";

const json = serializeDoc(session.state);
localStorage.setItem("doc", json);

const doc = parseDoc(localStorage.getItem("doc")!);
const restored = new DocumentSession(doc);
```

`serializeDoc` wraps the document with a format name and a version number:

```json
{ "format": "pli.doc", "version": 1, "doc": { "id": "…", "type": "document", "title": "…", "blocks": [] } }
```

Page setup, the header and footer, and embedded images are part of the document and are saved with it. Undo history and selection are not saved. They belong to a session, not to the document.

## Validation

`parseDoc` checks everything before returning, and throws a `PliError` with code `invalid_document` and a path to the first problem:

```
doc.blocks[3].level: expected 1 to 6
```

It rejects unknown block types, unknown fields and marks, duplicate block ids, bad list depths and alignments, non-string text, and out-of-range sizes, margins and image dimensions. The header and footer are checked the same way as the body. For tables it checks that every row has one cell per column, that column widths add up to 1, that each cell has at least one block (except the placeholders under a merged cell, which have none), that every merged cell stays inside the table and covers each square only once, that nothing a cell can't hold (a table, a page break) is inside one, and that ids are unique across the whole table. Use it on anything that didn't come from your own code: uploads, API responses, pasted data, or output from a script.

If you already have an object rather than a string, call `validateDoc(value)`.

## Versions

A document saved by a newer release than the one reading it throws a `PliError` with code `unsupported`, rather than being half-read. When the format changes, older versions will be upgraded on load.
