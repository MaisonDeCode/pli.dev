// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, createDoc, floatingImage, paragraph, plainText, textBox, type Block } from "@pli.dev/docs";
import { DocumentView, PliDocument } from "../src";
import { anchorsOf } from "../src/layout/measure";
import { EMPTY_LAYOUT, type Layout } from "../src/layout/paginate";
import { floatFrames, type SheetBox } from "../src/floats";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

// Two pages 816 x 1056 with one-inch margins, one above the other, measured from the body's top left corner (which is the margin).
const sheets: SheetBox[] = [0, 1].map((k) => ({ left: -96, top: -96 + k * 1080, width: 816, height: 1056, margin: { top: 96, right: 96, bottom: 96, left: 96 } }));
const layout = (over: Partial<Layout> = {}): Layout => ({ ...EMPTY_LAYOUT, pages: 2, ...over });

describe("where floating objects go", () => {
  const at = (doc: Block[], over: Partial<Layout> = {}) => floatFrames(doc, layout(over), sheets);

  it("counts a position from the edge of the page, the margin or the text column", () => {
    const body = paragraph("x");
    const f = (x: object, y: object) => floatingImage(PNG, { width: 100, height: 50 }, { x, y } as never);
    const page = f({ from: "page", offset: 10 }, { from: "page", offset: 20 });
    const margin = f({ from: "margin", offset: 10 }, { from: "margin", offset: 20 });
    const column = f({ from: "column", offset: 10 }, { from: "margin" });
    const frames = at([page, margin, column, body]);
    expect(frames.get(page.id)).toMatchObject({ left: -96 + 10, top: -96 + 20, origin: { x: -96, y: -96 } });
    expect(frames.get(margin.id)).toMatchObject({ left: 10, top: 20 });
    expect(frames.get(column.id)).toMatchObject({ left: 10, top: 0 });
  });

  it("lines an object up with a side or the middle, with the offset as the gap left", () => {
    const body = paragraph("x");
    const right = floatingImage(PNG, { width: 100, height: 50 }, { x: { from: "margin", align: "right", offset: 5 }, y: { from: "page", align: "bottom" } });
    const middle = floatingImage(PNG, { width: 200, height: 50 }, { x: { from: "page", align: "center" }, y: { from: "page", align: "center" } });
    const frames = at([right, middle, body]);
    // The text is 624 wide, from 0 to 624: the picture ends 5 short of the right.
    expect(frames.get(right.id)).toMatchObject({ left: 624 - 100 - 5, top: -96 + 1056 - 50 });
    expect(frames.get(middle.id)).toMatchObject({ left: -96 + (816 - 200) / 2, top: -96 + (1056 - 50) / 2 });
  });

  it("puts an object on the page its paragraph is on, and down from the top of that paragraph", () => {
    const first = paragraph("one");
    const second = paragraph("two");
    const box = textBox("hi", { x: { from: "column" }, y: { from: "paragraph", offset: 12 }, width: 100, height: 40 });
    const frames = at([first, box, second], { pageOf: new Map([[first.id, 1], [second.id, 2]]), tops: new Map([[second.id, 1100]]) });
    // It belongs to the paragraph after it, which is on page 2, 1100 down the flow.
    expect(frames.get(box.id)).toMatchObject({ left: 0, top: 1112 });
  });

  it("belongs to the paragraph before it when it is last, and a table is known by its first row", () => {
    const last = paragraph("last");
    const box = textBox("hi", { x: { from: "column" }, y: { from: "paragraph" }, width: 10, height: 10 });
    expect(at([last, box], { pageOf: new Map([[last.id, 2]]), tops: new Map([[last.id, 1500]]) }).get(box.id)).toMatchObject({ top: 1500 });
    const grid = textBox("cell", { x: { from: "column" }, y: { from: "page" }, width: 10, height: 10 });
    const anchored = floatingImage(PNG, { width: 10, height: 10 }, { x: { from: "column" }, y: { from: "paragraph", offset: 3 } });
    // A table is known to the paginator by its first row.
    const table = { ...grid, float: undefined } as unknown as Block;
    const row = (table as { rows: { id: string }[] }).rows[0]!.id;
    const frames = at([anchored, table], { pageOf: new Map([[row, 2]]), tops: new Map([[row, 40]]) });
    expect(frames.get(anchored.id)).toMatchObject({ top: 43 });
    expect(anchorsOf([anchored, table])).toEqual(new Set([row]));
  });

  it("cuts off what runs past the edge of its page", () => {
    const body = paragraph("x");
    const bleed = floatingImage(PNG, { width: 950, height: 1810 }, { x: { from: "column", offset: -116 }, y: { from: "paragraph", offset: -821 } });
    const frames = at([bleed, body], { tops: new Map([[body.id, 800]]), pageOf: new Map([[body.id, 1]]) });
    const frame = frames.get(bleed.id)!;
    // 20 of it is left of the page, 114 is right of it, and the bottom 829 is below it; the top is on the page.
    expect(frame.clip).toEqual({ top: 0, right: 114, bottom: 829, left: 20 });
  });

  it("is left out when there are no sheets yet", () => {
    expect(floatFrames([floatingImage(PNG, { width: 1, height: 1 }, { x: { from: "page" }, y: { from: "page" } })], layout(), [])).toEqual(new Map());
  });
});

describe("drawing floating objects", () => {
  const view = (blocks: Block[], props: Partial<Parameters<typeof DocumentView>[0]> = {}) => {
    act(() => root.render(<DocumentView doc={createDoc("T", blocks)} {...props} />));
  };

  it("draws a picture where the page says, behind the text when it is", () => {
    const bg = floatingImage(PNG, { width: 816, height: 1056 }, { x: { from: "page" }, y: { from: "page" }, behind: true });
    const body = paragraph("text");
    view([bg, body], { floatFrames: new Map([[bg.id, { left: -96, top: -96, clip: null, origin: { x: -96, y: -96 } }]]) });
    const figure = host.querySelector<HTMLElement>("figure.pli-float")!;
    expect(figure.style.position).toBe("absolute");
    expect(figure.style.left).toBe("-96px");
    expect(figure.style.top).toBe("-96px");
    expect(figure.style.width).toBe("816px");
    expect(figure.style.zIndex).toBe("-1");
    expect(figure.hasAttribute("data-behind")).toBe(true);
    // The text is still the text: the picture takes no place in it.
    expect(host.querySelector("p")!.textContent).toBe("text");
  });

  it("draws a picture in front of the text, and by its distances when there is no page to measure against", () => {
    const logo = floatingImage(PNG, { width: 80, height: 30 }, { x: { from: "margin", offset: 12 }, y: { from: "paragraph", offset: 7 } });
    view([logo, paragraph("x")]);
    const figure = host.querySelector<HTMLElement>("figure.pli-float")!;
    expect(figure.style.zIndex).toBe("1");
    expect(figure.style.marginLeft).toBe("12px");
    expect(figure.style.marginTop).toBe("7px");
    expect(figure.style.left).toBe("");
  });

  it("draws a text box with its fill, outline and shape, and its text where it can be edited", () => {
    const box = textBox(["Hello", "{{ name }}"], {
      x: { from: "page" },
      y: { from: "page" },
      width: 300,
      height: 120,
      shape: "round_rect",
      fill: "#336699",
      fillOpacity: 0.5,
      line: { color: "#ff0000", width: 4, style: "dashed" },
      padding: { x: 6, y: 3 },
    });
    view([box, paragraph("x")], { floatFrames: new Map([[box.id, { left: 10, top: 20, clip: { top: 0, right: 5, bottom: 0, left: 0 }, origin: { x: 0, y: 0 } }]]) });
    const el = host.querySelector<HTMLElement>(".pli-textbox")!;
    expect(el.getAttribute("data-type")).toBe("table");
    expect(el.style.width).toBe("300px");
    expect(el.style.backgroundColor).toBe("rgba(51, 102, 153, 0.5)");
    expect(el.style.borderStyle).toBe("dashed");
    expect(el.style.borderWidth).toBe("4px");
    expect(el.style.borderRadius).toBe("20px");
    expect(el.style.clipPath).toBe("inset(0px 5px 0px 0px)");
    const cell = el.querySelector<HTMLElement>(".pli-textbox-cell")!;
    expect(cell.style.padding).toBe("3px 6px");
    expect([...cell.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Hello", "{{ name }}"]);
    // It is a block with a row and a cell, like a table, so editing finds the text in it.
    expect(el.querySelector("[data-row-id]")).not.toBeNull();
    expect(cell.querySelector("p")!.hasAttribute("data-block-id")).toBe(true);
  });

  it("gets no move or resize handles when it can't be changed", () => {
    const box = textBox("x", { x: { from: "page" }, y: { from: "page" }, width: 50, height: 50 });
    view([box, paragraph("y")]);
    expect(host.querySelector(".pli-float-grip")).toBeNull();
    expect(host.querySelector(".pli-float-resize")).toBeNull();
    view([box, paragraph("y")], { onMoveFloat: () => undefined, onResizeFloat: () => undefined, selectedId: box.id });
    expect(host.querySelector(".pli-float-grip")).not.toBeNull();
    expect(host.querySelector(".pli-float-resize")).not.toBeNull();
  });
});

describe("the editor", () => {
  const menu = (name: string) => act(() => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name)!.click());
  const item = (label: string) => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")].find((i) => i.textContent?.startsWith(label))!;

  it("inserts a text box from the Insert menu with the caret in it, and a shape without text", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("one"), paragraph("two")]));
    act(() => root.render(<PliDocument session={s} />));
    act(() => s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 1 }, focus: { block: s.state.blocks[1]!.id, offset: 1 } }));
    menu("Insert");
    act(() => item("Text box").click());
    expect(s.floats).toHaveLength(1);
    expect(s.state.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(host.querySelector(".pli-textbox")).not.toBeNull();
    // The caret is in the box.
    act(() => void s.typeText("typed"));
    const box = s.floats[0]!;
    expect(box.type === "table" && plainText((box.rows[0]!.cells[0]!.blocks[0] as unknown as { runs: never }).runs)).toBe("typed");

    menu("Insert");
    act(() => item("Shape").click());
    act(() => item("Oval").click());
    expect(s.floats).toHaveLength(2);
    expect(s.floats[0]).toMatchObject({ float: { shape: "ellipse" } });
  });

  it("lists the objects under Format so one behind the text can be chosen, and takes one away", () => {
    const bg = floatingImage(PNG, { width: 816, height: 1056 }, { x: { from: "page" }, y: { from: "page" }, behind: true }, { alt: "Cover art" });
    const s = new DocumentSession(createDoc("T", [bg, paragraph("one")]));
    act(() => root.render(<PliDocument session={s} />));
    act(() => s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 0 }, focus: { block: s.state.blocks[1]!.id, offset: 0 } }));
    menu("Format");
    act(() => item("Object on the page").click());
    const labels = [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem], .pli-menu-panel [role=menuitemcheckbox]")].map((i) => i.textContent ?? "");
    expect(labels.some((l) => l.startsWith("Background picture 1: Cover art"))).toBe(true);
    // Choosing it from the list selects it (checked in a browser: jsdom has no real focus to carry the selection).
    menu("Format");
    act(() => s.select({ anchor: { block: bg.id, offset: 0 }, focus: { block: bg.id, offset: 0 } }));
    menu("Format");
    act(() => item("Object on the page").click());
    const del = [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")].find((i) => i.textContent?.startsWith("Delete"))!;
    act(() => del.click());
    expect(s.floats).toHaveLength(0);
  });
});
