---
title: Theme and your own buttons
description: How to make a Pli editor match your app's light or dark mode, and put your own buttons in its title row.
sidebar:
  order: 4
---

Every ready-made editor (Documents, Sheets, Decks and PDF) takes the same two kinds of setting for fitting into your app: a `theme`, and room in the title row for your own buttons.

## Light and dark

Pass the theme your app is using:

```tsx
<PliDocument session={session} theme={isDark ? "dark" : "light"} />
```

| Value | What the editor does |
|-------|----------------------|
| `"auto"` (the default) | Follows `data-theme="light"` or `"dark"` on `<html>` if your page sets it, and otherwise the system's light or dark setting. |
| `"light"` | Always light, even if the system is in dark mode. |
| `"dark"` | Always dark, even if the system is in light mode. |

The setting covers everything the editor draws, including the menus, dialogs and cards that open on top of the page. If your app lets people switch theme, change the prop and the editor changes with it, with no reload.

A few details:

- **Documents.** The pages follow the theme, so they turn dark in dark mode. Set `paper="light"` to keep them white. See [Ready-made editor](/documents/ready-made-ui/).
- **PDF.** The pages of a PDF file are always drawn as the file has them. The theme changes the viewer around them. The PDF editor also has a View > Theme menu, and calls `onThemeChange` when someone uses it, so you can keep your app in step.
- **Your own colours.** The editors are coloured with CSS custom properties (`--pli-bg`, `--pli-fg`, `--pli-accent`, and so on). Override them on the editor or any parent to match your brand. They work in both themes.

## Buttons of your own

The title row has the document's name, who else is here, and the built-in buttons. You can add your own in three places:

```tsx
<PliSheet
  session={session}
  startActions={<button onClick={goBack}>← Projects</button>}
  actions={<button onClick={exportToCrm}>Send to CRM</button>}
  endActions={<AccountMenu />}
/>
```

| Prop | Where it appears |
|------|------------------|
| `startActions` | At the far left, before the name. A good place for a back button, your logo or a breadcrumb. |
| `actions` | Beside the built-in buttons (Comments, Share, Slideshow). |
| `endActions` | At the far right, after everything else. A good place for a profile menu or a close button. |

Each takes any React node, so you can pass one button or a whole group. A prop you leave out adds nothing. Your buttons are plain elements: give them the editor's `pli-button` class if you want them to look like the built-in ones, or style them yourself.

You can try all of this in the playground: open **Fitting the editors into your app** and switch between the editors and themes.
