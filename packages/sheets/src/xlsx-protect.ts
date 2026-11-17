import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { PERMISSIONS, cleanEditRanges, cleanSheetProtection } from "./protect";
import { MAX_COLS, type Cell, type Dimension, type EditRange, type PasswordHash, type Permission, type Sheet, type SheetProtection, type WorkbookProtection } from "./model";
import { colName, colNumber, parseRange, rangeAddress } from "./address";
import { cleanRoleTable, cleanRoles } from "./access";
import { defaultLock, hasLockDefaults, lockAt } from "./locks";
import { defaultHide, hasHideDefaults, hideAt } from "./hide";
import { descriptorFor, parseSddl } from "./account";

/*
 * Protection in an .xlsx file. A cell's lock is part of its style (`<protection locked="0" hidden="1"/>`). A sheet's is a
 * `sheetProtection` element: `sheet="1"` and, for each thing people may do, an attribute that says whether it is locked
 * (formatCells="0" lets them format, though most are locked by default, so only what is allowed is written). The password
 * is Excel's salted SHA-512 (`algorithmName`, `hashValue`, `saltValue`, `spinCount`) or, from an old file, a 16-bit hash.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const truthy = (v: string | undefined) => v === "1" || v === "true";
const falsy = (v: string | undefined) => v === "0" || v === "false";

/** What Excel locks unless told otherwise (`formatCells` and the others) and what it allows (`objects`, `scenarios`, and selecting cells, which are locked by saying so). */
const LOCKED_BY_DEFAULT: Permission[] = ["formatCells", "formatColumns", "formatRows", "insertColumns", "insertRows", "insertHyperlinks", "deleteColumns", "deleteRows", "sort", "autoFilter", "pivotTables"];
const ALLOWED_BY_DEFAULT: Permission[] = ["objects", "scenarios", "selectLockedCells", "selectUnlockedCells"];

/** The `<protection>` of a cell's `xf`, or an empty string for a cell that is locked and shows its formula. */
export function cellProtectionXml(locked: boolean | undefined, hideFormula: boolean | undefined): string {
  if (locked !== false && !hideFormula) return "";
  return `<protection${locked === false ? ' locked="0"' : ""}${hideFormula ? ' hidden="1"' : ""}/>`;
}

function passwordAttrs(p: PasswordHash | undefined, prefix: "" | "workbook"): string {
  if (!p) return "";
  if (p.algorithm === "legacy") return ` ${prefix ? "workbookPassword" : "password"}="${p.hash}"`;
  const name = (n: string) => (prefix ? `${prefix}${n}` : n.charAt(0).toLowerCase() + n.slice(1));
  return ` ${name("AlgorithmName")}="SHA-512" ${name("HashValue")}="${esc(p.hash)}" ${name("SaltValue")}="${esc(p.salt)}" ${name("SpinCount")}="${p.spins}"`;
}

export function sheetProtectionXml(p: SheetProtection | undefined): string {
  if (!p) return "";
  const allow = new Set(p.allow);
  const flags: string[] = [];
  for (const perm of LOCKED_BY_DEFAULT) if (allow.has(perm)) flags.push(`${perm}="0"`);
  for (const perm of ["objects", "scenarios", "selectLockedCells", "selectUnlockedCells"] as const) if (!allow.has(perm)) flags.push(`${perm}="1"`);
  return `<sheetProtection${passwordAttrs(p.password, "")} sheet="1" ${flags.join(" ")}/>`.replace(/ \/>$/, "/>").replace(/ {2,}/g, " ");
}

function readPassword(el: XmlElement, prefix: "" | "workbook", warnings: Set<string>, what: string): PasswordHash | undefined {
  const name = (n: string) => (prefix ? `${prefix}${n}` : n.charAt(0).toLowerCase() + n.slice(1));
  const legacy = attr(el, prefix ? "workbookPassword" : "password");
  const algorithm = attr(el, name("AlgorithmName"));
  if (algorithm) {
    const hash = attr(el, name("HashValue"));
    const salt = attr(el, name("SaltValue"));
    const spins = Number(attr(el, name("SpinCount")));
    if (algorithm !== "SHA-512" || !hash || !salt || !Number.isInteger(spins) || spins < 1 || spins > 10_000_000) {
      warnings.add(`${what} has a password Pli can't check (${algorithm}), so it is kept without one`);
      return undefined;
    }
    return { algorithm: "SHA-512", salt, hash, spins };
  }
  if (legacy && /^[0-9A-Fa-f]{4}$/.test(legacy)) return { algorithm: "legacy", hash: legacy.toUpperCase() };
  return undefined;
}

export function readSheetProtection(el: XmlElement | undefined, warnings: Set<string>): SheetProtection | undefined {
  if (!el || !truthy(attr(el, "sheet"))) return undefined;
  const allow: Permission[] = [];
  for (const perm of PERMISSIONS) {
    const v = attr(el, perm);
    if (LOCKED_BY_DEFAULT.includes(perm) ? falsy(v) : ALLOWED_BY_DEFAULT.includes(perm) ? !truthy(v) : false) allow.push(perm);
  }
  const password = readPassword(el, "", warnings, "A protected sheet");
  return { ...(password ? { password } : {}), allow };
}

export function workbookProtectionXml(p: WorkbookProtection | undefined): string {
  return p ? `<workbookProtection${passwordAttrs(p.password, "workbook")} lockStructure="1"/>` : "";
}

export function readWorkbookProtection(el: XmlElement | undefined, warnings: Set<string>): WorkbookProtection | undefined {
  if (!el || !truthy(attr(el, "lockStructure"))) return undefined;
  const password = readPassword(el, "workbook", warnings, "The workbook");
  return { structure: true, ...(password ? { password } : {}) };
}

// ---- ranges that people may edit ----

/** Whether Excel's own list of ranges holds this one: it names nobody, or has a password, or names accounts (by SID) that Excel knows. */
const inExcelsList = (r: EditRange) => ((!r.permissions && !r.denied) || !!r.password || descriptorFor(r) !== "");

/**
 * `protectedRanges`: the ranges that may be edited, each with its title and, when it has one, its password. Who may edit without
 * the password is Excel's `securityDescriptor` (Windows accounts): the accounts of a range's `permissions` and `denied` that are
 * security identifiers (`sid:S-1-5-21-…`) are written as one, or the one that was read is written as it was. A range that names
 * only roles of Pli's own is written only when it has a password, as that password-based range. One that names roles and has
 * no password or accounts is left out of this list (Excel would let everyone in) and kept in the Pli extension (`accessExtXml`)
 * instead, so that its cells stay locked in Excel.
 */
export function protectedRangesXml(sheet: Sheet): string {
  const list = (sheet.editRanges ?? []).filter(inExcelsList);
  if (!list.length) return "";
  return `<protectedRanges>${list.map((r) => `<protectedRange${passwordAttrs(r.password, "")} sqref="${esc(r.ranges.join(" "))}" name="${esc(r.name)}"${descriptorFor(r) ? ` securityDescriptor="${esc(descriptorFor(r))}"` : ""}/>`).join("")}</protectedRanges>`;
}

export function readProtectedRanges(el: XmlElement | undefined, warnings: Set<string>): EditRange[] {
  const out: EditRange[] = [];
  for (const pr of childrenNamed(el, "protectedRange")) {
    const name = attr(pr, "name")?.trim();
    const ranges = (attr(pr, "sqref") ?? "").split(/\s+/).map((x) => x.replace(/\$/g, "")).filter(Boolean).flatMap((x) => {
      const b = parseRange(x.toUpperCase());
      return b ? [rangeAddress(b)] : [];
    });
    if (!name || !ranges.length) {
      warnings.add("A range that people may edit with no title or no cells was left out");
      continue;
    }
    const password = readPassword(pr, "", warnings, `The range "${name}"`);
    const account = attr(pr, "securityDescriptor")?.trim();
    let named: ReturnType<typeof parseSddl> | undefined;
    if (account) {
      try {
        named = parseSddl(account);
        cleanEditRanges([{ name, ranges, securityDescriptor: account }]);
      } catch {
        named = undefined;
      }
      if (!named || (!named.allow.length && !named.deny.length)) {
        warnings.add(`The range "${name}" names Windows accounts in a way Pli can't read; it is kept as it was, with nobody named, so that only its password opens it`);
        named = { allow: [], deny: [] };
      }
    }
    out.push({ name, ranges, ...(password ? { password } : {}), ...(named ? { permissions: named.allow } : {}), ...(named?.deny.length ? { denied: named.deny } : {}), ...(account && /^[\x20-\x7e]+$/.test(account) && !/[<>&"']/.test(account) ? { securityDescriptor: account } : {}) });
  }
  try {
    return cleanEditRanges(out);
  } catch {
    warnings.add("Some ranges that people may edit have the same title and were left out");
    const seen = new Set<string>();
    return out.filter((r) => !seen.has(r.name.toLowerCase()) && !!seen.add(r.name.toLowerCase()));
  }
}

// ---- Pli's own part of the protection: roles ----

const PLI_EXT = "{3B6C3D52-5F0B-4C0E-A3E4-6D9C1B7F2A10}";

/**
 * What Excel has no counterpart for: the roles that may do things on a protected sheet, and the ranges that name roles. Written
 * as an extension (`ext`) of the sheet with its own address, which Excel ignores (and drops when it saves).
 */
export function accessExtXml(sheet: Sheet): string {
  const protection = sheet.protection;
  // Only what Excel's own list can't say: roles of Pli's own, and ranges that the list leaves out.
  const named = (sheet.editRanges ?? []).filter((r) => (r.permissions || r.denied) && (!inExcelsList(r) || [...(r.permissions ?? []), ...(r.denied ?? [])].some((p) => !/^sid:/i.test(p))));
  const data: Record<string, unknown> = {};
  if (protection?.roles) data["roles"] = protection.roles;
  if (protection?.editLocked) data["editLocked"] = protection.editLocked;
  if (named.length) data["ranges"] = named.map((r) => ({ name: r.name, ...(r.permissions ? { permissions: r.permissions } : {}), ...(r.denied ? { denied: r.denied } : {}), ...(inExcelsList(r) ? {} : { ranges: r.ranges }) }));
  if (!Object.keys(data).length) return "";
  return `<ext uri="${PLI_EXT}" xmlns:pli="urn:pli:sheets"><pli:access>${esc(JSON.stringify(data))}</pli:access></ext>`;
}

/** Reads what `accessExtXml` wrote into the sheet. */
export function readAccessExt(root: XmlElement | undefined, sheet: Sheet, warnings: Set<string>): void {
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    const el = child(ext, "access");
    if (!el || attr(ext, "uri") !== PLI_EXT) continue;
    let data: { roles?: unknown; editLocked?: unknown; ranges?: unknown };
    try {
      data = JSON.parse(textOf(el));
    } catch {
      warnings.add("Pli's roles on a protected sheet could not be read and were left out");
      continue;
    }
    try {
      if (sheet.protection) {
        const roles = cleanRoleTable(data.roles, PERMISSIONS);
        const editLocked = data.editLocked === undefined ? [] : cleanRoles(data.editLocked, "editLocked");
        sheet.protection = cleanSheetProtection({ ...sheet.protection, ...(roles ? { roles } : {}), ...(editLocked.length ? { editLocked } : {}) });
      }
      if (Array.isArray(data.ranges)) {
        const list = [...(sheet.editRanges ?? [])];
        for (const r of data.ranges as { name?: unknown; permissions?: unknown; denied?: unknown; ranges?: unknown }[]) {
          const name = String(r.name ?? "").toLowerCase();
          const permissions = r.permissions === undefined ? undefined : cleanRoles(r.permissions, "permissions");
          const denied = r.denied === undefined ? undefined : cleanRoles(r.denied, "denied");
          const at = list.findIndex((x) => x.name.toLowerCase() === name);
          if (at >= 0) {
            // The roles of Pli's own come back; the accounts Excel's list holds are as the file says.
            const kept = list[at]!;
            list[at] = { ...kept, ...(permissions ? { permissions } : {}), ...(denied ? { denied } : {}) };
          } else if (Array.isArray(r.ranges)) list.push({ name: String(r.name), ranges: r.ranges as string[], ...(permissions ? { permissions } : {}), ...(denied ? { denied } : {}) });
        }
        sheet.editRanges = cleanEditRanges(list);
      }
    } catch {
      warnings.add("Pli's roles on a protected sheet could not be read and were left out");
    }
  }
}

/** The workbook's part: the roles that may change its structure. */
export function workbookAccessExt(p: WorkbookProtection | undefined): string {
  return p?.roles?.length ? `<ext uri="${PLI_EXT}" xmlns:pli="urn:pli:sheets"><pli:access>${esc(JSON.stringify({ structureRoles: p.roles }))}</pli:access></ext>` : "";
}

export function readWorkbookAccessExt(book: XmlElement | undefined, protection: WorkbookProtection | undefined): WorkbookProtection | undefined {
  if (!protection) return protection;
  for (const ext of childrenNamed(child(book, "extLst"), "ext")) {
    const el = child(ext, "access");
    if (!el || attr(ext, "uri") !== PLI_EXT) continue;
    try {
      const roles = cleanRoles((JSON.parse(textOf(el)) as { structureRoles?: unknown }).structureRoles, "structureRoles");
      if (roles.length) return { ...protection, roles };
    } catch {
      // Unreadable roles are left out.
    }
  }
  return protection;
}

// ---- locks that columns and rows carry ----

/** The `<col>` elements. `attrs` are a column's own (width, hiding, groups); `xfFor` gives the style number for a lock. */
export function colsXml(sheet: Sheet, attrsOf: (d: Dimension) => string, xfFor: (locked: boolean, hidden: boolean) => number): string {
  const entries = Object.entries(sheet.columns ?? {})
    .map(([letters, d]) => [colNumber(letters), d] as const)
    .sort((a, b) => a[0] - b[0]);
  const base = !sheet.unlocked;
  const baseHide = !!sheet.hiddenFormulas;
  const out: string[] = [];
  const gap = (from: number, to: number) => {
    if ((!base || baseHide) && to >= from) out.push(`<col min="${from}" max="${to}" width="8.43" style="${xfFor(base, baseHide)}"/>`);
  };
  let next = 1;
  for (const [n, d] of entries) {
    gap(next, n - 1);
    const locked = d.locked ?? base;
    const hidden = d.hideFormula ?? baseHide;
    out.push(`<col min="${n}" max="${n}" ${attrsOf(d)}${locked && !hidden ? "" : ` style="${xfFor(locked, hidden)}"`}/>`);
    next = n + 1;
  }
  gap(next, MAX_COLS);
  return out.join("");
}

/** A row's own lock as attributes: its style, and the mark that says the row has one. */
export function rowLockAttrs(d: Dimension | undefined, xfFor: (locked: boolean, hidden: boolean) => number, sheet?: Pick<Sheet, "unlocked" | "hiddenFormulas">): string {
  if (d?.locked === undefined && d?.hideFormula === undefined) return "";
  // A row has one style for all its cells, so it says both: what it says itself, and for the other what the sheet says.
  return ` s="${xfFor(d.locked ?? !sheet?.unlocked, d.hideFormula ?? !!sheet?.hiddenFormulas)}" customFormat="1"`;
}

/** A cell's style as it is written: with the lock it has, which may come from its row, column or sheet. */
export function styleWithLock<T extends { locked?: boolean; hideFormula?: boolean } | undefined>(sheet: Sheet, address: string, cell: Cell, style: T): T {
  const locks = hasLockDefaults(sheet);
  const hides = hasHideDefaults(sheet);
  if (!locks && !hides) return style;
  const [row, col] = rc(address) as [number, number];
  const out = { ...style } as { locked?: boolean; hideFormula?: boolean };
  if (locks) {
    if (lockAt(sheet, row, col, cell)) delete out.locked;
    else out.locked = false;
  }
  if (hides) {
    if (hideAt(sheet, row, col, cell)) out.hideFormula = true;
    else delete out.hideFormula;
  }
  return (Object.keys(out).length ? out : undefined) as T;
}

const rc = (address: string): number[] => {
  const m = /^([A-Z]+)(\d+)$/.exec(address)!;
  return [Number(m[2]), colNumber(m[1]!)];
};

/** The lock a column holds in a file (false for unlocked), for the columns the file's `<col>` elements cover. */
export function readColumnLocks(cols: XmlElement[], lockOfStyle: (style: number) => boolean): { columns: Record<string, Dimension>; unlocked: boolean } {
  const unlocked = new Array<boolean>(MAX_COLS + 2).fill(false);
  let count = 0;
  for (const col of cols) {
    const min = Number(attr(col, "min"));
    const max = Math.min(Number(attr(col, "max")), MAX_COLS);
    if (!(min >= 1) || !(max >= min) || attr(col, "style") === undefined || lockOfStyle(Number(attr(col, "style")))) continue;
    for (let c = min; c <= max; c++) if (!unlocked[c]) {
      unlocked[c] = true;
      count++;
    }
  }
  const out: Record<string, Dimension> = {};
  if (!count) return { columns: out, unlocked: false };
  const base = count > MAX_COLS / 2; // the sheet is unlocked, and the locked columns say so
  for (let c = 1; c <= MAX_COLS; c++) if (unlocked[c] !== base) out[colName(c)] = { locked: !unlocked[c] };
  return { columns: out, unlocked: base };
}

/** After reading: a row's lock that says what the sheet and columns would say anyway is dropped. */
export function tidyReadLocks(sheet: Sheet): void {
  const base = !sheet.unlocked;
  const columnsDiffer = Object.values(sheet.columns ?? {}).some((d) => d.locked !== undefined && d.locked !== base);
  if (columnsDiffer || !sheet.rows) return;
  for (const [k, d] of Object.entries(sheet.rows)) {
    if (d.locked !== base) continue;
    const { locked: _l, ...rest } = d;
    if (Object.keys(rest).length) sheet.rows[k] = rest;
    else delete sheet.rows[k];
  }
  if (!Object.keys(sheet.rows).length) delete sheet.rows;
}

/** What a cell read from a file keeps of its lock: only what differs from what its row, column and sheet say. */
export function readCellLock(sheet: Sheet, row: number, col: number, xfLocked: boolean, style: Cell["s"]): Cell["s"] {
  if (!hasLockDefaults(sheet)) return style;
  const out = { ...style };
  if (xfLocked === defaultLock(sheet, row, col)) delete out.locked;
  else out.locked = xfLocked;
  return Object.keys(out).length ? out : undefined;
}

/** The hidden formulas the columns hold in a file, for the columns the file's `<col>` elements cover (the same way as the locks). */
export function readColumnHides(cols: XmlElement[], hiddenOfStyle: (style: number) => boolean): { columns: Record<string, Dimension>; hidden: boolean } {
  const hides = new Array<boolean>(MAX_COLS + 2).fill(false);
  let count = 0;
  for (const col of cols) {
    const min = Number(attr(col, "min"));
    const max = Math.min(Number(attr(col, "max")), MAX_COLS);
    if (!(min >= 1) || !(max >= min) || attr(col, "style") === undefined || !hiddenOfStyle(Number(attr(col, "style")))) continue;
    for (let c = min; c <= max; c++) if (!hides[c]) {
      hides[c] = true;
      count++;
    }
  }
  const out: Record<string, Dimension> = {};
  if (!count) return { columns: out, hidden: false };
  const base = count > MAX_COLS / 2; // the sheet hides formulas, and the columns that show them say so
  for (let c = 1; c <= MAX_COLS; c++) if (hides[c] !== base) out[colName(c)] = { hideFormula: hides[c] };
  return { columns: out, hidden: base };
}

/** After reading: a row's setting that says what the sheet and columns would say anyway is dropped. */
export function tidyReadHides(sheet: Sheet): void {
  const base = !!sheet.hiddenFormulas;
  const columnsDiffer = Object.values(sheet.columns ?? {}).some((d) => d.hideFormula !== undefined && d.hideFormula !== base);
  if (columnsDiffer || !sheet.rows) return;
  for (const [k, d] of Object.entries(sheet.rows)) {
    if (d.hideFormula !== base) continue;
    const { hideFormula: _h, ...rest } = d;
    if (Object.keys(rest).length) sheet.rows[k] = rest;
    else delete sheet.rows[k];
  }
  if (!Object.keys(sheet.rows).length) delete sheet.rows;
}

/** What a cell read from a file keeps of its lock and of hiding its formula: only what differs from what its row, column and sheet say. */
export function readCellProtection(sheet: Sheet, row: number, col: number, xf: { locked?: boolean; hideFormula?: boolean } | undefined, style: Cell["s"]): Cell["s"] {
  let out = readCellLock(sheet, row, col, xf?.locked !== false, style);
  if (hasHideDefaults(sheet)) {
    const next = { ...out };
    if ((xf?.hideFormula === true) === defaultHide(sheet, row, col)) delete next.hideFormula;
    else next.hideFormula = xf?.hideFormula === true;
    out = Object.keys(next).length ? next : undefined;
  }
  return out;
}
