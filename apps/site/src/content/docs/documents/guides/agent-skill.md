---
title: Use Pli with AI agents
description: An agent skill that lets Claude Code and other AI agents make, convert and design documents with Pli, and add the editor to an app.
---

Pli ships an **agent skill** that lets an AI agent write documents and add the editor to an app. It also ships a plain-text copy of these docs for any model to read.

## The skill

The skill is the `skills/pli-documents` folder of the [repository](https://github.com/MaisonDeCode/pli.dev). It is not an npm package: clone the repository (or download that folder) and copy it to where your agent loads skills. It follows the common agent skill layout, a `SKILL.md` file with references and scripts beside it, so it works with Claude Code, the Claude apps and other agents that read skills.

It teaches an agent two things:

| Task | What the agent does |
|---|---|
| **Make a document** | Writes Markdown (or JSON when it needs headers, columns, styles or merged cells), builds it into a `.docx`, Pli JSON, HTML or Markdown file, checks it, and, if LibreOffice is installed, renders it to look at the page. |
| **Put an editor in an app** | Follows the React, Capacitor, Swift or Kotlin guide for the right code, the install (npm for React, a clone of the repository for Swift and Kotlin), and the mistakes to avoid. |

It also carries the design rules a good document needs (one title, a heading hierarchy that doesn't skip, short paragraphs, real lists and tables, a contents page only when the document is long, page numbers on printed documents) and what each kind of document (report, proposal, letter, memo, notes, how-to, resume) should contain.

### Install

Copy the folder to where your agent looks for skills. For Claude Code, that is `~/.claude/skills/` for every project, or `.claude/skills/` in one project:

```sh
cp -r skills/pli-documents ~/.claude/skills/pli-documents       # from the root of a clone
```

Other agents have their own folder, so put it where they load skills from. The skill's tool needs Node 18 or later and nothing else. It is one file (`scripts/pli.mjs`) with the engine bundled in, so it needs no install and no network.

Then ask for what you want:

- "Write a project proposal for a kitchen renovation and give me a Word file."
- "Turn this Markdown into a DOCX with a table of contents and page numbers."
- "Read `contract.docx` and list its headings."
- "Add a Pli document editor to my Next.js app and save to my API."

## The command line tool

The agent runs it for you, and you can too:

```sh
node skills/pli-documents/scripts/pli.mjs build report.md --docx report.docx --page a4 \
  --footer "Page {page} of {pages}" --title-block
node skills/pli-documents/scripts/pli.mjs outline report.docx
node skills/pli-documents/scripts/pli.mjs validate report.pli.json
```

| Command | What it does |
|---|---|
| `build <input>` | Reads Markdown (`.md`), Pli JSON (`.json`, with shorthand allowed) or Word (`.docx`) and writes any of `--docx`, `--json`, `--html`, `--md`. Without outputs it only checks and prints a summary. |
| `outline <input>` | Prints the headings in order with counts of words, tables and pictures. |
| `validate <file>` | Checks a saved Pli document and names the place of any mistake. |

Options: `--title`, `--title-block`, `--page a4|letter|legal|a5`, `--landscape`, `--margins <inches>`, `--header` and `--footer` (text with `{page}` and `{pages}`), `--accept-changes`. Errors carry their place (`doc.blocks[3].level: expected 1 to 6`), so an agent can correct itself.

The Markdown reader is also in the library as `fromMarkdown(source)` in `@pli.dev/docs`, so an app can turn text from a model into a document:

```ts
import { fromMarkdown, toDocx } from "@pli.dev/docs";

const doc = fromMarkdown(modelOutput, { firstHeadingAsTitle: true });
const file = await toDocx(doc);
```

It understands headings, paragraphs, bold, italic, strikethrough, code, links, nested lists, quotes, code blocks, tables with alignment, dividers, `[TOC]`, `<!-- pagebreak -->` and pictures with a size.

## Text for models

Two files at the root of this site are for a model to read:

- [`/llms.txt`](/llms.txt): a short map of the docs, with a link and a line for each page that matters.
- [`/llms-full.txt`](/llms-full.txt): the Documents, Sheets, Decks, PDF and platform pages as one text file, for loading into a context window.

## Limits

- The skill is a folder you copy, not a package. For an app, it tells an agent to install `@pli.dev/docs` and `@pli.dev/react` from npm, and to add the Swift and Kotlin packages from a clone of the repository (they have no registry address).
- PDF is made by the editor, because it needs a browser's layout. The tool makes DOCX, and LibreOffice can turn that into a PDF.
- A remote picture (`https://…`) isn't embedded in a DOCX. Use a `data:` address for pictures that must travel with the file.
