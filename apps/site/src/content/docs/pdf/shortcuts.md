---
title: Keyboard shortcuts
description: "Every key of the Pli.PDF editor: the viewer, the page tools and file commands, the annotation tools, form filling and Prepare form, with how to list them in your own help screen."
---

Everything the editor does can be done from the keyboard. Ctrl on Windows and Linux is ⌘ on a Mac, and the tables write it as Ctrl. A key typed into a text box, a drop-down, a dialog or a menu belongs to that control, so shortcuts that would clash with typing do not run there (Escape and the undo keys are the exceptions where noted).

The tables are generated from the code (`shortcutGroups()`, below). The same list is in the editor under Help > Keyboard shortcuts, or press ? or Ctrl or ⌘ with / ([Toolbar and menus](/pdf/toolbar/#help-and-the-shortcuts-dialog)).

## The viewer

| Keys | What they do |
|---|---|
| Ctrl with + or - | Zoom in, zoom out (10% to 800%) |
| Ctrl with 0 | Zoom to 100% |
| Ctrl with F | Find in the document |
| Ctrl with H | Find and replace (with the Edit tool on; see [Toolbar and menus](/pdf/toolbar/#find-and-replace)) |
| Enter, Shift with Enter | In the find bar: next match, previous match |
| Ctrl with G, Ctrl with Shift with G | Next match, previous match |
| Page Down, Page Up | Next page, previous page. In the single page and two page layouts, one screen at a time while the page is taller than the view |
| Home, End | First page, last page |
| Left, Right | In the single page and two page layouts: one page back or forward |
| Alt with Shift with G (Option with Shift with G on a Mac) | Go to a page: puts the cursor in the page box of the status bar (View > Go to > Go to page…) |
| Alt with Shift with W, Alt with Shift with A | Zoom to fit the width of the page, or the whole page |
| Alt with Shift with R | Turn the view a quarter turn clockwise (the file is not changed) |
| Alt with Shift with F | Full screen on or off |
| Enter, Esc | In the page number box of the status bar: go to the page, give up |
| Esc | Close the organise view, then the find bar, then put the tool down |
| Ctrl with /, ? | Show the list of keys |
| Alt with Shift with S (Option with Shift with S on a Mac) | Show or hide the sidebar |
| Alt with Shift with P (Option with Shift with P on a Mac) | Show or hide the properties panel (the Properties button does the same) |
| Esc | In the properties panel: close it. A sheet or drawer of a narrow editor also closes with Esc when the focus is elsewhere in the editor (Esc lets go of a selection first) |
| Left, Right | On the sidebar's resize edge: 16 pixels narrower or wider (with Shift, 64) |
| Home, End | On the sidebar's resize edge: as narrow or as wide as it goes |
| Double click | On the sidebar's resize edge: back to the usual width |
| Ctrl with the mouse wheel, a trackpad pinch, two fingers on a touch screen | Zoom around the pointer, or around the middle of the fingers |

## Pages and files

These need the [page tools](/pdf/pages/#in-the-viewer), which are on unless `pageTools={false}`. They do not run in a read-only editor.

| Keys | What they do |
|---|---|
| Ctrl with S | Save (needs `onSave`) |
| Ctrl with Shift with S | Save a copy |
| Ctrl with P | Print |
| Ctrl with O | Open a PDF (needs `onOpen`) |
| Ctrl with Z, Ctrl with Shift with Z, Ctrl with Y | Undo, redo |
| Ctrl with Shift with R, Ctrl with Shift with L | Turn the selected pages a quarter turn clockwise, anticlockwise |
| Ctrl with Shift with Delete | Delete the selected pages (asks first when there are several, or they carry annotations) |
| Arrow keys | In the thumbnails and the organise view: go to the next or previous page |
| Shift with the arrow keys | Extend the selection |
| Ctrl with A | Select every page |
| Alt with the arrow keys | Move the selected pages one place |
| Alt with Home, Alt with End | Move the selected pages to the start or the end |
| Delete or Backspace | Delete the selected pages |
| R, Shift with R | Turn the selected pages clockwise, anticlockwise |
| Ctrl with D | Duplicate the selected pages |
| Insert | Insert a blank page after the selected pages |
| Enter | In the organise view: go to the page and close the view |
| Context menu key or Shift with F10 | Open the page menu |
| Esc | Close the page menu, the organise view or a dialog |

In the outline (the bookmarks), the arrow keys walk the tree (Right opens a folded bookmark, Left folds it or goes up), Home and End go to the first and last, Enter or Space goes to the page.

| Keys | What they do |
|---|---|
| F2 | Rename the bookmark |
| Delete | Delete the bookmark (with Undo) |
| Alt with Up or Down | Move the bookmark up or down among its neighbours |
| Alt with Shift with Right or Left | Indent the bookmark under the one above, or take it out |

## Annotation tools

A letter chooses a tool when nothing is being typed and the focus is in the pages or the ribbon, not in the sidebar, the properties panel or the organise view.

| Key | Tool | Key | Tool |
|---|---|---|---|
| V | Select | R | Rectangle |
| H | Highlight | O | Ellipse |
| U | Underline | L | Line |
| S | Strikethrough | A | Arrow |
| W | Squiggly underline | Y | Polyline |
| P | Pen | G | Polygon |
| E | Eraser | T | Text box |
| N | Note | M | Stamp |
| F | Signature | I | Picture |
| K | Link | X | Redact |

| Keys | What they do |
|---|---|
| Esc | Cancel what you are drawing; then clear the selection; then put the tool down. In a text box: finish typing |
| Enter | Finish a polyline or polygon. Edit the selected text box. Open the selected note or markup's comment |
| Delete or Backspace | Delete the selected annotations (locked ones stay) |
| Arrow keys | Move the selected annotations by 1 point (Shift: 10 points) |
| Shift with a click | Add or remove an annotation from the selection |
| Shift while drawing | Keep a rectangle square, an ellipse a circle, a line or arrow straight |
| Ctrl with A | Select every annotation on the page |
| Ctrl with D | Duplicate the selected annotations |
| Ctrl with C, X, V | Copy, cut and paste annotations (within the document; a picture on the clipboard is pasted as a picture) |
| Ctrl with ] , Ctrl with [ | Bring forward, send backward |
| Ctrl with Shift with ] , Ctrl with Shift with [ | Bring to front, send to back |
| Ctrl with Z, Ctrl with Shift with Z | Undo, redo |
| Ctrl with Enter | Send a comment; in a text box, finish typing |
| Ctrl with Alt with M | Comment on the selected text (it is highlighted and its comment opens); with no text selected, put the Note tool down |
| Ctrl with B, Ctrl with I | Bold and italic for the selected text boxes, and while typing in one |
| Double click | Finish a polyline or polygon (a click on the first point finishes a polygon) |

## Edit text and pictures

Q chooses the tool, like the letters above. With it on:

| Keys | What they do |
|---|---|
| Q | Edit text and pictures tool (press again to put it down) |
| Click | Edit the text under the pointer, or select the picture |
| Tab, Shift with Tab | Next piece of text or picture, previous one, in reading order |
| Enter or Space | On a piece of text: open the editor. On a picture: select it |
| Enter | In the text editor: keep the new text |
| Esc | In the text editor: give up the new text. Otherwise: put the tool down |
| Ctrl with Z, Ctrl with Shift with Z | Undo, redo a change of text or picture |

## Forms

Filling in (any form field, with the form tools in):

| Keys | What they do |
|---|---|
| Tab, Shift with Tab | Next field, previous field, in reading order, also across pages |
| Enter | In a one-line text box or an editable drop-down: go to the next field. In a text area: a new line |
| Esc | In a text box: put back the text it had when you came to it |
| Arrow keys | In a radio group: choose the next or previous button |
| Space | Tick or untick a check box or choose a radio button |

Prepare form (see [Forms](/pdf/forms/#in-the-editor)):

| Keys | What they do |
|---|---|
| Shift with Enter | On a field type button: put a field of that type in the middle of the page |
| Enter | Finish the radio group you are placing |
| Arrow keys | Move the selected field by 1 point (Shift: 10 points) |
| Alt with the arrow keys | Make the selected field wider, narrower, taller or shorter by 1 point (Shift: 10 points) |
| Ctrl with D | Duplicate the selected field |
| Delete or Backspace | Delete the selected field |
| Enter or Space | Select the focused field |
| Esc | Clear the selection |
| Tab, Shift with Tab | Next field, previous field, in the reading order they will have |

## A help screen of your own

The groups are registered in one place, so a help dialog can list them all:

```ts
import { editShortcutTable, formShortcutTable, pageShortcutTable, registerShortcuts, shortcutGroups, viewerShortcutTable } from "@pli.dev/pdf-react";

for (const { group, rows } of shortcutGroups()) {
  console.log(group);                                   // "Viewer", "Pages and files", "Forms", "Annotations", "Edit text and pictures"
  for (const row of rows) console.log(`  ${row.keys}: ${row.action}`);
}

// Your own tool's keys join the list:
const off = registerShortcuts("My tools", () => [{ keys: "D", action: "Put a dot" }]);
off();   // and take them out again

pageShortcutTable().length;     // the rows of one group, as data
editShortcutTable().length;
viewerShortcutTable().length;
formShortcutTable().length;
```

`shortcutTable()` gives the annotation rows, `editShortcutTable()` the edit tool's, and `claimKey(event)` lets two handlers of one key (undo, say) decide which of them does it: the first to call it gets `true`. The modifier is written for the platform: `⌘` on a Mac, `Ctrl+` elsewhere (`SHORTCUT_MOD`).
