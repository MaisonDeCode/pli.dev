// @vitest-environment jsdom
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SheetsLive from "../src/live/SheetsLive";
import type { LiveBodyProps } from "../src/live/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

let host: HTMLElement;
let root: Root | null;
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom lays nothing out: give the grid a viewport, as the package's own tests do.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 420 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const props = (over: Partial<LiveBodyProps> = {}): LiveBodyProps => ({ step: 0, steps: 3, interactive: false, reducedMotion: true, mode: "story", onReady: () => {}, ...over });

function mount(p: LiveBodyProps, strict = false) {
  const el = (q: LiveBodyProps) => (strict ? <StrictMode><SheetsLive {...q} /></StrictMode> : <SheetsLive {...q} />);
  root!.render(el(p));
  return (next: Partial<LiveBodyProps>) => {
    p = { ...p, ...next };
    root!.render(el(p));
  };
}

const cells = () => [...host.querySelectorAll(".pli-cell")].map((c) => c.textContent ?? "").filter(Boolean);
const charts = () => host.querySelectorAll("[data-chart]");
const settled = (what: () => void) => vi.waitFor(what, { timeout: 5000, interval: 20 });
const quiet = () => {
  expect(errors).not.toHaveBeenCalled();
  expect(warnings).not.toHaveBeenCalled();
};

describe("the live Sheets editor", () => {
  it("shows the real grid with a compact chrome and calls onReady once", async () => {
    const onReady = vi.fn();
    mount(props({ onReady }));
    await settled(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(host.querySelector(".pli-spreadsheet")).not.toBeNull();
    expect(host.querySelector(".pli-sheet-tabs, [role='tablist']")).toBeNull();
    quiet();
  });

  it("step 0: the data table only, no formulas yet", async () => {
    const onReady = vi.fn();
    mount(props({ step: 0, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    const c = cells();
    expect(c).toEqual(expect.arrayContaining(["Region", "Q1", "Q4", "North", "42100", "21700"]));
    expect(c).not.toContain("Total");
    expect(c).not.toContain("Growth");
    expect(charts()).toHaveLength(0);
    quiet();
  });

  it("step 1: totals and growth are computed, and formatted", async () => {
    const onReady = vi.fn();
    mount(props({ step: 1, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    const c = cells();
    // North: 42,100 + 48,300 + 51,900 + 55,200, up 31.1% from Q1 to Q4; the total row sums every region.
    expect(c).toEqual(expect.arrayContaining(["Total", "Growth", "$42,100", "$197,500", "31.1%", "$170,900", "$223,300", "$798,200", "30.7%"]));
    expect(charts()).toHaveLength(0);
    expect(host.querySelectorAll(".pli-cell-bar")).toHaveLength(0);
    quiet();
  });

  it("step 2: a chart is drawn from the data, with a data bar on the totals", async () => {
    const onReady = vi.fn();
    mount(props({ step: 2, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    expect(charts()).toHaveLength(1);
    expect(charts()[0]!.querySelector("svg")).not.toBeNull();
    expect(charts()[0]!.textContent).toContain("Revenue by region");
    expect(charts()[0]!.textContent).toContain("North");
    expect(host.querySelectorAll(".pli-cell-bar").length).toBe(6);
    expect(cells()).toContain("$798,200");
    quiet();
  });

  it("step 2 then 0 then 2 ends in the same sheet", async () => {
    const update = mount(props({ step: 2 }));
    await settled(() => expect(charts()).toHaveLength(1));
    const first = cells();
    update({ step: 0 });
    await settled(() => expect(charts()).toHaveLength(0));
    expect(cells()).not.toContain("Total");
    expect(host.querySelectorAll(".pli-cell-bar")).toHaveLength(0);
    update({ step: 2 });
    await settled(() => expect(charts()).toHaveLength(1));
    expect(cells()).toEqual(first);
    expect(host.querySelectorAll(".pli-cell-bar").length).toBe(6);
    quiet();
  });

  it("fills cells in one at a time when motion is allowed, and ends where the instant step does", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    update({ step: 1 });
    await settled(() => expect(cells()).toContain("Total"));
    // Part-way: some formulas are in, others not yet.
    await settled(() => expect(cells()).toContain("$798,200"));
    await new Promise((r) => setTimeout(r, 500));
    update({ step: 2 });
    await settled(() => expect(charts()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 1500));
    const played = cells();
    root!.unmount();
    root = createRoot(host);
    mount(props({ step: 2 }));
    await settled(() => expect(charts()).toHaveLength(1));
    expect(cells()).toEqual(played);
    quiet();
  }, 30_000);

  it("a step change while playing finishes that step first", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    update({ step: 1 });
    await settled(() => expect(cells()).toContain("Growth"));
    update({ step: 2 });
    await settled(() => expect(charts()).toHaveLength(1));
    await settled(() => expect(cells()).toContain("$798,200"));
    quiet();
  }, 30_000);

  it("stops scripting when the visitor takes over, and leaves the sheet as it is", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    update({ step: 1 });
    await settled(() => expect(cells()).toContain("Growth"));
    update({ interactive: true });
    await new Promise((r) => setTimeout(r, 120)); // the last drawn action reaches the page
    const frozen = cells();
    await new Promise((r) => setTimeout(r, 500));
    expect(cells()).toEqual(frozen);
    update({ step: 2 });
    await new Promise((r) => setTimeout(r, 300));
    expect(cells()).toEqual(frozen);
    expect(charts()).toHaveLength(0);
    quiet();
  }, 30_000);

  it("is safe in StrictMode, and leaves no timers behind when it unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const turn = () => new Promise((r) => setImmediate(r));
    const update = mount(props({ step: 0, reducedMotion: false }), true);
    for (let i = 0; i < 5; i++) await turn();
    await vi.advanceTimersByTimeAsync(300);
    update({ step: 1 });
    for (let i = 0; i < 5; i++) await turn();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    root!.unmount();
    root = createRoot(host);
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBe(0);
    quiet();
  });

  it("works without any network or storage", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    const onReady = vi.fn();
    mount(props({ step: 2, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    quiet();
    vi.unstubAllGlobals();
  });
});
