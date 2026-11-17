// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createFonts, fontsourceNpm, type FontEnv, type FontFaceSpec, type FontRegistry } from "@pli.dev/core";
import { DocumentSession, createDoc, paragraph, text } from "@pli.dev/docs";
import { FontPicker, FontsProvider, PliEditor } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function fakeFonts() {
  const registered: FontFaceSpec[] = [];
  const loads: string[] = [];
  const env: FontEnv = { canLoad: true, register: (s) => void registered.push(s), load: async (font) => (loads.push(font), true), isInstalled: () => true };
  const fonts = createFonts({ env, storage: null, source: fontsourceNpm({ base: "/f" }) });
  return { fonts, registered, loads };
}

const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent!.replace(/^✓/, ""));
const search = () => document.querySelector<HTMLInputElement>('input[aria-label="Search fonts"]')!;
const button = (label = "Font") => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

function mount(fonts: FontRegistry, props: Partial<React.ComponentProps<typeof FontPicker>> = {}) {
  const onChange = vi.fn();
  act(() => root.render(<FontPicker fonts={fonts} value="Georgia" onChange={onChange} {...props} />));
  return onChange;
}

describe("FontPicker", () => {
  it("shows the current font in itself and opens a searchable list", () => {
    const { fonts } = fakeFonts();
    mount(fonts);
    const name = host.querySelector<HTMLElement>(".pli-font-name")!;
    expect(name.textContent).toBe("Georgia");
    expect(name.style.fontFamily).toContain("Georgia");
    click(button());
    expect(search()).toBeTruthy();
    expect(options().length).toBeGreaterThan(5);
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain("Georgia");
  });

  it("filters by name and by kind of font, and says when nothing matches", () => {
    const { fonts } = fakeFonts();
    mount(fonts);
    click(button());
    type(search(), "lora");
    expect(options()[0]).toMatch(/^Lora/);
    expect(options().every((o) => /lora/i.test(o))).toBe(true);
    type(search(), "");
    click([...document.querySelectorAll<HTMLButtonElement>(".pli-fonts-kind")].find((b) => b.textContent === "Mono")!);
    expect(options().length).toBeGreaterThan(3);
    expect(options().every((o) => o.endsWith("mono"))).toBe(true);
    type(search(), "zzzzqq");
    expect(document.querySelector(".pli-fonts-empty")?.textContent).toMatch(/No font matches/);
  });

  it("picks a font, remembers it as recent and starts loading it", async () => {
    const { fonts, registered } = fakeFonts();
    const onChange = mount(fonts, { value: undefined });
    click(button());
    type(search(), "Lora");
    await act(async () => void click(document.querySelector('[role="option"]')!));
    expect(onChange).toHaveBeenCalledWith("Lora");
    expect(fonts.recent()[0]).toBe("Lora");
    expect(registered.some((r) => r.family === "Lora")).toBe(true);
    expect(document.querySelector('input[aria-label="Search fonts"]')).toBeNull(); // closed
    click(button());
    expect(document.querySelector(".pli-fonts-header")?.textContent).toBe("Recent");
  });

  it("works with the keyboard: type, arrow down, Enter", () => {
    const { fonts } = fakeFonts();
    const onChange = mount(fonts, { value: undefined, defaultLabel: "Default" });
    click(button());
    type(search(), "roboto");
    const key = (k: string) => act(() => void search().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
    key("ArrowDown");
    const [, second] = options();
    key("Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe(second!.replace(/(sans|serif|mono|display|script)$/, ""));
  });

  it("offers a Default entry that clears the font, and shows Mixed", () => {
    const { fonts } = fakeFonts();
    const onChange = mount(fonts, { value: undefined, defaultLabel: "Default" });
    expect(host.querySelector(".pli-font-name")!.textContent).toBe("Default");
    click(button());
    click(document.querySelector('[role="option"]')!);
    expect(onChange).toHaveBeenCalledWith(null);
    act(() => root.render(<FontPicker fonts={fonts} value="Lora" mixed onChange={onChange} />));
    expect(host.querySelector(".pli-font-name")!.textContent).toBe("Mixed");
  });

  it("only draws the rows in view, and fetches previews for them once scrolling stops", async () => {
    vi.useFakeTimers();
    try {
      const { fonts, registered } = fakeFonts();
      mount(fonts);
      click(button());
      expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(40);
      expect(registered.length).toBe(0); // nothing fetched yet
      await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
      // System fonts need no files; the Google rows in view do (the list starts with the Office fonts, so scroll to Google).
      type(search(), "Open Sans");
      await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
      expect(registered.some((r) => r.family === "Open Sans")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restricts the list to the fonts a host allows", () => {
    const { fonts } = fakeFonts();
    const few = createFonts({ env: { canLoad: false, register() {}, load: async () => false, isInstalled: () => true }, storage: null, only: ["Lora", "Arial"] });
    mount(few);
    click(button());
    expect(options().map((o) => o.replace(/(sans|serif|mono|display|script)$/, ""))).toEqual(["Arial", "Lora"].sort(() => 0).length ? expect.arrayContaining(["Lora", "Arial"]) : []);
    expect(options().length).toBe(2);
    void fonts;
  });

  it("uses the provider's registry when none is given", () => {
    const { fonts } = fakeFonts();
    act(() => root.render(<FontsProvider fonts={fonts}><FontPicker value="Lora" onChange={() => undefined} /></FontsProvider>));
    expect(host.querySelector(".pli-font-name")!.getAttribute("data-status")).toBe("idle");
  });
});

describe("PliEditor and fonts", () => {
  it("loads the fonts the document names, so its text is drawn in them", async () => {
    const { fonts, registered } = fakeFonts();
    const session = new DocumentSession(createDoc("T", [paragraph([text("Hello", { fontFamily: "Lora" }), text(" world", { fontFamily: "Open Sans" })])]));
    await act(async () => {
      root.render(<PliEditor session={session} fonts={fonts} />);
    });
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    const families = new Set(registered.map((r) => r.family));
    expect(families.has("Lora")).toBe(true);
    expect(families.has("Open Sans")).toBe(true);
    expect(host.innerHTML).toContain("font-family: Lora, serif");
  });
});
