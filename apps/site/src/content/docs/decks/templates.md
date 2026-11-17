---
title: Templates
description: Import a PowerPoint template, a PowerPoint deck or a Google Slides export, and use its masters, layouts, colours, fonts and backgrounds as Pli.Decks themes.
---

Many teams already have a template: a company `.potx`, a deck from the design team, a theme from Google Slides. Pli.Decks reads them.

In Google Slides, use File > Download > Microsoft PowerPoint (.pptx). In PowerPoint, save as `.potx` (or use any `.pptx`). Then, in the editor, open the Theme panel and choose **Import theme…**.

```ts
import { importTemplate, scaleMaster } from "@pli.dev/decks";

const { masters, size, warnings, sampleDeck } = importTemplate(fileBytes);

// Each slide master of the file is a theme with its layouts. Move it to this deck's slide size, then apply it:
const master = scaleMaster(masters[0]!, size, session.deck.size);
session.applyTheme(master);
```

`applyTheme` moves every slide to the new master's layout of the same kind (or the same name), so the deck keeps its content under the new theme. To keep the old theme in the deck as well, pass `{ keepOthers: true }`.

## What is read

| From the file | In Pli.Decks |
|---|---|
| Theme colours (12 slots) and the colour map | The master's `theme.colors`; a dark template's swapped map is applied, so colours are the ones you see |
| Heading and body fonts | `theme.fonts.major` and `.minor` (shapes that use `+mj-lt` and `+mn-lt` follow the theme) |
| Master and layout backgrounds | Solid colours, gradients and pictures, including a background that points at the theme's background styles |
| Shapes and pictures on masters and layouts | Decorations drawn under every slide that uses them |
| Placeholders (title, body, subtitle, date, footer, slide number, picture…) | Placeholders with their position, size, vertical alignment, insets and autofit |
| Title, body and other text styles, nine levels | `textStyles`: font size, bold, italic, colour, font, bullets, indents, spacing and alignment |
| Layout names and types | Layout `name` and `kind` (title, title and body, section header, two columns…) |
| The file's slides | `sampleDeck`, for showing a preview of the template; the masters are the template |

`scaleMaster` handles a template made for another slide size (4:3, or Google's 10 × 5.625 inches against PowerPoint's 13.333 × 7.5). Horizontal positions and widths follow the width ratio, vertical ones the height ratio, and font sizes, spacing and line widths follow the smaller of the two ratios. Full-width bands and footers stay full width.

Fonts that the file embeds (`.fntdata`) are not read; the font names are kept, so install them or pass the font files to the PDF export. Masters with the same name get a number added. Anything that can't be read is reported in `warnings` (see [Files](/decks/files/) for the list); the rest of the template still comes through.

## Your own templates

`toPotx(session.deck)` writes the deck's masters and layouts as a `.potx` that PowerPoint and Google Slides can use as a template.
