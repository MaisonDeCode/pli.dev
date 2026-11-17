import type { PageSetup, PageSize } from "./model";

/** Page sizes in inches, portrait. */
export const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  letter: { width: 8.5, height: 11, label: "Letter (8.5 × 11 in)" },
  a4: { width: 8.27, height: 11.69, label: "A4 (210 × 297 mm)" },
  legal: { width: 8.5, height: 14, label: "Legal (8.5 × 14 in)" },
  a5: { width: 5.83, height: 8.27, label: "A5 (148 × 210 mm)" },
};

export const DEFAULT_PAGE: PageSetup = {
  size: "letter",
  orientation: "portrait",
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
};

/** CSS pixels per inch. Browsers define 1in as 96px. */
export const PX_PER_INCH = 96;

/** The page setup to use for a document: its own, or the default. */
export function pageSetupOf(doc: { page?: PageSetup }): PageSetup {
  return doc.page ?? DEFAULT_PAGE;
}

/** Page width and height in inches, with orientation applied. */
export function pageDimensions(page: PageSetup): { width: number; height: number } {
  const { width, height } = PAGE_SIZES[page.size];
  return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}
