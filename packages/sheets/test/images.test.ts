import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, readImage, serializeWorkbook, sniffImage, toXlsx } from "../src";
import { GIF_1X1, JPEG_1X1, png, pngUri } from "./images-helpers";

const make = () => {
  const s = new SheetSession(createWorkbook("Pictures", ["Sheet1", "Other"]));
  s.setValues("Sheet1", "A1", [["x"]]);
  return s;
};

describe("reading a picture", () => {
  it("knows PNG, JPEG and GIF and their sizes", () => {
    expect(sniffImage(png(30, 20))).toEqual({ type: "png", width: 30, height: 20 });
    expect(readImage(JPEG_1X1)).toMatchObject({ type: "jpeg", width: 1, height: 1 });
    expect(readImage(GIF_1X1)).toMatchObject({ type: "gif", width: 1, height: 1 });
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("refuses what isn't a picture of a kind kept, or says it is another", () => {
    const bad = (src: string) => expect(() => readImage(src)).toThrow();
    bad("data:image/svg+xml;base64,PHN2Zy8+");
    bad("data:image/png;base64,!!!");
    bad("https://example.com/a.png");
    bad("data:image/png;base64,AAAA");
    bad(JPEG_1X1.replace("image/jpeg", "image/png")); // says PNG, is JPEG
    bad("data:text/html;base64,PGI+eDwvYj4=");
    bad("javascript:alert(1)");
  });
});

describe("pictures on a sheet", () => {
  it("are added at their own size scaled down, or at a size given, and undone", () => {
    const s = make();
    const a = s.addImage("Sheet1", { src: pngUri(800, 400), from: { row: 2, col: 3, dx: 5 }, alt: "A red box" });
    expect(a).toMatchObject({ width: 480, height: 240, from: { row: 2, col: 3, dx: 5 }, alt: "A red box" });
    expect(s.addImage("Sheet1", { src: pngUri(40, 20) })).toMatchObject({ width: 40, height: 20 });
    expect(s.addImage("Sheet1", { src: pngUri(100, 50), width: 200 })).toMatchObject({ width: 200, height: 100 });
    expect(s.addImage("Sheet1", { src: pngUri(100, 50), height: 25 })).toMatchObject({ width: 50, height: 25 });
    expect(s.images("Sheet1")).toHaveLength(4);
    s.undo();
    expect(s.images("Sheet1")).toHaveLength(3);
    s.redo();
    expect(s.images("Sheet1")).toHaveLength(4);
    expect(() => s.addImage("Sheet1", { src: "data:image/svg+xml;base64,PHN2Zy8+" })).toThrow();
    expect(() => s.addImage("Sheet1", { src: pngUri(10, 10), id: a.id })).toThrow(/already/);
    expect(() => s.addImage("Sheet1", { src: pngUri(10, 10), width: 2, height: 10 })).toThrow(/pixels/);
  });

  it("are moved, resized, described, fitted to cells, reordered and deleted", () => {
    const s = make();
    const a = s.addImage("Sheet1", { src: pngUri(100, 100), id: "a" });
    s.addImage("Sheet1", { src: pngUri(100, 100), id: "b" });
    s.updateImage("Sheet1", "a", { from: { row: 3, col: 2, dx: 4, dy: 6 }, width: 150, height: 90 });
    s.updateImage("Sheet1", "a", { from: { row: 4, col: 2 } }, { merge: true });
    s.updateImage("Sheet1", "a", { alt: "Logo" });
    expect(s.images("Sheet1")[0]).toMatchObject({ id: "a", from: { row: 4, col: 2 }, width: 150, alt: "Logo" });
    s.undo();
    expect(s.images("Sheet1")[0]!.alt).toBeUndefined();
    s.undo(); // the move and the drag that followed it are one step
    expect(s.images("Sheet1")[0]).toMatchObject({ from: { row: 1, col: 1 }, width: a.width });
    s.setColumnWidth("Sheet1", 2, 10); // 75 pixels
    s.setRowHeight("Sheet1", 3, 30); // 40 pixels
    s.fitImage("Sheet1", "a", "B3:C4");
    expect(s.images("Sheet1")[0]).toMatchObject({ from: { row: 3, col: 2 }, width: 75 + 64, height: 40 + 20 });
    s.reorderImage("Sheet1", "a", "front");
    expect(s.images("Sheet1").map((x) => x.id)).toEqual(["b", "a"]);
    s.deleteImage("Sheet1", "b");
    expect(s.images("Sheet1").map((x) => x.id)).toEqual(["a"]);
    s.undo();
    expect(s.images("Sheet1").map((x) => x.id)).toEqual(["b", "a"]);
    expect(() => s.updateImage("Sheet1", "nope", {})).toThrow(/No picture/);
  });

  it("stay on their cell when rows and columns are inserted or deleted", () => {
    const s = make();
    s.addImage("Sheet1", { src: pngUri(20, 20), id: "a", from: { row: 5, col: 4 } });
    s.insertRows("Sheet1", 2, 3);
    s.insertColumns("Sheet1", 1, 1);
    expect(s.images("Sheet1")[0]!.from).toMatchObject({ row: 8, col: 5 });
    s.deleteRows("Sheet1", 1, 2);
    expect(s.images("Sheet1")[0]!.from.row).toBe(6);
    s.undo();
    s.undo();
    s.undo();
    expect(s.images("Sheet1")[0]!.from).toMatchObject({ row: 5, col: 4 });
  });

  it("are saved with the workbook and checked when it is read", () => {
    const s = make();
    s.addImage("Sheet1", { src: JPEG_1X1, alt: "j", width: 10, height: 10 });
    const text = serializeWorkbook(s.state);
    expect(parseWorkbook(text).sheets[0]!.images).toHaveLength(1);
    const bad = JSON.parse(text);
    bad.workbook.sheets[0].images[0].src = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].images[0].src = JPEG_1X1;
    bad.workbook.sheets[0].images[0].extra = 1;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    delete bad.workbook.sheets[0].images[0].extra;
    bad.workbook.sheets[0].images.push({ ...bad.workbook.sheets[0].images[0] });
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/duplicate/);
  });
});

describe("in XLSX files", () => {
  it("writes pictures into the drawing with their media, and reads them back where they were", () => {
    const s = make();
    s.addChart("Sheet1", { series: [{ values: "A1:A1" }], from: { row: 10, col: 1 } });
    s.addImage("Sheet1", { src: pngUri(60, 30, [10, 120, 10]), from: { row: 2, col: 3, dx: 8, dy: 4 }, width: 120, height: 60, alt: "Green & <flat>" });
    s.addImage("Sheet1", { src: JPEG_1X1, from: { row: 6, col: 2 }, width: 50, height: 50 });
    s.addImage("Other", { src: GIF_1X1, from: { row: 1, col: 1 }, width: 30, height: 30 });
    const files = unzipSync(toXlsx(s.state));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["xl/media/image1.png", "xl/media/image2.jpeg", "xl/media/image3.gif"]));
    const types = strFromU8(files["[Content_Types].xml"]!);
    expect(types).toContain('Extension="png" ContentType="image/png"');
    expect(types).toContain('Extension="jpeg" ContentType="image/jpeg"');
    expect(types).toContain('Extension="gif" ContentType="image/gif"');
    const drawing = strFromU8(files["xl/drawings/drawing1.xml"]!);
    expect(drawing).toContain('descr="Green &amp; &lt;flat&gt;"');
    expect(strFromU8(files["xl/drawings/_rels/drawing1.xml.rels"]!)).toMatch(/rId1".*chart.*rId2".*image1\.png.*rId3".*image2\.jpeg/s);

    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const [first, other] = workbook.sheets;
    expect(first!.charts).toHaveLength(1);
    expect(first!.images).toHaveLength(2);
    expect(first!.images![0]).toMatchObject({ from: { row: 2, col: 3, dx: 8, dy: 4 }, width: 120, height: 60, alt: "Green & <flat>" });
    expect(first!.images![0]!.src).toBe(s.images("Sheet1")[0]!.src);
    expect(first!.images![1]).toMatchObject({ from: { row: 6, col: 2 }, width: 50, height: 50 });
    expect(other!.images![0]!.src).toBe(GIF_1X1);
  });

  it("keeps pictures on a sheet that has a slicer and a chart apart from them", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [["Region", "Qty"], ["West", 1], ["East", 2]]);
    s.createTable("Sheet1", "D1:E3", { name: "T" });
    s.addSlicer("Sheet1", { table: "T", column: "Region" });
    s.addChart("Sheet1", { series: [{ values: "E2:E3" }], from: { row: 10, col: 1 } });
    s.addImage("Sheet1", { src: pngUri(20, 20), from: { row: 20, col: 1 } });
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]).toMatchObject({ charts: [expect.anything()], slicers: [expect.anything()], images: [expect.anything()] });
  });

  it("leaves out a picture in a format that isn't kept, and says so", () => {
    const s = make();
    s.addImage("Sheet1", { src: pngUri(20, 20) });
    const files = unzipSync(toXlsx(s.state));
    files["xl/media/image1.png"] = new TextEncoder().encode("BM not really a bitmap we keep");
    const { workbook, warnings } = fromXlsx(zipSync(files));
    expect(workbook.sheets[0]!.images).toBeUndefined();
    expect(warnings.some((w) => /PNG, JPEG and GIF/.test(w))).toBe(true);
  });
});
