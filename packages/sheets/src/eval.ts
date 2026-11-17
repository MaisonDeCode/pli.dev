import { parseFormula, FormulaSyntaxError, type BinaryOp, type Node } from "./formula";
import { broadcast, isLambda, isRef, scalar, toGrid } from "./functions/helpers";
import { refFromNode } from "./refnode";
import { getFunction } from "./functions";
import type { Arg, Ctx, Lambda } from "./functions/types";
import { arrayOf, compareValues, DIV0, err, isArray, isError, NAME, NUM, REF, toNumber, toText, VALUE, type ArrayValue, type Value } from "./values";

export function evalNode(node: Node, ctx: Ctx): Arg {
  switch (node.t) {
    case "num":
    case "str":
    case "bool":
      return node.v;
    case "err":
      return err(node.v);
    case "empty":
      return null;
    case "paren":
      return evalNode(node.arg, ctx);
    case "ref":
      return refFromNode(node, ctx) ?? REF;
    case "tref": {
      const r = ctx.host.tableRange(node, ctx.sheet, ctx.row, ctx.col);
      if (!r) return node.area === "row" ? VALUE : REF;
      return { ref: true, sheet: r.sheet, r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 };
    }
    case "name": {
      const local = ctx.vars?.get(node.name.toLowerCase());
      if (local !== undefined) return local;
      const source = ctx.host.nameFormula(node.name);
      if (source === undefined) {
        // A table's name on its own stands for its data.
        const r = ctx.host.tableRange({ t: "tref", table: node.name, area: "data" }, ctx.sheet, ctx.row, ctx.col);
        if (r) return { ref: true, sheet: r.sheet, r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 };
        // A function named on its own stands for the function (`SUM` in `BYROW(A1:C3,SUM)`).
        return getFunction(node.name) ? { lambda: true, params: [], body: { t: "empty" }, fn: node.name.toUpperCase() } : NAME;
      }
      if (ctx.depth > 40) return REF;
      try {
        return evalNode(parseFormula(source), { ...ctx, depth: ctx.depth + 1 });
      } catch (e) {
        if (e instanceof FormulaSyntaxError) return NAME;
        throw e;
      }
    }
    case "array":
      return arrayOf(node.rows.map((row) => row.map((c) => evalNode(c, ctx) as Value)));
    case "unary": {
      const a = evalNode(node.arg, ctx);
      if (node.op === "+") return a;
      return broadcast([a], ctx, ([v]) => {
        const n = toNumber(v!);
        return isError(n) ? n : -n;
      });
    }
    case "percent":
      return broadcast([evalNode(node.arg, ctx)], ctx, ([v]) => {
        const n = toNumber(v!);
        return isError(n) ? n : n / 100;
      });
    case "binary": {
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      return broadcast([left, right], ctx, ([a, b]) => binary(node.op, a!, b!));
    }
    case "call": {
      // A function called at once, `LAMBDA(x,x+1)(5)`: the first argument is the function.
      if (node.name === "") {
        const callee = evalNode(node.args[0]!, ctx);
        return isLambda(callee) ? applyLambda(callee, node.args.slice(1).map((n) => (n.t === "empty" ? OMITTED_ARG : evalNode(n, ctx))), ctx) : VALUE;
      }
      const upper = node.name.toUpperCase();
      if (upper === "LET") return evalLet(node.args, ctx);
      if (upper === "LAMBDA") return makeLambda(node.args, ctx);
      if (upper === "ISOMITTED") return isOmitted(node.args, ctx);
      // A name made by LET or a LAMBDA parameter that holds a function can be called like one.
      const held = ctx.vars?.get(node.name.toLowerCase());
      if (held !== undefined) return isLambda(held) ? applyLambda(held, node.args.map((n) => (n.t === "empty" ? OMITTED_ARG : evalNode(n, ctx))), ctx) : VALUE;
      const def = getFunction(node.name);
      if (!def) return NAME;
      if (node.args.length < def.min || node.args.length > def.max) return VALUE;
      if (def.volatile) ctx.host.volatile();
      if (def.lazy) return def.fn(node.args.map((n) => () => evalNode(n, ctx)), ctx);
      return def.fn(node.args.map((n) => evalNode(n, ctx)), ctx);
    }
  }
}

function binary(op: BinaryOp, a: Value, b: Value): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case "&": {
      const x = toText(a) as string;
      const y = toText(b) as string;
      return x + y;
    }
    case "=":
      return compareValues(a, b) === 0;
    case "<>":
      return compareValues(a, b) !== 0;
    case "<":
      return compareValues(a, b) < 0;
    case ">":
      return compareValues(a, b) > 0;
    case "<=":
      return compareValues(a, b) <= 0;
    case ">=":
      return compareValues(a, b) >= 0;
  }
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  if (isError(y)) return y;
  let r: number;
  switch (op) {
    case "+":
      r = x + y;
      break;
    case "-":
      r = x - y;
      break;
    case "*":
      r = x * y;
      break;
    case "/":
      if (y === 0) return DIV0;
      r = x / y;
      break;
    default:
      if (x === 0 && y === 0) return NUM;
      if (x === 0 && y < 0) return DIV0;
      r = x ** y;
  }
  return Number.isFinite(r) ? r : NUM;
}

/** `LET(name1, value1, …, calculation)`: each name can be used by the values after it and by the calculation. */
function evalLet(args: Node[], ctx: Ctx): Arg {
  if (args.length < 3 || args.length % 2 === 0) return VALUE;
  const vars = new Map(ctx.vars);
  const inner: Ctx = { ...ctx, vars };
  for (let i = 0; i < args.length - 1; i += 2) {
    const n = args[i]!;
    if (n.t !== "name") return VALUE;
    const v = evalNode(args[i + 1]!, inner);
    if (isError(v) && !isRef(v)) return v;
    vars.set(n.name.toLowerCase(), v);
  }
  return evalNode(args[args.length - 1]!, inner);
}

/** Where a LAMBDA's omitted parameters are noted in its names, so `ISOMITTED` can tell them from a value that is empty. */
const OMITTED = "\u0000omitted:";
/** An empty argument in a call to a LAMBDA (`f(,2)`). */
const OMITTED_ARG = { omitted: true } as unknown as Arg;

/** `LAMBDA([x], …)` writes an optional parameter in square brackets, which reads as a table-less column reference. */
const optionalName = (n: Node): string | undefined => (n.t === "tref" && n.table === undefined && n.area === "data" && n.from !== undefined && n.to === undefined ? n.from : undefined);

function makeLambda(args: Node[], ctx: Ctx): Arg {
  if (args.length < 1) return VALUE;
  const params: string[] = [];
  let required = 0;
  let sawOptional = false;
  for (const n of args.slice(0, -1)) {
    const optional = optionalName(n);
    if (optional !== undefined) {
      sawOptional = true;
      params.push(optional.toLowerCase());
    } else if (n.t === "name" && !sawOptional) {
      params.push(n.name.toLowerCase());
      required++;
    } else return VALUE; // not a name, or a required parameter after an optional one
  }
  return { lambda: true, params, body: args[args.length - 1]!, ...(required < params.length ? { required } : {}), ...(ctx.vars ? { vars: ctx.vars } : {}) };
}

/** `ISOMITTED(x)`: whether the LAMBDA was called without a value for its parameter `x`. */
function isOmitted(args: Node[], ctx: Ctx): Arg {
  const n = args[0];
  if (args.length !== 1 || !n || n.t !== "name") return VALUE;
  const name = n.name.toLowerCase();
  if (!ctx.vars?.has(name)) return VALUE;
  return ctx.vars.has(OMITTED + name);
}

/** Calls a lambda with values for its parameters. Too few or too many arguments is `#VALUE!`. */
export function applyLambda(l: Lambda, args: readonly Arg[], ctx: Ctx): Arg {
  if (l.fn) {
    const def = getFunction(l.fn);
    if (!def || args.length < def.min || args.length > def.max) return VALUE;
    if (def.volatile) ctx.host.volatile();
    const given = args.map((a) => (a === OMITTED_ARG ? null : a));
    return def.fn(def.lazy ? given.map((a) => () => a) : given, ctx);
  }
  if (l.many) return VALUE;
  const required = l.required ?? l.params.length;
  if (args.length < required || args.length > l.params.length) return VALUE;
  const vars = new Map(l.vars);
  l.params.forEach((p, i) => {
    // A parameter left out, or given as an empty argument (`f(,2)`), is "omitted" if it is optional.
    const given = args[i];
    if (i >= required && (given === undefined || given === OMITTED_ARG)) {
      vars.set(p, null);
      vars.set(OMITTED + p, true);
    } else vars.set(p, given === OMITTED_ARG ? null : (given as Arg));
  });
  if (ctx.depth > 200) return NUM;
  return evalNode(l.body, { ...ctx, vars, depth: ctx.depth + 1 });
}

/**
 * Works out a formula (without the leading `=`) for the cell at `ctx`. A formula that gives several values gives them
 * all, as an array, for the cell to spill; one that names a range outright is read at the formula's own row or column.
 */
export function evaluate(source: string, ctx: Ctx): Value | ArrayValue {
  let tree: Node;
  try {
    tree = parseFormula(source);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return NAME;
    throw e;
  }
  const result = evalNode(tree, ctx);
  if (isLambda(result)) return err("#CALC!");
  if (isRef(result)) {
    const bare = tree.t === "ref" || (tree.t === "paren" && tree.arg.t === "ref") || tree.t === "name";
    if (bare || (result.r1 === result.r2 && result.c1 === result.c2)) return scalar(result, ctx);
    return trimArray(arrayOf(toGrid(result, ctx)));
  }
  if (isArray(result)) return trimArray(result);
  return result;
}

/** Like `evaluate`, but a reference to cells gives all of them (row by row) instead of the one at the formula's place. */
export function evaluateGrid(source: string, ctx: Ctx): Value[][] {
  let tree: Node;
  try {
    tree = parseFormula(source);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return [[NAME]];
    throw e;
  }
  const result = evalNode(tree, ctx);
  if (isLambda(result)) return [[err("#CALC!")]];
  if (isRef(result)) return toGrid(result, ctx);
  if (isArray(result)) return result.array;
  return [[result]];
}

/** An array of one item is that item. */
function trimArray(a: ArrayValue): Value | ArrayValue {
  if (a.array.length === 0 || a.array[0]!.length === 0) return err("#CALC!");
  return a.array.length === 1 && a.array[0]!.length === 1 ? a.array[0]![0]! : a;
}
