import { PliError } from "@pli.dev/core";
import type { ConditionalStyle, PivotStyle, PivotStyleDef, TableStylePart } from "./model";
import type { PivotCellRole, PivotLook } from "./pivot-style";
import { cleanTableStyle, layer, type Region } from "./tablestyle";

/*
 * Pivot table styles of your own. A style is a look for each part of a pivot table (Excel's parts, kept in the file as
 * `tableStyle pivot="1"` with a `tableStyleElement` for each); the table draws it as the cells' own fills, fonts and lines.
 * The lines a part sets at its top, bottom, left and right are those of the block of cells it covers, and `horizontal` and
 * `vertical` run between the cells inside the block, as in table styles.
 */

export const PIVOT_STYLE_PARTS = [
  "wholeTable",
  "headerRow",
  "totalRow",
  "firstColumn",
  "lastColumn",
  "firstRowStripe",
  "secondRowStripe",
  "firstColumnStripe",
  "secondColumnStripe",
  "firstHeaderCell",
  "lastHeaderCell",
  "firstSubtotalColumn",
  "secondSubtotalColumn",
  "thirdSubtotalColumn",
  "firstSubtotalRow",
  "secondSubtotalRow",
  "thirdSubtotalRow",
  "blankRow",
  "firstColumnSubheading",
  "secondColumnSubheading",
  "thirdColumnSubheading",
  "firstRowSubheading",
  "secondRowSubheading",
  "thirdRowSubheading",
  "pageFieldLabels",
  "pageFieldValues",
] as const;

export type PivotStylePart = (typeof PIVOT_STYLE_PARTS)[number];

/** The names a pivot style of your own can't have: Excel's built-in ones, which a file would read as the built-in. */
export function cleanPivotStyleName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") throw new PliError("invalid_operation", "A pivot style needs a name");
  if (name.length > 255) throw new PliError("invalid_operation", "A pivot style's name is at most 255 characters");
  if (name.toLowerCase() === "none" || /^PivotStyle(Light|Medium|Dark)\d+$/i.test(name)) throw new PliError("invalid_operation", `"${name}" is the name of one of the built-in pivot styles; pick another`);
  return name;
}

/** A pivot style made ready to keep: each part's colours and lines are checked, and parts that say nothing are left out. */
export function cleanPivotStyle(style: PivotStyleDef): PivotStyleDef {
  if (!style || typeof style !== "object") throw new PliError("invalid_operation", "A pivot style needs its parts");
  for (const k of Object.keys(style)) {
    if (k === "rowStripeSize" || k === "columnStripeSize") continue;
    if (!(PIVOT_STYLE_PARTS as readonly string[]).includes(k)) throw new PliError("invalid_operation", `A pivot style has ${PIVOT_STYLE_PARTS.join(", ")}, not "${k}"`);
  }
  // Each part is checked the way a table style's part is (colours, lines, fonts).
  const out: PivotStyleDef = {};
  for (const part of PIVOT_STYLE_PARTS) {
    const v = style[part];
    if (v === undefined) continue;
    const cleaned = cleanTableStyle({ wholeTable: v }).wholeTable;
    if (cleaned && Object.keys(cleaned).length) out[part] = cleaned;
  }
  for (const k of ["rowStripeSize", "columnStripeSize"] as const) {
    const n = style[k];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 1 || n > 9) throw new PliError("invalid_operation", "Stripes are 1 to 9 rows or columns wide");
    if (n > 1) out[k] = n;
  }
  return out;
}

/** Where a cell is in the table, for the blocks of cells a style's parts cover. */
export interface StyleSpot {
  /** The cell's row and column in the table (row 0 is the first row of the filters, if any). */
  r: number;
  c: number;
  /** Where the headings start, how many rows of headings and columns of labels there are, the last column of the table and its last row. */
  bodyTop: number;
  headerRows: number;
  labelCols: number;
  last: number;
  height: number;
  /** The place of the cell among the body's lines (0 is the first), the number of lines, and among the columns of data. */
  line: number;
  column: number;
  /** The number of lines and values per column of items, for stripes of columns. */
  lines: number;
}

const level = (n: number | undefined) => (n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 0);

/** How a pivot style of your own draws the cell in this role. */
export function customLook(def: PivotStyleDef, style: PivotStyle, role: PivotCellRole, at: StyleSpot): PivotLook {
  const out: ConditionalStyle = {};
  const { r, c } = at;
  const bodyFirst = at.bodyTop + at.headerRows;
  const cell: Region = { r1: r, r2: r, c1: c, c2: c };
  const wholeRow: Region = { r1: r, r2: r, c1: 0, c2: at.last };
  const whole: Region = { r1: at.bodyTop, r2: at.height - 1, c1: 0, c2: at.last };
  const put = (part: TableStylePart | undefined, region: Region) => layer(out, part, r, c, region);
  if (role.zone === "pageLabel") {
    put(def.pageFieldLabels, cell);
    return finish(out);
  }
  if (role.zone === "pageValue") {
    put(def.pageFieldValues, cell);
    return finish(out);
  }
  put(def.wholeTable, whole);
  const body = role.zone !== "header";
  if (body && style.rowStripes && role.row !== "grand") {
    const size = def.rowStripeSize ?? 1;
    const k = Math.floor((at.line ?? 0) / size);
    put(k % 2 === 0 ? def.firstRowStripe : def.secondRowStripe, { r1: bodyFirst + k * size, r2: Math.min(at.height - 1, bodyFirst + k * size + size - 1), c1: 0, c2: at.last });
  }
  if (role.zone === "body" && style.colStripes) {
    const size = def.columnStripeSize ?? 1;
    const k = Math.floor(at.column / size);
    const c1 = at.labelCols + k * size;
    put(k % 2 === 0 ? def.firstColumnStripe : def.secondColumnStripe, { r1: bodyFirst, r2: at.height - 1, c1, c2: Math.min(at.last, c1 + size - 1) });
  }
  if (role.zone === "label" && style.rowHeaders !== false) put(def.firstColumn, { r1: bodyFirst, r2: at.height - 1, c1: 0, c2: at.labelCols - 1 });
  // Sub-headings: an outer item's own line, and the headings of outer column fields.
  if (role.zone === "label" && role.subheading) put([undefined, def.firstRowSubheading, def.secondRowSubheading, def.thirdRowSubheading][level(role.rowDepth)], wholeRow);
  if (role.zone === "header" && role.colHeadLevel) put([undefined, def.firstColumnSubheading, def.secondColumnSubheading, def.thirdColumnSubheading][level(role.colHeadLevel)], { r1: r, r2: r, c1: at.labelCols, c2: at.last });
  // Subtotals.
  if (role.row === "subtotal" && body) put([undefined, def.firstSubtotalRow, def.secondSubtotalRow, def.thirdSubtotalRow][level(role.rowDepth)], wholeRow);
  if (role.col === "subtotal" && role.zone === "body") put([undefined, def.firstSubtotalColumn, def.secondSubtotalColumn, def.thirdSubtotalColumn][level(role.colDepth)], { r1: bodyFirst, r2: at.height - 1, c1: c, c2: c });
  if (role.col === "grand" && role.zone === "body") put(def.lastColumn, { r1: bodyFirst, r2: at.height - 1, c1: c, c2: c });
  if (role.zone === "header" && style.colHeaders !== false) {
    put(def.headerRow, { r1: at.bodyTop, r2: bodyFirst - 1, c1: 0, c2: at.last });
    if (role.corner === "first") put(def.firstHeaderCell, cell);
    if (role.corner === "last") put(def.lastHeaderCell, cell);
  }
  if (role.row === "grand" && body) put(def.totalRow, wholeRow);
  return finish(out);
}

/** The blank line between items has a look of its own. */
export function blankLook(def: PivotStyleDef, r: number, c: number, at: Pick<StyleSpot, "last" | "bodyTop" | "height">): PivotLook {
  const out: ConditionalStyle = {};
  layer(out, def.wholeTable, r, c, { r1: at.bodyTop, r2: at.height - 1, c1: 0, c2: at.last });
  layer(out, def.blankRow, r, c, { r1: r, r2: r, c1: 0, c2: at.last });
  return finish(out);
}

function finish(s: ConditionalStyle): PivotLook {
  const out: PivotLook = {};
  if (s.fill) out.fill = s.fill;
  if (s.color) out.color = s.color;
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.underline) out.underline = true;
  if (s.strike) out.strike = true;
  if (s.fontFamily) out.fontFamily = s.fontFamily;
  if (s.fontSize) out.fontSize = s.fontSize;
  if (s.border) out.border = s.border;
  return out;
}
