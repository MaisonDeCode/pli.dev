import { isTextBlock, type Block, type Doc, type DocStyle, type TableBlock } from "./model";
import { stylesUsed } from "./styles";
import { normalizeColumns } from "./grid";
import { plainText, sliceRuns } from "./runs";
import { cellRect, coveredBlocks, isCollapsed, type CellRect, type Selection } from "./selection";
import { collectIds } from "./tree";
import { FOOTNOTE_CHAR, footnoteIds } from "./footnotes";

/** The cells of a selected rectangle as a table of their own. Merged cells are whole: the rectangle already takes them in. */
function subTable(rect: CellRect): TableBlock {
  const { table, row1, row2, col1, col2 } = rect;
  const { headerRow: _header, ...rest } = table;
  return {
    ...rest,
    rows: table.rows.slice(row1, row2 + 1).map((row) => ({ ...row, cells: row.cells.slice(col1, col2 + 1) })),
    columns: normalizeColumns(table.columns.slice(col1, col2 + 1)),
    ...(row1 === 0 && table.headerRow && { headerRow: true }),
  };
}

/**
 * The part of a document covered by the selection, as a document of its own. Dragging across table
 * cells gives a table of just those cells; a range that takes in a whole table keeps it as a table.
 * A range that only touches part of a table gives that text as ordinary blocks.
 */
export function sliceSelection(doc: Doc, selection: Selection): Doc {
  const slice = sliceBlocks(doc, selection);
  // The copy carries the notes its references point at, and no others.
  const { footnotes: _all, ...rest } = slice;
  const notes = Object.fromEntries(footnoteIds(slice.blocks).flatMap((id) => (doc.footnotes?.[id] ? [[id, doc.footnotes[id]!]] : [])));
  // And the styles the text uses, with the ones they are based on, so a paste into another document looks the same.
  const styles: Record<string, DocStyle> = {};
  const take = (id: string | undefined) => {
    for (let at = id; at !== undefined && doc.styles?.[at] && !styles[at]; at = doc.styles[at]!.basedOn) styles[at] = doc.styles[at]!;
  };
  for (const id of stylesUsed(slice.blocks)) take(id);
  return { ...rest, ...(Object.keys(notes).length > 0 && { footnotes: notes }), ...(Object.keys(styles).length > 0 && { styles }) };
}

function sliceBlocks(doc: Doc, selection: Selection): Doc {
  if (isCollapsed(selection)) return { ...doc, blocks: [] };
  const rect = cellRect(doc, selection);
  if (rect) return { ...doc, blocks: [subTable(rect)] };

  const covered = coveredBlocks(doc, selection);
  const present = new Set(covered.map((c) => c.block.id));
  const inside = new Set<string>();
  const blocks: Block[] = [];
  for (const { block, from, to } of covered) {
    if (inside.has(block.id)) continue;
    if (block.type === "table") {
      const ids = collectIds([block]);
      ids.delete(block.id);
      const cellBlockIds = [...ids].filter((id) => !block.rows.some((r) => r.id === id || r.cells.some((c) => c.id === id)));
      if (cellBlockIds.every((id) => present.has(id))) {
        blocks.push(block);
        for (const id of cellBlockIds) inside.add(id);
      }
      continue;
    }
    blocks.push(isTextBlock(block) ? { ...block, runs: sliceRuns(block.runs, from, to) } : block);
  }
  return { ...doc, blocks };
}

/** A cell's text the way a spreadsheet copies it: quoted when it holds a tab, a line break or a quote. */
function field(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tableToTabSeparated(table: TableBlock): string {
  return table.rows
    .map((row) =>
      row.cells
        .map((cell) => (cell.covered ? "" : field(cell.blocks.map((b) => (isTextBlock(b) ? plainText(b.runs) : "")).join("\n"))))
        .join("\t"),
    )
    .join("\n");
}

/**
 * The selected text as plain text, one line per block. Tables, and rectangles of cells, come out as
 * tab-separated rows, which pastes into a spreadsheet.
 */
export function selectionToPlainText(doc: Doc, selection: Selection): string {
  return sliceSelection(doc, selection)
    .blocks.map((b) => (b.type === "table" ? tableToTabSeparated(b) : isTextBlock(b) ? plainText(b.runs).replaceAll(FOOTNOTE_CHAR, "") : ""))
    .join("\n");
}
