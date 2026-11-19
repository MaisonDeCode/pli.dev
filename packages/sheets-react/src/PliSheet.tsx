import { expectsReference } from "./edit";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Bar, ColorPicker, Dropdown, FontPicker, FontsProvider, Icons, MenuBar, MenuList, ThemeContext, VersionHistoryPanel, VersionPreviewBar, extendMenus, forcedTheme, keepFocus, pickWith, handOver, saveFailure, useDownloadHandler, useDocumentFonts, useFonts, FilePickerProvider, type ExtraMenus, type FilePicker, type MenuLabels, type MenuDefinition, type DownloadFile, type DownloadHandler, type MenuEntry, type PickOptions, type PliTheme } from "@pli.dev/react";
import type { FontRegistry } from "@pli.dev/core";
import {
  type Sheet,
  MAX_COLS,
  MAX_ROWS,
  acceptSuggestion,
  activeCell,
  advance,
  assistFormula,
  caret,
  cellAddress,
  fromCsv,
  fromXlsx,
  parseWorkbook,
  serializeWorkbook,
  toCsv,
  toXlsx,
  colName,
  isError,
  parseRange,
  chartRefText,
  rangeAddress,
  selectionBounds,
  selectionRanges,
  spansColumns,
  spansRows,
  mergeAt,
  parseCell,
  tableAt,
  findTable,
  hasHeader,
  isOpenable,
  isPlace,
  readImage,
  type Pivot,
  type SparklineGroup,
  parsePrintTitles,
  type CellLink,
  type TableStyleDef,
  type TimelineLevel,
  type Border,
  type BorderStyle,
  type BorderWhere,
  type Bounds,
  type CellStyle,
  type CellRuleOperator,
  type ConditionalRule,
  type RuleSpec,
  type ChartType,
  type Direction,
  type FormulaAssist,
  type Suggestion,
  type GridSelection,
  describePasteReport,
  parseExternalRef,
  type ExternalListResolver,
  type PivotDataResolver,
  type PasteReport,
  type ValidatePaste,
  type PasteOptions,
  NOTE_LOOK_KEYS,
  IMAGE_SHAPES,
  IMAGE_SHAPE_NAMES,
  SHAPE_GROUPS,
  type ImageShape,
} from "@pli.dev/sheets";
import { Grid, type CopiedRange, type EditState, type GridActions } from "./Grid";
import { pointStep, type PointState } from "./pointing";
import { ChoiceMenu, ContextMenu, DropdownDialog, FilterMenu } from "./menus";
import { CHART_RESET, ChartDialog } from "./ChartDialog";
import { FindBar, useFind } from "./FindBar";
import { CellCard, type CellCardInfo } from "./CellCard";
import { LinkDialog, type LinkDialogResult } from "./LinkDialog";
import { NoteDialog, type NoteDialogResult } from "./NoteEditor";
import { ChipCard, type ChipCardInfo } from "./ChipCard";
import { FilterViewsDialog } from "./FilterViewsDialog";
import { ImageDialog } from "./ImageDialog";
import { IterationDialog } from "./IterationDialog";
import { PasteSourceDialog } from "./PasteSourceDialog";
import { ProtectDialog, type ProtectMode, type ProtectResult } from "./ProtectDialog";
import { EditRangePasswordDialog, EditRangesDialog } from "./EditRangesDialog";
import type { SheetUser, RangeSortLevel, SlicerStyleDef } from "@pli.dev/sheets";
import { SheetSession, listPivots, listTables, sheetVersionHistory, type SubtotalFunction, type SheetOp, type Workbook } from "@pli.dev/sheets";
import { builtinSlicerStyle, usedFonts } from "@pli.dev/sheets";
import { SpellChecker, type AccessIssue, type SpellDictionary } from "@pli.dev/sheets";
import { SpellDialog } from "./SpellDialog";
import { AccessibilityPanel } from "./AccessibilityPanel";
import { SortDialog } from "./SortDialog";
import { DuplicatesDialog } from "./DuplicatesDialog";
import { SlicerStyleDialog } from "./SlicerStyleDialog";
import { SheetPageDialog, type PageSetupPatch } from "./SheetPageDialog";
import { PrintPreview, type PliSheetPrintJob } from "./PrintPreview";
import { SparklineDialog, type SparklineDialogResult } from "./SparklineDialog";
import { FilterConditionDialog } from "./FilterConditionDialog";
import { PivotDialog, type PivotDialogResult } from "./PivotDialog";
import { imageFromFile } from "./imageFile";
import { RuleDialog, RulesDialog, type PivotChoice } from "./RuleDialog";
import { ValidationDialog, type ValidationResult } from "./ValidationDialog";
import { TABLE_STYLES, TableDialog } from "./TableDialog";
import { SlicerDialog, type SlicerDialogResult } from "./SlicerDialog";
import { TimelineDialog, type TimelineDialogResult } from "./TimelineDialog";
import { SubtotalDialog } from "./SubtotalDialog";
import { TableStyleDialog } from "./TableStyleDialog";
import { BAR_COLORS, COLOR_SCALES, ICON_SET_LABELS, colorScaleRule, evenSteps } from "./rules";
import { FormatIcons } from "./toolbarIcons";
import { hasPicker, type ChipKind } from "./chips";
import { FormulaAssistView } from "./FormulaAssist";
import { useSheetRevision } from "./hooks";
import { CollabIcons } from "@pli.dev/react";
import { PeopleBar, peerMarks, peersBySheet, publishPresence, useSheetCollab, type CommentsProp, type SyncProp } from "./collab";
import { CommentsPanel, ThreadHover, threadMarks, useThreads } from "./comments";
import type { AutoSaveOptions, CollabRoom, NamedVersion, PliUser, Users, VersionHistory, VersionStorage } from "@pli.dev/core";
import type { CellAnchor } from "@pli.dev/sheets";
import { stepDecimals } from "./numberformat";

export interface PliSheetProps {
  session: SheetSession;
  /**
   * The fonts of this editor (the font picker's list, how fonts are loaded, which are embedded in PDF files). Defaults to
   * `defaultFonts()` from `@pli.dev/core`: every Office font and Google family, fetched from Fontsource when used.
   */
  fonts?: FontRegistry;
  /**
   * Draw the pictures that `IMAGE` formulas fetch from the web. Off by default: opening a workbook that someone else made
   * shouldn't contact other sites, so such a cell shows its text (the description, or the address) instead.
   */
  remoteImages?: boolean;
  /**
   * What to do about pasted, moved, filled or sorted cells that break a data validation rule: `off` (like Excel, the
   * default), `warn` (they go in, and a notice says which break their rule) or `refuse` (cells that break a `stop` rule keep
   * what they had; a move or a sort that would break one is refused). Sets `session.validatePaste`.
   */
  validatePaste?: ValidatePaste;
  /**
   * Reads lists that data validation takes from another workbook, such as `[Prices.xlsx]Sheet1!$A$1:$A$10`: given the
   * workbook's name and `Sheet1!$A$1:$A$10`, give the cells' values (or null when you can't find them). The items are kept in
   * the workbook as a snapshot, so the list still works, flagged as possibly out of date, when this isn't given. Sets `session.externalLists`.
   */
  externalLists?: ExternalListResolver;
  /**
   * Supplies the data of pivot tables that read outside the workbook: a range of another workbook, or a named block
   * (`data:Sales`). It is asked for the rows when the editor opens and when a pivot table is refreshed; what it answers is kept in
   * the workbook, so the pivot tables work without it. Sets `session.pivotData`.
   */
  pivotData?: PivotDataResolver;
  /**
   * Who writes the notes made here, as it should be written on them (a name; for example the signed-in user's `name`).
   * Without it notes have no author: Pli never fills it in from anything about the person or the machine.
   */
  author?: string;
  /** No editing: the grid can be moved around and copied from. */
  readOnly?: boolean;
  /** Show the toolbar (default true). */
  toolbar?: boolean;
  /** Show the name box and formula bar (default true). */
  formulaBar?: boolean;
  /** Show the sheet tabs (default true). */
  tabs?: boolean;
  /** Show the sum, average and count of the selection (default true). */
  statusBar?: boolean;
  /**
   * Who is using the sheet: an id and the roles your app gives them. Protected sheets and ranges that may be edited can name roles
   * (see the Protection page), and this is how they are checked. Left out, the session's own user (if any) is kept.
   */
  user?: SheetUser | null;
  /** Show the title and the File, Edit, View, Insert, Format, Data and Review menus (default true). */
  menu?: boolean;
  /**
   * Called with each file File > Download makes, instead of the browser downloading it: save it in your own storage, or show the
   * phone's share sheet (a web view inside a native app can't download a file). The second argument has `browserDownload()`, the
   * default, for the files or places you don't handle. If it throws or rejects the sheet says the file couldn't be saved. Left out,
   * the nearest `DownloadProvider`'s function is used, and without one the browser downloads the file.
   */
  onDownload?: DownloadHandler;
  /**
   * Where File > Print… sends the pages: your own print service. Called with the printout as a PDF file (and the pages laid out,
   * as HTML), when someone presses Print in the print preview. Without it the preview has no Print button but Download PDF, which
   * saves the same file (through `onDownload` when that is given). No page of Pli's own opens the browser's print dialog unless
   * `browserPrint` is on.
   */
  onPrint?: (job: PliSheetPrintJob) => void | Promise<void>;
  /** Add "Print with the browser…" to the print preview, which opens the browser's own print dialog (where "Save as PDF" lives). Off by default. */
  browserPrint?: boolean;
  /** Extra controls in the title row, such as a Share button. */
  actions?: ReactNode;
  /** Controls at the far left of the title row, before the spreadsheet's name: a back button, your logo, a breadcrumb. */
  startActions?: ReactNode;
  /** Controls at the far right of the title row, after everything else: a profile menu, a close button. */
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
   * Your own way of choosing a file, for File > Import, Insert > Image and the picture fields in dialogs: show your own dialog (files in
   * your app, a drive) and return the chosen `File`. Left out, the browser's file chooser opens. See `FilePicker`.
   */
  filePicker?: FilePicker;
  /**
   * The versions of the workbook (see `VersionHistory`): adds View > Version history and a side panel where a version can be looked at
   * (the sheet shows it, read-only) and restored. Restoring adds a new version and keeps every earlier one.
   */
  history?: VersionHistory<Workbook, SheetOp>;
  /**
   * Where versions are kept: a shortcut for `history` that makes the `VersionHistory` for you (`sheetVersionHistory`). Needs `users`.
   * Saving and restoring need the `editor` role.
   */
  versions?: VersionStorage<Workbook>;
  /**
   * With `versions`: keep a version now and then without anyone asking, so the history shows how the workbook changed. On by default;
   * `false` turns it off, or give `{ every, keep }` (see `AutoSaveOptions`).
   */
  autoSaveVersions?: boolean | AutoSaveOptions;
  /**
   * What the kinds of badge your app uses mean, by name: `{ person: { label: "Person", resolve, search } }`. A cell
   * that is a badge of kind `person` keeps an id, and this turns it into a name and a picture, and lets people search for
   * one to put in. See `ChipKind`.
   */
  chips?: Readonly<Record<string, ChipKind>>;
  /**
   * The dictionary for Review > Spelling…: a list of words (an array, a Set or one long string), or an object with `has(word)` and
   * optionally `suggest(word, max)` and `words()` (see `SpellDictionary`), such as one built from Hunspell's files. Without it a small
   * list of common English words is used.
   */
  spellDictionary?: SpellDictionary | Iterable<string> | string;
  /** The words people added to their own dictionary before (so the check does not flag them again). */
  spellWords?: Iterable<string>;
  /** Called with a word when someone presses "Add to dictionary", for you to keep it. */
  onSpellAddWord?: (word: string) => void;
  className?: string;
  /**
   * The room that carries who is here, comments and live editing: `new CollabRoom({ room, transport, users })` over your own
   * transport (Socket.io, a WebSocket, a BroadcastChannel). The editor connects it and says `{ sheet, selection, editing }` through it.
   */
  room?: CollabRoom<CellAnchor>;
  /** Who is using the sheet (and who the authors of comments are): `new Users(currentUser)` or a `UserDirectory`. */
  users?: Users;
  /**
   * Turns on comment threads on cells (Excel's threaded comments, with replies, resolve and @mentions): `true`, or options
   * (`store`, `permissions`). Threads are kept in the workbook (and the .xlsx file) unless you give a `store`.
   */
  comments?: CommentsProp;
  /**
   * Live editing: keeps the workbook in step with the shared one over `room` (with `sheetSyncModel`). `true`, or options (the
   * version the workbook was loaded at, `onResync`). Shows "Saved" and "Offline" beside the people in the title row.
   */
  sync?: boolean | SyncProp;
}

/** A file made by File > Download. */
export type PliSheetDownload = DownloadFile;

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHIFT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⇧" : "Shift+";
const readFile = <T extends string | ArrayBuffer>(file: File, as: "text" | "buffer"): Promise<T> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read"));
    if (as === "text") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
const safeName = (title: string) => (title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-");

const NUMBER_FORMATS: { label: string; format: string | null; example: string }[] = [
  { label: "Automatic", format: null, example: "" },
  { label: "Plain text", format: "@", example: "" },
  { label: "Number", format: "#,##0.00", example: "1,000.12" },
  { label: "Integer", format: "#,##0", example: "1,000" },
  { label: "Percent", format: "0.00%", example: "10.12%" },
  { label: "Scientific", format: "0.00E+00", example: "1.01E+03" },
  { label: "Currency", format: "$#,##0.00", example: "$1,000.12" },
  { label: "Accounting", format: "#,##0.00;(#,##0.00)", example: "(1,000.12)" },
  { label: "Date", format: "m/d/yyyy", example: "9/26/2008" },
  { label: "Date (ISO)", format: "yyyy-mm-dd", example: "2008-09-26" },
  { label: "Long date", format: "dddd, mmmm d, yyyy", example: "Friday, September 26, 2008" },
  { label: "Time", format: "h:mm AM/PM", example: "3:59 PM" },
  { label: "Date and time", format: "m/d/yyyy h:mm", example: "9/26/2008 15:59" },
  { label: "Duration", format: "[h]:mm:ss", example: "24:01:00" },
];

/** The cells the toolbar acts on: the selection, cut down when it spans a whole column or row to what the sheet uses (with room to type in). */
function workingBounds(b: Bounds, used: { r: number; c: number }): Bounds {
  return {
    ...b,
    r2: spansColumns(b) ? Math.max(b.r1, Math.min(b.r2, Math.max(used.r, 100))) : b.r2,
    c2: spansRows(b) ? Math.max(b.c1, Math.min(b.c2, Math.max(used.c, 26))) : b.c2,
  };
}

function describeSelection(sel: GridSelection): string {
  const b = selectionBounds(sel);
  if (spansColumns(b) && spansRows(b)) return "A:XFD";
  if (spansColumns(b)) return b.c1 === b.c2 ? `${colName(b.c1)}:${colName(b.c1)}` : `${colName(b.c1)}:${colName(b.c2)}`;
  if (spansRows(b)) return b.r1 === b.r2 ? `${b.r1}:${b.r1}` : `${b.r1}:${b.r2}`;
  const a = activeCell(sel);
  return b.r1 === b.r2 && b.c1 === b.c2 ? cellAddress(a.row, a.col) : rangeAddress(b);
}

/**
 * A spreadsheet: a grid with a formula bar, toolbar and sheet tabs, driven by a `SheetSession`. Click or drag to select,
 * type to enter, F2 or double-click to edit, drag the fill handle, resize columns and rows by their borders. The workbook
 * lives in the session; read it from there (`session.state`) to save it.
 */
export function PliSheet(props: PliSheetProps) {
  const fonts = useFonts(props.fonts);
  return (
    <FontsProvider fonts={fonts}>
      <ThemeContext.Provider value={forcedTheme(props.theme)}>
        <FilePickerProvider picker={props.filePicker}>
          <PliSheetView {...props} />
        </FilePickerProvider>
      </ThemeContext.Provider>
    </FontsProvider>
  );
}

function PliSheetView({ session, remoteImages: remoteImagesProp = false, validatePaste, externalLists, readOnly: readOnlyProp = false, toolbar = true, formulaBar = true, tabs = true, statusBar = true, menu = true, onDownload: onDownloadProp, onPrint, browserPrint = false, actions, startActions, endActions, theme, extraMenus, menuLabels, filePicker, history: historyProp, versions, autoSaveVersions, chips, className, author, user, pivotData, spellDictionary, spellWords, onSpellAddWord, room, users, comments, sync }: PliSheetProps) {
  const collab = useSheetCollab(session, { room, users, comments, sync });
  const commentClient = collab.comments;
  // An older version being looked at: nothing in the real workbook can be changed meanwhile.
  const [previewVersion, setPreviewVersion] = useState<NamedVersion<Workbook> | null>(null);
  const readOnly = readOnlyProp || !!previewVersion;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyUsers = users ?? commentClient?.users;
  // Made in an effect, so that a history that was stopped when the editor was taken away is made again when it comes back (React
  // does this in development), instead of a stopped one being kept.
  const [ownHistory, setOwnHistory] = useState<VersionHistory<Workbook, SheetOp> | null>(null);
  useEffect(() => {
    if (historyProp || !versions || !historyUsers) {
      setOwnHistory(null);
      return;
    }
    const made = sheetVersionHistory(session, {
      storage: versions,
      users: historyUsers,
      ...(autoSaveVersions === false ? {} : { autoSave: typeof autoSaveVersions === "object" ? autoSaveVersions : {} }),
    });
    setOwnHistory(made);
    return () => made.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the options are read once, when the history is made
  }, [session, historyProp, versions, historyUsers]);
  const history = historyProp ?? ownHistory ?? undefined;
  /** The version being looked at, as a workbook of its own that nobody can change. */
  const previewSession = useMemo(() => (previewVersion ? new SheetSession(JSON.parse(JSON.stringify(previewVersion.state)) as Workbook) : null), [previewVersion]);
  const showHistory = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) setPreviewVersion(null);
  };
  const threadList = useThreads(commentClient);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<{ sheet: string; range: string } | null>(null);
  const revision = useSheetRevision(session);
  // The fonts the workbook names are fetched when it is shown, and the grid is drawn again as each arrives.
  const fonts = useFonts();
  const usedNow = useMemo(() => usedFonts(session.state), [session.state]);
  useDocumentFonts(fonts, usedNow);
  const sheets = session.state.sheets;
  const firstShown = () => (session.state.sheets.find((s) => !s.hidden) ?? session.state.sheets[0]!).id;
  const [sheetId, setSheetId] = useState(firstShown);
  const sheet = sheets.find((s) => s.id === sheetId && !s.hidden) ?? sheets.find((s) => !s.hidden) ?? sheets[0]!;
  const [selections, setSelections] = useState<Record<string, GridSelection>>({});
  const selection = selections[sheet.id] ?? caret({ row: 1, col: 1 });
  const setSelection = useCallback((s: GridSelection) => setSelections((all) => ({ ...all, [sheet.id]: s })), [sheet.id]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [copied, setCopied] = useState<CopiedRange | null>(null);
  const sink = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const gridActions = useRef<GridActions | null>(null);
  const [contextAt, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showFormulaBar, setShowFormulaBar] = useState(true);
  const [showStatus, setShowStatus] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [choiceMenu, setChoiceMenu] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const [dropdownDialog, setDropdownDialog] = useState(false);
  const [chartId, setChartId] = useState<string | null>(null);
  /** The picture in crop mode (Picture > Crop): it is also the picked one, and its edges crop it. */
  const [cropId, setCropId] = useState<string | null>(null);
  // Crop mode ends when another thing (or nothing) is picked, when the picture is gone, or on another sheet.
  useEffect(() => {
    if (cropId && (cropId !== chartId || !sheet.images?.some((x) => x.id === cropId))) setCropId(null);
  });
  const [chartMenu, setChartMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chartDialog, setChartDialog] = useState<string | null>(null);
  const [imageDialog, setImageDialog] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const cellImageInput = useRef<HTMLInputElement>(null);
  /** The rule being made (`id` null) or changed, and the kind a new one starts as. */
  const [ruleDialog, setRuleDialog] = useState<{ id: string | null; kind?: ConditionalRule["kind"]; op?: CellRuleOperator } | null>(null);
  const [rulesManager, setRulesManager] = useState(false);
  const [validationDialog, setValidationDialog] = useState(false);
  const [tableDialog, setTableDialog] = useState<"new" | "rename" | null>(null);
  /** The slicer style dialog: the slicer to give the style to, and the style being made or changed. */
  const [slicerStyleDialog, setSlicerStyleDialog] = useState<{ slicer: string; name: string; def: SlicerStyleDef; isNew: boolean } | null>(null);
  const [slicerDialog, setSlicerDialog] = useState<{ mode: "insert" } | { mode: "settings"; id: string } | null>(null);
  const [slicerMenu, setSlicerMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [timelineDialog, setTimelineDialog] = useState<{ mode: "insert" } | { mode: "settings"; id: string } | null>(null);
  const [timelineMenu, setTimelineMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [exceptionMenu, setExceptionMenu] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const [styleDialog, setStyleDialog] = useState<{ name: string; def: TableStyleDef; isNew: boolean; was?: string } | null>(null);
  const [circles, setCircles] = useState(false);
  /** What the last checked paste, move, fill or sort found, shown until it is dismissed or the next one. */
  const [pasteNote, setPasteNote] = useState<PasteReport | null>(null);
  useEffect(() => session.onPasteReport(setPasteNote), [session]);
  useEffect(() => {
    if (validatePaste) session.validatePaste = validatePaste;
  }, [session, validatePaste]);
  const [externalTick, bumpExternal] = useState(0);
  const refreshExternal = useCallback(() => session.refreshExternalLists().then((r) => (bumpExternal((n) => n + 1), r)), [session]);
  useEffect(() => {
    if (!externalLists) return;
    session.externalLists = externalLists;
    void refreshExternal();
  }, [session, externalLists, refreshExternal]);
  useEffect(() => {
    if (!pivotData) return;
    session.pivotData = pivotData;
    void session.refreshPivotData();
  }, [session, pivotData]);
  const [card, setCard] = useState<CellCardInfo | null>(null);
  /** Filter views: the dialog, and the view each sheet is showing for this person (not saved, and not what others see). */
  const [viewsDialog, setViewsDialog] = useState(false);
  const [viewIds, setViewIds] = useState<Record<string, string>>({});
  /** A view that sorts is drawn from a copy of the workbook with the view applied, since a sort moves cells; nothing in the copy can be changed. */
  const sortedPreview = useMemo(() => {
    const id = viewIds[sheet.id];
    if (!id || !sheet.filterViews?.some((v) => v.id === id)) return null;
    try {
      return session.previewFilterView(sheet.id, id);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheet, revision, viewIds]);
  const shownSession = sortedPreview ?? session;
  /** The card of a badge that was clicked, with the sheet it is on. */
  const [chipCard, setChipCard] = useState<(ChipCardInfo & { sheet: string }) | null>(null);
  const [protectDialog, setProtectDialog] = useState<ProtectMode | null>(null);
  const [iterationDialog, setIterationDialog] = useState(false);
  const [spellDialog, setSpellDialog] = useState(false);
  const [accessPanel, setAccessPanel] = useState(false);
  const spellChecker = useMemo(() => new SpellChecker(spellDictionary, { custom: spellWords ?? [] }), [spellDictionary, spellWords]);
  const [pasteSourceDialog, setPasteSourceDialog] = useState(false);
  const [editRangesDialog, setEditRangesDialog] = useState(false);
  /** The range whose password is being asked for. */
  const [rangePassword, setRangePassword] = useState<{ sheet: string; name: string } | null>(null);
  const userKey = user === undefined ? undefined : JSON.stringify(user);
  useEffect(() => {
    if (user !== undefined) session.setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, userKey]);
  /** Pictures from the web: what the editor was told to begin with, which the View menu can change for this session. */
  const [remoteImages, setRemoteImages] = useState(remoteImagesProp);
  useEffect(() => setRemoteImages(remoteImagesProp), [remoteImagesProp]);
  // Notes made from now on are by this author (when the host says who).
  useEffect(() => {
    if (author !== undefined) session.author = author;
  }, [session, author]);
  const [pageDialog, setPageDialog] = useState(false);
  const [conditionDialog, setConditionDialog] = useState<{ col: number; table?: string } | null>(null);
  /** The Sort dialog: for a table (its id), or a range (the sheet's filter range has its header fixed). */
  /** The Remove duplicates dialog: for a table (its id) or a range. */
  const [dupDialog, setDupDialog] = useState<{ table?: string; range?: string } | null>(null);
  const [sortDialog, setSortDialog] = useState<{ table?: string; range?: string; col: number; fixed?: boolean } | null>(null);
  const [pivotDialog, setPivotDialog] = useState<{ pivot: Pivot | null; source: string } | null>(null);
  const [subtotalDialog, setSubtotalDialog] = useState<{ range: string } | null>(null);
  const [sparkDialog, setSparkDialog] = useState<{ group: SparklineGroup | null; data: string; location: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [showBreaks, setShowBreaks] = useState(false);
  /** View > Page break preview: the print ranges and pages drawn on the sheet, with breaks that can be dragged. */
  const [pagePreview, setPagePreview] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);
  const [borderLine, setBorderLine] = useState<Border>({ style: "thin" });
  const importInput = useRef<HTMLInputElement>(null);
  /** Chooses files the way the editor was set up to: the hidden file field's chooser, or the `filePicker` the app gave. */
  const choose = (input: { current: HTMLInputElement | null }, options: PickOptions, use: (files: File[]) => void) => {
    if (!filePicker) return input.current?.click();
    void pickWith(filePicker, options).then((files) => files.length > 0 && use(files));
  };

  // ---- help while typing a formula ----
  const [caretAt, setCaretAt] = useState(0);
  const [pick, setPick] = useState({ query: "", index: 0 });
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const definedNames = [...Object.keys(session.state.names ?? {}), ...session.state.sheets.flatMap((x) => (x.tables ?? []).map((t) => t.name))];
  const assist: FormulaAssist = useMemo(
    () => (edit && edit.text.startsWith("=") ? assistFormula(edit.text, Math.min(caretAt, edit.text.length), definedNames) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit?.text, caretAt, definedNames.join("|")],
  );
  const shownAssist: FormulaAssist = edit && dismissedAt === edit.text ? (assist.call ? { call: assist.call } : {}) : assist;
  const assistIndex = shownAssist.completing && pick.query === shownAssist.completing.query ? Math.min(pick.index, shownAssist.completing.items.length - 1) : 0;
  useEffect(() => {
    if (!edit) setDismissedAt(null);
  }, [edit]);
  const hasAssist = !!(shownAssist.completing || shownAssist.call);
  const acceptCompletion = (s: Suggestion) => {
    if (!edit || !shownAssist.completing) return;
    const next = acceptSuggestion(edit.text, shownAssist.completing, s);
    setEdit({ ...edit, text: next.text, mode: "edit" });
    setCaretAt(next.caret);
    const field = edit.from === "bar" ? bar.current : sink.current;
    requestAnimationFrame(() => {
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(next.caret, next.caret);
    });
  };
  /** Keys that belong to the list of completions while it is open. Returns true when it took the key. */
  const assistKey = (e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault(): void }): boolean => {
    const c = shownAssist.completing;
    if (!c || !edit) return false;
    const n = c.items.length;
    // With nothing typed yet (just "=" and the popular functions), the up and down arrows point at cells instead.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && c.query !== "") {
      e.preventDefault();
      setPick({ query: c.query, index: (assistIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      acceptCompletion(c.items[assistIndex]!);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissedAt(edit.text);
      return true;
    }
    return false;
  };
  const assistView = hasAssist ? (
    <FormulaAssistView
      assist={shownAssist}
      index={assistIndex}
      nameFormula={(n) => Object.entries(session.state.names ?? {}).find(([k]) => k === n)?.[1]}
      onPick={acceptCompletion}
      onHover={(i) => shownAssist.completing && setPick({ query: shownAssist.completing.query, index: i })}
    />
  ) : null;
  /** Closes a badge's card and gives the keyboard back to the grid. */
  const closeChipCard = useCallback(() => {
    setChipCard(null);
    sink.current?.focus({ preventScroll: true });
  }, []);
  // The card belongs to the cell it was opened from: moving the selection elsewhere, or starting an entry, closes it.
  useEffect(() => {
    if (chipCard && (selection.focus.row !== chipCard.row || selection.focus.col !== chipCard.col || edit)) setChipCard(null);
  }, [selection, edit, chipCard]);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number; table?: string } | null>(null);
  const bar = useRef<HTMLInputElement>(null);

  // A sheet that was deleted leaves the next one showing, and ends an entry that was in it.
  useEffect(() => {
    if (!sheets.some((s) => s.id === sheetId && !s.hidden)) setSheetId(firstShown());
    if (edit && !sheets.some((s) => s.id === edit.sheet)) setEdit(null);
  }, [sheets, sheetId, edit]);
  /** Ends or changes the entry; cancelling it brings back the sheet it was on. */
  const changeEdit = (next: EditState | null) => {
    if (next === null && edit && edit.sheet !== sheetId && sheets.some((s) => s.id === edit.sheet)) setSheetId(edit.sheet);
    setEdit(next);
  };

  const active = activeCell(selection);
  const activeAddress = cellAddress(active.row, active.col);
  const cell = sheet.cells[activeAddress];
  const bounds = selectionBounds(selection);
  /** Whether a protected sheet lets this cell be selected (Excel's "Select locked cells" and "Select unlocked cells"). */
  const selectableIn = (s: Sheet, row: number, col: number): boolean => !s.protection || s.protection.allow.includes(session.isLocked(s.id, cellAddress(row, col)) ? "selectLockedCells" : "selectUnlockedCells");
  const selectIfAllowed = (next: GridSelection) => {
    if (selectableIn(sheet, next.focus.row, next.focus.col)) setSelection(next);
  };
  /** After Enter or Tab, the next cell that can be selected: on a sheet that doesn't allow selecting locked cells, they go from one unlocked cell to the next. */
  const nextSelectable = (home: Sheet, from: GridSelection, move: Direction): GridSelection => {
    let at = from;
    for (let i = 0; i < 20000; i++) {
      const f = activeCell(at);
      if (selectableIn(home, f.row, f.col)) return at;
      const next = advance(at, move);
      const g = activeCell(next);
      if (g.row === f.row && g.col === f.col) break;
      at = next;
    }
    return from;
  };
  const find = useFind({
    session,
    revision,
    sheetId: sheet.id,
    active,
    selectionRange: bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2 ? null : rangeAddress(bounds),
    go: (target, row, col) => {
      setSelections((all) => ({ ...all, [target]: caret({ row, col }) }));
      setSheetId(target);
    },
  });
  const used = useMemo(() => {
    let r = 0;
    let c = 0;
    for (const a of Object.keys(sheet.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(a)!;
      r = Math.max(r, Number(m[2]));
      c = Math.max(c, [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
    }
    return { r, c };
  }, [sheet]);
  const work = workingBounds(bounds, used);
  const workAddress = rangeAddress(work);
  const workRanges = selectionRanges(selection).map((b) => workingBounds(b, used));
  /** Runs something that changes the sheet, and says why in a message when the sheet refuses (it is protected, say). */
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof Error && (e.name === "ProtectionError" || e.name === "PliError")) {
        const range = (e as { editRange?: { sheet: string; name: string } }).editRange;
        if (range) setRangePassword(range);
        else setNotice(e.message);
      } else throw e;
    }
  };
  /** Runs an edit on every selected rectangle, as one undo step. */
  const eachRange = (fn: (address: string) => void) => attempt(() => session.batch(() => workRanges.forEach((b) => fn(rangeAddress(b)))));

  const commit = useCallback(
    (move: Direction | null) => {
      if (!edit) return;
      try {
        // Data validation: a stop refuses the entry (it stays in the editor to be corrected); the others ask first.
        const refusal = session.checkEntry(edit.sheet, cellAddress(edit.row, edit.col), edit.text);
        if (refusal) {
          if (refusal.alert === "stop") {
            setNotice(refusal.title === "Invalid entry" ? refusal.message : `${refusal.title}: ${refusal.message}`);
            return;
          }
          if (typeof window !== "undefined" && !window.confirm(`${refusal.title}\n\n${refusal.message}\n\nKeep the entry anyway?`)) return;
        }
        session.setCell(edit.sheet, cellAddress(edit.row, edit.col), edit.text, { validate: false, links: true });
      } catch (e) {
        setNotice((e as Error).message); // keep the text, so it can be corrected
        return;
      }
      setNotice(null);
      setEdit(null);
      // Finishing with Enter or Tab goes back to the sheet the entry began on, if another was being looked at; a click elsewhere stays where it was.
      const home = selections[edit.sheet] ?? caret({ row: edit.row, col: edit.col });
      if (move && edit.sheet !== sheet.id) setSheetId(edit.sheet);
      if (move) {
        const homeSheet = session.state.sheets.find((x) => x.id === edit.sheet) ?? sheet;
        setSelections((all) => ({ ...all, [edit.sheet]: nextSelectable(homeSheet, advance({ ...home, active: { row: edit.row, col: edit.col } }, move), move) }));
      }
      requestAnimationFrame(() => sink.current?.focus({ preventScroll: true }));
    },
    [edit, session, sheet.id, selections],
  );

  // ---- links and notes ----
  /** Follows a link: to a place in the workbook, or out to the web, mail or phone. */
  const openLink = (link: CellLink, address?: string) => {
    // A link that was followed takes the followed-hyperlink colour of the theme.
    if (address) session.followLink(sheet.id, address);
    if (isPlace(link.to)) {
      const place = session.linkPlace(sheet.id, link.to);
      if (!place) return setNotice(`There is nothing at ${link.to.slice(1)}`);
      const r = parseRange(place.range)!;
      setSelections((all) => ({ ...all, [place.sheet]: { anchor: { row: r.r1, col: r.c1 }, focus: { row: r.r2, col: r.c2 } } }));
      setSheetId(place.sheet);
      sink.current?.focus({ preventScroll: true });
    } else if (/^(?:mailto|tel|sms):/i.test(link.to)) window.location.href = link.to;
    else if (isOpenable(link.to)) window.open(link.to, "_blank", "noopener,noreferrer");
    else setNotice("That kind of link can't be followed from here");
  };
  const singleCell = bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2;

  // ---- comments and other people ----
  const threadHere = commentClient ? session.comments.threadAt(sheet.id, activeAddress) : undefined;
  /** Starts a comment on the selected cell or range, or opens the thread the cell already has. */
  const startComment = () => {
    if (!commentClient || readOnly || !commentClient.can("comment")) return;
    setCommentsOpen(true);
    if (threadHere) {
      setActiveThread(threadHere.id);
      return;
    }
    setCommentDraft({ sheet: sheet.id, range: spansColumns(bounds) || spansRows(bounds) || singleCell ? activeAddress : rangeAddress(bounds) });
  };
  /** Goes to the cell of a thread (the sheet it is on is shown, the cell selected and scrolled into view). */
  const goToThread = (id: string | null) => {
    setActiveThread(id);
    if (!id) return;
    const place = session.comments.placeOf(id);
    const at = place ? parseCell(place.cell) : null;
    if (!place || !at) return;
    setSheetId(place.sheet);
    setSelections((all) => ({ ...all, [place.sheet]: caret({ row: at.row, col: at.col }) }));
    requestAnimationFrame(() => gridActions.current?.reveal(at.row, at.col));
  };
  // The thread of the selected cell is the open one in the panel.
  const selectedThread = threadHere?.id ?? null;
  useEffect(() => {
    if (commentsOpen && !commentDraft) setActiveThread(selectedThread);
  }, [commentsOpen, commentDraft, selectedThread]);
  const marks = useMemo(() => (commentClient ? threadMarks(session, threadList, sheet.id, activeThread) : undefined), [commentClient, session, threadList, sheet.id, activeThread, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const peerList = useMemo(() => (room ? peerMarks(collab.peers, collab.you, sheet.id) : undefined), [room, collab.peers, collab.you, sheet.id]);
  const peerTabs = useMemo(() => (room ? peersBySheet(collab.peers) : undefined), [room, collab.peers]);
  // What this person is doing, said to the room: the sheet, the selected cells, the cell being typed in.
  useEffect(() => {
    if (room) publishPresence(room, { sheet: sheet.id, selection, editing: edit && edit.sheet === sheet.id ? { row: edit.row, col: edit.col } : null });
  });
  const deleteComment = () => {
    if (threadHere && commentClient) attempt(() => commentClient.deleteThread(threadHere.id));
  };
  const noteHere = cell?.note !== undefined ? session.noteInfo(sheet.id, activeAddress) : null;
  const linkHere = singleCell ? session.link(sheet.id, activeAddress) : null;
  const ownLink = linkHere && !linkHere.formula ? linkHere : cell?.link ?? null;
  const saveLink = (result: LinkDialogResult) => {
    try {
      const link: CellLink = { to: result.to, ...(result.tip ? { tip: result.tip } : {}) };
      if (singleCell) session.setLink(sheet.id, activeAddress, link, result.text !== undefined ? { text: result.text } : {});
      else eachRange((a) => session.setLink(sheet.id, a, link));
    } catch (e) {
      return (e as Error).message;
    }
    setLinkDialog(false);
    sink.current?.focus({ preventScroll: true });
  };
  const removeLink = () => {
    if (readOnly) return;
    eachRange((a) => session.setLink(sheet.id, a, null));
    setLinkDialog(false);
    sink.current?.focus({ preventScroll: true });
  };
  const saveNote = (result: NoteDialogResult) => {
    try {
      const { show: _was, ...rest } = session.noteInfo(sheet.id, activeAddress)?.box ?? {};
      // The size and place stay as they are; the look is what the dialog says.
      const geometry = Object.fromEntries(Object.entries(rest).filter(([k]) => !(NOTE_LOOK_KEYS as readonly string[]).includes(k)));
      const box = { ...geometry, ...(result.show ? { show: true as const } : {}), ...result.look };
      session.setNote(sheet.id, activeAddress, result.text, { runs: result.runs ?? null, box: Object.keys(box).length ? box : null });
    } catch (e) {
      return (e as Error).message;
    }
    setNoteDialog(false);
    sink.current?.focus({ preventScroll: true });
  };
  /** Shows or hides the note on the active cell (a note that is shown stays on the sheet), or on every cell of the sheet. */
  const toggleNote = () => {
    if (readOnly) return;
    try {
      session.showNote(sheet.id, activeAddress);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const showAllNotes = (show: boolean) => {
    if (readOnly) return;
    try {
      session.showAllNotes(sheet.id, show);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  /** Moves to the next (or previous) cell with a note, round the end. */
  const stepNote = (direction: 1 | -1) => {
    const all = session.notes(sheet.id).map((n) => parseCell(n.address)!);
    if (!all.length) return;
    const after = (p: { row: number; col: number }) => p.row > active.row || (p.row === active.row && p.col > active.col);
    const pick = direction > 0 ? all.find(after) ?? all[0]! : [...all].reverse().find((p) => !after(p) && !(p.row === active.row && p.col === active.col)) ?? all[all.length - 1]!;
    setSelections((cur) => ({ ...cur, [sheet.id]: caret({ row: pick.row, col: pick.col }) }));
  };
  const deleteNote = () => {
    if (readOnly) return;
    session.setNote(sheet.id, activeAddress, null);
    setNoteDialog(false);
    sink.current?.focus({ preventScroll: true });
  };

  const style = (patch: { [K in keyof CellStyle]?: CellStyle[K] | null }) => {
    if (readOnly) return;
    eachRange((a) => session.setStyle(sheet.id, a, patch));
    sink.current?.focus({ preventScroll: true });
  };
  /** Locks or unlocks the selection; whole columns, rows or the sheet carry the lock for the cells they will have. */
  const toggleLocked = () => {
    if (readOnly) return;
    const lock = !session.isLocked(sheet.id, activeAddress);
    attempt(() => session.batch(() => selectionRanges(selection).forEach((b) => session.setLocked(sheet.id, rangeAddress(b), lock))));
    sink.current?.focus({ preventScroll: true });
  };
  /** Hides or shows the formulas of the selection once the sheet is protected; whole columns, rows or the sheet carry it for the cells they will have. */
  const toggleHideFormula = () => {
    if (readOnly) return;
    const hide = !session.hidesFormula(sheet.id, activeAddress);
    attempt(() => session.batch(() => selectionRanges(selection).forEach((b) => session.setFormulaHidden(sheet.id, rangeAddress(b), hide))));
    sink.current?.focus({ preventScroll: true });
  };
  const toggle = (key: "bold" | "italic" | "underline" | "strike" | "wrap") => style({ [key]: cell?.s?.[key] ? null : true });
  const format = (f: string | null) => {
    if (!readOnly) eachRange((a) => session.setFormat(sheet.id, a, f));
    sink.current?.focus({ preventScroll: true });
  };

  // ---- the formula bar ----
  const formulaHidden = session.formulaHidden(sheet.id, activeAddress);
  const barCell = sortedPreview ? sortedPreview.sheet(sheet.id).cells[activeAddress] : cell;
  const shownText = edit ? edit.text : formulaHidden ? "" : barCell?.f !== undefined ? "=" + barCell.f : barCell?.v !== undefined ? String(barCell.v) : (barCell?.e ?? "");
  /** The reference an arrow key is moving through the formula in the formula bar (Point mode). */
  const barPoint = useRef<PointState | null>(null);
  useEffect(() => {
    if (!edit) barPoint.current = null;
  }, [edit]);
  const barKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (assistKey(e)) return;
    // F2 switches the formula bar between Edit (arrow keys move the text cursor) and Enter (they point at cells), as in Excel.
    if (e.key === "F2" && edit && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      barPoint.current = null;
      setEdit({ ...edit, mode: edit.mode === "enter" ? "edit" : "enter" });
      return;
    }
    if (edit?.from === "bar" && edit.mode === "enter" && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const el = e.currentTarget;
      const step = pointStep({
        text: edit.text,
        selStart: el.selectionStart ?? edit.text.length,
        selEnd: el.selectionEnd ?? el.selectionStart ?? edit.text.length,
        was: barPoint.current,
        here: edit.sheet === sheet.id ? { row: edit.row, col: edit.col } : active,
        key: e.key,
        shift: e.shiftKey,
        mod: e.ctrlKey || e.metaKey,
        filled: (r, c) => { const x = sheet.cells[cellAddress(r, c)]; return !!x && (x.v !== undefined || x.e !== undefined || x.f !== undefined); },
        ...(edit.sheet !== sheet.id ? { otherSheet: sheet.name } : {}),
      });
      if (step) {
        e.preventDefault();
        barPoint.current = step.state;
        setEdit({ ...edit, text: step.text, mode: "enter" });
        setCaretAt(step.caret);
        gridActions.current?.reveal(step.state.focus.row, step.state.focus.col);
        requestAnimationFrame(() => el.setSelectionRange(step.caret, step.caret));
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (edit) commit("down");
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEdit(null);
      sink.current?.focus();
    }
  };

  const [nameText, setNameText] = useState<string | null>(null);
  const goTo = (text: string) => {
    const t = text.trim();
    const r = parseRange(t.replace(/\$/g, ""));
    setNameText(null);
    if (r) {
      setSelection({ anchor: { row: r.r1, col: r.c1 }, focus: { row: r.r2, col: r.c2 } });
      sink.current?.focus();
      return;
    }
    // A table's name goes to its data.
    const tbl = findTable(session.state, t);
    if (tbl) {
      setSheetId(tbl.sheet.id);
      setSelection({ anchor: { row: tbl.bounds.r1 + 1, col: tbl.bounds.c1 }, focus: { row: tbl.table.totals ? tbl.bounds.r2 - 1 : tbl.bounds.r2, col: tbl.bounds.c2 } });
      sink.current?.focus();
      return;
    }
    // A defined name stands for a range.
    const f = session.state.names && Object.entries(session.state.names).find(([n]) => n.toLowerCase() === t.toLowerCase())?.[1];
    const m = f && /^(?:'?([^'!]+)'?!)?(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/i.exec(f);
    const target = m && parseRange(m[2]!.replace(/\$/g, "").toUpperCase());
    if (target) {
      const other = m[1] && session.state.sheets.find((s) => s.name.toLowerCase() === m[1]!.toLowerCase());
      if (other) setSheetId(other.id);
      setSelection({ anchor: { row: target.r1, col: target.c1 }, focus: { row: target.r2, col: target.c2 } });
    }
    sink.current?.focus();
  };

  // ---- structure ----
  const insertAt = (what: "row" | "col", where: "before" | "after") => attempt(() => {
    const count = what === "row" ? bounds.r2 - bounds.r1 + 1 : bounds.c2 - bounds.c1 + 1;
    const at = what === "row" ? (where === "before" ? bounds.r1 : bounds.r2 + 1) : where === "before" ? bounds.c1 : bounds.c2 + 1;
    if (what === "row") session.insertRows(sheet.id, at, Math.min(count, 1000));
    else session.insertColumns(sheet.id, at, Math.min(count, 1000));
    if (where === "before") setSelection(selection);
});
  const deleteHere = (what: "row" | "col") => attempt(() => {
    if (what === "row") session.deleteRows(sheet.id, bounds.r1, Math.min(bounds.r2 - bounds.r1 + 1, 100000));
    else session.deleteColumns(sheet.id, bounds.c1, Math.min(bounds.c2 - bounds.c1 + 1, 16000));
    setSelection(caret({ row: Math.min(active.row, MAX_ROWS), col: Math.min(active.col, MAX_COLS) }));
});
  const sortBy = (descending: boolean) => attempt(() => {
    const r = spansColumns(bounds) || bounds.r1 === bounds.r2 ? { ...work, r1: 1, r2: Math.max(used.r, 1) } : work;
    const range = bounds.c1 === bounds.c2 && bounds.r1 === bounds.r2 ? { ...r, c1: 1, c2: Math.max(used.c, active.col) } : r;
    const first = session.value(sheet.id, cellAddress(range.r1, range.c1));
    const header = typeof first === "string" && typeof session.value(sheet.id, cellAddress(Math.min(range.r1 + 1, range.r2), range.c1)) === "number";
    session.sort(sheet.id, rangeAddress(range), { by: Math.max(1, Math.min(active.col, range.c2) - range.c1 + 1), descending, header });
});
  /** Opens the Sort dialog for the table the active cell is in, or the block of data around the selection. */
  const openSort = () => {
    if (tableHere && hasHeader(tableHere)) return setSortDialog({ table: tableHere.id, col: active.col });
    const r = spansColumns(bounds) || bounds.r1 === bounds.r2 ? { ...work, r1: 1, r2: Math.max(used.r, 1) } : work;
    const range = bounds.c1 === bounds.c2 && bounds.r1 === bounds.r2 ? { ...r, c1: 1, c2: Math.max(used.c, active.col) } : r;
    setSortDialog({ range: rangeAddress(range), col: Math.max(range.c1, Math.min(active.col, range.c2)) });
  };
  /** Opens the Remove duplicates dialog for the table the active cell is in, or the block of data around the selection. */
  const openDuplicates = () => {
    if (tableHere) return setDupDialog({ table: tableHere.id });
    const r = spansColumns(bounds) || bounds.r1 === bounds.r2 ? { ...work, r1: 1, r2: Math.max(used.r, 1) } : work;
    const range = bounds.c1 === bounds.c2 && bounds.r1 === bounds.r2 ? { ...r, c1: 1, c2: Math.max(used.c, active.col) } : r;
    setDupDialog({ range: rangeAddress(range) });
  };
  const freeze = (rows: number, cols: number) => attempt(() => session.setFrozen(sheet.id, rows, cols));

  const selectionStats = useMemo(() => {
    if (spansColumns(bounds) && spansRows(bounds)) return null;
    const parts = selectionRanges(selection).map((r) => workingBounds(r, used));
    if (parts.reduce((n, b) => n + (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1), 0) < 2) return null;
    let sum = 0;
    let n = 0;
    let count = 0;
    const entries = Object.keys((sortedPreview ? sortedPreview.sheet(sheet.id) : sheet).cells);
    const inside = (a: string) => {
      const m = /^([A-Z]+)(\d+)$/.exec(a)!;
      const r = Number(m[2]);
      const c = [...m[1]!].reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0);
      return parts.some((b) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2);
    };
    for (const a of entries) {
      if (!inside(a)) continue;
      const v = shownSession.value(sheet.id, a);
      if (v === null) continue;
      count++;
      if (typeof v === "number") {
        sum += v;
        n++;
      } else if (isError(v)) continue;
    }
    return count === 0 ? null : { sum, average: n ? sum / n : null, count, numbers: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheet, revision, selection, used, sortedPreview]);

  const clipboard = (what: "cut" | "copy") => () => {
    sink.current?.focus({ preventScroll: true });
    if (typeof document.execCommand === "function") document.execCommand(what);
  };
  const pasteClipboard = (options?: PasteOptions) => {
    sink.current?.focus({ preventScroll: true });
    const clip = navigator.clipboard;
    // The HTML too when the browser lets it be read, so the looks come along; plain text otherwise.
    if (typeof clip?.read === "function") {
      void clip.read().then(
        async (items) => {
          let text = "";
          let html = "";
          for (const item of items) {
            if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
            if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
          }
          if (text !== "" || html !== "") gridActions.current?.paste(text, html, options);
          else clip.readText().then((t) => gridActions.current?.paste(t, undefined, options), () => {});
        },
        () => clip.readText().then((t) => gridActions.current?.paste(t, undefined, options), () => {}),
      );
    } else clip?.readText().then((t) => gridActions.current?.paste(t, undefined, options), () => {});
  };
  /** Paste special: what of the copied cells to bring. */
  const pasteSpecialItems = (): MenuEntry[] => [
    { label: "Values only", shortcut: `${SHIFT}${MOD}V`, onSelect: () => pasteClipboard({ content: "values" }) },
    { label: "Formulas", onSelect: () => pasteClipboard({ content: "formulas" }) },
    { label: "Formats only", onSelect: () => pasteClipboard({ content: "formats" }) },
    "separator",
    { label: "Keep source column widths", onSelect: () => pasteClipboard({ widths: true }) },
    { label: "Tables as plain cells", onSelect: () => pasteClipboard({ asRange: true }) },
    { label: "Formulas from Excel…", onSelect: () => setPasteSourceDialog(true) },
    "separator",
    { label: "Transpose", onSelect: () => pasteClipboard({ transpose: true }) },
  ];
  const wholeRowsSelected = spansRows(bounds);
  const wholeColsSelected = spansColumns(bounds);
  const rowCount = bounds.r2 - bounds.r1 + 1;
  const colCount = bounds.c2 - bounds.c1 + 1;
  /** Wraps menu entries so that what the sheet refuses is said in a message. */
  const guarded = (items: MenuEntry[]): MenuEntry[] =>
    items.map((item) => {
      if (typeof item === "string") return item;
      const next = { ...item };
      if ("onSelect" in next && typeof next.onSelect === "function") {
        const run = next.onSelect;
        next.onSelect = () => attempt(() => run());
      }
      if ("items" in next && next.items) next.items = guarded(next.items);
      return next;
    });

  // ---- subtotals ----
  /** Opens the Subtotal dialog for the selected list (or the block of data around the active cell). */
  const openSubtotal = () => {
    const single = bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2;
    const range = single ? session.currentRegion(sheet.id, activeAddress) : rangeAddress(bounds);
    const list = parseRange(range)!;
    const pivot = listPivots(sheet, list)[0];
    if (pivot) return setNotice(`A pivot table can't be subtotalled (${pivot} is in the way); a pivot table has subtotals of its own`);
    setSubtotalDialog({ range });
  };
  const subtotalColumns = (range: string) => {
    const b = parseRange(range);
    if (!b) return [];
    return Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => ({ letter: colName(b.c1 + i), heading: session.display(sheet.id, `${colName(b.c1 + i)}${b.r1}`).text }));
  };

  // ---- sparklines ----
  /** Opens the sparklines dialog: for the group of the active cell, or for new ones starting from the selection. */
  const openSparklines = () => {
    const here = session.sparklineAt(sheet.id, activeAddress);
    if (here) return setSparkDialog({ group: here.group, data: "", location: "" });
    const single = bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2;
    const next = Math.min(MAX_COLS, bounds.c2 + 1);
    setSparkDialog({ group: null, data: single ? "" : rangeAddress(bounds), location: single ? "" : bounds.r1 === bounds.r2 ? `${colName(next)}${bounds.r1}` : `${colName(next)}${bounds.r1}:${colName(next)}${bounds.r2}` });
  };
  const saveSparklines = (result: SparklineDialogResult): string | void => {
    try {
      const group = sparkDialog?.group;
      if (group) session.updateSparklines(sheet.id, group.id, { type: result.type, ...clearedStyle(), ...result.style });
      else session.addSparklines(sheet.id, { type: result.type, location: result.location!, data: result.data!, ...definedOnly(result.style) });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setSparkDialog(null);
    sink.current?.focus({ preventScroll: true });
  };

  // ---- pivot tables ----
  const pivotHere = session.pivotAt(sheet.id, activeAddress);
  /** Opens the pivot table dialog: for the pivot table the active cell is in, or for a new one over the selection (or the block of data around the cell). */
  const openPivot = () => {
    if (pivotHere) return setPivotDialog({ pivot: pivotHere, source: pivotHere.source });
    const single = bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2;
    const region = parseRange(single ? session.currentRegion(sheet.id, activeAddress) : rangeAddress(bounds))!;
    setPivotDialog({ pivot: null, source: single && !session.cell(sheet.id, activeAddress) ? "" : chartRefText(sheet.name, region) });
  };
  const savePivot = (result: PivotDialogResult): string | void => {
    const shape = { rows: result.rows, columns: result.columns, values: result.values, filters: result.filters, calculated: result.calculated, calculatedItems: result.calculatedItems, style: result.style, slicers: result.slicers, timelines: result.timelines, tabular: result.tabular, outline: result.outline, repeatLabels: result.repeatLabels, valuesOnRows: result.valuesOnRows, autoRefresh: result.autoRefresh, grandTotalRows: result.grandTotalRows, grandTotalColumns: result.grandTotalColumns, pageFields: result.pageFields };
    try {
      const existing = pivotDialog?.pivot;
      if (existing) {
        const home = session.state.sheets.find((s) => s.pivots?.some((p) => p.id === existing.id)) ?? sheet;
        session.updatePivot(home.id, existing.id, { ...shape, ...(result.name ? { name: result.name } : {}), source: result.source, ranges: result.ranges });
      } else {
        const added = result.sheet === "" ? session.addSheet() : undefined;
        const target = added?.name ?? result.sheet!;
        let made;
        try {
          made = session.createPivot(target, { ...shape, source: result.source, ...(result.ranges ? { ranges: result.ranges } : {}), anchor: result.anchor ?? "A1" });
        } catch (e) {
          if (added) session.deleteSheet(added.id);
          throw e;
        }
        const home = session.sheet(target);
        setSheetId(home.id);
        const at = parseCell(made.anchor)!;
        setSelections((all) => ({ ...all, [home.id]: caret({ row: at.row, col: at.col }) }));
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setPivotDialog(null);
    sink.current?.focus({ preventScroll: true });
  };
  const pivotItems = (): MenuEntry[] => [
    { label: "Create pivot table…", disabled: readOnly, onSelect: openPivot },
    { label: "Edit pivot table…", disabled: readOnly || !pivotHere, onSelect: openPivot },
    "separator",
    { label: "Show details", disabled: readOnly || !pivotHere, onSelect: () => attempt(() => setSheetId(session.showPivotDetails(sheet.id, activeAddress).id)) },
    { label: "Refresh", disabled: readOnly || !pivotHere, onSelect: () => (session.pivotData ? void session.refreshPivotData().then(() => attempt(() => session.refreshPivot(sheet.id, pivotHere!.id))) : attempt(() => session.refreshPivot(sheet.id, pivotHere!.id))) },
    { label: "Refresh all", disabled: readOnly || !session.state.sheets.some((s) => s.pivots?.length), onSelect: () => (session.pivotData ? void session.refreshPivotData().then(() => attempt(() => session.refreshAllPivots())) : attempt(() => session.refreshAllPivots())) },
    "separator",
    { label: "Convert to values", disabled: readOnly || !pivotHere, onSelect: () => attempt(() => session.deletePivot(sheet.id, pivotHere!.id, { keepCells: true })) },
    { label: "Delete pivot table", disabled: readOnly || !pivotHere, onSelect: () => attempt(() => session.deletePivot(sheet.id, pivotHere!.id)) },
  ];

  // ---- printing ----
  const savePageSetup = (patch: PageSetupPatch, titles: { rows: string | null; cols: string | null }): string | void => {
    try {
      session.setPageSetup(sheet.id, { ...patch, ...parsePrintTitles(titles) });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setPageDialog(false);
    sink.current?.focus({ preventScroll: true });
  };
  /** The page breaks to draw: the ones you made, and, with View > Page breaks, the ones that come where a page is full. */
  const pageBreaks = (() => {
    if (pagePreview) return undefined;
    const manualRows = sheet.page?.rowBreaks ?? [];
    const manualCols = sheet.page?.colBreaks ?? [];
    if (!showBreaks && !manualRows.length && !manualCols.length) return undefined;
    const rows = new Map<number, boolean>(manualRows.map((n) => [n, true]));
    const cols = new Map<number, boolean>(manualCols.map((n) => [n, true]));
    if (showBreaks) {
      const layout = session.printLayout(sheet.id);
      for (const p of layout.pages) {
        if (p.notes) continue;
        const area = layout.areas[p.area]!;
        if (p.range.r2 < area.r2 && !rows.has(p.range.r2)) rows.set(p.range.r2, false);
        if (p.range.c2 < area.c2 && !cols.has(p.range.c2)) cols.set(p.range.c2, false);
      }
    }
    return { rows: [...rows].map(([after, manual]) => ({ after, manual })), cols: [...cols].map(([after, manual]) => ({ after, manual })) };
  })();
  /** The page break preview: where the pages are, with the breaks (dashed where a page is full, solid where one was made) and the ranges that print. */
  const pageView = (() => {
    if (!pagePreview) return undefined;
    const layout = session.printLayout(sheet.id);
    const manualRows = new Set(sheet.page?.fit ? [] : sheet.page?.rowBreaks ?? []);
    const manualCols = new Set(sheet.page?.fit ? [] : sheet.page?.colBreaks ?? []);
    const rows: { after: number; manual: boolean; from: number; to: number }[] = [];
    const cols: { after: number; manual: boolean; from: number; to: number }[] = [];
    layout.areas.forEach((area, i) => {
      const own = layout.pages.filter((p) => p.area === i);
      for (const r of new Set(own.map((p) => p.range.r2))) if (r < area.r2) rows.push({ after: r, manual: manualRows.has(r), from: area.c1, to: area.c2 });
      for (const c of new Set(own.map((p) => p.range.c2))) if (c < area.c2) cols.push({ after: c, manual: manualCols.has(c), from: area.r1, to: area.r2 });
    });
    return {
      areas: layout.areas,
      explicit: !!sheet.page?.printArea?.length,
      pages: layout.pages.filter((p) => !p.notes).map((p) => ({ number: p.number, range: p.range, area: p.area })),
      rows,
      cols,
      onMoveBreak: (axis: "row" | "col", from: number, to: number) => attempt(() => session.movePageBreak(sheet.id, axis, from, to)),
      onMoveAreaEdge: (index: number, edge: "top" | "bottom" | "left" | "right", to: number) => attempt(() => session.movePrintAreaEdge(sheet.id, index, edge, to)),
    };
  })();
  const printItems = (): MenuEntry[] => [
    { label: "Set print area", disabled: readOnly, onSelect: () => attempt(() => session.setPrintArea(sheet.id, selectionRanges(selection).map((b) => rangeAddress(b)))) },
    { label: "Clear print area", disabled: readOnly || !sheet.page?.printArea, onSelect: () => attempt(() => session.setPrintArea(sheet.id, null)) },
  ];
  const breakItems = (): MenuEntry[] => [
    { label: "Page break above", disabled: readOnly || active.row < 2, onSelect: () => attempt(() => session.insertPageBreak(sheet.id, "row", active.row - 1)) },
    { label: "Page break to the left", disabled: readOnly || active.col < 2, onSelect: () => attempt(() => session.insertPageBreak(sheet.id, "col", active.col - 1)) },
    { label: "Remove page breaks here", disabled: readOnly || !(sheet.page?.rowBreaks?.includes(active.row - 1) || sheet.page?.colBreaks?.includes(active.col - 1)), onSelect: () => attempt(() => {
      const rows = (sheet.page?.rowBreaks ?? []).filter((n) => n !== active.row - 1);
      const cols = (sheet.page?.colBreaks ?? []).filter((n) => n !== active.col - 1);
      session.setPageSetup(sheet.id, { rowBreaks: rows.length ? rows : null, colBreaks: cols.length ? cols : null });
    }) },
    { label: "Remove all page breaks", disabled: readOnly || !(sheet.page?.rowBreaks?.length || sheet.page?.colBreaks?.length), onSelect: () => attempt(() => session.clearPageBreaks(sheet.id)) },
  ];

  /** The group entries of the Data menu. */
  const groupItems = (): MenuEntry[] => {
    const rowDepth = session.outlineDepth(sheet.id, "row");
    const colDepth = session.outlineDepth(sheet.id, "col");
    const levels = (axis: "row" | "col", depth: number): MenuEntry[] => Array.from({ length: depth + 1 }, (_, i) => ({ label: i === depth ? "All" : `Level ${i + 1}`, onSelect: () => attempt(() => session.showLevel(sheet.id, axis, i + 1)) }));
    return [
      { label: "Group rows", disabled: readOnly, onSelect: () => attempt(() => session.groupRows(sheet.id, bounds.r1, bounds.r2)) },
      { label: "Ungroup rows", disabled: readOnly || !rowDepth, onSelect: () => attempt(() => session.ungroupRows(sheet.id, bounds.r1, bounds.r2)) },
      { label: "Group columns", disabled: readOnly, onSelect: () => attempt(() => session.groupColumns(sheet.id, bounds.c1, bounds.c2)) },
      { label: "Ungroup columns", disabled: readOnly || !colDepth, onSelect: () => attempt(() => session.ungroupColumns(sheet.id, bounds.c1, bounds.c2)) },
      ...(rowDepth || colDepth
        ? [
            { label: "Show", items: [...(rowDepth ? [{ label: "Rows to level", items: levels("row", rowDepth) }] : []), ...(colDepth ? [{ label: "Columns to level", items: levels("col", colDepth) }] : [])] },
            { label: "Summary rows below detail", checked: !sheet.outline?.summaryAbove, disabled: readOnly, onSelect: () => attempt(() => session.setOutlineSummary(sheet.id, { above: !sheet.outline?.summaryAbove })) },
            { label: "Summary columns right of detail", checked: !sheet.outline?.summaryLeft, disabled: readOnly, onSelect: () => attempt(() => session.setOutlineSummary(sheet.id, { left: !sheet.outline?.summaryLeft })) },
          ]
        : []),
    ];
  };

  /** The protection entries of the Data menu. */
  const protectItems = (): MenuEntry[] => [
    sheet.protection
      ? { label: "Unprotect sheet…", disabled: readOnly, onSelect: () => (sheet.protection?.password ? setProtectDialog("unprotect-sheet") : attempt(() => session.unprotectSheet(sheet.id))) }
      : { label: "Protect sheet…", disabled: readOnly, onSelect: () => setProtectDialog("protect-sheet") },
    session.workbookProtected
      ? { label: "Unprotect workbook…", disabled: readOnly, onSelect: () => (session.state.protection?.password ? setProtectDialog("unprotect-workbook") : attempt(() => session.unprotectWorkbook())) }
      : { label: "Protect workbook structure…", disabled: readOnly, onSelect: () => setProtectDialog("protect-workbook") },
    "separator",
    { label: "Allow edit ranges…", disabled: readOnly, onSelect: () => setEditRangesDialog(true) },
  ];
  /** The Review menu: notes, and everything that protects the sheet and the workbook. */
  const reviewItems = (): MenuEntry[] => {
    const noteCount = session.notes(sheet.id).length;
    const opened = (sheet.editRanges ?? []).some((r) => !!r.password && session.editRangeOpen(sheet.id, r.name));
    return [
      ...(commentClient
        ? [
            ...commentItems(true),
            { label: "Comments panel", checked: commentsOpen, onSelect: () => setCommentsOpen((v) => !v) },
            "separator" as const,
          ]
        : []),
      { label: cell?.note !== undefined ? "Edit note…" : "New note…", shortcut: `${SHIFT}F2`, disabled: readOnly || !singleCell, onSelect: () => setNoteDialog(true) },
      { label: "Delete note", disabled: readOnly || !singleCell || cell?.note === undefined, onSelect: deleteNote },
      "separator",
      { label: "Show/hide note", disabled: readOnly || !singleCell || cell?.note === undefined, checked: cell?.noteBox?.show === true, onSelect: toggleNote },
      { label: "Show all notes", disabled: readOnly || !noteCount, onSelect: () => showAllNotes(true) },
      { label: "Hide all notes", disabled: readOnly || !noteCount, onSelect: () => showAllNotes(false) },
      { label: "Previous note", disabled: !noteCount, onSelect: () => stepNote(-1) },
      { label: "Next note", disabled: !noteCount, onSelect: () => stepNote(1) },
      "separator",
      { label: "Spelling…", shortcut: "F7", onSelect: () => setSpellDialog(true) },
      { label: "Check accessibility", checked: accessPanel, onSelect: () => setAccessPanel((on) => !on) },
      "separator",
      ...protectItems(),
      { label: "Lock edit ranges again", disabled: !opened, onSelect: () => attempt(() => session.lockEditRanges()) },
    ];
  };
  const submitProtection = (mode: ProtectMode, result: ProtectResult): string | void => {
    try {
      if (mode === "protect-sheet") session.protectSheet(sheet.id, { ...(result.password ? { password: result.password } : {}), ...(result.allow ? { allow: result.allow } : {}), ...(result.roles ? { roles: result.roles } : {}), ...(result.editLocked ? { editLocked: result.editLocked } : {}) });
      else if (mode === "unprotect-sheet") session.unprotectSheet(sheet.id, result.password);
      else if (mode === "protect-workbook") session.protectWorkbook({ ...(result.password ? { password: result.password } : {}), ...(result.structureRoles ? { roles: result.structureRoles } : {}) });
      else session.unprotectWorkbook(result.password);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setProtectDialog(null);
    sink.current?.focus({ preventScroll: true });
  };

  /** The comment items of the cell menu and the Insert and Review menus (nothing when comments are off). */
  const commentItems = (withConvert: boolean): MenuEntry[] => {
    if (!commentClient) return [];
    const can = !readOnly && commentClient.can("comment");
    return [
      { label: threadHere ? "Show comment" : "Comment", shortcut: `${MOD}${MAC ? "⌥" : "Alt+"}M`, disabled: !can || (!threadHere && cell?.note !== undefined && false), onSelect: startComment },
      ...(withConvert && threadHere ? [{ label: "Delete comment", disabled: readOnly || !commentClient.can("deleteThread", threadHere), onSelect: deleteComment }, { label: "Convert to note", disabled: readOnly || !singleCell, onSelect: () => attempt(() => session.comments.commentToNote(sheet.id, activeAddress)) }] : []),
      ...(withConvert && !threadHere && cell?.note !== undefined ? [{ label: "Convert note to comment", disabled: !can || !singleCell, onSelect: () => attempt(() => { const t = session.comments.noteToComment(sheet.id, activeAddress); setCommentsOpen(true); setActiveThread(t.id); }) }] : []),
    ];
  };
  const contextItems = (): MenuEntry[] => [
    ...(pagePreview
      ? [
          { label: "Insert page break", disabled: readOnly || (active.row < 2 && active.col < 2), onSelect: () => attempt(() => session.insertPageBreakAt(sheet.id, active)) },
          { label: "Remove page break", disabled: readOnly || !(sheet.page?.rowBreaks?.includes(active.row - 1) || sheet.page?.colBreaks?.includes(active.col - 1)), onSelect: () => attempt(() => { const rows = (sheet.page?.rowBreaks ?? []).filter((n) => n !== active.row - 1); const cols = (sheet.page?.colBreaks ?? []).filter((n) => n !== active.col - 1); session.setPageSetup(sheet.id, { rowBreaks: rows.length ? rows : null, colBreaks: cols.length ? cols : null }); }) },
          { label: "Reset all page breaks", disabled: readOnly || !(sheet.page?.rowBreaks?.length || sheet.page?.colBreaks?.length), onSelect: () => attempt(() => session.clearPageBreaks(sheet.id)) },
          { label: "Set print area", disabled: readOnly, onSelect: () => attempt(() => session.setPrintArea(sheet.id, selectionRanges(selection).map((b) => rangeAddress(b)))) },
          { label: "Clear print area", disabled: readOnly || !sheet.page?.printArea, onSelect: () => attempt(() => session.setPrintArea(sheet.id, null)) },
          "separator" as const,
        ]
      : []),
    { label: "Cut", shortcut: "Ctrl+X", disabled: readOnly, onSelect: clipboard("cut") },
    { label: "Copy", shortcut: "Ctrl+C", onSelect: clipboard("copy") },
    { label: "Paste", shortcut: "Ctrl+V", disabled: readOnly, onSelect: () => pasteClipboard() },
    { label: "Paste special", disabled: readOnly, items: pasteSpecialItems() },
    "separator",
    { label: "Insert row above", disabled: readOnly, onSelect: () => insertAt("row", "before") },
    { label: "Insert row below", disabled: readOnly, onSelect: () => insertAt("row", "after") },
    { label: "Insert column left", disabled: readOnly, onSelect: () => insertAt("col", "before") },
    { label: "Insert column right", disabled: readOnly, onSelect: () => insertAt("col", "after") },
    { label: colCount > 1 ? `Delete ${colCount} columns` : "Delete column", disabled: readOnly || wholeRowsSelected, onSelect: () => deleteHere("col") },
    { label: rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row", disabled: readOnly || wholeColsSelected, onSelect: () => deleteHere("row") },
    "separator",
    { label: "Clear contents", shortcut: "Delete", disabled: readOnly, onSelect: () => eachRange((a) => session.clear(sheet.id, a, "contents")) },
    { label: "Clear formatting", disabled: readOnly, onSelect: () => eachRange((a) => session.clear(sheet.id, a, "formats")) },
    "separator",
    { label: ownLink ? "Edit link…" : "Insert link…", shortcut: `${MOD}K`, disabled: readOnly, onSelect: () => setLinkDialog(true) },
    ...(ownLink ? [{ label: "Remove link", disabled: readOnly, onSelect: removeLink }] : []),
    ...commentItems(true),
    { label: cell?.note !== undefined ? "Edit note…" : "Insert note…", shortcut: `${SHIFT}F2`, disabled: readOnly || !singleCell, onSelect: () => setNoteDialog(true) },
    ...(cell?.note !== undefined
      ? [
          { label: cell.noteBox?.show ? "Hide note" : "Show note", disabled: readOnly || !singleCell, onSelect: toggleNote },
          { label: "Delete note", disabled: readOnly || !singleCell, onSelect: deleteNote },
        ]
      : []),
    ...(singleCell && cell?.f !== undefined && session.cellPicture(sheet.id, activeAddress)?.formula
      ? [
          "separator" as const,
          { label: "Keep picture in cell", disabled: readOnly, onSelect: () => void keepPicture(activeAddress) },
        ]
      : []),
    ...(cell?.picture && singleCell
      ? [
          "separator" as const,
          { label: "Place picture over cells", disabled: readOnly, onSelect: () => { try { setChartId(session.placeOverCells(sheet.id, activeAddress).id); } catch (error) { setNotice((error as Error).message); } } },
          { label: "Remove picture", disabled: readOnly, onSelect: () => { try { session.setCellPicture(sheet.id, activeAddress, null); } catch (error) { setNotice((error as Error).message); } } },
        ]
      : []),
    "separator",
    ...(cell?.control
      ? [
          ...(cell.control.type === "dropdown" ? [{ label: "Edit dropdown…", disabled: readOnly, onSelect: () => setDropdownDialog(true) }] : []),
          { label: `Remove ${cell.control.type}`, disabled: readOnly, onSelect: () => applyControl(null) },
        ]
      : []),
    { label: "Insert chart", disabled: readOnly, onSelect: () => insertChart() },
    sheet.filter ? { label: "Remove filter", disabled: readOnly, onSelect: () => attempt(() => session.setFilter(sheet.id, null)) } : { label: "Create filter", disabled: readOnly, onSelect: createFilter },
    ...(exceptionHere ? (["separator", ...exceptionItems(active.row, active.col)] as MenuEntry[]) : []),
  ];

  const createFilter = () => attempt(() => {
    const single = bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2;
    const range = parseRange(single ? session.currentRegion(sheet.id, activeAddress) : rangeAddress(work))!;
    // A filter needs a heading row and at least one row under it.
    session.setFilter(sheet.id, rangeAddress({ ...range, r2: Math.max(range.r2, range.r1 + 1) }));
  });

  // ---- filter views ----
  const activeView = sheet.filterViews?.find((v) => v.id === viewIds[sheet.id]) ?? null;
  /** The rows a view showing for this person hides and shows beyond the sheet's own filter. */
  const viewRows = useMemo(() => (activeView ? session.filterViewRows(sheet.id, activeView.id) : null), [session, sheet, revision, activeView?.id]);
  const showView = (id: string | null) => setViewIds((now) => {
    const next = { ...now };
    if (id) next[sheet.id] = id;
    else delete next[sheet.id];
    return next;
  });
  /** Whether there is a filter, or a table with a filter or sort, for a view to hold. */
  const canSaveView = useMemo(() => session.canSaveFilterView(sheet.id), [session, sheet, revision]);
  /** What each view holds, in a few words: its filter's range, how many columns it filters, and its tables. */
  const viewSummaries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of sheet.filterViews ?? []) {
      const parts: string[] = [];
      if (v.range) parts.push(`filter ${v.range}${v.columns ? ` (${Object.keys(v.columns).length} filtered)` : ""}${v.sort ? `, sorted by ${v.sort.column}` : ""}`);
      for (const [id, t] of Object.entries(v.tables ?? {})) {
        const table = sheet.tables?.find((x) => x.id === id);
        if (!table) continue;
        const n = Object.keys(t.filters ?? {}).length;
        parts.push(`${table.name}${n ? ` (${n} filtered)` : ""}${t.sort ? `, sorted by ${t.sort.column}` : ""}`);
      }
      out[v.id] = parts.join("; ") || "shows everything";
    }
    return out;
  }, [sheet, revision]);
  /** Runs a change to the views and returns why it was refused, for the dialog to say. */
  const viewChange = (fn: () => void): string | void => {
    try {
      fn();
    } catch (e) {
      if (e instanceof Error && (e.name === "ProtectionError" || e.name === "PliError")) return e.message;
      throw e;
    }
  };
  const filterViewItems = (): MenuEntry[] => [
    { label: "No view (the sheet's own filter)", checked: !activeView, onSelect: () => showView(null) },
    ...(sheet.filterViews ?? []).map((v): MenuEntry => ({ label: v.name, checked: v.id === activeView?.id, onSelect: () => showView(v.id) })),
    "separator",
    { label: "Save current filter as a view…", disabled: readOnly || !canSaveView, onSelect: () => setViewsDialog(true) },
    { label: "Manage views…", onSelect: () => setViewsDialog(true) },
  ];

  // ---- borders, merged cells and conditional formats ----
  const problem = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e));
  const borders = (where: BorderWhere) => {
    if (readOnly) return;
    try {
      eachRange((a) => session.setBorders(sheet.id, a, where, where === "none" ? null : borderLine));
    } catch (e) {
      problem(e);
    }
    sink.current?.focus({ preventScroll: true });
  };
  /** The colour picked for lines, which is also given to the lines already on the selected cells: one colour for the whole selection, whatever they had. */
  const pickBorderColor = (color: string | null) => {
    if (readOnly) return;
    setBorderLine({ style: borderLine.style, ...(color ? { color } : {}) });
    try {
      eachRange((a) => session.colorBorders(sheet.id, a, color));
    } catch (e) {
      problem(e);
    }
    sink.current?.focus({ preventScroll: true });
  };
  const borderItems = (): MenuEntry[] => [
    { label: "All borders", disabled: readOnly, onSelect: () => borders("all") },
    { label: "Outer borders", disabled: readOnly, onSelect: () => borders("outer") },
    { label: "Inner borders", disabled: readOnly, onSelect: () => borders("inner") },
    { label: "Horizontal borders", disabled: readOnly, onSelect: () => borders("horizontal") },
    { label: "Vertical borders", disabled: readOnly, onSelect: () => borders("vertical") },
    "separator",
    { label: "Top border", disabled: readOnly, onSelect: () => borders("top") },
    { label: "Bottom border", disabled: readOnly, onSelect: () => borders("bottom") },
    { label: "Left border", disabled: readOnly, onSelect: () => borders("left") },
    { label: "Right border", disabled: readOnly, onSelect: () => borders("right") },
    "separator",
    { label: "Diagonal down", disabled: readOnly, onSelect: () => borders("diagonalDown") },
    { label: "Diagonal up", disabled: readOnly, onSelect: () => borders("diagonalUp") },
    "separator",
    { label: "No borders", disabled: readOnly, onSelect: () => borders("none") },
    "separator",
    {
      label: "Line style",
      items: (["thin", "medium", "thick", "dashed", "dotted", "double"] as BorderStyle[]).map((st) => ({ label: st[0]!.toUpperCase() + st.slice(1), checked: borderLine.style === st, onSelect: () => setBorderLine({ ...borderLine, style: st }) })),
    },
    {
      label: "Line color",
      items: [
        { label: "Automatic", color: undefined },
        { label: "Gray", color: "#6b7280" },
        { label: "Red", color: "#e5484d" },
        { label: "Orange", color: "#f5851f" },
        { label: "Green", color: "#2f9e44" },
        { label: "Blue", color: "#1a56db" },
      ].map((c) => ({ label: c.label, checked: borderLine.color === c.color, onSelect: () => setBorderLine({ style: borderLine.style, ...(c.color ? { color: c.color } : {}) }) })),
    },
  ];

  /** The pivot table the selection is in, or the one the rule being edited follows: rules can follow its cells. */
  const rulePivot: PivotChoice | null = (() => {
    const edited = ruleDialog?.id ? sheet.conditional?.find((r) => r.id === ruleDialog.id) : undefined;
    const p = edited?.pivot ? sheet.pivots?.find((x) => x.id === edited.pivot!.id) : ruleDialog ? pivotHere : undefined;
    // What the selected cells of the pivot table would follow, when the selection is only its value cells.
    const selection = p && ruleDialog && !edited ? session.pivotSelectionScope(sheet.id, rangeAddress(bounds)) : null;
    return p ? { id: p.id, name: p.name, values: p.values.map((v) => v.name ?? `${v.fn === "count" ? "Count" : "Sum"} of ${v.field}`), rows: p.rows.map((f) => f.field), columns: p.columns.map((f) => f.field), ...(selection ? { selection: { ...(selection.value !== undefined ? { value: selection.value } : {}), ...(selection.rows ? { rows: selection.rows } : {}), ...(selection.columns ? { columns: selection.columns } : {}), ...(selection.items ? { items: selection.items } : {}) } } : {}) } : null;
  })();
  const lineLook = session.borderLook(sheet.id, rangeAddress(bounds));
  const mergeBounds = mergeAt(sheet, active.row, active.col);
  const mergedNow = !!mergeBounds && mergeBounds.r1 === bounds.r1 && mergeBounds.r2 === bounds.r2 && mergeBounds.c1 === bounds.c1 && mergeBounds.c2 === bounds.c2;
  const merge = (how: "all" | "across" | "unmerge" | "center") => {
    if (readOnly) return;
    try {
      if (how === "unmerge") eachRange((a) => session.unmergeCells(sheet.id, a));
      else {
        // Only the top-left value survives, as in Excel.
        const loses = workRanges.some((b) => {
          for (let r = b.r1; r <= b.r2; r++)
            for (let c = b.c1; c <= b.c2; c++) {
              const first = how === "across" ? c === b.c1 : r === b.r1 && c === b.c1;
              const x = sheet.cells[cellAddress(r, c)];
              if (!first && x && (x.v !== undefined || x.f !== undefined || x.e !== undefined)) return true;
            }
          return false;
        });
        eachRange((a) => session.mergeCells(sheet.id, a, { across: how === "across", ...(how === "center" ? { center: true } : {}) }));
        if (loses) setNotice("Merged cells keep only the top-left value. Undo brings the others back.");
      }
    } catch (e) {
      problem(e);
    }
    sink.current?.focus({ preventScroll: true });
  };
  const mergeItems = (): MenuEntry[] => [
    { label: "Merge and center", disabled: readOnly || (bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2), onSelect: () => merge("center") },
    { label: "Merge all", disabled: readOnly || (bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2), onSelect: () => merge("all") },
    { label: "Merge across", disabled: readOnly || bounds.c1 === bounds.c2, onSelect: () => merge("across") },
    { label: "Unmerge", disabled: readOnly || !workRanges.some((b) => (sheet.merges ?? []).some((m) => { const p = parseRange(m)!; return p.r1 <= b.r2 && p.r2 >= b.r1 && p.c1 <= b.c2 && p.c2 >= b.c1; })), onSelect: () => merge("unmerge") },
  ];

  /** The selected cells as ranges, for a new rule. */
  const selectedRanges = () => selectionRanges(selection).map((b) => rangeAddress(b));
  const addRule = (spec: RuleSpec): string | void => {
    try {
      session.addRule(sheet.id, spec, 0); // a new rule has the most say
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const quickRule = (spec: RuleSpec) => {
    if (readOnly) return;
    const refused = addRule(spec);
    if (refused) setNotice(refused);
    sink.current?.focus({ preventScroll: true });
  };
  const conditionalItems = (): MenuEntry[] => {
    const ask = (kind: ConditionalRule["kind"], op?: CellRuleOperator) => () => setRuleDialog({ id: null, kind, ...(op ? { op } : {}) });
    return [
      {
        label: "Highlight cells",
        disabled: readOnly,
        items: [
          { label: "Greater than…", onSelect: ask("cell") },
          { label: "Between…", onSelect: ask("cell", "between") },
          { label: "Text that contains…", onSelect: ask("text") },
          { label: "Duplicate values…", onSelect: ask("duplicates") },
          { label: "Dates…", onSelect: ask("dates") },
          { label: "Custom formula…", onSelect: ask("formula") },
        ],
      },
      {
        label: "Top and bottom",
        disabled: readOnly,
        items: [
          { label: "Top 10…", onSelect: ask("top") },
          { label: "Above average", onSelect: () => quickRule({ kind: "average", above: true, ranges: selectedRanges(), style: { fill: "#c6efce", color: "#006100" } }) },
          { label: "Below average", onSelect: () => quickRule({ kind: "average", above: false, ranges: selectedRanges(), style: { fill: "#ffc7ce", color: "#9c0006" } }) },
        ],
      },
      {
        label: "Data bars",
        disabled: readOnly,
        items: BAR_COLORS.map((b) => ({ label: b.label, onSelect: () => quickRule({ kind: "dataBar", ranges: selectedRanges(), min: { type: "min" }, max: { type: "max" }, color: b.color }) })),
      },
      {
        label: "Color scales",
        disabled: readOnly,
        items: COLOR_SCALES.map((c) => ({ label: c.label, onSelect: () => quickRule(colorScaleRule(c.colors.filter((x): x is string => !!x), selectedRanges())) })),
      },
      {
        label: "Icon sets",
        disabled: readOnly,
        items: (["3Arrows", "3TrafficLights1", "3Flags", "3Signs", "3Symbols", "4Arrows", "4Rating", "5Arrows", "5Rating", "5Quarters"] as const).map((set) => ({
          label: ICON_SET_LABELS[set],
          onSelect: () => quickRule({ kind: "iconSet", set, ranges: selectedRanges(), thresholds: evenSteps(Number(set[0])) as never }),
        })),
      },
      "separator",
      { label: "New rule…", disabled: readOnly, onSelect: ask("cell") },
      { label: "Manage rules…", onSelect: () => setRulesManager(true) },
      "separator",
      { label: "Clear rules from selected cells", disabled: readOnly || !sheet.conditional?.length, onSelect: () => eachRange((a) => session.clearRules(sheet.id, a)) },
      { label: "Clear rules from the sheet", disabled: readOnly || !sheet.conditional?.length, onSelect: () => session.batch(() => (sheet.conditional ?? []).forEach((r) => session.deleteRule(sheet.id, r.id))) },
    ];
  };

  // ---- tables ----
  const tableHere = sheet.tables?.length ? tableAt(sheet, active.row, active.col)?.table : undefined;
  const saveTable = (r: { range: string; name: string; headers: boolean; style: string }): string | void => {
    try {
      if (tableDialog === "rename") {
        if (tableHere) session.renameTable(tableHere.name, r.name);
      } else {
        const b = parseRange(r.range);
        if (!b) return `"${r.range}" isn't a range such as A1:D20.`;
        session.createTable(sheet.id, rangeAddress(b), { ...(r.name ? { name: r.name } : {}), ...(r.style !== "TableStyleMedium2" ? { style: r.style } : {}), ...(r.headers ? {} : { header: false }) });
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setTableDialog(null);
    sink.current?.focus({ preventScroll: true });
  };
  const tableItems = (): MenuEntry[] => {
    const t = tableHere;
    const flag = (key: "bandedColumns" | "firstColumn" | "lastColumn") => ({ checked: !!t?.[key], disabled: readOnly || !t, onSelect: () => t && session.setTableOptions(t.name, { [key]: !t[key] }) });
    const attempt = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    };
    const mine = Object.keys(session.state.tableStyles ?? {});
    const currentStyle = t?.style ?? "TableStyleMedium2";
    const isMine = mine.some((n) => n.toLowerCase() === currentStyle.toLowerCase());
    const own = isMine ? mine.find((n) => n.toLowerCase() === currentStyle.toLowerCase())! : null;
    return [
      { label: "Create table…", disabled: readOnly, onSelect: () => setTableDialog("new") },
      "separator",
      { label: "Rename table…", disabled: readOnly || !t, onSelect: () => setTableDialog("rename") },
      {
        label: "Table style",
        disabled: readOnly || !t,
        items: [
          ...TABLE_STYLES.map((x) => ({ label: x.label, checked: currentStyle === x.value, onSelect: () => t && session.setTableOptions(t.name, { style: x.value === "TableStyleMedium2" ? null : x.value }) })),
          ...(mine.length ? ["separator" as const, ...mine.map((name) => ({ label: name, checked: own === name, onSelect: () => t && session.setTableOptions(t.name, { style: name }) }))] : []),
          "separator" as const,
          { label: "New table style…", onSelect: () => setStyleDialog({ name: "", def: {}, isNew: true }) },
          { label: "Duplicate this style…", onSelect: () => t && setStyleDialog({ name: own ? `${own} copy` : "My style", def: structuredClone(session.tableStyleParts(currentStyle) ?? {}), isNew: true }) },
          { label: "Edit this style…", disabled: !own, onSelect: () => own && setStyleDialog({ name: own, def: structuredClone(session.tableStyles()[own]!), isNew: false, was: own }) },
          { label: "Delete this style", disabled: !own, onSelect: () => own && attempt(() => session.setTableStyle(own, null)) },
        ],
      },
      { label: "Header row", checked: !!t && hasHeader(t), disabled: readOnly || !t, onSelect: () => t && attempt(() => session.setTableHeader(t.name, !hasHeader(t))) },
      { label: "Banded rows", checked: !!t && t.bandedRows !== false, disabled: readOnly || !t, onSelect: () => t && session.setTableOptions(t.name, { bandedRows: t.bandedRows === false }) },
      { label: "Banded columns", ...flag("bandedColumns") },
      { label: "First column", ...flag("firstColumn") },
      { label: "Last column", ...flag("lastColumn") },
      { label: "Total row", checked: !!t?.totals, disabled: readOnly || !t, onSelect: () => t && session.setTableTotals(t.name, !t.totals) },
      {
        // Excel's drop-down in the totals row: what the column of the active cell works out (the 100s leave out hidden and filtered rows).
        label: "Total row function",
        disabled: readOnly || !t?.totals,
        items: (() => {
          const names = t?.totals ? session.tableColumnNames(t.name) : [];
          const column = (t?.totals && names[bounds.c1 - parseRange(t.range)!.c1]) || "";
          const now = t?.totals && column ? session.tableTotals(t.name)[column] : null;
          const choice = (label: string, fn: SubtotalFunction | "none") => ({ label, checked: fn === "none" ? now === null : now === fn, onSelect: () => t && attempt(() => session.setTableTotalsFunction(t.name, column, fn)) });
          return [choice("None", "none"), choice("Sum", "sum"), choice("Average", "average"), choice("Count", "count"), choice("Count Numbers", "countNums"), choice("Max", "max"), choice("Min", "min"), choice("StdDev", "stdDev"), choice("Var", "var")];
        })(),
      },
      "separator",
      { label: "Filter buttons", checked: !!t && hasHeader(t) && t.filterButtons !== false, disabled: readOnly || !t || !hasHeader(t), onSelect: () => t && attempt(() => session.setTableFilterButtons(t.name, t.filterButtons === false)) },
      { label: "Clear filters", disabled: readOnly || !t?.filters, onSelect: () => t && attempt(() => session.clearTableFilters(t.name)) },
      { label: "Remove duplicates…", disabled: readOnly || !t, onSelect: () => t && setDupDialog({ table: t.id }) },
      { label: "Insert slicer…", disabled: readOnly || !t || !hasHeader(t), onSelect: () => setSlicerDialog({ mode: "insert" }) },
      { label: "Insert timeline…", disabled: readOnly || !t || !hasHeader(t), onSelect: () => setTimelineDialog({ mode: "insert" }) },
      "separator",
      { label: "Convert to range", disabled: readOnly || !t, onSelect: () => t && session.convertToRange(t.name) },
      { label: "Delete table", disabled: readOnly || !t, onSelect: () => { if (t && (typeof window === "undefined" || window.confirm(`Delete the table ${t.name} and what is in it?`))) session.deleteTable(t.name); } },
    ];
  };

  // ---- table styles of your own ----
  const styleChoices = [
    ...TABLE_STYLES.filter((x) => x.value !== "none").map((x) => ({ value: x.value, label: x.label, def: session.tableStyleParts(x.value) ?? {} })),
    ...Object.entries(session.state.tableStyles ?? {}).map(([name, def]) => ({ value: name, label: name, def })),
  ];
  const saveStyle = (name: string, def: TableStyleDef): string | void => {
    try {
      session.batch(() => {
        session.setTableStyle(name, def);
        if (styleDialog?.isNew && tableHere) session.setTableOptions(tableHere.name, { style: name });
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setStyleDialog(null);
    sink.current?.focus({ preventScroll: true });
  };

  // ---- slicers ----
  const slicerTables = session.state.sheets.flatMap((sh) => (sh.tables ?? []).filter(hasHeader).map((t) => ({ id: t.id, name: t.name, columns: session.tableColumnNames(t) })));
  const saveSlicers = (result: SlicerDialogResult): string | void => {
    try {
      if ("table" in result) {
        const entry = session.state.sheets.flatMap((sh) => (sh.tables ?? []).map((t) => ({ sh, t }))).find((e) => e.t.id === result.table)!;
        const b = parseRange(entry.t.range)!;
        const here = entry.sh.id === sheet.id;
        session.batch(() => {
          result.columns.forEach((column, i) => session.addSlicer(sheet.id, { table: result.table, column, from: { row: here ? b.r1 : 1, col: here ? b.c2 + 2 : 1, dx: i * 192 } }));
        });
      } else if (slicerDialog?.mode === "settings") {
        const x = sheet.slicers?.find((y) => y.id === slicerDialog.id) ?? session.pivotPanelsAsSlicers(sheet.id).find((y) => y.id === slicerDialog.id);
        if (x) {
          const { caption: _c, style: _s, columns: _n, ...rest } = x;
          session.updateSlicer(sheet.id, { ...rest, ...(result.caption ? { caption: result.caption } : {}), ...(result.style !== "SlicerStyleLight1" ? { style: result.style } : {}), ...(result.columns > 1 ? { columns: result.columns } : {}) });
        }
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setSlicerDialog(null);
    sink.current?.focus({ preventScroll: true });
  };
  const slicerItems = (id: string): MenuEntry[] => {
    const x = sheet.slicers?.find((y) => y.id === id) ?? session.pivotPanelsAsSlicers(sheet.id).find((y) => y.id === id);
    return [
      { label: "Slicer settings…", disabled: readOnly || !x || !!x.timeline, onSelect: () => setSlicerDialog({ mode: "settings", id }) },
      { label: "Clear filter", disabled: readOnly || !x, onSelect: () => session.slicerSelect(id, null) },
      "separator",
      { label: "Delete slicer", disabled: readOnly, onSelect: () => session.deleteSlicer(sheet.id, id) },
    ];
  };

  // ---- timelines ----
  const timelineTables = session.state.sheets.flatMap((sh) =>
    (sh.tables ?? []).filter(hasHeader).map((t) => ({ id: t.id, name: t.name, dateColumns: session.tableColumnNames(t).filter((c) => session.tableFilterDateTree(t.id, c) !== null) })).filter((t) => t.dateColumns.length),
  );
  const saveTimeline = (result: TimelineDialogResult): string | void => {
    try {
      if ("table" in result) {
        const entry = session.state.sheets.flatMap((sh) => (sh.tables ?? []).map((t) => ({ sh, t }))).find((e) => e.t.id === result.table)!;
        const b = parseRange(entry.t.range)!;
        const here = entry.sh.id === sheet.id;
        session.addTimeline(sheet.id, { table: result.table, column: result.column, level: result.level, from: { row: here ? b.r1 : 1, col: here ? b.c2 + 2 : 1 } });
      } else if (timelineDialog?.mode === "settings") {
        const x = sheet.timelines?.find((y) => y.id === timelineDialog.id);
        if (x) {
          const { caption: _c, style: _s, ...rest } = x;
          session.updateTimeline(sheet.id, { ...rest, level: result.level, ...(result.caption ? { caption: result.caption } : {}), ...(result.style !== "TimeSlicerStyleLight1" ? { style: result.style } : {}) });
        }
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setTimelineDialog(null);
    sink.current?.focus({ preventScroll: true });
  };
  const timelineItems = (id: string): MenuEntry[] => {
    const x = sheet.timelines?.find((y) => y.id === id);
    const levelItem = (level: TimelineLevel, label: string): MenuEntry => ({ label, checked: x?.level === level, disabled: readOnly || !x, onSelect: () => x && session.updateTimeline(sheet.id, { ...x, level }) });
    return [
      { label: "Timeline settings…", disabled: readOnly || !x, onSelect: () => setTimelineDialog({ mode: "settings", id }) },
      { label: "Periods", items: [levelItem("years", "Years"), levelItem("quarters", "Quarters"), levelItem("months", "Months"), levelItem("days", "Days")] },
      { label: "Clear range", disabled: readOnly || !x, onSelect: () => session.timelineSelect(id, null) },
      "separator",
      { label: "Delete timeline", disabled: readOnly, onSelect: () => session.deleteTimeline(sheet.id, id) },
    ];
  };

  // ---- cells of a calculated column that hold something else ----
  const exceptionItems = (row: number, col: number): MenuEntry[] => {
    const address = `${colName(col)}${row}`;
    const t = tableAt(sheet, row, col)?.table;
    const b = t ? parseRange(t.range) : null;
    const hasFormula = sheet.cells[address]?.f !== undefined;
    const attempt = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    };
    return [
      { label: "This cell doesn't follow its column's formula", disabled: true, onSelect: () => {} },
      { label: "Restore the column's formula here", disabled: readOnly, onSelect: () => attempt(() => void session.restoreCalculated(sheet.id, address)) },
      { label: "Restore it in every cell of the column", disabled: readOnly || !t, onSelect: () => t && b && attempt(() => void session.restoreCalculated(sheet.id, rangeAddress({ r1: hasHeader(t) ? b.r1 + 1 : b.r1, r2: t.totals ? b.r2 - 1 : b.r2, c1: col, c2: col }))) },
      { label: "Use this formula for the whole column", disabled: readOnly || !hasFormula, onSelect: () => attempt(() => session.useAsCalculated(sheet.id, address)) },
    ];
  };
  const exceptionHere = !readOnly && sheet.tables?.some((t) => t.calculated) ? session.calculatedException(sheet.id, activeAddress) : null;

  // ---- data validation ----
  const invalid = useMemo(() => (circles ? session.invalidCells(sheet.id).map((a) => parseCell(a)!) : []), [circles, session, sheet, revision]);
  const hasExternalLists = session.state.sheets.some((x) => x.validations?.some((r) => r.kind === "list" && parseExternalRef(r.source)));
  // Formulas, names and rules that read cells of other workbooks.
  const externalRefs = useMemo(() => session.externalReferences(), [session, revision, externalTick]);
  const hasExternalLinks = hasExternalLists || externalRefs.length > 0;
  const validationHere = sheet.validations?.length ? session.validationAt(sheet.id, activeAddress) : undefined;
  const promptHere = validationHere && (validationHere.prompt || validationHere.promptTitle) ? { ...(validationHere.promptTitle ? { title: validationHere.promptTitle } : {}), text: validationHere.prompt ?? "" } : null;
  const saveValidation = (result: ValidationResult): string | void => {
    try {
      session.batch(() => {
        for (const r of "rule" in result ? result.rule.ranges : result.ranges) session.clearValidation(sheet.id, r);
        if ("rule" in result) session.addValidation(sheet.id, result.rule);
        else if ("choices" in result) {
          for (const r of result.ranges) session.setControl(sheet.id, r, { type: "dropdown", options: result.choices.map((value) => ({ value })), ...(result.multiple ? { multiple: true, ...(result.separator ? { separator: result.separator } : {}) } : {}), ...(result.strict ? { strict: true } : {}) });
        } else if (cell?.control?.type === "dropdown") for (const r of result.ranges) session.setControl(sheet.id, r, null);
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setValidationDialog(false);
    sink.current?.focus({ preventScroll: true });
  };

  const s = cell?.s ?? {};
  // ---- files ----
  const onDownload = useDownloadHandler(onDownloadProp);
  const deliver = (name: string, data: BlobPart, type: string) => {
    void handOver(onDownload, name, data, type).catch((e) => setNotice(saveFailure(e)));
  };
  const exportAs = (kind: "xlsx" | "csv" | "tsv" | "json") => {
    if (edit) commit(null);
    const name = safeName(session.state.title);
    if (kind === "xlsx") deliver(`${name}.xlsx`, toXlsx(session.state) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    else if (kind === "csv") deliver(`${name}.csv`, toCsv(session.calculator, sheet.id), "text/csv");
    else if (kind === "tsv") deliver(`${name}.tsv`, toCsv(session.calculator, sheet.id, { delimiter: "\t" }), "text/tab-separated-values");
    else deliver(`${name}.pli-sheet.json`, serializeWorkbook(session.state, 2), "application/json");
  };
  const importFile = async (file: File) => {
    const hasData = session.state.sheets.some((s) => Object.keys(s.cells).length > 0);
    if (hasData && typeof window !== "undefined" && !window.confirm(`Replace this spreadsheet with ${file.name}?`)) return;
    try {
      const title = file.name.replace(/\.[^.]+$/, "");
      if (/\.xlsx$/i.test(file.name)) {
        const { workbook, warnings } = fromXlsx(new Uint8Array(await readFile<ArrayBuffer>(file, "buffer")));
        session.load({ ...workbook, title });
        setNotice(warnings.length ? `${file.name} was opened, but: ${warnings.join("; ")}.` : null);
      } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        session.load({ ...fromCsv(await readFile<string>(file, "text")), title });
        setNotice(null);
      } else {
        session.load(parseWorkbook(await readFile<string>(file, "text")));
        setNotice(null);
      }
      setSheetId(session.state.sheets[0]!.id);
      setSelections({});
      setEdit(null);
      setCopied(null);
    } catch (e) {
      setNotice(`${file.name} couldn't be opened: ${(e as Error).message}`);
    }
  };

  const applyControl = (control: Parameters<typeof session.setControl>[2]) => {
    eachRange((a) => session.setControl(sheet.id, a, control));
    sink.current?.focus({ preventScroll: true });
  };
  /** Opens the picker of the active cell, under it. */
  const openPickerAtActive = () =>
    requestAnimationFrame(() => {
      const box = sink.current?.getBoundingClientRect();
      if (box) setChoiceMenu({ row: active.row, col: active.col, x: box.left, y: box.bottom });
    });
  /** Puts a chart of the selected cells (or the block around the active cell) beside them and selects it. */
  const insertChart = (type?: ChartType, seriesIn?: "rows") => {
    try {
      const chart = session.insertChart(sheet.id, rangeAddress(work), { ...(type ? { type } : {}), ...(seriesIn ? { seriesIn } : {}) });
      setChartId(chart.id);
    } catch (error) {
      setNotice((error as Error).message);
    }
    sink.current?.focus({ preventScroll: true });
  };
  /** Adds the picture files at a cell, a little way apart, and selects the last. A file that can't be kept is said so. */
  const insertImages = async (files: File[], at: { row: number; col: number }) => {
    const target = sheet.id;
    let last: string | null = null;
    try {
      for (const [i, file] of files.entries()) {
        const { src, alt } = await imageFromFile(file);
        last = session.addImage(target, { src, from: { row: at.row, col: at.col, ...(i ? { dx: 24 * i, dy: 24 * i } : {}) }, ...(alt ? { alt } : {}) }).id;
      }
    } catch (error) {
      setNotice((error as Error).message);
    }
    if (last) setChartId(last);
    sink.current?.focus({ preventScroll: true });
  };
  /** Puts a picture file in the active cell as its content. A file that can't be kept is said so. */
  const insertImageInCell = async (file: File) => {
    const target = sheet.id;
    const address = activeAddress;
    try {
      const { src, alt } = await imageFromFile(file);
      session.setCellPicture(target, address, { src, ...(alt ? { alt } : {}) });
    } catch (error) {
      setNotice((error as Error).message);
    }
    sink.current?.focus({ preventScroll: true });
  };
  /** Fetches the picture an `IMAGE` formula shows and keeps it in the cell in the formula's place, so that it no longer depends on the web. The site has to allow it. */
  const keepPicture = async (address: string) => {
    const target = sheet.id;
    const pic = session.cellPicture(target, address);
    if (!pic) return;
    try {
      const response = await fetch(pic.src);
      if (!response.ok) throw new Error(`the site answered ${response.status}`);
      const blob = await response.blob();
      const { src, alt } = await imageFromFile(new File([blob], pic.alt ?? "picture", { type: blob.type }));
      session.setCellPicture(target, address, { src, alt: pic.alt ?? alt });
    } catch (error) {
      setNotice(`That picture couldn't be fetched to keep (${(error as Error).message}). The site may not allow it.`);
    }
  };
  /** Puts a picture in crop mode (or takes it out), picking it too. */
  const toggleCrop = (id: string) => {
    if (cropId === id) return setCropId(null);
    setChartId(id);
    setCropId(id);
    requestAnimationFrame(() => sink.current?.focus({ preventScroll: true }));
  };
  const cropShapeItems = (id: string): MenuEntry[] => {
    const shape = (label: string, ratio: number | string): MenuEntry => ({
      label,
      disabled: readOnly,
      onSelect: () => {
        try {
          session.cropImageToRatio(sheet.id, id, ratio);
        } catch (error) {
          setNotice((error as Error).message);
        }
      },
    });
    return [
      shape("Square (1:1)", "1:1"),
      shape("Landscape 4:3", "4:3"),
      shape("Landscape 3:2", "3:2"),
      shape("Widescreen 16:9", "16:9"),
      shape("Portrait 3:4", "3:4"),
      shape("Portrait 2:3", "2:3"),
      shape("Portrait 9:16", "9:16"),
      "separator",
      shape("Fill the frame", "fill"),
      shape("Fit in the frame", "fit"),
      "separator",
      ...shapeItems(id),
    ];
  };
  /** The shapes a picture can be cropped to (Crop to shape), by group, with a tick on the picture's own. */
  const shapeItems = (id: string): MenuEntry[] => {
    const now = sheet.images?.find((x) => x.id === id)?.shape;
    const to = (name: ImageShape | null, label: string): MenuEntry => ({
      label,
      checked: (now ?? null) === name,
      disabled: readOnly,
      onSelect: () => {
        try {
          session.cropImageToShape(sheet.id, id, name);
        } catch (error) {
          setNotice((error as Error).message);
        }
      },
    });
    return [to(null, "Rectangle"), ...SHAPE_GROUPS.map((group): MenuEntry => ({ label: group, items: IMAGE_SHAPE_NAMES.filter((k) => IMAGE_SHAPES[k].group === group).map((k) => to(k, IMAGE_SHAPES[k].label)) }))];
  };
  const imageItems = (id: string): MenuEntry[] => {
    const images = sheet.images ?? [];
    const image = images.find((x) => x.id === id);
    const at = images.findIndex((x) => x.id === id);
    const natural = (() => {
      try {
        return image ? readImage(image.src) : null;
      } catch {
        return null;
      }
    })();
    const attempt = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        setNotice((error as Error).message);
      }
    };
    const turn = (degrees: number) => () => attempt(() => session.rotateImage(sheet.id, id, degrees));
    const placement = image?.placement ?? "move";
    const place = (label: string, value: "size" | "move" | "free"): MenuEntry => ({ label, checked: placement === value, disabled: readOnly || !image, onSelect: () => attempt(() => session.formatImage(sheet.id, id, { placement: value })) });
    return [
      { label: "Format picture…", disabled: readOnly || !image, onSelect: () => setImageDialog(id) },
      { label: "Crop", checked: cropId === id, disabled: readOnly || !image, onSelect: () => toggleCrop(id) },
      { label: "Crop to shape", disabled: readOnly || !image, items: cropShapeItems(id) },
      { label: "Copy", shortcut: "Ctrl+C", onSelect: clipboard("copy") },
      { label: "Cut", shortcut: "Ctrl+X", disabled: readOnly, onSelect: clipboard("cut") },
      "separator",
      { label: "Rotate right 90°", disabled: readOnly || !image, onSelect: turn(90) },
      { label: "Rotate left 90°", disabled: readOnly || !image, onSelect: turn(-90) },
      { label: "Flip horizontally", disabled: readOnly || !image, checked: !!image?.flipH, onSelect: () => attempt(() => session.flipImage(sheet.id, id, "h")) },
      { label: "Flip vertically", disabled: readOnly || !image, checked: !!image?.flipV, onSelect: () => attempt(() => session.flipImage(sheet.id, id, "v")) },
      { label: "Remove crop", disabled: readOnly || !image?.crop, onSelect: () => attempt(() => session.cropImage(sheet.id, id, null)) },
      { label: "Move and size", items: [place("Move and size with cells", "size"), place("Move but don't size with cells", "move"), place("Don't move or size with cells", "free")] },
      "separator",
      { label: "Fit to the selected cells", disabled: readOnly || !image, onSelect: () => attempt(() => session.fitImage(sheet.id, id, rangeAddress(work))) },
      { label: "Original size", disabled: readOnly || !natural, onSelect: () => natural && image && attempt(() => session.updateImage(sheet.id, id, { width: Math.min(4000, Math.max(4, Math.round(natural.width * (1 - (image.crop?.left ?? 0) - (image.crop?.right ?? 0))))), height: Math.min(4000, Math.max(4, Math.round(natural.height * (1 - (image.crop?.top ?? 0) - (image.crop?.bottom ?? 0))))) })) },
      { label: "Duplicate", disabled: readOnly || !image, onSelect: () => attempt(() => setChartId(session.copyImage(sheet.id, id).id)) },
      { label: "Place in cell", disabled: readOnly || !image, onSelect: () => attempt(() => { session.placeInCell(sheet.id, id); setChartId(null); }) },
      "separator",
      { label: "Bring to front", disabled: readOnly || at === images.length - 1, onSelect: () => session.reorderImage(sheet.id, id, "front") },
      { label: "Send to back", disabled: readOnly || at <= 0, onSelect: () => session.reorderImage(sheet.id, id, "back") },
      "separator",
      { label: "Delete picture", shortcut: "Delete", disabled: readOnly, onSelect: () => { session.deleteImage(sheet.id, id); setChartId(null); } },
    ];
  };
  const chartItems = (id: string): MenuEntry[] => {
    if (sheet.images?.some((x) => x.id === id)) return imageItems(id);
    const chart = sheet.charts?.find((c) => c.id === id);
    const last = (sheet.charts?.length ?? 0) - 1;
    const at = sheet.charts?.findIndex((c) => c.id === id) ?? -1;
    return [
      { label: "Edit chart…", disabled: readOnly || !chart, onSelect: () => setChartDialog(id) },
      { label: "Switch rows and columns", disabled: readOnly || !chart || !session.chartSeriesIn(sheet.id, id), onSelect: () => { try { session.switchChartRowsColumns(sheet.id, id); } catch (error) { setNotice((error as Error).message); } } },
      { label: "Duplicate", disabled: readOnly || !chart, onSelect: () => chart && setChartId(session.addChart(sheet.id, { ...chart, id: undefined, from: { ...chart.from, dx: (chart.from.dx ?? 0) + 24, dy: (chart.from.dy ?? 0) + 24 } }).id) },
      "separator",
      { label: "Bring to front", disabled: readOnly || at === last, onSelect: () => session.reorderChart(sheet.id, id, "front") },
      { label: "Send to back", disabled: readOnly || at <= 0, onSelect: () => session.reorderChart(sheet.id, id, "back") },
      "separator",
      { label: "Delete chart", shortcut: "Delete", disabled: readOnly, onSelect: () => { session.deleteChart(sheet.id, id); setChartId(null); } },
    ];
  };
  const insertFunction = (name: string) => gridActions.current?.edit(`=${name}()`, 1);
  const align = (a: "left" | "center" | "right") => style({ align: cell?.s?.align === a ? null : a });
  const valign = (a: "top" | "middle" | "bottom") => style({ vAlign: cell?.s?.vAlign === a ? null : a });
  const menus: MenuDefinition[] = [
    {
      label: "File",
      items: [
        {
          label: "Download",
          items: [
            { label: "Excel workbook (.xlsx)", onSelect: () => exportAs("xlsx") },
            { label: "This sheet as CSV (.csv)", onSelect: () => exportAs("csv") },
            { label: "This sheet as tab-separated (.tsv)", onSelect: () => exportAs("tsv") },
            { label: "Pli spreadsheet (.json)", onSelect: () => exportAs("json") },
          ],
        },
        { label: "Import…", disabled: readOnly, onSelect: () => choose(importInput, { purpose: "import", accept: ".xlsx,.csv,.tsv,.txt,.json", label: "Import a spreadsheet" }, ([file]) => void importFile(file!)) },
        "separator",
        { label: "Page setup…", onSelect: () => setPageDialog(true) },
        { label: "Print…", shortcut: `${MOD}P`, onSelect: () => setPreview(true) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: `${MOD}Z`, disabled: readOnly || !session.canUndo, onSelect: () => { session.undo(); sink.current?.focus(); } },
        { label: "Redo", shortcut: `${SHIFT}${MOD}Z`, disabled: readOnly || !session.canRedo, onSelect: () => { session.redo(); sink.current?.focus(); } },
        "separator",
        { label: "Cut", shortcut: `${MOD}X`, disabled: readOnly, onSelect: clipboard("cut") },
        { label: "Copy", shortcut: `${MOD}C`, onSelect: clipboard("copy") },
        { label: "Paste", shortcut: `${MOD}V`, disabled: readOnly, onSelect: () => pasteClipboard() },
            { label: "Paste special", disabled: readOnly, items: pasteSpecialItems() },
        "separator",
        { label: "Select all", shortcut: `${MOD}A`, onSelect: () => { setSelection({ anchor: { row: 1, col: 1 }, focus: { row: MAX_ROWS, col: MAX_COLS } }); sink.current?.focus(); } },
        "separator",
        { label: "Find…", shortcut: `${MOD}F`, onSelect: () => find.show(false) },
        { label: "Find and replace…", shortcut: `${MAC ? "\u2303" : "Ctrl+"}H`, disabled: readOnly, onSelect: () => find.show(true) },
        "separator",
        { label: "Clear contents", shortcut: "Delete", disabled: readOnly, onSelect: () => eachRange((a) => session.clear(sheet.id, a, "contents")) },
        { label: "Clear formatting", disabled: readOnly, onSelect: () => eachRange((a) => session.clear(sheet.id, a, "formats")) },
        { label: "Clear sparklines", disabled: readOnly || !sheet.sparklines?.length, onSelect: () => eachRange((a) => session.clearSparklines(sheet.id, a)) },
        "separator",
        { label: rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row", disabled: readOnly || wholeColsSelected, onSelect: () => deleteHere("row") },
        { label: colCount > 1 ? `Delete ${colCount} columns` : "Delete column", disabled: readOnly || wholeRowsSelected, onSelect: () => deleteHere("col") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Pictures from the web", checked: remoteImages, onSelect: () => setRemoteImages(!remoteImages) },
        ...(history ? [{ label: "Version history", checked: historyOpen, onSelect: () => showHistory(!historyOpen) }] : []),
        "separator",
        {
          label: "Freeze",
          items: [
            { label: "No rows", checked: !sheet.frozen?.rows, onSelect: () => freeze(0, sheet.frozen?.cols ?? 0) },
            { label: "1 row", checked: sheet.frozen?.rows === 1, onSelect: () => freeze(1, sheet.frozen?.cols ?? 0) },
            { label: "2 rows", checked: sheet.frozen?.rows === 2, onSelect: () => freeze(2, sheet.frozen?.cols ?? 0) },
            { label: `Up to row ${active.row}`, onSelect: () => freeze(active.row, sheet.frozen?.cols ?? 0) },
            "separator",
            { label: "No columns", checked: !sheet.frozen?.cols, onSelect: () => freeze(sheet.frozen?.rows ?? 0, 0) },
            { label: "1 column", checked: sheet.frozen?.cols === 1, onSelect: () => freeze(sheet.frozen?.rows ?? 0, 1) },
            { label: "2 columns", checked: sheet.frozen?.cols === 2, onSelect: () => freeze(sheet.frozen?.rows ?? 0, 2) },
            { label: `Up to column ${colName(active.col)}`, onSelect: () => freeze(sheet.frozen?.rows ?? 0, active.col) },
          ],
        },
        "separator",
        { label: "Page breaks", checked: showBreaks, onSelect: () => setShowBreaks((v) => !v) },
        { label: "Page break preview", checked: pagePreview, onSelect: () => setPagePreview((v) => !v) },
        "separator",
        { label: "Toolbar", checked: showToolbar, onSelect: () => setShowToolbar((v) => !v) },
        { label: "Formula bar", checked: showFormulaBar, onSelect: () => setShowFormulaBar((v) => !v) },
        { label: "Status bar", checked: showStatus, onSelect: () => setShowStatus((v) => !v) },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Row above", disabled: readOnly, onSelect: () => insertAt("row", "before") },
        { label: "Row below", disabled: readOnly, onSelect: () => insertAt("row", "after") },
        { label: "Column left", disabled: readOnly, onSelect: () => insertAt("col", "before") },
        { label: "Column right", disabled: readOnly, onSelect: () => insertAt("col", "after") },
        "separator",
        {
          label: "Function",
          disabled: readOnly,
          items: ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "VLOOKUP", "XLOOKUP", "SUMIF", "CONCAT"].map((f) => ({ label: f, onSelect: () => insertFunction(f) })),
        },
        "separator",
        {
          label: "Chart",
          disabled: readOnly,
          items: [
            { label: "Column", onSelect: () => insertChart("column") },
            { label: "Bar", onSelect: () => insertChart("bar") },
            { label: "Line", onSelect: () => insertChart("line") },
            { label: "Area", onSelect: () => insertChart("area") },
            { label: "Pie", onSelect: () => insertChart("pie") },
            { label: "Scatter", onSelect: () => insertChart("scatter") },
            { label: "Doughnut", onSelect: () => insertChart("doughnut") },
            { label: "Pie of pie", onSelect: () => insertChart("pieOfPie") },
            { label: "Bar of pie", onSelect: () => insertChart("barOfPie") },
            { label: "Radar", onSelect: () => insertChart("radar") },
            { label: "Bubble", onSelect: () => insertChart("bubble") },
            { label: "Stock", onSelect: () => insertChart("stock") },
            { label: "Surface", onSelect: () => insertChart("surface") },
            { label: "Column, series in rows", onSelect: () => insertChart("column", "rows") },
            { label: "Line, series in rows", onSelect: () => insertChart("line", "rows") },
            {
              label: "Statistical",
              items: [
                { label: "Histogram", onSelect: () => insertChart("histogram") },
                { label: "Pareto", onSelect: () => insertChart("pareto") },
                { label: "Box and whisker", onSelect: () => insertChart("boxWhisker") },
                { label: "Waterfall", onSelect: () => insertChart("waterfall") },
                { label: "Funnel", onSelect: () => insertChart("funnel") },
                { label: "Treemap", onSelect: () => insertChart("treemap") },
                { label: "Sunburst", onSelect: () => insertChart("sunburst") },
              ],
            },
          ],
        },
        "separator",
        { label: "Sparklines…", disabled: readOnly, onSelect: openSparklines },
        { label: "Pivot table…", disabled: readOnly, onSelect: openPivot },
        { label: "Image…", disabled: readOnly, onSelect: () => choose(imageInput, { purpose: "image", accept: "image/*", multiple: true, label: "Insert an image" }, (files) => void insertImages(files, { row: active.row, col: active.col })) },
        { label: "Image in cell…", disabled: readOnly || !singleCell, onSelect: () => choose(cellImageInput, { purpose: "image", accept: "image/*", label: "Insert an image in the cell" }, ([file]) => void insertImageInCell(file!)) },
        { label: ownLink ? "Edit link…" : "Link…", shortcut: `${MOD}K`, disabled: readOnly, onSelect: () => setLinkDialog(true) },
        ...commentItems(false),
        { label: cell?.note !== undefined ? "Edit note…" : "Note…", shortcut: `${SHIFT}F2`, disabled: readOnly || !singleCell, onSelect: () => setNoteDialog(true) },
        {
          label: "Notes",
          items: [
            { label: "Show/hide note", disabled: readOnly || !singleCell || cell?.note === undefined, checked: cell?.noteBox?.show === true, onSelect: toggleNote },
            { label: "Show all notes", disabled: readOnly || !session.notes(sheet.id).length, onSelect: () => showAllNotes(true) },
            { label: "Hide all notes", disabled: readOnly || !session.notes(sheet.id).length, onSelect: () => showAllNotes(false) },
            "separator",
            { label: "Previous note", disabled: !session.notes(sheet.id).length, onSelect: () => stepNote(-1) },
            { label: "Next note", disabled: !session.notes(sheet.id).length, onSelect: () => stepNote(1) },
            "separator",
            { label: "Delete note", disabled: readOnly || !singleCell || cell?.note === undefined, onSelect: deleteNote },
          ],
        },
        "separator",
        { label: "Page break", items: breakItems() },
        "separator",
        { label: "Table…", disabled: readOnly, onSelect: () => setTableDialog("new") },
        { label: "Slicer…", disabled: readOnly || slicerTables.length === 0, onSelect: () => setSlicerDialog({ mode: "insert" }) },
        { label: "Timeline…", disabled: readOnly || timelineTables.length === 0, onSelect: () => setTimelineDialog({ mode: "insert" }) },
        "separator",
        { label: "Checkbox", disabled: readOnly, onSelect: () => applyControl({ type: "checkbox" }) },
        { label: "Dropdown…", disabled: readOnly, onSelect: () => setDropdownDialog(true) },
        {
          label: "Badge",
          disabled: readOnly,
          items: [
            { label: "Label", onSelect: () => applyControl({ type: "badge" }) },
            ...Object.entries(chips ?? {}).map(([kind, k]) => ({ label: k.label, onSelect: () => { applyControl({ type: "badge", kind }); if (k.search) openPickerAtActive(); } })),
          ],
        },
        { label: cell?.control ? `Remove ${cell.control.type}` : "Remove checkbox, dropdown or badge", disabled: readOnly || !cell?.control, onSelect: () => applyControl(null) },
        "separator",
        { label: "Sheet", disabled: readOnly, onSelect: () => { const added = session.addSheet(); setSheetId(added.id); } },
      ],
    },
    {
      label: "Format",
      items: [
        {
          label: "Number",
          items: [
            ...NUMBER_FORMATS.map((f) => ({ label: f.example ? `${f.label}  ${f.example}` : f.label, checked: (cell?.fmt ?? null) === f.format, disabled: readOnly, onSelect: () => format(f.format) })),
            "separator" as const,
            { label: "More decimal places", disabled: readOnly, onSelect: () => format(stepDecimals(cell?.fmt, 1)) },
            { label: "Fewer decimal places", disabled: readOnly, onSelect: () => format(stepDecimals(cell?.fmt, -1)) },
          ],
        },
        {
          label: "Text",
          items: [
            { label: "Bold", shortcut: `${MOD}B`, checked: !!s.bold, disabled: readOnly, onSelect: () => toggle("bold") },
            { label: "Italic", shortcut: `${MOD}I`, checked: !!s.italic, disabled: readOnly, onSelect: () => toggle("italic") },
            { label: "Underline", shortcut: `${MOD}U`, checked: !!s.underline, disabled: readOnly, onSelect: () => toggle("underline") },
            { label: "Strikethrough", checked: !!s.strike, disabled: readOnly, onSelect: () => toggle("strike") },
          ],
        },
        {
          label: "Align",
          items: [
            { label: "Left", checked: s.align === "left", disabled: readOnly, onSelect: () => align("left") },
            { label: "Center", checked: s.align === "center", disabled: readOnly, onSelect: () => align("center") },
            { label: "Right", checked: s.align === "right", disabled: readOnly, onSelect: () => align("right") },
            "separator",
            { label: "Top", checked: s.vAlign === "top", disabled: readOnly, onSelect: () => valign("top") },
            { label: "Middle", checked: s.vAlign === "middle", disabled: readOnly, onSelect: () => valign("middle") },
            { label: "Bottom", checked: s.vAlign === "bottom", disabled: readOnly, onSelect: () => valign("bottom") },
          ],
        },
        { label: "Wrap text", checked: !!s.wrap, disabled: readOnly, onSelect: () => toggle("wrap") },
        "separator",
        { label: "Borders", items: borderItems() },
        { label: "Merge cells", items: mergeItems() },
        { label: "Conditional formatting", items: conditionalItems() },
        { label: "Table", items: tableItems() },
        "separator",
        { label: "Print area", items: printItems() },
        "separator",
        { label: "Locked", checked: session.isLocked(sheet.id, activeAddress), disabled: readOnly || !!sheet.protection, onSelect: toggleLocked },
        { label: "Hide formulas when protected", checked: session.hidesFormula(sheet.id, activeAddress), disabled: readOnly || !!sheet.protection, onSelect: toggleHideFormula },
        "separator",
        {
          label: "Picture",
          items: (() => {
            const pic = sheet.images?.find((x) => x.id === chartId);
            const off = readOnly || !pic;
            return [
              { label: "Format picture…", disabled: off, onSelect: () => pic && setImageDialog(pic.id) },
              { label: "Crop", checked: !!pic && cropId === pic.id, disabled: off, onSelect: () => pic && toggleCrop(pic.id) },
              { label: "Crop to shape", disabled: off, items: pic ? cropShapeItems(pic.id) : [] },
              { label: "Remove crop", disabled: off || !pic?.crop, onSelect: () => pic && session.cropImage(sheet.id, pic.id, null) },
              "separator" as const,
              { label: "Remove effects", disabled: off || !(pic?.glow || pic?.softEdge || pic?.reflection || pic?.artistic || pic?.shadow), onSelect: () => pic && session.formatImage(sheet.id, pic.id, { glow: null, softEdge: null, reflection: null, artistic: null, shadow: null }) },
            ] as MenuEntry[];
          })(),
        },
        { label: "Clear formatting", disabled: readOnly, onSelect: () => eachRange((a) => session.clear(sheet.id, a, "formats")) },
      ],
    },
    {
      label: "Data",
      items: [
        { label: "Sort A to Z", disabled: readOnly, onSelect: () => sortBy(false) },
        { label: "Sort Z to A", disabled: readOnly, onSelect: () => sortBy(true) },
        { label: "Custom sort…", disabled: readOnly, onSelect: openSort },
        { label: "Remove duplicates…", disabled: readOnly, onSelect: openDuplicates },
        "separator",
        sheet.filter ? { label: "Remove filter", disabled: readOnly, onSelect: () => session.setFilter(sheet.id, null) } : { label: "Create filter", disabled: readOnly, onSelect: createFilter },
        { label: "Filter views", items: filterViewItems() },
        "separator",
        { label: "Data validation…", disabled: readOnly, onSelect: () => setValidationDialog(true) },
        { label: "Circle invalid data", checked: circles, disabled: !sheet.validations?.length && !circles, onSelect: () => setCircles(!circles) },
        { label: "Refresh links to other workbooks", disabled: readOnly || !hasExternalLinks, onSelect: () => void refreshExternal().then((r) => setNotice(r.offline ? "This editor has no way to read other workbooks, so the lists and cells that read them use the copy saved in the workbook." : r.failed.length ? `${r.failed.map((f) => f.reason).join("; ")}. Those lists and cells use the copy saved in the workbook.` : `Links read again: ${r.updated} changed, ${r.unchanged} the same.`)) },
        "separator",
        { label: "Subtotal…", disabled: readOnly || !!session.pivotAt(sheet.id, activeAddress), onSelect: () => attempt(openSubtotal) },
        { label: "Group", items: groupItems() },
        { label: "Pivot table", items: pivotItems() },
        { label: "Iterative calculation…", checked: session.iteration !== null, disabled: readOnly, onSelect: () => setIterationDialog(true) },
      ],
    },
    { label: "Review", items: reviewItems() },
  ];

  const fmtLabel = NUMBER_FORMATS.find((f) => f.format === (cell?.fmt ?? null))?.label ?? "Custom";
  const classes = `pli-spreadsheet${className ? ` ${className}` : ""}`;

  const editItems = (): MenuEntry[] => [
    { label: "Insert row above", onSelect: () => insertAt("row", "before") },
    { label: "Insert row below", onSelect: () => insertAt("row", "after") },
    { label: "Insert column left", onSelect: () => insertAt("col", "before") },
    { label: "Insert column right", onSelect: () => insertAt("col", "after") },
    "separator",
    { label: "Delete row", onSelect: () => deleteHere("row") },
    { label: "Delete column", onSelect: () => deleteHere("col") },
    "separator",
    { label: "Clear contents", shortcut: "Delete", onSelect: () => eachRange((a) => session.clear(sheet.id, a, "contents")) },
    { label: "Clear formatting", onSelect: () => eachRange((a) => session.clear(sheet.id, a, "formats")) },
  ];

  return (
    <div
      className={classes}
      data-theme={forcedTheme(theme)}
      role="application"
      aria-label="Spreadsheet"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "F7" && !e.defaultPrevented && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setSpellDialog(true);
          return;
        }
        if (e.key === "F2" && e.shiftKey && !e.defaultPrevented && !readOnly && singleCell) {
          e.preventDefault();
          setNoteDialog(true);
          return;
        }
        if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.altKey && (e.key.toLowerCase() === "m" || e.code === "KeyM")) {
          if (commentClient) {
            e.preventDefault();
            startComment();
          }
          return;
        }
        if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "f" && !e.shiftKey) {
          e.preventDefault();
          find.show(false);
        } else if (k === "h" && !readOnly && !e.shiftKey) {
          e.preventDefault();
          find.show(true);
        } else if (k === "p" && !e.shiftKey) {
          e.preventDefault();
          setPreview(true);
        } else if (k === "k" && !readOnly && !e.shiftKey) {
          e.preventDefault();
          setLinkDialog(true);
        }
      }}
    >
      {((menu && !(readOnly && false)) || (toolbar && showToolbar)) && (
        <div className="pli-chrome pli-sheet-chrome">
          {menu && (
            <>
              <div className="pli-titlebar">
                {startActions && <div className="pli-actions pli-actions-start">{startActions}</div>}
                <input
                  className="pli-doc-title"
                  aria-label="Spreadsheet title"
                  value={session.state.title}
                  readOnly={readOnly}
                  placeholder="Untitled spreadsheet"
                  onChange={(e) => session.setTitle(e.target.value)}
                />
                <div className="pli-actions">
                  <PeopleBar collab={collab} room={room} />
                  {commentClient && (
                    <button type="button" className="pli-tool" aria-label="Comments" aria-pressed={commentsOpen} title="Comments" onMouseDown={keepFocus} onClick={() => setCommentsOpen((v) => !v)}>{CollabIcons.comment}</button>
                  )}
                  {actions}
                  {endActions}
                </div>
              </div>
              <MenuBar menus={extendMenus(menus.map((m) => ({ ...m, items: guarded(m.items) })), extraMenus, menuLabels)} />
            </>
          )}
          {toolbar && showToolbar && !previewVersion && (
        <Bar className="pli-sheet-toolbar" aria-label="Formatting">
          <button type="button" className="pli-tool" aria-label="Undo" title="Undo" disabled={!session.canUndo || readOnly} onMouseDown={keepFocus} onClick={() => session.undo()}>{Icons.undo}</button>
          <button type="button" className="pli-tool" aria-label="Redo" title="Redo" disabled={!session.canRedo || readOnly} onMouseDown={keepFocus} onClick={() => session.redo()}>{Icons.redo}</button>
          <span className="pli-sheet-sep" />
          <Dropdown label="Number format" className="pli-tool-wide" disabled={readOnly} panel={(close) => (
            <ul role="menu" aria-label="Number format" className="pli-menu-list">
              {NUMBER_FORMATS.map((f) => (
                <li key={f.label} role="none" className="pli-menu-item-wrap">
                  <button type="button" role="menuitemcheckbox" aria-checked={(cell?.fmt ?? null) === f.format} className="pli-menu-item" onMouseDown={keepFocus} onClick={() => { close(); format(f.format); }}>
                    <span className="pli-menu-check" aria-hidden="true">{(cell?.fmt ?? null) === f.format ? "✓" : ""}</span>
                    <span className="pli-menu-label">{f.label}</span>
                    {f.example && <span className="pli-menu-shortcut">{f.example}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}>
            <span className="pli-sheet-fmt">{fmtLabel} {Icons.chevron}</span>
          </Dropdown>
          <button type="button" className="pli-tool" aria-label="Format as currency" title="Currency" disabled={readOnly} onMouseDown={keepFocus} onClick={() => format("$#,##0.00")}>$</button>
          <button type="button" className="pli-tool" aria-label="Format as percent" title="Percent" disabled={readOnly} onMouseDown={keepFocus} onClick={() => format("0%")}>%</button>
          <button type="button" className="pli-tool" aria-label="Decrease decimal places" title="Fewer decimals" disabled={readOnly} onMouseDown={keepFocus} onClick={() => format(stepDecimals(cell?.fmt, -1))}>.0←</button>
          <button type="button" className="pli-tool" aria-label="Increase decimal places" title="More decimals" disabled={readOnly} onMouseDown={keepFocus} onClick={() => format(stepDecimals(cell?.fmt, 1))}>.00→</button>
          <span className="pli-sheet-sep" />
          <FontPicker value={s.fontFamily} defaultLabel="Calibri" label="Font" disabled={readOnly} onChange={(family) => style({ fontFamily: family })} />
          <button type="button" className="pli-tool" aria-label="Bold" title="Bold (Ctrl+B)" aria-pressed={!!s.bold} disabled={readOnly} onMouseDown={keepFocus} onClick={() => toggle("bold")}><b>B</b></button>
          <button type="button" className="pli-tool" aria-label="Italic" title="Italic (Ctrl+I)" aria-pressed={!!s.italic} disabled={readOnly} onMouseDown={keepFocus} onClick={() => toggle("italic")}><i>I</i></button>
          <button type="button" className="pli-tool" aria-label="Underline" title="Underline (Ctrl+U)" aria-pressed={!!s.underline} disabled={readOnly} onMouseDown={keepFocus} onClick={() => toggle("underline")}><u>U</u></button>
          <button type="button" className="pli-tool" aria-label="Strikethrough" title="Strikethrough" aria-pressed={!!s.strike} disabled={readOnly} onMouseDown={keepFocus} onClick={() => toggle("strike")}><s>S</s></button>
          <ColorPicker label="Text color" value={s.color} icon={Icons.textColor} noneLabel="Automatic" onChange={(c) => style({ color: c })} />
          <ColorPicker label="Fill color" value={s.fill} icon={Icons.fill} noneLabel="No fill" onChange={(c) => style({ fill: c })} />
          <Dropdown label="Borders" className="pli-tool-wide" disabled={readOnly} panel={(close) => <MenuList items={guarded(borderItems())} close={close} label="Borders" />}>
            <span className="pli-sheet-fmt">{FormatIcons.borders} {Icons.chevron}</span>
          </Dropdown>
          <ColorPicker label="Border color" value={lineLook?.color === "mixed" ? undefined : lineLook?.color ?? borderLine.color} mixed={lineLook?.color === "mixed"} icon={FormatIcons.borders} noneLabel="Automatic" onChange={pickBorderColor} />
          <Dropdown label="Merge cells" className="pli-tool-wide" disabled={readOnly} panel={(close) => <MenuList items={guarded(mergeItems())} close={close} label="Merge cells" />}>
            <span className="pli-sheet-fmt" data-pressed={mergedNow ? "" : undefined}>{FormatIcons.merge} {Icons.chevron}</span>
          </Dropdown>
          <Dropdown label="Conditional formatting" className="pli-tool-wide" disabled={readOnly} panel={(close) => <MenuList items={guarded(conditionalItems())} close={close} label="Conditional formatting" />}>
            <span className="pli-sheet-fmt">{FormatIcons.conditional} {Icons.chevron}</span>
          </Dropdown>
          <span className="pli-sheet-sep" />
          <button type="button" className="pli-tool" aria-label="Align left" title="Align left" aria-pressed={s.align === "left"} disabled={readOnly} onMouseDown={keepFocus} onClick={() => style({ align: s.align === "left" ? null : "left" })}>{Icons.left}</button>
          <button type="button" className="pli-tool" aria-label="Align center" title="Align center" aria-pressed={s.align === "center"} disabled={readOnly} onMouseDown={keepFocus} onClick={() => style({ align: s.align === "center" ? null : "center" })}>{Icons.center}</button>
          <button type="button" className="pli-tool" aria-label="Align right" title="Align right" aria-pressed={s.align === "right"} disabled={readOnly} onMouseDown={keepFocus} onClick={() => style({ align: s.align === "right" ? null : "right" })}>{Icons.right}</button>
          <button type="button" className="pli-tool" aria-label="Wrap text" title="Wrap text" aria-pressed={!!s.wrap} disabled={readOnly} onMouseDown={keepFocus} onClick={() => toggle("wrap")}>{Icons.wrap}</button>
          <span className="pli-sheet-sep" />
          <Dropdown label="Rows and columns" className="pli-tool-wide" disabled={readOnly} panel={(close) => <MenuList items={guarded(editItems())} close={close} label="Rows and columns" />}>
            <span className="pli-sheet-fmt">Cells {Icons.chevron}</span>
          </Dropdown>
          <Dropdown label="Sort and freeze" className="pli-tool-wide" disabled={readOnly} panel={(close) => (
            <MenuList
              close={close}
              label="Sort and freeze"
              items={guarded([
                { label: "Sort A to Z", onSelect: () => sortBy(false) },
                { label: "Sort Z to A", onSelect: () => sortBy(true) },
                { label: "Custom sort…", onSelect: openSort },
                "separator",
                { label: "Freeze top row", onSelect: () => freeze(1, sheet.frozen?.cols ?? 0) },
                { label: "Freeze first column", onSelect: () => freeze(sheet.frozen?.rows ?? 0, 1) },
                { label: `Freeze up to row ${active.row}`, onSelect: () => freeze(active.row, sheet.frozen?.cols ?? 0) },
                { label: `Freeze up to column ${colName(active.col)}`, onSelect: () => freeze(sheet.frozen?.rows ?? 0, active.col) },
                { label: "Unfreeze", disabled: !sheet.frozen, onSelect: () => freeze(0, 0) },
                "separator",
                sheet.filter ? { label: "Remove filter", onSelect: () => attempt(() => session.setFilter(sheet.id, null)) } : { label: "Create filter", onSelect: createFilter },
                "separator",
                { label: "Data validation…", onSelect: () => setValidationDialog(true) },
                { label: "Circle invalid data", checked: circles, disabled: !sheet.validations?.length && !circles, onSelect: () => setCircles(!circles) },
                { label: "Refresh links to other workbooks", disabled: readOnly || !hasExternalLinks, onSelect: () => void refreshExternal().then((r) => setNotice(r.offline ? "This editor has no way to read other workbooks, so the lists and cells that read them use the copy saved in the workbook." : r.failed.length ? `${r.failed.map((f) => f.reason).join("; ")}. Those lists and cells use the copy saved in the workbook.` : `Links read again: ${r.updated} changed, ${r.unchanged} the same.`)) },
                "separator",
                { label: "Group", items: groupItems() },
                { label: "Pivot table", items: pivotItems() },
        { label: "Iterative calculation…", checked: session.iteration !== null, disabled: readOnly, onSelect: () => setIterationDialog(true) },
              ])}
            />
          )}>
            <span className="pli-sheet-fmt">Data {Icons.chevron}</span>
          </Dropdown>
          <Dropdown label="Review and protect" className="pli-tool-wide" panel={(close) => <MenuList close={close} label="Review and protect" items={guarded(reviewItems())} />}>
            <span className="pli-sheet-fmt">Review {Icons.chevron}</span>
          </Dropdown>
          <span className="pli-sheet-sep" />
          <button type="button" className="pli-tool" aria-label="Crop picture" title="Crop the picked picture (Enter or Escape to finish)" aria-pressed={!!cropId && cropId === chartId} disabled={readOnly || !sheet.images?.some((x) => x.id === chartId)} onMouseDown={keepFocus} onClick={() => chartId && toggleCrop(chartId)}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 1v11h11M1 4h11v11" /></svg>
          </button>
        </Bar>
          )}
        </div>
      )}

      {pasteNote && (
        <div className="pli-notice pli-notice-paste" role="status">
          <span>{describePasteReport(pasteNote)}</span>
          {!pasteNote.cancelled && !circles && (
            <button type="button" className="pli-button" onClick={() => { setCircles(true); setPasteNote(null); }}>
              Circle
            </button>
          )}
          <button type="button" className="pli-button" onClick={() => setPasteNote(null)}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="pli-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="pli-button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {!readOnly && (
        <input
          ref={cellImageInput}
          type="file"
          hidden
          accept="image/*"
          aria-label="Insert an image in the cell"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void insertImageInCell(file);
            e.target.value = "";
          }}
        />
      )}
      {!readOnly && (
        <input
          ref={imageInput}
          type="file"
          hidden
          multiple
          accept="image/*"
          aria-label="Insert an image"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void insertImages(files, { row: active.row, col: active.col });
            e.target.value = "";
          }}
        />
      )}
      {menu && (
        <input
          ref={importInput}
          type="file"
          hidden
          accept=".xlsx,.csv,.tsv,.txt,.json"
          aria-label="Import a spreadsheet"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      )}

      {formulaBar && showFormulaBar && !previewVersion && (
        <div className="pli-sheet-formulabar">
          <input
            className="pli-sheet-namebox"
            aria-label="Name box"
            value={nameText ?? describeSelection(selection)}
            onChange={(e) => setNameText(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => setNameText(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goTo(nameText ?? "");
              } else if (e.key === "Escape") {
                setNameText(null);
                sink.current?.focus();
              }
            }}
          />
          <span className="pli-sheet-fx" aria-hidden="true">fx</span>
          <input
            ref={bar}
            className="pli-sheet-bar"
            aria-label="Formula bar"
            value={shownText}
            readOnly={readOnly || !session.canEdit(sheet.id, activeAddress)}
            spellCheck={false}
            onFocus={() => {
              if (!readOnly && !edit && session.canEdit(sheet.id, activeAddress)) setEdit({ row: active.row, col: active.col, text: shownText, mode: "edit", from: "bar", sheet: sheet.id });
            }}
            onChange={(e) => {
              if (!session.canEdit(sheet.id, activeAddress)) return;
              setCaretAt(e.target.selectionStart ?? e.target.value.length);
              barPoint.current = null;
              setEdit(edit ? { ...edit, text: e.target.value, mode: edit.from === "bar" ? edit.mode : "edit" } : { row: active.row, col: active.col, text: e.target.value, mode: "edit", from: "bar", sheet: sheet.id });
            }}
            onSelect={(e) => {
              if (!edit) return;
              const at = e.currentTarget.selectionStart ?? 0;
              setCaretAt(at);
              // The cursor moved away from the reference an arrow key was pointing at: the next arrow key starts again.
              const p = barPoint.current;
              if (p && (at < p.at || at > p.at + p.length)) barPoint.current = null;
            }}
            onMouseDown={() => {
              // Clicking in the text is editing it: the arrow keys go back to moving the text cursor.
              barPoint.current = null;
              if (edit?.from === "bar" && edit.mode === "enter") setEdit({ ...edit, mode: "edit" });
            }}
            onKeyDown={barKey}
            onBlur={(e) => {
              // Clicking into the grid commits the entry, so only leaving for somewhere else is handled here.
              if (edit?.from === "bar" && !(e.relatedTarget instanceof Node && e.currentTarget.closest(".pli-spreadsheet")?.contains(e.relatedTarget))) commit(null);
            }}
          />
          {edit && (edit.from === "bar" || edit.sheet !== sheet.id) && assistView && <div className="pli-sheet-bar-assist">{assistView}</div>}
        </div>
      )}

      {accessPanel && (
        <AccessibilityPanel
          session={session}
          revision={revision}
          readOnly={readOnly}
          go={(issue: AccessIssue) => {
            const target = session.sheet(issue.sheet);
            const at = parseCell(issue.cell) ?? { row: 1, col: 1 };
            setSelections((all) => ({ ...all, [target.id]: caret({ row: at.row, col: at.col }) }));
            setSheetId(target.id);
          }}
          onClose={() => { setAccessPanel(false); sink.current?.focus({ preventScroll: true }); }}
          onProblem={(m) => setNotice(m)}
        />
      )}
      {find.open && (
        <FindBar
          find={find}
          readOnly={readOnly}
          onClose={() => {
            find.close();
            sink.current?.focus();
          }}
        />
      )}

      {activeView && (
        <div className="pli-viewbar" role="status">
          <span>
            Filter view <strong>{activeView.name}</strong>: only you see it this way.
            {sortedPreview && " Its sort is shown, not applied: the cells haven't moved, so editing is off until you apply it or close it."}
          </span>
          <span className="pli-viewbar-actions">
            <button type="button" className="pli-button" disabled={readOnly} onClick={() => attempt(() => { session.applyFilterView(sheet.id, activeView.id); showView(null); })}>Apply for everyone</button>
            <button type="button" className="pli-button" onClick={() => showView(null)}>Close view</button>
          </span>
        </div>
      )}
      <div className="pli-sheet-body">
      <div style={{ display: previewVersion ? "none" : "contents" }}>
      <Grid
        threads={marks}
        peers={peerList}
        viewRows={sortedPreview ? null : viewRows}
        prompt={promptHere}
        invalid={invalid}
        found={find.marked}
        pageBreaks={pageBreaks}
        pageView={pageView}
        onCellCard={setCard}
        onNoteEdit={() => setNoteDialog(true)}
        onLinkOpen={openLink}
        session={shownSession}
        sheetId={sheet.id}
        revision={revision}
        selection={selection}
        onSelect={selectIfAllowed}
        edit={edit}
        onEdit={changeEdit}
        onCommit={commit}
        copied={copied}
        onCopied={setCopied}
        readOnly={readOnly || !!sortedPreview}
        sinkRef={sink}
        actions={gridActions}
        assist={assistView}
        chips={chips}
        remoteImages={remoteImages}
        chartId={chartId}
        onChartSelect={(id) => {
          setChartId(id);
          if (id) {
            setMenu(null);
            setFilterMenu(null);
          }
        }}
        onChartMenu={(info) => {
          setMenu(null);
          setFilterMenu(null);
          setChartMenu(info);
        }}
        onChartEdit={(id) => !readOnly && (sheet.images?.some((x) => x.id === id) ? setImageDialog(id) : setChartDialog(id))}
        cropId={cropId}
        onCropExit={() => setCropId(null)}
        onCropEnter={toggleCrop}
        onImageFiles={(files, at) => void insertImages(files, at)}
        onProblem={setNotice}
        onChipCard={(info) => {
          setMenu(null);
          setFilterMenu(null);
          setChoiceMenu(null);
          setChipCard({ ...info, sheet: sheet.id });
        }}
        chipCard={chipCard && chipCard.sheet === sheet.id ? chipCard : null}
        onEditRange={setRangePassword}
        onChoiceMenu={(info) => {
          setChipCard(null);
          setMenu(null);
          setFilterMenu(null);
          setChoiceMenu(info);
        }}
        onAssistKey={assistKey}
        onCaret={setCaretAt}
        onContextMenu={(point) => {
          setFilterMenu(null);
          setMenu(point);
        }}
        onFilterMenu={(info) => {
          setMenu(null);
          setFilterMenu(info);
        }}
        onSlicerMenu={(info) => {
          setMenu(null);
          setFilterMenu(null);
          setSlicerMenu(info);
        }}
        onTimelineMenu={(info) => {
          setMenu(null);
          setFilterMenu(null);
          setTimelineMenu(info);
        }}
        onExceptionMenu={(info) => {
          setMenu(null);
          setFilterMenu(null);
          setExceptionMenu(info);
        }}
      />
      </div>
      {previewVersion && previewSession && history && (
        <div className="pli-sheet-version-preview" onKeyDown={(e) => e.key === "Escape" && setPreviewVersion(null)}>
          <VersionPreviewBar history={history} version={previewVersion} onBack={() => setPreviewVersion(null)} onRestored={() => setPreviewVersion(null)} />
          <PliSheet session={previewSession} readOnly menu={false} toolbar={false} theme={theme} />
        </div>
      )}
      {history && historyOpen && <VersionHistoryPanel history={history} activeId={previewVersion?.id ?? null} onPreview={setPreviewVersion} onRestored={() => setPreviewVersion(null)} onClose={() => showHistory(false)} />}
      {commentClient && commentsOpen && (
        <CommentsPanel
          session={session}
          client={commentClient}
          activeId={activeThread}
          onActivate={goToThread}
          draft={
            commentDraft
              ? {
                  cell: commentDraft.range,
                  onSubmit: (body, mentions) => {
                    try {
                      const t = session.comments.commentOnRange(commentDraft.sheet, commentDraft.range, body, mentions);
                      setActiveThread(t.id);
                    } catch (e) {
                      setNotice(e instanceof Error ? e.message : String(e));
                    }
                    setCommentDraft(null);
                  },
                  onCancel: () => setCommentDraft(null),
                }
              : null
          }
          onClose={() => {
            setCommentsOpen(false);
            setCommentDraft(null);
            sink.current?.focus({ preventScroll: true });
          }}
        />
      )}
      </div>
      {contextAt && <ContextMenu x={contextAt.x} y={contextAt.y} items={guarded(contextItems())} onClose={() => { setMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      {slicerMenu && <ContextMenu x={slicerMenu.x} y={slicerMenu.y} items={guarded(slicerItems(slicerMenu.id))} onClose={() => { setSlicerMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      {timelineMenu && <ContextMenu x={timelineMenu.x} y={timelineMenu.y} items={guarded(timelineItems(timelineMenu.id))} onClose={() => { setTimelineMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      {exceptionMenu && <ContextMenu x={exceptionMenu.x} y={exceptionMenu.y} items={guarded(exceptionItems(exceptionMenu.row, exceptionMenu.col))} onClose={() => { setExceptionMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      {chartMenu && <ContextMenu x={chartMenu.x} y={chartMenu.y} items={guarded(chartItems(chartMenu.id))} onClose={() => { setChartMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      <ChartDialog
        open={chartDialog !== null}
        chart={sheet.charts?.find((c) => c.id === chartDialog) ?? null}
        sheetName={sheet.name}
        onClose={() => { setChartDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={(patch) => {
          if (chartDialog) session.updateChart(sheet.id, chartDialog, { ...CHART_RESET, ...patch });
          setChartDialog(null);
        }}
      />
      <SlicerDialog
        open={slicerDialog !== null}
        mode={slicerDialog?.mode ?? "insert"}
        tables={slicerTables}
        start={tableHere?.id}
        settings={slicerDialog?.mode === "settings" ? (() => { const x = sheet.slicers?.find((y) => y.id === slicerDialog.id) ?? session.pivotPanelsAsSlicers(sheet.id).find((y) => y.id === slicerDialog.id); return x ? { caption: x.caption ?? "", columns: x.columns ?? 1, style: x.style ?? "SlicerStyleLight1", column: x.column } : undefined; })() : undefined}
        custom={Object.keys(session.state.slicerStyles ?? {})}
        onStyle={(name) => {
          const id = slicerDialog?.mode === "settings" ? slicerDialog.id : null;
          if (!id) return;
          setSlicerDialog(null);
          setSlicerStyleDialog({ slicer: id, name: name ?? "", def: name ? structuredClone(session.slicerStyles()[name] ?? {}) : {}, isNew: !name });
        }}
        onClose={() => { setSlicerDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveSlicers}
      />
      <SlicerStyleDialog
        open={slicerStyleDialog !== null}
        initial={slicerStyleDialog}
        startFrom={[
          ...["Light1", "Light2", "Light3", "Light4", "Light5", "Light6", "Dark1", "Dark2", "Dark3", "Dark4", "Dark5", "Dark6"].map((n) => ({ value: `SlicerStyle${n}`, label: `Excel ${n.replace(/(\D+)(\d)/, "$1 $2").toLowerCase()}`, def: builtinSlicerStyle(`SlicerStyle${n}`)! })),
          ...Object.entries(session.state.slicerStyles ?? {}).map(([name, def]) => ({ value: name, label: name, def })),
        ]}
        taken={[...Object.keys(session.state.tableStyles ?? {}), ...Object.keys(session.state.slicerStyles ?? {}).filter((n) => n.toLowerCase() !== slicerStyleDialog?.name.toLowerCase() || slicerStyleDialog.isNew)]}
        onClose={() => { setSlicerStyleDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={(name, def) => {
          const at = slicerStyleDialog;
          try {
            session.batch(() => {
              session.setSlicerStyle(name, def);
              const x = sheet.slicers?.find((y) => y.id === at?.slicer) ?? session.pivotPanelsAsSlicers(sheet.id).find((y) => y.id === at?.slicer);
              if (x) session.updateSlicer(sheet.id, { ...x, style: name });
            });
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
          setSlicerStyleDialog(null);
          sink.current?.focus({ preventScroll: true });
        }}
      />
      <TimelineDialog
        open={timelineDialog !== null}
        mode={timelineDialog?.mode ?? "insert"}
        tables={timelineTables}
        start={tableHere?.id}
        settings={timelineDialog?.mode === "settings" ? (() => { const x = sheet.timelines?.find((y) => y.id === timelineDialog.id); return x ? { caption: x.caption ?? "", level: x.level, style: x.style ?? "TimeSlicerStyleLight1", column: x.column } : undefined; })() : undefined}
        onClose={() => { setTimelineDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveTimeline}
      />
      <TableStyleDialog
        open={styleDialog !== null}
        initial={styleDialog}
        startFrom={styleChoices}
        taken={[...TABLE_STYLES.map((x) => x.value), ...Object.keys(session.state.tableStyles ?? {})].filter((n) => n.toLowerCase() !== styleDialog?.was?.toLowerCase())}
        onClose={() => { setStyleDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveStyle}
      />
      <TableDialog
        open={tableDialog !== null}
        mode={tableDialog ?? "new"}
        range={bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2 ? session.currentRegion(sheet.id, activeAddress) : rangeAddress(work)}
        name={tableDialog === "rename" ? tableHere?.name ?? "" : ""}
        onClose={() => { setTableDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveTable}
      />
      {card && (() => {
        const at = cellAddress(card.row, card.col);
        const link = session.link(sheet.id, at);
        const note = session.noteInfo(sheet.id, at);
        const threadId = commentClient ? sheet.cells[at]?.thread : undefined;
        const thread = threadId === undefined ? undefined : commentClient!.thread(threadId);
        if (!link && note === null && !thread) return null;
        return (
          <>
            {(link || note !== null) && (
              <CellCard
                info={card}
                link={link}
                note={note}
                readOnly={readOnly}
                container={root.current}
                onOpen={(l) => openLink(l, at)}
                onEditLink={() => setLinkDialog(true)}
                onRemoveLink={removeLink}
                onEditNote={() => setNoteDialog(true)}
                onDeleteNote={deleteNote}
                onToggleNote={toggleNote}
              />
            )}
            {thread && commentClient && <ThreadHover client={commentClient} thread={thread} info={card} container={root.current} onActivate={(id) => { setCommentsOpen(true); setActiveThread(id); }} />}
          </>
        );
      })()}
      {(() => {
        const at = conditionDialog;
        const tbl = at?.table ? sheet.tables?.find((t) => t.id === at.table) : undefined;
        const name = at ? (tbl ? session.tableColumnNames(tbl)[at.col - parseRange(tbl.range)!.c1] ?? "" : colName(at.col)) : "";
        return (
          <FilterConditionDialog
            open={at !== null}
            column={tbl ? name : `column ${name}`}
            current={at ? (tbl ? tbl.filters?.[name] : sheet.filter?.columns?.[colName(at.col)]) : undefined}
            colors={at ? (tbl ? session.tableFilterColors(tbl.id, at.col) : session.filterColors(sheet.id, at.col)) : { fills: [], fonts: [] }}
            onClose={() => { setConditionDialog(null); sink.current?.focus({ preventScroll: true }); }}
            onSave={(rule) => {
              try {
                if (tbl) session.filterTableRule(tbl.id, at!.col, rule);
                else session.filterColumnRule(sheet.id, at!.col, rule);
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
              setConditionDialog(null);
              sink.current?.focus({ preventScroll: true });
            }}
          />
        );
      })()}
      {(() => {
        const at = sortDialog;
        const tbl = at?.table ? sheet.tables?.find((t) => t.id === at.table) : undefined;
        const fromFilter = !!at && !at.table && at.fixed && !!sheet.filter;
        const range = at ? (tbl ? tbl.range : fromFilter ? sheet.filter!.range : at.range ?? "A1") : "A1";
        const b = parseRange(range)!;
        const names = tbl ? session.tableColumnNames(tbl) : [];
        const plain = Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => `Column ${colName(b.c1 + i)}`);
        const heads = Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => {
          const v = session.value(sheet.id, `${colName(b.c1 + i)}${b.r1}`);
          return v === null || v === "" ? plain[i]! : String(v);
        });
        // The first row is taken for headers when it is all text and the row under it is not.
        const rowKinds = (r: number) => Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => typeof session.value(sheet.id, `${colName(b.c1 + i)}${r}`));
        const guess = rowKinds(b.r1).every((k) => k === "string") && rowKinds(Math.min(b.r1 + 1, b.r2)).some((k) => k !== "string");
        const current: RangeSortLevel[] = tbl
          ? session.tableSort(tbl.id).flatMap((l) => (names.includes(l.column) ? [{ column: names.indexOf(l.column) + 1, ...(l.descending ? { descending: true } : {}), ...(l.by ? { by: l.by } : {}), ...(l.color !== undefined ? { color: l.color } : {}), ...(l.icon !== undefined ? { icon: l.icon } : {}) } as RangeSortLevel] : []))
          : [];
        const start: RangeSortLevel[] = current.length ? current : [{ column: Math.max(1, (at?.col ?? b.c1) - b.c1 + 1) }];
        return (
          <SortDialog
            open={at !== null}
            title={tbl ? `Sort ${tbl.name}` : "Sort range"}
            columns={tbl ? names : heads}
            plainColumns={tbl || fromFilter ? undefined : plain}
            header={guess}
            levels={start}
            choicesOf={(column, header) => {
              try {
                return tbl ? session.tableSortChoices(tbl.id, b.c1 + column - 1) : session.sortChoices(sheet.id, range, column, { header: fromFilter || header });
              } catch {
                return { fills: [], fonts: [], icons: [] };
              }
            }}
            onClose={() => { setSortDialog(null); sink.current?.focus({ preventScroll: true }); }}
            onSave={(levels, header) => {
              try {
                if (tbl) session.sortTableBy(tbl.id, levels.map((l) => ({ column: names[l.column - 1]!, ...(l.descending ? { descending: true as const } : {}), ...(l.by ? { by: l.by } : {}), ...(l.color !== undefined ? { color: l.color } : {}), ...(l.icon !== undefined ? { icon: l.icon } : {}) })));
                else {
                  session.sort(sheet.id, range, { header: fromFilter || header, levels });
                  if (fromFilter) session.reapplyFilter(sheet.id);
                }
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
              setSortDialog(null);
              sink.current?.focus({ preventScroll: true });
            }}
          />
        );
      })()}
      {(() => {
        const at = dupDialog;
        const tbl = at?.table ? sheet.tables?.find((t) => t.id === at.table) : undefined;
        const range = at ? (tbl ? tbl.range : at.range ?? "A1") : "A1";
        const b = parseRange(range)!;
        const plain = Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => `Column ${colName(b.c1 + i)}`);
        const heads = plain.map((p, i) => {
          const v = session.value(sheet.id, `${colName(b.c1 + i)}${b.r1}`);
          return v === null || v === "" ? p : String(v);
        });
        const kinds = (r: number) => plain.map((_, i) => typeof session.value(sheet.id, `${colName(b.c1 + i)}${r}`));
        const guess = kinds(b.r1).every((k) => k === "string") && kinds(Math.min(b.r1 + 1, b.r2)).some((k) => k !== "string");
        return (
          <DuplicatesDialog
            open={at !== null}
            title={tbl ? `Remove duplicates from ${tbl.name}` : "Remove duplicates"}
            columns={tbl ? session.tableColumnNames(tbl) : heads}
            plainColumns={tbl ? undefined : plain}
            header={guess}
            onClose={() => { setDupDialog(null); sink.current?.focus({ preventScroll: true }); }}
            onSave={(columns, header) => {
              try {
                const removed = tbl ? session.removeTableDuplicates(tbl.id, columns.map((c) => session.tableColumnNames(tbl)[c - 1]!)) : session.removeDuplicates(sheet.id, range, { columns, header });
                const rows = tbl ? parseRange(session.state.sheets.find((x) => x.id === sheet.id)!.tables!.find((t) => t.id === tbl.id)!.range)! : b;
                const left = tbl ? (rows.r2 - rows.r1 + 1) - (hasHeader(tbl) ? 1 : 0) - (tbl.totals ? 1 : 0) : b.r2 - b.r1 + 1 - removed - (header ? 1 : 0);
                setNotice(`${removed} duplicate ${removed === 1 ? "row" : "rows"} found and removed; ${left} unique ${left === 1 ? "row" : "rows"} remain.`);
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
              setDupDialog(null);
              sink.current?.focus({ preventScroll: true });
            }}
          />
        );
      })()}
      <PivotDialog
        open={pivotDialog !== null}
        pivot={pivotDialog?.pivot ?? null}
        source={pivotDialog?.source ?? ""}
        sheets={session.state.sheets.map((s) => s.name)}
        pivotStyles={Object.keys(session.pivotStyles())}
        fieldsOf={(src) => session.pivotFields(src, sheet.name)}
        itemsOf={(src, field, group) => session.pivotFieldItems(src, sheet.name, field, group, pivotDialog?.pivot?.ranges)}
        onClose={() => { setPivotDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={savePivot}
        onRefresh={() => { if (pivotDialog?.pivot) attempt(() => session.refreshPivot(session.state.sheets.find((s) => s.pivots?.some((p) => p.id === pivotDialog.pivot!.id))!.id, pivotDialog.pivot!.id)); }}
        onRemove={() => { const p = pivotDialog?.pivot; if (p) attempt(() => session.deletePivot(session.state.sheets.find((s) => s.pivots?.some((x) => x.id === p.id))!.id, p.id)); setPivotDialog(null); sink.current?.focus({ preventScroll: true }); }}
      />
      <SubtotalDialog
        open={subtotalDialog !== null}
        range={subtotalDialog?.range ?? ""}
        columns={subtotalDialog ? subtotalColumns(subtotalDialog.range) : []}
        hasSubtotals={subtotalDialog ? session.subtotalRows(sheet.id, subtotalDialog.range).rows.length > 0 : false}
        {...(subtotalDialog && listTables(sheet, parseRange(subtotalDialog.range)!)[0] ? { table: listTables(sheet, parseRange(subtotalDialog.range)!)[0]!.name } : {})}
        onClose={() => { setSubtotalDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={(options) => {
          try {
            session.subtotal(sheet.id, subtotalDialog!.range, options);
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
          setSubtotalDialog(null);
          sink.current?.focus({ preventScroll: true });
        }}
        onRemove={() => { if (subtotalDialog) attempt(() => session.removeSubtotals(sheet.id, subtotalDialog.range)); setSubtotalDialog(null); sink.current?.focus({ preventScroll: true }); }}
      />
      <SparklineDialog
        open={sparkDialog !== null}
        group={sparkDialog?.group ?? null}
        sheetName={sheet.name}
        {...(session.state.themeColors ? { palette: session.state.themeColors } : {})}
        data={sparkDialog?.data ?? ""}
        location={sparkDialog?.location ?? ""}
        onClose={() => { setSparkDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveSparklines}
        onRemove={() => { if (sparkDialog?.group) attempt(() => session.deleteSparklines(sheet.id, sparkDialog.group!.id)); setSparkDialog(null); sink.current?.focus({ preventScroll: true }); }}
      />
      <FilterViewsDialog
        open={viewsDialog}
        views={sheet.filterViews ?? []}
        activeId={activeView?.id ?? null}
        hasFilter={canSaveView}
        summaries={viewSummaries}
        readOnly={readOnly}
        sortColumns={sheet.filter ? Array.from({ length: parseRange(sheet.filter.range)!.c2 - parseRange(sheet.filter.range)!.c1 + 1 }, (_, i) => {
          const r = parseRange(sheet.filter!.range)!;
          const heading = session.display(sheet.id, cellAddress(r.r1, r.c1 + i)).text;
          return { column: r.c1 + i, label: heading ? `${heading} (${colName(r.c1 + i)})` : `Column ${colName(r.c1 + i)}` };
        }) : []}
        onClose={() => { setViewsDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSave={(name, sort) => viewChange(() => { const v = session.saveFilterView(sheet.id, name, sort ? { sort } : {}); showView(v.id); })}
        onShow={showView}
        onApply={(id) => viewChange(() => { session.applyFilterView(sheet.id, id); if (viewIds[sheet.id] === id) showView(null); })}
        onUpdate={(id) => viewChange(() => void session.updateFilterView(sheet.id, id))}
        onRename={(id, name) => viewChange(() => session.renameFilterView(sheet.id, id, name))}
        onDelete={(id) => viewChange(() => { session.deleteFilterView(sheet.id, id); if (viewIds[sheet.id] === id) showView(null); })}
      />
      <SheetPageDialog open={pageDialog} sheetName={sheet.name} page={session.pageSetup(sheet.id)} titles={session.printTitles(sheet.id)} onClose={() => { setPageDialog(false); sink.current?.focus({ preventScroll: true }); }} onSave={savePageSetup} />
      {preview && (
        <PrintPreview
          session={session}
          sheetId={sheet.id}
          revision={revision}
          remoteImages={remoteImages}
          container={root.current}
          onFile={(name, data, type) => deliver(name, data as BlobPart, type)}
          {...(onPrint ? { onPrint } : {})}
          browserPrint={browserPrint}
          onClose={() => { setPreview(false); sink.current?.focus({ preventScroll: true }); }}
          onSetup={() => setPageDialog(true)}
        />
      )}
      <PasteSourceDialog
        open={pasteSourceDialog}
        onClose={() => { setPasteSourceDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSubmit={(source) => {
          setPasteSourceDialog(false);
          pasteClipboard({ source });
        }}
      />
      <SpellDialog
        open={spellDialog}
        session={session}
        checker={spellChecker}
        sheet={sheet.name}
        selection={bounds.r1 === bounds.r2 && bounds.c1 === bounds.c2 ? null : rangeAddress(bounds)}
        readOnly={readOnly}
        go={(name, address) => {
          const target = session.sheet(name);
          const at = parseCell(address)!;
          setSelections((all) => ({ ...all, [target.id]: caret({ row: at.row, col: at.col }) }));
          setSheetId(target.id);
        }}
        {...(onSpellAddWord ? { onAddWord: onSpellAddWord } : {})}
        onProblem={(m) => setNotice(m)}
        onClose={() => { setSpellDialog(false); sink.current?.focus({ preventScroll: true }); }}
      />
      <IterationDialog
        open={iterationDialog}
        current={session.iteration}
        onClose={() => { setIterationDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSubmit={(settings) => {
          try {
            session.setIteration(settings);
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
          setIterationDialog(false);
          sink.current?.focus({ preventScroll: true });
        }}
      />
      <EditRangesDialog open={editRangesDialog} session={session} sheetId={sheet.id} selection={workAddress} onClose={() => { setEditRangesDialog(false); sink.current?.focus({ preventScroll: true }); }} />
      <EditRangePasswordDialog
        range={rangePassword?.name ?? null}
        onClose={() => { setRangePassword(null); sink.current?.focus({ preventScroll: true }); }}
        onSubmit={(password) => {
          try {
            session.unlockEditRange(rangePassword!.sheet, rangePassword!.name, password);
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
          setRangePassword(null);
          setNotice(`"${rangePassword!.name}" is open for editing until you close this sheet.`);
          sink.current?.focus({ preventScroll: true });
        }}
      />
      <ProtectDialog mode={protectDialog} sheetName={sheet.name} onClose={() => { setProtectDialog(null); sink.current?.focus({ preventScroll: true }); }} onSubmit={submitProtection} />
      <ImageDialog
        open={imageDialog !== null}
        image={sheet.images?.find((x) => x.id === imageDialog)}
        onClose={() => { setImageDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={(look) => {
          if (imageDialog) {
            try {
              session.formatImage(sheet.id, imageDialog, { alt: look.alt, rotation: look.rotation || null, flipH: look.flipH, flipV: look.flipV, crop: look.crop, placement: look.placement, border: look.border, shadow: look.shadow, brightness: look.brightness || null, contrast: look.contrast || null, grayscale: look.grayscale, glow: look.glow, softEdge: look.softEdge, reflection: look.reflection, artistic: look.artistic, shape: look.shape });
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          }
          if (look.thenCrop && imageDialog) toggleCrop(imageDialog);
          setImageDialog(null);
          sink.current?.focus({ preventScroll: true });
        }}
      />
      <LinkDialog
        open={linkDialog}
        existing={ownLink}
        text={singleCell ? (cell?.v !== undefined ? String(cell.v) : "") : ""}
        textEditable={singleCell && cell?.f === undefined && !cell?.control}
        sheets={session.state.sheets.map((x) => ({ id: x.id, name: x.name }))}
        currentSheet={sheet.id}
        onClose={() => { setLinkDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveLink}
        onRemove={removeLink}
      />
      <NoteDialog
        open={noteDialog}
        note={noteHere}
        author={author}
        cell={activeAddress}
        onClose={() => { setNoteDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveNote}
        onDelete={deleteNote}
      />
      <ValidationDialog
        open={validationDialog}
        rule={validationHere ?? null}
        choices={!validationHere && cell?.control?.type === "dropdown" ? cell.control.options.map((o) => o.value) : null}
        multipleChoices={!validationHere && cell?.control?.type === "dropdown" && !!cell.control.multiple}
        choicesSeparator={!validationHere && cell?.control?.type === "dropdown" ? cell.control.separator : undefined}
        externalRefs={externalRefs.filter((r) => r.by.includes("validation"))}
        external={validationHere ? session.externalListStatus(sheet.id, activeAddress) : null}
        ranges={selectedRanges().join(" ")}
        names={Object.keys(session.state.names ?? {})}
        onClose={() => { setValidationDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSave={saveValidation}
      />
      <RuleDialog
        open={ruleDialog !== null}
        pivot={rulePivot}
        rule={ruleDialog?.id ? sheet.conditional?.find((r) => r.id === ruleDialog.id) ?? null : null}
        kind={ruleDialog?.kind}
        op={ruleDialog?.op}
        ranges={selectedRanges().join(" ")}
        onClose={() => { setRuleDialog(null); sink.current?.focus({ preventScroll: true }); }}
        onSave={(spec) => {
          const id = ruleDialog?.id;
          try {
            if (id) session.updateRule(sheet.id, { ...spec, id } as ConditionalRule);
            else session.addRule(sheet.id, spec, 0);
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
          setRuleDialog(null);
        }}
      />
      <RulesDialog
        open={rulesManager}
        rules={sheet.conditional ?? []}
        readOnly={readOnly}
        onClose={() => { setRulesManager(false); sink.current?.focus({ preventScroll: true }); }}
        onNew={() => setRuleDialog({ id: null, kind: "cell" })}
        onEdit={(id) => setRuleDialog({ id })}
        onMove={(id, to) => session.moveRule(sheet.id, id, to)}
        onDelete={(id) => session.deleteRule(sheet.id, id)}
      />
      {chipCard && (() => {
        const cell = session.state.sheets.find((x) => x.id === chipCard.sheet)?.cells[cellAddress(chipCard.row, chipCard.col)];
        const kind = cell?.control?.type === "badge" && cell.control.kind ? chips?.[cell.control.kind] : undefined;
        const item = kind?.resolve(chipCard.value);
        if (!kind?.card || !item || chipCard.sheet !== sheet.id) return null;
        return <ChipCard info={chipCard} kind={kind} item={item} container={root.current} onClose={closeChipCard} />;
      })()}
      {choiceMenu && <ChoiceMenu session={session} sheetId={sheet.id} row={choiceMenu.row} col={choiceMenu.col} x={choiceMenu.x} y={choiceMenu.y} chips={chips} onClose={() => { setChoiceMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}
      <DropdownDialog
        open={dropdownDialog}
        initial={cell?.control?.type === "dropdown" ? cell.control : undefined}
        onClose={() => { setDropdownDialog(false); sink.current?.focus({ preventScroll: true }); }}
        onSave={(control) => { applyControl(control); setDropdownDialog(false); }}
      />
      {filterMenu && <FilterMenu session={session} sheetId={sheet.id} col={filterMenu.col} x={filterMenu.x} y={filterMenu.y} table={filterMenu.table} onCondition={setConditionDialog} onSort={(info) => setSortDialog(info.table ? { table: info.table, col: info.col } : { range: sheet.filter?.range ?? "A1", col: info.col, fixed: true })} onProblem={setNotice} onClose={() => { setFilterMenu(null); sink.current?.focus({ preventScroll: true }); }} container={root.current} />}

      <div className="pli-sheet-footer">
        {tabs && (
          <SheetTabs
            people={peerTabs}
            session={session}
            sheetId={sheet.id}
            readOnly={readOnly}
            onSwitch={(id) => {
              // A formula being typed stays open on the other sheet, so cells there can be clicked into it; other text is entered.
              if (edit && !edit.text.startsWith("=")) commit(null);
              setSheetId(id);
              setChartId(null);
              requestAnimationFrame(() => sink.current?.focus({ preventScroll: true }));
            }}
          />
        )}
        {statusBar && showStatus && (
          <div className="pli-sheet-mode" role="status" aria-live="polite" data-mode={edit ? (edit.mode === "enter" && expectsReference(edit.text, edit.text.length) ? "point" : edit.mode) : "ready"}>
            {edit ? (edit.mode === "enter" ? (expectsReference(edit.text, edit.text.length) ? "Point" : "Enter") : "Edit") : "Ready"}
          </div>
        )}
        {statusBar && showStatus && sheet.protection && <div className="pli-sheet-stats pli-sheet-protected">Protected sheet</div>}
        {statusBar && showStatus && selectionStats && (
          <div className="pli-sheet-stats" aria-live="polite">
            {selectionStats.numbers > 0 && <span>Sum: {fmtNum(selectionStats.sum)}</span>}
            {selectionStats.average !== null && <span>Average: {fmtNum(selectionStats.average)}</span>}
            <span>Count: {selectionStats.count}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtNum(n: number): string {
  return Number(n.toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

const TAB_COLORS: { label: string; color: string | null }[] = [
  { label: "No color", color: null },
  { label: "Red", color: "#e5484d" },
  { label: "Orange", color: "#f5851f" },
  { label: "Yellow", color: "#f5b000" },
  { label: "Green", color: "#2f9e44" },
  { label: "Teal", color: "#0e9aa7" },
  { label: "Blue", color: "#1a56db" },
  { label: "Purple", color: "#7c4dff" },
  { label: "Pink", color: "#d6409f" },
  { label: "Gray", color: "#6b7280" },
];

function SheetTabs({ session, sheetId, readOnly, onSwitch, people }: { session: SheetSession; sheetId: string; readOnly: boolean; onSwitch(id: string): void; people?: Map<string, PliUser[]> | undefined }) {
  const sheets = session.state.sheets;
  const shown = sheets.filter((s) => !s.hidden);
  const hiddenOnes = sheets.filter((s) => s.hidden);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /** The sheets picked together with Ctrl or Shift (the one being looked at is one of them). */
  const [picked, setPicked] = useState<string[]>([]);
  /** Where the menu for a right click on the bar is open. */
  const [barMenu, setBarMenu] = useState<{ x: number; y: number; tab: boolean } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const group = picked.filter((id) => shown.some((s) => s.id === id));
  const targets = group.length > 1 ? group : [sheetId];

  const finish = (id: string, save: boolean) => {
    if (save && draft.trim() !== "") {
      try {
        session.renameSheet(id, draft.trim());
      } catch (e) {
        setProblem((e as Error).message);
        return;
      }
    }
    setProblem(null);
    setRenaming(null);
  };

  const pick = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey) {
      const from = shown.findIndex((s) => s.id === sheetId);
      const to = shown.findIndex((s) => s.id === id);
      setPicked(shown.slice(Math.min(from, to), Math.max(from, to) + 1).map((s) => s.id));
    } else if (e.ctrlKey || e.metaKey) {
      const now = group.length > 1 ? group : [sheetId];
      setPicked(now.includes(id) ? (now.length > 1 ? now.filter((x) => x !== id) : now) : [...now, id]);
      if (!now.includes(id)) onSwitch(id);
    } else {
      setPicked([]);
      onSwitch(id);
    }
  };

  const index = shown.findIndex((s) => s.id === sheetId);
  const many = targets.length > 1;
  const names = (ids: string[]) => (ids.length === 1 ? `"${sheets.find((s) => s.id === ids[0])!.name}"` : `${ids.length} sheets`);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setPicked([]);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const menu = (): MenuEntry[] => [
    { label: "Rename", disabled: many, onSelect: () => { setDraft(sheets.find((s) => s.id === sheetId)!.name); setRenaming(sheetId); } },
    {
      label: many ? `Tab color (${targets.length} sheets)` : "Tab color",
      items: TAB_COLORS.map((c) => ({
        label: c.label,
        checked: !many && (sheets.find((s) => s.id === sheetId)?.tabColor ?? null) === c.color,
        onSelect: () => attempt(() => session.batch(() => targets.forEach((id) => session.setTabColor(id, c.color)))),
      })),
    },
    { label: "Move left", disabled: many || index <= 0, onSelect: () => attempt(() => session.moveSheet(sheetId, sheets.findIndex((s) => s.id === shown[index - 1]!.id))) },
    { label: "Move right", disabled: many || index === shown.length - 1, onSelect: () => attempt(() => session.moveSheet(sheetId, sheets.findIndex((s) => s.id === shown[index + 1]!.id))) },
    "separator",
    { label: many ? `Hide ${targets.length} sheets` : "Hide", disabled: shown.length - targets.length < 1, onSelect: () => attempt(() => session.hideSheets(targets)) },
    ...(hiddenOnes.length
      ? [{ label: "Unhide", items: hiddenOnes.map((h) => ({ label: h.name, onSelect: () => attempt(() => { session.hideSheets([h.id], false); onSwitch(h.id); }) })) }]
      : []),
    {
      label: many ? `Delete ${targets.length} sheets` : "Delete",
      disabled: sheets.length - targets.length < 1 || shown.length - targets.length < 1,
      onSelect: () => {
        if (typeof window === "undefined" || window.confirm(`Delete ${names(targets)}?`)) attempt(() => session.deleteSheets(targets));
      },
    },
  ];

  const barItems = (): MenuEntry[] => [
    { label: "New sheet", disabled: readOnly, onSelect: () => attempt(() => onSwitch(session.addSheet().id)) },
    {
      label: "Unhide",
      disabled: readOnly || hiddenOnes.length === 0,
      ...(hiddenOnes.length ? { items: hiddenOnes.map((h) => ({ label: h.name, onSelect: () => attempt(() => { session.hideSheets([h.id], false); onSwitch(h.id); }) })) } : {}),
    },
  ];

  return (
    <div
      className="pli-sheet-tabs"
      role="tablist"
      aria-label="Sheets"
      aria-multiselectable="true"
      ref={bar}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        e.preventDefault();
        setBarMenu({ x: e.clientX, y: e.clientY, tab: false });
      }}
    >
      {barMenu && <ContextMenu x={barMenu.x} y={barMenu.y} items={barMenu.tab ? [...menu(), "separator" as const, barItems()[0]!] : barItems()} onClose={() => setBarMenu(null)} container={bar.current?.closest<HTMLElement>(".pli-spreadsheet") ?? null} />}
      {!readOnly && (
        <button type="button" className="pli-tool" aria-label="Add sheet" title="Add sheet" onMouseDown={keepFocus} onClick={() => attempt(() => onSwitch(session.addSheet().id))}>
          {Icons.plus}
        </button>
      )}
      {shown.map((s) => {
        const inGroup = group.length > 1 && group.includes(s.id);
        return (
          <div key={s.id} className="pli-sheet-tab" role="tab" aria-selected={s.id === sheetId || inGroup} data-active={s.id === sheetId ? "" : undefined} data-picked={inGroup ? "" : undefined} style={s.tabColor ? ({ "--pli-tab": s.tabColor } as React.CSSProperties) : undefined}
            onContextMenu={(e) => {
              if (readOnly || (e.target as HTMLElement).closest("input")) return;
              e.preventDefault();
              e.stopPropagation();
              // Right-clicking a tab of the picked group keeps the group; any other tab is looked at on its own.
              if (!inGroup && s.id !== sheetId) {
                setPicked([]);
                onSwitch(s.id);
              } else if (!inGroup) setPicked([]);
              setBarMenu({ x: e.clientX, y: e.clientY, tab: true });
            }}
          >
            {renaming === s.id ? (
              <input
                className="pli-sheet-rename"
                autoFocus
                value={draft}
                aria-label="Sheet name"
                aria-invalid={problem ? true : undefined}
                title={problem ?? undefined}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => finish(s.id, true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finish(s.id, true);
                  else if (e.key === "Escape") finish(s.id, false);
                }}
              />
            ) : (
              <button
                type="button"
                className="pli-sheet-tab-name"
                onMouseDown={keepFocus}
                onClick={(e) => pick(s.id, e)}
                onDoubleClick={() => {
                  if (readOnly) return;
                  setDraft(s.name);
                  setRenaming(s.id);
                }}
              >
                {s.protection && (
                  <svg className="pli-sheet-tab-lock" viewBox="0 0 12 12" width="11" height="11" role="img" aria-label="Protected">
                    <path d="M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5M2.5 5h7v5.5h-7z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                )}
                {s.name}
                {people?.get(s.id)?.length ? (
                  <span className="pli-sheet-tab-people" aria-label={`${people.get(s.id)!.map((u) => u.name).join(", ")} on this sheet`}>
                    {people.get(s.id)!.map((u) => <span key={u.id} className="pli-sheet-tab-person" title={u.name} style={{ ["--pli-peer" as string]: u.color ?? "#1c7ed6" }} />)}
                  </span>
                ) : null}
              </button>
            )}
            {s.id === sheetId && !readOnly && renaming !== s.id && (
              <Dropdown label="Sheet options" className="pli-sheet-tab-more" panel={(close) => <MenuList items={menu()} close={close} label="Sheet options" />}>
                {Icons.chevron}
              </Dropdown>
            )}
          </div>
        );
      })}
      {problem && renaming === null && (
        <span className="pli-sheet-tab-problem" role="alert" onClick={() => setProblem(null)}>{problem}</span>
      )}
    </div>
  );
}

/** Every look field a sparklines dialog sets, as `undefined`, so that what it leaves out is taken back to Excel's. */
const clearedStyle = (): Partial<Record<keyof SparklineGroup, undefined>> => ({ color: undefined, negativeColor: undefined, markerColor: undefined, firstColor: undefined, lastColor: undefined, highColor: undefined, lowColor: undefined, markers: undefined, first: undefined, last: undefined, high: undefined, low: undefined, negative: undefined, lineWeight: undefined, emptyAs: undefined, showHidden: undefined, rightToLeft: undefined, showAxis: undefined, min: undefined, max: undefined, axisColor: undefined, dateAxis: undefined });
/** The fields of a look that have a value. */
const definedOnly = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
