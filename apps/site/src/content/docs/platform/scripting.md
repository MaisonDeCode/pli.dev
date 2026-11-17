---
title: Scripting and the editor session
description: The one session contract every Pli editor offers, and how scripts drive it safely. The sandboxed runtime is still a proposal.
sidebar:
  badge:
    text: Session built, runtime draft
    variant: caution
---

**Status:** the **session contract** below is implemented and tested for Documents, PDF, Sheets and Decks. The sandboxed JavaScript runtime that calls it (the rest of this page) is still a proposal.

## The editor session

Every editor has its own session with its own commands, and every one of them sits on the same core `Session`. `EditorSession` is the view they all offer, so that scripts, shared interface, servers and tests are written once:

```ts
import { documentEditorSession } from "@pli.dev/docs";   // pdfEditorSession, sheetEditorSession, deckEditorSession likewise

const editor = documentEditorSession(session);

editor.kind;                       // "document" | "sheet" | "deck" | "pdf" | yours: the name its model is registered under
editor.state;                      // the current state, plain JSON
editor.transact(ops);              // one undoable step, sent to everyone if shared
editor.undo(); editor.redo();
editor.subscribe((event) => …);    // { state, ops, origin: "local" | "undo" | "redo" | "remote" }
editor.serialize();                // canonical JSON of the state (keys in order): what a file or a version stores
editor.hash();                     // a short fingerprint; equal states have equal ones
editor.enableComments({ users });  // turns comments on; editor.comments is the client
editor.attachSync(room, { socket });  // goes live: see Live editing
editor.script({ grants: ["read", "write"] });   // a host to run scripts
```

| | What it is |
|---|---|
| `core` | The core `Session` that holds state and history (what `SyncClient` is given). |
| `model` | The editor's `SyncModel`: how its operations merge. The same object a server registers for this kind. |
| `transact` | The editor's own, where it does more than the core one: a sheet checks protection and updates formulas, a PDF keeps the selection with each undo step. |

Writing one for a new editor is `createEditorSession({ kind, core, model, transact?, comments? })`.

### Running a script

A script never touches the state. It receives a context whose `apply` issues operations through the session, so every action is undoable, synced and checked against what the developer granted:

```ts
const host = editor.script({ grants: ["read", "write"], maxOps: 1000, maxMs: 2000, allow: (op) => op.type !== "delete_block" });

host.run((ctx) => {
  const title = ctx.state.title;          // needs "read"
  ctx.apply([{ type: "set_title", title: title.toUpperCase() }]);   // needs "write"
});
```

- **One run is one undo step**, however many times it calls `apply`.
- **A run that throws is taken back**, so a script that fails half way leaves nothing behind. (It stays on the redo stack.)
- **Grants.** `read`, `write`, `comments`, `create`. What is not granted throws, and `ctx.can("comments")` says what is.
- **Limits.** `maxOps` and `maxMs` are checked each time the script applies something; `allow` refuses operations (to keep a script out of protected ranges).
- **No loops.** `host.onEdit(handler)` is called for changes to the file but **not** for the ones a script made, so a handler that edits cannot start itself again. Pass `{ remote: false }` to ignore other people's changes too.

Not built yet, and tracked on the [Pli.Scripts roadmap](/scripts/roadmap/): the sandbox that calls `ScriptHost`, the script-facing API on top of each editor (`doc.blocks()`, `block.format()`), custom menu items, and the iOS and Android runtimes.

## Goal

Let people using an app built on Pli write small scripts that read and change their documents, and let the app developer decide exactly what those scripts may do.

## Scope

Pli Scripts lets the people using an app built on Pli write scripts for the documents they work in. A script can:

- **Read and change the open document**: find text, format it, insert and delete blocks, edit tables.
- **Create new documents** and fill them in, for example a report built from the data in another document. Later, the same for sheets.
- **React to things happening**: when a document opens or is edited, and, once Sheets exists, when cells in a sheet change, so a script can keep other content up to date.
- **Add custom menu items** to the document's menu bar, so a script is something a person runs from a menu, not only from a script editor.

The app developer decides whether any of this exists in their app.

- **Off by default.** Scripting is switched on by the developer. When it is off, no script runtime is loaded and there is no scripting UI.
- **Granted per capability.** Turning it on does not grant everything. The developer chooses what scripts may do (read, write, create documents, add menus, call out to the network).
- **Documented for their users.** Pli will ship documentation for script authors that a developer can include in their own app's docs: a guide, an API reference and examples. Each capability's pages can be left out when that capability is off, so the docs a user reads describe only what their app allows.

### Planned order

| Stage | Includes |
|-------|----------|
| First | Runtime, the document API, `onRun` and `onOpen`, per-run limits, the developer's on/off switch and capability grants, authoring types, and script author documentation |
| Next | Creating documents from a script, custom menu items, `onEdit` |
| After Sheets exists | Creating sheets, and triggers for changes in a sheet |
| Later | `http.fetch` with an allowlist, iOS and Android runtimes |

## Shape of the API

Scripts are JavaScript. They never touch the document directly: they receive a handle that issues [operations](/documents/concepts/operations/), so every script action is undoable, loggable and permission-checkable.

```js
// A user script
function onRun(ctx) {
  const doc = ctx.document;
  for (const block of doc.blocks()) {
    if (block.type === "heading" && block.text().startsWith("TODO")) {
      block.format({ highlight: "#ffeb3b" });
    }
  }
  doc.append("Last checked: " + new Date().toDateString());
}
```

Planned entry points:

| Entry point | Runs when |
|-------------|-----------|
| `onRun(ctx)` | The user runs the script by hand |
| `onEdit(ctx, change)` | The document changes |
| `onOpen(ctx)` | The document opens. A good place to add custom menu items |
| Custom functions | Called from inside a document, once sheets exist |

A script that adds a menu item and creates a document might look like this. The names are a sketch, not settled:

```js
function onOpen(ctx) {
  ctx.ui.addMenu("Reports", [{ label: "Summarize headings", run: "summarize" }]);
}

function summarize(ctx) {
  const summary = ctx.app.createDocument("Summary");
  for (const block of ctx.document.blocks()) {
    if (block.type === "heading") summary.append(block.text());
  }
}
```

`ctx.app` and `ctx.ui` only exist if the developer granted creating documents and adding menus.

## Safety model

The host app, not the script, holds all authority.

- **Sandboxed runtime.** Scripts run in an isolated JS context with no network, file, timer or global access unless the host grants it.
- **Capabilities.** The host passes in the capabilities a script may use, such as `document.read`, `document.write` and `http.fetch(allowlist)`. Anything not granted does not exist in the script's world.
- **Limits.** CPU time, memory and operation count per run, enforced by the host.
- **Everything is an op.** Script edits go through `Session.transact`, so they appear in history and can be undone as one step.

## Runtimes

| Platform | Sandbox |
|----------|---------|
| Web | A separate realm: a Web Worker or a QuickJS build compiled to WebAssembly |
| iOS | A separate JavaScriptCore context |
| Android | A separate QuickJS runtime |

## Open questions

1. Sync or async API? Sync scripts are simpler to write and to limit; async is needed for `http.fetch`.
2. How are scripts stored and versioned: in the document, or by the host app?
3. What is the TypeScript surface for the editor experience (autocomplete for script authors)?
4. How do triggers like `onEdit` avoid infinite loops when a script edits the document?
5. Can a script open or read other documents in the app, or only the one it was run from?
6. How does a custom menu item from a script look next to the built-in menus, and can the developer restrict where scripts may add menus?
