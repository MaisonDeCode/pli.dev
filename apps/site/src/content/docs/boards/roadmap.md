---
title: Pli.Boards roadmap
description: What Pli.Boards will do, in the order it will be built.
sidebar:
  order: 2
---

**Pli.Boards** is a free-form canvas for notes, shapes and images. It is number 4 on the [main roadmap](/roadmap/), and nothing is built yet. See [Boards](/boards/) for how it will be offered.

## To build

- [ ] An infinite canvas model: notes, shapes, connectors, images and freehand drawing
- [ ] Frames, grouping and alignment tools
- [ ] A pan-and-zoom canvas with a tool palette and object inspector
- [ ] Export to image and to PDF through [Pli.PDF](/pdf/roadmap/)
- [ ] Live cursors and editing for several people at once

## Shared with every editor

These live in `@pli.dev/core` and the shared interface (`@pli.dev/react/collab`). They are already in [Pli.Documents](/documents/roadmap/), [Pli.PDF](/pdf/collaboration/) and the other editors, and each new editor picks them up as it is built. A new editor only writes its anchor and its merge rules:

- [ ] Comments, with @mentions and the same stores and permissions: [Comments](/platform/comments/), and an `AnchorResolver` so threads follow their content
- [ ] People and presence, and live editing over the same transport: [Realtime](/platform/realtime/), [Live editing](/platform/live-editing/) (`attachSync`, a `SyncModel`, the text-edit transform for rich text)
- [ ] Sharing, version history and an activity feed: [Users](/platform/users/#sharing), [Versions](/platform/versions/)
- [ ] The shared interface: avatars, comment threads, the Share dialog, version history, the sync and offline indicators: [Shared interface](/platform/shared-ui/)
- [ ] Undo and redo, and a session that scripts can drive: [Scripting](/platform/scripting/) (`EditorSession`, `ScriptHost`)
- [ ] File storage through the same storage client
- [ ] Swift and Kotlin: the editor behind the [native packages](/platform/swift-and-kotlin/)
