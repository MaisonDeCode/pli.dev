// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, paragraphsFromText, slideFromLayout, newId } from "@pli.dev/decks";
import { SlideView } from "../src";
import { host, newSession, q, qa, render, sampleDeck, useHost } from "./harness";

useHost();

describe("SlideView", () => {
  it("draws the background, elements in order, and text from the scene", () => {
    const s = newSession(sampleDeck());
    const id = s.deck.slides[0]!.id;
    render(<SlideView scene={s.scene(id)} scale={0.5} />);
    const slide = q(".pli-deck-slide");
    expect(slide.style.width).toBe("360px");
    expect(slide.style.height).toBe("202.5px");
    expect(q(".pli-deck-inner").style.transform).toBe("scale(0.5)");
    expect(qa(".pli-deck-el").map((e) => e.dataset.kind)).toEqual(["shape", "shape"]);
    expect(q(".pli-deck-text").textContent).toBe("Hello world");
  });

  it("shows placeholder prompts only when asked", () => {
    const s = newSession(sampleDeck());
    const id = s.deck.slides[0]!.id;
    render(<SlideView scene={s.scene(id)} />);
    expect(host.textContent).not.toContain("Click to add subtitle");
    render(<SlideView scene={s.scene(id)} prompts />);
    expect(host.textContent).toContain("Click to add subtitle");
    expect(q("[data-prompt]")).toBeTruthy();
  });

  it("draws shapes as SVG with fill, line, dash and arrowheads", () => {
    const s = newSession(sampleDeck());
    const slide = s.deck.slides[2]!;
    const arrow = s.addShape(slide.id, "line", { x: 10, y: 10, w: 100, h: 0 }, { line: { width: 3, color: "#ff0000", dash: "dash", tail: "triangle" } });
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${arrow.id}"]`);
    const path = el.querySelector("path:not(marker path)") as SVGPathElement;
    expect(path.getAttribute("stroke")).toBe("#ff0000");
    expect(path.getAttribute("stroke-width")).toBe("3");
    expect(path.getAttribute("stroke-dasharray")).toBe("12 9");
    expect(path.getAttribute("marker-end")).toMatch(/^url\(#/);
    expect(el.querySelector("marker")).toBeTruthy();
    const rect = qa("svg").find((v) => v.querySelector("path")?.getAttribute("fill") === "#4285f4");
    expect(rect).toBeTruthy();
  });

  it("applies rotation, and flips only the geometry", () => {
    const s = newSession(sampleDeck());
    const slide = s.deck.slides[2]!;
    const sh = s.addShape(slide.id, "rect", { x: 10, y: 10, w: 50, h: 40 }, { rotation: 30, flipH: true });
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${sh.id}"]`);
    expect(el.style.transform).toBe("rotate(30deg)");
    expect((el.querySelector("svg") as SVGElement).style.transform).toBe("scale(-1, 1)");
  });

  it("styles runs and paragraphs: marks, bullets, alignment, spacing", () => {
    const s = new DeckSession(createDeck());
    const slide = s.addSlide();
    const body = slide.elements[1]!;
    s.setText(slide.id, body.id, [
      { runs: [{ text: "Plain " }, { text: "bold", marks: { bold: true, italic: true, underline: true, strike: true, color: "#00ff00", highlight: "#ffff00" } }, { text: "x", marks: { baseline: "super" } }] },
      { align: "center", level: 1, runs: [{ text: "second", marks: { fontSize: 30, fontFamily: "Georgia", allCaps: true, link: "https://example.com" } }] },
    ]);
    render(<SlideView scene={s.scene(slide.id)} />);
    const runs = qa(".pli-deck-run");
    const bold = runs.find((r) => r.textContent === "bold")!;
    expect(bold.style.fontWeight).toBe("700");
    expect(bold.style.fontStyle).toBe("italic");
    expect(bold.style.textDecoration).toBe("underline line-through");
    expect(bold.style.color).toBe("rgb(0, 255, 0)");
    expect(bold.style.background).toBe("rgb(255, 255, 0)");
    const sup = runs.find((r) => r.textContent === "x")!;
    expect(sup.style.position).toBe("relative");
    const paras = qa(".pli-deck-p", qa(".pli-deck-text").find((t) => t.textContent?.includes("second"))!);
    expect(paras[1]!.style.textAlign).toBe("center");
    expect(paras[0]!.querySelector(".pli-deck-bullet")!.textContent).toBe("●");
    const linked = runs.find((r) => r.textContent === "second")!;
    expect(linked.tagName).toBe("A");
    expect(linked.style.textTransform).toBe("uppercase");
    expect(linked.style.fontFamily).toContain("Georgia");
    expect(paras[0]!.querySelector(".pli-deck-runs")!.getAttribute("data-runs")).toBe("");
    expect(runs.find((r) => r.textContent === "bold")!.dataset.o).toBe("6");
  });

  it("numbers lists and draws the number in the bullet", () => {
    const s = new DeckSession(createDeck());
    const slide = s.addSlide();
    const body = slide.elements[1]!;
    s.setText(slide.id, body.id, ["a", "b", "c"].map((t) => ({ bullet: { type: "number" as const, scheme: "arabicPeriod" as const }, runs: [{ text: t }] })));
    render(<SlideView scene={s.scene(slide.id)} />);
    expect(qa(".pli-deck-bullet").map((b) => b.textContent)).toEqual(["1.", "2.", "3."]);
  });

  it("anchors text vertically and honours wrap", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const sh = s.addShape(slide.id, "rect", { x: 0, y: 0, w: 100, h: 100 });
    s.updateElement(slide.id, sh.id, (e) => (e.type === "shape" ? { ...e, text: { paragraphs: paragraphsFromText("hi"), vAlign: "bottom", wrap: false, insets: { l: 1, t: 2, r: 3, b: 4 } } } : e));
    render(<SlideView scene={s.scene(slide.id)} />);
    const text = qa(".pli-deck-text").find((t) => t.textContent === "hi")!;
    expect(text.style.justifyContent).toBe("flex-end");
    expect(text.style.padding).toBe("2px 3px 4px 1px");
    expect((text.firstElementChild as HTMLElement).style.whiteSpace).toBe("pre");
  });

  it("draws images with crop and a geometry mask, and alt text", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const img = s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 100, h: 100 }, { x: 0, y: 0 }, { crop: { l: 0.25, r: 0.25 }, geometry: "ellipse", alt: "A circle", line: { width: 2, color: "#000000" } });
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${img.id}"]`);
    const pic = el.querySelector("img")!;
    expect(pic.alt).toBe("A circle");
    expect(pic.style.width).toBe("200px");
    expect(pic.style.left).toBe("-50px");
    expect((el.querySelector(".pli-deck-image-clip") as HTMLElement).style.clipPath).toContain("path(");
    expect(el.querySelector("svg path")).toBeTruthy();
  });

  it("draws tables as cells with text, fills and borders", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const t = s.addTable(slide.id, 2, 2);
    s.setCellParagraphs(slide.id, t.id, 0, 0, paragraphsFromText("H1"));
    s.setCellParagraphs(slide.id, t.id, 1, 1, paragraphsFromText("body"));
    s.mergeCells(slide.id, t.id, { r1: 1, c1: 0, r2: 1, c2: 1 });
    render(<SlideView scene={s.scene(slide.id)} />);
    const cells = qa(".pli-deck-cell");
    expect(cells.length).toBe(3);
    expect(cells[0]!.textContent).toBe("H1");
    expect(cells[0]!.style.background).toBe("rgb(66, 133, 244)");
    expect(cells[0]!.style.borderTop).toContain("solid");
    expect(q("[role=table]")).toBeTruthy();
    expect(cells[2]!.style.width).toBe(`${t.w}px`);
  });

  it("draws groups with their children and makes links followable only when asked", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const a = s.addShape(slide.id, "rect", { x: 10, y: 10, w: 30, h: 30 });
    const b = s.addShape(slide.id, "rect", { x: 100, y: 100, w: 30, h: 30 }, { link: "https://example.com/x" });
    s.group(slide.id, [a.id, b.id]);
    render(<SlideView scene={s.scene(slide.id)} />);
    expect(qa("[data-kind=group] [data-kind=shape]").length).toBe(2);
    expect(qa("a.pli-deck-link").length).toBe(0);
    render(<SlideView scene={s.scene(slide.id)} links />);
    expect(q("a.pli-deck-link").getAttribute("href")).toBe("https://example.com/x");
    s.undo();
  });

  it("refuses to link unsafe addresses", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    s.addShape(slide.id, "rect", {}, { link: "javascript:alert(1)" });
    render(<SlideView scene={s.scene(slide.id)} links />);
    expect(qa("a").length).toBe(0);
  });

  it("draws gradient and picture backgrounds", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    s.setBackground([id], { gradient: { angle: 0, stops: [{ at: 0, color: "#ff0000" }, { at: 1, color: "#0000ff" }] } });
    render(<SlideView scene={s.scene(id)} />);
    expect(q(".pli-deck-page").style.background).toContain("linear-gradient(90deg");
    s.setBackground([id], { image: { src: "data:image/png;base64,AAAA" } });
    render(<SlideView scene={s.scene(id)} />);
    expect(q("img.pli-deck-bg-image").getAttribute("src")).toContain("data:image/png");
  });

  it("highlights find matches", () => {
    const s = newSession(sampleDeck());
    const slide = s.deck.slides[0]!;
    const hits = s.find("world");
    render(<SlideView scene={s.scene(slide.id)} highlights={hits.map((h, i) => ({ element: h.element!, paragraph: h.paragraph, offset: h.offset, length: h.length, current: i === 0 }))} />);
    expect(q("mark.pli-deck-find-current").textContent).toBe("world");
  });

  it("is a pure function of the scene: the same scene renders the same markup", () => {
    const s = newSession(sampleDeck());
    const scene = s.scene(s.deck.slides[1]!.id);
    render(<SlideView scene={scene} />);
    const a = host.innerHTML.replace(/:r[0-9a-z]+:/g, "ID");
    render(<SlideView scene={scene} />);
    expect(host.innerHTML.replace(/:r[0-9a-z]+:/g, "ID")).toBe(a);
    void newId; void slideFromLayout;
  });
});
