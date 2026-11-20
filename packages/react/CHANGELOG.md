# @pli.dev/react

## 1.3.0

### Minor Changes

- Page backgrounds, text boxes and shapes. A picture can be put behind a page, and pictures, text boxes and shapes can be set at a place on it, in front of the text or behind it, without taking room in the text. Insert > Page background…, Text box and Shape; drag them or set them under Format > Object on the page. The text in a text box is filled in when a template makes a document, like the rest. Word files with pictures anchored on the page and text boxes are read as such and written back the same way, and they come out in PDF and HTML. In code, `floatingImage`, `textBox` and `pageBackground` build them, `session.insertFloat` and `session.setFloat` place and change them, and a picture or one-cell table with a `float` is the same thing saved. Backspace and Delete no longer remove a picture that floats when a paragraph next to it is joined.

### Patch Changes

- Fixes for editing templates with tags shown by name. Removing a tag in Safari no longer fails with "index is not in the allowed range". Insert > Repeat for each… only offers answers that are lists (give `fields` or `list: true`), and puts in a plain list when there are none. An answer whose name isn't a plain word, such as `answer.q-id`, is inserted as `answer["q-id"]` so it reads back, and its chip finds its name either way (`placeholderPath` is exported). With the caret against a tag, Tab steps over it and Shift+Tab steps back.
- Updated dependencies
- Updated dependencies
  - @pli.dev/docs@1.3.0
  - @pli.dev/core@1.3.0

## 1.2.0

### Minor Changes

- d455aa5: Make documents from answers. A template is an ordinary document with `{{ placeholders }}`, `{{#if}}` parts that appear only when something is true, and `{{#each}}` parts (or table rows) that repeat for each item in a list. `generateDocument(template, answers)` returns the finished document, with the answers coming from any form, questionnaire or database. Filters write dates, money, numbers and lists, and you can add your own. `templateFields(template)` reports which answers a template asks for, with their types and choices, so a questionnaire can be built from it or checked against it.
  
  In the editor, the new `placeholders` option on `PliDocument` (and `PliEditor`) draws each `{{ … }}` as a chip, red when it can't be read, and adds Insert > Field, Only if… and Repeat for each… so a template is easy to write. `placeholdersIn(text)` finds the tags in a text.
  
  `placeholders={{ labels: true, fields }}` is for people who don't write code: each tag is shown by a plain name ("Client name", "Only if Plan is team", "End") with the code hidden, and the caret, Backspace and Delete treat a tag as one character. Fields can give `options` (Insert > Only if… then offers "is Team") and, for a list, the `fields` of its items. `describePlaceholder(tag, names)` gives the words for a tag.
- d455aa5: Rename or remove the built-in menus and items. `menuLabels` on `PliDocument`, `PliSheet`, `PliDeck` and `PliPdf` takes the text a menu or item has now and what to show instead, or `false` to remove it: `menuLabels={{ "File > Download": "Export", "DOCX document (.docx)": "Word file", "Insert > Page break": false }}`. A key is the text as it is, which applies wherever it appears, or a path (`"File > Download"`) for one item. Renamed items keep their action, shortcut and state; removing a submenu's last item removes the submenu, and the lines left over are tidied. It is also the way to translate the menus. `relabelMenus` and the `MenuLabels` type are exported, and `extendMenus` takes the labels as a third argument.
- d455aa5: Take over how files are saved, and keep the default when you want it. `onDownload` on `PliDocument`, `PliSheet`, `PliDeck` and `PliPdf` is now also given `browserDownload()`, the browser's own download, so one function can share a file from a native app and fall back on the web: `onDownload={(file, { browserDownload }) => (native ? share(file) : browserDownload())}`. The new `DownloadProvider` from `@pli.dev/react` sets the function once for every editor inside it, and an editor's own `onDownload` still wins. A function that throws or rejects now shows the person "The file couldn't be saved" with its reason in Documents, Sheets and Decks, as PDF already did. The Documents, Sheets and Decks download types are all `DownloadFile` now.

### Patch Changes

- Updated dependencies [d455aa5]
  - @pli.dev/docs@1.2.0
  - @pli.dev/core@1.2.0

## 1.1.0

### Minor Changes

- Your app can hook its own notifications into comments. Pass `onNotify` where you turn comments on and it is called once for each comment, reply, edit, resolve or reopen, with who should be told and why, after the store has kept it. Pli sends nothing itself. A user directory's `search` is now told which file the comment is in, so it can offer only people who can open it, and its new `open` is called when someone clicks a name or an @mention in a comment.
- The ready-made editors take `extraMenus`, to add items to their menus (a Share under File) and menus of your own (an AI menu), and `filePicker`, to choose files with your own component instead of the browser's chooser. Without them nothing changes.
- The ready-made editors take a `theme` prop (`"auto"`, `"light"` or `"dark"`) so they can match your app, including the menus and dialogs that open outside the editor. Their title rows also take `startActions` (before the name) and `endActions` (after everything else) for your own buttons, next to the existing `actions`.
- The ready-made editors have View > Version history. It lists the versions of the file, shows an older one as it was (read-only, with what changed since), and restores it. Restoring adds a new version and keeps every earlier one. `VersionHistory` can keep versions by itself with `autoSave`, and each editor takes `history`, or `versions` (where they are kept) and `autoSaveVersions`, to set it up.

### Patch Changes

- `@pli.dev/pdf-react` now works with pdf.js 6.2.108 or later, which fixes a high-severity security advisory in pdf.js 5.6.83 and later; pdf.js 5 is no longer supported.
- Updated dependencies
  - @pli.dev/core@1.1.0
  - @pli.dev/docs@1.1.0

## 1.0.0

### Major Changes

- First release. React editor for Pli documents: a contenteditable view driven by the @pli.dev/docs engine.
