import type { ReactNode } from "react";
import { axisDefaults, isChartex, isValueAxis, type AxisKey, type ChartAxis, type ChartFont, type ChartTickMark, type ChartTitleRun, type ChartType, type ErrorBars } from "@pli.dev/sheets";

/*
 * The parts of the chart editor for axes, error bars and fonts. They hold what is typed as text and turn it into the chart's
 * settings (or a message saying what is wrong) when the editor is saved.
 */

const num = (s: string): number | undefined => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));
const isNum = (s: string) => s.trim() === "" || Number.isFinite(Number(s));

// ---------------------------------------------------------------- axes

export interface AxisFormState {
  min: string;
  max: string;
  major: string;
  minor: string;
  /** The base of a logarithmic scale, or empty for a plain one. */
  log: string;
  reverse: boolean;
  crosses: "auto" | "min" | "max" | "at";
  crossesAt: string;
  gridMajor: boolean;
  gridMinor: boolean;
  tickMajor: ChartTickMark;
  tickMinor: ChartTickMark;
  labels: "nextTo" | "low" | "high" | "none";
  hidden: boolean;
  labelEvery: string;
  tickEvery: string;
  format: string;
  /** The font of the labels, and of the title; the title in pieces. */
  font: FontForm;
  titleFont: FontForm;
  runs: RunForm[];
}

/** One piece of a title with a look of its own, as typed. */
export interface RunForm {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
}

export const runFormsOf = (runs: ChartTitleRun[] | undefined): RunForm[] => (runs ?? []).map((r) => ({ text: r.text, bold: r.bold ?? false, italic: !!r.italic, underline: !!r.underline, color: r.color ?? "" }));
export const runsFromForms = (forms: RunForm[]): ChartTitleRun[] => forms.filter((r) => r.text !== "").map((r) => ({ text: r.text, bold: r.bold, ...(r.italic ? { italic: true } : {}), ...(r.underline ? { underline: true } : {}), ...(r.color ? { color: r.color } : {}) }));

export function axisFormOf(type: ChartType, key: AxisKey, a?: ChartAxis): AxisFormState {
  const d = axisDefaults(type, key);
  const c = a?.crosses;
  return {
    min: a?.min !== undefined ? String(a.min) : "",
    max: a?.max !== undefined ? String(a.max) : "",
    major: a?.majorUnit !== undefined ? String(a.majorUnit) : "",
    minor: a?.minorUnit !== undefined ? String(a.minorUnit) : "",
    log: a?.log !== undefined ? String(a.log) : "",
    reverse: a?.reverse ?? false,
    crosses: c === undefined ? "auto" : typeof c === "number" ? "at" : c,
    crossesAt: typeof c === "number" ? String(c) : "",
    gridMajor: a?.majorGridlines ?? d.majorGridlines,
    gridMinor: a?.minorGridlines ?? d.minorGridlines,
    tickMajor: a?.majorTick ?? d.majorTick,
    tickMinor: a?.minorTick ?? d.minorTick,
    labels: a?.labels ?? d.labels,
    hidden: a?.hidden ?? d.hidden,
    labelEvery: a?.labelEvery !== undefined ? String(a.labelEvery) : "",
    tickEvery: a?.tickEvery !== undefined ? String(a.tickEvery) : "",
    format: a?.format ?? "",
    font: fontFormOf(a?.font),
    titleFont: fontFormOf(a?.titleFont),
    runs: runFormsOf(a?.titleRuns),
  };
}

/** The settings typed for an axis, or a message when a box holds something that isn't right. */
export function axisFromForm(type: ChartType, key: AxisKey, f: AxisFormState, name: string): ChartAxis | string {
  const value = isValueAxis(type, key);
  const out: ChartAxis = {};
  for (const [field, label] of [["min", "minimum"], ["max", "maximum"], ["major", "major unit"], ["minor", "minor unit"], ["log", "log base"], ["labelEvery", "label interval"], ["tickEvery", "tick interval"]] as const) {
    if (!isNum(f[field])) return `${name}: the ${label} must be a number`;
  }
  if (value) {
    if (num(f.min) !== undefined) out.min = num(f.min)!;
    if (num(f.max) !== undefined) out.max = num(f.max)!;
    if (num(f.major) !== undefined) out.majorUnit = num(f.major)!;
    if (num(f.minor) !== undefined) out.minorUnit = num(f.minor)!;
    if (num(f.log) !== undefined) out.log = num(f.log)!;
    if (f.format.trim()) out.format = f.format.trim();
  } else {
    if (num(f.labelEvery) !== undefined) out.labelEvery = num(f.labelEvery)!;
    if (num(f.tickEvery) !== undefined) out.tickEvery = num(f.tickEvery)!;
  }
  if (f.reverse) out.reverse = true;
  if (f.crosses === "min" || f.crosses === "max") out.crosses = f.crosses;
  if (f.crosses === "at") {
    if (num(f.crossesAt) === undefined) return `${name}: say where the other axis crosses`;
    out.crosses = num(f.crossesAt)!;
  }
  // What the default says isn't kept.
  const d = axisDefaults(type, key);
  if (f.gridMajor !== d.majorGridlines) out.majorGridlines = f.gridMajor;
  if (f.gridMinor !== d.minorGridlines) out.minorGridlines = f.gridMinor;
  if (f.tickMajor !== d.majorTick) out.majorTick = f.tickMajor;
  if (f.tickMinor !== d.minorTick) out.minorTick = f.tickMinor;
  if (f.labels !== d.labels) out.labels = f.labels;
  if (f.hidden) out.hidden = true;
  const font = fontFromForm(f.font, `${name}: the label font`);
  if (typeof font === "string") return font;
  if (font) out.font = font;
  const titleFont = fontFromForm(f.titleFont, `${name}: the title font`);
  if (typeof titleFont === "string") return titleFont;
  if (titleFont) out.titleFont = titleFont;
  const runs = runsFromForms(f.runs);
  if (runs.length) out.titleRuns = runs;
  return out;
}

const TICKS: { value: ChartTickMark; label: string }[] = [
  { value: "none", label: "None" },
  { value: "out", label: "Outside" },
  { value: "in", label: "Inside" },
  { value: "cross", label: "Across" },
];

export interface AxisFieldsProps {
  type: ChartType;
  axis: AxisKey;
  title: string;
  form: AxisFormState;
  /** The axis' title as it stands, to start its pieces from. */
  titleText?: string;
  onChange(patch: Partial<AxisFormState>): void;
}

/** The fields of one axis: its scale, where the other axis crosses it, gridlines, tick marks and labels. */
export function AxisFields({ type, axis, title, form, titleText = "", onChange }: AxisFieldsProps): ReactNode {
  const value = isValueAxis(type, axis);
  const ex = isChartex(type);
  const radar = type === "radar";
  const surface = type === "surface";
  const label = (text: string, field: ReactNode) => (
    <label>
      {text}
      {field}
    </label>
  );
  const text = (field: "min" | "max" | "major" | "minor" | "log" | "crossesAt" | "labelEvery" | "tickEvery" | "format", ariaLabel: string, width = 72) => (
    <input type="text" aria-label={`${title}: ${ariaLabel}`} value={form[field]} placeholder={field === "log" ? "10" : "Auto"} onChange={(e) => onChange({ [field]: e.target.value })} style={{ width }} />
  );
  return (
    <fieldset className="pli-chartform-axis">
      <legend>{title}</legend>
      {value && (
        <div className="pli-chartform-pair">
          {label("Minimum", text("min", "Minimum"))}
          {label("Maximum", text("max", "Maximum"))}
          {label("Major unit", text("major", "Major unit"))}
          {label("Minor unit", text("minor", "Minor unit"))}
        </div>
      )}
      {!value && !radar && (
        <div className="pli-chartform-pair">
          {label("Label every", text("labelEvery", "Label every", 52))}
          {label("Tick every", text("tickEvery", "Tick every", 52))}
        </div>
      )}
      <div className="pli-dropdown-options">
        {value && !ex && !radar && !surface && (
          <label>
            <input type="checkbox" aria-label={`${title}: Logarithmic scale`} checked={form.log !== ""} onChange={(e) => onChange({ log: e.target.checked ? "10" : "" })} /> Logarithmic scale
            {form.log !== "" && <input type="text" aria-label={`${title}: Log base`} value={form.log} onChange={(e) => onChange({ log: e.target.value })} style={{ width: 48, marginLeft: 6 }} />}
          </label>
        )}
        {!ex && !radar && !surface && (
          <label>
            <input type="checkbox" aria-label={`${title}: Reverse order`} checked={form.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} /> {value ? "Values in reverse order" : "Categories in reverse order"}
          </label>
        )}
        <label>
          <input type="checkbox" aria-label={`${title}: Major gridlines`} checked={form.gridMajor} onChange={(e) => onChange({ gridMajor: e.target.checked })} /> Major gridlines
        </label>
        <label>
          <input type="checkbox" aria-label={`${title}: Minor gridlines`} checked={form.gridMinor} onChange={(e) => onChange({ gridMinor: e.target.checked })} /> Minor gridlines
        </label>
        <label>
          <input type="checkbox" aria-label={`${title}: Hide the axis`} checked={form.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} /> Hide the axis
        </label>
      </div>
      <div className="pli-chartform-pair">
        {label(
          "Major ticks",
          <select aria-label={`${title}: Major tick marks`} value={form.tickMajor} onChange={(e) => onChange({ tickMajor: e.target.value as ChartTickMark })}>
            {TICKS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>,
        )}
        {label(
          "Minor ticks",
          <select aria-label={`${title}: Minor tick marks`} value={form.tickMinor} onChange={(e) => onChange({ tickMinor: e.target.value as ChartTickMark })}>
            {TICKS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>,
        )}
        {label(
          "Labels",
          <select aria-label={`${title}: Label position`} value={form.labels} onChange={(e) => onChange({ labels: e.target.value as AxisFormState["labels"] })}>
            <option value="nextTo">Next to the axis</option>
            {!ex && <option value="low">Low</option>}
            {!ex && <option value="high">High</option>}
            <option value="none">None</option>
          </select>,
        )}
      </div>
      {!ex && !radar && !surface && (axis === "x" || axis === "y") && (
        <div className="pli-chartform-pair">
          {label(
            value ? "The other axis crosses at" : "The other axis crosses",
            <select aria-label={`${title}: Where the other axis crosses`} value={form.crosses} onChange={(e) => onChange({ crosses: e.target.value as AxisFormState["crosses"] })}>
              <option value="auto">Automatic</option>
              <option value="min">{value ? "The minimum" : "The first category"}</option>
              <option value="max">{value ? "The maximum" : "The last category"}</option>
              <option value="at">{value ? "This value" : "This category number"}</option>
            </select>,
          )}
          {form.crosses === "at" && label("Number", text("crossesAt", "Crossing value", 60))}
        </div>
      )}
      {value && label("Number format", text("format", "Number format", 120))}
      <FontFields title={`${title} labels`} form={form.font} onChange={(p) => onChange({ font: { ...form.font, ...p } })} />
      <FontFields title={`${title} title`} form={form.titleFont} onChange={(p) => onChange({ titleFont: { ...form.titleFont, ...p } })} />
      <RunsFields title={`${title} title in pieces`} runs={form.runs} start={titleText} onChange={(runs) => onChange({ runs })} />
    </fieldset>
  );
}

// ---------------------------------------------------------------- error bars

export interface ErrorBarForm {
  on: boolean;
  kind: ErrorBars["kind"];
  value: string;
  direction: "both" | "plus" | "minus";
  endCap: boolean;
  plus: string;
  minus: string;
}

export const blankErrorBars = (): ErrorBarForm => ({ on: false, kind: "fixed", value: "", direction: "both", endCap: true, plus: "", minus: "" });

const listText = (v: string | number[] | undefined, shown: (ref: string) => string): string => (v === undefined ? "" : typeof v === "string" ? shown(v) : v.join(", "));

export function errorBarFormOf(e: ErrorBars | undefined, shown: (ref: string) => string): ErrorBarForm {
  if (!e) return blankErrorBars();
  return { on: true, kind: e.kind, value: e.value !== undefined ? String(e.value) : "", direction: e.direction ?? "both", endCap: e.endCap !== false, plus: listText(e.plus, shown), minus: listText(e.minus, shown) };
}

/** What typed into a custom amount: cells (`C2:C9`), or numbers (`1, 2, 3`). Null when it is neither. */
function amounts(text: string, read: (text: string) => string | null): string | number[] | null | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const parts = t.split(/[,;\s]+/).filter(Boolean);
  if (parts.every((p) => Number.isFinite(Number(p)))) return parts.map(Number);
  return read(t);
}

export function errorBarsFromForm(f: ErrorBarForm, what: string, read: (text: string) => string | null): ErrorBars | null | string {
  if (!f.on) return null;
  const out: ErrorBars = { kind: f.kind };
  if (f.kind === "fixed" || f.kind === "percent" || f.kind === "stdDev") {
    if (!isNum(f.value)) return `${what}: the amount must be a number`;
    if (num(f.value) !== undefined) out.value = num(f.value)!;
  }
  if (f.kind === "custom") {
    for (const side of ["plus", "minus"] as const) {
      const v = amounts(f[side], read);
      if (v === null) return `${what}: the ${side} amounts must be cells such as C2:C9, or numbers`;
      if (v !== undefined) out[side] = v;
    }
    if (out.plus === undefined && out.minus === undefined) return `${what}: give the amounts for the custom bars`;
  }
  if (f.direction !== "both") out.direction = f.direction;
  if (!f.endCap) out.endCap = false;
  return out;
}

export interface ErrorBarFieldsProps {
  title: string;
  form: ErrorBarForm;
  onChange(patch: Partial<ErrorBarForm>): void;
}

const ERR_KINDS: { value: ErrorBars["kind"]; label: string }[] = [
  { value: "fixed", label: "Fixed value" },
  { value: "percent", label: "Percentage" },
  { value: "stdDev", label: "Standard deviations" },
  { value: "stdErr", label: "Standard error" },
  { value: "custom", label: "Custom" },
];

export function ErrorBarFields({ title, form, onChange }: ErrorBarFieldsProps): ReactNode {
  return (
    <div className="pli-chartform-trend">
      <label>
        <input type="checkbox" aria-label={`${title}`} checked={form.on} onChange={(e) => onChange({ on: e.target.checked })} /> {title}
      </label>
      {form.on && (
        <>
          <select aria-label={`${title}: Kind`} value={form.kind} onChange={(e) => onChange({ kind: e.target.value as ErrorBars["kind"] })}>
            {ERR_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {(form.kind === "fixed" || form.kind === "percent" || form.kind === "stdDev") && (
            <input type="text" aria-label={`${title}: Amount`} placeholder={form.kind === "percent" ? "5" : "1"} value={form.value} onChange={(e) => onChange({ value: e.target.value })} style={{ width: 60 }} />
          )}
          {form.kind === "custom" && (
            <>
              <input type="text" aria-label={`${title}: Plus amounts`} placeholder="Plus: C2:C9" value={form.plus} onChange={(e) => onChange({ plus: e.target.value })} style={{ width: 90 }} />
              <input type="text" aria-label={`${title}: Minus amounts`} placeholder="Minus: D2:D9" value={form.minus} onChange={(e) => onChange({ minus: e.target.value })} style={{ width: 90 }} />
            </>
          )}
          <select aria-label={`${title}: Direction`} value={form.direction} onChange={(e) => onChange({ direction: e.target.value as ErrorBarForm["direction"] })}>
            <option value="both">Both</option>
            <option value="plus">Plus</option>
            <option value="minus">Minus</option>
          </select>
          <label>
            <input type="checkbox" aria-label={`${title}: End cap`} checked={form.endCap} onChange={(e) => onChange({ endCap: e.target.checked })} /> Cap
          </label>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- fonts

export interface FontForm {
  family: string;
  size: string;
  bold: boolean;
  italic: boolean;
  color: string;
}

export const fontFormOf = (f?: ChartFont, defaults: { bold?: boolean } = {}): FontForm => ({ family: f?.family ?? "", size: f?.size !== undefined ? String(f.size) : "", bold: f?.bold ?? defaults.bold ?? false, italic: !!f?.italic, color: f?.color ?? "" });

export function fontFromForm(f: FontForm, what: string, defaults: { bold?: boolean } = {}): ChartFont | undefined | string {
  if (!isNum(f.size)) return `${what}: the size must be a number`;
  const out: ChartFont = {};
  if (f.family.trim()) out.family = f.family.trim();
  if (num(f.size) !== undefined) out.size = num(f.size)!;
  if (f.bold !== (defaults.bold ?? false)) out.bold = f.bold;
  if (f.italic) out.italic = true;
  if (/^#[0-9a-fA-F]{6}$/.test(f.color)) out.color = f.color;
  return Object.keys(out).length ? out : undefined;
}

export function FontFields({ title, form, onChange }: { title: string; form: FontForm; onChange(patch: Partial<FontForm>): void }): ReactNode {
  return (
    <div className="pli-chartform-trend">
      <span>{title}</span>
      <input type="text" aria-label={`${title}: Font`} placeholder="Font" value={form.family} onChange={(e) => onChange({ family: e.target.value })} style={{ width: 110 }} />
      <input type="text" aria-label={`${title}: Size`} placeholder="Size" value={form.size} onChange={(e) => onChange({ size: e.target.value })} style={{ width: 48 }} />
      <label><input type="checkbox" aria-label={`${title}: Bold`} checked={form.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> Bold</label>
      <label><input type="checkbox" aria-label={`${title}: Italic`} checked={form.italic} onChange={(e) => onChange({ italic: e.target.checked })} /> Italic</label>
      <input type="color" aria-label={`${title}: Colour`} value={form.color || "#000000"} onChange={(e) => onChange({ color: e.target.value })} />
      {form.color && <button type="button" className="pli-button" aria-label={`${title}: Clear the colour`} onClick={() => onChange({ color: "" })}>✕</button>}
    </div>
  );
}

/** The pieces of a title: each with its own text, bold, italic, underline and colour. */
export function RunsFields({ title, runs, start, onChange }: { title: string; runs: RunForm[]; /** The text the first piece starts with when pieces are first added. */ start: string; onChange(runs: RunForm[]): void }): ReactNode {
  const set = (i: number, patch: Partial<RunForm>) => onChange(runs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset>
      <legend>{title}</legend>
      {runs.map((r, i) => (
        <div key={i} className="pli-chartform-trend">
          <input type="text" aria-label={`${title}: piece ${i + 1}`} value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
          <label><input type="checkbox" aria-label={`${title}: piece ${i + 1}: Bold`} checked={r.bold} onChange={(e) => set(i, { bold: e.target.checked })} /> Bold</label>
          <label><input type="checkbox" aria-label={`${title}: piece ${i + 1}: Italic`} checked={r.italic} onChange={(e) => set(i, { italic: e.target.checked })} /> Italic</label>
          <label><input type="checkbox" aria-label={`${title}: piece ${i + 1}: Underline`} checked={r.underline} onChange={(e) => set(i, { underline: e.target.checked })} /> Underline</label>
          <input type="color" aria-label={`${title}: piece ${i + 1}: Colour`} value={r.color || "#000000"} onChange={(e) => set(i, { color: e.target.value })} />
          <button type="button" className="pli-button" aria-label={`${title}: remove piece ${i + 1}`} onClick={() => onChange(runs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="pli-button" aria-label={`${title}: add a piece`} onClick={() => onChange(runs.length ? [...runs, { text: "", bold: false, italic: true, underline: false, color: "" }] : [{ text: start, bold: false, italic: false, underline: false, color: "" }, { text: "", bold: false, italic: true, underline: false, color: "" }])}>Add a title piece</button>
    </fieldset>
  );
}
