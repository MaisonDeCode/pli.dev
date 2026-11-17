import type { Border, BorderStyle, CellBorders, IconSetName } from "./model";
import type { CellEffect } from "./conditional";

/*
 * What data bars, icon sets and diagonal borders become in the HTML a copy writes. They are all drawn as CSS backgrounds
 * on the cell: Excel and Google Sheets ignore backgrounds they don't know, and a browser, Docs or a mail program draws them.
 */

const RED = "#e5484d";
const YELLOW = "#f5b000";
const GREEN = "#2f9e44";
const GRAY = ["#6b7280", "#9ca3af", "#cbd5e1"];

const arrow = (deg: number, color: string) => `<g transform="rotate(${deg} 8 8)"><path d="M8 2 13 8.2H9.6V14H6.4V8.2H3Z" fill="${color}"/></g>`;
const dot = (color: string, ring?: boolean) => `<circle cx="8" cy="8" r="6" fill="${color}" stroke="${ring ? "rgba(0,0,0,.35)" : "none"}" stroke-width="1"/>`;
const flag = (color: string) => `<g><path d="M4 2v12" stroke="#6b7280" stroke-width="1.4" stroke-linecap="round"/><path d="M4.7 2.5h8l-2 3 2 3h-8Z" fill="${color}"/></g>`;
const mark = (kind: "cross" | "bang" | "tick", color: string, disc: boolean) =>
  `<g>${disc ? `<circle cx="8" cy="8" r="6.5" fill="${color}"/>` : ""}<g stroke="${disc ? "#fff" : color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">${
    kind === "cross" ? '<path d="m5.2 5.2 5.6 5.6m0-5.6-5.6 5.6"/>' : kind === "bang" ? '<path d="M8 4.2v4.6M8 11.6v.2"/>' : '<path d="m4.6 8.3 2.4 2.4 4.6-5"/>'
  }</g></g>`;
const bars = (filled: number, total: number) =>
  `<g>${Array.from({ length: total }, (_, i) => {
    const h = 4 + ((i + 1) * 10) / total;
    const w = 10 / total - 0.8;
    return `<rect x="${3 + (i * 10) / total}" y="${14 - h}" width="${w}" height="${h}" rx="0.6" fill="${i < filled ? "#4b5563" : "#d1d5db"}"/>`;
  }).join("")}</g>`;
const quarters = (n: number) => {
  const slice = n >= 4 ? '<circle cx="8" cy="8" r="6" fill="#4b5563"/>' : n <= 0 ? "" : `<path d="M8 8V2${n >= 1 ? "A6 6 0 0 1 14 8" : ""}${n >= 2 ? "A6 6 0 0 1 8 14" : ""}${n >= 3 ? "A6 6 0 0 1 2 8" : ""}Z" fill="#4b5563"/>`;
  return `<g><circle cx="8" cy="8" r="6" fill="#fff" stroke="#4b5563" stroke-width="1.2"/>${slice}</g>`;
};
const star = (n: number) => {
  const path = "m8 1.8 1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.6l-3.9 2.2.9-4.4-3.3-3 4.4-.5Z";
  return `<g><defs><clipPath id="pli-half-star"><rect x="0" y="0" width="8" height="16"/></clipPath></defs><path d="${path}" fill="${n >= 2 ? "#f5b000" : "#fff"}" stroke="#d99a00" stroke-width="1" stroke-linejoin="round"/>${n === 1 ? `<path d="${path}" fill="#f5b000" clip-path="url(#pli-half-star)"/>` : ""}</g>`;
};
const boxes = (n: number) => `<g><rect x="2.5" y="2.5" width="11" height="11" fill="#fff" stroke="#4b5563" stroke-width="1.2"/>${n > 0 ? `<rect x="2.5" y="${13.5 - (11 * n) / 4}" width="11" height="${(11 * n) / 4}" fill="#4b5563"/>` : ""}</g>`;

function glyph(set: IconSetName, index: number, count: number): string {
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
      return arrow(index === 0 ? 180 : index === 1 ? 90 : 0, GRAY[index === 1 ? 1 : 0]!);
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
      return low ? `<path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="${RED}"/>` : high ? dot(GREEN) : `<path d="M8 2 14.5 13.5h-13Z" fill="${YELLOW}"/>`;
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
      return low ? `<path d="M2.5 4.5h11L8 13.5Z" fill="${RED}"/>` : high ? `<path d="M8 2.5 13.5 11.5h-11Z" fill="${GREEN}"/>` : `<rect x="2.5" y="6.5" width="11" height="3" rx="0.6" fill="${YELLOW}"/>`;
    case "5Boxes":
      return boxes(index);
  }
}

/** One icon of an icon set as an SVG picture (`index` 0 is the lowest), `size` pixels across. */
export function iconSvg(set: IconSetName, index: number, count: number, size = 14): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}">${glyph(set, index, count)}</svg>`;
}

/** The icon as a CSS `url(...)` that holds the picture itself. */
export function iconUrl(set: IconSetName, index: number, count: number, size = 14): string {
  return `url("data:image/svg+xml,${encodeURIComponent(iconSvg(set, index, count, size)).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29")}")`;
}

/** Pixels of the cell's left edge an icon takes, and the room its text leaves for it. */
export const ICON_SPACE = 22;

const mix = (c: string, t: number): string => {
  const p = (i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return "#" + [0, 1, 2].map((i) => hex(p(i) + (255 - p(i)) * t)).join("");
};

/** The `background-image` layers a conditional format's bar and icon (and a cell's diagonal borders) make, topmost first. */
export function backgroundLayers(effect: CellEffect | undefined, borders: CellBorders | undefined): string[] {
  const layers: string[] = [];
  const icon = effect?.icon;
  if (icon) layers.push(iconUrl(icon.set, icon.index, icon.count));
  for (const [key, direction] of [["diagonalDown", "to top right"], ["diagonalUp", "to bottom right"]] as const) {
    const line = borders?.[key];
    if (!line) continue;
    const half = ({ thin: 0.5, medium: 1, thick: 1.5, dashed: 0.5, dotted: 0.5, double: 1.5, hair: 0.5 } satisfies Record<BorderStyle, number>)[line.style];
    const color = (line.color ?? "#000000").toLowerCase();
    layers.push(`linear-gradient(${direction},transparent calc(50% - ${half}px),${color} calc(50% - ${half}px),${color} calc(50% + ${half}px),transparent calc(50% + ${half}px))`);
  }
  const bar = effect?.bar;
  if (bar && bar.to > bar.from) {
    const from = Math.round(bar.from * 1000) / 10;
    const to = Math.round(bar.to * 1000) / 10;
    const end = bar.solid ? bar.color : mix(bar.color, 0.65);
    layers.push(`linear-gradient(90deg,transparent ${from}%,${bar.color} ${from}%,${end} ${to}%,transparent ${to}%)`);
    if (bar.axis !== undefined) {
      const at = Math.round(bar.axis * 1000) / 10;
      const axis = bar.axisColor ?? "#808080";
      layers.push(`linear-gradient(90deg,transparent ${at}%,${axis} ${at}%,${axis} calc(${at}% + 1px),transparent calc(${at}% + 1px))`);
    }
  }
  return layers;
}

/** The CSS a cell's bar, icon and diagonal borders add, and `mso-diagonal-*` for Excel, which reads those. */
export function backgroundCss(effect: CellEffect | undefined, borders: CellBorders | undefined): string {
  const layers = backgroundLayers(effect, borders);
  const out: string[] = [];
  if (layers.length) {
    out.push(`background-image:${layers.join(",")}`);
    // Only the icon is a picture that must not repeat; the gradients fill the cell.
    const sizes = layers.map((l) => (l.startsWith("url(") ? "14px 14px" : "100% 100%"));
    out.push(`background-repeat:${layers.map(() => "no-repeat").join(",")}`);
    out.push(`background-position:${layers.map((l) => (l.startsWith("url(") ? "4px center" : "0 0")).join(",")}`);
    out.push(`background-size:${sizes.join(",")}`);
  }
  if (effect?.icon) out.push(`padding-left:${ICON_SPACE}px`);
  const line = (b: Border) => `${b.style === "hair" ? "0.25pt" : b.style === "thick" || b.style === "double" ? "2.25pt" : b.style === "medium" ? "1.5pt" : "0.75pt"} ${b.style === "dashed" ? "dashed" : b.style === "dotted" || b.style === "hair" ? "dotted" : b.style === "double" ? "double" : "solid"} ${b.color ?? "windowtext"}`;
  if (borders?.diagonalDown) out.push(`mso-diagonal-down:${line(borders.diagonalDown)}`);
  if (borders?.diagonalUp) out.push(`mso-diagonal-up:${line(borders.diagonalUp)}`);
  return out.join(";");
}
