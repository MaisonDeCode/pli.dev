import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { signatureOf, type FormField, type Widget } from "@pli.dev/pdf";
import type { FormController } from "./formController";
import { MARKS, fieldLabel, fontCss, fontSizeOf, optionLabel } from "./formsGeometry";

/**
 * The HTML controls that draw and fill the form fields. Each is placed by `FieldWidget` in page space (points), so it is
 * scaled and turned with the page, and its look comes from the field's appearance: font, size, colour, border, fill,
 * alignment. Values go to the session through the controller: typing edits the field at once (one undo step per burst),
 * a choice (check box, radio, drop-down, list) is a step of its own.
 */

export interface ControlProps {
  c: FormController;
  field: FormField;
  widget: Widget;
  /** Accessible name. */
  label: string;
  /** The id of the element that describes the field (its problem), or undefined. */
  describedBy?: string;
  invalid: boolean;
  disabled: boolean;
  /** Design mode: only a picture of the control (not focusable, not editable). */
  preview?: boolean;
  /** Radio: the widget is the group's tab stop. */
  stop?: boolean;
  /** Reports what the engine refused (a value too long). */
  onError: (message: string | null) => void;
}

export interface Look {
  style: CSSProperties;
  size: number;
  border: number;
}

/** The appearance of a field as CSS, for a control that fills its widget. */
export function lookOf(field: FormField, widget: Widget): Look {
  const ap = field.appearance ?? {};
  const border = ap.border ? (ap.borderWidth ?? 1) : 0;
  const font = fontCss(ap.font);
  const size = fontSizeOf(field, widget);
  return {
    size,
    border,
    style: {
      boxSizing: "border-box",
      width: "100%",
      height: "100%",
      margin: 0,
      border: border ? `${border}px solid ${ap.border}` : "none",
      backgroundColor: ap.fill ?? "transparent",
      color: ap.color ?? "#000000",
      fontFamily: font.family,
      fontWeight: font.weight,
      fontStyle: font.style,
      fontSize: size,
      textAlign: ap.align ?? "left",
      padding: `${Math.max(1, border)}px ${Math.max(2, border + 1)}px`,
    },
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;
const textOf = (f: FormField): string => (typeof f.value === "string" ? f.value : "");
const chosenOf = (f: FormField): string[] => (Array.isArray(f.value) ? f.value : typeof f.value === "string" && f.value !== "" ? [f.value] : []);

// ---- text ------------------------------------------------------------------------------------------------------

function TextControl(p: ControlProps) {
  const { c, field, widget } = p;
  const flags = field.flags ?? {};
  const multiline = !!flags.multiline;
  const max = flags.maxLength && flags.maxLength > 0 ? flags.maxLength : undefined;
  const comb = !!flags.comb && !!max && !multiline && !flags.password;
  const look = lookOf(field, widget);
  const start = useRef(textOf(field));
  // While an input method is composing, the text is the control's own; it goes to the document when the composition ends.
  const [composing, setComposing] = useState<string | null>(null);
  const value = composing ?? textOf(field);

  const commit = (text: string) => {
    const error = c.edit(field.id, text, true);
    p.onError(error);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (textOf(field) !== start.current || c.session.canUndo) {
        c.revert(field.id, start.current);
        p.onError(null);
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === "Enter" && !multiline && !e.nativeEvent.isComposing) {
      if (c.tab(widget.id, 1)) e.preventDefault();
    }
  };
  const common = {
    "data-control": "",
    "aria-label": p.label,
    "aria-required": field.flags?.required || undefined,
    "aria-invalid": p.invalid || undefined,
    "aria-describedby": p.describedBy,
    disabled: p.disabled,
    tabIndex: p.preview ? -1 : undefined,
    value,
    maxLength: max,
    spellCheck: false,
    autoComplete: flags.password ? "new-password" : "off",
    onFocus: () => {
      start.current = textOf(field);
    },
    onChange: (e: { target: { value: string }; nativeEvent: Event }) => {
      const v = e.target.value;
      if ((e.nativeEvent as InputEvent).isComposing) setComposing(v);
      else commit(v);
    },
    onCompositionEnd: (e: { currentTarget: { value: string } }) => {
      setComposing(null);
      commit(e.currentTarget.value);
    },
    onKeyDown,
  };
  if (multiline) {
    return <textarea {...common} className="pli-form-control pli-form-text" style={{ ...look.style, resize: "none", lineHeight: 1.15, padding: `${Math.max(1, look.border) + 1}px ${Math.max(2, look.border + 1)}px`, overflow: "auto" }} />;
  }
  if (comb) {
    const cell = widget.rect.w / max!;
    // A monospace font gives each character the same advance (`1ch`), so letter spacing puts one character in each cell.
    const gap = `calc(${cell}px - 1ch)`;
    const line = look.border ? (field.appearance?.border ?? "#000000") : "transparent";
    const lw = Math.min(cell / 2, Math.max(0.5, look.border));
    return (
      <input
        {...common}
        type="text"
        className="pli-form-control pli-form-text pli-form-comb"
        style={{
          ...look.style,
          border: "none",
          padding: 0,
          paddingLeft: `calc((${cell}px - 1ch) / 2)`,
          fontFamily: `"Courier New", Courier, monospace`,
          letterSpacing: gap,
          textAlign: "left",
          backgroundImage: `repeating-linear-gradient(to right, transparent 0px, transparent ${round(cell - lw)}px, ${line} ${round(cell - lw)}px, ${line} ${round(cell)}px)`,
        }}
      />
    );
  }
  return <input {...common} type={flags.password ? "password" : "text"} className="pli-form-control pli-form-text" style={look.style} />;
}

// ---- check box and radio ---------------------------------------------------------------------------------------

function Mark({ style, color }: { style: keyof typeof MARKS; color: string }) {
  const m = MARKS[style] ?? MARKS.check;
  return (
    <svg className="pli-form-mark" viewBox="0 0 10 10" aria-hidden="true" focusable="false" fill={m.fill ? color : "none"} stroke={m.fill ? "none" : color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {m.shape === "circle" && <circle cx="5" cy="5" r="2.9" />}
      {m.shape === "rect" && <rect x="2.2" y="2.2" width="5.6" height="5.6" />}
      {m.d && <path d={m.d} />}
    </svg>
  );
}

function ToggleControl(p: ControlProps) {
  const { c, field, widget } = p;
  const radio = field.type === "radio";
  const ap = field.appearance ?? {};
  const border = ap.border ? (ap.borderWidth ?? 1) : 0;
  const on = widget.on ?? "Yes";
  const checked = radio ? field.value === on : field.value === true;
  const color = ap.color ?? "#000000";
  const style = ap.checkStyle ?? (radio ? "circle" : "check");
  const noToggle = !!field.flags?.noToggleToOff;

  const move = (dir: 1 | -1) => {
    const list = field.widgets;
    const at = list.findIndex((w) => w.id === widget.id);
    const next = list[(at + dir + list.length) % list.length];
    if (!next || next.id === widget.id) return;
    p.onError(c.edit(field.id, next.on ?? null));
    c.focusWidget(next.id);
  };

  return (
    <span className="pli-form-box" data-radio={radio ? "" : undefined} data-checked={checked ? "" : undefined} style={{ border: border ? `${border}px solid ${ap.border}` : "none", backgroundColor: ap.fill ?? "transparent", borderRadius: radio ? "50%" : 0 }}>
      <input
        data-control=""
        className="pli-form-hit"
        type={radio ? "radio" : "checkbox"}
        name={radio ? field.id : undefined}
        value={radio ? on : undefined}
        checked={checked}
        disabled={p.disabled}
        tabIndex={p.preview ? -1 : radio ? (p.stop ? 0 : -1) : undefined}
        aria-label={p.label}
        aria-required={!radio ? field.flags?.required || undefined : undefined}
        aria-invalid={p.invalid || undefined}
        aria-describedby={p.describedBy}
        onChange={(e) => p.onError(c.edit(field.id, radio ? on : e.target.checked))}
        onClick={() => {
          if (radio && checked && !noToggle) p.onError(c.edit(field.id, null));
        }}
        onKeyDown={(e) => {
          if (!radio) return;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(1));
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(-1));
        }}
      />
      {checked && <Mark style={style} color={color} />}
    </span>
  );
}

// ---- drop-down and list ----------------------------------------------------------------------------------------

function DropdownControl(p: ControlProps) {
  const { c, field, widget } = p;
  const look = lookOf(field, widget);
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const value = textOf(field);
  const options = field.options ?? [];
  const common = {
    "data-control": "",
    "aria-label": p.label,
    "aria-required": field.flags?.required || undefined,
    "aria-invalid": p.invalid || undefined,
    "aria-describedby": p.describedBy,
    disabled: p.disabled,
    tabIndex: p.preview ? -1 : undefined,
    className: "pli-form-control pli-form-dropdown",
    style: { ...look.style, padding: `0 ${Math.max(2, look.border + 1)}px` },
  };
  if (field.flags?.editable) {
    return (
      <>
        <input
          {...common}
          type="text"
          role="combobox"
          aria-expanded={false}
          list={listId}
          autoComplete="off"
          spellCheck={false}
          value={draft ?? optionLabel(field, value)}
          onChange={(e) => {
            setDraft(e.target.value);
            p.onError(c.edit(field.id, e.target.value, true));
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && c.tab(widget.id, 1)) e.preventDefault();
          }}
        />
        <datalist id={listId}>
          {options.map((o, i) => (
            <option key={i} value={o.label ?? o.value} />
          ))}
        </datalist>
      </>
    );
  }
  const known = value === "" || options.some((o) => o.value === value);
  return (
    <select {...common} value={value} onChange={(e) => p.onError(c.edit(field.id, e.target.value))}>
      {!options.some((o) => o.value === "") && <option value="" />}
      {options.map((o, i) => (
        <option key={i} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
      {!known && <option value={value}>{value}</option>}
    </select>
  );
}

function ListControl(p: ControlProps) {
  const { c, field, widget } = p;
  const look = lookOf(field, widget);
  const multiple = !!field.flags?.multiSelect;
  const options = field.options ?? [];
  const chosen = chosenOf(field);
  const rows = Math.max(2, Math.floor(widget.rect.h / (look.size * 1.25)));
  const common = {
    "data-control": "",
    "aria-label": p.label,
    "aria-required": field.flags?.required || undefined,
    "aria-invalid": p.invalid || undefined,
    "aria-describedby": p.describedBy,
    disabled: p.disabled,
    tabIndex: p.preview ? -1 : undefined,
    size: rows,
    className: "pli-form-control pli-form-list",
    style: { ...look.style, padding: 0 },
  };
  const unknown = chosen.filter((v) => !options.some((o) => o.value === v));
  const pick = (list: string[]) => p.onError(c.edit(field.id, list));
  const body = [
    ...options.map((o, i) => (
      <option key={i} value={o.value}>
        {o.label ?? o.value}
      </option>
    )),
    ...unknown.map((v) => (
      <option key={`x:${v}`} value={v}>
        {v}
      </option>
    )),
  ];
  return multiple ? (
    <select {...common} multiple value={chosen} onChange={(e) => pick([...e.target.selectedOptions].map((o) => o.value))}>
      {body}
    </select>
  ) : (
    <select {...common} value={chosen[0] ?? ""} onChange={(e) => pick(e.target.value === "" ? [] : [e.target.value])}>
      {body}
    </select>
  );
}

// ---- button and signature --------------------------------------------------------------------------------------

function ButtonControl(p: ControlProps) {
  const look = lookOf(p.field, p.widget);
  return (
    <button type="button" data-control="" className="pli-form-control pli-form-button" aria-label={p.label} disabled={p.disabled} tabIndex={p.preview ? -1 : undefined} title={p.field.tooltip} style={{ ...look.style, textAlign: "center", padding: 0 }}>
      {p.field.caption ?? ""}
    </button>
  );
}

function SignatureControl(p: ControlProps) {
  const { c, field, widget } = p;
  const look = lookOf(field, widget);
  const size = Math.max(5, Math.min(look.size || 11, widget.rect.h * 0.45, widget.rect.w / 9));
  // Signed with a signature put in the field (`session.forms.sign`): the signature, an annotation, is all there is to see in the box: no
  // caption, no wash, no border. The box lets the pointer through, so the signature under it can be picked up, moved and deleted.
  if (!field.signed && signatureOf(c.session.doc, field)) {
    return <div className="pli-form-covered" role="img" aria-label={`${p.label}: signed`} aria-describedby={p.describedBy} style={{ width: "100%", height: "100%", pointerEvents: "none" }} />;
  }
  if (field.signed) {
    return (
      <div className="pli-form-signed" role="img" aria-label={`${p.label}: signed`} aria-describedby={p.describedBy} style={{ ...look.style, fontSize: size }}>
        <span className="pli-form-badge">Signed</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-control=""
      className="pli-form-control pli-form-sign"
      aria-label={`${p.label}: sign here`}
      aria-required={field.flags?.required || undefined}
      aria-invalid={p.invalid || undefined}
      aria-describedby={p.describedBy}
      disabled={p.disabled}
      tabIndex={p.preview ? -1 : undefined}
      style={{ ...look.style, border: undefined, fontSize: size, textAlign: "center", padding: 0 }}
      onClick={() => c.sign(field, widget)}
    >
      Sign here
    </button>
  );
}

/** The control for a field's widget. */
export function FieldControl(p: ControlProps): ReactNode {
  switch (p.field.type) {
    case "text":
      return <TextControl {...p} />;
    case "checkbox":
    case "radio":
      return <ToggleControl {...p} />;
    case "dropdown":
      return <DropdownControl {...p} />;
    case "list":
      return <ListControl {...p} />;
    case "button":
      return <ButtonControl {...p} />;
    case "signature":
      return <SignatureControl {...p} />;
    default:
      return null;
  }
}

/** The accessible name of a widget: the field's tooltip or name, and for a radio button which button. */
export function widgetLabel(field: FormField, widget: Widget): string {
  const base = fieldLabel(field);
  return field.type === "radio" && widget.on ? `${base}: ${widget.on}` : base;
}
