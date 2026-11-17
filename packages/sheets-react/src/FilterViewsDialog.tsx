import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import type { FilterView } from "@pli.dev/sheets";

export interface FilterViewsDialogProps {
  open: boolean;
  views: readonly FilterView[];
  /** The view this person is looking at, if one is showing. */
  activeId: string | null;
  /** Whether the sheet has a filter (or a table with a filter or sort) to save. */
  hasFilter: boolean;
  /** What each view holds, by view id, in a few words. */
  summaries?: Readonly<Record<string, string>>;
  /** The columns of the sheet's filter a view can sort by: the column number and what to call it. */
  sortColumns: readonly { column: number; label: string }[];
  readOnly: boolean;
  onClose(): void;
  /** Each returns why it was refused, if it was. */
  onSave(name: string, sort: { column: number; descending: boolean } | null): string | void;
  onShow(id: string | null): void;
  onApply(id: string): string | void;
  onUpdate(id: string): string | void;
  onRename(id: string, name: string): string | void;
  onDelete(id: string): string | void;
}

/** Where filter views are saved, shown, kept up to date and deleted. */
export function FilterViewsDialog({ open, views, activeId, hasFilter, summaries, sortColumns, readOnly, onClose, onSave, onShow, onApply, onUpdate, onRename, onDelete }: FilterViewsDialogProps) {
  const [name, setName] = useState("");
  const [sort, setSort] = useState("none");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setSort("none");
      setProblem(null);
    }
  }, [open]);
  const run = (refused: string | void) => setProblem(refused ?? null);
  const save = () => {
    const by = sort === "none" ? null : { column: Number(sort.slice(1)), descending: sort[0] === "d" };
    const refused = onSave(name, by);
    if (refused) setProblem(refused);
    else {
      setName("");
      setProblem(null);
    }
  };
  return (
    <Dialog
      open={open}
      title="Filter views"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Close</button>
          <button type="submit" className="pli-button pli-button-primary" disabled={readOnly || !hasFilter}>Save current filter</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-viewsform">
        <p className="pli-ruleform-hint">
          A view is the sheet&apos;s filter, and the filters and sorts of its tables, saved under a name. Showing one hides rows for you only;
          everyone else keeps seeing the sheet as it is. Apply for everyone makes it the sheet&apos;s own.
        </p>
        <label>
          Save the sheet&apos;s filters as a view called
          <input type="text" value={name} placeholder={hasFilter ? "Overdue, by owner…" : "Create a filter or filter a table first"} disabled={readOnly || !hasFilter} onChange={(e) => setName(e.target.value)} />
        </label>
        {sortColumns.length > 0 && (
          <label>
            And, when applied for everyone, sort by
            <select value={sort} disabled={readOnly || !hasFilter} onChange={(e) => setSort(e.target.value)}>
              <option value="none">Don&apos;t sort</option>
              {sortColumns.flatMap((c) => [
                <option key={`a${c.column}`} value={`a${c.column}`}>{c.label}, A to Z</option>,
                <option key={`d${c.column}`} value={`d${c.column}`}>{c.label}, Z to A</option>,
              ])}
            </select>
          </label>
        )}
        <ul className="pli-views" aria-label="Saved views">
          {views.map((v) => (
            <li key={v.id} className="pli-views-row" data-active={v.id === activeId ? "" : undefined}>
              <input
                type="text"
                aria-label={`Name of ${v.name}`}
                defaultValue={v.name}
                key={v.name}
                disabled={readOnly}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  if (e.currentTarget.value !== v.name) {
                    const refused = onRename(v.id, e.currentTarget.value);
                    if (refused) {
                      e.currentTarget.value = v.name;
                      setProblem(refused);
                    } else setProblem(null);
                  }
                }}
              />
              {summaries?.[v.id] && <span className="pli-views-summary">{summaries[v.id]}</span>}
              <button type="button" className="pli-button" aria-pressed={v.id === activeId} onClick={() => onShow(v.id === activeId ? null : v.id)}>{v.id === activeId ? "Showing" : "Show"}</button>
              <button type="button" className="pli-button" disabled={readOnly} onClick={() => run(onApply(v.id))}>Apply for everyone</button>
              <button type="button" className="pli-button" disabled={readOnly || !hasFilter} title="Replace what the view holds with the sheet's filter as it is now" onClick={() => run(onUpdate(v.id))}>Update</button>
              <button type="button" className="pli-button" disabled={readOnly} aria-label={`Delete ${v.name}`} onClick={() => run(onDelete(v.id))}>Delete</button>
            </li>
          ))}
          {views.length === 0 && <li className="pli-views-empty">No views yet.</li>}
        </ul>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
