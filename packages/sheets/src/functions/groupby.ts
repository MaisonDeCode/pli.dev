import { applyLambda } from "../eval";
import { arrayOf, DIV0, isArray, isError, toNumber, VALUE, type ErrorValue, type Value } from "../values";
import { isLambda, isRef, scalar, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef, Lambda } from "./types";

/*
 * `GROUPBY` and `PIVOTBY`: group the rows of a table by the values of one or more columns (and, for `PIVOTBY`, spread the
 * groups of another set of columns across the top), and combine the values of each group with a function. The result is an
 * ordinary array that spills, with a header row, totals and subtotals and a sort order as the arguments ask.
 *
 * The function is a `LAMBDA`, or a function named on its own (`SUM`, `AVERAGE`, `PERCENTOF`…), or several of these side by
 * side (`HSTACK(SUM, COUNT)`). It is called with the values of one column in one group, as a column; a function that takes
 * two arguments (`PERCENTOF`, or a `LAMBDA` with two names) also gets the values of that column in all the rows.
 */

type Grid = Value[][];

/** One row of the data: the keys it is grouped under on each axis, and its values. */
interface Rec {
  rowKeys: Value[];
  colKeys: Value[];
  values: Value[];
}

/** A group of rows, with the groups inside it by the next key. */
interface Group {
  key: Value;
  recs: number[];
  kids: Group[];
}

/** One line (or column) of the result: a group, a subtotal for a group, or the grand total. */
interface Entry {
  labels: Value[];
  recs: number[];
  total: boolean;
  /** The rows of the group this one sits in (all the rows for a group at the top and for the totals), for `relative_to`. */
  parent: number[];
}

const keyText = (v: Value): string => (v === null ? "n:" : typeof v === "number" ? `d:${v}` : typeof v === "string" ? `s:${v.toLowerCase()}` : typeof v === "boolean" ? `b:${v}` : `e:${v.error}`);

/** Orders values for a sort: numbers, then text, then logical values, then errors, then blanks (the last two stay last in either direction). */
function compareKeys(a: Value, b: Value): number {
  const rank = (v: Value) => (v === null ? 4 : isError(v) ? 3 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number") return a - (b as number);
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "boolean") return Number(a) - Number(b);
  return 0;
}

const isLast = (v: Value) => v === null || isError(v);

/** The functions to apply: one, or several side by side. */
function functionsOf(a: Arg): Lambda[] | null {
  if (!isLambda(a)) return null;
  return a.many ? [...a.many] : [a];
}

const wantsAll = (l: Lambda) => (l.fn ? l.fn === "PERCENTOF" : l.params.length === 2);

/** The headers, totals, sort order and the rest, as the arguments give them. */
interface Settings {
  headers: boolean;
  showHeaders: boolean;
  /** Left out: Excel finds the headers (and keeps them out of the groups) but does not show them. */
  auto: boolean;
}

/** `field_headers`: 0 none, 1 there but not shown, 2 none but make them, 3 there and shown; left out, they are there if the first value is text and the second a number. */
function headerSettings(arg: Arg | undefined, ctx: Ctx, values: Grid): Settings | ErrorValue {
  const given = arg === undefined ? null : scalar(arg, ctx);
  if (given === null || given === "") {
    const auto = values.length > 1 && typeof values[0]![0] === "string" && typeof values[1]![0] === "number";
    return { headers: auto, showHeaders: false, auto: true };
  }
  const n = toNumber(given);
  if (isError(n)) return n;
  switch (Math.trunc(n)) {
    case 0:
      return { headers: false, showHeaders: false, auto: false };
    case 1:
      return { headers: true, showHeaders: false, auto: false };
    case 2:
      return { headers: false, showHeaders: true, auto: false };
    case 3:
      return { headers: true, showHeaders: true, auto: false };
    default:
      return VALUE;
  }
}

/** A whole number argument, or `fallback` when left out. */
function integer(arg: Arg | undefined, ctx: Ctx): number | undefined | ErrorValue {
  if (arg === undefined) return undefined;
  const v = scalar(arg, ctx);
  if (v === null) return undefined;
  const n = toNumber(v);
  return isError(n) ? n : Math.trunc(n);
}

/** A sort order: column numbers, negative for descending. */
function sortOrder(arg: Arg | undefined, ctx: Ctx, columns: number, fields: number): number[] | ErrorValue {
  if (arg === undefined) return [];
  const out: number[] = [];
  for (const row of toGrid(arg, ctx)) {
    for (const v of row) {
      if (v === null) continue;
      const n = toNumber(v);
      if (isError(n)) return n;
      const i = Math.trunc(Math.abs(n));
      if (i < 1 || i > columns) return VALUE;
      out.push(n < 0 ? -i : i);
    }
  }
  // Several numbers can only sort by the fields; a value column is picked on its own.
  if (out.length > 1 && out.some((i) => Math.abs(i) > fields)) return VALUE;
  return out;
}

/** `total_depth` as given: it can't ask for more levels of subtotals than there are fields. */
function checkDepth(depth: number | undefined, levels: number): ErrorValue | undefined {
  return depth !== undefined && levels > 0 && Math.abs(depth) > levels ? VALUE : undefined;
}

/** Everything a call needs to work out the groups and the values. */
interface Job {
  recs: Rec[];
  funcs: Lambda[];
  /** The values of each column in all the rows, for the functions that want them. */
  all: Value[][];
  names: { rowFields: Value[]; colFields: Value[]; values: Value[] };
  settings: Settings;
  ctx: Ctx;
  /** The names over the columns of each function, when there are several (or the function was given labels). */
  labels: Value[] | null;
  /** What each column of the result is: which value column, worked out with which function. */
  plan: { value: number; func: number }[];
}

/**
 * The columns of the result. One function is used on every value column; one value column gets every function; and when
 * there are as many functions as value columns, each function takes its own column (Excel's `GROUPBY(A2:A8,C2:D8,HSTACK(SUM,COUNT))`
 * has two columns, not four). Any other pairing is #VALUE!.
 */
function planColumns(values: number, functions: number): { value: number; func: number }[] | ErrorValue {
  if (functions === 1) return Array.from({ length: values }, (_, value) => ({ value, func: 0 }));
  if (values === 1) return Array.from({ length: functions }, (_, func) => ({ value: 0, func }));
  if (values !== functions) return VALUE;
  return Array.from({ length: values }, (_, i) => ({ value: i, func: i }));
}

/** The value of a function over a column of the values of some rows: `column` is the number of the column of the result. */
function aggregate(job: Job, recs: number[], column: number, whole?: number[]): Value {
  if (recs.length === 0) return "";
  const { value: j, func } = job.plan[column]!;
  const fn = job.funcs[func]!;
  const group = arrayOf(recs.map((i) => [job.recs[i]!.values[j] ?? null]));
  const all = whole ? whole.map((i) => job.recs[i]!.values[j] ?? null) : job.all[j]!;
  const args: Arg[] = wantsAll(fn) ? [group, arrayOf(all.map((v) => [v]))] : [group];
  const result = applyLambda(fn, args, job.ctx);
  if (isLambda(result)) return VALUE;
  return isArray(result) || isRef(result) ? scalar(result, job.ctx) : result;
}

/** Groups the rows by the first key and, inside each, by the next, and so on. */
function groupRows(recs: number[], keyOf: (rec: number, level: number) => Value, level: number, levels: number): Group[] {
  const byKey = new Map<string, Group>();
  const order: Group[] = [];
  for (const r of recs) {
    const key = keyOf(r, level);
    const id = keyText(key);
    let g = byKey.get(id);
    if (!g) {
      g = { key, recs: [], kids: [] };
      byKey.set(id, g);
      order.push(g);
    }
    g.recs.push(r);
  }
  if (level + 1 < levels) for (const g of order) g.kids = groupRows(g.recs, keyOf, level + 1, levels);
  return order;
}

interface Axis {
  levels: number;
  keyOf: (rec: number, level: number) => Value;
  /** The sort: column numbers (negative for descending); `fields` is how many of the numbers stand for the fields of this axis. */
  sort: number[];
  fields: number;
  /** The total depth asked for, or undefined for automatic. */
  depth: number | undefined;
  table: boolean;
}

/** The lines (or columns) of the result for one axis, in order, with their totals. */
function entries(job: Job, axis: Axis, recs: number[]): Entry[] {
  const { levels } = axis;
  const out: Entry[] = [];
  if (levels === 0) return [{ labels: [], recs, total: false, parent: recs }];
  const compare = (level: number) => (a: Group, b: Group): number => {
    for (const s of axis.sort) {
      const dir = s < 0 ? -1 : 1;
      const i = Math.abs(s);
      let va: Value;
      let vb: Value;
      if (i <= axis.fields) {
        // A field sorts only the groups made by that field.
        if (i !== level + 1) continue;
        va = a.key;
        vb = b.key;
      } else {
        va = aggregate(job, a.recs, i - axis.fields - 1);
        vb = aggregate(job, b.recs, i - axis.fields - 1);
      }
      if (isLast(va) !== isLast(vb)) return isLast(va) ? 1 : -1;
      const c = compareKeys(va, vb);
      if (c !== 0) return c * dir;
    }
    return compareKeys(a.key, b.key);
  };
  const tree = groupRows(recs, axis.keyOf, 0, levels);

  const depth = axis.depth;
  const top = depth !== undefined && depth < 0;
  const size = depth === undefined ? 1 : Math.abs(depth); // 1 (also when left out) is the grand total alone
  const grand = size >= 1;
  const subtotals = axis.table ? 0 : Math.min(Math.max(size - 1, 0), levels - 1);
  const grandEntry: Entry = { labels: [size >= 2 && !axis.table ? "Grand Total" : "Total", ...new Array(levels - 1).fill("")], recs, total: true, parent: recs };
  if (grand && top) out.push(grandEntry);

  if (axis.table) {
    // The groups are every combination of keys; each line is sorted as a whole, so the fields are columns like the others.
    const leaves: { keys: Value[]; g: Group }[] = [];
    const walk = (groups: Group[], keys: Value[]) => {
      for (const g of groups) {
        if (g.kids.length) walk(g.kids, [...keys, g.key]);
        else leaves.push({ keys: [...keys, g.key], g });
      }
    };
    walk(tree, []);
    leaves.sort((a, b) => {
      for (const s of axis.sort) {
        const dir = s < 0 ? -1 : 1;
        const i = Math.abs(s);
        const va = i <= axis.fields ? a.keys[i - 1]! : aggregate(job, a.g.recs, i - axis.fields - 1);
        const vb = i <= axis.fields ? b.keys[i - 1]! : aggregate(job, b.g.recs, i - axis.fields - 1);
        if (isLast(va) !== isLast(vb)) return isLast(va) ? 1 : -1;
        const c = compareKeys(va, vb);
        if (c !== 0) return c * dir;
      }
      for (let i = 0; i < levels; i++) {
        const c = compareKeys(a.keys[i]!, b.keys[i]!);
        if (c !== 0) return c;
      }
      return 0;
    });
    for (const l of leaves) out.push({ labels: l.keys, recs: l.g.recs, total: false, parent: recs });
  } else {
    const walk = (groups: Group[], level: number, parents: Value[], parentRecs: number[]) => {
      const sorted = [...groups].sort(compare(level));
      for (const g of sorted) {
        const keys = [...parents, g.key];
        const subtotal = level < subtotals && g.kids.length > 0;
        const sub: Entry = { labels: [...parents, g.key, ...new Array(levels - level - 1).fill("")], recs: g.recs, total: true, parent: parentRecs };
        if (subtotal && top) out.push(sub);
        if (g.kids.length) walk(g.kids, level + 1, keys, g.recs);
        else out.push({ labels: keys, recs: g.recs, total: false, parent: parentRecs });
        if (subtotal && !top) out.push(sub);
      }
    };
    walk(tree, 0, [], recs);
  }
  if (grand && !top) out.push(grandEntry);
  return out.map((e) => ({ ...e, labels: e.labels.map((v) => (v === null ? "" : v)) }));
}

/** Reads the data, and the columns for each axis. */
function prepare(fields: Grid, across: Grid | null, values: Grid, funcArg: Arg, headerArg: Arg | undefined, filterArg: Arg | undefined, ctx: Ctx) {
  const funcs = functionsOf(funcArg);
  if (!funcs || funcs.length === 0) return VALUE;
  if (fields.length !== values.length || (across && across.length !== values.length)) return VALUE;
  const given = headerSettings(headerArg, ctx, values);
  if (isError(given)) return given;
  const settings: Settings = given;
  const start = settings.headers ? 1 : 0;
  let keep: boolean[] | null = null;
  if (filterArg !== undefined && (filterArg as Value) !== null) {
    const f = toGrid(filterArg, ctx);
    if (f.length !== values.length || (f[0]?.length ?? 0) !== 1) return VALUE;
    for (const [v] of f.slice(start)) if (isError(v!)) return v;
    keep = f.map(([v]) => v === true || (typeof v === "number" && v !== 0));
  }
  const recs: Rec[] = [];
  for (let i = start; i < values.length; i++) {
    if (keep && !keep[i]) continue;
    recs.push({ rowKeys: fields[i]!, colKeys: across ? across[i]! : [], values: values[i]! });
  }
  const names = {
    rowFields: settings.headers ? fields[0]! : fields[0]!.map((_, j) => `Row Field ${j + 1}`),
    colFields: across ? (settings.headers ? across[0]! : across[0]!.map((_, j) => `Column Field ${j + 1}`)) : [],
    values: settings.headers ? values[0]! : values[0]!.map((_, j) => `Value ${j + 1}`),
  };
  // Several functions (or labels given with them) get a row of names over their columns: the labels, else the function's own name.
  const labelled = isLambda(funcArg) ? funcArg.labels : undefined;
  const labels: Value[] | null = labelled ? [...labelled] : funcs.length > 1 ? funcs.map((f) => (f.fn ? f.fn : "")) : null;
  if (labels && labels.length !== funcs.length) return VALUE;
  const plan = planColumns(values[0]?.length ?? 0, funcs.length);
  if (isError(plan)) return plan;
  return { funcs, settings, recs, names, labels, plan };
}

/** The row of function names over the columns of the result. */
const functionRow = (job: Job): Value[] => job.plan.map((p) => job.labels![p.func]!);

/** `GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order], [filter_array], [field_relationship])` */
function groupBy(args: Arg[], ctx: Ctx): Arg {
  const fields = toGrid(args[0]!, ctx);
  const values = toGrid(args[1]!, ctx);
  const prep = prepare(fields, null, values, args[2]!, args[3], args[6], ctx);
  if (isError(prep)) return prep;
  const { funcs, settings, recs, names, labels, plan } = prep;
  const depth = integer(args[4], ctx);
  if (typeof depth === "object") return depth;
  const kr = fields[0]?.length ?? 0;
  const kv = values[0]?.length ?? 0;
  const columns = plan.length;
  const bad = checkDepth(depth, kr);
  if (bad) return bad;
  const sort = sortOrder(args[5], ctx, kr + columns, kr);
  if (isError(sort)) return sort;
  const relation = integer(args[7], ctx);
  if (typeof relation === "object") return relation;
  if (relation !== undefined && relation !== 0 && relation !== 1) return VALUE;
  // Subtotals need a hierarchy.
  if (relation === 1 && depth !== undefined && Math.abs(depth) > 1) return VALUE;
  const all = Array.from({ length: kv }, (_, j) => recs.map((r) => r.values[j] ?? null));
  const job: Job = { recs, funcs, all, names, settings, ctx, labels, plan };
  const axis: Axis = { levels: kr, keyOf: (r, l) => recs[r]!.rowKeys[l] ?? null, sort, fields: kr, depth, table: relation === 1 };
  const lines = entries(job, axis, recs.map((_, i) => i));
  if (lines.length === 0) return VALUE;
  const out: Grid = [];
  if (labels) out.push([...new Array<Value>(kr).fill(""), ...functionRow(job)]);
  if (settings.showHeaders) out.push([...names.rowFields, ...plan.map((p) => names.values[p.value] ?? "")]);
  for (const line of lines) out.push([...line.labels, ...Array.from({ length: columns }, (_, c) => aggregate(job, line.recs, c))]);
  return arrayOf(out);
}

/** The rows two lists have in common. */
function common(a: number[], b: number[]): number[] {
  const inB = new Set(b);
  return a.filter((r) => inB.has(r));
}

/** `PIVOTBY(row_fields, col_fields, values, function, [field_headers], [row_total_depth], [row_sort_order], [col_total_depth], [col_sort_order], [filter_array], [relative_to])` */
function pivotBy(args: Arg[], ctx: Ctx): Arg {
  const fields = toGrid(args[0]!, ctx);
  // Columns can be left out (`PIVOTBY(A2:A9,,B2:B9,SUM)`): there is then nothing across the top but the values.
  const across = (args[1] as Value) === null ? null : toGrid(args[1]!, ctx);
  const values = toGrid(args[2]!, ctx);
  const prep = prepare(fields, across, values, args[3]!, args[4], args[9], ctx);
  if (isError(prep)) return prep;
  const { funcs, settings, recs, names, labels, plan } = prep;
  const rowDepth = integer(args[5], ctx);
  if (typeof rowDepth === "object") return rowDepth;
  const colDepth = integer(args[7], ctx);
  if (typeof colDepth === "object") return colDepth;
  const kr = fields[0]?.length ?? 0;
  const kc = across?.[0]?.length ?? 0;
  const kv = values[0]?.length ?? 0;
  const columns = plan.length;
  const badRow = checkDepth(rowDepth, kr) ?? checkDepth(colDepth, kc);
  if (badRow) return badRow;
  const rowSort = sortOrder(args[6], ctx, kr + columns, kr);
  if (isError(rowSort)) return rowSort;
  const colSort = sortOrder(args[8], ctx, kc + columns, kc);
  if (isError(colSort)) return colSort;
  // What a function that takes two arguments (`PERCENTOF`) is compared with: 0 the column's total, 1 the row's, 2 everything, 3 the parent column's, 4 the parent row's.
  const relative = integer(args[10], ctx);
  if (typeof relative === "object") return relative;
  if (relative !== undefined && (relative < 0 || relative > 4)) return VALUE;
  const all = Array.from({ length: kv }, (_, j) => recs.map((r) => r.values[j] ?? null));
  const job: Job = { recs, funcs, all, names, settings, ctx, labels, plan };
  const everyone = recs.map((_, i) => i);
  const rowAxis: Axis = { levels: kr, keyOf: (r, l) => recs[r]!.rowKeys[l] ?? null, sort: rowSort, fields: kr, depth: rowDepth, table: false };
  const colAxis: Axis = { levels: kc, keyOf: (r, l) => recs[r]!.colKeys[l] ?? null, sort: colSort, fields: kc, depth: colDepth, table: false };
  const lines = entries(job, rowAxis, everyone);
  const tops = entries(job, colAxis, everyone);
  if (lines.length === 0 || tops.length === 0) return VALUE;

  const out: Grid = [];
  const perTop = columns;
  // The labels across the top, one row for each column field. With the headers shown, the name of the column field has a row
  // of its own above them, in the first column of the values (the corner stays empty).
  for (let i = 0; i < kc; i++) {
    const left: Value[] = new Array(kr).fill("");
    if (settings.showHeaders) {
      const width = tops.length * perTop;
      out.push([...left, names.colFields[i] ?? "", ...new Array<Value>(Math.max(width - 1, 0)).fill("")]);
    }
    out.push([...left, ...tops.flatMap((t) => Array.from({ length: perTop }, () => t.labels[i] ?? ""))]);
  }
  if (labels) out.push([...new Array<Value>(kr).fill(""), ...tops.flatMap(() => functionRow(job))]);
  if (settings.showHeaders) out.push([...names.rowFields, ...tops.flatMap(() => plan.map((p) => names.values[p.value] ?? ""))]);
  for (const line of lines) {
    const row: Value[] = [...line.labels];
    for (const top of tops) {
      const shared = common(line.recs, top.recs);
      const whole = relative === 1 ? line.recs : relative === 2 ? everyone : relative === 3 ? common(line.recs, top.parent) : relative === 4 ? common(top.recs, line.parent) : top.recs;
      for (let c = 0; c < perTop; c++) row.push(aggregate(job, shared, c, whole));
    }
    out.push(row);
  }
  return arrayOf(out);
}

/** The total of one set of numbers as a share of another's. */
function percentOf(subset: Value[], whole: Value[]): Value {
  let a = 0;
  let b = 0;
  for (const v of subset) {
    if (isError(v)) return v;
    if (typeof v === "number") a += v;
  }
  for (const v of whole) {
    if (isError(v)) return v;
    if (typeof v === "number") b += v;
  }
  return b === 0 ? DIV0 : a / b;
}

export const groupFunctions: Record<string, FunctionDef> = {
  GROUPBY: { min: 3, max: 8, fn: (args, ctx) => groupBy(args as Arg[], ctx) },
  PIVOTBY: { min: 4, max: 11, fn: (args, ctx) => pivotBy(args as Arg[], ctx) },
  PERCENTOF: {
    min: 2,
    max: 2,
    fn: (args, ctx) => percentOf(toGrid(args[0] as Arg, ctx).flat(), toGrid(args[1] as Arg, ctx).flat()),
  },
};
