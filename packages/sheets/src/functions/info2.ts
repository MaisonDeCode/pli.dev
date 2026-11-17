import { cellAddress } from "../address";
import { isError, NA, toText, VALUE, type Value } from "../values";
import { isRef, scalar } from "./helpers";
import type { Arg, FunctionDef } from "./types";

export const info2: Record<string, FunctionDef> = {
  FORMULATEXT: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0];
      if (!isRef(a)) return NA;
      const f = ctx.host.formulaText(a.sheet, a.r1, a.c1);
      // A formula that a protected sheet hides can't be shown, as in Excel.
      return f === undefined || ctx.host.formulaHidden?.(a.sheet, a.r1, a.c1) ? NA : "=" + f;
    },
  },
  SHEET: {
    min: 0,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0];
      if (a === undefined) return ctx.host.sheetIndex(ctx.sheet) + 1;
      if (isRef(a)) return ctx.host.sheetIndex(a.sheet) + 1;
      const name = scalar(a as Arg, ctx);
      if (isError(name)) return name;
      const id = ctx.host.sheetId(String(toText(name)));
      return id === undefined ? NA : ctx.host.sheetIndex(id) + 1;
    },
  },
  SHEETS: {
    min: 0,
    max: 1,
    fn: (_args, ctx) => ctx.host.sheetCount(),
  },
  AREAS: { min: 1, max: 1, fn: (args) => (isRef(args[0]) ? 1 : VALUE) },
  HYPERLINK: {
    min: 1,
    max: 2,
    fn: (args, ctx) => {
      const link = scalar(args[0] as Arg, ctx);
      if (isError(link)) return link;
      const label = args[1] === undefined ? link : scalar(args[1] as Arg, ctx);
      return label ?? "";
    },
  },
  CELL: {
    min: 1,
    max: 2,
    fn: (args, ctx) => {
      const what = String(toText(scalar(args[0] as Arg, ctx)) as string).toLowerCase();
      const ref = args[1];
      const r = isRef(ref) ? ref : { sheet: ctx.sheet, r1: ctx.row, c1: ctx.col, r2: ctx.row, c2: ctx.col };
      const v: Value = ctx.host.peek(r.sheet, r.r1, r.c1);
      switch (what) {
        case "address": return "$" + cellAddress(r.r1, r.c1).replace(/^([A-Z]+)/, "$1$");
        case "row": return r.r1;
        case "col": return r.c1;
        case "contents": return v;
        case "type": return v === null ? "b" : typeof v === "string" ? "l" : "v";
        case "filename": return ctx.host.sheetName(r.sheet);
        default: return VALUE;
      }
    },
  },
};
