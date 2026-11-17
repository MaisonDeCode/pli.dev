---
title: Get started
description: Make a deck with the headless engine, add slides, text and shapes, change the theme and layout, read a slide's resolved look, and undo changes.
---

Install the engine and the React slide editor:

```sh
npm install @pli.dev/decks @pli.dev/decks-react
```

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. The editor needs `react` and `react-dom` 18 or 19 in your app. Its stylesheet already includes the shared toolbar and menu styles from `@pli.dev/react`. The engine has no peer dependencies. Both packages are ESM and ship their own TypeScript types; [Releases and versioning](/platform/contributing/releases/) has the rest.

```ts
import { DeckSession, createDeck, paragraphsFromText, builtinTheme } from "@pli.dev/decks";

const s = new DeckSession(createDeck({ title: "Launch plan" }));   // one title slide
const first = s.deck.slides[0]!;
const [title, subtitle] = first.elements;                          // its two empty placeholders

s.setText(first.id, title!.id, paragraphsFromText("Launch plan"));
s.setText(first.id, subtitle!.id, paragraphsFromText("Q3 and Q4"));

const second = s.addSlide();                                       // "Title and body", after the first
s.addTextBox(second.id, { x: 60, y: 300, w: 300 }, "A note");
s.addShape(second.id, "rightArrow", { x: 400, y: 280, w: 160, h: 60 });
s.undo();                                                          // takes the arrow back
```

## The model

A deck is plain JSON (`serializeDeck` / `parseDeck` write and check it):

- `size`: the slide size in points, 720 × 405 by default (Google Slides' 16:9). PowerPoint's widescreen is 960 × 540.
- `masters`: each is a **theme** (12 colours, a heading font and a body font), a background, shapes drawn on every slide, **text styles** for titles, body text and other text (nine levels each), and its **layouts**.
- `layouts`: the arrangements a slide can take (Title slide, Title and body, Section header, Two columns, Title only, Blank…): placeholders with a position and a text style, and decorations.
- `slides`: a `layout` (by id), a `background` if it overrides the layout's, `elements` in drawing order, `notes`, and optionally a `transition` and `skipped`.
- `elements`: shapes (any of the preset geometries, with an optional text body, as in PowerPoint), pictures, tables, groups and [charts](/decks/charts/).

A **placeholder** on a slide is linked to the layout's placeholder of the same type, which is linked to the master's. Whatever the slide leaves unset it inherits: its position, size, fill, and the font, size, colour, bullets and spacing of its text. Dragging a placeholder gives it a position of its own; `resetSlide` takes it back.

Colours are either `#rrggbb` or a theme colour (`{ theme: "accent1", lumMod: 0.75 }`), so changing the theme recolours the deck. Fonts can be `+mj-lt` (the theme's heading font) or `+mn-lt` (its body font).

## What a slide looks like

Every renderer draws from one resolved description of the slide, so the editor, thumbnails, present mode and PDF agree:

```ts
const scene = s.scene(first.id);
scene.elements[0].text.paragraphs[0].runs[0];
// { text: "Launch plan", fontFamily: "Arial", fontSize: 48, color: "#000000", … }
```

`s.scene(layoutId)` does the same for a layout or master as it is edited.

## Editing

Each method is one undo step.

| | |
|---|---|
| `addSlide({ layout?, after?, index? })`, `duplicateSlides`, `deleteSlides`, `moveSlides(ids, to)` | Slides; a deck always keeps at least one |
| `setLayout(slide, layout)`, `resetSlide(slide)` | Change a slide's layout (content moves to the matching placeholders; text with no match stays as a text box) or put its placeholders back to the layout |
| `setBackground`, `setNotes`, `setTransition`, `setSkipped`, `renameSlide` | Slide properties |
| `addTextBox`, `addShape`, `addImage`, `addTable`, `insertElements` | New elements on a slide, layout or master |
| `setFrame`, `setFrames`, `moveBy`, `updateElement(s)` | Position, size, rotation, any property |
| `setText`, `formatText`, `formatParagraphs`, `setCellParagraphs` | Text, character formats (bold, size, colour, link…) on a range or a whole shape, bullets, alignment, spacing |
| `fillPlaceholderWithPicture(slide, placeholder, src, naturalSize)` | Put a picture in a picture placeholder: it covers the frame, takes its shape and stays linked to the layout |
| `setFill`, `setLine`, `setCrop` | Looks |
| `arrange(ids, "front" / "back" / "forward" / "backward")`, `align`, `distribute`, `group`, `ungroup`, `duplicateElements`, `copyElements`, `pasteElements`, `deleteElements` | Arranging |
| `applyTheme(master)`, `setTheme(masterId, { colors, fonts })`, `patchMaster`, `patchLayout`, `addLayout`, `removeLayout` | Themes and layouts |
| `setSize(size, scale?)` | Change the slide size, scaling what's on the slides |
| `find(query)`, `replaceAll(query, text)` | Search slide text and notes |

Underneath is `DeckOp`, a union of small JSON operations (`insert_slide`, `replace_element`, `patch_master`…) applied by `deckReducer`; `session.transact(ops)` applies several as one step.

See [Files](/decks/files/) for PPTX and PDF and [Templates](/decks/templates/) for importing a template.
