import { useId, type ReactNode } from "react";
import { CHART_COLORS, exDefaultLegend, formatValue, isChartex, seriesKind, stockKind, type Chart, type ChartData, type ChartType } from "@pli.dev/sheets";
import { axisLook, drawCategoryAxis, drawValueAxis, fontStyle } from "./chartaxes";
import { arcHit, circleHit, markAttrs, rectHit, type MarkRef } from "./chartmarks";
import { buildPie3d, buildScene3d, buildSurface3d, surfaceBands, type Item } from "./chart3d";
import { axisTitles, titleLooks, bandLabels, clip, CHAR, drawBox, drawDoughnut, drawFunnel, drawHistogram, drawOfPie, drawPareto, drawRadar, drawSunburst, drawTreemap, drawWaterfall, FONT, percent, plotBox, textWidth, valueAxisY, type Box, type KindResult, type LegendEntry } from "./chartkinds";
import { axisBase, crossingValue, labelText, explodedCentre, explosionOf, fracOf, maxExplosion, niceTicks, scaleTicks, slicePath, smoothPath, stackSeries, tickLabel, tint, type Ticks } from "./chartmath";

/**
 * The same chart with its categories the other way round, for a reversed category axis. Forecast room for a trendline that runs
 * forward goes on the left, where the line now ends.
 */
function reversedCategories(data: ChartData): ChartData {
  const n = data.categories.length;
  const extra = Math.max(0, ...data.series.flatMap((s) => (s.trendlines ?? []).map((t) => (t.points.length ? Math.ceil(Math.max(...t.points.map((p) => p[0])) - 1e-9) - n : 0))));
  const pad = <T,>(v: T) => Array.from({ length: extra }, () => v);
  return {
    ...data,
    categories: [...pad(""), ...data.categories.slice().reverse()],
    series: data.series.map((s) => ({
      ...s,
      ...(s.pointColors ? { pointColors: Object.fromEntries(Object.entries(s.pointColors).map(([k, c]) => [String(extra + n - 1 - Number(k)), c])) } : {}),
      values: [...pad(null), ...s.values.slice().reverse()],
      ...(s.size ? { size: [...pad(null), ...s.size.slice().reverse()] } : {}),
      ...(s.trendlines ? { trendlines: s.trendlines.map((t) => ({ ...t, points: t.points.map((p): [number, number] => [n + extra + 1 - p[0], p[1]]) })) } : {}),
      ...(s.errorBars ? { errorBars: Object.fromEntries(Object.entries(s.errorBars).map(([k, e]) => [k, k === "y" ? { ...e, plus: [...pad(null), ...e.plus.slice().reverse()], minus: [...pad(null), ...e.minus.slice().reverse()] } : e])) } : {}),
    })),
  };
}

export interface ChartViewProps {
  chart: Chart;
  data: ChartData;
  /** The mark that is picked (series and point number), drawn outlined. */
  mark?: MarkRef | null;
}

const PAD = 12;
/** The colour error bars are drawn in when they have none of their own. */
const ERR_COLOR = "var(--pli-fg)";

const SPECIAL: Partial<Record<ChartType, (chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null) => KindResult>> = {
  doughnut: drawDoughnut,
  pieOfPie: drawOfPie,
  barOfPie: drawOfPie,
  radar: drawRadar,
  waterfall: drawWaterfall,
  histogram: drawHistogram,
  pareto: drawPareto,
  boxWhisker: drawBox,
  funnel: drawFunnel,
  treemap: drawTreemap,
  sunburst: drawSunburst,
};

/** What a chart's legend lists. Circular kinds list their slices; the others their series (and trendlines). */
function legendEntries(chart: Chart, data: ChartData, surface: Ticks | null): LegendEntry[] {
  const pieColor = (k: number) => data.series[0]?.pointColors?.[String(k)] ?? CHART_COLORS[k % CHART_COLORS.length]!;
  switch (chart.type) {
    case "pie":
    case "doughnut":
    case "pieOfPie":
    case "barOfPie":
      return data.categories.map((name, k) => ({ name, color: pieColor(k) }));
    case "waterfall":
      return [{ name: "Increase", color: CHART_COLORS[0]! }, { name: "Decrease", color: CHART_COLORS[1]! }, { name: "Total", color: CHART_COLORS[2]! }];
    case "pareto":
      return data.series.length > 1
        ? [...data.series.map((s) => ({ name: s.name, color: s.color })), ...data.series.map((s, i) => ({ name: `${s.name} cumulative %`, color: CHART_COLORS[(i + data.series.length) % CHART_COLORS.length]! }))]
        : [{ name: data.series[0]?.name ?? "Values", color: data.series[0]?.color ?? CHART_COLORS[0]! }, { name: "Cumulative %", color: CHART_COLORS[1]! }];
    case "histogram":
      return data.series.length > 1 ? data.series.map((s) => ({ name: s.name, color: s.color })) : [];
    case "funnel":
    case "treemap":
    case "sunburst":
      return [];
    case "surface":
      return surface ? surfaceBands(surface).map((b) => ({ name: b.name, color: b.color })) : [];
    default:
      return data.series.flatMap((s) => [{ name: s.name, color: s.color }, ...(s.trendlines ?? []).map((t) => ({ name: t.name, color: t.color, dash: true }))]);
  }
}

/** A chart drawn as SVG from the cells it refers to. It has no state: give it a chart and what it reads, and it draws. */
export function ChartView({ chart, data: given, mark = null }: ChartViewProps) {
  const { width: W, height: H } = chart;
  const catReverse = !!chart.axes?.x?.reverse && ["column", "bar", "line", "area", "stock"].includes(chart.type);
  const data = catReverse ? reversedCategories(given) : given;
  const clipId = `pli-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const type = chart.type;
  const pie = type === "pie";
  const horizontal = type === "bar";
  const scatter = type === "scatter";
  const bubble = type === "bubble";
  const xy = scatter || bubble;
  const stock = type === "stock";
  const surface = type === "surface";
  const n = data.categories.length;
  const series = pie || type === "pieOfPie" || type === "barOfPie" ? data.series.slice(0, 1) : data.series;
  const hasData = series.length > 0 && n > 0 && series.some((s) => s.values.some((v) => v !== null)) && (!stock || series.length >= 3);
  const stackable = type === "column" || type === "bar" || type === "line" || type === "area";
  const grouping = stackable ? chart.grouping : undefined;
  const colorOf = (i: number) => data.series[i]?.color ?? CHART_COLORS[i % CHART_COLORS.length]!;
  /** The fill of a slice: its own colour, or the palette's. */
  const pieColor = (k: number) => data.series[0]?.pointColors?.[String(k)] ?? CHART_COLORS[k % CHART_COLORS.length]!;
  /** The fill of point `k` of series `i`: its own colour, or the series'. */
  const pointFill = (i: number, k: number) => data.series[i]?.pointColors?.[String(k)] ?? series[i]?.color ?? colorOf(i);
  /** The point number in the cells for point `k` of the drawing (the drawing is backwards when the categories are reversed). */
  const cellPoint = (k: number) => (catReverse ? given.categories.length - 1 - (k - (data.categories.length - given.categories.length)) : k);
  const volume = stock && (stockKind(chart) === "vhlc" || stockKind(chart) === "vohlc");
  // What mark each series is drawn with, and which value axis it sits on (0 is the first).
  const kindOf = (i: number): ChartType => (stock ? (volume && i === 0 ? "column" : "stock") : seriesKind(chart, chart.series[i] ?? {}));
  const axisOf = (i: number): 0 | 1 => (stock ? (volume && i > 0 ? 1 : 0) : chart.series[i]?.axis === "secondary" && !pie ? 1 : 0);
  /** How series `i` piles up: the chart's own kind by `grouping`, the other kinds by `kindGrouping`. */
  const groupingOf = (i: number): "stacked" | "percent" | undefined => {
    const k = kindOf(i);
    return k === type || (type === "bar" && k === "bar") ? grouping : k === "column" || k === "line" || k === "area" ? chart.kindGrouping?.[k] : undefined;
  };
  const hasSecond = !xy && series.some((_, i) => axisOf(i) === 1);
  const hasSecondXY = xy && series.some((_, i) => axisOf(i) === 1);

  // ---- surface charts colour by bands of the value axis ----
  let surfaceTicks: Ticks | null = null;
  if (surface && hasData) {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    surfaceTicks = scaleTicks(chart.axes?.y, Math.min(...all), Math.max(...all));
  }

  // ---- the legend takes a strip of one side ----
  const legendAt = chart.legend ?? (isChartex(type) ? exDefaultLegend(chart) : "bottom");
  const entries = legendEntries(chart, data, surfaceTicks);
  const lone = pie || ["doughnut", "pieOfPie", "barOfPie", "waterfall", "pareto", "surface"].includes(type) ? 0 : 1;
  const showLegend = legendAt !== "none" && entries.length > lone;
  const sideLegend = showLegend && (legendAt === "left" || legendAt === "right");
  const legendW = sideLegend ? Math.min(W * 0.35, Math.max(...entries.map((e) => textWidth(e.name))) + 28) : 0;
  const legendH = showLegend && !sideLegend ? 22 : 0;

  const titleH = chart.title ? 30 : 0;
  const frame: Box = {
    x: PAD + (legendAt === "left" && showLegend ? legendW + 8 : 0),
    y: PAD + titleH + (legendAt === "top" ? legendH : 0),
    w: W - 2 * PAD - (sideLegend ? legendW + 8 : 0),
    h: H - 2 * PAD - titleH - legendH,
  };

  // The x axis is the one the categories run along, so on a bar chart it is the vertical one.
  const bottomTitle = horizontal ? chart.yTitle : chart.xTitle;
  const leftTitle = horizontal ? chart.xTitle : chart.yTitle;

  const parts: ReactNode[] = [];
  const spheres: ReactNode[] = [];

  // ---- scales: one value axis for each set of series ----
  const stacked = new Set<number>();
  series.forEach((_, i) => groupingOf(i) && stacked.add(i));
  const stackOf = new Map<number, [number, number][]>();
  // Each kind piles up on its own, on each axis.
  for (const a of [0, 1] as const) {
    for (const kind of ["column", "bar", "line", "area"] as ChartType[]) {
      const idx = [...stacked].filter((i) => axisOf(i) === a && kindOf(i) === kind);
      if (idx.length) stackSeries(idx.map((i) => series[i]!.values), groupingOf(idx[0]!) === "percent").forEach((spans, j) => stackOf.set(idx[j]!, spans));
    }
  }
  const percentOn = (a: number) => series.some((_, i) => axisOf(i) === a && stacked.has(i) && groupingOf(i) === "percent");
  const axisKeyOf = (a: 0 | 1) => (a === 0 ? "y" : "y2") as "y" | "y2";
  const valueTicks: [Ticks, Ticks] = [niceTicks(0, 1), niceTicks(0, 1)];
  let xTicks = niceTicks(0, 1);
  const trendYs = (a: number) => series.flatMap((s, i) => (axisOf(i) === a ? (s.trendlines ?? []).flatMap((t) => t.points.map((p) => p[1])) : []));
  /** The ends of the error bars, which the axis has to leave room for. */
  const errYs = (a: number) => series.flatMap((s, i) => (axisOf(i) === a && s.errorBars?.y ? s.values.flatMap((v, k) => (v === null ? [] : [v - (s.errorBars!.y!.minus[k] ?? 0), v + (s.errorBars!.y!.plus[k] ?? 0)])) : []));
  const errXs = series.flatMap((s) => (s.errorBars?.x && s.x ? s.x.flatMap((v, k) => [v - (s.errorBars!.x!.minus[k] ?? 0), v + (s.errorBars!.x!.plus[k] ?? 0)]) : []));
  /** The lowest positive number among `nums`, for a logarithmic scale. */
  const lowestPositive = (nums: number[]) => Math.min(...nums.filter((v) => v > 0));
  if (hasData && !pie && !surface) {
    if (xy) {
      const xs = [...series.flatMap((s) => s.x ?? []), ...errXs];
      for (const a of [0, 1] as const) {
        const ys = [...series.flatMap((s, i) => (axisOf(i) === a ? s.values : [])).filter((v): v is number => v !== null), ...trendYs(a), ...errYs(a)];
        if (ys.length) {
          const ax = chart.axes?.[axisKeyOf(a)];
          valueTicks[a] = scaleTicks(ax, ax?.log ? lowestPositive(ys) : Math.min(...ys), Math.max(...ys));
        }
      }
      const allX = [...xs, ...series.flatMap((s) => (s.trendlines ?? []).flatMap((t) => t.points.map((p) => p[0])))];
      const axx = chart.axes?.x;
      xTicks = scaleTicks(axx, axx?.log ? lowestPositive(allX) : Math.min(...allX), Math.max(...allX));
    } else if (!SPECIAL[type]) {
      for (const a of [0, 1] as const) {
        const members = series.map((_, i) => i).filter((i) => axisOf(i) === a);
        if (!members.length) continue;
        const ax = chart.axes?.[axisKeyOf(a)];
        if (percentOn(a)) {
          valueTicks[a] = scaleTicks(ax, 0, 1, 5);
          continue;
        }
        const nums: number[] = [];
        for (const i of members) {
          const st = stackOf.get(i);
          if (st) nums.push(...st.flatMap((p) => [p[0], p[1]]));
          else nums.push(...series[i]!.values.filter((v): v is number => v !== null));
        }
        nums.push(...trendYs(a), ...errYs(a));
        if (!nums.length) continue;
        let lo = Math.min(...nums);
        let hi = Math.max(...nums);
        if (ax?.log) {
          valueTicks[a] = scaleTicks(ax, lowestPositive(nums), hi);
          continue;
        }
        // Columns, bars and areas start at zero; so do lines unless the data sits high above it. Prices don't.
        const zero = members.some((i) => kindOf(i) === "column" || kindOf(i) === "bar" || kindOf(i) === "area") || (!stock && !(lo > (hi * 5) / 6));
        if (zero) lo = Math.min(0, lo);
        if (zero || lo >= 0) hi = Math.max(0, hi);
        valueTicks[a] = scaleTicks(ax, lo, hi);
      }
    }
  }
  const labelOf = (a: 0 | 1, key: "x" | "y" | "y2" = a === 0 ? "y" : "y2") => {
    const format = chart.axes?.[key]?.format;
    if (format) return (v: number) => formatValue(v, format).text;
    return (v: number) => (percentOn(a) ? percent(v) : tickLabel(v));
  };
  function members(a: number) {
    return series.map((_, i) => i).filter((i) => axisOf(i) === a);
  }

  // ---- extra categories where a trendline is forecast forward ----
  const forward = xy ? 0 : Math.max(0, ...series.flatMap((s) => (s.trendlines ?? []).map((t) => (t.points.length ? Math.max(0, Math.ceil(t.points[t.points.length - 1]![0] - 1e-9) - n) : 0))));
  const nCats = Math.max(1, n + forward);
  const catLabels = forward ? [...data.categories, ...Array.from({ length: forward }, () => "")] : data.categories;

  // ---- the plot area leaves room for the axis labels and titles ----
  const look = { x: axisLook(chart, "x"), y: axisLook(chart, "y"), x2: axisLook(chart, "x2"), y2: axisLook(chart, "y2") };
  const shownLabels = (l: { labels: string; hidden: boolean }) => l.labels !== "none" && !l.hidden;
  let plot: Box = { ...frame };
  const secondaryTop = !xy && !!chart.secondaryCategoryAxis && hasSecond && !horizontal;
  if (hasData && !pie && !SPECIAL[type] && !surface) {
    plot = horizontal
      ? plotBox(frame, { left: shownLabels(look.x) ? data.categories.map((c) => clip(c, 14)) : [], leftTitle, bottomTitle, top: hasSecond, topTitle: !!chart.y2Title })
      : plotBox(frame, { left: shownLabels(look.y) ? valueTicks[0].ticks.map(labelOf(0)) : [], leftTitle, bottomTitle, ...(hasSecond || hasSecondXY ? { right: shownLabels(look.y2) ? valueTicks[1].ticks.map(labelOf(1)) : [], rightTitle: chart.y2Title } : {}), top: secondaryTop, topTitle: !!chart.x2Title });
  } else if (surface && hasData) {
    plot = plotBox(frame, { left: [], bottomTitle });
  }
  /** Where a value lands along its value axis: up the plot, or along it for bars. NaN where a logarithmic scale can't place it. */
  const vPos = (a: 0 | 1, v: number) => {
    const f = fracOf(valueTicks[a], v);
    return horizontal ? plot.x + f * plot.w : plot.y + plot.h - f * plot.h;
  };
  const xAt = (v: number) => plot.x + fracOf(xTicks, v) * plot.w;
  const band = (horizontal ? plot.h : plot.w) / nCats;
  /** Where the other axis crosses a value axis: its zero if the scale has one, else its low end, unless the settings say. */
  const crossingOf = crossingValue;
  /** Where a column's, line's or area's marks start from: the axis that crosses the value axis. */
  const baseOf = (a: 0 | 1) => axisBase(valueTicks[a], crossingOf(valueTicks[a], chart.axes?.[axisKeyOf(a)]?.crosses));
  /** A value's position, with a value a log scale can't place put at the start of the axis. */
  const vPosOrBase = (a: 0 | 1, v: number) => {
    const p = vPos(a, v);
    return Number.isFinite(p) ? p : vPos(a, valueTicks[a].min);
  };
  /** The value axis of a column or bar chart, along the categories: its side (`start` is left, or the top of a bar chart) or a pixel position. */
  const catSideOf = (): { side: "start" | "end"; at?: number } => {
    const c = chart.axes?.x?.crosses;
    const rev = !!chart.axes?.x?.reverse;
    const dataMin = rev ? "end" : "start";
    const dataMax = rev ? "start" : "end";
    if (typeof c === "number") {
      const j = Math.max(0, Math.min(n, Math.round(c) - 1));
      const slots = rev ? n - j : j;
      return { side: "start", at: (horizontal ? plot.y : plot.x) + band * (slots + (rev ? forward : 0)) };
    }
    if (horizontal) return { side: c === undefined ? "end" : c === "min" ? dataMin : dataMax };
    return { side: c === undefined || c === "min" ? dataMin : dataMax };
  };

  if (!hasData) {
    parts.push(
      <text key="empty" x={frame.x + frame.w / 2} y={frame.y + frame.h / 2} textAnchor="middle" className="pli-chart-muted">
        No data to show
      </text>,
    );
  } else if (surface) {
    const view = chart.view3d ?? { rotX: 15, rotY: 20 };
    parts.push(...buildSurface3d({ ...chart, view3d: view }, data, plot, surfaceTicks!, tickLabel).map(drawItem));
  } else if (SPECIAL[type]) {
    parts.push(...SPECIAL[type]!(chart, data, frame, mark).parts);
  } else if (chart.view3d && !xy && !stock) {
    const ticks = valueTicks[0];
    const items = pie ? buildPie3d(chart, data, frame) : buildScene3d(chart, data, plot, ticks, labelOf(0));
    parts.push(...items.map(drawItem));
  } else if (pie) {
    const values = series[0]!.values.map((v) => Math.max(0, v ?? 0));
    const total = values.reduce((a, b) => a + b, 0);
    const spec = chart.series[0];
    const r = Math.max(10, (Math.min(frame.w, frame.h) / 2 - 6) / (1 + maxExplosion(spec, values.length) / 100));
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    if (!total) {
      parts.push(<circle key="p" cx={cx} cy={cy} r={r} className="pli-chart-empty" />);
    } else {
      let a = ((chart.firstSliceAngle ?? 0) * Math.PI) / 180;
      values.forEach((v, k) => {
        if (!v) return;
        const a1 = a + (v / total) * Math.PI * 2;
        const mid = (a + a1) / 2;
        const c = explodedCentre(cx, cy, r, mid, explosionOf(spec, k));
        parts.push(
          <path key={`s${k}`} d={slicePath(c.cx, c.cy, r, a, a1)} fill={pieColor(k)} className="pli-chart-slice" {...markAttrs(0, k, arcHit(c.cx, c.cy, 0, r, a, a1), mark)}>
            <title>{`${data.categories[k]}: ${tickLabel(v)} (${percent(v / total)})`}</title>
          </path>,
        );
        if (chart.labels && v / total > 0.04) {
          const where = chart.labelPosition === "outsideEnd" ? 1.12 : chart.labelPosition === "insideEnd" ? 0.85 : chart.labelPosition === "center" ? 0.5 : 0.65;
          parts.push(
            <text key={`l${k}`} x={c.cx + r * where * Math.sin(mid)} y={c.cy - r * where * Math.cos(mid) + 4} textAnchor="middle" className={where > 1 ? "pli-chart-value" : "pli-chart-onmark"} style={fontStyle(chart.labelFont)}>
              {labelText(chart, { value: tickLabel(v), category: data.categories[k] ?? "", series: series[0]?.name ?? "", percent: percent(v / total) }, ["percent"])}
            </text>,
          );
        }
        a = a1;
      });
    }
  } else {
    // ---- axes: value axes with their gridlines, the category axis, and the second axes ----
    if (xy) {
      const crossY = vPos(0, crossingOf(valueTicks[0], chart.axes?.y?.crosses));
      const crossX = xAt(crossingOf(xTicks, chart.axes?.x?.crosses));
      parts.push(
        ...drawValueAxis({ key: "x", plot, ticks: xTicks, fmt: labelOf(0, "x"), vertical: false, look: look.x, side: "start", at: crossY, font: chart.axes?.x?.font }),
        ...drawValueAxis({ key: "v0", plot, ticks: valueTicks[0], fmt: labelOf(0), vertical: true, look: look.y, side: "start", at: crossX, font: chart.axes?.y?.font }),
      );
      if (hasSecondXY) parts.push(...drawValueAxis({ key: "v1", plot, ticks: valueTicks[1], fmt: labelOf(1), vertical: true, look: look.y2, side: "end", font: chart.axes?.y2?.font }));
    } else {
      const cat = catSideOf();
      const cross0 = vPos(0, crossingOf(valueTicks[0], chart.axes?.y?.crosses));
      // The value axis is the one with gridlines. On a bar chart it runs along the bottom.
      parts.push(
        ...drawValueAxis({
          key: "v0", plot, ticks: valueTicks[0], fmt: labelOf(0), vertical: !horizontal, look: look.y, font: chart.axes?.y?.font,
          side: horizontal ? (cat.side === "end" ? "start" : "end") : cat.side,
          ...(cat.at !== undefined ? { at: cat.at } : {}),
        }),
      );
      if (hasSecond) parts.push(...drawValueAxis({ key: "v1", plot, ticks: valueTicks[1], fmt: labelOf(1), vertical: !horizontal, look: look.y2, font: chart.axes?.y2?.font, side: horizontal ? "end" : "end" }));
      parts.push(
        ...drawCategoryAxis({
          key: "c", plot, labels: horizontal ? data.categories : catLabels, count: horizontal ? n : nCats, band, horizontal: !horizontal, look: look.x, font: chart.axes?.x?.font,
          side: "start", at: Number.isFinite(cross0) ? cross0 : undefined, labelEvery: chart.axes?.x?.labelEvery, tickEvery: chart.axes?.x?.tickEvery,
        }),
      );
      if (secondaryTop) parts.push(...drawCategoryAxis({ key: "c2", plot, labels: catLabels, count: nCats, band, horizontal: true, look: look.x2, font: chart.axes?.x2?.font, side: "end", labelEvery: chart.axes?.x2?.labelEvery, tickEvery: chart.axes?.x2?.tickEvery }));
    }

    const textOf = (i: number, k: number, v: number, pct = false): string =>
      labelText(chart, { value: pct ? percent(v) : tickLabel(v), category: data.categories[k] ?? "", series: series[i]?.name ?? "" });
    const label = (key: string, x: number, y: number, v: number, anchor: "middle" | "start" | "end" = "middle", pct = false, who: [number, number] = [0, 0]) =>
      chart.labels ? (
        <text key={key} x={x} y={y} textAnchor={anchor} className="pli-chart-value" style={fontStyle(chart.labelFont)}>
          {textOf(who[0], who[1], v, pct)}
        </text>
      ) : null;
    /** A label on a bar or column, where `labelPosition` puts it (outside the end by default). */
    const barLabel = (key: string, rect: { x: number; y: number; width: number; height: number }, v: number, who: [number, number], pct: boolean) => {
      const pos = chart.labelPosition ?? "outsideEnd";
      const positive = v >= 0;
      if (horizontal) {
        const tip = positive ? rect.x + rect.width : rect.x;
        const base = positive ? rect.x : rect.x + rect.width;
        const cy = rect.y + rect.height / 2 + 4;
        if (pos === "center") return label(key, rect.x + rect.width / 2, cy, v, "middle", pct, who);
        if (pos === "insideEnd") return label(key, tip + (positive ? -4 : 4), cy, v, positive ? "end" : "start", pct, who);
        if (pos === "insideBase") return label(key, base + (positive ? 4 : -4), cy, v, positive ? "start" : "end", pct, who);
        return label(key, tip + (positive ? 4 : -4), cy, v, positive ? "start" : "end", pct, who);
      }
      const tip = positive ? rect.y : rect.y + rect.height;
      const base = positive ? rect.y + rect.height : rect.y;
      const cx = rect.x + rect.width / 2;
      if (pos === "center") return label(key, cx, rect.y + rect.height / 2 + 4, v, "middle", pct, who);
      if (pos === "insideEnd") return label(key, cx, tip + (positive ? 12 : -4), v, "middle", pct, who);
      if (pos === "insideBase") return label(key, cx, base + (positive ? -4 : 12), v, "middle", pct, who);
      return label(key, cx, tip + (positive ? -4 : 12), v, "middle", pct, who);
    };
    /** A label on a point of a line or a scatter chart. */
    const pointLabel = (key: string, x: number, y: number, v: number, who: [number, number]) => {
      const pos = chart.labelPosition ?? "above";
      if (pos === "center") return label(key, x, y + 4, v, "middle", false, who);
      if (pos === "below") return label(key, x, y + 15, v, "middle", false, who);
      if (pos === "left") return label(key, x - 8, y + 4, v, "end", false, who);
      if (pos === "right") return label(key, x + 8, y + 4, v, "start", false, who);
      return label(key, x, y - 8, v, "middle", false, who);
    };
    /** Error bars hung from the point at `at`, whose value is `v`: along the value axis (`y`, which on a bar chart runs across) or along x. */
    const errorBars = (key: string, at: { x: number; y: number }, plus: number | null | undefined, minus: number | null | undefined, v: number, along: "y" | "x", a: 0 | 1, color: string, cap: boolean): ReactNode[] => {
      const toPx = (value: number) => {
        if (along === "x") {
          const p = xAt(value);
          return Number.isFinite(p) ? p : xAt(xTicks.min);
        }
        return vPosOrBase(a, value);
      };
      const hi = plus ? toPx(v + plus) : null;
      const lo = minus ? toPx(v - minus) : null;
      const ends = [hi, lo].filter((p): p is number => p !== null);
      if (!ends.length) return [];
      const vertical = along === "y" && !horizontal;
      const here = vertical ? at.y : at.x;
      const from = Math.min(...ends, here);
      const to = Math.max(...ends, here);
      const nodes: ReactNode[] = [vertical ? <line key={`${key}l`} x1={at.x} x2={at.x} y1={from} y2={to} stroke={color} className="pli-chart-errbar" /> : <line key={`${key}l`} y1={at.y} y2={at.y} x1={from} x2={to} stroke={color} className="pli-chart-errbar" />];
      if (cap) {
        for (const [tag, p] of [["h", hi], ["m", lo]] as const) {
          if (p === null) continue;
          nodes.push(vertical ? <line key={`${key}${tag}`} x1={at.x - 4} x2={at.x + 4} y1={p} y2={p} stroke={color} className="pli-chart-errbar" /> : <line key={`${key}${tag}`} y1={at.y - 4} y2={at.y + 4} x1={p} x2={p} stroke={color} className="pli-chart-errbar" />);
        }
      }
      return nodes;
    };
    const errParts: ReactNode[] = [];

    const spanOf = (i: number, k: number): [number, number] | null => {
      const v = series[i]!.values[k];
      if (v === null || v === undefined) return null;
      return stackOf.get(i)?.[k] ?? [baseOf(axisOf(i)), v];
    };

    // Areas lie under columns, which lie under lines, as in Excel.
    const order: ChartType[] = ["area", "column", "bar", "line", "stock", "scatter", "bubble"];
    // The first value axis's series are painted first, then the second's, each from areas to lines.
    for (const [pass, kind] of ([0, 1] as const).flatMap((p) => order.map((k) => [p, k] as const))) {
      const idx = series.map((_, i) => i).filter((i) => (xy ? type : kindOf(i)) === kind && (pass === 1 ? axisOf(i) === 1 : axisOf(i) === 0 || xy));
      if (!idx.length || (xy && pass === 1)) continue;
      if (kind === "column" || kind === "bar") {
        for (const a of [0, 1] as const) {
          const group = idx.filter((i) => axisOf(i) === a);
          if (!group.length) continue;
          const piled = group.some((i) => stacked.has(i));
          const groupW = band * (piled ? 0.6 : 0.7);
          const barW = piled ? groupW : groupW / group.length;
          group.forEach((i, rank) => {
            const s = series[i]!;
            s.values.forEach((v, k) => {
              const span = spanOf(i, k);
              if (!span || v === null) return;
              const along = band * k + (band - groupW) / 2 + (piled ? 0 : barW * rank);
              const p0 = vPosOrBase(a, span[0]);
              const p1 = vPosOrBase(a, span[1]);
              const rect = horizontal ? { x: Math.min(p0, p1), y: plot.y + along, width: Math.abs(p1 - p0), height: barW } : { x: plot.x + along, y: Math.min(p0, p1), width: barW, height: Math.abs(p1 - p0) };
              parts.push(
                <rect key={`b${i}-${k}`} {...rect} fill={pointFill(i, k)} className="pli-chart-bar" {...markAttrs(i, cellPoint(k), rectHit(rect.x, rect.y, rect.width, rect.height), mark)}>
                  <title>{`${s.name}, ${data.categories[k]}: ${tickLabel(v)}`}</title>
                </rect>,
              );
              const pct = groupingOf(i) === "percent" && stacked.has(i);
              parts.push(barLabel(`v${i}-${k}`, rect, pct ? span[1] - span[0] : v, [i, k], pct));
              const eb = s.errorBars?.y;
              if (eb) {
                const centre = horizontal ? { x: 0, y: rect.y + barW / 2 } : { x: rect.x + barW / 2, y: 0 };
                const tip = horizontal ? { x: p1, y: centre.y } : { x: centre.x, y: p1 };
                errParts.push(...errorBars(`e${i}-${k}`, { x: horizontal ? tip.x : centre.x, y: horizontal ? centre.y : tip.y }, eb.plus[k], eb.minus[k], span[1], "y", a, eb.color ?? ERR_COLOR, eb.endCap));
              }
            });
          });
        }
      } else if (kind === "line" || kind === "area") {
        idx.forEach((i) => {
          const s = series[i]!;
          const a = axisOf(i);
          const top: { x: number; y: number; v: number }[] = [];
          const base: { x: number; y: number }[] = [];
          const ids: number[] = [];
          s.values.forEach((v, k) => {
            if (v === null && kind === "line") return;
            const x = plot.x + band * (k + 0.5);
            const [from, to] = spanOf(i, k) ?? [baseOf(a), 0];
            const y = vPos(a, to);
            if (!Number.isFinite(y) && kind === "line") return;
            top.push({ x, y: vPosOrBase(a, to), v: v ?? 0 });
            base.push({ x, y: vPosOrBase(a, from) });
            ids.push(k);
            const eb = s.errorBars?.y;
            if (eb && v !== null) errParts.push(...errorBars(`e${i}-${k}`, { x, y: vPosOrBase(a, to) }, eb.plus[k], eb.minus[k], to, "y", a, eb.color ?? ERR_COLOR, eb.endCap));
          });
          if (!top.length) return;
          const line = chart.smooth ? smoothPath(top) : `M${top.map((p) => `${p.x},${p.y}`).join("L")}`;
          if (kind === "area") {
            const down = base.slice().reverse().map((p) => `${p.x},${p.y}`).join("L");
            parts.push(<path key={`a${i}`} d={`${line}L${down}Z`} fill={s.color} fillOpacity={0.75} stroke={s.color} className="pli-chart-area" />);
          } else {
            parts.push(<path key={`a${i}`} d={line} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />);
            if (top.length <= 60 && chart.markers !== false) {
              top.forEach((p, k) => {
                parts.push(
                  <circle key={`m${i}-${k}`} cx={p.x} cy={p.y} r={3.5} fill={pointFill(i, ids[k]!)} className="pli-chart-marker" {...markAttrs(i, cellPoint(ids[k]!), circleHit(p.x, p.y, 4), mark)}>
                    <title>{`${s.name}: ${tickLabel(p.v)}`}</title>
                  </circle>,
                );
              });
            }
          }
          top.forEach((p, k) => parts.push(pointLabel(`v${i}-${k}`, p.x, p.y, p.v, [i, ids[k]!])));
        });
      } else if (kind === "stock") {
        // High, low and close; with an open as well, a body from the open to the close.
        const prices = idx;
        const open = prices.length >= 4;
        const [iOpen, iHigh, iLow, iClose] = open ? [prices[0]!, prices[1]!, prices[2]!, prices[3]!] : [-1, prices[0]!, prices[1]!, prices[2]!];
        const a = axisOf(iHigh);
        for (let k = 0; k < n; k++) {
          const hi = series[iHigh]!.values[k];
          const lo = series[iLow]!.values[k];
          const close = series[iClose]!.values[k];
          const op = iOpen >= 0 ? series[iOpen]!.values[k] : null;
          if (hi === null || hi === undefined || lo === null || lo === undefined) continue;
          const x = plot.x + band * (k + 0.5);
          const tip = `${data.categories[k]}: ${iOpen >= 0 ? `open ${tickLabel(op ?? 0)}, ` : ""}high ${tickLabel(hi)}, low ${tickLabel(lo)}${close !== null && close !== undefined ? `, close ${tickLabel(close)}` : ""}`;
          const look3 = chart.stockLook ?? {};
          if (look3.hiLowLines !== false) parts.push(<line key={`sw${k}`} x1={x} x2={x} y1={vPos(a, hi)} y2={vPos(a, lo)} className="pli-chart-stockline" {...(look3.hiLowColor ? { style: { stroke: look3.hiLowColor } } : {})} />);
          if (open && look3.upDownBars !== false && op !== null && op !== undefined && close !== null && close !== undefined) {
            const w = Math.min(band / (1 + (look3.gapWidth ?? 150) / 100), 40);
            const up = close >= op;
            parts.push(
              <rect key={`sb${k}`} x={x - w / 2} y={Math.min(vPos(a, op), vPos(a, close))} width={w} height={Math.max(1, Math.abs(vPos(a, op) - vPos(a, close)))} fill={up ? look3.upColor ?? "var(--pli-bg)" : look3.downColor ?? "#404040"} stroke="#404040" className="pli-chart-bar">
                <title>{tip}</title>
              </rect>,
            );
          } else if (close !== null && close !== undefined) {
            parts.push(
              <line key={`sc${k}`} x1={x} x2={x + Math.min(band * 0.25, 10)} y1={vPos(a, close)} y2={vPos(a, close)} stroke="var(--pli-fg)" strokeWidth={2} className="pli-chart-marker">
                <title>{tip}</title>
              </line>,
            );
          }
        }
      } else if (kind === "scatter" || kind === "bubble") {
        const sizes = series.flatMap((s) => s.size ?? []).filter((v): v is number => v !== null && v > 0);
        const biggest = Math.max(1e-9, ...sizes);
        const rMax = (Math.min(plot.w, plot.h) * 0.125 * (chart.bubbleScale ?? 100)) / 100;
        idx.forEach((i) => {
          const s = series[i]!;
          const a = axisOf(i);
          // In a chart of categories a scatter series stands on the category numbers (1 is the first category).
          const alongX = (v: number) => (xy ? xAt(v) : plot.x + band * (v - 0.5));
          const pts = s.values.flatMap((v, k) => {
            if (v === null) return [];
            const px = alongX(s.x![k]!);
            const py = vPos(a, v);
            return Number.isFinite(px) && Number.isFinite(py) ? [{ x: px, y: py, vx: s.x![k]!, v, size: s.size?.[k] ?? null, k }] : [];
          });
          for (const p of pts) {
            const color = ERR_COLOR;
            const ey = s.errorBars?.y;
            const ex = s.errorBars?.x;
            if (ey) errParts.push(...errorBars(`ey${i}-${p.k}`, p, ey.plus[p.k], ey.minus[p.k], p.v, "y", a, ey.color ?? color, ey.endCap));
            if (ex) errParts.push(...errorBars(`ex${i}-${p.k}`, p, ex.plus[p.k], ex.minus[p.k], p.vx, "x", a, ex.color ?? color, ex.endCap));
          }
          if (scatter && (chart.smooth || chart.lines) && pts.length > 1) parts.push(<path key={`l${i}`} d={chart.smooth ? smoothPath(pts) : `M${pts.map((p) => `${p.x},${p.y}`).join("L")}`} fill="none" stroke={s.color} strokeWidth={2} />);
          if (kind === "scatter" && chart.markers === false) return;
          pts.forEach((p, k) => {
            const fill = pointFill(i, p.k);
            if (bubble) {
              if (p.size === null || p.size <= 0) return;
              const r = Math.max(2, rMax * Math.sqrt(p.size / biggest));
              parts.push(
                <circle key={`m${i}-${k}`} cx={p.x} cy={p.y} r={r} fill={chart.bubble3d ? `url(#${clipId}-s${i}-${p.k})` : fill} fillOpacity={chart.bubble3d ? 1 : 0.6} stroke={fill} className="pli-chart-marker" {...markAttrs(i, cellPoint(p.k), circleHit(p.x, p.y, r), mark)}>
                  <title>{`${s.name}: (${tickLabel(p.vx)}, ${tickLabel(p.v)}), size ${tickLabel(p.size)}`}</title>
                </circle>,
              );
              if (chart.bubble3d) spheres.push(<radialGradient key={`g${i}-${p.k}`} id={`${clipId}-s${i}-${p.k}`} cx="35%" cy="32%" r="70%"><stop offset="0%" stopColor={tint(fill, 0.65)} /><stop offset="55%" stopColor={fill} /><stop offset="100%" stopColor={tint(fill, -0.45)} /></radialGradient>);
            } else {
              parts.push(
                <circle key={`m${i}-${k}`} cx={p.x} cy={p.y} r={4} fill={fill} fillOpacity={0.85} className="pli-chart-marker" {...markAttrs(i, cellPoint(p.k), circleHit(p.x, p.y, 4), mark)}>
                  <title>{`${s.name}: (${tickLabel(p.vx)}, ${tickLabel(p.v)})`}</title>
                </circle>,
              );
            }
            parts.push(pointLabel(`v${i}-${k}`, p.x, p.y, p.v, [i, p.k]));
          });
        });
      }
    }
    // Error bars lie over the marks.
    parts.push(...errParts);

    // ---- trendlines, clipped to the plot, with their equations ----
    const trendLabels: ReactNode[] = [];
    let labelRow = 0;
    series.forEach((s, i) => {
      s.trendlines?.forEach((t, ti) => {
        if (!t.points.length) return;
        const a = axisOf(i);
        const at = (p: [number, number]) => {
          const along = xy ? xAt(p[0]) : horizontal ? plot.y + band * (Math.max(0.5, p[0]) - 0.5) : plot.x + band * (Math.max(0.5, p[0]) - 0.5);
          const across = vPos(a, p[1]);
          return horizontal ? { x: across, y: along } : { x: along, y: across };
        };
        const pts = t.points.map(at);
        parts.push(
          <path key={`tr${i}-${ti}`} d={`M${pts.map((p) => `${p.x},${p.y}`).join("L")}`} stroke={t.color} className="pli-chart-trend" clipPath={`url(#${clipId})`}>
            <title>{[t.name, t.equation, t.rSquared !== undefined ? `R² = ${rSquared(t.rSquared)}` : ""].filter(Boolean).join("\n")}</title>
          </path>,
        );
        const texts = t.labelLines ?? [];
        if (texts.length) {
          const end = pts[pts.length - 1]!;
          const anchorEnd = end.x > plot.x + plot.w * 0.6;
          // The labels stand in a row of their own, one under the other, as near the end of the line as the plot allows; dragging the label moves it from there.
          const first = Math.max(plot.y + 10, Math.min(plot.y + plot.h - 4 - 13 * (labelRow + texts.length - 1), end.y - 6));
          const ox = (t.labelOffset?.x ?? 0) * W;
          const oy = (t.labelOffset?.y ?? 0) * H;
          texts.forEach((text, j) => {
            const y = first + (labelRow + j) * 13 + oy;
            const x = Math.max(plot.x + 2, Math.min(plot.x + plot.w - 2, end.x + (anchorEnd ? -4 : 4))) + ox;
            const width = textWidth(text) * ((t.labelFont?.size ?? 10) / 10);
            trendLabels.push(
              <text key={`trl${i}-${ti}-${j}`} x={x} y={y} textAnchor={anchorEnd ? "end" : "start"} fill={t.color} className="pli-chart-trendlabel" style={fontStyle(t.labelFont)} data-tlabel={`${i}:${ti}`} data-hit={rectHit(anchorEnd ? x - width : x, y - 11, width, 14)}>
                {text}
              </text>,
            );
          });
          labelRow += texts.length;
        }
      });
    });
    parts.push(...trendLabels);

    // Axis titles.
    parts.push(...axisTitles(frame, plot, { bottom: bottomTitle, left: leftTitle, ...(hasSecond || hasSecondXY ? { right: horizontal ? undefined : chart.y2Title } : {}), ...(horizontal && hasSecond ? { top: chart.y2Title } : {}) }, titleLooks(chart)));
    if (secondaryTop && chart.x2Title) parts.push(...axisTitles(frame, plot, { top: chart.x2Title }, titleLooks(chart)));
  }

  // ---- the legend ----
  const legend: ReactNode[] = [];
  if (showLegend) {
    const swatch = (e: LegendEntry, y: number) => (e.dash ? <line x1={0} x2={11} y1={y} y2={y} stroke={e.color} strokeWidth={2} strokeDasharray="4 2" /> : <rect y={y - 5} width={10} height={10} rx={2} fill={e.color} />);
    if (sideLegend) {
      const x = legendAt === "left" ? PAD : W - PAD - legendW;
      const top = PAD + titleH + Math.max(0, (frame.h - entries.length * 20) / 2);
      entries.slice(0, Math.max(1, Math.floor(frame.h / 20))).forEach((e, k) => {
        legend.push(
          <g key={k} transform={`translate(${x},${top + k * 20})`}>
            {swatch(e, 8)}
            <text x={16} y={12} className="pli-chart-label" style={fontStyle(chart.legendFont)}>
              {clip(e.name, Math.max(3, Math.floor((legendW - 18) / CHAR)))}
            </text>
          </g>,
        );
      });
    } else {
      const y = legendAt === "top" ? PAD + titleH + 4 : H - PAD - 14;
      const widths = entries.map((e) => 20 + textWidth(clip(e.name, 20)) + 12);
      const fit = widths.reduce((acc, w) => (acc.sum + w <= W - 2 * PAD ? { sum: acc.sum + w, count: acc.count + 1 } : acc), { sum: 0, count: 0 });
      let x = (W - fit.sum) / 2;
      entries.slice(0, fit.count).forEach((e, k) => {
        legend.push(
          <g key={k} transform={`translate(${x},${y})`}>
            {swatch(e, 7)}
            <text x={15} y={11} className="pli-chart-label" style={fontStyle(chart.legendFont)}>
              {clip(e.name, 20)}
            </text>
          </g>,
        );
        x += widths[k]!;
      });
    }
  }

  return (
    <svg className="pli-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...(chart.view3d && hasData ? { "data-plot3d": [pie ? frame : plot].map((b) => [b.x, b.y, b.w, b.h].map((v) => Math.round(v)).join(","))[0] } : {})} role="img" aria-label={chart.title ?? `${type} chart`} fontSize={FONT} {...(chart.font?.family ? { fontFamily: chart.font.family } : {})}>
      <defs>
        {spheres}
        <clipPath id={clipId}>
          <rect x={plot.x} y={plot.y} width={Math.max(0, plot.w)} height={Math.max(0, plot.h)} />
        </clipPath>
      </defs>
      <rect className="pli-chart-bg" width={W} height={H} />
      {chart.title && (
        <text x={W / 2} y={PAD + 15} textAnchor="middle" className="pli-chart-title" style={fontStyle({ ...chart.font, ...chart.titleFont })}>
          {chart.titleRuns?.length && chart.title.length <= Math.max(8, Math.floor((W - 2 * PAD) / 8))
            ? chart.titleRuns.map((r, i) => (
                <tspan key={i} style={{ ...fontStyle(r), ...(r.underline ? { textDecoration: "underline" } : {}) }}>
                  {r.text}
                </tspan>
              ))
            : clip(chart.title, Math.max(8, Math.floor((W - 2 * PAD) / 8)))}
        </text>
      )}
      {parts}
      {legend}
    </svg>
  );
}

const rSquared = (r: number) => String(Math.round(r * 10000) / 10000);

/** One thing a 3-D scene paints. */
function drawItem(it: Item, i: number): ReactNode {
  if (it.kind === "poly") {
    return (
      <polygon key={i} points={it.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} className={it.cls} {...(it.fill ? { fill: it.fill } : {})} {...(it.stroke ? { stroke: it.stroke, strokeWidth: 0.6 } : {})}>
        {it.title && <title>{it.title}</title>}
      </polygon>
    );
  }
  if (it.kind === "line") return <line key={i} x1={it.a[0]} y1={it.a[1]} x2={it.b[0]} y2={it.b[1]} className={it.cls} />;
  return (
    <text key={i} x={it.at[0]} y={it.at[1]} textAnchor={it.anchor} className={it.cls}>
      {it.text}
    </text>
  );
}
