import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, rangeToHtml, serializeWorkbook, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

const make = () => new SheetSession(createWorkbook("fx", ["Data", "Other"]));
const SRC = pngUri(40, 20);

describe("a picture's border, shadow and corrections", () => {
  it("are kept as given with the usual parts left out, and changed in one step", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, border: { color: "#FF0000", width: 1, dash: "solid" }, shadow: { color: "#000000", blur: 6, distance: 4, angle: 45, opacity: 0.4 }, brightness: 0, grayscale: false as never });
    expect(s.images("Data")[0]!.border).toEqual({ color: "#ff0000" });
    expect(s.images("Data")[0]!.shadow).toEqual({});
    s.formatImage("Data", p.id, { border: { color: "#0000ff", width: 3, dash: "dash" }, shadow: { distance: 10, angle: 90, color: "#333333" }, brightness: 0.25, contrast: -0.5, grayscale: true });
    expect(s.images("Data")[0]!).toMatchObject({ border: { color: "#0000ff", width: 3, dash: "dash" }, shadow: { distance: 10, angle: 90, color: "#333333" }, brightness: 0.25, contrast: -0.5, grayscale: true });
    s.formatImage("Data", p.id, { border: null, shadow: null, brightness: null, contrast: null, grayscale: false });
    const img = s.images("Data")[0]!;
    expect([img.border, img.shadow, img.brightness, img.contrast, img.grayscale]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    s.undo();
    expect(s.images("Data")[0]!.grayscale).toBe(true);
  });

  it("are checked", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC });
    expect(() => s.formatImage("Data", p.id, { border: { color: "red" } })).toThrow(/#rrggbb/);
    expect(() => s.formatImage("Data", p.id, { border: { color: "#000000", width: 99 } })).toThrow(/points wide/);
    expect(() => s.formatImage("Data", p.id, { border: { color: "#000000", dash: "wavy" as never } })).toThrow(/solid/);
    expect(() => s.formatImage("Data", p.id, { shadow: { blur: 500 } })).toThrow(/blur/);
    expect(() => s.formatImage("Data", p.id, { shadow: { opacity: 2 } })).toThrow(/opacity/);
    expect(() => s.formatImage("Data", p.id, { brightness: 3 })).toThrow(/-1 to 1/);
  });

  it("are saved with the workbook, and a bad one is named", () => {
    const s = make();
    s.addImage("Data", { src: SRC, border: { color: "#112233", width: 2 }, shadow: { blur: 10 }, contrast: 0.2, grayscale: true });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.images![0]).toMatchObject({ border: { color: "#112233", width: 2 }, shadow: { blur: 10 }, contrast: 0.2, grayscale: true });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].images[0].border = { color: "nope" };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/border/);
  });

  it("are copied with the picture, to another sheet too", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, border: { color: "#112233" }, shadow: { blur: 9 }, brightness: 0.5, grayscale: true });
    const q = s.copyImage("Data", p.id, { sheet: "Other" });
    expect(q).toMatchObject({ border: { color: "#112233" }, shadow: { blur: 9 }, brightness: 0.5, grayscale: true });
  });

  it("go into an XLSX file as a line, an effect and corrections on the picture, and come back", () => {
    const s = make();
    s.addImage("Data", { src: SRC, border: { color: "#ff8800", width: 2.5, dash: "dot" }, shadow: { color: "#223344", blur: 8, distance: 6, angle: 120, opacity: 0.5 }, brightness: 0.2, contrast: -0.3, grayscale: true });
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files[Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!]!);
    expect(xml).toContain('<a:ln w="31750"><a:solidFill><a:srgbClr val="FF8800"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>');
    expect(xml).toContain('<a:outerShdw blurRad="76200" dist="57150" dir="7200000" algn="ctr" rotWithShape="0"><a:srgbClr val="223344"><a:alpha val="50000"/></a:srgbClr></a:outerShdw>');
    expect(xml).toContain("<a:grayscl/>");
    expect(xml).toContain('<a:lum bright="20000" contrast="-30000"/>');
    const img = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
    expect(img).toMatchObject({ border: { color: "#ff8800", width: 2.5, dash: "dot" }, shadow: { color: "#223344", blur: 8, distance: 6, angle: 120, opacity: 0.5 }, brightness: 0.2, contrast: -0.3, grayscale: true });
  });

  it("read from a file without a line, shadow or corrections as plain pictures", () => {
    const s = make();
    s.addImage("Data", { src: SRC });
    const img = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
    expect([img.border, img.shadow, img.brightness, img.contrast, img.grayscale]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("pictures in cells in copied and pasted HTML", () => {
  it("go out as an image in the cell, and a picture from another program's HTML comes in as one", () => {
    const s = make();
    s.setCellPicture("Data", "B2", { src: SRC, alt: "A red box" });
    s.setCell("Data", "C2", "text");
    const html = rangeToHtml(s.calculator, s.sheet("Data").id, { r1: 2, c1: 2, r2: 2, c2: 3 });
    expect(html).toContain(`<img src="${SRC}" alt="A red box" width="64" height="20"`);
    expect(html).not.toContain(">A red box<");
    const to = s.pasteHtml("Other", "A1", html)!;
    expect(to).toBe("A1:B1");
    expect(s.cell("Other", "A1")).toMatchObject({ v: "A red box", picture: { src: SRC, alt: "A red box" } });
    expect(s.cell("Other", "B1")!.v).toBe("text");
  });

  it("go out from an IMAGE formula only when it is a data: picture or the web is allowed", () => {
    const s = make();
    s.setCell("Data", "A1", `=IMAGE("https://example.com/a.png","Web")`);
    s.setCell("Data", "A2", `=IMAGE("${SRC}","Inline")`);
    const id = s.sheet("Data").id;
    const closed = rangeToHtml(s.calculator, id, { r1: 1, c1: 1, r2: 2, c2: 1 });
    expect(closed).toContain("Web");
    expect(closed).not.toContain("https://example.com/a.png");
    expect(closed).toContain(`<img src="${SRC}"`);
  });

  it("are not read from an image that isn't a picture of a kind kept", () => {
    const s = make();
    const html = `<table><tr><td><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">hi</td><td><img src="https://example.com/a.png">there</td></tr></table>`;
    s.pasteHtml("Data", "A1", html);
    expect(s.cell("Data", "A1")!.picture).toBeUndefined();
    expect(s.cell("Data", "B1")!.picture).toBeUndefined();
  });

  it("print on paper where the cell is, and the page leaves a web picture out unless allowed", () => {
    const s = make();
    s.setCellPicture("Data", "A1", { src: SRC, alt: "box" });
    s.setCell("Data", "B1", `=IMAGE("https://example.com/a.png","Web")`);
    const layout = s.printLayout("Data");
    const page = layout.pages[0]!;
    const closed = s.printPage("Data", page);
    expect(closed.html).toContain(`<img src="${SRC}" alt="box" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain">`);
    expect(closed.html).not.toContain("https://example.com/a.png");
    expect(s.printPage("Data", page, { remoteImages: true }).html).toContain('src="https://example.com/a.png"');
  });
});
