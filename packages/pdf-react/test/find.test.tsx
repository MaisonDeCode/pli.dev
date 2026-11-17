// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findInRuns, pageText, searchDocument, type TextRun } from "../src";
import { PliPdf } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { byLabel, chooseMenu, click, flush, host, key, q, qa, render, setValue, useHost } from "./harness";

useHost();

const run = (str: string, x: number, y: number, eol = false): TextRun => ({ str, x, y, w: str.length * 6, h: 12, ...(eol ? { eol } : {}) });

describe("search in a page's text", () => {
  const runs = [run("Café au lait", 10, 20, true), run("The cafe ", 10, 40), run("is closed", 64, 40, true), run("Ca", 10, 60), run("fé", 22, 60, true), run("Thermal cafeteria", 10, 80, true)];

  it("ignores case and accents", () => {
    const hits = findInRuns(runs, "CAFE");
    expect(hits.map((h) => h.text)).toEqual(["Café", "cafe", "Café", "cafe"]);
  });

  it("matches case when asked", () => {
    expect(findInRuns(runs, "cafe", { matchCase: true }).map((h) => h.text)).toEqual(["cafe", "cafe"]);
    // case counts, accents never do
    expect(findInRuns(runs, "Cafe", { matchCase: true }).map((h) => h.text)).toEqual(["Café", "Café"]);
    expect(findInRuns(runs, "CAFE", { matchCase: true })).toHaveLength(0);
  });

  it("matches whole words when asked", () => {
    expect(findInRuns(runs, "cafe", { wholeWord: true }).map((h) => h.text)).toEqual(["Café", "cafe", "Café"]);
    expect(findInRuns(runs, "the", { wholeWord: true })).toHaveLength(1);
    expect(findInRuns(runs, "the")).toHaveLength(2);
  });

  it("finds a phrase that spans two runs on a line, and across a line break", () => {
    const hits = findInRuns(runs, "cafe is closed");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.rects).toEqual([{ x: 10 + 4 * 6, y: 40, w: 54 - 24 + 54, h: 12 }]);
    const wrapped = findInRuns(runs, "au lait the cafe");
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]!.rects).toHaveLength(2); // one rectangle per line
    expect(wrapped[0]!.rects[0]).toMatchObject({ y: 20 });
    expect(wrapped[0]!.rects[1]).toMatchObject({ y: 40 });
  });

  it("finds a word that a renderer split into two runs that touch", () => {
    const hits = findInRuns(runs, "café");
    expect(hits.map((h) => h.text)).toEqual(["Café", "cafe", "Café", "cafe"]);
    expect(hits[2]!.rects).toEqual([{ x: 10, y: 60, w: 24, h: 12 }]);
  });

  it("collapses white space, trims the query and finds nothing for an empty one", () => {
    expect(findInRuns([run("a   b", 0, 0)], "  a b ")).toHaveLength(1);
    expect(findInRuns(runs, "   ")).toEqual([]);
  });

  it("puts a space between runs with a gap, and not between ones that touch", () => {
    expect(pageText([run("ab", 0, 0), run("cd", 12, 0)]).text).toBe("abcd");
    expect(pageText([run("ab", 0, 0), run("cd", 30, 0)]).text).toBe("ab cd");
    expect(pageText([run("ab", 0, 0, true), run("cd", 0, 14)]).text).toBe("ab cd");
  });
});

describe("search of a whole document", () => {
  const pages = (n: number) => async (i: number) => (i % 2 === 0 ? [run(`needle on page ${i}`, 0, 0)] : [run("nothing", 0, 0)]);

  it("goes page by page and reports each, in order", async () => {
    const seen: number[] = [];
    const hits = await searchDocument({ query: "needle", count: 6, runs: pages(6), onPage: (i, h) => seen.push(i * 10 + h.length) });
    expect(hits.map((h) => h.page)).toEqual([0, 2, 4]);
    expect(seen).toEqual([1, 10, 21, 30, 41, 50]);
  });

  it("stops at once when cancelled, with what it had", async () => {
    const ctl = new AbortController();
    let asked = 0;
    const hits = await searchDocument({
      query: "needle",
      count: 1000,
      signal: ctl.signal,
      runs: async (i) => {
        asked++;
        if (i === 4) ctl.abort();
        return [run("needle", 0, 0)];
      },
    });
    expect(asked).toBe(5);
    expect(hits.length).toBe(4);
  });

  it("gives the browser a turn on a big document, so it does not freeze", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const slow = async () => {
      const end = performance.now() + 3;
      while (performance.now() < end);
      return [run("needle", 0, 0)];
    };
    const hits = await searchDocument({ query: "needle", count: 40, runs: slow });
    clearInterval(timer);
    expect(hits).toHaveLength(40);
    expect(ticks).toBeGreaterThan(0);
  });
});

const viewport = { width: 800, height: 600 };
const count = () => q(".pli-pdf-find-count").textContent;
const find = () => q<HTMLInputElement>(".pli-pdf-find-input");
const mount = async (n = 3) => {
  const session = testSession({ pages: n });
  await render(<PliPdf session={session} renderer={fakeRenderer({ pages: n })} viewport={viewport} defaultZoom={1} />);
  await flush();
  return session;
};

describe("find bar", () => {
  it("counts matches over all pages: 1 of 3, then steps and wraps", async () => {
    const session = await mount(3);
    await chooseMenu("Edit", "Find…");
    expect(q(".pli-pdf-find").getAttribute("role")).toBe("search");
    await setValue(find(), "hello");
    await flush(8);
    expect(count()).toBe("1 of 3");
    expect(session.selection.page).toBe("p:main:0");
    await key(find(), "Enter");
    expect(count()).toBe("2 of 3");
    expect(session.selection.page).toBe("p:main:1");
    await key(find(), "Enter");
    await key(find(), "Enter");
    expect(count()).toBe("1 of 3");
    expect(session.selection.page).toBe("p:main:0");
    await key(find(), "Enter", { shiftKey: true });
    expect(count()).toBe("3 of 3");
    expect(session.selection.page).toBe("p:main:2");
    await click(byLabel("Previous match", host));
    expect(count()).toBe("2 of 3");
    await click(byLabel("Next match", host));
    expect(count()).toBe("3 of 3");
  });

  it("highlights the matches in the page, the current one in orange", async () => {
    await mount(3);
    await chooseMenu("Edit", "Find…");
    await setValue(find(), "hello");
    await flush(8);
    const hits = qa(".pli-pdf-hit", q(".pli-pdf-scroller"));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const current = qa(".pli-pdf-hit-current");
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("x")).toBe("72");
    expect(current[0]!.getAttribute("y")).toBe("110");
    expect(Number(current[0]!.getAttribute("width"))).toBe(30); // "Hello" is 5 of the 6 letters of a 36 wide run
    await key(find(), "Enter");
    await flush();
    expect(qa(".pli-pdf-hit-current")).toHaveLength(1);
    expect(qa(".pli-pdf-hit-current")[0]!.closest(".pli-pdf-page")!.getAttribute("data-page-index")).toBe("1");
  });

  it("reports no results, and clears the highlights when closed", async () => {
    await mount(3);
    await chooseMenu("Edit", "Find…");
    await setValue(find(), "zebra");
    await flush(8);
    expect(count()).toBe("No results");
    expect((byLabel("Next match", host) as HTMLButtonElement).disabled).toBe(true);
    await setValue(find(), "world");
    await flush(8);
    expect(qa(".pli-pdf-hit").length).toBeGreaterThan(0);
    await click(byLabel("Close find", host));
    expect(document.querySelector(".pli-pdf-find")).toBeNull();
    expect(qa(".pli-pdf-hit")).toHaveLength(0);
  });

  it("has match case and whole word toggles", async () => {
    await mount(3);
    await chooseMenu("Edit", "Find…");
    await setValue(find(), "HELLO");
    await flush(8);
    expect(count()).toBe("1 of 3");
    await click(byLabel("Match case", host));
    await flush(8);
    expect(byLabel("Match case", host).getAttribute("aria-pressed")).toBe("true");
    expect(count()).toBe("No results");
    await click(byLabel("Match case", host));
    await setValue(find(), "alph");
    await flush(8);
    expect(count()).toBe("1 of 3");
    await click(byLabel("Whole words", host));
    await flush(8);
    expect(count()).toBe("No results");
  });

  it("finds text that spans two runs, and goes to the next match with Ctrl+G", async () => {
    const session = await mount(3);
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    await setValue(find(), "o w");
    await flush(8);
    expect(count()).toBe("1 of 3");
    await key(q(".pli-pdf-scroller"), "g", { ctrlKey: true });
    expect(count()).toBe("2 of 3");
    expect(session.selection.page).toBe("p:main:1");
    await key(q(".pli-pdf-scroller"), "g", { ctrlKey: true, shiftKey: true });
    expect(count()).toBe("1 of 3");
  });

  it("searches again when pages are removed", async () => {
    const session = await mount(3);
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    await setValue(find(), "hello");
    await flush(8);
    expect(count()).toBe("1 of 3");
    const { act } = await import("react");
    await act(async () => session.pages.remove(["p:main:2"]));
    await flush(8);
    expect(count()).toMatch(/of 2$/);
  });
});
