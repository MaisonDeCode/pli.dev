import { describe, expect, it } from "vitest";
import { LIGHT_THEME, chartScene, defaultSeriesColor, formatNumber, niceScale, sampleChartData, sectorPath, stackValues, type ChartElement, type ChartItem } from "../src";

const theme = LIGHT_THEME;
const make = (extra: Partial<ChartElement> = {}): ChartElement => ({
  type: "chart",
  id: "c1",
  chartType: "column",
  categories: ["North", "South", "East"],
  series: [
    { name: "2024", values: [4, 6, 3] },
    { name: "2025", values: [5, 2, 7] },
  ],
  ...extra,
});
const parts = (items: ChartItem[], part: string) => items.filter((i) => i.part === part);
const texts = (items: ChartItem[], part: string) => items.flatMap((i) => (i.kind === "text" && i.part === part ? [i.text] : []));

describe("formatNumber", () => {
  it("shows General numbers plainly and rounds float noise", () => {
    expect(formatNumber(4.4000000000000004)).toBe("4.4");
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(0.1 + 0.2, "General")).toBe("0.3");
  });
  it("applies decimals, thousands separators, percents, prefixes and literals", () => {
    expect(formatNumber(1234.5, "0.0")).toBe("1234.5");
    expect(formatNumber(1234.5, "#,##0")).toBe("1,235");
    expect(formatNumber(1234567.891, "#,##0.00")).toBe("1,234,567.89");
    expect(formatNumber(0.256, "0%")).toBe("26%");
    expect(formatNumber(0.256, "0.0%")).toBe("25.6%");
    expect(formatNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(formatNumber(3, '0.0"x"')).toBe("3.0x");
    expect(formatNumber(2.5, "0.##")).toBe("2.5");
    expect(formatNumber(2, "0.##")).toBe("2");
    expect(formatNumber(5, "00")).toBe("05");
  });
  it("uses the second section for negative numbers", () => {
    expect(formatNumber(-5, "0;(0)")).toBe("(5)");
    expect(formatNumber(-5, "0")).toBe("-5");
  });
});

describe("niceScale", () => {
  it("picks round steps with headroom above the data", () => {
    const s = niceScale(0, 5, 5);
    expect(s).toMatchObject({ min: 0, max: 6, step: 1 });
    expect(s.ticks).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(niceScale(0, 90, 5)).toMatchObject({ min: 0, max: 100, step: 20 });
    expect(niceScale(0, 0.83, 5)).toMatchObject({ min: 0, max: 1, step: 0.2 });
  });
  it("covers negative data and honours fixed limits", () => {
    expect(niceScale(-30, 70, 5)).toMatchObject({ min: -40, max: 80 });
    expect(niceScale(0, 10, 5, { min: 2, max: 8 })).toMatchObject({ min: 2, max: 8 });
    expect(niceScale(0, 10, 5, { majorUnit: 5 }).ticks).toEqual([0, 5, 10, 15]);
    expect(niceScale(5, 5, 5).max).toBeGreaterThan(niceScale(5, 5, 5).min);
  });
});

describe("stackValues", () => {
  it("piles positives up and negatives down, and scales to 100%", () => {
    expect(stackValues([[1, -2], [2, -1]], false)).toEqual([[[0, 1], [0, -2]], [[1, 3], [-2, -3]]]);
    const p = stackValues([[1], [3]], true);
    expect(p[0]![0]).toEqual([0, 0.25]);
    expect(p[1]![0]![1]).toBeCloseTo(1);
  });
});

describe("chartScene: columns", () => {
  const scene = chartScene(make(), 400, 300, theme);
  const bars = parts(scene.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];

  it("is deterministic", () => {
    expect(JSON.stringify(chartScene(make(), 400, 300, theme))).toBe(JSON.stringify(scene));
  });

  it("draws one bar per value, in the theme's accent colours, side by side within each category", () => {
    expect(bars).toHaveLength(6);
    expect(bars.find((b) => b.series === 0)!.fill!.color).toBe(theme.colors.accent1);
    expect(bars.find((b) => b.series === 1)!.fill!.color).toBe(theme.colors.accent2);
    const north = bars.filter((b) => b.point === 0);
    expect(north[0]!.x + north[0]!.w).toBeLessThanOrEqual(north[1]!.x + 1e-9);
    // 6 is the tallest value of the first series; its bar is taller than the 4
    const tall = bars.find((b) => b.series === 0 && b.point === 1)!;
    const short = bars.find((b) => b.series === 0 && b.point === 0)!;
    expect(tall.h).toBeGreaterThan(short.h);
    expect(tall.h / short.h).toBeCloseTo(1.5, 5);
    // every bar sits on the same baseline, inside the plot
    const base = bars[0]!.y + bars[0]!.h;
    for (const b of bars) {
      expect(b.y + b.h).toBeCloseTo(base, 5);
      expect(b.x).toBeGreaterThanOrEqual(scene.plot.x - 1e-9);
      expect(b.x + b.w).toBeLessThanOrEqual(scene.plot.x + scene.plot.w + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(scene.plot.y - 1e-9);
    }
  });

  it("labels the axes: category names and round value steps, with a legend for several series", () => {
    expect(texts(scene.items, "category-label")).toEqual(["North", "South", "East"]);
    expect(texts(scene.items, "tick-label")).toEqual(["0", "2", "4", "6", "8"]);
    expect(scene.legend.map((l) => l.text)).toEqual(["2024", "2025"]);
    expect(parts(scene.items, "gridline").length).toBe(5);
  });

  it("has no legend for one series unless asked, and takes a title", () => {
    const one = chartScene(make({ series: [{ name: "Only", values: [1, 2, 3] }], title: "Sales" }), 400, 300, theme);
    expect(one.legend).toEqual([]);
    expect(texts(one.items, "title")).toEqual(["Sales"]);
    expect(chartScene(make({ series: [{ name: "Only", values: [1, 2, 3] }], legend: "right" }), 400, 300, theme).legend).toHaveLength(1);
    expect(chartScene(make({ legend: "none" }), 400, 300, theme).legend).toEqual([]);
  });

  it("uses a series colour, theme colours with adjustments and gap width", () => {
    const s = chartScene(make({ series: [{ name: "a", values: [1, 2, 3], color: "#ff0000" }, { name: "b", values: [1, 2, 3], color: { theme: "accent1", lumMod: 0.5 } }], gapWidth: 0 }), 400, 300, theme);
    const b = parts(s.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];
    expect(b[0]!.fill!.color).toBe("#ff0000");
    expect(b[1]!.fill!.color).not.toBe(theme.colors.accent1);
    // no gap: the two bars of a group fill the whole band
    const n0 = b.filter((x) => x.point === 0);
    const n1 = b.filter((x) => x.point === 1);
    expect(n1[0]!.x - (n0[1]!.x + n0[1]!.w)).toBeCloseTo(0, 5);
  });

  it("stacks series and scales a 100% stack to the full height", () => {
    const st = chartScene(make({ grouping: "stacked" }), 400, 300, theme);
    const b = parts(st.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];
    const a = b.find((x) => x.series === 0 && x.point === 0)!;
    const c = b.find((x) => x.series === 1 && x.point === 0)!;
    expect(c.y + c.h).toBeCloseTo(a.y, 5);
    expect(c.x).toBeCloseTo(a.x, 5);
    const pct = chartScene(make({ grouping: "percentStacked" }), 400, 300, theme);
    const pb = parts(pct.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];
    const top = pb.filter((x) => x.point === 0).reduce((m, x) => Math.min(m, x.y), Infinity);
    expect(top).toBeCloseTo(pct.plot.y, 3);
    expect(texts(pct.items, "tick-label")).toContain("100%");
  });

  it("draws bars sideways for a bar chart, first category at the bottom", () => {
    const h = chartScene(make({ chartType: "bar" }), 400, 300, theme);
    const b = parts(h.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];
    const first = b.find((x) => x.series === 0 && x.point === 0)!;
    const last = b.find((x) => x.series === 0 && x.point === 2)!;
    expect(first.y).toBeGreaterThan(last.y);
    expect(first.w).toBeGreaterThan(0);
    expect(first.x).toBeCloseTo(b.find((x) => x.series === 0 && x.point === 1)!.x, 5);
    expect(texts(h.items, "tick-label").length).toBeGreaterThan(2);
  });

  it("handles negative values, blanks, hidden axes, fixed limits and titles", () => {
    const n = chartScene(make({ series: [{ name: "s", values: [-3, null, 5] }], valueAxis: { min: -10, max: 10, title: "Units", gridlines: false }, categoryAxis: { hidden: true } }), 400, 300, theme);
    const b = parts(n.items, "bar") as Extract<ChartItem, { kind: "rect" }>[];
    expect(b).toHaveLength(2);
    expect(b[0]!.y).toBeLessThan(b[0]!.y + b[0]!.h);
    expect(parts(n.items, "gridline")).toHaveLength(0);
    expect(texts(n.items, "category-label")).toEqual([]);
    expect(texts(n.items, "axis-title")).toEqual(["Units"]);
    expect(texts(n.items, "tick-label")[0]).toBe("-10");
    // the zero line passes between the negative and the positive bar
    const neg = b.find((x) => x.point === 0)!;
    const pos = b.find((x) => x.point === 2)!;
    expect(neg.y).toBeCloseTo(pos.y + pos.h, 5);
  });

  it("shows data labels with the axis number format, outside the bars or centred when stacked", () => {
    const d = chartScene(make({ dataLabels: { value: true }, valueAxis: { format: "0.0" } }), 400, 300, theme);
    expect(texts(d.items, "data-label")).toEqual(["4.0", "6.0", "3.0", "5.0", "2.0", "7.0"]);
    const bar = (parts(d.items, "bar") as Extract<ChartItem, { kind: "rect" }>[])[0]!;
    const label = d.items.find((i) => i.kind === "text" && i.part === "data-label")!;
    expect(label.kind === "text" && label.y).toBeLessThan(bar.y);
    const s = chartScene(make({ grouping: "stacked", dataLabels: { value: true } }), 400, 300, theme);
    const sb = (parts(s.items, "bar") as Extract<ChartItem, { kind: "rect" }>[])[0]!;
    const sl = s.items.find((i) => i.kind === "text" && i.part === "data-label")!;
    expect(sl.kind === "text" && sl.y).toBeGreaterThan(sb.y);
  });

  it("rotates category labels that don't fit side by side, and thins out the rest", () => {
    const cats = Array.from({ length: 12 }, (_, i) => `Category number ${i + 1}`);
    const wide = chartScene(make({ categories: cats, series: [{ name: "s", values: cats.map((_, i) => i + 1) }] }), 300, 240, theme);
    const labels = wide.items.filter((i) => i.part === "category-label");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.kind === "text" && l.rotate === -45)).toBe(true);
    const text = labels.map((l) => (l.kind === "text" ? l.text : ""));
    expect(text.length).toBeLessThanOrEqual(12);
  });

  it("draws an empty chart without failing", () => {
    const e = chartScene(make({ categories: [], series: [] }), 200, 120, theme);
    expect(e.items.length).toBeGreaterThan(0);
    expect(() => chartScene(make({ series: [{ name: "x", values: [null, null, null] }] }), 200, 120, theme)).not.toThrow();
    expect(() => chartScene(make(), 1, 1, theme)).not.toThrow();
  });
});

describe("chartScene: lines, areas, combinations", () => {
  it("draws a line per series with optional markers, smooth curves and gaps", () => {
    const l = chartScene(make({ chartType: "line", series: [{ name: "a", values: [1, 3, 2], marker: true }, { name: "b", values: [2, null, 1], smooth: true, marker: true }] }), 400, 300, theme);
    const lines = parts(l.items, "line");
    // b has a gap, so it is two single points: no segment is drawn for it
    expect(lines).toHaveLength(1);
    expect(lines[0]!.series).toBe(0);
    expect(parts(l.items, "marker")).toHaveLength(3 + 2);
    const curved = chartScene(make({ chartType: "line", smooth: true }), 400, 300, theme);
    expect((parts(curved.items, "line")[0] as Extract<ChartItem, { kind: "path" }>).d.some((c) => c[0] === "C")).toBe(true);
  });

  it("puts line points in the middle of their category", () => {
    const l = chartScene(make({ chartType: "line", series: [{ name: "a", values: [1, 2, 3], marker: true }] }), 400, 300, theme);
    const m = parts(l.items, "marker") as Extract<ChartItem, { kind: "path" }>[];
    const cx = (p: Extract<ChartItem, { kind: "path" }>) => {
      const xs = p.d.flatMap((c) => (c[0] === "Z" ? [] : [c[c.length - 2] as number]));
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    const band = l.plot.w / 3;
    expect(cx(m[0]!)).toBeCloseTo(l.plot.x + band / 2, 1);
    expect(cx(m[2]!)).toBeCloseTo(l.plot.x + band * 2.5, 1);
  });

  it("stacks areas and fills down to the baseline", () => {
    const a = chartScene(make({ chartType: "area", grouping: "stacked" }), 400, 300, theme);
    const areas = parts(a.items, "area");
    expect(areas).toHaveLength(2);
    expect(areas[0]!.kind === "path" && areas[0]!.fill?.color).toBe(theme.colors.accent1);
    // an area chart reaches both edges of the plot
    const xs = (areas[0] as Extract<ChartItem, { kind: "path" }>).d.flatMap((c) => (c[0] === "Z" ? [] : [c[1] as number]));
    expect(Math.min(...xs)).toBeCloseTo(a.plot.x, 5);
    expect(Math.max(...xs)).toBeCloseTo(a.plot.x + a.plot.w, 5);
  });

  it("combines columns and a line on one set of axes", () => {
    const c = chartScene(make({ series: [{ name: "bars", values: [4, 6, 3] }, { name: "trend", values: [3, 5, 4], type: "line" }] }), 400, 300, theme);
    expect(parts(c.items, "bar")).toHaveLength(3);
    expect(parts(c.items, "line")).toHaveLength(1);
    expect(c.legend).toHaveLength(2);
    // a lone bar series takes the whole group, so the bars are wider than in a two-series chart
    const two = (parts(chartScene(make(), 400, 300, theme).items, "bar") as Extract<ChartItem, { kind: "rect" }>[])[0]!;
    expect((parts(c.items, "bar") as Extract<ChartItem, { kind: "rect" }>[])[0]!.w).toBeGreaterThan(two.w);
  });
});

describe("chartScene: pie, doughnut, scatter", () => {
  const pie = make({ chartType: "pie", categories: ["a", "b", "c", "d"], series: [{ name: "s", values: [1, 1, 2, 4] }] });

  it("draws one sector per slice, in the accent colours, sweeping the full circle", () => {
    const s = chartScene(pie, 300, 300, theme);
    const slices = parts(s.items, "slice") as Extract<ChartItem, { kind: "path" }>[];
    expect(slices).toHaveLength(4);
    expect(slices.map((x) => x.fill!.color)).toEqual([theme.colors.accent1, theme.colors.accent2, theme.colors.accent3, theme.colors.accent4]);
    expect(s.legend.map((l) => l.text)).toEqual(["a", "b", "c", "d"]);
    expect(s.plot.w).toBeCloseTo(s.plot.h, 5);
  });

  it("measures slices by their share and starts at the first slice angle", () => {
    const cmds = sectorPath(0, 0, 0, 10, 0, Math.PI / 2);
    expect(cmds[0]).toEqual(["M", 0, 0]);
    // from twelve o'clock to three o'clock
    expect(cmds[1]![1]).toBeCloseTo(0, 6);
    expect(cmds[1]![2]).toBeCloseTo(-10, 6);
    const end = cmds[cmds.length - 2]!;
    expect(end[end.length - 2]).toBeCloseTo(10, 6);
    expect(end[end.length - 1]).toBeCloseTo(0, 6);
    // a single slice is a whole circle
    const whole = chartScene(make({ chartType: "pie", series: [{ name: "s", values: [5] }], categories: ["x"] }), 200, 200, theme);
    expect(parts(whole.items, "slice")).toHaveLength(1);
  });

  it("labels slices with their percentages and leaves a hole in a doughnut", () => {
    const labelled = chartScene({ ...pie, dataLabels: { percent: true } }, 300, 300, theme);
    expect(texts(labelled.items, "data-label")).toEqual(["13%", "13%", "25%", "50%"]);
    const ring = chartScene({ ...pie, chartType: "doughnut", holeSize: 50 }, 300, 300, theme);
    const first = parts(ring.items, "slice")[0] as Extract<ChartItem, { kind: "path" }>;
    // an outer arc, a line to the inner radius and the way back
    expect(first.d.filter((c) => c[0] === "L").length).toBe(1);
    const lineTo = first.d.find((c) => c[0] === "L")!;
    const r = ring.plot.w / 2;
    expect(Math.hypot((lineTo[1] as number) - (ring.plot.x + r), (lineTo[2] as number) - (ring.plot.y + r))).toBeCloseTo(r * 0.5, 4);
  });

  it("uses per-slice colours and ignores negative and blank values", () => {
    const c = chartScene(make({ chartType: "pie", categories: ["a", "b", "c"], series: [{ name: "s", values: [3, -1, null], pointColors: ["#112233", "#445566", "#778899"] }] }), 200, 200, theme);
    const sl = parts(c.items, "slice") as Extract<ChartItem, { kind: "path" }>[];
    expect(sl).toHaveLength(1);
    expect(sl[0]!.fill!.color).toBe("#112233");
  });

  it("plots scatter points by their x values on two numeric axes", () => {
    const sc = chartScene(make({ chartType: "scatter", categories: [], series: [{ name: "p", x: [1, 2, 3], values: [2, 4, 3] }, { name: "q", x: [1, 2, 3], values: [1, 1, 1], line: true }] }), 400, 300, theme);
    const m = parts(sc.items, "marker") as Extract<ChartItem, { kind: "path" }>[];
    expect(m).toHaveLength(6);
    expect(parts(sc.items, "line")).toHaveLength(1);
    expect(texts(sc.items, "tick-label").length).toBeGreaterThan(4);
  });
});

describe("chart helpers", () => {
  it("cycles the theme accents and then varies them", () => {
    expect(defaultSeriesColor(0)).toEqual({ theme: "accent1" });
    expect(defaultSeriesColor(5)).toEqual({ theme: "accent6" });
    expect(defaultSeriesColor(6)).not.toEqual({ theme: "accent1" });
    expect(defaultSeriesColor(6)).toMatchObject({ theme: "accent1" });
  });
  it("makes sample data with three categories and two series", () => {
    expect(sampleChartData("column").categories).toHaveLength(3);
    expect(sampleChartData("column").series).toHaveLength(2);
    expect(sampleChartData("pie").series).toHaveLength(1);
    expect(sampleChartData("scatter").series[0]!.x).toBeDefined();
  });
});
