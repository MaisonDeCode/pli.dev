import type { ReadContext } from "../context";
import { PdfDict, PdfRef, isArray, isDict, isName, isRef, isStream, isString, textOf } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { FieldAppearance, FieldFlags, FieldType, FormField, Widget } from "../model";
import { FF, acroFormOf, collectFields, colorFromComponents, fieldFlags, fieldOfWidget, fieldType, inherited, normRect, num, numbersOf, parseDA, rectToPage, textValue } from "./tree";
import type { Box, Getter, RawField } from "./tree";
import { checkStyleOfChar, fontFamilyOfDict, standardChoice } from "./names";

/** The type of a field from `/FT` and its flag bits. */
export function typeOf(ft: "Tx" | "Btn" | "Ch" | "Sig", ff: number): FieldType {
  if (ft === "Tx") return "text";
  if (ft === "Sig") return "signature";
  if (ft === "Btn") return ff & FF.Pushbutton ? "button" : ff & FF.Radio ? "radio" : "checkbox";
  return ff & FF.Combo ? "dropdown" : "list";
}

/** The on state of a widget: the key of its normal appearance that isn't `Off`. */
export function onStateOf(g: Getter, widget: PdfDict): string | undefined {
  const ap = g.get(widget.get("AP"));
  if (isDict(ap)) {
    const n = g.get(ap.get("N"));
    if (isDict(n)) for (const k of n.keys()) if (k !== "Off") return k;
  }
  return undefined;
}

const stateName = (g: Getter, o: PdfObj | undefined): string | undefined => {
  const v = g.get(o);
  return isName(v) ? v.value : isString(v) ? textOf(v) : undefined;
};

function readOptions(g: Getter, f: RawField): { value: string; label?: string }[] | undefined {
  const opt = inherited(g, f, "Opt");
  if (!isArray(opt)) return undefined;
  const out: { value: string; label?: string }[] = [];
  for (const e of opt) {
    const v = g.get(e);
    if (isArray(v)) {
      const value = textValue(g, v[0]);
      const label = textValue(g, v[1]);
      if (value !== undefined) out.push(label !== undefined && label !== value ? { value, label } : { value });
    } else {
      const value = textValue(g, v);
      if (value !== undefined) out.push({ value });
    }
  }
  return out;
}

function readStrings(g: Getter, v: PdfObj): string[] {
  if (isArray(v)) return v.flatMap((e) => textValue(g, e) ?? []);
  const t = textValue(g, v);
  return t === undefined ? [] : [t];
}

/** The 1 grey / 3 RGB / 4 CMYK colour array stored under `key` of a dictionary. */
function mkColor(g: Getter, d: PdfDict | undefined, key: string): string | undefined {
  if (!d) return undefined;
  const c = numbersOf(g, d.get(key));
  return c ? colorFromComponents(c) : undefined;
}

function readAppearance(g: Getter, f: RawField, type: FieldType, acro: PdfDict | null, first: PdfDict | undefined): FieldAppearance | undefined {
  const a: FieldAppearance = {};
  const daObj = inherited(g, f, "DA") ?? (acro ? g.get(acro.get("DA")) : null);
  const daText = isString(daObj) ? textOf(daObj) : undefined;
  if (daText !== undefined) {
    const da = parseDA(daText);
    if (da.font) a.font = fontNameOf(g, acro, da.font);
    a.size = da.size;
    if (da.color) a.color = da.color;
  }
  const mk = first ? g.get(first.get("MK")) : null;
  const mkd = isDict(mk) ? mk : undefined;
  const fill = mkColor(g, mkd, "BG");
  if (fill) a.fill = fill;
  const border = mkColor(g, mkd, "BC");
  if (border) a.border = border;
  const bs = first ? g.get(first.get("BS")) : null;
  const bw = isDict(bs) ? g.get(bs.get("W")) : null;
  if (typeof bw === "number") a.borderWidth = bw;
  else {
    const bd = first ? numbersOf(g, first.get("Border")) : undefined;
    if (bd && bd.length >= 3) a.borderWidth = bd[2]!;
    else if (border) a.borderWidth = 1;
  }
  const q = inherited(g, f, "Q") ?? (acro ? g.get(acro.get("Q")) : null);
  if (typeof q === "number") a.align = q === 1 ? "center" : q === 2 ? "right" : "left";
  if ((type === "checkbox" || type === "radio") && mkd) {
    const ca = g.get(mkd.get("CA"));
    const style = isString(ca) ? checkStyleOfChar(textOf(ca)) : undefined;
    if (style) a.checkStyle = style;
  }
  return Object.keys(a).length > 0 ? a : undefined;
}

/** The font a `/DA` names: its `/BaseFont` (without a subset prefix) from the AcroForm's resources, else the resource name. */
function fontNameOf(g: Getter, acro: PdfDict | null, resource: string): string {
  const dr = acro ? g.get(acro.get("DR")) : null;
  const fonts = isDict(dr) ? g.get(dr.get("Font")) : null;
  const font = isDict(fonts) ? g.get(fonts.get(resource)) : null;
  return isDict(font) ? (fontFamilyOfDict(g, font) ?? resource) : (standardChoice(resource)?.name ?? resource);
}

function readFlags(g: Getter, f: RawField, type: FieldType, ff: number): FieldFlags | undefined {
  const fl: FieldFlags = {};
  if (ff & FF.ReadOnly) fl.readOnly = true;
  if (ff & FF.Required) fl.required = true;
  if (type === "text") {
    if (ff & FF.Multiline) fl.multiline = true;
    if (ff & FF.Password) fl.password = true;
    if (ff & FF.Comb) fl.comb = true;
    const max = inherited(g, f, "MaxLen");
    if (typeof max === "number" && max > 0) fl.maxLength = max;
  }
  if (type === "dropdown" && ff & FF.Edit) fl.editable = true;
  if (type === "list" && ff & FF.MultiSelect) fl.multiSelect = true;
  if (type === "radio" && ff & FF.NoToggleToOff) fl.noToggleToOff = true;
  return Object.keys(fl).length > 0 ? fl : undefined;
}

function readValue(g: Getter, f: RawField, type: FieldType, key: "V" | "DV", widgets: { dict: PdfDict }[], options: { value: string; label?: string }[] | undefined): FormField["value"] | undefined {
  const raw = inherited(g, f, key);
  switch (type) {
    case "text":
    case "dropdown": {
      if (raw === null) return key === "V" ? "" : undefined;
      if (isArray(raw)) return textValue(g, raw[0]) ?? "";
      return textValue(g, raw) ?? "";
    }
    case "checkbox": {
      const s = stateName(g, raw);
      if (s !== undefined) return s !== "Off" && s !== "";
      if (key === "DV") return undefined;
      return widgets.some((w) => {
        const as = stateName(g, w.dict.get("AS"));
        return as !== undefined && as !== "Off";
      });
    }
    case "radio": {
      const s = stateName(g, raw);
      if (s !== undefined) return s === "Off" || s === "" ? null : s;
      if (key === "DV") return undefined;
      for (const w of widgets) {
        const as = stateName(g, w.dict.get("AS"));
        if (as !== undefined && as !== "Off") return as;
      }
      return null;
    }
    case "list": {
      if (raw === null) {
        if (key === "DV") return undefined;
        const idx = numbersOf(g, f.dict.get("I"));
        return idx && options ? idx.flatMap((i) => options[i]?.value ?? []) : [];
      }
      return readStrings(g, raw);
    }
    default:
      return key === "V" ? null : undefined;
  }
}

/** The form fields (AcroForm) of a file, as JSON. */
export function readFields(ctx: ReadContext): FormField[] {
  try {
    return read(ctx);
  } catch {
    return [];
  }
}

function read(ctx: ReadContext): FormField[] {
  const file = ctx.file;
  const g: Getter = file;
  const catalog = file.catalog();
  const acro = acroFormOf(g, catalog);

  // Which page each annotation is on (by object number), and each page's visible box.
  const pageOfAnnot = new Map<number, number>();
  const widgetsOnPages: PdfRef[] = [];
  for (const page of ctx.pages) {
    const annots = g.get(page.dict.get("Annots"));
    if (!isArray(annots)) continue;
    for (const a of annots) {
      if (!isRef(a) || pageOfAnnot.has(a.num)) continue;
      pageOfAnnot.set(a.num, page.index);
      const d = g.get(a);
      if (isDict(d) && isName(g.get(d.get("Subtype")), "Widget")) widgetsOnPages.push(a);
    }
  }

  const raws = collectFields(g, acro);
  const known = new Set<number>();
  for (const r of raws) {
    known.add(r.ref.num);
    for (const w of r.widgets) known.add(w.ref.num);
  }
  // Widgets that are on a page but not in /Fields, when they carry a field of their own.
  const extra: RawField[] = [];
  for (const w of widgetsOnPages) {
    if (known.has(w.num)) continue;
    const raw = fieldOfWidget(g, w);
    if (!raw || known.has(raw.ref.num) || !fieldType(g, raw)) continue;
    known.add(raw.ref.num);
    for (const x of raw.widgets) known.add(x.ref.num);
    extra.push(raw);
  }

  const used = new Map<string, number>();
  const out: FormField[] = [];
  for (const raw of [...raws, ...extra]) {
    try {
      const field = readField(ctx, raw, acro, pageOfAnnot, used);
      if (field) out.push(field);
    } catch {
      // a broken field is left out of the model (and left alone in the file)
    }
  }
  return out;
}

function readField(ctx: ReadContext, raw: RawField, acro: PdfDict | null, pageOfAnnot: ReadonlyMap<number, number>, used: Map<string, number>): FormField | undefined {
  const g: Getter = ctx.file;
  const ft = fieldType(g, raw);
  if (!ft) return undefined;
  const ff = fieldFlags(g, raw);
  const type = typeOf(ft, ff);
  const name = raw.name || `field_${raw.ref.num}`;
  const count = (used.get(name) ?? 0) + 1;
  used.set(name, count);
  const id = count === 1 ? `f:${name}` : `f:${name}#${count}`;

  const widgets: Widget[] = [];
  const dicts: { dict: PdfDict }[] = [];
  raw.widgets.forEach((w, i) => {
    const rect = normRect(g, w.dict.get("Rect"));
    const pageIndex = pageOfAnnot.get(w.ref.num) ?? pageIndexOfP(ctx, w.dict);
    const info = pageIndex === undefined ? undefined : ctx.pages[pageIndex];
    dicts.push({ dict: w.dict });
    if (!rect || !info) return;
    const pageId = ctx.pageIdByRef.get(info.ref.key);
    if (!pageId) return;
    const widget: Widget = { id: `w:${ctx.sourceId}:${w.ref.num}`, page: pageId, rect: rectToPage(rect as Box, info.cropBox), ref: w.ref.key };
    if (type === "checkbox" || type === "radio") widget.on = onStateOf(g, w.dict) ?? onFallback(g, raw, w.dict, type, i);
    widgets.push(widget);
  });

  const options = type === "dropdown" || type === "list" ? readOptions(g, raw) : undefined;
  const first = raw.widgets[0]?.dict;
  const value = readValue(g, raw, type, "V", dicts, options) ?? null;
  const defaultValue = readValue(g, raw, type, "DV", dicts, options);
  const flags = readFlags(g, raw, type, ff);
  const tu = raw.chain.map((d) => textValue(g, d.get("TU"))).find((t) => t !== undefined) ?? (first ? textValue(g, first.get("TU")) : undefined);
  const appearance = readAppearance(g, raw, type, acro, first);
  const field: FormField = { id, name, type, value, widgets, ref: raw.ref.key };
  if (defaultValue !== undefined) field.defaultValue = defaultValue;
  if (options) field.options = options;
  if (flags) field.flags = flags;
  if (tu) field.tooltip = tu;
  if (appearance) field.appearance = appearance;
  if (type === "button" && first) {
    const mk = g.get(first.get("MK"));
    const ca = isDict(mk) ? textValue(g, mk.get("CA")) : undefined;
    if (ca) field.caption = ca;
  }
  if (type === "signature") {
    const v = inherited(g, raw, "V");
    if (isDict(v) || isStream(v)) field.signed = true;
  }
  return field;
}

/** A widget without appearance streams: the state its `/AS` or the field's value names, else `Yes` (checkbox) or its position (radio). */
function onFallback(g: Getter, raw: RawField, widget: PdfDict, type: FieldType, index: number): string {
  const as = stateName(g, widget.get("AS"));
  if (as && as !== "Off") return as;
  if (type === "checkbox") {
    const v = stateName(g, inherited(g, raw, "V"));
    return v && v !== "Off" ? v : "Yes";
  }
  return String(index);
}

function pageIndexOfP(ctx: ReadContext, widget: PdfDict): number | undefined {
  const p = widget.get("P");
  if (!isRef(p)) return undefined;
  const id = ctx.pageIdByRef.get(p.key);
  if (!id) return undefined;
  const i = ctx.pages.findIndex((x) => x.ref.key === p.key);
  return i < 0 ? undefined : i;
}

