import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { SLICER_STYLE_PARTS, type ConditionalStyle, type Slicer, type SlicerStyleDef, type SlicerStylePart } from "@pli.dev/sheets";
import { SlicerView, type SlicerItem } from "./SlicerView";

const LABELS: Record<SlicerStylePart, string> = {
  wholeTable: "Whole slicer",
  headerRow: "Header",
  selectedItemWithData: "Selected item with data",
  unselectedItemWithData: "Unselected item with data",
  selectedItemWithNoData: "Selected item with no data",
  unselectedItemWithNoData: "Unselected item with no data",
  hoveredSelectedItemWithData: "Hovered selected item with data",
  hoveredUnselectedItemWithData: "Hovered unselected item with data",
  hoveredSelectedItemWithNoData: "Hovered selected item with no data",
  hoveredUnselectedItemWithNoData: "Hovered unselected item with no data",
};

export interface SlicerStyleDialogProps {
  open: boolean;
  /** The style being changed, or the one a new style starts from. */
  initial: { name: string; def: SlicerStyleDef; isNew: boolean } | null;
  /** The styles to start a new one from: Excel's names and your own. */
  startFrom: { value: string; label: string; def: SlicerStyleDef }[];
  /** Names that are taken (not counting the one being changed). */
  taken: string[];
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(name: string, def: SlicerStyleDef): string | void;
}

const PREVIEW: Slicer = { id: "preview", table: "", column: "Region", caption: "Region", from: { row: 1, col: 1 }, width: 220, height: 380 };
const item = (value: string, selected: boolean, available: boolean): SlicerItem => ({ value, count: 1, selected, available });
const ITEMS: Record<SlicerStylePart, SlicerItem | null> = {
  wholeTable: null,
  headerRow: null,
  selectedItemWithData: item("Selected", true, true),
  unselectedItemWithData: item("Unselected", false, true),
  selectedItemWithNoData: item("Selected, no data", true, false),
  unselectedItemWithNoData: item("Unselected, no data", false, false),
  hoveredSelectedItemWithData: item("Hover selected", true, true),
  hoveredUnselectedItemWithData: item("Hover unselected", false, true),
  hoveredSelectedItemWithNoData: item("Hover selected, no data", true, false),
  hoveredUnselectedItemWithNoData: item("Hover unselected, no data", false, false),
};
const LIST = SLICER_STYLE_PARTS.map((p) => ITEMS[p]).filter((x): x is SlicerItem => x !== null);
const HOVERED = LIST.filter((x) => x.value.startsWith("Hover")).map((x) => x.value);

/** Makes a slicer style of your own, or changes one: a look for the slicer, its heading and each kind of button, with a sample that follows the changes. */
export function SlicerStyleDialog({ open, initial, startFrom, taken, onClose, onSave }: SlicerStyleDialogProps) {
  const [name, setName] = useState("");
  const [def, setDef] = useState<SlicerStyleDef>({});
  const [part, setPart] = useState<SlicerStylePart>("selectedItemWithData");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !initial) return;
    setName(initial.name);
    setDef(initial.def);
    setPart("selectedItemWithData");
    setProblem(null);
  }, [open, initial]);

  const look: ConditionalStyle = def[part] ?? {};
  const patch = (change: Partial<ConditionalStyle>) =>
    setDef((d) => {
      const next: ConditionalStyle = { ...d[part], ...change };
      for (const k of Object.keys(next) as (keyof ConditionalStyle)[]) if (next[k] === undefined || next[k] === false) delete next[k];
      const out = { ...d };
      if (Object.keys(next).length) out[part] = next;
      else delete out[part];
      return out;
    });
  const preview = useMemo(() => def, [def]);

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
      title={initial?.isNew ? "New slicer style" : "Slicer style"}
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
            <select defaultValue="" aria-label="Start from" onChange={(e) => { const from = startFrom.find((s) => s.value === e.target.value); setDef(from ? structuredClone(from.def) : {}); }}>
              <option value="">Nothing</option>
              {startFrom.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        <label>
          Part
          <select aria-label="Part" value={part} onChange={(e) => setPart(e.target.value as SlicerStylePart)}>
            {SLICER_STYLE_PARTS.map((p) => <option key={p} value={p}>{LABELS[p]}</option>)}
          </select>
        </label>
        <div className="pli-pagesetup-trio">
          <label>
            Text colour
            <input type="color" aria-label="Text colour" value={look.color ?? "#000000"} onChange={(e) => patch({ color: e.target.value })} />
          </label>
          <label>
            Fill
            <input type="color" aria-label="Fill" value={look.fill ?? "#ffffff"} onChange={(e) => patch({ fill: e.target.value })} />
          </label>
        </div>
        <div>
          <label className="pli-ruleform-check"><input type="checkbox" aria-label="Bold" checked={!!look.bold} onChange={(e) => patch({ bold: e.target.checked })} /> Bold</label>
          <label className="pli-ruleform-check"><input type="checkbox" aria-label="Italic" checked={!!look.italic} onChange={(e) => patch({ italic: e.target.checked })} /> Italic</label>
          <button type="button" className="pli-button" aria-label="Clear this part" onClick={() => setDef((d) => { const out = { ...d }; delete out[part]; return out; })}>Clear this part</button>
        </div>
        <div className="pli-stylebuilder-sample" style={{ width: PREVIEW.width, height: PREVIEW.height, position: "relative" }}>
          <SlicerView slicer={PREVIEW} look={preview} hovered={HOVERED} items={LIST} width={PREVIEW.width} height={PREVIEW.height} scroll={0} filtered />
        </div>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
