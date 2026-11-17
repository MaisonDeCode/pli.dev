import { MAX_COLS, MAX_ROWS } from "./model";
import type { Node } from "./formula";
import { makeRef } from "./functions/helpers";
import type { Ctx, RangeRef } from "./functions/types";

/** The cells a reference in a formula points to, or null when its sheet doesn't exist. */
export function refFromNode(node: Extract<Node, { t: "ref" }>, ctx: Ctx): RangeRef | null {
  let sheet = ctx.sheet;
  if (node.sheet !== undefined) {
    const id = ctx.host.sheetId(node.sheet);
    if (id === undefined) return null;
    sheet = id;
  }
  const b = node.b ?? node.a;
  return makeRef(sheet, node.a.row ?? 1, node.a.col ?? 1, b.row ?? MAX_ROWS, b.col ?? MAX_COLS);
}
