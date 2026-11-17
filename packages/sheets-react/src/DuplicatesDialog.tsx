import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";

export interface DuplicatesDialogProps {
  open: boolean;
  title?: string | undefined;
  /** The column names, as the first row names them (a table's, or the header row of a range). */
  columns: string[];
  /** What the columns are called when the first row is data ("Column A"…); the dialog then shows a "My data has headers" box. */
  plainColumns?: string[] | undefined;
  /** Whether the first row holds the headers to start with (only used with `plainColumns`). */
  header?: boolean | undefined;
  onClose(): void;
  /** `columns` are the numbers (1 is the first) of the columns to compare. Returns why it was refused, if it was. */
  onSave(columns: number[], header: boolean): string | void;
}

/** Excel's Remove Duplicates dialog: the columns whose repeated values mark a row as a duplicate. */
export function DuplicatesDialog({ open, title = "Remove duplicates", columns, plainColumns, header: startHeader, onClose, onSave }: DuplicatesDialogProps) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [header, setHeader] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(columns.map((_, i) => i + 1)));
    setHeader(plainColumns ? startHeader ?? true : true);
    setProblem(null);
    // Only opening starts it afresh: the parent builds these props anew on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const names = plainColumns && !header ? plainColumns : columns;
  const toggle = (n: number) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      onSubmit={() => {
        const refused = onSave([...picked].sort((a, b) => a - b), header);
        if (refused) setProblem(refused);
      }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-dupform">
        <p className="pli-hint">Rows with the same values in the columns you tick are duplicates; the first of each is kept. Capitals don&apos;t matter.</p>
        {plainColumns && <label className="pli-ruleform-check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> My data has headers</label>}
        <div>
          <button type="button" className="pli-button" onClick={() => setPicked(new Set(names.map((_, i) => i + 1)))}>Select all</button>
          <button type="button" className="pli-button" onClick={() => setPicked(new Set())}>Unselect all</button>
        </div>
        <ul className="pli-pivot-items" role="group" aria-label="Columns">
          {names.map((n, i) => (
            <li key={i}>
              <label className="pli-ruleform-check">
                <input type="checkbox" checked={picked.has(i + 1)} onChange={() => toggle(i + 1)} /> {n}
              </label>
            </li>
          ))}
        </ul>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
