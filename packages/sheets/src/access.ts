import { PliError } from "@pli.dev/core";
import { parseRange, type Bounds } from "./address";
import type { EditRange, Permission, Sheet, SheetProtection } from "./model";
import { EVERYONE, accountRoles } from "./account";

/*
 * Who may do what on a protected sheet. Pli doesn't own accounts: the application says who is using the sheet (a `SheetUser`,
 * the same shape as the `PliUser` that comments use, plus the roles the application gives them), and the sheet's protection
 * names roles. Ranges that may be edited (Excel's Allow Edit Ranges) can name roles in `permissions`, or be opened with a password.
 */

/** The person using the sheet, as the application describes them. Only the id and the roles are used here. */
export interface SheetUser {
  id: string;
  /** What the application calls this person's roles, such as `finance`. Matched exactly, ignoring case. */
  roles?: readonly string[];
  /** A `PliUser`'s role from `@pli.dev/core` (`viewer`, `commenter`, `editor`) counts as a role too. */
  role?: string;
  /**
   * The person's Windows accounts as the application knows them: security identifiers (SIDs such as `S-1-5-21-…-1001`, and the
   * groups they belong to) and, if you like, names such as `CORP\ada`. Excel's own permissions on ranges that people may edit
   * name accounts by SID; a SID here counts as the role `sid:S-1-5-21-…-1001`, a name as `account:CORP\ada`.
   */
  accounts?: readonly string[];
}

/** What the session knows when it decides: who is using it, and which edit ranges have been opened with a password. */
export interface Access {
  user?: SheetUser | null;
  /** Keys made by `rangeKey` of the ranges whose password was given this session. */
  opened?: ReadonlySet<string>;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The names someone answers to: their roles, and `user:` and their id. */
export function rolesOf(user: SheetUser | null | undefined): Set<string> {
  const out = new Set<string>([EVERYONE]); // Excel's Everyone: anybody, signed in or not
  if (!user) return out;
  out.add("sid:s-1-5-11"); // Authenticated users
  for (const r of accountRoles(user.accounts)) out.add(norm(r));
  out.add(`user:${norm(user.id)}`);
  for (const r of user.roles ?? []) out.add(norm(r));
  if (user.role) out.add(norm(user.role));
  return out;
}

/** Whether the user answers to any of these names. */
export function hasAnyRole(user: SheetUser | null | undefined, wanted: readonly string[] | undefined): boolean {
  if (!wanted?.length) return false;
  const mine = rolesOf(user);
  return wanted.some((w) => mine.has(norm(w)));
}

/** Whether the sheet's protection lets this user do this: everyone may, or one of their roles may. */
export function mayDo(protection: SheetProtection, permission: Permission, user: SheetUser | null | undefined): boolean {
  return protection.allow.includes(permission) || hasAnyRole(user, protection.roles?.[permission]);
}

/** Whether the user may change locked cells on this protected sheet without anything being opened. */
export function mayEditLocked(protection: SheetProtection | undefined, user: SheetUser | null | undefined): boolean {
  return !!protection && hasAnyRole(user, protection.editLocked);
}

/** What identifies an edit range for the passwords given: the sheet, its title and its password (so that changing it closes it). */
export const rangeKey = (sheetId: string, range: EditRange) => `${sheetId}\u0000${norm(range.name)}\u0000${range.password ? range.password.hash : ""}`;

const bounds = new WeakMap<EditRange, Bounds[]>();
/** The rectangles of an edit range. */
export function rangeBounds(range: EditRange): Bounds[] {
  let b = bounds.get(range);
  if (!b) {
    b = range.ranges.map((r) => parseRange(r.toUpperCase())).filter((x): x is Bounds => x !== null);
    bounds.set(range, b);
  }
  return b;
}

/**
 * Where a person stands with an edit range: `open` (they can edit in it), `password` (a password would open it for them) or
 * `closed` (it names people who may, and they aren't one of them, and there is no password).
 */
export function rangeStatus(sheetId: string, range: EditRange, access: Access): "open" | "password" | "closed" {
  // Excel's Deny wins: someone it names can edit only with the password.
  if (range.denied && hasAnyRole(access.user, range.denied)) return range.password ? (access.opened?.has(rangeKey(sheetId, range)) ? "open" : "password") : "closed";
  if (range.permissions && hasAnyRole(access.user, range.permissions)) return "open";
  if (range.password) return access.opened?.has(rangeKey(sheetId, range)) ? "open" : "password";
  return range.permissions ? "closed" : "open";
}

/** The edit ranges that hold this cell. */
export function rangesAt(sheet: Sheet, row: number, col: number): EditRange[] {
  return (sheet.editRanges ?? []).filter((r) => rangeBounds(r).some((b) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2));
}

/** What an edit range does for a cell: the cell is open to this user, or the edit range that could be opened with a password. */
export function openAt(sheet: Sheet, row: number, col: number, access: Access): { open: true } | { open: false; password?: EditRange; closed?: EditRange } {
  let password: EditRange | undefined;
  let closed: EditRange | undefined;
  for (const r of rangesAt(sheet, row, col)) {
    const st = rangeStatus(sheet.id, r, access);
    if (st === "open") return { open: true };
    if (st === "password") password ??= r;
    else closed ??= r;
  }
  return { open: false, ...(password ? { password } : {}), ...(closed ? { closed } : {}) };
}

// ---- checking what is kept ----

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A role as it is kept: text without spaces at the ends, never empty. */
export function cleanRole(role: unknown): string {
  if (typeof role !== "string" || role.trim() === "" || role.length > 100 || /[\u0000-\u001f]/.test(role)) return bad("A role is a short piece of text, such as finance");
  return role.trim();
}

/** A list of roles as it is kept: no repeats (ignoring case). */
export function cleanRoles(list: unknown, what: string): string[] {
  if (!Array.isArray(list)) return bad(`${what} lists roles`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of list) {
    const role = cleanRole(r);
    if (seen.has(norm(role))) continue;
    seen.add(norm(role));
    out.push(role);
  }
  return out;
}

/** Roles per permission as they are kept, in the order of `order`. */
export function cleanRoleTable(table: unknown, order: readonly Permission[]): Partial<Record<Permission, string[]>> | undefined {
  if (table === undefined) return undefined;
  if (!table || typeof table !== "object" || Array.isArray(table)) return bad("The roles of a protected sheet are listed by permission");
  const out: Partial<Record<Permission, string[]>> = {};
  for (const k of Object.keys(table)) if (!order.includes(k as Permission)) bad(`"${k}" isn't something a protected sheet can allow`);
  for (const p of order) {
    const v = (table as Record<string, unknown>)[p];
    if (v === undefined) continue;
    const roles = cleanRoles(v, `The roles for ${p}`);
    if (roles.length) out[p] = roles;
  }
  return Object.keys(out).length ? out : undefined;
}
