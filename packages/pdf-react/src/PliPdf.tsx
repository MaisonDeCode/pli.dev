/**
 * PliPdf: the PDF viewer and editor shell.
 *
 * Layout: a title row (the document's name, who is here, Comments, your `actions`, Share) and a menu bar (File, Edit, View, Insert,
 * Format, Tools, Help: `menu={false}` leaves both out) as in the other Pli editors, the annotation tools row (`ribbon`), a status bar
 * at the bottom of the pages (the page box and the zoom, like the viewers of Drive and Dropbox), a sidebar on the left (Thumbnails, Outline, and your tabs), the pages in the middle on a grey background, and the properties
 * panel (`rightPanel`) on the right. The body is a row; the pages take what the two panels leave and the panels never cover each
 * other. The sidebar can be collapsed (the Sidebar button, Alt+Shift+S) and dragged to another width (the separator on its edge,
 * or its arrow keys); the properties panel opens when `rightPanelKey` says there is something to show, from the Properties button
 * (Alt+Shift+P), and closes with its close button or Esc. Both are remembered per session (see `shell.ts`). Judged by the width of
 * the viewer itself (not the window): under 900px the panel is a sheet over the pages with a backdrop, under 640px the sidebar is
 * a drawer and the panel comes up from the bottom. The bars (toolbar, ribbon) wrap rather than scroll. It is driven by a `PdfSession` (`@pli.dev/pdf`) and draws pages with a `PdfRenderer` (`./renderer`; the pdf.js one is
 * `pdfjsRenderer()` from `@pli.dev/pdf-react/pdfjs`).
 *
 * EXTENSION POINTS (what the annotation, page, form and comment stages plug into)
 *
 * - `tools: PdfTool[]` + `tool` / `onToolChange`: the tool registry. Each tool has a button in the toolbar. While a tool is
 *   active every page puts a layer over itself that gives the tool pointer events in PAGE SPACE (`PagePointerEvent`: points,
 *   y down, not turned, at any zoom and view rotation) and draws the tool's `overlay`. `selectText: true` keeps the text
 *   selectable instead, and `onTextSelected` receives the selection as page-space rectangles (`selectionRects`).
 * - `pageOverlay(ctx)`: SVG drawn inside each page, in page space (the annotations: a `<g>` per annotation, with
 *   `ctx.page.annots`). `pageOverlayDom(ctx)`: the same for HTML (form fields, the note editor); a layer of
 *   `page.width` by `page.height` CSS pixels that is scaled and turned to fit, so children are placed in points.
 *   Both are called for the pages that are drawn only (the ones near the view).
 * - `toolbar`: a node (or `(ctx) => node`) added to the toolbar after the built-in groups. `ribbon`: the same, as a row of its
 *   own under the toolbar (the annotation tools). `pageOverlayBlend(ctx)`: SVG in page space that multiplies with the page.
 * - `banner`: a node (or `(ctx) => node`) between the ribbon and the pages, for bars of its own (the form bar and the Prepare form bar of
 *   `FormsPdf`; it draws its own wrapper).
 * - `sidebar: PdfPanel[]`: more tabs for the left sidebar (the annotation and comment lists, the form fields). `rightPanel`
 *   is a node or `(ctx) => node` shown on the right.
 * - `usePdfView()`: inside any of these, the viewer's state and commands (`PdfViewContext`: page, zoom, `goToPage`,
 *   `setZoom`, `setTool`, selected pages, `pageElement(id)`...). The same object is given to panels and `toolbar`.
 * - `ref`: a `PliPdfHandle` with `goToPage`, `setZoom`, `setViewMode`, `rotateView`, `find`, for hosts that drive the view.
 * - `extraMenus`: items for the menus or menus of your own (`{ File: [...], AI: [...] }`); `filePicker`: your own file chooser for every place the editor asks for a file.
 * - `menus`, `menusChanged`: entries for the menu bar (an object is added to the end of the menus it names; a function gets the viewer's
 *   own menus and returns the ones to show). `formatBar`: a row under the ribbon for formatting text (the text bar). The viewer's own
 *   commands (`buildCommands` in chrome.tsx) make the menu entries, the status bar and the (optional, `topToolbar`) toolbar alike, so they agree on name, key and state.
 * - `onShare`: gives a Share button in the title row. `actions` (before Share) and `endActions` (after it): more controls at the right end there; `startActions`: controls before the name. `onThemeChange`: View > Theme was used.
 * - `room`, `users`, `comments`, `sync`: collaboration through `@pli.dev/core` (see `collab.tsx`). `comments` turns on
 *   `session.comments`; `room` is connected (and disconnected on unmount), carries the comments, and gets what you are doing
 *   (`{ page, selection, tool }`) through `room.setPresence`; the toolbar shows who is here; `sync` keeps the session in step
 *   with a shared document (a `SyncClient` with `pdfSyncModel`, stopped on unmount).
 * - `fonts`: a `FontRegistry`. Every write of the file (Save, Download, Print, flatten, extract, split) fetches the font files
 *   the text boxes, typed signatures, form fields and text edits use and embeds them (`saving.ts`).
 * - Page selection (thumbnails, shift and ctrl/cmd click): `onPagesSelected(ids)`, or `usePageSelection(session)` /
 *   `getPageSelection(session)` anywhere. With fewer than two pages selected, the page shown is the selection.
 * - Look: `.pli-pdf` and CSS variables `--pli-pdf-*` (see `styles.css`); light/dark follows the system or `theme`.
 *
 * The session's selection (`session.selection.page`) is the page shown; changing it moves the view, and scrolling changes it.
 *
 * PAGE TOOLS AND FILE MENU (turn off with `pageTools={false}`; see `pageTools.ts`, `fileActions.ts`, `shortcuts.ts`)
 * - Thumbnails: select (click, shift, ctrl/cmd, Ctrl/Cmd+A; kept in `session.selection.pages`), drag pages to reorder, drop PDF and
 *   picture files between them, a page menu (right click or the menu key), turn, delete (with Undo), duplicate, blank pages,
 *   move to, extract, split, page labels. The Organise pages view is the same on a grid of big thumbnails.
 * - Outline: add a bookmark at the page shown, rename (double click, F2), delete, drag to reorder and nest, indent, outdent, send
 *   to the page shown. Read-only with `readOnly`.
 * - File: `onSave(bytes, result)` (the document counts as saved when its promise resolves), `onDownload(bytes, name, mime)` to take
 *   over downloads, `onPrint`, `onOpen(bytes, name)` (adds Open PDF and Create PDF from pictures), `warnOnUnload`. The name and the
 *   unsaved dot are in the toolbar; Download options, warnings, export pages as PNG or JPEG are in the File menu.
 * - `usePageTools()` (inside the viewer) gives the controllers: `tools` (pages), `files`, `outline`, `notices`.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ForwardRefExoticComponent, type ReactNode, type RefAttributes } from "react";
import { setSelection, setPageSelection, getPageSelection, useElementBox, useHostWidth, useSessionRevision } from "./hooks";
import { ALWAYS, DEFAULT_HOST_WIDTH, SIDEBAR_MIN, SIDEBAR_STEP, clampSidebar, shellOf, sidebarMax, sizeOf } from "./shell";
import { SidebarResizer } from "./Resizer";
import { PageSources } from "./engine";
import { RenderQueue } from "./renderQueue";
import type { PdfRenderer } from "./renderer";
import { CSS_UNITS, clampZoom, fitZoom, normRotation, pageToScreen, screenToPage, selectionRects, stepZoom, turnedSize, type Zoom } from "./geometry";
import { PAGE_GAP, PAGE_PAD, boxesBetween, currentFromScroll, layoutPages, rowOf, rowRanges, zoomToScale, type PdfLayout, type ViewMode } from "./layout";
import { PageView, type PageHighlight } from "./PageView";
import { PinchTracker, anchoredScroll } from "./pinch";
import { Thumbnails } from "./Thumbnails";
import { Outline, outlineFromDoc, outlineFromRendered, type OutlineNode } from "./Outline";
import { FindBar, useFind, type FindState } from "./find";
import { PdfToolbar, ToolButtons } from "./Toolbar";
import { PdfStatusBar } from "./StatusBar";
import { LiveMenuBar, TitleBar, buildCommands, buildMenus, fileMenuItems, type ChromeDeps, type PdfTheme } from "./chrome";
import { weaveMenus, type PdfMenus } from "./commands";
import { PropertiesDialog, ShortcutsDialog, WordCountDialog } from "./HelpDialogs";
import { ReplaceDialog, useReplace } from "./replace";
import { PdfViewContextValue, type PageContext, type PdfPanel, type PdfTool, type PdfViewContext } from "./extensions";
import { PdfIcons as I } from "./icons";
// [page tools] page operations, organise view, file menu, outline editing
import { OrganiseGrid } from "./OrganiseGrid";
import { PageToolbar, Toasts } from "./PageMenu";
import { PageDialogs, FileDialogs } from "./PdfDialogs";
import { FileMenu, SaveButton, DocumentTitle } from "./FileMenu";
import { PageToolsProvider, usePageToolsKit } from "./usePageTools";
import { setPageSelection as setPages } from "./hooks";
import { useStore } from "./store";
import { PdfSession, missingVersionSources, pdfVersionHistory, type PdfAnchor, type PdfDoc, type PdfOp, type SaveResult } from "@pli.dev/pdf";
import type { AutoSaveOptions, FontRegistry, CollabRoom, NamedVersion, ShareClient, StorageClient, Users, VersionHistory, VersionStorage } from "@pli.dev/core";
import { OfflineBanner, ShareDialog, VersionHistoryPanel, VersionPreviewBar, useSyncStatus } from "@pli.dev/react/collab";
import { Bar, FilePickerProvider, extendMenus, type ExtraMenus, type FilePicker, type MenuLabels } from "@pli.dev/react";
import { CURSOR_MS, PeopleBar, publishPresence, throttle, useCollab, type PresenceCursor, type CommentsProp, type SyncProp } from "./collab";
import { setSessionFonts } from "./saving";
import { SIDEBAR_KEYS } from "./shortcuts";
import { usePdfDownload, type PdfDownloadHandler } from "./download";

export interface PliPdfHandle {
  goToPage(page: number | string, y?: number): void;
  setZoom(zoom: Zoom): void;
  setViewMode(mode: ViewMode): void;
  rotateView(degrees?: 90 | -90): void;
  find(query?: string): void;
  /** The scrolling element. */
  scroller(): HTMLElement | null;
  /** Shows, hides or (without an argument) toggles the properties panel, as the Properties button does. */
  toggleProperties(open?: boolean): void;
  /** Shows, hides or toggles the sidebar. */
  toggleSidebar(open?: boolean): void;
}

export interface PliPdfProps {
  session: PdfSession;
  renderer: PdfRenderer;
  /** No editing: tools that edit are hidden, and the document can be looked through, searched and printed. */
  readOnly?: boolean;
  /** Who is looking, for annotations and comments made through the plugged-in tools. */
  user?: { id: string; name?: string };
  /** The room of the people editing this file: presence, comments and live editing go through it. Connected and disconnected by the viewer. */
  room?: CollabRoom<PdfAnchor>;
  /** The people (and the current user) of this window; used for comments and the "who is here" stack. */
  users?: Users;
  /** Turns on comments (`session.comments`). `true` uses `users`; an object can bring its own `users` and a comment `store`. */
  comments?: CommentsProp;
  /** Live editing over `room`: `true`, or options of the `SyncClient` (`version`, `onResync`). Needs `room`. */
  sync?: boolean | SyncProp;
  /** Where pictures go (stamps, images, signatures) instead of being embedded in the document as data. Used by the annotation tools; see also `storageSources` in `@pli.dev/pdf` for the files themselves. */
  storage?: StorageClient;
  /** Font files for saving: what the text boxes, typed signatures, form fields and text edits use is fetched and embedded. */
  fonts?: FontRegistry;
  /** How long to wait before asking again for a file that is not there yet (the file of pages a peer added), in ms. Default 1000, doubling to 30 s. */
  sourceRetryMs?: number;
  /**
   * Show the top toolbar (sidebar, undo and redo, print, page, zoom, layout, rotate, find, full screen, properties, your tools,
   * Save) under the menu bar. Default false: the menu bar has every one of those commands with its key, and the page and the zoom
   * are in the status bar. It is on by default when `menu` is `false`, because the toolbar then holds the name and the File menu.
   */
  topToolbar?: boolean;
  /** Show the status bar (the page box and the zoom) at the bottom of the pages. Default true. It is left out while the top toolbar is shown, which has both. */
  statusBar?: boolean;
  /** Extra toolbar content (shown with `topToolbar`). */
  toolbar?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /** Parts without a place on the page that the tools need on screen all the time (their dialogs, a file input, live messages): drawn whether or not the toolbar is. */
  host?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /** More tabs in the left sidebar. */
  sidebar?: PdfPanel[];
  /**
   * A panel on the right (the properties panel). It is not always there: it opens when `rightPanelKey` says there is something
   * to show, the person opens it with the Properties button or `Alt+Shift+P`, and the close button, `Esc` inside it, or (in a
   * narrow viewer) the backdrop close it. See `shell.ts` for the rules.
   */
  rightPanel?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /**
   * What the right panel would show now: the ids of what is selected, as one string, or null for nothing. The panel opens by
   * itself (in a wide viewer) when this becomes something it has not been closed for, and the Properties button shows a dot.
   * Leave it out for a panel that always has something to show: it then starts open and the person can close it.
   */
  rightPanelKey?: string | null;
  tools?: PdfTool[];
  /** The active tool (controlled), or leave out to let the viewer keep it. */
  tool?: string | null;
  onToolChange?: (id: string | null) => void;
  /** SVG for each drawn page, in page space. */
  pageOverlay?: (ctx: PageContext) => ReactNode;
  /** HTML for each drawn page, in page space. */
  pageOverlayDom?: (ctx: PageContext) => ReactNode;
  /** SVG for each drawn page, in page space, multiplied with the page (highlights). */
  pageOverlayBlend?: (ctx: PageContext) => ReactNode;
  /** A bar under the toolbar for the annotation tools (see `AnnotatedPdf`). */
  ribbon?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /** More buttons in the find bar, next to Close (`PdfEditor` adds "Redact all matches"). Given the search as it stands. */
  findActions?: (find: FindState, ctx: PdfViewContext) => ReactNode;
  /** [forms] A slot between the ribbon and the pages for bars of its own (the form bar, the Prepare form bar, messages). It draws its own wrapper. */
  banner?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /**
   * [page tools] Called by Save (the Save button, the File menu, Ctrl/Cmd+S) with the saved file and what the save found. The
   * document counts as saved when the promise it returns resolves; if it rejects the dot stays and an error is shown.
   */
  onSave?: (bytes: Uint8Array, result: SaveResult) => void | Promise<void>;
  /**
   * [page tools] Hands a downloaded file (a copy, a split part, a page picture, form data) to the app: save it in your own storage,
   * or show the phone's share sheet. The fourth argument has `browserDownload()`, the default, for the files or places you don't
   * handle. If it throws or rejects an error is shown. Left out, the nearest `DownloadProvider`'s function is used, and without
   * one the browser downloads the file.
   */
  onDownload?: PdfDownloadHandler;
  /** [page tools] Replaces the built-in print (a hidden frame with the saved PDF). */
  onPrint?: () => void | Promise<void>;
  /** [page tools] Replaces the document with another file: gives Open PDF and Create PDF from pictures to the File menu. The session is the host's, so it makes the new one. */
  onOpen?: (bytes: Uint8Array, name: string) => void | Promise<void>;
  /** [page tools] Ask the browser to confirm closing the tab or leaving the page while there are unsaved changes. */
  warnOnUnload?: boolean;
  /** [page tools] Turn off the page tools, the file menu and the outline editing (thumbnails and outline are then read-only, as before). */
  pageTools?: boolean;
  /** Called with the ids of the selected pages when they change. */
  onPagesSelected?: (ids: string[]) => void;
  /** Called with the position of the page shown when it changes. */
  onPageChange?: (index: number) => void;
  /** The zoom to start with (default fit width), the layout (default continuous). */
  defaultZoom?: Zoom;
  defaultViewMode?: ViewMode;
  /** The sidebar tab to start with, or null for a closed sidebar (default: thumbnails; closed on a phone). */
  defaultSidebar?: string | null;
  /** Two-page layout: show the first page alone, as a cover. */
  spreadCover?: boolean;
  /** Show the outline the renderer reads from the file when the document has none (for a file the engine did not read). */
  fallbackOutline?: boolean;
  /** The password of an encrypted file. */
  password?: string;
  /** The size to lay out for where the browser reports none (tests, hidden panels). Default 800 by 600. */
  viewport?: { width: number; height: number };
  /** The width of the whole viewer to lay out for where the browser reports none (tests, hidden hosts); decides drawers and sheets. Default 1280 (wide). */
  hostWidth?: number;
  /** "auto" follows the system; "light" and "dark" force one. The View > Theme menu can change it for the person looking (`onThemeChange` hears it). */
  theme?: PdfTheme;
  /** Called when the person chooses a theme in View > Theme. */
  onThemeChange?: (theme: PdfTheme) => void;
  /** Show the title row and the menu bar (File, Edit, View, Insert, Format, Tools, Help). Default true. With `false` the name, people and a File menu are in the toolbar. */
  menu?: boolean;
  /**
   * Entries for the menus. An object adds its entries to the end of each menu it names, after a separator. A function gets the
   * menus the viewer made and returns the ones to show, to place entries where you want them or take some out.
   */
  menus?: PdfMenus | ((base: PdfMenus, ctx: PdfViewContext) => PdfMenus);
  /** Subscribe to changes that should make the menus read their state again (the annotation, form and edit kits use it for the clipboard, the tool in hand, ...). */
  menusChanged?: (listener: () => void) => () => void;
  /** A row between the ribbon and the banner for formatting the text being written (see `FormatBar`); it draws its own wrapper and renders nothing when there is none. */
  formatBar?: ReactNode | ((ctx: PdfViewContext) => ReactNode);
  /** Show the shared Share button in the title row and call this when it is pressed (for a Share dialog of your own). */
  onShare?: () => void;
  /** A `ShareClient` from `@pli.dev/core`: the Share button then opens the shared `ShareDialog` (people, roles, link access) for it. */
  shareClient?: ShareClient;
  /**
   * A `VersionHistory` from `@pli.dev/core`: adds a Version history item to the View menu and a History tab (the shared `VersionHistoryPanel`).
   * Choosing a version in the panel shows it in the viewer, read-only, with a bar to restore it or go back; the real document is not touched.
   */
  history?: VersionHistory<PdfDoc, PdfOp>;
  /**
   * Where named versions are kept (a `VersionStorage` from `@pli.dev/core`; `memoryVersionStorage()` for a demo). The editor then makes the
   * `VersionHistory` itself with `pdfVersionSupport`, from `users` and the live-editing position, so a restore is one undoable step that
   * reaches everyone. Needs `users`; `history` wins when both are given. Saving and restoring need the `editor` role in `users`.
   */
  versions?: VersionStorage<PdfDoc>;
  /**
   * With `versions`: keep an "Autosaved" version now and then after changes, and an "Original" one when the file has no versions yet
   * (default true). Pass `{ every, keep, baseline }` (`AutoSaveOptions`) to tune it, or `false` for only the versions people save.
   * Needs `users` with the editor role. Not used with `history`: make that with `pdfVersionHistory(session, { autoSave })`.
   */
  autoSaveVersions?: boolean | AutoSaveOptions;
  /**
   * Draws the viewer that shows an older version while the person previews it (the session holds that version's pages, and shares this
   * session's source files; show it read-only, with the theme and zoom you are given). `PdfEditor` gives one with the annotation and form layers; by default a plain viewer
   * with pages and text is shown.
   */
  renderVersionPreview?: (preview: PdfSession, view: { theme: PdfTheme; zoom: Zoom }) => ReactNode;
  /** More controls at the right end of the title row (after Comments, before Share), as in the other Pli editors. With `endActions` too, `actions` comes first (it is before Share, `endActions` is after it). */
  actions?: ReactNode;
  /** Controls at the left end of the title row, before the document's name (the same prop Documents, Sheets and Decks have). Shown only with the menu bar (`menu` is not `false`). */
  startActions?: ReactNode;
  /**
   * Items for the menu bar, by menu name. A name the bar has (File, Edit, View, Insert, Format, Tools, Help) gets the items at the end of that menu, after a
   * divider; any other name is a new menu, placed before Help. Give `{ items, after }` or `{ items, before }` to put them next to a built-in item.
   * Applied after `menus`, so it also reaches what a kit added. Read-only and disabled states cover the built-in items only. See [Menus and file pickers](/platform/menus-and-file-pickers/).
   */
  extraMenus?: ExtraMenus;
  /**
   * New text for the built-in menus, or a way to take an item out. `{ "File > Download": "Export", "Insert > Page break": false }`
   * renames File > Download and removes Page break. A key is the text as it is now, or a path of them; `false` removes. Also for
   * translating the menus. See `MenuLabels` and [Menus and file pickers](https://pli.dev/platform/menus-and-file-pickers/).
   */
  menuLabels?: MenuLabels;
  /**
   * Your own way of choosing files: called for Open, Create from pictures, Insert pages from a file, Add picture, the signature picture, Replace picture and Import form data,
   * with what for (`purpose`: `"open"`, `"image"` or `"import"`), the file types, and a `browse()` for the browser's chooser. Resolve with the chosen `File`(s), or `null`
   * to do nothing. Left out, the browser's own chooser opens. Dropping files on the pages is not changed.
   */
  filePicker?: FilePicker;
  /** Controls at the right end of the title row, after Share (the same prop Documents, Sheets and Decks have). */
  endActions?: ReactNode;
  /** Find and replace: turns on the Replace row of the find bar (it writes text edits, so it needs the Edit tool: `PdfEditor` turns it on with `edit`). Default false. */
  replace?: boolean;
  className?: string;
}

const DEFAULT_VIEWPORT = { width: 800, height: 600 };
const EMPTY_TOOLS: PdfTool[] = [];
const NO_THREADS: readonly never[] = [];

const isField = (el: EventTarget | null) => el instanceof HTMLElement && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);

/** A PDF viewer with thumbnails, outline, search, zoom and layouts, and places to plug annotation, page and form tools into. */
export const PliPdf: ForwardRefExoticComponent<PliPdfProps & RefAttributes<PliPdfHandle>> = forwardRef<PliPdfHandle, PliPdfProps>(function PliPdfView(props, ref) {
  const { session, renderer, readOnly = false, tools = EMPTY_TOOLS } = props;
  useSessionRevision(session);
  const doc = session.doc;
  const list = doc.pages;
  const count = list.length;

  const pages = useMemo(() => new PageSources(session, renderer, { password: props.password, retryMs: props.sourceRetryMs }), [session, renderer, props.password, props.sourceRetryMs]);
  useEffect(() => () => pages.destroy(), [pages]);
  const queue = useMemo(() => new RenderQueue(2), [pages]);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  // ---- view state -------------------------------------------------------------------------------------------------

  const [zoom, setZoomState] = useState<Zoom>(props.defaultZoom ?? "fit-width");
  const [viewMode, setViewModeState] = useState<ViewMode>(props.defaultViewMode ?? "continuous");
  const [viewRotation, setViewRotation] = useState(0);
  /** The older version being looked at (version history), or null. */
  const [previewVersion, setPreviewVersion] = useState<NamedVersion<PdfDoc> | null>(null);
  const [fitRef, setFitRef] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [toolState, setToolState] = useState<string | null>(null);
  const toolId = props.tool !== undefined ? props.tool : toolState;
  const activeTool = tools.find((t) => t.id === toolId) ?? null;
  useLayoutEffect(() => {
    setSessionFonts(session, props.fonts);
    return () => setSessionFonts(session, null);
  }, [session, props.fonts]);
  const collab = useCollab(session, props, toolId);
  const syncState = useSyncStatus(collab.sync);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const pageInput = useRef<HTMLInputElement>(null);
  const viewport = useElementBox(scrollerRef, props.viewport ?? DEFAULT_VIEWPORT);

  // The frame: the sidebar (open, tab, width) and the properties panel, kept per session (see shell.ts), laid out for the width of the viewer itself.
  const shell = useMemo(() => shellOf(session, { tab: props.defaultSidebar ?? undefined, sidebar: props.defaultSidebar === null ? false : undefined }), [session]); // eslint-disable-line react-hooks/exhaustive-deps
  useStore(shell);
  const hostWidth = useHostWidth(rootRef, props.hostWidth ?? DEFAULT_HOST_WIDTH);
  const size = sizeOf(hostWidth);
  const phone = size === "phone";
  const sidebarOpen = shell.sidebarOpen(size);
  const sidebarTab = shell.tab ?? "thumbnails";
  const sidebarWidth = clampSidebar(shell.width, hostWidth);
  const hasPanel = !!props.rightPanel;
  const panelKey = props.rightPanelKey === undefined ? ALWAYS : props.rightPanelKey;
  const panelOpen = hasPanel && shell.panelOpen(panelKey, size);
  const panelOverlay = size !== "wide";
  // Nothing selected any more: selecting the same thing again counts as new.
  useEffect(() => {
    if (panelKey === null) shell.forgetClosed();
  }, [panelKey, shell]);
  const frame = useRef({ shell, size, panelKey, hasPanel, panelOpen, sidebarOpen });
  frame.current = { shell, size, panelKey, hasPanel, panelOpen, sidebarOpen };
  const focusPanel = useRef(false);
  const setSidebar = useCallback((open: boolean) => {
    const f = frame.current;
    f.shell.setSidebar(open, f.size !== "phone");
    // On a phone the sidebar and the panel are sheets over the page: one at a time.
    if (open && f.size === "phone" && f.hasPanel && f.panelOpen) f.shell.closePanel(f.panelKey);
  }, []);
  const toggleProperties = useCallback((want?: boolean) => {
    const f = frame.current;
    if (!f.hasPanel) return;
    const next = want ?? !f.panelOpen;
    if (next === f.panelOpen) return;
    if (next) {
      f.shell.openPanel();
      focusPanel.current = f.size !== "wide";
      if (f.size === "phone") f.shell.setSidebar(false, false);
    } else f.shell.closePanel(f.panelKey);
  }, []);
  const closePanel = useCallback(() => {
    toggleProperties(false);
    // Leave focus somewhere sensible: the button that opens the panel.
    requestAnimationFrame?.(() => (rootRef.current?.querySelector<HTMLElement>(".pli-pdf-props-toggle") ?? scrollerRef.current)?.focus());
  }, [toggleProperties]);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (panelOpen && focusPanel.current) panelRef.current?.querySelector<HTMLElement>(".pli-pdf-right-close")?.focus();
    focusPanel.current = false;
  }, [panelOpen]);
  const setSidebarTab = useCallback((id: string) => shell.setTab(id), [shell]);

  const currentId = session.selection.page;
  const found = list.findIndex((p) => p.id === currentId);
  const current = count === 0 ? 0 : found < 0 ? 0 : found;
  const currentPage = list[current];

  // Tell the room where we are: the page shown, what is selected on it, the active tool, and where the pointer is.
  const sel = session.selection.annots;
  const selKey = sel.join(",");
  const cursor = useRef<PresenceCursor | null>(null);
  const tell = useRef<() => void>(() => {});
  tell.current = () => {
    if (props.room) publishPresence(props.room, { page: currentPage?.id ?? null, selection: selKey ? selKey.split(",") : [], tool: toolId, cursor: cursor.current });
  };
  useEffect(() => {
    tell.current();
  }, [props.room, currentPage?.id, selKey, toolId]);

  // The zoom as a number, with the fit modes worked out for the page they were chosen on.
  const zoomValue = useMemo(() => {
    if (typeof zoom === "number") return clampZoom(zoom);
    const ref = list[Math.min(fitRef, count - 1)] ?? list[0];
    if (!ref) return 1;
    const turned = turnedSize(ref.width, ref.height, normRotation(ref.rotate + viewRotation));
    let width = turned.width;
    if (viewMode === "spread") {
      const ranges = rowRanges(count, "spread", props.spreadCover);
      const [a, b] = ranges[rowOf(ranges, Math.min(fitRef, count - 1))] ?? [0, 0];
      width = 0;
      for (let i = a; i <= b; i++) width += turnedSize(list[i]!.width, list[i]!.height, normRotation(list[i]!.rotate + viewRotation)).width + (i > a ? PAGE_GAP / CSS_UNITS : 0);
    }
    return fitZoom(zoom, { width, height: turned.height }, viewport, PAGE_PAD);
  }, [zoom, list, count, fitRef, viewRotation, viewMode, viewport, props.spreadCover]);
  const scale = zoomToScale(zoomValue);

  const layout: PdfLayout = useMemo(
    () => layoutPages(list, { mode: viewMode, scale, viewRotation, viewport, current: viewMode === "continuous" ? 0 : current, cover: props.spreadCover }),
    [list, viewMode, scale, viewRotation, viewport, viewMode === "continuous" ? 0 : current, props.spreadCover],
  );
  const latest = useRef({ layout, current, count, viewMode, zoomValue, viewport, list, scale });
  latest.current = { layout, current, count, viewMode, zoomValue, viewport, list, scale };

  // ---- moving around ----------------------------------------------------------------------------------------------

  /** The page last chosen by scrolling (so the view is not scrolled again to a page it is already on). */
  const derived = useRef(-1);
  const pendingTop = useRef<number | null>(null);

  const scrollToPage = useCallback((index: number, y?: number) => {
    const el = scrollerRef.current;
    const { layout: lay, list: pagesNow, scale: s } = latest.current;
    const box = lay.box(index);
    if (!el || !box) return;
    let top = box.top - PAGE_PAD;
    if (y !== undefined) {
      const page = pagesNow[index]!;
      top = box.top + pageToScreen({ width: page.width, height: page.height, rotation: box.rotation, scale: s }, 0, y)[1] - 40;
    }
    el.scrollTop = Math.max(0, top);
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
  }, []);

  const goToPage = useCallback(
    (page: number | string, y?: number) => {
      const { list: pagesNow, count: n, viewMode: mode } = latest.current;
      const index = typeof page === "number" ? Math.max(0, Math.min(n - 1, Math.round(page))) : pagesNow.findIndex((p) => p.id === page);
      const target = pagesNow[index];
      if (!target) return;
      derived.current = index;
      setSelection(session, { page: target.id });
      if (mode === "continuous") scrollToPage(index, y);
      else {
        pendingTop.current = null;
        if (y !== undefined) {
          const box = latest.current.layout.box(index);
          pendingTop.current = Math.max(0, pageToScreen({ width: target.width, height: target.height, rotation: box?.rotation ?? target.rotate, scale: latest.current.scale }, 0, y)[1] - 40);
        }
        const el = scrollerRef.current;
        if (el) el.scrollTop = pendingTop.current ?? 0;
        setScroll({ top: pendingTop.current ?? 0, left: 0 });
      }
    },
    [session, scrollToPage],
  );

  // Scrolling decides the page shown (continuous view); the page shown decides the scroll when something else changes it.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScroll((old) => (old.top === el.scrollTop && old.left === el.scrollLeft ? old : { top: el.scrollTop, left: el.scrollLeft }));
    const { layout: lay, viewMode: mode, viewport: vp, list: pagesNow, current: now } = latest.current;
    if (mode !== "continuous" || pagesNow.length === 0) return;
    const at = currentFromScroll(lay, el.scrollTop, el.clientHeight || vp.height);
    if (at !== now) {
      derived.current = at;
      setSelection(session, { page: pagesNow[at]!.id });
    } else derived.current = at;
  }, [session]);

  useEffect(() => {
    if (viewMode === "continuous" && count > 0 && current !== derived.current) scrollToPage(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, viewMode, count]);

  // Zoom keeps the point under the pointer (or the middle of the view) where it is.
  const fix = useRef<{ ratio: number; ax: number; ay: number; top: number; left: number } | null>(null);
  const applyZoom = useCallback((next: Zoom, anchor?: { x: number; y: number }) => {
    const { zoomValue: old, viewport: vp, current: cur } = latest.current;
    const el = scrollerRef.current;
    if (typeof next === "number") next = clampZoom(next);
    else setFitRef(cur);
    if (next === old && typeof next === "number") return;
    fix.current = el && typeof next === "number" ? { ratio: next / old, ax: anchor?.x ?? vp.width / 2, ay: anchor?.y ?? vp.height / 2, top: el.scrollTop, left: el.scrollLeft } : null;
    setZoomState(next);
  }, []);
  const scaleKey = `${scale}|${viewRotation}|${viewMode}`;
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const f = fix.current;
    fix.current = null;
    if (f && latest.current.viewMode === "continuous") {
      const to = anchoredScroll({ top: f.top, left: f.left }, { x: f.ax, y: f.ay }, f.ratio);
      el.scrollTop = to.top;
      el.scrollLeft = to.left;
      setScroll({ top: el.scrollTop, left: el.scrollLeft });
    } else if (latest.current.viewMode === "continuous") scrollToPage(latest.current.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleKey]);
  // The paged layouts show one row at a time, from its top.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || viewMode === "continuous") return;
    el.scrollTop = pendingTop.current ?? 0;
    pendingTop.current = null;
    setScroll({ top: el.scrollTop, left: 0 });
  }, [current, viewMode]);

  const step = (from: number, dir: 1 | -1): number => {
    if (viewMode !== "spread") return Math.max(0, Math.min(count - 1, from + dir));
    const ranges = rowRanges(count, "spread", props.spreadCover);
    return ranges[Math.max(0, Math.min(ranges.length - 1, rowOf(ranges, from) + dir))]?.[0] ?? from;
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    derived.current = -1;
  }, []);
  const rotateView = useCallback((degrees: 90 | -90 = 90) => setViewRotation((r) => normRotation(r + degrees)), []);

  // ---- find -------------------------------------------------------------------------------------------------------

  const reveal = useCallback(
    (hit: { page: number; rects: { x: number; y: number; w: number; h: number }[] }) => {
      goToPage(hit.page, hit.rects[0]?.y);
    },
    [goToPage],
  );
  const find = useFind(pages, list, findOpen, reveal);
  const openFind = useCallback(
    (query?: string) => {
      setFindOpen(true);
      if (query !== undefined) find.setQuery(query);
      requestAnimationFrame?.(() => findInput.current?.select());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [find.setQuery],
  );
  const highlights = useMemo(() => {
    const map = new Map<number, PageHighlight[]>();
    if (!findOpen) return map;
    find.hits.forEach((hit, i) => {
      const arr = map.get(hit.page) ?? [];
      for (const rect of hit.rects) arr.push({ rect, current: i === find.current });
      map.set(hit.page, arr);
    });
    return map;
  }, [find.hits, find.current, findOpen]);

  // ---- page selection ---------------------------------------------------------------------------------------------

  const rawSelection = getPageSelection(session);
  const selectedPages = rawSelection.length > 1 ? rawSelection : currentPage ? [currentPage.id] : [];
  const selectedKey = selectedPages.join(",");
  const { onPagesSelected, onPageChange } = props;
  useEffect(() => {
    onPagesSelected?.(selectedKey ? selectedKey.split(",") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  useEffect(() => {
    if (count > 0) onPageChange?.(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // ---- [page tools] ---------------------------------------------------------------------------------------------------

  const download = usePdfDownload(props.onDownload);
  const pageToolsOn = props.pageTools !== false;
  const kit = usePageToolsKit({
    session,
    renderer,
    readOnly,
    hooks: { onSave: props.onSave, onOpen: props.onOpen, onPrint: props.onPrint, download: download, picker: props.filePicker },
    warnOnUnload: props.warnOnUnload,
    here: () => {
      const { list: pagesNow, current: cur, layout: lay, scale: s } = latest.current;
      const page = pagesNow[cur];
      if (!page) return null;
      // How far down the page the top of the view is (page space); only for a page that is not turned.
      const box = lay.box(cur);
      const el = scrollerRef.current;
      let y: number | undefined;
      if (el && box && box.rotation === 0) {
        const down = (el.scrollTop - box.top) / s;
        if (down >= 8 && down < page.height) y = down;
      }
      return { pageId: page.id, page: cur, y };
    },
  });

  useStore(kit.tools); // the organise view is opened and closed by the page tools

  // ---- find and replace, the dialogs of the menus, full screen, theme ----------------------------------------------------

  const replaceOn = !!props.replace && !readOnly && pageToolsOn;
  const replace = useReplace(session, find, kit.notices, replaceOn);
  const [dialog, setDialog] = useState<"shortcuts" | "properties" | "words" | "share" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const fullscreenAvailable = typeof document !== "undefined" && document.fullscreenEnabled !== false && typeof Element !== "undefined" && typeof Element.prototype.requestFullscreen === "function";
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el || typeof document === "undefined") return;
    // Not every browser lets a page do this (and a phone may refuse): the menu entry is simply there to try.
    if (document.fullscreenElement) void Promise.resolve(document.exitFullscreen?.()).catch(() => undefined);
    else void Promise.resolve(el.requestFullscreen?.()).catch(() => undefined);
  }, []);
  const [themeChoice, setThemeChoice] = useState<PdfTheme | null>(null);
  useEffect(() => setThemeChoice(null), [props.theme]);
  const theme: PdfTheme = themeChoice ?? props.theme ?? "auto";
  const { onThemeChange } = props;
  const chooseTheme = useCallback(
    (t: PdfTheme) => {
      setThemeChoice(t);
      onThemeChange?.(t);
    },
    [onThemeChange],
  );
  // The Comments button counts the threads that are not resolved.
  const commentsClient = session.comments.client;
  const threadsNow = useSyncExternalStore(
    (l) => commentsClient?.subscribe(l) ?? (() => {}),
    () => commentsClient?.threads ?? NO_THREADS,
    () => NO_THREADS,
  );

  // ---- tools ------------------------------------------------------------------------------------------------------

  const setTool = useCallback(
    (id: string | null) => {
      const old = tools.find((t) => t.id === toolId);
      if (old && old.id !== id) old.onCancel?.();
      if (props.tool === undefined) setToolState(id);
      props.onToolChange?.(id);
    },
    [tools, toolId, props.tool, props.onToolChange],
  );

  // ---- keyboard and wheel -----------------------------------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    // Looking at an older version: Escape goes back to the current one, and the keys of the editor (undo, delete a page, ...) leave the real document alone.
    if (previewVersion) {
      if (key === "Escape" && !(e.target as HTMLElement | null)?.closest?.("dialog")) {
        setPreviewVersion(null);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Alt+Shift+S: the sidebar. Alt+Shift+P: the properties panel. (By the physical key: Option changes the letter on a Mac.)
    if (e.altKey && e.shiftKey && !mod && !isField(e.target)) {
      const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key.toLowerCase();
      if (letter === "s") setSidebar(!sidebarOpen);
      else if (letter === "p" && hasPanel) toggleProperties();
      else if (letter === "g" && count > 0) deps.goTo();
      else if (letter === "w") applyZoom("fit-width");
      else if (letter === "a") applyZoom("fit-page");
      else if (letter === "r") rotateView(90);
      else if (letter === "f" && fullscreenAvailable) toggleFullscreen();
      else return;
      e.preventDefault();
      return;
    }
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (key === "+" || key === "=") applyZoom(stepZoom(zoomValue, 1));
      else if (key === "-" || key === "_") applyZoom(stepZoom(zoomValue, -1));
      else if (key === "0") applyZoom(1);
      else if (k === "f") openFind();
      else if (k === "h" && replaceOn) {
        openFind();
        replace.setOpen(true);
      } else if (key === "/" || key === "?") setDialog("shortcuts");
      else if (k === "g") (e.shiftKey ? find.prev : find.next)();
      else if (pageToolsOn && k === "s" && (props.onSave || e.shiftKey)) void (e.shiftKey ? kit.files.saveCopy() : kit.files.save());
      else if (pageToolsOn && k === "p") void kit.files.print();
      else if (pageToolsOn && k === "o" && props.onOpen) void kit.files.chooseAndOpen();
      else if (pageToolsOn && !isField(e.target) && !(e.target as HTMLElement | null)?.closest?.("dialog") && kit.tools.handleGlobalKey(e)) {
        // handled by the page tools: turn, delete, undo, redo
      } else return;
      e.preventDefault();
      return;
    }
    if (key === "Escape") {
      if (kit.tools.organise) kit.tools.setOrganise(false);
      else if (findOpen) setFindOpen(false);
      else if (panelOpen && panelOverlay) closePanel();
      else if (phone && sidebarOpen) setSidebar(false);
      else if (activeTool) setTool(null);
      else return;
      e.preventDefault();
      return;
    }
    if (key === "?" && !isField(e.target) && !e.altKey && !(e.target as HTMLElement | null)?.closest?.("dialog")) {
      setDialog("shortcuts");
      e.preventDefault();
      return;
    }
    if (isField(e.target) || e.altKey || count === 0) return;
    const paged = viewMode !== "continuous";
    const el = scrollerRef.current;
    const atBottom = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const atTop = !el || el.scrollTop <= 0;
    let to: number | null = null;
    if (key === "PageDown") {
      if (paged && !atBottom && el) {
        el.scrollTop += el.clientHeight * 0.9;
        setScroll({ top: el.scrollTop, left: el.scrollLeft });
        e.preventDefault();
        return;
      }
      to = step(current, 1);
    } else if (key === "PageUp") {
      if (paged && !atTop && el) {
        el.scrollTop -= el.clientHeight * 0.9;
        setScroll({ top: el.scrollTop, left: el.scrollLeft });
        e.preventDefault();
        return;
      }
      to = step(current, -1);
    } else if (key === "Home") to = 0;
    else if (key === "End") to = count - 1;
    else if (paged && key === "ArrowRight") to = step(current, 1);
    else if (paged && key === "ArrowLeft") to = step(current, -1);
    if (to === null) return;
    e.preventDefault();
    if (to !== current || key === "Home" || key === "End") goToPage(to);
  };

  const wheelState = useRef({ applyZoom, zoomValue });
  wheelState.current = { applyZoom, zoomValue };
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Pinching on a trackpad arrives as a wheel with the control key held: it zooms the page, not the browser.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      wheelState.current.applyZoom(wheelState.current.zoomValue * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pinching with two fingers zooms the pages, around the middle of the fingers; one finger scrolls and draws as before.
  const pinch = useRef(new PinchTracker());
  const pinchState = useRef({ applyZoom, zoomValue, tool: activeTool });
  pinchState.current = { applyZoom, zoomValue, tool: activeTool };
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const tracker = pinch.current;
    const at = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // The second finger: what the first one was doing (a stroke, a drag) is dropped.
      if (tracker.down(e.pointerId, at(e), pinchState.current.zoomValue)) pinchState.current.tool?.onCancel?.();
      if (tracker.owns(e.pointerId)) e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const update = tracker.move(e.pointerId, at(e));
      if (tracker.owns(e.pointerId)) e.stopPropagation();
      if (!update) return;
      el.scrollLeft -= update.pan.x;
      el.scrollTop -= update.pan.y;
      pinchState.current.applyZoom(update.zoom, update.anchor);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const own = tracker.owns(e.pointerId);
      tracker.up(e.pointerId);
      if (own) e.stopPropagation();
    };
    // While two fingers are down the browser must not scroll or zoom the page itself.
    const touchMove = (e: TouchEvent) => {
      if ((e.touches.length >= 2 || tracker.active) && e.cancelable) e.preventDefault();
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("touchmove", touchMove);
      tracker.reset();
    };
  }, []);

  // Where the pointer is, in page space, told to the room (at most every 50 ms) so others see it move.
  const room = props.room;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!room || !el) return;
    const send = throttle(() => tell.current(), CURSOR_MS);
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const pageEl = (e.target as Element | null)?.closest?.<HTMLElement>("[data-page-id]");
      const page = pageEl ? latest.current.list.find((p) => p.id === pageEl.dataset.pageId) : undefined;
      if (!pageEl || !page) {
        if (cursor.current) {
          cursor.current = null;
          send.call();
        }
        return;
      }
      const box = pageEl.getBoundingClientRect();
      const [x, y] = screenToPage({ width: page.width, height: page.height, rotation: Number(pageEl.dataset.rotation) || 0, scale: latest.current.scale }, e.clientX - box.left, e.clientY - box.top);
      cursor.current = { page: page.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      send.call();
    };
    const leave = () => {
      if (!cursor.current) return;
      cursor.current = null;
      send.flush();
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      send.cancel();
      cursor.current = null;
    };
  }, [room]);

  // A tool that works on selected text is told when the pointer lets go of a selection.
  const onSelectUp = () => {
    if (!activeTool?.onTextSelected) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !scrollerRef.current) return;
    const rects = selectionRects(sel.getRangeAt(0), scrollerRef.current);
    if (rects.length) activeTool.onTextSelected(rects);
  };

  // ---- the outline of a file the engine did not read ----------------------------------------------------------------

  const docOutline = useMemo(() => outlineFromDoc(doc), [doc.outline, doc.pages]);
  const [fileOutline, setFileOutline] = useState<OutlineNode[]>([]);
  const wantFile = props.fallbackOutline && docOutline.length === 0 && sidebarOpen && sidebarTab === "outline";
  useEffect(() => {
    if (!wantFile) return;
    let live = true;
    pages.outline().then(
      (items) => live && setFileOutline(outlineFromRendered(items)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wantFile, pages]);

  // ---- what is drawn ----------------------------------------------------------------------------------------------

  const ctx: PdfViewContext = {
    session,
    readOnly,
    user: props.user,
    room: props.room,
    users: props.users,
    comments: session.comments.client,
    pageIndex: current,
    pageId: currentPage?.id ?? null,
    pageCount: count,
    zoom,
    zoomValue,
    scale,
    viewMode,
    viewRotation,
    selectedPages,
    tool: toolId,
    goToPage,
    setZoom: (z) => applyZoom(z),
    setViewMode,
    rotateView,
    setTool,
    setSelectedPages: (ids) => setPageSelection(session, ids),
    find: openFind,
    pageElement: (id) => scrollerRef.current?.querySelector<HTMLElement>(`[data-page-id="${id}"]`) ?? null,
    scroller: () => scrollerRef.current,
  };
  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      setZoom: (z) => applyZoom(z),
      setViewMode,
      rotateView,
      find: openFind,
      scroller: () => scrollerRef.current,
      toggleProperties,
      toggleSidebar: (open) => setSidebar(open ?? !frame.current.sidebarOpen),
    }),
    [goToPage, applyZoom, setViewMode, rotateView, openFind, toggleProperties, setSidebar],
  );

  const near = useMemo(() => {
    if (viewMode !== "continuous") return layout.boxes;
    return boxesBetween(layout, scroll.top - viewport.height, scroll.top + 2 * viewport.height);
  }, [layout, viewMode, scroll.top, viewport.height]);
  const inView = useMemo(() => {
    const set = new Set<number>();
    for (const b of boxesBetween(layout, scroll.top, scroll.top + viewport.height)) set.add(b.index);
    return set;
  }, [layout, scroll.top, viewport.height]);

  // The older version as a session of its own (its pages, annotations and form values; the same source files), shown read-only. The real session is not touched.
  const previewSession = useMemo(() => (previewVersion ? new PdfSession(structuredClone(previewVersion.state), { sources: session.sources, user: session.options.user }) : null), [previewVersion, session]);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  useEffect(() => {
    setPreviewMissing([]);
    if (!previewVersion) return;
    let live = true;
    void missingVersionSources(previewVersion.state, session.sources).then((list) => live && setPreviewMissing(list.map((s) => s.name)));
    return () => {
      live = false;
    };
  }, [previewVersion, session]);

  const syncRef = useRef(collab.sync);
  syncRef.current = collab.sync;
  // Made in an effect, not while rendering: it watches the session for the autosave and must be let go of when the editor goes away.
  const [ownHistory, setOwnHistory] = useState<VersionHistory<PdfDoc, PdfOp> | null>(null);
  const autoSave = props.autoSaveVersions === false ? undefined : props.autoSaveVersions && props.autoSaveVersions !== true ? props.autoSaveVersions : {};
  const autoKey = JSON.stringify(autoSave ?? null);
  useEffect(() => {
    if (props.history || !props.versions || !props.users) {
      setOwnHistory(null);
      return;
    }
    const made = pdfVersionHistory(session, { storage: props.versions, users: props.users, version: () => syncRef.current?.version ?? null, autoSave });
    setOwnHistory(made);
    return () => {
      made.dispose();
      setOwnHistory((now) => (now === made ? null : now));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, props.history, props.versions, props.users, autoKey]);
  const history = props.history ?? ownHistory ?? undefined;
  const panels: PdfPanel[] = [
    ...(props.sidebar ?? []),
    ...(history
      ? [
          {
            id: "history",
            label: "History",
            icon: I.versions,
            render: () => <VersionHistoryPanel history={history} activeId={previewVersion?.id ?? null} onPreview={setPreviewVersion} onRestored={() => setPreviewVersion(null)} />,
          },
        ]
      : []),
  ];
  const tabs = [
    { id: "thumbnails", label: "Thumbnails", icon: I.thumbnails },
    { id: "outline", label: "Outline", icon: I.outlineTree },
    ...panels.map((p) => ({ id: p.id, label: p.label, icon: p.icon })),
  ];
  const tab = tabs.some((t) => t.id === sidebarTab) ? sidebarTab : "thumbnails";
  const historyShown = sidebarOpen && tab === "history";
  // The preview belongs to the History tab: closing the tab or the history ends it.
  useEffect(() => {
    if (previewVersion && (!history || !historyShown)) setPreviewVersion(null);
  }, [previewVersion, history, historyShown]);
  const outlineItems = docOutline.length ? docOutline : fileOutline;

  // The commands the toolbar and the menus are both made from (see chrome.tsx).
  const hasComments = !!commentsClient && panels.some((p) => p.id === "comments");
  const topToolbar = props.topToolbar ?? props.menu === false;
  const statusBarOn = props.statusBar !== false && !topToolbar;
  // The host's own tools (not the kits': theirs are hidden, the ribbon has their buttons) get a row of their own when there is no toolbar.
  const rowTools = tools.filter((t) => !t.hidden && !(readOnly && t.needsEdit !== false));
  const deps: ChromeDeps = {
    session,
    readOnly,
    view: ctx,
    kit,
    pageToolsOn,
    canSave: !!props.onSave,
    find: {
      open: findOpen,
      toggle: () => (findOpen ? setFindOpen(false) : openFind()),
      replace: () => {
        openFind();
        replace.setOpen(true);
      },
      canReplace: replaceOn && count > 0,
    },
    sidebar: { open: sidebarOpen, toggle: () => setSidebar(!sidebarOpen), shortcut: SIDEBAR_KEYS },
    panel: hasPanel ? { open: panelOpen, toggle: () => toggleProperties() } : undefined,
    comments: hasComments
      ? {
          open: sidebarOpen && tab === "comments",
          toggle: () => {
            if (sidebarOpen && tab === "comments") setSidebar(false);
            else {
              setSidebarTab("comments");
              setSidebar(true);
            }
          },
          count: threadsNow.filter((t) => !t.resolved).length,
        }
      : undefined,
    history: history
      ? {
          open: sidebarOpen && tab === "history",
          toggle: () => {
            if (sidebarOpen && tab === "history") {
              setPreviewVersion(null);
              setSidebar(false);
            }
            else {
              setSidebarTab("history");
              setSidebar(true);
            }
          },
        }
      : undefined,
    fullscreen: { on: fullscreen, available: fullscreenAvailable, toggle: toggleFullscreen },
    theme: { value: theme, set: chooseTheme },
    dialogs: { shortcuts: () => setDialog("shortcuts"), properties: () => setDialog("properties"), words: () => setDialog("words") },
    onShare:
      props.onShare || props.shareClient
        ? () => {
            props.onShare?.();
            if (props.shareClient) setDialog("share");
          }
        : undefined,
    canGo: (dir) => count > 0 && step(current, dir) !== current,
    go: (dir) => goToPage(step(current, dir)),
    canGoTo: statusBarOn || topToolbar,
    goTo: () => {
      pageInput.current?.focus();
      pageInput.current?.select();
    },
  };
  const commands = buildCommands(deps);
  const menuState = useRef({ deps, menus: props.menus, ctx });
  menuState.current = { deps, menus: props.menus, ctx };
  const buildMenuBar = useCallback((): PdfMenus => {
    const { deps: d, menus, ctx: c } = menuState.current;
    const base = buildMenus(buildCommands(d), d);
    return typeof menus === "function" ? menus(base, c) : weaveMenus(base, menus);
  }, []);
  const menuOn = props.menu !== false;

  const sidebarBody = (() => {
    if (tab === "thumbnails")
      return (
        <>
          {pageToolsOn && <PageToolbar tools={kit.tools} />}
          <Thumbnails
            pages={pages}
            queue={queue}
            list={list}
            current={current}
            selected={rawSelection}
            dpr={dpr}
            onGo={(i) => goToPage(i)}
            onSelect={(ids) => setPageSelection(session, ids)}
            tools={pageToolsOn ? kit.tools : undefined}
          />
        </>
      );
    if (tab === "outline") return <Outline items={outlineItems} onGo={(page, y) => goToPage(page, y)} edit={pageToolsOn && !readOnly && docOutline.length === outlineItems.length ? kit.outline : undefined} />;
    return panels.find((p) => p.id === tab)?.render(ctx) ?? null;
  })();

  return (
    <PdfViewContextValue.Provider value={ctx}>
      <FilePickerProvider picker={props.filePicker}>
      <PageToolsProvider value={pageToolsOn ? kit : null}>
      <div
        ref={rootRef}
        className={["pli-pdf", theme === "dark" ? "pli-pdf-dark" : theme === "light" ? "pli-pdf-light" : "", props.className ?? ""].filter(Boolean).join(" ")}
        data-theme={theme === "auto" ? undefined : theme}
        data-view-mode={viewMode}
        data-size={size}
        data-sidebar={sidebarOpen ? "" : undefined}
        data-panel={panelOpen ? "" : undefined}
        data-organise={kit.tools.organise ? "" : undefined}
        data-fullscreen={fullscreen ? "" : undefined}
        data-tool={toolId ?? undefined}
        onKeyDown={onKeyDown}
      >
        {menuOn && (
          <div className="pli-chrome pli-pdf-chrome">
            <TitleBar
              title={pageToolsOn ? <DocumentTitle files={kit.files} dirty={session.dirty} /> : undefined}
              people={props.room ? <PeopleBar collab={collab} room={props.room} /> : undefined}
              comments={commands.comments}
              share={commands.share}
              actions={props.actions}
              startActions={props.startActions}
              endActions={props.endActions}
            />
            <LiveMenuBar build={buildMenuBar} stores={[kit.files, kit.tools]} changed={props.menusChanged} extra={props.extraMenus} labels={props.menuLabels} />
          </div>
        )}
        {topToolbar && (
        <PdfToolbar
          pageIndex={current}
          pageInputRef={pageInput}
          pageCount={count}
          onGo={(i) => goToPage(i)}
          zoom={zoom}
          zoomValue={zoomValue}
          onZoom={(z) => applyZoom(z)}
          viewMode={viewMode}
          onViewMode={setViewMode}
          commands={commands}
          panel={hasPanel ? { open: panelOpen, hint: panelKey !== null && panelKey !== ALWAYS, onToggle: () => toggleProperties() } : undefined}
          tools={tools}
          tool={toolId}
          onTool={setTool}
          extra={typeof props.toolbar === "function" ? props.toolbar(ctx) : props.toolbar}
          people={!menuOn && props.room ? <PeopleBar collab={collab} room={props.room} /> : undefined}
          readOnly={readOnly}
          title={!menuOn && pageToolsOn ? <DocumentTitle files={kit.files} dirty={session.dirty} /> : undefined}
          file={pageToolsOn ? menuOn ? <SaveButton files={kit.files} dirty={session.dirty} /> : <FileMenu files={kit.files} dirty={session.dirty} items={fileMenuItems(buildMenuBar().File, props.extraMenus, props.menuLabels)} /> : undefined}
          onOrganise={pageToolsOn && count > 0 ? () => kit.tools.setOrganise(true) : undefined}
        />
        )}
        {props.host && (typeof props.host === "function" ? props.host(ctx) : props.host)}
        {!topToolbar && rowTools.length > 0 && (
          <Bar className="pli-pdf-ribbon pli-pdf-toolrow" aria-label="Tools">
            <ToolButtons tools={rowTools} tool={toolId} onTool={setTool} />
          </Bar>
        )}
        {collab.sync && <OfflineBanner status={syncState.status} unsynced={syncState.unsynced} />}
        {props.ribbon && (
          <Bar className="pli-pdf-ribbon" aria-label="Annotation tools">
            {typeof props.ribbon === "function" ? props.ribbon(ctx) : props.ribbon}
          </Bar>
        )}
        {props.formatBar && (typeof props.formatBar === "function" ? props.formatBar(ctx) : props.formatBar)}
        {props.banner && (typeof props.banner === "function" ? props.banner(ctx) : props.banner)}
        <div className="pli-pdf-body">
          {sidebarOpen && (
            <>
              {phone && <button type="button" className="pli-pdf-scrim" data-for="sidebar" aria-label="Close sidebar" tabIndex={-1} onClick={() => setSidebar(false)} />}
              <aside className="pli-pdf-sidebar" aria-label="Sidebar" style={phone ? undefined : ({ "--pli-pdf-sidebar-w": `${sidebarWidth}px` } as CSSProperties)}>
                <div
                  className="pli-pdf-tabs"
                  role="tablist"
                  aria-label="Sidebar"
                  onKeyDown={(e) => {
                    const at = tabs.findIndex((t) => t.id === tab);
                    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
                    if (to === null) return;
                    e.preventDefault();
                    const next = tabs[(to + tabs.length) % tabs.length]!;
                    setSidebarTab(next.id);
                    requestAnimationFrame?.(() => {
                      const el = rootRef.current?.querySelector<HTMLElement>(`#pli-pdf-tab-${next.id}`);
                      el?.focus();
                      el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
                    });
                  }}
                >
                  {tabs.map((t) => (
                    <button key={t.id} type="button" role="tab" className="pli-pdf-tab" id={`pli-pdf-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="pli-pdf-sidebar-panel" aria-label={t.label} tabIndex={tab === t.id ? 0 : -1} title={t.label} onClick={() => setSidebarTab(t.id)}>
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                <div className="pli-pdf-sidebar-body" id="pli-pdf-sidebar-panel" role="tabpanel" aria-labelledby={`pli-pdf-tab-${tab}`}>
                  {sidebarBody}
                </div>
                {!phone && (
                  <SidebarResizer
                    width={sidebarWidth}
                    min={SIDEBAR_MIN}
                    max={sidebarMax(hostWidth)}
                    step={SIDEBAR_STEP}
                    onChange={(w) => shell.setWidth(w, hostWidth)}
                    onCommit={() => shell.rememberWidth()}
                    onReset={() => shell.resetWidth()}
                  />
                )}
              </aside>
            </>
          )}
          <div className="pli-pdf-main">
            {previewVersion && previewSession && history && (
              <div className="pli-pdf-version-preview" data-version-preview>
                <VersionPreviewBar history={history} version={previewVersion} onBack={() => setPreviewVersion(null)} onRestored={() => setPreviewVersion(null)} />
                {previewMissing.length > 0 && (
                  <p className="pli-pdf-version-note" role="status">
                    This version uses {previewMissing.length === 1 ? "a file" : "files"} this editor no longer has ({previewMissing.join(", ")}), so some pages cannot be shown. Restoring it still brings the pages back, and they appear when the file is available again.
                  </p>
                )}
                <div className="pli-pdf-version-viewer" key={previewVersion.id}>
                  {props.renderVersionPreview ? (
                    props.renderVersionPreview(previewSession, { theme, zoom })
                  ) : (
                    <PliPdf session={previewSession} renderer={renderer} readOnly menu={false} topToolbar={false} pageTools={false} defaultSidebar={null} theme={theme} defaultZoom={zoom} password={props.password} className="pli-pdf-preview" />
                  )}
                </div>
              </div>
            )}
            {findOpen && <FindBar find={find} inputRef={findInput} onClose={() => setFindOpen(false)} actions={props.findActions?.(find, ctx)} replace={replaceOn ? replace : undefined} />}
            <div
              ref={scrollerRef}
              className="pli-pdf-scroller"
              role="region"
              aria-label="Document"
              tabIndex={0}
              data-active-tool={toolId ?? undefined}
              inert={(pageToolsOn && kit.tools.organise) || previewVersion ? true : undefined}
              onScroll={onScroll}
              onPointerUp={onSelectUp}
            >
              <div className="pli-pdf-content" style={{ width: layout.width, height: layout.height }}>
                {near.map((b) => {
                  const page = list[b.index]!;
                  return (
                    <PageView
                      key={page.id}
                      session={session}
                      pages={pages}
                      queue={queue}
                      readOnly={readOnly}
                      page={page}
                      index={b.index}
                      left={b.left}
                      top={b.top}
                      width={b.width}
                      height={b.height}
                      rotation={b.rotation}
                      scale={scale}
                      priority={inView.has(b.index) ? 0 : 1}
                      dpr={dpr}
                      highlights={highlights.get(b.index)}
                      tool={activeTool}
                      overlay={props.pageOverlay}
                      overlayDom={props.pageOverlayDom}
                      overlayBlend={props.pageOverlayBlend}
                    />
                  );
                })}
              </div>
              {count === 0 && <p className="pli-pdf-empty pli-pdf-nopages">This document has no pages.</p>}
            </div>
            <div className="pli-pdf-status" role="status" aria-live="polite">
              {count > 0 ? `Page ${current + 1} of ${count}` : ""}
            </div>
            {statusBarOn && count > 0 && <PdfStatusBar pageIndex={current} pageCount={count} onGo={(i) => goToPage(i)} inputRef={pageInput} zoom={zoom} zoomValue={zoomValue} onZoom={(z) => applyZoom(z)} commands={commands} panel={hasPanel ? { open: panelOpen, hint: panelKey !== null && panelKey !== ALWAYS, onToggle: () => toggleProperties() } : undefined} />}
            {pageToolsOn && kit.tools.organise && (
              <OrganiseGrid
                tools={kit.tools}
                pages={pages}
                queue={queue}
                list={list}
                current={current}
                selected={rawSelection}
                dpr={dpr}
                onGo={(i) => goToPage(i)}
                onSelect={(ids) => setPages(session, ids)}
                onClose={(to) => {
                  kit.tools.setOrganise(false);
                  if (to !== undefined) goToPage(to);
                  requestAnimationFrame?.(() => scrollerRef.current?.focus());
                }}
              />
            )}
          </div>
          {hasPanel && panelOpen && (
            <>
              {panelOverlay && <button type="button" className="pli-pdf-scrim" data-for="panel" aria-label="Close properties" tabIndex={-1} onClick={closePanel} />}
              <aside
                ref={panelRef}
                className="pli-pdf-right"
                aria-label="Properties panel"
                role={panelOverlay ? "dialog" : undefined}
                data-overlay={panelOverlay ? size : undefined}
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || e.defaultPrevented) return;
                  e.stopPropagation();
                  e.preventDefault();
                  closePanel();
                }}
              >
                <div className="pli-pdf-right-head">
                  <span className="pli-pdf-right-title">Properties</span>
                  <button type="button" className="pli-tool pli-pdf-tool pli-pdf-right-close" aria-label="Close properties" title="Close (Esc)" onClick={closePanel}>
                    {I.close}
                  </button>
                </div>
                <div className="pli-pdf-right-body">{typeof props.rightPanel === "function" ? props.rightPanel(ctx) : props.rightPanel}</div>
              </aside>
            </>
          )}
        </div>
        {pageToolsOn && (
          <>
            <PageDialogs tools={kit.tools} />
            <FileDialogs files={kit.files} />
            <Toasts notices={kit.notices} />
          </>
        )}
        {replaceOn && <ReplaceDialog replace={replace} />}
        {props.shareClient && <ShareDialog client={props.shareClient} open={dialog === "share"} onClose={() => setDialog(null)} title={kit.files.name} />}
        <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
        <PropertiesDialog session={session} readOnly={readOnly} open={dialog === "properties"} onClose={() => setDialog(null)} />
        <WordCountDialog session={session} open={dialog === "words"} onClose={() => setDialog(null)} />
      </div>
      </PageToolsProvider>
      </FilePickerProvider>
    </PdfViewContextValue.Provider>
  );
});
