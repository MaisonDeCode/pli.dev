---
title: Releases and versioning
description: The nine npm packages, how they are versioned together, what a version number promises, where the changelog is, and which Node, React, browser and TypeScript versions Pli supports.
sidebar:
  order: 4
---

Pli is released on npm under the `@pli.dev` scope. Every package follows [semantic versioning](https://semver.org), and all of them are released together with one version number.

## The packages

| Package | What it is for |
|---|---|
| `@pli.dev/core` | What every editor shares: operation sessions and history, ids, comments, people, live editing, storage and fonts. |
| `@pli.dev/docs` | The Documents engine: the document model, operations, and Markdown, HTML and DOCX files. |
| `@pli.dev/react` | The Documents editor for React, and the shared toolbar, menus and styles. |
| `@pli.dev/sheets` | The Sheets engine: workbooks, Excel-compatible formulas, CSV and XLSX files. |
| `@pli.dev/sheets-react` | The spreadsheet editor for React. |
| `@pli.dev/decks` | The Decks engine: masters, layouts, themes, PPTX, template and PDF files. |
| `@pli.dev/decks-react` | The slide editor for React. |
| `@pli.dev/pdf` | The PDF engine: reading, editing and saving PDF files. |
| `@pli.dev/pdf-react` | The PDF viewer and editor for React. |

Install one engine and its editor for each product you use:

```sh
npm install @pli.dev/docs @pli.dev/react                    # Documents
npm install @pli.dev/sheets @pli.dev/sheets-react           # Sheets
npm install @pli.dev/decks @pli.dev/decks-react             # Decks
npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist      # PDF
```

`@pli.dev/core` comes with each of them. Install it yourself as well if your code imports from it. [Package names](/platform/package-names/) has the details.

The Swift and Kotlin packages are folders of the [repository](https://github.com/MaisonDeCode/pli.dev), not npm packages. Check out the Git tag of a release to get the Swift and Kotlin code that matches the npm packages of that version.

## One version number

All nine packages always have the same version. If `@pli.dev/docs` is at 1.4.0, then `@pli.dev/react` is at 1.4.0 too, even when only one of them changed. Install matching versions of the packages you use, for example by giving them the same range in `package.json`.

The reason is that an engine and its editor are built and tested together. The editor calls the engine's operations and reads its model, so a pair that was never tested together can fail in ways neither package's tests would show. One number removes the question of which editor goes with which engine.

## What a version number means

Versions are `major.minor.patch`.

- **Patch** (1.0.1): bug fixes. Nothing you wrote against the documented behaviour stops working.
- **Minor** (1.1.0): new features and additions. Existing code keeps working.
- **Major** (2.0.0): changes that can break existing code or files. They wait for the next major version.

### What counts as breaking

A change is breaking, and waits for 2.0, if it changes any of these in a way that makes correct existing use fail:

- **The exported API.** The names, arguments, return values and documented behaviour of everything the packages export from the entry points in the docs (`@pli.dev/react`, `@pli.dev/react/collab`, the `styles.css` files, `@pli.dev/pdf-react/pdfjs`, and so on).
- **The JSON formats.** Document, workbook and deck JSON, and the PDF editing model. A file saved by any 1.x opens in every later 1.x. A newer file is not promised to open in an older version, because a later release can add fields.
- **Operations.** The shape of the operations a session applies, logs and sends, and what each one does, since saved histories, scripts and servers depend on them.
- **The collaboration messages.** The messages the sync client, the authority and the transports send, the presence payloads, and the comment store and people interfaces. Their shape stays the same throughout 1.x, so a server and a client on different 1.x versions understand each other.
- **Documented CSS.** The class names and custom properties that the docs describe for styling the editors, such as `--pli-accent` and the `--pli-chrome-*` variables.

### What is not breaking

- **Anything undocumented.** A file path you import by hand, an internal function, a class name or custom property that the docs do not mention. The `exports` field of each package lists the entry points you can import; anything else is not available and not promised.
- **How it looks.** Spacing, colours, icons, animation and other visual tweaks to the editors. If you need an exact look, set the documented custom properties.
- **The bytes of exported files.** A DOCX, XLSX, PPTX or PDF from Pli opens in the same programs and says the same thing after an update, but its internal XML or byte layout can change.
- **Fixes.** A change that makes Pli do what its docs always said it does.
- **Added exports, options and fields.**

### Deprecations

Before something documented is removed, it is deprecated first: marked in the types and in the changelog, with what to use instead. It keeps working for at least one minor release, and it is removed only in a major version.

## The changelog

Each release is written up in three places:

- `CHANGELOG.md` at the root of the repository: a summary of every release.
- `CHANGELOG.md` inside each package, which is also in the package on npm. [Changesets](https://github.com/changesets/changesets) writes these.
- The GitHub Releases page of the repository, which mirrors them.

Read the entries between your version and the new one before you update. Changesets groups them as major, minor and patch changes.

## How a release is made

This part is for the people who maintain Pli. The long version, with the one-time setup, is `RELEASING.md` in the repository.

### The note for each change

A change that people who use the packages would notice comes with a changeset: run `pnpm changeset`, pick the packages, choose patch, minor or major, and write one sentence for the changelog. It is a small file in `.changeset/` that you commit with the change. Nothing user-visible, such as a test or a refactor, needs one. The nine packages are in one "fixed" group (`.changeset/config.json`), so a changeset for any of them moves all nine to the same new version. The private packages (`@pli.dev/native`, `@pli.dev/editor-host`, `@pli.dev/skill`), the site, the playground and the examples are ignored.

### The release pull request and the publish

When changesets reach `main`, the Release workflow (`.github/workflows/release.yml`) runs the type check and the tests and then Changesets' action. With changesets waiting, it opens a pull request called "Version packages" that raises the version of all nine packages, writes the notes into each package's `CHANGELOG.md`, and updates the lockfile (`pnpm version-packages`). Merging that pull request runs `pnpm release`, which builds the packages, runs the check below, and publishes with `changeset publish`. It publishes only the versions that are not on npm yet, tags each one (`@pli.dev/docs@1.4.0`), and creates the GitHub Release. The workflow publishes with npm provenance (`NPM_CONFIG_PROVENANCE`, and `id-token: write` on the job), which links each package on npm to the commit and the build that made it.

The first release, 1.0.0, had no changesets: the versions in the repository were already 1.0.0, so the first run published all nine. Releases after that are made from changesets, as above.

### Try it first

```sh
pnpm release:dry
```

It builds, runs `pnpm release:check`, and runs `pnpm publish --dry-run` for each package, so you see the exact files and sizes without publishing anything. Always publish with pnpm (the scripts do): in the repository the `exports` point at source, and pnpm swaps in the built ones from `publishConfig` when it packs. `npm publish` does not, and would publish source.

### What to check before publishing

`pnpm release:check` (`scripts/check-publish.mjs`) does the checking, after `pnpm build`. It fails when:

- a `package.json` is missing a field (license, repository with its directory, homepage, bugs, keywords, `engines`, `files`, `sideEffects`, `publishConfig`), or the version is not the same in all nine;
- a package has a README or a LICENSE missing, or its LICENSE differs from the root one;
- a dependency on another Pli package is not a `workspace:` range, or is on a private package;
- `dist` is missing, a file named in the exports is missing, or an entry has no types;
- the built code imports something not in `dependencies` or `peerDependencies`, reaches into another package's `src`, contains an absolute path from the machine that built it, or still mentions the old `@pli/` scope;
- the source of a package imports a package it does not list, or a Node built-in;
- the tarball that `pnpm pack` makes holds anything other than `dist`, the README, the LICENSE, the changelog and `package.json`, or the packed `package.json` still has a `workspace:` range or source exports, or `publint --strict` finds a problem.

`pnpm release:smoke` goes one step further: it packs all nine, installs the tarballs into a new app outside the repository with npm and with pnpm, and in that app creates a document, a workbook, a deck and a PDF in Node, renders the four React editors on the server and in jsdom, loads every entry point from CommonJS, type-checks with both `bundler` and `nodenext` resolution, and runs a Vite build. CI runs it on every push.

Before a release also look through the changesets that went into it: is each one marked patch, minor or major for the right reason, according to [What counts as breaking](#what-counts-as-breaking)?

## What Pli supports

| | |
|---|---|
| **Node** | Node 20 or later (`engines` is `>=20`). The engines (`@pli.dev/core`, `@pli.dev/docs`, `@pli.dev/sheets`, `@pli.dev/decks`, `@pli.dev/pdf`) run in Node for servers, scripts and tests, with no DOM. |
| **React** | `react` and `react-dom` 18 or 19, as peer dependencies of every `*-react` package. The tests of this repository run against React 19. |
| **Browsers** | Current versions of Chrome, Edge, Firefox and Safari. The packages are built for ES2022, and the editors' styles use `color-mix()` and container queries. A few features use newer browser APIs and check for them first: grapheme-aware text editing uses `Intl.Segmenter`, reading WOFF font files uses `DecompressionStream`, and pictures in Sheets use `createImageBitmap`. |
| **TypeScript** | The types are written and checked with TypeScript 5.6, with `strict` on. Use a `moduleResolution` of `bundler`, `node16` or `nodenext`, so that TypeScript reads each package's `exports`. The engine packages need only the ES2022 library; the React packages also use the DOM library. |
| **Module format** | ESM only, with no CommonJS build. In Node, use `import` (or `await import()` from CommonJS code). Every bundler reads ESM. |
| **Side effects** | The packages are side-effect free, so a bundler can drop what you do not use. The one exception is CSS: the `styles.css` files are marked as having side effects, so import them as `import "@pli.dev/react/styles.css"` and they are kept. |
| **pdf.js** | `pdfjs-dist` 6.2.108 or later in the 6.x line, as an optional peer dependency of `@pli.dev/pdf-react`. Version 5 is not supported: 5.6.83 and later 5.x have a high-severity security advisory that only 6.2.108 fixes, and the 5.x before that were not tried with this release. pdf.js 6 itself needs Node 22.13 or later when it runs in Node (tests, servers that render pages); in a browser, nothing changes. |

For the fonts, files and platforms of each editor, see its own section: [Documents](/documents/), [Sheets](/sheets/), [Decks](/decks/) and [PDF](/pdf/).
