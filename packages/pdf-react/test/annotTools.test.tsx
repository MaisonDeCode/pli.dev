// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import type { Annotation } from "@pli.dev/pdf";
import { annots, byLabel, click, drag, flush, host, key, layerOf, mount, openProperties, pointer, q, qa, round, run, clientOf, shape, tap, tool, useAnnotHost, setValue, fire } from "./annotHarness";

useAnnotHost();

const P0 = "p:main:0";
const scroller = () => q(".pli-pdf-scroller");
const last = (m: { session: Parameters<typeof annots>[0] }) => annots(m.session).at(-1) as Annotation & Record<string, any>;
const near = (a: number, b: number, d = 0.02) => Math.abs(a - b) <= d;

// Every drawing tool, for each turn of the view and at two zoom levels: what the pointer does on the screen comes out in page space.
const views = [
  { turns: 0, zoom: 1 },
  { turns: 1, zoom: 1 },
  { turns: 2, zoom: 2 },
  { turns: 3, zoom: 0.5 },
] as const;

describe.each(views)("drawing tools with the view turned $turns quarter turns at zoom $zoom", ({ turns, zoom }) => {
  const rotation = turns * 90;
  const opts = { rotation, zoom };

  it("pen: one stroke is one annotation and one undo step, in page space", async () => {
    const m = await mount({ turns, zoom });
    await tool("Pen");
    expect(layerOf()).toBeTruthy();
    await drag([100, 100], [200, 160], { ...opts, steps: [[120, 105], [150, 140], [180, 150]] });
    expect(annots(m.session)).toHaveLength(1);
    const ink = last(m);
    expect(ink.type).toBe("ink");
    expect(ink.strokes).toHaveLength(1);
    const s = ink.strokes[0] as [number, number][];
    expect(near(s[0]![0], 100) && near(s[0]![1], 100)).toBe(true);
    expect(near(s.at(-1)![0], 200) && near(s.at(-1)![1], 160)).toBe(true);
    expect(ink.stroke).toMatchObject({ color: "#e53935", width: 2 });
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(0);
    await run(() => m.session.redo());
    expect(annots(m.session)).toHaveLength(1);
  });

  it("rectangle and ellipse: drag, with Shift for equal sides", async () => {
    const m = await mount({ turns, zoom });
    await shape("Rectangle");
    await drag([100, 120], [220, 200], opts);
    expect(last(m)).toMatchObject({ type: "square", rect: { x: 100, y: 120, w: 120, h: 80 }, stroke: { color: "#e53935", width: 2 } });
    await shape("Rectangle");
    await drag([300, 120], [400, 150], { ...opts, init: { shiftKey: true } });
    expect(last(m)).toMatchObject({ type: "square", rect: { x: 300, y: 120, w: 100, h: 100 } });
    await shape("Ellipse");
    await drag([50, 300], [150, 360], opts);
    expect(last(m)).toMatchObject({ type: "circle", rect: { x: 50, y: 300, w: 100, h: 60 } });
    // dragging up and to the left gives the same box
    await shape("Ellipse");
    await drag([250, 360], [150, 300], opts);
    expect(last(m)).toMatchObject({ type: "circle", rect: { x: 150, y: 300, w: 100, h: 60 } });
  });

  it("line and arrow: from the press to the release, Shift keeps 45 degree steps", async () => {
    const m = await mount({ turns, zoom });
    await shape("Line");
    await drag([100, 100], [200, 180], opts);
    expect(last(m)).toMatchObject({ type: "line", from: [100, 100], to: [200, 180] });
    expect(last(m).endEnd).toBeUndefined();
    await shape("Arrow");
    await drag([100, 300], [300, 320], { ...opts, init: { shiftKey: true } });
    const arrow = last(m);
    expect(arrow).toMatchObject({ type: "line", from: [100, 300], endEnd: "arrow" });
    expect(near(arrow.to[1], 300, 0.1)).toBe(true);
    expect(near(arrow.to[0], Math.hypot(200, 20) + 100, 0.1)).toBe(true);
  });

  it("polyline and polygon: click the points, double-click to finish", async () => {
    const m = await mount({ turns, zoom });
    await shape("Polyline");
    await tap([100, 100], opts);
    await tap([200, 120], opts);
    await tap([250, 200], opts);
    expect(annots(m.session)).toHaveLength(0);
    expect(document.querySelector(".pli-pdf-draft-points")).toBeTruthy();
    await tap([250, 200], opts); // the second click of a double-click
    expect(last(m)).toMatchObject({ type: "polyline", points: [[100, 100], [200, 120], [250, 200]] });
    await shape("Polygon");
    for (const p of [[100, 400], [200, 400], [150, 480]] as [number, number][]) await tap(p, opts);
    // Enter finishes it
    await key(scroller(), "Enter");
    expect(last(m)).toMatchObject({ type: "polygon", points: [[100, 400], [200, 400], [150, 480]] });
    await shape("Polygon");
    // a polygon closes when the first point is clicked again
    for (const p of [[300, 400], [400, 400], [350, 480], [300, 400]] as [number, number][]) await tap(p, opts);
    expect(last(m)).toMatchObject({ type: "polygon", points: [[300, 400], [400, 400], [350, 480]] });
  });

  it("note: a click opens the comment box, and sending it puts the note down at that place", async () => {
    const m = await mount({ turns, zoom });
    await tool("Note");
    await tap([150, 200], opts);
    const box = q("[role=dialog][aria-label='New note']", host);
    expect(box).toBeTruthy();
    const text = q("textarea", box) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(text, "Check this figure");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...box.querySelectorAll("button")].find((b) => b.textContent === "Add note")!);
    expect(last(m)).toMatchObject({ type: "note", x: 150, y: 200, contents: "Check this figure", icon: "comment" });
    expect(document.querySelector("[aria-label='New note']")).toBeNull();
  });

  it("redact: marks the area, nothing else", async () => {
    const m = await mount({ turns, zoom });
    await tool("Redact");
    await drag([100, 100], [250, 130], opts);
    expect(last(m)).toMatchObject({ type: "redact", rects: [{ x: 100, y: 100, w: 150, h: 30 }], fill: "#000000" });
    expect(m.c().announce).toBeTruthy();
    expect(q(".pli-pdf-sr", host).textContent).toContain("Nothing is removed");
  });

  it("link: drag a box, then choose where it goes", async () => {
    const m = await mount({ turns, zoom });
    await tool("Link");
    await drag([100, 100], [300, 120], opts);
    const form = q("[role=dialog][aria-label='Link']", host);
    expect(form).toBeTruthy();
    expect(qa(".pli-pdf-annot[data-type=link]:not([data-annot=draft])")).toHaveLength(0);
    await setValue(q("input[aria-label='Web address']", form) as HTMLInputElement, "example.com/terms");
    await fire(q("form", form), new Event("submit", { bubbles: true, cancelable: true }));
    expect(last(m)).toMatchObject({ type: "link", rect: { x: 100, y: 100, w: 200, h: 20 }, uri: "https://example.com/terms" });
  });
});

describe("pen details", () => {
  it("draws a dot for a click, thins a long stroke, and Escape stops the tool", async () => {
    const m = await mount();
    await tool("Pen");
    await tap([50, 50]);
    expect(last(m).strokes[0].length).toBeLessThanOrEqual(2);
    const many = Array.from({ length: 80 }, (_, i) => [100 + i * 2, 100 + Math.sin(i / 6) * 20] as [number, number]);
    await drag([100, 100], [260, 100], { steps: many });
    expect(last(m).strokes[0].length).toBeLessThan(60);
    expect(last(m).strokes[0].length).toBeGreaterThan(5);
    // sticky: still drawing
    expect(byLabel("Pen", host).getAttribute("aria-pressed")).toBe("true");
    expect(m.session.selection.annots).toEqual([]);
    await key(scroller(), "Escape");
    expect(byLabel("Pen", host).getAttribute("aria-pressed")).toBe("false");
    expect(layerOf()).toBeNull();
  });

  it("uses the colour and width chosen in the properties panel, and remembers them", async () => {
    const m = await mount();
    await tool("Pen");
    await openProperties();
    const width = q("input[aria-label='Line width']", host) as HTMLInputElement;
    await setValue(width, "6");
    await click(q("button[aria-label='Colour #1e88e5']", host));
    await drag([100, 100], [200, 100]);
    expect(last(m).stroke).toMatchObject({ color: "#1e88e5", width: 6 });
    expect(JSON.parse(localStorage.getItem("t:styles")!).ink).toMatchObject({ color: "#1e88e5", width: 6 });
    // a new session in this browser starts with what was used last
    const again = await mount();
    expect(again.c().style("ink")).toMatchObject({ color: "#1e88e5", width: 6 });
  });
});

describe("eraser", () => {
  it("removes what a stroke passes over as one undo step", async () => {
    const m = await mount();
    await run(() => {
      m.session.annots.add(P0, { type: "square", rect: { x: 100, y: 100, w: 50, h: 50 }, stroke: { color: "#000", width: 2 } } as never, { select: false });
      m.session.annots.add(P0, { type: "line", from: [100, 300], to: [300, 300], stroke: { color: "#000", width: 2 } } as never, { select: false });
      m.session.annots.add(P0, { type: "line", from: [100, 500], to: [300, 500], stroke: { color: "#000", width: 2 } } as never, { select: false });
    });
    await tool("Eraser");
    await drag([100, 100], [200, 300], { steps: [[100, 150], [150, 220], [150, 300]] });
    expect(annots(m.session).map((a) => a.type)).toEqual(["line"]);
    expect(annots(m.session)[0]).toMatchObject({ from: [100, 500] });
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(3);
  });

  const pen = (m: Awaited<ReturnType<typeof mount>>, strokes: [number, number][][], extra: object = {}) =>
    run(() => m.session.annots.add(P0, { type: "ink", strokes, stroke: { color: "#e53935", width: 2 }, ...extra } as never, { select: false }));
  const inkOf = (m: Awaited<ReturnType<typeof mount>>) => annots(m.session).filter((a) => a.type === "ink");

  it("cuts a pen stroke where it is dragged over, keeping the same annotation and its look, as one undo step", async () => {
    const m = await mount();
    const id = await pen(m, [[[100, 100], [300, 100]]], { opacity: 0.5 });
    await tool("Eraser");
    await drag([200, 80], [200, 120], { steps: [[200, 100]] });
    const [ink] = inkOf(m) as Extract<ReturnType<typeof annots>[number], { type: "ink" }>[];
    expect(inkOf(m)).toHaveLength(1);
    expect(ink!.id).toBe(id);
    expect(ink!.strokes).toHaveLength(2);
    const [a, b] = ink!.strokes;
    expect(a![0]).toEqual([100, 100]);
    expect(a![a!.length - 1]![0]).toBeGreaterThan(190);
    expect(a![a!.length - 1]![0]).toBeLessThan(200);
    expect(b![0]![0]).toBeGreaterThan(200);
    expect(b![0]![0]).toBeLessThan(210);
    expect(b![b!.length - 1]).toEqual([300, 100]);
    expect(ink).toMatchObject({ stroke: { color: "#e53935", width: 2 }, opacity: 0.5 });
    await run(() => m.session.undo());
    expect((inkOf(m)[0] as { strokes: unknown[] }).strokes).toHaveLength(1);
    expect(inkOf(m)[0]!.id).toBe(id);
    await run(() => m.session.redo());
    expect((inkOf(m)[0] as { strokes: unknown[] }).strokes).toHaveLength(2);
  });

  it("shows what is left while the pointer is down, and changes the document when it lets go", async () => {
    const m = await mount();
    await pen(m, [[[100, 100], [300, 100]]]);
    await tool("Eraser");
    const layer = layerOf();
    await pointer(layer, "pointerdown", clientOf(200, 80));
    await pointer(layer, "pointermove", clientOf(200, 120));
    expect(inkOf(m)[0]).toMatchObject({ strokes: [[[100, 100], [300, 100]]] }); // the document is as it was
    const shown = m.c().preview.get(inkOf(m)[0]!.id) as { strokes: unknown[] };
    expect(shown.strokes).toHaveLength(2);
    await pointer(layer, "pointerup", clientOf(200, 120));
    expect(m.c().preview.size).toBe(0);
    expect((inkOf(m)[0] as { strokes: unknown[] }).strokes).toHaveLength(2);
  });

  it("removes a pen stroke it covers completely, and cuts one drag across several drawings in one step, even when the pointer jumps", async () => {
    const m = await mount();
    await pen(m, [[[100, 100], [101, 100]]]); // a dot of a stroke
    await pen(m, [[[100, 200], [300, 200]]]);
    await run(() => m.session.annots.add(P0, { type: "square", rect: { x: 150, y: 250, w: 100, h: 50 }, stroke: { color: "#000", width: 2 } } as never, { select: false }));
    await tool("Eraser");
    await drag([100, 95], [180, 280], { steps: [[100, 105], [105, 100], [150, 200], [180, 280]] });
    const ink = inkOf(m) as { strokes: unknown[] }[];
    expect(ink).toHaveLength(1); // the dot is gone
    expect(ink[0]!.strokes.length).toBeGreaterThanOrEqual(1);
    expect(annots(m.session).some((a) => a.type === "square")).toBe(false);
    await run(() => m.session.undo());
    expect(annots(m.session).map((a) => a.type)).toEqual(["ink", "ink", "square"]);
    expect((inkOf(m)[1] as { strokes: unknown[] }).strokes).toHaveLength(1);
  });

  it("leaves a pen stroke it does not touch as it was, and a stroke of several parts keeps the others", async () => {
    const m = await mount();
    await pen(m, [[[100, 100], [300, 100]], [[100, 200], [300, 200]]]);
    await tool("Eraser");
    await drag([200, 190], [200, 210]);
    const strokes = (inkOf(m)[0] as unknown as { strokes: number[][][] }).strokes;
    expect(strokes).toHaveLength(3);
    expect(strokes[0]).toEqual([[100, 100], [300, 100]]);
    await drag([200, 300], [250, 320]);
    expect((inkOf(m)[0] as { strokes: unknown[] }).strokes).toHaveLength(3);
  });

  it("works at a turned view and zoom", async () => {
    const m = await mount({ turns: 1, zoom: 2 });
    await pen(m, [[[100, 100], [300, 100]]]);
    await tool("Eraser");
    await drag([200, 80], [200, 120], { rotation: 90, zoom: 2 });
    const strokes = (inkOf(m)[0] as unknown as { strokes: number[][][] }).strokes;
    expect(strokes).toHaveLength(2);
    // at zoom 2 (a scale of 2.67) the eraser's reach is 5 pixels = 1.9 points, plus the line's half width: about 5.7 points are cut
    const gap = strokes[1]![0]![0] - strokes[0]![strokes[0]!.length - 1]![0];
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(6.5);
  });

  it("leaves locked annotations alone", async () => {
    const m = await mount();
    await run(() => m.session.annots.add(P0, { type: "line", from: [100, 100], to: [300, 100], stroke: { color: "#000", width: 2 }, locked: true } as never, { select: false }));
    await tool("Eraser");
    await drag([150, 90], [150, 110]);
    expect(annots(m.session)).toHaveLength(1);
  });
});

describe("text box", () => {
  it("is made by dragging, typed into in place, and joins the document with its text as one undo step", async () => {
    const m = await mount();
    await tool("Text box");
    await drag([100, 100], [260, 160]);
    // not in the document until it has text
    expect(annots(m.session)).toHaveLength(0);
    const area = q("textarea.pli-pdf-text-editor") as HTMLTextAreaElement;
    expect(area.style.left).toBe("100px");
    expect(area.style.width).toBe("160px");
    expect(document.activeElement).toBe(area);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Hello there");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(area, "Escape");
    expect(document.querySelector(".pli-pdf-text-editor")).toBeNull();
    expect(annots(m.session)).toHaveLength(1);
    expect(last(m)).toMatchObject({ type: "freetext", text: "Hello there", rect: { x: 100, y: 100, w: 160, h: 60 }, style: { family: "Helvetica", size: 12, color: "#000000" } });
    expect(m.session.selection.annots).toEqual([last(m).id]);
    expect(m.c().toolId).toBe("select");
    expect(q("[data-annot] text").textContent).toContain("Hello there");
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(0);
  });

  it("drops a box that was left empty without leaving a trace", async () => {
    const m = await mount();
    await tool("Text box");
    await tap([100, 100]);
    expect(q("textarea.pli-pdf-text-editor")).toBeTruthy();
    await key(q("textarea.pli-pdf-text-editor"), "Escape");
    expect(annots(m.session)).toHaveLength(0);
    expect(m.session.canUndo).toBe(false);
  });

  it("edits an existing box on double-click, and typing is one undo step", async () => {
    const m = await mount();
    const id = await run(() => m.session.annots.add(P0, { type: "freetext", rect: { x: 100, y: 100, w: 160, h: 40 }, text: "one", style: { family: "Helvetica", size: 12, color: "#000000" } } as never));
    await tool("Select");
    const at = [120, 110] as [number, number];
    await tap(at);
    await tap(at);
    const area = q("textarea.pli-pdf-text-editor") as HTMLTextAreaElement;
    expect(area.value).toBe("one");
    for (const text of ["one t", "one tw", "one two"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await key(area, "Escape");
    expect((m.session.annots.get(id) as any).text).toBe("one two");
    await run(() => m.session.undo());
    expect((m.session.annots.get(id) as any).text).toBe("one");
  });

  it("grows the box as the text gets longer", async () => {
    const m = await mount();
    await tool("Text box");
    await tap([100, 100]);
    const area = q("textarea.pli-pdf-text-editor") as HTMLTextAreaElement;
    Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => 90 });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "a\nb\nc\nd\ne");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(area, "Escape");
    expect(last(m).rect.h).toBe(90);
  });
});

describe("tool basics", () => {
  it("every tool has a labelled button with a shortcut in its tooltip, and the pressed one is marked", async () => {
    await mount();
    for (const [label, keyName] of [["Select", "V"], ["Highlight", "H"], ["Underline", "U"], ["Strikethrough", "S"], ["Squiggly underline", "W"], ["Pen", "P"], ["Eraser", "E"], ["Text box", "T"], ["Note", "N"], ["Link", "K"], ["Redact", "X"]]) {
      const b = byLabel(label!, host);
      expect(b, label).toBeTruthy();
      expect(b.getAttribute("title")).toBe(`${label} (${keyName})`);
      expect(b.getAttribute("aria-keyshortcuts")).toBe(keyName);
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    expect(byLabel("Stamps", host)).toBeTruthy();
    expect(byLabel("Signature", host)).toBeTruthy();
    expect(byLabel("Picture", host)).toBeTruthy();
    expect(byLabel("Shapes", host)).toBeTruthy();
  });

  it("chooses tools with single keys, and the key again puts the tool down", async () => {
    const m = await mount();
    const press = (k: string) => key(scroller(), k);
    await press("p");
    expect(m.c().toolId).toBe("ink");
    await press("p");
    expect(m.c().toolId).toBe("select");
    for (const [k, id] of [["h", "highlight"], ["u", "underline"], ["s", "strikeout"], ["w", "squiggly"], ["e", "eraser"], ["r", "rectangle"], ["o", "ellipse"], ["l", "line"], ["a", "arrow"], ["y", "polyline"], ["g", "polygon"], ["t", "text"], ["n", "note"], ["k", "link"], ["x", "redact"], ["v", "select"]] as const) {
      await press(k);
      expect(m.c().toolId, k).toBe(id);
      expect(q(".pli-pdf").getAttribute("data-tool")).toBe(id);
    }
    // keys are left alone when typing, and with modifier keys held
    const input = document.createElement("input");
    host.append(input);
    await key(input, "h");
    expect(m.c().toolId).toBe("select");
    await key(scroller(), "h", { altKey: true });
    expect(m.c().toolId).toBe("select");
  });

  it("shows what to do with the active tool, and says so for screen readers", async () => {
    await mount();
    await tool("Pen");
    expect(q(".pli-pdf-hint").textContent).toContain("Draw freehand");
    expect(q(".pli-pdf-sr", host).getAttribute("aria-live")).toBe("polite");
  });

  it("gives pointer events to the drawing tools only while one is active, and keeps touch scrolling for the select tool", async () => {
    await mount();
    expect(layerOf()).toBeNull();
    await tool("Pen");
    expect(layerOf().getAttribute("data-tool")).toBe("ink");
    await tool("Pen");
    await tool("Select");
    expect(layerOf().getAttribute("data-tool")).toBe("select");
  });

  it("cancels the drawing with Escape and keeps the tool", async () => {
    const m = await mount();
    await shape("Rectangle");
    await pointer(layerOf(), "pointerdown", clientOf(100, 100));
    await pointer(layerOf(), "pointermove", clientOf(200, 200));
    expect(m.c().draft?.type).toBe("box");
    expect(qa(".pli-pdf-annot[data-annot='draft']")).toHaveLength(1);
    await key(scroller(), "Escape");
    expect(m.c().draft).toBeNull();
    expect(m.c().toolId).toBe("rectangle");
    await key(scroller(), "Escape");
    expect(m.c().toolId).toBeNull();
    expect(annots(m.session)).toHaveLength(0);
  });

  it("goes back to the select tool after one shape unless the tool is kept", async () => {
    const m = await mount();
    await shape("Rectangle");
    await drag([100, 100], [200, 200]);
    expect(m.c().toolId).toBe("select");
    expect(m.session.selection.annots).toHaveLength(1);
    await shape("Rectangle");
    await openProperties();
    await click(q("input[aria-label='Keep this tool selected']", host));
    await drag([100, 300], [200, 400]);
    await drag([100, 450], [200, 500]);
    expect(m.c().toolId).toBe("rectangle");
    expect(annots(m.session)).toHaveLength(3);
  });

  it("does not offer editing tools in a read-only viewer", async () => {
    await mount({ props: { readOnly: true }, kit: { readOnly: true } });
    expect(q(".pli-pdf-ribbon > .pli-pdf-ribbon-empty", host)).toBeTruthy();
    expect(document.querySelector("[aria-label=Pen]")).toBeNull();
    expect(document.querySelector(".pli-pdf-ribbon button")).toBeNull();
    expect(q("#pli-pdf-tab-comments")).toBeTruthy();
    expect(round(1.234)).toBe(1.23);
  });
});
