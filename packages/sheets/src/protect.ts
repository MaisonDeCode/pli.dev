import { PliError } from "@pli.dev/core";
import { sha512 } from "./sha512";
import type { Cell, EditRange, PasswordHash, Permission, Sheet, SheetProtection, Table, Workbook, WorkbookProtection } from "./model";
import type { SheetOp } from "./ops";
import { noteExtrasDiffer } from "./note";
import { cleanRoleTable, cleanRoles, hasAnyRole, mayDo, mayEditLocked, openAt, rangeBounds, rangeStatus, type Access } from "./access";
import { anyLocked, lockOfKey } from "./locks";
import { hideOfKey } from "./hide";
import { cleanSecurityDescriptor } from "./account";
import { parseRange, rangeAddress, normalize, parseCell, type Bounds } from "./address";
import { MAX_COLS, MAX_ROWS } from "./model";

/** Everything a protected sheet can allow, in the order Excel's dialog lists them. */
export const PERMISSIONS: readonly Permission[] = ["selectLockedCells", "selectUnlockedCells", "formatCells", "formatColumns", "formatRows", "insertColumns", "insertRows", "insertHyperlinks", "deleteColumns", "deleteRows", "sort", "autoFilter", "pivotTables", "objects", "scenarios"];
/** What a sheet allows when it is protected without saying: selecting cells, as Excel does. */
export const DEFAULT_ALLOW: readonly Permission[] = ["selectLockedCells", "selectUnlockedCells"];

/** What each permission lets people do, in the words of the refusal and of a dialog. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  selectLockedCells: "Select locked cells",
  selectUnlockedCells: "Select unlocked cells",
  formatCells: "Format cells (including conditional formats and merging)",
  formatColumns: "Format columns (width, hiding)",
  formatRows: "Format rows (height, hiding)",
  insertColumns: "Insert columns",
  insertRows: "Insert rows",
  insertHyperlinks: "Insert links",
  deleteColumns: "Delete columns",
  deleteRows: "Delete rows",
  sort: "Sort",
  autoFilter: "Use filters and slicers",
  pivotTables: "Use pivot tables",
  objects: "Edit charts, pictures, slicers and notes",
  scenarios: "Edit scenarios",
};

/** An edit that a protected sheet or workbook refused. */
export class ProtectionError extends PliError {
  /** When the cell is in a range that people may edit with a password they haven't given yet: which one, so the password can be asked for. */
  readonly editRange?: { sheet: string; name: string };
  constructor(message: string, editRange?: { sheet: string; name: string }) {
    super("invalid_operation", message);
    this.name = "ProtectionError";
    if (editRange) this.editRange = editRange;
  }
}

// ---- passwords ----

/** Excel's own count; checking takes about a third of a second. */
const SPINS = 100_000;
const utf16 = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 255;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};
const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unbase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Excel's old 16-bit hash of a password, as four hex digits. */
export function legacyPasswordHash(password: string): string {
  let hash = 0;
  for (let i = password.length - 1; i >= 0; i--) {
    hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
    hash ^= password.charCodeAt(i);
  }
  hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
  hash ^= password.length;
  hash ^= 0xce4b;
  return hash.toString(16).toUpperCase().padStart(4, "0");
}

/** The salted, spun SHA-512 Excel keeps: the hash of the salt and the password, then of that and a counter, `spins` times. */
function spun(password: string, salt: Uint8Array, spins: number): string {
  let h = sha512(concat(salt, utf16(password)));
  const counter = new Uint8Array(4);
  const view = new DataView(counter.buffer);
  for (let i = 0; i < spins; i++) {
    view.setUint32(0, i, true);
    h = sha512(concat(h, counter));
  }
  return base64(h);
}

/** What to keep of a password, so it can be checked later and not read. `salt` is for tests; a new one is made otherwise. */
export function hashPassword(password: string, salt?: Uint8Array, spins = SPINS): PasswordHash {
  const s = salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: "SHA-512", salt: base64(s), hash: spun(password, s, spins), spins };
}

/** Whether the password is the one the hash was made from. */
export function checkPassword(hash: PasswordHash, password: string): boolean {
  if (hash.algorithm === "legacy") return legacyPasswordHash(password) === hash.hash.toUpperCase();
  return spun(password, unbase64(hash.salt), hash.spins) === hash.hash;
}

// ---- what a protected sheet refuses ----

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const contentOf = (c: Cell | undefined) => stable([c?.v ?? null, c?.e ?? null, c?.f ?? null, c?.control ?? null]);
const formatOf = (c: Cell | undefined) => {
  const { locked: _l, hideFormula: _h, ...rest } = c?.s ?? {};
  return stable([c?.fmt ?? null, rest]);
};
const lockOf = (sheet: Sheet, key: string, c: Cell | undefined) => `${lockOfKey(sheet, key, c)}|${hideOfKey(sheet, key, c)}`;

/** Whether a cell is locked: every cell is, unless it was unlocked. */
export const isLocked = (c: Cell | undefined): boolean => c?.s?.locked !== false;

const LOCKED = "That cell is locked, because the sheet is protected. To change it, unprotect the sheet (you may be asked for a password).";
const NEEDS_PASSWORD = (name: string) => `That cell is in "${name}", a range that people may edit with a password. Enter the password to edit it.`;
const NOT_YOU = (name: string) => `That cell is locked, because the sheet is protected. It is in "${name}", a range that only some people may edit, and you aren't one of them.`;
const NOT_ALLOWED = (perm: Permission) => `This sheet is protected, and it doesn't allow this (${PERMISSION_LABELS[perm].toLowerCase()}). To do it, unprotect the sheet (you may be asked for a password).`;
const ALWAYS = (what: string) => `${what} can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).`;
const DELETE_LOCKED = "The cell or chart you're trying to change is on a protected sheet. To make a change, unprotect the sheet (you may be asked for a password). Deleting rows or columns needs every cell in them unlocked, empty ones too.";
const DELETE_TABLE = "A table can't be resized while the sheet is protected, so rows and columns through it can't be deleted. Unprotect the sheet first (you may be asked for a password).";
const STRUCTURE = "The workbook's structure is protected, so sheets can't be added, deleted, renamed, moved or hidden. Unprotect the workbook first (you may be asked for a password).";

const filterOnly = (a: Table, b: Table) => stable({ ...a, filters: 0, sort: 0, filterButtons: 0 }) === stable({ ...b, filters: 0, sort: 0, filterButtons: 0 });

/**
 * Why the operations may not be applied to this workbook, or null. A protected sheet refuses changes to its locked cells and
 * whatever it doesn't allow; a workbook with its structure protected refuses changes to its sheets. Whole-workbook
 * rewrites (`restore`) aren't looked at: the methods that make them check for themselves.
 */
export function protectionRefusal(wb: Workbook, opsIn: readonly SheetOp[], access: Access = {}, detail?: { editRange?: { sheet: string; name: string } }): string | null {
  // Rows put in or taken out at many places are checked as the same rows one place at a time (they are all in the sheet's rows as they are now).
  const ops: readonly SheetOp[] = opsIn.some((o) => o.type === "insert_row_runs" || o.type === "delete_row_runs" || o.type === "set_sizes")
    ? opsIn.flatMap((o): SheetOp[] =>
        o.type === "insert_row_runs"
          ? [{ type: "insert_rows", sheet: o.sheet, at: o.runs[0]?.[0] ?? 1, count: 1 }]
          : o.type === "delete_row_runs"
            ? o.runs.map(([at, count]): SheetOp => ({ type: "delete_rows", sheet: o.sheet, at, count }))
            : o.type === "set_sizes"
              ? [{ type: "set_size", sheet: o.sheet, axis: o.axis, index: o.sizes[0]?.index ?? 1, ...(o.sizes.some((e) => e.size !== undefined) ? { size: 1 } : {}) }]
              : [o],
      )
    : opsIn;
  const sheetOf = (id: string): Sheet | undefined => wb.sheets.find((s) => s.id === id);
  const filtering = ops.some((o) => o.type === "set_filter" || o.type === "update_table");
  for (const op of ops) {
    if (wb.protection?.structure && !hasAnyRole(access.user, wb.protection.roles) && (op.type === "add_sheet" || op.type === "delete_sheet" || op.type === "rename_sheet" || op.type === "move_sheet" || op.type === "set_sheet_hidden")) return STRUCTURE;
    const id = "sheet" in op && typeof op.sheet === "string" ? op.sheet : "id" in op && (op.type === "delete_sheet" || op.type === "rename_sheet" || op.type === "move_sheet") ? op.id : undefined;
    const sheet = id === undefined ? undefined : sheetOf(id);
    const protection = sheet?.protection;
    if (!sheet || !protection || op.type === "delete_sheet" || op.type === "rename_sheet" || op.type === "move_sheet" || op.type === "add_sheet" || op.type === "restore") continue;
    const allow = (p: Permission) => mayDo(protection, p, access.user);
    const everyone = mayEditLocked(protection, access.user);
    /** Why this cell can't be changed, or null: it isn't locked, or a range that may be edited (or a role) lets this person. */
    const lockedWhy = (key: string, cell: Cell | undefined): string | null => {
      if (!lockOfKey(sheet, key, cell) || everyone) return null;
      const p = parseCell(key)!;
      const hit = openAt(sheet, p.row, p.col, access);
      if (hit.open) return null;
      if (hit.password) {
        if (detail) detail.editRange = { sheet: sheet.id, name: hit.password.name };
        return NEEDS_PASSWORD(hit.password.name);
      }
      return hit.closed ? NOT_YOU(hit.closed.name) : LOCKED;
    };
    switch (op.type) {
      case "set_cells":
        for (const [key, next] of Object.entries(op.cells)) {
          const old = sheet.cells[key];
          const now = next ?? undefined;
          if (old === now) continue;
          if (contentOf(old) !== contentOf(now)) {
            const why = lockedWhy(key, old);
            if (why) return why;
          }
          if (lockOf(sheet, key, old) !== lockOf(sheet, key, now)) return ALWAYS("Whether cells are locked, or their formulas hidden,");
          if (formatOf(old) !== formatOf(now) && !allow("formatCells")) return NOT_ALLOWED("formatCells");
          if (stable(old?.link ?? null) !== stable(now?.link ?? null)) {
            if (!allow("insertHyperlinks")) return NOT_ALLOWED("insertHyperlinks");
            const why = lockedWhy(key, old);
            if (why) return why;
          }
          if (((old?.note ?? null) !== (now?.note ?? null) || noteExtrasDiffer(old, now)) && !allow("objects")) return NOT_ALLOWED("objects");
        }
        break;
      case "set_locks":
        return ALWAYS("Whether rows, columns and cells are locked");
      case "set_hides":
        return ALWAYS("Whether formulas are hidden");
      case "set_edit_ranges":
        return ALWAYS("The ranges that people may edit");
      case "set_size": {
        // Filters hide rows; that is the filter's permission, not the row's.
        if (filtering && op.size === undefined) break;
        const perm: Permission = op.axis === "col" ? "formatColumns" : "formatRows";
        if (!allow(perm)) return NOT_ALLOWED(perm);
        break;
      }
      case "insert_rows":
        if (!allow("insertRows")) return NOT_ALLOWED("insertRows");
        break;
      case "insert_cols":
        if (!allow("insertColumns")) return NOT_ALLOWED("insertColumns");
        break;
      case "delete_rows":
      case "delete_cols": {
        const perm: Permission = op.type === "delete_rows" ? "deleteRows" : "deleteColumns";
        if (!allow(perm)) return NOT_ALLOWED(perm);
        const rows = op.type === "delete_rows";
        // As in Excel, a row or column can be deleted only when every cell in it can be changed, the empty ones too (they are locked
        // unless something unlocked them), and not through a table, which a protected sheet can't resize.
        const span: Bounds = rows ? { r1: op.at, r2: op.at + op.count - 1, c1: 1, c2: MAX_COLS } : { r1: 1, r2: MAX_ROWS, c1: op.at, c2: op.at + op.count - 1 };
        for (const t of sheet.tables ?? []) {
          const tb = parseRange(t.range);
          if (tb && tb.r1 <= span.r2 && tb.r2 >= span.r1 && tb.c1 <= span.c2 && tb.c2 >= span.c1) return DELETE_TABLE;
        }
        if (!everyone && anyLocked(sheet, span)) {
          // Only a range that people may edit and that holds the whole span (a range of whole rows, say) can open it.
          const covering = (sheet.editRanges ?? []).filter((r) => rangeBounds(r).some((x) => span.r1 >= x.r1 && span.r2 <= x.r2 && span.c1 >= x.c1 && span.c2 <= x.c2));
          if (covering.some((r) => rangeStatus(sheet.id, r, access) === "open")) break;
          const pw = covering.find((r) => rangeStatus(sheet.id, r, access) === "password");
          if (pw) {
            if (detail) detail.editRange = { sheet: sheet.id, name: pw.name };
            return NEEDS_PASSWORD(pw.name);
          }
          return DELETE_LOCKED;
        }
        break;
      }
      case "add_chart":
      case "update_chart":
      case "delete_chart":
      case "add_image":
      case "update_image":
      case "delete_image":
      case "add_slicer":
      case "update_slicer":
      case "delete_slicer":
      case "add_timeline":
      case "update_timeline":
      case "delete_timeline":
        if (!allow("objects")) return NOT_ALLOWED("objects");
        break;
      case "add_sparklines":
      case "update_sparklines":
      case "delete_sparklines":
      case "add_merge":
      case "remove_merge":
      case "add_rule":
      case "update_rule":
      case "delete_rule":
        if (!allow("formatCells")) return NOT_ALLOWED("formatCells");
        break;
      case "add_validation":
      case "update_validation":
      case "delete_validation":
        return ALWAYS("Data validation");
      case "add_pivot":
      case "update_pivot":
      case "delete_pivot":
        if (!allow("pivotTables")) return NOT_ALLOWED("pivotTables");
        break;
      case "add_table":
      case "delete_table":
        return ALWAYS("A table");
      case "update_table": {
        const old = sheet.tables?.find((t) => t.id === op.table.id);
        if (!old || !filterOnly(old, op.table)) return ALWAYS("A table");
        if (!allow("autoFilter")) return NOT_ALLOWED("autoFilter");
        break;
      }
      case "set_filter_views":
        // Saving, renaming and deleting views is using filters.
        if (!allow("autoFilter")) return NOT_ALLOWED("autoFilter");
        break;
      case "set_filter":
        // A filter that is there can be used; one can't be made or taken off.
        if (stable(sheet.filter?.range ?? null) !== stable(op.filter?.range ?? null)) return ALWAYS("A filter");
        if (!allow("autoFilter")) return NOT_ALLOWED("autoFilter");
        break;
      default:
        break;
    }
  }
  return null;
}

// ---- checking what is kept ----

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A password hash made ready to keep, or an error that says what is wrong with it. */
export function cleanPasswordHash(h: PasswordHash): PasswordHash {
  if (!h || typeof h !== "object") return bad("A password is kept as a hash");
  if (h.algorithm === "legacy") {
    if (typeof h.hash !== "string" || !/^[0-9A-Fa-f]{4}$/.test(h.hash)) bad("A legacy password hash is four hex digits");
    return { algorithm: "legacy", hash: h.hash.toUpperCase() };
  }
  if (h.algorithm !== "SHA-512") return bad('A password hash is "SHA-512" or "legacy"');
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (typeof h.salt !== "string" || !b64.test(h.salt) || typeof h.hash !== "string" || !b64.test(h.hash)) bad("A password's salt and hash are base64");
  if (!Number.isInteger(h.spins) || h.spins < 1 || h.spins > 10_000_000) bad("A password's spin count is a whole number up to 10 million");
  return { algorithm: "SHA-512", salt: h.salt, hash: h.hash, spins: h.spins };
}

/** A sheet's protection made ready to keep. */
export function cleanSheetProtection(p: SheetProtection): SheetProtection {
  if (!p || typeof p !== "object" || !Array.isArray(p.allow)) return bad("A protected sheet lists what it allows");
  for (const a of p.allow) if (!PERMISSIONS.includes(a)) bad(`"${String(a)}" isn't something a protected sheet can allow`);
  const allow = PERMISSIONS.filter((x) => p.allow.includes(x));
  const roles = cleanRoleTable(p.roles, PERMISSIONS);
  const editLocked = p.editLocked === undefined ? [] : cleanRoles(p.editLocked, "The roles that may change locked cells");
  return { ...(p.password ? { password: cleanPasswordHash(p.password) } : {}), allow: [...allow], ...(roles ? { roles } : {}), ...(editLocked.length ? { editLocked } : {}) };
}

/** A workbook's protection made ready to keep. */
export function cleanWorkbookProtection(p: WorkbookProtection): WorkbookProtection {
  if (!p || typeof p !== "object" || p.structure !== true) return bad("A protected workbook protects its structure");
  const roles = p.roles === undefined ? [] : cleanRoles(p.roles, "The roles that may change the workbook's structure");
  return { structure: true, ...(p.password ? { password: cleanPasswordHash(p.password) } : {}), ...(roles.length ? { roles } : {}) };
}

/** Ranges that may be edited, made ready to keep: titles are unique (ignoring case), ranges are valid A1 ranges, and permissions are roles. */
export function cleanEditRanges(list: readonly EditRange[]): EditRange[] {
  if (!Array.isArray(list)) return bad("The ranges that people may edit are a list");
  const seen = new Set<string>();
  return list.map((r) => {
    if (!r || typeof r !== "object") return bad("A range that people may edit is an object");
    if (typeof r.name !== "string" || r.name.trim() === "" || r.name.length > 255) return bad("A range that people may edit has a title of up to 255 characters");
    const name = r.name.trim();
    if (seen.has(name.toLowerCase())) return bad(`There is a range called "${name}" already`);
    seen.add(name.toLowerCase());
    if (!Array.isArray(r.ranges) || r.ranges.length === 0) return bad(`"${name}" needs at least one range`);
    const ranges = r.ranges.map((x: unknown) => {
      const b = typeof x === "string" ? parseRange(x.toUpperCase().replace(/\$/g, "")) : null;
      return b ? rangeAddress(normalize(b)) : bad(`"${String(x)}" isn't a range`);
    });
    const permissions = r.permissions === undefined ? undefined : cleanRoles(r.permissions, `The permissions of "${name}"`);
    const denied = r.denied === undefined ? [] : cleanRoles(r.denied, `The people denied "${name}"`);
    const securityDescriptor = r.securityDescriptor === undefined ? undefined : cleanSecurityDescriptor(r.securityDescriptor);
    return { name, ranges, ...(r.password ? { password: cleanPasswordHash(r.password) } : {}), ...(permissions ? { permissions } : {}), ...(denied.length ? { denied } : {}), ...(securityDescriptor ? { securityDescriptor } : {}) };
  });
}
