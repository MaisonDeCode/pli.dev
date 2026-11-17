import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { FOLLOWED_LINK_COLOR, LINK_COLOR, SheetSession, createWorkbook, fromXlsx, linkColor, linkLook, linkedStyle, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const OFFICE = ["#ffffff", "#000000", "#e7e6e6", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];
const CUSTOM = [...OFFICE, "#008000", "#800080"];

const make = () => {
  const s = new SheetSession(createWorkbook("Links", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Pli", "docs", "mine"], ["x", null, null]]);
  s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
  s.setLink("Sheet1", "B1", { to: "#Other!A1" });
  s.setStyle("Sheet1", "C1", { color: "#cc0000" });
  s.setLink("Sheet1", "C1", { to: "https://pli.dev/own" });
  return s;
};
const theme = (s: SheetSession, colors: string[] | undefined) =>
  s.transact([{ type: "restore", workbook: colors ? { ...s.state, themeColors: colors } : (({ themeColors: _t, ...rest }) => rest as typeof s.state)(s.state) }]);

describe("a link's colour comes from the theme", () => {
  it("is Office's hyperlink colour by default and the followed one once followed", () => {
    const s = make();
    expect(LINK_COLOR).toBe("#0563c1");
    expect(FOLLOWED_LINK_COLOR).toBe("#954f72");
    expect(linkedStyle(s.cell("Sheet1", "A1"))).toEqual({ color: "#0563c1", underline: true });
    expect(linkedStyle(s.cell("Sheet1", "A1"), OFFICE)).toEqual({ color: "#0563c1", underline: true }); // a palette of ten leaves it to Office's
    expect(s.followLink("Sheet1", "A1")).toBe(true);
    expect(linkedStyle(s.cell("Sheet1", "A1"))).toEqual({ color: "#954f72", underline: true });
    expect(linkLook(s.cell("Sheet1", "A1"))).toMatchObject({ link: true, theme: 11 });
    expect(linkLook(s.cell("Sheet1", "D1"))).toEqual({ link: false, style: undefined });
  });

  it("follows the workbook's theme: a theme with its own hyperlink colours recolours every link", () => {
    const s = make();
    s.followLink("Sheet1", "B1");
    theme(s, CUSTOM);
    expect(linkColor(10, s.state.themeColors)).toBe("#008000");
    expect(linkedStyle(s.cell("Sheet1", "A1"), s.state.themeColors)).toMatchObject({ color: "#008000" });
    expect(linkedStyle(s.cell("Sheet1", "B1"), s.state.themeColors)).toMatchObject({ color: "#800080" });
    theme(s, undefined);
    expect(linkedStyle(s.cell("Sheet1", "A1"), s.state.themeColors)).toMatchObject({ color: "#0563c1" });
  });

  it("leaves a cell with a colour of its own alone", () => {
    const s = make();
    expect(linkedStyle(s.cell("Sheet1", "C1"), CUSTOM)).toEqual({ color: "#cc0000", underline: true });
    expect(linkLook(s.cell("Sheet1", "C1")).theme).toBeUndefined();
    s.followLink("Sheet1", "C1");
    expect(linkedStyle(s.cell("Sheet1", "C1"), CUSTOM)).toMatchObject({ color: "#cc0000" });
  });
});

describe("following a link", () => {
  it("marks it once, outside the undo history, even on a protected sheet", () => {
    const s = make();
    s.protectSheet("Sheet1", { allow: [] });
    const undoable = s.canUndo;
    expect(s.followLink("Sheet1", "A1")).toBe(true);
    expect(s.link("Sheet1", "A1")).toEqual({ to: "https://pli.dev", followed: true });
    expect(s.followLink("Sheet1", "A1")).toBe(false); // already
    expect(s.canUndo).toBe(undoable);
    expect(s.value("Sheet1", "A1")).toBe("Pli");
  });

  it("is not marked when it can't be followed: a place that isn't there, an address a browser may not open, a cell with no link", () => {
    const s = make();
    s.setLink("Sheet1", "A2", { to: "#Nowhere!A1" });
    s.setLink("Sheet1", "B2", { to: "C:\\files\\a.txt" });
    expect(s.followLink("Sheet1", "A2")).toBe(false);
    expect(s.followLink("Sheet1", "B2")).toBe(false);
    expect(s.followLink("Sheet1", "D1")).toBe(false);
    expect(s.link("Sheet1", "A2")).toEqual({ to: "#Nowhere!A1" });
    expect(() => s.followLink("Sheet1", "nope")).toThrow(/not a cell address/);
  });

  it("is forgotten when the link is changed or taken off, and is kept in JSON", () => {
    const s = make();
    s.followLink("Sheet1", "A1");
    const again = new SheetSession(parseWorkbook(serializeWorkbook(s.state)));
    expect(again.link("Sheet1", "A1")).toEqual({ to: "https://pli.dev", followed: true });
    s.setLink("Sheet1", "A1", { to: "https://pli.dev/new" });
    expect(s.link("Sheet1", "A1")).toEqual({ to: "https://pli.dev/new" });
    s.followLink("Sheet1", "A1");
    s.setLink("Sheet1", "A1", null);
    expect(s.cell("Sheet1", "A1")?.link).toBeUndefined();
    const bad = JSON.parse(serializeWorkbook(make().state));
    bad.workbook.themeColors = ["#fff"];
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/themeColors/);
    bad.workbook.themeColors = CUSTOM;
    expect(parseWorkbook(JSON.stringify(bad)).themeColors).toEqual(CUSTOM);
    bad.workbook.sheets[0].cells.A1.link.followed = false;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/expected true/);
  });
});

describe("links and the theme in XLSX files", () => {
  const styles = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);

  it("write Excel's Hyperlink and Followed Hyperlink cell styles, with the theme colours 10 and 11", () => {
    const s = make();
    s.followLink("Sheet1", "B1");
    const xml = styles(s);
    expect(xml).toContain('<font><u/><sz val="11"/><color theme="10"/><name val="Calibri"/><family val="2"/></font>');
    expect(xml).toContain('<font><u/><sz val="11"/><color theme="11"/><name val="Calibri"/><family val="2"/></font>');
    expect(xml).toContain('<cellStyles count="3"><cellStyle name="Followed Hyperlink" xfId="2" builtinId="9"/><cellStyle name="Hyperlink" xfId="1" builtinId="8"/><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>');
    expect(xml).toMatch(/<cellStyleXfs count="3">/);
    // A and B use the styles; C has a colour of its own, which stays an RGB colour.
    expect(xml).toMatch(/xfId="1"/);
    expect(xml).toMatch(/xfId="2"/);
    expect(xml).toContain('<color rgb="FFCC0000"/>');
  });

  it("write no link styles when there are no links", () => {
    const s = new SheetSession(createWorkbook("Plain", ["Sheet1"]));
    s.setCell("Sheet1", "A1", "x");
    const xml = styles(s);
    expect(xml).toContain('<cellStyles count="1">');
    expect(xml).not.toContain("Hyperlink");
  });

  it("read back as links that follow the theme, and followed ones", () => {
    const s = make();
    s.followLink("Sheet1", "B1");
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.cell("Sheet1", "A1")!.s).toEqual({ underline: true });
    expect(back.cell("Sheet1", "A1")!.link).toEqual({ to: "https://pli.dev" });
    expect(back.cell("Sheet1", "B1")!.link).toEqual({ to: "#Other!A1", followed: true });
    expect(back.cell("Sheet1", "B1")!.s).toEqual({ underline: true });
    expect(back.cell("Sheet1", "C1")!.s).toEqual({ color: "#cc0000", underline: true });
    expect(back.state.themeColors).toBeUndefined();
  });

  it("keep a theme's own hyperlink colours (twelve colours) in the file, and use them", () => {
    const s = make();
    s.followLink("Sheet1", "B1");
    theme(s, CUSTOM);
    const files = unzipSync(toXlsx(s.state));
    const th = strFromU8(files["xl/theme/theme1.xml"]!);
    expect(th).toContain('<a:hlink><a:srgbClr val="008000"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.state.themeColors).toEqual(CUSTOM);
    expect(linkedStyle(back.cell("Sheet1", "A1"), back.state.themeColors)).toMatchObject({ color: "#008000" });
    expect(linkedStyle(back.cell("Sheet1", "B1"), back.state.themeColors)).toMatchObject({ color: "#800080" });
    expect(back.cell("Sheet1", "B1")!.link!.followed).toBe(true);
    // Own palette of ten with Office's links: ten stay ten.
    const ten = make();
    theme(ten, ["#111111", "#000000", "#e7e6e6", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"]);
    const tenBack = new SheetSession(fromXlsx(toXlsx(ten.state)).workbook);
    expect(tenBack.state.themeColors).toHaveLength(10);
  });

  it("read a link cell whose text has the hyperlink colour of the file's theme, as Excel writes them", () => {
    // Build the sort of file Excel writes: font colour theme="10" in a "Hyperlink" style, and a theme with a green hyperlink colour.
    const s = make();
    theme(s, CUSTOM);
    const files = unzipSync(toXlsx(s.state));
    const th = strFromU8(files["xl/theme/theme1.xml"]!).replace("008000", "FF0000");
    const patched = { ...files, "xl/theme/theme1.xml": new TextEncoder().encode(th) };
    // zip it again through the writer's own zip: fromXlsx reads a Uint8Array, so rebuild it
    return import("fflate").then(({ zipSync }) => {
      const back = new SheetSession(fromXlsx(zipSync(patched)).workbook);
      expect(back.state.themeColors![10]).toBe("#ff0000");
      expect(back.cell("Sheet1", "A1")!.s).toEqual({ underline: true });
      expect(linkedStyle(back.cell("Sheet1", "A1"), back.state.themeColors)).toMatchObject({ color: "#ff0000" });
    });
  });
});

describe("sparklines in the hyperlink colours", () => {
  const sparks = () => {
    const s = new SheetSession(createWorkbook("Spark", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [[1, 3, 2, 5]]);
    s.addSparklines("Sheet1", { id: "g", type: "line", location: "F1", data: "A1:D1", color: { theme: 10 }, high: true, highColor: { theme: 11, tint: 0.4 } });
    return s;
  };

  it("take theme 10 and 11 from Office's palette, or the workbook's own", () => {
    const s = sparks();
    const line = () => {
      const sh = s.sparklineShape("Sheet1", "F1", 100, 20);
      if (sh?.kind !== "line") throw new Error();
      return sh;
    };
    expect(line().color).toBe("#0563c1");
    expect(line().dots[0]!.color).not.toBe("#954f72"); // lighter by the tint
    theme(s, CUSTOM);
    expect(line().color).toBe("#008000");
    // A palette of ten has no hyperlink colours of its own: Office's are used.
    theme(s, OFFICE);
    expect(line().color).toBe("#0563c1");
    expect(() => s.updateSparklines("Sheet1", "g", { color: { theme: 12 } })).toThrow(/0 to 11/);
  });

  it("are written and read as theme 10 and 11", () => {
    const s = sparks();
    theme(s, CUSTOM);
    const files = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<x14:colorSeries theme="10"/>');
    expect(sheet).toMatch(/<x14:colorHigh theme="11" tint="0.4"\/>/);
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.sheet("Sheet1").sparklines![0]!.color).toEqual({ theme: 10 });
    expect(back.sheet("Sheet1").sparklines![0]!.highColor).toEqual({ theme: 11, tint: 0.4 });
    expect(back.state.themeColors).toEqual(CUSTOM);
  });
});
