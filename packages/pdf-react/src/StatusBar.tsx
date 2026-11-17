import { useEffect, useRef, useState, type Ref } from "react";
import { Dropdown, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import { ZOOM_MENU, type Zoom } from "./geometry";
import { CommandButton, type PdfCommands } from "./commands";
import { PdfIcons as I } from "./icons";
import { PROPERTIES_KEYS } from "./shortcuts";

export interface PageNumberBoxProps {
  pageIndex: number;
  pageCount: number;
  /** Go to a page by position. */
  onGo: (index: number) => void;
  /** The input, so that "Go to page…" (menu, key) can put the cursor in it. */
  inputRef?: Ref<HTMLInputElement>;
}

/** The page box: type a page number and press Enter ("3"), with the number of pages after it ("/ 12"). Shared by the toolbar and the status bar. */
export function PageNumberBox(p: PageNumberBoxProps) {
  const [text, setText] = useState(String(p.pageIndex + 1));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(p.pageIndex + 1));
  }, [p.pageIndex, editing]);
  // Escape gives up: the blur that follows must not commit what was typed.
  const gaveUp = useRef(false);
  const commit = () => {
    setEditing(false);
    if (gaveUp.current) {
      gaveUp.current = false;
      setText(String(p.pageIndex + 1));
      return;
    }
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= 1) p.onGo(Math.min(p.pageCount, n) - 1);
    else setText(String(p.pageIndex + 1));
  };
  return (
    <label className="pli-pdf-page-input">
      <input
        ref={p.inputRef}
        type="text"
        inputMode="numeric"
        aria-label="Page number"
        title="Go to page"
        value={text}
        disabled={p.pageCount === 0}
        size={Math.max(2, String(p.pageCount).length)}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            gaveUp.current = true;
            setEditing(false);
            setText(String(p.pageIndex + 1));
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />
      <span className="pli-pdf-page-total" aria-label={`of ${p.pageCount}`}>
        / {p.pageCount}
      </span>
    </label>
  );
}

/** The entries of the zoom menu: the usual percentages, then fit width, fit page and actual size. */
export function zoomEntries(zoom: Zoom, onZoom: (zoom: Zoom) => void): MenuEntry[] {
  return [
    ...ZOOM_MENU.map((z) => ({ label: `${z * 100}%`, checked: zoom === z, onSelect: () => onZoom(z) })),
    "separator",
    { label: "Fit width", checked: zoom === "fit-width", onSelect: () => onZoom("fit-width") },
    { label: "Fit page", checked: zoom === "fit-page", onSelect: () => onZoom("fit-page") },
    { label: "Actual size", checked: zoom === 1, onSelect: () => onZoom(1) },
  ];
}

/** The zoom drop-down: the zoom as a percentage; a click opens the zoom menu. */
export function ZoomDropdown({ zoom, zoomValue, onZoom }: { zoom: Zoom; zoomValue: number; onZoom: (zoom: Zoom) => void }) {
  return (
    <Dropdown label="Zoom" className="pli-pdf-zoom" panel={(close) => <MenuList label="Zoom" items={zoomEntries(zoom, onZoom)} close={close} />}>
      <span className="pli-pdf-zoom-label">
        {Math.round(zoomValue * 100)}% {I.chevron}
      </span>
    </Dropdown>
  );
}

export interface PdfStatusBarProps extends PageNumberBoxProps {
  zoom: Zoom;
  zoomValue: number;
  onZoom: (zoom: Zoom) => void;
  /** The viewer's commands (zoom in and out). */
  commands: PdfCommands;
  /** The properties panel's button, when the viewer has a panel. `hint`: there is something to show while it is closed. */
  panel?: { open: boolean; hint: boolean; onToggle: () => void };
}

/**
 * The status bar: a slim pill at the bottom of the pages, as in the viewers of Google Drive and Dropbox. The page the reader is on
 * ("1 / 12": click it and type a page) and the zoom (a drop-down with the usual sizes and the fit modes, with - and + beside it).
 * Everything else the old toolbar had is in the menus.
 */
export function PdfStatusBar(p: PdfStatusBarProps) {
  const c = p.commands;
  return (
    <div className="pli-pdf-statusbar" role="group" aria-label="Page and zoom">
      <PageNumberBox pageIndex={p.pageIndex} pageCount={p.pageCount} onGo={p.onGo} inputRef={p.inputRef} />
      <span className="pli-pdf-statusbar-sep" aria-hidden="true" />
      {c.zoomOut && <CommandButton command={c.zoomOut} />}
      <ZoomDropdown zoom={p.zoom} zoomValue={p.zoomValue} onZoom={p.onZoom} />
      {c.zoomIn && <CommandButton command={c.zoomIn} />}
      {p.panel && (
        <>
          <span className="pli-pdf-statusbar-sep" aria-hidden="true" />
          <button type="button" className="pli-tool pli-pdf-tool pli-pdf-props-toggle" aria-label="Properties" title={`Properties (${PROPERTIES_KEYS})`} aria-pressed={p.panel.open} aria-keyshortcuts="Alt+Shift+P" data-hint={p.panel.hint && !p.panel.open ? "" : undefined} onMouseDown={keepFocus} onClick={p.panel.onToggle}>
            {I.properties}
          </button>
        </>
      )}
    </div>
  );
}
