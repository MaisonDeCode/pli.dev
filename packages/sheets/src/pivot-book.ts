import { PliError } from "@pli.dev/core";
import type { DataBlock, DataModel, PivotStyleDef, Workbook } from "./model";
import { cleanBlock, externalSourceName } from "./pivot-external";
import { cleanModel } from "./pivot-model";
import { cleanPivotStyle, cleanPivotStyleName } from "./pivot-style-custom";

/*
 * What a workbook keeps for its pivot tables beyond the pivot tables themselves: styles of your own, data from outside the
 * workbook, and the data model. One operation sets any of them (`null` takes one away), so each is a single undo step.
 */

export interface PivotBookPatch {
  pivotStyles?: Record<string, PivotStyleDef> | null;
  dataBlocks?: DataBlock[] | null;
  model?: DataModel | null;
}

/** The workbook with these set, and the patch that undoes it. */
export function applyPivotBook(wb: Workbook, patch: PivotBookPatch): { state: Workbook; inverse: PivotBookPatch } {
  const state: Workbook = { ...wb };
  const inverse: PivotBookPatch = {};
  if ("pivotStyles" in patch) {
    inverse.pivotStyles = wb.pivotStyles ?? null;
    if (patch.pivotStyles) {
      const out: Record<string, PivotStyleDef> = {};
      for (const [name, def] of Object.entries(patch.pivotStyles)) out[cleanPivotStyleName(name)] = cleanPivotStyle(def);
      if (Object.keys(out).length) state.pivotStyles = out;
      else delete state.pivotStyles;
    } else delete state.pivotStyles;
  }
  if ("dataBlocks" in patch) {
    inverse.dataBlocks = wb.dataBlocks ?? null;
    if (patch.dataBlocks) {
      const seen = new Set<string>();
      const blocks = patch.dataBlocks.map((b) => {
        const clean = cleanBlock(b);
        const key = externalSourceName(clean.source)!.toLowerCase();
        if (seen.has(key)) throw new PliError("invalid_operation", `There are two data blocks for ${clean.source}`);
        seen.add(key);
        return clean;
      });
      if (blocks.length) state.dataBlocks = blocks;
      else delete state.dataBlocks;
    } else delete state.dataBlocks;
  }
  if ("model" in patch) {
    inverse.model = wb.model ?? null;
    if (patch.model) state.model = cleanModel(patch.model);
    else delete state.model;
  }
  return { state, inverse };
}
