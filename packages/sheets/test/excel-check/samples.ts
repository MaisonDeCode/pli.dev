import { strFromU8, strToU8, unzipSync } from "fflate";
import { IMAGE_SHAPE_NAMES, SheetSession, createWorkbook, encodePng, isError, toDataUri, toXlsx, type Workbook, type Value, headerPictureFrom, officeThemeColors } from "../../src";
import { dateSerial } from "../../src/values";
import { GIF_1X1, JPEG_1X1, pngUri } from "../images-helpers";
import { SCENE_GIF, SCENE_JPEG } from "../image-fixtures";
import { TABLE_SAMPLES } from "./samples-tables";
import { CHART_SAMPLES } from "./samples-charts";
import { PICTURE_SAMPLES } from "./samples-pictures";

/**
 * Workbooks to open in real Excel and Google Sheets, one for each kind of thing Pli writes, so that a problem points at a
 * feature. Each has a "Read me" sheet first that says what to look for; the same lines go in CHECKLIST.md.
 */
export interface Sample {
  file: string;
  title: string;
  /** What to look for when the file is opened. */
  see: string[];
  build(): SheetSession;
  /** Rewrites parts of the package after it is written (to try forms Pli does not write, side by side). */
  patch?(files: Record<string, Uint8Array>): void;
  /** Package problems the sample is meant to have (the forms it tries are ones Pli does not write). */
  expected?: RegExp;
}

const NOW = () => 45_000.5;
const fresh = (title: string, sheets: string[]) => new SheetSession(createWorkbook(title, ["Read me", ...sheets]), { now: NOW });

/** Writes the "Read me" sheet: the title, a line saying what the file is for, and what to look for. */
function readMe(s: SheetSession, title: string, see: string[]): void {
  s.setValues("Read me", "A1", [[title], ["Open this in Excel (and upload it to Google Sheets) and look for:"], ...see.map((line, i) => [`${i + 1}. ${line}`])]);
  s.setStyle("Read me", "A1", { bold: true, fontSize: 14 });
  s.setColumnWidth("Read me", 1, 110);
  s.setStyle("Read me", `A3:A${2 + see.length}`, { wrap: true, vAlign: "top" });
}

// ---- 1. formulas ----

/** [formula, kind]: every one is worked out by Pli, and Excel must agree. */
const FORMULAS: string[] = [
  // math and statistics
  "SUM(Data!B2:B7)", "AVERAGE(Data!C2:C7)", "MIN(Data!C2:C7)", "MAX(Data!C2:C7)", "MEDIAN(Data!B2:B7)", "ROUND(Data!C2*3.14159,2)", "ROUNDUP(2.341,1)", "ROUNDDOWN(2.399,1)", "INT(-3.5)", "MOD(-10,3)", "POWER(2,10)", "SQRT(144)", "ABS(-5)", "SIGN(-2)", "CEILING(4.2,1)", "FLOOR(4.8,1)",
  "SUMPRODUCT(Data!B2:B7,Data!C2:C7)", "SUMIF(Data!E2:E7,\"Office\",Data!B2:B7)", "SUMIFS(Data!B2:B7,Data!E2:E7,\"Furniture\",Data!C2:C7,\">50\")", "COUNTIF(Data!B2:B7,\">2\")", "COUNTIFS(Data!E2:E7,\"Office\",Data!B2:B7,\">=4\")", "AVERAGEIF(Data!E2:E7,\"Furniture\",Data!C2:C7)", "MAXIFS(Data!C2:C7,Data!E2:E7,\"Office\")", "MINIFS(Data!C2:C7,Data!E2:E7,\"Furniture\")",
  "COUNTA(Data!A1:A9)", "COUNTBLANK(Data!A1:A9)", "LARGE(Data!C2:C7,2)", "SMALL(Data!C2:C7,2)", "RANK(Data!B3,Data!B2:B7)", "PERCENTILE(Data!C2:C7,0.3)", "STDEV(Data!B2:B7)", "VAR(Data!B2:B7)", "CORREL(Data!B2:B7,Data!C2:C7)", "SLOPE(Data!C2:C7,Data!B2:B7)", "INTERCEPT(Data!C2:C7,Data!B2:B7)", "FORECAST(5,Data!C2:C7,Data!B2:B7)",
  "PI()", "EXP(1)", "LN(10)", "LOG10(1000)", "LOG(8,2)", "FACT(6)", "GCD(12,18)", "LCM(4,6)", "COMBIN(5,2)", "PRODUCT(1,2,3,4)", "SIN(1)", "ATAN2(1,1)", "DEGREES(PI())", "NORM.DIST(1,0,1,TRUE)", "NORM.S.INV(0.9)", "T.DIST.2T(2,10)", "BINOM.DIST(3,10,0.5,FALSE)", "STDEV.S(Data!B2:B7)", "MODE.SNGL(Data!B2:B7)", "PERCENTRANK.INC(Data!B2:B7,4)",
  // logic
  "IF(Data!B2>5,\"many\",\"few\")", "IFS(Data!B2>20,\"a\",Data!B2>5,\"b\",TRUE,\"c\")", "AND(TRUE,Data!B2>1)", "OR(FALSE,Data!B3>10)", "NOT(FALSE)", "XOR(TRUE,TRUE)", "SWITCH(Data!E2,\"Office\",1,\"Furniture\",2,0)", "IFERROR(1/0,\"e\")", "IFNA(NA(),\"n\")", "CHOOSE(2,\"x\",\"y\",\"z\")",
  // text
  "LEFT(Data!A5,3)", "RIGHT(Data!A5,2)", "MID(Data!A5,2,3)", "LEN(Data!A5)", "UPPER(Data!A2)", "LOWER(\"ABC\")", "PROPER(\"hello wide world\")", "TRIM(\"  a   b  \")", "CONCAT(Data!A2,\"-\",Data!B2)", "TEXTJOIN(\", \",TRUE,Data!A2:A4)", "SUBSTITUTE(\"a-b-c\",\"-\",\"+\")", "REPLACE(\"abcdef\",2,3,\"X\")", "FIND(\"c\",\"abcabc\",4)", "SEARCH(\"B\",\"abcabc\")", "REPT(\"ab\",3)", "TEXT(1234.5,\"#,##0.00\")", "TEXT(Data!D2,\"yyyy-mm-dd\")", "TEXT(0.256,\"0.0%\")", "VALUE(\"12.5\")", "EXACT(\"a\",\"A\")", "CHAR(65)", "CODE(\"a\")", "TEXTBEFORE(\"a-b-c\",\"-\")", "TEXTAFTER(\"a-b-c\",\"-\",2)", "REGEXTEST(\"abc123\",\"[0-9]+\")", "REGEXEXTRACT(\"abc123def\",\"[0-9]+\")", "REGEXREPLACE(\"a1b22\",\"[0-9]+\",\"#\")", "NUMBERVALUE(\"1.234,5\",\",\",\".\")", "FIXED(1234.567,1)", "DOLLAR(1234.5)",
  // dates
  "DATE(2024,2,29)", "YEAR(Data!D2)", "MONTH(Data!D3)", "DAY(Data!D4)", "EDATE(Data!D2,1)", "EOMONTH(Data!D2,0)", "WEEKDAY(Data!D2)", "DAYS(Data!D3,Data!D2)", "DATEDIF(Data!D2,Data!D7,\"m\")", "NETWORKDAYS(Data!D2,Data!D3)", "WORKDAY(Data!D2,10)", "DATEVALUE(\"2024-03-05\")", "TIME(13,30,0)", "HOUR(0.75)", "WEEKNUM(Data!D4)", "ISOWEEKNUM(Data!D4)", "YEARFRAC(Data!D2,Data!D7)",
  // lookup and reference
  "VLOOKUP(\"Ink\",Data!A2:C7,3,FALSE)", "HLOOKUP(\"Qty\",Data!A1:C7,3,FALSE)", "XLOOKUP(\"Desk\",Data!A2:A7,Data!C2:C7)", "XLOOKUP(\"Nope\",Data!A2:A7,Data!C2:C7,\"none\")", "MATCH(\"Chair\",Data!A2:A7,0)", "INDEX(Data!C2:C7,3)", "INDEX(Data!A2:C7,MATCH(\"Lamp\",Data!A2:A7,0),2)", "ROWS(Data!A2:C7)", "COLUMNS(Data!A2:C7)", "INDIRECT(\"Data!B2\")", "ADDRESS(2,3)", "XMATCH(7,Data!B2:B7)", "LOOKUP(5,{1,3,7},{\"a\",\"b\",\"c\"})",
  // information
  "ISNUMBER(Data!B2)", "ISTEXT(Data!A2)", "ISBLANK(Data!A9)", "ISERROR(1/0)", "ISNA(NA())", "ISEVEN(4)", "ISODD(4)", "N(TRUE)", "TYPE(Data!A2)", "ISFORMULA(Data!B2)", "ISREF(Data!B2)", "SHEET()", "ERROR.TYPE(1/0)",
  // finance and engineering
  "PMT(0.05/12,60,-10000)", "FV(0.05/12,60,-100)", "PV(0.05/12,60,-200)", "NPV(0.1,100,200,300)", "IRR({-1000,300,400,500})", "RATE(60,-200,10000)", "NPER(0.05/12,-200,10000)", "SLN(1000,100,5)", "BIN2DEC(\"1010\")", "DEC2HEX(255)", "HEX2DEC(\"FF\")", "BITAND(12,10)", "CONVERT(1,\"mi\",\"km\")", "DELTA(2,2)",
  // dynamic-array functions used as scalars
  "LET(x,5,x*2)", "LET(f,LAMBDA(a,a+1),f(3))", "REDUCE(0,Data!B2:B7,LAMBDA(a,b,a+b))", "SUM(MAP(Data!B2:B7,LAMBDA(v,v*2)))", "SUM(FILTER(Data!B2:B7,Data!E2:E7=\"Office\"))", "ROWS(UNIQUE(Data!E2:E7))", "SUM(SORT(Data!B2:B7,1,-1))", "SUM(SEQUENCE(5))", "INDEX(SORT(Data!B2:B7),1)", "ROWS(FILTER(Data!A2:A7,Data!B2:B7>2))", "TEXTJOIN(\",\",TRUE,UNIQUE(Data!E2:E7))", "SUM(VSTACK(Data!B2:B3,Data!B6:B7))", "SUM(TAKE(Data!B2:B7,2))", "COUNTA(TEXTSPLIT(\"a,b,c\",\",\"))", "SUM(BYROW(Data!B2:C3,LAMBDA(r,SUM(r))))", "SUM(SCAN(0,Data!B2:B4,LAMBDA(a,b,a+b)))", "AVERAGE(CHOOSECOLS(Data!B2:C7,2))", "SUM(WRAPROWS(SEQUENCE(6),2))", "ROWS(SORTBY(Data!A2:A7,Data!B2:B7))", "SUM(DROP(Data!B2:B7,1))",
];

function formulasSheet(s: SheetSession): void {
  s.setValues("Data", "A1", [
    ["Item", "Qty", "Price", "Date", "Category"],
    ["Pens", 10, 2.5, 45306, "Office"],
    ["Paper", 4, 8, 45337, "Office"],
    ["Ink", 2, 12.25, 45366, "Office"],
    ["Desk", 7, 150, 45397, "Furniture"],
    ["Chair", 1, 89.9, 45427, "Furniture"],
    ["Lamp", 3, 24, 45458, "Furniture"],
  ]);
  s.setFormat("Data", "D2:D7", "yyyy-mm-dd");
  s.setValues("Formulas", "A1", [["Formula", "Excel's result", "Pli's result", "Check"]]);
  s.setStyle("Formulas", "A1:D1", { bold: true, fill: "#e4e2fb" });
  let row = 2;
  for (const f of FORMULAS) {
    const value: Value = s.calculator.evaluateAt("Formulas", row, 2, f);
    if (isError(value) || (typeof value === "object" && value !== null)) continue; // nothing to compare with
    s.setCell("Formulas", `A${row}`, "'" + f);
    s.setCell("Formulas", `B${row}`, "=" + f);
    s.setCell("Formulas", `C${row}`, typeof value === "string" ? "'" + value : value);
    const same = typeof value === "number" ? `ABS(B${row}-C${row})<=0.000001*MAX(1,ABS(C${row}))` : typeof value === "string" ? `EXACT(B${row},C${row})` : `B${row}=C${row}`;
    s.setCell("Formulas", `D${row}`, `=IF(ISERROR(B${row}),"ERROR",IF(${same},"ok","DIFFERENT"))`);
    row++;
  }
  s.setCell("Formulas", "F1", "Summary");
  s.setCell("Formulas", "F2", `=COUNTIF(D2:D${row},"ok")&" ok, "&COUNTIF(D2:D${row},"DIFFERENT")&" different, "&COUNTIF(D2:D${row},"ERROR")&" errors"`);
  s.setStyle("Formulas", "F1:F2", { bold: true });
  s.setColumnWidth("Formulas", 1, 52);
  s.setColumnWidth("Formulas", 2, 18);
  s.setColumnWidth("Formulas", 3, 18);
  s.setColumnWidth("Formulas", 6, 40);
  s.setFrozen("Formulas", 1, 0);
  s.addRule("Formulas", { kind: "cell", op: "equal", values: ['"DIFFERENT"'], ranges: [`D2:D${row}`], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
  s.addRule("Formulas", { kind: "cell", op: "equal", values: ['"ERROR"'], ranges: [`D2:D${row}`], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
  s.addRule("Formulas", { kind: "cell", op: "equal", values: ['"ok"'], ranges: [`D2:D${row}`], style: { color: "#006100" } });
}

function spillSheet(s: SheetSession): void {
  s.setValues("Spill", "A1", [["Formula", "Result (should fill the cells below and beside)"]]);
  const spills: [string, string][] = [
    ["=SEQUENCE(5)", "A3"], ["=SORT(Data!B2:B7)", "C3"], ["=UNIQUE(Data!E2:E7)", "E3"], ["=FILTER(Data!A2:B7,Data!B2:B7>2)", "G3"], ["=TRANSPOSE(Data!A2:A4)", "J3"], ["=Data!B2:B4*10", "A10"], ["=TEXTSPLIT(\"a,b,c\",\",\")", "C10"],
  ];
  for (const [f, at] of spills) s.setCell("Spill", at, f);
  s.setValues("Spill", "A1", [["Each block below is one formula that fills several cells. Excel shows it as an array formula: {=…} in the formula bar."]]);
}

// ---- printing ----

/** A long, narrow report and a wide one, set up to print: what Excel's print preview should agree with. */
function printingSheets(s: SheetSession): void {
  s.setValues("Report", "A1", [["Region", "Item", "Qty", "Price", "Total", "Quarter", "Rep", "Notes"]]);
  const regions = ["North", "South", "East", "West"];
  for (let r = 2; r <= 120; r++) {
    s.setValues("Report", `A${r}`, [[regions[r % 4]!, `Item ${r - 1}`, (r * 7) % 23 + 1, 2.5 + (r % 9), null, `Q${(r % 4) + 1}`, `Rep ${(r % 6) + 1}`, r % 10 === 0 ? "Check this row" : null]]);
    s.setCell("Report", `E${r}`, `=C${r}*D${r}`);
  }
  s.setStyle("Report", "A1:H1", { bold: true, fill: "#dce6f2" });
  s.setFormat("Report", "D2:E120", "$#,##0.00");
  s.setColumnWidth("Report", 2, 14);
  s.setColumnWidth("Report", 8, 20);
  s.setPageSetup("Report", {
    orientation: "landscape",
    paper: "a4",
    gridlines: true,
    centerHorizontally: true,
    titleRows: [1, 1],
    rowBreaks: [40],
    header: { left: "&A", center: "&B&12Quarterly report", right: "&D" },
    footer: { left: "&F", right: "Page &P of &N" },
  });
  s.setValues("Wide", "A1", [Array.from({ length: 30 }, (_, i) => `Column ${i + 1}`), ...Array.from({ length: 5 }, (_, r) => Array.from({ length: 30 }, (_, c) => (r + 1) * (c + 1)))]);
  s.setStyle("Wide", "A1:AD1", { bold: true });
  s.setPageSetup("Wide", { orientation: "landscape", fit: { wide: 2, tall: 1 }, footer: { center: "Page &P of &N" } });
}

const printingExpected = (() => {
  const s = new SheetSession(createWorkbook("Printing", ["Report", "Wide"]), { now: NOW });
  printingSheets(s);
  return { report: s.printLayout("Report"), wide: s.printLayout("Wide") };
})();

// ---- the samples ----

export const SAMPLES: Sample[] = [
  {
    file: "01-formulas.xlsx",
    title: "Formulas and dynamic arrays",
    see: [
      "On the Formulas sheet, the summary in F2 says '0 different, 0 errors' (every row is Excel's own result compared with Pli's; a row that says DIFFERENT or ERROR is red).",
      "No cell shows #NAME?. If some do, the function name in column A is one Excel doesn't know under the name Pli wrote.",
      "No formula in column B shows an @ in the formula bar (an @ means Excel read it as an old-style formula).",
      "On the Spill sheet each formula fills the cells below or beside it with the values you would expect (SEQUENCE 1 to 5, SORT ascending, UNIQUE two categories, FILTER the rows with Qty over 2), shown as {=…} array formulas.",
      "Google Sheets: the same, except the summary may differ for functions Sheets doesn't have (write down which).",
    ],
    build() {
      const s = fresh("Formulas", ["Formulas", "Data", "Spill"]);
      formulasSheet(s);
      spillSheet(s);
      readMe(s, "Formulas and dynamic arrays", this.see);
      return s;
    },
  },
  {
    file: "02-formats-and-styles.xlsx",
    title: "Number formats, fonts, fills, borders, merged cells, sizes",
    see: [
      "On the Formats sheet, column C (what Excel shows for the number in column A with the format in column B) reads exactly like column D (what Pli says it should show) on every row.",
      "On the Styles sheet: bold, italic, underline, strikethrough, colours, fills, a font size of 18 and Courier New all show; wrapped text wraps; the text aligned left, centre and right is where it says.",
      "Borders: thin, medium, thick, dashed, dotted, double and a diagonal show on the cells that say so; a box has all four sides.",
      "Merged cells: A14:C14 is one wide cell with centred text, and A16:A19 is one tall cell.",
      "Column B is wide and row 3 is tall; the top two rows and first column are frozen (they stay when you scroll); the tab 'Styles' is orange; a sheet called Hidden is not visible (right-click a tab, Unhide, to see it).",
    ],
    build() {
      const s = fresh("Formats and styles", ["Formats", "Styles", "Hidden"]);
      s.setValues("Formats", "A1", [["Number", "Format", "Excel shows", "Should show"]]);
      s.setStyle("Formats", "A1:D1", { bold: true, fill: "#e4e2fb" });
      const formats: [number, string][] = [
        [1234.5678, "0"], [1234.5678, "0.00"], [1234.5678, "#,##0"], [1234.5678, "#,##0.00"], [-1234.5, "#,##0.00;[Red]-#,##0.00"], [0.256, "0%"], [0.256, "0.0%"], [1234.5, "$#,##0.00"], [1234.5, "\"EUR \"#,##0.0"], [0.000123, "0.00E+00"], [45000.75, "yyyy-mm-dd"], [45000.75, "d mmm yyyy"], [45000.75, "dddd, mmmm d"], [45000.75, "m/d/yy h:mm AM/PM"], [45000.75, "hh:mm:ss"], [1.5, "# ?/?"], [1234567, "[>=1000000]0.0,,\"M\";[>=1000]0.0,\"K\";0"], [5, "00000"], [12.3, "0.0 \"units\""], [0, "0;-0;\"zero\""], [-3, "0;(0);\"zero\""], [1234.5, "@"], [42, "[Blue]0"], [0.5, "0.00%"], [100, "General"],
      ];
      formats.forEach(([value, code], i) => {
        const row = i + 2;
        s.setCell("Formats", `A${row}`, value);
        s.setCell("Formats", `B${row}`, "'" + code);
        s.setCell("Formats", `C${row}`, value);
        s.setFormat("Formats", `C${row}`, code);
        s.setCell("Formats", `D${row}`, "'" + s.display("Formats", `C${row}`).text);
      });
      s.setColumnWidth("Formats", 2, 44);
      s.setColumnWidth("Formats", 3, 22);
      s.setColumnWidth("Formats", 4, 22);

      s.setValues("Styles", "A1", [["Styles", "Wide column B"], ["Bold", "Italic"], ["Tall row", "Underline"], ["Strike", "Colour"], ["Red on yellow", "Size 18"], ["Courier New", "Wrapped text that is long enough to need more than one line in this column"], ["Left", "Centre"], ["Right", ""]]);
      s.setStyle("Styles", "A2", { bold: true });
      s.setStyle("Styles", "B2", { italic: true });
      s.setStyle("Styles", "B3", { underline: true });
      s.setStyle("Styles", "A4", { strike: true });
      s.setStyle("Styles", "B4", { color: "#1f77b4" });
      s.setStyle("Styles", "A5", { color: "#cc0000", fill: "#ffff00" });
      s.setStyle("Styles", "B5", { fontSize: 18 });
      s.setStyle("Styles", "A6", { fontFamily: "Courier New" });
      s.setStyle("Styles", "B6", { wrap: true });
      s.setStyle("Styles", "A7", { align: "left" });
      s.setStyle("Styles", "B7", { align: "center" });
      s.setStyle("Styles", "A8", { align: "right" });
      s.setColumnWidth("Styles", 2, 40);
      s.setRowHeight("Styles", 3, 40);
      s.setFrozen("Styles", 2, 1);
      s.setTabColor("Styles", "#f28e2b");
      const kinds = ["thin", "medium", "thick", "dashed", "dotted", "double"] as const;
      s.setValues("Styles", "D1", [["Borders"]]);
      kinds.forEach((style, i) => {
        s.setCell("Styles", `D${i + 2}`, style);
        s.setBorders("Styles", `D${i + 2}`, "all", { style, color: i % 2 ? "#cc0000" : "#000000" });
      });
      s.setCell("Styles", "D9", "diagonal");
      s.setBorders("Styles", "D9", "diagonalDown", { style: "thin" });
      s.setValues("Styles", "A14", [["Merged and centred across three cells"]]);
      s.mergeCells("Styles", "A14:C14", { center: true });
      s.setValues("Styles", "A16", [["Tall"], [""], [""], [""]]);
      s.mergeCells("Styles", "A16:A19");
      s.setStyle("Styles", "A16", { vAlign: "middle", align: "center" });
      s.setCell("Hidden", "A1", "You found the hidden sheet");
      s.hideSheets(["Hidden"]);
      readMe(s, "Formats and styles", this.see);
      return s;
    },
  },
  {
    file: "03-conditional-formats.xlsx",
    title: "Conditional formatting",
    see: [
      "Each block on the Rules sheet is labelled with what it should do. Values over 10 are red text on pink; names starting 'ap' are italic; a green-yellow-red colour scale runs down the Scale column; data bars with a solid fill and a negative colour show in the Bars column; traffic-light icons show in the Icons column; the top two values are green; duplicates are underlined.",
      "Home > Conditional Formatting > Manage Rules lists the rules (about 9), each over the range described.",
      "A formula rule ($B2<8) shades the whole row blue in the Formula block.",
      "Google Sheets: colour scales and cell-value rules carry over; data bars and icon sets don't (Sheets has no such thing); write down what is missing.",
    ],
    build() {
      const s = fresh("Conditional formats", ["Rules"]);
      s.setValues("Rules", "A1", [["Name", "Number", "Scale", "Bars", "Icons", "Formula row", "", "What each column should do"]]);
      const names = ["apple", "banana", "apricot", "cherry", "apple", "grape", "melon", "kiwi"];
      const numbers = [12, 7, 25, 3, 18, -4, 9, 30];
      names.forEach((n, i) => {
        const r = i + 2;
        s.setValues("Rules", `A${r}`, [[n, numbers[i]!, numbers[i]!, numbers[i]!, numbers[i]!, numbers[i]!]]);
      });
      s.setValues("Rules", "H2", [["Name: begins with 'ap' is italic; duplicates are underlined"], ["Number: over 10 is red on pink; the top two are green"], ["Scale: a three-colour scale"], ["Bars: data bars, negative values in another colour"], ["Icons: traffic lights by thirds"], ["Formula row: blue where the number is under 8"]]);
      s.setStyle("Rules", "A1:H1", { bold: true });
      s.setColumnWidth("Rules", 8, 60);
      s.addRule("Rules", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B9"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
      s.addRule("Rules", { kind: "text", op: "beginsWith", text: "ap", ranges: ["A2:A9"], style: { italic: true } });
      s.addRule("Rules", { kind: "duplicates", ranges: ["A2:A9"], style: { underline: true } });
      s.addRule("Rules", { kind: "top", rank: 2, ranges: ["B2:B9"], style: { fill: "#c6efce" } });
      s.addRule("Rules", { kind: "colorScale", ranges: ["C2:C9"], stops: [{ type: "min", color: "#f8696b" }, { type: "percentile", value: 50, color: "#ffeb84" }, { type: "max", color: "#63be7b" }] });
      s.addRule("Rules", { kind: "dataBar", ranges: ["D2:D9"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" });
      s.addRule("Rules", { kind: "iconSet", set: "3TrafficLights1", ranges: ["E2:E9"], thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });
      s.addRule("Rules", { kind: "formula", formula: "$B2<8", ranges: ["F2:F9"], style: { fill: "#ddeeff" } });
      readMe(s, "Conditional formatting", this.see);
      return s;
    },
  },
  {
    file: "04-data-validation.xlsx",
    title: "Data validation and dropdowns",
    see: [
      "Selecting a cell in column B shows its input message where there is one ('A whole number from 1 to 10') and an arrow for the lists.",
      "Try each: type 0 or 11 in the whole-number cell and Excel refuses (Stop); type text in the decimal cell and it refuses; type a date before 2024-01-01 in the date cell and it refuses; a 5-letter word in the length cell is refused.",
      "The first cell (B2) is a dropdown offering Red, Green, Blue (a list typed into the rule); typing 'Pink' is refused.",
      "The list read from another range (B8) offers Pens, Paper, Ink; the warning cell (B9) asks before refusing; the custom cell (B10) only accepts values larger than the cell to its left.",
      "Data > Data Validation > Circle Invalid Data circles the 11 that was pasted into the whole-number column.",
    ],
    build() {
      const s = fresh("Validation", ["Rules", "Lists"]);
      s.setValues("Lists", "A1", [["Pens"], ["Paper"], ["Ink"]]);
      s.setValues("Rules", "A1", [["What", "Type here"]]);
      s.setValues("Rules", "A2", [["List of colours"], ["Whole number 1 to 10"], ["Decimal over 0"], ["Date after 2024-01-01"], ["Text up to 4 letters"], ["Time between 06:00 and 18:00"], ["List from a range"], ["Warning alert (1 to 5)"], ["Custom: larger than the cell to the left"]]);
      s.setStyle("Rules", "A1:B1", { bold: true });
      s.setColumnWidth("Rules", 1, 40);
      s.setColumnWidth("Rules", 2, 20);
      s.setControl("Rules", "B2", { type: "dropdown", options: [{ value: "Red" }, { value: "Green" }, { value: "Blue" }], strict: true });
      s.addValidation("Rules", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B3"], prompt: "A whole number from 1 to 10", error: "Between 1 and 10 please.", errorTitle: "Out of range" });
      s.addValidation("Rules", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["B4"], noBlank: true, prompt: "More than zero" });
      s.addValidation("Rules", { kind: "date", op: "greaterThan", values: ["DATE(2024,1,1)"], ranges: ["B5"] });
      s.addValidation("Rules", { kind: "textLength", op: "lessThanOrEqual", values: ["4"], ranges: ["B6"] });
      s.addValidation("Rules", { kind: "time", op: "between", values: ["0.25", "0.75"], ranges: ["B7"] });
      s.addValidation("Rules", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B8"] });
      s.addValidation("Rules", { kind: "whole", op: "between", values: ["1", "5"], ranges: ["B9"], alert: "warning", error: "Outside 1 to 5. Keep it anyway?", errorTitle: "Unusual" });
      s.addValidation("Rules", { kind: "custom", formula: "B10>A10", ranges: ["B10"] });
      s.setCell("Rules", "A10", 5);
      s.setCell("Rules", "B3", 11, { validate: false });
      readMe(s, "Data validation", this.see);
      return s;
    },
  },
  {
    file: "05-charts.xlsx",
    title: "Charts",
    see: [
      "Eight charts on the Charts sheet: column, stacked bar, line, area, pie, a 3-D column, a 3-D pie and a scatter ('Pairs'). Each has the right shape and the data under it (compare with the cells A1:C4 and E1:F3).",
      "Click a chart: its data range outlines the cells it draws from; Chart Design > Select Data lists the series by the names in row 1.",
      "The colours are distinct per series; the pie has a legend of its categories; the line chart has a legend.",
      "Change a number in B2 and the column, line and area charts move.",
    ],
    build() {
      const s = fresh("Charts", ["Charts"]);
      s.setValues("Charts", "A1", [["Quarter", "North", "South"], ["Q1", 12, 8], ["Q2", 15, 11], ["Q3", 9, 14], ["Q4", 18, 10]]);
      s.setValues("Charts", "A7", [["Region", "Share"], ["North", 54], ["South", 43], ["East", 21]]);
      s.setValues("Charts", "E1", [["x", "y"], [1, 2], [2, 4], [3, 3]]);
      s.insertChart("Charts", "A1:C5", { type: "column", id: "c1" });
      s.updateChart("Charts", "c1", { title: "Sales by quarter", from: { row: 12, col: 1 } });
      const bar = s.insertChart("Charts", "A1:C5", { type: "bar" });
      s.updateChart("Charts", bar.id, { grouping: "stacked", from: { row: 12, col: 8 } });
      const line = s.insertChart("Charts", "A1:C5", { type: "line" });
      s.updateChart("Charts", line.id, { smooth: true, from: { row: 12, col: 15 } });
      const area = s.insertChart("Charts", "A1:C5", { type: "area" });
      s.updateChart("Charts", area.id, { from: { row: 30, col: 1 } });
      const pie = s.insertChart("Charts", "A7:B10", { type: "pie" });
      s.updateChart("Charts", pie.id, { from: { row: 30, col: 8 }, labels: true });
      const col3 = s.insertChart("Charts", "A1:C5", { type: "column" });
      s.updateChart("Charts", col3.id, { view3d: { rotX: 20, rotY: 30 }, from: { row: 30, col: 15 } });
      const pie3 = s.insertChart("Charts", "A7:B10", { type: "pie" });
      s.updateChart("Charts", pie3.id, { view3d: { rotX: 40, rotY: 0 }, from: { row: 48, col: 1 } });
      s.addChart("Charts", { type: "scatter", title: "Pairs", xTitle: "x", yTitle: "y", series: [{ name: "P", x: "Charts!$E$2:$E$4", values: "Charts!$F$2:$F$4" }], from: { row: 48, col: 8 } });
      readMe(s, "Charts", this.see);
      return s;
    },
  },
  {
    file: "06-tables.xlsx",
    title: "Tables: styles, filters, sorting, totals, calculated columns",
    see: [
      "Sheet Sales has a table 'Sales' in the Harbor style (a custom style: dark blue header, light banded rows). The header has filter buttons; the filter button on Region is active and only West rows show (rows for East and North are hidden); the table is sorted by Qty, highest first, and the Qty arrow shows it.",
      "A totals row at the bottom sums Qty and Total.",
      "The Total column is a calculated column ([@Qty]*[@Price]); the cell E5 is typed over with a plain number, and Excel may mark it with a green corner triangle (inconsistent calculated column formula).",
      "Table Design shows the name Sales, 'Header Row', 'Total Row' and 'Banded Rows' ticked.",
      "Sheet Rates has a table with no header row ('Rates'); Table Design shows Header Row unticked. The formula in D2, =AVERAGE(Rates[Rate]), works.",
      "Sheet Styles has the same data in Table Style Medium 2, Light 9 and Dark 4; each looks like its Excel name.",
    ],
    build() {
      const s = fresh("Tables", ["Sales", "Rates", "Styles"]);
      s.setValues("Sales", "A1", [["Region", "Item", "Qty", "Price", "Total"], ["West", "Pens", 10, 2.5, null], ["East", "Paper", 4, 8, null], ["West", "Ink", 2, 12.25, null], ["North", "Pens", 7, 2.5, null], ["West", "Desk", 3, 150, null]]);
      s.createTable("Sales", "A1:E6", { name: "Sales" });
      s.setCell("Sales", "E2", "=[@Qty]*[@Price]");
      s.setTableStyle("Harbor", { wholeTable: { fill: "#f2f6fb" }, headerRow: { bold: true, fill: "#1f4e79", color: "#ffffff" }, firstRowStripe: { fill: "#dce6f2" }, totalRow: { bold: true, fill: "#bdd0e6" } });
      s.setTableOptions("Sales", { style: "Harbor" });
      s.setCell("Sales", "E5", 17.5);
      s.setTableTotals("Sales", true);
      s.setCell("Sales", "C7", "=SUBTOTAL(109,[Qty])");
      s.setCell("Sales", "E7", "=SUBTOTAL(109,[Total])");
      s.filterTable("Sales", "Region", ["West"]);
      s.sortTable("Sales", "Qty", "descending");
      s.setCell("Sales", "G1", "Total of west rows:");
      s.setCell("Sales", "H1", "=SUM(Sales[Total])");
      s.setValues("Rates", "A1", [["Currency", "Rate"], ["EUR", 0.92], ["GBP", 0.79], ["JPY", 151.2]]);
      s.createTable("Rates", "A1:B4", { name: "Rates" });
      s.setTableHeader("Rates", false);
      s.setValues("Rates", "D1", [["Average rate"], [null]]);
      s.setCell("Rates", "D2", "=AVERAGE(Rates[Rate])");
      s.setValues("Styles", "A1", [["TableStyleMedium2", "", "", "TableStyleLight9", "", "", "TableStyleDark4"]]);
      ["A", "D", "G"].forEach((col, i) => {
        const c = col.charCodeAt(0) - 64;
        const at = (n: number) => `${String.fromCharCode(64 + c + n)}`;
        s.setValues("Styles", `${col}3`, [["Name", "Qty"], ["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
        const t = s.createTable("Styles", `${col}3:${at(1)}7`, { name: `Plain${i + 1}` });
        s.setTableOptions(t.name, { style: ["TableStyleMedium2", "TableStyleLight9", "TableStyleDark4"][i]! });
      });
      readMe(s, "Tables", this.see);
      return s;
    },
  },
  {
    file: "07-slicers.xlsx",
    title: "Slicers",
    see: [
      "The Sales sheet has two slicers to the right of the table, Region and Item, each a panel of buttons with its heading. Excel must open the file WITHOUT a repair prompt ('We found a problem with some content...'): this is the part of the file Pli is least sure of.",
      "Click 'West' in the Region slicer: the table shows only West rows, and the filter button on Region in the header agrees. Hold Ctrl and click 'East': both show. The slicer's clear button (top right) shows everything again.",
      "Slicer Tools > Slicer: the style is 'Light 1 (blue)'; the caption is 'Region'.",
      "Google Sheets: the slicers will not survive (Sheets slicers are another thing); the table's filter should.",
    ],
    build() {
      const s = fresh("Slicers", ["Sales"]);
      s.setValues("Sales", "A1", [["Region", "Item", "Qty"], ["West", "Pens", 10], ["East", "Paper", 4], ["West", "Ink", 2], ["North", "Pens", 7], ["East", "Desk", 3]]);
      s.createTable("Sales", "A1:C6", { name: "Sales" });
      s.addSlicer("Sales", { table: "Sales", column: "Region", from: { row: 1, col: 5 } });
      s.addSlicer("Sales", { table: "Sales", column: "Item", from: { row: 1, col: 8 }, columns: 2 });
      s.filterTable("Sales", "Region", ["West", "East"]);
      readMe(s, "Slicers", this.see);
      return s;
    },
  },
  {
    file: "08-links-and-notes.xlsx",
    title: "Links and notes",
    see: [
      "Links sheet: A1 is a web link (blue, underlined; hover shows the tip 'Pli on the web'; click opens https://pli.dev), A2 an email link, A3 a link to cell B2 on the Other sheet (click it: you land there), A4 a HYPERLINK() formula.",
      "Notes: the cells B2 and B4 have a red triangle in the corner; hovering shows the text ('Ask Ana', and a three-line one). Review > Show All Notes shows both boxes; Edit Note opens a box you can resize.",
      "Excel must open the file WITHOUT a repair prompt: notes are the part of the file Pli is least sure of (the drawing that holds their boxes).",
      "Google Sheets: links carry over; notes become notes (or comments) on the same cells.",
    ],
    build() {
      const s = fresh("Links and notes", ["Links", "Other"]);
      s.setValues("Links", "A1", [["Pli on the web"], ["Email Ana"], ["Go to Other!B2"], [null]]);
      s.setLink("Links", "A1", { to: "https://pli.dev", tip: "Pli on the web" });
      s.setLink("Links", "A2", { to: "mailto:ana@example.com?subject=Hello" });
      s.setLink("Links", "A3", { to: "#Other!B2" });
      s.setCell("Links", "A4", '=HYPERLINK("https://pli.dev/sheets/","Sheets docs")');
      s.setValues("Links", "B1", [["Notes"], ["Has a note"], [""], ["Has a long note"]]);
      s.setNote("Links", "B2", "Ask Ana");
      s.setNote("Links", "B4", "First line\nSecond line with & ampersand and <angle> brackets\nThird line");
      s.setColumnWidth("Links", 1, 24);
      s.setColumnWidth("Links", 2, 20);
      s.setValues("Other", "B2", [["You landed here"]]);
      s.setNote("Other", "B2", "A note on the other sheet");
      readMe(s, "Links and notes", this.see);
      return s;
    },
  },
  {
    file: "09-pictures.xlsx",
    title: "Pictures",
    see: [
      "The Pictures sheet shows three pictures: a green-and-red PNG block at B2 (about 160 by 80 pixels), a tiny JPEG and a tiny GIF further down (each 1 pixel scaled up to 60 by 40, so a flat colour).",
      "Click the PNG: Picture Format appears; Alt Text reads 'Green box'. It moves and resizes with the mouse and keeps its aspect ratio when a corner is dragged.",
      "Excel must open the file without a repair prompt.",
      "Google Sheets: the pictures show over the cells.",
    ],
    build() {
      const s = fresh("Pictures", ["Pictures"]);
      s.setValues("Pictures", "A1", [["Pictures are placed over the cells below"]]);
      s.addImage("Pictures", { src: pngUri(80, 40, [30, 150, 60]), from: { row: 2, col: 2 }, width: 160, height: 80, alt: "Green box" });
      s.addImage("Pictures", { src: JPEG_1X1, from: { row: 8, col: 2, dx: 10, dy: 4 }, width: 60, height: 40, alt: "A JPEG" });
      s.addImage("Pictures", { src: GIF_1X1, from: { row: 8, col: 5 }, width: 60, height: 40, alt: "A GIF" });
      readMe(s, "Pictures", this.see);
      return s;
    },
  },
  {
    file: "10-names-and-references.xlsx",
    title: "Names, other sheets, sheet names that need quotes, frozen panes",
    see: [
      "Totals: B2 =SUM(Region!B2:B5) etc. show numbers, not #REF!. A sheet called 'Q1 sales' (with a space) and one called O'Brien (with an apostrophe) are referred to correctly.",
      "Formulas > Name Manager lists Rate (=Totals!$B$1), Items (=Region!$A$2:$A$5) and TotalAll; cells that use them show numbers.",
      "Totals!B7 uses a whole-column reference (=SUM(Region!B:B)) and B8 a 3-D-looking range over one sheet.",
    ],
    build() {
      const s = fresh("Names", ["Totals", "Region", "Q1 sales", "O'Brien"]);
      s.setValues("Region", "A1", [["Item", "Amount"], ["Pens", 10], ["Paper", 20], ["Ink", 30], ["Desk", 40]]);
      s.setValues("Q1 sales", "A1", [["Item", "Amount"], ["Pens", 1], ["Paper", 2]]);
      s.setValues("O'Brien", "A1", [["Item", "Amount"], ["Pens", 100], ["Paper", 200]]);
      s.setCell("Totals", "B1", 0.2);
      s.defineName("Rate", "Totals!$B$1");
      s.defineName("Items", "Region!$A$2:$A$5");
      s.setValues("Totals", "A2", [["Region total"], ["Q1 total"], ["O'Brien total"], ["With rate"], ["Names"], ["Whole column"]]);
      s.setCell("Totals", "B2", "=SUM(Region!B2:B5)");
      s.setCell("Totals", "B3", "=SUM('Q1 sales'!B2:B3)");
      s.setCell("Totals", "B4", "=SUM('O''Brien'!B2:B3)");
      s.setCell("Totals", "B5", "=B2*(1+Rate)");
      s.setCell("Totals", "B6", "=ROWS(Items)&\" items\"");
      s.setCell("Totals", "B7", "=SUM(Region!B:B)");
      s.defineName("TotalAll", "Totals!$B$2+Totals!$B$3+Totals!$B$4");
      s.setCell("Totals", "B8", "=TotalAll");
      s.setCell("Totals", "A8", "TotalAll");
      readMe(s, "Names and references", this.see);
      return s;
    },
  },
  {
    file: "11-protection.xlsx",
    title: "Protection: locked cells, a protected sheet with a password, hidden formulas, protected structure",
    see: [
      "The Form sheet is protected. Typing in a locked cell such as A1 gives Excel's message that the cell is on a protected sheet. The yellow cells B2:B4 are unlocked: they take numbers, and the totals in C2:C4 follow. (An Excel for Mac may word the message differently.)",
      "Review > Unprotect Sheet asks for a password: type pli. If Excel says the password is not correct, the password check Pli writes does not match Excel's: tell me, that is the most important line here.",
      "After unprotecting, Review > Protect Sheet lists what people were allowed: Select locked cells, Select unlocked cells, Format cells and Sort are ticked, and every other option (including Edit objects) is not.",
      "C2's formula is hidden: while the sheet is protected, the formula bar is empty when C2 is selected, though C2 shows 20. B2 is unlocked and shows its number.",
      "The workbook's structure is protected: Review > Protect Workbook is highlighted, and right-clicking a tab shows Insert, Delete, Rename, Move and Hide greyed out. Unprotect it with the password wb.",
      "Google Sheets: sheet protection does not carry over the same way (Sheets keeps its own protected ranges); write down what it did with the Form sheet.",
    ],
    build() {
      const s = fresh("Protection", ["Form"]);
      s.setValues("Form", "A1", [["Item", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null], ["Ink", 2, null]]);
      s.setCell("Form", "C2", "=B2*2");
      s.setCell("Form", "C3", "=B3*2");
      s.setCell("Form", "C4", "=B4*2");
      s.setStyle("Form", "A1:C1", { bold: true });
      s.setStyle("Form", "B2:B4", { locked: false, fill: "#fff2cc" });
      s.setStyle("Form", "C2", { hideFormula: true });
      s.setColumnWidth("Form", 1, 18);
      readMe(s, "Protection", this.see);
      s.protectSheet("Form", { password: "pli", allow: ["selectLockedCells", "selectUnlockedCells", "formatCells", "sort"] });
      s.protectWorkbook({ password: "wb" });
      return s;
    },
  },
  {
    file: "12-printing.xlsx",
    title: "Printing: page setup, print titles, page breaks, headers and footers, fit to pages",
    see: [
      `File > Print (the preview): the Report sheet comes out on ${printingExpected.report.pages.length} pages (Pli's count), landscape A4, with a page break after row 40 and gridlines printed. Excel may differ by a page where its column widths or fonts print a little differently: write down its number.`,
      "On every page of Report the heading row (Region, Item, Qty…) is repeated at the top. Page Layout > Print Titles shows $1:$1 for the rows to repeat.",
      "The header has the sheet name (Report) at the left, 'Quarterly report' in bold in the middle and today's date at the right; the footer has the file name at the left and 'Page 2 of N' at the right of page 2.",
      `The Wide sheet (30 columns) is shrunk to fit 2 pages wide by 1 tall: Pli's layout is ${printingExpected.wide.pages.length} pages at ${printingExpected.wide.scale}%. Page Layout > Scale to Fit shows Width 2 pages and Height 1 page.`,
      "View > Page Break Preview (or the dashed lines on the Report sheet) shows the manual break after row 40 as a solid line and the automatic ones as dashed.",
      "Google Sheets: File > Print shows its own print settings; it keeps the page orientation and paper, and may drop the header, footer and repeated rows. Write down what it kept.",
    ],
    build() {
      const s = fresh("Printing", ["Report", "Wide"]);
      printingSheets(s);
      readMe(s, "Printing", this.see);
      return s;
    },
  },
  {
    file: "13-groups.xlsx",
    title: "Groups of rows and columns (an outline)",
    see: [
      "The Sales sheet has an outline: buttons 1, 2 and 3 at the top left of the grid, brackets and – or + buttons in the margin. The South region's detail rows (5 and 6) are collapsed, so row 7 (South subtotal) has a + button and rows 5 and 6 are not shown (row numbers jump from 4 to 7); the North detail (rows 2 and 3) is open. Row 8 (Grand total) has the – button of the outer group around rows 2 to 7.",
      "Click button 2: rows 4, 7 and 8 show (the two subtotals and the grand total) and the headings in row 1. Click 1: only the headings and row 8, the grand total. Click 3: everything, rows 5 and 6 included. Open and close one region with its own +/– button.",
      "Columns C and D are a group with their button above column E (the summary column); closing it hides them.",
      "Select rows 2 and 3 and choose Data > Ungroup: they leave their group (the + / – button for row 4 goes). The drop-down of Data > Ungroup also has Clear Outline. The small arrow at the corner of the Data tab's Outline group opens the Settings box, which shows 'Summary rows below detail' and 'Summary columns to right of detail' both ticked.",
      "Google Sheets: its groups use the same file marks; the collapsed South group should still be collapsed. Write down what it did.",
    ],
    build() {
      const s = fresh("Groups", ["Sales"]);
      s.setValues("Sales", "A1", [
        ["Region", "Item", "Jan", "Feb", "Total"],
        ["North", "Pens", 10, 12, null],
        ["North", "Paper", 4, 5, null],
        ["North subtotal", null, null, null, null],
        ["South", "Pens", 7, 8, null],
        ["South", "Paper", 3, 2, null],
        ["South subtotal", null, null, null, null],
        ["Grand total", null, null, null, null],
      ]);
      for (const r of [2, 3, 5, 6]) s.setCell("Sales", `E${r}`, `=C${r}+D${r}`);
      for (const [r, a, z] of [[4, 2, 3], [7, 5, 6]] as const) for (const col of ["C", "D", "E"]) s.setCell("Sales", `${col}${r}`, `=SUM(${col}${a}:${col}${z})`);
      for (const col of ["C", "D", "E"]) s.setCell("Sales", `${col}8`, `=${col}4+${col}7`);
      s.setStyle("Sales", "A1:E1", { bold: true, fill: "#dce6f2" });
      s.setStyle("Sales", "A4:E4", { bold: true });
      s.setStyle("Sales", "A7:E7", { bold: true });
      s.setStyle("Sales", "A8:E8", { bold: true, fill: "#f2f2f2" });
      s.groupRows("Sales", 2, 7);
      s.groupRows("Sales", 2, 3);
      s.groupRows("Sales", 5, 6);
      s.toggleGroup("Sales", "row", 7);
      s.groupColumns("Sales", 3, 4);
      readMe(s, "Groups", this.see);
      return s;
    },
  },
  {
    file: "14-sparklines.xlsx",
    title: "Sparklines: line, column and win/loss",
    see: [
      "On the Trends sheet, column J has a line sparkline for each row of months B to I: the high point is green, the low point red, and every point has a dot. Row 5 has an empty month: its line has a gap.",
      "Column K has a column sparkline for each row, with the months below zero in red, all on one shared axis (the least and most are the same for every row), so equal numbers are equal bars.",
      "Column L has win/loss sparklines: up bars for positive months, down bars for negative.",
      "Change a number in B2: the three sparklines on row 2 change. Click a cell with a sparkline: Sparkline > Edit Data and the style options show the type, colours and the points ticked.",
      "Google Sheets does not read these (it has its own SPARKLINE function): write down what it showed in J2:L7.",
    ],
    build() {
      const s = fresh("Sparklines", ["Trends"]);
      s.setValues("Trends", "A1", [["Product", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Line", "Columns", "Win/loss"]]);
      const rows: (number | null)[][] = [
        [5, 7, 6, 9, 12, 11, 14, 15],
        [10, 8, 9, 4, 3, 5, 2, 1],
        [-2, 3, -1, 4, -3, 2, 5, -4],
        [4, 4, 4, 5, 4, 4, 4, 4],
        [1, 3, null, 8, 6, 9, 7, 12],
        [20, 15, 18, 12, 14, 9, 11, 6],
      ];
      rows.forEach((values, i) => s.setValues("Trends", `A${i + 2}`, [[`Product ${i + 1}`, ...values]]));
      s.setStyle("Trends", "A1:L1", { bold: true, fill: "#dce6f2" });
      s.setColumnWidth("Trends", 10, 14);
      s.setColumnWidth("Trends", 11, 14);
      s.setColumnWidth("Trends", 12, 14);
      for (let r = 2; r <= 7; r++) s.setRowHeight("Trends", r, 24);
      s.addSparklines("Trends", { type: "line", location: "J2:J7", data: "B2:I7", markers: true, high: true, highColor: "#00aa00", low: true, lowColor: "#cc0000", color: "#1f4e79", lineWeight: 1.5 });
      s.addSparklines("Trends", { type: "column", location: "K2:K7", data: "B2:I7", negative: true, color: "#4f81bd", min: "group", max: "group" });
      s.addSparklines("Trends", { type: "winloss", location: "L2:L7", data: "B2:I7", color: "#2e7d32", negativeColor: "#c62828", negative: true });
      readMe(s, "Sparklines", this.see);
      return s;
    },
  },
  {
    file: "15-pivot-tables.xlsx",
    title: "Pivot tables",
    see: [
      "Excel should open this without a repair message. On opening it refreshes the pivot tables from the Orders sheet (they are saved without a copy of the records), so what you see is Excel's own drawing of them. If it asks to enable editing or refresh, allow it.",
      "The Pivot sheet has two pivot tables. PivotTable1 (A1) has Region and Item down the side, Month across the top and the sum of Amount in the body, with the Grand Total row and column. Excel's version should show the same numbers as the cells Pli drew, and the same layout (item names one step in from their region's name).",
      "PivotTable2 (A20) is in tabular layout with Region and Item in their own columns, subtotals under each region, a filter on Month at the top (only 2025-02 chosen), the Amount shown as a share of the grand total, and the average of Qty next to it. Check the filter, the percentages (the grand total should be 100%) and the Average of Qty heading.",
      "Click a cell in either table: the PivotTable Analyze and Design tabs should appear, with the fields in the field list where Pli put them. Change the source (add a row to Orders), then Refresh All: the numbers should change.",
      "Google Sheets: its pivot tables are a different kind of object; it should show the cells as they were saved. Write down what it did.",
    ],
    build() {
      const s = fresh("Pivot tables", ["Orders", "Pivot"]);
      s.setValues("Orders", "A1", [["Month", "Region", "Item", "Qty", "Amount"]]);
      const data: [string, string, string, number, number][] = [
        ["2025-01", "North", "Pens", 12, 36], ["2025-01", "North", "Paper", 9, 45], ["2025-01", "South", "Pens", 7, 21], ["2025-01", "South", "Ink", 3, 36],
        ["2025-02", "North", "Ink", 4, 48], ["2025-02", "South", "Pens", 11, 33], ["2025-02", "South", "Paper", 6, 30], ["2025-02", "East", "Pens", 8, 24],
        ["2025-03", "East", "Paper", 10, 50], ["2025-03", "East", "Ink", 2, 24], ["2025-03", "North", "Pens", 15, 45], ["2025-03", "South", "Ink", 5, 60],
      ];
      data.forEach((row, i) => s.setValues("Orders", `A${i + 2}`, [row]));
      s.setStyle("Orders", "A1:E1", { bold: true, fill: "#dce6f2" });
      s.createPivot("Pivot", { name: "PivotTable1", source: "Orders!A1:E13", anchor: "A1", rows: ["Region", "Item"], columns: ["Month"], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivot", {
        name: "PivotTable2",
        source: "Orders!A1:E13",
        anchor: "A20",
        rows: ["Region", "Item"],
        values: [{ field: "Amount", showAs: "percentOfTotal" }, { field: "Qty", fn: "average", name: "Average qty", fmt: "0.0" }],
        filters: [{ field: "Month", items: ["2025-02"] }],
        tabular: true,
      });
      readMe(s, "Pivot tables", this.see);
      return s;
    },
  },
  {
    file: "16-filter-conditions.xlsx",
    title: "Filters by condition, top and bottom, average, dates and colours",
    see: [
      "The Fruit sheet has a plain filter (Data > Filter) on A1:D9 with a filter on three columns. Click the arrow in Name: it should say Text Filters > Contains pie is in force. Amount has Number Filters > Between 5 and 30 (greater than or equal to 5 and less than or equal to 30). Day has a date filter, Date Filters > This Month. As saved, only the rows that pass all three are shown: Apple pie (row 2) and Peach pie (row 9); rows 3 to 8 are hidden. Re-applying (Data > Reapply) will hide different rows for Day, because Excel counts from today and the file was made for 15 March 2023.",
      "The Table sheet has a table called Orders with filter arrows. Item has a colour filter: Filter by Color > the yellow fill. Qty has Number Filters > Top 10 > Top 3 Items. Total has Number Filters > Above Average. Check the arrows show the filter symbol on all three, and that only Paper (row 3) shows, the one row that passes all three.",
      "Clear a filter and set it again from the menu to check the options are the ones the file named. Google Sheets: its filters are different; write down which of these it kept.",
    ],
    build() {
      const s = fresh("Filters by condition", ["Fruit", "Table"]);
      s.setValues("Fruit", "A1", [
        ["Name", "Amount", "Day", "Note"],
        ["Apple pie", 10, 45_000, "a"],
        ["apple tart", 25, 44_999, "b"],
        ["Banana", 7, 45_001, "c"],
        ["Cherry pie", 40, 44_990, "d"],
        ["Pear", null, 44_960, "e"],
        ["Plum pie", 25, 44_600, "f"],
        ["Fig", 3, 45_040, "g"],
        ["Peach pie", 12, 45_002, "h"],
      ]);
      s.setFormat("Fruit", "C2:C9", "yyyy-mm-dd");
      s.setStyle("Fruit", "A1:D1", { bold: true, fill: "#dce6f2" });
      s.setFilter("Fruit", "A1:D9");
      s.filterColumnRule("Fruit", 1, { kind: "custom", a: { op: "contains", value: "pie" } });
      s.filterColumnRule("Fruit", 2, { kind: "custom", a: { op: "greaterThanOrEqual", value: 5 }, b: { op: "lessThanOrEqual", value: 30 } });
      s.filterColumnRule("Fruit", 3, { kind: "date", period: "thisMonth" });
      s.setValues("Table", "A1", [
        ["Item", "Qty", "Total"],
        ["Pens", 12, 36],
        ["Paper", 9, 45],
        ["Ink", 4, 48],
        ["Stamps", 30, 60],
        ["Tape", 7, 21],
        ["Glue", 2, 10],
      ]);
      s.setStyle("Table", "A2:A4", { fill: "#ffff00" });
      s.createTable("Table", "A1:C7", { name: "Orders" });
      s.filterTableRule("Orders", "Item", { kind: "color", fill: "#ffff00" });
      s.filterTableRule("Orders", "Qty", { kind: "top", n: 3 });
      s.filterTableRule("Orders", "Total", { kind: "average" });
      readMe(s, "Filters by condition", this.see);
      return s;
    },
  },
  {
    file: "17-pivot-more.xlsx",
    title: "Pivot tables: sorted by a value, top items, outline form, differences, and GETPIVOTDATA",
    see: [
      "Excel should open this without a repair message and refresh the pivot tables from the Orders sheet when it opens (allow editing or refreshing if it asks). The Pivots sheet has four pivot tables; Excel's drawing of each should show the numbers Pli saved in the cells.",
      "SortedByAmount (A1): a Values caption over two headings, then Region down the side, sorted by the sum of Amount from the largest to the smallest (South 180, North 174, East 98, then the grand total), with the average of Qty beside it. Click the Region arrow: Sort should say More Sort Options > Descending (Z to A) by Sum of Amount.",
      "TopTwoItems (H1): the two Items with the greatest Amount (Ink 168, Pens 159), and a grand total of 327 that counts only those two. Click the Row Labels arrow: Value Filters > Top 10 should be in force, Top 2 Items by Sum of Amount.",
      "OutlineForm (A12): Region and Item in their own columns, each region's subtotal on the same line as the region and its items below it. Differences (H12): Month across the top and the sum of Amount shown as the difference from the previous month, so the first month (2025-01) column is empty and the others are differences.",
      "The Lookups sheet has three GETPIVOTDATA formulas that read the OutlineForm pivot table: they should be 452, 174 and 96 (North, and South's Ink). The kit's report says whether Excel agrees.",
      "The Kept as cells sheet has a pivot table that lists Qty twice, grouped in ranges of 5 and as it is, which Excel's file format can't hold (a field is grouped or it isn't). Pli draws it, but the file has only its cells, and there should be no pivot table to click.",
      "Google Sheets: its pivot tables are a different kind of object; it should show the cells as they were saved. Write down what it did.",
    ],
    build() {
      const s = fresh("More pivot tables", ["Orders", "Pivots", "Lookups", "Kept as cells"]);
      s.setValues("Orders", "A1", [["Month", "Region", "Item", "Qty", "Amount"]]);
      const data: [string, string, string, number, number][] = [
        ["2025-01", "North", "Pens", 12, 36], ["2025-01", "North", "Paper", 9, 45], ["2025-01", "South", "Pens", 7, 21], ["2025-01", "South", "Ink", 3, 36],
        ["2025-02", "North", "Ink", 4, 48], ["2025-02", "South", "Pens", 11, 33], ["2025-02", "South", "Paper", 6, 30], ["2025-02", "East", "Pens", 8, 24],
        ["2025-03", "East", "Paper", 10, 50], ["2025-03", "East", "Ink", 2, 24], ["2025-03", "North", "Pens", 15, 45], ["2025-03", "South", "Ink", 5, 60],
      ];
      data.forEach((row, i) => s.setValues("Orders", `A${i + 2}`, [row]));
      s.setStyle("Orders", "A1:E1", { bold: true, fill: "#dce6f2" });
      const base = { source: "Orders!A1:E13" };
      s.createPivot("Pivots", { ...base, name: "SortedByAmount", anchor: "A1", rows: [{ field: "Region", sortBy: { value: 0, descending: true } }], values: [{ field: "Amount", fmt: "$#,##0" }, { field: "Qty", fn: "average", name: "Average qty", fmt: "0.0" }] });
      s.createPivot("Pivots", { ...base, name: "TopTwoItems", anchor: "H1", rows: [{ field: "Item", sortBy: { value: 0, descending: true }, filter: { kind: "top", by: 0, n: 2 } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "OutlineForm", anchor: "A12", rows: ["Region", "Item"], values: [{ field: "Amount", fmt: "$#,##0" }], outline: true });
      s.createPivot("Pivots", { ...base, name: "Differences", anchor: "H12", rows: ["Region"], columns: ["Month"], values: [{ field: "Amount", showAs: "differenceFromPrevious", fmt: "$#,##0;-$#,##0" }] });
      s.setValues("Lookups", "A1", [
        ["Total", "=GETPIVOTDATA(\"Amount\",Pivots!$A$12)"],
        ["North", "=GETPIVOTDATA(\"Amount\",Pivots!$A$12,\"Region\",\"North\")"],
        ["South Ink", "=GETPIVOTDATA(\"Amount\",Pivots!$A$12,\"Region\",\"South\",\"Item\",\"Ink\")"],
      ]);
      s.createPivot("Kept as cells", { ...base, name: "GroupedAndPlain", anchor: "A1", rows: [{ field: "Qty", group: { by: "number", step: 5 } }, "Qty"], values: [{ field: "Amount" }] });
      readMe(s, "More pivot tables", this.see);
      return s;
    },
  },
  {
    file: "18-iteration.xlsx",
    title: "Iterative calculation: formulas that refer to themselves",
    see: [
      "Excel should open this without a repair message and without a circular reference warning, because the file turns iterative calculation on. File > Options > Formulas should show Enable iterative calculation ticked, with Maximum Iterations 100 and Maximum Change 0.001.",
      "On the Loops sheet, B2 is =(B2+10)/2, so it settles on 10: Excel should show 10 (to within 0.002). B3 and B4 read each other (=B4/2+5 and =B3), and both settle on 10. B5 is =B2+B3+B4 and should be 30. The Check column should say OK on each row.",
      "Turn iterative calculation off in the options: Excel should then warn about the circular references and show 0 in the cells that read themselves. Turn it back on and the numbers should return.",
      "Pli works a loop out starting from 0 each time it opens a file, so a cell that never settles (=A1+1) is not in this file: Excel starts from the value saved in the file and would carry on from there.",
    ],
    build() {
      const s = fresh("Iterative calculation", ["Loops"]);
      s.setValues("Loops", "A1", [["What", "Value", "Should be", "Check"]]);
      s.setStyle("Loops", "A1:D1", { bold: true, fill: "#dce6f2" });
      s.setValues("Loops", "A2", [
        ["Settles on its own", "=(B2+10)/2", 10, '=IF(ABS(B2-C2)<0.002,"OK","Different")'],
        ["Pair, first", "=B4/2+5", 10, '=IF(ABS(B3-C3)<0.002,"OK","Different")'],
        ["Pair, second", "=B3", 10, '=IF(ABS(B4-C4)<0.002,"OK","Different")'],
        ["Reads the loops", "=B2+B3+B4", 30, '=IF(ABS(B5-C5)<0.006,"OK","Different")'],
      ]);
      s.setColumnWidth("Loops", 1, 22);
      s.setIteration({ maxIterations: 100, maxChange: 0.001 });
      readMe(s, "Iterative calculation", this.see);
      return s;
    },
  },
  {
    file: "19-pictures-more.xlsx",
    title: "Pictures: cropped, turned, flipped, with a border, shadow and corrections, following their cells, in cells, and IMAGE",
    see: [
      "Excel should open this without a repair message. The Pictures sheet has pictures of three kinds of colour block, each 120 by 60 pixels or so, with a number of the picture's feature above it.",
      "Cropped (B3): a picture with a quarter cut from the left and from the top. Click it: Picture Format > Crop should show the crop, and the picture should not look stretched. Turned (E3): turned 30 degrees clockwise. Flipped (H3): mirrored left to right, so the red end of the block is on the right.",
      "Right-click each of the next three (B9, E9, H9) > Format Picture > Size & Properties > Properties: B9 should say Move and size with cells, E9 Move but don't size with cells, H9 Don't move or size with cells. Make row 9 taller: B9 should stretch, E9 and H9 should not. Insert a row above row 9: B9 and E9 should move down, H9 should stay where it was on the screen.",
      "Effects (B15, E15, H15): a picture with a thick orange dashed border (B15), one with a soft shadow falling down and to the right (E15), and one in shades of grey that is a little brighter and has less contrast (H15). Right-click one > Format Picture should show the same line, shadow and corrections.",
      "The In cells sheet has two pictures placed in cells (B2 with the description 'Green in a cell', and B4). They are written the way Excel's own Place in Cell does it: the cell holds a picture, not a floating one. Click B2: it should be a cell, with the picture drawn inside it and filling it, and the right-click menu should offer Place Over Cells (not Place in Cell). Make column B wider: the picture grows with it. Alt text on B2 reads 'Green in a cell'.",
      "A2 on the In cells sheet is =IMAGE(\"https://…\") with a picture address that doesn't exist on purpose: Excel may show #CONNECT! or a broken picture, and must not offer to repair the file. It should read the formula as =IMAGE(...) with the arguments Pli wrote.",
    ],
    build() {
      const s = fresh("More pictures", ["Pictures", "In cells"]);
      const block = (rgb: [number, number, number]) => pngUri(120, 60, rgb);
      s.setValues("Pictures", "A1", [["Pictures: crop, turn, flip, and how they follow their cells"]]);
      s.setValues("Pictures", "A2", [["", "Cropped", "", "", "Turned", "", "", "Flipped"]]);
      s.addImage("Pictures", { src: block([30, 150, 60]), from: { row: 3, col: 2 }, width: 90, height: 45, crop: { left: 0.25, top: 0.25 }, alt: "Cropped" });
      s.addImage("Pictures", { src: block([30, 60, 150]), from: { row: 3, col: 5 }, width: 120, height: 60, rotation: 30, alt: "Turned" });
      s.addImage("Pictures", { src: block([200, 40, 40]), from: { row: 3, col: 8 }, width: 120, height: 60, flipH: true, alt: "Flipped" });
      s.setValues("Pictures", "A8", [["", "Move and size", "", "", "Move, don't size", "", "", "Don't move or size"]]);
      s.addImage("Pictures", { src: block([30, 150, 60]), from: { row: 9, col: 2 }, width: 128, height: 60, placement: "size", alt: "Moves and sizes" });
      s.addImage("Pictures", { src: block([30, 60, 150]), from: { row: 9, col: 5 }, width: 120, height: 60, alt: "Moves" });
      s.addImage("Pictures", { src: block([200, 40, 40]), from: { row: 9, col: 8 }, width: 120, height: 60, placement: "free", alt: "Stays" });
      s.setValues("Pictures", "A14", [["", "Border", "", "", "Shadow", "", "", "Grey, brighter, less contrast"]]);
      s.addImage("Pictures", { src: block([30, 150, 60]), from: { row: 15, col: 2 }, width: 120, height: 60, border: { color: "#ff8800", width: 4, dash: "dash" }, alt: "With a border" });
      s.addImage("Pictures", { src: block([30, 60, 150]), from: { row: 15, col: 5 }, width: 120, height: 60, shadow: { blur: 10, distance: 8, angle: 45, opacity: 0.5 }, alt: "With a shadow" });
      s.addImage("Pictures", { src: block([200, 40, 40]), from: { row: 15, col: 8 }, width: 120, height: 60, grayscale: true, brightness: 0.2, contrast: -0.2, alt: "Corrected" });
      s.setRowHeight("Pictures", 3, 48);
      s.setRowHeight("Pictures", 9, 48);
      s.setValues("In cells", "A1", [["IMAGE function, and pictures placed in cells"]]);
      s.setCell("In cells", "A2", '=IMAGE("https://example.invalid/pli-logo.png","Pli logo")');
      s.setRowHeight("In cells", 2, 48);
      s.setRowHeight("In cells", 4, 48);
      s.setColumnWidth("In cells", 2, 22);
      s.setCellPicture("In cells", "B2", { src: block([30, 150, 60]), alt: "Green in a cell" });
      s.setCellPicture("In cells", "B4", { src: block([200, 40, 40]) });
      readMe(s, "More pictures", this.see);
      return s;
    },
  },
  {
    file: "20-pivot-settings.xlsx",
    title: "Pivot tables: calculated fields, blank lines, repeated labels, your own order, and comparing with a chosen item",
    see: [
      "Excel should open this without a repair message and refresh the six pivot tables on the Pivots sheet from the Orders sheet when it opens. Each should show the numbers Pli saved in the cells; the kit's report compares them.",
      "PerUnit (A1): Region down the side and two values: the sum of Amount, and Amount per unit, a calculated field (Amount divided by Qty). Click inside it: PivotTable Analyze > Fields, Items & Sets > Calculated Field should list Per unit with the formula = Amount / Qty.",
      "Tabular (A12): Region and Item in their own columns with a blank line after each region, and the region written again on every row. Click a Region cell: Design > Blank Rows and Repeat All Item Labels should be in force.",
      "OwnOrder (H1): the regions in the order South, East, then North (not alphabetical). Click the Region arrow: Sort should say More Sort Options > Manual.",
      "AgainstFebruary (H12): Region down the side, Month across the top, each amount shown as the difference from the 2025-02 column (that column is empty). Right-click a value > Show Values As should say Difference From, with the base field Month and the base item 2025-02.",
      "PercentOfNorth (A32): Region down the side, Item across the top, each amount as a percent of North's amount for the same item (North is 100%). Show Values As should say % Of, base field Region and base item North.",
      "RunningByRegion (H24): Region down the side, Month across, with a running total that adds up down the regions (not along the months). Show Values As should say Running Total In, base field Region.",
      "Google Sheets: its pivot tables are a different kind of object; it should show the cells as they were saved. Write down what it did.",
    ],
    build() {
      const s = fresh("Pivot settings", ["Orders", "Pivots"]);
      s.setValues("Orders", "A1", [["Month", "Region", "Item", "Qty", "Amount"]]);
      const data: [string, string, string, number, number][] = [
        ["2025-01", "North", "Pens", 12, 36], ["2025-01", "North", "Paper", 9, 45], ["2025-01", "South", "Pens", 7, 21], ["2025-01", "South", "Ink", 3, 36],
        ["2025-02", "North", "Ink", 4, 48], ["2025-02", "South", "Pens", 11, 33], ["2025-02", "South", "Paper", 6, 30], ["2025-02", "East", "Pens", 8, 24],
        ["2025-03", "East", "Paper", 10, 50], ["2025-03", "East", "Ink", 2, 24], ["2025-03", "North", "Pens", 15, 45], ["2025-03", "South", "Ink", 5, 60],
      ];
      data.forEach((row, i) => s.setValues("Orders", `A${i + 2}`, [row]));
      s.setStyle("Orders", "A1:E1", { bold: true, fill: "#dce6f2" });
      const base = { source: "Orders!A1:E13" };
      s.createPivot("Pivots", { ...base, name: "PerUnit", anchor: "A1", rows: ["Region"], values: [{ field: "Amount", fmt: "$#,##0" }, { field: "Price", name: "Amount per unit", fmt: "$0.00" }], calculated: [{ name: "Price", formula: "Amount / Qty" }] });
      s.createPivot("Pivots", { ...base, name: "Tabular", anchor: "A12", rows: [{ field: "Region", blankRow: true }, "Item"], values: [{ field: "Amount", fmt: "$#,##0" }], tabular: true, repeatLabels: true });
      s.createPivot("Pivots", { ...base, name: "OwnOrder", anchor: "H1", rows: [{ field: "Region", order: ["South", "East"] }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "AgainstFebruary", anchor: "H12", rows: ["Region"], columns: ["Month"], values: [{ field: "Amount", showAs: "differenceFrom", base: { field: "Month", item: "2025-02" }, fmt: "$#,##0;-$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "PercentOfNorth", anchor: "A32", rows: ["Region"], columns: ["Item"], values: [{ field: "Amount", showAs: "percentOf", base: { field: "Region", item: "North" } }] });
      s.createPivot("Pivots", { ...base, name: "RunningByRegion", anchor: "H24", rows: ["Region"], columns: ["Month"], values: [{ field: "Amount", showAs: "runningTotal", base: { field: "Region" }, fmt: "$#,##0" }] });
      readMe(s, "Pivot settings", this.see);
      return s;
    },
  },
  {
    file: "23-validation-more.xlsx",
    title: "Data validation: lists with several items in a cell, and a list read from another workbook",
    see: [
      "Excel should open this without a repair message. It may show a security bar saying links to other workbooks are disabled; that is the list in D2 reading Prices.xlsx, which is not part of the kit, and is expected: choose Don't Update.",
      "B2:B5 hold a list read from the Lists sheet (red, green, blue) that Pli allows several items in. Excel has no such setting, so it sees an ordinary list with an Information alert: pick Red from the arrow, then type 'Red, Green' in B3: Excel only informs (Continue keeps it). B3 already holds 'Red, Green', B4 holds 'Blue'. Data > Data Validation on B2 should say List, source =Lists!$A$1:$A$3, and show the alert style Information.",
      "D2:D5 hold a list read from another workbook: Data > Data Validation on D2 should say List with the source ='[Prices.xlsx]Sheet1'!$A$1:$A$3 (or [1]Sheet1!$A$1:$A$3), and the arrow should offer Pens, Paper, Ink, the copy Pli kept in the file, even though Prices.xlsx does not exist next to it. Data > Edit Links to Files lists Prices.xlsx.",
      "Save the file from Excel and run `pnpm excel-check:read`: it should still count 2 validations and the kit should report nothing to look at.",
    ],
    build() {
      const s = fresh("More validation", ["Several", "Lists"]);
      s.setValues("Lists", "A1", [["Red"], ["Green"], ["Blue"]]);
      s.setValues("Several", "A1", [["Several items in a cell", "", "Read from Prices.xlsx"]]);
      s.setStyle("Several", "A1:C1", { bold: true });
      s.setColumnWidth("Several", 2, 24);
      s.setColumnWidth("Several", 4, 16);
      s.addValidation("Several", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B5"], multiple: true, separator: ", " });
      s.setCells("Several", { B3: "'Red, Green", B4: "Blue" });
      s.addValidation("Several", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$3", ranges: ["D2:D5"], snapshot: { items: ["Pens", "Paper", "Ink"], read: "2025-12-09" } });
      readMe(s, "More validation", this.see);
      return s;
    },
  },
  {
    file: "27-pictures-effects.xlsx",
    title: "Pictures: glow, soft edges, reflection and artistic effects",
    see: [
      "Excel should open this without a repair message. This is the check the kit most needs: artistic effects are written as Excel's own a14 extension: the picture as the effect draws it, plus the original as an HD Photo (.wdp) file with the effect, which is the only form of original Excel takes (the first version of this file wrote the original as a PNG, and Excel kept only the drawn picture when it saved). If Excel offers to repair the file, say so and which sheet it names. The check that decides it: click Blur (B14), open Picture Format > Artistic Effects. Does it show Blur as the one picked (not None)? Does Format Picture > Picture > Artistic Effects show a Radius of 10? Then save the file into back/ and say whether the effect is still there.",
      "The Effects sheet has a coloured scene (a red disc and a yellow box on a blue and green ground), each 120 by 90 pixels, with its effect named above it. Glow (B3): a soft blue glow all round the picture. Click it: Picture Format > Picture Effects > Glow should show a glow and Format Picture > Effects should say Glow size about 7.5 pt and transparency 60%.",
      "Soft edges (E3): the edges fade out over about 10 pixels (7.5 pt); Picture Effects > Soft Edges should show it. Reflection (H3): a mirror image under the picture that fades away about half way down, with a small gap; Picture Effects > Reflection should show it, and Format Picture > Effects > Reflection should have transparency about 50% and size 50%.",
      "Glow, shadow and reflection together (K3): the three at once, so that the file's effect list (glow, shadow, reflection, soft edges, in that order) is all used.",
      "Artistic effects (row 14 on): Blur (B14), Pencil sketch (E14), Mosaic (H14), Cutout (K14), Glass (B20), Paint brush (E20), Photocopy (H20), Film grain (K20), Pencil grayscale (B26), Line drawing (E26), Glow edges (H26) and Glow diffused (K26). Each should show the effect (Excel draws the picture Pli wrote as the effect's result). Click one: Picture Format > Artistic Effects should show the effect picked, with the matching name where Excel has one; tell us which names it shows, and whether Reset Picture brings back the plain scene. Pli's Mosaic is a plain mosaic (Excel's is Mosaic Bubbles).",
      "Plain scene (B32): no effect, for comparison. JPEG with an effect (E32): a 1 by 1 JPEG with Blur, written like any picture with an effect (file 37 has real JPEG and GIF pictures with effects).",
      "LibreOffice, Google Sheets: glow, soft edges and reflection may not show; the picture, and for artistic effects the effect's own picture, should.",
    ],
    build() {
      const s = fresh("Picture effects", ["Effects"]);
      const w = 120;
      const h = 90;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let c = [60 + (x * 140) / w, 120 + (y * 100) / h, 200 - (x * 80) / w];
          if ((x - 42) ** 2 + (y - 40) ** 2 < 600) c = [230, 80, 60];
          if (x > 66 && x < 106 && y > 36 && y < 72) c = [250, 230, 90];
          if (y > 78) c = [70, 130, 70];
          data.set([...c, 255], (y * w + x) * 4);
        }
      }
      const scene = toDataUri(encodePng({ width: w, height: h, data }), "png");
      const label = (at: string, text: string) => s.setValues("Effects", at, [[text]]);
      const place = (row: number, col: number, extra: object, alt: string) => s.addImage("Effects", { src: scene, from: { row, col }, width: 120, height: 90, alt, ...extra });
      label("B2", "Glow"); label("E2", "Soft edges"); label("H2", "Reflection"); label("K2", "Glow, shadow, reflection");
      place(3, 2, { glow: { color: "#2e75b6", radius: 10, opacity: 0.4 } }, "Glow");
      place(3, 5, { softEdge: 10 }, "Soft edges");
      place(3, 8, { reflection: { startOpacity: 0.5, endOpacity: 0, size: 0.5, distance: 4, blur: 0.5 } }, "Reflection");
      place(3, 11, { glow: { color: "#ed7d31", radius: 8 }, shadow: { distance: 6 }, reflection: {} }, "Glow, shadow and reflection");
      const rows: [number, number, string, string, object][] = [
        [14, 2, "Blur", "blur", { kind: "blur", level: 10 }],
        [14, 5, "Pencil sketch", "pencilSketch", { kind: "pencilSketch", level: 25 }],
        [14, 8, "Mosaic", "mosaic", { kind: "mosaic", level: 50 }],
        [14, 11, "Cutout", "cutout", { kind: "cutout", level: 3 }],
        [20, 2, "Glass", "glass", { kind: "glass", level: 25 }],
        [20, 5, "Paint brush", "paintBrush", { kind: "paintBrush", level: 5 }],
        [20, 8, "Photocopy", "photocopy", { kind: "photocopy", level: 50 }],
        [20, 11, "Film grain", "filmGrain", { kind: "filmGrain", level: 50 }],
        [26, 2, "Pencil grayscale", "pencilGrayscale", { kind: "pencilGrayscale", level: 10 }],
        [26, 5, "Line drawing", "lineDrawing", { kind: "lineDrawing", level: 5 }],
        [26, 8, "Glow edges", "glowEdges", { kind: "glowEdges", level: 5 }],
        [26, 11, "Glow diffused", "glowDiffused", { kind: "glowDiffused", level: 5 }],
      ];
      for (const [row, col, name, , artistic] of rows) {
        s.setValues("Effects", `${String.fromCharCode(64 + col)}${row - 1}`, [[name]]);
        place(row, col, { artistic }, name);
      }
      label("B31", "Plain scene"); label("E31", "JPEG with an effect");
      place(32, 2, {}, "Plain scene");
      s.addImage("Effects", { src: JPEG_1X1, from: { row: 32, col: 5 }, width: 120, height: 90, artistic: { kind: "blur" }, alt: "A JPEG with an effect" });
      s.setColumnWidth("Effects", 1, 3);
      readMe(s, "Picture effects", this.see);
      return s;
    },
  },
  {
    file: "26-notes-more.xlsx",
    title: "Notes with a look, an author and a box",
    see: [
      "Notes sheet, B2 (author Ana): the note shows 'Ana:' in bold on its first line, then 'Check the total now' where 'total' is bold, italic, red and bigger. Hover B2 to see it; Review > Edit Note shows the same formatting.",
      "Notes sheet, B4: a note kept showing (Review > Show/Hide Note is on) in a box that is wider and taller than usual, placed to the right of the cell, with the usual line to its corner.",
      "Notes sheet, B6: a plain note with no author line (its author slot holds 'Pli', which Excel needs; Pli shows no author for it). B8 is hidden until you hover it, and its box is the usual size.",
      "Review > Show All Notes shows all four boxes; Hide All Notes hides them again. Drag a box or resize it, save, and open the file in Pli: it keeps where you put it.",
      "Excel must open the file WITHOUT a repair prompt.",
    ],
    build() {
      const s = new SheetSession(createWorkbook("Notes more", ["Read me", "Notes"]), { now: NOW, author: "Ana" });
      s.setValues("Notes", "A1", [["Notes with a look, an author and a box"], [null]]);
      s.setValues("Notes", "A2", [["Rich note, by Ana"], [null], ["Kept showing, bigger box"], [null], ["No author"], [null], ["Usual box"]]);
      s.setNote("Notes", "B2", "Check the total now", { runs: [{ text: "Check the " }, { text: "total", bold: true, italic: true, color: "#c00000", size: 12 }, { text: " now" }] });
      s.setNote("Notes", "B4", "A note that stays on the sheet, in a bigger box\nwith two lines", { box: { width: 260, height: 110, dx: 40, dy: 5, show: true } });
      s.setNote("Notes", "B6", "No author on this one", { author: null });
      s.setNote("Notes", "B8", "Shows when you point at B8");
      s.setColumnWidth("Notes", 1, 28);
      s.setColumnWidth("Notes", 2, 14);
      readMe(s, "Notes with a look, an author and a box", this.see);
      return s;
    },
  },
  {
    file: "22-formatting-more.xlsx",
    title: "Formatting, the rest: merged ranges moved and filled, data bar settings, and rules that follow a pivot table",
    see: [
      "Excel should open this without a repair message.",
      "Merges (sheet Merges): A1:B1 holds Title and was moved to D1:E1 (so C1:E1's old place is plain), A3:B4 was copied to D3:E4 and A6:B6 was filled down into A7:B7, A8:B8 and A9:B9. Each of those should show as one merged cell with the text in it.",
      "Bars (sheet Bars): column A has an automatic start and end, so the smallest bar of 10, 20, 30 and 40 is a quarter of the cell and not empty; column B has negative numbers with a red bar, a dark red outline for the negative ones and a blue outline for the positive ones, and the zero line where zero falls; column C has bars that grow from the right. Open Conditional Formatting > Manage Rules on each: Minimum and Maximum in A should say Automatic, and C's bar direction should say Right-to-left.",
      "Pivot rules (sheet Pivot): the Sales column of the pivot table has a data bar and the Qty column a red fill for numbers over 10. Click a cell in each column and open Conditional Formatting > Manage Rules, with the scope set to this PivotTable: the rules should say they apply to all cells showing Sum of Qty / Sum of Sales values. Change the pivot table (drag Product into the rows or refresh it): the bars and the fill should follow the numbers. Write down what Excel did with the pivot table's conditional formats; they are the part not yet seen in Excel.",
      "Borders (sheet Merges): the cells A12:C13 have lines in different colours; they were given one colour (dark blue) with the Border color button, keeping their different styles (thin, thick, dashed).",
    ],
    build() {
      const s = fresh("Formatting, the rest", ["Merges", "Bars", "Orders", "Pivot"]);
      s.setValues("Merges", "A1", [["Title"]]);
      s.setValues("Merges", "A3", [["Block", "gone"], ["more", ""]]);
      s.setValues("Merges", "A6", [["Row", ""]]);
      s.mergeCells("Merges", "A1:B1", { center: true });
      s.mergeCells("Merges", "A3:B4");
      s.mergeCells("Merges", "A6:B6");
      s.move({ sheet: "Merges", range: "A1:B1" }, { sheet: "Merges", at: "D1" });
      s.copy({ sheet: "Merges", range: "A3:B4" }, { sheet: "Merges", at: "D3" });
      s.autofill("Merges", "A6:B6", "A6:B9");
      s.setValues("Merges", "A12", [["a", "b", "c"], ["d", "e", "f"]]);
      s.setBorders("Merges", "A12:C13", "all", { style: "thin", color: "#cc0000" });
      s.setBorders("Merges", "B12:B13", "all", { style: "thick", color: "#00aa00" });
      s.setBorders("Merges", "C12", "all", { style: "dashed", color: "#aa00aa" });
      s.colorBorders("Merges", "A12:C13", "#1f3a68");
      s.setValues("Bars", "A1", [["Automatic", "Negatives", "From the right"], [10, 5, 10], [20, -3, 20], [30, 12, 30], [40, -8, 40]]);
      s.setStyle("Bars", "A1:C1", { bold: true });
      for (const c of ["A", "B", "C"]) s.setColumnWidth("Bars", c.charCodeAt(0) - 64, 18);
      s.addRule("Bars", { kind: "dataBar", ranges: ["A2:A5"], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6" });
      s.addRule("Bars", { kind: "dataBar", ranges: ["B2:B5"], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", negativeColor: "#ff0000", border: true, borderColor: "#1f3a68", negativeBorderColor: "#7a0000" });
      s.addRule("Bars", { kind: "dataBar", ranges: ["C2:C5"], min: { type: "min" }, max: { type: "max" }, color: "#63be7b", rtl: true });
      s.setValues("Orders", "A1", [["Region", "Product", "Qty", "Sales"], ["East", "Apple", 10, 100], ["East", "Pear", 5, 40], ["West", "Apple", 7, 70], ["West", "Pear", 3, 33], ["North", "Plum", 14, 44]]);
      const p = s.createPivot("Pivot", { source: "Orders!A1:D6", anchor: "A1", rows: ["Region"], values: ["Qty", "Sales"] });
      s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["10"], ranges: [], style: { fill: "#ffc7ce", color: "#9c0006" }, pivot: { id: p.id, value: 0 } });
      s.addRule("Pivot", { kind: "dataBar", ranges: [], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", pivot: { id: p.id, value: 1 } });
      readMe(s, "Formatting, the rest", this.see);
      return s;
    },
  },
  {
    file: "24-tables-more.xlsx",
    title: "Tables: dates picked from the year, month and day tree, a timeline, and lines between the cells of a style of your own",
    see: [
      "Excel should open this without a repair message. On the Orders sheet, the table 'Orders' has a filter on the Date column that picks January 2023 and the 15th of March 2023: only the rows dated in those show (rows for the other dates are hidden).",
      "Click the filter button on Date: the list should be the tree (2022, 2023 with their months and days), with 2023 and its January and March ticked as partly or fully chosen: January ticked in full, March with only the 15th ticked, February and the other months not. If Excel shows a flat list of dates, write down what it showed.",
      "The Orders table is in the 'Grid' style of your own: a thick dark blue line round the table, thin blue lines between the rows and thin dashed lines between the columns, a dark blue header with white text. Table Design > Table Styles > Custom should list 'Grid'. If Excel draws the inner lines differently from the sample, say how.",
      "The Banded sheet has a table in a second style of your own, 'Bands', with stripes two rows wide that have a thin line round each stripe, and a thick line under the header.",
      "A timeline over the Date column sits beside the table in Pli (a strip of months with a range picked). Excel has no timelines for tables, so it does not show one: that is expected. Check that nothing is reported missing or repaired because of it, and that the filter above is still in force.",
      "A workbook that was saved from Excel again should still have the date filter and the 'Grid' style (the kit's report counts them).",
    ],
    build() {
      const s = fresh("Tables more", ["Orders", "Banded"]);
      const day = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
      s.setValues("Orders", "A1", [
        ["Order", "Date", "Qty"],
        ["a", day(2022, 11, 20), 1],
        ["b", day(2023, 1, 5), 2],
        ["c", day(2023, 1, 31), 3],
        ["d", day(2023, 2, 14), 4],
        ["e", day(2023, 3, 15), 5],
        ["f", day(2023, 3, 16), 6],
        ["g", day(2023, 6, 30), 7],
      ]);
      s.setFormat("Orders", "B2:B8", "yyyy-mm-dd");
      s.createTable("Orders", "A1:C8", { name: "Orders" });
      const blue = { style: "thin" as const, color: "#4472c4" };
      s.setTableStyle("Grid", {
        wholeTable: { border: { top: { style: "thick", color: "#1f3a5f" }, bottom: { style: "thick", color: "#1f3a5f" }, left: { style: "thick", color: "#1f3a5f" }, right: { style: "thick", color: "#1f3a5f" }, horizontal: blue, vertical: { style: "dashed", color: "#4472c4" } } },
        headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff" },
      });
      s.setTableOptions("Orders", { style: "Grid" });
      s.filterTableRule("Orders", "Date", { kind: "dateGroups", groups: [{ by: "month", year: 2023, month: 1 }, { by: "day", year: 2023, month: 3, day: 15 }] });
      s.addTimeline("Orders", { table: "Orders", column: "Date", level: "months", from: { row: 1, col: 5 } });
      s.timelineSelect(s.timelines("Orders")[0]!.id, { start: day(2023, 1, 1), end: day(2023, 3, 31) });
      s.setValues("Banded", "A1", [["Name", "Qty"], ["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]]);
      s.createTable("Banded", "A1:B6", { name: "Banded" });
      const line = { style: "thin" as const, color: "#7f7f7f" };
      s.setTableStyle("Bands", {
        headerRow: { bold: true, border: { bottom: { style: "thick", color: "#7f7f7f" } } },
        firstRowStripe: { fill: "#eef3fa", border: { top: line, bottom: line, left: line, right: line, horizontal: line } },
        rowStripeSize: 2,
      });
      s.setTableOptions("Banded", { style: "Bands" });
      readMe(s, "Tables more", this.see);
      return s;
    },
  },
  {
    file: "29-printing-more.xlsx",
    title: "Printing, the rest: text running on, notes, errors, black and white, draft quality, pictures in the header and footer",
    see: [
      "Excel should open this without a repair message. File > Print (the preview) of each sheet is what to look at. Page Layout > Page Setup (the small arrow) > Sheet tab holds the settings named below.",
      "Overflow: A1 holds a long sentence with empty cells to its right, and A3 a longer one in the last column used (F3), with nothing to its right. On paper the sentence in A1 should run on over B1 to D1 in full and stop at the 'stop' in E1. F3 is the question: does Excel print all of its text past column F (as Pli does: it prints through column L, so the sheet is 2 pages wide) or cut it off at the edge of column F (1 page)? Write down which and the page count. D5 is right-aligned: its text should run to the left over B5:C5 and stop at A5.",
      "Notes: three notes (A2, C5, B9). Page Setup > Sheet > Comments says 'At end of sheet'. The preview should have a last page listing them by cell. Write down how Excel words it (Pli prints 'Cell A2: text'). Pli's layout is one page of cells and one of notes.",
      "Notes shown: on the NotesShown sheet Comments is 'As displayed on sheet'. Excel prints only the notes that are showing (right-click a cell > Show/Hide Note): none are showing in this file, so none should print (Pli agrees: its preview has one page and no boxes). Show one in Excel and see where it prints; file 40 has notes that are showing.",
      "Errors: the Errors sheet has =1/0 in B2 and =NA() in B3, printed with 'Cell errors as: --'. On paper B2 and B3 should both say '--' (the screen still shows #DIV/0! and #N/A).",
      "Colours: the Colours sheet has coloured fills and text, with 'Black and white' ticked in Page Setup > Sheet. The preview should be black on white: no fills, no coloured text, and the borders black.",
      "Draft: the Draft sheet has gridlines ticked and a picture, with 'Draft quality' ticked. The preview should show no gridlines and no picture (Excel's draft quality leaves graphics out on printers that support it, so write down what the preview shows).",
      "Logos: the Logos sheet has a green box picture at the left of the header, a blue one in the middle of the footer and a red one in the right of the first page's header ('Different first page'). Page Setup > Header/Footer > Custom Header shows &[Picture] in those places. Right-click the picture's button > Format Picture shows its size: 80 by 40 points for the green one.",
    ],
    build() {
      const s = fresh("Printing more", ["Overflow", "Notes", "NotesShown", "Errors", "Colours", "Draft", "Logos"]);
      s.setValues("Overflow", "A1", [["A long sentence that is much wider than its own cell and runs on", null, null, null, "stop"]]);
      s.setValues("Overflow", "A3", [[null, null, null, null, null, "A longer sentence in the last column used, with nothing to its right at all"]]);
      s.setValues("Overflow", "D5", [["Right-aligned text that runs to the left"]]);
      s.setValues("Overflow", "A5", [["x"]]);
      s.setStyle("Overflow", "D5", { align: "right" });
      for (const [name, mode] of [["Notes", "end"], ["NotesShown", "sheet"]] as const) {
        s.setValues(name, "A1", [["Item", "Qty", "Price"], ["Pens", 12, 3], ["Paper", 4, 5], ["Ink", 9, 7], ["Tape", 2, 1], ["Glue", 8, 2]]);
        s.setNote(name, "A2", "Check the supplier for the pens.");
        s.setNote(name, "C5", "Price went up in March.\nAsk for a discount.");
        s.setNote(name, "B9", "Last row to count.");
        s.setValues(name, "A9", [["End", 1]]);
        s.setPageSetup(name, { comments: mode });
      }
      s.setValues("Errors", "A1", [["Cell errors print as --"], ["Divide", "=1/0"], ["Missing", "=NA()"], ["Fine", 42]]);
      s.setPageSetup("Errors", { errors: "dash" });
      s.setValues("Colours", "A1", [["Revenue", "Cost", "Margin"], [120, 80, 40], [200, 150, 50]]);
      s.setStyle("Colours", "A1:C1", { bold: true, fill: "#1f4e79", color: "#ffffff" });
      s.setStyle("Colours", "A2:C2", { fill: "#ffe699", color: "#c00000", border: { bottom: { style: "thin", color: "#0000ff" } } });
      s.setStyle("Colours", "A3:C3", { fill: "#c6e0b4", color: "#375623" });
      s.setPageSetup("Colours", { blackAndWhite: true });
      s.setValues("Draft", "A1", [["Draft quality", "no gridlines, no picture"], [1, 2], [3, 4]]);
      s.addImage("Draft", { src: pngUri(80, 40, [200, 40, 40]), from: { row: 5, col: 2 }, width: 80, height: 40, alt: "A red box" });
      s.setPageSetup("Draft", { gridlines: true, draft: true });
      s.setValues("Logos", "A1", Array.from({ length: 90 }, (_, r) => [`Row ${r + 1}`, r + 1]));
      s.setHeaderFooterPicture("Logos", "header", "left", headerPictureFrom(pngUri(80, 40, [30, 150, 60]), { width: 80, height: 40 }));
      s.setHeaderFooterPicture("Logos", "footer", "center", headerPictureFrom(pngUri(60, 30, [30, 60, 150]), { width: 60, height: 30 }));
      s.setHeaderFooterPicture("Logos", "firstHeader", "right", headerPictureFrom(pngUri(60, 30, [200, 40, 40]), { width: 60, height: 30 }));
      s.setPageSetup("Logos", { header: { center: "Quarterly report" }, footer: { right: "Page &P of &N" } });
      readMe(s, "Printing more", this.see);
      return s;
    },
  },
  {
    file: "28-protection-more.xlsx",
    title: "Protection, the rest: ranges people may edit with their own passwords, locks that columns and rows carry, and roles",
    see: [
      "The Budget sheet is protected (password pli). Column C (Total) and row 8 (Notes) were unlocked as a whole: click the C column heading, then Format > Cells > Protection (Ctrl+1 / Cmd+1): Locked should be unticked. Typing in C20, far below the data, must be allowed without a message; typing in D20 or A1 gives Excel's protected-sheet message.",
      "Row 8: Format Cells > Protection on the row heading shows Locked unticked, and typing in E8 is allowed. Typing in B1 (a locked cell above it) is refused.",
      "Review > Allow Edit Ranges (Windows) / Review > Protect > Allow Users to Edit Ranges (Mac, if it is there) lists two ranges: Quantities (B2:B4, password ed) and Open (E2:E4, no password). Typing in B2 asks for the password: type ed and the edit goes through. Typing in E2 needs no password. (This list is shown after unprotecting the sheet with pli, as Excel only lets you change it then.)",
      "A third range, Finance (D2:D4), is one Pli limits to the role finance. Excel has no such thing (its own permissions are Windows accounts), so Pli does not write it as an edit range: D2:D4 must be locked in Excel, with no range listed for it. If Excel lists Finance, tell me: that is a bug.",
      "Excel should open the file without a repair message. The roles are kept in a Pli extension that Excel ignores; saving the file again in Excel drops them (the file still opens in Pli, with the other ranges and the locks).",
      "Google Sheets: protected ranges are a different object there; write down what it did with the Budget sheet.",
    ],
    build() {
      const s = fresh("Protection, the rest", ["Budget"]);
      s.setValues("Budget", "A1", [["Item", "Qty", "Price", "Role only", "Open", "Total"], ["Pens", 10, 3, 1, 1, null], ["Paper", 4, 5, 2, 2, null], ["Ink", 2, 20, 3, 3, null]]);
      for (const r of [2, 3, 4]) s.setCell("Budget", `F${r}`, `=B${r}*C${r}`);
      s.setCell("Budget", "A8", "Notes");
      s.setCell("Budget", "B8", "anyone may write in this row");
      s.setStyle("Budget", "A1:F1", { bold: true });
      s.setColumnWidth("Budget", 1, 14);
      // Column C is unlocked as a whole, as is row 8, so cells made in them later are too.
      s.setLocked("Budget", "C:C", false);
      s.setLocked("Budget", "8:8", false);
      s.addEditRange("Budget", { name: "Quantities", ranges: ["B2:B4"], password: "ed" });
      s.addEditRange("Budget", { name: "Open", ranges: ["E2:E4"] });
      s.addEditRange("Budget", { name: "Finance", ranges: ["D2:D4"], permissions: ["finance"] });
      readMe(s, "Protection, the rest", this.see);
      s.protectSheet("Budget", { password: "pli", allow: ["selectLockedCells", "selectUnlockedCells"], roles: { sort: ["analyst"] }, editLocked: ["owner"] });
      return s;
    },
  },
  {
    file: "30-subtotals-sparklines-more.xlsx",
    title: "Subtotal rows, sparklines on a date axis and in theme colours",
    see: [
      "Subtotals sheet: a sales list with rows of SUBTOTAL formulas, made the way Data > Subtotal makes them. Each Product inside a Region has a bold row under it (column B says 'Ink Average', 'Pens Average'… for rows 4, 7, 10, 13, 16 and 18) and each Region a bold 'North Total' row (row 8; 'South Total' is row 14 and 'West Total' row 19) under all its rows, with 'Grand Total' at the bottom (row 20). That is a nested subtotal: Region totals as the outer level, Product averages as the inner. Buttons 1 2 3 are at the top left of the grid.",
      "Click button 1: only the Region totals and the Grand Total show. Button 2: the Product averages show too. Button 3: everything. The Region totals are the same in every view, and the Grand Total is the sum of the Region totals: the nested Average rows are not counted twice (SUBTOTAL leaves out other SUBTOTALs).",
      "In row 1, G1 is SUBTOTAL(9, …) and H1 is SUBTOTAL(109, …) over the whole list. With everything open both are 57. Click button 1 or 2: G1 stays 57 and H1 must become 0 (the rows still showing are all subtotal rows, which SUBTOTAL leaves out). Write down what Excel showed.",
      "Data > Subtotal… on a cell of the list opens Excel's own dialog: 'Replace current subtotals' ticked is the usual; Remove All takes the rows and the outline away. Nothing is lost in the file: the rows are ordinary rows.",
      "Above sheet: the same list with the subtotal rows ABOVE their rows ('Summary rows below detail' is off in the outline's settings), the grand total directly under the headings, and a page break after each region (View > Page Break Preview).",
      "Dated sheet: the 'Line', 'Columns' and 'Win/loss' columns (J, K, L) have sparklines placed by date, not evenly: the dates in row 1 are five days of 1 to 12 January, then 29 March and 8 April. So the line crosses a long gap between the fifth and sixth point (the first five points sit bunched at the left, the last two at the right) and the bars sit together, then apart. Click a sparkline: Sparkline tab > Axis > 'Date Axis Type' is ticked, and choosing it asks for the date range, B1:I1.",
      "Themed sheet: the sparklines' colours are theme colours. Line (J2:J4): the line is 'Blue, Accent 1, Darker 50%', the markers 'Blue, Accent 1, Darker 25%', the high point 'Orange, Accent 2' and the low point 'Green, Accent 6, Darker 25%'. Columns (K2:K4): the bars are 'Blue, Accent 1' and the negative bars 'Green, Accent 6'. Click one: Sparkline tab > Sparkline Color (or Marker Color) shows those chosen in the theme palette, not as custom colours. Change the workbook's theme (Page Layout > Colors) and the sparklines should follow it.",
    ],
    build() {
      const s = fresh("Subtotals and more sparklines", ["Subtotals", "Above", "Dated", "Themed"]);
      const list = [
        ["Region", "Product", "Qty", "Amount"],
        ["North", "Ink", 4, 40],
        ["North", "Ink", 6, 66],
        ["North", "Pens", 10, 25],
        ["North", "Pens", 12, 31],
        ["South", "Ink", 3, 33],
        ["South", "Paper", 8, 16],
        ["South", "Paper", 5, 11],
        ["West", "Ink", 7, 70],
        ["West", "Pens", 2, 5],
      ];
      for (const name of ["Subtotals", "Above"]) {
        s.setValues(name, "A1", list);
        s.setFormat(name, "D2:D12", "$#,##0.00");
        s.setStyle(name, "A1:D1", { bold: true, fill: "#dce6f2" });
        s.setColumnWidth(name, 1, 16);
        s.setColumnWidth(name, 2, 16);
      }
      s.subtotal("Subtotals", "A1:D10", { by: "Region", columns: ["Qty", "Amount"] });
      s.subtotal("Subtotals", "A1:D14", { by: "Product", columns: ["Qty", "Amount"], fn: "average", replace: false });
      s.setCell("Subtotals", "F1", "9 and 109:");
      s.setCell("Subtotals", "G1", "=SUBTOTAL(9,C2:C30)");
      s.setCell("Subtotals", "H1", "=SUBTOTAL(109,C2:C30)");
      s.subtotal("Above", "A1:D10", { by: "Region", columns: ["Qty", "Amount"], summaryBelow: false, pageBreaks: true });

      const dates = [45292, 45293, 45296, 45300, 45303, 45380, 45390, 45400];
      s.setValues("Dated", "A1", [["Product", ...dates, "Line", "Columns", "Win/loss"]]);
      s.setFormat("Dated", "B1:I1", "d mmm");
      const data = [
        [5, 7, 6, 9, 12, 11, 14, 15],
        [10, 8, 9, 4, 3, 5, 2, 1],
        [-2, 3, -1, 4, -3, 2, 5, -4],
      ];
      data.forEach((values, i) => s.setValues("Dated", `A${i + 2}`, [[`Product ${i + 1}`, ...values]]));
      s.setStyle("Dated", "A1:L1", { bold: true, fill: "#dce6f2" });
      for (let r = 2; r <= 4; r++) s.setRowHeight("Dated", r, 28);
      for (const c of [10, 11, 12]) s.setColumnWidth("Dated", c, 16);
      s.addSparklines("Dated", { type: "line", location: "J2:J4", data: "B2:I4", dateAxis: "B1:I1", markers: true, high: true, highColor: "#00aa00" });
      s.addSparklines("Dated", { type: "column", location: "K2:K4", data: "B2:I4", dateAxis: "B1:I1", negative: true });
      s.addSparklines("Dated", { type: "winloss", location: "L2:L4", data: "B2:I4", dateAxis: "B1:I1" });

      s.setValues("Themed", "A1", [["Product", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Line", "Columns"]]);
      data.forEach((values, i) => s.setValues("Themed", `A${i + 2}`, [[`Product ${i + 1}`, ...values]]));
      s.setStyle("Themed", "A1:K1", { bold: true, fill: "#dce6f2" });
      for (let r = 2; r <= 4; r++) s.setRowHeight("Themed", r, 28);
      s.setColumnWidth("Themed", 10, 16);
      s.setColumnWidth("Themed", 11, 16);
      s.addSparklines("Themed", { type: "line", location: "J2:J4", data: "B2:I4", color: { theme: 4, tint: -0.5 }, high: true, highColor: { theme: 5 }, low: true, lowColor: { theme: 9, tint: -0.25 }, markers: true, markerColor: { theme: 4, tint: -0.25 } });
      s.addSparklines("Themed", { type: "column", location: "K2:K4", data: "B2:I4", color: { theme: 4 }, negative: true, negativeColor: { theme: 9 } });
      readMe(s, "Subtotals and more sparklines", this.see);
      return s;
    },
  },
  {
    file: "21-charts-more.xlsx",
    title: "Charts: combined kinds, second axes, trendlines, and the rest of Excel's kinds",
    see: [
      "Excel should open this without a repair message and show 22 charts on the Charts sheet, in four columns. A chart that is missing, or any message about unreadable content, is the finding: say which chart.",
      "First row of charts: 'Sales and margin' is columns for sales with a line for the margin on a second axis at the right (Chart Design > Change Chart Type > Combo should say Clustered Column - Line on Secondary Axis); 'Stacked and a line' is stacked columns with a plain line on a second axis; 'Trendlines on pairs' is a scatter chart with a linear trendline that shows its equation and R squared and runs 2 past the last x, a 3rd-order polynomial called Cubic and a 2-period moving average (right-click a trendline > Format Trendline); 'Curves' has an exponential (with its equation), a logarithmic and a power trendline on a line chart.",
      "Second row: a doughnut with a 60% hole and two rings; a radar chart; a filled radar chart; a bubble chart where the biggest bubble belongs to the biggest units.",
      "Third row: an open-high-low-close stock chart (white bodies on up days, dark on down days); a volume-open-high-low-close chart with volume columns on the left axis and prices on the right; a surface chart in coloured bands; a pie of pie whose second pie holds the last two points.",
      "Fourth row: a bar of pie; a waterfall chart whose first and last bars are totals standing on the axis (Format Data Point > Set as total should be ticked on those two); a histogram with 5-wide bins; a Pareto chart (columns sorted from the biggest, with a line of cumulative percentage on a right axis in percent).",
      "Fifth row: a funnel chart; a box-and-whisker chart of revenue by region with mean markers and one outlier (North's 45); a treemap of revenue by region and product; a sunburst of the same two levels.",
      "Sixth row: a scatter chart with smooth lines and no markers; a chart of columns and areas with the second category axis shown along the top. The last two slots are empty.",
      "Excel 2016's own kinds (waterfall, histogram, Pareto, funnel, box and whisker, treemap, sunburst) are written in a part that no other program here can check; if one is missing or blank, or Excel offers to repair the file, copy the message into the notes.",
      "On 'Trendlines on pairs' the linear trendline's equation should have the slope that =SLOPE(Data!D2:D7,Data!B2:B7) gives in a spare cell, and the R squared =RSQ(Data!D2:D7,Data!B2:B7).",
      "Google Sheets: write down which charts it shows (it is not expected to draw the surface chart or the Excel 2016 kinds).",
    ],
    build() {
      const s = fresh("More charts", ["Data", "Charts"]);
      s.setValues("Data", "A1", [["Quarter", "Sales", "Margin", "Units"], ["Q1", 120, 0.21, 40], ["Q2", 150, 0.25, 55], ["Q3", 135, 0.22, 48], ["Q4", 190, 0.3, 72], ["Q5", 210, 0.28, 80], ["Q6", 240, 0.33, 96]]);
      s.setValues("Data", "F1", [["Day", "Open", "High", "Low", "Close", "Volume"], ["Mon", 10, 14, 9, 12, 300], ["Tue", 12, 16, 11, 11, 450], ["Wed", 11, 15, 10, 14, 380], ["Thu", 14, 18, 13, 17, 520], ["Fri", 17, 19, 15, 16, 410]]);
      s.setValues("Data", "M1", [["Step", "Amount"], ["Start", 100], ["Sales", 40], ["Costs", -30], ["Refunds", -10], ["End", 100]]);
      s.setValues("Data", "P1", [["Score"], [1], [2], [2], [3], [3], [3], [4], [4], [5], [9], [6], [7], [7], [8], [11], [12], [13], [14], [14], [15]]);
      s.setValues("Data", "R1", [["Region", "Product", "Revenue"], ["North", "Pens", 12], ["", "Ink", 7], ["", "Paper", 9], ["South", "Pens", 15], ["", "Ink", 4], ["", "Paper", 6], ["East", "Pens", 8], ["", "Ink", 40]]);
      s.setValues("Data", "X1", [["Region", "Revenue"], ["North", 12], ["North", 7], ["North", 9], ["South", 15], ["South", 4], ["South", 6], ["East", 8], ["East", 13], ["East", 9], ["South", 10], ["North", 11], ["North", 45]]);
      s.setValues("Data", "V1", [["Defect", "Count"], ["Scratch", 42], ["Dent", 18], ["Crack", 9], ["Stain", 27], ["Other", 4]]);
      const D = (c: string, a: number, b: number) => `Data!$${c}$${a}:$${c}$${b}`;
      const ser = (c: string, extra: object = {}) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 7), ...extra });
      const q = D("A", 2, 7);
      const at = (slot: number) => ({ row: 1 + Math.floor(slot / 4) * 15, col: 1 + (slot % 4) * 8 });
      const add = (slot: number, spec: Parameters<SheetSession["addChart"]>[1]) => s.addChart("Charts", { width: 440, height: 260, from: at(slot), ...spec });
      add(0, { type: "column", title: "Sales and margin", categories: q, yTitle: "Sales", y2Title: "Margin", series: [ser("B"), ser("C", { type: "line", axis: "secondary" })] });
      add(1, { type: "column", title: "Stacked and a line", grouping: "stacked", categories: q, series: [ser("B"), ser("D"), ser("C", { type: "line", axis: "secondary" })] });
      add(2, { type: "scatter", title: "Trendlines on pairs", xTitle: "Sales", yTitle: "Units", series: [{ name: "Units", x: D("B", 2, 7), values: D("D", 2, 7), trendlines: [{ type: "linear", equation: true, rSquared: true, forward: 2 }, { type: "polynomial", order: 3, name: "Cubic" }, { type: "movingAverage", period: 2 }] }] });
      add(3, { type: "line", title: "Curves", categories: q, series: [ser("B", { trendlines: [{ type: "exponential", equation: true }, { type: "logarithmic" }, { type: "power" }] })] });
      add(4, { type: "doughnut", title: "Doughnut", holeSize: 60, labels: true, categories: q, series: [ser("B"), ser("D")] });
      add(5, { type: "radar", title: "Radar", categories: q, series: [ser("B"), ser("D")] });
      add(6, { type: "radar", title: "Filled radar", filled: true, categories: q, series: [ser("B"), ser("D")] });
      add(7, { type: "bubble", title: "Bubbles", series: [{ name: "Quarters", x: D("B", 2, 7), values: D("C", 2, 7), size: D("D", 2, 7), color: "#4472c4" }] });
      add(8, { type: "stock", title: "Open-high-low-close", stock: "ohlc", categories: D("F", 2, 6), series: ["G", "H", "I", "J"].map((c) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 6) })) });
      add(9, { type: "stock", title: "With volume", stock: "vohlc", y2Title: "Price", categories: D("F", 2, 6), series: ["K", "G", "H", "I", "J"].map((c) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 6) })) });
      add(10, { type: "surface", title: "Surface", view3d: { rotX: 20, rotY: 30 }, categories: q, series: [ser("B"), ser("C"), ser("D")] });
      add(11, { type: "pieOfPie", title: "Pie of pie", labels: true, split: { by: "position", at: 2 }, categories: q, series: [ser("B")] });
      add(12, { type: "barOfPie", title: "Bar of pie", labels: true, split: { by: "position", at: 2 }, categories: q, series: [ser("B")] });
      add(13, { type: "waterfall", title: "Waterfall", totals: [0, 4], labels: true, categories: D("M", 2, 6), series: [{ nameRef: "Data!$N$1", values: D("N", 2, 6) }] });
      add(14, { type: "histogram", title: "Histogram", bins: { by: "width", size: 5 }, series: [{ nameRef: "Data!$P$1", values: D("P", 2, 21) }] });
      add(15, { type: "pareto", title: "Pareto", categories: D("V", 2, 6), series: [{ nameRef: "Data!$W$1", values: D("W", 2, 6) }] });
      add(16, { type: "funnel", title: "Funnel", labels: true, categories: D("V", 2, 6), series: [{ nameRef: "Data!$W$1", values: D("W", 2, 6) }] });
      add(17, { type: "boxWhisker", title: "Revenue by region", categories: D("X", 2, 13), box: { quartile: "inclusive" }, series: [{ nameRef: "Data!$Y$1", values: D("Y", 2, 13), color: "#4472c4" }] });
      add(18, { type: "treemap", title: "Treemap", categories: "Data!$R$2:$S$9", series: [{ nameRef: "Data!$T$1", values: D("T", 2, 9) }] });
      add(19, { type: "sunburst", title: "Sunburst", categories: "Data!$R$2:$S$9", series: [{ nameRef: "Data!$T$1", values: D("T", 2, 9) }] });
      add(20, { type: "scatter", title: "Smooth, no markers", smooth: true, markers: false, series: [{ name: "Units", x: D("B", 2, 7), values: D("D", 2, 7), color: "#ed7d31" }] });
      add(21, { type: "area", title: "Areas and columns", secondaryCategoryAxis: true, x2Title: "Again", categories: q, series: [ser("D", { type: "column" }), ser("B", { axis: "secondary" })] });
      readMe(s, "More charts", this.see);
      return s;
    },
  },
  {
    file: "25-pivot-more-2.xlsx",
    title: "Pivot tables, the rest: calculated items, groups, times, several ranges, styles, slicers and timelines",
    see: [
      "All the pivot tables refresh when the file opens (the file says to), so look for numbers that agree with the Orders sheet and for the headings below. A message about repairing the file is the first thing to write down (and which sheet it names).",
      "Pivots sheet. CalcItem (A1): Region down the side with a fifth item, Coasts, that is East plus West (Orders: East 160, West 175 as Amount, so Coasts 335). The grand total counts Coasts too, as Excel's do. Click Coasts: Analyze > Fields, Items & Sets > Calculated Item… should show the formula East + West.",
      "Pivots sheet. PickedGroup (F1): Region down the side with the groups Coasts (East and West together) and the other items as they were; Analyze > Group Selection should be greyed or say Ungroup on Coasts. The field's heading in the field list should be Region2.",
      "Pivots sheet. YearsMonths (A14): Date grouped by Years and Months at once (2024 with Jan, Feb, Mar under it, and 2025 under it too). The field list should show Years and Date. DayRanges (F14): Date grouped by 14 days (Group… > Days, Number of days 14), ranges such as 1/1/2025 - 1/14/2025. Hours (K1): Time grouped by Hours, rows 8 to 17.",
      "Pivots sheet. ValuesOnRows (A30): Region with Sum of Qty and Sum of Amount listed down the rows under each region (Σ Values in the Rows area of the field list). Say if the layout is not what you expect (this was built from the file format description, not from a file Excel wrote).",
      "Pivots 2 sheet. LabelFilter (A1): only the regions that begin with E or W (Label Filters > Begins With… shows E, then another one for W: Pli keeps just E here). ValueFilter (F1): only items whose Sum of Amount is greater than 150. DateFilter (K1): the months of 2025 only (Date Filters > This Year as Pli saved it, counted from the day you open it, so the result changes with the year).",
      "Pivots 2 sheet. ShowAs (A12): three columns of numbers for each region: % running total (Show Values As > % Running Total In), rank largest to smallest (Rank Largest to Smallest) and % of parent row total, each against the Amount column.",
      "Styled sheet. A pivot table with the style PivotStyleMedium9 (Design > PivotTable Styles shows it ticked), Banded Rows on, and a slicer for Region (click Coasts' items: the table follows, in one undo step) and a timeline for Date (drag it to the first quarter: the table keeps January to March).",
      "Consolidation sheet. A pivot table made from two ranges (Alt+D, P in old Excel): row labels East and West, columns Q1 and Q2, page field Page1 with Item1 and Last year. Sum of all the numbers is 110; picking Item1 in Page1 makes it 10.",
      "Google Sheets: pivot tables, slicers and timelines are different objects there; it should show the cells as they were saved. Write down what it did.",
    ],
    build() {
      const s = fresh("Pivot tables, the rest", ["Orders", "Pivots", "Pivots 2", "Styled", "Consolidation"]);
      const date = (y: number, m: number, d: number) => dateSerial(y, m, d) ?? 0;
      s.setValues("Orders", "A1", [["Date", "Time", "Region", "Item", "Qty", "Amount"]]);
      const rows: [number, number, string, string, number, number][] = [
        [date(2024, 1, 8), 8.25 / 24, "East", "Pens", 12, 36],
        [date(2024, 2, 14), 9.5 / 24, "West", "Paper", 9, 45],
        [date(2024, 3, 3), 9.75 / 24, "North", "Pens", 7, 21],
        [date(2024, 3, 21), 11 / 24, "South", "Ink", 3, 36],
        [date(2024, 12, 28), 13.5 / 24, "East", "Ink", 4, 48],
        [date(2025, 1, 6), 14.25 / 24, "West", "Pens", 11, 33],
        [date(2025, 1, 19), 15 / 24, "West", "Paper", 6, 30],
        [date(2025, 2, 2), 16.75 / 24, "East", "Pens", 8, 24],
        [date(2025, 2, 25), 8.5 / 24, "East", "Paper", 10, 50],
        [date(2025, 3, 9), 10.25 / 24, "North", "Ink", 2, 24],
        [date(2025, 3, 15), 12 / 24, "North", "Pens", 15, 45],
        [date(2025, 3, 30), 12.5 / 24, "South", "Ink", 5, 60],
        [date(2025, 4, 11), 13 / 24, "East", "Paper", 5, 17],
        [date(2025, 4, 25), 17.5 / 24, "West", "Ink", 8, 66],
      ];
      rows.forEach((row, i) => s.setValues("Orders", `A${i + 2}`, [row]));
      s.setFormat("Orders", "A2:A15", "m/d/yyyy");
      s.setFormat("Orders", "B2:B15", "h:mm");
      s.setStyle("Orders", "A1:F1", { bold: true, fill: "#dce6f2" });
      const base = { source: "Orders!A1:F15" };
      s.createPivot("Pivots", { ...base, name: "CalcItem", anchor: "A1", rows: ["Region"], values: [{ field: "Amount", fmt: "$#,##0" }], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
      s.createPivot("Pivots", { ...base, name: "PickedGroup", anchor: "F1", rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "YearsMonths", anchor: "A14", rows: [{ field: "Date", group: { by: "years" } }, { field: "Date", group: { by: "months" } }], values: [{ field: "Amount", fmt: "$#,##0" }], tabular: true });
      s.createPivot("Pivots", { ...base, name: "DayRanges", anchor: "F14", rows: [{ field: "Date", group: { by: "dayRange", days: 14 } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "Hours", anchor: "K1", rows: [{ field: "Time", group: { by: "hours" } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots", { ...base, name: "ValuesOnRows", anchor: "A30", rows: ["Region"], values: [{ field: "Qty" }, { field: "Amount", fmt: "$#,##0" }], valuesOnRows: true });
      s.createPivot("Pivots 2", { ...base, name: "LabelFilter", anchor: "A1", rows: [{ field: "Region", filter: { kind: "label", a: { op: "beginsWith", value: "E" } } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots 2", { ...base, name: "ValueFilter", anchor: "F1", rows: [{ field: "Item", filter: { kind: "value", by: 0, a: { op: "greaterThan", value: 150 } } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots 2", { ...base, name: "DateFilter", anchor: "K1", rows: [{ field: "Date", group: undefined, filter: { kind: "date", period: "thisYear" } }], values: [{ field: "Amount", fmt: "$#,##0" }] });
      s.createPivot("Pivots 2", { ...base, name: "ShowAs", anchor: "A12", rows: ["Region"], values: [{ field: "Amount", name: "Running", showAs: "percentRunningTotal", base: { field: "Region" } }, { field: "Amount", name: "Rank", showAs: "rankDescending", base: { field: "Region" } }, { field: "Amount", name: "Of parent", showAs: "percentOfParentRow" }] });
      const styled = s.createPivot("Styled", { ...base, name: "Styled", anchor: "A1", rows: ["Region"], columns: ["Item"], values: [{ field: "Amount", fmt: "$#,##0" }], style: { name: "PivotStyleMedium9", rowStripes: true } });
      s.addPivotSlicer("Styled", styled.id, { field: "Region", from: { row: 10, col: 1 } });
      s.addPivotTimeline("Styled", styled.id, { field: "Date", from: { row: 10, col: 4 } });
      s.setValues("Consolidation", "H1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
      s.setValues("Consolidation", "H6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
      s.createPivot("Consolidation", { source: "Consolidation!H1:J3", ranges: [{ source: "Consolidation!H1:J3" }, { source: "Consolidation!H6:J8", name: "Last year" }], name: "Consolidated", anchor: "A1", rows: ["Row"], columns: ["Column"], values: ["Value"], filters: [{ field: "Page1", items: ["Item1", "Last year"] }] });
      readMe(s, "Pivot tables, the rest", this.see);
      return s;
    },
  },
  {
    file: "38-notes-fill-picture.xlsx",
    title: "Notes with a fill, a picture, a line and a link",
    see: [
      "Excel should open this without a repair message. Review > Show All Notes shows every box on the Notes sheet.",
      "B2: the box is orange (#FFCC00) and half see-through (Format Comment > Colors and Lines > Transparency 30%), with a red 2 pt dashed line, and no shadow.",
      "B4: the box is filled with a picture (a light blue block): Format Comment > Colors and Lines > Fill > Fill Effects > Picture shows it as the chosen picture. If Excel drops it, the box is plain yellow: write down which.",
      "B6: a light yellow-orange fill (#FFE699) with no line at all (Line > No Line).",
      "B8: a long-dash-dot green line 3 pt wide, a light green fill 60% see-through. B10: a plain note with Excel's usual look (yellow, thin black line, shadow), as the control.",
      "B12: the words 'the Pli docs' are bold in the note's text. In Pli they are also a link (Pli-only: Excel's notes can't hold links), so Excel shows them as plain bold text, which is right.",
      "Save the file in Excel and open it in Pli: the fills, lines, dashes and the picture should come back (the link will not).",
    ],
    build() {
      const s = fresh("Notes fill and picture", ["Notes"]);
      s.setValues("Notes", "A1", [["Notes with a fill, a picture, a line and a link"]]);
      s.setValues("Notes", "A2", [["Orange, half see-through, red dashed line"], [null], ["Picture fill"], [null], ["No line"], [null], ["Long dash dot, green"], [null], ["Usual look"], [null], ["Link (Pli-only)"]]);
      const shown = { width: 200, height: 70, show: true as const };
      s.setNote("Notes", "B2", "Orange box, 30% transparent, red dashed 2 pt line, no shadow", { box: { ...shown, dx: 30 } });
      s.setNoteLook("Notes", "B2", { fill: "#ffcc00", transparency: 30, line: "#c00000", lineWeight: 2, dash: "dash", shadow: false });
      s.setNote("Notes", "B4", "A picture fills this box", { box: { ...shown, dx: 30 } });
      s.setNoteLook("Notes", "B4", { picture: pngUri(48, 32, [180, 215, 240]) });
      s.setNote("Notes", "B6", "A fill and no line at all", { box: { ...shown, dx: 30 } });
      s.setNoteLook("Notes", "B6", { fill: "#ffe699", line: "none" });
      s.setNote("Notes", "B8", "Long dash dot, 3 pt green line, light green fill 60% see-through", { box: { ...shown, dx: 30 } });
      s.setNoteLook("Notes", "B8", { fill: "#c6efce", transparency: 60, line: "#2e7d32", lineWeight: 3, dash: "longDashDot" });
      s.setNote("Notes", "B10", "Excel's usual look: yellow, thin black line, shadow", { box: { ...shown, dx: 30 } });
      s.setNote("Notes", "B12", "Read the Pli docs for more", { runs: [{ text: "Read " }, { text: "the Pli docs", bold: true, link: "https://pli.dev/docs" }, { text: " for more" }], box: { ...shown, dx: 30 } });
      s.setColumnWidth("Notes", 1, 38);
      s.setColumnWidth("Notes", 2, 12);
      readMe(s, "Notes with a fill, a picture, a line and a link", this.see);
      return s;
    },
  },
  {
    file: "42-functions-rest.xlsx",
    title: "Functions, the rest: complex numbers, FORECAST.ETS, optional LAMBDA parameters, GROUPBY and PIVOTBY",
    see: [
      "Excel should open this without a repair message. Every formula should be one Excel knows (no #NAME?), including the _xlfn. ones: IMTAN, IMSEC, IMCSC, IMCOT, IMSINH, IMCOSH, IMSECH, IMCSCH, ISOMITTED and the four FORECAST.ETS functions.",
      "Complex sheet: column C is Excel's own answer for the formula in column B and column D is what Pli worked out (as text). They should agree to about 14 digits (a different last digit is fine). The rows near the end are the odd ones: IMLN(0), IMCSC(0) and IMPOWER(0,-1) should be #NUM!, a mix of i and j (IMSUM) should be #VALUE!, text should be #NUM!, and a space around the sign (\"3 + 4i\") is accepted. Excel's answers (kept in excel-check/back) are pinned by Pli's tests; its last digits differ now and then (IMPOWER(2+3i,3) is -46+9.00000000000001i there), which is noise.",
      "Forecast sheet: the series (B2:B21) is a pattern of 4 with noise. FORECAST.ETS.SEASONALITY is 4 in both Excel and Pli. The forecasts, interval and statistics (alpha, beta, gamma, MASE, SMAPE, MAE, RMSE) in column F differ a little from Pli's in column G, since Excel's search for the smoothing constants and starting states is not published (Excel's are alpha 0.126, beta and gamma 0.001; its squared errors are not the smallest possible): the test file pins how far apart they may be. The step is 1 for the numbered series and 31 for the monthly one (the last row) in Excel.",
      "Lambda sheet: A1 =LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(5)) is 5 and A2 (with f(5,2)) is 7. Click A1: the formula bar must show the optional parameter in square brackets. A5 and A6 are a LAMBDA called where it stands, =LAMBDA(x,x+1)(5) (6) and with an optional parameter (7): they should open without a repair message and show those numbers.",
      "GroupBy sheet: compare each spilled block with the line above it, which says which arguments were used. Excel's answers (excel-check/back) are pinned by Pli's tests: headers found by themselves are not shown, only a grand total unless total_depth asks for more, \"Grand Total\" once there are subtotals, and a subtotal row carries the group's own name. Cells after the real result that show #N/A in Excel's file are the fixed size of the array formula Pli wrote, not part of Excel's answer.",
    ],
    build() {
      const s = fresh("Functions, the rest", ["Complex", "Forecast", "Lambda", "GroupBy"]);
      // ---- complex numbers
      s.setValues("Complex", "A1", [["Function", "Formula", "Excel's answer", "Pli's answer"]]);
      s.setStyle("Complex", "A1:D1", { bold: true, fill: "#dce6f2" });
      const complex = [
        'IMEXP("1+i")', 'IMLN("3+4i")', 'IMLOG10("3+4i")', 'IMLOG2("3+4i")', 'IMSQRT("3+4i")', 'IMPOWER("2+3i",3)', 'IMPOWER("1+i",0.5)', 'IMPOWER("4j",-1)', 'IMSIN("3+4i")', 'IMCOS("1+i")', 'IMTAN("1+i")', 'IMSEC("1+i")', 'IMCSC("1+i")', 'IMCOT("1+i")',
        'IMSINH("1+i")', 'IMCOSH("1+i")', 'IMSECH("1+i")', 'IMCSCH("1+i")', 'IMSIN("2j")', 'IMEXP("4j")', 'IMLN("0")', 'IMCSC("0")', 'IMPOWER("0",-1)', 'IMSUM("1+i","1+j")', 'IMSIN("3 + 4i")', 'IMSIN("abc")',
      ];
      complex.forEach((f, i) => {
        const r = i + 2;
        s.setValues("Complex", `A${r}`, [[f.slice(0, f.indexOf("(")), "'=" + f, "=" + f]]);
        // Pli's answer, written as text next to Excel's.
        const v = s.value("Complex", `C${r}`);
        s.setCell("Complex", `D${r}`, "'" + (isError(v) ? v.error : String(v)));
      });
      s.setColumnWidth("Complex", 4, 42);
      s.setColumnWidth("Complex", 2, 28);
      s.setColumnWidth("Complex", 3, 42);
      // ---- FORECAST.ETS
      const y = [11.2, 14.9, 8.7, 12.6, 13.4, 15.1, 11.9, 13.2, 15.8, 18.4, 12.1, 16.5, 16.2, 20.7, 14.9, 17.1, 19.6, 21.3, 17.8, 20.2];
      s.setValues("Forecast", "A1", [["Step", "Value", "Month"]]);
      s.setStyle("Forecast", "A1:C1", { bold: true, fill: "#dce6f2" });
      y.forEach((v, i) => s.setValues("Forecast", `A${i + 2}`, [[i + 1, v, dateSerial(2022, 1 + i, 1)]]));
      s.setFormat("Forecast", "C2:C21", "mmm yyyy");
      s.setValues("Forecast", "E1", [["What", "Excel's answer", "Pli's answer", "Formula"]]);
      const ets = [
        "FORECAST.ETS(21,B2:B21,A2:A21)", "FORECAST.ETS(24,B2:B21,A2:A21)", "FORECAST.ETS(24,B2:B21,A2:A21,0)", "FORECAST.ETS(DATE(2024,1,1),B2:B21,C2:C21)", "FORECAST.ETS.CONFINT(21,B2:B21,A2:A21)", "FORECAST.ETS.CONFINT(21,B2:B21,A2:A21,0.8)",
        "FORECAST.ETS.SEASONALITY(B2:B21,A2:A21)", "FORECAST.ETS.STAT(B2:B21,A2:A21,1)", "FORECAST.ETS.STAT(B2:B21,A2:A21,2)", "FORECAST.ETS.STAT(B2:B21,A2:A21,3)", "FORECAST.ETS.STAT(B2:B21,A2:A21,4)", "FORECAST.ETS.STAT(B2:B21,A2:A21,5)", "FORECAST.ETS.STAT(B2:B21,A2:A21,6)", "FORECAST.ETS.STAT(B2:B21,A2:A21,7)", "FORECAST.ETS.STAT(B2:B21,A2:A21,8)", "FORECAST.ETS.STAT(B2:B21,C2:C21,8)",
      ];
      ets.forEach((f, i) => {
        s.setValues("Forecast", `E${i + 2}`, [[f.slice(0, f.indexOf("(")), "=" + f]]);
        const v = s.value("Forecast", `F${i + 2}`);
        s.setValues("Forecast", `G${i + 2}`, [[typeof v === "number" ? v : isError(v) ? v.error : String(v), "'=" + f]]);
      });
      s.setColumnWidth("Forecast", 5, 30);
      s.setColumnWidth("Forecast", 8, 60);
      // ---- LAMBDA
      s.setCell("Lambda", "A1", "=LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(5))");
      s.setCell("Lambda", "A2", "=LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(5,2))");
      s.setCell("Lambda", "A3", "=LET(f,LAMBDA([x],[y],IF(ISOMITTED(x),100,x)+IF(ISOMITTED(y),1000,y)),f(,5))");
      s.setCell("Lambda", "A4", "=LET(f,LAMBDA([x],[y],IF(ISOMITTED(x),100,x)+IF(ISOMITTED(y),1000,y)),f())");
      // A LAMBDA called where it stands, without a name: Excel's own answer and file text for these are what Pli's reading and writing are checked against.
      s.setCell("Lambda", "A5", "=LAMBDA(x,x+1)(5)");
      s.setCell("Lambda", "A6", "=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(5,2)");
      s.setValues("Lambda", "B1", [["should be 5"], ["should be 7"], ["should be 105"], ["should be 1100"], ["should be 6 (a LAMBDA called at once)"], ["should be 7 (a LAMBDA called at once)"]]);
      // ---- GROUPBY and PIVOTBY
      const data = [["Region", "Product", "Qty", "Sales"], ["East", "Apple", 10, 100], ["East", "Pear", 5, 40], ["West", "Apple", 7, 70], ["West", "Pear", 3, 33], ["East", "Apple", 2, 20], ["North", "Plum", 4, 44], ["North", "Apple", 8, 81]];
      s.setValues("GroupBy", "A1", data);
      s.setStyle("GroupBy", "A1:D1", { bold: true, fill: "#dce6f2" });
      const blocks = [
        "GROUPBY(A1:A8,D1:D8,SUM)", "GROUPBY(A1:A8,D1:D8,SUM,3)", "GROUPBY(A1:B8,D1:D8,SUM)", "GROUPBY(A2:B8,D2:D8,SUM,0,-2)", "GROUPBY(A2:A8,D2:D8,SUM,0,0,-2)", "GROUPBY(A2:A8,C2:D8,HSTACK(SUM,COUNT),0,0)",
        'GROUPBY(A2:A8,D2:D8,VSTACK(HSTACK(COUNT,SUM),{"Count","Cost"}),0,0)', "GROUPBY(A1:A8,D1:D8,PERCENTOF,3)", "GROUPBY(A2:B8,D2:D8,SUM,0,0,-3,,1)", "GROUPBY(A2:A8,D2:D8,SUM,2,1)",
        "PIVOTBY(A1:A8,B1:B8,D1:D8,SUM)", "PIVOTBY(A1:A8,B1:B8,D1:D8,SUM,3)", "PIVOTBY(A2:A8,,D2:D8,SUM,0)", "PIVOTBY(A2:A8,B2:B8,D2:D8,HSTACK(COUNT,SUM),0)", "PIVOTBY(A2:B8,B2:B8,D2:D8,SUM,0,-2)",
        "PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,0)", "PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,1)", "PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,2)", "PIVOTBY(A2:B8,B2:B8,D2:D8,PERCENTOF,0,2,,1,,,4)",
      ];
      // Each block sits in its own band of 16 rows below the data, the formula as text above it.
      blocks.forEach((f, i) => {
        const row = 12 + i * 16;
        s.setCell("GroupBy", `A${row}`, "'=" + f);
        s.setCell("GroupBy", `A${row + 1}`, "=" + f);
      });
      readMe(s, "Functions, the rest", this.see);
      return s;
    },
  },
  {
    file: "40-printing-rest.xlsx",
    title: "Printing, the rest: notes printed as displayed, header pictures next to notes, text running on over page breaks, draft quality",
    see: [
      "Excel should open this without a repair message. Each sheet is looked at in File > Print (the preview); Page Layout > Page Setup > Sheet shows the settings named below. Write down every place where Excel differs from what is said here.",
      "Shown notes: the sheet prints 'As displayed on sheet' with a print area of A1:F12. Three notes are showing (right-click a cell > Show/Hide Note: A2, C5 and F3) and one is not (E9). The preview should draw the three showing boxes where they sit on the sheet (C5's was moved and sized: 200 by 60, below and right of its cell, with its text in bold and red in parts and 'Pat:' in bold in front), and not E9's. F3's box starts 40 pixels inside column F and runs on past the print area's right edge, so Pli prints only the part over column F (Excel may differ: does it cut the box off at the print area, print all of it, or leave it out?). The shown notes' boxes in the sheet itself should be where the preview has them.",
      "Notes at the end: the NotesEnd sheet has the same notes with Comments set to 'At end of sheet': the preview should have a last page listing all four notes, the hidden one too. Write down how Excel words the list (Pli prints 'Cell A2: text').",
      "Notes and header pictures: the Logos sheet has two notes (one showing) AND pictures in its headers and footers: a green box left in the header, a blue one in the middle of the footer, a red one right in the first page's header ('Different first page' is ticked), and a grey one right in the even pages' footer ('Different odd and even pages' is ticked). In Excel's custom header dialog each of those places shows &[Picture]. This is the case the file's shape ids matter for: both the notes and the header pictures are legacy drawings of the same sheet. If Excel offers to repair the file, say what it removed (the notes, the pictures, or both).",
      "Text running on: the Overflow sheet has a long sentence in B1 with empty cells after it and a vertical page break after column C. In Pli's printout page 1 (A:C) shows the sentence cut at column C's edge and page 2 (D:F) none of it. Does Excel cut the text at the page break and print nothing of it on page 2, or carry the rest of the sentence over to page 2? Row 3 has a long sentence in A3 with a print area that ends at column C (A1:C5 is the print area of the second page setup: look at the Overflow2 sheet): the text should be cut at C's edge. Row 5 on Overflow2 has right-aligned text in column B whose text is longer than B: it should run left over A5 and stop at the edge of the print area.",
      "Draft: the Draft sheet has gridlines ticked and 'Draft quality' ticked, with a chart, two pictures (one on the sheet, one inside cell B2), a sparkline and a picture in the header. The preview should show the cells and their borders and fills but no gridlines, chart, pictures or sparkline (Excel leaves graphics out of a draft printout on printers that support it, so write down what its preview shows). The NotDraft sheet is the same without 'Draft quality': it should show everything.",
    ],
    build() {
      const s = fresh("Printing, the rest", ["Shown notes", "NotesEnd", "Logos", "Overflow", "Overflow2", "Draft", "NotDraft"]);
      const table = (sheet: string) => s.setValues(sheet, "A1", Array.from({ length: 12 }, (_, r) => ["Item", "Qty", "Price", "Total", "Note", "Tag"].map((h, c) => (r === 0 ? h : c === 0 ? `Row ${r}` : (r + 1) * (c + 1)))));
      for (const [name, mode] of [["Shown notes", "sheet"], ["NotesEnd", "end"]] as const) {
        table(name);
        s.setNote(name, "A2", "Shown with the usual box.", { box: { show: true } });
        s.setNote(name, "C5", "Moved and sized, with a look", { author: "Pat", runs: [{ text: "Moved ", bold: true }, { text: "and sized, ", color: "#c00000" }, { text: "with a look" }], box: { show: true, dx: 60, dy: 30, width: 200, height: 60 } });
        s.setNote(name, "F3", "Its box starts in column F and lies mostly past the print area.", { box: { show: true, dx: -40, dy: 5 } });
        s.setNote(name, "E9", "Not showing.");
        s.setPageSetup(name, { comments: mode, printArea: ["A1:F12"] });
      }
      table("Logos");
      s.setNote("Logos", "B2", "A shown note beside the pictures.", { box: { show: true } });
      s.setNote("Logos", "C4", "A note that is not showing.");
      s.setHeaderFooterPicture("Logos", "header", "left", headerPictureFrom(pngUri(80, 40, [30, 150, 60]), { width: 80, height: 40 }));
      s.setHeaderFooterPicture("Logos", "footer", "center", headerPictureFrom(pngUri(60, 30, [30, 60, 150]), { width: 60, height: 30 }));
      s.setHeaderFooterPicture("Logos", "firstHeader", "right", headerPictureFrom(pngUri(60, 30, [200, 40, 40]), { width: 60, height: 30 }));
      s.setHeaderFooterPicture("Logos", "evenFooter", "right", headerPictureFrom(pngUri(60, 30, [120, 120, 120]), { width: 60, height: 30 }));
      s.setPageSetup("Logos", { comments: "sheet", header: { center: "Quarterly report" }, footer: { left: "&F" }, evenFooter: { left: "Even pages" } });
      s.setValues("Overflow", "A1", [[null, "A rather long sentence that starts in column B and needs the next four columns of room to be read in full", null, null, null, null]]);
      s.setValues("Overflow", "A3", [["x", "y", "z", "u", "v", "w"]]);
      s.setPageSetup("Overflow", { colBreaks: [3] });
      s.setValues("Overflow2", "A1", [["A rather long sentence in A1, longer than the three columns of the print area can show, so it is cut off at C's edge", null, null, null, null, null]]);
      s.setValues("Overflow2", "A3", [["end", "of", "area", "beyond"]]);
      s.setValues("Overflow2", "A5", [["x", "Right-aligned text that is longer than its own cell and runs to the left"]]);
      s.setStyle("Overflow2", "B5", { align: "right" });
      s.setPageSetup("Overflow2", { printArea: ["B1:C5"] });
      for (const [name, draft] of [["Draft", true], ["NotDraft", false]] as const) {
        s.setValues(name, "A1", [["Draft quality", "cells, fills and borders still print"], [1, 2, 3, 4, 5], [3, 1, 4, 1, 5], [2, 7, 1, 8, 2]]);
        s.setStyle(name, "A1:B1", { bold: true, fill: "#ffe699", border: { bottom: { style: "medium", color: "#1f4e79" } } });
        s.addChart(name, { type: "bar", title: "Numbers", series: [{ values: `${name}!$A$2:$E$2` }], from: { row: 6, col: 1 }, width: 320, height: 180 });
        s.addImage(name, { src: pngUri(80, 40, [200, 40, 40]), from: { row: 6, col: 6 }, width: 80, height: 40, alt: "A red box" });
        s.setCellPicture(name, "B2", { src: pngUri(20, 20, [30, 150, 60]), alt: "Green in a cell" });
        s.addSparklines(name, { type: "line", location: "F2", data: `${name}!A3:E3` });
        s.setHeaderFooterPicture(name, "header", "left", headerPictureFrom(pngUri(60, 30, [30, 60, 150]), { width: 60, height: 30 }));
        s.setPageSetup(name, { gridlines: true, ...(draft ? { draft: true as const } : {}) });
      }
      readMe(s, "Printing, the rest", this.see);
      return s;
    },
  },
  {
    file: "37-pictures-more.xlsx",
    title: "Pictures: the other ten artistic effects, JPEG and GIF with effects, crop to shape",
    see: [
      "Excel should open this without a repair message. Three sheets of pictures. If Excel offers to repair the file, say so and which sheet it names; the likeliest cause is the a14 artistic effect extension (a picture with an effect is the picture as the effect draws it plus the original with the effect), which now also covers JPEG and GIF (the original of every one is an HD Photo file), or a picture's shape (prstGeom).",
      "More effects: the ten Pli added to the first twelve (Marker, Chalk sketch, Cement, Crisscross etching, Light screen, Pastels smooth, Plastic wrap, Texturizer, Watercolor sponge, Paint strokes), each on the 120 by 90 scene with its name above it. Excel draws the picture Pli wrote (Pli's own version of the effect, close in spirit and not pixel for pixel to Excel's). Click one: Picture Format > Artistic Effects should show the effect Pli named as the current one (Marker, Cement and so on) and Format Picture > Picture should show its setting (Marker size 20, Cement crack spacing 25, Light screen grid size 25, Paint strokes intensity 5 ...). Choosing 'None' in Artistic Effects should bring the plain scene back. Say if Excel shows no effect selected, a different one, or if resetting the picture does not bring the original back; that tells whether it reads the layer.",
      "JPEG and GIF with effects (second sheet): a JPEG and a GIF with a Pencil sketch, a Marker and a Watercolor sponge on each, next to the plain JPEG and GIF. Before this the effect was left out for these two kinds. They should show the effect (a PNG Pli drew from the JPEG's or GIF's pixels) and, as with the PNG pictures, Artistic Effects > None should bring back the plain JPEG or GIF (the original is kept in the layer). The original is an HD Photo file with the JPEG's or GIF's pixels, as Excel keeps it. If None gives a blank or broken picture rather than the plain one, say so.",
      "Crop to shape (third sheet): every shape Pli knows (33), each on the same scene, named above: rounded and snipped rectangles, an oval, triangles, diamond, parallelogram, trapezoid, pentagon, hexagon, octagon, cross, teardrop, heart, the arrows (right, left, up, down, left and right, chevron, pentagon arrow) and the stars (4, 5, 6, 8, 10 and 12 points). Each picture should show only inside its shape; click one: Picture Format > Crop > Crop to Shape should say which shape it is. Compare a few against Excel's own: the outlines are Office's preset shapes with their usual adjustments, so they should look the same as Insert > Shapes (heart, teardrop, chevron and the stars are the ones to eyeball).",
      "Shapes with other settings (the last row of the third sheet): an oval with a red 3 pt border, a star with a shadow, a heart turned 30 degrees, a hexagon flipped left to right, a triangle with a reflection and a rounded rectangle with soft edges. The border and the shadow should follow the shape, not the rectangle.",
      "LibreOffice, Google Sheets: the picture shapes show in LibreOffice (it draws the shape; what it saves back is a shape filled with the picture); Google Sheets ignores shapes and effects, and shows the picture that was written.",
    ],
    build() {
      const s = fresh("More picture effects", ["More effects", "JPEG and GIF", "Shapes"]);
      const w = 120;
      const h = 90;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let c = [60 + (x * 140) / w, 120 + (y * 100) / h, 200 - (x * 80) / w];
          if ((x - 42) ** 2 + (y - 40) ** 2 < 600) c = [230, 80, 60];
          if (x > 66 && x < 106 && y > 36 && y < 72) c = [250, 230, 90];
          if (y > 78) c = [70, 130, 70];
          data.set([...c, 255], (y * w + x) * 4);
        }
      }
      const scene = toDataUri(encodePng({ width: w, height: h, data }), "png");
      const label = (sheet: string, at: string, text: string) => s.setValues(sheet, at, [[text]]);
      const cell = (row: number, col: number) => `${String.fromCharCode(64 + col)}${row}`;
      s.setColumnWidth("More effects", 1, 3);
      s.setColumnWidth("JPEG and GIF", 1, 3);
      s.setColumnWidth("Shapes", 1, 3);
      const effects: [string, object][] = [
        ["Marker", { kind: "marker", level: 20 }],
        ["Chalk sketch", { kind: "chalkSketch", level: 25 }],
        ["Cement", { kind: "cement", level: 25 }],
        ["Crisscross etching", { kind: "crisscrossEtching", level: 50 }],
        ["Light screen", { kind: "lightScreen", level: 25 }],
        ["Pastels smooth", { kind: "pastelsSmooth", level: 10 }],
        ["Plastic wrap", { kind: "plasticWrap", level: 5 }],
        ["Texturizer", { kind: "texturizer", level: 50 }],
        ["Watercolor sponge", { kind: "watercolorSponge", level: 5 }],
        ["Paint strokes", { kind: "paintStrokes", level: 5 }],
      ];
      effects.forEach(([name, artistic], i) => {
        const row = 3 + Math.floor(i / 4) * 7;
        const col = 2 + (i % 4) * 3;
        label("More effects", cell(row - 1, col), name);
        s.addImage("More effects", { src: scene, from: { row, col }, width: 120, height: 90, alt: name, artistic: artistic as never });
      });
      label("More effects", "B17", "Plain scene");
      s.addImage("More effects", { src: scene, from: { row: 18, col: 2 }, width: 120, height: 90, alt: "Plain scene" });

      const jpeg = `data:image/jpeg;base64,${SCENE_JPEG}`;
      const gif = `data:image/gif;base64,${SCENE_GIF}`;
      label("JPEG and GIF", "B2", "JPEG, plain"); label("JPEG and GIF", "E2", "JPEG, pencil sketch"); label("JPEG and GIF", "H2", "JPEG, marker"); label("JPEG and GIF", "K2", "JPEG, watercolor sponge");
      s.addImage("JPEG and GIF", { src: jpeg, from: { row: 3, col: 2 }, width: 120, height: 90, alt: "JPEG, plain" });
      s.addImage("JPEG and GIF", { src: jpeg, from: { row: 3, col: 5 }, width: 120, height: 90, alt: "JPEG, pencil sketch", artistic: { kind: "pencilSketch", level: 25 } });
      s.addImage("JPEG and GIF", { src: jpeg, from: { row: 3, col: 8 }, width: 120, height: 90, alt: "JPEG, marker", artistic: { kind: "marker", level: 20 } });
      s.addImage("JPEG and GIF", { src: jpeg, from: { row: 3, col: 11 }, width: 120, height: 90, alt: "JPEG, watercolor sponge", artistic: { kind: "watercolorSponge", level: 5 } });
      label("JPEG and GIF", "B11", "GIF, plain"); label("JPEG and GIF", "E11", "GIF, pencil sketch"); label("JPEG and GIF", "H11", "GIF, marker"); label("JPEG and GIF", "K11", "GIF, watercolor sponge");
      s.addImage("JPEG and GIF", { src: gif, from: { row: 12, col: 2 }, width: 120, height: 90, alt: "GIF, plain" });
      s.addImage("JPEG and GIF", { src: gif, from: { row: 12, col: 5 }, width: 120, height: 90, alt: "GIF, pencil sketch", artistic: { kind: "pencilSketch", level: 25 } });
      s.addImage("JPEG and GIF", { src: gif, from: { row: 12, col: 8 }, width: 120, height: 90, alt: "GIF, marker", artistic: { kind: "marker", level: 20 } });
      s.addImage("JPEG and GIF", { src: gif, from: { row: 12, col: 11 }, width: 120, height: 90, alt: "GIF, watercolor sponge", artistic: { kind: "watercolorSponge", level: 5 } });

      IMAGE_SHAPE_NAMES.forEach((shape, i) => {
        const row = 3 + Math.floor(i / 5) * 7;
        const col = 2 + (i % 5) * 3;
        label("Shapes", cell(row - 1, col), shape);
        s.addImage("Shapes", { src: scene, from: { row, col }, width: 120, height: 90, alt: shape, shape });
      });
      const last = 3 + Math.ceil(IMAGE_SHAPE_NAMES.length / 5) * 7;
      const extras: [string, object][] = [
        ["Oval, red border", { shape: "ellipse", border: { color: "#ff0000", width: 3 } }],
        ["Star, shadow", { shape: "star5", shadow: { distance: 6, blur: 6 } }],
        ["Heart, turned 30", { shape: "heart", rotation: 30 }],
        ["Hexagon, flipped", { shape: "hexagon", flipH: true }],
        ["Triangle, reflection", { shape: "triangle", reflection: {} }],
        ["Rounded, soft edges", { shape: "roundRect", softEdge: 8 }],
      ];
      label("Shapes", cell(last - 1, 2), "Shapes with other settings");
      extras.forEach(([name, extra], i) => {
        const row = last + 1 + Math.floor(i / 5) * 7;
        const col = 2 + (i % 5) * 3;
        label("Shapes", cell(row - 1, col), name);
        s.addImage("Shapes", { src: scene, from: { row, col }, width: 120, height: 90, alt: name, ...extra });
      });
      readMe(s, "More picture effects", this.see);
      return s;
    },
  },
  {
    file: "39-protection-rest.xlsx",
    title: "Protection, the rest: hidden formulas on a whole column and row, Windows accounts on edit ranges, Excel's delete rules",
    see: [
      "Excel should open the file without a repair message. The Budget sheet is protected (password pli) and allows selecting cells, inserting rows, deleting rows and deleting columns.",
      "Hidden formulas: column D (Total) and row 8 (Secret row) hide their formulas as a whole. Click D2 or B8: the formula bar must be empty while the value shows. After Review > Unprotect Sheet (pli), click the D column heading and open Format Cells > Protection (Ctrl+1 / Cmd+1): Hidden must be ticked (and Locked too); the same for the row 8 heading. F2 holds a formula that is not hidden: its formula shows. If Excel shows D2's formula, tell me which cell.",
      "G2 is =FORMULATEXT(F2) and G3 is =FORMULATEXT(D2). While the sheet is protected, Pli says G2 reads =B2*2 and G3 reads #N/A (a hidden formula can't be shown, which is what Excel's help says for FORMULATEXT). The report finds out if Excel agrees: it compares Excel's own results.",
      "Delete rules. Row 10 and column H are unlocked as a whole: right-click the row 10 heading > Delete must work, and so must deleting column H. Row 3 holds locked cells, and so does every other row: Delete on its heading must give Excel's message 'The cell or chart you're trying to change is on a protected sheet'. Pli means the same for a row you just inserted (Insert rows is allowed): it is all locked, so it can't be deleted again. Column C can't be deleted either.",
      "Table interplay. Sales (A13:C16) is a table. Row 14 is unlocked as a whole. Right-click the row 14 heading > Delete (or Delete > Table Rows): Pli refuses because a protected sheet can't resize a table. Say what Excel does (if Excel deletes the row, tell me; Pli's rule is a guess).",
      "Windows accounts (Review > Allow Edit Ranges on Windows; the Mac version may only show the list). After unprotecting with pli: Mine (B2:B4) names two accounts by security identifier, one allowed and one denied (S-1-5-21-1004336348-1177238915-682003330-1001 allowed, ...-1002 denied: they are made up, so Excel shows them as unresolved accounts, which is what to look for). Everyone (B5:B6) allows the Everyone group (S-1-1-0), so anyone can type in B5 and B6 without a password, on Windows. Say what Excel does on the Mac with B5.",
      "Google Sheets: protected ranges are another object there; write down what it did with the Budget sheet.",
    ],
    build() {
      const s = fresh("Protection, the rest", ["Budget"]);
      s.setValues("Budget", "A1", [["Item", "Qty", "Price", "Total", "Open", "Double", "Probe", "Free column"], ["Pens", 10, 3, null, 1, null, null, null], ["Paper", 4, 5, null, 2, null, null, null], ["Ink", 2, 20, null, 3, null, null, null], ["Pencils", 7, 2, null, null, null, null, null], ["Rulers", 1, 9, null, null, null, null, null]]);
      for (const r of [2, 3, 4]) s.setCell("Budget", `D${r}`, `=B${r}*C${r}`);
      s.setCell("Budget", "F2", "=B2*2");
      s.setCell("Budget", "G2", "=FORMULATEXT(F2)");
      s.setCell("Budget", "G3", "=FORMULATEXT(D2)");
      s.setValues("Budget", "A8", [["Secret row", null, null]]);
      s.setCell("Budget", "B8", "=SUM(B2:B4)");
      s.setCell("Budget", "C8", "=SUM(C2:C4)");
      s.setCell("Budget", "A10", "Free row");
      s.setValues("Budget", "A13", [["Region", "Units", "Price"], ["East", 5, 2], ["West", 6, 3], ["North", 7, 4]]);
      s.createTable("Budget", "A13:C16", { name: "Sales" });
      s.setStyle("Budget", "A1:H1", { bold: true });
      s.setColumnWidth("Budget", 1, 14);
      s.setFormulaHidden("Budget", "D:D", true);
      s.setFormulaHidden("Budget", "8:8", true);
      s.setLocked("Budget", "10:10", false);
      s.setLocked("Budget", "H:H", false);
      s.setLocked("Budget", "14:14", false);
      s.addEditRange("Budget", { name: "Mine", ranges: ["B2:B4"], permissions: ["sid:S-1-5-21-1004336348-1177238915-682003330-1001"], denied: ["sid:S-1-5-21-1004336348-1177238915-682003330-1002"] });
      s.addEditRange("Budget", { name: "Everyone", ranges: ["B5:B6"], permissions: ["sid:S-1-1-0"] });
      readMe(s, "Protection, the rest", this.see);
      s.protectSheet("Budget", { password: "pli", allow: ["selectLockedCells", "selectUnlockedCells", "insertRows", "deleteRows", "deleteColumns"] });
      return s;
    },
  },
  {
    file: "41-subtotals-more.xlsx",
    title: "Subtotals over a converted table and merged cells, a pivot table below, totals row functions, hyperlink theme colours",
    see: [
      "Converted sheet: this was a table called Orders with a totals row; the Subtotal command was run on it with 'convert the table to a range first'. Excel's own Subtotal button is greyed out over a table, so what to check is that nothing of the table is left: click any cell and there is no Table Design tab, no filter buttons, no banded stripes. Rows 2 to 3 are East and row 4 'East Total' (bold, a SUBTOTAL(9, …) formula), then West; 'Grand Total' is row 8, and the old totals row ('Total', SUBTOTAL(109, …) under Qty and SUBTOTAL(101, …) under Amount) is still the last row, outside the subtotals. Buttons 1 2 3 at the top left fold the groups. Data > Subtotal on a cell of the list opens the dialog and Remove All takes the subtotal rows and the outline away, leaving the totals row.",
      "Merged sheet: the Region labels are merged cells (A2:A3 for East, then A5:A7 for West; the subtotal row 4 sits between them), each covering only its own rows. Click A2: the merge is two cells tall, not three. 'East Total' is row 4, 'West Total' row 8, 'Grand Total' row 9, and their SUBTOTAL(9, …) formulas add the rows above them (C2:C3, C5:C7). If Excel shows a repair message, write down which sheet it names.",
      "Pivot sheet: a list (A1:C5) with rows of subtotals (East Total, West Total, Grand Total) and a pivot table named ByRegion below it, which started in A12 and now begins in A15 (the subtotal rows pushed it down). E1 is GETPIVOTDATA(\"Sum of Qty\", A15, \"Region\", \"West\") and must show 9. Click a cell inside the pivot table: Data > Subtotal is greyed out (as it is over any pivot table). Refresh All: the pivot table keeps its numbers (East 3, West 9).",
      "Totals row sheet: the table Stock is filtered to East and row 3 (East, Paper) is hidden by hand; so 3 rows show (rows 2, 5 and 7). The totals row (row 8) uses Excel's own functions: Qty 'Sum' (shows 18), Price 'Average' (54.83), Item 'Count' (3); these are SUBTOTAL(109/101/103, Stock[…]) so they leave out the filtered and the hidden rows. G1 is a plain SUM of the whole Qty column and shows 30. Click D8: the drop-down lists Average as the chosen function. Show the hidden row (select rows 2 to 4, Unhide): Qty becomes 22 and Price 43.13.",
      "Links sheet: the workbook's theme has its own Hyperlink colour (green) and Followed Hyperlink colour (purple). A2 and A5 are links in the 'Hyperlink' cell style (Home > Cell Styles > the Hyperlink tile is ticked) and show green and underlined; A3 is in the 'Followed Hyperlink' style and shows purple; A4 is a link whose text has its own red colour, which stays red. Page Layout > Colors > Office: A2 and A5 turn Office's blue and A3 Office's purple (so the colours come from the theme, not fixed).",
      "Links sheet: in row 2 and row 3 beside the numbers, I2 is a line sparkline in the theme's Hyperlink colour with its high point in the Followed Hyperlink colour (green line, purple dot), I3 a column sparkline in the Followed Hyperlink colour (purple bars). Sparkline tab > Sparkline Color shows the colour as a theme colour (it may not show a name for these two: Excel's picker lists only the ten main theme colours). Changing the theme's colours moves them with the links.",
      "Google Sheets: it should show the cells, the merges and the subtotal rows as saved (no theme colours for links). Write down what it did.",
    ],
    build() {
      const s = fresh("Subtotals, more", ["Converted", "Merged", "Source", "Pivot", "Totals row", "Links"]);
      const head = (sheet: string, range: string) => s.setStyle(sheet, range, { bold: true, fill: "#dce6f2" });
      // 1. A table with a totals row, subtotalled by converting it to a range.
      s.setValues("Converted", "A1", [
        ["Region", "Product", "Qty", "Amount"],
        ["East", "Ink", 4, 40],
        ["East", "Pens", 10, 25],
        ["West", "Ink", 7, 70],
        ["West", "Paper", 5, 11],
      ]);
      head("Converted", "A1:D1");
      s.createTable("Converted", "A1:D5", { name: "Orders" });
      s.setTableTotals("Orders", true);
      s.setTableTotalsFunction("Orders", "Qty", "sum");
      s.setTableTotalsFunction("Orders", "Amount", "average");
      s.subtotal("Converted", "A1:D6", { by: "Region", columns: ["Qty", "Amount"], convertTable: true });
      s.setColumnWidth("Converted", 1, 16);
      // 2. Merged labels down the Region column.
      s.setValues("Merged", "A1", [
        ["Region", "Product", "Qty", "Amount"],
        ["East", "Ink", 4, 40],
        [null, "Pens", 10, 25],
        ["West", "Ink", 7, 70],
        [null, "Paper", 5, 11],
        [null, "Pens", 2, 5],
      ]);
      head("Merged", "A1:D1");
      s.mergeCells("Merged", "A2:A3");
      s.mergeCells("Merged", "A4:A6");
      s.setStyle("Merged", "A2:A6", { vAlign: "middle" });
      s.subtotal("Merged", "A1:D6", { by: "Region", columns: ["Qty", "Amount"] });
      s.setColumnWidth("Merged", 1, 16);
      // 3. A list with a pivot table below it (and the pivot table's own source on another sheet).
      const list = [
        ["Region", "Product", "Qty"],
        ["East", "Ink", 1],
        ["East", "Pens", 2],
        ["West", "Ink", 4],
        ["West", "Pens", 5],
      ];
      s.setValues("Source", "A1", list);
      s.setValues("Pivot", "A1", list);
      head("Pivot", "A1:C1");
      s.createPivot("Pivot", { name: "ByRegion", source: "Source!A1:C5", anchor: "A12", rows: ["Region"], values: [{ field: "Qty" }] });
      s.setCell("Pivot", "E1", '=GETPIVOTDATA("Sum of Qty",A12,"Region","West")');
      s.subtotal("Pivot", "A1:C5", { by: "Region", columns: ["Qty"] });
      // 4. A table with a totals row of Excel's functions, filtered and with a row hidden by hand.
      s.setValues("Totals row", "A1", [
        ["Region", "Item", "Qty", "Price"],
        ["East", "Pens", 10, 2.5],
        ["East", "Paper", 4, 8],
        ["West", "Ink", 2, 12.25],
        ["East", "Ink", 7, 12],
        ["West", "Pens", 6, 3],
        ["East", "Desk", 1, 150],
      ]);
      head("Totals row", "A1:D1");
      s.createTable("Totals row", "A1:D7", { name: "Stock" });
      s.setTableTotals("Stock", true);
      s.setTableTotalsFunction("Stock", "Item", "count");
      s.setTableTotalsFunction("Stock", "Qty", "sum");
      s.setTableTotalsFunction("Stock", "Price", "average");
      s.setFormat("Totals row", "D2:D8", "0.00");
      s.filterTable("Stock", "Region", ["East"]);
      s.transact([{ type: "set_size", sheet: s.sheet("Totals row").id, axis: "row", index: 3, hidden: true }]);
      s.setCell("Totals row", "F1", "SUM of the whole column:");
      s.setCell("Totals row", "G1", "=SUM(Stock[Qty])");
      s.setColumnWidth("Totals row", 6, 24);
      // 5. Links in the theme's hyperlink colours, and sparklines in them too.
      s.setValues("Links", "A1", [["Links"], ["Pli"], ["Pli, followed"], ["Pli, own colour"], ["Back to the top"]]);
      s.setStyle("Links", "A1", { bold: true });
      s.setLink("Links", "A2", { to: "https://pli.dev" });
      s.setLink("Links", "A3", { to: "https://pli.dev/sheets" });
      s.followLink("Links", "A3");
      s.setStyle("Links", "A4", { color: "#cc0000" });
      s.setLink("Links", "A4", { to: "https://pli.dev/docs" });
      s.setLink("Links", "A5", { to: "#Links!A1" });
      s.setValues("Links", "C2", [[3, 5, 4, 8, 6, 9], [2, 4, 3, 6, 5, 7]]);
      s.setColumnWidth("Links", 1, 20);
      s.setColumnWidth("Links", 9, 16);
      s.setRowHeight("Links", 2, 28);
      s.setRowHeight("Links", 3, 28);
      s.addSparklines("Links", { type: "line", location: "I2", data: "C2:H2", color: { theme: 10 }, high: true, highColor: { theme: 11 }, markers: true, markerColor: { theme: 10 } });
      s.addSparklines("Links", { type: "column", location: "I3", data: "C3:H3", color: { theme: 11 } });
      // The theme: Office's colours, with a green hyperlink colour and a purple followed one.
      s.transact([{ type: "restore", workbook: { ...s.state, themeColors: [...officeThemeColors(), "#2e7d32", "#7b1fa2"] } }]);
      readMe(s, "Subtotals, more", this.see);
      return s;
    },
  },
  {
    file: "35-tables-sort.xlsx",
    title: "Tables: a sort by several columns, by colour and by icon, and a slicer in a style of your own",
    see: [
      "Excel should open this without a repair message (both sheets).",
      "Orders sheet: the table 'Orders' (A1:D9) is already in sorted order. From the top its rows read: East Ink 9 150; East Paper 4 40; North Paper 3 30; North Pens 7 90; South Pens 8 100; South Ink 6 60; West Pens 10 120; West Ink 2 25. The Qty cells of East Paper, North Paper and West Ink have a pink fill, the Item cells of the three Ink rows have dark red text, and the Total column shows arrows (green up for 100 and over, yellow sideways for 50 to 99, red down below 50).",
      "Click a cell in the table and choose Data > Sort. The dialog should list four levels: 1. Region, Cell Values, A to Z. 2. Total, Cell Icon (the green up arrow), On Top. 3. Qty, Cell Color (pink), On Top. 4. Item, Font Color (dark red), On Top. If a level is missing, is on another column or shows another colour or icon, write down what it showed.",
      "Press OK in the Sort dialog without changing anything: the rows should stay in the order above. Then sort Qty from largest to smallest and choose Data > Sort again to see the dialog follow the change.",
      "Slicers sheet: the table 'Regions' has one slicer for Region (at D1) in a slicer style of your own called 'Harbor': a pale blue slicer with a dark blue heading and white bold heading text; with nothing chosen all four buttons show as chosen (a mid blue fill, white bold text). Click West: the other buttons turn pale blue with dark blue text. Slicer > Slicer Styles should list 'Harbor' under Custom, and right-click > Modify should show its parts.",
      "Saved again by Excel, the file should still have a four-level sort on Orders and the style 'Harbor' (the kit's report counts them as tableSortLevels 4, colourSortLevels 3 and slicerStyles 1).",
    ],
    build() {
      const s = fresh("Tables sort", ["Orders", "Slicers"]);
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
      s.addSlicer("Slicers", { table: "Regions", column: "Region", style: "Harbor", from: { row: 1, col: 4 } });
      readMe(s, "Tables, sorted", this.see);
      return s;
    },
  },
  {
    file: "32-filter-views.xlsx",
    title: "Filter views: Excel's named sheet views, with the filters of the sheet and of a table",
    see: [
      "The file opens with no message about repairing it. Named sheet views are a newer extension (a part called namedSheetViews); a message, or the Team sheet losing its filter buttons, is the first thing to write down.",
      "Team sheet, as it opens: the AutoFilter on A1:C9 has Team filtered to red (only Fay 45, Ann 30 and Cy 20 show, largest first) and the table Stock (A12:C20, below the list) has Region filtered to east. Both are ordinary filters Excel has always had; they are the state the views start from.",
      "Where Excel has sheet views (View > Sheet View in Excel for the web and Microsoft 365; the box may not be there in an older Excel or on Mac): the list should hold three views, 'Reds, biggest first', 'Blue or green' and 'Everything'. Write down whether the list is there at all, and the names it shows.",
      "Pick 'Reds, biggest first': Team red and the amounts largest to smallest (Fay 45, Ann 30, Cy 20), and Stock east with Qty largest to smallest. Pick 'Blue or green': Team blue or green with an Amount over 10 (Di 40, Gus 15 and Bo 12 show), and Stock with its Qty in the top 3 (9, 8 and 7: ink, map, cap). Pick 'Everything': no filter on either. The sheet's own filter (the state the file opened in) is what other people see while you look at a view.",
      "If Excel has no sheet views, just close the file and open it again: its AutoFilter and table filters are as in line 2, and saving a copy and reading it back with the kit ('pnpm excel-check:read') will tell whether Excel kept the namedSheetViews part (the filterViews count in REPORT.md).",
      "Google Sheets: it has its own filter views, in another format, so it shows only the filter that was in force when the file was saved (Team red on the sheet, Region east on the table). Write down what it did.",
    ],
    build() {
      const s = fresh("Filter views", ["Team"]);
      s.setValues("Team", "A1", [
        ["Name", "Team", "Amount"],
        ["Ann", "red", 30],
        ["Bo", "blue", 12],
        ["Cy", "red", 20],
        ["Di", "blue", 40],
        ["Ed", "green", 5],
        ["Fay", "red", 45],
        ["Gus", "green", 15],
        ["Hal", "blue", 8],
      ]);
      s.setValues("Team", "A12", [
        ["Item", "Region", "Qty"],
        ["pen", "east", 3],
        ["ink", "west", 9],
        ["pad", "east", 1],
        ["cap", "west", 7],
        ["tin", "north", 4],
        ["map", "east", 8],
        ["jar", "south", 6],
        ["cup", "east", 2],
      ]);
      s.setStyle("Team", "A1:C1", { bold: true, fill: "#dce6f2" });
      s.setStyle("Team", "A12:C12", { bold: true });
      s.setFilter("Team", "A1:C9");
      s.createTable("Team", "A12:C20", { name: "Stock" });
      // 'Reds, biggest first': Team red, Amount largest first, and Stock east with the biggest quantities first.
      s.filterColumn("Team", 2, ["red"]);
      s.filterTable("Stock", "Region", ["east"]);
      s.sortTable("Stock", "Qty", "descending");
      s.saveFilterView("Team", "Reds, biggest first", { sort: { column: 3, descending: true } });
      // 'Blue or green': Team blue or green, Amount over 10, and the three biggest quantities of Stock.
      s.filterColumn("Team", 2, ["blue", "green"]);
      s.filterColumnRule("Team", 3, { kind: "custom", a: { op: "greaterThan", value: 10 } });
      s.filterTable("Stock", "Region", null);
      s.filterTableRule("Stock", "Qty", { kind: "top", n: 3 });
      s.saveFilterView("Team", "Blue or green");
      // 'Everything': the filter and the table with nothing let through or taken out.
      s.filterColumn("Team", 2, null);
      s.filterColumnRule("Team", 3, null);
      s.filterTableRule("Stock", "Qty", null);
      s.saveFilterView("Team", "Everything");
      // The file opens in the state of the first view, made the sheet's own (which sorts the amounts and hides the other rows).
      s.applyFilterView("Team", "Reds, biggest first");
      readMe(s, "Filter views (Excel's named sheet views)", this.see);
      return s;
    },
  },
  {
    file: "33-formatting-rest.xlsx",
    title: "Formatting, the rest: every kind of conditional format, rules that point at other sheets, merges, and rules on selected cells of a pivot table",
    see: [
      "Excel should open this without a repair message. If it does repair, write down the sheet it names and whether the data bars or the pivot rules are what it dropped (Conditional Formatting > Manage Rules, This Worksheet, shows what is left).",
      "Compare sheet. The numbers 5, 12, 18, 25, 31, 47, 52, 66, 80, 95 are in every column. A: 52, 66, 80 and 95 have a light red fill and dark red text (greater than 50). B: 25, 31, 47 and 52 are yellow (between 20 and 60). C: only 47 is bold green (equal to 47). D: 66, 80 and 95 are blue (top 3). E: 5 and 12 are blue (bottom 20 percent). F: 47, 52, 66, 80 and 95 are orange (above the average, 43.1). G: only 80 and 95 are purple (more than one standard deviation above the average). H and I show two rules on the same cells: in H the first rule (red fill over 50) has Stop If True, so 80 and 95 are red and not bold; in I there is no stop, so 80 and 95 are bold as well as red.",
      "Text sheet. A: Apple, Pineapple and apple pie are bold (contain app). B: Apple, Apricot and apple pie are green (begin with Ap). C: Apple, Grape, Pineapple and apple pie are italic (end with e). D: Banana, Apricot and Avocado are underlined (do not contain e). E: every second row, starting at row 2, is grey (a formula rule, =MOD(ROW(E2),2)=0).",
      "Blanks sheet. A holds 1, an empty cell, 3, #DIV/0! and x. Column A: the empty cell is grey and the error is bold red. Column B repeats it: every cell but the empty one is light green (cells that are not blank), and column C shows every cell but the error in italic (cells without errors; the empty cell counts). D and E hold 3, 1, 3, 4, 2, 2, 5, 3, 6, 7: D has the repeated values (3 three times and 2 twice) in orange, E the values that appear once (1, 4, 5, 6, 7) in green.",
      "Dates sheet. Column A has the dates of 40 days ago, 8 days ago, yesterday, today, tomorrow, 8 days ahead and 40 days ahead. B, C and D highlight only yesterday, only today and only tomorrow. E (last 7 days) highlights yesterday and today. F, G and H (this week, last week, next week; weeks start on Sunday) and I, J and K (this month, last month, next month) highlight the dates that fall in that week or month: check them against the calendar.",
      "Scales sheet. A: a two-colour scale from white at 5 to green at 95. B: a three-colour scale, red at the lowest, yellow at the 50th percentile and green at the highest. C: a scale whose middle is the number 40 and whose ends are the 10th and 90th percentiles. D to I are data bars on the same numbers: D the default gradient, E solid blue, F with an outline, G with the numbers -30, -10, 0, 20, 40, 60, 80, 100, 120, 150 and a red bar for the negative ones, the zero line (grey) in the middle of the cell, H with bars growing from the right, I with bars from 0 to 100 that take 20 to 80 percent of the cell's width, and no numbers shown. Open Manage Rules on D to I and look at the Bar Appearance and Negative Value and Axis dialogs.",
      "Icons sheet. Each column holds 5, 12, 18, 25, 31, 47, 52, 66, 80, 95. A: 3 arrows (5 to 31 red down, 47 and 52 yellow sideways, 66 and over green up: the steps are 33 and 67 percent); B: 3 traffic lights; C: 4 ratings; D: 5 quarters; E: 3 stars, F: 3 triangles and G: 5 boxes (the three sets new in Excel 2010); H: 3 arrows in reverse order; I: 3 arrows with the numbers hidden; J: the icons picked one by one (the first five numbers a red flag, 47 and 52 no icon, 66 and over a full five-bar rating); K: 3 traffic lights whose steps are the numbers 30 and 60 (5 to 25 red, 31 to 52 yellow, 66 and over green).",
      "Other sheets. Sheet Limits holds 50, 70, 80 and 20 in A1:A4. On sheet Linked, column A has a rule 'cell value greater than Limits!$A$1' (values over 50 red), column B the formula rule =B2>Limits!$A$2 (values over 70 blue), column C a data bar whose end is Limits!$A$3 (80) and column D a 3-arrow icon set whose second step is Limits!$A$4 (20): 5, 12 and 18 get the down arrow, 25 to 52 the sideways one, 66 and over the up one. Excel 2010 and later accept these; Manage Rules should show the formulas as written. Say what Excel did if it refused them.",
      "Merges sheet. A1:C1 is merged and centred (Report), A3:A5 is merged vertically (Side), B3:C4 is merged (Block), E3:G3 is one merged cell, and E5:G5, E6:G6 and E7:G7 are three merged cells, one per row (Merge Across). None overlaps another, and the table in A10:C12 has no merged cell (Excel does not allow one there).",
      "Pivot sheet. The pivot table has Region and Product down the side and Qty and Sales across. Rule 1 (red fill) covers the Sales cells at the Product level only; rule 2 (bold) covers only the cells under the West region, both Qty and Sales, including West's subtotal (a rule for selected cells that names the items West). Click a West cell and open Manage Rules with the scope set to this PivotTable: rule 2 should say it applies to the selected cells. Refresh the pivot table after changing the source: both rules should follow the table.",
    ],
    build() {
      const s = fresh("Formatting, the rest", ["Compare", "Text", "Blanks", "Dates", "Scales", "Icons", "Limits", "Linked", "Merges", "Orders", "Pivot"]);
      const N = [5, 12, 18, 25, 31, 47, 52, 66, 80, 95];
      const column = (sheet: string, col: string, head: string, values: (number | string | null)[]) => {
        s.setValues(sheet, `${col}1`, [[head]]);
        s.setStyle(sheet, `${col}1`, { bold: true });
        s.setColumnWidth(sheet, col.charCodeAt(0) - 64, 16);
        values.forEach((v, i) => v !== null && s.setValues(sheet, `${col}${i + 2}`, [[v]]));
      };
      const red = { fill: "#ffc7ce", color: "#9c0006" };
      // ---- Compare ----
      const compare = ["Greater than 50", "Between 20 and 60", "Equal to 47", "Top 3", "Bottom 20%", "Above average", "1 deviation above", "Stop if true", "No stop"];
      compare.forEach((h, i) => column("Compare", String.fromCharCode(65 + i), h, N));
      s.addRule("Compare", { kind: "cell", op: "greaterThan", values: ["50"], ranges: ["A2:A11"], style: red });
      s.addRule("Compare", { kind: "cell", op: "between", values: ["20", "60"], ranges: ["B2:B11"], style: { fill: "#ffeb9c" } });
      s.addRule("Compare", { kind: "cell", op: "equal", values: ["47"], ranges: ["C2:C11"], style: { bold: true, color: "#006100" } });
      s.addRule("Compare", { kind: "top", rank: 3, ranges: ["D2:D11"], style: { fill: "#bdd7ee" } });
      s.addRule("Compare", { kind: "top", rank: 20, percent: true, bottom: true, ranges: ["E2:E11"], style: { fill: "#bdd7ee" } });
      s.addRule("Compare", { kind: "average", above: true, ranges: ["F2:F11"], style: { fill: "#f8cbad" } });
      s.addRule("Compare", { kind: "average", above: true, stdDev: 1, ranges: ["G2:G11"], style: { fill: "#d9c3e8" } });
      s.addRule("Compare", { kind: "cell", op: "greaterThan", values: ["50"], ranges: ["H2:H11"], style: { fill: "#ffc7ce" }, stop: true });
      s.addRule("Compare", { kind: "cell", op: "greaterThan", values: ["70"], ranges: ["H2:H11"], style: { bold: true } });
      s.addRule("Compare", { kind: "cell", op: "greaterThan", values: ["50"], ranges: ["I2:I11"], style: { fill: "#ffc7ce" } });
      s.addRule("Compare", { kind: "cell", op: "greaterThan", values: ["70"], ranges: ["I2:I11"], style: { bold: true } });
      // ---- Text ----
      const T = ["Apple", "Banana", "Apricot", "Cherry", "Grape", "Pineapple", "Blueberry", "Avocado", "apple pie", "Lemon"];
      ["Contains app", "Begins with Ap", "Ends with e", "Does not contain e", "Every second row"].forEach((h, i) => column("Text", String.fromCharCode(65 + i), h, T));
      s.addRule("Text", { kind: "text", op: "contains", text: "app", ranges: ["A2:A11"], style: { bold: true } });
      s.addRule("Text", { kind: "text", op: "beginsWith", text: "Ap", ranges: ["B2:B11"], style: { fill: "#c6efce" } });
      s.addRule("Text", { kind: "text", op: "endsWith", text: "e", ranges: ["C2:C11"], style: { italic: true } });
      s.addRule("Text", { kind: "text", op: "notContains", text: "e", ranges: ["D2:D11"], style: { underline: true } });
      s.addRule("Text", { kind: "formula", formula: "MOD(ROW(E2),2)=0", ranges: ["E2:E11"], style: { fill: "#d9d9d9" } });
      // ---- Blanks ----
      for (const c of ["A", "B", "C"]) {
        s.setValues("Blanks", `${c}1`, [[c === "A" ? "Blanks and errors" : c === "B" ? "Not blank" : "No errors"]]);
        s.setValues("Blanks", `${c}2`, [[1]]);
        s.setValues("Blanks", `${c}4`, [[3]]);
        s.setValues("Blanks", `${c}5`, [["=1/0"]]);
        s.setValues("Blanks", `${c}6`, [["x"]]);
        s.setStyle("Blanks", `${c}1`, { bold: true });
        s.setColumnWidth("Blanks", c.charCodeAt(0) - 64, 18);
      }
      s.addRule("Blanks", { kind: "blanks", ranges: ["A2:A6"], style: { fill: "#d9d9d9" } });
      s.addRule("Blanks", { kind: "errors", ranges: ["A2:A6"], style: { bold: true, color: "#c00000" } });
      s.addRule("Blanks", { kind: "noBlanks", ranges: ["B2:B6"], style: { fill: "#c6efce" } });
      s.addRule("Blanks", { kind: "noErrors", ranges: ["C2:C6"], style: { italic: true } });
      column("Blanks", "D", "Duplicates", [3, 1, 3, 4, 2, 2, 5, 3, 6, 7]);
      column("Blanks", "E", "Unique", [3, 1, 3, 4, 2, 2, 5, 3, 6, 7]);
      s.addRule("Blanks", { kind: "duplicates", ranges: ["D2:D11"], style: { fill: "#f8cbad" } });
      s.addRule("Blanks", { kind: "uniques", ranges: ["E2:E11"], style: { fill: "#c6efce" } });
      // ---- Dates ----
      const days = [-40, -8, -1, 0, 1, 8, 40];
      const periods = [["Dates", null], ["Yesterday", "yesterday"], ["Today", "today"], ["Tomorrow", "tomorrow"], ["Last 7 days", "last7Days"], ["This week", "thisWeek"], ["Last week", "lastWeek"], ["Next week", "nextWeek"], ["This month", "thisMonth"], ["Last month", "lastMonth"], ["Next month", "nextMonth"]] as const;
      periods.forEach(([head, period], i) => {
        const col = String.fromCharCode(65 + i);
        s.setValues("Dates", `${col}1`, [[head]]);
        s.setStyle("Dates", `${col}1`, { bold: true });
        s.setColumnWidth("Dates", i + 1, 13);
        days.forEach((d, j) => {
          s.setValues("Dates", `${col}${j + 2}`, [[`=TODAY()${d < 0 ? d : d > 0 ? `+${d}` : ""}`]]);
          s.setFormat("Dates", `${col}${j + 2}`, "yyyy-mm-dd");
        });
        if (period) s.addRule("Dates", { kind: "dates", period, ranges: [`${col}2:${col}8`], style: { fill: "#ffe699" } });
      });
      // ---- Scales ----
      const heads = ["Two colours", "Three colours", "Mixed points", "Gradient bar", "Solid bar", "Outlined bar", "Negatives", "From the right", "Short bar, no numbers"];
      heads.forEach((h, i) => column("Scales", String.fromCharCode(65 + i), h, i === 6 ? [-30, -10, 0, 20, 40, 60, 80, 100, 120, 150] : N));
      s.addRule("Scales", { kind: "colorScale", ranges: ["A2:A11"], stops: [{ type: "min", color: "#ffffff" }, { type: "max", color: "#63be7b" }] });
      s.addRule("Scales", { kind: "colorScale", ranges: ["B2:B11"], stops: [{ type: "min", color: "#f8696b" }, { type: "percentile", value: 50, color: "#ffeb84" }, { type: "max", color: "#63be7b" }] });
      s.addRule("Scales", { kind: "colorScale", ranges: ["C2:C11"], stops: [{ type: "percentile", value: 10, color: "#5a8ac6" }, { type: "num", value: 40, color: "#ffffff" }, { type: "percentile", value: 90, color: "#f8696b" }] });
      s.addRule("Scales", { kind: "dataBar", ranges: ["D2:D11"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" });
      s.addRule("Scales", { kind: "dataBar", ranges: ["E2:E11"], min: { type: "min" }, max: { type: "max" }, color: "#2f6fbf", solid: true });
      s.addRule("Scales", { kind: "dataBar", ranges: ["F2:F11"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", solid: true, border: true, borderColor: "#1f3a68" });
      s.addRule("Scales", { kind: "dataBar", ranges: ["G2:G11"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", negativeColor: "#ff0000", axis: "middle", axisColor: "#7f7f7f" });
      s.addRule("Scales", { kind: "dataBar", ranges: ["H2:H11"], min: { type: "min" }, max: { type: "max" }, color: "#63be7b", rtl: true });
      s.addRule("Scales", { kind: "dataBar", ranges: ["I2:I11"], min: { type: "num", value: 0 }, max: { type: "num", value: 100 }, color: "#ffb628", minLength: 20, maxLength: 80, hideValue: true });
      // ---- Icons ----
      type IconRule = Extract<Parameters<SheetSession["addRule"]>[1], { kind: "iconSet" }>;
      const icon = (col: string, rule: Omit<IconRule, "kind" | "ranges">) => s.addRule("Icons", { kind: "iconSet", ranges: [`${col}2:${col}11`], ...rule });
      const even = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ type: "percent" as const, value: Math.round(((i + 1) * 100) / n) }));
      ["3 arrows", "3 traffic lights", "4 ratings", "5 quarters", "3 stars", "3 triangles", "5 boxes", "Reversed", "No numbers", "Your own", "Numbers as steps"].forEach((h, i) => column("Icons", String.fromCharCode(65 + i), h, N));
      icon("A", { set: "3Arrows", thresholds: [{ type: "percent", value: 33 }, { type: "percent", value: 67 }] });
      icon("B", { set: "3TrafficLights1", thresholds: even(3) });
      icon("C", { set: "4Rating", thresholds: even(4) });
      icon("D", { set: "5Quarters", thresholds: even(5) });
      icon("E", { set: "3Stars", thresholds: even(3) });
      icon("F", { set: "3Triangles", thresholds: even(3) });
      icon("G", { set: "5Boxes", thresholds: even(5) });
      icon("H", { set: "3Arrows", thresholds: even(3), reverse: true });
      icon("I", { set: "3Arrows", thresholds: even(3), hideValue: true });
      icon("J", { set: "3Arrows", thresholds: even(3), custom: [{ set: "3Flags", index: 0 }, null, { set: "5Rating", index: 4 }] });
      icon("K", { set: "3TrafficLights1", thresholds: [{ type: "num", value: 30 }, { type: "num", value: 60 }] });
      // ---- Rules that point at other sheets ----
      s.setValues("Limits", "A1", [[50], [70], [80], [20]]);
      ["Over the first limit", "Formula, second limit", "Bar to the third limit", "Icons, fourth limit"].forEach((h, i) => column("Linked", String.fromCharCode(65 + i), h, N));
      s.addRule("Linked", { kind: "cell", op: "greaterThan", values: ["Limits!$A$1"], ranges: ["A2:A11"], style: red });
      s.addRule("Linked", { kind: "formula", formula: "B2>Limits!$A$2", ranges: ["B2:B11"], style: { fill: "#bdd7ee" } });
      s.addRule("Linked", { kind: "dataBar", ranges: ["C2:C11"], min: { type: "num", value: 0 }, max: { type: "formula", value: "Limits!$A$3" }, color: "#638ec6" });
      s.addRule("Linked", { kind: "iconSet", ranges: ["D2:D11"], set: "3Arrows", thresholds: [{ type: "formula", value: "Limits!$A$4" }, { type: "percent", value: 67 }] });
      // ---- Merges ----
      s.setValues("Merges", "A1", [["Report"]]);
      s.setValues("Merges", "A3", [["Side"]]);
      s.setValues("Merges", "B3", [["Block"]]);
      s.setValues("Merges", "E3", [["Across 1", "x", "y"], [], ["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
      s.mergeCells("Merges", "A1:C1", { center: true });
      s.mergeCells("Merges", "A3:A5");
      s.mergeCells("Merges", "B3:C4");
      s.mergeCells("Merges", "E3:G3");
      s.mergeCells("Merges", "E5:G7", { across: true });
      s.setValues("Merges", "A10", [["Name", "Qty", "Price"], ["Pens", 4, 2], ["Ink", 7, 5]]);
      s.createTable("Merges", "A10:C12");
      // ---- Pivot ----
      s.setValues("Orders", "A1", [["Region", "Product", "Qty", "Sales"], ["East", "Apple", 10, 100], ["East", "Pear", 5, 40], ["West", "Apple", 7, 70], ["West", "Pear", 3, 33], ["North", "Plum", 14, 44]]);
      const p = s.createPivot("Pivot", { source: "Orders!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"] });
      s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style: { fill: "#ffc7ce" }, pivot: { id: p.id, value: 1, rows: "Product" } });
      s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style: { bold: true }, pivot: { id: p.id, items: { Region: ["West"] } } });
      readMe(s, "Formatting, the rest", this.see);
      return s;
    },
  },
  {
    file: "34-validation-more.xlsx",
    title: "Data validation: formulas that read another workbook, fill carrying the rule, a separator for dropdown cells",
    see: [
      "Excel should open this without a repair message. It will probably show a bar saying links to other workbooks are disabled: the file reads Prices.xlsx, which is not part of the kit. Choose Don't Update (or leave the bar alone); the values are the copy Pli kept in the file, and Data > Queries & Connections > Edit Links should list one source, Prices.xlsx.",
      "Links sheet, F2:F4 are cell formulas that read Prices.xlsx: F2 is [Prices.xlsx]Sheet1!B2*2 and shows 5, F3 is SUM(Cost) and shows 18.5 (Cost is a defined name for [Prices.xlsx]Sheet1!$B$2:$B$4: Formulas > Name Manager should list it with a reference into Prices.xlsx), F4 is a VLOOKUP of Paper in [Prices.xlsx]Sheet1!A2:B4 and shows 4. Excel may write the file's folder in front of Prices.xlsx; that is fine.",
      "Links sheet, B2:B4 take a number between the cheapest and the dearest price in Prices.xlsx (2.5 and 12). Data > Data Validation on B3 should say Decimal, between, minimum [Prices.xlsx]Sheet1!$B$2, maximum [Prices.xlsx]Sheet1!$B$4, and the error message 'Between the cheapest and the dearest price in Prices.xlsx'. B2:B4 hold 3, 5 and 11, which pass. Pli keeps this rule in the sheet's extension list (x14 data validations), which Excel 2010 and later read.",
      "Links sheet, C2:C4 take only an item that is in column A of Prices.xlsx (Pens, Paper, Ink). Data Validation on C2 should say Custom, with a formula that counts C2 in [Prices.xlsx]Sheet1!$A$2:$A$4 (COUNTIF(...)>0), and the error alert style Warning. C2 holds Pens, C3 Ink and C4 Glue, which is not in the list, so Data > Data Validation > Circle Invalid Data should circle C4 and nothing else on the sheet.",
      "Links sheet, D2:D4 are a list whose source is the defined name Items (which points at [Prices.xlsx]Sheet1!$A$2:$A$4): Data Validation on D2 should say List with the source =Items, and the arrow should offer Pens, Paper, Ink.",
      "Fill sheet: these rules were made by filling, as Excel's Fill Down and fill handle do. B2:B8 is one rule, whole number between 1 and 10, carried down from B2: Data Validation on B8 says the same as on B2. D2:D6 is one list rule (source Lists!$A$1:$A$3, so Red, Green, Blue) carried by the fill handle. E2:E6 is a custom rule E2<=F2 filled down: Data Validation on E4 should show =E4<=F4. H3:H6 is a custom rule that was made on H6 as H6>=I6 and filled upward: Data Validation on H4 should show =H4>=I4. Circle Invalid Data on this sheet should circle exactly E4 (99 is above its limit 30) and H6 (8 is under its limit 10).",
      "Tags sheet: A2:A4 are Pli dropdown cells that take several choices with '; ' between them (A2 holds 'Red; Green', A3 'Blue', A4 'Green; Blue; Red'). Excel has no such setting, so it shows an ordinary dropdown of Red, Green, Blue with no alert: pick one from the arrow, and typing 'Red; Green' is accepted without a message. B2:B3 are another dropdown (Low, High) with '/' as the separator (B2 holds 'Low/High'). D2 is a plain dropdown (Yes, No) for comparison. Pli keeps the several-choices setting and the separator in an extension Excel ignores, so a file saved from Excel loses them: that is expected.",
      "Save the file from Excel and run `pnpm excel-check:read`: it should still count 7 validations (3 on Links and 4 on Fill) and the kit should report nothing to look at. If Excel dropped the rules or formulas that read Prices.xlsx, tell me which: those parts have not been opened in Excel before.",
    ],
    build() {
      const s = fresh("More validation", ["Links", "Fill", "Tags", "Lists"]);
      s.setValues("Lists", "A1", [["Red"], ["Green"], ["Blue"]]);
      // What a host read from Prices.xlsx; the file itself is not part of the kit.
      s.setExternalCells("Prices.xlsx", "Sheet1", { A1: "Item", B1: "Price", A2: "Pens", B2: 2.5, A3: "Paper", B3: 4, A4: "Ink", B4: 12 }, { path: "Prices.xlsx", read: "2025-12-09" });
      s.defineName("Cost", "[Prices.xlsx]Sheet1!$B$2:$B$4");
      s.defineName("Items", "[Prices.xlsx]Sheet1!$A$2:$A$4");
      s.setValues("Links", "A1", [["Reads Prices.xlsx", "Price", "Item", "Pick", "", "Formulas"]]);
      s.setStyle("Links", "A1:F1", { bold: true });
      s.setColumnWidth("Links", 1, 20);
      s.setColumnWidth("Links", 6, 14);
      s.setCells("Links", { B2: 3, B3: 5, B4: 11, C2: "Pens", C3: "Ink", C4: "Glue" });
      s.setCells("Links", { F2: "=[Prices.xlsx]Sheet1!B2*2", F3: "=SUM(Cost)", F4: '=VLOOKUP("Paper",[Prices.xlsx]Sheet1!A2:B4,2,FALSE)' });
      s.addValidation("Links", { kind: "decimal", op: "between", values: ["[Prices.xlsx]Sheet1!$B$2", "[Prices.xlsx]Sheet1!$B$4"], ranges: ["B2:B4"], error: "Between the cheapest and the dearest price in Prices.xlsx" });
      s.addValidation("Links", { kind: "custom", formula: "COUNTIF([Prices.xlsx]Sheet1!$A$2:$A$4,C2)>0", ranges: ["C2:C4"], alert: "warning" });
      s.addValidation("Links", { kind: "list", source: "Items", ranges: ["D2:D4"] });

      s.setValues("Fill", "A1", [["Made by filling", "Whole 1 to 10", "", "List", "E<=F", "Limit", "", "H>=I", "Limit"]]);
      s.setStyle("Fill", "A1:I1", { bold: true });
      s.setColumnWidth("Fill", 1, 16);
      s.addValidation("Fill", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2"] });
      s.setCell("Fill", "B2", 4);
      s.fill("Fill", "B2:B8", "down");
      s.addValidation("Fill", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["D2"] });
      s.setCell("Fill", "D2", "Red");
      s.autofill("Fill", "D2", "D2:D6");
      s.setValues("Fill", "F2", [[10], [20], [30], [40], [50]]);
      s.addValidation("Fill", { kind: "custom", formula: "E2<=F2", ranges: ["E2"] });
      s.setCell("Fill", "E2", 5);
      s.fill("Fill", "E2:E6", "down");
      s.setCells("Fill", { E3: 15, E5: 35, E6: 45 });
      s.setCell("Fill", "E4", 99, { validate: false });
      s.setValues("Fill", "I3", [[1], [2], [3], [10]]);
      s.addValidation("Fill", { kind: "custom", formula: "H6>=I6", ranges: ["H6"] });
      s.setCell("Fill", "H6", 8, { validate: false });
      s.autofill("Fill", "H6", "H3:H6");
      s.setCells("Fill", { H3: 5, H4: 6, H5: 7 });

      s.setValues("Tags", "A1", [["Several, ; between", "Low or High, / between", "", "Yes or No"]]);
      s.setStyle("Tags", "A1:D1", { bold: true });
      s.setColumnWidth("Tags", 1, 22);
      s.setColumnWidth("Tags", 2, 22);
      s.setControl("Tags", "A2:A4", { type: "dropdown", options: [{ value: "Red" }, { value: "Green" }, { value: "Blue" }], multiple: true, separator: "; ", strict: true });
      s.setCells("Tags", { A2: "Red; Green", A3: "Blue", A4: "Green; Blue; Red" });
      s.setControl("Tags", "B2:B3", { type: "dropdown", options: [{ value: "Low" }, { value: "High" }], multiple: true, separator: "/" });
      s.setCells("Tags", { B2: "Low/High", B3: "High" });
      s.setControl("Tags", "D2", { type: "dropdown", options: [{ value: "Yes" }, { value: "No" }] });
      s.setCell("Tags", "D2", "Yes");
      readMe(s, "More validation", this.see);
      return s;
    },
  },
  {
    file: "31-charts-axes.xlsx",
    title: "Charts: axis scales, log axes, gridlines and ticks, error bars, bin edges, quartiles and the rest",
    see: [
      "Excel should open this without a repair message and show 21 charts on the Charts sheet, in rows of four (the last one alone in the sixth row). A chart that is missing, or any message about unreadable content, is the finding: say which chart.",
      "Row 1 (axes). 'Fixed scale': columns on a value axis that runs from 0 to 1,000 in steps of 250, with minor gridlines and cross tick marks (Format Axis shows Minimum 0, Maximum 1000, Major 250, Minor 50). 'Log scale': a line chart on a logarithmic value axis, base 10, from 1 to 1,000 (Format Axis > Logarithmic scale ticked), with the months listed from the right (Categories in reverse order ticked). 'Bar reversed': bars whose value axis runs from the high end to the low end and has no gridlines. 'Crossing': columns whose horizontal axis crosses the value axis at 20 (Format Axis > Horizontal axis crosses > Axis value 20), the month labels at the bottom (Label position Low), and columns hanging from that crossing.",
      "Row 2 (more axes). 'Scatter scale': a scatter chart whose horizontal axis is 0 to 6 in steps of 2, with vertical gridlines and value labels on the high side (right) of the plot. 'Intervals': columns with a label on every second month and a tick mark on every second month (Format Axis > Labels > Interval between labels: Specify 2). 'Number format': value labels like $250.0 (Format Axis > Number > Format code $#,##0.0, Linked to source off). 'Hidden axis': columns with no value axis (it was deleted) but the gridlines still there.",
      "Row 3 (error bars, Chart Design > Add Chart Element > Error Bars > More Error Bars Options shows the kind). 'Fixed bars': columns with a fixed value of 5 on both sides and end caps. 'Percentage': a line chart with 10% bars on the plus side only, no caps. 'Custom': a line chart whose bars take the plus amounts from Data!C2:C6 and the minus amounts from Data!D2:D6 (Custom > Specify Value shows those two ranges). 'Scatter bars': a scatter chart with fixed bars of 1 along x and a standard deviation bar along y.",
      "Standard deviation and standard error: the 'Scatter bars' chart's y values are Data!B2:B6 = 10, 150, 120, 20, 900. With a multiplier of 1, Pli draws the population standard deviation (=STDEV.P(Data!B2:B6)) and has not been checked against Excel. Select one y error bar and read its length against the value axis, or hover it: if Excel's bar is as long as =STDEV.S(Data!B2:B6) instead, say so. For 'Standard error' (Custom check in the same way) Pli uses STDEV.S/SQRT(5).",
      "Row 4 (pies and stock). 'Pie angle': a pie that starts at 120 degrees (Format Data Series > Angle of first slice 120), with the whole series pulled out 15% and the second slice pulled out 40%. 'Doughnut angle': a doughnut that starts at 270 degrees. 'Pie of pie custom': a pie of pie where the second pie holds exactly the points January and April (Format Data Series > Split Series By > Custom). 'Stock look': an open-high-low-close chart with green up bodies, red down bodies, a 60% gap, and no high-low lines.",
      "Row 5 (the Excel 2016 kinds). 'Histogram bins': a histogram of Data!P2:P21 with Number of bins 6 and an underflow bin at 2 and an overflow bin at 14 (Format Axis > Bins: Number of bins 6, Overflow bin 14, Underflow bin 2). Excel counts the overflow and underflow bins among the 6, so the middle bins are four, each 3 wide: read the bin labels and the counts on hover and say whether they are an underflow bin (2 or less: 3 values), (2, 5] with 6, (5, 8] with 2, (8, 11] with 3, (11, 14] with 4 and an overflow bin (above 14: 2 values); if Excel instead cuts six bins between the limits, say so. 'Two histograms': Data!P and Data!Q side by side. 'Box quartiles': box and whisker of Data!Y2:Y9 (eight values: 2 3 5 7 8 11 13 40) with the inclusive median option; hover the box: Excel's QUARTILE.INC gives Q1 4.5 and Q3 11.5, the exclusive method (QUARTILE.EXC) gives 3.5 and 12.5, and a median-of-each-half rule would give 4 and 12. Say which numbers Excel shows for each of the two settings (Format Data Series > Quartile Calculation). 'Waterfall options': a waterfall without connector lines, labels inside the end, the value axis from -20 to 120 in steps of 20.",
      "Row 6 ('Sales now', the title in pieces): a column chart whose title reads 'Sales now' with 'Sales' in bold dark red and 'now' in italic underlined; the rest of the chart's text is in Arial.",
      "Google Sheets: write down which charts it shows (it is not expected to draw the Excel 2016 kinds).",
    ],
    build() {
      const s = fresh("Chart axes", ["Data", "Charts"]);
      s.setValues("Data", "A1", [["Month", "Sales", "Err+", "Err-"], ["Jan", 10, 1, 2], ["Feb", 150, 2, 1], ["Mar", 120, 3, 3], ["Apr", 20, 1, 1], ["May", 900, 2, 4]]);
      s.setValues("Data", "P1", [["Score", "Other"], [1, 2], [2, 3], [2, 3], [3, 4], [3, 5], [4, 5], [4, 6], [5, 7], [9, 8], [10, 9], [11, 10], [12, 11], [13, 12], [14, 13], [15, 14], [16, 15], [3, 4], [6, 6], [8, 8], [14, 12]]);
      s.setValues("Data", "X1", [["Pie"], [40], [25], [15], [12], [8]]);
      s.setValues("Data", "Y1", [["Value"], [2], [3], [5], [7], [8], [11], [13], [40]]);
      s.setValues("Data", "AA1", [["Day", "Open", "High", "Low", "Close"], ["Mon", 10, 14, 9, 12], ["Tue", 12, 16, 11, 11], ["Wed", 11, 15, 10, 14], ["Thu", 14, 18, 13, 17], ["Fri", 17, 19, 15, 16]]);
      s.setValues("Data", "AG1", [["Step", "Amount"], ["Start", 100], ["Sales", 40], ["Costs", -30], ["Refunds", -10], ["End", 100]]);
      const D = (c: string, a: number, b: number) => `Data!$${c}$${a}:$${c}$${b}`;
      const cat = D("A", 2, 6);
      const ser = (c: string, extra: object = {}) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 6), ...extra });
      const at = (slot: number) => ({ row: 1 + Math.floor(slot / 4) * 15, col: 1 + (slot % 4) * 8 });
      const add = (slot: number, spec: Parameters<SheetSession["addChart"]>[1]) => s.addChart("Charts", { width: 440, height: 260, from: at(slot), ...spec });
      add(0, { type: "column", title: "Fixed scale", categories: cat, series: [ser("B")], axes: { y: { min: 0, max: 1000, majorUnit: 250, minorUnit: 50, minorGridlines: true, majorTick: "cross", minorTick: "out" } } });
      add(1, { type: "line", title: "Log scale", categories: cat, series: [ser("B")], axes: { y: { log: 10, min: 1, max: 1000 }, x: { reverse: true } } });
      add(2, { type: "bar", title: "Bar reversed", categories: cat, series: [ser("B")], axes: { y: { reverse: true, majorGridlines: false } } });
      add(3, { type: "column", title: "Crossing", categories: cat, series: [ser("B")], axes: { y: { min: 0, max: 1000, majorUnit: 250, crosses: 20 }, x: { labels: "low" } } });
      add(4, { type: "scatter", title: "Scatter scale", series: [{ name: "Sales", x: D("C", 2, 6), values: D("B", 2, 6) }], axes: { x: { min: 0, max: 6, majorUnit: 2 }, y: { labels: "high" } } });
      add(5, { type: "column", title: "Intervals", categories: cat, series: [ser("B")], axes: { x: { labelEvery: 2, tickEvery: 2 } } });
      add(6, { type: "column", title: "Number format", categories: cat, series: [ser("B")], axes: { y: { format: "$#,##0.0" } } });
      add(7, { type: "column", title: "Hidden axis", categories: cat, series: [ser("B")], axes: { y: { hidden: true } } });
      add(8, { type: "column", title: "Fixed bars", categories: cat, series: [ser("B", { errorBars: { y: { kind: "fixed", value: 5 } } })] });
      add(9, { type: "line", title: "Percentage", categories: cat, series: [ser("B", { errorBars: { y: { kind: "percent", value: 10, direction: "plus", endCap: false } } })] });
      add(10, { type: "line", title: "Custom", categories: cat, series: [ser("B", { errorBars: { y: { kind: "custom", plus: D("C", 2, 6), minus: D("D", 2, 6) } } })] });
      add(11, { type: "scatter", title: "Scatter bars", series: [{ name: "Sales", x: D("C", 2, 6), values: D("B", 2, 6), errorBars: { x: { kind: "fixed", value: 1 }, y: { kind: "stdDev" } } }] });
      add(12, { type: "pie", title: "Pie angle", labels: true, firstSliceAngle: 120, categories: cat, series: [{ nameRef: "Data!$X$1", values: D("X", 2, 6), explosion: 15, pointExplosion: { "1": 40 } }] });
      add(13, { type: "doughnut", title: "Doughnut angle", firstSliceAngle: 270, categories: cat, series: [{ nameRef: "Data!$X$1", values: D("X", 2, 6) }] });
      add(14, { type: "pieOfPie", title: "Pie of pie custom", labels: true, split: { by: "custom", at: 0, points: [0, 3] }, categories: cat, series: [{ nameRef: "Data!$X$1", values: D("X", 2, 6) }] });
      add(15, { type: "stock", title: "Stock look", stock: "ohlc", categories: D("AA", 2, 6), stockLook: { hiLowLines: false, upColor: "#00aa00", downColor: "#cc0000", gapWidth: 60 }, series: ["AB", "AC", "AD", "AE"].map((c) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 6) })) });
      add(16, { type: "histogram", title: "Histogram bins", bins: { by: "count", size: 6, underflow: 2, overflow: 14 }, series: [{ nameRef: "Data!$P$1", values: D("P", 2, 21) }] });
      add(17, { type: "histogram", title: "Two histograms", bins: { by: "width", size: 4 }, series: [{ nameRef: "Data!$P$1", values: D("P", 2, 21) }, { nameRef: "Data!$Q$1", values: D("Q", 2, 21) }] });
      add(18, { type: "boxWhisker", title: "Box quartiles", box: { quartile: "inclusive" }, series: [{ nameRef: "Data!$Y$1", values: D("Y", 2, 9), color: "#4472c4" }] });
      add(19, { type: "waterfall", title: "Waterfall options", totals: [0, 4], labels: true, labelPosition: "insideEnd", waterfall: { connectors: false }, categories: D("AG", 2, 6), series: [{ nameRef: "Data!$AH$1", values: D("AH", 2, 6) }], axes: { y: { min: -20, max: 120, majorUnit: 20 } } });
      add(20, { type: "column", title: "Sales now", categories: cat, series: [ser("B")], titleRuns: [{ text: "Sales ", bold: true, color: "#aa0000" }, { text: "now", italic: true, underline: true }], font: { family: "Arial" } });
      readMe(s, "Chart axes, error bars and the rest", this.see);
      return s;
    },
  },
  {
    file: "36-pivots-more.xlsx",
    title: "Pivot tables, the rest 2: other workbooks, several filters on a field, groups inside groups, styles of your own, kept formatting, page fields",
    see: [
      "Open the file and write down first whether Excel says it repaired anything (and what). Then open Data > Queries & Connections / Edit Links: Prices.xlsx should be listed for the Outside sheet (it is a path under /Users/example/, which does not exist; do NOT choose Update).",
      "Outside sheet, FromBook (A1): a pivot table whose source is a range of another workbook, Prices.xlsx Sheet1 A1:C8. Click in it: Analyze > Change Data Source… should show '[Prices.xlsx]Sheet1'!$A$1:$C$8. Sum of Price by Item: Cap 1, Ink 18, Pen 11, grand total 30 (the numbers come from the copy Excel keeps in the file; the file does not refresh on opening). Right-click > Refresh will say it cannot find the workbook: that is expected.",
      "Filters sheet, Multiple (A1): Region on the rows with three things at once: Label Filters > Does Not Equal… South, Value Filters > Greater Than… 50 (Sum of Sales) and the item West unticked in the filter list. Analyze > Options > Totals & Filters should show 'Allow multiple filters per field' ticked. Only East is left (West is unticked, South is excluded, North's 44 is not above 50): East 160, grand total 160. Say how the filter drop-down for Region looks (both Label Filters and Value Filters should show a tick).",
      "Groups sheet, GroupOfGroups (A1): Region3 > Region2 > Region on the rows in tabular form. Region3 has Anywhere (Coasts and North), Region2 has Coasts (East and West) and South alone. Total for Anywhere 307, South 11. The field list should show Region, Region2 and Region3. Ungroup on Anywhere should give back Coasts and North. This is the riskiest part of the file: tell me if the group names or the order are different.",
      "Groups sheet, DateNest (A14): Date grouped by Years, Quarters and Months at once (2024, then Qtr1.., then Jan..). The field list shows Years, Quarters and Date.",
      "Styled sheet, MyStyle (A1): a pivot table style of your own called 'Pli blue' (Design > PivotTable Styles, under Custom): navy headings with white bold text, grey every other row with Banded Rows on, a yellow grand total row, italic labels of the outer items. A cell of the table is yellow and bold (East, Apple): the format was kept by item, so it should still be on the same cell after you drag Region to the columns.",
      "Consolidation sheet, TwoPages (A1): a pivot table made from three ranges with two page fields filled in by hand (Page1: Now, Then; Page2: 2024, 2023). Alt+D, P is not needed: just look at the field list (Row, Column, Value, Page1, Page2) and pick Then in Page1 and 2024 in Page2: Sum of Value should be 110. NoPages (A15) has no page field at all.",
      "Pli only sheet: pivot tables over a data model (two tables, a relationship, measures) and over a named block of CSV data, and one with a distinct count. Excel keeps its data model in a binary part Pli cannot write, so these are ordinary cells in the file (they must look like pivot tables, but Excel shows no PivotTable Analyze tab for them). There must be no repair message about them. Opening the file again in Pli brings the pivot tables back.",
      "Google Sheets: pivot tables are different objects there; it should show the cells as they were saved. Write down what it did.",
    ],
    build() {
      const s = fresh("Pivot tables, the rest 2", ["Orders", "Outside", "Filters", "Groups", "Styled", "Consolidation", "Pli only", "Customers", "Products"]);
      const date = (y: number, m: number, d: number) => dateSerial(y, m, d) ?? 0;
      s.setValues("Orders", "A1", [["Date", "Region", "Product", "Qty", "Sales", "CustomerId", "ProductId"]]);
      const rows: [number, string, string, number, number, number, number][] = [
        [date(2024, 1, 8), "East", "Apple", 10, 100, 10, 100],
        [date(2024, 2, 14), "East", "Pear", 5, 40, 11, 101],
        [date(2024, 5, 3), "West", "Apple", 7, 70, 12, 100],
        [date(2024, 8, 21), "West", "Pear", 3, 33, 10, 101],
        [date(2025, 1, 9), "East", "Apple", 2, 20, 11, 100],
        [date(2025, 4, 20), "North", "Plum", 4, 44, 12, 101],
        [date(2025, 9, 30), "South", "Plum", 1, 11, 10, 100],
      ];
      rows.forEach((row, i) => s.setValues("Orders", `A${i + 2}`, [row]));
      s.setFormat("Orders", "A2:A8", "m/d/yyyy");
      s.setStyle("Orders", "A1:G1", { bold: true, fill: "#dce6f2" });
      s.setValues("Customers", "A1", [["Id", "Name", "Region"], [10, "Ann", "East"], [11, "Bo", "West"], [12, "Cy", "East"], [13, "Di", "North"]]);
      s.setValues("Products", "A1", [["Id", "Title", "Category"], [100, "Pen", "Office"], [101, "Desk", "Furniture"]]);
      const base = { source: "Orders!A1:G8" };
      // Another workbook.
      const outside = "[Prices.xlsx]Sheet1!$A$1:$C$8";
      s.setDataBlock(outside, { rows: [["Item", "Price", "Day"], ["Pen", 2, date(2025, 1, 2)], ["Ink", 9, date(2025, 1, 3)], ["Pen", 3, date(2025, 1, 4)], ["Cap", 1, date(2025, 1, 5)], ["Ink", 9, date(2025, 1, 6)], ["Pen", 6, date(2025, 1, 7)], [null, null, null]], formats: ["", "$0.00", "m/d/yyyy"], path: "file:///Users/example/Prices.xlsx" });
      s.createPivot("Outside", { source: outside, name: "FromBook", anchor: "A1", rows: ["Item"], values: [{ field: "Price", fmt: "$#,##0" }] });
      // Several filters on one field.
      s.createPivot("Filters", { ...base, name: "Multiple", anchor: "A1", rows: [{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "South" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }], hidden: ["West"] }], values: [{ field: "Sales", fmt: "$#,##0" }] });
      // Groups inside groups, and dates grouped three ways.
      const inner = { by: "items" as const, groups: [{ name: "Coasts", items: ["East", "West"] }] };
      const outer = { by: "items" as const, groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: inner };
      s.createPivot("Groups", { ...base, name: "GroupOfGroups", anchor: "A1", rows: [{ field: "Region", group: outer }, { field: "Region", group: inner }, "Region"], values: [{ field: "Sales", fmt: "$#,##0" }], tabular: true });
      s.createPivot("Groups", { ...base, name: "DateNest", anchor: "A14", rows: [{ field: "Date", group: { by: "years" } }, { field: "Date", group: { by: "quarters" } }, { field: "Date", group: { by: "months" } }], values: [{ field: "Sales", fmt: "$#,##0" }], tabular: true });
      // A style of your own, and a look kept on a cell.
      s.setPivotStyle("Pli blue", {
        wholeTable: { border: { bottom: { style: "hair", color: "#999999" } } },
        headerRow: { fill: "#1f3864", color: "#ffffff", bold: true },
        firstRowStripe: { fill: "#e7e6e6" },
        totalRow: { fill: "#ffd966", bold: true },
        firstColumn: { bold: true },
        firstSubtotalRow: { italic: true, fill: "#d9e1f2" },
      });
      const mine = s.createPivot("Styled", { ...base, name: "MyStyle", anchor: "A1", rows: ["Region", "Product"], columns: [], values: [{ field: "Sales", fmt: "$#,##0" }], style: { name: "Pli blue", rowStripes: true } });
      s.createPivot("Styled", { ...base, name: "Kept", anchor: "F1", rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", fmt: "$#,##0" }] });
      s.formatPivot("Styled", s.pivots("Styled")[1]!.id, { part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }] }, { style: { fill: "#ffff00", bold: true } });
      void mine;
      // Page fields you fill in.
      s.setValues("Consolidation", "H1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
      s.setValues("Consolidation", "H6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
      s.setValues("Consolidation", "H11", [["", "Q1", "Q2"], ["East", 100, 200], ["West", 300, 400]]);
      const ranges = [{ source: "Consolidation!H1:J3", names: ["Now", "2024"] }, { source: "Consolidation!H6:J8", names: ["Then", "2024"] }, { source: "Consolidation!H11:J13", names: ["Then", "2023"] }];
      s.createPivot("Consolidation", { source: ranges[0]!.source, ranges, pageFields: 2, name: "TwoPages", anchor: "A1", rows: ["Row"], columns: ["Column"], values: ["Value"], filters: [{ field: "Page1", items: ["Now", "Then"] }, { field: "Page2", items: ["2024", "2023"] }] });
      s.createPivot("Consolidation", { source: "Consolidation!H1:J3", ranges: [{ source: "Consolidation!H1:J3" }, { source: "Consolidation!H6:J8" }], pageFields: 0, name: "NoPages", anchor: "A15", rows: ["Row"], columns: ["Column"], values: ["Value"] });
      // What Excel has no place for.
      s.setDataModel({
        tables: [{ name: "Orders", source: "Orders!A1:G8" }, { name: "Customers", source: "Customers!A1:C5" }, { name: "Products", source: "Products!A1:C3" }],
        relationships: [{ from: { table: "Orders", column: "CustomerId" }, to: { table: "Customers", column: "Id" } }, { from: { table: "Orders", column: "ProductId" }, to: { table: "Products", column: "Id" } }],
        measures: [{ name: "Total sales", table: "Orders", expression: "SUM(Orders[Sales])", fmt: "$#,##0" }, { name: "Customers served", table: "Orders", expression: "DISTINCTCOUNT(Orders[CustomerId])" }, { name: "Per customer", table: "Orders", expression: "[Total sales] / [Customers served]", fmt: "$#,##0.00" }],
      });
      s.createPivot("Pli only", { source: "ThisWorkbookDataModel", name: "Model", anchor: "A1", rows: ["Customers[Region]"], columns: ["Products[Category]"], values: [{ field: "Total sales" }, { field: "Customers served" }] });
      s.importCsv("data:Targets", "Region,Target\nEast,200\nWest,150\nNorth,60\nSouth,20\nEast,30\n");
      s.createPivot("Pli only", { source: "data:Targets", name: "FromCsv", anchor: "A14", rows: ["Region"], values: [{ field: "Target", fmt: "#,##0" }] });
      s.createPivot("Pli only", { ...base, name: "Distinct", anchor: "A24", rows: ["Region"], values: [{ field: "Product", fn: "distinctCount" }] });
      readMe(s, "Pivot tables, the rest 2", this.see);
      return s;
    },
  },
  {
    file: "43-calculated-item-forms.xlsx",
    title: "Calculated items: six ways of writing the same item side by side, to find the one Excel keeps",
    see: [
      "Excel should open this without a repair message. If it repairs, write down which pivot table or cache the log names.",
      "Sheet Variants has six pivot tables over the same data (Region with Sum of Amount), A to F, each with a calculated item Coasts = East + West. Click Data > Refresh All, then look at each: which show a Coasts row (East 175 + West 174 = 349) among East, North, South, West and which show only the four regions? In Excel's copy of file 25 (CalcItem) the Coasts row was missing after the refresh and the item was listed as missing (m=\"1\", u=\"1\"); file 25 has form A.",
      "A is the form file 25 has (Coasts as a shared item, the formula as typed: East + West). B writes the formula the way Excel rewrites it (Region[East]+Region[West]). C leaves Coasts out of the cache's shared items (the item points one past them). D marks the item f=\"1\". E marks the shared item u=\"1\" (unused). F is B and C together. Save the file back into excel-check/back/ and tell me which letters show the Coasts row: the writer will use that form. If none does, write down what Excel shows in Formulas > Calculations > Fields, Items & Sets > List Formulas for A.",
    ],
    build() {
      const s = fresh("Calculated item forms", ["Data", "Variants"]);
      s.setValues("Data", "A1", [["Region", "Amount"], ["East", 100], ["East", 75], ["West", 174], ["North", 90], ["South", 96]]);
      for (const [i, letter] of ["A", "B", "C", "D", "E", "F"].entries()) {
        s.createPivot("Variants", { source: "Data!A1:B6", name: `Item${letter}`, anchor: `${String.fromCharCode(65 + i * 3)}3`, rows: ["Region"], values: [{ field: "Amount" }], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
        s.setValues("Variants", `${String.fromCharCode(65 + i * 3)}1`, [[`Form ${letter}`]]);
      }
      readMe(s, "Calculated item forms", this.see);
      return s;
    },
    expected: /pivotTable(3|6)\.xml: field 0 has an item that points at shared item 4|pivotCacheDefinition(3|6)\.xml: a calculated item points at item 4|"Item(C|F)" was read as plain cells/,
    patch(files) {
      const edit = (name: string, f: (t: string) => string) => {
        files[name] = strToU8(f(strFromU8(files[name]!)));
      };
      const canonical = (t: string) => t.replace('formula="East + West"', 'formula="Region[East]+Region[West]"');
      const noShared = (t: string) => t.replace('<sharedItems count="5">', '<sharedItems count="4">').replace('<s v="Coasts"/>', "");
      const unused = (t: string) => t.replace('<s v="Coasts"/>', '<s v="Coasts" u="1"/>');
      // The caches and tables are numbered in the order the tables were made.
      edit("xl/pivotCache/pivotCacheDefinition2.xml", canonical);
      edit("xl/pivotCache/pivotCacheDefinition3.xml", noShared);
      edit("xl/pivotTables/pivotTable4.xml", (t) => t.replace('<item x="4"/>', '<item x="4" f="1"/>'));
      edit("xl/pivotCache/pivotCacheDefinition5.xml", unused);
      edit("xl/pivotCache/pivotCacheDefinition6.xml", (t) => noShared(canonical(t)));
    },
  },
  {
    file: "44-pictures-adjust.xlsx",
    title: "Pictures: shape adjustments (the yellow handles) and the ends of the ten newest effects' sliders",
    see: [
      "Excel should open this without a repair message. Two sheets of pictures.",
      "Adjusted shapes (first sheet): every picture is cropped to a shape with an adjustment. Click one: Excel should show a yellow handle on it. A rounded rectangle with a large radius (40%) and one with a square corner (0), a right arrow with a thin shaft and a long head, a five-point star that is spiky (depth 10000) and one that is fat (35000), a trapezoid leaning a lot, a rectangle with two big snipped corners, and three speech bubbles whose tails point into the picture. Say if any shape is not the shape named, or if the handle is at a different place from where Pli drew it.",
      "Effect ranges (second sheet): the ten newest artistic effects (Marker, Chalk sketch, Cement, Crisscross etching, Light screen, Pastels smooth, Plastic wrap, Texturizer, Watercolor sponge, Paint strokes), each at the lowest, the usual and the highest value Pli allows (low, usual, high in the row). These files write the original as an HD Photo, as Excel does (the first version wrote a PNG, and Excel dropped the effect), so the effects should be there; to check the ranges: in Excel, give one picture each of those ten effects (Picture Format > Artistic Effects) and open Artistic Effects Options. Tell us the lowest and highest value of each one's slider (Pli's: Marker 1-100, Chalk sketch 1-100, Cement 1-100, Crisscross etching 1-100, Light screen 1-100, Pastels smooth 1-100, Plastic wrap 1-10, Texturizer 1-100, Watercolor sponge 1-10, Paint strokes 1-10).",
    ],
    build() {
      const s = fresh("Pictures, adjusted", ["Adjusted shapes", "Effect ranges"]);
      const w = 120;
      const h = 90;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let c = [60 + (x * 140) / w, 120 + (y * 100) / h, 200 - (x * 80) / w];
          if ((x - 42) ** 2 + (y - 40) ** 2 < 600) c = [230, 80, 60];
          if (x > 66 && x < 106 && y > 36 && y < 72) c = [250, 230, 90];
          data.set([...c, 255], (y * w + x) * 4);
        }
      }
      const scene = toDataUri(encodePng({ width: w, height: h, data }), "png");
      const cell = (row: number, col: number) => `${String.fromCharCode(64 + col)}${row}`;
      for (const sheet of ["Adjusted shapes", "Effect ranges"]) s.setColumnWidth(sheet, 1, 3);
      const shapes: [string, string, Record<string, number>][] = [
        ["Rounded, radius 40%", "roundRect", { adj: 40000 }],
        ["Rounded, square corner", "roundRect", { adj: 0 }],
        ["Arrow, thin shaft, long head", "rightArrow", { adj1: 25000, adj2: 80000 }],
        ["Star, spiky", "star5", { adj: 10000 }],
        ["Star, fat", "star5", { adj: 35000 }],
        ["Trapezoid, leaning", "trapezoid", { adj: 45000 }],
        ["Two snipped corners", "snip2SameRect", { adj1: 30000, adj2: 10000 }],
        ["Speech bubble, tail inside", "wedgeRectCallout", { adj1: 10000, adj2: 10000 }],
        ["Rounded speech bubble", "wedgeRoundRectCallout", { adj1: -20000, adj2: 20000, adj3: 30000 }],
        ["Oval speech bubble", "wedgeEllipseCallout", { adj1: 15000, adj2: 5000 }],
      ];
      shapes.forEach(([name, shape, adjust], i) => {
        const row = 3 + Math.floor(i / 4) * 7;
        const col = 2 + (i % 4) * 3;
        s.setValues("Adjusted shapes", cell(row - 1, col), [[name]]);
        s.addImage("Adjusted shapes", { src: scene, from: { row, col }, width: 120, height: 90, alt: name, shape: shape as never, shapeAdjust: adjust });
      });
      const effects: [string, string, number, number, number][] = [
        ["Marker", "marker", 1, 20, 100],
        ["Chalk sketch", "chalkSketch", 1, 25, 100],
        ["Cement", "cement", 1, 25, 100],
        ["Crisscross etching", "crisscrossEtching", 1, 50, 100],
        ["Light screen", "lightScreen", 1, 25, 100],
        ["Pastels smooth", "pastelsSmooth", 1, 10, 100],
        ["Plastic wrap", "plasticWrap", 1, 5, 10],
        ["Texturizer", "texturizer", 1, 50, 100],
        ["Watercolor sponge", "watercolorSponge", 1, 5, 10],
        ["Paint strokes", "paintStrokes", 1, 5, 10],
      ];
      effects.forEach(([name, kind, low, usual, high], i) => {
        const row = 3 + i * 7;
        s.setValues("Effect ranges", cell(row - 1, 2), [[`${name}: low ${low}, usual ${usual}, high ${high}`]]);
        [low, usual, high].forEach((level, j) => s.addImage("Effect ranges", { src: scene, from: { row, col: 2 + j * 3 }, width: 120, height: 90, alt: `${name} ${["low", "usual", "high"][j]}`, artistic: { kind: kind as never, level } }));
      });
      readMe(s, "Pictures, adjusted", this.see);
      return s;
    },
  },
  ...TABLE_SAMPLES,
  ...CHART_SAMPLES,
  ...PICTURE_SAMPLES,
];

/** What a workbook holds of the things Pli writes, to compare a file Excel saved with the one Pli wrote. */
export function featureCounts(wb: Workbook): Record<string, number> {
  const sum = (pick: (s: Workbook["sheets"][number]) => number) => wb.sheets.reduce((n, s) => n + pick(s), 0);
  return {
    sheets: wb.sheets.length,
    hiddenSheets: wb.sheets.filter((s) => s.hidden).length,
    formulas: sum((s) => Object.values(s.cells).filter((c) => c.f !== undefined).length),
    charts: sum((s) => s.charts?.length ?? 0),
    chartPointColors: sum((s) => (s.charts ?? []).reduce((n, c) => n + c.series.reduce((m, x) => m + Object.keys(x.pointColors ?? {}).length, 0), 0)),
    chartAxisFonts: sum((s) => (s.charts ?? []).reduce((n, c) => n + Object.values(c.axes ?? {}).filter((a) => a.font || a.titleFont || a.titleRuns).length, 0)),
    chartTrendlineLabels: sum((s) => (s.charts ?? []).reduce((n, c) => n + c.series.reduce((m, x) => m + (x.trendlines ?? []).filter((t) => t.label).length, 0), 0)),
    tables: sum((s) => s.tables?.length ?? 0),
    slicers: sum((s) => s.slicers?.length ?? 0),
    images: sum((s) => s.images?.length ?? 0),
    notes: sum((s) => Object.values(s.cells).filter((c) => c.note !== undefined).length),
    richNotes: sum((s) => Object.values(s.cells).filter((c) => c.noteRuns !== undefined).length),
    noteFills: sum((s) => Object.values(s.cells).filter((c) => c.noteBox?.fill !== undefined || c.noteBox?.transparency !== undefined).length),
    notePictures: sum((s) => Object.values(s.cells).filter((c) => c.noteBox?.picture !== undefined).length),
    noteLines: sum((s) => Object.values(s.cells).filter((c) => c.noteBox?.line !== undefined || c.noteBox?.lineWeight !== undefined || c.noteBox?.dash !== undefined).length),
    shownNotes: sum((s) => Object.values(s.cells).filter((c) => c.noteBox?.show).length),
    noteAuthors: sum((s) => Object.values(s.cells).filter((c) => c.noteAuthor !== undefined).length),
    links: sum((s) => Object.values(s.cells).filter((c) => c.link !== undefined).length),
    validations: sum((s) => s.validations?.length ?? 0),
    externalBooks: wb.externalBooks?.length ?? 0,
    conditionalRules: sum((s) => s.conditional?.length ?? 0),
    merges: sum((s) => s.merges?.length ?? 0),
    names: Object.keys(wb.names ?? {}).length,
    protectedSheets: wb.sheets.filter((s) => s.protection).length,
    unlockedCells: sum((s) => Object.values(s.cells).filter((c) => c.s?.locked === false).length),
    hiddenFormulas: sum((s) => Object.values(s.cells).filter((c) => c.s?.hideFormula).length),
    // Counted as the places that differ from what the sheet says: a file stores a row's lock and hiding together (every row style says both), which Pli reads back as both.
    hiddenFormulasByColumnsOrRows: sum((s) => [...Object.values(s.columns ?? {}), ...Object.values(s.rows ?? {})].filter((d) => d.hideFormula !== undefined && d.hideFormula !== !!s.hiddenFormulas).length + (s.hiddenFormulas ? 1 : 0)),
    accountRanges: sum((s) => (s.editRanges ?? []).filter((r) => [...(r.permissions ?? []), ...(r.denied ?? [])].some((p) => p.startsWith("sid:"))).length),
    workbookProtected: wb.protection ? 1 : 0,
    editRanges: sum((s) => (s.editRanges ?? []).filter((r) => (!r.permissions && !r.denied) || r.password || [...(r.permissions ?? []), ...(r.denied ?? [])].some((p) => p.startsWith("sid:"))).length),
    lockedByColumnsOrRows: sum((s) => [...Object.values(s.columns ?? {}), ...Object.values(s.rows ?? {})].filter((d) => d.locked !== undefined && d.locked !== !s.unlocked).length + (s.unlocked ? 1 : 0)),
    pageSetups: wb.sheets.filter((s) => s.page).length,
    pageBreaks: sum((s) => (s.page?.rowBreaks?.length ?? 0) + (s.page?.colBreaks?.length ?? 0)),
    groupedRows: sum((s) => Object.values(s.rows ?? {}).filter((d) => d.level).length),
    groupedColumns: sum((s) => Object.values(s.columns ?? {}).filter((d) => d.level).length),
    sparklines: sum((s) => (s.sparklines ?? []).reduce((n, g) => n + g.items.length, 0)),
    dateAxisSparklines: sum((s) => (s.sparklines ?? []).filter((g) => g.dateAxis).reduce((n, g) => n + g.items.length, 0)),
    themeColourSparklines: sum((s) => (s.sparklines ?? []).filter((g) => [g.color, g.negativeColor, g.markerColor, g.firstColor, g.lastColor, g.highColor, g.lowColor, g.axisColor].some((c) => typeof c === "object")).reduce((n, g) => n + g.items.length, 0)),
    subtotalRows: sum((s) => Object.values(s.cells).filter((c) => c.f !== undefined && /SUBTOTAL\(/i.test(c.f)).length),
    // A pivot table the file format can't hold the way Pli means it is written as the cells it drew, so only the parts count.
    pivotTables: Object.keys(unzipSync(toXlsx(wb))).filter((n) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(n)).length,
    iteration: wb.iteration ? 1 : 0,
    shapeAdjustments: sum((s) => (s.images ?? []).filter((i) => i.shapeAdjust !== undefined).length),
    artisticImages: sum((s) => (s.images ?? []).filter((i) => i.artistic !== undefined).length),
    cellPictures: sum((s) => Object.values(s.cells).filter((c) => c.picture !== undefined).length),
    dateGroupFilters: sum((s) => Object.values(s.filter?.columns ?? {}).filter((c) => !Array.isArray(c) && c.kind === "dateGroups").length + (s.tables ?? []).reduce((n, t) => n + Object.values(t.filters ?? {}).filter((c) => !Array.isArray(c) && c.kind === "dateGroups").length, 0)),
    tableSortLevels: sum((s) => (s.tables ?? []).reduce((n, t) => n + (t.sort ? 1 + (t.sort.then?.length ?? 0) : 0), 0)),
    colourSortLevels: sum((s) => (s.tables ?? []).reduce((n, t) => n + [t.sort, ...(t.sort?.then ?? [])].filter((l) => l?.by).length, 0)),
    slicerStyles: Object.keys(wb.slicerStyles ?? {}).length,
    filterViews: sum((s) => s.filterViews?.length ?? 0),
    filterRules: sum((s) => Object.values(s.filter?.columns ?? {}).filter((c) => !Array.isArray(c)).length + (s.tables ?? []).reduce((n, t) => n + Object.values(t.filters ?? {}).filter((c) => !Array.isArray(c)).length, 0)),
  };
}
