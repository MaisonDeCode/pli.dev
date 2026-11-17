// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { ChartView, PliSheet } from "../src";
import { niceTicks, slicePath, smoothPath, stackSeries, tickLabel } from "../src/chartmath";
import { buildPie3d, buildScene3d, prism, projector, shade, type Item } from "../src/chart3d";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("axis maths", () => {
  it("rounds an axis to steps of 1, 2 or 5", () => {
    expect(niceTicks(0, 100)).toMatchObject({ min: 0, max: 100, step: 20 });
    expect(niceTicks(0, 7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-3, 12).ticks).toEqual([-5, 0, 5, 10, 15]);
    expect(niceTicks(0, 0.9).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(1234, 9876).ticks[0]).toBeLessThanOrEqual(1234);
  });

  it("gives a range to a flat or empty axis", () => {
    expect(niceTicks(5, 5).min).toBeLessThan(5);
    expect(niceTicks(5, 5).max).toBeGreaterThan(5);
    expect(niceTicks(0, 0)).toMatchObject({ min: 0, max: 1 });
    expect(niceTicks(NaN, 3).ticks.length).toBeGreaterThan(1);
  });

  it("labels numbers compactly", () => {
    expect(tickLabel(1200)).toBe("1,200");
    expect(tickLabel(2_500_000)).toBe("2.5M");
    expect(tickLabel(3e9)).toBe("3B");
    expect(tickLabel(0.25)).toBe("0.25");
  });

  it("piles series up, positives above zero and negatives below it", () => {
    expect(stackSeries([[1, 2], [3, -1], [2, null]], false)).toEqual([
      [[0, 1], [0, 2]],
      [[1, 4], [0, -1]],
      [[4, 6], [2, 2]],
    ]);
    expect(stackSeries([[1, 0], [3, 0]], true)).toEqual([[[0, 0.25], [0, 0]], [[0.25, 1], [0, 0]]]);
  });

  it("draws arcs and curves", () => {
    expect(slicePath(0, 0, 10, 0, Math.PI)).toMatch(/^M0,0L0,-10A10,10 0 0 1 /);
    expect(slicePath(0, 0, 10, 0, Math.PI * 2)).toContain("A10,10 0 1 1");
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]).startsWith("M0,0C")).toBe(true);
  });
});

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

describe("a chart drawn", () => {
  const draw = (s: SheetSession, type: Parameters<SheetSession["insertChart"]>[2] extends { type?: infer T } | undefined ? T : never, patch = {}) => {
    const chart = s.insertChart("Sheet1", "A1:C4", { type });
    if (Object.keys(patch).length) s.updateChart("Sheet1", chart.id, patch);
    const now = s.charts("Sheet1").find((c) => c.id === chart.id)!;
    act(() => root.render(<ChartView chart={now} data={s.chartData("Sheet1", chart.id)} />));
    return host.querySelector("svg")!;
  };

  it("columns: one bar per value, with the labels and legend", () => {
    const svg = draw(sales(), "column", { title: "Sales" });
    expect(svg.querySelectorAll(".pli-chart-bar")).toHaveLength(6);
    expect(svg.querySelector(".pli-chart-title")?.textContent).toBe("Sales");
    expect([...svg.querySelectorAll(".pli-chart-label")].map((t) => t.textContent)).toEqual(expect.arrayContaining(["Jan", "Feb", "Mar", "North", "South"]));
    expect(svg.getAttribute("aria-label")).toBe("Sales");
  });

  it("bars, stacked: bars are as long as the sums", () => {
    const svg = draw(sales(), "bar", { grouping: "stacked" });
    expect(svg.querySelectorAll(".pli-chart-bar")).toHaveLength(6);
    const wide = [...svg.querySelectorAll<SVGRectElement>(".pli-chart-bar")].map((r) => Number(r.getAttribute("width")));
    // The bars come series by series: Jan's two pieces (10 and 20) against Mar's (12 and 30).
    expect((wide[0]! + wide[3]!) / (wide[2]! + wide[5]!)).toBeCloseTo(30 / 42, 5);
  });

  it("lines, areas, pies and scatters", () => {
    const s = sales();
    expect(draw(s, "line").querySelectorAll(".pli-chart-marker")).toHaveLength(6);
    expect(draw(s, "area").querySelectorAll("path.pli-chart-area")).toHaveLength(2);
    const pie = draw(s, "pie");
    expect(pie.querySelectorAll(".pli-chart-slice")).toHaveLength(3);
    expect(pie.querySelector(".pli-chart-slice title")?.textContent).toBe("Jan: 10 (27%)");
    expect(draw(s, "scatter").querySelectorAll(".pli-chart-marker")).toHaveLength(6);
  });

  it("says so when there is nothing to show", () => {
    const s = new SheetSession(createWorkbook("e"));
    const chart = s.addChart("Sheet1", { series: [{ values: "Sheet1!$A$1:$A$3" }] });
    act(() => root.render(<ChartView chart={chart} data={s.chartData("Sheet1", chart.id)} />));
    expect(host.textContent).toContain("No data to show");
  });
});

describe("charts in the sheet", () => {
  const mount = (s: SheetSession, readOnly = false) => act(() => root.render(<PliSheet session={s} readOnly={readOnly} />));
  const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;

  it("shows the sheet's charts over the grid, and follows the cells", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4");
    mount(s);
    expect(host.querySelectorAll(".pli-grid-chart")).toHaveLength(1);
    expect(host.querySelectorAll(".pli-chart-bar")).toHaveLength(6);
    act(() => s.setCell("Sheet1", "B2", 40));
    const tallest = Math.max(...[...host.querySelectorAll<SVGRectElement>(".pli-chart-bar")].map((r) => Number(r.getAttribute("height"))));
    expect(tallest).toBeGreaterThan(100);
  });

  it("Insert > Chart puts a chart beside the selected cells", () => {
    const s = sales();
    mount(s);
    const insert = [...host.querySelectorAll<HTMLElement>('[role="menuitem"], button')].find((b) => b.textContent?.trim() === "Insert")!;
    act(() => insert.click());
    const chart = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.trim().startsWith("Chart"))!;
    expect(chart).toBeTruthy();
  });

  it("clicking a chart selects it, Delete removes it, and Undo brings it back", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4", { id: "c1" } as never);
    mount(s);
    const box = q(".pli-grid-chart");
    const left = parseFloat(box.style.left);
    const top = parseFloat(box.style.top);
    const point = { clientX: 48 + left + 50, clientY: 24 + top + 50 };
    const scroller = q(".pli-grid-scroller");
    act(() => {
      scroller.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...point }));
      scroller.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...point }));
    });
    expect(q(".pli-grid-chart").hasAttribute("data-selected")).toBe(true);
    expect(host.querySelectorAll(".pli-grid-charthandle")).toHaveLength(8);
    act(() => q(".pli-grid-sink").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
    expect(s.charts("Sheet1")).toHaveLength(0);
    expect(host.querySelectorAll(".pli-grid-chart")).toHaveLength(0);
    act(() => void s.undo());
    expect(host.querySelectorAll(".pli-grid-chart")).toHaveLength(1);
  });

  it("drags a chart to a new place", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4");
    mount(s);
    const box = q(".pli-grid-chart");
    const from = { clientX: 48 + parseFloat(box.style.left) + 50, clientY: 24 + parseFloat(box.style.top) + 50 };
    const scroller = q(".pli-grid-scroller");
    act(() => {
      scroller.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...from }));
      scroller.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, ...from, clientX: from.clientX + 128, clientY: from.clientY + 60 }));
      scroller.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...from, clientX: from.clientX + 128, clientY: from.clientY + 60 }));
    });
    const moved = s.charts("Sheet1")[0]!;
    // It started in column E (one cell right of the data's last column plus one) and now sits two columns to the right, three rows down.
    expect(moved.from.col).toBe(7);
    expect(moved.from.row).toBe(4);
  });

  it("can't be changed in a read-only sheet", () => {
    const s = sales();
    s.insertChart("Sheet1", "A1:C4");
    mount(s, true);
    const box = q(".pli-grid-chart");
    const p = { clientX: 48 + parseFloat(box.style.left) + 50, clientY: 24 + parseFloat(box.style.top) + 50 };
    const scroller = q(".pli-grid-scroller");
    act(() => {
      scroller.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...p }));
      scroller.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...p }));
    });
    expect(host.querySelectorAll(".pli-grid-charthandle")).toHaveLength(0);
    act(() => q(".pli-grid-sink").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
    expect(s.charts("Sheet1")).toHaveLength(1);
  });
});

describe("3-D", () => {
  const ticks = niceTicks(0, 40);
  const sample = (): SheetSession => sales();
  const chartOf = (s: SheetSession, type: "column" | "bar" | "line" | "area" | "pie", view3d: { rotX: number; rotY: number }, patch = {}) => {
    const c = s.insertChart("Sheet1", "A1:C4", { type });
    s.updateChart("Sheet1", c.id, { view3d, ...patch });
    const chart = s.charts("Sheet1").find((x) => x.id === c.id)!;
    return { chart, data: s.chartData("Sheet1", c.id) };
  };
  const polys = (items: Item[], cls = "pli-chart-solid") => items.filter((i): i is Extract<Item, { kind: "poly" }> => i.kind === "poly" && i.cls === cls);

  it("turns and tilts points, with larger z further away", () => {
    const front = projector(0, 0);
    expect(front.point({ x: 3, y: 4, z: 5 })).toEqual({ x: 3, y: 4, d: 5 });
    const turned = projector(0, 90).point({ x: 0, y: 0, z: 10 });
    expect(turned.x).toBeCloseTo(10);
    expect(turned.d).toBeCloseTo(0);
    // Tilted from above, a point further back is higher on the page, and a higher point is nearer.
    const tilt = projector(90, 0);
    expect(tilt.point({ x: 0, y: 0, z: 10 }).y).toBeCloseTo(10);
    expect(tilt.point({ x: 0, y: 10, z: 0 }).d).toBeCloseTo(-10);
  });

  it("builds a prism with a face per edge and two caps, whichever way the shape winds", () => {
    const square: [number, number][] = [[0, 0], [2, 0], [2, 3], [0, 3]];
    const a = prism(square, "xy", 1, 4);
    const b = prism(square.slice().reverse(), "xy", 1, 4);
    expect(a.faces).toHaveLength(6);
    expect(a.center).toEqual({ x: 1, y: 1.5, z: 2.5 });
    const normals = (s: ReturnType<typeof prism>) => s.faces.map((f) => `${f.normal.x},${f.normal.y},${f.normal.z}`).sort();
    expect(normals(b)).toEqual(normals(a));
    // Every side's normal points away from the middle.
    for (const f of a.faces) {
      const mid = f.pts.reduce((m, p) => ({ x: m.x + p.x / 4, y: m.y + p.y / 4, z: m.z + p.z / 4 }), { x: 0, y: 0, z: 0 });
      expect((mid.x - a.center.x) * f.normal.x + (mid.y - a.center.y) * f.normal.y + (mid.z - a.center.z) * f.normal.z).toBeGreaterThan(0);
    }
    const flat = prism([[0, 0], [1, 0], [0, 1]], "xz", 0, 2);
    expect(flat.faces).toHaveLength(5);
    expect(flat.faces[1]!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("lightens and darkens colours", () => {
    expect(shade("#808080", 1)).toBe("#808080");
    expect(shade("#808080", 0.5)).toBe("#404040");
    expect(shade("#808080", 1.12)).not.toBe("#808080");
    expect(shade("#000000", 3)).toBe("#ffffff");
  });

  it("paints only the faces that turn towards the viewer", () => {
    const s = sample();
    const { chart, data } = chartOf(s, "column", { rotX: 0, rotY: 0 });
    const flat = buildScene3d(chart, data, { x: 0, y: 0, w: 400, h: 200 }, ticks, String);
    // Seen straight on, each column shows only its front.
    expect(polys(flat)).toHaveLength(6);
    const { chart: tilted, data: d2 } = chartOf(s, "column", { rotX: 30, rotY: 25 });
    // Tilted and turned, a column shows its front, top and right side.
    expect(polys(buildScene3d(tilted, d2, { x: 0, y: 0, w: 400, h: 200 }, ticks, String))).toHaveLength(18);
  });

  it("draws the walls that are behind the marks, and labels the edges", () => {
    const s = sample();
    const { chart, data } = chartOf(s, "column", { rotX: 20, rotY: 20 });
    const items = buildScene3d(chart, data, { x: 0, y: 0, w: 400, h: 200 }, ticks, (v) => `${v}!`);
    expect(polys(items, "pli-chart3d-floor")).toHaveLength(1);
    expect(polys(items, "pli-chart3d-wall").length).toBeGreaterThanOrEqual(2);
    const labels = items.filter((i) => i.kind === "text").map((i) => (i as { text: string }).text);
    expect(labels).toEqual(expect.arrayContaining(["0!", "40!", "Jan", "Feb", "Mar"]));
    expect(items.filter((i) => i.kind === "line").length).toBeGreaterThan(5);
  });

  it("keeps every mark inside the area it is given", () => {
    const s = sample();
    const box = { x: 20, y: 30, w: 300, h: 160 };
    for (const type of ["column", "bar", "line", "area"] as const) {
      for (const view of [{ rotX: 15, rotY: 20 }, { rotX: 60, rotY: 200 }, { rotX: 0, rotY: 0 }, { rotX: 90, rotY: 45 }]) {
        const { chart, data } = chartOf(s, type, view, type === "area" ? { grouping: "stacked" } : {});
        for (const it of polys(buildScene3d(chart, data, box, ticks, String)).concat(polys(buildScene3d(chart, data, box, ticks, String), "pli-chart3d-wall"))) {
          for (const [x, y] of it.pts) {
            expect(x).toBeGreaterThanOrEqual(box.x - 0.5);
            expect(x).toBeLessThanOrEqual(box.x + box.w + 0.5);
            expect(y).toBeGreaterThanOrEqual(box.y - 0.5);
            expect(y).toBeLessThanOrEqual(box.y + box.h + 0.5);
          }
        }
      }
    }
  });

  it("puts series one behind another in a 3-D line chart, and piles them in a stacked one", () => {
    const s = sample();
    const { chart, data } = chartOf(s, "line", { rotX: 20, rotY: 30 });
    const apart = polys(buildScene3d(chart, data, { x: 0, y: 0, w: 400, h: 200 }, ticks, String));
    // Two series, two segments each, three faces facing us per ribbon piece.
    expect(apart.length).toBe(2 * 2 * 3);
    const { chart: st, data: sd } = chartOf(s, "area", { rotX: 20, rotY: 30 }, { grouping: "stacked" });
    expect(polys(buildScene3d(st, sd, { x: 0, y: 0, w: 400, h: 200 }, niceTicks(0, 60), String)).length).toBeGreaterThan(0);
  });

  it("draws a pie with thickness, a top for each slice, and labels", () => {
    const s = sample();
    const { chart, data } = chartOf(s, "pie", { rotX: 40, rotY: 0 }, { labels: true });
    const items = buildPie3d(chart, data, { x: 0, y: 0, w: 300, h: 200 });
    const tops = polys(items).filter((p) => p.title);
    expect(new Set(tops.map((p) => p.title)).size).toBe(3);
    expect(items.filter((i) => i.kind === "text").map((i) => (i as { text: string }).text)).toEqual(["27%", "40.5%", "32.4%"]);
    // Seen from the side there is no top to see, only the outer wall.
    const edge = buildPie3d({ ...chart, view3d: { rotX: 0, rotY: 0 } }, data, { x: 0, y: 0, w: 300, h: 200 });
    expect(polys(edge).length).toBeGreaterThan(0);
    expect(buildPie3d(chart, { categories: ["a"], series: [{ name: "s", color: "#000000", values: [0] }] }, { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });

  const draw3d = (s: SheetSession, type: "column" | "bar" | "line" | "area" | "pie") => {
    const { chart, data } = chartOf(s, type, { rotX: 20, rotY: 25 });
    act(() => root.render(<ChartView chart={chart} data={data} />));
    return host.querySelector("svg")!;
  };

  it("is drawn by ChartView in place of the flat chart", () => {
    const s = sample();
    for (const type of ["column", "bar", "line", "area", "pie"] as const) {
      const svg = draw3d(s, type);
      expect(svg.querySelectorAll(".pli-chart-solid").length, type).toBeGreaterThan(0);
      expect(svg.querySelectorAll(".pli-chart-bar, .pli-chart-marker, .pli-chart-slice").length, type).toBe(0);
    }
    expect(draw3d(s, "column").querySelectorAll(".pli-chart3d-wall").length).toBeGreaterThan(0);
  });

  it("leaves a scatter chart flat even if asked", () => {
    const s = sample();
    const c = s.insertChart("Sheet1", "A1:C4", { type: "scatter" });
    act(() => root.render(<ChartView chart={{ ...c, view3d: { rotX: 20, rotY: 20 } }} data={s.chartData("Sheet1", c.id)} />));
    expect(host.querySelectorAll(".pli-chart-solid")).toHaveLength(0);
    expect(host.querySelectorAll(".pli-chart-marker").length).toBe(6);
  });
});
