import { useState, type ReactNode } from "react";
import { Dropdown } from "./primitives";

const GRAYS = ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"];
const HUES = ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"];

/** Lighter and darker steps of each hue, like the palettes in other word processors. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => {
    const target = amount < 0 ? 0 : 255;
    return Math.round(c + (target - c) * Math.abs(amount));
  };
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const ROWS: string[][] = [
  GRAYS,
  HUES,
  ...[0.8, 0.6, 0.4].map((amount) => HUES.map((h) => shade(h, amount))),
  ...[-0.25, -0.5].map((amount) => HUES.map((h) => shade(h, amount))),
];

export interface ColorPickerProps {
  label: string;
  /** The current color, or undefined for none. */
  value: string | undefined;
  /** True when the selection has more than one color. */
  mixed?: boolean;
  onChange: (color: string | null) => void;
  /** The icon shown on the button; the current color is drawn under it. */
  icon: ReactNode;
  noneLabel: string;
}

export function ColorPicker({ label, value, mixed, onChange, icon, noneLabel }: ColorPickerProps) {
  const [custom, setCustom] = useState(value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#4f46e5");
  return (
    <Dropdown
      label={label}
      className="pli-color-button"
      panel={(close) => (
        <div className="pli-colors">
          <button type="button" className="pli-color-none" onClick={() => { onChange(null); close(); }}>
            {noneLabel}
          </button>
          <div className="pli-swatches" role="group" aria-label={label}>
            {ROWS.flat().map((color) => (
              <button
                key={color}
                type="button"
                className="pli-swatch"
                style={{ background: color }}
                aria-label={color}
                title={color}
                aria-pressed={value?.toLowerCase() === color}
                onClick={() => { onChange(color); close(); }}
              />
            ))}
          </div>
          <label className="pli-color-custom">
            <span>Custom</span>
            <input
              type="color"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={() => undefined}
            />
            <button type="button" onClick={() => { onChange(custom); close(); }}>
              Apply
            </button>
          </label>
        </div>
      )}
    >
      <span className="pli-color-icon">
        {icon}
        <span className="pli-color-bar" style={{ background: mixed ? "linear-gradient(90deg,#f33,#3a3,#33f)" : (value ?? "transparent") }} />
      </span>
    </Dropdown>
  );
}
