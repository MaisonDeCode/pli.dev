// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, headerPictureFrom } from "@pli.dev/sheets";
import { PliSheet } from "../src";
import { png, pngUri } from "../../sheets/test/images-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function (this: Blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(this); }); };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("iframe").forEach((f) => f.remove());
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const dialogButton = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const field = (label: string) => dialog().querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
const overlay = () => document.querySelector<HTMLElement>(".pli-print-overlay");
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function mount(rows = 12, cols = 3, configure?: (s: SheetSession) => void) {
  const session = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`)));
  configure?.(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("page setup: comments, errors, draft quality and pictures", () => {
  it("saves the choices of the comments, errors and draft options", () => {
    const s = mount();
    choose("File", "Page setup…");
    expect((field("Comments") as HTMLSelectElement).value).toBe("none");
    setField(field("Comments"), "end");
    setField(field("Cell errors as"), "dash");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((c) => c.parentElement!.textContent!.includes("Draft quality"))!.click());
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((c) => c.parentElement!.textContent!.includes("Black and white"))!.click());
    act(() => void dialogButton("Save").click());
    expect(s.pageSetup("Sheet1")).toEqual({ comments: "end", errors: "dash", draft: true, blackAndWhite: true });
    choose("File", "Page setup…");
    expect((field("Comments") as HTMLSelectElement).value).toBe("end");
    expect((field("Cell errors as") as HTMLSelectElement).value).toBe("dash");
    setField(field("Comments"), "none");
    setField(field("Cell errors as"), "displayed");
    act(() => void dialogButton("Save").click());
    expect(s.pageSetup("Sheet1")).toEqual({ draft: true, blackAndWhite: true });
  });

  it("adds a picture file to a header, with the code in its text, resizes it keeping its shape, and takes it away", async () => {
    const s = mount();
    choose("File", "Page setup…");
    setField(field("Picture in"), "footer");
    setField(field("Picture at"), "right");
    const input = field("Picture file") as HTMLInputElement;
    const file = new File([png(120, 60) as BlobPart], "company-logo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    const row = dialog().querySelector(".pli-pagesetup-pic")!;
    expect(row.textContent).toContain("Footer, right");
    expect(dialog().querySelector<HTMLInputElement>('[data-slot="footer:right"]')!.value).toBe("&G");
    // 120 × 60 pixels is 90 × 45 points, and starts at most 36 points high.
    expect((field("Footer right picture height") as HTMLInputElement).value).toBe("36");
    expect((field("Footer right picture width") as HTMLInputElement).value).toBe("72");
    setField(field("Footer right picture width"), "36");
    expect((field("Footer right picture height") as HTMLInputElement).value).toBe("18");
    act(() => void dialogButton("Save").click());
    const pic = s.pageSetup("Sheet1").pictures!.footer!.right!;
    expect(pic).toMatchObject({ width: 36, height: 18, alt: "company logo" });
    expect(s.pageSetup("Sheet1").footer).toEqual({ right: "&G" });
    choose("File", "Page setup…");
    act(() => void [...dialog().querySelectorAll("button")].find((b) => b.textContent === "Remove")!.click());
    expect(dialog().querySelector<HTMLInputElement>('[data-slot="footer:right"]')!.value).toBe("");
    act(() => void dialogButton("Save").click());
    expect(s.pageSetup("Sheet1")).toEqual({});
  });
});

describe("print preview: the rest of printing", () => {
  it("draws the notes beside their cells when printed as displayed, and lists them on their own page when printed at the end", () => {
    const s = mount(5, 3, (x) => {
      x.setNote("Sheet1", "A2", "Check this", { author: "Pat" });
      x.setNote("Sheet1", "C4", "Not showing");
      x.showNote("Sheet1", "A2");
      x.setPageSetup("Sheet1", { comments: "sheet" });
    });
    choose("File", "Print…");
    let notes = overlay()!.querySelectorAll<HTMLElement>(".pli-print-note");
    // Only the note that is kept showing prints.
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe("Pat:Check this");
    expect(notes[0]!.dataset["cell"]).toBe("A2");
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Close")!.click());
    act(() => void s.setPageSetup("Sheet1", { comments: "end" }));
    choose("File", "Print…");
    expect(overlay()!.querySelectorAll(".pli-print-page")).toHaveLength(2);
    notes = overlay()!.querySelectorAll<HTMLElement>(".pli-print-note");
    expect(notes).toHaveLength(0);
    expect(overlay()!.querySelectorAll(".pli-print-page")[1]!.textContent).toContain("Cell A2:");
    expect(overlay()!.querySelectorAll(".pli-print-page")[1]!.textContent).toContain("Check this");
  });

  it("draws the pictures of a header and footer, and leaves them and the sheet's pictures out in draft quality", () => {
    const s = mount(3, 3, (x) => {
      x.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(pngUri(40, 20), { width: 80 }));
      x.addImage("Sheet1", { src: pngUri(8, 8), from: { row: 2, col: 2 }, width: 40, height: 20, alt: "A box" });
    });
    choose("File", "Print…");
    let page = overlay()!.querySelector(".pli-print-page")!;
    const pic = page.querySelector<HTMLElement>(".pli-print-hfpic")!;
    expect(pic.style.width).toBe("80pt");
    expect(pic.style.height).toBe("40pt");
    expect(pic.querySelector("img")!.src).toContain("data:image/png");
    expect(page.querySelectorAll(".pli-print-objects img")).toHaveLength(1);
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Close")!.click());
    act(() => void s.setPageSetup("Sheet1", { draft: true, blackAndWhite: true }));
    choose("File", "Print…");
    page = overlay()!.querySelector(".pli-print-page")!;
    expect(page.querySelector(".pli-print-hfpic")).toBeNull();
    expect(page.querySelectorAll(".pli-print-objects img")).toHaveLength(0);
    expect(page.querySelector<HTMLElement>(".pli-print-content")!.style.filter).toBe("grayscale(1)");
  });

  it("lays text out running on into empty cells, and errors as the setup says", () => {
    mount(2, 2, (x) => {
      x.setValues("Sheet1", "A1", [["A rather long piece of text that does not fit", null, null, "stop"], ["=1/0", null, null, null]]);
      x.setPageSetup("Sheet1", { errors: "dash" });
    });
    choose("File", "Print…");
    const page = overlay()!.querySelector(".pli-print-page")!;
    expect(page.querySelectorAll(".pli-print-run")).toHaveLength(1);
    expect(page.querySelector(".pli-print-run")!.textContent).toContain("A rather long");
    expect(page.textContent).toContain("--");
    expect(page.textContent).not.toContain("#DIV/0!");
  });
});

describe("page break preview", () => {
  const draw = () => q(".pli-grid-scroller");
  const at = (x: number, y: number) => ({ clientX: x, clientY: y });
  const lines = (axis: "row" | "col") => [...host.querySelectorAll<HTMLElement>(`.pli-pbp-break[data-axis=${axis}]`)].map((e) => ({ after: Number(e.dataset["after"]), manual: e.dataset["manual"] !== undefined }));

  it("is turned on from the View menu and shows the print area, page numbers, and automatic and manual breaks", () => {
    const s = mount(30, 3, (x) => x.setPageSetup("Sheet1", { scale: 400, rowBreaks: [5] }));
    expect(host.querySelector(".pli-pbp-area")).toBeNull();
    choose("View", "Page break preview");
    expect(host.querySelector(".pli-pbp-area")).toBeTruthy();
    expect(s.printLayout("Sheet1").pages.length).toBeGreaterThan(2);
    expect(host.querySelectorAll(".pli-pbp-page").length).toBeGreaterThan(1); // the ones in view
    expect(host.querySelector(".pli-pbp-page")!.textContent).toBe("Page 1");
    const rows = lines("row");
    expect(rows[0]).toEqual({ after: 5, manual: true });
    expect(rows.some((b) => !b.manual)).toBe(true);
    expect(draw()).toBeTruthy();
    choose("View", "Page break preview");
    expect(host.querySelector(".pli-pbp-area")).toBeNull();
  });

  it("dims what is outside a print area", () => {
    mount(30, 6, (x) => x.setPageSetup("Sheet1", { printArea: ["B2:C5"] }));
    choose("View", "Page break preview");
    expect(host.querySelectorAll(".pli-pbp-dim").length).toBeGreaterThanOrEqual(3);
    expect(host.querySelectorAll(".pli-pbp-area")).toHaveLength(1);
  });

  it("drags a manual break to another row as one undo step", () => {
    const s = mount(12, 3, (x) => x.setPageSetup("Sheet1", { rowBreaks: [5] }));
    choose("View", "Page break preview");
    const down = at(100, 24 + 5 * 20);
    pointer("pointerdown", down);
    pointer("pointermove", at(100, 24 + 8 * 20 + 5));
    expect(host.querySelector<HTMLElement>(".pli-pbp-ghost")!.dataset["after"]).toBe("8");
    pointer("pointerup", at(100, 24 + 8 * 20 + 5));
    expect(host.querySelector(".pli-pbp-ghost")).toBeNull();
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([8]);
    expect(lines("row")).toEqual([{ after: 8, manual: true }]);
    act(() => void s.undo());
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([5]);
  });

  it("makes a manual break of an automatic one dragged to another row, and does nothing when it is dropped where it was", () => {
    const s = mount(30, 3, (x) => x.setPageSetup("Sheet1", { scale: 400 }));
    choose("View", "Page break preview");
    const auto = lines("row").find((b) => !b.manual)!.after;
    const y = 24 + auto * 20;
    pointer("pointerdown", at(100, y));
    pointer("pointerup", at(100, y + 2));
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
    pointer("pointerdown", at(100, y));
    pointer("pointermove", at(100, 24 + 6 * 20 + 5));
    pointer("pointerup", at(100, 24 + 6 * 20 + 5));
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([6]);
    expect(lines("row").find((b) => b.after === 6)!.manual).toBe(true);
  });

  it("drags a break between columns", () => {
    const s = mount(5, 8, (x) => x.setPageSetup("Sheet1", { colBreaks: [2] }));
    choose("View", "Page break preview");
    pointer("pointerdown", at(48 + 2 * 64, 60));
    pointer("pointermove", at(48 + 4 * 64 + 10, 60));
    pointer("pointerup", at(48 + 4 * 64 + 10, 60));
    expect(s.pageSetup("Sheet1").colBreaks).toEqual([4]);
  });

  it("drags the edges of the print area", () => {
    const s = mount(12, 3, (x) => x.setPageSetup("Sheet1", { printArea: ["A1:C12"] }));
    choose("View", "Page break preview");
    pointer("pointerdown", at(100, 24 + 12 * 20));
    pointer("pointerup", at(100, 24 + 10 * 20 + 4));
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:C10"]);
    pointer("pointerdown", at(48 + 3 * 64, 80));
    pointer("pointerup", at(48 + 2 * 64 + 4, 80));
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:B10"]);
    pointer("pointerdown", at(100, 26));
    pointer("pointerup", at(100, 24 + 2 * 20 + 3));
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A3:B10"]);
    act(() => void s.undo());
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:B10"]);
  });

  it("refuses to drag an edge past the other", () => {
    const s = mount(12, 3, (x) => x.setPageSetup("Sheet1", { printArea: ["A1:C12"] }));
    choose("View", "Page break preview");
    // The top edge dragged below the bottom one is no range: it says so and nothing changes.
    pointer("pointerdown", at(100, 26));
    pointer("pointermove", at(100, 24 + 14 * 20 + 3));
    pointer("pointerup", at(100, 24 + 14 * 20 + 3));
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:C12"]);
    expect(host.textContent).toContain("at least one cell");
  });

  it("has Insert page break, Remove page break and Reset all page breaks in its right-click menu", () => {
    const s = mount(12, 3);
    choose("View", "Page break preview");
    const menu = (x: number, y: number) => act(() => void draw().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })));
    const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === label)!;
    menu(48 + 64 + 10, 24 + 5 * 20 + 10); // B6
    act(() => void item("Insert page break").click());
    expect(s.pageSetup("Sheet1")).toMatchObject({ rowBreaks: [5], colBreaks: [1] });
    menu(48 + 64 + 10, 24 + 5 * 20 + 10);
    act(() => void item("Remove page break").click());
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
    s.setPageBreak("Sheet1", "row", 3);
    s.setPageBreak("Sheet1", "row", 9);
    menu(48 + 10, 24 + 10);
    expect(item("Remove page break").disabled).toBe(true);
    act(() => void item("Reset all page breaks").click());
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
  });

  it("right-clicking a break line selects the cell after it", () => {
    const s = mount(12, 3, (x) => x.setPageSetup("Sheet1", { rowBreaks: [5] }));
    choose("View", "Page break preview");
    act(() => void draw().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 48 + 64 + 10, clientY: 24 + 5 * 20 })));
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Remove page break")!;
    expect(remove.disabled).toBe(false);
    act(() => void remove.click());
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
  });
});
