import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { CHART_COLORS, ERROR_BAR_KINDS, chartOrientation, chartRef, chartRefText, colName, defaultView3d, labelPositionsFor, seriesKind, stockKind, switchRowsColumns, xIsValueAxis, type AxisKey, type Chart, type ChartAxes, type ChartBins, type ChartBox, type ChartLabelPart, type ChartSeries, type ChartSeriesKind, type ChartSplit, type ChartType, type ChartView3d, type Trendline, type TrendlineType } from "@pli.dev/sheets";
import { AxisFields, ErrorBarFields, FontFields, axisFormOf, axisFromForm, blankErrorBars, errorBarFormOf, errorBarsFromForm, fontFormOf, fontFromForm, type AxisFormState, type ErrorBarForm, type FontForm } from "./chartform";

export const CHART_TYPE_LABELS: { type: ChartType; label: string; group?: string }[] = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
  { type: "pieOfPie", label: "Pie of pie" },
  { type: "barOfPie", label: "Bar of pie" },
  { type: "scatter", label: "Scatter" },
  { type: "bubble", label: "Bubble" },
  { type: "radar", label: "Radar" },
  { type: "stock", label: "Stock" },
  { type: "surface", label: "Surface" },
  { type: "waterfall", label: "Waterfall" },
  { type: "histogram", label: "Histogram" },
  { type: "pareto", label: "Pareto" },
  { type: "boxWhisker", label: "Box and whisker" },
  { type: "funnel", label: "Funnel" },
  { type: "treemap", label: "Treemap" },
  { type: "sunburst", label: "Sunburst" },
];

/** Every optional field the editor sets, as `undefined`, so that saving the editor clears the ones it no longer sets. */
export const CHART_RESET: Partial<Record<keyof Chart, undefined>> = {
  title: undefined, categories: undefined, grouping: undefined, xTitle: undefined, yTitle: undefined, smooth: undefined, labels: undefined, view3d: undefined,
  y2Title: undefined, x2Title: undefined, secondaryCategoryAxis: undefined, markers: undefined, lines: undefined, holeSize: undefined, filled: undefined,
  bubbleScale: undefined, stock: undefined, wireframe: undefined, split: undefined, secondSize: undefined, totals: undefined, bins: undefined, box: undefined, parentLabels: undefined,
  axes: undefined, titleRuns: undefined, firstSliceAngle: undefined, stockLook: undefined, waterfall: undefined, labelShow: undefined, labelPosition: undefined, font: undefined, titleFont: undefined,
  legendFont: undefined, labelFont: undefined, kindGrouping: undefined, bubble3d: undefined,
};

const COMBINABLE: ChartType[] = ["column", "line", "area"];
const SECONDARY: ChartType[] = ["column", "bar", "line", "area", "scatter"];
const THREE_D: ChartType[] = ["column", "bar", "line", "area", "pie"];
const TREND: ChartType[] = ["column", "bar", "line", "area", "scatter", "bubble"];
const TREND_LABELS: Record<TrendlineType, string> = { linear: "Linear", exponential: "Exponential", logarithmic: "Logarithmic", polynomial: "Polynomial", power: "Power", movingAverage: "Moving average" };

export interface ChartDialogProps {
  open: boolean;
  chart: Chart | null;
  /** The sheet the chart is on; references to it are shown without its name. */
  sheetName: string;
  onClose(): void;
  onSave(patch: Omit<Chart, "id" | "from" | "width" | "height">): void;
}

/** A reference as people write it in a box: `B2:B9`, with the sheet's name only when it is another sheet. */
function shown(ref: string | undefined, home: string): string {
  const r = chartRef(ref, home);
  if (!r) return ref ?? "";
  const cell = (row: number, col: number) => `${colName(col)}${row}`;
  const range = r.bounds.r1 === r.bounds.r2 && r.bounds.c1 === r.bounds.c2 ? cell(r.bounds.r1, r.bounds.c1) : `${cell(r.bounds.r1, r.bounds.c1)}:${cell(r.bounds.r2, r.bounds.c2)}`;
  if (r.sheet.toLowerCase() === home.toLowerCase()) return range;
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(r.sheet) ? `${r.sheet}!${range}` : `'${r.sheet.replace(/'/g, "''")}'!${range}`;
}

/** What was typed in a box, as a reference a chart keeps; null when it isn't one. */
function read(text: string, home: string): string | null {
  const r = chartRef(text.trim().replace(/\s+/g, ""), home);
  return r ? chartRefText(r.sheet, r.bounds) : null;
}

interface TrendRow {
  type: TrendlineType;
  order: string;
  period: string;
  forward: string;
  backward: string;
  intercept: string;
  name: string;
  equation: boolean;
  rSquared: boolean;
  /** The label of the line: its own text and number format, and the rest of what it says (where it sits, its font) carried as it was. */
  labelText: string;
  labelFormat: string;
  label: Trendline["label"];
}

interface Row {
  name: string;
  values: string;
  x: string;
  size: string;
  color: string;
  kind: "" | ChartSeriesKind;
  secondary: boolean;
  trends: TrendRow[];
  errY: ErrorBarForm;
  errX: ErrorBarForm;
  explosion: string;
  pointExplosion: string;
  /** Colours of single points, carried as they were (the mark panel sets them). */
  pointColors: ChartSeries["pointColors"];
}

const trendRow = (t: Trendline): TrendRow => ({
  type: t.type,
  order: String(t.order ?? 2),
  period: String(t.period ?? 2),
  forward: t.forward ? String(t.forward) : "",
  backward: t.backward ? String(t.backward) : "",
  intercept: t.intercept !== undefined ? String(t.intercept) : "",
  name: t.name ?? "",
  equation: !!t.equation,
  rSquared: !!t.rSquared,
  labelText: t.label?.text ?? "",
  labelFormat: t.label?.format ?? "",
  label: t.label,
});

const num = (s: string): number | undefined => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));

export function ChartDialog({ open, chart, sheetName, onClose, onSave }: ChartDialogProps) {
  const [type, setType] = useState<ChartType>("column");
  const [title, setTitle] = useState("");
  const [categories, setCategories] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [grouping, setGrouping] = useState<"" | "stacked" | "percent">("");
  const [legend, setLegend] = useState<NonNullable<Chart["legend"]>>("bottom");
  const [xTitle, setXTitle] = useState("");
  const [yTitle, setYTitle] = useState("");
  const [x2Title, setX2Title] = useState("");
  const [y2Title, setY2Title] = useState("");
  const [secondX, setSecondX] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [lines, setLines] = useState(false);
  const [markers, setMarkers] = useState(true);
  const [labels, setLabels] = useState(false);
  const [view3d, setView3d] = useState<ChartView3d | null>(null);
  const [holeSize, setHoleSize] = useState("50");
  const [filled, setFilled] = useState(false);
  const [bubbleScale, setBubbleScale] = useState("100");
  const [stock, setStock] = useState<"" | "hlc" | "ohlc" | "vhlc" | "vohlc">("");
  const [wireframe, setWireframe] = useState(false);
  const [splitBy, setSplitBy] = useState<ChartSplit["by"]>("position");
  const [splitAt, setSplitAt] = useState("3");
  const [secondSize, setSecondSize] = useState("75");
  const [totals, setTotals] = useState("");
  const [bins, setBins] = useState({ by: "auto", size: "", underflow: "", overflow: "", closed: "right" });
  const [box, setBox] = useState({ quartile: "exclusive", meanMarker: true, meanLine: false, innerPoints: false, outliers: true });
  const [parentLabels, setParentLabels] = useState<"banner" | "overlapping" | "none">("banner");
  const [axes, setAxes] = useState<Record<AxisKey, AxisFormState>>(() => ({ x: axisFormOf("column", "x"), y: axisFormOf("column", "y"), x2: axisFormOf("column", "x2"), y2: axisFormOf("column", "y2") }));
  const [fontForm, setFontForm] = useState<FontForm>(fontFormOf());
  const [titleFontForm, setTitleFontForm] = useState<FontForm>(fontFormOf(undefined, { bold: true }));
  const [firstAngle, setFirstAngle] = useState("");
  const [stockLook, setStockLook] = useState({ hiLow: true, hiLowColor: "", upDown: true, up: "", down: "", gap: "" });
  const [connectors, setConnectors] = useState(true);
  const [labelShow, setLabelShow] = useState<ChartLabelPart[]>([]);
  const [labelPosition, setLabelPosition] = useState("");
  const [splitPoints, setSplitPoints] = useState("");
  const [runs, setRuns] = useState<{ text: string; bold: boolean; italic: boolean; underline: boolean; color: string }[]>([]);
  const [legendFont, setLegendFont] = useState<FontForm>(fontFormOf());
  const [labelFont, setLabelFont] = useState<FontForm>(fontFormOf());
  const [kindGrouping, setKindGrouping] = useState<Record<string, string>>({ column: "", line: "", area: "" });
  const [bubble3d, setBubble3d] = useState(false);
  const [wfColors, setWfColors] = useState({ increase: "", decrease: "", total: "" });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !chart) return;
    setType(chart.type);
    setTitle(chart.title ?? "");
    setCategories(shown(chart.categories, sheetName));
    setRows(
      chart.series.map((s, i) => ({
        name: s.nameRef ? shown(s.nameRef, sheetName) : (s.name ?? ""),
        values: shown(s.values, sheetName),
        x: shown(s.x, sheetName),
        size: shown(s.size, sheetName),
        color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!,
        kind: s.type ?? "",
        secondary: s.axis === "secondary",
        trends: (s.trendlines ?? []).map(trendRow),
        errY: errorBarFormOf(s.errorBars?.y, (r) => shown(r, sheetName)),
        errX: errorBarFormOf(s.errorBars?.x, (r) => shown(r, sheetName)),
        explosion: s.explosion ? String(s.explosion) : "",
        pointExplosion: Object.entries(s.pointExplosion ?? {}).map(([k, v]) => `${Number(k) + 1}: ${v}`).join(", "),
        pointColors: s.pointColors,
      })),
    );
    setLegendFont(fontFormOf(chart.legendFont));
    setLabelFont(fontFormOf(chart.labelFont));
    setKindGrouping({ column: chart.kindGrouping?.column ?? "", line: chart.kindGrouping?.line ?? "", area: chart.kindGrouping?.area ?? "" });
    setBubble3d(!!chart.bubble3d);
    setWfColors({ increase: chart.waterfall?.increaseColor ?? "", decrease: chart.waterfall?.decreaseColor ?? "", total: chart.waterfall?.totalColor ?? "" });
    setAxes({ x: axisFormOf(chart.type, "x", chart.axes?.x), y: axisFormOf(chart.type, "y", chart.axes?.y), x2: axisFormOf(chart.type, "x2", chart.axes?.x2), y2: axisFormOf(chart.type, "y2", chart.axes?.y2) });
    setFontForm(fontFormOf(chart.font));
    setTitleFontForm(fontFormOf(chart.titleFont, { bold: true }));
    setFirstAngle(chart.firstSliceAngle ? String(chart.firstSliceAngle) : "");
    setStockLook({ hiLow: chart.stockLook?.hiLowLines !== false, hiLowColor: chart.stockLook?.hiLowColor ?? "", upDown: chart.stockLook?.upDownBars !== false, up: chart.stockLook?.upColor ?? "", down: chart.stockLook?.downColor ?? "", gap: chart.stockLook?.gapWidth !== undefined ? String(chart.stockLook.gapWidth) : "" });
    setConnectors(chart.waterfall?.connectors !== false);
    setLabelShow(chart.labelShow ?? []);
    setLabelPosition(chart.labelPosition ?? "");
    setSplitPoints((chart.split?.points ?? []).map((i) => i + 1).join(", "));
    setRuns((chart.titleRuns ?? []).map((r) => ({ text: r.text, bold: r.bold ?? false, italic: !!r.italic, underline: !!r.underline, color: r.color ?? "" })));
    setGrouping(chart.grouping ?? "");
    setLegend(chart.legend ?? "bottom");
    setXTitle(chart.xTitle ?? "");
    setYTitle(chart.yTitle ?? "");
    setX2Title(chart.x2Title ?? "");
    setY2Title(chart.y2Title ?? "");
    setSecondX(!!chart.secondaryCategoryAxis);
    setSmooth(!!chart.smooth);
    setLines(!!chart.lines);
    setMarkers(chart.markers !== false);
    setLabels(!!chart.labels);
    setView3d(chart.view3d ?? null);
    setHoleSize(String(chart.holeSize ?? 50));
    setFilled(!!chart.filled);
    setBubbleScale(String(chart.bubbleScale ?? 100));
    setStock(chart.stock ?? (chart.type === "stock" ? stockKind(chart) : ""));
    setWireframe(!!chart.wireframe);
    setSplitBy(chart.split?.by ?? "position");
    setSplitAt(String(chart.split?.at ?? 3));
    setSecondSize(String(chart.secondSize ?? 75));
    setTotals((chart.totals ?? []).map((i) => i + 1).join(", "));
    setBins({ by: chart.bins?.by ?? "auto", size: chart.bins?.size !== undefined ? String(chart.bins.size) : "", underflow: chart.bins?.underflow !== undefined ? String(chart.bins.underflow) : "", overflow: chart.bins?.overflow !== undefined ? String(chart.bins.overflow) : "", closed: chart.bins?.closed ?? "right" });
    setBox({ quartile: chart.box?.quartile ?? "exclusive", meanMarker: chart.box?.meanMarker !== false, meanLine: !!chart.box?.meanLine, innerPoints: !!chart.box?.innerPoints, outliers: chart.box?.outliers !== false });
    setParentLabels(chart.parentLabels ?? "banner");
    setProblem(null);
  }, [open, chart, sheetName]);

  const circular = type === "pie" || type === "doughnut" || type === "pieOfPie" || type === "barOfPie";
  const hasAxes = !circular && type !== "radar" && type !== "treemap" && type !== "sunburst" && type !== "funnel";
  const stackable = type === "column" || type === "bar" || type === "line" || type === "area";
  const xyKind = type === "scatter" || type === "bubble";
  const noCategories = xyKind || type === "histogram";
  const canCombine = COMBINABLE.includes(type);
  const canSecond = SECONDARY.includes(type);
  const canTrend = TREND.includes(type) && !view3d && !(stackable && grouping);
  const canErrors = (i: number) => ERROR_BAR_KINDS.includes(seriesKind({ type }, { ...(rows[i]?.kind ? { type: rows[i]!.kind as ChartSeriesKind } : {}) })) && !view3d && grouping !== "percent";
  const hasAxisSettings = hasAxes || type === "radar";
  const secondUsed = rows.some((r) => r.secondary) || type === "stock";
  const labelPositions = labelPositionsFor({ type, ...(grouping ? { grouping } : {}) });

  const save = () => {
    const bad = (m: string) => setProblem(m);
    let cats: string | undefined;
    if (categories.trim() && !noCategories) {
      cats = read(categories, sheetName) ?? undefined;
      if (!cats) return bad(`"${categories}" isn't a range of cells. Try something like A2:A9.`);
    }
    const series: ChartSeries[] = [];
    for (const [i, r] of rows.entries()) {
      const values = read(r.values, sheetName);
      if (!values) return bad(`Series ${i + 1}: "${r.values}" isn't a range of cells. Try something like B2:B9.`);
      const s: ChartSeries = { values, color: r.color };
      if (r.name.trim()) {
        // A name that reads as a cell points at that cell; anything else is the name itself.
        const ref = /^\$?[A-Za-z]{1,3}\$?\d+$|!/.test(r.name.trim()) ? read(r.name, sheetName) : null;
        if (ref) s.nameRef = ref;
        else s.name = r.name.trim();
      }
      if ((xyKind || r.kind === "scatter") && r.x.trim()) {
        const x = read(r.x, sheetName);
        if (!x) return bad(`Series ${i + 1}: "${r.x}" isn't a range of cells.`);
        s.x = x;
      }
      if (type === "bubble" && r.size.trim()) {
        const size = read(r.size, sheetName);
        if (!size) return bad(`Series ${i + 1}: "${r.size}" isn't a range of cells.`);
        s.size = size;
      }
      if (canCombine && r.kind && r.kind !== type) s.type = r.kind;
      if (canSecond && r.secondary) s.axis = "secondary";
      if (canTrend && r.trends.length) {
        s.trendlines = r.trends.map((t): Trendline => {
          const out: Trendline = { type: t.type };
          if (t.type === "polynomial") out.order = num(t.order) ?? 2;
          if (t.type === "movingAverage") out.period = num(t.period) ?? 2;
          const f = num(t.forward);
          const b = num(t.backward);
          const c = num(t.intercept);
          if (f) out.forward = f;
          if (b) out.backward = b;
          if (c !== undefined && ["linear", "exponential", "polynomial"].includes(t.type)) out.intercept = c;
          if (t.name.trim()) out.name = t.name.trim();
          if (t.type !== "movingAverage") {
            if (t.equation) out.equation = true;
            if (t.rSquared) out.rSquared = true;
            const label = { ...t.label };
            if (t.labelText.trim()) label.text = t.labelText.trim();
            else delete label.text;
            if (t.labelFormat.trim()) label.format = t.labelFormat.trim();
            else delete label.format;
            if ((t.equation || t.rSquared) && Object.keys(label).length) out.label = label;
          }
          return out;
        });
      }
      if (canErrors(i)) {
        const eb: NonNullable<ChartSeries["errorBars"]> = {};
        const y = errorBarsFromForm(r.errY, `Series ${i + 1} error bars`, (t) => read(t, sheetName));
        if (typeof y === "string") return bad(y);
        if (y) eb.y = y;
        if (xyKind) {
          const x = errorBarsFromForm(r.errX, `Series ${i + 1} x error bars`, (t) => read(t, sheetName));
          if (typeof x === "string") return bad(x);
          if (x) eb.x = x;
        }
        if (eb.y || eb.x) s.errorBars = eb;
      }
      if (circular) {
        const ex = num(r.explosion);
        if (r.explosion.trim() && (ex === undefined || ex < 0 || ex > 400)) return bad(`Series ${i + 1}: the explosion is from 0 to 400`);
        if (ex) s.explosion = ex;
        const per: Record<string, number> = {};
        for (const part of r.pointExplosion.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
          const m = /^(\d+)\s*[:=]\s*(\d+(?:\.\d+)?)$/.exec(part);
          if (!m || Number(m[1]) < 1 || Number(m[2]) > 400) return bad(`Series ${i + 1}: write exploded slices like 2: 30, 4: 15 (slice number, then percent)`);
          per[String(Number(m[1]) - 1)] = Number(m[2]);
        }
        if (Object.keys(per).length) s.pointExplosion = per;
      }
      if (r.pointColors && Object.keys(r.pointColors).length) s.pointColors = r.pointColors;
      series.push(s);
    }
    if (!series.length) return bad("Add at least one series");
    const patch: Omit<Chart, "id" | "from" | "width" | "height"> = {
      type,
      series: type === "pie" || type === "pieOfPie" || type === "barOfPie" ? series.slice(0, 1) : series,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(cats ? { categories: cats } : {}),
      ...(grouping && stackable ? { grouping } : {}),
      legend,
      ...(hasAxes && xTitle.trim() ? { xTitle: xTitle.trim() } : {}),
      ...(hasAxes && yTitle.trim() ? { yTitle: yTitle.trim() } : {}),
      ...(canSecond && x2Title.trim() ? { x2Title: x2Title.trim() } : {}),
      ...(canSecond && y2Title.trim() ? { y2Title: y2Title.trim() } : {}),
      ...(canSecond && secondX ? { secondaryCategoryAxis: true } : {}),
      ...(smooth && (type === "line" || type === "scatter") ? { smooth: true } : {}),
      ...(lines && type === "scatter" ? { lines: true } : {}),
      ...(!markers && ["line", "scatter"].includes(type) || (!markers && type === "radar" && !filled) ? { markers: false } : {}),
      ...(labels ? { labels: true } : {}),
      ...(view3d && (THREE_D.includes(type) || type === "surface") ? { view3d } : {}),
    };
    if (type === "doughnut") patch.holeSize = Math.max(10, Math.min(90, num(holeSize) ?? 50));
    if (type === "radar" && filled) patch.filled = true;
    if (type === "bubble") patch.bubbleScale = Math.max(0, Math.min(300, num(bubbleScale) ?? 100));
    if (type === "stock" && stock) patch.stock = stock;
    if (type === "surface") {
      patch.view3d = view3d ?? defaultView3d("surface");
      if (wireframe) patch.wireframe = true;
    }
    if (type === "pieOfPie" || type === "barOfPie") {
      if (splitBy === "custom") {
        const picked = splitPoints.split(/[,\s]+/).filter(Boolean).map(Number);
        if (!picked.length || picked.some((n) => !Number.isInteger(n) || n < 1)) return bad("Name the points for the second plot by number, such as 4, 5");
        patch.split = { by: "custom", at: 0, points: picked.map((n) => n - 1) };
      } else {
        const at = num(splitAt);
        if (!(at !== undefined && at > 0)) return bad("The split needs a number above 0");
        patch.split = { by: splitBy, at: splitBy === "position" ? Math.round(at) : at };
      }
      patch.secondSize = Math.max(5, Math.min(200, num(secondSize) ?? 75));
    }
    if (type === "waterfall" && totals.trim()) {
      const picked = totals.split(/[,\s]+/).filter(Boolean).map(Number);
      if (picked.some((n) => !Number.isInteger(n) || n < 1)) return bad("Totals are point numbers, such as 1, 6");
      patch.totals = picked.map((n) => n - 1);
    }
    if (type === "histogram") {
      const b: ChartBins = {};
      if (bins.by !== "auto") b.by = bins.by as ChartBins["by"];
      if (bins.by !== "auto") b.size = num(bins.size);
      if (bins.by !== "auto" && !(b.size !== undefined && b.size > 0)) return bad(bins.by === "width" ? "Give the width of a bin" : "Give the number of bins");
      if (num(bins.underflow) !== undefined) b.underflow = num(bins.underflow)!;
      if (num(bins.overflow) !== undefined) b.overflow = num(bins.overflow)!;
      if (bins.closed === "left") b.closed = "left";
      if (Object.keys(b).length) patch.bins = b;
    }
    if (type === "boxWhisker") {
      const b: ChartBox = {};
      if (box.quartile === "inclusive") b.quartile = "inclusive";
      if (!box.meanMarker) b.meanMarker = false;
      if (box.meanLine) b.meanLine = true;
      if (box.innerPoints) b.innerPoints = true;
      if (!box.outliers) b.outliers = false;
      if (Object.keys(b).length) patch.box = b;
    }
    if (type === "treemap" && parentLabels !== "banner") patch.parentLabels = parentLabels;
    if (hasAxisSettings) {
      const found: ChartAxes = {};
      for (const key of ["x", "y", "x2", "y2"] as const) {
        if ((key === "x2" || key === "y2") && !(canSecond && secondUsed)) continue;
        if (type === "radar" && key !== "y" && key !== "x") continue;
        const name = { x: xyKind ? "Horizontal axis" : type === "bar" ? "Category axis" : "Horizontal axis", y: type === "bar" ? "Value axis" : "Vertical axis", x2: "Secondary category axis", y2: "Secondary value axis" }[key];
        const a = axisFromForm(type, key, axes[key], name);
        if (typeof a === "string") return bad(a);
        if (Object.keys(a).length) found[key] = a;
      }
      if (Object.keys(found).length) patch.axes = found;
      // An axis title in pieces is its pieces joined.
      const titleField = { x: "xTitle", y: "yTitle", x2: "x2Title", y2: "y2Title" } as const;
      for (const key of ["x", "y", "x2", "y2"] as const) {
        const runs = found[key]?.titleRuns;
        if (runs) patch[titleField[key]] = runs.map((r) => r.text).join("");
      }
    }
    if (type === "pie" || type === "doughnut") {
      const angle = num(firstAngle);
      if (firstAngle.trim() && (angle === undefined || angle < 0 || angle > 360)) return bad("The first slice angle is from 0 to 360 degrees");
      if (angle) patch.firstSliceAngle = angle;
    }
    if (type === "stock") {
      const look: NonNullable<Chart["stockLook"]> = {};
      if (!stockLook.hiLow) look.hiLowLines = false;
      if (stockLook.hiLow && stockLook.hiLowColor) look.hiLowColor = stockLook.hiLowColor;
      if (!stockLook.upDown) look.upDownBars = false;
      if (stockLook.upDown && stockLook.up) look.upColor = stockLook.up;
      if (stockLook.upDown && stockLook.down) look.downColor = stockLook.down;
      if (stockLook.gap.trim()) {
        const g = num(stockLook.gap);
        if (g === undefined || g < 0 || g > 500) return bad("The gap between the bodies is from 0 to 500 percent");
        look.gapWidth = g;
      }
      if (Object.keys(look).length) patch.stockLook = look;
    }
    if (type === "waterfall") {
      const wf: NonNullable<Chart["waterfall"]> = {};
      if (!connectors) wf.connectors = false;
      if (wfColors.increase) wf.increaseColor = wfColors.increase;
      if (wfColors.decrease) wf.decreaseColor = wfColors.decrease;
      if (wfColors.total) wf.totalColor = wfColors.total;
      if (Object.keys(wf).length) patch.waterfall = wf;
    }
    if (type === "bubble" && bubble3d) patch.bubble3d = true;
    if (canCombine) {
      const kg: NonNullable<Chart["kindGrouping"]> = {};
      for (const k of ["column", "line", "area"] as const) if (kindGrouping[k] === "stacked" || kindGrouping[k] === "percent") kg[k] = kindGrouping[k] as "stacked" | "percent";
      if (Object.keys(kg).length) patch.kindGrouping = kg;
    }
    for (const [form, field, what] of [[legendFont, "legendFont", "The legend font"], [labelFont, "labelFont", "The data label font"]] as const) {
      const f = fontFromForm(form, what);
      if (typeof f === "string") return bad(f);
      if (f) patch[field] = f;
    }
    if (labels) {
      if (labelShow.length) patch.labelShow = labelShow;
      if (labelPosition && labelPositions.includes(labelPosition as never)) patch.labelPosition = labelPosition as NonNullable<Chart["labelPosition"]>;
    }
    const font = fontFromForm(fontForm, "The chart font");
    if (typeof font === "string") return bad(font);
    if (font) patch.font = font;
    const pieces = runs.filter((r) => r.text !== "");
    if (pieces.length) {
      patch.titleRuns = pieces.map((r) => ({ text: r.text, ...(r.bold ? { bold: true } : { bold: false }), ...(r.italic ? { italic: true } : {}), ...(r.underline ? { underline: true } : {}), ...(r.color ? { color: r.color } : {}) }));
      patch.title = pieces.map((r) => r.text).join("");
    }
    const titleFont = fontFromForm(titleFontForm, "The title font", { bold: true });
    if (typeof titleFont === "string") return bad(titleFont);
    if (titleFont) patch.titleFont = titleFont;
    onSave(patch);
  };

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setTrend = (i: number, k: number, patch: Partial<TrendRow>) => set(i, { trends: rows[i]!.trends.map((t, j) => (j === k ? { ...t, ...patch } : t)) });
  const blankRow = (n: number): Row => ({ name: "", values: "", x: "", size: "", color: CHART_COLORS[n % CHART_COLORS.length]!, kind: "", secondary: false, trends: [], errY: blankErrorBars(), errX: blankErrorBars(), explosion: "", pointExplosion: "", pointColors: undefined });
  const setAxis = (key: AxisKey, patch: Partial<AxisFormState>) => setAxes({ ...axes, [key]: { ...axes[key], ...patch } });
  /** What the labels say now: the parts picked, or the usual ones (the value; the percentage on a pie) when none were. */
  const shownParts = (): ChartLabelPart[] => (labelShow.length ? labelShow : circular ? ["percent"] : ["value"]);
  const toggleShow = (part: ChartLabelPart) => {
    const now = shownParts();
    setLabelShow(now.includes(part) ? now.filter((p) => p !== part) : [...now, part]);
  };
  const stockLayouts: Record<string, string> = { hlc: "High, low, close", ohlc: "Open, high, low, close", vhlc: "Volume, high, low, close", vohlc: "Volume, open, high, low, close" };

  return (
    <Dialog
      open={open}
      title="Chart"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <div className="pli-chartform">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as ChartType)}>
            {CHART_TYPE_LABELS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
        <label>
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {!noCategories && (
          <label>
            {circular ? "Slice labels" : "Labels"} (cells)
            <input type="text" value={categories} placeholder={type === "treemap" || type === "sunburst" ? "A2:B9 (one column for each level)" : "A2:A9"} onChange={(e) => setCategories(e.target.value)} />
          </label>
        )}
        {type === "stock" && (
          <label>
            Series are
            <select value={stock || (rows.length >= 5 ? "vohlc" : rows.length === 4 ? "ohlc" : "hlc")} onChange={(e) => setStock(e.target.value as typeof stock)}>
              {Object.entries(stockLayouts).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        <fieldset>
          <legend>Series</legend>
          <ul className="pli-dropdown-rows" aria-label="Series">
            {rows.map((r, i) => (
              <li key={i} className="pli-chartform-series-block">
                <div className="pli-chartform-series">
                  <input type="color" aria-label={`Colour of series ${i + 1}`} value={r.color} onChange={(e) => set(i, { color: e.target.value })} />
                  <input type="text" aria-label={`Name of series ${i + 1}`} placeholder="Name or cell, B1" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                  {(xyKind || r.kind === "scatter") && <input type="text" aria-label={`X values of series ${i + 1}`} placeholder="X: A2:A9" value={r.x} onChange={(e) => set(i, { x: e.target.value })} />}
                  <input type="text" aria-label={`Values of series ${i + 1}`} placeholder="Values: B2:B9" value={r.values} onChange={(e) => set(i, { values: e.target.value })} />
                  {type === "bubble" && <input type="text" aria-label={`Sizes of series ${i + 1}`} placeholder="Sizes: C2:C9" value={r.size} onChange={(e) => set(i, { size: e.target.value })} />}
                  <button type="button" className="pli-button" aria-label={`Remove series ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                </div>
                {(canCombine || canSecond) && (
                  <div className="pli-chartform-trend">
                    {canCombine && (
                      <label>
                        Kind
                        <select aria-label={`Kind of series ${i + 1}`} value={r.kind || type} onChange={(e) => set(i, { kind: e.target.value as ChartSeriesKind })}>
                          <option value="column">Column</option>
                          <option value="line">Line</option>
                          <option value="area">Area</option>
                          <option value="scatter">Scatter</option>
                        </select>
                      </label>
                    )}
                    {canSecond && <label><input type="checkbox" aria-label={`Series ${i + 1} on the secondary axis`} checked={r.secondary} onChange={(e) => set(i, { secondary: e.target.checked })} /> Secondary axis</label>}
                  </div>
                )}
                {canTrend && (
                  <div className="pli-chartform-trends">
                    {r.trends.map((t, k) => (
                      <div key={k} className="pli-chartform-trend">
                        <select aria-label={`Trendline ${k + 1} of series ${i + 1}`} value={t.type} onChange={(e) => setTrend(i, k, { type: e.target.value as TrendlineType })}>
                          {(Object.keys(TREND_LABELS) as TrendlineType[]).map((x) => <option key={x} value={x}>{TREND_LABELS[x]}</option>)}
                        </select>
                        {t.type === "polynomial" && <input type="number" min={2} max={6} aria-label="Order" title="Order (2 to 6)" value={t.order} onChange={(e) => setTrend(i, k, { order: e.target.value })} style={{ width: 52 }} />}
                        {t.type === "movingAverage" && <input type="number" min={2} max={255} aria-label="Period" title="Period" value={t.period} onChange={(e) => setTrend(i, k, { period: e.target.value })} style={{ width: 52 }} />}
                        <input type="text" aria-label="Forecast forward" placeholder="Forward" value={t.forward} onChange={(e) => setTrend(i, k, { forward: e.target.value })} style={{ width: 62 }} />
                        <input type="text" aria-label="Forecast backward" placeholder="Backward" value={t.backward} onChange={(e) => setTrend(i, k, { backward: e.target.value })} style={{ width: 62 }} />
                        {["linear", "exponential", "polynomial"].includes(t.type) && <input type="text" aria-label="Intercept" placeholder="Intercept" value={t.intercept} onChange={(e) => setTrend(i, k, { intercept: e.target.value })} style={{ width: 66 }} />}
                        <input type="text" aria-label="Trendline name" placeholder="Name" value={t.name} onChange={(e) => setTrend(i, k, { name: e.target.value })} style={{ width: 80 }} />
                        {t.type !== "movingAverage" && (
                          <>
                            <label><input type="checkbox" aria-label="Show equation" checked={t.equation} onChange={(e) => setTrend(i, k, { equation: e.target.checked })} /> Equation</label>
                            <label><input type="checkbox" aria-label="Show R squared" checked={t.rSquared} onChange={(e) => setTrend(i, k, { rSquared: e.target.checked })} /> R²</label>
                            {(t.equation || t.rSquared) && (
                              <>
                                <input type="text" aria-label="Trendline label text" placeholder="Label text" value={t.labelText} onChange={(e) => setTrend(i, k, { labelText: e.target.value })} style={{ width: 100 }} />
                                <input type="text" aria-label="Trendline label number format" placeholder="0.000" value={t.labelFormat} onChange={(e) => setTrend(i, k, { labelFormat: e.target.value })} style={{ width: 66 }} />
                              </>
                            )}
                          </>
                        )}
                        <button type="button" className="pli-button" aria-label={`Remove trendline ${k + 1} of series ${i + 1}`} onClick={() => set(i, { trends: r.trends.filter((_, j) => j !== k) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="pli-button" aria-label={`Add a trendline to series ${i + 1}`} onClick={() => set(i, { trends: [...r.trends, trendRow({ type: "linear" })] })}>Add a trendline</button>
                  </div>
                )}
                {canErrors(i) && (
                  <div className="pli-chartform-trends">
                    <ErrorBarFields title={xyKind ? `Series ${i + 1}: Y error bars` : `Series ${i + 1}: Error bars`} form={r.errY} onChange={(patch) => set(i, { errY: { ...r.errY, ...patch } })} />
                    {xyKind && <ErrorBarFields title={`Series ${i + 1}: X error bars`} form={r.errX} onChange={(patch) => set(i, { errX: { ...r.errX, ...patch } })} />}
                  </div>
                )}
                {circular && (
                  <div className="pli-chartform-trend">
                    <label>
                      Pull slices out (%)
                      <input type="text" aria-label={`Explosion of series ${i + 1}`} value={r.explosion} placeholder="0" onChange={(e) => set(i, { explosion: e.target.value })} style={{ width: 52 }} />
                    </label>
                    <label>
                      Single slices
                      <input type="text" aria-label={`Exploded slices of series ${i + 1}`} value={r.pointExplosion} placeholder="2: 30, 4: 15" onChange={(e) => set(i, { pointExplosion: e.target.value })} style={{ width: 110 }} />
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="pli-button" onClick={() => setRows([...rows, blankRow(rows.length)])}>Add a series</button>
          {chart && chartOrientation(chart, sheetName) && (
            <button
              type="button"
              className="pli-button"
              title={chartOrientation(chart, sheetName) === "columns" ? "The series run down columns: make each row a series" : "The series run across rows: make each column a series"}
              onClick={() => {
                try {
                  const next = switchRowsColumns(chart, sheetName);
                  setCategories(shown(next.categories, sheetName));
                  setRows(next.series.map((sr, i) => ({ ...blankRow(i), name: sr.nameRef ? shown(sr.nameRef, sheetName) : "", values: shown(sr.values, sheetName), color: sr.color ?? CHART_COLORS[i % CHART_COLORS.length]! })));
                  setProblem(null);
                } catch (error) {
                  setProblem((error as Error).message);
                }
              }}
            >
              Switch rows and columns
            </button>
          )}
        </fieldset>
        <div className="pli-chartform-pair">
          {stackable && (
            <label>
              Stacking
              <select value={grouping} onChange={(e) => setGrouping(e.target.value as typeof grouping)}>
                <option value="">None</option>
                <option value="stacked">Stacked</option>
                <option value="percent">Stacked, 100%</option>
              </select>
            </label>
          )}
          {canCombine && rows.some((r) => r.kind && r.kind !== type) &&
            (["column", "line", "area"] as const).filter((k) => k !== type && rows.some((r) => r.kind === k)).map((k) => (
              <label key={k}>
                Stacking of the {k} series
                <select aria-label={`Stacking of the ${k} series`} value={kindGrouping[k]} onChange={(e) => setKindGrouping({ ...kindGrouping, [k]: e.target.value })}>
                  <option value="">None</option>
                  <option value="stacked">Stacked</option>
                  <option value="percent">Stacked, 100%</option>
                </select>
              </label>
            ))}
          <label>
            Legend
            <select value={legend} onChange={(e) => setLegend(e.target.value as typeof legend)}>
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
              <option value="right">Right</option>
              <option value="left">Left</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
        {hasAxes && (
          <div className="pli-chartform-pair">
            <label>
              {type === "bar" ? "Category axis title" : "Horizontal axis title"}
              <input type="text" value={xTitle} onChange={(e) => setXTitle(e.target.value)} />
            </label>
            <label>
              {type === "bar" ? "Value axis title" : "Vertical axis title"}
              <input type="text" value={yTitle} onChange={(e) => setYTitle(e.target.value)} />
            </label>
          </div>
        )}
        {canSecond && rows.some((r) => r.secondary) && (
          <div className="pli-chartform-pair">
            <label>
              Secondary value axis title
              <input type="text" value={y2Title} onChange={(e) => setY2Title(e.target.value)} />
            </label>
            {!xyKind && (
              <label>
                Secondary category axis title
                <input type="text" value={x2Title} onChange={(e) => setX2Title(e.target.value)} />
              </label>
            )}
          </div>
        )}
        {hasAxisSettings && (
          <>
            <AxisFields type={type} axis="x" title={xyKind ? "Horizontal axis" : type === "bar" ? "Category axis" : "Horizontal axis"} titleText={xTitle} form={axes.x} onChange={(p) => setAxis("x", p)} />
            <AxisFields type={type} axis="y" title={type === "bar" ? "Value axis" : "Vertical axis"} titleText={yTitle} form={axes.y} onChange={(p) => setAxis("y", p)} />
            {canSecond && secondUsed && <AxisFields type={type} axis="y2" title="Secondary value axis" titleText={y2Title} form={axes.y2} onChange={(p) => setAxis("y2", p)} />}
          </>
        )}
        {type === "doughnut" && <label>Hole size (10 to 90%)<input type="number" min={10} max={90} value={holeSize} onChange={(e) => setHoleSize(e.target.value)} /></label>}
        {type === "bubble" && <label>Bubble size (0 to 300%)<input type="number" min={0} max={300} value={bubbleScale} onChange={(e) => setBubbleScale(e.target.value)} /></label>}
        {(type === "pieOfPie" || type === "barOfPie") && (
          <div className="pli-chartform-pair">
            <label>
              Move to the second plot
              <select value={splitBy} onChange={(e) => setSplitBy(e.target.value as ChartSplit["by"])}>
                <option value="position">The last points (count)</option>
                <option value="value">Values below</option>
                <option value="percent">Percentages below</option>
                <option value="custom">The points I choose</option>
              </select>
            </label>
            {splitBy === "custom" ? (
              <label>
                Points (numbers)
                <input type="text" aria-label="Points for the second plot" value={splitPoints} placeholder="4, 5" onChange={(e) => setSplitPoints(e.target.value)} />
              </label>
            ) : (
              <label>
                Number
                <input type="number" min={1} value={splitAt} onChange={(e) => setSplitAt(e.target.value)} />
              </label>
            )}
            <label>
              Second plot size (%)
              <input type="number" min={5} max={200} value={secondSize} onChange={(e) => setSecondSize(e.target.value)} />
            </label>
          </div>
        )}
        {(type === "pie" || type === "doughnut") && <label>First slice angle (0 to 360°)<input type="text" aria-label="First slice angle" value={firstAngle} placeholder="0" onChange={(e) => setFirstAngle(e.target.value)} /></label>}
        {type === "waterfall" && <label>Totals (point numbers)<input type="text" value={totals} placeholder="1, 6" onChange={(e) => setTotals(e.target.value)} /></label>}
        {type === "waterfall" && <label><input type="checkbox" aria-label="Connector lines" checked={connectors} onChange={(e) => setConnectors(e.target.checked)} /> Connector lines</label>}
        {type === "waterfall" && (
          <div className="pli-chartform-trend">
            {(["increase", "decrease", "total"] as const).map((k) => (
              <label key={k}>
                {k === "increase" ? "Increases" : k === "decrease" ? "Decreases" : "Totals"}
                <input type="color" aria-label={`Colour of ${k === "increase" ? "increases" : k === "decrease" ? "decreases" : "totals"}`} value={wfColors[k] || CHART_COLORS[k === "increase" ? 0 : k === "decrease" ? 1 : 2]!} onChange={(e) => setWfColors({ ...wfColors, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        )}
        {type === "stock" && (
          <div className="pli-chartform-trend">
            <label><input type="checkbox" aria-label="High-low lines" checked={stockLook.hiLow} onChange={(e) => setStockLook({ ...stockLook, hiLow: e.target.checked })} /> High-low lines</label>
            <label><input type="checkbox" aria-label="Up/down bars" checked={stockLook.upDown} onChange={(e) => setStockLook({ ...stockLook, upDown: e.target.checked })} /> Up/down bars</label>
            {stockLook.upDown && (
              <>
                <label>Up <input type="color" aria-label="Up bar colour" value={stockLook.up || "#ffffff"} onChange={(e) => setStockLook({ ...stockLook, up: e.target.value })} /></label>
                <label>Down <input type="color" aria-label="Down bar colour" value={stockLook.down || "#000000"} onChange={(e) => setStockLook({ ...stockLook, down: e.target.value })} /></label>
                <label>Gap (%) <input type="text" aria-label="Gap between bars" placeholder="150" value={stockLook.gap} onChange={(e) => setStockLook({ ...stockLook, gap: e.target.value })} style={{ width: 52 }} /></label>
              </>
            )}
          </div>
        )}
        {type === "histogram" && (
          <div className="pli-chartform-pair">
            <label>
              Bins
              <select value={bins.by} onChange={(e) => setBins({ ...bins, by: e.target.value })}>
                <option value="auto">Automatic width</option>
                <option value="width">Bin width</option>
                <option value="count">Number of bins</option>
              </select>
            </label>
            {bins.by !== "auto" && <label>{bins.by === "width" ? "Width" : "Number"}<input type="text" aria-label="Bin size" value={bins.size} onChange={(e) => setBins({ ...bins, size: e.target.value })} /></label>}
            <label>Overflow above<input type="text" value={bins.overflow} onChange={(e) => setBins({ ...bins, overflow: e.target.value })} /></label>
            <label>Underflow at or below<input type="text" value={bins.underflow} onChange={(e) => setBins({ ...bins, underflow: e.target.value })} /></label>
            <label>
              A bin includes
              <select value={bins.closed} onChange={(e) => setBins({ ...bins, closed: e.target.value })}>
                <option value="right">Its upper limit</option>
                <option value="left">Its lower limit</option>
              </select>
            </label>
          </div>
        )}
        {type === "boxWhisker" && (
          <div className="pli-dropdown-options">
            <label>
              Quartiles
              <select value={box.quartile} onChange={(e) => setBox({ ...box, quartile: e.target.value })}>
                <option value="exclusive">Exclusive median</option>
                <option value="inclusive">Inclusive median</option>
              </select>
            </label>
            <label><input type="checkbox" checked={box.meanMarker} onChange={(e) => setBox({ ...box, meanMarker: e.target.checked })} /> Mean markers</label>
            <label><input type="checkbox" checked={box.meanLine} onChange={(e) => setBox({ ...box, meanLine: e.target.checked })} /> Mean line</label>
            <label><input type="checkbox" checked={box.innerPoints} onChange={(e) => setBox({ ...box, innerPoints: e.target.checked })} /> Inner points</label>
            <label><input type="checkbox" checked={box.outliers} onChange={(e) => setBox({ ...box, outliers: e.target.checked })} /> Outlier points</label>
          </div>
        )}
        {type === "treemap" && (
          <label>
            Parent labels
            <select value={parentLabels} onChange={(e) => setParentLabels(e.target.value as typeof parentLabels)}>
              <option value="banner">Banner</option>
              <option value="overlapping">Overlapping</option>
              <option value="none">None</option>
            </select>
          </label>
        )}
        <div className="pli-dropdown-options">
          {(type === "line" || type === "scatter") && <label><input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Smooth lines</label>}
          {type === "scatter" && <label><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> Join the points with lines</label>}
          {(type === "line" || type === "scatter" || (type === "radar" && !filled)) && <label><input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} /> Markers</label>}
          {type === "radar" && <label><input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> Filled</label>}
          {type === "bubble" && <label><input type="checkbox" checked={bubble3d} onChange={(e) => setBubble3d(e.target.checked)} /> Bubbles as spheres (3-D)</label>}
          {type === "surface" && <label><input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} /> Wireframe</label>}
          {THREE_D.includes(type) && <label><input type="checkbox" checked={!!view3d} onChange={(e) => setView3d(e.target.checked ? defaultView3d(type) : null)} /> 3-D</label>}
          {canSecond && !xyKind && <label><input type="checkbox" checked={secondX} onChange={(e) => setSecondX(e.target.checked)} /> Show the secondary category axis</label>}
          <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Show values on the chart</label>
        </div>
        {labels && (
          <div className="pli-chartform-trend">
            <span>Labels say</span>
            {(["value", "category", "series", ...(circular ? (["percent"] as const) : [])] as ChartLabelPart[]).map((part) => (
              <label key={part}><input type="checkbox" aria-label={`Label shows the ${part}`} checked={shownParts().includes(part)} onChange={() => toggleShow(part)} /> {part === "value" ? "Value" : part === "category" ? "Category name" : part === "series" ? "Series name" : "Percentage"}</label>
            ))}
            {labelPositions.length > 0 && (
              <label>
                Position
                <select aria-label="Label position" value={labelPosition} onChange={(e) => setLabelPosition(e.target.value)}>
                  <option value="">Automatic</option>
                  {labelPositions.map((p) => <option key={p} value={p}>{{ center: "Centre", insideEnd: "Inside end", insideBase: "Inside base", outsideEnd: "Outside end", above: "Above", below: "Below", left: "Left", right: "Right", bestFit: "Best fit" }[p]}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        <FontFields title="Legend font" form={legendFont} onChange={(p) => setLegendFont({ ...legendFont, ...p })} />
        {labels && <FontFields title="Data label font" form={labelFont} onChange={(p) => setLabelFont({ ...labelFont, ...p })} />}
        <FontFields title="Chart font" form={fontForm} onChange={(p) => setFontForm({ ...fontForm, ...p })} />
        <FontFields title="Title font" form={titleFontForm} onChange={(p) => setTitleFontForm({ ...titleFontForm, ...p })} />
        <fieldset>
          <legend>Title in pieces</legend>
          {runs.map((r, i) => (
            <div key={i} className="pli-chartform-trend">
              <input type="text" aria-label={`Title piece ${i + 1}`} value={r.text} onChange={(e) => setRuns(runs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <label><input type="checkbox" aria-label={`Title piece ${i + 1}: Bold`} checked={r.bold} onChange={(e) => setRuns(runs.map((x, j) => (j === i ? { ...x, bold: e.target.checked } : x)))} /> Bold</label>
              <label><input type="checkbox" aria-label={`Title piece ${i + 1}: Italic`} checked={r.italic} onChange={(e) => setRuns(runs.map((x, j) => (j === i ? { ...x, italic: e.target.checked } : x)))} /> Italic</label>
              <label><input type="checkbox" aria-label={`Title piece ${i + 1}: Underline`} checked={r.underline} onChange={(e) => setRuns(runs.map((x, j) => (j === i ? { ...x, underline: e.target.checked } : x)))} /> Underline</label>
              <input type="color" aria-label={`Title piece ${i + 1}: Colour`} value={r.color || "#000000"} onChange={(e) => setRuns(runs.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
              <button type="button" className="pli-button" aria-label={`Remove title piece ${i + 1}`} onClick={() => setRuns(runs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="pli-button" onClick={() => setRuns(runs.length ? [...runs, { text: "", bold: true, italic: false, underline: false, color: "" }] : [{ text: title, bold: true, italic: false, underline: false, color: "" }, { text: "", bold: false, italic: true, underline: false, color: "" }])}>Add a piece</button>
        </fieldset>
        {(view3d && THREE_D.includes(type)) || type === "surface" ? (
          <div className="pli-chartform-pair">
            <label>
              Tilt: {(view3d ?? defaultView3d("surface")).rotX}°
              <input type="range" min={0} max={90} value={(view3d ?? defaultView3d("surface")).rotX} onChange={(e) => setView3d({ ...(view3d ?? defaultView3d("surface")), rotX: Number(e.target.value) })} />
            </label>
            <label>
              Rotation: {(view3d ?? defaultView3d("surface")).rotY}°
              <input type="range" min={0} max={360} value={(view3d ?? defaultView3d("surface")).rotY} onChange={(e) => setView3d({ ...(view3d ?? defaultView3d("surface")), rotY: Number(e.target.value) })} />
            </label>
            <label>
              Perspective: {(view3d ?? defaultView3d("surface")).perspective ?? 15}°
              <input type="range" aria-label="Perspective" min={0} max={100} disabled={!!(view3d ?? defaultView3d("surface")).rightAngle} value={(view3d ?? defaultView3d("surface")).perspective ?? 15} onChange={(e) => setView3d({ ...(view3d ?? defaultView3d("surface")), perspective: Number(e.target.value) })} />
            </label>
            <label>
              Depth: {(view3d ?? defaultView3d("surface")).depth ?? 100}%
              <input type="range" aria-label="Depth" min={20} max={500} value={(view3d ?? defaultView3d("surface")).depth ?? 100} onChange={(e) => setView3d({ ...(view3d ?? defaultView3d("surface")), depth: Number(e.target.value) })} />
            </label>
            <label>
              <input type="checkbox" aria-label="Right-angle axes" checked={!!(view3d ?? defaultView3d("surface")).rightAngle} onChange={(e) => setView3d({ ...(view3d ?? defaultView3d("surface")), rightAngle: e.target.checked })} /> Right-angle axes
            </label>
          </div>
        ) : null}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}

