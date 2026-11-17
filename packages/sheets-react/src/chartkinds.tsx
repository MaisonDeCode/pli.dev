import { type ReactNode } from "react";
import { CHART_COLORS, boxStats, buildTree, formatValue, groupByCategory, histogramBins, paretoSeries, splitOfPie, squarify, sunburstArcs, waterfallSteps, type Bin, type Chart, type ChartData, type ChartFont, type ChartTitleRun, type TreeNode } from "@pli.dev/sheets";
import { axisLook, drawCategoryAxis, drawValueAxis, fontStyle } from "./chartaxes";
import { arcHit, circleHit, markAttrs, rectHit, type MarkRef } from "./chartmarks";
import { crossingValue, explodedCentre, explosionOf, fracOf, labelText, maxExplosion, ringPath, scaleTicks, slicePath, tickLabel, tint, type Ticks } from "./chartmath";

/*
 * The drawing of the chart kinds that don't share the main cartesian drawing in ChartView: doughnut, pie-of-pie and
 * bar-of-pie, radar, waterfall, histogram, Pareto, box and whisker, funnel, treemap and sunburst. Each gets the box
 * left for the plot (inside the title and legend) and returns what to paint and what the legend lists.
 */

export const FONT = 11;
export const CHAR = 6.2; // an average character at 11px, for fitting labels without measuring
export const textWidth = (s: string) => s.length * CHAR;
export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);
export const percent = (n: number) => `${Math.round(n * 1000) / 10}%`;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegendEntry {
  name: string;
  color: string;
  /** Drawn as a dashed line (a trendline). */
  dash?: boolean;
}

export interface KindResult {
  parts: ReactNode[];
  /** What the legend lists; when missing, the chart's series. */
  entries?: LegendEntry[];
  /** Always show the legend entries, even a single one. */
  force?: boolean;
}

const colorOf = (data: ChartData, i: number) => data.series[i]?.color ?? CHART_COLORS[i % CHART_COLORS.length]!;
const basePie = (k: number) => CHART_COLORS[k % CHART_COLORS.length]!;
/** The colour of point `k` of series `i`: its own, or the series'. */
const pointColor = (data: ChartData, i: number, k: number) => data.series[i]?.pointColors?.[String(k)] ?? colorOf(data, i);

// ---------------------------------------------------------------- axes shared with the main drawing

/** The part of the frame left for the plot once the tick labels and axis titles have their room. */
export function plotBox(frame: Box, o: { left: string[]; leftTitle?: string | undefined; bottomTitle?: string | undefined; right?: string[]; rightTitle?: string | undefined; top?: boolean; topTitle?: boolean }): Box {
  const yW = Math.max(...o.left.map(textWidth), 0) + 10;
  const yTitleW = o.leftTitle ? 18 : 0;
  const xTitleH = o.bottomTitle ? 18 : 0;
  const rightW = o.right ? Math.max(...o.right.map(textWidth), 0) + 10 + (o.rightTitle ? 18 : 0) : 0;
  const topH = o.top ? 16 + (o.topTitle ? 14 : 0) : 0;
  return { x: frame.x + yW + yTitleW, y: frame.y + 6 + topH, w: frame.w - yW - yTitleW - 6 - rightW, h: frame.h - 6 - topH - 20 - xTitleH };
}

/** How the title of an axis looks: its font, or its text in pieces with a look each. */
export interface TitleLook {
  font?: ChartFont | undefined;
  runs?: ChartTitleRun[] | undefined;
}
export type TitleLooks = { bottom?: TitleLook; left?: TitleLook; right?: TitleLook; top?: TitleLook };

/** The looks of the titles round a plot: on a bar chart the category axis is the vertical one, so `x` is on the left. */
export function titleLooks(chart: Pick<Chart, "type" | "axes" | "font">, horizontal = chart.type === "bar"): TitleLooks {
  const look = (key: "x" | "y" | "x2" | "y2"): TitleLook => ({ font: chart.axes?.[key]?.titleFont, runs: chart.axes?.[key]?.titleRuns });
  return horizontal ? { bottom: look("y"), left: look("x"), right: look("x2"), top: look("y2") } : { bottom: look("x"), left: look("y"), right: look("y2"), top: look("x2") };
}

/** The text of a title: its pieces (each with a look of its own) or just the text. */
function titleContent(text: string, look?: TitleLook): ReactNode {
  if (!look?.runs?.length) return text;
  return look.runs.map((r, i) => (
    <tspan key={i} style={{ ...fontStyle(r), ...(r.underline ? { textDecoration: "underline" } : {}) }}>
      {r.text}
    </tspan>
  ));
}

/** Titles beside the axes. */
export function axisTitles(frame: Box, plot: Box, t: { bottom?: string | undefined; left?: string | undefined; right?: string | undefined; top?: string | undefined }, looks: TitleLooks = {}): ReactNode[] {
  const out: ReactNode[] = [];
  if (t.bottom) out.push(<text key="xt" x={plot.x + plot.w / 2} y={frame.y + frame.h - 4} textAnchor="middle" className="pli-chart-axistitle" style={fontStyle(looks.bottom?.font)}>{titleContent(t.bottom, looks.bottom)}</text>);
  if (t.left) out.push(<text key="yt" transform={`translate(${frame.x + 9},${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" className="pli-chart-axistitle" style={fontStyle(looks.left?.font)}>{titleContent(t.left, looks.left)}</text>);
  if (t.right) out.push(<text key="y2t" transform={`translate(${frame.x + frame.w - 9},${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" className="pli-chart-axistitle" style={fontStyle(looks.right?.font)}>{titleContent(t.right, looks.right)}</text>);
  if (t.top) out.push(<text key="x2t" x={plot.x + plot.w / 2} y={frame.y + 11} textAnchor="middle" className="pli-chart-axistitle" style={fontStyle(looks.top?.font)}>{titleContent(t.top, looks.top)}</text>);
  return out;
}

/** The value axis up the side of a plot: labels, and gridlines for the left one. */
export function valueAxisY(plot: Box, ticks: Ticks, fmt: (v: number) => string, side: "left" | "right", key: string): ReactNode[] {
  const out: ReactNode[] = [];
  for (const t of ticks.ticks) {
    const y = plot.y + plot.h - ((t - ticks.min) / (ticks.max - ticks.min)) * plot.h;
    if (side === "left") out.push(<line key={`${key}g${t}`} x1={plot.x} x2={plot.x + plot.w} y1={y} y2={y} className={t === 0 ? "pli-chart-axis" : "pli-chart-grid"} />);
    out.push(
      <text key={`${key}t${t}`} x={side === "left" ? plot.x - 6 : plot.x + plot.w + 6} y={y + 4} textAnchor={side === "left" ? "end" : "start"} className="pli-chart-label">
        {fmt(t)}
      </text>,
    );
  }
  return out;
}

/** Labels along the bottom (or the top) of a plot, one band each, thinned out when they would run into each other. */
export function bandLabels(plot: Box, labels: readonly string[], band: number, key: string, at: "bottom" | "top" = "bottom"): ReactNode[] {
  const longest = Math.min(12, Math.max(0, ...labels.map((c) => c.length)));
  const every = Math.max(1, Math.ceil((longest * CHAR + 6) / Math.max(band, 1)));
  const y = at === "bottom" ? plot.y + plot.h + 15 : plot.y - 6;
  const out: ReactNode[] = [];
  labels.forEach((c, k) => {
    if (k % every || c === "") return;
    out.push(
      <text key={`${key}${k}`} x={plot.x + band * (k + 0.5)} y={y} textAnchor="middle" className="pli-chart-label">
        {clip(c, Math.max(3, Math.floor((band * every) / CHAR)))}
      </text>,
    );
  });
  return out;
}

const scaleY = (plot: Box, ticks: Ticks) => (v: number) => plot.y + plot.h - fracOf(ticks, v) * plot.h;

/** The format a chart's value axis labels with: the axis's own number format, or the shortened numbers. */
const labeller = (chart: Chart, key: "y" | "y2" = "y") => {
  const format = chart.axes?.[key]?.format;
  return format ? (v: number) => formatValue(v, format).text : tickLabel;
};

/** Value axis on the left and a category axis along the bottom, for the kinds that draw bars on categories. */
function barAxes(chart: Chart, plot: Box, ticks: Ticks, labels: readonly string[], band: number, key: string, count = labels.length): ReactNode[] {
  const y = scaleY(plot, ticks);
  const cross = y(crossingValue(ticks, chart.axes?.y?.crosses));
  return [
    ...drawValueAxis({ key: `${key}v`, plot, ticks, fmt: labeller(chart), vertical: true, look: axisLook(chart, "y"), side: "start", font: chart.axes?.y?.font }),
    ...drawCategoryAxis({ key: `${key}c`, plot, labels, count, band, horizontal: true, look: axisLook(chart, "x"), side: "start", ...(Number.isFinite(cross) ? { at: cross } : {}), labelEvery: chart.axes?.x?.labelEvery, tickEvery: chart.axes?.x?.tickEvery, font: chart.axes?.x?.font }),
  ];
}

/** The lowest and highest of some numbers, for a scale; a log scale starts at the lowest positive one. */
function range(chart: Chart, nums: number[], zero: boolean): { lo: number; hi: number } {
  const ax = chart.axes?.y;
  const good = nums.filter((v) => Number.isFinite(v));
  if (ax?.log) {
    const pos = good.filter((v) => v > 0);
    return { lo: pos.length ? Math.min(...pos) : 1, hi: good.length ? Math.max(...good) : 10 };
  }
  return { lo: Math.min(...(zero ? [0] : []), ...good), hi: Math.max(...(zero ? [0] : []), ...good) };
}

function numbers(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

// ---------------------------------------------------------------- doughnut

export function drawDoughnut(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const pieColor = (k: number) => data.series[0]?.pointColors?.[String(k)] ?? basePie(k);
  const parts: ReactNode[] = [];
  const series = data.series.filter((s) => s.values.some((v) => v !== null));
  const specs = chart.series.filter((_, i) => data.series[i]?.values.some((v) => v !== null));
  const R = Math.max(10, (Math.min(frame.w, frame.h) / 2 - 6) / (1 + Math.max(0, ...specs.map((sp) => maxExplosion(sp, data.categories.length))) / 100));
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const hole = R * ((chart.holeSize ?? 50) / 100);
  const ring = (R - hole) / Math.max(1, series.length);
  series.forEach((s, i) => {
    const values = s.values.map((v) => Math.max(0, v ?? 0));
    const total = values.reduce((a, b) => a + b, 0);
    const r0 = hole + i * ring;
    const r1 = r0 + ring;
    if (!total) {
      parts.push(<path key={`e${i}`} d={ringPath(cx, cy, r0, r1, 0, Math.PI * 2)} className="pli-chart-empty" fillRule="evenodd" />);
      return;
    }
    let a = ((chart.firstSliceAngle ?? 0) * Math.PI) / 180;
    values.forEach((v, k) => {
      if (!v) return;
      const a1 = a + (v / total) * Math.PI * 2;
      const mid = (a + a1) / 2;
      const c = explodedCentre(cx, cy, R, mid, explosionOf(specs[i], k));
      parts.push(
        <path key={`s${i}-${k}`} d={ringPath(c.cx, c.cy, r0, r1, a, a1)} fill={pieColor(k)} fillRule="evenodd" className="pli-chart-slice" {...markAttrs(i, k, arcHit(c.cx, c.cy, r0, r1, a, a1), mark)}>
          <title>{`${series.length > 1 ? `${s.name}, ` : ""}${data.categories[k]}: ${tickLabel(v)} (${percent(v / total)})`}</title>
        </path>,
      );
      if (chart.labels && v / total > 0.04) {
        const r = (r0 + r1) / 2;
        parts.push(<text key={`l${i}-${k}`} x={c.cx + r * Math.sin(mid)} y={c.cy - r * Math.cos(mid) + 4} textAnchor="middle" className="pli-chart-onmark">{labelText(chart, { value: tickLabel(v), category: data.categories[k] ?? "", series: s.name, percent: percent(v / total) }, ["percent"])}</text>);
      }
      a = a1;
    });
  });
  return { parts, entries: data.categories.map((name, k) => ({ name, color: pieColor(k) })), force: true };
}

// ---------------------------------------------------------------- pie of pie and bar of pie

export function drawOfPie(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const pieColor = (k: number) => data.series[0]?.pointColors?.[String(k)] ?? basePie(k);
  const parts: ReactNode[] = [];
  const values = data.series[0]?.values ?? [];
  const { main, second } = splitOfPie(values, chart.split);
  const total = main.reduce((s, p) => s + p.value, 0);
  const entries = data.categories.map((name, k) => ({ name, color: pieColor(k) }));
  if (!total) {
    parts.push(<circle key="p" cx={frame.x + frame.w / 4} cy={frame.y + frame.h / 2} r={Math.max(10, Math.min(frame.w / 4, frame.h / 2) - 6)} className="pli-chart-empty" />);
    return { parts, entries, force: true };
  }
  const bar = chart.type === "barOfPie";
  const size = (chart.secondSize ?? 75) / 100;
  // The first pie sits on the left, the second plot on the right; together they fill the frame's width.
  const pull = 1 + maxExplosion(chart.series[0], data.categories.length) / 100;
  const r1 = Math.max(10, Math.min(frame.h / 2 - 6, bar ? (frame.w - 30 - 46) / 2.4 : (frame.w - 30) / (2 + 2 * size + 0.5)) / pull);
  const cx1 = frame.x + r1 + 6;
  const cy = frame.y + frame.h / 2;
  // Turn the first pie so that the combined slice (the last one) is centred at three o'clock, facing the second plot.
  const other = main.find((p) => p.index === null);
  const otherSpan = other ? (other.value / total) * Math.PI * 2 : 0;
  let a = other ? Math.PI / 2 + otherSpan / 2 : 0;
  const slices: { from: number; to: number }[] = [];
  main.forEach((p, k) => {
    const a1 = a + (p.value / total) * Math.PI * 2;
    slices.push({ from: a, to: a1 });
    if (p.value) {
      const mid = (a + a1) / 2;
      const name = p.index === null ? "Other" : data.categories[p.index];
      const color = p.index === null ? "#9aa0a6" : pieColor(p.index);
      const ce = explodedCentre(cx1, cy, r1, mid, p.index === null ? 0 : explosionOf(chart.series[0], p.index));
      parts.push(
        <path key={`s${k}`} d={slicePath(ce.cx, ce.cy, r1, a, a1)} fill={color} className="pli-chart-slice" {...(p.index === null ? {} : markAttrs(0, p.index, arcHit(ce.cx, ce.cy, 0, r1, a, a1), mark))}>
          <title>{`${name}: ${tickLabel(p.value)} (${percent(p.value / total)})`}</title>
        </path>,
      );
      if (chart.labels && p.value / total > 0.04) parts.push(<text key={`l${k}`} x={cx1 + r1 * 0.65 * Math.sin(mid)} y={cy - r1 * 0.65 * Math.cos(mid) + 4} textAnchor="middle" className="pli-chart-onmark">{labelText(chart, { value: tickLabel(p.value), category: p.index === null ? "Other" : data.categories[p.index] ?? "", percent: percent(p.value / total) }, ["percent"])}</text>);
    }
    a = a1;
  });
  if (second.length) {
    const secTotal = second.reduce((s, p) => s + p.value, 0);
    const last = slices[slices.length - 1]!;
    const pt = (ang: number) => ({ x: cx1 + r1 * Math.sin(ang), y: cy - r1 * Math.cos(ang) });
    if (bar) {
      const bw = Math.min(frame.w * 0.14, 46);
      const bh = Math.max(20, 2 * r1 * size);
      const bx = frame.x + frame.w - bw - 12;
      const by = cy - bh / 2;
      let y = by;
      second.forEach((p, k) => {
        const h = secTotal ? (p.value / secTotal) * bh : 0;
        parts.push(
          <rect key={`b${k}`} x={bx} y={y} width={bw} height={h} fill={pieColor(p.index)} className="pli-chart-bar" {...markAttrs(0, p.index, rectHit(bx, y, bw, h), mark)}>
            <title>{`${data.categories[p.index]}: ${tickLabel(p.value)} (${percent(p.value / total)})`}</title>
          </rect>,
        );
        if (chart.labels && h > 14) parts.push(<text key={`bl${k}`} x={bx + bw / 2} y={y + h / 2 + 4} textAnchor="middle" className="pli-chart-onmark">{percent(p.value / total)}</text>);
        y += h;
      });
      parts.push(<line key="c1" x1={pt(last.from).x} y1={pt(last.from).y} x2={bx} y2={by} className="pli-chart-grid" />, <line key="c2" x1={pt(last.to).x} y1={pt(last.to).y} x2={bx} y2={by + bh} className="pli-chart-grid" />);
    } else {
      const r2 = Math.max(8, r1 * size);
      const cx2 = frame.x + frame.w - r2 - 12;
      let b = 0;
      second.forEach((p, k) => {
        const b1 = b + (secTotal ? (p.value / secTotal) * Math.PI * 2 : 0);
        const mid = (b + b1) / 2;
        parts.push(
          <path key={`q${k}`} d={slicePath(cx2, cy, r2, b, b1)} fill={pieColor(p.index)} className="pli-chart-slice" {...markAttrs(0, p.index, arcHit(cx2, cy, 0, r2, b, b1), mark)}>
            <title>{`${data.categories[p.index]}: ${tickLabel(p.value)} (${percent(p.value / total)})`}</title>
          </path>,
        );
        if (chart.labels && (p.value / (secTotal || 1)) > 0.06) parts.push(<text key={`ql${k}`} x={cx2 + r2 * 0.65 * Math.sin(mid)} y={cy - r2 * 0.65 * Math.cos(mid) + 4} textAnchor="middle" className="pli-chart-onmark">{percent(p.value / total)}</text>);
        b = b1;
      });
      parts.push(<line key="c1" x1={pt(last.from).x} y1={pt(last.from).y} x2={cx2} y2={cy - r2} className="pli-chart-grid" />, <line key="c2" x1={pt(last.to).x} y1={pt(last.to).y} x2={cx2} y2={cy + r2} className="pli-chart-grid" />);
    }
  }
  return { parts, entries, force: true };
}

// ---------------------------------------------------------------- radar

export function drawRadar(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const parts: ReactNode[] = [];
  const n = Math.max(3, data.categories.length);
  const all = data.series.flatMap((s) => numbers(s.values));
  const ticks = scaleTicks(chart.axes?.y, Math.min(0, ...all), Math.max(0, ...all));
  const yLook = axisLook(chart, "y");
  const spokes = axisLook(chart, "x").gridMajor;
  const R = Math.max(20, Math.min(frame.w, frame.h) / 2 - 22);
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const angle = (k: number) => (k / n) * Math.PI * 2;
  const rOf = (v: number) => ((v - ticks.min) / (ticks.max - ticks.min)) * R;
  const at = (k: number, r: number) => ({ x: cx + r * Math.sin(angle(k)), y: cy - r * Math.cos(angle(k)) });
  ticks.ticks.forEach((t, i) => {
    const r = rOf(t);
    if (r <= 0) return;
    const pts = Array.from({ length: n }, (_, k) => at(k, r));
    if (yLook.gridMajor) parts.push(<polygon key={`g${i}`} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="pli-chart-grid" />);
    if (yLook.labels !== "none" && !yLook.hidden) parts.push(<text key={`gt${i}`} x={cx + 3} y={cy - r + 11} className="pli-chart-label">{labeller(chart)(t)}</text>);
  });
  for (let k = 0; k < n; k++) {
    const p = at(k, R);
    if (spokes) parts.push(<line key={`sp${k}`} x1={cx} y1={cy} x2={p.x} y2={p.y} className="pli-chart-grid" />);
    const q = at(k, R + 10);
    const label = data.categories[k] ?? "";
    parts.push(<text key={`c${k}`} x={q.x} y={q.y + 4} textAnchor={Math.abs(q.x - cx) < 4 ? "middle" : q.x > cx ? "start" : "end"} className="pli-chart-label">{clip(label, 14)}</text>);
  }
  data.series.forEach((s, i) => {
    const pts = Array.from({ length: n }, (_, k) => {
      const v = s.values[k];
      return v === null || v === undefined ? null : { ...at(k, rOf(v)), v };
    });
    const path = pts.filter((p): p is NonNullable<typeof p> => p !== null);
    if (!path.length) return;
    const poly = path.map((p) => `${p.x},${p.y}`).join(" ");
    if (chart.filled) parts.push(<polygon key={`f${i}`} points={poly} fill={s.color} fillOpacity={0.45} stroke={s.color} strokeWidth={1.5} className="pli-chart-area" />);
    else parts.push(<polygon key={`f${i}`} points={poly} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" />);
    if (!chart.filled && chart.markers !== false) {
      pts.forEach((p, k) => {
        if (p) parts.push(<circle key={`m${i}-${k}`} cx={p.x} cy={p.y} r={3.5} fill={pointColor(data, i, k)} className="pli-chart-marker" {...markAttrs(i, k, circleHit(p.x, p.y, 4), mark)}><title>{`${s.name}: ${tickLabel(p.v)}`}</title></circle>);
      });
    }
    if (chart.labels) path.forEach((p, k) => parts.push(<text key={`v${i}-${k}`} x={p.x} y={p.y - 7} textAnchor="middle" className="pli-chart-value">{tickLabel(p.v)}</text>));
  });
  return { parts };
}

// ---------------------------------------------------------------- waterfall

/** Where a bar's value label goes, given the bar's top and bottom (page y) and where `labelPosition` asks for it; outside the end by default. */
function barLabelY(pos: Chart["labelPosition"], top: number, bottom: number, up: boolean): { y: number } {
  const p = pos ?? "outsideEnd";
  if (p === "center") return { y: (top + bottom) / 2 + 4 };
  if (p === "insideEnd") return { y: up ? top + 13 : bottom - 4 };
  if (p === "insideBase") return { y: up ? bottom - 4 : top + 13 };
  return { y: up ? top - 4 : bottom + 13 };
}

/** The room a scale's labels take at the left of a plot: none when the axis shows none. */
const leftLabels = (chart: Chart, ticks: Ticks, key: "y" = "y"): string[] => {
  const l = axisLook(chart, key);
  return l.labels === "none" || l.hidden ? [] : ticks.ticks.map(labeller(chart, key));
};

export function drawWaterfall(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const parts: ReactNode[] = [];
  const values = data.series[0]?.values ?? [];
  const steps = waterfallSteps(values, chart.totals);
  const n = steps.length;
  const { lo, hi } = range(chart, steps.flatMap((s) => [s.from, s.to]), true);
  const ticks = scaleTicks(chart.axes?.y, lo, hi);
  const plot = plotBox(frame, { left: leftLabels(chart, ticks), leftTitle: chart.yTitle, bottomTitle: chart.xTitle });
  const yRaw = scaleY(plot, ticks);
  const y = (v: number) => (Number.isFinite(yRaw(v)) ? yRaw(v) : yRaw(ticks.min));
  const band = plot.w / Math.max(1, n);
  const colors = { increase: chart.waterfall?.increaseColor ?? CHART_COLORS[0]!, decrease: chart.waterfall?.decreaseColor ?? CHART_COLORS[1]!, total: chart.waterfall?.totalColor ?? CHART_COLORS[2]! };
  parts.push(...barAxes(chart, plot, ticks, data.categories, band, "w", n));
  steps.forEach((s, k) => {
    const top = Math.min(y(s.from), y(s.to));
    const bottom = Math.max(y(s.from), y(s.to));
    const h = Math.max(1, bottom - top);
    const delta = values[k] ?? 0;
    parts.push(
      <rect key={`b${k}`} x={plot.x + band * k + band * 0.1} y={top} width={band * 0.8} height={h} fill={data.series[0]?.pointColors?.[String(k)] ?? colors[s.kind]} className="pli-chart-bar" {...markAttrs(0, k, rectHit(plot.x + band * k + band * 0.1, top, band * 0.8, h), mark)}>
        <title>{`${data.categories[k]}: ${s.kind === "total" ? "total " : ""}${tickLabel(delta)}`}</title>
      </rect>,
    );
    if (chart.waterfall?.connectors !== false && k + 1 < n) parts.push(<line key={`k${k}`} x1={plot.x + band * k + band * 0.9} x2={plot.x + band * (k + 1) + band * 0.1} y1={y(s.to)} y2={y(s.to)} className="pli-chart-axis" />);
    if (chart.labels) {
      const text = labelText(chart, { value: s.kind === "total" ? tickLabel(delta) : `${delta > 0 ? "+" : ""}${tickLabel(delta)}`, category: data.categories[k] ?? "", series: data.series[0]?.name ?? "" });
      parts.push(<text key={`v${k}`} x={plot.x + band * (k + 0.5)} y={barLabelY(chart.labelPosition, top, bottom, delta >= 0).y} textAnchor="middle" className="pli-chart-value">{text}</text>);
    }
  });
  parts.push(...axisTitles(frame, plot, { bottom: chart.xTitle, left: chart.yTitle }, titleLooks(chart)));
  return { parts, entries: [{ name: "Increase", color: colors.increase }, { name: "Decrease", color: colors.decrease }, { name: "Total", color: colors.total }], force: true };
}

// ---------------------------------------------------------------- histogram and Pareto

/**
 * The bins of a histogram of several series: Excel cuts the values of every series with the same edges, so the bins come
 * from all the values together and each series is counted into them.
 */
export function sharedBins(chart: Chart, data: ChartData): { bins: Bin[]; counts: number[][] } {
  const bins = histogramBins(data.series.flatMap((s) => s.values), chart.bins);
  const inBin = (b: Bin, v: number) => (b.fromClosed ? v >= b.from : v > b.from) && (b.toClosed ? v <= b.to : v < b.to);
  return { bins, counts: data.series.map((s) => bins.map((b) => s.values.filter((v): v is number => v !== null && inBin(b, v)).length)) };
}

export function drawHistogram(chart: Chart, data: ChartData, frame: Box): KindResult {
  const parts: ReactNode[] = [];
  const { bins, counts } = sharedBins(chart, data);
  const ticks = scaleTicks(chart.axes?.y, ...Object.values(range(chart, [0, Math.max(1, ...counts.flat())], true)) as [number, number]);
  const plot = plotBox(frame, { left: leftLabels(chart, ticks), leftTitle: chart.yTitle, bottomTitle: chart.xTitle });
  const y = scaleY(plot, ticks);
  const band = plot.w / Math.max(1, bins.length);
  parts.push(...barAxes(chart, plot, ticks, bins.map((b) => b.label), band, "h", bins.length));
  const several = data.series.length;
  const w = Math.max(1, band - 1) / several;
  bins.forEach((b, k) => {
    data.series.forEach((s, si) => {
      const count = counts[si]![k]!;
      const top = Number.isFinite(y(count)) ? y(count) : y(ticks.min);
      const base = Number.isFinite(y(0)) ? y(0) : y(ticks.min);
      parts.push(
        <rect key={`b${k}-${si}`} x={plot.x + band * k + 0.5 + w * si} y={top} width={w} height={Math.max(0, base - top)} fill={s.color} className="pli-chart-bar">
          <title>{`${several > 1 ? `${s.name}, ` : ""}${b.label}: ${count}`}</title>
        </rect>,
      );
      if (chart.labels && count) parts.push(<text key={`v${k}-${si}`} x={plot.x + band * k + 0.5 + w * (si + 0.5)} y={barLabelY(chart.labelPosition, top, base, true).y} textAnchor="middle" className="pli-chart-value">{labelText(chart, { value: String(count), category: b.label, series: s.name })}</text>);
    });
  });
  parts.push(...axisTitles(frame, plot, { bottom: chart.xTitle, left: chart.yTitle }, titleLooks(chart)));
  return { parts, entries: several > 1 ? data.series.map((s) => ({ name: s.name, color: s.color })) : [], force: several > 1 };
}

export function drawPareto(chart: Chart, data: ChartData, frame: Box): KindResult {
  const parts: ReactNode[] = [];
  const { categories, lines } = paretoSeries(data.categories, data.series.map((s) => s.values));
  const ticks = scaleTicks(chart.axes?.y, ...Object.values(range(chart, [0, Math.max(1, ...lines.flat().map((p) => p.value))], true)) as [number, number]);
  const pct: Ticks = { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  const plot = plotBox(frame, { left: leftLabels(chart, ticks), leftTitle: chart.yTitle, bottomTitle: chart.xTitle, right: pct.ticks.map(percent) });
  const y = scaleY(plot, ticks);
  const yp = scaleY(plot, pct);
  const band = plot.w / Math.max(1, categories.length);
  parts.push(...barAxes(chart, plot, ticks, categories, band, "p"), ...valueAxisRight(plot, pct));
  const several = data.series.length;
  const w = (band * 0.8) / several;
  const out: { name: string; color: string }[] = [];
  lines.forEach((pts, si) => {
    const s = data.series[si]!;
    pts.forEach((p, k) => {
      const top = Number.isFinite(y(p.value)) ? y(p.value) : y(ticks.min);
      const base = Number.isFinite(y(0)) ? y(0) : y(ticks.min);
      parts.push(
        <rect key={`b${si}-${k}`} x={plot.x + band * k + band * 0.1 + w * si} y={top} width={w} height={Math.max(0, base - top)} fill={s.color} className="pli-chart-bar">
          <title>{`${several > 1 ? `${s.name}, ` : ""}${p.category}: ${tickLabel(p.value)}`}</title>
        </rect>,
      );
      if (chart.labels) parts.push(<text key={`v${si}-${k}`} x={plot.x + band * k + band * 0.1 + w * (si + 0.5)} y={barLabelY(chart.labelPosition, top, base, true).y} textAnchor="middle" className="pli-chart-value">{labelText(chart, { value: tickLabel(p.value), category: p.category, series: s.name })}</text>);
    });
    out.push({ name: s.name, color: s.color });
  });
  const lineEntries: { name: string; color: string }[] = [];
  lines.forEach((pts, si) => {
    const color = several > 1 ? CHART_COLORS[(si + several) % CHART_COLORS.length]! : CHART_COLORS[1]!;
    const path = pts.map((p, k) => `${plot.x + band * (k + 0.5)},${yp(p.cumulative)}`);
    parts.push(<path key={`line${si}`} d={`M${path.join("L")}`} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" />);
    pts.forEach((p, k) => parts.push(<circle key={`m${si}-${k}`} cx={plot.x + band * (k + 0.5)} cy={yp(p.cumulative)} r={3.5} fill={color} className="pli-chart-marker"><title>{`${p.category}: ${percent(p.cumulative)}`}</title></circle>));
    lineEntries.push({ name: several > 1 ? `${data.series[si]!.name} cumulative %` : "Cumulative %", color });
  });
  parts.push(...axisTitles(frame, plot, { bottom: chart.xTitle, left: chart.yTitle }, titleLooks(chart)));
  return { parts, entries: [...out, ...lineEntries] };
}

/** The percent axis on the right of a Pareto chart. */
function valueAxisRight(plot: Box, pct: Ticks): ReactNode[] {
  return drawValueAxis({ key: "pp", plot, ticks: pct, fmt: percent, vertical: true, look: { gridMajor: false, gridMinor: false, tickMajor: "out", tickMinor: "none", labels: "nextTo", hidden: false }, side: "end" });
}

// ---------------------------------------------------------------- box and whisker

export function drawBox(chart: Chart, data: ChartData, frame: Box): KindResult {
  const parts: ReactNode[] = [];
  const opts = chart.box ?? {};
  const method = opts.quartile ?? "exclusive";
  const hasCats = !!chart.categories;
  // Groups of values: for each category (or for the whole series when there are none), the values of each series.
  const cats: string[] = [];
  const grouped = data.series.map((s) => {
    const groups = groupByCategory(s.values, hasCats ? data.categories : null);
    for (const g of groups) if (!cats.includes(g.name)) cats.push(g.name);
    return groups;
  });
  const boxes = cats.map((c) => data.series.map((_, si) => boxStats(grouped[si]!.find((g) => g.name === c)?.values ?? [], method)));
  const all = boxes.flat().flatMap((b) => (b ? [b.min, b.max] : []));
  const { lo, hi } = range(chart, all, true);
  const ticks = scaleTicks(chart.axes?.y, lo, hi);
  const plot = plotBox(frame, { left: leftLabels(chart, ticks), leftTitle: chart.yTitle, bottomTitle: chart.xTitle });
  const yRaw = scaleY(plot, ticks);
  const y = (v: number) => (Number.isFinite(yRaw(v)) ? yRaw(v) : yRaw(ticks.min));
  const band = plot.w / Math.max(1, hasCats ? cats.length : data.series.length);
  const labels = hasCats ? cats : data.series.map((s) => s.name);
  parts.push(...barAxes(chart, plot, ticks, labels, band, "x"));
  const nS = hasCats ? data.series.length : 1;
  const slot = (band * 0.8) / nS;
  const means: Record<number, { x: number; y: number }[]> = {};
  boxes.forEach((row, ci) => {
    row.forEach((b, si) => {
      if (!b) return;
      const color = colorOf(data, si);
      const bi = hasCats ? ci : si;
      const left = plot.x + band * bi + band * 0.1 + (hasCats ? si * slot : 0);
      const w = (hasCats ? slot : band * 0.8) * 0.8;
      const x0 = left + ((hasCats ? slot : band * 0.8) - w) / 2;
      const mid = x0 + w / 2;
      const name = `${data.series[si]!.name}${hasCats ? `, ${cats[ci]}` : ""}`;
      parts.push(
        <line key={`wl${ci}-${si}`} x1={mid} x2={mid} y1={y(b.low)} y2={y(b.q1)} stroke={color} strokeWidth={1.5} />,
        <line key={`wh${ci}-${si}`} x1={mid} x2={mid} y1={y(b.q3)} y2={y(b.high)} stroke={color} strokeWidth={1.5} />,
        <line key={`cl${ci}-${si}`} x1={mid - w / 4} x2={mid + w / 4} y1={y(b.low)} y2={y(b.low)} stroke={color} strokeWidth={1.5} />,
        <line key={`ch${ci}-${si}`} x1={mid - w / 4} x2={mid + w / 4} y1={y(b.high)} y2={y(b.high)} stroke={color} strokeWidth={1.5} />,
        <rect key={`bx${ci}-${si}`} x={x0} y={y(b.q3)} width={w} height={Math.max(1, y(b.q1) - y(b.q3))} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={1.5} className="pli-chart-bar">
          <title>{`${name}: median ${tickLabel(b.median)}, quartiles ${tickLabel(b.q1)} to ${tickLabel(b.q3)}, whiskers ${tickLabel(b.low)} to ${tickLabel(b.high)}, mean ${tickLabel(b.mean)}`}</title>
        </rect>,
        <line key={`md${ci}-${si}`} x1={x0} x2={x0 + w} y1={y(b.median)} y2={y(b.median)} stroke={color} strokeWidth={2.25} />,
      );
      if (opts.meanMarker !== false) parts.push(<path key={`mm${ci}-${si}`} d={`M${mid - 4},${y(b.mean) - 4}L${mid + 4},${y(b.mean) + 4}M${mid + 4},${y(b.mean) - 4}L${mid - 4},${y(b.mean) + 4}`} stroke={color} strokeWidth={1.5} fill="none" />);
      if (opts.outliers !== false) b.outliers.forEach((o, k) => parts.push(<circle key={`o${ci}-${si}-${k}`} cx={mid} cy={y(o)} r={3} fill="none" stroke={color} strokeWidth={1.25} className="pli-chart-marker"><title>{tickLabel(o)}</title></circle>));
      if (opts.innerPoints) {
        const raw = grouped[si]!.find((g) => g.name === cats[ci])?.values ?? [];
        raw.filter((v) => v >= b.low && v <= b.high).forEach((v, k) => parts.push(<circle key={`i${ci}-${si}-${k}`} cx={mid + ((k % 3) - 1) * 4} cy={y(v)} r={2.25} fill={color} className="pli-chart-marker"><title>{tickLabel(v)}</title></circle>));
      }
      (means[si] ??= []).push({ x: mid, y: y(b.mean) });
    });
  });
  if (opts.meanLine) {
    Object.entries(means).forEach(([si, pts]) => {
      if (pts.length > 1) parts.push(<path key={`ml${si}`} d={`M${pts.map((p) => `${p.x},${p.y}`).join("L")}`} fill="none" stroke={colorOf(data, Number(si))} strokeWidth={1.25} strokeDasharray="4 3" />);
    });
  }
  parts.push(...axisTitles(frame, plot, { bottom: chart.xTitle, left: chart.yTitle }, titleLooks(chart)));
  return { parts };
}

// ---------------------------------------------------------------- funnel

export function drawFunnel(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const parts: ReactNode[] = [];
  const values = (data.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const max = Math.max(1e-9, ...values);
  const xLook = axisLook(chart, "x");
  const showNames = xLook.labels !== "none" && !xLook.hidden;
  const labelW = showNames ? Math.min(frame.w * 0.3, Math.max(0, ...data.categories.map((c) => textWidth(clip(c, 14)))) + 10) : 0;
  const x0 = frame.x + labelW;
  const w = frame.w - labelW;
  const rowH = frame.h / Math.max(1, values.length);
  const color = colorOf(data, 0);
  values.forEach((v, k) => {
    const bw = (v / max) * w;
    const top = frame.y + rowH * k + rowH * 0.06;
    if (showNames) parts.push(<text key={`c${k}`} x={x0 - 6} y={frame.y + rowH * (k + 0.5) + 4} textAnchor="end" className="pli-chart-label">{clip(data.categories[k] ?? "", 14)}</text>);
    parts.push(
      <rect key={`b${k}`} x={x0 + (w - bw) / 2} y={top} width={bw} height={rowH * 0.88} fill={data.series[0]?.pointColors?.[String(k)] ?? color} className="pli-chart-bar" {...markAttrs(0, k, rectHit(x0 + (w - bw) / 2, top, bw, rowH * 0.88), mark)}>
        <title>{`${data.categories[k]}: ${tickLabel(v)}`}</title>
      </rect>,
    );
    const text = labelText(chart, { value: tickLabel(v), category: data.categories[k] ?? "", series: data.series[0]?.name ?? "" });
    if (chart.labels && text && bw > textWidth(text) + 8) parts.push(<text key={`v${k}`} x={x0 + w / 2} y={frame.y + rowH * (k + 0.5) + 4} textAnchor="middle" className="pli-chart-onmark">{text}</text>);
  });
  return { parts };
}

// ---------------------------------------------------------------- treemap and sunburst

/** What the labels of a treemap or sunburst say: the names unless the chart leaves them out, the value when asked, the series name when asked. */
function hierarchyLabels(chart: Chart): { name: boolean; value: boolean; series: boolean } {
  const show = chart.labelShow;
  return { name: !show || show.includes("category"), value: show ? show.includes("value") && !!chart.labels || show.includes("value") : !!chart.labels, series: !!show?.includes("series") };
}

function treeOf(data: ChartData): TreeNode {
  const values = data.series[0]?.values ?? [];
  return buildTree(data.levels ?? [data.categories], values);
}

export function drawTreemap(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const pieColor = basePie;
  const parts: ReactNode[] = [];
  const root = treeOf(data);
  const mode = chart.parentLabels ?? "banner";
  const want = hierarchyLabels(chart);
  const seriesName = data.series[0]?.name ?? "";
  const nameOf = (node: TreeNode) => [want.series ? seriesName : "", want.name ? node.name : ""].filter(Boolean).join(", ");
  let key = 0;
  const draw = (nodes: TreeNode[], rect: Box, depth: number, color: (i: number) => string) => {
    squarify(nodes, rect).forEach(({ node, rect: r }, i) => {
      const own = node.row !== undefined && !node.children.length ? data.series[0]?.pointColors?.[String(node.row)] : undefined;
      const fill = own ?? (depth === 0 ? pieColor(i) : color(i));
      const inset = r.w > 6 && r.h > 6 ? 1 : 0;
      const box = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset };
      const tip = `${node.path.join(" > ")}: ${tickLabel(node.value)}`;
      if (!node.children.length) {
        parts.push(
          <rect key={`t${key++}`} x={box.x} y={box.y} width={Math.max(0, box.w)} height={Math.max(0, box.h)} fill={fill} className="pli-chart-tile" {...(node.row !== undefined ? markAttrs(0, node.row, rectHit(box.x, box.y, Math.max(0, box.w), Math.max(0, box.h)), mark) : {})}>
            <title>{tip}</title>
          </rect>,
        );
        if (box.w > 34 && box.h > 16) {
          const first = nameOf(node);
          if (first) parts.push(<text key={`l${key++}`} x={box.x + 4} y={box.y + 13} className="pli-chart-onmark">{clip(first, Math.floor((box.w - 8) / CHAR))}</text>);
          if (want.value && box.h > (first ? 30 : 16)) parts.push(<text key={`v${key++}`} x={box.x + 4} y={box.y + (first ? 26 : 13)} className="pli-chart-onmark">{tickLabel(node.value)}</text>);
        }
        return;
      }
      parts.push(
        <rect key={`t${key++}`} x={box.x} y={box.y} width={Math.max(0, box.w)} height={Math.max(0, box.h)} fill={fill} className="pli-chart-tile">
          <title>{tip}</title>
        </rect>,
      );
      const header = mode === "banner" ? 15 : 0;
      if (mode === "banner" && want.name && box.h > 22) parts.push(<text key={`l${key++}`} x={box.x + 4} y={box.y + 12} className="pli-chart-onmark">{clip(node.name, Math.floor((box.w - 8) / CHAR))}</text>);
      const inner = { x: box.x + 2, y: box.y + header + 2, w: box.w - 4, h: box.h - header - 4 };
      if (inner.w > 4 && inner.h > 4) draw(node.children, inner, depth + 1, (j) => tint(fill, 0.18 + 0.06 * (j % 3)));
      if (mode === "overlapping" && want.name && box.h > 16 && box.w > 30) parts.push(<text key={`o${key++}`} x={box.x + 4} y={box.y + 12} className="pli-chart-onmark">{clip(node.name, Math.floor((box.w - 8) / CHAR))}</text>);
    });
  };
  draw(root.children, frame, 0, (i) => pieColor(i));
  if (!root.children.length) parts.push(<text key="none" x={frame.x + frame.w / 2} y={frame.y + frame.h / 2} textAnchor="middle" className="pli-chart-muted">No data to show</text>);
  return { parts };
}

export function drawSunburst(chart: Chart, data: ChartData, frame: Box, mark?: MarkRef | null): KindResult {
  const pieColor = basePie;
  const parts: ReactNode[] = [];
  const root = treeOf(data);
  const arcs = sunburstArcs(root);
  const want = hierarchyLabels(chart);
  const levels = Math.max(1, ...arcs.map((a) => a.level + 1));
  const R = Math.max(20, Math.min(frame.w, frame.h) / 2 - 6);
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const rw = R / levels;
  const top = new Map<string, number>();
  root.children.forEach((c, i) => top.set(c.name, i));
  arcs.forEach((a, k) => {
    const base = pieColor(top.get(a.node.path[0]!) ?? 0);
    const own = a.node.row !== undefined && !a.node.children.length ? data.series[0]?.pointColors?.[String(a.node.row)] : undefined;
    const fill = own ?? tint(base, a.level * 0.14);
    const a0 = a.from * Math.PI * 2;
    const a1 = a.to * Math.PI * 2;
    parts.push(
      <path key={`s${k}`} d={ringPath(cx, cy, a.level * rw, (a.level + 1) * rw, a0, a1)} fill={fill} fillRule="evenodd" className="pli-chart-slice" {...(a.node.row !== undefined && !a.node.children.length ? markAttrs(0, a.node.row, arcHit(cx, cy, a.level * rw, (a.level + 1) * rw, a0, a1), mark) : {})}>
        <title>{`${a.node.path.join(" > ")}: ${tickLabel(a.node.value)}`}</title>
      </path>,
    );
    const r = (a.level + 0.5) * rw;
    const mid = (a0 + a1) / 2;
    const text = [want.series ? data.series[0]?.name ?? "" : "", want.name ? a.node.name : "", want.value ? tickLabel(a.node.value) : ""].filter(Boolean).join(", ");
    if (text && (a1 - a0) * r > textWidth(text) * 0.7 + 8 && rw > 16) {
      parts.push(<text key={`l${k}`} x={cx + r * Math.sin(mid)} y={cy - r * Math.cos(mid) + 4} textAnchor="middle" className="pli-chart-onmark">{clip(text, Math.max(3, Math.floor(((a1 - a0) * r) / CHAR)))}</text>);
    }
  });
  if (!arcs.length) parts.push(<text key="none" x={cx} y={cy} textAnchor="middle" className="pli-chart-muted">No data to show</text>);
  return { parts };
}
