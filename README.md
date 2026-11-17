# Pli

An open-source SDK for documents, sheets, decks and PDFs, for JavaScript (React, Capacitor), Swift and Kotlin. Every editor shares comments, people, live editing and fonts. Apps built on it can let their users script their own documents, with scripts that run safely inside the app.

Documentation: https://pli.dev

## Install

The JavaScript packages are on npm under the `@pli.dev` scope. Install the engine and the React editor for the product you want:

```sh
npm install @pli.dev/docs @pli.dev/react                    # Documents
npm install @pli.dev/sheets @pli.dev/sheets-react           # Sheets
npm install @pli.dev/decks @pli.dev/decks-react             # Decks
npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist      # PDF
```

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. The React editors need `react` and `react-dom` 18 or 19 in your app. Node 20 or later. The packages are ESM with TypeScript types.

A document editor in React:

```tsx
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import "@pli.dev/react/styles.css";

export function Editor() {
  const session = useDocumentSession();
  return (
    <div style={{ height: "100vh" }}>
      <PliDocument session={session} autoFocus />
    </div>
  );
}
```

Each engine also works on its own, with no screen, in Node or in a browser. Each product's "Get started" page has the first example:

- [Documents](https://pli.dev/documents/getting-started/)
- [Sheets](https://pli.dev/sheets/getting-started/)
- [Decks](https://pli.dev/decks/getting-started/)
- [PDF](https://pli.dev/pdf/getting-started/)

## Swift and Kotlin

Pli for Swift is a Swift package in `packages/swift`, and Pli for Android is a Gradle module in `packages/kotlin-android`. They are not on a package registry: clone this repository and add them to your project as a local package or module. [Swift](https://pli.dev/documents/swift/#install) and [Kotlin](https://pli.dev/documents/kotlin/#install) show how, and the apps in [`examples`](examples) are working projects.

## What's here

Documents, Sheets, Decks and PDF each have a headless engine and a React editor, and the engines run in Swift and Kotlin too. The full document editor is also in Swift and Kotlin. Boards, Forms, Databases and Scripts are planned. The [roadmap](https://pli.dev/roadmap/) says what is done and what is open in each editor.

## Packages

| Package | What |
|------|------|
| [`@pli.dev/core`](packages/core) | Sessions, history, ids, comments, people, live editing, storage and fonts, shared by every product |
| [`@pli.dev/docs`](packages/docs) | The document model, operations, find and replace, Markdown, HTML and DOCX files |
| [`@pli.dev/react`](packages/react) | The React document editor (`PliDocument`), and the toolbar, menus and styles every React editor shares |
| [`@pli.dev/sheets`](packages/sheets) | The workbook model, Excel-compatible formulas, CSV and XLSX files |
| [`@pli.dev/sheets-react`](packages/sheets-react) | The React spreadsheet editor (`PliSheet`) |
| [`@pli.dev/decks`](packages/decks) | The slide deck model (masters, layouts, themes), PPTX and PDF export, PPTX and template import |
| [`@pli.dev/decks-react`](packages/decks-react) | The React slide editor (`PliDeck`) |
| [`@pli.dev/pdf`](packages/pdf) | Reading and writing PDF files, annotations, pages, forms, text search and redaction |
| [`@pli.dev/pdf-react`](packages/pdf-react) | The React PDF editor (`PdfEditor`), drawn by pdf.js |

All nine are released together and always share one version number. They follow semantic versioning: see [Releases and versioning](https://pli.dev/platform/contributing/releases/). The changes of each release are in [CHANGELOG.md](CHANGELOG.md) and on the GitHub Releases page.

## Principles

- The engine is portable TypeScript: no DOM, no Node built-ins, plain-JSON state. That lets it run in browsers, JavaScriptCore (iOS) and QuickJS (Android).
- Every change is an invertible JSON operation.
- Every editor is a ready-made UI, and its parts (toolbar, menus, dialogs) are exported so you can build your own.
- Docs ship with the code. A feature isn't done until it's on the site.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Contributing

This section is for working on Pli itself. To use Pli, install the packages above.

You need Node 20 or later and [pnpm](https://pnpm.io) 10.

```sh
git clone https://github.com/MaisonDeCode/pli.dev.git
cd pli.dev
pnpm install
pnpm test          # unit tests
pnpm typecheck
pnpm playground    # the editors on a dev server at http://localhost:5180
pnpm site:dev      # the docs site at http://localhost:4321
```

Where things are:

| Path | What |
|------|------|
| `packages/core`, `docs`, `sheets`, `decks`, `pdf` | The engines |
| `packages/react`, `sheets-react`, `decks-react`, `pdf-react` | The React editors |
| `packages/swift`, `packages/kotlin`, `packages/kotlin-android` | The Swift and Kotlin packages (JavaScriptCore and QuickJS) |
| `packages/native`, `packages/editor-host` | Build tooling that makes the script and HTML bundles inside the Swift and Kotlin packages (`pnpm native`). Private: not on npm |
| `apps/playground` | The full editors, with an optional live Markdown, HTML and JSON output panel |
| `apps/site` | The documentation site (Astro Starlight) |
| `examples` | Small apps: Swift, Kotlin and Capacitor |
| `skills/pli-documents` | The agent skill |

A change that users would notice comes with a Changesets note (`pnpm changeset`). See [CONTRIBUTING.md](CONTRIBUTING.md) for the short version and the [Contributing](https://pli.dev/platform/contributing/) section of the docs for the rest: [setting up and running](https://pli.dev/platform/contributing/setup/), [working on Pli itself](https://pli.dev/platform/contributing/working-on-pli/), [releases and versioning](https://pli.dev/platform/contributing/releases/), and [reporting bugs and proposing changes](https://pli.dev/platform/contributing/bugs-and-changes/). Everyone who takes part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
