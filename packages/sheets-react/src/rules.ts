import type { CellRuleOperator, CfValue, ConditionalRule, ConditionalStyle, DatePeriod, IconSetName, RuleSpec, TextRuleOperator } from "@pli.dev/sheets";

/** Looks a rule can be given from a list, as Excel offers them. */
export const STYLE_PRESETS: { label: string; style: ConditionalStyle }[] = [
  { label: "Light red fill with dark red text", style: { fill: "#ffc7ce", color: "#9c0006" } },
  { label: "Yellow fill with dark yellow text", style: { fill: "#ffeb9c", color: "#9c5700" } },
  { label: "Green fill with dark green text", style: { fill: "#c6efce", color: "#006100" } },
  { label: "Light red fill", style: { fill: "#ffc7ce" } },
  { label: "Red text", style: { color: "#9c0006" } },
  { label: "Red border", style: { border: { top: { style: "thin", color: "#e5484d" }, right: { style: "thin", color: "#e5484d" }, bottom: { style: "thin", color: "#e5484d" }, left: { style: "thin", color: "#e5484d" } } } },
  { label: "Bold", style: { bold: true } },
];

export const CELL_OPERATOR_LABELS: Record<CellRuleOperator, string> = {
  greaterThan: "greater than",
  greaterThanOrEqual: "greater than or equal to",
  lessThan: "less than",
  lessThanOrEqual: "less than or equal to",
  equal: "equal to",
  notEqual: "not equal to",
  between: "between",
  notBetween: "not between",
};

export const TEXT_OPERATOR_LABELS: Record<TextRuleOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  beginsWith: "begins with",
  endsWith: "ends with",
};

export const PERIOD_LABELS: Record<DatePeriod, string> = {
  yesterday: "yesterday",
  today: "today",
  tomorrow: "tomorrow",
  last7Days: "in the last 7 days",
  lastWeek: "last week",
  thisWeek: "this week",
  nextWeek: "next week",
  lastMonth: "last month",
  thisMonth: "this month",
  nextMonth: "next month",
};

export const ICON_SET_LABELS: Record<IconSetName, string> = {
  "3Arrows": "3 arrows",
  "3ArrowsGray": "3 arrows (gray)",
  "3Flags": "3 flags",
  "3TrafficLights1": "3 traffic lights",
  "3TrafficLights2": "3 traffic lights (rimmed)",
  "3Signs": "3 signs",
  "3Symbols": "3 symbols (circled)",
  "3Symbols2": "3 symbols",
  "4Arrows": "4 arrows",
  "4ArrowsGray": "4 arrows (gray)",
  "4RedToBlack": "4 red to black",
  "4Rating": "4 ratings",
  "4TrafficLights": "4 traffic lights",
  "5Arrows": "5 arrows",
  "5ArrowsGray": "5 arrows (gray)",
  "5Rating": "5 ratings",
  "5Quarters": "5 quarters",
  "3Stars": "3 stars",
  "3Triangles": "3 triangles",
  "5Boxes": "5 boxes",
};

const point = (p: CfValue): string => (p.type === "min" ? "lowest value" : p.type === "max" ? "highest value" : p.type === "formula" ? `=${p.value}` : p.type === "percent" ? `${p.value}%` : p.type === "percentile" ? `${p.value}th percentile` : String(p.value));

/** A rule in a few words, for a list of them. */
export function describeRule(rule: ConditionalRule): string {
  switch (rule.kind) {
    case "cell":
      return `Cell value ${CELL_OPERATOR_LABELS[rule.op]} ${rule.values.join(" and ")}`;
    case "text":
      return `Text ${TEXT_OPERATOR_LABELS[rule.op]} “${rule.text}”`;
    case "formula":
      return `Formula =${rule.formula}`;
    case "blanks":
      return "Blank cells";
    case "noBlanks":
      return "Cells that are not blank";
    case "errors":
      return "Cells with errors";
    case "noErrors":
      return "Cells without errors";
    case "duplicates":
      return "Duplicate values";
    case "uniques":
      return "Unique values";
    case "top":
      return `${rule.bottom ? "Bottom" : "Top"} ${rule.rank}${rule.percent ? "%" : ""}`;
    case "average":
      return `${rule.stdDev ? `${rule.stdDev} standard deviation${rule.stdDev > 1 ? "s" : ""} ` : ""}${rule.above ? "Above" : "Below"}${rule.equal ? " or equal to" : ""} average`;
    case "dates":
      return `Dates ${PERIOD_LABELS[rule.period]}`;
    case "colorScale":
      return `Color scale, ${rule.stops.map((s) => point(s)).join(" to ")}`;
    case "dataBar":
      return `Data bar, ${point(rule.min)} to ${point(rule.max)}`;
    case "iconSet":
      return `Icon set: ${ICON_SET_LABELS[rule.set]}`;
  }
}

/** The colours a data bar can be given from the menu. */
export const BAR_COLORS: { label: string; color: string }[] = [
  { label: "Blue", color: "#638ec6" },
  { label: "Green", color: "#63c384" },
  { label: "Red", color: "#ff555a" },
  { label: "Orange", color: "#ffb628" },
  { label: "Purple", color: "#a58dd0" },
];

/** The colour scales the menu offers. */
export const COLOR_SCALES: { label: string; colors: [string, string, string?] }[] = [
  { label: "Green, yellow, red", colors: ["#63be7b", "#ffeb84", "#f8696b"] },
  { label: "Red, yellow, green", colors: ["#f8696b", "#ffeb84", "#63be7b"] },
  { label: "Blue, white, red", colors: ["#5a8ac6", "#fcfcff", "#f8696b"] },
  { label: "Red, white, blue", colors: ["#f8696b", "#fcfcff", "#5a8ac6"] },
  { label: "White to green", colors: ["#fcfcff", "#63be7b"] },
  { label: "Green to white", colors: ["#63be7b", "#fcfcff"] },
  { label: "White to red", colors: ["#fcfcff", "#f8696b"] },
  { label: "Red to white", colors: ["#f8696b", "#fcfcff"] },
];

/** A colour scale from the lowest value to the highest. */
export function colorScaleRule(colors: readonly string[], ranges: string[]): RuleSpec {
  const stops = colors.length === 3 ? [{ type: "min" as const, color: colors[0]! }, { type: "percentile" as const, value: 50, color: colors[1]! }, { type: "max" as const, color: colors[2]! }] : [{ type: "min" as const, color: colors[0]! }, { type: "max" as const, color: colors[1]! }];
  return { kind: "colorScale", ranges, stops };
}

/** Steps that split the values evenly among `count` icons. */
export function evenSteps(count: number): CfValue[] {
  return Array.from({ length: count - 1 }, (_, i) => ({ type: "percent" as const, value: Math.round(((i + 1) * 100) / count) }));
}
