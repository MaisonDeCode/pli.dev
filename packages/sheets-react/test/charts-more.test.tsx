// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, type Chart } from "@pli.dev/sheets";
import { ChartView, PliSheet } from "../src";
import { ChartDialog } from "../src/ChartDialog";
import { buildSurface3d } from "../src/chart3d";
import { ringPath, tint } from "../src/chartmath";
import { niceTicks } from "../src/chartmath";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function book(): SheetSession {
  const s = new SheetSession(createWorkbook("t"));
  s.setValues("Sheet1", "A1", [
    ["Month", "Sales", "Margin", "Units", "Group"],
    ["Jan", 10, 0.2, 5, "North"],
    ["Feb", 15, 0.25, 8, "North"],
    ["Mar", 12, 0.22, 6, "South"],
    ["Apr", 20, 0.3, 9, "South"],
    ["May", 24, 0.28, 12, "South"],
  ]);
  return s;
}
const cats = "Sheet1!$A$2:$A$6";
const col = (c: string, extra: object = {}) => ({ nameRef: `Sheet1!$${c}$1`, values: `Sheet1!$${c}$2:$${c}$6`, ...extra });

function draw(s: SheetSession, spec: Parameters<SheetSession["addChart"]>[1]) {
  const chart = s.addChart("Sheet1", spec);
  act(() => root.render(<ChartView chart={chart} data={s.chartData("Sheet1", chart.id)} />));
  return host.querySelector("svg")!;
}
const count = (svg: Element, sel: string) => svg.querySelectorAll(sel).length;
const labels = (svg: Element) => [...svg.querySelectorAll(".pli-chart-label")].map((t) => t.textContent);

describe("path helpers", () => {
  it("draws ring segments and tints colours", () => {
    expect(ringPath(0, 0, 5, 10, 0, Math.PI)).toMatch(/^M0,-10A10,10 0 0 1 .*A5,5 0 0 0 0,-5Z$/);
    expect(ringPath(0, 0, 5, 10, 0, Math.PI * 2).match(/M/g)).toHaveLength(2);
    expect(tint("#808080", 0)).toBe("#808080");
    expect(tint("#808080", 1)).toBe("#ffffff");
    expect(tint("#808080", -1)).toBe("#000000");
  });
});

describe("combined charts and secondary axes drawn", () => {
  it("draws columns, a line and an area together, with a second axis on the right", () => {
    const s = book();
    const svg = draw(s, { type: "column", categories: cats, y2Title: "Margin", yTitle: "Sales", series: [col("B"), col("C", { type: "line", axis: "secondary" }), col("D", { type: "area" })] });
    expect(count(svg, "rect.pli-chart-bar")).toBe(5);
    expect(count(svg, ".pli-chart-marker")).toBe(5);
    expect(count(svg, "path.pli-chart-area")).toBe(1);
    const texts = [...svg.querySelectorAll("text")];
    // the margin axis (0 to 0.35) is labelled on the right of the plot, the sales axis (0 to 25) on the left
    const right = texts.filter((t) => t.getAttribute("text-anchor") === "start" && /^0\.\d+$/.test(t.textContent ?? ""));
    expect(right.length).toBeGreaterThan(2);
    const left = texts.filter((t) => t.getAttribute("text-anchor") === "end" && t.textContent === "20");
    expect(left).toHaveLength(1);
    expect(Number(right[0]!.getAttribute("x"))).toBeGreaterThan(Number(left[0]!.getAttribute("x")));
    expect(texts.map((t) => t.textContent)).toEqual(expect.arrayContaining(["Margin", "Sales"]));
    // the three series are in the legend
    expect(labels(svg)).toEqual(expect.arrayContaining(["Sales", "Margin", "Units"]));
  });

  it("scales a series on the second axis by that axis, not the first", () => {
    const s = book();
    const svg = draw(s, { type: "line", categories: cats, series: [col("B"), col("C", { axis: "secondary" })] });
    const ys = [...svg.querySelectorAll<SVGCircleElement>(".pli-chart-marker")].map((c) => Number(c.getAttribute("cy")));
    // markers come series by series: the margin (0.2..0.3) is drawn across the same height as the sales (10..24), not squashed at the bottom
    const sales = ys.slice(0, 5);
    const margin = ys.slice(5);
    expect(Math.max(...margin) - Math.min(...margin)).toBeGreaterThan(20);
    expect(Math.max(...sales) - Math.min(...sales)).toBeGreaterThan(20);
  });

  it("shows the second category axis along the top when asked", () => {
    const s = book();
    const svg = draw(s, { type: "column", categories: cats, secondaryCategoryAxis: true, series: [col("B"), col("C", { type: "line", axis: "secondary" })] });
    expect(labels(svg).filter((t) => t === "Jan")).toHaveLength(2);
  });

  it("stacks only the series that are the chart's own kind", () => {
    const s = book();
    const svg = draw(s, { type: "column", grouping: "stacked", categories: cats, series: [col("B"), col("D"), col("C", { type: "line", axis: "secondary" })] });
    const bars = [...svg.querySelectorAll<SVGRectElement>("rect.pli-chart-bar")].map((r) => Number(r.getAttribute("height")));
    // Jan: 10 and 5 are stacked, so the second bar sits on the first and the pair is as tall as 15
    expect(bars[0]! + bars[5]!).toBeCloseTo(bars[0]! * 1.5, 5);
  });
});

describe("trendlines drawn", () => {
  it("draws a dashed line, its equation and R squared, and the legend entry", () => {
    const s = book();
    const svg = draw(s, { type: "line", categories: cats, series: [col("B", { trendlines: [{ type: "linear", equation: true, rSquared: true, forward: 2 }] })] });
    expect(count(svg, "path.pli-chart-trend")).toBe(1);
    const text = [...svg.querySelectorAll(".pli-chart-trendlabel")].map((t) => t.textContent);
    expect(text).toEqual(["y = 3.3x + 6.3", "R² = 0.82"]);
    // two more periods are added to the axis for the forecast
    expect(labels(svg).filter((t) => ["Jan", "Feb", "Mar", "Apr", "May"].includes(t ?? ""))).toHaveLength(5);
    expect(svg.querySelectorAll("line[stroke-dasharray]")).toHaveLength(1); // the legend swatch
    expect(labels(svg)).toEqual(expect.arrayContaining(["Linear (Sales)"]));
  });

  it("follows the x values of a scatter chart", () => {
    const s = book();
    const svg = draw(s, { type: "scatter", series: [{ name: "P", x: "Sheet1!$B$2:$B$6", values: "Sheet1!$D$2:$D$6", trendlines: [{ type: "polynomial", order: 2 }, { type: "movingAverage", period: 2 }] }] });
    expect(count(svg, "path.pli-chart-trend")).toBe(2);
  });

  it("says nothing when the fit is impossible", () => {
    const s = book();
    s.setCell("Sheet1", "D3", -1);
    const svg = draw(s, { type: "line", categories: cats, series: [col("D", { trendlines: [{ type: "exponential" }] })] });
    expect(count(svg, "path.pli-chart-trend")).toBe(0);
  });
});

describe("the other kinds drawn", () => {
  it("doughnut: a ring of slices for each series", () => {
    const svg = draw(book(), { type: "doughnut", holeSize: 60, labels: true, categories: cats, series: [col("B"), col("D")] });
    expect(count(svg, "path.pli-chart-slice")).toBe(10);
    expect(svg.querySelector(".pli-chart-slice title")?.textContent).toContain("Jan");
    expect(labels(svg)).toEqual(expect.arrayContaining(["Jan", "May"]));
  });

  it("pie of pie and bar of pie: the small values move to a second plot", () => {
    const pp = draw(book(), { type: "pieOfPie", split: { by: "position", at: 2 }, categories: cats, series: [col("B")] });
    // three slices stay (plus "Other") and two are drawn again in the second pie
    expect(count(pp, "path.pli-chart-slice")).toBe(4 + 2);
    expect(count(pp, "line.pli-chart-grid")).toBe(2);
    const bp = draw(book(), { type: "barOfPie", split: { by: "position", at: 2 }, categories: cats, series: [col("B")] });
    expect(count(bp, "path.pli-chart-slice")).toBe(4);
    expect(count(bp, "rect.pli-chart-bar")).toBe(2);
  });

  it("radar: a polygon and marks for each series, filled when asked", () => {
    const flat = draw(book(), { type: "radar", categories: cats, series: [col("B"), col("D")] });
    expect(count(flat, "polygon[fill='none'][stroke]")).toBe(2);
    expect(count(flat, ".pli-chart-marker")).toBe(10);
    const filled = draw(book(), { type: "radar", filled: true, categories: cats, series: [col("B")] });
    expect(count(filled, "polygon.pli-chart-area")).toBe(1);
  });

  it("bubble: a circle for each point, as big as its size", () => {
    const svg = draw(book(), { type: "bubble", series: [{ name: "B", x: "Sheet1!$B$2:$B$6", values: "Sheet1!$C$2:$C$6", size: "Sheet1!$D$2:$D$6" }] });
    const radii = [...svg.querySelectorAll<SVGCircleElement>(".pli-chart-marker")].map((c) => Number(c.getAttribute("r")));
    expect(radii).toHaveLength(5);
    // the biggest size (12) is the biggest bubble, and the area follows the size
    expect(Math.max(...radii)).toBe(radii[4]);
    expect((radii[0]! / radii[4]!) ** 2).toBeCloseTo(5 / 12, 1);
  });

  it("stock: a line from low to high for each day, and bodies when there is an open", () => {
    const s = book();
    s.setValues("Sheet1", "G1", [["Open", "High", "Low", "Close"], [10, 14, 9, 12], [12, 16, 11, 11], [11, 15, 10, 14], [14, 18, 13, 17], [17, 19, 15, 16]]);
    const g = (c: string) => ({ nameRef: `Sheet1!$${c}$1`, values: `Sheet1!$${c}$2:$${c}$6` });
    const hlc = draw(s, { type: "stock", stock: "hlc", categories: cats, series: [{ ...g("H") }, { ...g("I") }, { ...g("J") }] });
    expect(count(hlc, "line.pli-chart-stockline")).toBe(5);
    const ohlc = draw(s, { type: "stock", stock: "ohlc", categories: cats, series: [g("G"), g("H"), g("I"), g("J")] });
    expect(count(ohlc, "rect.pli-chart-bar")).toBe(5);
    // up days are open, down days are filled
    const fills = [...ohlc.querySelectorAll("rect.pli-chart-bar")].map((r) => r.getAttribute("fill"));
    expect(fills[1]).toBe("#404040");
    expect(fills[0]).toBe("var(--pli-bg)");
  });

  it("surface: a mesh of bands that turns with the view, or wires", () => {
    const s = book();
    const spec = { type: "surface" as const, categories: cats, view3d: { rotX: 20, rotY: 30 }, series: [col("B"), col("C"), col("D")] };
    const mesh = draw(s, spec);
    // five categories and three series make 4 x 2 quadrilaterals, each cut into triangles and then where the height crosses a band
    expect(count(mesh, "polygon.pli-chart-solid")).toBeGreaterThanOrEqual(16);
    const wire = draw(s, { ...spec, wireframe: true });
    expect(count(wire, "polygon.pli-chart-wire")).toBe(8);
    const chart = s.charts("Sheet1")[0]!;
    const items = buildSurface3d(chart, s.chartData("Sheet1", chart.id), { x: 0, y: 0, w: 400, h: 300 }, niceTicks(0, 25), String);
    expect(items.filter((i) => i.kind === "poly" && i.cls === "pli-chart-solid").length).toBeGreaterThanOrEqual(16);
    // bands are listed in the legend
    expect(labels(mesh).some((t) => /–/.test(t ?? ""))).toBe(true);
  });

  it("waterfall: bars float from the running total, totals start at zero", () => {
    const s = book();
    s.setValues("Sheet1", "G1", [["Step", "Amount"], ["Start", 100], ["Sales", 40], ["Costs", -30], ["Total", 110]]);
    const svg = draw(s, { type: "waterfall", totals: [0, 3], labels: true, categories: "Sheet1!$G$2:$G$5", series: [{ values: "Sheet1!$H$2:$H$5" }] });
    const bars = [...svg.querySelectorAll<SVGRectElement>("rect.pli-chart-bar")];
    expect(bars).toHaveLength(4);
    const fills = bars.map((b) => b.getAttribute("fill"));
    expect(fills[0]).toBe(fills[3]);
    expect(new Set(fills).size).toBe(3);
    // the cost bar hangs from 140 down to 110: its top is the increase's top, and it ends at the total's top
    expect(Number(bars[3]!.getAttribute("y"))).toBeCloseTo(Number(bars[2]!.getAttribute("y")) + Number(bars[2]!.getAttribute("height")), 5);
    expect(count(svg, "line.pli-chart-axis")).toBeGreaterThanOrEqual(3);
    expect(labels(svg)).toEqual(expect.arrayContaining(["Increase", "Decrease", "Total"]));
    expect([...svg.querySelectorAll(".pli-chart-value")].map((t) => t.textContent)).toEqual(["100", "+40", "-30", "110"]);
  });

  it("histogram: a bar for each bin with the count", () => {
    const s = book();
    s.setValues("Sheet1", "G1", [[1], [2], [2], [3], [3], [3], [4], [4], [5], [9]]);
    const svg = draw(s, { type: "histogram", bins: { by: "width", size: 2 }, labels: true, series: [{ values: "Sheet1!$G$1:$G$10" }] });
    expect([...svg.querySelectorAll(".pli-chart-value")].map((t) => t.textContent)).toEqual(["6", "3", "1"]);
    expect(labels(svg)).toEqual(expect.arrayContaining(["[1, 3]", "(3, 5]"]));
  });

  it("Pareto: sorted bars and a cumulative line up to 100%", () => {
    const s = book();
    const svg = draw(s, { type: "pareto", categories: cats, series: [col("B")] });
    expect(labels(svg).slice(0, 0)).toEqual([]);
    expect(count(svg, "rect.pli-chart-bar")).toBe(5);
    expect(count(svg, ".pli-chart-marker")).toBe(5);
    expect(labels(svg)).toEqual(expect.arrayContaining(["100%", "0%"]));
    const titles = [...svg.querySelectorAll("rect.pli-chart-bar title")].map((t) => t.textContent);
    expect(titles[0]).toBe("May: 24");
  });

  it("box and whisker: a box, median, whiskers and outliers for each group", () => {
    const s = book();
    s.setValues("Sheet1", "G1", [[1, "a"], [3, "a"], [4, "a"], [7, "a"], [8, "a"], [12, "a"], [15, "a"], [40, "a"], [2, "b"], [3, "b"], [5, "b"]]);
    const svg = draw(s, { type: "boxWhisker", box: { quartile: "inclusive" }, categories: "Sheet1!$H$1:$H$11", series: [{ name: "v", values: "Sheet1!$G$1:$G$11" }] });
    expect(count(svg, "rect.pli-chart-bar")).toBe(2);
    expect(count(svg, "circle.pli-chart-marker")).toBe(1); // 40 is an outlier of group a
    expect(labels(svg)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(svg.querySelector("rect.pli-chart-bar title")?.textContent).toContain("median 7.5");
  });

  it("funnel: centred bars that shrink with the values", () => {
    const s = book();
    const svg = draw(s, { type: "funnel", categories: cats, series: [col("B")] });
    const widths = [...svg.querySelectorAll<SVGRectElement>("rect.pli-chart-bar")].map((r) => Number(r.getAttribute("width")));
    expect(widths).toHaveLength(5);
    expect(widths[4]).toBeGreaterThan(widths[0]!);
    expect(Math.max(...widths)).toBe(widths[4]);
  });

  it("treemap and sunburst: tiles and arcs for a two-level hierarchy", () => {
    const s = book();
    const spec = { categories: "Sheet1!$E$2:$A$6", series: [col("B")] };
    void spec;
    s.setValues("Sheet1", "G1", [["North", "Pens", 12], ["", "Ink", 7], ["", "Paper", 9], ["South", "Pens", 15], ["", "Ink", 4]]);
    const hierarchy = { categories: "Sheet1!$G$1:$H$5", series: [{ values: "Sheet1!$I$1:$I$5" }] };
    const tree = draw(s, { type: "treemap", ...hierarchy });
    // two parents and five leaves
    expect(count(tree, "rect.pli-chart-tile")).toBe(7);
    expect(tree.textContent).toContain("North");
    const none = draw(s, { type: "treemap", parentLabels: "none", ...hierarchy });
    expect([...none.querySelectorAll("text")].map((t) => t.textContent)).not.toContain("North");
    const sun = draw(s, { type: "sunburst", ...hierarchy });
    expect(count(sun, "path.pli-chart-slice")).toBe(7);
  });

  it("says so when a kind has nothing to show", () => {
    const s = new SheetSession(createWorkbook("e"));
    for (const type of ["doughnut", "radar", "waterfall", "histogram", "treemap", "stock", "surface"] as const) {
      const svg = draw(s, { type, series: [{ values: "Sheet1!$A$1:$A$3" }] });
      expect(svg.textContent, type).toContain("No data to show");
    }
  });
});

describe("the chart editor", () => {
  const open = (chart: Chart, onSave: (patch: never) => void = () => undefined) =>
    act(() => root.render(<ChartDialog open chart={chart} sheetName="Sheet1" onClose={() => undefined} onSave={onSave as never} />));
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
  const change = (el: HTMLSelectElement | HTMLInputElement, value: string) =>
    act(() => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  const click = (el: Element) => act(() => (el as HTMLElement).click());
  const submit = () => act(() => q<HTMLFormElement>("form").requestSubmit());
  const seriesChart = (s: SheetSession, spec: Parameters<SheetSession["addChart"]>[1]) => s.addChart("Sheet1", spec);

  it("sets the kind and axis of each series, and a trendline, then saves them", () => {
    const s = book();
    const chart = seriesChart(s, { type: "column", categories: cats, series: [col("B"), col("C")] });
    let saved: Omit<Chart, "id" | "from" | "width" | "height"> | undefined;
    open(chart, (p) => (saved = p as never));
    change(q<HTMLSelectElement>('select[aria-label="Kind of series 2"]'), "line");
    click(q('input[aria-label="Series 2 on the secondary axis"]'));
    click(q('button[aria-label="Add a trendline to series 1"]'));
    change(q<HTMLSelectElement>('select[aria-label="Trendline 1 of series 1"]'), "polynomial");
    change(q<HTMLInputElement>('input[aria-label="Order"]'), "3");
    change(q<HTMLInputElement>('input[aria-label="Forecast forward"]'), "2");
    click(q('input[aria-label="Show equation"]'));
    submit();
    expect(saved!.series[1]).toMatchObject({ type: "line", axis: "secondary" });
    expect(saved!.series[0]!.type).toBeUndefined();
    expect(saved!.series[0]!.trendlines).toEqual([{ type: "polynomial", order: 3, forward: 2, equation: true }]);
  });

  it("shows only the options of the chosen kind", () => {
    const s = book();
    const chart = seriesChart(s, { type: "column", categories: cats, series: [col("B")] });
    open(chart);
    expect(document.body.textContent).not.toContain("Hole size");
    change(q<HTMLSelectElement>("select"), "doughnut");
    expect(document.body.textContent).toContain("Hole size");
    change(q<HTMLSelectElement>("select"), "histogram");
    expect(document.body.textContent).toContain("Overflow above");
    expect(document.body.textContent).not.toContain("Labels (cells)");
    change(q<HTMLSelectElement>("select"), "boxWhisker");
    expect(document.body.textContent).toContain("Mean markers");
    change(q<HTMLSelectElement>("select"), "pieOfPie");
    expect(document.body.textContent).toContain("Second plot size");
  });

  it("saves the options of a kind in the chart's own terms", () => {
    const s = book();
    const chart = seriesChart(s, { type: "histogram", series: [col("B")] });
    let saved: Omit<Chart, "id" | "from" | "width" | "height"> | undefined;
    open(chart, (p) => (saved = p as never));
    const by = [...document.querySelectorAll<HTMLSelectElement>("select")].find((e) => [...e.options].some((o) => o.value === "width"))!;
    change(by, "width");
    change(q<HTMLInputElement>('input[aria-label="Bin size"]'), "5");
    submit();
    expect(saved!.bins).toEqual({ by: "width", size: 5 });
  });

  it("refuses a bin width that isn't there", () => {
    const s = book();
    const chart = seriesChart(s, { type: "histogram", series: [col("B")] });
    let saved: unknown;
    open(chart, (p) => (saved = p));
    const by = [...document.querySelectorAll<HTMLSelectElement>("select")].find((e) => [...e.options].some((o) => o.value === "width"))!;
    change(by, "width");
    submit();
    expect(saved).toBeUndefined();
    expect(q('[role="alert"]').textContent).toMatch(/width/);
  });
});

describe("the chart menu and the editor in the sheet", () => {
  it("Insert > Chart lists the new kinds, and a chart can be made of each", () => {
    const s = book();
    for (const type of ["doughnut", "radar", "bubble", "waterfall", "histogram", "pareto", "boxWhisker", "funnel", "treemap", "sunburst", "pieOfPie", "barOfPie"] as const) {
      const c = s.insertChart("Sheet1", "A1:D6", { type });
      expect(c.type).toBe(type);
      expect(s.chartData("Sheet1", c.id).series.length).toBeGreaterThan(0);
    }
    expect(s.insertChart("Sheet1", "A1:D6", { type: "bubble" }).series[0]).toMatchObject({ size: "Sheet1!$C$2:$C$6" });
    const stock = s.insertChart("Sheet1", "A1:D6", { type: "stock" });
    expect(stock.stock).toBe("hlc");
    expect(() => s.insertChart("Sheet1", "A1:B6", { type: "stock" })).toThrow(/at least three/);
    expect(s.insertChart("Sheet1", "A1:D6", { type: "surface" }).view3d).toEqual({ rotX: 15, rotY: 20 });
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelectorAll(".pli-grid-chart").length).toBeGreaterThan(10);
    expect(host.querySelectorAll("svg.pli-chart").length).toBeGreaterThan(10);
  });
});
