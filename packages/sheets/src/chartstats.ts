import type { ChartBins, ChartBox, ChartSplit } from "./model";

/*
 * The arithmetic behind the statistical chart kinds (histogram, box and whisker, waterfall, Pareto, pie-of-pie, treemap
 * and sunburst), apart from drawing, so it can be tested on its own and drawn by any renderer.
 */

const numbers = (v: readonly (number | null | undefined)[]): number[] => v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

// ---------------------------------------------------------------- histogram

export interface Bin {
  /** The limits of the bin; the first of an underflow bin and the last of an overflow bin are infinite. */
  from: number;
  to: number;
  count: number;
  /** `[1, 3]`, `(3, 5]`, `≤ 10`, `> 50`. */
  label: string;
  /** Whether `from` and `to` belong to the bin. */
  fromClosed: boolean;
  toClosed: boolean;
}

const sampleSd = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

const short = (n: number): string => String(Number(n.toPrecision(6)));

/**
 * Excel's automatic bin width (Scott's normal reference rule): 3.5 standard deviations over the cube root of the count.
 * `null` when every value is the same.
 */
export function automaticBinWidth(values: readonly number[]): number | null {
  const sd = sampleSd(values);
  if (!sd) return null;
  return (3.5 * sd) / Math.cbrt(values.length);
}

/**
 * Cuts `values` into bins as Excel's histogram does. The bins start at the smallest value (or just above `underflow`) and
 * are as wide as asked (or as the automatic width, or the range over `count`); the last bin reaches the largest value
 * (or `overflow`). By default a bin includes its right limit, except the first, which includes both.
 */
export function histogramBins(valuesIn: readonly (number | null | undefined)[], opts: ChartBins = {}): Bin[] {
  const values = numbers(valuesIn);
  if (!values.length) return [];
  const right = opts.closed !== "left";
  const under = opts.underflow !== undefined;
  const over = opts.overflow !== undefined;
  const origin = under ? opts.underflow! : Math.min(...values);
  const end = over ? opts.overflow! : Math.max(...values);
  const by = opts.by ?? "auto";
  const span = Math.max(0, end - origin);
  let width: number;
  let count: number;
  if (by === "count" && opts.size && opts.size >= 1) {
    // Excel counts the overflow and underflow bins among the bins asked for.
    count = Math.max(1, Math.floor(opts.size) - (under ? 1 : 0) - (over ? 1 : 0));
    width = span > 0 ? span / count : 1;
  } else {
    width = by === "width" && opts.size && opts.size > 0 ? opts.size : automaticBinWidth(values.filter((v) => (!under || v > origin) && (!over || v <= end))) ?? (span > 0 ? span : 1);
    count = Math.max(1, Math.ceil(span / width - 1e-9));
  }
  const bins: Bin[] = [];
  if (under) bins.push({ from: -Infinity, to: origin, count: 0, label: `≤ ${short(origin)}`, fromClosed: false, toClosed: true });
  for (let i = 0; i < count; i++) {
    const from = origin + i * width;
    const to = i === count - 1 && over ? end : origin + (i + 1) * width;
    const fromClosed = right ? i === 0 && !under : true;
    const toClosed = right ? true : i === count - 1 && !over;
    bins.push({ from, to, count: 0, label: `${fromClosed ? "[" : "("}${short(from)}, ${short(to)}${toClosed ? "]" : ")"}`, fromClosed, toClosed });
  }
  if (over) bins.push({ from: end, to: Infinity, count: 0, label: `> ${short(end)}`, fromClosed: false, toClosed: false });
  for (const v of values) {
    for (const b of bins) {
      if ((b.fromClosed ? v >= b.from : v > b.from) && (b.toClosed ? v <= b.to : v < b.to)) {
        b.count++;
        break;
      }
    }
  }
  return bins;
}

// ---------------------------------------------------------------- box and whisker

export interface BoxStats {
  n: number;
  mean: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** The ends of the whiskers: the extreme values within 1.5 times the interquartile range of the box. */
  low: number;
  high: number;
  outliers: number[];
}

/** The p-th quantile of sorted values: `inclusive` is QUARTILE.INC's rank (n−1)p+1, `exclusive` is QUARTILE.EXC's (n+1)p. */
export function quantile(sorted: readonly number[], p: number, method: "inclusive" | "exclusive"): number {
  const n = sorted.length;
  if (!n) return NaN;
  const rank = method === "inclusive" ? (n - 1) * p + 1 : (n + 1) * p;
  const clamped = Math.min(n, Math.max(1, rank));
  const i = Math.floor(clamped);
  const f = clamped - i;
  const a = sorted[i - 1]!;
  const b = sorted[Math.min(n, i + 1) - 1]!;
  return a + f * (b - a);
}

export function boxStats(valuesIn: readonly (number | null | undefined)[], method: ChartBox["quartile"] = "exclusive"): BoxStats | null {
  const sorted = numbers(valuesIn).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = (p: number) => quantile(sorted, p, method);
  const q1 = q(0.25);
  const q3 = q(0.75);
  const fence = 1.5 * (q3 - q1);
  const inside = sorted.filter((v) => v >= q1 - fence && v <= q3 + fence);
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    min: sorted[0]!,
    q1,
    median: q(0.5),
    q3,
    max: sorted[sorted.length - 1]!,
    low: inside[0] ?? q1,
    high: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < q1 - fence || v > q3 + fence),
  };
}

/** Groups the values by their category label (in order of first appearance), as a box-and-whisker chart does; without labels everything is one group. */
export function groupByCategory(values: readonly (number | null)[], categories: readonly string[] | null): { name: string; values: number[] }[] {
  if (!categories) return [{ name: "", values: numbers(values) }];
  const groups = new Map<string, number[]>();
  values.forEach((v, i) => {
    const key = categories[i] ?? "";
    if (!groups.has(key)) groups.set(key, []);
    if (typeof v === "number" && Number.isFinite(v)) groups.get(key)!.push(v);
  });
  return [...groups].map(([name, v]) => ({ name, values: v }));
}

// ---------------------------------------------------------------- waterfall and Pareto

export interface WaterfallStep {
  /** The level the bar starts and ends at. */
  from: number;
  to: number;
  kind: "increase" | "decrease" | "total";
}

/** A waterfall chart's bars: each value moves the running level, except the totals, which are drawn from zero and set the level. */
export function waterfallSteps(values: readonly (number | null)[], totals: readonly number[] = []): WaterfallStep[] {
  let level = 0;
  return values.map((raw, i) => {
    const v = raw ?? 0;
    if (totals.includes(i)) {
      level = v;
      return { from: 0, to: v, kind: "total" as const };
    }
    const step: WaterfallStep = { from: level, to: level + v, kind: v < 0 ? "decrease" : "increase" };
    level += v;
    return step;
  });
}

export interface ParetoPoint {
  category: string;
  value: number;
  /** The share of the total reached by this bar and the ones before it (0 to 1). */
  cumulative: number;
}

/**
 * Pareto of several series: the categories in the order of the first series (biggest first), each series' values in that
 * order with its own running share of its own total.
 */
export function paretoSeries(categories: readonly string[], series: readonly (readonly (number | null)[])[]): { categories: string[]; order: number[]; lines: ParetoPoint[][] } {
  const first = series[0] ?? [];
  const order = categories.map((_, i) => i).sort((a, b) => (first[b] ?? 0) - (first[a] ?? 0) || a - b);
  const lines = series.map((values) => {
    const total = values.reduce<number>((s, v) => s + Math.max(0, v ?? 0), 0);
    let run = 0;
    return order.map((i) => {
      const value = values[i] ?? 0;
      run += Math.max(0, value);
      return { category: categories[i] ?? "", value, cumulative: total ? run / total : 0 };
    });
  });
  return { categories: order.map((i) => categories[i] ?? ""), order, lines };
}

/** Pareto: the values from biggest to smallest with the running share of their total. */
export function paretoPoints(categories: readonly string[], values: readonly (number | null)[]): ParetoPoint[] {
  const rows = categories.map((c, i) => ({ category: c, value: values[i] ?? 0 })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  let run = 0;
  return rows.map((r) => {
    run += Math.max(0, r.value);
    return { ...r, cumulative: total ? run / total : 0 };
  });
}

// ---------------------------------------------------------------- pie of pie

export interface OfPie {
  /** The points that stay in the main pie, then "Other" (the sum of the moved ones) as the last slice. */
  main: { index: number | null; value: number }[];
  /** The points moved to the second plot. */
  second: { index: number; value: number }[];
}

/** Which points move to the second plot of a pie-of-pie or bar-of-pie chart. */
export function splitOfPie(values: readonly (number | null)[], split: ChartSplit | undefined): OfPie {
  const v = values.map((x) => Math.max(0, x ?? 0));
  const total = v.reduce((a, b) => a + b, 0);
  const rule = split ?? { by: "position", at: 3 };
  const moved = new Set<number>();
  if (rule.by === "custom") for (const i of rule.points ?? []) i < v.length && moved.add(i);
  else if (rule.by === "position") for (let i = Math.max(0, v.length - Math.floor(rule.at)); i < v.length; i++) moved.add(i);
  else if (rule.by === "value") v.forEach((x, i) => x < rule.at && moved.add(i));
  else v.forEach((x, i) => total && (x / total) * 100 < rule.at && moved.add(i));
  // The second plot has to leave something in the first, and take something.
  if (moved.size >= v.length) moved.clear();
  const main = v.flatMap((value, index) => (moved.has(index) ? [] : [{ index: index as number | null, value }]));
  const second = v.flatMap((value, index) => (moved.has(index) ? [{ index, value }] : []));
  if (second.length) main.push({ index: null, value: second.reduce((s, p) => s + p.value, 0) });
  return { main, second };
}

// ---------------------------------------------------------------- treemap and sunburst

export interface TreeNode {
  name: string;
  value: number;
  /** The names from the top down to this node. */
  path: string[];
  children: TreeNode[];
  /** For a node that is a row of the data: the number of the first row (counting from 0) that gave it. */
  row?: number;
}

/**
 * The tree a treemap or sunburst draws, from one row per leaf: `levels[l][k]` is the name at level `l` of row `k` (empty
 * names repeat the one above, as when only the first row of a group is filled in), and `values[k]` the leaf's size.
 * A parent's value is the sum of its children's.
 */
export function buildTree(levels: readonly (readonly string[])[], values: readonly (number | null)[]): TreeNode {
  const root: TreeNode = { name: "", value: 0, path: [], children: [] };
  const carried: string[] = levels.map(() => "");
  for (let k = 0; k < values.length; k++) {
    const names = levels.map((col) => col[k] ?? "");
    let deepest = -1;
    names.forEach((nm, l) => nm !== "" && (deepest = l));
    if (deepest < 0) continue;
    for (let l = 0; l <= deepest; l++) {
      if (names[l] === "") names[l] = carried[l]!;
      else {
        carried[l] = names[l]!;
        for (let m = l + 1; m < levels.length; m++) carried[m] = "";
      }
    }
    let parent = root;
    for (let l = 0; l <= deepest; l++) {
      let node = parent.children.find((c) => c.name === names[l]);
      if (!node) {
        node = { name: names[l]!, value: 0, path: [...parent.path, names[l]!], children: [] };
        parent.children.push(node);
      }
      parent = node;
    }
    parent.value += Math.max(0, values[k] ?? 0);
    parent.row ??= k;
  }
  const total = (node: TreeNode): number => {
    if (node.children.length) node.value = node.children.reduce((s, c) => s + total(c), 0);
    return node.value;
  };
  total(root);
  return root;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout (Bruls, Huizing, van Wijk): children of `node` fitted into `rect`, biggest first, keeping the tiles close to square. */
export function squarify(nodes: readonly TreeNode[], rect: Rect): { node: TreeNode; rect: Rect }[] {
  const items = nodes.filter((n) => n.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, n) => s + n.value, 0);
  const out: { node: TreeNode; rect: Rect }[] = [];
  if (!total || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  let r = { ...rect };
  let row: TreeNode[] = [];
  const worst = (nodesIn: TreeNode[], side: number): number => {
    const areas = nodesIn.map((n) => n.value * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const place = (nodesIn: TreeNode[]) => {
    const sum = nodesIn.reduce((s, n) => s + n.value * scale, 0);
    if (r.w >= r.h) {
      // A column down the left edge.
      const w = sum / r.h;
      let y = r.y;
      for (const n of nodesIn) {
        const h = (n.value * scale) / w;
        out.push({ node: n, rect: { x: r.x, y, w, h } });
        y += h;
      }
      r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h };
    } else {
      const h = sum / r.w;
      let x = r.x;
      for (const n of nodesIn) {
        const w = (n.value * scale) / h;
        out.push({ node: n, rect: { x, y: r.y, w, h } });
        x += w;
      }
      r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h };
    }
  };
  for (const item of items) {
    const side = Math.min(r.w, r.h);
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      place(row);
      row = [item];
    }
  }
  if (row.length) place(row);
  return out;
}

export interface Arc {
  node: TreeNode;
  level: number;
  /** In turns (0 to 1), clockwise from twelve o'clock. */
  from: number;
  to: number;
}

/** The rings of a sunburst: level 0 is the first ring, each child fills part of its parent's span in proportion to its value. */
export function sunburstArcs(root: TreeNode): Arc[] {
  const out: Arc[] = [];
  const walk = (node: TreeNode, from: number, to: number, level: number) => {
    let at = from;
    const total = node.children.reduce((s, c) => s + c.value, 0);
    for (const c of node.children) {
      if (c.value <= 0 || !total) continue;
      const span = ((to - from) * c.value) / total;
      out.push({ node: c, level, from: at, to: at + span });
      walk(c, at, at + span, level + 1);
      at += span;
    }
  };
  walk(root, 0, 1, 0);
  return out;
}
