import { CHART_COLORS, type Chart, type ChartData } from "@pli.dev/sheets";
import { describeMark, type MarkRef } from "./chartmarks";

/*
 * The format panel of a picked mark: a column, bar, slice, marker, bubble or step of a chart. It sets the fill of that one point
 * (`pointColors`) and, for a slice, how far it is pulled out (`pointExplosion`). It sits just under the chart.
 */

export interface ChartMarkPanelProps {
  chart: Chart;
  data: ChartData;
  mark: MarkRef;
  readOnly?: boolean | undefined;
  /** The height of the chart, so that the panel can stand under it. */
  below: number;
  onChange(patch: Partial<Pick<Chart, "series">>): void;
  onClose(): void;
}

const CIRCULAR = ["pie", "doughnut", "pieOfPie", "barOfPie"];

export function ChartMarkPanel({ chart, data, mark, readOnly, below, onChange, onClose }: ChartMarkPanelProps) {
  const circular = CIRCULAR.includes(chart.type);
  const index = circular ? 0 : mark.series;
  const spec = chart.series[index];
  const series = data.series[index];
  if (!spec || !series) return null;
  const key = String(mark.point);
  const own = spec.pointColors?.[key];
  const palette = circular ? CHART_COLORS[mark.point % CHART_COLORS.length]! : series.color;
  const shownColor = own ?? palette;
  const edit = (change: (s: typeof spec) => typeof spec) => onChange({ series: chart.series.map((s, i) => (i === index ? change(s) : s)) });
  const setColor = (color: string | null) =>
    edit((s) => {
      const colors = { ...s.pointColors };
      if (color === null) delete colors[key];
      else colors[key] = color;
      const { pointColors: _old, ...rest } = s;
      return Object.keys(colors).length ? { ...rest, pointColors: colors } : rest;
    });
  const explosion = spec.pointExplosion?.[key] ?? spec.explosion ?? 0;
  const setExplosion = (value: number) =>
    edit((s) => {
      const per = { ...s.pointExplosion };
      if (value === (s.explosion ?? 0)) delete per[key];
      else per[key] = value;
      const { pointExplosion: _old, ...rest } = s;
      return Object.keys(per).length ? { ...rest, pointExplosion: per } : rest;
    });
  return (
    <div className="pli-markpanel" role="group" aria-label="Format the picked mark" style={{ top: below + 6 }}>
      <div className="pli-markpanel-head">
        <strong>{describeMark(chart, data, mark)}</strong>
        <button type="button" className="pli-button" aria-label="Let go of the mark" onClick={onClose}>✕</button>
      </div>
      <label>
        Fill
        <input type="color" aria-label="Fill of the picked mark" value={shownColor} disabled={readOnly} onChange={(e) => setColor(e.target.value)} />
      </label>
      <button type="button" className="pli-button" disabled={readOnly || own === undefined} onClick={() => setColor(null)}>
        Use the series colour
      </button>
      {circular && (
        <label>
          Pull out (%)
          <input
            type="number"
            min={0}
            max={400}
            aria-label="Pull the picked slice out"
            value={explosion}
            disabled={readOnly}
            onChange={(e) => setExplosion(Math.max(0, Math.min(400, Number(e.target.value) || 0)))}
            style={{ width: 60 }}
          />
        </label>
      )}
    </div>
  );
}
