import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { fileFont, readFontName } from "./xlsx-fonts";
import { parseRange, rangeAddress, cellAddress, type Bounds } from "./address";
import { parseFormula } from "./formula";
import { mapNodes } from "./refs";
import type { Border, BorderStyle, IconRef, CellBorders, CellRuleOperator, CfValue, ConditionalRule, ConditionalStyle, DatePeriod, IconSetName, IconThreshold, Sheet, TableStyleBorders, TableStylePart, TextRuleOperator } from "./model";
import { BORDER_SIDES, ICON_SETS, ruleBounds } from "./rule";

/*
 * Borders, colours and conditional formats of an .xlsx file. Borders live in the style sheet (a table that cell styles
 * point at); a conditional format is a rule on the worksheet that points at a `dxf`, a small style (font, fill, border) in
 * the same table; colour scales, bars and icons carry their own settings.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const flag = (v: string | undefined, fallback = false) => (v === undefined ? fallback : v === "1" || v === "true");

/** Excel's own number formats, by number (a file names the others itself). */
export const BUILTIN_FORMATS: Record<number, string> = {
  1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
  14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
  22: "m/d/yyyy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

// ================= colours =================

/** The default Office palette, in the order a `theme` index counts them: light 1, dark 1, light 2, dark 2, six accents. */
export const OFFICE_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
/** Office's hyperlink and followed-hyperlink colours: theme numbers 10 and 11. */
export const OFFICE_HYPERLINKS = ["0563C1", "954F72"];

const INDEXED = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF " +
  "000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
  "3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

/** The colours of a workbook's theme (from `xl/theme/theme1.xml`), or the Office ones. */
export function readTheme(root: XmlElement | undefined): string[] {
  const scheme = child(child(root, "themeElements"), "clrScheme");
  if (!scheme) return [...OFFICE_THEME, ...OFFICE_HYPERLINKS];
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map((name, i) => {
    const c = child(scheme, name)?.children.find((x): x is XmlElement => typeof x !== "string");
    const v = attr(c, "lastClr") ?? attr(c, "val");
    return v && /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : (OFFICE_THEME[i] ?? OFFICE_HYPERLINKS[i - 10]!);
  });
}

/**
 * Lightens (tint above 0) or darkens (below 0) a colour the way Excel does: in whole numbers on a scale of 240, by the
 * colour's lightness. That gives the shades Excel's colour picker names ("Blue, Accent 1, Lighter 80%" is `d9e1f2`).
 */
export function tinted(hex: string, tint: number): string {
  const MAX = 240;
  const RGB = 255;
  const t = Math.trunc;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  let l = t(((hi + lo) * MAX + RGB) / (2 * RGB));
  let h = t((MAX * 2) / 3);
  let s = 0;
  if (hi !== lo) {
    const d = hi - lo;
    s = l <= t(MAX / 2) ? t((d * MAX + t((hi + lo) / 2)) / (hi + lo)) : t((d * MAX + t((2 * RGB - hi - lo) / 2)) / (2 * RGB - hi - lo));
    const part = (c: number) => t(((hi - c) * t(MAX / 6) + t(d / 2)) / d);
    h = r === hi ? part(b) - part(g) : g === hi ? t(MAX / 3) + part(r) - part(b) : t((2 * MAX) / 3) + part(g) - part(r);
    if (h < 0) h += MAX;
    if (h > MAX) h -= MAX;
  }
  l = tint < 0 ? t(l * (1 + tint)) : t(l * (1 - tint) + (MAX - MAX * (1 - tint)));
  const out = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  if (s === 0) return out(Math.ceil((l * RGB) / MAX - 0.5)).repeat(3); // greys round to the nearest, a half going down (Excel: darker 15% of white is d9d9d9, darker 50% is 7f7f7f)
  const m2 = l <= t(MAX / 2) ? t((l * (MAX + s) + t(MAX / 2)) / MAX) : l + s - t((l * s + t(MAX / 2)) / MAX);
  const m1 = 2 * l - m2;
  const hue = (at: number) => {
    if (at < 0) at += MAX;
    if (at > MAX) at -= MAX;
    if (at < t(MAX / 6)) return m1 + t(((m2 - m1) * at + t(MAX / 12)) / t(MAX / 6));
    if (at < t(MAX / 2)) return m2;
    if (at < t((MAX * 2) / 3)) return m1 + t(((m2 - m1) * (t((MAX * 2) / 3) - at) + t(MAX / 12)) / t(MAX / 6));
    return m1;
  };
  const channel = (at: number) => out(t((hue(at) * RGB + t(MAX / 2)) / MAX));
  return channel(h + t(MAX / 3)) + channel(h) + channel(h - t(MAX / 3));
}

/** A colour element (`rgb`, `theme` with a `tint`, or `indexed`) as `#rrggbb`; undefined for automatic or missing colours. */
export function colorOf(color: XmlElement | undefined, theme: readonly string[] = [...OFFICE_THEME, ...OFFICE_HYPERLINKS]): string | undefined {
  if (!color) return undefined;
  const rgb = attr(color, "rgb");
  let hex: string | undefined;
  if (rgb && /^[0-9a-fA-F]{8}$/.test(rgb)) hex = rgb.slice(2);
  else if (rgb && /^[0-9a-fA-F]{6}$/.test(rgb)) hex = rgb;
  else if (attr(color, "theme") !== undefined) hex = theme[Number(attr(color, "theme"))];
  else if (attr(color, "indexed") !== undefined) hex = INDEXED[Number(attr(color, "indexed"))];
  if (!hex) return undefined;
  const tint = Number(attr(color, "tint") ?? 0);
  if (tint && Number.isFinite(tint)) hex = tinted(hex, Math.max(-1, Math.min(1, tint)));
  return "#" + hex.toLowerCase();
}

const fileColor = (c: string) => `rgb="FF${c.slice(1).toUpperCase()}"`;

// ================= borders =================

const READ_STYLES: Record<string, BorderStyle> = {
  thin: "thin", medium: "medium", thick: "thick", dashed: "dashed", dotted: "dotted", double: "double", hair: "hair",
  mediumDashed: "dashed", dashDot: "dashed", mediumDashDot: "dashed", dashDotDot: "dotted", mediumDashDotDot: "dotted", slantDashDot: "dashed",
};

/** The `border` element of a style sheet as the lines it draws. */
export function readBorder(el: XmlElement | undefined, theme: readonly string[]): CellBorders | undefined {
  const out: CellBorders = {};
  for (const side of BORDER_SIDES) {
    const line = child(el, side) ?? child(el, side === "left" ? "start" : side === "right" ? "end" : "-");
    const style = READ_STYLES[attr(line, "style") ?? ""];
    if (!style) continue;
    const color = colorOf(child(line, "color"), theme);
    const b: Border = { style };
    if (color && color !== "#000000") b.color = color;
    out[side] = b;
  }
  // One diagonal line, drawn up, down or both, as its flags say.
  const diagonal = child(el, "diagonal");
  const dStyle = READ_STYLES[attr(diagonal, "style") ?? ""];
  if (dStyle) {
    const color = colorOf(child(diagonal, "color"), theme);
    const line: Border = { style: dStyle, ...(color && color !== "#000000" ? { color } : {}) };
    if (flag(attr(el, "diagonalUp"))) out.diagonalUp = line;
    if (flag(attr(el, "diagonalDown"))) out.diagonalDown = line;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A `border` element for the style sheet. */
export function borderXml(b: TableStyleBorders | undefined, tag = "border"): string {
  const line = (name: string, l: Border | undefined) => (l ? `<${name} style="${l.style}"><color ${fileColor(l.color ?? "#000000")}/></${name}>` : `<${name}/>`);
  // A file keeps one diagonal line, drawn up, down or both.
  const diag = b?.diagonalUp ?? b?.diagonalDown;
  const flags = `${b?.diagonalUp ? ' diagonalUp="1"' : ""}${b?.diagonalDown ? ' diagonalDown="1"' : ""}`;
  return `<${tag}${flags}>${line("left", b?.left)}${line("right", b?.right)}${line("top", b?.top)}${line("bottom", b?.bottom)}${tag === "border" || diag ? line("diagonal", diag) : ""}${b?.vertical ? line("vertical", b.vertical) : ""}${b?.horizontal ? line("horizontal", b.horizontal) : ""}</${tag}>`;
}

// ================= dxf: the style a rule applies =================

/** The `dxf` styles of a style sheet, in order (a rule points at one by its position). */
export function readDxfs(root: XmlElement | undefined, theme: readonly string[]): ConditionalStyle[] {
  return childrenNamed(child(root, "dxfs"), "dxf").map((dxf) => readDxf(dxf, theme));
}

/** One `dxf` element (or Excel 2010's `x14:dxf`) as a style. */
export function readDxf(dxf: XmlElement, theme: readonly string[]): ConditionalStyle {
  return readDxfLooks(dxf, theme, false);
}

/** One `dxf` element of a table style, whose lines may run between cells as well. */
export function readTableStyleDxf(dxf: XmlElement, theme: readonly string[]): TableStylePart {
  return readDxfLooks(dxf, theme, true);
}

function readDxfLooks(dxf: XmlElement, theme: readonly string[], inner: boolean): TableStylePart {
  {
    const s: TableStylePart = {};
    const font = child(dxf, "font");
    if (child(font, "b") && attr(child(font, "b"), "val") !== "0" && attr(child(font, "b"), "val") !== "false") s.bold = true;
    if (child(font, "i") && attr(child(font, "i"), "val") !== "0" && attr(child(font, "i"), "val") !== "false") s.italic = true;
    if (child(font, "strike") && attr(child(font, "strike"), "val") !== "0" && attr(child(font, "strike"), "val") !== "false") s.strike = true;
    if (child(font, "u") && attr(child(font, "u"), "val") !== "none") s.underline = true;
    const color = colorOf(child(font, "color"), theme);
    if (color) s.color = color;
    const pattern = child(child(dxf, "fill"), "patternFill");
    // In a dxf the colour of a solid fill is the background colour.
    const fill = attr(pattern, "patternType") === "none" ? undefined : colorOf(child(pattern, "bgColor"), theme) ?? (attr(pattern, "patternType") === "solid" ? colorOf(child(pattern, "fgColor"), theme) : undefined);
    if (fill) s.fill = fill;
    const border: TableStyleBorders | undefined = readBorder(child(dxf, "border"), theme);
    if (border) s.border = border;
    if (inner) {
      // Lines between cells: `horizontal` between rows, `vertical` between columns.
      const lines = child(dxf, "border");
      for (const name of ["horizontal", "vertical"] as const) {
        const line = child(lines, name);
        const style = READ_STYLES[attr(line, "style") ?? ""];
        if (!style) continue;
        const color = colorOf(child(line, "color"), theme);
        (s.border ??= {})[name] = { style, ...(color && color !== "#000000" ? { color } : {}) };
      }
    }
    const al = child(dxf, "alignment");
    if (al) {
      const h = attr(al, "horizontal");
      const v = attr(al, "vertical");
      const indent = Number(attr(al, "indent") ?? 0);
      if (h === "left" || h === "center" || h === "right") s.align = h;
      if (v === "top" || v === "bottom") s.vAlign = v;
      else if (v === "center") s.vAlign = "middle";
      if (attr(al, "wrapText") === "1" || attr(al, "wrapText") === "true") s.wrap = true;
      if (Number.isInteger(indent) && indent >= 1 && indent <= 15) s.indent = indent;
    }
    const numFmt = child(dxf, "numFmt");
    const code = attr(numFmt, "formatCode") ?? BUILTIN_FORMATS[Number(attr(numFmt, "numFmtId"))];
    if (code && code !== "General") s.fmt = code;
    const size = Number(attr(child(font, "sz"), "val"));
    if (size >= 1 && size <= 400) s.fontSize = size;
    const name = readFontName(font, "name");
    if (name) s.fontFamily = name;
    return s;
  }
}

/** One `dxf` element. */
export function dxfXml(s: TableStylePart, numFmtId = 200): string {
  const font = s.bold || s.italic || s.strike || s.underline || s.color || s.fontSize || s.fontFamily ? `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}${s.strike ? "<strike/>" : ""}${s.underline ? "<u/>" : ""}${s.fontSize ? `<sz val="${s.fontSize}"/>` : ""}${s.color ? `<color ${fileColor(s.color)}/>` : ""}${s.fontFamily ? `<name val="${esc(fileFont(s.fontFamily))}"/>` : ""}</font>` : "";
  const numFmt = s.fmt ? `<numFmt numFmtId="${numFmtId}" formatCode="${esc(s.fmt)}"/>` : "";
  const fill = s.fill ? `<fill><patternFill patternType="solid"><fgColor ${fileColor(s.fill)}/><bgColor ${fileColor(s.fill)}/></patternFill></fill>` : "";
  const border = s.border ? borderXml(s.border).replace("<diagonal/>", "") : "";
  // Alignment, indent and wrapping sit between the fill and the lines (a pivot table's kept formats hold them).
  const align = s.align || s.vAlign || s.wrap || s.indent ? `<alignment${s.align || s.indent ? ` horizontal="${s.align ?? "left"}"` : ""}${s.vAlign ? ` vertical="${s.vAlign === "middle" ? "center" : s.vAlign}"` : ""}${s.wrap ? ' wrapText="1"' : ""}${s.indent ? ` indent="${s.indent}"` : ""}/>` : "";
  return `<dxf>${font}${numFmt}${fill}${align}${border}</dxf>`;
}

// ================= conditional formats =================

const CELL_OPS: Record<string, CellRuleOperator> = {
  lessThan: "lessThan", lessThanOrEqual: "lessThanOrEqual", equal: "equal", notEqual: "notEqual", greaterThanOrEqual: "greaterThanOrEqual", greaterThan: "greaterThan", between: "between", notBetween: "notBetween",
};
const PERIODS: Record<string, DatePeriod> = {
  today: "today", yesterday: "yesterday", tomorrow: "tomorrow", last7Days: "last7Days", thisWeek: "thisWeek", lastWeek: "lastWeek", nextWeek: "nextWeek", thisMonth: "thisMonth", lastMonth: "lastMonth", nextMonth: "nextMonth",
};

function readValue(el: XmlElement | undefined, strip: (f: string) => string, auto = false): CfValue | null {
  const type = attr(el, "type");
  // Excel 2010 writes the value as a child (`<xm:f>`); the older form as an attribute.
  const val = attr(el, "val") ?? (child(el, "f") ? textOf(child(el, "f")).trim() : undefined);
  switch (type) {
    case "min":
      return { type: "min" };
    case "autoMin":
      // Excel's Automatic: only a data bar can say so; a scale or icon set takes it as the lowest value.
      return { type: auto ? "auto" : "min" };
    case "max":
      return { type: "max" };
    case "autoMax":
      return { type: auto ? "auto" : "max" };
    case "num":
    case "percent":
    case "percentile": {
      const n = Number(val);
      return val !== undefined && Number.isFinite(n) ? { type, value: n } : null;
    }
    case "formula":
      return val ? { type: "formula", value: strip(val.replace(/^=/, "")) } : null;
    default:
      return null;
  }
}

/** Excel 2010 keeps some rules (and more settings of data bars and icon sets) in an extension of the worksheet. */
interface Extended {
  el: XmlElement;
  sqref: string;
}

function readExtended(root: XmlElement): Extended[] {
  const out: Extended[] = [];
  for (const ext of childrenNamed(child(root, "extLst"), "ext"))
    for (const block of childrenNamed(child(ext, "conditionalFormattings"), "conditionalFormatting"))
      for (const rule of childrenNamed(block, "cfRule")) out.push({ el: rule, sqref: textOf(child(block, "sqref")).trim() });
  return out;
}

const rangesOf = (sqref: string): string[] => {
  const out: string[] = [];
  for (const r of sqref.split(/\s+/)) {
    const b = r ? parseRange(r.replace(/\$/g, "")) : null;
    if (b) out.push(rangeAddress(b));
  }
  return out;
};

/**
 * Reads the conditional formats of a worksheet, most important first, with what Excel 2010 keeps in the extension: more
 * settings of data bars and icon sets, and rules that only it can hold (those that point at other sheets). What can't be
 * read (kinds Pli doesn't have) is counted in `skipped`.
 */
export function readConditional(root: XmlElement, dxfs: readonly ConditionalStyle[], strip: (f: string) => string, newId: () => string, theme: readonly string[] = [...OFFICE_THEME, ...OFFICE_HYPERLINKS]): { rules: ConditionalRule[]; skipped: number; byPriority: Map<number, ConditionalRule> } {
  const found: { priority: number; order: number; rule: ConditionalRule }[] = [];
  const extended = readExtended(root);
  const byId = new Map(extended.map((e) => [attr(e.el, "id") ?? "", e]));
  const used = new Set<string>();
  let skipped = 0;
  let order = 0;
  for (const block of childrenNamed(root, "conditionalFormatting")) {
    const ranges = rangesOf(attr(block, "sqref") ?? "");
    for (const el of childrenNamed(block, "cfRule")) {
      order++;
      const rule = ranges.length ? readRule(el, ranges, dxfs, strip, newId) : null;
      if (rule) {
        // The extension has more to say about this rule when it points at one.
        const link = childrenNamed(child(el, "extLst"), "ext").map((x) => textOf(child(x, "id")).trim()).find((id) => byId.has(id));
        if (link) {
          used.add(link);
          extend(rule, byId.get(link)!.el, strip, theme);
        }
        found.push({ priority: Number(attr(el, "priority") ?? order), order, rule });
      } else skipped++;
    }
  }
  for (const e of extended) {
    if (used.has(attr(e.el, "id") ?? "")) continue;
    order++;
    const ranges = rangesOf(e.sqref);
    const rule = ranges.length ? readExtendedRule(e.el, ranges, strip, newId, theme) : null;
    // Excel keeps an icon set of your own as a plain rule and an extension rule on the same cells, unlinked: they are one rule.
    const twin = rule?.kind === "iconSet" && rule.custom ? found.find((f) => f.rule.kind === "iconSet" && !f.rule.custom && f.rule.set === rule.set && f.rule.ranges.join(" ") === rule.ranges.join(" ")) : undefined;
    if (rule && twin && twin.rule.kind === "iconSet" && rule.kind === "iconSet") {
      twin.rule.custom = rule.custom;
      if (rule.reverse) twin.rule.reverse = true;
      if (rule.hideValue) twin.rule.hideValue = true;
      twin.rule.thresholds = rule.thresholds;
    } else if (rule) found.push({ priority: Number(attr(e.el, "priority") ?? order), order, rule });
    else skipped++;
  }
  found.sort((a, b) => a.priority - b.priority || a.order - b.order);
  return { rules: found.map((f) => f.rule), skipped, byPriority: new Map(found.map((f) => [f.priority, f.rule])) };
}

const rgbOf = (el: XmlElement | undefined, theme: readonly string[]) => colorOf(el, theme);

/** Applies what Excel 2010 says about a data bar or an icon set to the rule read from the older part of the file. */
function extend(rule: ConditionalRule, x: XmlElement, strip: (f: string) => string, theme: readonly string[]): void {
  if (rule.kind === "dataBar") {
    const bar = child(x, "dataBar");
    if (!bar) return;
    const num = (a: string) => {
      const n = Number(attr(bar, a));
      return attr(bar, a) !== undefined && Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
    };
    const lo = num("minLength");
    const hi = num("maxLength");
    if (lo !== undefined) lo === 0 ? delete rule.minLength : (rule.minLength = lo);
    if (hi !== undefined) hi === 100 ? delete rule.maxLength : (rule.maxLength = hi);
    if (attr(bar, "gradient") !== undefined && !flag(attr(bar, "gradient"), true)) rule.solid = true;
    else delete rule.solid;
    if (flag(attr(bar, "border"))) rule.border = true;
    else delete rule.border;
    const axis = attr(bar, "axisPosition");
    if (axis === "middle" || axis === "none") rule.axis = axis;
    else delete rule.axis;
    const axisColor = rgbOf(child(bar, "axisColor"), theme);
    if (axisColor) rule.axisColor = axisColor;
    else delete rule.axisColor;
    // Negative bars take the positive colour unless the file says they don't.
    const negative = rgbOf(child(bar, "negativeFillColor"), theme);
    if (negative && !flag(attr(bar, "negativeBarColorSameAsPositive"))) rule.negativeColor = negative;
    else delete rule.negativeColor;
    // The border's colours, the direction the bars grow in, and the extension's own start and end points (which may be automatic).
    const edge = rgbOf(child(bar, "borderColor"), theme);
    if (rule.border && edge && edge !== rule.color) rule.borderColor = edge;
    else delete rule.borderColor;
    const negativeEdge = rgbOf(child(bar, "negativeBorderColor"), theme);
    if (rule.border && negativeEdge && !flag(attr(bar, "negativeBarBorderColorSameAsPositive"), true) && negativeEdge !== (rule.negativeColor ?? rule.color)) rule.negativeBorderColor = negativeEdge;
    else delete rule.negativeBorderColor;
    if (attr(bar, "direction") === "rightToLeft") rule.rtl = true;
    else delete rule.rtl;
    const [min, max] = childrenNamed(bar, "cfvo").map((c) => readValue(c, strip, true));
    if (min) rule.min = min;
    if (max) rule.max = max;
  } else if (rule.kind === "iconSet") {
    const icons = child(x, "iconSet");
    if (!icons) return;
    const set = attr(icons, "iconSet") as IconSetName | undefined;
    if (set && ICON_SETS[set] === ICON_SETS[rule.set]) rule.set = set;
    if (flag(attr(icons, "custom"))) {
      const custom = readCustomIcons(icons, ICON_SETS[rule.set]);
      if (custom) rule.custom = custom;
    }
  }
}

/** The icon chosen for each step of a custom icon set, or null when the file doesn't give one for each. */
function readCustomIcons(icons: XmlElement, count: number): (IconRef | null)[] | null {
  const list = childrenNamed(icons, "cfIcon").map((c): IconRef | null => {
    const set = attr(c, "iconSet") as IconSetName | undefined;
    const index = Number(attr(c, "iconId"));
    return set && ICON_SETS[set] && Number.isInteger(index) && index >= 0 && index < ICON_SETS[set] ? { set, index } : null;
  });
  return list.length === count ? list : null;
}

/** A rule that only Excel 2010's extension can hold: a formula that points at another sheet, or an icon set of its own. */
function readExtendedRule(el: XmlElement, ranges: string[], strip: (f: string) => string, newId: () => string, theme: readonly string[]): ConditionalRule | null {
  const base = { id: newId(), ranges, ...(flag(attr(el, "stopIfTrue")) ? { stop: true as const } : {}) };
  const formulas = childrenNamed(el, "f").map((f) => strip(textOf(f).trim().replace(/^=/, "")));
  const dxf = child(el, "dxf");
  const style: ConditionalStyle = dxf ? readDxf(dxf, theme) : {};
  switch (attr(el, "type")) {
    case "expression":
      return formulas[0] ? { ...base, kind: "formula", formula: formulas[0], style } : null;
    case "cellIs": {
      const op = CELL_OPS[attr(el, "operator") ?? ""];
      const two = op === "between" || op === "notBetween";
      if (!op || formulas.length < (two ? 2 : 1) || formulas.some((f) => f === "")) return null;
      return { ...base, kind: "cell", op, values: formulas.slice(0, two ? 2 : 1), style };
    }
    case "iconSet": {
      const icons = child(el, "iconSet");
      const set = attr(icons, "iconSet") as IconSetName | undefined;
      if (!icons || !set || !ICON_SETS[set]) return null;
      const cfvos = childrenNamed(icons, "cfvo");
      if (cfvos.length !== ICON_SETS[set]) return null;
      const thresholds: IconThreshold[] = [];
      for (const c of cfvos.slice(1)) {
        const v = readValue(c, strip);
        if (!v || v.type === "min" || v.type === "max") return null;
        thresholds.push({ ...v, ...(attr(c, "gte") !== undefined && !flag(attr(c, "gte")) ? { gte: false as const } : {}) });
      }
      const custom = flag(attr(icons, "custom")) ? readCustomIcons(icons, ICON_SETS[set]) : null;
      return { ...base, kind: "iconSet", set, thresholds, ...(flag(attr(icons, "reverse")) ? { reverse: true as const } : {}), ...(attr(icons, "showValue") !== undefined && !flag(attr(icons, "showValue")) ? { hideValue: true as const } : {}), ...(custom ? { custom } : {}) };
    }
    // Every other kind can be kept in the extension too (Excel does when the rule points at another sheet): the same readings.
    default:
      return readRule(el, ranges, [], strip, newId, { formulas, style });
  }
}

/** A rule as Excel 2010 keeps it in the extension: the formulas are `xm:f` children and the style is inline. */
interface Inline {
  formulas: string[];
  style: ConditionalStyle;
}

function readRule(el: XmlElement, ranges: string[], dxfs: readonly ConditionalStyle[], strip: (f: string) => string, newId: () => string, inline?: Inline): ConditionalRule | null {
  const base = { id: newId(), ranges, ...(flag(attr(el, "stopIfTrue")) ? { stop: true as const } : {}) };
  const formulas = inline ? inline.formulas : childrenNamed(el, "formula").map((f) => strip(textOf(f).trim().replace(/^=/, "")));
  const dxfId = attr(el, "dxfId");
  const style: ConditionalStyle = inline ? inline.style : dxfId === undefined ? {} : { ...dxfs[Number(dxfId)] };
  switch (attr(el, "type")) {
    case "cellIs": {
      const op = CELL_OPS[attr(el, "operator") ?? ""];
      const two = op === "between" || op === "notBetween";
      if (!op || formulas.length < (two ? 2 : 1) || formulas.some((f) => f === "")) return null;
      return { ...base, kind: "cell", op, values: formulas.slice(0, two ? 2 : 1), style };
    }
    case "expression":
      return formulas[0] ? { ...base, kind: "formula", formula: formulas[0], style } : null;
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      const text = attr(el, "text");
      // Text that is a reference to a cell (on another sheet, perhaps) has no text of its own: the test Excel wrote for it is the rule.
      if (!text) return formulas[0] ? { ...base, kind: "formula", formula: formulas[0], style } : null;
      const type = attr(el, "type");
      const op: TextRuleOperator = type === "containsText" ? "contains" : type === "notContainsText" ? "notContains" : type === "beginsWith" ? "beginsWith" : "endsWith";
      return { ...base, kind: "text", op, text, style };
    }
    case "containsBlanks":
      return { ...base, kind: "blanks", style };
    case "notContainsBlanks":
      return { ...base, kind: "noBlanks", style };
    case "containsErrors":
      return { ...base, kind: "errors", style };
    case "notContainsErrors":
      return { ...base, kind: "noErrors", style };
    case "duplicateValues":
      return { ...base, kind: "duplicates", style };
    case "uniqueValues":
      return { ...base, kind: "uniques", style };
    case "top10": {
      const rank = Number(attr(el, "rank") ?? 10);
      const percent = flag(attr(el, "percent"));
      if (!Number.isInteger(rank) || rank < 1 || rank > (percent ? 100 : 1000)) return null;
      return { ...base, kind: "top", rank, ...(percent ? { percent: true as const } : {}), ...(flag(attr(el, "bottom")) ? { bottom: true as const } : {}), style };
    }
    case "aboveAverage": {
      const sd = Number(attr(el, "stdDev") ?? 0);
      return { ...base, kind: "average", above: flag(attr(el, "aboveAverage"), true), ...(flag(attr(el, "equalAverage")) ? { equal: true as const } : {}), ...([1, 2, 3].includes(sd) ? { stdDev: sd } : {}), style };
    }
    case "timePeriod": {
      const period = PERIODS[attr(el, "timePeriod") ?? ""];
      return period ? { ...base, kind: "dates", period, style } : null;
    }
    case "colorScale": {
      const scale = child(el, "colorScale");
      const points = childrenNamed(scale, "cfvo").map((c) => readValue(c, strip));
      const colors = childrenNamed(scale, "color").map((c) => colorOf(c));
      if ((points.length !== 2 && points.length !== 3) || colors.length !== points.length || points.some((p) => !p) || colors.some((c) => !c)) return null;
      return { ...base, kind: "colorScale", stops: points.map((p, i) => ({ ...p!, color: colors[i]! })) };
    }
    case "dataBar": {
      const bar = child(el, "dataBar");
      const [min, max] = childrenNamed(bar, "cfvo").map((c) => readValue(c, strip));
      const color = colorOf(child(bar, "color"));
      if (!min || !max || !color) return null;
      // The older form's bars run from 10% to 90% of the cell's width unless it says otherwise.
      const length = (a: string, fallback: number) => {
        const n = Number(attr(bar, a));
        return attr(bar, a) !== undefined && Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
      };
      const minLength = length("minLength", 10);
      const maxLength = Math.max(minLength, length("maxLength", 90));
      return { ...base, kind: "dataBar", min, max, color, ...(minLength !== 0 ? { minLength } : {}), ...(maxLength !== 100 ? { maxLength } : {}), ...(attr(bar, "showValue") !== undefined && !flag(attr(bar, "showValue")) ? { hideValue: true as const } : {}) };
    }
    case "iconSet": {
      const icons = child(el, "iconSet");
      const set = (attr(icons, "iconSet") ?? "3TrafficLights1") as IconSetName;
      if (!ICON_SETS[set]) return null;
      const cfvos = childrenNamed(icons, "cfvo");
      if (cfvos.length !== ICON_SETS[set]) return null;
      const thresholds: IconThreshold[] = [];
      for (const c of cfvos.slice(1)) {
        const v = readValue(c, strip);
        if (!v || v.type === "min" || v.type === "max") return null;
        thresholds.push({ ...v, ...(attr(c, "gte") !== undefined && !flag(attr(c, "gte")) ? { gte: false as const } : {}) });
      }
      return { ...base, kind: "iconSet", set, thresholds, ...(flag(attr(icons, "reverse")) ? { reverse: true as const } : {}), ...(attr(icons, "showValue") !== undefined && !flag(attr(icons, "showValue")) ? { hideValue: true as const } : {}) };
    }
    default:
      return null;
  }
}

/** The formulas Excel writes for the kinds of rule that are tests on text, blanks and dates (it reads rules by `type`, but writes these too). */
function testFormula(rule: ConditionalRule, a: string): string | null {
  switch (rule.kind) {
    case "text": {
      const t = `"${rule.text.replace(/"/g, '""')}"`;
      switch (rule.op) {
        case "contains": return `NOT(ISERROR(SEARCH(${t},${a})))`;
        case "notContains": return `ISERROR(SEARCH(${t},${a}))`;
        case "beginsWith": return `LEFT(${a},LEN(${t}))=${t}`;
        case "endsWith": return `RIGHT(${a},LEN(${t}))=${t}`;
      }
      return null;
    }
    case "blanks": return `LEN(TRIM(${a}))=0`;
    case "noBlanks": return `LEN(TRIM(${a}))>0`;
    case "errors": return `ISERROR(${a})`;
    case "noErrors": return `NOT(ISERROR(${a}))`;
    case "dates": {
      switch (rule.period) {
        case "today": return `FLOOR(${a},1)=TODAY()`;
        case "yesterday": return `FLOOR(${a},1)=TODAY()-1`;
        case "tomorrow": return `FLOOR(${a},1)=TODAY()+1`;
        case "last7Days": return `AND(TODAY()-FLOOR(${a},1)<=6,FLOOR(${a},1)<=TODAY())`;
        case "thisWeek": return `AND(TODAY()-ROUNDDOWN(${a},0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(${a},0)-TODAY()<=7-WEEKDAY(TODAY()))`;
        case "lastWeek": return `AND(TODAY()-ROUNDDOWN(${a},0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(${a},0)<(WEEKDAY(TODAY())+7))`;
        case "nextWeek": return `AND(ROUNDDOWN(${a},0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(${a},0)-TODAY()<(15-WEEKDAY(TODAY())))`;
        case "thisMonth": return `AND(MONTH(${a})=MONTH(TODAY()),YEAR(${a})=YEAR(TODAY()))`;
        case "lastMonth": return `AND(MONTH(${a})=MONTH(EDATE(TODAY(),0-1)),YEAR(${a})=YEAR(EDATE(TODAY(),0-1)))`;
        case "nextMonth": return `AND(MONTH(${a})=MONTH(EDATE(TODAY(),0+1)),YEAR(${a})=YEAR(EDATE(TODAY(),0+1)))`;
      }
      return null;
    }
    default: return null;
  }
}

const pointXml = (p: CfValue, file: (f: string) => string, extra = "") =>
  `<cfvo type="${p.type}"${p.value !== undefined ? ` val="${esc(p.type === "formula" ? file(String(p.value)) : String(p.value))}"` : ""}${extra}/>`;

/** An Excel 2010 `cfvo`: the value is a child element. */
const pointXml14 = (p: CfValue, file: (f: string) => string, extra = "") =>
  p.value === undefined ? `<x14:cfvo type="${p.type}"${extra}/>` : `<x14:cfvo type="${p.type}"${extra}><xm:f>${esc(p.type === "formula" ? file(String(p.value)) : String(p.value))}</xm:f></x14:cfvo>`;

/** The sets Excel 2010 added, which only its extension can name. */
const NEW_SETS = new Set<string>(["3Stars", "3Triangles", "5Boxes"]);

/** Whether a formula points at a cell on a sheet by name, which Excel 2007's form of a rule can't hold. */
function namesASheet(f: string): boolean {
  try {
    let found = false;
    mapNodes(parseFormula(f), (n) => {
      if (n.t === "ref" && n.sheet !== undefined) found = true;
      return n;
    });
    return found;
  } catch {
    return false;
  }
}

/** Whether a threshold is a formula that points at another sheet. */
const sheetPoint = (p: CfValue): boolean => p.type === "formula" && namesASheet(String(p.value));

/** A rule's id in the extension: they only have to be unique in the sheet. */
const guid = (i: number) => `{B0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}}`;

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM = "http://schemas.microsoft.com/office/excel/2006/main";

/** The `x14:dataBar` settings Excel 2010 keeps beyond what the older form has. */
function dataBarExtension(rule: Extract<ConditionalRule, { kind: "dataBar" }>, file: (f: string) => string): string {
  const same = rule.negativeColor === undefined;
  const sameEdge = rule.negativeBorderColor === undefined;
  // Excel's automatic ends are `autoMin` and `autoMax` here.
  const end = (p: CfValue, type: string) => (p.type === "auto" ? pointXml14({ type: type as CfValue["type"] }, file).replace(`type="${type}"`, `type="auto${type === "min" ? "Min" : "Max"}"`) : pointXml14(p, file));
  return (
    `<x14:dataBar minLength="${rule.minLength ?? 0}" maxLength="${rule.maxLength ?? 100}"${rule.solid ? ' gradient="0"' : ""}${rule.border ? ' border="1"' : ""} negativeBarColorSameAsPositive="${same ? 1 : 0}"${rule.border && !sameEdge ? ' negativeBarBorderColorSameAsPositive="0"' : ""} axisPosition="${rule.axis ?? "automatic"}"${rule.rtl ? ' direction="rightToLeft"' : ""}>` +
    `${end(rule.min, "min")}${end(rule.max, "max")}` +
    `${rule.border ? `<x14:borderColor ${fileColor(rule.borderColor ?? rule.color)}/>` : ""}${same ? "" : `<x14:negativeFillColor ${fileColor(rule.negativeColor!)}/>`}${rule.border && !sameEdge ? `<x14:negativeBorderColor ${fileColor(rule.negativeBorderColor!)}/>` : ""}${rule.axisColor ? `<x14:axisColor ${fileColor(rule.axisColor)}/>` : ""}` +
    `</x14:dataBar>`
  );
}

/** The `x14:iconSet`: the set (it may be one of Excel 2010's), the steps, and your own icons. */
function iconSetExtension(rule: Extract<ConditionalRule, { kind: "iconSet" }>, file: (f: string) => string): string {
  const icons = rule.custom ? rule.custom.map((c) => (c ? `<x14:cfIcon iconSet="${c.set}" iconId="${c.index}"/>` : '<x14:cfIcon iconSet="NoIcons" iconId="0"/>')).join("") : "";
  return `<x14:iconSet iconSet="${rule.set}"${rule.custom ? ' custom="1"' : ""}${rule.hideValue ? ' showValue="0"' : ""}${rule.reverse ? ' reverse="1"' : ""}>${pointXml14({ type: "percent", value: 0 }, file)}${rule.thresholds.map((t) => pointXml14(t, file, t.gte === false ? ' gte="0"' : "")).join("")}${icons}</x14:iconSet>`;
}

/**
 * The worksheet's conditional formats: one `conditionalFormatting` element per rule, numbered by their order, and the
 * extension (`ext`) that goes at the end of the worksheet for what Excel 2010 keeps there: the rest of a data bar's
 * settings, icon sets of its own or new to 2010, and rules that point at other sheets. `dxf` gives the position of a style
 * in the style sheet, and `inline` writes one in place.
 */
export function conditionalXml(sheet: Sheet, dxf: (s: ConditionalStyle) => number, file: (f: string) => string, inline: (s: ConditionalStyle) => string = (s) => dxfXml(s), pivots: ReadonlySet<string> = new Set()): { rules: string; ext: string } {
  const blocks14: string[] = [];
  const rules = (sheet.conditional ?? [])
    .map((rule, i) => {
      const bounds = ruleBounds(rule.ranges);
      const a = cellAddress(Math.min(...bounds.map((b: Bounds) => b.r1)), Math.min(...bounds.map((b: Bounds) => b.c1)));
      const head = `priority="${i + 1}"${rule.stop ? ' stopIfTrue="1"' : ""}`;
      const dx = "style" in rule ? ` dxfId="${dxf(rule.style)}"` : "";
      const formula = (f: string) => `<formula>${esc(file(f))}</formula>`;
      const link = (id: string) => `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="${X14}"><x14:id>${id}</x14:id></ext></extLst>`;
      const sqref = rule.ranges.join(" ");
      // Excel marks the extension block of a rule on a pivot table `pivot="1"` as well (it rewrote kit file 22 so).
      const pv = rule.pivot && pivots.has(rule.pivot.id) ? ' pivot="1"' : "";
      const standalone = (inner: string) => blocks14.push(`<x14:conditionalFormatting${pv} xmlns:xm="${XM}">${inner}<xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`);
      const x14dxf = "style" in rule ? `<x14:dxf>${inline(rule.style).replace(/^<dxf>|<\/dxf>$/g, "")}</x14:dxf>` : "";
      let body: string;
      switch (rule.kind) {
        case "cell":
          if (rule.values.some(namesASheet)) {
            standalone(`<x14:cfRule type="cellIs" ${head} operator="${rule.op}" id="${guid(i)}">${rule.values.map((v) => `<xm:f>${esc(file(v))}</xm:f>`).join("")}${x14dxf}</x14:cfRule>`);
            return "";
          }
          body = `<cfRule type="cellIs"${dx} ${head} operator="${rule.op}">${rule.values.map(formula).join("")}</cfRule>`;
          break;
        case "formula":
          if (namesASheet(rule.formula)) {
            standalone(`<x14:cfRule type="expression" ${head} id="${guid(i)}"><xm:f>${esc(file(rule.formula))}</xm:f>${x14dxf}</x14:cfRule>`);
            return "";
          }
          body = `<cfRule type="expression"${dx} ${head}>${formula(rule.formula)}</cfRule>`;
          break;
        case "text": {
          const type = rule.op === "contains" ? "containsText" : rule.op === "notContains" ? "notContainsText" : rule.op;
          const op = rule.op === "contains" ? ' operator="containsText"' : rule.op === "notContains" ? ' operator="notContains"' : rule.op === "beginsWith" ? ' operator="beginsWith"' : ' operator="endsWith"';
          body = `<cfRule type="${type}"${dx} ${head}${op} text="${esc(rule.text)}">${formula(testFormula(rule, a)!)}</cfRule>`;
          break;
        }
        case "blanks":
        case "noBlanks":
        case "errors":
        case "noErrors":
          body = `<cfRule type="${{ blanks: "containsBlanks", noBlanks: "notContainsBlanks", errors: "containsErrors", noErrors: "notContainsErrors" }[rule.kind]}"${dx} ${head}>${formula(testFormula(rule, a)!)}</cfRule>`;
          break;
        case "duplicates":
          body = `<cfRule type="duplicateValues"${dx} ${head}/>`;
          break;
        case "uniques":
          body = `<cfRule type="uniqueValues"${dx} ${head}/>`;
          break;
        case "top":
          body = `<cfRule type="top10"${dx} ${head} rank="${rule.rank}"${rule.percent ? ' percent="1"' : ""}${rule.bottom ? ' bottom="1"' : ""}/>`;
          break;
        case "average":
          body = `<cfRule type="aboveAverage"${dx} ${head}${rule.above ? "" : ' aboveAverage="0"'}${rule.equal ? ' equalAverage="1"' : ""}${rule.stdDev ? ` stdDev="${rule.stdDev}"` : ""}/>`;
          break;
        case "dates":
          body = `<cfRule type="timePeriod"${dx} ${head} timePeriod="${rule.period}">${formula(testFormula(rule, a)!)}</cfRule>`;
          break;
        case "colorScale":
          body = `<cfRule type="colorScale" ${head}><colorScale>${rule.stops.map((s) => pointXml(s, file)).join("")}${rule.stops.map((s) => `<color ${fileColor(s.color)}/>`).join("")}</colorScale></cfRule>`;
          break;
        case "dataBar": {
          // The older form has the colour and the lengths; the rest of the settings go in the extension, linked by an id. The extension is always written: without it Excel reads the bar as having no axis and saves it back as axisPosition="none" (kit file 22).
          const rich = true;
          if (rich) blocks14.push(`<x14:conditionalFormatting${pv} xmlns:xm="${XM}"><x14:cfRule type="dataBar" id="${guid(i)}">${dataBarExtension(rule, file)}</x14:cfRule><xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`);
          body = `<cfRule type="dataBar" ${head}><dataBar minLength="${rule.minLength ?? 0}" maxLength="${rule.maxLength ?? 100}"${rule.hideValue ? ' showValue="0"' : ""}>${pointXml(rule.min.type === "auto" || sheetPoint(rule.min) ? { type: "min" } : rule.min, file)}${pointXml(rule.max.type === "auto" || sheetPoint(rule.max) ? { type: "max" } : rule.max, file)}<color ${fileColor(rule.color)}/></dataBar>${rich ? link(guid(i)) : ""}</cfRule>`;
          break;
        }
        case "iconSet": {
          // A set new to Excel 2010, or thresholds that point at another sheet, can only be written in the extension, which then holds the whole rule.
          // (Icons of your own go the same way: Excel kept a plain rule and an extension rule side by side as two rules, dropping the link between them, so only the extension's is written.)
          if (NEW_SETS.has(rule.set) || rule.custom || rule.thresholds.some(sheetPoint)) {
            standalone(`<x14:cfRule type="iconSet" ${head} id="${guid(i)}">${iconSetExtension(rule, file)}</x14:cfRule>`);
            return "";
          }
          // An icon set's rule in the extension carries the priority of the ordinary rule that points at it (LibreOffice needs it there).
          if (rule.custom) blocks14.push(`<x14:conditionalFormatting${pv} xmlns:xm="${XM}"><x14:cfRule type="iconSet" priority="${i + 1}" id="${guid(i)}">${iconSetExtension(rule, file)}</x14:cfRule><xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`);
          body = `<cfRule type="iconSet" ${head}><iconSet iconSet="${rule.set}"${rule.hideValue ? ' showValue="0"' : ""}${rule.reverse ? ' reverse="1"' : ""}>${pointXml({ type: "percent", value: 0 }, file)}${rule.thresholds.map((t) => pointXml(t, file, t.gte === false ? ' gte="0"' : "")).join("")}</iconSet>${rule.custom ? link(guid(i)) : ""}</cfRule>`;
          break;
        }
      }
      return `<conditionalFormatting${rule.pivot && pivots.has(rule.pivot.id) ? ' pivot="1"' : ""} sqref="${sqref}">${body}</conditionalFormatting>`;
    })
    .join("");
  const ext = blocks14.length ? `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="${X14}"><x14:conditionalFormattings>${blocks14.join("")}</x14:conditionalFormattings></ext></extLst>` : "";
  return { rules, ext };
}
