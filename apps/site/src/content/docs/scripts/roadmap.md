---
title: Pli.Scripts roadmap
description: What Pli.Scripts will do, in the order it will be built.
sidebar:
  order: 2
---

**Pli.Scripts** lets the people using an app built on Pli automate their own documents, inside a sandbox the app's developer controls. The session it will drive is built; the runtime is a [proposal](/platform/scripting/) so far. Scripts need the document API to be stable, and Pli.Documents is the first thing they will drive.

- [x] The session scripts drive, for every editor: `EditorSession` and `ScriptHost` (one undo step per run, a run that fails is taken back, grants for read, write, comments and create, limits on operations and time, an `onEdit` that cannot loop). See [Scripting](/platform/scripting/#the-editor-session)
- [ ] The sandboxed runtime that calls it, and the script-facing document API (read and edit the open document with `doc.blocks()`, `block.format()`)
- [ ] Scripts that create documents and add content to them
- [ ] Custom menu items that scripts add to the document's menu bar
- [ ] Triggers: on open, on edit, and on change in a sheet (the sheet part waits for Sheets)
- [ ] A switch for developers: scripting off by default (the per-capability grants exist in `ScriptHost`; the switch belongs with the runtime)
- [ ] Script authoring types (TypeScript definitions) for autocomplete
- [ ] Documentation developers can include in their own app's docs: a script author's guide, an API reference and examples, written so each capability's pages can be left out when it is turned off

How scripts reach other editors is part of each editor's own roadmap: custom functions for [Pli.Sheets](/sheets/roadmap/), for instance.
