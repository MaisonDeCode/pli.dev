import { formatValue } from "../format";
import { isError, parseNumber, toNumber, toText, VALUE, type Value } from "../values";
import { eachValue, scalar, simple, toGrid, wildcardRegExp } from "./helpers";
import type { Arg, FunctionDef } from "./types";

const txt = (v: Value): string => toText(v) as string;
const int = (v: Value | undefined, fallback: number): number | null => {
  if (v === undefined || v === null) return fallback;
  const n = toNumber(v);
  return isError(n) ? null : Math.trunc(n);
};

export const text: Record<string, FunctionDef> = {
  LEN: simple(1, 1, ([v]) => txt(v!).length),
  LEFT: simple(1, 2, ([s, n]) => {
    const k = int(n, 1);
    return k === null || k < 0 ? VALUE : txt(s!).slice(0, k);
  }),
  RIGHT: simple(1, 2, ([s, n]) => {
    const k = int(n, 1);
    const t = txt(s!);
    return k === null || k < 0 ? VALUE : k === 0 ? "" : t.slice(-k);
  }),
  MID: simple(3, 3, ([s, start, n]) => {
    const a = int(start, 1);
    const k = int(n, 0);
    return a === null || k === null || a < 1 || k < 0 ? VALUE : txt(s!).slice(a - 1, a - 1 + k);
  }),
  UPPER: simple(1, 1, ([v]) => txt(v!).toUpperCase()),
  LOWER: simple(1, 1, ([v]) => txt(v!).toLowerCase()),
  PROPER: simple(1, 1, ([v]) => txt(v!).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())),
  TRIM: simple(1, 1, ([v]) => txt(v!).replace(/ +/g, " ").replace(/^ | $/g, "")),
  CLEAN: simple(1, 1, ([v]) => txt(v!).replace(/[\u0000-\u001f]/g, "")),
  EXACT: simple(2, 2, ([a, b]) => txt(a!) === txt(b!)),
  REPT: simple(2, 2, ([s, n]) => {
    const k = int(n, 0);
    const t = txt(s!);
    return k === null || k < 0 || t.length * k > 32767 ? VALUE : t.repeat(k);
  }),
  CHAR: simple(1, 1, ([v]) => {
    const n = int(v, 0);
    return n === null || n < 1 || n > 255 ? VALUE : String.fromCharCode(n);
  }),
  CODE: simple(1, 1, ([v]) => (txt(v!) === "" ? VALUE : txt(v!).charCodeAt(0))),
  UNICHAR: simple(1, 1, ([v]) => {
    const n = int(v, 0);
    return n === null || n < 1 || n > 0x10ffff ? VALUE : String.fromCodePoint(n);
  }),
  UNICODE: simple(1, 1, ([v]) => (txt(v!) === "" ? VALUE : txt(v!).codePointAt(0)!)),
  FIND: simple(2, 3, ([find, within, start]) => {
    const from = int(start, 1);
    const hay = txt(within!);
    if (from === null || from < 1 || from > hay.length + 1) return VALUE;
    const at = hay.indexOf(txt(find!), from - 1);
    return at < 0 ? VALUE : at + 1;
  }),
  SEARCH: simple(2, 3, ([find, within, start]) => {
    const from = int(start, 1);
    const hay = txt(within!);
    if (from === null || from < 1 || from > hay.length + 1) return VALUE;
    const needle = txt(find!);
    const re = new RegExp(wildcardRegExp(needle).source.slice(1, -1), "i");
    const m = re.exec(hay.slice(from - 1));
    return m ? m.index + from : VALUE;
  }),
  SUBSTITUTE: simple(3, 4, ([s, old, replacement, instance]) => {
    const t = txt(s!);
    const o = txt(old!);
    const r = txt(replacement!);
    if (o === "") return t;
    if (instance === undefined || instance === null) return t.split(o).join(r);
    const k = int(instance, 0);
    if (k === null || k < 1) return VALUE;
    let at = -1;
    for (let i = 0; i < k; i++) {
      at = t.indexOf(o, at + 1);
      if (at < 0) return t;
    }
    return t.slice(0, at) + r + t.slice(at + o.length);
  }),
  REPLACE: simple(4, 4, ([s, start, n, replacement]) => {
    const a = int(start, 1);
    const k = int(n, 0);
    if (a === null || k === null || a < 1 || k < 0) return VALUE;
    const t = txt(s!);
    return t.slice(0, a - 1) + txt(replacement!) + t.slice(a - 1 + k);
  }),
  VALUE: simple(1, 1, ([v]) => {
    if (typeof v === "number") return v;
    const n = parseNumber(txt(v!));
    return n === null ? VALUE : n;
  }),
  NUMBERVALUE: simple(1, 3, ([v, dec, grp]) => {
    let t = txt(v!).replace(/\s/g, "");
    const d = dec === undefined || dec === null ? "." : txt(dec);
    const g = grp === undefined || grp === null ? "," : txt(grp);
    if (g) t = t.split(g).join("");
    if (d !== ".") t = t.split(d).join(".");
    const n = parseNumber(t);
    return n === null ? VALUE : n;
  }),
  TEXT: simple(2, 2, ([v, fmt]) => {
    let value: Value = v!;
    if (typeof value === "string") {
      const n = parseNumber(value);
      if (n !== null) value = n;
    }
    return formatValue(value, txt(fmt!)).text;
  }),
  FIXED: simple(1, 3, ([v, d, noCommas]) => {
    const n = toNumber(v!);
    if (isError(n)) return n;
    const places = int(d, 2);
    if (places === null) return VALUE;
    const digits = Math.max(places, 0);
    return formatValue(n, `${noCommas === true ? "0" : "#,##0"}${digits > 0 ? "." + "0".repeat(digits) : ""}`).text;
  }),
  DOLLAR: simple(1, 2, ([v, d]) => {
    const n = toNumber(v!);
    if (isError(n)) return n;
    const places = int(d, 2);
    if (places === null) return VALUE;
    const f = `$#,##0${places > 0 ? "." + "0".repeat(places) : ""}`;
    return formatValue(n, `${f};($${f.slice(1)})`).text;
  }),
  CONCATENATE: simple(1, 255, (vs) => vs.map(txt).join("")),
  CONCAT: {
    min: 1,
    max: 255,
    fn: (args: Arg[], ctx) => {
      let out = "";
      let error: Value | undefined;
      for (const a of args) {
        eachValue(a, ctx, (v) => {
          if (isError(v)) error ??= v;
          else out += txt(v);
        });
      }
      return error ?? out;
    },
  },
  TEXTJOIN: {
    min: 3,
    max: 255,
    fn: (args: Arg[], ctx) => {
      const sep = txt(scalar(args[0]!, ctx));
      const skip = scalar(args[1]!, ctx);
      const ignoreEmpty = skip === true || (typeof skip === "number" && skip !== 0);
      const parts: string[] = [];
      let error: Value | undefined;
      for (const a of args.slice(2)) {
        const grid = toGrid(a, ctx);
        for (const row of grid)
          for (const v of row) {
            if (isError(v)) error ??= v;
            else {
              const t = txt(v);
              if (!(ignoreEmpty && t === "")) parts.push(t);
            }
          }
      }
      return error ?? parts.join(sep);
    },
  },
};

