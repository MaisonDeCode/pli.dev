import type { Block, Columns, Doc, PageSetup, PageSize, RegionName, SectionBreakBlock } from "./model";
import { pageSetupOf } from "./page";

/** Space between columns when a section doesn't say, in points: half an inch. */
export const DEFAULT_COLUMN_GAP = 36;
export const MAX_COLUMNS = 4;

/** Columns with every value filled in. */
export interface ColumnSetup {
  count: number;
  gap: number;
  rule: boolean;
}

/** The columns as they will be laid out: a count of at least 1 and at most 4, a gap and whether there is a rule. */
export function columnSetup(columns: Columns | undefined): ColumnSetup {
  const count = Math.min(MAX_COLUMNS, Math.max(1, Math.round(columns?.count ?? 1)));
  return { count, gap: columns?.gap ?? DEFAULT_COLUMN_GAP, rule: !!columns?.rule };
}

/** One section: a run of blocks with the same columns, and the break that starts it (none for the first). */
export interface Section {
  /** Index in `doc.blocks` of the first block of the section (the one after its break). */
  from: number;
  /** Index after the last block of the section. The next break, if any, is here. */
  to: number;
  columns: ColumnSetup;
  /** The break that starts this section. The first section has none. */
  start?: SectionBreakBlock;
}

/** The document's sections, in order. A document with no section breaks has one. */
export function sectionsOf(doc: { blocks: readonly Block[]; page?: Pick<PageSetup, "columns"> }): Section[] {
  const sections: Section[] = [];
  let current: Section = { from: 0, to: doc.blocks.length, columns: columnSetup(doc.page?.columns) };
  doc.blocks.forEach((block, i) => {
    if (block.type !== "section_break") return;
    current.to = i;
    sections.push(current);
    current = { from: i + 1, to: doc.blocks.length, columns: columnSetup(block.columns), start: block };
  });
  sections.push(current);
  return sections;
}

/** The section a top-level block is in. A section break belongs to the section it starts. */
export function sectionAt(doc: { blocks: readonly Block[]; page?: Pick<PageSetup, "columns"> }, index: number): Section {
  const sections = sectionsOf(doc);
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    const start = s.start ? s.from - 1 : 0;
    if (index >= start) return s;
  }
  return sections[0]!;
}

/** The number of the section a top-level block is in (0 for the first). */
export function sectionIndexAt(doc: { blocks: readonly Block[]; page?: Pick<PageSetup, "columns"> }, index: number): number {
  const sections = sectionsOf(doc);
  for (let i = sections.length - 1; i >= 0; i--) {
    if (index >= (sections[i]!.start ? sections[i]!.from - 1 : 0)) return i;
  }
  return 0;
}

/** A run of consecutive blocks laid out in columns: blocks in a section with two or more columns, split at page breaks. */
export interface ColumnRun {
  columns: ColumnSetup;
  /** Index of the first block in `doc.blocks`. */
  from: number;
  /** Index after the last block. */
  to: number;
}

export function columnRuns(doc: { blocks: readonly Block[]; page?: Pick<PageSetup, "columns"> }): ColumnRun[] {
  const runs: ColumnRun[] = [];
  for (const section of sectionsOf(doc)) {
    if (section.columns.count < 2) continue;
    let from = section.from;
    for (let i = section.from; i <= section.to; i++) {
      const breaks = i === section.to || doc.blocks[i]!.type === "page_break";
      if (!breaks) continue;
      if (i > from) runs.push({ columns: section.columns, from, to: i });
      from = i + 1;
    }
  }
  return runs;
}

/** The columns a document has at a top-level block: what the section holds. */
export function columnsAt(doc: Pick<Doc, "blocks" | "page">, index: number): ColumnSetup {
  return sectionAt(doc, index).columns;
}

/** Columns as a model value, leaving out what is default: one column is no columns. */
export function columnsValue(setup: ColumnSetup): Columns | undefined {
  if (setup.count < 2) return undefined;
  return { count: setup.count, ...(setup.gap !== DEFAULT_COLUMN_GAP && { gap: setup.gap }), ...(setup.rule && { rule: true }) };
}

/** A header or footer as a section sees it: its blocks, and the section that holds them. */
export interface ResolvedRegion {
  /** The content, or undefined if there is none. An empty array is a blank header on purpose. */
  blocks: Block[] | undefined;
  /** The section that holds the content: this one, or the nearest one before it that has its own (section 0 is the document's). */
  owner: number;
}

/**
 * The header or footer a section shows. A section that doesn't have its own is "linked to previous": it
 * shows the one before it, back to the document's own for the first section.
 */
export function resolveRegion(doc: Pick<Doc, RegionName>, sections: readonly Section[], index: number, name: RegionName): ResolvedRegion {
  for (let i = Math.min(index, sections.length - 1); i > 0; i--) {
    const own = sections[i]!.start?.regions?.[name];
    if (own !== undefined) return { blocks: own, owner: i };
  }
  return { blocks: doc[name], owner: 0 };
}

/** Whether a section shows the previous section's header or footer instead of its own. The first section never does. */
export function isRegionLinked(sections: readonly Section[], index: number, name: RegionName): boolean {
  return index > 0 && sections[index]?.start?.regions?.[name] === undefined;
}

/** Whether a section gives its first page its own header and footer. */
export function hasFirstPageRegions(doc: Pick<Doc, "page">, sections: readonly Section[], index: number): boolean {
  return index === 0 ? !!doc.page?.differentFirstPage : !!sections[index]?.start?.differentFirstPage;
}

/** The shape of a section's pages. */
export interface SectionShape {
  size: PageSize;
  orientation: "portrait" | "landscape";
  margins: PageSetup["margins"];
}

/** A section's page size, orientation and margins: its own where it sets them, else the section before's, back to the document's. */
export function sectionShape(doc: Pick<Doc, "page">, sections: readonly Section[], index: number): SectionShape {
  const base = pageSetupOf(doc);
  let shape: SectionShape = { size: base.size, orientation: base.orientation, margins: base.margins };
  for (let i = 1; i <= Math.min(index, sections.length - 1); i++) {
    const own = sections[i]!.start?.page;
    if (own) shape = { size: own.size ?? shape.size, orientation: own.orientation ?? shape.orientation, margins: own.margins ?? shape.margins };
  }
  return shape;
}

export function sameShape(a: SectionShape, b: SectionShape): boolean {
  return (
    a.size === b.size &&
    a.orientation === b.orientation &&
    (["top", "right", "bottom", "left"] as const).every((side) => a.margins[side] === b.margins[side])
  );
}

/**
 * Whether a section begins on a new page. It does if its break says so, or if its pages are shaped differently from
 * the section before's, which can't share a page with it.
 */
export function startsOnNewPage(doc: Pick<Doc, "page">, sections: readonly Section[], index: number): boolean {
  if (index === 0) return false;
  return sections[index]!.start?.kind === "next_page" || !sameShape(sectionShape(doc, sections, index), sectionShape(doc, sections, index - 1));
}
