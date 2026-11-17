import { defaultSeriesColor } from "../chartscene";
import type { ChartAxis, ChartElement, ChartSeries, Color } from "../model";
import { fontXml, solidFill, tag, type Env } from "./emit";
import { CT, OpcPackage, Part, REL, XML_DECL, xmlEscape } from "./opc";

/**
 * DrawingML charts: the `c:chartSpace` part PowerPoint reads for a chart, and the small workbook that holds the data
 * so that "Edit Data" works. Element order follows ECMA-376 Part 1 (chapter 21.2), which PowerPoint insists on.
 */

export const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const CHART_URI = NS_C;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET = "Sheet1";

const el = (name: string, v: string | number | boolean): string => `<c:${name} val="${typeof v === "boolean" ? (v ? 1 : 0) : xmlEscape(String(v))}"/>`;
const num = (n: number): string => String(Number.isFinite(n) ? n : 0);

/** `A`, `B`... `Z`, `AA`: the spreadsheet column name of a 1-based index. */
export function colName(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

// ---- Where the data sits in the workbook -------------------------------------------------------------------------

interface SeriesRef {
  name: string;
  /** Category (or X) reference and the values reference, as `Sheet1!$B$2:$B$4`. */
  cat?: string;
  val: string;
  /** Scatter: where X values are. */
  x?: string;
}

interface Layout {
  refs: SeriesRef[];
  /** Cell text and numbers by `[row, col]` (1-based). */
  cells: Map<string, string | number>;
  rows: number;
  cols: number;
}

const abs = (col: number, r1: number, r2?: number): string => `${SHEET}!$${colName(col)}$${r1}${r2 !== undefined ? `:$${colName(col)}$${r2}` : ""}`;

function layoutOf(chart: ChartElement): Layout {
  const cells = new Map<string, string | number>();
  const put = (r: number, c: number, v: string | number) => cells.set(`${r},${c}`, v);
  const refs: SeriesRef[] = [];
  let rows = 1;
  let cols = 1;
  if (chart.chartType === "scatter") {
    chart.series.forEach((s, i) => {
      const xc = 2 * i + 1;
      const yc = 2 * i + 2;
      put(1, xc, "X");
      put(1, yc, s.name);
      s.values.forEach((v, k) => {
        put(k + 2, xc, s.x?.[k] ?? k + 1);
        if (v !== null) put(k + 2, yc, v);
      });
      const n = s.values.length;
      rows = Math.max(rows, n + 1);
      cols = Math.max(cols, yc);
      refs.push({ name: abs(yc, 1), x: abs(xc, 2, n + 1), val: abs(yc, 2, n + 1) });
    });
    return { refs, cells, rows, cols };
  }
  const n = Math.max(chart.categories.length, ...chart.series.map((s) => s.values.length), 0);
  chart.categories.forEach((c, k) => put(k + 2, 1, c));
  chart.series.forEach((s, i) => {
    const col = i + 2;
    put(1, col, s.name);
    s.values.forEach((v, k) => {
      if (v !== null) put(k + 2, col, v);
    });
    refs.push({ name: abs(col, 1), cat: abs(1, 2, Math.max(2, n + 1)), val: abs(col, 2, Math.max(2, n + 1)) });
  });
  rows = Math.max(1, n + 1);
  cols = chart.series.length + 1;
  return { refs, cells, rows, cols };
}

// ---- The embedded workbook ---------------------------------------------------------------------------------------

/** A minimal, valid .xlsx holding the chart's data in `Sheet1`, so PowerPoint's "Edit Data" has something to open. */
export function chartWorkbook(chart: ChartElement, date: Date): Uint8Array {
  const { cells, rows, cols } = layoutOf(chart);
  const pkg = new OpcPackage();
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const wb = pkg.add(new Part("xl/workbook.xml", CT.workbook));
  pkg.relate(REL.officeDocument, wb.name);
  const sheet = pkg.add(new Part("xl/worksheets/sheet1.xml", CT.worksheet));
  const styles = pkg.add(new Part("xl/styles.xml", CT.sheetStyles));
  const sheetId = wb.relate(REL.worksheet, sheet.name);
  wb.relate(REL.styles, styles.name);
  wb.data = `${XML_DECL}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets><sheet name="${SHEET}" sheetId="1" r:id="${sheetId}"/></sheets></workbook>`;
  styles.data =
    `${XML_DECL}<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  let body = "";
  for (let r = 1; r <= rows; r++) {
    let row = "";
    for (let c = 1; c <= cols; c++) {
      const v = cells.get(`${r},${c}`);
      if (v === undefined) continue;
      const ref = `${colName(c)}${r}`;
      row += typeof v === "number" ? `<c r="${ref}"><v>${num(v)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    }
    if (row) body += `<row r="${r}">${row}</row>`;
  }
  sheet.data = `${XML_DECL}<worksheet xmlns="${NS}"><dimension ref="A1:${colName(cols)}${rows}"/><sheetData>${body}</sheetData></worksheet>`;
  return pkg.write({ date });
}

// ---- Text and shapes ---------------------------------------------------------------------------------------------

const DEFAULT_TEXT: Color = { theme: "dk1", lumMod: 0.75, lumOff: 0.25 };
const GRID: Color = { theme: "dk1", alpha: 0.14 };
const AXIS_LINE: Color = { theme: "dk1", alpha: 0.4 };

const noLine = tag("a:ln", {}, tag("a:noFill"));
const hair = (c: Color, w = 9525) => tag("a:ln", { w, cap: "flat" }, solidFill(c) + tag("a:round"));

function rich(text: string, size: number, rot?: number, bold = false): string {
  const paras = text
    .split(/\r?\n/)
    .map((line) => `<a:p><a:pPr><a:defRPr sz="${Math.round(size * 100)}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${Math.round(size * 100)}" b="${bold ? 1 : 0}"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
    .join("");
  return `<c:rich>${rot !== undefined ? `<a:bodyPr rot="${rot}" vert="horz"/>` : "<a:bodyPr/>"}<a:lstStyle/>${paras}</c:rich>`;
}

const titleXml = (text: string, size: number, rot?: number, bold = false): string => `<c:title><c:tx>${rich(text, size, rot, bold)}</c:tx>${el("overlay", false)}</c:title>`;

function txPr(size: number, color: Color | undefined, family?: string): string {
  const def = tag("a:defRPr", { sz: Math.round(size * 100) }, (color ? solidFill(color) : "") + (family ? fontXml("a:latin", family) : ""));
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${def}</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
}

// ---- Series ------------------------------------------------------------------------------------------------------

type Kind = "column" | "line" | "area";

const strCache = (items: string[]): string => `<c:strCache>${el("ptCount", items.length)}${items.map((t, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(t)}</c:v></c:pt>`).join("")}</c:strCache>`;
const numCache = (items: (number | null)[], fmt = "General"): string =>
  `<c:numCache><c:formatCode>${xmlEscape(fmt)}</c:formatCode>${el("ptCount", items.length)}${items.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`)).join("")}</c:numCache>`;

function serXml(chart: ChartElement, s: ChartSeries, i: number, kind: Kind | "pie" | "scatter", ref: SeriesRef): string {
  const color = s.color ?? defaultSeriesColor(i);
  const cats = chart.categories.length ? chart.categories : s.values.map((_, k) => String(k + 1));
  let out = el("idx", i) + el("order", i);
  out += `<c:tx><c:strRef><c:f>${ref.name}</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
  const smooth = s.smooth ?? chart.smooth ?? false;
  const marker = s.marker ?? chart.markers ?? (kind === "scatter");
  const lineW = Math.round((s.lineWidth ?? 2.25) * 12700);
  const markerXml = (): string =>
    marker
      ? `<c:marker>${el("symbol", "circle")}${el("size", 7)}<c:spPr>${solidFill(color)}${hair({ theme: "lt1" }, 9525)}</c:spPr></c:marker>`
      : `<c:marker>${el("symbol", "none")}</c:marker>`;
  if (kind === "column") {
    out += `<c:spPr>${solidFill(color)}${noLine}</c:spPr>` + el("invertIfNegative", false);
  } else if (kind === "area") {
    out += `<c:spPr>${solidFill(color)}${noLine}</c:spPr>`;
  } else if (kind === "line") {
    out += `<c:spPr>${tag("a:ln", { w: lineW, cap: "rnd" }, solidFill(color) + tag("a:round"))}</c:spPr>` + markerXml();
  } else if (kind === "scatter") {
    out += `<c:spPr>${s.line ? tag("a:ln", { w: lineW, cap: "rnd" }, solidFill(color) + tag("a:round")) : tag("a:ln", { w: 19050, cap: "rnd" }, tag("a:noFill"))}</c:spPr>` + markerXml();
  } else {
    // pie: a colour for each slice
    out += cats.map((_, k) => `<c:dPt>${el("idx", k)}${el("bubble3D", false)}<c:spPr>${solidFill(s.pointColors?.[k] ?? defaultSeriesColor(k))}${hair({ theme: "lt1" }, 19050)}</c:spPr></c:dPt>`).join("");
  }
  if (kind === "scatter") {
    out += `<c:xVal><c:numRef><c:f>${ref.x}</c:f>${numCache(s.values.map((_, k) => s.x?.[k] ?? k + 1))}</c:numRef></c:xVal>`;
    out += `<c:yVal><c:numRef><c:f>${ref.val}</c:f>${numCache(s.values)}</c:numRef></c:yVal>`;
    out += el("smooth", smooth);
  } else {
    out += `<c:cat><c:strRef><c:f>${ref.cat}</c:f>${strCache(cats)}</c:strRef></c:cat>`;
    out += `<c:val><c:numRef><c:f>${ref.val}</c:f>${numCache(s.values)}</c:numRef></c:val>`;
    if (kind === "line") out += el("smooth", smooth);
  }
  return `<c:ser>${out}</c:ser>`;
}

function dLblsXml(chart: ChartElement, kind: Kind | "pie" | "doughnut" | "scatter"): string {
  const d = chart.dataLabels;
  if (!d) return "";
  const stacked = (chart.grouping ?? "clustered") !== "clustered";
  let pos: string | undefined;
  if (kind === "column") pos = d.position === "center" ? "ctr" : d.position === "inside" ? "inEnd" : d.position === "outside" && !stacked ? "outEnd" : undefined;
  else if (kind === "line" || kind === "scatter") pos = d.position === "center" ? "ctr" : "t";
  else if (kind === "pie") pos = d.position === "center" ? "ctr" : d.position === "inside" ? "inEnd" : d.position === "outside" ? "outEnd" : undefined;
  const fmt = d.format ? `<c:numFmt formatCode="${xmlEscape(d.format)}" sourceLinked="0"/>` : "";
  return (
    `<c:dLbls>${fmt}<c:spPr>${tag("a:noFill")}${noLine}</c:spPr>${pos ? el("dLblPos", pos) : ""}` +
    el("showLegendKey", false) + el("showVal", !!d.value) + el("showCatName", !!d.category) + el("showSerName", !!d.series) + el("showPercent", !!d.percent) + el("showBubbleSize", false) +
    `</c:dLbls>`
  );
}

// ---- Axes --------------------------------------------------------------------------------------------------------

function axisXml(kind: "cat" | "val", id: number, cross: number, pos: "b" | "l" | "t" | "r", a: ChartAxis, chart: ChartElement, o: { grid: boolean; between: "between" | "midCat"; vertical: boolean; format?: string }): string {
  const size = chart.textSize ?? 12;
  const scaling = `<c:scaling>${el("orientation", "minMax")}${a.max !== undefined ? el("max", a.max) : ""}${a.min !== undefined ? el("min", a.min) : ""}</c:scaling>`;
  const line = a.line === null ? noLine : hair(a.line ?? AXIS_LINE);
  const fmt = o.format ?? a.format;
  let out = el("axId", id) + scaling + el("delete", !!a.hidden) + el("axPos", pos);
  if (o.grid) out += `<c:majorGridlines><c:spPr>${hair(a.gridColor ?? GRID)}</c:spPr></c:majorGridlines>`;
  if (a.title) out += titleXml(a.title, size, o.vertical ? -5400000 : undefined);
  out += `<c:numFmt formatCode="${xmlEscape(fmt ?? "General")}" sourceLinked="${fmt ? 0 : 1}"/>`;
  out += el("majorTickMark", "none") + el("minorTickMark", "none") + el("tickLblPos", "nextTo");
  out += `<c:spPr>${tag("a:noFill")}${line}</c:spPr>`;
  out += el("crossAx", cross) + el("crosses", "autoZero");
  if (kind === "cat") out += el("auto", true) + el("lblAlgn", "ctr") + el("lblOffset", 100) + el("noMultiLvlLbl", false);
  else out += el("crossBetween", o.between) + (a.majorUnit ? el("majorUnit", a.majorUnit) : "");
  return `<c:${kind === "cat" ? "catAx" : "valAx"}>${out}</c:${kind === "cat" ? "catAx" : "valAx"}>`;
}

// ---- The chart part ----------------------------------------------------------------------------------------------

/** Where the chart's workbook is related from the chart part (`rId1`). */
export const CHART_WORKBOOK_RID = "rId1";

export function chartXml(chart: ChartElement, withWorkbook: boolean, axisBase: number): string {
  const layout = layoutOf(chart);
  const size = chart.textSize ?? 12;
  const kinds: Kind[] = chart.series.map((s) => s.type ?? (chart.chartType === "line" ? "line" : chart.chartType === "area" ? "area" : "column"));
  const grouping = chart.grouping ?? "clustered";
  const baseKind: Kind = chart.chartType === "line" ? "line" : chart.chartType === "area" ? "area" : "column";
  const catId = axisBase + 1;
  const valId = axisBase + 2;
  const pie = chart.chartType === "pie" || chart.chartType === "doughnut";
  const scatter = chart.chartType === "scatter";
  let plot = "<c:layout/>";

  if (pie) {
    const s = chart.series[0];
    const body = (s ? serXml(chart, s, 0, "pie", layout.refs[0]!) : "") + dLblsXml(chart, chart.chartType === "pie" ? "pie" : "doughnut");
    plot += chart.chartType === "pie"
      ? `<c:pieChart>${el("varyColors", true)}${body}${el("firstSliceAng", Math.round(((chart.firstSliceAngle ?? 0) % 360 + 360) % 360))}</c:pieChart>`
      : `<c:doughnutChart>${el("varyColors", true)}${body}${el("firstSliceAng", Math.round(((chart.firstSliceAngle ?? 0) % 360 + 360) % 360))}${el("holeSize", Math.round(Math.min(90, Math.max(10, chart.holeSize ?? 60))))}</c:doughnutChart>`;
  } else if (scatter) {
    plot += `<c:scatterChart>${el("scatterStyle", "lineMarker")}${el("varyColors", false)}${chart.series.map((s, i) => serXml(chart, s, i, "scatter", layout.refs[i]!)).join("")}${dLblsXml(chart, "scatter")}${el("axId", catId)}${el("axId", valId)}</c:scatterChart>`;
  } else {
    const group = (kind: Kind): string => {
      const idx = chart.series.map((_, i) => i).filter((i) => kinds[i] === kind);
      if (idx.length === 0) return "";
      const own = kind === baseKind;
      const g = own ? grouping : "clustered";
      const ooxmlGrouping = kind === "column" ? g : g === "clustered" ? "standard" : g;
      const sers = idx.map((i) => serXml(chart, chart.series[i]!, i, kind, layout.refs[i]!)).join("");
      const axes = el("axId", catId) + el("axId", valId);
      const dl = dLblsXml(chart, kind);
      if (kind === "column") {
        const stacked = g !== "clustered";
        const overlap = own ? (chart.overlap ?? (stacked ? 100 : undefined)) : undefined;
        return `<c:barChart>${el("barDir", chart.chartType === "bar" ? "bar" : "col")}${el("grouping", ooxmlGrouping)}${el("varyColors", false)}${sers}${dl}${el("gapWidth", Math.round(Math.min(500, Math.max(0, chart.gapWidth ?? 150))))}${overlap !== undefined ? el("overlap", Math.round(Math.min(100, Math.max(-100, overlap)))) : ""}${axes}</c:barChart>`;
      }
      if (kind === "line") return `<c:lineChart>${el("grouping", ooxmlGrouping)}${el("varyColors", false)}${sers}${dl}${el("marker", true)}${axes}</c:lineChart>`;
      return `<c:areaChart>${el("grouping", ooxmlGrouping)}${el("varyColors", false)}${sers}${dl}${axes}</c:areaChart>`;
    };
    plot += group("area") + group("column") + group("line");
  }

  if (!pie) {
    const horizontal = chart.chartType === "bar";
    const percent = grouping === "percentStacked";
    const cAxis = chart.categoryAxis ?? {};
    const vAxis = chart.valueAxis ?? {};
    if (scatter) {
      plot += axisXml("val", catId, valId, "b", cAxis, chart, { grid: !!cAxis.gridlines, between: "midCat", vertical: false });
      plot += axisXml("val", valId, catId, "l", vAxis, chart, { grid: vAxis.gridlines ?? true, between: "midCat", vertical: true });
    } else {
      const midCat = chart.chartType === "area" && kinds.every((k) => k === "area");
      plot += axisXml("cat", catId, valId, horizontal ? "l" : "b", cAxis, chart, { grid: !!cAxis.gridlines, between: "between", vertical: horizontal });
      plot += axisXml("val", valId, catId, horizontal ? "b" : "l", vAxis, chart, { grid: vAxis.gridlines ?? true, between: midCat ? "midCat" : "between", vertical: !horizontal, format: percent && !vAxis.format ? "0%" : undefined });
    }
  }
  plot += `<c:spPr>${chart.plotFill !== undefined && chart.plotFill !== null ? solidFill(chart.plotFill) : tag("a:noFill")}${noLine}</c:spPr>`;

  const title = chart.title && chart.title.trim() !== "" ? titleXml(chart.title, chart.titleSize ?? Math.round(size * 1.2 * 10) / 10) : "";
  const legendPos = chart.legend ?? (pie || chart.series.length > 1 ? "bottom" : "none");
  const legend = legendPos === "none" ? "" : `<c:legend>${el("legendPos", { top: "t", bottom: "b", left: "l", right: "r" }[legendPos])}${el("overlay", false)}</c:legend>`;
  const area = `<c:spPr>${chart.fill !== undefined && chart.fill !== null ? solidFill(chart.fill) : tag("a:noFill")}${noLine}</c:spPr>`;
  return (
    `${XML_DECL}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    el("date1904", false) +
    el("roundedCorners", false) +
    `<c:chart>${title}${el("autoTitleDeleted", title === "")}<c:plotArea>${plot}</c:plotArea>${legend}${el("plotVisOnly", true)}${el("dispBlanksAs", "gap")}</c:chart>` +
    area +
    txPr(size, chart.textColor ?? DEFAULT_TEXT, chart.fontFamily) +
    (withWorkbook ? `<c:externalData r:id="${CHART_WORKBOOK_RID}">${el("autoUpdate", false)}</c:externalData>` : "") +
    `</c:chartSpace>`
  );
}

/** Adds the chart's parts to the package (through `addPart`) and returns the relationship id the slide uses to refer to it. */
export function addChartParts(chart: ChartElement, env: Env, addPart: (p: Part) => void): string {
  const n = ++env.ctx.nextChart;
  const part = new Part(`ppt/charts/chart${n}.xml`, CT.chart);
  const book = new Part(`ppt/embeddings/Microsoft_Excel_Sheet${n}.xlsx`, undefined, chartWorkbook(chart, env.ctx.date));
  part.relate(REL.package, book.name);
  part.data = chartXml(chart, true, 100000000 + n * 10);
  addPart(part);
  addPart(book);
  return env.part.relate(REL.chart, part.name);
}
