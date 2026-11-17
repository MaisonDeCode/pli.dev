---
title: Shared interface
description: The people, comments, sharing, history, sync and notification components every Pli editor uses, from one import that does not pull in the Documents editor.
sidebar:
  order: 3
---

The interface that goes with the [shared features](/platform/collaboration/) is built once and used by every editor. Documents, PDF, Sheets and Decks all show the same avatars, the same comment threads, the same Share dialog and the same "Saved / Offline" indicator.

```tsx
import { AvatarStack, CommentThreads, ShareDialog, SyncIndicator } from "@pli.dev/react/collab";
import "@pli.dev/react/styles.css";
```

`@pli.dev/react/collab` is an entry point of its own: it imports `@pli.dev/core` and React only, never the Documents editor. Everything is also exported from `@pli.dev/react`, so existing imports keep working.

**Why it lives in `@pli.dev/react`.** Every React editor already depends on this package for its menus, dialogs and colour picker, so one stylesheet and one set of tokens style everything. A separate package would mean a second install for every editor and a second set of theme tokens to keep in step. The `collab` entry gives the isolation that matters (no Docs engine in the module graph) without that cost.

## Look and feel

The components follow Google Docs, Sheets and Slides: round avatars with a white ring, pill-shaped primary buttons, rounded cards with a soft shadow, and dialogs that open in the middle of the page with a dimmed backdrop. They use the same theme tokens as the rest of the editor (`--pli-bg`, `--pli-fg`, `--pli-border`, `--pli-accent`, ...), in light and dark mode, so one override themes everything; the Share button keeps Google's light blue pill in light mode and its darker twin in dark mode.

Anything that floats (popovers, menus, toasts, the Share dialog) has an **opaque surface**: it sets its own background and text colour, so it never shows the page through it, even when it is rendered outside the editor's own container.

Every control can be used from the keyboard: Tab order follows reading order, Escape closes what is open, lists open with the arrow keys, and every icon button has a name for screen readers.

## The shape of the chrome

Docs, Sheets, Decks and PDF share one look for their bars and their frame, from one set of variables in `@pli.dev/react`'s style sheet (the other three sheets add nothing of their own, a test checks it):

| Variable | What it shapes | Default |
|---|---|---|
| `--pli-chrome-radius` | the ends of the bars (toolbar, tools row, text bar): a pill | `1.25rem` (20px) |
| `--pli-frame-radius` | the corners of the editor's outer frame (it clips to them) | `0.75rem` |
| `--pli-frame-border` | the border of the frame | `1px solid var(--pli-border)` (`0` for none) |
| `--pli-bar-margin` | the space around a bar | `0.3rem 0.6rem 0` |
| `--pli-bar-padding` | the space inside a bar | `0.25rem 0.5rem` |
| `--pli-bar-gap` | the space between the controls of a bar | `0.25rem` |
| `--pli-bar-bg` | the surface of a bar, and of the fade at its ends | `var(--pli-bg)` (light and dark follow it) |
| `--pli-tool-radius` | the buttons in a bar | `999px` (round) |

Set them on the editor or on any ancestor (the style sheet declares none of them, so yours win): `.my-editor { --pli-chrome-radius: 0.5rem; }`. For square corners everywhere in one go, put `data-pli-chrome="square"` on the editor or any ancestor: radii and frame border go to nothing and the buttons go back to small square corners. An editor that fills a window (the playground) or sits in a frame of its own (the website's live editors) sets `--pli-frame-radius: 0; --pli-frame-border: 0` so there is no second rounded border.

**A bar is one row.** The class is `.pli-toolbar`; the component is `Bar` (`<Bar aria-label="Formatting" className="my-bar">`), which the four editors use for every toolbar. When a bar is wider than the editor it does not wrap onto more rows: it scrolls sideways, with the scroll bar hidden and a fade at an end that has more (`data-overflow` is `none`, `start`, `end` or `both`). The mouse wheel turns into a sideways scroll while the pointer is over a bar that has somewhere to go (a pinch, a sideways swipe and a bar that fits are left alone), **Left**, **Right**, **Home** and **End** move between the buttons (and scroll the one you reach into view), Tab does the same, and a tool that has just been turned on (`aria-pressed="true"`) is scrolled into view. Menus and pickers opened from a bar are `position: fixed` panels that sit outside its scroll area, so they are never cut off, and they have an opaque surface. `useBarScroll(ref)` gives the same to a bar of your own; the menu bar (File, Edit, ...) is not a scroll area, because its menus open inside it, so it wraps.

## People

| Component | Props | What it shows |
|-----------|-------|---------------|
| `Avatar` | `user`, `size?` | A picture, or initials on the person's colour. |
| `AvatarStack` | `people` (`PresentUser[]`), `max?`, `size?`, `onSelect?` | Overlapping avatars in each person's colour, faded when they are idle or away, with a "+3" that opens the full list. |
| `PresenceBar` | `peers`, `you?` | `AvatarStack` for a room's peers. The ready-made one for a toolbar. |
| `useRoomPeers(room)` | | The people in a `CollabRoom`, kept up to date. |
| `usePresentUsers(room, you?)` | | The same people merged by user, with a colour each and an activity state (`presentUsers` from core). |

### Cursors and outlines

Presence overlays are primitives: the editor knows where things are on screen, the primitive draws them. All of them are `aria-hidden` and ignore the mouse.

| Component | Props | Use |
|-----------|-------|-----|
| `PeerLayer` | `children` | The container. Position it over the canvas (`position: absolute; inset: 0`). |
| `PeerCursor` | `user`, `x`, `y`, `height?`, `label?` | A coloured caret with the person's name above it (a text caret, or a pointer in a deck or PDF). |
| `PeerOutline` | `user`, `rect`, `label?`, `variant?` | A rectangle in the person's colour: the cell they are editing, the object they selected. `variant` is `"cell"`, `"element"` or `"range"` (translucent fill). |

```tsx
<PeerLayer>
  {people.map((p) => <PeerOutline key={p.user.id} user={p.user} rect={rectOf(p.peers[0].state.editing)} label={p.user.name} variant="cell" />)}
</PeerLayer>
```

## Comments

| Component | Props | What it shows |
|-----------|-------|---------------|
| `CommentThreads` | `client`, `activeId`, `onActivate`, `draft?`, `anchors?`, `quote?`, `onClose?`, `filter?`, `empty?` | The comments panel: filters (Open, Resolved, Mine, Mentions, All), the threads, a composer for a draft. |
| `ThreadCard` | `client`, `thread`, `active`, `onActivate`, `attached?`, `missing?` | One thread: every comment with edit and delete, replies, resolve and reopen. |
| `Composer` | `users`, `placeholder`, `submit`, `onSubmit(body, mentions)`, `onCancel?`, `initial?` | A box with `@` mention autocomplete from the user directory. Ctrl or Cmd plus Enter sends. |
| `CommentBody` | `comment`, `users` | The text with mentions picked out. |
| `timeAgo(time)` | | "just now", "5m ago", "3h ago". |

`CommentThreads` never reads an editor's state. The editor says what to show for each thread through `quote(thread)` (the quoted text, a cell address, "Slide 3") and whether it is still attached through `anchors` (an `AnchorTracker` from core), and what to do when one is chosen through `onActivate` (scroll to it and select it).

```tsx
<CommentThreads
  client={session.comments}
  anchors={anchors}
  quote={(t) => t.anchor?.cell}
  activeId={active}
  onActivate={(id) => { setActive(id); if (id) grid.reveal(anchors.get(id)?.cell); }}
  draft={draft && { quote: draft.cell, onSubmit: (body, mentions) => session.commentOnCell(draft.cell, body, mentions), onCancel: () => setDraft(null) }}
/>
```

## Sharing

| Component | Props | What it shows |
|-----------|-------|---------------|
| `ShareDialog` | `client` (`ShareClient`), `open`, `onClose`, `title?`, `roles?`, `onCopyLink?` | "Share *name*": a box to add people by name or address, the list of people with access and a role menu each, and "General access" for the link. |
| `ShareButton` | `onClick`, `label?`, `restricted?` | The blue pill with a lock or globe icon that opens the dialog. |
| `RoleSelect` | `value`, `onChange`, `roles?`, `disabled?`, `label` | Viewer, Commenter, Editor. |

The dialog works on a `ShareClient` from core, which talks to your app through a `SharingStore` (see [Users and permissions](/platform/users/#sharing)). People are found with the same `UserDirectory.search` as @mentions. A person who is not allowed to share sees the list without the controls.

## Versions and activity

| Component | Props | What it shows |
|-----------|-------|---------------|
| `VersionHistoryPanel` | `history` (`VersionHistory`), `onClose?`, `onRestored?`, `activeId?`, `onPreview?` | A side panel: "Name current version", the named versions newest first with who and when, restore with a confirmation, and what changed since each. |
| `ActivityList` | `feed` (`ActivityFeed`), `limit?` | The activity feed as sentences ("Ana mentioned Ben"). |
| `ActivityToasts` | `feed`, `user` | Shows a toast when someone mentions you or replies to your comment. |

See [Versions](/platform/versions/).

## Status and notifications

| Component | Props | What it shows |
|-----------|-------|---------------|
| `SyncIndicator` | `status`, `unsynced?` | A cloud with "Saved", "Saving…", "Offline" or "Reloading…". |
| `useSyncStatus(sync)` | | `{ status, unsynced, version, lastResync }` of a `SyncClient`. |
| `OfflineBanner` | `status`, `unsynced?` | A bar under the toolbar while offline: "You are offline. N changes will be sent when you are back." Renders nothing otherwise. |
| `ToastProvider`, `useToasts()` | | `show({ text, kind?, action? })` and `dismiss(id)`. The region is `role="status"` so it is read out politely. |

## Floating surfaces

| Component | Props | Use |
|-----------|-------|-----|
| `Popover` | `open`, `onClose`, `anchor`, `label`, `align?`, `children` | A panel under any element, kept inside the window, closed by Escape or an outside click, with an opaque background. |
| `Dialog`, `Dropdown`, `MenuList` | | The existing primitives. They have the same opaque surface. |

## For an editor author

1. Make the session an [`EditorSession`](/platform/scripting/) (a dozen lines) so the shared pieces can drive it.
2. Call `attachSync(session, model, { room, comments, socket })` from `@pli.dev/core` and keep the `SyncClient` it returns.
3. Put `<PresenceBar>`, `<ShareButton>` and `<SyncIndicator>` in the title bar, `<OfflineBanner>` under the toolbar, a `<PeerLayer>` over the canvas, and `<CommentThreads>` in the side panel.
4. Write one `AnchorResolver` for your anchor so threads follow their content.

Nothing else is needed: comments, presence, history and sharing then behave as they do in Documents.
