import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";
import { vmlColor } from "../src/xlsx-note";
import { lintPackage } from "./excel-check/lint";
import { cleanNoteBox, styleNoteRuns } from "../src/note";
import { GIF_1X1, JPEG_1X1, png, pngUri } from "./images-helpers";

const make = (options: { author?: string } = {}) => {
  const s = new SheetSession(createWorkbook("Notes", ["Sheet1", "Other"]), { now: () => 45_000.5, ...options });
  s.setValues("Sheet1", "A1", [["Pli", "docs"], ["x", null]]);
  return s;
};
const round = (s: SheetSession) => fromXlsx(toXlsx(s.state));
const box = (s: SheetSession, a: string, sheet = "Sheet1") => s.noteInfo(sheet, a)?.box;

describe("the look of a note's box", () => {
  it("keeps a fill, transparency, line, weight, dash and shadow in the box beside its size", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "hello", { box: { width: 200, show: true } });
    s.setNoteLook("Sheet1", "A1", { fill: "#FFCC00", transparency: 30, line: "#c00000", lineWeight: 2, dash: "dash", shadow: false });
    expect(box(s, "A1")).toEqual({ width: 200, show: true, fill: "#ffcc00", transparency: 30, line: "#c00000", lineWeight: 2, dash: "dash", shadow: false });
    // size and place changes keep the look when the caller merges (showNote does)
    s.showNote("Sheet1", "A1", false);
    expect(box(s, "A1")).toMatchObject({ width: 200, fill: "#ffcc00", shadow: false });
    expect(box(s, "A1")?.show).toBeUndefined();
  });

  it("drops what is Excel's usual, and null puts a property back", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "hello");
    s.setNoteLook("Sheet1", "A1", { fill: "#FFFFE1", transparency: 0, lineWeight: 0.75, dash: "solid", shadow: true });
    expect(box(s, "A1")).toBeUndefined();
    s.setNoteLook("Sheet1", "A1", { fill: "#aabbcc", line: "none" });
    expect(box(s, "A1")).toEqual({ fill: "#aabbcc", line: "none" });
    s.setNoteLook("Sheet1", "A1", { fill: null, line: null });
    expect(box(s, "A1")).toBeUndefined();
  });

  it("refuses values that are not valid, and look changes need a note", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "hello");
    expect(() => s.setNoteLook("Sheet1", "A1", { fill: "yellow" })).toThrow(/colour/);
    expect(() => s.setNoteLook("Sheet1", "A1", { transparency: 101 })).toThrow(/percentage/);
    expect(() => s.setNoteLook("Sheet1", "A1", { lineWeight: 0 })).toThrow(/weight/);
    expect(() => s.setNoteLook("Sheet1", "A1", { dash: "zigzag" as never })).toThrow(/dash/);
    expect(() => s.setNoteLook("Sheet1", "A1", { picture: "data:text/plain;base64,aGk=" })).toThrow();
    expect(() => s.setNoteLook("Sheet1", "A1", { picture: "not a picture" })).toThrow();
    expect(() => s.setNoteLook("Sheet1", "B2", { fill: "#aabbcc" })).toThrow(/no note/i);
    expect(() => cleanNoteBox({ shadow: "yes" })).toThrow(/shadow/);
    expect(() => cleanNoteBox({ line: "red" })).toThrow(/colour/);
  });

  it("is one undo step, and goes with the note", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "hello");
    s.setNoteLook("Sheet1", "A1", { fill: "#aabbcc", picture: pngUri(2, 2) });
    s.undo();
    expect(box(s, "A1")).toBeUndefined();
    s.redo();
    expect(box(s, "A1")?.fill).toBe("#aabbcc");
    s.setNote("Sheet1", "A1", null);
    expect(s.cell("Sheet1", "A1")?.noteBox).toBeUndefined();
  });

  it("holds a picture of a kind the file can hold, and is saved and checked with the workbook", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "pic");
    s.setNote("Sheet1", "B2", "gif");
    s.setNoteLook("Sheet1", "A1", { picture: pngUri(3, 2), transparency: 20 });
    s.setNoteLook("Sheet1", "B2", { picture: GIF_1X1, fill: "#00ff00" });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.cells["A1"]?.noteBox).toEqual({ picture: pngUri(3, 2), transparency: 20 });
    expect(() => parseWorkbook(serializeWorkbook(s.state).replace(/"transparency":20/, '"transparency":120'))).toThrow();
    expect(() => parseWorkbook(serializeWorkbook(s.state).replace(/"fill":"#00ff00"/, '"fill":"green"'))).toThrow();
  });

  it("travels with a copied cell", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "copy me");
    s.setNoteLook("Sheet1", "A1", { fill: "#ddeeff", line: "#112233" });
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "C3" });
    expect(box(s, "C3")).toEqual({ fill: "#ddeeff", line: "#112233" });
  });
});

describe("links in a note's text", () => {
  it("gives a stretch a link, joins only runs that lead to the same place, and takes it off", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "see the docs and more");
    s.formatNote("Sheet1", "A1", 8, 12, { link: "https://pli.dev/docs" });
    expect(s.noteInfo("Sheet1", "A1")?.runs).toEqual([{ text: "see the " }, { text: "docs", link: "https://pli.dev/docs" }, { text: " and more" }]);
    s.formatNote("Sheet1", "A1", 13, 16, { link: "https://pli.dev/docs" });
    expect(s.noteInfo("Sheet1", "A1")?.runs).toHaveLength(5);
    s.formatNote("Sheet1", "A1", 8, 12, { link: null });
    s.formatNote("Sheet1", "A1", 13, 16, { link: null });
    expect(s.noteInfo("Sheet1", "A1")?.runs).toBeUndefined();
  });

  it("refuses an address that runs a script, and keeps places in the workbook", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "go");
    expect(() => s.formatNote("Sheet1", "A1", 0, 2, { link: "javascript:alert(1)" })).toThrow(/script/);
    expect(() => s.setNote("Sheet1", "A1", "go", { runs: [{ text: "go", link: "data:text/html,x" }] })).toThrow(/script/);
    s.formatNote("Sheet1", "A1", 0, 2, { link: "#Other!B2" });
    expect(s.noteInfo("Sheet1", "A1")?.runs).toEqual([{ text: "go", link: "#Other!B2" }]);
  });

  it("is saved with the workbook and edited along with the text", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "visit pli now");
    s.formatNote("Sheet1", "A1", 6, 9, { link: "https://pli.dev" });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.cells["A1"]?.noteRuns).toEqual([{ text: "visit " }, { text: "pli", link: "https://pli.dev" }, { text: " now" }]);
    s.replace({ text: "pli", lookIn: "notes" }, "Pli.Sheets");
    expect(s.noteInfo("Sheet1", "A1")?.runs?.find((r) => r.link)).toEqual({ text: "Pli.Sheets", link: "https://pli.dev" });
  });

  it("styleNoteRuns checks the address", () => {
    expect(() => styleNoteRuns("abc", undefined, 0, 3, { link: "vbscript:x" })).toThrow();
  });
});

describe("in XLSX files", () => {
  it("writes the fill, line and shadow on the shape the way VML says, and reads them back", () => {
    const s = make();
    s.setNote("Sheet1", "B2", "styled", { box: { width: 220, height: 90, show: true } });
    s.setNoteLook("Sheet1", "B2", { fill: "#ffcc00", transparency: 50, line: "#c00000", lineWeight: 2.5, dash: "longDashDot", shadow: false });
    s.setNote("Sheet1", "C3", "no line");
    s.setNoteLook("Sheet1", "C3", { line: "none" });
    s.setNote("Sheet1", "A1", "plain");
    const vml = strFromU8(unzipSync(toXlsx(s.state))["xl/drawings/vmlDrawing1.vml"]!);
    const shapes = vml.match(/<v:shape\b[\s\S]*?<\/v:shape>/g)!;
    const b2 = shapes.find((x) => x.includes("<x:Row>1</x:Row>"))!;
    expect(b2).toContain('fillcolor="#ffcc00" strokecolor="#c00000" strokeweight="2.5pt"');
    expect(b2).toContain('<v:fill color2="#ffcc00" opacity="32768f"/>');
    expect(b2).toContain('<v:stroke dashstyle="longdashdot"/>');
    expect(b2).toContain('<v:shadow color="black"');
    expect(b2).not.toContain('<v:shadow on=');
    expect(shapes.find((x) => x.includes("<x:Row>2</x:Row>"))!).toContain(' stroked="f"');
    expect(shapes.find((x) => x.includes("<x:Row>0</x:Row>"))!).toContain('fillcolor="#ffffe1" o:insetmode');
    const { workbook, warnings } = round(s);
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["B2"]?.noteBox).toEqual({ width: 220, height: 90, show: true, fill: "#ffcc00", transparency: 50, line: "#c00000", lineWeight: 2.5, dash: "longDashDot", shadow: false });
    expect(cells["C3"]?.noteBox).toEqual({ line: "none" });
    expect(cells["A1"]?.noteBox).toBeUndefined();
  });

  it("writes a picture fill as an image of the drawing and reads the picture back", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "with a picture");
    s.setNoteLook("Sheet1", "A1", { picture: pngUri(4, 3, [10, 120, 200]) });
    s.setNote("Sheet1", "B2", "a jpeg");
    s.setNoteLook("Sheet1", "B2", { picture: JPEG_1X1, transparency: 40 });
    const files = unzipSync(toXlsx(s.state));
    const vml = strFromU8(files["xl/drawings/vmlDrawing1.vml"]!);
    expect(vml).toMatch(/<v:fill o:title="image1\.png" color2="#ffffe1" recolor="t" rotate="t" type="frame" o:relid="rId1"\/>/);
    expect(vml).toMatch(/type="frame" o:relid="rId2"/);
    const rels = strFromU8(files["xl/drawings/_rels/vmlDrawing1.vml.rels"]!);
    expect(rels).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"');
    expect(rels).toContain('Target="../media/image2.jpeg"');
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["xl/media/image1.png", "xl/media/image2.jpeg"]));
    expect(strFromU8(files["[Content_Types].xml"]!)).toMatch(/Extension="png"[^>]*image\/png/);
    expect(strFromU8(files["[Content_Types].xml"]!)).toMatch(/Extension="jpeg"/);
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["A1"]?.noteBox?.picture).toBe(pngUri(4, 3, [10, 120, 200]));
    expect(cells["B2"]?.noteBox).toMatchObject({ picture: JPEG_1X1, transparency: 40 });
  });

  it("numbers the note pictures after the pictures over the sheet, so no file is overwritten", () => {
    const s = make();
    s.addImage("Sheet1", { src: pngUri(2, 2), from: { row: 5, col: 5 }, width: 30, height: 30 });
    s.setNote("Sheet1", "A1", "pic");
    s.setNoteLook("Sheet1", "A1", { picture: pngUri(3, 3, [1, 2, 3]) });
    const files = unzipSync(toXlsx(s.state));
    expect(Object.keys(files).filter((n) => n.startsWith("xl/media/")).sort()).toEqual(["xl/media/image1.png", "xl/media/image2.png"]);
    const { workbook } = fromXlsx(toXlsx(s.state));
    expect(workbook.sheets[0]!.images).toHaveLength(1);
    expect(workbook.sheets[0]!.cells["A1"]?.noteBox?.picture).toBe(pngUri(3, 3, [1, 2, 3]));
  });

  it("writes a link in a note as plain text (Excel's notes can't hold a link), keeping the look", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "see docs now");
    s.formatNote("Sheet1", "A1", 4, 8, { link: "https://pli.dev", bold: true });
    const files = unzipSync(toXlsx(s.state));
    const comments = strFromU8(files["xl/comments1.xml"]!);
    expect(comments).not.toContain("pli.dev");
    expect(comments).toContain("<b/>");
    expect(Object.keys(files).some((n) => /hyperlink/i.test(n))).toBe(false);
    const back = round(s).workbook.sheets[0]!.cells["A1"]!;
    expect(back.note).toBe("see docs now");
    expect(back.noteRuns).toEqual([{ text: "see " }, { text: "docs", bold: true }, { text: " now" }]);
  });

  /** A copy of a workbook with its notes' drawing (and, if given, that drawing's relationships) swapped for ones Excel might write. */
  const withVml = (vml: string, rels?: string, extra: Record<string, Uint8Array> = {}) => {
    const base = unzipSync(toXlsx(make().state));
    const files: Record<string, Uint8Array> = { ...base, ...extra };
    files["xl/comments1.xml"] = strToU8(`<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Pli</author></authors><commentList><comment ref="A1" authorId="0"><text><t>one</t></text></comment><comment ref="B2" authorId="0"><text><t>two</t></text></comment></commentList></comments>`);
    files["xl/drawings/vmlDrawing1.vml"] = strToU8(vml);
    if (rels) files["xl/drawings/_rels/vmlDrawing1.vml.rels"] = strToU8(rels);
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace("</worksheet>", '<legacyDrawing r:id="rId8"/></worksheet>'));
    files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`,
    );
    return fromXlsx(zipSync(files));
  };
  const NS = `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"`;

  it("reads what Excel writes: system colours, named colours, EMU weights and a shadow switched off", () => {
    const vml =
      `<xml ${NS}>` +
      `<v:shape id="s1" type="#t" style="width:100pt;height:50pt" fillcolor="infoBackground [80]" strokecolor="windowText [64]"><v:fill color2="infoBackground [80]"/><v:shadow on="t" color="black" obscured="t"/><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape>` +
      `<v:shape id="s2" type="#t" style="width:100pt;height:50pt" fillcolor="red" strokecolor="blue" strokeweight="25400" filled="t"><v:stroke dashstyle="shortdot"/><v:shadow on="f"/><x:ClientData ObjectType="Note"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape>` +
      `</xml>`;
    const cells = withVml(vml).workbook.sheets[0]!.cells;
    // Excel's own default look is no look at all
    expect(cells["A1"]?.noteBox).toEqual({ width: 133, height: 67 });
    expect(cells["B2"]?.noteBox).toEqual({ width: 133, height: 67, fill: "#ff0000", line: "#0000ff", lineWeight: 2, dash: "shortDot", shadow: false });
  });

  it("reads a shadow tag with no `on` as a shadow that is off (how Excel saves it), and `on=\"t\"` as the usual", () => {
    const shape = (shadow: string) => `<v:shape id="s1" type="#t" style="width:100pt;height:50pt" fillcolor="#fc0" strokecolor="#c00000" strokeweight="2pt"><v:fill opacity="45875f" color2="#fc0"/><v:stroke dashstyle="longDashDot"/>${shadow}<x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape>`;
    const off = withVml(`<xml ${NS}>${shape('<v:shadow color="black" obscured="t"/>')}</xml>`).workbook.sheets[0]!.cells["A1"]?.noteBox;
    expect(off).toMatchObject({ fill: "#ffcc00", transparency: 30, line: "#c00000", lineWeight: 2, dash: "longDashDot", shadow: false });
    const on = withVml(`<xml ${NS}>${shape('<v:shadow on="t" color="black" obscured="t"/>')}</xml>`).workbook.sheets[0]!.cells["A1"]?.noteBox;
    expect(on?.shadow).toBeUndefined();
  });

  it("reads a note box with no fill as fully transparent", () => {
    const vml = `<xml ${NS}><v:shape id="s1" type="#t" style="width:100pt;height:50pt" filled="f"><v:shadow on="t"/><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>`;
    expect(withVml(vml).workbook.sheets[0]!.cells["A1"]?.noteBox?.transparency).toBe(100);
  });

  it("reads Excel's picture fill (o:relid on v:fill, type frame) from the drawing's relationships", () => {
    const vml = `<xml ${NS}><v:shape id="s1" type="#t" style="width:100pt;height:50pt" fillcolor="#ffffe1"><v:fill o:detectmouseclick="t" type="frame" o:title="logo" recolor="t" rotate="t" o:relid="rId3"/><v:shadow on="t"/><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>`;
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pic.png"/></Relationships>`;
    const { workbook, warnings } = withVml(vml, rels, { "xl/media/pic.png": png(5, 5, [9, 9, 9]) });
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.cells["A1"]?.noteBox?.picture).toBe(pngUri(5, 5, [9, 9, 9]));
  });

  it("warns, and keeps the note, when the picture fill is missing or of a kind Pli doesn't keep", () => {
    const vml = `<xml ${NS}><v:shape id="s1" type="#t" style="width:100pt;height:50pt"><v:fill type="frame" o:relid="rId9"/><v:shadow on="t"/><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>`;
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/x.emf"/></Relationships>`;
    const { workbook, warnings } = withVml(vml, rels, { "xl/media/x.emf": new Uint8Array([1, 2, 3, 4]) });
    expect(warnings.join(" ")).toMatch(/picture filling a note/);
    expect(workbook.sheets[0]!.cells["A1"]?.note).toBe("one");
    expect(workbook.sheets[0]!.cells["A1"]?.noteBox?.picture).toBeUndefined();
  });

  it("understands VML colours", () => {
    expect(vmlColor("#FFFFE1 [80]")).toBe("#ffffe1");
    expect(vmlColor("#abc")).toBe("#aabbcc");
    expect(vmlColor("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(vmlColor("infoBackground")).toBe("#ffffe1");
    expect(vmlColor("nonsense")).toBeUndefined();
  });
});

describe("the package check", () => {
  it("passes a file with note pictures and notices a picture that points at no relationship", () => {
    const s = make();
    s.setNote("Sheet1", "A1", "pic");
    s.setNoteLook("Sheet1", "A1", { picture: pngUri(2, 2), fill: "#ccddee", line: "#112233" });
    const files = unzipSync(toXlsx(s.state));
    expect(lintPackage(zipSync(files))).toEqual([]);
    files["xl/drawings/vmlDrawing1.vml"] = strToU8(strFromU8(files["xl/drawings/vmlDrawing1.vml"]!).replace('o:relid="rId1"', 'o:relid="rId9"'));
    expect(lintPackage(zipSync(files)).join("\n")).toMatch(/picture refers to rId9/);
  });
});
