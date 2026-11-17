import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MenuList, keepFocus, useDismiss, type MenuEntry } from "./primitives";

export interface MenuDefinition {
  label: string;
  items: MenuEntry[];
}

/** The File / Edit / View / Insert / Format row. Opening one and hovering another switches menus. */
export function MenuBar({ menus, className }: { menus: MenuDefinition[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open !== null, () => setOpen(null), ref);

  const onKey = (event: ReactKeyboardEvent) => {
    if (open === null) return;
    if (event.key === "ArrowRight") setOpen((open + 1) % menus.length);
    else if (event.key === "ArrowLeft") setOpen((open - 1 + menus.length) % menus.length);
    else return;
    event.preventDefault();
  };

  return (
    <div className={className ? `pli-menubar ${className}` : "pli-menubar"} role="menubar" aria-label="Document menu" ref={ref} onKeyDown={onKey}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="pli-menubar-item">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className="pli-menubar-button"
            onMouseDown={keepFocus}
            onMouseEnter={() => open !== null && setOpen(i)}
            onClick={() => setOpen(open === i ? null : i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="pli-panel pli-panel-start pli-menu-panel">
              <MenuList items={menu.items} close={() => setOpen(null)} label={menu.label} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
