import { arrayOf, isError, NA, toBool, toNumber, toText, VALUE, type Value } from "../values";
import { formatValue } from "../format";
import { scalar, simple, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

const txt = (v: Value): string => toText(v) as string;
const flag = (a: Arg | undefined, ctx: Ctx): boolean => a !== undefined && toBool(scalar(a, ctx)) === true;
const intArg = (a: Arg | undefined, ctx: Ctx, fallback: number): number | null => {
  if (a === undefined) return fallback;
  const v = scalar(a, ctx);
  if (v === null) return fallback;
  const n = toNumber(v);
  return isError(n) ? null : Math.trunc(n);
};

/** The delimiters of TEXTBEFORE, TEXTAFTER and TEXTSPLIT: one text or a list of them. */
function delimiters(a: Arg, ctx: Ctx): string[] {
  return toGrid(a, ctx).flat().map((v) => txt(v)).filter((s) => s !== "");
}

/** Finds the `instance`th delimiter in `text`: position and length, counting from the end when `instance` is negative. */
function findDelimiter(text: string, ds: string[], instance: number, ignoreCase: boolean): { at: number; len: number } | null {
  const hay = ignoreCase ? text.toLowerCase() : text;
  const found: { at: number; len: number }[] = [];
  for (let i = 0; i < hay.length; ) {
    let hit = 0;
    for (const d of ds) {
      const dd = ignoreCase ? d.toLowerCase() : d;
      if (hay.startsWith(dd, i) && dd.length > hit) hit = dd.length;
    }
    if (hit) {
      found.push({ at: i, len: hit });
      i += hit;
    } else i++;
  }
  const k = instance > 0 ? instance - 1 : found.length + instance;
  return found[k] ?? null;
}

function around(after: boolean): FunctionDef {
  return {
    min: 2,
    max: 6,
    fn: (args, ctx) => {
      const text = scalar(args[0] as Arg, ctx);
      if (isError(text)) return text;
      const ds = delimiters(args[1] as Arg, ctx);
      const instance = intArg(args[2] as Arg | undefined, ctx, 1);
      const mode = intArg(args[3] as Arg | undefined, ctx, 0);
      const matchEnd = intArg(args[4] as Arg | undefined, ctx, 0);
      if (instance === null || mode === null || matchEnd === null || instance === 0) return VALUE;
      const t = txt(text);
      if (ds.length === 0) return after ? t : "";
      const hit = findDelimiter(t, ds, instance, mode === 1);
      if (!hit) {
        if (matchEnd) return after ? "" : t;
        return args[5] === undefined ? NA : (args[5] as Value);
      }
      return after ? t.slice(hit.at + hit.len) : t.slice(0, hit.at);
    },
  };
}

function regexOf(pattern: Value, caseInsensitive: boolean): RegExp | null {
  try {
    return new RegExp(txt(pattern), caseInsensitive ? "iu" : "u");
  } catch {
    return null;
  }
}

export const text2: Record<string, FunctionDef> = {
  TEXTBEFORE: around(false),
  TEXTAFTER: around(true),
  TEXTSPLIT: {
    min: 2,
    max: 6,
    fn: (args, ctx) => {
      const text = scalar(args[0] as Arg, ctx);
      if (isError(text)) return text;
      const colDs = delimiters(args[1] as Arg, ctx);
      const rowDs = args[2] === undefined || scalar(args[2] as Arg, ctx) === null ? [] : delimiters(args[2] as Arg, ctx);
      const skipEmpty = flag(args[3] as Arg | undefined, ctx);
      const mode = intArg(args[4] as Arg | undefined, ctx, 0);
      if (mode === null) return VALUE;
      const pad = args[5] === undefined ? NA : scalar(args[5] as Arg, ctx);
      const split = (s: string, ds: string[]): string[] => {
        if (ds.length === 0) return [s];
        const parts: string[] = [];
        let from = 0;
        const hay = mode === 1 ? s.toLowerCase() : s;
        for (let i = 0; i < hay.length; ) {
          let hit = 0;
          for (const d of ds) if (hay.startsWith(mode === 1 ? d.toLowerCase() : d, i) && d.length > hit) hit = d.length;
          if (hit) {
            parts.push(s.slice(from, i));
            i += hit;
            from = i;
          } else i++;
        }
        parts.push(s.slice(from));
        return skipEmpty ? parts.filter((p) => p !== "") : parts;
      };
      const rows = split(txt(text), rowDs).map((r) => split(r, colDs));
      const w = Math.max(...rows.map((r) => r.length));
      return arrayOf(rows.map((r) => Array.from({ length: w }, (_, j) => (j < r.length ? r[j]! : pad))));
    },
  },
  VALUETOTEXT: simple(1, 2, ([v, format]) => {
    const strict = format !== undefined && format !== null && toNumber(format) === 1;
    if (isError(v!)) return v.error;
    if (typeof v === "string") return strict ? `"${v.replace(/"/g, '""')}"` : v;
    return formatValue(v!, undefined).text;
  }, { passErrors: true }),
  ARRAYTOTEXT: {
    min: 1,
    max: 2,
    fn: (args, ctx) => {
      const strict = args[1] !== undefined && toNumber(scalar(args[1] as Arg, ctx)) === 1;
      const g = toGrid(args[0] as Arg, ctx);
      const show = (v: Value) => (isError(v) ? v.error : typeof v === "string" ? (strict ? `"${v.replace(/"/g, '""')}"` : v) : formatValue(v, undefined).text);
      return strict ? `{${g.map((r) => r.map(show).join(",")).join(";")}}` : g.flat().map(show).join(", ");
    },
  },
  REGEXTEST: simple(2, 3, ([text, pattern, caseMode]) => {
    const re = regexOf(pattern!, caseMode !== undefined && caseMode !== null && toNumber(caseMode) === 1);
    return re ? re.test(txt(text!)) : VALUE;
  }),
  REGEXEXTRACT: {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const text = scalar(args[0] as Arg, ctx);
      const pattern = scalar(args[1] as Arg, ctx);
      if (isError(text)) return text;
      if (isError(pattern)) return pattern;
      const mode = intArg(args[2] as Arg | undefined, ctx, 0);
      const ci = intArg(args[3] as Arg | undefined, ctx, 0);
      if (mode === null || ci === null || mode < 0 || mode > 2) return VALUE;
      let re: RegExp;
      try {
        re = new RegExp(txt(pattern), (ci === 1 ? "iu" : "u") + (mode === 1 ? "g" : ""));
      } catch {
        return VALUE;
      }
      const t = txt(text);
      if (mode === 1) {
        const all = [...t.matchAll(re)].map((m) => [m[0]]);
        return all.length ? arrayOf(all) : NA;
      }
      const m = re.exec(t);
      if (!m) return NA;
      if (mode === 2) return m.length > 1 ? arrayOf([m.slice(1).map((x) => x ?? "")]) : NA;
      return m[0];
    },
  },
  REGEXREPLACE: simple(3, 5, ([text, pattern, replacement, occurrence, caseMode]) => {
    const ci = caseMode !== undefined && caseMode !== null && toNumber(caseMode) === 1;
    const which = occurrence === undefined || occurrence === null ? 0 : toNumber(occurrence);
    if (isError(which)) return which;
    let re: RegExp;
    try {
      re = new RegExp(txt(pattern!), (ci ? "iu" : "u") + (which === 0 ? "g" : ""));
    } catch {
      return VALUE;
    }
    const rep = txt(replacement!).replace(/\$(\d)/g, "$$$1");
    if (which === 0) return txt(text!).replace(re, rep);
    const target = which > 0 ? which : Infinity;
    const all = [...txt(text!).matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
    const pick = which > 0 ? all[target - 1] : all[all.length + which];
    if (!pick || pick.index === undefined) return txt(text!);
    return txt(text!).slice(0, pick.index) + pick[0].replace(new RegExp(re.source, re.flags.replace("g", "")), rep) + txt(text!).slice(pick.index + pick[0].length);
  }),
};

