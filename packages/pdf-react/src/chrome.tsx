/**
 * The frame around the pages that the other Pli editors share: a title row (name, who is here, Comments, Share), a menu bar
 * (File, Edit, View, Insert, Format, Tools, Help) and, below it, the toolbar.
 *
 * `buildCommands` describes what the viewer itself can do (undo, zoom, find, print, download, full screen, theme, help...) once;
 * the toolbar buttons and the menu entries are both made from those commands. The annotation, form and edit kits describe
 * theirs the same way and add them to the menus through the `menus` prop of `PliPdf`.
 */
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { ShareButton } from "@pli.dev/react/collab";
import { MenuBar, extendMenus, keepFocus, type ExtraMenus, type MenuDefinition, type MenuEntry, type MenuLabels } from "@pli.dev/react";
import type { PdfSession } from "@pli.dev/pdf";
import { ZOOM_MENU, stepZoom, type Zoom } from "./geometry";
import type { ViewMode } from "./layout";
import { MENU_NAMES, commandItem, menuGroups, type PdfCommand, type PdfCommands, type PdfMenus } from "./commands";
import type { PdfViewContext } from "./extensions";
import { PdfIcons as I } from "./icons";
import type { PageToolsKit } from "./usePageTools";
import { FIT_PAGE_KEYS, FIT_WIDTH_KEYS, FULLSCREEN_KEYS, GOTO_KEYS, MOD, PROPERTIES_KEYS, ROTATE_VIEW_KEYS } from "./shortcuts";
import { useStore, type Store } from "./store";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const SHIFT = MAC ? "⇧" : "Shift+";

export type PdfTheme = "auto" | "light" | "dark";

/** What the commands need to know about the viewer. Built on every render of `PliPdf`. */
export interface ChromeDeps {
  session: PdfSession;
  readOnly: boolean;
  view: PdfViewContext;
  kit: PageToolsKit;
  /** The page tools, the File menu and bookmark editing are on. */
  pageToolsOn: boolean;
  /** Whether the host gave `onSave`. */
  canSave: boolean;
  find: { open: boolean; toggle(): void; replace(): void; canReplace: boolean };
  sidebar: { open: boolean; toggle(): void; shortcut: string };
  panel?: { open: boolean; toggle(): void };
  comments?: { open: boolean; toggle(): void; count: number };
  /** Version history (a `VersionHistory` was given): its tab. */
  history?: { open: boolean; toggle(): void };
  fullscreen: { on: boolean; available: boolean; toggle(): void };
  theme: { value: PdfTheme; set(theme: PdfTheme): void };
  dialogs: { shortcuts(): void; properties(): void; words(): void };
  onShare?: () => void;
  canGo(dir: 1 | -1): boolean;
  go(dir: 1 | -1): void;
  /** Puts the cursor in the page box ("Go to page…"). */
  goTo(): void;
  /** There is a page box to put it in (the status bar or the toolbar is shown). */
  canGoTo: boolean;
}

export const LAYOUTS: { id: ViewMode; label: string; icon: ReactNode }[] = [
  { id: "continuous", label: "Continuous", icon: I.continuous },
  { id: "single", label: "Single page", icon: I.single },
  { id: "spread", label: "Two pages", icon: I.spread },
];

/** What the viewer itself can do, by id. */
export function buildCommands(d: ChromeDeps): PdfCommands {
  const { session, readOnly, view, kit, pageToolsOn } = d;
  const files = kit.files;
  const out: PdfCommands = {};
  const add = (c: PdfCommand) => void (out[c.id] = c);
  const zoomed = view.zoomValue;

  add({ id: "undo", label: "Undo", icon: I.undo, shortcut: `${MOD}Z`, disabled: readOnly || !session.canUndo, run: () => kit.tools.undo() });
  add({ id: "redo", label: "Redo", icon: I.redo, shortcut: MAC ? `${SHIFT}${MOD}Z` : `${MOD}Y`, disabled: readOnly || !session.canRedo, run: () => kit.tools.redo() });
  add({ id: "print", label: "Print", icon: I.print, shortcut: `${MOD}P`, disabled: !pageToolsOn || (!files.canSave && !files.hooks.onPrint), run: () => void files.print() });

  add({ id: "save", label: "Save", icon: I.save, shortcut: `${MOD}S`, disabled: !d.canSave || readOnly || !session.dirty || !!files.busy, run: () => void files.save() });
  add({ id: "saveCopy", label: "Save a copy", shortcut: `${MOD}${SHIFT}S`, disabled: !pageToolsOn || !files.canSave, run: () => void files.saveCopy() });
  add({ id: "open", label: "Open PDF…", shortcut: `${MOD}O`, disabled: !files.canOpen, run: () => void files.chooseAndOpen() });
  add({ id: "create", label: "Create PDF from pictures…", disabled: !files.canOpen, run: () => void files.chooseAndCreate() });
  add({ id: "download.pdf", label: "PDF document (.pdf)", disabled: !files.canSave, run: () => void files.download("keep", { dialog: false }) });
  add({ id: "download.optimised", label: "Optimised PDF (.pdf)", disabled: !files.canSave, run: () => void files.download("optimise", { dialog: false, name: `${stem(files.name)}-optimised.pdf` }) });
  add({ id: "download.flattened", label: "Flattened PDF (.pdf)", disabled: !files.canSave, run: () => void files.download("flatten", { dialog: false, name: `${stem(files.name)}-flattened.pdf` }) });
  add({ id: "download.pictures", label: "Pages as pictures (.png, .jpg)…", disabled: !files.canSave, run: () => files.openDialog({ type: "export" }) });
  add({ id: "download.forms", label: "Form data (.json)", disabled: session.doc.fields.length === 0, run: () => void files.exportFormData() });
  add({ id: "download.more", label: "More download options…", disabled: !files.canSave, run: () => files.openDialog({ type: "download" }) });
  add({ id: "properties", label: "Document properties…", icon: I.info, run: d.dialogs.properties });
  add({ id: "words", label: "Word count…", run: d.dialogs.words });

  add({ id: "zoomOut", label: "Zoom out", icon: I.zoomOut, shortcut: `${MOD}-`, run: () => view.setZoom(stepTo(zoomed, -1)) });
  add({ id: "zoomIn", label: "Zoom in", icon: I.zoomIn, shortcut: `${MOD}+`, run: () => view.setZoom(stepTo(zoomed, 1)) });
  add({ id: "zoomActual", label: "Actual size", shortcut: `${MOD}0`, checked: view.zoom === 1, run: () => view.setZoom(1) });
  add({ id: "fitWidth", label: "Fit width", icon: I.fitWidth, shortcut: FIT_WIDTH_KEYS, checked: view.zoom === "fit-width", run: () => view.setZoom("fit-width") });
  add({ id: "fitPage", label: "Fit page", icon: I.fitPage, shortcut: FIT_PAGE_KEYS, checked: view.zoom === "fit-page", run: () => view.setZoom("fit-page") });
  // One button for both fit modes: it offers the one that is not on.
  add({ ...(view.zoom === "fit-width" ? out.fitPage! : out.fitWidth!), id: "fit", checked: undefined });
  for (const l of LAYOUTS) add({ id: `layout.${l.id}`, label: l.label, icon: l.icon, checked: view.viewMode === l.id, run: () => view.setViewMode(l.id) });
  add({ id: "rotate", label: "Rotate view", icon: I.rotateView, shortcut: ROTATE_VIEW_KEYS, run: () => view.rotateView(90) });
  add({ id: "find", label: "Find", icon: I.search, shortcut: `${MOD}F`, checked: d.find.open, run: d.find.toggle });
  add({ id: "replace", label: "Find and replace…", icon: I.replace, shortcut: `${MOD}H`, disabled: !d.find.canReplace, run: d.find.replace });
  add({ id: "sidebar", label: "Sidebar", icon: I.sidebar, shortcut: d.sidebar.shortcut, checked: d.sidebar.open, run: d.sidebar.toggle });
  if (d.panel) add({ id: "properties.panel", label: "Properties", icon: I.properties, shortcut: PROPERTIES_KEYS, checked: d.panel.open, run: d.panel.toggle });
  add({ id: "fullscreen", label: d.fullscreen.on ? "Exit full screen" : "Full screen", icon: d.fullscreen.on ? I.exitFullscreen : I.fullscreen, shortcut: FULLSCREEN_KEYS, disabled: !d.fullscreen.available, run: d.fullscreen.toggle });
  for (const [value, label] of [["auto", "Match the system"], ["light", "Light"], ["dark", "Dark"]] as const) add({ id: `theme.${value}`, label, checked: d.theme.value === value, run: () => d.theme.set(value) });
  add({ id: "shortcuts", label: "Keyboard shortcuts", icon: I.keyboard, shortcut: `${MOD}/`, run: d.dialogs.shortcuts });
  add({ id: "organise", label: "Organise pages…", icon: I.organise, disabled: !pageToolsOn || view.pageCount === 0, run: () => kit.tools.setOrganise(true) });
  add({ id: "insert.blank", label: "Blank page", disabled: !pageToolsOn || readOnly, run: () => kit.tools.insertBlank("after") });
  add({ id: "insert.pages", label: "Pages from a file…", disabled: !pageToolsOn || readOnly, run: () => void kit.tools.chooseAndInsert(view.pageIndex + 1) });
  add({ id: "go.to", label: "Go to page…", shortcut: GOTO_KEYS, disabled: view.pageCount === 0 || !d.canGoTo, run: d.goTo });
  add({ id: "go.first", label: "First page", shortcut: "Home", disabled: view.pageIndex <= 0, run: () => view.goToPage(0) });
  add({ id: "go.previous", label: "Previous page", icon: I.up, shortcut: "PageUp", disabled: !d.canGo(-1), run: () => d.go(-1) });
  add({ id: "go.next", label: "Next page", icon: I.down, shortcut: "PageDown", disabled: !d.canGo(1), run: () => d.go(1) });
  add({ id: "go.last", label: "Last page", shortcut: "End", disabled: view.pageIndex >= view.pageCount - 1, run: () => view.goToPage(view.pageCount - 1) });
  if (d.comments) add({ id: "comments", label: d.comments.count > 0 ? `Comments (${d.comments.count})` : "Comments", icon: I.comments, checked: d.comments.open, run: d.comments.toggle });
  if (d.history) add({ id: "history", label: "Version history", icon: I.versions, checked: d.history.open, run: d.history.toggle });
  if (d.onShare) add({ id: "share", label: "Share", icon: I.share, run: d.onShare });
  return out;
}

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
const stepTo = stepZoom;

/** The menus the viewer itself fills in. Kits add theirs with the `menus` prop. */
export function buildMenus(c: PdfCommands, d: ChromeDeps): PdfMenus {
  const it = (id: string, label?: string): MenuEntry | null => (c[id] ? commandItem(c[id]!, label) : null);
  const files = d.pageToolsOn;
  const zooms: MenuEntry[] = ZOOM_MENU.map((z) => ({ label: `${z * 100}%`, checked: d.view.zoom === z, onSelect: () => d.view.setZoom(z as Zoom) }));
  return {
    File: menuGroups(
      files && d.kit.files.canOpen ? [it("open"), it("create")] : null,
      files ? [d.canSave && !d.readOnly ? it("save") : null, it("saveCopy"), { label: "Download", items: menuGroups([it("download.pdf"), it("download.optimised"), it("download.flattened"), it("download.forms"), it("download.pictures")], [it("download.more")]) }] : null,
      [it("properties")],
      files ? [it("print", "Print…")] : null,
    ),
    Edit: menuGroups([it("undo"), it("redo")], [it("find", "Find…"), it("replace")]),
    View: menuGroups(
      [it("zoomIn"), it("zoomOut"), it("zoomActual"), { label: "Zoom", items: [...zooms, "separator", commandItem(c.fitWidth!), commandItem(c.fitPage!)] }],
      [{ label: "Page layout", items: LAYOUTS.map((l) => commandItem(c[`layout.${l.id}`]!)) }, it("rotate", "Rotate view clockwise"), { label: "Go to", items: [it("go.to"), it("go.first"), it("go.previous"), it("go.next"), it("go.last")].filter(Boolean) as MenuEntry[] }],
      [it("sidebar", "Show sidebar"), it("history"), it("properties.panel", "Show properties panel"), it("organise")],
      [it("fullscreen"), { label: "Theme", items: ["theme.auto", "theme.light", "theme.dark"].map((id) => commandItem(c[id]!)) }],
    ),
    Insert: menuGroups([it("insert.blank"), it("insert.pages")]),
    Tools: menuGroups([it("organise"), it("find", "Find…"), it("replace")], [it("words")]),
    Help: menuGroups([it("shortcuts")]),
  };
}

/** The menu bar, rebuilt when the stores it reads (the file commands, the page tools) change. */
export function LiveMenuBar({ build, stores, changed, extra, labels }: { build: () => PdfMenus; stores: readonly Store[]; changed?: (listener: () => void) => () => void; extra?: ExtraMenus; labels?: MenuLabels }) {
  // Hooks run in the same order on every render: the stores are fixed for a viewer.
  for (const s of stores) useStore(s); // eslint-disable-line react-hooks/rules-of-hooks
  // What the kits tell: the clipboard, the tool in hand... Each change is a new number, so the menus are read again.
  const tick = useRef(0);
  useSyncExternalStore(
    (l) => changed?.(() => ((tick.current += 1), l())) ?? (() => {}),
    () => tick.current,
    () => 0,
  );
  const menus = build();
  const defs: MenuDefinition[] = MENU_NAMES.filter((name) => menus[name]?.length).map((name) => ({ label: name, items: menus[name]! }));
  return <MenuBar menus={extendMenus(defs, extra, labels)} className="pli-pdf-menubar" />;
}

/**
 * The File menu's entries with the host's `extraMenus.File` added and its `menuLabels` applied (for the File button of the toolbar,
 * when there is no menu bar). The labels are those of the File menu, so `"File > Download"` works here as it does in the bar.
 */
export function fileMenuItems(items: MenuEntry[] | undefined, extra: ExtraMenus | undefined, labels?: MenuLabels): MenuEntry[] | undefined {
  const onlyFile = extra && "File" in extra ? { File: extra.File! } : undefined;
  if (!onlyFile && !labels) return items;
  // The menu is renamed or removed by the labels, so look for it by its place and not by its name.
  return extendMenus([{ label: "File", items: items ?? [] }], onlyFile, labels)[0]?.items ?? [];
}

/**
 * The row above the menus: the name of the document, who is here, Comments, Share, and what the host added: `startActions`
 * before the name (at the left edge), `actions` after Comments and before Share, and `endActions` last, after Share (the same places as in Documents).
 */
export function TitleBar({ title, people, comments, share, actions, startActions, endActions }: { title: ReactNode; people?: ReactNode; comments?: PdfCommand; share?: PdfCommand; actions?: ReactNode; startActions?: ReactNode; endActions?: ReactNode }) {
  const pressed = comments?.checked;
  return (
    <div className="pli-titlebar pli-pdf-titlebar">
      {startActions && <div className="pli-actions pli-actions-start">{startActions}</div>}
      {title}
      <div className="pli-actions">
        {people}
        {comments && (
          <button type="button" className="pli-button pli-pdf-comments-button" aria-pressed={pressed} aria-label={comments.label} title={comments.label} data-command="comments" onMouseDown={keepFocus} onClick={comments.run}>
            {comments.icon}
            <span>{comments.label}</span>
          </button>
        )}
        {actions}
        {share && <ShareButton onClick={share.run} />}
      </div>
      {endActions && <div className="pli-actions pli-actions-end">{endActions}</div>}
    </div>
  );
}
