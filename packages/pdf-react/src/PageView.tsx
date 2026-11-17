import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Page, PdfSession, Rect } from "@pli.dev/pdf";
import { canvasScale, layerTransform, screenToPage, textLayerRuns, TEXT_LAYER_CLASS, type PageFrame } from "./geometry";
import { SourceMissing, type PageSources } from "./engine";
import type { RenderQueue, QueueJob } from "./renderQueue";
import type { RenderedPage, TextRun } from "./renderer";
import type { PageContext, PagePointerEvent, PdfTool } from "./extensions";

export interface PageHighlight {
  rect: Rect;
  current?: boolean;
}

export interface PageViewProps {
  session: PdfSession;
  pages: PageSources;
  queue: RenderQueue;
  readOnly: boolean;
  page: Page;
  index: number;
  /** Where and how big the page is on the scrolling content (CSS pixels), and how it is turned. */
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  /** CSS pixels per point. */
  scale: number;
  /** 0 for a page in view, 1 for one near it: which is drawn first. */
  priority: 0 | 1;
  dpr: number;
  highlights?: readonly PageHighlight[];
  /** Make the text selectable (default true). */
  textLayer?: boolean;
  tool?: PdfTool | null;
  /** Drawn in page space inside the page's SVG layer: the annotations. */
  overlay?: (ctx: PageContext) => ReactNode;
  /** Drawn in page space in an HTML layer: form fields, note editors. */
  overlayDom?: (ctx: PageContext) => ReactNode;
  /** Drawn in page space in an SVG layer that multiplies with the page (highlights: the text stays readable under them). */
  overlayBlend?: (ctx: PageContext) => ReactNode;
  /** Draw the page without being placed (the thumbnails and the printing path use `PageCanvas` instead). */
  className?: string;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** How wide `text` is in the browser's sans-serif font at `size` pixels (about half the size per letter where it cannot be measured). */
export function textWidth(text: string, size: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * size * 0.5;
  measureCtx.font = `${size}px sans-serif`;
  return measureCtx.measureText(text).width;
}

/** The spans of a text layer: one transparent, selectable span per run, stretched to the run's box. */
function runStyle(run: TextRun): CSSProperties {
  const size = Math.max(1, run.dir === "ttb" ? run.w : run.h);
  const natural = textWidth(run.str, size);
  const sx = run.dir === "ttb" || natural <= 0 || run.w <= 0 ? 1 : run.w / natural;
  const transforms = [run.angle ? `rotate(${Math.round(run.angle * 100) / 100}deg)` : "", sx !== 1 ? `scaleX(${Math.round(sx * 1000) / 1000})` : ""].filter(Boolean).join(" ");
  return {
    left: run.x,
    top: run.y,
    fontSize: size,
    ...(run.dir === "rtl" ? { direction: "rtl" as const } : {}),
    ...(transforms ? { transform: transforms } : {}),
  };
}

export const TextLayer = memo(function TextLayer({ runs, frame, pageId, index }: { runs: readonly TextRun[]; frame: PageFrame; pageId: string; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    textLayerRuns.set(el, runs);
    return () => void textLayerRuns.delete(el);
  }, [runs]);
  const spans = useMemo(
    () =>
      runs.map((run, i) => (
        <Fragment key={i}>
          <span data-run={i} style={runStyle(run)}>
            {run.str}
          </span>
          {run.eol && <br role="presentation" />}
        </Fragment>
      )),
    [runs],
  );
  return (
    <div ref={ref} className={TEXT_LAYER_CLASS} data-page={pageId} data-index={index} style={{ width: frame.width, height: frame.height, transform: layerTransform(frame) }}>
      {spans}
    </div>
  );
});

function discard(canvas: HTMLCanvasElement) {
  // Setting the size to nothing hands the pixels back at once (Safari keeps canvases alive otherwise).
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * One page: the picture (a canvas drawn by the renderer, first small and quick, then sharp), the selectable text on top
 * of it, an SVG layer and an HTML layer in page space for annotations and tools, and the search highlights. The page
 * element is `position: absolute` at the place the layout gave it.
 */
export const PageView = memo(function PageView(p: PageViewProps) {
  const { session, pages, queue, page, index, scale, rotation, priority } = p;
  const frame: PageFrame = { width: page.width, height: page.height, rotation, scale };
  const holder = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const shown = useRef({ scale: 0, rotation: -1 });
  const jobs = useRef<QueueJob[]>([]);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "waiting">("loading");
  // A file that has not arrived yet (a peer added it): ask again after a pause that grows.
  const [attempt, setAttempt] = useState(0);
  const [runs, setRuns] = useState<readonly TextRun[] | null>(null);
  const key = pages.key(page);
  const withText = p.textLayer !== false;

  // Take the page from the cache for as long as it is shown.
  useEffect(() => {
    setRendered(null);
    setState((old) => (old === "waiting" ? old : "loading"));
    setRuns(null);
    shown.current = { scale: 0, rotation: -1 };
    const host = holder.current;
    host?.replaceChildren();
    const lease = pages.acquire(page);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    lease.promise.then(
      (r) => {
        if (!live) return;
        setAttempt(0);
        setRendered(r);
      },
      (e) => {
        if (!live) return;
        if (e instanceof SourceMissing) {
          setState("waiting");
          timer = setTimeout(() => setAttempt((n) => n + 1), pages.retryDelay(attempt));
        } else setState("error");
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
      lease.release();
      // Give the pixels back now rather than when the garbage collector gets to it.
      for (const c of Array.from(host?.children ?? [])) if (c instanceof HTMLCanvasElement) discard(c);
    };
    // `page` is covered by `key`, which changes when the picture does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, key, attempt]);

  // Draw it: small first if nothing is there, then at the size the screen needs.
  const target = canvasScale(page.width, page.height, scale, p.dpr);
  const wanted = Math.round(target.scale * 1000) / 1000;
  useEffect(() => {
    const host = holder.current;
    if (!rendered || !host) return;
    if (shown.current.rotation !== rotation && shown.current.rotation !== -1) {
      host.replaceChildren();
      shown.current = { scale: 0, rotation: -1 };
    }
    const base = priority * 10;
    const paint = async (s: number, signal: AbortSignal) => {
      const canvas = document.createElement("canvas");
      try {
        await rendered.render({ canvas, scale: s, rotation, signal });
      } catch (e) {
        discard(canvas);
        throw e;
      }
      if (signal.aborted) return discard(canvas);
      if (shown.current.rotation === rotation && shown.current.scale >= s) return discard(canvas);
      canvas.className = "pli-pdf-canvas";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      for (const old of Array.from(host.children)) if (old instanceof HTMLCanvasElement) discard(old);
      host.replaceChildren(canvas);
      shown.current = { scale: s, rotation };
      host.dataset.scale = String(Math.round(s * 1000) / 1000);
      setState("ready");
    };
    const list: QueueJob[] = [];
    const fresh = shown.current.rotation === rotation && shown.current.scale >= wanted * 0.999;
    if (!fresh) {
      if (shown.current.scale === 0) {
        const quick = Math.min(wanted, 400 / Math.max(page.width, page.height, 1));
        if (quick < wanted * 0.8) list.push(queue.add(base, (signal) => paint(quick, signal)));
      }
      list.push(queue.add(base + 1, (signal) => paint(wanted, signal)));
    }
    jobs.current = list;
    for (const j of list) j.done.catch(() => setState((s) => (s === "ready" ? s : "error")));
    return () => {
      for (const j of list) j.cancel();
    };
  }, [rendered, wanted, rotation, queue]);

  useEffect(() => {
    for (const j of jobs.current) j.priority = (j.priority % 10) + priority * 10;
  }, [priority]);

  // The text, for selecting and copying.
  useEffect(() => {
    if (!withText) return;
    let live = true;
    pages.text(page).then(
      (r) => live && setRuns(r),
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, key, withText]);

  const ctx: PageContext = { session, readOnly: p.readOnly, page, index, width: page.width, height: page.height, rotation, scale, frame };
  const transform = layerTransform(frame);
  const tool = p.tool;

  const forward = (type: PagePointerEvent["type"]) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tool?.onPointer || !el.current) return;
    const rect = el.current.getBoundingClientRect();
    const [x, y] = screenToPage(frame, e.clientX - rect.left, e.clientY - rect.top);
    if (type === "down") {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // not capturable (a synthetic event)
      }
    }
    tool.onPointer({ ...ctx, x, y, type, pointerType: e.pointerType, button: e.button, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, native: e });
  };

  const style: CSSProperties = { left: p.left, top: p.top, width: p.width, height: p.height };
  const interactive = !!tool?.onPointer;
  return (
    <div
      ref={el}
      className={p.className ? `pli-pdf-page ${p.className}` : "pli-pdf-page"}
      role="group"
      aria-label={`Page ${index + 1}`}
      data-page-id={page.id}
      data-page-index={index}
      data-state={state}
      data-rotation={rotation}
      data-blank={page.from ? undefined : ""}
      style={style}
    >
      <div ref={holder} className="pli-pdf-canvas-holder" />
      {state !== "ready" && (
        <div className="pli-pdf-placeholder" data-waiting={state === "waiting" ? "" : undefined} aria-hidden={state !== "error" && state !== "waiting"} role={state === "error" ? "alert" : state === "waiting" ? "status" : undefined}>
          {state === "error" ? "This page could not be shown" : state === "waiting" ? "Waiting for the file…" : index + 1}
        </div>
      )}
      {withText && runs && runs.length > 0 && (
        <div className="pli-pdf-layer" data-select={interactive && !tool?.selectText ? "off" : "on"}>
          <TextLayer runs={runs} frame={frame} pageId={page.id} index={index} />
        </div>
      )}
      {p.overlayBlend && (
        <svg className="pli-pdf-overlay pli-pdf-blend-layer" width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`} style={{ transform }} aria-hidden="true" focusable="false">
          {p.overlayBlend(ctx)}
        </svg>
      )}
      <svg className="pli-pdf-overlay" width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`} style={{ transform }} aria-hidden="true" focusable="false">
        {p.overlay?.(ctx)}
        {tool?.overlay?.(ctx)}
        {p.highlights && p.highlights.length > 0 && (
          <g className="pli-pdf-hits">
            {p.highlights.map((h, i) => (
              <rect key={i} className={h.current ? "pli-pdf-hit pli-pdf-hit-current" : "pli-pdf-hit"} x={h.rect.x} y={h.rect.y} width={h.rect.w} height={h.rect.h} rx={1.5} />
            ))}
          </g>
        )}
      </svg>
      {p.overlayDom && (
        <div className="pli-pdf-overlay-dom" style={{ width: page.width, height: page.height, transform }}>
          {p.overlayDom(ctx)}
        </div>
      )}
      {interactive && <div className="pli-pdf-interact" data-tool={tool!.id} style={{ cursor: tool!.cursor ?? "crosshair", pointerEvents: tool!.selectText ? "none" : undefined }} onPointerDown={forward("down")} onPointerMove={forward("move")} onPointerUp={forward("up")} onPointerCancel={forward("up")} />}
    </div>
  );
});
