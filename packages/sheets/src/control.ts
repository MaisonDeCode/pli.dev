import { PliError } from "@pli.dev/core";
import type { Cell, CellControl, ChipOption, Scalar } from "./model";

/** What stands for a ticked checkbox and an empty one. */
export function checkboxValues(control: Extract<CellControl, { type: "checkbox" }>): { checked: Scalar; unchecked: Scalar } {
  return { checked: control.checked ?? true, unchecked: control.unchecked ?? false };
}

export function isTicked(cell: Cell | undefined): boolean {
  const c = cell?.control;
  return c?.type === "checkbox" && cell?.v === checkboxValues(c).checked;
}

/** The separator between several choices kept in one cell. */
export const MULTI_SEPARATOR = ", ";

/** The choices in a cell's text. A list rule that allows several can use another `separator` than `, `. */
export function choicesIn(text: string, multiple: boolean, separator: string = MULTI_SEPARATOR): string[] {
  if (text === "") return [];
  if (!multiple) return [text];
  // Spaces around a separator such as `; ` don't belong to the choices.
  const bare = separator.trim() === "" ? separator : separator.trim();
  return text.split(bare).map((s) => (bare === separator ? s : s.trim())).filter((s) => s !== "");
}

export function joinChoices(values: readonly string[], separator: string = MULTI_SEPARATOR): string {
  return values.join(separator);
}

/** The text a cell holds, as the choices a dropdown or badge works with. */
export function cellChoices(cell: Cell | undefined): string[] {
  const c = cell?.control;
  if (!c || c.type === "checkbox" || cell?.v === undefined) return [];
  return choicesIn(String(cell.v), !!c.multiple, c.separator);
}

/** The option for a value in a dropdown. */
export function optionOf(control: Extract<CellControl, { type: "dropdown" }>, value: string): ChipOption | undefined {
  return control.options.find((o) => o.value === value);
}

/**
 * Checks what is about to be put in a cell against what the cell is. A checkbox takes only the two values it stands
 * for; a dropdown that is `strict` takes only its choices (several, if it allows them). Throws a `PliError` that says so.
 */
export function checkAgainstControl(control: CellControl | undefined, next: Cell | null): void {
  if (!control || !next || (next.v === undefined && next.f === undefined && next.e === undefined)) return;
  if (next.f !== undefined) return; // a formula is worked out later
  if (control.type === "checkbox") {
    const { checked, unchecked } = checkboxValues(control);
    if (next.v !== checked && next.v !== unchecked) throw new PliError("invalid_operation", `A checkbox holds ${JSON.stringify(checked)} or ${JSON.stringify(unchecked)}`);
  } else if (control.type === "dropdown" && control.strict) {
    for (const choice of choicesIn(String(next.v ?? ""), !!control.multiple, control.separator)) {
      if (!optionOf(control, choice)) throw new PliError("invalid_operation", `"${choice}" isn't one of the choices`);
    }
  }
}
