import {
  isFormattable,
  isTextBlock,
  type Align,
  type Doc,
  type ImageBlock,
  type ListMarker,
  type Marks,
  type ParagraphFormat,
  type TableBlock,
  type TextBlock,
} from "./model";
import { marksAtCaret, segmentsOf, indent, outdent, type BlockSpec } from "./commands";
import { rangeHasMark, sliceRuns } from "./runs";
import { colSpanOf, originsIn, rectOfCell, rowSpanOf } from "./grid";
import { cellRect, isCollapsed, selectedBlocks, type Selection } from "./selection";
import { locate } from "./tree";
import { listNumbers, markerOf } from "./lists";
import { withParagraphStyle } from "./styles";
import { columnSetup, columnsAt, sectionIndexAt, type ColumnSetup } from "./sections";

export type MarkKey = "bold" | "italic" | "underline" | "strike" | "code" | "superscript" | "subscript";
const MARK_KEYS: MarkKey[] = ["bold", "italic", "underline", "strike", "code", "superscript", "subscript"];

/** A value that may differ across the selection. */
export interface MarkValue<T> {
  /** The value of the first selected character, or undefined if it has none. */
  value: T | undefined;
  /** True when selected characters have different values. */
  mixed: boolean;
}

/** What a toolbar needs to know about the current selection. */
export interface SelectionState {
  marks: Record<MarkKey, boolean>;
  fontFamily: MarkValue<string>;
  /** In points. */
  fontSize: MarkValue<number>;
  color: MarkValue<string>;
  highlight: MarkValue<string>;
  link: MarkValue<string>;
  /** The block type of every selected block, or null if they differ. */
  block: BlockSpec | null;
  /** The alignment of every selected block that has one, or null if they differ. */
  align: Align | null;
  /** The paragraph style of every selected paragraph, or null if they differ or have none. */
  paragraphStyle: string | null;
  /** The character style of the text at the caret or across the selection. */
  characterStyle: MarkValue<string>;
  /** Paragraph spacing of the first selected paragraph-like block. */
  format: ParagraphFormat;
  /** The list item the caret is in, if any. */
  list: ListState | null;
  /** The image the caret is on, if any. */
  image: ImageBlock | null;
  /** The table the caret is in, if any. */
  table: TableState | null;
  canIndent: boolean;
  canOutdent: boolean;
  /** The columns of the section the caret is in. */
  columns: ColumnSetup;
  /** The number of the section the caret is in. 0 is the first. */
  section: number;
}

/** What a toolbar needs to know about the list item the caret is in. */
export interface ListState {
  kind: "bullet" | "ordered";
  /** The marker style the item shows, by default or by choice. */
  marker: ListMarker;
  /** The number the item has, for a numbered list. */
  number: number | null;
  /** True when the item says where numbering starts, rather than carrying on from the item above. */
  restarts: boolean;
}

/** What a toolbar needs to know about the table the selection is in. */
export interface TableState {
  id: string;
  rows: number;
  columns: number;
  /** The cell the caret is in, or the first cell of a selected rectangle. Null when the table itself is selected. */
  row: number | null;
  column: number | null;
  /** The number of rows and columns a rectangular selection covers. 1 by 1 for a caret. */
  selectedRows: number;
  selectedColumns: number;
  headerRow: boolean;
  borders: "all" | "horizontal" | "none";
  /** Background of the current cell. */
  shade: string | undefined;
  /** Vertical alignment of the current cell. */
  vAlign: "top" | "middle" | "bottom";
  /** Minimum height of the current row, in points, if it has one. */
  rowHeight: number | undefined;
  /** True when a drag covers two or more cells, so they can be merged. */
  canMerge: boolean;
  /** True when the selection includes a merged cell, so it can be split. */
  canSplit: boolean;
}

function tableStateOf(doc: Doc, selection: Selection): TableState | null {
  const rect = cellRect(doc, selection);
  const located = locate(doc, selection.focus.block);
  if (!located) return null;
  const whole = !rect && located.block.type === "table";
  const cellInfo = located.cell;
  const table = whole ? (located.block as TableBlock) : cellInfo?.table;
  if (!table) return null;

  const covered = whole
    ? { row1: 0, row2: table.rows.length - 1, col1: 0, col2: table.columns.length - 1 }
    : rect ?? rectOfCell(cellInfo!.cell, cellInfo!.row, cellInfo!.col);
  const row = whole ? null : rect ? rect.row1 : cellInfo!.row;
  const col = whole ? null : rect ? rect.col1 : cellInfo!.col;
  const current = row === null || col === null ? undefined : table.rows[row]?.cells[col];
  return {
    id: table.id,
    rows: table.rows.length,
    columns: table.columns.length,
    row,
    column: col,
    selectedRows: whole ? table.rows.length : covered.row2 - covered.row1 + 1,
    selectedColumns: whole ? table.columns.length : covered.col2 - covered.col1 + 1,
    headerRow: !!table.headerRow,
    borders: table.borders ?? "all",
    shade: current?.shade,
    vAlign: current?.vAlign ?? "top",
    rowHeight: row === null ? undefined : table.rows[row]?.height,
    canMerge: !!rect,
    canSplit: originsIn(table, covered).some(({ cell }) => rowSpanOf(cell) > 1 || colSpanOf(cell) > 1),
  };
}

function listStateOf(doc: Doc, selection: Selection): ListState | null {
  const located = locate(doc, selection.focus.block);
  const item = located?.block;
  if (!located || !item || item.type !== "list_item") return null;
  const number = listNumbers(located.list)[located.index];
  return { kind: item.list, marker: markerOf(item), number: number ?? null, restarts: item.start !== undefined };
}

function specOf(block: TextBlock): BlockSpec {
  switch (block.type) {
    case "heading":
      return { type: "heading", level: block.level };
    case "list_item":
      return { type: "list_item", list: block.list };
    case "code_block":
      return { type: "code_block" };
    default:
      return { type: block.type };
  }
}

function sameSpec(a: BlockSpec, b: BlockSpec): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "heading" && b.type === "heading") return a.level === b.level;
  if (a.type === "list_item" && b.type === "list_item") return a.list === b.list;
  return true;
}

function caretMarks(doc: Doc, selection: Selection, pending: Marks | null): Marks | undefined {
  if (pending) return pending;
  const block = locate(doc, selection.focus.block)?.block;
  return block && isTextBlock(block) ? marksAtCaret(block, selection.focus.offset) : undefined;
}

/**
 * Which boolean marks are active. For a caret that is the formatting new text would get
 * (`pending` if the user just toggled one); for a range, a mark is active only if all the
 * selected text has it.
 */
export function activeMarks(doc: Doc, selection: Selection, pending: Marks | null = null): Record<MarkKey, boolean> {
  const result = Object.fromEntries(MARK_KEYS.map((k) => [k, false])) as Record<MarkKey, boolean>;
  if (isCollapsed(selection)) {
    const marks = caretMarks(doc, selection, pending);
    for (const key of MARK_KEYS) result[key] = marks?.[key] === true;
    return result;
  }
  const segments = segmentsOf(doc, selection);
  if (segments.length === 0) return result;
  for (const key of MARK_KEYS) {
    result[key] = segments.every((s) => rangeHasMark(s.block.runs, s.from, s.to, key));
  }
  return result;
}

/** The value of a non-boolean mark (font, size, color, link…) across the selection. */
export function markValue<K extends "fontFamily" | "fontSize" | "color" | "highlight" | "link" | "style">(
  doc: Doc,
  selection: Selection,
  key: K,
  pending: Marks | null = null,
): MarkValue<NonNullable<Marks[K]>> {
  type V = NonNullable<Marks[K]>;
  if (isCollapsed(selection)) {
    return { value: caretMarks(doc, selection, pending)?.[key] as V | undefined, mixed: false };
  }
  const seen = new Set<V | undefined>();
  let first: V | undefined;
  let any = false;
  for (const segment of segmentsOf(doc, selection)) {
    for (const run of sliceRuns(segment.block.runs, segment.from, segment.to)) {
      const value = run.marks?.[key] as V | undefined;
      if (!any) first = value;
      any = true;
      seen.add(value);
    }
  }
  return { value: first, mixed: seen.size > 1 };
}

export function activeBlockSpec(doc: Doc, selection: Selection): BlockSpec | null {
  const blocks = selectedBlocks(doc, selection).filter(isTextBlock);
  const first = blocks[0];
  if (!first) return null;
  const spec = specOf(first);
  return blocks.every((b) => sameSpec(specOf(b), spec)) ? spec : null;
}

/** The paragraph style that every selected paragraph has, or null when they differ or have none. */
export function activeParagraphStyle(doc: Doc, selection: Selection): string | null {
  const blocks = selectedBlocks(doc, selection).filter(isFormattable);
  if (blocks.length === 0) return null;
  const first = blocks[0]!.style ?? null;
  return blocks.every((b) => (b.style ?? null) === first) ? first : null;
}

export function activeAlign(doc: Doc, selection: Selection): Align | null {
  const blocks = selectedBlocks(doc, selection).filter((b) => isFormattable(b) || b.type === "image");
  if (blocks.length === 0) return null;
  const aligns = new Set(blocks.map((b) => ("align" in b && withParagraphStyle(doc, b).align) || "left"));
  return aligns.size === 1 ? [...aligns][0]! : null;
}

export function selectionState(doc: Doc, selection: Selection | null, pending: Marks | null = null): SelectionState {
  if (!selection) {
    const none = { value: undefined, mixed: false };
    return {
      marks: Object.fromEntries(MARK_KEYS.map((k) => [k, false])) as Record<MarkKey, boolean>,
      fontFamily: none,
      fontSize: none,
      color: none,
      highlight: none,
      link: none,
      block: null,
      align: null,
      paragraphStyle: null,
      characterStyle: none,
      format: {},
      list: null,
      image: null,
      table: null,
      canIndent: false,
      canOutdent: false,
      columns: columnSetup(doc.page?.columns),
      section: 0,
    };
  }
  const blocks = selectedBlocks(doc, selection);
  const formattable = blocks.find(isFormattable);
  const focus = locate(doc, selection.focus.block)?.block;
  return {
    marks: activeMarks(doc, selection, pending),
    fontFamily: markValue(doc, selection, "fontFamily", pending),
    fontSize: markValue(doc, selection, "fontSize", pending),
    color: markValue(doc, selection, "color", pending),
    highlight: markValue(doc, selection, "highlight", pending),
    link: markValue(doc, selection, "link", pending),
    block: activeBlockSpec(doc, selection),
    align: activeAlign(doc, selection),
    paragraphStyle: activeParagraphStyle(doc, selection),
    characterStyle: markValue(doc, selection, "style", pending),
    format: formattable ? withParagraphStyle(doc, formattable).format ?? {} : {},
    list: listStateOf(doc, selection),
    image: isCollapsed(selection) && focus?.type === "image" ? focus : null,
    table: tableStateOf(doc, selection),
    canIndent: indent()(doc, selection) !== null,
    canOutdent: outdent()(doc, selection) !== null,
    columns: focus ? columnsAt(doc, locate(doc, focus.id)!.topIndex) : columnSetup(doc.page?.columns),
    section: focus ? sectionIndexAt(doc, locate(doc, focus.id)!.topIndex) : 0,
  };
}
