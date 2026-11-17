import { DIV0, isArray, isError, toNumber, VALUE, type ErrorValue } from "../values";
import { clip, depend, isRef, scalar } from "./helpers";
import type { Arg, FunctionDef } from "./types";

/*
 * `SUBTOTAL(function, ref1, …)` as Excel does it: 1 to 11 add up the cells of the references, and 101 to 111 do the same without
 * the rows that are hidden. Both leave out rows a filter hid, and cells that hold a `SUBTOTAL` of their own, so a subtotal of
 * subtotals (the grand total of a list with subtotals in it) doesn't count anything twice.
 */

const NESTED = /(^|[^A-Za-z0-9_.])SUBTOTAL\s*\(/i;

export const subtotalFunctions: Record<string, FunctionDef> = {
  SUBTOTAL: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const code = toNumber(scalar(args[0] as Arg, ctx));
      if (isError(code)) return code;
      const f = Math.trunc(code);
      const hide = f >= 101 && f <= 111;
      const kind = hide ? f - 100 : f;
      if (!(kind >= 1 && kind <= 11)) return VALUE;
      const xs: number[] = [];
      let all = 0;
      let error: ErrorValue | undefined;
      const take = (v: unknown) => {
        if (isError(v)) {
          error ??= v;
          all++;
        } else if (v !== null && v !== undefined) {
          all++;
          if (typeof v === "number") xs.push(v);
        }
      };
      for (const a of args.slice(1) as Arg[]) {
        if (isRef(a)) {
          depend(a, ctx);
          const r = clip(a, ctx);
          if (!r) continue;
          // Hidden rows only matter for a range of rows: hiding rows doesn't change what a row of cells adds up.
          ctx.host.eachCell(a.sheet, r, (row, col, v) => {
            if (ctx.host.rowHidden(a.sheet, row, !hide)) return;
            const text = ctx.host.formulaText(a.sheet, row, col);
            if (text !== undefined && NESTED.test(text)) return;
            take(v);
          });
        } else if (isArray(a)) {
          for (const row of a.array) for (const v of row) take(v);
        } else {
          const v = scalar(a, ctx);
          if (isError(v)) return v;
          const n = toNumber(v);
          if (!isError(n) && v !== null) {
            xs.push(n);
            all++;
          }
        }
      }
      // COUNT and COUNTA never fail on an error in the cells; the others do.
      if (kind === 2) return xs.length;
      if (kind === 3) return all;
      if (error) return error;
      const n = xs.length;
      const mean = n ? xs.reduce((p, q) => p + q, 0) / n : 0;
      const squares = xs.reduce((p, q) => p + (q - mean) ** 2, 0);
      switch (kind) {
        case 1:
          return n ? mean : DIV0;
        case 4:
          return n ? Math.max(...xs) : 0;
        case 5:
          return n ? Math.min(...xs) : 0;
        case 6:
          return n ? xs.reduce((p, q) => p * q, 1) : 0;
        case 7:
          return n > 1 ? Math.sqrt(squares / (n - 1)) : DIV0;
        case 8:
          return n ? Math.sqrt(squares / n) : DIV0;
        case 9:
          return xs.reduce((p, q) => p + q, 0);
        case 10:
          return n > 1 ? squares / (n - 1) : DIV0;
        default:
          return n ? squares / n : DIV0;
      }
    },
  },
};
