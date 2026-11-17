import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Dialog } from "@pli.dev/react";
import { BORDER_STYLES, tableLook, type Border, type BorderStyle, type ConditionalStyle, type Sheet, type TableStyleBorders, type TableStyleDef, type TableStylePart } from "@pli.dev/sheets";

type Part = Exclude<keyof TableStyleDef, "rowStripeSize" | "columnStripeSize">;

const PARTS: { key: Part; label: string }[] = [
  { key: "wholeTable", label: "Whole table" },
  { key: "headerRow", label: "Header row" },
  { key: "totalRow", label: "Total row" },
  { key: "firstColumn", label: "First column" },
  { key: "lastColumn", label: "Last column" },
  { key: "firstRowStripe", label: "First row stripe" },
  { key: "secondRowStripe", label: "Second row stripe" },
  { key: "firstColumnStripe", label: "First column stripe" },
  { key: "secondColumnStripe", label: "Second column stripe" },
  { key: "firstHeaderCell", label: "First header cell" },
  { key: "lastHeaderCell", label: "Last header cell" },
  { key: "firstTotalCell", label: "First total cell" },
  { key: "lastTotalCell", label: "Last total cell" },
];

const SIDES = ["top", "bottom", "left", "right", "horizontal", "vertical"] as const;
const SIDE_LABELS: Record<(typeof SIDES)[number], string> = { top: "Top line", bottom: "Bottom line", left: "Left line", right: "Right line", horizontal: "Line between rows", vertical: "Line between columns" };

export interface TableStyleDialogProps {
  open: boolean;
  /** The style being changed, or the one a new style starts from (empty for a plain start). */
  initial: { name: string; def: TableStyleDef; isNew: boolean; was?: string } | null;
  /** The styles to start a new one from: Excel's names and your own. */
  startFrom: { value: string; label: string; def: TableStyleDef }[];
  /** Names that are taken (not counting the one being changed). */
  taken: string[];
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(name: string, def: TableStyleDef): string | void;
}

const cssBorder = (b: Border | undefined): string | undefined => {
  if (!b) return undefined;
  const width = b.style === "thick" ? 3 : b.style === "medium" || b.style === "double" ? 2 : 1;
  const line = b.style === "dashed" ? "dashed" : b.style === "dotted" || b.style === "hair" ? "dotted" : b.style === "double" ? "double" : "solid";
  return `${b.style === "double" ? 3 : width}px ${line} ${b.color}`;
};

/** A look for the preview, as the grid draws it. */
function cssOf(look: ConditionalStyle | undefined): CSSProperties {
  if (!look) return {};
  const border = look.border;
  return {
    ...(look.bold ? { fontWeight: 700 } : {}),
    ...(look.italic ? { fontStyle: "italic" } : {}),
    ...(look.underline || look.strike ? { textDecoration: [look.underline ? "underline" : "", look.strike ? "line-through" : ""].filter(Boolean).join(" ") } : {}),
    ...(look.color ? { color: look.color } : {}),
    ...(look.fill ? { background: look.fill } : {}),
    ...(border?.top ? { borderTop: cssBorder(border.top) } : {}),
    ...(border?.bottom ? { borderBottom: cssBorder(border.bottom) } : {}),
    ...(border?.left ? { borderLeft: cssBorder(border.left) } : {}),
    ...(border?.right ? { borderRight: cssBorder(border.right) } : {}),
  };
}

const sample = (flags: { bandedRows: boolean; bandedColumns: boolean; firstColumn: boolean; lastColumn: boolean }): Sheet => ({
  id: "preview",
  name: "Preview",
  cells: {},
  tables: [{ id: "t", name: "Preview", range: "A1:D7", totals: true, style: "Preview", ...(flags.bandedRows ? {} : { bandedRows: false as const }), ...(flags.bandedColumns ? { bandedColumns: true as const } : {}), ...(flags.firstColumn ? { firstColumn: true as const } : {}), ...(flags.lastColumn ? { lastColumn: true as const } : {}) }],
});

/** Makes a table style of your own, or changes one: a look for each part of a table, with a sample that follows the changes. */
export function TableStyleDialog({ open, initial, startFrom, taken, onClose, onSave }: TableStyleDialogProps) {
  const [name, setName] = useState("");
  const [def, setDef] = useState<TableStyleDef>({});
  const [part, setPart] = useState<Part>("headerRow");
  const [flags, setFlags] = useState({ bandedRows: true, bandedColumns: false, firstColumn: false, lastColumn: false });
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !initial) return;
    setName(initial.name);
    setDef(initial.def);
    setPart("headerRow");
    setFlags({ bandedRows: true, bandedColumns: false, firstColumn: false, lastColumn: false });
    setProblem(null);
  }, [open, initial]);

  const look: TableStylePart = def[part] ?? {};
  const patch = (change: Partial<TableStylePart>) =>
    setDef((d) => {
      const next: TableStylePart = { ...d[part], ...change };
      for (const k of Object.keys(next) as (keyof TableStylePart)[]) if (next[k] === undefined || next[k] === false) delete next[k];
      const out = { ...d };
      if (Object.keys(next).length) out[part] = next;
      else delete out[part];
      return out;
    });
  const side = (s: (typeof SIDES)[number]): Border | undefined => look.border?.[s];
  const setSide = (s: (typeof SIDES)[number], style: BorderStyle | "", color?: string) => {
    const border: TableStyleBorders = { ...look.border };
    if (style === "") delete border[s];
    else border[s] = { style, color: color ?? border[s]?.color ?? "#000000" };
    patch({ border: Object.keys(border).length ? border : undefined });
  };

  const preview = useMemo(() => sample(flags), [flags]);
  const styles = useMemo(() => ({ Preview: def }), [def]);
  const rows = [0, 1, 2, 3, 4, 5, 6];
  const cols = [0, 1, 2, 3];

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return setProblem("Give the style a name.");
    if (taken.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return setProblem(`There is a style called "${trimmed}" already.`);
    const refused = onSave(trimmed, def);
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title={initial?.isNew ? "New table style" : "Table style"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-stylebuilder">
        <label>
          Name
          <input type="text" value={name} readOnly={!initial?.isNew} onChange={(e) => setName(e.target.value)} />
        </label>
        {initial?.isNew && Object.keys(initial.def).length === 0 && startFrom.length > 0 && (
          <label>
            Start from
            <select defaultValue="" onChange={(e) => { const from = startFrom.find((s) => s.value === e.target.value); setDef(from ? structuredClone(from.def) : {}); }}>
              <option value="">Nothing</option>
              {startFrom.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        <div className="pli-stylebuilder-body">
          <ul className="pli-stylebuilder-parts" role="listbox" aria-label="Parts of the table">
            {PARTS.map((p) => (
              <li key={p.key} role="option" aria-selected={part === p.key}>
                <button type="button" data-active={part === p.key ? "" : undefined} data-set={def[p.key] ? "" : undefined} onClick={() => setPart(p.key)}>{p.label}</button>
              </li>
            ))}
          </ul>
          <div className="pli-stylebuilder-edit" role="group" aria-label={PARTS.find((p) => p.key === part)!.label}>
            <div className="pli-ruleform-style">
              <label>
                <input type="checkbox" aria-label="Fill" checked={look.fill !== undefined} onChange={(e) => patch({ fill: e.target.checked ? "#dbe5f1" : undefined })} /> Fill
                {look.fill !== undefined && <input type="color" aria-label="Fill color" value={look.fill} onChange={(e) => patch({ fill: e.target.value })} />}
              </label>
              <label>
                <input type="checkbox" aria-label="Text color" checked={look.color !== undefined} onChange={(e) => patch({ color: e.target.checked ? "#1f2937" : undefined })} /> Text
                {look.color !== undefined && <input type="color" aria-label="Text color value" value={look.color} onChange={(e) => patch({ color: e.target.value })} />}
              </label>
              <label><input type="checkbox" aria-label="Bold" checked={!!look.bold} onChange={(e) => patch({ bold: e.target.checked || undefined })} /> Bold</label>
              <label><input type="checkbox" aria-label="Italic" checked={!!look.italic} onChange={(e) => patch({ italic: e.target.checked || undefined })} /> Italic</label>
            </div>
            <div className="pli-stylebuilder-lines">
              {SIDES.map((s) => (
                <label key={s}>
                  {SIDE_LABELS[s]}
                  <select aria-label={SIDE_LABELS[s].toLowerCase()} value={side(s)?.style ?? ""} onChange={(e) => setSide(s, e.target.value as BorderStyle | "")}>
                    <option value="">None</option>
                    {BORDER_STYLES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  {side(s) && <input type="color" aria-label={`${SIDE_LABELS[s].toLowerCase()} color`} value={side(s)!.color} onChange={(e) => setSide(s, side(s)!.style, e.target.value)} />}
                </label>
              ))}
            </div>
            {(part === "firstRowStripe" || part === "secondRowStripe") && (
              <label>
                Rows in a stripe
                <input type="number" min={1} max={9} value={def.rowStripeSize ?? 1} onChange={(e) => setDef((d) => ({ ...d, rowStripeSize: Math.max(1, Math.min(9, Number(e.target.value) || 1)) }))} />
              </label>
            )}
            {(part === "firstColumnStripe" || part === "secondColumnStripe") && (
              <label>
                Columns in a stripe
                <input type="number" min={1} max={9} value={def.columnStripeSize ?? 1} onChange={(e) => setDef((d) => ({ ...d, columnStripeSize: Math.max(1, Math.min(9, Number(e.target.value) || 1)) }))} />
              </label>
            )}
            <p className="pli-ruleform-hint">The top, bottom, left and right lines are the edges of the part; the lines between rows and columns run inside it. Excel keeps all six.</p>
          </div>
        </div>
        <fieldset className="pli-stylebuilder-preview">
          <legend>Sample</legend>
          <div className="pli-ruleform-style">
            <label><input type="checkbox" checked={flags.bandedRows} onChange={(e) => setFlags((f) => ({ ...f, bandedRows: e.target.checked }))} /> Banded rows</label>
            <label><input type="checkbox" checked={flags.bandedColumns} onChange={(e) => setFlags((f) => ({ ...f, bandedColumns: e.target.checked }))} /> Banded columns</label>
            <label><input type="checkbox" checked={flags.firstColumn} onChange={(e) => setFlags((f) => ({ ...f, firstColumn: e.target.checked }))} /> First column</label>
            <label><input type="checkbox" checked={flags.lastColumn} onChange={(e) => setFlags((f) => ({ ...f, lastColumn: e.target.checked }))} /> Last column</label>
          </div>
          <table className="pli-stylebuilder-sample" aria-label="Sample table">
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  {cols.map((c) => (
                    <td key={c} style={cssOf(tableLook(preview, r + 1, c + 1, styles))}>
                      {r === 0 ? ["Item", "Qty", "Price", "Total"][c] : r === 6 ? (c === 0 ? "Total" : c === 3 ? "42" : "") : c === 0 ? `Row ${r}` : r * (c + 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
