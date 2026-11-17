import type { FieldType, FormField, PdfDoc, Pt, Rect, Widget } from "@pli.dev/pdf";
import { clampRect, rectFromPoints, round2 } from "./annotGeometry";

/**
 * The pure parts of the form tools: the field kinds you can add, snapping, the order fields are tabbed in, fonts and
 * sizes. Nothing here touches the DOM or the session, so it is tested on its own.
 */

/** What the "Prepare form" tools add. A multi-line text field is a text field with the `multiline` flag. */
export type FieldKind = "text" | "multiline" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export interface KindInfo {
  kind: FieldKind;
  type: FieldType;
  label: string;
  /** The name given to a new field is this plus a number (`Text1`). */
  base: string;
  /** Size of a field placed by a click, in points. */
  w: number;
  h: number;
  hint: string;
}

export const KINDS: readonly KindInfo[] = [
  { kind: "text", type: "text", label: "Text field", base: "Text", w: 150, h: 22, hint: "Drag a box for the text field, or click to place one." },
  { kind: "multiline", type: "text", label: "Multi-line text", base: "Multiline", w: 180, h: 64, hint: "Drag a box for the text area, or click to place one." },
  { kind: "checkbox", type: "checkbox", label: "Check box", base: "Checkbox", w: 14, h: 14, hint: "Click where the check box goes, or drag to size it." },
  { kind: "radio", type: "radio", label: "Radio group", base: "Radio", w: 14, h: 14, hint: "Click where each button goes. Double-click or press Enter after the last one. Escape drops the group." },
  { kind: "dropdown", type: "dropdown", label: "Drop-down", base: "Dropdown", w: 130, h: 22, hint: "Drag a box for the drop-down, or click to place one." },
  { kind: "list", type: "list", label: "List box", base: "List", w: 130, h: 68, hint: "Drag a box for the list, or click to place one." },
  { kind: "signature", type: "signature", label: "Signature field", base: "Signature", w: 170, h: 44, hint: "Drag a box for the signature field, or click to place one." },
  { kind: "button", type: "button", label: "Button", base: "Button", w: 90, h: 26, hint: "Drag a box for the button, or click to place one." },
];

export const kindInfo = (kind: FieldKind): KindInfo => KINDS.find((k) => k.kind === kind)!;

/** The kind of a field as the tools name it. */
export function kindOf(field: FormField): FieldKind {
  if (field.type === "text") return field.flags?.multiline ? "multiline" : "text";
  return field.type as FieldKind;
}

export const typeLabel = (field: FormField): string => kindInfo(kindOf(field)).label;

/** Points a field snaps to while it is drawn or moved. */
export const GRID = 4;
/** The smallest side of a field the tools make, in points. */
export const MIN_FIELD = 8;
/** How far (screen pixels) a pointer travels before a click becomes a drag. */
export const DRAG_PIXELS = 4;

export const snap = (v: number, grid = GRID): number => Math.round(v / grid) * grid;

export interface PageSize {
  width: number;
  height: number;
}

/** A rectangle from a drag between two points, kept on the page and snapped to the grid (unless `snapToGrid` is false). */
export function dragRect(a: Pt, b: Pt, page: PageSize, options: { snap?: boolean; min?: number } = {}): Rect {
  const s = options.snap === false ? (v: number) => round2(v) : (v: number) => snap(v);
  const clampX = (v: number) => Math.max(0, Math.min(page.width, v));
  const clampY = (v: number) => Math.max(0, Math.min(page.height, v));
  const p: Pt = [s(clampX(a[0])), s(clampY(a[1]))];
  const q: Pt = [s(clampX(b[0])), s(clampY(b[1]))];
  const r = rectFromPoints(p, q);
  const min = options.min ?? MIN_FIELD;
  const w = Math.max(min, r.w);
  const h = Math.max(min, r.h);
  return clampRect({ x: r.x, y: r.y, w, h }, page.width, page.height);
}

/** A rectangle of the kind's size centred on a point, kept on the page. */
export function placeRect(at: Pt, w: number, h: number, page: PageSize, options: { snap?: boolean } = {}): Rect {
  const s = options.snap === false ? (v: number) => round2(v) : (v: number) => snap(v);
  return clampRect({ x: s(at[0] - w / 2), y: s(at[1] - h / 2), w, h }, page.width, page.height);
}

/** A rectangle moved by (dx, dy), snapped (its corner) and kept on the page. */
export function moveRect(rect: Rect, dx: number, dy: number, page: PageSize, options: { snap?: boolean } = {}): Rect {
  const s = options.snap === false ? (v: number) => round2(v) : (v: number) => snap(v);
  return clampRect({ x: s(rect.x + dx), y: s(rect.y + dy), w: rect.w, h: rect.h }, page.width, page.height);
}

/** A rectangle after a resize: snapped edges, at least `MIN_FIELD`, inside the page. */
export function snapRect(rect: Rect, page: PageSize, options: { snap?: boolean } = {}): Rect {
  const s = options.snap === false ? (v: number) => round2(v) : (v: number) => snap(v);
  const x1 = Math.max(0, s(rect.x));
  const y1 = Math.max(0, s(rect.y));
  const x2 = Math.min(page.width, s(rect.x + rect.w));
  const y2 = Math.min(page.height, s(rect.y + rect.h));
  return { x: x1, y: y1, w: Math.max(MIN_FIELD, x2 - x1), h: Math.max(MIN_FIELD, y2 - y1) };
}

// ---- Names -----------------------------------------------------------------------------------------------------

/** The first name made from `base` and a number that no field has (`Text1`, `Text2`...). */
export function freeName(base: string, taken: (name: string) => boolean, from = 1): string {
  for (let n = from; ; n++) {
    const name = `${base}${n}`;
    if (!taken(name)) return name;
  }
}

/** A name for a copy of `name`: its trailing number goes up until the name is free (`Text1` gives `Text2`; `age` gives `age2`). */
export function copyName(name: string, taken: (name: string) => boolean): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  const base = m ? m[1]! : name;
  return freeName(base, taken, m ? Number(m[2]) + 1 : 2);
}

// ---- Order -----------------------------------------------------------------------------------------------------

export interface OrderedWidget {
  field: FormField;
  widget: Widget;
  /** Position of the widget's page in the document. */
  page: number;
}

/**
 * Every widget in reading order: page by page; on a page row by row from the top (widgets whose middles are closer than
 * half the smaller height are one row), and each row from left to right. A PDF's own tab order is not part of the
 * document model, so this is the order the form is tabbed in, and what the "tab order" view numbers.
 */
export function readingOrder(doc: Pick<PdfDoc, "pages" | "fields">): OrderedWidget[] {
  const index = new Map(doc.pages.map((p, i) => [p.id, i]));
  const all: OrderedWidget[] = [];
  for (const field of doc.fields) {
    for (const widget of field.widgets) {
      const page = index.get(widget.page);
      if (page !== undefined) all.push({ field, widget, page });
    }
  }
  const seq = new Map(all.map((o, i) => [o.widget.id, i]));
  const out: OrderedWidget[] = [];
  for (let p = 0; p < doc.pages.length; p++) {
    const here = all.filter((o) => o.page === p).sort((a, b) => a.widget.rect.y - b.widget.rect.y || a.widget.rect.x - b.widget.rect.x || seq.get(a.widget.id)! - seq.get(b.widget.id)!);
    const rows: OrderedWidget[][] = [];
    for (const o of here) {
      const row = rows[rows.length - 1];
      const anchor = row?.[0];
      const mid = (r: Rect) => r.y + r.h / 2;
      if (row && anchor && Math.abs(mid(o.widget.rect) - mid(anchor.widget.rect)) < Math.min(o.widget.rect.h, anchor.widget.rect.h) / 2) row.push(o);
      else rows.push([o]);
    }
    for (const row of rows) out.push(...row.sort((a, b) => a.widget.rect.x - b.widget.rect.x || seq.get(a.widget.id)! - seq.get(b.widget.id)!));
  }
  return out;
}

/** Can the person put the cursor in this field? Read-only and signed fields are skipped by Tab. */
export const isFillable = (field: FormField): boolean => !field.flags?.readOnly && !(field.type === "signature" && field.signed);

/**
 * The widgets Tab stops at, in order: a radio group is one stop (the chosen button, or the first), read-only fields none.
 */
export function tabStops(order: readonly OrderedWidget[]): OrderedWidget[] {
  // The stop of a radio group is its chosen button, or the first one.
  const chosen = new Map<string, string>();
  for (const o of order) {
    if (o.field.type !== "radio") continue;
    if (!chosen.has(o.field.id)) chosen.set(o.field.id, o.widget.id);
    if (o.widget.on !== undefined && o.widget.on === o.field.value) chosen.set(o.field.id, o.widget.id);
  }
  return order.filter((o) => isFillable(o.field) && (o.field.type !== "radio" || chosen.get(o.field.id) === o.widget.id));
}

// ---- Look ------------------------------------------------------------------------------------------------------

export interface FontCss {
  family: string;
  weight: number;
  style: "normal" | "italic";
}

/** The CSS font for a PDF font name (`Helvetica-Bold`, `TimesNewRomanPSMT`, `Courier`). */
export function fontCss(name?: string): FontCss {
  const raw = (name ?? "Helvetica").replace(/^[A-Z]{6}\+/, "").replace(/^\//, "");
  const lower = raw.toLowerCase();
  const weight = /bold|black|heavy/.test(lower) ? 700 : 400;
  const style = /italic|oblique/.test(lower) ? "italic" : "normal";
  let family: string;
  if (/courier|mono|consolas/.test(lower)) family = `"Courier New", Courier, monospace`;
  else if (/times|serif|georgia|garamond|palatino/.test(lower) && !/sans/.test(lower)) family = `"Times New Roman", Times, serif`;
  else if (/helvetica|arial|sans/.test(lower) || raw === "") family = "Helvetica, Arial, sans-serif";
  else {
    const family1 = raw.replace(/[-,](Bold|Italic|Oblique|Regular|BoldItalic|BoldOblique)+$/i, "").replace(/MT$|PSMT$|PS$/, "").replace(/["'\\]/g, "");
    family = `"${family1}", Helvetica, Arial, sans-serif`;
  }
  return { family, weight, style };
}

/**
 * The font size in points a field is drawn with. 0 means the text fits the field: a line of text takes about 70% of the
 * height inside the border, a multi-line field and a list use 12.
 */
export function fontSizeOf(field: FormField, widget: Widget): number {
  const size = field.appearance?.size ?? 0;
  if (size > 0) return size;
  const bw = field.appearance?.borderWidth ?? (field.appearance?.border ? 1 : 0);
  if (field.type === "list" || (field.type === "text" && field.flags?.multiline)) return 12;
  const inner = Math.max(2, widget.rect.h - 2 * bw);
  let fit = Math.max(4, Math.min(24, inner * 0.7));
  if (field.type === "text" && field.flags?.comb && field.flags.maxLength) fit = Math.min(fit, widget.rect.w / field.flags.maxLength / 0.62);
  return round2(fit);
}

/** The marks of a check box or radio button, as SVG in a 10 by 10 box. */
export const MARKS: Record<NonNullable<NonNullable<FormField["appearance"]>["checkStyle"]>, { d?: string; fill?: boolean; shape?: "circle" | "rect" }> = {
  check: { d: "M1.8 5.4 4.1 7.8 8.3 2.2" },
  cross: { d: "M2 2 8 8M8 2 2 8" },
  circle: { shape: "circle", fill: true },
  square: { shape: "rect", fill: true },
  diamond: { d: "M5 1.2 8.8 5 5 8.8 1.2 5Z", fill: true },
  star: { d: "M5 .9 6.3 3.7 9.3 4 7 6.1 7.7 9.1 5 7.6 2.3 9.1 3 6.1.7 4 3.7 3.7Z", fill: true },
};

export const CHECK_STYLES = ["check", "circle", "cross", "diamond", "square", "star"] as const;

/** Font names offered in the properties panel (the 14 standard fonts need no file). */
export const FIELD_FONTS = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Times-Roman", "Times-Bold", "Times-Italic", "Courier", "Courier-Bold", "Courier-Oblique"] as const;

/** The text a person sees for a drop-down or list value: the option's label, or the value itself. */
export function optionLabel(field: FormField, value: string): string {
  const o = field.options?.find((x) => x.value === value);
  return o ? (o.label ?? o.value) : value;
}

/** Where the label of a field is for people: its tooltip when it has one, else its name. */
export const fieldLabel = (field: FormField): string => (field.tooltip && field.tooltip.trim() ? field.tooltip.trim() : field.name);
