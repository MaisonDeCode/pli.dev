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

/**
 * New text for the built-in menus, or a way to take an item out. Each key is the text a menu or item has now, and its value is
 * what to show instead; `false` removes it.
 *
 * - **The text as it is** (`"Download"`) applies to every menu or item with that text.
 * - **A path** (`"File > Download"`, `"File > Download > DOCX document (.docx)"`) applies to that one, and wins over the plain text.
 *   Write each part as it is now, even when a part above it has been renamed.
 * - Items you added with `extraMenus` are renamed or removed the same way. A key that matches nothing is ignored.
 *
 * Removing an item takes its submenu with it, and a menu with nothing left disappears (its lines too).
 *
 * ```tsx
 * <PliDocument
 *   session={session}
 *   menuLabels={{
 *     "File > Download": "Export",
 *     "DOCX document (.docx)": "Word file",
 *     "Insert > Page break": false,
 *     Help: false,
 *   }}
 * />
 * ```
 */
export type MenuLabels = Readonly<Record<string, string | false>>;

const pathKey = (key: string): string => key.split(">").map((part) => part.trim()).join(" > ");

/** Takes out the lines that would show twice in a row, or at either end. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry === "separator" && (out.length === 0 || out[out.length - 1] === "separator")) continue;
    out.push(entry);
  }
  if (out[out.length - 1] === "separator") out.pop();
  return out;
}

/** The menus with {@link MenuLabels} applied. Returns the same list when there is nothing to change. */
export function relabelMenus(menus: MenuDefinition[], labels: MenuLabels | undefined): MenuDefinition[] {
  if (!labels || Object.keys(labels).length === 0) return menus;
  const table = new Map<string, string | false>();
  for (const [key, value] of Object.entries(labels)) table.set(pathKey(key), value);
  const find = (path: string[]): string | false | undefined => table.get(path.join(" > ")) ?? table.get(path[path.length - 1]!);

  const walk = (entries: MenuEntry[], parent: string[]): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const entry of entries) {
      if (entry === "separator") {
        out.push(entry);
        continue;
      }
      const path = [...parent, entry.label];
      const found = find(path);
      if (found === false) continue;
      const items = entry.items ? walk(entry.items, path) : undefined;
      // A submenu with everything taken out of it has nothing to open.
      if (entry.items && entry.items.length > 0 && (items?.length ?? 0) === 0) continue;
      out.push({ ...entry, label: found ?? entry.label, ...(items && { items }) });
    }
    return tidy(out);
  };

  const result: MenuDefinition[] = [];
  for (const menu of menus) {
    const found = find([menu.label]);
    if (found === false) continue;
    const items = walk(menu.items, [menu.label]);
    if (menu.items.length > 0 && items.length === 0) continue;
    result.push({ ...menu, label: found ?? menu.label, items });
  }
  return result;
}

/**
 * The menu bar with your additions (see {@link ExtraMenus}), and then your new text and removals (see {@link MenuLabels}).
 * Additions find the built-in items by the text they have now, so `after: "Page count"` works whatever `labels` does to it.
 * Returns the same list when there is nothing to change.
 */
export function extendMenus(menus: MenuDefinition[], extra: ExtraMenus | undefined, labels?: MenuLabels): MenuDefinition[] {
  return relabelMenus(addMenus(menus, extra), labels);
}

function addMenus(menus: MenuDefinition[], extra: ExtraMenus | undefined): MenuDefinition[] {
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
