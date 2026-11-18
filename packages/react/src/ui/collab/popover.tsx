import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useThemeAttr } from "../../theme";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The element the panel hangs from. */
  anchor: RefObject<HTMLElement | null>;
  /** Accessible name of the panel. */
  label: string;
  /** Which edge of the anchor the panel lines up with. Default `start`. */
  align?: "start" | "end";
  /** `dialog` (the default) for a panel with controls in it, `menu` or `listbox` for a list. */
  role?: "dialog" | "menu" | "listbox";
  className?: string;
  children: ReactNode;
}

/**
 * A panel under any element. It has an opaque surface of its own (a background and text colour that do not depend on where
 * it is rendered), stays inside the window, closes on Escape or a click outside, and gives focus back to what opened it.
 */
export function Popover({ open, onClose, anchor, label, align = "start", role = "dialog", className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const position = () => {
      const a = anchor.current?.getBoundingClientRect();
      const box = ref.current?.getBoundingClientRect();
      if (!a || !box) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(align === "end" ? a.right - box.width : a.left, window.innerWidth - box.width - margin));
      const below = a.bottom + 6;
      const top = below + box.height > window.innerHeight - margin && a.top - 6 - box.height > margin ? a.top - 6 - box.height : below;
      setPlace((old) => (old && old.top === top && old.left === left ? old : { top, left }));
    };
    position();
    const watcher = typeof ResizeObserver === "undefined" || !ref.current ? null : new ResizeObserver(position);
    if (watcher && ref.current) watcher.observe(ref.current);
    window.addEventListener("resize", position);
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [open, align, anchor]);

  useEffect(() => {
    if (!open) return;
    const opener = anchor.current;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !opener?.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        (opener as HTMLElement | null)?.focus?.();
      }
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    // Focus moves into the panel so the keyboard can reach it.
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, button, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose, anchor]);

  const themeAttr = useThemeAttr();
  if (!open) return null;
  return createPortal(
    <div
      id={id}
      ref={ref}
      role={role}
      aria-label={label}
      {...themeAttr}
      className={className ? `pli-surface pli-popover ${className}` : "pli-surface pli-popover"}
      style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
