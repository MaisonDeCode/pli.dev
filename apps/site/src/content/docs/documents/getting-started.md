---
title: Get started
description: Add a document editor to a React, Swift or Kotlin app, or use the engine on its own.
---

Install the engine and the React editor:

```sh
npm install @pli.dev/docs @pli.dev/react
```

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. The editor needs `react` and `react-dom` 18 or 19 in your app. The engine, `@pli.dev/docs`, has no peer dependencies and runs in any ES2022 environment: a browser, Node 20 or later, or a web view. Both packages are ESM and ship their own TypeScript types. For the version rules and what each package is, see [Releases and versioning](/platform/contributing/releases/).

To see an editor running before you write any code, open the playground from a clone of the repository (see [Working on Pli itself](/platform/contributing/)). It is a working editor with live Markdown, HTML and JSON output and a DOCX download.

## Option 1: the ready-made editor

In a React app, `@pli.dev/react` gives you a full editor:

```tsx
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import "@pli.dev/react/styles.css";

export function Editor() {
  const session = useDocumentSession();
  return <PliDocument session={session} />;
}
```

See [Ready-made editor](/documents/ready-made-ui/) for props and theming.

## Option 2: Swift or Kotlin

For an iPhone, iPad, Mac or Android app, add the package for your language. The full editor is one view:

```swift
import Pli

struct Notes: View {
    @State private var document = ""
    var body: some View { PliEditor(json: $document) }
}
```

```kotlin
PliEditor(json = document, onJsonChange = { document = it }, modifier = Modifier.fillMaxSize())
```

Or draw the document natively, with your own layout around it. Swift and Kotlin are used from a clone of the repository; the install steps are on the [Swift](/documents/swift/#install) and [Kotlin](/documents/kotlin/#install) pages.

## Option 3: the engine

`@pli.dev/docs` is headless. A `DocumentSession` holds the document, its history and its selection, and you change it with methods.

```ts
import { DocumentSession, createDoc, heading, paragraph, bold, caret } from "@pli.dev/docs";

const intro = paragraph(["Pli is ", bold("headless"), "."]);
const session = new DocumentSession(createDoc("My first doc", [heading(1, "Hello"), intro]));

// Edit by position...
session.insertText(intro.id, 0, "Note: ");
session.format(intro.id, 0, 5, { italic: true });

session.undo(); // back to before the italic
session.undo(); // back to before "Note: "
```

Every method above is shorthand for `session.transact([...ops])`. See [Operations](/documents/concepts/operations/).

### Edit like an editor

The session also tracks a selection and can act on it the way a text editor does:

```ts
session.select(caret(intro.id, 0));
session.typeText("Hello ");   // typing
session.splitBlock();         // Enter
session.backspace();          // Backspace
session.toggleMark("bold");   // with a caret, formats the next typed text
```

Undo restores the selection too, and a quick burst of typing undoes as one step. See [Selection and commands](/documents/concepts/selection-and-commands/).

### Listen for changes

```ts
const stop = session.subscribe(({ state, ops, origin }) => {
  // origin is "local", "undo", "redo" or "remote"
  render(state);
});
```

### Export

```ts
import { toMarkdown, toHtml, toDocx } from "@pli.dev/docs";

const markdown = toMarkdown(session.state);
const html = toHtml(session.state, { fullDocument: true });
const bytes = toDocx(session.state); // Uint8Array, a ready-to-save .docx
```

See [Exporting](/documents/guides/exporting/) for what each format preserves, and [Saving and loading](/documents/guides/saving-and-loading/) to store a document as JSON.
