import { useState } from "react";
import { PliSheet, useSheetSession, type ChipKind } from "@pli.dev/sheets-react";
import { createWorkbook, type PivotDataResolver, type SheetSession, type Workbook } from "@pli.dev/sheets";
import { BackToDemos } from "../BackToDemos";
import { fillChartsSheet } from "./chartsSheet";
import { fillFormattingSheet } from "./formattingSheet";
import { fillLambdaSheet } from "./lambdaSheet";
import { fillTablesSheet } from "./tablesSheet";
import { SAMPLE_IMAGE } from "./sampleImage";

/** A budget with formulas, formats, a second sheet and a named range, so there is something to try right away. */
export function sampleWorkbook(): Workbook {
  return createWorkbook("Budget", ["Budget", "Summary", "Tasks", "Charts", "Formatting", "Tables", "Lambda", "Order form", "Trends", "Orders", "Pivot"]);
}

/** What the host holds for the pivot table over `data:Targets`: Data > Pivot table > Refresh asks for it again (here it is a fixed text). */
const TARGETS_CSV = "Region,Target\nNorth,120\nSouth,150\nEast,80\nNorth,30\n";
/** The pivotData hook: a host answers a request for outside data with rows, or CSV text, or null when it cannot find it. */
const pivotData: PivotDataResolver = ({ kind, name }) => (kind === "data" && name === "Targets" ? { csv: TARGETS_CSV } : null);

export function fillSample(s: SheetSession): void {
  s.setValues("Budget", "A1", [
    ["Item", "Category", "Qty", "Unit price", "Total"],
    ["Standing desk", "Furniture", 4, 489, "=C2*D2"],
    ["Monitor", "Equipment", 6, 329.99, "=C3*D3"],
    ["Ergonomic chair", "Furniture", 4, 259.5, "=C4*D4"],
    ["Webcam", "Equipment", 6, 79, "=C5*D5"],
    ["Headset", "Equipment", 8, 119.95, "=C6*D6"],
    ["Whiteboard", "Furniture", 2, 145, "=C7*D7"],
    [null, null, null, "Total", "=SUM(E2:E7)"],
  ]);
  s.setFormat("Budget", "D2:E8", "$#,##0.00");
  s.setStyle("Budget", "A1:E1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setStyle("Budget", "D8:E8", { bold: true });
  s.setColumnWidth("Budget", 1, 20);
  s.setColumnWidth("Budget", 2, 14);
  s.setColumnWidth("Budget", 4, 12);
  s.setColumnWidth("Budget", 5, 14);
  s.setFrozen("Budget", 1, 0);
  // Links, and notes (the red mark in a cell's corner).
  s.setValues("Budget", "G1", [["Go to the summary"], ["Pli.Sheets on the web"]]);
  s.setLink("Budget", "G1", { to: "#Summary!A1", tip: "The totals by category" });
  s.setLink("Budget", "G2", { to: "https://pli.dev/sheets/" });
  s.setColumnWidth("Budget", 7, 22);
  s.setNote("Budget", "D4", "Quote from the supplier, good until the end of the month.");
  s.addImage("Budget", { src: SAMPLE_IMAGE, from: { row: 10, col: 1 }, alt: "A purple banner" });
  // Sparklines in cells, and rows grouped under their subtotals.
  s.setValues("Trends", "A1", [["Product", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Line", "Columns", "Win/loss"]]);
  const trends: (number | null)[][] = [[5, 7, 6, 9, 12, 11, 14, 15], [10, 8, 9, 4, 3, 5, 2, 1], [-2, 3, -1, 4, -3, 2, 5, -4], [1, 3, null, 8, 6, 9, 7, 12]];
  trends.forEach((v, i) => s.setValues("Trends", `A${i + 2}`, [[`Product ${i + 1}`, ...v]]));
  s.setStyle("Trends", "A1:L1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  for (let r = 2; r <= 5; r++) s.setRowHeight("Trends", r, 24);
  for (const c of [10, 11, 12]) s.setColumnWidth("Trends", c, 14);
  s.addSparklines("Trends", { type: "line", location: "J2:J5", data: "B2:I5", markers: true, high: true, highColor: "#16a34a", low: true, lowColor: "#dc2626" });
  s.addSparklines("Trends", { type: "column", location: "K2:K5", data: "B2:I5", negative: true, min: "group", max: "group" });
  s.addSparklines("Trends", { type: "winloss", location: "L2:L5", data: "B2:I5" });
  s.setValues("Trends", "A8", [["Region", "Item", "Sales"], ["North", "Pens", 12], ["North", "Paper", 9], ["North total", null, null], ["South", "Pens", 7], ["South", "Paper", 5], ["South total", null, null], ["All regions", null, null]]);
  s.setCell("Trends", "C11", "=SUM(C9:C10)");
  s.setCell("Trends", "C14", "=SUM(C12:C13)");
  s.setCell("Trends", "C15", "=C11+C14");
  s.setStyle("Trends", "A8:C8", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setStyle("Trends", "A11:C11", { bold: true });
  s.setStyle("Trends", "A14:C14", { bold: true });
  s.setStyle("Trends", "A15:C15", { bold: true });
  s.groupRows("Trends", 9, 14);
  s.groupRows("Trends", 9, 10);
  s.groupRows("Trends", 12, 13);
  s.toggleGroup("Trends", "row", 14);
  // A pivot table: the records of the Orders sheet summed up by region and product. Data > Pivot table > Refresh draws it again.
  const orders: [string, string, string, number, number][] = [
    ["2025-01", "North", "Pens", 12, 36], ["2025-01", "North", "Paper", 9, 45], ["2025-01", "South", "Pens", 7, 21], ["2025-01", "South", "Ink", 3, 36],
    ["2025-02", "North", "Ink", 4, 48], ["2025-02", "South", "Pens", 11, 33], ["2025-02", "South", "Paper", 6, 30], ["2025-02", "East", "Pens", 8, 24],
    ["2025-03", "East", "Paper", 10, 50], ["2025-03", "East", "Ink", 2, 24], ["2025-03", "North", "Pens", 15, 45], ["2025-03", "South", "Ink", 5, 60],
  ];
  s.setValues("Orders", "A1", [["Month", "Region", "Item", "Qty", "Amount"], ...orders]);
  s.setStyle("Orders", "A1:E1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setFormat("Orders", "E2:E13", "$#,##0");
  s.createPivot("Pivot", { name: "SalesByRegion", source: "Orders!A1:E13", anchor: "A1", rows: ["Region", "Item"], columns: ["Month"], values: [{ field: "Amount", fmt: "$#,##0" }] });
  // Data from outside the workbook: a named block the host fills (see TARGETS_CSV and the pivotData prop below), summed up by region.
  s.importCsv("data:Targets", TARGETS_CSV);
  s.createPivot("Pivot", { name: "Targets", source: "data:Targets", anchor: "I1", rows: ["Region"], values: [{ field: "Target", fmt: "$#,##0" }] });
  // How the budget prints: landscape, one page wide, the headings repeated, a header and a footer.
  s.setPageSetup("Budget", { orientation: "landscape", fit: { wide: 1, tall: 0 }, centerHorizontally: true, titleRows: [1, 1], header: { left: "&B&A", right: "&D" }, footer: { center: "Page &P of &N" } });
  // A protected sheet: the yellow cells are the only ones that take typing.
  s.setValues("Order form", "A1", [["Order form"], [null], ["Item", "Qty", "Price", "Total"], ["Pens", 10, 2.5, null], ["Paper", 4, 8, null], ["Ink", 2, 12.25, null], ["Order total", null, null, null], [null], ["Only the yellow cells can be changed. Data > Unprotect sheet turns that off (no password)."]]);
  for (const r of [4, 5, 6]) s.setCell("Order form", `D${r}`, `=B${r}*C${r}`);
  s.setCell("Order form", "D7", "=SUM(D4:D6)");
  s.setFormat("Order form", "C4:D7", "$#,##0.00");
  s.setStyle("Order form", "A1", { bold: true, fontSize: 14 });
  s.setStyle("Order form", "A3:D3", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setStyle("Order form", "A7:D7", { bold: true });
  s.setStyle("Order form", "B4:B6", { locked: false, fill: "#fff2cc" });
  s.setStyle("Order form", "A9", { italic: true, color: "#6b7280" });
  s.setColumnWidth("Order form", 1, 16);
  s.protectSheet("Order form", { allow: ["selectLockedCells", "selectUnlockedCells"] });
  s.setNote("Budget", "E8", "The total of the column. The Summary sheet reads it by its name, Total.");
  s.setValues("Summary", "A1", [
    ["Category", "Spend", "Share"],
    ["Furniture", '=SUMIF(Budget!B2:B7,A2,Budget!E2:E7)', "=B2/B$4"],
    ["Equipment", '=SUMIF(Budget!B2:B7,A3,Budget!E2:E7)', "=B3/B$4"],
    ["All", "=SUM(B2:B3)", "=SUM(C2:C3)"],
  ]);
  s.setFormat("Summary", "B2:B4", "$#,##0.00");
  s.setFormat("Summary", "C2:C4", "0.0%");
  s.setStyle("Summary", "A1:C1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setStyle("Summary", "A4:C4", { bold: true });
  s.setColumnWidth("Summary", 1, 16);
  s.setColumnWidth("Summary", 2, 14);
  s.defineName("Total", "Budget!$E$8");

  // Checkboxes, dropdowns and badges: a task list whose owners are people the app knows about.
  s.setValues("Tasks", "A1", [
    ["Task", "Done", "Status", "Owner", "Labels"],
    ["Order the desks", null, null, null, null],
    ["Set up the monitors", null, null, null, null],
    ["Buy a whiteboard", null, null, null, null],
    ["Install the webcams", null, null, null, null],
  ]);
  s.setControl("Tasks", "B2:B5", { type: "checkbox" });
  s.setControl("Tasks", "C2:C5", { type: "dropdown", options: [{ value: "Todo", color: "#e5e7eb" }, { value: "Doing", color: "#fde68a" }, { value: "Done", color: "#bbf7d0" }, { value: "Blocked", color: "#fecaca" }], strict: true });
  s.setControl("Tasks", "D2:D5", { type: "badge", kind: "person" });
  s.setControl("Tasks", "E2:E5", { type: "dropdown", options: [{ value: "Urgent", color: "#fecaca" }, { value: "Office", color: "#bfdbfe" }, { value: "Order", color: "#ddd6fe" }], multiple: true });
  s.setCells("Tasks", { B2: true, C2: "Done", D2: "ann", C3: "Doing", D3: "bo", E3: "Office", C4: "Todo", D4: "cy", E4: "Urgent, Order", C5: "Todo", D5: "ann", E5: "Office" });
  s.setStyle("Tasks", "A1:E1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setColumnWidth("Tasks", 1, 22);
  s.setColumnWidth("Tasks", 3, 12);
  s.setColumnWidth("Tasks", 4, 18);
  s.setColumnWidth("Tasks", 5, 20);
  s.setColumnWidth("Tasks", 7, 16);
  s.setValues("Tasks", "G1", [["Done"], ['=COUNTIF(B2:B5,TRUE)&" of "&COUNTA(A2:A5)']]);
  s.setStyle("Tasks", "G1", { bold: true });
  // A formula whose results fill the cells below it.
  s.setCells("Tasks", { G4: "Statuses in use", G5: "=UNIQUE(C2:C5)" });
  s.setStyle("Tasks", "G4", { bold: true });
  s.setFrozen("Tasks", 1, 0);
  fillChartsSheet(s);
  fillFormattingSheet(s);
  fillTablesSheet(s);
  fillLambdaSheet(s);
}

/** A round picture with someone's initials, drawn on the spot so the demo needs no files. */
function avatar(initials: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="${color}"/><text x="20" y="26" font-family="system-ui,sans-serif" font-size="16" font-weight="600" text-anchor="middle" fill="#fff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PEOPLE = [
  { id: "ann", name: "Ann Lee", role: "Operations", image: avatar("AL", "#6366f1") },
  { id: "bo", name: "Bo Chan", role: "IT", image: avatar("BC", "#0891b2") },
  { id: "cy", name: "Cy Ortiz", role: "Facilities", image: avatar("CO", "#c2410c") },
  { id: "di", name: "Di Novak", role: "Finance", image: avatar("DN", "#15803d") },
];

/** What a "person" badge means here: the cell keeps an id, and this gives the name and picture and lets people search. */
const CHIPS: Record<string, ChipKind> = {
  person: {
    label: "Person",
    resolve: (id) => {
      const p = PEOPLE.find((x) => x.id === id);
      return p && { value: p.id, label: p.name, image: p.image, color: "#e0e7ff", description: p.role };
    },
    search: (query) =>
      PEOPLE.filter((p) => `${p.name} ${p.role}`.toLowerCase().includes(query.toLowerCase())).map((p) => ({ value: p.id, label: p.name, image: p.image, description: p.role })),
  },
};

/** The spreadsheet editor on its own, with a sample workbook. Files go in and out through its File menu. */
export function SheetsDemo() {
  const session = useSheetSession(() => sampleWorkbook());
  useState(() => {
    if (!session.usedRange("Budget")) {
      fillSample(session);
      session.load(session.state); // the sample is the starting point, not something to undo
    }
    return true;
  });
  const [readOnly, setReadOnly] = useState(false);
  return (
    <div className="sheets-demo">
      <PliSheet
        session={session}
        pivotData={pivotData}
        readOnly={readOnly}
        chips={CHIPS}
        actions={
          <>
            <button type="button" className="pli-button" aria-pressed={readOnly} onClick={() => setReadOnly(!readOnly)}>
              Read only
            </button>
            <BackToDemos />
          </>
        }
      />
    </div>
  );
}
