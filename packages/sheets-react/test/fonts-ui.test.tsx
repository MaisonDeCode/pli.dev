// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFonts, fontsourceNpm, type FontFaceSpec } from "@pli.dev/core";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("fonts in the sheet", () => {
  it("has a font picker that sets the family of the selected cell, and loads fonts the workbook uses", async () => {
    const registered: FontFaceSpec[] = [];
    const fonts = createFonts({ storage: null, source: fontsourceNpm({ base: "/f" }), env: { canLoad: true, register: (s) => void registered.push(s), load: async () => true, isInstalled: () => true } });
    const session = new SheetSession(createWorkbook("Book"));
    const sheet = session.state.sheets[0]!;
    session.setStyle(sheet.id, "B2", { fontFamily: "Lora" });
    await act(async () => void root.render(<PliSheet session={session} fonts={fonts} />));
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(registered.some((r) => r.family === "Lora")).toBe(true);

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Font"]')!;
    expect(button.textContent).toBe("Calibri"); // the default font of the workbook
    act(() => void button.click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search fonts"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Roboto Mono");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void document.querySelector<HTMLElement>('[role="option"]')!.click());
    expect(session.state.sheets[0]!.cells.A1?.s?.fontFamily).toBe("Roboto Mono");
  });
});
