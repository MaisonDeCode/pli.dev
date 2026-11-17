import { isError, REF, toText, VALUE } from "../values";
import { isRef, scalar } from "./helpers";
import type { Arg, FunctionDef } from "./types";

export const pivot: Record<string, FunctionDef> = {
  GETPIVOTDATA: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      if (args.length % 2 !== 0) return VALUE;
      const data = scalar(args[0] as Arg, ctx);
      if (isError(data)) return data;
      const at = args[1];
      if (!isRef(at)) return REF;
      const pairs: [string, ReturnType<typeof scalar>][] = [];
      for (let i = 2; i < args.length; i += 2) {
        const field = scalar(args[i] as Arg, ctx);
        const item = scalar(args[i + 1] as Arg, ctx);
        if (isError(field)) return field;
        if (isError(item)) return item;
        pairs.push([String(toText(field)), item]);
      }
      return ctx.host.pivotData(at.sheet, at.r1, at.c1, String(toText(data)), pairs);
    },
  },
};
