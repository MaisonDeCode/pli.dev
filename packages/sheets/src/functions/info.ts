import { ERROR_CODES, isError, NA, toNumber, VALUE, type Value } from "../values";
import { isRef, scalar, simple } from "./helpers";
import type { FunctionDef } from "./types";

const test = (fn: (v: Value) => boolean): FunctionDef => simple(1, 1, ([v]) => fn(v!), { passErrors: true });

export const info: Record<string, FunctionDef> = {
  ISNUMBER: test((v) => typeof v === "number"),
  ISTEXT: test((v) => typeof v === "string"),
  ISNONTEXT: test((v) => typeof v !== "string"),
  ISLOGICAL: test((v) => typeof v === "boolean"),
  ISBLANK: test((v) => v === null),
  ISERROR: test((v) => isError(v)),
  ISERR: test((v) => isError(v) && v.error !== "#N/A"),
  ISNA: test((v) => isError(v) && v.error === "#N/A"),
  ISEVEN: simple(1, 1, ([v]) => { const n = toNumber(v!); return typeof n === "number" ? Math.floor(Math.abs(n)) % 2 === 0 : n; }),
  ISODD: simple(1, 1, ([v]) => { const n = toNumber(v!); return typeof n === "number" ? Math.floor(Math.abs(n)) % 2 === 1 : n; }),
  ISREF: { min: 1, max: 1, fn: (args) => isRef(args[0]) },
  NA: { min: 0, max: 0, fn: () => NA },
  N: simple(1, 1, ([v]) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : isError(v) ? v : 0), { passErrors: true }),
  T: simple(1, 1, ([v]) => (typeof v === "string" ? v : isError(v) ? v : ""), { passErrors: true }),
  TYPE: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0];
      if (!isRef(a) && typeof a === "object" && a !== null && "array" in a) return 64;
      const v = scalar(a, ctx);
      return typeof v === "number" || v === null ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 4 : 16;
    },
  },
  "ERROR.TYPE": simple(1, 1, ([v]) => {
    if (!isError(v)) return NA;
    const i = ERROR_CODES.indexOf(v.error);
    return i < 0 || i > 6 ? NA : i + 1;
  }, { passErrors: true }),
  ISFORMULA: {
    min: 1,
    max: 1,
    fn: (args, ctx) => (isRef(args[0]) ? ctx.host.hasFormula(args[0].sheet, args[0].r1, args[0].c1) : VALUE),
  },
};

