---
title: Working on Pli itself
description: The rules the Pli code follows, how to add a feature to an editor, a formula function, a deck theme, a PDF annotation tool or a font, what tests and docs a change comes with, and how to compare output with real Office files.
sidebar:
  order: 3
---

Read [Architecture](/platform/architecture/) first if you have not: it explains the session, the reducer and why the engines are portable. This page is the working version of it.

## The rules

1. **The model is plain JSON.** A document, workbook, deck or PDF model has no classes, no functions, no `Map`s, no DOM or platform types in it. It has to cross into Swift and Kotlin as a string, be saved and compared with `hash`, and be sent to other people.
2. **State changes only through operations.** An operation is a small JSON object. A reducer applies one operation to an immutable state and returns the new state and the inverse operation. Undo, redo, history, versions, live editing and scripting all work on that. A feature that changes the model any other way is not finished. Use `session.transact(ops)` so that several operations are one undo step; if any of them throws, nothing changes.
3. **The engines stay portable.** No DOM, no Node built-ins (no `fs`, `path`, `Buffer`, `crypto`), no dependency that needs them. The engines run in browsers, Node, JavaScriptCore and QuickJS. The only runtime dependency the engines have is `fflate`. The check before publishing fails when an engine imports a Node module.
4. **Shared features are built once.** Comments, people, presence, live editing, sharing, versions, storage, scripting and fonts are in `@pli.dev/core`. An editor plugs in through a small adapter: where a comment is anchored, how its operations are transformed against each other (`docSyncModel`, `sheetSyncModel`, `deckSyncModel` and the PDF one), what its `EditorSession` offers. If you are about to write a second comment system, stop and use the core one.
5. **The React packages use public APIs.** The ready-made editor is built from pieces you can import yourself. If the editor needs something from the engine that is not exported, export it.
6. **Formats are written to be read by other programs.** DOCX, XLSX, PPTX and PDF files that Pli writes must open in Word, Excel, PowerPoint, Google's editors, LibreOffice and Preview without a repair message. A test that Pli reads its own file back is not enough: see [below](#compare-with-real-office-and-google-files).

## Code style

There is no linter or formatter in the repository, so the style is what the existing files do:

- TypeScript in strict mode (`strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`), ES2022, ES modules. `verbatimModuleSyntax` and `isolatedModules` are on, so type-only imports are written `import type { … }` or `import { type X }`.
- Two spaces, double quotes, semicolons, trailing commas.
- Names are plain words: `insertText`, `setCell`, `addSlide`. Types of the model are interfaces in `model.ts`; operations are in `ops.ts`.
- Comments say why, in sentences, above the thing they describe. Exported names have a doc comment that says what a person using them needs to know. The doc comments are what people read in their editor, so keep them accurate when you change behaviour.
- Keep names and email addresses of people out of the code, the tests and the docs.

## Tests

Every change comes with tests, in `packages/<name>/test`, run by Vitest:

- A new operation: a test that applies it, undoes it and checks the state is back, and one that the sync model transforms it against the other operations (see `convergence.test.ts` and `sync.test.ts` in each engine; the [fuzzers](/platform/contributing/setup/#fuzzers) cover the rest).
- A new file feature: write the file, read it back, and check the result. For a feature that other programs show, add a test that one of them reads the file too (see [Checking files against other programs](/platform/contributing/setup/#checking-files-against-other-programs)).
- A bug fix: a test that fails without the fix. Put the smallest input that shows it in the test.
- A React change: a test in the package's `test` folder that renders it in jsdom (`// @vitest-environment jsdom` on the first line) and drives it the way a person would.
- A change to an engine: run `pnpm native`, and commit the files it changes in the Swift and Kotlin packages (a test fails if you forget).

Before you open a pull request: `pnpm test` and `pnpm typecheck` both pass.

## How to add a feature to an editor

Take "a new kind of thing in a document, spreadsheet or deck" as the example. From the inside out:

1. **The model** (`model.ts`): add the fields as plain JSON, optional, so files and saved documents from before still load. Update `validate…` and the serializer (`serialize.ts`) so that bad input is rejected with a clear error and good input survives a round trip.
2. **The operations** (`ops.ts`) and the **reducer**: one operation per thing a person can do, each returning its inverse. Prefer a small operation that sets one thing over one that replaces a lot.
3. **Sync**: add the operation to the transform in the engine's `sync.ts` so that two people doing it at once end up the same. If an operation cannot be transformed, say what wins.
4. **Commands and session methods**: the methods on the session (`session.setCell`, `session.addSlide`) call `transact` with your operations.
5. **Files**: read it from and write it to the formats the product supports (DOCX, XLSX, PPTX, PDF), and say in the docs what is kept and what is not.
6. **The editor**: in the `*-react` package, the control for it, its keyboard shortcut, and its place in the menus and toolbar. Check it with a keyboard and with a screen reader's names.
7. **The docs**: the page for the feature, and the [roadmap](#docs-and-roadmaps).
8. **Tests** as above.

## Add a function to Sheets

Functions are in `packages/sheets/src/functions`, in files by topic (`math.ts`, `stat.ts`, `text.ts`, `lookup.ts`, `financial.ts` and others). Each file exports a record of `FunctionDef`s keyed by the upper-case name; `functions/index.ts` joins the records into one table.

1. Add the definition to the file it belongs in:

   ```ts
   NEWFN: { min: 1, max: 2, fn: (args, ctx) => /* a Value, an array, or an error */ },
   ```

   `min` and `max` are the number of arguments. `lazy: true` hands the function its arguments as thunks (for `IF`-like functions that skip a branch), and `volatile: true` marks one that has to be recalculated every time (`NOW`, `RAND`). Arguments can be cell ranges, so use the helpers in `functions/helpers.ts` (`broadcast` and friends) to make a function work on arrays the way Excel's do. Errors are values (`#VALUE!`, `#N/A`), not exceptions.
2. Add its line to the function catalog in `catalog.ts` (or `catalog-more.ts`, `catalog-bonds.ts`, `catalog-forecast.ts`): the category, a summary, the arguments with a description each, an example and its result. `catalog.test.ts` fails if the catalog and the table disagree: every function needs an entry, the example must use the function, and the argument counts must match `min` and `max`. The catalog feeds the formula help and autocomplete in the editor.
3. Test it: Excel's documentation gives examples with answers; use them. Put the tests next to the others (`more-functions.test.ts`, `functions-rest.test.ts`, or a file for a family). If LibreOffice has the same function, add it to the formula lists of `libreoffice.test.ts`, which compares the two engines' answers on a real XLSX file. Where Excel and LibreOffice differ, Pli follows Excel, and the test says so.
4. Add it to the function reference in [Formulas](/sheets/formulas/) and, if the function was on the roadmap, tick it there.
5. If Excel writes the function with a prefix in files (`_xlfn.`, `_xlws.`), check that the XLSX writer and reader handle the name; `function-names-xlsx.test.ts` shows what is covered.

## Add a theme or layout to Decks

- **A theme** is a row in `THEMES` in `packages/decks/src/themes.ts`: an `id`, a `Theme` (twelve colours, a heading font and a body font), and a `spec` that says how the master looks (its background, shapes on every slide, where the title sits, and `layoutDecorations` for extra shapes on some layouts). `BUILTIN_THEMES` is made from that list and the theme picker shows it. Add the theme to `presets.test.ts` or the theme tests, and describe it in [Themes and layouts](/decks/themes-and-layouts/).
- **A layout** is one of the `LayoutKind`s in `packages/decks/src/model.ts` (`title`, `titleAndBody`, `sectionHeader`, `titleAndTwoColumns` and the rest). A new kind needs its placeholders in `build.ts` (`buildMaster` makes every layout of every master), its mapping to the PPTX layout types in `src/pptx/read.ts` and `write.ts`, and tests that a deck with it survives `toPptx` and `fromPptx`.
- Masters, layouts and themes are plain JSON inside the deck, so a theme that is in a file does not need the code that made it.

## Add an annotation tool to PDF

The PDF viewer's tools are `PdfTool`s (`packages/pdf-react/src/extensions.ts`): an `id`, a label, a cursor, and `onPointer` handlers that receive pointer events already in page space, at any zoom and rotation. Tools do not draw into the PDF themselves: they make **drafts** in the annotation controller (`annotController.ts`), and a finished gesture becomes one undoable operation.

1. In the engine (`packages/pdf/src/annots`): the annotation's type, how it is read from a file (`read.ts`), written (`write.ts`), and drawn as an appearance stream (`appearance.ts`, so that every viewer shows it), and how a hit is tested (`geometry.ts`). A test that another reader (`annots-python.test.ts`, with pypdf, qpdf and MuPDF) sees the annotation is the point of the engine side.
2. In `pdf-react`: the tool in `annotTools.tsx` (`TOOL_INFO` holds its label, key, hint and icon, and the toolbar, the tooltips and the docs table are made from it), its style controls in `annotStyles.ts` and the properties panel, and its drawing on screen in `AnnotationLayer.tsx`.
3. The docs: the tools table in [Annotations](/pdf/annotations/) and the [shortcuts](/pdf/shortcuts/) page.

## Add a font

Fonts are in `packages/core/src/fonts`.

- **A Google family** you want listed: `google-data.ts` is a snapshot of the Google Fonts catalogue and is generated, not edited. `node scripts/generate-font-catalogue.mjs` rebuilds it from Fontsource's and Google's public lists (it needs the network; `--offline <folder>` reads saved copies). Check what changed and commit the new file. The snapshot never changes at run time, so editors work offline.
- **An Office font** and its stand-ins: a row in `office.ts` (family, category, weights, whether it has italics, fallbacks, aliases). The fallbacks are what a computer without the font draws, metric-compatible ones first (Carlito for Calibri, Arimo for Arial, Tinos for Times New Roman). Check the widths in `metrics.ts` if line breaks matter.
- **Your own font** in an app does not need a change to Pli: see [Your own fonts](/platform/fonts/#your-own-fonts).

## Docs and roadmaps

Docs ship with the code: a feature is not done until a person can learn it from the site.

- The pages are Markdown in `apps/site/src/content/docs`. The title and description are in the front matter. Write what the thing does and when you would use it, with an example that runs against the current code (check it; the site is built from what the repository really exports).
- **Every page needs a sidebar entry** in `apps/site/astro.config.mjs`, in its topic (`documents/...`, `sheets/...`, `decks/...`, `pdf/...`, `platform/...`). The site build fails with "Failed to find the topic for the … page" if it is missing. The `platform` topic lists its pages one by one too, in the same file: add the slug there (`platform/package-names`), in the "Contributing" group if the page is about working on Pli.
- The pages of the four products and the platform go into `llms-full.txt` for AI agents. A new section needs adding to `apps/site/scripts/llms-full.mjs`.
- **The roadmaps** are the docs' list of what is not done: `/roadmap/` for the products, and a `roadmap.md` in each product. Anything a change leaves unfinished, unverified or deliberately left out goes there as an unchecked item in the same change, in plain words: what is missing, and what checking it would take. When you finish an item, remove it or move it to what is done. A roadmap that only grows is a sign that work is being hidden.
- Copy is plain and specific: say what the code does. The site's tests check links, the landing page's text and the product pages, so run `pnpm --filter @pli.dev/site test` after building the site (`pnpm site:build`).

## Compare with real Office and Google files

Our own readers agreeing with our own writers proves little. The repository has three ways to compare with the real programs:

- **LibreOffice and the PDF readers**, automatically, where installed: see [Setting up and running](/platform/contributing/setup/#checking-files-against-other-programs).
- **Files made by the real programs** as fixtures: DOCX files in `packages/docs/test/fixtures/docx`, PDFs from other writers in `packages/pdf/test/fixtures` (`annots-mupdf.pdf` came from MuPDF, for one), and clipboard captures (`swift scripts/capture-clipboard.swift`) for the paste tests. A bug found with a real file gets that file, or a cut-down copy of it, as a test fixture, as long as it contains nothing private.
- **The Excel check kit** for what only Excel and Google Sheets can say. `pnpm excel-check:make` writes a set of workbooks to `excel-check/` (one for each kind of thing Pli writes: formulas, formats, conditional formats, validation, charts, tables, pivots, pictures, printing and so on). Each has a "Read me" sheet first that says what to look for. Open them in real Excel and Google Sheets, check that no repair message appears and that the "Read me" lines are true, save them back from Excel into the same folder, then `pnpm excel-check:read` reads what Excel wrote and compares it with what Pli expects. The samples are in `packages/sheets/test/excel-check`. A checklist item that was not looked at yet stays on the [Sheets roadmap](/sheets/roadmap/), with the number of the kit file. The same idea works for the other editors: a folder of files to open by hand, with a line saying what to look for, and a test that reads back what came out.

Even without the kit, `packages/sheets/test/excel-check.test.ts` always runs `lintPackage` on the written files, which checks the package for the problems that Excel minds and LibreOffice does not: a file that appears twice, XML that is not well-formed, a missing or wrong content type, and more (`packages/sheets/test/excel-check/lint.ts`).
