import type { Deck, Master, Slide, Theme } from "./model";

/*
 * Font families in a deck: which ones it names (so an editor can load them, or a PDF can embed them) and a way to
 * replace them all (the "office" option of the PPTX writer). Fonts live in few places (a run's or level's `fontFamily`,
 * a character bullet's `font`, a chart's `fontFamily` and a theme's `fonts`), so one walk over the plain JSON finds
 * them wherever they sit: slides, layouts, masters, text styles, tables, groups, charts.
 */

/** Fonts whose characters are symbols; they can't be swapped for a text font without changing what shows. */
export const isSymbolFont = (name: string): boolean => /^(symbol|wingdings( [23])?|webdings|marlett|zapf ?dingbats|monotype sorts)$/i.test(name.trim());

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The family a font name stands for: theme references resolve through `theme`, other `+` names (`+mn-ea` of another script...) stand for none. */
function concrete(name: string, theme: Theme | undefined): string | undefined {
  const n = name.trim();
  if (n === "") return undefined;
  if (!n.startsWith("+")) return n;
  if (/^\+mj-/.test(n)) return theme?.fonts.major;
  if (/^\+mn-/.test(n)) return theme?.fonts.minor;
  return undefined;
}

const isTheme = (v: Obj): v is Obj & { fonts: Obj } => isObj(v.fonts) && isObj(v.colors) && typeof v.fonts.major === "string" && typeof v.fonts.minor === "string";

function visit(node: unknown, theme: Theme | undefined, add: (name: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, theme, add);
    return;
  }
  if (!isObj(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (key === "fontFamily" || (key === "font" && node.type === "char")) {
        const family = concrete(value, theme);
        if (family) add(family);
      }
    } else if (key === "fonts" && isTheme(node)) {
      add((value as { major: string }).major);
      add((value as { minor: string }).minor);
    } else visit(value, theme, add);
  }
}

/**
 * Every distinct concrete font family the deck names, in document order: the theme fonts of each master, then the
 * text of its master, its layouts and the slides, bullets, tables and charts. `+mj-lt` and `+mn-lt` count as the
 * theme's heading and body fonts (the theme of the master the slide's layout belongs to). Families are as written
 * (`"Lora"`, `"Comic Sans MS"`), so `registry.pdfFonts(usedFonts(deck))` gets the files for a PDF.
 */
export function usedFonts(deck: Deck): string[] {
  const out = new Set<string>();
  const add = (name: string) => {
    if (name.trim() !== "") out.add(name);
  };
  const masterOf = new Map<string, Master>();
  for (const m of deck.masters) for (const l of m.layouts) masterOf.set(l.id, m);
  const first = deck.masters[0]?.theme;
  for (const m of deck.masters) visit(m, m.theme, add);
  visit(deck.defaultTextStyle, first, add);
  for (const s of deck.slides as Slide[]) visit(s, masterOf.get(s.layout)?.theme ?? first, add);
  return [...out];
}

/** The deck with every font family replaced by `change(name)` (theme references are kept). Parts that don't change are shared with `deck`. */
export function mapFonts(deck: Deck, change: (name: string) => string): Deck {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let out: unknown[] | undefined;
      v.forEach((item, i) => {
        const next = swap(item);
        if (next !== item) (out ??= v.slice())[i] = next;
      });
      return out ?? v;
    }
    if (!isObj(v)) return v;
    let out: Obj | undefined;
    for (const [key, value] of Object.entries(v)) {
      let next: unknown = value;
      if (typeof value === "string") {
        if ((key === "fontFamily" || (key === "font" && v.type === "char")) && value.trim() !== "" && !value.startsWith("+")) next = change(value);
      } else if (key === "fonts" && isTheme(v)) {
        const f = value as { major: string; minor: string };
        const major = change(f.major);
        const minor = change(f.minor);
        if (major !== f.major || minor !== f.minor) next = { ...f, major, minor };
      } else next = swap(value);
      if (next !== value) (out ??= { ...v })[key] = next;
    }
    return out ?? v;
  };
  return swap(deck) as Deck;
}
