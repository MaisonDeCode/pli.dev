import type { DemoId } from "./router";

export interface Demo {
  id: DemoId;
  title: string;
  summary: string;
}

export interface Product {
  /** The editor, as in "Documents". */
  name: string;
  blurb: string;
  /** Screens that exist. An editor with none is shown as coming. */
  demos: Demo[];
}

/**
 * Everything the playground offers. The landing page is drawn from this list: to add a screen, give it an id in
 * `router.ts`, show it in `App.tsx`, and list it under its editor here. To add an editor, add an entry with no
 * screens, then fill it in when it exists.
 */
export const PRODUCTS: Product[] = [
  {
    name: "Documents",
    blurb: "The document editor: pages, tables, images, headers, footnotes, comments and export.",
    demos: [
      {
        id: "basics",
        title: "Basics",
        summary: "The editor on its own, with a long sample document to try everything on.",
      },
      {
        id: "collaboration",
        title: "Collaboration",
        summary: "The same editor in a room with other people, over a real server.",
      },
    ],
  },
  {
    name: "Sheets",
    blurb: "Spreadsheets with Excel-compatible formulas, and Excel and CSV files.",
    demos: [
      {
        id: "sheets",
        title: "Spreadsheet",
        summary: "The grid on its own, with a sample budget: formulas, formats, two sheets, and XLSX, CSV and JSON files in and out.",
      },
    ],
  },
  {
    name: "Decks",
    blurb: "Slides with layouts, themes and presenter tools.",
    demos: [
      {
        id: "decks",
        title: "Slides",
        summary: "The slide editor on its own, with a sample deck: themes, speaker notes, transitions, the slideshow, and PPTX, PDF and JSON files in and out.",
      },
    ],
  },
  {
    name: "PDF",
    blurb: "View, annotate, fill in and organise PDF files.",
    demos: [
      {
        id: "pdf",
        title: "PDF editor",
        summary: "The full editor on a sample file made in your browser, or on your own: highlights, notes, signatures, forms, page tools, bookmarks, redaction, and retyping text or swapping pictures. Nothing leaves the window.",
      },
    ],
  },
  {
    name: "In your app",
    blurb: "What the ready-made editors give a host app: a theme that matches yours, buttons and menus of your own, and your own file chooser.",
    demos: [
      {
        id: "embed",
        title: "Fitting the editors into your app",
        summary: "The `theme` prop (auto, light or dark), buttons of your own on either side of the title row, a Share item under File and a menu of your own, and a file chooser that is yours instead of the browser's.",
      },
    ],
  },
  { name: "Boards", blurb: "Freeform canvases and kanban boards.", demos: [] },
  { name: "Forms", blurb: "Forms and surveys, with the answers kept in a table.", demos: [] },
  { name: "Databases", blurb: "Tables, views and relations over your own data.", demos: [] },
];

export function demoById(id: DemoId): Demo | undefined {
  return PRODUCTS.flatMap((product) => product.demos).find((demo) => demo.id === id);
}
