import type { ErrorBars } from "./model";

/*
 * The arithmetic behind a series' error bars, apart from drawing. Each point gets an amount to add (`plus`) and an amount to
 * take away (`minus`); the bar runs from `value - minus` to `value + plus`.
 *
 * The standard deviation bars use the population standard deviation (STDEV.P) and the standard error bars the sample
 * standard error (STDEV.S over the square root of the count); that is how Excel is described to work, but it has not been
 * checked against Excel itself (kit file 31 asks for it).
 */

export interface ErrorBarData {
  /** One amount for each point: 0 where a side isn't drawn, null where the point has no value. */
  plus: (number | null)[];
  minus: (number | null)[];
  /** The little cross-line at the end of each bar. */
  endCap: boolean;
  color?: string;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The standard deviation of the numbers in `values` (population: divides by n), 0 for fewer than 1. */
export function populationSd(values: readonly (number | null)[]): number {
  const v = values.filter(finite);
  if (!v.length) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

/** The standard error of the mean of `values`: sqrt(sum of squared deviations / (n (n - 1))). */
export function standardError(values: readonly (number | null)[]): number {
  const v = values.filter(finite);
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length * (v.length - 1)));
}

/**
 * Works out the amounts for each point of a series. `values` are the numbers the bars hang from; `amounts` reads the cells a
 * custom bar refers to (it is given the reference and gives the numbers).
 */
export function errorBarAmounts(spec: ErrorBars, values: readonly (number | null)[], amounts: (ref: string | undefined) => (number | null)[] | undefined): ErrorBarData {
  const n = values.length;
  const sides = spec.direction ?? "both";
  const each = (f: (v: number, k: number) => number): number[] => values.map((v, k) => (finite(v) ? f(v, k) : 0));
  let plus: number[];
  let minus: number[];
  switch (spec.kind) {
    case "fixed": {
      const a = Math.abs(spec.value ?? 1);
      plus = minus = each(() => a);
      break;
    }
    case "percent": {
      const p = Math.abs(spec.value ?? 5) / 100;
      plus = minus = each((v) => Math.abs(v) * p);
      break;
    }
    case "stdDev": {
      const a = Math.abs(spec.value ?? 1) * populationSd(values);
      plus = minus = each(() => a);
      break;
    }
    case "stdErr": {
      const a = standardError(values);
      plus = minus = each(() => a);
      break;
    }
    default: {
      const side = (given: string | number[] | undefined): number[] => {
        if (given === undefined) return values.map(() => 0);
        const list = typeof given === "string" ? amounts(given) ?? [] : given;
        // One number is the amount for every point.
        return values.map((_, k) => Math.abs((list.length === 1 ? list[0] : list[k]) ?? 0));
      };
      plus = side(spec.plus);
      minus = side(spec.minus);
    }
  }
  return {
    plus: Array.from({ length: n }, (_, k) => (finite(values[k]) ? (sides === "minus" ? 0 : plus[k]!) : null)),
    minus: Array.from({ length: n }, (_, k) => (finite(values[k]) ? (sides === "plus" ? 0 : minus[k]!) : null)),
    endCap: spec.endCap !== false,
    ...(spec.color ? { color: spec.color } : {}),
  };
}
