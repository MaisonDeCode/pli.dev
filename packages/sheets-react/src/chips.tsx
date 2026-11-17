import type { ReactNode } from "react";
import { cellChoices, optionOf, type Cell, type ChipOption } from "@pli.dev/sheets";

/**
 * What a kind of badge means. An app supplies these (by name, in `PliSheet`'s `chips` prop) for the things its cells can
 * hold, such as people or projects: the cell keeps an id, and this turns the id into a name and a picture.
 */
export interface ChipKind {
  /** What the kind is called in the Insert menu, such as "Person". */
  label: string;
  /** What to show for a value (an id). Without an answer, the value itself is shown as plain text. */
  resolve(value: string): ChipOption | undefined;
  /** The things to choose from as someone types in the picker. Without it, the kind has no picker. */
  search?(query: string): ChipOption[] | Promise<ChipOption[]>;
  /** Draws a badge your own way, in place of the standard pill. */
  render?(item: ChipOption): ReactNode;
  /**
   * A card of your own that opens under the badge when it is clicked (or when Space or Alt+Enter is pressed on the selected
   * cell): a profile, a project summary, a menu of actions. Draw what you like; `close` closes the card. Escape and a click
   * anywhere else close it too. Ctrl, Cmd and Shift clicks keep selecting cells.
   */
  card?(item: ChipOption, api: { close(): void }): ReactNode;
}

/** One badge to draw. */
export interface Pill {
  /** The value the badge stands for. */
  value?: string;
  /** Clicking it opens the kind's card. */
  card?: true;
  label: string;
  color?: string;
  image?: string;
  node?: ReactNode;
}

export const DEFAULT_PILL_COLOR = "#e4e2fb";
export const PALETTE = ["#e5e7eb", "#fde68a", "#bbf7d0", "#bfdbfe", "#fecaca", "#ddd6fe", "#fed7aa", "#fbcfe8"];

/** Dark or light text for a background, whichever reads better. */
export function textOn(background: string): string {
  const n = parseInt(background.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1b1d22" : "#ffffff";
}

/** The badges a dropdown or badge cell shows, one for each value in it. */
export function pillsOf(cell: Cell, chips: Readonly<Record<string, ChipKind>> | undefined): Pill[] {
  const control = cell.control;
  if (!control || control.type === "checkbox") return [];
  return cellChoices(cell).map((value): Pill => {
    if (control.type === "dropdown") {
      const option = optionOf(control, value);
      return { label: option?.label ?? value, ...(option?.color ? { color: option.color } : {}), ...(option?.image ? { image: option.image } : {}) };
    }
    const kind = control.kind ? chips?.[control.kind] : undefined;
    const item = kind?.resolve(value);
    if (kind && item) {
      return { value, ...(kind.card ? { card: true as const } : {}), label: item.label ?? item.value, color: item.color ?? control.color ?? DEFAULT_PILL_COLOR, ...(item.image ? { image: item.image } : {}), ...(kind.render ? { node: kind.render(item) } : {}) };
    }
    return { label: value, color: control.color ?? DEFAULT_PILL_COLOR };
  });
}

/** Whether a cell has a list or picker to open. */
export function hasPicker(cell: Cell | undefined, chips: Readonly<Record<string, ChipKind>> | undefined): boolean {
  const c = cell?.control;
  if (!c) return false;
  if (c.type === "dropdown") return true;
  return c.type === "badge" && !!c.kind && !!chips?.[c.kind]?.search;
}

/** The value of the first badge in a cell that opens a card when clicked, if it has one. */
export function cardChip(cell: Cell | undefined, chips: Readonly<Record<string, ChipKind>> | undefined): string | undefined {
  const c = cell?.control;
  if (!cell || c?.type !== "badge" || !c.kind || !chips?.[c.kind]?.card) return undefined;
  const kind = chips[c.kind]!;
  return cellChoices(cell).find((v) => kind.resolve(v) !== undefined);
}
