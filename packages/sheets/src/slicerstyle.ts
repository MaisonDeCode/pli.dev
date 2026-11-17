import { PliError } from "@pli.dev/core";
import type { ConditionalStyle, SlicerStyleDef } from "./model";
import { cleanStyle } from "./rule";

/*
 * Slicer styles of your own. Excel keeps a slicer's looks as a table style with the same name (its whole slicer and heading)
 * and a `slicerStyle` with the looks of the buttons; Pli keeps all ten in one definition.
 */

export const SLICER_STYLE_PARTS = [
  "wholeTable", "headerRow",
  "unselectedItemWithData", "selectedItemWithData", "unselectedItemWithNoData", "selectedItemWithNoData",
  "hoveredUnselectedItemWithData", "hoveredSelectedItemWithData", "hoveredUnselectedItemWithNoData", "hoveredSelectedItemWithNoData",
] as const;

export type SlicerStylePart = (typeof SLICER_STYLE_PARTS)[number];

/** The names of Excel's own slicer styles, which a style of your own can't take. */
export const BUILTIN_SLICER_STYLE = /^SlicerStyle(Light|Dark|Other)\d+$/i;

/** A style name made ready to keep: not one of Excel's. */
export function cleanSlicerStyleName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") throw new PliError("invalid_operation", "A slicer style needs a name");
  if (name.length > 255) throw new PliError("invalid_operation", "A slicer style's name is at most 255 characters");
  if (BUILTIN_SLICER_STYLE.test(name)) throw new PliError("invalid_operation", `"${name}" is the name of one of the built-in slicer styles; pick another`);
  return name;
}

/** A slicer style made ready to keep: each part's look checked, and parts that say nothing left out. */
export function cleanSlicerStyle(style: SlicerStyleDef): SlicerStyleDef {
  if (!style || typeof style !== "object") throw new PliError("invalid_operation", "A slicer style needs its parts");
  const out: SlicerStyleDef = {};
  for (const k of Object.keys(style)) if (!(SLICER_STYLE_PARTS as readonly string[]).includes(k)) throw new PliError("invalid_operation", `A slicer style has ${SLICER_STYLE_PARTS.join(", ")}, not "${k}"`);
  for (const part of SLICER_STYLE_PARTS) {
    const v = style[part];
    if (v === undefined) continue;
    const cleaned = cleanStyle(v);
    if (Object.keys(cleaned).length) out[part] = cleaned;
  }
  return out;
}

const ACCENTS = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

const mix = (hex: string, withHex: string, share: number): string => {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return "#" + [0, 1, 2].map((i) => h(p(hex, i) * (1 - share) + p(withHex, i) * share)).join("");
};

/** The accent colour and lightness of an Excel slicer style name such as `SlicerStyleLight2`. */
export function slicerAccent(style: string | undefined): { accent: string; dark: boolean } {
  const m = BUILTIN_SLICER_STYLE.exec(style ?? "");
  const n = m ? Number((/\d+$/.exec(style!) ?? ["1"])[0]) : 1;
  return { accent: ACCENTS[(n - 1 + ACCENTS.length) % ACCENTS.length]!, dark: m?.[1]?.toLowerCase() === "dark" };
}

/** The parts of one of Excel's slicer styles as the grid draws it, to start a style of your own from. Null for a name that isn't one. */
export function builtinSlicerStyle(name: string | undefined): SlicerStyleDef | null {
  if (!name || !BUILTIN_SLICER_STYLE.test(name)) return null;
  const { accent, dark } = slicerAccent(name);
  const ink = "#262626";
  return {
    wholeTable: { fill: dark ? mix(accent, "#000000", 0.55) : "#ffffff", color: dark ? "#ffffff" : ink },
    headerRow: dark ? { fill: accent, color: "#ffffff", bold: true } : { color: ink, bold: true },
    unselectedItemWithData: { fill: dark ? mix(accent, "#000000", 0.35) : "#ffffff", color: dark ? "#ffffff" : ink },
    selectedItemWithData: { fill: mix(accent, "#ffffff", dark ? 0.2 : 0.55), color: ink },
    unselectedItemWithNoData: { fill: dark ? mix(accent, "#000000", 0.55) : "#f2f2f2", color: "#a6a6a6" },
    selectedItemWithNoData: { fill: dark ? mix(accent, "#000000", 0.45) : "#e8e8e8", color: "#a6a6a6" },
    hoveredUnselectedItemWithData: { fill: mix(accent, "#ffffff", 0.8), color: ink },
    hoveredSelectedItemWithData: { fill: mix(accent, "#ffffff", 0.4), color: ink },
    hoveredUnselectedItemWithNoData: { fill: "#f2f2f2", color: "#a6a6a6" },
    hoveredSelectedItemWithNoData: { fill: "#e8e8e8", color: "#a6a6a6" },
  };
}

/** The part of a style a button is drawn with. */
export function itemPart(selected: boolean, available: boolean, hovered: boolean): SlicerStylePart {
  const base = `${selected ? "selected" : "unselected"}Item${available ? "WithData" : "WithNoData"}`;
  return (hovered ? `hovered${base[0]!.toUpperCase()}${base.slice(1)}` : base) as SlicerStylePart;
}

export type { ConditionalStyle };
