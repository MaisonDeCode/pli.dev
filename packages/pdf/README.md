# @pli.dev/pdf

Pli PDF, headless: reads and writes real PDF files, keeps pages, annotations and form values as plain JSON with invertible operations, and saves the changes back into the file. Includes text search and redaction.

## Install

```sh
npm install @pli.dev/pdf
```

To get the editor on screen too, add `@pli.dev/pdf-react` and `pdfjs-dist`: `npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist`. No peer dependencies. Runs in browsers and in Node 20 or later. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

## Example

```ts
import { makeSamplePdf, openPdf } from "@pli.dev/pdf";

// Use your own file here: openPdf(bytes) takes a Uint8Array.
const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });

const page = session.doc.pages[0]!.id;
session.annots.addHighlight(page, [{ x: 72, y: 90, w: 140, h: 14 }], { contents: "Check this" });
session.pages.rotate([page], 90);
session.undo();                       // takes the turn back

const bytes = await session.save();   // a Uint8Array: the file plus the highlight
```

## Documentation

- [Get started](https://pli.dev/pdf/getting-started/)
- [How it works](https://pli.dev/pdf/concepts/)
- [Files](https://pli.dev/pdf/files/): saving, encryption, fonts

## License

Apache-2.0.

Part of [Pli](https://github.com/MaisonDeCode/pli.dev), an open-source editor SDK. All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
