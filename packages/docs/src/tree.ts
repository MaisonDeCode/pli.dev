import type { Block, CellBlock, Doc, TableBlock, TableCell } from "./model";

/**
 * Blocks live in a tree: the document's blocks, and inside each table, the blocks of its cells.
 * Everything that finds a block by id goes through here, so tables work like the rest of the engine.
 */

/** Where a block lives. */
export interface Located {
  block: Block;
  /** The list of siblings that contains the block (the document's blocks, or one cell's blocks). */
  list: readonly Block[];
  index: number;
  /** Index in the document's top-level blocks of the block, or of the table that contains it. */
  topIndex: number;
  /** Set when the block is inside a table cell. */
  cell: { table: TableBlock; row: number; col: number; cell: TableCell } | null;
}

type Blocks = readonly Block[];

/** Every block in reading order, with a table's cell blocks following the table itself. */
export function flattenBlocks(blocks: Blocks): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    out.push(block);
    if (block.type === "table") {
      for (const row of block.rows) for (const cell of row.cells) out.push(...cell.blocks);
    }
  }
  return out;
}

export function locate(doc: { blocks: Blocks }, id: string): Located | null {
  for (let topIndex = 0; topIndex < doc.blocks.length; topIndex++) {
    const block = doc.blocks[topIndex]!;
    if (block.id === id) return { block, list: doc.blocks, index: topIndex, topIndex, cell: null };
    if (block.type === "table") {
      for (let row = 0; row < block.rows.length; row++) {
        const cells = block.rows[row]!.cells;
        for (let col = 0; col < cells.length; col++) {
          const cell = cells[col]!;
          const index = cell.blocks.findIndex((b) => b.id === id);
          if (index >= 0) return { block: cell.blocks[index]!, list: cell.blocks, index, topIndex, cell: { table: block, row, col, cell } };
        }
      }
    }
  }
  return null;
}

/** The table cell with this id, wherever it is. */
export function locateCell(doc: { blocks: Blocks }, cellId: string): { table: TableBlock; row: number; col: number; cell: TableCell; topIndex: number } | null {
  for (let topIndex = 0; topIndex < doc.blocks.length; topIndex++) {
    const block = doc.blocks[topIndex]!;
    if (block.type !== "table") continue;
    for (let row = 0; row < block.rows.length; row++) {
      const col = block.rows[row]!.cells.findIndex((c) => c.id === cellId);
      if (col >= 0) return { table: block, row, col, cell: block.rows[row]!.cells[col]!, topIndex };
    }
  }
  return null;
}

/** Replaces the list of siblings that contains `id`. `change` receives the list and the block's index. */
export function updateList(
  blocks: Blocks,
  id: string,
  change: (list: Block[], index: number) => Block[],
): Block[] | null {
  const top = blocks.findIndex((b) => b.id === id);
  if (top >= 0) return change(blocks.slice(), top);

  for (let t = 0; t < blocks.length; t++) {
    const table = blocks[t]!;
    if (table.type !== "table") continue;
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!;
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c]!;
        const index = cell.blocks.findIndex((b) => b.id === id);
        if (index < 0) continue;
        const next = change(cell.blocks.slice(), index) as CellBlock[];
        const rows = table.rows.slice();
        const cells = row.cells.slice();
        cells[c] = { ...cell, blocks: next };
        rows[r] = { ...row, cells };
        const out = blocks.slice();
        out[t] = { ...table, rows };
        return out;
      }
    }
  }
  return null;
}

/** Replaces the blocks of one cell. */
export function updateCell(blocks: Blocks, cellId: string, change: (list: Block[]) => Block[]): Block[] | null {
  for (let t = 0; t < blocks.length; t++) {
    const table = blocks[t]!;
    if (table.type !== "table") continue;
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!;
      const c = row.cells.findIndex((x) => x.id === cellId);
      if (c < 0) continue;
      const rows = table.rows.slice();
      const cells = row.cells.slice();
      cells[c] = { ...row.cells[c]!, blocks: change(row.cells[c]!.blocks.slice()) as CellBlock[] };
      rows[r] = { ...row, cells };
      const out = blocks.slice();
      out[t] = { ...table, rows };
      return out;
    }
  }
  return null;
}

/** All ids used in a subtree: blocks, and the rows and cells of tables. For uniqueness checks. */
export function collectIds(blocks: Blocks, into: Set<string> = new Set()): Set<string> {
  for (const block of blocks) {
    into.add(block.id);
    if (block.type === "table") {
      for (const row of block.rows) {
        into.add(row.id);
        for (const cell of row.cells) {
          into.add(cell.id);
          collectIds(cell.blocks, into);
        }
      }
    }
  }
  return into;
}

/** The table that contains a block, or null. */
export function tableOf(doc: { blocks: Blocks }, id: string): Located["cell"] {
  return locate(doc, id)?.cell ?? null;
}

export type DocLike = Pick<Doc, "blocks">;
