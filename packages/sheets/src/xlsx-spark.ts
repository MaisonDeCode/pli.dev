import { attr, child, childrenNamed, createId, textOf, type XmlElement } from "@pli.dev/core";
import { cellAddress, parseCell } from "./address";
import { chartRef, chartRefText } from "./chart";
import { sheetRef } from "./formula";
import type { Sheet, SparklineColor, SparklineGroup } from "./model";
import { SPARKLINE_COLORS, cleanSparklines } from "./sparkline";
import { colorOf as formatColor } from "./xlsx-format";

/*
 * Sparklines in an .xlsx file: a `sparklineGroups` element in the sheet's extension list (`x14` namespace). Each group has
 * its type and options as attributes, its colours as `colorSeries`, `colorNegative`… children, and a `sparklines` list of
 * cell (`xm:sqref`) and data (`xm:f`) pairs.
 */

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM = "http://schemas.microsoft.com/office/excel/2006/main";
export const SPARKLINES_URI = "{05C60535-1F16-4fd2-B633-F4F36F0B64E0}";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rgb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
/** A colour as the attributes of a colour element: `rgb`, or the theme colour and its tint. */
const colorAttrs = (c: SparklineColor): string => (typeof c === "string" ? `rgb="${rgb(c)}"` : `theme="${c.theme}"${c.tint ? ` tint="${c.tint}"` : ""}`);

const rangeText = (b: { r1: number; c1: number; r2: number; c2: number }) => `${cellAddress(b.r1, b.c1)}${b.r1 === b.r2 && b.c1 === b.c2 ? "" : `:${cellAddress(b.r2, b.c2)}`}`;

/** The `<ext>` that holds a sheet's sparklines, or an empty string. */
export function sparklineExtXml(sheet: Sheet): string {
  if (!sheet.sparklines?.length) return "";
  const groups = sheet.sparklines.map((g) => {
    const attrs = [
      g.type === "column" ? 'type="column"' : g.type === "winloss" ? 'type="stacked"' : "",
      g.lineWeight !== undefined ? `lineWeight="${g.lineWeight}"` : "",
      `displayEmptyCellsAs="${g.emptyAs ?? "gap"}"`,
      g.markers ? 'markers="1"' : "",
      g.high ? 'high="1"' : "",
      g.low ? 'low="1"' : "",
      g.first ? 'first="1"' : "",
      g.last ? 'last="1"' : "",
      g.negative ? 'negative="1"' : "",
      g.showAxis ? 'displayXAxis="1"' : "",
      g.showHidden ? 'displayHidden="1"' : "",
      g.rightToLeft ? 'rightToLeft="1"' : "",
      typeof g.min === "number" ? `manualMin="${g.min}" minAxisType="custom"` : g.min === "group" ? 'minAxisType="group"' : "",
      typeof g.max === "number" ? `manualMax="${g.max}" maxAxisType="custom"` : g.max === "group" ? 'maxAxisType="group"' : "",
      g.dateAxis ? 'dateAxis="1"' : "",
    ].filter(Boolean);
    const colors = [
      ["colorSeries", g.color ?? SPARKLINE_COLORS.series],
      ["colorNegative", g.negativeColor ?? SPARKLINE_COLORS.negative],
      ["colorAxis", g.axisColor ?? SPARKLINE_COLORS.axis],
      ["colorMarkers", g.markerColor ?? SPARKLINE_COLORS.marker],
      ["colorFirst", g.firstColor ?? SPARKLINE_COLORS.first],
      ["colorLast", g.lastColor ?? SPARKLINE_COLORS.last],
      ["colorHigh", g.highColor ?? SPARKLINE_COLORS.high],
      ["colorLow", g.lowColor ?? SPARKLINE_COLORS.low],
    ]
      .map(([tag, c]) => `<x14:${tag} ${colorAttrs(c!)}/>`)
      .join("");
    const dates = g.dateAxis ? chartRef(g.dateAxis, sheet.name) : null;
    const axis = dates ? `<xm:f>${esc(`${sheetRef(dates.sheet)}!${rangeText(dates.bounds)}`)}</xm:f>` : "";
    const items = g.items
      .map((i) => {
        const r = chartRef(i.source, sheet.name);
        if (!r) return "";
        return `<x14:sparkline><xm:f>${esc(`${sheetRef(r.sheet)}!${rangeText(r.bounds)}`)}</xm:f><xm:sqref>${i.cell}</xm:sqref></x14:sparkline>`;
      })
      .join("");
    return `<x14:sparklineGroup ${attrs.join(" ")}>${colors}${axis}<x14:sparklines>${items}</x14:sparklines></x14:sparklineGroup>`;
  });
  return `<ext uri="${SPARKLINES_URI}" xmlns:x14="${X14}"><x14:sparklineGroups xmlns:xm="${XM}">${groups.join("")}</x14:sparklineGroups></ext>`;
}

const truthy = (v: string | undefined) => v === "1" || v === "true";
const REF = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i;

/** A colour element: `#rrggbb` for an `rgb` or an `indexed` colour, a theme colour for one with `theme` (and a `tint`); nothing for the colour Excel starts with. */
const colorOf = (el: XmlElement | undefined, fallback: string): SparklineColor | undefined => {
  if (!el) return undefined;
  const theme = attr(el, "theme");
  if (theme !== undefined) {
    const n = Number(theme);
    const tint = Number(attr(el, "tint") ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 11) return undefined;
    return { theme: n, ...(Number.isFinite(tint) && tint !== 0 ? { tint: Math.max(-1, Math.min(1, tint)) } : {}) };
  }
  const hex = formatColor(el);
  return !hex || hex === fallback ? undefined : hex;
};

/** Reads the sparklines of a worksheet. A group that can't be read is left out and said so. */
export function readSparklines(root: XmlElement, sheet: Sheet, warnings: Set<string>): void {
  const groups: SparklineGroup[] = [];
  const taken = new Set<string>();
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    for (const el of childrenNamed(child(ext, "sparklineGroups"), "sparklineGroup")) {
      const items: SparklineGroup["items"] = [];
      for (const sp of childrenNamed(child(el, "sparklines"), "sparkline")) {
        const f = REF.exec(textOf(child(sp, "f")).trim());
        const pos = parseCell(textOf(child(sp, "sqref")).trim().replace(/\$/g, "").toUpperCase());
        if (!f || !pos) continue;
        const name = (f[1] ?? f[2])!.replace(/''/g, "'");
        const a = parseCell(`${f[3]!.toUpperCase()}${f[4]}`)!;
        const z = f[5] ? parseCell(`${f[5].toUpperCase()}${f[6]}`)! : a;
        const cell = cellAddress(pos.row, pos.col);
        if (taken.has(cell)) continue;
        taken.add(cell);
        items.push({ cell, source: chartRefText(name, { r1: Math.min(a.row, z.row), c1: Math.min(a.col, z.col), r2: Math.max(a.row, z.row), c2: Math.max(a.col, z.col) }) });
      }
      const type = attr(el, "type");
      const g: SparklineGroup = { id: createId("spark_"), type: type === "column" ? "column" : type === "stacked" ? "winloss" : "line", items };
      for (const [tag, key, def] of [["colorSeries", "color", SPARKLINE_COLORS.series], ["colorNegative", "negativeColor", SPARKLINE_COLORS.negative], ["colorMarkers", "markerColor", SPARKLINE_COLORS.marker], ["colorFirst", "firstColor", SPARKLINE_COLORS.first], ["colorLast", "lastColor", SPARKLINE_COLORS.last], ["colorHigh", "highColor", SPARKLINE_COLORS.high], ["colorLow", "lowColor", SPARKLINE_COLORS.low], ["colorAxis", "axisColor", SPARKLINE_COLORS.axis]] as const) {
        const c = colorOf(child(el, tag), def);
        if (c) g[key] = c;
      }
      for (const [name, key] of [["markers", "markers"], ["high", "high"], ["low", "low"], ["first", "first"], ["last", "last"], ["negative", "negative"], ["displayXAxis", "showAxis"], ["displayHidden", "showHidden"], ["rightToLeft", "rightToLeft"]] as const) {
        if (truthy(attr(el, name))) g[key] = true;
      }
      if (truthy(attr(el, "dateAxis"))) {
        const f = REF.exec(textOf(child(el, "f")).trim());
        if (f) {
          const a = parseCell(`${f[3]!.toUpperCase()}${f[4]}`)!;
          const z = f[5] ? parseCell(`${f[5].toUpperCase()}${f[6]}`)! : a;
          g.dateAxis = chartRefText((f[1] ?? f[2])!.replace(/''/g, "'"), { r1: Math.min(a.row, z.row), c1: Math.min(a.col, z.col), r2: Math.max(a.row, z.row), c2: Math.max(a.col, z.col) });
        }
      }
      const weight = Number(attr(el, "lineWeight"));
      if (Number.isFinite(weight) && weight > 0 && weight !== 0.75) g.lineWeight = weight;
      const empty = attr(el, "displayEmptyCellsAs");
      if (empty === "zero" || empty === "span") g.emptyAs = empty;
      for (const [axis, manual, key] of [["minAxisType", "manualMin", "min"], ["maxAxisType", "manualMax", "max"]] as const) {
        const kind = attr(el, axis);
        const n = Number(attr(el, manual));
        if (kind === "group") g[key] = "group";
        else if (kind === "custom" && attr(el, manual) !== undefined && Number.isFinite(n)) g[key] = n;
      }
      try {
        if (items.length) groups.push(cleanSparklines(g));
      } catch {
        warnings.add("Some sparklines could not be read and were left out");
      }
    }
  }
  if (groups.length) sheet.sparklines = groups;
}
