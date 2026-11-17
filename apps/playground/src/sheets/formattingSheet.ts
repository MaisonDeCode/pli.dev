import type { SheetSession } from "@pli.dev/sheets";

const SHEET = "Formatting";

/** A report with a merged title, borders and every kind of conditional format, to try on and change. */
export function fillFormattingSheet(s: SheetSession): void {
  s.setValues(SHEET, "A1", [["Quarterly review"]]);
  s.mergeCells(SHEET, "A1:G1", { center: true });
  s.setStyle(SHEET, "A1", { bold: true, fontSize: 16, fill: "#e4e2fb", color: "#3730a3" });

  s.setValues(SHEET, "A3", [
    ["Region", "Q1", "Q2", "Q3", "Q4", "Trend", "Status"],
    ["North", 42, 45, 51, 49, 12, "On track"],
    ["South", 30, 33, 31, 38, -4, "Watch"],
    ["East", 18, 22, 25, 24, 7, "On track"],
    ["West", 55, 48, 40, 33, -22, "At risk"],
    ["Central", 27, 27, 29, 31, 3, "On track"],
    ["Islands", 9, 12, 8, 14, 5, "Watch"],
  ]);
  s.setStyle(SHEET, "A3:G3", { bold: true, align: "center" });
  s.setBorders(SHEET, "A3:G9", "all", { style: "thin", color: "#c7c7d2" });
  s.setBorders(SHEET, "A3:G9", "outer", { style: "medium", color: "#3730a3" });
  s.setBorders(SHEET, "A3:G3", "bottom", { style: "double", color: "#3730a3" });
  s.setColumnWidth(SHEET, 1, 14);
  s.setColumnWidth(SHEET, 6, 14);
  s.setColumnWidth(SHEET, 7, 14);

  // Quarters as colour scale, one quarter as data bars, the trend as icons, the status by its words.
  s.addRule(SHEET, { kind: "colorScale", ranges: ["B4:C9"], stops: [{ type: "min", color: "#fcfcff" }, { type: "max", color: "#63be7b" }] });
  s.addRule(SHEET, { kind: "dataBar", ranges: ["E4:E9"], min: { type: "num", value: 0 }, max: { type: "max" }, color: "#638ec6" });
  s.addRule(SHEET, { kind: "iconSet", set: "3Arrows", ranges: ["F4:F9"], thresholds: [{ type: "num", value: 0 }, { type: "num", value: 5, gte: false }] });
  s.addRule(SHEET, { kind: "text", op: "contains", text: "risk", ranges: ["G4:G9"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
  s.addRule(SHEET, { kind: "text", op: "contains", text: "watch", ranges: ["G4:G9"], style: { fill: "#ffeb9c", color: "#9c5700" } });
  s.addRule(SHEET, { kind: "text", op: "contains", text: "track", ranges: ["G4:G9"], style: { fill: "#c6efce", color: "#006100" } });
  s.addRule(SHEET, { kind: "top", rank: 1, ranges: ["D4:D9"], style: { bold: true, border: { bottom: { style: "thin", color: "#2f9e44" }, top: { style: "thin", color: "#2f9e44" }, left: { style: "thin", color: "#2f9e44" }, right: { style: "thin", color: "#2f9e44" } } } });

  s.setValues(SHEET, "A12", [["Notes"], ["Merged cells keep only the top-left value; borders sit on the cell edges; rules change how a cell looks without changing what it holds."]]);
  s.mergeCells(SHEET, "A13:G15");
  s.setStyle(SHEET, "A13", { wrap: true, vAlign: "top", fill: "#f6f6f9" });
  s.setBorders(SHEET, "A13:G15", "outer", { style: "dashed", color: "#6b7280" });
  s.setStyle(SHEET, "A12", { bold: true });

  // An order form that refuses what doesn't fit: try typing into the blank cells.
  s.setValues(SHEET, "I3", [["Quantity", "Colour", "Email", "Ship by"], [3, "green", "ana@example.com", "=DATE(2025,3,1)"], [12, "pink", "no at sign", 45000]]);
  s.setValues(SHEET, "N3", [["Colours"], ["red"], ["green"], ["blue"]]);
  s.setStyle(SHEET, "I3:N3", { bold: true, align: "center" });
  s.setFormat(SHEET, "L4:L12", "yyyy-mm-dd");
  s.setBorders(SHEET, "I3:L12", "all", { style: "thin", color: "#c7c7d2" });
  s.setColumnWidth(SHEET, 11, 18);
  s.setColumnWidth(SHEET, 12, 12);
  s.addValidation(SHEET, { kind: "whole", op: "between", values: ["1", "10"], ranges: ["I4:I12"], promptTitle: "Quantity", prompt: "A whole number from 1 to 10", errorTitle: "Quantity", error: "Order between 1 and 10." });
  s.addValidation(SHEET, { kind: "list", source: `${SHEET}!$N$4:$N$6`, ranges: ["J4:J12"], error: "Pick a colour from the list." });
  s.addValidation(SHEET, { kind: "custom", formula: 'ISNUMBER(SEARCH("@",K4))', ranges: ["K4:K12"], alert: "warning", errorTitle: "Email", error: "That doesn't look like an email address." });
  s.addValidation(SHEET, { kind: "date", op: "greaterThanOrEqual", values: ["DATE(2024,1,1)"], ranges: ["L4:L12"], alert: "information", error: "Dates before 2024 are unusual here." });

  // Data bars with a zero line and their own colour for negatives, icons of your own choosing, a rule that changes how a
  // number shows, and a cell crossed out with a diagonal.
  s.setValues(SHEET, "P3", [["Change", "Rating", "Margin"], [12, 3, 0.123], [-4, 1, -0.05], [7, 2, 0.31], [-22, 1, -0.18], [3, 3, 0.07], [5, 2, 0.02]]);
  s.setStyle(SHEET, "P3:R3", { bold: true, align: "center" });
  s.setFormat(SHEET, "R4:R9", "0.0%");
  s.setColumnWidth(SHEET, 16, 16);
  s.setColumnWidth(SHEET, 17, 12);
  s.setColumnWidth(SHEET, 18, 12);
  s.addRule(SHEET, { kind: "dataBar", ranges: ["P4:P9"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", negativeColor: "#e5484d", solid: true, border: true });
  s.addRule(SHEET, { kind: "iconSet", set: "3Stars", ranges: ["Q4:Q9"], thresholds: [{ type: "num", value: 2 }, { type: "num", value: 3 }], custom: [{ set: "3Symbols", index: 0 }, { set: "3Flags", index: 1 }, { set: "3Stars", index: 2 }], hideValue: true });
  s.addRule(SHEET, { kind: "cell", op: "lessThan", values: ["0"], ranges: ["R4:R9"], style: { fmt: "[Red](0.0%)", bold: true } });
  s.setValues(SHEET, "P12", [["Not applicable"]]);
  s.setBorders(SHEET, "P12", "outer", { style: "thin", color: "#6b7280" });
  s.setBorders(SHEET, "P12", "diagonalDown", { style: "thin", color: "#6b7280" });
}
