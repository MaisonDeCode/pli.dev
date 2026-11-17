import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";

export interface TableDialogProps {
  open: boolean;
  /** `new` asks for the cells, a name and a style; `rename` only the name. */
  mode: "new" | "rename";
  /** The cells selected, as the range to start from. */
  range: string;
  name: string;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: { range: string; name: string; headers: boolean; style: string }): string | void;
}

/** Excel's table styles, one of each colour in the three families. */
export const TABLE_STYLES: { value: string; label: string }[] = [
  { value: "TableStyleMedium2", label: "Blue, medium" },
  { value: "TableStyleMedium3", label: "Orange, medium" },
  { value: "TableStyleMedium4", label: "Gray, medium" },
  { value: "TableStyleMedium5", label: "Gold, medium" },
  { value: "TableStyleMedium6", label: "Light blue, medium" },
  { value: "TableStyleMedium7", label: "Green, medium" },
  { value: "TableStyleLight9", label: "Blue, light" },
  { value: "TableStyleLight10", label: "Orange, light" },
  { value: "TableStyleLight14", label: "Green, light" },
  { value: "TableStyleDark2", label: "Blue, dark" },
  { value: "TableStyleDark7", label: "Green, dark" },
  { value: "none", label: "No style" },
];

/** Makes a table of the selected cells, or renames one. */
export function TableDialog({ open, mode, range, name, onClose, onSave }: TableDialogProps) {
  const [form, setForm] = useState({ range: "", name: "", headers: true, style: "TableStyleMedium2" });
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm({ range, name, headers: true, style: "TableStyleMedium2" });
      setProblem(null);
    }
  }, [open, range, name]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = () => {
    const refused = onSave({ ...form, range: form.range.trim().replace(/\$/g, ""), name: form.name.trim() });
    if (refused) setProblem(refused);
  };
  return (
    <Dialog
      open={open}
      title={mode === "new" ? "Create table" : "Rename table"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{mode === "new" ? "Create" : "Done"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        {mode === "new" && (
          <>
            <label>
              Where is the data for the table?
              <input type="text" value={form.range} placeholder="A1:D20" onChange={(e) => set({ range: e.target.value })} />
            </label>
            <label className="pli-ruleform-check">
              <input type="checkbox" checked={form.headers} onChange={(e) => set({ headers: e.target.checked })} /> My table has headers
            </label>
          </>
        )}
        <label>
          Name
          <input type="text" value={form.name} placeholder={mode === "new" ? "Table1 (made for you when left empty)" : ""} onChange={(e) => set({ name: e.target.value })} />
          <span className="pli-ruleform-hint">Formulas use it: =SUM({form.name || "Table1"}[Column]). Letters, digits, _ and . only.</span>
        </label>
        {mode === "new" && (
          <label>
            Style
            <select value={form.style} onChange={(e) => set({ style: e.target.value })}>
              {TABLE_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
