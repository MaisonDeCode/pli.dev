/**
 * The organise view: every page as a big thumbnail on a grid, over the document. Select pages (click, shift, ctrl/cmd), drag
 * them to a new place, turn, delete or add a page from the buttons that appear on a thumbnail, and drop PDF or picture
 * files between pages to add them there.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { Page } from "@pli.dev/pdf";
import { keepFocus } from "@pli.dev/react";
import { useElementBox } from "./hooks";
import type { PageSources } from "./engine";
import type { RenderQueue } from "./renderQueue";
import { Thumb, thumbSize } from "./Thumbnails";
import { PageContextMenu, PageToolbar } from "./PageMenu";
import { PageIcons as P } from "./pageIcons";
import type { PageTools } from "./pageTools";
import { useStore } from "./store";

const PAD = 20;
const GAP = 16;
const LABEL = 30;
const FALLBACK = { width: 900, height: 600 };

export interface OrganiseGridProps {
  tools: PageTools;
  pages: PageSources;
  queue: RenderQueue;
  list: readonly Page[];
  /** Position of the page shown. */
  current: number;
  /** Pages selected (the page shown counts when fewer than two are). */
  selected: readonly string[];
  onGo: (index: number) => void;
  onSelect: (ids: string[]) => void;
  /** Leave the organise view (Done, Escape, Enter or a double click on a page, which then goes to it). */
  onClose: (goTo?: number) => void;
  dpr?: number;
  /** The thumbnail width to start with, in CSS pixels. */
  size?: number;
}

/** The organise pages view. */
export function OrganiseGrid({ tools, pages, queue, list, current, selected, onGo, onSelect, onClose, dpr = 1, size: startSize = 150 }: OrganiseGridProps) {
  useStore(tools);
  const editable = !tools.readOnly;
  const body = useRef<HTMLDivElement>(null);
  const box = useElementBox(body, FALLBACK);
  const [size, setSize] = useState(startSize);
  const [scroll, setScroll] = useState({ top: 0 });
  const [drop, setDrop] = useState<number | null>(null);
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** Taps add and take away pages (for a screen with no Ctrl key). */
  const [selecting, setSelecting] = useState(false);
  const anchor = useRef(current);

  const thumbBox = useMemo(() => ({ width: size, height: Math.round(size * 1.4) }), [size]);
  const cellW = size + 16;
  const cellH = thumbBox.height + LABEL + 16;
  const cols = Math.max(1, Math.floor((box.width - 2 * PAD + GAP) / (cellW + GAP)));
  const rows = Math.ceil(list.length / cols);
  const left0 = Math.max(PAD, (box.width - (cols * (cellW + GAP) - GAP)) / 2);
  const rowH = cellH + GAP;
  const total = PAD * 2 + rows * rowH - (rows ? GAP : 0);
  const chosen = useMemo(() => new Set(selected.length > 1 ? selected : list[current] ? [list[current]!.id] : []), [selected, list, current]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => setScroll({ top: el.scrollTop });
    el.addEventListener("scroll", read, { passive: true });
    return () => el.removeEventListener("scroll", read);
  }, []);

  // Keep the page shown in view.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || list.length === 0) return;
    const top = PAD + Math.floor(current / cols) * rowH;
    const h = el.clientHeight || box.height;
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - PAD);
    else if (top + cellH > el.scrollTop + h) el.scrollTop = top + cellH - h + PAD;
    setScroll({ top: el.scrollTop });
  }, [current, cols, rowH, cellH, list.length, box.height]);

  // After a keyboard move the focus follows the page shown.
  const focusWanted = useRef(false);
  useEffect(() => {
    if (!focusWanted.current) return;
    focusWanted.current = false;
    body.current?.querySelector<HTMLElement>(`[data-index="${current}"] .pli-pdf-cell-page`)?.focus();
  });
  // Take the focus when the view opens.
  useEffect(() => {
    body.current?.querySelector<HTMLElement>(`[data-index="${current}"] .pli-pdf-cell-page`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = box.height;
  const first = Math.max(0, Math.floor((scroll.top - view - PAD) / rowH));
  const last = Math.min(rows - 1, Math.ceil((scroll.top + 2 * view) / rowH));
  const visible: number[] = [];
  for (let r = first; r <= last; r++) for (let c = 0; c < cols; c++) if (r * cols + c < list.length) visible.push(r * cols + c);

  const pick = (index: number, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const id = list[index]!.id;
    if (e.shiftKey) {
      const [lo, hi] = anchor.current < index ? [anchor.current, index] : [index, anchor.current];
      onSelect(list.slice(lo, hi + 1).map((p) => p.id));
      onGo(index);
      return;
    }
    anchor.current = index;
    if (selecting || e.metaKey || e.ctrlKey) {
      const has = chosen.has(id);
      const next = has ? [...chosen].filter((x) => x !== id) : [...chosen, id];
      onSelect(list.filter((p) => next.includes(p.id)).map((p) => p.id));
      if (!has) onGo(index);
      return;
    }
    onSelect([id]);
    onGo(index);
  };

  /** The pages a button on one thumbnail works on: the selection when the page is in it, else just that page. */
  const idsFor = (i: number): string[] => (chosen.has(list[i]!.id) ? list.filter((p) => chosen.has(p.id)).map((p) => p.id) : [list[i]!.id]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (menu) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (isField(e.target)) return;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      tools.selectAll();
      return;
    }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = body.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.getBoundingClientRect();
      setMenu({ x: (r?.left ?? 0) + 24, y: (r?.top ?? 0) + 24 });
      return;
    }
    if (tools.handleListKey(e, cols)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const page = Math.max(1, Math.floor(view / rowH)) * cols;
    const to =
      e.key === "ArrowRight" ? current + 1 : e.key === "ArrowLeft" ? current - 1 : e.key === "ArrowDown" ? current + cols : e.key === "ArrowUp" ? current - cols : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "PageDown" ? current + page : e.key === "PageUp" ? current - page : null;
    if (to !== null && !e.altKey && !mod) {
      e.preventDefault();
      e.stopPropagation();
      focusWanted.current = true;
      pick(Math.max(0, Math.min(list.length - 1, to)), { shiftKey: e.shiftKey });
      return;
    }
    if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.classList.contains("pli-pdf-cell-page")) {
      e.preventDefault();
      e.stopPropagation();
      onClose(current);
    }
  };

  // ---- drag and drop ------------------------------------------------------------------------------------------------

  /** The position (0 to the page count) a drop at this point goes to: before the thumbnail under it, or after it when the point is in its right half. */
  const dropIndexAt = (clientX: number, clientY: number): number => {
    const el = body.current;
    if (!el || list.length === 0) return 0;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left + el.scrollLeft;
    const y = clientY - r.top + el.scrollTop;
    const row = Math.max(0, Math.min(rows - 1, Math.floor((y - PAD) / rowH)));
    const rel = x - left0;
    const col = Math.max(0, Math.min(cols - 1, Math.floor(rel / (cellW + GAP))));
    const after = (rel - col * (cellW + GAP)) / cellW > 0.5 ? 1 : 0;
    return Math.max(0, Math.min(list.length, row * cols + col + after));
  };
  const kindOf = (e: ReactDragEvent): "pages" | "files" | null => {
    if (!editable) return null;
    if (tools.drag) return "pages";
    return Array.from(e.dataTransfer?.types ?? []).includes("Files") ? "files" : null;
  };
  const onDragOver = (e: ReactDragEvent) => {
    const kind = kindOf(e);
    if (!kind) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = kind === "pages" ? "move" : "copy";
    setDrop(dropIndexAt(e.clientX, e.clientY));
    const el = body.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + 40) el.scrollTop = Math.max(0, el.scrollTop - 16);
      else if (e.clientY > r.bottom - 40 && r.bottom > 0) el.scrollTop += 16;
    }
  };
  const onDrop = (e: ReactDragEvent) => {
    const kind = kindOf(e);
    if (!kind) return;
    e.preventDefault();
    const at = dropIndexAt(e.clientX, e.clientY);
    setDrop(null);
    if (kind === "pages") {
      const ids = tools.drag!.ids;
      tools.endDrag();
      setDragging(null);
      tools.moveBefore(ids, at);
    } else void tools.insertFiles(Array.from(e.dataTransfer?.files ?? []), at);
  };
  const onDragStart = (e: ReactDragEvent, i: number) => {
    if (!editable) return;
    const ids = idsFor(i);
    if (!chosen.has(list[i]!.id)) onSelect([list[i]!.id]);
    tools.startDrag(ids);
    setDragging(new Set(ids));
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("application/x-pli-pdf-pages", ids.join(","));
        e.dataTransfer.setData("text/plain", ids.length === 1 ? `Page ${i + 1}` : `${ids.length} pages`);
      } catch {
        // the first type is enough
      }
    }
  };
  const onDragEnd = () => {
    tools.endDrag();
    setDragging(null);
    setDrop(null);
  };

  let line: { left: number; top: number } | null = null;
  if (drop !== null && list.length > 0) {
    const atEnd = drop >= list.length;
    const idx = atEnd ? list.length - 1 : drop;
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    line = { left: left0 + col * (cellW + GAP) + (atEnd ? cellW + GAP / 2 : -GAP / 2), top: PAD + row * rowH };
  }

  return (
    <div className="pli-pdf-organise" role="dialog" aria-modal="false" aria-label="Organise pages" onKeyDown={onKeyDown}>
      <div className="pli-pdf-organise-head">
        <h2 className="pli-pdf-organise-title">Organise pages</h2>
        <PageToolbar tools={tools} organise={false} />
        {editable && (
          <button type="button" className="pli-button pli-pdf-organise-select" aria-pressed={selecting} onClick={() => setSelecting((v) => !v)}>
            Select pages
          </button>
        )}
        <label className="pli-pdf-organise-size">
          <span>Size</span>
          <input type="range" min={90} max={320} step={10} value={size} aria-label="Thumbnail size" onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <button type="button" className="pli-button pli-button-primary pli-pdf-organise-done" onClick={() => onClose()}>
          Done
        </button>
      </div>
      <div
        ref={body}
        className="pli-pdf-organise-body"
        data-select-mode={selecting ? "" : undefined}
        role="group"
        aria-label="Pages"
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={onDrop}
      >
        <div className="pli-pdf-organise-inner" style={{ height: total }}>
          {line && <div className="pli-pdf-drop-line pli-pdf-drop-line-v" role="presentation" style={{ left: line.left, top: line.top, height: cellH }} />}
          {visible.map((i) => {
            const page = list[i]!;
            const label = page.label ?? String(i + 1);
            const sel = chosen.has(page.id);
            const row = Math.floor(i / cols);
            const col = i % cols;
            return (
              <div
                key={page.id}
                className="pli-pdf-cell"
                data-index={i}
                data-selected={sel ? "" : undefined}
                data-current={i === current ? "" : undefined}
                data-dragging={dragging?.has(page.id) ? "" : undefined}
                draggable={editable || undefined}
                style={{ left: left0 + col * (cellW + GAP), top: PAD + row * rowH, width: cellW, height: cellH }}
                onDragStart={(e) => onDragStart(e, i)}
                onDragEnd={onDragEnd}
                onContextMenu={(e: ReactMouseEvent) => {
                  e.preventDefault();
                  if (!sel) {
                    anchor.current = i;
                    onSelect([page.id]);
                    onGo(i);
                  }
                  setMenu({ x: e.clientX, y: e.clientY });
                }}
              >
                <button
                  type="button"
                  className="pli-pdf-cell-page"
                  aria-label={`Page ${label}${page.from ? "" : ", blank"}`}
                  aria-pressed={sel}
                  aria-current={i === current ? "page" : undefined}
                  tabIndex={i === current ? 0 : -1}
                  onClick={(e) => pick(i, e)}
                  onDoubleClick={() => onClose(i)}
                >
                  <Thumb pages={pages} queue={queue} page={page} dpr={dpr} box={thumbBox} />
                  <span className="pli-pdf-thumb-label">{label}</span>
                </button>
                {editable && (
                  <div className="pli-pdf-cell-actions" role="group" aria-label={`Page ${label} tools`}>
                    <button type="button" className="pli-tool" aria-label={`Turn page ${label} anticlockwise`} title="Turn anticlockwise" onMouseDown={keepFocus} onClick={() => tools.rotate(-90, idsFor(i))}>
                      {P.rotateLeft}
                    </button>
                    <button type="button" className="pli-tool" aria-label={`Turn page ${label} clockwise`} title="Turn clockwise" onMouseDown={keepFocus} onClick={() => tools.rotate(90, idsFor(i))}>
                      {P.rotateRight}
                    </button>
                    <button type="button" className="pli-tool" aria-label={`Insert a blank page after page ${label}`} title="Insert a blank page after" onMouseDown={keepFocus} onClick={() => tools.insertBlank("after", [page.id])}>
                      {P.insertBlank}
                    </button>
                    <button type="button" className="pli-tool" aria-label={`Delete page ${label}`} title="Delete" onMouseDown={keepFocus} onClick={() => tools.requestRemove(idsFor(i))}>
                      {P.trash}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <PageContextMenu
          tools={tools}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            focusWanted.current = true;
          }}
        />
      )}
    </div>
  );
}

const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
