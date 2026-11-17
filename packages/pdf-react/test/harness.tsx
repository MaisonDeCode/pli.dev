import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export let host: HTMLElement;
let root: Root;

/** Mounts into a fresh host for each test, and keeps jsdom's missing canvas quiet. */
export function useHost() {
  beforeEach(() => {
    // jsdom has no canvas: say so quietly (the fake renderer and the text measuring cope with null).
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    try {
      localStorage.clear(); // the frame (sidebar width, properties panel) remembers its state there
    } catch {
      // no storage
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });
}

export const render = async (el: ReactElement) => {
  await act(async () => root.render(el));
};
export const unmount = () => act(() => root.unmount());

export const q = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => within.querySelector<T>(sel)!;
export const qa = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => [...within.querySelectorAll<T>(sel)];
export const byLabel = (label: string, within: ParentNode = document) => within.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;

// The helpers that change something are async: the renders they start finish inside `act`, so React sees no stray updates.
export const click = async (el: Element | null | undefined, init: MouseEventInit = {}) => {
  if (!el) throw new Error("click: no element");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
};

/** Dispatches any event inside act. */
export const fire = async (el: EventTarget, event: Event) => {
  await act(async () => {
    el.dispatchEvent(event);
  });
};

export async function key(target: EventTarget, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

export async function setValue(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Opens the properties panel (View > Show properties panel), when it is not open already. */
export async function openProperties() {
  if (!host.querySelector(".pli-pdf-right")) await chooseMenu("View", "Show properties panel");
}

/** Turns the view a quarter turn clockwise, from the View menu. */
export const rotateView = () => chooseMenu("View", "Rotate view clockwise");

/** Runs something that changes the session (so React redraws inside act). */
export const run = async <T,>(fn: () => T): Promise<T> => {
  let out!: T;
  await act(async () => {
    out = fn();
  });
  return out;
};

/** Lets queued renders, text loads and searches finish. */
export async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Scrolls the scroller (jsdom keeps the number; the viewer reads it on the scroll event). */
export async function scrollTo(el: HTMLElement, top: number) {
  await act(async () => {
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  });
}

/** A button of the menu bar (File, Edit, View, Insert, Format, Tools, Help). */
export const menuButton = (label: string) => qa<HTMLElement>(".pli-menubar-button").find((b) => b.textContent === label)!;

/** The text of a menu entry without its tick, its key and the arrow of a submenu. */
const entryText = (b: Element) => b.textContent!.replace("✓", "").replace("›", "").replace(/(Ctrl\+|⌘|⇧).*$/, "").trim();

/** Opens a menu of the menu bar and chooses an entry; `path` ends with the entry, the ones before it are submenus to open first. */
export async function chooseMenu(menu: string, ...path: string[]) {
  await click(menuButton(menu));
  for (const label of path) {
    const all = qa<HTMLElement>("[role=menu] [role^=menuitem]", document);
    const entry = all.find((b) => entryText(b) === label) ?? all.find((b) => b.textContent!.includes(label));
    if (!entry) throw new Error(`chooseMenu: no entry "${label}" in ${menu} (have ${all.map((b) => b.textContent).join(" | ")})`);
    await click(entry);
  }
}

/** Turns Prepare form on or off, from Tools > Prepare form. */
export const togglePrepareForm = () => chooseMenu("Tools", "Prepare form");

/** Saves from File > Save. */
export const saveFile = () => chooseMenu("File", "Save");

/** The element of a menu entry (the menu is opened and left open: close it with `closeMenus`). */
export async function menuEntry(menu: string, label: string): Promise<HTMLElement | undefined> {
  await click(menuButton(menu));
  return qa<HTMLElement>("[role=menu] [role^=menuitem]", document).find((b) => entryText(b) === label);
}

/** Closes any open menu. */
export const closeMenus = () => key(document.body, "Escape");

/** Page navigation from View > Go to. */
export const nextPage = () => chooseMenu("View", "Go to", "Next page");
export const previousPage = () => chooseMenu("View", "Go to", "Previous page");
