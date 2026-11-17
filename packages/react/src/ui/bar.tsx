import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Which sides of a bar have more to scroll to. */
export type BarOverflow = "none" | "start" | "end" | "both";

const EDGE = 4;
/** How much room is left between a control that was scrolled into view and the edge of the bar, in pixels. */
const MARGIN = 24;

/** The controls of a bar that take keys, in document order (not the ones inside an open menu). */
const controlsOf = (bar: HTMLElement): HTMLElement[] =>
  [...bar.querySelectorAll<HTMLElement>("button, [role=tab], [role=menuitem], a[href], input, select, textarea")].filter(
    (el) => !(el as HTMLButtonElement).disabled && !el.closest("[role=menu], [role=listbox], .pli-panel") && !(el instanceof HTMLInputElement && el.type === "hidden"),
  );

/** Scrolls `bar` sideways, if it must, so that `target` is inside it with a little room around. Does not move the page. */
export function scrollIntoBar(bar: HTMLElement, target: HTMLElement): void {
  const a = bar.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (a.width === 0 || b.width === 0) return;
  if (b.left < a.left + MARGIN) bar.scrollLeft -= a.left + MARGIN - b.left;
  else if (b.right > a.right - MARGIN) bar.scrollLeft += b.right - (a.right - MARGIN);
}

/**
 * What every Pli toolbar does when it is wider than the editor: it keeps one row and scrolls sideways (instead of wrapping onto
 * more rows and moving the pages down). The hook gives the bar
 *
 * - `data-overflow` (`none`, `start`, `end` or `both`), which the style sheet turns into fading edges on the sides that have more;
 * - the mouse wheel (a vertical turn scrolls the bar sideways while the pointer is over it) and a trackpad's sideways swipe;
 * - the arrow keys (Left and Right, Home and End move between the buttons, as in the WAI-ARIA toolbar pattern, which scrolls the
 *   button into view);
 * - a button that turns on (`aria-pressed="true"`: the tool just chosen) is scrolled into view.
 *
 * Menus and pickers of the bar are drawn outside it (`position: fixed` in the editor's root), so the scroll area never clips them.
 */
export function useBarScroll(ref: { current: HTMLElement | null }): BarOverflow {
  const [overflow, setOverflow] = useState<BarOverflow>("none");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const start = el.scrollLeft > EDGE;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE;
      const next: BarOverflow = start && end ? "both" : start ? "start" : end ? "end" : "none";
      setOverflow((old) => (old === next ? old : next));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(el);
    let frame: number | ReturnType<typeof setTimeout> = 0;
    // Controls that come and go (the tools that are on, the page the viewer is on) change the width without resizing the bar.
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            // Once a frame at most: typing turns the bold and italic buttons on and off on every key.
            if (!frame) frame = (typeof requestAnimationFrame === "undefined" ? (f: () => void) => setTimeout(f, 16) : requestAnimationFrame)(() => ((frame = 0), measure()));
            for (const r of records) {
              const t = r.target;
              if (r.type === "attributes" && t instanceof HTMLElement && t.getAttribute("aria-pressed") === "true" && el.scrollWidth > el.clientWidth) scrollIntoBar(el, t);
            }
          });
    mutations?.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    // The wheel: a vertical turn moves the bar sideways, unless the bar has nowhere to go that way (then the page scrolls as usual).
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (delta === 0) return;
      const before = el.scrollLeft;
      el.scrollLeft += delta;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const pressed = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (pressed && el.scrollWidth > el.clientWidth) scrollIntoBar(el, pressed);
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", wheel);
      resize?.disconnect();
      mutations?.disconnect();
      if (frame) typeof cancelAnimationFrame === "undefined" ? clearTimeout(frame as ReturnType<typeof setTimeout>) : cancelAnimationFrame(frame as number);
    };
  }, [ref]);

  return overflow;
}

/** Left and Right, Home and End move between the buttons of a bar. Returns true when it handled the key. */
export function barKey(bar: HTMLElement, e: { key: string; target: EventTarget | null; defaultPrevented: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): HTMLElement | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return null;
  const t = e.target;
  // A text box, a drop-down list or a picker panel keeps its own arrow keys.
  if (!(t instanceof HTMLElement) || !(t.closest("button, [role=tab], a[href]")) || t.closest("[role=menu], [role=listbox], .pli-panel, input, select, textarea") || t.isContentEditable) return null;
  const all = controlsOf(bar).filter((c) => !(c instanceof HTMLInputElement) && !(c instanceof HTMLSelectElement) && !(c instanceof HTMLTextAreaElement));
  const at = all.indexOf(t.closest<HTMLElement>("button, [role=tab], a[href]")!);
  if (at < 0) return null;
  const to = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : e.key === "ArrowRight" ? at + 1 : at - 1;
  const next = all[to];
  if (!next || next === all[at]) return null;
  next.focus();
  scrollIntoBar(bar, next);
  return next;
}

export type BarProps = HTMLAttributes<HTMLDivElement>;

/**
 * A bar of controls: the toolbar, the tools row and the text bar of the four Pli editors. One row; when it is wider than the
 * editor it scrolls sideways with fading edges (see `useBarScroll`). The look (the rounded pill, its border, margin and colours)
 * is in the style sheet, driven by `--pli-chrome-radius`, `--pli-bar-margin`, `--pli-bar-padding` and `--pli-bar-bg`.
 */
export const Bar = forwardRef<HTMLDivElement, BarProps>(function Bar({ className, role = "toolbar", onKeyDown, ...rest }, forwarded) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwarded, () => ref.current!, []);
  const overflow = useBarScroll(ref);
  const key = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (ref.current && barKey(ref.current, e)) {
        e.preventDefault();
        // A host that moves between pages with the arrow keys must not hear them as well.
        e.stopPropagation();
      }
    },
    [onKeyDown],
  );
  return <div {...rest} ref={ref} role={role} className={className ? `pli-toolbar ${className}` : "pli-toolbar"} data-overflow={overflow} onKeyDown={key} />;
});
