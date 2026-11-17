import type { SparklineGroup } from "../model";
import { isError, toBool, toNumber, VALUE, type Value } from "../values";
import { COLOR_NAMES } from "./color-names";
import { toGrid } from "./helpers";
import type { Arg, FormulaSparkline, FunctionDef } from "./types";

/*
 * Google Sheets' `SPARKLINE(data, [options])`: a tiny chart in the cell the formula is in. The options are pairs of a name and a
 * value, written as an array (`{"charttype","column";"color","red"}`) or as two columns of cells. The cell itself is empty text;
 * the chart is drawn over it.
 */

/** A colour as Sheets takes it: a name or `#rgb` / `#rrggbb`. */
function color(v: Value): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (COLOR_NAMES[t]) return COLOR_NAMES[t];
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return undefined;
}

/** The pairs of options: rows of a name and a value, or one row of names and values in turn. */
function pairs(grid: Value[][]): [string, Value][] {
  const flat = grid.length === 1 && grid[0]!.length > 2 ? grid[0]! : null;
  if (flat) {
    const out: [string, Value][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push([String(flat[i]).toLowerCase(), flat[i + 1]!]);
    return out;
  }
  return grid.filter((row) => row.length >= 2 && typeof row[0] === "string").map((row) => [String(row[0]).toLowerCase(), row[1]!]);
}

export const sparklineFunctions: Record<string, FunctionDef> = {
  SPARKLINE: {
    min: 1,
    max: 2,
    fn: (args, ctx) => {
      const grid = toGrid(args[0] as Arg, ctx);
      // Two columns of several rows are the x and y of each point; anything else is a row or column of y.
      const paired = grid.length >= 2 && grid.every((row) => row.length === 2);
      const cells = paired ? grid.map((row) => row[1]!) : grid.flat();
      const xs: (number | null)[] | undefined = paired ? grid.map((row) => (typeof row[0] === "number" ? row[0] : null)) : undefined;
      const group: FormulaSparkline["group"] = { type: "line" };
      const flags: (keyof SparklineGroup)[] = [];
      let nan: "ignore" | "convert" = "ignore";
      let xmin: number | undefined;
      let xmax: number | undefined;
      let bar = false;
      let barMax: number | undefined;
      const barColors: string[] = [];
      if (args[1] !== undefined) {
        for (const [name, v] of pairs(toGrid(args[1] as Arg, ctx))) {
          const num = () => {
            const n = toNumber(v);
            return isError(n) ? undefined : n;
          };
          const on = () => {
            const b = toBool(v);
            return b === true;
          };
          const colored = (key: "color" | "negativeColor" | "highColor" | "lowColor" | "firstColor" | "lastColor" | "axisColor") => {
            const c = color(v);
            if (!c) return false;
            group[key] = c;
            return true;
          };
          switch (name) {
            case "charttype": {
              const t = String(v).toLowerCase();
              if (t === "line" || t === "column") group.type = t;
              else if (t === "winloss") group.type = "winloss";
              else if (t === "bar") {
                bar = true;
                group.type = "column";
              } else return VALUE;
              break;
            }
            case "color":
            case "color1":
              if (!colored("color")) return VALUE;
              barColors[0] = group.color as string;
              break;
            case "color2":
              if (!colored("negativeColor")) return VALUE;
              barColors[1] = group.negativeColor as string;
              flags.push("negative");
              break;
            case "negcolor":
              if (!colored("negativeColor")) return VALUE;
              flags.push("negative");
              break;
            case "highcolor":
              if (!colored("highColor")) return VALUE;
              flags.push("high");
              break;
            case "lowcolor":
              if (!colored("lowColor")) return VALUE;
              flags.push("low");
              break;
            case "firstcolor":
              if (!colored("firstColor")) return VALUE;
              flags.push("first");
              break;
            case "lastcolor":
              if (!colored("lastColor")) return VALUE;
              flags.push("last");
              break;
            case "axiscolor":
              if (!colored("axisColor")) return VALUE;
              break;
            case "axis":
              if (on()) group.showAxis = true;
              break;
            case "rtl":
              if (on()) group.rightToLeft = true;
              break;
            case "linewidth": {
              const w = num();
              if (w === undefined || w <= 0) return VALUE;
              group.lineWeight = Math.max(0.25, Math.min(6, w));
              break;
            }
            case "ymin": {
              const n = num();
              if (n === undefined) return VALUE;
              group.min = n;
              break;
            }
            case "ymax": {
              const n = num();
              if (n === undefined) return VALUE;
              group.max = n;
              break;
            }
            case "empty":
              if (String(v).toLowerCase() === "zero") group.emptyAs = "zero";
              break;
            case "nan":
              nan = String(v).toLowerCase() === "convert" ? "convert" : "ignore";
              break;
            case "xmin":
            case "xmax": {
              const n = num();
              if (n === undefined) return VALUE;
              if (name === "xmin") xmin = n;
              else xmax = n;
              break;
            }
            case "max":
              barMax = num();
              break;
            default: {
              // color3, color4… of a bar chart (more than two segments).
              const m = /^color(\d+)$/.exec(name);
              if (m && Number(m[1]) >= 3) {
                const c = color(v);
                if (!c) return VALUE;
                barColors[Number(m[1]) - 1] = c;
              }
              break;
            }
          }
        }
      }
      for (const f of flags) (group as Record<string, unknown>)[f] = true;
      if (typeof group.min === "number" && typeof group.max === "number" && group.min >= group.max) return VALUE;
      if (xmin !== undefined && xmax !== undefined && xmin >= xmax) return VALUE;
      // Text and the like: left out of the chart, or (`"nan","convert"`) counted as zero. Empty cells follow `empty`.
      const values: (number | null)[] = cells.map((v) => (typeof v === "number" ? v : v === null || nan === "ignore" ? null : 0));
      ctx.host.sparkline({
        values,
        group,
        ...(xs ? { xs } : {}),
        ...(xmin !== undefined ? { xmin } : {}),
        ...(xmax !== undefined ? { xmax } : {}),
        ...(bar ? { bar: { colors: Array.from({ length: Math.max(barColors.length, 1) }, (_, i) => barColors[i] ?? ""), ...(barMax !== undefined ? { max: barMax } : {}) } } : {}),
      });
      return "";
    },
  },
};
