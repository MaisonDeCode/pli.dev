# @pli.dev/docs

Pli Documents, headless: a rich-text document model with pages, tables, comments and suggestions, invertible operations with undo, and files in and out (Markdown, HTML and DOCX).

Website and documentation: [pli.dev](https://pli.dev)

## Install

```sh
npm install @pli.dev/docs
```

To get the editor on screen too, add `@pli.dev/react`: `npm install @pli.dev/docs @pli.dev/react`. No peer dependencies. Runs in browsers and in Node 20 or later. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

## Example

```ts
import { writeFileSync } from "node:fs";
import { DocumentSession, createDoc, heading, paragraph, bold, toMarkdown, toDocx } from "@pli.dev/docs";

const intro = paragraph(["Pli is ", bold("headless"), "."]);
const session = new DocumentSession(createDoc("My first doc", [heading(1, "Hello"), intro]));

session.insertText(intro.id, 0, "Note: ");
session.undo();                                      // back to before "Note: "

console.log(toMarkdown(session.state));
writeFileSync("hello.docx", toDocx(session.state));  // a ready-to-save .docx
```

## Documentation

- [Get started](https://pli.dev/documents/getting-started/)
- [Build your own editor](https://pli.dev/documents/build-your-own/)
- [Exporting](https://pli.dev/documents/guides/exporting/) and [importing](https://pli.dev/documents/guides/importing/)

## License

Apache-2.0.

Part of [Pli](https://pli.dev), an open-source editor SDK ([source on GitHub](https://github.com/MaisonDeCode/pli.dev)). All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
