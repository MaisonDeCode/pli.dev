/**
 * Whether the workbook is being worked on as a shared one (a server's copy, or a session that syncs). There, a change that
 * another person's change makes impossible (a slicer on a column that was deleted at the same moment, two tables that now
 * overlap, a rule with no cell left to cover) is not refused or removed: it stays as it is, covering nothing, so that every copy
 * of the workbook is the same and every position in every list means the same to everyone. Readers leave such leftovers out and
 * saving drops them (`withoutGhosts`).
 */
let depth = 0;

export const sharing = (): boolean => depth > 0;

export function whileSharing<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}
