import { SheetSession, createWorkbook } from "../../src";
import type { Sample } from "./samples";

/*
 * Kit file 60, for the chart questions kit file 31 could not settle from the file Excel saved: how long Excel's standard
 * deviation and standard error bars are (Excel does not write them into the file), what R squared it gives a trendline
 * forced through a point, and whether it keeps the newer chart settings: single point colours, the fonts and titles in
 * pieces of single axes, trendline labels, scatter points on a column chart, stacked lines on stacked columns, 3-D
 * perspective and right-angle axes, spheres for bubbles, and the labels of a treemap and a sunburst.
 */

const NOW = () => 45_000.5;
const fresh = (title: string, sheets: string[]) => new SheetSession(createWorkbook(title, ["Read me", ...sheets]), { now: NOW });

function readMe(s: SheetSession, title: string, see: string[]): void {
  s.setValues("Read me", "A1", [[title], ["Open this in Excel (and upload it to Google Sheets) and look for:"], ...see.map((line, i) => [`${i + 1}. ${line}`])]);
  s.setStyle("Read me", "A1", { bold: true, fontSize: 14 });
  s.setColumnWidth("Read me", 1, 110);
  s.setStyle("Read me", `A3:A${2 + see.length}`, { wrap: true, vAlign: "top" });
}

export const CHART_SAMPLES: Sample[] = [
  {
    file: "60-charts-detail.xlsx",
    title: "Charts: standard deviation bars, a trendline through a point, point colours, axis fonts, and the combinations Pli now draws",
    see: [
      "Excel should open this without a repair message and show 15 charts on the Charts sheet, four to a row (the last three in the fourth row). A chart that is missing, or a message about unreadable content, is the finding: say which chart.",
      "'Std dev bars' and 'Std error bars' (row 1): scatter charts of the three points y = 2, 4, 9 (Data!B2:B4) at x = 1, 2, 3, with the value axis fixed from 0 to 14 in steps of 1 and minor gridlines, so the bars can be read off. Pli draws the standard deviation bar one population standard deviation long (STDEV.P = 2.944, so the third point's bar ends at 11.94) and the standard error bar the sample one (STDEV.S/SQRT(3) = 2.082, ending at 11.08). If Excel's bar on the third point ends near 12.61 the standard deviation is the sample one (STDEV.S = 3.606); if the standard error bar ends near 10.70 it is STDEV.P/SQRT(3) = 1.700. Write down where each bar ends.",
      "'Trendline through 2' (row 1): scatter of x = 1..5, y = 3, 5, 4, 8, 9 with a linear trendline forced through (0, 2), showing its equation and R squared. Pli's equation is y = 1.3091x + 2. Pli's R squared is 0.9521 (worked around the intercept); if Excel shows 0.8229 it measures against the mean of y, and Pli should do the same. Write down what Excel shows. The same chart without an intercept reads y = 1.5x + 1.3 and R² = 0.8396 (the next chart, 'Trendline label').",
      "'Trendline label' (row 1): the same points with a free linear trendline whose label has the number format 0.000 and is moved a little left and down. The equation should read y = 1.500x + 1.300 and R² = 0.840 (Format Trendline Label > Number: Number, 3 decimal places), and the label should stand to the left of and below where Excel would put it.",
      "'Point colours' (row 2): columns where the third column is dark red and the fifth purple (click a single column: Format Data Point > Fill). 'Pie colours': a pie whose second slice is green and is pulled out 30%. 'Waterfall colours': increases green, decreases red and totals grey (Excel shows these under Format Data Point on the first bar of each kind, or as the colour of the legend entries). 'Bubble spheres': bubbles drawn as 3-D spheres (Format Data Series > Fill > 3-D bubbles).",
      "'Axis fonts' (row 3, first): columns whose value axis labels are Courier New 12 pt, whose category labels are 8 pt bold, and whose value axis title reads 'Sales in $' with 'Sales' bold dark red and 'in $' italic (click the title: the two pieces differ). The legend is italic and the data labels are 8 pt red.",
      "'Column and scatter' (row 3, second): columns for sales with the units drawn as points over the columns (Change Chart Type > Combo: Clustered Column and Scatter), the first point at the first column. 'Stacked kinds' (row 3, third): stacked columns with stacked lines over them (Combo: Stacked Column and Stacked Line); the top line stands at the sum of the two line series.",
      "'3-D perspective' (row 3, last) and 'Right angles' (row 4, first): a 3-D column chart with a wide angle of view (Format Chart Area > 3-D Rotation: Perspective 40°, Depth 200% of base) and one with Right angle axes ticked (Perspective is then greyed out).",
      "'Treemap labels' and 'Sunburst labels' (the last two of row 4): both should show the names of the regions and products on their tiles (Format Data Labels > Category name). If Excel drops the labels, the file Excel saves back has no cx:dataLabels in them: say so.",
      "Not a chart: in the Combo dialog, try changing one series to Clustered Bar while another stays a column or a line. Say whether Excel lets you and what the chart looks like. (Pli keeps bar charts apart from the other kinds until it knows.)",
      "Google Sheets: write down which charts it shows (it is not expected to draw the Excel 2016 kinds, spheres or the combination of columns and scatter points).",
    ],
    build() {
      const s = fresh("Charts detail", ["Data", "Charts"]);
      s.setValues("Data", "A1", [["Month", "Sales", "Margin", "Units"], ["Jan", 10, 0.2, 5], ["Feb", 15, 0.25, 8], ["Mar", 12, 0.22, 6], ["Apr", 20, 0.3, 9], ["May", 24, 0.28, 12]]);
      // Three points for the standard deviation and standard error bars, and five for the trendlines.
      s.setValues("Data", "F1", [["x", "y"], [1, 2], [2, 4], [3, 9]]);
      s.setValues("Data", "I1", [["x", "y"], [1, 3], [2, 5], [3, 4], [4, 8], [5, 9]]);
      s.setValues("Data", "L1", [["Step", "Amount"], ["Start", 100], ["Sales", 40], ["Costs", -30], ["End", 110]]);
      s.setValues("Data", "O1", [["Region", "Product", "Revenue"], ["North", "Pens", 12], ["", "Ink", 7], ["", "Paper", 9], ["South", "Pens", 15], ["", "Ink", 4], ["", "Paper", 6], ["East", "Pens", 8], ["", "Ink", 40]]);
      const D = (c: string, a: number, b: number) => `Data!$${c}$${a}:$${c}$${b}`;
      const cat = D("A", 2, 6);
      const ser = (c: string, extra: object = {}) => ({ nameRef: `Data!$${c}$1`, values: D(c, 2, 6), ...extra });
      const at = (slot: number) => ({ row: 1 + Math.floor(slot / 4) * 15, col: 1 + (slot % 4) * 8 });
      const add = (slot: number, spec: Parameters<SheetSession["addChart"]>[1]) => s.addChart("Charts", { width: 440, height: 260, from: at(slot), ...spec });
      const grid = { y: { min: 0, max: 14, majorUnit: 1, minorUnit: 0.5, minorGridlines: true } };
      add(0, { type: "scatter", title: "Std dev bars", axes: grid, series: [{ name: "y", x: D("F", 2, 4), values: D("G", 2, 4), errorBars: { y: { kind: "stdDev", value: 1 } } }] });
      add(1, { type: "scatter", title: "Std error bars", axes: grid, series: [{ name: "y", x: D("F", 2, 4), values: D("G", 2, 4), errorBars: { y: { kind: "stdErr" } } }] });
      add(2, { type: "scatter", title: "Trendline through 2", series: [{ name: "y", x: D("I", 2, 6), values: D("J", 2, 6), trendlines: [{ type: "linear", intercept: 2, equation: true, rSquared: true }] }] });
      add(3, { type: "scatter", title: "Trendline label", series: [{ name: "y", x: D("I", 2, 6), values: D("J", 2, 6), trendlines: [{ type: "linear", equation: true, rSquared: true, label: { format: "0.000", x: -0.12, y: 0.1 } }] }] });
      add(4, { type: "column", title: "Point colours", categories: cat, series: [ser("B", { pointColors: { "2": "#c00000", "4": "#7030a0" } })] });
      add(5, { type: "pie", title: "Pie colours", labels: true, categories: cat, series: [ser("B", { pointColors: { "1": "#00b050" }, pointExplosion: { "1": 30 } })] });
      add(6, { type: "waterfall", title: "Waterfall colours", totals: [0, 3], categories: D("L", 2, 5), waterfall: { increaseColor: "#00b050", decreaseColor: "#c00000", totalColor: "#7f7f7f" }, series: [{ nameRef: "Data!$M$1", values: D("M", 2, 5) }] });
      add(7, { type: "bubble", title: "Bubble spheres", bubble3d: true, series: [{ name: "Quarters", x: D("D", 2, 6), values: D("C", 2, 6), size: D("B", 2, 6), color: "#4472c4" }] });
      add(8, {
        type: "column", title: "Axis fonts", categories: cat, labels: true, labelFont: { size: 8, color: "#c00000" }, legendFont: { italic: true }, yTitle: "Sales in $",
        series: [ser("B"), ser("D")],
        axes: { x: { font: { size: 8, bold: true } }, y: { font: { family: "Courier New", size: 12 }, titleRuns: [{ text: "Sales", bold: true, color: "#c00000" }, { text: " in $", italic: true }] } },
      });
      add(9, { type: "column", title: "Column and scatter", categories: cat, series: [ser("B"), ser("D", { type: "scatter" })] });
      add(10, { type: "column", title: "Stacked kinds", grouping: "stacked", kindGrouping: { line: "stacked" }, categories: cat, series: [ser("B"), ser("D"), ser("B", { type: "line" }), ser("D", { type: "line" })] });
      add(11, { type: "column", title: "3-D perspective", categories: cat, series: [ser("B"), ser("D")], view3d: { rotX: 20, rotY: 30, perspective: 40, depth: 200 } });
      add(12, { type: "column", title: "Right angles", categories: cat, series: [ser("B"), ser("D")], view3d: { rotX: 20, rotY: 30, rightAngle: true } });
      add(13, { type: "treemap", title: "Treemap labels", categories: "Data!$O$2:$P$9", labels: false, series: [{ nameRef: "Data!$Q$1", values: D("Q", 2, 9) }] });
      add(14, { type: "sunburst", title: "Sunburst labels", categories: "Data!$O$2:$P$9", series: [{ nameRef: "Data!$Q$1", values: D("Q", 2, 9) }] });
      readMe(s, "Charts, standard deviation bars, trendline label, point colours and the rest", this.see);
      return s;
    },
  },
];
