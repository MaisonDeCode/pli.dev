# @pli.dev/decks

Pli Decks, headless: a slide-deck model with masters, layouts and themes, invertible operations with undo, charts and animations, and PPTX, template and PDF files.

## Install

```sh
npm install @pli.dev/decks
```

To get the slide editor on screen too, add `@pli.dev/decks-react`: `npm install @pli.dev/decks @pli.dev/decks-react`. No peer dependencies. Runs in browsers and in Node 20 or later. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

## Example

```ts
import { DeckSession, createDeck, paragraphsFromText } from "@pli.dev/decks";

const s = new DeckSession(createDeck({ title: "Launch plan" }));   // one title slide
const first = s.deck.slides[0]!;
const [title, subtitle] = first.elements;                          // its two empty placeholders

s.setText(first.id, title!.id, paragraphsFromText("Launch plan"));
s.setText(first.id, subtitle!.id, paragraphsFromText("Q3 and Q4"));

const second = s.addSlide();                                       // "Title and body", after the first
s.addTextBox(second.id, { x: 60, y: 300, w: 300 }, "A note");
s.undo();                                                          // takes the note back
```

## Documentation

- [Get started](https://pli.dev/decks/getting-started/)
- [Files](https://pli.dev/decks/files/): PPTX, templates and PDF
- [Themes and layouts](https://pli.dev/decks/themes-and-layouts/)

## License

Apache-2.0.

Part of [Pli](https://github.com/MaisonDeCode/pli.dev), an open-source editor SDK. All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
