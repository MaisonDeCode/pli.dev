import { PliError } from "@pli.dev/core";
import type { Bounds } from "./address";
import type { Border, CellBorders, ConditionalStyle, Sheet, TableStyleBorders, TableStyleDef, TableStylePart } from "./model";
import { cleanBorder, cleanBorders, cleanStyle } from "./rule";
import { dataRows, hasHeader, tableAt } from "./table";
import { presetTableStyle } from "./tablestyle-presets";

/** Excel's accent colours: the dark shade the first style of each family uses, then accents 1 to 6. */
const ACCENTS = ["#404040", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

/** The family and colour of an Excel table style name such as `TableStyleMedium2`, or null for no style. */
export function parseTableStyle(name: string | undefined): { family: "light" | "medium" | "dark"; accent: string } | null {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(name ?? "TableStyleMedium2");
  if (!m) return null;
  const n = Number(m[2]);
  return { family: m[1]!.toLowerCase() as "light" | "medium" | "dark", accent: ACCENTS[(n - 1) % 7]! };
}

/** The parts of an Excel table style such as `TableStyleMedium2`, to draw or to start a style of your own from; null for a name that isn't one. The colours follow `palette` (the workbook's theme) when it is given. */
export function builtinTableStyle(name: string | undefined, palette?: readonly string[]): TableStyleDef | null {
  return presetTableStyle(name ?? "TableStyleMedium2", palette);
}

/** The names a style of your own can't have: Excel's, which a file would read as the built-in. */
export function cleanTableStyleName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") throw new PliError("invalid_operation", "A table style needs a name");
  if (name.length > 255) throw new PliError("invalid_operation", "A table style's name is at most 255 characters");
  if (name.toLowerCase() === "none" || /^TableStyle(Light|Medium|Dark)\d+$/i.test(name)) throw new PliError("invalid_operation", `"${name}" is the name of one of the built-in table styles; pick another`);
  return name;
}

const PARTS = ["wholeTable", "firstRowStripe", "secondRowStripe", "firstColumnStripe", "secondColumnStripe", "firstColumn", "lastColumn", "headerRow", "totalRow", "firstHeaderCell", "lastHeaderCell", "firstTotalCell", "lastTotalCell"] as const;

/** One part of a table style made ready to keep: the colours, the lines at its edges, and the lines between its cells. */
function cleanPart(v: TableStylePart): TableStylePart {
  if (!v || typeof v !== "object") throw new PliError("invalid_operation", "A part of a table style is an object");
  const { border, ...rest } = v;
  const out: TableStylePart = cleanStyle(rest as ConditionalStyle);
  if (border === undefined) return out;
  if (!border || typeof border !== "object") throw new PliError("invalid_operation", "A part's lines are an object");
  const { horizontal, vertical, ...edges } = border as TableStyleBorders;
  const lines: TableStyleBorders = cleanBorders(edges) ?? {};
  if (horizontal) lines.horizontal = cleanBorder(horizontal);
  if (vertical) lines.vertical = cleanBorder(vertical);
  if (Object.keys(lines).length) out.border = lines;
  return out;
}

/** A table style made ready to keep: each part's colours and lines are checked, and parts that say nothing are left out. */
export function cleanTableStyle(style: TableStyleDef): TableStyleDef {
  if (!style || typeof style !== "object") throw new PliError("invalid_operation", "A table style needs its parts");
  const out: TableStyleDef = {};
  for (const k of Object.keys(style)) {
    if (k === "rowStripeSize" || k === "columnStripeSize") continue;
    if (!(PARTS as readonly string[]).includes(k)) throw new PliError("invalid_operation", `A table style has ${PARTS.join(", ")}, not "${k}"`);
  }
  for (const part of PARTS) {
    const v = style[part];
    if (v === undefined) continue;
    const cleaned = cleanPart(v);
    if (Object.keys(cleaned).length) out[part] = cleaned;
  }
  for (const k of ["rowStripeSize", "columnStripeSize"] as const) {
    const n = style[k];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 1 || n > 9) throw new PliError("invalid_operation", "Stripes are 1 to 9 rows or columns wide");
    if (n > 1) out[k] = n;
  }
  return out;
}

/** The style a table is drawn in: one of your own under that name, else Excel's built-in; null for `none` or a name nothing is known of. */
export function resolveTableStyle(name: string | undefined, custom?: Record<string, TableStyleDef>, palette?: readonly string[]): TableStyleDef | null {
  if (name === "none") return null;
  const key = name === undefined ? undefined : Object.keys(custom ?? {}).find((n) => n.toLowerCase() === name.toLowerCase());
  if (key !== undefined) return custom![key]!;
  return builtinTableStyle(name, palette);
}

/** The cells a part of a style covers as one block: the lines at the block's edges are its outer lines, the ones inside it are the lines between cells. */
export type Region = Pick<Bounds, "r1" | "r2" | "c1" | "c2">;

export function layer(into: ConditionalStyle, from: TableStylePart | undefined, row: number, col: number, region: Region): void {
  if (!from) return;
  const { border, ...rest } = from;
  Object.assign(into, rest);
  if (!border) return;
  const sides: CellBorders = {};
  const pick = (edge: Border | undefined, inner: Border | undefined, onEdge: boolean) => (onEdge ? edge : inner);
  const top = pick(border.top, border.horizontal, row === region.r1);
  const bottom = pick(border.bottom, border.horizontal, row === region.r2);
  const left = pick(border.left, border.vertical, col === region.c1);
  const right = pick(border.right, border.vertical, col === region.c2);
  if (top) sides.top = top;
  if (bottom) sides.bottom = bottom;
  if (left) sides.left = left;
  if (right) sides.right = right;
  if (border.diagonalUp) sides.diagonalUp = border.diagonalUp;
  if (border.diagonalDown) sides.diagonalDown = border.diagonalDown;
  if (Object.keys(sides).length) into.border = { ...into.border, ...sides };
}

/**
 * How a table's style looks on one cell: the header, the shaded rows, the totals. Undefined where it adds nothing. As in
 * Excel, the lines a part sets at its top, bottom, left and right are those of the block of cells it covers (the whole
 * table, the header row, one stripe, a column…), and `horizontal` and `vertical` run between the cells inside the block.
 */
export function tableLook(sheet: Sheet, row: number, col: number, custom?: Record<string, TableStyleDef>, palette?: readonly string[]): ConditionalStyle | undefined {
  if (!sheet.tables?.length) return undefined;
  const entry = tableAt(sheet, row, col);
  if (!entry) return undefined;
  const { table, bounds: b } = entry;
  const def = resolveTableStyle(table.style, custom, palette);
  if (!def) return undefined;
  const out: ConditionalStyle = {};
  const [top, bottom] = dataRows(table, b);
  const isHeader = hasHeader(table) && row === b.r1;
  const isTotal = !!table.totals && row === b.r2;
  const whole: Region = b;
  layer(out, def.wholeTable, row, col, whole);
  if (!isHeader && !isTotal) {
    if (table.bandedRows !== false) {
      const size = def.rowStripeSize ?? 1;
      const k = Math.floor((row - top) / size);
      const stripe: Region = { r1: top + k * size, r2: Math.min(bottom, top + k * size + size - 1), c1: b.c1, c2: b.c2 };
      layer(out, k % 2 === 0 ? def.firstRowStripe : def.secondRowStripe, row, col, stripe);
    }
    if (table.bandedColumns) {
      const size = def.columnStripeSize ?? 1;
      const k = Math.floor((col - b.c1) / size);
      const stripe: Region = { r1: top, r2: bottom, c1: b.c1 + k * size, c2: Math.min(b.c2, b.c1 + k * size + size - 1) };
      layer(out, k % 2 === 0 ? def.firstColumnStripe : def.secondColumnStripe, row, col, stripe);
    }
  }
  if (table.firstColumn && col === b.c1) layer(out, def.firstColumn, row, col, { r1: b.r1, r2: b.r2, c1: b.c1, c2: b.c1 });
  if (table.lastColumn && col === b.c2) layer(out, def.lastColumn, row, col, { r1: b.r1, r2: b.r2, c1: b.c2, c2: b.c2 });
  if (isHeader) {
    layer(out, def.headerRow, row, col, { r1: b.r1, r2: b.r1, c1: b.c1, c2: b.c2 });
    if (col === b.c1) layer(out, def.firstHeaderCell, row, col, { r1: row, r2: row, c1: col, c2: col });
    if (col === b.c2) layer(out, def.lastHeaderCell, row, col, { r1: row, r2: row, c1: col, c2: col });
  } else if (isTotal) {
    layer(out, def.totalRow, row, col, { r1: b.r2, r2: b.r2, c1: b.c1, c2: b.c2 });
    if (col === b.c1) layer(out, def.firstTotalCell, row, col, { r1: row, r2: row, c1: col, c2: col });
    if (col === b.c2) layer(out, def.lastTotalCell, row, col, { r1: row, r2: row, c1: col, c2: col });
  }
  // Where two parts draw the same line (the header's bottom and the first data row's top…), the part that names the edge wins on both sides.
  const edge = (side: "top" | "bottom" | "left" | "right", line: Border | undefined) => {
    if (line) out.border = { ...out.border, [side]: line };
  };
  if (!isHeader && hasHeader(table) && row === b.r1 + 1) edge("top", def.headerRow?.border?.bottom);
  if (!isTotal && table.totals && row === b.r2 - 1) edge("bottom", def.totalRow?.border?.top);
  if (!isHeader && !isTotal && table.firstColumn && col === b.c1 + 1) edge("left", def.firstColumn?.border?.right);
  if (!isHeader && !isTotal && table.lastColumn && col === b.c2 - 1) edge("right", def.lastColumn?.border?.left);
  return Object.keys(out).length ? out : undefined;
}
