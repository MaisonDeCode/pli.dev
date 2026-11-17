/**
 * Commands: one description of what the editor can do, used by the toolbar, the ribbon and the menus alike.
 *
 * A `PdfCommand` carries the label, the icon, the shortcut as it is shown, whether it is available and whether it is on. The
 * toolbar buttons (`CommandButton`) and the entries of the menu bar (`commandItem`) are both made from it, so a button and
 * its menu entry can never disagree about the name, the key or whether they are enabled.
 */
import type { ReactNode } from "react";
import { keepFocus, type MenuEntry, type MenuItem } from "@pli.dev/react";

export interface PdfCommand {
  id: string;
  label: string;
  icon?: ReactNode;
  /** The shortcut as it is shown (`Ctrl+Z`, `⌘Z`), not a key to listen for. */
  shortcut?: string;
  /** Not available now. */
  disabled?: boolean;
  /** On or off (a toggle): shown as pressed on a button and ticked in a menu. Leave out for a command that is not a toggle. */
  checked?: boolean;
  run(): void;
}

export type PdfCommands = Record<string, PdfCommand>;

/** The menus of the menu bar, in the order they are shown. */
export const MENU_NAMES = ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"] as const;
export type PdfMenuName = (typeof MENU_NAMES)[number];

/** The entries of the menus. Entries you give for a menu are added to the editor's own (see the `menus` prop of `PliPdf`). */
export type PdfMenus = Partial<Record<PdfMenuName, MenuEntry[]>>;

/** A command as a menu entry. `label` renames it for the menu ("Zoom in" is fine on a button, "Zoom in" the same in the menu). */
export function commandItem(c: PdfCommand, label: string = c.label): MenuItem {
  return { label, ...(c.shortcut ? { shortcut: c.shortcut } : {}), ...(c.disabled ? { disabled: true } : {}), ...(c.checked !== undefined ? { checked: c.checked } : {}), onSelect: c.run };
}

/** The tooltip of a command: its name and, in brackets, its key. */
export const commandTitle = (c: Pick<PdfCommand, "label" | "shortcut">): string => (c.shortcut ? `${c.label} (${c.shortcut})` : c.label);

/** A toolbar button for a command. A toggle is a pressed button. */
export function CommandButton({ command: c, toggle = c.checked !== undefined, className = "pli-tool pli-pdf-tool", children }: { command: PdfCommand; toggle?: boolean; className?: string; children?: ReactNode }) {
  return (
    <button type="button" className={className} aria-label={c.label} title={commandTitle(c)} aria-pressed={toggle ? !!c.checked : undefined} disabled={c.disabled} data-command={c.id} onMouseDown={keepFocus} onClick={c.run}>
      {children ?? c.icon}
    </button>
  );
}

/** Entries of one menu put together: groups of entries with a separator between them, and no separator at an end or two in a row. */
export function menuGroups(...groups: (readonly (MenuEntry | null | false | undefined)[] | null | undefined | false)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const g of groups) {
    if (!g) continue;
    const items = g.filter((e): e is MenuEntry => !!e);
    if (items.length === 0) continue;
    if (out.length > 0 && out[out.length - 1] !== "separator") out.push("separator");
    for (const e of items) if (e !== "separator" || (out.length > 0 && out[out.length - 1] !== "separator")) out.push(e);
    while (out[out.length - 1] === "separator") out.pop();
  }
  return out;
}

/** Joins menus: for each menu, the entries of `a`, then those of `b`, with a separator between. */
export function mergeMenus(...all: (PdfMenus | null | undefined)[]): PdfMenus {
  const out: PdfMenus = {};
  for (const m of all) {
    if (!m) continue;
    for (const name of MENU_NAMES) {
      const more = m[name];
      if (more?.length) out[name] = menuGroups(out[name], more);
    }
  }
  return out;
}

/** Every item of a menu, in the order shown, with the path of submenus it is in (for tests and the help screen). */
export function flattenMenu(items: readonly MenuEntry[], path: string[] = []): { path: string[]; item: MenuItem }[] {
  const out: { path: string[]; item: MenuItem }[] = [];
  for (const e of items) {
    if (e === "separator") continue;
    if (e.items) out.push(...flattenMenu(e.items, [...path, e.label]));
    else out.push({ path, item: e });
  }
  return out;
}

/** Cuts the entries of a menu into groups at its separators. */
const groupsOf = (items: readonly MenuEntry[]): MenuEntry[][] => {
  const out: MenuEntry[][] = [[]];
  for (const e of items) {
    if (e === "separator") out.push([]);
    else out[out.length - 1]!.push(e);
  }
  return out.filter((g) => g.length > 0);
};

/** Where the entries of a kit go among the viewer's own groups: after the first group, before the last, before them all, or at the end. */
const PLACE: Record<PdfMenuName, "afterFirst" | "beforeLast" | "first" | "end"> = { File: "end", Edit: "afterFirst", View: "beforeLast", Insert: "first", Format: "end", Tools: "first", Help: "end" };

/**
 * Puts what the kits add into the viewer's menus where it belongs (editing commands after Undo and Redo, the tools of Insert and
 * Tools before the viewer's own, view switches before the full screen group), with separators kept between groups.
 */
export function weaveMenus(base: PdfMenus, kit: PdfMenus | null | undefined): PdfMenus {
  if (!kit) return base;
  const out: PdfMenus = { ...base };
  for (const name of MENU_NAMES) {
    const more = kit[name];
    if (!more?.length) continue;
    const mine = groupsOf(base[name] ?? []);
    const at = PLACE[name];
    const index = at === "afterFirst" ? Math.min(1, mine.length) : at === "beforeLast" ? Math.max(0, mine.length - 1) : at === "first" ? 0 : mine.length;
    out[name] = menuGroups(...mine.slice(0, index), more, ...mine.slice(index));
  }
  return out;
}
