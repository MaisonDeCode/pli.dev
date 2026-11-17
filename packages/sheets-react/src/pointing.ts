import { caret, cellAddress, moveSelection, rangeAddress, sheetRef, type Direction } from "@pli.dev/sheets";
import { expectsReference } from "./edit";

/*
 * Point mode: while a formula is being typed where a reference could go, an arrow key moves a reference instead of the text
 * cursor. The grid's own editor and the formula bar do it the same way, with this.
 */

export interface Pos {
  row: number;
  col: number;
}

/** The reference an arrow key is moving through the formula: where it is in the text, and the cells it covers. */
export interface PointState {
  at: number;
  length: number;
  token: string;
  anchor: Pos;
  focus: Pos;
}

export interface PointInput {
  text: string;
  selStart: number;
  selEnd: number;
  /** The reference the last arrow key put in, if the cursor is still on it. */
  was: PointState | null;
  /** The cell being edited, where pointing starts from. */
  here: Pos;
  /** The arrow key: `ArrowUp`, `ArrowDown`, `ArrowLeft` or `ArrowRight`. */
  key: string;
  shift: boolean;
  /** Ctrl or Cmd: jump to the edge of a block of data. */
  mod: boolean;
  filled?: (row: number, col: number) => boolean;
  /** The name of the sheet shown when the entry is on another sheet, so the reference names it. */
  otherSheet?: string;
}

export interface PointResult {
  text: string;
  state: PointState;
  /** Where the text cursor goes: just after the reference. */
  caret: number;
}

/** What an arrow key does to the formula being typed, or null when it is not for pointing (the text cursor moves as usual). */
export function pointStep(i: PointInput): PointResult | null {
  const { text, was } = i;
  const continuing = !!was && text.slice(was.at, was.at + was.length) === was.token;
  if (!continuing && !expectsReference(text, i.selStart)) return null;
  const dir = i.key.slice(5).toLowerCase() as Direction;
  const at = continuing ? was!.at : i.selStart;
  const end = continuing ? was!.at + was!.length : i.selEnd;
  const from = continuing ? { anchor: was!.anchor, focus: was!.focus } : caret(i.here);
  const next = moveSelection(i.shift ? from : caret(from.focus), dir, { extend: i.shift, ...(i.mod && i.filled ? { filled: i.filled } : {}) });
  const prefix = i.otherSheet !== undefined ? `${sheetRef(i.otherSheet)}!` : "";
  const same = next.anchor.row === next.focus.row && next.anchor.col === next.focus.col;
  const token = prefix + (same ? cellAddress(next.focus.row, next.focus.col) : rangeAddress({ r1: Math.min(next.anchor.row, next.focus.row), c1: Math.min(next.anchor.col, next.focus.col), r2: Math.max(next.anchor.row, next.focus.row), c2: Math.max(next.anchor.col, next.focus.col) }));
  return { text: text.slice(0, at) + token + text.slice(end), state: { at, length: token.length, token, anchor: next.anchor, focus: next.focus }, caret: at + token.length };
}
