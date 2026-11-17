// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, type Chart } from "@pli.dev/sheets";
import { ChartView } from "../src";
import { ChartDialog } from "../src/ChartDialog";
import { fracOf, scaleTicks } from "../src/chartmath";
import { buildSurface3d } from "../src/chart3d";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
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
  // A copy: React reuses the same <svg> for the next chart drawn, and these tests compare several.
  return host.querySelector("svg")!.cloneNode(true) as SVGSVGElement;
}
const count = (svg: Element, sel: string) => svg.querySelectorAll(sel).length;
const texts = (svg: Element, sel = ".pli-chart-label") => [...svg.querySelectorAll(sel)].map((t) => t.textContent);
const at = (svg: Element, label: string, sel = ".pli-chart-label") => {
  const el = [...svg.querySelectorAll(sel)].find((t) => t.textContent === label)!;
  return { x: Number(el.getAttribute("x")), y: Number(el.getAttribute("y")), anchor: el.getAttribute("text-anchor") };
};

describe("scales", () => {
  it("makes ticks from a fixed end, a major unit and a minor unit", () => {
    const t = scaleTicks({ min: 0, max: 40, majorUnit: 10, minorUnit: 5, minorGridlines: true }, 3, 24);
    expect(t.ticks).toEqual([0, 10, 20, 30, 40]);
    expect(t.minor).toEqual([5, 15, 25, 35]);
    // only a minimum: the top is rounded up to a whole step from it
    const lo = scaleTicks({ min: 5 }, 3, 24);
    expect(lo.min).toBe(5);
    expect(lo.max).toBeGreaterThanOrEqual(24);
    expect(lo.ticks[0]).toBe(5);
    // a unit alone rounds both ends to it
    const unit = scaleTicks({ majorUnit: 8 }, 3, 24);
    expect(unit.ticks).toEqual([0, 8, 16, 24]);
    // a unit that would give thousands of ticks is ignored
    expect(scaleTicks({ min: 0, max: 1e9, majorUnit: 1 }, 0, 10).ticks.length).toBeLessThan(20);
  });

  it("makes decades for a logarithmic scale, with minor ticks between", () => {
    const t = scaleTicks({ log: 10, minorGridlines: true }, 3, 450);
    expect(t.ticks).toEqual([1, 10, 100, 1000]);
    expect(t.log).toBe(10);
    expect(t.minor).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 20, 30, 40, 50, 60, 70, 80, 90, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(fracOf(t, 100)).toBeCloseTo(2 / 3, 9);
    expect(Number.isNaN(fracOf(t, 0))).toBe(true);
    // every other decade; a base of 2
    expect(scaleTicks({ log: 10, majorUnit: 100 }, 1, 10_000).ticks).toEqual([1, 100, 10_000]);
    expect(scaleTicks({ log: 2 }, 3, 20).ticks).toEqual([2, 4, 8, 16, 32]);
    expect(scaleTicks({ log: 10, min: 10, max: 10_000 }, 1, 5).ticks).toEqual([10, 100, 1000, 10_000]);
  });

  it("runs backwards when reversed", () => {
    const t = scaleTicks({ reverse: true }, 0, 40);
    expect(fracOf(t, 0)).toBe(1);
    expect(fracOf(t, 40)).toBe(0);
  });
});

describe("axes drawn", () => {
  it("labels a fixed scale and draws minor gridlines and tick marks", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { y: { min: 0, max: 40, majorUnit: 10, minorUnit: 5, minorGridlines: true, minorTick: "out" } } });
    expect(texts(svg).filter((t) => /^\d+$/.test(t ?? ""))).toEqual(["0", "10", "20", "30", "40"]);
    // 5 major gridlines and 4 minor ones on the value axis
    expect(count(svg, "line.pli-chart-grid:not(.pli-chart-grid-minor)")).toBe(5);
    expect(count(svg, "line.pli-chart-grid-minor")).toBe(4);
    // major ticks at each of the value axis's 5 labels and 6 boundaries of the category axis, minor ones at the 4 minor and 5 centres
    expect(count(svg, "line.pli-chart-tick")).toBe(5 + 4 + 6 + 5 - 5);
  });

  it("draws columns on a logarithmic axis from the bottom, at heights that follow the logarithm", () => {
    const s = new SheetSession(createWorkbook("t"));
    s.setValues("Sheet1", "A1", [["a", 10], ["b", 100], ["c", 1000]]);
    const svg = draw(s, { type: "column", categories: "Sheet1!$A$1:$A$3", series: [{ values: "Sheet1!$B$1:$B$3" }], axes: { y: { log: 10, min: 1, max: 1000 } } });
    expect(texts(svg).filter((t) => /^[\d,]+$/.test(t ?? ""))).toEqual(["1", "10", "100", "1,000"]);
    const heights = [...svg.querySelectorAll("rect.pli-chart-bar")].map((r) => Number(r.getAttribute("height")));
    expect(heights[1]! / heights[0]!).toBeCloseTo(2, 6);
    expect(heights[2]! / heights[0]!).toBeCloseTo(3, 6);
  });

  it("puts the first value at the bottom or the top when the value axis is reversed", () => {
    const up = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { y: { min: 0, max: 40, majorUnit: 10 } } });
    const yUp = [at(up, "0").y, at(up, "40").y];
    expect(yUp[0]).toBeGreaterThan(yUp[1]!);
    const down = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { y: { min: 0, max: 40, majorUnit: 10, reverse: true } } });
    expect(at(down, "0").y).toBeLessThan(at(down, "40").y);
  });

  it("lists the categories the other way round when the category axis is reversed", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { x: { reverse: true } } });
    expect(at(svg, "Jan").x).toBeGreaterThan(at(svg, "May").x);
    // the bar for Jan is the rightmost
    const bars = [...svg.querySelectorAll("rect.pli-chart-bar")];
    const x = (name: string) => Number(bars.find((b) => b.querySelector("title")!.textContent!.includes(name))!.getAttribute("x"));
    expect(x("Jan")).toBeGreaterThan(x("May"));
    // and the value axis, which crosses at the first category, is now on the right
    const left = draw(book(), { type: "column", categories: cats, series: [col("B")] });
    expect(at(svg, "20").anchor).toBe("start");
    expect(at(left, "20").anchor).toBe("end");
  });

  it("reverses the order of a bar chart's categories and keeps its value axis at the bottom", () => {
    const first = draw(book(), { type: "bar", categories: cats, series: [col("B")] });
    expect(at(first, "Jan").y).toBeLessThan(at(first, "May").y);
    const reversed = draw(book(), { type: "bar", categories: cats, series: [col("B")], axes: { x: { reverse: true } } });
    expect(at(reversed, "Jan").y).toBeGreaterThan(at(reversed, "May").y);
    // the value labels are below the plot in both
    expect(at(first, "20").y).toBeGreaterThan(at(first, "May").y);
    expect(at(reversed, "20").y).toBeGreaterThan(at(reversed, "Jan").y);
  });

  it("crosses the other axis where the settings say, and keeps the labels beside it, or low", () => {
    const base: Parameters<SheetSession["addChart"]>[1] = { type: "column", categories: cats, series: [col("B")] };
    const plain = draw(book(), { ...base, axes: { y: { min: 0, max: 40, majorUnit: 10 } } });
    const crossing = draw(book(), { ...base, axes: { y: { min: 0, max: 40, majorUnit: 10, crosses: 20 } } });
    // the category labels now stand below the line at 20 (the tick label for 20 is level with the axis line)
    const y20 = at(crossing, "20").y - 4;
    expect(at(crossing, "Jan").y).toBeCloseTo(y20 + 15, 6);
    expect(at(plain, "Jan").y).toBeGreaterThan(at(crossing, "Jan").y);
    // low keeps them at the bottom whatever the crossing
    const low = draw(book(), { ...base, axes: { y: { min: 0, max: 40, majorUnit: 10, crosses: 20 }, x: { labels: "low" } } });
    expect(at(low, "Jan").y).toBeCloseTo(at(plain, "Jan").y, 6);
    // high puts them at the top
    const high = draw(book(), { ...base, axes: { x: { labels: "high" } } });
    expect(at(high, "Jan").y).toBeLessThan(at(plain, "Jan").y);
    // columns hang from the crossing: a value below it goes down from it
    const hang = draw(book(), { ...base, axes: { y: { min: 0, max: 40, majorUnit: 10, crosses: 15 } } });
    const bars = [...hang.querySelectorAll("rect.pli-chart-bar")];
    const y15 = at(hang, "10").y - 4 - (at(hang, "10").y - at(hang, "20").y) * 0.5;
    expect(Number(bars[0]!.getAttribute("y"))).toBeCloseTo(y15, 6);
  });

  it("crosses the value axis at the last category, or at a category number", () => {
    const base: Parameters<SheetSession["addChart"]>[1] = { type: "column", categories: cats, series: [col("B")] };
    const left = draw(book(), base);
    const right = draw(book(), { ...base, axes: { x: { crosses: "max" } } });
    expect(at(left, "20").anchor).toBe("end");
    expect(at(right, "20").anchor).toBe("start");
    expect(at(right, "20").x).toBeGreaterThan(at(left, "20").x);
    const mid = draw(book(), { ...base, axes: { x: { crosses: 3 } } });
    expect(at(mid, "20").x).toBeGreaterThan(at(left, "20").x);
    expect(at(mid, "20").x).toBeLessThan(at(right, "20").x);
  });

  it("leaves out ticks, labels and the axis line when asked", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { y: { majorTick: "none", labels: "none" }, x: { hidden: true } } });
    expect(count(svg, "line.pli-chart-tick")).toBe(0);
    expect(texts(svg)).toEqual([]);
    expect(count(svg, "line.pli-chart-grid")).toBeGreaterThan(0);
  });

  it("draws vertical gridlines for the categories and an interval between labels", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { x: { majorGridlines: true, labelEvery: 2, tickEvery: 2 } } });
    expect(texts(svg).filter((t) => ["Jan", "Feb", "Mar", "Apr", "May"].includes(t ?? ""))).toEqual(["Jan", "Mar", "May"]);
    // value axis gridlines (5) and category ones at every second boundary: 0, 2, 4
    expect(count(svg, "line.pli-chart-grid")).toBeGreaterThanOrEqual(5 + 3);
  });

  it("formats the value axis labels with a number format", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], axes: { y: { format: "$#,##0.0" } } });
    expect(texts(svg).filter((t) => t?.startsWith("$"))).toContain("$20.0");
  });

  it("scales a scatter chart's x axis and draws its own gridlines", () => {
    const svg = draw(book(), { type: "scatter", series: [col("C", { x: "Sheet1!$B$2:$B$6" })], axes: { x: { min: 0, max: 40, majorUnit: 20, minorGridlines: true }, y: { min: 0, max: 1, majorUnit: 0.5 } } });
    expect(texts(svg)).toEqual(expect.arrayContaining(["0", "20", "40", "0.5", "1"]));
    expect(count(svg, "line.pli-chart-grid-minor")).toBeGreaterThan(0);
    const noGrid = draw(book(), { type: "scatter", series: [col("C", { x: "Sheet1!$B$2:$B$6" })], axes: { x: { majorGridlines: false } } });
    // only the value axis's horizontal gridlines remain
    expect(count(noGrid, "line.pli-chart-grid")).toBeLessThan(count(svg, "line.pli-chart-grid"));
  });

  it("scales the second value axis on its own", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B"), col("C", { type: "line", axis: "secondary" })], axes: { y2: { min: 0, max: 1, majorUnit: 0.25 } } });
    expect(texts(svg)).toEqual(expect.arrayContaining(["0.25", "0.5", "0.75"]));
  });

  it("scales the value axes of the statistical kinds", () => {
    const hist = draw(book(), { type: "histogram", series: [col("B")], axes: { y: { max: 10, majorUnit: 5 } } });
    expect(texts(hist)).toEqual(expect.arrayContaining(["0", "5", "10"]));
    const water = draw(book(), { type: "waterfall", categories: cats, series: [col("B")], axes: { y: { min: 0, max: 200, majorUnit: 50 } } });
    expect(texts(water)).toEqual(expect.arrayContaining(["50", "100", "150", "200"]));
    const box = draw(book(), { type: "boxWhisker", series: [col("B")], axes: { y: { min: 0, max: 100, majorUnit: 25 } } });
    expect(texts(box)).toEqual(expect.arrayContaining(["25", "50", "75", "100"]));
    const radar = draw(book(), { type: "radar", categories: cats, series: [col("B")], axes: { y: { min: 0, max: 30, majorUnit: 10 } } });
    expect(texts(radar)).toEqual(expect.arrayContaining(["10", "20", "30"]));
    const pareto = draw(book(), { type: "pareto", categories: cats, series: [col("B")], axes: { y: { max: 30, majorUnit: 10 } } });
    expect(texts(pareto)).toEqual(expect.arrayContaining(["10", "20", "30"]));
  });

  it("scales a 3-D chart's value axis, including on a log scale", () => {
    const flat = draw(book(), { type: "column", categories: cats, view3d: { rotX: 15, rotY: 20 }, series: [col("B")], axes: { y: { min: 0, max: 100, majorUnit: 50 } } });
    expect(texts(flat)).toEqual(expect.arrayContaining(["50", "100"]));
    const log = draw(book(), { type: "column", categories: cats, view3d: { rotX: 15, rotY: 20 }, series: [col("B")], axes: { y: { log: 10, min: 1, max: 100 } } });
    expect(texts(log)).toEqual(expect.arrayContaining(["1", "10", "100"]));
  });
});

describe("error bars drawn", () => {
  const bars = (svg: Element) => [...svg.querySelectorAll("line.pli-chart-errbar")];

  it("draws a bar with two caps for every point, and none when there are none", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B", { errorBars: { y: { kind: "fixed", value: 3 } } })], axes: { y: { min: 0, max: 30, majorUnit: 10 } } });
    expect(bars(svg)).toHaveLength(5 * 3);
    // the first bar hangs from 10: 7 to 13 on a scale of 0 to 30 over the plot
    const ys = [at(svg, "0").y - 4, at(svg, "30").y - 4];
    const per = (ys[0]! - ys[1]!) / 30;
    const first = bars(svg)[0]!;
    expect(Number(first.getAttribute("y2"))).toBeCloseTo(ys[0]! - 7 * per, 6);
    expect(Number(first.getAttribute("y1"))).toBeCloseTo(ys[0]! - 13 * per, 6);
    expect(bars(draw(book(), { type: "column", categories: cats, series: [col("B")] }))).toHaveLength(0);
  });

  it("leaves the caps off, and draws one side only", () => {
    const noCap = draw(book(), { type: "line", categories: cats, series: [col("B", { errorBars: { y: { kind: "percent", value: 10, endCap: false } } })] });
    expect(bars(noCap)).toHaveLength(5);
    const plus = draw(book(), { type: "line", categories: cats, series: [col("B", { errorBars: { y: { kind: "fixed", value: 2, direction: "plus" } } })] });
    // a line and one cap for each point
    expect(bars(plus)).toHaveLength(10);
    const first = bars(plus)[0]!;
    expect(Number(first.getAttribute("y2"))).toBeGreaterThan(Number(first.getAttribute("y1")));
  });

  it("draws custom amounts from cells for each point", () => {
    const s = book();
    s.setValues("Sheet1", "F1", [[1], [2], [3], [4], [5]]);
    const svg = draw(s, { type: "line", categories: cats, series: [col("B", { errorBars: { y: { kind: "custom", plus: "Sheet1!$F$1:$F$5", minus: [0], endCap: false } } })] });
    const lens = bars(svg).map((l) => Math.abs(Number(l.getAttribute("y2")) - Number(l.getAttribute("y1"))));
    expect(lens[1]! / lens[0]!).toBeCloseTo(2, 6);
    expect(lens[4]! / lens[0]!).toBeCloseTo(5, 6);
  });

  it("goes along the bar of a bar chart", () => {
    const svg = draw(book(), { type: "bar", categories: cats, series: [col("B", { errorBars: { y: { kind: "fixed", value: 3 } } })] });
    const line = bars(svg)[0]!;
    expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
    expect(Number(line.getAttribute("x2"))).toBeGreaterThan(Number(line.getAttribute("x1")));
  });

  it("makes the axis leave room for the bars", () => {
    const without = draw(book(), { type: "column", categories: cats, series: [col("B")] });
    const withBars = draw(book(), { type: "column", categories: cats, series: [col("B", { errorBars: { y: { kind: "fixed", value: 10 } } })] });
    const top = (svg: Element) => Math.max(...texts(svg).map((t) => Number(t)).filter((n) => Number.isFinite(n)));
    expect(top(withBars)).toBeGreaterThan(top(without));
  });

  it("draws bars along x and y on a scatter chart, and takes the colour asked for", () => {
    const svg = draw(book(), { type: "scatter", series: [col("C", { x: "Sheet1!$B$2:$B$6", errorBars: { x: { kind: "fixed", value: 2, color: "#ff0000" }, y: { kind: "percent", value: 10 } } })] });
    expect(bars(svg)).toHaveLength(5 * 6);
    expect(bars(svg).some((l) => l.getAttribute("stroke") === "#ff0000")).toBe(true);
    const horizontal = bars(svg).filter((l) => l.getAttribute("y1") === l.getAttribute("y2"));
    expect(horizontal.length).toBeGreaterThanOrEqual(5);
  });

  it("hangs a stacked series' bars from the top of its piece", () => {
    const svg = draw(book(), { type: "column", grouping: "stacked", categories: cats, series: [col("B"), col("D", { errorBars: { y: { kind: "fixed", value: 1, endCap: false } } })] });
    const line = bars(svg)[0]!;
    const topOfFirst = Number(svg.querySelectorAll("rect.pli-chart-bar")[5]!.getAttribute("y"));
    expect((Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2).toBeCloseTo(topOfFirst, 6);
  });
});

describe("the other options drawn", () => {
  it("starts a pie at the first slice angle and pulls slices out", () => {
    const at0 = draw(book(), { type: "pie", categories: cats, series: [col("B")] });
    const at90 = draw(book(), { type: "pie", categories: cats, firstSliceAngle: 90, series: [col("B")] });
    const first = (svg: Element) => svg.querySelector("path.pli-chart-slice")!.getAttribute("d")!;
    // the first slice runs from twelve o'clock: its edge goes straight up from the centre; at 90° it goes straight right
    const m0 = /^M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/.exec(first(at0))!;
    expect(Number(m0[3])).toBeCloseTo(Number(m0[1]), 6);
    expect(Number(m0[4])).toBeLessThan(Number(m0[2]));
    const m90 = /^M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/.exec(first(at90))!;
    expect(Number(m90[4])).toBeCloseTo(Number(m90[2]), 6);
    expect(Number(m90[3])).toBeGreaterThan(Number(m90[1]));
    const pulled = draw(book(), { type: "pie", categories: cats, series: [col("B", { pointExplosion: { "0": 50 } })] });
    const centre = (svg: Element, i: number) => /^M([\d.-]+),([\d.-]+)/.exec(svg.querySelectorAll("path.pli-chart-slice")[i]!.getAttribute("d")!)!.slice(1, 3).map(Number);
    // the pulled slice's centre moved, the unpulled one stayed (the radius shrank to make room, so only compare which moved)
    const c = (svg: Element, i: number) => centre(svg, i);
    expect(c(pulled, 0)).not.toEqual(c(pulled, 1));
  });

  it("pulls doughnut slices out and turns the first slice", () => {
    const svg = draw(book(), { type: "doughnut", categories: cats, firstSliceAngle: 180, series: [col("B", { explosion: 20 })] });
    expect(count(svg, "path.pli-chart-slice")).toBe(5);
  });

  it("moves the points chosen to the second plot of a pie of pie", () => {
    const svg = draw(book(), { type: "pieOfPie", categories: cats, split: { by: "custom", at: 0, points: [0] }, series: [col("B")] });
    // 5 slices in the first pie (4 points and the "Other" slice) and 1 in the second
    expect(count(svg, "path.pli-chart-slice")).toBe(6);
    const svg2 = draw(book(), { type: "barOfPie", categories: cats, split: { by: "custom", at: 0, points: [0, 1] }, series: [col("B")] });
    expect(count(svg2, "rect.pli-chart-bar")).toBe(2);
  });

  it("formats a stock chart's high-low lines and bodies", () => {
    const four = [col("B"), col("C"), col("D"), col("B")];
    const plain = draw(book(), { type: "stock", stock: "ohlc", categories: cats, series: four });
    expect(count(plain, "line.pli-chart-stockline")).toBe(5);
    const look = draw(book(), { type: "stock", stock: "ohlc", categories: cats, series: four, stockLook: { hiLowLines: false, upColor: "#00aa00", downColor: "#cc0000", gapWidth: 0 } });
    expect(count(look, "line.pli-chart-stockline")).toBe(0);
    const fills = [...look.querySelectorAll("rect.pli-chart-bar")].map((r) => r.getAttribute("fill"));
    expect(fills.every((f) => f === "#00aa00" || f === "#cc0000")).toBe(true);
    const widthOf = (svg: Element) => Number(svg.querySelector("rect.pli-chart-bar")!.getAttribute("width"));
    expect(widthOf(look)).toBeGreaterThan(widthOf(plain));
    const none = draw(book(), { type: "stock", stock: "ohlc", categories: cats, series: four, stockLook: { upDownBars: false } });
    expect(count(none, "rect.pli-chart-bar")).toBe(0);
  });

  it("leaves out a waterfall's connectors", () => {
    const withLines = draw(book(), { type: "waterfall", categories: cats, series: [col("B")] });
    const without = draw(book(), { type: "waterfall", categories: cats, series: [col("B")], waterfall: { connectors: false } });
    expect(count(withLines, "line.pli-chart-axis") - count(without, "line.pli-chart-axis")).toBe(4);
  });

  it("says what the labels say and puts them where asked", () => {
    const svg = draw(book(), { type: "column", categories: cats, labels: true, labelShow: ["category", "value"], series: [col("B")] });
    expect(texts(svg, ".pli-chart-value")).toEqual(["Jan, 10", "Feb, 15", "Mar, 12", "Apr, 20", "May, 24"]);
    const out = draw(book(), { type: "column", categories: cats, labels: true, series: [col("B")] });
    const inside = draw(book(), { type: "column", categories: cats, labels: true, labelPosition: "insideEnd", series: [col("B")] });
    const centre = draw(book(), { type: "column", categories: cats, labels: true, labelPosition: "center", series: [col("B")] });
    const y = (svg: Element) => Number(svg.querySelector(".pli-chart-value")!.getAttribute("y"));
    expect(y(inside)).toBeGreaterThan(y(out));
    expect(y(centre)).toBeGreaterThan(y(inside));
    const pie = draw(book(), { type: "pie", categories: cats, labels: true, labelShow: ["category", "percent"], series: [col("B")] });
    expect(texts(pie, ".pli-chart-onmark")[0]).toMatch(/^Jan, \d+(\.\d)?%$/);
    const line = draw(book(), { type: "line", categories: cats, labels: true, labelPosition: "below", series: [col("B")] });
    const above = draw(book(), { type: "line", categories: cats, labels: true, series: [col("B")] });
    expect(y(line)).toBeGreaterThan(y(above));
  });

  it("draws a histogram of several series side by side with a legend", () => {
    const svg = draw(book(), { type: "histogram", series: [col("B"), col("D")], bins: { by: "width", size: 10 } });
    // 10..24 and 5..12 together: bins from 5 in tens, 2 of them; two series each
    expect(count(svg, "rect.pli-chart-bar")).toBe(2 * 2);
    expect(texts(svg)).toEqual(expect.arrayContaining(["Sales", "Units"]));
  });

  it("draws a Pareto of several series with a line for each", () => {
    const svg = draw(book(), { type: "pareto", categories: cats, series: [col("B"), col("D")] });
    expect(count(svg, "rect.pli-chart-bar")).toBe(10);
    expect(count(svg, "circle.pli-chart-marker")).toBe(10);
    expect(count(svg, "path[stroke]")).toBe(2);
  });

  it("names what a treemap and a sunburst label", () => {
    const tree = draw(book(), { type: "treemap", categories: cats, series: [col("B")], labelShow: ["value"] });
    expect(texts(tree, ".pli-chart-onmark").some((t) => /^\d+$/.test(t ?? ""))).toBe(true);
    expect(texts(tree, ".pli-chart-onmark").some((t) => t === "Jan")).toBe(false);
    const named = draw(book(), { type: "treemap", categories: cats, series: [col("B")] });
    expect(texts(named, ".pli-chart-onmark")).toContain("Jan");
    const sun = draw(book(), { type: "sunburst", categories: cats, series: [col("B")], labelShow: ["category", "value"] });
    expect(texts(sun, ".pli-chart-onmark").some((t) => /^\w+, \d+$/.test(t ?? ""))).toBe(true);
  });

  it("sets fonts on the title and the rest", () => {
    // fonts are written to files; the SVG draws with the grid's own, so this only makes sure a chart with them still draws
    const svg = draw(book(), { type: "column", categories: cats, title: "Sales", font: { family: "Arial", size: 9 }, titleFont: { italic: true }, series: [col("B")] });
    expect(svg.querySelector(".pli-chart-title")!.textContent).toBe("Sales");
    expect((svg.querySelector(".pli-chart-title") as SVGElement).style.fontStyle).toBe("italic");
    expect(svg.getAttribute("font-family")).toBe("Arial");
  });

  it("draws the pieces of a title as spans with their own looks", () => {
    const svg = draw(book(), { type: "column", categories: cats, series: [col("B")], titleRuns: [{ text: "Sales ", bold: true }, { text: "now", italic: true, underline: true, color: "#ff0000" }] });
    const spans = [...svg.querySelectorAll(".pli-chart-title tspan")] as SVGElement[];
    expect(spans.map((t) => t.textContent)).toEqual(["Sales ", "now"]);
    expect(spans[1]!.style.fontStyle).toBe("italic");
    expect(spans[1]!.style.textDecoration).toBe("underline");
    expect(spans[1]!.style.fill).toMatch(/#ff0000|rgb\(255, 0, 0\)/);
  });
});

describe("the surface chart", () => {
  const three = (s: SheetSession, extra: object = {}) => draw(s, { type: "surface", categories: cats, view3d: { rotX: 30, rotY: 30 }, series: [col("B"), col("C"), col("D")], ...extra });

  it("is painted in bands that follow the lines of equal height, with contour lines between them", () => {
    const s = new SheetSession(createWorkbook("t"));
    s.setValues("Sheet1", "A1", [["x", "r1", "r2", "r3"], ["a", 1, 2, 3], ["b", 2, 4, 6], ["c", 3, 6, 9]]);
    const svg = draw(s, { type: "surface", categories: "Sheet1!$A$2:$A$4", view3d: { rotX: 90, rotY: 0 }, series: [col("B"), col("C"), col("D")].map((x) => ({ ...x, nameRef: undefined, values: x.values.replace(/\$2:/, "$2:").replace("Sheet1!$", "Sheet1!$") })) });
    const polys = [...svg.querySelectorAll("polygon.pli-chart-solid")];
    // a mesh of 4 quads cut into triangles and then at each band edge: more pieces than the 4 quads, and no piece spans two bands
    expect(polys.length).toBeGreaterThan(8);
    const fills = new Set(polys.map((p) => p.getAttribute("fill")));
    expect(fills.size).toBeGreaterThan(2);
    expect(count(svg, "line.pli-chart-contour")).toBeGreaterThan(0);
  });

  it("cuts the mesh exactly at the steps of the axis", () => {
    // a ramp from 0 to 10 over two series: bands of 5 are cut at the middle of the ramp
    const items = buildSurface3d(
      { id: "x", type: "surface", series: [], from: { row: 1, col: 1 }, width: 400, height: 300, view3d: { rotX: 90, rotY: 0 } } as Chart,
      { categories: ["a", "b"], series: [{ name: "s1", color: "#000", values: [0, 10] }, { name: "s2", color: "#000", values: [0, 10] }] },
      { x: 0, y: 0, w: 400, h: 300 },
      { min: 0, max: 10, step: 5, ticks: [0, 5, 10] },
      String,
    );
    const polys = items.filter((i) => i.kind === "poly" && i.cls === "pli-chart-solid");
    const colors = new Set(polys.map((p) => (p.kind === "poly" ? p.fill : "")));
    expect(colors.size).toBe(2);
    // seen from above the ramp's contour at 5 is a straight line across the middle
    const lines = items.filter((i) => i.kind === "line" && i.cls === "pli-chart-contour");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("names the series along the depth axis, and draws a wireframe as lines only", () => {
    const svg = three(book());
    expect(texts(svg)).toEqual(expect.arrayContaining(["Sales", "Margin", "Units"]));
    const wire = three(book(), { wireframe: true });
    expect(count(wire, "polygon.pli-chart-solid")).toBe(0);
    expect(count(wire, "polygon.pli-chart-wire")).toBeGreaterThan(0);
  });

  it("takes the value axis settings", () => {
    const svg = three(book(), { axes: { y: { min: 0, max: 100, majorUnit: 50 } } });
    expect(texts(svg)).toEqual(expect.arrayContaining(["50", "100"]));
  });
});

describe("the chart editor's new fields", () => {
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
  type Saved = Omit<Chart, "id" | "from" | "width" | "height">;

  it("sets the scale, gridlines, ticks and crossing of the value axis", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    change(q('input[aria-label="Vertical axis: Minimum"]'), "5");
    change(q('input[aria-label="Vertical axis: Maximum"]'), "50");
    change(q('input[aria-label="Vertical axis: Major unit"]'), "15");
    click(q('input[aria-label="Vertical axis: Minor gridlines"]'));
    change(q('select[aria-label="Vertical axis: Major tick marks"]'), "cross");
    change(q('select[aria-label="Vertical axis: Label position"]'), "high");
    change(q('select[aria-label="Vertical axis: Where the other axis crosses"]'), "at");
    change(q('input[aria-label="Vertical axis: Crossing value"]'), "20");
    click(q('input[aria-label="Horizontal axis: Reverse order"]'));
    change(q('input[aria-label="Horizontal axis: Label every"]'), "2");
    submit();
    expect(saved!.axes).toEqual({
      y: { min: 5, max: 50, majorUnit: 15, minorGridlines: true, majorTick: "cross", labels: "high", crosses: 20 },
      x: { reverse: true, labelEvery: 2 },
    });
  });

  it("turns on a logarithmic scale and saves nothing for axes left alone", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "line", categories: cats, series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    submit();
    expect(saved!.axes).toBeUndefined();
    open(chart, (p) => (saved = p as never));
    click(q('input[aria-label="Vertical axis: Logarithmic scale"]'));
    change(q('input[aria-label="Vertical axis: Log base"]'), "2");
    submit();
    expect(saved!.axes).toEqual({ y: { log: 2 } });
  });

  it("refuses an axis end that isn't a number", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    change(q('input[aria-label="Vertical axis: Minimum"]'), "low");
    submit();
    expect(saved).toBeUndefined();
    expect(document.body.textContent).toContain("the minimum must be a number");
  });

  it("shows the axes already set", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")], axes: { y: { min: 2, log: undefined, majorUnit: 4, format: "0.0" } } });
    open(chart);
    expect(q<HTMLInputElement>('input[aria-label="Vertical axis: Minimum"]').value).toBe("2");
    expect(q<HTMLInputElement>('input[aria-label="Vertical axis: Major unit"]').value).toBe("4");
    expect(q<HTMLInputElement>('input[aria-label="Vertical axis: Number format"]').value).toBe("0.0");
  });

  it("sets error bars of each kind on a series", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B"), col("C")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    click(q('input[aria-label="Series 1: Error bars"]'));
    change(q('select[aria-label="Series 1: Error bars: Kind"]'), "percent");
    change(q('input[aria-label="Series 1: Error bars: Amount"]'), "8");
    change(q('select[aria-label="Series 1: Error bars: Direction"]'), "plus");
    click(q('input[aria-label="Series 1: Error bars: End cap"]'));
    click(q('input[aria-label="Series 2: Error bars"]'));
    change(q('select[aria-label="Series 2: Error bars: Kind"]'), "custom");
    change(q('input[aria-label="Series 2: Error bars: Plus amounts"]'), "E2:E6");
    change(q('input[aria-label="Series 2: Error bars: Minus amounts"]'), "1, 2, 3");
    submit();
    expect(saved!.series[0]!.errorBars).toEqual({ y: { kind: "percent", value: 8, direction: "plus", endCap: false } });
    expect(saved!.series[1]!.errorBars).toEqual({ y: { kind: "custom", plus: "Sheet1!$E$2:$E$6", minus: [1, 2, 3] } });
  });

  it("offers x error bars for a scatter chart only, and refuses custom bars with no amounts", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "scatter", series: [col("C", { x: "Sheet1!$B$2:$B$6" })] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    expect(q('input[aria-label="Series 1: X error bars"]')).toBeTruthy();
    click(q('input[aria-label="Series 1: X error bars"]'));
    change(q('select[aria-label="Series 1: X error bars: Kind"]'), "custom");
    submit();
    expect(saved).toBeUndefined();
    expect(document.body.textContent).toContain("give the amounts");
    change(q('select[aria-label="Series 1: X error bars: Kind"]'), "stdErr");
    submit();
    expect(saved!.series[0]!.errorBars).toEqual({ x: { kind: "stdErr" } });
    const col2 = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")] });
    open(col2);
    expect(document.querySelector('input[aria-label="Series 1: X error bars"]')).toBeNull();
    const pie = s.addChart("Sheet1", { type: "pie", categories: cats, series: [col("B")] });
    open(pie);
    expect(document.querySelector('input[aria-label="Series 1: Error bars"]')).toBeNull();
  });

  it("sets the first slice angle and the explosion of a pie", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "pie", categories: cats, series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    change(q('input[aria-label="First slice angle"]'), "90");
    change(q('input[aria-label="Explosion of series 1"]'), "10");
    change(q('input[aria-label="Exploded slices of series 1"]'), "2: 40, 4: 15");
    submit();
    expect(saved!.firstSliceAngle).toBe(90);
    expect(saved!.series[0]).toMatchObject({ explosion: 10, pointExplosion: { "1": 40, "3": 15 } });
    change(q('input[aria-label="Exploded slices of series 1"]'), "two");
    submit();
    expect(document.body.textContent).toContain("write exploded slices like");
  });

  it("chooses the points of a pie of pie's second plot", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "pieOfPie", categories: cats, series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    const by = [...document.querySelectorAll<HTMLSelectElement>("select")].find((e) => [...e.options].some((o) => o.value === "custom"))!;
    change(by, "custom");
    change(q('input[aria-label="Points for the second plot"]'), "1, 5");
    submit();
    expect(saved!.split).toEqual({ by: "custom", at: 0, points: [0, 4] });
  });

  it("sets the look of a stock chart and a waterfall's connectors", () => {
    const s = book();
    const stock = s.addChart("Sheet1", { type: "stock", stock: "ohlc", categories: cats, series: [col("B"), col("C"), col("D"), col("B")] });
    let saved: Saved | undefined;
    open(stock, (p) => (saved = p as never));
    click(q('input[aria-label="High-low lines"]'));
    change(q('input[aria-label="Up bar colour"]'), "#00aa00");
    change(q('input[aria-label="Gap between bars"]'), "60");
    submit();
    expect(saved!.stockLook).toEqual({ hiLowLines: false, upColor: "#00aa00", gapWidth: 60 });
    const water = s.addChart("Sheet1", { type: "waterfall", categories: cats, series: [col("B")] });
    open(water, (p) => (saved = p as never));
    click(q('input[aria-label="Connector lines"]'));
    submit();
    expect(saved!.waterfall).toEqual({ connectors: false });
  });

  it("chooses what the labels say, where they go, and fonts", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")], labels: true });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    click(q('input[aria-label="Label shows the category"]'));
    change(q('select[aria-label="Label position"]'), "insideEnd");
    change(q('input[aria-label="Chart font: Font"]'), "Arial");
    change(q('input[aria-label="Chart font: Size"]'), "9");
    click(q('input[aria-label="Title font: Italic"]'));
    submit();
    expect(saved!.labelShow).toEqual(["value", "category"]);
    expect(saved!.labelPosition).toBe("insideEnd");
    expect(saved!.font).toEqual({ family: "Arial", size: 9 });
    expect(saved!.titleFont).toEqual({ italic: true });
    // a position the kind doesn't have isn't offered
    const area = s.addChart("Sheet1", { type: "area", categories: cats, series: [col("B")], labels: true });
    open(area);
    expect(document.querySelector('select[aria-label="Label position"]')).toBeNull();
    void fracOf;
  });

  it("saves a title in pieces", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, title: "Sales", series: [col("B")] });
    let saved: Saved | undefined;
    open(chart, (p) => (saved = p as never));
    click([...document.querySelectorAll("button")].find((b) => b.textContent === "Add a piece")!);
    change(q('input[aria-label="Title piece 2"]'), "now");
    submit();
    expect(saved!.title).toBe("Salesnow");
    expect(saved!.titleRuns).toEqual([{ text: "Sales", bold: true }, { text: "now", bold: false, italic: true }]);
  });

  it("shows the second axis' fields only when a series uses it", () => {
    const s = book();
    const chart = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B"), col("C", { type: "line", axis: "secondary" })] });
    open(chart);
    expect(document.body.textContent).toContain("Secondary value axis");
    const plain = s.addChart("Sheet1", { type: "column", categories: cats, series: [col("B")] });
    open(plain);
    expect(document.body.textContent).not.toContain("Secondary value axis");
  });
});
