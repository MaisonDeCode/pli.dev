/** A pared-down CSS reader: declarations, simple stylesheet rules, colors and lengths. Enough for clipboard HTML. */

export type Declarations = Record<string, string>;

/** Splits `a: b; c: d` into properties, honouring quotes and parentheses (so `url(data:x;y)` is one value). */
export function parseDeclarations(source: string): Declarations {
  const out: Declarations = {};
  let depth = 0;
  let quote = "";
  let start = 0;
  const flush = (end: number) => {
    const piece = source.slice(start, end);
    const colon = piece.indexOf(":");
    if (colon > 0) {
      const name = piece.slice(0, colon).trim().toLowerCase();
      const value = piece.slice(colon + 1).replace(/!important/gi, "").trim();
      if (name && value) out[name] = value;
    }
    start = end + 1;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) flush(i);
  }
  flush(source.length);
  return out;
}

export interface Rule {
  selector: { tag?: string; classes: string[]; id?: string };
  specificity: number;
  declarations: Declarations;
}

/** Reads `tag`, `.class`, `tag.class` and `#id` rules (and comma lists of them). Anything fancier is skipped. */
export function parseStylesheet(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--|-->/g, "");
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = pattern.exec(clean); m; m = pattern.exec(clean)) {
    const selectors = m[1]!.trim();
    if (selectors.startsWith("@")) continue;
    const declarations = parseDeclarations(m[2]!);
    for (const raw of selectors.split(",")) {
      const text = raw.trim();
      const parsed = /^([a-zA-Z][a-zA-Z0-9]*)?((?:\.[\w-]+)*)(#[\w-]+)?$/.exec(text);
      if (!parsed || !text) continue;
      const classes = parsed[2] ? parsed[2].split(".").filter(Boolean) : [];
      rules.push({
        selector: { tag: parsed[1]?.toLowerCase(), classes, id: parsed[3]?.slice(1) },
        specificity: (parsed[3] ? 100 : 0) + classes.length * 10 + (parsed[1] ? 1 : 0),
        declarations,
      });
    }
  }
  return rules;
}

export function ruleMatches(rule: Rule, tag: string, classes: readonly string[], id: string | undefined): boolean {
  const { selector } = rule;
  if (selector.tag && selector.tag !== tag) return false;
  if (selector.id && selector.id !== id) return false;
  return selector.classes.every((c) => classes.includes(c));
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  navy: "#000080", teal: "#008080", olive: "#808000", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff",
  fuchsia: "#ff00ff", magenta: "#ff00ff", brown: "#a52a2a", pink: "#ffc0cb", gold: "#ffd700", coral: "#ff7f50",
  crimson: "#dc143c", indigo: "#4b0082", violet: "#ee82ee", turquoise: "#40e0d0", tan: "#d2b48c",
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * Turns a CSS color into `#rrggbb`, or null when it is transparent, a keyword that means "inherit or
 * default", or a color form we don't read.
 */
export function parseColor(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v in NAMED_COLORS) return NAMED_COLORS[v]!;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${[...m[1]!].map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const channel = (s: string) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha === 0) return null;
    return `#${hex2(channel(m[1]!))}${hex2(channel(m[2]!))}${hex2(channel(m[3]!))}`;
  }
  return null;
}

const POINTS: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 28.3465, mm: 2.83465, pc: 12, q: 0.7087 };

/** A CSS length in points, for absolute units only. Relative units (em, %) return null. */
export function parseLengthPt(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^([\d.]+)\s*(pt|px|in|cm|mm|pc|q)$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = parseFloat(m[1]!) * POINTS[m[2]!]!;
  return Number.isFinite(n) ? n : null;
}
