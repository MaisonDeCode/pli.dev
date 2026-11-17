import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { FILTER_DATE_PERIODS, FILTER_PERIOD_WORDS, PIVOT_ALONG, PIVOT_FUNCTIONS, PIVOT_FUNCTION_NAMES, PIVOT_NEEDS_ITEM, PIVOT_STYLE_NAMES, type FilterTest, type FilterDatePeriod, type FilterTestOp, type Pivot, type PivotAxisField, type PivotCalculatedField, type PivotCalculatedItem, type PivotFieldFilter, type PivotFilter, type PivotFunction, type PivotGroup, type PivotGroupBy, type PivotRange, type PivotShowAs, type PivotSlicer, type PivotStyle, type PivotTimeline, type PivotValue } from "@pli.dev/sheets";

/** What the dialog gives back. For a new pivot table, `sheet` (a sheet's name, or "" for a new one) and `anchor` say where it goes. */
export interface PivotDialogResult {
  name: string;
  source: string;
  sheet?: string;
  anchor?: string;
  rows: PivotAxisField[];
  columns: PivotAxisField[];
  values: PivotValue[];
  filters: PivotFilter[];
  calculated: PivotCalculatedField[];
  calculatedItems: PivotCalculatedItem[];
  /** The source and the other ranges to combine (Excel's several ranges), or undefined for one range. */
  ranges: PivotRange[] | undefined;
  style: PivotStyle | undefined;
  /** The slicers and timelines to keep (those with an id are there already) and to add (just a field). */
  slicers: (Partial<PivotSlicer> & { field: string })[];
  timelines: (Partial<PivotTimeline> & { field: string })[];
  tabular: boolean;
  outline: boolean;
  repeatLabels: boolean;
  valuesOnRows: boolean;
  autoRefresh: boolean;
  grandTotalRows: boolean;
  grandTotalColumns: boolean;
  /** For a pivot table made from several ranges: how many page fields (0 to 4). */
  pageFields?: number;
}

export interface PivotDialogProps {
  open: boolean;
  /** The pivot table being changed, or null for a new one. */
  pivot: Pivot | null;
  /** For a new one: what to start the source with. */
  source: string;
  sheets: readonly string[];
  /** The field names a source has, or null when it isn't a range or table with names in its first row. */
  fieldsOf(source: string): string[] | null;
  /** The items of one field of a source, as they show (grouped, if a group is given). */
  itemsOf(source: string, field: string, group?: PivotGroup): string[];
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: PivotDialogResult): string | void;
  onRemove?(): void;
  onRefresh?(): void;
  /** The names of the pivot table styles of your own, offered with Excel's. */
  pivotStyles?: readonly string[];
}

type Area = "filters" | "columns" | "rows" | "values";
const AREAS: { area: Area; label: string }[] = [
  { area: "filters", label: "Filters" },
  { area: "columns", label: "Columns" },
  { area: "rows", label: "Rows" },
  { area: "values", label: "Values" },
];

const FUNCTION_LABELS: Record<PivotFunction, string> = {
  sum: "Sum",
  count: "Count",
  countNums: "Count numbers",
  average: "Average",
  max: "Max",
  min: "Min",
  product: "Product",
  stdDev: "Standard deviation",
  stdDevp: "Standard deviation (population)",
  var: "Variance",
  varp: "Variance (population)",
  distinctCount: "Distinct count",
};
const SHOW_AS: { value: "" | PivotShowAs; label: string }[] = [
  { value: "", label: "No calculation" },
  { value: "percentOfTotal", label: "% of grand total" },
  { value: "percentOfRow", label: "% of row total" },
  { value: "percentOfColumn", label: "% of column total" },
  { value: "percentOfParentRow", label: "% of parent row total" },
  { value: "percentOfParentColumn", label: "% of parent column total" },
  { value: "differenceFromPrevious", label: "Difference from the previous item" },
  { value: "percentDifferenceFromPrevious", label: "% difference from the previous item" },
  { value: "differenceFrom", label: "Difference from…" },
  { value: "percentOf", label: "% of…" },
  { value: "percentDifferenceFrom", label: "% difference from…" },
  { value: "runningTotal", label: "Running total" },
  { value: "percentRunningTotal", label: "% running total" },
  { value: "rankAscending", label: "Rank, smallest first" },
  { value: "rankDescending", label: "Rank, largest first" },
  { value: "index", label: "Index" },
];

const GROUPS: { value: string; label: string }[] = [
  { value: "", label: "No grouping" },
  { value: "years", label: "Dates by year" },
  { value: "quarters", label: "Dates by quarter" },
  { value: "months", label: "Dates by month" },
  { value: "days", label: "Dates by day" },
  { value: "dayRange", label: "Dates in ranges of days" },
  { value: "hours", label: "Times by hour" },
  { value: "minutes", label: "Times by minute" },
  { value: "seconds", label: "Times by second" },
  { value: "number", label: "Numbers in ranges" },
  { value: "items", label: "Items you pick" },
];
/** The parts a date can also be grouped by, in addition to the one it is (years and months together). */
const ALSO: PivotGroupBy[] = ["years", "quarters", "months", "days", "hours", "minutes", "seconds"];
const STYLE_FAMILIES = ["Light", "Medium", "Dark"] as const;

const TEST_OPS: { op: FilterTestOp; label: string }[] = [
  { op: "equals", label: "equals" },
  { op: "notEquals", label: "does not equal" },
  { op: "greaterThan", label: "is greater than" },
  { op: "greaterThanOrEqual", label: "is greater than or equal to" },
  { op: "lessThan", label: "is less than" },
  { op: "lessThanOrEqual", label: "is less than or equal to" },
  { op: "contains", label: "contains" },
  { op: "notContains", label: "does not contain" },
  { op: "beginsWith", label: "begins with" },
  { op: "endsWith", label: "ends with" },
];
const asTest = (op: FilterTestOp, text: string, numeric: boolean): FilterTest => ({ op, value: numeric && text.trim() !== "" && !Number.isNaN(Number(text)) ? Number(text) : text });

type Layout = "compact" | "outline" | "tabular";

/** A filter as the dialog holds it: `null` for every item. */
interface FilterDraft {
  field: string;
  items: string[] | null;
}

/**
 * A second filter on a field, of the other kind: a field with a label filter can also have a value filter, and the other way
 * round (Excel's "Allow multiple filters per field"). The items picked in the list below are a third thing that applies as well.
 */
function ExtraFilter({ field, first, current, valueLabels, hasValues, onChange }: { field: string; first: PivotFieldFilter; current: PivotFieldFilter | undefined; valueLabels: string[]; hasValues: boolean; onChange(next: PivotFieldFilter | undefined): void }) {
  const firstIsLabel = first.kind === "label" || first.kind === "date";
  const kind = !current ? "" : current.kind === "top" ? (current.bottom ? "bottom" : "top") : current.kind;
  return (
    <div className="pli-pagesetup-trio">
      <label>
        And also
        <select
          aria-label={`Second filter on ${field}`}
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "") onChange(undefined);
            else if (k === "label") onChange({ kind: "label", a: { op: "contains", value: "" } });
            else if (k === "top" || k === "bottom") onChange({ kind: "top", by: 0, n: 10, ...(k === "bottom" ? { bottom: true as const } : {}) });
            else onChange({ kind: "value", by: 0, a: { op: "greaterThan", value: 0 } });
          }}
        >
          <option value="">No second filter</option>
          {!firstIsLabel ? <option value="label">Items whose label…</option> : null}
          {firstIsLabel && hasValues ? <option value="value">Items whose value…</option> : null}
          {firstIsLabel && hasValues ? <option value="top">Top items</option> : null}
          {firstIsLabel && hasValues ? <option value="bottom">Bottom items</option> : null}
        </select>
      </label>
      {current && (current.kind === "label" || current.kind === "value") && (
        <>
          {current.kind === "value" && (
            <label>
              Value
              <select aria-label={`${field} second filter by value`} value={String(current.by)} onChange={(e) => onChange({ ...current, by: Number(e.target.value) })}>
                {valueLabels.map((label, k) => (
                  <option key={k} value={String(k)}>{label}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Test
            <select aria-label={`${field} second filter test`} value={current.a.op} onChange={(e) => onChange({ ...current, a: asTest(e.target.value as FilterTestOp, String(current.a.value ?? ""), current.kind === "value") })}>
              {TEST_OPS.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
          </label>
          <label>
            Text or number
            <input type="text" aria-label={`${field} second filter text`} value={String(current.a.value ?? "")} onChange={(e) => onChange({ ...current, a: asTest(current.a.op, e.target.value, current.kind === "value") })} />
          </label>
        </>
      )}
      {current && current.kind === "top" && (
        <label>
          How many
          <input type="number" aria-label={`${field} second filter count`} value={current.n} onChange={(e) => onChange({ ...current, n: Number(e.target.value) })} />
        </label>
      )}
    </div>
  );
}

/** Builds a pivot table from a range or a table: which fields go on the rows, the columns and the filters, and what is summed up. */
export function PivotDialog({ open, pivot, source, sheets, fieldsOf, itemsOf, onClose, onSave, onRemove, onRefresh, pivotStyles = [] }: PivotDialogProps) {
  const [name, setName] = useState("");
  const [src, setSrc] = useState("");
  const [place, setPlace] = useState("");
  const [anchor, setAnchor] = useState("A1");
  const [rows, setRows] = useState<PivotAxisField[]>([]);
  const [columns, setColumns] = useState<PivotAxisField[]>([]);
  const [values, setValues] = useState<PivotValue[]>([]);
  const [filters, setFilters] = useState<FilterDraft[]>([]);
  const [layout, setLayout] = useState<Layout>("compact");
  const [repeatLabels, setRepeatLabels] = useState(false);
  const [valuesOnRows, setValuesOnRows] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [calculated, setCalculated] = useState<PivotCalculatedField[]>([]);
  const [calcItems, setCalcItems] = useState<PivotCalculatedItem[]>([]);
  const [moreRanges, setMoreRanges] = useState("");
  const [styleName, setStyleName] = useState("");
  const [pageFields, setPageFields] = useState(1);
  const [styleOpts, setStyleOpts] = useState({ rowHeaders: true, colHeaders: true, rowStripes: false, colStripes: false });
  const [slicers, setSlicers] = useState<(Partial<PivotSlicer> & { field: string })[]>([]);
  const [timelines, setTimelines] = useState<(Partial<PivotTimeline> & { field: string })[]>([]);
  const [grandRows, setGrandRows] = useState(true);
  const [grandCols, setGrandCols] = useState(true);
  const [shown, setShown] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(pivot?.name ?? "");
    setSrc(pivot?.source ?? source);
    setPlace("");
    setAnchor("A1");
    setRows(pivot?.rows.map((f) => ({ ...f })) ?? []);
    setColumns(pivot?.columns.map((f) => ({ ...f })) ?? []);
    setValues(pivot?.values.map((v) => ({ ...v })) ?? []);
    setFilters(pivot?.filters?.map((f) => ({ field: f.field, items: itemsOf(pivot.source, f.field).length === f.items.length ? null : [...f.items] })) ?? []);
    setLayout(pivot?.tabular ? "tabular" : pivot?.outline ? "outline" : "compact");
    setRepeatLabels(!!pivot?.repeatLabels);
    setValuesOnRows(!!pivot?.valuesOnRows);
    setAutoRefresh(!!pivot?.autoRefresh);
    setCalculated(pivot?.calculated?.map((c) => ({ ...c })) ?? []);
    setCalcItems(pivot?.calculatedItems?.map((c) => ({ ...c })) ?? []);
    setMoreRanges(pivot?.ranges ? pivot.ranges.slice(1).map((r) => (r.name ? `${r.source}, ${r.name}` : r.source)).join("\n") : "");
    setStyleName(pivot?.style?.name ?? "");
    setPageFields(pivot?.pageFields ?? 1);
    setStyleOpts({ rowHeaders: pivot?.style?.rowHeaders !== false, colHeaders: pivot?.style?.colHeaders !== false, rowStripes: !!pivot?.style?.rowStripes, colStripes: !!pivot?.style?.colStripes });
    setSlicers(pivot?.slicers?.map((x) => ({ ...x })) ?? []);
    setTimelines(pivot?.timelines?.map((x) => ({ ...x })) ?? []);
    setGrandRows(pivot?.grandTotalRows !== false);
    setGrandCols(pivot?.grandTotalColumns !== false);
    setShown(null);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pivot, source]);

  /** Several ranges: the first is the source, the others are listed one to a line, with a name after a comma. */
  const extraRanges: PivotRange[] = moreRanges.split("\n").map((l) => l.trim()).filter((l) => l !== "").map((l) => {
    const at = l.lastIndexOf(",");
    return at > 0 ? { source: l.slice(0, at).trim(), name: l.slice(at + 1).trim() } : { source: l };
  });
  const combined = extraRanges.length > 0;
  const fields = useMemo(() => (open ? (combined ? ["Row", "Column", "Value", ...Array.from({ length: pageFields }, (_, i) => `Page${i + 1}`)] : fieldsOf(src.trim())) : null), [open, src, fieldsOf, combined, pageFields]);
  const areaOf = (field: string): Area | "" => (filters.some((f) => f.field === field) ? "filters" : columns.some((f) => f.field === field) ? "columns" : rows.some((f) => f.field === field) ? "rows" : values.some((v) => v.field === field) ? "values" : "");

  const calcNames = calculated.map((c) => c.name.trim()).filter((n) => n !== "");
  const take = (field: string) => {
    setFilters((l) => l.filter((f) => f.field !== field));
    setColumns((l) => l.filter((f) => f.field !== field));
    setRows((l) => l.filter((f) => f.field !== field));
    setValues((l) => l.filter((v) => v.field !== field));
  };
  const place_ = (field: string, area: Area | "") => {
    take(field);
    if (area === "filters") setFilters((l) => [...l, { field, items: null }]);
    else if (area === "columns") setColumns((l) => [...l, { field }]);
    else if (area === "rows") setRows((l) => [...l, { field }]);
    else if (area === "values") setValues((l) => [...l, { field }]);
  };
  const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const next = list.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };

  const save = () => {
    if (!fields) return setProblem("That isn't a range or a table with field names in its first row.");
    const result: PivotDialogResult = {
      name: name.trim(),
      source: src.trim(),
      rows,
      columns,
      values: values.map((v) => ({ ...v })),
      filters: filters.map((f) => ({ field: f.field, items: f.items ?? itemsOf(src.trim(), f.field) })),
      calculated: calculated.filter((c) => c.name.trim() !== "").map((c) => ({ name: c.name.trim(), formula: c.formula })),
      calculatedItems: calcItems.filter((c) => c.name.trim() !== "").map((c) => ({ field: c.field, name: c.name.trim(), formula: c.formula })),
      ranges: combined ? [{ source: src.trim() }, ...extraRanges] : undefined,
      ...(combined && pageFields !== 1 ? { pageFields } : {}),
      style: styleName === "" ? undefined : { name: styleName, ...(styleOpts.rowHeaders ? {} : { rowHeaders: false as const }), ...(styleOpts.colHeaders ? {} : { colHeaders: false as const }), ...(styleOpts.rowStripes ? { rowStripes: true as const } : {}), ...(styleOpts.colStripes ? { colStripes: true as const } : {}) },
      slicers,
      timelines,
      tabular: layout === "tabular",
      outline: layout === "outline",
      repeatLabels: layout !== "compact" && repeatLabels,
      valuesOnRows: valuesOnRows && values.length > 1,
      autoRefresh,
      grandTotalRows: grandRows,
      grandTotalColumns: grandCols,
      ...(pivot ? {} : { sheet: place, anchor: anchor.trim() || "A1" }),
    };
    const refused = onSave(result);
    if (refused) setProblem(refused);
  };

  const patchAxis = (area: "rows" | "columns", i: number, patch: Partial<PivotAxisField>) => {
    const set = area === "rows" ? setRows : setColumns;
    set((l) => l.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  };
  const itemChecklist = (field: string, hidden: string[], onChange: (hidden: string[]) => void, group?: PivotGroup) => (
    <div className="pli-pivot-items" role="group" aria-label={`Items of ${field}`}>
      {itemsOf(src.trim(), field, group).map((label) => (
        <label key={label} className="pli-ruleform-check">
          <input type="checkbox" checked={!hidden.includes(label)} onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== label) : [...hidden, label])} /> {label}
        </label>
      ))}
    </div>
  );
  const controls = (area: Area, i: number, count: number, onMove: (by: -1 | 1) => void, field: string, onRemove: () => void = () => place_(field, "")) => (
    <span className="pli-pivot-controls">
      <button type="button" className="pli-button" aria-label={`Move ${field} up in ${area}`} disabled={i === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className="pli-button" aria-label={`Move ${field} down in ${area}`} disabled={i === count - 1} onClick={() => onMove(1)}>↓</button>
      <button type="button" className="pli-button" aria-label={`Remove ${field} from ${area}`} onClick={onRemove}>×</button>
    </span>
  );

  return (
    <Dialog
      open={open}
      title={pivot ? `Pivot table ${pivot.name}` : "Create pivot table"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          {pivot && onRemove && <button type="button" className="pli-button" onClick={onRemove}>Delete pivot table</button>}
          {pivot && onRefresh && <button type="button" className="pli-button" onClick={onRefresh}>Refresh</button>}
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{pivot ? "Save" : "Create"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup pli-pivotform">
        <fieldset>
          <legend>Source</legend>
          <label>
            Range, such as Data!A1:F200, or a table's name
            <input type="text" aria-label="Source range or table" value={src} onChange={(e) => setSrc(e.target.value)} />
          </label>
          <label>
            Other ranges to combine with it, one to a line (a name for the range after a comma): row labels down the first column, column labels along the first row
            <textarea aria-label="Other ranges to combine" rows={2} value={moreRanges} onChange={(e) => setMoreRanges(e.target.value)} />
          </label>
          {combined && <p>The fields are then Row, Column, Value and {pageFields === 0 ? "no page field" : pageFields === 1 ? "Page1 (the name of each range)" : `Page1 to Page${pageFields} (the names of each range, comma between them)`}.</p>}
          {combined && (
            <label>
              Page fields
              <select aria-label="Page fields" value={String(pageFields)} onChange={(e) => setPageFields(Number(e.target.value))}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
            </label>
          )}
          <p>The source can also be a range of another workbook ([Prices.xlsx]Sheet1!$A$1:$D$20), a block of data the host supplies (data:Sales), or the data model (ThisWorkbookDataModel).</p>
          {!fields && src.trim() !== "" && <p className="pli-dropdown-error">No field names can be read from that.</p>}
          {pivot && (
            <label>
              Name
              <input type="text" aria-label="Pivot table name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
        </fieldset>
        {!pivot && (
          <fieldset>
            <legend>Where</legend>
            <label>
              Sheet
              <select aria-label="Sheet for the pivot table" value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">New sheet</option>
                {sheets.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {place !== "" && (
              <label>
                Top-left cell
                <input type="text" aria-label="Top-left cell" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
              </label>
            )}
          </fieldset>
        )}
        {fields && (
          <fieldset>
            <legend>Fields</legend>
            {fields.map((f) => (
              <label key={f} className="pli-pivot-field">
                <span>{f}</span>
                <select aria-label={`${f} goes in`} value={areaOf(f)} onChange={(e) => place_(f, e.target.value as Area | "")}>
                  <option value="">Not used</option>
                  <option value="filters">Filters</option>
                  <option value="columns">Columns</option>
                  <option value="rows">Rows</option>
                  <option value="values">Values</option>
                </select>
              </label>
            ))}
            {calcNames.filter((n) => !fields.includes(n)).map((f) => (
              <label key={`calc:${f}`} className="pli-pivot-field">
                <span>{f} (calculated)</span>
                <select aria-label={`${f} goes in`} value={areaOf(f)} onChange={(e) => place_(f, e.target.value as Area | "")}>
                  <option value="">Not used</option>
                  <option value="values">Values</option>
                </select>
              </label>
            ))}
          </fieldset>
        )}
        {fields &&
          AREAS.map(({ area, label }) => {
            const list = area === "filters" ? filters : area === "columns" ? columns : area === "rows" ? rows : values;
            if (!list.length) return null;
            return (
              <fieldset key={area} aria-label={label}>
                <legend>{label}</legend>
                {area === "filters" &&
                  filters.map((f, i) => (
                    <div key={f.field} className="pli-pivot-item">
                      <div className="pli-pivot-itemhead">
                        <strong>{f.field}</strong>
                        {controls("filters", i, filters.length, (by) => setFilters((l) => move(l, i, by)), f.field)}
                      </div>
                      <button type="button" className="pli-button" aria-expanded={shown === `filters:${f.field}`} onClick={() => setShown(shown === `filters:${f.field}` ? null : `filters:${f.field}`)}>
                        {f.items === null ? "All items" : `${f.items.length} items`}
                      </button>
                      {shown === `filters:${f.field}` &&
                        itemChecklist(
                          f.field,
                          f.items === null ? [] : itemsOf(src.trim(), f.field).filter((x) => !f.items!.includes(x)),
                          (hidden) => setFilters((l) => l.map((g, k) => (k === i ? { ...g, items: hidden.length ? itemsOf(src.trim(), f.field).filter((x) => !hidden.includes(x)) : null } : g))),
                        )}
                    </div>
                  ))}
                {(area === "rows" || area === "columns") &&
                  (area === "rows" ? rows : columns).map((f, i, all) => {
                    const key = `${area}:${i}`;
                    const set = area === "rows" ? setRows : setColumns;
                    const sorted = !!f.sortBy;
                    const descending = sorted ? !!f.sortBy!.descending : !!f.descending;
                    const valueLabels = values.map((v) => v.name ?? `${PIVOT_FUNCTION_NAMES[v.fn ?? "sum"]} of ${v.field}`);
                    const groupKind = f.group?.by ?? "";
                    const filter = f.filter;
                    const filterKind = !filter ? "" : filter.kind === "top" ? (filter.bottom ? "bottom" : "top") : filter.kind;
                    const listed = f.order ? [...f.order.filter((x) => itemsOf(src.trim(), f.field).includes(x)), ...itemsOf(src.trim(), f.field).filter((x) => !f.order!.includes(x))] : [];
                    const setFilter = (next: PivotFieldFilter | undefined) => patchAxis(area, i, { filter: next });
                    return (
                      <div key={key} className="pli-pivot-item">
                        <div className="pli-pivot-itemhead">
                          <strong>{f.field}{f.group ? ` (${GROUPS.find((g) => g.value === f.group!.by)?.label.toLowerCase()})` : ""}</strong>
                          {controls(area, i, all.length, (by) => set((l) => move(l, i, by)), f.field, () => set((l) => l.filter((_, k) => k !== i)))}
                        </div>
                        <label className="pli-ruleform-check">
                          <input type="checkbox" aria-label={`${f.field} largest to smallest`} checked={descending} onChange={(e) => (sorted ? patchAxis(area, i, { sortBy: { value: f.sortBy!.value, ...(e.target.checked ? { descending: true as const } : {}) } }) : patchAxis(area, i, e.target.checked ? { descending: true } : { descending: undefined }))} /> Largest to smallest
                        </label>
                        <label className="pli-ruleform-check">
                          <input type="checkbox" aria-label={`${f.field} subtotal`} checked={f.subtotal !== false} onChange={(e) => patchAxis(area, i, e.target.checked ? { subtotal: undefined } : { subtotal: false })} /> Subtotal
                        </label>
                        <label className="pli-ruleform-check">
                          <input type="checkbox" aria-label={`${f.field} blank line`} checked={!!f.blankRow} onChange={(e) => patchAxis(area, i, { blankRow: e.target.checked ? true : undefined })} /> Blank line after each item
                        </label>
                        <div className="pli-pagesetup-trio">
                          <label>
                            Sort by
                            <select aria-label={`Sort ${f.field} by`} value={f.order ? "manual" : f.sortBy ? String(f.sortBy.value) : ""} onChange={(e) => patchAxis(area, i, e.target.value === "manual" ? { sortBy: undefined, order: (descending ? [...itemsOf(src.trim(), f.field)].reverse() : itemsOf(src.trim(), f.field)) } : e.target.value === "" ? { order: undefined, sortBy: undefined, ...(f.sortBy?.descending ? { descending: true as const } : {}) } : { order: undefined, sortBy: { value: Number(e.target.value), ...(descending ? { descending: true as const } : {}) }, descending: undefined })}>
                              <option value="">Item order</option>
                              <option value="manual">Your own order</option>
                              {valueLabels.map((label, k) => (
                                <option key={k} value={String(k)}>{label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Group
                            <select
                              aria-label={`Group ${f.field}`}
                              value={groupKind}
                              onChange={(e) => {
                                const by = e.target.value;
                                const group: PivotGroup | undefined = by === "" ? undefined : by === "number" ? { by: "number", step: 10 } : by === "dayRange" ? { by: "dayRange", days: 7 } : by === "items" ? { by: "items", groups: [{ name: "Group1", items: [] }] } : { by: by as PivotGroupBy };
                                patchAxis(area, i, { group, hidden: undefined });
                              }}
                            >
                              {GROUPS.map((g) => (
                                <option key={g.value} value={g.value}>{g.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Filter
                            <select
                              aria-label={`Filter ${f.field}`}
                              value={filterKind}
                              onChange={(e) => {
                                const kind = e.target.value;
                                if (kind === "") setFilter(undefined);
                                else if (kind === "top" || kind === "bottom") setFilter({ kind: "top", by: 0, n: 10, ...(kind === "bottom" ? { bottom: true as const } : {}) });
                                else if (kind === "label") setFilter({ kind: "label", a: { op: "contains", value: "" } });
                                else if (kind === "date") setFilter({ kind: "date", period: "thisMonth" });
                                else if (kind === "color") setFilter({ kind: "color", fill: "#ffff00" });
                                else setFilter({ kind: "value", by: 0, a: { op: "greaterThan", value: 0 } });
                              }}
                            >
                              <option value="">No filter</option>
                              <option value="top" disabled={!values.length}>Top items</option>
                              <option value="bottom" disabled={!values.length}>Bottom items</option>
                              <option value="label">Items whose label…</option>
                              <option value="date">Items that are dates in…</option>
                              <option value="value" disabled={!values.length}>Items whose value…</option>
                              <option value="color" disabled={!!f.group}>Items with a colour…</option>
                            </select>
                          </label>
                        </div>
                        {f.group?.by === "number" && (
                          <div className="pli-pagesetup-trio">
                            {(["step", "start", "end"] as const).map((k) => (
                              <label key={k}>
                                {k === "step" ? "Each group spans" : k === "start" ? "Starting at" : "Ending at"}
                                <input
                                  type="number"
                                  aria-label={`${f.field} group ${k}`}
                                  placeholder={k === "step" ? "" : "Automatic"}
                                  value={(f.group as { step: number; start?: number; end?: number })[k] ?? ""}
                                  onChange={(e) => {
                                    const g = { ...(f.group as { by: "number"; step: number; start?: number; end?: number }) };
                                    if (e.target.value === "") delete g[k as "start" | "end"];
                                    else g[k] = Number(e.target.value);
                                    patchAxis(area, i, { group: g, hidden: undefined });
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                        {f.group?.by === "dayRange" && (
                          <div className="pli-pagesetup-trio">
                            {(["days", "start", "end"] as const).map((k) => (
                              <label key={k}>
                                {k === "days" ? "Number of days" : k === "start" ? "Starting at (day number)" : "Ending at (day number)"}
                                <input
                                  type="number"
                                  aria-label={`${f.field} group ${k}`}
                                  placeholder={k === "days" ? "" : "Automatic"}
                                  value={(f.group as { days: number; start?: number; end?: number })[k] ?? ""}
                                  onChange={(e) => {
                                    const g = { ...(f.group as { by: "dayRange"; days: number; start?: number; end?: number }) };
                                    if (e.target.value === "" && k !== "days") delete g[k as "start" | "end"];
                                    else g[k] = Number(e.target.value);
                                    patchAxis(area, i, { group: g, hidden: undefined });
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                        {f.group && f.group.by !== "items" && f.group.by !== "number" && f.group.by !== "dayRange" && (
                          <label>
                            Also group by
                            <select aria-label={`Also group ${f.field} by`} value="" onChange={(e) => e.target.value && set((l) => [...l.slice(0, i + 1), { field: f.field, group: { by: e.target.value as PivotGroupBy } }, ...l.slice(i + 1)])}>
                              <option value="">Nothing more</option>
                              {ALSO.filter((by) => !all.some((o) => o.field === f.field && o.group?.by === by)).map((by) => (
                                <option key={by} value={by}>{GROUPS.find((g) => g.value === by)!.label.replace(/^Dates by |^Times by /, "")}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {f.group?.by === "items" && (
                          <div className="pli-pivot-groups">
                            <label>
                              Heading of the grouped field
                              <input type="text" aria-label={`Heading of ${f.field} groups`} placeholder={`${f.field}2`} value={f.group.name ?? ""} onChange={(e) => patchAxis(area, i, { group: { ...(f.group as { by: "items"; groups: { name: string; items: string[] }[] }), name: e.target.value || undefined } })} />
                            </label>
                            {f.group.groups.map((g, gi) => {
                              const edit = (patch: Partial<{ name: string; items: string[] }>) => patchAxis(area, i, { group: { ...(f.group as { by: "items"; groups: { name: string; items: string[] }[] }), groups: (f.group as { groups: { name: string; items: string[] }[] }).groups.map((x, k) => (k === gi ? { ...x, ...patch } : x)) }, hidden: undefined });
                              return (
                                <div key={gi} className="pli-pivot-group">
                                  <label>
                                    Group {gi + 1}
                                    <input type="text" aria-label={`Group ${gi + 1} of ${f.field}`} value={g.name} onChange={(e) => edit({ name: e.target.value })} />
                                  </label>
                                  <div className="pli-pivot-items" role="group" aria-label={`Items in group ${gi + 1} of ${f.field}`}>
                                    {itemsOf(src.trim(), f.field).map((label) => (
                                      <label key={label} className="pli-ruleform-check">
                                        <input type="checkbox" checked={g.items.includes(label)} onChange={(e) => edit({ items: e.target.checked ? [...g.items, label] : g.items.filter((x) => x !== label) })} /> {label}
                                      </label>
                                    ))}
                                  </div>
                                  <button type="button" className="pli-button" aria-label={`Remove group ${gi + 1} of ${f.field}`} onClick={() => patchAxis(area, i, { group: { ...(f.group as { by: "items"; groups: { name: string; items: string[] }[] }), groups: (f.group as { groups: { name: string; items: string[] }[] }).groups.filter((_, k) => k !== gi) }, hidden: undefined })}>Remove group</button>
                                </div>
                              );
                            })}
                            <button type="button" className="pli-button" onClick={() => patchAxis(area, i, { group: { ...(f.group as { by: "items"; groups: { name: string; items: string[] }[] }), groups: [...(f.group as { groups: { name: string; items: string[] }[] }).groups, { name: `Group${(f.group as { groups: unknown[] }).groups.length + 1}`, items: [] }] } })}>Add a group</button>
                          </div>
                        )}
                        {f.order && (
                          <ol className="pli-pivot-order" aria-label={`Order of ${f.field}`}>
                            {listed.map((item, k) => (
                              <li key={item}>
                                {item}
                                <button type="button" className="pli-button" aria-label={`Move ${item} up`} disabled={k === 0} onClick={() => patchAxis(area, i, { order: move(listed, k, -1) })}>↑</button>
                                <button type="button" className="pli-button" aria-label={`Move ${item} down`} disabled={k === listed.length - 1} onClick={() => patchAxis(area, i, { order: move(listed, k, 1) })}>↓</button>
                              </li>
                            ))}
                          </ol>
                        )}
                        {filter && filter.kind === "date" && (
                          <label>
                            Period
                            <select aria-label={`${f.field} date period`} value={filter.period} onChange={(e) => setFilter({ kind: "date", period: e.target.value as FilterDatePeriod })}>
                              {FILTER_DATE_PERIODS.map((pd) => (
                                <option key={pd} value={pd}>{FILTER_PERIOD_WORDS[pd]}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {filter && filter.kind === "color" && (
                          <div className="pli-pagesetup-trio">
                            <label>
                              Colour of the source cells'
                              <select aria-label={`${f.field} colour of`} value={filter.fill !== undefined ? "fill" : "font"} onChange={(e) => setFilter(e.target.value === "fill" ? { kind: "color", fill: "#ffff00" } : { kind: "color", font: "#ff0000" })}>
                                <option value="fill">Fill</option>
                                <option value="font">Font</option>
                              </select>
                            </label>
                            <label>
                              Colour (#rrggbb, {filter.fill !== undefined ? "none" : "auto"} for the default one)
                              <input type="text" aria-label={`${f.field} colour`} value={filter.fill ?? filter.font ?? ""} onChange={(e) => setFilter(filter.fill !== undefined ? { kind: "color", fill: e.target.value } : { kind: "color", font: e.target.value })} />
                            </label>
                          </div>
                        )}
                        {filter && filter.kind === "top" && (
                          <div className="pli-pagesetup-trio">
                            <label>
                              How many
                              <input type="number" aria-label={`${f.field} filter count`} value={filter.n} onChange={(e) => setFilter({ ...filter, n: Number(e.target.value) })} />
                            </label>
                            <label>
                              Of
                              <select aria-label={`${f.field} filter unit`} value={filter.unit ?? "items"} onChange={(e) => setFilter({ ...filter, unit: e.target.value === "items" ? undefined : (e.target.value as "percent" | "sum") })}>
                                <option value="items">Items</option>
                                <option value="percent">Percent</option>
                                <option value="sum">Sum</option>
                              </select>
                            </label>
                            <label>
                              By
                              <select aria-label={`${f.field} filter by value`} value={String(filter.by)} onChange={(e) => setFilter({ ...filter, by: Number(e.target.value) })}>
                                {valueLabels.map((label, k) => (
                                  <option key={k} value={String(k)}>{label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}
                        {filter && (filter.kind === "label" || filter.kind === "value") && (
                          <div className="pli-pagesetup-trio">
                            {filter.kind === "value" && (
                              <label>
                                Value
                                <select aria-label={`${f.field} filter by value`} value={String(filter.by)} onChange={(e) => setFilter({ ...filter, by: Number(e.target.value) })}>
                                  {valueLabels.map((label, k) => (
                                    <option key={k} value={String(k)}>{label}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <label>
                              Test
                              <select aria-label={`${f.field} filter test`} value={filter.a.op} onChange={(e) => setFilter({ ...filter, a: asTest(e.target.value as FilterTestOp, String(filter.a.value ?? ""), filter.kind === "value") })}>
                                {TEST_OPS.map((o) => (
                                  <option key={o.op} value={o.op}>{o.label}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Text or number
                              <input type="text" aria-label={`${f.field} filter text`} value={String(filter.a.value ?? "")} onChange={(e) => setFilter({ ...filter, a: asTest(filter.a.op, e.target.value, filter.kind === "value") })} />
                            </label>
                          </div>
                        )}
                        {filter && filter.kind !== "color" && (
                          <ExtraFilter
                            field={f.field}
                            first={filter}
                            current={f.filters?.[0]}
                            valueLabels={valueLabels}
                            hasValues={values.length > 0}
                            onChange={(next) => patchAxis(area, i, { filters: next ? [next] : undefined })}
                          />
                        )}
                        <button type="button" className="pli-button" aria-expanded={shown === key} onClick={() => setShown(shown === key ? null : key)}>
                          {f.hidden?.length ? `${f.hidden.length} left out` : "All items"}
                        </button>
                        {shown === key && itemChecklist(f.field, f.hidden ?? [], (hidden) => patchAxis(area, i, { hidden: hidden.length ? hidden : undefined }), f.group)}
                      </div>
                    );
                  })}
                {area === "values" &&
                  values.map((v, i) => (
                    <div key={`${v.field}:${i}`} className="pli-pivot-item">
                      <div className="pli-pivot-itemhead">
                        <strong>{v.field}</strong>
                        <span className="pli-pivot-controls">
                          <button type="button" className="pli-button" aria-label={`Add another summary of ${v.field}`} onClick={() => setValues((l) => [...l.slice(0, i + 1), { field: v.field, fn: v.fn === "count" ? "sum" : "count" }, ...l.slice(i + 1)])}>+</button>
                          <button type="button" className="pli-button" aria-label={`Move ${v.field} up in values`} disabled={i === 0} onClick={() => setValues((l) => move(l, i, -1))}>↑</button>
                          <button type="button" className="pli-button" aria-label={`Move ${v.field} down in values`} disabled={i === values.length - 1} onClick={() => setValues((l) => move(l, i, 1))}>↓</button>
                          <button type="button" className="pli-button" aria-label={`Remove ${v.field} from values`} onClick={() => setValues((l) => l.filter((_, k) => k !== i))}>×</button>
                        </span>
                      </div>
                      <div className="pli-pagesetup-trio">
                        <label>
                          Summarise by
                          <select aria-label={`Summarise ${v.field} by`} value={v.fn ?? ""} onChange={(e) => setValues((l) => l.map((x, k) => (k === i ? { ...x, fn: (e.target.value || undefined) as PivotFunction | undefined } : x)))}>
                            <option value="">Automatic</option>
                            {PIVOT_FUNCTIONS.map((fn) => (
                              <option key={fn} value={fn}>{FUNCTION_LABELS[fn]}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Show as
                          <select
                            aria-label={`Show ${v.field} as`}
                            value={v.showAs ?? ""}
                            onChange={(e) =>
                              setValues((l) =>
                                l.map((x, k) => {
                                  if (k !== i) return x;
                                  const showAs = (e.target.value || undefined) as PivotShowAs | undefined;
                                  const { base, ...rest } = x;
                                  // A comparison with an item starts with the item before; the others keep the field they had.
                                  const along = showAs && PIVOT_ALONG.includes(showAs);
                                  const needs = showAs && PIVOT_NEEDS_ITEM.includes(showAs);
                                  const field = base?.field ?? [...columns, ...rows].at(columns.length ? columns.length - 1 : rows.length - 1)?.field;
                                  return { ...rest, ...(showAs ? { showAs } : {}), ...(along && field && (base || needs) ? { base: needs && base?.item === undefined ? { field, item: { step: "previous" as const } } : base ?? { field } } : {}) };
                                }),
                              )
                            }
                          >
                            {SHOW_AS.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {v.showAs && PIVOT_ALONG.includes(v.showAs) && (rows.length > 0 || columns.length > 0) && (
                        <div className="pli-pagesetup-trio">
                          <label>
                            Along
                            <select
                              aria-label={`${v.field} runs along`}
                              value={v.base?.field ?? ""}
                              onChange={(e) => setValues((l) => l.map((x, k) => (k === i ? { ...x, base: e.target.value ? { field: e.target.value, ...(x.base?.item !== undefined ? { item: typeof x.base.item === "string" ? itemsOf(src.trim(), e.target.value).includes(x.base.item) ? x.base.item : { step: "previous" as const } : x.base.item } : {}) } : undefined } : x)))}
                            >
                              <option value="">The innermost field</option>
                              {[...new Set([...columns, ...rows].map((f) => f.field))].map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                          </label>
                          {PIVOT_NEEDS_ITEM.includes(v.showAs) && v.base && (
                            <label>
                              Item
                              <select
                                aria-label={`${v.field} compared with`}
                                value={typeof v.base.item === "string" ? `item:${v.base.item}` : v.base.item?.step ?? "previous"}
                                onChange={(e) => setValues((l) => l.map((x, k) => (k === i && x.base ? { ...x, base: { field: x.base.field, item: e.target.value === "previous" || e.target.value === "next" ? { step: e.target.value } : e.target.value.slice(5) } } : x)))}
                              >
                                <option value="previous">(previous)</option>
                                <option value="next">(next)</option>
                                {itemsOf(src.trim(), v.base.field).map((it) => (
                                  <option key={it} value={`item:${it}`}>{it}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                      <div className="pli-pagesetup-trio">
                        <label>
                          Heading
                          <input type="text" aria-label={`Heading of ${v.field}`} placeholder={`${PIVOT_FUNCTION_NAMES[v.fn ?? "sum"]} of ${v.field}`} value={v.name ?? ""} onChange={(e) => setValues((l) => l.map((x, k) => (k === i ? { ...x, name: e.target.value || undefined } : x)))} />
                        </label>
                        <label>
                          Number format
                          <input type="text" aria-label={`Number format of ${v.field}`} placeholder="General" value={v.fmt ?? ""} onChange={(e) => setValues((l) => l.map((x, k) => (k === i ? { ...x, fmt: e.target.value || undefined } : x)))} />
                        </label>
                      </div>
                    </div>
                  ))}
              </fieldset>
            );
          })}
        {fields && (
          <fieldset>
            <legend>Calculated fields</legend>
            {calculated.map((c, i) => (
              <div key={i} className="pli-pagesetup-trio">
                <label>
                  Name
                  <input type="text" aria-label={`Calculated field ${i + 1} name`} value={c.name} onChange={(e) => setCalculated((l) => l.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                </label>
                <label>
                  Formula, such as Sales - Cost
                  <input type="text" aria-label={`Calculated field ${i + 1} formula`} value={c.formula} onChange={(e) => setCalculated((l) => l.map((x, k) => (k === i ? { ...x, formula: e.target.value } : x)))} />
                </label>
                <button
                  type="button"
                  className="pli-button"
                  aria-label={`Remove calculated field ${i + 1}`}
                  onClick={() => {
                    const gone = c.name.trim();
                    setCalculated((l) => l.filter((_, k) => k !== i));
                    if (gone) setValues((l) => l.filter((v) => v.field !== gone));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="pli-button" onClick={() => setCalculated((l) => [...l, { name: `Field${l.length + 1}`, formula: "" }])}>Add a calculated field</button>
          </fieldset>
        )}
        {fields && (
          <fieldset>
            <legend>Calculated items</legend>
            {calcItems.map((c, i) => (
              <div key={i} className="pli-pagesetup-trio">
                <label>
                  Field
                  <select aria-label={`Calculated item ${i + 1} field`} value={c.field} onChange={(e) => setCalcItems((l) => l.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))}>
                    {[...rows, ...columns].filter((f) => !f.group).map((f) => (
                      <option key={f.field} value={f.field}>{f.field}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Name
                  <input type="text" aria-label={`Calculated item ${i + 1} name`} value={c.name} onChange={(e) => setCalcItems((l) => l.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                </label>
                <label>
                  Formula over the items, such as East + West
                  <input type="text" aria-label={`Calculated item ${i + 1} formula`} value={c.formula} onChange={(e) => setCalcItems((l) => l.map((x, k) => (k === i ? { ...x, formula: e.target.value } : x)))} />
                </label>
                <button type="button" className="pli-button" aria-label={`Remove calculated item ${i + 1}`} onClick={() => setCalcItems((l) => l.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="pli-button" disabled={![...rows, ...columns].some((f) => !f.group)} onClick={() => setCalcItems((l) => [...l, { field: [...rows, ...columns].find((f) => !f.group)!.field, name: `Item${l.length + 1}`, formula: "" }])}>Add a calculated item</button>
          </fieldset>
        )}
        {fields && (
          <fieldset>
            <legend>Style</legend>
            <label>
              Pivot table style
              <select aria-label="Pivot table style" value={styleName} onChange={(e) => setStyleName(e.target.value)}>
                <option value="">Default (light blue headings)</option>
                <option value="none">None</option>
                {pivotStyles.length > 0 && (
                  <optgroup label="Your own">
                    {pivotStyles.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </optgroup>
                )}
                {STYLE_FAMILIES.map((family) => (
                  <optgroup key={family} label={family}>
                    {PIVOT_STYLE_NAMES.filter((n) => n.startsWith(`PivotStyle${family}`)).map((n) => (
                      <option key={n} value={n}>{n.replace("PivotStyle", "")}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={styleName === ""} checked={styleOpts.rowHeaders} onChange={(e) => setStyleOpts((o) => ({ ...o, rowHeaders: e.target.checked }))} /> Row headers</label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={styleName === ""} checked={styleOpts.colHeaders} onChange={(e) => setStyleOpts((o) => ({ ...o, colHeaders: e.target.checked }))} /> Column headers</label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={styleName === ""} checked={styleOpts.rowStripes} onChange={(e) => setStyleOpts((o) => ({ ...o, rowStripes: e.target.checked }))} /> Banded rows</label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={styleName === ""} checked={styleOpts.colStripes} onChange={(e) => setStyleOpts((o) => ({ ...o, colStripes: e.target.checked }))} /> Banded columns</label>
          </fieldset>
        )}
        {fields && (
          <fieldset>
            <legend>Slicers and timelines</legend>
            {slicers.map((x, i) => (
              <div key={`s${i}`} className="pli-pivot-item">
                <strong>Slicer: {x.field}</strong>
                <button type="button" className="pli-button" aria-label={`Remove the slicer for ${x.field}`} onClick={() => setSlicers((l) => l.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
            {timelines.map((x, i) => (
              <div key={`t${i}`} className="pli-pivot-item">
                <strong>Timeline: {x.field}</strong>
                <select aria-label={`Periods of the timeline for ${x.field}`} value={x.level ?? "months"} onChange={(e) => setTimelines((l) => l.map((y, k) => (k === i ? { ...y, level: e.target.value as "months" } : y)))}>
                  <option value="years">Years</option>
                  <option value="quarters">Quarters</option>
                  <option value="months">Months</option>
                  <option value="days">Days</option>
                </select>
                <button type="button" className="pli-button" aria-label={`Remove the timeline for ${x.field}`} onClick={() => setTimelines((l) => l.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
            {pivot && (
              <>
                <label>
                  Add a slicer for
                  <select aria-label="Add a slicer for" value="" onChange={(e) => e.target.value && setSlicers((l) => [...l, { field: e.target.value }])}>
                    <option value="">Pick a field</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Add a timeline for
                  <select aria-label="Add a timeline for" value="" onChange={(e) => e.target.value && setTimelines((l) => [...l, { field: e.target.value }])}>
                    <option value="">Pick a date field</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {!pivot && <p>Slicers and timelines can be added once the pivot table is made.</p>}
          </fieldset>
        )}
        {fields && (
          <fieldset>
            <legend>Layout</legend>
            <label className="pli-ruleform-check"><input type="radio" name="pivotlayout" checked={layout === "compact"} onChange={() => setLayout("compact")} /> Compact: one column of row labels, indented</label>
            <label className="pli-ruleform-check"><input type="radio" name="pivotlayout" checked={layout === "outline"} onChange={() => setLayout("outline")} /> Outline: a column for each row field, subtotals above their items</label>
            <label className="pli-ruleform-check"><input type="radio" name="pivotlayout" checked={layout === "tabular"} onChange={() => setLayout("tabular")} /> Tabular: a column for each row field, subtotals below</label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={layout === "compact"} checked={layout !== "compact" && repeatLabels} onChange={(e) => setRepeatLabels(e.target.checked)} /> Repeat item labels</label>
            <label className="pli-ruleform-check"><input type="checkbox" disabled={values.length < 2} checked={valuesOnRows && values.length > 1} onChange={(e) => setValuesOnRows(e.target.checked)} /> Show the values down the rows</label>
            <label className="pli-ruleform-check"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Refresh when the source changes</label>
            <label className="pli-ruleform-check"><input type="checkbox" checked={grandRows} onChange={(e) => setGrandRows(e.target.checked)} /> Grand total row</label>
            <label className="pli-ruleform-check"><input type="checkbox" checked={grandCols} onChange={(e) => setGrandCols(e.target.checked)} /> Grand total column</label>
          </fieldset>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
