# @pli.dev/sheets-react

The Pli spreadsheet editor for React: a virtualized grid, formula bar, toolbar, sheet tabs and status bar (`PliSheet`), driven by the `@pli.dev/sheets` engine.

Website and documentation: [pli.dev](https://pli.dev)

## Install

```sh
npm install @pli.dev/sheets @pli.dev/sheets-react
```

Needs `react` and `react-dom` 18 or 19 in your app. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. Its `styles.css` already has the shared toolbar, menus and colour pickers from `@pli.dev/react`, so that is the only stylesheet to import. Entry points: `@pli.dev/sheets-react` and `@pli.dev/sheets-react/styles.css`.

## Example

```tsx
import { PliSheet, useSheetSession } from "@pli.dev/sheets-react";
import "@pli.dev/sheets-react/styles.css";

export function Budget() {
  const session = useSheetSession();         // a new workbook
  return (
    <div style={{ height: "100vh" }}>        {/* the editor fills its parent: give it a height */}
      <PliSheet session={session} />
    </div>
  );
}
```

## Documentation

- [Get started](https://pli.dev/sheets/getting-started/)
- [The grid editor](https://pli.dev/sheets/grid/): props, shortcuts, printing
- [Collaboration](https://pli.dev/sheets/collaboration/)

## License

Apache-2.0.

Part of [Pli](https://pli.dev), an open-source editor SDK ([source on GitHub](https://github.com/MaisonDeCode/pli.dev)). All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
