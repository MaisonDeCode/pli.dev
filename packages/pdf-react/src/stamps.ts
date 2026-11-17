import type { StampAnnot } from "@pli.dev/pdf";

/** A stamp on the stamps menu. `label` is the text drawn; `Date` takes today's date. */
export interface StampDef {
  name: string;
  label: string;
  color: string;
}

const GREEN = "#2e7d32";
const RED = "#c62828";
const BLUE = "#1565c0";

/** The standard stamps, as in the usual PDF readers: a bold upper-case label in a rounded box. */
export const STANDARD_STAMPS: readonly StampDef[] = [
  { name: "Approved", label: "Approved", color: GREEN },
  { name: "NotApproved", label: "Not approved", color: RED },
  { name: "Draft", label: "Draft", color: BLUE },
  { name: "Final", label: "Final", color: GREEN },
  { name: "Confidential", label: "Confidential", color: RED },
  { name: "ForPublicRelease", label: "For public release", color: GREEN },
  { name: "Void", label: "Void", color: RED },
  { name: "Completed", label: "Completed", color: GREEN },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `16 Nov 2026`: the same in every language, so a stamp reads the same wherever the file is opened. */
export function stampDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The stamp that carries today's date. */
export const dateStamp = (ms: number, color = BLUE): StampDef => ({ name: "Date", label: stampDate(ms), color });

export const customStamp = (label: string, color = RED): StampDef => ({ name: "Custom", label: label.trim(), color });

/** The label as drawn. */
export const stampText = (stamp: StampAnnot["stamp"]): string => ("picture" in stamp ? "" : (stamp.label ?? stamp.name).toUpperCase());

/** How big a new stamp is: wide enough for its label, in points. */
export function stampSize(label: string): { w: number; h: number } {
  const w = Math.max(110, Math.min(300, label.length * 15 + 36));
  return { w, h: 44 };
}

/** The size of the text that makes `label` fit a stamp of `w` by `h`. */
export function stampFontSize(label: string, w: number, h: number): number {
  const byWidth = (w - 16) / Math.max(1, label.length * 0.68);
  return Math.max(4, Math.min(h * 0.46, byWidth));
}
