import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, axisAtPx, axisOffsetPx, createWorkbook, fromXlsx, imageBox, parseWorkbook, serializeWorkbook, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

const make = () => {
  const s = new SheetSession(createWorkbook("pics", ["Data", "Other"]));
  return s;
};
const SRC = pngUri(80, 40);

describe("cropping, rotating and flipping a picture", () => {
  it("keeps the part of the picture left and the size of that part", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, width: 200, height: 100 });
    s.cropImage("Data", p.id, { left: 0.25, right: 0.25, top: 0.5 });
    const c = s.images("Data")[0]!;
    expect(c.crop).toEqual({ left: 0.25, right: 0.25, top: 0.5 });
    expect([c.width, c.height]).toEqual([100, 50]); // the scale stays the same, so it gets smaller
    s.cropImage("Data", p.id, { left: 0.25, right: 0.25 });
    expect(s.images("Data")[0]!).toMatchObject({ width: 100, height: 100 });
    s.cropImage("Data", p.id, null);
    expect(s.images("Data")[0]!.crop).toBeUndefined();
    expect(s.images("Data")[0]!).toMatchObject({ width: 200, height: 100 });
    s.undo();
    expect(s.images("Data")[0]!.crop).toEqual({ left: 0.25, right: 0.25 });
  });

  it("refuses a crop that leaves nothing, or cuts a negative amount", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC });
    expect(() => s.cropImage("Data", p.id, { left: 0.5, right: 0.5 })).toThrow(/leave some/);
    expect(() => s.cropImage("Data", p.id, { top: -0.1 })).toThrow(/0 up to less than/);
    expect(() => s.cropImage("Data", p.id, { bottom: 1 })).toThrow();
  });

  it("is added with a size that is the size of what is left", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, crop: { left: 0.5 } }); // 80 wide, half gone: 40 by 40
    expect([p.width, p.height]).toEqual([40, 40]);
  });

  it("rotates by any number of degrees, kept between 0 and 360, and flips either way", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC });
    s.rotateImage("Data", p.id, 90);
    s.rotateImage("Data", p.id, 300);
    expect(s.images("Data")[0]!.rotation).toBe(30);
    s.rotateImage("Data", p.id, -30);
    expect(s.images("Data")[0]!.rotation).toBeUndefined();
    s.rotateImage("Data", p.id, -90);
    expect(s.images("Data")[0]!.rotation).toBe(270);
    s.flipImage("Data", p.id, "h");
    s.flipImage("Data", p.id, "v");
    expect(s.images("Data")[0]!).toMatchObject({ flipH: true, flipV: true });
    s.flipImage("Data", p.id, "h");
    expect(s.images("Data")[0]!.flipH).toBeUndefined();
    expect(() => s.rotateImage("Data", p.id, Number.NaN)).toThrow();
    s.updateImage("Data", p.id, { rotation: 725 });
    expect(s.images("Data")[0]!.rotation).toBe(5);
  });

  it("is saved with the workbook, and a bad one is named", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, rotation: 45, flipV: true, crop: { top: 0.1 } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.images![0]).toMatchObject({ rotation: 45, flipV: true, crop: { top: 0.1 } });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].images[0].crop = { left: 2 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].images[0].crop = { top: 0.1 };
    bad.workbook.sheets[0].images[0].flipV = false;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/flipV/);
    expect(p.id).toBeTruthy();
  });
});

describe("pictures that follow their cells", () => {
  const sized = (s: SheetSession, placement: "move" | "size" | "free") =>
    s.addImage("Data", { src: SRC, from: { row: 3, col: 2, dx: 10, dy: 5 }, width: 150, height: 70, placement });

  it("know the layout of the cells in pixels", () => {
    const s = make();
    s.setColumnWidth("Data", 2, 20); // 20 characters is 145 pixels
    s.setRowHeight("Data", 2, 30); // 30 points is 40 pixels
    const sheet = s.sheet("Data");
    expect(axisOffsetPx(sheet, "col", 1)).toBe(0);
    expect(axisOffsetPx(sheet, "col", 3)).toBe(64 + 145);
    expect(axisOffsetPx(sheet, "row", 4)).toBe(20 + 40 + 20);
    expect(axisAtPx(sheet, "col", 100)).toMatchObject({ index: 2 });
    expect(axisAtPx(sheet, "col", 100).off).toBe(36);
    expect(axisAtPx(sheet, "row", 79)).toEqual({ index: 3, off: 19 });
    expect(axisAtPx(sheet, "row", 80)).toEqual({ index: 4, off: 0 });
    const p = s.addImage("Data", { src: SRC, from: { row: 3, col: 2, dx: 10, dy: 5 }, width: 150, height: 70 });
    expect(imageBox(s.sheet("Data"), p)).toEqual({ left: 74, top: 65, width: 150, height: 70 });
  });

  it("move with their cell and keep their size, as before", () => {
    const s = make();
    const p = sized(s, "move");
    s.setRowHeight("Data", 3, 60);
    expect(s.images("Data")[0]!).toMatchObject({ from: p.from, width: 150, height: 70 });
    s.insertRows("Data", 1, 2);
    expect(s.images("Data")[0]!.from).toMatchObject({ row: 5, col: 2 });
  });

  it("size with their cells: stretch when a row or column under them does, grow when one is inserted inside", () => {
    const s = make();
    const p = sized(s, "size");
    // from row 3 (+5) and col 2 (+10), 150 by 70: the corner is in column 4 and row 6 ((20*3-5... see below)
    const to = s.images("Data")[0]!.to!;
    expect(to).toMatchObject({ col: 4, row: 6 });
    expect(p.placement).toBe("size");
    s.setRowHeight("Data", 4, 60); // row 4 goes from 20 to 80 pixels: 60 more
    expect(s.images("Data")[0]!.height).toBe(130);
    s.setColumnWidth("Data", 3, 20); // column 3: 64 to 145 pixels
    expect(s.images("Data")[0]!.width).toBe(150 + 81);
    s.insertRows("Data", 4, 2); // two rows inside it
    expect(s.images("Data")[0]!.height).toBe(130 + 40);
    expect(s.images("Data")[0]!.to!.row).toBe(8);
    s.insertRows("Data", 1, 3); // above it: it moves, its size stays
    expect(s.images("Data")[0]!).toMatchObject({ height: 170, from: { row: 6 }, to: { row: 11 } });
    s.deleteRows("Data", 7, 2); // two of its rows go
    expect(s.images("Data")[0]!.height).toBeLessThan(170);
    s.undo();
    s.undo();
    s.undo();
    expect(s.images("Data")[0]!.height).toBe(130);
  });

  it("size with their cells follows a row being hidden and shown", () => {
    const s = make();
    sized(s, "size");
    const h = s.images("Data")[0]!.height;
    s.transact([{ type: "set_size", sheet: s.sheet("Data").id, axis: "row", index: 4, hidden: true }]);
    expect(s.images("Data")[0]!.height).toBe(h - 20);
    s.transact([{ type: "set_size", sheet: s.sheet("Data").id, axis: "row", index: 4, hidden: null }]);
    expect(s.images("Data")[0]!.height).toBe(h);
  });

  it("move and size with the cells again after the placement is changed", () => {
    const s = make();
    const p = sized(s, "move");
    s.updateImage("Data", p.id, { placement: "size" });
    expect(s.images("Data")[0]!.to).toBeDefined();
    s.updateImage("Data", p.id, { placement: "move" });
    expect(s.images("Data")[0]!.to).toBeUndefined();
    expect(s.images("Data")[0]!.placement).toBeUndefined();
    // Dragging one that sizes with its cells moves its other corner too.
    s.updateImage("Data", p.id, { placement: "size" });
    s.updateImage("Data", p.id, { from: { row: 1, col: 1 }, width: 64, height: 20 });
    expect(s.images("Data")[0]!.to).toMatchObject({ row: 2, col: 2 });
  });

  it("stay where they are on the sheet when they are free, whatever rows and columns do above and left", () => {
    const s = make();
    const p = sized(s, "free");
    const before = imageBox(s.sheet("Data"), p);
    s.setRowHeight("Data", 1, 60);
    expect(imageBox(s.sheet("Data"), s.images("Data")[0]!)).toMatchObject({ left: before.left, top: before.top });
    s.insertRows("Data", 1, 5);
    s.insertColumns("Data", 1, 2);
    s.transact([{ type: "set_size", sheet: s.sheet("Data").id, axis: "row", index: 2, hidden: true }]);
    expect(imageBox(s.sheet("Data"), s.images("Data")[0]!)).toMatchObject({ left: before.left, top: before.top, width: 150, height: 70 });
    s.deleteRows("Data", 1, 3);
    expect(imageBox(s.sheet("Data"), s.images("Data")[0]!).top).toBe(before.top);
  });

  it("are checked: a size placement needs its corner, others have none", () => {
    const s = make();
    const p = sized(s, "move");
    expect(() => s.updateImage("Data", p.id, { placement: "sideways" as never })).toThrow(/move/);
    const good = s.images("Data")[0]!;
    expect(() => s.transact([{ type: "update_image", sheet: s.sheet("Data").id, image: { ...good, placement: "size" } }])).toThrow(/bottom right/);
    expect(() => s.transact([{ type: "update_image", sheet: s.sheet("Data").id, image: { ...good, to: { row: 2, col: 2 } } }])).toThrow(/Only a picture/);
  });
});

describe("copying a picture to another sheet", () => {
  it("makes a copy there at the cell given, or the same cell, and undoes in one step", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, from: { row: 2, col: 2 }, width: 100, height: 50, alt: "Box", rotation: 10, crop: { left: 0.1 } });
    const q = s.copyImage("Data", p.id, { sheet: "Other" });
    expect(q.id).not.toBe(p.id);
    expect(s.images("Other")[0]!).toMatchObject({ from: { row: 2, col: 2 }, width: 100, height: 50, alt: "Box", rotation: 10, crop: { left: 0.1 }, src: SRC });
    const r = s.copyImage("Data", p.id, { sheet: "Other", from: { row: 5, col: 1 } });
    expect(s.images("Other")[1]!.from).toEqual({ row: 5, col: 1 });
    const d = s.copyImage("Data", p.id);
    expect(s.images("Data")).toHaveLength(2);
    expect(d.from).toMatchObject({ dx: 24, dy: 24 });
    s.undo();
    expect(s.images("Data")).toHaveLength(1);
    expect(r.id).toBeTruthy();
    expect(() => s.copyImage("Data", "nope")).toThrow();
  });

  it("keeps how a size-with-cells picture follows its cells, working out its corner on the new sheet", () => {
    const s = make();
    s.setRowHeight("Other", 2, 60);
    const p = s.addImage("Data", { src: SRC, from: { row: 1, col: 1 }, width: 64, height: 40, placement: "size" });
    const q = s.copyImage("Data", p.id, { sheet: "Other", from: { row: 2, col: 1 } });
    expect(q.placement).toBe("size");
    expect(q.to).toMatchObject({ row: 2 });
  });
});

describe("in XLSX files", () => {
  const write = (s: SheetSession) => unzipSync(toXlsx(s.state));
  const drawing = (s: SheetSession) => {
    const f = write(s);
    const name = Object.keys(f).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    return strFromU8(f[name]!);
  };

  it("writes the kind of anchor that matches how a picture follows its cells, and reads it back", () => {
    const s = make();
    s.addImage("Data", { src: SRC, from: { row: 2, col: 2, dx: 5, dy: 5 }, width: 100, height: 40 });
    s.addImage("Data", { src: SRC, from: { row: 5, col: 2 }, width: 130, height: 45, placement: "size" });
    s.addImage("Data", { src: SRC, from: { row: 9, col: 3, dx: 7 }, width: 70, height: 33, placement: "free" });
    const xml = drawing(s);
    expect(xml).toContain("<xdr:oneCellAnchor>");
    expect(xml).toContain('<xdr:twoCellAnchor editAs="twoCell">');
    expect(xml).toContain('<xdr:twoCellAnchor editAs="absolute">');
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const [a, b, c] = workbook.sheets[0]!.images!;
    expect(a!.placement).toBeUndefined();
    expect(b!).toMatchObject({ placement: "size", from: { row: 5, col: 2 }, width: 130, height: 45 });
    expect(b!.to).toBeDefined();
    expect(c!).toMatchObject({ placement: "free", from: { row: 9, col: 3, dx: 7 }, width: 70, height: 33 });
  });

  it("writes the crop as srcRect and the rotation and flips on the shape, and reads them back", () => {
    const s = make();
    s.addImage("Data", { src: SRC, width: 100, height: 40, rotation: 30.5, flipH: true, flipV: true, crop: { left: 0.1, top: 0.2, right: 0.05, bottom: 0.25 } });
    const xml = drawing(s);
    expect(xml).toContain('<a:srcRect l="10000" t="20000" r="5000" b="25000"/>');
    expect(xml).toContain('<a:xfrm rot="1830000" flipH="1" flipV="1">');
    const img = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
    expect(img).toMatchObject({ rotation: 30.5, flipH: true, flipV: true, crop: { left: 0.1, top: 0.2, right: 0.05, bottom: 0.25 }, width: 100, height: 40 });
  });

  it("reads an absolute anchor as a free picture at the cell that is there", () => {
    const s = make();
    s.addImage("Data", { src: SRC, from: { row: 4, col: 3, dx: 10, dy: 4 }, width: 90, height: 30 });
    const files = write(s);
    const name = Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    const left = 64 * 2 + 10;
    const top = 20 * 3 + 4;
    const emu = (n: number) => n * 9525;
    const xml = strFromU8(files[name]!).replace(/<xdr:oneCellAnchor>.*?<\/xdr:from><xdr:ext cx="(\d+)" cy="(\d+)"\/>/, (_m, cx, cy) => `<xdr:absoluteAnchor><xdr:pos x="${emu(left)}" y="${emu(top)}"/><xdr:ext cx="${cx}" cy="${cy}"/>`).replace("</xdr:oneCellAnchor>", "</xdr:absoluteAnchor>");
    const zipped = unzipSync(toXlsx(s.state));
    zipped[name] = new TextEncoder().encode(xml);
    return import("fflate").then(({ zipSync }) => {
      const img = fromXlsx(zipSync(zipped)).workbook.sheets[0]!.images![0]!;
      expect(img).toMatchObject({ placement: "free", from: { row: 4, col: 3, dx: 10, dy: 4 }, width: 90, height: 30 });
    });
  });
});
