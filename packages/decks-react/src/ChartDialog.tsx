import { useState } from "react";
import { ColorPicker, Dialog } from "@pli.dev/react";
import { CHART_TYPE_LABELS, CHART_TYPES, defaultSeriesColor, resolveHex, type ChartElement, type ChartGrouping, type ChartLegend, type ChartSeries, type ChartType, type Theme } from "@pli.dev/decks";
import { DeckIcons as I } from "./icons";

interface DraftSeries {
  name: string;
  color: ChartSeries["color"];
  type: "" | "column" | "line" | "area";
  /** One text per row. */
  values: string[];
}

interface Draft {
  chartType: ChartType;
  grouping: ChartGrouping;
  legend: ChartLegend | "auto";
  title: string;
  labels: boolean;
  smooth: boolean;
  /** Category names (X values for a scatter chart) as text. */
  rows: string[];
  series: DraftSeries[];
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function draftOf(chart: ChartElement): Draft {
  const scatter = chart.chartType === "scatter";
  const n = Math.max(chart.categories.length, ...chart.series.map((s) => s.values.length), 0);
  return {
    chartType: chart.chartType,
    grouping: chart.grouping ?? "clustered",
    legend: chart.legend ?? "auto",
    title: chart.title ?? "",
    labels: !!chart.dataLabels && !!(chart.dataLabels.value || chart.dataLabels.percent),
    smooth: !!chart.smooth || chart.series.some((s) => s.smooth),
    rows: Array.from({ length: n }, (_, k) => (scatter ? text(chart.series[0]?.x?.[k] ?? k + 1) : (chart.categories[k] ?? ""))),
    series: chart.series.map((s) => ({ name: s.name, color: s.color, type: s.type ?? "", values: Array.from({ length: n }, (_, k) => text(s.values[k])) })),
  };
}

const num = (t: string): number | null => {
  const n = Number(t.trim());
  return t.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** The chart with the dialog's changes applied: the fields it edits, and the rest as it was. */
export function applyDraft(chart: ChartElement, d: Draft): ChartElement {
  const scatter = d.chartType === "scatter";
  const pie = d.chartType === "pie" || d.chartType === "doughnut";
  const series = (pie ? d.series.slice(0, 1) : d.series).map((s, i): ChartSeries => {
    const old = chart.series[i];
    const out: ChartSeries = { ...old, name: s.name, values: s.values.map(num) };
    if (s.color !== undefined) out.color = s.color;
    else delete out.color;
    if (s.type && !scatter && !pie) out.type = s.type;
    else delete out.type;
    if (d.smooth !== (old?.smooth ?? chart.smooth ?? false)) out.smooth = d.smooth;
    if (scatter) out.x = d.rows.map((r, k) => num(r) ?? k + 1);
    else delete out.x;
    if (d.chartType === "line" && out.marker === undefined) out.marker = true;
    return out;
  });
  const next: ChartElement = { ...chart, chartType: d.chartType, categories: scatter ? [] : d.rows, series };
  if (d.chartType === "column" || d.chartType === "bar" || d.chartType === "line" || d.chartType === "area") {
    if (d.grouping === "clustered") delete next.grouping;
    else next.grouping = d.grouping;
  } else delete next.grouping;
  if (d.legend === "auto") delete next.legend;
  else next.legend = d.legend;
  if (d.title.trim()) next.title = d.title;
  else delete next.title;
  if (d.labels) next.dataLabels = { ...(chart.dataLabels ?? {}), ...(pie ? { percent: true } : { value: true }) };
  else delete next.dataLabels;
  if (d.smooth !== (chart.smooth ?? false)) next.smooth = d.smooth;
  return next;
}

export interface ChartDialogProps {
  chart: ChartElement;
  theme: Theme;
  /** Called with the changed chart when the person applies. */
  onApply: (chart: ChartElement) => void;
  onClose: () => void;
}

/** The data and options of a chart: a table of categories and series, and the settings that shape the chart. */
export function ChartDialog({ chart, theme, onApply, onClose }: ChartDialogProps) {
  const [d, setD] = useState<Draft>(() => draftOf(chart));
  const scatter = d.chartType === "scatter";
  const pie = d.chartType === "pie" || d.chartType === "doughnut";
  const cartesian = !scatter && !pie;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setSeries = (i: number, patch: Partial<DraftSeries>) => setD((x) => ({ ...x, series: x.series.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setCell = (i: number, r: number, v: string) => setD((x) => ({ ...x, series: x.series.map((s, k) => (k === i ? { ...s, values: s.values.map((c, j) => (j === r ? v : c)) } : s)) }));
  const addRow = () => setD((x) => ({ ...x, rows: [...x.rows, scatter ? String(x.rows.length + 1) : `Category ${x.rows.length + 1}`], series: x.series.map((s) => ({ ...s, values: [...s.values, ""] })) }));
  const removeRow = (r: number) => setD((x) => ({ ...x, rows: x.rows.filter((_, j) => j !== r), series: x.series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== r) })) }));
  const addSeries = () => setD((x) => ({ ...x, series: [...x.series, { name: `Series ${x.series.length + 1}`, color: undefined, type: "", values: x.rows.map(() => "") }] }));
  const removeSeries = (i: number) => setD((x) => ({ ...x, series: x.series.filter((_, k) => k !== i) }));
  const shownSeries = pie ? d.series.slice(0, 1) : d.series;
  const hex = (s: DraftSeries, i: number) => resolveHex(s.color ?? defaultSeriesColor(i), theme);
  return (
    <Dialog
      open
      title="Chart options"
      onClose={onClose}
      onSubmit={() => {
        onApply(applyDraft(chart, d));
        onClose();
      }}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Apply</button>
        </>
      }
    >
      <div className="pli-deck-chart-options">
        <label className="pli-field-row">
          <span>Chart type</span>
          <select aria-label="Chart type" value={d.chartType} onChange={(e) => set({ chartType: e.target.value as ChartType })}>
            {CHART_TYPES.map((t) => <option key={t} value={t}>{CHART_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        {(d.chartType === "column" || d.chartType === "bar" || d.chartType === "line" || d.chartType === "area") && (
          <label className="pli-field-row">
            <span>Stacking</span>
            <select aria-label="Stacking" value={d.grouping} onChange={(e) => set({ grouping: e.target.value as ChartGrouping })}>
              <option value="clustered">{d.chartType === "line" || d.chartType === "area" ? "None" : "Clustered"}</option>
              <option value="stacked">Stacked</option>
              <option value="percentStacked">100% stacked</option>
            </select>
          </label>
        )}
        <label className="pli-field-row">
          <span>Title</span>
          <input type="text" aria-label="Chart title" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="pli-field-row">
          <span>Legend</span>
          <select aria-label="Legend position" value={d.legend} onChange={(e) => set({ legend: e.target.value as Draft["legend"] })}>
            <option value="auto">Automatic</option>
            {(["top", "bottom", "left", "right", "none"] as const).map((p) => <option key={p} value={p}>{p === "none" ? "None" : p[0]!.toUpperCase() + p.slice(1)}</option>)}
          </select>
        </label>
        <label className="pli-checkbox-row">
          <input type="checkbox" aria-label="Show data labels" checked={d.labels} onChange={(e) => set({ labels: e.target.checked })} />
          <span>Show data labels</span>
        </label>
        {(d.chartType === "line" || scatter) && (
          <label className="pli-checkbox-row">
            <input type="checkbox" aria-label="Smooth lines" checked={d.smooth} onChange={(e) => set({ smooth: e.target.checked })} />
            <span>Smooth lines</span>
          </label>
        )}
        <div className="pli-deck-chart-table-wrap">
          <table className="pli-deck-chart-table" aria-label="Chart data">
            <thead>
              <tr>
                <th scope="col">{scatter ? "X" : pie ? "Slice" : "Category"}</th>
                {shownSeries.map((s, i) => (
                  <th key={i} scope="col">
                    <div className="pli-deck-chart-series-head">
                      <input type="text" aria-label={`Series ${i + 1} name`} value={s.name} onChange={(e) => setSeries(i, { name: e.target.value })} />
                      {!pie && <ColorPicker label={`Series ${i + 1} color`} value={hex(s, i)} icon={I.fill} noneLabel="Automatic" onChange={(c) => setSeries(i, { color: c ?? undefined })} />}
                      {cartesian && (
                        <select aria-label={`Series ${i + 1} drawn as`} value={s.type} onChange={(e) => setSeries(i, { type: e.target.value as DraftSeries["type"] })}>
                          <option value="">As chart</option>
                          <option value="column">Columns</option>
                          <option value="line">Line</option>
                          <option value="area">Area</option>
                        </select>
                      )}
                      {!pie && <button type="button" className="pli-tool" aria-label={`Remove series ${i + 1}`} disabled={d.series.length <= 1} onClick={() => removeSeries(i)}>{I.trash}</button>}
                    </div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, k) => (
                <tr key={k}>
                  <th scope="row">
                    <input type="text" aria-label={`${scatter ? "X value" : "Category"} ${k + 1}`} value={r} onChange={(e) => set({ rows: d.rows.map((x, j) => (j === k ? e.target.value : x)) })} />
                  </th>
                  {shownSeries.map((s, i) => (
                    <td key={i}>
                      <input type="text" inputMode="decimal" aria-label={`Series ${i + 1} value ${k + 1}`} value={s.values[k] ?? ""} onChange={(e) => setCell(i, k, e.target.value)} />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="pli-tool" aria-label={`Remove row ${k + 1}`} disabled={d.rows.length <= 1} onClick={() => removeRow(k)}>{I.trash}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pli-deck-row">
          <button type="button" className="pli-button" onClick={addRow}>{I.plus} Add row</button>
          {!pie && <button type="button" className="pli-button" onClick={addSeries}>{I.plus} Add series</button>}
        </div>
      </div>
    </Dialog>
  );
}
