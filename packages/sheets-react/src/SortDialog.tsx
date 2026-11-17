import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { ICON_SETS, type IconRef, type IconSetName, type RangeSortLevel } from "@pli.dev/sheets";
import { CfIcon } from "./icons";
import { ICON_SET_LABELS } from "./rules";

export interface SortChoices {
  fills: string[];
  fonts: string[];
  icons: (IconRef | null)[];
}

export interface SortDialogProps {
  open: boolean;
  title?: string | undefined;
  /** The column names, as the first row names them (a table's, or the header row of a range). */
  columns: string[];
  /** What the columns are called when the first row is data ("Column A"…); the dialog then shows a "My data has headers" box. */
  plainColumns?: string[] | undefined;
  /** Whether the first row holds the headers to start with (only used with `plainColumns`). */
  header?: boolean | undefined;
  /** The levels to start with (columns are 1-based; descending is Z to A, or "on bottom"). */
  levels: RangeSortLevel[];
  /** The colours and icons the cells of a column (1-based) have. */
  choicesOf(column: number, header: boolean): SortChoices;
  onClose(): void;
  /** Returns why the sort was refused, if it was. */
  onSave(levels: RangeSortLevel[], header: boolean): string | void;
}

type On = "value" | "cellColor" | "fontColor" | "icon";
interface Draft {
  column: number;
  on: On;
  color: string;
  icon: string;
  down: boolean;
}

const iconKey = (i: IconRef | null | undefined) => (i ? `${i.set}:${i.index}` : "none");
const iconOf = (key: string): IconRef | null => {
  if (key === "none") return null;
  const [set, index] = key.split(":");
  return { set: set as IconSetName, index: Number(index) };
};
const colorWord = (c: string) => (c === "none" ? "No fill" : c === "auto" ? "Automatic" : c);

const draftOf = (l: RangeSortLevel): Draft => ({
  column: l.column,
  on: l.by ?? "value",
  color: l.color ?? "",
  icon: l.icon === undefined ? "" : iconKey(l.icon),
  down: !!l.descending,
});

/** Excel's Sort dialog: levels of column, what to sort on (values, cell colour, font colour, icon) and the order. */
export function SortDialog({ open, title = "Sort", columns, plainColumns, header: startHeader, levels, choicesOf, onClose, onSave }: SortDialogProps) {
  const [rows, setRows] = useState<Draft[]>([]);
  const [header, setHeader] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows((levels.length ? levels : [{ column: 1 }]).map(draftOf));
    setHeader(plainColumns ? startHeader ?? true : true);
    setProblem(null);
    // Only opening starts it afresh: the parent builds these props anew on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const names = plainColumns && !header ? plainColumns : columns;
  const set = (i: number, patch: Partial<Draft>) => setRows((old) => old.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const choices = (r: Draft): SortChoices => choicesOf(r.column, header);

  // What a level orders by needs a colour or icon to be picked; the first one found is used until the user picks.
  const resolved = (r: Draft): Draft => {
    if (r.on === "value") return r;
    const c = choices(r);
    if (r.on === "cellColor") return c.fills.includes(r.color) ? r : { ...r, color: c.fills[0] ?? "none" };
    if (r.on === "fontColor") return c.fonts.includes(r.color) ? r : { ...r, color: c.fonts[0] ?? "auto" };
    return c.icons.some((i) => iconKey(i) === r.icon) ? r : { ...r, icon: iconKey(c.icons[0] ?? null) };
  };

  const save = () => {
    const out = rows.map(resolved).map((r): RangeSortLevel => {
      const base: RangeSortLevel = { column: r.column, ...(r.down ? { descending: true } : {}) };
      if (r.on === "value") return base;
      if (r.on === "icon") return { ...base, by: "icon", icon: iconOf(r.icon) };
      return { ...base, by: r.on, color: r.color };
    });
    const refused = onSave(out, header);
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup pli-sortform">
        {plainColumns && <label className="pli-ruleform-check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> My data has headers</label>}
        {rows.map((raw, i) => {
          const r = resolved(raw);
          const c = choices(r);
          const word = i === 0 ? "Sort by" : "Then by";
          const colors = r.on === "cellColor" ? c.fills : c.fonts;
          return (
            <fieldset key={i} className="pli-sortlevel" aria-label={`${word} level ${i + 1}`}>
              <div className="pli-pagesetup-trio">
                <label>
                  {word}
                  <select aria-label={`Column, level ${i + 1}`} value={r.column} onChange={(e) => set(i, { column: Number(e.target.value) })}>
                    {names.map((n, k) => <option key={k} value={k + 1}>{n}</option>)}
                  </select>
                </label>
                <label>
                  Sort on
                  <select aria-label={`Sort on, level ${i + 1}`} value={r.on} onChange={(e) => set(i, { on: e.target.value as On, color: "", icon: "" })}>
                    <option value="value">Cell values</option>
                    <option value="cellColor">Cell colour</option>
                    <option value="fontColor">Font colour</option>
                    <option value="icon">Conditional formatting icon</option>
                  </select>
                </label>
              </div>
              <div className="pli-pagesetup-trio">
                {(r.on === "cellColor" || r.on === "fontColor") && (
                  <label>
                    Colour
                    <select aria-label={`Colour, level ${i + 1}`} value={r.color} onChange={(e) => set(i, { color: e.target.value })}>
                      {colors.map((k) => <option key={k} value={k}>{colorWord(k)}</option>)}
                    </select>
                  </label>
                )}
                {r.on === "icon" && (
                  <label>
                    Icon
                    <select aria-label={`Icon, level ${i + 1}`} value={r.icon} onChange={(e) => set(i, { icon: e.target.value })}>
                      {c.icons.map((k) => (
                        <option key={iconKey(k)} value={iconKey(k)}>{k ? `${ICON_SET_LABELS[k.set]}, ${k.index + 1} of ${ICON_SETS[k.set]}` : "No cell icon"}</option>
                      ))}
                    </select>
                    {iconOf(r.icon) && <CfIcon set={iconOf(r.icon)!.set} index={iconOf(r.icon)!.index} count={ICON_SETS[iconOf(r.icon)!.set]} size={16} />}
                  </label>
                )}
                <label>
                  Order
                  <select aria-label={`Order, level ${i + 1}`} value={r.down ? "down" : "up"} onChange={(e) => set(i, { down: e.target.value === "down" })}>
                    {r.on === "value" ? (
                      <>
                        <option value="up">A to Z</option>
                        <option value="down">Z to A</option>
                      </>
                    ) : (
                      <>
                        <option value="up">On top</option>
                        <option value="down">On bottom</option>
                      </>
                    )}
                  </select>
                </label>
              </div>
              <div className="pli-sortlevel-actions">
                <button type="button" className="pli-button" aria-label={`Copy level ${i + 1}`} onClick={() => setRows((old) => [...old.slice(0, i + 1), { ...old[i]! }, ...old.slice(i + 1)])}>Copy level</button>
                <button type="button" className="pli-button" aria-label={`Move level ${i + 1} up`} disabled={i === 0} onClick={() => setRows((old) => { const n = [...old]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}>Move up</button>
                <button type="button" className="pli-button" aria-label={`Move level ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => setRows((old) => { const n = [...old]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })}>Move down</button>
                <button type="button" className="pli-button" aria-label={`Delete level ${i + 1}`} disabled={rows.length < 2} onClick={() => setRows((old) => old.filter((_, k) => k !== i))}>Delete level</button>
              </div>
            </fieldset>
          );
        })}
        <button type="button" className="pli-button" onClick={() => setRows((old) => [...old, { column: Math.min(old.length + 1, names.length), on: "value", color: "", icon: "", down: false }])}>Add level</button>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
