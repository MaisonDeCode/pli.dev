import { useEffect, useMemo, useRef, useState } from "react";
import { createFonts } from "@pli.dev/core";
import type { PdfSession } from "@pli.dev/pdf";
import { PdfEditor, type PliPdfHandle } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
// Vite copies the worker into the build and gives its address; nothing fetches it until pdf.js is started by the first page.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { LiveBodyProps } from "./types";
import { PdfDirector, clampPdfStep } from "./pdf/director";
import { YOU, openSample, planFor, showStep, type Plan } from "./pdf/script";

/** If the first page has not been drawn by then (a slow connection to the worker, a hidden tab) the editor is shown anyway. */
const READY_FALLBACK_MS = 8000;
/** The part of page 1 the story works on, in points: from the top to the signature field. The zoom makes it fit the window. */
const STORY_HEIGHT = 440;
/**
 * What the title row (38), the menu bar (28), the annotation row (47 with its margin), the form bar (46) and the page margins take of the window's height, in
 * pixels, measured on the ready-made layout: no top toolbar, and every bar is one row (they scroll sideways instead of wrapping, so this does not
 * change with the width of the window). The status bar floats over the pages and takes none.
 */
const CHROME = 168;

/**
 * The Pli.PDF editor for the site: the real `PdfEditor`, drawing with pdf.js, on the sample file the engine makes in the
 * browser. The story (`pdf/script.ts`) draws on it with the engine's own commands, played by `pdf/director.ts`.
 * Nothing is fetched except pdf.js and its worker, which come with the site, and only once this editor is on screen.
 */
export default function PdfLive({ step, interactive, reducedMotion, onReady }: LiveBodyProps) {
  const initial = useRef(clampPdfStep(step));
  const [live, setLive] = useState<{ session: PdfSession; plan: Plan } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const renderer = useMemo(() => pdfjsRenderer({ workerSrc }), []);
  const fonts = useMemo(() => createFonts({ source: null, noGoogle: true, storage: null }), []);
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<PliPdfHandle>(null);

  // ---- the document: made by the engine, with the story's first state already in it ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await openSample();
        const plan = await planFor(session);
        showStep(session, plan, initial.current);
        if (!cancelled) setLive({ session, plan });
      } catch (e) {
        if (!cancelled) setFailure(e ?? new Error("The sample PDF could not be made"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // ---- the director ----
  const director = useRef<PdfDirector | null>(null);
  useEffect(() => {
    if (!live) return;
    const d = new PdfDirector(live.session, live.plan, initial.current);
    director.current = d;
    return () => {
      d.dispose();
      if (director.current === d) director.current = null;
    };
  }, [live]);
  useEffect(() => {
    const d = director.current;
    if (!d) return;
    if (interactive) d.release();
    else d.goTo(step, !reducedMotion);
  }, [live, step, interactive, reducedMotion]);

  // ---- ready: the first page has been drawn (or a while has passed) ----
  useEffect(() => {
    const el = box.current;
    if (!live || !el) return;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      onReady();
    };
    const drawn = () => el.querySelector('.pli-pdf-page[data-state="ready"]') !== null;
    const check = () => {
      if (drawn()) go();
    };
    check();
    const watch = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(check);
    watch?.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-state"], childList: true });
    const timer = setTimeout(() => {
      // a page that failed to draw is not shown as if it were fine: the poster stays
      if (!el.querySelector('.pli-pdf-page[data-state="error"]')) go();
    }, READY_FALLBACK_MS);
    return () => {
      done = true;
      watch?.disconnect();
      clearTimeout(timer);
    };
  }, [live, onReady]);

  // ---- the zoom that shows the part of the page the story works on, whatever the height of the window ----
  const [fit, setFit] = useState(0.9);
  const interactiveNow = useRef(interactive);
  interactiveNow.current = interactive;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (interactiveNow.current || el.clientHeight === 0) return;
      const z = Math.round(Math.min(1.1, Math.max(0.6, (el.clientHeight - CHROME) / STORY_HEIGHT)) * 20) / 20;
      setFit((old) => (old === z ? old : z));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!interactive) handle.current?.setZoom(fit);
  }, [fit, live, interactive]);

  // A failed editor falls back to the poster (LiveEditor catches what is thrown while drawing).
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));

  return (
    <div ref={box} className="pli-live-pdf" style={{ height: "100%", width: "100%", minWidth: 0, overflow: "hidden" }}>
      {live ? <PdfEditor ref={handle} key={live.session.doc.id} session={live.session} renderer={renderer} user={YOU} fonts={fonts} defaultZoom={fit} /> : null}
    </div>
  );
}
