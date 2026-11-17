// @vitest-environment jsdom
// Pinch to zoom with two fingers: the maths, and a two-finger gesture on the pages.
import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "../src";
import { MIN_PINCH_DISTANCE, PinchTracker, anchoredScroll, distance, midpoint, pinchZoom } from "../src/pinch";
import { fire, flush, layerOf, mount, q, tool, useAnnotHost } from "./annotHarness";

describe("the maths", () => {
  it("measures the distance and the middle", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 10 }, { x: 10, y: 30 })).toEqual({ x: 5, y: 20 });
  });

  it("zooms in proportion to how far the fingers moved apart, within the limits", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 200, 100)).toBe(1);
    expect(pinchZoom(1, 100, 100)).toBe(1);
    expect(pinchZoom(1, 100, 1)).toBe(MIN_ZOOM);
    expect(pinchZoom(4, 100, 1000)).toBe(MAX_ZOOM);
    expect(pinchZoom(1.5, 0, 50)).toBe(1.5);
  });

  it("keeps the point under the fingers where it is", () => {
    // scrolled 100 down and 20 right, the fingers at (200, 150) of the area: the page point under them is (220, 250)
    const to = anchoredScroll({ top: 100, left: 20 }, { x: 200, y: 150 }, 2);
    expect(to).toEqual({ top: 350, left: 240 });
    // that point is now at (440, 500) of the content, and 440 - 240 = 200, 500 - 350 = 150: still under the fingers
    expect(anchoredScroll({ top: 100, left: 0 }, { x: 0, y: 0 }, 0.5)).toEqual({ top: 50, left: 0 });
    expect(anchoredScroll({ top: 0, left: 0 }, { x: 100, y: 100 }, 0.5)).toEqual({ top: 0, left: 0 }); // never scrolls above the top
  });
});

describe("following the fingers", () => {
  it("does nothing for one finger, and starts a pinch with the second", () => {
    const t = new PinchTracker();
    expect(t.down(1, { x: 100, y: 100 }, 1)).toBe(false);
    expect(t.active).toBe(false);
    expect(t.owns(1)).toBe(false);
    expect(t.move(1, { x: 120, y: 100 })).toBeNull();
    expect(t.down(2, { x: 220, y: 100 }, 1)).toBe(true);
    expect(t.active).toBe(true);
    expect(t.owns(1) && t.owns(2)).toBe(true);
  });

  it("reports the zoom, the middle and how far the middle moved", () => {
    const t = new PinchTracker();
    t.down(1, { x: 100, y: 100 }, 1);
    t.down(2, { x: 200, y: 100 }, 1.5);
    const a = t.move(2, { x: 300, y: 100 })!;
    expect(a.zoom).toBeCloseTo(3, 5); // 100 apart became 200: twice 1.5
    expect(a.anchor).toEqual({ x: 200, y: 100 });
    expect(a.pan).toEqual({ x: 50, y: 0 });
    const b = t.move(1, { x: 100, y: 140 })!;
    expect(b.pan).toEqual({ x: 0, y: 20 });
    expect(b.zoom).toBeCloseTo(1.5 * (Math.hypot(200, 40) / 100), 5);
  });

  it("ignores two fingers that are too close to follow, and a finger that was not part of the pair", () => {
    const t = new PinchTracker();
    t.down(1, { x: 100, y: 100 }, 1);
    expect(t.down(2, { x: 100 + MIN_PINCH_DISTANCE - 1, y: 100 }, 1)).toBe(false);
    expect(t.active).toBe(false);
    expect(t.down(3, { x: 300, y: 100 }, 1)).toBe(true); // the second finger that counts
    expect(t.move(2, { x: 0, y: 0 })).toBeNull();
  });

  it("ends when a finger lifts and keeps the other one out of the tools until it lifts too", () => {
    const t = new PinchTracker();
    t.down(1, { x: 0, y: 0 }, 1);
    t.down(2, { x: 100, y: 0 }, 1);
    t.up(1);
    expect(t.active).toBe(false);
    expect(t.owns(2)).toBe(true);
    expect(t.move(2, { x: 150, y: 0 })).toBeNull();
    t.up(2);
    expect(t.owns(2)).toBe(false);
    // a new pair can start
    t.down(3, { x: 0, y: 0 }, 2);
    expect(t.down(4, { x: 50, y: 0 }, 2)).toBe(true);
  });
});

useAnnotHost();

/** A touch pointer event on the pages: jsdom's mouse events carry the extra fields. */
const touch = async (el: Element, type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", id: number, x: number, y: number) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  Object.assign(e, { pointerId: id, pointerType: "touch" });
  await fire(el, e);
};
const zoomLabel = () => q(".pli-pdf-zoom-label").textContent!.replace(/\s/g, "");

describe("pinching the pages", () => {
  const scroller = () => q(".pli-pdf-scroller");

  it("zooms around the middle of the fingers and scrolls with the middle", async () => {
    await mount({ zoom: 1 });
    expect(zoomLabel()).toContain("100%");
    const el = scroller();
    el.scrollTop = 100;
    el.scrollLeft = 0;
    await touch(el, "pointerdown", 1, 100, 150);
    await touch(el, "pointerdown", 2, 300, 150);
    await touch(el, "pointermove", 2, 500, 150); // 200 apart became 400: twice
    await flush();
    expect(zoomLabel()).toContain("200%");
    // the point under the middle (300, 150) stayed: (100 + 150) * 2 - 150
    expect(el.scrollTop).toBe(350);
    await touch(el, "pointerup", 2, 500, 150);
    await touch(el, "pointerup", 1, 100, 150);
    await touch(el, "pointerdown", 3, 100, 150);
    await touch(el, "pointerdown", 4, 150, 150);
    await touch(el, "pointermove", 4, 120, 150); // 50 apart became 20: 0.4 of 200%
    await flush();
    expect(zoomLabel()).toContain("80%");
  });

  it("does not touch the zoom for a finger, a pen or a mouse", async () => {
    await mount({ zoom: 1 });
    const el = scroller();
    await touch(el, "pointerdown", 1, 100, 150);
    await touch(el, "pointermove", 1, 300, 150);
    await touch(el, "pointerup", 1, 300, 150);
    const mouse = async (type: string, id: number, x: number) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 150, button: 0, buttons: 1 });
      Object.assign(e, { pointerId: id, pointerType: "mouse" });
      await fire(el, e);
    };
    await mouse("pointerdown", 1, 100);
    await mouse("pointerdown", 2, 300);
    await mouse("pointermove", 2, 600);
    await flush();
    expect(zoomLabel()).toContain("100%");
  });

  it("stops the browser's own scroll and zoom while two fingers are down", async () => {
    await mount({ zoom: 1 });
    const el = scroller();
    const move = (touches: number) => {
      const e = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.assign(e, { touches: new Array(touches).fill({}) });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(move(1)).toBe(false);
    expect(move(2)).toBe(true);
  });

  it("drops a stroke the first finger began, and draws nothing with the second", async () => {
    const m = await mount({ zoom: 1 });
    await tool("Pen");
    const layer = layerOf();
    const el = scroller();
    // one finger draws, as before
    await touch(layer, "pointerdown", 1, 100, 100);
    await touch(layer, "pointermove", 1, 140, 130);
    await touch(layer, "pointermove", 1, 180, 100);
    await touch(layer, "pointerup", 1, 180, 100);
    expect(m.session.doc.pages[0]!.annots).toHaveLength(1);
    // a second finger arrives in the middle of a stroke: the stroke is dropped and the pages zoom
    await touch(layer, "pointerdown", 2, 100, 300);
    await touch(layer, "pointermove", 2, 140, 330);
    await touch(layer, "pointerdown", 3, 400, 300);
    await touch(layer, "pointermove", 3, 600, 300);
    await touch(layer, "pointerup", 3, 600, 300);
    await touch(layer, "pointerup", 2, 140, 330);
    await flush();
    expect(m.session.doc.pages[0]!.annots).toHaveLength(1);
    expect(m.c().draft).toBeNull();
    expect(zoomLabel()).not.toContain("100%");
    expect(el.scrollTop).toBeGreaterThanOrEqual(0);
    // and a finger left over after the pinch draws nothing either, but the next touch does
    await touch(layer, "pointerdown", 5, 100, 100);
    await touch(layer, "pointermove", 5, 140, 130);
    await touch(layer, "pointermove", 5, 180, 100);
    await touch(layer, "pointerup", 5, 180, 100);
    expect(m.session.doc.pages[0]!.annots).toHaveLength(2);
  });
});
