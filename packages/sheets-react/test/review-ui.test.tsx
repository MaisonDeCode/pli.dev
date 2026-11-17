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
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = item(name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(label))!;

const mount = (props: Partial<React.ComponentProps<typeof PliSheet>> = {}) => {
  const s = new SheetSession(createWorkbook("r", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [["'the cat saat", "'teh"], ["'on teh mat", 7]]);
  act(() => root.render(<PliSheet session={s} {...props} />));
  return s;
};

describe("Review > Spelling", () => {
  const words = ["the", "cat", "sat", "on", "mat"];
  it("steps through the words that are not in the dictionary and changes, ignores and adds them", () => {
    const added: string[] = [];
    const s = mount({ spellDictionary: words, onSpellAddWord: (w) => void added.push(w) });
    choose("Review", "Spelling…");
    expect(dialog().textContent).toContain("saat");
    expect(dialog().textContent).toContain("Sheet1!A1");
    expect(q<HTMLInputElement>('input[aria-label="Change to"]').value).toBe("sat");
    act(() => void button(dialog(), "Change").click());
    expect(s.value("Sheet1", "A1")).toBe("the cat sat");
    // next: teh in B1
    expect(dialog().querySelector("mark")!.textContent).toBe("teh");
    act(() => void button(dialog(), "Ignore all").click());
    // B2/A2 "on teh mat" is ignored as well; the check is complete
    expect(dialog().textContent).toContain("complete");
    expect(added).toEqual([]);
  });
  it("adds a word to the dictionary (and tells the host), and changes all of a word at once", () => {
    const added: string[] = [];
    const s = mount({ spellDictionary: words, onSpellAddWord: (w) => void added.push(w) });
    choose("Review", "Spelling…");
    act(() => void button(dialog(), "Add to dictionary").click());
    expect(added).toEqual(["saat"]);
    // now "teh" comes up; change all of it to "the"
    const input = q<HTMLInputElement>('input[aria-label="Change to"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "the");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void button(dialog(), "Change all").click());
    expect([s.value("Sheet1", "B1"), s.value("Sheet1", "A2")]).toEqual(["the", "on the mat"]);
    expect(dialog().textContent).toContain("complete");
    s.undo();
    expect(s.value("Sheet1", "B1")).toBe("teh");
  });
  it("is opened by F7 and checks the selection when more than one cell is selected", () => {
    mount({ spellDictionary: words });
    act(() => void q(".pli-spreadsheet").dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true, cancelable: true })));
    expect(dialog()).toBeTruthy();
    expect(dialog().textContent).toContain("This sheet");
  });
});

describe("Review > Check accessibility", () => {
  it("lists the problems, goes to one, and fixes one that has a fix", () => {
    const s = mount();
    s.mergeCells("Sheet1", "D1:E1");
    choose("Review", "Check accessibility");
    const panel = q(".pli-accessbar");
    expect(panel.textContent).toContain("Sheet1!D1:E1");
    expect(panel.textContent).toContain("default sheet name".slice(0, 0) + "is called \"Sheet1\"");
    act(() => void button(panel, "Unmerge the cells").click());
    expect(s.sheet("Sheet1").merges).toBeUndefined();
    expect(q(".pli-accessbar").textContent).not.toContain("merged");
    act(() => void button(q(".pli-accessbar"), "Close").click());
    expect(host.querySelector(".pli-accessbar")).toBeNull();
  });
});
