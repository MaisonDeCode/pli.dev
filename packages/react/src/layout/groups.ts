import type { TableBlock } from "@pli.dev/docs";

/**
 * Rows that a merged cell spans can't be separated by a page break, because the cell would be cut
 * in two. This groups a table's rows so that every group can start a new page: a group begins at a
 * row that no cell above it reaches into.
 */
export function rowGroups(table: TableBlock): { first: number; last: number }[] {
  const groups: { first: number; last: number }[] = [];
  let reach = -1;
  table.rows.forEach((row, r) => {
    if (r > reach) groups.push({ first: r, last: r });
    else groups[groups.length - 1]!.last = r;
    for (const cell of row.cells) {
      if (!cell.covered) reach = Math.max(reach, r + (cell.rowSpan ?? 1) - 1);
    }
  });
  return groups;
}
