---
title: Themes and layouts
description: Built-in themes, colour schemes and font pairs, layouts and placeholders, and how a slide inherits its look.
---

A **theme** is a master: colours, fonts, a background, shapes drawn on every slide, text styles, and the **layouts** (arrangements of placeholders) that slides pick from. Changing the theme restyles the whole deck.

## Built-in themes

```ts
import { BUILTIN_THEMES, builtinTheme } from "@pli.dev/decks";

BUILTIN_THEMES.map((t) => t.id);
// simple-light, simple-dark, paperwhite, midnight, coral, forest, slate, sunrise, mono, ocean, plum, chalk

session.applyTheme(builtinTheme("midnight", session.deck.size));
```

There are twelve, drawn to the slide size you give. Each has a colour scheme whose text and background contrast is at least 4.5 : 1 (a test checks it), a font pair, a background, decorations and the nine standard layouts.

## Layouts

Every master has Title slide, Title and body, Section header, Title and two columns, Title only, One column text, Caption, Big number and Blank. Add your own with `addLayout(masterId, name, "custom", copyFrom?)`, and edit a layout's placeholders like any slide's elements: `scene(layoutId)` draws a layout as it is edited, and every element command takes the layout's id where it takes a slide's.

A slide's layout is changed with `setLayout`; text that has no matching placeholder in the new layout stays on the slide as a text box.

## Inheritance

A placeholder on a slide takes what it doesn't set from the layout's placeholder of the same type and index, then from the master's:

1. position, size and rotation; fill, line and shadow;
2. vertical alignment, insets and autofit;
3. text style by level: master `textStyles` (title, body or other), the master placeholder's levels, the layout placeholder's levels, the slide shape's levels, then paragraph and run settings.

So a title is 32 pt Arial in the master, 48 pt in the Title slide layout, and bold on one slide where someone set it. `resetSlide` removes a slide's own positions and styles on its placeholders.

## Editing the master

The master and its layouts are edited as in PowerPoint's Slide Master view and Google Slides' theme builder.

**Open it** with the **Master** button in the toolbar (next to Theme, Layout and Transition), View > Edit master, Slide > Edit master, the Edit master button of the Theme panel, or by right-clicking a slide and choosing Edit master / layout…. It opens on the layout of the slide you came from. **Esc** or **Close master view** returns to that slide. The slides are hidden while it is open, and a banner says *Editing master – changes apply to every slide that uses it*.

**What edits do.** Formatting the text of a title or body placeholder changes the style of the paragraph's level, not the placeholder's own text, so slides inherit it:

- on the **master**, a title edit goes to `textStyles.title` and a body edit to `textStyles.body`, one entry per level;
- on a **layout**, an edit goes to the placeholder's own `text.levels`, so only slides on that layout change (and they override the master's style);
- date, footer and slide number placeholders on the master keep their style in their own levels;
- a decoration (a text box or shape that is not a placeholder) is formatted like any other shape.

Size, font, colour, bold, italic, alignment, bullets, line and paragraph spacing, and indent (which moves the level's left margin) all work this way, from the toolbar, the text editor or the menus. The master's body placeholder shows five paragraphs: **Click to edit Master text styles**, then **Second level** to **Fifth level** (levels 0 to 4). The paragraph you are in decides which level a change goes to, and with several paragraphs selected each level is updated. A master read from a file gets these five lines when the view opens. Slides are never touched.

In code:

```ts
// 40 pt bold red titles on every slide that does not override them
session.formatTemplateText(master.id, titleId, { fontSize: 40, bold: true, color: "#ff0000" });
// the second level of the body: centred, no bullet
session.formatTemplateParagraphs(master.id, bodyId, { align: "center", bullet: null }, { from: { p: 1, o: 0 }, to: { p: 1, o: 0 } });
```

`formatText` and `formatParagraphs` do the same when the element is a placeholder of a layout or master. All of it is undoable in one step.

**Several masters.** A file can bring more than one master, and the master view has a switcher that lists them. **Add master** adds a built-in theme (drawn at the deck's size) or a copy of the current one. **Rename master** and **Delete master** do what they say. A master can only be deleted when no slide uses its layouts, and one always stays. Slide > Change layout lists the layouts by master when there is more than one, and a slide can take any of them.

```ts
const dark = session.addMaster(builtinTheme("simple-dark", session.deck.size));
const copy = session.duplicateMaster(master.id);
session.renameMaster(copy.id, "Corporate");
session.removeMaster(copy.id);
```

**Layout tools.** Next to each layout in the list you can rename it, **duplicate** it, **move it up or down**, and delete it (not while slides use it). With a layout open, **Layout settings** holds *Show master shapes* (`showMasterElements`) and the layout type, and Background sets the layout's own background. **Insert placeholder** (toolbar button, and Insert > Placeholder) adds a title, body text, subtitle, picture, slide number, date or footer with a default frame and prompt. Footers take their position from the master.

```ts
session.duplicateLayout(layoutId);
session.moveLayout(layoutId, "up"); // or an index
session.addPlaceholder(layoutId, "pic"); // "title" | "body" | "subTitle" | "pic" | "sldNum" | "dt" | "ftr"
```

A slide's own **Hide background graphics** (Slide menu) hides the master's and the layout's decorations on that slide.

## Colours and fonts

```ts
session.setTheme(masterId, {
  colors: { accent1: "#0f766e", accent2: "#be123c" },
  fonts: { major: "Georgia", minor: "Verdana" },
});
```

A theme's fonts are names, and any family in the [font list](/platform/fonts/) works: the Office fonts, or one of more than 2,000 Google families, which is downloaded when a slide uses it. PowerPoint has no Google fonts, so on a computer without the font a deck that names one shows a similar font. Export with `{ fonts: "office" }` to avoid that.

Shapes whose fill is `{ theme: "accent1" }` follow the change. A colour can be lightened or darkened relative to the theme: `{ theme: "accent1", lumMod: 0.6, lumOff: 0.4 }` is PowerPoint's "Lighter 40%".

To use a theme from a PowerPoint or Google Slides file, see [Templates](/decks/templates/).
