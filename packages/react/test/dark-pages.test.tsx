// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSession, createDoc, paragraph, table, text } from "@pli.dev/docs";
import { DocumentView } from "../src/render";
import { StatusBar } from "../src/ui/panels";
import { PliDocument } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = (blocks: Parameters<typeof createDoc>[1]) => renderToStaticMarkup(<DocumentView doc={createDoc("T", blocks)} />);

describe("dark pages: how text is marked", () => {
  it("marks black text so a dark page can show it in the page's text color", () => {
    for (const color of ["#000000", "#000", "#111111", "#333333"]) {
      expect(html([paragraph([text("x", { color })])])).toContain('class="pli-ink"');
    }
  });

  it("leaves other colors alone", () => {
    for (const color of ["#d33", "#ffffff", "#888888", "#1a56db"]) {
      expect(html([paragraph([text("x", { color })])])).not.toContain("pli-ink");
    }
  });

  it("marks highlighted text, so it can stay dark on the highlight", () => {
    expect(html([paragraph([text("x", { highlight: "#ffff00" })])])).toContain('class="pli-highlight"');
  });

  it("keeps highlighted black text as it is: highlight wins over the black-text rule in CSS", () => {
    const out = html([paragraph([text("x", { color: "#000000", highlight: "#ffff00" })])]);
    expect(out).toContain('class="pli-highlight pli-ink"');
  });

  it("marks shaded table cells", () => {
    const grid = table([["a", "b"]]);
    grid.rows[0]!.cells[0]!.shade = "#ffee99";
    const out = html([grid]);
    expect(out.match(/data-shaded/g)).toHaveLength(1);
  });
});

describe("page color", () => {
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

  it("follows the theme unless asked to keep the pages white", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    act(() => root.render(<PliDocument session={session} />));
    expect(host.querySelector(".pli-document")?.hasAttribute("data-paper")).toBe(false);
    act(() => root.render(<PliDocument session={session} paper="light" />));
    expect(host.querySelector(".pli-document")?.getAttribute("data-paper")).toBe("light");
  });
});

describe("status bar", () => {
  it("has a short page label for small screens, and a word count that CSS can hide", () => {
    const doc = createDoc("T", [paragraph("one two three")]);
    const out = renderToStaticMarkup(<StatusBar doc={doc} page={{ current: 2, total: 6 }} zoom={1} onZoom={() => {}} view="pages" onView={() => {}} />);
    expect(out).toContain("Page 2 of 6");
    expect(out).toContain("2 / 6");
    expect(out).toContain("pli-status-words");
    expect(out).toContain("Pageless");
  });
});

describe("menus", () => {
  it("lists each menu item once, so React keys (the labels) are unique", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      act(() => root.render(<PliDocument session={session} />));
      for (const button of host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")) {
        act(() => void button.click());
        const labels = [...host.querySelectorAll(".pli-menu-list > li > button .pli-menu-label")].map((l) => l.textContent);
        expect(new Set(labels).size).toBe(labels.length);
        act(() => void button.click());
      }
    } finally {
      console.error = original;
      act(() => root.unmount());
      host.remove();
    }
    expect(errors.filter((e) => String(e[0]).includes("same key"))).toEqual([]);
  });
});
