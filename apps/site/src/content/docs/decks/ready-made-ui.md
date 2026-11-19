---
title: The slide editor
description: PliDeck, a React slide editor in the style of Google Slides, with a filmstrip, canvas, toolbar, speaker notes, side panels, present mode and file menu.
---

`PliDeck` is a slide editor for React, laid out like Google Slides and driven by a [`DeckSession`](/decks/getting-started/). The deck lives in the session. Read `session.deck` to save it. Install it with `npm install @pli.dev/decks @pli.dev/decks-react` (it needs `react` and `react-dom` in your app). The playground has a demo in `apps/playground/src/decks`, which you can run from a clone of the repository.

```tsx
import { DeckSession, createDeck, serializeDeck } from "@pli.dev/decks";
import { PliDeck } from "@pli.dev/decks-react";
import "@pli.dev/decks-react/styles.css";

const session = new DeckSession(createDeck({ title: "Launch plan" }));

export function Editor() {
  return (
    <PliDeck
      session={session}
      onDownload={(file) => save(file.name, file.type, file.data)}   // optional: otherwise the browser downloads
    />
  );
}
```

## Props

| Prop | |
|---|---|
| `session` | The `DeckSession` to edit |
| `readOnly` | No editing: look through, present and download |
| `menu`, `toolbar`, `notes` | Show or hide the title and menus, the toolbar, and the speaker notes pane (all on by default) |
| `onDownload({ name, type, data }, { browserDownload })` | Receives each file File > Download makes, instead of the browser downloading it: keep it in your own storage, or show a phone's share sheet. `browserDownload()` is the default. See [Saving files your way](/platform/saving-files/) |
| `uploadImage(file)` | Turns a picture file into the address stored in the slide (your storage). Without it pictures are embedded as data |
| `users`, `comments`, `room`, `sync` | People, comments and live editing, see [Collaboration](/decks/collaboration/): `users` (a `Users`), `comments` (`true`, or a store and permissions), `room` (a `CollabRoom`) and `sync` (`true`, or `{ version, verifyEvery, onResync }`) |
| `fonts` | The fonts the pickers offer and how they load: `fonts={createFonts({ only: [...] })}`. Default: every font, from a CDN. See [Fonts](/platform/fonts/#giving-the-registry-to-the-editors) |
| `pdf` | Options for PDF export: `rasterize` and `fonts` (see [Files](/decks/files/#pdf)) |
| `onOpenPresenterWindow` | Called by the presenter view's "open in a new window" button |
| `theme` | `"auto"`, `"light"` or `"dark"`: match your app. `"auto"` follows `<html data-theme>` or the system. See [Theme and your own buttons](/platform/theme-and-buttons/) |
| `startActions`, `actions`, `endActions` | Your own buttons in the title row: at the far left before the name, beside the Slideshow button, and at the far right after it |
| `extraMenus` | Your own menu items and menus: `extraMenus={{ File: [{ label: "Share…", onSelect: share }], AI: [{ label: "Summarize", onSelect: summarize }] }}`. A name the editor has (File, Edit, View, Insert, Slide, Format, Arrange, Tools) gets the items at the end of that menu; any other name makes a new menu after Tools. See [Menus and file pickers](/platform/menus-and-file-pickers/) |
| `menuLabels` | New text for the built-in menus, or `false` to take an item out: `{ "File > Download": "Export", Tools: false }`. See [Your own menus and file chooser](/platform/menus-and-file-pickers/#rename-or-remove-built-in-items) |
| `filePicker(request)` | Your own way to choose files, used for File > Open, pictures, a slide background picture and importing a theme. `request` has `purpose` (`"open"`, `"image"` or `"import"`), `accept`, `multiple`, `label` and `browse()`, which opens the browser's chooser. Return a `File`, a list of them, or `null` to cancel. Without it the browser's chooser is used. Dropping and pasting files work either way. See [Menus and file pickers](/platform/menus-and-file-pickers/) |
| `history`, `versions`, `autoSaveVersions` | Version history, see [Versions](/platform/versions/). Give a `VersionHistory` (`deckVersionHistory(session, { storage, users })`) as `history`, or give `versions` (a `VersionStorage`, such as `memoryVersionStorage()` for a demo) with `users` and the editor makes the history itself. That adds View > Version history and a panel on the right. Choosing a version shows it read only, with a bar to restore it or go back (Esc also goes back); the slideshow button is off meanwhile. Restoring adds a new version (`Restored "…"`) and every earlier one stays. With `versions` an "Original" and then "Autosaved" versions are kept by themselves; `autoSaveVersions={false}` turns that off, or pass `{ every, keep, baseline }`. Saving and restoring need the `editor` role in `users` |

## What is in it

- **Filmstrip** on the left: thumbnails with numbers, select (shift and command for several), drag to reorder, a context menu (new, duplicate, delete, skip, move, layout, background), and a new-slide button with a layout picker.
- **Canvas**: select, move, resize (shift keeps the proportions), rotate, marquee select, nudge with the arrow keys (shift for 10 points), alt-drag to copy, and Google-style guides that snap to the slide's centre and edges and to other shapes. Double-click, or just type, to edit text.
- **Text editing**: bold, italic, underline, strike, colours, highlight, links, font (the Office fonts and 2,000 Google families, see [Fonts](/platform/fonts/)) and size, alignment, bullets and numbers, indents, line spacing; Enter, Shift+Enter (a line break inside the paragraph) and Tab (list level); typing, formatting and deleting in one burst are one undo step.
- **Picture placeholders** ("Click to add picture" on a layout's picture frame): click it, press Enter on it, drop a file on it, or Insert > Image while it is selected, and the picture fills the frame (cropped to cover it, in the frame's shape, such as a circle) and stays linked to the layout; deleting the picture brings the empty placeholder back.
- **Insert**: text box, picture (file, paste or drop), shapes from a catalogue of 80 PowerPoint preset shapes (lines and arrows included), tables (click a cell to type, Tab moves; add, remove and merge rows and columns).
- **Toolbar** with the controls for what is selected: fill, border colour, weight and dash, picture crop and shape mask, table cell options, and the Background, Layout, Theme, Master, Transition and Motion buttons.
- **Speaker notes** under the slide, with a draggable divider.
- **Side panels**: Theme (the [built-in themes](/decks/themes-and-layouts/), the colour scheme, the font pair, and **Import theme…** for [PowerPoint and Google Slides templates](/decks/templates/)), Transition (type, direction, duration, apply to all, advance after), [Motion](/decks/animations/) (the slide's object animations, their settings and a preview), and Format options (position, size, rotation, fill, line, shadow, alt text).
- **Slide menu**: new, duplicate, delete, skip, move, change background, **Hide background graphics** (a slide that doesn't show its master's and layout's decorations), layout, reset layout, transition.
- **Master view**: the Master button in the toolbar (or View > Edit master, or right-click a slide > Edit master / layout…) shows the master and each layout on the same canvas. Formatting a master or layout placeholder changes the text styles every slide inherits, level by level; a switcher lists the deck's masters (add, rename, delete), and layouts can be added, renamed, duplicated, moved and deleted, given placeholders and a background. Esc returns to your slide. See [Editing the master](/decks/themes-and-layouts/#editing-the-master).
- **Version history**: View > Version history (with a `history`, or `versions` and `users`) lists the named versions, the automatic ones and the restores. Click one to look at it in the editor, read only; Restore puts it back as a new version, and undo takes the restore back. See [Versions](/platform/versions/).
- **Present mode**: full screen with the Fullscreen API where there is one; arrows, space, Page Up and Down, Home, End, number plus Enter, `B` and `W` for black and white screens, click to advance, `L` for a laser pointer, `A` to finish the slide's [object animations](/decks/animations/) (which play step by step with the same keys that move between slides), Esc to leave. Transitions play as animations (and are skipped when the person asks for reduced motion), slides marked skipped are skipped, timed slides advance themselves, and the presenter view shows the current and next slide, the notes and a timer.
- **File menu**: New, Open (Pli JSON, `.pptx`, `.potx`), Download as PowerPoint, PDF, Pli JSON or template, Page setup. Whatever an imported file had that couldn't be read is listed in a banner that can be dismissed.
- **Edit and Arrange**: undo and redo, cut, copy and paste (pasting a picture adds it), duplicate, select all, find and replace through slide text and notes, order, align, distribute, group.
- **Comments, people and live editing** when you give it `users`, `comments`, a `room` and `sync` (see [Collaboration](/decks/collaboration/)): comment bubbles and the Comments panel (Insert > Comment, ⌘/Ctrl+Alt+M), avatars, each person's slide on the filmstrip, their selection and text cursor on the canvas, a banner to follow a presenter, and the sync state.
- The usual shortcuts: ⌘/Ctrl with Z, Shift+Z or Y, X, C, V, D, A, B, I, U, K, F, M (new slide), ⌘/Ctrl+Alt+M (comment), ⌘/Ctrl+Alt+Shift+M (skip the slide), `]` and `[` (indent), ⌘/Ctrl+Alt+G (group), ⌘/Ctrl+Enter (present from the beginning).

The look is set by CSS variables, `--pli-deck-*`, with light and dark values. On small screens the filmstrip collapses and the side panels become overlays. Everything can be operated from the keyboard. Toolbar buttons, menus and the filmstrip have roles and labels, and a picture's alt text is exposed on the canvas.

## Build your own

The parts are exported too: `SlideView` (draws a resolved slide at any size, and is what the thumbnails, the canvas and the slideshow use), `Filmstrip`, `SlideCanvas`, `DeckToolbar`, `NotesPane`, `PresentMode`, `FindBar`, the panels, the text editor, the `snap` function and the hooks `useDeckSession` and `useDeckRevision`. All of them draw from `session.scene(slideId)`, so a custom interface matches the editor, the PDF and the PPTX file.

## Not there yet

What is missing is listed on the [roadmap](/decks/roadmap/).
