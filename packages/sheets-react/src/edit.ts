import { parseRange, type Bounds } from "@pli.dev/sheets";

/** Whether text ends where a cell reference could be typed next, for clicking a cell into a formula. */
export function expectsReference(text: string, caretAt: number): boolean {
  if (!text.startsWith("=")) return false;
  const before = text.slice(0, caretAt).replace(/\s+$/, "");
  return before.length > 0 && /[=+\-*/^&,(<>]$/.test(before);
}

/** The colours given to the references in a formula, in the order they appear. */
export const REFERENCE_COLORS = ["#4285f4", "#ea4335", "#34a853", "#a142f4", "#f29900", "#00acc1"];

export interface TextReference {
  start: number;
  end: number;
  /** The sheet it names, if it names one. */
  sheet?: string;
  bounds: Bounds;
  color: string;
}

/**
 * The cell and range references in the text of a formula being typed, with where each is and a colour (the same
 * reference always gets the same one). Text in quotes is left alone, and so is anything that isn't finished yet.
 */
export function referencesInText(text: string): TextReference[] {
  if (!text.startsWith("=")) return [];
  const out: TextReference[] = [];
  const colors = new Map<string, string>();
  const re = /"(?:[^"]|"")*"|(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?)(?![A-Za-z0-9_(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('"')) continue;
    // A name that merely ends in letters and digits (LOG10, A1B) isn't a reference.
    if (m.index > 0 && /[A-Za-z0-9_.]/.test(text[m.index - 1]!) && m[1] === undefined && m[2] === undefined) continue;
    const bounds = parseRange(m[3]!.replace(/\$/g, "").toUpperCase());
    if (!bounds) continue;
    const key = (m[1] ?? m[2] ?? "") + "!" + m[3]!.replace(/\$/g, "").toUpperCase();
    let color = colors.get(key);
    if (!color) colors.set(key, (color = REFERENCE_COLORS[colors.size % REFERENCE_COLORS.length]!));
    out.push({ start: m.index, end: m.index + m[0].length, ...(m[1] !== undefined || m[2] !== undefined ? { sheet: (m[1] ?? m[2])!.replace(/''/g, "'") } : {}), bounds, color });
  }
  return out;
}
