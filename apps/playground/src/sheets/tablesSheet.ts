import type { SheetSession } from "@pli.dev/sheets";

const SHEET = "Tables";

/**
 * An orders table with a calculated column and a total row, and formulas that name its columns. Type under the table and
 * it grows, and the new row gets the Total formula. The header has filter and sort buttons, a slicer filters Region, one
 * Total was typed over (the green corner), the style is one of its own, and a second table has no header row.
 */
export function fillTablesSheet(s: SheetSession): void {
  s.setValues(SHEET, "A1", [
    ["Order", "Region", "Qty", "Unit price", "Total"],
    ["A-1001", "North", 12, 4.5, null],
    ["A-1002", "South", 3, 19, null],
    ["A-1003", "North", 7, 8.25, null],
    ["A-1004", "East", 20, 2.1, null],
    ["A-1005", "South", 5, 11, null],
  ]);
  s.setFormat(SHEET, "D2:E7", "$#,##0.00");
  s.createTable(SHEET, "A1:E6", { name: "Orders", style: "TableStyleMedium9" });
  // One formula in the Total column fills it, and rows added to the table get it too.
  s.setCell(SHEET, "E2", "=[@Qty]*[@[Unit price]]");
  s.setTableTotals("Orders", true);
  s.setColumnWidth(SHEET, 4, 12);
  // A style of your own: a navy header, and stripes two rows wide.
  s.setTableStyle("Harbor", {
    wholeTable: { border: { bottom: { style: "thin", color: "#9fb4cc" } } },
    headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff" },
    firstRowStripe: { fill: "#e6eef7" },
    secondRowStripe: { fill: "#ffffff" },
    rowStripeSize: 2,
    totalRow: { bold: true, border: { top: { style: "double", color: "#1f3a5f" } } },
    firstHeaderCell: { italic: true },
  });
  s.setTableOptions("Orders", { style: "Harbor" });
  // Typed over: the green corner marks a cell that doesn't follow its column.
  s.setCell(SHEET, "E5", 48);
  s.addSlicer(SHEET, { table: "Orders", column: "Region", from: { row: 1, col: 7 }, height: 190 });

  s.setValues(SHEET, "A17", [
    ["What the table says"],
    ["Orders", '=ROWS(Orders)'],
    ["Units", "=SUM(Orders[Qty])"],
    ["Revenue", "=SUM(Orders[Total])"],
    ["North revenue", '=SUMIFS(Orders[Total],Orders[Region],"North")'],
    ["Biggest order", "=MAX(Orders[Total])"],
    ["Largest quantity", "=INDEX(Orders[Order],MATCH(MAX(Orders[Qty]),Orders[Qty],0))"],
  ]);
  s.setValues(SHEET, "A26", [["E5 was typed over, so it has a green corner: click it and use the ! beside it to put the formula back."], ["Try the buttons in the header row, and the slicer. Filtered rows are hidden, so what is beside the table hides with them."]]);
  s.setStyle(SHEET, "A26:A27", { italic: true, color: "#666666" });
  s.setStyle(SHEET, "A17", { bold: true });
  s.setFormat(SHEET, "B20:B22", "$#,##0.00");
  s.setColumnWidth(SHEET, 1, 16);
  s.setColumnWidth(SHEET, 2, 14);

  // A table with no header row: its columns are still named (Service, Rate), so formulas can use them.
  s.setValues(SHEET, "A11", [["Service", "Rate"], ["Standard", 1], ["Express", 1.8], ["Overnight", 2.6]]);
  s.createTable(SHEET, "A11:B14", { name: "Rates", style: "TableStyleLight9" });
  s.setTableHeader("Rates", false);
  s.setValues(SHEET, "D12", [["Average rate"], ["=AVERAGE(Rates[Rate])"]]);
}
