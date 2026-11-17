// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, paragraphsFromText, plainText, type Paragraph } from "@pli.dev/decks";
import { PliDeck, SlideView, hitTest } from "../src";
import { withFrames } from "../src/preview";
import { caretAt, changeIndent, deleteContent, formatOf, pressEnter, stepOffset, toggleList, wholeRange } from "../src/textedit";
import { domToPos, htmlToText, posToDom } from "../src/domsel";
import { byLabel, click, key, newSession, pointer, q, qa, render, run, useHost } from "./harness";
import { writeSelection } from "../src/domsel";

useHost();

const ps = (...lines: string[]): Paragraph[] => paragraphsFromText(lines.join("\n"));

describe("text editing helpers", () => {
  it("steps over whole characters: emoji and accents count once", () => {
    expect(stepOffset("a😀b", 3, -1)).toBe(1);
    expect(stepOffset("a😀b", 1, 1)).toBe(3);
    expect(stepOffset("abc", 0, -1)).toBe(0);
    expect(stepOffset("abc", 3, 1)).toBe(3);
    expect(stepOffset("éx", 2, -1)).toBe(0);
  });

  it("deletes ranges, characters, words and lines, and joins paragraphs at their edges", () => {
    expect(plainText(deleteContent(ps("hello world"), caretAt({ p: 0, o: 11 }), -1, "word")!.paragraphs)).toBe("hello ");
    expect(plainText(deleteContent(ps("hello world"), caretAt({ p: 0, o: 0 }), 1, "word")!.paragraphs)).toBe(" world");
    expect(plainText(deleteContent(ps("hello world"), caretAt({ p: 0, o: 5 }), -1, "line")!.paragraphs)).toBe(" world");
    expect(plainText(deleteContent(ps("hello world"), caretAt({ p: 0, o: 5 }), 1, "line")!.paragraphs)).toBe("hello");
    const joined = deleteContent(ps("ab", "cd"), caretAt({ p: 1, o: 0 }), -1, "char")!;
    expect(plainText(joined.paragraphs)).toBe("abcd");
    expect(joined.caret).toEqual({ p: 0, o: 2 });
    expect(plainText(deleteContent(ps("ab", "cd"), caretAt({ p: 0, o: 2 }), 1, "char")!.paragraphs)).toBe("abcd");
    expect(deleteContent(ps("ab"), caretAt({ p: 0, o: 0 }), -1, "char")).toBeNull();
    expect(deleteContent(ps("ab"), caretAt({ p: 0, o: 2 }), 1, "char")).toBeNull();
    const range = deleteContent(ps("hello", "world"), { from: { p: 0, o: 2 }, to: { p: 1, o: 3 } }, -1, "char")!;
    expect(plainText(range.paragraphs)).toBe("held");
  });

  it("Backspace at the start of a list item takes it out of the list instead of joining", () => {
    const list = [{ runs: [{ text: "a" }] }, { level: 1, bullet: { type: "char" as const, char: "-" }, runs: [{ text: "b" }] }];
    const info = (p: number) => ({ listed: p === 1, level: p === 1 ? 1 : 0 });
    const out = deleteContent(list, caretAt({ p: 1, o: 0 }), -1, "char", info)!;
    expect(out.paragraphs).toHaveLength(2);
    expect(out.paragraphs[1]!.level ?? 0).toBe(0);
  });

  it("Enter splits and carries marks; on an empty list item it ends the list", () => {
    const out = pressEnter([{ runs: [{ text: "abcd", marks: { bold: true } }] }], caretAt({ p: 0, o: 2 }));
    expect(out.paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["ab", "cd"]);
    expect(out.paragraphs[1]!.runs[0]!.marks).toEqual({ bold: true });
    expect(out.caret).toEqual({ p: 1, o: 0 });
    const atEnd = pressEnter([{ runs: [{ text: "ab", marks: { italic: true } }] }], caretAt({ p: 0, o: 2 }));
    expect(atEnd.paragraphs[1]!.endMarks).toEqual({ italic: true });
    const empty = pressEnter([{ bullet: { type: "char", char: "-" }, runs: [] }], caretAt({ p: 0, o: 0 }), () => ({ listed: true, level: 0 }));
    expect(empty.paragraphs).toHaveLength(1);
    expect(empty.paragraphs[0]!.bullet).toBeNull();
  });

  it("indents, toggles lists on and off, and reads the format from resolved text", () => {
    const indented = changeIndent(ps("a", "b"), wholeRange(ps("a", "b")), 1, () => ({ level: 0, marL: 18 }));
    expect(indented.map((p) => [p.level, p.marL])).toEqual([[1, 36], [1, 36]]);
    const back = changeIndent(indented, wholeRange(indented), -1, () => ({ level: 1, marL: 36 }));
    expect(back[0]!.level).toBeUndefined();
    const on = toggleList(ps("a", "b"), wholeRange(ps("a", "b")), "number", () => undefined);
    expect(on.every((p) => p.bullet?.type === "number" && p.marL! > 0 && p.indent! < 0)).toBe(true);
    const s = new DeckSession(createDeck());
    const slide = s.addSlide();
    const body = slide.elements[1]!;
    s.setText(slide.id, body.id, [{ runs: [{ text: "ab", marks: { bold: true } }, { text: "cd", marks: { fontSize: 30 } }] }]);
    const raw = (s.element(slide.id, body.id) as { text: { paragraphs: Paragraph[] } }).text.paragraphs;
    const text = s.scene(slide.id).elements.find((e) => e.id === body.id)!.text;
    const f = formatOf(raw, text, { from: { p: 0, o: 0 }, to: { p: 0, o: 2 } });
    expect(f).toMatchObject({ bold: true, bullet: "bullet", fontFamily: "Arial" });
    expect(formatOf(raw, text, wholeRange(raw))).toMatchObject({ bold: false, fontSize: undefined });
    expect(formatOf(raw, text, caretAt({ p: 0, o: 4 })).fontSize).toBe(30);
    expect(formatOf(raw, text, caretAt({ p: 0, o: 0 })).bold).toBe(true);
  });

  it("maps between DOM positions and text positions, and reads pasted HTML as text", () => {
    const s = newSession();
    render(<SlideView scene={s.scene(s.deck.slides[1]!.id)} />);
    const body = q(".pli-deck-text-body", qa(".pli-deck-text").find((t) => t.textContent!.includes("One"))!);
    const dom = posToDom(body, { p: 1, o: 2 })!;
    expect(dom.node.textContent).toBe("Two");
    expect(dom.offset).toBe(2);
    expect(domToPos(body, dom.node, dom.offset)).toEqual({ p: 1, o: 2 });
    expect(domToPos(body, body, 0)).toEqual({ p: 0, o: 0 });
    expect(domToPos(body, body, 99)).toEqual({ p: 2, o: 5 });
    // the bullet is not text
    expect(domToPos(body, body.querySelector(".pli-deck-bullet")!.firstChild, 1)).toEqual({ p: 0, o: 0 });
    expect(domToPos(body, document.body, 0)).toBeNull();
    expect(htmlToText("<style>x{}</style><p>a<br>b</p><ul><li>c</li><li>d</li></ul>")).toBe("a\nb\nc\nd");
    void writeSelection;
  });
});

describe("hit testing and previews", () => {
  it("hits the topmost element, but only the outline of an unfilled shape and the line itself", () => {
    const s = new DeckSession(createDeck());
    const title = s.deck.slides[0]!;
    const slide = s.addSlide({ layout: s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!.id });
    const filled = s.addShape(slide.id, "rect", { x: 100, y: 100, w: 100, h: 100 });
    const hollow = s.addShape(slide.id, "rect", { x: 300, y: 100, w: 100, h: 100 }, { fill: null });
    const line = s.addShape(slide.id, "line", { x: 100, y: 300, w: 100, h: 50 });
    const scene = s.scene(slide.id);
    expect(hitTest(scene, "slide", 150, 150)?.id).toBe(filled.id);
    expect(hitTest(scene, "slide", 350, 150)).toBeNull();
    expect(hitTest(scene, "slide", 301, 150)?.id).toBe(hollow.id);
    expect(hitTest(scene, "slide", 150, 325)?.id).toBe(line.id);
    expect(hitTest(scene, "slide", 190, 305)).toBeNull();
    // placeholders take clicks anywhere inside
    expect(hitTest(s.scene(title.id), "slide", 360, 130)?.id).toBe(title.elements[0]!.id);
    expect(hitTest(scene, "layout", 150, 150)).toBeNull();
    // rotated frames are hit where they are drawn
    s.setFrame(slide.id, filled.id, { rotation: 45 });
    const turned = s.scene(slide.id);
    expect(hitTest(turned, "slide", 150, 95)?.id).toBe(filled.id);
    expect(hitTest(turned, "slide", 105, 105)).toBeNull();
  });

  it("previews frames, moving a group's children with it", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const a = s.addShape(slide.id, "rect", { x: 10, y: 10, w: 20, h: 20 });
    const b = s.addShape(slide.id, "rect", { x: 50, y: 10, w: 20, h: 20 });
    const gid = s.group(slide.id, [a.id, b.id])!;
    const scene = s.scene(slide.id);
    const next = withFrames(scene, new Map([[gid, { x: 110, y: 10, w: 120, h: 40, rotation: 0 }]]));
    const group = next.elements.find((e) => e.id === gid)!;
    expect(group.x).toBe(110);
    expect(group.children!.map((c) => [c.x, c.w])).toEqual([[110, 40], [230 - 40, 40]]);
    expect(withFrames(scene, new Map())).toBe(scene);
  });
});

describe("autofit and undo", () => {
  it("shrinks text that overflows its box with the engine's layout, and leaves a fitting box alone", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const long = "word ".repeat(200);
    const sh = s.addShape(slide.id, "rect", { x: 0, y: 0, w: 200, h: 60 });
    s.updateElement(slide.id, sh.id, (e) => (e.type === "shape" ? { ...e, text: { paragraphs: paragraphsFromText(long), autofit: "shrink" } } : e));
    const small = s.addShape(slide.id, "rect", { x: 0, y: 100, w: 200, h: 60 });
    s.updateElement(slide.id, small.id, (e) => (e.type === "shape" ? { ...e, text: { paragraphs: paragraphsFromText("hi"), autofit: "shrink" } } : e));
    render(<SlideView scene={s.scene(slide.id)} />);
    const texts = qa<HTMLElement>(".pli-deck-text").filter((t) => t.dataset.autofit === "shrink");
    expect(Number(texts[0]!.style.getPropertyValue("--pli-fit"))).toBeLessThan(0.5);
    expect(texts[1]!.style.getPropertyValue("--pli-fit")).toBe("");
  });

  it("undo while editing puts the caret back where it was, and redo too", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pointer(q(".pli-deck-stage"), "dblclick", 100, 150);
    const body = () => q<HTMLElement>('[role="textbox"]');
    const type = (t: string) => act(() => void body().dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: t, bubbles: true, cancelable: true })));
    type("!");
    expect(plainText((s.deck.slides[0]!.elements[0] as unknown as { text: { paragraphs: Paragraph[] } }).text.paragraphs)).toBe("Hello world!");
    key(body(), "z", { metaKey: true });
    expect(plainText((s.deck.slides[0]!.elements[0] as unknown as { text: { paragraphs: Paragraph[] } }).text.paragraphs)).toBe("Hello world");
    expect(s.selection.elements).toEqual([s.deck.slides[0]!.elements[0]!.id]);
    run(() => s.redo());
    expect(plainText((s.deck.slides[0]!.elements[0] as unknown as { text: { paragraphs: Paragraph[] } }).text.paragraphs)).toBe("Hello world!");
    click(byLabel("Redo"));
  });
});
