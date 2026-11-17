/**
 * Merging changes to an ordered list (the slides of a deck, the elements of a slide, the layouts of a master).
 *
 * Three changes exist: put an item at a position (`ins`), take one out (`del`), move one (`mov`: take it out, then put
 * it back at a position of the list without it). Positions are indexes, in the list as it was when the change was made.
 * `transformListOp(later, earlier)` rewrites two changes made from the same list so that each applies after the other
 * and both orders give the same list. Where two changes want the same place, the earlier one goes first; two people
 * moving the same item, the later one wins. (The same algorithm as Pli.Decks' lists; copied so Sheets does not depend on Decks.)
 */
export type ListOp = { k: "ins"; i: number; x: string } | { k: "del"; i: number; x: string } | { k: "mov"; i: number; j: number; x: string };

const ins = (i: number, x: string): ListOp => ({ k: "ins", i, x });
const del = (i: number, x: string): ListOp => ({ k: "del", i, x });
const mov = (i: number, j: number, x: string): ListOp => ({ k: "mov", i, j, x });

/** Applies a list change to a list of ids. */
export function applyListOp(list: readonly string[], op: ListOp): string[] {
  const out = [...list];
  if (op.k === "ins") out.splice(op.i, 0, op.x);
  else if (op.k === "del") out.splice(op.i, 1);
  else {
    out.splice(op.i, 1);
    out.splice(op.j, 0, op.x);
  }
  return out;
}

/**
 * Transforms `l` (made later) and `e` (accepted earlier), both made from the same list, into `l'` and `e'` so that `e`
 * then `l'` and `l` then `e'` give the same list. An empty array means nothing is left to do.
 */
export function transformListOp(l: ListOp, e: ListOp): [ListOp[], ListOp[]] {
  if (l.k === "ins") {
    const s = l.i;
    if (e.k === "ins") return [[ins(e.i <= s ? s + 1 : s, l.x)], [ins(s < e.i ? e.i + 1 : e.i, e.x)]];
    if (e.k === "del") return [[ins(s > e.i ? s - 1 : s, l.x)], [del(s <= e.i ? e.i + 1 : e.i, e.x)]];
    const sr = s > e.i ? s - 1 : s;
    return [[ins(sr >= e.j ? sr + 1 : sr, l.x)], [mov(s <= e.i ? e.i + 1 : e.i, sr < e.j ? e.j + 1 : e.j, e.x)]];
  }
  if (l.k === "del") {
    const i = l.i;
    if (e.k === "ins") return [[del(e.i <= i ? i + 1 : i, l.x)], [ins(i < e.i ? e.i - 1 : e.i, e.x)]];
    if (e.k === "del") {
      if (e.x === l.x) return [[], []];
      return [[del(i > e.i ? i - 1 : i, l.x)], [del(e.i > i ? e.i - 1 : e.i, e.x)]];
    }
    if (e.x === l.x) return [[del(e.j, l.x)], []];
    const ir = i > e.i ? i - 1 : i;
    return [[del(ir >= e.j ? ir + 1 : ir, l.x)], [mov(i < e.i ? e.i - 1 : e.i, ir < e.j ? e.j - 1 : e.j, e.x)]];
  }
  // l is a move
  const { i, j } = l;
  if (e.k === "ins") {
    const tr = e.i > i ? e.i - 1 : e.i;
    return [[mov(e.i <= i ? i + 1 : i, tr <= j ? j + 1 : j, l.x)], [ins(j < tr ? tr + 1 : tr, e.x)]];
  }
  if (e.k === "del") {
    if (e.x === l.x) return [[], [del(j, l.x)]];
    const tr = e.i > i ? e.i - 1 : e.i;
    return [[mov(e.i < i ? i - 1 : i, j > tr ? j - 1 : j, l.x)], [del(j <= tr ? tr + 1 : tr, e.x)]];
  }
  if (e.x === l.x) return [[mov(e.j, j, l.x)], []];
  const a = e.i;
  const b = e.j;
  const i1 = i > a ? i - 1 : i;
  const ayy = a > i ? a - 1 : a;
  const jz = j > ayy ? j - 1 : j;
  const bz = b > i1 ? b - 1 : b;
  return [[mov(i1 >= b ? i1 + 1 : i1, jz >= bz ? jz + 1 : jz, l.x)], [mov(ayy >= j ? ayy + 1 : ayy, bz > jz ? bz + 1 : bz, e.x)]];
}
