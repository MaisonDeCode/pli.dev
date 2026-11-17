---
title: Setting up and running
description: Install the repository, run the playground and this site, run the tests and the fuzzers, build the Swift and Kotlin scripts, and use LibreOffice, qpdf and pypdf to check files.
sidebar:
  order: 2
---

## Install

```sh
git clone https://github.com/MaisonDeCode/pli.dev.git
cd pli.dev
pnpm install
```

You need Node 20 or later and pnpm 10. Do not install with `--offline`: pnpm then drops the native optional dependencies (esbuild, sharp, the canvas used in the PDF tests) from the lockfile.

## How the packages find each other

Inside the repository, each package's `exports` point at its TypeScript source (`"." : "./src/index.ts"`), and the workspace links the packages into each other's `node_modules`. Vite, Vitest, Astro, esbuild and `tsc` (with `moduleResolution: "Bundler"`) read that source directly, so:

- there is no build step while you work: change `packages/docs/src`, and the playground, the site and the tests see it at once;
- `pnpm build` exists only for publishing. It makes the `dist` folders the npm tarballs hold. See [Releases and versioning](/platform/contributing/releases/).

When a package is packed, its `publishConfig` replaces `exports`, `main`, `module` and `types` with the built files. If you add an entry point to a package, add it in both places.

## Run the playground

```sh
pnpm playground
```

This starts Vite at http://localhost:5180 with the demos for Documents, Sheets, Decks and PDF, and the collaboration server (`apps/playground/server`) attached to the same port. Restart it after changing the server's code. The pages of the demos are in `apps/playground/src`.

## Run this site

```sh
pnpm site:dev       # http://localhost:4321
pnpm site:build     # static files in apps/site/dist
```

Both first run `apps/site/scripts/llms-full.mjs`, which joins the docs of the four products and the platform into `apps/site/public/llms-full.txt` (a generated file, not committed). The landing page and the live editors on it are in `apps/site/src/components/marketing` and `apps/site/src/live`.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Every unit test, once (`vitest run`). `pnpm test:watch` keeps running. |
| `pnpm vitest run packages/sheets/test/catalog.test.ts` | One test file. A name or a folder works too. |
| `pnpm typecheck` | `tsc --noEmit` for the engines and `packages/native`, then for each React package, the playground, the Capacitor example and `packages/editor-host`. |
| `pnpm build` | Builds the nine published packages into their `dist` folders. |
| `pnpm release:check` | Checks that those packages are ready to publish. |
| `pnpm native` | Builds the engine scripts and the editor page for Swift and Kotlin, and regenerates their typed methods. |
| `pnpm native:test` | `pnpm native`, then `swift test` in `packages/swift` and `./gradlew test` in `packages/kotlin`. |
| `pnpm skill` | Rebuilds the agent skill's command line tool. |
| `pnpm --filter @pli.dev/site test` | The site's tests: the landing page, the product pages, and every link in the built site when `apps/site/dist` exists (build first). `pnpm test` runs them too. |

Tests live next to each package, in `packages/<name>/test`. The React ones start with `// @vitest-environment jsdom`. Test files for the site and the playground are in `apps/site/test` and `apps/playground/test`.

## Swift and Kotlin

The Swift and Kotlin packages run the same engines as scripts. `pnpm native` bundles each engine to one file (`packages/native/dist/pli-engine.js`, `pli-sheets.js`, `pli-decks.js`, `pli-pdf.js`), builds the editor as one HTML file (`packages/editor-host/dist/pli-editor.html`), generates the typed Swift and Kotlin methods from the command catalog (`packages/native/src/catalog.json`), and copies the results into `packages/swift/Sources/Pli/Resources`, `packages/kotlin` and `packages/kotlin-android`.

Run it after any change to an engine. A test in `packages/native/test` fails with "is out of date: run `pnpm native`" when the copies in the Swift package no longer match the build, so you cannot forget it for long.

The examples in `examples/` are separate apps that use these packages: open `examples/swift-ios/PliExample.xcodeproj` in Xcode, the `examples/android-kotlin` folder in Android Studio, run `swift run` in `examples/swift-mac`, or run `pnpm ios` and `pnpm android` in `examples/capacitor`.

## Fuzzers

The convergence and sync tests throw random edits at two copies of a document, workbook or deck and check that both end up the same, and the DOCX import test feeds the importer damaged files. By default each runs a small number of cases so the whole suite stays quick. `FUZZ_RUNS` multiplies the number:

```sh
FUZZ_RUNS=50 pnpm vitest run packages/docs/test/convergence.test.ts packages/docs/test/sync.test.ts
FUZZ_RUNS=50 pnpm vitest run packages/sheets/test/convergence.test.ts packages/sheets/test/sync.test.ts
FUZZ_RUNS=50 pnpm vitest run packages/decks/test/convergence.test.ts packages/decks/test/sync.test.ts
FUZZ_RUNS=50 pnpm vitest run packages/docs/test/docx-import.test.ts
```

Run a larger number before a change to operations, to the transform of operations against each other, or to a file reader. A failure prints the seed or the case; add it as a normal test with a fixed input so it stays fixed.

## Checking files against other programs

Several tests ask a second program to read what Pli wrote. They are skipped, not failed, where the program is missing, so you do not need any of them to run `pnpm test`. Install them when you change a file writer.

| Program | What it checks | How to turn it on |
|---|---|---|
| LibreOffice (`soffice`) | XLSX: formulas, formats, pictures, pivots, printing and more, in `packages/sheets/test/*-libreoffice.test.ts`. LibreOffice computes the same formulas; where it and Pli disagree, one is wrong. | Install LibreOffice. The tests look for `/Applications/LibreOffice.app/Contents/MacOS/soffice`, `/usr/bin/soffice` and `/usr/local/bin/soffice`. |
| LibreOffice, for decks | `packages/decks/test/pptx-animation.test.ts` opens a PPTX with animations. | `PLI_SOFFICE=1 pnpm vitest run packages/decks/test/pptx-animation.test.ts` (set `PLI_SOFFICE_DIR` for where the files go; default `/tmp`). |
| qpdf (through pikepdf), pypdf and MuPDF (through pymupdf) | PDF: the files from the page tools, annotation, form and content editing are read by all three, and their text and pages are compared. `packages/pdf/scripts/pdfcheck.py` and `annotcheck.py` do the reading. MuPDF is AGPL, so it is used only to look at files, never shipped. | `pip install pikepdf pypdf pymupdf` into a Python, then `PLI_PDF_PYTHON=/path/to/python pnpm vitest run packages/pdf`. |
| Your eyes | Sample files written for opening in a real program. | `PLI_PPTX_OUT=/some/folder pnpm vitest run packages/decks/test/pptx-write.test.ts` writes `sample.pptx` and `sample.potx`. `PLI_PDF_WRITE_DIR=/some/folder` makes `packages/pdf/test/writer-render.test.ts` keep its PDF files. |
| Excel and Google Sheets | The check kit: `pnpm excel-check:make` writes the workbooks to `excel-check/` (not committed), each with a "Read me" sheet saying what to look for. Open them, save them back, then `pnpm excel-check:read` reads what came back. | See [Working on Pli itself](/platform/contributing/working-on-pli/#compare-with-real-office-and-google-files). |

`packages/pdf/scripts` also has `make-annot-fixtures.py` and `make-form-fixtures.py`, which made the PDF fixtures in `packages/pdf/test/fixtures`. On a Mac, `swift scripts/capture-clipboard.swift <name>` saves what Word, Google Docs, Excel and other programs put on the clipboard after you copy something (add `sheets` as a second argument for cells copied from Excel or Google Sheets). The files go into `packages/docs/test/fixtures/clipboard` or `packages/sheets/test/fixtures/clipboard/captured` and the paste tests read them. Copy only content that is fine to keep in a public repository.
