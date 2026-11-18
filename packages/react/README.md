# @pli.dev/react

The Pli document editor for React: pages with headers, footers and page numbers, tables, comments, suggestions and DOCX export, as one component (`PliDocument`) and as the parts to build your own (`PliEditor`, toolbar, menus, dialogs). It also holds the toolbar, menus and styles that the other React editors share.

Website and documentation: [pli.dev](https://pli.dev)

## Install

```sh
npm install @pli.dev/docs @pli.dev/react
```

Needs `react` and `react-dom` 18 or 19 in your app. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. Entry points: `@pli.dev/react`, `@pli.dev/react/styles.css` and `@pli.dev/react/collab`.

## Example

```tsx
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import "@pli.dev/react/styles.css";

export function Editor() {
  const session = useDocumentSession();
  return (
    <div style={{ height: "100vh" }}>   {/* the editor fills its parent: give it a height */}
      <PliDocument session={session} autoFocus />
    </div>
  );
}
```

## Documentation

- [Get started](https://pli.dev/documents/getting-started/)
- [The ready-made editor](https://pli.dev/documents/ready-made-ui/): props, theming, Capacitor
- [Comments and collaboration](https://pli.dev/platform/collaboration/)

## License

Apache-2.0.

Part of [Pli](https://pli.dev), an open-source editor SDK ([source on GitHub](https://github.com/MaisonDeCode/pli.dev)). All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
