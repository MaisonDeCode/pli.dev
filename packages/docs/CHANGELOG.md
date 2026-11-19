# @pli.dev/docs

## 1.2.0

### Minor Changes

- d455aa5: Make documents from answers. A template is an ordinary document with `{{ placeholders }}`, `{{#if}}` parts that appear only when something is true, and `{{#each}}` parts (or table rows) that repeat for each item in a list. `generateDocument(template, answers)` returns the finished document, with the answers coming from any form, questionnaire or database. Filters write dates, money, numbers and lists, and you can add your own. `templateFields(template)` reports which answers a template asks for, with their types and choices, so a questionnaire can be built from it or checked against it.
  
  In the editor, the new `placeholders` option on `PliDocument` (and `PliEditor`) draws each `{{ … }}` as a chip, red when it can't be read, and adds Insert > Field, Only if… and Repeat for each… so a template is easy to write. `placeholdersIn(text)` finds the tags in a text.
  
  `placeholders={{ labels: true, fields }}` is for people who don't write code: each tag is shown by a plain name ("Client name", "Only if Plan is team", "End") with the code hidden, and the caret, Backspace and Delete treat a tag as one character. Fields can give `options` (Insert > Only if… then offers "is Team") and, for a list, the `fields` of its items. `describePlaceholder(tag, names)` gives the words for a tag.

### Patch Changes

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

## 1.0.0

### Major Changes

- First release. Pli Documents: a headless rich-text document model with operations, history and export to Markdown, HTML and DOCX.
