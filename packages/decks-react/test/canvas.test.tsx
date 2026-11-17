// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PliDeck } from "../src";
import { byLabel, click, host, key, menuItem, newSession, pointer, q, qa, render, run, runAsync, useHost } from "./harness";

useHost();

/** A deck on its shape slide: a rectangle at 100,150 (120 by 80) and an ellipse at 400,150 (100 by 100). */
function mount() {
  const s = newSession();
  const slide = s.deck.slides[2]!;
  s.selection = { slide: slide.id, slides: [slide.id], elements: [] };
  render(<PliDeck session={s} />);
  const shapes = slide.elements.filter((e) => e.type === "shape" && !e.placeholder);
  return { s, slide, rect: shapes[0]!, ellipse: shapes[1]!, stage: q(".pli-deck-stage") };
}
const frame = (s: ReturnType<typeof newSession>, slideId: string, id: string) => {
  const e = s.element(slideId, id);
  return { x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation };
};
const sel = (s: ReturnType<typeof newSession>) => s.selection.elements;
const down = (target: Element, x: number, y: number, extra: MouseEventInit = {}) => pointer(target, "pointerdown", x, y, extra);
const move = (x: number, y: number, extra: MouseEventInit = {}) => pointer(window, "pointermove", x, y, extra);
const up = (x = 0, y = 0) => pointer(window, "pointerup", x, y);

describe("canvas selection and moving", () => {
  it("draws the slide with the elements and no selection to start", () => {
    const { rect } = mount();
    expect(q(`[data-element="${rect.id}"]`)).toBeTruthy();
    expect(qa(".pli-deck-selbox").length).toBe(0);
  });

  it("selects on click, shows 8 resize handles and a rotation handle, and clears on a click in empty space", () => {
    const { s, rect, stage } = mount();
    down(stage, 160, 190);
    up(160, 190);
    expect(sel(s)).toEqual([rect.id]);
    expect(qa("[data-handle]").map((h) => h.dataset.handle).sort()).toEqual(["e", "n", "ne", "nw", "rotate", "s", "se", "sw", "w"]);
    down(stage, 650, 350);
    up(650, 350);
    expect(sel(s)).toEqual([]);
    expect(qa("[data-handle]").length).toBe(0);
  });

  it("shift-click adds and removes from the selection", () => {
    const { s, rect, ellipse, stage } = mount();
    down(stage, 160, 190);
    up();
    down(stage, 450, 200, { shiftKey: true });
    up();
    expect(sel(s)).toEqual([rect.id, ellipse.id]);
    down(stage, 450, 200, { shiftKey: true });
    up();
    expect(sel(s)).toEqual([rect.id]);
  });

  it("drags to move as one undo step; ctrl turns off snapping", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    move(180, 195, { ctrlKey: true });
    expect(q<HTMLElement>(`[data-element="${rect.id}"]`, q(".pli-deck-canvas-slide")).style.left).toBe("120px"); // live preview
    move(200, 200, { ctrlKey: true });
    up(200, 200);
    expect(frame(s, slide.id, rect.id)).toMatchObject({ x: 140, y: 160, w: 120, h: 80 });
    run(() => s.undo());
    expect(frame(s, slide.id, rect.id)).toMatchObject({ x: 100, y: 150 });
  });

  it("snaps while moving and draws magenta guides, which go away on release", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    // the rect's centre would be at 300 + 60 = 360: the slide's centre, three points off
    move(160 + 197, 190);
    expect(qa(".pli-deck-guide-edge").length).toBeGreaterThan(0);
    up();
    expect(frame(s, slide.id, rect.id).x! + 60).toBe(360);
    expect(qa(".pli-deck-guide").length).toBe(0);
  });

  it("holds an axis with shift", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    move(200, 192, { ctrlKey: true, shiftKey: true });
    up();
    expect(frame(s, slide.id, rect.id)).toMatchObject({ x: 140, y: 150 });
  });

  it("alt-drag drags a copy and leaves the original; one undo takes both away", () => {
    const { s, slide, rect, stage } = mount();
    const count = s.elementsOf(slide.id).length;
    down(stage, 160, 190, { altKey: true });
    move(200, 190, { ctrlKey: true });
    up();
    expect(s.elementsOf(slide.id).length).toBe(count + 1);
    expect(frame(s, slide.id, rect.id).x).toBe(100);
    const copy = s.elementsOf(slide.id).at(-1)!;
    expect(copy.x).toBe(140);
    expect(sel(s)).toEqual([copy.id]);
    run(() => s.undo());
    expect(s.elementsOf(slide.id).length).toBe(count);
  });

  it("marquee-selects what the rectangle touches", () => {
    const { s, rect, ellipse, stage } = mount();
    down(stage, 640, 330);
    move(90, 140);
    expect(qa(".pli-deck-marquee").length).toBe(1);
    up();
    expect(sel(s).sort()).toEqual([rect.id, ellipse.id].sort());
    expect(qa(".pli-deck-marquee").length).toBe(0);
    expect(qa("[data-handle]").length).toBe(8);
  });

  it("resizes with the handles, keeps the opposite corner, and shift keeps the aspect ratio", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    up();
    down(q('[data-handle="se"]'), 220, 230);
    move(260, 250, { ctrlKey: true });
    up();
    expect(frame(s, slide.id, rect.id)).toMatchObject({ x: 100, y: 150, w: 160, h: 100 });
    down(q('[data-handle="nw"]'), 100, 150);
    move(60, 150, { ctrlKey: true, shiftKey: true });
    up();
    const f = frame(s, slide.id, rect.id);
    expect(f.w! / f.h!).toBeCloseTo(1.6, 1);
    expect(f.x! + f.w!).toBeCloseTo(260);
    expect(f.y! + f.h!).toBeCloseTo(250);
  });

  it("rotates with the rotation handle, in 15 degree steps with shift", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    up();
    down(q('[data-handle="rotate"]'), 160, 124);
    // pointing right of the centre (160,190) is 90 degrees clockwise
    move(260, 190);
    up();
    expect(frame(s, slide.id, rect.id).rotation).toBeCloseTo(90);
    down(q('[data-handle="rotate"]'), 160, 124);
    move(260, 160, { shiftKey: true });
    up();
    expect((frame(s, slide.id, rect.id).rotation ?? 0) % 15).toBe(0);
  });

  it("nudges with the arrow keys, 10 points with shift, and deletes", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    up();
    key(stage, "ArrowRight");
    key(stage, "ArrowDown");
    expect(frame(s, slide.id, rect.id)).toMatchObject({ x: 101, y: 151 });
    key(stage, "ArrowLeft", { shiftKey: true });
    expect(frame(s, slide.id, rect.id).x).toBe(91);
    key(stage, "Delete");
    expect(() => s.element(slide.id, rect.id)).toThrow();
    expect(sel(s)).toEqual([]);
    run(() => s.undo());
    expect(s.element(slide.id, rect.id)).toBeTruthy();
  });

  it("duplicates with Cmd+D, groups with Cmd+Alt+G and selects all with Cmd+A", () => {
    const { s, slide, rect, stage } = mount();
    key(stage, "a", { metaKey: true });
    expect(sel(s).length).toBeGreaterThanOrEqual(3);
    down(stage, 160, 190);
    up();
    const before = s.elementsOf(slide.id).length;
    key(stage, "d", { metaKey: true });
    expect(s.elementsOf(slide.id).length).toBe(before + 1);
    expect(s.element(slide.id, sel(s)[0]!).x).toBe(112);
    key(stage, "a", { metaKey: true });
    key(stage, "g", { metaKey: true, altKey: true });
    expect(s.elementsOf(slide.id).some((e) => e.type === "group")).toBe(true);
    key(stage, "g", { metaKey: true, altKey: true, shiftKey: true });
    expect(s.elementsOf(slide.id).some((e) => e.type === "group")).toBe(false);
    void rect;
  });

  it("changes the stacking order from the Arrange menu", () => {
    const { s, slide, rect, stage } = mount();
    down(stage, 160, 190);
    up();
    click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Arrange"));
    click(menuItem("Order"));
    click(menuItem("Bring to front"));
    expect(s.elementsOf(slide.id).at(-1)!.id).toBe(rect.id);
  });

  it("puts a drawn shape on the slide with the shape tool, and a text box with the text tool", () => {
    const { s, slide, stage } = mount();
    const count = s.elementsOf(slide.id).length;
    click(byLabel("Text box"));
    down(stage, 50, 300);
    move(250, 340);
    expect(qa(".pli-deck-draw").length).toBe(1);
    up(250, 340);
    const box = s.elementsOf(slide.id).at(-1)!;
    expect(box).toMatchObject({ type: "shape", textBox: true, x: 50, y: 300, w: 200, h: 40 });
    expect(q(".pli-deck-editor")).toBeTruthy();
    key(q('[role="textbox"]'), "Escape");
    // an empty text box is not kept
    expect(s.elementsOf(slide.id).length).toBe(count);
    click(byLabel("Line"));
    click(menuItem("Arrow"));
    down(stage, 300, 300);
    move(400, 280);
    up(400, 280);
    const arrow = s.elementsOf(slide.id).at(-1)!;
    expect(arrow).toMatchObject({ type: "shape", geometry: "line", flipV: true, w: 100, h: 20 });
    expect((arrow as { line: { tail: string } }).line.tail).toBe("triangle");
    expect(sel(s)).toEqual([arrow.id]);
  });

  it("draws a shape picked from the shape menu", () => {
    const { s, slide, stage } = mount();
    click(byLabel("Shape"));
    click(document.querySelector<HTMLElement>('.pli-deck-shape-button[aria-label="Oval"]'));
    down(stage, 500, 280);
    move(560, 340);
    up(560, 340);
    expect(s.elementsOf(slide.id).at(-1)).toMatchObject({ geometry: "ellipse", x: 500, y: 280, w: 60, h: 60 });
  });

  it("does nothing on the canvas when read only", () => {
    const s = newSession();
    render(<PliDeck session={s} readOnly />);
    const stage = q(".pli-deck-stage");
    down(stage, 100, 100);
    up();
    expect(qa(".pli-deck-selbox").length).toBe(0);
    expect(host.querySelector(".pli-deck-handle")).toBeNull();
  });
});

describe("canvas pictures", () => {
  it("drops an image file on the canvas as a picture", async () => {
    const { s, slide, stage } = mount();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" });
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; clientX: number; clientY: number };
    Object.assign(drop, { dataTransfer: { files: [file], types: ["Files"] }, clientX: 300, clientY: 200 });
    await runAsync(async () => {
      stage.dispatchEvent(drop);
      await new Promise((r) => setTimeout(r, 20));
    });
    const img = s.elementsOf(slide.id).at(-1)!;
    expect(img.type).toBe("image");
    expect((img as { src: string }).src.startsWith("data:image/png")).toBe(true);
    expect(img.alt).toBe("pic");
    expect(img.w! / img.h!).toBeCloseTo(4 / 3);
  });

  it("crops by dragging an edge handle while crop mode is on, and masks to a shape", async () => {
    const { s, slide, stage } = mount();
    const img = run(() => s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 200, h: 100 }, { x: 50, y: 250 }));
    down(stage, 650, 360);
    up();
    down(stage, 100, 280);
    up();
    expect(sel(s)).toEqual([img.id]);
    click(byLabel("Crop image"));
    down(q('[data-handle="w"]'), 50, 300);
    move(100, 300);
    up();
    const f = s.element(slide.id, img.id) as { x: number; w: number; crop: { l: number } };
    expect(f.x).toBe(100);
    expect(f.w).toBe(150);
    expect(f.crop.l).toBeCloseTo(0.25);
    click(byLabel("Mask image"));
    click(menuItem("ellipse"));
    expect((s.element(slide.id, img.id) as { geometry: string }).geometry).toBe("ellipse");
  });
});
