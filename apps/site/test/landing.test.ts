// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initMotion } from "../src/scripts/motion";
import { effectiveTheme, initChrome } from "../src/scripts/chrome";

/**
 * The landing page's scripts, run against a small DOM with fake browser pieces (IntersectionObserver, matchMedia, requestAnimationFrame),
 * and the shape of the page that was built, when there is one.
 */

class FakeObserver {
  static all: FakeObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  fire(el: Element, isIntersecting = true) {
    this.callback([{ target: el, isIntersecting }]);
  }
}

let frames: FrameRequestCallback[] = [];
let reduced = false;
let narrow = false;
let nowMs = 0;
let dispose: (() => void) | undefined;

function flushFrames(advance = 0) {
  nowMs += advance;
  const run = frames;
  frames = [];
  run.forEach((cb) => cb(nowMs));
}
/** Fires every observer that is watching this element. */
function intersect(el: Element, isIntersecting = true) {
  FakeObserver.all.filter((o) => o.observed.has(el)).forEach((o) => o.fire(el, isIntersecting));
}

beforeEach(() => {
  frames = [];
  reduced = false;
  narrow = false;
  nowMs = 0;
  FakeObserver.all = [];
  const w = window as unknown as Record<string, unknown>;
  w.IntersectionObserver = FakeObserver;
  (globalThis as Record<string, unknown>).IntersectionObserver = FakeObserver;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
  w.cancelAnimationFrame = () => {};
  (globalThis as Record<string, unknown>).requestAnimationFrame = w.requestAnimationFrame;
  performance.now = () => nowMs;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : query.includes("max-width") ? narrow : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  delete (window as { __pliStory?: unknown }).__pliStory;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

describe("motion engine: reveals and counters", () => {
  it("marks the page as scripted and reveals an element once, the first time it is seen", () => {
    document.body.innerHTML = `<h1 data-reveal id="a">Hello</h1><p data-reveal id="b">Later</p>`;
    dispose = initMotion(document);
    expect(document.documentElement.classList.contains("pli-js")).toBe(true);
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    expect(a.classList.contains("pli-in")).toBe(false);
    intersect(a, false);
    expect(a.classList.contains("pli-in")).toBe(false);
    intersect(a, true);
    expect(a.classList.contains("pli-in")).toBe(true);
    expect(b.classList.contains("pli-in")).toBe(false);
    // Revealed elements are no longer watched.
    expect(FakeObserver.all.some((o) => o.observed.has(a))).toBe(false);
  });

  it("counts up to the final number, with its suffix and thousands separator", () => {
    document.body.innerHTML = `<strong id="n" data-count-to="2000" data-count-suffix="+">2,000+</strong>`;
    dispose = initMotion(document);
    const n = document.getElementById("n")!;
    intersect(n);
    expect(n.classList.contains("pli-in")).toBe(true);
    expect(n.textContent).toBe("0+");
    flushFrames(600);
    const mid = Number(n.textContent!.replace(/[^0-9]/g, ""));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(2000);
    flushFrames(1500);
    expect(n.textContent).toBe("2,000+");
  });

  it("shows the final number at once under reduced motion", () => {
    reduced = true;
    document.body.innerHTML = `<strong id="n" data-count-to="475">475</strong>`;
    dispose = initMotion(document);
    intersect(document.getElementById("n")!);
    expect(document.getElementById("n")!.textContent).toBe("475");
  });

  it("writes scroll progress for [data-scroll] elements near the viewport", () => {
    document.body.innerHTML = `<div id="s" data-scroll></div>`;
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    const s = document.getElementById("s")!;
    s.getBoundingClientRect = () => ({ top: 500, height: 500, bottom: 1000 }) as DOMRect;
    dispose = initMotion(document);
    intersect(s);
    flushFrames();
    // (vh - top) / (vh + height) = 500 / 1500
    expect(Number(s.style.getPropertyValue("--p"))).toBeCloseTo(0.3333, 3);
  });
});

describe("motion engine: the story", () => {
  const html = `
    <section id="story" data-story="tour" data-chapters="4" data-steps="3">
      <div data-chapter-for="0"></div><div data-chapter-for="1"></div><div data-chapter-for="2"></div><div data-chapter-for="3"></div>
    </section>`;
  const scrollTo = (top: number) => {
    const story = document.getElementById("story")!;
    story.getBoundingClientRect = () => ({ top, height: 5000, bottom: top + 5000 }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    return story;
  };
  const active = () => [...document.querySelectorAll<HTMLElement>("[data-chapter-for][data-active]")].map((e) => e.dataset.chapterFor);

  beforeEach(() => {
    document.body.innerHTML = html;
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
  });

  it("starts on the first chapter and step", () => {
    const story = document.getElementById("story")!;
    story.getBoundingClientRect = () => ({ top: 200, height: 5000, bottom: 5200 }) as DOMRect;
    dispose = initMotion(document);
    flushFrames();
    expect(story.dataset.chapter).toBe("0");
    expect(story.dataset.step).toBe("0");
    expect(active()).toEqual(["0"]);
    expect(window.__pliStory?.tour).toMatchObject({ chapter: 0, step: 0, static: false });
  });

  it("follows the scroll position through chapters and steps, in both directions", () => {
    dispose = initMotion(document);
    const seen: string[] = [];
    window.addEventListener("pli:story", (e) => {
      const d = (e as CustomEvent).detail;
      seen.push(`${d.chapter}.${d.step}`);
    });
    // scrollable height is 5000 - 1000 = 4000; 12 steps over 96% of it.
    let story = scrollTo(0);
    expect([story.dataset.chapter, story.dataset.step]).toEqual(["0", "0"]);
    story = scrollTo(-1500); // 0.375 -> index 4
    expect([story.dataset.chapter, story.dataset.step]).toEqual(["1", "1"]);
    expect(active()).toEqual(["1"]);
    story = scrollTo(-2600); // 0.65 -> index 8
    expect([story.dataset.chapter, story.dataset.step]).toEqual(["2", "2"]);
    story = scrollTo(-3999); // the end: last chapter, last step
    expect([story.dataset.chapter, story.dataset.step]).toEqual(["3", "2"]);
    expect(active()).toEqual(["3"]);
    story = scrollTo(-400); // and back up
    expect([story.dataset.chapter, story.dataset.step]).toEqual(["0", "1"]);
    expect(active()).toEqual(["0"]);
    expect(seen).toEqual(["0.0", "1.1", "2.2", "3.2", "0.1"]);
    expect(Number(story.style.getPropertyValue("--p"))).toBeCloseTo(0.1, 3);
  });

  it("reports progress inside a chapter (--cp) from 0 to 1", () => {
    dispose = initMotion(document);
    const story = scrollTo(-1000); // p = 0.25: the first moment of chapter 1
    expect(story.dataset.chapter).toBe("1");
    expect(Number(story.style.getPropertyValue("--cp"))).toBeCloseTo(0, 3);
    scrollTo(-1500); // p = 0.375: halfway through chapter 1
    expect(Number(story.style.getPropertyValue("--cp"))).toBeCloseTo(0.5, 3);
  });

  it("is static under reduced motion: the finished state, published once, with no scroll listener work", () => {
    reduced = true;
    const story = document.getElementById("story")!;
    story.getBoundingClientRect = () => ({ top: 3000, height: 5000, bottom: 8000 }) as DOMRect;
    dispose = initMotion(document);
    flushFrames();
    expect(story.dataset.chapter).toBe("3");
    expect(story.dataset.step).toBe("2");
    expect(window.__pliStory?.tour).toMatchObject({ chapter: 3, step: 2, static: true });
    let events = 0;
    window.addEventListener("pli:story", () => events++);
    scrollTo(-2000);
    expect(events).toBe(0);
    expect(story.dataset.chapter).toBe("3");
  });

  it("is static on a narrow screen too", () => {
    narrow = true;
    dispose = initMotion(document);
    flushFrames();
    expect(window.__pliStory?.tour).toMatchObject({ chapter: 3, step: 2, static: true });
  });
});

describe("page chrome: theme toggle and menu", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <meta name="theme-color" content="#fbfbfd" media="(prefers-color-scheme: light)" data-scheme="light">
      <meta name="theme-color" content="#08080f" media="(prefers-color-scheme: dark)" data-scheme="dark">
      <button data-theme-toggle aria-pressed="false"></button>
      <details data-menu><summary>Menu</summary><a href="/x">x</a></details><p id="out">outside</p>`;
    localStorage.clear();
  });

  it("flips between light and dark and stores the choice under the key the docs use", () => {
    dispose = initChrome(document);
    const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;
    expect(effectiveTheme(document)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("starlight-theme")).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("starlight-theme")).toBe("light");
  });

  it("still switches when storage is blocked", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      dispose = initChrome(document);
      document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!.click();
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("closes the phone menu on Escape and on a click outside", () => {
    dispose = initChrome(document);
    const menu = document.querySelector<HTMLDetailsElement>("details")!;
    menu.open = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.open).toBe(false);
    menu.open = true;
    document.getElementById("out")!.click();
    expect(menu.open).toBe(false);
    menu.open = true;
    const link = menu.querySelector("a")!;
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    expect(menu.open).toBe(true);
  });
});

/** The latest built page: PLI_SITE_DIST (a build's output folder) or apps/site/dist. Skipped when it is not the landing page. */
function builtIndex(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.PLI_SITE_DIST, join(here, "..", "dist")].filter(Boolean) as string[];
  for (const dir of candidates) {
    const file = join(dir, "index.html");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("pli-marketing")) return text;
  }
  return undefined;
}

describe("built landing page", () => {
  const built = builtIndex();
  const check = built ? it : it.skip;

  check("has the head a page needs: title, description, canonical, social tags, icon, theme colours", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    expect(doc.title.length).toBeGreaterThan(10);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(50);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://pli.dev/");
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.svg");
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(doc.title);
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe("https://pli.dev/");
    expect(doc.querySelector('meta[name="twitter:card"]')).not.toBeNull();
    expect(doc.querySelectorAll('meta[name="theme-color"]').length).toBe(2);
  });

  check("has one h1, a skip link, a main landmark, the header and the footer", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector('a.pli-skip[href="#main"]')).not.toBeNull();
    expect(doc.querySelector("main#main")).not.toBeNull();
    expect(doc.querySelector("header.site-header")).not.toBeNull();
    expect(doc.querySelector("footer.site-footer")).not.toBeNull();
    const nav = [...doc.querySelectorAll(".site-header__nav a")].map((a) => a.getAttribute("href"));
    expect(nav).toEqual(["/documents/", "/sheets/", "/decks/", "/pdf/", "/platform/architecture/", "/introduction/", "/roadmap/"]);
  });

  check("holds the story with four chapters of three steps, each with an editor island and its poster", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    const story = doc.querySelector("[data-story='tour']")!;
    expect(story.getAttribute("data-chapters")).toBe("4");
    expect(story.getAttribute("data-steps")).toBe("3");
    expect(story.querySelectorAll("article[data-chapter-for]").length).toBe(4);
    for (const article of story.querySelectorAll("article[data-chapter-for]")) {
      expect(article.querySelectorAll("li[data-step-for]").length).toBe(3);
      expect(article.querySelector("a.story__more")?.getAttribute("href")).toMatch(/^\/(documents|sheets|decks|pdf)\/$/);
      const island = article.querySelector("astro-island");
      expect(island).not.toBeNull();
      expect(island!.getAttribute("props")).toContain("story");
      expect(island!.querySelector(".pli-live__poster")?.innerHTML.length).toBeGreaterThan(20);
    }
    const hero = [...doc.querySelectorAll("astro-island")].find((i) => i.getAttribute("props")?.includes("hero"));
    expect(hero?.querySelector(".pli-live__poster")).not.toBeNull();
  });

  check("has the hero's counters with their true final numbers in the HTML", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    const counters = [...doc.querySelectorAll(".hero [data-count-to]")];
    expect(counters.length).toBeGreaterThanOrEqual(3);
    for (const c of counters) {
      const to = Number(c.getAttribute("data-count-to"));
      expect(c.textContent!.replace(/[^0-9]/g, "")).toBe(String(to));
    }
  });

  check("is not a Starlight page and links only to the real repository address", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    expect(doc.querySelector(".sl-markdown-content, starlight-menu-button, .sidebar-content")).toBeNull();
    // The only GitHub address is the repository's (given by its owner); credit and link are in the footer.
    expect(built!.replaceAll("https://github.com/MaisonDeCode/pli.dev", "")).not.toMatch(/github\.com/);
    expect(built).toContain("https://maisondecode.com");
    expect(doc.querySelector('footer a[href="https://github.com/MaisonDeCode/pli.dev"]')).not.toBeNull();
  });

  check("links to Contributing from the footer's Resources column", () => {
    const doc = new DOMParser().parseFromString(built!, "text/html");
    const link = doc.querySelector('footer nav[aria-labelledby="footer-resources"] a[href="/platform/contributing/"]');
    expect(link?.textContent).toBe("Contributing");
  });
});
