// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet, type PliSheetDownload, type PliSheetPrintJob } from "../src";
import { browserRasterizer, chartSvg } from "../src/printPdf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
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
  document.querySelectorAll("iframe").forEach((f) => f.remove());
  vi.restoreAllMocks();
});

const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const overlay = () => document.querySelector<HTMLElement>(".pli-print-overlay")!;
const button = (label: string) => [...overlay().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const pageNumbers = () => [...overlay().querySelectorAll<HTMLElement>(".pli-print-page")].map((p) => p.dataset["page"]);
const current = () => overlay().querySelector<HTMLElement>('.pli-print-sheet[aria-current="page"]')?.dataset["index"];
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const setField = (el: HTMLInputElement, v: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

function mount(props: Partial<React.ComponentProps<typeof PliSheet>> = {}, rows = 150) {
  const session = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => [`row ${r + 1}`, r + 1]));
  act(() => root.render(<PliSheet session={session} {...props} />));
  return session;
}

describe("print preview: pages, a PDF and the host's printing", () => {
  it("shows which page it is on, and goes to the first, previous, next, last and any page", () => {
    mount();
    choose("File", "Print…");
    const total = pageNumbers().length;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(overlay().textContent).toContain(`of ${total}`);
    expect(current()).toBe("1");
    expect(button("Previous page")!.disabled).toBe(true);
    expect(button("First page")!.disabled).toBe(true);
    act(() => void button("Next page")!.click());
    expect(current()).toBe("2");
    act(() => void button("Last page")!.click());
    expect(current()).toBe(String(total));
    expect(button("Next page")!.disabled).toBe(true);
    act(() => void button("First page")!.click());
    expect(current()).toBe("1");
    setField(overlay().querySelector<HTMLInputElement>('[aria-label="Page number"]')!, "3");
    expect(current()).toBe("3");
    expect(overlay().querySelector<HTMLInputElement>('[aria-label="Page number"]')!.value).toBe("3");
  });

  it("goes through the pages with PageDown, PageUp, Home and End", () => {
    mount();
    choose("File", "Print…");
    const total = pageNumbers().length;
    const key = (k: string) => act(() => void overlay().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
    key("PageDown");
    expect(current()).toBe("2");
    key("PageDown");
    key("PageUp");
    expect(current()).toBe("2");
    key("End");
    expect(current()).toBe(String(total));
    key("Home");
    expect(current()).toBe("1");
  });

  it("can show one page at a time, the one it is on", () => {
    mount();
    choose("File", "Print…");
    const total = pageNumbers().length;
    act(() => void overlay().querySelector<HTMLInputElement>('[aria-label="One page at a time"]')!.click());
    expect(pageNumbers()).toEqual(["1"]);
    act(() => void button("Next page")!.click());
    expect(pageNumbers()).toEqual(["2"]);
    expect(overlay().querySelector(".pli-print-page")!.textContent).toContain("row ");
    act(() => void button("Last page")!.click());
    expect(pageNumbers()).toEqual([String(total)]);
    act(() => void overlay().querySelector<HTMLInputElement>('[aria-label="One page at a time"]')!.click());
    expect(pageNumbers()).toHaveLength(total);
  });

  it("has Download PDF and no Print button unless the host says where printing goes, and doesn't open the browser's dialog", async () => {
    const files: PliSheetDownload[] = [];
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mount({ onDownload: (f) => void files.push(f) });
    choose("File", "Print…");
    expect(button("Print")).toBeUndefined();
    expect(button("Print with the browser…")).toBeUndefined();
    act(() => void button("Download PDF")!.click());
    await wait();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "Budget.pdf", type: "application/pdf" });
    expect(new TextDecoder().decode(files[0]!.data.subarray(0, 8))).toMatch(/^%PDF-1\.7/);
    expect(overlay().querySelector('[role="status"]')!.textContent).toContain("Saved Budget.pdf");
    expect(document.querySelector("iframe")).toBeNull();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("gives the host the printout when Print is pressed: the PDF, the pages, the paper and the pages as HTML", async () => {
    const jobs: PliSheetPrintJob[] = [];
    const s = mount({ onPrint: (job) => void jobs.push(job) });
    s.setPageSetup("Sheet1", { paper: "a4", orientation: "landscape" });
    choose("File", "Print…");
    const total = pageNumbers().length;
    act(() => void button("Print")!.click());
    await wait();
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.sheet).toBe("Sheet1");
    expect(job.pages).toBe(total);
    expect(job.paper.width).toBeCloseTo(841.89, 1);
    expect(job.file).toMatchObject({ name: "Budget.pdf", type: "application/pdf" });
    expect(new TextDecoder().decode(job.file.data.subarray(0, 5))).toBe("%PDF-");
    expect(job.layout.pages).toHaveLength(total);
    expect(job.printed[0]!.html).toContain("row 1");
    expect(overlay().querySelector('[role="status"]')!.textContent).toContain(`Sent ${total} pages to print`);
  });

  it("says so when the host's printing fails, and lets it be tried again", async () => {
    let n = 0;
    mount({ onPrint: () => { if (n++ === 0) throw new Error("The printer is off"); } });
    choose("File", "Print…");
    act(() => void button("Print")!.click());
    await wait();
    const status = overlay().querySelector('[role="status"]')!;
    expect(status.textContent).toContain("The printer is off");
    expect(status.hasAttribute("data-error")).toBe(true);
    expect(button("Print")!.disabled).toBe(false);
    act(() => void button("Print")!.click());
    await wait();
    expect(overlay().querySelector('[role="status"]')!.textContent).toContain("to print");
  });

  it("offers the browser's own dialog only when asked to, and prints every page then even if one at a time was on", async () => {
    vi.useFakeTimers();
    mount({ browserPrint: true }, 150);
    choose("File", "Print…");
    const total = pageNumbers().length;
    act(() => void overlay().querySelector<HTMLInputElement>('[aria-label="One page at a time"]')!.click());
    expect(pageNumbers()).toHaveLength(1);
    act(() => void button("Print with the browser…")!.click());
    const frame = document.querySelector<HTMLIFrameElement>("iframe[aria-hidden=true]")!;
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
    act(() => void vi.advanceTimersByTime(100));
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame.contentDocument!.querySelectorAll(".pli-print-page")).toHaveLength(total);
    vi.useRealTimers();
  });

  it("disables the PDF buttons when there is nothing to print", () => {
    const session = new SheetSession(createWorkbook("Empty"));
    act(() => root.render(<PliSheet session={session} onPrint={() => undefined} />));
    choose("File", "Print…");
    expect(overlay().textContent).toContain("Nothing to print");
    expect(button("Download PDF")!.disabled).toBe(true);
    expect(button("Print")!.disabled).toBe(true);
    expect(button("First page")!.disabled).toBe(true);
  });
});

describe("charts and icons for the PDF", () => {
  it("draws a chart as a standalone SVG of the size asked for, with nothing left over in the page", async () => {
    const session = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45000 });
    session.setValues("Sheet1", "A1", [["a", 1], ["b", 3], ["c", 2]]);
    const chart = session.addChart("Sheet1", { type: "bar", title: "Quantities", series: [{ values: "Sheet1!$B$1:$B$3" }] });
    const before = document.body.children.length;
    const svg = await chartSvg(session, session.state.sheets[0]!.id, chart.id, 300, 200);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("Quantities");
    expect(svg).not.toContain("<title");
    expect(document.body.children.length).toBe(before);
  });

  it("gives no pixels where the browser has no canvas, so the PDF falls back to a frame", async () => {
    const session = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45000 });
    session.setValues("Sheet1", "A1", [["a", 1], ["b", 3]]);
    const chart = session.addChart("Sheet1", { type: "bar", series: [{ values: "Sheet1!$B$1:$B$2" }] });
    const rasterize = browserRasterizer(session);
    expect(await rasterize({ kind: "chart", sheet: session.state.sheets[0]!.id, chart, width: 100, height: 80 })).toBeUndefined();
    expect(await rasterize({ kind: "icon", set: "3Arrows", index: 0, count: 3, size: 14 })).toBeUndefined();
  });
});
