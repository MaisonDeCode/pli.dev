---
title: Pages
description: Turn, delete, reorder, duplicate and add pages, extract and split a PDF, merge files, make pages from pictures, number pages and edit bookmarks with Pli.PDF, and which of these write a new file.
---

Pages are named by id, never by position, so changes made by two people at the same time still land where each meant them. `session.doc.pages` is the list in order; `session.pages.index(id)` is a page's position. A page read from a file has the id `p:main:<index>`, with the position it had in the file; pages you add get a random id.

```ts
const [first, second, third] = session.doc.pages.map((p) => p.id);

session.pages.rotate([first!], 90);          // a quarter turn clockwise (-90: anticlockwise, 180)
session.pages.move([third!], 0);             // to the front
session.pages.remove([second!]);             // gone, with what belonged to it
session.undo();                              // back again
```

Each command is one undo step, however many pages it touches.

## What each command does

| Command | |
|---|---|
| `rotate(ids, 90 \| -90 \| 180)` | Turns pages, adding to how they are turned now. It sets the page's `rotate` and is saved as the page's own `/Rotate` |
| `remove(ids)` | Takes pages out, with their annotations and form widgets, the comment threads on them, and the bookmarks and links that went to them (a bookmark's children move up, and a link with a web address keeps its address). The last page cannot be removed |
| `move(ids, index)` | Puts the pages together so that the first ends at `index` in the list without them, keeping their order |
| `insertBlank(after?, size?)` | A blank page after the page `after` (the end by default, `null` for the start), the size of the page before it, or Letter, or `size: { width, height }` in points. Returns its id |
| `duplicate(ids)` | Copies pages and puts the copies together after the last page copied. The copies get the annotations (with new ids) and the form fields of the originals; each field gets a name of its own (`name_2`) so the copies can be filled separately. Returns the new ids |
| `setLabel(ids, label \| null)` | The label readers show for a page (`ii`, `A-3`); `null` takes it off |
| `numberPages(ids, style, { start?, prefix? })` | Labels pages in order: `style` is `"decimal"`, `"roman"`, `"ROMAN"`, `"alpha"` or `"ALPHA"`. `numberPages(ids, "roman")` gives `i`, `ii`, `iii` |
| `get(id)`, `index(id)` | A page, and its position |

```ts
session.pages.insertBlank(first!, { width: 595, height: 842 });   // an A4 page after the first
session.pages.numberPages(session.doc.pages.slice(0, 3).map((p) => p.id), "roman");
```

Page ids you give must exist, or a `PliError` with code `not_found` is thrown and nothing changes.

## Taking pages out: extract and split

```ts
const part = await session.pages.extract([first!, third!]);        // a new PDF (Uint8Array) with just these pages

const parts = await session.pages.split({ ranges: "1-3,5,8-" });    // one file for each range
await session.pages.split({ every: 10 });                           // a file for every 10 pages
await session.pages.split({ outline: 1 });                          // a file for each top level bookmark
session.pages.splitPlan({ every: 10 });                             // the page ids of each part, without making the files
```

`extract` and `split` take `SaveOptions` as a last argument (`fonts`, for instance). The pieces keep the annotations and form fields of their pages, the bookmarks that go to them, and their comment threads. Page ranges are 1-based, as people write them: `"1-3,5,8-"` is pages 1 to 3, page 5 and page 8 to the end. A page that does not exist throws `out_of_range`. Each file is a new file (a rewrite) made from the same sources, so the document itself is not changed.

## Merging

```ts
const added = await session.pages.insertFrom(otherBytes, { at: 2, name: "appendix.pdf" });
// the ids of the new pages; they are selected
```

`insertFrom` takes bytes, a `PdfFile` or another `PdfSession`. The other file becomes a source of this document (its bytes go to the [source store](/pdf/files/#storing-the-files)), so inserting is cheap and one undo step takes it out again. Options:

| Option | |
|---|---|
| `at` | The position of the first new page (default: the end) |
| `after` | Instead of `at`: the id of the page the new pages follow, or `null` for the start |
| `pages` | Which pages of the other file to take, 0-based, in the order you give (default all) |
| `annotations`, `fields`, `outline` | Take the pages' annotations, form fields and bookmarks along (all `true`) |
| `bookmark` | Add a top level bookmark for the inserted file, with its own bookmarks under it: `true` uses the file's name, or give a title |
| `password`, `name` | The password of an encrypted file, and the name kept for the file |

Annotations and fields of the new pages get new ids; a form field whose name is already used becomes `name_2`, so two merged copies of the same form can be filled in separately. A page of an encrypted file is stored as an unencrypted copy.

To merge files without a session:

```ts
import { mergePdfs } from "@pli.dev/pdf";

const merged = await mergePdfs([a, b, c], { names: ["a.pdf", "b.pdf", "c.pdf"], bookmarks: true });
```

`bookmarks: true` gives every file a bookmark of its name; `outline: false` leaves out the files' own bookmarks; `passwords` lists the passwords of encrypted files by position.

## Pictures to pages

```ts
import { pdfFromImages } from "@pli.dev/pdf";

await session.pages.insertImages([{ data: jpegBytes }, { data: pngBytes }], { fit: "image", dpi: 150 });

const pdf = await pdfFromImages([{ data: scan }], { fit: "page", margin: 36 });   // a new PDF
```

One page for each picture. JPEG and PNG only (anything else throws `unsupported`). A JPEG is stored as it is, without recompressing; a PNG is stored without loss. A JPEG that says it was taken turned (an Exif orientation) is shown upright.

| Option | |
|---|---|
| `fit: "page"` (default) | Every page is `pageSize` (Letter, turned the way the picture is) and the picture is scaled to fit it inside `margin` |
| `fit: "image"` | Every page is as big as its picture, at the picture's own resolution if it says one, else `dpi` (72) |
| `pageSize`, `margin`, `dpi` | In points, points and pixels per inch |

`insertImages` also takes `at` and `after`, like `insertFrom`.

## Bookmarks (the outline)

`session.outline` changes the document's bookmarks. Each item has an id, a title, a place it goes to (a page and how far down it) or a web address, and children.

```ts
const part = session.outline.add("Part one", first!);
session.outline.add("Scope", second!, { parent: part, y: 240 });   // under it, 240 points down the page
session.outline.rename(part, "Part 1");
session.outline.retarget(part, third!);
session.outline.indent(id);                                        // become a child of the item above
session.outline.remove(part, { promote: true });                   // its children move up
```

`add(title, page | null, { y?, parent?, index?, bold?, italic?, color? })`, `update(id, patch)`, `rename`, `retarget(id, page, y?)`, `remove(id, { promote? })`, `move(id, parent, index?)`, `indent`, `outdent`, and `set(items)` to replace the whole list. `session.outline.items` is the list. A bookmark follows its page: when pages are reordered it still goes to the same page. When its page is deleted the bookmark goes too, and the bookmarks under it move up into its place.

## In the viewer

The thumbnails in the sidebar, the **Organise pages** view and the outline tab make up the page tools. They are part of [`PdfEditor`](/pdf/ready-made-ui/) and of `PliPdf` (turn them off with `pageTools={false}`). They call the commands above, so everything is undoable and saved like any other change.

**Selecting.** Click a page to go to it, Shift-click for a range, Ctrl or Cmd with click to add or take away one, Ctrl or Cmd with A for all. The selection is `session.selection.pages` and comes back with undo.

**Changing pages.** The bar above the thumbnails (and the page menu: right click, the menu key, or the "more" button) works on the selected pages: turn either way, delete, duplicate, insert a blank page before or after (the size of its neighbour), insert pages from a PDF or pictures, move to a chosen place, extract, split and page labels.

- **Delete** asks first when you chose several pages or the pages carry annotations. Otherwise it deletes at once and shows "1 page deleted" with **Undo**. The last page cannot be deleted.
- **Drag** pages to a new place. A line shows where they will land, and you can drag several selected pages together. Drop PDF or picture files between pages to add them there. A file with a password asks for it. Without a mouse, use Alt with the arrow keys, or **Move to** in the page menu.
- **Extract** asks for the pages (filled in from the selection) and can delete them from the document afterwards. **Split** cuts every n pages, by page ranges, or at the bookmarks of a level. It shows the files it will make and downloads them as one ZIP or one by one.
- **Page labels** numbers the selected or all pages as 1 2 3, i ii iii, I II III, a b c, A B C or one text, with a start and a prefix.

**Organise pages** (the grid button, or Page layout > Organise pages) shows every page as a large thumbnail. It has the same selecting, dragging and keys, a slider for the thumbnail size, and turn, insert and delete buttons on each page. Double click or Enter goes to a page and closes the view.

**Bookmarks.** In the outline tab, **Add bookmark here** adds one for the page shown (and how far down you have scrolled) and lets you name it. Double click or F2 renames, the buttons on the bookmark indent, outdent, send it to the page shown and delete it (with Undo), and you can drag a bookmark to move it or drop it onto another to nest it. A read-only viewer shows the outline only.

Everything is announced to screen readers ("Moved 2 pages to start at position 5"). On a phone the menus come up as sheets from the bottom.

The keys are: Ctrl or ⌘ with Shift with R or L turns the selected pages, Ctrl or ⌘ with Shift with Delete deletes them, the arrow keys walk the thumbnails, Alt with the arrow keys moves the selected pages, Ctrl or ⌘ with D duplicates, Insert adds a blank page, the menu key (or Shift with F10) opens the page menu, and in the outline F2 renames and Delete deletes a bookmark. The whole list is on [Keyboard shortcuts](/pdf/shortcuts/#pages-and-files). `pageShortcutTable()` gives the rows as data, and `registerShortcuts(group, rows)` lets your own tools add theirs, so a help screen can list them all.

For your own layout, these are exported: `Thumbnails`, `OrganiseGrid`, `Outline` (give it `edit`), `PageToolbar`, `PageDialogs`, and `PageTools`, the controller that holds what they do (`usePageTools()` inside the viewer). Drive it without a screen the same way: `tools.rotate(90)`, `tools.moveBy(-1)`, `tools.insertFiles(files, at)`.

## Which saves write a new file

An update of the original appends to the end of the file and keeps every original byte, which keeps digital signatures valid. These are all updates: turning, reordering, inserting blank pages, duplicating, merging pages in, labels, bookmarks, and everything to do with annotations and forms.

Deleting a page forces a new file. The page's content has to leave the file, and an update could only hide it. `save()` does this by itself (`saveDetailed` tells you in `mode`). Extract and split always write new files, and so do [redaction and text replacement](/pdf/text-and-redaction/).

See [Files](/pdf/files/) for the save options.
