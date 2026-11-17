import { createId, PliError } from "@pli.dev/core";
import type { Annotation, FieldAppearance, FieldFlags, FieldType, FormField, Rect, Widget } from "../model";
import type { PdfOp } from "../ops";
import type { SignatureInput } from "./annots";

/** What `sign` takes: a signature as `addSignature` does, and for a drawn one the size of the box its strokes are in. */
export type SignInput = Exclude<SignatureInput, { mode: "draw" }> | (Extract<SignatureInput, { mode: "draw" }> & { box?: { width: number; height: number } });
import type { PdfSession } from "../session";

type Value = FormField["value"];

/** A field as you make it with `addField`. */
export interface NewField {
  type: FieldType;
  /** The full name; dots make groups (`person.name`). Must be new. */
  name: string;
  /** Where it goes (all types but a radio group). */
  rect?: Rect;
  /** A radio group: one entry per button. `on` is the value the button stands for. */
  buttons?: { rect: Rect; on?: string; page?: string }[];
  /** A check box: the value it stands for when on (default `Yes`). */
  on?: string;
  value?: Value;
  defaultValue?: Value;
  /** Dropdown and list: the choices (a string is both value and label). */
  options?: (string | { value: string; label?: string })[];
  flags?: FieldFlags;
  tooltip?: string;
  appearance?: FieldAppearance;
  /** Button: the text on it. */
  caption?: string;
}

/** Something wrong with the form as it is: a required field left empty, a value too long, a choice that is not listed. */
export interface FormProblem {
  field: string;
  name: string;
  kind: "required" | "maxLength" | "option";
  message: string;
}

const empty = (f: FormField): boolean => {
  const v = f.value;
  if (f.type === "checkbox") return v !== true;
  if (Array.isArray(v)) return v.length === 0;
  return v === null || v === "";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const fail = (message: string): never => {
  throw new PliError("invalid_operation", message);
};

/** The value to store for what the caller gave, or an error. */
export function normalizeValue(field: FormField, input: unknown): Value {
  const label = `field ${field.name}`;
  switch (field.type) {
    case "text": {
      if (input === null || input === undefined) return "";
      if (typeof input === "number" || typeof input === "bigint") input = String(input);
      if (typeof input !== "string") return fail(`${label} takes text`);
      const max = field.flags?.maxLength;
      if (max && [...input].length > max) return fail(`${label} takes at most ${max} characters`);
      return input;
    }
    case "checkbox": {
      if (typeof input === "boolean") return input;
      if (typeof input === "string") {
        const on = field.widgets[0]?.on ?? "Yes";
        if (input === on) return true;
        if (input === "" || input === "Off") return false;
      }
      return fail(`${label} is a check box: use true or false`);
    }
    case "radio": {
      if (input === null || input === undefined || input === "" || input === "Off") return null;
      if (typeof input !== "string") return fail(`${label} is a radio group: use one of its values`);
      const ons = field.widgets.map((w) => w.on).filter((x): x is string => !!x);
      if (ons.length > 0 && !ons.includes(input)) return fail(`${label} has no button for "${input}" (${ons.join(", ")})`);
      return input;
    }
    case "dropdown": {
      if (input === null || input === undefined) return "";
      if (typeof input !== "string") return fail(`${label} takes one of its options`);
      if (input === "") return "";
      const opts = field.options ?? [];
      const byValue = opts.find((o) => o.value === input);
      if (byValue) return byValue.value;
      const byLabel = opts.find((o) => o.label === input);
      if (byLabel) return byLabel.value;
      if (field.flags?.editable) return input;
      return fail(`${label} has no option "${input}"`);
    }
    case "list": {
      const list = input === null || input === undefined ? [] : Array.isArray(input) ? input : [input];
      if (!list.every((x) => typeof x === "string")) return fail(`${label} takes option values`);
      const opts = field.options ?? [];
      const out = (list as string[]).map((x) => {
        const o = opts.find((p) => p.value === x) ?? opts.find((p) => p.label === x);
        if (!o) return fail(`${label} has no option "${x}"`);
        return o!.value;
      });
      if (out.length > 1 && !field.flags?.multiSelect) return fail(`${label} takes one choice`);
      return out;
    }
    default:
      return fail(`${label} cannot be filled (it is a ${field.type})`);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const defaultValueOf = (f: FormField): Value => (f.defaultValue !== undefined ? f.defaultValue : f.type === "checkbox" ? false : f.type === "list" ? [] : f.type === "text" || f.type === "dropdown" ? "" : null);

function strip<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Commands on form fields: `session.forms`. */
export class FormCommands {
  constructor(protected readonly session: PdfSession) {}

  /** Every field. */
  list(): readonly FormField[] {
    return this.session.doc.fields;
  }

  /** The fields that have a widget on the page. */
  onPage(pageId: string): FormField[] {
    return this.session.doc.fields.filter((f) => f.widgets.some((w) => w.page === pageId));
  }

  get(id: string): FormField {
    const field = this.session.doc.fields.find((f) => f.id === id);
    if (!field) throw new PliError("not_found", `field ${id} not found`);
    return field;
  }

  byName(name: string): FormField | undefined {
    return this.session.doc.fields.find((f) => f.name === name);
  }

  /** The field with this id or full name. */
  #find(key: string): FormField {
    const f = this.session.doc.fields.find((x) => x.id === key) ?? this.byName(key);
    if (!f) throw new PliError("not_found", `field ${key} not found`);
    return f;
  }

  /** The field a widget belongs to. */
  ofWidget(widgetId: string): FormField | undefined {
    return this.session.doc.fields.find((f) => f.widgets.some((w) => w.id === widgetId));
  }

  /** Fills a field. The value is checked against the field (see `fill`); a read-only field refuses unless `force`. */
  setValue(id: string, value: FormField["value"], options: { merge?: boolean; force?: boolean } = {}): void {
    const field = this.get(id);
    if (field.flags?.readOnly && !options.force) fail(`field ${field.name} is read only`);
    const v = normalizeValue(field, value);
    this.session.transact([{ type: "set_value", id, value: v }], { merge: options.merge });
  }

  /**
   * Fills several fields in one undoable step: `{ "person.name": "Ana", agree: true }`. Names (or ids) must exist and
   * the values must fit: a check box takes true or false, a radio group one of its `on` values, a drop-down one of its
   * options (or any text when it is editable), a text field no more than `maxLength` characters. Nothing is changed when
   * any of them does not (a `PliError` `invalid_operation` or `not_found`). Read-only fields are refused. Returns the ids changed.
   */
  fill(values: Record<string, unknown>, options: { force?: boolean } = {}): string[] {
    const ops: PdfOp[] = [];
    const ids: string[] = [];
    for (const [key, input] of Object.entries(values)) {
      const field = this.#find(key);
      if (field.flags?.readOnly && !options.force) fail(`field ${field.name} is read only`);
      const v = normalizeValue(field, input);
      if (same(v, field.value)) continue;
      ops.push({ type: "set_value", id: field.id, value: v });
      ids.push(field.id);
    }
    this.session.transact(ops);
    return ids;
  }

  /** Puts every field back to its default value (read-only ones stay). One undoable step. */
  reset(): void {
    const ops: PdfOp[] = [];
    for (const f of this.session.doc.fields) {
      if (f.flags?.readOnly || f.type === "button" || f.type === "signature") continue;
      const v = defaultValueOf(f);
      if (!same(v, f.value)) ops.push({ type: "set_value", id: f.id, value: v });
    }
    this.session.transact(ops);
  }

  /** What is wrong with the form: required fields left empty, text too long for its field, a choice that is not an option. */
  problems(): FormProblem[] {
    const out: FormProblem[] = [];
    for (const f of this.session.doc.fields) {
      if (f.type === "button") continue;
      if (f.flags?.required && f.type !== "signature" && empty(f)) out.push({ field: f.id, name: f.name, kind: "required", message: `${f.name} is required` });
      if (f.type === "text" && typeof f.value === "string" && f.flags?.maxLength && [...f.value].length > f.flags.maxLength) {
        out.push({ field: f.id, name: f.name, kind: "maxLength", message: `${f.name} takes at most ${f.flags.maxLength} characters` });
      }
      if ((f.type === "dropdown" || f.type === "list") && !f.flags?.editable) {
        const chosen = Array.isArray(f.value) ? f.value : typeof f.value === "string" && f.value !== "" ? [f.value] : [];
        for (const c of chosen) if (!(f.options ?? []).some((o) => o.value === c)) out.push({ field: f.id, name: f.name, kind: "option", message: `${f.name} has "${c}", which is not one of its options` });
      }
    }
    return out;
  }

  /** True when `problems()` is empty. */
  isValid(): boolean {
    return this.problems().length === 0;
  }

  /** The values by field name, as JSON: text, true or false, the chosen radio value or null, the chosen list values. Buttons and signatures are left out. */
  exportData(): Record<string, string | boolean | string[] | null> {
    const out: Record<string, string | boolean | string[] | null> = {};
    for (const f of this.session.doc.fields) {
      if (f.type === "button" || f.type === "signature") continue;
      out[f.name] = f.value;
    }
    return out;
  }

  /**
   * Fills fields from `exportData` (an object, or its JSON text). Names that do not exist, read-only fields and values
   * that do not fit are skipped and reported; the rest is filled in one undoable step.
   */
  importData(data: string | Record<string, unknown>): { applied: string[]; skipped: { name: string; reason: string }[] } {
    let obj: unknown = data;
    if (typeof data === "string") {
      try {
        obj = JSON.parse(data);
      } catch {
        throw new PliError("invalid_operation", "the form data is not valid JSON");
      }
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new PliError("invalid_operation", "the form data must be an object of names and values");
    const ops: PdfOp[] = [];
    const applied: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const [name, input] of Object.entries(obj as Record<string, unknown>)) {
      const field = this.byName(name) ?? this.session.doc.fields.find((f) => f.id === name);
      if (!field) {
        skipped.push({ name, reason: "no such field" });
        continue;
      }
      try {
        if (field.flags?.readOnly) fail(`field ${field.name} is read only`);
        const v = normalizeValue(field, input);
        if (!same(v, field.value)) ops.push({ type: "set_value", id: field.id, value: v });
        applied.push(field.name);
      } catch (e) {
        skipped.push({ name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    this.session.transact(ops);
    return { applied, skipped };
  }

  /** Whether `name` can be a new field's name: not used, and not inside or above another field (`a` and `a.b` cannot both hold values). */
  nameProblem(name: string, except?: string): string | undefined {
    if (name.trim() === "" || name.split(".").some((p) => p === "")) return "a field needs a name, and its parts between dots cannot be empty";
    for (const f of this.session.doc.fields) {
      if (f.id === except) continue;
      if (f.name === name) return `there is already a field named ${name}`;
      if (f.name.startsWith(`${name}.`)) return `${name} is a group of fields (${f.name}): it cannot also hold a value`;
      if (name.startsWith(`${f.name}.`)) return `${f.name} is a field that holds a value: it cannot also be a group`;
    }
    return undefined;
  }

  /**
   * Puts a new field on a page and selects it. Returns its id. Text, check box, radio group (`buttons`), drop-down,
   * list, button and signature fields get a sensible look (black 1 point border, 12 point Helvetica) that `appearance` changes.
   */
  addField(pageId: string, spec: NewField, options: { select?: boolean; merge?: boolean } = {}): string {
    const s = this.session;
    if (!s.doc.pages.some((p) => p.id === pageId)) throw new PliError("not_found", `page ${pageId} not found`);
    const problem = this.nameProblem(spec.name);
    if (problem) fail(problem);
    const check = (r: Rect | undefined): Rect => {
      if (!r || !(r.w > 0) || !(r.h > 0)) return fail("a field needs a rectangle with a width and a height");
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    };
    const widgets: Widget[] = [];
    if (spec.type === "radio") {
      const buttons = spec.buttons ?? (spec.rect ? [{ rect: spec.rect, on: spec.on }] : []);
      if (buttons.length === 0) fail("a radio group needs buttons");
      const seen = new Set<string>();
      buttons.forEach((b, i) => {
        const on = b.on ?? `Choice${i + 1}`;
        if (on === "Off" || on === "") fail("a radio button's value cannot be empty or Off");
        if (seen.has(on)) fail(`two radio buttons stand for "${on}"`);
        seen.add(on);
        const page = b.page ?? pageId;
        if (!s.doc.pages.some((p) => p.id === page)) throw new PliError("not_found", `page ${page} not found`);
        widgets.push({ id: createId("w_"), page, rect: check(b.rect), on });
      });
    } else {
      const w: Widget = { id: createId("w_"), page: pageId, rect: check(spec.rect) };
      if (spec.type === "checkbox") {
        w.on = spec.on ?? "Yes";
        if (w.on === "Off" || w.on === "") fail("a check box's value cannot be empty or Off");
      }
      widgets.push(w);
    }
    const base: FieldAppearance = { font: "Helvetica", size: widgets[0]!.rect.h < 16 ? 0 : 12, color: "#000000", border: "#000000", borderWidth: 1 };
    if (spec.type === "button") Object.assign(base, { fill: "#dddddd", align: "center" });
    if (spec.type === "checkbox") Object.assign(base, { size: 0, checkStyle: "check" });
    if (spec.type === "radio") Object.assign(base, { size: 0, checkStyle: "circle" });
    const options_ = spec.options?.map((o) => (typeof o === "string" ? { value: o } : o));
    const field: FormField = {
      id: createId("f_"),
      name: spec.name,
      type: spec.type,
      value: spec.type === "checkbox" ? false : spec.type === "list" ? [] : spec.type === "text" || spec.type === "dropdown" ? "" : null,
      widgets,
    };
    if (options_ && (spec.type === "dropdown" || spec.type === "list")) field.options = options_;
    if (spec.flags) field.flags = strip({ ...spec.flags });
    field.appearance = strip({ ...base, ...spec.appearance });
    if (spec.tooltip) field.tooltip = spec.tooltip;
    if (spec.type === "button") field.caption = spec.caption ?? spec.name.split(".").pop();
    if (spec.defaultValue !== undefined) field.defaultValue = spec.defaultValue;
    if (spec.value !== undefined) field.value = normalizeValue(field, spec.value);
    const last = s.doc.fields[s.doc.fields.length - 1]?.id ?? null;
    s.transact([{ type: "insert_field", field, after: last }], { selection: options.select === false ? undefined : { page: pageId, annots: [], fields: [field.id] }, merge: options.merge });
    return field.id;
  }

  /**
   * Changes a field: its name (it must stay unique), options, flags, look, tooltip, caption, default value or value.
   * `flags` and `appearance` are merged into the current ones; a key set to `undefined` is removed. The field's type and
   * widgets stay (see `setRect`).
   */
  update(
    id: string,
    patch: { name?: string; value?: unknown; defaultValue?: Value; options?: (string | { value: string; label?: string })[] | null; flags?: { [K in keyof FieldFlags]?: FieldFlags[K] | undefined }; tooltip?: string | null; appearance?: { [K in keyof FieldAppearance]?: FieldAppearance[K] | undefined }; caption?: string | null },
    options: { merge?: boolean } = {},
  ): void {
    const cur = this.get(id);
    const next: FormField = { ...cur };
    if (patch.name !== undefined && patch.name !== cur.name) {
      const problem = this.nameProblem(patch.name, id);
      if (problem) fail(problem);
      next.name = patch.name;
    }
    if (patch.options !== undefined) {
      if (cur.type !== "dropdown" && cur.type !== "list") fail(`field ${cur.name} has no options`);
      if (patch.options === null) delete next.options;
      else next.options = patch.options.map((o) => (typeof o === "string" ? { value: o } : o));
    }
    if (patch.flags) {
      const merged = strip({ ...cur.flags, ...patch.flags });
      if (merged) next.flags = merged;
      else delete next.flags;
    }
    if (patch.appearance) {
      const merged = strip({ ...cur.appearance, ...patch.appearance });
      if (merged) next.appearance = merged;
      else delete next.appearance;
    }
    if (patch.tooltip !== undefined) {
      if (patch.tooltip === null || patch.tooltip === "") delete next.tooltip;
      else next.tooltip = patch.tooltip;
    }
    if (patch.caption !== undefined) {
      if (cur.type !== "button") fail(`field ${cur.name} is not a button`);
      if (patch.caption === null) delete next.caption;
      else next.caption = patch.caption;
    }
    if (patch.defaultValue !== undefined) next.defaultValue = patch.defaultValue;
    if (patch.value !== undefined) next.value = normalizeValue(next, patch.value);
    if (same(next, cur)) return;
    this.session.transact([{ type: "replace_field", field: next }], { merge: options.merge });
  }

  /** Moves or resizes one widget (`id` is the widget's id), and puts it on another page when `pageId` is given. */
  setRect(widgetId: string, rect: Rect, pageId?: string, options: { merge?: boolean } = {}): void {
    const field = this.ofWidget(widgetId);
    if (!field) throw new PliError("not_found", `widget ${widgetId} not found`);
    if (!(rect.w > 0) || !(rect.h > 0)) fail("a field needs a rectangle with a width and a height");
    if (pageId && !this.session.doc.pages.some((p) => p.id === pageId)) throw new PliError("not_found", `page ${pageId} not found`);
    const widgets = field.widgets.map((w) => (w.id === widgetId ? { ...w, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, ...(pageId ? { page: pageId } : {}) } : w));
    this.session.transact([{ type: "replace_field", field: { ...field, widgets } }], { merge: options.merge });
  }

  /** Moves or resizes several widgets at once, as one undo step (`widget` is a widget's id). */
  setRects(changes: readonly { widget: string; rect: Rect }[]): void {
    const byField = new Map<string, { field: FormField; rects: Map<string, Rect> }>();
    for (const { widget, rect } of changes) {
      const field = this.ofWidget(widget);
      if (!field) throw new PliError("not_found", `widget ${widget} not found`);
      if (!(rect.w > 0) || !(rect.h > 0)) fail("a field needs a rectangle with a width and a height");
      const entry = byField.get(field.id) ?? { field, rects: new Map<string, Rect>() };
      entry.rects.set(widget, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      byField.set(field.id, entry);
    }
    const ops: PdfOp[] = [...byField.values()].map(({ field, rects }) => ({ type: "replace_field" as const, field: { ...field, widgets: field.widgets.map((w) => (rects.has(w.id) ? { ...w, rect: rects.get(w.id)! } : w)) } }));
    if (ops.length) this.session.transact(ops);
  }

  /** Takes fields out of the document (the same names stay free). */
  remove(ids: readonly string[]): void {
    const doc = this.session.doc;
    const ops: PdfOp[] = ids.flatMap((id) => {
      const i = doc.fields.findIndex((f) => f.id === id);
      return i < 0 ? [] : [{ type: "remove_field" as const, id, prev: doc.fields[i - 1]?.id ?? null }];
    });
    this.session.transact(ops, { selection: { fields: (this.session.selection.fields ?? []).filter((f) => !ids.includes(f)) } });
  }

  /**
   * Signs a signature field: puts a signature the person drew, typed or uploaded INSIDE the field's box, as big as fits with its
   * own proportions (a small margin is left), as one undo step. The field then draws nothing of its own (no caption such as "Sign
   * here", no wash), here and in the saved file, until the signature is removed. Returns the signature annotation's id.
   *
   * `draw`: `strokes` are in a box of `box.width` by `box.height` points that starts at 0, 0 (default: the box that holds them);
   * `width` is the line width.
   * This puts a signature picture on the page, as every PDF editor does. It is not a digital signature (`FormField.signed`).
   */
  sign(field: string, signature: SignInput, options: { select?: boolean } = {}): string {
    const f = this.#find(field);
    if (f.type !== "signature") fail(`field ${f.name} is not a signature field`);
    if (f.flags?.readOnly) fail(`field ${f.name} is read only`);
    if (f.signed) fail(`field ${f.name} already holds a digital signature`);
    const widget = f.widgets[0];
    if (!widget) fail(`field ${f.name} is not on a page`);
    const box = widget!.rect;
    // The size the signature wants (its own proportions), then the biggest of that shape inside the box less a margin.
    let natural: { w: number; h: number };
    let input: SignatureInput = signature;
    if (signature.mode === "draw") {
      const pts = signature.strokes.flat();
      const w = signature.box && signature.box.width > 0 ? signature.box.width : Math.max(1, ...pts.map((p) => p[0]));
      const h = signature.box && signature.box.height > 0 ? signature.box.height : Math.max(1, ...pts.map((p) => p[1]));
      natural = { w, h };
    } else if (signature.mode === "type") natural = { w: Math.max(1.5, signature.text.length * 0.55), h: 1 };
    else natural = { w: signature.picture.width && signature.picture.width > 0 ? signature.picture.width : 3, h: signature.picture.height && signature.picture.height > 0 ? signature.picture.height : 1 };
    const margin = Math.min(2, box.w / 10, box.h / 10);
    const availW = Math.max(1, box.w - 2 * margin);
    const availH = Math.max(1, box.h - 2 * margin);
    const k = Math.min(availW / natural.w, availH / natural.h);
    const w = natural.w * k;
    const h = natural.h * k;
    const rect: Rect = { x: round2(box.x + (box.w - w) / 2), y: round2(box.y + (box.h - h) / 2), w: round2(w), h: round2(h) };
    if (signature.mode === "draw") {
      input = {
        mode: "draw",
        strokes: signature.strokes.map((s) => s.map((p): [number, number] => [round2(p[0] * k), round2(p[1] * k)])),
        ...(signature.color ? { color: signature.color } : {}),
        ...(signature.width ? { width: signature.width } : {}),
      };
    }
    // One step: a signature that was already on this field is replaced, and the new one is put down and selected.
    const s = this.session;
    const now = s.now();
    const user = s.options.user;
    const common = { id: createId("a_"), type: "signature" as const, rect, field: f.name, created: now, modified: now, ...(user ? { author: user.id } : {}), ...(user?.name ? { authorName: user.name } : {}) };
    const annot: Annotation =
      input.mode === "draw"
        ? { ...common, mode: "draw", strokes: input.strokes, ...(input.color ? { color: input.color } : {}), ...(input.width ? { width: input.width } : {}) }
        : input.mode === "type"
          ? { ...common, mode: "type", text: input.text, ...(input.font ? { font: input.font } : {}), ...(input.color ? { color: input.color } : {}) }
          : { ...common, mode: "image", picture: input.picture };
    const ops: PdfOp[] = [];
    for (const page of s.doc.pages) for (const a of page.annots) if (a.type === "signature" && a.field === f.name) ops.push({ type: "remove_annot", page: page.id, id: a.id });
    const page = s.doc.pages.find((p) => p.id === widget!.page);
    if (!page) fail(`the page of field ${f.name} is not in the document`);
    const removed = new Set(ops.map((o) => (o as { id: string }).id));
    const top = [...page!.annots].reverse().find((a) => !removed.has(a.id))?.id ?? null;
    ops.push({ type: "insert_annot", page: page!.id, annot, after: top });
    s.transact(ops, { selection: options.select === false ? undefined : { page: page!.id, annots: [annot.id] } });
    return annot.id;
  }
}
