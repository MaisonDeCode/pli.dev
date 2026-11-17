import { describe, expect, it } from "vitest";
import type { FormField, PdfDoc, Widget } from "@pli.dev/pdf";
import { copyName, dragRect, fontCss, fontSizeOf, freeName, isFillable, kindOf, moveRect, optionLabel, placeRect, readingOrder, snap, snapRect, tabStops } from "../src/formsGeometry";

const page = (id: string) => ({ id, from: null, width: 300, height: 400, rotate: 0 as const, annots: [] });
const w = (id: string, p: string, x: number, y: number, W = 50, H = 20, on?: string): Widget => ({ id, page: p, rect: { x, y, w: W, h: H }, ...(on ? { on } : {}) });
const f = (id: string, widgets: Widget[], extra: Partial<FormField> = {}): FormField => ({ id, name: id, type: "text", value: "", widgets, ...extra });
const doc = (fields: FormField[], pages = ["p1", "p2"]): Pick<PdfDoc, "pages" | "fields"> => ({ pages: pages.map(page), fields });

describe("snapping and drawing", () => {
  it("snaps to the 4 point grid", () => {
    expect(snap(5)).toBe(4);
    expect(snap(6)).toBe(8);
    expect(snap(-1)).toBe(-0);
  });

  it("draws a rectangle between two points, snapped, on the page, with a minimum size", () => {
    expect(dragRect([10.3, 20.9], [101, 58], { width: 300, height: 400 })).toEqual({ x: 12, y: 20, w: 88, h: 40 });
    expect(dragRect([101, 58], [10.3, 20.9], { width: 300, height: 400 })).toEqual({ x: 12, y: 20, w: 88, h: 40 });
    expect(dragRect([10.3, 20.9], [101.4, 58.2], { width: 300, height: 400 }, ).w).toBe(88);
    // Alt: no snapping
    expect(dragRect([10.3, 20.9], [101, 58], { width: 300, height: 400 }, { snap: false })).toEqual({ x: 10.3, y: 20.9, w: 90.7, h: 37.1 });
    // kept on the page and at least 8 points
    expect(dragRect([-20, -20], [500, 900], { width: 300, height: 400 })).toEqual({ x: 0, y: 0, w: 300, h: 400 });
    expect(dragRect([50, 50], [51, 51], { width: 300, height: 400 })).toMatchObject({ w: 8, h: 8 });
  });

  it("centres a field of the kind's size on a click and keeps it on the page", () => {
    expect(placeRect([100, 100], 150, 22, { width: 300, height: 400 })).toEqual({ x: 24, y: 88, w: 150, h: 22 });
    expect(placeRect([5, 5], 150, 22, { width: 300, height: 400 })).toEqual({ x: 0, y: 0, w: 150, h: 22 });
  });

  it("moves and resizes onto the grid, inside the page", () => {
    expect(moveRect({ x: 10, y: 10, w: 50, h: 20 }, 3, 3, { width: 300, height: 400 })).toEqual({ x: 12, y: 12, w: 50, h: 20 });
    expect(moveRect({ x: 10, y: 10, w: 50, h: 20 }, 1000, 1000, { width: 300, height: 400 })).toEqual({ x: 250, y: 380, w: 50, h: 20 });
    expect(snapRect({ x: 10.2, y: 10.2, w: 49.7, h: 20.3 }, { width: 300, height: 400 })).toEqual({ x: 12, y: 12, w: 48, h: 20 });
  });
});

describe("names", () => {
  it("numbers a new name until it is free", () => {
    const taken = new Set(["Text1", "Text2", "Text4"]);
    expect(freeName("Text", (n) => taken.has(n))).toBe("Text3");
    expect(copyName("Text1", (n) => taken.has(n))).toBe("Text3");
    expect(copyName("age", (n) => n === "age2")).toBe("age3");
  });
});

describe("reading order", () => {
  it("goes page by page, row by row, left to right", () => {
    const fields = [
      f("c", [w("wc", "p1", 150, 52)]),
      f("a", [w("wa", "p1", 10, 50)]),
      f("far", [w("wf", "p2", 0, 0)]),
      f("below", [w("wb", "p1", 10, 100)]),
      f("b", [w("wb2", "p1", 80, 48)]),
    ];
    const order = readingOrder(doc(fields)).map((o) => o.widget.id);
    expect(order).toEqual(["wa", "wb2", "wc", "wb", "wf"]);
  });

  it("keeps a tall field and a small one beside it in separate rows when their middles are far apart", () => {
    const fields = [f("tall", [w("t", "p1", 10, 10, 50, 100)]), f("small", [w("s", "p1", 100, 10, 50, 20)])];
    expect(readingOrder(doc(fields)).map((o) => o.widget.id)).toEqual(["t", "s"]);
  });

  it("skips widgets on pages that are not in the document", () => {
    expect(readingOrder(doc([f("x", [w("w", "gone", 0, 0)])]))).toEqual([]);
  });

  it("tab stops: a radio group is one stop (the chosen button), read-only and signed fields none", () => {
    const radio = f("r", [w("r1", "p1", 10, 10, 14, 14, "A"), w("r2", "p1", 40, 10, 14, 14, "B")], { type: "radio", value: "B" });
    const first = f("r0", [w("q1", "p1", 10, 100, 14, 14, "A"), w("q2", "p1", 40, 100, 14, 14, "B")], { type: "radio", value: null });
    const ro = f("ro", [w("w3", "p1", 10, 200)], { flags: { readOnly: true } });
    const sig = f("sig", [w("w4", "p1", 10, 250)], { type: "signature", signed: true, value: null });
    const ok = f("ok", [w("w5", "p1", 10, 300)]);
    const stops = tabStops(readingOrder(doc([radio, first, ro, sig, ok]))).map((o) => o.widget.id);
    expect(stops).toEqual(["r2", "q1", "w5"]);
    expect(isFillable(ro)).toBe(false);
    expect(isFillable(sig)).toBe(false);
  });
});

describe("look", () => {
  it("maps PDF fonts to CSS", () => {
    expect(fontCss("Helvetica-Bold")).toMatchObject({ weight: 700, style: "normal", family: "Helvetica, Arial, sans-serif" });
    expect(fontCss("Times-Italic")).toMatchObject({ style: "italic", weight: 400 });
    expect(fontCss("Times-Italic").family).toContain("serif");
    expect(fontCss("Courier-Oblique")).toMatchObject({ style: "italic" });
    expect(fontCss("Courier").family).toContain("monospace");
    expect(fontCss("ABCDEF+Calibri").family).toContain('"Calibri"');
    expect(fontCss(undefined).family).toContain("Helvetica");
  });

  it("sizes text: the field's size, or fitted to the height (0)", () => {
    const widget = w("w", "p1", 0, 0, 100, 20);
    expect(fontSizeOf(f("a", [widget], { appearance: { size: 9 } }), widget)).toBe(9);
    expect(fontSizeOf(f("a", [widget], { appearance: { size: 0, border: "#000", borderWidth: 1 } }), widget)).toBe(12.6);
    const tall = w("w", "p1", 0, 0, 100, 400);
    expect(fontSizeOf(f("a", [tall], { appearance: { size: 0 } }), tall)).toBe(24);
    expect(fontSizeOf(f("a", [tall], { appearance: { size: 0 }, flags: { multiline: true } }), tall)).toBe(12);
    const comb = w("w", "p1", 0, 0, 100, 40);
    expect(fontSizeOf(f("a", [comb], { appearance: { size: 0 }, flags: { comb: true, maxLength: 10 } }), comb)).toBeCloseTo(100 / 10 / 0.62, 1);
  });

  it("names the kind of a field and shows an option's label", () => {
    expect(kindOf(f("a", [], { flags: { multiline: true } }))).toBe("multiline");
    expect(kindOf(f("a", [], { type: "dropdown" }))).toBe("dropdown");
    expect(optionLabel(f("a", [], { type: "dropdown", options: [{ value: "fr", label: "France" }] }), "fr")).toBe("France");
    expect(optionLabel(f("a", [], { type: "dropdown", options: [] }), "zz")).toBe("zz");
  });
});
