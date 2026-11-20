import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  DEFAULT_PAGE,
  DocumentSession,
  anchorFor,
  documentVersionHistory,
  commentRanges,
  commentsAt,
  type CollabRoom,
  type DocOp,
  type Selection,
  type SyncClient,
  PliError,
  caret,
  createDoc,
  divider,
  embedImages,
  fromDocx,
  type DocxImportResult,
  imagesIn,
  resolveImages,
  pageBackground,
  pageBreak,
  pageDimensions,
  plainText,
  paragraph,
  textBox,
  type FloatingBlock,
  pageSetupOf,
  regionKeyFor,
  regionKind,
  serializeDoc,
  text,
  toDocx,
  toHtml,
  toMarkdown,
  toc,
  type Block,
  type Doc,
  type DocAnchor,
  type NoteName,
  type RegionName,
  cleanNoteBlocks,
  cloneBlocks,
  hasFirstPageRegions,
  isNoteName,
  isRegionLinked,
  resolveRegion,
  sectionShape,
  sectionsOf,
  styleList,
  noteIdOf,
  noteName,
  stripFootnoteRefs,
  usedFonts,
  withImageSources,
} from "@pli.dev/docs";
import type { FontRegistry } from "@pli.dev/core";
import { FontsProvider, useFonts } from "./ui/fonts";
import { ThemeContext, forcedTheme, type PliTheme } from "./theme";
import { EditorToolbar, MODIFIER_ALT, MODIFIER_MOD, MODIFIER_SHIFT } from "./EditorToolbar";
import { PHONE_QUERY, useKeyboardFrame, useMediaQuery, useSelectionState, useSessionRevision } from "./hooks";
import type { Layout } from "./layout/paginate";
import { PageCanvas, regionHasContent, type RegionActions, type RegionEdit, type RegionPlace, type ViewMode } from "./PageCanvas";
import type { PliEditorHandle } from "./PliEditor";
import { printDocument } from "./print";
import { handOver, saveFailure, useDownloadHandler, type DownloadFile, type DownloadHandler } from "./ui/downloads";
import { exportPdf } from "./pdf";
import { ColumnsDialog, ImageDialog, LinkDialog, PageSetupDialog, ParagraphDialog } from "./ui/dialogs";
import { ManageStylesDialog, NewStyleDialog } from "./ui/styles";
import { Ruler } from "./ui/Ruler";
import { MenuBar, type MenuDefinition } from "./ui/MenuBar";
import { extendMenus, type ExtraMenus, type MenuLabels } from "./ui/extensions";
import type { MenuEntry } from "./ui/primitives";
import { placeholderMenu, placeholderMode, type PlaceholderOptions } from "./ui/placeholders";
import { PlaceholdersContext } from "./session-context";
import { FilePickerProvider, pickWith, type FilePicker } from "./ui/file-picker";
import { CommentsPanel, PresenceBar, RemoteCursors } from "./ui/comments";
import { SuggestionsPanel } from "./ui/suggestions";
import { SyncIndicator } from "./ui/SyncIndicator";
import type { AutoSaveOptions, NamedVersion, ShareClient, Users, VersionHistory, VersionStorage } from "@pli.dev/core";
import { OfflineBanner } from "./ui/collab/status";
import { ShareButton, ShareDialog } from "./ui/collab/share";
import { VersionHistoryPanel, VersionPreviewBar } from "./ui/collab/versions";
import { useSyncStatus } from "./sync";
import { FindPanel, OutlinePanel, StatusBar, outlineOf } from "./ui/panels";
import { ListStartDialog, listMenuItems } from "./ui/lists";
import { pictureMenuItems } from "./ui/pictures";
import { ObjectDialog } from "./ui/objects";
import { imageBlockFromFile } from "./images";
import { RowHeightDialog, TableDialog, tableMenuItems } from "./ui/tables";

/** A file made by File > Download. */
export type PliDownload = DownloadFile;

export interface PliDocumentProps {
  session: DocumentSession;
  readOnly?: boolean;
  /** Show pages, or one continuous (pageless) column. Default `pages`. */
  defaultView?: ViewMode;
  /** Zoom as a multiple, such as 1 for 100%. */
  defaultZoom?: number;
  /** Show the menu bar. Default true. */
  menu?: boolean;
  /** Show the formatting toolbar. Default true. */
  toolbar?: boolean;
  /** Show the status bar with page, word count and zoom. Default true. */
  statusBar?: boolean;
  /** Show the ruler above the page, with margin and indent handles. Default true. */
  ruler?: boolean;
  /** Start with the outline panel open. */
  defaultOutlineOpen?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra controls in the title row, before the Share button, such as an Export button. */
  actions?: ReactNode;
  /** Controls at the far left of the title row, before the document's name: a back button, your logo, a breadcrumb. */
  startActions?: ReactNode;
  /** Controls at the far right of the title row, after Share: a profile menu, a close button. */
  endActions?: ReactNode;
  /**
   * `"light"`, `"dark"` or `"auto"` (default). Pass the theme your app is using so the editor matches it. `"auto"` follows
   * `data-theme="light" | "dark"` on `<html>` if your page sets it, and otherwise the system's setting.
   */
  theme?: PliTheme;
  /**
   * Items for the menus, and menus of your own. `{ File: [{ label: "Share…", onSelect }], AI: [{ label: "Summarize", onSelect }] }`
   * adds Share to the end of File and an AI menu before the last one. See `ExtraMenus` and
   * [Menus and file pickers](https://pli.dev/platform/menus-and-file-pickers/).
   */
  extraMenus?: ExtraMenus;
  /**
   * New text for the built-in menus, or a way to take an item out. `{ "File > Download": "Export", "Insert > Page break": false }`
   * renames File > Download and removes Page break. A key is the text as it is now, or a path of them; `false` removes. Also for
   * translating the menus. See `MenuLabels` and [Menus and file pickers](https://pli.dev/platform/menus-and-file-pickers/).
   */
  menuLabels?: MenuLabels;
  /**
   * For editing a template that makes documents from answers (see `generateDocument`): draws each `{{ … }}` as a chip, red when it
   * can't be read, and adds *Field*, *Only if…* and *Repeat for each…* to the Insert menu. `true` for the chips and the last two;
   * `{ fields: ["client.name", { path: "start", label: "Start date" }] }` to also list your answers by name, and `labels: true` to
   * show each tag by its name ("Client name", "Only if Plan is team") and hide the code, for people who aren't developers. Only
   * drawing: the text, and so the document, is the same with or without it.
   */
  placeholders?: boolean | PlaceholderOptions;
  /**
   * Your own way of choosing a file, for Insert > Image > Upload and File > Import DOCX: show your own dialog (files in your app,
   * a drive) and return the chosen `File`. Left out, the browser's file chooser opens. See `FilePicker`.
   */
  filePicker?: FilePicker;
  /**
   * Other people in the document: who is here and where their cursor is. Connected when the editor mounts and
   * disconnected when it unmounts. Comments need only the session's `comments` option, not a room.
   */
  room?: CollabRoom<DocAnchor>;
  /**
   * Live editing: a sync client that keeps `session` in step with a shared document (see `SyncClient`). The editor
   * starts it, shows whether your changes are saved, and is read-only until the first copy of the document has
   * arrived. It talks through its own room, which is connected for you unless you pass `room` as well.
   */
  sync?: SyncClient<Doc, DocOp, Selection | null>;
  /**
   * Who the document is shared with (see `ShareClient`): adds a Share button, in Google's style, that opens the Share dialog
   * (people from your directory, roles, link access).
   */
  share?: ShareClient;
  /**
   * The versions of the document (see `VersionHistory`): adds View > Version history, a button in the title row, and the side panel,
   * where a version can be looked at (the document shows it, read-only) and restored. Restoring adds a new version and keeps every
   * earlier one.
   */
  history?: VersionHistory<Doc, DocOp>;
  /**
   * Where versions are kept: a shortcut for `history` that makes the `VersionHistory` for you (`documentVersionHistory`). Needs
   * `users` (or comments, which have them). Saving and restoring need the `editor` role.
   */
  versions?: VersionStorage<Doc>;
  /**
   * With `versions`: keep a version now and then without anyone asking, so the history shows how the document changed. On by default;
   * `false` turns it off, or give `{ every, keep }` (see `AutoSaveOptions`).
   */
  autoSaveVersions?: boolean | AutoSaveOptions;
  /** Who is signed in, for `versions`. Defaults to the comments' users. */
  users?: Users;
  /** Start with the comments panel open. */
  defaultCommentsOpen?: boolean;
  /** The color of the pages. They follow the theme (dark pages in dark mode); `"light"` keeps them white. */
  paper?: "auto" | "light";
  /**
   * Called when a file can't be added (too big, wrong type for your storage, unreadable) or an export leaves
   * images out. Without it, the message appears in a notice above the page.
   */
  onStorageError?: (error: PliError, file?: File) => void;
  /**
   * Called after File > Import replaced the document with a .docx file, with what was read: the document, the
   * people who wrote its comments (already added to the session's users), and what couldn't be carried over.
   * Without it, anything that couldn't be carried over is shown in a notice above the page.
   */
  onImported?: (result: DocxImportResult) => void;
  /**
   * TrueType fonts to embed in PDF files made with File > Download > PDF, by name: `"Georgia"`, `"Georgia bold"`,
   * `"Georgia italic"`, `"Georgia bold italic"`. Without a font for the text's family, the nearest standard PDF
   * font is used, which has only Western European characters.
   */
  pdfFonts?: Record<string, Uint8Array>;
  /**
   * The fonts of this editor (the picker's list, how fonts are loaded, which are embedded in PDF files). Defaults to
   * `defaultFonts()` from `@pli.dev/core`: every Office font and Google family, fetched from Fontsource when used. Fonts the
   * registry can fetch are embedded in PDF files too, without `pdfFonts`; `pdfFonts` wins for names it has.
   */
  fonts?: FontRegistry;
  /** Called for Ctrl/Cmd+S. Without it, the shortcut does nothing. */
  onSave?: (doc: Doc) => void;
  /**
   * Called with each file File > Download makes (DOCX, PDF, Markdown, HTML, JSON), instead of the browser downloading it: save it
   * in your own storage, or show the phone's share sheet (a web view inside a native app, Capacitor for instance, can't download a
   * file). The second argument has `browserDownload()`, the default, to call for the files or the places you don't handle. If the
   * function throws or rejects the editor says the file couldn't be saved. Left out, the nearest `DownloadProvider`'s function is
   * used, and without one the browser downloads the file. See [Saving files your way](https://pli.dev/platform/saving-files/).
   */
  onDownload?: DownloadHandler;
  className?: string;
  "aria-label"?: string;
}

const NO_STYLES = {};
const NO_THREADS: readonly never[] = [];
const NO_PEERS: readonly never[] = [];

const MOD = MODIFIER_MOD;
const SHIFT = MODIFIER_SHIFT;
const ALT = MODIFIER_ALT;

const fileName = (doc: Doc) => (doc.title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-");

/**
 * A complete document editor: menu bar, formatting toolbar, pages with headers and footers,
 * outline, find and replace, and a status bar. Built entirely from the public pieces of this
 * package, so any part can be replaced.
 */
export function PliDocument({
  session,
  readOnly: readOnlyProp = false,
  defaultView = "pages",
  defaultZoom = 1,
  menu = true,
  toolbar = true,
  statusBar = true,
  ruler = true,
  defaultOutlineOpen = false,
  placeholder,
  autoFocus,
  actions,
  startActions,
  endActions,
  theme,
  extraMenus,
  menuLabels,
  placeholders,
  filePicker,
  room: roomProp,
  sync,
  share,
  history: historyProp,
  versions,
  autoSaveVersions,
  users: usersProp,
  defaultCommentsOpen = false,
  paper = "auto",
  onStorageError,
  onImported,
  pdfFonts,
  fonts: fontsProp,
  onSave,
  onDownload: onDownloadProp,
  className,
  ...aria
}: PliDocumentProps) {
  useSessionRevision(session);
  const doc = session.state;
  // How tags are drawn. Kept the same object while the options say the same, so the page isn't drawn again for nothing.
  const chipKey = typeof placeholders === "object" ? JSON.stringify([placeholders.labels, placeholders.fields]) : String(!!placeholders);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `chipKey` stands for the options
  const chipMode = useMemo(() => placeholderMode(placeholders), [chipKey]);
  // Live editing: until the first copy of the document has come from the server, what is shown is a placeholder.
  const syncState = useSyncStatus(sync);
  const loading = !!sync && syncState.version === null;
  const [previewVersion, setPreviewVersion] = useState<NamedVersion<Doc> | null>(null);
  const readOnly = readOnlyProp || loading || !!previewVersion;
  const phone = useMediaQuery(PHONE_QUERY);
  // On a phone the toolbar is at the bottom, above the keyboard, so it stays in reach while you type.
  const dockToolbar = phone && toolbar && !readOnlyProp;
  const keyboard = useKeyboardFrame(dockToolbar);
  const room = roomProp ?? (sync?.room as CollabRoom<DocAnchor> | undefined);

  const [view, setView] = useState<ViewMode>(defaultView);
  const [zoom, setZoom] = useState(defaultZoom);
  const [outlineOpen, setOutlineOpen] = useState(defaultOutlineOpen);
  const [showRuler, setShowRuler] = useState(ruler);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [region, setRegion] = useState<RegionEdit | null>(null);
  const [focusedRegion, setFocusedRegion] = useState(false);
  const [dialog, setDialog] = useState<null | "link" | "image" | "page" | "table" | "rowHeight" | "listStart" | "paragraph" | "columns" | "styles" | "newParagraphStyle" | "newCharacterStyle" | "object">(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);

  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyUsers = usersProp ?? session.comments?.users;
  // Made in an effect, so that a history that was stopped when the editor was taken away is made again when it comes back (React
  // does this in development), instead of a stopped one being kept.
  const [ownHistory, setOwnHistory] = useState<VersionHistory<Doc, DocOp> | null>(null);
  useEffect(() => {
    if (historyProp || !versions || !historyUsers) {
      setOwnHistory(null);
      return;
    }
    const made = documentVersionHistory(session, {
      storage: versions,
      users: historyUsers,
      version: () => sync?.version ?? null,
      ...(autoSaveVersions === false ? {} : { autoSave: typeof autoSaveVersions === "object" ? autoSaveVersions : {} }),
    });
    setOwnHistory(made);
    return () => made.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the options are read once, when the history is made
  }, [session, historyProp, versions, historyUsers, sync]);
  const history = historyProp ?? ownHistory ?? undefined;
  /** The version being looked at, as a document of its own that nobody can change. */
  const previewSession = useMemo(() => (previewVersion ? new DocumentSession(JSON.parse(JSON.stringify(previewVersion.state)) as Doc) : null), [previewVersion]);
  const showHistory = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) setPreviewVersion(null);
  };
  const [draft, setDraft] = useState<{ selection: NonNullable<DocumentSession["selection"]>; quote: string } | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const comments = session.comments;
  const threads = useSyncExternalStore(
    useCallback((listener: () => void) => comments?.subscribe(listener) ?? (() => {}), [comments]),
    () => comments?.threads ?? NO_THREADS,
    () => NO_THREADS,
  );
  const peers = useSyncExternalStore(
    useCallback((listener: () => void) => room?.subscribe(listener) ?? (() => {}), [room]),
    () => room?.peers ?? NO_PEERS,
    () => NO_PEERS,
  );

  const bodyRef = useRef<PliEditorHandle>(null);
  const regionRef = useRef<PliEditorHandle>(null);

  // Formatting applies to whichever editor, the body or a header or footer, was focused last.
  const target = region && focusedRegion ? region.session : session;
  const targetRef = region && focusedRegion ? regionRef : bodyRef;
  const state = useSelectionState(target);
  const focusTarget = useCallback(() => targetRef.current?.focus(), [targetRef]);

  // The open region, readable from callbacks without re-creating them or running side effects inside a state updater.
  const regionNow = useRef<RegionEdit | null>(null);
  regionNow.current = region;

  /** What a section holds of its own for a header or footer: the document's for section 0. */
  const ownContent = (owner: number, name: RegionName) => (owner === 0 ? session.state[name] : sectionsOf(session.state)[owner]?.start?.regions?.[name]);

  const endRegionEdit = useCallback(() => {
    const current = regionNow.current;
    if (!current) return;
    if (isNoteName(current.name)) {
      // A footnote keeps its text even when empty, and can't hold images, tables or other notes.
      const id = noteIdOf(current.name);
      const previous = session.state.footnotes?.[id];
      const next = cleanNoteBlocks(current.session.state.blocks);
      if (previous && JSON.stringify(next) !== JSON.stringify(previous)) session.setFootnote(id, next);
      regionNow.current = null;
      setRegion(null);
      setFocusedRegion(false);
      return;
    }
    const { name, owner } = current;
    const blocks = stripFootnoteRefs(current.session.state.blocks);
    // The first section has no header when it is empty. A later one keeps an empty one, so it doesn't fall back to the section before.
    const next = regionHasContent(blocks) ? blocks : owner === 0 ? null : [];
    const previous = ownContent(owner, name) ?? null;
    if (JSON.stringify(next) !== JSON.stringify(previous)) session.setSectionRegion(owner, name, next);
    // An image still uploading keeps its temporary address for now. When the upload ends, point the saved copy at the stored file.
    if (current.session.pendingUploads > 0) {
      const edited = current.session;
      void edited.whenUploadsSettle().then(() => {
        const stored = new Map(imagesIn(edited.state.blocks).filter((i) => !i.src.startsWith("blob:")).map((i) => [i.id, i.src]));
        const live = ownContent(owner, name);
        if (!live || stored.size === 0) return;
        const patched = withImageSources(live, stored);
        if (JSON.stringify(patched) !== JSON.stringify(live)) session.setSectionRegion(owner, name, patched);
      });
    }
    regionNow.current = null;
    setRegion(null);
    setFocusedRegion(false);
  }, [session]);

  const beginRegionEdit = useCallback(
    (name: RegionName | NoteName, page = 0, place: RegionPlace = { owner: 0, section: 0, first: page === 0 }) => {
      if (readOnly || view !== "pages") return;
      const current = regionNow.current;
      if (current?.name === name && current.owner === place.owner) {
        setRegion({ ...current, page, section: place.section, first: place.first });
      } else {
        // Switching from one header or footer to another saves the first.
        if (current) endRegionEdit();
        const blocks = isNoteName(name) ? session.state.footnotes?.[noteIdOf(name)] : ownContent(place.owner, name);
        const regionSession = new DocumentSession(createDoc(name, blocks && blocks.length > 0 ? structuredClone(blocks) : [paragraph("")]), { storage: session.storage ?? undefined });
        const last = regionSession.state.blocks[regionSession.state.blocks.length - 1];
        if (last && "runs" in last) regionSession.select(caret(last.id, last.runs.reduce((n, r) => n + r.text.length, 0)));
        setRegion({ name, page, ...place, session: regionSession });
      }
      setFocusedRegion(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ownContent` reads the session, which is stable
    [readOnly, session, view, endRegionEdit],
  );

  const regionActions: RegionActions = useMemo(
    () => ({
      done: () => {
        endRegionEdit();
        bodyRef.current?.focus();
      },
      toggle: (option) => {
        const current = regionNow.current;
        if (!current || isNoteName(current.name)) return;
        // The page being edited may now show a different header or footer, so save this one and open that one.
        endRegionEdit();
        if (option === "differentFirstPage") {
          session.setSectionFirstPage(current.section, !hasFirstPageRegions(session.state, sectionsOf(session.state), current.section));
        } else {
          session.setRegionOptions({ differentOddEven: !session.state.page?.differentOddEven });
        }
        const sections = sectionsOf(session.state);
        const options = { differentFirstPage: hasFirstPageRegions(session.state, sections, current.section), differentOddEven: session.state.page?.differentOddEven };
        const name = regionKeyFor(options, regionKind(current.name), current.page + 1, current.first);
        const owner = resolveRegion(session.state, sections, current.section, name).owner;
        beginRegionEdit(name, current.page, { owner, section: current.section, first: current.first });
      },
      link: () => {
        const current = regionNow.current;
        if (!current || isNoteName(current.name) || current.section === 0) return;
        const name = current.name;
        endRegionEdit();
        const before = sectionsOf(session.state);
        if (isRegionLinked(before, current.section, name)) {
          // Taking its own: it starts as a copy of what it showed, so nothing changes until it is edited.
          const shown = resolveRegion(session.state, before, current.section, name).blocks;
          session.setSectionRegion(current.section, name, shown && shown.length > 0 ? cloneBlocks(shown) : []);
        } else {
          session.setSectionRegion(current.section, name, null);
        }
        const owner = resolveRegion(session.state, sectionsOf(session.state), current.section, name).owner;
        beginRegionEdit(name, current.page, { owner, section: current.section, first: current.first });
      },
      columns: (count) => {
        regionNow.current?.session.insertColumns(count);
        regionRef.current?.focus();
      },
      field: (field) => {
        regionNow.current?.session.insertField(field);
        regionRef.current?.focus();
      },
      clear: () => {
        const edit = regionNow.current;
        if (!edit) return;
        edit.session.selectAll();
        edit.session.deleteSelection();
        regionRef.current?.focus();
      },
    }),
    [session, endRegionEdit, beginRegionEdit],
  );

  // Leaving a region (clicking into the body) saves it; so does switching away from pages view.
  useEffect(() => {
    if (view !== "pages" && region) endRegionEdit();
  }, [view, region, endRegionEdit]);

  const onBodyFocusChange = useCallback(
    (focused: boolean) => {
      if (!focused) return;
      setFocusedRegion(false);
      if (region) endRegionEdit();
    },
    [region, endRegionEdit],
  );

  const handleLayout = useCallback((next: Layout) => setLayout(next), []);

  const navigateTo = useCallback(
    (id: string) => {
      session.select(caret(id, 0));
      const root = bodyRef.current?.element;
      const el = root && [...root.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) => e.getAttribute("data-block-id") === id);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      bodyRef.current?.focus();
    },
    [session],
  );

  const [notice, setNotice] = useState<string | null>(null);
  const reportStorageError = useCallback(
    (error: PliError, file?: File) => {
      if (onStorageError) onStorageError(error, file);
      else setNotice(file ? `${file.name}: ${error.message}` : error.message);
    },
    [onStorageError],
  );

  /**
   * The document as it should be exported: waits for uploads in progress, then, if the app keeps files in
   * its own storage, swaps each stored reference for the file itself (`embed`) or its address (`resolve`).
   * An image that can't be fetched stays as a visible placeholder, and the person is told.
   */
  const prepareExport = useCallback(
    async (mode: "embed" | "resolve" | "none"): Promise<Doc> => {
      await session.whenUploadsSettle();
      const storage = session.storage;
      if (!storage || mode === "none") return session.state;
      const { doc: ready, failed } = await (mode === "embed" && storage.canRead ? embedImages : resolveImages)(session.state, storage);
      if (failed.length > 0) {
        const first = failed[0]!.error.message;
        reportStorageError(new PliError("storage", failed.length === 1 ? `An image couldn't be included. ${first}` : `${failed.length} images couldn't be included. ${first}`));
      }
      return ready;
    },
    [session, reportStorageError],
  );

  const fontRegistry = useFonts(fontsProp);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const onDownload = useDownloadHandler(onDownloadProp);
  /** Hands a made file to the browser to download, or to `onDownload` when the app saves files itself. */
  const deliver = useCallback(
    (name: string, data: BlobPart, type: string) => {
      void handOver(onDownload, name, data, type).catch((cause) => reportStorageError(cause instanceof PliError ? cause : new PliError("unsupported", saveFailure(cause), { cause })));
    },
    [onDownload, reportStorageError],
  );

  /** Downloads the pages as they are drawn, as a PDF. Switches to the page view while it reads them, then back. */
  const exportAsPdf = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    await session.whenUploadsSettle();
    const wasView = viewRef.current;
    try {
      if (wasView !== "pages") {
        setView("pages");
        for (let i = 0; i < 60 && !root.querySelector(".pli-sheet[data-page]"); i++) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 150));
      }
      // Fonts the host didn't supply are fetched from the registry's source (a Google family becomes real text, not Helvetica).
      const wanted = usedFonts(session.state).filter((name) => !pdfFonts || !Object.keys(pdfFonts).some((k) => k.toLowerCase() === name.toLowerCase()));
      const fetched = await fontRegistry.pdfFonts(wanted, { text: (root.textContent ?? "").slice(0, 60000) });
      const { bytes, warnings } = await exportPdf(root, { title: session.state.title, fonts: { ...fetched.fonts, ...pdfFonts } });
      warnings.push(...fetched.warnings.map((w) => w.replace(/\.$/, "")));
      deliver(`${fileName(session.state)}.pdf`, bytes as BlobPart, "application/pdf");
      if (warnings.length > 0) setNotice(`The PDF was made, but ${warnings.join("; ")}.`);
    } catch (cause) {
      reportStorageError(cause instanceof PliError ? cause : new PliError("unsupported", "The PDF couldn't be made", { cause }));
    } finally {
      if (wasView !== "pages") setView(wasView);
    }
  }, [session, pdfFonts, fontRegistry, reportStorageError, deliver]);

  const exportAs = useCallback(
    async (kind: "docx" | "md" | "html" | "json") => {
      const name = fileName(session.state);
      if (kind === "json") {
        await session.whenUploadsSettle();
        return deliver(`${name}.pli.json`, serializeDoc(session.state), "application/json");
      }
      const ready = await prepareExport(kind === "md" ? "resolve" : "embed");
      if (kind === "docx") deliver(`${name}.docx`, toDocx(ready) as BlobPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      else if (kind === "md") deliver(`${name}.md`, toMarkdown(ready), "text/markdown");
      else deliver(`${name}.html`, toHtml(ready, { fullDocument: true }), "text/html");
    },
    [session, prepareExport, deliver],
  );

  const print = useCallback(() => void prepareExport("embed").then(printDocument), [prepareExport]);

  const importInput = useRef<HTMLInputElement>(null);
  const importFile = useCallback(
    async (file: File) => {
      try {
        const result = fromDocx(new Uint8Array(await file.arrayBuffer()), { title: file.name.replace(/\.docx$/i, ""), trackedChanges: session.suggestionsEnabled ? "keep" : "accept" });
        session.replaceDocument(result.doc);
        session.comments?.users.add(result.authors);
        session.suggestionUsers?.add(result.authors);
        if (onImported) onImported(result);
        else if (result.warnings.length > 0) setNotice(`${file.name} was opened, but ${result.warnings.join("; ")}.`);
      } catch (cause) {
        const error = cause instanceof PliError ? cause : new PliError("invalid_document", `${file.name} couldn't be opened`, { cause });
        reportStorageError(error, file);
      }
    },
    [session, onImported, reportStorageError],
  );

  const insertImage = (block: Block) => {
    target.insertBlockAtCaret(block);
    focusTarget();
  };

  /**
   * Insert > Footnote: puts a reference at the caret and opens its note on the page where it lands, ready to
   * type in. The page isn't known until the layout has caught up, so the note opens when it appears there.
   */
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const insertFootnote = () => {
    if (readOnly) return;
    if (regionNow.current) endRegionEdit();
    const id = session.insertFootnote();
    if (id) setPendingNote(id);
  };
  useEffect(() => {
    if (!pendingNote) return;
    if (view !== "pages") {
      setPendingNote(null);
      return;
    }
    for (const [page, ids] of layout?.notes ?? []) {
      if (ids.includes(pendingNote)) {
        setPendingNote(null);
        beginRegionEdit(noteName(pendingNote), page - 1);
        return;
      }
    }
  }, [pendingNote, layout, view, beginRegionEdit]);

  /** Double-clicking a footnote number in the text opens that note at the bottom of its page. */
  const openNoteAt = (event: React.MouseEvent) => {
    const ref = (event.target as HTMLElement).closest?.("[data-footnote]");
    const id = ref?.getAttribute("data-footnote");
    if (!id || readOnly || view !== "pages") return;
    for (const [page, ids] of layout?.notes ?? []) {
      if (ids.includes(id)) {
        event.preventDefault();
        beginRegionEdit(noteName(id), page - 1);
        return;
      }
    }
  };

  /** Whether a comment can be started on what is selected now. */
  const commentSelection = session.selection;
  const canStartComment = !!comments && !loading && !region && !!commentSelection && !!comments.can("comment") && !!anchorFor(doc, commentSelection);
  const startComment = () => {
    const selection = session.selection;
    if (!comments || !selection) return;
    const anchor = anchorFor(session.state, selection);
    if (!anchor || !comments.can("comment")) return;
    setDraft({ selection, quote: anchor.quote });
    setCommentsOpen(true);
  };

  /** Opens a thread: shows it in the panel and moves the caret to its text. */
  const openThread = useCallback(
    (id: string | null) => {
      setActiveThread(id);
      if (!id) return;
      const first = commentRanges(session.state, id)[0];
      if (!first) return;
      session.select(caret(first.block, first.from));
      const root = bodyRef.current?.element;
      const el = root && [...root.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) => e.getAttribute("data-block-id") === first.block);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [session],
  );

  /** Clicking highlighted text opens its thread. */
  const openCommentAt = (event: React.MouseEvent) => {
    const mark = (event.target as HTMLElement).closest?.(".pli-comment");
    if (!mark || !comments) return;
    const ids = (mark.getAttribute("data-comments") ?? "").split(" ");
    const id = ids.find((i) => comments.thread(i) && !comments.thread(i)!.resolved) ?? ids.find((i) => comments.thread(i));
    if (!id) return;
    setActiveThread(id);
    setCommentsOpen(true);
  };

  // With the caret in commented text, that thread is the open one.
  useEffect(() => {
    if (!comments || !commentsOpen) return;
    const ids = commentsAt(session.state, session.selection);
    if (ids.length > 0 && !ids.includes(activeThread ?? "")) setActiveThread(ids.find((i) => comments.thread(i) && !comments.thread(i)!.resolved) ?? ids[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the selection changes identity on each move
  }, [session.selection, commentsOpen]);

  // The threads' colors: resolved ones are not highlighted, and the open one is darker.
  const commentStyles = useMemo(() => {
    const rules: string[] = [];
    const safe = (id: string) => id.replace(/[^\w-]/g, "");
    for (const t of threads) if (t.resolved) rules.push(`.pli-document .pli-comment[data-comments="${safe(t.id)}"]{background:transparent;border-bottom-color:transparent}`);
    if (activeThread) rules.push(`.pli-document .pli-comment[data-comments~="${safe(activeThread)}"]{background:var(--pli-comment-active)}`);
    return rules.join("");
  }, [threads, activeThread]);

  // Live editing starts with the editor and stops with it.
  useEffect(() => {
    if (!sync) return;
    sync.start();
    return () => sync.stop();
  }, [sync]);

  // Leaving with changes that haven't been sent would lose them: ask first.
  useEffect(() => {
    if (!sync) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (sync.unsynced === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sync]);

  // If the document had to be reloaded from the server, say so, and say what it cost.
  const lastResync = syncState.lastResync;
  useEffect(() => {
    if (lastResync && lastResync.lost > 0) setNotice(`The document was reloaded from the server, so ${lastResync.lost === 1 ? "your last change" : `your last ${lastResync.lost} changes`} may not have been saved.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new reload is a new object
  }, [lastResync]);

  // Other people: join the room, and say where the cursor is.
  useEffect(() => {
    if (!room) return;
    room.attachComments(comments);
    void Promise.resolve(room.connect()).catch(() => {});
    return () => {
      room.disconnect();
      room.attachComments(null);
    };
  }, [room, comments]);
  const presenceSelection = session.selection;
  useEffect(() => {
    if (!room) return;
    const timer = setTimeout(() => room.setPresence({ selection: presenceSelection }), 120);
    return () => clearTimeout(timer);
  }, [room, presenceSelection]);

  const insertPageNumber = () => {
    if (region) {
      region.session.insertField("page");
      return;
    }
    if (!regionHasContent(session.state.footer)) {
      session.setRegion("footer", [{ ...paragraph([text("1", { field: "page" })], "center") }]);
    } else {
      beginRegionEdit("footer", 0);
    }
  };

  const linkState = state.link;
  const selection = target.selection;
  const collapsed = !selection || (selection.anchor.block === selection.focus.block && selection.anchor.offset === selection.focus.offset);

  const copyOrCut = (command: "copy" | "cut") => () => {
    focusTarget();
    document.execCommand(command);
  };

  /**
   * Edit > Paste. Reads the clipboard directly, which needs the browser's permission, and keeps the
   * formatting; the keyboard shortcut works everywhere and is the fallback.
   */
  const pasteFromClipboard = async (plain: boolean) => {
    const editor = targetRef.current;
    try {
      let html: string | undefined;
      let text: string | undefined;
      let picture: File | undefined;
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes("text/html")) html ??= await (await item.getType("text/html")).text();
          if (item.types.includes("text/plain")) text ??= await (await item.getType("text/plain")).text();
          const kind = item.types.find((t) => t.startsWith("image/"));
          if (kind) picture ??= new File([await item.getType(kind)], "pasted-image", { type: kind });
        }
      } else {
        text = await navigator.clipboard.readText();
      }
      if (picture && !text?.trim()) await editor?.insertImages([picture]);
      else editor?.paste({ html, text, plain });
    } catch {
      try {
        const text = await navigator.clipboard.readText();
        if (text) editor?.paste({ text, plain: true });
      } catch {
        // Reading the clipboard was refused; the keyboard shortcut still works.
      }
    }
    focusTarget();
  };

  // Pictures and text boxes that float on the page.
  const textWidthPx = Math.max(100, (pageDimensions(pageSetupOf(doc)).width - pageSetupOf(doc).margins.left - pageSetupOf(doc).margins.right) * 96);
  const insertTextBox = () => {
    if (readOnly || region) return;
    const width = Math.min(300, textWidthPx);
    session.insertFloat(textBox("", { x: { from: "column" }, y: { from: "paragraph" }, width, height: 120, fill: "#ffffff", line: { color: "#000000", width: 1 } }));
    focusTarget();
  };
  const insertShape = (shape: "rect" | "round_rect" | "ellipse") => {
    if (readOnly || region) return;
    session.insertFloat(textBox("", { x: { from: "column" }, y: { from: "paragraph" }, width: 180, height: 110, shape, fill: "#c7d2fe", line: { color: "#4f46e5", width: 2 } }));
    focusTarget();
  };
  const chooseBackground = () => {
    if (readOnly || region) return;
    void pickWith(filePicker, { purpose: "image", accept: "image/*", label: "Choose a picture for the page" }).then(async ([file]) => {
      if (!file) return;
      try {
        const picture = await imageBlockFromFile(file, { maxWidth: 4000, maxDimension: 2400 });
        session.insertFloat(pageBackground(picture.src, { width: picture.width, height: picture.height }, doc.page, { alt: picture.alt ?? "" }));
        focusTarget();
      } catch (error) {
        reportStorageError(error instanceof PliError ? error : new PliError("storage", error instanceof Error ? error.message : "That picture couldn't be used."));
      }
    });
  };
  /** The floating pictures and text boxes, for choosing one that can't be clicked on (one behind the text). */
  const floatLabel = (block: FloatingBlock, n: number): string => {
    if (block.type === "image") return `${block.float.behind ? "Background picture" : "Picture"} ${n}${block.alt ? `: ${block.alt.slice(0, 24)}` : ""}`;
    const first = block.rows[0]?.cells[0]?.blocks.map((b) => ("runs" in b ? plainText(b.runs) : "")).find((t) => t.trim() !== "");
    return `${block.float.fill || block.float.line ? (first ? "Text box" : "Shape") : "Text box"} ${n}${first ? `: ${first.trim().slice(0, 24)}` : ""}`;
  };
  const toggleBehind = () => {
    const current = state.floating;
    if (!current) return;
    session.setFloat({ behind: current.float.behind ? undefined : true }, current.id);
    focusTarget();
  };
  const deleteObject = () => {
    const current = state.floating;
    if (!current) return;
    session.transact([{ type: "delete_block", id: current.id }]);
    focusTarget();
  };

  const chooseImport = () => {
    if (!filePicker) return importInput.current?.click();
    void pickWith(filePicker, { purpose: "import", accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Import a DOCX file" }).then(([file]) => file && void importFile(file));
  };

  const menus: MenuDefinition[] = useMemo(
    () => [
      {
        label: "File",
        items: [
          {
            label: "Download",
            items: [
              { label: "PDF document (.pdf)", onSelect: () => void exportAsPdf() },
              { label: "DOCX document (.docx)", onSelect: () => void exportAs("docx") },
              { label: "Markdown (.md)", onSelect: () => void exportAs("md") },
              { label: "Web page (.html)", onSelect: () => void exportAs("html") },
              { label: "Pli document (.json)", onSelect: () => void exportAs("json") },
            ],
          },
          { label: "Import DOCX…", disabled: readOnly || !!region, onSelect: chooseImport },
          "separator",
          { label: "Page setup…", onSelect: () => setDialog("page"), disabled: readOnly },
          { label: "Print…", shortcut: `${MOD}P`, onSelect: print },
        ],
      },
      {
        label: "Edit",
        items: [
          { label: "Undo", shortcut: `${MOD}Z`, disabled: readOnly || !target.canUndo, onSelect: () => { target.undo(); focusTarget(); } },
          { label: "Redo", shortcut: `${SHIFT}${MOD}Z`, disabled: readOnly || !target.canRedo, onSelect: () => { target.redo(); focusTarget(); } },
          "separator",
          { label: "Cut", shortcut: `${MOD}X`, disabled: readOnly || collapsed, onSelect: copyOrCut("cut") },
          { label: "Copy", shortcut: `${MOD}C`, disabled: collapsed, onSelect: copyOrCut("copy") },
          { label: "Paste", shortcut: `${MOD}V`, disabled: readOnly, onSelect: () => void pasteFromClipboard(false) },
          { label: "Paste without formatting", shortcut: `${SHIFT}${MOD}V`, disabled: readOnly, onSelect: () => void pasteFromClipboard(true) },
          "separator",
          { label: "Select all", shortcut: `${MOD}A`, onSelect: () => { target.selectAll(); focusTarget(); } },
          "separator",
          { label: "Find and replace…", shortcut: `${MOD}F`, onSelect: () => setFind({ replace: true }) },
        ],
      },
      {
        label: "View",
        items: [
          { label: "Print layout (pages)", checked: view === "pages", onSelect: () => setView("pages") },
          { label: "Pageless", checked: view === "continuous", onSelect: () => setView("continuous") },
          "separator",
          { label: "Show outline", checked: outlineOpen, onSelect: () => setOutlineOpen((v) => !v) },
          ...(comments ? [{ label: "Show comments", checked: commentsOpen, onSelect: () => setCommentsOpen((v) => !v) }] : []),
          ...(history ? [{ label: "Version history", checked: historyOpen, onSelect: () => showHistory(!historyOpen) }] : []),
          ...(session.suggestionsEnabled
            ? [
                { label: "Show suggestions", checked: suggestionsOpen, onSelect: () => setSuggestionsOpen((v) => !v) },
                ...(session.canSuggest && !readOnlyProp
                  ? [{ label: "Suggest edits", checked: session.suggesting, onSelect: () => { session.setSuggesting(!session.suggesting); focusTarget(); } }]
                  : []),
              ]
            : []),
          { label: "Show ruler", checked: showRuler && view === "pages", disabled: view !== "pages", onSelect: () => setShowRuler((v) => !v) },
          "separator",
          {
            label: "Zoom",
            items: [0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => ({ label: `${Math.round(z * 100)}%`, checked: zoom === z, onSelect: () => setZoom(z) })),
          },
        ],
      },
      {
        label: "Insert",
        items: [
          { label: "Image…", disabled: readOnly, onSelect: () => setDialog("image") },
          { label: "Text box", disabled: readOnly || !!region, onSelect: insertTextBox },
          {
            label: "Shape",
            disabled: readOnly || !!region,
            items: [
              { label: "Rectangle", onSelect: () => insertShape("rect") },
              { label: "Rounded rectangle", onSelect: () => insertShape("round_rect") },
              { label: "Oval", onSelect: () => insertShape("ellipse") },
            ],
          },
          { label: "Page background…", disabled: readOnly || !!region, onSelect: chooseBackground },
          { label: "Link…", shortcut: `${MOD}K`, disabled: readOnly, onSelect: () => setDialog("link") },
          {
            label: "Table",
            disabled: readOnly || !!state.table,
            items: [
              ...([[2, 2], [3, 3], [4, 4], [5, 3]] as const).map(([rows, columns]) => ({
                label: `${rows} × ${columns}`,
                onSelect: () => { target.insertTable(rows, columns, { headerRow: true }); focusTarget(); },
              })),
              "separator" as const,
              { label: "Custom size…", onSelect: () => setDialog("table") },
            ],
          },
          { label: "Footnote", shortcut: `${MOD}${ALT}F`, disabled: readOnly || !!region, onSelect: insertFootnote },
          ...(comments ? [{ label: "Comment", shortcut: `${MOD}${ALT}M`, disabled: !canStartComment, onSelect: startComment }] : []),
          {
            label: "Section break",
            disabled: readOnly || !!region,
            items: [
              { label: "Next page", onSelect: () => { session.insertSectionBreak("next_page"); focusTarget(); } },
              { label: "Continuous", onSelect: () => { session.insertSectionBreak("continuous"); focusTarget(); } },
            ],
          },
          { label: "Horizontal line", disabled: readOnly, onSelect: () => { target.insertBlockAtCaret(divider()); focusTarget(); } },
          { label: "Page break", shortcut: `${MOD}Enter`, disabled: readOnly || !!region, onSelect: () => { session.insertBlockAtCaret(pageBreak()); focusTarget(); } },
          "separator",
          {
            label: "Table of contents",
            disabled: readOnly || !!region,
            items: [
              { label: "Headings 1–2", onSelect: () => { session.insertBlockAtCaret(toc(2)); focusTarget(); } },
              { label: "Headings 1–3", onSelect: () => { session.insertBlockAtCaret(toc(3)); focusTarget(); } },
              { label: "All headings", onSelect: () => { session.insertBlockAtCaret(toc(6)); focusTarget(); } },
            ],
          },
          "separator",
          { label: "Header", disabled: readOnly || view !== "pages", onSelect: () => beginRegionEdit(regionKeyFor(session.state.page, "header", 1), 0) },
          { label: "Footer", disabled: readOnly || view !== "pages", onSelect: () => beginRegionEdit(regionKeyFor(session.state.page, "footer", 1), 0) },
          { label: "Page number", disabled: readOnly || view !== "pages", onSelect: insertPageNumber },
          { label: "Page count", disabled: !region, onSelect: () => region?.session.insertField("pages") },
          ...(placeholders ? (["separator", ...placeholderMenu(() => target, placeholders === true ? {} : placeholders, readOnly, focusTarget)] as MenuEntry[]) : []),
        ],
      },
      {
        label: "Format",
        items: [
          {
            label: "Text",
            disabled: readOnly,
            items: [
              { label: "Bold", shortcut: `${MOD}B`, checked: state.marks.bold, onSelect: () => { target.toggleMark("bold"); focusTarget(); } },
              { label: "Italic", shortcut: `${MOD}I`, checked: state.marks.italic, onSelect: () => { target.toggleMark("italic"); focusTarget(); } },
              { label: "Underline", shortcut: `${MOD}U`, checked: state.marks.underline, onSelect: () => { target.toggleMark("underline"); focusTarget(); } },
              { label: "Strikethrough", shortcut: `${SHIFT}${MOD}X`, checked: state.marks.strike, onSelect: () => { target.toggleMark("strike"); focusTarget(); } },
              { label: "Superscript", shortcut: `${MOD}.`, checked: state.marks.superscript, onSelect: () => { target.toggleMark("superscript"); focusTarget(); } },
              { label: "Subscript", shortcut: `${MOD},`, checked: state.marks.subscript, onSelect: () => { target.toggleMark("subscript"); focusTarget(); } },
            ],
          },
          {
            label: "Paragraph styles",
            disabled: readOnly,
            items: [
              { label: "Normal text", shortcut: `${MOD}${ALT}0`, onSelect: () => { target.setBlockType({ type: "paragraph" }); focusTarget(); } },
              { label: "Title", onSelect: () => { target.setBlockType({ type: "title" }); focusTarget(); } },
              { label: "Subtitle", onSelect: () => { target.setBlockType({ type: "subtitle" }); focusTarget(); } },
              ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
                label: `Heading ${level}`,
                shortcut: `${MOD}${ALT}${level}`,
                onSelect: () => { target.setBlockType({ type: "heading", level }); focusTarget(); },
              })),
              { label: "Quote", onSelect: () => { target.setBlockType({ type: "quote" }); focusTarget(); } },
              { label: "Code block", onSelect: () => { target.setBlockType({ type: "code_block" }); focusTarget(); } },
            ],
          },
          {
            label: "Your styles",
            disabled: readOnly,
            items: [
              ...styleList(doc, "paragraph").map(({ id, style }) => ({
                label: style.name,
                checked: state.paragraphStyle === id,
                onSelect: () => { target.applyParagraphStyle(id); focusTarget(); },
              })),
              ...(styleList(doc, "paragraph").length > 0 ? ["separator" as const] : []),
              ...styleList(doc, "character").map(({ id, style }) => ({
                label: `${style.name} (text)`,
                checked: state.characterStyle.value === id,
                onSelect: () => { target.applyCharacterStyle(state.characterStyle.value === id ? null : id); focusTarget(); },
              })),
              ...(styleList(doc, "character").length > 0 ? ["separator" as const] : []),
              { label: "New paragraph style from selection…", disabled: !!region, onSelect: () => setDialog("newParagraphStyle") },
              { label: "New character style from selection…", disabled: !!region || collapsed, onSelect: () => setDialog("newCharacterStyle") },
              ...(state.paragraphStyle && doc.styles?.[state.paragraphStyle]
                ? [{ label: `Update “${doc.styles[state.paragraphStyle]!.name}” to match`, disabled: !!region, onSelect: () => { session.updateStyleFromSelection(state.paragraphStyle!); focusTarget(); } }]
                : []),
              "separator" as const,
              { label: "Manage styles…", disabled: !!region, onSelect: () => setDialog("styles") },
            ],
          },
          {
            label: "Columns",
            disabled: readOnly || !!region,
            items: [
              ...[1, 2, 3].map((n) => ({
                label: n === 1 ? "One column" : n === 2 ? "Two columns" : "Three columns",
                checked: state.columns.count === n,
                onSelect: () => { session.setColumns(n === 1 ? null : { count: n }); focusTarget(); },
              })),
              "separator" as const,
              { label: "More options…", onSelect: () => setDialog("columns") },
            ],
          },
          {
            label: "Align and indent",
            disabled: readOnly,
            items: [
              { label: "Left", shortcut: `${SHIFT}${MOD}L`, checked: state.align === "left", onSelect: () => { target.setAlign("left"); focusTarget(); } },
              { label: "Center", shortcut: `${SHIFT}${MOD}E`, checked: state.align === "center", onSelect: () => { target.setAlign("center"); focusTarget(); } },
              { label: "Right", shortcut: `${SHIFT}${MOD}R`, checked: state.align === "right", onSelect: () => { target.setAlign("right"); focusTarget(); } },
              { label: "Justified", shortcut: `${SHIFT}${MOD}J`, checked: state.align === "justify", onSelect: () => { target.setAlign("justify"); focusTarget(); } },
              "separator",
              { label: "Increase indent", shortcut: `${MOD}]`, disabled: !state.canIndent, onSelect: () => { target.indent(); focusTarget(); } },
              { label: "Decrease indent", shortcut: `${MOD}[`, disabled: !state.canOutdent, onSelect: () => { target.outdent(); focusTarget(); } },
              "separator",
              { label: "Paragraph options…", onSelect: () => setDialog("paragraph") },
            ],
          },
          {
            label: "Bullets and numbering",
            disabled: readOnly,
            items: [
              { label: "Bulleted list", shortcut: `${SHIFT}${MOD}8`, onSelect: () => { target.toggleBlockType({ type: "list_item", list: "bullet" }); focusTarget(); } },
              { label: "Numbered list", shortcut: `${SHIFT}${MOD}7`, onSelect: () => { target.toggleBlockType({ type: "list_item", list: "ordered" }); focusTarget(); } },
            ],
          },
          {
            label: "Lists",
            disabled: readOnly || !state.list,
            items: listMenuItems(target, state.list, focusTarget, { onStartAt: () => setDialog("listStart") }),
          },
          {
            label: "Picture",
            disabled: readOnly || !state.image,
            items: pictureMenuItems(target, state.image, focusTarget),
          },
          { label: "Table", disabled: readOnly || !state.table, items: tableMenuItems(target, state.table, focusTarget, { onRowHeight: () => setDialog("rowHeight") }) },
          {
            label: "Object on the page",
            disabled: readOnly || !!region || (!state.floating && session.floats.length === 0),
            items: [
              { label: "Options…", disabled: !state.floating, onSelect: () => setDialog("object") },
              { label: "Behind the text", checked: !!state.floating?.float.behind, disabled: !state.floating, onSelect: toggleBehind },
              { label: "Delete", disabled: !state.floating, onSelect: deleteObject },
              ...(session.floats.length > 0
                ? [
                    "separator" as const,
                    ...session.floats.map((block, i) => ({
                      label: floatLabel(block, i + 1),
                      checked: state.floating?.id === block.id,
                      onSelect: () => {
                        session.select(caret(block.id, 0));
                        focusTarget();
                      },
                    })),
                  ]
                : []),
            ],
          },
          "separator",
          { label: "Clear formatting", shortcut: `${MOD}\\`, disabled: readOnly, onSelect: () => { target.clearFormatting(); focusTarget(); } },
          "separator",
          { label: "Page setup…", disabled: readOnly, onSelect: () => setDialog("page") },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` and `doc` change identity with the session
    [doc, state, view, zoom, outlineOpen, readOnly, region, collapsed, target, session, focusTarget, beginRegionEdit, print, exportAs, exportAsPdf, comments, commentsOpen, suggestionsOpen, canStartComment, filePicker, history, historyOpen, placeholders],
  );
  const allMenus = useMemo(() => extendMenus(menus, extraMenus, menuLabels), [menus, extraMenus, menuLabels]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.altKey && !event.shiftKey && event.code === "KeyF") {
      event.preventDefault();
      insertFootnote();
      return;
    }
    if (mod && event.altKey && !event.shiftKey && event.code === "KeyM" && comments) {
      event.preventDefault();
      startComment();
      return;
    }
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !readOnly) setDialog("link");
    else if (key === "f" || key === "h") setFind({ replace: key === "h" || (find?.replace ?? false) });
    else if (key === "p") print();
    else if (key === "s" && onSave) onSave(session.state);
    else return;
    event.preventDefault();
  };

  const currentPage = useMemo(() => {
    if (view !== "pages" || !layout || !session.selection) return null;
    return { current: layout.pageOf.get(session.selection.focus.block) ?? 1, total: layout.pages };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the selection changes identity on each move
  }, [view, layout, session.selection]);

  const outline = useMemo(() => outlineOf(doc), [doc]);

  const toolbarElement =
    toolbar && !readOnlyProp && !previewVersion ? (
      <EditorToolbar
        session={target}
        baseFontSize={region && focusedRegion ? 9 : undefined}
        onAfterAction={focusTarget}
        onLink={() => setDialog("link")}
        onImage={() => setDialog("image")}
        onComment={comments && !region ? startComment : undefined}
        commentDisabled={!canStartComment}
        onPrint={print}
        onRowHeight={() => setDialog("rowHeight")}
        onListStart={() => setDialog("listStart")}
        layout={{ view, onView: setView, zoom, onZoom: setZoom }}
        docked={dockToolbar}
      />
    ) : null;

  return (
    <PlaceholdersContext.Provider value={chipMode}>
    <FontsProvider fonts={fontRegistry}>
     <ThemeContext.Provider value={forcedTheme(theme)}>
     <FilePickerProvider picker={filePicker}>
      <div ref={rootRef} className={className ? `pli-document ${className}` : "pli-document"} data-theme={forcedTheme(theme)} data-paper={paper === "light" ? "light" : undefined} data-view={view} data-readonly={readOnly || undefined} data-suggesting={session.suggesting || undefined} data-loading={loading || undefined} data-keyboard={keyboard ? "" : undefined} style={keyboard ? { position: "fixed", top: keyboard.top, left: 0, right: 0, height: keyboard.height } : undefined} onKeyDown={onKeyDown}>
        {(menu || (toolbar && !dockToolbar)) && !(readOnlyProp && !menu) && (
          <div className="pli-chrome">
            {menu && (
              <>
                <div className="pli-titlebar">
                  {startActions && <div className="pli-actions pli-actions-start">{startActions}</div>}
                  <input
                    className="pli-doc-title"
                    aria-label="Document title"
                    value={doc.title}
                    readOnly={readOnly}
                    placeholder="Untitled"
                    onChange={(e) => session.setTitle(e.target.value)}
                  />
                  {sync && <SyncIndicator status={syncState.status} unsynced={syncState.unsynced} />}
                  <div className="pli-actions">
                    {room && <PresenceBar peers={peers} you={comments?.users.current} />}
                    {session.suggestionsEnabled && (
                      <>
                        {session.canSuggest && !readOnlyProp && (
                          <button
                            type="button"
                            className="pli-button pli-mode-button"
                            aria-pressed={session.suggesting}
                            title="When on, what you type and delete is suggested for someone to accept"
                            onClick={() => {
                              session.setSuggesting(!session.suggesting);
                              focusTarget();
                            }}
                          >
                            {session.suggesting ? "Suggesting" : "Editing"}
                          </button>
                        )}
                        <button type="button" className="pli-button" aria-pressed={suggestionsOpen} onClick={() => setSuggestionsOpen((v) => !v)}>
                          Suggestions{session.suggestions.length > 0 ? ` (${session.suggestions.length})` : ""}
                        </button>
                      </>
                    )}
                    {comments && (
                      <button type="button" className="pli-button" aria-pressed={commentsOpen} onClick={() => setCommentsOpen((v) => !v)}>
                        Comments{threads.filter((t) => !t.resolved).length > 0 ? ` (${threads.filter((t) => !t.resolved).length})` : ""}
                      </button>
                    )}
                    {history && (
                      <button type="button" className="pli-button" aria-pressed={historyOpen} onClick={() => showHistory(!historyOpen)}>
                        Version history
                      </button>
                    )}
                    {actions}
                    {share && <ShareButton onClick={() => setShareOpen(true)} restricted={!share.settings.link.enabled} />}
                    {endActions}
                  </div>
                </div>
                <MenuBar menus={allMenus} />
              </>
            )}
            {!dockToolbar && toolbarElement}
          </div>
        )}

        {sync && <OfflineBanner status={syncState.status} unsynced={syncState.unsynced} />}

        {notice && (
          <div className="pli-notice" role="status">
            <span>{notice}</span>
            <button type="button" className="pli-button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="pli-workspace">
          {outlineOpen && (
            <OutlinePanel entries={outline} onNavigate={navigateTo} onClose={() => setOutlineOpen(false)} />
          )}
          <div className="pli-canvas" ref={setCanvasEl} style={previewVersion ? { display: "none" } : undefined} onDoubleClick={openNoteAt} onClick={openCommentAt}>
            {find && (
              <FindPanel
                session={session}
                getRoot={() => bodyRef.current?.element ?? null}
                layoutKey={layout}
                showReplace={find.replace && !readOnly}
                onClose={() => { setFind(null); bodyRef.current?.focus(); }}
              />
            )}
            {showRuler && view === "pages" && !readOnlyProp && <Ruler session={session} target={target} zoom={zoom} readOnly={readOnly} />}
            <PageCanvas
              session={session}
              view={view}
              zoom={zoom}
              layout={layout}
              readOnly={readOnly}
              placeholder={placeholder}
              autoFocus={autoFocus}
              bodyRef={bodyRef}
              region={region}
              regionActions={regionActions}
              regionRef={regionRef}
              onLayout={handleLayout}
              onStorageError={reportStorageError}
              onEditRegion={beginRegionEdit}
              onBodyFocusChange={onBodyFocusChange}
              onRegionFocusChange={(focused) => focused && setFocusedRegion(true)}
              {...aria}
            />
            {room && <RemoteCursors peers={peers} you={comments?.users.current} getRoot={() => bodyRef.current?.element ?? null} container={canvasEl} layoutKey={`${layout ? layout.pages : 0}:${zoom}:${doc.blocks.length}:${session.revision}`} />}
          </div>
          {previewVersion && previewSession && history && (
            <div className="pli-canvas pli-version-preview" onKeyDown={(e) => e.key === "Escape" && setPreviewVersion(null)}>
              <VersionPreviewBar history={history} version={previewVersion} onBack={() => setPreviewVersion(null)} onRestored={() => setPreviewVersion(null)} />
              <PliDocument session={previewSession} readOnly menu={false} toolbar={false} statusBar={false} ruler={false} defaultView={view} defaultZoom={zoom} paper={paper} theme={theme} fonts={fontRegistry} />
            </div>
          )}
          {comments && commentsOpen && (
            <CommentsPanel
              session={session}
              client={comments}
              activeId={activeThread}
              onActivate={openThread}
              draft={draft}
              onDraftDone={() => { setDraft(null); bodyRef.current?.focus(); }}
              onClose={() => { setCommentsOpen(false); setDraft(null); }}
            />
          )}
          {session.suggestionsEnabled && suggestionsOpen && <SuggestionsPanel session={session} onClose={() => setSuggestionsOpen(false)} />}
          {history && historyOpen && <VersionHistoryPanel history={history} activeId={previewVersion?.id ?? null} onPreview={setPreviewVersion} onRestored={() => setPreviewVersion(null)} onClose={() => showHistory(false)} />}
          {commentStyles && <style>{commentStyles}</style>}
        </div>

        {statusBar && <StatusBar doc={doc} page={currentPage} zoom={zoom} onZoom={setZoom} view={view} onView={setView} hideLayout={phone && toolbar && !readOnlyProp} />}

        {dockToolbar && toolbarElement}

        {share && <ShareDialog client={share} open={shareOpen} onClose={() => setShareOpen(false)} title={doc.title || undefined} />}

        <LinkDialog
          open={dialog === "link"}
          initialUrl={linkState.value}
          askForText={collapsed}
          onApply={(url, label) => { target.setLink(url, label); focusTarget(); }}
          onRemove={() => { target.setLink(null); focusTarget(); }}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ImageDialog
          open={dialog === "image"}
          maxWidth={Math.max(100, (8.5 - pageSetupOf(doc).margins.left - pageSetupOf(doc).margins.right) * 96)}
          onInsert={insertImage}
          onFile={(file) => targetRef.current?.insertImages([file])}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ObjectDialog
          open={dialog === "object"}
          block={state.floating}
          onApply={(patch) => session.setFloat(patch)}
          onInline={() => session.setFloat(null)}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ColumnsDialog
          open={dialog === "columns"}
          columns={state.columns}
          hasSelection={!collapsed}
          onApply={(columns) => session.setColumns(columns)}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ParagraphDialog
          open={dialog === "paragraph"}
          format={state.format}
          onApply={(patch) => target.setParagraphFormat(patch)}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ListStartDialog
          key={dialog === "listStart" ? `start:${state.list?.number ?? 1}` : "start"}
          open={dialog === "listStart"}
          initial={state.list?.number ?? 1}
          onApply={(start) => target.setListStart(start)}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <RowHeightDialog
          open={dialog === "rowHeight"}
          initial={state.table?.rowHeight}
          onApply={(points) => target.setRowHeight(points)}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <TableDialog
          open={dialog === "table"}
          onInsert={(rows, columns, headerRow) => { target.insertTable(rows, columns, { headerRow }); focusTarget(); }}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <input
          ref={importInput}
          type="file"
          hidden
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="Import a DOCX file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <NewStyleDialog
          open={dialog === "newParagraphStyle" || dialog === "newCharacterStyle"}
          kind={dialog === "newCharacterStyle" ? "character" : "paragraph"}
          onCreate={(name) => session.createStyle(name, dialog === "newCharacterStyle" ? "character" : "paragraph")}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
        <ManageStylesDialog open={dialog === "styles"} session={session} styles={doc.styles ?? NO_STYLES} onClose={() => { setDialog(null); focusTarget(); }} />
        <PageSetupDialog
          open={dialog === "page"}
          page={{
            ...(doc.page ?? DEFAULT_PAGE),
            ...sectionShape(doc, sectionsOf(doc), state.section),
            differentFirstPage: hasFirstPageRegions(doc, sectionsOf(doc), state.section) || undefined,
          }}
          sections={{ count: sectionsOf(doc).length, current: state.section }}
          onApply={(page, scope) => {
            session.setPageShape({ size: page.size, orientation: page.orientation, margins: page.margins }, scope);
            session.setRegionOptions({ differentOddEven: !!page.differentOddEven });
            session.setSectionFirstPage(scope === "document" ? 0 : scope, !!page.differentFirstPage);
          }}
          onClose={() => { setDialog(null); focusTarget(); }}
        />
      </div>

     </FilePickerProvider>
     </ThemeContext.Provider>
    </FontsProvider>
    </PlaceholdersContext.Provider>
  );
}
