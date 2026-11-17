import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";

export interface SlicerDialogTable {
  id: string;
  name: string;
  columns: string[];
}

/** What the dialog gives back: new slicers for these columns of a table, or the changed settings of one slicer. */
export type SlicerDialogResult = { table: string; columns: string[] } | { caption: string; columns: number; style: string };

export interface SlicerDialogProps {
  open: boolean;
  /** `insert` picks the columns to make slicers for; `settings` changes one that is there. */
  mode: "insert" | "settings";
  /** The tables a slicer can filter (those with a header row), and the one to start with. */
  tables: SlicerDialogTable[];
  start?: string | undefined;
  settings?: { caption: string; columns: number; style: string; column: string } | undefined;
  /** The names of slicer styles of your own. */
  custom?: string[] | undefined;
  /** Called to make a slicer style of your own (`name` missing) or change one; the dialog closes first and the style is given to this slicer. */
  onStyle?: ((name?: string) => void) | undefined;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: SlicerDialogResult): string | void;
}

/** Excel's slicer styles, a light and a dark one of each colour. */
export const SLICER_STYLES: { value: string; label: string }[] = [
  { value: "SlicerStyleLight1", label: "Blue, light" },
  { value: "SlicerStyleLight2", label: "Orange, light" },
  { value: "SlicerStyleLight3", label: "Gray, light" },
  { value: "SlicerStyleLight4", label: "Gold, light" },
  { value: "SlicerStyleLight5", label: "Light blue, light" },
  { value: "SlicerStyleLight6", label: "Green, light" },
  { value: "SlicerStyleDark1", label: "Blue, dark" },
  { value: "SlicerStyleDark2", label: "Orange, dark" },
  { value: "SlicerStyleDark3", label: "Gray, dark" },
  { value: "SlicerStyleDark4", label: "Gold, dark" },
  { value: "SlicerStyleDark5", label: "Light blue, dark" },
  { value: "SlicerStyleDark6", label: "Green, dark" },
];

/** Makes slicers for columns of a table, or changes the heading, columns and style of one. */
export function SlicerDialog({ open, mode, tables, start, settings, custom = [], onStyle, onClose, onSave }: SlicerDialogProps) {
  const [table, setTable] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [columns, setColumns] = useState(1);
  const [style, setStyle] = useState("SlicerStyleLight1");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTable(start ?? tables[0]?.id ?? "");
    setPicked([]);
    setCaption(settings?.caption ?? "");
    setColumns(settings?.columns ?? 1);
    setStyle(settings?.style ?? "SlicerStyleLight1");
    setProblem(null);
  }, [open, start, tables, settings]);
  const current = tables.find((t) => t.id === table);
  const save = () => {
    const refused =
      mode === "insert"
        ? picked.length
          ? onSave({ table, columns: current!.columns.filter((c) => picked.includes(c)) })
          : "Pick the columns to make slicers for."
        : onSave({ caption: caption.trim(), columns, style });
    if (refused) setProblem(refused);
  };
  return (
    <Dialog
      open={open}
      title={mode === "insert" ? "Insert slicers" : `Slicer settings${settings ? `: ${settings.column}` : ""}`}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{mode === "insert" ? "Insert" : "Done"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        {mode === "insert" ? (
          <>
            {tables.length === 0 ? (
              <p className="pli-ruleform-hint">There is no table to filter. Make one first (Format › Table), with a header row.</p>
            ) : (
              <>
                <label>
                  Table
                  <select value={table} onChange={(e) => { setTable(e.target.value); setPicked([]); }}>
                    {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <fieldset>
                  <legend>Columns</legend>
                  {current?.columns.map((c) => (
                    <label key={c} className="pli-ruleform-check">
                      <input type="checkbox" checked={picked.includes(c)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))} /> {c}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
          </>
        ) : (
          <>
            <label>
              Heading
              <input type="text" value={caption} placeholder={settings?.column ?? ""} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <label>
              Columns of buttons
              <input type="number" min={1} max={20} value={columns} onChange={(e) => setColumns(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </label>
            <label>
              Style
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {SLICER_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                {custom.length > 0 && <optgroup label="Your own">{custom.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
              </select>
            </label>
            {onStyle && (
              <div>
                <button type="button" className="pli-button" onClick={() => onStyle()}>New slicer style…</button>
                <button type="button" className="pli-button" disabled={!custom.includes(style)} onClick={() => onStyle(style)}>Edit this style…</button>
              </div>
            )}
          </>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
