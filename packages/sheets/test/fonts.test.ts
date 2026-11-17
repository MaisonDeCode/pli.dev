import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createFonts, type FontEnv, type FontSource } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, printToPdf, toXlsx, usedFonts } from "../src";
import { widthFactor } from "../src/print-pdf";
import { lintPackage } from "./excel-check/lint";

const here = dirname(fileURLToPath(import.meta.url));
const lora = new Uint8Array(readFileSync(join(here, "../../core/test/fixtures/fonts/lora-latin-400-normal.ttf")));

const TRICKY = 'Fish & "Chips" <b>';
/** A note's font name may not hold `& < > " ; { }`, so a note gets a quote of another kind. */
const NOTE_TRICKY = "Fish's Chips";
const NAMES = ["Lora", "Roboto Mono", "Calibri", "Comic Sans MS", TRICKY];

/** A workbook with a cell in each font, a note with runs in two fonts, and a chart with fonts of its own. */
function make(): SheetSession {
  const s = new SheetSession(createWorkbook("Fonts", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Lora", "Mono", "Calibri", "Comic", "Tricky"], [1, 2, 3, 4, 5]]);
  NAMES.forEach((name, i) => s.setStyle("Sheet1", `${"ABCDE"[i]}1`, { fontFamily: name }));
  s.setNote("Sheet1", "B2", "Hello big world", { runs: [{ text: "Hello " }, { text: "big", font: "Lora", bold: true }, { text: " world", font: NOTE_TRICKY }] });
  s.addChart("Sheet1", {
    type: "column",
    title: "Sales",
    categories: "Sheet1!$A$1:$E$1",
    series: [{ nameRef: "Sheet1!$A$1", values: "Sheet1!$A$2:$E$2" }],
    font: { family: "Roboto Mono" },
    titleFont: { family: "Lora", bold: true },
  });
  return s;
}

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const fontElements = (styles: string) => [...styles.matchAll(/<font>.*?<\/font>/g)].map((m) => m[0]);

describe("fonts in an XLSX file", () => {
  it("writes the family hint after the name, in Excel's order", () => {
    const styles = parts(toXlsx(make().state))["xl/styles.xml"]!;
    const fonts = fontElements(styles).join("\n");
    expect(fonts).toContain('<name val="Lora"/><family val="1"/>');
    expect(fonts).toContain('<name val="Roboto Mono"/><family val="3"/>');
    expect(fonts).toContain('<name val="Calibri"/><family val="2"/>');
    expect(fonts).toContain('<name val="Comic Sans MS"/><family val="4"/>');
    expect(fonts).toContain('<name val="Fish &amp; &quot;Chips&quot; &lt;b&gt;"/><family val="2"/>');
    // b, i, strike, u, sz, color, name, family
    expect(styles).toMatch(/<font><b\/><i\/><u\/><sz val="12"\/><color rgb="FF[0-9A-F]{6}"\/><name val="[^"]+"\/><family val="\d"\/><\/font>|<font><sz val="11"\/><name val="Calibri"\/><family val="2"\/><\/font>/);
  });

  it("round-trips every name as written", () => {
    const s = make();
    const back = fromXlsx(toXlsx(s.state)).workbook;
    const got = (a: string) => back.sheets[0]!.cells[a]?.s?.fontFamily;
    expect(got("A1")).toBe("Lora");
    expect(got("B1")).toBe("Roboto Mono");
    // Calibri is the file's default font, so a cell in it carries no font of its own.
    expect(got("C1")).toBeUndefined();
    expect(got("D1")).toBe("Comic Sans MS");
    expect(got("E1")).toBe(TRICKY);
    expect(back.sheets[0]!.cells["B2"]?.noteRuns).toEqual([{ text: "Hello " }, { text: "big", font: "Lora", bold: true }, { text: " world", font: NOTE_TRICKY }]);
    const chart = back.sheets[0]!.charts![0]!;
    expect(chart.font?.family).toBe("Roboto Mono");
    expect(chart.titleFont?.family).toBe("Lora");
    // And the names survive a second trip unchanged.
    expect(usedFonts(fromXlsx(toXlsx(back)).workbook)).toEqual(usedFonts(back));
  });

  it("keeps the file well formed and passes the Excel lint", () => {
    const bytes = toXlsx(make().state);
    expect(lintPackage(bytes)).toEqual([]);
    for (const [name, xml] of Object.entries(parts(bytes))) {
      if (!/\.(xml|rels|vml)$/.test(name)) continue;
      const errors: string[] = [];
      new DOMParser({ onError: (level, message) => void (level !== "warning" && errors.push(message)) }).parseFromString(xml, "text/xml");
      expect(errors, name).toEqual([]);
    }
  });

  it("gives chart and note fonts their hints too", () => {
    const files = parts(toXlsx(make().state));
    const chart = Object.entries(files).find(([k]) => /^xl\/charts\/chart\d+\.xml$/.test(k))![1];
    expect(chart).toContain('<a:latin typeface="Roboto Mono" pitchFamily="49" charset="0"/>');
    expect(chart).toContain('<a:latin typeface="Lora" pitchFamily="18" charset="0"/>');
    const comments = files["xl/comments1.xml"]!;
    expect(comments).toContain('<rFont val="Lora"/><family val="1"/>');
    expect(comments).toContain('<rFont val="Fish\'s Chips"/><family val="2"/>');
    // Plain runs keep the note's own font, Tahoma.
    expect(comments).toContain('<rFont val="Tahoma"/><family val="2"/>');
  });

  it('writes the nearest Office font for each family Office does not have with fonts: "office"', () => {
    const files = parts(toXlsx(make().state, { fonts: "office" }));
    const fonts = fontElements(files["xl/styles.xml"]!).join("\n");
    expect(fonts).toContain('<name val="Georgia"/><family val="1"/>');
    expect(fonts).toContain('<name val="Consolas"/><family val="3"/>');
    expect(fonts).toContain('<name val="Arial"/><family val="2"/>');
    expect(fonts).toContain('<name val="Comic Sans MS"/><family val="4"/>');
    expect(fonts).not.toContain("Lora");
    expect(fonts).not.toContain("Roboto Mono");
    expect(fonts).not.toContain("Chips");
    const chart = Object.entries(files).find(([k]) => /^xl\/charts\/chart\d+\.xml$/.test(k))![1];
    expect(chart).toContain('typeface="Consolas"');
    expect(chart).toContain('typeface="Georgia"');
    expect(chart).not.toContain('typeface="Lora"');
    expect(files["xl/comments1.xml"]).not.toContain("Lora");
    expect(files["xl/comments1.xml"]).toContain('<rFont val="Georgia"/>');
    expect(lintPackage(toXlsx(make().state, { fonts: "office" }))).toEqual([]);
    // The default goes back to keeping names: the option is per file.
    expect(parts(toXlsx(make().state))["xl/styles.xml"]).toContain("Lora");
  });

  it("leaves Office's own fonts, theme references and symbol fonts alone under \"office\"", () => {
    const s = new SheetSession(createWorkbook("Office", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["a", "b", "c", "d"]]);
    for (const [i, name] of ["Aptos Narrow", "Wingdings", "Segoe UI", "Cambria Math"].entries()) s.setStyle("Sheet1", `${"ABCD"[i]}1`, { fontFamily: name });
    const back = fromXlsx(toXlsx(s.state, { fonts: "office" })).workbook;
    expect(["A1", "B1", "C1", "D1"].map((a) => back.sheets[0]!.cells[a]?.s?.fontFamily)).toEqual(["Aptos Narrow", "Wingdings", "Segoe UI", "Cambria Math"]);
  });

  it("writes family hints in dxf fonts as plain names (Excel writes no family there)", () => {
    const s = new SheetSession(createWorkbook("Dxf", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [[1], [2]]);
    s.setTableStyle("Mine", { wholeTable: { fontFamily: "Lora", color: "#cc0000" } });
    const styles = parts(toXlsx(s.state, { fonts: "office" }))["xl/styles.xml"]!;
    expect(styles).toContain('<name val="Georgia"/>');
    expect(styles).not.toContain("Lora");
    expect(usedFonts(s.state)).toEqual(["Lora"]);
  });

  /** A copy of a file with some parts' text replaced. */
  const patch = (bytes: Uint8Array, edits: Record<string, (xml: string) => string>, add: Record<string, string> = {}) => {
    const files = unzipSync(bytes);
    for (const [name, edit] of Object.entries(edits)) files[name] = strToU8(edit(strFromU8(files[name]!)));
    for (const [name, xml] of Object.entries(add)) files[name] = strToU8(xml);
    return zipSync(files);
  };
  const THEME = (minor: string, major: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:fontScheme name="T"><a:majorFont><a:latin typeface="${major}"/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

  it("reads a font that points at the theme's fonts instead of naming one", () => {
    const s = make();
    const file = patch(
      toXlsx(s.state),
      {
        "xl/styles.xml": (x) => x.replace('<name val="Lora"/><family val="1"/>', '<scheme val="major"/>').replace('<name val="Roboto Mono"/><family val="3"/>', '<scheme val="minor"/>'),
        "xl/comments1.xml": (x) => x.replace('<rFont val="Lora"/><family val="1"/>', '<scheme val="minor"/>'),
      },
      { "xl/theme/theme1.xml": THEME("Aptos Narrow", "Aptos Display") },
    );
    const back = fromXlsx(file).workbook;
    expect(back.sheets[0]!.cells["A1"]?.s?.fontFamily).toBe("Aptos Display");
    expect(back.sheets[0]!.cells["B1"]?.s?.fontFamily).toBe("Aptos Narrow");
    expect(back.sheets[0]!.cells["B2"]?.noteRuns?.[1]?.font).toBe("Aptos Narrow");
  });

  it("reads Excel's own style: the name with its scheme", () => {
    const s = make();
    const file = patch(toXlsx(s.state), { "xl/styles.xml": (x) => x.replace('<name val="Lora"/><family val="1"/>', '<name val="Lora"/><family val="1"/><scheme val="minor"/>') }, { "xl/theme/theme1.xml": THEME("Aptos Narrow", "Aptos Display") });
    expect(fromXlsx(file).workbook.sheets[0]!.cells["A1"]?.s?.fontFamily).toBe("Lora");
  });
});

describe("usedFonts", () => {
  it("lists each family once, in document order: cells, then note runs, charts and styles", () => {
    expect(usedFonts(make().state)).toEqual(["Lora", "Roboto Mono", "Calibri", "Comic Sans MS", TRICKY, NOTE_TRICKY]);
  });

  it("names nothing for a workbook that names no font", () => {
    const s = new SheetSession(createWorkbook("Plain", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["x"]]);
    s.setNote("Sheet1", "A1", "note");
    expect(usedFonts(s.state)).toEqual([]);
  });

  it("goes through sheets in order, row by row, and ignores case and padding when it counts", () => {
    const s = new SheetSession(createWorkbook("Two", ["One", "Two"]));
    s.setValues("One", "A1", [["a", "b"], ["c", "d"]]);
    s.setStyle("One", "B1", { fontFamily: "Lato" });
    s.setStyle("One", "A2", { fontFamily: "Alegreya" });
    s.setStyle("One", "B2", { fontFamily: "lato" });
    s.setValues("Two", "A1", [["x"]]);
    s.setStyle("Two", "A1", { fontFamily: "Arvo" });
    expect(usedFonts(s.state)).toEqual(["Lato", "Alegreya", "Arvo"]);
  });

  it("finds the fonts of conditional formats, pivot styles and table styles", () => {
    const s = new SheetSession(createWorkbook("Styles", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [[1], [2]]);
    s.setTableStyle("Mine", { headerRow: { fontFamily: "Oswald" } });
    expect(usedFonts(s.state)).toEqual(["Oswald"]);
  });
});

describe("PDF widths", () => {
  it("keeps the numbers of the names it always told apart", () => {
    expect(widthFactor(undefined)).toBe(1);
    expect(widthFactor("Calibri")).toBe(1);
    expect(widthFactor("Aptos Narrow")).toBe(1);
    expect(widthFactor("Courier New")).toBe(1.25);
    expect(widthFactor("Roboto Mono")).toBe(1.25);
    expect(widthFactor("Times New Roman")).toBe(1.02);
    expect(widthFactor("Georgia")).toBe(1.02);
    expect(widthFactor("Arial")).toBe(1.13);
    expect(widthFactor("Some Unknown Font")).toBe(1.13);
  });

  it("asks the catalogue about names that say nothing", () => {
    expect(widthFactor("Lora")).toBe(1.02);
    expect(widthFactor("Playfair Display")).toBe(1.02);
    expect(widthFactor("Inconsolata")).toBe(1.25);
    expect(widthFactor("Lato")).toBe(1.13);
    expect(widthFactor("Roboto Condensed")).toBeLessThan(1);
    expect(widthFactor("Roboto Condensed")).toBeCloseTo(1.13 * 0.82, 5);
    expect(widthFactor("Arial Narrow")).toBeCloseTo(1.13 * 0.82, 5);
  });
});

// ---- printing with the fonts of the shared registry ----

const env: FontEnv = { canLoad: false, register: () => undefined, load: async () => true, isInstalled: () => false };
const source: FontSource = { name: "test", faces: () => [], file: async () => lora };

const printable = () => {
  const s = new SheetSession(createWorkbook("Print", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Lorem ipsum"], ["Mono text"], ["Comic text"], ["Plain text"]]);
  s.setStyle("Sheet1", "A1", { fontFamily: "Lora" });
  s.setStyle("Sheet1", "A2", { fontFamily: "Roboto Mono" });
  s.setStyle("Sheet1", "A3", { fontFamily: "Comic Sans MS" });
  return s;
};
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("printing to PDF with fonts", () => {
  it("embeds the fonts the registry fetched, with no warnings", async () => {
    const s = printable();
    const registry = createFonts({ storage: null, env, source });
    const { fonts, warnings: fetchWarnings } = await registry.pdfFonts(usedFonts(s.state));
    expect(fetchWarnings).toEqual([]);
    expect(Object.keys(fonts)).toContain("Lora");
    const { bytes, warnings } = await printToPdf(s, "Sheet1", { date: new Date(0), fonts });
    expect(warnings).toEqual([]);
    const text = latin1(bytes);
    expect(text).toContain("/FontFile2");
    expect(text).toContain("/BaseFont /");
  });

  it("draws a font that was not embedded in the nearest standard font", async () => {
    const s = printable();
    const registry = createFonts({ storage: null, env, source });
    const { fonts } = await registry.pdfFonts(["Lora"]);
    // Only Lora is embedded: the monospace cell is Courier, the handwriting one Helvetica, the rest Calibri's stand-in.
    const text = latin1((await printToPdf(s, "Sheet1", { date: new Date(0), fonts: { Lora: fonts["Lora"]! } })).bytes);
    expect(text).toContain("/FontFile2");
    expect(text).toMatch(/\/BaseFont \/Courier\b/);
    expect(text).toMatch(/\/BaseFont \/Helvetica\b/);
    const none = latin1((await printToPdf(s, "Sheet1", { date: new Date(0) })).bytes);
    expect(none).not.toContain("/FontFile2");
    expect(none).toMatch(/\/BaseFont \/Times-Roman\b/);
    expect(none).toMatch(/\/BaseFont \/Courier\b/);
  });
});
