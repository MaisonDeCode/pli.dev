import type { ReactNode, Ref } from "react";
import { Bar, Dropdown, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import type { Zoom } from "./geometry";
import { PageNumberBox, ZoomDropdown } from "./StatusBar";
import type { ViewMode } from "./layout";
import type { PdfTool } from "./extensions";
import { CommandButton, type PdfCommands } from "./commands";
import { LAYOUTS } from "./chrome";
import { PdfIcons as I } from "./icons";
import { PROPERTIES_KEYS } from "./shortcuts";

export const VIEW_MODES = LAYOUTS;

export interface PdfToolbarProps {
  pageIndex: number;
  pageCount: number;
  /** Go to a page by position (the page box). */
  onGo: (index: number) => void;
  /** The page box's input, for "Go to page…". */
  pageInputRef?: Ref<HTMLInputElement>;
  zoom: Zoom;
  /** The zoom as a fraction (fit modes worked out). */
  zoomValue: number;
  onZoom: (zoom: Zoom) => void;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  /** What the toolbar's buttons do: undo, print, zoom, find, full screen... (see `buildCommands`). The same commands make the menus. */
  commands: PdfCommands;
  tools: readonly PdfTool[];
  tool: string | null;
  onTool: (id: string | null) => void;
  /** Extra controls from the host (annotation tools, page tools). */
  extra?: ReactNode;
  readOnly: boolean;
  /** [collaboration] Who is here and whether the shared document is saved, before the file group. */
  people?: ReactNode;
  /** [page tools] The document's name with the unsaved-changes dot, at the start of the bar. */
  title?: ReactNode;
  /** [page tools] The Save button (and, with no menu bar, the File menu), at the end of the bar. */
  file?: ReactNode;
  /** [page tools] Opens the organise pages view: an entry of the page layout menu. */
  onOrganise?: () => void;
  /** The properties panel: its button (shown when the viewer has a panel). `hint` says there is something to show while it is closed. */
  panel?: { open: boolean; hint: boolean; onToggle: () => void };
}

/** The buttons of the host's tools (`PdfTool`s that are not hidden): one pressed at a time. In the toolbar, or in a row of their own when there is no toolbar. */
export function ToolButtons({ tools, tool, onTool }: { tools: readonly PdfTool[]; tool: string | null; onTool: (id: string | null) => void }) {
  return (
    <>
      {tools.map((t) => (
        <button key={t.id} type="button" className="pli-tool pli-pdf-tool" aria-label={t.label} title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label} aria-pressed={tool === t.id} onMouseDown={keepFocus} onClick={() => onTool(tool === t.id ? null : t.id)}>
          {t.icon ?? t.label}
        </button>
      ))}
    </>
  );
}

/** The toolbar (`topToolbar`; off by default, the menu bar and the status bar have all of it): the sidebar, undo, page, zoom, view, find; then the host's tools and slot; then (with no menu bar) the name, people and file commands. */
export function PdfToolbar(p: PdfToolbarProps) {
  const c = p.commands;
  const button = (id: string) => (c[id] ? <CommandButton key={id} command={c[id]!} /> : null);
  const viewItems: MenuEntry[] = [
    ...VIEW_MODES.map((m) => ({ label: m.label, checked: p.viewMode === m.id, onSelect: () => p.onViewMode(m.id) })),
    ...(p.panel || p.onOrganise ? (["separator"] as MenuEntry[]) : []),
    ...(p.panel ? ([{ label: "Properties panel", checked: p.panel.open, onSelect: p.panel.onToggle }] as MenuEntry[]) : []),
    ...(p.onOrganise ? ([{ label: "Organise pages", onSelect: p.onOrganise }] as MenuEntry[]) : []),
  ];
  const mode = VIEW_MODES.find((m) => m.id === p.viewMode)!;
  const visibleTools = p.tools.filter((t) => !t.hidden && !(p.readOnly && t.needsEdit !== false));

  return (
    <Bar className="pli-pdf-toolbar" aria-label="PDF toolbar">
      <div className="pli-group" data-group="sidebar">
        {button("sidebar")}
        {p.title}
      </div>
      {!p.readOnly && (
        <div className="pli-group" data-group="history">
          {button("undo")}
          {button("redo")}
        </div>
      )}
      <div className="pli-group" data-group="print">
        {button("print")}
      </div>
      <div className="pli-group" data-group="page">
        {button("go.previous")}
        {button("go.next")}
        <PageNumberBox pageIndex={p.pageIndex} pageCount={p.pageCount} onGo={p.onGo} inputRef={p.pageInputRef} />
      </div>
      <div className="pli-group" data-group="zoom">
        {button("zoomOut")}
        <ZoomDropdown zoom={p.zoom} zoomValue={p.zoomValue} onZoom={p.onZoom} />
        {button("zoomIn")}
        {button("fit")}
      </div>
      <div className="pli-group" data-group="view">
        <Dropdown label="Page layout" panel={(close) => <MenuList label="Page layout" items={viewItems} close={close} />}>
          {mode.icon}
        </Dropdown>
        {button("rotate")}
        {button("find")}
        {button("fullscreen")}
        {p.panel && (
          <button type="button" className="pli-tool pli-pdf-tool pli-pdf-props-toggle" aria-label="Properties" title={`Properties (${PROPERTIES_KEYS})`} aria-pressed={p.panel.open} aria-keyshortcuts="Alt+Shift+P" data-hint={p.panel.hint && !p.panel.open ? "" : undefined} onMouseDown={keepFocus} onClick={p.panel.onToggle}>
            {I.properties}
          </button>
        )}
      </div>
      {visibleTools.length > 0 && (
        <div className="pli-group" data-group="tools" role="group" aria-label="Tools">
          <ToolButtons tools={visibleTools} tool={p.tool} onTool={p.onTool} />
        </div>
      )}
      {p.extra && (
        <div className="pli-group" data-group="extra">
          {p.extra}
        </div>
      )}
      {p.people && (
        <div className="pli-group pli-group-end pli-pdf-people" data-group="people">
          {p.people}
        </div>
      )}
      {p.file && (
        <div className="pli-group pli-group-end" data-group="file">
          {p.file}
        </div>
      )}
    </Bar>
  );
}
