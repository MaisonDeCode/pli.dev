import { useId, useState, type ReactNode } from "react";
import type { FormField, Widget } from "@pli.dev/pdf";
import { useFormController, type FormController } from "./formController";
import { FormIcons as I } from "./formIcons";
import { Arrange } from "./Arrange";
import { CHECK_STYLES, FIELD_FONTS, KINDS, kindOf, typeLabel } from "./formsGeometry";

/**
 * The properties panel of Prepare form mode (the viewer's `rightPanel`): the selected field's name, tooltip, required and
 * read-only switches, position, options by kind (text options, the choices of a drop-down or list, the values of radio
 * buttons, the mark of a check box, the caption of a button), look (font, size, colours, border, alignment) and default
 * value. With nothing selected it lists the fields and has buttons that add one in the middle of the page.
 */

type Update = (patch: Parameters<FormController["patch"]>[1], burst?: string) => string | null;

function Row({ label, children, error, id }: { label: string; children: ReactNode; error?: string | null; id?: string }) {
  return (
    <div className="pli-pdf-field">
      <label className="pli-pdf-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <span className="pli-pdf-field-error" role="alert" id={id ? `${id}-error` : undefined}>
          {error}
        </span>
      )}
    </div>
  );
}

/** A text box that commits as you type and shows what the engine refuses (a name that is taken). On leaving it shows what is stored. */
function TextProp({ label, value, commit, placeholder, maxLength, multiline }: { label: string; value: string; commit: (text: string) => string | null; placeholder?: string; maxLength?: number; multiline?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const props = {
    id,
    value: draft ?? value,
    placeholder,
    maxLength,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      setError(commit(e.target.value));
    },
    onBlur: () => {
      setDraft(null);
      setError(null);
    },
  };
  return <Row label={label} id={id} error={error}>{multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}</Row>;
}

function NumberProp({ label, value, commit, min, max, step = 1 }: { label: string; value: number; commit: (n: number) => string | null; min?: number; max?: number; step?: number }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Row label={label} id={id} error={error}>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(Math.round(value * 100) / 100)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() === "" || !Number.isFinite(n)) return setError(null);
          setError(commit(n));
        }}
        onBlur={() => {
          setDraft(null);
          setError(null);
        }}
      />
    </Row>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label className="pli-pdf-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Row label={label} id={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o, i) => (
          <option key={i} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function Colour({ label, value, none, onChange }: { label: string; value: string | undefined; none?: string; onChange: (v: string | undefined) => void }) {
  const id = useId();
  return (
    <div className="pli-pdf-field pli-pdf-field-inline">
      <label className="pli-pdf-field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="color" className="pli-pdf-colorinput" value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#000000"} disabled={value === undefined} onChange={(e) => onChange(e.target.value)} />
      {none && <Check label={none} checked={value === undefined} onChange={(off) => onChange(off ? undefined : "#000000")} />}
    </div>
  );
}

// ---- choices ---------------------------------------------------------------------------------------------------

function Choices({ field, update }: { field: FormField; update: (options: { value: string; label?: string }[]) => string | null }) {
  const options = field.options ?? [];
  const [error, setError] = useState<string | null>(null);
  const warn = (list: { value: string }[]) => {
    const values = list.map((o) => o.value);
    if (values.some((v) => v === "")) return "A choice needs a value";
    if (new Set(values).size !== values.length) return "Two choices have the same value";
    return null;
  };
  const set = (list: { value: string; label?: string }[]) => {
    const problem = warn(list);
    setError(problem);
    return update(list) ?? problem;
  };
  const edit = (i: number, patch: { value?: string; label?: string }) => set(options.map((o, j) => (j === i ? clean({ ...o, ...patch }) : o)));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= options.length) return;
    const list = options.slice();
    [list[i], list[j]] = [list[j]!, list[i]!];
    set(list);
  };
  let n = options.length + 1;
  const free = () => {
    while (options.some((o) => o.value === `Option ${n}`)) n++;
    return `Option ${n}`;
  };
  return (
    <fieldset className="pli-pdf-choices">
      <legend>Choices</legend>
      <ol className="pli-pdf-choice-list">
        {options.map((o, i) => (
          <li key={i} className="pli-pdf-choice">
            <input type="text" aria-label={`Choice ${i + 1} value`} placeholder="Value" value={o.value} onChange={(e) => edit(i, { value: e.target.value })} />
            <input type="text" aria-label={`Choice ${i + 1} label`} placeholder="Label (optional)" value={o.label ?? ""} onChange={(e) => edit(i, { label: e.target.value })} />
            <button type="button" className="pli-tool" aria-label={`Move choice ${i + 1} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>
              ↑
            </button>
            <button type="button" className="pli-tool" aria-label={`Move choice ${i + 1} down`} disabled={i === options.length - 1} onClick={() => swap(i, i + 1)}>
              ↓
            </button>
            <button type="button" className="pli-tool" aria-label={`Remove choice ${i + 1}`} onClick={() => set(options.filter((_, j) => j !== i))}>
              ×
            </button>
          </li>
        ))}
      </ol>
      {error && (
        <span className="pli-pdf-field-error" role="alert">
          {error}
        </span>
      )}
      <button type="button" className="pli-button" onClick={() => set([...options, { value: free() }])}>
        Add choice
      </button>
    </fieldset>
  );
}

const clean = (o: { value: string; label?: string }): { value: string; label?: string } => (o.label === undefined || o.label === "" ? { value: o.value } : o);

// ---- the panel -------------------------------------------------------------------------------------------------

function Panel({ c, field, widget }: { c: FormController; field: FormField; widget: Widget }) {
  const kind = kindOf(field);
  const flags = field.flags ?? {};
  const ap = field.appearance ?? {};
  const update: Update = (patch, burst) => c.patch(field.id, patch, burst);
  const flag = (patch: NonNullable<Parameters<Update>[0]["flags"]>) => update({ flags: patch });
  const isTextual = field.type === "text" || field.type === "dropdown" || field.type === "list" || field.type === "button";
  const isMark = field.type === "checkbox" || field.type === "radio";
  const choiceValues = (field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }));

  const setOptions = (options: { value: string; label?: string }[]) => {
    // A value that is no longer a choice is taken out of the field too (unless the drop-down takes any text).
    const keep = (v: string) => options.some((o) => o.value === v);
    const patch: Parameters<Update>[0] = { options };
    if (field.type === "dropdown" && !flags.editable && typeof field.value === "string" && field.value !== "" && !keep(field.value)) patch.value = "";
    if (field.type === "list" && Array.isArray(field.value) && field.value.some((v) => !keep(v))) patch.value = field.value.filter(keep);
    if (typeof field.defaultValue === "string" && field.defaultValue !== "" && field.type === "dropdown" && !keep(field.defaultValue)) patch.defaultValue = "";
    return update(patch, "options");
  };

  const defaultControl = (() => {
    const set = (v: FormField["value"]) => update({ defaultValue: v, value: v }, "default");
    const current = field.defaultValue !== undefined ? field.defaultValue : field.value;
    switch (field.type) {
      case "text":
        return <TextProp label="Default value" value={typeof current === "string" ? current : ""} commit={(t) => set(t)} maxLength={flags.maxLength} />;
      case "checkbox":
        return <Check label="Checked by default" checked={current === true} onChange={(on) => void set(on)} />;
      case "radio":
        return (
          <Select
            label="Selected by default"
            value={typeof current === "string" ? current : ""}
            options={[{ value: "", label: "None" }, ...field.widgets.filter((w) => w.on).map((w) => ({ value: w.on!, label: w.on! }))]}
            onChange={(v) => void set(v === "" ? null : v)}
          />
        );
      case "dropdown":
        return <Select label="Default choice" value={typeof current === "string" ? current : ""} options={[{ value: "", label: "None" }, ...choiceValues]} onChange={(v) => void set(v)} />;
      case "list":
        return (
          <Select
            label="Default choice"
            value={Array.isArray(current) ? (current[0] ?? "") : ""}
            options={[{ value: "", label: "None" }, ...choiceValues]}
            onChange={(v) => void set(v === "" ? [] : [v])}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="pli-pdf-props pli-form-props" role="group" aria-label={`${field.name} properties`}>
      <h2 className="pli-pdf-props-title">{typeLabel(field)}</h2>

      <TextProp label="Name" value={field.name} commit={(name) => update({ name }, "name")} />
      <TextProp label="Tooltip" value={field.tooltip ?? ""} commit={(t) => update({ tooltip: t === "" ? null : t }, "tooltip")} />
      <div className="pli-pdf-actions">
        <Check label="Required" checked={!!flags.required} onChange={(on) => void flag({ required: on || undefined })} />
        <Check label="Read only" checked={!!flags.readOnly} onChange={(on) => void flag({ readOnly: on || undefined })} />
      </div>

      <fieldset className="pli-pdf-position">
        <legend>Position{field.widgets.length > 1 ? ` of ${widget.on ?? "button"}` : ""}</legend>
        <div className="pli-pdf-position-grid">
          <NumberProp label="X" value={widget.rect.x} commit={(x) => c.setRect(widget.id, { ...widget.rect, x }, "x")} />
          <NumberProp label="Y" value={widget.rect.y} commit={(y) => c.setRect(widget.id, { ...widget.rect, y }, "y")} />
          <NumberProp label="Width" value={widget.rect.w} min={1} commit={(w) => c.setRect(widget.id, { ...widget.rect, w }, "w")} />
          <NumberProp label="Height" value={widget.rect.h} min={1} commit={(h) => c.setRect(widget.id, { ...widget.rect, h }, "h")} />
        </div>
      </fieldset>

      {field.type === "text" && (
        <fieldset className="pli-pdf-options">
          <legend>Text</legend>
          <Check label="Multi-line" checked={!!flags.multiline} disabled={!!flags.comb || !!flags.password} onChange={(on) => void flag({ multiline: on || undefined })} />
          <Check label="Password" checked={!!flags.password} disabled={!!flags.multiline} onChange={(on) => void flag({ password: on || undefined })} />
          <Check label="Comb (one character per cell)" checked={!!flags.comb} disabled={!!flags.multiline || !!flags.password} onChange={(on) => void update({ flags: { comb: on || undefined, ...(on && !flags.maxLength ? { maxLength: 10 } : {}) } })} />
          <NumberProp label={flags.comb ? "Characters (cells)" : "Maximum length"} value={flags.maxLength ?? 0} min={0} commit={(n) => update({ flags: { maxLength: n > 0 ? Math.floor(n) : undefined, ...(n <= 0 ? { comb: undefined } : {}) } }, "maxlength")} />
        </fieldset>
      )}
      {field.type === "dropdown" && <Check label="Let people type their own value" checked={!!flags.editable} onChange={(on) => void flag({ editable: on || undefined })} />}
      {field.type === "list" && <Check label="Allow several choices" checked={!!flags.multiSelect} onChange={(on) => void flag({ multiSelect: on || undefined })} />}
      {(field.type === "dropdown" || field.type === "list") && <Choices field={field} update={setOptions} />}

      {field.type === "radio" && (
        <fieldset className="pli-pdf-options">
          <legend>Buttons</legend>
          {field.widgets.map((w, i) => (
            <RadioValue key={w.id} c={c} field={field} widget={w} index={i} selected={w.id === widget.id} />
          ))}
          <Check label="A chosen button can be turned off" checked={!flags.noToggleToOff} onChange={(on) => void flag({ noToggleToOff: on ? undefined : true })} />
        </fieldset>
      )}
      {field.type === "checkbox" && <RadioValue c={c} field={field} widget={widget} index={0} selected label="Value when checked" />}
      {isMark && (
        <Select label="Mark" value={ap.checkStyle ?? (field.type === "radio" ? "circle" : "check")} options={CHECK_STYLES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} onChange={(v) => void update({ appearance: { checkStyle: v as never } })} />
      )}
      {field.type === "button" && <TextProp label="Caption" value={field.caption ?? ""} commit={(t) => update({ caption: t }, "caption")} />}

      {defaultControl}

      <fieldset className="pli-pdf-options">
        <legend>Look</legend>
        {isTextual && (
          <>
            <Select label="Font" value={ap.font ?? "Helvetica"} options={[...new Set([...(ap.font ? [ap.font] : []), ...FIELD_FONTS])].map((f) => ({ value: f, label: f }))} onChange={(v) => void update({ appearance: { font: v } })} />
            <NumberProp label="Size (0 fits the text)" value={ap.size ?? 0} min={0} max={200} commit={(n) => update({ appearance: { size: Math.max(0, n) } }, "size")} />
            <Select label="Align" value={ap.align ?? "left"} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} onChange={(v) => void update({ appearance: { align: v as never } })} />
          </>
        )}
        <Colour label={isMark ? "Mark colour" : "Text colour"} value={ap.color ?? "#000000"} onChange={(v) => void update({ appearance: { color: v } }, "color")} />
        <Colour label="Border" value={ap.border} none="No border" onChange={(v) => void update({ appearance: { border: v } }, "border")} />
        {ap.border && <NumberProp label="Border width" value={ap.borderWidth ?? 1} min={0} max={20} step={0.5} commit={(n) => update({ appearance: { borderWidth: Math.max(0, n) } }, "borderwidth")} />}
        <Colour label="Fill" value={ap.fill} none="No fill" onChange={(v) => void update({ appearance: { fill: v } }, "fill")} />
      </fieldset>

      <div className="pli-pdf-actions">
        <button type="button" className="pli-button" onClick={() => c.duplicate()}>
          {I.duplicate} Duplicate
        </button>
        <button type="button" className="pli-button pli-button-danger" onClick={() => c.removeField(field.id)}>
          {I.trash} Delete field
        </button>
      </div>
    </div>
  );
}

/** The value a radio button (or a check box) stands for when it is on. */
function RadioValue({ c, field, widget, index, selected, label }: { c: FormController; field: FormField; widget: Widget; index: number; selected: boolean; label?: string }) {
  const text = label ?? `Button ${index + 1} value`;
  return (
    <div className={selected ? "pli-pdf-radio-row pli-pdf-radio-selected" : "pli-pdf-radio-row"}>
      <TextProp label={text} value={widget.on ?? ""} commit={(v) => c.setOn(field.id, widget.id, v)} />
      {field.widgets.length > 1 && !selected && (
        <button type="button" className="pli-button" onClick={() => c.selectWidget(widget.id)}>
          Select button
        </button>
      )}
    </div>
  );
}

/** Nothing selected: add a field, or pick one from the list. */
function Overview({ c }: { c: FormController }) {
  const pageId = c.view?.pageId;
  const fields = c.fields;
  return (
    <div className="pli-pdf-props pli-form-props" role="group" aria-label="Fields">
      <h2 className="pli-pdf-props-title">Prepare form</h2>
      <p className="pli-pdf-meta">Choose a field type in the bar and draw it on the page, or add one in the middle of the page here. Select a field to change it. Alt skips the 4 point grid.</p>
      <div className="pli-pdf-actions" role="group" aria-label="Add a field in the middle of the page">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className="pli-button" disabled={!pageId} onClick={() => c.addAtCenter(k.kind)}>
            {I[k.kind]} {k.label}
          </button>
        ))}
      </div>
      <h3 className="pli-pdf-pagehead">Fields ({fields.length})</h3>
      {fields.length === 0 ? (
        <p className="pli-pdf-meta">There are no fields yet.</p>
      ) : (
        <ul className="pli-pdf-annotrows">
          {c.order()
            .filter((o, i, all) => all.findIndex((x) => x.field.id === o.field.id) === i)
            .map((o) => (
              <li key={o.field.id}>
                <button type="button" className="pli-pdf-annotrow" onClick={() => c.selectField(o.field.id)}>
                  <span className="pli-pdf-annottext">
                    <span className="pli-pdf-annottype">{o.field.name}</span>
                    <span className="pli-pdf-annotmeta">
                      {typeLabel(o.field)}, page {o.page + 1}
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** Several fields selected: arrange them. */
function Several({ c }: { c: FormController }) {
  const count = c.arrangeable().length;
  const total = c.selectedIds.length;
  return (
    <div className="pli-pdf-props pli-form-props" role="group" aria-label="Selected fields">
      <h2 className="pli-pdf-props-title">{total} fields</h2>
      <Arrange count={count} onAlign={(how) => c.align(how)} onDistribute={(how) => c.distribute(how)} />
      <p className="pli-pdf-meta">Shift or Ctrl/Cmd click adds a field to the selection or takes it out. Align and distribute work on the fields that are on the same page as the first one{count < total ? ` (${count} of ${total} here)` : ""}. Click one field to change its properties.</p>
    </div>
  );
}

export function FieldProperties({ c }: { c: FormController }) {
  useFormController(c);
  const s = c.selection;
  if (!s) return <Overview c={c} />;
  if (c.also.length > 0) return <Several c={c} />;
  return <Panel key={s.widget.id} c={c} field={s.field} widget={s.widget} />;
}
