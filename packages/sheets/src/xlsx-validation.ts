import { attr, child, textOf, type XmlElement } from "@pli.dev/core";
import { parseRange, rangeAddress } from "./address";
import type { CellRuleOperator, Sheet, Validation } from "./model";
import { CELL_OPERATORS } from "./rule";
import { externalSource, inExtension, type LinkedBook } from "./xlsx-external";

/*
 * Data validation in an .xlsx file: a `dataValidation` element per rule, with the kind in `type`, the comparison in
 * `operator`, the limits in `formula1` and `formula2`, and the messages as attributes.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const flag = (v: string | undefined) => v === "1" || v === "true";

const KINDS = ["whole", "decimal", "date", "time", "textLength", "list", "custom"] as const;

/** One `dataValidation` element as a rule, or null when it is a kind Pli doesn't have (or can't be read). */
export function readValidation(el: XmlElement, strip: (f: string) => string, newId: () => string, books: readonly LinkedBook[] = []): Validation | null {
  const type = attr(el, "type") as (typeof KINDS)[number] | undefined;
  if (!type || !KINDS.includes(type)) return null;
  const ranges: string[] = [];
  for (const r of (attr(el, "sqref") ?? textOf(child(el, "sqref"))).split(/\s+/)) {
    const b = r ? parseRange(r.replace(/\$/g, "")) : null;
    if (b) ranges.push(rangeAddress(b));
  }
  if (!ranges.length) return null;
  const f1 = strip(textOf(child(el, "formula1")).trim().replace(/^=/, ""));
  const f2 = strip(textOf(child(el, "formula2")).trim().replace(/^=/, ""));
  const errorStyle = attr(el, "errorStyle");
  const alert: Validation["alert"] = !flag(attr(el, "showErrorMessage")) ? "none" : errorStyle === "warning" || errorStyle === "information" ? errorStyle : undefined;
  const text = (name: string) => attr(el, name) || undefined;
  const prompt = flag(attr(el, "showInputMessage"));
  const base = {
    id: newId(),
    ranges,
    // In the file a blank is let through only when the rule says so.
    ...(flag(attr(el, "allowBlank")) ? {} : { noBlank: true as const }),
    ...(alert ? { alert } : {}),
    ...(text("errorTitle") ? { errorTitle: text("errorTitle")! } : {}),
    ...(text("error") ? { error: text("error")! } : {}),
    ...(prompt && text("promptTitle") ? { promptTitle: text("promptTitle")! } : {}),
    ...(prompt && text("prompt") ? { prompt: text("prompt")! } : {}),
  };
  if (type === "list") {
    // A list read from a workbook the file links to: its source, and the cells Excel kept of it.
    const linked = externalSource(textOf(child(el, "formula1")).trim().replace(/^=/, ""), books);
    if (linked) return { ...base, kind: "list", source: linked.source, snapshot: linked.snapshot, ...(flag(attr(el, "showDropDown")) ? { hideArrow: true as const } : {}) };
  }
  if (type === "list") return f1 && !/^".*"$/.test(f1) ? { ...base, kind: "list", source: f1, ...(flag(attr(el, "showDropDown")) ? { hideArrow: true as const } : {}) } : null;
  if (type === "custom") return f1 ? { ...base, kind: "custom", formula: f1 } : null;
  const op = (attr(el, "operator") ?? "between") as CellRuleOperator;
  if (!CELL_OPERATORS.includes(op)) return null;
  const two = op === "between" || op === "notBetween";
  if (!f1 || (two && !f2)) return null;
  return { ...base, kind: type, op, values: two ? [f1, f2] : [f1] };
}

/** The `dataValidation` elements for a sheet's rules. */
export function validationRulesXml(sheet: Sheet, file: (f: string) => string, external?: (rule: Validation) => string | null): string[] {
  const readsOutside = (sheet.validations ?? []).filter((rule) => inExtension(rule)).flatMap((rule) => {
    const xml = external?.(rule) ?? null;
    return xml ? [xml] : [];
  });
  return [...readsOutside, ...validationOwnXml(sheet, file)];
}

function validationOwnXml(sheet: Sheet, file: (f: string) => string): string[] {
  return (sheet.validations ?? []).filter((rule) => !inExtension(rule)).map((rule) => {
    const attrs: string[] = [`type="${rule.kind}"`];
    if (rule.alert === "warning" || rule.alert === "information") attrs.push(`errorStyle="${rule.alert}"`);
    // Excel would refuse a cell that holds several items, so such a list only informs there; Pli's extension keeps the real alert.
    else if (rule.kind === "list" && rule.multiple && !rule.alert) attrs.push('errorStyle="information"');
    if ("op" in rule && rule.op !== "between") attrs.push(`operator="${rule.op}"`);
    if (!rule.noBlank) attrs.push('allowBlank="1"');
    if (rule.kind === "list" && rule.hideArrow) attrs.push('showDropDown="1"');
    if (rule.prompt || rule.promptTitle) attrs.push('showInputMessage="1"');
    if (rule.alert !== "none") attrs.push('showErrorMessage="1"');
    // Excel's limits on the length of a title and of a message.
    if (rule.errorTitle) attrs.push(`errorTitle="${esc(rule.errorTitle.slice(0, 32))}"`);
    if (rule.error) attrs.push(`error="${esc(rule.error.slice(0, 255))}"`);
    if (rule.promptTitle) attrs.push(`promptTitle="${esc(rule.promptTitle.slice(0, 32))}"`);
    if (rule.prompt) attrs.push(`prompt="${esc(rule.prompt.slice(0, 255))}"`);
    attrs.push(`sqref="${rule.ranges.join(" ")}"`);
    const f = (x: string) => `<formula1>${esc(file(x))}</formula1>`;
    const body = rule.kind === "list" ? f(rule.source) : rule.kind === "custom" ? f(rule.formula) : f(rule.values[0]!) + (rule.values[1] !== undefined ? `<formula2>${esc(file(rule.values[1]))}</formula2>` : "");
    return `<dataValidation ${attrs.join(" ")}>${body}</dataValidation>`;
  });
}
