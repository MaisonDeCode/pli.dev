import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { CHART_COLORS, chartRef, chartRefText, type ChartData } from "./chart";
import { waterfallSteps } from "./chartstats";
import type { Chart, ChartAxis, ChartFont, ChartSeries, ChartTickMark, ChartTitleRun, ChartType } from "./model";
import { axisDefaults, type AxisKey } from "./chart-extras";
import { chartTxPr, fontParts, readFont, readTitleStyle, readTxPrFont } from "./xlsx-chart-more";

/*
 * Excel 2016's own chart kinds (waterfall, histogram, Pareto, funnel, box and whisker, treemap, sunburst) are not
 * DrawingML charts. Excel keeps them as "chartex" parts: `xl/charts/chartExN.xml`, whose data sits in `cx:chartData` (a
 * reference and a cache for each dimension) and whose series name a layout (`layoutId`) and its options. They are anchored in
 * the sheet's drawing inside `mc:AlternateContent`, with a placeholder shape for programs that don't know them.
 *
 * Written from the published format description; Excel is the only program here that reads these, and the Excel check
 * kit's file 21 is how a person confirms Excel opens them.
 */

export const NS_CX = "http://schemas.microsoft.com/office/drawing/2014/chartex";
export const NS_CX1 = "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex";
export const CHARTEX_REL = "http://schemas.microsoft.com/office/2014/relationships/chartEx";
export const CHARTEX_CONTENT_TYPE = "application/vnd.ms-office.chartex+xml";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const LAYOUT: Partial<Record<ChartType, string>> = { waterfall: "waterfall", histogram: "clusteredColumn", pareto: "clusteredColumn", funnel: "funnel", boxWhisker: "boxWhisker", treemap: "treemap", sunburst: "sunburst" };
const SIDE = { top: "t", bottom: "b", left: "l", right: "r" } as const;

/** Where a chartex kind puts its legend when the chart doesn't say: only a waterfall (Increase, Decrease, Total) and a box chart of several series have one. */
export function exDefaultLegend(chart: Pick<Chart, "type" | "series">): "bottom" | "none" {
  return chart.type === "waterfall" || ((chart.type === "boxWhisker" || chart.type === "histogram" || chart.type === "pareto") && chart.series.length > 1) ? "bottom" : "none";
}

const uid = (n: number) => `{${[8, 4, 4, 4, 12].map((len, k) => (k === 4 ? "0".repeat(len - 3) + String(100 + n).padStart(3, "0") : "0".repeat(len))).join("-")}}`;

function strDim(f: string | null, texts: readonly string[]): string {
  const lvl = `<cx:lvl ptCount="${texts.length}">${texts.map((t, i) => `<cx:pt idx="${i}">${esc(t)}</cx:pt>`).join("")}</cx:lvl>`;
  return `<cx:strDim type="cat">${f ? `<cx:f>${esc(f)}</cx:f>` : ""}${lvl}</cx:strDim>`;
}
function numDim(f: string | null, values: readonly (number | null)[]): string {
  return `<cx:numDim type="val">${f ? `<cx:f>${esc(f)}</cx:f>` : ""}<cx:lvl ptCount="${values.length}" formatCode="General">${values.map((v, i) => (v === null ? "" : `<cx:pt idx="${i}">${v}</cx:pt>`)).join("")}</cx:lvl></cx:numDim>`;
}

const titleXml = (text: string, font?: Chart["font"], runs?: ChartTitleRun[], size = 1400, bold = true) => {
  const f = font && Object.keys(font).length ? fontParts(font, size, bold) : null;
  const run = (t: string, look?: ChartFont, underline?: boolean) => {
    const g = look && Object.keys(look).length ? fontParts({ ...font, ...look }, size, bold) : f;
    return `<a:r>${g ? `<a:rPr lang="en-US" ${g.attrs}${underline ? ' u="sng"' : ""}>${g.inner}</a:rPr>` : `<a:rPr lang="en-US"${underline ? ' u="sng"' : ""}/>`}<a:t>${esc(t)}</a:t></a:r>`;
  };
  const body = runs?.length ? runs.map(({ text: t, underline, ...look }) => run(t, look, underline)).join("") : run(text);
  return `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:rich><a:bodyPr/><a:p>${body}</a:p></cx:rich></cx:tx></cx:title>`;
};
const axisTitle = (text: string | undefined, a?: ChartAxis, chartFont?: ChartFont) => (text ? titleXml(text, { ...chartFont, ...a?.titleFont }, a?.titleRuns, 1000, false).replace(/^<cx:title [^>]*>/, "<cx:title>") : "");

const POS = { center: "ctr", insideEnd: "inEnd", insideBase: "inBase", outsideEnd: "outEnd" } as const;

/** One `cx:axis`: its scale, title, gridlines, tick marks and labels, from the chart's settings for that axis. */
function exAxisXml(chart: Chart, id: number, key: AxisKey, scaling: string, title: string, o: { grid?: boolean; extra?: string } = {}): string {
  const a: ChartAxis | undefined = chart.axes?.[key];
  const d = axisDefaults(chart.type, key);
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));
  const sc = scaling === "val" ? `<cx:valScaling${a?.max !== undefined ? ` max="${a.max}"` : ""}${a?.min !== undefined ? ` min="${a.min}"` : ""}${a?.majorUnit !== undefined ? ` majorUnit="${num(a.majorUnit)}"` : ""}${a?.minorUnit !== undefined ? ` minorUnit="${num(a.minorUnit)}"` : ""}/>` : scaling;
  const grid = (a?.majorGridlines ?? o.grid ?? d.majorGridlines) ? "<cx:majorGridlines/>" : "";
  const minorGrid = a?.minorGridlines ? "<cx:minorGridlines/>" : "";
  const tick = (name: "majorTickMarks" | "minorTickMarks", v: string | undefined, dflt: string) => (v && v !== dflt ? `<cx:${name} type="${v}"/>` : "");
  const labels = (a?.labels ?? d.labels) === "none" ? "" : "<cx:tickLabels/>";
  const fmt = a?.format ? `<cx:numFmt formatCode="${esc(a.format)}" sourceLinked="0"/>` : "";
  return `<cx:axis id="${id}"${a?.hidden ? ' hidden="1"' : ""}>${sc}${title}${o.extra ?? ""}${grid}${minorGrid}${tick("majorTickMarks", a?.majorTick, "out")}${tick("minorTickMarks", a?.minorTick, "none")}${labels}${fmt}${chartTxPr(a?.font, "cx")}</cx:axis>`;
}

/** One chartex chart as its part. `data` is what it shows now (the caches Excel keeps beside the references). */
export function chartExPartXml(chart: Chart, home: string, data: ChartData): string {
  const ref = (r: string | undefined) => {
    const parsed = chartRef(r, home);
    return parsed ? chartRefText(parsed.sheet, parsed.bounds) : null;
  };
  const layoutId = LAYOUT[chart.type]!;
  const cat = ref(chart.categories);
  const members = chart.type === "boxWhisker" || chart.type === "histogram" || chart.type === "pareto" ? chart.series.map((_, i) => i) : [0];
  const dataXml = members
    .map((i, k) => {
      const s = chart.series[i]!;
      const d = data.series[i];
      const values = ref(s.values);
      const dims = (chart.type === "histogram" ? "" : cat || data.categories.length ? strDim(cat, data.categories) : "") + numDim(values, d?.values ?? []);
      return `<cx:data id="${k}">${dims}</cx:data>`;
    })
    .join("");

  const hierarchy = chart.type === "treemap" || chart.type === "sunburst";
  const showOf = (part: "value" | "category" | "series") => (chart.labelShow ? chart.labelShow.includes(part) : part === "value" ? !!chart.labels : part === "category" && hierarchy);
  const labelPos = chart.labelPosition && chart.labelPosition in POS ? POS[chart.labelPosition as keyof typeof POS] : chart.type === "waterfall" || chart.type === "histogram" || chart.type === "pareto" ? "outEnd" : chart.type === "treemap" ? "inEnd" : undefined;
  const wantLabels = !!chart.labels || (hierarchy && (showOf("category") || !!chart.labelShow?.length));
  const labels = wantLabels ? `<cx:dataLabels${labelPos ? ` pos="${labelPos}"` : ""}><cx:visibility seriesName="${showOf("series") ? 1 : 0}" categoryName="${showOf("category") ? 1 : 0}" value="${showOf("value") ? 1 : 0}"/></cx:dataLabels>` : "";
  let layoutPr = "";
  if (chart.type === "waterfall" && (chart.totals?.length || chart.waterfall?.connectors === false)) {
    const connectors = chart.waterfall?.connectors === false ? '<cx:visibility connectorLines="0"/>' : "";
    layoutPr = `<cx:layoutPr>${connectors}${chart.totals?.length ? `<cx:subtotals>${chart.totals.map((i) => `<cx:idx val="${i}"/>`).join("")}</cx:subtotals>` : ""}</cx:layoutPr>`;
  }
  if (chart.type === "histogram") {
    const b = chart.bins ?? {};
    const attrs = `intervalClosed="${b.closed === "left" ? "l" : "r"}"${b.underflow !== undefined ? ` underflow="${b.underflow}"` : ""}${b.overflow !== undefined ? ` overflow="${b.overflow}"` : ""}`;
    const inner = b.by === "width" ? `<cx:binSize val="${b.size}"/>` : b.by === "count" ? `<cx:binCount val="${b.size}"/>` : "";
    layoutPr = `<cx:layoutPr>${inner ? `<cx:binning ${attrs}>${inner}</cx:binning>` : `<cx:binning ${attrs}/>`}</cx:layoutPr>`;
  }
  if (chart.type === "pareto") layoutPr = `<cx:layoutPr><cx:aggregation/></cx:layoutPr>`;
  if (chart.type === "boxWhisker") {
    const b = chart.box ?? {};
    layoutPr = `<cx:layoutPr><cx:visibility meanLine="${b.meanLine ? 1 : 0}" meanMarker="${b.meanMarker === false ? 0 : 1}" nonoutliers="${b.innerPoints ? 1 : 0}" outliers="${b.outliers === false ? 0 : 1}"/><cx:statistics quartileMethod="${b.quartile === "inclusive" ? "inclusive" : "exclusive"}"/></cx:layoutPr>`;
  }
  if (chart.type === "treemap" && chart.parentLabels) layoutPr = `<cx:layoutPr><cx:parentLabelLayout val="${chart.parentLabels === "none" ? "none" : chart.parentLabels}"/></cx:layoutPr>`;

  const axisId = chart.type === "pareto" ? '<cx:axisId val="1"/>' : "";
  // Colours of single bars: those the chart asks for, and for a waterfall the colours of increases, decreases and totals, point by point.
  const dataPoints = (s: ChartSeries, d: ChartData["series"][number] | undefined): string => {
    const colours = new Map<number, string>();
    if (chart.type === "waterfall" && (chart.waterfall?.increaseColor || chart.waterfall?.decreaseColor || chart.waterfall?.totalColor)) {
      waterfallSteps(d?.values ?? [], chart.totals).forEach((step, k) => {
        const c = step.kind === "increase" ? chart.waterfall?.increaseColor : step.kind === "decrease" ? chart.waterfall?.decreaseColor : chart.waterfall?.totalColor;
        if (c) colours.set(k, c);
      });
    }
    for (const [k, c] of Object.entries(s.pointColors ?? {})) colours.set(Number(k), c);
    return [...colours].sort((a, b) => a[0] - b[0]).map(([k, c]) => `<cx:dataPt idx="${k}"><cx:spPr><a:solidFill><a:srgbClr val="${c.slice(1).toUpperCase()}"/></a:solidFill></cx:spPr></cx:dataPt>`).join("");
  };
  const series = members
    .map((i, k) => {
      const s = chart.series[i]!;
      const d = data.series[i];
      const nameRef = ref(s.nameRef);
      const name = d?.name ?? `Series ${i + 1}`;
      const tx = nameRef || s.name ? `<cx:tx><cx:txData>${nameRef ? `<cx:f>${esc(nameRef)}</cx:f>` : ""}<cx:v>${esc(name)}</cx:v></cx:txData></cx:tx>` : "";
      const color = s.color && chart.type === "boxWhisker" ? `<cx:spPr><a:solidFill><a:srgbClr val="${s.color.slice(1).toUpperCase()}"/></a:solidFill></cx:spPr>` : "";
      return `<cx:series layoutId="${layoutId}" uniqueId="${uid(k)}">${tx}${color}${dataPoints(s, d)}${labels}<cx:dataId val="${k}"/>${layoutPr}${axisId}</cx:series>`;
    })
    .join("");
  const paretoLine = chart.type === "pareto" ? members.map((_, k) => `<cx:series layoutId="paretoLine" ownerIdx="${k}" uniqueId="${uid(20 + k)}"><cx:axisId val="2"/></cx:series>`).join("") : "";

  const noAxes = chart.type === "treemap" || chart.type === "sunburst";
  const gap = { waterfall: "0.5", histogram: "0", pareto: "0", funnel: "0.06", boxWhisker: "1" }[chart.type as "waterfall"] ?? "0.5";
  const axes = noAxes
    ? ""
    : exAxisXml(chart, 0, "x", `<cx:catScaling gapWidth="${gap}"/>`, axisTitle(chart.xTitle, chart.axes?.x, chart.font)) +
      (chart.type === "funnel" ? "" : exAxisXml(chart, 1, "y", "val", axisTitle(chart.yTitle, chart.axes?.y, chart.font), { grid: true })) +
      (chart.type === "pareto" ? `<cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>` : "");

  const side = chart.legend ?? exDefaultLegend(chart);
  const legend = side === "none" ? "" : `<cx:legend pos="${SIDE[side]}" align="ctr" overlay="0"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cx:chartSpace xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:cx="${NS_CX}">` +
    `<cx:chartData>${dataXml}</cx:chartData><cx:chart>${chart.title ? titleXml(chart.title, chart.titleFont ? { ...chart.font, ...chart.titleFont } : chart.font, chart.titleRuns) : ""}<cx:plotArea><cx:plotAreaRegion>${series}${paretoLine}</cx:plotAreaRegion>${axes}</cx:plotArea>${legend}</cx:chart>${chartTxPr(chart.font, "cx")}</cx:chartSpace>`
  );
}

/** The drawing anchor of a chartex chart: the chart inside alternate content, with a placeholder for programs that can't draw it. */
export function chartExAnchor(box: { col: number; row: number; dx: number; dy: number; cx: number; cy: number }, id: number, rid: string, alt?: string): string {
  const from = `<xdr:from><xdr:col>${box.col}</xdr:col><xdr:colOff>${box.dx}</xdr:colOff><xdr:row>${box.row}</xdr:row><xdr:rowOff>${box.dy}</xdr:rowOff></xdr:from><xdr:ext cx="${box.cx}" cy="${box.cy}"/>`;
  // Excel's own form: the anchor outside, the alternate content inside it, round the chart's frame.
  return (
    `<xdr:oneCellAnchor>${from}<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="${NS_CX1}" Requires="cx1">` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Chart ${id - 1}"${alt ? ` descr="${alt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"` : ""}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_CX}"><cx:chart xmlns:cx="${NS_CX}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>` +
    `<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This chart isn't available in your version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:oneCellAnchor>`
  );
}

// ================= reading =================

type ChartSpec = Omit<Chart, "id" | "from" | "width" | "height">;

const fileRef = (f: string | undefined, home: string): string | null => {
  if (!f) return null;
  const r = chartRef(f.trim(), home);
  return r ? chartRefText(r.sheet, r.bounds) : null;
};

/** Whether a part is a chartex part (rather than a DrawingML chart). */
export const isChartExPart = (root: XmlElement): boolean => child(root, "chartData") !== undefined;

function exTitle(title: XmlElement | undefined): string | undefined {
  if (!title) return undefined;
  const rich = child(child(title, "tx"), "rich");
  if (rich) {
    const t = childrenNamed(rich, "p").map((p) => childrenNamed(p, "r").map((r) => textOf(child(r, "t"))).join("")).filter(Boolean).join(" ").trim();
    return t || undefined;
  }
  return textOf(child(child(child(title, "tx"), "txData"), "v")).trim() || undefined;
}

/** The settings of a chartex axis element. */
function readExAxis(type: ChartType, key: AxisKey, el: XmlElement | undefined): ChartAxis | undefined {
  if (!el) return undefined;
  const out: ChartAxis = {};
  const d = axisDefaults(type, key);
  const val = child(el, "valScaling");
  const n = (e: XmlElement | undefined, name: string): number | undefined => {
    const v = attr(e, name);
    return v !== undefined && v !== "auto" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  if (val) {
    const max = n(val, "max");
    const min = n(val, "min");
    if (max !== undefined && min !== undefined && min >= max) {
      // not a usable pair
    } else {
      if (max !== undefined) out.max = max;
      if (min !== undefined) out.min = min;
    }
    const major = n(val, "majorUnit");
    const minor = n(val, "minorUnit");
    if (major !== undefined && major > 0) out.majorUnit = major;
    if (minor !== undefined && minor > 0) out.minorUnit = minor;
    const fmt = attr(child(el, "numFmt"), "formatCode");
    if (fmt && attr(child(el, "numFmt"), "sourceLinked") !== "1" && fmt !== "General") out.format = fmt;
  }
  const hasMajor = child(el, "majorGridlines") !== undefined;
  if (hasMajor !== d.majorGridlines) out.majorGridlines = hasMajor;
  if (child(el, "minorGridlines") !== undefined) out.minorGridlines = true;
  const tick = (name: string, dflt: ChartTickMark): ChartTickMark | undefined => {
    const t = child(el, name);
    const v = attr(t, "type");
    return v === "none" || v === "in" || v === "out" || v === "cross" ? v : t ? dflt : undefined;
  };
  const major = tick("majorTickMarks", "out");
  const minor = tick("minorTickMarks", "none");
  if (major && major !== d.majorTick) out.majorTick = major;
  if (minor && minor !== d.minorTick) out.minorTick = minor;
  if (!child(el, "tickLabels")) out.labels = "none";
  if (attr(el, "hidden") === "1" || attr(el, "hidden") === "true") out.hidden = true;
  return out;
}

/** Reads a chartex part. Null (and a warning) when it is a kind Pli doesn't know. */
export function readChartExPart(root: XmlElement, home: string, warnings: Set<string>, names?: ReadonlyMap<string, string>): ChartSpec | null {
  // Excel keeps the cells a chart reads in hidden names (`_xlchart.v1.0`); its own parts say so instead of giving the range.
  const deref = (text: string): string | undefined => (text ? names?.get(text.trim().toLowerCase()) ?? text : undefined);
  const chart = child(root, "chart");
  const region = child(child(chart, "plotArea"), "plotAreaRegion");
  const all = childrenNamed(region, "series");
  const main = all.filter((s) => attr(s, "layoutId") !== "paretoLine");
  const first = main[0];
  const layoutId = attr(first, "layoutId");
  if (!first || !layoutId) {
    warnings.add("A chart with no series was left out");
    return null;
  }
  const layoutPr = child(first, "layoutPr");
  let type: ChartType;
  if (layoutId === "clusteredColumn") type = all.length > main.length ? "pareto" : "histogram";
  else if (["waterfall", "funnel", "boxWhisker", "treemap", "sunburst"].includes(layoutId)) type = layoutId as ChartType;
  else {
    warnings.add(`A ${layoutId} chart is not supported yet and was left out`);
    return null;
  }
  const dataOf = (id: string | undefined) => childrenNamed(child(root, "chartData"), "data").find((d) => attr(d, "id") === id);
  const series: ChartSeries[] = [];
  let categories: string | undefined;
  let literal = false;
  main.forEach((ser, i) => {
    const data = dataOf(attr(child(ser, "dataId"), "val"));
    const val = childrenNamed(data, "numDim").find((d) => attr(d, "type") === "val") ?? childrenNamed(data, "numDim")[0];
    const values = fileRef(deref(textOf(child(val, "f"))), home);
    if (!values) {
      literal = true;
      return;
    }
    const s: ChartSeries = { values };
    const tx = child(child(ser, "tx"), "txData");
    const nameRef = fileRef(deref(textOf(child(tx, "f"))), home);
    if (nameRef) s.nameRef = nameRef;
    else if (textOf(child(tx, "v")).trim()) s.name = textOf(child(tx, "v")).trim();
    if (type === "boxWhisker") {
      const color = attr(child(child(child(ser, "spPr"), "solidFill"), "srgbClr"), "val");
      s.color = color && /^[0-9a-fA-F]{6}$/.test(color) ? `#${color.toLowerCase()}` : CHART_COLORS[i % CHART_COLORS.length]!;
    }
    const colours: Record<string, string> = {};
    for (const dp of childrenNamed(ser, "dataPt")) {
      const idx = attr(dp, "idx");
      const c = attr(child(child(child(dp, "spPr"), "solidFill"), "srgbClr"), "val");
      if (idx !== undefined && /^\d+$/.test(idx) && c && /^[0-9a-fA-F]{6}$/.test(c)) colours[idx] = `#${c.toLowerCase()}`;
    }
    if (Object.keys(colours).length && (type === "waterfall" || type === "funnel" || type === "treemap" || type === "sunburst")) s.pointColors = colours;
    if (!categories) {
      const cat = childrenNamed(data, "strDim").find((d) => attr(d, "type") === "cat") ?? childrenNamed(data, "strDim")[0];
      categories = fileRef(deref(textOf(child(cat, "f"))), home) ?? undefined;
    }
    series.push(s);
  });
  if (literal) warnings.add("Chart series typed in as numbers rather than taken from cells were left out");
  if (!series.length) {
    warnings.add("A chart with no series that read from cells was left out");
    return null;
  }
  const out: ChartSpec = { type, series };
  if (categories) out.categories = categories;
  const title = exTitle(child(chart, "title"));
  if (title) out.title = title;
  const legend = child(chart, "legend");
  const def = exDefaultLegend(out as Chart);
  if (legend) {
    const pos = attr(legend, "pos") ?? "r";
    const side = pos === "t" ? "top" : pos === "l" ? "left" : pos === "r" ? "right" : "bottom";
    if (side !== def) out.legend = side;
  } else if (def !== "none") out.legend = "none";
  const labelEl = child(first, "dataLabels");
  const vis = child(labelEl, "visibility");
  if (vis) {
    const show: NonNullable<Chart["labelShow"]> = [];
    if (attr(vis, "value") === "1") show.push("value");
    if (attr(vis, "categoryName") === "1") show.push("category");
    if (attr(vis, "seriesName") === "1") show.push("series");
    if (show.includes("value")) out.labels = true;
    const hierarchy = type === "treemap" || type === "sunburst";
    const plain = hierarchy ? show.includes("category") && !show.includes("series") : show.length === 1 && show[0] === "value";
    if (show.length && !plain) out.labelShow = show;
    const pos = ({ ctr: "center", inEnd: "insideEnd", inBase: "insideBase", outEnd: "outsideEnd" } as Record<string, NonNullable<Chart["labelPosition"]>>)[attr(labelEl, "pos") ?? ""];
    if (pos && (type === "waterfall" || type === "histogram" || type === "pareto") && pos !== "outsideEnd") out.labelPosition = pos;
  }

  if (type === "waterfall") {
    const totals = childrenNamed(child(layoutPr, "subtotals"), "idx").map((i) => Number(attr(i, "val"))).filter((n) => Number.isInteger(n) && n >= 0);
    if (totals.length) out.totals = [...new Set(totals)].sort((a, b) => a - b);
    if (attr(child(layoutPr, "visibility"), "connectorLines") === "0") out.waterfall = { connectors: false };
  }
  if (type === "histogram") {
    const bin = child(layoutPr, "binning");
    const bins: NonNullable<Chart["bins"]> = {};
    if (bin) {
      if (attr(bin, "intervalClosed") === "l") bins.closed = "left";
      for (const k of ["underflow", "overflow"] as const) {
        const v = Number(attr(bin, k));
        if (attr(bin, k) !== undefined && Number.isFinite(v)) bins[k] = v;
      }
      const size = Number(attr(child(bin, "binSize"), "val"));
      const count = Number(attr(child(bin, "binCount"), "val"));
      if (attr(child(bin, "binSize"), "val") !== undefined && size > 0) Object.assign(bins, { by: "width", size });
      else if (attr(child(bin, "binCount"), "val") !== undefined && count >= 1) Object.assign(bins, { by: "count", size: count });
    }
    if (Object.keys(bins).length) out.bins = bins;
  }
  if (type === "boxWhisker") {
    const vis = child(layoutPr, "visibility");
    const box: NonNullable<Chart["box"]> = {};
    if (attr(child(layoutPr, "statistics"), "quartileMethod") === "inclusive") box.quartile = "inclusive";
    if (attr(vis, "meanMarker") === "0") box.meanMarker = false;
    if (attr(vis, "meanLine") === "1") box.meanLine = true;
    if (attr(vis, "nonoutliers") === "1") box.innerPoints = true;
    if (attr(vis, "outliers") === "0") box.outliers = false;
    if (Object.keys(box).length) out.box = box;
  }
  if (type === "treemap") {
    const p = attr(child(layoutPr, "parentLabelLayout"), "val");
    if (p === "overlapping" || p === "none") out.parentLabels = p;
    else if (p === "banner") out.parentLabels = "banner";
  }
  const axes = childrenNamed(child(chart, "plotArea"), "axis");
  const x = exTitle(child(axes.find((a) => attr(a, "id") === "0"), "title"));
  const y = exTitle(child(axes.find((a) => attr(a, "id") === "1"), "title"));
  if (x) out.xTitle = x;
  if (y) out.yTitle = y;
  const cf = readFont(child(child(child(root, "txPr"), "p"), "pPr") ? child(child(child(child(root, "txPr"), "p"), "pPr"), "defRPr") : undefined);
  if (cf && cf.size === 10) delete cf.size;
  const found: NonNullable<Chart["axes"]> = {};
  for (const [id, key] of [["0", "x"], ["1", "y"]] as const) {
    const el = axes.find((a) => attr(a, "id") === id);
    const a = readExAxis(type, key, el);
    if (!a) continue;
    const labelFont = readTxPrFont(el, cf);
    if (labelFont) a.font = labelFont;
    const ts = readTitleStyle(child(el, "title"), cf, { size: 10, bold: false });
    if (ts.font) a.titleFont = ts.font;
    if (ts.runs) a.titleRuns = ts.runs;
    if (Object.keys(a).length) found[key] = a;
  }
  if (Object.keys(found).length) out.axes = found;
  if (cf && Object.keys(cf).length) out.font = cf;
  const titleRun = child(child(child(child(child(chart, "title"), "tx"), "rich"), "p"), "r");
  const tf = readFont(child(titleRun, "rPr"));
  if (tf) {
    if (tf.size === 14) delete tf.size;
    if (tf.bold === true) delete tf.bold;
    for (const k of Object.keys(tf) as (keyof typeof tf)[]) if (cf && cf[k] === tf[k] && k !== "bold") delete tf[k];
    if (Object.keys(tf).length) out.titleFont = tf;
  }
  const titleStyle = readTitleStyle(child(chart, "title"), cf, { size: 14, bold: true });
  if (titleStyle.runs) {
    out.titleRuns = titleStyle.runs;
    delete out.titleFont;
  }
  return out;
}
