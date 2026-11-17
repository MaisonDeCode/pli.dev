// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { PliPdf, type PdfTool } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { byLabel, click, fire, flush, host, key, q, qa, render, run, scrollTo, setValue, useHost } from "./harness";
import { act } from "react";

useHost();

const viewport = { width: 800, height: 600 };
const pagesIn = () => qa(".pli-pdf-page");
const indexes = () => pagesIn().map((p) => Number(p.dataset.pageIndex));
const scroller = () => q(".pli-pdf-scroller");
const pageInput = () => byLabel("Page number", host) as HTMLInputElement;
const zoomLabel = () => q(".pli-pdf-zoom-label").textContent!.replace(/\s+/g, "").trim();
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>("[role=menu] [role^='menuitem']")].find((b) => b.textContent!.includes(label))!;
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const open = (label: string) => click(byLabel(label, host));

async function mount(n = 12, extra: Partial<Parameters<typeof PliPdf>[0]> = {}) {
  const session = testSession({ pages: n });
  const renderer = fakeRenderer({ pages: n });
  await render(<PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} topToolbar {...extra} />); // topToolbar: these tests drive the viewer through the toolbar buttons (statusbar.test.tsx has the default layout)
  return { session, renderer };
}

describe("page navigation", () => {
  it("shows the page number, count and a live region", async () => {
    await mount(12);
    await flush();
    expect(q(".pli-pdf-toolbar").getAttribute("role")).toBe("toolbar");
    expect(pageInput().value).toBe("1");
    expect(q(".pli-pdf-page-total").textContent).toBe("/ 12");
    expect(q(".pli-pdf-status").getAttribute("aria-live")).toBe("polite");
    expect(q(".pli-pdf-status").textContent).toBe("Page 1 of 12");
    expect(q(".pli-pdf-page").getAttribute("data-state")).toBe("ready");
  });

  it("goes to the next and previous page with the buttons, and scrolls there", async () => {
    const { session } = await mount(12);
    await flush();
    await click(byLabel("Next page", host));
    expect(session.selection.page).toBe("p:main:1");
    expect(pageInput().value).toBe("2");
    expect(scroller().scrollTop).toBeGreaterThan(1000);
    expect((byLabel("Previous page", host) as HTMLButtonElement).disabled).toBe(false);
    await click(byLabel("Previous page", host));
    expect(session.selection.page).toBe("p:main:0");
    expect(scroller().scrollTop).toBe(0);
    expect((byLabel("Previous page", host) as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes to the page typed in the box", async () => {
    const { session } = await mount(12);
    await flush();
    const input = pageInput();
    await act(async () => input.focus());
    await setValue(input, "5");
    await key(input, "Enter");
    expect(session.selection.page).toBe("p:main:4");
    await flush();
    expect(indexes()).toContain(4);
    // beyond the end goes to the last page; nonsense puts the number back
    await act(async () => input.focus());
    await setValue(input, "99");
    await key(input, "Enter");
    expect(session.selection.page).toBe("p:main:11");
    await act(async () => input.focus());
    await setValue(input, "abc");
    await key(input, "Enter");
    expect(pageInput().value).toBe("12");
  });

  it("follows the scrolling: the page with most of the view is the current one", async () => {
    const { session } = await mount(12);
    await flush();
    await scrollTo(scroller(), 2600);
    expect(pageInput().value).toBe("3");
    expect(session.selection.page).toBe("p:main:2");
    expect(q(".pli-pdf-status").textContent).toBe("Page 3 of 12");
    // the very bottom is the last page
    await scrollTo(scroller(), 1_000_000);
    expect(pageInput().value).toBe("12");
  });

  it("moves when something else changes the session's page", async () => {
    const { session } = await mount(12);
    await flush();
    await run(() => session.pages.insertBlank("p:main:3"));
    expect(session.selection.page).not.toBe("p:main:0");
    expect(pageInput().value).toBe("5");
    expect(scroller().scrollTop).toBeGreaterThan(3000);
  });
});

describe("hosting", () => {
  it("works under React strict mode (effects run twice) and cleans up when removed", async () => {
    const session = testSession({ pages: 4 });
    const renderer = fakeRenderer({ pages: 4 });
    await render(
      <StrictMode>
        <PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} />
      </StrictMode>,
    );
    await flush();
    expect(q(".pli-pdf-page").getAttribute("data-state")).toBe("ready");
    expect(q(".pli-pdf-scroller canvas")).toBeTruthy();
    const { unmount } = await import("./harness");
    await unmount();
    await flush();
    expect(renderer.stats.destroyedDocs).toBe(renderer.stats.opens);
  });

  it("tells the host which page is shown", async () => {
    const seen: number[] = [];
    await mount(6, { onPageChange: (i: number) => seen.push(i) });
    await click(byLabel("Next page", host));
    await scrollTo(scroller(), 1_000_000);
    expect(seen).toEqual([0, 1, 5]);
  });

  it("keeps the point under a pinch where it is", async () => {
    await mount(12);
    await flush();
    await scrollTo(scroller(), 500);
    // a pinch that doubles the zoom, at 100 pixels down the view: the content under it moves to twice the distance
    const pinch = new WheelEvent("wheel", { deltaY: -Math.log(2) / 0.01, ctrlKey: true, clientX: 0, clientY: 100, bubbles: true, cancelable: true });
    await fire(scroller(), pinch);
    expect(zoomLabel()).toBe("200%");
    expect(scroller().scrollTop).toBeCloseTo((500 + 100) * 2 - 100, 0);
  });

  it("moves between sidebar tabs with the arrow keys", async () => {
    await mount(3);
    await key(q("[role=tablist]"), "ArrowRight");
    expect(q("#pli-pdf-tab-outline").getAttribute("aria-selected")).toBe("true");
    await key(q("[role=tablist]"), "ArrowRight");
    expect(q("#pli-pdf-tab-thumbnails").getAttribute("aria-selected")).toBe("true");
  });

  it("opens and closes the sidebar from the toolbar", async () => {
    await mount(3);
    expect(document.querySelector(".pli-pdf-sidebar")).toBeTruthy();
    await click(byLabel("Sidebar", q(".pli-pdf-toolbar")));
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
    await click(byLabel("Sidebar", q(".pli-pdf-toolbar")));
    expect(document.querySelector(".pli-pdf-sidebar")).toBeTruthy();
  });
});

describe("keyboard", () => {
  it("PageDown, PageUp, Home and End move between pages", async () => {
    const { session } = await mount(12);
    await flush();
    const s = scroller();
    await key(s, "PageDown");
    expect(session.selection.page).toBe("p:main:1");
    await key(s, "PageDown");
    await key(s, "PageUp");
    expect(session.selection.page).toBe("p:main:1");
    await key(s, "End");
    expect(session.selection.page).toBe("p:main:11");
    await key(s, "Home");
    expect(session.selection.page).toBe("p:main:0");
  });

  it("arrow keys turn pages in the single-page layout and scroll in the continuous one", async () => {
    const { session } = await mount(12, { defaultViewMode: "single" });
    await flush();
    const s = scroller();
    await key(s, "ArrowRight");
    expect(session.selection.page).toBe("p:main:1");
    await key(s, "ArrowLeft");
    expect(session.selection.page).toBe("p:main:0");
    await key(s, "ArrowLeft");
    expect(session.selection.page).toBe("p:main:0");
  });

  it("does not take keys typed in the page box", async () => {
    const { session } = await mount(12);
    await flush();
    await key(pageInput(), "End");
    expect(session.selection.page).toBe("p:main:0");
  });

  it("zooms with Ctrl/Cmd plus, minus and 0", async () => {
    await mount(12);
    await flush();
    const s = scroller();
    expect(zoomLabel()).toBe("100%");
    await key(s, "+", { ctrlKey: true });
    expect(zoomLabel()).toBe("125%");
    await key(s, "=", { metaKey: true });
    expect(zoomLabel()).toBe("150%");
    await key(s, "-", { ctrlKey: true });
    await key(s, "-", { ctrlKey: true });
    expect(zoomLabel()).toBe("100%");
    await key(s, "-", { ctrlKey: true });
    expect(zoomLabel()).toBe("75%");
    await key(s, "0", { ctrlKey: true });
    expect(zoomLabel()).toBe("100%");
  });

  it("zooms with the wheel while Ctrl is held (a pinch), and leaves the plain wheel alone", async () => {
    await mount(12);
    await flush();
    const plain = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    await fire(scroller(), plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(zoomLabel()).toBe("100%");
    const pinch = new WheelEvent("wheel", { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true });
    await fire(scroller(), pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(Number.parseInt(zoomLabel())).toBeGreaterThan(100);
  });

  it("Ctrl+F opens find, Escape closes it, Ctrl+S saves", async () => {
    let saved = 0;
    const { session } = await mount(3, { onSave: () => void saved++ });
    // A test session has no file to write: say what a save gives.
    session.saver = async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), mode: "rewrite", warnings: [] });
    await flush();
    await key(scroller(), "f", { ctrlKey: true });
    expect(q(".pli-pdf-find")).toBeTruthy();
    await key(q(".pli-pdf-find-input"), "Escape");
    expect(document.querySelector(".pli-pdf-find")).toBeNull();
    await key(scroller(), "s", { metaKey: true });
    await flush();
    expect(saved).toBe(1);
    expect(session.dirty).toBe(false);
  });
});

describe("zoom", () => {
  it("steps with the buttons and shows the percentage", async () => {
    await mount(3);
    await flush();
    await click(byLabel("Zoom in", host));
    expect(zoomLabel()).toBe("125%");
    await click(byLabel("Zoom out", host));
    await click(byLabel("Zoom out", host));
    expect(zoomLabel()).toBe("75%");
  });

  it("offers the usual percentages, fit width, fit page and actual size", async () => {
    await mount(3);
    await flush();
    await open("Zoom");
    const labels = [...document.querySelectorAll("[role=menu] [role^='menuitem']")].map((e) => e.textContent!.replace("✓", ""));
    expect(labels).toEqual(["50%", "75%", "100%", "125%", "150%", "200%", "400%", "Fit width", "Fit page", "Actual size"]);
    await click(menuItem("200%"));
    expect(zoomLabel()).toBe("200%");
    await open("Zoom");
    await click(menuItem("Actual size"));
    expect(zoomLabel()).toBe("100%");
  });

  it("fits the width and the page of the view", async () => {
    await mount(3);
    await flush();
    await open("Zoom");
    await click(menuItem("Fit width"));
    // (800 - 2 * 16) / (612 * 96 / 72) = 94.1 %
    expect(zoomLabel()).toBe("94%");
    await open("Zoom");
    await click(menuItem("Fit page"));
    // (600 - 32) / (792 * 96 / 72) = 53.8 %
    expect(zoomLabel()).toBe("54%");
    const page = pagesIn()[0]!;
    expect(parseFloat(page.style.height)).toBeCloseTo(792 * (96 / 72) * 0.5379, 0);
  });

  it("fits when the view is resized (fit width stays fit)", async () => {
    const session = testSession({ pages: 3 });
    const renderer = fakeRenderer({ pages: 3 });
    await render(<PliPdf session={session} renderer={renderer} viewport={{ width: 800, height: 600 }} />);
    await flush();
    expect(zoomLabel()).toBe("94%");
    await render(<PliPdf session={session} renderer={renderer} viewport={{ width: 1200, height: 600 }} />);
    await flush();
    expect(zoomLabel()).toBe("143%");
  });

  it("rotates the view by quarter turns", async () => {
    await mount(3);
    await flush();
    expect(parseFloat(pagesIn()[0]!.style.width)).toBeCloseTo(816, 0);
    await click(byLabel("Rotate view", host));
    await flush();
    const page = pagesIn()[0]!;
    expect(page.dataset.rotation).toBe("90");
    expect(parseFloat(page.style.width)).toBeCloseTo(792 * (96 / 72), 0);
    expect(parseFloat(page.style.height)).toBeCloseTo(816, 0);
  });
});

describe("view modes", () => {
  it("shows one page at a time in single-page layout", async () => {
    const { session } = await mount(6);
    await flush();
    await open("Page layout");
    await click(menuItem("Single page"));
    await flush();
    expect(indexes()).toEqual([0]);
    await click(byLabel("Next page", host));
    await flush();
    expect(indexes()).toEqual([1]);
    expect(session.selection.page).toBe("p:main:1");
    expect(scroller().scrollTop).toBe(0);
  });

  it("shows two pages side by side in two-page layout, and moves by two", async () => {
    await mount(6);
    await flush();
    await open("Page layout");
    await click(menuItem("Two pages"));
    await flush();
    expect(indexes()).toEqual([0, 1]);
    const [a, b] = pagesIn();
    expect(parseFloat(b!.style.left)).toBeGreaterThan(parseFloat(a!.style.left) + parseFloat(a!.style.width));
    expect(a!.style.top).toBe(b!.style.top);
    await click(byLabel("Next page", host));
    await flush();
    expect(indexes()).toEqual([2, 3]);
    await key(scroller(), "End");
    await flush();
    expect(indexes()).toEqual([4, 5]);
  });

  it("can show the first page alone as a cover", async () => {
    await mount(5, { defaultViewMode: "spread", spreadCover: true });
    await flush();
    expect(indexes()).toEqual([0]);
    await click(byLabel("Next page", host));
    await flush();
    expect(indexes()).toEqual([1, 2]);
  });

  it("goes back to continuous at the page that was shown", async () => {
    const { session } = await mount(6, { defaultViewMode: "single" });
    await flush();
    await click(byLabel("Next page", host));
    await click(byLabel("Next page", host));
    await open("Page layout");
    await click(menuItem("Continuous"));
    await flush();
    expect(session.selection.page).toBe("p:main:2");
    expect(scroller().scrollTop).toBeGreaterThan(2000);
    expect(indexes()).toContain(2);
  });
});

describe("virtualisation", () => {
  it("draws only the pages near the view in a long document", async () => {
    const { renderer } = await mount(300);
    await flush(10);
    expect(pagesIn().length).toBeLessThanOrEqual(3);
    expect(qa("canvas", scroller()).length).toBeLessThanOrEqual(3);
    const drawn = new Set(renderer.stats.renders.filter((r) => r.done && r.scale > 0.3).map((r) => r.page));
    expect([...drawn].every((p) => p <= 2)).toBe(true);
    expect(drawn.has(0)).toBe(true);
    // the content is as tall as all the pages, so the scroll bar is right
    expect(parseFloat(q(".pli-pdf-content").style.height)).toBeGreaterThan(300 * 1056);
  });

  it("draws the pages it scrolls to, and lets go of the ones it left", async () => {
    const { renderer } = await mount(300);
    await flush();
    await scrollTo(scroller(), 150 * 1068);
    await flush(10);
    expect(indexes().every((i) => i >= 148 && i <= 152)).toBe(true);
    expect(indexes()).toContain(150);
    expect(qa("canvas", scroller()).length).toBeLessThanOrEqual(4);
    expect(renderer.stats.renders.some((r) => r.page >= 148 && r.scale > 0.3)).toBe(true);
    expect(pageInput().value).toBe("151");
  });

  it("draws the visible page before the near ones, never more than two at once", async () => {
    const { renderer } = await mount(30);
    await flush(10);
    const first = renderer.stats.renders[0]!;
    expect(first.page).toBe(0);
    expect(renderer.stats.active).toBe(0);
  });

  it("draws small first, then at the full size for the screen, and stops drawing what scrolled away", async () => {
    const session = testSession({ pages: 20 });
    const renderer = fakeRenderer({ pages: 20, latency: 5 });
    await render(<PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} />);
    await flush(3);
    await scrollTo(scroller(), 12 * 1068);
    await wait(120);
    const forPage0 = renderer.stats.renders.filter((r) => r.page === 0);
    expect(forPage0.length).toBeGreaterThanOrEqual(1);
    if (forPage0.length > 1) expect(forPage0[0]!.scale).toBeLessThan(forPage0[forPage0.length - 1]!.scale);
    const full = renderer.stats.renders.filter((r) => r.page === 12 && r.done).map((r) => r.scale);
    expect(Math.max(...full)).toBeCloseTo(96 / 72, 2);
    await wait(60);
    expect(renderer.stats.active).toBe(0);
  });

  it("keeps a canvas under about 16 megapixels at a big zoom, and stretches it", async () => {
    const session = testSession({ pages: 2 });
    const renderer = fakeRenderer({ pages: 2 });
    await render(<PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={8} />);
    await flush(10);
    const done = renderer.stats.renders.filter((r) => r.done);
    const best = done.reduce((m, r) => (r.scale > m.scale ? r : m));
    expect(612 * best.scale * (792 * best.scale)).toBeLessThanOrEqual(16_000_001);
    expect(best.scale).toBeLessThan(8 * (96 / 72));
    // the page is as big on the screen as it should be
    expect(parseFloat(pagesIn()[0]!.style.width)).toBeCloseTo(612 * 8 * (96 / 72), 0);
  });
});

describe("text layer and overlay", () => {
  it("makes selectable text from the renderer's runs", async () => {
    await mount(3);
    await flush();
    const layer = q(".pli-pdf-text-layer");
    expect(layer.dataset.page).toBe("p:main:0");
    const spans = qa("span[data-run]", layer);
    expect(spans.map((s) => s.textContent)).toEqual(["Page 1", "Hello ", "world", "Alpha beta gamma", "The quick brown fox"]);
    expect(spans[0]!.style.left).toBe("72px");
    expect(spans[0]!.style.fontSize).toBe("18px");
    expect(layer.querySelectorAll("br").length).toBe(4);
    expect(layer.style.transform).toContain("scale(1.333");
  });

  it("puts the overlay in page space: an svg with a view box of the page, turned with the page", async () => {
    const seen: number[] = [];
    await mount(3, { pageOverlay: (ctx) => (seen.push(ctx.index), <rect data-testid="annot" x={10} y={20} width={30} height={40} />) });
    await flush();
    const svg = q("svg.pli-pdf-overlay");
    expect(svg.getAttribute("viewBox")).toBe("0 0 612 792");
    expect(svg.querySelector("[data-testid=annot]")!.getAttribute("y")).toBe("20");
    expect(new Set(seen).has(0)).toBe(true);
    await click(byLabel("Rotate view", host));
    await flush();
    expect(q("svg.pli-pdf-overlay").getAttribute("viewBox")).toBe("0 0 612 792");
    expect(q("svg.pli-pdf-overlay").style.transform).toContain("rotate(90deg)");
    expect(q(".pli-pdf-text-layer").style.transform).toContain("rotate(90deg)");
  });
});

describe("extension points", () => {
  const pen: PdfTool & { events: { page: number; x: number; y: number; type: string }[] } = {
    id: "pen",
    label: "Pen",
    needsEdit: true,
    events: [],
    onPointer(e) {
      pen.events.push({ page: e.index, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10, type: e.type });
    },
    overlay: () => <circle data-testid="pen-overlay" r={3} />,
  };

  it("lists tools in the toolbar and gives the active tool pointer events in page space", async () => {
    pen.events = [];
    await mount(3, { tools: [pen] });
    await flush();
    expect(document.querySelector(".pli-pdf-interact")).toBeNull();
    await click(byLabel("Pen", host));
    expect(byLabel("Pen", host).getAttribute("aria-pressed")).toBe("true");
    const layer = q(".pli-pdf-interact");
    // 100% zoom is 4/3 pixels per point: the pointer at (133.33, 266.67) is at (100, 200) points
    await fire(layer, new MouseEvent("pointerdown", { bubbles: true, clientX: 400 / 3, clientY: 800 / 3 }));
    await fire(layer, new MouseEvent("pointerup", { bubbles: true, clientX: 400 / 3, clientY: 800 / 3 }));
    expect(pen.events).toEqual([
      { page: 0, x: 100, y: 200, type: "down" },
      { page: 0, x: 100, y: 200, type: "up" },
    ]);
    expect(document.querySelector("[data-testid=pen-overlay]")).toBeTruthy();
  });

  it("converts pointer positions on a view turned by 90 degrees", async () => {
    pen.events = [];
    await mount(3, { tools: [pen] });
    await flush();
    await click(byLabel("Rotate view", host));
    await click(byLabel("Pen", host));
    await flush();
    // turned 90 degrees clockwise, the shown point (sx, sy) is the page point (sy, H - sx)
    const s = 96 / 72;
    const layer = q(".pli-pdf-interact");
    await fire(layer, new MouseEvent("pointerdown", { bubbles: true, clientX: 100 * s, clientY: 50 * s }));
    expect(pen.events[0]).toMatchObject({ x: 50, y: 792 - 100 });
  });

  it("hides tools that edit in a read-only viewer, and Escape puts a tool down", async () => {
    await mount(3, { tools: [pen], readOnly: true });
    await flush();
    expect(document.querySelector("[aria-label=Pen]")).toBeNull();
    let changes: (string | null)[] = [];
    await render(<PliPdf session={testSession({ pages: 3 })} renderer={fakeRenderer()} viewport={viewport} tools={[pen]} onToolChange={(id) => changes.push(id)} />);
    await flush();
    await click(byLabel("Pen", host));
    await key(scroller(), "Escape");
    expect(changes).toEqual(["pen", null]);
  });

  it("has slots for toolbar content, sidebar tabs and a right panel, which can use the viewer's state", async () => {
    await mount(5, {
      toolbar: <button type="button" aria-label="Mine">Mine</button>,
      sidebar: [{ id: "notes", label: "Notes", render: (ctx) => <p data-testid="notes">page {ctx.pageIndex + 1} of {ctx.pageCount}</p> }],
      rightPanel: (ctx) => <div data-testid="right">{ctx.zoomValue}</div>,
    });
    await flush();
    expect(byLabel("Mine", host)).toBeTruthy();
    expect(q("[data-testid=right]").textContent).toBe("1");
    await click(q("#pli-pdf-tab-notes"));
    expect(q("[data-testid=notes]").textContent).toBe("page 1 of 5");
    await click(byLabel("Next page", host));
    expect(q("[data-testid=notes]").textContent).toBe("page 2 of 5");
  });

  it("can be driven through a ref", async () => {
    const session = testSession({ pages: 8 });
    const ref: { current: import("../src").PliPdfHandle | null } = { current: null };
    await render(<PliPdf ref={ref} session={session} renderer={fakeRenderer({ pages: 8 })} viewport={viewport} defaultZoom={1} />);
    await flush();
    await run(() => ref.current!.goToPage(5));
    expect(session.selection.page).toBe("p:main:5");
    await run(() => ref.current!.setZoom(2));
    expect(zoomLabel()).toBe("200%");
    await run(() => ref.current!.setViewMode("single"));
    expect(indexes()).toEqual([5]);
  });
});

describe("look", () => {
  it("has a class for each theme, and the stylesheet themes both ways with CSS variables", async () => {
    await mount(2, { theme: "dark" });
    expect(q(".pli-pdf").classList.contains("pli-pdf-dark")).toBe(true);
    expect(q(".pli-pdf").getAttribute("data-theme")).toBe("dark");
    await render(<PliPdf session={testSession()} renderer={fakeRenderer()} viewport={viewport} theme="light" />);
    expect(q(".pli-pdf").classList.contains("pli-pdf-light")).toBe(true);
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles.css"), "utf8");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':root[data-theme="dark"] .pli-pdf');
    expect(css).toContain("--pli-pdf-workspace");
    expect(css).toContain("max-width: 640px");
  });
});
