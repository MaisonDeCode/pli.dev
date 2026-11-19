// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { DownloadProvider } from "@pli.dev/react";
import { PliSheet, stepDecimals, type ChipKind } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // jsdom has no layout: give the grid a size to draw into.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom can't draw; text is measured by length instead
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// Where cells are: row headers are 48 wide and column headers 24 tall; columns 64 wide and rows 20 tall.
const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });

function mount(options: { readOnly?: boolean; cells?: Record<string, string | number>; onDownload?: (f: { name: string; type: string; data: Uint8Array }) => void; chips?: Record<string, ChipKind> } = {}) {
  const session = new SheetSession(createWorkbook("t"), { now: () => 45000 });
  if (options.cells) session.setCells("Sheet1", options.cells);
  act(() => root.render(<PliSheet session={session} readOnly={options.readOnly} onDownload={options.onDownload} chips={options.chips} />));
  return session;
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const nameBox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;
const texts = () => [...host.querySelectorAll(".pli-cell-text")].map((e) => e.textContent);

function pointer(type: string, xy: { clientX: number; clientY: number }, extra: MouseEventInit = {}) {
  act(() => {
    q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy, ...extra }));
  });
}
const click = (row: number, col: number, extra: MouseEventInit = {}) => {
  pointer("pointerdown", cellXY(row, col), extra);
  pointer("pointerup", cellXY(row, col), extra);
};

function key(k: string, init: KeyboardEventInit = {}) {
  act(() => {
    sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

function type(text: string) {
  act(() => {
    const el = sink();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the grid", () => {
  it("draws headers and the cells' text as they show", () => {
    mount({ cells: { A1: "Hello", B1: 1234.5, C1: "=B1*2" } });
    expect([...host.querySelectorAll(".pli-grid-colhead")].slice(0, 3).map((e) => e.textContent)).toEqual(["A", "B", "C"]);
    expect(texts()).toEqual(["Hello", "1234.5", "2469"]);
    expect(q(".pli-cell-text:nth-of-type(1)")).toBeTruthy();
  });

  it("selects by clicking, moves with arrows and extends with shift", () => {
    mount();
    click(3, 3);
    expect(nameBox()).toBe("C3");
    key("ArrowDown");
    key("ArrowRight");
    expect(nameBox()).toBe("D4");
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    expect(nameBox()).toBe("D4:E5");
    click(2, 2, { shiftKey: true });
    expect(nameBox()).toBe("B2:D4");
    key("ArrowUp", { ctrlKey: true });
    expect(nameBox()).toBe("D1");
  });

  it("clicking a header selects the whole column or row", () => {
    mount();
    pointer("pointerdown", { clientX: 48 + 64 + 5, clientY: 10 });
    pointer("pointerup", { clientX: 48 + 64 + 5, clientY: 10 });
    expect(nameBox()).toBe("B:B");
    pointer("pointerdown", { clientX: 20, clientY: 24 + 20 * 4 + 5 });
    pointer("pointerup", { clientX: 20, clientY: 24 + 20 * 4 + 5 });
    expect(nameBox()).toBe("5:5");
  });

  it("typing starts an entry; Enter commits it and moves down; Escape cancels", () => {
    const s = mount();
    click(1, 1);
    type("42");
    expect(q(".pli-grid-sink").hasAttribute("data-editing")).toBe(true);
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("42");
    key("Enter");
    expect(s.value("Sheet1", "A1")).toBe(42);
    expect(nameBox()).toBe("A2");
    type("=A1*2");
    key("Tab");
    expect(s.cell("Sheet1", "A2")?.f).toBe("A1*2");
    expect(nameBox()).toBe("B2");
    type("oops");
    key("Escape");
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(sink().hasAttribute("data-editing")).toBe(false);
  });

  it("F2 and a double click edit what is there, formulas as formulas", () => {
    const s = mount({ cells: { A1: "=1+2" } });
    click(1, 1);
    key("F2");
    expect(sink().value).toBe("=1+2");
    key("Escape");
    pointer("dblclick", cellXY(1, 1));
    expect(sink().value).toBe("=1+2");
    type("=2+2");
    key("Enter");
    expect(s.value("Sheet1", "A1")).toBe(4);
  });

  it("an arrow key finishes an entry, but inside a formula it doesn't", () => {
    const s = mount();
    click(2, 2);
    type("7");
    key("ArrowRight");
    expect(s.value("Sheet1", "B2")).toBe(7);
    expect(nameBox()).toBe("C2");
  });

  it("clicking a cell while typing a formula puts its address in", () => {
    const s = mount({ cells: { B3: 5 } });
    click(1, 1);
    type("=B3+");
    sink().setSelectionRange(4, 4);
    click(2, 1); // A2: the formula points there instead of finishing
    expect(sink().value).toBe("=B3+A2");
    key("Enter");
    expect(s.cell("Sheet1", "A1")?.f).toBe("B3+A2");
  });

  it("the formula bar edits the active cell", () => {
    const s = mount({ cells: { A1: 3 } });
    click(1, 1);
    const bar = q<HTMLInputElement>(".pli-sheet-bar");
    act(() => bar.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(bar, "=A1*10");
      bar.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(s.cell("Sheet1", "A1")?.f).toBe("A1*10"); // a circular formula, but the entry is what it is
  });

  it("the name box goes to a range", () => {
    mount();
    const box = q<HTMLInputElement>(".pli-sheet-namebox");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "B2:C5");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(nameBox()).toBe("B2:C5");
  });

  it("Delete clears the selection's contents and keeps its format", () => {
    const s = mount({ cells: { A1: 1, A2: 2 } });
    act(() => s.setFormat("Sheet1", "A1:A2", "0.00"));
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    key("Delete");
    expect(s.cell("Sheet1", "A1")).toEqual({ fmt: "0.00" });
    expect(s.cell("Sheet1", "A2")).toEqual({ fmt: "0.00" });
  });

  it("copy puts text and an HTML table on the clipboard; paste reads them back, shifting formulas", () => {
    const s = mount({ cells: { A1: 1, A2: "=A1+1" } });
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    const dt = new Map<string, string>();
    const data = { setData: (t: string, v: string) => void dt.set(t, v), getData: (t: string) => dt.get(t) ?? "" };
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: data });
    act(() => void sink().dispatchEvent(copy));
    expect(dt.get("text/plain")).toBe("1\n2");
    expect(dt.get("text/html")).toContain("<table>");
    click(1, 3);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: data });
    act(() => void sink().dispatchEvent(paste));
    expect(s.cell("Sheet1", "C2")?.f).toBe("C1+1");
    expect(nameBox()).toBe("C1:C2");
  });

  it("pastes text from elsewhere as typed values", () => {
    const s = mount();
    click(2, 2);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "a\tb\n1\t=B2" } });
    act(() => void sink().dispatchEvent(paste));
    expect(s.values("Sheet1", "B2:C3")).toEqual([["a", "b"], [1, "a"]]); // =B2 pasted into C3 reads the pasted "a"
  });

  it("undo and redo with the keyboard", () => {
    const s = mount();
    click(1, 1);
    type("5");
    key("Enter");
    key("z", { ctrlKey: true });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    key("z", { ctrlKey: true, shiftKey: true });
    expect(s.value("Sheet1", "A1")).toBe(5);
  });

  it("read only: typing and Delete do nothing, but selecting works", () => {
    const s = mount({ readOnly: true, cells: { A1: 1 } });
    click(1, 1);
    type("9");
    key("Delete");
    expect(s.value("Sheet1", "A1")).toBe(1);
    expect(sink().hasAttribute("data-editing")).toBe(false);
    click(2, 2);
    expect(nameBox()).toBe("B2");
  });
});

describe("the toolbar and tabs", () => {
  it("Bold styles the selection and shows as pressed", () => {
    const s = mount({ cells: { A1: 1, B1: 2 } });
    click(1, 1);
    key("ArrowRight", { shiftKey: true });
    act(() => void q<HTMLButtonElement>('button[aria-label="Bold"]').click());
    expect(s.cell("Sheet1", "A1")?.s?.bold).toBe(true);
    expect(s.cell("Sheet1", "B1")?.s?.bold).toBe(true);
    expect(q('button[aria-label="Bold"]').getAttribute("aria-pressed")).toBe("true");
    key("b", { ctrlKey: true });
    expect(s.cell("Sheet1", "A1")?.s).toBeUndefined();
  });

  it("number formats change how a cell shows", () => {
    const s = mount({ cells: { A1: 0.256 } });
    click(1, 1);
    act(() => void q<HTMLButtonElement>('button[aria-label="Format as percent"]').click());
    expect(texts()).toEqual(["26%"]);
    act(() => void q<HTMLButtonElement>('button[aria-label="Increase decimal places"]').click());
    expect(s.cell("Sheet1", "A1")?.fmt).toBe("0.0%");
    expect(texts()).toEqual(["25.6%"]);
  });

  it("stepDecimals adds and removes decimals, keeping the rest of the format", () => {
    expect(stepDecimals(undefined, 1)).toBe("0.0");
    expect(stepDecimals("0.00", -1)).toBe("0.0");
    expect(stepDecimals("0.0", -1)).toBe("0");
    expect(stepDecimals("$#,##0.00", 1)).toBe("$#,##0.000");
    expect(stepDecimals("0.00%", -2)).toBe("0%");
    expect(stepDecimals("yyyy-mm-dd", 1)).toBe("0.0");
    expect(stepDecimals("#,##0.00;(#,##0.00)", -1)).toBe("#,##0.0;(#,##0.0)");
  });

  it("adds a sheet and switches between them", () => {
    const s = mount({ cells: { A1: "first" } });
    act(() => void q<HTMLButtonElement>('button[aria-label="Add sheet"]').click());
    expect(s.state.sheets.map((x) => x.name)).toEqual(["Sheet1", "Sheet2"]);
    expect(texts()).toEqual([]);
    act(() => void host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name")[0]!.click());
    expect(texts()).toEqual(["first"]);
  });

  it("totals the selection in the status bar", () => {
    mount({ cells: { A1: 1, A2: 2, A3: 4 } });
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(q(".pli-sheet-stats").textContent).toBe("Sum: 7Average: 2.333333Count: 3");
  });
});

describe("several ranges", () => {
  it("Ctrl+click adds a range, and the toolbar acts on all of them in one undo step", () => {
    const s = mount({ cells: { A1: 1, C3: 3, E5: 5 } });
    click(1, 1);
    click(3, 3, { ctrlKey: true });
    click(5, 5, { ctrlKey: true });
    expect(nameBox()).toBe("E5");
    expect(host.querySelectorAll(".pli-grid-range")).toHaveLength(3);
    act(() => void q<HTMLButtonElement>('button[aria-label="Bold"]').click());
    expect([s.cell("Sheet1", "A1")?.s?.bold, s.cell("Sheet1", "C3")?.s?.bold, s.cell("Sheet1", "E5")?.s?.bold]).toEqual([true, true, true]);
    key("Delete");
    expect([s.cell("Sheet1", "A1")?.v, s.cell("Sheet1", "C3")?.v, s.cell("Sheet1", "E5")?.v]).toEqual([undefined, undefined, undefined]);
    act(() => void s.undo());
    expect(s.cell("Sheet1", "C3")?.v).toBe(3); // the clear was one step
    expect(q(".pli-sheet-stats").textContent).toContain("Count: 3");
    key("ArrowDown");
    expect(host.querySelectorAll(".pli-grid-range")).toHaveLength(1);
  });

  it("copies ranges that line up, and not ones that don't", () => {
    mount({ cells: { A1: "a", A2: "b", C1: "c", C2: "d", E4: "e" } });
    const copyText = () => {
      const dt = new Map<string, string>();
      const copy = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(copy, "clipboardData", { value: { setData: (k: string, v: string) => void dt.set(k, v), getData: (k: string) => dt.get(k) ?? "" } });
      act(() => void sink().dispatchEvent(copy));
      return dt.get("text/plain");
    };
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    pointer("pointerdown", cellXY(1, 3), { ctrlKey: true });
    pointer("pointermove", cellXY(2, 3), { ctrlKey: true });
    pointer("pointerup", cellXY(2, 3), { ctrlKey: true });
    expect(nameBox()).toBe("C1:C2");
    expect(copyText()).toBe("a\tc\nb\td");
    click(4, 5, { ctrlKey: true });
    expect(copyText()).toBeUndefined();
  });
});

describe("moving cells by dragging", () => {
  it("dragging the selection's edge moves it, and formulas that pointed at it follow", () => {
    const s = mount({ cells: { C3: 5, A1: "=C3*2" } });
    click(3, 3);
    const edge = { clientX: 48 + 128 + 1, clientY: 24 + 40 + 10 };
    pointer("pointerdown", edge);
    pointer("pointermove", { clientX: edge.clientX + 64, clientY: edge.clientY + 20 });
    expect(q(".pli-grid-fill-preview[data-move]")).toBeTruthy();
    pointer("pointerup", { clientX: edge.clientX + 64, clientY: edge.clientY + 20 });
    expect(s.cell("Sheet1", "C3")).toBeUndefined();
    expect(s.cell("Sheet1", "D4")).toEqual({ v: 5 });
    expect(s.cell("Sheet1", "A1")?.f).toBe("D4*2");
    expect(nameBox()).toBe("D4");
  });

  it("with Ctrl it copies instead", () => {
    const s = mount({ cells: { C3: 5 } });
    click(3, 3);
    const edge = { clientX: 48 + 128 + 1, clientY: 24 + 40 + 10 };
    pointer("pointerdown", edge, { ctrlKey: true });
    pointer("pointermove", { clientX: edge.clientX + 64, clientY: edge.clientY }, { ctrlKey: true });
    pointer("pointerup", { clientX: edge.clientX + 64, clientY: edge.clientY }, { ctrlKey: true });
    expect(s.cell("Sheet1", "C3")).toEqual({ v: 5 });
    expect(s.cell("Sheet1", "D3")).toEqual({ v: 5 });
  });

  it("cut and paste moves cells too", () => {
    const s = mount({ cells: { A1: 1, B1: "=A1+1" } });
    click(1, 1);
    const dt = new Map<string, string>();
    const data = { setData: (k: string, v: string) => void dt.set(k, v), getData: (k: string) => dt.get(k) ?? "" };
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(cut, "clipboardData", { value: data });
    act(() => void sink().dispatchEvent(cut));
    click(4, 4);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: data });
    act(() => void sink().dispatchEvent(paste));
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.cell("Sheet1", "D4")).toEqual({ v: 1 });
    expect(s.cell("Sheet1", "B1")?.f).toBe("D4+1");
  });
});

describe("the right-click menu", () => {
  it("opens on a right click, selects the cell under it, and acts", () => {
    const s = mount({ cells: { A1: "x", A2: "y", A3: "z" } });
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 48 + 10, clientY: 24 + 20 + 10 })));
    expect(nameBox()).toBe("A2");
    const items = () => [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-menu .pli-menu-item")];
    expect(items().map((b) => b.querySelector(".pli-menu-label")!.textContent)).toEqual(expect.arrayContaining(["Cut", "Copy", "Paste", "Insert row above", "Delete row", "Clear contents", "Create filter"]));
    act(() => void items().find((b) => b.querySelector(".pli-menu-label")!.textContent === "Delete row")!.click());
    expect(s.values("Sheet1", "A1:A3")).toEqual([["x"], ["z"], [null]]);
    expect(document.querySelector(".pli-grid-menu")).toBeNull();
  });
});

describe("wrapped text", () => {
  it("makes the row tall enough, unless the row has a height of its own", () => {
    const s = mount();
    act(() => {
      s.setCell("Sheet1", "A1", "word ".repeat(30).trim());
      s.setStyle("Sheet1", "A1", { wrap: true });
    });
    const heightOf = (row: number) => parseFloat([...host.querySelectorAll<HTMLElement>(".pli-grid-colhead")].length ? q(`.pli-grid-rowhead:nth-child(${row})`).style.height : "0");
    expect(heightOf(1)).toBeGreaterThan(40);
    expect(heightOf(2)).toBe(20);
    act(() => s.setRowHeight("Sheet1", 1, 15));
    expect(heightOf(1)).toBe(20);
  });
});

describe("typing a formula", () => {
  it("draws the references in colour, in the text and on the sheet", () => {
    mount({ cells: { B2: 1, C3: 2 } });
    click(1, 1);
    type("=B2+C3+B2");
    const spans = [...host.querySelectorAll<HTMLElement>(".pli-grid-mirror span")];
    expect(spans.map((e) => e.textContent)).toEqual(["B2", "C3", "B2"]);
    expect(spans[0]!.style.color).toBe(spans[2]!.style.color);
    expect(spans[0]!.style.color).not.toBe(spans[1]!.style.color);
    expect(host.querySelectorAll(".pli-grid-ref")).toHaveLength(3);
    key("Escape");
    expect(host.querySelectorAll(".pli-grid-ref")).toHaveLength(0);
  });

  it("dragging across cells puts a range in", () => {
    const s = mount({ cells: { A2: 1, A3: 2, A4: 3 } });
    click(1, 2);
    type("=SUM(");
    sink().setSelectionRange(5, 5);
    pointer("pointerdown", cellXY(2, 1));
    pointer("pointermove", cellXY(4, 1));
    expect(sink().value).toBe("=SUM(A2:A4");
    pointer("pointerup", cellXY(4, 1));
    type("=SUM(A2:A4)");
    key("Enter");
    expect(s.value("Sheet1", "B1")).toBe(6);
  });
});

describe("filters", () => {
  const table = { A1: "Name", B1: "Dept", A2: "Ann", B2: "Ops", A3: "Bo", B3: "Dev", A4: "Cy", B4: "Ops" };

  it("creates one from the Data menu, shows buttons, and the menu hides rows", () => {
    const s = mount({ cells: table });
    click(2, 1);
    act(() => void q<HTMLButtonElement>('button[aria-label="Sort and freeze"]').click());
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Create filter")!.click());
    expect(s.state.sheets[0]!.filter).toEqual({ range: "A1:B4" });
    expect(host.querySelectorAll(".pli-grid-filterbtn")).toHaveLength(2);
    // The button in B1 is at the right of the cell.
    const btn = { clientX: 48 + 128 - 8, clientY: 24 + 20 - 8 };
    pointer("pointerdown", btn);
    pointer("pointerup", btn);
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".pli-grid-filterlist input")];
    expect(boxes).toHaveLength(2); // Dev and Ops
    act(() => void boxes[0]!.click()); // untick Dev
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filteractions button")].find((b) => b.textContent === "OK")!.click());
    expect(s.state.sheets[0]!.filter?.columns).toEqual({ B: ["Ops"] });
    expect(s.state.sheets[0]!.rows?.["3"]?.hidden).toBe(true);
    expect(texts()).not.toContain("Bo");
    expect(host.querySelector(".pli-grid-filterbtn[data-on]")).toBeTruthy();
  });
});

describe("the title and the menu bar", () => {
  const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
  const labels = () => [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent);
  const choose = (...path: string[]) => {
    act(() => void menuButton(path[0]!).click());
    for (const name of path.slice(1)) {
      const item = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
      if (!item) throw new Error(`No menu item "${name}" in ${labels().join(", ")}`);
      act(() => void item.click());
    }
  };

  it("has an editable title that is the workbook's name, and isn't an undo step", () => {
    const s = mount({ cells: { A1: 1 } });
    const title = q<HTMLInputElement>(".pli-doc-title");
    expect(title.value).toBe("t");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Q3 budget");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(s.state.title).toBe("Q3 budget");
    click(2, 2);
    type("5");
    key("Enter");
    act(() => void s.undo());
    expect(s.cell("Sheet1", "B2")).toBeUndefined(); // the cell edit was undone, not the name
    expect(s.state.title).toBe("Q3 budget");
  });

  it("lists File, Edit, View, Insert, Format, Data and Review", () => {
    mount();
    expect([...host.querySelectorAll(".pli-menubar-button")].map((b) => b.textContent)).toEqual(["File", "Edit", "View", "Insert", "Format", "Data", "Review"]);
    choose("Format");
    expect(labels()).toEqual(expect.arrayContaining(["Number", "Text", "Align", "Wrap text", "Clear formatting"]));
  });

  it("File > Download hands the file to onDownload, named after the title", () => {
    const files: { name: string; data: Uint8Array }[] = [];
    mount({ cells: { A1: "x", B1: 2 }, onDownload: (f) => files.push(f) });
    choose("File", "Download", "Excel workbook (.xlsx)");
    choose("File", "Download", "This sheet as CSV (.csv)");
    choose("File", "Download", "Pli spreadsheet (.json)");
    expect(files.map((f) => f.name)).toEqual(["t.xlsx", "t.csv", "t.pli-sheet.json"]);
    expect(String.fromCharCode(files[0]!.data[0]!, files[0]!.data[1]!)).toBe("PK");
    expect(new TextDecoder().decode(files[1]!.data)).toBe("x,2\n");
    expect(new TextDecoder().decode(files[2]!.data)).toContain('"format": "pli.sheet"');
  });

  it("File > Download uses the DownloadProvider's function, and the sheet's own onDownload wins", () => {
    const fromProvider: string[] = [];
    const own: string[] = [];
    const session = new SheetSession(createWorkbook("t"), { now: () => 45000 });
    act(() =>
      root.render(
        <DownloadProvider onDownload={(f) => void fromProvider.push(f.name)}>
          <PliSheet session={session} />
        </DownloadProvider>,
      ),
    );
    choose("File", "Download", "Excel workbook (.xlsx)");
    expect(fromProvider).toEqual(["t.xlsx"]);
    act(() =>
      root.render(
        <DownloadProvider onDownload={(f) => void fromProvider.push(f.name)}>
          <PliSheet session={session} onDownload={(f) => void own.push(f.name)} />
        </DownloadProvider>,
      ),
    );
    choose("File", "Download", "This sheet as CSV (.csv)");
    expect(own).toEqual(["t.csv"]);
    expect(fromProvider).toEqual(["t.xlsx"]);
  });

  it("menuLabels renames and removes menus and items, and the renamed item still does its job", () => {
    const files: string[] = [];
    const session = new SheetSession(createWorkbook("t"), { now: () => 45000 });
    act(() => root.render(<PliSheet session={session} onDownload={(f) => void files.push(f.name)} menuLabels={{ File: "Workbook", Review: false, Download: "Export" }} />));
    const bar = () => [...host.querySelectorAll(".pli-menubar-button")].map((b) => b.textContent);
    expect(bar()).toEqual(["Workbook", "Edit", "View", "Insert", "Format", "Data"]);
    choose("Workbook", "Export", "This sheet as CSV (.csv)");
    expect(files).toEqual(["t.csv"]);
  });

  it("tells the person when the download function fails, with its reason", async () => {
    mount({ onDownload: () => Promise.reject(new Error("the drive is full")) as never });
    choose("File", "Download", "This sheet as CSV (.csv)");
    await act(async () => {});
    expect(host.textContent).toContain("The file couldn't be saved: the drive is full");
  });

  it("Edit > Undo and Redo work, and Insert > Function starts a formula with the caret inside", async () => {
    const s = mount();
    click(1, 1);
    type("3");
    key("Enter");
    choose("Edit", "Undo");
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    choose("Edit", "Redo");
    expect(s.value("Sheet1", "A1")).toBe(3);
    click(2, 1);
    choose("Insert", "Function", "SUM");
    await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(0)))));
    expect(sink().value).toBe("=SUM()");
    expect(sink().selectionStart).toBe(5);
  });

  it("Insert and Data menus change the sheet", () => {
    const s = mount({ cells: { A1: "n", A2: "b", A3: "a" } });
    click(2, 1);
    choose("Insert", "Row above");
    expect(s.values("Sheet1", "A1:A4")).toEqual([["n"], [null], ["b"], ["a"]]);
    choose("Insert", "Sheet");
    expect(s.state.sheets).toHaveLength(2);
    act(() => void host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name")[0]!.click());
    click(3, 1);
    choose("Data", "Create filter");
    expect(s.state.sheets[0]!.filter?.range).toBe("A3:A4"); // the block of data around the cell: the inserted row splits it
  });

  it("View toggles the toolbar and the formula bar; Format applies styles", () => {
    const s = mount({ cells: { A1: 1 } });
    click(1, 1);
    choose("View", "Toolbar");
    expect(host.querySelector(".pli-sheet-toolbar")).toBeNull();
    choose("View", "Toolbar");
    expect(host.querySelector(".pli-sheet-toolbar")).toBeTruthy();
    choose("View", "Formula bar");
    expect(host.querySelector(".pli-sheet-formulabar")).toBeNull();
    choose("View", "Freeze", "1 row");
    expect(s.state.sheets[0]!.frozen).toEqual({ rows: 1, cols: 0 });
    choose("Format", "Text", "Bold");
    expect(s.cell("Sheet1", "A1")?.s?.bold).toBe(true);
    choose("Format", "Number", "Percent  10.12%");
    expect(s.cell("Sheet1", "A1")?.fmt).toBe("0.00%");
  });

  it("a sheet tab can be renamed by double click, and a clash is refused with a message", () => {
    const s = mount();
    act(() => void q<HTMLButtonElement>('button[aria-label="Add sheet"]').click());
    const tab = () => host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name");
    act(() => void tab()[1]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = q<HTMLInputElement>(".pli-sheet-rename");
    const setName = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setName("sheet1");
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(s.state.sheets[1]!.name).toBe("Sheet2");
    expect(q<HTMLInputElement>(".pli-sheet-rename").getAttribute("aria-invalid")).toBe("true");
    setName("Totals");
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(s.state.sheets[1]!.name).toBe("Totals");
  });

  it("File > Import reads a CSV into the workbook", async () => {
    const s = mount();
    const input = q<HTMLInputElement>('input[aria-label="Import a spreadsheet"]');
    const file = new File(["a,b\n1,2\n"], "data.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(s.values("Sheet1", "A1:B2")).toEqual([["a", "b"], [1, 2]]);
    expect(s.state.title).toBe("data");
  });
});

describe("help while typing a formula", () => {
  const items = () => [...host.querySelectorAll(".pli-assist-item .pli-assist-name")].map((e) => e.textContent);
  const selected = () => host.querySelector('.pli-assist-item[aria-selected="true"] .pli-assist-name')?.textContent;
  const card = () => host.querySelector(".pli-assist-card")?.textContent ?? "";

  it("lists the functions that match what is typed, and says what the highlighted one does", () => {
    mount();
    click(1, 1);
    type("=");
    expect(items().slice(0, 3)).toEqual(["SUM", "AVERAGE", "IF"]);
    type("=vl");
    expect(items()).toEqual(["VLOOKUP"]);
    expect(card()).toContain("VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])");
    expect(card()).toContain("Looks for a value in the first column of a table");
    expect(card()).toContain("lookup_value");
    expect(card()).toContain("=VLOOKUP(A1,D:F,3,FALSE)");
    type("=xyz");
    expect(host.querySelector(".pli-assist")).toBeNull();
  });

  it("arrow keys move through the list and Enter or Tab put the function in, with its bracket", () => {
    const s = mount();
    click(1, 1);
    type("=su");
    expect(selected()).toBe("SUBSTITUTE");
    key("ArrowDown");
    key("ArrowDown");
    expect(selected()).toBe("SUM");
    key("Enter");
    expect(sink().value).toBe("=SUM(");
    expect(s.cell("Sheet1", "A1")).toBeUndefined(); // Enter picked; it didn't finish the entry
    expect(sink().hasAttribute("data-editing")).toBe(true);
    key("ArrowUp"); // nothing is being completed now: the key reaches the editor
    type("=SUM(1,2)");
    key("Enter");
    expect(s.value("Sheet1", "A1")).toBe(3);
  });

  it("Escape closes the list first, and then cancels the entry", () => {
    mount();
    click(1, 1);
    type("=ave");
    expect(host.querySelector(".pli-assist")).toBeTruthy();
    key("Escape");
    expect(host.querySelector(".pli-assist-list")).toBeNull();
    expect(sink().hasAttribute("data-editing")).toBe(true);
    key("Escape");
    expect(sink().hasAttribute("data-editing")).toBe(false);
  });

  it("inside a call it shows the function's syntax with the current argument marked", () => {
    mount();
    click(1, 1);
    type("=IF(A1>1,");
    const current = host.querySelector(".pli-assist-current");
    expect(current?.textContent).toBe("value_if_true");
    expect(host.querySelector(".pli-assist-summary")?.textContent).toContain("What to give when it is true");
    type("=IF(A1>1,2,3)");
    expect(host.querySelector(".pli-assist")).toBeNull();
  });

  it("clicking a function in the list picks it", () => {
    mount();
    click(1, 1);
    type("=cou");
    const target = [...host.querySelectorAll<HTMLElement>(".pli-assist-item")].find((e) => e.querySelector(".pli-assist-name")!.textContent === "COUNTIF")!;
    act(() => void target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(sink().value).toBe("=COUNTIF(");
  });

  it("works from the formula bar too", () => {
    mount();
    click(1, 1);
    const bar = q<HTMLInputElement>(".pli-sheet-bar");
    act(() => bar.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(bar, "=rou");
      bar.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".pli-sheet-bar-assist .pli-assist-list")).toBeTruthy();
    act(() => void bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(bar.value).toBe("=ROUND(");
  });
});

describe("checkboxes, dropdowns and badges", () => {
  const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
  const choose = (...path: string[]) => {
    act(() => void menuButton(path[0]!).click());
    for (const name of path.slice(1)) {
      const item = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
      if (!item) throw new Error(`No menu item "${name}"`);
      act(() => void item.click());
    }
  };
  const setField = (el: HTMLInputElement, v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("Insert > Checkbox makes boxes that tick on a click and with Space", () => {
    const s = mount();
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    choose("Insert", "Checkbox");
    expect(host.querySelectorAll(".pli-cell-checkbox")).toHaveLength(2);
    expect(s.values("Sheet1", "A1:A2")).toEqual([[false], [false]]);
    // The box is at the middle of the cell: its click ticks it.
    const mid = { clientX: 48 + 32, clientY: 24 + 10 };
    pointer("pointerdown", mid);
    pointer("pointerup", mid);
    expect(s.value("Sheet1", "A1")).toBe(true);
    expect(host.querySelector(".pli-cell-checkbox[data-on]")).toBeTruthy();
    expect(nameBox()).toBe("A1");
    key(" ");
    expect(s.value("Sheet1", "A1")).toBe(false);
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    key(" ");
    expect(s.values("Sheet1", "A1:A2")).toEqual([[true], [true]]);
    // A click beside the box only selects.
    pointer("pointerdown", { clientX: 48 + 4, clientY: 24 + 10 });
    pointer("pointerup", { clientX: 48 + 4, clientY: 24 + 10 });
    expect(s.value("Sheet1", "A1")).toBe(true);
  });

  it("typing in a checkbox is refused, and a formula can read it", () => {
    const s = mount();
    click(1, 1);
    choose("Insert", "Checkbox");
    type("hello");
    expect(sink().hasAttribute("data-editing")).toBe(false);
    expect(host.querySelector(".pli-notice")?.textContent).toContain("clicking it or pressing Space");
    s.setCell("Sheet1", "B1", "=IF(A1,\"yes\",\"no\")");
    expect(s.value("Sheet1", "B1")).toBe("no");
  });

  it("Insert > Dropdown… sets up choices with colours; the cell shows a badge and the button opens the list", () => {
    const s = mount();
    click(2, 2);
    choose("Insert", "Dropdown…");
    const rows = [...document.querySelectorAll<HTMLInputElement>('.pli-dropdown-row input[type="text"]')];
    expect(rows.map((r) => r.value)).toEqual(["Option 1", "Option 2"]);
    setField(rows[0]!, "Todo");
    setField(rows[1]!, "Done");
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-dropdown-rows ~ button")].find((b) => b.textContent === "Add a choice")!.click());
    setField([...document.querySelectorAll<HTMLInputElement>('.pli-dropdown-row input[type="text"]')][2]!, "Blocked");
    act(() => void document.querySelectorAll<HTMLInputElement>(".pli-dropdown-options input")[1]!.click()); // strict
    act(() => void document.querySelector<HTMLFormElement>(".pli-dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const control = s.cell("Sheet1", "B2")?.control;
    expect(control).toMatchObject({ type: "dropdown", strict: true });
    expect(control?.type === "dropdown" && control.options.map((o) => o.value)).toEqual(["Todo", "Done", "Blocked"]);
    // The arrow button of the active cell opens the list.
    const edge = { clientX: 48 + 64 + 64 - 8, clientY: 24 + 20 + 10 };
    pointer("pointerdown", edge);
    const items = [...document.querySelectorAll<HTMLButtonElement>(".pli-choice-item")];
    expect(items.map((b) => b.textContent!.replace("✓", ""))).toEqual(["Todo", "Done", "Blocked"]);
    act(() => void items[1]!.click());
    expect(s.value("Sheet1", "B2")).toBe("Done");
    expect(document.querySelector(".pli-grid-choicemenu")).toBeNull();
    const pill = host.querySelector<HTMLElement>(".pli-pill")!;
    expect(pill.textContent).toBe("Done");
    expect(pill.style.background).not.toBe("");
    // Typing something that isn't a choice is refused with a reason.
    type("Maybe");
    key("Enter");
    expect(host.querySelector(".pli-notice")?.textContent).toContain("isn't one of the choices");
    key("Escape");
  });

  it("badges of an app's own kind show what the id means, and the picker searches", async () => {
    const people: Record<string, { name: string; photo: string }> = { u1: { name: "Ann Lee", photo: "ann.png" }, u2: { name: "Bo Chan", photo: "bo.png" } };
    const chips: Record<string, ChipKind> = {
      person: {
        label: "Person",
        resolve: (id) => (people[id] ? { value: id, label: people[id]!.name, image: people[id]!.photo, color: "#bfdbfe" } : undefined),
        search: (q) => Object.entries(people).filter(([, p]) => p.name.toLowerCase().includes(q.toLowerCase())).map(([id, p]) => ({ value: id, label: p.name, image: p.photo, description: `${id}@example.com` })),
      },
    };
    const s = mount({ chips });
    click(1, 1);
    choose("Insert", "Badge", "Person");
    expect(s.cell("Sheet1", "A1")?.control).toEqual({ type: "badge", kind: "person" });
    await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(0)))));
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect([...document.querySelectorAll(".pli-choice-item")].map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Ann Lee"), expect.stringContaining("Bo Chan")]));
    const search = document.querySelector<HTMLInputElement>(".pli-choice-search")!;
    setField(search, "bo");
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(document.querySelectorAll(".pli-choice-item")).toHaveLength(1);
    act(() => void document.querySelector<HTMLButtonElement>(".pli-choice-item")!.click());
    expect(s.value("Sheet1", "A1")).toBe("u2"); // the cell keeps the id
    const pill = host.querySelector(".pli-pill")!;
    expect(pill.textContent).toBe("Bo Chan"); // and shows the name
    expect(pill.querySelector("img")?.getAttribute("src")).toBe("bo.png");
  });

  it("a kind can draw its own badge", () => {
    const chips: Record<string, ChipKind> = { tag: { label: "Tag", resolve: (v) => ({ value: v, label: v }), render: (item) => <b className="mine">#{item.label}</b> } };
    const s = mount({ chips });
    act(() => {
      s.setControl("Sheet1", "A1", { type: "badge", kind: "tag" });
      s.setCell("Sheet1", "A1", "urgent");
    });
    expect(host.querySelector(".pli-pill-custom .mine")?.textContent).toBe("#urgent");
  });

  it("the Insert menu removes a control, and a plain label badge keeps typed text", () => {
    const s = mount();
    click(1, 1);
    choose("Insert", "Badge", "Label");
    type("New");
    key("Enter");
    expect(host.querySelector(".pli-pill")?.textContent).toBe("New");
    click(1, 1);
    choose("Insert", "Remove badge");
    expect(s.cell("Sheet1", "A1")).toEqual({ v: "New" });
    expect(host.querySelector(".pli-pill")).toBeNull();
  });
});

describe("typing a formula across sheets", () => {
  const tab = (i: number) => host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name")[i]!;

  it("stays open when another sheet is shown, takes cells clicked there, and ends on the first sheet", () => {
    const s = mount({ cells: { A1: "total" } });
    act(() => void q<HTMLButtonElement>('button[aria-label="Add sheet"]').click());
    act(() => {
      s.setCells("Sheet2", { B2: 5, B3: 6 });
    });
    act(() => void tab(0).click());
    click(2, 1); // Sheet1!A2
    type("=SUM(");
    act(() => void tab(1).click());
    expect(host.querySelector('[role="tab"][data-active] .pli-sheet-tab-name')?.textContent).toBe("Sheet2");
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=SUM("); // still being typed, shown in the formula bar
    expect(sink().hasAttribute("data-editing")).toBe(false); // the editor belongs to the other sheet
    expect(host.querySelector(".pli-assist")).toBeTruthy(); // and the help carries on
    // Clicking a cell here puts it in the formula, named with its sheet; dragging makes a range.
    pointer("pointerdown", cellXY(2, 2));
    pointer("pointermove", cellXY(3, 2));
    pointer("pointerup", cellXY(3, 2));
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=SUM(Sheet2!B2:B3");
    expect(host.querySelectorAll(".pli-grid-ref")).toHaveLength(1); // outlined on this sheet
    key("Enter");
    // The missing bracket is added, the formula lands on the sheet it was started on, and that sheet comes back.
    expect(s.cell("Sheet1", "A2")?.f).toBe("SUM(Sheet2!B2:B3)");
    expect(s.value("Sheet1", "A2")).toBe(11);
    expect(host.querySelector('[role="tab"][data-active] .pli-sheet-tab-name')?.textContent).toBe("Sheet1");
    expect(nameBox()).toBe("A3");
  });

  it("Escape cancels it and comes back; a sheet named with spaces is quoted; plain text is entered when switching", () => {
    const s = mount();
    act(() => void q<HTMLButtonElement>('button[aria-label="Add sheet"]').click());
    act(() => void s.renameSheet("Sheet2", "My data"));
    act(() => void tab(0).click());
    click(1, 1);
    type("=");
    act(() => void tab(1).click());
    pointer("pointerdown", cellXY(4, 3));
    pointer("pointerup", cellXY(4, 3));
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("='My data'!C4");
    key("Escape"); // closes the list of functions
    key("Escape"); // cancels
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(host.querySelector('[role="tab"][data-active] .pli-sheet-tab-name')?.textContent).toBe("Sheet1");
    type("plain");
    act(() => void tab(1).click());
    expect(s.value("Sheet1", "A1")).toBe("plain");
  });

  it("clicking a cell where no reference can go ends the entry and selects that cell", () => {
    const s = mount();
    act(() => void q<HTMLButtonElement>('button[aria-label="Add sheet"]').click());
    act(() => void tab(0).click());
    click(1, 1);
    type("=1+1");
    act(() => void tab(1).click());
    click(3, 3);
    expect(s.value("Sheet1", "A1")).toBe(2);
    expect(nameBox()).toBe("C3");
  });
});

describe("spilled results", () => {
  it("shows the cells a formula fills, and outlines them while its cell is selected", () => {
    const s = mount({ cells: { A1: 3, A2: 1, A3: 2 } });
    act(() => void s.setCell("Sheet1", "C1", "=SORT(A1:A3)"));
    expect(texts()).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(texts().filter((t) => t === "3" || t === "2" || t === "1").length).toBe(6); // A1:A3 and C1:C3
    expect(host.querySelector(".pli-grid-spill")).toBeNull();
    click(1, 3);
    const box = q(".pli-grid-spill");
    expect(box.style.height).toBe("60px"); // three rows
    key("ArrowDown"); // a filled cell isn't the formula's: no outline
    expect(host.querySelector(".pli-grid-spill")).toBeNull();
    act(() => void s.setCell("Sheet1", "C2", "in the way"));
    expect(texts()).toContain("#SPILL!");
  });
});
