import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/* What the kit files (01 to 21) showed Excel for Mac does to a file when it saves it, and that Pli has to read as it was. */

const edit = (bytes: Uint8Array, path: string, fn: (t: string) => string) => {
  const files = unzipSync(bytes);
  files[path] = strToU8(fn(strFromU8(files[path]!)));
  return zipSync(files);
};

describe("a file Excel for Mac saved", () => {
  it("a column that only carries an outline level keeps no size when Excel writes its default width on it", () => {
    const s = new SheetSession(createWorkbook("T", ["A"]));
    s.setCell("A", "C1", 1);
    s.groupColumns("A", 3, 4);
    const bytes = toXlsx(s.state);
    const saved = edit(bytes, "xl/worksheets/sheet1.xml", (t) => t.replace(/width="8\.43"/g, 'width="8.5"'));
    const sheet = fromXlsx(saved).workbook.sheets[0]!;
    expect(sheet.columns?.["C"]).toEqual({ level: 1 });
    expect(sheet.columns?.["D"]).toEqual({ level: 1 });
    const custom = edit(bytes, "xl/worksheets/sheet1.xml", (t) => t.replace(/<col min="3" max="3" width="8\.43"/, '<col min="3" max="3" customWidth="1" width="8.5"'));
    expect(fromXlsx(custom).workbook.sheets[0]!.columns?.["C"]).toEqual({ size: 8.5, level: 1 });
  });

  it("a link whose Hyperlink style Excel wrote out as plain colour is still a link with the link look", () => {
    const s = new SheetSession(createWorkbook("T", ["A"]));
    s.setCell("A", "A1", "site");
    s.setLink("A", "A1", { to: "https://pli.dev" });
    const bytes = toXlsx(s.state);
    const saved = edit(bytes, "xl/styles.xml", (t) => t.replace('<color theme="10"/>', '<color rgb="FF0563C1"/>').replace('<color theme="11"/>', '<color rgb="FF954F72"/>'));
    const cell = fromXlsx(saved).workbook.sheets[0]!.cells["A1"]!;
    expect(cell.link?.to).toBe("https://pli.dev");
    expect(cell.s?.color).toBeUndefined();
  });
});
