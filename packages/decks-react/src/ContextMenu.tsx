import { useLayoutEffect, useRef, useState } from "react";
import { MenuList, useDismiss, type MenuEntry } from "@pli.dev/react";

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
  label: string;
}

/** A menu at the pointer (right click or long press). */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: menu.x, top: menu.y });
  useDismiss(true, onClose, ref);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(menu.x, window.innerWidth - box.width - margin));
    const top = Math.max(margin, Math.min(menu.y, window.innerHeight - box.height - margin));
    setPlace((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [menu.x, menu.y]);
  return (
    <div ref={ref} className="pli-panel pli-panel-fixed pli-deck-contextmenu" style={{ left: place.left, top: place.top }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} close={onClose} label={menu.label} />
    </div>
  );
}
