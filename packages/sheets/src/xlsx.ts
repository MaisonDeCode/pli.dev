import { CHARTEX_COLORS, CHARTEX_COLORS_REL, CHARTEX_COLORS_TYPE, CHARTEX_STYLE, CHARTEX_STYLE_REL, CHARTEX_STYLE_TYPE } from "./xlsx-chartex-style";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { attr, child, childrenNamed, createId, parseXml, PliError, textOf, type XmlElement } from "@pli.dev/core";
import { cellAddress, colName, colNumber, inBounds, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import { cleanMerge, overlaps } from "./rule";
import { Calculator } from "./calc";
import { isDateFormat } from "./format";
import { parseFormula, printFormula, FormulaSyntaxError, type Node } from "./formula";
import { getFunction } from "./functions";
import { checkSheetName } from "./ops";
import { MAX_COLS, MAX_ROWS, type Cell, type CellBorders, type CellStyle, type ConditionalRule, type ConditionalStyle, type FilterCriterion, type IterationSettings, type Table, type TableStyleDef, type Validation, type Dimension, type ErrorCode, type Sheet, type Workbook, type TableStylePart, type SlicerStyleDef, type DataBlock, type PivotStyleDef } from "./model";
import { mapNodes, shiftFormula } from "./refs";
import { linkLook } from "./link";
import { readSheetCharts, sheetChartParts } from "./xlsx-chart";
import { readValidation, validationRulesXml } from "./xlsx-validation";
import { dropdownGroups, externalBooksOf, externalLinkParts, externalRuleXml, linkedBooksOf, linkedName, readLinkedBooks, externalSource, readPliExternalRules, readPliValidationExtras, validationExtensionXml, withPliExtras, type LinkedBook } from "./xlsx-external";
import { splitExternalSheet } from "./external-links";
import { externalTableBounds, findExternalTable } from "./external-tables";
import { readTimelinesExt, timelineOf, timelinesExt, type PendingTimeline } from "./xlsx-timeline";
import { readSheetSlicers, readSlicerCache, sheetSlicerFiles, slicerCachesExt, slicerListExt, slicerOf, type PendingSlicer, type SlicerFiles } from "./xlsx-slicer";
import { withoutGhosts } from "./ops";
import { hyperlinksXml, notesParts, readHyperlinks, readNotes } from "./xlsx-note";
import { PERSON_REL, PERSON_TYPE, THREADED_REL, THREADED_TYPE, PeopleList, readPersons, readThreadedComments, threadedCommentsXml, withPlaceholders } from "./xlsx-threads";
import { deepestLevel } from "./outline";
import { readSparklines, sparklineExtXml } from "./xlsx-spark";
import { THEME_CONTENT_TYPE, THEME_PART, THEME_REL_TYPE, needsTheme, ownPalette, themeXml } from "./xlsx-theme";
import { pageSetUpPrXml, pageXml, printNamesXml, readPage, readPrintNames } from "./xlsx-page";
import { hfPictureFiles, readHfPictures } from "./xlsx-hfpicture";
import { cleanPageSetup } from "./page";
import { DEFAULT_ITERATION, MAX_ITERATIONS } from "./iteration";
import { accessExtXml, cellProtectionXml, colsXml, protectedRangesXml, readAccessExt, readCellProtection, readColumnHides, readColumnLocks, readProtectedRanges, readSheetProtection, readWorkbookAccessExt, readWorkbookProtection, rowLockAttrs, sheetProtectionXml, styleWithLock, tidyReadHides, tidyReadLocks, workbookAccessExt, workbookProtectionXml } from "./xlsx-protect";
import { IMAGE_CONTENT_TYPES, readSheetImages, sheetImageFiles, type MediaType } from "./xlsx-image";
import { richDataFiles, richPictures, type RichPicture } from "./xlsx-richdata";
import type { ImageType } from "./image";
import { pivotParts, readPivotRuleScopes, readPivotTable, type PivotReadExtra } from "./xlsx-pivot";
import { attachPivotPanel, pivotPanelFiles, readPivotCache, readSheetPivotPanels, readTimelineState, slicersPartXml, timelineCachesExt, timelineListExt, timelinesPartXml, type PendingPivotPanel, type PivotCacheLink, type WrittenPivot } from "./xlsx-pivot-slicer";
import { cleanPivot } from "./pivot";
import { filterColumnXml, readFilterColumn, type FilterDxf } from "./xlsx-filter";
import { readTablePart, readTableStyles, tablePartXml, tableStylesXml } from "./xlsx-table";
import { readSlicerStyles, slicerStylesXml } from "./xlsx-slicerstyle";
import { NSV_CONTENT_TYPE, NSV_REL, namedSheetViewsXml, readNamedSheetViews, sheetFilterUid, tableFilterUid } from "./xlsx-sheetview";
import { applyPliPivots, pivotStyleElements, pliPivotExt, readPivotStyles } from "./xlsx-pivot-extra";
import { checkTable, tableAt, tableColumns } from "./table";
import { BUILTIN_FORMATS, borderXml, colorOf, conditionalXml, dxfXml, readBorder, readConditional, readDxfs, readTheme } from "./xlsx-format";
import { fileFont, familyHint, readFontName, setThemeFonts, setXlsxFontMode, type XlsxFontMode } from "./xlsx-fonts";
import { isError, type ErrorValue } from "./values";
import { ERROR_CODES } from "./values";

/** What came out of reading an XLSX file, and what Pli does not have yet and left out. */
export interface XlsxImport {
  workbook: Workbook;
  warnings: string[];
  /** The people who wrote the file's threaded comments (the comments' `author` is their `id`): give them to `Users.add` so their names show. */
  people: { id: string; name: string }[];
}

const MAX_ENTRY = 200 * 1024 * 1024;
const MAX_CELLS = 10_000_000;


// ---- reading ----

interface Xf {
  fmt?: string;
  style?: CellStyle;
}

function readStyles(root: XmlElement | undefined, theme: readonly string[]): Xf[] {
  if (!root) return [];
  const formats = new Map<number, string>();
  for (const f of childrenNamed(child(root, "numFmts"), "numFmt")) formats.set(Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? "General");
  const fonts = childrenNamed(child(root, "fonts"), "font").map((f) => {
    const s: CellStyle = {};
    if (child(f, "b") && attr(child(f, "b"), "val") !== "0") s.bold = true;
    if (child(f, "i") && attr(child(f, "i"), "val") !== "0") s.italic = true;
    if (child(f, "u") && attr(child(f, "u"), "val") !== "none") s.underline = true;
    if (child(f, "strike") && attr(child(f, "strike"), "val") !== "0") s.strike = true;
    const color = colorOf(child(f, "color"), theme);
    if (color && color !== "#000000") s.color = color;
    const sz = Number(attr(child(f, "sz"), "val"));
    if (sz > 0) s.fontSize = sz;
    const name = readFontName(f, "name");
    if (name) s.fontFamily = name;
    return s;
  });
  const borders = childrenNamed(child(root, "borders"), "border").map((b) => readBorder(b, theme));
  const base = fonts[0] ?? {};
  const fills = childrenNamed(child(root, "fills"), "fill").map((f) => {
    const p = child(f, "patternFill");
    return attr(p, "patternType") === "solid" ? colorOf(child(p, "fgColor"), theme) : undefined;
  });
  return childrenNamed(child(root, "cellXfs"), "xf").map((xf) => {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    const code = id === 0 ? undefined : formats.get(id) ?? BUILTIN_FORMATS[id];
    const out: Xf = {};
    if (code && code !== "General") out.fmt = code;
    const s: CellStyle = { ...fonts[Number(attr(xf, "fontId") ?? 0)] };
    if (s.fontSize === base.fontSize) delete s.fontSize;
    if (s.fontFamily === base.fontFamily) delete s.fontFamily;
    if (s.color === base.color) delete s.color;
    const fill = fills[Number(attr(xf, "fillId") ?? 0)];
    if (fill) s.fill = fill;
    const al = child(xf, "alignment");
    const h = attr(al, "horizontal");
    if (h === "left" || h === "center" || h === "right") s.align = h;
    const v = attr(al, "vertical");
    if (v === "top") s.vAlign = "top";
    else if (v === "center") s.vAlign = "middle";
    else if (v === "bottom") s.vAlign = "bottom";
    if (attr(al, "wrapText") === "1" || attr(al, "wrapText") === "true") s.wrap = true;
    const indent = Number(attr(al, "indent") ?? 0);
    if (Number.isInteger(indent) && indent >= 1 && indent <= 15) s.indent = indent;
    const border = borders[Number(attr(xf, "borderId") ?? 0)];
    if (border) s.border = border;
    const prot = child(xf, "protection");
    if (prot && (attr(prot, "locked") === "0" || attr(prot, "locked") === "false")) s.locked = false;
    if (prot && (attr(prot, "hidden") === "1" || attr(prot, "hidden") === "true")) s.hideFormula = true;
    if (Object.keys(s).length) out.style = s;
    return out;
  });
}

function readStrings(root: XmlElement | undefined): string[] {
  if (!root) return [];
  return childrenNamed(root, "si").map((si) => {
    const direct = child(si, "t");
    if (direct) return textOf(direct);
    return childrenNamed(si, "r").map((r) => textOf(child(r, "t"))).join("");
  });
}

/** The workbooks the file being read links to (`[1]` is the first). */
let readLinks: readonly LinkedBook[] = [];
/** The place in the file of each workbook the workbook being written reads (0 when none). */
let writeLinks: ((book: string) => number) | undefined;
/** The workbook being written, for the values it keeps of other workbooks. */
let writeBook: Workbook | undefined;
/** The cells a reference to a table of another workbook stands for (`[Prices.xlsx]Orders[Total]`), as the workbook being written knows them. */
let writeTableCells: ((ref: Extract<Node, { t: "tref" }>) => { book: string; sheet: string; bounds: Bounds } | null) | undefined;

function stripFuture(f: string): string {
  try {
    return printFormula(
      mapNodes(parseFormula(f), (n: Node) => {
        if (n.t === "call" && /^_xl(fn|ws)\./i.test(n.name)) return { ...n, name: n.name.replace(/^(_xlfn\.)?(_xlws\.)?/i, "") };
        if (n.t === "name" && /^_xlpm\./i.test(n.name)) return { ...n, name: n.name.slice(6) };
        // A function named on its own (`_xlfn.PERCENTOF` in `GROUPBY(…,_xlfn.PERCENTOF)`).
        if (n.t === "name" && /^_xlfn\./i.test(n.name)) return { ...n, name: n.name.slice(6) };
        // Excel writes a function named on its own as `_xleta.SUM`.
        if (n.t === "name" && /^_xleta\./i.test(n.name)) return { ...n, name: n.name.slice(7).replace(/^_xlfn\./i, "") };
        if (n.t === "call" && /^_xlpm\./i.test(n.name)) return { ...n, name: n.name.slice(6) };
        // An optional LAMBDA parameter is declared `_xlop.x`.
        if (n.t === "name" && /^_xlop\./i.test(n.name)) return { t: "name", name: `[${n.name.slice(6)}]` };
        // (An earlier Pli wrote `[_xlpm.x]`, which Excel removes; it is still read.)
        if (n.t === "tref" && n.table === undefined && n.from !== undefined && /^_xlpm\./i.test(n.from)) return { ...n, from: n.from.slice(6) };
        if (n.t === "tref" && n.sheet !== undefined && readLinks.length) {
          const m = /^\[(\d+)\](.*)$/.exec(n.sheet);
          const name = m ? linkedName(readLinks, Number(m[1])) : undefined;
          if (m && name) return { ...n, sheet: `[${name}]${m[2]}` };
        }
        // A sheet of another workbook is `[1]Sheet1` in a file; here it is named by its file, `[Prices.xlsx]Sheet1`.
        // (Excel's data validation extension names the file with its folder: `/Users/me/[Prices.xlsx]Sheet1`.)
        if (n.t === "ref" && n.sheet !== undefined && /^.*[\\/]\[(?!\d+\])[^\]]+\]/.test(n.sheet)) return { ...n, sheet: n.sheet.replace(/^.*[\\/](?=\[)/, "") };
        if (n.t === "ref" && n.sheet !== undefined && readLinks.length) {
          const m = /^\[(\d+)\](.*)$/.exec(n.sheet);
          const name = m ? linkedName(readLinks, Number(m[1])) : undefined;
          if (m && name) return { ...n, sheet: `[${name}]${m[2]}` };
        }
        return n;
      }),
    );
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return f;
    throw e;
  }
}

const sheetRelsPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");

/** The path a relationship's target points at, from the part that has the relationship. */
function resolvePart(part: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = part.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") dir.pop();
    else if (piece !== ".") dir.push(piece);
  }
  return dir.join("/");
}

function target(rels: XmlElement | undefined, id: string | undefined): string | undefined {
  const rel = childrenNamed(rels, "Relationship").find((r) => r.attrs["Id"] === id);
  const t = rel?.attrs["Target"];
  if (!t) return undefined;
  return t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
}

/** Reads an `.xlsx` file. What Pli doesn't have yet (pictures, tables, some kinds of conditional formatting, …) is listed in `warnings`. */
/** The iteration settings `calcPr` holds (`iterateCount`, `iterateDelta`); a missing or unusable one takes Excel's default. */
function readIteration(calcPr: XmlElement | undefined): IterationSettings {
  const count = Number(attr(calcPr, "iterateCount"));
  const delta = Number(attr(calcPr, "iterateDelta"));
  return {
    maxIterations: Number.isInteger(count) && count >= 1 && count <= MAX_ITERATIONS ? count : DEFAULT_ITERATION.maxIterations,
    maxChange: attrIsNumber(attr(calcPr, "iterateDelta")) && delta >= 0 ? delta : DEFAULT_ITERATION.maxChange,
  };
}
const attrIsNumber = (v: string | undefined): boolean => v !== undefined && v.trim() !== "" && Number.isFinite(Number(v));

export function fromXlsx(data: Uint8Array): XlsxImport {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.originalSize <= MAX_ENTRY });
  } catch (e) {
    throw new PliError("invalid_document", `Not an XLSX file: ${(e as Error).message}`);
  }
  const xml = (path: string): XmlElement | undefined => (files[path] ? parseXml(strFromU8(files[path]!)) : undefined);
  const book = xml("xl/workbook.xml");
  // The cells Excel 2016's chart kinds read are named in hidden names, which the chart parts point at.
  const chartNames = new Map<string, string>(childrenNamed(child(book, "definedNames"), "definedName").flatMap((d) => (/^_xlchart\./i.test(attr(d, "name") ?? "") ? [[(attr(d, "name") ?? "").toLowerCase(), textOf(d).trim()] as [string, string]] : [])));
  if (!book) throw new PliError("invalid_document", "Not an XLSX file: no workbook part");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const themeRoot = xml("xl/theme/theme1.xml");
  const theme = readTheme(themeRoot);
  setThemeFonts(themeRoot);
  const stylesRoot = xml("xl/styles.xml");
  const styles = readStyles(stylesRoot, theme);
  const dxfs = readDxfs(stylesRoot, theme);
  const tableStyles = readTableStyles(stylesRoot, dxfs, theme);
  const slicerStyles = readSlicerStyles(stylesRoot, dxfs);
  const pivotStyles = readPivotStyles(stylesRoot, dxfs, theme);
  const strings = readStrings(xml("xl/sharedStrings.xml"));
  const date1904 = attr(child(book, "workbookPr"), "date1904") === "1" || attr(child(book, "workbookPr"), "date1904") === "true";
  const warnings = new Set<string>();
  const unknown = new Set<string>();
  const personRel = childrenNamed(rels, "Relationship").find((r) => /\/person$/.test(r.attrs["Type"] ?? ""));
  const persons = readPersons(xml(personRel?.attrs["Target"] ? resolvePart("xl/workbook.xml", personRel.attrs["Target"]) : "xl/persons/person.xml"));
  const threads: Record<string, import("@pli.dev/core").Thread<import("./model").CellAnchor>> = {};
  const richCells = richPictures(xml, (part) => files[part]);
  const linkedBooks = readLinkedBooks(book, rels, xml, sheetRelsPath);
  readLinks = linkedBooks;
  let lostRichCells = 0;

  const sheets: Sheet[] = [];
  const pendingTables: { sheet: Sheet; table: Table; columns: string[]; calculated: Record<string, string>; partId: number; columnIds: number[] }[] = [];
  const pendingViews: { sheet: Sheet; root: XmlElement }[] = [];
  const pendingSlicers: PendingSlicer[] = [];
  const pendingTimelines: PendingTimeline[] = [];
  const pendingPivots: { sheet: Sheet; def: XmlElement; cache: XmlElement | undefined; records?: XmlElement; externalPath?: string }[] = [];
  const rulesByPriority = new Map<Sheet, Map<number, ConditionalRule>>();
  // Slicer caches name the table and column a slicer filters.
  const slicerCaches = new Map<string, { tablePart: number; columnId: number }>();
  for (const ext of childrenNamed(child(book, "extLst"), "ext")) {
    for (const link of childrenNamed(child(ext, "slicerCaches"), "slicerCache")) {
      const cache = readSlicerCache(xml(target(rels, attr(link, "id", "r")) ?? ""));
      if (cache) slicerCaches.set(cache.name, cache);
    }
  }
  // Slicers and timelines on pivot tables read their caches too: each names the pivot table and the field.
  const pivotCaches = new Map<string, PivotCacheLink>();
  const timelineStates = new Map<string, { start?: number; end?: number }>();
  const pendingPivotPanels: PendingPivotPanel[] = [];
  for (const ext of childrenNamed(child(book, "extLst"), "ext")) {
    for (const link of [...childrenNamed(child(ext, "slicerCaches"), "slicerCache"), ...childrenNamed(child(ext, "timelineCacheRefs"), "timelineCacheRef")]) {
      const part = xml(target(rels, attr(link, "id", "r")) ?? "");
      const read = readPivotCache(part);
      if (!read) continue;
      pivotCaches.set(read.name, read);
      if (read.kind === "timeline") timelineStates.set(read.name, readTimelineState(part));
    }
  }
  const names: string[] = [];
  let cellCount = 0;
  let fileAt = -1;
  const byFileIndex = new Map<number, Sheet>();
  for (const s of childrenNamed(child(book, "sheets"), "sheet")) {
    fileAt++;
    const path = target(rels, attr(s, "id", "r"));
    const root = path ? xml(path) : undefined;
    if (!root) continue;
    let name = (attr(s, "name") ?? `Sheet${sheets.length + 1}`).replace(/[:\\/?*[\]]/g, "_").replace(/^'+|'+$/g, "").slice(0, 31) || `Sheet${sheets.length + 1}`;
    try {
      checkSheetName(name, names);
    } catch {
      name = `${name.slice(0, 28)}_${sheets.length + 1}`;
    }
    names.push(name);
    const sheet: Sheet = { id: createId("sheet_"), name, cells: {} };
    if (attr(s, "state") === "hidden" || attr(s, "state") === "veryHidden") sheet.hidden = true;
    const tab = colorOf(child(child(root, "sheetPr"), "tabColor"), theme);
    if (tab) sheet.tabColor = tab;
    const outlinePr = child(child(root, "sheetPr"), "outlinePr");
    const off = (v: string | undefined) => v === "0" || v === "false";
    if (outlinePr && (off(attr(outlinePr, "summaryBelow")) || off(attr(outlinePr, "summaryRight")))) {
      sheet.outline = { ...(off(attr(outlinePr, "summaryBelow")) ? { summaryAbove: true as const } : {}), ...(off(attr(outlinePr, "summaryRight")) ? { summaryLeft: true as const } : {}) };
    }

    const view = child(child(child(root, "sheetViews"), "sheetView"), "pane");
    if (view && attr(view, "state") === "frozen") {
      const cols = Number(attr(view, "xSplit") ?? 0);
      const rows = Number(attr(view, "ySplit") ?? 0);
      if (cols > 0 || rows > 0) sheet.frozen = { rows, cols };
    }
    const columns: Record<string, Dimension> = {};
    const defaultColWidth = Number(attr(child(root, "sheetFormatPr"), "defaultColWidth")) || 8.43;
    for (const col of childrenNamed(child(root, "cols"), "col")) {
      const min = Number(attr(col, "min"));
      const max = Math.min(Number(attr(col, "max")), min + 255, MAX_COLS);
      // A width that isn't marked custom and is the default one (Excel's 8.43 or 9.14 characters) is no size at all.
      const rawWidth = Number(attr(col, "width"));
      const custom = attr(col, "customWidth") === "1" || attr(col, "customWidth") === "true";
      // (Excel for Mac writes its own default, 8.5 or the sheet's `defaultColWidth`, on columns that only carry an outline level or a style.)
      const width = custom || ![8.43, 8.5, 9.140625, defaultColWidth].includes(rawWidth) ? rawWidth : 0;
      const hidden = attr(col, "hidden") === "1" || attr(col, "hidden") === "true";
      const level = Math.min(7, Math.max(0, Math.floor(Number(attr(col, "outlineLevel") ?? 0)) || 0));
      const collapsed = attr(col, "collapsed") === "1" || attr(col, "collapsed") === "true";
      if (!(min >= 1) || (!(width > 0) && !hidden && !level && !collapsed)) continue;
      for (let c = min; c <= max; c++) columns[colName(c)] = { ...(width > 0 ? { size: width } : {}), ...(hidden ? { hidden: true } : {}), ...(level ? { level } : {}), ...(collapsed ? { collapsed: true as const } : {}) };
    }
    {
      // Columns that carry a lock: the style of a `<col>` says whether cells made in it are locked.
      const locks = readColumnLocks(childrenNamed(child(root, "cols"), "col"), (i) => styles[i]?.style?.locked !== false);
      for (const [k, d] of Object.entries(locks.columns)) columns[k] = { ...columns[k], ...d };
      if (locks.unlocked) sheet.unlocked = true;
      // And the formulas they hide.
      const hides = readColumnHides(childrenNamed(child(root, "cols"), "col"), (i) => styles[i]?.style?.hideFormula === true);
      for (const [k, d] of Object.entries(hides.columns)) columns[k] = { ...columns[k], ...d };
      if (hides.hidden) sheet.hiddenFormulas = true;
    }
    if (Object.keys(columns).length) sheet.columns = columns;

    const rows: Record<string, Dimension> = {};
    const colsLock = Object.values(columns).some((d) => d.locked !== undefined);
    const colsHide = Object.values(columns).some((d) => d.hideFormula !== undefined);
    const shared = new Map<string, { f: string; row: number; col: number }>();
    /** Cells an array formula filled; their values in the file are results, which are worked out again. */
    const covered: Bounds[] = [];
    let lastRow = 0;
    for (const row of childrenNamed(child(root, "sheetData"), "row")) {
      const rowNumber = Number(attr(row, "r") ?? lastRow + 1);
      lastRow = rowNumber;
      if (rowNumber < 1 || rowNumber > MAX_ROWS) continue;
      const ht = Number(attr(row, "ht"));
      const hidden = attr(row, "hidden") === "1" || attr(row, "hidden") === "true";
      const level = Math.min(7, Math.max(0, Math.floor(Number(attr(row, "outlineLevel") ?? 0)) || 0));
      const collapsed = attr(row, "collapsed") === "1" || attr(row, "collapsed") === "true";
      const rowLock = (attr(row, "customFormat") === "1" || attr(row, "customFormat") === "true") && attr(row, "s") !== undefined ? styles[Number(attr(row, "s"))]?.style?.locked !== false : undefined;
      const rowHideAll = rowLock !== undefined ? styles[Number(attr(row, "s"))]?.style?.hideFormula === true : undefined;
      // A row's style that only says what the sheet already says (locked, formulas shown) is not a lock or a hiding of the row's own.
      const keepLock = rowLock !== undefined && (rowLock !== !sheet.unlocked || colsLock);
      const rowHide = rowHideAll === true || (rowHideAll === false && (!!sheet.hiddenFormulas || colsHide)) ? rowHideAll : undefined;
      if ((ht > 0 && attr(row, "customHeight") !== "0") || hidden || level || collapsed || keepLock || rowHide !== undefined) rows[String(rowNumber)] = { ...(ht > 0 && attr(row, "customHeight") !== "0" ? { size: ht } : {}), ...(hidden ? { hidden: true } : {}), ...(level ? { level } : {}), ...(collapsed ? { collapsed: true as const } : {}), ...(keepLock ? { locked: rowLock } : {}), ...(rowHide !== undefined ? { hideFormula: rowHide } : {}) };
      let lastCol = 0;
      for (const c of childrenNamed(row, "c")) {
        const ref = attr(c, "r");
        const pos = ref ? parseCell(ref) : { row: rowNumber, col: lastCol + 1 };
        if (!pos) continue;
        lastCol = pos.col;
        if (++cellCount > MAX_CELLS) throw new PliError("out_of_range", "That workbook has too many cells");
        const xf = styles[Number(attr(c, "s") ?? 0)];
        const cell: Cell = {};
        const fEl0 = child(c, "f");
        if (fEl0 && attr(fEl0, "t") === "array" && attr(fEl0, "ref")) {
          const r = parseRange(attr(fEl0, "ref")!.replace(/\$/g, ""));
          if (r) covered.push(r);
        } else if (!fEl0 && covered.some((b) => inBounds(b, pos.row, pos.col))) continue;
        const type = attr(c, "t");
        const v = textOf(child(c, "v"));
        const fEl = child(c, "f");
        if (fEl) {
          const ftype = attr(fEl, "t");
          let text = textOf(fEl).trim();
          if (ftype === "shared") {
            const si = attr(fEl, "si") ?? "";
            if (text) shared.set(si, { f: text, row: pos.row, col: pos.col });
            else {
              const master = shared.get(si);
              if (master) text = shiftFormula(master.f, pos.row - master.row, pos.col - master.col);
            }
          }
          if (text) {
            cell.f = stripFuture(text);
            for (const n of unknownFunctions(cell.f)) unknown.add(n);
          } else if (v !== "") fillValue(cell, type, v, strings);
        } else if (v !== "" || type === "inlineStr") {
          if (type === "inlineStr") cell.v = textOf(child(c, "is"));
          else fillValue(cell, type, v, strings);
        }
        // A picture Excel placed in the cell: the cell says which rich value it holds (`vm`), and the value its file.
        const vm = Number(attr(c, "vm") ?? 0);
        if (vm > 0 && cell.f === undefined) {
          const picture = richCells?.(vm);
          if (picture) {
            delete cell.e;
            cell.v = picture.alt ?? "";
            cell.picture = picture;
          } else lostRichCells++;
        }
        if (date1904 && typeof cell.v === "number" && xf?.fmt && isDateFormat(xf.fmt)) cell.v += 1462;
        if (xf?.fmt) cell.fmt = xf.fmt;
        if (xf?.style) cell.s = { ...xf.style };
        {
          // A cell that says nothing about its lock takes its row's, column's or sheet's.
          const s = readCellProtection({ rows, columns, ...(sheet.unlocked ? { unlocked: true as const } : {}), ...(sheet.hiddenFormulas ? { hiddenFormulas: true as const } : {}) } as Sheet, pos.row, pos.col, xf?.style, cell.s);
          if (s) cell.s = s;
          else delete cell.s;
        }
        if (Object.keys(cell).length) sheet.cells[cellAddress(pos.row, pos.col)] = cell;
      }
    }
    if (Object.keys(rows).length) sheet.rows = rows;
    tidyReadLocks(sheet);
    tidyReadHides(sheet);
    const auto = child(root, "autoFilter");
    const autoRange = attr(auto, "ref") ? parseRange(attr(auto, "ref")!.replace(/\$/g, "")) : null;
    if (autoRange && autoRange.r1 !== autoRange.r2) {
      const columns: Record<string, FilterCriterion> = {};
      for (const fc of childrenNamed(auto, "filterColumn")) {
        const read = readFilterColumn(fc, dxfs);
        if (typeof read === "string") warnings.add(`A filter was left out because ${read}; the rows it hid stay hidden`);
        else if (read !== null) columns[colName(autoRange.c1 + Number(attr(fc, "colId") ?? 0))] = read;
      }
      sheet.filter = { range: rangeAddress(autoRange), ...(Object.keys(columns).length ? { columns } : {}) };
    }
    const merges: string[] = [];
    for (const m of childrenNamed(child(root, "mergeCells"), "mergeCell")) {
      let range: string;
      try {
        range = cleanMerge(attr(m, "ref") ?? "");
      } catch {
        continue;
      }
      const b = parseRange(range)!;
      if (merges.some((o) => overlaps(parseRange(o)!, b))) warnings.add("Some merged ranges overlap and were left out");
      else merges.push(range);
    }
    if (merges.length) sheet.merges = merges;
    readPage(root, sheet, warnings);
    readSparklines(root, sheet, warnings);
    const protection = readSheetProtection(child(root, "sheetProtection"), warnings);
    if (protection) sheet.protection = protection;
    {
      const editRanges = readProtectedRanges(child(root, "protectedRanges"), warnings);
      if (editRanges.length) sheet.editRanges = editRanges;
      readAccessExt(root, sheet, warnings);
    }
    if (child(root, "conditionalFormatting") || child(root, "extLst")) {
      const { rules, skipped, byPriority } = readConditional(root, dxfs, stripFuture, () => createId("rule_"), theme);
      if (rules.length) sheet.conditional = rules;
      rulesByPriority.set(sheet, byPriority);
      if (skipped) warnings.add("Some conditional formatting rules are of a kind Pli doesn't have yet and were left out");
    }
    const validations = child(root, "dataValidations");
    const ruled: Validation[] = [];
    const pliExtras = readPliValidationExtras(root);
    // Rules that read another workbook are held whole in Pli's extension; the older part has only what Excel could use of them.
    const pliExternal = readPliExternalRules(root);
    // Excel keeps a list that reads another sheet in the sheet's extension list (`x14:dataValidations`), with the same parts under other names.
    const extended = childrenNamed(child(root, "extLst"), "ext").flatMap((ext) => childrenNamed(child(ext, "dataValidations"), "dataValidation"));
    for (const v of [...childrenNamed(validations, "dataValidation"), ...extended]) {
      if (pliExternal.has((attr(v, "sqref") ?? textOf(child(v, "sqref"))).trim().replace(/\s+/g, " "))) continue;
      const formula = textOf(child(v, "formula1")).trim();
      const inline = /^"(.*)"$/.exec(formula);
      if (attr(v, "type") === "list" && inline) {
        const options = inline[1]!.split(",").filter((s) => s !== "").map((value) => ({ value }));
        if (options.length === 0) continue;
        // Pli's extension says when the cells take several choices (Excel's list has no setting for that).
        const several = pliExtras.get((attr(v, "sqref") ?? textOf(child(v, "sqref"))).trim().replace(/\s+/g, " "));
        const multi = several?.dropdown && several.multiple ? { multiple: true as const, ...(several.separator !== undefined && several.separator !== ", " ? { separator: several.separator } : {}) } : {};
        const strict = several?.dropdown && several.multiple ? several.alert === "stop" : attr(v, "showErrorMessage") === "1" && (attr(v, "errorStyle") ?? "stop") === "stop";
        let count = 0;
        for (const ref of (attr(v, "sqref") ?? textOf(child(v, "sqref"))).split(/\s+/)) {
          const r = parseRange(ref.replace(/\$/g, ""));
          if (!r) continue;
          for (let row = r.r1; row <= r.r2 && count < 20000; row++)
            for (let col = r.c1; col <= r.c2 && count < 20000; col++, count++) {
              const address = cellAddress(row, col);
              sheet.cells[address] = { ...sheet.cells[address], control: { type: "dropdown", options, ...multi, ...(strict ? { strict: true } : {}) } };
            }
        }
        continue;
      }
      const rule = readValidation(v, stripFuture, () => createId("valid_"), linkedBooks);
      if (rule) ruled.push(withPliExtras(rule, pliExtras));
      else if (attr(v, "type") !== "none" && attr(v, "type") !== undefined) warnings.add("Some data validation rules are of a kind Pli doesn't have yet and were left out");
    }
    for (const kept of pliExternal.values()) {
      let rule = { ...kept, id: createId("valid_") } as Validation;
      // A list gets the cells and the path the file's link to that workbook holds, where the rule had no copy of its own.
      const linked = rule.kind === "list" ? externalSource(rule.source, linkedBooks) : null;
      if (rule.kind === "list" && linked) rule = { ...rule, snapshot: { ...linked.snapshot, ...(rule.snapshot ?? {}) } };
      ruled.push(rule);
    }
    if (ruled.length) sheet.validations = ruled;
    const drawing = child(root, "drawing");
    if (drawing) {
      const charts = readSheetCharts(path!, attr(drawing, "id", "r") ?? "", sheet, xml, warnings, chartNames);
      if (charts.length) sheet.charts = charts;
      const pictures = readSheetImages(path!, attr(drawing, "id", "r") ?? "", sheet, xml, (part) => files[part], warnings, theme);
      if (pictures.length) sheet.images = pictures;
    }
    if (drawing) {
      // Slicers sit in the same drawing; the sheet's slicers part names them.
      const sheetRels = xml(sheetRelsPath(path!));
      const relTarget = (id: string | undefined) => childrenNamed(sheetRels, "Relationship").find((r) => r.attrs["Id"] === id)?.attrs["Target"];
      const drawingPart = relTarget(attr(drawing, "id", "r"));
      let slicersPart: XmlElement | undefined;
      for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
        const link = child(child(ext, "slicerList"), "slicer");
        const t = link ? relTarget(attr(link, "id", "r")) : undefined;
        if (t) slicersPart = xml(resolvePart(path!, t));
      }
      let timelinesPart: XmlElement | undefined;
      for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
        const link = child(child(ext, "timelineRefs"), "timelineRef");
        const t = link ? relTarget(attr(link, "id", "r")) : undefined;
        if (t) timelinesPart = xml(resolvePart(path!, t));
      }
      if (drawingPart) {
        const drawingXml = xml(resolvePart(path!, drawingPart));
        pendingSlicers.push(...readSheetSlicers(sheet, drawingXml, slicersPart, slicerCaches, warnings, pivotCaches));
        pendingPivotPanels.push(...readSheetPivotPanels(sheet, drawingXml, slicersPart, timelinesPart, pivotCaches, timelineStates));
      }
    }
    // Timelines over tables are kept in an extension of the worksheet that only Pli reads.
    pendingTimelines.push(...readTimelinesExt(sheet, child(root, "extLst")));
    {
      const sheetRels = xml(sheetRelsPath(path!));
      const relationships = childrenNamed(sheetRels, "Relationship");
      readHyperlinks(root, (id) => relationships.find((r) => r.attrs["Id"] === id)?.attrs["Target"], sheet, warnings, theme);
      for (const rel of relationships.filter((r) => /\/pivotTable$/.test(r.attrs["Type"] ?? ""))) {
        const defPath = rel.attrs["Target"] ? resolvePart(path!, rel.attrs["Target"]) : undefined;
        const def = defPath ? xml(defPath) : undefined;
        if (!def) continue;
        const cacheRel = childrenNamed(xml(sheetRelsPath(defPath!)), "Relationship").find((r) => /\/pivotCacheDefinition$/.test(r.attrs["Type"] ?? ""));
        const cachePath = cacheRel?.attrs["Target"] ? resolvePart(defPath!, cacheRel.attrs["Target"]) : undefined;
        const cache = cachePath ? xml(cachePath) : undefined;
        // A cache that reads another workbook names the file in its own relationships and keeps the rows in its records part.
        const cacheRels = cachePath ? childrenNamed(xml(sheetRelsPath(cachePath)), "Relationship") : [];
        const sourceId = attr(child(child(cache, "cacheSource"), "worksheetSource"), "id", "r");
        const recordsRel = cacheRels.find((r) => /\/pivotCacheRecords$/.test(r.attrs["Type"] ?? ""));
        pendingPivots.push({
          sheet,
          def,
          cache,
          ...(sourceId ? { externalPath: cacheRels.find((r) => r.attrs["Id"] === sourceId)?.attrs["Target"] } : {}),
          ...(recordsRel?.attrs["Target"] && cachePath ? { records: xml(resolvePart(cachePath, recordsRel.attrs["Target"])) } : {}),
        });
      }
      const commentsRel = relationships.find((r) => /\/comments$/.test(r.attrs["Type"] ?? ""));
      const threadedRel = relationships.find((r) => /\/threadedComment$/.test(r.attrs["Type"] ?? ""));
      if (commentsRel?.attrs["Target"]) {
        // The boxes of notes (their size, place and whether they stay showing) are in the legacy drawing the sheet points at.
        const legacyId = attr(child(root, "legacyDrawing"), "id", "r");
        const vmlTarget = legacyId ? relationships.find((r) => r.attrs["Id"] === legacyId)?.attrs["Target"] : undefined;
        const vmlFile = vmlTarget ? files[resolvePart(path!, vmlTarget)] : undefined;
        // A picture that fills a note's box is a file the drawing's own relationships point at.
        const vmlPath = vmlTarget ? resolvePart(path!, vmlTarget) : undefined;
        const vmlRels = vmlFile && vmlPath ? childrenNamed(xml(sheetRelsPath(vmlPath)), "Relationship") : [];
        readNotes(xml(resolvePart(path!, commentsRel.attrs["Target"])), sheet, warnings, vmlFile ? strFromU8(vmlFile) : undefined, theme, (id) => {
          const t = vmlRels.find((r) => r.attrs["Id"] === id)?.attrs["Target"];
          return t && vmlPath ? files[resolvePart(vmlPath, t)] : undefined;
        }, !!threadedRel);
      }
      // Threaded comments: the conversations; the classic notes that stand for them (read above) were left out.
      if (threadedRel?.attrs["Target"]) readThreadedComments(xml(resolvePart(path!, threadedRel.attrs["Target"])), sheet, persons, threads, warnings);
      // The legacy drawing holds the boxes of notes, and Excel's older pictures and shapes, which are not read.
      if (child(root, "legacyDrawing") && !commentsRel) warnings.add("Pictures and shapes in the older drawing format are not supported yet and were left out");
      // Pictures in the header and footer: a drawing of their own, with the pictures as its relationships.
      const hf = child(root, "legacyDrawingHF");
      const hfTarget = hf ? relationships.find((r) => r.attrs["Id"] === attr(hf, "id", "r"))?.attrs["Target"] : undefined;
      if (hf && hfTarget) {
        const hfPath = resolvePart(path!, hfTarget);
        const hfRels = childrenNamed(xml(sheetRelsPath(hfPath)), "Relationship");
        let vml: XmlElement | undefined;
        try {
          vml = xml(hfPath);
        } catch {
          warnings.add(`The pictures in the header and footer of "${sheet.name}" could not be read and were left out`);
        }
        const read = readHfPictures(vml, (id) => {
          const t = hfRels.find((r) => r.attrs["Id"] === id)?.attrs["Target"];
          return t ? files[resolvePart(hfPath, t)] : undefined;
        });
        if (Object.keys(read.pictures).length) {
          try {
            const clean = cleanPageSetup({ ...sheet.page, pictures: read.pictures });
            if (clean) sheet.page = clean;
          } catch {
            warnings.add(`The pictures in the header and footer of "${sheet.name}" could not be read and were left out`);
          }
        }
        if (read.skipped) warnings.add("Some pictures in a header or footer are of a kind Pli doesn't keep, and were left out");
      } else if (hf) warnings.add("Pictures in a header or footer could not be found and were left out");
    }
    for (const part of childrenNamed(child(root, "tableParts"), "tablePart")) {
      const rels = xml(sheetRelsPath(path!));
      const target = childrenNamed(rels, "Relationship").find((r) => r.attrs["Id"] === attr(part, "id", "r"))?.attrs["Target"];
      const table = target ? xml(resolvePart(path!, target)) : undefined;
      const read = table ? readTablePart(table, warnings, dxfs) : "its part is missing";
      if (typeof read === "string") warnings.add(`A table was read as plain cells: ${read}`);
      else pendingTables.push({ sheet, table: read.table, columns: read.columns, calculated: read.calculated, partId: read.partId, columnIds: read.columnIds });
    }
    {
      // Excel's named sheet views are Pli's filter views; they name the tables by id, so they are read once the tables are.
      const link = childrenNamed(xml(sheetRelsPath(path!)), "Relationship").find((r) => r.attrs["Type"] === NSV_REL);
      const part = link?.attrs["Target"] ? xml(resolvePart(path!, link.attrs["Target"])) : undefined;
      if (part) pendingViews.push({ sheet, root: part });
    }
    sheets.push(sheet);
    byFileIndex.set(fileAt, sheet);
  }
  readPrintNames(book, (i) => byFileIndex.get(i), warnings);
  if (lostRichCells) warnings.add("Some pictures placed in cells (Excel's Place in Cell) are of a kind Pli doesn't keep, and were left out");
  if (sheets.length === 0) throw new PliError("invalid_document", "That workbook has no sheets");
  // A workbook shows at least one sheet.
  if (sheets.every((s) => s.hidden)) delete sheets[0]!.hidden;

  const definedNames: Record<string, string> = {};
  for (const n of childrenNamed(child(book, "definedNames"), "definedName")) {
    const name = attr(n, "name") ?? "";
    if (!name || name.startsWith("_xlnm") || ((name.startsWith("Slicer_") || name.startsWith("NativeTimeline_")) && /^#N\/A$/i.test(textOf(n).trim())) || attr(n, "localSheetId") !== undefined || attr(n, "hidden") === "1") continue;
    const text = textOf(n).trim();
    if (/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(name) && !parseCell(name) && text) definedNames[name] = stripFuture(text);
  }
  // Tables are kept when they are sound; a table that isn't (a repeated name, a header that isn't text) stays plain cells.
  const bookProtection = readWorkbookAccessExt(book, readWorkbookProtection(child(book, "workbookProtection"), warnings));
  const draft: Workbook = { id: "", type: "workbook", title: "", sheets, ...(Object.keys(definedNames).length ? { names: definedNames } : {}), ...(Object.keys(tableStyles).length ? { tableStyles } : {}), ...(Object.keys(slicerStyles).length ? { slicerStyles } : {}), ...(externalBooksOf(linkedBooks).length ? { externalBooks: externalBooksOf(linkedBooks) } : {}), ...(Object.keys(pivotStyles).length ? { pivotStyles } : {}) };
  const accepted = new Map<number, { table: Table; columnIds: number[] }>();
  for (const { sheet, table, columns, calculated, partId, columnIds } of pendingTables) {
    if (Object.keys(calculated).length) table.calculated = Object.fromEntries(Object.entries(calculated).map(([n, f]) => [n, stripFuture(f)]));
    // The column names the table lists are the names; a header cell that says something else is made to agree.
    const b = parseRange(table.range)!;
    if (table.headerRow !== false)
      columns.forEach((name, i) => {
        const key = cellAddress(b.r1, b.c1 + i);
        if (name !== "" && sheet.cells[key]?.v !== name) sheet.cells[key] = { ...sheet.cells[key], v: name };
      });
    try {
      checkTable(draft, sheet, table);
      (sheet.tables ??= []).push(table);
      accepted.set(partId, { table, columnIds });
    } catch (e) {
      warnings.add(`The table "${table.name}" was read as plain cells: ${(e as Error).message}`);
    }
  }
  for (const p of pendingViews) {
    const views = readNamedSheetViews(p.root, { sheet: p.sheet, tableOf: (id) => { const t = accepted.get(id)?.table; return t && p.sheet.tables?.includes(t) ? t : undefined; }, theme, warnings });
    if (views.length) p.sheet.filterViews = views;
  }
  for (const p of pendingSlicers) {
    const hit = accepted.get(p.tablePart);
    const home = hit && sheets.find((s) => s.tables?.includes(hit.table));
    const column = hit && home ? tableColumns(home, parseRange(hit.table.range)!, hit.table)[hit.columnIds.indexOf(p.columnId)] : undefined;
    if (!hit || !column || hit.table.headerRow === false) {
      warnings.add("A slicer on something that isn't a table Pli could read was left out");
      continue;
    }
    (p.sheet.slicers ??= []).push(slicerOf(p, hit.table.id, column));
  }
  for (const p of pendingTimelines) {
    const hit = [...accepted.values()].find((a) => a.table.name.toLowerCase() === p.table.toLowerCase());
    const home = hit && sheets.find((s) => s.tables?.includes(hit.table));
    if (!hit || !home || hit.table.headerRow === false || !tableColumns(home, parseRange(hit.table.range)!, hit.table).includes(p.timeline.column)) {
      warnings.add("A timeline on something that isn't a table Pli could read was left out");
      continue;
    }
    (p.sheet.timelines ??= []).push(timelineOf(p, hit.table.id));
  }
  // Pivot tables are kept when their source is a range or table Pli can sum up the same way; otherwise their cells stay plain cells.
  const pivotBlocks: DataBlock[] = [];
  if (pendingPivots.length) {
    const custom = new Map<number, string>();
    for (const f of childrenNamed(child(stylesRoot, "numFmts"), "numFmt")) custom.set(Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? "General");
    const formats: Record<number, string> = { ...BUILTIN_FORMATS, ...Object.fromEntries(custom) };
    const here: Workbook = { id: "", type: "workbook", title: "", sheets, ...(Object.keys(definedNames).length ? { names: definedNames } : {}), ...(Object.keys(pivotStyles).length ? { pivotStyles } : {}) };
    const taken = new Set<string>();
    for (const { sheet, def, cache, records, externalPath } of pendingPivots) {
      const extra: PivotReadExtra = { dxfs, ...(records ? { records } : {}), ...(externalPath ? { externalPath } : {}) };
      const read = readPivotTable(def, cache, sheet, here, formats, extra);
      if (extra.block && typeof read !== "string" && !(pivotBlocks.some((b) => b.source.toLowerCase() === extra.block!.source.toLowerCase()))) pivotBlocks.push(extra.block);
      const name = attr(def, "name") ?? "PivotTable";
      if (typeof read === "string") warnings.add(`The pivot table "${name}" was read as plain cells: ${read}`);
      else if (taken.has(read.name.toLowerCase())) warnings.add(`The pivot table "${name}" was read as plain cells: another has its name`);
      else {
        taken.add(read.name.toLowerCase());
        (sheet.pivots ??= []).push(read);
        // Rules the pivot table keeps for "all cells showing" a value follow it from now on.
        const byPriority = rulesByPriority.get(sheet);
        if (byPriority)
          for (const [priority, scope] of readPivotRuleScopes(def, childrenNamed(child(cache, "cacheFields"), "cacheField").map((f) => attr(f, "name") ?? ""), read)) {
            const rule = byPriority.get(priority);
            if (rule && !rule.pivot) rule.pivot = scope;
          }
      }
    }
  }
  // Slicers and timelines go on the pivot tables they filter.
  for (const panel of pendingPivotPanels) {
    const pivot = panel.sheet.pivots?.find((p) => panel.cache.pivots.some((n) => n.toLowerCase() === p.name.toLowerCase()));
    const where = pivot && panel.sheet.pivots!.indexOf(pivot);
    if (!pivot || where === undefined) {
      warnings.add(`A ${panel.cache.kind} on the pivot table "${panel.cache.pivots[0]}" was left out: the pivot table is not on its sheet, or was read as plain cells`);
      continue;
    }
    const next = { ...pivot, ...(pivot.slicers ? { slicers: [...pivot.slicers] } : {}), ...(pivot.timelines ? { timelines: [...pivot.timelines] } : {}) };
    attachPivotPanel(panel, next);
    try {
      panel.sheet.pivots![where] = cleanPivot(next);
    } catch (e) {
      warnings.add(`A ${panel.cache.kind} on the pivot table "${pivot.name}" was left out: ${(e as Error).message}`);
    }
  }
  if (unknown.size) warnings.add(`These functions are not available yet, so their cells show #NAME?: ${[...unknown].sort().join(", ")}`);

  const calcPr = child(book, "calcPr");
  const iterate = attr(calcPr, "iterate");
  const iteration = iterate === "1" || iterate === "true" ? readIteration(calcPr) : undefined;
  const workbook: Workbook = { id: createId("wb_"), type: "workbook", title: "Untitled", sheets, ...(bookProtection ? { protection: bookProtection } : {}), ...(iteration ? { iteration } : {}), ...(ownPalette(theme) ? { themeColors: ownPalette(theme)! } : {}), ...(Object.keys(definedNames).length ? { names: definedNames } : {}), ...(Object.keys(tableStyles).length ? { tableStyles } : {}), ...(Object.keys(slicerStyles).length ? { slicerStyles } : {}), ...(externalBooksOf(linkedBooks).length ? { externalBooks: externalBooksOf(linkedBooks) } : {}), ...(Object.keys(pivotStyles).length ? { pivotStyles } : {}) };
  applyPliPivots(workbook, book, pivotBlocks, (m) => warnings.add(m));
  if (Object.keys(threads).length) workbook.comments = threads;
  return { workbook, warnings: [...warnings], people: [...new Map([...persons.values()].map((p) => [p.id, p])).values()] };
}

function unknownFunctions(f: string): string[] {
  const out: string[] = [];
  try {
    const tree = parseFormula(f);
    // A name bound by LET or LAMBDA can be called (`LET(f,LAMBDA(a,a+1),f(3))`), and isn't a function that is missing.
    const bound = new Set<string>();
    mapNodes(tree, (n) => {
      if (n.t === "call" && n.name.toUpperCase() === "LET") n.args.forEach((a, i) => i % 2 === 0 && i < n.args.length - 1 && a.t === "name" && bound.add(a.name.toUpperCase()));
      if (n.t === "call" && n.name.toUpperCase() === "LAMBDA") n.args.slice(0, -1).forEach((a) => a.t === "name" && bound.add(a.name.toUpperCase()));
      return n;
    });
    mapNodes(tree, (n) => {
      if (n.t === "call" && !getFunction(n.name) && !bound.has(n.name.toUpperCase())) out.push(n.name.toUpperCase());
      return n;
    });
  } catch (e) {
    if (!(e instanceof FormulaSyntaxError)) throw e;
  }
  return out;
}

function fillValue(cell: Cell, type: string | undefined, v: string, strings: string[]): void {
  switch (type) {
    case "s":
      cell.v = strings[Number(v)] ?? "";
      break;
    case "str":
      cell.v = v;
      break;
    case "b":
      cell.v = v === "1" || v === "true";
      break;
    case "e": {
      const code = ERROR_CODES.find((e) => e === v) ?? "#VALUE!";
      cell.e = code as ErrorCode;
      break;
    }
    case "d": {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) cell.v = Math.floor(ms / 86_400_000) + 25569;
      break;
    }
    default: {
      const n = Number(v);
      if (Number.isFinite(n)) cell.v = n;
    }
  }
}

// ---- writing ----

/** Functions newer than Excel 2007, which a file writes with an `_xlfn.` prefix (and, for two of them, `_xlfn._xlws.`). */
const FUTURE_FUNCTIONS = new Set(
  (
    "ACOT ACOTH ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT " +
    "CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT " +
    "FLOOR.MATH FLOOR.PRECISE FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS GROUPBY HSTACK HYPGEOM.DIST IFNA IFS IMAGE ISFORMULA ISO.CEILING ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP " +
    "MAXIFS MINIFS MODE.MULT MODE.SNGL NEGBINOM.DIST NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTOF PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI PIVOTBY " +
    "POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE REGEXEXTRACT REGEXREPLACE REGEXTEST RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT " +
    "T.INV T.INV.2T TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR ISOMITTED FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN"
  ).split(" "),
);
/** Of those, the two that live in a further namespace. */
const WORKSHEET_FUNCTIONS = new Set(["FILTER", "SORT"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");

const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/** A font's `name` and, right after it as Excel writes them, the `family` hint for computers without the font. */
const fontNameXml = (name: string): string => {
  const written = fileFont(name);
  return `<name val="${escAttr(written)}"/><family val="${familyHint(written)}"/>`;
};

/** Names given by LET and the parameters of LAMBDA are written with `_xlpm.` in front, wherever they are used inside. */
function markParameters(node: Node, names: ReadonlySet<string>): Node {
  switch (node.t) {
    case "name":
      return names.has(node.name.toLowerCase()) ? { ...node, name: "_xlpm." + node.name } : node;
    case "call": {
      const upper = node.name.toUpperCase();
      if (upper === "LET" || upper === "LAMBDA") {
        const params = new Set(names);
        const declared = upper === "LET" ? node.args.filter((_, i) => i % 2 === 0 && i < node.args.length - 1) : node.args.slice(0, -1);
        for (const d of declared) {
          if (d.t === "name") params.add(d.name.toLowerCase());
          else if (d.t === "tref" && d.table === undefined && d.from !== undefined) params.add(d.from.toLowerCase());
        }
        return {
          ...node,
          args: node.args.map((a, i) => {
            const isDeclaration = upper === "LET" ? i % 2 === 0 && i < node.args.length - 1 : i < node.args.length - 1;
            if (isDeclaration && a.t === "name") return { ...a, name: "_xlpm." + a.name };
            // An optional parameter, `[x]`, is declared `_xlop.x` (and used as `_xlpm.x`).
            if (upper === "LAMBDA" && isDeclaration && a.t === "tref" && a.table === undefined && a.from !== undefined) return { t: "name", name: `_xlop.${a.from}` };
            return markParameters(a, params);
          }),
        };
      }
      // A parameter holding a function is called by its name.
      return { ...node, name: names.has(node.name.toLowerCase()) ? "_xlpm." + node.name : node.name, args: node.args.map((a) => markParameters(a, names)) };
    }
    case "unary":
    case "percent":
    case "paren":
      return { ...node, arg: markParameters(node.arg, names) };
    case "binary":
      return { ...node, left: markParameters(node.left, names), right: markParameters(node.right, names) };
    case "array":
      return { ...node, rows: node.rows.map((r) => r.map((c) => markParameters(c, names))) };
    default:
      return node;
  }
}

function fileFormula(f: string, table?: string): string {
  try {
    const tree = markParameters(parseFormula(f), new Set());
    return printFormula(
      mapNodes(tree, (n) => {
        // Inside a table, a reference may leave out the table's name; a file always says it.
        if (n.t === "tref" && n.table === undefined && table) return { ...n, table };
        // Excel keeps no table definitions of another workbook, so a table of one is written as the cells it stands for (`[1]Sheet1!$C$2:$C$9`).
        if (n.t === "tref" && n.sheet?.startsWith("[") && writeTableCells && writeLinks) {
          const cells = writeTableCells(n);
          const at = cells ? writeLinks(cells.book) : 0;
          if (!cells || !at) return { t: "err", v: "#REF!" };
          const pt = (col: number, row: number) => ({ col, row, colAbs: true, rowAbs: true });
          const { r1, c1, r2, c2 } = cells.bounds;
          return { t: "ref", sheet: `[${at}]${cells.sheet}`, a: pt(c1, r1), ...(r1 === r2 && c1 === c2 ? {} : { b: pt(c2, r2) }) };
        }
        // A sheet of another workbook is `[1]Sheet1` in a file.
        if (n.t === "ref" && n.sheet !== undefined && n.sheet.startsWith("[") && writeLinks) {
          const split = splitExternalSheet(n.sheet);
          const at = split ? writeLinks(split.book) : 0;
          if (split && at) return { ...n, sheet: `[${at}]${split.sheet}` };
        }
        // A function named on its own, as an argument (`SUM` in `GROUPBY`, `PERCENTOF` in `BYROW`), is `_xleta.SUM` in a file.
        if (n.t === "name" && getFunction(n.name)) return { ...n, name: "_xleta." + n.name.toUpperCase() };
        if (n.t !== "call") return n;
        const upper = n.name.toUpperCase();
        if (WORKSHEET_FUNCTIONS.has(upper)) return { ...n, name: "_xlfn._xlws." + upper };
        return FUTURE_FUNCTIONS.has(upper) ? { ...n, name: "_xlfn." + upper } : n;
      }),
      true,
    )
      .replace(/'(\[\d+\][A-Za-z_][A-Za-z0-9_.]*)'!/g, "$1!");
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return f;
    throw e;
  }
}

/** Collects the number formats, fonts and fills of the cells into the tables the file format wants. */
class Styles {
  readonly fmts = new Map<string, number>();
  readonly fonts: string[] = [];
  readonly fills: string[] = [];
  readonly borders: string[] = [borderXml(undefined)];
  readonly dxfs: string[] = [];
  /** The table styles of your own, which the stylesheet lists after the looks they use. */
  tableStyleDefs: Record<string, TableStyleDef> | undefined;
  /** The slicer styles of your own, which the stylesheet lists as table styles with an extension for their buttons. */
  slicerStyleDefs: Record<string, SlicerStyleDef> | undefined;
  pivotStyleDefs: Record<string, PivotStyleDef> | undefined;
  readonly xfs: string[] = [];
  readonly index = new Map<string, number>();
  constructor() {
    this.fonts.push(this.fontXml({}));
    this.fills.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>');
    this.index.set("{}", 0);
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  }

  /** Whether any cell used Excel's "Hyperlink" or "Followed Hyperlink" style, which the stylesheet then names. */
  linkStyles = false;

  private fontXml(s: CellStyle, theme?: number): string {
    const color = s.color ? `<color rgb="FF${s.color.slice(1).toUpperCase()}"/>` : theme !== undefined ? `<color theme="${theme}"/>` : "";
    return `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}${s.strike ? "<strike/>" : ""}${s.underline ? "<u/>" : ""}<sz val="${s.fontSize ?? 11}"/>${color}${fontNameXml(s.fontFamily ?? "Calibri")}</font>`;
  }

  /** The number of a number format in the stylesheet (Excel's own for the common ones). */
  numFmtId(fmt: string | undefined): number {
    if (!fmt) return 0;
    const builtin = Object.entries(BUILTIN_FORMATS).find(([, code]) => code === fmt);
    if (builtin) return Number(builtin[0]);
    let id = this.fmts.get(fmt);
    if (id === undefined) this.fmts.set(fmt, (id = 164 + this.fmts.size));
    return id;
  }

  /** The look of Excel's "Hyperlink" (theme colour 10) and "Followed Hyperlink" (11) cell styles: underlined text in the theme's colour. */
  private linkFontId(theme: 10 | 11): number {
    const xml = this.fontXml({ underline: true }, theme);
    const at = this.fonts.indexOf(xml);
    return at >= 0 ? at : this.fonts.push(xml) - 1;
  }

  /** `link` is the theme colour (10 or 11) a link's text takes from the theme when it has none of its own: the cell then uses the named cell style of that name. */
  xf(fmt: string | undefined, s: CellStyle | undefined, link?: 10 | 11): number {
    const key = JSON.stringify({ fmt, s, link });
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    const numFmtId = this.numFmtId(fmt);
    let fontId = 0;
    if (link) this.linkStyles = true;
    if (s && (s.bold || s.italic || s.underline || s.strike || s.color || s.fontSize || s.fontFamily)) {
      const xml = this.fontXml(s, link);
      fontId = this.fonts.indexOf(xml);
      if (fontId < 0) fontId = this.fonts.push(xml) - 1;
    }
    let fillId = 0;
    if (s?.fill) {
      const xml = `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`;
      fillId = this.fills.indexOf(xml);
      if (fillId < 0) fillId = this.fills.push(xml) - 1;
    }
    let borderId = 0;
    if (s?.border) {
      const xml = borderXml(s.border);
      borderId = this.borders.indexOf(xml);
      if (borderId < 0) borderId = this.borders.push(xml) - 1;
    }
    const align =
      s && (s.align || s.vAlign || s.wrap || s.indent)
        ? `<alignment${s.align || s.indent ? ` horizontal="${s.align ?? "left"}"` : ""}${s.indent ? ` indent="${s.indent}"` : ""}${s.vAlign ? ` vertical="${s.vAlign === "middle" ? "center" : s.vAlign}"` : ""}${s.wrap ? ' wrapText="1"' : ""}/>`
        : "";
    const protect = cellProtectionXml(s?.locked, s?.hideFormula);
    const children = align + protect;
    const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="${link ? (link === 10 ? 1 : 2) : 0}"${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1"' : ""}${protect ? ' applyProtection="1"' : ""}${children ? `>${children}</xf>` : "/>"}`;
    const id = this.xfs.push(xml) - 1;
    this.index.set(key, id);
    return id;
  }

  /** The position of a conditional format's style in the table of those. */
  /** A style for a colour filter: a look, "no fill", or the automatic font colour. */
  filterDxf(look: ConditionalStyle | "nofill" | "autofont"): number {
    if (typeof look !== "string") return this.dxf(look);
    const xml = look === "nofill" ? '<dxf><fill><patternFill patternType="none"/></fill></dxf>' : '<dxf><font><color auto="1"/></font></dxf>';
    const at = this.dxfs.indexOf(xml);
    return at >= 0 ? at : this.dxfs.push(xml) - 1;
  }

  dxf(style: TableStylePart): number {
    const builtin = style.fmt ? Object.entries(BUILTIN_FORMATS).find(([, code]) => code === style.fmt) : undefined;
    const xml = dxfXml(style, builtin ? Number(builtin[0]) : 200 + this.dxfs.length);
    const at = this.dxfs.indexOf(xml);
    return at >= 0 ? at : this.dxfs.push(xml) - 1;
  }

  xml(): string {
    // The two link styles Excel names: their fonts are underlined text in the theme's hyperlink colours.
    const linkFonts = this.linkStyles ? [this.linkFontId(10), this.linkFontId(11)] : [];
    const slicer = slicerStylesXml(this.slicerStyleDefs, (st) => this.dxf(st));
    const pivotStyles = this.pivotStyleDefs && Object.keys(this.pivotStyleDefs).length ? { count: Object.keys(this.pivotStyleDefs).length, xml: (dxf: (st: TableStylePart) => number) => pivotStyleElements(this.pivotStyleDefs, dxf) } : undefined;
    const tableStyles = (this.tableStyleDefs && Object.keys(this.tableStyleDefs).length) || slicer.tableStyles.length || pivotStyles ? tableStylesXml(this.tableStyleDefs ?? {}, (st) => this.dxf(st), slicer.tableStyles, pivotStyles) : "";
    const numFmts = this.fmts.size ? `<numFmts count="${this.fmts.size}">${[...this.fmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escAttr(code)}"/>`).join("")}</numFmts>` : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      `<cellStyleXfs count="${1 + linkFonts.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>${linkFonts.map((f) => `<xf numFmtId="0" fontId="${f}" fillId="0" borderId="0" applyNumberFormat="0" applyFill="0" applyBorder="0" applyAlignment="0" applyProtection="0"/>`).join("")}</cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      (linkFonts.length ? `<cellStyles count="3"><cellStyle name="Followed Hyperlink" xfId="2" builtinId="9"/><cellStyle name="Hyperlink" xfId="1" builtinId="8"/><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` : `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`) +
      `${this.dxfs.length ? `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>` : ""}${tableStyles}${slicer.ext}</styleSheet>`
    );
  }
}

function mergeXml(sheet: Sheet): string {
  // Excel doesn't allow a merge that touches a table (it repairs the file), nor one of a single cell.
  const inTable = (r: string) => (sheet.tables ?? []).some((t) => overlaps(parseRange(t.range)!, parseRange(r)!));
  const merges = (sheet.merges ?? []).filter((r) => r.includes(":") && !inTable(r));
  if (!merges.length) return "";
  return `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>`;
}

function filterXml(sheet: Sheet, dxf: (look: FilterDxf) => number): string {
  if (!sheet.filter) return "";
  // A filter view (Excel's named sheet view) finds the sheet's filter by this uid.
  const uid = sheet.filterViews?.length ? ` xr:uid="${sheetFilterUid(sheet)}"` : "";
  const r = parseRange(sheet.filter.range)!;
  const cols = Object.entries(sheet.filter.columns ?? {})
    .sort((a, b) => colNumber(a[0]) - colNumber(b[0]))
    .map(([letters, criterion]) => filterColumnXml(colNumber(letters) - r.c1, criterion, dxf))
    .join("");
  return `<autoFilter ref="${sheet.filter.range}"${uid}>${cols}</autoFilter>`;
}

/** Dropdowns as Excel's data validation lists: the choices as a list, and whether anything else is refused. Checkboxes and badges have no counterpart in the file and keep only their value. */
function validationXml(sheet: Sheet): string {
  const groups = dropdownGroups(sheet);
  const fromRules = validationRulesXml(sheet, (f) => fileFormula(f), writeBook ? (rule) => externalRuleXml(writeBook!, rule, (f) => fileFormula(f)) : undefined);
  if (groups.length === 0 && fromRules.length === 0) return "";
  // A dropdown that takes several choices is written as a list that never complains: Excel would refuse "a, b" otherwise (Pli's extension keeps the rest).
  const items = groups.map(({ values, strict, multiple, cells }) => {
    const refuses = strict && !multiple;
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${refuses ? 1 : 0}"${refuses ? "" : ' errorStyle="information"'} sqref="${cells.join(" ")}"><formula1>"${escAttr(values.join(","))}"</formula1></dataValidation>`;
  });
  items.push(...fromRules);
  return `<dataValidations count="${items.length}">${items.join("")}</dataValidations>`;
}

function cachedValue(v: ReturnType<Calculator["value"]>): { t?: string; v: string } | null {
  if (v === null) return null;
  if (isError(v)) return { t: "e", v: (v as ErrorValue).error };
  if (typeof v === "number") return { v: String(v) };
  if (typeof v === "boolean") return { t: "b", v: v ? "1" : "0" };
  return { t: "str", v: esc(v) };
}

export interface XlsxWriteOptions {
  /** The current date and time (a serial number) for formulas that use it. Defaults to the clock. */
  now?: () => number;
  /**
   * What to do with font names. `"keep"` (the default) writes every name as the workbook has it (`Lora`), with a family hint
   * beside it so a computer without the font picks a similar one. `"office"` writes the nearest font Office has for each
   * family Office doesn't ship (Lora becomes Georgia), for files that must look right on any computer.
   */
  fonts?: XlsxFontMode;
  /** Names the authors of comments (their ids are the comments' `author`), for the people list of an .xlsx file. Without it the id is the name. */
  users?: (id: string) => { name: string } | undefined;
  /** Comment threads kept outside the workbook (in your own `CommentStore`): the ones whose cell is in the workbook are written as the file's threaded comments. */
  threads?: readonly import("@pli.dev/core").Thread<import("./model").CellAnchor>[];
}

/** The workbook as an `.xlsx` file. Formulas are written with the values they work out to, and Excel works them out again on opening. */
export function toXlsx(wb: Workbook, options: XlsxWriteOptions = {}): Uint8Array {
  setXlsxFontMode(options.fonts);
  try {
    return writeXlsx(wb, options);
  } finally {
    setXlsxFontMode("keep");
  }
}

function writeXlsx(wb: Workbook, options: XlsxWriteOptions): Uint8Array {
  wb = withoutGhosts(wb);
  if (options.threads?.length) wb = { ...wb, comments: { ...wb.comments, ...Object.fromEntries(options.threads.map((t) => [t.id, t])) } };
  writeLinks = linkedBooksOf(wb).index;
  writeBook = wb;
  writeTableCells = (ref) => {
    const found = findExternalTable(wb, ref);
    const bounds = found ? externalTableBounds(ref, found.table) : null;
    return found && bounds ? { book: found.book.name, sheet: found.table.sheet, bounds } : null;
  };
  const calc = new Calculator(wb, options.now ? { now: options.now } : {});
  const styles = new Styles();
  styles.tableStyleDefs = wb.tableStyles;
  styles.slicerStyleDefs = wb.slicerStyles;
  styles.pivotStyleDefs = wb.pivotStyles;
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sst = (s: string) => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      stringIndex.set(s, i);
    }
    return i;
  };

  // Charts: each sheet that has some gets a drawing, and each chart is a part of its own, numbered across the workbook.
  const chartFiles: Record<string, Uint8Array> = {};
  const drawingOf = new Map<number, number>();
  const chartTypes: string[] = [];
  /** What each sheet points at besides itself: its drawing, its tables. */
  const sheetRels = new Map<number, string[]>();
  const tableParts = new Map<number, string>();
  let nextChart = 1;
  let nextDrawing = 1;
  let nextMedia = 1;
  const imageTypes = new Set<MediaType>();
  const read = (sheet: string, address: string) => ({ value: calc.value(sheet, address), text: calc.display(sheet, address).text });
  // Table parts are numbered across the workbook, in the order the sheets list them; a slicer's cache points at one by its number.
  const tableNumber = new Map<string, number>();
  for (const sheet of wb.sheets) for (const table of sheet.tables ?? []) tableNumber.set(table.id, tableNumber.size + 1);
  const slicerNames = new Set<string>();
  const slicerFiles = new Map<number, SlicerFiles>();
  // Pivot tables are written first: their slicers and timelines point into them, and a pivot table's number is its cache's.
  const pivotNow = options.now ? options.now() : Date.now() / 86_400_000 + 25569;
  const pivotWritten = new Map<string, { k: number; parts: NonNullable<ReturnType<typeof pivotParts>> }>();
  for (const sheet of wb.sheets) {
    for (const pivot of sheet.pivots ?? []) {
      const parts = pivotParts(wb, sheet, pivot, pivotWritten.size + 1, (sh, a) => calc.value(sh.id, a), (f) => styles.numFmtId(f), pivotNow, (st) => styles.dxf(st));
      if (parts) pivotWritten.set(pivot.id, { k: pivotWritten.size + 1, parts });
    }
  }
  const writtenInfo = new Map<string, WrittenPivot>([...pivotWritten].map(([id, w]) => [id, { k: w.k, info: w.parts.info }]));
  const timelineFiles = new Map<number, { entries: string; caches: { name: string; xml: string }[] }>();
  wb.sheets.forEach((sheet, i) => {
    const slicers = sheetSlicerFiles(wb, sheet, (sheet.charts?.length ?? 0) + 2, (id) => tableNumber.get(id), slicerNames);
    if (slicers) slicerFiles.set(i, slicers);
    const panels = pivotPanelFiles(sheet, i + 1, 1000, writtenInfo, slicerNames);
    if (panels) {
      if (panels.slicerEntries) {
        const mine = slicerFiles.get(i);
        if (mine) {
          mine.part = mine.part.replace("</slicers>", `${panels.slicerEntries}</slicers>`);
          mine.caches.push(...panels.slicerCaches);
        } else slicerFiles.set(i, { anchors: "", part: slicersPartXml(panels.slicerEntries), caches: panels.slicerCaches });
      }
      if (panels.timelineEntries) timelineFiles.set(i, { entries: panels.timelineEntries, caches: panels.timelineCaches });
    }
    const pictures = sheetImageFiles(sheet, (sheet.charts?.length ?? 0) + 1, nextMedia);
    const parts = sheetChartParts(wb, sheet, nextChart, read, (slicers?.anchors ?? "") + (panels?.anchors ?? "") + (pictures?.anchors ?? ""), pictures?.rels ?? []);
    if (!parts) return;
    for (const m of pictures?.media ?? []) {
      chartFiles[`xl/media/${m.name}`] = m.bytes;
      imageTypes.add(m.type);
    }
    nextMedia += pictures?.media.length ?? 0;
    const d = nextDrawing++;
    drawingOf.set(i, d);
    chartFiles[`xl/drawings/drawing${d}.xml`] = strToU8(parts.drawing);
    chartFiles[`xl/drawings/_rels/drawing${d}.xml.rels`] = strToU8(parts.rels);
    sheetRels.set(i, [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${d}.xml"/>`]);
    chartTypes.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    parts.charts.forEach((xml, k) => {
      const part = parts.partNames[k]!;
      chartFiles[`xl/charts/${part}`] = strToU8(xml);
      chartTypes.push(`<Override PartName="/xl/charts/${part}" ContentType="${part.startsWith("chartEx") ? "application/vnd.ms-office.chartex+xml" : "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"}"/>`);
      if (part.startsWith("chartEx")) {
        // Excel for Mac wants a style part and a colour part with every chart of Excel 2016's kinds, or it drops the drawing.
        const n = part.replace(/\D/g, "");
        chartFiles[`xl/charts/style${n}.xml`] = strToU8(CHARTEX_STYLE);
        chartFiles[`xl/charts/colors${n}.xml`] = strToU8(CHARTEX_COLORS);
        chartFiles[`xl/charts/_rels/${part}.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${CHARTEX_COLORS_REL}" Target="colors${n}.xml"/><Relationship Id="rId1" Type="${CHARTEX_STYLE_REL}" Target="style${n}.xml"/></Relationships>`);
        chartTypes.push(`<Override PartName="/xl/charts/style${n}.xml" ContentType="${CHARTEX_STYLE_TYPE}"/>`, `<Override PartName="/xl/charts/colors${n}.xml" ContentType="${CHARTEX_COLORS_TYPE}"/>`);
      }
      nextChart++;
    });
  });

  // Slicers: a part for each sheet that has some, and a cache part for each slicer, which the workbook lists.
  const slicerRid = new Map<number, string>();
  const cacheRels: { rid: string; name: string }[] = [];
  let nextSlicerPart = 1;
  let nextCache = 1;
  for (const [i, files] of slicerFiles) {
    const rels = sheetRels.get(i) ?? [];
    const rid = `rId${rels.length + 1}`;
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.microsoft.com/office/2007/relationships/slicer" Target="../slicers/slicer${nextSlicerPart}.xml"/>`);
    sheetRels.set(i, rels);
    slicerRid.set(i, rid);
    chartFiles[`xl/slicers/slicer${nextSlicerPart}.xml`] = strToU8(files.part);
    chartTypes.push(`<Override PartName="/xl/slicers/slicer${nextSlicerPart}.xml" ContentType="application/vnd.ms-excel.slicer+xml"/>`);
    nextSlicerPart++;
    for (const cache of files.caches) {
      chartFiles[`xl/slicerCaches/slicerCache${nextCache}.xml`] = strToU8(cache.xml);
      chartTypes.push(`<Override PartName="/xl/slicerCaches/slicerCache${nextCache}.xml" ContentType="application/vnd.ms-excel.slicerCache+xml"/>`);
      cacheRels.push({ rid: `rId${wb.sheets.length + 2 + nextCache}`, name: cache.name });
      nextCache++;
    }
  }

  // Timelines on pivot tables: a part for each sheet that has some, and a cache part for each timeline, which the workbook lists.
  const timelineRid = new Map<number, string>();
  const timelineCacheRels: { rid: string; name: string }[] = [];
  let nextTimelinePart = 1;
  for (const [i, files] of timelineFiles) {
    const rels = sheetRels.get(i) ?? [];
    const rid = `rId${rels.length + 1}`;
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.microsoft.com/office/2011/relationships/timeline" Target="../timelines/timeline${nextTimelinePart}.xml"/>`);
    sheetRels.set(i, rels);
    timelineRid.set(i, rid);
    chartFiles[`xl/timelines/timeline${nextTimelinePart}.xml`] = strToU8(timelinesPartXml(files.entries));
    chartTypes.push(`<Override PartName="/xl/timelines/timeline${nextTimelinePart}.xml" ContentType="application/vnd.ms-excel.timeline+xml"/>`);
    nextTimelinePart++;
    for (const cache of files.caches) {
      const c = timelineCacheRels.length + 1;
      chartFiles[`xl/timelineCaches/timelineCache${c}.xml`] = strToU8(cache.xml);
      chartTypes.push(`<Override PartName="/xl/timelineCaches/timelineCache${c}.xml" ContentType="application/vnd.ms-excel.timelineCache+xml"/>`);
      timelineCacheRels.push({ rid: `rIdTimelineCache${c}`, name: cache.name });
    }
  }

  // Tables: each is a part of its own, numbered across the workbook, and the sheet lists them.
  wb.sheets.forEach((sheet, i) => {
    if (!sheet.tables?.length) return;
    const rels = sheetRels.get(i) ?? [];
    const ids: string[] = [];
    for (const table of sheet.tables) {
      const n = tableNumber.get(table.id)!;
      chartFiles[`xl/tables/table${n}.xml`] = strToU8(tablePartXml(sheet, table, n, (f) => fileFormula(f, table.name), (look) => styles.filterDxf(look), sheet.filterViews?.length ? tableFilterUid(table) : undefined));
      chartTypes.push(`<Override PartName="/xl/tables/table${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
      const id = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${n}.xml"/>`);
      ids.push(id);
    }
    sheetRels.set(i, rels);
    tableParts.set(i, `<tableParts count="${ids.length}">${ids.map((id) => `<tablePart r:id="${id}"/>`).join("")}</tableParts>`);
  });
  // Links outside the workbook are relationships of the sheet; notes are a comments part and a drawing for their boxes.
  const hyperlinks = new Map<number, string>();
  const legacy = new Map<number, string>();
  const pivotCaches: number[] = [];
  /** The pivot tables written as pivot tables (the rules that follow them are marked as theirs). */
  const pivotsKept = new Set<string>();
  let nextNotes = 1;
  let nextThreaded = 1;
  const people = new PeopleList(options.users);
  wb.sheets.forEach((sheet, i) => {
    const rels = sheetRels.get(i) ?? [];
    const external = new Map<string, string>();
    const xml = hyperlinksXml(sheet, (target) => {
      let id = external.get(target);
      if (!id) {
        id = `rId${rels.length + 1}`;
        external.set(target, id);
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escAttr(target)}" TargetMode="External"/>`);
      }
      return id;
    });
    if (xml) hyperlinks.set(i, xml);
    // A thread is a part of its own, and a classic note that says so for older versions of Excel.
    const threaded = threadedCommentsXml(wb, sheet, people);
    const notes = notesParts(withPlaceholders(wb, sheet, people), i + 1, nextMedia);
    if (threaded) {
      const t = nextThreaded++;
      chartFiles[`xl/threadedComments/threadedComment${t}.xml`] = strToU8(threaded);
      chartTypes.push(`<Override PartName="/xl/threadedComments/threadedComment${t}.xml" ContentType="${THREADED_TYPE}"/>`);
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${THREADED_REL}" Target="../threadedComments/threadedComment${t}.xml"/>`);
    }
    if (notes) {
      const n = nextNotes++;
      chartFiles[`xl/comments${n}.xml`] = strToU8(notes.comments);
      chartFiles[`xl/drawings/vmlDrawing${n}.vml`] = strToU8(notes.drawing);
      if (notes.rels) chartFiles[`xl/drawings/_rels/vmlDrawing${n}.vml.rels`] = strToU8(notes.rels);
      for (const m of notes.media) {
        chartFiles[`xl/media/${m.name}`] = m.bytes;
        imageTypes.add(m.type);
      }
      nextMedia += notes.media.length;
      chartTypes.push(`<Override PartName="/xl/comments${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${n}.xml"/>`);
      const id = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${n}.vml"/>`);
      legacy.set(i, `<legacyDrawing r:id="${id}"/>`);
    }
    // Pictures in the header and footer: a drawing of their own after the notes' one, and the picture files it points at.
    // Its shape numbers are a block of their own (after the sheets' notes blocks): a shape number may be used only once in a sheet.
    const hfFiles = hfPictureFiles(sheet, nextMedia, wb.sheets.length + i + 1);
    if (hfFiles) {
      chartFiles[`xl/drawings/vmlDrawingHF${i + 1}.vml`] = strToU8(hfFiles.drawing);
      chartFiles[`xl/drawings/_rels/vmlDrawingHF${i + 1}.vml.rels`] = strToU8(hfFiles.rels);
      for (const m of hfFiles.media) {
        chartFiles[`xl/media/${m.name}`] = m.bytes;
        imageTypes.add(m.type);
      }
      nextMedia += hfFiles.media.length;
      const id = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawingHF${i + 1}.vml"/>`);
      legacy.set(i, `${legacy.get(i) ?? ""}<legacyDrawingHF r:id="${id}"/>`);
    }
    // Pivot tables: a part for the table and one for where its records come from, numbered together.
    for (const pivot of sheet.pivots ?? []) {
      const done = pivotWritten.get(pivot.id);
      if (!done) continue;
      pivotsKept.add(pivot.id);
      const parts = done.parts;
      const k = pivotCaches.push(pivotCaches.length + 1);
      chartFiles[`xl/pivotCache/pivotCacheDefinition${k}.xml`] = strToU8(parts.cache);
      chartFiles[`xl/pivotTables/pivotTable${k}.xml`] = strToU8(parts.table);
      if (parts.records && parts.cacheRels) {
        // A pivot table over another workbook keeps the rows it read, and names the file in the cache's relationships.
        chartFiles[`xl/pivotCache/pivotCacheRecords${k}.xml`] = strToU8(parts.records);
        chartFiles[`xl/pivotCache/_rels/pivotCacheDefinition${k}.xml.rels`] = strToU8(parts.cacheRels);
        chartTypes.push(`<Override PartName="/xl/pivotCache/pivotCacheRecords${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>`);
      }
      chartFiles[`xl/pivotTables/_rels/pivotTable${k}.xml.rels`] = strToU8(parts.rels);
      chartTypes.push(`<Override PartName="/xl/pivotCache/pivotCacheDefinition${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>`);
      chartTypes.push(`<Override PartName="/xl/pivotTables/pivotTable${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>`);
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable${k}.xml"/>`);
    }
    if (rels.length) sheetRels.set(i, rels);
  });
  // Filter views: Excel's named sheet views, a part for each sheet that has some.
  let nextViews = 1;
  wb.sheets.forEach((sheet, i) => {
    const part = namedSheetViewsXml(sheet, tableNumber);
    if (!part) return;
    const k = nextViews++;
    const rels = sheetRels.get(i) ?? [];
    chartFiles[`xl/namedSheetViews/namedSheetView${k}.xml`] = strToU8(part);
    chartTypes.push(`<Override PartName="/xl/namedSheetViews/namedSheetView${k}.xml" ContentType="${NSV_CONTENT_TYPE}"/>`);
    rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${NSV_REL}" Target="../namedSheetViews/namedSheetView${k}.xml"/>`);
    sheetRels.set(i, rels);
  });
  for (const [i, rels] of sheetRels) {
    chartFiles[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  }

  // Pictures that are the content of cells go in Excel's rich value parts; each cell holds the number of its picture (`vm`).
  const richList: RichPicture[] = [];
  wb.sheets.forEach((sheet, i) => {
    for (const [address, cell] of Object.entries(sheet.cells)) if (cell.picture) richList.push({ key: `${i}:${address}`, picture: cell.picture });
  });
  const rich = richDataFiles(richList, nextMedia);
  if (rich) {
    Object.assign(chartFiles, rich.files);
    for (const m of rich.media) imageTypes.add(m.type);
    nextMedia += rich.media.length;
  }

  const sheetXml = wb.sheets.map((sheet, sheetIndex) => {
    const { rules: cfRules, ext: cfOnly } = conditionalXml(sheet, (st) => styles.dxf(st), fileFormula, undefined, pivotsKept);
    const extras = [cfOnly.replace(/^<extLst>|<\/extLst>$/g, ""), slicerRid.has(sheetIndex) ? slicerListExt(slicerRid.get(sheetIndex)!) : "", sparklineExtXml(sheet), validationExtensionXml(wb, sheet), timelinesExt(wb, sheet), accessExtXml(sheet), timelineRid.has(sheetIndex) ? timelineListExt(timelineRid.get(sheetIndex)!) : ""].join("");
    const cfExt = extras ? `<extLst>${extras}</extLst>` : "";
    const lockXf = (locked: boolean, hidden: boolean) => styles.xf(undefined, locked && !hidden ? undefined : { ...(locked ? {} : { locked: false }), ...(hidden ? { hideFormula: true } : {}) });
    const byRow = new Map<number, { col: number; xml: string }[]>();
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const pos = parseCell(address)!;
      const look = linkLook(cell);
      const s = styles.xf(cell.fmt, styleWithLock(sheet, address, cell, look.style), look.theme);
      const attrs = `r="${address}"${s ? ` s="${s}"` : ""}`;
      let xml: string;
      if (cell.f !== undefined) {
        const cached = cachedValue(calc.value(sheet.id, address));
        // A formula whose results fill other cells is an array formula over the cells it fills.
        const spill = calc.spillRange(sheet.id, pos.row, pos.col);
        const array = spill && (spill.r2 > spill.r1 || spill.c2 > spill.c1) ? ` t="array" ref="${rangeAddress(spill)}"` : "";
        xml = `<c ${attrs}${cached?.t ? ` t="${cached.t}"` : ""}><f${array}>${esc(fileFormula(cell.f, tableAt(sheet, pos.row, pos.col)?.table.name))}</f>${cached ? `<v>${cached.v}</v>` : ""}</c>`;
        if (array) {
          for (let r = spill!.r1; r <= spill!.r2; r++)
            for (let c = spill!.c1; c <= spill!.c2; c++) {
              if (r === pos.row && c === pos.col) continue;
              const v = cachedValue(calc.value(sheet.id, cellAddress(r, c)));
              if (!v) continue;
              let rowList = byRow.get(r);
              if (!rowList) byRow.set(r, (rowList = []));
              rowList.push({ col: c, xml: `<c r="${cellAddress(r, c)}"${v.t ? ` t="${v.t}"` : ""}><v>${v.v}</v></c>` });
            }
        }
      } else if (cell.picture && rich?.vm.has(`${sheetIndex}:${address}`)) xml = `<c ${attrs} t="e" vm="${rich.vm.get(`${sheetIndex}:${address}`)}"><v>#VALUE!</v></c>`;
      else if (cell.e !== undefined) xml = `<c ${attrs} t="e"><v>${cell.e}</v></c>`;
      else if (typeof cell.v === "number") xml = `<c ${attrs}><v>${cell.v}</v></c>`;
      else if (typeof cell.v === "boolean") xml = `<c ${attrs} t="b"><v>${cell.v ? 1 : 0}</v></c>`;
      else if (typeof cell.v === "string") xml = `<c ${attrs} t="s"><v>${sst(cell.v)}</v></c>`;
      else xml = `<c ${attrs}/>`;
      let list = byRow.get(pos.row);
      if (!list) byRow.set(pos.row, (list = []));
      list.push({ col: pos.col, xml });
    }
    for (const key of Object.keys(sheet.rows ?? {})) if (!byRow.has(Number(key))) byRow.set(Number(key), []);
    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, cells]) => {
        const dim = sheet.rows?.[String(r)];
        const attrs = `r="${r}"${dim?.size !== undefined ? ` ht="${dim.size}" customHeight="1"` : ""}${dim?.hidden ? ' hidden="1"' : ""}${dim?.level ? ` outlineLevel="${dim.level}"` : ""}${dim?.collapsed ? ' collapsed="1"' : ""}${rowLockAttrs(dim, lockXf, sheet)}`;
        return `<row ${attrs}>${cells.sort((a, b) => a.col - b.col).map((c) => c.xml).join("")}</row>`;
      })
      .join("");
    const cols = colsXml(sheet, (d) => `width="${d.size ?? 8.43}"${d.size !== undefined ? ' customWidth="1"' : ""}${d.hidden ? ' hidden="1"' : ""}${d.level ? ` outlineLevel="${d.level}"` : ""}${d.collapsed ? ' collapsed="1"' : ""}`, lockXf);
    const f = sheet.frozen;
    const pane = f
      ? `<pane${f.cols ? ` xSplit="${f.cols}"` : ""}${f.rows ? ` ySplit="${f.rows}"` : ""} topLeftCell="${cellAddress(f.rows + 1, f.cols + 1)}" activePane="${f.rows && f.cols ? "bottomRight" : f.rows ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
    const tabColor = sheet.tabColor ? `<tabColor rgb="FF${sheet.tabColor.slice(1).toUpperCase()}"/>` : "";
    const outlinePr = sheet.outline ? `<outlinePr${sheet.outline.summaryAbove ? ' summaryBelow="0"' : ""}${sheet.outline.summaryLeft ? ' summaryRight="0"' : ""}/>` : "";
    const rowDepth = deepestLevel(sheet, "row");
    const colDepth = deepestLevel(sheet, "col");
    const tab = tabColor || outlinePr || pageSetUpPrXml(sheet.page) ? `<sheetPr>${tabColor}${outlinePr}${pageSetUpPrXml(sheet.page)}</sheetPr>` : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"${sheet.filterViews?.length ? ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"' : ""}>${tab}` +
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"${rowDepth ? ` outlineLevelRow="${rowDepth}"` : ""}${colDepth ? ` outlineLevelCol="${colDepth}"` : ""}/>` +
      `${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData>${sheetProtectionXml(sheet.protection)}${protectedRangesXml(sheet)}${filterXml(sheet, (look) => styles.filterDxf(look))}${mergeXml(sheet)}${cfRules}${validationXml(sheet)}${hyperlinks.get(sheetIndex) ?? ""}${pageXml(sheet.page)}${drawingOf.has(sheetIndex) ? '<drawing r:id="rId1"/>' : ""}${legacy.get(sheetIndex) ?? ""}${tableParts.get(sheetIndex) ?? ""}${cfExt}</worksheet>`
    );
  });

  const linked = externalLinkParts(wb, strToU8);
  const names =
    Object.entries(wb.names ?? {})
      .map(([n, f]) => `<definedName name="${escAttr(n)}">${esc(fileFormula(f))}</definedName>`)
      .join("") + wb.sheets.map((sheet, i) => printNamesXml(sheet, i)).join("") + cacheRels.map((c) => `<definedName name="${escAttr(c.name)}">#N/A</definedName>`).join("") + timelineCacheRels.map((c) => `<definedName name="${escAttr(c.name)}">#N/A</definedName>`).join("");
  // The data model, outside data and pivot tables that Excel can't hold are kept in an extension only Pli reads.
  const pliPivots = pliPivotExt(wb, pivotsKept);
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `${workbookProtectionXml(wb.protection)}<bookViews><workbookView/></bookViews><sheets>${wb.sheets.map((s, i) => `<sheet name="${escAttr(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>${linked?.references ?? ""}` +
    `${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029"${wb.iteration ? ` iterate="1" iterateCount="${wb.iteration.maxIterations}" iterateDelta="${wb.iteration.maxChange}"` : ""} fullCalcOnLoad="1"/>${pivotCaches.length ? `<pivotCaches>${pivotCaches.map((k) => `<pivotCache cacheId="${k}" r:id="rIdPivotCache${k}"/>`).join("")}</pivotCaches>` : ""}${cacheRels.length || timelineCacheRels.length || wb.protection?.roles?.length || pliPivots ? `<extLst>${cacheRels.length ? slicerCachesExt(cacheRels.map((c) => c.rid)) : ""}${timelineCacheRels.length ? timelineCachesExt(timelineCacheRels.map((c) => c.rid)) : ""}${workbookAccessExt(wb.protection)}${pliPivots}</extLst>` : ""}</workbook>`;
    `${workbookProtectionXml(wb.protection)}<bookViews><workbookView/></bookViews><sheets>${wb.sheets.map((s, i) => `<sheet name="${escAttr(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029"${wb.iteration ? ` iterate="1" iterateCount="${wb.iteration.maxIterations}" iterateDelta="${wb.iteration.maxChange}"` : ""} fullCalcOnLoad="1"/>${pivotCaches.length ? `<pivotCaches>${pivotCaches.map((k) => `<pivotCache cacheId="${k}" r:id="rIdPivotCache${k}"/>`).join("")}</pivotCaches>` : ""}${cacheRels.length || timelineCacheRels.length ? `<extLst>${cacheRels.length ? slicerCachesExt(cacheRels.map((c) => c.rid)) : ""}${timelineCacheRels.length ? timelineCachesExt(timelineCacheRels.map((c) => c.rid)) : ""}</extLst>` : ""}</workbook>`;
  const n = wb.sheets.length;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    (needsTheme(wb) ? `<Relationship Id="rIdTheme" Type="${THEME_REL_TYPE}" Target="theme/theme1.xml"/>` : "") +
    pivotCaches.map((k) => `<Relationship Id="rIdPivotCache${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition${k}.xml"/>`).join("") +
    cacheRels.map((c, k) => `<Relationship Id="${c.rid}" Type="http://schemas.microsoft.com/office/2007/relationships/slicerCache" Target="slicerCaches/slicerCache${k + 1}.xml"/>`).join("") +
    timelineCacheRels.map((c, k) => `<Relationship Id="${c.rid}" Type="http://schemas.microsoft.com/office/2011/relationships/timelineCache" Target="timelineCaches/timelineCache${k + 1}.xml"/>`).join("") +
    (rich ? rich.workbookRels(n + 3) : "") +
    (linked?.rels ?? "") +
    (people.size ? `<Relationship Id="rIdPersons" Type="${PERSON_REL}" Target="persons/person.xml"/>` : "") +
    `</Relationships>`;
  const sharedStrings =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ""}>${esc(s)}</t></si>`).join("") +
    `</sst>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` +
    [...imageTypes].map((t) => `<Default Extension="${t === "jpeg" ? "jpeg" : t}" ContentType="${IMAGE_CONTENT_TYPES[t]}"/>`).join("") +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    chartTypes.join("") +
    (needsTheme(wb) ? `<Override PartName="/${THEME_PART}" ContentType="${THEME_CONTENT_TYPE}"/>` : "") +
    (rich?.overrides ?? "") +
    (linked?.overrides ?? "") +
    (people.size ? `<Override PartName="/xl/persons/person.xml" ContentType="${PERSON_TYPE}"/>` : "") +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${esc(wb.title)}</dc:title></cp:coreProperties>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles.xml()),
    "xl/sharedStrings.xml": strToU8(sharedStrings),
  };
  if (needsTheme(wb)) files[THEME_PART] = strToU8(themeXml(wb));
  sheetXml.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  Object.assign(files, chartFiles, linked?.files ?? {});
  if (people.size) files["xl/persons/person.xml"] = strToU8(people.xml());
  return zipSync(files, { level: 6 });
}

