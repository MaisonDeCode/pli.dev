---
title: Toolbar and menus
description: "The title row, menu bar, tools row, status bar, optional toolbar and text bar of the Pli.PDF editor, what it shares with Pli.Documents, Sheets and Decks, what was added for PDF files, and every function of the other editors with the reason it is or is not in a PDF editor."
---

`PdfEditor` is laid out like the other Pli editors. It has a title row, a menu bar (File, Edit, View, Insert, Format, Tools, Help), a tools row of the annotation tools, a text bar under it like the formatting row of Documents, and a slim status bar at the bottom of the pages. There is no top toolbar by default: the menus carry the same commands with their keys, and `topToolbar` brings the toolbar back. The pieces are the shared ones from `@pli.dev/react`: `MenuBar`, `Dropdown`, `MenuList`, `Dialog`, `FontPicker`, `ColorPicker`, `PresenceBar`, `SyncIndicator`, `ShareButton`, `ShareDialog`, `VersionHistoryPanel`, `Icons`.

```
Title row    your startActions | name of the file | who is here | Comments | your actions | Share | your endActions
Menu bar     File  Edit  View  Insert  Format  Tools  Help
Tools row    the annotation tools, and Edit text and pictures
Text bar     font, size, bold, italic, colours, alignment, border (only while there is text to format)
Pages
Status bar   (a pill over the pages)  1 / 12 | - 109% + | properties
```

## One list of commands

A button and its menu entry come from the same description (a `PdfCommand`: name, icon, key as shown, whether it is on or off, whether it can be used now). So **Undo** in the toolbar and **Undo** in the Edit menu always have the same name and key and are enabled together, and a tool that is active is pressed in the ribbon and ticked in the menu. The viewer describes its own commands (`buildCommands`); the annotation, form and edit tools describe theirs (`annotCommands`, `toolCommand`, `editCommand`) and add them to the menus through the `menus` prop of `PliPdf`, which you can use too.

```tsx
// Entries added at the end of a menu, after a separator.
<PdfEditor session={session} renderer={renderer} menus={{ Tools: [{ label: "Check accessibility…", onSelect: check }] }} />

// Or a function that gets the editor's own menus: place entries where you want them, or take some out.
<PdfEditor session={session} renderer={renderer} menus={(base) => ({ ...base, Help: [...(base.Help ?? []), { label: "Support…", onSelect: openSupport }] })} />
```

`menu={false}` leaves out the title row and the menu bar. The name, the people and a File menu then move to the toolbar, which comes back by itself. Menus update when the tools report a change (the clipboard, the active tool, the selection), so Paste is off until something is copied.

## The menus

| Menu | What is in it |
|---|---|
| **File** | Open PDF and Create PDF from pictures (with `onOpen`), Save (with `onSave`), Save a copy, **Download** (PDF document, Optimised PDF, Flattened PDF, Form data (.json), Pages as pictures, More download options), Document properties, Print |
| **Edit** | Undo, Redo; Cut, Copy, Paste, Duplicate, Delete and Select all annotations; Find, Find and replace |
| **View** | Zoom in, Zoom out, Actual size, a Zoom list; Page layout (continuous, single page, two pages), Rotate view, Go to (first, previous, next, last page); Show sidebar, Version history (with `history` or `versions`), Show properties panel, Organise pages, Show links, Highlight form fields; Full screen, Theme (match the system, light, dark) |
| **Insert** | Text box, Image, Shape (rectangle, ellipse, line, arrow, polyline, polygon), Drawing, Signature, Stamp, Note, Comment, Link, Mark up text (highlight, underline, strikethrough, squiggly); Form field; Blank page, Pages from a file |
| **Format** | Text (bold, italic, bigger, smaller), Align text, Border width: for the text box or the text of the page that is selected; Arrange (order, align, distribute, lock) |
| **Tools** | Redact (mark an area, mark selected text, apply), Edit text and pictures, Prepare form, Form (highlight, clear, export, import, flatten), Organise pages, Find, Find and replace, Word count |
| **Help** | Keyboard shortcuts |

A tool you leave out (`annotations={false}`, `edit={false}`, `tools: [...]`) leaves its entries out of the menus too. In a read-only editor the entries that change the file are off. The menu bar is the shared `MenuBar`: the arrow keys move between menus and Esc closes. On a phone-width editor the menus open full width under the bar, with submenus unfolded in place.

## The title row

- The name of the document, with a dot while there are unsaved changes. Click it to rename.
- Who is here and whether the shared document is saved, when there is a `room` (the shared `PresenceBar` and `SyncIndicator`). While the connection is down the shared `OfflineBanner` says how many changes are waiting to be sent.
- **Comments** (when `comments` is on) opens the Comments tab and counts the unresolved threads. Press it again to fold the sidebar.
- `startActions` adds controls at the left end, before the name (a back button, a logo). `actions` adds controls before Share and `endActions` after everything else, at the far right edge. `startActions` and `endActions` each sit in their own small group (`pli-actions pli-actions-start` and `pli-actions pli-actions-end`), and nothing is drawn for an empty one. With both `actions` and `endActions`, `actions` comes first. They are the same props Documents, Sheets and Decks have, and take any React nodes. They show with the menu bar; with `menu={false}` there is no title row.
- **Share** is the shared `ShareButton` ([Shared interface](/platform/shared-ui/#sharing)). Give a `shareClient` (a `ShareClient` from `@pli.dev/core`) and it opens the shared `ShareDialog` (people, roles, link access). Give `onShare` and it also calls that, for a dialog of your own.
- Version history: give `history` (a `VersionHistory` from `@pli.dev/core`) and the sidebar gets a History tab with the shared `VersionHistoryPanel`, and **View > Version history** opens it (ticked while it is open). Or give `versions` (a `VersionStorage`) and `users`, and the editor makes the history itself and keeps an *Autosaved* version now and then (`autoSaveVersions`). Choosing a version in the list shows it in the viewer, read-only, with a bar to **Restore this version** or go **Back to current** (Escape does the same). **Restore** applies the version as one undo step and adds a `Restored "..."` version, so every earlier version stays in the list. Undo brings back the document as it was just before, and with live editing the restore reaches everyone as an ordinary change. See [Version history](/pdf/collaboration/#version-history).

## Your own menus and file chooser

`extraMenus` adds items to a menu or a whole menu of your own. The key is the menu's name: `File`, `Edit`, `View`, `Insert`, `Format`, `Tools` or `Help` adds the items at the end of that menu, after a divider. Any other name, such as `AI`, makes a new menu before Help. The items are yours, so the read-only state of the file does not disable them. `menus` still works and is the way to change or remove the viewer's own entries.

```tsx
<PdfEditor
  session={session}
  renderer={renderer}
  extraMenus={{
    File: [{ label: "Share with the team…", onSelect: openShare }],
    AI: [{ label: "Summarize", onSelect: summarize }],
  }}
  filePicker={async ({ purpose, accept, browse }) => (await myFileDialog({ purpose, accept })) ?? null}
/>
```

`filePicker` replaces the browser's file chooser everywhere the editor asks for a file. It gets the purpose (`"open"`, `"image"` or `"import"`), the accepted types and a `browse()` for the browser's own chooser, and returns the chosen `File`s or `null`. [Menus and file pickers](/platform/menus-and-file-pickers/) has both on one page for all the editors.

## The status bar and the toolbar

The editor keeps on screen only what a reader needs all the time, in a slim pill at the bottom of the pages (`statusBar`, on by default):

- The page, as `1 / 12`. Click it and type a page number. Enter goes there and Esc gives up.
- The zoom: `-`, the percentage (a list: 10% to 800%, **Fit width**, **Fit page**, **Actual size**) and `+`.
- Properties: the button of the properties panel, with a dot while a panel is waiting (see [Layout and panels](/pdf/ready-made-ui/#layout-and-panels)). Only when the editor has a panel.

The title row keeps **Comments** and **Share**. Everything else the toolbar had is in the menu bar, with the key it shows. Each key works with the focus anywhere in the editor:

| What the toolbar had | Now | Key |
|---|---|---|
| Sidebar | View > Show sidebar | Alt+Shift+S |
| Undo, Redo | Edit > Undo, Redo | Ctrl or ⌘ with Z; Shift with Z (Ctrl with Y) |
| Print | File > Print… | Ctrl or ⌘ with P |
| Save | File > Save (and Save a copy, Download) | Ctrl or ⌘ with S |
| Previous page, next page | View > Go to > Previous page, Next page | Page Up, Page Down |
| First page, last page | View > Go to > First page, Last page | Home, End |
| The page box | View > Go to > Go to page… (puts the cursor in the status bar's page box) | Alt+Shift+G |
| Zoom in, zoom out | View > Zoom in, Zoom out | Ctrl or ⌘ with + and - |
| The zoom list | View > Zoom (the same list) | |
| Actual size | View > Actual size | Ctrl or ⌘ with 0 |
| Fit width, fit page | View > Zoom > Fit width, Fit page | Alt+Shift+W, Alt+Shift+A |
| Page layout | View > Page layout > Continuous, Single page, Two pages | |
| Rotate view | View > Rotate view clockwise | Alt+Shift+R |
| Find | Edit > Find… (and Find and replace…) | Ctrl or ⌘ with F (H) |
| Full screen | View > Full screen | Alt+Shift+F |
| Properties | View > Show properties panel; the status bar's button | Alt+Shift+P |
| Form menu, Prepare form | Tools > Form, Tools > Prepare form | |
| Organise pages (in the layout list) | View > Organise pages…; Tools > Organise pages… | |
| Your own `tools` | A row of their own under the menu bar | |

`topToolbar` shows the old toolbar again, for a host that wants it: sidebar, undo and redo, print, previous and next page and the page box, zoom with the list and a **Fit** button that offers the fit that is not on, the page layout list, **Rotate view**, **Find**, **Full screen**, **Properties**, the Form menu and Prepare form, your `toolbar` content, your tools, and Save. The status bar is then left out (the toolbar has the page box and the zoom). With `menu={false}` there is no menu bar, so the toolbar is on by default, because it then holds the name, who is here and the File menu. `statusBar={false}` leaves out the status bar.

Full screen asks the browser (the Fullscreen API) to show the editor on the whole screen. The sidebar and the tools stay. Where the browser has no Fullscreen API, or a phone refuses, the entry is there but off.

## The text bar

The text bar sits under the ribbon and shows only while there is text to format:

- a text box is selected or being typed in, or the Text box tool is on and nothing is selected (the next box gets what you choose, and the tool remembers it);
- the **Edit text and pictures** tool has a piece of the page's text selected.

| Control | Text box | Text of the page (Edit tool) |
|---|---|---|
| Font (the shared `FontPicker`, with the families of the `fonts` prop) | yes | yes |
| Size (the box, and the two step buttons) | yes | yes |
| Bold, Italic (Ctrl or ⌘ with B and I for a text box) | yes | yes |
| Text colour (the shared `ColorPicker`) | yes | yes |
| Fill colour: the highlight behind a text box | yes | no: the page's text has no background of its own |
| Align left, centre, right | yes | no: the file places each piece of text |
| Border width | yes | no |

Every change is one undo step, and choices made one after another are one step, as in the properties panel. The properties panel does not repeat what the bar has: the font, size, style and alignment of a text box, or the font, size, style and colour of edited text. It keeps the rest (colour of lines, opacity, line style, lock, order, comment, *Shrink to fit*).

## Find and replace

Ctrl or ⌘ with H, Edit > Find and replace, or the replace button of the find bar opens the **Replace with** row. It is there when the editor has the Edit tool (`edit` is not `false`) and is not read-only. Set the `replace` prop to turn it on or off yourself.

- **Replace** puts the text in the match the find bar is on and goes to the next. **Replace all** counts first and asks: "Replace 3 matches of “cat” with “dog” on 1 page?", then does all of it in one undo step (the toast's Undo takes it back).
- Match case and Whole words of the find bar apply. The replacement is written as it is (no patterns).
- Each change is a text edit of the piece of text the match is in, the same as retyping it with the Edit tool: it shows in the Edits tab, is kept in the font and size of any earlier edit of that piece, and the old text is cut out of the page when the file is saved ([Text, search and redaction](/pdf/text-and-redaction/#find-and-replace)).
- A match that runs across two pieces of text (a phrase split by a font change or a gap) and a match in text that cannot be edited (Type 3 fonts, invisible text, vertical writing) are not replaced. The bar says how many were left, and which kind.
- While the file is open the find bar keeps showing the matches of the original text, and the replacements are in the Edits tab. After a save and a reopen the found words are the new ones.
- **Redact all matches** stays in the find bar next to the replace button.

## Help and the shortcuts dialog

Help > Keyboard shortcuts, `?`, or Ctrl or ⌘ with `/` shows every key of the editor in groups (Viewer, Pages and files, Forms, Annotations, Edit text and pictures, and the groups your own tools registered with `registerShortcuts`). It is built from the same registry as the table on [Keyboard shortcuts](/pdf/shortcuts/).

## Document properties and word count

File > Document properties shows the title, author, subject and keywords (editable, written into the file by the next save as one undo step, and read-only in a read-only editor) and what the file is: its name, number of pages, page size ("8.5 × 11 in, Letter"), file size, PDF version, whether it is protected with a password, what made it and when. Tools > Word count counts the words and characters (without spaces) of the text of every page.

## What each editor has, and what Pli.PDF does about it

"Shared" means the same component or the same look and keys. "Added" means it is new in Pli.PDF because the other editors have no equivalent but a PDF editor needs one. "Not applicable" says why.

### Editing

| Function | In Documents, Sheets, Decks | In Pli.PDF |
|---|---|---|
| Undo, redo, with disabled states | All three: toolbar buttons, Edit menu (`Icons.undo`, `Icons.redo`; `⌘Z`, `⇧⌘Z` or `Ctrl+Y`) | Shared: the Edit menu with the same keys (and the buttons of `topToolbar`), one command |
| Cut, copy, paste | Edit menu | Shared for annotations (Edit menu; `Ctrl+X`, `C`, `V`). The text of the page is copied with the browser's own copy |
| Paste without formatting | Documents | Not applicable: annotations have no formatting to leave out |
| Select all | Edit menu | Shared: all annotations of the page (Edit menu), all pages in the thumbnails |
| Find | Documents, Sheets, Decks | Shared: find bar, `Ctrl+F` |
| Find and replace | All three | Added: replace within a piece of text, with a count and one undo; text that spans pieces is reported (see above) |
| Clear formatting | Documents, Decks | Not applicable: a text box has one style, so there is nothing to clear; delete or retype it |
| Spelling, language | Sheets spelling dialog; the browser's checker in the others | Not applicable: the text of a PDF page is not typed in the editor. Text boxes use the browser's own spell check while you type |
| Suggesting mode | Documents | Not applicable: a PDF cannot hold tracked changes. The Edits tab lists what the save will write, and each can be taken back |

### Text format

| Function | In Documents, Sheets, Decks | In Pli.PDF |
|---|---|---|
| Font family and size | `FontPicker` and a size box with steps | Shared: the text bar for text boxes and for edited text, with the families of the `fonts` registry |
| Bold, italic | Toolbar, `Ctrl+B`, `Ctrl+I` | Shared: text bar, Format menu and the keys, for text boxes |
| Underline, strikethrough | Toolbar or menu | Not applicable to text boxes and edited text: a PDF text box has a font, size, colour and alignment but no underline or strikethrough. To underline or strike through words already on the page, use the Underline and Strikethrough markup tools (Insert > Mark up text) |
| Superscript, subscript, small caps | Documents, Decks | Not applicable: a PDF text box has no such style |
| Text colour | `ColorPicker` | Shared |
| Highlight colour | `ColorPicker` | Shared as **Fill colour** (the background of a text box). For text already on the page the Highlight markup tool and its colour menu |
| Alignment | Left, centre, right, justify | Left, centre, right (shared icons). Justify is not applicable: the PDF text box has no justified alignment |
| Bulleted and numbered lists, indent, line and paragraph spacing | Documents, Decks | Not applicable: a text box is plain text; a PDF has no list or paragraph structure to set |
| Vertical alignment | Decks | Not applicable: a text box is as tall as its text |
| Border weight and colour | Decks | Added to the text bar as **Border width**; the colour of a text box's border follows its text colour in the properties panel |

### Insert

| Function | In Documents, Sheets, Decks | In Pli.PDF |
|---|---|---|
| Image | All three | Shared: Insert > Image, the Picture button, paste and drop |
| Shapes, lines, arrows, text box | Decks | Shared: Insert > Shape, Drawing, Text box; the same shape and line choices |
| Link | All three (`Ctrl+K`) | Shared: Insert > Link, the Link tool (`K`) |
| Comment | Documents (`Ctrl+Alt+M`), notes in Sheets | Shared: Insert > Comment and `Ctrl+Alt+M`: highlights the selected text and opens its comment, or with no text selected puts the Note tool down |
| Signature, stamp, note | — | Added: Insert > Signature, Stamp, Note |
| Form fields | — | Added: Insert > Form field (starts Prepare form with that field type) |
| Blank page, pages from a file | Page break and section break in Documents; New slide in Decks | Added: Insert > Blank page, Pages from a file |
| Table, chart | Documents, Sheets, Decks | Not applicable: they are objects of a flowing document or a sheet. Draw lines and text boxes, or paste a picture |
| Footnote, header, footer, page number, columns, table of contents | Documents | Not applicable: they are layout of flowing text; a PDF page is already laid out. The bookmarks of the Outline tab are the table of contents of a PDF |

### View

| Function | In Documents, Sheets, Decks | In Pli.PDF |
|---|---|---|
| Zoom in, out, a list, fit | Zoom in the status bar and the View menu (Documents), a Zoom list with Fit (Decks) | Shared: the status bar (`-`, the list from 10% to 800% with Fit width and Fit page, `+`) and View > Zoom |
| Page layout | Pages or pageless (Documents) | Continuous, single page, two pages (and View > Page layout) |
| Outline panel | Documents | The Outline tab of the sidebar (bookmarks) |
| Comments panel | Documents' Comments button | Shared: Comments in the title row opens the Comments tab |
| Sidebar for pages | Decks filmstrip | The Thumbnails tab, with the page tools |
| Ruler | Documents | Not applicable: margins and indents are for flowing text |
| Snap to guides, grid | Decks | Not applicable: annotations move freely; use the arrow keys (1 point, with Shift 10) or Align and Distribute |
| Show or hide toolbar, formula bar, status bar | Sheets View menu | Not a menu entry: the host chooses with props (`topToolbar`, `statusBar`, `annotations`, `edit`, `pageTools`, `menu`) |
| Full screen, present | Decks Present (Fullscreen API) | Added: View > Full screen, guarded for browsers without the API. A slide show is not applicable |
| Light and dark | The editors follow the system or a prop | Added: View > Theme (match the system, light, dark) and `onThemeChange`; pages stay on white paper |
| Dark pages | Documents `paper` | Not applicable: the page is drawn as the file says |

### File, sharing and help

| Function | In Documents, Sheets, Decks | In Pli.PDF |
|---|---|---|
| Name of the document | Editable title in the title row | Shared title row: click the name to rename (a name saved in the file's session) |
| Open, new | Open and New in Decks, Import in Documents and Sheets | Open PDF and Create PDF from pictures (`onOpen`) |
| Save | `onSave` and `Ctrl+S` | Shared: File > Save, `Ctrl+S`, the unsaved dot by the name (a Save button in the toolbar of `topToolbar`) |
| Download as other formats | PDF, DOCX, Markdown, HTML, JSON; XLSX, CSV; PPTX, PDF | The same menu shape: PDF, Optimised PDF, Flattened PDF, Form data (.json), Pages as pictures (PNG, JPEG). Other formats are not applicable: a PDF is the format |
| Print | Documents, Sheets | Shared: `Ctrl+P`, File > Print… (`onPrint` to take over) |
| Page setup | All three | Not applicable: the pages are the file's. Blank pages take the size of the page before |
| Share | `actions` slot with your Share button; the shared `ShareButton` and `ShareDialog` | Shared: `ShareButton` in the title row, `shareClient` opens the shared `ShareDialog`, `onShare` for your own; `actions` too |
| People, cursors, sync state | `PresenceBar`, `RemoteCursors`, `SyncIndicator` (now `@pli.dev/react/collab`) | Shared: title row, other people's selections and pointers on the pages |
| Version history | The shared `VersionHistoryPanel` (see [Versions](/platform/versions/)) | Shared: a `history` prop (or `versions` with `users`) adds the History tab and View > Version history, with a preview of an older version; `pdfVersionSupport` restores a version as one undoable step |
| Keyboard shortcuts help | None of the three has one | Added: Help > Keyboard shortcuts, `?` and `Ctrl+/`, from the shortcut registry |
| Help menu | None of the three has one | Added, with the shortcuts |
| Document properties | None of the three has one beyond the title | Added: title, author, subject, keywords, pages, size, version, protection |
| Word count | Decks Tools > Word count; the Documents status bar | Shared: Tools > Word count |

### Toolbars

Documents, Sheets and Decks each have a toolbar of their own commands (formatting, cells, slides). The PDF editor's equivalent is the tools row under the menu bar: the annotation tools (select, highlight, underline, strikethrough, draw, eraser, shapes, text box, note, stamp, signature, picture, link, redact, edit text and pictures) and the text bar below it. The PDF editor's old toolbar held viewer commands (page, zoom, layout, find, full screen). Documents keeps its zoom in the View menu and its status bar, so the PDF editor does the same, and `topToolbar` is there for a host that wants those commands as buttons.

### Only in a PDF editor

Redact, Edit text and pictures, Prepare form with the form field types, Organise pages, the page menu, bookmarks editing, Flatten and Optimise downloads. These are in the Tools, Insert, File and View menus as listed above, and each is also a button.

## What the tests check

For every bar (sidebar tabs, status bar, the toolbar of `topToolbar`, title row, tools row, text bar, the form bars, the page tools, the find bar), the test suite checks that no two buttons draw the same icon and that every button has a tooltip and a name for screen readers. For every menu it checks for entries with no name, or the same name or key twice. Each control the menus, the status bar and the toolbar offer has a test that uses it and checks the session, the document or the callback it should reach.

What cannot be checked without a real browser is on the [roadmap](/pdf/roadmap/#the-viewer): how the menu bar and the title row wrap, how the tools row, text bar and toolbar scroll and fade at real widths, and the Fullscreen API.
