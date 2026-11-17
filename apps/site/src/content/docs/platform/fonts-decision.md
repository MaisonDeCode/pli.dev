---
title: Why Fontsource files and a bundled list
description: Why Pli's fonts come from Fontsource's files with a list that ships inside the package, and not from Google's API or its CSS endpoint, and what would change that.
sidebar:
  order: 8.5
---

This is the reasoning behind one choice in [Fonts](/platform/fonts/): where the font **list** and the font **files** come from. The checks were made on 16 November 2026.

## What we needed

1. A **list** of families that can be searched with no network, with each family's weights, scripts and kind.
2. The **files**, downloaded only when a document uses them.
3. A way to keep **every request on your own server**, for apps that can't call a third party and must work offline.
4. **Nothing to sign up for**: no key to keep secret or to give each host app.
5. **Open licences** that allow fonts in documents and in PDFs.

## The four options

| | Google Fonts Developer API | Google `css2` endpoint | `@fontsource/*` packages | Fontsource API and `google-font-metadata` |
|---|---|---|---|---|
| What it is | `googleapis.com/webfonts/v1/webfonts?key=…`: the family list and a TrueType link for each | `fonts.googleapis.com/css2?family=…`: a stylesheet that points at the files | One npm package per family, with its files and its licence | A JSON list of families and their details (`api.fontsource.org/v1/fonts`), and the same data as an npm package under the MIT licence |
| Needs a key | **Yes.** Without one it answers 403 | No | No | No |
| Licensing | Each family's own (mostly OFL) | Each family's own | Each family's own, with the `LICENSE` file inside the package | Describes the licence of each family |
| Works offline | No | No | **Yes**, once the files are in your app | The list can be saved (Pli does) |
| Weight in your app | Nothing, but a key to ship | Nothing | The files you copy: about 20 to 25 KB per Latin file | None. Pli ships a snapshot of about 20 KB gzipped |
| Privacy | A call from the browser reaches Google (a call from your server doesn't, but then it needs a server) | **Each visitor's address and browser details reach Google** | None if you serve the files yourself. On the CDN, jsDelivr sees the request | The list needs no visitor request: it is read when the catalogue is made |
| If it fails | Over quota or a revoked key: no answer | Blocked or down: no files | A file missing from your copy: that family stays on its stand-ins | The snapshot is unaffected: it is read once, when the catalogue is made |
| Self-hosting | Unsuitable for bundling | Only by copying what it returns | **Yes.** The same file layout as the CDN | Yes |

In more detail:

- **The Developer API** gives good data, but every host app would need its own key, which is a secret to ship or to put behind a proxy, and it has a quota. It is made for a server that lists fonts, not for a library that wants to work offline. Not chosen.
- **The `css2` endpoint** is simple and gives the browser the exact format it prefers, cut into slices by script. But the visitor's address and browser details go to Google, it needs the network, and it uses two hosts (`googleapis.com` and `gstatic.com`). It can't be self-hosted without scraping its answers. Offered as an option (`googleCssSource()`), not the default.
- **The `@fontsource/*` packages** put the files in npm: versioned, so the same release gives the same files, and usable with no third party. The same files are on jsDelivr (`cdn.jsdelivr.net/fontsource/fonts/<id>@<version>/<script>-<weight>-<style>.woff2`), so moving from the CDN to your own server is a change of address. The cost is that there are about 1,900 packages, so Pli can't depend on them all: you install the ones you need.
- **The Fontsource API** lists families, weights, styles, scripts, licence and kind, with no key. It is what Pli's catalogue is made from.

## What we chose

**A list that ships with Pli, and files from Fontsource.**

- The catalogue is a snapshot made by a script from Fontsource's list, ordered by Google's popularity, with only open licences (OFL, Apache 2.0, the Ubuntu Font Licence, MIT, CC0, the Unlicense). It is 2,093 families and about 20 KB gzipped. Searching it needs no network and it never changes while the app runs.
- The files come from Fontsource's copy on jsDelivr by default, because that works with no setup. **`fontsourceNpm`** switches to your own server by changing one line. **`googleCssSource`** is there for hosts who want Google's own CSS. A host can also write its own `FontSource`.
- The fonts are **not** bundled in the Pli packages. The only size cost is the list.

If a download fails (no network, a blocked CDN, a timeout of 8 seconds), the text is drawn in stand-ins: for the Office fonts a free look-alike with the same widths, then a generic family. Nothing disappears, and a file that arrives late still switches the text over.

## What would change it

- If Fontsource stopped publishing, or its files stopped matching Google's, the catalogue script and `fontsourceCdn` would need another origin. Both are small, and a custom `FontSource` already covers the files.
- If jsDelivr were blocked for many users, the default would move to another CDN, or Pli would ship with no default and ask each host to choose. A host that serves its own files isn't affected.
- If a host needs fonts newer than the snapshot, they run `node scripts/generate-font-catalogue.mjs` and rebuild.
- If visitors' addresses must never leave your server, use `fontsourceNpm` or `source: null`. That is why self-hosting is a supported route.
- Sending visitors' addresses to Google or a CDN may need their consent under privacy rules. Ask your own counsel which applies to you.

## What we checked

- A Fontsource file on the CDN (Inter, Latin, 400) answers with 200 and is 23.7 KB. The answer sets no cookie and allows any origin.
- The Google Developer API answers 403 without a key. The `css2` endpoint answers without one.
- Fontsource's list has about 2,100 entries before Pli keeps only the open-licence ones that hold text.
