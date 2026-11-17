import type { Border, BorderStyle, TableStyleBorders, TableStyleDef, TableStylePart } from "./model";
import { OFFICE_THEME, tinted } from "./xlsx-format";

/*
 * Excel's 60 built-in table styles (Light 1 to 21, Medium 1 to 28, Dark 1 to 11), as the parts Excel defines for each of them
 * (the whole table, the header and totals rows, the first and last column, the stripes), with the lines, fills and fonts of
 * each. The definitions are Office's own preset table styles (the same list Apache POI ships as `presetTableStyles.xml`).
 * A colour is `theme` or `theme:tint` (Excel's theme index: 0 and 1 are the light and dark text colours, 4 to 9 the accents)
 * and is turned into `#rrggbb` with Excel's tint rule and the Office palette; `A` stands for the accent of the style's column
 * in the gallery. Styles 2 to 7 of a group of seven (and Dark 2 to 7) share one definition with their own accent; the first
 * of a group is in the dark text colour and has a definition of its own.
 */

interface Spec { b?: 1; i?: 1; c?: string; f?: string; o?: Record<string, string> }
type Style = Partial<Record<keyof TableStyleDef, Spec>>;

const PRESETS: Record<string, Style> = {
  "TableStyleLight1": {"wholeTable":{"c":"1","o":{"top":"thin,1","bottom":"thin,1"}},"headerRow":{"b":1,"c":"1","o":{"bottom":"thin,1"}},"totalRow":{"b":1,"c":"1","o":{"top":"thin,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"0:-0.15"},"firstColumnStripe":{"f":"0:-0.15"}},
  "Light0acc": {"firstColumn":{"b":1,"c":"A:-0.25"},"firstColumnStripe":{"f":"A:0.8"},"firstRowStripe":{"f":"A:0.8"},"headerRow":{"b":1,"c":"A:-0.25","o":{"bottom":"thin,A"}},"lastColumn":{"b":1,"c":"A:-0.25"},"totalRow":{"b":1,"c":"A:-0.25","o":{"top":"thin,A"}},"wholeTable":{"c":"A:-0.25","o":{"bottom":"thin,A","top":"thin,A"}}},
  "TableStyleLight8": {"wholeTable":{"c":"1","o":{"left":"thin,1","right":"thin,1","top":"thin,1","bottom":"thin,1"}},"headerRow":{"b":1,"c":"0","f":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"o":{"top":"thin,1"}},"secondRowStripe":{"o":{"top":"thin,1"}},"firstColumnStripe":{"o":{"left":"thin,1"}},"secondColumnStripe":{"o":{"left":"thin,1"}}},
  "Light1acc": {"firstColumn":{"b":1,"c":"1"},"firstColumnStripe":{"o":{"left":"thin,A"}},"firstRowStripe":{"o":{"top":"thin,A"}},"headerRow":{"b":1,"c":"0","f":"A"},"lastColumn":{"b":1,"c":"1"},"secondColumnStripe":{"o":{"left":"thin,A"}},"secondRowStripe":{"o":{"top":"thin,A"}},"totalRow":{"b":1,"c":"1","o":{"top":"double,A"}},"wholeTable":{"c":"1","o":{"bottom":"thin,A","left":"thin,A","right":"thin,A","top":"thin,A"}}},
  "TableStyleLight15": {"wholeTable":{"c":"1","o":{"left":"thin,1","right":"thin,1","top":"thin,1","bottom":"thin,1","vertical":"thin,1","horizontal":"thin,1"}},"headerRow":{"b":1,"c":"1","o":{"bottom":"medium,1"}},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"0:-0.15"},"firstColumnStripe":{"f":"0:-0.15"}},
  "Light2acc": {"firstColumn":{"b":1,"c":"1"},"firstColumnStripe":{"f":"A:0.8"},"firstRowStripe":{"f":"A:0.8"},"headerRow":{"b":1,"c":"1","o":{"bottom":"medium,A"}},"lastColumn":{"b":1,"c":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"double,A"}},"wholeTable":{"c":"1","o":{"bottom":"thin,A","horizontal":"thin,A","left":"thin,A","right":"thin,A","top":"thin,A","vertical":"thin,A"}}},
  "TableStyleMedium1": {"wholeTable":{"c":"1","o":{"left":"thin,1","right":"thin,1","top":"thin,1","bottom":"thin,1","horizontal":"thin,1"}},"headerRow":{"b":1,"c":"0","f":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"0:-0.15"},"firstColumnStripe":{"f":"0:-0.15"}},
  "Medium0acc": {"firstColumn":{"b":1,"c":"1"},"firstColumnStripe":{"f":"A:0.8"},"firstRowStripe":{"f":"A:0.8"},"headerRow":{"b":1,"c":"0","f":"A"},"lastColumn":{"b":1,"c":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"double,A"}},"wholeTable":{"c":"1","o":{"bottom":"thin,A:0.4","horizontal":"thin,A:0.4","left":"thin,A:0.4","right":"thin,A:0.4","top":"thin,A:0.4"}}},
  "TableStyleMedium8": {"wholeTable":{"c":"1","f":"0:-0.15","o":{"vertical":"thin,0","horizontal":"thin,0"}},"headerRow":{"b":1,"c":"0","f":"1","o":{"bottom":"thick,0"}},"totalRow":{"b":1,"c":"0","f":"1","o":{"top":"thick,0"}},"firstColumn":{"b":1,"c":"0","f":"1"},"lastColumn":{"b":1,"c":"0","f":"1"},"firstRowStripe":{"f":"0:-0.35"},"firstColumnStripe":{"f":"0:-0.35"}},
  "Medium1acc": {"firstColumn":{"b":1,"c":"0","f":"A"},"firstColumnStripe":{"f":"A:0.6"},"firstRowStripe":{"f":"A:0.6"},"headerRow":{"b":1,"c":"0","f":"A","o":{"bottom":"thick,0"}},"lastColumn":{"b":1,"c":"0","f":"A"},"totalRow":{"b":1,"c":"0","f":"A","o":{"top":"thick,0"}},"wholeTable":{"c":"1","f":"A:0.8","o":{"horizontal":"thin,0","vertical":"thin,0"}}},
  "TableStyleMedium15": {"wholeTable":{"c":"1","o":{"left":"thin,1","right":"thin,1","top":"medium,1","bottom":"medium,1","vertical":"thin,1","horizontal":"thin,1"}},"headerRow":{"b":1,"c":"0","f":"1","o":{"bottom":"medium,1"}},"totalRow":{"o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"0","f":"1"},"lastColumn":{"b":1,"c":"0","f":"1"},"firstRowStripe":{"f":"0:-0.15"},"firstColumnStripe":{"f":"0:-0.15"}},
  "Medium2acc": {"firstColumn":{"b":1,"c":"0","f":"A"},"firstColumnStripe":{"f":"0:-0.15"},"firstRowStripe":{"f":"0:-0.15"},"headerRow":{"b":1,"c":"0","f":"A","o":{"bottom":"medium,1"}},"lastColumn":{"b":1,"c":"0","f":"A"},"totalRow":{"o":{"top":"double,1"}},"wholeTable":{"c":"1","o":{"bottom":"medium,1","top":"medium,1"}}},
  "TableStyleMedium22": {"wholeTable":{"c":"1","f":"0:-0.15","o":{"left":"thin,1","right":"thin,1","top":"thin,1","bottom":"thin,1","vertical":"thin,1","horizontal":"thin,1"}},"headerRow":{"b":1,"c":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"medium,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"0:-0.35"},"firstColumnStripe":{"f":"0:-0.35"}},
  "Medium3acc": {"firstColumn":{"b":1,"c":"1"},"firstColumnStripe":{"f":"A:0.6"},"firstRowStripe":{"f":"A:0.6"},"headerRow":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"medium,A"}},"wholeTable":{"c":"1","f":"A:0.8","o":{"bottom":"thin,A:0.4","horizontal":"thin,A:0.4","left":"thin,A:0.4","right":"thin,A:0.4","top":"thin,A:0.4","vertical":"thin,A:0.4"}}},
  "TableStyleDark1": {"wholeTable":{"c":"0","f":"1:0.45"},"headerRow":{"b":1,"c":"0","f":"1","o":{"bottom":"medium,0"}},"totalRow":{"b":1,"c":"0","f":"1:0.15","o":{"top":"medium,0"}},"firstColumn":{"b":1,"c":"0","f":"1:0.25","o":{"right":"medium,0"}},"lastColumn":{"b":1,"c":"0","f":"1:0.25","o":{"left":"medium,0"}},"firstRowStripe":{"f":"1:0.25"},"firstColumnStripe":{"f":"1:0.25"}},
  "Dark0acc": {"firstColumn":{"b":1,"c":"0","f":"A:-0.25","o":{"right":"medium,0"}},"firstColumnStripe":{"f":"A:-0.25"},"firstRowStripe":{"f":"A:-0.25"},"headerRow":{"b":1,"c":"0","f":"1","o":{"bottom":"medium,0"}},"lastColumn":{"b":1,"c":"0","f":"A:-0.25","o":{"left":"medium,0"}},"totalRow":{"b":1,"c":"0","f":"A:-0.5","o":{"top":"medium,0"}},"wholeTable":{"c":"0","f":"A"}},
  "TableStyleDark8": {"wholeTable":{"f":"0:-0.15"},"headerRow":{"c":"0","f":"1"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"0:-0.35"},"firstColumnStripe":{"f":"0:-0.35"}},
  "TableStyleDark9": {"wholeTable":{"f":"4:0.8"},"headerRow":{"c":"0","f":"5"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"4:0.6"},"firstColumnStripe":{"f":"4:0.6"}},
  "TableStyleDark10": {"wholeTable":{"f":"6:0.8"},"headerRow":{"c":"0","f":"7"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"6:0.6"},"firstColumnStripe":{"f":"6:0.6"}},
  "TableStyleDark11": {"wholeTable":{"f":"8:0.8"},"headerRow":{"c":"0","f":"9"},"totalRow":{"b":1,"c":"1","o":{"top":"double,1"}},"firstColumn":{"b":1,"c":"1"},"lastColumn":{"b":1,"c":"1"},"firstRowStripe":{"f":"8:0.6"},"firstColumnStripe":{"f":"8:0.6"}},
};

const colour = (token: string, accent: number, palette: readonly string[]): string => {
  const [theme, tint] = token.split(":");
  const base = palette[theme === "A" ? accent : Number(theme)] ?? OFFICE_THEME[Number(theme)]!;
  const hex = tint === undefined ? base : tinted(base.replace("#", ""), Number(tint));
  return "#" + hex.replace("#", "").toLowerCase();
};

const line = (spec: string, accent: number, palette: readonly string[]): Border => {
  const [style, token] = spec.split(",") as [BorderStyle, string];
  return { style, color: colour(token, accent, palette) };
};

function part(spec: Spec, accent: number, palette: readonly string[]): TableStylePart {
  const out: TableStylePart = {};
  if (spec.b) out.bold = true;
  if (spec.i) out.italic = true;
  if (spec.c) out.color = colour(spec.c, accent, palette);
  if (spec.f) out.fill = colour(spec.f, accent, palette);
  if (spec.o) {
    const border: TableStyleBorders = {};
    for (const [side, v] of Object.entries(spec.o)) (border as Record<string, Border>)[side] = line(v, accent, palette);
    out.border = border;
  }
  return out;
}

/**
 * The definition of one of Excel's built-in styles (`TableStyleMedium15`…), or null for a name that isn't one. `palette` is the
 * workbook's theme (ten `#rrggbb` colours in Excel's order: light 1, dark 1, light 2, dark 2, accents 1 to 6); Office's own by default.
 */
export function presetTableStyle(name: string, palette: readonly string[] = OFFICE_THEME.map((c) => "#" + c)): TableStyleDef | null {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(name);
  if (!m) return null;
  const family = m[1]!;
  const n = Number(m[2]);
  const count = family === "Light" ? 21 : family === "Medium" ? 28 : 11;
  if (n < 1 || n > count) return null;
  const column = (n - 1) % 7;
  const own = PRESETS[name];
  const spec = own ?? PRESETS[`${family}${Math.floor((n - 1) / 7)}acc`];
  if (!spec) return null;
  const accent = 3 + column;
  const def: TableStyleDef = {};
  for (const [k, v] of Object.entries(spec)) (def as Record<string, TableStylePart>)[k] = part(v, accent, palette);
  return def;
}
