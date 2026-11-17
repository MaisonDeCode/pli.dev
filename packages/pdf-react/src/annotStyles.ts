import type { Annotation, LineEnd, NoteAnnot } from "@pli.dev/pdf";

/** The tools that draw or write something. Each one remembers the style you used last. */
export type StyleKey =
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "ink"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polyline"
  | "polygon"
  | "text"
  | "note"
  | "redact"
  | "signature"
  | "stamp";

/** Everything a tool's style can hold; a tool uses the parts that make sense for it. */
export interface ToolStyle {
  /** Line colour, markup colour, text colour, note colour. */
  color: string;
  /** Interior colour of shapes and text boxes, or the redaction box. `undefined`: none. */
  fill?: string;
  width: number;
  opacity?: number;
  /** Dash pattern as PDF has it; `[]` or none is solid. */
  dash?: number[];
  startEnd?: LineEnd;
  endEnd?: LineEnd;
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  icon?: NonNullable<NoteAnnot["icon"]>;
  /** The tool stays selected after one use. */
  sticky: boolean;
}

export const SWATCHES = ["#ffe14d", "#7cdc5b", "#4cc9f0", "#ff7aa2", "#ff9f1c", "#e53935", "#1e88e5", "#8e24aa", "#212121", "#ffffff"] as const;

const base: ToolStyle = { color: "#e53935", width: 2, family: "Helvetica", size: 12, bold: false, italic: false, align: "left", sticky: false };

export const DEFAULT_STYLES: Readonly<Record<StyleKey, ToolStyle>> = {
  highlight: { ...base, color: "#ffe14d", sticky: true },
  underline: { ...base, color: "#1e88e5", sticky: true },
  strikeout: { ...base, color: "#e53935", sticky: true },
  squiggly: { ...base, color: "#e53935", sticky: true },
  ink: { ...base, color: "#e53935", width: 2, sticky: true },
  rectangle: { ...base },
  ellipse: { ...base },
  line: { ...base, startEnd: "none", endEnd: "none" },
  arrow: { ...base, startEnd: "none", endEnd: "arrow" },
  polyline: { ...base },
  polygon: { ...base },
  text: { ...base, color: "#000000", width: 0 },
  note: { ...base, color: "#ffd400", icon: "comment" },
  redact: { ...base, color: "#d93025", fill: "#000000" },
  signature: { ...base, color: "#0b2a6b", width: 2 },
  stamp: { ...base },
};

export type Styles = Record<StyleKey, ToolStyle>;

export const cloneStyles = (): Styles => Object.fromEntries(Object.entries(DEFAULT_STYLES).map(([k, v]) => [k, { ...v }])) as Styles;

const hasStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Reads a value kept in the browser. Never throws: a private window, blocked storage or bad JSON gives `fallback`. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = hasStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    hasStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: the style simply isn't remembered.
  }
}

/** The styles saved by this browser, over the defaults. */
export function loadStyles(namespace: string): Styles {
  const out = cloneStyles();
  const saved = readStored<Partial<Record<StyleKey, Partial<ToolStyle>>>>(`${namespace}:styles`, {});
  for (const key of Object.keys(out) as StyleKey[]) {
    const s = saved?.[key];
    if (s && typeof s === "object") out[key] = { ...out[key], ...s };
  }
  return out;
}

export const saveStyles = (namespace: string, styles: Styles): void => writeStored(`${namespace}:styles`, styles);

/** Which tool's style an annotation belongs to, so changing it also changes what that tool will draw next. */
export function styleKeyOf(a: Annotation): StyleKey | null {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "ink":
    case "note":
    case "redact":
    case "polyline":
    case "polygon":
    case "signature":
      return a.type;
    case "square":
      return "rectangle";
    case "circle":
      return "ellipse";
    case "line":
      return a.endEnd && a.endEnd !== "none" ? "arrow" : "line";
    case "freetext":
      return "text";
    case "stamp":
      return "stamp";
    default:
      return null;
  }
}

/** The dash patterns the panel offers. */
export const DASHES: { id: string; label: string; dash: number[] | undefined }[] = [
  { id: "solid", label: "Solid", dash: undefined },
  { id: "dashed", label: "Dashed", dash: [6, 3] },
  { id: "dotted", label: "Dotted", dash: [1, 3] },
];

export const dashId = (dash: number[] | undefined): string => {
  if (!dash || dash.length === 0 || dash.every((n) => n === 0)) return "solid";
  return dash[0]! <= 1.5 ? "dotted" : "dashed";
};

export const LINE_ENDS: { id: LineEnd; label: string }[] = [
  { id: "none", label: "None" },
  { id: "arrow", label: "Arrow" },
  { id: "open-arrow", label: "Open arrow" },
  { id: "closed-arrow", label: "Outlined arrow" },
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
  { id: "diamond", label: "Diamond" },
  { id: "butt", label: "Bar" },
  { id: "slash", label: "Slash" },
];
