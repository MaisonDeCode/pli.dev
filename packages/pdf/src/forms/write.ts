import { PliError } from "@pli.dev/core";
import type { WriteContext } from "../context";
import { ContentBuilder } from "../cos/content";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isNum, isRef, pdfText } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { Overlay } from "../cos/overlay";
import { inheritedPageAttr } from "../cos/pagetree";
import { MAIN_SOURCE } from "../model";
import type { FieldAppearance, FormField, Rect, Widget } from "../model";
import { drawBox, drawList, drawPushButton, drawText, drawToggle, formStream } from "./appearance";
import type { BorderSpec, BorderStyle, CheckStyle } from "./appearance";
import { dropRef, editChild, editList } from "./edit";
import { FormFonts } from "./fonts";
import type { FieldFont } from "./fonts";
import { charOfCheckStyle } from "./names";
import {
  AF,
  FF,
  MODELLED_BITS,
  acroFormOf,
  buildDA,
  collectFields,
  componentsFromColor,
  fieldFlags,
  fieldFromRef,
  fieldType,
  inherited,
  normRect,
  numbersOf,
  parseDA,
  rectToPdf,
  textValue,
} from "./tree";
import type { Box, RawField } from "./tree";
import { onStateOf } from "./read";
import { flattenAll } from "./flatten";
import { withCover, type CoveredField } from "./cover";

/** Canonical JSON: the same value gives the same text whatever the order of keys. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

export function parseRef(s: string | undefined): PdfRef | undefined {
  if (!s) return undefined;
  const [n, g] = s.split(" ");
  const num = Number(n);
  return Number.isInteger(num) && num > 0 ? new PdfRef(num, Number(g) || 0) : undefined;
}

const FT: Record<FormField["type"], string> = { text: "Tx", checkbox: "Btn", radio: "Btn", button: "Btn", dropdown: "Ch", list: "Ch", signature: "Sig" };

function ffBits(f: FormField): number {
  const fl = f.flags ?? {};
  let b = 0;
  if (fl.readOnly) b |= FF.ReadOnly;
  if (fl.required) b |= FF.Required;
  switch (f.type) {
    case "text":
      if (fl.multiline) b |= FF.Multiline;
      if (fl.password) b |= FF.Password;
      if (fl.comb) b |= FF.Comb;
      break;
    case "dropdown":
      b |= FF.Combo;
      if (fl.editable) b |= FF.Edit;
      break;
    case "list":
      if (fl.multiSelect) b |= FF.MultiSelect;
      break;
    case "radio":
      b |= FF.Radio;
      if (fl.noToggleToOff) b |= FF.NoToggleToOff;
      break;
    case "button":
      b |= FF.Pushbutton;
      break;
  }
  return b >>> 0;
}

const qOf = (a: FieldAppearance["align"]): 0 | 1 | 2 => (a === "center" ? 1 : a === "right" ? 2 : 0);

/** The state a checkbox's widgets take when on. */
const onNameOf = (f: FormField, w: Widget | undefined, index = 0): string => w?.on ?? (f.type === "checkbox" ? (f.widgets[0]?.on ?? "Yes") : `Choice${index + 1}`);

/** What a field's value is, as the list of chosen values. */
const valuesOf = (v: FormField["value"]): string[] => (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []);

/** Everything one save does to forms. */
export class FormWriter {
  readonly o: Overlay;
  readonly fonts: FormFonts;
  #form: PdfDict | undefined;
  #nodes: Map<string, PdfRef> | undefined;
  #terminals: Set<string> | undefined;
  /** New object for each field id made in this save. */
  readonly created = new Map<string, PdfRef>();
  readonly #boxes = new Map<string, Box>();
  #xfaDropped = false;

  constructor(readonly ctx: WriteContext) {
    this.o = ctx.overlay;
    this.fonts = new FormFonts(ctx, () => this.editForm());
  }

  // ---- AcroForm ------------------------------------------------------------------------------------------------------

  /** The AcroForm as it is now (do not change it), or null. */
  form(): PdfDict | null {
    return acroFormOf(this.o, this.o.catalog());
  }

  /** The AcroForm to change; made (with a `Helv` font) when the file has none. */
  editForm(): PdfDict {
    if (this.#form) return this.#form;
    const cat = this.o.editCatalog();
    const v = cat.get("AcroForm");
    if (isRef(v) && isDict(this.o.get(v))) this.#form = this.o.edit<PdfDict>(v);
    else if (isDict(v)) this.#form = v;
    else {
      const d = new PdfDict({ Fields: [], DA: pdfText("/Helv 0 Tf 0 g"), NeedAppearances: false });
      cat.set("AcroForm", this.o.add(d));
      this.#form = d;
      this.fonts.standard("Helvetica");
    }
    return this.#form;
  }

  #index(): { nodes: Map<string, PdfRef>; terminals: Set<string> } {
    if (!this.#nodes || !this.#terminals) {
      this.#nodes = new Map();
      this.#terminals = new Set();
      for (const r of collectFields(this.o, this.form(), this.#nodes)) this.#terminals.add(r.name);
    }
    return { nodes: this.#nodes, terminals: this.#terminals };
  }

  // ---- Pages ---------------------------------------------------------------------------------------------------------

  pageRef(pageId: string): PdfRef | undefined {
    const known = this.ctx.pageRefs.get(pageId);
    if (known) return known;
    const page = this.ctx.doc.pages.find((p) => p.id === pageId);
    if (page?.from?.source === MAIN_SOURCE && this.ctx.main) return this.ctx.main.pages()[page.from.index]?.ref;
    return undefined;
  }

  /** The page's visible box in PDF space. */
  box(pageId: string): Box | undefined {
    const cached = this.#boxes.get(pageId);
    if (cached) return cached;
    const ref = this.pageRef(pageId);
    const d = ref ? this.o.get(ref) : null;
    if (!isDict(d)) return undefined;
    const media = normRect(this.o, inheritedPageAttr(this.o, d, "MediaBox")) ?? [0, 0, 612, 792];
    const cropRaw = normRect(this.o, inheritedPageAttr(this.o, d, "CropBox"));
    const crop: Box = cropRaw ? [Math.max(cropRaw[0], media[0]), Math.max(cropRaw[1], media[1]), Math.min(cropRaw[2], media[2]), Math.min(cropRaw[3], media[3])] : media;
    this.#boxes.set(pageId, crop);
    return crop;
  }

  #addToPage(pageId: string, widget: PdfRef): boolean {
    const ref = this.pageRef(pageId);
    if (!ref || !this.o.has(ref)) return false;
    const page = this.o.edit<PdfDict>(ref);
    const list = editList(this.o, page, "Annots");
    if (!list.some((e) => isRef(e) && e.num === widget.num)) list.push(widget);
    return true;
  }

  /** Takes widgets out of the `/Annots` of every page of the document. */
  sweepPages(nums: ReadonlySet<number>): void {
    if (nums.size === 0) return;
    for (const page of this.ctx.doc.pages) {
      const ref = this.pageRef(page.id);
      const d = ref ? this.o.get(ref) : null;
      if (!ref || !isDict(d)) continue;
      const annots = this.o.get(d.get("Annots"));
      if (!isArray(annots) || !annots.some((e) => isRef(e) && nums.has(e.num))) continue;
      const list = editList(this.o, this.o.edit<PdfDict>(ref), "Annots");
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (isRef(e) && nums.has(e.num)) list.splice(i, 1);
      }
    }
  }

  // ---- The field tree ------------------------------------------------------------------------------------------------

  /** Puts a field (or intermediate node) under a parent node, or at the top. */
  #attach(ref: PdfRef, parent: PdfRef | null): void {
    if (parent) {
      const p = this.o.edit<PdfDict>(parent);
      const kids = editList(this.o, p, "Kids");
      if (!kids.some((e) => isRef(e) && e.num === ref.num)) kids.push(ref);
    } else {
      const list = editList(this.o, this.editForm(), "Fields");
      if (!list.some((e) => isRef(e) && e.num === ref.num)) list.push(ref);
    }
  }

  /** Takes a field or node out of its parent's `/Kids` (or the top level), and removes parents left empty. */
  #detach(ref: PdfRef, parent: PdfRef | null): void {
    if (parent && this.o.has(parent)) {
      const p = this.o.edit<PdfDict>(parent);
      const kids = editList(this.o, p, "Kids");
      dropRef(kids, ref);
      if (kids.length === 0) {
        const grandRef = p.get("Parent");
        this.#detach(parent, isRef(grandRef) ? grandRef : null);
        const { nodes } = this.#index();
        for (const [k, v] of nodes) if (v.num === parent.num) nodes.delete(k);
      }
    } else if (this.form()) {
      dropRef(editList(this.o, this.editForm(), "Fields"), ref);
    }
  }

  /** The node for the path `a.b` (made when missing, with its own parents). Null for the top level. */
  #ensureParents(parts: string[], name: string): PdfRef | null {
    const { nodes, terminals } = this.#index();
    let parent: PdfRef | null = null;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}.${part}` : part;
      const known = nodes.get(path);
      if (known) {
        parent = known;
        continue;
      }
      if (terminals.has(path)) throw new PliError("invalid_operation", `the field ${name} cannot be made: ${path} is already a field that holds a value`);
      const node = new PdfDict({ T: pdfText(part), Kids: [] });
      if (parent) node.set("Parent", parent);
      const ref = this.o.add(node);
      this.#attach(ref, parent);
      nodes.set(path, ref);
      parent = ref;
    }
    return parent;
  }

  // ---- Appearance ----------------------------------------------------------------------------------------------------

  #effectiveDA(fd: PdfDict, parents: readonly PdfDict[]): string {
    for (const d of [fd, ...parents]) {
      const v = this.o.get(d.get("DA"));
      const t = textValue(this.o, v);
      if (t !== undefined) return t;
    }
    const form = this.form();
    return (form ? textValue(this.o, form.get("DA")) : undefined) ?? "/Helv 0 Tf 0 g";
  }

  #border(wdict: PdfDict, ap: FieldAppearance): BorderSpec | undefined {
    const width = ap.borderWidth ?? (ap.border ? 1 : 0);
    if (!ap.border || width <= 0) return undefined;
    const bs = this.o.get(wdict.get("BS"));
    let style: BorderStyle = "S";
    let dash: number[] | undefined;
    if (isDict(bs)) {
      const s = this.o.get(bs.get("S"));
      if (isName(s) && ["S", "D", "B", "I", "U"].includes(s.value)) style = s.value as BorderStyle;
      dash = numbersOf(this.o, bs.get("D"));
    }
    return { color: ap.border, width, style, dash };
  }

  /**
   * Draws the widget: replaces `/AP /N` (and for a check box or radio button both states), and sets the field's `/DA`
   * when another font had to be used. `fd` is the field's own dictionary (editable), `parents` its ancestors.
   */
  paint(f: FormField, fd: PdfDict, parents: readonly PdfDict[], w: Widget, index: number, wdict: PdfDict): void {
    const o = this.o;
    const a: FieldAppearance = f.appearance ?? {};
    const mk = o.get(wdict.get("MK"));
    const rot = isDict(mk) && isNum(o.get(mk.get("R"))) ? ((((o.get(mk.get("R")) as number) % 360) + 360) % 360) : 0;
    const rotate = rot === 90 || rot === 180 || rot === 270 ? rot : 0;
    const turned = rotate === 90 || rotate === 270;
    const bw = turned ? w.rect.h : w.rect.w;
    const bh = turned ? w.rect.w : w.rect.h;
    const border = this.#border(wdict, a);
    const da = parseDA(this.#effectiveDA(fd, parents));
    const size = a.size ?? da.size;
    const color = a.color ?? da.color ?? "#000000";
    const look = { w: bw, h: bh, fill: a.fill, border };
    const c = new ContentBuilder();
    let usedFont: FieldFont | undefined;
    const fieldName = f.name;
    switch (f.type) {
      case "text": {
        const text = typeof f.value === "string" ? f.value : "";
        usedFont = this.fonts.resolve({ resource: da.font, family: a.font }, text, fieldName);
        const fl = f.flags ?? {};
        drawText(c, { ...look, text, font: usedFont, size, color, align: qOf(a.align), multiline: fl.multiline, comb: fl.comb, maxLen: fl.maxLength, password: fl.password });
        break;
      }
      case "dropdown": {
        const v = typeof f.value === "string" ? f.value : "";
        const opt = f.options?.find((x) => x.value === v);
        const text = opt?.label ?? opt?.value ?? v;
        usedFont = this.fonts.resolve({ resource: da.font, family: a.font }, text, fieldName);
        drawText(c, { ...look, text, font: usedFont, size, color, align: qOf(a.align) });
        break;
      }
      case "list": {
        const rows = (f.options ?? []).map((x) => x.label ?? x.value);
        usedFont = this.fonts.resolve({ resource: da.font, family: a.font }, rows.join("\n"), fieldName);
        const chosen = new Set(valuesOf(f.value));
        const selected = new Set<number>();
        (f.options ?? []).forEach((x, i) => chosen.has(x.value) && selected.add(i));
        const ti = o.get(fd.get("TI"));
        drawList(c, { ...look, rows, selected, top: isNum(ti) ? Math.max(0, ti) : 0, font: usedFont, size, color });
        break;
      }
      case "button": {
        const caption = f.caption ?? "";
        usedFont = this.fonts.resolve({ resource: da.font, family: a.font }, caption, fieldName);
        drawPushButton(c, { ...look, caption, font: usedFont, size, color });
        break;
      }
      case "checkbox":
      case "radio":
        this.#paintToggle(f, w, index, wdict, look, rotate, color);
        if (a.color && a.color !== da.color) fd.set("DA", pdfText(buildDA({ font: da.font ?? this.fonts.zapf(), size: da.size, color: a.color })));
        return;
      case "signature": {
        // Signed with a signature annotation: the field is an empty box under it (no caption, no wash, no border of its own).
        if ((f as CoveredField).covered) {
          this.#setN(wdict, o.add(formStream("", w.rect.w, w.rect.h, rotate, new PdfDict())));
          // Hidden, too: some readers (MuPDF) draw their own mark ("SIGN") over any signature field that holds no digital signature,
          // whatever its appearance says. The signature annotation is what shows, and the field is not clickable under it.
          const flags = o.get(wdict.get("F"));
          wdict.set("F", (isNum(flags) ? flags : 0) | AF.Hidden);
          return;
        }
        if (!a.fill && !border) return;
        const cc = new ContentBuilder();
        drawBox(cc, look);
        this.#setN(wdict, o.add(formStream(cc.toString(), w.rect.w, w.rect.h, rotate, new PdfDict())));
        return;
      }
    }
    const resources = new PdfDict({ Font: new PdfDict({ [usedFont!.name]: usedFont!.ref }) });
    this.#setN(wdict, o.add(formStream(c.toString(), w.rect.w, w.rect.h, rotate, resources)));
    if (usedFont!.name !== da.font || (a.size !== undefined && a.size !== da.size) || (a.color && a.color !== da.color)) {
      fd.set("DA", pdfText(buildDA({ font: usedFont!.name, size, color })));
    }
  }

  #setN(wdict: PdfDict, stream: PdfRef | PdfDict): void {
    const ap = editChild(this.o, wdict, "AP");
    ap.set("N", stream);
    ap.delete("D");
    ap.delete("R");
  }

  #paintToggle(f: FormField, w: Widget, index: number, wdict: PdfDict, look: { w: number; h: number; fill?: string; border?: BorderSpec }, rotate: number, color: string): void {
    const radio = f.type === "radio";
    const style: CheckStyle = f.appearance?.checkStyle ?? (radio ? "circle" : "check");
    const on = onNameOf(f, w, index);
    const off = new ContentBuilder();
    drawToggle(off, look, radio, false, style, color);
    const onC = new ContentBuilder();
    drawToggle(onC, look, radio, true, style, color);
    const res = () => new PdfDict();
    const n = new PdfDict();
    n.set("Off", this.o.add(formStream(off.toString(), w.rect.w, w.rect.h, rotate, res())));
    n.set(on, this.o.add(formStream(onC.toString(), w.rect.w, w.rect.h, rotate, res())));
    this.#setN(wdict, n);
  }

  // ---- Dictionaries --------------------------------------------------------------------------------------------------

  /** Sets what the model says about colours, border and caption on a widget's `/MK` and `/BS`. */
  #setLook(f: FormField, wdict: PdfDict, only?: ReadonlySet<string>): void {
    const a = f.appearance ?? {};
    const want = (k: string) => !only || only.has(k);
    if (want("fill") || want("border") || want("checkStyle") || want("caption")) {
      const mk = editChild(this.o, wdict, "MK");
      if (want("fill")) a.fill ? mk.set("BG", [...componentsFromColor(a.fill)]) : mk.delete("BG");
      if (want("border")) a.border ? mk.set("BC", [...componentsFromColor(a.border)]) : mk.delete("BC");
      if ((f.type === "checkbox" || f.type === "radio") && want("checkStyle")) mk.set("CA", pdfText(charOfCheckStyle(a.checkStyle ?? (f.type === "radio" ? "circle" : "check"))));
      if (f.type === "button" && want("caption")) f.caption ? mk.set("CA", pdfText(f.caption)) : mk.delete("CA");
    }
    if (want("borderWidth") || want("border")) {
      const width = a.borderWidth ?? (a.border ? 1 : 0);
      const bs = editChild(this.o, wdict, "BS");
      bs.set("Type", PdfName.of("Border"));
      bs.set("W", width);
      if (!bs.has("S")) bs.set("S", PdfName.of("S"));
    }
  }

  /** Writes the entries a field has on its own object. `changed` says which parts of the model differ from the file (everything when null). */
  #writeFieldKeys(f: FormField, fd: PdfDict, base: FormField | undefined, raw: RawField | undefined): void {
    const o = this.o;
    const ch = (sel: (x: FormField) => unknown) => !base || !same(sel(base), sel(f));
    const parents = raw ? raw.chain.slice(1) : [];
    // type and flags
    if (ch((x) => [x.type, x.flags])) {
      const cur = raw ? fieldType(o, { chain: [fd, ...parents] }) : undefined;
      if (cur !== FT[f.type]) fd.set("FT", PdfName.of(FT[f.type]));
      const curFf = raw ? fieldFlags(o, { chain: [fd, ...parents] }) : 0;
      const ff = ((curFf & ~MODELLED_BITS) | ffBits(f)) >>> 0;
      if (ff !== curFf || fd.has("Ff")) ff === 0 && !fd.has("Ff") ? undefined : fd.set("Ff", ff);
      const max = f.flags?.maxLength;
      if (f.type === "text" && max && max > 0) fd.set("MaxLen", max);
      else fd.delete("MaxLen");
    }
    if (ch((x) => x.tooltip)) f.tooltip ? fd.set("TU", pdfText(f.tooltip)) : fd.delete("TU");
    if ((f.type === "dropdown" || f.type === "list") && ch((x) => x.options)) {
      if (f.options) fd.set("Opt", f.options.map((x) => (x.label !== undefined && x.label !== x.value ? [pdfText(x.value), pdfText(x.label)] : pdfText(x.value))));
      else fd.delete("Opt");
    }
    if (ch((x) => x.defaultValue) && f.defaultValue !== undefined) this.#setValue(f, fd, "DV", f.defaultValue);
    if (ch((x) => x.defaultValue) && f.defaultValue === undefined) fd.delete("DV");
    if (ch((x) => x.appearance?.align)) fd.set("Q", qOf(f.appearance?.align));
  }

  #setValue(f: FormField, fd: PdfDict, key: "V" | "DV", value: FormField["value"] | undefined): void {
    if (f.type === "button" || f.type === "signature") return;
    if (value === undefined || (value === null && f.type !== "radio")) {
      fd.delete(key);
      return;
    }
    switch (f.type) {
      case "text":
      case "dropdown":
        fd.set(key, pdfText(Array.isArray(value) ? value.join("\n") : typeof value === "boolean" ? (value ? "Yes" : "") : (value ?? "")));
        break;
      case "checkbox":
        fd.set(key, PdfName.of(value === true || (typeof value === "string" && value !== "" && value !== "Off") ? onNameOf(f, f.widgets[0]) : "Off"));
        break;
      case "radio":
        fd.set(key, PdfName.of(typeof value === "string" && value !== "" ? value : "Off"));
        break;
      case "list": {
        const v = valuesOf(value);
        if (v.length === 0) fd.delete(key);
        else fd.set(key, v.length === 1 && !f.flags?.multiSelect ? pdfText(v[0]!) : v.map((s) => pdfText(s)));
        if (key === "V") {
          const idx = v.flatMap((s) => {
            const i = (f.options ?? []).findIndex((x) => x.value === s);
            return i < 0 ? [] : [i];
          });
          if (idx.length > 0) fd.set("I", idx.sort((a, b) => a - b));
          else fd.delete("I");
        }
        break;
      }
    }
    if (key === "V") fd.delete("RV");
  }

  /** `/AS` of each widget of a check box or radio group from the value. */
  #setStates(f: FormField, wdicts: { w: Widget; dict: PdfDict; index: number }[]): void {
    for (const { w, dict, index } of wdicts) {
      const on = onNameOf(f, w, index);
      const isOn = f.type === "checkbox" ? f.value === true : typeof f.value === "string" && f.value === on;
      dict.set("AS", PdfName.of(isOn ? on : "Off"));
    }
  }

  /** Whether the widget has an appearance for its on state. */
  #hasOnState(wdict: PdfDict, on: string): boolean {
    const ap = this.o.get(wdict.get("AP"));
    const n = isDict(ap) ? this.o.get(ap.get("N")) : null;
    return isDict(n) && n.has(on);
  }

  // ---- Changes -------------------------------------------------------------------------------------------------------

  /** A new widget dictionary for a field. `merged` makes it the field's own dictionary. */
  #newWidget(f: FormField, w: Widget, index: number, parent: PdfRef | null): PdfDict | undefined {
    const box = this.box(w.page);
    const pageRef = this.pageRef(w.page);
    if (!box || !pageRef) {
      this.ctx.warnings.push(`The field ${f.name} has a widget on a page that is not in the file: it was left out.`);
      return undefined;
    }
    const d = new PdfDict({ Type: PdfName.of("Annot"), Subtype: PdfName.of("Widget"), Rect: rectToPdf(w.rect, box), P: pageRef, F: AF.Print });
    if (parent) d.set("Parent", parent);
    if (f.type === "checkbox" || f.type === "radio") d.set("AS", PdfName.of("Off"));
    return d;
  }

  /** Makes a field that is not in the file yet. */
  createField(f: FormField): void {
    const o = this.o;
    const parts = f.name.split(".").filter((p) => p !== "");
    if (parts.length === 0) {
      this.ctx.warnings.push("A field without a name was left out.");
      return;
    }
    const last = parts[parts.length - 1]!;
    const parent = this.#ensureParents(parts.slice(0, -1), f.name);
    const widgets = f.widgets.filter((w) => this.pageRef(w.page));
    if (widgets.length < f.widgets.length) this.ctx.warnings.push(`The field ${f.name} has widgets on pages that are not in the file: they were left out.`);
    const da = f.type === "checkbox" || f.type === "radio" ? { font: this.fonts.zapf(), size: 0, color: f.appearance?.color ?? "#000000" } : { font: this.fonts.resolve({ family: f.appearance?.font }, "", f.name).name, size: f.appearance?.size ?? 12, color: f.appearance?.color ?? "#000000" };
    const fd = new PdfDict();
    fd.set("FT", PdfName.of(FT[f.type]));
    fd.set("T", pdfText(last));
    if (parent) fd.set("Parent", parent);
    this.#writeFieldKeys(f, fd, undefined, undefined);
    if (f.type !== "signature") fd.set("DA", pdfText(buildDA(da)));
    this.#setValue(f, fd, "V", f.value);
    const merged = widgets.length === 1;
    const kidDicts: { w: Widget; dict: PdfDict; index: number; ref: PdfRef }[] = [];
    const ref = o.add(fd);
    this.created.set(f.id, ref);
    this.#attach(ref, parent);
    this.#index().terminals.add(f.name);
    widgets.forEach((w, i) => {
      const dict = merged ? fd : this.#newWidget(f, w, i, ref);
      if (!dict) return;
      if (merged) {
        const wd = this.#newWidget(f, w, i, null)!;
        for (const [k, v] of wd.map) if (k !== "Parent") dict.set(k, v);
      }
      const wref = merged ? ref : o.add(dict);
      this.#setLook(f, dict);
      this.paint(f, fd, [], w, i, dict);
      kidDicts.push({ w, dict, index: i, ref: wref });
      this.#addToPage(w.page, wref);
    });
    if (!merged && kidDicts.length > 0) fd.set("Kids", kidDicts.map((k) => k.ref));
    if (f.type === "checkbox" || f.type === "radio") this.#setStates(f, kidDicts);
  }

  /** Changes a field that is in the file. `base` is how it was read (undefined: unknown, so everything is written). */
  updateField(f: FormField, base: FormField | undefined): void {
    const o = this.o;
    const ref = parseRef(f.ref ?? base?.ref);
    if (!ref || !o.has(ref)) {
      this.createField(f);
      return;
    }
    const raw = fieldFromRef(o, ref);
    if (!raw) {
      this.createField(f);
      return;
    }
    const ch = (sel: (x: FormField) => unknown) => !base || !same(sel(base), sel(f));
    const fd = o.edit<PdfDict>(ref);
    const parents = raw.chain.slice(1);

    if (base && f.name !== base.name) this.#rename(f, fd, raw);
    this.#writeFieldKeys(f, fd, base, raw);
    const valueChanged = ch((x) => x.value);
    if (valueChanged) this.#setValue(f, fd, "V", f.value);

    // widgets: existing, new, removed
    const have = new Map(raw.widgets.map((x) => [x.ref.num, x]));
    const baseWidgets = new Map((base?.widgets ?? []).map((x) => [x.id, x]));
    const present = new Set<string>();
    const removedNums = new Set<number>();
    let merged = raw.merged;
    const wantsMany = f.widgets.filter((w) => !parseRef(w.ref) || !have.has(parseRef(w.ref)!.num)).length > 0 || f.widgets.length > 1;
    let splitRef: PdfRef | undefined;
    if (merged && wantsMany) {
      splitRef = this.#split(ref, fd);
      merged = false;
    }
    const states: { w: Widget; dict: PdfDict; index: number }[] = [];
    const appearanceKeys = new Set<string>();
    for (const key of ["font", "size", "color", "fill", "border", "borderWidth", "align", "checkStyle"] as const) {
      if (!base || base.appearance?.[key] !== f.appearance?.[key]) appearanceKeys.add(key);
    }
    if (ch((x) => x.caption)) appearanceKeys.add("caption");
    const repaintAll = ch((x) => [x.type, x.options, x.flags, x.appearance, x.caption, (x as CoveredField).covered]) || (valueChanged && f.type !== "checkbox" && f.type !== "radio");

    f.widgets.forEach((w, index) => {
      present.add(w.id);
      let wref = parseRef(w.ref);
      if (wref && splitRef && wref.num === ref.num) wref = splitRef;
      const bw = baseWidgets.get(w.id);
      if (wref && have.has(wref.num) || (wref && splitRef && wref.num === splitRef.num)) {
        const dict = merged ? fd : o.edit<PdfDict>(wref!);
        const rectChanged = !bw || !same(bw.rect, w.rect) || bw.page !== w.page;
        if (rectChanged) {
          const box = this.box(w.page);
          if (box) dict.set("Rect", rectToPdf(w.rect, box));
        }
        if (bw && bw.page !== w.page) {
          this.sweepOne(wref!, bw.page);
          const pr = this.pageRef(w.page);
          if (pr) dict.set("P", pr);
          this.#addToPage(w.page, wref!);
        }
        if (appearanceKeys.size > 0) this.#setLook(f, dict, appearanceKeys);
        const sizeChanged = !bw || bw.rect.w !== w.rect.w || bw.rect.h !== w.rect.h;
        const toggle = f.type === "checkbox" || f.type === "radio";
        const needOn = toggle && (!this.#hasOnState(dict, onNameOf(f, w, index)) || (bw && bw.on !== w.on) || appearanceKeys.size > 0 || sizeChanged);
        if (toggle ? needOn : repaintAll || sizeChanged || !this.#hasAp(dict)) this.paint(f, fd, parents, w, index, dict);
        // The signature that covered this field is gone (and the file was saved with it): the field shows again.
        if (base && (base as CoveredField).covered && !(f as CoveredField).covered) {
          const flags = o.get(dict.get("F"));
          if (isNum(flags) && (flags & AF.Hidden)) dict.set("F", flags & ~AF.Hidden);
        }
        states.push({ w, dict, index });
      } else {
        // a new widget on an existing field
        const nd = this.#newWidget(f, w, index, ref);
        if (!nd) return;
        const nref = o.add(nd);
        const kids = editList(o, fd, "Kids");
        kids.push(nref);
        this.#setLook(f, nd);
        this.paint(f, fd, parents, w, index, nd);
        this.#addToPage(w.page, nref);
        states.push({ w, dict: nd, index });
      }
    });
    if ((f.type === "checkbox" || f.type === "radio") && (valueChanged || !base || states.length > 0)) this.#setStates(f, states);
    // widgets that were removed from the model
    for (const bw of base?.widgets ?? []) {
      if (present.has(bw.id)) continue;
      const r = parseRef(bw.ref);
      if (!r) continue;
      removedNums.add(r.num);
      if (!merged) dropRef(editList(o, fd, "Kids"), r);
    }
    this.sweepPages(removedNums);
  }

  #hasAp(dict: PdfDict): boolean {
    const ap = this.o.get(dict.get("AP"));
    return isDict(ap) && this.o.get(ap.get("N")) !== null;
  }

  sweepOne(widget: PdfRef, pageId: string): void {
    const ref = this.pageRef(pageId);
    const d = ref ? this.o.get(ref) : null;
    if (!ref || !isDict(d)) return;
    const annots = this.o.get(d.get("Annots"));
    if (!isArray(annots) || !annots.some((e) => isRef(e) && e.num === widget.num)) return;
    dropRef(editList(this.o, this.o.edit<PdfDict>(ref), "Annots"), widget);
  }

  /** A field that is its own widget gets a separate widget object (the field keeps `/Kids`). Returns the widget. */
  #split(ref: PdfRef, fd: PdfDict): PdfRef {
    const o = this.o;
    const widgetKeys = ["Type", "Subtype", "Rect", "P", "AP", "AS", "MK", "BS", "F", "Border", "H", "OC", "C", "StructParent", "AA", "A", "BM"];
    const w = new PdfDict();
    for (const k of widgetKeys) {
      const v = fd.get(k);
      if (v !== undefined) {
        w.set(k, v);
        fd.delete(k);
      }
    }
    w.set("Parent", ref);
    const wref = o.add(w);
    fd.set("Kids", [wref]);
    // the page lists the widget now
    for (const page of this.ctx.doc.pages) {
      const pr = this.pageRef(page.id);
      const pd = pr ? o.get(pr) : null;
      if (!pr || !isDict(pd)) continue;
      const annots = o.get(pd.get("Annots"));
      if (isArray(annots) && annots.some((e) => isRef(e) && e.num === ref.num)) {
        const list = editList(o, o.edit<PdfDict>(pr), "Annots");
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (isRef(e) && e.num === ref.num) list[i] = wref;
        }
      }
    }
    return wref;
  }

  #rename(f: FormField, fd: PdfDict, raw: RawField): void {
    const parts = f.name.split(".").filter((p) => p !== "");
    if (parts.length === 0) return;
    const last = parts[parts.length - 1]!;
    const oldParent = raw.parts.slice(0, -1).join(".");
    const newParent = parts.slice(0, -1).join(".");
    if (oldParent === newParent) {
      fd.set("T", pdfText(last));
      return;
    }
    // inherited entries stay with the field when it leaves its parents
    for (const key of ["FT", "Ff", "V", "DV", "DA", "Q", "Opt", "MaxLen"]) {
      if (!fd.has(key)) {
        const v = inherited(this.o, raw, key);
        if (v !== null) fd.set(key, v);
      }
    }
    const parent = this.#ensureParents(parts.slice(0, -1), f.name);
    this.#detach(raw.ref, raw.parent);
    this.#attach(raw.ref, parent);
    if (parent) fd.set("Parent", parent);
    else fd.delete("Parent");
    fd.set("T", pdfText(last));
    const { terminals } = this.#index();
    terminals.delete(raw.name);
    terminals.add(f.name);
  }

  /** Takes a field (as it was read) out of the file. Returns the object numbers of its widgets. */
  removeField(base: FormField, gone: Set<number>): void {
    const ref = parseRef(base.ref);
    if (!ref || !this.o.has(ref)) return;
    const raw = fieldFromRef(this.o, ref);
    if (!raw) return;
    for (const w of raw.widgets) gone.add(w.ref.num);
    for (const w of base.widgets) {
      const r = parseRef(w.ref);
      if (r) gone.add(r.num);
    }
    this.#detach(ref, raw.parent);
    this.#index().terminals.delete(raw.name);
  }

  /** Drops the XFA data, which would show the old values (Acrobat prefers it to the fields). */
  dropXfa(): void {
    const form = this.form();
    if (!form || !form.has("XFA") || this.#xfaDropped) return;
    this.#xfaDropped = true;
    this.editForm().delete("XFA");
    this.ctx.warnings.push("The form has XFA data, which does not follow the changed values: it was removed, and readers use the AcroForm fields.");
  }
}

/** A field read from another source file (its object numbers are not this file's): the copied widgets are adopted instead. */
export const isForeign = (f: FormField): boolean => f.ref !== undefined && f.widgets.some((w) => w.id.startsWith("w:") && !w.id.startsWith("w:main:"));

const writers = new WeakMap<WriteContext, FormWriter>();

/** The writer of this save (made on first use). */
export function formWriter(ctx: WriteContext): FormWriter {
  let w = writers.get(ctx);
  if (!w) writers.set(ctx, (w = new FormWriter(ctx)));
  return w;
}

/** Whether the AcroForm says its appearances are out of date. */
function needsAppearances(o: Overlay): boolean {
  const form = acroFormOf(o, o.catalog());
  return !!form && o.get(form.get("NeedAppearances")) === true;
}

/** Widgets on the document's pages that have no field in `/AcroForm` (copied in from another file): they are put in. */
function adopt(w: FormWriter): boolean {
  const { ctx, o } = w;
  let any = false;
  const main = ctx.main;
  const known = new Set<number>();
  const names = new Set<string>();
  const tree = collectFields(o, w.form());
  for (const r of tree) {
    known.add(r.ref.num);
    names.add(r.name);
    for (const x of r.widgets) known.add(x.ref.num);
  }
  for (const page of ctx.doc.pages) {
    const pr = w.pageRef(page.id);
    const pd = pr ? o.get(pr) : null;
    if (!pr || !isDict(pd)) continue;
    const annots = o.get(pd.get("Annots"));
    if (!isArray(annots)) continue;
    for (const a of annots) {
      if (!isRef(a) || known.has(a.num) || (main && main.has(a.num))) continue;
      const d = o.get(a);
      if (!isDict(d) || !isName(o.get(d.get("Subtype")), "Widget") || !d.has("FT")) continue;
      known.add(a.num);
      const fd = o.edit<PdfDict>(a);
      let name = textValue(o, fd.get("T")) ?? `field_${a.num}`;
      for (let i = 2; names.has(name); i++) name = `${textValue(o, fd.get("T")) ?? `field_${a.num}`}_${i}`;
      names.add(name);
      fd.set("T", pdfText(name));
      const list = editList(o, w.editForm(), "Fields");
      list.push(a);
      any = true;
      // the font the widget names must exist in the AcroForm's resources
      const da = parseDA(textValue(o, fd.get("DA")));
      if (da.font) copyFont(w, page.from?.source, da.font);
    }
  }
  return any;
}

function copyFont(w: FormWriter, sourceId: string | undefined, resource: string): void {
  const { ctx, o } = w;
  const have = o.get(editChildRead(o, w.editForm(), ["DR", "Font"])?.get(resource));
  if (have) return;
  const src = sourceId ? ctx.sources.get(sourceId) : undefined;
  if (src) {
    const sform = acroFormOf(src, src.catalog());
    const dr = sform ? src.get(sform.get("DR")) : null;
    const fonts = isDict(dr) ? src.get(dr.get("Font")) : null;
    const entry = isDict(fonts) ? fonts.get(resource) : undefined;
    if (entry !== undefined) {
      const [copied] = o.copyFrom(src, [entry]);
      if (copied) {
        editChild(o, editChild(o, w.editForm(), "DR"), "Font").set(resource, copied);
        return;
      }
    }
  }
  // not found: a standard font by its usual resource name
  const std = Object.entries({ Helv: "Helvetica", HeBo: "Helvetica-Bold", TiRo: "Times-Roman", Cour: "Courier" }).find(([k]) => k === resource);
  if (std) {
    const f = w.fonts.standard(std[1]);
    void f;
  }
}

function editChildRead(o: Overlay, d: PdfDict, path: string[]): PdfDict | undefined {
  let cur: PdfObj = d;
  for (const k of path) {
    cur = isDict(cur) ? o.get(cur.get(k)) : null;
  }
  return isDict(cur) ? cur : undefined;
}

/**
 * Writes new fields, changed values, options, flags and looks, with their appearances. Fields are compared with the
 * baseline by id. Nothing happens when the forms did not change.
 */
export function writeForms(ctx: WriteContext): void {
  const base = ctx.main ? withCover(ctx.baseline.fields, ctx.baseline) : [];
  const baseById = new Map(base.map((f) => [f.id, f]));
  const pageIds = new Set(ctx.doc.pages.map((p) => p.id));
  // widgets on pages that are gone leave with them
  const docFields = withCover(ctx.doc.fields, ctx.doc).filter((f) => !isForeign(f)).map((f) => {
    const kept = f.widgets.filter((w) => pageIds.has(w.page));
    return kept.length === f.widgets.length ? f : { ...f, widgets: kept };
  });
  const original = new Map(ctx.doc.fields.map((f) => [f.id, f]));
  const dropped = docFields.filter((f) => (original.get(f.id)?.widgets.length ?? 0) > 0 && f.widgets.length === 0);
  const live = docFields.filter((f) => !dropped.includes(f));
  const docIds = new Set(live.map((f) => f.id));
  const removed = base.filter((f) => !docIds.has(f.id));
  const added: FormField[] = [];
  const changed: { f: FormField; base: FormField | undefined }[] = [];
  for (const f of live) {
    const b = baseById.get(f.id);
    if (b) {
      if (!same(b, f)) changed.push({ f, base: b });
    } else if (!f.ref) added.push(f);
    else changed.push({ f, base: undefined });
  }
  const w = formWriter(ctx);
  if (ctx.rewrite && ctx.main && base.some((f) => f.signed)) ctx.warnings.push("The file has a digital signature. This save writes a new file, so the signature no longer matches it: only an update of the original keeps a signature valid.");
  const adopted = adoptable(ctx, w);
  if (removed.length === 0 && added.length === 0 && changed.length === 0 && !adopted) return;

  try {
    const gone = new Set<number>();
    for (const b of removed) w.removeField(b, gone);
    for (const c of changed) w.updateField(c.f, c.base);
    for (const f of added) w.createField(f);
    w.sweepPages(gone);
    const adoptedNow = adopt(w);
    // a form that said its appearances were stale is made good: every field's look is drawn, then the flag goes
    if (needsAppearances(ctx.overlay)) repaintAll(w, live, new Set([...changed.map((c) => c.f.id), ...added.map((f) => f.id)]));
    if (changed.length > 0 || added.length > 0 || removed.length > 0 || adoptedNow) {
      w.dropXfa();
      const form = w.form();
      if (form && form.has("NeedAppearances")) w.editForm().set("NeedAppearances", false);
    }
  } finally {
    w.fonts.finish();
  }
}

/** Whether `adopt` has anything to do (widgets that came with copied pages and are not in the form yet). */
function adoptable(ctx: WriteContext, w: FormWriter): boolean {
  const o = ctx.overlay;
  const main = ctx.main;
  const known = new Set<number>();
  for (const r of collectFields(o, w.form())) {
    known.add(r.ref.num);
    for (const x of r.widgets) known.add(x.ref.num);
  }
  for (const page of ctx.doc.pages) {
    const pr = w.pageRef(page.id);
    const pd = pr ? o.get(pr) : null;
    if (!pr || !isDict(pd)) continue;
    const annots = o.get(pd.get("Annots"));
    if (!isArray(annots)) continue;
    for (const a of annots) {
      if (!isRef(a) || known.has(a.num) || (main && main.has(a.num))) continue;
      const d = o.get(a);
      if (isDict(d) && isName(o.get(d.get("Subtype")), "Widget") && d.has("FT")) return true;
    }
  }
  return false;
}

/** Draws again every widget of the fields that were not written this time (their appearance was marked out of date). */
export function repaintAll(w: FormWriter, fields: readonly FormField[], skip: ReadonlySet<string>): void {
  const o = w.o;
  for (const f of fields) {
    if (skip.has(f.id) || f.type === "signature") continue;
    const ref = w.created.get(f.id) ?? parseRef(f.ref);
    if (!ref || !o.has(ref)) continue;
    const raw = fieldFromRef(o, ref);
    if (!raw) continue;
    const fd = o.edit<PdfDict>(ref);
    const parents = raw.chain.slice(1);
    f.widgets.forEach((wd, index) => {
      const wref = parseRef(wd.ref);
      if (!wref || !o.has(wref)) return;
      const dict = wref.num === ref.num ? fd : o.edit<PdfDict>(wref);
      if (f.type === "checkbox" || f.type === "radio") {
        if (onStateOf(o, dict) !== undefined) return; // toggles keep the looks they have
      }
      w.paint(f, fd, parents, wd, index, dict);
    });
  }
}

/** Draws every field into its page and removes it (`flatten`). */
export function flattenForms(ctx: WriteContext): void {
  const w = formWriter(ctx);
  if (ctx.baseline.fields.some((f) => f.signed) && !ctx.warnings.some((m) => /digital signature/.test(m))) ctx.warnings.push("The file has a digital signature. Flattening writes a new file, so the signature no longer matches it.");
  try {
    if (needsAppearances(ctx.overlay) || missingLooks(ctx, w)) repaintAll(w, ctx.doc.fields.filter((f) => !isForeign(f)), new Set(w.created.keys()));
  } finally {
    w.fonts.finish();
  }
  flattenAll(w);
}

/** Whether a text, list or button widget has no normal appearance at all (so flattening would lose it). */
function missingLooks(ctx: WriteContext, w: FormWriter): boolean {
  const o = ctx.overlay;
  for (const f of ctx.doc.fields) {
    if (f.type === "checkbox" || f.type === "radio" || f.type === "signature") continue;
    for (const wd of f.widgets) {
      const r = parseRef(wd.ref);
      const d = r ? o.get(r) : null;
      if (!isDict(d)) continue;
      const ap = o.get(d.get("AP"));
      if (!isDict(ap) || o.get(ap.get("N")) === null) return true;
    }
  }
  void w;
  return false;
}

