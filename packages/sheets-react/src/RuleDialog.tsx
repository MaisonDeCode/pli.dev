import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { CELL_OPERATORS, DATE_PERIODS, ICON_SETS, TEXT_OPERATORS, type CellRuleOperator, type CfValue, type ConditionalRule, type ConditionalStyle, type DatePeriod, type IconSetName, type RuleSpec, type TextRuleOperator } from "@pli.dev/sheets";
import { CELL_OPERATOR_LABELS, ICON_SET_LABELS, PERIOD_LABELS, STYLE_PRESETS, TEXT_OPERATOR_LABELS, describeRule, evenSteps } from "./rules";

type Kind = ConditionalRule["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "cell", label: "Cell value" },
  { kind: "text", label: "Text" },
  { kind: "formula", label: "Formula" },
  { kind: "top", label: "Top or bottom" },
  { kind: "average", label: "Above or below average" },
  { kind: "duplicates", label: "Duplicate values" },
  { kind: "uniques", label: "Unique values" },
  { kind: "blanks", label: "Blank cells" },
  { kind: "noBlanks", label: "Cells that are not blank" },
  { kind: "errors", label: "Cells with errors" },
  { kind: "noErrors", label: "Cells without errors" },
  { kind: "dates", label: "Dates" },
  { kind: "colorScale", label: "Color scale" },
  { kind: "dataBar", label: "Data bar" },
  { kind: "iconSet", label: "Icon set" },
];

const POINT_TYPES: CfValue["type"][] = ["min", "num", "percent", "percentile", "formula", "max"];
const POINT_LABELS: Record<CfValue["type"], string> = { min: "Lowest value", max: "Highest value", num: "Number", percent: "Percent", percentile: "Percentile", formula: "Formula", auto: "Automatic" };

interface PointForm {
  type: CfValue["type"];
  value: string;
  color: string;
}

const toPoint = (p: PointForm): CfValue => (p.type === "min" || p.type === "max" || p.type === "auto" ? { type: p.type } : p.type === "formula" ? { type: "formula", value: p.value } : { type: p.type, value: Number(p.value) });
const fromPoint = (p: CfValue & { color?: string }): PointForm => ({ type: p.type, value: p.value === undefined ? "" : String(p.value), color: p.color ?? "#638ec6" });

/** One point of a scale, bar or icon set: how it is found, its value, and (for a scale) its colour. */
function PointRow({ label, p, set, colored, types = POINT_TYPES }: { label: string; p: PointForm; set: (p: PointForm) => void; colored?: boolean; types?: CfValue["type"][] }) {
  const needsValue = p.type !== "min" && p.type !== "max" && p.type !== "auto";
  return (
    <div className="pli-ruleform-point">
      <span>{label}</span>
      <select aria-label={`${label} type`} value={p.type} onChange={(e) => set({ ...p, type: e.target.value as CfValue["type"] })}>
        {types.map((t) => <option key={t} value={t}>{POINT_LABELS[t]}</option>)}
      </select>
      <input type="text" aria-label={`${label} value`} value={needsValue ? p.value : ""} disabled={!needsValue} onChange={(e) => set({ ...p, value: e.target.value })} />
      {colored && <input type="color" aria-label={`${label} color`} value={p.color} onChange={(e) => set({ ...p, color: e.target.value })} />}
    </div>
  );
}

interface Form {
  kind: Kind;
  ranges: string;
  stop: boolean;
  op: CellRuleOperator;
  v1: string;
  v2: string;
  textOp: TextRuleOperator;
  text: string;
  formula: string;
  rank: string;
  percent: boolean;
  bottom: boolean;
  above: boolean;
  equal: boolean;
  stdDev: string;
  period: DatePeriod;
  fill: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  border: boolean;
  fmt: string;
  fontFamily: string;
  fontSize: string;
  stops: PointForm[];
  barMin: PointForm;
  barMax: PointForm;
  barColor: string;
  barNegative: string;
  barSolid: boolean;
  barBorder: boolean;
  barAxis: "" | "middle" | "none";
  barAxisColor: string;
  barBorderColor: string;
  barNegBorder: string;
  barRtl: boolean;
  /** The rule follows a pivot table's cells: which value (the number as text; empty for all) and the row and column field levels. */
  pivotOn: boolean;
  pivotValue: string;
  pivotRows: string;
  pivotCols: string;
  /** The items a rule for selected cells follows (field → labels); null when it follows every item. */
  pivotItems: Record<string, string[]> | null;
  barShort: string;
  barLong: string;
  set: IconSetName;
  steps: PointForm[];
  reverse: boolean;
  hideValue: boolean;
  /** Your own icon for each step, as `set:index` (empty for none); null for the set's own. */
  custom: string[] | null;
}

const BLANK: Form = {
  kind: "cell", ranges: "", stop: false, op: "greaterThan", v1: "", v2: "", textOp: "contains", text: "", formula: "", rank: "10", percent: false, bottom: false, above: true, equal: false, stdDev: "",
  period: "today", fill: "#ffc7ce", color: "#9c0006", bold: false, italic: false, underline: false, strike: false, border: false, fmt: "", fontFamily: "", fontSize: "",
  stops: [{ type: "min", value: "", color: "#f8696b" }, { type: "percentile", value: "50", color: "#ffeb84" }, { type: "max", value: "", color: "#63be7b" }],
  barMin: { type: "min", value: "", color: "" }, barMax: { type: "max", value: "", color: "" }, barColor: "#638ec6", barNegative: "", barSolid: false, barBorder: false, barAxis: "", barAxisColor: "", barBorderColor: "", barNegBorder: "", barRtl: false, pivotOn: false, pivotValue: "", pivotRows: "", pivotCols: "", pivotItems: null, barShort: "", barLong: "",
  set: "3TrafficLights1", steps: evenSteps(3).map((s) => ({ type: s.type, value: String(s.value), color: "" })), reverse: false, hideValue: false, custom: null,
};

function formOf(rule: ConditionalRule | null, kind: Kind | undefined, ranges: string, op?: CellRuleOperator): Form {
  const f: Form = { ...BLANK, ranges, ...(kind ? { kind } : {}), ...(op ? { op } : {}) };
  if (!rule) return f;
  f.kind = rule.kind;
  f.ranges = rule.ranges.join(" ");
  if (rule.pivot) {
    f.pivotOn = true;
    f.pivotValue = rule.pivot.value === undefined ? "" : String(rule.pivot.value);
    f.pivotRows = rule.pivot.rows ?? "";
    f.pivotCols = rule.pivot.columns ?? "";
    f.pivotItems = rule.pivot.items ?? null;
  }
  f.stop = !!rule.stop;
  if ("style" in rule) {
    const s = rule.style;
    f.fill = s.fill ?? "";
    f.color = s.color ?? "";
    f.bold = !!s.bold;
    f.italic = !!s.italic;
    f.underline = !!s.underline;
    f.strike = !!s.strike;
    f.border = !!s.border;
    f.fmt = s.fmt ?? "";
    f.fontFamily = s.fontFamily ?? "";
    f.fontSize = s.fontSize ? String(s.fontSize) : "";
  }
  switch (rule.kind) {
    case "cell":
      f.op = rule.op;
      f.v1 = rule.values[0]!;
      f.v2 = rule.values[1] ?? "";
      break;
    case "text":
      f.textOp = rule.op;
      f.text = rule.text;
      break;
    case "formula":
      f.formula = rule.formula;
      break;
    case "top":
      f.rank = String(rule.rank);
      f.percent = !!rule.percent;
      f.bottom = !!rule.bottom;
      break;
    case "average":
      f.above = rule.above;
      f.equal = !!rule.equal;
      f.stdDev = rule.stdDev ? String(rule.stdDev) : "";
      break;
    case "dates":
      f.period = rule.period;
      break;
    case "colorScale":
      f.stops = rule.stops.map(fromPoint);
      break;
    case "dataBar":
      f.barMin = fromPoint(rule.min);
      f.barMax = fromPoint(rule.max);
      f.barColor = rule.color;
      f.barNegative = rule.negativeColor ?? "";
      f.barSolid = !!rule.solid;
      f.barBorder = !!rule.border;
      f.barAxis = rule.axis ?? "";
      f.barAxisColor = rule.axisColor ?? "";
      f.barBorderColor = rule.borderColor ?? "";
      f.barNegBorder = rule.negativeBorderColor ?? "";
      f.barRtl = !!rule.rtl;
      f.barShort = rule.minLength !== undefined ? String(rule.minLength) : "";
      f.barLong = rule.maxLength !== undefined ? String(rule.maxLength) : "";
      f.hideValue = !!rule.hideValue;
      break;
    case "iconSet":
      f.set = rule.set;
      f.steps = rule.thresholds.map(fromPoint);
      f.reverse = !!rule.reverse;
      f.hideValue = !!rule.hideValue;
      f.custom = rule.custom ? rule.custom.map((c) => (c ? `${c.set}:${c.index}` : "")) : null;
      break;
  }
  return f;
}

function styleOf(f: Form): ConditionalStyle {
  const s: ConditionalStyle = {};
  if (f.fill) s.fill = f.fill;
  if (f.color) s.color = f.color;
  if (f.bold) s.bold = true;
  if (f.italic) s.italic = true;
  if (f.underline) s.underline = true;
  if (f.strike) s.strike = true;
  if (f.fmt.trim()) s.fmt = f.fmt.trim();
  if (f.fontFamily.trim()) s.fontFamily = f.fontFamily.trim();
  if (Number(f.fontSize) > 0) s.fontSize = Number(f.fontSize);
  if (f.border) {
    const line = { style: "thin" as const, color: f.color || "#e5484d" };
    s.border = { top: line, right: line, bottom: line, left: line };
  }
  return s;
}

/** The rule the form describes, or the reason it isn't one yet. */
function build(f: Form, pivot?: PivotChoice | null): RuleSpec | string {
  const ranges = f.pivotOn && pivot ? [] : f.ranges.split(/[\s,]+/).filter(Boolean);
  if (!ranges.length && !(f.pivotOn && pivot)) return "Say which cells the rule applies to, such as B2:B20.";
  const scope = f.pivotOn && pivot ? { pivot: { id: pivot.id, ...(f.pivotValue !== "" ? { value: Number(f.pivotValue) } : {}), ...(f.pivotRows ? { rows: f.pivotRows } : {}), ...(f.pivotCols ? { columns: f.pivotCols } : {}), ...(f.pivotItems ? { items: f.pivotItems } : {}) } } : {};
  const base = { ranges, ...scope, ...(f.stop ? { stop: true as const } : {}) };
  const style = styleOf(f);
  switch (f.kind) {
    case "cell": {
      const two = f.op === "between" || f.op === "notBetween";
      if (!f.v1.trim() || (two && !f.v2.trim())) return "Give the value to compare with.";
      return { ...base, kind: "cell", op: f.op, values: two ? [f.v1.trim(), f.v2.trim()] : [f.v1.trim()], style };
    }
    case "text":
      return f.text ? { ...base, kind: "text", op: f.textOp, text: f.text, style } : "Give the text to look for.";
    case "formula":
      return f.formula.trim() ? { ...base, kind: "formula", formula: f.formula.trim(), style } : "Give the formula.";
    case "top": {
      const rank = Number(f.rank);
      return Number.isInteger(rank) && rank > 0 ? { ...base, kind: "top", rank, ...(f.percent ? { percent: true as const } : {}), ...(f.bottom ? { bottom: true as const } : {}), style } : "How many? A whole number.";
    }
    case "average": {
      const sd = Number(f.stdDev || 0);
      return { ...base, kind: "average", above: f.above, ...(f.equal ? { equal: true as const } : {}), ...(sd ? { stdDev: sd } : {}), style };
    }
    case "dates":
      return { ...base, kind: "dates", period: f.period, style };
    case "blanks":
    case "noBlanks":
    case "errors":
    case "noErrors":
    case "duplicates":
    case "uniques":
      return { ...base, kind: f.kind, style };
    case "colorScale":
      return { ...base, kind: "colorScale", stops: f.stops.map((s) => ({ ...toPoint(s), color: s.color })) };
    case "dataBar":
      return { ...base, kind: "dataBar", min: toPoint(f.barMin), max: toPoint(f.barMax), color: f.barColor, ...(f.barNegative ? { negativeColor: f.barNegative } : {}), ...(f.barSolid ? { solid: true as const } : {}), ...(f.barBorder ? { border: true as const } : {}), ...(f.barBorder && f.barBorderColor ? { borderColor: f.barBorderColor } : {}), ...(f.barBorder && f.barNegBorder ? { negativeBorderColor: f.barNegBorder } : {}), ...(f.barRtl ? { rtl: true as const } : {}), ...(f.barAxis ? { axis: f.barAxis } : {}), ...(f.barAxisColor ? { axisColor: f.barAxisColor } : {}), ...(f.barShort.trim() !== "" ? { minLength: Number(f.barShort) } : {}), ...(f.barLong.trim() !== "" ? { maxLength: Number(f.barLong) } : {}), ...(f.hideValue ? { hideValue: true as const } : {}) };
    case "iconSet":
      return { ...base, kind: "iconSet", set: f.set, thresholds: f.steps.map((s) => ({ ...toPoint(s) })) as never, ...(f.reverse ? { reverse: true as const } : {}), ...(f.hideValue ? { hideValue: true as const } : {}), ...(f.custom ? { custom: f.custom.map((v) => { const [set, i] = v.split(":"); return v === "" ? null : { set: set as IconSetName, index: Number(i) }; }) } : {}) };
  }
}

/** A pivot table a rule can follow: its id and name, the headings of its values, and its row and column fields. */
export interface PivotChoice {
  id: string;
  name: string;
  values: string[];
  rows: string[];
  columns: string[];
  /** What a rule for the selected cells of the pivot table would follow, when the selection is only value cells of it. */
  selection?: { value?: number; rows?: string; columns?: string; items?: Record<string, string[]> } | null;
}

export interface RuleDialogProps {
  open: boolean;
  /** The pivot table the selection is in (or the rule follows), if any: the rule can then follow its cells. */
  pivot?: PivotChoice | null;
  /** The rule being changed; null for a new one. */
  rule: ConditionalRule | null;
  /** For a new rule, the kind to start with and the cells it applies to. */
  kind?: Kind | undefined;
  /** For a new "cell value" rule, the comparison it starts with. */
  op?: CellRuleOperator | undefined;
  ranges: string;
  onClose(): void;
  /** Saves the rule; returns why it was refused, if it was. */
  onSave(spec: RuleSpec): string | void;
}

/** Makes or changes a conditional format: which cells, what condition, and how they look when it holds. */
export function RuleDialog({ open, pivot, rule, kind, op, ranges, onClose, onSave }: RuleDialogProps) {
  const [form, setForm] = useState<Form>(BLANK);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(formOf(rule, kind, ranges, op));
      setProblem(null);
    }
  }, [open, rule, kind, op, ranges]);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    const built = build(form, pivot);
    if (typeof built === "string") return setProblem(built);
    const refused = onSave(built);
    if (refused) setProblem(refused);
  };

  const styled = form.kind !== "colorScale" && form.kind !== "dataBar" && form.kind !== "iconSet";
  const preset = STYLE_PRESETS.findIndex((p) => (p.style.fill ?? "") === form.fill && (p.style.color ?? "") === form.color && !!p.style.bold === form.bold && !!p.style.border === form.border && !form.italic && !form.underline && !form.strike && !form.fmt && !form.fontFamily && !form.fontSize);
  const sample: React.CSSProperties = { background: form.fill || undefined, color: form.color || undefined, fontWeight: form.bold ? 700 : undefined, fontFamily: form.fontFamily || undefined, fontSize: Number(form.fontSize) > 0 ? `${form.fontSize}pt` : undefined, fontStyle: form.italic ? "italic" : undefined, textDecoration: [form.underline ? "underline" : "", form.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined, border: form.border ? `1px solid ${form.color || "#e5484d"}` : undefined };

  return (
    <Dialog
      open={open}
      title={rule ? "Edit rule" : "New rule"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label>
          Rule
          <select value={form.kind} disabled={!!rule} onChange={(e) => set({ kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        {pivot && (
          <label>
            Apply the rule to
            <select
              aria-label="Apply the rule to"
              value={form.pivotOn ? (form.pivotItems ? "selection" : "pivot") : "cells"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "selection" && pivot.selection) {
                  const sel = pivot.selection;
                  set({ pivotOn: true, pivotValue: sel.value === undefined ? "" : String(sel.value), pivotRows: sel.rows ?? "", pivotCols: sel.columns ?? "", pivotItems: sel.items ?? {} });
                } else set({ pivotOn: v !== "cells", pivotItems: null });
              }}
            >
              <option value="cells">The selected cells</option>
              {(pivot.selection || form.pivotItems) && <option value="selection">The selected cells of {pivot.name}, wherever they move</option>}
              <option value="pivot">The cells of {pivot.name}, wherever they move</option>
            </select>
          </label>
        )}
        {pivot && form.pivotOn ? (
          <div className="pli-chartform-pair">
            <label>
              Showing
              <select aria-label="Pivot value" value={form.pivotValue} onChange={(e) => set({ pivotValue: e.target.value })}>
                <option value="">All values</option>
                {pivot.values.map((v, i) => <option key={i} value={String(i)}>{v}</option>)}
              </select>
            </label>
            {pivot.rows.length > 0 && (
              <label>
                For the row field
                <select aria-label="Pivot row field" value={form.pivotRows} onChange={(e) => set({ pivotRows: e.target.value })}>
                  <option value="">Any level, totals too</option>
                  {pivot.rows.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
            {pivot.columns.length > 0 && (
              <label>
                For the column field
                <select aria-label="Pivot column field" value={form.pivotCols} onChange={(e) => set({ pivotCols: e.target.value })}>
                  <option value="">Any level, totals too</option>
                  {pivot.columns.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
          </div>
        ) : (
          <label>
            Applies to
            <input type="text" value={form.ranges} placeholder="B2:B20" onChange={(e) => set({ ranges: e.target.value })} />
          </label>
        )}

        {form.kind === "cell" && (
          <div className="pli-chartform-pair">
            <label>
              Format cells that are
              <select value={form.op} onChange={(e) => set({ op: e.target.value as CellRuleOperator })}>
                {CELL_OPERATORS.map((o) => <option key={o} value={o}>{CELL_OPERATOR_LABELS[o]}</option>)}
              </select>
            </label>
            <label>
              Value or cell
              <input type="text" value={form.v1} placeholder="10 or $D$1" onChange={(e) => set({ v1: e.target.value })} />
            </label>
            {(form.op === "between" || form.op === "notBetween") && (
              <label>
                and
                <input type="text" value={form.v2} onChange={(e) => set({ v2: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {form.kind === "text" && (
          <div className="pli-chartform-pair">
            <label>
              Format cells that
              <select value={form.textOp} onChange={(e) => set({ textOp: e.target.value as TextRuleOperator })}>
                {TEXT_OPERATORS.map((o) => <option key={o} value={o}>{TEXT_OPERATOR_LABELS[o]}</option>)}
              </select>
            </label>
            <label>
              Text
              <input type="text" value={form.text} onChange={(e) => set({ text: e.target.value })} />
            </label>
          </div>
        )}
        {form.kind === "formula" && (
          <label>
            Format cells where this formula is true
            <input type="text" value={form.formula} placeholder="=$B2>10" onChange={(e) => set({ formula: e.target.value.replace(/^\s*=\s*/, "") })} />
            <span className="pli-ruleform-hint">Cell references are relative to the top-left cell of the range.</span>
          </label>
        )}
        {form.kind === "top" && (
          <div className="pli-chartform-pair">
            <label>
              Format
              <select value={form.bottom ? "bottom" : "top"} onChange={(e) => set({ bottom: e.target.value === "bottom" })}>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>
              How many
              <input type="text" value={form.rank} onChange={(e) => set({ rank: e.target.value })} />
            </label>
            <label className="pli-ruleform-check"><input type="checkbox" checked={form.percent} onChange={(e) => set({ percent: e.target.checked })} /> As a percentage of the cells</label>
          </div>
        )}
        {form.kind === "average" && (
          <div className="pli-chartform-pair">
            <label>
              Format cells that are
              <select value={form.above ? "above" : "below"} onChange={(e) => set({ above: e.target.value === "above" })}>
                <option value="above">Above average</option>
                <option value="below">Below average</option>
              </select>
            </label>
            <label>
              Standard deviations
              <select value={form.stdDev} onChange={(e) => set({ stdDev: e.target.value })}>
                <option value="">Just the average</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>
            <label className="pli-ruleform-check"><input type="checkbox" checked={form.equal} onChange={(e) => set({ equal: e.target.checked })} /> Include the average itself</label>
          </div>
        )}
        {form.kind === "dates" && (
          <label>
            Format dates
            <select value={form.period} onChange={(e) => set({ period: e.target.value as DatePeriod })}>
              {DATE_PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
            </select>
          </label>
        )}

        {form.kind === "colorScale" && (
          <fieldset>
            <legend>Colors</legend>
            <label className="pli-ruleform-check">
              <input type="checkbox" checked={form.stops.length === 3} onChange={(e) => set({ stops: e.target.checked ? [form.stops[0]!, { type: "percentile", value: "50", color: "#ffeb84" }, form.stops[form.stops.length - 1]!] : [form.stops[0]!, form.stops[form.stops.length - 1]!] })} /> Three colors
            </label>
            {form.stops.map((p, i) => (
              <PointRow key={i} label={i === 0 ? "Lowest" : i === form.stops.length - 1 ? "Highest" : "Middle"} p={p} colored set={(next) => set({ stops: form.stops.map((q, j) => (j === i ? next : q)) })} />
            ))}
          </fieldset>
        )}
        {form.kind === "dataBar" && (
          <fieldset>
            <legend>Bar</legend>
            <PointRow label="Shortest" p={form.barMin} types={["auto", ...POINT_TYPES]} set={(p) => set({ barMin: p })} />
            <PointRow label="Longest" p={form.barMax} types={["auto", ...POINT_TYPES]} set={(p) => set({ barMax: p })} />
            <div className="pli-ruleform-point">
              <span>Color</span>
              <input type="color" aria-label="Bar color" value={form.barColor} onChange={(e) => set({ barColor: e.target.value })} />
            </div>
            <div className="pli-ruleform-point">
              <span>Negative color</span>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.barNegative !== ""} onChange={(e) => set({ barNegative: e.target.checked ? "#ff0000" : "" })} /> Different</label>
              <span />
              {form.barNegative !== "" && <input type="color" aria-label="Negative bar color" value={form.barNegative} onChange={(e) => set({ barNegative: e.target.value })} />}
            </div>
            <div className="pli-chartform-pair">
              <label>
                Fill
                <select value={form.barSolid ? "solid" : "gradient"} onChange={(e) => set({ barSolid: e.target.value === "solid" })}>
                  <option value="gradient">Gradient</option>
                  <option value="solid">Solid</option>
                </select>
              </label>
              <label>
                Zero line
                <select value={form.barAxis} onChange={(e) => set({ barAxis: e.target.value as typeof form.barAxis })}>
                  <option value="">Where zero falls</option>
                  <option value="middle">Middle of the cell</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label>
                Shortest bar (%)
                <input type="text" value={form.barShort} placeholder="0" onChange={(e) => set({ barShort: e.target.value })} />
              </label>
              <label>
                Longest bar (%)
                <input type="text" value={form.barLong} placeholder="100" onChange={(e) => set({ barLong: e.target.value })} />
              </label>
            </div>
            <div className="pli-dropdown-options">
              <label><input type="checkbox" checked={form.barBorder} onChange={(e) => set({ barBorder: e.target.checked })} /> Border</label>
              <label>Axis color <input type="color" value={form.barAxisColor || "#000000"} onChange={(e) => set({ barAxisColor: e.target.value })} /></label>
              <label><input type="checkbox" checked={form.barRtl} onChange={(e) => set({ barRtl: e.target.checked })} /> Bars grow from the right</label>
            </div>
            {form.barBorder && (
              <div className="pli-ruleform-point">
                <span>Border color</span>
                <label className="pli-ruleform-check"><input type="checkbox" checked={form.barBorderColor !== ""} onChange={(e) => set({ barBorderColor: e.target.checked ? form.barColor : "" })} /> Own color</label>
                <span />
                {form.barBorderColor !== "" && <input type="color" aria-label="Bar border color" value={form.barBorderColor} onChange={(e) => set({ barBorderColor: e.target.value })} />}
              </div>
            )}
            {form.barBorder && form.barNegative !== "" && (
              <div className="pli-ruleform-point">
                <span>Negative border</span>
                <label className="pli-ruleform-check"><input type="checkbox" checked={form.barNegBorder !== ""} onChange={(e) => set({ barNegBorder: e.target.checked ? form.barNegative : "" })} /> Own color</label>
                <span />
                {form.barNegBorder !== "" && <input type="color" aria-label="Negative bar border color" value={form.barNegBorder} onChange={(e) => set({ barNegBorder: e.target.value })} />}
              </div>
            )}
            <label className="pli-ruleform-check"><input type="checkbox" checked={form.hideValue} onChange={(e) => set({ hideValue: e.target.checked })} /> Show the bar only</label>
          </fieldset>
        )}
        {form.kind === "iconSet" && (
          <fieldset>
            <legend>Icons</legend>
            <label>
              Icon set
              <select
                value={form.set}
                onChange={(e) => {
                  const next = e.target.value as IconSetName;
                  set({ set: next, steps: evenSteps(ICON_SETS[next]).map((s) => ({ type: s.type, value: String(s.value), color: "" })), custom: null });
                }}
              >
                {(Object.keys(ICON_SETS) as IconSetName[]).map((n) => <option key={n} value={n}>{ICON_SET_LABELS[n]}</option>)}
              </select>
            </label>
            {form.steps.map((p, i) => (
              <PointRow key={`${form.set}${i}`} label={`Icon ${i + 2} from`} p={p} types={["num", "percent", "percentile", "formula"]} set={(next) => set({ steps: form.steps.map((q, j) => (j === i ? next : q)) })} />
            ))}
            <div className="pli-dropdown-options">
              <label><input type="checkbox" checked={form.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> Reverse the order of the icons</label>
              <label><input type="checkbox" checked={form.hideValue} onChange={(e) => set({ hideValue: e.target.checked })} /> Show the icon only</label>
              <label><input type="checkbox" checked={form.custom !== null} onChange={(e) => set({ custom: e.target.checked ? Array.from({ length: ICON_SETS[form.set] }, (_, i) => `${form.set}:${i}`) : null })} /> Choose each icon</label>
            </div>
            {form.custom && (
              <ul className="pli-dropdown-rows" aria-label="Icons">
                {form.custom.map((v, i) => (
                  <li key={i} className="pli-ruleform-point">
                    <span>{i === 0 ? "Lowest" : i === form.custom!.length - 1 ? "Highest" : `Step ${i + 1}`}</span>
                    <select aria-label={`Icon ${i + 1}`} value={v} onChange={(e) => set({ custom: form.custom!.map((x, j) => (j === i ? e.target.value : x)) })}>
                      <option value="">No icon</option>
                      {(Object.keys(ICON_SETS) as IconSetName[]).map((name) => (
                        <optgroup key={name} label={ICON_SET_LABELS[name]}>
                          {Array.from({ length: ICON_SETS[name] }, (_, k) => <option key={k} value={`${name}:${k}`}>{ICON_SET_LABELS[name]}, {k + 1} of {ICON_SETS[name]}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}

        {styled && (
          <fieldset>
            <legend>Format</legend>
            <label>
              Look
              <select value={preset} onChange={(e) => { const p = STYLE_PRESETS[Number(e.target.value)]; if (p) set({ fill: p.style.fill ?? "", color: p.style.color ?? "", bold: !!p.style.bold, italic: false, underline: false, strike: false, border: !!p.style.border }); }}>
                {preset < 0 && <option value={-1}>Custom</option>}
                {STYLE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
            <div className="pli-ruleform-style">
              <label>Fill <input type="color" value={form.fill || "#ffffff"} onChange={(e) => set({ fill: e.target.value })} /></label>
              <label>Text <input type="color" value={form.color || "#000000"} onChange={(e) => set({ color: e.target.value })} /></label>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.bold} onChange={(e) => set({ bold: e.target.checked })} /> <b>B</b></label>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.italic} onChange={(e) => set({ italic: e.target.checked })} /> <i>I</i></label>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.underline} onChange={(e) => set({ underline: e.target.checked })} /> <u>U</u></label>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.strike} onChange={(e) => set({ strike: e.target.checked })} /> <s>S</s></label>
              <label className="pli-ruleform-check"><input type="checkbox" checked={form.border} onChange={(e) => set({ border: e.target.checked })} /> Box</label>
              <span className="pli-ruleform-sample" style={sample}>AaBbCc</span>
            </div>
            <div className="pli-chartform-pair">
              <label>
                Number format
                <input type="text" list="pli-rule-formats" value={form.fmt} placeholder="0.0%  or  [Red]#,##0" onChange={(e) => set({ fmt: e.target.value })} />
                <datalist id="pli-rule-formats">
                  <option value="0.00" />
                  <option value="#,##0" />
                  <option value="0%" />
                  <option value="0.0%" />
                  <option value="$#,##0.00" />
                  <option value="[Red]#,##0;[Red]-#,##0" />
                  <option value="yyyy-mm-dd" />
                </datalist>
              </label>
              <div className="pli-chartform-pair">
                <label>
                  Font
                  <input type="text" value={form.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} />
                </label>
                <label>
                  Size
                  <input type="text" value={form.fontSize} placeholder="pt" onChange={(e) => set({ fontSize: e.target.value })} />
                </label>
              </div>
            </div>
            <span className="pli-ruleform-hint">Excel changes the number format of a rule, and the font's style and colour, but not its name or size: those show here and are written to the file, but Excel leaves them out.</span>
          </fieldset>
        )}
        <label className="pli-ruleform-check"><input type="checkbox" checked={form.stop} onChange={(e) => set({ stop: e.target.checked })} /> Stop here when this rule applies (skip the rules after it)</label>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}

export interface RulesDialogProps {
  open: boolean;
  rules: readonly ConditionalRule[];
  readOnly: boolean;
  onClose(): void;
  onNew(): void;
  onEdit(id: string): void;
  onMove(id: string, to: number): void;
  onDelete(id: string): void;
}

/** The rules of the sheet in order, the first having the most say. */
export function RulesDialog({ open, rules, readOnly, onClose, onNew, onEdit, onMove, onDelete }: RulesDialogProps) {
  return (
    <Dialog
      open={open}
      title="Conditional formatting rules"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="pli-button" disabled={readOnly} onClick={onNew}>New rule…</button>
          <button type="button" className="pli-button pli-button-primary" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="pli-ruleform">
        {rules.length === 0 ? (
          <p className="pli-ruleform-hint">This sheet has no conditional formats.</p>
        ) : (
          <ol className="pli-ruleform-list" aria-label="Rules, the first having the most say">
            {rules.map((r, i) => (
              <li key={r.id} className="pli-ruleform-rule">
                <span className="pli-ruleform-sample" style={"style" in r ? { background: r.style.fill, color: r.style.color, fontWeight: r.style.bold ? 700 : undefined, fontStyle: r.style.italic ? "italic" : undefined, textDecoration: [r.style.underline ? "underline" : "", r.style.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined } : r.kind === "colorScale" ? { background: `linear-gradient(90deg, ${r.stops.map((s) => s.color).join(", ")})` } : r.kind === "dataBar" ? { background: `linear-gradient(90deg, ${r.color} 60%, transparent 60%)` } : undefined}>
                  {r.kind === "iconSet" ? "◔" : "AaBb"}
                </span>
                <span className="pli-ruleform-what">
                  <span>{describeRule(r)}</span>
                  <span className="pli-ruleform-where">{r.ranges.join(", ")}</span>
                </span>
                <span className="pli-ruleform-buttons">
                  <button type="button" className="pli-button" aria-label={`Move up: ${describeRule(r)}`} disabled={readOnly || i === 0} onClick={() => onMove(r.id, i - 1)}>↑</button>
                  <button type="button" className="pli-button" aria-label={`Move down: ${describeRule(r)}`} disabled={readOnly || i === rules.length - 1} onClick={() => onMove(r.id, i + 1)}>↓</button>
                  <button type="button" className="pli-button" aria-label={`Edit: ${describeRule(r)}`} disabled={readOnly} onClick={() => onEdit(r.id)}>Edit</button>
                  <button type="button" className="pli-button" aria-label={`Delete: ${describeRule(r)}`} disabled={readOnly} onClick={() => onDelete(r.id)}>✕</button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}
