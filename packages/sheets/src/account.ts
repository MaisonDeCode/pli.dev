import { PliError } from "@pli.dev/core";

/*
 * Excel's Windows-account permissions on ranges that people may edit. Excel keeps them in a protected range's
 * `securityDescriptor`, written in SDDL (Windows' security descriptor language): `O:WDG:WDD:(A;;CC;;;S-1-5-21-…-1001)` says that
 * the account with that security identifier (SID) may edit the range without the password (`A` is allow, `D` is deny, `CC`
 * is the right Excel uses for editing).
 *
 * Pli keeps no accounts. The application knows who is using the sheet and gives that person's accounts as SIDs
 * (`SheetUser.accounts`); a SID is matched as the role `sid:S-1-5-21-…`, so an SID in a file becomes an ordinary entry of the
 * range's `permissions` (allowed) or `denied`. The descriptor as it was read stays on the range (`securityDescriptor`), so that a
 * file saved again says what it said, and is written afresh from `permissions` and `denied` when those no longer agree with it.
 */

/** The SDDL names of the well-known groups, with the SIDs they stand for. */
const ALIASES: Record<string, string> = {
  WD: "S-1-1-0", // Everyone
  AN: "S-1-5-7", // Anonymous logon
  AU: "S-1-5-11", // Authenticated users
  IU: "S-1-5-4", // Interactive users
  NU: "S-1-5-2", // Network users
  SY: "S-1-5-18", // Local system
  LS: "S-1-5-19", // Local service
  NS: "S-1-5-20", // Network service
  BA: "S-1-5-32-544", // Administrators
  BU: "S-1-5-32-545", // Users
  BG: "S-1-5-32-546", // Guests
  PU: "S-1-5-32-547", // Power users
  CO: "S-1-3-0", // Creator owner
  CG: "S-1-3-1", // Creator group
  OW: "S-1-3-4", // Owner rights
  RC: "S-1-5-12", // Restricted code
};
const SID = /^S-1-\d+(-\d+)+$/i;

/** The role that stands for everyone (`WD`, SID S-1-1-0): every person answers to it, signed in or not. */
export const EVERYONE = "sid:s-1-1-0";

/** Whether this is a security identifier such as `S-1-5-21-1004336348-1177238915-682003330-512`. */
export const isSid = (text: string): boolean => SID.test(text.trim());

/** The role that a SID, or SDDL's short name for a well-known group, stands for: `sid:S-1-…`. Null if it is neither. */
export function sidRole(text: string): string | null {
  const t = text.trim().toUpperCase();
  const sid = ALIASES[t] ?? (SID.test(t) ? t : null);
  return sid ? `sid:${sid}` : null;
}

/** What the person's accounts (SIDs, or names such as `CORP\ada`) stand for as roles. */
export function accountRoles(accounts: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const a of accounts ?? []) {
    const role = sidRole(a);
    if (role) out.push(role);
    else if (a.trim()) out.push(`account:${a.trim()}`);
  }
  return out;
}

export interface ParsedDescriptor {
  /** Roles (`sid:…`) of the accounts the descriptor allows. */
  allow: string[];
  /** Roles of the accounts it denies. */
  deny: string[];
}

const ACE = /\(([^;()]*);([^;()]*);([^;()]*);([^;()]*);([^;()]*);([^;()]*)\)/g;

/**
 * The accounts an SDDL string allows and denies to edit: its simple access control entries, `(A;;CC;;;SID)` and `(D;;CC;;;SID)`,
 * whatever the order. Entries with conditions, other kinds of right, or a name that is not a SID or a well-known group are
 * left alone (the string itself is kept verbatim). Several descriptors in one string (Excel separates them with a space) are
 * read as one.
 */
export function parseSddl(text: string): ParsedDescriptor {
  const allow: string[] = [];
  const deny: string[] = [];
  for (const m of text.matchAll(ACE)) {
    const [, type, , rights, objectGuid, inheritGuid, who] = m;
    if (objectGuid || inheritGuid) continue;
    if (!/CC|GA|GW|FA|^0x/i.test(rights ?? "")) continue;
    const role = sidRole(who ?? "");
    if (!role) continue;
    if (type === "A" && !allow.includes(role)) allow.push(role);
    else if (type === "D" && !deny.includes(role)) deny.push(role);
  }
  return { allow, deny };
}

const NAME_OF = new Map(Object.entries(ALIASES).map(([name, sid]) => [sid, name]));

/** The `sid:` roles in a list, as SIDs in the capitals Windows writes. */
const sidsIn = (roles: readonly string[] | undefined): string[] => (roles ?? []).filter((r) => /^sid:/i.test(r)).map((r) => r.slice(4).toUpperCase());

/** How Excel writes an account in SDDL: a well-known group by its short name (`WD`, not `S-1-1-0`), any other by its SID. */
const sddlName = (sid: string): string => NAME_OF.get(sid) ?? sid;

/** An SDDL string for the accounts allowed and denied (Excel's own shape: owner and group Everyone, then a DACL). Empty if there are none. */
export function writeSddl(allow: readonly string[] | undefined, deny: readonly string[] | undefined): string {
  const a = sidsIn(allow);
  const d = sidsIn(deny);
  if (!a.length && !d.length) return "";
  // Excel lets only the accounts a range lists edit it, so a range that only denies some people lists Everyone as well.
  if (!a.length && !allow) a.push("S-1-1-0");
  // Denying entries come first, as Windows orders them.
  return `O:WDG:WDD:${d.map((s) => `(D;;CC;;;${sddlName(s)})`).join("")}${a.map((s) => `(A;;CC;;;${sddlName(s)})`).join("")}`;
}

const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && [...x].map((s) => s.toLowerCase()).sort().join("\u0000") === [...y].map((s) => s.toLowerCase()).sort().join("\u0000");

/**
 * The descriptor to write for a range: the one read from a file, as it was, while the accounts in `permissions` and `denied` are
 * still the ones it names, and otherwise one made from them. Empty when the range names no accounts.
 */
export function descriptorFor(range: { permissions?: readonly string[]; denied?: readonly string[]; securityDescriptor?: string }): string {
  const allow = sidsIn(range.permissions).map((s) => `sid:${s}`);
  const deny = sidsIn(range.denied).map((s) => `sid:${s}`);
  if (range.securityDescriptor) {
    const kept = parseSddl(range.securityDescriptor);
    if (same(kept.allow, allow) && same(kept.deny, deny)) return range.securityDescriptor;
  }
  return writeSddl(range.permissions ? allow : undefined, deny);
}

/** A descriptor made ready to keep: printable text without markup, of a sensible length. */
export function cleanSecurityDescriptor(text: unknown): string | undefined {
  if (text === undefined || text === "") return undefined;
  if (typeof text !== "string" || text.length > 8192 || !/^[\x20-\x7e]+$/.test(text) || /[<>&"']/.test(text)) throw new PliError("invalid_operation", "A security descriptor is SDDL text, such as O:WDG:WDD:(A;;CC;;;S-1-5-21-1-2-3-1001)");
  return text.trim();
}
