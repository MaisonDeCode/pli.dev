// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Bar } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const bar = () => host.querySelector<HTMLElement>(".pli-toolbar")!;

/** jsdom lays nothing out: say how wide the bar and its content are, and where each button sits. */
function layout(el: HTMLElement, o: { client: number; scroll: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: o.client });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: o.scroll });
  el.getBoundingClientRect = () => ({ left: 0, right: o.client, width: o.client, top: 0, bottom: 30, height: 30, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}
const scrolled = (el: HTMLElement, left: number) =>
  act(async () => {
    el.scrollLeft = left;
    el.dispatchEvent(new Event("scroll"));
  });
function place(button: HTMLElement, left: number, width = 30) {
  button.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 30, height: 30, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
}

const Buttons = () => (
  <Bar aria-label="Tools">
    <button type="button" aria-label="One">1</button>
    <button type="button" aria-label="Two" aria-pressed="false">2</button>
    <button type="button" aria-label="Three" disabled>3</button>
    <input aria-label="Size" />
    <button type="button" aria-label="Four">4</button>
  </Bar>
);

describe("Bar", () => {
  it("is a toolbar with the shared class, the label and the classes it is given", async () => {
    await render(<Bar aria-label="Tools" className="mine">x</Bar>);
    expect(bar().getAttribute("role")).toBe("toolbar");
    expect(bar().className).toBe("pli-toolbar mine");
    expect(bar().getAttribute("aria-label")).toBe("Tools");
  });

  it("says which sides have more to scroll to (data-overflow), for the fading ends", async () => {
    await render(<Buttons />);
    expect(bar().getAttribute("data-overflow")).toBe("none");
    layout(bar(), { client: 200, scroll: 500 });
    await scrolled(bar(), 0);
    expect(bar().getAttribute("data-overflow")).toBe("end");
    await scrolled(bar(), 100);
    expect(bar().getAttribute("data-overflow")).toBe("both");
    await scrolled(bar(), 300);
    expect(bar().getAttribute("data-overflow")).toBe("start");
    layout(bar(), { client: 500, scroll: 500 });
    await scrolled(bar(), 0);
    expect(bar().getAttribute("data-overflow")).toBe("none");
  });

  it("turns the mouse wheel into a sideways scroll while the bar has more, and leaves the page's scrolling alone when it has not", async () => {
    await render(<Buttons />);
    const wheel = (init: WheelEventInit) => {
      const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      bar().dispatchEvent(e);
      return e;
    };
    layout(bar(), { client: 200, scroll: 500 });
    bar().scrollLeft = 0;
    const down = wheel({ deltaY: 60 });
    expect(bar().scrollLeft).toBe(60);
    expect(down.defaultPrevented).toBe(true);
    expect(wheel({ deltaY: 60, ctrlKey: true }).defaultPrevented).toBe(false); // a pinch zooms, it does not scroll the bar
    expect(wheel({ deltaX: 40, deltaY: 5 }).defaultPrevented).toBe(false); // a sideways swipe scrolls natively
    layout(bar(), { client: 500, scroll: 500 });
    expect(wheel({ deltaY: 60 }).defaultPrevented).toBe(false);
  });

  it("moves between the buttons with Left, Right, Home and End, skipping what is off and text boxes, and keeps the keys to itself", async () => {
    let heard = 0;
    await render(
      <div onKeyDown={() => heard++}>
        <Buttons />
      </div>,
    );
    const label = (el: Element | null) => el?.getAttribute("aria-label");
    const buttons = [...bar().querySelectorAll<HTMLElement>("button")];
    const press = async (key: string, init: KeyboardEventInit = {}) => {
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
      });
    };
    buttons[0]!.focus();
    await press("ArrowRight");
    expect(label(document.activeElement)).toBe("Two");
    await press("ArrowRight"); // Three is off, the size box is a text box: on to Four
    expect(label(document.activeElement)).toBe("Four");
    await press("ArrowRight"); // the end: stays
    expect(label(document.activeElement)).toBe("Four");
    await press("ArrowLeft");
    expect(label(document.activeElement)).toBe("Two");
    await press("End");
    expect(label(document.activeElement)).toBe("Four");
    await press("Home");
    expect(label(document.activeElement)).toBe("One");
    expect(heard).toBe(1); // a move is kept from the host; only the Right at the end, which moved nothing, got through
  });

  it("leaves the arrow keys alone in a text box, and with a modifier held", async () => {
    let heard = 0;
    await render(
      <div onKeyDown={() => heard++}>
        <Buttons />
      </div>,
    );
    const input = bar().querySelector<HTMLInputElement>("input")!;
    input.focus();
    await act(async () => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(input);
    expect(heard).toBe(1);
    const first = bar().querySelector<HTMLElement>("button")!;
    first.focus();
    await act(async () => void first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
  });

  it("scrolls a button that was just turned on into view, and does not move a bar that has nowhere to go", async () => {
    await render(<Buttons />);
    const two = bar().querySelector<HTMLElement>('[aria-label="Two"]')!;
    layout(bar(), { client: 200, scroll: 500 });
    place(two, 320); // off to the right
    bar().scrollLeft = 0;
    await act(async () => two.setAttribute("aria-pressed", "true"));
    await act(async () => void (await Promise.resolve()));
    expect(bar().scrollLeft).toBeGreaterThan(0);
    // the same button, with the bar wide enough for all of it: nothing moves
    layout(bar(), { client: 500, scroll: 500 });
    bar().scrollLeft = 0;
    await act(async () => two.setAttribute("aria-pressed", "false"));
    await act(async () => two.setAttribute("aria-pressed", "true"));
    expect(bar().scrollLeft).toBe(0);
  });
});
