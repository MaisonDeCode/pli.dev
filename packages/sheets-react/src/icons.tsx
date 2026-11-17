import type { ReactNode } from "react";
import type { IconSetName } from "@pli.dev/sheets";

const RED = "#e5484d";
const YELLOW = "#f5b000";
const GREEN = "#2f9e44";
const GRAY = ["#6b7280", "#9ca3af", "#cbd5e1"];

/** An arrow pointing `deg` degrees clockwise from straight up. */
const arrow = (deg: number, color: string): ReactNode => (
  <g transform={`rotate(${deg} 8 8)`}>
    <path d="M8 2 13 8.2H9.6V14H6.4V8.2H3Z" fill={color} />
  </g>
);

const dot = (color: string, ring?: boolean): ReactNode => <circle cx="8" cy="8" r="6" fill={color} stroke={ring ? "rgba(0,0,0,.35)" : "none"} strokeWidth="1" />;

const flag = (color: string): ReactNode => (
  <g>
    <path d="M4 2v12" stroke="#6b7280" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4.7 2.5h8l-2 3 2 3h-8Z" fill={color} />
  </g>
);

const mark = (kind: "cross" | "bang" | "tick", color: string, disc: boolean): ReactNode => (
  <g>
    {disc && <circle cx="8" cy="8" r="6.5" fill={color} />}
    <g stroke={disc ? "#fff" : color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
      {kind === "cross" && <path d="m5.2 5.2 5.6 5.6m0-5.6-5.6 5.6" />}
      {kind === "bang" && <path d="M8 4.2v4.6M8 11.6v.2" />}
      {kind === "tick" && <path d="m4.6 8.3 2.4 2.4 4.6-5" />}
    </g>
  </g>
);

/** Signal bars, `filled` of `total` filled in. */
const bars = (filled: number, total: number): ReactNode => (
  <g>
    {Array.from({ length: total }, (_, i) => {
      const h = 4 + ((i + 1) * 10) / total;
      const w = 10 / total - 0.8;
      return <rect key={i} x={3 + (i * 10) / total} y={14 - h} width={w} height={h} rx="0.6" fill={i < filled ? "#4b5563" : "#d1d5db"} />;
    })}
  </g>
);

/** A circle filled by `quarters` quarters, clockwise from twelve o'clock. */
const quarters = (n: number): ReactNode => {
  const slice = n >= 4 ? <circle cx="8" cy="8" r="6" fill="#4b5563" /> : n <= 0 ? null : <path d={`M8 8V2${n >= 1 ? "A6 6 0 0 1 14 8" : ""}${n >= 2 ? "A6 6 0 0 1 8 14" : ""}${n >= 3 ? "A6 6 0 0 1 2 8" : ""}Z`} fill="#4b5563" />;
  return (
    <g>
      <circle cx="8" cy="8" r="6" fill="#fff" stroke="#4b5563" strokeWidth="1.2" />
      {slice}
    </g>
  );
};

/** A star: empty, half or full. */
const star = (n: number): ReactNode => {
  const path = "m8 1.8 1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.6l-3.9 2.2.9-4.4-3.3-3 4.4-.5Z";
  return (
    <g>
      <defs>
        <clipPath id="pli-half-star">
          <rect x="0" y="0" width="8" height="16" />
        </clipPath>
      </defs>
      <path d={path} fill={n >= 2 ? "#f5b000" : "#fff"} stroke="#d99a00" strokeWidth="1" strokeLinejoin="round" />
      {n === 1 && <path d={path} fill="#f5b000" clipPath="url(#pli-half-star)" />}
    </g>
  );
};

/** A square filled by quarters from the bottom, as the Boxes sets are. */
const boxes = (n: number): ReactNode => (
  <g>
    <rect x="2.5" y="2.5" width="11" height="11" fill="#fff" stroke="#4b5563" strokeWidth="1.2" />
    {n > 0 && <rect x="2.5" y={13.5 - (11 * n) / 4} width="11" height={(11 * n) / 4} fill="#4b5563" />}
  </g>
);

/** The icon at `index` (0 is the lowest) of an icon set with `count` icons. */
function glyph(set: IconSetName, index: number, count: number): ReactNode {
  const low = index === 0;
  const high = index === count - 1;
  switch (set) {
    case "3Arrows":
      return arrow(index === 0 ? 180 : index === 1 ? 90 : 0, index === 0 ? RED : index === 1 ? YELLOW : GREEN);
    case "4Arrows":
      return arrow([180, 135, 45, 0][index]!, [RED, YELLOW, YELLOW, GREEN][index]!);
    case "5Arrows":
      return arrow([180, 135, 90, 45, 0][index]!, [RED, YELLOW, YELLOW, YELLOW, GREEN][index]!);
    case "3ArrowsGray":
      return arrow(index === 0 ? 180 : index === 1 ? 90 : 0, GRAY[index === 1 ? 1 : index === 0 ? 0 : 0]!);
    case "4ArrowsGray":
      return arrow([180, 135, 45, 0][index]!, GRAY[index < 2 ? 1 : 0]!);
    case "5ArrowsGray":
      return arrow([180, 135, 90, 45, 0][index]!, GRAY[index === 2 ? 1 : 0]!);
    case "3Flags":
      return flag(low ? RED : high ? GREEN : YELLOW);
    case "3TrafficLights1":
      return dot(low ? RED : high ? GREEN : YELLOW);
    case "3TrafficLights2":
      return dot(low ? RED : high ? GREEN : YELLOW, true);
    case "4TrafficLights":
      return dot(["#1f2937", RED, YELLOW, GREEN][index]!);
    case "4RedToBlack":
      return dot(["#1f2937", "#6b7280", "#f4a6a6", RED][index]!);
    case "3Signs":
      return low ? <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill={RED} /> : high ? dot(GREEN) : <path d="M8 2 14.5 13.5h-13Z" fill={YELLOW} />;
    case "3Symbols":
      return mark(low ? "cross" : high ? "tick" : "bang", low ? RED : high ? GREEN : YELLOW, true);
    case "3Symbols2":
      return mark(low ? "cross" : high ? "tick" : "bang", low ? RED : high ? GREEN : YELLOW, false);
    case "4Rating":
      return bars(index + 1, 4);
    case "5Rating":
      return bars(index, 4);
    case "5Quarters":
      return quarters(index);
    case "3Stars":
      return star(index);
    case "3Triangles":
      return low ? <path d="M2.5 4.5h11L8 13.5Z" fill={RED} /> : high ? <path d="M8 2.5 13.5 11.5h-11Z" fill={GREEN} /> : <rect x="2.5" y="6.5" width="11" height="3" rx="0.6" fill={YELLOW} />;
    case "5Boxes":
      return boxes(index);
  }
}

/** One icon of a conditional format's icon set, drawn small enough for a cell. */
export function CfIcon({ set, index, count, size = 14 }: { set: IconSetName; index: number; count: number; size?: number }) {
  return (
    <svg className="pli-cell-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      {glyph(set, index, count)}
    </svg>
  );
}
