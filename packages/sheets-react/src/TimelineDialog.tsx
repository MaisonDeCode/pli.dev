import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { TIMELINE_LEVELS, type TimelineLevel } from "@pli.dev/sheets";
import { TIMELINE_STYLES, timelineLevelWord } from "./TableTimelineView";

export interface TimelineDialogTable {
  id: string;
  name: string;
  /** The columns that hold dates. */
  dateColumns: string[];
}

export type TimelineDialogResult = { table: string; column: string; level: TimelineLevel } | { caption: string; level: TimelineLevel; style: string };

export interface TimelineDialogProps {
  open: boolean;
  /** `insert` makes a timeline for a column of dates; `settings` changes one that is there. */
  mode: "insert" | "settings";
  /** The tables with a column of dates, and the one to start with. */
  tables: TimelineDialogTable[];
  start?: string | undefined;
  settings?: { caption: string; level: TimelineLevel; style: string; column: string } | undefined;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: TimelineDialogResult): string | void;
}

/** Makes a timeline for a column of dates in a table, or changes the heading, periods and style of one. */
export function TimelineDialog({ open, mode, tables, start, settings, onClose, onSave }: TimelineDialogProps) {
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [caption, setCaption] = useState("");
  const [level, setLevel] = useState<TimelineLevel>("months");
  const [style, setStyle] = useState("TimeSlicerStyleLight1");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const first = tables.find((t) => t.id === start) ?? tables[0];
    setTable(first?.id ?? "");
    setColumn(first?.dateColumns[0] ?? "");
    setCaption(settings?.caption ?? "");
    setLevel(settings?.level ?? "months");
    setStyle(settings?.style ?? "TimeSlicerStyleLight1");
    setProblem(null);
  }, [open, start, tables, settings]);
  const current = tables.find((t) => t.id === table);
  const save = () => {
    const refused = mode === "insert" ? (column ? onSave({ table, column, level }) : "Pick a column of dates.") : onSave({ caption: caption.trim(), level, style });
    if (refused) setProblem(refused);
  };
  return (
    <Dialog
      open={open}
      title={mode === "insert" ? "Insert timeline" : `Timeline settings${settings ? `: ${settings.column}` : ""}`}
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
        {mode === "insert" &&
          (tables.length === 0 ? (
            <p className="pli-ruleform-hint">There is no table with a column of dates. Make one first (Format › Table), with dates formatted as dates.</p>
          ) : (
            <>
              <label>
                Table
                <select value={table} onChange={(e) => { setTable(e.target.value); setColumn(tables.find((t) => t.id === e.target.value)?.dateColumns[0] ?? ""); }}>
                  {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label>
                Column of dates
                <select value={column} onChange={(e) => setColumn(e.target.value)}>
                  {current?.dateColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </>
          ))}
        {mode === "settings" && (
          <label>
            Heading
            <input type="text" value={caption} placeholder={settings?.column ?? ""} onChange={(e) => setCaption(e.target.value)} />
          </label>
        )}
        <label>
          Periods
          <select value={level} onChange={(e) => setLevel(e.target.value as TimelineLevel)}>
            {TIMELINE_LEVELS.map((l) => <option key={l} value={l}>{timelineLevelWord(l)[0] + timelineLevelWord(l).slice(1).toLowerCase()}</option>)}
          </select>
        </label>
        {mode === "settings" && (
          <label>
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {TIMELINE_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
