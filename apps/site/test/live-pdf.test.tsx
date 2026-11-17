// @vitest-environment jsdom
/**
 * What this covers: the PDF editor body, the story and the director, against the real engine (the sample file made by
 * `makeSamplePdf`, the real text search, the real annotation and form commands) and the real editor components. What it
 * cannot cover: pdf.js. In jsdom there is no canvas, so the renderer is the test renderer of `@pli.dev/pdf-react/testing`
 * (labelled rectangles for pages); that the real pdf.js draws the sample file is not checked here.
 */
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pdf.js needs a real canvas: the editor draws with the test renderer instead.
vi.mock("@pli.dev/pdf-react/pdfjs", async () => {
  const { fakeRenderer } = await import("@pli.dev/pdf-react/testing");
  return { pdfjsRenderer: () => fakeRenderer({ pages: 2 }) };
});

import PdfLive from "../src/live/PdfLive";
import { FIRST_MS, GAP_MS, PdfDirector } from "../src/live/pdf/director";
import { PDF_STEPS, SIGNER, YOU, loopAround, openSample, planFor, scribble, showStep, stateOf } from "../src/live/pdf/script";
import type { LiveBodyProps } from "../src/live/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warns = vi.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  errors.mockRestore();
  warns.mockRestore();
});

const props = (over: Partial<LiveBodyProps> = {}): LiveBodyProps => ({ step: 0, steps: 3, interactive: false, reducedMotion: true, mode: "story", onReady: () => {}, ...over });
const mount = (p: LiveBodyProps, strict = false) => act(async () => root.render(strict ? <StrictMode><PdfLive {...p} /></StrictMode> : <PdfLive {...p} />));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
/** Lets the engine make the file and the editor draw its pages. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await advance(20);
};

/** What the editor shows of the story, read from its DOM. */
function shown() {
  // highlights are drawn in a layer of their own (they multiply with the page), so the DOM order is not the story's order
  const mine = () => [...host.querySelectorAll(`[data-annot^="site-"]`)].map((e) => e.getAttribute("data-annot")!).sort();
  const widgets = [...host.querySelectorAll<HTMLInputElement>(".pli-form-widget input, .pli-form-widget textarea")];
  return {
    annots: mine(),
    types: [...host.querySelectorAll(`[data-annot^="site-"]`)].map((e) => e.getAttribute("data-type")).sort(),
    text: widgets.filter((w) => w.type === "text").map((w) => w.value),
    checked: widgets.filter((w) => w.type === "checkbox").map((w) => w.checked),
  };
}

describe("the PDF editor on the site", () => {
  it("renders the real editor on the sample file and calls onReady once, after the first page is drawn", async () => {
    const onReady = vi.fn();
    await mount(props({ onReady }));
    await settle();
    expect(host.querySelector(".pli-pdf")).not.toBeNull();
    expect(host.querySelector(".pli-pdf-ribbon")).not.toBeNull(); // the annotation tools
    expect(host.querySelectorAll(".pli-pdf-page").length).toBeGreaterThan(0);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(shown().annots).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it("shows each step's annotations and form values when they are given at once (reduced motion)", async () => {
    const seen = [];
    for (const step of [0, 1, 2]) {
      act(() => root.unmount());
      host.replaceChildren();
      root = createRoot(host);
      await mount(props({ step }));
      await settle();
      seen.push(shown());
    }
    expect(seen[0]!.annots).toEqual([]);
    expect(seen[0]!.text).toEqual([""]);
    expect(seen[1]!.annots).toEqual(["site-hl-fill", "site-hl-made", "site-ul-nothing"]);
    expect(seen[1]!.types).toEqual(["highlight", "highlight", "underline"]);
    expect(seen[2]!.annots.length).toBe(3 + 3);
    expect(seen[2]!.types).toEqual(["highlight", "highlight", "ink", "note", "signature", "underline"]);
    expect(seen[2]!.text).toEqual([SIGNER]);
    expect(seen[2]!.checked).toEqual([true]);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it("goes 2 -> 0 -> 2 in the same editor and ends in the same state", async () => {
    await mount(props({ step: 2 }));
    await settle();
    const editor = host.querySelector(".pli-pdf");
    const first = shown();
    await mount(props({ step: 0 }));
    await settle();
    expect(shown()).toMatchObject({ annots: [], text: [""], checked: [false] });
    await mount(props({ step: 2 }));
    await settle();
    expect(shown()).toEqual(first);
    expect(host.querySelector(".pli-pdf")).toBe(editor);
  });

  it("draws a step's annotations one at a time when motion is allowed", async () => {
    await mount(props({ step: 0, reducedMotion: false }));
    await settle();
    await mount(props({ step: 1, reducedMotion: false }));
    expect(shown().annots).toEqual([]);
    await advance(FIRST_MS + 20);
    expect(shown().annots).toEqual(["site-hl-made"]);
    await advance(GAP_MS);
    expect(shown().annots).toEqual(["site-hl-made", "site-ul-nothing"]);
    await advance(GAP_MS);
    expect(shown().annots.length).toBe(3);
    // a step that changes while it is being drawn is brought to its own state at once
    await mount(props({ step: 2, reducedMotion: false }));
    await advance(FIRST_MS + GAP_MS + 20);
    expect(shown().annots.length).toBeGreaterThan(3);
    await mount(props({ step: 0, reducedMotion: false }));
    expect(shown().annots).toEqual([]);
    expect(vi.getTimerCount()).toBeLessThan(5); // no step is still being played
  });

  it("stops scripting when the visitor takes the editor, and leaves no timers after unmount", async () => {
    const onReady = vi.fn();
    await mount(props({ step: 0, reducedMotion: false, onReady }), true);
    await settle();
    await mount(props({ step: 1, reducedMotion: false, onReady }), true);
    await advance(FIRST_MS + 20);
    await mount(props({ step: 1, reducedMotion: false, interactive: true, onReady }), true);
    const frozen = shown().annots;
    await advance(10000);
    expect(shown().annots).toEqual(frozen);
    expect(frozen.length).toBeLessThan(3);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await advance(20000);
    expect(onReady.mock.calls.length).toBeLessThanOrEqual(2);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    root = createRoot(host);
  });
});

describe("the PDF story and director on the real engine (no React)", () => {
  it("finds real text rectangles on page 1 for each highlight and the title", async () => {
    const session = await openSample();
    const plan = await planFor(session);
    showStep(session, plan, 1);
    const page = session.doc.pages[0]!;
    const byId = (id: string) => session.annots.get(id)!;
    for (const id of ["site-hl-made", "site-ul-nothing", "site-hl-fill"]) {
      const a = byId(id);
      expect(a, id).toBeDefined();
      if (a.type !== "highlight" && a.type !== "underline") throw new Error("wrong type");
      expect(a.rects.length).toBe(1);
      for (const r of a.rects) {
        // inside the page, a line of 12 point text tall and not a sliver or a block
        expect(r.x).toBeGreaterThanOrEqual(60);
        expect(r.x + r.w).toBeLessThanOrEqual(page.width - 40);
        expect(r.h).toBeGreaterThan(8);
        expect(r.h).toBeLessThan(20);
      }
    }
    // the two lines of the intro are different lines, and "made in your browser" is on the first of them
    const top = (id: string) => (byId(id) as { rects: { y: number }[] }).rects[0]!.y;
    expect(top("site-hl-made")).toBeLessThan(top("site-hl-fill"));
    expect(session.annots.list(page.id).filter((a) => a.id.startsWith("site-")).length).toBe(3);
  });

  it("reaches the same document for a step by any route, and back to the untouched file", async () => {
    const session = await openSample();
    const plan = await planFor(session);
    const untouched = stateOf(session);
    showStep(session, plan, 2);
    const two = stateOf(session);
    expect(two.annots[0]!.filter((a) => a.id.startsWith("site-")).length).toBe(6);
    expect(two.fields.find(([n]) => n === "name")![1]).toBe(SIGNER);
    showStep(session, plan, 1);
    expect(stateOf(session).annots[0]!.filter((a) => a.id.startsWith("site-")).length).toBe(3);
    showStep(session, plan, 0);
    expect(stateOf(session)).toEqual(untouched);
    showStep(session, plan, 2);
    expect(stateOf(session)).toEqual(two);
    showStep(session, plan, 2); // idempotent
    expect(stateOf(session)).toEqual(two);
    // the same on a second session made from scratch
    const other = await openSample();
    showStep(other, await planFor(other), 2);
    expect(stateOf(other).annots).toEqual(two.annots);
    expect(PDF_STEPS).toBe(3);
  });

  it("the director plays forward by one step with gaps, and jumps otherwise", async () => {
    const session = await openSample();
    const plan = await planFor(session);
    const d = new PdfDirector(session, plan, 0);
    const count = () => session.doc.pages[0]!.annots.filter((a) => a.id.startsWith("site-")).length;
    d.goTo(1, true);
    expect(d.settled).toBeNull();
    expect(count()).toBe(0);
    vi.advanceTimersByTime(FIRST_MS);
    expect(count()).toBe(1);
    vi.advanceTimersByTime(GAP_MS * 2);
    expect(count()).toBe(3);
    expect(d.settled).toBe(1);
    d.goTo(2, true);
    vi.advanceTimersByTime(FIRST_MS + GAP_MS * 4);
    expect(d.settled).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    d.goTo(0, true); // backward: at once
    expect(count()).toBe(0);
    expect(d.settled).toBe(0);
    d.goTo(2, true); // a jump of two: at once
    expect(count()).toBe(6);
    d.release();
    expect(d.settled).toBeNull();
    d.goTo(2, true); // after the visitor: rebuilt
    expect(d.settled).toBe(2);
    d.dispose();
    d.goTo(0, false);
    expect(count()).toBe(6);
  });

  it("makes a loop around the title and a signature that stay inside their boxes", () => {
    const loop = loopAround({ x: 72, y: 62, w: 200, h: 34 });
    expect(loop.length).toBeGreaterThan(20);
    for (const [x] of loop) {
      expect(x).toBeGreaterThan(30);
      expect(x).toBeLessThan(320);
    }
    expect(loopAround({ x: 72, y: 62, w: 200, h: 34 })).toEqual(loop);
    for (const stroke of scribble(190, 40)) for (const [x, y] of stroke) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(190);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(40);
    }
    expect(YOU.id).toBe("you");
  });
});
