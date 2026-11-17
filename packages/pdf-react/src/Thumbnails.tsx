import { memo, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { Page } from "@pli.dev/pdf";
import { canvasScale, normRotation, turnedSize } from "./geometry";
import type { PageSources } from "./engine";
import type { RenderQueue } from "./renderQueue";
import { PageContextMenu } from "./PageMenu";
import type { PageTools } from "./pageTools";
import { NO_STORE, useStore } from "./store";

/** The widest and tallest a thumbnail is, in CSS pixels. */
export const THUMB_WIDTH = 120;
export const THUMB_HEIGHT = 168;
const LABEL = 26;
const PAD = 10;

const caches = new WeakMap<PageSources, Map<string, HTMLCanvasElement>>();
const MAX_CACHED = 240;

/** The size a page's thumbnail is drawn at (inside a box of `THUMB_WIDTH` by `THUMB_HEIGHT` unless another is given). */
export function thumbSize(page: Pick<Page, "width" | "height" | "rotate">, box: { width: number; height: number } = { width: THUMB_WIDTH, height: THUMB_HEIGHT }): { width: number; height: number; scale: number } {
  const t = turnedSize(page.width, page.height, page.rotate);
  const scale = Math.min(box.width / t.width, box.height / t.height);
  return { width: Math.round(t.width * scale), height: Math.round(t.height * scale), scale };
}

/** One page's picture, drawn small and kept. Used by the sidebar and the organise view. */
export const Thumb = memo(function Thumb({ pages, queue, page, dpr, box }: { pages: PageSources; queue: RenderQueue; page: Page; dpr: number; box?: { width: number; height: number } }) {
  const holder = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const key = pages.key(page);
  const rotation = normRotation(page.rotate);
  const size = thumbSize(page, box);
  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    let cache = caches.get(pages);
    if (!cache) caches.set(pages, (cache = new Map()));
    const id = `${page.id}|${key}|${rotation}|${size.width}x${size.height}|${dpr}`;
    const cached = cache.get(id);
    host.replaceChildren();
    setReady(false);
    if (cached) {
      cache.delete(id);
      cache.set(id, cached);
      host.append(cached);
      setReady(true);
      return;
    }
    const lease = pages.acquire(page);
    const job = queue.add(100, async (signal) => {
      const rendered = await lease.promise;
      const canvas = document.createElement("canvas");
      await rendered.render({ canvas, scale: canvasScale(page.width, page.height, size.scale, dpr).scale, rotation, signal });
      if (signal.aborted) return;
      canvas.className = "pli-pdf-canvas";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      cache!.set(id, canvas);
      if (cache!.size > MAX_CACHED) cache!.delete(cache!.keys().next().value!);
      host.replaceChildren(canvas);
      setReady(true);
    });
    return () => {
      job.cancel();
      lease.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, queue, key, rotation, size.width, size.height, dpr]);
  return (
    <div className="pli-pdf-thumb-page" style={{ width: size.width, height: size.height }} data-ready={ready ? "" : undefined} data-blank={page.from ? undefined : ""} data-rotation={rotation}>
      <div ref={holder} className="pli-pdf-canvas-holder" />
      {!page.from && <span className="pli-pdf-thumb-blank">Blank</span>}
    </div>
  );
});

export interface ThumbnailsProps {
  pages: PageSources;
  queue: RenderQueue;
  list: readonly Page[];
  /** Position of the page shown. */
  current: number;
  /** Pages selected (the page shown counts when fewer than two are). */
  selected: readonly string[];
  onGo: (index: number) => void;
  onSelect: (ids: string[]) => void;
  dpr?: number;
  /** The height to use where the browser reports none (tests). */
  height?: number;
  className?: string;
  /** The page tools: with them pages can be dragged to a new place, files dropped between them, and the page menu opened. */
  tools?: PageTools;
}

/** The pages down the left side: small pictures with numbers, click to go there, shift and ctrl/cmd to select several. */
export function Thumbnails({ pages, queue, list, current, selected, onGo, onSelect, dpr = 1, height = 600, className, tools }: ThumbnailsProps) {
  useStore(tools ?? NO_STORE);
  const editable = !!tools && !tools.readOnly;
  const ref = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height });
  const anchor = useRef<number>(current);

  const items = useMemo(() => {
    let top = PAD;
    return list.map((p) => {
      const size = thumbSize(p);
      const h = size.height + LABEL + 2 * 4;
      const item = { top, height: h };
      top += h + 6;
      return item;
    });
  }, [list]);
  const total = items.length ? items[items.length - 1]!.top + items[items.length - 1]!.height + PAD : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setScroll({ top: el.scrollTop, height: el.clientHeight || height });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    watcher?.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      watcher?.disconnect();
    };
  }, [height]);

  // Keep the page shown in view.
  useEffect(() => {
    const el = ref.current;
    const item = items[current];
    if (!el || !item) return;
    const h = el.clientHeight || height;
    if (item.top < el.scrollTop) el.scrollTop = Math.max(0, item.top - PAD);
    else if (item.top + item.height > el.scrollTop + h) el.scrollTop = item.top + item.height - h + PAD;
    setScroll({ top: el.scrollTop, height: h });
  }, [current, items, height]);

  const margin = scroll.height;
  const visible: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.top + it.height >= scroll.top - margin && it.top <= scroll.top + scroll.height + margin) visible.push(i);
  }
  const chosen = new Set(selected.length > 1 ? selected : list[current] ? [list[current]!.id] : []);

  const pick = (index: number, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const id = list[index]!.id;
    if (e.shiftKey) {
      const [lo, hi] = anchor.current < index ? [anchor.current, index] : [index, anchor.current];
      onSelect(list.slice(lo, hi + 1).map((p) => p.id));
      onGo(index);
      return;
    }
    anchor.current = index;
    if (e.metaKey || e.ctrlKey) {
      const has = chosen.has(id);
      const next = has ? [...chosen].filter((x) => x !== id) : [...chosen, id];
      onSelect(list.filter((p) => next.includes(p.id)).map((p) => p.id));
      if (!has) onGo(index);
      return;
    }
    onSelect([id]);
    onGo(index);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (tools) tools.selectAll();
      else onSelect(list.map((p) => p.id));
      return;
    }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      if (!tools) return;
      e.preventDefault();
      e.stopPropagation();
      const box = ref.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.getBoundingClientRect();
      setMenu({ x: (box?.left ?? 0) + 24, y: (box?.top ?? 0) + 24 });
      return;
    }
    if (tools && tools.handleListKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight" ? current + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? current - 1 : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "PageDown" ? current + 5 : e.key === "PageUp" ? current - 5 : null;
    if (to === null || e.altKey || mod) return;
    e.preventDefault();
    e.stopPropagation();
    pick(Math.max(0, Math.min(list.length - 1, to)), { shiftKey: e.shiftKey });
  };

  // ---- drag and drop: pages move, files are added ------------------------------------------------------------------

  /** The position (0 to the page count) a drop at this height would go to: before the thumbnail whose middle is below it. */
  const dropIndexAt = (clientY: number): number => {
    const el = ref.current;
    if (!el) return list.length;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    for (let i = 0; i < items.length; i++) if (y < items[i]!.top + items[i]!.height / 2) return i;
    return items.length;
  };
  const dragKind = (e: ReactDragEvent): "pages" | "files" | null => {
    if (!editable) return null;
    if (tools!.drag) return "pages";
    return Array.from(e.dataTransfer?.types ?? []).includes("Files") ? "files" : null;
  };
  const onDragOver = (e: ReactDragEvent) => {
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = kind === "pages" ? "move" : "copy";
    setDrop(dropIndexAt(e.clientY));
    // Near the top or bottom edge the list scrolls, so a far place can be reached.
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + 32) el.scrollTop = Math.max(0, el.scrollTop - 14);
      else if (e.clientY > r.bottom - 32 && r.bottom > 0) el.scrollTop += 14;
    }
  };
  const onDrop = (e: ReactDragEvent) => {
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    const at = dropIndexAt(e.clientY);
    setDrop(null);
    if (kind === "pages") {
      const ids = tools!.drag!.ids;
      tools!.endDrag();
      setDragging(null);
      tools!.moveBefore(ids, at);
    } else void tools!.insertFiles(Array.from(e.dataTransfer?.files ?? []), at);
  };
  const onDragStart = (e: ReactDragEvent, i: number) => {
    if (!editable) return;
    const id = list[i]!.id;
    const ids = chosen.has(id) ? list.filter((p) => chosen.has(p.id)).map((p) => p.id) : [id];
    if (!chosen.has(id)) onSelect([id]);
    tools!.startDrag(ids);
    setDragging(new Set(ids));
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("application/x-pli-pdf-pages", ids.join(","));
        e.dataTransfer.setData("text/plain", ids.length === 1 ? `Page ${i + 1}` : `${ids.length} pages`);
      } catch {
        // some browsers refuse a second type: the first is enough
      }
    }
  };
  const onDragEnd = () => {
    tools?.endDrag();
    setDragging(null);
    setDrop(null);
  };
  const dropTop = drop === null ? null : drop >= items.length ? (items.length ? items[items.length - 1]!.top + items[items.length - 1]!.height + 3 : PAD) : items[drop]!.top - 3;

  const onContextMenu = (e: ReactMouseEvent, i: number) => {
    if (!tools) return;
    e.preventDefault();
    const id = list[i]!.id;
    if (!chosen.has(id)) {
      anchor.current = i;
      onSelect([id]);
      onGo(i);
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        ref={ref}
        className={className ? `pli-pdf-thumbs ${className}` : "pli-pdf-thumbs"}
        role="listbox"
        aria-label="Pages"
        aria-multiselectable="true"
        aria-activedescendant={list[current] ? `pli-pdf-thumb-${list[current]!.id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={onDrop}
      >
        <div className="pli-pdf-thumbs-inner" style={{ height: total }}>
          {dropTop !== null && <div className="pli-pdf-drop-line" role="presentation" style={{ top: dropTop }} />}
          {visible.map((i) => {
            const page = list[i]!;
            const it = items[i]!;
            const label = page.label ?? String(i + 1);
            return (
              <div
                key={page.id}
                id={`pli-pdf-thumb-${page.id}`}
                role="option"
                className="pli-pdf-thumb"
                aria-label={`Page ${label}${page.from ? "" : ", blank"}`}
                aria-selected={chosen.has(page.id)}
                aria-current={i === current ? "page" : undefined}
                data-selected={chosen.has(page.id) ? "" : undefined}
                data-current={i === current ? "" : undefined}
                data-index={i}
                data-dragging={dragging?.has(page.id) ? "" : undefined}
                draggable={editable || undefined}
                style={{ top: it.top, height: it.height }}
                onClick={(e: ReactMouseEvent) => pick(i, e)}
                onContextMenu={(e) => onContextMenu(e, i)}
                onDragStart={(e) => onDragStart(e, i)}
                onDragEnd={onDragEnd}
              >
                <Thumb pages={pages} queue={queue} page={page} dpr={dpr} />
                <span className="pli-pdf-thumb-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
      {menu && tools && (
        <PageContextMenu
          tools={tools}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

