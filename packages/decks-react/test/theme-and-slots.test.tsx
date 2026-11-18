// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PliDeck } from "../src";
import { click, host, menuItem, newSession, qa, render, useHost } from "./harness";

useHost();

describe("PliDeck: the theme prop", () => {
  it("writes nothing for auto and forces light or dark otherwise", () => {
    render(<PliDeck session={newSession()} />);
    expect(host.querySelector(".pli-deck")!.hasAttribute("data-theme")).toBe(false);
    render(<PliDeck session={newSession()} theme="dark" />);
    expect(host.querySelector(".pli-deck")!.getAttribute("data-theme")).toBe("dark");
    render(<PliDeck session={newSession()} theme="light" />);
    expect(host.querySelector(".pli-deck")!.getAttribute("data-theme")).toBe("light");
  });

  it("carries the theme to dialogs", () => {
    render(<PliDeck session={newSession()} theme="dark" />);
    click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "File"));
    click(menuItem("Page setup…"));
    const dialogs = qa("dialog");
    expect(dialogs.length).toBeGreaterThan(0);
    for (const d of dialogs) expect(d.getAttribute("data-theme")).toBe("dark");
  });
});

describe("PliDeck: slots in the title row", () => {
  it("puts startActions before the title and endActions after the Slideshow button", () => {
    render(<PliDeck session={newSession()} startActions={<button id="back">Back</button>} actions={<button id="mid">Export</button>} endActions={<button id="end">Account</button>} />);
    const bar = host.querySelector(".pli-titlebar")!;
    const order = [...bar.querySelectorAll("#back, .pli-doc-title, #mid, .pli-deck-slideshow, #end")].map((el) => el.id || el.className.split(" ").pop());
    expect(order).toEqual(["back", "pli-doc-title", "mid", "pli-deck-slideshow", "end"]);
  });
});
