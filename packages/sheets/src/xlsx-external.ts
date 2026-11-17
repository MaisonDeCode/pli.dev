import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { cellAddress, parseCell, parseRange } from "./address";
import { externalSourceText, parseExternalRef } from "./external-list";
import { collectExternalRefs, formulaReadsOtherWorkbook, keptCells, splitExternalSheet, validationFormulas } from "./external-links";
import { parseFormula } from "./formula";
import type { ExternalBook, ExternalTable, ListSnapshot, Sheet, Validation, Workbook } from "./model";

/*
 * Lists read from another workbook, in an .xlsx file. Excel writes the source as `[1]Sheet1!$A$1:$A$3`, where 1 counts the
 * workbook's `externalReferences`; each is an `externalLink` part that names the file (in its relationships) and keeps the
 * cells that were read from it (`sheetDataSet`). Pli reads those cells as the rule's snapshot and writes them back, so the
 * list works in Excel before the other workbook is opened. The rule itself goes in the sheet's extension list
 * (`x14:dataValidations`), where Excel keeps lists that read outside the sheet.
 *
 * What Excel has no place for goes in an extension of Pli's own, which Excel ignores: that a list takes several items in a
 * cell (and their separator), the day a snapshot was read, and the real alert of such a list.
 */

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_LINK_PATH = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath";
const REL_LINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink";
export const EXTERNAL_LINK_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml";
/** The extension that holds what Pli keeps about data validation and Excel has no place for. */
export const PLI_VALIDATION_URI = "{7D0F9A2E-5C1B-4E83-9A47-3B6E1F2C8D55}";
const PLI_NS = "https://pli.dev/spreadsheetml/2026";
/** The extension of an `externalLink` part that holds the tables of the workbook that formulas here name (Excel keeps none). */
const PLI_TABLES_URI = "{3C8E2B71-9A4D-4F60-8E15-6D2A7B9C0F41}";
const X14_VALIDATIONS_URI = "{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ---- reading ----

/** One workbook a file links to, with the cells that were read from it, by sheet name and address. */
export interface LinkedBook {
  /** The file name (`Prices.xlsx`), taken from the path. */
  name: string;
  /** The path or address the file names. */
  path: string;
  sheets: Map<string, Map<string, string>>;
  /** The same cells with their types: numbers, true/false and text. */
  typed: Map<string, Map<string, string | number | boolean>>;
  /** The tables of the workbook that Pli's extension in the part names. */
  tables: ExternalTable[];
  /** The day Pli's extension says the cells were read. */
  read?: string;
}

const baseName = (path: string): string => {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

/** The workbooks the file links to, in the order `[1]`, `[2]`… count them. */
export function readLinkedBooks(book: XmlElement, rels: XmlElement | undefined, xml: (path: string) => XmlElement | undefined, relsOf: (part: string) => string): LinkedBook[] {
  const out: LinkedBook[] = [];
  for (const ref of childrenNamed(child(book, "externalReferences"), "externalReference")) {
    const rel = childrenNamed(rels, "Relationship").find((r) => r.attrs["Id"] === attr(ref, "id", "r"));
    const part = rel?.attrs["Target"] ? (rel.attrs["Target"].startsWith("/") ? rel.attrs["Target"].slice(1) : "xl/" + rel.attrs["Target"].replace(/^\.\//, "")) : undefined;
    const link = part ? xml(part) : undefined;
    const external = child(link, "externalBook");
    if (!part || !external) {
      out.push({ name: "", path: "", sheets: new Map(), typed: new Map(), tables: [] });
      continue;
    }
    const pathRel = childrenNamed(xml(relsOf(part)), "Relationship").find((r) => r.attrs["Id"] === attr(external, "id", "r"));
    const path = pathRel?.attrs["Target"] ?? "";
    const names = childrenNamed(child(external, "sheetNames"), "sheetName").map((n) => attr(n, "val") ?? "");
    const sheets = new Map<string, Map<string, string>>();
    const typed = new Map<string, Map<string, string | number | boolean>>();
    for (const data of childrenNamed(child(external, "sheetDataSet"), "sheetData")) {
      const name = names[Number(attr(data, "sheetId") ?? "0")];
      if (name === undefined) continue;
      const cells = sheets.get(name) ?? new Map<string, string>();
      const values = typed.get(name) ?? new Map<string, string | number | boolean>();
      for (const row of childrenNamed(data, "row"))
        for (const cell of childrenNamed(row, "cell")) {
          const address = attr(cell, "r");
          const v = textOf(child(cell, "v"));
          if (address && v !== "") {
            const type = attr(cell, "t");
            cells.set(address.toUpperCase(), type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v);
            // Errors are left out of the typed copy: a formula reads them as blank.
            if (type !== "e") values.set(address.toUpperCase(), type === "b" ? v === "1" : type === undefined || type === "n" ? (Number.isFinite(Number(v)) ? Number(v) : v) : v);
          }
        }
      sheets.set(name, cells);
      typed.set(name, values);
    }
    const tables: ExternalTable[] = [];
    let read: string | undefined;
    for (const ext of childrenNamed(child(link, "extLst"), "ext")) {
      if (attr(ext, "uri") !== PLI_TABLES_URI) continue;
      const day = attr(child(ext, "book"), "read");
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) read = day;
      for (const t of childrenNamed(child(ext, "tables"), "table")) {
        const columns = childrenNamed(t, "column").map((c) => attr(c, "name") ?? "");
        const name = attr(t, "name");
        const sheet = attr(t, "sheet");
        const range = attr(t, "range");
        if (name && sheet && range) tables.push({ name, sheet, range, columns, ...(attr(t, "header") === "0" ? { header: false as const } : {}), ...(attr(t, "totals") === "1" ? { totals: true as const } : {}) });
      }
    }
    out.push({ name: baseName(path), path, sheets, typed, tables, ...(read ? { read } : {}) });
  }
  return out;
}

/**
 * A list source that points at a linked workbook (`[1]Sheet1!$A$1:$A$3`) as a rule's source and snapshot, or null when it
 * isn't one. The source is written with the file's name, the way Excel's own dialog shows it.
 */
export function externalSource(formula: string, books: readonly LinkedBook[]): { source: string; snapshot: ListSnapshot } | null {
  // Excel's data validation extension names the file with its folder: '/Users/me/[Prices.xlsx]Sheet1'!$A$1:$A$3.
  const text = formula.trim().replace(/^=/, "");
  const folder = /^'(.*[\\/])?\[((?!\d+\])[^\]]+)\]((?:[^']|'')+)'!(.+)$/.exec(text) ?? /^()\[((?!\d+\])[^\]]+)\]([^'!\[\]]+)!(.+)$/.exec(text);
  if (folder) {
    const ref = parseExternalRef(`'[${folder[2]}]${folder[3]}'!${folder[4]}`);
    if (!ref) return null;
    const linked = books.find((b) => b.name.toLowerCase() === ref.book.toLowerCase());
    const cells = linked?.sheets.get(ref.sheet) ?? new Map<string, string>();
    const b = parseRange(ref.range)!;
    const items: string[] = [];
    for (let r = b.r1; r <= b.r2 && items.length < 10_000; r++) for (let c = b.c1; c <= b.c2 && items.length < 10_000; c++) items.push(cells.get(cellAddress(r, c)) ?? "");
    const path = linked?.path || (folder[1] ? `${folder[1]}${ref.book}` : "");
    return { source: externalSourceText(ref), snapshot: { items, ...(path ? { path } : {}) } };
  }
  const m = /^'?\[(\d+)\]/.exec(formula.trim());
  if (!m) return null;
  const linked = books[Number(m[1]) - 1];
  if (!linked || !linked.name) return null;
  const ref = parseExternalRef(formula.trim().replace(/\[\d+\]/, `[${linked.name}]`));
  if (!ref) return null;
  const cells = linked.sheets.get(ref.sheet) ?? new Map<string, string>();
  const b = parseRange(ref.range)!;
  const items: string[] = [];
  for (let r = b.r1; r <= b.r2 && items.length < 10_000; r++) for (let c = b.c1; c <= b.c2 && items.length < 10_000; c++) items.push(cells.get(cellAddress(r, c)) ?? "");
  return { source: externalSourceText(ref), snapshot: { items, ...(linked.path ? { path: linked.path } : {}) } };
}

/** The cells the file kept of the workbooks it links to, as the workbook keeps them. */
export function externalBooksOf(books: readonly LinkedBook[]): ExternalBook[] {
  const out: ExternalBook[] = [];
  for (const b of books) {
    if (!b.name || out.some((x) => x.name.toLowerCase() === b.name.toLowerCase())) continue;
    const sheets: ExternalBook["sheets"] = {};
    for (const [name, cells] of b.typed) sheets[name] = Object.fromEntries(cells);
    out.push({ name: b.name, ...(b.path && b.path !== b.name ? { path: b.path } : {}), sheets, ...(b.read ? { read: b.read } : {}), ...(b.tables.length ? { tables: b.tables } : {}) });
  }
  return out;
}

/** The workbook a file's `[n]` stands for, as formulas here name it (`Prices.xlsx`), or undefined. */
export const linkedName = (books: readonly LinkedBook[], n: number): string | undefined => books[n - 1]?.name || undefined;

/** What Pli's own extension says about a sheet's list rules, by their ranges. */
export interface PliValidationExtra {
  multiple?: boolean;
  separator?: string;
  alert?: string;
  read?: string;
  /** The entry is for a dropdown cell group (not a list rule). */
  dropdown?: boolean;
}

export function readPliValidationExtras(root: XmlElement): Map<string, PliValidationExtra> {
  const out = new Map<string, PliValidationExtra>();
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    if (attr(ext, "uri") !== PLI_VALIDATION_URI) continue;
    for (const v of childrenNamed(child(ext, "validations"), "validation")) {
      const key = (attr(v, "sqref") ?? "").trim().replace(/\s+/g, " ");
      out.set(key, { ...(attr(v, "multiple") === "1" ? { multiple: true } : {}), ...(attr(v, "separator") !== undefined ? { separator: attr(v, "separator")! } : {}), ...(attr(v, "alert") ? { alert: attr(v, "alert")! } : {}), ...(attr(v, "read") ? { read: attr(v, "read")! } : {}), ...(attr(v, "dropdown") === "1" ? { dropdown: true } : {}) });
    }
  }
  return out;
}

/** Puts what Pli's extension says on a list rule just read. */
export function withPliExtras(rule: Validation, extras: Map<string, PliValidationExtra>): Validation {
  if (rule.kind !== "list") return rule;
  const extra = extras.get(rule.ranges.join(" "));
  if (!extra || extra.dropdown) return rule;
  const next = { ...rule } as Extract<Validation, { kind: "list" }>;
  if (extra.multiple) {
    next.multiple = true;
    if (extra.separator !== undefined && extra.separator !== ", ") next.separator = extra.separator;
    if (extra.alert === "stop") delete next.alert;
    else if (extra.alert === "warning" || extra.alert === "information" || extra.alert === "none") next.alert = extra.alert;
  }
  if (next.snapshot && extra.read) next.snapshot = { ...next.snapshot, read: extra.read };
  return next;
}

// ---- writing ----

type ListRule = Extract<Validation, { kind: "list" }>;

interface BookOut {
  name: string;
  path: string;
  sheetNames: string[];
  cells: Map<string, Map<string, string | number | boolean>>;
  tables: ExternalTable[];
  read?: string;
}

const linkCache = new WeakMap<Workbook, { books: BookOut[]; at: Map<string, number> }>();

/**
 * The workbooks a workbook reads, in order (the number a file's `[n]` is), with the cells of each: what the workbook keeps of
 * them (`externalBooks`), the copies kept by list rules, and a place for every workbook that a formula, name or rule names.
 */
export function linkedBooksOf(wb: Workbook): { books: BookOut[]; index(book: string): number; indexOfRule(rule: ListRule): number } {
  let made = linkCache.get(wb);
  if (!made) {
    const books: BookOut[] = [];
    const at = new Map<string, number>();
    const bookOf = (name: string, path?: string): BookOut => {
      const key = name.toLowerCase();
      let i = at.get(key);
      if (i === undefined) {
        i = books.length;
        at.set(key, i);
        books.push({ name, path: path ?? name, sheetNames: [], cells: new Map(), tables: [] });
      }
      const out = books[i]!;
      if (path && out.path === out.name) out.path = path;
      return out;
    };
    const sheetOf = (out: BookOut, sheet: string) => {
      const known = out.sheetNames.find((s) => s.toLowerCase() === sheet.toLowerCase()) ?? sheet;
      if (!out.sheetNames.includes(known)) out.sheetNames.push(known);
      const cells = out.cells.get(known) ?? new Map<string, string | number | boolean>();
      out.cells.set(known, cells);
      return cells;
    };
    for (const kept of wb.externalBooks ?? []) {
      const out = bookOf(kept.name, kept.path);
      out.tables = [...(kept.tables ?? [])];
      if (kept.read) out.read = kept.read;
      for (const [sheet, cells] of Object.entries(kept.sheets)) {
        const into = sheetOf(out, sheet);
        for (const [address, v] of Object.entries(cells)) into.set(address, v);
      }
    }
    for (const sheet of wb.sheets)
      for (const rule of sheet.validations ?? []) {
        if (rule.kind !== "list") continue;
        const ref = parseExternalRef(rule.source);
        if (!ref) continue;
        const out = bookOf(ref.book, rule.snapshot?.path);
        const cells = sheetOf(out, ref.sheet);
        const b = parseRange(ref.range)!;
        let k = 0;
        for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++, k++) {
          const item = rule.snapshot?.items[k];
          // The copy a rule keeps is newer than nothing but older than what the workbook read for formulas.
          if (item !== undefined && item !== "" && !cells.has(cellAddress(r, c))) cells.set(cellAddress(r, c), looksNumeric(item) ? Number(item) : item);
        }
      }
    // A workbook that is named but was never read still needs its place.
    for (const want of collectExternalRefs(wb)) sheetOf(bookOf(want.book), want.sheet);
    made = { books, at };
    linkCache.set(wb, made);
  }
  return {
    books: made.books,
    // 0 for a workbook nothing here names.
    index: (book) => (made!.at.has(book.toLowerCase()) ? made!.at.get(book.toLowerCase())! + 1 : 0),
    indexOfRule: (rule) => (made!.at.get(parseExternalRef(rule.source)!.book.toLowerCase()) ?? 0) + 1,
  };
}

const looksNumeric = (v: string): boolean => v.trim() !== "" && String(Number(v)) === v && Number.isFinite(Number(v));

const cellXml = (address: string, value: string | number | boolean): string =>
  typeof value === "number" ? `<cell r="${address}"><v>${value}</v></cell>` : typeof value === "boolean" ? `<cell r="${address}" t="b"><v>${value ? 1 : 0}</v></cell>` : `<cell r="${address}" t="str"><v>${esc(value)}</v></cell>`;

const tablesExt = (book: { tables: readonly ExternalTable[]; read?: string }): string =>
  book.tables.length || book.read
    ? `<extLst><ext uri="${PLI_TABLES_URI}" xmlns:pli="${PLI_NS}">${book.read ? `<pli:book read="${esc(book.read)}"/>` : ""}${book.tables.length ? `<pli:tables>${book.tables.map((t) => `<pli:table name="${esc(t.name)}" sheet="${esc(t.sheet)}" range="${t.range}"${t.header === false ? ' header="0"' : ""}${t.totals ? ' totals="1"' : ""}>${t.columns.map((c) => `<pli:column name="${esc(c)}"/>`).join("")}</pli:table>`).join("")}</pli:tables>` : ""}</ext></extLst>`
    : "";

/** The parts for the workbooks the lists read: the `externalLink` parts with their relationships, and what the workbook, its relationships and its content types need. */
export function externalLinkParts(wb: Workbook, encode: (s: string) => Uint8Array): { files: Record<string, Uint8Array>; references: string; rels: string; overrides: string } | null {
  const { books } = linkedBooksOf(wb);
  if (!books.length) return null;
  const files: Record<string, Uint8Array> = {};
  books.forEach((book, i) => {
    const n = i + 1;
    const data = book.sheetNames
      .map((name, k) => {
        const cells = [...(book.cells.get(name) ?? [])];
        const rows = new Map<number, [string, string | number | boolean][]>();
        for (const [address, value] of cells) {
          const pos = parseCell(address)!;
          (rows.get(pos.row) ?? rows.set(pos.row, []).get(pos.row)!).push([address, value]);
        }
        const body = [...rows].sort((a, b) => a[0] - b[0]).map(([row, list]) => `<row r="${row}">${list.sort((a, b) => parseCell(a[0])!.col - parseCell(b[0])!.col).map(([a, v]) => cellXml(a, v)).join("")}</row>`).join("");
        return `<sheetData sheetId="${k}">${body}</sheetData>`;
      })
      .join("");
    files[`xl/externalLinks/externalLink${n}.xml`] = encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<externalLink xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><externalBook r:id="rId1"><sheetNames>${book.sheetNames.map((s) => `<sheetName val="${esc(s)}"/>`).join("")}</sheetNames><sheetDataSet>${data}</sheetDataSet></externalBook>${tablesExt(book)}</externalLink>`,
    );
    files[`xl/externalLinks/_rels/externalLink${n}.xml.rels`] = encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_LINK_PATH}" Target="${esc(book.path)}" TargetMode="External"/></Relationships>`,
    );
  });
  return {
    files,
    references: `<externalReferences>${books.map((_, i) => `<externalReference r:id="rIdExtLink${i + 1}"/>`).join("")}</externalReferences>`,
    rels: books.map((_, i) => `<Relationship Id="rIdExtLink${i + 1}" Type="${REL_LINK}" Target="externalLinks/externalLink${i + 1}.xml"/>`).join(""),
    overrides: books.map((_, i) => `<Override PartName="/xl/externalLinks/externalLink${i + 1}.xml" ContentType="${EXTERNAL_LINK_TYPE}"/>`).join(""),
  };
}

/** Whether a rule is written in the sheet's extension list (it reads another workbook) rather than in `dataValidations`. */
export const inExtension = (rule: Validation): boolean => (rule.kind === "list" && parseExternalRef(rule.source) !== null) || validationFormulas(rule).some(formulaReadsOtherWorkbook);

const flag = (rule: Validation): string[] => {
  const a: string[] = [`type="${rule.kind}"`];
  if (rule.alert === "warning" || rule.alert === "information") a.push(`errorStyle="${rule.alert}"`);
  else if (rule.kind === "list" && rule.multiple && !rule.alert) a.push('errorStyle="information"');
  if ("op" in rule && rule.op !== "between") a.push(`operator="${rule.op}"`);
  if (!rule.noBlank) a.push('allowBlank="1"');
  if (rule.kind === "list" && rule.hideArrow) a.push('showDropDown="1"');
  if (rule.prompt || rule.promptTitle) a.push('showInputMessage="1"');
  if (rule.alert !== "none") a.push('showErrorMessage="1"');
  if (rule.errorTitle) a.push(`errorTitle="${esc(rule.errorTitle.slice(0, 32))}"`);
  if (rule.error) a.push(`error="${esc(rule.error.slice(0, 255))}"`);
  if (rule.promptTitle) a.push(`promptTitle="${esc(rule.promptTitle.slice(0, 32))}"`);
  if (rule.prompt) a.push(`prompt="${esc(rule.prompt.slice(0, 255))}"`);
  return a;
};

/** The value of a cell of another workbook as the kept copy has it, written as a formula would write it (text in quotes), or null. */
function cachedLiteral(wb: Workbook, formula: string): string | null {
  let node;
  try {
    node = parseFormula(formula);
  } catch {
    return null;
  }
  if (node.t !== "ref" || node.b || node.sheet === undefined) return null;
  const split = splitExternalSheet(node.sheet);
  if (!split || node.a.col === null || node.a.row === null) return null;
  const v = keptCells(wb, { book: split.book, sheet: split.sheet, range: cellAddress(node.a.row, node.a.col) })?.[0];
  return v === undefined || v === null ? null : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `"${v.replace(/"/g, '""')}"`;
}

/**
 * A rule that reads another workbook as Excel can hold it. Excel resolved none of the ways of writing such a source in
 * the validation extension (`[1]Sheet1!…`, `'[Prices.xlsx]Sheet1'!…`, with or without the folder: every one came back
 * `…!#REF!`), so the rule is written from the values kept: a list as its items, a limit as the value of the cell it reads.
 * A rule that can't be (a formula over a range, items with a comma in them) is left out of the older part of the file;
 * Pli's extension holds the whole rule either way. `file` writes a formula that reads nothing outside the workbook.
 */
export function externalRuleXml(wb: Workbook, rule: Validation, file: (f: string) => string): string | null {
  let body: string;
  if (rule.kind === "list") {
    const ref = parseExternalRef(rule.source);
    const items = (rule.snapshot?.items ?? (ref ? (keptCells(wb, { book: ref.book, sheet: ref.sheet, range: ref.range }) ?? []).map((v) => (v === null ? "" : String(v))) : [])).filter((i) => i !== "");
    if (!items.length || items.some((i) => /[,"]/.test(i)) || items.join(",").length > 255) return null;
    body = `<formula1>"${esc(items.join(","))}"</formula1>`;
  } else if (rule.kind === "custom") return null;
  else {
    const literals = rule.values.map((v) => (formulaReadsOtherWorkbook(v) ? cachedLiteral(wb, v) : file(v)));
    if (literals.some((x) => x === null)) return null;
    body = `<formula1>${esc(literals[0]!)}</formula1>` + (literals[1] !== undefined ? `<formula2>${esc(literals[1]!)}</formula2>` : "");
  }
  return `<dataValidation ${flag(rule).join(" ")} sqref="${rule.ranges.join(" ")}">${body}</dataValidation>`;
}

/** What Pli's own extension says about the rules that read another workbook: the whole rule, by the cells it is on. */
export function readPliExternalRules(root: XmlElement): Map<string, Validation> {
  const out = new Map<string, Validation>();
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    if (attr(ext, "uri") !== PLI_VALIDATION_URI) continue;
    for (const v of childrenNamed(child(ext, "validations"), "external")) {
      try {
        const rule = JSON.parse(attr(v, "rule") ?? "") as Validation;
        if (rule && typeof rule === "object" && Array.isArray(rule.ranges) && rule.ranges.length) out.set(rule.ranges.join(" "), rule);
      } catch {
        // a rule that can't be read is left to the older part of the file
      }
    }
  }
  return out;
}

/**
 * Pli's extension for validation: the rules that read another workbook, whole (what the older part of the file holds of them
 * is only what Excel can use), lists with several items, snapshot dates and dropdown cells. Empty when the sheet has none.
 */
export function validationExtensionXml(wb: Workbook, sheet: Sheet): string {
  const rules = sheet.validations ?? [];
  const external = rules.filter((r) => inExtension(r));
  const extras = rules.filter((r): r is ListRule => r.kind === "list" && !inExtension(r) && (!!r.multiple || !!r.snapshot?.read));
  const dropdowns = dropdownExtras(sheet);
  if (!external.length && !extras.length && !dropdowns.length) return "";
  const items = extras.map((r) => `<pli:validation sqref="${r.ranges.join(" ")}"${r.multiple ? ` multiple="1" separator="${esc(r.separator ?? ", ")}" alert="${r.alert ?? "stop"}"` : ""}${r.snapshot?.read ? ` read="${esc(r.snapshot.read)}"` : ""}/>`);
  items.push(...dropdowns);
  for (const rule of external) {
    const { id: _id, ...rest } = rule;
    items.push(`<pli:external rule="${esc(JSON.stringify(rest))}"/>`);
  }
  void wb;
  return `<ext uri="${PLI_VALIDATION_URI}" xmlns:pli="${PLI_NS}"><pli:validations>${items.join("")}</pli:validations></ext>`;
}

/** The dropdown cells of a sheet that Excel can hold as a list, gathered by their choices (and the rest of what makes them alike). */
export interface DropdownGroup {
  values: string[];
  strict: boolean;
  multiple: boolean;
  separator?: string;
  cells: string[];
}

export function dropdownGroups(sheet: Sheet): DropdownGroup[] {
  const groups = new Map<string, DropdownGroup>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const k = cell.control;
    if (k?.type !== "dropdown") continue;
    const values = k.options.map((o) => o.value);
    if (values.some((v) => v.includes(",") || v.includes('"')) || values.join(",").length > 255) continue;
    const key = JSON.stringify([values, !!k.strict, !!k.multiple, k.multiple ? k.separator ?? ", " : null]);
    const group = groups.get(key);
    if (group) group.cells.push(address);
    else groups.set(key, { values, strict: !!k.strict, multiple: !!k.multiple, ...(k.multiple && k.separator && k.separator !== ", " ? { separator: k.separator } : {}), cells: [address] });
  }
  return [...groups.values()];
}

/** Pli's extension entries for the dropdown cells that take several choices: what Excel's list has no setting for. */
function dropdownExtras(sheet: Sheet): string[] {
  return dropdownGroups(sheet)
    .filter((g) => g.multiple)
    .map((g) => `<pli:validation sqref="${g.cells.join(" ")}" dropdown="1" multiple="1" separator="${esc(g.separator ?? ", ")}" alert="${g.strict ? "stop" : "none"}"/>`);
}
