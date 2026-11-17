---
title: Reporting bugs and proposing changes
description: What to put in an issue and in a pull request, how to describe a change, the licence your work is under, and how people are expected to behave.
sidebar:
  order: 5
---

Issues and pull requests go to [github.com/MaisonDeCode/pli.dev](https://github.com/MaisonDeCode/pli.dev). Please search the open issues and the product roadmaps ([Documents](/documents/roadmap/), [Sheets](/sheets/roadmap/), [Decks](/decks/roadmap/), [PDF](/pdf/roadmap/)) first: what is not done yet is often listed there already, with what checking it would take.

## Reporting a bug

A report we can act on has:

- **What you did**, as the shortest steps that show the problem. If you can, a test, or a few lines of code that run against the packages; for a file problem, a small file that shows it. Remove anything private from a file first: files in a public issue are public.
- **What you expected and what happened.** A screenshot of an editor problem helps. For a file that opens badly in Word, Excel, PowerPoint, Google's editors or a PDF reader, say which program and version, and the message it gave.
- **Where it happens:** the package and its version (`npm ls @pli.dev/docs`), the browser or Node version, React version, and whether it is the engine (no screen) or the editor. All nine packages share a version number, so one number is enough.
- For Swift or Kotlin: the platform and OS version, and the tag or commit of the repository you use.

Do not report a security problem in a public issue. Write to the maintainers through the contact on [maisondecode.com](https://maisondecode.com), or, if it is turned on for the repository, use GitHub's private vulnerability reporting on the Security tab. Say what you found and how to repeat it.

## Proposing a change

For a small fix, open a pull request. For a new feature, or a change that touches the model, the operations or a file format, open an issue first and say what you want to build and why, so nobody spends a week on something that cannot go in. A pull request is easier to review the smaller it is, and the more it does one thing.

A pull request is ready for review when:

- `pnpm test` and `pnpm typecheck` pass.
- It has tests: a bug fix has one that fails without the fix, and a feature has tests for the new operations, files and editor behaviour. See [Working on Pli itself](/platform/contributing/working-on-pli/#tests).
- If it changes an engine, `pnpm native` has been run and the changed files in the Swift and Kotlin packages are in the pull request.
- The docs page for it is written, and anything left unfinished or unchecked is on the roadmap. See [Docs and roadmaps](/platform/contributing/working-on-pli/#docs-and-roadmaps).
- If people who use the packages would notice it, it has a changeset (`pnpm changeset`) marked patch, minor or major, with one sentence for the changelog. A change to the exported API, the JSON formats, the operations, the collaboration messages or the documented CSS is breaking: see [Releases and versioning](/platform/contributing/releases/#what-counts-as-breaking). Say so in the description; it waits for the next major version.
- It keeps the engines portable (no DOM, no Node built-ins) and the model plain JSON.
- It contains no personal data: no names or email addresses in code, tests, fixtures or docs, and no files from people or companies that are not meant to be public.

## Writing the message

There is no enforced format. What helps the next person who reads the history:

- A first line that says what the change does, in the imperative, under about 70 characters: "Keep the row height when a cell is wrapped", not "Fixed bug" or "Updates".
- A body, when the first line is not enough, that says why: what was wrong, what you chose, what you tried and left out, and what is still open.
- The same for the pull request description, with how you checked it (the tests, the program you opened a file in) and what you did not check.

## Licence

Pli is released under the [Apache License 2.0](https://github.com/MaisonDeCode/pli.dev/blob/main/LICENSE). When you send a change, you agree that your work is licensed under the same licence, as section 5 of that licence says for contributions. Only send code you wrote or have the right to give, and do not copy code or data from products whose licence does not allow it. Fonts and files you add to the repository need a licence that allows redistribution; say where they come from in the pull request.

## How we treat each other

Be kind and be specific. Disagree with the code, not with the person. Maintainers can close or lock a discussion that has stopped being useful, and remove comments that are abusive. The [Code of Conduct](https://github.com/MaisonDeCode/pli.dev/blob/main/CODE_OF_CONDUCT.md) in the repository says the rest.
