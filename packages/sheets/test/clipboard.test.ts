import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";

const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>
<!--table {mso-displayed-decimal-separator:"\\.";}
.xl65 {mso-number-format:"\\$\\#\\,\\#\\#0\\.00"; color:#9C0006; background:#FFC7CE; font-weight:700; font-family:"Courier New", monospace; font-size:14.0pt; border:.5pt solid windowtext;}
.xl66 {text-align:center; border-bottom:1.5pt solid #FF0000; border-top:none;}
td {padding-top:1px; font-size:11.0pt; font-family:Calibri, sans-serif; vertical-align:bottom;}
-->
</style></head><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=300>
<col width=64 span=3>
<tr height=20><td class=xl65 x:num="1234.5678" x:fmla="=A1*2">$1,234.57</td><td class=xl66 colspan=2>Merged &amp; centred</td></tr>
<tr height=20><td>plain</td><td x:num="0.256">25.6%</td><td align=right style='text-decoration:underline line-through;font-style:italic;white-space:normal'>two<br>lines</td></tr>
</table><!--EndFragment--></body></html>`;

const SHEETS = `<meta charset='utf-8'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1"><colgroup><col width="100"/></colgroup><tbody>
<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;background-color:#d9ead3;font-weight:bold;border-bottom:3px solid #000000;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Total&quot;}">Total</td><td style="text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:0.12345}" data-sheets-numberformat="{&quot;1&quot;:2,&quot;2&quot;:&quot;0.0%&quot;,&quot;3&quot;:1}">12.3%</td><td data-sheets-value="{&quot;1&quot;:4,&quot;4&quot;:true}">TRUE</td></tr></tbody></table></google-sheets-html-origin>`;

describe("reading an HTML table", () => {
  it("reads what Excel puts on the clipboard: classes from its style block, spans, exact numbers", () => {
    const t = parseHtmlTable(EXCEL)!;
    expect(t.rows.map((r) => r.length)).toEqual([2, 3]);
    const a = t.rows[0]![0]!;
    expect(a).toMatchObject({ text: "$1,234.57", value: 1234.5678, colspan: 1 });
    expect(a.style).toEqual({
      color: "#9c0006",
      fill: "#ffc7ce",
      bold: true,
      fontFamily: "Courier New",
      fontSize: 14,
      border: { top: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" } },
    });
    const b = t.rows[0]![1]!;
    expect(b).toMatchObject({ text: "Merged & centred", colspan: 2 });
    expect(b.style).toEqual({ align: "center", border: { bottom: { style: "medium", color: "#ff0000" } } }); // 1.5pt is 2px: medium; the top is none
    expect(t.rows[1]![0]!.style).toEqual({}); // Calibri 11pt is the default
    expect(t.rows[1]![1]).toMatchObject({ text: "25.6%", value: 0.256 });
    expect(t.rows[1]![2]).toMatchObject({ text: "two\nlines", style: { align: "right", underline: true, strike: true, italic: true, wrap: true } });
  });

  it("reads what Google Sheets puts on the clipboard: inline styles, values, number formats", () => {
    const t = parseHtmlTable(SHEETS)!;
    const [a, b, c] = t.rows[0]!;
    expect(a!.style).toEqual({ fill: "#d9ead3", bold: true, border: { bottom: { style: "thick" } } }); // (the grid its stylesheet draws is not a border)
    expect(b).toMatchObject({ text: "12.3%", value: 0.12345, format: "0.0%", style: { align: "right" } });
    expect(c).toMatchObject({ text: "TRUE", value: true });
  });

  it("reads a plain page's table: headers are bold, entities and line breaks, nested bold", () => {
    const t = parseHtmlTable('<p>x</p><TABLE><thead><tr><th>Name</th><th>Note&nbsp;</th></tr></thead><tbody><tr><td><b>Ann</b> &lt;a&gt; &#65;&#x42;</td><td>a<br/>b<div>c</div></td></tr></tbody></TABLE><table><tr><td>second table</td></tr></table>')!;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.map((c) => [c.text, c.style.bold, c.style.align])).toEqual([["Name", true, "center"], ["Note", true, "center"]]);
    expect(t.rows[1]![0]).toMatchObject({ text: "Ann <a> AB", style: { bold: true } });
    expect(t.rows[1]![1]!.text).toBe("a\nb\nc");
  });

  it("copes with cells and rows that aren't closed, and tables inside cells", () => {
    const t = parseHtmlTable("<table><tr><td>1<td>2<tr><td>3<td><table><tr><td>inner</td></tr></table>4</table>")!;
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("gives null where there is no table or nothing in it", () => {
    expect(parseHtmlTable("<p>just text</p>")).toBeNull();
    expect(parseHtmlTable("<table></table>")).toBeNull();
    expect(parseHtmlTable("")).toBeNull();
  });
});

const make = () => new SheetSession(createWorkbook("clip", ["Sheet1", "Sheet2"]), { now: () => 45_000.5 });

describe("pasting an HTML table", () => {
  it("brings values, formats, looks and merged cells", () => {
    const s = make();
    s.setCell("Sheet1", "C3", "old");
    s.setStyle("Sheet1", "C3", { bold: true });
    const range = s.pasteHtml("Sheet1", "B2", EXCEL);
    expect(range).toBe("B2:D3");
    expect(s.cell("Sheet1", "B2")).toMatchObject({ v: 1234.5678, fmt: "$#,##0.00", s: { bold: true, fill: "#ffc7ce" } });
    expect(s.merges("Sheet1")).toEqual(["C2:D2"]);
    expect(s.cell("Sheet1", "C2")).toMatchObject({ v: "Merged & centred", s: { align: "center", border: { bottom: { style: "medium", color: "#ff0000" } } } });
    // The line of the merged range is on every cell along its bottom edge.
    expect(s.cell("Sheet1", "D2")?.s?.border?.bottom).toEqual({ style: "medium", color: "#ff0000" });
    expect(s.cell("Sheet1", "C3")).toMatchObject({ v: 0.256, fmt: "0.0%" }); // the old cell, style and all, is replaced
    expect(s.cell("Sheet1", "C3")?.s).toBeUndefined();
    expect(s.cell("Sheet1", "D3")).toMatchObject({ v: "two\nlines", s: { align: "right", wrap: true } });
    expect(s.cell("Sheet1", "B3")).toEqual({ v: "plain" });
  });

  it("uses the number format Google Sheets names when it makes the shown text, and the shown text's own otherwise", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", SHEETS);
    expect(s.cell("Sheet1", "B1")).toMatchObject({ v: 0.12345, fmt: "0.0%" });
    expect(s.display("Sheet1", "B1").text).toBe("12.3%");
    expect(s.cell("Sheet1", "C1")?.v).toBe(true);
  });

  it("lays out rows and columns around spans", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", "<table><tr><td rowspan=2>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table>");
    expect([["A1", "B1", "C1"], ["A2", "B2", "C2"]].map((r) => r.map((a) => s.cell("Sheet1", a)?.v ?? null))).toEqual([["a", "b", "c"], [null, "d", "e"]]);
    expect(s.merges("Sheet1")).toEqual(["A1:A2"]);
  });

  it("takes a shown '=' as text, replaces merged cells in the way, and is one undo step", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x", "y"], ["z", "w"]]);
    s.mergeCells("Sheet1", "A1:B2");
    const before = s.state.sheets[0]!;
    s.pasteHtml("Sheet1", "A1", "<table><tr><td>=A1+1</td><td>1,234</td></tr></table>");
    expect(s.cell("Sheet1", "A1")).toEqual({ v: "=A1+1" });
    expect(s.cell("Sheet1", "B1")).toEqual({ v: 1234, fmt: "#,##0" });
    expect(s.merges("Sheet1")).toEqual([]);
    s.undo();
    expect(s.state.sheets[0]).toEqual(before);
  });

  it("returns null for HTML that has no table, and refuses what doesn't fit", () => {
    const s = make();
    expect(s.pasteHtml("Sheet1", "A1", "<p>hello</p>")).toBeNull();
    expect(() => s.pasteHtml("Sheet1", "XFD1", "<table><tr><td>a</td><td>b</td></tr></table>")).toThrow(/fit/);
  });

  it("carries what Pli copies out: looks, borders and merges survive a trip through HTML", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Title", null, null], [12.5, "x", null]]);
    s.mergeCells("Sheet1", "A1:C1");
    s.setStyle("Sheet1", "A1", { bold: true, italic: true, underline: true, color: "#336699", fill: "#ffee00", align: "center", fontSize: 14, fontFamily: "Georgia" });
    s.setFormat("Sheet1", "A2", "$#,##0.00");
    s.setBorders("Sheet1", "A1:C2", "outer", { style: "thick", color: "#cc0000" });
    s.setBorders("Sheet1", "A2:C2", "top", { style: "dashed" });
    const html = s.toHtml("Sheet1", "A1:C2");
    expect(html).toContain('colspan="3"');
    s.pasteHtml("Sheet2", "B2", html);
    expect(s.merges("Sheet2")).toEqual(["B2:D2"]);
    expect(s.cell("Sheet2", "B2")).toMatchObject({ v: "Title", s: { bold: true, italic: true, underline: true, color: "#336699", fill: "#ffee00", align: "center", fontSize: 14, fontFamily: "Georgia" } });
    expect(s.cell("Sheet2", "B2")?.s?.border).toEqual({ top: { style: "thick", color: "#cc0000" }, left: { style: "thick", color: "#cc0000" }, right: { style: "thick", color: "#cc0000" }, bottom: { style: "dashed" } });
    expect(s.cell("Sheet2", "B3")).toMatchObject({ v: 12.5, fmt: "$#,##0.00" });
    expect(s.display("Sheet2", "B3").text).toBe("$12.50");
  });

  it("copies the look conditional formats and table styles give", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Item", "Qty"], ["a", 5], ["b", 50]]);
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B3"], style: { fill: "#ffc7ce", color: "#9c0006", bold: true } });
    s.createTable("Sheet1", "D1:E3", { style: "TableStyleMedium2" });
    s.setValues("Sheet1", "D1", [["P", "Q"], [1, 2], [3, 4]]);
    const html = s.toHtml("Sheet1", "A1:E3");
    expect(html).toContain("background-color:#ffc7ce");
    expect(html).toContain("background-color:#4472c4"); // the table's header
  });
});

describe("carrying rules and validation with copied cells", () => {
  const rule = (s: SheetSession) => s.addRule("Sheet1", { kind: "formula", formula: "A2>5", ranges: ["B2:B9"], style: { fill: "#ff0000" } });

  it("copied cells bring their conditional formats, with the formula shifted", () => {
    const s = make();
    rule(s);
    s.copy({ sheet: "Sheet1", range: "B4:B5" }, { sheet: "Sheet1", at: "D10" });
    const rules = s.conditionalFormats("Sheet1");
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({ ranges: ["D10:D11"], formula: "C10>5" }); // B4 read A4; D10, two columns on, reads C10
    expect(rules[0]!.ranges).toEqual(["B2:B9"]);
    expect(rules[1]!.id).not.toBe(rules[0]!.id);
    s.setValues("Sheet1", "C10", [[9]]);
    expect(s.conditionalEffect("Sheet1", "D10")?.style?.fill).toBe("#ff0000");
  });

  it("pasting over cells replaces what covered them", () => {
    const s = make();
    rule(s);
    s.addRule("Sheet1", { kind: "blanks", ranges: ["F1:F9"], style: { bold: true } });
    s.copy({ sheet: "Sheet1", range: "B2:B3" }, { sheet: "Sheet1", at: "F4" });
    const rules = s.conditionalFormats("Sheet1");
    expect(rules.find((r) => r.kind === "blanks")!.ranges).toEqual(["F1:F3", "F6:F9"]);
    expect(rules.filter((r) => r.kind === "formula").map((r) => r.ranges)).toEqual([["B2:B9"], ["F4:F5"]]);
  });

  it("moved cells take the rule with them, leaving the rest behind", () => {
    const s = make();
    rule(s);
    s.move({ sheet: "Sheet1", range: "B4:B5" }, { sheet: "Sheet1", at: "D2" });
    const rules = s.conditionalFormats("Sheet1");
    expect(rules.map((r) => r.ranges).sort()).toEqual([["B2:B3", "B6:B9"], ["D2:D3"]].sort());
    s.undo();
    expect(s.conditionalFormats("Sheet1").map((r) => r.ranges)).toEqual([["B2:B9"]]);
  });

  it("works across sheets, and for data validation", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "$H$1"], ranges: ["A2:A9"] });
    s.copy({ sheet: "Sheet1", range: "A3:A4" }, { sheet: "Sheet2", at: "C1" });
    expect(s.validations("Sheet2")).toHaveLength(1);
    expect(s.validations("Sheet2")[0]).toMatchObject({ ranges: ["C1:C2"], values: ["1", "$H$1"] });
    s.setCell("Sheet2", "H1", 10);
    expect(() => s.setCell("Sheet2", "C2", 0)).toThrow();
    s.setCell("Sheet2", "C2", 3);
  });

  it("a plain copy of unformatted cells adds nothing", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1], [2]]);
    s.copy({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "C1" });
    expect(s.conditionalFormats("Sheet1")).toEqual([]);
    expect(s.validations("Sheet1")).toEqual([]);
  });
});

import { htmlToFragment } from "../../docs/src/html/import";

describe("pasting into Pli.Documents", () => {
  it("a copied range arrives as a table with its merged cells and shading", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Title", null], ["a", 1]]);
    s.mergeCells("Sheet1", "A1:B1");
    s.setStyle("Sheet1", "A1", { fill: "#ffee00", bold: true });
    const fragment = htmlToFragment(s.toHtml("Sheet1", "A1:B2"));
    const table = JSON.stringify(fragment);
    expect(table).toContain('"type":"table"');
    expect(table).toContain("Title");
    expect(table).toContain("ffee00");
  });
});
