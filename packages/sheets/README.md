# @pli.dev/sheets

Pli Sheets, headless: a workbook model with Excel-compatible formulas (475 functions), invertible operations with undo, tables, charts, pivot tables, and CSV and XLSX files.

## Install

```sh
npm install @pli.dev/sheets
```

To get the grid editor on screen too, add `@pli.dev/sheets-react`: `npm install @pli.dev/sheets @pli.dev/sheets-react`. No peer dependencies. Runs in browsers and in Node 20 or later. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

## Example

```ts
import { SheetSession, createWorkbook } from "@pli.dev/sheets";

const s = new SheetSession(createWorkbook("Budget"));    // one empty sheet, Sheet1

s.setValues("Sheet1", "A1", [
  ["Item", "Cost"],
  ["Pens", 12.5],
  ["Paper", 8],
  ["Total", "=SUM(B2:B3)"],                               // text starting with = is a formula
]);

s.value("Sheet1", "B4");                                  // 20.5
s.setCell("Sheet1", "B2", 15);
s.value("Sheet1", "B4");                                  // 23
s.undo();                                                 // back to 12.5
```

## Documentation

- [Get started](https://pli.dev/sheets/getting-started/)
- [Formulas](https://pli.dev/sheets/formulas/)
- [Files and formats](https://pli.dev/sheets/files/)

## License

Apache-2.0.

Part of [Pli](https://github.com/MaisonDeCode/pli.dev), an open-source editor SDK. All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
