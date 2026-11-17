import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import "./live.css";
import { useCanRunEditor, usePrefersReducedMotion, useStory } from "./story";
import type { LiveBodyProps, LiveEditorProps, LiveKind } from "./types";

/**
 * A live Pli editor on the page, loaded only when it is wanted. The island itself (this file plus React) is small: the editor
 * packages are dynamic imports, started when the island is on screen, the screen is wide enough and, in a scroll story, the
 * chapter is the current one or next to it. Until then, and on phones, with data saver, and when scripts fail, the poster
 * (the children, drawn by Poster.astro) is what people see.
 *
 *   <LiveEditor client:visible kind="docs" mode="hero"><Poster kind="docs" /></LiveEditor>
 */
/**
 * Each editor's stylesheet is fetched with its code and added to <head> only when the editor starts. (A plain CSS import in
 * the editor files would be collected into the page's own <head> at build time, where it blocks first paint.)
 */
const styles: Record<LiveKind, (() => Promise<{ default: string }>)[]> = {
  docs: [() => import("@pli.dev/react/styles.css?inline")],
  sheets: [() => import("@pli.dev/react/styles.css?inline"), () => import("@pli.dev/sheets-react/styles.css?inline")],
  decks: [() => import("@pli.dev/react/styles.css?inline"), () => import("@pli.dev/decks-react/styles.css?inline")],
  pdf: [() => import("@pli.dev/react/styles.css?inline"), () => import("@pli.dev/pdf-react/styles.css?inline")],
};
const added = new Set<string>();
async function addStyles(kind: LiveKind) {
  const sheets = await Promise.all(styles[kind].map((load) => load()));
  sheets.forEach((sheet, i) => {
    const key = `${i === 0 ? "base" : kind}`;
    if (added.has(key)) return;
    added.add(key);
    const el = document.createElement("style");
    el.setAttribute("data-pli-editor-css", key);
    el.textContent = sheet.default;
    document.head.appendChild(el);
  });
}
const withStyles = (kind: LiveKind, body: () => Promise<{ default: ComponentType<LiveBodyProps> }>) => async () => {
  await addStyles(kind);
  return body();
};
const loaders: Record<LiveKind, () => Promise<{ default: ComponentType<LiveBodyProps> }>> = {
  docs: withStyles("docs", () => import("./DocsLive")),
  sheets: withStyles("sheets", () => import("./SheetsLive")),
  decks: withStyles("decks", () => import("./DecksLive")),
  pdf: withStyles("pdf", () => import("./PdfLive")),
};
const lazies = new Map<LiveKind, ReturnType<typeof lazy<ComponentType<LiveBodyProps>>>>();
function bodyFor(kind: LiveKind) {
  let c = lazies.get(kind);
  if (!c) lazies.set(kind, (c = lazy(loaders[kind])));
  return c;
}

/** A failed editor must never break the page: it falls back to the poster. */
class Contain extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const NAMES: Record<LiveKind, string> = { docs: "Pli.Documents", sheets: "Pli.Sheets", decks: "Pli.Decks", pdf: "Pli.PDF" };
/** How long each hero step is shown before the next one starts. */
const HERO_STEP_MS = 5200;

export default function LiveEditor({ kind, mode, story: storyId, chapter = 0, steps = 3, label, title, children }: LiveEditorProps) {
  const canRun = useCanRunEditor();
  const reduced = usePrefersReducedMotion();
  const story = useStory(mode === "story" ? storyId : undefined);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "poster">("idle");
  const [interactive, setInteractive] = useState(false);
  const [heroStep, setHeroStep] = useState(reduced ? steps - 1 : 0);
  const root = useRef<HTMLDivElement>(null);

  // Should this editor be loaded now?
  const near = mode !== "story" || !story || Math.abs(story.chapter - chapter) <= 1;
  // Reduced motion (the story is not pinned, so all four chapters are stacked on screen): posters only, nothing heavy loads.
  const want = canRun && near && state !== "poster" && !(mode === "story" && story?.static);
  useEffect(() => {
    if (want && state === "idle") setState("loading");
  }, [want, state]);

  // Which step to show.
  let step: number;
  if (mode === "story") {
    if (!story) step = 0;
    else if (story.chapter === chapter) step = story.step;
    else step = story.chapter > chapter ? steps - 1 : 0;
  } else step = reduced ? steps - 1 : heroStep;

  // Hero and product windows play by themselves while on screen and untouched, then hold the last step before looping.
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (mode === "story" || !root.current) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(root.current);
    return () => io.disconnect();
  }, [mode]);
  useEffect(() => {
    if (mode === "story" || reduced || interactive || state !== "ready" || !onScreen) return;
    const last = heroStep >= steps - 1;
    const t = setTimeout(() => setHeroStep(last ? 0 : heroStep + 1), last ? HERO_STEP_MS + 2600 : HERO_STEP_MS);
    return () => clearTimeout(t);
  }, [mode, reduced, interactive, state, onScreen, heroStep, steps]);

  const frozen = useRef(step);
  if (!interactive) frozen.current = step;

  const onReady = useCallback(() => setState((s) => (s === "poster" ? s : "ready")), []);
  const onFail = useCallback(() => setState("poster"), []);
  const Body = useMemo(() => bodyFor(kind), [kind]);
  const live = state === "loading" || state === "ready";
  const name = label ?? `A live ${NAMES[kind]} editor`;

  // Escape returns control to the tour.
  useEffect(() => {
    if (!interactive || mode !== "story") return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && setInteractive(false);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [interactive, mode]);

  return (
    <div ref={root} className="pli-live" data-product={kind} data-mode={mode} data-live={state} data-interactive={interactive} role="group" aria-label={name}>
      <div className="pli-live__bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <b>{title ?? NAMES[kind]}</b>
        <span className="pli-live__badge">{state === "ready" ? (interactive ? "Yours to try" : "Live") : "Preview"}</span>
      </div>
      <div className="pli-live__poster">{children}</div>
      {live ? (
        <div className="pli-live__stage" {...(interactive ? {} : { inert: true })}>
          <Contain onFail={onFail}>
            <Suspense fallback={null}>
              <Body step={interactive ? frozen.current : step} steps={steps} interactive={interactive} reducedMotion={reduced} mode={mode} onReady={onReady} />
            </Suspense>
          </Contain>
        </div>
      ) : null}
      {state === "ready" && !interactive ? (
        <button type="button" className="pli-live__cta" onClick={() => setInteractive(true)} aria-label={`Try the ${NAMES[kind]} editor yourself`}>
          <span>Click to try it yourself</span>
        </button>
      ) : null}
      {interactive && mode === "story" ? (
        <button type="button" className="pli-live__done" onClick={() => setInteractive(false)}>
          Back to the tour (Esc)
        </button>
      ) : null}
    </div>
  );
}
