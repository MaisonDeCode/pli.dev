// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PRODUCTS } from "../src/demos";
import { Landing } from "../src/Landing";
import { openDemo, resolveRoute, routePath } from "../src/router";
import { App } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("which screen an address opens", () => {
  it("opens the landing page by default", () => {
    expect(resolveRoute({ search: "", hash: "" })).toBeNull();
    expect(resolveRoute({ search: "?room=abc", hash: "#/" })).toBeNull();
    expect(resolveRoute({ search: "", hash: "#/nonsense" })).toBeNull();
  });

  it("opens a screen from the hash, whatever the query holds", () => {
    expect(resolveRoute({ search: "", hash: "#/basics" })).toBe("basics");
    expect(resolveRoute({ search: "?room=abc&guest=1", hash: "#/collaboration" })).toBe("collaboration");
    expect(resolveRoute({ search: "", hash: "#/collaboration?x=1" })).toBe("collaboration");
  });

  it("still opens the screen that links from before the landing page meant", () => {
    expect(resolveRoute({ search: "?mode=collab&room=abc&guest=1", hash: "" })).toBe("collaboration");
    expect(resolveRoute({ search: "?mode=basics", hash: "" })).toBe("basics");
    expect(resolveRoute({ search: "?readonly", hash: "" })).toBe("basics");
  });

  it("writes the hash that resolves back to the same screen", () => {
    for (const demo of PRODUCTS.flatMap((p) => p.demos)) expect(resolveRoute({ search: "", hash: routePath(demo.id) })).toBe(demo.id);
  });
});

describe("the landing page", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    history.replaceState(null, "", "/");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("links to every screen, and lists the editors still to come", () => {
    act(() => root.render(<Landing />));
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".landing-card h3 a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#/basics", "#/collaboration", "#/generate", "#/builder", "#/sheets", "#/decks", "#/pdf", "#/embed"]);
    const soon = host.querySelector(".landing-soon")!.textContent!;
    for (const name of ["Boards", "Forms", "Databases"]) expect(soon).toContain(name);
    expect(soon).not.toContain("Sheets");
    expect(soon).not.toContain("Decks");
    expect(soon).not.toContain("PDF");
  });

  it("opens a screen when its card is clicked, and comes back with the way back link", () => {
    act(() => root.render(<App />));
    expect(host.querySelector("h1")?.textContent).toBe("Pli playground");

    act(() => host.querySelector<HTMLAnchorElement>('a[href="#/collaboration"]')!.click());
    expect(location.hash).toBe("#/collaboration");
    expect(host.querySelector(".landing")).toBeNull();
    expect(document.title).toBe("Collaboration · Pli playground");

    act(() => host.querySelector<HTMLAnchorElement>("a.back-link")!.click());
    expect(location.hash).toBe("");
    expect(host.querySelector("h1")?.textContent).toBe("Pli playground");
  });

  it("drops a screen's query when going back, so an invitation isn't reused by the next visit", () => {
    history.replaceState(null, "", "/?room=abc&guest=1#/collaboration");
    act(() => openDemo(null));
    expect(location.search).toBe("");
  });
});
