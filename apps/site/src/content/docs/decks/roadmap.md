---
title: Pli.Decks roadmap
description: What Pli.Decks does today and what is still to build.
sidebar:
  order: 2
---

**Pli.Decks** is a slide editor and engine with masters, layouts and themes. It is number 3 on the [main roadmap](/roadmap/). The engine, a React slide editor in the style of Google Slides, present mode, PPTX files in and out, template import and PDF export are built, tested and documented. See [Decks](/decks/) for how it is offered.

Everything below was built and tested without PowerPoint, Keynote, Google Slides or a browser. The files are checked by reading them back, with `xmllint`, and by rendering with LibreOffice. The items that remain need real software or real files from people.

## Still to do

- [ ] **More real templates**: one commercial PowerPoint template (20 slides, Google Slides origin) has been imported and compared slide by slide with LibreOffice's rendering of the original, and its shapes, gradients, shadows and tables come out close. Still to see: a template that PowerPoint itself made (`.potx`, with its own theme background styles), a Google Slides export that uses its built-in themes, and files with SmartArt or pictures in the theme background. Send them and any mismatch becomes a fixture and a fix
- [ ] **Open Pli's PPTX files in PowerPoint and Google Slides** (and Keynote): no repair prompt? Also `svgBlip` pictures, a `.potx` with no slides, the direction of push and cover transitions, and the layout `type` values for One column text and custom layouts. `PLI_PPTX_OUT=<dir> pnpm vitest run packages/decks/test/pptx-write.test.ts` writes a sample `.pptx` and `.potx` to open
- [ ] **Try the Motion panel and slideshow animations in a real browser**: smoothness, wipes (`clip-path`) and rotated objects, dragging to reorder and dragging motion-path points, the badge layout, and `prefers-reduced-motion`. The tests check the styles and the stepping, not how it looks or feels.
- [ ] **Play an exported deck's animations in PowerPoint**, and open a PowerPoint deck that has Bounce, Wheel, text builds and motion paths: the `p:timing` is well formed, in schema order, and LibreOffice reads every preset, but only the tests have judged it. `PLI_SOFFICE=1 PLI_SOFFICE_DIR=<dir> pnpm vitest run packages/decks/test/pptx-animation.test.ts` writes a sample with every kind to `<dir>/anim.pptx`
- [ ] **Look at the editor in a real browser and compare it with Google Slides**: the feel of dragging and snapping, the caret and selection in text editing, IME and phone keyboards, touch, full screen, and the slideshow transitions
- [ ] **Open a PPTX with a chart in real PowerPoint** and try Edit Data: the chart part's schema order and the embedded workbook are checked by tests only. Also the new master text (five prompt levels) in an exported deck
- [ ] **Look at the PDF in a real viewer** and compare fonts (text in a font Pli has no file for is drawn in the nearest standard PDF font; with the [font registry](/platform/fonts/#pdf-files) the fonts a deck uses are embedded)
- [ ] **Open a PPTX with comments in real PowerPoint and Google Slides**: written both as legacy and as modern comments (`toPptx(deck, { comments })`); the parts are checked by tests, `xmllint` and by reading them back, not by the programs. Look for a repair prompt, the replies in a thread, who wrote each, the resolved state (modern), and a comment made there coming back through `fromPptx`
- [ ] **Try people, presence and live editing with a real server and two browsers** (a Socket.io or WebSocket server running `createAuthority`): the avatars, the dots on the filmstrip, the selection outlines and text cursors, typing in one text box at once, and following a presenter. The merging is fuzzed and tested over a network that loses messages; how it feels (cursor movement, flicker, latency) is not
- [ ] **PowerPoint with Google fonts:** open a PPTX that names a Google font (`Lora`, say) in PowerPoint on a computer without it, and see which font it picks from `pitchFamily` (also one written with `{ fonts: "office" }`). See [Fonts in files](/platform/fonts/#fonts-in-files)

## Known limits

These are the engine's current behaviour, not open questions:

- Fonts embedded in a file (`.fntdata`, compressed MicroType Express) are not read: the font names are kept, and the text shows in the font where it is installed or, for PDF, supplied with `fonts`.
- Charts: no secondary axis (the series are merged, with a warning), no 3-D, radar, stock, bubble or waterfall charts (those become a labelled empty box), no trendlines or error bars, and charts are not rotated in PPTX. Video, audio and embedded objects keep their picture only; vertical text and table styles are not read (animations are, see [Files](/decks/files/#animations): Bounce, Wheel and the other presets Pli has no equivalent for are approximated, and animations of shapes inside groups, of letters and of chart series are widened or dropped). Arrowheads on custom open paths are not drawn.
- PDF export: a blurred shadow is a blurred picture of the shape, and right-to-left text is not reordered.
- Live editing: changing which layout a slide uses at the moment someone deletes that layout is the one change that is not merged (the second change is left out and that person's editor reloads); comments in a PowerPoint file made by PowerPoint carry no resolved state in the legacy form.
- A radial gradient with a focus point is drawn as a circle sized by the shape's shorter side (as LibreOffice draws it); how PowerPoint draws it on a tall or wide shape has not been compared.

## Shared with every editor

These are built once in `@pli.dev/core` and arrive in each editor as it is built, as they already have in [Pli.Documents](/documents/roadmap/). Comments, people and presence, live editing and file storage are built for Decks. See [Collaboration](/decks/collaboration/).

- [ ] Swift and Kotlin: the engine behind the [native packages](/platform/swift-and-kotlin/)

## Done

- [x] The model: masters (themes) with layouts, placeholders that inherit from layout and master, shapes, pictures, tables and groups, notes, transitions; saved as JSON
- [x] Operations, undo and redo, and the `DeckSession` editing commands
- [x] Twelve built-in themes, colour schemes and font pairs (any family of the [font list](/platform/fonts/)), custom layouts
- [x] PPTX export and import, `.potx` export, template import (`.potx`, `.pptx`, Google Slides exports) with scaling to another slide size
- [x] PDF export, with speaker notes pages, transparency, gradients, blurred shadows and rotated text and pictures
- [x] Freeform (custom geometry) shapes and shaped pictures, read from and written to PPTX, drawn in the editor and the PDF
- [x] The React editor: filmstrip, canvas, toolbar, speaker notes, side panels, theme editor, present mode with a presenter view, find and replace, clipboard, files
- [x] Native charts (column, bar, line, area, pie, doughnut, scatter and combos): read from and written to PPTX with an embedded workbook, drawn in the editor and PDF, with a data dialog
- [x] Editing the master: a Master button, master and layout text styles that change every slide, several masters, layout and placeholder tools
- [x] Picture placeholders that take a picture by click, drop or Insert > Image
- [x] A playground demo
- [x] Comments on a slide, an object or words, with replies, resolving and @mentions, the same stores and permissions as every editor, kept in the deck or in your store, read from and written to PPTX (legacy and modern comments), with bubbles, a filmstrip count and the Comments panel (Ctrl+Alt+M)
- [x] People and presence: avatars, each person's slide on the filmstrip, their selected objects and text cursors on the canvas, and following a presenter through a slideshow
- [x] Live editing: `deckSyncModel` merges two people's changes to values, text (character by character), tables, charts, masters, notes, slides and layers, with a convergence fuzzer; each person's own undo; `PliDeck`'s `sync` prop and sync indicator
- [x] File storage through the shared storage client: pictures, the deck, templates and fonts
