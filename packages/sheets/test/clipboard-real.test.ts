import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";
import { cssUnescape, fromMsoNumberFormat, toMsoNumberFormat } from "../src/msoformat";

/*
 * What Excel and Google Sheets put on the clipboard, as fixtures kept in test/fixtures/clipboard. The Excel ones follow the
 * markup Excel writes (a <style> block of `.xl65 { mso-number-format:… }` classes, `x:num`, `x:str`, `x:bool`, `x:err`,
 * `mso-spacerun`, unquoted attributes, the StartFragment marks); the Sheets one follows the markup Sheets writes
 * (`<google-sheets-html-origin>`, `data-sheets-value`, `data-sheets-numberformat`, inline styles, links through Google's
 * redirect). They are written from what the programs are documented to write, not captured by this repository; grid.md says
 * what a person with the programs can still compare. The user names in paths are removed.
 */

const read = (name: string) => readFileSync(new URL(`./fixtures/clipboard/${name}`, import.meta.url), "utf8");
const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Sheet 2"]), { now: () => 45_000.5 });

describe("mso-number-format", () => {
  it("is read in every form Excel writes", () => {
    const f = fromMsoNumberFormat;
    expect(f('"0\\.00"')).toBe("0.00");
    expect(f("Percent")).toBe("0.00%");
    expect(f('"Short Date"')).toBe("m/d/yyyy");
    expect(f('"\\@"')).toBe("@");
    expect(f('"\\0022$\\0022\\#\\,\\#\\#0\\.00"')).toBe('"$"#,##0.00');
    expect(f('"yyyy\\\\-mm\\\\-dd"')).toBe("yyyy\\-mm\\-dd");
    expect(f('"0\\.00_ \\;\\[Red\\]\\\\-0\\.00\\\\ "')).toBe("0.00_ ;[Red]\\-0.00\\ ");
    expect(f('"\\[ENG\\]\\[$-409\\]d\\\\-mmm\\\\-yy\\;\\@"')).toBe("d\\-mmm\\-yy;@");
    expect(f("0%")).toBe("0%");
    expect(f("Fixed")).toBe("0.00");
    expect(f("Standard")).toBe("#,##0.00");
    expect(f("Scientific")).toBe("0.00E+00");
    expect(f('"Long Time"')).toBe("h:mm:ss AM/PM");
    expect(f("General")).toBe("General");
    expect(f(undefined)).toBeUndefined();
    expect(f('""')).toBeUndefined();
  });

  it("is written so that reading it gives the format back", () => {
    for (const code of ["0.00", "0%", "$#,##0.00", '"$"#,##0.00', "yyyy-mm-dd", "m/d/yyyy h:mm AM/PM", "#,##0.00;[Red](#,##0.00)", '0.0 "units"', "@", "[h]:mm:ss", "0.00E+00", "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)", '"a"0', "0\\-0"]) {
      const written = toMsoNumberFormat(code)!;
      expect(written).toMatch(/^".*"$/);
      expect(fromMsoNumberFormat(written)).toBe(code);
    }
    expect(toMsoNumberFormat("General")).toBeUndefined();
    expect(toMsoNumberFormat(undefined)).toBeUndefined();
    expect(toMsoNumberFormat("0.00")).toBe('"0\\.00"');
    expect(toMsoNumberFormat("@")).toBe('"\\@"');
  });

  it("takes the escapes out as CSS does", () => {
    expect(cssUnescape("\\.\\,\\#")).toBe(".,#");
    expect(cssUnescape("\\\\")).toBe("\\");
    expect(cssUnescape("\\0022x\\0022")).toBe('"x"');
  });

  it("does not split a style at a semicolon that a number format escapes", () => {
    const t = parseHtmlTable('<style>.x{mso-number-format:"0\\.00_ \\;\\[Red\\]\\\\-0\\.00";color:#ff0000}</style><table><tr><td class=x x:num="-2">-2.00</td></tr></table>')!;
    expect(t.rows[0]![0]).toMatchObject({ excelFormat: "0.00_ ;[Red]\\-0.00", style: { color: "#ff0000" } });
  });
});

describe("Excel's number formats on paste", () => {
  const html = read("excel-formats-mac.html");

  it("are read from the classes and kept with the numbers", () => {
    const s = make();
    expect(s.pasteHtml("Sheet1", "B2", html)).toBe("B2:H6");
    const at = (a: string) => s.cell("Sheet1", a);
    expect(at("C3")).toMatchObject({ v: 2.5, fmt: "0.00" });
    expect(at("D3")).toMatchObject({ v: 0.125, fmt: "0.00%" });
    expect(at("E3")).toMatchObject({ v: 44927, fmt: "m/d/yyyy" });
    expect(at("G3")).toMatchObject({ v: 1234.5, fmt: '"$"#,##0.00' });
    expect(at("H3")).toMatchObject({ v: 1234567, fmt: "#,##0" });
    // The value is the number Excel gave, not what the format shows.
    expect(at("C4")).toMatchObject({ v: Math.PI, fmt: "0.00" });
    expect(at("G4")).toMatchObject({ v: -5.25, fmt: '"$"#,##0.00' });
    expect(at("C5")).toMatchObject({ v: 45000, fmt: "yyyy\\-mm\\-dd" });
    expect(at("D5")).toMatchObject({ v: 12.5, fmt: "0.0\\%" });
    expect(at("E5")).toMatchObject({ v: -3.5, fmt: "0.00_ ;[Red]\\-0.00\\ " });
    expect(at("F5")).toMatchObject({ v: 45000, fmt: "d\\-mmm\\-yy;@" });
    expect(at("G5")).toMatchObject({ v: 12345.678, fmt: "0.00E+00" });
    expect(at("H5")).toMatchObject({ v: 1.5, fmt: "[h]:mm:ss" });
    expect(at("D6")).toMatchObject({ v: 0.07, fmt: "0%" });
    expect(at("E6")).toMatchObject({ v: 42, fmt: '"Qty "#,##0' });
    expect(at("C6")).toEqual({ v: 5 });
    expect(at("H6")).toEqual({ v: 1234.5678 });
  });

  it("show as Excel showed them", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", html);
    expect(s.display("Sheet1", "C3").text).toBe("2.50");
    expect(s.display("Sheet1", "D3").text).toBe("12.50%");
    expect(s.display("Sheet1", "E3").text).toBe("1/1/2023");
    expect(s.display("Sheet1", "G4").text).toBe("-$5.25");
    expect(s.display("Sheet1", "H5").text).toBe("36:00:00");
    expect(s.display("Sheet1", "E5").text).toBe("-3.50 ");
    expect(s.display("Sheet1", "E6").text).toBe("Qty 42");
  });

  it("keep text that looks like numbers, a formula or TRUE as text (the Text format and x:str)", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", html);
    expect(s.cell("Sheet1", "F3")).toEqual({ v: "00123", fmt: "@" });
    expect(s.cell("Sheet1", "F4")).toEqual({ v: "0042", fmt: "@" });
    expect(s.cell("Sheet1", "F6")).toEqual({ v: "=A1", fmt: "@" });
    expect(s.cell("Sheet1", "G6")).toEqual({ v: "TRUE", fmt: "@" });
    expect(s.cell("Sheet1", "F6")?.f).toBeUndefined();
  });

  it("bring the header looks and the column widths", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", html);
    expect(s.cell("Sheet1", "B2")).toMatchObject({ v: "Label", s: { bold: true, fill: "#d9e1f2" } });
    // Excel's sizes are in points, 48pt = 64 pixels = the default width: no size.
    expect(s.state.sheets[0]!.columns).toBeUndefined();
  });

  it("are also read when the clipboard still has Windows' header lines before the HTML", () => {
    const header = "Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000009999\r\nStartFragment:0000000300\r\nEndFragment:0000009900\r\n";
    const s = make();
    s.pasteHtml("Sheet1", "A1", header + html);
    expect(s.cell("Sheet1", "B2")).toMatchObject({ v: 2.5, fmt: "0.00" });
  });

  it("an Excel format on text that is not a number is left out", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", '<style>.a{mso-number-format:"0\\.00"}</style><table><tr><td class=a>abc</td><td class=a>2.5</td><td class=a>2.55</td></tr></table>');
    expect(s.cell("Sheet1", "A1")).toEqual({ v: "abc" });
    expect(s.cell("Sheet1", "B1")).toEqual({ v: 2.5 });
    expect(s.cell("Sheet1", "C1")).toEqual({ v: 2.55, fmt: "0.00" });
  });
});

describe("Pli's copy, for Excel", () => {
  const build = () => {
    const s = make();
    s.setCell("Sheet1", "A1", 2.5);
    s.setFormat("Sheet1", "A1", "0.00");
    s.setCell("Sheet1", "A2", 0.125);
    s.setFormat("Sheet1", "A2", "0.0%");
    s.setCell("Sheet1", "A3", 45000);
    s.setFormat("Sheet1", "A3", "yyyy-mm-dd");
    s.setCell("Sheet1", "A4", 1234.5);
    s.setFormat("Sheet1", "A4", '"$"#,##0.00;[Red]-"$"#,##0.00');
    s.setCell("Sheet1", "B1", "'00123");
    s.setCell("Sheet1", "B2", "'1e3");
    s.setCell("Sheet1", "B3", "'=A1");
    s.setCell("Sheet1", "B4", "plain");
    s.setCell("Sheet1", "C1", 7);
    return s;
  };

  it("writes the number format of each cell as mso-number-format, and marks text that looks like something else", () => {
    const html = build().toHtml("Sheet1", "A1:C4");
    expect(html).toContain('mso-number-format:&quot;0\\.00&quot;');
    expect(html).toContain('mso-number-format:&quot;0\\.0\\%&quot;');
    expect(html).toContain('mso-number-format:&quot;yyyy\\-mm\\-dd&quot;');
    expect(html).toContain('mso-number-format:&quot;\\0022\\$\\0022\\#\\,\\#\\#0\\.00\\;\\[Red\\]\\-\\0022\\$\\0022\\#\\,\\#\\#0\\.00&quot;');
    expect(html.match(/mso-number-format:&quot;\\@&quot;/g)).toHaveLength(3);
    // General and plain text say nothing.
    expect(html).toContain("<td>plain</td>");
  });

  it("is read back by Pli as the same formats, and text stays text", () => {
    const from = build();
    const to = make();
    to.pasteHtml("Sheet1", "A1", from.toHtml("Sheet1", "A1:C4"));
    for (const a of ["A1", "A2", "A3", "A4", "C1"]) expect(to.cell("Sheet1", a)).toMatchObject({ v: from.cell("Sheet1", a)!.v, ...(from.cell("Sheet1", a)!.fmt ? { fmt: from.cell("Sheet1", a)!.fmt } : {}) });
    expect(to.cell("Sheet1", "B1")).toMatchObject({ v: "00123" });
    expect(to.cell("Sheet1", "B2")).toMatchObject({ v: "1e3" });
    expect(to.cell("Sheet1", "B3")).toMatchObject({ v: "=A1" });
    expect(to.cell("Sheet1", "B3")?.f).toBeUndefined();
    expect(to.cell("Sheet1", "B4")).toEqual({ v: "plain" });
    expect(to.display("Sheet1", "A4").text).toBe("$1,234.50");
  });
});

describe("Excel's layout on paste", () => {
  const html = read("excel-layout-win.html");
  const pasted = () => {
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "B2", html, { notes });
    return s;
  };

  it("brings merged cells, with the lines along their edges", () => {
    const s = pasted();
    expect(s.state.sheets[0]!.merges).toEqual(["B2:D3"]);
    expect(s.cell("Sheet1", "B2")).toMatchObject({ v: "Merged title", s: { bold: true, align: "center", vAlign: "middle", fill: "#fff2cc" } });
    // Excel: .5pt solid windowtext on all sides, plus the right edge in the cell's own style.
    expect(s.cell("Sheet1", "B2")!.s!.border).toMatchObject({ top: { style: "thin" }, left: { style: "thin" } });
    expect(s.cell("Sheet1", "D3")!.s!.border).toMatchObject({ bottom: { style: "thin" }, right: { style: "thin" } });
    expect(s.cell("Sheet1", "E2")).toMatchObject({ v: "Right" });
    expect(s.cell("Sheet1", "E3")).toMatchObject({ v: "Right 2" });
    // The cell under the merge did not move.
    expect(s.cell("Sheet1", "B4")).toMatchObject({ v: "pli docs" });
  });

  it("brings links (with the link look taken off the cell), mail and places", () => {
    const s = pasted();
    expect(s.cell("Sheet1", "B4")).toEqual({ v: "pli docs", link: { to: "https://pli.dev/docs?a=1&b=2" } });
    expect(s.cell("Sheet1", "C4")).toEqual({ v: "mail us", link: { to: "mailto:hello@example.org", followed: true } });
    expect(s.cell("Sheet1", "D4")!.link!.to).toBe("#'Sheet 2'!B3");
    expect(s.cell("Sheet1", "D4")!.s).toBeUndefined();
  });

  it("brings text on several lines, spaces that were meant, entities and wrapping", () => {
    const s = pasted();
    expect(s.cell("Sheet1", "B5")).toMatchObject({ v: "line one\nline two\nline three", s: { wrap: true, vAlign: "top" } });
    expect(s.cell("Sheet1", "C5")).toMatchObject({ v: "a   b and a long sentence that wraps", s: { wrap: true } });
    expect(s.cell("Sheet1", "D5")).toMatchObject({ v: "Tom & Jerry <3 café" });
    expect(s.cell("Sheet1", "E5")).toMatchObject({ v: "Indented", s: { align: "left" } });
  });

  it("brings lines of different weights and kinds, fonts, booleans and errors", () => {
    const s = pasted();
    expect(s.cell("Sheet1", "B6")!.s!.border).toEqual({ top: { style: "medium", color: "#c00000" }, right: { style: "dashed" }, bottom: { style: "thick" }, left: { style: "dotted" } });
    expect(s.cell("Sheet1", "C6")).toMatchObject({ v: "Fancy", s: { fontSize: 14, bold: true, italic: true, fontFamily: "Times New Roman", color: "#c00000", underline: true, strike: true } });
    expect(s.cell("Sheet1", "D6")).toMatchObject({ v: true });
    expect(s.cell("Sheet1", "E6")).toMatchObject({ e: "#N/A" });
  });

  it("clears the cells the blank ones cover, and keeps non-Latin text", () => {
    const s = make();
    s.setValues("Sheet1", "B8", [["old", "old", "old", "old"], ["old", "old", "old", "old"], ["old", "old", "old", "old"]]);
    expect(s.pasteHtml("Sheet1", "B2", html)).toBe("B2:E9");
    expect(s.cell("Sheet1", "B7")).toMatchObject({ v: "Café — 日本語", s: { align: "center" } });
    expect(s.cell("Sheet1", "C7")).toBeUndefined();
    expect(s.cell("Sheet1", "B8")).toBeUndefined();
    expect(s.cell("Sheet1", "E8")).toBeUndefined();
    expect(s.cell("Sheet1", "B9")).toMatchObject({ v: "Rich red", s: { bold: true, color: "#c00000" } });
    expect(s.cell("Sheet1", "C9")).toMatchObject({ v: "A  bold word" });
    // The row of empty cells Excel for Windows ends a table with (hidden, to fix the column widths) is no row.
    expect(s.cell("Sheet1", "B10")).toMatchObject({ v: "old" });
  });

  it("is one undo step", () => {
    const s = pasted();
    s.undo();
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.state.sheets[0]!.merges).toBeUndefined();
  });
});

describe("Google Sheets' markup, a second sample", () => {
  const html = read("google-sheets-mixed.html");
  const s = make();
  const notes: string[] = [];
  s.pasteHtml("Sheet1", "A1", html, { notes });

  it("puts no border on a cell from the grid its stylesheet draws", () => {
    expect(s.cell("Sheet1", "A2")).toEqual({ v: "Plain" });
    expect(s.cell("Sheet1", "A1")!.s).toEqual({ bold: true, fill: "#d9ead3" });
  });

  it("keeps text as text, and reads numbers, dates and booleans", () => {
    expect(s.cell("Sheet1", "B2")).toEqual({ v: "00123" });
    expect(s.cell("Sheet1", "B3")).toEqual({ v: "1e3" });
    expect(s.cell("Sheet1", "F3")).toEqual({ v: "=A1" });
    expect(s.cell("Sheet1", "C2")).toMatchObject({ v: 1234.5, fmt: "$#,##0.00", s: { align: "right" } });
    expect(s.cell("Sheet1", "D2")).toMatchObject({ v: 45000, fmt: "m/d/yyyy" });
    expect(s.cell("Sheet1", "E2")).toMatchObject({ v: true });
    expect(s.cell("Sheet1", "E3")).toMatchObject({ v: false });
  });

  it("brings the formula, lines of 1 and 2 pixels, text on several lines and a link through Google's redirect", () => {
    expect(s.cell("Sheet1", "C3")).toMatchObject({ f: "C2", fmt: "$#,##0.00" });
    expect(s.value("Sheet1", "C3")).toBe(1234.5);
    expect(s.cell("Sheet1", "C3")!.s!.border).toEqual({ top: { style: "thin" }, bottom: { style: "medium", color: "#ff0000" } });
    expect(s.cell("Sheet1", "F2")).toMatchObject({ v: "one\ntwo\nthree", s: { wrap: true } });
    expect(s.cell("Sheet1", "G2")).toMatchObject({ v: "pli docs", link: { to: "https://pli.dev/docs" } });
    expect(s.cell("Sheet1", "A3")).toMatchObject({ v: "Total", s: { bold: true, italic: true } });
    expect(s.cell("Sheet1", "G3")).toMatchObject({ v: "tiny", s: { fontSize: 8, color: "#ff0000", underline: true, align: "center", vAlign: "middle" } });
  });

  it("brings the merged cell with its own lines, and clears the cells it covers", () => {
    expect(s.state.sheets[0]!.merges).toEqual(["A4:B5"]);
    expect(s.cell("Sheet1", "A4")).toMatchObject({ v: "Merged across two rows and two columns", s: { align: "center", vAlign: "middle", fill: "#fff2cc" } });
    expect(s.cell("Sheet1", "A4")!.s!.border).toMatchObject({ top: { style: "thin" }, left: { style: "thin" } });
    expect(s.cell("Sheet1", "C4")).toMatchObject({ v: "x" });
    expect(s.cell("Sheet1", "C5")).toMatchObject({ v: "y" });
    expect(s.cell("Sheet1", "D3")).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it("the widths of its columns come along", () => {
    expect(s.state.sheets[0]!.columns).toMatchObject({ A: { size: 13.57 } });
  });
});

describe("tab-separated text from the programs", () => {
  it("Excel's: Windows line ends, quoted fields with line breaks and quotes, empty cells, what is typed", () => {
    const s = make();
    expect(s.pasteText("Sheet1", "A1", read("excel-range.tsv"))).toBe("A1:E5");
    expect(s.values("Sheet1", "A1:C3")).toEqual([["Name", "Qty", "Note"], ["Pens", 3, "two\nlines"], ["Quote", 4, 'He said "hi"']]);
    expect(s.cell("Sheet1", "D2")).toMatchObject({ v: 0.125, fmt: "0.00%" });
    expect(s.cell("Sheet1", "E2")).toMatchObject({ v: 45000, fmt: "m/d/yyyy" });
    expect(s.value("Sheet1", "D3")).toBe(0.07);
    // A row of empty cells clears what was there; no extra row comes from the last line end.
    expect(s.cell("Sheet1", "B4")).toBeUndefined();
    expect(s.cell("Sheet1", "A6")).toBeUndefined();
    // Text is read as if typed.
    expect(s.value("Sheet1", "A5")).toBe(123);
    expect(s.value("Sheet1", "B5")).toBe(1234.5);
    expect(s.cell("Sheet1", "C5")?.f).toBe("A1");
    expect(s.cell("Sheet1", "D5")).toMatchObject({ v: 5, fmt: "$#,##0.00" });
  });

  it("Sheets': line feeds, no end of line at the end, empty cells at the end of a row", () => {
    const s = make();
    expect(s.pasteText("Sheet1", "B2", read("sheets-range.tsv"))).toBe("B2:D4");
    expect(s.values("Sheet1", "B2:D4")).toEqual([["Name", "Qty", "Note"], ["Pens", 3, "two\nlines"], ["Tail", null, null]]);
  });
});
