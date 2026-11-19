import { TemplateError, asDate, truthy, type FilterContext, type TemplateFilter } from "./expression";

/** How a value reads in the text when no filter says otherwise. Returns `undefined` for a value that isn't one (nothing was answered). */
export function display(value: unknown, context: FilterContext): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return formatDate(value, "long", context);
  if (Array.isArray(value)) {
    const parts = value.map((v) => display(v, context)).filter((v): v is string => v !== undefined && v !== "");
    return parts.join(", ");
  }
  throw new TemplateError("type", "This is a group of answers, not a single value. Name one of its fields, like {{ client.name }}.");
}

const num = (value: unknown, what = "a number"): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  throw new TemplateError("type", `"${typeof value === "string" ? value : typeof value}" is not ${what}`);
};

const gone = (value: unknown) => value === undefined || value === null;

const textOf = (value: unknown, context: FilterContext): string | undefined => (gone(value) ? undefined : (display(value, context) ?? undefined));

function formatDate(date: Date, style: string, context: FilterContext): string {
  const base = { timeZone: context.timeZone } as Intl.DateTimeFormatOptions;
  const pick = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(context.locale, { ...base, ...options }).format(date);
  switch (style) {
    case "iso": {
      const two = (n: number) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    }
    case "full":
    case "long":
    case "medium":
    case "short":
      return pick({ dateStyle: style });
    case "year":
      return pick({ year: "numeric" });
    case "month":
      return pick({ month: "long" });
    case "monthYear":
      return pick({ month: "long", year: "numeric" });
    case "day":
      return pick({ day: "numeric" });
    case "weekday":
      return pick({ weekday: "long" });
    case "time":
      return pick({ timeStyle: "short" });
    default:
      throw new TemplateError("filter", `date: "${style}" is not a style. Use full, long, medium, short, iso, year, month, monthYear, day, weekday or time`);
  }
}

function ordinal(n: number, locale: string | undefined): string {
  if (locale && !locale.toLowerCase().startsWith("en")) return String(n);
  const rest = Math.abs(n) % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[Math.abs(n) % 10] ?? "th";
  return `${n}${suffix}`;
}

const items = (value: unknown): unknown[] | undefined => (gone(value) ? undefined : Array.isArray(value) ? value : [value]);

function field(item: unknown, key: unknown): unknown {
  if (typeof key !== "string" || item === null || typeof item !== "object") return undefined;
  let value: unknown = item;
  for (const part of key.split(".")) {
    if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function sentence(list: string[], conjunction: string): string {
  if (list.length <= 1) return list.join("");
  if (list.length === 2) return `${list[0]} ${conjunction} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, ${conjunction} ${list[list.length - 1]}`;
}

const asString = (v: unknown, fallback: string) => (typeof v === "string" ? v : v === undefined ? fallback : String(v));

/** The filters every template has. Add your own with the `filters` option. */
export const BUILT_IN_FILTERS: Record<string, TemplateFilter> = {
  // text
  upper: (v, _a, c) => textOf(v, c)?.toUpperCase(),
  lower: (v, _a, c) => textOf(v, c)?.toLowerCase(),
  title: (v, _a, c) => textOf(v, c)?.toLowerCase().replace(/(^|[\s\-(])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase()),
  capitalize: (v, _a, c) => {
    const t = textOf(v, c);
    return t === undefined ? undefined : t.charAt(0).toUpperCase() + t.slice(1);
  },
  trim: (v, _a, c) => textOf(v, c)?.trim(),
  truncate: (v, [n], c) => {
    const t = textOf(v, c);
    if (t === undefined) return undefined;
    const max = num(n ?? 80, "a length");
    return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  },
  replace: (v, [from, to], c) => textOf(v, c)?.split(asString(from, "")).join(asString(to, "")),
  initials: (v, _a, c) =>
    textOf(v, c)
      ?.split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .join(""),

  // when there is no answer
  default: (v, [fallback], c) => (gone(v) || textOf(v, c) === "" ? fallback : v),

  // numbers
  number: (v, [digits], c) => {
    if (gone(v) || v === "") return undefined;
    const d = digits === undefined ? undefined : num(digits, "a number of digits");
    return new Intl.NumberFormat(c.locale, d === undefined ? { maximumFractionDigits: 3 } : { minimumFractionDigits: d, maximumFractionDigits: d }).format(num(v));
  },
  currency: (v, [code, digits], c) => {
    if (gone(v) || v === "") return undefined;
    const currency = asString(code, c.currency).toUpperCase();
    const d = digits === undefined ? undefined : num(digits, "a number of digits");
    try {
      return new Intl.NumberFormat(c.locale, { style: "currency", currency, ...(d !== undefined && { minimumFractionDigits: d, maximumFractionDigits: d }) }).format(num(v));
    } catch (error) {
      if (error instanceof TemplateError) throw error;
      throw new TemplateError("filter", `currency: "${currency}" is not a currency code`);
    }
  },
  percent: (v, [digits], c) => {
    if (gone(v) || v === "") return undefined;
    const d = digits === undefined ? 0 : num(digits, "a number of digits");
    return new Intl.NumberFormat(c.locale, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(num(v));
  },
  round: (v, [digits]) => {
    if (gone(v) || v === "") return undefined;
    const f = 10 ** (digits === undefined ? 0 : num(digits, "a number of digits"));
    return Math.round(num(v) * f) / f;
  },
  ordinal: (v, _a, c) => (gone(v) || v === "" ? undefined : ordinal(num(v), c.locale)),
  plural: (v, [one, many]) => {
    if (gone(v)) return undefined;
    const n = Array.isArray(v) ? v.length : num(v);
    return n === 1 ? asString(one, "") : asString(many, `${asString(one, "")}s`);
  },

  // dates
  date: (v, [style], c) => {
    if (gone(v) || v === "") return undefined;
    const d = asDate(v);
    if (!d) throw new TemplateError("type", `"${typeof v === "string" ? v : typeof v}" is not a date. Write it as 2026-11-18`);
    return formatDate(d, asString(style, "long"), c);
  },

  // yes / no
  yesno: (v, [yes, no]) => (truthy(v) ? asString(yes, "Yes") : asString(no, "No")),

  // lists
  join: (v, [separator], c) => items(v)?.map((x) => textOf(x, c)).filter((x): x is string => !!x).join(asString(separator, ", ")),
  sentence: (v, [conjunction], c) =>
    sentence(
      (items(v) ?? []).map((x) => textOf(x, c)).filter((x): x is string => !!x),
      asString(conjunction, "and"),
    ) || undefined,
  first: (v) => (Array.isArray(v) ? v[0] : v),
  last: (v) => (Array.isArray(v) ? v[v.length - 1] : v),
  length: (v) => (gone(v) ? 0 : Array.isArray(v) || typeof v === "string" ? v.length : 1),
  pluck: (v, [key]) => items(v)?.map((x) => field(x, key)).filter((x) => !gone(x)),
  sum: (v, [key]) => {
    const list = items(v);
    if (!list) return undefined;
    return list.reduce<number>((total, x) => {
      const n = key === undefined ? x : field(x, key);
      return gone(n) || n === "" ? total : total + num(n);
    }, 0);
  },
  sort: (v, [key]) => {
    const list = items(v);
    if (!list) return undefined;
    const by = (x: unknown) => (key === undefined ? x : field(x, key));
    return list.slice().sort((a, b) => {
      const x = by(a);
      const y = by(b);
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x ?? "").localeCompare(String(y ?? ""));
    });
  },
  reverse: (v) => items(v)?.slice().reverse(),
};
