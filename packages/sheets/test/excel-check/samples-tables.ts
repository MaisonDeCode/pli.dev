import { SheetSession, createWorkbook } from "../../src";
import type { Sample } from "./samples";

/*
 * Kit files 51 to 54, for the questions kit files 35, 23 and 34 left open: what made Excel repair file 35 (the sort levels
 * by colour and icon, or the slicer style), what Excel keeps of a slicer style of your own, how Excel writes a data
 * validation that reads another workbook, and a reference to a table in another workbook. (Excel drops a table's
 * `sortState` whatever is written, so there is no sample for that. Numbers 44 to 50 are left for the other samples.)
 */

const NOW = () => 45_000.5;
const fresh = (title: string, sheets: string[]) => new SheetSession(createWorkbook(title, ["Read me", ...sheets]), { now: NOW });

function readMe(s: SheetSession, title: string, see: string[]): void {
  s.setValues("Read me", "A1", [[title], ["Open this in Excel (and upload it to Google Sheets) and look for:"], ...see.map((line, i) => [`${i + 1}. ${line}`])]);
  s.setStyle("Read me", "A1", { bold: true, fontSize: 14 });
  s.setColumnWidth("Read me", 1, 110);
  s.setStyle("Read me", `A3:A${2 + see.length}`, { wrap: true, vAlign: "top" });
}

export const TABLE_SAMPLES: Sample[] = [
  {
    file: "51-table-sort-colour-icon.xlsx",
    title: "Table sort: levels by cell colour, font colour and icon, with no slicer in the file",
    see: [
      "Does Excel open this without a repair message? Kit file 35 (the same sort and a slicer in a style of your own) was repaired; this file has the sort alone, so a message here means the colour and icon sort levels were the cause, and none means the slicer style was. (Excel for Mac does not keep a table's sortState whatever is written, so Data > Sort will not list the levels; that is not the question.)",
      "The table 'Orders' (A1:D9) is already in sorted order: East Ink 9 150; East Paper 4 40; North Paper 3 30; North Pens 7 90; South Pens 8 100; South Ink 6 60; West Pens 10 120; West Ink 2 25, with pink Qty cells, dark red Item text on the Ink rows and arrows in Total. If there is a repair message, write down what the log says it removed.",
      "Save it back into excel-check/back/ with the same name.",
    ],
    build() {
      const s = fresh("Table sort colour and icon", ["Orders"]);
      s.setValues("Orders", "A1", [
        ["Region", "Item", "Qty", "Total"],
        ["West", "Pens", 10, 120],
        ["East", "Paper", 4, 40],
        ["West", "Ink", 2, 25],
        ["North", "Pens", 7, 90],
        ["East", "Ink", 9, 150],
        ["North", "Paper", 3, 30],
        ["South", "Ink", 6, 60],
        ["South", "Pens", 8, 100],
      ]);
      for (const a of ["C3", "C7", "C4"]) s.setStyle("Orders", a, { fill: "#ffc7ce" });
      for (const a of ["B4", "B6", "B8"]) s.setStyle("Orders", a, { color: "#9c0006" });
      s.addRule("Orders", { kind: "iconSet", set: "3Arrows", ranges: ["D2:D9"], thresholds: [{ type: "num", value: 50 }, { type: "num", value: 100 }] });
      s.createTable("Orders", "A1:D9", { name: "Orders" });
      s.sortTableBy("Orders", [
        { column: "Region" },
        { column: "Total", by: "icon", icon: { set: "3Arrows", index: 2 } },
        { column: "Qty", by: "cellColor", color: "#ffc7ce" },
        { column: "Item", by: "fontColor", color: "#9c0006" },
      ]);
      readMe(s, "Table sort by colour and icon", this.see);
      return s;
    },
  },
  {
    file: "52-slicer-styles.xlsx",
    title: "Slicer styles of your own: a full one and a plain one, to see what Excel keeps",
    see: [
      "Excel should open this without a repair message (kit file 35 was repaired, and Excel saved its slicer style 'Harbor' with none of its parts).",
      "Slicers sheet: the table 'Regions' has two slicers. The left (Region, at D1) uses the style 'Harbor': pale blue slicer, dark blue heading with white bold text, mid blue chosen buttons with white bold text, an italic grey for buttons with no data. The right (Qty, at G1) uses 'Plain': only a pale yellow fill for chosen buttons. Write down how each looks, and under Slicer > Slicer Styles whether 'Harbor' and 'Plain' are listed under Custom; right-click > Modify on each and write down which parts have a format.",
      "Save it back into excel-check/back/ with the same name. In the copy, xl/styles.xml shows what Excel kept of each style's parts (the kit's report counts slicerStyles).",
    ],
    build() {
      const s = fresh("Slicer styles", ["Slicers"]);
      s.setValues("Slicers", "A1", [["Region", "Qty"], ["West", 10], ["East", 4], ["North", 7], ["South", 6]]);
      s.createTable("Slicers", "A1:B5", { name: "Regions" });
      s.setSlicerStyle("Harbor", {
        wholeTable: { fill: "#f4f8fc", color: "#1f3a5f" },
        headerRow: { fill: "#1f3a5f", color: "#ffffff", bold: true },
        selectedItemWithData: { fill: "#6aa6e3", color: "#ffffff", bold: true },
        unselectedItemWithData: { fill: "#e6eef7", color: "#1f3a5f" },
        unselectedItemWithNoData: { color: "#9aa7b5", italic: true },
        hoveredUnselectedItemWithData: { fill: "#cfe1f4", color: "#1f3a5f" },
      });
      s.setSlicerStyle("Plain", { selectedItemWithData: { fill: "#fff2cc" } });
      s.addSlicer("Slicers", { table: "Regions", column: "Region", style: "Harbor", from: { row: 1, col: 4 } });
      s.addSlicer("Slicers", { table: "Regions", column: "Qty", style: "Plain", from: { row: 1, col: 7 } });
      readMe(s, "Slicer styles of your own", this.see);
      return s;
    },
  },
  {
    file: "53-validation-external-forms.xlsx",
    title: "Data validation that reads another workbook: what Pli writes, and one for you to type in Excel",
    see: [
      "Excel should open this without a repair message. Excel turned every way of writing a validation source outside the workbook into '…!#REF!' (kit files 23 and 34), so Pli now writes such a rule from the values it kept and holds the real rule in its own extension. On the Lists sheet B2:B3 is a list that reads [Prices.xlsx]Sheet1!$A$1:$A$3 and C2:C3 a decimal limited to the value of [Prices.xlsx]Sheet1!$B$1 (2.5).",
      "Click B2 and open the dropdown: it must list Pens, Paper and Ink, and Data > Data Validation must show a plain list (no #REF!). Click C2: Data > Data Validation shows Decimal, between... less than or equal to 2.5.",
      "Now the part only Excel can show: with this file open and Prices.xlsx (any workbook with Pens, Paper and Ink in Sheet1 A1:A3) open too, select E2 on the Lists sheet, choose Data > Data Validation > List and type =[Prices.xlsx]Sheet1!$A$1:$A$3 as the Source (if Excel accepts it), then save the file into excel-check/back/ with the same name. Send me that file: its xl/worksheets/sheet2.xml shows how Excel writes such a rule.",
    ],
    build() {
      const s = fresh("Validation external", ["Lists"]);
      s.setExternalCells("Prices.xlsx", "Sheet1", { A1: "Pens", A2: "Paper", A3: "Ink", B1: 2.5 }, { path: "Prices.xlsx", read: "2026-11-09" });
      s.setValues("Lists", "B1", [["List", "Limit", "", "Type one here"]]);
      s.addValidation("Lists", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$3", ranges: ["B2:B3"] });
      s.addValidation("Lists", { kind: "decimal", op: "lessThanOrEqual", values: ["[Prices.xlsx]Sheet1!$B$1"], ranges: ["C2:C3"] });
      readMe(s, "Validation that reads another workbook", this.see);
      return s;
    },
  },
  {
    file: "54-table-reference-external.xlsx",
    title: "A reference to a table in another workbook, written as the cells it stands for",
    see: [
      "Excel should open this without a repair message. Pli writes =SUM([Prices.xlsx]Orders[Total]) as =SUM([1]Sheet1!$C$2:$C$4) (Excel keeps no table definition of another workbook in the file), with the values read from Prices.xlsx kept in the link: B1 and B2 must show 81.5 and 16 even though Prices.xlsx is not in this folder.",
      "To see how Excel itself writes such a reference (so that Pli can write it the same way): in a new workbook type the cells of kit file 54's Orders table into Sheet1 of a workbook called Prices.xlsx (A1:C5: Item, Qty, Total; Pens 10 25; Paper 4 32; Ink 2 24.5; a totals row), make A1:C5 a table named Orders, keep it open, and in a second workbook type =SUM([Prices.xlsx]Orders[Total]) and =SUM([Prices.xlsx]Sheet1!Orders[Total]) in two cells. Write down what Excel shows in the formula bar for each, then save that workbook, close Prices.xlsx, reopen the saved one and write down the formulas again. Send me the saved file (as excel-check/back/54b-table-reference.xlsx).",
      "Save this file back into excel-check/back/ with the same name; the saved copy shows what Excel did with [1]Sheet1!$C$2:$C$4.",
    ],
    build() {
      const s = fresh("Table reference external", ["Sheet1"]);
      s.setExternalTable("Prices.xlsx", { name: "Orders", sheet: "Sheet1", range: "A1:C5", columns: ["Item", "Qty", "Total"], totals: true });
      s.setExternalCells("Prices.xlsx", "Sheet1", { A1: "Item", B1: "Qty", C1: "Total", A2: "Pens", B2: 10, C2: 25, A3: "Paper", B3: 4, C3: 32, A4: "Ink", B4: 2, C4: 24.5, A5: "Total", B5: 16, C5: 81.5 }, { path: "Prices.xlsx", read: "2026-11-09" });
      s.setValues("Sheet1", "A1", [["Total of Orders[Total]:"], ["Qty of Orders[Qty]:"]]);
      s.setCell("Sheet1", "B1", "=SUM([Prices.xlsx]Orders[Total])");
      s.setCell("Sheet1", "B2", "=SUM([Prices.xlsx]Sheet1!Orders[Qty])");
      readMe(s, "A reference to a table in another workbook", this.see);
      return s;
    },
  },
];
