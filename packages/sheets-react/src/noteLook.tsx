import type { CSSProperties } from "react";
import { NOTE_FILL, NOTE_LINE_WEIGHT, type NoteBox, type NoteDash } from "@pli.dev/sheets";

/*
 * How a note's box is drawn when it has a look of its own (a fill, a picture, a line, no shadow). A box with none keeps the
 * stylesheet's Excel-yellow rectangle; one with a look gets a transparent frame, whose line and shadow follow the look, and a
 * layer behind its text that holds the fill or picture (so a transparency lets the sheet show through).
 */

const DASH_CSS: Record<NoteDash, string> = {
  solid: "solid",
  dot: "dotted",
  shortDot: "dotted",
  dash: "dashed",
  shortDash: "dashed",
  longDash: "dashed",
  dashDot: "dashed",
  shortDashDot: "dashed",
  longDashDot: "dashed",
  longDashDotDot: "dashed",
  shortDashDotDot: "dashed",
};

/** Whether the box has a fill of its own (a colour, a picture or a transparency). */
export const hasFill = (box: NoteBox | undefined): boolean => !!box && (box.fill !== undefined || box.picture !== undefined || box.transparency !== undefined);

/** The css of the frame of a note's box: its line and shadow, and no background of its own when a fill layer draws it. */
export function noteFrameCss(box: NoteBox | undefined): CSSProperties {
  const out: CSSProperties = {};
  if (!box) return out;
  if (hasFill(box)) out.background = "transparent";
  if (box.line === "none") out.borderColor = "transparent";
  else if (box.line !== undefined || box.lineWeight !== undefined || box.dash !== undefined) {
    out.border = `${box.lineWeight ?? NOTE_LINE_WEIGHT}pt ${DASH_CSS[box.dash ?? "solid"]} ${box.line ?? "#000000"}`;
  }
  if (box.shadow === false) out.boxShadow = "none";
  return out;
}

/** The colour of the line that joins a shown note to its cell. */
export const noteLineColor = (box: NoteBox | undefined): string | undefined => (box?.line && box.line !== "none" ? box.line : undefined);

/** The layer behind a note's text that holds its fill or picture, or nothing when the box is drawn by the stylesheet. */
export function NoteFill({ box }: { box: NoteBox | undefined }) {
  if (!box || !hasFill(box)) return null;
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundColor: box.fill ?? NOTE_FILL,
    ...(box.picture ? { backgroundImage: `url("${box.picture}")`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" } : {}),
    opacity: 1 - (box.transparency ?? 0) / 100,
  };
  return <div className="pli-note-fill" data-picture={box.picture ? "" : undefined} style={style} aria-hidden="true" />;
}
