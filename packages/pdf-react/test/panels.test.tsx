// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { PliPdf, getPageSelection } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { byLabel, click, flush, host, key, previousPage, q, qa, render, scrollTo, useHost } from "./harness";

useHost();

const viewport = { width: 800, height: 600 };
const thumbs = () => qa(".pli-pdf-thumb");
const current = () => thumbs().filter((t) => t.getAttribute("aria-current") === "page").map((t) => Number(t.dataset.index));
const selected = () => thumbs().filter((t) => t.getAttribute("aria-selected") === "true").map((t) => Number(t.dataset.index));

async function mount(n: number, extra: Record<string, unknown> = {}, sessionOptions: Parameters<typeof testSession>[0] = {}) {
  const session = testSession({ pages: n, ...sessionOptions });
  const renderer = fakeRenderer({ pages: n, outline: (extra.fileOutline as never) ?? [] });
  await render(<PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} {...extra} />);
  await flush();
  return { session, renderer };
}

describe("thumbnails", () => {
  it("is a listbox of pages with the current one marked", async () => {
    await mount(6);
    const list = q("[role=listbox]");
    expect(list.getAttribute("aria-label")).toBe("Pages");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(thumbs().map((t) => t.querySelector(".pli-pdf-thumb-label")!.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(current()).toEqual([0]);
    expect(thumbs()[0]!.getAttribute("aria-label")).toBe("Page 1");
    expect(selected()).toEqual([0]);
  });

  it("goes to a page when clicked, and follows the page shown", async () => {
    const { session } = await mount(8);
    await click(thumbs()[5]);
    expect(session.selection.page).toBe("p:main:5");
    expect(current()).toEqual([5]);
    expect(q(".pli-pdf-scroller").scrollTop).toBeGreaterThan(5000);
    await previousPage();
    expect(current()).toEqual([4]);
  });

  it("draws only the thumbnails near the list's view, and caches the small pictures it drew", async () => {
    const { renderer } = await mount(300);
    await flush(8);
    expect(thumbs().length).toBeLessThan(40);
    expect(thumbs().length).toBeGreaterThan(3);
    const small = (page: number) => renderer.stats.renders.filter((r) => r.page === page && r.scale < 0.3 && r.done).length;
    expect(small(0)).toBe(1);
    expect(thumbs()[0]!.querySelector("canvas")).toBeTruthy();
    const list = q(".pli-pdf-thumbs");
    await scrollTo(list, 100 * 230);
    await flush(8);
    expect(thumbs().every((t) => Number(t.dataset.index) > 60)).toBe(true);
    await scrollTo(list, 0);
    await flush(8);
    expect(thumbs()[0]!.dataset.index).toBe("0");
    expect(thumbs()[0]!.querySelector("canvas")).toBeTruthy();
    expect(small(0)).toBe(1); // came from the cache
  });

  it("selects several pages with ctrl/cmd and shift, and tells the host", async () => {
    const calls: string[][] = [];
    const { session } = await mount(8, { onPagesSelected: (ids: string[]) => calls.push(ids) });
    expect(calls.at(-1)).toEqual(["p:main:0"]);
    await click(thumbs()[2], { ctrlKey: true });
    expect(selected()).toEqual([0, 2]);
    expect(getPageSelection(session)).toEqual(["p:main:0", "p:main:2"]);
    await click(thumbs()[4], { metaKey: true });
    expect(selected()).toEqual([0, 2, 4]);
    await click(thumbs()[2], { ctrlKey: true });
    expect(selected()).toEqual([0, 4]);
    await click(thumbs()[1]);
    await click(thumbs()[4], { shiftKey: true });
    expect(selected()).toEqual([1, 2, 3, 4]);
    expect(calls.at(-1)).toEqual(["p:main:1", "p:main:2", "p:main:3", "p:main:4"]);
    // a plain click goes back to one page
    await click(thumbs()[6]);
    expect(selected()).toEqual([6]);
    expect(calls.at(-1)).toEqual(["p:main:6"]);
  });

  it("moves and selects with the keyboard", async () => {
    const { session } = await mount(8);
    const list = q("[role=listbox]");
    await key(list, "ArrowDown");
    expect(current()).toEqual([1]);
    await key(list, "ArrowDown", { shiftKey: true });
    expect(selected()).toEqual([1, 2]);
    expect(session.selection.page).toBe("p:main:2");
    await key(list, "End");
    expect(current()).toEqual([7]);
    await key(list, "Home");
    expect(current()).toEqual([0]);
    await key(list, "a", { ctrlKey: true });
    expect(getPageSelection(session)).toEqual(Array.from({ length: 8 }, (_, i) => `p:main:${i}`));
    expect(list.getAttribute("aria-activedescendant")).toBe("pli-pdf-thumb-p:main:0");
  });

  it("shows blank pages and turned pages", async () => {
    await mount(3, {}, { pages: [{}, { rotate: 90, width: 612, height: 792 }, {}], blank: 1 });
    const items = thumbs();
    expect(items.length).toBe(4);
    expect(items[3]!.getAttribute("aria-label")).toBe("Page 4, blank");
    expect(items[3]!.querySelector(".pli-pdf-thumb-blank")!.textContent).toBe("Blank");
    const page = (i: number) => items[i]!.querySelector<HTMLElement>(".pli-pdf-thumb-page")!;
    expect(page(1).dataset.rotation).toBe("90");
    expect(parseFloat(page(1).style.width)).toBeLessThanOrEqual(120);
    expect(parseFloat(page(1).style.height)).toBeLessThan(parseFloat(page(0).style.height));
  });

  it("follows pages that are removed, moved or rotated in the session", async () => {
    const { session } = await mount(5);
    await act(async () => session.pages.remove(["p:main:1"]));
    await flush();
    expect(thumbs().length).toBe(4);
    await act(async () => session.pages.rotate(["p:main:3"], 90));
    await flush();
    expect(thumbs()[2]!.querySelector<HTMLElement>(".pli-pdf-thumb-page")!.dataset.rotation).toBe("90");
    // the main view turns too
    expect(q(".pli-pdf-page[data-page-id='p:main:3']", q(".pli-pdf-scroller")).dataset.rotation).toBe("90");
  });
});

const outline = [
  { id: "o1", title: "Chapter 1", dest: { page: "p:main:0" }, children: [{ id: "o2", title: "Section 1.1", dest: { page: "p:main:3", y: 100 }, children: [] }] },
  { id: "o3", title: "Chapter 2", dest: { page: "p:main:6" }, open: true, children: [{ id: "o4", title: "Section 2.1", children: [] }] },
];
const tree = () => qa("[role=treeitem]").map((e) => e.textContent);
const openOutline = () => click(q("#pli-pdf-tab-outline"));

describe("outline", () => {
  it("says so when there is none", async () => {
    await mount(3, { readOnly: true });
    await openOutline();
    expect(q(".pli-pdf-empty").textContent).toBe("No outline");
  });

  it("shows the document's outline as a tree that folds", async () => {
    await mount(8, {}, { outline });
    await openOutline();
    expect(q("[role=tree]").getAttribute("aria-label")).toBe("Outline");
    expect(tree()).toEqual(["Chapter 1", "Chapter 2", "Section 2.1"]);
    await click(byLabel("Expand Chapter 1", host));
    expect(tree()).toEqual(["Chapter 1", "Section 1.1", "Chapter 2", "Section 2.1"]);
    expect(qa("[role=treeitem]")[1]!.getAttribute("aria-level")).toBe("2");
    expect(qa("[role=treeitem]")[0]!.getAttribute("aria-expanded")).toBe("true");
    await click(byLabel("Collapse Chapter 2", host));
    expect(tree()).toEqual(["Chapter 1", "Section 1.1", "Chapter 2"]);
  });

  it("goes to the page and the height of an entry when clicked", async () => {
    const { session } = await mount(8, {}, { outline });
    await openOutline();
    await click(qa("[role=treeitem]")[1]); // Chapter 2
    expect(session.selection.page).toBe("p:main:6");
    expect(q(".pli-pdf-scroller").scrollTop).toBeGreaterThan(6000);
    await click(byLabel("Expand Chapter 1", host));
    await click(qa("[role=treeitem]")[1]); // Section 1.1, 100 points down page 4
    expect(session.selection.page).toBe("p:main:3");
    const top = q(".pli-pdf-page[data-page-id='p:main:3']", q(".pli-pdf-scroller")).style.top;
    expect(q(".pli-pdf-scroller").scrollTop).toBeCloseTo(parseFloat(top) + 100 * (96 / 72) - 40, 0);
  });

  it("is walked with the keyboard", async () => {
    const { session } = await mount(8, {}, { outline });
    await openOutline();
    const tree = q("[role=tree]");
    const items = () => qa<HTMLElement>("[role=treeitem]");
    await act(async () => items()[0]!.focus());
    await key(tree, "ArrowRight"); // opens Chapter 1
    expect(items().map((e) => e.textContent)).toEqual(["Chapter 1", "Section 1.1", "Chapter 2", "Section 2.1"]);
    await key(tree, "ArrowRight"); // into it
    expect(document.activeElement!.textContent).toBe("Section 1.1");
    await key(tree, "Enter");
    expect(session.selection.page).toBe("p:main:3");
    await key(tree, "ArrowLeft"); // back to the parent
    expect(document.activeElement!.textContent).toBe("Chapter 1");
    await key(tree, "ArrowLeft"); // fold
    expect(items().map((e) => e.textContent)).toEqual(["Chapter 1", "Chapter 2", "Section 2.1"]);
    await key(tree, "End");
    expect(document.activeElement!.textContent).toBe("Section 2.1");
    await key(tree, "ArrowDown");
    expect(document.activeElement!.textContent).toBe("Section 2.1");
    await key(tree, "Home");
    expect(document.activeElement!.textContent).toBe("Chapter 1");
  });

  it("can show the outline the renderer reads from a file the engine did not read", async () => {
    const { session } = await mount(5, { fallbackOutline: true, fileOutline: [{ title: "From the file", page: 2, children: [] }] });
    await openOutline();
    await flush();
    expect(tree()).toEqual(["From the file"]);
    await click(qa("[role=treeitem]")[0]);
    expect(session.selection.page).toBe("p:main:2");
  });
});
