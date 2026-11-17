// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, type Chart } from "@pli.dev/sheets";
import { ChartDialog, ChartView, PliSheet } from "../src";
import { hits, listMarks, markAt, stepMark, turnedView } from "../src/chartmarks";

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

function sales(): SheetSession {
  const s = new SheetSession(createWorkbook("t"));
  s.setValues("Sheet1", "A1", [["Month", "North", "South"], ["Jan", 10, 20], ["Feb", 15, 25], ["Mar", 12, 30]]);
  return s;
}
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;

const draw = (s: SheetSession, chart: Chart) => {
  act(() => root.render(<ChartView chart={chart} data={s.chartData("Sheet1", chart.id)} />));
  return q<SVGSVGElement>("svg.pli-chart");
};

describe("hit shapes", () => {
  it("find a point in a rectangle, a circle and a ring slice", () => {
    expect(hits("r:10,10,20,20", 15, 15)).toBe(true);
    expect(hits("r:10,10,20,20", 40, 15)).toBe(false);
    expect(hits("c:50,50,5", 53, 50)).toBe(true);
    expect(hits("c:50,50,5", 70, 50)).toBe(false);
    // the right half of a pie, from twelve o'clock round to six
    expect(hits(`a:0,0,0,10,0,${Math.PI.toFixed(4)}`, 5, 0)).toBe(true);
    expect(hits(`a:0,0,0,10,0,${Math.PI.toFixed(4)}`, -5, 0)).toBe(false);
  });

  it("move between marks with the arrow keys, staying put at the ends", () => {
    const marks = [{ series: 0, point: 0 }, { series: 0, point: 1 }, { series: 1, point: 0 }, { series: 1, point: 1 }];
    expect(stepMark(marks, { series: 0, point: 0 }, "ArrowRight")).toEqual({ series: 0, point: 1 });
    expect(stepMark(marks, { series: 0, point: 1 }, "ArrowRight")).toEqual({ series: 0, point: 1 });
    expect(stepMark(marks, { series: 0, point: 1 }, "ArrowDown")).toEqual({ series: 1, point: 1 });
    expect(stepMark(marks, { series: 1, point: 1 }, "ArrowUp")).toEqual({ series: 0, point: 1 });
  });

  it("turn a 3-D view: across turns it, down tilts it, within bounds", () => {
    expect(turnedView({ rotX: 15, rotY: 20 }, 50, 0)).toEqual({ rotX: 15, rotY: 50 });
    expect(turnedView({ rotX: 15, rotY: 20 }, 0, 500)).toEqual({ rotX: 90, rotY: 20 });
    expect(turnedView({ rotX: 15, rotY: 10, perspective: 40 }, -100, 0).rotY).toBe(310);
    expect(turnedView({ rotX: 15, rotY: 10, perspective: 40 }, -100, 0).perspective).toBe(40);
  });
});

describe("marks and colours drawn", () => {
  it("fills a single point with its own colour and tags every mark", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    s.updateChart("Sheet1", c.id, { series: [{ ...c.series[0]!, pointColors: { "1": "#ff0000" } }, c.series[1]!] });
    const svg = draw(s, s.charts("Sheet1")[0]!);
    const bars = [...svg.querySelectorAll<SVGRectElement>("[data-mark]")];
    expect(bars).toHaveLength(6);
    expect(bars[1]!.getAttribute("fill")).toBe("#ff0000");
    expect(bars[0]!.getAttribute("fill")).not.toBe("#ff0000");
    expect(listMarks(svg)).toHaveLength(6);
    // a point on the second bar of the first series finds that mark
    const [x, y, w, h] = bars[1]!.getAttribute("data-hit")!.slice(2).split(",").map(Number);
    expect(markAt(svg, x! + w! / 2, y! + h! / 2)).toEqual({ series: 0, point: 1 });
  });

  it("outlines the picked mark", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "pie" });
    act(() => root.render(<ChartView chart={c} data={s.chartData("Sheet1", c.id)} mark={{ series: 0, point: 2 }} />));
    const picked = host.querySelectorAll("[data-marksel]");
    expect(picked).toHaveLength(1);
    expect(picked[0]!.getAttribute("data-mark")).toBe("0:2");
  });

  it("colours the slices of a pie from the point colours", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "pie" });
    s.updateChart("Sheet1", c.id, { series: [{ ...c.series[0]!, pointColors: { "0": "#abcdef" } }] });
    const svg = draw(s, s.charts("Sheet1")[0]!);
    expect(svg.querySelector(".pli-chart-slice")!.getAttribute("fill")).toBe("#abcdef");
  });

  it("draws bubbles as spheres with a gradient", () => {
    const s = sales();
    const b = s.addChart("Sheet1", { type: "bubble", bubble3d: true, series: [{ values: "Sheet1!$B$2:$B$4", x: "Sheet1!$C$2:$C$4", size: "Sheet1!$B$2:$B$4" }] });
    const svg = draw(s, b);
    expect(svg.querySelectorAll("radialGradient")).toHaveLength(3);
    expect(svg.querySelector("circle.pli-chart-marker")!.getAttribute("fill")).toMatch(/^url\(#/);
  });

  it("draws a scatter series in a chart of columns on the category numbers", () => {
    const s = sales();
    const c = s.addChart("Sheet1", { type: "column", categories: "Sheet1!$A$2:$A$4", series: [{ values: "Sheet1!$B$2:$B$4" }, { values: "Sheet1!$C$2:$C$4", type: "scatter" }] });
    const svg = draw(s, c);
    expect(svg.querySelectorAll("rect.pli-chart-bar")).toHaveLength(3);
    expect(svg.querySelectorAll("circle.pli-chart-marker")).toHaveLength(3);
  });

  it("uses the font of an axis for its labels and title", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    s.updateChart("Sheet1", c.id, { yTitle: "Units", axes: { y: { font: { size: 15, color: "#ff0000" }, titleRuns: [{ text: "Un", bold: true }, { text: "its", italic: true }] } } });
    const svg = draw(s, s.charts("Sheet1")[0]!);
    const label = [...svg.querySelectorAll<SVGTextElement>("text.pli-chart-label")].find((t) => t.textContent === "20")!;
    expect(label.style.fontSize).toBe("20px");
    expect(label.style.fill).toBe("#ff0000");
    expect(svg.querySelector(".pli-chart-axistitle tspan:nth-child(2)")!.textContent).toBe("its");
  });

  it("writes the label of a trendline from its lines, and moves it by its offset", () => {
    const s = sales();
    const c = s.addChart("Sheet1", { type: "scatter", series: [{ x: "Sheet1!$B$2:$B$4", values: "Sheet1!$C$2:$C$4", trendlines: [{ type: "linear", equation: true, rSquared: true }] }] });
    const plain = draw(s, c);
    const firstX = Number(plain.querySelector<SVGTextElement>("[data-tlabel]")!.getAttribute("x"));
    const first = plain.querySelector<SVGTextElement>("[data-tlabel]")!;
    expect(plain.querySelectorAll("[data-tlabel]")).toHaveLength(2);
    expect(first.getAttribute("data-tlabel")).toBe("0:0");
    s.updateChart("Sheet1", c.id, { series: [{ ...c.series[0]!, trendlines: [{ type: "linear", equation: true, label: { text: "Fit", x: 0.1, y: 0.1 } }] }] });
    const moved = draw(s, s.charts("Sheet1")[0]!);
    const label = moved.querySelector<SVGTextElement>("[data-tlabel]")!;
    expect(label.textContent).toBe("Fit");
    expect(Math.abs(Number(label.getAttribute("x")) - firstX)).toBeGreaterThan(5);
  });

  it("draws a 3-D chart with perspective and with right-angle axes", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    const polys = (view: Chart["view3d"]) => {
      s.updateChart("Sheet1", c.id, { view3d: view });
      const svg = draw(s, s.charts("Sheet1")[0]!);
      expect(svg.getAttribute("data-plot3d")).toMatch(/^\d+,\d+,\d+,\d+$/);
      return [...svg.querySelectorAll("polygon.pli-chart-solid")].map((p) => p.getAttribute("points"));
    };
    const flat = polys({ rotX: 15, rotY: 20, perspective: 0 });
    const deep = polys({ rotX: 15, rotY: 20, perspective: 60 });
    const square = polys({ rotX: 15, rotY: 20, rightAngle: true });
    expect(deep).not.toEqual(flat);
    expect(square).not.toEqual(flat);
    expect(square.length).toBeGreaterThan(0);
  });
});

describe("picking marks in the sheet", () => {
  const mount = (s: SheetSession) => act(() => root.render(<PliSheet session={s} />));
  const pointer = (scroller: Element, type: string, at: { clientX: number; clientY: number }) => scroller.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at }));
  const key = (k: string, extra: KeyboardEventInit = {}) => act(() => q(".pli-grid-sink").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra })));
  /** The place on the screen of a point `dx`, `dy` into the chart. */
  const spot = (dx: number, dy: number) => {
    const box = q(".pli-grid-chart");
    return { clientX: 48 + parseFloat(box.style.left) + dx, clientY: 24 + parseFloat(box.style.top) + dy };
  };
  const centreOf = (svg: Element, id: string) => {
    const [x, y, w, h] = svg.querySelector(`[data-mark="${id}"]`)!.getAttribute("data-hit")!.slice(2).split(",").map(Number);
    return { dx: x! + w! / 2, dy: y! + h! / 2 };
  };

  it("a click on a column picks it, the panel sets its colour, and the arrow keys move on", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4", { id: "c1" } as never);
    mount(s);
    const scroller = q(".pli-grid-scroller");
    const at = centreOf(q("svg.pli-chart"), "0:1");
    act(() => {
      pointer(scroller, "pointerdown", spot(at.dx, at.dy));
      pointer(scroller, "pointerup", spot(at.dx, at.dy));
    });
    expect(q(".pli-grid-chart").hasAttribute("data-selected")).toBe(true);
    expect(host.querySelectorAll("[data-marksel]")).toHaveLength(1);
    expect(q("[data-marksel]").getAttribute("data-mark")).toBe("0:1");
    const colour = q<HTMLInputElement>('input[aria-label="Fill of the picked mark"]');
    expect(colour).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(colour, "#00ff00");
      colour.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(s.charts("Sheet1")[0]!.series[0]!.pointColors).toEqual({ "1": "#00ff00" });
    key("ArrowRight");
    expect(q("[data-marksel]").getAttribute("data-mark")).toBe("0:2");
    key("ArrowDown");
    expect(q("[data-marksel]").getAttribute("data-mark")).toBe("1:2");
    // the arrow keys moved the mark, not the chart
    expect(s.charts("Sheet1")[0]!.from.col).toBe(5);
    key("Escape");
    expect(host.querySelectorAll("[data-marksel]")).toHaveLength(0);
    expect(q(".pli-grid-chart").hasAttribute("data-selected")).toBe(true);
    // M picks the first mark of a picked chart again
    key("m");
    expect(q("[data-marksel]").getAttribute("data-mark")).toBe("0:0");
    act(() => q('button[aria-label="Use the series colour"], button:not([aria-label])') && void 0);
  });

  it("a slice's panel pulls it out", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4", { type: "pie" });
    mount(s);
    const scroller = q(".pli-grid-scroller");
    const svg = q("svg.pli-chart");
    // somewhere inside the first slice: a little way from the centre
    const slice = svg.querySelector('[data-mark="0:0"]')!.getAttribute("data-hit")!.slice(2).split(",").map(Number);
    const mid = (slice[4]! + slice[5]!) / 2;
    const at = { dx: slice[0]! + slice[3]! * 0.5 * Math.sin(mid), dy: slice[1]! - slice[3]! * 0.5 * Math.cos(mid) };
    act(() => {
      pointer(scroller, "pointerdown", spot(at.dx, at.dy));
      pointer(scroller, "pointerup", spot(at.dx, at.dy));
    });
    const out = q<HTMLInputElement>('input[aria-label="Pull the picked slice out"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(out, "30");
      out.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(s.charts("Sheet1")[0]!.series[0]!.pointExplosion).toEqual({ "0": 30 });
  });

  it("dragging the plot of a picked 3-D chart turns it, and Alt with an arrow turns it by key", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    s.updateChart("Sheet1", c.id, { view3d: { rotX: 15, rotY: 20 } });
    mount(s);
    const scroller = q(".pli-grid-scroller");
    const plot = q("svg.pli-chart").getAttribute("data-plot3d")!.split(",").map(Number);
    const inside = spot(plot[0]! + plot[2]! / 2, plot[1]! + plot[3]! / 2);
    // the first press picks the chart; the next drag turns it
    act(() => {
      pointer(scroller, "pointerdown", inside);
      pointer(scroller, "pointerup", inside);
    });
    expect(s.charts("Sheet1")[0]!.view3d).toEqual({ rotX: 15, rotY: 20 });
    act(() => {
      pointer(scroller, "pointerdown", inside);
      pointer(scroller, "pointermove", { clientX: inside.clientX + 50, clientY: inside.clientY + 25 });
      pointer(scroller, "pointerup", { clientX: inside.clientX + 50, clientY: inside.clientY + 25 });
    });
    const turned = s.charts("Sheet1")[0]!;
    expect(turned.view3d).toEqual({ rotX: 25, rotY: 50 });
    expect(turned.from).toEqual(c.from);
    key("ArrowLeft", { altKey: true });
    expect(s.charts("Sheet1")[0]!.view3d!.rotY).toBe(45);
    key("ArrowUp", { altKey: true });
    expect(s.charts("Sheet1")[0]!.view3d!.rotX).toBe(30);
  });

  it("dragging a trendline label of a picked chart moves the label, not the chart", () => {
    const s = sales();
    const c = s.addChart("Sheet1", { type: "scatter", series: [{ x: "Sheet1!$B$2:$B$4", values: "Sheet1!$C$2:$C$4", trendlines: [{ type: "linear", equation: true }] }] });
    mount(s);
    const scroller = q(".pli-grid-scroller");
    act(() => {
      pointer(scroller, "pointerdown", spot(5, 5));
      pointer(scroller, "pointerup", spot(5, 5));
    });
    const hit = q("[data-tlabel]").getAttribute("data-hit")!.slice(2).split(",").map(Number);
    const on = spot(hit[0]! + hit[2]! / 2, hit[1]! + hit[3]! / 2);
    act(() => {
      pointer(scroller, "pointerdown", on);
      pointer(scroller, "pointermove", { clientX: on.clientX - 48, clientY: on.clientY + 29 });
      pointer(scroller, "pointerup", { clientX: on.clientX - 48, clientY: on.clientY + 29 });
    });
    const label = s.charts("Sheet1")[0]!.series[0]!.trendlines![0]!.label!;
    expect(label.x).toBeCloseTo(-48 / c.width, 2);
    expect(label.y).toBeCloseTo(29 / c.height, 2);
    expect(s.charts("Sheet1")[0]!.from).toEqual(c.from);
  });

  it("the chart menu switches the rows and columns", () => {
    const s = new SheetSession(createWorkbook("t"));
    s.setValues("Sheet1", "A1", [["", "Jan", "Feb"], ["North", 1, 2], ["South", 3, 4]]);
    const c = s.insertChart("Sheet1", "A1:C3", { seriesIn: "rows" });
    expect(s.chartSeriesIn("Sheet1", c.id)).toBe("rows");
    s.switchChartRowsColumns("Sheet1", c.id);
    mount(s);
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(4);
  });
});

describe("the chart editor", () => {
  const open = (chart: Chart, onSave: (patch: never) => void = () => undefined) =>
    act(() => root.render(<ChartDialog open chart={chart} sheetName="Sheet1" onClose={() => undefined} onSave={onSave as never} />));
  const dq = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
  const change = (el: HTMLSelectElement | HTMLInputElement, value: string) =>
    act(() => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  const click = (el: Element) => act(() => (el as HTMLElement).click());
  const submit = () => act(() => dq<HTMLFormElement>("form").requestSubmit());
  type Saved = Omit<Chart, "id" | "from" | "width" | "height">;

  it("keeps the colours of single points when it is saved", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    s.updateChart("Sheet1", c.id, { series: [{ ...c.series[0]!, pointColors: { "2": "#123456" } }, c.series[1]!] });
    let saved: Saved | undefined;
    open(s.charts("Sheet1")[0]!, (p) => (saved = p as never));
    submit();
    expect(saved!.series[0]!.pointColors).toEqual({ "2": "#123456" });
  });

  it("switches the rows and columns of the data", () => {
    const s = new SheetSession(createWorkbook("t"));
    s.setValues("Sheet1", "A1", [["", "Jan", "Feb"], ["North", 1, 2], ["South", 3, 4]]);
    const c = s.insertChart("Sheet1", "A1:C3", { seriesIn: "rows" });
    let saved: Saved | undefined;
    open(c, (p) => (saved = p as never));
    click([...document.querySelectorAll("button")].find((b) => b.textContent === "Switch rows and columns")!);
    submit();
    expect(saved!.categories).toBe("Sheet1!$A$2:$A$3");
    expect(saved!.series.map((x) => x.values)).toEqual(["Sheet1!$B$2:$B$3", "Sheet1!$C$2:$C$3"]);
  });

  it("sets a scatter series in a chart of columns, a trendline label, the look of an axis' title and the perspective", () => {
    const s = sales();
    const c = s.addChart("Sheet1", {
      type: "column", categories: "Sheet1!$A$2:$A$4", yTitle: "Units",
      series: [{ values: "Sheet1!$B$2:$B$4" }, { values: "Sheet1!$C$2:$C$4", type: "scatter", trendlines: [{ type: "linear", equation: true }] }],
    });
    let saved: Saved | undefined;
    open(c, (p) => (saved = p as never));
    expect(dq<HTMLSelectElement>('select[aria-label="Kind of series 2"]').value).toBe("scatter");
    change(dq('input[aria-label="Trendline label text"]'), "My fit");
    change(dq('input[aria-label="Trendline label number format"]'), "0.00");
    change(dq('input[aria-label="Vertical axis labels: Size"]'), "14");
    click(dq('button[aria-label="Vertical axis title in pieces: add a piece"]'));
    change(dq('input[aria-label="Vertical axis title in pieces: piece 2"]'), " now");
    submit();
    expect(saved!.series[1]!.type).toBe("scatter");
    expect(saved!.series[1]!.trendlines![0]!.label).toEqual({ text: "My fit", format: "0.00" });
    expect(saved!.axes!.y!.font).toEqual({ size: 14 });
    expect(saved!.axes!.y!.titleRuns!.map((r) => r.text)).toEqual(["Units", " now"]);
    expect(saved!.yTitle).toBe("Units now");
  });

  it("sets the perspective, depth and right angles of a 3-D chart", () => {
    const s = sales();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "column" });
    s.updateChart("Sheet1", c.id, { view3d: { rotX: 15, rotY: 20 } });
    let saved: Saved | undefined;
    open(s.charts("Sheet1")[0]!, (p) => (saved = p as never));
    change(dq('input[aria-label="Perspective"]'), "40");
    change(dq('input[aria-label="Depth"]'), "200");
    submit();
    expect(saved!.view3d).toEqual({ rotX: 15, rotY: 20, perspective: 40, depth: 200 });
    open(s.charts("Sheet1")[0]!, (p) => (saved = p as never));
    click(dq('input[aria-label="Right-angle axes"]'));
    submit();
    expect(saved!.view3d).toEqual({ rotX: 15, rotY: 20, perspective: 40, depth: 200, rightAngle: true });
  });
});
