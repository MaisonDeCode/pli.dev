---
title: Pli.Forms roadmap
description: What Pli.Forms will do, in the order it will be built.
sidebar:
  order: 2
---

**Pli.Forms** is forms and surveys whose responses you own. It is number 5 on the [main roadmap](/roadmap/), and nothing is built yet. See [Forms](/forms/) for how it will be offered.

## To build

- [ ] Question types: short and long text, choice, scale, date and file upload
- [ ] Sections, branching logic and validation
- [ ] A form builder and a view for filling a form in
- [ ] Responses stored in [Pli.Databases](/databases/roadmap/) and viewable as [Pli.Sheets](/sheets/roadmap/)
- [ ] A results summary
- [ ] Export of the form and its responses

## Shared with every editor

These live in `@pli.dev/core` and the shared interface (`@pli.dev/react/collab`). They are already in [Pli.Documents](/documents/roadmap/), [Pli.PDF](/pdf/collaboration/) and the other editors, and each new editor picks them up as it is built. A new editor only writes its anchor and its merge rules:

- [ ] Comments, with @mentions and the same stores and permissions: [Comments](/platform/comments/), and an `AnchorResolver` so threads follow their content
- [ ] People and presence, and live editing over the same transport: [Realtime](/platform/realtime/), [Live editing](/platform/live-editing/) (`attachSync`, a `SyncModel`, the text-edit transform for rich text)
- [ ] Sharing, version history and an activity feed: [Users](/platform/users/#sharing), [Versions](/platform/versions/)
- [ ] The shared interface: avatars, comment threads, the Share dialog, version history, the sync and offline indicators: [Shared interface](/platform/shared-ui/)
- [ ] Undo and redo, and a session that scripts can drive: [Scripting](/platform/scripting/) (`EditorSession`, `ScriptHost`)
- [ ] File storage through the same storage client
- [ ] Swift and Kotlin: the editor behind the [native packages](/platform/swift-and-kotlin/)
