// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Annotation, NoteAnnot } from "@pli.dev/pdf";
import { endShapes, lineEndShape, noteIconShape, wrapText, NOTE_ICONS } from "../src/annotSvg";
import { dateStamp, stampDate, stampFontSize, stampSize, stampText } from "../src/stamps";
import { byLabel, click, flush, host, mount, q, qa, run, useAnnotHost } from "./annotHarness";

useAnnotHost();

const P0 = "p:main:0";
const stroke = { color: "#112233", width: 3 };

async function put(annot: Record<string, unknown>) {
  const m = await mount();
  const id = await run(() => m.session.annots.add(P0, annot as never, { select: false }));
  await flush();
  return { ...m, id };
}

const shape = (id: string) => q(`[data-annot="${id}"]`);

describe("drawing annotations as SVG, in page space", () => {
  it("draws a highlight in the layer that multiplies with the page, one rectangle per line", async () => {
    const { id } = await put({ type: "highlight", color: "#ffe14d", rects: [{ x: 72, y: 110, w: 100, h: 12 }, { x: 72, y: 124, w: 50, h: 12 }] });
    const g = shape(id);
    expect(g.closest("svg")!.classList.contains("pli-pdf-blend-layer")).toBe(true);
    const rects = qa("rect", g);
    expect(rects).toHaveLength(2);
    expect(g.querySelector("g[fill]")!.getAttribute("fill")).toBe("#ffe14d");
    expect(rects.map((r) => [r.getAttribute("x"), r.getAttribute("y"), r.getAttribute("width"), r.getAttribute("height")])).toEqual([
      ["72", "110", "100", "12"],
      ["72", "124", "50", "12"],
    ]);
    expect(q(".pli-pdf-blend-layer").getAttribute("aria-hidden")).toBe("true");
  });

  it("draws underline and strikethrough as lines and squiggly as a zigzag, in the annotation's colour", async () => {
    const m = await mount();
    const rects = [{ x: 10, y: 10, w: 100, h: 10 }];
    const ids = await run(() => ["underline", "strikeout", "squiggly"].map((type) => m.session.annots.add(P0, { type, color: "#00aa00", rects } as never, { select: false })));
    await flush();
    const ul = qa("line", shape(ids[0]!));
    expect(ul).toHaveLength(1);
    expect(ul[0]!.getAttribute("y1")!).toBe(String(10 + 10 - 0.8));
    expect(ul[0]!.closest("g[stroke]")!.getAttribute("stroke")).toBe("#00aa00");
    const so = qa("line", shape(ids[1]!));
    expect(Number(so[0]!.getAttribute("y1"))).toBeGreaterThan(14);
    expect(Number(so[0]!.getAttribute("y1"))).toBeLessThan(17);
    const sq = q("path", shape(ids[2]!));
    expect(sq.getAttribute("d")!.startsWith("M10 ")).toBe(true);
    expect((sq.getAttribute("d")!.match(/L/g) ?? []).length).toBeGreaterThan(20);
  });

  it("draws ink as smooth round-capped paths, one per stroke", async () => {
    const { id } = await put({ type: "ink", strokes: [[[10, 10], [30, 40], [60, 20]], [[100, 100], [101, 101]]], stroke: { ...stroke, dash: [6, 3] } });
    const g = q("g[stroke]", shape(id));
    expect(g.getAttribute("stroke")).toBe("#112233");
    expect(g.getAttribute("stroke-width")).toBe("3");
    expect(g.getAttribute("stroke-linecap")).toBe("round");
    expect(g.getAttribute("stroke-linejoin")).toBe("round");
    expect(g.getAttribute("stroke-dasharray")).toBe("6 3");
    const paths = qa("path", g);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute("d")).toBe("M10 10Q30 40 45 30L60 20");
  });

  it("draws rectangles and ellipses with stroke, dash and fill", async () => {
    const m = await mount();
    const [a, b] = await run(() => [
      m.session.annots.add(P0, { type: "square", rect: { x: 20, y: 30, w: 100, h: 50 }, stroke: { ...stroke, dash: [1, 3] }, fill: "#ffeecc" } as never, { select: false }),
      m.session.annots.add(P0, { type: "circle", rect: { x: 20, y: 100, w: 100, h: 50 }, stroke } as never, { select: false }),
    ]);
    await flush();
    const rect = q("rect", shape(a));
    expect(rect.getAttribute("fill")).toBe("#ffeecc");
    expect(rect.getAttribute("stroke-dasharray")).toBe("1 3");
    expect(rect.getAttribute("stroke-width")).toBe("3");
    const ellipse = q("ellipse", shape(b));
    expect([ellipse.getAttribute("cx"), ellipse.getAttribute("cy"), ellipse.getAttribute("rx"), ellipse.getAttribute("ry")]).toEqual(["70", "125", "50", "25"]);
    expect(ellipse.getAttribute("fill")).toBe("none");
  });

  it("draws a line with its end styles, and polygons and polylines through their points", async () => {
    const m = await mount();
    const [line, poly, pl] = await run(() => [
      m.session.annots.add(P0, { type: "line", from: [10, 10], to: [110, 10], stroke, startEnd: "circle", endEnd: "arrow" } as never, { select: false }),
      m.session.annots.add(P0, { type: "polygon", points: [[0, 0], [50, 0], [25, 40]], stroke, fill: "#00ff00" } as never, { select: false }),
      m.session.annots.add(P0, { type: "polyline", points: [[0, 100], [50, 120], [90, 90]], stroke } as never, { select: false }),
    ]);
    await flush();
    const l = shape(line);
    expect(qa("line", l)).toHaveLength(1);
    const ends = qa("path", l);
    expect(ends).toHaveLength(2);
    expect(ends.every((p) => p.getAttribute("fill") === "#112233")).toBe(true);
    expect(q("polygon", shape(poly)).getAttribute("points")).toBe("0,0 50,0 25,40");
    expect(q("polygon", shape(poly)).getAttribute("fill")).toBe("#00ff00");
    expect(q("polyline", shape(pl)).getAttribute("points")).toBe("0,100 50,120 90,90");
    expect(q("polyline", shape(pl)).getAttribute("fill")).toBe("none");
  });

  it("draws every line end", () => {
    const tip: [number, number] = [100, 50];
    const from: [number, number] = [0, 50];
    expect(lineEndShape("none", tip, from, 2)).toBeNull();
    expect(lineEndShape(undefined, tip, from, 2)).toBeNull();
    expect(lineEndShape("arrow", tip, from, 2)).toEqual({ d: "M100 50L92 53.2L92 46.8Z", fill: true });
    expect(lineEndShape("closed-arrow", tip, from, 2)).toMatchObject({ fill: false });
    expect(lineEndShape("open-arrow", tip, from, 2)).toEqual({ d: "M92 53.2L100 50L92 46.8", fill: false });
    expect(lineEndShape("circle", tip, from, 2)!.d.startsWith("M96 50a4 4")).toBe(true);
    expect(lineEndShape("square", tip, from, 2)).toEqual({ d: "M96 54L104 54L104 46L96 46Z", fill: true });
    expect(lineEndShape("diamond", tip, from, 2)).toEqual({ d: "M104 50L100 54L96 50L100 46Z", fill: true });
    expect(lineEndShape("butt", tip, from, 2)).toEqual({ d: "M100 54L100 46", fill: false });
    expect(lineEndShape("slash", tip, from, 2)!.d).toMatch(/^M[\d. -]+L[\d. -]+$/);
    // the arrow points away from the other end, whichever way the line runs
    expect(lineEndShape("arrow", [0, 50], [100, 50], 2)!.d).toBe("M0 50L8 46.8L8 53.2Z");
    expect(endShapes([[0, 0], [10, 0], [10, 10]], "diamond", "arrow", 2)).toHaveLength(2);
    expect(endShapes([[0, 0]], "diamond", "arrow", 2)).toEqual([]);
  });

  it("wraps text in a text box at its width and draws its fill, border and alignment", async () => {
    const { id } = await put({
      type: "freetext",
      rect: { x: 50, y: 60, w: 70, h: 80 },
      text: "alpha beta gamma delta\nepsilon",
      style: { family: "Helvetica", size: 10, color: "#aa0000", bold: true, italic: true, align: "center" },
      fill: "#ffffcc",
      stroke: { color: "#333333", width: 1 },
    });
    const g = shape(id);
    const rects = qa("rect", g);
    expect(rects[0]!.getAttribute("fill")).toBe("#ffffcc");
    expect(rects.some((r) => r.getAttribute("stroke") === "#333333")).toBe(true);
    const text = q("text", g);
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("fill")).toBe("#aa0000");
    expect(text.style.fontWeight).toBe("700");
    expect(text.style.fontStyle).toBe("italic");
    expect(text.style.fontFamily).toMatch(/Helvetica|Arial|sans-serif/i);
    const lines = qa("tspan", text);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.map((l) => l.textContent).join(" ")).toContain("epsilon");
    expect(lines[0]!.getAttribute("x")).toBe("85");
    expect(lines[0]!.getAttribute("y")).toBe("73");
    expect(Number(lines[1]!.getAttribute("y")) - Number(lines[0]!.getAttribute("y"))).toBeCloseTo(12);
  });

  it("breaks text at spaces and line breaks, and inside a word only when it is too wide", () => {
    const m = (s: string) => s.length * 10;
    expect(wrapText("aa bb cc dd", 50, m)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("one\n\ntwo", 100, m)).toEqual(["one", "", "two"]);
    expect(wrapText("abcdefghij", 40, m)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("", 40, m)).toEqual([""]);
  });

  it("draws a note as a 24 point icon at its place, in its colour, for every icon", async () => {
    const m = await mount();
    const ids = await run(() => NOTE_ICONS.map((icon, i) => m.session.annots.add(P0, { type: "note", x: 10 + i * 30, y: 20, icon, color: "#ffd400" } as NoteAnnot, { select: false })));
    await flush();
    ids.forEach((id, i) => {
      const g = q("g[transform]", shape(id));
      expect(g.getAttribute("transform")).toBe(`translate(${10 + i * 30} 20)`);
      const paths = qa("path", g);
      expect(paths[0]!.getAttribute("fill")).toBe("#ffd400");
      expect(paths[0]!.getAttribute("d")).toBe(noteIconShape(NOTE_ICONS[i]).body);
    });
    expect(new Set(NOTE_ICONS.map((i) => noteIconShape(i).body)).size).toBeGreaterThanOrEqual(5);
  });

  it("draws a standard stamp as an upper-case label in a rounded box, and a picture stamp as a picture", async () => {
    const m = await mount();
    const [a, b] = await run(() => [
      m.session.annots.add(P0, { type: "stamp", rect: { x: 50, y: 50, w: 150, h: 44 }, stamp: { name: "Approved", label: "Approved", color: "#2e7d32" } } as never, { select: false }),
      m.session.annots.add(P0, { type: "stamp", rect: { x: 50, y: 150, w: 100, h: 50 }, stamp: { picture: { src: "data:image/png;base64,AA==" } } } as never, { select: false }),
    ]);
    await flush();
    expect(q("text", shape(a)).textContent).toBe("APPROVED");
    expect(q("rect", shape(a)).getAttribute("rx")).not.toBeNull();
    expect(q("rect", shape(a)).getAttribute("stroke")).toBe("#2e7d32");
    expect(q("image", shape(b)).getAttribute("href")).toBe("data:image/png;base64,AA==");
    expect(stampText({ name: "NotApproved", label: "Not approved" })).toBe("NOT APPROVED");
    expect(stampText({ name: "Void" })).toBe("VOID");
    expect(stampSize("Approved").w).toBeGreaterThanOrEqual(110);
    expect(stampFontSize("FOR PUBLIC RELEASE", 150, 44)).toBeLessThan(stampFontSize("VOID", 150, 44));
    expect(stampDate(new Date(2026, 10, 16).getTime())).toBe("16 Nov 2026");
    expect(dateStamp(new Date(2026, 0, 5).getTime())).toMatchObject({ name: "Date", label: "5 Jan 2026" });
  });

  it("draws signatures: strokes in the box, typed text in its font, and a picture", async () => {
    const m = await mount();
    const [d, t, i] = await run(() => [
      m.session.annots.add(P0, { type: "signature", rect: { x: 100, y: 100, w: 100, h: 40 }, mode: "draw", strokes: [[[0, 0], [50, 40], [100, 10]]], color: "#0b2a6b", width: 2 } as never, { select: false }),
      m.session.annots.add(P0, { type: "signature", rect: { x: 100, y: 200, w: 160, h: 40 }, mode: "type", text: "Ana Reyes", font: "Dancing Script", color: "#111111" } as never, { select: false }),
      m.session.annots.add(P0, { type: "signature", rect: { x: 100, y: 300, w: 100, h: 40 }, mode: "image", picture: { src: "data:image/png;base64,AA==" } } as never, { select: false }),
    ]);
    await flush();
    expect(shape(d).querySelector("g")!.getAttribute("transform")).toBe("translate(100 100)");
    expect(q("path", shape(d)).getAttribute("d")).toBe("M0 0Q50 40 75 25L100 10");
    const text = q("text", shape(t));
    expect(text.textContent).toBe("Ana Reyes");
    expect(text.style.fontFamily).toContain("Dancing Script");
    expect(text.getAttribute("fill")).toBe("#111111");
    expect(q("image", shape(i)).getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("draws a picture over its rectangle, links only when asked, and redaction marks hatched", async () => {
    const m = await mount();
    const [img, link, red] = await run(() => [
      m.session.annots.add(P0, { type: "image", rect: { x: 10, y: 10, w: 80, h: 60 }, picture: { src: "data:image/png;base64,AA==" } } as never, { select: false }),
      m.session.annots.add(P0, { type: "link", rect: { x: 10, y: 100, w: 80, h: 14 }, uri: "https://example.com" } as never, { select: false }),
      m.session.annots.add(P0, { type: "redact", rects: [{ x: 10, y: 200, w: 80, h: 12 }, { x: 10, y: 220, w: 40, h: 12 }], overlay: "REDACTED" } as never, { select: false }),
    ]);
    await flush();
    const image = q("image", shape(img));
    expect([image.getAttribute("x"), image.getAttribute("width"), image.getAttribute("height")]).toEqual(["10", "80", "60"]);
    expect(qa("rect", shape(link))).toHaveLength(0);
    await click(byLabel("Show links", host));
    expect(qa("rect", shape(link))).toHaveLength(1);
    expect(shape(red).querySelector("pattern")).toBeTruthy();
    expect(qa("rect[stroke-dasharray]", shape(red))).toHaveLength(2);
    expect(q("text", shape(red)).textContent).toBe("REDACTED");
  });

  it("applies opacity, and skips hidden annotations", async () => {
    const m = await mount();
    const [a, b] = await run(() => [
      m.session.annots.add(P0, { type: "square", rect: { x: 0, y: 0, w: 10, h: 10 }, stroke, opacity: 0.4 } as never, { select: false }),
      m.session.annots.add(P0, { type: "square", rect: { x: 0, y: 0, w: 10, h: 10 }, stroke, hidden: true } as never, { select: false }),
    ]);
    await flush();
    expect(shape(a).getAttribute("opacity")).toBe("0.4");
    expect(document.querySelector(`[data-annot="${b}"]`)).toBeNull();
  });

  it.each([1, 2, 3])("draws the same with the view turned %i quarter turns: the layer is turned, the shapes are not", async (turns) => {
    const m = await mount({ turns });
    const id = await run(() => m.session.annots.add(P0, { type: "square", rect: { x: 20, y: 30, w: 100, h: 50 }, stroke } as never, { select: false }));
    await flush();
    const rect = q("rect", shape(id));
    expect([rect.getAttribute("x"), rect.getAttribute("y"), rect.getAttribute("width")]).toEqual(["20", "30", "100"]);
    expect(shape(id).closest("svg")!.style.transform).toContain(`rotate(${turns * 90}deg)`);
  });
});

describe("annotation types in the model", () => {
  it("has a drawing for every annotation type", async () => {
    const m = await mount();
    const samples: Annotation[] = [
      { id: "1", type: "highlight", color: "#ff0", rects: [{ x: 0, y: 0, w: 5, h: 5 }] },
      { id: "2", type: "ink", strokes: [[[0, 0], [1, 1]]], stroke },
      { id: "3", type: "note", x: 0, y: 0 },
      { id: "4", type: "freetext", rect: { x: 0, y: 0, w: 50, h: 20 }, text: "x", style: { family: "Helvetica", size: 10, color: "#000" } },
      { id: "5", type: "redact", rects: [{ x: 0, y: 0, w: 5, h: 5 }] },
    ];
    await run(() => samples.forEach((s) => m.session.annots.add(P0, s as never, { select: false })));
    await flush();
    expect(qa("[data-annot]").map((e) => e.getAttribute("data-type")).sort()).toEqual(["freetext", "highlight", "ink", "note", "redact"]);
  });
});
