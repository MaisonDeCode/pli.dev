import { PliError } from "@pli.dev/core";
import { cellAddress, colNumber, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import { checkSheetName } from "./ops";
import { cleanChart } from "./chart";
import { cleanValidation } from "./validation";
import { checkTable } from "./table";
import { checkSlicer } from "./slicer";
import { checkTimeline } from "./timeline";
import { cleanSortLevel } from "./sortlevels";
import { cleanSlicerStyle, cleanSlicerStyleName } from "./slicerstyle";
import { cleanCellPicture, cleanImage } from "./image";
import { cleanIteration } from "./iteration";
import { cleanExternalBook } from "./external-sheets";
import { cleanEditRanges, cleanSheetProtection, cleanWorkbookProtection } from "./protect";
import { cleanPageSetup } from "./page";
import { cleanCriterion } from "./filter";
import { cleanFilterViews } from "./filterview";
import { cleanPivot } from "./pivot";
import { applyPivotBook } from "./pivot-book";
import { isPivotStyleName } from "./pivot-style";
import { cleanSparklines } from "./sparkline";
import { cleanTableStyle, cleanTableStyleName } from "./tablestyle";
import { BORDER_LINES, BORDER_STYLES, cleanMerge, cleanRule, overlaps } from "./rule";
import { cleanLink, MAX_NOTE_LENGTH } from "./link";
import { cleanAuthor, cleanNoteBox, cleanNoteRuns } from "./note";
import { MAX_COLS, MAX_ROWS, type Cell, type CellLink, type Sheet, type Workbook } from "./model";
import { ERROR_CODES } from "./values";
import { withoutGhosts } from "./ops";

const FORMAT = "pli.sheet";
const VERSION = 1;

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new PliError("invalid_document", `${path}: ${message}`);
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function only(path: string, value: Json, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `unknown field "${key}"`);
}

function str(path: string, v: unknown, nonEmpty = false): string {
  if (typeof v !== "string" || (nonEmpty && v === "")) fail(path, nonEmpty ? "expected a non-empty string" : "expected a string");
  return v as string;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
/** A defined name. Kept out of the loop that checks them: QuickJS (Android) misreads a regular expression that follows the head of a `for` loop, which is how a minifier writes that check. */
const NAME_OK = /^[A-Za-z_\\][A-Za-z0-9_.\\]*$/;
const STYLE_BOOLS = ["bold", "italic", "underline", "strike", "wrap", "locked", "hideFormula"];

function checkStyle(path: string, s: unknown): void {
  if (!isObject(s)) fail(path, "expected an object");
  only(path, s, [...STYLE_BOOLS, "color", "fill", "fontFamily", "fontSize", "align", "vAlign", "border", "indent"]);
  for (const [k, v] of Object.entries(s)) {
    const at = `${path}.${k}`;
    if (STYLE_BOOLS.includes(k)) {
      if (typeof v !== "boolean") fail(at, "expected a boolean");
    } else if (k === "color" || k === "fill") {
      if (typeof v !== "string" || !COLOR.test(v)) fail(at, "expected a colour like #rrggbb");
    } else if (k === "fontFamily") str(at, v, true);
    else if (k === "fontSize") {
      if (typeof v !== "number" || !(v >= 1 && v <= 400)) fail(at, "expected a number from 1 to 400");
    } else if (k === "indent") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 15) fail(at, "expected a whole number from 1 to 15");
    } else if (k === "border") checkBorders(at, v);
    else if (k === "align") {
      if (!["left", "center", "right"].includes(v as string)) fail(at, "expected left, center or right");
    } else if (!["top", "middle", "bottom"].includes(v as string)) fail(at, "expected top, middle or bottom");
  }
}

function checkBorders(path: string, b: unknown): void {
  if (!isObject(b)) fail(path, "expected an object");
  only(path, b, BORDER_LINES);
  for (const [side, line] of Object.entries(b)) {
    const at = `${path}.${side}`;
    if (!isObject(line)) fail(at, "expected an object");
    only(at, line, ["style", "color"]);
    if (!BORDER_STYLES.includes(line.style as never)) fail(`${at}.style`, `expected ${BORDER_STYLES.join(", ")}`);
    if (line.color !== undefined && (typeof line.color !== "string" || !COLOR.test(line.color))) fail(`${at}.color`, "expected a colour like #rrggbb");
  }
}

/** A control's separator: one to eight characters, and only for a control that takes several choices. */
function checkSeparator(path: string, k: Record<string, unknown>): void {
  if (k.separator === undefined) return;
  if (typeof k.separator !== "string" || k.separator === "" || k.separator.length > 8) fail(`${path}.separator`, "expected one to eight characters");
  if (k.multiple !== true) fail(`${path}.separator`, "only a control that allows several choices has a separator");
}

function checkControl(path: string, k: unknown): void {
  if (!isObject(k)) fail(path, "expected an object");
  const scalar = (at: string, v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") fail(at, "expected text, a number or a boolean");
  };
  if (k.type === "checkbox") {
    only(path, k, ["type", "checked", "unchecked"]);
    if (k.checked !== undefined) scalar(`${path}.checked`, k.checked);
    if (k.unchecked !== undefined) scalar(`${path}.unchecked`, k.unchecked);
    if ((k.checked ?? true) === (k.unchecked ?? false)) fail(path, "a checkbox needs two different values");
  } else if (k.type === "dropdown") {
    only(path, k, ["type", "options", "multiple", "separator", "strict"]);
    if (!Array.isArray(k.options) || k.options.length === 0) fail(`${path}.options`, "expected a list of choices");
    const seen = new Set<string>();
    k.options.forEach((o: unknown, i: number) => {
      const at = `${path}.options[${i}]`;
      if (!isObject(o)) fail(at, "expected an object");
      only(at, o, ["value", "label", "color", "description", "image"]);
      const v = str(`${at}.value`, o.value, true);
      if (seen.has(v)) fail(`${at}.value`, `"${v}" is in the list twice`);
      seen.add(v);
      if (o.label !== undefined) str(`${at}.label`, o.label);
      if (o.description !== undefined) str(`${at}.description`, o.description);
      if (o.image !== undefined) str(`${at}.image`, o.image);
      if (o.color !== undefined && (typeof o.color !== "string" || !COLOR.test(o.color))) fail(`${at}.color`, "expected a colour like #rrggbb");
    });
    for (const f of ["multiple", "strict"]) if (k[f] !== undefined && typeof k[f] !== "boolean") fail(`${path}.${f}`, "expected a boolean");
    checkSeparator(path, k);
  } else if (k.type === "badge") {
    only(path, k, ["type", "kind", "color", "multiple", "separator"]);
    if (k.kind !== undefined) str(`${path}.kind`, k.kind, true);
    if (k.color !== undefined && (typeof k.color !== "string" || !COLOR.test(k.color))) fail(`${path}.color`, "expected a colour like #rrggbb");
    if (k.multiple !== undefined && typeof k.multiple !== "boolean") fail(`${path}.multiple`, "expected a boolean");
    checkSeparator(path, k);
  } else fail(`${path}.type`, 'expected "checkbox", "dropdown" or "badge"');
}

function checkCell(path: string, c: unknown): Cell {
  if (!isObject(c)) fail(path, "expected an object");
  only(path, c, ["v", "e", "f", "fmt", "s", "control", "link", "note", "noteRuns", "noteAuthor", "noteBox", "picture", "thread"]);
  if (c.v !== undefined && typeof c.v !== "number" && typeof c.v !== "string" && typeof c.v !== "boolean") fail(`${path}.v`, "expected a number, text or boolean");
  if (typeof c.v === "number" && !Number.isFinite(c.v)) fail(`${path}.v`, "expected a finite number");
  if (c.e !== undefined && !ERROR_CODES.includes(c.e as never)) fail(`${path}.e`, `expected one of ${ERROR_CODES.join(" ")}`);
  if (c.f !== undefined) {
    str(`${path}.f`, c.f, true);
    if ((c.f as string).startsWith("=")) fail(`${path}.f`, "write a formula without the leading =");
  }
  if (c.fmt !== undefined) str(`${path}.fmt`, c.fmt, true);
  if (c.s !== undefined) checkStyle(`${path}.s`, c.s);
  if (c.control !== undefined) checkControl(`${path}.control`, c.control);
  if (c.link !== undefined) {
    if (!isObject(c.link)) fail(`${path}.link`, "expected an object");
    only(`${path}.link`, c.link, ["to", "tip", "followed"]);
    str(`${path}.link.to`, c.link.to, true);
    if (c.link.tip !== undefined) str(`${path}.link.tip`, c.link.tip);
    if (c.link.followed !== undefined && c.link.followed !== true) fail(`${path}.link.followed`, "expected true");
    try {
      cleanLink(c.link as unknown as CellLink);
    } catch (e) {
      fail(`${path}.link`, e instanceof Error ? e.message : "not a link");
    }
  }
  if (c.picture !== undefined) {
    if (!isObject(c.picture)) fail(`${path}.picture`, "expected an object");
    only(`${path}.picture`, c.picture, ["src", "alt"]);
    str(`${path}.picture.src`, c.picture.src, true);
    if (c.picture.alt !== undefined) str(`${path}.picture.alt`, c.picture.alt);
    try {
      cleanCellPicture(c.picture as never);
    } catch (e) {
      fail(`${path}.picture`, e instanceof Error ? e.message : "not a picture");
    }
  }
  if (c.thread !== undefined) str(`${path}.thread`, c.thread, true);
  if (c.note !== undefined) {
    str(`${path}.note`, c.note, true);
    if ((c.note as string).length > MAX_NOTE_LENGTH) fail(`${path}.note`, `expected at most ${MAX_NOTE_LENGTH} characters`);
  }
  if (c.noteRuns !== undefined || c.noteAuthor !== undefined || c.noteBox !== undefined) {
    if (c.note === undefined) fail(path, "noteRuns, noteAuthor and noteBox belong to a note");
    try {
      if (c.noteRuns !== undefined && cleanNoteRuns(c.note as string, c.noteRuns) === undefined) fail(`${path}.noteRuns`, "expected runs that give the note a look");
      if (c.noteAuthor !== undefined && !cleanAuthor(c.noteAuthor)) fail(`${path}.noteAuthor`, "expected the name of an author");
      if (c.noteBox !== undefined && !cleanNoteBox(c.noteBox)) fail(`${path}.noteBox`, "expected a box with a size, a place or show");
    } catch (e) {
      if (e instanceof PliError && e.message.startsWith(path)) throw e;
      fail(`${path}`, e instanceof Error ? e.message : "not a valid note");
    }
  }
  const kept = [c.v, c.e, c.f].filter((x) => x !== undefined).length;
  if (kept > 1) fail(path, "a cell holds a value, an error or a formula, not more than one");
  return c as Cell;
}

function checkDims(path: string, d: unknown, axis: "col" | "row"): void {
  if (!isObject(d)) fail(path, "expected an object");
  for (const [k, v] of Object.entries(d)) {
    const at = `${path}.${k}`;
    if (axis === "col" ? colNumber(k) === 0 || k !== k.toUpperCase() : !/^[1-9]\d*$/.test(k) || Number(k) > MAX_ROWS) fail(at, axis === "col" ? "expected column letters" : "expected a row number");
    if (!isObject(v)) fail(at, "expected an object");
    only(at, v, ["size", "hidden", "level", "collapsed", "locked", "hideFormula"]);
    if (v.locked !== undefined && typeof v.locked !== "boolean") fail(`${at}.locked`, "expected true or false");
    if (v.hideFormula !== undefined && typeof v.hideFormula !== "boolean") fail(`${at}.hideFormula`, "expected true or false");
    if (v.size !== undefined && (typeof v.size !== "number" || !(v.size >= 0))) fail(`${at}.size`, "expected a number from 0");
    if (v.hidden !== undefined && v.hidden !== true) fail(`${at}.hidden`, "expected true");
    if (v.level !== undefined && !(Number.isInteger(v.level) && (v.level as number) >= 1 && (v.level as number) <= 7)) fail(`${at}.level`, "expected a whole number from 1 to 7");
    if (v.collapsed !== undefined && v.collapsed !== true) fail(`${at}.collapsed`, "expected true");
  }
}

/** Throws a `PliError` naming the place of the first mistake if this isn't a valid workbook. */
export function validateWorkbook(wb: unknown): asserts wb is Workbook {
  if (!isObject(wb)) fail("workbook", "expected an object");
  only("workbook", wb, ["id", "type", "title", "sheets", "names", "tableStyles", "slicerStyles", "pivotStyles", "dataBlocks", "model", "protection", "iteration", "themeColors", "externalBooks", "comments"]);
  str("workbook.id", wb.id, true);
  if (wb.type !== "workbook") fail("workbook.type", 'expected "workbook"');
  str("workbook.title", wb.title);
  if (!Array.isArray(wb.sheets) || wb.sheets.length === 0) fail("workbook.sheets", "expected at least one sheet");
  const ids = new Set<string>();
  const names: string[] = [];
  wb.sheets.forEach((s: unknown, i: number) => {
    const p = `workbook.sheets[${i}]`;
    if (!isObject(s)) fail(p, "expected an object");
    only(p, s, ["id", "name", "cells", "columns", "rows", "frozen", "tabColor", "filter", "filterViews", "charts", "slicers", "images", "sparklines", "pivots", "protection", "page", "outline", "merges", "conditional", "validations", "tables", "hidden", "timelines", "editRanges", "unlocked", "hiddenFormulas"]);
    const id = str(`${p}.id`, s.id, true);
    if (ids.has(id)) fail(`${p}.id`, `duplicate id "${id}"`);
    ids.add(id);
    const name = str(`${p}.name`, s.name);
    try {
      checkSheetName(name, names);
    } catch (e) {
      fail(`${p}.name`, (e as Error).message);
    }
    names.push(name);
    if (!isObject(s.cells)) fail(`${p}.cells`, "expected an object");
    for (const [address, cell] of Object.entries(s.cells)) {
      const pos = parseCell(address);
      if (!pos || cellAddress(pos.row, pos.col) !== address) fail(`${p}.cells.${address}`, "expected an address such as B3 in capitals");
      checkCell(`${p}.cells.${address}`, cell);
    }
    if (s.columns !== undefined) checkDims(`${p}.columns`, s.columns, "col");
    if (s.rows !== undefined) checkDims(`${p}.rows`, s.rows, "row");
    if (s.frozen !== undefined) {
      const f = s.frozen;
      if (!isObject(f)) fail(`${p}.frozen`, "expected an object");
      only(`${p}.frozen`, f, ["rows", "cols"]);
      for (const k of ["rows", "cols"] as const) if (!Number.isInteger(f[k]) || (f[k] as number) < 0 || (f[k] as number) > (k === "rows" ? MAX_ROWS : MAX_COLS)) fail(`${p}.frozen.${k}`, "expected a whole number from 0");
    }
    if (s.filter !== undefined) {
      const f = s.filter;
      if (!isObject(f)) fail(`${p}.filter`, "expected an object");
      only(`${p}.filter`, f, ["range", "columns"]);
      const r = typeof f.range === "string" ? parseRange(f.range) : null;
      if (!r || r.r1 === r.r2 || rangeAddress(r) !== f.range) fail(`${p}.filter.range`, "expected a range of at least two rows, such as A1:E20");
      if (f.columns !== undefined) {
        if (!isObject(f.columns)) fail(`${p}.filter.columns`, "expected an object");
        for (const [k, v] of Object.entries(f.columns)) {
          const c = colNumber(k);
          if (!c || k !== k.toUpperCase() || c < r.c1 || c > r.c2) fail(`${p}.filter.columns.${k}`, "expected the letters of a column inside the range");
          try {
            cleanCriterion(v as never);
          } catch (e) {
            fail(`${p}.filter.columns.${k}`, (e as Error).message.includes("text") && Array.isArray(v) ? "expected a list of the values let through" : (e as Error).message);
          }
          if (!Array.isArray(v) && !isObject(v)) fail(`${p}.filter.columns.${k}`, "expected a list of the values let through, or a rule");
        }
      }
    }
    if (s.filterViews !== undefined) {
      if (!Array.isArray(s.filterViews)) fail(`${p}.filterViews`, "expected a list");
      s.filterViews.forEach((v: unknown, k: number) => {
        if (!isObject(v)) fail(`${p}.filterViews[${k}]`, "expected an object");
        only(`${p}.filterViews[${k}]`, v as Record<string, unknown>, ["id", "name", "range", "columns", "sort", "tables"]);
      });
      try {
        cleanFilterViews(s.filterViews as never);
      } catch (e) {
        fail(`${p}.filterViews`, (e as Error).message);
      }
    }
    if (s.charts !== undefined) {
      if (!Array.isArray(s.charts)) fail(`${p}.charts`, "expected a list");
      const chartIds = new Set<string>();
      s.charts.forEach((c: unknown, k: number) => {
        const at = `${p}.charts[${k}]`;
        if (!isObject(c)) fail(at, "expected an object");
        only(at, c, ["id", "type", "title", "alt", "categories", "series", "grouping", "legend", "smooth", "labels", "xTitle", "yTitle", "view3d", "from", "width", "height", "y2Title", "x2Title", "secondaryCategoryAxis", "markers", "lines", "holeSize", "filled", "bubbleScale", "stock", "wireframe", "split", "secondSize", "totals", "bins", "box", "parentLabels", "axes", "firstSliceAngle", "stockLook", "waterfall", "labelShow", "labelPosition", "font", "titleFont", "titleRuns"]);
        for (const [k, keys] of [["split", ["by", "at", "points"]], ["bins", ["by", "size", "overflow", "underflow", "closed"]], ["box", ["quartile", "meanMarker", "meanLine", "innerPoints", "outliers"]]] as const) {
          if (c[k] === undefined) continue;
          if (!isObject(c[k])) fail(`${at}.${k}`, "expected an object");
          only(`${at}.${k}`, c[k], [...keys]);
        }
        if (!isObject(c.from)) fail(`${at}.from`, "expected an object");
        only(`${at}.from`, c.from, ["row", "col", "dx", "dy"]);
        if (c.view3d !== undefined) {
          if (!isObject(c.view3d)) fail(`${at}.view3d`, "expected an object");
          only(`${at}.view3d`, c.view3d, ["rotX", "rotY"]);
          for (const k of ["rotX", "rotY"]) if (typeof c.view3d[k] !== "number") fail(`${at}.view3d.${k}`, "expected a number");
        }
        if (!Array.isArray(c.series)) fail(`${at}.series`, "expected a list");
        c.series.forEach((x: unknown, j: number) => {
          if (!isObject(x)) fail(`${at}.series[${j}]`, "expected an object");
          only(`${at}.series[${j}]`, x, ["name", "nameRef", "values", "x", "color", "type", "axis", "trendlines", "size", "errorBars", "explosion", "pointExplosion"]);
          if (x.trendlines !== undefined) {
            if (!Array.isArray(x.trendlines)) fail(`${at}.series[${j}].trendlines`, "expected a list");
            x.trendlines.forEach((t: unknown, m: number) => {
              if (!isObject(t)) fail(`${at}.series[${j}].trendlines[${m}]`, "expected an object");
              only(`${at}.series[${j}].trendlines[${m}]`, t, ["type", "order", "period", "forward", "backward", "intercept", "name", "equation", "rSquared", "color"]);
            });
          }
        });
        try {
          cleanChart(c as never);
        } catch (e) {
          fail(at, (e as Error).message);
        }
        const id = c.id as string;
        if (chartIds.has(id)) fail(`${at}.id`, `duplicate id "${id}"`);
        chartIds.add(id);
      });
    }
    if (s.merges !== undefined) {
      if (!Array.isArray(s.merges)) fail(`${p}.merges`, "expected a list");
      const seen: Bounds[] = [];
      s.merges.forEach((m: unknown, k: number) => {
        const at = `${p}.merges[${k}]`;
        let clean: string;
        try {
          clean = cleanMerge(String(m));
        } catch (e) {
          return fail(at, (e as Error).message);
        }
        if (typeof m !== "string" || clean !== m) fail(at, "expected a range such as B2:D3");
        const b = parseRange(clean)!;
        if (seen.some((o) => overlaps(o, b))) fail(at, "overlaps another merged range");
        seen.push(b);
      });
    }
    if (s.conditional !== undefined) {
      if (!Array.isArray(s.conditional)) fail(`${p}.conditional`, "expected a list");
      const ruleIds = new Set<string>();
      s.conditional.forEach((r: unknown, k: number) => {
        const at = `${p}.conditional[${k}]`;
        if (!isObject(r)) fail(at, "expected an object");
        let clean: object = {};
        try {
          clean = cleanRule(r as never);
        } catch (e) {
          fail(at, (e as Error).message);
        }
        for (const key of Object.keys(r)) if (!(key in clean)) fail(`${at}.${key}`, "unknown field");
        const id = r.id as string;
        if (ruleIds.has(id)) fail(`${at}.id`, `duplicate id "${id}"`);
        ruleIds.add(id);
      });
    }
    if (s.validations !== undefined) {
      if (!Array.isArray(s.validations)) fail(`${p}.validations`, "expected a list");
      const ids = new Set<string>();
      s.validations.forEach((r: unknown, k: number) => {
        const at = `${p}.validations[${k}]`;
        if (!isObject(r)) fail(at, "expected an object");
        let clean: object = {};
        try {
          clean = cleanValidation(r as never);
        } catch (e) {
          fail(at, (e as Error).message);
        }
        for (const key of Object.keys(r)) if (!(key in clean)) fail(`${at}.${key}`, "unknown field");
        const id = r.id as string;
        if (ids.has(id)) fail(`${at}.id`, `duplicate id "${id}"`);
        ids.add(id);
      });
    }
    if (s.hidden !== undefined && s.hidden !== true) fail(`${p}.hidden`, "expected true");
    if (s.tabColor !== undefined && (typeof s.tabColor !== "string" || !COLOR.test(s.tabColor))) fail(`${p}.tabColor`, "expected a colour like #rrggbb");
  });
  if (wb.sheets.every((s: unknown) => (s as { hidden?: unknown }).hidden === true)) fail("workbook.sheets", "expected at least one sheet that isn't hidden");
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { tables?: unknown };
    if (sheet.tables === undefined) return;
    const p = `workbook.sheets[${i}].tables`;
    if (!Array.isArray(sheet.tables)) fail(p, "expected a list");
    const ids = new Set<string>();
    (sheet.tables as unknown[]).forEach((t, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(t)) fail(at, "expected an object");
      only(at, t, ["id", "name", "range", "totals", "calculated", "style", "bandedRows", "bandedColumns", "firstColumn", "lastColumn", "headerRow", "columns", "filterButtons", "filters", "sort"]);
      if (t.calculated !== undefined) {
        if (!isObject(t.calculated)) fail(`${at}.calculated`, "expected an object");
        for (const [name, f] of Object.entries(t.calculated)) str(`${at}.calculated.${name}`, f, true);
      }
      for (const f of ["totals", "bandedColumns", "firstColumn", "lastColumn"]) if (t[f] !== undefined && t[f] !== true) fail(`${at}.${f}`, "expected true");
      for (const f of ["bandedRows", "headerRow", "filterButtons"]) if (t[f] !== undefined && t[f] !== false) fail(`${at}.${f}`, "expected false");
      if (t.columns !== undefined && (!Array.isArray(t.columns) || t.columns.some((c: unknown) => typeof c !== "string"))) fail(`${at}.columns`, "expected a list of names");
      if (t.filters !== undefined) {
        if (!isObject(t.filters)) fail(`${at}.filters`, "expected an object");
        for (const [name, values] of Object.entries(t.filters)) {
          if (!Array.isArray(values) && !isObject(values)) fail(`${at}.filters.${name}`, "expected a list of text, or a rule");
          try {
            cleanCriterion(values as never);
          } catch (e) {
            fail(`${at}.filters.${name}`, Array.isArray(values) ? "expected a list of text" : (e as Error).message);
          }
        }
      }
      if (t.sort !== undefined) {
        if (!isObject(t.sort)) fail(`${at}.sort`, "expected an object");
        only(`${at}.sort`, t.sort, ["column", "descending", "by", "color", "icon", "then"]);
        if (t.sort.then !== undefined && !Array.isArray(t.sort.then)) fail(`${at}.sort.then`, "expected a list of sort levels");
        const levels = [{ ...t.sort, then: undefined }, ...((t.sort.then as unknown[] | undefined) ?? [])];
        levels.forEach((level, n) => {
          const lat = n === 0 ? `${at}.sort` : `${at}.sort.then[${n - 1}]`;
          if (!isObject(level)) fail(lat, "expected an object");
          if (n > 0) only(lat, level, ["column", "descending", "by", "color", "icon"]);
          str(`${lat}.column`, level.column, true);
          if (level.descending !== undefined && level.descending !== true) fail(`${lat}.descending`, "expected true");
          try {
            const { then: _then, ...bare } = level as Record<string, unknown>;
            cleanSortLevel(bare as never);
          } catch (e) {
            fail(lat, (e as Error).message);
          }
        });
      }
      if (t.style !== undefined && (typeof t.style !== "string" || t.style === "")) fail(`${at}.style`, "expected a table style name");
      if (ids.has(t.id as string)) fail(`${at}.id`, `duplicate id "${String(t.id)}"`);
      ids.add(t.id as string);
      try {
        checkTable(wb as unknown as Workbook, (wb.sheets as unknown as Sheet[])[i]!, t as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
    });
  });
  const tableIds = new Set<string>();
  for (const sheet of wb.sheets as { tables?: { id: string }[] }[]) for (const t of sheet.tables ?? []) tableIds.add(t.id);
  const slicerIds = new Set<string>();
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { slicers?: unknown };
    if (sheet.slicers === undefined) return;
    const p = `workbook.sheets[${i}].slicers`;
    if (!Array.isArray(sheet.slicers)) fail(p, "expected a list");
    (sheet.slicers as unknown[]).forEach((x, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(x)) fail(at, "expected an object");
      only(at, x, ["id", "table", "column", "caption", "from", "width", "height", "style", "columns"]);
      if (slicerIds.has(x.id as string)) fail(`${at}.id`, `duplicate id "${String(x.id)}"`);
      slicerIds.add(x.id as string);
      try {
        checkSlicer(wb as unknown as Workbook, x as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
    });
  });
  const timelineIds = new Set<string>();
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { timelines?: unknown };
    if (sheet.timelines === undefined) return;
    const p = `workbook.sheets[${i}].timelines`;
    if (!Array.isArray(sheet.timelines)) fail(p, "expected a list");
    (sheet.timelines as unknown[]).forEach((x, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(x)) fail(at, "expected an object");
      only(at, x, ["id", "table", "column", "caption", "from", "width", "height", "level", "style"]);
      if (timelineIds.has(x.id as string)) fail(`${at}.id`, `duplicate id "${String(x.id)}"`);
      timelineIds.add(x.id as string);
      try {
        checkTimeline(wb as unknown as Workbook, x as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
    });
  });
  const imageIds = new Set<string>();
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { images?: unknown };
    if (sheet.images === undefined) return;
    const p = `workbook.sheets[${i}].images`;
    if (!Array.isArray(sheet.images)) fail(p, "expected a list");
    (sheet.images as unknown[]).forEach((x, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(x)) fail(at, "expected an object");
      only(at, x, ["id", "src", "from", "width", "height", "alt", "placement", "to", "rotation", "flipH", "flipV", "crop", "border", "shadow", "brightness", "contrast", "grayscale", "glow", "softEdge", "reflection", "artistic", "shape", "shapeAdjust"]);
      if (imageIds.has(x.id as string)) fail(`${at}.id`, `duplicate id "${String(x.id)}"`);
      imageIds.add(x.id as string);
      try {
        cleanImage(x as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
    });
  });
  const sparkIds = new Set<string>();
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { sparklines?: unknown };
    if (sheet.sparklines === undefined) return;
    const p = `workbook.sheets[${i}].sparklines`;
    if (!Array.isArray(sheet.sparklines)) fail(p, "expected a list");
    (sheet.sparklines as unknown[]).forEach((x, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(x)) fail(at, "expected an object");
      only(at, x, ["id", "type", "items", "color", "negativeColor", "markerColor", "firstColor", "lastColor", "highColor", "lowColor", "markers", "first", "last", "high", "low", "negative", "lineWeight", "emptyAs", "showHidden", "rightToLeft", "showAxis", "min", "max", "axisColor", "dateAxis"]);
      if (sparkIds.has(x.id as string)) fail(`${at}.id`, `duplicate id "${String(x.id)}"`);
      sparkIds.add(x.id as string);
      try {
        cleanSparklines(x as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
    });
  });
  const pivotIds = new Set<string>();
  const pivotNames = new Set<string>();
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { pivots?: unknown };
    if (sheet.pivots === undefined) return;
    const p = `workbook.sheets[${i}].pivots`;
    if (!Array.isArray(sheet.pivots)) fail(p, "expected a list");
    (sheet.pivots as unknown[]).forEach((x, k) => {
      const at = `${p}[${k}]`;
      if (!isObject(x)) fail(at, "expected an object");
      only(at, x, ["id", "name", "source", "anchor", "rows", "columns", "values", "filters", "calculated", "calculatedItems", "ranges", "style", "slicers", "timelines", "tabular", "outline", "repeatLabels", "valuesOnRows", "autoRefresh", "grandTotalRows", "grandTotalColumns", "pageFields", "formats", "range"]);
      if (pivotIds.has(x.id as string)) fail(`${at}.id`, `duplicate id "${String(x.id)}"`);
      pivotIds.add(x.id as string);
      try {
        const clean = cleanPivot(x as never);
        // A style of its own has to be one the workbook defines.
        const own = Object.keys((wb as { pivotStyles?: Record<string, unknown> }).pivotStyles ?? {}).map((n) => n.toLowerCase());
        if (clean.style && !isPivotStyleName(clean.style.name) && !own.includes(clean.style.name.toLowerCase())) fail(`${at}.style`, `no pivot table style called "${clean.style.name}"`);
      } catch (e) {
        if (e instanceof PliError && e.message.startsWith(at)) throw e;
        fail(at, (e as Error).message);
      }
      const name = String(x.name).toLowerCase();
      if (pivotNames.has(name)) fail(`${at}.name`, `duplicate name "${String(x.name)}"`);
      pivotNames.add(name);
    });
  });
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { outline?: unknown };
    if (sheet.outline === undefined) return;
    const p = `workbook.sheets[${i}].outline`;
    if (!isObject(sheet.outline)) fail(p, "expected an object");
    only(p, sheet.outline, ["summaryAbove", "summaryLeft"]);
    for (const [k, v] of Object.entries(sheet.outline)) if (v !== true) fail(`${p}.${k}`, "expected true");
  });
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { page?: unknown };
    if (sheet.page === undefined) return;
    const p = `workbook.sheets[${i}].page`;
    if (!isObject(sheet.page)) fail(p, "expected an object");
    try {
      const clean = cleanPageSetup(sheet.page as never);
      if (clean === null) fail(p, "expected a page setup that differs from the defaults, or leave it out");
    } catch (e) {
      fail(p, (e as Error).message);
    }
  });
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { protection?: unknown };
    if (sheet.protection === undefined) return;
    const p = `workbook.sheets[${i}].protection`;
    if (!isObject(sheet.protection)) fail(p, "expected an object");
    only(p, sheet.protection, ["password", "allow", "roles", "editLocked"]);
    try {
      cleanSheetProtection(sheet.protection as never);
    } catch (e) {
      fail(p, (e as Error).message);
    }
  });
  wb.sheets.forEach((s: unknown, i: number) => {
    const sheet = s as { editRanges?: unknown; unlocked?: unknown; hiddenFormulas?: unknown };
    if (sheet.unlocked !== undefined && sheet.unlocked !== true) fail(`workbook.sheets[${i}].unlocked`, "expected true");
    if (sheet.hiddenFormulas !== undefined && sheet.hiddenFormulas !== true) fail(`workbook.sheets[${i}].hiddenFormulas`, "expected true");
    if (sheet.editRanges === undefined) return;
    const p = `workbook.sheets[${i}].editRanges`;
    if (!Array.isArray(sheet.editRanges)) fail(p, "expected a list");
    (sheet.editRanges as unknown[]).forEach((r, k) => {
      if (!isObject(r)) fail(`${p}[${k}]`, "expected an object");
      only(`${p}[${k}]`, r as Record<string, unknown>, ["name", "ranges", "password", "permissions", "denied", "securityDescriptor"]);
    });
    try {
      cleanEditRanges(sheet.editRanges as never);
    } catch (e) {
      fail(p, (e as Error).message);
    }
  });
  if (wb.protection !== undefined) {
    if (!isObject(wb.protection)) fail("workbook.protection", "expected an object");
    only("workbook.protection", wb.protection, ["structure", "password", "roles"]);
    try {
      cleanWorkbookProtection(wb.protection as never);
    } catch (e) {
      fail("workbook.protection", (e as Error).message);
    }
  }
  if (wb.iteration !== undefined) {
    if (!isObject(wb.iteration)) fail("workbook.iteration", "expected an object");
    only("workbook.iteration", wb.iteration, ["maxIterations", "maxChange"]);
    try {
      cleanIteration(wb.iteration as never);
    } catch (e) {
      fail("workbook.iteration", (e as Error).message);
    }
  }
  if (wb.externalBooks !== undefined) {
    if (!Array.isArray(wb.externalBooks)) fail("workbook.externalBooks", "expected a list");
    const seen = new Set<string>();
    wb.externalBooks.forEach((b: unknown, i: number) => {
      const at = `workbook.externalBooks[${i}]`;
      if (!isObject(b)) fail(at, "expected an object");
      only(at, b, ["name", "path", "read", "sheets", "tables"]);
      try {
        cleanExternalBook(b as never);
      } catch (e) {
        fail(at, (e as Error).message);
      }
      for (const [name, cells] of Object.entries(b.sheets as Record<string, Record<string, unknown>>)) for (const address of Object.keys(cells)) if (address !== address.toUpperCase()) fail(`${at}.sheets.${name}.${address}`, "expected an address such as B3 in capitals");
      const key = String(b.name).toLowerCase();
      if (seen.has(key)) fail(`${at}.name`, `"${String(b.name)}" is listed twice`);
      seen.add(key);
    });
  }
  if (wb.comments !== undefined) {
    if (!isObject(wb.comments)) fail("workbook.comments", "expected an object");
    for (const [id, thread] of Object.entries(wb.comments)) {
      const at = `workbook.comments.${id}`;
      if (!isObject(thread)) fail(at, "expected an object");
      only(at, thread, ["id", "anchor", "comments", "resolved", "createdAt"]);
      if (thread.id !== id) fail(`${at}.id`, "expected the id the thread is kept under");
      if (!Array.isArray(thread.comments)) fail(`${at}.comments`, "expected a list");
      if (typeof thread.createdAt !== "number") fail(`${at}.createdAt`, "expected a number");
      (thread.comments as unknown[]).forEach((c, i) => {
        if (!isObject(c)) fail(`${at}.comments[${i}]`, "expected an object");
        str(`${at}.comments[${i}].id`, c.id, true);
        str(`${at}.comments[${i}].author`, c.author);
        str(`${at}.comments[${i}].body`, c.body);
        if (typeof c.createdAt !== "number") fail(`${at}.comments[${i}].createdAt`, "expected a number");
      });
      if (thread.anchor !== undefined) {
        if (!isObject(thread.anchor)) fail(`${at}.anchor`, "expected an object");
        only(`${at}.anchor`, thread.anchor, ["sheet", "cell", "range", "quote"]);
        str(`${at}.anchor.sheet`, thread.anchor.sheet, true);
        str(`${at}.anchor.cell`, thread.anchor.cell, true);
      }
    }
  }
  if (wb.themeColors !== undefined) {
    const colors = wb.themeColors as unknown;
    if (!Array.isArray(colors) || (colors.length !== 10 && colors.length !== 12) || colors.some((c) => typeof c !== "string" || !/^#[0-9a-f]{6}$/.test(c))) fail("workbook.themeColors", "expected ten colours (twelve with the hyperlink colours) written #rrggbb (lower case)");
  }
  if (wb.slicerStyles !== undefined) {
    if (!isObject(wb.slicerStyles)) fail("workbook.slicerStyles", "expected an object");
    for (const [name, def] of Object.entries(wb.slicerStyles)) {
      try {
        cleanSlicerStyleName(name);
        cleanSlicerStyle(def as never);
      } catch (e) {
        fail(`workbook.slicerStyles.${name}`, (e as Error).message);
      }
    }
  }
  if (wb.tableStyles !== undefined) {
    if (!isObject(wb.tableStyles)) fail("workbook.tableStyles", "expected an object");
    for (const [name, def] of Object.entries(wb.tableStyles)) {
      try {
        cleanTableStyleName(name);
        cleanTableStyle(def as never);
      } catch (e) {
        fail(`workbook.tableStyles.${name}`, (e as Error).message);
      }
    }
  }
  for (const key of ["pivotStyles", "dataBlocks", "model"] as const) {
    if (wb[key] === undefined) continue;
    try {
      applyPivotBook({ id: "", type: "workbook", title: "", sheets: [] }, { [key]: wb[key] } as never);
    } catch (e) {
      fail(`workbook.${key}`, (e as Error).message);
    }
  }
  if (wb.names !== undefined) {
    if (!isObject(wb.names)) fail("workbook.names", "expected an object");
    for (const [n, f] of Object.entries(wb.names)) {
      if (!NAME_OK.test(n)) fail(`workbook.names.${n}`, "not a usable name");
      str(`workbook.names.${n}`, f, true);
    }
  }
}

/** Reads a saved workbook (JSON text), checking it. */
export function parseWorkbook(json: string): Workbook {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new PliError("invalid_document", `Not valid JSON: ${(e as Error).message}`);
  }
  if (!isObject(raw)) fail("file", "expected an object");
  if (raw.format !== FORMAT) fail("file.format", `expected "${FORMAT}"`);
  if (raw.version !== VERSION) fail("file.version", `unsupported version ${String(raw.version)}`);
  validateWorkbook(raw.workbook);
  return raw.workbook;
}

/** The workbook as saved text. */
export function serializeWorkbook(wb: Workbook, space?: number): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, workbook: withoutGhosts(wb) }, null, space);
}

export function emptySheet(id: string, name: string): Sheet {
  return { id, name, cells: {} };
}

