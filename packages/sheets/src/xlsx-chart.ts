import { attr, child, childrenNamed, createId, elements, textOf, type XmlElement } from "@pli.dev/core";
import { CHARTEX_REL, chartExAnchor, chartExPartXml, isChartExPart, readChartExPart } from "./xlsx-chartex";
import { CHART_COLORS, isChartex, MAX_CHART_SIZE, defaultView3d, MIN_CHART_SIZE, chartRef, chartRefText, isCombined, readChart, seriesKind, stockKind, type ChartData } from "./chart";
import type { Chart, ChartAxis, ChartFont, ChartTitleRun, ChartSeries, ChartType, Sheet, Trendline, TrendlineType, Workbook } from "./model";
import { axisDefaults, type AxisKey } from "./chart-extras";
import { chartTxPr, crossesXml, dLblsXml, fontParts, gridXml, readAxis, readCrossing, readDLbls, readFont, readSeriesErrBars, readTitleStyle, readTxPrFont, scalingXml, seriesErrBarsXml, skipXml, stockLookXml, ticksXml, unitsXml } from "./xlsx-chart-more";
import { DEFAULT_DEPTH, DEFAULT_PERSPECTIVE } from "./chart-detail";
import type { Value } from "./values";

/*
 * Charts in an .xlsx file: a worksheet points at a drawing, which anchors each chart to cells, and each chart is a
 * DrawingML part of its own. Pli writes the kinds it has (column, bar, line, area, pie, scatter) and reads those back,
 * and reads the same kinds from files made elsewhere; anything else is left out and said so.
 */

const EMU = 9525; // per pixel
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ================= writing =================

const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const solid = (color: string) => `<a:solidFill><a:srgbClr val="${color.slice(1).toUpperCase()}"/></a:solidFill>`;

function textBody(text: string, size: number, bold: boolean, font?: ChartFont): string {
  const f = fontParts(font, size, bold);
  const def = f.inner ? `<a:defRPr ${f.attrs}>${f.inner}</a:defRPr>` : `<a:defRPr ${f.attrs}/>`;
  const run = f.inner ? `<a:rPr lang="en-US" ${f.attrs}>${f.inner}</a:rPr>` : `<a:rPr lang="en-US" ${f.attrs}/>`;
  return `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr>${def}</a:pPr><a:r>${run}<a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}

const titleXml = (text: string, size: number, font?: ChartFont, runs?: ChartTitleRun[]) => `<c:title>${runs?.length ? runsBody(runs, size, font) : textBody(text, size, size > 1200, font)}<c:overlay val="0"/></c:title>`;

/** A title in pieces: one `a:r` for each, each with the look it asks for over the title's own. */
function runsBody(runs: ChartTitleRun[], size: number, font?: ChartFont): string {
  const base = fontParts(font, size, size > 1200);
  const def = base.inner ? `<a:defRPr ${base.attrs}>${base.inner}</a:defRPr>` : `<a:defRPr ${base.attrs}/>`;
  const rs = runs.map((r) => {
    const { text, underline, ...look } = r;
    const f = fontParts({ ...font, ...look }, size, size > 1200);
    return `<a:r><a:rPr lang="en-US" ${f.attrs}${underline ? ' u="sng"' : ""}>${f.inner}</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
  });
  return `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr>${def}</a:pPr>${rs.join("")}</a:p></c:rich></c:tx>`;
}

function strRef(f: string, texts: readonly string[]): string {
  return `<c:strRef><c:f>${esc(f)}</c:f><c:strCache><c:ptCount val="${texts.length}"/>${texts.map((t, i) => `<c:pt idx="${i}"><c:v>${esc(t)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef>`;
}

function numRef(f: string, numbers: readonly (number | null)[]): string {
  return `<c:numRef><c:f>${esc(f)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${numbers.length}"/>${numbers.map((n, i) => (n === null ? "" : `<c:pt idx="${i}"><c:v>${n}</c:v></c:pt>`)).join("")}</c:numCache></c:numRef>`;
}

const GROUPING = { stacked: "stacked", percent: "percentStacked" } as const;

const TREND_FILE = { linear: "linear", exponential: "exp", logarithmic: "log", polynomial: "poly", power: "power", movingAverage: "movingAvg" } as const;

/** The `c:trendline` elements of a series. */
function trendlinesXml(s: ChartSeries, color: string): string {
  return (s.trendlines ?? [])
    .map((t) => {
      const c = t.color ?? color;
      const l = t.label;
      const layout = l && (l.x || l.y) ? `<c:layout><c:manualLayout><c:x val="${l.x ?? 0}"/><c:y val="${l.y ?? 0}"/></c:manualLayout></c:layout>` : "<c:layout/>";
      const text = l?.text ? `<c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(l.text)}</a:t></a:r></a:p></c:rich></c:tx>` : "";
      const label = t.equation || t.rSquared ? `<c:trendlineLbl>${layout}${text}<c:numFmt formatCode="${esc(l?.format ?? "General")}" sourceLinked="0"/>${chartTxPr(l?.font)}</c:trendlineLbl>` : "";
      return (
        `<c:trendline>${t.name ? `<c:name>${esc(t.name)}</c:name>` : ""}<c:spPr><a:ln w="19050" cap="rnd">${solid(c)}<a:prstDash val="sysDash"/></a:ln></c:spPr>` +
        `<c:trendlineType val="${TREND_FILE[t.type]}"/>${t.type === "polynomial" ? `<c:order val="${t.order ?? 2}"/>` : ""}${t.type === "movingAverage" ? `<c:period val="${t.period ?? 2}"/>` : ""}` +
        `${t.forward ? `<c:forward val="${t.forward}"/>` : ""}${t.backward ? `<c:backward val="${t.backward}"/>` : ""}${t.intercept !== undefined ? `<c:intercept val="${t.intercept}"/>` : ""}` +
        `<c:dispRSqr val="${t.rSquared ? 1 : 0}"/><c:dispEq val="${t.equation ? 1 : 0}"/>${label}</c:trendline>`
      );
    })
    .join("");
}

const alphaFill = (color: string, alpha: number) => `<a:solidFill><a:srgbClr val="${color.slice(1).toUpperCase()}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
const numLit = (xs: readonly number[]) => `<c:numLit><c:ptCount val="${xs.length}"/>${xs.map((v, k) => `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`;

/** One chart as a DrawingML chart part. `data` is what it shows now, written as the cache Excel keeps beside each reference. */
export function chartPartXml(chart: Chart, home: string, data: ChartData): string {
  const stackable = chart.type === "column" || chart.type === "bar" || chart.type === "line" || chart.type === "area";
  const ref = (r: string | undefined) => {
    const parsed = chartRef(r, home);
    return parsed ? chartRefText(parsed.sheet, parsed.bounds) : null;
  };
  const showVal = dLblsXml(chart, chart.type);
  const three = !!chart.view3d && chart.type !== "surface";
  const combined = isCombined(chart);
  const stock = chart.type === "stock" ? stockKind(chart) : undefined;
  const volume = stock === "vhlc" || stock === "vohlc";

  /** The series `i` as a `c:ser`, drawn as `kind`. */
  const ser = (i: number, kind: ChartType): string => {
    const s = chart.series[i]!;
    const d = data.series[i];
    const values = ref(s.values);
    if (!d || !values) return "";
    const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length]!;
    const nameRef = ref(s.nameRef);
    // A series with no name of its own is left without one (the program shows "Series 1" itself).
    const tx = nameRef ? `<c:tx>${strRef(nameRef, [d.name])}</c:tx>` : s.name ? `<c:tx><c:v>${esc(d.name)}</c:v></c:tx>` : "";
    const cat = ref(chart.categories);
    const cats = cat ? `<c:cat>${strRef(cat, data.categories)}</c:cat>` : "";
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`;
    const trend = trendlinesXml(s, color) + seriesErrBarsXml(s, d.errorBars, home, kind === "column" || kind === "bar");
    const val = `<c:val>${numRef(values, d.values)}</c:val>`;
    const marker = (size: number) => (chart.markers === false ? `<c:marker><c:symbol val="none"/></c:marker>` : `<c:marker><c:symbol val="circle"/><c:size val="${size}"/><c:spPr>${solid(color)}</c:spPr></c:marker>`);
    // The colours of single points: a fill for a bar, a fill of the marker for a line or a scatter point.
    const coloured = Object.entries(s.pointColors ?? {}).map(([k, c]) => [Number(k), c] as const).filter(([k]) => k < d.values.length).sort((a, b) => a[0] - b[0]);
    const barPts = coloured.map(([k, c]) => `<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${solid(c)}</c:spPr></c:dPt>`).join("");
    const markerPts = (size: number) => (chart.markers === false ? "" : coloured.map(([k, c]) => `<c:dPt><c:idx val="${k}"/><c:marker><c:symbol val="circle"/><c:size val="${size}"/><c:spPr>${solid(c)}</c:spPr></c:marker><c:bubble3D val="0"/></c:dPt>`).join(""));
    const bubblePts = coloured.map(([k, c]) => `<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="${chart.bubble3d ? 1 : 0}"/><c:spPr>${alphaFill(c, 75000)}<a:ln w="9525">${solid(c)}</a:ln></c:spPr></c:dPt>`).join("");
    switch (kind) {
      case "column":
      case "bar":
        return `<c:ser>${head}<c:spPr>${solid(color)}</c:spPr><c:invertIfNegative val="0"/>${three ? "" : barPts}${trend}${cats}${val}</c:ser>`;
      case "line":
        if (three) return `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>${cats}${val}</c:ser>`;
        return `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>${marker(5)}${markerPts(5)}${trend}${cats}${val}<c:smooth val="${chart.smooth ? 1 : 0}"/></c:ser>`;
      case "area":
        return `<c:ser>${head}<c:spPr>${solid(color)}</c:spPr>${trend}${cats}${val}</c:ser>`;
      case "pie":
      case "doughnut":
      case "pieOfPie":
      case "barOfPie": {
        const explode = (k: number) => s.pointExplosion?.[String(k)] ?? s.explosion;
        // A slice says its explosion only where it differs from the series' own.
        const own = s.explosion ?? 0;
        const points = data.categories.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/>${(explode(k) ?? 0) !== own ? `<c:explosion val="${Math.round(explode(k) ?? 0)}"/>` : ""}<c:spPr>${solid(s.pointColors?.[String(k)] ?? CHART_COLORS[k % CHART_COLORS.length]!)}</c:spPr></c:dPt>`).join("");
        return `<c:ser>${head}${s.explosion ? `<c:explosion val="${Math.round(s.explosion)}"/>` : ""}${points}${showVal}${cats}${val}</c:ser>`;
      }
      case "scatter": {
        const xy = chart.type === "scatter";
        const x = ref(s.x) ?? (xy && chart.categories ? ref(chart.categories) : null);
        const xs = d.x ?? [];
        const xVal = x ? `<c:xVal>${numRef(x, xs)}</c:xVal>` : `<c:xVal>${numLit(xs)}</c:xVal>`;
        const line = xy && (chart.smooth || chart.lines) ? `<a:ln w="19050">${solid(color)}</a:ln>` : `<a:ln w="19050"><a:noFill/></a:ln>`;
        return `<c:ser>${head}<c:spPr>${line}</c:spPr>${marker(6)}${markerPts(6)}${trend}${xVal}<c:yVal>${numRef(values, d.values)}</c:yVal><c:smooth val="${chart.smooth ? 1 : 0}"/></c:ser>`;
      }
      case "bubble": {
        const x = ref(s.x) ?? (chart.categories ? ref(chart.categories) : null);
        const size = ref(s.size);
        const xVal = x ? `<c:xVal>${numRef(x, d.x ?? [])}</c:xVal>` : `<c:xVal>${numLit(d.x ?? [])}</c:xVal>`;
        const sizes = d.size ?? [];
        const bubbleSize = size ? `<c:bubbleSize>${numRef(size, sizes)}</c:bubbleSize>` : `<c:bubbleSize>${numLit(sizes.map((v) => v ?? 1))}</c:bubbleSize>`;
        return `<c:ser>${head}<c:spPr>${alphaFill(color, 75000)}<a:ln w="9525">${solid(color)}</a:ln></c:spPr><c:invertIfNegative val="0"/>${bubblePts}${trend}${xVal}<c:yVal>${numRef(values, d.values)}</c:yVal>${bubbleSize}<c:bubble3D val="${chart.bubble3d ? 1 : 0}"/></c:ser>`;
      }
      case "radar":
        return `<c:ser>${head}<c:spPr>${chart.filled ? solid(color) : `<a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln>`}</c:spPr>${chart.filled ? "" : marker(5) + markerPts(5)}${cats}${val}</c:ser>`;
      case "stock":
        return `<c:ser>${head}<c:spPr>${solid(color)}<a:ln w="19050" cap="rnd"><a:noFill/><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cats}${val}<c:smooth val="0"/></c:ser>`;
      case "surface":
        return `<c:ser>${head}${cats}${val}</c:ser>`;
      default:
        return "";
    }
  };

  const ids = (cat: number, val: number, third?: number) => `<c:axId val="${cat}"/><c:axId val="${val}"/>${third !== undefined ? `<c:axId val="${third}"/>` : ""}`;
  const dLbls = chart.labels ? showVal : "";
  let plot = "";
  let axes = "";
  const horizontal = chart.type === "bar";
  const cross = (id: number, other: ChartAxis | undefined, at = "autoZero") => `<c:crossAx val="${id}"/>${crossesXml(other, at)}`;
  const font = chart.font;
  const ax = (key: AxisKey) => chart.axes?.[key];
  /** An axis title: its text, in the chart's font over the axis' own title font, or in pieces. */
  const axTitle = (key: AxisKey, text: string | undefined) => (text ? titleXml(text, 1000, { ...font, ...ax(key)?.titleFont }, ax(key)?.titleRuns) : "");
  const xTitle = axTitle("x", chart.xTitle);
  const yTitle = axTitle("y", chart.yTitle);
  /** `key` names the axis in the chart's `axes`; `cross` is the axis that crosses this one at the place its `crosses` names. */
  const catAx = (id: number, crossId: number, o: { key: AxisKey; crossKey?: AxisKey; pos: string; title?: string; flip?: boolean; deleted?: boolean; at?: string; grid?: boolean }) => {
    const a = ax(o.key);
    return `<c:catAx><c:axId val="${id}"/>${scalingXml(a, !!o.flip)}<c:delete val="${o.deleted || a?.hidden ? 1 : 0}"/><c:axPos val="${o.pos}"/>${gridXml(chart, o.key, a, o.grid)}${o.title ?? ""}<c:numFmt formatCode="General" sourceLinked="1"/>${ticksXml(chart, o.key, a)}${cross(crossId, o.crossKey ? ax(o.crossKey) : undefined, o.at)}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${skipXml(a)}<c:noMultiLvlLbl val="0"/></c:catAx>`;
  };
  const valAx = (id: number, crossId: number, o: { key: AxisKey; crossKey?: AxisKey; pos: string; title?: string; grid?: boolean; at?: string; between?: boolean; percent?: boolean; deleted?: boolean }) => {
    const a = ax(o.key);
    const fmt = a?.format ? `<c:numFmt formatCode="${esc(a.format)}" sourceLinked="0"/>` : `<c:numFmt formatCode="${o.percent ? "0%" : "General"}" sourceLinked="${o.percent ? 0 : 1}"/>`;
    return `<c:valAx><c:axId val="${id}"/>${scalingXml(a, false)}<c:delete val="${o.deleted || a?.hidden ? 1 : 0}"/><c:axPos val="${o.pos}"/>${gridXml(chart, o.key, a, o.grid)}${o.title ?? ""}${fmt}${ticksXml(chart, o.key, a)}${cross(crossId, o.crossKey ? ax(o.crossKey) : undefined, o.at)}<c:crossBetween val="${o.between === false ? "midCat" : "between"}"/>${unitsXml(a)}</c:valAx>`;
  };
  const common = `<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`;

  const cartesian = chart.type === "column" || chart.type === "bar" || chart.type === "line" || chart.type === "area";
  if (cartesian) {
    const grouped = stackable ? chart.grouping : undefined;
    const seriesAxis = three && (chart.type === "line" || chart.type === "area") && !grouped;
    // Series are gathered into one chart element for each kind and axis; primary ones first, and in each set areas, then columns, then lines (the order Excel paints them).
    const groups: string[] = [];
    for (const axis of ["primary", "secondary"] as const) {
      const [cat, val] = axis === "primary" ? [111, 222] : [333, 444];
      // The chart's own kind is written first (so it is the one read back as the chart's kind); Excel paints areas, columns and lines in that order whatever the file says.
      const own = chart.type === "bar" ? "column" : chart.type;
      for (const kind of ["area", "column", "line", "scatter"].sort((a, b) => (a === own ? -1 : 0) - (b === own ? -1 : 0)) as ("area" | "column" | "line" | "scatter")[]) {
        const members = chart.series.map((s, i) => [s, i] as const).filter(([s]) => (s.axis === "secondary" ? "secondary" : "primary") === axis && (chart.type === "bar" ? kind === "column" : seriesKind(chart, s) === kind));
        if (!members.length) continue;
        // Piling up applies to the kind the chart is, and to the other kinds as the chart's `kindGrouping` says (otherwise a line on stacked columns is a plain line).
        const g = kind === own ? grouped : kind === "scatter" ? undefined : chart.kindGrouping?.[kind];
        const body = members.map(([, i]) => ser(i, chart.type === "bar" ? "bar" : kind)).join("");
        const ax = ids(cat, val, three ? (seriesAxis ? 555 : 0) : undefined);
        if (kind === "scatter") {
          groups.push(`<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${body}${dLbls}${ids(cat, val)}</c:scatterChart>`);
        } else if (kind === "column") {
          groups.push(
            three
              ? `<c:bar3DChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${g ? GROUPING[g] : "clustered"}"/><c:varyColors val="0"/>${body}${dLbls}<c:gapWidth val="${g ? 60 : 80}"/><c:shape val="box"/>${ax}</c:bar3DChart>`
              : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${g ? GROUPING[g] : "clustered"}"/><c:varyColors val="0"/>${body}${dLbls}<c:gapWidth val="${g ? 60 : 80}"/>${g ? '<c:overlap val="100"/>' : ""}${ax}</c:barChart>`,
          );
        } else if (kind === "line") {
          groups.push(
            three
              ? `<c:line3DChart><c:grouping val="${g ? GROUPING[g] : "standard"}"/><c:varyColors val="0"/>${body}${dLbls}${ax}</c:line3DChart>`
              : `<c:lineChart><c:grouping val="${g ? GROUPING[g] : "standard"}"/><c:varyColors val="0"/>${body}${dLbls}<c:marker val="1"/>${ax}</c:lineChart>`,
          );
        } else {
          groups.push(
            three
              ? `<c:area3DChart><c:grouping val="${g ? GROUPING[g] : "standard"}"/><c:varyColors val="0"/>${body}${dLbls}${ax}</c:area3DChart>`
              : `<c:areaChart><c:grouping val="${g ? GROUPING[g] : "standard"}"/><c:varyColors val="0"/>${body}${dLbls}${ax}</c:areaChart>`,
          );
        }
      }
    }
    plot = groups.join("");
    const hasSecondary = chart.series.some((s) => s.axis === "secondary");
    // A bar chart lists its categories from the top, so its value axis crosses at the far end of the category axis to stay at the bottom.
    const flipped = horizontal !== !!chart.axes?.x?.reverse;
    // Excel writes the side an axis stands on: the other side when the axis it crosses runs the other way.
    const catPos = horizontal ? (chart.axes?.y?.reverse ? "r" : "l") : chart.axes?.y?.reverse ? "t" : "b";
    const valPos = horizontal ? "b" : chart.axes?.x?.reverse ? "r" : "l";
    axes = catAx(111, 222, { key: "x", crossKey: "y", pos: catPos, title: xTitle, flip: horizontal }) + valAx(222, 111, { key: "y", crossKey: "x", pos: valPos, title: yTitle, grid: true, at: horizontal && flipped ? "max" : "autoZero", between: chart.type !== "area", percent: grouped === "percent" });
    if (seriesAxis) axes += `<c:serAx><c:axId val="555"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${common}${cross(222, undefined)}</c:serAx>`;
    if (hasSecondary) {
      const showX = !!chart.secondaryCategoryAxis;
      axes +=
        valAx(444, 333, { key: "y2", crossKey: "x2", pos: horizontal ? "t" : "r", title: axTitle("y2", chart.y2Title), at: "max", between: chart.type !== "area" }) +
        catAx(333, 444, { key: "x2", crossKey: "y2", pos: horizontal ? (showX ? "r" : "l") : showX ? "t" : "b", title: axTitle("x2", chart.x2Title), deleted: !showX, flip: horizontal, at: showX ? "max" : "autoZero" });
    }
  } else if (chart.type === "pie") {
    plot = three ? `<c:pie3DChart><c:varyColors val="1"/>${chart.series.map((_, i) => ser(i, "pie")).join("")}</c:pie3DChart>` : `<c:pieChart><c:varyColors val="1"/>${chart.series.map((_, i) => ser(i, "pie")).join("")}<c:firstSliceAng val="${Math.round(chart.firstSliceAngle ?? 0)}"/></c:pieChart>`;
  } else if (chart.type === "doughnut") {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${chart.series.map((_, i) => ser(i, "doughnut")).join("")}<c:firstSliceAng val="${Math.round(chart.firstSliceAngle ?? 0)}"/><c:holeSize val="${Math.round(chart.holeSize ?? 50)}"/></c:doughnutChart>`;
  } else if (chart.type === "pieOfPie" || chart.type === "barOfPie") {
    const sp = chart.split ?? { by: "position", at: 3 };
    const splitTail = sp.by === "custom" ? `<c:splitType val="cust"/><c:custSplit>${(sp.points ?? []).map((i) => `<c:secondPiePt val="${i}"/>`).join("")}</c:custSplit>` : `<c:splitType val="${{ position: "pos", value: "val", percent: "percent" }[sp.by]}"/><c:splitPos val="${sp.at}"/>`;
    plot = `<c:ofPieChart><c:ofPieType val="${chart.type === "pieOfPie" ? "pie" : "bar"}"/><c:varyColors val="1"/>${ser(0, chart.type)}<c:gapWidth val="100"/>${splitTail}<c:secondPieSize val="${Math.round(chart.secondSize ?? 75)}"/><c:serLines/></c:ofPieChart>`;
  } else if (chart.type === "scatter") {
    const second = chart.series.some((s) => s.axis === "secondary");
    const grp = (axis: "primary" | "secondary") => {
      const members = chart.series.map((s, i) => [s, i] as const).filter(([s]) => (s.axis === "secondary" ? "secondary" : "primary") === axis);
      if (!members.length) return "";
      const [x, y] = axis === "primary" ? [111, 222] : [333, 444];
      return `<c:scatterChart><c:scatterStyle val="${chart.smooth ? "smoothMarker" : "lineMarker"}"/><c:varyColors val="0"/>${members.map(([, i]) => ser(i, "scatter")).join("")}${dLbls}${ids(x, y)}</c:scatterChart>`;
    };
    plot = grp("primary") + grp("secondary");
    axes = valAx(111, 222, { key: "x", crossKey: "y", pos: "b", title: xTitle, between: false }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", title: yTitle, grid: true, between: false });
    if (second) axes += valAx(444, 333, { key: "y2", crossKey: "x2", pos: "r", title: axTitle("y2", chart.y2Title), at: "max", between: false }) + valAx(333, 444, { key: "x2", crossKey: "y2", pos: "t", title: axTitle("x2", chart.x2Title), deleted: !chart.secondaryCategoryAxis, at: "max", between: false });
  } else if (chart.type === "bubble") {
    plot = `<c:bubbleChart><c:varyColors val="0"/>${chart.series.map((_, i) => ser(i, "bubble")).join("")}${dLbls}<c:bubbleScale val="${Math.round(chart.bubbleScale ?? 100)}"/><c:showNegBubbles val="0"/>${ids(111, 222)}</c:bubbleChart>`;
    axes = valAx(111, 222, { key: "x", crossKey: "y", pos: "b", title: xTitle, between: false }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", title: yTitle, grid: true, between: false });
  } else if (chart.type === "radar") {
    plot = `<c:radarChart><c:radarStyle val="${chart.filled ? "filled" : "marker"}"/><c:varyColors val="0"/>${chart.series.map((_, i) => ser(i, "radar")).join("")}${dLbls}${ids(111, 222)}</c:radarChart>`;
    axes = catAx(111, 222, { key: "x", crossKey: "y", pos: "b", grid: true }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", grid: true });
  } else if (chart.type === "stock") {
    const firstStock = volume ? 1 : 0;
    const members = chart.series.map((_, i) => i).slice(firstStock, firstStock + (stock === "hlc" || stock === "vhlc" ? 3 : 4));
    const open = stock === "ohlc" || stock === "vohlc";
    const look = stockLookXml(chart.stockLook, open);
    const bars = look.bars;
    const [cat, val] = volume ? [333, 444] : [111, 222];
    const stockXml = `<c:stockChart>${members.map((i) => ser(i, "stock")).join("")}${look.hiLow}${bars}${ids(cat, val)}</c:stockChart>`;
    if (volume) {
      plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser(0, "column")}<c:gapWidth val="150"/>${ids(111, 222)}</c:barChart>${stockXml}`;
      axes = catAx(111, 222, { key: "x", crossKey: "y", pos: "b", title: xTitle }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", title: yTitle, grid: true }) + valAx(444, 333, { key: "y2", crossKey: "x2", pos: "r", title: axTitle("y2", chart.y2Title), at: "max" }) + catAx(333, 444, { key: "x2", crossKey: "y2", pos: "b", deleted: true });
    } else {
      plot = stockXml;
      axes = catAx(111, 222, { key: "x", crossKey: "y", pos: "b", title: xTitle }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", title: yTitle, grid: true });
    }
  } else if (chart.type === "surface") {
    const v = chart.view3d ?? defaultView3d("surface");
    const body = chart.series.map((_, i) => ser(i, "surface")).join("");
    plot = `<c:${v.rotX >= 90 ? "surfaceChart" : "surface3DChart"}><c:wireframe val="${chart.wireframe ? 1 : 0}"/>${body}${ids(111, 222, 333)}</c:${v.rotX >= 90 ? "surfaceChart" : "surface3DChart"}>`;
    axes = catAx(111, 222, { key: "x", crossKey: "y", pos: "b", title: xTitle }) + valAx(222, 111, { key: "y", crossKey: "x", pos: "l", title: yTitle, grid: true }) + `<c:serAx><c:axId val="333"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${common}${cross(222, undefined)}</c:serAx>`;
  }

  // The grid shows no legend for a lone series (it would only repeat the title); the file doesn't either.
  const circular = chart.type === "pie" || chart.type === "doughnut" || chart.type === "pieOfPie" || chart.type === "barOfPie";
  const side = chart.legend ?? (!circular && chart.series.length <= 1 ? "none" : "bottom");
  const legend = side === "none" ? "" : `<c:legend><c:legendPos val="${({ top: "t", bottom: "b", left: "l", right: "r" } as const)[side]}"/><c:overlay val="0"/>${chartTxPr(chart.legendFont)}</c:legend>`;
  const view = chart.type === "surface" ? chart.view3d ?? defaultView3d("surface") : three ? chart.view3d : undefined;
  // Excel keeps the angle of view doubled (its pane shows 15 where the file says 30), and no perspective when the axes are at right angles.
  const view3D = view
    ? `<c:view3D><c:rotX val="${Math.round(view.rotX)}"/><c:rotY val="${Math.round(view.rotY) % 360}"/>${view.depth !== undefined && view.depth !== DEFAULT_DEPTH ? `<c:depthPercent val="${Math.round(view.depth)}"/>` : ""}<c:rAngAx val="${view.rightAngle ? 1 : 0}"/>${(chart.type === "surface" && view.rotX >= 90) || view.rightAngle ? "" : `<c:perspective val="${Math.round(2 * (view.perspective ?? DEFAULT_PERSPECTIVE))}"/>`}</c:view3D>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>` +
    `<c:chart>${chart.title ? titleXml(chart.title, 1400, chart.titleFont ? { ...chart.font, ...chart.titleFont } : chart.font, chart.titleRuns) : ""}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/>${view3D}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${chartTxPr(chart.font)}</c:chartSpace>`
  );
}

/** The parts a sheet's charts need: the drawing that anchors them and the chart parts. `first` is the number the first chart part gets. */
export function sheetChartParts(
  wb: Workbook,
  sheet: Sheet,
  first: number,
  read: (sheet: string, address: string) => { value: Value; text: string },
  /** More anchors for the drawing (slicers), written after the charts'. */
  moreAnchors = "",
  /** More relationships of the drawing (for pictures). */
  moreRels: string[] = [],
): { drawing: string; rels: string; charts: string[]; /** The file name of each chart part, in `xl/charts/` (`chart3.xml`, or `chartEx3.xml` for Excel 2016's kinds). */ partNames: string[] } | null {
  if (!sheet.charts?.length && !moreAnchors) return null;
  const charts = (sheet.charts ?? []).map((c) => (isChartex(c.type) ? chartExPartXml : chartPartXml)(c, sheet.name, readChart(c, sheet, wb.sheets, read)));
  const partNames = (sheet.charts ?? []).map((c, i) => (isChartex(c.type) ? `chartEx${first + i}.xml` : `chart${first + i}.xml`));
  const anchors = (sheet.charts ?? [])
    .map((c, i) => {
      const dx = Math.round((c.from.dx ?? 0) * EMU);
      const dy = Math.round((c.from.dy ?? 0) * EMU);
      if (isChartex(c.type)) return chartExAnchor({ col: c.from.col - 1, row: c.from.row - 1, dx, dy, cx: Math.round(c.width * EMU), cy: Math.round(c.height * EMU) }, i + 2, `rId${i + 1}`, c.alt);
      return (
        `<xdr:oneCellAnchor><xdr:from><xdr:col>${c.from.col - 1}</xdr:col><xdr:colOff>${dx}</xdr:colOff><xdr:row>${c.from.row - 1}</xdr:row><xdr:rowOff>${dy}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${Math.round(c.width * EMU)}" cy="${Math.round(c.height * EMU)}"/>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"${c.alt ? ` descr="${esc(c.alt)}"` : ""}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`
      );
    })
    .join("");
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${anchors}${moreAnchors}</xdr:wsDr>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    (sheet.charts ?? []).map((c, i) => `<Relationship Id="rId${i + 1}" Type="${isChartex(c.type) ? CHARTEX_REL : `${NS_R}/chart`}" Target="../charts/${partNames[i]}"/>`).join("") +
    moreRels.join("") +
    `</Relationships>`;
  return { drawing, rels, charts, partNames };
}

// ================= reading =================

/** The pixel size of a column or row in the sheet, as the grid draws it. */
const colPixels = (sheet: Sheet, col: number): number => {
  const d = sheet.columns?.[letters(col)];
  return d?.hidden ? 0 : d?.size !== undefined ? Math.round(d.size * 7 + 5) : 64;
};
const rowPixels = (sheet: Sheet, row: number): number => {
  const d = sheet.rows?.[String(row)];
  return d?.hidden ? 0 : d?.size !== undefined ? Math.round((d.size * 4) / 3) : 20;
};
const letters = (n: number): string => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const num = (e: XmlElement | undefined): number => Number(textOf(e)) || 0;
/** The number in an element's `val` attribute, or undefined. */
const valNum = (e: XmlElement | undefined): number | undefined => {
  const v = attr(e, "val");
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
};

/** The text of a title: every run, paragraphs joined by a space. */
function titleText(title: XmlElement | undefined): string | undefined {
  const rich = child(child(title, "tx"), "rich");
  if (!rich) return undefined;
  const text = childrenNamed(rich, "p")
    .map((p) => childrenNamed(p, "r").map((r) => textOf(child(r, "t"))).join(""))
    .filter((t) => t !== "")
    .join(" ")
    .trim();
  return text || undefined;
}

const GROUPS: Record<string, ChartType> = {
  barChart: "column", bar3DChart: "column", lineChart: "line", line3DChart: "line", areaChart: "area", area3DChart: "area",
  pieChart: "pie", pie3DChart: "pie", doughnutChart: "doughnut", scatterChart: "scatter", radarChart: "radar", bubbleChart: "bubble",
  stockChart: "stock", surfaceChart: "surface", surface3DChart: "surface", ofPieChart: "pieOfPie",
};
const TREND_READ: Record<string, TrendlineType> = { linear: "linear", exp: "exponential", log: "logarithmic", poly: "polynomial", power: "power", movingAvg: "movingAverage" };

/** A reference as the file writes it (`Sheet1!$B$2:$B$9`), made one of ours, or null when it isn't a plain range. */
function fileRef(f: string | undefined, home: string): string | null {
  if (!f) return null;
  const r = chartRef(f.trim(), home);
  return r ? chartRefText(r.sheet, r.bounds) : null;
}

const refOf = (holder: XmlElement | undefined): string | undefined => textOf(child(child(holder, "numRef") ?? child(holder, "strRef"), "f")) || undefined;
const on = (e: XmlElement | undefined): boolean => e !== undefined && attr(e, "val") !== "0" && attr(e, "val") !== "false";
const colorOf = (holder: XmlElement | undefined) => attr(child(child(holder, "solidFill"), "srgbClr"), "val");

function readTrendlines(ser: XmlElement): Trendline[] {
  return childrenNamed(ser, "trendline").flatMap((t): Trendline[] => {
    const type = TREND_READ[attr(child(t, "trendlineType"), "val") ?? ""];
    if (!type) return [];
    const out: Trendline = { type };
    const number = (name: string) => {
      const v = attr(child(t, name), "val");
      return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined;
    };
    const order = number("order");
    if (type === "polynomial" && order !== undefined) out.order = Math.max(2, Math.min(6, Math.round(order)));
    const period = number("period");
    if (type === "movingAverage" && period !== undefined) out.period = Math.max(2, Math.min(255, Math.round(period)));
    const forward = number("forward");
    if (forward && forward > 0) out.forward = forward;
    const backward = number("backward");
    if (backward && backward > 0) out.backward = backward;
    const intercept = number("intercept");
    if (intercept !== undefined && (type === "linear" || type === "exponential" || type === "polynomial")) out.intercept = intercept;
    const name = textOf(child(t, "name")).trim();
    if (name) out.name = name;
    if (type !== "movingAverage") {
      if (on(child(t, "dispEq"))) out.equation = true;
      if (on(child(t, "dispRSqr"))) out.rSquared = true;
    }
    const color = colorOf(child(child(t, "spPr"), "ln"));
    if (color && /^[0-9a-fA-F]{6}$/.test(color)) out.color = `#${color.toLowerCase()}`;
    const lbl = child(t, "trendlineLbl");
    if (lbl && type !== "movingAverage" && (out.equation || out.rSquared)) {
      const label: NonNullable<Trendline["label"]> = {};
      const manual = child(child(lbl, "layout"), "manualLayout");
      // Only offsets from the label's own place (the default "factor" mode) are kept; a label placed by edge is left where Pli puts it.
      if (manual && attr(child(manual, "xMode"), "val") !== "edge" && attr(child(manual, "yMode"), "val") !== "edge") {
        const x = valNum(child(manual, "x"));
        const y = valNum(child(manual, "y"));
        if (x && Math.abs(x) <= 1) label.x = x;
        if (y && Math.abs(y) <= 1) label.y = y;
      }
      const fmt = child(lbl, "numFmt");
      if (fmt && attr(fmt, "sourceLinked") !== "1" && attr(fmt, "formatCode") && attr(fmt, "formatCode") !== "General") label.format = attr(fmt, "formatCode")!;
      const text = childrenNamed(child(child(lbl, "tx"), "rich"), "p").map((p) => childrenNamed(p, "r").map((r) => textOf(child(r, "t"))).join("")).filter(Boolean).join(" ").trim();
      if (text) label.text = text;
      const font = readTxPrFont(lbl, undefined);
      if (font) label.font = font;
      if (Object.keys(label).length) out.label = label;
    }
    return [out];
  });
}

type ChartSpec = Omit<Chart, "id" | "from" | "width" | "height">;

function readChartPart(root: XmlElement, home: string, warnings: Set<string>): ChartSpec | null {
  const chart = child(root, "chart");
  const plot = child(chart, "plotArea");
  const groups = elements(plot).filter((e) => /Chart$/.test(e.name));
  const known = groups.filter((g) => g.name in GROUPS);
  if (!known.length) {
    warnings.add(`A ${groups[0]?.name.replace(/Chart$/, "") ?? "unknown"} chart is not supported yet and was left out`);
    return null;
  }
  const kindOf = (g: XmlElement): ChartType => {
    const t = GROUPS[g.name]!;
    if (t === "column" && attr(child(g, "barDir"), "val") === "bar") return "bar";
    if (t === "pieOfPie" && attr(child(g, "ofPieType"), "val") === "bar") return "barOfPie";
    return t;
  };
  const COMBINABLE = ["column", "line", "area"];
  const hasStock = known.some((g) => g.name === "stockChart");
  let used: XmlElement[];
  if (hasStock) {
    used = known.filter((g) => g.name === "stockChart" || (g.name === "barChart" && kindOf(g) === "column"));
    if (used.length < known.length) warnings.add("A stock chart keeps only its stock lines and volume columns");
  } else if (known.every((g) => COMBINABLE.includes(kindOf(g)))) used = known;
  else if (known.every((g) => kindOf(g) === "scatter")) used = known;
  else if (known.every((g) => COMBINABLE.includes(kindOf(g)) || kindOf(g) === "scatter")) used = known;
  else {
    const first = kindOf(known[0]!);
    used = first === "bar" ? known.filter((g) => kindOf(g) === "bar") : [known[0]!];
    if (used.length < known.length) warnings.add("A chart that combines kinds Pli can't combine keeps only its first kind");
  }

  // The chart's own kind and piling-up come from the first piled-up group, or else the first one.
  const groupingOf = (g: XmlElement) => {
    const v = attr(child(g, "grouping"), "val");
    return v === "stacked" ? ("stacked" as const) : v === "percentStacked" ? ("percent" as const) : undefined;
  };
  const stackedGroups = used.filter((g) => groupingOf(g) !== undefined);
  const main = hasStock ? used.find((g) => g.name === "stockChart")! : stackedGroups[0] ?? used.find((g) => kindOf(g) !== "scatter") ?? used[0]!;
  const type: ChartType = hasStock ? "stock" : kindOf(main);
  const grouping = groupingOf(main);
  // Series of another kind that pile up keep their grouping (stacked columns with stacked lines).
  const kindGrouping: NonNullable<Chart["kindGrouping"]> = {};
  if (!hasStock) for (const g of stackedGroups) if (g !== main && kindOf(g) !== type && (kindOf(g) === "column" || kindOf(g) === "line" || kindOf(g) === "area")) kindGrouping[kindOf(g) as "column" | "line" | "area"] = groupingOf(g)!;

  const idsOf = (g: XmlElement) => childrenNamed(g, "axId").map((a) => attr(a, "val") ?? "");
  const type0 = kindOf(used[0]!);
  const primaryIds = idsOf(used[0]!);
  // A group is on the second axes when its value axis sits on the far side (right, or top for bars) and crosses at the far end (an axis that only stands there, as Excel writes a chart whose categories run backwards, is not); failing that, when it shares no axis with the first group.
  const isSecondary = (g: XmlElement) => {
    if (hasStock) return false;
    const ids = idsOf(g);
    const val = elements(plot).find((a) => a.name === "valAx" && ids.includes(attr(child(a, "axId"), "val") ?? "") && !(type0 === "scatter" && attr(child(a, "axPos"), "val") === "b"));
    const pos = attr(child(val, "axPos"), "val");
    // (A value axis alone on its side is just where a chart with backwards categories keeps it; a second one needs another pair of axes in the chart.)
    if (val && pos) return (pos === "r" || pos === "t") && attr(child(val, "crosses"), "val") === "max" && elements(plot).some((a) => a.name === "valAx" && !ids.includes(attr(child(a, "axId"), "val") ?? ""));
    return ids.every((id) => !primaryIds.includes(id));
  };

  // Series in the order the file numbers them.
  const all: { ser: XmlElement; group: XmlElement; kind: ChartType; n: number }[] = [];
  let n = 0;
  for (const g of used) for (const ser of childrenNamed(g, "ser")) all.push({ ser, group: g, kind: kindOf(g), n: n++ });
  const orderOf = (e: { ser: XmlElement; n: number }) => {
    const v = attr(child(e.ser, "order"), "val");
    return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : e.n;
  };
  all.sort((a, b) => orderOf(a) - orderOf(b) || a.n - b.n);

  const series: ChartSeries[] = [];
  let categories: string | undefined;
  let labels = false;
  let smooth = false;
  let literal = false;
  let lines = false;
  let noMarkers = false;
  let markerSeen = false;
  const anyLabel = (d: XmlElement | undefined) => ["showVal", "showCatName", "showSerName", "showPercent"].some((k) => on(child(d, k)));
  for (const g of used) if (anyLabel(child(g, "dLbls"))) labels = true;
  const xy = type === "scatter" || type === "bubble";
  let bubble3d = false;
  all.forEach(({ ser, group, kind }, i) => {
    const sxy = xy || kind === "scatter";
    const values = fileRef(refOf(child(ser, sxy ? "yVal" : "val")), home);
    if (!values) {
      literal = true;
      return;
    }
    const s: ChartSeries = { values };
    const tx = child(ser, "tx");
    const nameRef = fileRef(refOf(tx), home);
    if (nameRef) s.nameRef = nameRef;
    else if (textOf(child(tx, "v")).trim()) s.name = textOf(child(tx, "v")).trim();
    const spPr = child(ser, "spPr");
    const color = colorOf(spPr) ?? colorOf(child(spPr, "ln")) ?? colorOf(child(child(ser, "marker"), "spPr"));
    const circular = type === "pie" || type === "doughnut" || type === "pieOfPie" || type === "barOfPie";
    if (color && /^[0-9a-fA-F]{6}$/.test(color) && !circular) s.color = `#${color.toLowerCase()}`;
    else if (!circular) s.color = CHART_COLORS[i % CHART_COLORS.length]!;
    if (sxy) {
      const x = fileRef(refOf(child(ser, "xVal")), home);
      if (x) s.x = x;
      if (type === "bubble") {
        const size = fileRef(refOf(child(ser, "bubbleSize")), home);
        if (size) s.size = size;
      }
      if (type === "scatter" && !child(child(spPr, "ln"), "noFill")) lines = true;
      if (type === "bubble" && on(child(ser, "bubble3D"))) bubble3d = true;
    } else if (!categories) categories = fileRef(refOf(child(ser, "cat")), home) ?? undefined;
    if (anyLabel(child(ser, "dLbls"))) labels = true;
    const sm = child(ser, "smooth");
    if (sm && attr(sm, "val") !== "0") smooth = true;
    const symbol = attr(child(child(ser, "marker"), "symbol"), "val");
    if (symbol !== undefined && (kind === "line" || type === "scatter" || type === "radar")) {
      markerSeen = true;
      if (symbol === "none") noMarkers = true;
    }
    if (COMBINABLE.includes(type) && !hasStock) {
      if (kind !== type && kind !== "bar") s.type = kind as "column" | "line" | "area";
      if (isSecondary(group)) s.axis = "secondary";
    }
    if (type === "scatter" && isSecondary(group)) s.axis = "secondary";
    const eb = readSeriesErrBars(ser, home);
    if (eb) s.errorBars = eb;
    // Colours of single points that differ from what the point would have anyway.
    const colours: Record<string, string> = {};
    for (const dPt of childrenNamed(ser, "dPt")) {
      const idx = attr(child(dPt, "idx"), "val");
      const c = colorOf(child(dPt, "spPr")) ?? colorOf(child(child(dPt, "marker"), "spPr"));
      if (idx === undefined || !/^\d+$/.test(idx) || !c || !/^[0-9a-fA-F]{6}$/.test(c)) continue;
      const dflt = circular ? CHART_COLORS[Number(idx) % CHART_COLORS.length]! : s.color;
      if (c.toLowerCase() !== dflt?.slice(1).toLowerCase()) colours[idx] = `#${c.toLowerCase()}`;
    }
    if (Object.keys(colours).length) s.pointColors = colours;
    if (circular) {
      const own = valNum(child(ser, "explosion"));
      if (own) s.explosion = own;
      const per: Record<string, number> = {};
      for (const dPt of childrenNamed(ser, "dPt")) {
        const idx = attr(child(dPt, "idx"), "val");
        const e = valNum(child(dPt, "explosion"));
        if (idx !== undefined && /^\d+$/.test(idx) && e !== undefined && e !== (own ?? 0)) per[idx] = e;
      }
      if (Object.keys(per).length) s.pointExplosion = per;
    }
    const trends = readTrendlines(ser);
    if (trends.length) {
      for (const t of trends) if (t.color && t.color === s.color) delete t.color;
      s.trendlines = trends;
    }
    series.push(s);
  });
  if (literal) warnings.add("Chart series typed in as numbers rather than taken from cells were left out");
  if (!series.length) {
    warnings.add("A chart with no series that read from cells was left out");
    return null;
  }

  const out: ChartSpec = { type, series: type === "pie" || type === "pieOfPie" || type === "barOfPie" ? series.slice(0, 1) : series };
  /** The view of a 3-D chart: its angles, and the perspective, right angles and depth when they are not the defaults. */
  const readView3d = (baseX: number, baseY: number): NonNullable<Chart["view3d"]> => {
    const v = child(chart, "view3D");
    const angle = (name: string, fallback: number) => {
      const num = Number(attr(child(v, name), "val"));
      return Number.isFinite(num) && attr(child(v, name), "val") !== undefined ? num : fallback;
    };
    const view: NonNullable<Chart["view3d"]> = { rotX: Math.max(0, Math.min(90, Math.abs(angle("rotX", baseX)))), rotY: ((angle("rotY", baseY) % 360) + 360) % 360 };
    if (on(child(v, "rAngAx")) && attr(child(v, "rAngAx"), "val") !== undefined) view.rightAngle = true;
    else {
      // The file keeps twice the angle Excel's pane shows.
      const persp = Number(attr(child(v, "perspective"), "val"));
      if (attr(child(v, "perspective"), "val") !== undefined && Number.isFinite(persp) && persp >= 0 && persp <= 200 && persp / 2 !== DEFAULT_PERSPECTIVE) view.perspective = persp / 2;
    }
    const depth = Number(attr(child(v, "depthPercent"), "val"));
    if (attr(child(v, "depthPercent"), "val") !== undefined && Number.isFinite(depth) && depth >= 20 && depth <= 2000 && depth !== DEFAULT_DEPTH) view.depth = depth;
    return view;
  };
  if (used.some((g) => /3DChart$/.test(g.name) && g.name !== "surface3DChart")) {
    const base = defaultView3d(type);
    out.view3d = readView3d(base.rotX, base.rotY);
  }
  if (type === "surface") {
    out.view3d = main.name === "surfaceChart" ? { rotX: 90, rotY: 0 } : readView3d(15, 20);
    if (on(child(main, "wireframe"))) out.wireframe = true;
  }
  if (Object.keys(kindGrouping).length) out.kindGrouping = kindGrouping;
  if (bubble3d) out.bubble3d = true;
  if (categories) out.categories = categories;
  if (grouping && COMBINABLE.concat("bar").includes(type)) out.grouping = grouping;
  const title = titleText(child(chart, "title"));
  if (title) out.title = title;
  const legend = child(chart, "legend");
  const pos = attr(child(legend, "legendPos"), "val") ?? "r";
  const circular = type === "pie" || type === "doughnut" || type === "pieOfPie" || type === "barOfPie";
  if (!legend) {
    if (circular || series.length > 1) out.legend = "none";
  } else if (pos !== "b") out.legend = pos === "t" ? "top" : pos === "l" ? "left" : "right";
  if (labels) out.labels = true;
  if ((type === "line" || type === "scatter" || COMBINABLE.includes(type)) && (smooth || /smooth/i.test(attr(child(main, "scatterStyle"), "val") ?? ""))) {
    if (type === "line" || type === "scatter" || all.some((a) => a.kind === "line")) out.smooth = true;
  }
  if (type === "scatter" && lines && !out.smooth) out.lines = true;
  if (markerSeen && noMarkers && (type === "line" || type === "scatter" || type === "radar" || COMBINABLE.includes(type))) out.markers = false;
  if (type === "radar" && attr(child(main, "radarStyle"), "val") === "filled") out.filled = true;
  if (type === "pie" || type === "doughnut") {
    const angle = valNum(child(main, "firstSliceAng"));
    if (angle !== undefined && angle > 0 && angle < 360) out.firstSliceAngle = angle;
  }
  if (type === "doughnut") {
    const hole = Number(attr(child(main, "holeSize"), "val"));
    if (Number.isFinite(hole) && hole >= 10 && hole <= 90 && hole !== 50) out.holeSize = hole;
  }
  if (type === "bubble") {
    const scale = Number(attr(child(main, "bubbleScale"), "val"));
    if (Number.isFinite(scale) && scale >= 0 && scale <= 300 && scale !== 100) out.bubbleScale = scale;
  }
  if (type === "pieOfPie" || type === "barOfPie") {
    const kind = attr(child(main, "splitType"), "val");
    const at = Number(attr(child(main, "splitPos"), "val"));
    if (kind === "cust") {
      const points = childrenNamed(child(main, "custSplit"), "secondPiePt").map((p) => Number(attr(p, "val"))).filter((n) => Number.isInteger(n) && n >= 0);
      if (points.length) out.split = { by: "custom", at: 0, points: [...new Set(points)].sort((a, b) => a - b) };
      else warnings.add("A pie-of-pie chart's custom split had no points; the last three points are moved");
    } else if ((kind === "pos" || kind === "val" || kind === "percent") && Number.isFinite(at) && at > 0 && !(kind === "pos" && at === 3)) out.split = { by: kind === "pos" ? "position" : kind === "val" ? "value" : "percent", at };
    const second = Number(attr(child(main, "secondPieSize"), "val"));
    if (Number.isFinite(second) && second >= 5 && second <= 200 && second !== 75) out.secondSize = second;
  }
  if (type === "stock") {
    const volume = used.some((g) => g.name === "barChart");
    const open = used.find((g) => g.name === "stockChart") && childrenNamed(main, "ser").length >= 4;
    out.stock = volume ? (open ? "vohlc" : "vhlc") : open ? "ohlc" : "hlc";
    const sg = used.find((g) => g.name === "stockChart")!;
    const look: NonNullable<Chart["stockLook"]> = {};
    const hl = child(sg, "hiLowLines");
    if (!hl) look.hiLowLines = false;
    else {
      const c = colorOf(child(hl, "spPr")) ?? colorOf(child(child(hl, "spPr"), "ln"));
      if (c && /^[0-9a-fA-F]{6}$/.test(c)) look.hiLowColor = `#${c.toLowerCase()}`;
    }
    const ud = child(sg, "upDownBars");
    if (open && !ud) look.upDownBars = false;
    if (ud) {
      const gap = valNum(child(ud, "gapWidth"));
      if (gap !== undefined && gap >= 0 && gap <= 500 && gap !== 150) look.gapWidth = gap;
      const up = colorOf(child(child(ud, "upBars"), "spPr"));
      const down = colorOf(child(child(ud, "downBars"), "spPr"));
      if (up && /^[0-9a-fA-F]{6}$/.test(up) && up.toUpperCase() !== "FFFFFF") look.upColor = `#${up.toLowerCase()}`;
      if (down && /^[0-9a-fA-F]{6}$/.test(down) && down.toUpperCase() !== "000000") look.downColor = `#${down.toLowerCase()}`;
    }
    if (Object.keys(look).length) out.stockLook = look;
  }
  const txPr = child(child(root, "txPr"), "p");
  const chartFont = readFont(child(child(txPr, "pPr"), "defRPr"));
  if (chartFont && chartFont.size === 10) delete chartFont.size;
  if (!circular && type !== "radar") {
    const axes = elements(plot).filter((e) => /Ax$/.test(e.name));
    const byId = (id: string | undefined) => axes.find((a) => attr(child(a, "axId"), "val") === id);
    const first = idsOf(used[0]!);
    const x = titleText(child(byId(first[0]), "title"));
    const y = titleText(child(byId(first[1]), "title"));
    if (x) out.xTitle = x;
    if (y) out.yTitle = y;
    const seconds = used.filter(isSecondary);
    let secondEls: [XmlElement | undefined, XmlElement | undefined] = [undefined, undefined];
    if (seconds.length) {
      const ids = idsOf(seconds[0]!);
      const x2 = titleText(child(byId(ids[0]), "title"));
      const y2 = titleText(child(byId(ids[1]), "title"));
      if (x2) out.x2Title = x2;
      if (y2) out.y2Title = y2;
      const catAxis = byId(ids[0]);
      secondEls = [catAxis, byId(ids[1])];
      if (type !== "scatter" && catAxis && attr(child(catAxis, "delete"), "val") === "0") out.secondaryCategoryAxis = true;
    } else if (hasStock && used.some((g) => g.name === "barChart")) {
      const stockIds = idsOf(used.find((g) => g.name === "stockChart")!);
      const y2 = titleText(child(byId(stockIds[1]), "title"));
      if (y2) out.y2Title = y2;
      secondEls = [byId(stockIds[0]), byId(stockIds[1])];
    }
    readAxes(out, type, byId(first[0]), byId(first[1]), secondEls[0], secondEls[1], chartFont);
  }
  if (chartFont) {
    if (Object.keys(chartFont).length) out.font = chartFont;
  }
  const titleRun = child(child(child(child(child(chart, "title"), "tx"), "rich"), "p"), "r");
  const titleFont = readFont(child(titleRun, "rPr"));
  if (titleFont) {
    if (titleFont.size === 14) delete titleFont.size;
    if (titleFont.bold === true) delete titleFont.bold;
    for (const k of Object.keys(titleFont) as (keyof typeof titleFont)[]) if (chartFont && chartFont[k] === titleFont[k] && k !== "bold") delete titleFont[k];
    if (!titleFont.bold && child(titleRun, "rPr") && attr(child(titleRun, "rPr"), "b") === "0" && !chartFont?.bold) titleFont.bold = false;
    if (Object.keys(titleFont).length) out.titleFont = titleFont;
  }
  // A title in pieces with looks of their own.
  const runEls = childrenNamed(child(child(child(child(chart, "title"), "tx"), "rich"), "p"), "r");
  if (runEls.length > 1) {
    const runs: NonNullable<Chart["titleRuns"]> = runEls.map((r) => {
      const rPr = child(r, "rPr");
      const look = readFont(rPr) ?? {};
      if (look.size === 14) delete look.size;
      if (look.bold === true) delete look.bold;
      else if (attr(rPr, "b") === "0") look.bold = false;
      for (const k of Object.keys(look) as (keyof typeof look)[]) if (chartFont && chartFont[k] === look[k] && k !== "bold") delete look[k];
      return { text: textOf(child(r, "t")), ...(attr(rPr, "u") && attr(rPr, "u") !== "none" ? { underline: true as const } : {}), ...look };
    });
    if (runs.some((r) => JSON.stringify({ ...r, text: "" }) !== JSON.stringify({ ...runs[0], text: "" }))) {
      out.titleRuns = runs;
      delete out.titleFont;
    }
  }
  // The data labels: which parts they show and where they sit.
  if (labels) {
    const holder = used.flatMap((g) => [...childrenNamed(g, "ser").map((sr) => child(sr, "dLbls")), child(g, "dLbls")]).find((d) => d && anyLabel(d));
    const lab = readDLbls(holder, circular);
    if (lab.show) out.labelShow = lab.show;
    if (lab.pos) out.labelPosition = lab.pos;
    const lf = readTxPrFont(holder, chartFont);
    if (lf) out.labelFont = lf;
  }
  const legendFont = readTxPrFont(legend, chartFont);
  if (legendFont) out.legendFont = legendFont;
  return out;
}

/** Reads the settings of the axes of a chart into `out.axes`. `x`/`y` are the first axes, `x2`/`y2` the second ones. */
function readAxes(out: ChartSpec, type: ChartType, xEl: XmlElement | undefined, yEl: XmlElement | undefined, x2El: XmlElement | undefined, y2El: XmlElement | undefined, chartFont?: ChartFont): void {
  const horizontal = type === "bar";
  const valueX = type === "scatter" || type === "bubble";
  const axes: NonNullable<Chart["axes"]> = {};
  const crossOn = (crossEl: XmlElement | undefined, onCategory: boolean, bar: boolean, flipped: boolean): "min" | "max" | number | undefined => {
    const c = readCrossing(crossEl);
    if (bar) {
      // A bar chart keeps its value axis at the bottom unless it says otherwise.
      const bottom = flipped ? c === "max" : c === undefined || c === "min";
      return bottom ? undefined : c ?? "min";
    }
    if (onCategory && c === "min") return undefined;
    return c;
  };
  const one = (key: "x" | "y" | "x2" | "y2", el: XmlElement | undefined, crossEl: XmlElement | undefined) => {
    if (!el) return;
    const catAxis = key === "x" || key === "x2" ? !valueX : false;
    const flip = catAxis && horizontal;
    const a = readAxis(type, key, el, flip);
    const flipped = attr(child(child(el, "scaling"), "orientation"), "val") === "maxMin";
    const cr = key === "x" || key === "y" ? crossOn(crossEl, catAxis, catAxis && horizontal, flipped) : undefined;
    if (cr !== undefined) a.crosses = cr;
    // The font of the labels, and of the title (or its pieces).
    const labelFont = readTxPrFont(el, chartFont);
    if (labelFont) a.font = labelFont;
    const ts = readTitleStyle(child(el, "title"), chartFont, { size: 10, bold: false });
    if (ts.font) a.titleFont = ts.font;
    if (ts.runs) a.titleRuns = ts.runs;
    if (Object.keys(a).length) axes[key] = a;
  };
  one("x", xEl, yEl);
  one("y", yEl, xEl);
  one("x2", x2El, y2El);
  one("y2", y2El, x2El);
  // A hidden second category axis is how a combined chart is written without one; it isn't a setting.
  if (axes.x2?.hidden && !out.secondaryCategoryAxis) {
    delete axes.x2.hidden;
    if (!Object.keys(axes.x2).length) delete axes.x2;
  }
  if (Object.keys(axes).length) out.axes = axes;
}

/** Joins a part's own path and a relationship target to a path in the file. */
export function resolve(part: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = part.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") dir.pop();
    else if (piece !== ".") dir.push(piece);
  }
  return dir.join("/");
}

const OTHER_DRAWINGS = "Shapes and text boxes in a drawing are not supported yet and were left out";

export const relsPathOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");

/**
 * The charts a worksheet's drawing holds. `xml` reads a part of the file (undefined when it isn't there).
 * Pictures are read apart (`readSheetImages`); shapes and text boxes are not read, and the warning says so.
 */
export function readSheetCharts(sheetPath: string, drawingId: string, sheet: Sheet, xml: (path: string) => XmlElement | undefined, warnings: Set<string>, hiddenNames?: ReadonlyMap<string, string>): Chart[] {
  const sheetRels = xml(relsPathOf(sheetPath));
  const drawingTarget = childrenNamed(sheetRels, "Relationship").find((r) => r.attrs["Id"] === drawingId)?.attrs["Target"];
  const drawingPath = drawingTarget ? resolve(sheetPath, drawingTarget) : "";
  const drawing = drawingTarget ? xml(drawingPath) : undefined;
  if (!drawing) {
    warnings.add(OTHER_DRAWINGS);
    return [];
  }
  const drawingRels = xml(relsPathOf(drawingPath));
  const out: Chart[] = [];
  let other = false;
  for (const anchor of elements(drawing)) {
    // A slicer is held in an alternate-content wrapper; those are read apart from the charts.
    if (slicerNameIn(anchor) !== undefined || hasTimeline(anchor)) continue;
    if (child(anchor, "pic")) continue;
    // Excel 2016's kinds are held in alternate content, the whole anchor inside the choice.
    // (Excel puts the alternate content inside the anchor, round the frame, and so did Pli once.)
    const holder = anchor.name === "AlternateContent" ? elements(child(anchor, "Choice") ?? anchor)[0] ?? anchor : anchor;
    const frame = child(holder, "graphicFrame") ?? childrenNamed(holder, "AlternateContent").flatMap((w) => childrenNamed(w, "Choice")).map((c) => child(c, "graphicFrame")).find(Boolean);
    const chartId = attr(child(child(child(frame, "graphic"), "graphicData"), "chart"), "id", "r");
    if (!frame || !chartId) {
      if (elements(anchor).some((e) => e.name !== "clientData")) other = true;
      continue;
    }
    const target = childrenNamed(drawingRels, "Relationship").find((r) => r.attrs["Id"] === chartId)?.attrs["Target"];
    const part = target ? xml(resolve(drawingPath, target)) : undefined;
    if (!part) continue;
    const spec = isChartExPart(part) ? readChartExPart(part, sheet.name, warnings, hiddenNames) : readChartPart(part, sheet.name, warnings);
    if (!spec) continue;

    const { col, row, dx, dy, width, height } = anchorBox(holder, sheet);
    const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? Math.max(MIN_CHART_SIZE, Math.min(MAX_CHART_SIZE, Math.round(n))) : fallback);
    const alt = attr(child(child(frame, "nvGraphicFramePr"), "cNvPr"), "descr")?.trim();
    out.push({
      id: createId("chart_"),
      ...spec,
      ...(alt ? { alt } : {}),
      from: { row: Math.max(1, row), col: Math.max(1, col), ...(dx > 0.5 ? { dx: Math.round(dx) } : {}), ...(dy > 0.5 ? { dy: Math.round(dy) } : {}) },
      width: clamp(width, 480),
      height: clamp(height, 288),
    });
  }
  if (other) warnings.add(OTHER_DRAWINGS);
  return out;
}

/** The cell a drawing anchor starts in, how far into it, and how big the thing anchored is, in pixels. */
export function anchorBox(anchor: XmlElement, sheet: Sheet): { col: number; row: number; dx: number; dy: number; width: number; height: number } {
  const xAt = (col: number, off: number) => {
    let x = 0;
    for (let c = 1; c <= col; c++) x += colPixels(sheet, c);
    return x + off / EMU;
  };
  const yAt = (row: number, off: number) => {
    let y = 0;
    for (let r = 1; r <= row; r++) y += rowPixels(sheet, r);
    return y + off / EMU;
  };
  const from = child(anchor, "from");
  let col = 1;
  let row = 1;
  let dx = 0;
  let dy = 0;
  let width = 480;
  let height = 288;
  if (from) {
    const c0 = num(child(from, "col"));
    const r0 = num(child(from, "row"));
    col = c0 + 1;
    row = r0 + 1;
    dx = num(child(from, "colOff")) / EMU;
    dy = num(child(from, "rowOff")) / EMU;
    const ext = child(anchor, "ext");
    const to = child(anchor, "to");
    if (anchor.name === "oneCellAnchor" && ext) {
      width = Number(ext.attrs["cx"] ?? 0) / EMU;
      height = Number(ext.attrs["cy"] ?? 0) / EMU;
    } else if (to) {
      // Something held by two cells is as big as the cells between them.
      width = xAt(num(child(to, "col")), num(child(to, "colOff"))) - xAt(c0, num(child(from, "colOff")));
      height = yAt(num(child(to, "row")), num(child(to, "rowOff"))) - yAt(r0, num(child(from, "rowOff")));
    }
  } else if (anchor.name === "absoluteAnchor") {
    const pos = child(anchor, "pos");
    const ext = child(anchor, "ext");
    dx = Number(pos?.attrs["x"] ?? 0) / EMU;
    dy = Number(pos?.attrs["y"] ?? 0) / EMU;
    width = Number(ext?.attrs["cx"] ?? 0) / EMU;
    height = Number(ext?.attrs["cy"] ?? 0) / EMU;
  }
  return { col, row, dx, dy, width, height };
}

/**
 * The slicer a drawing's top-level element holds, if it holds one. Pli wraps the whole anchor in alternate content;
 * Excel puts the alternate content inside the anchor, around the slicer's frame.
 */
function slicerChoices(el: XmlElement): { anchor: XmlElement; slicer: XmlElement; frameOwner: XmlElement }[] {
  const wrappers = el.name === "AlternateContent" ? [el] : childrenNamed(el, "AlternateContent");
  const out: { anchor: XmlElement; slicer: XmlElement; frameOwner: XmlElement }[] = [];
  for (const wrapper of wrappers) {
    for (const choice of childrenNamed(wrapper, "Choice")) {
      // Pli's form: the choice holds the whole anchor. Excel's: the choice holds the frame, and the anchor is the element round the wrapper.
      const inner = el.name === "AlternateContent" ? elements(choice) : [choice];
      for (const owner of inner) {
        const frame = el.name === "AlternateContent" ? child(owner, "graphicFrame") : child(choice, "graphicFrame");
        const slicer = child(child(child(frame, "graphic"), "graphicData"), "slicer");
        if (slicer) out.push({ anchor: el.name === "AlternateContent" ? owner : el, slicer, frameOwner: owner });
      }
    }
  }
  return out;
}

/** Whether a top-level element of a drawing holds a timeline (read apart, with the pivot tables). */
export function hasTimeline(el: XmlElement): boolean {
  return /"name":"timeslicer"/.test(JSON.stringify(el));
}

/** The name of the slicer a top-level element of a drawing holds, if it holds one. */
export function slicerNameIn(wrapper: XmlElement): string | undefined {
  const found = slicerChoices(wrapper)[0];
  return found ? attr(found.slicer, "name") : undefined;
}

/** The anchor (where the slicer is) of a top-level element of a drawing that holds a slicer. */
export function slicerAnchor(wrapper: XmlElement): XmlElement | undefined {
  return slicerChoices(wrapper)[0]?.anchor;
}
