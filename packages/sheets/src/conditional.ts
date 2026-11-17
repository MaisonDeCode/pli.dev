import { cellAddress, parseCell, type Bounds } from "./address";
import type { Calculator } from "./calc";
import type { CellBorders, CfValue, ConditionalRule, ConditionalStyle, DatePeriod, IconSetName, Sheet } from "./model";
import { ICON_SETS, BORDER_LINES, ruleBounds } from "./rule";
import { shiftFormula } from "./refs";
import { compareValues, dateSerial, isError, serialDate, type Value } from "./values";

/**
 * What the conditional formats of a sheet do to one cell: a style over the cell's own, a colour from a scale, a bar, an
 * icon. `scale` goes under a `style` fill.
 */
export interface CellEffect {
  style?: ConditionalStyle;
  /** `#rrggbb` from a colour scale. */
  scale?: string;
  /** A bar from `from` to `to`, as fractions (0 to 1) of the cell's width, with where the zero line is if one is drawn. */
  bar?: { from: number; to: number; color: string; solid?: true; border?: true; /** The border's colour, when the rule gives one. */ borderColor?: string; axis?: number; axisColor?: string; /** The bar grows from the right. */ rtl?: true };
  /** The icon at `index` (0 is the first) of a set with `count` icons. */
  icon?: { set: IconSetName; index: number; count: number };
  /** The value is hidden: only the bar or icon shows. */
  hideText?: true;
}

interface Stats {
  /** Numbers in the rule's ranges, lowest first. */
  numbers: number[];
  /** For duplicates and uniques: how many times each value is there. */
  counts?: Map<string, number>;
}

const MAX_SCAN = 100_000;

const inAny = (bs: readonly Bounds[], row: number, col: number) => bs.some((b) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2);

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

function mix(c1: string, c2: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + [0, 1, 2].map((i) => hex(lerp(p(c1, i), p(c2, i), t))).join("");
}

/** The value at a rank among sorted numbers, as `PERCENTILE.INC` gives it (`p` from 0 to 1). */
function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (k - lo);
}

const keyOf = (v: Value): string | null => (v === null || isError(v) ? null : typeof v === "string" ? (v === "" ? null : "s" + v.toLowerCase()) : typeof v === "number" ? "n" + v : "b" + v);

/** The first and last day of a period counted from `today` (a whole serial number). */
export function periodDays(period: DatePeriod, today: number): [number, number] {
  const weekStart = today - serialDate(today).weekday;
  const monthOf = (offset: number): [number, number] => {
    const d = serialDate(today);
    const first = dateSerial(d.year, d.month + offset, 1) ?? today;
    const next = dateSerial(d.year, d.month + offset + 1, 1) ?? first + 30;
    return [first, next - 1];
  };
  switch (period) {
    case "yesterday": return [today - 1, today - 1];
    case "today": return [today, today];
    case "tomorrow": return [today + 1, today + 1];
    case "last7Days": return [today - 6, today];
    case "lastWeek": return [weekStart - 7, weekStart - 1];
    case "thisWeek": return [weekStart, weekStart + 6];
    case "nextWeek": return [weekStart + 7, weekStart + 13];
    case "lastMonth": return monthOf(-1);
    case "thisMonth": return monthOf(0);
    case "nextMonth": return monthOf(1);
  }
}

function mergeBorders(into: CellBorders | undefined, from: CellBorders): CellBorders {
  const out: CellBorders = { ...into };
  for (const side of BORDER_LINES) if (from[side] && !out[side]) out[side] = from[side];
  return out;
}

/**
 * Works out conditional formats. Results are kept until `invalidate` is called (when the workbook changes), and
 * what a rule needs to know about all its cells (the highest value, the average…) is worked out once for all of them.
 */
export class ConditionalFormats {
  readonly #calc: Calculator;
  #effects = new Map<string, CellEffect | null>();
  #stats = new Map<string, Stats>();
  #operands = new Map<string, Value>();
  #bounds = new WeakMap<ConditionalRule, { all: Bounds[]; origin: { row: number; col: number } }>();

  constructor(calc: Calculator) {
    this.#calc = calc;
  }

  invalidate(): void {
    this.#effects.clear();
    this.#stats.clear();
    this.#operands.clear();
  }

  /** What the sheet's rules do to the cell, or undefined when none applies. */
  effect(sheet: Sheet, row: number, col: number): CellEffect | undefined {
    if (!sheet.conditional?.length) return undefined;
    const k = `${sheet.id}|${row}|${col}`;
    const hit = this.#effects.get(k);
    if (hit !== undefined) return hit ?? undefined;
    const e = this.#work(sheet, row, col);
    this.#effects.set(k, e ?? null);
    return e;
  }

  #geometry(rule: ConditionalRule) {
    let g = this.#bounds.get(rule);
    if (!g) {
      const all = ruleBounds(rule.ranges);
      g = { all, origin: { row: Math.min(...all.map((b) => b.r1)), col: Math.min(...all.map((b) => b.c1)) } };
      this.#bounds.set(rule, g);
    }
    return g;
  }

  #work(sheet: Sheet, row: number, col: number): CellEffect | undefined {
    const out: CellEffect = {};
    const value = this.#calc.value(sheet.id, cellAddress(row, col));
    for (const rule of sheet.conditional!) {
      const g = this.#geometry(rule);
      if (!inAny(g.all, row, col)) continue;
      let hit = false;
      switch (rule.kind) {
        case "colorScale": {
          hit = true;
          if (out.scale === undefined) {
            const c = this.#scale(sheet, rule, value);
            if (c) out.scale = c;
          }
          break;
        }
        case "dataBar": {
          hit = true;
          if (!out.bar) {
            const bar = this.#bar(sheet, rule, value);
            if (bar) {
              out.bar = bar;
              if (rule.hideValue) out.hideText = true;
            }
          }
          break;
        }
        case "iconSet": {
          hit = true;
          if (!out.icon) {
            const index = this.#icon(sheet, rule, value);
            if (index !== null) {
              const slot = rule.reverse ? ICON_SETS[rule.set] - 1 - index : index;
              // Your own icons replace the set's: the one chosen for the slot, or none.
              const own = rule.custom ? rule.custom[slot] : undefined;
              if (rule.custom && own) out.icon = { set: own.set, index: own.index, count: ICON_SETS[own.set] };
              else if (!rule.custom) out.icon = { set: rule.set, index: slot, count: ICON_SETS[rule.set] };
              if (rule.hideValue) out.hideText = true;
            }
          }
          break;
        }
        default:
          hit = this.#matches(sheet, rule, row, col, value);
          if (hit) {
            const style: ConditionalStyle = { ...out.style };
            for (const [key, v] of Object.entries(rule.style)) {
              if (key === "border") style.border = mergeBorders(style.border, v as CellBorders);
              else if (!(key in style)) (style as Record<string, unknown>)[key] = v;
            }
            out.style = style;
          }
      }
      if (hit && rule.stop) break;
    }
    return out.style || out.scale || out.bar || out.icon ? out : undefined;
  }

  // ---- what a rule knows about all its cells ----

  #stat(sheet: Sheet, rule: ConditionalRule, counting: boolean): Stats {
    const k = `${sheet.id}|${rule.id}`;
    let s = this.#stats.get(k);
    if (s && (!counting || s.counts)) return s;
    const numbers: number[] = [];
    const counts = counting ? new Map<string, number>() : undefined;
    const used = this.#calc.usedBounds(sheet.id);
    if (used) {
      const seen = new Set<number>();
      for (const b of this.#geometry(rule).all) {
        const r1 = Math.max(b.r1, used.r1);
        const r2 = Math.min(b.r2, used.r2);
        const c1 = Math.max(b.c1, used.c1);
        const c2 = Math.min(b.c2, used.c2);
        if (r1 > r2 || c1 > c2) continue;
        const take = (r: number, c: number, v: Value) => {
          const id = r * 16385 + c;
          if (seen.has(id)) return;
          seen.add(id);
          if (typeof v === "number") numbers.push(v);
          if (counts) {
            const key = keyOf(v);
            if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        };
        if ((r2 - r1 + 1) * (c2 - c1 + 1) <= MAX_SCAN) {
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) take(r, c, this.#calc.value(sheet.id, cellAddress(r, c)));
        } else {
          for (const address of Object.keys(sheet.cells)) {
            const p = parseCell(address)!;
            if (p.row >= r1 && p.row <= r2 && p.col >= c1 && p.col <= c2) take(p.row, p.col, this.#calc.value(sheet.id, address));
          }
        }
      }
    }
    numbers.sort((a, b) => a - b);
    s = { numbers, ...(counts ? { counts } : {}) };
    this.#stats.set(k, s);
    return s;
  }

  /** What a point of a scale, bar or icon set stands for, as a number. */
  #point(sheet: Sheet, rule: ConditionalRule, p: CfValue): number | null {
    const { numbers } = this.#stat(sheet, rule, false);
    switch (p.type) {
      case "min":
        return numbers.length ? numbers[0]! : null;
      case "max":
        return numbers.length ? numbers[numbers.length - 1]! : null;
      case "num":
        return typeof p.value === "number" ? p.value : null;
      case "percent":
        return numbers.length ? numbers[0]! + (numbers[numbers.length - 1]! - numbers[0]!) * (Number(p.value) / 100) : null;
      case "percentile":
        return numbers.length ? percentile(numbers, Number(p.value) / 100) : null;
      case "formula": {
        const o = this.#geometry(rule).origin;
        const v = this.#calc.evaluateAt(sheet.id, o.row, o.col, String(p.value));
        return typeof v === "number" ? v : null;
      }
      case "auto":
        // Only the ends of a data bar are automatic, and `#bar` works them out.
        return null;
    }
  }

  #scale(sheet: Sheet, rule: Extract<ConditionalRule, { kind: "colorScale" }>, value: Value): string | undefined {
    if (typeof value !== "number") return undefined;
    const at = rule.stops.map((s) => this.#point(sheet, rule, s));
    if (at.some((a) => a === null)) return undefined;
    const pts = at as number[];
    const last = pts.length - 1;
    if (value <= pts[0]!) return rule.stops[0]!.color;
    if (value >= pts[last]!) return rule.stops[last]!.color;
    for (let i = 0; i < last; i++) {
      if (value >= pts[i]! && value <= pts[i + 1]!) return pts[i + 1] === pts[i] ? rule.stops[i + 1]!.color : mix(rule.stops[i]!.color, rule.stops[i + 1]!.color, (value - pts[i]!) / (pts[i + 1]! - pts[i]!));
    }
    return undefined;
  }

  #bar(sheet: Sheet, rule: Extract<ConditionalRule, { kind: "dataBar" }>, value: Value): CellEffect["bar"] | undefined {
    const bar = this.#barLeft(sheet, rule, value);
    if (!bar || !rule.rtl) return bar;
    // Bars that grow from the right are the same bars turned about the middle of the cell.
    return { ...bar, from: 1 - bar.to, to: 1 - bar.from, rtl: true, ...(bar.axis !== undefined ? { axis: 1 - bar.axis } : {}) };
  }

  #barLeft(sheet: Sheet, rule: Extract<ConditionalRule, { kind: "dataBar" }>, value: Value): CellEffect["bar"] | undefined {
    if (typeof value !== "number") return undefined;
    // Automatic ends: zero, unless the numbers lie below it.
    const { numbers } = this.#stat(sheet, rule, false);
    const lo = rule.min.type === "auto" ? (numbers.length ? Math.min(0, numbers[0]!) : null) : this.#point(sheet, rule, rule.min);
    const hi = rule.max.type === "auto" ? (numbers.length ? Math.max(0, numbers[numbers.length - 1]!) : null) : this.#point(sheet, rule, rule.max);
    if (lo === null || hi === null || !(hi > lo)) return undefined;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const at = (n: number) => clamp((n - lo) / (hi - lo));
    const minL = (rule.minLength ?? 0) / 100;
    const maxL = (rule.maxLength ?? 100) / 100;
    const edge = value < 0 ? rule.negativeBorderColor ?? rule.borderColor : rule.borderColor;
    const look = { ...(rule.solid ? { solid: true as const } : {}), ...(rule.border ? { border: true as const, ...(edge ? { borderColor: edge } : {}) } : {}) };
    const color = value < 0 && rule.negativeColor ? rule.negativeColor : rule.color;
    const axisColor = rule.axisColor ? { axisColor: rule.axisColor } : {};
    if (rule.axis === "none") {
      // No zero line: every bar grows from the left, the negative ones in their own colour.
      return { from: 0, to: minL + (maxL - minL) * at(value), color, ...look };
    }
    if (rule.axis === "middle") {
      // Zero in the middle of the cell: positive bars go right and negative ones left, on one scale.
      const reach = Math.max(Math.abs(lo), Math.abs(hi));
      const half = 0.5 * clamp(Math.abs(value) / reach);
      return { from: value < 0 ? 0.5 - half : 0.5, to: value < 0 ? 0.5 : 0.5 + half, color, axis: 0.5, ...axisColor, ...look };
    }
    if (lo < 0) {
      // Zero falls inside the scale: bars grow from it, to the right for positive numbers and the left for negative ones.
      const a = at(0);
      const f = at(value);
      return { from: Math.min(a, f), to: Math.max(a, f), color, axis: a, ...axisColor, ...look };
    }
    // Bars grow from the left edge, the lowest as long as `minLength` and the highest as `maxLength`.
    return { from: 0, to: minL + (maxL - minL) * at(value), color, ...look };
  }

  #icon(sheet: Sheet, rule: Extract<ConditionalRule, { kind: "iconSet" }>, value: Value): number | null {
    if (typeof value !== "number") return null;
    for (let i = rule.thresholds.length; i >= 1; i--) {
      const t = rule.thresholds[i - 1]!;
      const at = this.#point(sheet, rule, t);
      if (at === null) continue;
      if (t.gte === false ? value > at : value >= at) return i;
    }
    return 0;
  }

  // ---- rules that say yes or no ----

  #operand(sheet: Sheet, rule: ConditionalRule, index: number, formula: string, row: number, col: number): Value {
    const o = this.#geometry(rule).origin;
    const k = `${sheet.id}|${rule.id}|${index}|${row - o.row}|${col - o.col}`;
    let v = this.#operands.get(k);
    if (v === undefined) {
      let f = formula;
      try {
        f = shiftFormula(formula, row - o.row, col - o.col);
      } catch {
        // an unreadable formula is worked out as it is, and gives an error
      }
      v = this.#calc.evaluateAt(sheet.id, row, col, f);
      this.#operands.set(k, v);
    }
    return v;
  }

  #matches(sheet: Sheet, rule: Exclude<ConditionalRule, { kind: "colorScale" | "dataBar" | "iconSet" }>, row: number, col: number, value: Value): boolean {
    switch (rule.kind) {
      case "cell": {
        if (isError(value)) return false;
        const a = this.#operand(sheet, rule, 0, rule.values[0]!, row, col);
        if (isError(a)) return false;
        const c = compareValues(value, a);
        switch (rule.op) {
          case "greaterThan": return c > 0;
          case "greaterThanOrEqual": return c >= 0;
          case "lessThan": return c < 0;
          case "lessThanOrEqual": return c <= 0;
          case "equal": return c === 0;
          case "notEqual": return c !== 0;
          case "between":
          case "notBetween": {
            const b = this.#operand(sheet, rule, 1, rule.values[1]!, row, col);
            if (isError(b)) return false;
            const inside = compareValues(value, a) >= 0 && compareValues(value, b) <= 0;
            return rule.op === "between" ? inside : !inside;
          }
        }
        return false;
      }
      case "text": {
        const shown = this.#calc.display(sheet.id, cellAddress(row, col)).text.toLowerCase();
        const needle = rule.text.toLowerCase();
        switch (rule.op) {
          case "contains": return shown.includes(needle);
          case "notContains": return !shown.includes(needle);
          case "beginsWith": return shown.startsWith(needle);
          case "endsWith": return shown.endsWith(needle);
        }
        return false;
      }
      case "formula": {
        const v = this.#operand(sheet, rule, 0, rule.formula, row, col);
        return v === true || (typeof v === "number" && v !== 0);
      }
      case "blanks":
        return value === null || (typeof value === "string" && value.trim() === "");
      case "noBlanks":
        return !(value === null || (typeof value === "string" && value.trim() === ""));
      case "errors":
        return isError(value);
      case "noErrors":
        return !isError(value);
      case "duplicates":
      case "uniques": {
        const key = keyOf(value);
        if (!key) return false;
        const n = this.#stat(sheet, rule, true).counts!.get(key) ?? 0;
        return rule.kind === "duplicates" ? n > 1 : n === 1;
      }
      case "top": {
        if (typeof value !== "number") return false;
        const { numbers } = this.#stat(sheet, rule, false);
        const count = rule.percent ? Math.max(1, Math.floor((numbers.length * rule.rank) / 100)) : Math.min(rule.rank, numbers.length);
        return rule.bottom ? value <= numbers[Math.min(count, numbers.length) - 1]! : value >= numbers[Math.max(0, numbers.length - count)]!;
      }
      case "average": {
        if (typeof value !== "number") return false;
        const { numbers } = this.#stat(sheet, rule, false);
        if (!numbers.length) return false;
        const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        let at = avg;
        if (rule.stdDev) {
          const sd = numbers.length > 1 ? Math.sqrt(numbers.reduce((a, b) => a + (b - avg) ** 2, 0) / (numbers.length - 1)) : 0;
          at = avg + (rule.above ? 1 : -1) * rule.stdDev * sd;
        }
        return rule.above ? (rule.equal ? value >= at : value > at) : rule.equal ? value <= at : value < at;
      }
      case "dates": {
        if (typeof value !== "number") return false;
        const [a, b] = periodDays(rule.period, Math.floor(this.#calc.now()));
        const day = Math.floor(value);
        return day >= a && day <= b;
      }
    }
  }
}
