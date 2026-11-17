import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepFocus } from "@pli.dev/react";
import { cellAddress, parseCell, type FindFormat, type FindOptions, type FoundCell, type SheetSession } from "@pli.dev/sheets";

export interface FindForm {
  text: string;
  with: string;
  matchCase: boolean;
  wholeCell: boolean;
  regex: boolean;
  lookIn: "values" | "formulas" | "notes";
  /** One sheet (the one being shown), all of them, or a range worked out from the selection when it was chosen. */
  within: "sheet" | "workbook" | { sheet: string; range: string };
  by: "rows" | "columns";
  /** Only cells that hold errors. */
  errors: boolean;
  /** Look in hidden sheets too (when searching all sheets). */
  hidden: boolean;
  /** Only cells with a look: bold, italic, or the look the active cell had when this was chosen. */
  look: "any" | "bold" | "italic" | "like";
  /** The look taken from the active cell. */
  like: FindFormat | null;
}

const START: FindForm = { text: "", with: "", matchCase: false, wholeCell: false, regex: false, lookIn: "values", within: "sheet", by: "rows", errors: false, hidden: false, look: "any", like: null };

export interface FindParams {
  session: SheetSession;
  revision: number;
  sheetId: string;
  active: { row: number; col: number };
  /** The selected range when it is more than one cell, such as `A1:C5`. */
  selectionRange: string | null;
  /** Shows the cell: switches to its sheet and selects it. */
  go(sheet: string, row: number, col: number): void;
}

/** Find and replace: its form, the cells it finds, and moving between them. */
export function useFind({ session, revision, sheetId, active, selectionRange, go }: FindParams) {
  const [open, setOpen] = useState(false);
  const [replace, setReplace] = useState(false);
  const [form, setForm] = useState<FindForm>(START);
  const [message, setMessage] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const update = (patch: Partial<FindForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  };

  // Replacing works on what was typed (or on notes), so that is what is marked while the replace row is showing.
  const options = useMemo<FindOptions>(
    () => ({
      text: form.text,
      matchCase: form.matchCase,
      wholeCell: form.wholeCell,
      regex: form.regex,
      lookIn: replace && form.lookIn === "values" ? "formulas" : form.lookIn,
      scope: form.within === "workbook" ? "workbook" : form.within === "sheet" ? { sheet: sheetId } : form.within,
      by: form.by,
      ...(form.errors ? { errors: true } : {}),
      ...(form.hidden && form.within === "workbook" ? { hidden: true } : {}),
      ...(form.look === "bold" ? { format: { bold: true } } : form.look === "italic" ? { format: { italic: true } } : form.look === "like" && form.like ? { format: form.like } : {}),
    }),
    [form.text, form.matchCase, form.wholeCell, form.regex, form.lookIn, form.within, form.by, form.errors, form.hidden, form.look, form.like, replace, sheetId],
  );
  const searching = form.text !== "" || form.errors || options.format !== undefined;

  /** The look of the active cell, to find cells like it. */
  const lookOfActive = (): FindFormat => {
    const st = session.cell(sheetId, cellAddress(active.row, active.col))?.s ?? {};
    return { bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike, fill: st.fill ?? "none", color: st.color ?? "auto" };
  };

  const result = useMemo<{ matches: FoundCell[]; error: string | null }>(() => {
    if (!open || !searching) return { matches: [], error: null };
    try {
      return { matches: session.find(options), error: null };
    } catch (e) {
      return { matches: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [session, revision, open, options, searching]);

  const marked = useMemo(() => {
    const set = new Set<string>();
    for (const m of result.matches) {
      if (m.sheet !== sheetId) continue;
      const p = parseCell(m.address)!;
      set.add(`${p.row}:${p.col}`);
    }
    return set;
  }, [result.matches, sheetId]);

  const activeAddress = cellAddress(active.row, active.col);
  const position = result.matches.findIndex((m) => m.sheet === sheetId && m.address === activeAddress);

  /** Moves to the next (or previous) cell after the active one, wrapping round. */
  const step = useCallback(
    (direction: 1 | -1) => {
      let matches: FoundCell[];
      try {
        matches = session.find(options);
      } catch {
        return;
      }
      if (!matches.length) return;
      const sheets = session.state.sheets;
      const key = (sheet: string, row: number, col: number) => {
        const si = sheets.findIndex((s) => s.id === sheet);
        return options.by === "columns" ? [si, col, row] : [si, row, col];
      };
      const cmp = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      const here = key(sheetId, active.row, active.col);
      const keyed = matches.map((m) => {
        const p = parseCell(m.address)!;
        return { m, p, k: key(m.sheet, p.row, p.col) };
      });
      const target = direction > 0 ? keyed.find((x) => cmp(x.k, here) > 0) ?? keyed[0]! : [...keyed].reverse().find((x) => cmp(x.k, here) < 0) ?? keyed[keyed.length - 1]!;
      go(target.m.sheet, target.p.row, target.p.col);
    },
    [session, options, sheetId, active.row, active.col, go],
  );

  const replaceHere = () => {
    try {
      const here = session.find(options).find((m) => m.sheet === sheetId && m.address === activeAddress);
      if (here) {
        const r = session.replace(options, form.with, [here]);
        if (r.skipped) setMessage("That cell can't take the change");
        else setMessage(null);
        if (r.cells) return step(1);
      }
    } catch (e) {
      return setMessage(e instanceof Error ? e.message : String(e));
    }
    step(1);
  };

  const replaceAll = () => {
    try {
      const r = session.replace(options, form.with);
      const skipped = r.skipped ? ` ${r.skipped} cell${r.skipped === 1 ? "" : "s"} couldn't take the change.` : "";
      const what = options.lookIn === "notes" ? "note" : "cell";
      setMessage(r.cells ? `Replaced ${r.occurrences} in ${r.cells} ${what}${r.cells === 1 ? "" : "s"}.${skipped}` : r.skipped ? `Nothing replaced.${skipped}` : "Nothing to replace");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const show = (withReplace: boolean) => {
    setOpen(true);
    if (withReplace) setReplace(true);
    setFocusTick((n) => n + 1);
  };

  const status = result.error ? "Not a pattern that can be searched for" : message ?? (!searching ? "" : result.matches.length === 0 ? "No results" : position >= 0 ? `${position + 1} of ${result.matches.length}` : `${result.matches.length} found`);

  return {
    open,
    replace,
    setReplace,
    form,
    update,
    marked: open ? marked : undefined,
    status,
    selectionRange,
    sheetId,
    focusTick,
    step,
    replaceHere,
    replaceAll,
    lookOfActive,
    show,
    close: () => setOpen(false),
    hasMatches: result.matches.length > 0,
  };
}

export type FindState = ReturnType<typeof useFind>;

/** The bar under the toolbar for finding text, and replacing it. */
export function FindBar({ find, readOnly, onClose }: { find: FindState; readOnly: boolean; onClose(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const { form, update } = find;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [find.focusTick]);

  const within = typeof form.within === "object" ? "range" : form.within;
  const key = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      enter();
    }
  };
  const replacing = find.replace && !readOnly;

  return (
    <div className="pli-findbar" role="search" aria-label="Find and replace">
      <div className="pli-findbar-row">
        <button type="button" className="pli-tool" aria-label="Replace" aria-expanded={replacing} title="Show or hide replace" disabled={readOnly} onMouseDown={keepFocus} onClick={() => find.setReplace(!find.replace)}>
          {replacing ? "▾" : "▸"}
        </button>
        <input ref={input} className="pli-findbar-input" aria-label="Find" placeholder="Find" value={form.text} onChange={(e) => update({ text: e.target.value })} onKeyDown={(e) => key(e, () => find.step(e.shiftKey ? -1 : 1))} />
        <span className="pli-findbar-count" role="status" aria-live="polite">{find.status}</span>
        <button type="button" className="pli-tool" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={!find.hasMatches} onMouseDown={keepFocus} onClick={() => find.step(-1)}>{"↑"}</button>
        <button type="button" className="pli-tool" aria-label="Next match" title="Next (Enter)" disabled={!find.hasMatches} onMouseDown={keepFocus} onClick={() => find.step(1)}>{"↓"}</button>
        <span className="pli-findbar-spacer pli-findbar-grow" />
        <button type="button" className="pli-tool" aria-label="Close find" title="Close (Esc)" onMouseDown={keepFocus} onClick={onClose}>{"×"}</button>
      </div>
      <div className="pli-findbar-row pli-findbar-options">
        <span className="pli-findbar-spacer" />
        <label className="pli-findbar-check"><input type="checkbox" checked={form.matchCase} onChange={(e) => update({ matchCase: e.target.checked })} /> Match case</label>
        <label className="pli-findbar-check"><input type="checkbox" checked={form.wholeCell} onChange={(e) => update({ wholeCell: e.target.checked })} /> Entire cell</label>
        <label className="pli-findbar-check"><input type="checkbox" checked={form.regex} onChange={(e) => update({ regex: e.target.checked })} /> Regular expression</label>
        <select
          aria-label="Search in"
          value={within}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "selection" && find.selectionRange) update({ within: { sheet: find.sheetId, range: find.selectionRange } });
            else if (v === "sheet" || v === "workbook") update({ within: v });
          }}
        >
          <option value="sheet">This sheet</option>
          <option value="workbook">All sheets</option>
          {typeof form.within === "object" && <option value="range">{form.within.range}</option>}
          {find.selectionRange && !(typeof form.within === "object" && form.within.range === find.selectionRange) && <option value="selection">{`Selection (${find.selectionRange})`}</option>}
        </select>
        <select aria-label="Look in" value={replacing && form.lookIn === "values" ? "formulas" : form.lookIn} title={replacing ? "Replacing works on what was typed in the cells, or on notes" : undefined} onChange={(e) => update({ lookIn: e.target.value as FindForm["lookIn"] })}>
          <option value="values" disabled={replacing}>Values shown</option>
          <option value="formulas">Formulas and typed text</option>
          <option value="notes">Notes</option>
        </select>
        <label className="pli-findbar-check"><input type="checkbox" checked={form.errors} onChange={(e) => update({ errors: e.target.checked })} /> Errors only</label>
        <label className="pli-findbar-check" title="Hidden sheets are included when searching all sheets"><input type="checkbox" checked={form.hidden} disabled={form.within !== "workbook"} onChange={(e) => update({ hidden: e.target.checked })} /> Hidden sheets</label>
        <select
          aria-label="Format"
          value={form.look}
          onChange={(e) => {
            const look = e.target.value as FindForm["look"];
            update({ look, like: look === "like" ? find.lookOfActive() : null });
          }}
        >
          <option value="any">Any format</option>
          <option value="bold">Bold</option>
          <option value="italic">Italic</option>
          <option value="like">Like the active cell</option>
        </select>
        <select aria-label="Order" value={form.by} onChange={(e) => update({ by: e.target.value as FindForm["by"] })}>
          <option value="rows">By rows</option>
          <option value="columns">By columns</option>
        </select>
      </div>
      {replacing && (
        <div className="pli-findbar-row">
          <span className="pli-findbar-spacer" />
          <input className="pli-findbar-input" aria-label="Replace with" placeholder="Replace with" value={form.with} onChange={(e) => update({ with: e.target.value })} onKeyDown={(e) => key(e, find.replaceHere)} />
          <button type="button" className="pli-button" disabled={!find.hasMatches} onMouseDown={keepFocus} onClick={find.replaceHere}>Replace</button>
          <button type="button" className="pli-button" disabled={!find.hasMatches} onMouseDown={keepFocus} onClick={find.replaceAll}>Replace all</button>
        </div>
      )}
    </div>
  );
}
