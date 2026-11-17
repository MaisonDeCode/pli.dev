import { PliError } from "@pli.dev/core";
import type { Chart, ChartFont, ChartTitleRun, ChartType, ChartView3d, TrendlineLabel } from "./model";

/*
 * Checking for the chart options added last: the colours of single points, the fonts and titles in pieces of single axes, the
 * fonts of the legend and the data labels, how the series of a second kind pile up in a combined chart, 3-D spheres, the
 * perspective of a 3-D chart, and the label of a trendline. `cleanChart` calls these.
 */

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};
const COLOR = /^#[0-9a-fA-F]{6}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The kinds whose single points can have a colour of their own. */
export const POINT_COLOR_KINDS: readonly ChartType[] = ["column", "bar", "line", "scatter", "bubble", "pie", "doughnut", "pieOfPie", "barOfPie", "radar", "waterfall", "funnel", "treemap", "sunburst"];

/** The default angle of view of a 3-D chart, in degrees, and its depth as a percentage of its width. */
export const DEFAULT_PERSPECTIVE = 15;
export const DEFAULT_DEPTH = 100;

export function cleanChartFont(what: string, f: ChartFont | undefined): ChartFont | undefined {
  if (f === undefined) return undefined;
  if (typeof f !== "object" || f === null) bad(`${what} must be an object`);
  const out: ChartFont = { ...f };
  for (const k of Object.keys(out) as (keyof ChartFont)[]) if (out[k] === undefined || out[k] === "") delete out[k];
  for (const k of Object.keys(out)) if (!["family", "size", "bold", "italic", "color"].includes(k)) bad(`${what} has no setting "${k}"`);
  if (out.size !== undefined && !(finite(out.size) && out.size >= 1 && out.size <= 400)) bad(`${what}: the size is from 1 to 400 points`);
  if (out.color !== undefined && !COLOR.test(out.color)) bad(`${what}: the colour looks like #rrggbb`);
  if (out.family !== undefined && typeof out.family !== "string") bad(`${what}: the family is a font name`);
  for (const k of ["bold", "italic"] as const) if (out[k] !== undefined && typeof out[k] !== "boolean") bad(`${what}: ${k} is true or false`);
  if (out.italic === false) delete out.italic;
  return Object.keys(out).length ? out : undefined;
}

/** A title in pieces made ready to keep: each piece has text and may have a look of its own. */
export function cleanTitleRuns(what: string, runs: ChartTitleRun[] | undefined): ChartTitleRun[] | undefined {
  if (runs === undefined) return undefined;
  if (!Array.isArray(runs)) bad(`${what}: the pieces must be a list`);
  const out = runs
    .map((r, i) => {
      if (typeof r !== "object" || r === null || typeof r.text !== "string") bad(`${what}, piece ${i + 1} needs text`);
      const { text, underline, ...look } = r;
      const f = cleanChartFont(`${what}, piece ${i + 1}`, look);
      return { text, ...(underline === true ? { underline: true as const } : {}), ...(f ?? {}) };
    })
    .filter((r) => r.text !== "");
  return out.length ? out : undefined;
}

/** The label of a trendline made ready to keep; undefined when it says nothing. */
export function cleanTrendlineLabel(l: TrendlineLabel | undefined, n: number): TrendlineLabel | undefined {
  if (l === undefined) return undefined;
  if (typeof l !== "object" || l === null) bad(`The label of the trendline of series ${n} must be an object`);
  const out: TrendlineLabel = { ...l };
  for (const k of Object.keys(out) as (keyof TrendlineLabel)[]) if (out[k] === undefined || out[k] === "") delete out[k];
  for (const k of Object.keys(out)) if (!["format", "text", "x", "y", "font"].includes(k)) bad(`The label of a trendline has no setting "${k}"`);
  if (out.format !== undefined && typeof out.format !== "string") bad("A trendline label's number format must be text");
  if (out.format === "General") delete out.format;
  if (out.text !== undefined && typeof out.text !== "string") bad("A trendline label's text must be text");
  for (const k of ["x", "y"] as const) {
    if (out[k] !== undefined && !(finite(out[k]) && out[k]! >= -1 && out[k]! <= 1)) bad(`A trendline label's ${k} is how far it has moved, from -1 to 1 of the chart`);
    if (out[k] === 0) delete out[k];
    else if (out[k] !== undefined) out[k] = Math.round(out[k]! * 10000) / 10000;
  }
  const f = cleanChartFont("The trendline label font", out.font);
  if (f) out.font = f;
  else delete out.font;
  return Object.keys(out).length ? out : undefined;
}

/** The 3-D view of a chart made ready to keep: the angles, and the perspective, right angle and depth when they are not the defaults. */
export function cleanView3d(v: ChartView3d): ChartView3d {
  if (!(v.rotX >= 0 && v.rotX <= 90) || !(v.rotY >= 0 && v.rotY <= 360)) bad("A 3-D chart is tilted 0 to 90 degrees and turned 0 to 360");
  const out: ChartView3d = { rotX: v.rotX, rotY: v.rotY };
  if (v.perspective !== undefined) {
    if (!(finite(v.perspective) && v.perspective >= 0 && v.perspective <= 100)) bad("The perspective of a 3-D chart is an angle of view from 0 to 100 degrees");
    if (v.perspective !== DEFAULT_PERSPECTIVE) out.perspective = v.perspective;
  }
  if (v.rightAngle !== undefined) {
    if (typeof v.rightAngle !== "boolean") bad("Right-angle axes are true or false");
    if (v.rightAngle) out.rightAngle = true;
  }
  if (v.depth !== undefined) {
    if (!(finite(v.depth) && v.depth >= 20 && v.depth <= 2000)) bad("The depth of a 3-D chart is from 20 to 2000 percent of its width");
    if (v.depth !== DEFAULT_DEPTH) out.depth = v.depth;
  }
  return out;
}

const KIND_GROUPS = ["column", "line", "area"] as const;

/** Checks and tidies the chart options added last, in place (`out` is already a copy). Call it after the series have been checked. */
export function cleanDetail(out: Chart): void {
  // ---- colours of single points ----
  out.series.forEach((s, i) => {
    if (s.pointColors === undefined) return;
    if (typeof s.pointColors !== "object" || s.pointColors === null || Array.isArray(s.pointColors)) bad(`The point colours of series ${i + 1} must be an object`);
    const kind = out.type === "column" || out.type === "line" || out.type === "area" ? (s.type ?? out.type) : out.type;
    if (!POINT_COLOR_KINDS.includes(kind)) {
      delete s.pointColors;
      return;
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.pointColors)) {
      if (v === undefined) continue;
      if (!/^\d+$/.test(k)) bad(`Series ${i + 1}: point colours are by point number from 0`);
      if (typeof v !== "string" || !COLOR.test(v)) bad(`Series ${i + 1}: a point colour looks like #rrggbb`);
      clean[String(Number(k))] = v.toLowerCase();
    }
    if (Object.keys(clean).length) s.pointColors = clean;
    else delete s.pointColors;
  });

  // ---- fonts of the legend and the data labels ----
  for (const k of ["legendFont", "labelFont"] as const) {
    const f = cleanChartFont(k === "legendFont" ? "The legend font" : "The data label font", out[k]);
    if (f) out[k] = f;
    else delete out[k];
  }

  // ---- fonts and titles in pieces of single axes ----
  if (out.axes) {
    const titleField = { x: "xTitle", y: "yTitle", x2: "x2Title", y2: "y2Title" } as const;
    for (const key of ["x", "y", "x2", "y2"] as const) {
      const a = out.axes[key];
      if (!a) continue;
      const font = cleanChartFont(`The ${key} axis font`, a.font);
      if (font) a.font = font;
      else delete a.font;
      const tf = cleanChartFont(`The ${key} axis title font`, a.titleFont);
      if (tf) a.titleFont = tf;
      else delete a.titleFont;
      const runs = cleanTitleRuns(`The ${key} axis title`, a.titleRuns);
      if (runs) {
        a.titleRuns = runs;
        out[titleField[key]] = runs.map((r) => r.text).join("");
      } else delete a.titleRuns;
      if (!Object.keys(a).length) delete out.axes[key];
    }
    if (!Object.keys(out.axes).length) delete out.axes;
  }

  // ---- piling up of the series of a second kind ----
  if (out.kindGrouping !== undefined) {
    const kg = out.kindGrouping;
    if (typeof kg !== "object" || kg === null) bad("A chart's grouping by kind must be an object");
    const own = out.type === "bar" ? "column" : out.type;
    const clean: NonNullable<Chart["kindGrouping"]> = {};
    for (const [k, v] of Object.entries(kg)) {
      if (v === undefined) continue;
      if (!KIND_GROUPS.includes(k as (typeof KIND_GROUPS)[number])) bad(`Series of kind "${k}" can't be piled up: only column, line and area can`);
      if (v !== "stacked" && v !== "percent") bad('Grouping is "stacked" or "percent"');
      if (!(out.type === "column" || out.type === "line" || out.type === "area" || out.type === "bar")) continue;
      if (k === own) continue;
      if (!out.series.some((s) => (s.type ?? out.type) === k)) continue;
      clean[k as keyof typeof clean] = v;
    }
    if (Object.keys(clean).length && !out.view3d) out.kindGrouping = clean;
    else delete out.kindGrouping;
  }

  // ---- waterfall colours ----
  if (out.waterfall) {
    for (const k of ["increaseColor", "decreaseColor", "totalColor"] as const) {
      const v = out.waterfall[k];
      if (v === undefined) continue;
      if (typeof v !== "string" || !COLOR.test(v)) bad(`The waterfall ${k.replace("Color", "")} colour looks like #rrggbb`);
      out.waterfall[k] = v.toLowerCase();
    }
  }

  // ---- spheres ----
  if (out.bubble3d !== undefined) {
    if (out.type !== "bubble" || out.bubble3d !== true) delete out.bubble3d;
  }
}
