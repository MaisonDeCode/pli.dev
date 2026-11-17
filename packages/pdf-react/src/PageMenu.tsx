import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bar, Dropdown, MenuList, keepFocus, useDismiss, type MenuEntry } from "@pli.dev/react";
import { MOD } from "./shortcuts";
import type { PageTools } from "./pageTools";
import { PageIcons as P } from "./pageIcons";
import { useStore, type Notices } from "./store";

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The page menu (right click, the "more" button of the page tools): what can be done to the selected pages. */
export function pageMenuItems(tools: PageTools): MenuEntry[] {
  const ids = tools.selected();
  const n = ids.length;
  const pages = plural(n, "page");
  const open = (type: "extract" | "split" | "labels" | "move") => () => tools.openDialog({ type });
  const extract: MenuEntry = { label: n > 1 ? `Extract ${n} pages…` : "Extract page…", onSelect: open("extract") };
  if (tools.readOnly) return [extract, { label: "Split document…", onSelect: open("split") }, "separator", { label: "Select all pages", onSelect: () => tools.selectAll() }];
  return [
    { label: "Turn clockwise", shortcut: `${MOD}Shift+R`, onSelect: () => tools.rotate(90) },
    { label: "Turn anticlockwise", shortcut: `${MOD}Shift+L`, onSelect: () => tools.rotate(-90) },
    "separator",
    { label: `Duplicate ${pages}`, shortcut: `${MOD}D`, onSelect: () => tools.duplicate() },
    { label: "Insert blank page before", onSelect: () => tools.insertBlank("before") },
    { label: "Insert blank page after", shortcut: "Insert", onSelect: () => tools.insertBlank("after") },
    { label: "Insert pages from file…", onSelect: () => void tools.chooseAndInsert(tools.pages.findIndex((p) => p.id === ids[ids.length - 1]) + 1) },
    "separator",
    { label: `Move ${pages} to…`, onSelect: open("move") },
    extract,
    { label: "Split document…", onSelect: open("split") },
    { label: "Page labels…", onSelect: open("labels") },
    "separator",
    { label: "Select all pages", shortcut: `${MOD}A`, onSelect: () => tools.selectAll() },
    { label: `Delete ${pages}…`, shortcut: "Delete", onSelect: () => tools.requestRemove() },
  ];
}

/** A menu opened at a point (a right click or the menu key). It closes on Escape and when you click elsewhere. */
export function PageContextMenu({ tools, x, y, onClose }: { tools: PageTools; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useDismiss(true, onClose, ref);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    setAt({
      x: Math.max(margin, Math.min(x, (window.innerWidth || 1024) - box.width - margin)),
      y: Math.max(margin, Math.min(y, (window.innerHeight || 768) - box.height - margin)),
    });
    el.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  return (
    <div ref={ref} className="pli-panel pli-pdf-ctx" style={{ left: at.x, top: at.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList label="Page menu" items={pageMenuItems(tools)} close={onClose} />
    </div>
  );
}

const Button = ({ label, icon, onClick, disabled, shortcut }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; shortcut?: string }) => (
  <button type="button" className="pli-tool pli-pdf-tool" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} disabled={disabled} onMouseDown={keepFocus} onClick={onClick}>
    {icon}
  </button>
);

/** The page tools above the thumbnails: turn, delete, duplicate, insert, and a menu with the rest. They work on the selected pages. */
export function PageToolbar({ tools, organise = true }: { tools: PageTools; organise?: boolean }) {
  useStore(tools);
  const ids = tools.selected();
  const n = ids.length;
  const readOnly = tools.readOnly;
  return (
    <Bar className="pli-pdf-pagebar" aria-label="Page tools">
      {n > 1 && (
        <span className="pli-pdf-pagebar-count" aria-live="polite">
          {n} selected
        </span>
      )}
      {!readOnly && (
        <>
          <Button label="Turn pages anticlockwise" icon={P.rotateLeft} onClick={() => tools.rotate(-90)} shortcut={`${MOD}Shift+L`} />
          <Button label="Turn pages clockwise" icon={P.rotateRight} onClick={() => tools.rotate(90)} shortcut={`${MOD}Shift+R`} />
          <Button label="Delete pages" icon={P.trash} onClick={() => tools.requestRemove()} disabled={n >= tools.pages.length} shortcut="Delete" />
          <Button label="Duplicate pages" icon={P.duplicate} onClick={() => tools.duplicate()} shortcut={`${MOD}D`} />
          <Button label="Insert a blank page after" icon={P.insertBlank} onClick={() => tools.insertBlank("after")} shortcut="Insert" />
        </>
      )}
      {organise && <Button label="Organise pages" icon={P.grid} onClick={() => tools.setOrganise(true)} />}
      <Dropdown label="More page tools" align="end" panel={(close) => <MenuList label="More page tools" items={pageMenuItems(tools)} close={close} />}>
        {P.more}
      </Dropdown>
    </Bar>
  );
}

/** The toast (short message with Undo) and the live region screen readers hear. */
export function Toasts({ notices }: { notices: Notices }) {
  useStore(notices);
  const t = notices.toast;
  return (
    <>
      <div className="pli-pdf-announce" role="status" aria-live="polite" aria-atomic="true">
        {notices.live}
      </div>
      {t && (
        <div key={t.id} className="pli-pdf-toasts">
          <div className="pli-pdf-toast" role={t.kind === "error" ? "alert" : "group"} aria-label={t.kind === "error" ? "Error" : "Notice"} data-kind={t.kind}>
            <span className="pli-pdf-toast-text">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="pli-pdf-toast-action"
                onClick={() => {
                  notices.dismiss();
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="pli-pdf-toast-close" aria-label="Dismiss" onClick={() => notices.dismiss()}>
              {P.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
