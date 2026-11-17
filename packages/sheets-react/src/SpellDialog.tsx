import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { changeAllMisspellings, changeMisspelling, findMisspellings, type Misspelling, type SheetSession, type SpellChecker, type SpellScope } from "@pli.dev/sheets";

export type SpellWhere = "selection" | "sheet" | "workbook";

export interface SpellDialogProps {
  open: boolean;
  session: SheetSession;
  checker: SpellChecker;
  /** The sheet being shown (its name) and the selected range when it is more than one cell. */
  sheet: string;
  selection: string | null;
  readOnly: boolean;
  /** Shows a cell: switches to its sheet and selects it. */
  go(sheet: string, address: string): void;
  /** Called when a word is added to the person's dictionary, so the host can keep it. */
  onAddWord?(word: string): void;
  onClose(): void;
  /** Says why a change was refused (a protected sheet, say). */
  onProblem?(message: string): void;
}

const keyOf = (m: Misspelling) => `${m.sheet}!${m.address}@${m.start}:${m.word}`;

/** Excel's Review > Spelling: steps through the words that are not in the dictionary and offers to ignore, change or add each one. */
export function SpellDialog({ open, session, checker, sheet, selection, readOnly, go, onAddWord, onClose, onProblem }: SpellDialogProps) {
  const [where, setWhere] = useState<SpellWhere>("sheet");
  const [tick, setTick] = useState(0);
  const ignoredOnce = useRef(new Set<string>());
  const [replacement, setReplacement] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    ignoredOnce.current = new Set();
    checker.resetIgnored();
    setWhere(selection ? "selection" : "sheet");
    setMessage(null);
    setTick((n) => n + 1);
  }, [open]);

  const scope: SpellScope = where === "workbook" ? {} : where === "selection" && selection ? { sheet, range: selection } : { sheet };
  const current = useMemo(() => {
    if (!open) return null;
    return findMisspellings(session, checker, scope).find((m) => !ignoredOnce.current.has(keyOf(m))) ?? null;
  }, [open, tick, where, sheet, selection, session]);
  const suggestions = useMemo(() => (current ? checker.suggest(current.word, 8) : []), [current?.word, checker, tick]);

  useEffect(() => {
    if (!current) return;
    setReplacement(suggestions[0] ?? "");
    go(current.sheet, current.address);
  }, [current ? keyOf(current) : "", suggestions.join("|")]);

  const refresh = () => setTick((n) => n + 1);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setMessage(null);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setMessage(why);
      onProblem?.(why);
    }
    refresh();
  };

  const context = current ? (
    <p className="pli-spell-context" aria-live="polite">
      {current.text.slice(Math.max(0, current.start - 40), current.start)}
      <mark>{current.word}</mark>
      {current.text.slice(current.end, current.end + 40)}
    </p>
  ) : null;

  return (
    <Dialog
      open={open}
      title="Spelling"
      onClose={onClose}
      onSubmit={() => current && !readOnly && replacement.trim() && attempt(() => changeMisspelling(session, current, replacement))}
      actions={<button type="button" className="pli-button" onClick={onClose}>{current ? "Cancel" : "Close"}</button>}
    >
      <div className="pli-spell">
        <label className="pli-spell-where">
          Check
          <select value={where} onChange={(e) => { setWhere(e.target.value as SpellWhere); ignoredOnce.current = new Set(); }}>
            {selection && <option value="selection">The selection ({selection})</option>}
            <option value="sheet">This sheet</option>
            <option value="workbook">The whole workbook</option>
          </select>
        </label>
        {current ? (
          <>
            <div className="pli-spell-label">Not in dictionary <span className="pli-spell-where-cell">({current.sheet}!{current.address})</span></div>
            {context}
            <div className="pli-spell-columns">
              <div className="pli-spell-side">
                <label>
                  Change to
                  <input autoFocus value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Change to" />
                </label>
                <ul className="pli-spell-suggestions" role="listbox" aria-label="Suggestions">
                  {suggestions.length === 0 && <li className="pli-spell-none">(no suggestions)</li>}
                  {suggestions.map((s) => (
                    <li key={s} role="option" aria-selected={s === replacement}>
                      <button type="button" className="pli-spell-suggestion" data-on={s === replacement ? "" : undefined} onClick={() => setReplacement(s)} onDoubleClick={() => !readOnly && attempt(() => changeMisspelling(session, current, s))}>{s}</button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pli-spell-buttons">
                <button type="button" className="pli-button" onClick={() => { ignoredOnce.current.add(keyOf(current)); refresh(); }}>Ignore once</button>
                <button type="button" className="pli-button" onClick={() => { checker.ignoreAll(current.word); refresh(); }}>Ignore all</button>
                <button type="button" className="pli-button" onClick={() => { checker.addWord(current.word); onAddWord?.(current.word.toLowerCase()); refresh(); }}>Add to dictionary</button>
                <button type="button" className="pli-button" disabled={readOnly || !replacement.trim()} onClick={() => attempt(() => changeMisspelling(session, current, replacement))}>Change</button>
                <button type="button" className="pli-button" disabled={readOnly || !replacement.trim()} onClick={() => attempt(() => void changeAllMisspellings(session, findMisspellings(session, checker, scope), current.word, replacement))}>Change all</button>
              </div>
            </div>
          </>
        ) : (
          <p className="pli-spell-done" role="status">The spelling check is complete. {tick > 0 && ignoredOnce.current.size > 0 ? `${ignoredOnce.current.size} left as they are.` : ""}</p>
        )}
        {message && <p className="pli-dropdown-error" role="alert">{message}</p>}
      </div>
    </Dialog>
  );
}
