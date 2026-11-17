/**
 * What reading and writing forms share: the AcroForm field tree (names, inheritance, widgets), field flag bits,
 * colours, the default appearance string, and page-space rectangles.
 */
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, isArray, isDict, isName, isNum, isRef, isStream, isString, textOf } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { decodeStream } from "../cos/filters";
import type { Rect } from "../model";

/** Anything that resolves references: a `PdfFile` or an `Overlay`. */
export interface Getter {
  get(o: PdfObj | undefined): PdfObj;
}

// ---- Field flag bits (ISO 32000-1, tables 221, 226, 228, 230) ---------------------------------------------------------
export const FF = {
  ReadOnly: 1 << 0,
  Required: 1 << 1,
  NoExport: 1 << 2,
  Multiline: 1 << 12,
  Password: 1 << 13,
  NoToggleToOff: 1 << 14,
  Radio: 1 << 15,
  Pushbutton: 1 << 16,
  Combo: 1 << 17,
  Edit: 1 << 18,
  Sort: 1 << 19,
  FileSelect: 1 << 20,
  MultiSelect: 1 << 21,
  DoNotSpellCheck: 1 << 22,
  DoNotScroll: 1 << 23,
  Comb: 1 << 24,
  CommitOnSelChange: 1 << 26,
} as const;

/** The bits `FieldFlags` and the field's type stand for: everything else in `/Ff` is kept as it is. */
export const MODELLED_BITS = FF.ReadOnly | FF.Required | FF.Multiline | FF.Password | FF.NoToggleToOff | FF.Radio | FF.Pushbutton | FF.Combo | FF.Edit | FF.MultiSelect | FF.Comb;

/** Annotation flags (`/F`). */
export const AF = { Invisible: 1, Hidden: 2, Print: 4, NoZoom: 8, NoRotate: 16, NoView: 32, ReadOnly: 64 } as const;

export const num = (o: PdfObj, fallback = 0): number => (isNum(o) && Number.isFinite(o) ? o : fallback);

/** The text of a string, name or (small) stream; undefined for anything else. */
export function textValue(g: Getter, o: PdfObj | undefined): string | undefined {
  const v = g.get(o);
  if (isString(v)) return textOf(v);
  if (isName(v)) return v.value;
  if (isStream(v)) {
    try {
      return textOf(new PdfString(decodeStream(v, (x) => g.get(x))));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A resolved array with its elements resolved. */
export function arrayOf(g: Getter, o: PdfObj | undefined): PdfObj[] | undefined {
  const v = g.get(o);
  return isArray(v) ? v.map((e) => g.get(e)) : undefined;
}

/** Numbers of an array (missing or odd entries are 0). */
export function numbersOf(g: Getter, o: PdfObj | undefined): number[] | undefined {
  const a = arrayOf(g, o);
  return a?.map((e) => num(e));
}

// ---- Colours -----------------------------------------------------------------------------------------------------------

const h2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");

/** A PDF colour (1 grey, 3 RGB or 4 CMYK numbers from 0 to 1) as `#rrggbb`; undefined for no colour (an empty array). */
export function colorFromComponents(c: readonly number[]): string | undefined {
  if (c.length === 1) return `#${h2(c[0]!)}${h2(c[0]!)}${h2(c[0]!)}`;
  if (c.length === 3) return `#${h2(c[0]!)}${h2(c[1]!)}${h2(c[2]!)}`;
  if (c.length === 4) {
    const k = 1 - c[3]!;
    return `#${h2((1 - c[0]!) * k)}${h2((1 - c[1]!) * k)}${h2((1 - c[2]!) * k)}`;
  }
  return undefined;
}

/** `#rrggbb` as PDF numbers. */
export function componentsFromColor(color: string): [number, number, number] {
  let h = color.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [0, 2, 4].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000) as [number, number, number];
}

// ---- The default appearance string (`/DA`) ----------------------------------------------------------------------------------

export interface DefaultAppearance {
  /** The font's name in the AcroForm's `/DR /Font`. */
  font?: string;
  size: number;
  color?: string;
}

/** `/Helv 12 Tf 0 0 1 rg` as parts. Unknown operators are ignored. */
export function parseDA(da: string | undefined): DefaultAppearance {
  const out: DefaultAppearance = { size: 0 };
  if (!da) return out;
  const tokens = da.replace(/\s+/g, " ").trim().split(" ");
  const stack: string[] = [];
  for (const t of tokens) {
    if (t === "Tf") {
      const n = stack.pop();
      const f = stack.pop();
      if (f?.startsWith("/")) out.font = decodeName(f.slice(1));
      const size = Number(n);
      if (Number.isFinite(size)) out.size = size;
      stack.length = 0;
    } else if (t === "g" || t === "rg" || t === "k") {
      const n = t === "g" ? 1 : t === "rg" ? 3 : 4;
      const comps = stack.splice(-n, n).map(Number);
      if (comps.length === n && comps.every(Number.isFinite)) out.color = colorFromComponents(comps);
      stack.length = 0;
    } else stack.push(t);
  }
  return out;
}

function decodeName(s: string): string {
  return s.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function encodeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.\-+]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

const trim = (n: number): string => String(Math.round(n * 1000) / 1000);

/** A `/DA` string. */
export function buildDA(da: DefaultAppearance): string {
  const parts: string[] = [];
  if (da.font) parts.push(`/${encodeName(da.font)} ${trim(da.size)} Tf`);
  const [r, g, b] = componentsFromColor(da.color ?? "#000000");
  parts.push(r === g && g === b ? `${trim(r)} g` : `${trim(r)} ${trim(g)} ${trim(b)} rg`);
  return parts.join(" ");
}

// ---- Rectangles --------------------------------------------------------------------------------------------------------

export type Box = [number, number, number, number];

/** A PDF rectangle as `[x0, y0, x1, y1]` with the corners in order, or undefined. */
export function normRect(g: Getter, o: PdfObj | undefined): Box | undefined {
  const n = numbersOf(g, o);
  if (!n || n.length < 4) return undefined;
  return [Math.min(n[0]!, n[2]!), Math.min(n[1]!, n[3]!), Math.max(n[0]!, n[2]!), Math.max(n[1]!, n[3]!)];
}

/** A widget's `/Rect` in page space: `crop` is the page's visible box. */
export function rectToPage(r: Box, crop: Box): Rect {
  return { x: round(r[0] - crop[0]), y: round(crop[3] - r[3]), w: round(r[2] - r[0]), h: round(r[3] - r[1]) };
}

/** A page-space rectangle as a PDF `/Rect`. */
export function rectToPdf(r: Rect, crop: Box): Box {
  const x0 = r.x + crop[0];
  const y1 = crop[3] - r.y;
  return [round(x0), round(y1 - r.h), round(x0 + r.w), round(y1)];
}

export const round = (n: number): number => Math.round(n * 1000) / 1000;

// ---- The field tree ----------------------------------------------------------------------------------------------------

/** A terminal field: the object that holds the value, with the widgets that show it. */
export interface RawField {
  ref: PdfRef;
  dict: PdfDict;
  /** Partial names from the root to this field. */
  parts: string[];
  name: string;
  /** This field's dictionary, then its parents', up to the root (resolved). */
  chain: PdfDict[];
  /** Each widget: the object, and its dictionary. When the field and the widget are one object, the field itself. */
  widgets: { ref: PdfRef; dict: PdfDict }[];
  /** The field and its only widget are the same dictionary. */
  merged: boolean;
  /** The parent's reference (null for a root field). */
  parent: PdfRef | null;
}

/** An inheritable entry: the field's own or the nearest parent's, resolved. */
export function inherited(g: Getter, f: Pick<RawField, "chain">, key: string): PdfObj {
  for (const d of f.chain) {
    const v = d.get(key);
    if (v !== undefined && v !== null) {
      const r = g.get(v);
      if (r !== null) return r;
    }
  }
  return null;
}

/** `/Ff` as an integer (0 when absent). */
export function fieldFlags(g: Getter, f: Pick<RawField, "chain">): number {
  const v = inherited(g, f, "Ff");
  return isNum(v) ? v >>> 0 : 0;
}

export type FtName = "Tx" | "Btn" | "Ch" | "Sig";

export function fieldType(g: Getter, f: Pick<RawField, "chain">): FtName | undefined {
  const ft = inherited(g, f, "FT");
  return isName(ft) && (ft.value === "Tx" || ft.value === "Btn" || ft.value === "Ch" || ft.value === "Sig") ? ft.value : undefined;
}

const isWidgetLike = (d: PdfDict): boolean => isName(d.get("Subtype"), "Widget") || (!d.has("Subtype") && d.has("Rect"));

/** The AcroForm dictionary of a file or overlay, if it has one. */
export function acroFormOf(g: Getter, catalog: PdfDict): PdfDict | null {
  const a = g.get(catalog.get("AcroForm"));
  return isDict(a) ? a : null;
}

/**
 * Every terminal field reachable from `/AcroForm /Fields`, in tree order. Cycles, missing objects and wrong types are
 * skipped. Fields given as direct dictionaries (not objects) have no reference and cannot be edited: they are skipped.
 */
export function collectFields(g: Getter, acro: PdfDict | null, nodes?: Map<string, PdfRef>): RawField[] {
  const out: RawField[] = [];
  if (!acro) return out;
  const roots = g.get(acro.get("Fields"));
  if (!isArray(roots)) return out;
  const seen = new Set<number>();
  const visit = (ref: PdfObj, chain: PdfDict[], parts: string[], parent: PdfRef | null, depth: number): void => {
    if (!isRef(ref) || depth > 48 || seen.has(ref.num)) return;
    const dict = g.get(ref);
    if (!isDict(dict)) return;
    seen.add(ref.num);
    const t = textValue(g, dict.get("T"));
    const mine = t !== undefined ? [...parts, t] : parts;
    const here = [dict, ...chain];
    const kids = g.get(dict.get("Kids"));
    const list = isArray(kids) ? kids : [];
    const kidDicts = list.map((k) => ({ k, d: g.get(k) })).filter((e): e is { k: PdfObj; d: PdfDict } => isDict(e.d));
    const fieldKids = kidDicts.filter((e) => isRef(e.k) && (e.d.has("T") || e.d.has("Kids")));
    if (fieldKids.length > 0) {
      if (nodes && mine.length > 0) nodes.set(mine.join("."), ref);
      for (const e of fieldKids) visit(e.k, here, mine, ref, depth + 1);
      return;
    }
    const widgets: RawField["widgets"] = [];
    for (const e of kidDicts) if (isRef(e.k)) widgets.push({ ref: e.k, dict: e.d });
    let merged = false;
    if (widgets.length === 0 && isWidgetLike(dict)) {
      widgets.push({ ref, dict });
      merged = true;
    }
    out.push({ ref, dict, parts: mine, name: mine.join("."), chain: here, widgets, merged, parent });
  };
  for (const r of roots) visit(r, [], [], null, 0);
  return out;
}

/** The terminal field at `ref`, with its chain of parents and its widgets, read from the `/Parent` and `/Kids` links. */
export function fieldFromRef(g: Getter, ref: PdfRef): RawField | undefined {
  const dict = g.get(ref);
  if (!isDict(dict)) return undefined;
  const chain: PdfDict[] = [dict];
  const parts: string[] = [];
  const t0 = textValue(g, dict.get("T"));
  if (t0 !== undefined) parts.unshift(t0);
  let cur: PdfDict = dict;
  let parentRef: PdfRef | null = null;
  for (let i = 0; i < 48; i++) {
    const p = cur.get("Parent");
    const pd = g.get(p);
    if (!isRef(p) || !isDict(pd) || chain.includes(pd)) break;
    if (i === 0) parentRef = p;
    chain.push(pd);
    const t = textValue(g, pd.get("T"));
    if (t !== undefined) parts.unshift(t);
    cur = pd;
  }
  const widgets: RawField["widgets"] = [];
  const kids = g.get(dict.get("Kids"));
  if (isArray(kids)) {
    for (const k of kids) {
      const d = g.get(k);
      if (isRef(k) && isDict(d) && !d.has("T") && !d.has("Kids")) widgets.push({ ref: k, dict: d });
    }
  }
  let merged = false;
  if (widgets.length === 0 && isWidgetLike(dict)) {
    widgets.push({ ref, dict });
    merged = true;
  }
  return { ref, dict, parts, name: parts.join("."), chain, widgets, merged, parent: parentRef };
}

/**
 * The field a widget on a page belongs to, when the widget isn't in `/Fields`: the parent when the widget has no
 * name of its own, else the widget itself. Names and the chain come from the `/Parent` links.
 */
export function fieldOfWidget(g: Getter, widgetRef: PdfRef): RawField | undefined {
  const w = g.get(widgetRef);
  if (!isDict(w)) return undefined;
  const parent = w.get("Parent");
  if (!w.has("T") && isRef(parent) && isDict(g.get(parent))) {
    const raw = fieldFromRef(g, parent);
    if (raw && !raw.widgets.some((x) => x.ref.num === widgetRef.num)) raw.widgets.push({ ref: widgetRef, dict: w });
    return raw;
  }
  return fieldFromRef(g, widgetRef);
}

