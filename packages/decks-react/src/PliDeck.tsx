import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { FilePickerProvider, FontsProvider, LinkDialog, MenuBar, ThemeContext, downloadFile, extendMenus, forcedTheme, pickWith, useDocumentFonts, useFonts, type ExtraMenus, type FilePicker, type MenuDefinition, type MenuEntry, type PliTheme } from "@pli.dev/react";
import type { FontRegistry } from "@pli.dev/core";
import {
  CHART_TYPES,
  CHART_TYPE_LABELS,
  createDeck,
  parseDeck,
  serializeDeck,
  type DeckSelection,
  type DeckSession,
  placeholderFamily,
  type FindHit,
  type PlaceholderType,
  type ResolvedElement,
  type SlideSize,
  usedFonts,
  textInRange,
} from "@pli.dev/decks";
import { setSelection, useDeckRevision } from "./hooks";
import { Filmstrip } from "./Filmstrip";
import { SlideCanvas, editable, type CellRange, type EditTarget, type Tool } from "./SlideCanvas";
import { SlideView, isPicturePlaceholder, type TextHighlight } from "./SlideView";
import { NotesPane } from "./NotesPane";
import { DeckToolbar, LayoutGrid, PLACEHOLDER_TYPES, ZOOMS, type Zoom } from "./DeckToolbar";
import { PresentMode } from "./PresentMode";
import { FormatPanel, ThemePanel, TransitionPanel } from "./panels";
import { MotionPanel } from "./MotionPanel";
import { addAnimations, useMotionPreview } from "./motion";
import { FindBar } from "./FindBar";
import { TemplateList } from "./MasterPane";
import { ContextMenu, type ContextMenuState as ContextMenuBase } from "./ContextMenu";
import { BackgroundDialog, PageSetupDialog, UrlDialog, WordCountDialog } from "./dialogs";
import { ChartDialog } from "./ChartDialog";
import type { TextEditApi, TextEditState } from "./TextEditor";
import { DeckIcons as I } from "./icons";
import * as cmd from "./commands";
import type { CommandContext } from "./commands";
import { formatOf, wholeRange, type TextFormat } from "./textedit";
import {
  copyElements,
  copySlides,
  insertPicture,
  fillPicturePlaceholder,
  pictureTarget,
  isElementClip,
  isSlideClip,
  lastElementClip,
  lastSlideClip,
  measureImage,
  moveSlides,
  parseClip,
  pasteSlides,
  readBytes,
  readClipboardText,
  readText,
  writeClipboard,
  type MoveHow,
} from "./actions";
import { makePdf, makePotx, makePptx, openPptx, presetGroups } from "./engine";
import { PeopleBar, RemoteLayer, caretOf, peersBySlide, presentersOf, publishPresence, useDeckCollab, type CommentsProp, type SyncProp } from "./collab";
import { CommentPins, DeckCommentsPanel, commentHighlights, openCounts, useThreads, type CommentDraft } from "./comments";
import type { AutoSaveOptions, CollabRoom, NamedVersion, Users, VersionHistory, VersionStorage } from "@pli.dev/core";
import { DeckSession as DeckSessionClass, deckVersionHistory, type Deck, type DeckAnchor, type DeckOp } from "@pli.dev/decks";
import { VersionHistoryPanel, VersionPreviewBar, useVersions } from "@pli.dev/react/collab";

/** A file made by File > Download. */
export interface PliDeckDownload {
  /** The file name, with its extension. */
  name: string;
  /** The MIME type. */
  type: string;
  data: Uint8Array;
}

export interface PliDeckProps {
  session: DeckSession;
  /** No editing: slides can be looked through, presented and downloaded. */
  readOnly?: boolean;
  /** Show the title and menus (default true). */
  menu?: boolean;
  /** Show the toolbar (default true). */
  toolbar?: boolean;
  /** Show the speaker notes under the slide (default true). */
  notes?: boolean;
  /** Called with each file File > Download makes, instead of the browser downloading it (for a web view in a native app). */
  onDownload?: (file: PliDeckDownload) => void | Promise<void>;
  /** Turns a picture file into the address stored in the slide (your storage); otherwise pictures are embedded as data. */
  uploadImage?: (file: File) => Promise<string> | string;
  /** Options for the PDF export, such as `rasterize` (SVG to PNG) and `fonts` (which win over what the registry fetches). */
  pdf?: import("@pli.dev/decks").DeckPdfOptions;
  /**
   * The fonts of this editor (the pickers' lists, how fonts are loaded, which are embedded in PDF files). Defaults to
   * `defaultFonts()` from `@pli.dev/core`: every Office font and Google family, fetched from Fontsource when used.
   */
  fonts?: FontRegistry;
  /** Called by the presenter view's "open in a new window" button; give hosts that can open a window the chance to. */
  onOpenPresenterWindow?: () => void;
  /** Extra controls in the title row, next to the Slideshow button, such as a Share button. */
  actions?: ReactNode;
  /** Controls at the far left of the title row, before the presentation's name: a back button, your logo, a breadcrumb. */
  startActions?: ReactNode;
  /** Controls at the far right of the title row, after the Slideshow button: a profile menu, a close button. */
  endActions?: ReactNode;
  /**
   * `"light"`, `"dark"` or `"auto"` (default). Pass the theme your app is using so the editor matches it. `"auto"` follows
   * `data-theme="light" | "dark"` on `<html>` if your page sets it, and otherwise the system's setting.
   */
  theme?: PliTheme;
  /**
   * The room that carries who is here and what they are doing (and, with `comments`, the comments), over a `Transport` you
   * choose (Socket.io, a WebSocket, Redis behind either). The editor connects it and says `{ slide, selection, caret, present }`.
   * Other people show as avatars, as dots on the filmstrip, as outlines and text cursors on the canvas, and, while they give a
   * slideshow, as a banner that lets you follow it.
   */
  room?: CollabRoom<DeckAnchor>;
  /** Who is using this editor, and who the authors of comments are. */
  users?: Users;
  /**
   * Turns comments on: bubbles on the slide, a count on the thumbnail, and the Comments panel (Insert > Comment, Ctrl+Alt+M).
   * `true` keeps threads in the deck; give a `store` of your own to keep them elsewhere.
   */
  comments?: CommentsProp;
  /** Live editing through `room`: your changes go to everyone and theirs to you. See `deckSyncModel` and `createAuthority`. */
  sync?: boolean | SyncProp;
  /**
   * A `VersionHistory` from `@pli.dev/core` (see `deckVersionHistory`): adds View > Version history and its panel in the right-hand
   * side area. Choosing a version shows it, read only, in the editor (the slideshow button is off meanwhile) and a bar offers to
   * restore it, which adds a new version and keeps every earlier one.
   */
  history?: VersionHistory<Deck, DeckOp>;
  /**
   * Where named versions are kept (a `VersionStorage` from `@pli.dev/core`; `memoryVersionStorage()` for a demo). The editor then
   * makes the `VersionHistory` itself, from `users` and the live-editing position, so a restore is one undoable step that reaches
   * everyone. Needs `users`; `history` wins when both are given. Saving and restoring need the `editor` role in `users`.
   */
  versions?: VersionStorage<Deck>;
  /**
   * With `versions`: keep a version now and then by itself (an "Original" first, then "Autosaved" after changes). `true` is the
   * default; `false` keeps only the versions people save; or give options (`{ every, keep, baseline }`).
   */
  autoSaveVersions?: boolean | AutoSaveOptions;
  /**
   * Items for the menus the editor has (`File`, `Edit`, `View`, `Insert`, `Slide`, `Format`, `Arrange`, `Tools`) and menus of your own:
   * a key that is not one of those adds a menu, last on the bar. The editor's own items keep their read-only handling; yours are yours to
   * disable. See [Menus and file pickers](/platform/menus-and-file-pickers/).
   */
  extraMenus?: ExtraMenus;
  /**
   * Your own way of choosing a file, used for opening a presentation, inserting pictures, a background picture and importing a theme.
   * Left out, the editor opens the browser's file chooser. Dropping and pasting files work as before.
   */
  filePicker?: FilePicker;
  className?: string;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";
const SHIFT = MAC ? "⇧" : "Shift+";
const ALT = MAC ? "⌥" : "Alt+";
const safeName = (t: string) => (t.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-");

/** A context menu: its items are listed now, or (for the canvas, where the click itself changes the selection, so the items must follow it) made each time it is drawn. */
type ContextMenuState = Omit<ContextMenuBase, "items"> & { items: MenuEntry[] | "canvas" };
type Panel = "theme" | "transition" | "format" | "motion" | "comments" | "history" | null;
type Dialogs = null | "link" | "background" | "pagesetup" | "imageurl" | "wordcount" | "chart";

/** The bar over an older version. It waits until the history lists that version (a history that was just made loads its list first), and goes back if the version is gone. */
function PreviewBar({ history, version, onBack }: { history: VersionHistory<Deck, DeckOp>; version: NamedVersion<Deck>; onBack: () => void }) {
  const versions = useVersions(history);
  const listed = versions.some((v) => v.id === version.id);
  useEffect(() => {
    if (!listed && history.status === "ready") onBack();
  }, [listed, history.status, onBack]);
  return listed ? <VersionPreviewBar history={history} version={version} onBack={onBack} onRestored={onBack} /> : null;
}

/** What went wrong, in words for a person: a failed lookup of an object or slide has no ids in it. */
export function plainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/^No (element|slide|layout|master|animation|slide, layout or master) /.test(text)) return "That object is no longer there. It may have been removed or changed by something else; try again.";
  return text;
}

/**
 * A slide editor that looks and works like Google Slides: filmstrip, canvas, toolbar, speaker notes, side panels, theme editor
 * and slideshow, driven by a `DeckSession`. The deck lives in the session; read it from `session.deck` to save it.
 */
const OPEN_ACCEPT = ".json,.pli,.pptx,.potx,application/json";

export function PliDeck({ session, readOnly = false, menu = true, toolbar = true, notes = true, onDownload, uploadImage, pdf, fonts: fontsProp, onOpenPresenterWindow, actions, startActions, endActions, theme, room, users, comments, sync, history, versions, autoSaveVersions, extraMenus, filePicker, className }: PliDeckProps) {
  useDeckRevision(session);
  const deck = session.deck;
  const collab = useDeckCollab(session, { room, users, comments, sync });
  const commentClient = collab.comments;
  // ---- Version history: given, or made from `versions` and `users`
  const syncVersion = useRef<() => number | null>(() => null);
  syncVersion.current = () => collab.sync?.version ?? null;
  // options given as an object are compared by what they say, so a new object on every render does not remake the history
  const autoSaveKey = autoSaveVersions && autoSaveVersions !== true ? JSON.stringify(autoSaveVersions) : String(autoSaveVersions);
  // Made after mounting and disposed on unmounting. It waits a tick so that a development double mount (React's strict mode) makes
  // one history, not two (each would keep an "Original" version of its own).
  const [ownHistory, setOwnHistory] = useState<VersionHistory<Deck, DeckOp> | null>(null);
  useEffect(() => {
    if (history || !versions || !users) return setOwnHistory(null);
    let made: VersionHistory<Deck, DeckOp> | null = null;
    const timer = setTimeout(() => {
      made = deckVersionHistory(session, { storage: versions, users, version: () => syncVersion.current(), ...(autoSaveVersions === false ? {} : { autoSave: autoSaveVersions && autoSaveVersions !== true ? autoSaveVersions : {} }) });
      setOwnHistory(made);
    }, 0);
    return () => {
      clearTimeout(timer);
      made?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, history, versions, users, autoSaveKey]);
  const versionHistory = history ?? ownHistory ?? undefined;
  const [previewing, setPreviewing] = useState<NamedVersion<Deck> | null>(null);
  const previewSession = useMemo(() => (previewing ? new DeckSessionClass(JSON.parse(JSON.stringify(previewing.state)) as Deck) : null), [previewing]);
  // a history that goes away takes the preview with it
  useEffect(() => {
    setPreviewing(null);
  }, [versionHistory]);
  const threads = useThreads(commentClient);
  const fonts = useFonts(fontsProp);
  // The fonts the deck names are fetched when it is shown, and the slides are drawn again as each arrives.
  const usedNow = useMemo(() => usedFonts(deck), [deck]);
  useDocumentFonts(fonts, usedNow);
  const slides = deck.slides;

  // ---- What is selected -------------------------------------------------------------------------------------------

  const [themeEditId, setThemeEdit] = useState<string | null>(null);
  // The master or layout being edited can go while the view is open (a theme was applied, or undone): carry on with
  // the deck's first master rather than a name that no longer exists.
  const themeEdit = themeEditId && deck.masters.some((m) => m.id === themeEditId || m.layouts.some((l) => l.id === themeEditId)) ? themeEditId : themeEditId ? (deck.masters[0]?.id ?? null) : null;
  useEffect(() => {
    if (themeEdit !== themeEditId) {
      setThemeEdit(themeEdit);
      setEditing(null);
      setCellRange(null);
      if (themeEdit) setSelection(session, { slide: themeEdit, elements: [] });
    }
  }, [themeEdit, themeEditId, session]);
  /** The slide the master view was opened from, so that closing it goes back there. */
  const returnTo = useRef<string | null>(null);
  const sel = session.selection;
  const slideId = themeEdit ?? (slides.some((s) => s.id === sel.slide) ? sel.slide! : (slides[0]?.id ?? null));
  const owner = slideId ?? "";
  const scene = useMemo(() => (slideId ? session.scene(slideId) : null), [session, deck, slideId]);
  const from: ResolvedElement["from"] = themeEdit ? (deck.masters.some((m) => m.id === themeEdit) ? "master" : "layout") : "slide";
  const editedMaster = themeEdit ? deck.masters.find((m) => m.id === themeEdit || m.layouts.some((l) => l.id === themeEdit)) : undefined;
  const editedLayout = themeEdit ? editedMaster?.layouts.find((l) => l.id === themeEdit) : undefined;
  const topIds = useMemo(() => new Set(scene?.elements.filter((e) => e.from === from).map((e) => e.id)), [scene, from]);
  const selectedIds = useMemo(() => (sel.elements ?? []).filter((id) => topIds.has(id)), [sel.elements, topIds]);
  const selectedSlides = useMemo(() => {
    if (themeEdit) return [];
    const list = (sel.slides ?? []).filter((id) => slides.some((x) => x.id === id));
    return list.length ? list : slideId ? [slideId] : [];
  }, [sel.slides, slides, slideId, themeEdit]);

  // keep the session's own idea of the selection valid
  useEffect(() => {
    if (!themeEdit && slideId && sel.slide !== slideId) setSelection(session, { slide: slideId, slides: [slideId], elements: [] });
  });

  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [cropping, setCropping] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [panel, setPanel] = useState<Panel>(null);
  /** The animation selected in the Motion panel. */
  const [animSel, setAnimSel] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [showNotes, setShowNotes] = useState(notes);
  const [notesHeight, setNotesHeight] = useState(84);
  const [showFilmstrip, setShowFilmstrip] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [present, setPresent] = useState<{ start: number; presenter?: boolean; follow?: string } | null>(null);
  /** The thread open in the Comments panel (and its bubble), and the comment being started. */
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  /** Where this person's own slideshow is, for people who follow it. */
  const [showAt, setShowAt] = useState<{ slide: string; step: number } | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [textState, setTextState] = useState<TextEditState | null>(null);
  const textApiRef = useRef<TextEditApi | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  /** The empty picture placeholder the file chooser was opened from, so that the choice goes into it. */
  const pickRef = useRef<string | null>(null);
  const [title, setTitle] = useState(deck.title);
  useEffect(() => setTitle(deck.title), [deck.title]);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setNotice(plainError(e));
    }
  };

  const select = useCallback(
    (ids: string[]) => {
      setSelection(session, { ...session.selection, slide: slideId, elements: ids, text: undefined });
      setEditing((e) => (e && ids.length === 1 && ids[0] === e.element ? e : null));
      if (ids.length !== 1) setCellRange(null);
    },
    [session, slideId],
  );
  const selectSlide = useCallback(
    (id: string, ids: string[]) => {
      setEditing(null);
      setCellRange(null);
      setCropping(false);
      setSelection(session, { slide: id, slides: ids, elements: [] });
    },
    [session],
  );

  // undo and redo can put text editing back
  useEffect(
    () =>
      session.subscribe((ev) => {
        if (ev.origin !== "undo" && ev.origin !== "redo") return;
        const m: DeckSelection | undefined = ev.meta;
        if (m?.text) setEditing({ element: m.text.element, range: m.text.range });
        else setEditing(null);
      }),
    [session],
  );

  // ---- Zoom -------------------------------------------------------------------------------------------------------

  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea((a) => (a.w === el.clientWidth && a.h === el.clientHeight ? a : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  // The panes around the slide come and go (the master view's list, the side panels): measure after every render too, so
  // the fit never rests on a size from before they changed.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (el) setArea((a) => (a.w === el.clientWidth && a.h === el.clientHeight ? a : { w: el.clientWidth, h: el.clientHeight }));
  });
  const fitScale = area.w > 0 && area.h > 0 ? Math.max(0.1, Math.min((area.w - 48) / deck.size.width, (area.h - 40) / deck.size.height)) : 1;
  const scale = zoom === "fit" ? fitScale : zoom * (96 / 72);
  const fitZoom = fitScale * (72 / 96);

  // ---- Commands ---------------------------------------------------------------------------------------------------

  const ctx: CommandContext | null = scene ? { session, owner, ids: selectedIds, scene, cells: cellRange, text: editing ? textApiRef.current : null } : null;
  const selectedEls = useMemo(() => scene?.elements.filter((e) => selectedIds.includes(e.id)) ?? [], [scene, selectedIds]);
  const preview = useMotionPreview(session, themeEdit ? null : slideId, scene);
  const animList = slideId && !themeEdit ? session.animations(slideId) : [];
  /** Opens the Motion panel; with objects selected it gives each of them an animation. */
  const openMotion = (add = false) => {
    if (themeEdit) return;
    setPanel("motion");
    if (!add || readOnly || !slideId) return;
    attempt(() => {
      const made = addAnimations(session, owner, selectedIds);
      if (made.length) setAnimSel(made[made.length - 1]!.id);
    });
  };

  const format: TextFormat | null = useMemo(() => {
    if (editing && textState) return textState.format;
    const el = selectedEls.find((e) => (e.kind === "shape" && e.text) || e.kind === "table");
    if (!el) return null;
    try {
      const raw = session.element(owner, el.id);
      if (raw.type === "shape" && raw.text) return formatOf(raw.text.paragraphs, el.text, wholeRange(raw.text.paragraphs));
      if (raw.type === "table" && el.table) {
        const r = cellRange?.r1 ?? 0;
        const c = cellRange?.c1 ?? 0;
        const cell = raw.rows[r]?.cells[c];
        return cell ? formatOf(cell.paragraphs, el.table.rows[r]?.cells[c]?.text, wholeRange(cell.paragraphs)) : null;
      }
    } catch {
      return null;
    }
    return null;
  }, [editing, textState, selectedEls, session, owner, cellRange, deck]);

  const startEdit = useCallback(
    (t: EditTarget) => {
      if (readOnly) return;
      attempt(() => {
        const el = session.element(owner, t.element);
        if (el.type === "shape" && !el.text) {
          session.updateElement(owner, el.id, (e) => (e.type === "shape" ? { ...e, text: e.placeholder ? { paragraphs: [{ runs: [] }] } : e.textBox ? { paragraphs: [{ runs: [] }], autofit: "resize" } : { paragraphs: [{ runs: [], align: "center" }], vAlign: "middle" } } : e));
        }
        if (el.type === "table") setCellRange((r) => r ?? { r1: t.cell?.[0] ?? 0, c1: t.cell?.[1] ?? 0, r2: t.cell?.[0] ?? 0, c2: t.cell?.[1] ?? 0 });
        if (!session.selection.elements.includes(t.element)) setSelection(session, { ...session.selection, elements: [t.element] });
        if (t.cell) setCellRange({ r1: t.cell[0], c1: t.cell[1], r2: t.cell[0], c2: t.cell[1] });
        setEditing(t);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, owner, readOnly],
  );

  const editingRef = useRef(editing);
  editingRef.current = editing;
  const stopEditing = useCallback(() => {
    const e = editingRef.current;
    editingRef.current = null;
    if (e) {
      // an empty text box is not kept
      try {
        const el = session.element(owner, e.element);
        if (el.type === "shape" && el.textBox && !el.placeholder && (el.text?.paragraphs ?? []).every((p) => p.runs.every((r) => r.text === ""))) {
          session.deleteElements(owner, [el.id]);
        }
      } catch {
        // gone already
      }
    }
    setEditing(null);
    setTextState(null);
    textApiRef.current = null;
    rootRef.current?.focus({ preventScroll: true });
  }, [session, owner]);

  const newSlide = (layoutId?: string) => {
    if (readOnly || themeEdit) return;
    attempt(() => {
      const s = session.addSlide(layoutId ? { layout: layoutId } : {});
      setSelection(session, { slide: s.id, slides: [s.id], elements: [] });
    });
  };
  const deleteSlides = (ids: string[]) => {
    if (readOnly || !ids.length) return;
    session.deleteSlides(ids);
    const id = session.selection.slide;
    setSelection(session, { slide: id, slides: id ? [id] : [], elements: [] });
  };
  const duplicateSlides = (ids: string[]) => {
    if (readOnly || !ids.length) return;
    const made = session.duplicateSlides(ids);
    if (made[0]) setSelection(session, { slide: made[0].id, slides: made.map((s) => s.id), elements: [] });
  };
  const slideTargets = () => (themeEdit ? [] : selectedSlides.length ? selectedSlides : slideId ? [slideId] : []);

  const deleteSelected = () => {
    if (readOnly || !selectedIds.length) return;
    session.deleteElements(owner, selectedIds);
    setEditing(null);
    setCellRange(null);
    setSelection(session, { ...session.selection, elements: [] });
  };
  const duplicateSelected = () => {
    if (readOnly || !selectedIds.length) return;
    session.duplicateElements(owner, selectedIds);
  };
  const selectAll = () => scene && select(scene.elements.filter((e) => e.from === from && !e.hidden).map((e) => e.id));

  const copySelected = (cut: boolean) => {
    if (!selectedIds.length) return null;
    const clip = copyElements(session, owner, selectedIds);
    if (clip) writeClipboard(JSON.stringify(clip));
    if (cut && !readOnly) deleteSelected();
    return clip;
  };
  const pasteClip = (clip: ReturnType<typeof parseClip> | null) => {
    if (readOnly || !clip) return;
    if (isSlideClip(clip)) {
      if (themeEdit) return;
      pasteSlides(session, clip);
      return;
    }
    if (isElementClip(clip)) {
      // pasting on the slide it was copied from puts the copy a little aside
      const same = clip.elements.some((e) => session.elementsOf(owner).some((x) => x.id === e.id));
      const ids = session.pasteElements(owner, clip, same ? 12 : 0);
      setSelection(session, { ...session.selection, elements: ids });
    }
  };
  const pasteText = (text: string) => {
    if (readOnly || !text.trim() || themeEdit) return;
    const clip = parseClip(text);
    if (clip) return pasteClip(clip);
    const el = session.addTextBox(owner, {}, text);
    setSelection(session, { ...session.selection, elements: [el.id] });
  };
  const pasteFromClipboard = async () => {
    const text = await readClipboardText();
    const clip = text ? parseClip(text) : null;
    if (clip) return pasteClip(clip);
    if (text) return pasteText(text);
    pasteClip(lastElementClip() ?? lastSlideClip());
  };

  const addFiles = async (files: File[], at?: { x: number; y: number }) => {
    if (readOnly || !slideId) return;
    // a picture chosen from, dropped on, or inserted while selecting an empty picture placeholder goes into it
    let into: string | undefined = pickRef.current ?? pictureTarget(session, owner, session.selection.elements, at);
    pickRef.current = null;
    for (const f of files) {
      try {
        if (into) {
          const target: string = into;
          into = undefined;
          const filled = await fillPicturePlaceholder(session, owner, target, f, uploadImage);
          setSelection(session, { ...session.selection, elements: [filled] });
          continue;
        }
        const id = await insertPicture(session, owner, f, at, uploadImage);
        if (id) setSelection(session, { ...session.selection, elements: [id] });
      } catch (e) {
        setNotice(plainError(e));
      }
    }
  };

  // ---- Files ------------------------------------------------------------------------------------------------------

  const deliver = async (file: PliDeckDownload) => {
    try {
      if (onDownload) await onDownload(file);
      else downloadFile(file.name, file.data as BlobPart, file.type);
    } catch (e) {
      setNotice(plainError(e));
    }
  };
  const download = async (kind: "pptx" | "pdf" | "json" | "potx") => {
    const base = safeName(deck.title);
    try {
      if (kind === "pptx") await deliver({ name: `${base}.pptx`, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: await makePptx(deck) });
      else if (kind === "potx") await deliver({ name: `${base} theme.potx`, type: "application/vnd.openxmlformats-officedocument.presentationml.template", data: await makePotx(deck) });
      else if (kind === "pdf") {
        // Fonts the host didn't give are fetched from the registry, so a Google family is embedded and not drawn as Helvetica.
        const wanted = usedNow.filter((n) => !pdf?.fonts || !Object.keys(pdf.fonts).some((k) => k.toLowerCase() === n.toLowerCase()));
        const fetched = await fonts.pdfFonts(wanted, { text: deckText(deck) });
        const made = await makePdf(deck, { ...pdf, fonts: { ...fetched.fonts, ...pdf?.fonts } });
        made.warnings.push(...fetched.warnings);
        await deliver({ name: `${base}.pdf`, type: "application/pdf", data: made.bytes });
        if (made.warnings.length) setWarnings(made.warnings);
      }
      else await deliver({ name: `${base}.json`, type: "application/json", data: new TextEncoder().encode(serializeDeck(deck)) });
    } catch (e) {
      setNotice(plainError(e));
    }
  };
  /** Asks for pictures (into `target`, a picture placeholder, when given): the host's picker, or the hidden file input. */
  const chooseImages = (target: string | null = null) => {
    pickRef.current = target;
    if (!filePicker) return void imageRef.current?.click();
    void pickWith(filePicker, { purpose: "image", accept: "image/*", multiple: true, label: "Insert a picture" }).then((files) => (files.length ? addFiles(files) : undefined), (e) => setNotice(plainError(e)));
  };
  /** Asks for a presentation to open. */
  const chooseOpen = () => {
    if (!filePicker) return void fileRef.current?.click();
    void pickWith(filePicker, { purpose: "open", accept: OPEN_ACCEPT, multiple: false, label: "Open a presentation" }).then((files) => (files[0] ? openFile(files[0]) : undefined), (e) => setNotice(plainError(e)));
  };
  const openFile = async (file: File | undefined) => {
    if (!file || readOnly) return;
    try {
      let next;
      let warn: string[] = [];
      if (/\.(pptx|potx)$/i.test(file.name)) ({ deck: next, warnings: warn } = await openPptx(await readBytes(file)));
      else next = parseDeck(await readText(file));
      setWarnings(warn);
      setThemeEdit(null);
      setEditing(null);
      session.load(next);
      setSelection(session, { slide: next.slides[0]?.id ?? null, slides: next.slides[0] ? [next.slides[0].id] : [], elements: [] });
    } catch (e) {
      setNotice(`That file couldn't be opened: ${(e as Error).message}`);
    }
  };
  const newPresentation = () => {
    if (readOnly) return;
    if (session.canUndo && typeof window.confirm === "function" && !window.confirm("Start a new presentation? The current one is replaced and its history is cleared.")) return;
    const d = createDeck({ size: deck.size });
    setThemeEdit(null);
    session.load(d);
    setSelection(session, { slide: d.slides[0]!.id, slides: [d.slides[0]!.id], elements: [] });
  };
  const setPageSize = (size: SlideSize, scaleContent: boolean) => attempt(() => session.setSize(size, scaleContent));

  // ---- Menus ------------------------------------------------------------------------------------------------------

  const hasSel = selectedIds.length > 0;
  const g = ctx;
  const needCtx = (fn: (c: CommandContext) => void) => () => g && attempt(() => fn(g));
  const layouts = (deck.masters.find((m) => m.layouts.some((l) => l.id === slides.find((s) => s.id === slideId)?.layout)) ?? deck.masters[0]!).layouts;
  const currentLayout = slides.find((s) => s.id === slideId)?.layout ?? null;
  const currentSlide = slides.find((s) => s.id === slideId);
  const toggleHistory = () => {
    if (panel === "history") return setPanel(null);
    setPanel("history");
  };
  // Looking at an older version only makes sense with the history panel open: closing it (or opening another panel) goes back.
  useEffect(() => {
    if (panel !== "history") setPreviewing(null);
  }, [panel]);
  const startPresent = (fromStart: boolean, presenter = false) => previewing ? undefined : setPresent({ start: fromStart ? 0 : Math.max(0, slides.findIndex((s) => s.id === slideId)), presenter });

  // ---- People and comments -----------------------------------------------------------------------------------------

  const presenters = useMemo(() => presentersOf(collab.peers, collab.you), [collab.peers, collab.you]);
  const followed = present?.follow ? presenters.find((p) => p.peer.client === present.follow) : undefined;
  // The show you follow ended: so does yours.
  useEffect(() => {
    if (present?.follow && !followed) setPresent(null);
  }, [present?.follow, followed]);
  const follow = (client: string) => {
    const p = presenters.find((x) => x.peer.client === client);
    if (p) setPresent({ start: Math.max(0, slides.findIndex((s) => s.id === p.slide)), follow: client });
  };
  const caret = useMemo(() => (editing && textState ? caretOf(session, owner, editing.element, editing.cell, textState.range) : null), [editing, textState, session, deck, owner]);
  useEffect(() => {
    if (room) publishPresence(room, { slide: themeEdit ? null : slideId, selection: selectedIds, caret: caret ?? null, present: present && !present.follow ? showAt : null });
  }, [room, slideId, themeEdit, selectedIds, caret, showAt, present]);
  const filmPeople = useMemo(() => peersBySlide(collab.peers, collab.you), [collab.peers, collab.you]);
  const filmComments = useMemo(() => openCounts(threads), [threads]);
  const commentLight = useMemo(() => commentHighlights(session, themeEdit ? null : slideId, threads, activeThread), [session, deck, slideId, themeEdit, threads, activeThread]);
  /** Opens the Comments panel with a box for a comment about the words being edited, the selected object, or the slide. */
  const startComment = () => {
    if (!commentClient || !slideId || themeEdit || !commentClient.can("comment")) return;
    let draft: CommentDraft;
    if (editing && textState && !textState.collapsed) {
      const quote = (() => {
        try {
          const el = session.element(owner, editing.element);
          const ps = el.type === "shape" ? el.text?.paragraphs : el.type === "table" && editing.cell ? el.rows[editing.cell[0]]?.cells[editing.cell[1]]?.paragraphs : undefined;
          return ps ? textInRange(ps, textState.range).slice(0, 60) : "";
        } catch {
          return "";
        }
      })();
      draft = { slide: slideId, element: editing.element, cell: editing.cell, range: textState.range, label: `On the text “${quote}”` };
    } else if (selectedIds.length === 1) draft = { slide: slideId, element: selectedIds[0], label: "On the selected object" };
    else draft = { slide: slideId, label: `On slide ${slides.findIndex((s) => s.id === slideId) + 1}` };
    setCommentDraft(draft);
    setPanel("comments");
  };
  /** Shows a thread: its slide and object are selected and the panel scrolls to it. */
  const activateThread = (id: string | null) => {
    setActiveThread(id);
    if (!id) return;
    const t = commentClient?.thread(id);
    const slide = t?.anchor?.slide;
    if (!t || !slide) return;
    setPanel("comments");
    if (themeEdit) leaveTheme();
    if (slides.some((s) => s.id === slide)) {
      if (slide !== slideId) selectSlide(slide, [slide]);
      const el = t.anchor?.element;
      if (el && session.comments.anchorState(t).element) setSelection(session, { slide, slides: [slide], elements: [el] });
    }
  };
  const tableSel = selectedEls.length === 1 && selectedEls[0]!.kind === "table" ? selectedEls[0]! : null;
  const chartSel = selectedEls.length === 1 && selectedEls[0]!.kind === "chart" ? selectedEls[0]! : null;
  const tableMenu = (): MenuEntry[] => {
    const id = tableSel?.id;
    const r = cellRange ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
    const t = id ? session.element(owner, id) : null;
    const tb = t?.type === "table" ? t : null;
    const d = !id || readOnly;
    return [
      { label: "Insert row above", disabled: d, onSelect: () => attempt(() => session.insertTableRows(owner, id!, r.r1)) },
      { label: "Insert row below", disabled: d, onSelect: () => attempt(() => session.insertTableRows(owner, id!, r.r2 + 1)) },
      { label: "Insert column left", disabled: d, onSelect: () => attempt(() => session.insertTableColumns(owner, id!, r.c1)) },
      { label: "Insert column right", disabled: d, onSelect: () => attempt(() => session.insertTableColumns(owner, id!, r.c2 + 1)) },
      "separator",
      { label: "Delete row", disabled: d, onSelect: () => attempt(() => session.deleteTableRows(owner, id!, r.r1, r.r2 - r.r1 + 1)) },
      { label: "Delete column", disabled: d, onSelect: () => attempt(() => session.deleteTableColumns(owner, id!, r.c1, r.c2 - r.c1 + 1)) },
      { label: "Delete table", disabled: d, onSelect: deleteSelected },
      "separator",
      { label: "Merge cells", disabled: d || (r.r1 === r.r2 && r.c1 === r.c2), onSelect: () => attempt(() => session.mergeCells(owner, id!, r)) },
      { label: "Unmerge cells", disabled: d, onSelect: () => attempt(() => session.unmergeCells(owner, id!, r.r1, r.c1)) },
      "separator",
      { label: "Header row", checked: !!tb?.headerRow, disabled: d, onSelect: () => attempt(() => session.setTableOptions(owner, id!, { headerRow: !tb?.headerRow })) },
      { label: "Banded rows", checked: !!tb?.banded, disabled: d, onSelect: () => attempt(() => session.setTableOptions(owner, id!, { banded: !tb?.banded })) },
    ];
  };
  const arrangeItems = (): MenuEntry[] => [
    { label: "Order", items: [
      { label: "Bring to front", shortcut: `${MOD}${SHIFT}↑`, disabled: !hasSel, onSelect: () => session.arrange(owner, selectedIds, "front") },
      { label: "Bring forward", shortcut: `${MOD}↑`, disabled: !hasSel, onSelect: () => session.arrange(owner, selectedIds, "forward") },
      { label: "Send backward", shortcut: `${MOD}↓`, disabled: !hasSel, onSelect: () => session.arrange(owner, selectedIds, "backward") },
      { label: "Send to back", shortcut: `${MOD}${SHIFT}↓`, disabled: !hasSel, onSelect: () => session.arrange(owner, selectedIds, "back") },
    ] },
    { label: "Align horizontally", items: (["left", "center", "right"] as const).map((a) => ({ label: a[0]!.toUpperCase() + a.slice(1), disabled: !hasSel, onSelect: () => session.align(owner, selectedIds, a) })) },
    { label: "Align vertically", items: (["top", "middle", "bottom"] as const).map((a) => ({ label: a[0]!.toUpperCase() + a.slice(1), disabled: !hasSel, onSelect: () => session.align(owner, selectedIds, a) })) },
    { label: "Distribute", items: [
      { label: "Horizontally", disabled: selectedIds.length < 3, onSelect: () => session.distribute(owner, selectedIds, "horizontal") },
      { label: "Vertically", disabled: selectedIds.length < 3, onSelect: () => session.distribute(owner, selectedIds, "vertical") },
    ] },
    { label: "Rotate", items: [
      { label: "Rotate clockwise 90°", disabled: !hasSel, onSelect: needCtx((c) => cmd.rotateBy(c, 90)) },
      { label: "Rotate counterclockwise 90°", disabled: !hasSel, onSelect: needCtx((c) => cmd.rotateBy(c, -90)) },
      { label: "Flip horizontally", disabled: !hasSel, onSelect: needCtx((c) => cmd.flip(c, "h")) },
      { label: "Flip vertically", disabled: !hasSel, onSelect: needCtx((c) => cmd.flip(c, "v")) },
    ] },
    "separator",
    { label: "Group", shortcut: `${MOD}${ALT}G`, disabled: selectedIds.length < 2, onSelect: () => session.group(owner, selectedIds) },
    { label: "Ungroup", shortcut: `${MOD}${ALT}${SHIFT}G`, disabled: !selectedEls.some((e) => e.kind === "group"), onSelect: () => selectedEls.filter((e) => e.kind === "group").forEach((e) => session.ungroup(owner, e.id)) },
  ];
  const shapeItems = (): MenuEntry[] => presetGroups().map((grp) => ({ label: grp.label, items: grp.presets.map((p) => ({ label: p.label ?? p.name, onSelect: () => setTool({ type: "shape", geometry: p.name }) })) }));

  /** The layouts a slide can take: one master's list, or one submenu per master when the deck has several. */
  const layoutMenu = (ids: string[]): MenuEntry[] => {
    const pick = (layoutId: string) => () => ids.forEach((id) => session.setLayout(id, layoutId));
    if (deck.masters.length <= 1) return layouts.map((l) => ({ label: l.name, checked: l.id === currentLayout, onSelect: pick(l.id) }));
    return deck.masters.map((m) => ({ label: m.name, checked: m.layouts.some((l) => l.id === currentLayout), items: m.layouts.map((l) => ({ label: l.name, checked: l.id === currentLayout, onSelect: pick(l.id) })) }));
  };
  const slideMenuItems = (ids: string[]): MenuEntry[] => slideItems(ids).map((it) => (it === "separator" || !themeEdit || it.label === "Change background…" ? it : { ...it, disabled: true }));
  const slideItems = (ids: string[]): MenuEntry[] => [
    { label: "New slide", shortcut: `${MOD}M`, onSelect: () => newSlide() },
    { label: "Duplicate slide", shortcut: `${MOD}D`, onSelect: () => duplicateSlides(ids) },
    { label: ids.length > 1 ? "Delete slides" : "Delete slide", shortcut: "Delete", onSelect: () => deleteSlides(ids) },
    { label: "Skip slide", checked: ids.length > 0 && ids.every((id) => slides.find((s) => s.id === id)?.skipped), onSelect: () => session.setSkipped(ids, !ids.every((id) => slides.find((s) => s.id === id)?.skipped)) },
    "separator",
    { label: "Move slide", items: ([["up", "Move slide up"], ["down", "Move slide down"], ["top", "Move slide to beginning"], ["bottom", "Move slide to end"]] as [MoveHow, string][]).map(([how, label]) => ({ label, onSelect: () => moveSlides(session, ids, how) })) },
    "separator",
    { label: "Change background…", onSelect: () => setDialog("background") },
    {
      label: "Hide background graphics",
      checked: ids.length > 0 && ids.every((id) => slides.find((s) => s.id === id)?.showMasterElements === false),
      onSelect: () => session.patchSlides(ids, { showMasterElements: ids.every((id) => slides.find((s) => s.id === id)?.showMasterElements === false) ? null : false }),
    },
    { label: "Change layout", items: layoutMenu(ids) },
    { label: "Reset layout", onSelect: () => ids.forEach((id) => session.resetSlide(id)) },
    { label: "Transition…", onSelect: () => setPanel("transition") },
    { label: "Motion…", onSelect: () => openMotion() },
  ];

  const menus: MenuDefinition[] = scene
    ? [
        { label: "File", items: [
          { label: "New presentation", onSelect: newPresentation },
          { label: "Open…", shortcut: `${MOD}O`, onSelect: () => chooseOpen() },
          "separator",
          { label: "Download", items: [
            { label: "Microsoft PowerPoint (.pptx)", onSelect: () => void download("pptx") },
            { label: "PDF document (.pdf)", onSelect: () => void download("pdf") },
            { label: "Pli JSON (.json)", onSelect: () => void download("json") },
          ] },
          { label: "Save as theme (.potx)", onSelect: () => void download("potx") },
          { label: "Import theme…", onSelect: () => setPanel("theme") },
          "separator",
          { label: "Page setup…", onSelect: () => setDialog("pagesetup") },
        ] },
        { label: "Edit", items: [
          { label: "Undo", shortcut: `${MOD}Z`, disabled: !session.canUndo, onSelect: () => session.undo() },
          { label: "Redo", shortcut: MAC ? `${SHIFT}${MOD}Z` : `${MOD}Y`, disabled: !session.canRedo, onSelect: () => session.redo() },
          "separator",
          { label: "Cut", shortcut: `${MOD}X`, disabled: !hasSel, onSelect: () => copySelected(true) },
          { label: "Copy", shortcut: `${MOD}C`, disabled: !hasSel, onSelect: () => copySelected(false) },
          { label: "Paste", shortcut: `${MOD}V`, onSelect: () => void pasteFromClipboard() },
          { label: "Duplicate", shortcut: `${MOD}D`, disabled: !hasSel, onSelect: duplicateSelected },
          { label: "Delete", shortcut: "Delete", disabled: !hasSel, onSelect: deleteSelected },
          "separator",
          { label: "Select all", shortcut: `${MOD}A`, onSelect: selectAll },
          "separator",
          { label: "Find and replace", shortcut: `${MOD}F`, onSelect: () => setFindOpen(true) },
        ] },
        { label: "View", items: [
          { label: "Present from beginning", shortcut: `${MOD}Enter`, onSelect: () => startPresent(true) },
          { label: "Present from current slide", shortcut: `${MOD}${SHIFT}Enter`, onSelect: () => startPresent(false) },
          { label: "Presenter view", onSelect: () => startPresent(false, true) },
          "separator",
          { label: "Zoom", items: [{ label: "Fit", checked: zoom === "fit", onSelect: () => setZoom("fit") }, ...ZOOMS.map((z) => ({ label: `${Math.round(z * 100)}%`, checked: zoom === z, onSelect: () => setZoom(z) }))] },
          { label: "Show speaker notes", checked: showNotes, onSelect: () => setShowNotes((v) => !v) },
          { label: "Show filmstrip", checked: showFilmstrip, onSelect: () => setShowFilmstrip((v) => !v) },
          { label: "Snap to guides", checked: snapOn, onSelect: () => setSnapOn((v) => !v) },
          "separator",
          themeEdit ? { label: "Close master view", onSelect: () => leaveTheme() } : { label: "Edit master", disabled: readOnly, onSelect: () => enterTheme() },
          ...(versionHistory ? [{ label: "Version history", checked: panel === "history", onSelect: () => toggleHistory() } as MenuEntry] : []),
        ] },
        { label: "Insert", items: [
          { label: "Image", items: [
            { label: "Upload from computer…", onSelect: () => chooseImages() },
            { label: "By URL…", onSelect: () => setDialog("imageurl") },
          ] },
          { label: "Text box", onSelect: () => setTool({ type: "text" }) },
          { label: "Shape", items: shapeItems() },
          { label: "Animation", disabled: readOnly || !hasSel || !!themeEdit, onSelect: () => openMotion(true) },
          { label: "Line", items: [
            { label: "Line", onSelect: () => setTool({ type: "line", geometry: "line" }) },
            { label: "Arrow", onSelect: () => setTool({ type: "line", geometry: "line", arrow: true }) },
            { label: "Elbow connector", onSelect: () => setTool({ type: "line", geometry: "bentConnector3" }) },
            { label: "Curved connector", onSelect: () => setTool({ type: "line", geometry: "curvedConnector3" }) },
          ] },
          { label: "Chart", items: CHART_TYPES.map((t) => ({ label: CHART_TYPE_LABELS[t], onSelect: () => { const c = session.addChart(owner, t); setSelection(session, { ...session.selection, elements: [c.id] }); } })) },
          { label: "Table", items: [[2, 2], [3, 3], [4, 4], [5, 3], [3, 5]].map(([r, c]) => ({ label: `${r} × ${c}`, onSelect: () => { const t = session.addTable(owner, r!, c!); setSelection(session, { ...session.selection, elements: [t.id] }); } })) },
          "separator",
          { label: "New slide", shortcut: `${MOD}M`, disabled: !!themeEdit, onSelect: () => newSlide() },
          { label: "Link…", shortcut: `${MOD}K`, onSelect: () => setDialog("link") },
          ...(commentClient ? [{ label: "Comment", shortcut: `${MOD}${ALT}M`, disabled: !!themeEdit || !commentClient.can("comment"), onSelect: () => startComment() }] : []),
          { label: "Placeholder", disabled: !themeEdit || readOnly, items: PLACEHOLDER_TYPES.map(([type, label]) => ({ label, disabled: !canAddPlaceholder(type), onSelect: () => addPlaceholder(type) })) },
        ] },
        { label: "Slide", items: slideMenuItems(slideTargets()).concat([
          "separator",
          themeEdit ? { label: "Close master view", onSelect: () => leaveTheme() } : { label: "Edit master", disabled: readOnly, onSelect: () => enterTheme() },
          { label: "Change theme…", onSelect: () => setPanel("theme") },
        ]) },
        { label: "Format", items: [
          { label: "Text", items: [
            { label: "Bold", shortcut: `${MOD}B`, checked: !!format?.bold, onSelect: needCtx((c) => cmd.toggleMark(c, "bold", !!format?.bold)) },
            { label: "Italic", shortcut: `${MOD}I`, checked: !!format?.italic, onSelect: needCtx((c) => cmd.toggleMark(c, "italic", !!format?.italic)) },
            { label: "Underline", shortcut: `${MOD}U`, checked: !!format?.underline, onSelect: needCtx((c) => cmd.toggleMark(c, "underline", !!format?.underline)) },
            { label: "Strikethrough", checked: !!format?.strike, onSelect: needCtx((c) => cmd.toggleMark(c, "strike", !!format?.strike)) },
            { label: "Superscript", checked: (format?.baseline ?? 0) > 0, onSelect: needCtx((c) => cmd.formatMarks(c, { baseline: (format?.baseline ?? 0) > 0 ? null : "super" })) },
            { label: "Subscript", checked: (format?.baseline ?? 0) < 0, onSelect: needCtx((c) => cmd.formatMarks(c, { baseline: (format?.baseline ?? 0) < 0 ? null : "sub" })) },
            { label: "UPPERCASE", onSelect: needCtx((c) => cmd.formatMarks(c, { allCaps: true })) },
            { label: "Small caps", onSelect: needCtx((c) => cmd.formatMarks(c, { smallCaps: true })) },
          ] },
          { label: "Align & indent", items: [
            { label: "Left", shortcut: `${MOD}${SHIFT}L`, onSelect: needCtx((c) => cmd.setAlign(c, "left")) },
            { label: "Center", shortcut: `${MOD}${SHIFT}E`, onSelect: needCtx((c) => cmd.setAlign(c, "center")) },
            { label: "Right", shortcut: `${MOD}${SHIFT}R`, onSelect: needCtx((c) => cmd.setAlign(c, "right")) },
            { label: "Justify", shortcut: `${MOD}${SHIFT}J`, onSelect: needCtx((c) => cmd.setAlign(c, "justify")) },
            "separator",
            { label: "Increase indent", shortcut: `${MOD}]`, onSelect: needCtx((c) => cmd.indent(c, 1)) },
            { label: "Decrease indent", shortcut: `${MOD}[`, onSelect: needCtx((c) => cmd.indent(c, -1)) },
          ] },
          { label: "Line & paragraph spacing", items: [
            ...[1, 1.15, 1.5, 2].map((s) => ({ label: s === 1 ? "Single" : s === 2 ? "Double" : String(s), checked: format?.lineSpacing === s, onSelect: needCtx((c) => cmd.setLineSpacing(c, s)) })),
            "separator" as const,
            { label: "Add space before paragraph", onSelect: needCtx((c) => cmd.setSpaceBefore(c, 10)) },
            { label: "Add space after paragraph", onSelect: needCtx((c) => cmd.setSpaceAfter(c, 10)) },
          ] },
          { label: "Bullets & numbering", items: [
            { label: "Bulleted list", shortcut: `${MOD}${SHIFT}8`, checked: format?.bullet === "bullet", onSelect: needCtx((c) => cmd.setList(c, "bullet")) },
            { label: "Numbered list", shortcut: `${MOD}${SHIFT}7`, checked: format?.bullet === "number", onSelect: needCtx((c) => cmd.setList(c, "number")) },
          ] },
          "separator",
          { label: "Clear formatting", shortcut: `${MOD}\\`, onSelect: needCtx((c) => cmd.formatMarks(c, { bold: null, italic: null, underline: null, strike: null, color: null, highlight: null, fontFamily: null, fontSize: null, baseline: null, allCaps: null, smallCaps: null, letterSpacing: null })) },
          { label: "Format options…", disabled: !hasSel, onSelect: () => setPanel("format") },
        ] },
        { label: "Arrange", items: arrangeItems() },
        { label: "Tools", items: [
          { label: "Find and replace", shortcut: `${MOD}F`, onSelect: () => setFindOpen(true) },
          { label: "Word count", onSelect: () => setDialog("wordcount") },
          { label: "Alt text…", disabled: !hasSel, onSelect: () => setPanel("format") },
        ] },
      ]
    : [];

  const guard = (items: MenuEntry[]): MenuEntry[] =>
    readOnly || previewing
      ? items.map((it) => (it === "separator" ? it : it.items ? { ...it, items: guard(it.items) } : { ...it, disabled: it.disabled || !/^(Copy|Select all|Find|Present|Presenter|Zoom|Fit|\d+%|Show |Motion|Microsoft|PDF|Pli JSON|Word count|Download|Save as theme|Version history)/.test(it.label) }))
      : items;

  // ---- Theme editor ---------------------------------------------------------------------------------------------------

  /** Opens the master view on a layout or master (by default the layout of the slide being edited). */
  function enterTheme(target?: string, fromSlide?: string) {
    if (readOnly) return;
    const cur = slides.find((x) => x.id === (fromSlide ?? slideId));
    const first = deck.masters[0]!.layouts[0]!.id;
    const l = target ?? (cur && deck.masters.some((m) => m.layouts.some((x) => x.id === cur.layout)) ? cur.layout : first);
    if (!themeEdit) returnTo.current = cur?.id ?? slides[0]?.id ?? null;
    // masters from a file have one empty line in their body: give them the five levels PowerPoint's master view shows
    attempt(() => session.addLevelPrompts());
    setThemeEdit(l);
    setEditing(null);
    setCellRange(null);
    setTool(null);
    setPanel((p) => (p === "transition" || p === "motion" ? null : p));
    setSelection(session, { slide: l, elements: [] });
  }
  function leaveTheme() {
    setThemeEdit(null);
    setEditing(null);
    setCellRange(null);
    setTool(null);
    const back = slides.find((x) => x.id === returnTo.current)?.id ?? slides[0]?.id ?? null;
    returnTo.current = null;
    setSelection(session, { slide: back, slides: back ? [back] : [], elements: [] });
  }
  function pickTemplate(id: string) {
    setThemeEdit(id);
    setEditing(null);
    setCellRange(null);
    setSelection(session, { slide: id, elements: [] });
  }
  /** Title, date, footer and number appear once on a layout; the master has one of each of title and body too. */
  function canAddPlaceholder(type: PlaceholderType): boolean {
    if (!themeEdit || readOnly) return false;
    const fam = placeholderFamily(type);
    const have = session.elementsOf(themeEdit).some((e) => e.type === "shape" && e.placeholder && placeholderFamily(e.placeholder.type) === fam);
    const onMaster = deck.masters.some((m) => m.id === themeEdit);
    return !have || (!["title", "dt", "ftr", "sldNum"].includes(fam) && !onMaster);
  }
  function addPlaceholder(type: PlaceholderType) {
    if (!themeEdit) return;
    attempt(() => {
      const el = session.addPlaceholder(themeEdit, type);
      setSelection(session, { ...session.selection, slide: themeEdit, elements: [el.id] });
    });
  }

  // ---- Keys -----------------------------------------------------------------------------------------------------------

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    // an older version is on show: nothing to edit, and Escape goes back to the deck as it is
    if (previewing) {
      if (e.key === "Escape") {
        e.preventDefault();
        setPreviewing(null);
      }
      return;
    }
    const t = e.target as HTMLElement;
    const inField = !!t.closest?.("input, select, textarea");
    const inText = !!t.closest?.("[contenteditable='true'], [contenteditable='plaintext-only']");
    if (inField) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" && preview.playing) {
      e.preventDefault();
      e.stopPropagation();
      return preview.stop();
    }
    // keys pressed in a side panel are the panel's (Enter on a button, arrows in a list), except shortcuts with Ctrl or Cmd
    if (!mod && t.closest?.(".pli-deck-panel")) return;
    const k = e.key.toLowerCase();
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod) {
      if (k === "z" && !e.shiftKey) return (stop(), void session.undo());
      if ((k === "z" && e.shiftKey) || k === "y") return (stop(), void session.redo());
      if (k === "enter") return (stop(), startPresent(!e.shiftKey));
      if (k === "f" && !e.shiftKey) return (stop(), setFindOpen(true));
      if (k === "k" && !e.shiftKey && !readOnly) return (stop(), setDialog("link"));
      if (readOnly) return;
      if (e.shiftKey && !e.altKey && ["l", "e", "r", "j"].includes(k) && g) return (stop(), cmd.setAlign(g, ({ l: "left", e: "center", r: "right", j: "justify" } as const)[k as "l"]));
      if (e.shiftKey && (e.key === "&" || e.code === "Digit7" || e.key === "7") && g) return (stop(), cmd.setList(g, "number"));
      if (e.shiftKey && (e.key === "*" || e.code === "Digit8" || e.key === "8") && g) return (stop(), cmd.setList(g, "bullet"));
      if ((e.key === "]" || e.key === "[") && g && !e.shiftKey) return (stop(), cmd.indent(g, e.key === "]" ? 1 : -1));
      if (e.key === "\\" && g) return (stop(), cmd.formatMarks(g, { bold: null, italic: null, underline: null, strike: null, color: null, highlight: null, fontFamily: null, fontSize: null, baseline: null }));
      if (e.code === "KeyM" && e.altKey && !e.shiftKey) return (stop(), startComment());
      if (inText) return;
      if (k === "m" && !e.altKey) return (stop(), newSlide());
      if (e.code === "KeyM" && e.altKey && e.shiftKey) return (stop(), void session.setSkipped(slideTargets(), !currentSlide?.skipped));
      if (k === "d" && !e.shiftKey) return (stop(), duplicateSelected());
      if (k === "a" && !e.shiftKey) return (stop(), selectAll());
      if (k === "g" && !e.altKey && !e.shiftKey && selectedIds.length > 1) return (stop(), void session.group(owner, selectedIds));
      if (k === "g" && e.shiftKey) return (stop(), void selectedEls.filter((x) => x.kind === "group").forEach((x) => session.ungroup(owner, x.id)));
      if (e.altKey && k === "g") return (stop(), void (e.shiftKey ? selectedEls.filter((x) => x.kind === "group").forEach((x) => session.ungroup(owner, x.id)) : selectedIds.length > 1 && session.group(owner, selectedIds)));
      if (["b", "i", "u"].includes(k) && g && hasSel) {
        const key = ({ b: "bold", i: "italic", u: "underline" } as const)[k as "b"];
        return (stop(), cmd.toggleMark(g, key, !!format?.[key]));
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!hasSel) return;
        stop();
        return session.arrange(owner, selectedIds, e.key === "ArrowUp" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
      }
      return;
    }
    if (inText || readOnly) return;
    if (e.key === "Escape") {
      if (tool) return (stop(), setTool(null));
      if (cropping) return (stop(), setCropping(false));
      if (hasSel) return (stop(), select([]));
      if (themeEdit) return (stop(), leaveTheme());
      return;
    }
    if (editing) return;
    if ((e.key === "Delete" || e.key === "Backspace") && hasSel) {
      if (cellRange && tableSel && e.key === "Delete") {
        // clear the text of the selected cells
        stop();
        const tbl = session.element(owner, tableSel.id);
        if (tbl.type === "table") session.updateElement(owner, tbl.id, (el) => (el.type === "table" ? { ...el, rows: el.rows.map((r, ri) => ({ ...r, cells: r.cells.map((c, ci) => (ri >= cellRange.r1 && ri <= cellRange.r2 && ci >= cellRange.c1 && ci <= cellRange.c2 ? { ...c, paragraphs: [{ runs: [] }] } : c)) })) } : el));
        return;
      }
      return (stop(), deleteSelected());
    }
    if (e.key.startsWith("Arrow")) {
      if (!hasSel) {
        const i = slides.findIndex((s) => s.id === slideId);
        const to = slides[i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)];
        if (to && !themeEdit) {
          stop();
          selectSlide(to.id, [to.id]);
        }
        return;
      }
      stop();
      const d = e.shiftKey ? 10 : 1;
      session.moveBy(owner, selectedIds, e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0, { merge: false });
      return;
    }
    if (e.key === "Tab" && scene) {
      const els = scene.elements.filter((x) => x.from === from && !x.hidden);
      if (els.length) {
        stop();
        const i = els.findIndex((x) => x.id === selectedIds[0]);
        select([els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]!.id]);
      }
      return;
    }
    if (selectedEls.length === 1 && isPicturePlaceholder(selectedEls[0]!) && e.key === "Enter" && !readOnly) return (stop(), chooseImages(selectedEls[0]!.id));
    if (selectedEls.length === 1 && editable(selectedEls[0]!)) {
      const el = selectedEls[0]!;
      if (e.key === "Enter") return (stop(), startEdit({ element: el.id, cell: el.kind === "table" ? [cellRange?.r1 ?? 0, cellRange?.c1 ?? 0] : undefined }));
      if (e.key.length === 1 && !e.altKey) return (stop(), startEdit({ element: el.id, cell: el.kind === "table" ? [cellRange?.r1 ?? 0, cellRange?.c1 ?? 0] : undefined, text: e.key }));
    }
  };

  const clipTarget = (e: { target: EventTarget | null }) => {
    const t = e.target as HTMLElement | null;
    return !!t?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']");
  };
  const inFilmstrip = (e: { target: EventTarget | null }) => !!(e.target as HTMLElement | null)?.closest?.(".pli-deck-filmstrip");

  // ---- Drawing ------------------------------------------------------------------------------------------------------

  const imageFileInput = (
    <input ref={imageRef} type="file" accept="image/*" multiple hidden aria-label="Upload picture" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
  );
  const openInput = (
    <input ref={fileRef} type="file" accept={OPEN_ACCEPT} hidden aria-label="Open presentation" onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ""; }} />
  );

  const goto = (hit: FindHit) => {
    selectSlide(hit.slide, [hit.slide]);
    if (hit.element) setSelection(session, { slide: hit.slide, slides: [hit.slide], elements: [hit.element] });
  };

  const slideHighlights = useMemo(() => (commentLight.length ? [...highlights, ...commentLight] : highlights), [highlights, commentLight]);

  return (
    <FontsProvider fonts={fonts}>
     <FilePickerProvider picker={filePicker}>
     <ThemeContext.Provider value={forcedTheme(theme)}>
      <div
        ref={rootRef}
        className={className ? `pli-deck pli-deck-root ${className}` : "pli-deck pli-deck-root"}
        data-theme={forcedTheme(theme)}
        data-readonly={readOnly ? "" : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onCopy={(e) => {
          if (clipTarget(e)) return;
          if (inFilmstrip(e)) {
            const clip = copySlides(session, slideTargets());
            e.clipboardData?.setData("text/plain", JSON.stringify(clip));
            e.preventDefault();
            return;
          }
          const clip = copySelected(false);
          if (clip) {
            e.clipboardData?.setData("text/plain", JSON.stringify(clip));
            e.preventDefault();
          }
        }}
        onCut={(e) => {
          if (clipTarget(e) || readOnly) return;
          if (inFilmstrip(e)) {
            const clip = copySlides(session, slideTargets());
            e.clipboardData?.setData("text/plain", JSON.stringify(clip));
            e.preventDefault();
            deleteSlides(slideTargets());
            return;
          }
          const clip = copySelected(true);
          if (clip) {
            e.clipboardData?.setData("text/plain", JSON.stringify(clip));
            e.preventDefault();
          }
        }}
        onPaste={(e) => {
          if (clipTarget(e) || readOnly) return;
          e.preventDefault();
          const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
          if (files.length) return void addFiles(files);
          const text = e.clipboardData?.getData("text/plain") ?? "";
          if (inFilmstrip(e)) {
            const clip = parseClip(text) ?? lastSlideClip();
            if (clip && isSlideClip(clip)) pasteSlides(session, clip);
            return;
          }
          if (text) pasteText(text);
          else pasteClip(lastElementClip());
        }}
      >
        {menu && (
          <div className="pli-chrome pli-deck-chrome">
            <div className="pli-titlebar">
              {startActions && <div className="pli-actions pli-actions-start">{startActions}</div>}
              <input
                className="pli-doc-title"
                aria-label="Presentation title"
                value={title}
                readOnly={readOnly}
                placeholder="Untitled presentation"
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title !== deck.title && !readOnly && session.setTitle(title)}
                onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
              />
              <div className="pli-actions">
                <PeopleBar collab={collab} room={room} />
                {commentClient && (
                  <button type="button" className="pli-button pli-deck-comments-button" aria-pressed={panel === "comments"} aria-label="Comments" title={`Comments (${MOD}${ALT}M)`} onClick={() => setPanel(panel === "comments" ? null : "comments")}>
                    {I.comment} {threads.filter((t) => !t.resolved).length || ""}
                  </button>
                )}
                {actions}
                <button type="button" className="pli-button pli-button-primary pli-deck-slideshow" disabled={!!previewing} title={previewing ? "Go back to the current version to present" : undefined} onClick={() => startPresent(false)}>{I.present} Slideshow</button>
                {endActions}
              </div>
            </div>
            <MenuBar menus={extendMenus(menus.map((m) => ({ ...m, items: guard(m.items) })), extraMenus)} />
            {toolbar && ctx && !previewing && (
              <DeckToolbar
                session={session}
                readOnly={readOnly}
                ctx={ctx}
                selection={selectedEls}
                format={format}
                editingText={!!editing}
                zoom={zoom}
                fitZoom={fitZoom}
                onZoom={setZoom}
                tool={tool}
                onTool={setTool}
                onImage={() => chooseImages()}
                onNewSlide={newSlide}
                layouts={themeEdit ? (deck.masters.find((m) => m.id === themeEdit || m.layouts.some((l) => l.id === themeEdit)) ?? deck.masters[0]!).layouts : layouts}
                currentLayout={themeEdit ?? currentLayout}
                onLayout={(id) => (themeEdit ? pickTemplate(id) : slideTargets().forEach((s) => session.setLayout(s, id)))}
                onMaster={() => (themeEdit ? leaveTheme() : enterTheme())}
                onPlaceholder={addPlaceholder}
                canPlaceholder={canAddPlaceholder}
                onBackground={() => setDialog("background")}
                onTheme={() => setPanel(panel === "theme" ? null : "theme")}
                onTransition={() => setPanel(panel === "transition" ? null : "transition")}
                onMotion={() => (panel === "motion" ? setPanel(null) : openMotion())}
                motionOpen={panel === "motion"}
                onLink={() => setDialog("link")}
                onFormatOptions={() => setPanel("format")}
                onPresent={() => startPresent(false)}
                cropping={cropping}
                onCrop={setCropping}
                templateMode={!!themeEdit}
                tableMenu={tableMenu()}
              />
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="pli-notice pli-deck-warnings-banner" role="status">
            <span>{warnings.length} note{warnings.length === 1 ? "" : "s"}: {warnings.slice(0, 3).join("; ")}{warnings.length > 3 ? `; and ${warnings.length - 3} more` : ""}</span>
            <button type="button" className="pli-button" onClick={() => setWarnings([])}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="pli-notice pli-deck-notice" role="alert">
            <span>{notice}</span>
            <button type="button" className="pli-button" onClick={() => setNotice("")}>Dismiss</button>
          </div>
        )}
        {!present && presenters.length > 0 && (
          <div className="pli-notice pli-deck-follow-banner" role="status">
            <span>
              <strong>{presenters[0]!.peer.user.name}</strong> is presenting
              {presenters.length > 1 ? ` (and ${presenters.length - 1} more)` : ""}.
            </span>
            <button type="button" className="pli-button pli-button-primary" onClick={() => follow(presenters[0]!.peer.client)}>Follow</button>
          </div>
        )}
        {themeEdit && (
          <div className="pli-notice pli-deck-theme-banner" role="status">
            <span>
              <strong>Editing master</strong> — changes apply to every slide that uses it.{" "}
              <span className="pli-deck-theme-target">{from === "master" ? `Master: ${editedMaster?.name}` : `Layout: ${editedLayout?.name}`}</span>
            </span>
            <button type="button" className="pli-button pli-button-primary" aria-label="Close master view" onClick={leaveTheme}>Close master view</button>
          </div>
        )}

        {previewing && versionHistory && <PreviewBar history={versionHistory} version={previewing} onBack={() => setPreviewing(null)} />}
        <div className="pli-deck-workspace">
          {previewing && previewSession ? (
            <div className="pli-deck-main pli-deck-preview">
              <PliDeck session={previewSession} readOnly menu={false} toolbar={false} theme={theme} fonts={fontsProp} className="pli-deck-preview-editor" />
            </div>
          ) : (
          <>
          {showFilmstrip && !themeEdit && (
            <aside className="pli-deck-side" aria-label="Slides">
              <Filmstrip
                session={session}
                current={slideId}
                selected={selectedSlides.length ? selectedSlides : slideId ? [slideId] : []}
                onSelect={selectSlide}
                readOnly={readOnly}
                onContextMenu={(at, ids) => setCtxMenu({ ...at, label: "Slide", items: [...slideMenuItems(ids).slice(0, 4), { label: "Cut", onSelect: () => { copySlides(session, ids); writeClipboard(JSON.stringify(copySlides(session, ids))); deleteSlides(ids); } }, { label: "Copy", onSelect: () => writeClipboard(JSON.stringify(copySlides(session, ids))) }, { label: "Paste", onSelect: () => { const c = lastSlideClip(); if (c) pasteSlides(session, c); } }, "separator", ...slideMenuItems(ids).slice(4), "separator", { label: "Edit master / layout…", disabled: readOnly, onSelect: () => enterTheme(undefined, ids[0]) }] })}
                onNewSlide={() => newSlide()}
                onDelete={deleteSlides}
                onDuplicate={duplicateSlides}
                onCopy={(ids, cut) => { writeClipboard(JSON.stringify(copySlides(session, ids))); if (cut) deleteSlides(ids); }}
                onPaste={() => { const c = lastSlideClip(); if (c) pasteSlides(session, c); }}
                comments={commentClient ? filmComments : undefined}
                people={room ? filmPeople : undefined}
                onComments={(id) => { selectSlide(id, [id]); setPanel("comments"); }}
              />
            </aside>
          )}
          {themeEdit && (
            <aside className="pli-deck-side pli-deck-template-list" aria-label="Master and layouts">
              <TemplateList session={session} active={themeEdit} onPick={pickTemplate} readOnly={readOnly} />
            </aside>
          )}
          <div className="pli-deck-main">
            {findOpen && <FindBar session={session} readOnly={readOnly} onClose={() => { setFindOpen(false); setHighlights([]); }} onGoto={goto} onHighlights={setHighlights} />}
            <div ref={areaRef} className="pli-deck-area" onPointerDown={(e) => { if (e.target === e.currentTarget) select([]); }}>
              {scene && (
                <div className="pli-deck-slide-frame" style={{ width: scene.width * scale, height: scene.height * scale }}>
                  <SlideCanvas
                    session={session}
                    owner={owner}
                    scene={scene}
                    from={from}
                    selected={selectedIds}
                    scale={scale}
                    readOnly={readOnly}
                    tool={tool}
                    onTool={setTool}
                    editing={editing}
                    onEdit={(t) => (t ? startEdit(t) : stopEditing())}
                    cellRange={cellRange}
                    onCellRange={setCellRange}
                    cropping={cropping}
                    onSelect={select}
                    guides={snapOn}
                    highlights={slideHighlights}
                    textApiRef={textApiRef}
                    onTextState={setTextState}
                    onFiles={(files, at) => void addFiles(files, at)}
                    onChartOptions={(id) => { select([id]); setDialog("chart"); }}
                onPickPicture={(id) => chooseImages(id)}
                    poses={preview.poses}
                    overlay={
                      themeEdit || !slideId ? undefined : (
                        <>
                          {room && <RemoteLayer session={session} peers={collab.peers} you={collab.you} slideId={slideId} scene={scene} scale={scale} />}
                          {commentClient && <CommentPins session={session} client={commentClient} slideId={slideId} scene={scene} scale={scale} activeId={activeThread} onActivate={activateThread} />}
                        </>
                      )
                    }
                    animation={themeEdit ? undefined : { animations: animList, panelOpen: panel === "motion", active: animSel, onPick: (id) => { setAnimSel(id); setPanel("motion"); }, onPath: (id, path) => attempt(() => !readOnly && session.updateAnimation(owner, id, { path })) }}
                    onContextMenu={(at) => setCtxMenu({ ...at, label: "Canvas", items: "canvas" })}
                  />
                </div>
              )}
            </div>
            {showNotes && !themeEdit && <NotesPane session={session} slideId={slideId} readOnly={readOnly} height={notesHeight} onResize={setNotesHeight} />}
          </div>
          </>
          )}
          {panel === "theme" && <ThemePanel session={session} readOnly={readOnly} masterId={(editedMaster ?? deck.masters.find((m) => m.layouts.some((l) => l.id === currentLayout)))?.id} onClose={() => setPanel(null)} onEditTheme={() => { setPanel(null); enterTheme(); }} />}
          {panel === "transition" && <TransitionPanel session={session} readOnly={readOnly} slideIds={slideTargets()} onClose={() => setPanel(null)} onPlay={() => startPresent(false)} />}
          {panel === "motion" && !themeEdit && <MotionPanel session={session} slideId={slideId} scene={scene} selection={selectedIds} readOnly={readOnly} active={animSel} onActive={setAnimSel} playing={preview.playing} onPlay={preview.play} onStop={preview.stop} onTransition={() => setPanel("transition")} onClose={() => setPanel(null)} />}
          {panel === "comments" && commentClient && <DeckCommentsPanel session={session} client={commentClient} slideId={slideId} activeId={activeThread} onActivate={activateThread} draft={commentDraft} onDraftDone={() => setCommentDraft(null)} onClose={() => { setPanel(null); setCommentDraft(null); }} readOnly={readOnly && !commentClient.can("comment")} />}
          {panel === "history" && versionHistory && (
            <VersionHistoryPanel history={versionHistory} activeId={previewing?.id ?? null} onPreview={setPreviewing} onRestored={() => setPreviewing(null)} onClose={() => setPanel(null)} />
          )}
          {panel === "format" && ctx && <FormatPanel session={session} owner={owner} ctx={ctx} selection={selectedEls} readOnly={readOnly} onClose={() => setPanel(null)} onChartOptions={() => setDialog("chart")} />}
        </div>

        {present && <PresentMode session={session} start={present.start} presenter={present.presenter} onExit={() => { setPresent(null); setShowAt(null); }} onOpenPresenterWindow={onOpenPresenterWindow} onPosition={setShowAt} following={followed ? { slide: followed.slide, step: followed.step } : null} />}
        {dialog === "link" && (
          <LinkDialog
            open
            initialUrl={format?.link}
            askForText={!!editing && !!textState?.collapsed}
            onApply={(url, text) => {
              if (editing && textState?.collapsed && text) textApiRef.current?.link(url, text);
              else if (ctx) cmd.formatMarks(ctx, { link: url });
            }}
            onRemove={() => ctx && cmd.formatMarks(ctx, { link: null })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "background" && (
          <BackgroundDialog
            current={themeEdit ? undefined : currentSlide?.background}
            onApply={(fill, all) => {
              if (themeEdit) {
                if (deck.masters.some((m) => m.id === themeEdit)) session.patchMaster(themeEdit, { background: fill });
                else session.patchLayout(themeEdit, { background: fill });
              } else session.setBackground(all ? slides.map((s) => s.id) : slideTargets(), fill);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "pagesetup" && <PageSetupDialog size={deck.size} onApply={setPageSize} onClose={() => setDialog(null)} />}
        {dialog === "imageurl" && (
          <UrlDialog
            title="Insert image by URL"
            label="Image URL"
            onApply={(url) => void measureImage(url).then((s) => { const el = session.addImage(owner, url, s); setSelection(session, { ...session.selection, elements: [el.id] }); })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "wordcount" && <WordCountDialog deck={deck} onClose={() => setDialog(null)} />}
        {dialog === "chart" && chartSel && scene && !readOnly && (() => {
          const raw = session.element(owner, chartSel.id);
          return raw.type === "chart" ? <ChartDialog chart={raw} theme={scene.theme} onApply={(next) => attempt(() => session.updateChart(owner, raw.id, () => next))} onClose={() => setDialog(null)} /> : null;
        })()}
        {ctxMenu && <ContextMenu menu={{ ...ctxMenu, items: ctxMenu.items === "canvas" ? canvasMenu() : ctxMenu.items }} onClose={() => setCtxMenu(null)} />}
        {imageFileInput}
        {openInput}
      </div>
     </ThemeContext.Provider>
     </FilePickerProvider>
    </FontsProvider>
  );

  function canvasMenu(): MenuEntry[] {
    const items: MenuEntry[] = [
      { label: "Cut", shortcut: `${MOD}X`, disabled: !hasSel || readOnly, onSelect: () => copySelected(true) },
      { label: "Copy", shortcut: `${MOD}C`, disabled: !hasSel, onSelect: () => copySelected(false) },
      { label: "Paste", shortcut: `${MOD}V`, disabled: readOnly, onSelect: () => void pasteFromClipboard() },
      { label: "Duplicate", shortcut: `${MOD}D`, disabled: !hasSel || readOnly, onSelect: duplicateSelected },
      { label: "Delete", shortcut: "Delete", disabled: !hasSel || readOnly, onSelect: deleteSelected },
      "separator",
      ...arrangeItems().filter((i) => i !== "separator" && ["Order", "Group", "Ungroup"].includes(i.label)),
      "separator",
      { label: "Link…", shortcut: `${MOD}K`, disabled: !hasSel || readOnly, onSelect: () => setDialog("link") },
      { label: "Format options…", disabled: !hasSel, onSelect: () => setPanel("format") },
      { label: "Add animation", disabled: !hasSel || readOnly || !!themeEdit, onSelect: () => openMotion(true) },
      ...(commentClient ? [{ label: "Comment", shortcut: `${MOD}${ALT}M`, disabled: !!themeEdit || !commentClient.can("comment"), onSelect: () => startComment() }] : []),
    ];
    if (tableSel) items.push("separator", { label: "Table", items: tableMenu() });
    if (chartSel) items.push("separator", { label: "Chart options…", disabled: readOnly, onSelect: () => setDialog("chart") });
    items.push("separator", themeEdit ? { label: "Close master view", onSelect: () => leaveTheme() } : { label: "Edit master / layout…", disabled: readOnly, onSelect: () => enterTheme() });
    return items;
  }
}

export { LayoutGrid };

/** The text of the slides, for choosing which script of a font a PDF needs. */
function deckText(deck: import("@pli.dev/decks").Deck): string {
  return JSON.stringify(deck.slides).slice(0, 60000);
}
