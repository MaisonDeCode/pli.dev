---
title: Your own menus and file chooser
description: Add items to the menus of a Pli editor, add menus of your own, rename or remove the built-in ones, and replace the browser's file chooser with your app's.
sidebar:
  order: 5
---

The ready-made editors (Documents, Sheets, Decks and PDF) give you a working menu bar and the browser's own file chooser. Both can be extended, and the menus can be reworded or trimmed, so you can fit them into your app without rebuilding the editor.

## Add to the menus

Pass `extraMenus`. Each key is a menu's name:

```tsx
<PliDocument
  session={session}
  extraMenus={{
    File: [{ label: "Share…", onSelect: openShareDialog }],
    AI: [
      { label: "Summarize", onSelect: summarize },
      { label: "Rewrite", items: [{ label: "Shorter", onSelect: shorter }, { label: "Friendlier", onSelect: friendlier }] },
    ],
  }}
/>
```

- **A name the editor already has** (`File`, `Edit`, `Insert`, ...): your items go at the end of that menu, after a divider.
- **A name it doesn't have** (`AI` above): a new menu is added to the bar, in the order you wrote them. It goes before Help when the editor has a Help menu, and last otherwise.

To put your items somewhere other than the end of a built-in menu, name an item that is already there:

```tsx
extraMenus={{ File: { items: [{ label: "Share…", onSelect: openShareDialog }], after: "Download" } }}
```

Use `before` instead of `after` to go above it. If no item has that name, yours go at the end.

Each entry is the same as in the editor's own menus:

| Field | What it does |
|-------|--------------|
| `label` | The text. |
| `onSelect` | Called when the item is chosen. |
| `shortcut` | A hint shown on the right, such as `"Ctrl+Shift+S"`. Pli doesn't bind the key for you. |
| `disabled` | Greys the item out. |
| `checked` | Shows a check mark. |
| `items` | Makes the item a submenu. |
| `"separator"` | A divider line, in place of an item. |

Items you add are yours: Pli doesn't disable them in read-only mode. If an action shouldn't be available there, set `disabled` yourself.

The menu names are the ones on screen. Documents has File, Edit, View, Insert and Format. Sheets adds Data and Review. Decks has Slide, Arrange and Tools. PDF has Tools and Help.

## Rename or remove built-in items

Pass `menuLabels` to change the words on the menus, or to take an item out. Each key is the text a menu or item has now, and its value is what to show instead. `false` removes it.

```tsx
<PliDocument
  session={session}
  menuLabels={{
    "File > Download": "Export",          // one item, by its path
    "DOCX document (.docx)": "Word file", // every item with this text
    "Insert > Page break": false,         // taken out
    Help: false,                          // a whole menu
  }}
/>
```

- **The text as it is** (`"Download"`) applies to every menu or item with that text. Some words are in two places (Table is in Insert and in Format), so use a path when you mean one of them.
- **A path** (`"File > Download"`, or `"File > Download > PDF document (.pdf)"`) applies to that item only, and wins over the plain text. Write each part as it is now, even when a part above it is renamed: after `"File": "Document"`, the path is still `"File > Download"`.
- **What the item does stays the same.** A renamed item keeps its shortcut, its checked and disabled states and its action. The shortcut hint isn't changed, only the label.
- **Taking out** a submenu's last item takes the submenu out with it, and a menu with nothing left goes too. The lines between groups are tidied so none is left at an end or doubled.
- **Your own items** from `extraMenus` can be renamed or removed the same way. `extraMenus` places them by the built-in text as it is now (`after: "Page count"`), and `menuLabels` is applied afterwards.
- **A key that matches nothing** is ignored, so check the spelling: it is the text as shown today, in English.

It works the same in Documents, Sheets, Decks and PDF (in PDF it also applies to the File menu in the toolbar when the menu bar is off), and it is the way to translate the menus into another language. It changes the menu bar only: button tips and the words in dialogs are not changed.

To hide a menu bar altogether, use `menu={false}`.

## Use your own file chooser

By default, anything that needs a file (opening one, inserting a picture, importing a document) opens the browser's chooser. Pass `filePicker` to show your own instead, such as a list of the files in your app:

```tsx
<PliSheet
  session={session}
  filePicker={async (request) => {
    // request.label: "Insert an image", request.purpose: "image", request.accept: "image/*"
    const chosen = await openMyFilePicker({ title: request.label, types: request.accept, multiple: request.multiple });
    if (!chosen) return null;                       // cancelled
    const blob = await fetch(chosen.url).then((r) => r.blob());
    return new File([blob], chosen.name, { type: blob.type });
  }}
/>
```

Your function gets a request and returns the chosen `File` (or a list of them, or `null` when the person cancels). It can show anything you like while it waits: a modal, a side panel, a drive browser.

| Field of the request | Meaning |
|----------------------|---------|
| `purpose` | `"image"` (a picture to put in), `"open"` (a file to open instead of the current one) or `"import"` (a file whose contents are brought into this one). |
| `accept` | The kinds of file that fit, in the format of a file input's `accept`: `"image/*"`, `".docx"`. Use it to filter your own list. |
| `multiple` | Whether more than one file can be used. If it is `false`, only the first file you return is used. |
| `label` | What the person is doing, in words: "Insert an image". A good title for your dialog. |
| `browse()` | Opens the browser's own chooser and returns the files. Put it behind a "From your computer" button, so people keep that option. |

`browse()` must be called from a click, which a button in your dialog is.

You can use the same function everywhere. The editors that have more than one place to choose a file (a picture in a cell, an image in a dialog, form data in a PDF) all go through it, and `purpose` tells you which kind of file is wanted.

Dropping a file on the editor, or pasting one, doesn't go through the chooser. Those work as before.

You can try both in the playground: open **Fitting the editors into your app**, then File, Insert > Image.
