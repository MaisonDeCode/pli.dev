import { FONT_ALIASES, SYSTEM_FONTS } from "./office";
import { googleFonts } from "./google";
import type { FontFamily } from "./types";

let index: Map<string, FontFamily> | undefined;

/** Case- and quote-insensitive key of a family name. */
export function fontKey(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ").toLowerCase();
}

function build(): Map<string, FontFamily> {
  const map = new Map<string, FontFamily>();
  // Google families first, so a system font of the same name (Arial, Georgia) wins.
  for (const f of googleFonts()) map.set(fontKey(f.family), f);
  for (const f of SYSTEM_FONTS) {
    map.set(fontKey(f.family), f);
    for (const a of f.aliases ?? []) map.set(fontKey(a), f);
  }
  for (const [alias, to] of Object.entries(FONT_ALIASES)) {
    const target = map.get(fontKey(to));
    if (target && !map.has(alias)) map.set(alias, target);
  }
  return map;
}

const custom = new Map<string, FontFamily>();

/**
 * Makes families of the host's own known to every part of Pli by name (stacks, fallbacks, widths, Office hints), not
 * only to the registry that was given them. `createFonts({ extra })` calls this; a name registered again is replaced.
 */
export function registerFonts(families: readonly FontFamily[]): void {
  for (const f of families) custom.set(fontKey(f.family), f);
}

/** The catalogue entry a family name stands for (aliases such as `ArialMT` included), or undefined for a name the catalogue doesn't know. */
export function lookupFont(name: string): FontFamily | undefined {
  index ??= build();
  const key = fontKey(name);
  return custom.get(key) ?? index.get(key);
}

/** The first name of a CSS `font-family` list, without quotes: `'"Lora", serif'` is `Lora`. */
export function primaryFamily(cssList: string): string {
  const first = cssList.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}
