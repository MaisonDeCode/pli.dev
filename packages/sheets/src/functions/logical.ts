import { isError, NA, toBool, toNumber, VALUE, type Value } from "../values";
import { broadcast, isMulti, scalar } from "./helpers";
import type { Arg, FunctionDef } from "./types";

type Thunk = () => Arg;

export const logical: Record<string, FunctionDef> = {
  TRUE: { min: 0, max: 0, fn: () => true },
  FALSE: { min: 0, max: 0, fn: () => false },
  NOT: {
    min: 1,
    max: 1,
    fn: (args, ctx) =>
      broadcast([args[0]], ctx, ([v]) => {
        const b = toBool(v!);
        return isError(b) ? b : !b;
      }),
  },
  IF: {
    min: 2,
    max: 3,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      const test = args[0]!();
      if (isMulti(test)) {
        // Array form: pick item by item.
        const yes = args[1]!();
        const no = args[2] ? args[2]() : false;
        return broadcast([test, yes, no], ctx, ([t, y, n]) => {
          const b = toBool(t!);
          return isError(b) ? b : b ? y! : n!;
        });
      }
      const b = toBool(scalar(test, ctx));
      if (isError(b)) return b;
      if (b) return args[1]!();
      return args[2] ? args[2]() : false;
    },
  },
  IFS: {
    min: 2,
    max: 254,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      if (args.length % 2) return NA;
      for (let i = 0; i < args.length; i += 2) {
        const b = toBool(scalar(args[i]!(), ctx));
        if (isError(b)) return b;
        if (b) return args[i + 1]!();
      }
      return NA;
    },
  },
  IFERROR: {
    min: 2,
    max: 2,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      const v = args[0]!();
      if (isMulti(v)) return broadcast([v, args[1]!()], ctx, ([a, b]) => (isError(a!) ? b! : a!));
      const s = scalar(v, ctx);
      return isError(s) ? args[1]!() : s;
    },
  },
  IFNA: {
    min: 2,
    max: 2,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      const s = scalar(args[0]!(), ctx);
      return isError(s) && s.error === "#N/A" ? args[1]!() : s;
    },
  },
  SWITCH: {
    min: 3,
    max: 255,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      const target = scalar(args[0]!(), ctx);
      if (isError(target)) return target;
      const rest = args.length - 1;
      for (let i = 1; i + 1 < args.length; i += 2) {
        const candidate = scalar(args[i]!(), ctx);
        if (isError(candidate)) return candidate;
        if (equalValues(target, candidate)) return args[i + 1]!();
      }
      return rest % 2 === 1 ? args[args.length - 1]!() : NA;
    },
  },
  CHOOSE: {
    min: 2,
    max: 255,
    lazy: true,
    fn: (args: Thunk[], ctx) => {
      const n = toNumber(scalar(args[0]!(), ctx));
      if (isError(n)) return n;
      const k = Math.floor(n);
      if (k < 1 || k >= args.length) return VALUE;
      return args[k]!();
    },
  },
};

function equalValues(a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  return a === b || (a === null && (b === 0 || b === "")) || (b === null && (a === 0 || a === ""));
}

