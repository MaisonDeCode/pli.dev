# @pli.dev/pdf-react

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
  - @pli.dev/react@1.1.0
  - @pli.dev/pdf@1.1.0

## 1.0.0

### Major Changes

- First release. React PDF editor for Pli: thumbnails, continuous and single-page views, text selection and search, outline, annotation tools, page tools and form filling, driven by the @pli.dev/pdf engine.
