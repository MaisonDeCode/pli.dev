---
title: Fonts
description: The fonts every Pli editor offers, how they load, how to restrict the list or serve the files yourself, the font picker, and what happens to fonts in DOCX, XLSX, PPTX and PDF files.
sidebar:
  order: 8
---

Every Pli editor offers the same fonts: the ones Word, Excel and PowerPoint ship with, and more than 2,000 open-licence families from Google Fonts. Fonts are part of `@pli.dev/core`, so [Pli.Documents](/documents/), [Pli.Sheets](/sheets/) and [Pli.Decks](/decks/) share one list, one loader and one picker.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


You do not have to set anything up. With no configuration, a font is downloaded from a CDN the first time a document uses it. You can keep the list short, serve the files from your own server, add your own fonts, or work offline.

## What you get

- **A catalogue of about 2,100 families**, shipped as a list of about 20 KB gzipped. Searching it needs no network.
- **No font files in the Pli packages.** A family is downloaded only when something draws text in it, and only the files for the weight, style and scripts that are needed (about 20 to 25 KB for a Latin file).
- **The Office fonts** (Arial, Calibri, Cambria, Georgia, Times New Roman and about 30 more) are never downloaded. They are drawn from the computer. Where a computer doesn't have one, a free look-alike stands in (below).
- **Text that never disappears.** While a font loads, or if it can't, the text is drawn in a stand-in and then switches over.

```ts
import { createFonts, setDefaultFonts } from "@pli.dev/core";

// Once, at start-up. Every editor on the page now shares this list.
setDefaultFonts(createFonts({ only: ["Calibri", "Arial", "Georgia", "Inter", "Lora", "Roboto Mono"] }));
```

## How loading works

1. A document says it uses `Lora`. The editor asks the registry to `load("Lora")`.
2. The registry asks its **source** which files the family has, and gives them to the browser (`FontFace` and `document.fonts`). The browser downloads only the files that hold the characters on the page.
3. Meanwhile the text is drawn with the family's **stack**: its own name, then stand-ins, then a generic family (`serif`, `sans-serif`, `monospace`...). Nothing is left without a font.
4. When the files arrive, the registry tells its listeners. The editors measure the text again, so lines and pages are broken for the real font.

### What the user sees

- **In the picker**, every name is drawn in its own font. A row whose font hasn't arrived yet shows in a stand-in, then switches.
- **In the document**, text in a font that is still loading uses the stand-in for a moment, and may move a little when the real font arrives. For the Office fonts this move is nil: Calibri's stand-in is Carlito, Cambria's is Caladea, Arial's is Arimo, Times New Roman's is Tinos, Courier New's is Cousine and Georgia's is Gelasio. Each has the same width for every character as the font it stands in for, so lines break in the same places.
- **If a font can't be loaded** (no network, a blocked CDN, no file for it), the stand-in stays. After 8 seconds the family is marked `failed`. If the file turns up later, it switches to `ready` and the text is measured again. Asking again with `load` tries again.
- **A font Pli has never heard of** (a name from an imported file, say) is drawn if the computer has it, with a guess at its look (serif, monospace...) as the stand-in otherwise. The name is kept as it is.

The state of a family is `registry.status(name)`:

| Status | Meaning |
|--------|---------|
| `unknown` | Not in the catalogue. The browser draws it if the computer has it |
| `system` | Installed (or nothing to load). Drawn from the computer |
| `idle` | Known, but nobody has asked for it yet |
| `loading` | Files are being downloaded |
| `ready` | Loaded. Text is drawn in it |
| `failed` | Downloading failed or took too long. The stand-ins are in use |

### Measuring again

Text is laid out with a width for each letter. Until the font file is in, Pli uses an estimate (`registry.widthFactor(name)`, which says how wide a family is compared with Helvetica). When the font arrives, the registry's `version()` goes up and its listeners are called. The ready-made editors listen for you. If you build your own interface, listen too:

```ts
import { defaultFonts } from "@pli.dev/core";

const fonts = defaultFonts();

const stop = fonts.subscribe(() => {
  // a font was loaded (or failed, or was used): measure and draw again
  redraw();
});

// in React:
// const version = useSyncExternalStore(fonts.subscribe, fonts.version);
```

To have fonts ready before the first draw, load a document's fonts and wait:

```ts
await fonts.loadAll(["Lora", "Inter"], { text: "The text that will be shown" });
await fonts.load("Lora", { weight: 700, style: "italic" }); // resolves with a status; never rejects
```

`load` never throws. When the files can't be had, the answer is `failed` and everything keeps drawing in the stand-ins.

## Choosing the list

By default every family is offered. Documents that already use a font outside the list still show it; the list only decides what the **picker** offers.

```ts
import { createFonts } from "@pli.dev/core";

// Exactly these, in this order
createFonts({ only: ["Calibri", "Arial", "Georgia", "Inter", "Lora"] });

// A rule: no display or handwriting fonts from Google
createFonts({ only: (f) => f.origin !== "google" || (f.category !== "display" && f.category !== "handwriting") });

// Only the Office fonts, and none of the 2,000
createFonts({ noGoogle: true });
```

| Option | What it does |
|--------|--------------|
| `only` | A list of names to keep (in that order), or a function that decides for each family |
| `noGoogle` | Leave the Google families out. The Office fonts and your own (`extra`) stay |
| `extra` | Families of your own to add (see [Your own fonts](#your-own-fonts)) |
| `substituteOffice` | Load Carlito, Caladea and the others where the Office font is not installed. Default `true` |
| `subsets` | Which scripts to load. Default: Latin, Cyrillic, Greek, Vietnamese and what the text needs |
| `timeoutMs` | When to give up on a download. Default 8000 |

The picker lists your own families first, then the installed ones, then Google's by popularity. You can search the list yourself:

```ts
fonts.search({ query: "mono", category: "monospace" });   // families whose name has "mono"
fonts.search({ subset: "cyrillic", weight: 700 });        // with Cyrillic, in bold
fonts.find("arialmt");                                    // the Arial entry (any case, aliases work)
fonts.offers("Lora");                                     // whether the picker shows it
fonts.recent();                                           // the families used last, newest first
```

## Where the files come from

A **source** knows where a family's files are. The default is Fontsource's copy of the Google fonts on the jsDelivr CDN. You can swap it with one line.

| Source | Files come from | Third party sees visitors | Offline | PDF files |
|--------|-----------------|:---:|:---:|:---:|
| `fontsourceCdn()` (default) | `cdn.jsdelivr.net`, versioned | jsDelivr | No | Yes |
| `fontsourceNpm({ base })` | Your own server or app bundle | No | Yes | Yes |
| `googleCssSource()` | `fonts.googleapis.com` and `fonts.gstatic.com` | Google | No | No |
| `staticSource({ ... })` | Addresses you list, for your own fonts | No | Yes | Yes (`.ttf` or `.woff`) |
| Your own `FontSource` | Wherever you like | Up to you | Up to you | If it has `file()` |
| `source: null` | Nothing is downloaded | No | Yes | No |

### Serve the files yourself

The files are the same ones the [`@fontsource/*` packages](https://fontsource.org) contain, with the same names, so moving from the CDN to your own server is a change of address. Install the packages for the families you offer, copy their `files` folders to a folder your server serves, and point `fontsourceNpm` at it:

```sh
pnpm add @fontsource/inter @fontsource/lora
mkdir -p public/fonts public/fonts/licenses
for id in inter lora; do
  cp node_modules/@fontsource/$id/files/* public/fonts/
  cp node_modules/@fontsource/$id/LICENSE public/fonts/licenses/$id.txt
done
```

```ts
import { createFonts, fontsourceNpm, setDefaultFonts } from "@pli.dev/core";

setDefaultFonts(
  createFonts({
    source: fontsourceNpm({ base: "/fonts" }),   // /fonts/inter-latin-400-normal.woff2 ...
    only: ["Calibri", "Arial", "Inter", "Lora"], // offer only what you copied
  }),
);
```

Copy both the `.woff2` and the `.woff` files: the browser uses `.woff2`, and PDF export reads the `.woff`. The packages are one per family (more than 1,900 of them), which is why Pli does not depend on them: you install the ones you need. Keep `only` in step with what you copied, or the picker will offer families that have no files.

Chinese, Japanese and Korean families come in many numbered slices. `fontsourceNpm` skips their other scripts unless you give it `api` (the address of a copy of Fontsource's API), because it needs the API to know which characters each slice has.

### Pinning a version

The CDN follows the latest release by default. To get the same files every time:

```ts
createFonts({ source: fontsourceCdn({ version: "5.3.0" }) });
```

`5.3.0` was the newest release when this page was written. The version goes into every file address (`inter@5.3.0/latin-400-normal.woff2`), so pick one that exists on [jsDelivr](https://www.jsdelivr.com/); `"5"` follows the newest 5.x. `fontsourceCdn` also takes `base`, to point at a mirror.

### Offline

For an app that must work with no network, serve the files yourself (above) and the editors work as they do online. If you serve none, use `source: null`. Nothing is downloaded, the Office fonts and fonts installed on the computer still work, and everything else is drawn in its stand-in:

```ts
createFonts({ source: null, noGoogle: true });  // the Office fonts only; a short picker
```

### Google's own CSS

`googleCssSource()` asks `fonts.googleapis.com/css2` for each family. It gives the browser the exact files it prefers, with no copy to maintain. But every visitor's address reaches Google (see [Privacy](#privacy)), it needs two third-party hosts, and it has no files for PDF, so PDF text uses the nearest standard font.

```ts
import { createFonts, googleCssSource } from "@pli.dev/core";

createFonts({ source: googleCssSource() });
```

### Your own fonts

A brand font is a family you describe, plus a source that has its files. `extra` adds it to the catalogue and `staticSource` lists the files:

```ts
import { createFonts, staticSource, type FontFamily } from "@pli.dev/core";

const acme: FontFamily = {
  family: "Acme Sans",
  category: "sans-serif",
  origin: "custom",
  weights: [400, 700],
  italic: false,
  subsets: ["latin"],
  fallbacks: ["Arial"], // used until it loads, and where it can't
};

const fonts = createFonts({
  extra: [acme],
  source: staticSource({
    "Acme Sans": [
      { weight: 400, url: "/fonts/acme-sans-400.woff" },
      { weight: 700, url: "/fonts/acme-sans-700.woff" },
    ],
  }),
});
```

For PDF files Pli reads TrueType (`.ttf`) or WOFF (`.woff`) files. **WOFF2 can't be read for PDFs.** A `staticSource` hands the first file listed for a weight to the PDF writer, so list a `.woff` or `.ttf` file there.

A source serves every family of the registry, so to add your own fonts **and** keep the Google ones, put the two sources together:

```ts
import { createFonts, fontsourceCdn, staticSource, type FontSource } from "@pli.dev/core";

const cdn = fontsourceCdn();
const mine = staticSource({ "Acme Sans": [{ weight: 400, url: "/fonts/acme-sans-400.woff" }] });

const both: FontSource = {
  name: "acme-and-cdn",
  faces: (family, wanted) => (family.origin === "custom" ? mine : cdn).faces(family, wanted),
  file: (family, wanted) => (family.origin === "custom" ? mine : cdn).file!(family, wanted),
};

createFonts({ extra: [acme], source: both });
```

### A source of your own

A `FontSource` is two functions. `faces` says which files the browser should be given (what an `@font-face` rule says). `file` returns the bytes of the font for PDF files, and is optional:

```ts
import { createFonts, type FontSource } from "@pli.dev/core";

const mine: FontSource = {
  name: "my-fonts-api",
  faces: (family, { weight, style }) => [
    { family: family.family, weight, style, format: "woff2", url: `/api/fonts/${family.id}/${weight}-${style}.woff2` },
  ],
  async file(family, { weight, style }) {
    const res = await fetch(`/api/fonts/${family.id}/${weight}-${style}.ttf`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  },
};

createFonts({ source: mine });
```

`faces` is called once for each family, weight and style that is used, and the answer is kept. It may throw: the family is then `failed`. An empty list means "this source doesn't have it". Without `file`, PDF text in the family uses the nearest standard font.

## Giving the registry to the editors

Editors use `defaultFonts()` unless you give them another registry. There are two ways, and you can use either.

**Once, at start-up.** Every editor on the page shares your configuration:

```ts
import { createFonts, setDefaultFonts } from "@pli.dev/core";

setDefaultFonts(createFonts({ noGoogle: true }));
```

**Per editor**, with the `fonts` prop of `PliDocument`, `PliSheet` and `PliDeck`:

```tsx
import { createFonts } from "@pli.dev/core";

const fonts = createFonts({ only: ["Calibri", "Georgia", "Inter"] }); // once, outside the component

<PliDocument session={session} fonts={fonts} />
```

Make the registry **once**, outside the component or in a `useMemo`. It keeps what has loaded, so a new one on every render would download everything again.

## The font picker

The editors' toolbars have a font picker. It is also exported on its own, to use in your own interface:

```tsx
import { FontPicker } from "@pli.dev/react";

<FontPicker fonts={fonts} value={family} onChange={(name) => setFamily(name ?? "Arial")} />
```

| Prop | What it does |
|------|--------------|
| `fonts` | The registry to list. Default: the one from a `FontsProvider` above it, or `defaultFonts()` |
| `value` | The family shown as chosen, as the document stores it (any name, even one the registry doesn't offer), or `undefined` |
| `onChange(family)` | Called with the family the person picked, or `null` for the default entry (see `defaultLabel`) |
| `mixed` | The selection has more than one font: the button says "Mixed" |
| `disabled` | Not usable (a read-only document) |
| `defaultLabel` | Adds an entry at the top that calls `onChange(null)`, such as "Default" |
| `label` | The accessible name of the button. Default "Font" |
| `className` | Added to the button |

It is a button that opens a searchable list, with a filter by kind (sans, serif, mono, display, script), the families used last at the top, and every name drawn in its own font. The files are fetched only for the names on screen, once scrolling stops. The keyboard works: type to search, arrows to move, Enter to choose.

To give one registry to every editor and picker inside a part of the page, wrap it in `FontsProvider`. An editor's `fonts` prop wins over the provider. If you build your own interface, `useFonts(fonts?)` returns the registry for that place, `useFontsVersion(fonts)` is a number that changes whenever a font loads or fails (so you measure and draw again), and `useDocumentFonts(fonts, families)` starts loading the families a document uses and returns that number:

```tsx
import { FontsProvider, useDocumentFonts, useFonts } from "@pli.dev/react";

function Page({ families }: { families: string[] }) {
  const fonts = useFonts();
  useDocumentFonts(fonts, families); // redraws when a font arrives
  return <div style={{ fontFamily: fonts.stack(families[0]!) }}>…</div>;
}

<FontsProvider fonts={fonts}><Page families={["Lora"]} /></FontsProvider>
```

## Fonts in files

### Names are kept

A font name is written to the file as you typed it. `Lora` stays `Lora` in DOCX, XLSX and PPTX, and comes back as `Lora` when the file is read again.

Word, Excel and PowerPoint do not have Google fonts. A person who opens the file on a computer without `Lora` sees a similar font, chosen by their Office, unless they install it. To help it choose well, Pli writes a hint beside the name:

| File | The hint |
|------|----------|
| DOCX | An entry in `fontTable.xml` with the family kind (`roman`, `swiss`, `modern`, `script`, `decorative`), the pitch (`fixed` or `variable`) and an alternative name (`altName`) |
| XLSX | `<family val="1">` to `5` after the font name |
| PPTX | `pitchFamily` and `charset` on the `<a:latin>` typeface |

For fonts that Office has, nothing is added. `officeHint(name)` and `officeSubstitute(name)` give the hint and the nearest Office font for any name, if you write files yourself.

### Writing only Office fonts

If the file must look right on any computer, ask for Office fonts. Every family that Office doesn't have is replaced by its nearest Office look-alike (Lora becomes Georgia, Roboto Mono becomes Consolas, and anything unknown is chosen by its kind: Arial, Times New Roman, Courier New or Comic Sans MS):

```ts
toDocx(doc, { fonts: "office" });
toXlsx(workbook, { fonts: "office" });
toPptx(deck, { fonts: "office" });
```

The default is `"keep"`. With `"keep"`, names are written as they are, and with `"office"` the names change: the file then no longer says `Lora` anywhere.

### PDF files

A PDF holds the fonts it uses, so the person who opens it needs nothing. Pli embeds a font when it has the font's bytes. Ask the registry for the fonts a document uses and pass them to `toPdf`:

```ts
import { defaultFonts } from "@pli.dev/core";
import { toPdf, usedFonts } from "@pli.dev/docs";

const registry = defaultFonts();
const { fonts, warnings } = await registry.pdfFonts(usedFonts(doc)); // { "Lora": bytes, "Lora bold": bytes, ... }
const bytes = toPdf(pages, { fonts });
```

`pdfFonts` returns the bytes by name in the shape `toPdf({ fonts })` takes (`"Lora"`, `"Lora bold"`, `"Lora italic"`, `"Lora bold italic"`), and a `warnings` list that names each family it couldn't get. Those families are drawn in the nearest standard PDF font. The Office fonts are not embedded: they are drawn in the standard font nearest to them.

`usedFonts` lists the families a file names, once each. There is one in `@pli.dev/docs` (for a document), `@pli.dev/sheets` (for a workbook) and `@pli.dev/decks` (for a deck). The same call works for the others: `usedFonts(workbook)`, `usedFonts(deck)`.

**The React editors do this for you.** File > Download > PDF in Pli.Documents asks the editor's registry for the fonts the document uses before it writes the file. Fonts you pass yourself in the `pdfFonts` prop win over the registry's.

## What it doesn't do

- **Fonts are not embedded inside DOCX, XLSX or PPTX files.** Only names and the hints above. Office can embed fonts, and Pli doesn't write them.
- **PDF files hold the whole font file, not a subset**, so each family adds the size of its font file to the PDF (tens of kilobytes for a Latin font, more for a large script).
- **Static weights only.** Pli uses the separate files for each weight (400, 700 and so on), not the axes of variable fonts. A weight a family doesn't have is replaced by the nearest one it does.
- **Metrics are estimates until the font has loaded.** The editors lay text out again when it arrives, so a page break can move a little. A server that lays out a document without a browser (and so loads no font) gets the estimates.
- **What an Office program draws is up to it.** The other person sees a similar font unless they install yours.
- **Fonts embedded in an imported file are not read.** Their names are kept (see [Decks files](/decks/files/)).

## Licences

Every family in the catalogue is free to use. Pli's list only includes families under the SIL Open Font License (OFL), Apache 2.0, the Ubuntu Font Licence, MIT, CC0 or the Unlicense. All of them allow you to use the fonts in documents and to embed them in PDF files.

Pli does not bundle font files, so there is nothing to keep in the Pli packages. But if you **serve the files yourself**, you redistribute them, and the OFL asks you to keep the licence text with them. Each `@fontsource` package has a `LICENSE` file: copy it next to the fonts, as in the example above. Some licences also ask you to keep the copyright notice. When in doubt, read the licence of each family you ship. This is not legal advice.

If you add your own fonts (`extra`), their licence is yours to check.

## Privacy

- **The default** (`fontsourceCdn`) asks `cdn.jsdelivr.net` for each font file. It sends no cookies and no keys, but it is a third party: jsDelivr sees the visitor's IP address and which files are asked for.
- **`googleCssSource`** sends the visitor's IP address and browser details to Google. In some places this may need visitors' consent under privacy rules. Ask your own counsel.
- **`fontsourceNpm`, `staticSource` and `source: null`** make no request to anyone but you.

If your app must make no third-party request, serve the files yourself. For why the default is a CDN and not Google, see [Why Fontsource files and a bundled list](/platform/fonts-decision/).

## Updating the catalogue

The list of families is a snapshot, made by a script. It never changes while the app runs, so you never see a new family appear on its own. To get newer families, run the script in the Pli repository and rebuild:

```sh
node scripts/generate-font-catalogue.mjs
```

It reads Fontsource's public list of fonts and Google's popularity order (no keys needed), keeps the families with an open licence, and writes `packages/core/src/fonts/google-data.ts`.

## Types

All of these are exported from `@pli.dev/core`.

### FontFamily

One family in the catalogue.

```ts
interface FontFamily {
  family: string;                       // "Lora": the name documents store and CSS uses
  category: "sans-serif" | "serif" | "monospace" | "display" | "handwriting";
  origin: "system" | "google" | "custom";
  weights: readonly number[];           // 100 to 900
  italic: boolean;                      // real italics (without, the browser slants it)
  subsets: readonly string[];           // "latin", "cyrillic"... empty for system families
  id?: string;                          // the Fontsource id of a Google family: "open-sans"
  rank?: number;                        // Google's popularity order (0 is first)
  fallbacks: readonly string[];         // stand-ins, best first
  aliases?: readonly string[];          // other names in files: "ArialMT"
  office?: string;                      // the Office font to write for it
}
```

`system` families are the Office and web-safe fonts, never downloaded. `google` families come from the catalogue. `custom` families are the ones you pass in `extra`.

### FontSource

Where a family's files are.

```ts
interface FontSource {
  readonly name: string;
  faces(family: FontFamily, wanted: { weight: number; style: "normal" | "italic" }):
    readonly FontFaceSpec[] | Promise<readonly FontFaceSpec[]>;
  file?(family: FontFamily, wanted: { weight: number; style: "normal" | "italic"; text: string }):
    Promise<Uint8Array | null>;
}

interface FontFaceSpec {
  family: string;
  weight: number;                       // 100 to 900
  style: "normal" | "italic";
  url: string;
  format: "woff2" | "woff" | "truetype";
  unicodeRange?: string;                // "U+0000-00FF,U+0131": the characters the file has
  subset?: string;
}
```

### FontRegistry

What `createFonts` returns.

```ts
interface FontRegistry {
  readonly source: FontSource | null;
  list(): readonly FontFamily[];                       // what a picker shows
  search(search?: { query?: string; category?: FontCategory | "all"; subset?: string; weight?: number }): FontFamily[];
  find(name: string): FontFamily | undefined;          // any case, aliases; offered or not
  offers(name: string): boolean;
  stack(name: string, extra?: readonly string[]): string;   // the CSS font-family value
  widthFactor(name: string): number;                   // an estimate, until loaded
  status(name: string): FontStatus;
  load(name: string, options?: { weight?: number; style?: FontStyle; text?: string }): Promise<FontStatus>;
  loadAll(names: Iterable<string>, options?: LoadOptions): Promise<void>;
  subscribe(listener: () => void): () => void;         // returns how to stop
  version(): number;                                   // goes up when listeners are called
  recent(): string[];
  use(name: string): void;                             // note a family as just used
  pdfFonts(names: Iterable<string>, options?: { text?: string; styles?: readonly ("regular" | "bold" | "italic" | "bold italic")[] }):
    Promise<{ fonts: Record<string, Uint8Array>; warnings: string[] }>;
}
```

`load` and `pdfFonts` never reject. `stack("Calibri")` gives `Calibri, Carlito, "Segoe UI", "Open Sans", Arial, sans-serif`. Also exported: `createFonts(options)`, `defaultFonts()` and `setDefaultFonts(registry)`.

### FontRegistryOptions

What `createFonts` takes. Every field is optional.

```ts
interface FontRegistryOptions {
  source?: FontSource | null;           // default: fontsourceCdn(); null loads nothing
  only?: readonly string[] | ((font: FontFamily) => boolean);
  extra?: readonly FontFamily[];
  noGoogle?: boolean;                   // default false
  substituteOffice?: boolean;           // default true
  subsets?: readonly string[];
  timeoutMs?: number;                   // default 8000
  env?: FontEnv;                        // replaces the page's font loading (tests, your own loader)
  storage?: { get(key: string): string | null; set(key: string, value: string): void } | null;
  storageKey?: string;                  // default "pli.fonts.recent"
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown>; text(): Promise<string> }>;
}
```

`storage` keeps the recently used list between visits and defaults to `localStorage` where there is one. `fetch` is used by the sources that need it (PDF files). `env` is for tests: without a DOM (Node, a worker) the default loads nothing, every family stays on its stand-ins and nothing waits.

### Helpers

| Function | What it does |
|----------|--------------|
| `lookupFont(name)` | The catalogue entry for a name (any case, quotes, aliases like `ArialMT`) |
| `fontStack(name, extra?)` | The CSS `font-family` value, ending in a generic family |
| `officeHint(name)` | The DOCX, XLSX and PPTX hints for a name |
| `officeSubstitute(name)` | The nearest Office font to a name |
| `isOfficeFont(name)` | Whether Word, Excel and PowerPoint have it |
| `fontsourceCdn(options?)` | `{ version?, base?, api?, fetch? }` |
| `fontsourceNpm({ base })` | Files you serve yourself |
| `googleCssSource()` | Google's CSS |
| `staticSource(files)` | A map of family names to `{ weight?, style?, url, format?, unicodeRange? }` |
| `fontsourceSource({ url })` | Fontsource's layout at any address: `url(file)` makes it |
