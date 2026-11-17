import type { Block, Doc, PageSetup, RegionName } from "./model";

export const REGION_NAMES: readonly RegionName[] = ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"];

/** Whether a region is a header or a footer. */
export function regionKind(name: RegionName): "header" | "footer" {
  return name.startsWith("header") ? "header" : "footer";
}

/** Which variant of a header or footer a page shows. */
export type RegionVariant = "default" | "first" | "even";

export function regionVariant(name: RegionName): RegionVariant {
  return name.endsWith("First") ? "first" : name.endsWith("Even") ? "even" : "default";
}

export function regionName(kind: "header" | "footer", variant: RegionVariant): RegionName {
  return variant === "first" ? `${kind}First` : variant === "even" ? `${kind}Even` : kind;
}

/**
 * The header or footer a page shows. The first page uses the first-page one when the page setup asks
 * for it; with different odd and even pages, even pages use theirs and the rest use the default. Pages
 * are numbered from 1.
 */
export function regionKeyFor(
  page: Pick<PageSetup, "differentFirstPage" | "differentOddEven"> | undefined,
  kind: "header" | "footer",
  pageNumber: number,
  /** Whether this is the first page of its section. Defaults to page 1, for a document with one section. */
  firstOfSection: boolean = pageNumber === 1,
): RegionName {
  if (page?.differentFirstPage && firstOfSection) return regionName(kind, "first");
  if (page?.differentOddEven && pageNumber % 2 === 0) return regionName(kind, "even");
  return regionName(kind, "default");
}

/** The content a page's header or footer has, or undefined if it has none. */
export function regionBlocksFor(doc: Pick<Doc, "page" | RegionName>, kind: "header" | "footer", pageNumber: number): Block[] | undefined {
  return doc[regionKeyFor(doc.page, kind, pageNumber)];
}

/** The regions a page setup uses, in the order the default, first-page and even-page ones come. The rest are kept but unused. */
export function activeRegionNames(page: Pick<PageSetup, "differentFirstPage" | "differentOddEven"> | undefined, kind: "header" | "footer"): RegionName[] {
  return [
    regionName(kind, "default"),
    ...(page?.differentFirstPage ? [regionName(kind, "first")] : []),
    ...(page?.differentOddEven ? [regionName(kind, "even")] : []),
  ];
}

/** A name for a region to show people, such as "First page header". */
export function regionLabel(name: RegionName): string {
  const kind = regionKind(name) === "header" ? "header" : "footer";
  const variant = regionVariant(name);
  if (variant === "first") return `First page ${kind}`;
  if (variant === "even") return `Even page ${kind}`;
  return kind[0]!.toUpperCase() + kind.slice(1);
}
