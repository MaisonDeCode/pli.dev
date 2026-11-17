import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, decodeImage, decodePng, encodePng, fromXlsx, readImage, toDataUri, toXlsx } from "../src";
import { GIFS, JPEGS } from "./image-fixtures";
import { GIF_1X1, JPEG_1X1, pngUri } from "./images-helpers";

/**
 * LibreOffice keeps pictures. A file Pli writes must open there with them where they were put, at the size they were
 * given, and what it writes back must read the same. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-images-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("pictures through LibreOffice", () => {
  it("opens pictures of each kind and writes them back where they were, the size they were", () => {
    const s = new SheetSession(createWorkbook("pictures", ["Data", "Other"]));
    s.setValues("Data", "A1", [["Logo here"]]);
    s.addImage("Data", { src: pngUri(60, 30, [10, 120, 10]), from: { row: 3, col: 2 }, width: 120, height: 60, alt: "Green box" });
    s.addImage("Data", { src: JPEG_1X1, from: { row: 8, col: 4, dx: 10, dy: 5 }, width: 50, height: 40 });
    s.addImage("Other", { src: GIF_1X1, from: { row: 2, col: 2 }, width: 30, height: 30 });

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const [data, other] = back.workbook.sheets;
    expect(back.warnings).toEqual([]);
    expect(data!.images).toHaveLength(2);
    const [green, jpg] = data!.images!;
    expect(green!.from).toMatchObject({ row: 3, col: 2 });
    expect(green!.width).toBeGreaterThan(115);
    expect(green!.width).toBeLessThan(125);
    expect(green!.height).toBeGreaterThan(55);
    expect(green!.height).toBeLessThan(65);
    expect(green!.alt).toBe("Green box");
    expect(readImage(green!.src)).toMatchObject({ type: "png", width: 60, height: 30 });
    expect(jpg!.from).toMatchObject({ row: 8, col: 4 });
    expect(readImage(jpg!.src).type).toBe("jpeg");
    expect(other!.images).toHaveLength(1);
    expect(readImage(other!.images![0]!.src).type).toBe("gif");
  });

  it("keeps the crop, rotation, flips and how a picture follows its cells", () => {
    const s = new SheetSession(createWorkbook("pictures", ["Data"]));
    s.addImage("Data", { src: pngUri(60, 30, [10, 120, 10]), from: { row: 2, col: 2 }, width: 90, height: 50, rotation: 30, flipH: true, crop: { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 } });
    s.addImage("Data", { src: pngUri(60, 30, [120, 10, 10]), from: { row: 8, col: 2 }, width: 128, height: 60, placement: "size" });
    s.addImage("Data", { src: pngUri(60, 30, [10, 10, 120]), from: { row: 14, col: 2 }, width: 70, height: 40, placement: "free" });
    writeFileSync(join(dir, "g.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "g.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "g.xlsx"))));
    const [a, b, c] = back.workbook.sheets[0]!.images!;
    expect(a!.rotation).toBeCloseTo(30, 0);
    expect(a!.flipH).toBe(true);
    expect(a!.crop!.left).toBeCloseTo(0.1, 2);
    expect(a!.crop!.top).toBeCloseTo(0.2, 2);
    expect(a!.crop!.right).toBeCloseTo(0.1, 2);
    expect(a!.crop!.bottom).toBeCloseTo(0.2, 2);
    expect(a!.placement).toBeUndefined();
    expect(b!.placement).toBe("size");
    expect(b!.width).toBeGreaterThan(120);
    expect(b!.width).toBeLessThan(136);
    expect(c!.placement).toBe("free");
  });

  it("keeps a picture's border, shadow and grey shades", () => {
    const s = new SheetSession(createWorkbook("pictures", ["Data"]));
    s.addImage("Data", { src: pngUri(60, 30, [10, 120, 10]), from: { row: 2, col: 2 }, width: 90, height: 50, border: { color: "#ff8800", width: 3 }, shadow: { color: "#000000", blur: 8, distance: 6, angle: 45, opacity: 0.5 }, grayscale: true });
    writeFileSync(join(dir, "h.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "h.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const [img] = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "h.xlsx")))).workbook.sheets[0]!.images!;
    expect(img!.border?.color).toBe("#ff8800");
    expect(img!.border?.width).toBeCloseTo(3, 0);
    expect(img!.shadow).toBeDefined();
    expect(img!.grayscale).toBe(true); // brightness and contrast are not something LibreOffice writes back
  });

  it("opens a picture with a glow, soft edges, a reflection and an artistic effect, and keeps the artistic effect", () => {
    const s = new SheetSession(createWorkbook("pictures", ["Data"]));
    const data = new Uint8ClampedArray(30 * 20 * 4);
    for (let i = 0; i < 600; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);
    s.addImage("Data", { src: toDataUri(encodePng({ width: 30, height: 20, data }), "png"), from: { row: 2, col: 2 }, width: 90, height: 60, glow: { radius: 8 }, softEdge: 5, reflection: { size: 0.4 }, artistic: { kind: "mosaic", level: 60 } });
    writeFileSync(join(dir, "i.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "i.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "i.xlsx"))));
    const [img] = back.workbook.sheets[0]!.images!;
    // It opens and the picture is kept at its place and size; LibreOffice keeps the artistic effect's layer and writes it back too, so the effect survives.
    expect(img!.from).toMatchObject({ row: 2, col: 2 });
    expect(img!.width).toBeGreaterThan(85);
    expect(img!.width).toBeLessThan(95);
    expect(img!.artistic).toMatchObject({ kind: "mosaic" });
    const drawn = decodePng(Uint8Array.from(atob(img!.src.split(",")[1]!), (c) => c.charCodeAt(0)));
    expect(drawn).not.toBeNull();
  });
});

describe.skipIf(!SOFFICE)("cropped to a shape, and effects on JPEG and GIF pictures, through LibreOffice", () => {
  const through = (s: SheetSession, name: string) => {
    writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
    return fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`))));
  };

  it("opens pictures cropped to shapes and draws them in those shapes (what it writes back is a shape filled with the picture)", () => {
    const s = new SheetSession(createWorkbook("shapes", ["Data"]));
    const shapes = ["ellipse", "roundRect", "star5", "rightArrow", "triangle", "hexagon"] as const;
    shapes.forEach((shape, i) => s.addImage("Data", { src: pngUri(60, 40, [200, 30, 30]), from: { row: 2 + i * 6, col: 2 }, width: 90, height: 60, shape }));
    through(s, "shapes");
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, "out", "shapes.xlsx"))));
    const xml = strFromU8(files[Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!]!);
    expect([...xml.matchAll(/prst="(\w+)"/g)].map((m) => m[1])).toEqual([...shapes]);
  });

  it("opens a JPEG and a GIF with an artistic effect and keeps the effect and the original", () => {
    const s = new SheetSession(createWorkbook("fx", ["Data"]));
    s.addImage("Data", { src: `data:image/jpeg;base64,${JPEGS["baseline420"]!.file}`, from: { row: 2, col: 2 }, width: 94, height: 62, artistic: { kind: "watercolorSponge", level: 3 } });
    s.addImage("Data", { src: `data:image/gif;base64,${GIFS["plain"]!.file}`, from: { row: 10, col: 2 }, width: 94, height: 62, artistic: { kind: "paintStrokes", level: 7 } });
    const back = through(s, "fxjpeg");
    const [jpeg, gif] = back.workbook.sheets[0]!.images!;
    expect(jpeg!.artistic).toEqual({ kind: "watercolorSponge", level: 3 });
    // the original is an HD Photo file in the package, which LibreOffice carries through untouched, and comes back as a PNG of the same pixels
    expect(readImage(jpeg!.src).type).toBe("png");
    expect(decodePng(Uint8Array.from(atob(jpeg!.src.split(",")[1]!), (c) => c.charCodeAt(0)))!.data).toEqual(decodeImage(Uint8Array.from(atob(JPEGS["baseline420"]!.file), (c) => c.charCodeAt(0)))!.data);
    expect(gif!.artistic).toEqual({ kind: "paintStrokes", level: 7 });
    expect(readImage(gif!.src).type).toBe("png");
  });
});
