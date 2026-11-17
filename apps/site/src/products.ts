/**
 * The editors and sections of the site, in one place: the front page cards, the section menu and its icons all
 * read this, so they can't drift apart. Icons are the inside of a 24 by 24 SVG drawn with a 1.6 stroke.
 */
/** How far along an editor is: `Built` is for one with nothing left on its roadmap that needs building, `In progress` for one that works and is still being finished and checked, `Planned` for one that is not started. */
export type Status = "Built" | "In progress" | "Planned";
export const STATUSES: readonly Status[] = ["Built", "In progress", "Planned"];

/** The pages whose title is the ProductHero's h1, so Starlight's own title is left out (see components/PageTitle.astro). */
export const HERO_PAGES: readonly string[] = ["documents", "sheets", "decks", "pdf", "platform/architecture"];

export interface Product {
  /** The name on the front page and the label in the section menu. */
  name: string;
  /** The section menu's label: `Pli.Documents`. */
  menu: string;
  blurb: string;
  status: Status;
  /** Where its section starts. Always `/<folder>/`, and `src/content/docs/<folder>/index.md(x)` is the page. */
  href: string;
  from: string;
  to: string;
  icon: string;
}

export const PRODUCTS: Product[] = [
  {
    name: "Documents",
    menu: "Pli.Documents",
    blurb: "A document editor with pages, tables, comments and suggestions, live editing, and DOCX, Markdown, HTML and PDF files.",
    status: "In progress",
    href: "/documents/",
    from: "#4a3bd8",
    to: "#7c5cf5",
    icon: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  },
  {
    name: "Sheets",
    menu: "Pli.Sheets",
    blurb: "A spreadsheet with Excel-compatible formulas, charts, pivot tables and XLSX files, in a React grid editor.",
    status: "In progress",
    href: "/sheets/",
    from: "#0b7d55",
    to: "#0d9488",
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  },
  {
    name: "Decks",
    menu: "Pli.Decks",
    blurb: "Slides that look and work like Google Slides: themes, layouts, animations, present mode, and PPTX and PDF files.",
    status: "In progress",
    href: "/decks/",
    from: "#d97706",
    to: "#c2410c",
    icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
  },
  {
    name: "Boards",
    menu: "Pli.Boards",
    blurb: "A free-form canvas for notes, shapes and images.",
    status: "Planned",
    href: "/boards/",
    from: "#0369a1",
    to: "#2563eb",
    icon: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="6" width="8" height="6" rx="1.5"/><rect x="5" y="14" width="7" height="7" rx="1.5"/>',
  },
  {
    name: "Forms",
    menu: "Pli.Forms",
    blurb: "Questions, validation and responses you own.",
    status: "Planned",
    href: "/forms/",
    from: "#a21caf",
    to: "#be185d",
    icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  },
  {
    name: "PDF",
    menu: "Pli.PDF",
    blurb: "Open, view, annotate, reorganise, fill, redact and save PDFs, with a headless engine and a React editor.",
    status: "In progress",
    href: "/pdf/",
    from: "#dc3a40",
    to: "#9f1d22",
    // A page with its corner turned down and a PDF label across it. The letters are drawn in the card's own color (see `.pdf-letters`).
    icon:
      '<path d="M8 3h6.5L19 7.5V21H8z"/><path d="M14.5 3v4.5H19"/>' +
      '<rect x="2.5" y="11.5" width="14" height="7.5" rx="1.6" fill="currentColor" stroke="none"/>' +
      '<g class="pdf-letters" stroke-width="1.35"><path d="M4.4 17.2v-3.9h1.4a1.3 1.3 0 0 1 0 2.6H4.4"/><path d="M8.7 13.3v3.9h.9a1.95 1.95 0 0 0 0-3.9z"/><path d="M13.1 17.2v-3.9h2.1M13.1 15.2h1.7"/></g>',
  },
  {
    name: "Databases",
    menu: "Pli.Databases",
    blurb: "Structured records that documents, sheets and forms can share.",
    status: "Planned",
    href: "/databases/",
    from: "#334155",
    to: "#0f172a",
    icon: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  },
];

/** The sections that aren't editors, which have an icon in the section menu but no card on the front page. */
export const SECTIONS: Pick<Product, "menu" | "href" | "from" | "to" | "icon">[] = [
  {
    menu: "Start here",
    href: "/introduction/",
    from: "#4f46e5",
    to: "#2563eb",
    icon: '<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>',
  },
  {
    menu: "Pli.Scripts",
    href: "/scripts/",
    from: "#0f766e",
    to: "#4338ca",
    icon: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/><path d="m13.5 5-3 14"/>',
  },
  {
    menu: "Platform",
    href: "/platform/architecture/",
    from: "#0e7490",
    to: "#155e75",
    icon: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>',
  },
];

/** Everything that has a place in the section menu, by the address its section starts at. */
export const MENU_ICONS: Map<string, Pick<Product, "menu" | "from" | "to" | "icon">> = new Map([...PRODUCTS, ...SECTIONS].map((p) => [p.href, p]));
