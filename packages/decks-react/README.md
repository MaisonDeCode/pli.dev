# @pli.dev/decks-react

The Pli slide editor for React, laid out like Google Slides: filmstrip, canvas, toolbar, speaker notes and present mode (`PliDeck`), driven by the `@pli.dev/decks` engine.

## Install

```sh
npm install @pli.dev/decks @pli.dev/decks-react
```

Needs `react` and `react-dom` 18 or 19 in your app. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. Its `styles.css` already has the shared toolbar, menus and colour pickers from `@pli.dev/react`, so that is the only stylesheet to import. Entry points: `@pli.dev/decks-react` and `@pli.dev/decks-react/styles.css`.

## Example

```tsx
import { PliDeck, useDeckSession } from "@pli.dev/decks-react";
import "@pli.dev/decks-react/styles.css";

export function Deck() {
  const session = useDeckSession();          // a new deck
  return (
    <div style={{ height: "100vh" }}>        {/* the editor fills its parent: give it a height */}
      <PliDeck session={session} />
    </div>
  );
}
```

## Documentation

- [Get started](https://pli.dev/decks/getting-started/)
- [The slide editor](https://pli.dev/decks/ready-made-ui/): props, panels, present mode
- [Collaboration](https://pli.dev/decks/collaboration/)

## License

Apache-2.0.

Part of [Pli](https://github.com/MaisonDeCode/pli.dev), an open-source editor SDK. All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
