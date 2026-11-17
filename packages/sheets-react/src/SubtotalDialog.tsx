import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { SUBTOTAL_FUNCTIONS, type SubtotalFunction, type SubtotalOptions } from "@pli.dev/sheets";

/** A column of the list: its letter, and its heading (empty if it has none). */
export interface SubtotalColumn {
  letter: string;
  heading: string;
}

export interface SubtotalDialogProps {
  open: boolean;
  /** The list being subtotalled, as a range, and its columns. */
  range: string;
  columns: SubtotalColumn[];
  /** Whether the list has subtotals in it already (Remove All is for that). */
  hasSubtotals: boolean;
  /** The name of the table the list lies over, if any: a table can't be subtotalled, so OK turns it into a range first. */
  table?: string;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(options: SubtotalOptions): string | void;
  onRemove(): void;
}

const LABELS: Record<SubtotalFunction, string> = { sum: "Sum", count: "Count", countNums: "Count Numbers", average: "Average", max: "Max", min: "Min", product: "Product", stdDev: "StdDev", stdDevp: "StdDevp", var: "Var", varp: "Varp" };
const name = (c: SubtotalColumn) => (c.heading ? c.heading : `Column ${c.letter}`);

/** Excel's Subtotal dialog: where the list changes, what to work out, for which columns, and how the rows are laid out. */
export function SubtotalDialog({ open, range, columns, hasSubtotals, table, onClose, onSave, onRemove }: SubtotalDialogProps) {
  const [by, setBy] = useState("");
  const [fn, setFn] = useState<SubtotalFunction>("sum");
  const [picked, setPicked] = useState<string[]>([]);
  const [replace, setReplace] = useState(true);
  const [pageBreaks, setPageBreaks] = useState(false);
  const [below, setBelow] = useState(true);
  const [grand, setGrand] = useState(true);
  const [sort, setSort] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBy(columns[0]?.letter ?? "");
    setFn("sum");
    setPicked(columns.length ? [columns[columns.length - 1]!.letter] : []);
    setReplace(true);
    setPageBreaks(false);
    setBelow(true);
    setGrand(true);
    setSort(false);
    setProblem(null);
  }, [open, columns]);

  const save = () => {
    if (!by) return setProblem("Pick the column whose changes start a new subtotal.");
    if (!picked.length) return setProblem("Pick at least one column to add subtotals to.");
    const refused = onSave({ by, fn, columns: picked, replace, pageBreaks, summaryBelow: below, grandTotal: grand, ...(sort ? { sort: true } : {}), ...(table ? { convertTable: true } : {}) });
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title="Subtotal"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" disabled={!hasSubtotals} onClick={onRemove}>Remove all</button>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup">
        <p className="pli-ruleform-hint">The list {range} should be sorted by the column you pick (or tick the box below to sort it first); its first row is the headings.</p>
        {table && <p className="pli-ruleform-hint" role="note">{table} is a table, and a table can't be subtotalled. OK turns it into a range first (one undo step brings it back).</p>}
        <label>
          At each change in
          <select aria-label="At each change in" value={by} onChange={(e) => setBy(e.target.value)}>
            {columns.map((c) => (
              <option key={c.letter} value={c.letter}>{name(c)}</option>
            ))}
          </select>
        </label>
        <label>
          Use function
          <select aria-label="Use function" value={fn} onChange={(e) => setFn(e.target.value as SubtotalFunction)}>
            {SUBTOTAL_FUNCTIONS.map((f) => (
              <option key={f} value={f}>{LABELS[f]}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Add subtotal to</legend>
          {columns.map((c) => (
            <label key={c.letter} className="pli-ruleform-check">
              <input type="checkbox" aria-label={`Add subtotal to ${name(c)}`} checked={picked.includes(c.letter)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.letter] : p.filter((l) => l !== c.letter)))} /> {name(c)}
            </label>
          ))}
        </fieldset>
        <label className="pli-ruleform-check"><input type="checkbox" aria-label="Sort the list by this column first" checked={sort} onChange={(e) => setSort(e.target.checked)} /> Sort the list by this column first</label>
        <label className="pli-ruleform-check"><input type="checkbox" aria-label="Replace current subtotals" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace current subtotals</label>
        <label className="pli-ruleform-check"><input type="checkbox" aria-label="Page break between groups" checked={pageBreaks} onChange={(e) => setPageBreaks(e.target.checked)} /> Page break between groups</label>
        <label className="pli-ruleform-check"><input type="checkbox" aria-label="Summary below data" checked={below} onChange={(e) => setBelow(e.target.checked)} /> Summary below data</label>
        <label className="pli-ruleform-check"><input type="checkbox" aria-label="Grand total" checked={grand} onChange={(e) => setGrand(e.target.checked)} /> Grand total</label>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
