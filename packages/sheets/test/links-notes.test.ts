import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, isOpenable, linkInText, linkedStyle, parseHtmlTable, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Links", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Pli", "docs"], ["x", null]]);
  s.setValues("Other", "B2", [["here"]]);
  return s;
};

describe("links", () => {
  it("makes cells links, keeps their text, format and style, and takes the link off", () => {
    const s = make();
    s.setStyle("Sheet1", "A1", { bold: true });
    s.setLink("Sheet1", "A1", { to: "https://pli.dev", tip: "The site" });
    expect(s.link("Sheet1", "A1")).toEqual({ to: "https://pli.dev", tip: "The site" });
    expect(s.value("Sheet1", "A1")).toBe("Pli");
    expect(s.cell("Sheet1", "A1")?.s?.bold).toBe(true);
    s.undo();
    expect(s.link("Sheet1", "A1")).toBeNull();
    s.redo();
    s.setLink("Sheet1", "A1", null);
    expect(s.link("Sheet1", "A1")).toBeNull();
    expect(s.value("Sheet1", "A1")).toBe("Pli");
  });

  it("sets the text of a link, or shows the address in an empty cell", () => {
    const s = make();
    s.setLink("Sheet1", "C1", { to: "https://pli.dev/sheets" });
    expect(s.value("Sheet1", "C1")).toBe("https://pli.dev/sheets");
    s.setLink("Sheet1", "C2", { to: "#Other!B2" });
    expect(s.value("Sheet1", "C2")).toBe("Other!B2");
    s.setLink("Sheet1", "A2", { to: "mailto:ana@example.com" }, { text: "Mail Ana" });
    expect(s.value("Sheet1", "A2")).toBe("Mail Ana");
    expect(() => s.setLink("Sheet1", "A1:B2", { to: "https://x.dev" }, { text: "no" })).toThrow(/one cell/);
    s.setLink("Sheet1", "A1:B1", { to: "https://x.dev" });
    expect(s.link("Sheet1", "B1")?.to).toBe("https://x.dev");
    expect(s.value("Sheet1", "A1")).toBe("Pli");
  });

  it("refuses links that run code, and empty ones", () => {
    const s = make();
    for (const to of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "", "#"]) {
      expect(() => s.setLink("Sheet1", "A1", { to }), to).toThrow();
    }
    expect(() => s.setLink("Sheet1", "A1", { to: "x".repeat(2084) })).toThrow(/2083/);
    expect(isOpenable("https://pli.dev")).toBe(true);
    expect(isOpenable("C:\\files\\a.xlsx")).toBe(false);
    expect(isOpenable("javascript:alert(1)")).toBe(false);
  });

  it("reads web addresses typed in", () => {
    expect(linkInText("https://pli.dev/a?b=1")).toBe("https://pli.dev/a?b=1");
    expect(linkInText("www.pli.dev")).toBe("https://www.pli.dev");
    expect(linkInText("mailto:ana@example.com")).toBe("mailto:ana@example.com");
    expect(linkInText("see https://pli.dev")).toBeNull();
    expect(linkInText("www.")).toBeNull();
    expect(linkInText("pli.dev")).toBeNull();
    expect(linkInText("https://")).toBeNull();
  });

  it("is blue and underlined unless the cell says otherwise", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    expect(linkedStyle(s.cell("Sheet1", "A1"))).toMatchObject({ color: "#0563c1", underline: true });
    s.setStyle("Sheet1", "A1", { color: "#cc0000" });
    expect(linkedStyle(s.cell("Sheet1", "A1"))).toMatchObject({ color: "#cc0000", underline: true });
    expect(linkedStyle(s.cell("Sheet1", "B1"))).toBeUndefined();
  });

  it("is lost when new content is typed, kept when formats are cleared, and goes with the cell when it is moved or copied", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Other", at: "D4" });
    expect(s.link("Other", "D4")?.to).toBe("https://pli.dev");
    s.clear("Sheet1", "A1", "formats");
    expect(s.link("Sheet1", "A1")?.to).toBe("https://pli.dev");
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "E1" }, { cut: true });
    expect(s.link("Sheet1", "A1")).toBeNull();
    expect(s.link("Sheet1", "E1")?.to).toBe("https://pli.dev");
    s.setCell("Sheet1", "E1", "new");
    expect(s.link("Sheet1", "E1")).toBeNull();
    s.clear("Other", "D4", "contents");
    expect(s.link("Other", "D4")).toBeNull();
    expect(s.cell("Other", "D4")).toBeUndefined();
  });

  it("follows rows that are inserted", () => {
    const s = make();
    s.setLink("Sheet1", "A2", { to: "https://pli.dev" });
    s.insertRows("Sheet1", 1, 2);
    expect(s.link("Sheet1", "A4")?.to).toBe("https://pli.dev");
    expect(s.link("Sheet1", "A2")).toBeNull();
  });

  it("finds where a place in the workbook is", () => {
    const s = make();
    s.defineName("Spot", "Other!$B$2");
    expect(s.linkPlace("Sheet1", "#Other!B2")).toEqual({ sheet: s.sheet("Other").id, range: "B2" });
    expect(s.linkPlace("Sheet1", "#'Other'!$B$2:$C$3")?.range).toBe("B2:C3");
    expect(s.linkPlace("Sheet1", "#B1")).toEqual({ sheet: s.sheet("Sheet1").id, range: "B1" });
    expect(s.linkPlace("Sheet1", "#Spot")).toEqual({ sheet: s.sheet("Other").id, range: "B2" });
    expect(s.linkPlace("Sheet1", "#Nowhere!A1")).toBeNull();
    expect(s.linkPlace("Sheet1", "#Missing")).toBeNull();
  });

  it("follows a sheet that is renamed, quoting the new name when it needs it, and leaves other links alone", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "#Other!B2", tip: "go" });
    s.setLink("Sheet1", "B1", { to: "#'Other'!$B$2:$C$3" });
    s.setLink("Sheet1", "A2", { to: "https://pli.dev/Other!B2" });
    s.setLink("Sheet1", "B2", { to: "#Sheet1!A1" });
    s.setLink("Other", "B2", { to: "#B2" });
    s.renameSheet("Other", "Second place");
    expect(s.link("Sheet1", "A1")).toEqual({ to: "#'Second place'!B2", tip: "go" });
    expect(s.link("Sheet1", "B1")).toEqual({ to: "#'Second place'!$B$2:$C$3" });
    expect(s.link("Sheet1", "A2")).toEqual({ to: "https://pli.dev/Other!B2" });
    expect(s.link("Sheet1", "B2")).toEqual({ to: "#Sheet1!A1" });
    expect(s.link("Second place", "B2")).toEqual({ to: "#B2" });
    expect(s.linkPlace("Sheet1", s.link("Sheet1", "A1")!.to)?.range).toBe("B2");
    s.renameSheet("Second place", "Third");
    expect(s.link("Sheet1", "A1")!.to).toBe("#Third!B2");
    s.undo();
    s.undo();
    expect(s.link("Sheet1", "A1")!.to).toBe("#Other!B2");
  });

  it("takes the address of a HYPERLINK formula", () => {
    const s = make();
    s.setCell("Sheet1", "B2", '=HYPERLINK("https://pli.dev/"&A1, "Go")');
    expect(s.link("Sheet1", "B2")).toEqual({ to: "https://pli.dev/Pli", formula: true });
    expect(s.value("Sheet1", "B2")).toBe("Go");
    s.setCell("Sheet1", "B3", '=HYPERLINK("javascript:alert(1)", "x")');
    expect(s.link("Sheet1", "B3")).toBeNull();
    s.setCell("Sheet1", "B4", "=SUM(1,2)");
    expect(s.link("Sheet1", "B4")).toBeNull();
  });
});

describe("notes", () => {
  it("puts a note on a cell, keeps it when the cell is typed over or emptied, and takes it off", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "Check this\nwith Ana");
    expect(s.note("Sheet1", "A1")).toBe("Check this\nwith Ana");
    s.setCell("Sheet1", "A1", "Changed");
    expect(s.note("Sheet1", "A1")).toBe("Check this\nwith Ana");
    s.clear("Sheet1", "A1", "contents");
    expect(s.note("Sheet1", "A1")).toBe("Check this\nwith Ana");
    s.setCell("Sheet1", "A1", null);
    expect(s.note("Sheet1", "A1")).toBe("Check this\nwith Ana");
    expect(s.notes("Sheet1")).toEqual([{ address: "A1", text: "Check this\nwith Ana" }]);
    s.setNote("Sheet1", "A1", "   ");
    expect(s.note("Sheet1", "A1")).toBeNull();
    s.setNote("Sheet1", "B2", "x");
    s.clear("Sheet1", "B2", "all");
    expect(s.note("Sheet1", "B2")).toBeNull();
    expect(() => s.setNote("Sheet1", "A1", "x".repeat(32768))).toThrow(/32767/);
  });

  it("goes along when cells are copied, cut or sorted", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "n");
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "C1" });
    expect(s.note("Sheet1", "C1")).toBe("n");
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "D1" }, { cut: true });
    expect(s.note("Sheet1", "A1")).toBeNull();
    expect(s.note("Sheet1", "D1")).toBe("n");
    const t = new SheetSession(createWorkbook("Sort"));
    t.setValues("Sheet1", "A1", [["b"], ["a"]]);
    t.setNote("Sheet1", "A1", "was b");
    t.sort("Sheet1", "A1:A2", { by: 1 });
    expect(t.note("Sheet1", "A2")).toBe("was b");
  });

  it("is dropped, with a link, from the cells a merge covers", () => {
    const s = make();
    s.setNote("Sheet1", "B1", "covered");
    s.setLink("Sheet1", "B1", { to: "https://pli.dev" });
    s.mergeCells("Sheet1", "A1:B1");
    expect(s.note("Sheet1", "B1")).toBeNull();
    expect(s.link("Sheet1", "B1")).toBeNull();
  });
});

describe("saving", () => {
  it("is checked when a workbook is read", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev", tip: "t" });
    s.setNote("Sheet1", "A1", "n");
    const text = serializeWorkbook(s.state);
    const back = parseWorkbook(text);
    expect(back.sheets[0]!.cells["A1"]).toMatchObject({ v: "Pli", link: { to: "https://pli.dev", tip: "t" }, note: "n" });
    const bad = JSON.parse(text);
    bad.workbook.sheets[0].cells.A1.link = { to: "javascript:alert(1)" };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].cells.A1.link = { to: "https://pli.dev", extra: 1 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].cells.A1.link = { to: "https://pli.dev" };
    bad.workbook.sheets[0].cells.A1.note = 4;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
  });
});

describe("in XLSX files", () => {
  const round = (s: SheetSession) => fromXlsx(toXlsx(s.state));

  it("writes links as hyperlinks (web addresses as relationships, places as locations) and reads them back", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev/a?x=1&y=2", tip: "Go & see" });
    s.setLink("Sheet1", "B1", { to: "#Other!B2" });
    s.setLink("Sheet1", "A2", { to: "https://pli.dev/a?x=1&y=2" });
    const files = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toMatch(/<hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="Go &amp; see"\/><hyperlink ref="B1" location="Other!B2"\/><hyperlink ref="A2" r:id="rId1"\/><\/hyperlinks>/);
    expect(strFromU8(files["xl/worksheets/_rels/sheet1.xml.rels"]!)).toContain('Target="https://pli.dev/a?x=1&amp;y=2" TargetMode="External"');
    const { workbook, warnings } = round(s);
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["A1"]?.link).toEqual({ to: "https://pli.dev/a?x=1&y=2", tip: "Go & see" });
    expect(cells["A2"]?.link).toEqual({ to: "https://pli.dev/a?x=1&y=2" });
    expect(cells["B1"]?.link).toEqual({ to: "#Other!B2" });
    expect(cells["A1"]?.v).toBe("Pli");
  });

  it("gives a link cell the look of one in the file", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    const styles = strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);
    expect(styles).toContain("<u/>");
    // Excel's own: the font takes the theme's hyperlink colour, and the cell uses the named "Hyperlink" style.
    expect(styles).toContain('<color theme="10"/>');
    expect(styles).toContain('<cellStyle name="Hyperlink" xfId="1" builtinId="8"/>');
  });

  it("writes notes as comments with a drawing for their boxes, and reads them back", () => {
    const s = make();
    s.setNote("Sheet1", "B2", "Line one\nLine two & <more>");
    s.setNote("Other", "A1", "on the other sheet");
    const files = unzipSync(toXlsx(s.state));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["xl/comments1.xml", "xl/comments2.xml", "xl/drawings/vmlDrawing1.vml", "xl/drawings/vmlDrawing2.vml"]));
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain('Extension="vml"');
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toMatch(/<legacyDrawing r:id="rId\d+"\/>/);
    expect(strFromU8(files["xl/drawings/vmlDrawing1.vml"]!)).toContain("<x:Row>1</x:Row><x:Column>1</x:Column>");
    const { workbook, warnings } = round(s);
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.cells["B2"]?.note).toBe("Line one\nLine two & <more>");
    expect(workbook.sheets[1]!.cells["A1"]?.note).toBe("on the other sheet");
  });

  it("keeps notes, links and a chart on the same sheet apart", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [["a", 1], ["b", 2]]);
    s.addChart("Sheet1", { type: "column", series: [{ values: "E1:E2" }] });
    s.setNote("Sheet1", "A1", "n");
    s.setLink("Sheet1", "A2", { to: "https://pli.dev" });
    const { workbook, warnings } = round(s);
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.charts).toHaveLength(1);
    expect(workbook.sheets[0]!.cells["A1"]?.note).toBe("n");
    expect(workbook.sheets[0]!.cells["A2"]?.link?.to).toBe("https://pli.dev");
  });

  it("takes the author off the front of a note the way Excel writes it, and leaves threaded comments out", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "plain");
    const files = unzipSync(toXlsx(s.state));
    files["xl/comments1.xml"] = new TextEncoder().encode(
      `<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Ana</author><author>tc={1}</author></authors><commentList>` +
        `<comment ref="A1" authorId="0"><text><r><rPr><b/></rPr><t>Ana:</t></r><r><t xml:space="preserve">\nBuy more pens</t></r></text></comment>` +
        `<comment ref="B1" authorId="1"><text><t>[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment</t></text></comment>` +
        `</commentList></comments>`,
    );
    const { zipSync } = require("fflate") as typeof import("fflate");
    const { workbook, warnings } = fromXlsx(zipSync(files));
    expect(workbook.sheets[0]!.cells["A1"]?.note).toBe("Buy more pens");
    expect(workbook.sheets[0]!.cells["B1"]?.note).toBeUndefined();
    expect(warnings).toContain("Threaded comments are not supported yet and were left out");
  });

  it("leaves out a link that runs a script", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    const files = unzipSync(toXlsx(s.state));
    const rels = strFromU8(files["xl/worksheets/_rels/sheet1.xml.rels"]!).replace("https://pli.dev", "javascript:alert(1)");
    files["xl/worksheets/_rels/sheet1.xml.rels"] = new TextEncoder().encode(rels);
    const { zipSync } = require("fflate") as typeof import("fflate");
    const { workbook, warnings } = fromXlsx(zipSync(files));
    expect(workbook.sheets[0]!.cells["A1"]?.link).toBeUndefined();
    expect(warnings.some((w) => /script/.test(w))).toBe(true);
  });
});

describe("on the clipboard", () => {
  it("copies a link as an anchor, and reads one on paste", () => {
    const s = make();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev/?a=1&b=2" });
    s.setLink("Sheet1", "B1", { to: "#Other!B2" });
    const html = s.toHtml("Sheet1", "A1:B1");
    expect(html).toContain('<a href="https://pli.dev/?a=1&amp;b=2">Pli</a>');
    expect(html).not.toContain('href="#Other');
    expect(html).toContain("text-decoration:underline");
    s.pasteHtml("Other", "D1", html);
    expect(s.link("Other", "D1")?.to).toBe("https://pli.dev/?a=1&b=2");
    expect(s.value("Other", "D1")).toBe("Pli");
    expect(s.link("Other", "E1")).toBeNull();
  });

  it("reads Excel's and Google Sheets' anchors, unwrapping Google's redirect, and ignores scripts", () => {
    const table = (href: string) => `<table><tr><td><a href="${href}">site</a></td></tr></table>`;
    expect(parseHtmlTable(table("https://www.google.com/url?q=https://pli.dev/x&amp;sa=D"))!.rows[0]![0]!.link).toBe("https://pli.dev/x");
    expect(parseHtmlTable(table("https://pli.dev"))!.rows[0]![0]!.link).toBe("https://pli.dev");
    const s = make();
    s.pasteHtml("Other", "D1", table("javascript:alert(1)"));
    expect(s.value("Other", "D1")).toBe("site");
    expect(s.link("Other", "D1")).toBeNull();
  });
});

describe("typing a web address", () => {
  it("makes a link when asked to, and leaves text typed with a ' alone", () => {
    const s = make();
    s.setCell("Sheet1", "C1", "https://pli.dev", { links: true });
    expect(s.link("Sheet1", "C1")?.to).toBe("https://pli.dev");
    expect(s.value("Sheet1", "C1")).toBe("https://pli.dev");
    s.setCell("Sheet1", "C2", "www.pli.dev", { links: true });
    expect(s.link("Sheet1", "C2")?.to).toBe("https://www.pli.dev");
    expect(s.value("Sheet1", "C2")).toBe("www.pli.dev");
    s.setCell("Sheet1", "C3", "'https://pli.dev", { links: true });
    expect(s.link("Sheet1", "C3")).toBeNull();
    s.setCell("Sheet1", "C4", "https://pli.dev");
    expect(s.link("Sheet1", "C4")).toBeNull();
    s.setCell("Sheet1", "C1", "plain", { links: true });
    expect(s.link("Sheet1", "C1")).toBeNull();
    s.setCell("Sheet1", "C5", "=\"https://pli.dev\"", { links: true });
    expect(s.link("Sheet1", "C5")).toBeNull();
    s.undo();
    s.setCell("Sheet1", "C6", "https://pli.dev", { links: true });
    s.undo();
    expect(s.cell("Sheet1", "C6")).toBeUndefined();
  });
});
