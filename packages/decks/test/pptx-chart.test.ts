import { strFromU8, unzipSync } from "fflate";
import { parseXml, type XmlElement } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, defaultSeriesColor, fromPptx, parseDeck, resolveSlide, serializeDeck, toPdf, toPptx, validateDeck, type ChartElement, type ChartType, type Deck, type ShapeElement } from "../src";
import { chartXml } from "../src/pptx/chartxml";
import { cAxes, cNumRef, cSer, cStrRef, chartDoc, chartFrame, deckWithCharts, simpleDeck, solid, srgb } from "./fixtures/build-pptx";

// ---- Element order of the chart schema (ECMA-376 21.2) -------------------------------------------------------------

type Rank = string | string[];
const AX = ["axId", "scaling", "delete", "axPos", "majorGridlines", "minorGridlines", "title", "numFmt", "majorTickMark", "minorTickMark", "tickLblPos", "spPr", "txPr", "crossAx", ["crosses", "crossesAt"]];
const SER_FIELDS: Rank[] = ["idx", "order", "tx", "spPr", "invertIfNegative", "pictureOptions", "marker", "explosion", "dPt", "dLbls", "trendline", "errBars", ["cat", "xVal"], ["val", "yVal"], "shape", "smooth", "extLst"];
const CHART_ORDER: Record<string, Rank[]> = {
  chartSpace: ["date1904", "lang", "roundedCorners", "AlternateContent", "style", "clrMapOvr", "pivotSource", "protection", "chart", "spPr", "txPr", "externalData", "printSettings", "userShapes", "extLst"],
  chart: ["title", "autoTitleDeleted", "pivotFmts", "view3D", "floor", "sideWall", "backWall", "plotArea", "legend", "plotVisOnly", "dispBlanksAs", "showDLblsOverMax", "extLst"],
  title: ["tx", "layout", "overlay", "spPr", "txPr", "extLst"],
  plotArea: ["layout", ["areaChart", "area3DChart", "lineChart", "line3DChart", "stockChart", "radarChart", "scatterChart", "pieChart", "pie3DChart", "doughnutChart", "barChart", "bar3DChart", "ofPieChart", "surfaceChart", "surface3DChart", "bubbleChart"], ["valAx", "catAx", "dateAx", "serAx"], "dTable", "spPr", "extLst"],
  barChart: ["barDir", "grouping", "varyColors", "ser", "dLbls", "gapWidth", "overlap", "serLines", "axId", "extLst"],
  lineChart: ["grouping", "varyColors", "ser", "dLbls", "dropLines", "hiLowLines", "upDownBars", "marker", "smooth", "axId", "extLst"],
  areaChart: ["grouping", "varyColors", "ser", "dLbls", "dropLines", "axId", "extLst"],
  pieChart: ["varyColors", "ser", "dLbls", "firstSliceAng", "extLst"],
  doughnutChart: ["varyColors", "ser", "dLbls", "firstSliceAng", "holeSize", "extLst"],
  scatterChart: ["scatterStyle", "varyColors", "ser", "dLbls", "axId", "extLst"],
  ser: SER_FIELDS,
  dLbls: ["dLbl", "delete", "numFmt", "spPr", "txPr", "dLblPos", "showLegendKey", "showVal", "showCatName", "showSerName", "showPercent", "showBubbleSize", "separator", "showLeaderLines", "leaderLines", "extLst"],
  dPt: ["idx", "invertIfNegative", "marker", "bubble3D", "explosion", "spPr", "pictureOptions", "extLst"],
  catAx: [...AX, "auto", "lblAlgn", "lblOffset", "tickLblSkip", "tickMarkSkip", "noMultiLvlLbl", "extLst"],
  valAx: [...AX, "crossBetween", "majorUnit", "minorUnit", "dispUnits", "extLst"],
  scaling: ["logBase", "orientation", "max", "min"],
  legend: ["legendPos", "legendEntry", "layout", "overlay", "spPr", "txPr", "extLst"],
  externalData: ["autoUpdate"],
  strRef: ["f", "strCache"],
  numRef: ["f", "numCache"],
  strCache: ["ptCount", "pt"],
  numCache: ["formatCode", "ptCount", "pt"],
  rich: ["bodyPr", "lstStyle", "p"],
};

function rankOf(rule: Rank[], name: string): number {
  return rule.findIndex((r) => (Array.isArray(r) ? r.includes(name) : r === name));
}

function walk(el: XmlElement, visit: (e: XmlElement, parent?: XmlElement) => void, parent?: XmlElement): void {
  visit(el, parent);
  for (const c of el.children) if (typeof c !== "string") walk(c, visit, el);
}

/** Problems with the child order or the child names of a chart part. `c:marker` inside a series has children; inside `c:lineChart` it is a flag. */
export function chartOrderProblems(root: XmlElement): string[] {
  const problems: string[] = [];
  walk(root, (e, parent) => {
    const rule = e.name === "marker" && parent?.name !== "ser" ? undefined : CHART_ORDER[e.name];
    if (e.name === "marker" && parent?.name === "ser") {
      const order = ["symbol", "size", "spPr", "extLst"];
      let last = -1;
      for (const c of e.children) {
        if (typeof c === "string") continue;
        const r = order.indexOf(c.name);
        if (r < 0 || r < last) problems.push(`<marker> child <${c.name}> is out of order or unknown`);
        else last = r;
      }
      return;
    }
    if (!rule) return;
    let last = -1;
    for (const c of e.children) {
      if (typeof c === "string") continue;
      const r = rankOf(rule, c.name);
      if (r < 0) problems.push(`<${e.name}> may not contain <${c.name}>`);
      else if (r < last) problems.push(`<${c.name}> is out of order in <${e.name}>`);
      else last = r;
    }
  });
  return problems;
}

const find = (root: XmlElement, name: string): XmlElement[] => {
  const out: XmlElement[] = [];
  walk(root, (e) => {
    if (e.name === name) out.push(e);
  });
  return out;
};
const kids = (e: XmlElement | undefined, name: string): XmlElement[] => (e?.children.filter((c) => typeof c !== "string" && c.name === name) ?? []) as XmlElement[];

// ---- Sample charts --------------------------------------------------------------------------------------------------

const CHARTS: Record<string, Partial<ChartElement>> = {
  column: { chartType: "column", categories: ["North", "South", "East"], series: [{ name: "2024", values: [4, 6, 3] }, { name: "2025", values: [5, 2.5, 7], color: "#ff8800" }], title: "Sales & <costs>", gapWidth: 80, overlap: -10, valueAxis: { title: "Units", min: 0, max: 10, format: "0.0", majorUnit: 2 }, categoryAxis: { title: "Region" }, dataLabels: { value: true, position: "outside" } },
  stacked: { chartType: "column", grouping: "stacked", categories: ["a", "b"], series: [{ name: "x", values: [1, 2], color: { theme: "accent3", lumMod: 0.5 } }, { name: "y", values: [3, 4] }], dataLabels: { value: true, position: "center" } },
  percent: { chartType: "bar", grouping: "percentStacked", categories: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }], legend: "right" },
  bar: { chartType: "bar", categories: ["a", "b", "c"], series: [{ name: "x", values: [1, null, 3] }], legend: "top", valueAxis: { hidden: true }, categoryAxis: { line: null } },
  line: { chartType: "line", categories: ["a", "b", "c"], series: [{ name: "x", values: [1, 3, 2], smooth: true, marker: true, lineWidth: 3 }, { name: "y", values: [2, 2, 1], marker: false }], dataLabels: { value: true } },
  area: { chartType: "area", grouping: "stacked", categories: ["a", "b", "c"], series: [{ name: "x", values: [1, 3, 2] }, { name: "y", values: [2, 2, 1] }] },
  pie: { chartType: "pie", categories: ["a", "b", "c"], series: [{ name: "share", values: [5, 3, 2], pointColors: ["#112233", { theme: "accent2" }, "#445566"] }], dataLabels: { percent: true, category: true }, firstSliceAngle: 90 },
  doughnut: { chartType: "doughnut", categories: ["a", "b", "c"], series: [{ name: "share", values: [5, 3, 2] }], holeSize: 70 },
  scatter: { chartType: "scatter", categories: [], series: [{ name: "p", x: [1, 2.5, 4], values: [2, 4, 3] }, { name: "q", x: [1, 2, 3], values: [1, 2, 1], line: true, smooth: true }], valueAxis: { gridlines: false }, categoryAxis: { gridlines: true } },
  combo: { chartType: "column", categories: ["a", "b", "c"], series: [{ name: "bars", values: [3, 4, 5] }, { name: "line", values: [2, 3, 2], type: "line", marker: false, smooth: true }], legend: "none", textColor: "#333333", textSize: 10, fill: "#f0f0f0", plotFill: "#ffffff" },
};

function deckWith(chart: Partial<ChartElement>): Deck {
  const s = new DeckSession(createDeck({ title: "Charts" }));
  const slide = s.deck.slides[0]!;
  const el = s.addChart(slide.id, (chart.chartType ?? "column") as ChartType, { x: 40, y: 80, w: 520, h: 300 }, chart);
  void el;
  return s.deck;
}

const chartsOf = (deck: Deck): ChartElement[] => deck.slides.flatMap((s) => s.elements.filter((e): e is ChartElement => e.type === "chart"));
const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

// ---- Importing -------------------------------------------------------------------------------------------------------

describe("PPTX import: charts", () => {
  it("reads a clustered column chart with a smoothed line series, theme colours, deleted axes and a title", () => {
    const doc = chartDoc({
      title: `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400"/><a:t>Quarterly totals</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`,
      autoTitleDeleted: false,
      plot:
        `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
        cSer({ idx: 0, name: "Plan", spPr: solid("accent1") + "<a:ln><a:noFill/></a:ln>", head: '<c:invertIfNegative val="0"/>', cats: ["Q1", "Q2", "Q3"], vals: [4.3, 2.5, 3.5] }) +
        cSer({ idx: 1, name: "Actual", spPr: solid("accent2", '<a:lumMod val="75000"/>'), head: '<c:invertIfNegative val="0"/>', cats: ["Q1", "Q2", "Q3"], vals: [2.4, 4.4, 1.8] }) +
        `<c:gapWidth val="120"/><c:axId val="111"/><c:axId val="222"/></c:barChart>` +
        `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
        cSer({ idx: 2, name: "Trend", spPr: `<a:ln w="28575" cap="rnd">${solid("bg1", '<a:lumMod val="85000"/>')}<a:round/></a:ln>`, head: '<c:marker><c:symbol val="none"/></c:marker>', cats: ["Q1", "Q2", "Q3"], vals: [2, 2, 3], tail: '<c:smooth val="1"/>' }) +
        `<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>` +
        cAxes({ catDelete: true, valFmt: "0.0", min: 0, max: 6 }),
      tail: `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100">${solid("tx1")}<a:latin typeface="Georgia"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>`,
    });
    const { deck, warnings } = fromPptx(deckWithCharts([doc]));
    expect(warnings.filter((w) => /chart/i.test(w))).toEqual([]);
    const c = chartsOf(deck)[0]!;
    expect(c).toMatchObject({
      type: "chart",
      chartType: "column",
      name: "Chart 1",
      categories: ["Q1", "Q2", "Q3"],
      title: "Quarterly totals",
      titleSize: 14,
      legend: "none",
      gapWidth: 120,
      textSize: 11,
      fontFamily: "Georgia",
      categoryAxis: { hidden: true },
      valueAxis: { min: 0, max: 6, format: "0.0", gridlines: true },
    });
    expect(c.x).toBeCloseTo(72, 5);
    expect(c.w).toBeCloseTo(360, 5);
    expect(c.series.map((s) => s.name)).toEqual(["Plan", "Actual", "Trend"]);
    expect(c.series[0]).toMatchObject({ values: [4.3, 2.5, 3.5], color: { theme: "accent1" } });
    expect(c.series[1]!.color).toMatchObject({ theme: "accent2", lumMod: 0.75 });
    // bg1 is the light slot of the standard colour map
    expect(c.series[2]).toMatchObject({ type: "line", smooth: true, marker: false, lineWidth: 2.25, color: { theme: "lt1", lumMod: 0.85 } });
    // and it draws: bars from the data
    const scene = resolveSlide(deck, deck.slides[0]!);
    expect(scene.elements.find((e) => e.kind === "chart")!.chart).toBe(c);
  });

  it("reads grouping, direction, labels, number formats, gridlines and axis titles", () => {
    const labels = '<c:dLbls><c:numFmt formatCode="0.0" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';
    const title = (t: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
    const axes = cAxes({ pos: ["l", "b"], grid: false }).replace('<c:majorTickMark val="none"/>', `${title("Region")}<c:majorTickMark val="none"/>`);
    const doc = chartDoc({
      plot: `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${cSer({ idx: 0, name: "A", spPr: srgb("336699"), vals: [1, 2, 3] })}${cSer({ idx: 1, name: "B", spPr: srgb("996633"), vals: [3, 2, 1] })}${labels}<c:gapWidth val="50"/><c:overlap val="100"/><c:axId val="111"/><c:axId val="222"/></c:barChart>${axes}`,
      legend: '<c:legend><c:legendPos val="t"/><c:overlay val="0"/></c:legend>',
    });
    const c = chartsOf(fromPptx(deckWithCharts([doc])).deck)[0]!;
    expect(c).toMatchObject({ chartType: "bar", grouping: "stacked", legend: "top", gapWidth: 50, dataLabels: { value: true, format: "0.0", position: "center" }, valueAxis: { gridlines: false }, categoryAxis: { title: "Region", gridlines: false } });
    // a stack's own 100% overlap is not kept as a setting
    expect(c.overlap).toBeUndefined();
    expect(c.series.map((s) => s.color)).toEqual(["#336699", "#996633"]);
    expect(c.title).toBeUndefined();
  });

  it("reads pie slices, doughnut holes and scatter points, and fills in the automatic title", () => {
    const pieDoc = chartDoc({
      title: "<c:title><c:overlay val=\"0\"/></c:title>",
      autoTitleDeleted: false,
      plot: `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${cStrRef("Sheet1!$B$1", ["Mix"])}</c:tx><c:dPt><c:idx val="1"/><c:bubble3D val="0"/><c:spPr>${srgb("ff0000")}</c:spPr></c:dPt><c:cat>${cStrRef("Sheet1!$A$2:$A$4", ["x", "y", "z"])}</c:cat><c:val>${cNumRef("Sheet1!$B$2:$B$4", [1, 2, 3])}</c:val></c:ser><c:firstSliceAng val="45"/></c:pieChart>`,
      legend: '<c:legend><c:legendPos val="r"/></c:legend>',
    });
    const ring = chartDoc({ plot: `<c:doughnutChart><c:varyColors val="1"/>${cSer({ idx: 0, name: "D", vals: [1, 2, 3] })}<c:firstSliceAng val="0"/><c:holeSize val="65"/></c:doughnutChart>` });
    const scatter = chartDoc({
      plot:
        `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${cStrRef("Sheet1!$B$1", ["Pts"])}</c:tx><c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/></c:marker>` +
        `<c:xVal>${cNumRef("Sheet1!$A$2:$A$4", [1, 2.5, 4])}</c:xVal><c:yVal>${cNumRef("Sheet1!$B$2:$B$4", [3, 1, 2])}</c:yVal><c:smooth val="0"/></c:ser><c:axId val="111"/><c:axId val="222"/></c:scatterChart>` +
        `<c:valAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>` +
        `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`,
    });
    const { deck } = fromPptx(deckWithCharts([pieDoc, ring, scatter]));
    const [p, d, s] = chartsOf(deck);
    expect(p).toMatchObject({ chartType: "pie", categories: ["x", "y", "z"], title: "Mix", legend: "right", firstSliceAngle: 45 });
    expect(p!.series[0]!.pointColors).toEqual([defaultSeriesColor(0), "#ff0000", defaultSeriesColor(2)]);
    expect(d).toMatchObject({ chartType: "doughnut", holeSize: 65 });
    expect(s).toMatchObject({ chartType: "scatter", legend: "none" });
    expect(s!.series[0]).toMatchObject({ values: [3, 1, 2], x: [1, 2.5, 4], line: false, marker: true });
    expect(s!.valueAxis!.gridlines).toBe(true);
    expect(s!.categoryAxis!.gridlines).toBe(false);
  });

  it("uses `Chart Title` for an automatic title over several series, and reads date categories", () => {
    const doc = chartDoc({
      title: "<c:title><c:overlay val=\"0\"/></c:title>",
      autoTitleDeleted: false,
      plot: `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${cStrRef("Sheet1!$B$1", ["S1"])}</c:tx><c:cat>${cNumRef("Sheet1!$A$2:$A$3", [45000, 45001], "yyyy-mm-dd")}</c:cat><c:val>${cNumRef("Sheet1!$B$2:$B$3", [1, 2])}</c:val><c:smooth/></c:ser>${cSer({ idx: 1, name: "S2", vals: [1, 2, 3] })}<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>${cAxes()}`,
    });
    const c = chartsOf(fromPptx(deckWithCharts([doc])).deck)[0]!;
    expect(c.title).toBe("Chart Title");
    expect(c.categories).toEqual(["2023-03-15", "2023-03-16"]);
    // `<c:smooth/>` with no value means true
    expect(c.series[0]!.smooth).toBe(true);
  });

  it("shows a chart kind it can't draw as an empty box with its title, and says so", () => {
    const radar = chartDoc({
      title: `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Skills</a:t></a:r></a:p></c:rich></c:tx></c:title>`,
      plot: `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${cSer({ idx: 0, name: "R", vals: [1, 2, 3] })}<c:axId val="1"/><c:axId val="2"/></c:radarChart>`,
    });
    const { deck, warnings } = fromPptx(deckWithCharts([radar]));
    expect(warnings.some((w) => /radar chart.*isn't supported/.test(w))).toBe(true);
    const stand = deck.slides[0]!.elements[0] as ShapeElement;
    expect(stand).toMatchObject({ type: "shape", geometry: "rect", fill: null, name: "Chart 1" });
    expect(stand.text!.paragraphs[0]!.runs[0]!.text).toBe("Skills");
    expect(stand.w).toBeCloseTo(360, 5);
    expect(chartsOf(deck)).toHaveLength(0);
  });

  it("keeps the newer chart kinds' fallback picture and warns about them", () => {
    const frame = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="cx1"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Funnel"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"/></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="6" name="Fallback"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></mc:Fallback></mc:AlternateContent>`;
    const { deck, warnings } = fromPptx(simpleDeck([frame]));
    expect(deck.slides[0]!.elements.map((e) => e.name)).toEqual(["Fallback"]);
    expect(warnings.some((w) => /newer kind/.test(w))).toBe(true);
  });

  it("tolerates a chart with no data, a broken part, bad numbers and absurd sizes", () => {
    const empty = chartDoc({ plot: `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:axId val="111"/><c:axId val="222"/></c:barChart>${cAxes()}` });
    const noSeriesPlot = chartDoc({ plot: "" });
    const bad = chartDoc({
      plot: `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>x</c:f><c:strCache><c:ptCount val="999999999"/><c:pt idx="-4"><c:v>neg</c:v></c:pt><c:pt idx="2"><c:v>c</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>x</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>abc</c:v></c:pt><c:pt idx="1"><c:v>1e400</c:v></c:pt><c:pt idx="2"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="111"/><c:axId val="222"/></c:barChart>${cAxes()}`,
    });
    const many = chartDoc({ plot: `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${Array.from({ length: 300 }, (_, i) => cSer({ idx: i, name: `s${i}`, vals: [1] })).join("")}<c:axId val="111"/><c:axId val="222"/></c:barChart>${cAxes()}` });
    const { deck, warnings } = fromPptx(deckWithCharts([empty, noSeriesPlot, "<c:chartSpace", bad, many]));
    expect(() => validateDeck(deck)).not.toThrow();
    expect(deck.slides).toHaveLength(5);
    expect(warnings.some((w) => /nothing to draw/.test(w))).toBe(true);
    expect(chartsOf(deck)[0]).toMatchObject({ chartType: "column", series: [] });
    // the unreadable part leaves a stand-in
    expect((deck.slides[2]!.elements[0] as ShapeElement).geometry).toBe("rect");
    const b = deck.slides[3]!.elements[0] as ChartElement;
    expect(b.series[0]!.values).toEqual([null, null, 7]);
    expect(b.categories.length).toBeLessThanOrEqual(10_000);
    expect(b.categories[2]).toBe("c");
    expect((deck.slides[4]!.elements[0] as ChartElement).series).toHaveLength(256);
    expect(warnings.some((w) => /more than 256 series/.test(w))).toBe(true);
  });

  it("takes the frame of a chart in a placeholder from the layout", () => {
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Content Placeholder 3"/><p:cNvGraphicFramePr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId5"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const doc = chartDoc({ plot: `<c:pieChart><c:varyColors val="1"/>${cSer({ idx: 0, name: "p", vals: [1, 2, 3] })}</c:pieChart>` });
    const { deck } = fromPptx(deckWithCharts([doc], () => frame));
    // the master's body frame (36pt in)
    expect(chartsOf(deck)[0]).toMatchObject({ x: 36 });
    expect(chartsOf(deck)[0]!.w).toBeGreaterThan(300);
  });
});

// ---- Exporting -------------------------------------------------------------------------------------------------------

describe("PPTX export: charts", () => {
  for (const [name, chart] of Object.entries(CHARTS)) {
    it(`writes a ${name} chart part in schema order, with ids that match, an embedded workbook and the right relationships`, () => {
      const bytes = toPptx(deckWith(chart), { date: DATE });
      const files = unzipSync(bytes);
      const part = strFromU8(files["ppt/charts/chart1.xml"]!);
      const root = parseXml(part);
      expect(part.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
      expect(chartOrderProblems(root)).toEqual([]);
      // axis ids: used by a chart group, defined once, each pointing at the other
      const axes = [...find(root, "catAx"), ...find(root, "valAx")];
      const defined = axes.map((a) => kids(a, "axId")[0]!.attrs.val!);
      expect(new Set(defined).size).toBe(defined.length);
      for (const g of [...find(root, "barChart"), ...find(root, "lineChart"), ...find(root, "areaChart"), ...find(root, "scatterChart")]) for (const id of kids(g, "axId")) expect(defined).toContain(id.attrs.val);
      for (const a of axes) expect(defined).toContain(kids(a, "crossAx")[0]!.attrs.val);
      // series: unique idx and order
      const sers = find(root, "ser");
      const idx = sers.map((s) => kids(s, "idx")[0]!.attrs.val);
      expect(new Set(idx).size).toBe(idx.length);
      // the part, its content type, the frame's relationship and the workbook
      const ct = strFromU8(files["[Content_Types].xml"]!);
      expect(ct).toContain('<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>');
      expect(ct).toContain('<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>');
      expect(strFromU8(files["ppt/slides/_rels/slide1.xml.rels"]!)).toMatch(/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/chart" Target="\.\.\/charts\/chart1\.xml"/);
      expect(strFromU8(files["ppt/charts/_rels/chart1.xml.rels"]!)).toMatch(/relationships\/package" Target="\.\.\/embeddings\/Microsoft_Excel_Sheet1\.xlsx"/);
      expect(files["ppt/embeddings/Microsoft_Excel_Sheet1.xlsx"]!.length).toBeGreaterThan(200);
      expect(find(root, "externalData")[0]!.attrs["r:id"]).toBe("rId1");
      expect(find(root, "autoUpdate")[0]!.attrs.val).toBe("0");
      expect(strFromU8(files["ppt/slides/slide1.xml"]!)).toContain('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId');
    });
  }

  it("embeds a workbook whose cells match the cached values the chart refers to", () => {
    const files = unzipSync(toPptx(deckWith(CHARTS.column!), { date: DATE }));
    const book = unzipSync(files["ppt/embeddings/Microsoft_Excel_Sheet1.xlsx"]!);
    expect(Object.keys(book).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    for (const name of Object.keys(book)) expect(() => parseXml(strFromU8(book[name]!)), name).not.toThrow();
    const sheet = parseXml(strFromU8(book["xl/worksheets/sheet1.xml"]!));
    const cells = new Map<string, string>();
    for (const c of find(sheet, "c")) cells.set(c.attrs.r!, find(c, "t")[0] ? JSON.stringify(find(c, "t")[0]!.children[0]) : String(find(c, "v")[0]!.children[0]));
    expect(cells.get("B1")).toBe('"2024"');
    expect(cells.get("A2")).toBe('"North"');
    expect(cells.get("C3")).toBe("2.5");
    const root = parseXml(strFromU8(files["ppt/charts/chart1.xml"]!));
    // each series' reference resolves to the cells holding its cached values
    for (const ser of find(root, "ser")) {
      const f = find(kids(ser, "val")[0]!, "f")[0]!.children[0] as string;
      const m = /^Sheet1!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/.exec(f)!;
      const cached = find(kids(ser, "val")[0]!, "v").map((v) => String(v.children[0]));
      const fromSheet = Array.from({ length: Number(m[3]) - Number(m[2]) + 1 }, (_, i) => cells.get(`${m[1]}${Number(m[2]) + i}`));
      expect(fromSheet).toEqual(cached);
    }
    expect(strFromU8(book["[Content_Types].xml"]!)).toContain("spreadsheetml.worksheet+xml");
  });

  it("writes only data labels positions the chart kind allows", () => {
    const stackedOutside = chartXml({ type: "chart", id: "x", ...CHARTS.stacked, dataLabels: { value: true, position: "outside" } } as ChartElement, false, 10);
    expect(stackedOutside).not.toContain("outEnd");
    const clustered = chartXml({ type: "chart", id: "x", ...CHARTS.column } as ChartElement, false, 10);
    expect(clustered).toContain('<c:dLblPos val="outEnd"/>');
    const area = chartXml({ type: "chart", id: "x", ...CHARTS.area, dataLabels: { value: true, position: "outside" } } as ChartElement, false, 10);
    expect(area).not.toContain("dLblPos");
    expect(chartXml({ type: "chart", id: "x", ...CHARTS.doughnut, dataLabels: { value: true } } as ChartElement, false, 10)).not.toContain("dLblPos");
  });

  it("is byte-for-byte the same twice, and gives each chart its own parts", () => {
    const s = new DeckSession(createDeck());
    const a = s.addChart(s.deck.slides[0]!.id, "column");
    const second = s.addSlide();
    s.addChart(second.id, "pie");
    void a;
    const one = toPptx(s.deck, { date: DATE });
    expect(toPptx(s.deck, { date: DATE })).toEqual(one);
    const files = unzipSync(one);
    expect(Object.keys(files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toEqual(["ppt/charts/chart1.xml", "ppt/charts/chart2.xml"]);
    expect(files["ppt/embeddings/Microsoft_Excel_Sheet2.xlsx"]).toBeDefined();
    expect(strFromU8(files["ppt/charts/chart1.xml"]!)).toContain("<c:barChart>");
    expect(strFromU8(files["ppt/charts/chart2.xml"]!)).toContain("<c:pieChart>");
  });

  it("round-trips every chart kind through PPTX: type, series, categories, values and colours", () => {
    for (const [name, chart] of Object.entries(CHARTS)) {
      const original = chartsOf(deckWith(chart))[0]!;
      const { deck, warnings } = fromPptx(toPptx(deckWith(chart), { date: DATE }));
      expect(warnings.filter((w) => /chart/i.test(w)), name).toEqual([]);
      const back = chartsOf(deck)[0]!;
      expect(back.chartType, name).toBe(original.chartType);
      expect(back.grouping, name).toBe(original.grouping);
      expect(back.categories, name).toEqual(original.categories);
      expect(back.series.map((s) => s.name), name).toEqual(original.series.map((s) => s.name));
      expect(back.series.map((s) => s.values), name).toEqual(original.series.map((s) => s.values));
      expect(back.series.map((s) => s.type), name).toEqual(original.series.map((s) => s.type));
      if (original.chartType === "scatter") expect(back.series.map((s) => s.x), name).toEqual(original.series.map((s) => s.x));
      // an unset colour comes back as the accent it stood for
      if (original.chartType !== "pie" && original.chartType !== "doughnut") expect(back.series.map((s) => s.color), name).toEqual(original.series.map((s, i) => s.color ?? defaultSeriesColor(i)));
      expect(back.title ?? undefined, name).toBe(original.title ?? undefined);
      expect(back.x, name).toBeCloseTo(original.x!, 3);
      expect(back.w, name).toBeCloseTo(original.w!, 3);
      expect(back.h, name).toBeCloseTo(original.h!, 3);
    }
  });

  it("round-trips the options that shape a chart", () => {
    const get = (name: string) => chartsOf(fromPptx(toPptx(deckWith(CHARTS[name]!), { date: DATE })).deck)[0]!;
    expect(get("column")).toMatchObject({ gapWidth: 80, overlap: -10, valueAxis: { title: "Units", min: 0, max: 10, format: "0.0", majorUnit: 2 }, categoryAxis: { title: "Region" }, dataLabels: { value: true, position: "outside" }, legend: "bottom" });
    expect(get("stacked")).toMatchObject({ dataLabels: { value: true, position: "center" } });
    expect(get("stacked").series[0]!.color).toMatchObject({ theme: "accent3", lumMod: 0.5 });
    expect(get("bar")).toMatchObject({ chartType: "bar", legend: "top", valueAxis: { hidden: true }, categoryAxis: { line: null } });
    expect(get("bar").series[0]!.values).toEqual([1, null, 3]);
    expect(get("percent")).toMatchObject({ grouping: "percentStacked", legend: "right" });
    expect(get("line").series.map((s) => [s.smooth, s.marker, s.lineWidth])).toEqual([[true, true, 3], [false, false, 2.25]]);
    expect(get("pie")).toMatchObject({ firstSliceAngle: 90, dataLabels: { percent: true, category: true } });
    expect(get("pie").series[0]!.pointColors).toEqual(["#112233", { theme: "accent2" }, "#445566"]);
    expect(get("doughnut").holeSize).toBe(70);
    expect(get("scatter")).toMatchObject({ valueAxis: { gridlines: false }, categoryAxis: { gridlines: true } });
    expect(get("scatter").series.map((s) => [s.line, s.smooth ?? false])).toEqual([[false, false], [true, true]]);
    expect(get("combo")).toMatchObject({ legend: "none", textSize: 10, textColor: "#333333", fill: "#f0f0f0", plotFill: "#ffffff" });
    expect(get("combo").series[1]).toMatchObject({ type: "line", smooth: true, marker: false });
  });

  it("escapes titles and names and survives odd text", () => {
    const deck = deckWith({ ...CHARTS.column!, title: 'Q&A "<b>" \u0001 ünï', series: [{ name: "a & b <c>", values: [1, 2, 3] }] });
    const files = unzipSync(toPptx(deck, { date: DATE }));
    expect(() => parseXml(strFromU8(files["ppt/charts/chart1.xml"]!))).not.toThrow();
    const back = chartsOf(fromPptx(toPptx(deck, { date: DATE })).deck)[0]!;
    expect(back.title).toBe('Q&A "<b>"  ünï');
    expect(back.series[0]!.name).toBe("a & b <c>");
  });

  it("draws a chart in a PDF, with its title, labels and colours", () => {
    const deck = deckWith(CHARTS.column!);
    const { bytes, warnings } = toPdf(deck, { date: DATE, compress: false });
    const text = strFromU8(bytes, true);
    expect(warnings).toEqual([]);
    expect(bytes.length).toBeGreaterThan(1000);
    const hex = (t: string) => [...t].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
    expect(text).toContain(hex("Sales & <costs>"));
    expect(text).toContain(hex("North"));
    expect(text).toContain(hex("4.0"));
    // the second series' own colour (ff8800) is a fill
    expect(text).toContain("1 0.533 0 rg");
  });
});

// ---- The model ---------------------------------------------------------------------------------------------------------

describe("chart elements in the model", () => {
  it("are added, changed and undone as one step each", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!.id;
    const c = s.addChart(slide, "column");
    expect(c).toMatchObject({ type: "chart", chartType: "column" });
    expect(c.series).toHaveLength(2);
    // centred on the slide
    expect(c.x! + c.w! / 2).toBeCloseTo(s.deck.size.width / 2, 5);
    s.updateChart(slide, c.id, { title: "Hello", grouping: "stacked" });
    expect((s.element(slide, c.id) as ChartElement).title).toBe("Hello");
    s.updateChart(slide, c.id, { title: undefined });
    expect("title" in s.element(slide, c.id)).toBe(false);
    s.updateChart(slide, c.id, (ch) => ({ ...ch, series: [...ch.series, { name: "More", values: [1, 2, 3] }] }));
    expect((s.element(slide, c.id) as ChartElement).series).toHaveLength(3);
    s.undo();
    expect((s.element(slide, c.id) as ChartElement).series).toHaveLength(2);
    s.undo();
    s.undo();
    expect((s.element(slide, c.id) as ChartElement).grouping).toBeUndefined();
    expect(() => s.updateChart(slide, s.deck.slides[0]!.elements.find((e) => e.type !== "chart")!.id, { title: "x" })).toThrow(/Not a chart/);
  });

  it("copy with fresh ids, duplicate and scale with the slide", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!.id;
    const c = s.addChart(slide, "line", {}, { textSize: 10, titleSize: 16 });
    const [copyId] = s.duplicateElements(slide, [c.id]);
    expect(copyId).not.toBe(c.id);
    expect((s.element(slide, copyId!) as ChartElement).series).toEqual(c.series);
    s.setSize({ width: s.deck.size.width * 2, height: s.deck.size.height * 2 });
    const big = s.element(slide, c.id) as ChartElement;
    expect(big.w).toBeCloseTo(c.w! * 2, 5);
    expect(big.textSize).toBeCloseTo(20, 5);
  });

  it("serialize, and reject malformed data", () => {
    const deck = deckWith(CHARTS.pie!);
    expect(chartsOf(parseDeck(serializeDeck(deck)))[0]!.series[0]!.values).toEqual([5, 3, 2]);
    const bad = JSON.parse(serializeDeck(deck));
    bad.deck.slides[0].elements.at(-1).chartType = "radar";
    expect(() => parseDeck(JSON.stringify(bad))).toThrow(/chartType/);
    const nan = JSON.parse(serializeDeck(deck));
    nan.deck.slides[0].elements.at(-1).series[0].values = [1, "x"];
    expect(() => parseDeck(JSON.stringify(nan))).toThrow(/numbers/);
    const many = JSON.parse(serializeDeck(deck));
    many.deck.slides[0].elements.at(-1).series = Array.from({ length: 300 }, () => ({ name: "s", values: [1] }));
    expect(() => parseDeck(JSON.stringify(many))).toThrow(/at most 256 series/);
  });

  it("resolve to a chart element with its frame", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const c = s.addChart(slide.id, "area");
    const el = s.scene(slide.id).elements.find((e) => e.id === c.id)!;
    expect(el).toMatchObject({ kind: "chart", x: c.x, y: c.y, w: c.w, h: c.h });
    expect(el.chart).toBe(s.element(slide.id, c.id));
    expect(s.frames(slide.id).get(c.id)).toMatchObject({ w: c.w });
    s.setFrame(slide.id, c.id, { w: 200 });
    expect((s.element(slide.id, c.id) as ChartElement).w).toBe(200);
  });
});
