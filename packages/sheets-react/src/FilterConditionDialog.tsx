import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { FILTER_DATE_PERIODS, FILTER_PERIOD_WORDS, type FilterCriterion, type FilterDatePeriod, type FilterRule, type FilterTest, type FilterTestOp } from "@pli.dev/sheets";

export interface FilterConditionDialogProps {
  open: boolean;
  /** The name of the column being filtered, for the title. */
  column: string;
  /** What the column lets through now. */
  current: FilterCriterion | undefined;
  /** The colours the column's cells have. */
  colors: { fills: string[]; fonts: string[] };
  onClose(): void;
  /** Returns why the filter was refused, if it was. */
  onSave(rule: FilterRule): string | void;
}

type Kind = "custom" | "top" | "average" | "date" | "color";

const OPS: { op: FilterTestOp; label: string }[] = [
  { op: "equals", label: "equals" },
  { op: "notEquals", label: "does not equal" },
  { op: "greaterThan", label: "is greater than" },
  { op: "greaterThanOrEqual", label: "is greater than or equal to" },
  { op: "lessThan", label: "is less than" },
  { op: "lessThanOrEqual", label: "is less than or equal to" },
  { op: "contains", label: "contains" },
  { op: "notContains", label: "does not contain" },
  { op: "beginsWith", label: "begins with" },
  { op: "notBeginsWith", label: "does not begin with" },
  { op: "endsWith", label: "ends with" },
  { op: "notEndsWith", label: "does not end with" },
  { op: "blank", label: "is empty" },
  { op: "notBlank", label: "is not empty" },
];

interface TestDraft {
  op: FilterTestOp;
  value: string;
}
const noValue = (op: FilterTestOp) => op === "blank" || op === "notBlank";
const draftOf = (t: FilterTest | undefined): TestDraft => ({ op: t?.op ?? "equals", value: t?.value === undefined ? "" : String(t.value) });
const testOf = (d: TestDraft): FilterTest => (noValue(d.op) ? { op: d.op } : { op: d.op, value: d.value });

/** Filters a column by a condition: one comparison or two, the top or bottom, above or below average, a period of dates, or a colour. */
export function FilterConditionDialog({ open, column, current, colors, onClose, onSave }: FilterConditionDialogProps) {
  const [kind, setKind] = useState<Kind>("custom");
  const [a, setA] = useState<TestDraft>({ op: "equals", value: "" });
  const [b, setB] = useState<TestDraft | null>(null);
  const [or, setOr] = useState(false);
  const [n, setN] = useState("10");
  const [bottom, setBottom] = useState(false);
  const [percent, setPercent] = useState(false);
  const [below, setBelow] = useState(false);
  const [period, setPeriod] = useState<FilterDatePeriod>("thisMonth");
  const [by, setBy] = useState<"fill" | "font">("fill");
  const [color, setColor] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const rule = current && !Array.isArray(current) ? current : undefined;
    setKind(rule && rule.kind !== "dateGroups" ? rule.kind : "custom");
    setA(draftOf(rule?.kind === "custom" ? rule.a : undefined));
    setB(rule?.kind === "custom" && rule.b ? draftOf(rule.b) : null);
    setOr(rule?.kind === "custom" && !!rule.or);
    setN(String(rule?.kind === "top" ? rule.n : 10));
    setBottom(rule?.kind === "top" && !!rule.bottom);
    setPercent(rule?.kind === "top" && !!rule.percent);
    setBelow(rule?.kind === "average" && !!rule.below);
    setPeriod(rule?.kind === "date" ? rule.period : "thisMonth");
    const byFont = rule?.kind === "color" && rule.font !== undefined;
    setBy(byFont ? "font" : "fill");
    setColor(rule?.kind === "color" ? (rule.fill ?? rule.font ?? "") : "");
    setProblem(null);
  }, [open, current]);

  const list = by === "fill" ? colors.fills : colors.fonts;
  const chosenColor = list.includes(color) ? color : (list[0] ?? "");

  const save = () => {
    let rule: FilterRule;
    switch (kind) {
      case "custom":
        rule = { kind: "custom", a: testOf(a), ...(b ? { b: testOf(b), ...(or ? { or: true as const } : {}) } : {}) };
        break;
      case "top": {
        const count = Number(n);
        if (!Number.isInteger(count)) return setProblem("The number of items is a whole number.");
        rule = { kind: "top", n: count, ...(bottom ? { bottom: true as const } : {}), ...(percent ? { percent: true as const } : {}) };
        break;
      }
      case "average":
        rule = { kind: "average", ...(below ? { below: true as const } : {}) };
        break;
      case "date":
        rule = { kind: "date", period };
        break;
      case "color":
        if (!chosenColor) return setProblem("There is no colour to filter by.");
        rule = by === "fill" ? { kind: "color", fill: chosenColor } : { kind: "color", font: chosenColor };
        break;
    }
    const refused = onSave(rule);
    if (refused) setProblem(refused);
  };

  const testRow = (label: string, d: TestDraft, set: (d: TestDraft) => void) => (
    <div className="pli-pagesetup-trio">
      <label>
        <span>{label}</span>
        <select aria-label={`${label} comparison`} value={d.op} onChange={(e) => set({ ...d, op: e.target.value as FilterTestOp })}>
          {OPS.map((o) => (
            <option key={o.op} value={o.op}>{o.label}</option>
          ))}
        </select>
      </label>
      {!noValue(d.op) && <input type="text" aria-label={`${label} value`} value={d.value} onChange={(e) => set({ ...d, value: e.target.value })} />}
    </div>
  );

  return (
    <Dialog
      open={open}
      title={`Filter ${column} by condition`}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup">
        <label>
          Show cells that
          <select aria-label="Kind of condition" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="custom">compare with a value or text</option>
            <option value="top">are the top or bottom</option>
            <option value="average">are above or below the average</option>
            <option value="date">are dates in a period</option>
            <option value="color">have a colour</option>
          </select>
        </label>
        {kind === "custom" && (
          <fieldset>
            {testRow("First", a, setA)}
            {b ? (
              <>
                <div>
                  <label className="pli-ruleform-check"><input type="radio" name="filterjoin" checked={!or} onChange={() => setOr(false)} /> And</label>
                  <label className="pli-ruleform-check"><input type="radio" name="filterjoin" checked={or} onChange={() => setOr(true)} /> Or</label>
                </div>
                {testRow("Second", b, setB)}
                <button type="button" className="pli-button" onClick={() => setB(null)}>Remove the second condition</button>
              </>
            ) : (
              <button type="button" className="pli-button" onClick={() => setB({ op: "equals", value: "" })}>Add a second condition</button>
            )}
            <p className="pli-hint">Use ? for any one character and * for any text, as in Excel. Dates can be typed as 2025-03-15.</p>
          </fieldset>
        )}
        {kind === "top" && (
          <fieldset>
            <div className="pli-pagesetup-trio">
              <label>
                Show
                <select aria-label="Top or bottom" value={bottom ? "bottom" : "top"} onChange={(e) => setBottom(e.target.value === "bottom")}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <input type="number" aria-label="How many" value={n} onChange={(e) => setN(e.target.value)} />
              <select aria-label="Items or percent" value={percent ? "percent" : "items"} onChange={(e) => setPercent(e.target.value === "percent")}>
                <option value="items">items</option>
                <option value="percent">percent</option>
              </select>
            </div>
          </fieldset>
        )}
        {kind === "average" && (
          <fieldset>
            <label className="pli-ruleform-check"><input type="radio" name="filteravg" checked={!below} onChange={() => setBelow(false)} /> Above average</label>
            <label className="pli-ruleform-check"><input type="radio" name="filteravg" checked={below} onChange={() => setBelow(true)} /> Below average</label>
          </fieldset>
        )}
        {kind === "date" && (
          <fieldset>
            <label>
              Dates in
              <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as FilterDatePeriod)}>
                {FILTER_DATE_PERIODS.map((p) => (
                  <option key={p} value={p}>{FILTER_PERIOD_WORDS[p]}</option>
                ))}
              </select>
            </label>
          </fieldset>
        )}
        {kind === "color" && (
          <fieldset>
            <div>
              <label className="pli-ruleform-check"><input type="radio" name="filterby" checked={by === "fill"} onChange={() => setBy("fill")} /> Fill colour</label>
              <label className="pli-ruleform-check"><input type="radio" name="filterby" checked={by === "font"} onChange={() => setBy("font")} /> Font colour</label>
            </div>
            <label>
              Colour
              <select aria-label="Colour" value={chosenColor} onChange={(e) => setColor(e.target.value)}>
                {list.map((c) => (
                  <option key={c} value={c}>{c === "none" ? "No fill" : c === "auto" ? "Automatic" : c}</option>
                ))}
              </select>
            </label>
          </fieldset>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
