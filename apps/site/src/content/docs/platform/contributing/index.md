---
title: Contributing
description: How to get the Pli code, what you need to run it, how the repository is laid out, and where to read next if you want to change something.
sidebar:
  order: 1
---

Pli is open source under the Apache License 2.0, and the code is on [GitHub](https://github.com/MaisonDeCode/pli.dev). This section is for people who change Pli. If you want to use it in an app, install the packages from npm instead: see [Package names](/platform/package-names/).

| Page | What is on it |
|---|---|
| [Setting up and running](/platform/contributing/setup/) | Install, the playground, this site, tests, builds, and the optional checks against LibreOffice, qpdf and pypdf |
| [Working on Pli itself](/platform/contributing/working-on-pli/) | The rules the code follows, how to add a feature, a function, a theme, an annotation tool or a font, and what a change comes with |
| [Releases and versioning](/platform/contributing/releases/) | What a version number promises, and how a release gets to npm |
| [Reporting bugs and proposing changes](/platform/contributing/bugs-and-changes/) | What to put in an issue or a pull request |

## Get the code

```sh
git clone https://github.com/MaisonDeCode/pli.dev.git
cd pli.dev
pnpm install
```

You need Node 20 or later and [pnpm](https://pnpm.io) 10 (the `packageManager` field in `package.json` names the exact version; with Corepack on, `pnpm` picks it up by itself). The published packages say `"engines": { "node": ">=20" }`, and CI runs the tests on Node 20, 22 and 24.

Swift work needs Xcode (the package uses Swift tools 5.9). Kotlin work needs a JDK 21 for the `packages/kotlin` build and Android Studio for the Android module. You need none of them for the TypeScript packages.

## How the repository is laid out

It is one pnpm workspace (`pnpm-workspace.yaml`): `packages/*`, `apps/*`, `examples/capacitor` and `skills/pli-documents`.

| Path | What it is |
|---|---|
| `packages/core` | `@pli.dev/core`: what every editor shares. The `Session` with its history, ids and errors, users and permissions, comments, presence, live editing (the sync client and the authority), versions, storage, scripting, and fonts. Nothing in it belongs to one product. |
| `packages/docs`, `sheets`, `decks`, `pdf` | The four engines: `@pli.dev/docs`, `sheets`, `decks` and `pdf`. Each is a model (plain JSON), a reducer for its operations, commands, and the file formats of its product. No DOM, no Node built-ins. |
| `packages/react`, `sheets-react`, `decks-react`, `pdf-react` | The React editors. `@pli.dev/react` is also where the shared toolbar, menus and styles live, so the other three use it. |
| `packages/swift`, `kotlin`, `kotlin-android` | The Swift package and the two Kotlin modules. They run the engines as scripts (JavaScriptCore, QuickJS) and show the editor as one HTML file in a web view. Not on npm. |
| `packages/native`, `packages/editor-host` | Build tooling that makes those scripts and that HTML file. Private: never published. |
| `apps/playground` | The editors on a dev server, with a collaboration server, for trying changes. |
| `apps/site` | This documentation site (Astro and Starlight), the landing page, and the live editors on it. |
| `examples` | Small apps: Swift on iPhone and Mac, Kotlin on Android, and Capacitor. |
| `skills/pli-documents` | The agent skill for Documents, and its command line tool. |
| `scripts` | Scripts for the repository itself: the font catalogue, the clipboard capture, the build and the check for publishing. |

### How the packages depend on each other

| Package | Uses |
|---|---|
| `@pli.dev/core` | nothing from Pli |
| `@pli.dev/docs` | `core`, and `fflate` for DOCX |
| `@pli.dev/sheets`, `decks`, `pdf` | `core`, `docs` (for rich text), and `fflate` |
| `@pli.dev/react` | `core`, `docs` |
| `@pli.dev/sheets-react` | `core`, `sheets`, `react` |
| `@pli.dev/decks-react` | `core`, `decks`, `react` |
| `@pli.dev/pdf-react` | `core`, `pdf`, `react`, and `pdfjs-dist` (optional) to draw pages |

Nothing in an engine imports from a React package, and no editor imports from another editor. The tool that checks this before a release is described in [Releases and versioning](/platform/contributing/releases/).

### What is core and what is per editor

A change belongs in `@pli.dev/core` if every editor would want it: comments, people, presence, live editing, sharing, versions, storage, scripting, fonts, the `EditorSession` contract. It belongs in an engine if it is the model, an operation or a file format of one product. It belongs in a `*-react` package if it is something you see or touch. The rule of thumb in [Architecture](/platform/architecture/) is that the shared features are built once, with a small adapter in each editor that says where a comment is anchored or how an operation is transformed, and not rebuilt in each product.

## Where to start

- To run something: [Setting up and running](/platform/contributing/setup/).
- To change something: [Working on Pli itself](/platform/contributing/working-on-pli/).
- To find something to do, the product roadmaps list what is not done yet: [Documents](/documents/roadmap/), [Sheets](/sheets/roadmap/), [Decks](/decks/roadmap/), [PDF](/pdf/roadmap/), and the [main roadmap](/roadmap/).
