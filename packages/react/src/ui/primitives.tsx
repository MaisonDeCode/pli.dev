import { createPortal } from "react-dom";
import { useThemeAttr } from "../theme";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

/** Keeps the editor's focus and selection when a control is clicked. */
export const keepFocus = (event: ReactMouseEvent) => event.preventDefault();

export function useDismiss(open: boolean, onDismiss: () => void, ref: React.RefObject<HTMLElement | null>, also?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target) && !also?.current?.contains(target)) onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onDismiss, ref, also]);
}

export interface DropdownProps {
  /** Accessible name. */
  label: string;
  /** What the button shows. */
  children: ReactNode;
  /** The panel; receives a function that closes it. */
  panel: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  /** Where the panel's edge lines up with the button. */
  align?: "start" | "end";
}

/**
 * A button that opens a panel under it. Clicking it never takes focus from the editor. The panel is
 * placed with `position: fixed`, so a toolbar that scrolls or clips its content doesn't clip the panel.
 */
export function Dropdown({ label, children, panel, className, disabled, align = "start" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, ref, panelRef);

  // Put the panel under the button, kept inside the window, or above it if there is no room below. It is put
  // again when it changes size (a submenu unfolding), so it never ends up past an edge.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const position = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      const box = panelRef.current?.getBoundingClientRect();
      if (!button || !box) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(align === "end" ? button.right - box.width : button.left, window.innerWidth - box.width - margin));
      const below = button.bottom + 4;
      const top = below + box.height > window.innerHeight - margin && button.top - 4 - box.height > margin ? button.top - 4 - box.height : below;
      setPlace((old) => (old && old.top === top && old.left === left ? old : { top, left }));
    };
    position();
    const watcher = typeof ResizeObserver === "undefined" || !panelRef.current ? null : new ResizeObserver(position);
    if (watcher && panelRef.current) watcher.observe(panelRef.current);
    return () => watcher?.disconnect();
  }, [open, align]);

  // Scrolling the page or toolbar would leave the panel behind, so close it.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const themeAttr = useThemeAttr();
  return (
    <div className="pli-dropdown" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={className ? `pli-tool ${className}` : "pli-tool"}
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panelRef}
            className="pli-panel pli-panel-fixed"
            {...themeAttr}
            style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}
            onMouseDown={(e) => {
              // Let text fields inside the panel take focus; everything else keeps the editor's.
              if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault();
            }}
          >
            {panel(close)}
          </div>,
          // Inside the editor's root, so its colors apply, but outside any page that is scaled with a transform,
          // which would move a fixed panel.
          buttonRef.current?.closest<HTMLElement>(".pli-document, .pli-spreadsheet, .pli-toolbar, .pli-deck") ?? document.body,
        )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  /** Shortcut hint, such as "Ctrl+B". */
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shows a check mark. */
  checked?: boolean;
  /** Nested items open as a submenu. */
  items?: MenuEntry[];
}
export type MenuEntry = MenuItem | "separator";

/**
 * The panel of a nested menu. It opens to the right of its item; if there isn't room it opens to the left, and if
 * there isn't room on either side (a phone) it unfolds under the item instead. It is also moved up if it would run
 * off the bottom of the window, and scrolls if it is taller than the window.
 */
function Submenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ inline?: boolean; side?: "left"; up?: number; maxHeight?: number }>({});

  useLayoutEffect(() => {
    const el = ref.current;
    const item = el?.parentElement;
    if (!el || !item) return;
    const margin = 8;
    const box = el.getBoundingClientRect();
    const anchor = item.getBoundingClientRect();
    const narrow = window.matchMedia?.("(max-width: 640px)").matches;
    if (narrow) return setPlacement({ inline: true });
    let side: "left" | undefined;
    if (box.right > window.innerWidth - margin) {
      // Left of the item, if that fits; otherwise under it.
      if (anchor.left + 4 - box.width >= margin) side = "left";
      else return setPlacement({ inline: true });
    }
    const room = window.innerHeight - 2 * margin;
    const maxHeight = box.height > room ? room : undefined;
    const height = maxHeight ?? box.height;
    const overflow = box.top + height - (window.innerHeight - margin);
    // Move up by what runs off the bottom, but not above the top of the window.
    const up = overflow > 0 ? Math.min(overflow, Math.max(0, box.top - margin)) : 0;
    setPlacement({ side, up: up || undefined, maxHeight });
  }, []);

  const style: CSSProperties | undefined = placement.inline
    ? undefined
    : {
        ...(placement.side === "left" ? { left: "auto", right: "calc(100% - 4px)" } : {}),
        ...(placement.up ? { top: `calc(-0.35rem - ${placement.up}px)` } : {}),
        ...(placement.maxHeight ? { maxHeight: placement.maxHeight, overflowY: "auto" as const } : {}),
      };
  return (
    <div ref={ref} className={placement.inline ? "pli-panel pli-submenu pli-submenu-inline" : "pli-panel pli-submenu"} style={style}>
      {children}
    </div>
  );
}

/** A vertical list of actions. */
export function MenuList({ items, close, label }: { items: MenuEntry[]; close: () => void; label: string }) {
  const [sub, setSub] = useState<number | null>(null);
  const onKey = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > li > button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
    else if (event.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    else return;
    event.preventDefault();
  };

  return (
    <ul role="menu" aria-label={label} className="pli-menu-list" onKeyDown={onKey}>
      {items.map((entry, i) =>
        entry === "separator" ? (
          <li key={i} role="separator" className="pli-menu-separator" />
        ) : (
          <li key={entry.label} role="none" className="pli-menu-item-wrap" onMouseEnter={() => setSub(entry.items ? i : null)}>
            <button
              type="button"
              role={entry.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={entry.checked}
              aria-haspopup={entry.items ? "menu" : undefined}
              aria-expanded={entry.items ? sub === i : undefined}
              className="pli-menu-item"
              disabled={entry.disabled}
              onMouseDown={keepFocus}
              onClick={() => {
                if (entry.items) {
                  setSub(sub === i ? null : i);
                  return;
                }
                close();
                entry.onSelect?.();
              }}
            >
              <span className="pli-menu-check" aria-hidden="true">{entry.checked ? "✓" : ""}</span>
              <span className="pli-menu-label">{entry.label}</span>
              {entry.shortcut && <span className="pli-menu-shortcut">{entry.shortcut}</span>}
              {entry.items && <span className="pli-menu-arrow" aria-hidden="true">›</span>}
            </button>
            {entry.items && sub === i && (
              <Submenu>
                <MenuList items={entry.items} close={close} label={entry.label} />
              </Submenu>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons. */
  actions: ReactNode;
  /** Called when the form is submitted (Enter or the primary action). */
  onSubmit?: () => void;
}

/** A modal dialog on the platform's `<dialog>`, which handles focus trapping and Escape. */
export function Dialog({ open, title, onClose, children, actions, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const themeAttr = useThemeAttr();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="pli-dialog" {...themeAttr} aria-labelledby={titleId} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.();
          }}
        >
          <h2 id={titleId} className="pli-dialog-title">
            {title}
          </h2>
          <div className="pli-dialog-body">{children}</div>
          <div className="pli-dialog-actions">{actions}</div>
        </form>
      )}
    </dialog>
  );
}
