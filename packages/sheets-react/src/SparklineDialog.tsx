import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { SPARKLINE_COLORS, officeThemeColors, sparkColor, type SparklineColor, type SparklineGroup, type SparklineType } from "@pli.dev/sheets";

/** What the dialog gives back: the look of the sparklines, and for new ones where they go and what they draw. */
export interface SparklineDialogResult {
  type: SparklineType;
  data?: string;
  location?: string;
  /** Every field of the look: `undefined` takes a field back to Excel's. */
  style: Partial<Omit<SparklineGroup, "id" | "items" | "type">>;
}

export interface SparklineDialogProps {
  open: boolean;
  /** The group being changed, or null for new sparklines. */
  group: SparklineGroup | null;
  /** The name of the sheet the sparklines are on (a date range on it is shown without the name). */
  sheetName?: string;
  /** The colours of the workbook's theme (ten, as `#rrggbb`) for the "colour from the theme" choices; Office's own by default. */
  palette?: readonly string[];
  /** For new ones: what to start the data and the cells with. */
  data: string;
  location: string;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: SparklineDialogResult): string | void;
  onRemove?(): void;
}

type Axis = "auto" | "group" | "custom";

const POINTS = [
  { flag: "high", color: "highColor", label: "High point" },
  { flag: "low", color: "lowColor", label: "Low point" },
  { flag: "first", color: "firstColor", label: "First point" },
  { flag: "last", color: "lastColor", label: "Last point" },
  { flag: "negative", color: "negativeColor", label: "Negative points" },
] as const;

/** The theme colours as Excel's colour picker names them, in the order a `theme` number counts them. */
const THEME_NAMES = ["White, Background 1", "Black, Text 1", "Light gray, Background 2", "Dark blue, Text 2", "Accent 1", "Accent 2", "Accent 3", "Accent 4", "Accent 5", "Accent 6", "Hyperlink", "Followed hyperlink"];
/** The shades of a theme colour Excel's picker offers. */
const SHADES: [number, string][] = [[0, "Normal"], [0.8, "Lighter 80%"], [0.6, "Lighter 60%"], [0.4, "Lighter 40%"], [-0.25, "Darker 25%"], [-0.5, "Darker 50%"]];
const sameColor = (a: SparklineColor | undefined, b: SparklineColor | undefined) => (typeof a === "string" || typeof b === "string" ? a === b : !!a && !!b && a.theme === b.theme && (a.tint ?? 0) === (b.tint ?? 0));

const DEFAULTS: Record<string, string> = { color: SPARKLINE_COLORS.series, markerColor: SPARKLINE_COLORS.marker, highColor: SPARKLINE_COLORS.high, lowColor: SPARKLINE_COLORS.low, firstColor: SPARKLINE_COLORS.first, lastColor: SPARKLINE_COLORS.last, negativeColor: SPARKLINE_COLORS.negative };

/** A reference as it is typed: without the sheet's name when it is on this sheet, and without dollar signs. */
function shortRef(ref: string, sheetName?: string): string {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.*)$/.exec(ref);
  if (!m) return ref;
  const name = (m[1] ?? m[2])!.replace(/''/g, "'");
  const cells = m[3]!.replace(/\$/g, "");
  return sheetName !== undefined && name.toLowerCase() === sheetName.toLowerCase() ? cells : `${m[1] ? `'${m[1]}'` : name}!${cells}`;
}

/** Makes sparklines for a range of data, or changes the look of the ones a cell is in. */
export function SparklineDialog({ open, group, sheetName, palette, data, location, onClose, onSave, onRemove }: SparklineDialogProps) {
  const [type, setType] = useState<SparklineType>("line");
  const [dataText, setDataText] = useState("");
  const [where, setWhere] = useState("");
  const [colors, setColors] = useState<Record<string, SparklineColor>>(DEFAULTS);
  const [dated, setDated] = useState(false);
  const [dateText, setDateText] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [weight, setWeight] = useState("0.75");
  const [empty, setEmpty] = useState<"gap" | "zero" | "span">("gap");
  const [minKind, setMinKind] = useState<Axis>("auto");
  const [maxKind, setMaxKind] = useState<Axis>("auto");
  const [minValue, setMinValue] = useState("0");
  const [maxValue, setMaxValue] = useState("10");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(group?.type ?? "line");
    setDataText(data);
    setWhere(location);
    setColors({ ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, (group?.[k as keyof SparklineGroup] as SparklineColor | undefined) ?? DEFAULTS[k]!])) });
    setDated(!!group?.dateAxis);
    setDateText(group?.dateAxis ? shortRef(group.dateAxis, sheetName) : "");
    setFlags(Object.fromEntries(["markers", "high", "low", "first", "last", "negative", "showHidden", "rightToLeft", "showAxis"].map((k) => [k, !!group?.[k as keyof SparklineGroup]])));
    setWeight(String(group?.lineWeight ?? 0.75));
    setEmpty(group?.emptyAs ?? "gap");
    setMinKind(group?.min === "group" ? "group" : typeof group?.min === "number" ? "custom" : "auto");
    setMaxKind(group?.max === "group" ? "group" : typeof group?.max === "number" ? "custom" : "auto");
    setMinValue(typeof group?.min === "number" ? String(group.min) : "0");
    setMaxValue(typeof group?.max === "number" ? String(group.max) : "10");
    setProblem(null);
  }, [open, group, data, location]);

  const flag = (k: string) => !!flags[k];
  const toggle = (k: string, on: boolean) => setFlags((f) => ({ ...f, [k]: on }));
  const axis = (kind: Axis, value: string): number | "group" | undefined => (kind === "group" ? "group" : kind === "custom" ? Number(value) : undefined);

  const save = () => {
    if (!group && (!dataText.trim() || !where.trim())) return setProblem("Say which cells hold the data and which cells the sparklines go in.");
    const style: SparklineDialogResult["style"] = {};
    const put = <K extends keyof SparklineDialogResult["style"]>(k: K, v: SparklineDialogResult["style"][K]) => {
      style[k] = v;
    };
    const changed = (k: string) => (sameColor(colors[k], DEFAULTS[k]) ? undefined : colors[k]);
    put("color", changed("color"));
    put("markerColor", type === "line" ? changed("markerColor") : undefined);
    for (const p of POINTS) put(p.color, flag(p.flag) ? changed(p.color) : undefined);
    if (dated && !dateText.trim()) return setProblem("Say which cells hold the dates.");
    put("dateAxis", dated ? dateText.trim() : undefined);
    for (const k of ["markers", "high", "low", "first", "last", "negative", "showHidden", "rightToLeft", "showAxis"] as const) put(k, flag(k) && (k !== "markers" || type === "line") ? true : undefined);
    const w = Number(weight);
    put("lineWeight", type === "line" && w !== 0.75 ? w : undefined);
    put("emptyAs", empty === "gap" ? undefined : empty);
    put("min", axis(minKind, minValue));
    put("max", axis(maxKind, maxValue));
    if (Number.isNaN(Number(minValue)) || Number.isNaN(Number(maxValue)) || Number.isNaN(w)) return setProblem("The thickness and the least and most are numbers.");
    const refused = onSave({ type, style, ...(group ? {} : { data: dataText.trim(), location: where.trim() }) });
    if (refused) setProblem(refused);
  };

  const colorBox = (key: string, label: string) => {
    const value = colors[key] ?? DEFAULTS[key]!;
    const theme = typeof value === "object" ? value : null;
    const set = (c: SparklineColor) => setColors((all) => ({ ...all, [key]: c }));
    return (
      <div className="pli-sparkcolor">
        <label className="pli-ruleform-check">
          <input type="color" aria-label={label} value={sparkColor(value, DEFAULTS[key]!, palette)} onChange={(e) => set(e.target.value)} /> {label}
        </label>
        <select aria-label={`${label}: colour of the theme`} value={theme ? String(theme.theme) : "custom"} onChange={(e) => (e.target.value === "custom" ? set(sparkColor(value, DEFAULTS[key]!, palette)) : set({ theme: Number(e.target.value), ...(theme?.tint ? { tint: theme.tint } : {}) }))}>
          <option value="custom">A colour of your own</option>
          {THEME_NAMES.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
        {theme && (
          <select aria-label={`${label}: shade`} value={String(theme.tint ?? 0)} onChange={(e) => set({ theme: theme.theme, ...(Number(e.target.value) ? { tint: Number(e.target.value) } : {}) })}>
            {SHADES.map(([tint, name]) => (
              <option key={tint} value={tint}>{name}</option>
            ))}
          </select>
        )}
      </div>
    );
  };
  const axisRow = (name: "Least" | "Most", kind: Axis, setKind: (k: Axis) => void, value: string, setValue: (v: string) => void) => (
    <div className="pli-pagesetup-trio">
      <label>
        {name} on the axis
        <select aria-label={`${name} on the axis`} value={kind} onChange={(e) => setKind(e.target.value as Axis)}>
          <option value="auto">Each sparkline's own</option>
          <option value="group">The same for all of them</option>
          <option value="custom">A number</option>
        </select>
      </label>
      {kind === "custom" && <input type="number" aria-label={`${name} value`} value={value} onChange={(e) => setValue(e.target.value)} />}
    </div>
  );

  return (
    <Dialog
      open={open}
      title={group ? "Sparklines" : "Insert sparklines"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          {group && onRemove && <button type="button" className="pli-button" onClick={onRemove}>Remove sparklines</button>}
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{group ? "Save" : "Insert"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup">
        <fieldset>
          <legend>Kind</legend>
          {(["line", "column", "winloss"] as const).map((t) => (
            <label key={t} className="pli-ruleform-check">
              <input type="radio" name="sparktype" checked={type === t} onChange={() => setType(t)} /> {t === "line" ? "Line" : t === "column" ? "Column" : "Win/loss"}
            </label>
          ))}
        </fieldset>
        {!group && (
          <fieldset>
            <legend>Where</legend>
            <label>
              Data range (a row or column for each sparkline)
              <input type="text" aria-label="Data range" value={dataText} placeholder="B2:E6" onChange={(e) => setDataText(e.target.value)} />
            </label>
            <label>
              Cells for the sparklines
              <input type="text" aria-label="Location range" value={where} placeholder="F2:F6" onChange={(e) => setWhere(e.target.value)} />
            </label>
          </fieldset>
        )}
        <fieldset>
          <legend>Look</legend>
          {colorBox("color", type === "line" ? "Line colour" : "Column colour")}
          {type === "line" && (
            <>
              <label className="pli-ruleform-check"><input type="checkbox" checked={flag("markers")} onChange={(e) => toggle("markers", e.target.checked)} /> Dot on every point</label>
              {flag("markers") && colorBox("markerColor", "Dot colour")}
              <label>
                Line thickness (points)
                <input type="number" aria-label="Line thickness" step="0.25" min="0.25" max="6" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </label>
            </>
          )}
          {POINTS.map((p) => (
            <div key={p.flag}>
              <label className="pli-ruleform-check"><input type="checkbox" checked={flag(p.flag)} onChange={(e) => toggle(p.flag, e.target.checked)} /> {p.label}</label>
              {flag(p.flag) && colorBox(p.color, `${p.label} colour`)}
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>Data</legend>
          <label>
            Empty cells
            <select aria-label="Empty cells" value={empty} onChange={(e) => setEmpty(e.target.value as typeof empty)}>
              <option value="gap">Leave a gap</option>
              <option value="zero">Count as zero</option>
              <option value="span">Connect across</option>
            </select>
          </label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={flag("showHidden")} onChange={(e) => toggle("showHidden", e.target.checked)} /> Show data in hidden rows and columns</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={flag("rightToLeft")} onChange={(e) => toggle("rightToLeft", e.target.checked)} /> Draw from right to left</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={flag("showAxis")} onChange={(e) => toggle("showAxis", e.target.checked)} /> Show a line along zero</label>
          <label className="pli-ruleform-check"><input type="checkbox" aria-label="Plot by date" checked={dated} onChange={(e) => setDated(e.target.checked)} /> Plot the points by date</label>
          {dated && (
            <label>
              Dates (a row or column, one for each point)
              <input type="text" aria-label="Date range" value={dateText} placeholder="B1:I1" onChange={(e) => setDateText(e.target.value)} />
            </label>
          )}
          {axisRow("Least", minKind, setMinKind, minValue, setMinValue)}
          {axisRow("Most", maxKind, setMaxKind, maxValue, setMaxValue)}
        </fieldset>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
