---
title: Files and formats
description: Save a deck as JSON, export PowerPoint (PPTX) and PDF files, import PPTX, and what carries over.
---

## Saving

A deck is plain JSON, like a Pli document and a Pli workbook:

```ts
import { parseDeck, serializeDeck } from "@pli.dev/decks";

const text = serializeDeck(session.deck);   // { "format": "pli.deck", "version": 1, "deck": … }
const deck = parseDeck(text);               // checks it and names the place of a mistake
session.load(deck);                          // opens it and forgets the undo history
```

`parseDeck` checks that every slide's layout exists, that ids are unique, that every theme has its twelve colours, and that tables have one cell per column.

Pictures, the deck itself, templates and fonts can be kept in your own file storage instead of inside the deck: see [File storage](/decks/collaboration/#file-storage) (`storeImages`, `saveDeck`, `loadDeck`, `inlineImages`).

## PowerPoint (PPTX)

```ts
import { toPptx, toPotx, fromPptx } from "@pli.dev/decks";

const bytes = toPptx(session.deck);                 // a .pptx
const template = toPotx(session.deck);              // a .potx: the masters and layouts, no slides

const { deck, warnings } = fromPptx(fileBytes);     // .pptx, .potx or .ppsx
```

**Export** writes a slide master and theme for each Pli master, a layout for each Pli layout, and slides whose placeholders stay linked to their layout, so they inherit position and text style. Speaker notes become notes slides, and pictures become media parts (identical pictures are stored once). Hyperlinks, hidden slides, tables, groups, gradients, shadows, arrowheads and transitions are written too. The bytes depend only on the deck and the `date` option, so the same deck gives the same file.

**Import** reads the same parts, and handles the quirks of Google Slides exports. It applies each master's colour map (so a dark template that swaps background and text colours comes out right), resolves shape style references against the theme, flattens group transforms into slide coordinates, and reads pictures into `data:` URIs. Speaker notes, transitions and hidden slides come through.

Fonts are written by name (`Lora` stays `Lora`), with `pitchFamily` beside it so that a computer without the font picks a similar one. PowerPoint has no Google fonts: pass `{ fonts: "office" }` to `toPptx` to write the nearest Office font instead. Font files are not embedded in the PPTX. See [Fonts](/platform/fonts/#fonts-in-files).

Whatever can't be carried over is reported in `warnings`, never thrown:

| In a PPTX | What Pli.Decks does |
|---|---|
| Charts | Column, bar, line, area, pie, doughnut and scatter charts (and column + line combinations) become native charts, see [Charts](/decks/charts/). Other kinds (radar, surface, stock, bubble, waterfall, treemap…) become an empty dashed box with the chart's title, with a warning |
| SmartArt | Read from its cached drawing |
| Video, audio, embedded objects | Only the picture shown on the slide is kept |
| Freeform shapes (`custGeom`) | Kept as custom geometry: lines, curves and arcs, including arcs and guide formulas, on shapes and on shaped pictures such as circular frames. A shape that points at guides it doesn't define falls back to its box, with a warning |
| Fonts embedded in the file (`.fntdata`) | Not read: the font names are kept, so the text shows in that font where it is installed or supplied (see PDF below) |
| Vertical text, table styles | Not read |
| Comments | Read and written, with replies, authors and resolved state, as legacy and modern PowerPoint comments, see [Collaboration](/decks/collaboration/#in-powerpoint-and-google-slides) |
| Animations | Object animations are read, see [Animations](#animations) below; sounds, media commands and animations started by clicking a shape are skipped, with a warning |

A file that isn't a zip, or that has no presentation part, throws a `PliError` with code `invalid_document`. A zip that is cut short is read as far as it goes, with a warning. Files are read with limits on unpacked size, number of slides and nesting, so a file made to fill memory is refused.

Other details:

- Transitions: Pli's `flip`, `cube` and `gallery` are written as `push`, and `slide` as `cover`, because PowerPoint 2007's transitions have no 3-D versions; the exact duration is written in the PowerPoint 2010 extension, with a speed word for older readers.
- A line break inside a paragraph (`a:br`) is read as a newline in the run's text.
- Text colours that come from a shape's style, and plain hyperlinks, come back as the theme's hyperlink colour with an underline.

### Animations

Object animations (each slide's `animations`) are written as PowerPoint's `p:timing`: one main sequence with a step for each click, effects that start together grouped as PowerPoint groups them, and the build list for text and charts. Each effect is a real PowerPoint preset with its behaviours, so PowerPoint lists it by name in the animation pane (and LibreOffice reads them as its own presets):

| Pli | PowerPoint preset (id, subtype) |
|---|---|
| Entrance and exit: appear | Appear / Disappear (1) |
| fade | Fade (10) |
| fly | Fly In / Fly Out (2; subtype 1 from the top, 2 right, 4 bottom, 8 left) |
| wipe | Wipe (22; the same subtypes, `wipe(left)`…) |
| zoom | Zoom, the basic zoom (53, subtype 16) |
| spin | Grow & Turn (31): it grows while it turns |
| Emphasis: spin | Spin (8) |
| pulse | Pulse (26) |
| grow | Grow/Shrink (6) |
| motion | Custom motion path (class `path`, id 0): the points as a straight-line path in fractions of the slide size |

On click, with previous and after previous are the effect's node type; the delay is the effect's start delay; the duration is on the behaviours; repeats are `repeatCount`; easing is `accel`/`decel` (ease in is a full acceleration, ease out a full deceleration, both is half and half). Text built by paragraph is one effect for each paragraph with a `txEl` range. Animations that point at something that was not written (a picture that could not be embedded) and emphasis kinds PowerPoint has no preset for (a fade or fly as an emphasis) are left out.

**Import** maps PowerPoint's presets by id and class, and anything else by what its behaviours do: a fade filter is a fade, `wipe(...)` a wipe, an x or y animation from off the slide a fly (with the side from its values), a size animation a zoom, a rotation a spin, a size animation of an emphasis a grow, and a motion path a motion (curves are cut into straight pieces). A preset with no match, such as Bounce or Wheel, becomes the nearest of those (Fade for an entrance or exit, Pulse for an emphasis), and the warning names the preset and the shape. Also reported and approximated:

- Animations of a shape inside a group (only whole shapes of a slide can be animated), of a shape that is not on the slide, of part of a shape (letters, a chart's series: the whole shape is animated), and of only some paragraphs (all of the text is animated) are dropped or widened.
- Build by paragraph becomes one animation; if the paragraphs start in different ways (the first on click, the rest after it) they all start like the first.
- "Repeat until the end of the slide" runs once. Sounds, media commands and animations started by clicking a shape are not imported.
- Easing keeps only whether the start, the end or both are smooth, not how much; PowerPoint's default smooth end on a Fly In reads as ease out.
- An effect that starts after a group of effects that end at different times starts after the one before it, not after the whole group.
- A pulse is written as one half with "auto-reverse" (as PowerPoint does), so an odd duration in milliseconds comes back 1 ms off.

Not checked in PowerPoint itself: the file is well formed (`xmllint`), in schema order with unique ascending ids, and LibreOffice reads every effect as the matching preset, but no animation has been played in PowerPoint, Keynote or Google Slides.

## PDF

`deckToPdf` draws each slide from the same resolved scene the editor draws, onto `@pli.dev/docs`'s PDF writer: one page per slide, in the slide's size, with text as text (selectable and searchable), shapes as vector paths, links as links.

```ts
import { deckToPdf } from "@pli.dev/decks";

const { bytes, warnings } = await deckToPdf(session.deck, { title: "Launch plan" });
```

Options: `slides` (which slides, in order; skipped slides are left out unless named), `notes` (one portrait page per slide with the speaker notes under it), `fonts` (TrueType files to embed; text in a font that isn't given is drawn in the nearest standard PDF font), `rasterize`, `date` and `compress`. `toPdf` is the same without the `await`.

Pictures: JPEG and PNG pictures are read by Pli itself; for any other format give the host's own decoder as `rasterize` (a browser can draw the picture on a canvas and return its pixels). A picture that can't be decoded is drawn as a labelled grey box and reported in `warnings`.

The writer supports opacity, rotation, real gradients (linear and radial, including ones that fade to transparent), blurred shadows, and pictures that are rotated, mirrored, cropped or cut to a shape. These are approximated: a blurred shadow is drawn as a blurred picture of the shape, right-to-left text is not reordered, and a gradient's focus point is a circle sized by the shape's shorter side.

Fonts: the PDF uses the standard PDF fonts unless you give `fonts`. The editor's own File > Download > PDF gets the files for the fonts the deck uses from its [font registry](/platform/fonts/#pdf-files) and passes them for you; the registry's `pdfFonts(names)` makes the `fonts` object if you call `deckToPdf` yourself. Characters that no font has (Greek and Chinese with no font passed, say) are drawn as `?` and reported once in `warnings`, which says to pass fonts.

## Checked how

The PPTX writer and reader are tested in four ways:

- Against a real 20-slide commercial template, drawn through Pli's PDF and compared slide by slide with LibreOffice's rendering of the original.
- Against hand-built packages in the test suite: a PowerPoint-style `.potx`, a Google Slides-style export with a dark colour map, a 4:3 deck, and damaged and odd files.
- Against each other: every built-in theme at three sizes goes through export and import and comes back with the same colours, fonts, frames and layouts.
- With `xmllint`, and by rendering a sample with LibreOffice.

No file made by Pli has been opened in PowerPoint, Keynote or Google Slides yet, and no file saved by PowerPoint itself has been read. See the [roadmap](/decks/roadmap/).
