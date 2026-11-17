// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
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
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
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
const dialogButton = (text: string | RegExp) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
/** The row numbers drawn in the row headings: hidden rows have none. */
const shownRows = () => [...host.querySelectorAll(".pli-grid-rowhead")].map((e) => Number(e.textContent)).filter((n) => n <= 6);
const bar = () => host.querySelector<HTMLElement>(".pli-viewbar");
const barButton = (text: string) => [...bar()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const menuLabels = () => [...document.querySelectorAll(".pli-menu-item .pli-menu-label")].map((e) => e.textContent);

function mount() {
  const s = new SheetSession(createWorkbook("t"));
  s.setValues("Sheet1", "A1", [["Name", "Team", "Amount"], ["Ann", "red", 30], ["Bo", "blue", 10], ["Cy", "red", 20], ["Di", "blue", 40], ["Ed", "green", 5]]);
  s.setFilter("Sheet1", "A1:C6");
  act(() => root.render(<PliSheet session={s} />));
  return s;
}
const hiddenRows = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r));

describe("filter views in the grid", () => {
  it("Data > Filter views saves the filter in force under a name, and the menu lists it", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    choose("Data", "Filter views", "Save current filter as a view…");
    expect(dialog().querySelector("h2, [role=heading]")?.textContent ?? dialog().textContent).toContain("Filter views");
    setField(dialog().querySelector<HTMLInputElement>("input[type=text]")!, "Reds");
    act(() => void dialogButton("Save current filter").click());
    expect(s.filterViews("Sheet1").map((v) => [v.name, v.columns])).toEqual([["Reds", { B: ["red"] }]]);
    act(() => void dialogButton("Close").click());
    // saving shows it, for this person
    expect(bar()!.textContent).toContain("Reds");
    act(() => void menuButton("Data").click());
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.includes("Filter views"))!.click());
    expect(menuLabels()).toEqual(expect.arrayContaining(["No view (the sheet's own filter)", "Reds", "Save current filter as a view…", "Manage views…"]));
  });

  it("showing a view hides rows here and changes nothing in the workbook; closing it brings the sheet back", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    s.saveFilterView("Sheet1", "Reds");
    act(() => s.filterColumn("Sheet1", 2, ["blue"]));
    s.saveFilterView("Sheet1", "Blues");
    act(() => s.filterColumn("Sheet1", 2, null));
    expect(shownRows()).toEqual([1, 2, 3, 4, 5, 6]);
    const before = JSON.stringify(s.state);
    choose("Data", "Filter views", "Reds");
    expect(shownRows()).toEqual([1, 2, 4]); // Ann and Cy
    expect(bar()!.textContent).toContain("only you see it");
    expect(JSON.stringify(s.state)).toBe(before); // nobody else's view of the sheet moved
    expect(hiddenRows(s)).toEqual([]);
    choose("Data", "Filter views", "Blues");
    expect(shownRows()).toEqual([1, 3, 5]);
    act(() => void barButton("Close view").click());
    expect(bar()).toBeNull();
    expect(shownRows()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("while a view shows, rows the sheet's own filter hides come back if the view lets them through", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["blue"]));
    s.saveFilterView("Sheet1", "Blues");
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    expect(shownRows()).toEqual([1, 2, 4]);
    choose("Data", "Filter views", "Blues");
    expect(shownRows()).toEqual([1, 3, 5]);
    // and the view follows edits to the data
    act(() => s.setCell("Sheet1", "B2", "blue"));
    expect(shownRows()).toEqual([1, 2, 3, 5]);
  });

  it("Apply for everyone makes the view the sheet's filter, and Undo takes it back", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    s.saveFilterView("Sheet1", "Reds");
    act(() => s.filterColumn("Sheet1", 2, null));
    choose("Data", "Filter views", "Reds");
    act(() => void barButton("Apply for everyone").click());
    expect(bar()).toBeNull();
    expect(s.sheet("Sheet1").filter!.columns).toEqual({ B: ["red"] });
    expect(hiddenRows(s)).toEqual([3, 5, 6]);
    act(() => void s.undo());
    expect(hiddenRows(s)).toEqual([]);
    expect(s.sheet("Sheet1").filter!.columns).toBeUndefined();
  });

  it("the dialog renames, updates, applies and deletes views, and says why it refuses", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    s.saveFilterView("Sheet1", "Reds");
    s.saveFilterView("Sheet1", "Copy");
    choose("Data", "Filter views", "Manage views…");
    const names = () => [...dialog().querySelectorAll<HTMLInputElement>(".pli-views-row input")].map((i) => i.value);
    expect(names()).toEqual(["Reds", "Copy"]);
    // rename
    const first = dialog().querySelector<HTMLInputElement>(".pli-views-row input")!;
    act(() => void first.focus());
    setField(first, "Red team");
    act(() => void first.blur());
    expect(s.filterViews("Sheet1")[0]!.name).toBe("Red team");
    // a repeated name is refused and the old one comes back
    const second = dialog().querySelectorAll<HTMLInputElement>(".pli-views-row input")[1]!;
    act(() => void second.focus());
    setField(second, "red team");
    act(() => void second.blur());
    expect(dialog().querySelector("[role=alert]")!.textContent).toMatch(/already a view/);
    expect(names()).toEqual(["Red team", "Copy"]);
    // update from the current filter
    act(() => s.filterColumn("Sheet1", 2, ["green"]));
    act(() => void dialogButton("Update").click());
    expect(s.filterViews("Sheet1")[0]!.columns).toEqual({ B: ["green"] });
    // show
    act(() => void dialog().querySelectorAll<HTMLButtonElement>(".pli-views-row button")[0]!.click());
    expect(dialogButton("Showing")).toBeTruthy();
    // delete the one showing: the view closes
    act(() => void dialog().querySelector<HTMLButtonElement>('button[aria-label="Delete Red team"]')!.click());
    expect(s.filterViews("Sheet1").map((v) => v.name)).toEqual(["Copy"]);
    expect(bar()).toBeNull();
  });

  it("saving with a sort offers the filter's columns, and Apply for everyone sorts", () => {
    const s = mount();
    choose("Data", "Filter views", "Manage views…");
    setField(dialog().querySelector<HTMLInputElement>("input[type=text]")!, "Big first");
    const sort = dialog().querySelector<HTMLSelectElement>("select")!;
    expect([...sort.options].map((o) => o.textContent)).toContain("Amount (C), Z to A");
    setField(sort, "d3");
    act(() => void dialogButton("Save current filter").click());
    expect(s.filterViews("Sheet1")[0]!.sort).toEqual({ column: "C", descending: true });
    act(() => void dialogButton(/Apply for everyone/).click());
    expect([2, 3, 4, 5, 6].map((r) => s.value("Sheet1", `A${r}`))).toEqual(["Di", "Ann", "Cy", "Bo", "Ed"]);
  });

  it("a view's sort is shown without moving the cells, and editing is off while it shows", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    s.saveFilterView("Sheet1", "Reds, biggest first", { sort: { column: 3, descending: true } });
    act(() => s.filterColumn("Sheet1", 2, null));
    const before = JSON.stringify(s.state);
    const names = () => [...host.querySelectorAll<HTMLElement>(".pli-cell")].map((e) => e.textContent).filter((t) => ["Ann", "Bo", "Cy", "Di", "Ed"].includes(t ?? ""));
    expect(names()).toEqual(["Ann", "Bo", "Cy", "Di", "Ed"]);
    choose("Data", "Filter views", "Reds, biggest first");
    expect(bar()!.textContent).toContain("sort is shown, not applied");
    expect(names()).toEqual(["Ann", "Cy"]); // red, largest first (Ann 30, Cy 20): shown in that order, hidden rows come after
    expect(JSON.stringify(s.state)).toBe(before); // the cells did not move
    expect(s.value("Sheet1", "A2")).toBe("Ann");
    act(() => void barButton("Close view").click());
    expect(names()).toEqual(["Ann", "Bo", "Cy", "Di", "Ed"]);
  });

  it("without a filter there is nothing to save, and a read-only sheet can show views but not change them", () => {
    const s = mount();
    act(() => s.filterColumn("Sheet1", 2, ["red"]));
    s.saveFilterView("Sheet1", "Reds");
    act(() => s.setFilter("Sheet1", null));
    choose("Data", "Filter views", "Manage views…");
    expect(dialogButton("Save current filter").disabled).toBe(true);
    act(() => void dialogButton("Close").click());
    act(() => root.render(<PliSheet session={s} readOnly />));
    choose("Data", "Filter views", "Reds");
    expect(shownRows()).toEqual([1, 2, 4]);
    expect(barButton("Apply for everyone").disabled).toBe(true);
  });
});
