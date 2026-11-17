import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { CELL_OPERATORS, parseExternalRef, type CellRuleOperator, type ExternalListStatus, type ExternalReference, type ListSnapshot, type Validation, type ValidationSpec } from "@pli.dev/sheets";
import { CELL_OPERATOR_LABELS } from "./rules";

type Allow = "any" | Validation["kind"];

const ALLOW: { value: Allow; label: string }[] = [
  { value: "any", label: "Any value" },
  { value: "whole", label: "Whole number" },
  { value: "decimal", label: "Decimal" },
  { value: "list", label: "List" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "textLength", label: "Text length" },
  { value: "custom", label: "Custom formula" },
];

/** What the dialog asks for: a rule, a dropdown of typed choices, or no validation at all. */
export type ValidationResult = { rule: ValidationSpec } | { choices: string[]; strict: boolean; multiple: boolean; /** What joins several choices in a cell (a comma and a space when missing). */ separator?: string; ranges: string[] } | { clear: true; ranges: string[] };

export interface ValidationDialogProps {
  open: boolean;
  /** The rule on the active cell, if there is one; otherwise the typed choices of a dropdown there, as text. */
  rule: Validation | null;
  choices: string[] | null;
  /** The typed choices of that dropdown allow several. */
  multipleChoices?: boolean;
  /** What joins several of those typed choices in a cell. */
  choicesSeparator?: string;
  /** The cells of other workbooks that rules read, and how the copy kept of them stands. */
  externalRefs?: readonly ExternalReference[];
  ranges: string;
  /** The names defined in the workbook, which a list can be read from. */
  names: readonly string[];
  /** For a list read from another workbook: where its items stand (read now, or the snapshot kept in the file). */
  external?: ExternalListStatus | null;
  onClose(): void;
  /** Returns why the entry was refused, if it was. */
  onSave(result: ValidationResult): string | void;
}

interface Form {
  allow: Allow;
  ranges: string;
  op: CellRuleOperator;
  v1: string;
  v2: string;
  source: string;
  formula: string;
  ignoreBlank: boolean;
  arrow: boolean;
  multiple: boolean;
  separator: string;
  /** The snapshot of the list's items as the rule had them, kept while its source stays the same. */
  snapshot?: ListSnapshot;
  originalSource: string;
  promptTitle: string;
  prompt: string;
  alert: NonNullable<Validation["alert"]>;
  errorTitle: string;
  error: string;
}

const BLANK: Form = { allow: "any", ranges: "", op: "between", v1: "", v2: "", source: "", formula: "", ignoreBlank: true, arrow: true, multiple: false, separator: ", ", originalSource: "", promptTitle: "", prompt: "", alert: "stop", errorTitle: "", error: "" };

function formOf(rule: Validation | null, choices: string[] | null, ranges: string, multipleChoices = false, choicesSeparator?: string): Form {
  const f: Form = { ...BLANK, ranges };
  if (choices) {
    f.allow = "list";
    f.source = choices.join(", ");
    f.multiple = multipleChoices;
    f.separator = choicesSeparator ?? ", ";
    return f;
  }
  if (!rule) return f;
  f.allow = rule.kind;
  f.ranges = rule.ranges.join(" ");
  f.ignoreBlank = !rule.noBlank;
  f.alert = rule.alert ?? "stop";
  f.errorTitle = rule.errorTitle ?? "";
  f.error = rule.error ?? "";
  f.promptTitle = rule.promptTitle ?? "";
  f.prompt = rule.prompt ?? "";
  if (rule.kind === "list") {
    f.source = parseExternalRef(rule.source) ? rule.source : "=" + rule.source;
    f.originalSource = f.source;
    f.arrow = !rule.hideArrow;
    f.multiple = !!rule.multiple;
    f.separator = rule.separator ?? ", ";
    if (rule.snapshot) f.snapshot = rule.snapshot;
  } else if (rule.kind === "custom") f.formula = rule.formula;
  else {
    f.op = rule.op;
    f.v1 = rule.values[0]!;
    f.v2 = rule.values[1] ?? "";
  }
  return f;
}

/** Sets what may be typed into the selected cells, what is said when something else is, and a note shown beside the cell. */
export function ValidationDialog({ open, rule, choices, ranges, names, external, multipleChoices, choicesSeparator, externalRefs, onClose, onSave }: ValidationDialogProps) {
  const [form, setForm] = useState<Form>(BLANK);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(formOf(rule, choices, ranges, multipleChoices, choicesSeparator));
      setProblem(null);
    }
  }, [open, rule, choices, ranges, multipleChoices, choicesSeparator]);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  /** A reference, a name or a range in another workbook is read from cells; anything else is a list of choices typed in. */
  const readsCells = (text: string): boolean => /^=/.test(text) || !!parseExternalRef(text) || /^(?:'[^']+'!|[A-Za-z_][\w.]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(text) || names.some((n) => n.toLowerCase() === text.toLowerCase());

  const save = () => {
    const where = form.ranges.split(/[\s,]+/).filter(Boolean);
    if (!where.length) return setProblem("Say which cells this applies to, such as B2:B20.");
    let result: ValidationResult;
    if (form.allow === "any") result = { clear: true, ranges: where };
    else {
      const messages = {
        ...(form.promptTitle ? { promptTitle: form.promptTitle } : {}),
        ...(form.prompt ? { prompt: form.prompt } : {}),
        ...(form.alert !== "stop" ? { alert: form.alert } : {}),
        ...(form.errorTitle ? { errorTitle: form.errorTitle } : {}),
        ...(form.error ? { error: form.error } : {}),
      };
      const base = { ranges: where, ...(form.ignoreBlank ? {} : { noBlank: true as const }), ...messages };
      if (form.allow === "list") {
        const text = form.source.trim();
        // A reference or a name is read from cells; anything else is a list of choices typed in.
        if (readsCells(text)) {
          if (form.multiple && !form.separator.trim()) return setProblem("Give the separator that goes between several choices, such as a comma.");
          const source = text.replace(/^=/, "");
          result = {
            rule: {
              ...base,
              kind: "list",
              source,
              ...(form.arrow ? {} : { hideArrow: true as const }),
              ...(form.multiple ? { multiple: true as const, ...(form.separator !== ", " ? { separator: form.separator } : {}) } : {}),
              ...(form.snapshot && text === form.originalSource ? { snapshot: form.snapshot } : {}),
            } as ValidationSpec,
          };
        } else {
          const items = text.split(",").map((x) => x.trim()).filter(Boolean);
          if (!items.length) return setProblem("Give the cells the list comes from, or the choices separated by commas.");
          if (form.multiple && !form.separator.trim()) return setProblem("Give the separator that goes between several choices, such as a comma.");
          result = { choices: items, strict: form.alert === "stop", multiple: form.multiple, ...(form.multiple && form.separator !== ", " ? { separator: form.separator } : {}), ranges: where };
        }
      } else if (form.allow === "custom") {
        if (!form.formula.trim()) return setProblem("Give the formula.");
        result = { rule: { ...base, kind: "custom", formula: form.formula.trim().replace(/^=/, "") } as ValidationSpec };
      } else {
        const two = form.op === "between" || form.op === "notBetween";
        if (!form.v1.trim() || (two && !form.v2.trim())) return setProblem("Give the value to compare with.");
        result = { rule: { ...base, kind: form.allow, op: form.op, values: two ? [form.v1.trim(), form.v2.trim()] : [form.v1.trim()] } as ValidationSpec };
      }
    }
    const refused = onSave(result);
    if (refused) setProblem(refused);
  };

  const compares = form.allow === "whole" || form.allow === "decimal" || form.allow === "date" || form.allow === "time" || form.allow === "textLength";
  const two = form.op === "between" || form.op === "notBetween";
  const valueHint = form.allow === "date" ? "3/5/2024 or A1" : form.allow === "time" ? "12:00 or A1" : "10 or A1";

  return (
    <Dialog
      open={open}
      title="Data validation"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => { const refused = onSave({ clear: true, ranges: form.ranges.split(/[\s,]+/).filter(Boolean) }); if (refused) setProblem(refused); }}>Clear all</button>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label>
          Applies to
          <input type="text" value={form.ranges} placeholder="B2:B20" onChange={(e) => set({ ranges: e.target.value })} />
        </label>
        <label>
          Allow
          <select value={form.allow} onChange={(e) => set({ allow: e.target.value as Allow })}>
            {ALLOW.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>

        {compares && (
          <div className="pli-chartform-pair">
            <label>
              Data
              <select value={form.op} onChange={(e) => set({ op: e.target.value as CellRuleOperator })}>
                {CELL_OPERATORS.map((o) => <option key={o} value={o}>{CELL_OPERATOR_LABELS[o]}</option>)}
              </select>
            </label>
            <label>
              {two ? "Minimum" : "Value"}
              <input type="text" value={form.v1} placeholder={valueHint} onChange={(e) => set({ v1: e.target.value })} />
            </label>
            {two && (
              <label>
                Maximum
                <input type="text" value={form.v2} onChange={(e) => set({ v2: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {form.allow === "list" && (
          <label>
            Source
            <input type="text" value={form.source} placeholder="=Lists!$A$1:$A$5, or: red, green, blue" onChange={(e) => set({ source: e.target.value })} />
            <span className="pli-ruleform-hint">Cells (a range or a name) the choices are read from, a range in another workbook such as [Prices.xlsx]Sheet1!$A$1:$A$10, or the choices typed with commas between them.</span>
          </label>
        )}
        {form.allow === "list" && external && (
          <p className="pli-ruleform-hint pli-ruleform-external" data-state={external.state} role="status">
            {external.state === "fresh"
              ? `Read from ${external.book} just now: ${external.items.length} items.`
              : `${external.reason ?? ""} ${external.items.length} items.`}
          </p>
        )}
        {form.allow !== "list" && form.allow !== "any" && (externalRefs?.length ?? 0) > 0 && (
          <p className="pli-ruleform-hint pli-ruleform-external" role="status" data-state={externalRefs!.every((r) => r.state === "fresh") ? "fresh" : "stale"}>
            {externalRefs!.map((r) => `${r.book}: ${r.state === "fresh" ? "read just now" : r.state === "missing" ? "not read yet" : `copy kept in the workbook${r.read ? `, read ${r.read}` : ""} (may be out of date)`}`).join("; ")}
          </p>
        )}
        {form.allow === "list" && (
          <div className="pli-dropdown-options">
            <label><input type="checkbox" checked={form.multiple} onChange={(e) => set({ multiple: e.target.checked })} /> Allow choosing several in a cell</label>
            {form.multiple && (
              <label>
                Separator
                <input type="text" aria-label="Separator" value={form.separator} maxLength={8} onChange={(e) => set({ separator: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {form.allow === "custom" && (
          <label>
            Formula
            <input type="text" value={form.formula} placeholder="=COUNTIF($A:$A,A1)=1" onChange={(e) => set({ formula: e.target.value })} />
            <span className="pli-ruleform-hint">Entries are allowed where it is true. References are relative to the top-left cell, and can read another workbook, such as [Prices.xlsx]Sheet1!$B$1.</span>
          </label>
        )}
        {form.allow !== "any" && (
          <>
            <div className="pli-dropdown-options">
              <label><input type="checkbox" checked={form.ignoreBlank} onChange={(e) => set({ ignoreBlank: e.target.checked })} /> Ignore blank</label>
              {form.allow === "list" && <label><input type="checkbox" checked={form.arrow} onChange={(e) => set({ arrow: e.target.checked })} /> Dropdown arrow in the cell</label>}
            </div>
            <fieldset>
              <legend>Input message</legend>
              <label>
                Title
                <input type="text" value={form.promptTitle} maxLength={32} onChange={(e) => set({ promptTitle: e.target.value })} />
              </label>
              <label>
                Message
                <input type="text" value={form.prompt} maxLength={255} onChange={(e) => set({ prompt: e.target.value })} />
              </label>
            </fieldset>
            <fieldset>
              <legend>When something else is typed</legend>
              <label>
                Respond with
                <select value={form.alert} onChange={(e) => set({ alert: e.target.value as Form["alert"] })}>
                  <option value="stop">Stop: refuse it</option>
                  <option value="warning">Warning: ask first</option>
                  <option value="information">Information: tell, and ask</option>
                  <option value="none">Nothing: let it in</option>
                </select>
              </label>
              {form.alert !== "none" && (
                <>
                  <label>
                    Title
                    <input type="text" value={form.errorTitle} maxLength={32} onChange={(e) => set({ errorTitle: e.target.value })} />
                  </label>
                  <label>
                    Message
                    <input type="text" value={form.error} maxLength={255} placeholder="Describes the rule when left empty" onChange={(e) => set({ error: e.target.value })} />
                  </label>
                </>
              )}
            </fieldset>
          </>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
