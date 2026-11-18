import type { MenuDefinition } from "./MenuBar";
import type { MenuEntry } from "./primitives";

/**
 * Menus of your own, and items for the menus an editor already has. Each key is a menu's name:
 *
 * - **A menu the editor has** (`File`, `Edit`, `Insert`…): the items are added to the end of it, after a divider.
 * - **A name it doesn't have** (`AI`, `Reports`): a menu of that name is added to the bar, before `Help` when the editor has one
 *   and otherwise last, in the order you wrote them.
 *
 * Give `{ items, after }` or `{ items, before }`, naming an item that is already in the menu, to put yours somewhere other than the
 * end. Entries are the same as everywhere else: `{ label, onSelect, shortcut, disabled, checked, items }` (nested items open as a
 * submenu), or `"separator"`.
 *
 * ```tsx
 * <PliDocument
 *   session={session}
 *   extraMenus={{
 *     File: [{ label: "Share…", onSelect: openShareDialog }],
 *     AI: [{ label: "Summarize", onSelect: summarize }, { label: "Rewrite", items: [{ label: "Shorter" }, { label: "Friendlier" }] }],
 *   }}
 * />
 * ```
 */
export type ExtraMenus = Record<string, MenuEntry[] | ExtraMenuItems>;

/** Items for one menu, with a place for them. */
export interface ExtraMenuItems {
  items: MenuEntry[];
  /** Put the items right after the built-in item with this label. */
  after?: string;
  /** Put the items right before the built-in item with this label. */
  before?: string;
}

const isEntries = (value: MenuEntry[] | ExtraMenuItems): value is MenuEntry[] => Array.isArray(value);

/** The menu bar with your additions: see {@link ExtraMenus}. Returns the same list when there is nothing to add. */
export function extendMenus(menus: MenuDefinition[], extra: ExtraMenus | undefined): MenuDefinition[] {
  if (!extra) return menus;
  const names = Object.keys(extra);
  if (names.length === 0) return menus;
  const result = menus.map((menu) => ({ ...menu, items: [...menu.items] }));
  const added: MenuDefinition[] = [];
  for (const name of names) {
    const given = extra[name]!;
    const spec: ExtraMenuItems = isEntries(given) ? { items: given } : given;
    if (spec.items.length === 0) continue;
    const menu = result.find((m) => m.label === name);
    if (!menu) {
      added.push({ label: name, items: spec.items });
      continue;
    }
    const anchor = spec.after ?? spec.before;
    const at = anchor === undefined ? -1 : menu.items.findIndex((e) => e !== "separator" && e.label === anchor);
    if (at >= 0) {
      menu.items.splice(spec.after !== undefined ? at + 1 : at, 0, ...spec.items);
    } else {
      const last = menu.items[menu.items.length - 1];
      if (menu.items.length > 0 && last !== "separator") menu.items.push("separator");
      menu.items.push(...spec.items);
    }
  }
  if (added.length === 0) return result;
  const help = result.findIndex((m) => m.label === "Help");
  if (help < 0) return [...result, ...added];
  return [...result.slice(0, help), ...added, ...result.slice(help)];
}
