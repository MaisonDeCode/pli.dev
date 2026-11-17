import { PliError } from "@pli.dev/core";
import { parseCell, parseRange, type Bounds } from "./address";
import type { Cell, CellLink, CellStyle, Workbook } from "./model";

/** Excel's own colour for a link (the hyperlink colour of Office's theme). */
export const LINK_COLOR = "#0563c1";
/** And for a link that has been followed (the followed-hyperlink colour of Office's theme). */
export const FOLLOWED_LINK_COLOR = "#954f72";
/** The longest address a link can have, as in Excel. */
export const MAX_LINK_LENGTH = 2083;
/** The longest note a cell can have, as in Excel. */
export const MAX_NOTE_LENGTH = 32767;

/** Schemes that run code or carry a page of their own: never a place to follow from a spreadsheet. */
const REFUSED = /^(?:javascript|data|vbscript):/i;
/** Addresses a browser may be sent to. */
const OPENABLE = /^(?:https?:|mailto:|tel:|ftp:|sms:)/i;

/** The link after checking it, or an error saying what is wrong. */
export function cleanLink(link: CellLink): CellLink {
  const to = typeof link.to === "string" ? link.to.trim() : "";
  if (to === "" || to === "#") throw new PliError("invalid_operation", "A link needs an address");
  if (to.length > MAX_LINK_LENGTH) throw new PliError("invalid_operation", `A link can be at most ${MAX_LINK_LENGTH} characters`);
  // Whitespace and control characters inside the scheme are how `java\tscript:` gets past a check.
  if (REFUSED.test(to.replace(/[\u0000- ]/g, ""))) throw new PliError("invalid_operation", "A link can't run a script or hold a page of its own");
  const tip = typeof link.tip === "string" ? link.tip.trim().slice(0, 255) : "";
  return { to, ...(tip ? { tip } : {}), ...(link.followed === true ? { followed: true as const } : {}) };
}

/** The note after checking it; an empty one is no note (null). */
export function cleanNote(note: string): string | null {
  if (typeof note !== "string") throw new PliError("invalid_operation", "A note is text");
  if (note.trim() === "") return null;
  if (note.length > MAX_NOTE_LENGTH) throw new PliError("invalid_operation", `A note can be at most ${MAX_NOTE_LENGTH} characters`);
  return note;
}

/** Whether a link leads inside the workbook. */
export function isPlace(to: string): boolean {
  return to.startsWith("#");
}

/** Whether a browser may be sent to the link (a web address, mail, phone); other kinds, such as a file path, are shown but not followed. */
export function isOpenable(to: string): boolean {
  return OPENABLE.test(to);
}

/** A web address typed as such: `https://pli.dev`, `www.pli.dev`, `mailto:ana@example.com`. Gives the link to make from it, or null. */
export function linkInText(text: string): string | null {
  const t = text.trim();
  if (/\s/.test(t) || t.length > MAX_LINK_LENGTH) return null;
  if (/^(?:https?:\/\/|mailto:|ftp:\/\/)[^\s/]/i.test(t) && !/^mailto:$/i.test(t)) return t;
  if (/^www\.[^\s.]+\.[^\s]+$/i.test(t)) return "https://" + t;
  return null;
}

/**
 * A look for a cell that is a link: Excel's blue and underline, unless the cell has a colour or underline of its own.
 * Cells that aren't links come back as they are.
 */
export function linkedStyle(cell: Cell | undefined, palette?: readonly string[]): CellStyle | undefined {
  const look = linkLook(cell);
  if (!look.link) return cell?.s;
  return { ...look.style, ...(look.theme ? { color: linkColor(look.theme, palette) } : {}) };
}

/** The colour of the theme's hyperlink (`theme` 10) or followed-hyperlink (11) colour, from the workbook's palette (`Workbook.themeColors`) or Office's. */
export function linkColor(theme: 10 | 11, palette?: readonly string[]): string {
  return palette?.[theme] ?? (theme === 10 ? LINK_COLOR : FOLLOWED_LINK_COLOR);
}

/**
 * What a link cell's look is made of: its own style, and, when the style has no colour of its own, which colour of the theme the text
 * takes (10 for the hyperlink colour, 11 for the followed one), so that the colour follows the theme. An underline is added when the
 * style says nothing about one. This is Excel's "Hyperlink" and "Followed Hyperlink" cell styles.
 */
export function linkLook(cell: Cell | undefined): { link: boolean; style: CellStyle | undefined; theme?: 10 | 11 } {
  if (!cell?.link) return { link: false, style: cell?.s };
  const s = cell.s ?? {};
  return { link: true, style: { ...s, ...(s.underline === undefined ? { underline: true } : {}) }, ...(s.color === undefined ? { theme: cell.link.followed ? (11 as const) : (10 as const) } : {}) };
}

/** Where a place in the workbook is: the sheet and the range. Null when the sheet or the name isn't there. */
export function placeOf(wb: Workbook, to: string, from: string): { sheet: string; range: Bounds } | null {
  const text = to.replace(/^#/, "").trim();
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(text);
  const sheetName = m ? (m[1] ?? m[2])!.replace(/''/g, "'") : undefined;
  const sheet = sheetName === undefined ? wb.sheets.find((s) => s.id === from) : wb.sheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase());
  const ref = (m ? m[3]! : text).replace(/\$/g, "").toUpperCase();
  if (sheet) {
    const cell = parseCell(ref);
    if (cell) return { sheet: sheet.id, range: { r1: cell.row, c1: cell.col, r2: cell.row, c2: cell.col } };
    const range = parseRange(ref);
    if (range) return { sheet: sheet.id, range };
  }
  // A defined name stands for a range on some sheet.
  const named = Object.entries(wb.names ?? {}).find(([n]) => n.toLowerCase() === text.toLowerCase())?.[1];
  if (named && named !== to) {
    const where = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(named);
    if (where) return placeOf(wb, `#${named}`, from);
  }
  return null;
}

/** A link that leads to a place on the sheet `from` names, written to lead to the sheet's new name (other links are as they were). */
export function renameLinkPlace(to: string, from: string, name: string): string {
  const m = /^#(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(to.trim());
  if (!m) return to;
  const old = (m[1] ?? m[2])!.replace(/''/g, "'");
  if (old.toLowerCase() !== from.toLowerCase()) return to;
  const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
  return `#${quoted}!${m[3]}`;
}
