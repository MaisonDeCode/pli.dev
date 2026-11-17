import { PliError } from "@pli.dev/core";

/*
 * Many rows put in (or taken out) at once. A "run" is `[at, count]`: `count` rows at row `at` of the sheet as it is now.
 * All the runs of one operation are in the coordinates of the sheet before it, so the operation shifts everything once,
 * however many places rows go in (a subtotal for each of ten thousand groups is one operation, not ten thousand).
 */
export type Run = readonly [at: number, count: number];

/** Sorted, with runs that touch merged (deletes) or that share a place added together (inserts); checked against the sheet's size. */
export function normalizeRuns(kind: "insert" | "delete", runs: readonly Run[], max: number): Run[] {
  const sorted = runs.map((r): [number, number] => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [at, count] of sorted) {
    if (!Number.isInteger(at) || !Number.isInteger(count) || at < 1 || count < 1 || at > max) {
      throw new PliError("out_of_range", `Can't ${kind} ${count} rows at ${at}`);
    }
    const last = out[out.length - 1];
    if (last && kind === "insert" && last[0] === at) last[1] += count;
    else if (last && kind === "delete" && at <= last[0] + last[1]) last[1] = Math.max(last[1], at + count - last[0]);
    else out.push([at, count]);
  }
  if (kind === "delete" && out.length && out[out.length - 1]![0] + out[out.length - 1]![1] - 1 > max) throw new PliError("out_of_range", "Can't delete rows past the end of the sheet");
  return out;
}

export interface RunMap {
  readonly kind: "insert" | "delete";
  readonly runs: readonly Run[];
  /** Where an original row ends up; null if it is deleted. */
  move(n: number): number | null;
  /** Where the start of a span at `n` ends up (for a deleted row: the first one after the gap). */
  lo(n: number): number;
  /** Where the end of a span at `n` ends up (for a deleted row: the last one before the gap). */
  hi(n: number): number;
  /** The place of the gap that a deleted row (or one pushed aside) leaves, in the new coordinates. */
  gap(n: number): number;
  gone(n: number): boolean;
  /** How many rows go in (or out) in all. */
  readonly total: number;
  /** The places the new rows end up at, in the new sheet: `[first, count]` for each run. */
  placed(): [number, number][];
}

const cache = new WeakMap<readonly Run[], Map<string, RunMap>>();

export function runMap(kind: "insert" | "delete", runs: readonly Run[]): RunMap {
  const hit = cache.get(runs)?.get(kind);
  if (hit) return hit;
  const ats = runs.map((r) => r[0]);
  const prefix: number[] = [0];
  for (const r of runs) prefix.push(prefix[prefix.length - 1]! + r[1]);
  /** The index of the last run whose `at` is at most `n`, or -1. */
  const lastAtMost = (n: number): number => {
    let lo = 0;
    let hi = ats.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ats[mid]! <= n) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  /** How many deleted rows are before row `n` (not counting `n`). */
  const deletedBefore = (n: number): number => {
    const i = lastAtMost(n - 1);
    if (i < 0) return 0;
    return prefix[i]! + Math.min(runs[i]![1], n - runs[i]![0]);
  };
  const total = prefix[prefix.length - 1]!;
  const gone = (n: number): boolean => {
    if (kind === "insert") return false;
    const i = lastAtMost(n);
    return i >= 0 && n <= runs[i]![0] + runs[i]![1] - 1;
  };
  const shift = (n: number) => n + prefix[lastAtMost(n) + 1]!;
  const map: RunMap =
    kind === "insert"
      ? { kind, runs, move: shift, lo: shift, hi: shift, gap: shift, gone, total, placed: () => runs.map((r, i) => [r[0] + prefix[i]!, r[1]] as [number, number]) }
      : {
          kind,
          runs,
          move: (n) => (gone(n) ? null : n - deletedBefore(n)),
          lo: (n) => n - deletedBefore(n),
          hi: (n) => n - deletedBefore(n + 1),
          gap: (n) => n - deletedBefore(n),
          gone,
          total,
          placed: () => [],
        };
  let byKind = cache.get(runs);
  if (!byKind) cache.set(runs, (byKind = new Map()));
  byKind.set(kind, map);
  return map;
}
