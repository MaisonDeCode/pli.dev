/**
 * The page's motion engine: one small module, no library. It never animates layout; it only toggles classes and writes CSS
 * custom properties, and the stylesheet (styles/motion.css) turns those into transform and opacity changes.
 *
 * What it does:
 *  1. Marks <html> with `pli-js` so reveal start states only exist when this script runs (no script: everything shows).
 *  2. Reveals: `[data-reveal]` gets `.pli-in` once, the first time it is 10% visible.
 *  3. Scroll progress: `[data-scroll]` and `[data-parallax]` get `--p` (0..1) while near the viewport, from one passive scroll
 *     listener that does its work in requestAnimationFrame. Elements off screen are not touched.
 *  4. Counters: `[data-count-to="1200"]` (optional data-count-from, data-count-suffix) counts up when revealed.
 *  5. Stories: `[data-story]` is a tall section holding a sticky stage. Its attributes:
 *       data-story="id"          the story's name (events and the `window.__pliStory[id]` state use it)
 *       data-chapters="4"        how many chapters (Documents, Sheets, Decks, PDF)
 *       data-steps="3"           steps inside each chapter
 *     As the visitor scrolls through it the engine sets, on the story element: `--p` (0..1 over everything), `data-chapter`
 *     (0-based) and `data-step` (0-based inside the chapter), and `data-chapter-p` via `--cp` (0..1 inside the chapter). Children
 *     with `[data-chapter-for="2"]` get `data-active` while that chapter is current. It also publishes
 *     `window.__pliStory[id] = { id, chapter, step, steps, chapters, progress, chapterProgress }` and dispatches a `pli:story`
 *     CustomEvent on `window` with the same object as `detail`, so React islands (which are separate bundles) can follow along.
 *  6. Reduced motion or a narrow screen: stories are not pinned (CSS), and each reports its last chapter and step as a static,
 *     finished state, once. Nothing keeps listening for scroll.
 */
export interface StoryState {
  id: string;
  chapter: number;
  step: number;
  chapters: number;
  steps: number;
  progress: number;
  chapterProgress: number;
  /** True when the page is not scrolling the story (reduced motion, small screen): show finished states. */
  static: boolean;
}

declare global {
  interface Window {
    __pliStory?: Record<string, StoryState>;
  }
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function initMotion(root: Document = document): () => void {
  const html = root.documentElement;
  html.classList.add("pli-js");
  const view = root.defaultView!;
  const reduced = view.matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = view.matchMedia("(max-width: 899px)");
  const cleanups: (() => void)[] = [];

  // 2. Reveals and 4. counters share one observer.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.classList.add("pli-in");
        if (el.hasAttribute("data-count-to")) count(el, reduced.matches);
        io.unobserve(el);
      }
    },
    { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
  );
  root.querySelectorAll<HTMLElement>("[data-reveal], [data-count-to]").forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());

  // 3. Scroll progress for elements near the viewport.
  const tracked = new Set<HTMLElement>();
  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) tracked.add(entry.target as HTMLElement);
        else tracked.delete(entry.target as HTMLElement);
      }
      schedule();
    },
    { rootMargin: "20% 0px 20% 0px" },
  );
  root.querySelectorAll<HTMLElement>("[data-scroll], [data-parallax]").forEach((el) => {
    const speed = el.getAttribute("data-parallax");
    if (speed) el.style.setProperty("--pli-parallax", speed);
    near.observe(el);
  });
  cleanups.push(() => near.disconnect());

  // 5. Stories.
  const stories = [...root.querySelectorAll<HTMLElement>("[data-story]")];
  const lastSent = new Map<string, string>();

  function updateStory(el: HTMLElement) {
    const id = el.dataset.story ?? "story";
    const chapters = Number(el.dataset.chapters ?? 1);
    const steps = Number(el.dataset.steps ?? 1);
    const isStatic = reduced.matches || narrow.matches;
    let progress: number;
    if (isStatic) progress = 1;
    else {
      const rect = el.getBoundingClientRect();
      progress = clamp(-rect.top / Math.max(1, rect.height - view.innerHeight));
    }
    const total = chapters * steps;
    // The last step is reached just before the end so it is on screen for a moment before the section unpins.
    const index = isStatic ? total - 1 : Math.min(total - 1, Math.floor(clamp(progress / 0.96) * total));
    const chapter = Math.floor(index / steps);
    const step = index % steps;
    const chapterProgress = isStatic ? 1 : clamp(progress * chapters - chapter);
    el.style.setProperty("--p", progress.toFixed(4));
    el.style.setProperty("--cp", chapterProgress.toFixed(4));
    const key = `${chapter}.${step}.${isStatic}`;
    if (lastSent.get(id) === key) return;
    lastSent.set(id, key);
    el.dataset.chapter = String(chapter);
    el.dataset.step = String(step);
    el.querySelectorAll<HTMLElement>("[data-chapter-for]").forEach((c) => {
      if (Number(c.dataset.chapterFor) === chapter) c.setAttribute("data-active", "");
      else c.removeAttribute("data-active");
    });
    const state: StoryState = { id, chapter, step, chapters, steps, progress, chapterProgress, static: isStatic };
    (view.__pliStory ??= {})[id] = state;
    view.dispatchEvent(new CustomEvent("pli:story", { detail: state }));
  }

  let frame = 0;
  function run() {
    frame = 0;
    const vh = view.innerHeight;
    for (const el of tracked) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--p", clamp((vh - rect.top) / (vh + rect.height)).toFixed(4));
    }
    for (const el of stories) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -vh || rect.top > vh * 2) {
        // Far from the viewport: still publish once so islands know the starting state.
        if (!view.__pliStory?.[el.dataset.story ?? "story"]) updateStory(el);
        continue;
      }
      updateStory(el);
    }
  }
  function schedule() {
    if (!frame) frame = view.requestAnimationFrame(run);
  }
  const onScroll = () => schedule();
  view.addEventListener("scroll", onScroll, { passive: true });
  view.addEventListener("resize", onScroll, { passive: true });
  const onMedia = () => {
    lastSent.clear();
    schedule();
  };
  reduced.addEventListener("change", onMedia);
  narrow.addEventListener("change", onMedia);
  cleanups.push(() => {
    view.removeEventListener("scroll", onScroll);
    view.removeEventListener("resize", onScroll);
    reduced.removeEventListener("change", onMedia);
    narrow.removeEventListener("change", onMedia);
    if (frame) view.cancelAnimationFrame(frame);
  });
  schedule();
  return () => cleanups.forEach((fn) => fn());
}

function count(el: HTMLElement, instant: boolean) {
  const to = Number(el.dataset.countTo);
  const from = Number(el.dataset.countFrom ?? 0);
  const suffix = el.dataset.countSuffix ?? "";
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US") + suffix;
  if (instant || !Number.isFinite(to)) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const duration = 1400;
  const tick = (now: number) => {
    const t = clamp((now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  el.textContent = fmt(from);
  requestAnimationFrame(tick);
}
