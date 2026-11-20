import { PliError } from "@pli.dev/core";
import type { Block, Doc } from "./model";
import { checkGrid } from "./grid";
import type { TableBlock } from "./model";
import { PAGE_SIZES } from "./page";
import { REGION_NAMES } from "./regions";
import { footnoteIds, isNoteBlock, pruneFootnotes } from "./footnotes";
import { BULLET_MARKERS, MAX_LIST_START, NUMBER_MARKERS } from "./lists";

const FORMAT = "pli.doc";
const VERSION = 1;

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new PliError("invalid_document", `${path}: ${message}`);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function only(path: string, value: Json, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path, `unknown field "${key}"`);
  }
}

function str(path: string, value: unknown, { nonEmpty = false } = {}): string {
  if (typeof value !== "string" || (nonEmpty && value === "")) {
    fail(path, nonEmpty ? "expected a non-empty string" : "expected a string");
  }
  return value as string;
}

function num(path: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a number from ${min} to ${max}`);
  }
  return value as number;
}

const BOOLEAN_MARKS = ["bold", "italic", "underline", "strike", "code", "superscript", "subscript"];
const STRING_MARKS = ["link", "color", "highlight", "fontFamily"];
const ALIGNS = ["left", "center", "right", "justify"];
const FIELDS = ["page", "pages"];

function checkRuns(path: string, value: unknown): void {
  if (!Array.isArray(value)) fail(path, "expected an array of runs");
  (value as unknown[]).forEach((run, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(run)) fail(at, "expected a run object");
    only(at, run, ["text", "marks"]);
    str(`${at}.text`, run.text);
    if (run.marks === undefined) return;
    if (!isObject(run.marks)) fail(`${at}.marks`, "expected an object");
    for (const [key, v] of Object.entries(run.marks)) {
      const where = `${at}.marks.${key}`;
      if (BOOLEAN_MARKS.includes(key)) {
        if (typeof v !== "boolean") fail(where, "expected a boolean");
      } else if (STRING_MARKS.includes(key)) {
        str(where, v);
      } else if (key === "fontSize") {
        num(where, v, 1, 400);
      } else if (key === "field") {
        if (!FIELDS.includes(v as string)) fail(where, `expected one of ${FIELDS.join(", ")}`);
      } else if (key === "style") {
        str(where, v, { nonEmpty: true });
      } else if (key === "suggest") {
        if (!isObject(v)) fail(where, "expected an object");
        only(where, v, ["id", "kind", "by", "at"]);
        str(`${where}.id`, v.id, { nonEmpty: true });
        if (v.kind !== "insert" && v.kind !== "delete") fail(`${where}.kind`, 'expected "insert" or "delete"');
        str(`${where}.by`, v.by, { nonEmpty: true });
        num(`${where}.at`, v.at, 0, Number.MAX_SAFE_INTEGER);
      } else if (key === "footnote") {
        str(where, v, { nonEmpty: true });
      } else if (key === "comment") {
        if (!Array.isArray(v) || v.length === 0) fail(where, "expected a list of thread ids");
        (v as unknown[]).forEach((id, n) => str(`${where}[${n}]`, id, { nonEmpty: true }));
      } else {
        fail(`${at}.marks`, `unknown mark "${key}"`);
      }
    }
  });
}

const STYLE_MARK_KEYS = ["bold", "italic", "underline", "strike", "superscript", "subscript", "color", "highlight", "fontFamily", "fontSize"];

function checkStyles(path: string, value: unknown): void {
  if (!isObject(value)) fail(path, "expected an object");
  for (const [id, style] of Object.entries(value)) {
    const at = `${path}.${id}`;
    if (id === "") fail(path, "a style needs an id");
    if (!isObject(style)) fail(at, "expected a style object");
    only(at, style, ["name", "kind", "basedOn", "marks", "align", "format"]);
    str(`${at}.name`, style.name, { nonEmpty: true });
    if (style.kind !== "paragraph" && style.kind !== "character") fail(`${at}.kind`, 'expected "paragraph" or "character"');
    if (style.basedOn !== undefined) {
      const base = str(`${at}.basedOn`, style.basedOn, { nonEmpty: true });
      const target = value[base];
      if (!isObject(target) || target.kind !== style.kind) fail(`${at}.basedOn`, `"${base}" isn't a ${String(style.kind)} style of this document`);
    }
    if (style.marks !== undefined) {
      if (!isObject(style.marks)) fail(`${at}.marks`, "expected an object");
      const marks = style.marks;
      for (const [key, v] of Object.entries(marks)) {
        const where = `${at}.marks.${key}`;
        if (!STYLE_MARK_KEYS.includes(key)) fail(`${at}.marks`, `a style can't set "${key}"`);
        if (BOOLEAN_MARKS.includes(key)) {
          if (typeof v !== "boolean") fail(where, "expected a boolean");
        } else if (key === "fontSize") num(where, v, 1, 400);
        else str(where, v);
      }
    }
    if (style.kind === "character" && (style.align !== undefined || style.format !== undefined)) fail(at, "a character style can't set alignment or spacing");
    checkAlign(at, style.align);
    checkFormat(at, style.format);
  }
  // A chain of styles that leads back to itself would never end.
  for (const id of Object.keys(value)) {
    const seen = new Set<string>();
    for (let at: string | undefined = id; at !== undefined; at = (value[at] as Json).basedOn as string | undefined) {
      if (seen.has(at)) fail(`${path}.${id}.basedOn`, "styles can't be based on each other in a circle");
      seen.add(at);
    }
  }
}

function checkAlign(path: string, value: unknown): void {
  if (value !== undefined && !ALIGNS.includes(value as string)) {
    fail(`${path}.align`, `expected one of ${ALIGNS.join(", ")}`);
  }
}

function checkFormat(path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(`${path}.format`, "expected an object");
  only(`${path}.format`, value, ["lineHeight", "spaceBefore", "spaceAfter", "indentLeft", "indentRight", "indentFirst"]);
  for (const [key, v] of Object.entries(value)) {
    const where = `${path}.format.${key}`;
    if (key === "lineHeight") num(where, v, 0.5, 10);
    else if (key === "indentFirst") num(where, v, -1000, 1000);
    else num(where, v, 0, 1000);
  }
}

const TEXT_FIELDS = ["id", "type", "runs", "align", "format", "style"];
const CELL_TYPES = new Set(["paragraph", "title", "subtitle", "quote", "heading", "list_item", "code_block", "image", "divider"]);

function claim(path: string, seen: Set<string>, value: unknown): string {
  const id = str(path, value, { nonEmpty: true });
  if (seen.has(id)) fail(path, `duplicate id "${id}"`);
  seen.add(id);
  return id;
}

/** The position of a floating object: where it sits on its page, and in front of or behind the text. */
function checkPlacement(at: string, value: Json): void {
  for (const [axis, froms, aligns] of [
    ["x", ["page", "margin", "column"], ["left", "center", "right"]],
    ["y", ["page", "margin", "paragraph"], ["top", "center", "bottom"]],
  ] as const) {
    const position = value[axis];
    if (!isObject(position)) fail(`${at}.${axis}`, "expected an object");
    only(`${at}.${axis}`, position, ["from", "offset", "align"]);
    if (!(froms as readonly unknown[]).includes(position.from)) fail(`${at}.${axis}.from`, `expected one of ${froms.join(", ")}`);
    if (position.offset !== undefined) num(`${at}.${axis}.offset`, position.offset, -100000, 100000);
    if (position.align !== undefined && !(aligns as readonly unknown[]).includes(position.align)) fail(`${at}.${axis}.align`, `expected one of ${aligns.join(", ")}`);
  }
  if (value.behind !== undefined && typeof value.behind !== "boolean") fail(`${at}.behind`, "expected true or false");
  if (value.z !== undefined) num(`${at}.z`, value.z, -1000000, 1000000);
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;

function checkBox(at: string, value: Json): void {
  only(at, value, ["x", "y", "behind", "z", "width", "height", "shape", "fill", "fillOpacity", "line", "padding"]);
  checkPlacement(at, value);
  num(`${at}.width`, value.width, 1, 20000);
  num(`${at}.height`, value.height, 1, 20000);
  if (value.shape !== undefined && !["rect", "round_rect", "ellipse"].includes(value.shape as string)) fail(`${at}.shape`, 'expected "rect", "round_rect" or "ellipse"');
  if (value.fill !== undefined && !COLOUR.test(str(`${at}.fill`, value.fill))) fail(`${at}.fill`, "expected a colour like #1a2b3c");
  if (value.fillOpacity !== undefined) num(`${at}.fillOpacity`, value.fillOpacity, 0, 1);
  if (value.line !== undefined) {
    const line = value.line;
    if (!isObject(line)) fail(`${at}.line`, "expected an object");
    only(`${at}.line`, line, ["color", "width", "style"]);
    if (!COLOUR.test(str(`${at}.line.color`, line.color))) fail(`${at}.line.color`, "expected a colour like #1a2b3c");
    num(`${at}.line.width`, line.width, 0, 200);
    if (line.style !== undefined && !["solid", "dashed", "dotted", "double"].includes(line.style as string)) fail(`${at}.line.style`, 'expected "solid", "dashed", "dotted" or "double"');
  }
  if (value.padding !== undefined) {
    const padding = value.padding;
    if (!isObject(padding)) fail(`${at}.padding`, "expected an object");
    only(`${at}.padding`, padding, ["x", "y"]);
    num(`${at}.padding.x`, padding.x, 0, 1000);
    num(`${at}.padding.y`, padding.y, 0, 1000);
  }
}

function checkTable(at: string, table: Json, seen: Set<string>): void {
  only(at, table, ["id", "type", "rows", "columns", "headerRow", "borders", "float"]);
  if (table.float !== undefined) {
    if (!isObject(table.float)) fail(`${at}.float`, "expected an object");
    checkBox(`${at}.float`, table.float);
    if ((table.columns as unknown[] | undefined)?.length !== 1 || (table.rows as unknown[] | undefined)?.length !== 1) fail(`${at}.float`, "a text box has one row and one column");
  }
  if (table.headerRow !== undefined && typeof table.headerRow !== "boolean") fail(`${at}.headerRow`, "expected a boolean");
  if (table.borders !== undefined && !["all", "horizontal", "none"].includes(table.borders as string)) {
    fail(`${at}.borders`, 'expected "all", "horizontal" or "none"');
  }
  if (!Array.isArray(table.columns) || table.columns.length === 0) fail(`${at}.columns`, "expected a non-empty array");
  const columns = table.columns as unknown[];
  let total = 0;
  columns.forEach((w, i) => (total += num(`${at}.columns[${i}]`, w, 0.0001, 1)));
  if (Math.abs(total - 1) > 1e-6) fail(`${at}.columns`, "column widths must add up to 1");
  if (!Array.isArray(table.rows) || table.rows.length === 0) fail(`${at}.rows`, "expected at least one row");
  (table.rows as unknown[]).forEach((row, r) => {
    const rowAt = `${at}.rows[${r}]`;
    if (!isObject(row)) fail(rowAt, "expected a row object");
    only(rowAt, row, ["id", "cells", "height"]);
    claim(`${rowAt}.id`, seen, row.id);
    if (row.height !== undefined) num(`${rowAt}.height`, row.height, 1, 5000);
    if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
      fail(`${rowAt}.cells`, `expected ${columns.length} cells, one per column`);
    }
    (row.cells as unknown[]).forEach((cell, c) => {
      const cellAt = `${rowAt}.cells[${c}]`;
      if (!isObject(cell)) fail(cellAt, "expected a cell object");
      only(cellAt, cell, ["id", "blocks", "shade", "colSpan", "rowSpan", "vAlign", "covered"]);
      claim(`${cellAt}.id`, seen, cell.id);
      if (cell.shade !== undefined) str(`${cellAt}.shade`, cell.shade);
      for (const key of ["colSpan", "rowSpan"] as const) {
        if (cell[key] !== undefined && (!Number.isInteger(cell[key]) || (cell[key] as number) < 2)) {
          fail(`${cellAt}.${key}`, "expected a whole number of 2 or more");
        }
      }
      if (cell.vAlign !== undefined && !["top", "middle", "bottom"].includes(cell.vAlign as string)) {
        fail(`${cellAt}.vAlign`, 'expected "top", "middle" or "bottom"');
      }
      if (cell.covered !== undefined && cell.covered !== true) fail(`${cellAt}.covered`, "expected true");
      if (!Array.isArray(cell.blocks)) fail(`${cellAt}.blocks`, "expected an array");
      // Covered placeholders hold nothing; every other cell needs a block. `checkGrid` also checks that.
      if (cell.covered !== true && (cell.blocks as unknown[]).length === 0) fail(`${cellAt}.blocks`, "a cell needs at least one block");
      checkBlocks(`${cellAt}.blocks`, cell.blocks, seen, true);
    });
  });
  const problem = checkGrid(table as unknown as TableBlock);
  if (problem) fail(`${at}`, problem);
}

function checkBlocks(path: string, value: unknown, seen: Set<string>, inCell = false): void {
  if (!Array.isArray(value)) fail(path, "expected an array");
  (value as unknown[]).forEach((block, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(block)) fail(at, "expected a block object");
    claim(`${at}.id`, seen, block.id);
    if (inCell && !CELL_TYPES.has(block.type as string)) {
      fail(`${at}.type`, `${JSON.stringify(block.type)} can't go inside a table cell`);
    }

    switch (block.type) {
      case "paragraph":
      case "title":
      case "subtitle":
      case "quote":
        only(at, block, TEXT_FIELDS);
        checkAlign(at, block.align);
        checkFormat(at, block.format);
        checkRuns(`${at}.runs`, block.runs);
        break;
      case "heading":
        only(at, block, [...TEXT_FIELDS, "level"]);
        if (![1, 2, 3, 4, 5, 6].includes(block.level as number)) fail(`${at}.level`, "expected 1 to 6");
        checkAlign(at, block.align);
        checkFormat(at, block.format);
        checkRuns(`${at}.runs`, block.runs);
        break;
      case "list_item":
        only(at, block, [...TEXT_FIELDS, "list", "depth", "marker", "start"]);
        if (block.list !== "bullet" && block.list !== "ordered") fail(`${at}.list`, 'expected "bullet" or "ordered"');
        if (!Number.isInteger(block.depth) || (block.depth as number) < 0) {
          fail(`${at}.depth`, "expected a non-negative integer");
        }
        if (block.marker !== undefined) {
          const allowed = block.list === "bullet" ? BULLET_MARKERS : NUMBER_MARKERS;
          if (!(allowed as readonly unknown[]).includes(block.marker)) fail(`${at}.marker`, `expected one of ${allowed.join(", ")}`);
        }
        if (block.start !== undefined) {
          if (block.list !== "ordered") fail(`${at}.start`, "only a numbered item has a start");
          if (!Number.isInteger(block.start) || (block.start as number) < 0 || (block.start as number) > MAX_LIST_START) fail(`${at}.start`, `expected a whole number from 0 to ${MAX_LIST_START}`);
        }
        checkAlign(at, block.align);
        checkFormat(at, block.format);
        checkRuns(`${at}.runs`, block.runs);
        break;
      case "code_block":
        only(at, block, ["id", "type", "language", "runs"]);
        if (block.language !== undefined) str(`${at}.language`, block.language);
        checkRuns(`${at}.runs`, block.runs);
        break;
      case "divider":
      case "page_break":
        only(at, block, ["id", "type"]);
        break;
      case "section_break":
        only(at, block, ["id", "type", "kind", "columns", "page", "differentFirstPage", "regions"]);
        if (block.kind !== "next_page" && block.kind !== "continuous") fail(`${at}.kind`, 'expected "next_page" or "continuous"');
        checkColumns(`${at}.columns`, block.columns);
        checkSectionPage(`${at}.page`, block.page);
        if (block.differentFirstPage !== undefined && typeof block.differentFirstPage !== "boolean") fail(`${at}.differentFirstPage`, "expected true or false");
        checkSectionRegions(`${at}.regions`, block.regions);
        break;
      case "image":
        only(at, block, ["id", "type", "src", "alt", "width", "height", "align", "wrap", "crop", "float"]);
        str(`${at}.src`, block.src, { nonEmpty: true });
        if (block.alt !== undefined) str(`${at}.alt`, block.alt);
        num(`${at}.width`, block.width, 1, 20000);
        num(`${at}.height`, block.height, 1, 20000);
        checkAlign(at, block.align);
        if (block.wrap !== undefined && block.wrap !== "left" && block.wrap !== "right") fail(`${at}.wrap`, 'expected "left" or "right"');
        if (block.float !== undefined) {
          if (inCell) fail(`${at}.float`, "a picture inside a table cell or text box can't float");
          if (!isObject(block.float)) fail(`${at}.float`, "expected an object");
          only(`${at}.float`, block.float, ["x", "y", "behind", "z"]);
          checkPlacement(`${at}.float`, block.float);
          if (block.wrap !== undefined) fail(`${at}.wrap`, "a floating picture takes no room in the text, so nothing wraps");
        }
        if (block.crop !== undefined) {
          if (typeof block.crop !== "object" || block.crop === null || Array.isArray(block.crop)) fail(`${at}.crop`, "expected an object");
          const crop = block.crop as Record<string, unknown>;
          only(`${at}.crop`, crop, ["top", "right", "bottom", "left"]);
          for (const side of ["top", "right", "bottom", "left"]) num(`${at}.crop.${side}`, crop[side], 0, 0.9);
          if ((crop.left as number) + (crop.right as number) > 0.95 || (crop.top as number) + (crop.bottom as number) > 0.95) fail(`${at}.crop`, "too much is cut away");
        }
        break;
      case "toc":
        only(at, block, ["id", "type", "levels", "title"]);
        if (![1, 2, 3, 4, 5, 6].includes(block.levels as number)) fail(`${at}.levels`, "expected 1 to 6");
        if (block.title !== undefined) str(`${at}.title`, block.title);
        break;
      case "table":
        checkTable(at, block, seen);
        break;
      default:
        fail(`${at}.type`, `unknown block type ${JSON.stringify(block.type)}`);
    }
  });
}

function checkSectionPage(path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, "expected an object");
  only(path, value, ["size", "orientation", "margins"]);
  if (value.size !== undefined && !(str(`${path}.size`, value.size) in PAGE_SIZES)) {
    fail(`${path}.size`, `expected one of ${Object.keys(PAGE_SIZES).join(", ")}`);
  }
  if (value.orientation !== undefined && value.orientation !== "portrait" && value.orientation !== "landscape") {
    fail(`${path}.orientation`, 'expected "portrait" or "landscape"');
  }
  if (value.margins !== undefined) {
    const margins = value.margins;
    if (!isObject(margins)) fail(`${path}.margins`, "expected an object");
    only(`${path}.margins`, margins, ["top", "right", "bottom", "left"]);
    for (const side of ["top", "right", "bottom", "left"]) num(`${path}.margins.${side}`, margins[side], 0, 5);
  }
}

function checkSectionRegions(path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, "expected an object");
  only(path, value, REGION_NAMES);
  for (const [name, blocks] of Object.entries(value)) {
    checkBlocks(`${path}.${name}`, blocks, new Set());
    if ((blocks as Block[]).some((b) => b.type === "section_break")) fail(`${path}.${name}`, "a header or footer can't hold a section break");
  }
}

function checkColumns(path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail(path, "expected an object");
  only(path, value, ["count", "gap", "rule"]);
  if (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 4) fail(`${path}.count`, "expected a whole number from 1 to 4");
  if (value.gap !== undefined) num(`${path}.gap`, value.gap, 0, 200);
  if (value.rule !== undefined && typeof value.rule !== "boolean") fail(`${path}.rule`, "expected true or false");
}

function checkPage(path: string, value: unknown): void {
  if (!isObject(value)) fail(path, "expected an object");
  only(path, value, ["size", "orientation", "margins", "columns", "differentFirstPage", "differentOddEven"]);
  checkColumns(`${path}.columns`, value.columns);
  for (const flag of ["differentFirstPage", "differentOddEven"]) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") fail(`${path}.${flag}`, "expected true or false");
  }
  if (!(str(`${path}.size`, value.size) in PAGE_SIZES)) {
    fail(`${path}.size`, `expected one of ${Object.keys(PAGE_SIZES).join(", ")}`);
  }
  if (value.orientation !== "portrait" && value.orientation !== "landscape") {
    fail(`${path}.orientation`, 'expected "portrait" or "landscape"');
  }
  const margins = value.margins;
  if (!isObject(margins)) fail(`${path}.margins`, "expected an object");
  only(`${path}.margins`, margins, ["top", "right", "bottom", "left"]);
  for (const side of ["top", "right", "bottom", "left"]) num(`${path}.margins.${side}`, margins[side], 0, 5);
}

function checkThread(path: string, id: string, value: unknown): void {
  if (!isObject(value)) fail(path, "expected a thread object");
  only(path, value, ["id", "anchor", "comments", "resolved", "createdAt"]);
  if (str(`${path}.id`, value.id, { nonEmpty: true }) !== id) fail(`${path}.id`, "must match its key");
  num(`${path}.createdAt`, value.createdAt, 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(value.comments)) fail(`${path}.comments`, "expected an array");
  (value.comments as unknown[]).forEach((c, i) => {
    const at = `${path}.comments[${i}]`;
    if (!isObject(c)) fail(at, "expected a comment object");
    only(at, c, ["id", "author", "body", "createdAt", "editedAt", "mentions"]);
    str(`${at}.id`, c.id, { nonEmpty: true });
    str(`${at}.author`, c.author, { nonEmpty: true });
    str(`${at}.body`, c.body);
    num(`${at}.createdAt`, c.createdAt, 0, Number.MAX_SAFE_INTEGER);
    if (c.editedAt !== undefined) num(`${at}.editedAt`, c.editedAt, 0, Number.MAX_SAFE_INTEGER);
    if (c.mentions !== undefined) {
      if (!Array.isArray(c.mentions)) fail(`${at}.mentions`, "expected an array");
      (c.mentions as unknown[]).forEach((m, j) => str(`${at}.mentions[${j}]`, m, { nonEmpty: true }));
    }
  });
  if (value.resolved !== undefined) {
    if (!isObject(value.resolved)) fail(`${path}.resolved`, "expected an object");
    only(`${path}.resolved`, value.resolved, ["by", "at"]);
    str(`${path}.resolved.by`, value.resolved.by, { nonEmpty: true });
    num(`${path}.resolved.at`, value.resolved.at, 0, Number.MAX_SAFE_INTEGER);
  }
  if (value.anchor !== undefined) {
    const a = value.anchor;
    if (!isObject(a)) fail(`${path}.anchor`, "expected an object");
    only(`${path}.anchor`, a, ["block", "from", "to", "quote"]);
    str(`${path}.anchor.block`, a.block);
    num(`${path}.anchor.from`, a.from, 0, Number.MAX_SAFE_INTEGER);
    num(`${path}.anchor.to`, a.to, 0, Number.MAX_SAFE_INTEGER);
    str(`${path}.anchor.quote`, a.quote);
  }
}

/**
 * Checks that an unknown value is a well-formed document and returns it typed.
 * Throws a `PliError` with code `invalid_document` and a path to the first problem.
 */
export function validateDoc(value: unknown): Doc {
  if (!isObject(value)) fail("doc", "expected an object");
  only("doc", value, ["id", "type", "title", "blocks", "page", "footnotes", "comments", "styles", ...REGION_NAMES]);
  if (value.type !== "document") fail("doc.type", 'expected "document"');
  str("doc.id", value.id, { nonEmpty: true });
  str("doc.title", value.title);
  checkBlocks("doc.blocks", value.blocks, new Set());
  if (value.page !== undefined) checkPage("doc.page", value.page);
  if (value.footnotes !== undefined) {
    if (!isObject(value.footnotes)) fail("doc.footnotes", "expected an object");
    for (const [id, blocks] of Object.entries(value.footnotes)) {
      if (id === "") fail("doc.footnotes", "a note needs an id");
      checkBlocks(`doc.footnotes.${id}`, blocks, new Set());
      for (const b of blocks as Block[]) {
        if (!isNoteBlock(b)) fail(`doc.footnotes.${id}`, `a footnote can't hold a ${b.type}`);
      }
      if ((blocks as unknown[]).length === 0) fail(`doc.footnotes.${id}`, "a note needs at least one block");
    }
  }
  if (value.styles !== undefined) checkStyles("doc.styles", value.styles);
  if (value.comments !== undefined) {
    if (!isObject(value.comments)) fail("doc.comments", "expected an object");
    for (const [id, thread] of Object.entries(value.comments)) checkThread(`doc.comments.${id}`, id, thread);
  }
  // Every reference must have its note.
  const notes = (value.footnotes ?? {}) as Record<string, unknown>;
  for (const id of footnoteIds(value.blocks as Block[])) {
    if (!(id in notes)) fail("doc.blocks", `a footnote reference points at "${id}", which has no note`);
  }
  // Each region has its own set of ids, as the header and footer are separate documents when edited.
  for (const name of REGION_NAMES) {
    if (value[name] === undefined) continue;
    checkBlocks(`doc.${name}`, value[name], new Set());
    if ((value[name] as Block[]).some((b) => b.type === "section_break")) fail(`doc.${name}`, "a header or footer can't hold a section break");
  }
  return value as unknown as Doc;
}

/** Serializes a document to a versioned JSON string, safe to store or send. */
export function serializeDoc(doc: Doc): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, doc: pruneFootnotes(doc) });
}

/** Parses and validates a string produced by `serializeDoc`. */
export function parseDoc(json: string): Doc {
  let envelope: unknown;
  try {
    envelope = JSON.parse(json);
  } catch {
    throw new PliError("invalid_document", "Not valid JSON");
  }
  if (!isObject(envelope) || envelope.format !== FORMAT) {
    throw new PliError("invalid_document", `Not a Pli document (expected format "${FORMAT}")`);
  }
  if (envelope.version !== VERSION) {
    throw new PliError(
      "unsupported",
      `Document version ${String(envelope.version)} isn't supported by this release (supports ${VERSION})`,
    );
  }
  return validateDoc(envelope.doc);
}
