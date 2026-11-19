import { strFromU8 } from "fflate";
import { attr, child, childrenNamed, elements, textOf, type XmlElement } from "@pli.dev/core";
import { resolve } from "../../src/xlsx-chart";

/*
 * The part of the package check that is about formatting: merged cells, conditional formats (the ordinary ones and
 * Excel 2010's extension, which holds data bar settings, icon sets of its own and rules that point at other sheets), and the
 * conditional formats a pivot table keeps for its cells. Written from ECMA-376 (SpreadsheetML 18.3.1) and [MS-XLSX] 2.6
 * (the x14 conditional formatting elements), and from the files Excel wrote that the earlier code was matched against.
 * It says where an order or a value is one the schema doesn't allow, which Excel answers with "We found a problem with
 * some content" and then drops the formatting.
 */

export interface FormatLintContext {
  files: Record<string, Uint8Array>;
  names: string[];
  xml(path: string): XmlElement | undefined;
  bad(message: string): void;
  /** The worksheet parts, with the name of each sheet. */
  sheets: { path: string; name: string; root: XmlElement }[];
  relationships(part: string): XmlElement[];
  dxfCount: number;
}

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM = "http://schemas.microsoft.com/office/excel/2006/main";
const CF_URI = "{78C0D931-6437-407d-A8EE-F0AAD7539E65}";
const LINK_URI = "{B025F937-C7B1-47D3-B67F-A62EFF666E3E}";
const GUID = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

const CF_TYPES = new Set(["expression", "cellIs", "colorScale", "dataBar", "iconSet", "top10", "uniqueValues", "duplicateValues", "containsText", "notContainsText", "beginsWith", "endsWith", "containsBlanks", "notContainsBlanks", "containsErrors", "notContainsErrors", "timePeriod", "aboveAverage"]);
const OPERATORS = new Set(["lessThan", "lessThanOrEqual", "equal", "notEqual", "greaterThanOrEqual", "greaterThan", "between", "notBetween", "containsText", "notContains", "beginsWith", "endsWith"]);
const TEXT_OPERATOR: Record<string, string> = { containsText: "containsText", notContainsText: "notContains", beginsWith: "beginsWith", endsWith: "endsWith" };
const PERIODS = new Set(["today", "yesterday", "tomorrow", "last7Days", "thisMonth", "lastMonth", "nextMonth", "thisWeek", "lastWeek", "nextWeek"]);
/** ECMA-376's ST_IconSetType, and the three Excel 2010 added (only its extension can name those). */
const ICON_SETS = ["3Arrows", "3ArrowsGray", "3Flags", "3TrafficLights1", "3TrafficLights2", "3Signs", "3Symbols", "3Symbols2", "4Arrows", "4ArrowsGray", "4RedToBlack", "4Rating", "4TrafficLights", "5Arrows", "5ArrowsGray", "5Rating", "5Quarters"];
const ICON_SETS_2010 = ["3Stars", "3Triangles", "5Boxes"];
const CFVO_TYPES = new Set(["num", "percent", "max", "min", "formula", "percentile"]);
const CFVO_TYPES_14 = new Set([...CFVO_TYPES, "autoMin", "autoMax"]);
const SCOPES = new Set(["selection", "data", "field"]);
const bool = (v: string | undefined) => v === undefined || ["0", "1", "true", "false"].includes(v);
const whole = (v: string | undefined, lo: number, hi: number) => v !== undefined && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;

const colNumber = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function range(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(ref);
  if (!m) return null;
  const c1 = colNumber(m[1]!);
  const r1 = Number(m[2]);
  const c2 = m[3] ? colNumber(m[3]) : c1;
  const r2 = m[4] ? Number(m[4]) : r1;
  return c2 >= c1 && r2 >= r1 && c2 <= 16384 && r2 <= 1048576 && r1 >= 1 ? { r1, c1, r2, c2 } : null;
}
const touches = (a: NonNullable<ReturnType<typeof range>>, b: NonNullable<ReturnType<typeof range>>) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);

/** Whether the children of an element are in an order a sequence allows (only the names in `MANY` may repeat), and nothing else is there. */
const MANY = new Set(["formula", "f", "cfvo", "color", "cfIcon", "cfRule", "conditionalFormatting", "conditionalFormat", "pivotArea", "reference", "x"]);
function sequence(ctx: FormatLintContext, where: string, node: XmlElement, list: readonly string[], required: readonly string[] = []): void {
  let last = -1;
  const counts = new Map<string, number>();
  for (const c of elements(node)) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  for (const [name, n] of counts) if (n > 1 && !MANY.has(name)) ctx.bad(`${where}: <${name}> appears ${n} times in <${node.name}>, and the schema allows it once`);
  for (const c of elements(node)) {
    const at = list.indexOf(c.name);
    if (at < 0) ctx.bad(`${where}: <${c.name}> isn't a child the schema knows for <${node.name}>`);
    else if (at < last) ctx.bad(`${where}: <${c.name}> comes after <${list[last]}> in <${node.name}>, which the schema puts after it`);
    else last = at;
  }
  for (const r of required) if (!child(node, r)) ctx.bad(`${where}: <${node.name}> has no <${r}>`);
}

/** The text of the formulas of a rule: `formula` in the ordinary form and `xm:f` in the extension (both read as `formula` and `f`). */
const formulasOf = (rule: XmlElement, name: "formula" | "f") => childrenNamed(rule, name).map((f) => textOf(f).trim());

/** The same rules for a `cfvo`, in either form. */
function checkPoint(ctx: FormatLintContext, where: string, el: XmlElement, ext: boolean): void {
  const type = el.attrs["type"] ?? "";
  if (!(ext ? CFVO_TYPES_14 : CFVO_TYPES).has(type)) ctx.bad(`${where}: a cfvo of type "${type}" isn't one the schema has${ext ? "" : " (autoMin and autoMax are for the extension only)"}`);
  if (el.attrs["gte"] !== undefined && !bool(el.attrs["gte"])) ctx.bad(`${where}: a cfvo has gte="${el.attrs["gte"]}", which isn't a boolean`);
  // The extension holds the value as an `xm:f` child, the ordinary form as the val attribute.
  const val = ext ? (child(el, "f") ? textOf(child(el, "f")).trim() : undefined) : el.attrs["val"];
  if (ext && el.attrs["val"] !== undefined) ctx.bad(`${where}: an extension cfvo gives its value as an <xm:f> child, not a val attribute`);
  if (!ext && child(el, "f")) ctx.bad(`${where}: an ordinary cfvo gives its value in val, not as a child`);
  if (["num", "percent", "percentile", "formula"].includes(type)) {
    if (val === undefined || val === "") ctx.bad(`${where}: a cfvo of type ${type} has no value`);
    else if (type !== "formula" && !Number.isFinite(Number(val))) ctx.bad(`${where}: a cfvo of type ${type} has the value "${val}", which isn't a number`);
    else if ((type === "percent" || type === "percentile") && (Number(val) < 0 || Number(val) > 100)) ctx.bad(`${where}: a ${type} of ${val} isn't from 0 to 100`);
  } else if (val !== undefined && val !== "") ctx.bad(`${where}: a cfvo of type ${type} shouldn't have a value`);
}

function checkSqref(ctx: FormatLintContext, where: string, sqref: string | undefined): void {
  if (!sqref || !sqref.trim()) return ctx.bad(`${where}: no sqref`);
  for (const r of sqref.trim().split(/\s+/)) if (!range(r)) ctx.bad(`${where}: sqref "${r}" isn't a range`);
}

export function lintFormatting(ctx: FormatLintContext): void {
  const { bad } = ctx;
  const text = (path: string) => (ctx.files[path] ? strFromU8(ctx.files[path]!) : "");

  for (const { path, root } of ctx.sheets) {
    // ---- an element that may only be there once ----
    const seen = new Map<string, number>();
    for (const c of elements(root)) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
    for (const [name, n] of seen) if (n > 1 && name !== "conditionalFormatting") bad(`${path}: <${name}> appears ${n} times, and the schema allows it once`);

    // ---- merged cells ----
    const tables: NonNullable<ReturnType<typeof range>>[] = [];
    for (const rel of ctx.relationships(path)) {
      if (!/\/table$/.test(rel.attrs["Type"] ?? "")) continue;
      const r = range(attr(ctx.xml(resolve(path, rel.attrs["Target"] ?? "")), "ref") ?? "");
      if (r) tables.push(r);
    }
    const merged = childrenNamed(child(root, "mergeCells"), "mergeCell");
    if (child(root, "mergeCells") && !merged.length) bad(`${path}: <mergeCells> is empty, which Excel does not accept`);
    for (const m of merged) {
      const ref = m.attrs["ref"] ?? "";
      const r = range(ref);
      if (!r) bad(`${path}: merged range "${ref}" isn't a range`);
      else {
        if (r.r1 === r.r2 && r.c1 === r.c2) bad(`${path}: merged range "${ref}" is a single cell, which Excel repairs`);
        if (tables.some((t) => touches(t, r))) bad(`${path}: merged range "${ref}" touches a table, and Excel doesn't allow merged cells in a table`);
      }
    }

    // ---- conditional formats, the ordinary form ----
    const dxfIds = new Set<string>();
    const priorities = new Set<string>();
    const links = new Map<string, { type: string; priority: string }>(); // x14:id -> the rule that points at it
    for (const block of childrenNamed(root, "conditionalFormatting")) {
      const where = `${path}: conditionalFormatting ${block.attrs["sqref"] ?? ""}`;
      checkSqref(ctx, where, block.attrs["sqref"]);
      if (!bool(block.attrs["pivot"])) bad(`${where}: pivot="${block.attrs["pivot"]}" isn't a boolean`);
      for (const c of elements(block)) if (c.name !== "cfRule" && c.name !== "extLst") bad(`${where}: <${c.name}> isn't a child the schema knows for <conditionalFormatting>`);
      if (!childrenNamed(block, "cfRule").length) bad(`${where}: no cfRule`);
      for (const rule of childrenNamed(block, "cfRule")) {
        const type = rule.attrs["type"] ?? "";
        const here = `${where} (${type})`;
        if (!CF_TYPES.has(type)) bad(`${here}: "${type}" isn't a conditional formatting type`);
        if (!whole(rule.attrs["priority"], 1, 2147483647)) bad(`${here}: priority "${rule.attrs["priority"]}" isn't a whole number from 1`);
        if (priorities.has(rule.attrs["priority"] ?? "")) bad(`${here}: priority ${rule.attrs["priority"]} is used by another rule`);
        priorities.add(rule.attrs["priority"] ?? "");
        if (!bool(rule.attrs["stopIfTrue"])) bad(`${here}: stopIfTrue isn't a boolean`);
        if (rule.attrs["dxfId"] !== undefined) {
          if (!whole(rule.attrs["dxfId"], 0, ctx.dxfCount - 1)) bad(`${here}: dxfId "${rule.attrs["dxfId"]}" isn't one of the ${ctx.dxfCount} styles`);
          dxfIds.add(rule.attrs["dxfId"]);
        }
        if (["colorScale", "dataBar", "iconSet"].includes(type) && rule.attrs["dxfId"] !== undefined) bad(`${here}: a ${type} rule has no style of its own (dxfId)`);
        sequence(ctx, here, rule, ["formula", "colorScale", "dataBar", "iconSet", "extLst"]);
        const formulas = formulasOf(rule, "formula");
        if (formulas.some((f) => f === "")) bad(`${here}: an empty formula`);
        const count = (n: number | [number, number]) => {
          const [lo, hi] = typeof n === "number" ? [n, n] : n;
          if (formulas.length < lo || formulas.length > hi) bad(`${here}: has ${formulas.length} formulas, and this type takes ${lo === hi ? lo : `${lo} to ${hi}`}`);
        };
        switch (type) {
          case "cellIs": {
            const op = rule.attrs["operator"] ?? "";
            if (!OPERATORS.has(op) || ["containsText", "notContains", "beginsWith", "endsWith"].includes(op)) bad(`${here}: operator "${op}" isn't a comparison`);
            count(op === "between" || op === "notBetween" ? 2 : 1);
            break;
          }
          case "expression":
            count(1);
            break;
          case "containsText":
          case "notContainsText":
          case "beginsWith":
          case "endsWith":
            if (!rule.attrs["text"]) bad(`${here}: no text to look for`);
            if (rule.attrs["operator"] !== TEXT_OPERATOR[type]) bad(`${here}: operator is "${rule.attrs["operator"]}", and a ${type} rule says "${TEXT_OPERATOR[type]}"`);
            count(1);
            break;
          case "containsBlanks":
          case "notContainsBlanks":
          case "containsErrors":
          case "notContainsErrors":
            count(1);
            break;
          case "timePeriod":
            if (!PERIODS.has(rule.attrs["timePeriod"] ?? "")) bad(`${here}: timePeriod "${rule.attrs["timePeriod"]}" isn't one the schema has`);
            count(1);
            break;
          case "top10": {
            const rank = rule.attrs["rank"];
            if (!whole(rank, 1, bool(rule.attrs["percent"]) && ["1", "true"].includes(rule.attrs["percent"] ?? "") ? 100 : 1000)) bad(`${here}: rank "${rank}" isn't a whole number from 1 (to 100 for a percentage, 1000 for a count)`);
            for (const a of ["percent", "bottom"]) if (!bool(rule.attrs[a])) bad(`${here}: ${a} isn't a boolean`);
            count(0);
            break;
          }
          case "aboveAverage": {
            const sd = rule.attrs["stdDev"];
            if (sd !== undefined && !whole(sd, 0, 3)) bad(`${here}: stdDev "${sd}" isn't 0, 1, 2 or 3`);
            for (const a of ["aboveAverage", "equalAverage"]) if (!bool(rule.attrs[a])) bad(`${here}: ${a} isn't a boolean`);
            count(0);
            break;
          }
          case "duplicateValues":
          case "uniqueValues":
            count(0);
            break;
          case "colorScale": {
            const scale = child(rule, "colorScale");
            if (!scale) return bad(`${here}: no <colorScale>`);
            sequence(ctx, here, scale, ["cfvo", "color"]);
            const points = childrenNamed(scale, "cfvo");
            const colors = childrenNamed(scale, "color");
            if (points.length < 2 || points.length > 3) bad(`${here}: a colour scale has ${points.length} points, and the schema takes 2 or 3`);
            if (colors.length !== points.length) bad(`${here}: ${points.length} points but ${colors.length} colours`);
            points.forEach((p) => checkPoint(ctx, here, p, false));
            for (const c of colors) if (!c.attrs["rgb"] && !c.attrs["theme"] && !c.attrs["indexed"] && !c.attrs["auto"]) bad(`${here}: a colour that names none`);
            count(0);
            break;
          }
          case "dataBar": {
            const bar = child(rule, "dataBar");
            if (!bar) return bad(`${here}: no <dataBar>`);
            sequence(ctx, here, bar, ["cfvo", "color"], ["color"]);
            const points = childrenNamed(bar, "cfvo");
            if (points.length !== 2) bad(`${here}: a data bar has ${points.length} cfvo, and the schema takes 2`);
            points.forEach((p) => checkPoint(ctx, here, p, false));
            for (const a of ["minLength", "maxLength"]) if (bar.attrs[a] !== undefined && !whole(bar.attrs[a], 0, 100)) bad(`${here}: ${a} "${bar.attrs[a]}" isn't a whole number from 0 to 100`);
            if (bar.attrs["minLength"] !== undefined && bar.attrs["maxLength"] !== undefined && Number(bar.attrs["minLength"]) > Number(bar.attrs["maxLength"])) bad(`${here}: minLength is longer than maxLength`);
            if (!bool(bar.attrs["showValue"])) bad(`${here}: showValue isn't a boolean`);
            if (points.some((p) => /!/.test(p.attrs["val"] ?? ""))) bad(`${here}: a data bar point that names another sheet has to be written in the extension`);
            count(0);
            break;
          }
          case "iconSet": {
            const icons = child(rule, "iconSet");
            if (!icons) return bad(`${here}: no <iconSet>`);
            sequence(ctx, here, icons, ["cfvo"]);
            const set = icons.attrs["iconSet"] ?? "3TrafficLights1";
            if (!ICON_SETS.includes(set)) bad(`${here}: icon set "${set}" isn't in the ordinary form's list${ICON_SETS_2010.includes(set) ? " (it is new in Excel 2010, so only the extension can name it)" : ""}`);
            const points = childrenNamed(icons, "cfvo");
            if (points.length !== Number(set[0])) bad(`${here}: ${points.length} thresholds for the ${set} set, which has ${set[0]} icons`);
            points.forEach((p) => checkPoint(ctx, here, p, false));
            for (const a of ["showValue", "percent", "reverse"]) if (!bool(icons.attrs[a])) bad(`${here}: ${a} isn't a boolean`);
            if (points.some((p) => /!/.test(p.attrs["val"] ?? ""))) bad(`${here}: an icon threshold that names another sheet has to be written in the extension`);
            count(0);
            break;
          }
        }
        // The pointer to the extension.
        const ext = childrenNamed(child(rule, "extLst"), "ext");
        for (const e of ext) {
          if (e.attrs["uri"] !== LINK_URI) bad(`${here}: an ext with uri ${e.attrs["uri"]}, and the link to the extension's rule is ${LINK_URI}`);
          const id = textOf(child(e, "id")).trim();
          if (!GUID.test(id)) bad(`${here}: the link "${id}" isn't a GUID in braces`);
          if (links.has(id)) bad(`${here}: the link ${id} is used by two rules`);
          links.set(id, { type, priority: rule.attrs["priority"] ?? "" });
        }
      }
    }

    // ---- the extension ----
    const raw = text(path);
    const extLst = child(root, "extLst");
    const cfExt = childrenNamed(extLst, "ext").filter((e) => e.attrs["uri"] === CF_URI);
    if (cfExt.length > 1) bad(`${path}: the conditional formatting extension (${CF_URI}) appears ${cfExt.length} times`);
    const ids = new Map<string, XmlElement>();
    for (const e of cfExt) {
      const at = raw.indexOf(`uri="${CF_URI}"`);
      const open = raw.slice(raw.lastIndexOf("<ext", at), raw.indexOf(">", at) + 1);
      if (!open.includes(`xmlns:x14="${X14}"`) && !raw.slice(0, raw.indexOf(">", raw.indexOf("<worksheet")) + 1).includes(`xmlns:x14="${X14}"`)) bad(`${path}: the conditional formatting extension doesn't declare xmlns:x14 as ${X14}`);
      const holder = child(e, "conditionalFormattings");
      if (!holder) {
        bad(`${path}: the conditional formatting extension has no <x14:conditionalFormattings>`);
        continue;
      }
      if (elements(e).length !== 1) bad(`${path}: the conditional formatting extension holds more than <x14:conditionalFormattings>`);
      const blocks = childrenNamed(holder, "conditionalFormatting");
      if (!blocks.length) bad(`${path}: <x14:conditionalFormattings> is empty`);
      for (const block of blocks) {
        const where = `${path}: x14:conditionalFormatting ${textOf(child(block, "sqref")).trim()}`;
        sequence(ctx, where, block, ["cfRule", "sqref", "extLst"], ["cfRule", "sqref"]);
        checkSqref(ctx, where, textOf(child(block, "sqref")));
        if (!bool(block.attrs["pivot"])) bad(`${where}: pivot isn't a boolean`);
        for (const rule of childrenNamed(block, "cfRule")) {
          const type = rule.attrs["type"] ?? "";
          const here = `${where} (${type})`;
          if (!CF_TYPES.has(type)) bad(`${here}: "${type}" isn't a conditional formatting type`);
          const id = rule.attrs["id"];
          if (id !== undefined) {
            if (!GUID.test(id)) bad(`${here}: id "${id}" isn't a GUID in braces`);
            if (ids.has(id)) bad(`${here}: id ${id} is used twice`);
            ids.set(id, rule);
          }
          const linked = id !== undefined && links.has(id);
          // A rule that stands alone has a priority of its own; one an ordinary rule points at takes that rule's.
          if (!linked) {
            if (!whole(rule.attrs["priority"], 1, 2147483647)) bad(`${here}: a rule that no ordinary rule points at needs a priority`);
            else if (priorities.has(rule.attrs["priority"]!)) bad(`${here}: priority ${rule.attrs["priority"]} is used by another rule`);
            priorities.add(rule.attrs["priority"] ?? "");
            if (id === undefined) bad(`${here}: a rule in the extension has no id`);
          } else {
            const from = links.get(id!)!;
            if (from.type !== type) bad(`${here}: the ordinary rule that points at it is a ${from.type} rule`);
            // An icon set's rule in the extension repeats the priority of the rule that points at it (LibreOffice needs it); other kinds leave it out.
            if (rule.attrs["priority"] !== undefined && rule.attrs["priority"] !== from.priority) bad(`${here}: priority ${rule.attrs["priority"]} isn't that of the rule that points at it (${from.priority})`);
            if (rule.attrs["priority"] === undefined && type === "iconSet") bad(`${here}: an icon set in the extension needs the priority of the rule that points at it`);
          }
          sequence(ctx, here, rule, ["f", "colorScale", "dataBar", "iconSet", "dxf", "extLst"]);
          const formulas = formulasOf(rule, "f");
          if (formulas.some((f) => f === "")) bad(`${here}: an empty xm:f`);
          const dxf = child(rule, "dxf");
          if (dxf) sequence(ctx, here, dxf, ["font", "numFmt", "fill", "alignment", "border", "protection", "extLst"]);
          const need = (n: number) => formulas.length !== n && bad(`${here}: has ${formulas.length} xm:f formulas, and this type takes ${n}`);
          if (type === "cellIs") {
            const op = rule.attrs["operator"] ?? "";
            if (!OPERATORS.has(op)) bad(`${here}: operator "${op}" isn't one the schema has`);
            need(op === "between" || op === "notBetween" ? 2 : 1);
          } else if (type === "expression") need(1);
          else if (type === "dataBar") {
            const bar = child(rule, "dataBar");
            if (!bar) bad(`${here}: no <x14:dataBar>`);
            else {
              sequence(ctx, here, bar, ["cfvo", "borderColor", "negativeFillColor", "negativeBorderColor", "axisColor"]);
              const points = childrenNamed(bar, "cfvo");
              if (points.length !== 2) bad(`${here}: ${points.length} cfvo in an x14:dataBar, and the schema takes 2`);
              points.forEach((p) => checkPoint(ctx, here, p, true));
              for (const a of ["minLength", "maxLength"]) if (bar.attrs[a] !== undefined && !whole(bar.attrs[a], 0, 100)) bad(`${here}: ${a} "${bar.attrs[a]}" isn't a whole number from 0 to 100`);
              for (const a of ["gradient", "border", "negativeBarColorSameAsPositive", "negativeBarBorderColorSameAsPositive"]) if (!bool(bar.attrs[a])) bad(`${here}: ${a} isn't a boolean`);
              if (bar.attrs["axisPosition"] !== undefined && !["automatic", "middle", "none"].includes(bar.attrs["axisPosition"])) bad(`${here}: axisPosition "${bar.attrs["axisPosition"]}" isn't automatic, middle or none`);
              if (bar.attrs["direction"] !== undefined && !["context", "leftToRight", "rightToLeft"].includes(bar.attrs["direction"])) bad(`${here}: direction "${bar.attrs["direction"]}" isn't context, leftToRight or rightToLeft`);
              if (child(bar, "negativeBorderColor") && !["0", "false"].includes(bar.attrs["negativeBarBorderColorSameAsPositive"] ?? "")) bad(`${here}: a negative border colour is given, but negativeBarBorderColorSameAsPositive isn't 0`);
              if (child(bar, "negativeFillColor") && ["1", "true"].includes(bar.attrs["negativeBarColorSameAsPositive"] ?? "")) bad(`${here}: a negative fill colour is given, but negativeBarColorSameAsPositive is 1`);
              if (child(bar, "borderColor") && !["1", "true"].includes(bar.attrs["border"] ?? "")) bad(`${here}: a border colour is given, but border isn't 1`);
              for (const c of ["borderColor", "negativeFillColor", "negativeBorderColor", "axisColor"]) {
                const el = child(bar, c);
                if (el && !el.attrs["rgb"] && !el.attrs["theme"] && !el.attrs["indexed"] && !el.attrs["auto"]) bad(`${here}: <x14:${c}> names no colour`);
              }
            }
            need(0);
          } else if (type === "iconSet") {
            const icons = child(rule, "iconSet");
            if (!icons) bad(`${here}: no <x14:iconSet>`);
            else {
              sequence(ctx, here, icons, ["cfvo", "cfIcon"]);
              const set = icons.attrs["iconSet"] ?? "3TrafficLights1";
              if (![...ICON_SETS, ...ICON_SETS_2010].includes(set)) bad(`${here}: icon set "${set}" isn't one the schema has`);
              const points = childrenNamed(icons, "cfvo");
              if (points.length !== Number(set[0])) bad(`${here}: ${points.length} thresholds for the ${set} set, which has ${set[0]} icons`);
              points.forEach((p) => checkPoint(ctx, here, p, true));
              for (const a of ["showValue", "percent", "reverse", "custom"]) if (!bool(icons.attrs[a])) bad(`${here}: ${a} isn't a boolean`);
              const custom = childrenNamed(icons, "cfIcon");
              const isCustom = ["1", "true"].includes(icons.attrs["custom"] ?? "");
              if (isCustom && custom.length !== points.length) bad(`${here}: a custom icon set has ${custom.length} icons for ${points.length} thresholds`);
              if (!isCustom && custom.length) bad(`${here}: icons are given but custom isn't 1`);
              for (const c of custom) {
                const s = c.attrs["iconSet"] ?? "";
                const size = s === "NoIcons" ? 1 : [...ICON_SETS, ...ICON_SETS_2010].includes(s) ? Number(s[0]) : 0;
                if (!size) bad(`${here}: a cfIcon names the set "${s}", which isn't one the schema has`);
                else if (!whole(c.attrs["iconId"], 0, size - 1)) bad(`${here}: a cfIcon names icon ${c.attrs["iconId"]} of the ${s} set, which has ${size}`);
              }
            }
            need(0);
          } else if (type === "containsText" || type === "notContainsText" || type === "beginsWith" || type === "endsWith") {
            if (rule.attrs["operator"] !== TEXT_OPERATOR[type]) bad(`${here}: operator is "${rule.attrs["operator"]}", and a ${type} rule says "${TEXT_OPERATOR[type]}"`);
            if (formulas.length < 1 || formulas.length > 2) bad(`${here}: has ${formulas.length} xm:f formulas, and a text rule takes the test and perhaps the text`);
          }
        }
      }
    }
    for (const [id, from] of links) if (!ids.has(id)) bad(`${path}: a ${from.type} rule points at the extension rule ${id}, which isn't there`);
    for (const [id, rule] of ids) if (!links.has(id) && (rule.attrs["priority"] === undefined)) bad(`${path}: the extension rule ${id} is pointed at by no rule and has no priority`);
    // The extension's own elements carry their prefix: the namespaces it needs must be declared where they are used.
    if (cfExt.length) {
      const start = raw.indexOf(CF_URI);
      const body = raw.slice(start, raw.indexOf("</ext>", start));
      if (/<x14:conditionalFormatting\b/.test(body) && !new RegExp(`xmlns:xm="${XM}"`).test(raw)) bad(`${path}: the extension uses xm: elements but doesn't declare xmlns:xm as ${XM}`);
      for (const tag of body.match(/<\/?[A-Za-z][\w.-]*:[\w.-]+/g) ?? []) {
        const name = tag.replace(/^<\/?/, "");
        if (!/^(x14:(conditionalFormattings|conditionalFormatting|cfRule|dataBar|iconSet|cfvo|cfIcon|borderColor|negativeFillColor|negativeBorderColor|axisColor|dxf|id)|xm:(f|sqref))$/.test(name)) bad(`${path}: <${name}> isn't an element of the conditional formatting extension`);
      }
      for (const tag of ["cfRule", "dataBar", "iconSet", "cfvo", "cfIcon", "borderColor", "negativeFillColor", "negativeBorderColor", "axisColor"])
        if (new RegExp(`<${tag}\\b`).test(body)) bad(`${path}: <${tag}> in the extension is missing its x14: prefix`);
      if (/<x14:(sqref|f)\b/.test(body)) bad(`${path}: sqref and f in the extension belong to the xm: namespace, not x14:`);
    }
  }

  // ---- the conditional formats a pivot table keeps ----
  const sheetOf = new Map<string, { path: string; root: XmlElement }>();
  for (const s of ctx.sheets) for (const rel of ctx.relationships(s.path)) if (/\/pivotTable$/.test(rel.attrs["Type"] ?? "")) sheetOf.set(resolve(s.path, rel.attrs["Target"] ?? ""), s);
  for (const n of ctx.names.filter((x) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(x))) {
    const table = ctx.xml(n);
    const formats = child(table, "conditionalFormats");
    const owner = sheetOf.get(n);
    const fields = childrenNamed(child(table, "pivotFields"), "pivotField");
    const dataCount = childrenNamed(child(table, "dataFields"), "dataField").length;
    // The sheet's rules that say they belong to a pivot table, by priority.
    const flagged = new Set<string>();
    const priorities = new Set<string>();
    for (const block of childrenNamed(owner?.root, "conditionalFormatting")) {
      for (const rule of childrenNamed(block, "cfRule")) {
        priorities.add(rule.attrs["priority"] ?? "");
        if (["1", "true"].includes(block.attrs["pivot"] ?? "")) flagged.add(rule.attrs["priority"] ?? "");
      }
    }
    if (!formats) continue;
    const list = childrenNamed(formats, "conditionalFormat");
    if (formats.attrs["count"] !== undefined && Number(formats.attrs["count"]) !== list.length) bad(`${n}: <conditionalFormats count="${formats.attrs["count"]}"> has ${list.length} formats`);
    if (!list.length) bad(`${n}: <conditionalFormats> is empty`);
    const used = new Set<string>();
    for (const cf of list) {
      const p = cf.attrs["priority"] ?? "";
      const here = `${n}: conditional format with priority ${p}`;
      if (cf.attrs["scope"] !== undefined && !SCOPES.has(cf.attrs["scope"])) bad(`${here}: scope "${cf.attrs["scope"]}" isn't selection, data or field`);
      if (cf.attrs["type"] !== undefined && !["none", "all", "row", "column"].includes(cf.attrs["type"])) bad(`${here}: type "${cf.attrs["type"]}" isn't none, all, row or column`);
      if (!whole(p, 1, 2147483647)) bad(`${here}: priority isn't a whole number from 1`);
      else if (!priorities.has(p)) bad(`${here}: the sheet has no rule with that priority`);
      else if (!flagged.has(p)) bad(`${here}: the sheet's rule with that priority isn't in a conditionalFormatting with pivot="1"`);
      if (used.has(p)) bad(`${here}: priority is used by another format`);
      used.add(p);
      for (const c of elements(cf)) if (c.name !== "pivotAreas" && c.name !== "extLst") bad(`${here}: <${c.name}> isn't a child the schema knows for <conditionalFormat>`);
      const areas = child(cf, "pivotAreas");
      if (!areas) {
        bad(`${here}: no <pivotAreas>`);
        continue;
      }
      const areaList = childrenNamed(areas, "pivotArea");
      if (!areaList.length) bad(`${here}: no pivotArea`);
      if (areas.attrs["count"] !== undefined && Number(areas.attrs["count"]) !== areaList.length) bad(`${here}: <pivotAreas count="${areas.attrs["count"]}"> has ${areaList.length}`);
      for (const area of areaList) {
        sequence(ctx, here, area, ["references", "extLst"]);
        if (area.attrs["type"] !== undefined && !["none", "normal", "data", "all", "origin", "button", "topEnd", "topRight"].includes(area.attrs["type"])) bad(`${here}: pivotArea type "${area.attrs["type"]}" isn't one the schema has`);
        for (const a of ["dataOnly", "labelOnly", "grandRow", "grandCol", "outline", "collapsedLevelsAreSubtotals"]) if (!bool(area.attrs[a])) bad(`${here}: pivotArea ${a} isn't a boolean`);
        if (area.attrs["fieldPosition"] !== undefined && !whole(area.attrs["fieldPosition"], 0, 4294967295)) bad(`${here}: fieldPosition isn't a whole number`);
        const refs = child(area, "references");
        const refList = childrenNamed(refs, "reference");
        if (refs && refs.attrs["count"] !== undefined && Number(refs.attrs["count"]) !== refList.length) bad(`${here}: <references count="${refs.attrs["count"]}"> has ${refList.length}`);
        if (refs && !refList.length) bad(`${here}: <references> is empty`);
        let lastField = -1;
        const fieldsSeen = new Set<string>();
        for (const ref of refList) {
          const f = ref.attrs["field"] ?? "";
          const isData = f === "4294967294";
          if (!isData && !(whole(f, 0, fields.length - 1))) bad(`${here}: a reference to field ${f}, and the table has ${fields.length} fields`);
          if (fieldsSeen.has(f)) bad(`${here}: two references to field ${f}`);
          fieldsSeen.add(f);
          // The data field comes first; the others go in the order of the fields.
          if (!isData) {
            if (Number(f) < lastField) bad(`${here}: references aren't in the order of the fields`);
            lastField = Number(f);
          } else if (lastField >= 0) bad(`${here}: the reference to the data field comes after one to a field`);
          const xs = childrenNamed(ref, "x");
          if (ref.attrs["count"] !== undefined && Number(ref.attrs["count"]) !== xs.length) bad(`${here}: a reference says count="${ref.attrs["count"]}" and lists ${xs.length} items`);
          if (!bool(ref.attrs["selected"])) bad(`${here}: a reference's selected isn't a boolean`);
          for (const x of xs) {
            const v = x.attrs["v"];
            const limit = isData ? dataCount : childrenNamed(child(fields[Number(f)], "items"), "item").length;
            if (v !== undefined && !whole(v, 0, Math.max(limit - 1, 0))) bad(`${here}: a reference to ${isData ? "data field" : `item ${v} of field ${f}`}${isData ? ` ${v}` : ""}, and there are ${limit}`);
          }
        }
        if (cf.attrs["scope"] === "field" && !refList.length) bad(`${here}: a field-scope format names no field or value`);
        if ((cf.attrs["scope"] === "selection" || cf.attrs["scope"] === undefined) && !refList.length) bad(`${here}: a format for selected cells names no cells`);
      }
    }
  }
}
