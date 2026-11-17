import type { Border, CellBorders, PivotStyle } from "./model";

/*
 * Pivot table styles. Excel has 84 built in: PivotStyleLight1 to 28, PivotStyleMedium1 to 28 and PivotStyleDark1 to 28, laid
 * out in its gallery as rows of seven (a dark one, then one for each of the six accent colours). A style is a look for the
 * parts of a table (the headings, the row labels, subtotals, the grand total, the stripes); Pli draws it as the cells' own
 * fills, fonts and borders, so it stays when the table is saved in another format. The look is built from the way the gallery
 * is organised and the Office colours; it follows Excel's but isn't a copy of each of the 84.
 */

/** Excel's accent colours: a dark shade for the first style of each row of the gallery, then accents 1 to 6. */
const ACCENTS = ["#404040", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

const mix = (hex: string, withHex: string, share: number): string => {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return "#" + [0, 1, 2].map((i) => h(p(hex, i) * (1 - share) + p(withHex, i) * share)).join("");
};
const tint = (hex: string, share: number) => mix(hex, "#ffffff", share);
const shade = (hex: string, share: number) => mix(hex, "#000000", share);

export const PIVOT_STYLE_FAMILIES = ["Light", "Medium", "Dark"] as const;
/** Every style name Excel has for pivot tables, `none` first. */
export const PIVOT_STYLE_NAMES: readonly string[] = ["none", ...PIVOT_STYLE_FAMILIES.flatMap((f) => Array.from({ length: 28 }, (_, i) => `PivotStyle${f}${i + 1}`))];

const NAME = /^PivotStyle(Light|Medium|Dark)([1-9]|1\d|2[0-8])$/;

export function isPivotStyleName(name: string): boolean {
  return name === "none" || NAME.test(name);
}

/** The family, the row of the gallery (0 to 3) and the colour of a style name; null for `none` or a name that isn't one. */
export function parsePivotStyle(name: string | undefined): { family: "light" | "medium" | "dark"; row: number; accent: string; n: number } | null {
  const m = NAME.exec(name ?? "");
  if (!m) return null;
  const n = Number(m[2]);
  return { family: m[1]!.toLowerCase() as "light" | "medium" | "dark", row: Math.floor((n - 1) / 7), accent: ACCENTS[(n - 1) % 7]!, n };
}

/** The look of a part of the table. */
export interface PivotLook {
  fill?: string;
  color?: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  fontFamily?: string;
  fontSize?: number;
  border?: CellBorders;
}

/** What a cell of the table is, so a style can say how it looks. */
export interface PivotCellRole {
  zone: "header" | "label" | "body" | "pageLabel" | "pageValue";
  /** For styles of your own: how deep the row's item is (the grand total's line is 0), and likewise the column's. */
  rowDepth?: number;
  colDepth?: number;
  /** An outer item's own line (a sub-heading), with items under it. */
  subheading?: boolean;
  /** For a heading cell of an outer column field: the field's level (1 is the outermost). */
  colHeadLevel?: number;
  /** The corner cell at the left or right of the headings. */
  corner?: "first" | "last";
  /** For a label or a body cell: whether its row is an item, a subtotal or the grand total. */
  row?: "item" | "subtotal" | "grand";
  /** For a body cell: whether its column is an item, a subtotal or the grand total. */
  col?: "item" | "subtotal" | "grand";
  /** Which line of the body the cell is on (0 is the first), and which column of the data (0 is the first). */
  line?: number;
  column?: number;
  /** Where the cell is in the table, for styles that draw a box around it. */
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

export type PivotStyleRole = PivotCellRole;

const line = (color: string, style: Border["style"] = "thin"): Border => ({ style, color });

/**
 * How a style draws the cell in this role. An empty look means the style leaves it as it is. `none` and an unknown name give
 * nothing at all.
 */
export function pivotCellStyle(style: PivotStyle, role: PivotCellRole): PivotLook {
  const def = parsePivotStyle(style.name);
  if (!def) return {};
  const { family, row, accent } = def;
  const out: PivotLook = {};
  const border: CellBorders = {};
  const set = (l: PivotLook) => {
    if (l.fill) out.fill = l.fill;
    if (l.color) out.color = l.color;
    if (l.bold) out.bold = true;
    if (l.border) Object.assign(border, l.border);
  };
  const head = style.colHeaders !== false;
  const labels = style.rowHeaders !== false;
  const light = family === "light";
  const dark = family === "dark";
  const white = "#ffffff";
  // The whole table: a fill (medium and dark), a box or a grid of lines.
  if (!light) set({ fill: dark ? tint(accent, 0.62) : tint(accent, 0.86) });
  if (family === "medium" && row !== 1) set({ border: { top: line(white), bottom: line(white), left: line(white), right: line(white) } });
  if (row === 1) {
    // A box around the whole table.
    set({ border: { ...(role.top ? { top: line(accent) } : {}), ...(role.bottom ? { bottom: line(accent) } : {}), ...(role.left ? { left: line(accent) } : {}), ...(role.right ? { right: line(accent) } : {}) } });
  } else if (row === 2) {
    // A grid of thin lines.
    set({ border: { top: line(accent), bottom: line(accent), left: line(accent), right: line(accent) } });
  } else if (row === 3 && light) {
    // Lines between the rows.
    set({ border: { bottom: line(tint(accent, 0.6), "hair") } });
  }
  // Stripes.
  const striped = (style.rowStripes && role.zone !== "header" && (role.line ?? 0) % 2 === 0 && role.row !== "grand") || (style.colStripes && role.zone === "body" && (role.column ?? 0) % 2 === 0);
  if (striped) set({ fill: light ? tint(accent, 0.88) : dark ? tint(accent, 0.4) : tint(accent, 0.7) });
  // Row labels.
  if (role.zone === "label" && labels) set({ bold: true, ...(dark ? { fill: tint(accent, 0.5) } : {}) });
  // Subtotals and the grand total.
  if (role.row === "subtotal" || role.col === "subtotal") set({ bold: true, ...(light ? {} : { fill: tint(accent, dark ? 0.45 : 0.7) }), border: { top: line(accent) } });
  if (role.row === "grand" || role.col === "grand") {
    set({ bold: true, ...(dark ? { fill: shade(accent, 0.3), color: white } : family === "medium" ? { fill: accent, color: white } : light && row !== 2 ? {} : { fill: tint(accent, 0.75) }) });
    if (role.row === "grand") set({ border: { top: line(accent, light && row !== 2 ? "double" : "medium") } });
  }
  // The headings.
  if (role.zone === "header" && head) {
    if (light) set(row === 1 ? { fill: accent, color: white, bold: true } : row === 2 ? { fill: tint(accent, 0.75), bold: true } : { bold: true, border: { top: line(accent), bottom: line(accent, row === 3 ? "medium" : "thin") } });
    else if (family === "medium") set({ fill: row === 1 ? shade(accent, 0.25) : accent, color: white, bold: true });
    else set({ fill: shade(accent, 0.4), color: white, bold: true });
  }
  if (Object.keys(border).length) out.border = border;
  return out;
}
