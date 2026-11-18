# @pli.dev/pdf-react

The Pli PDF editor for React: a viewer with thumbnails, outline and search, page tools, annotation tools and form filling (`PdfEditor`), driven by the `@pli.dev/pdf` engine and drawn by pdf.js.

Website and documentation: [pli.dev](https://pli.dev)

## Install

```sh
npm install @pli.dev/pdf @pli.dev/pdf-react pdfjs-dist
```

Needs `react` and `react-dom` 18 or 19 in your app. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. `pdfjs-dist` 6.2.108 or later (6.x) is an optional peer dependency: you need it to show PDF pages. Serve its worker file from your own site: Pli does not fetch the pdf.js files from a CDN. Its `styles.css` already has the shared toolbar, menus and colour pickers from `@pli.dev/react`, so that is the only stylesheet to import. Entry points: `@pli.dev/pdf-react`, `@pli.dev/pdf-react/styles.css`, `@pli.dev/pdf-react/pdfjs` (the pdf.js renderer) and `@pli.dev/pdf-react/testing` (a fake renderer for your tests).

## Example

```tsx
import { useEffect, useMemo, useState } from "react";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";   // Vite; other bundlers have their own way to get the file's address
import "@pli.dev/pdf-react/styles.css";

export function Editor({ url }: { url: string }) {
  const renderer = useMemo(() => pdfjsRenderer({ workerSrc }), []);
  const [session, setSession] = useState<PdfSession | null>(null);

  useEffect(() => {
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buffer) => openPdf(new Uint8Array(buffer), { name: "contract.pdf" }))
      .then(setSession);
  }, [url]);

  if (!session) return <p>Loading…</p>;
  return (
    <div style={{ height: "100vh" }}>
      <PdfEditor session={session} renderer={renderer} />
    </div>
  );
}
```

## Documentation

- [Get started](https://pli.dev/pdf/getting-started/): includes hosting the pdf.js files
- [The PDF editor](https://pli.dev/pdf/ready-made-ui/): props, theming, read-only mode
- [Collaboration](https://pli.dev/pdf/collaboration/)

## License

Apache-2.0.

Part of [Pli](https://pli.dev), an open-source editor SDK ([source on GitHub](https://github.com/MaisonDeCode/pli.dev)). All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
