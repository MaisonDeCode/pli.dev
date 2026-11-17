import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { MAX_COLS, MAX_ROWS, ProtectionError, SheetSession, anyLocked, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, type Cell, type Sheet } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("More", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null], ["Ink", 2, null]]);
  return s;
};
const refused = (fn: () => void, pattern?: RegExp): ProtectionError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProtectionError);
    if (pattern) expect((e as Error).message).toMatch(pattern);
    return e as ProtectionError;
  }
  throw new Error("expected the edit to be refused");
};
const sheetXml = (s: SheetSession, n = 1) => strFromU8(unzipSync(toXlsx(s.state))[`xl/worksheets/sheet${n}.xml`]!);

describe("locks that columns and rows carry", () => {
  it("a whole column unlocked takes the cells that exist and those made later", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    expect(s.state.sheets[0]!.columns).toEqual({ B: { locked: false } });
    // The cells that exist take it from the column and need no lock of their own.
    expect(s.cell("Sheet1", "B2")!.s).toBeUndefined();
    expect(s.isLocked("Sheet1", "B2")).toBe(false);
    expect(s.isLocked("Sheet1", "B900")).toBe(false);
    expect(s.isLocked("Sheet1", "A2")).toBe(true);
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B2", 11);
    s.setCell("Sheet1", "B900", "new");
    refused(() => s.setCell("Sheet1", "A2", "no"), /locked/);
    // Clearing a cell of the column leaves it unlocked.
    s.clear("Sheet1", "B2", "all");
    expect(s.canEdit("Sheet1", "B2")).toBe(true);
  });

  it("whole rows win over the column they cross, and the last one set wins", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.setLocked("Sheet1", "3:3", false);
    expect(s.isLocked("Sheet1", "A3")).toBe(false);
    expect(s.isLocked("Sheet1", "A4")).toBe(true);
    // Locking row 2 afterwards keeps it locked even where the unlocked column crosses it.
    s.setLocked("Sheet1", "2:2", true);
    expect(s.isLocked("Sheet1", "B2")).toBe(true);
    expect(s.isLocked("Sheet1", "B5")).toBe(false);
    // And unlocking the column again later wins at the crossing.
    s.setLocked("Sheet1", "B:B", false);
    expect(s.isLocked("Sheet1", "B2")).toBe(false);
    expect(s.isLocked("Sheet1", "A2")).toBe(true);
  });

  it("an explicit lock in an unlocked column is kept, and locking a whole column again takes the cells with it", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.setStyle("Sheet1", "B3", { locked: true });
    expect(s.cell("Sheet1", "B3")!.s).toEqual({ locked: true });
    expect(s.isLocked("Sheet1", "B3")).toBe(true);
    s.setLocked("Sheet1", "B:B", true);
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    expect(s.cell("Sheet1", "B3")!.s).toBeUndefined();
    expect(s.isLocked("Sheet1", "B3")).toBe(true);
  });

  it("selecting the whole sheet unlocks every cell, and locking a column puts a lock back", () => {
    const s = make();
    s.setStyle("Sheet1", "C2", { locked: false });
    s.setStyle("Sheet1", `A1:XFD${MAX_ROWS}`, { locked: false });
    const sheet = s.state.sheets[0]!;
    expect(sheet.unlocked).toBe(true);
    expect(sheet.cells["C2"]).toBeUndefined();
    expect(s.isLocked("Sheet1", "Z99")).toBe(false);
    s.setLocked("Sheet1", "A:A", true);
    expect(s.state.sheets[0]!.columns).toEqual({ A: { locked: true } });
    expect(s.isLocked("Sheet1", "A1")).toBe(true);
    expect(s.isLocked("Sheet1", "B1")).toBe(false);
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B1", "ok");
    refused(() => s.setCell("Sheet1", "A1", "no"));
    refused(() => s.setCell("Sheet1", "A99", "no"));
  });

  it("undoes as one step and is refused on a protected sheet", () => {
    const s = make();
    s.setLocked("Sheet1", "B:C", false);
    expect(s.state.sheets[0]!.columns).toEqual({ B: { locked: false }, C: { locked: false } });
    s.undo();
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    s.redo();
    expect(s.isLocked("Sheet1", "C7")).toBe(false);
    s.protectSheet("Sheet1");
    refused(() => s.setLocked("Sheet1", "A:A", false), /locked/);
    refused(() => s.setStyle("Sheet1", "D:D", { locked: false }));
    // The history is forgotten by protecting, so undo can't unlock a column.
    expect(s.canUndo).toBe(false);
  });

  it("is carried by rows and columns that are inserted next to them", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.insertColumns("Sheet1", 3, 1);
    // The column inserted after B takes B's lock; C moved to D.
    expect(s.isLocked("Sheet1", "C5")).toBe(false);
    s.insertColumns("Sheet1", 1, 1);
    expect(s.state.sheets[0]!.columns).toEqual({ C: { locked: false }, D: { locked: false } });
    expect(s.isLocked("Sheet1", "B5")).toBe(true);
    s.setLocked("Sheet1", "5:5", false);
    s.insertRows("Sheet1", 6, 2);
    expect(s.isLocked("Sheet1", "A6")).toBe(false);
    expect(s.isLocked("Sheet1", "A7")).toBe(false);
    expect(s.isLocked("Sheet1", "A8")).toBe(true);
    s.deleteRows("Sheet1", 5, 4);
    expect(s.state.sheets[0]!.rows).toBeUndefined();
    s.protectSheet("Sheet1");
    // Cells made in the inserted column are unlocked on the protected sheet.
    s.setCell("Sheet1", "C30", "x");
  });

  it("is checked by every way of changing cells: paste, fill, move, sort, clear", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.protectSheet("Sheet1", { allow: ["sort", "formatCells"] });
    s.copy({ sheet: "Sheet1", range: "B2:B3" }, { sheet: "Sheet1", at: "B5" });
    refused(() => s.copy({ sheet: "Sheet1", range: "B2:B3" }, { sheet: "Sheet1", at: "A5" }));
    s.move({ sheet: "Sheet1", range: "B2" }, { sheet: "Sheet1", at: "B8" });
    refused(() => s.move({ sheet: "Sheet1", range: "B3" }, { sheet: "Sheet1", at: "C8" }));
    refused(() => s.move({ sheet: "Sheet1", range: "A2" }, { sheet: "Sheet1", at: "B9" }));
    // Pasting what has a lock of its own can't change whether a cell in the column is locked.
    s.setStyle("Sheet1", "B3", { bold: true });
    expect(s.isLocked("Sheet1", "B3")).toBe(false);
    s.clear("Sheet1", "B5:B6", "all");
    expect(s.isLocked("Sheet1", "B5")).toBe(false);
    refused(() => s.clear("Sheet1", "A2:A3", "contents"));
  });

  it("answers quickly and exactly for large ranges", () => {
    const s = make();
    const sheet = (): Sheet => s.state.sheets[0]!;
    const brute = (b: { r1: number; c1: number; r2: number; c2: number }) => {
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if (s.isLocked("Sheet1", `${String.fromCharCode(64 + c)}${r}`)) return true;
      return false;
    };
    s.setLocked("Sheet1", "B:D", false);
    s.setLocked("Sheet1", "3:3", false);
    s.setStyle("Sheet1", "F5", { locked: false });
    for (const b of [
      { r1: 1, c1: 2, r2: 40, c2: 4 },
      { r1: 2, c1: 2, r2: 40, c2: 4 },
      { r1: 3, c1: 1, r2: 3, c2: 9 },
      { r1: 5, c1: 6, r2: 5, c2: 6 },
      { r1: 4, c1: 5, r2: 9, c2: 7 },
      { r1: 6, c1: 2, r2: 30, c2: 3 },
    ]) expect(anyLocked(sheet(), b), JSON.stringify(b)).toBe(brute(b));
    expect(anyLocked(sheet(), { r1: 1, c1: 2, r2: MAX_ROWS, c2: 4 })).toBe(false);
    expect(anyLocked(sheet(), { r1: 1, c1: 1, r2: MAX_ROWS, c2: 4 })).toBe(true);
    s.setLocked("Sheet1", `A1:XFD${MAX_ROWS}`, false);
    expect(anyLocked(sheet(), { r1: 1, c1: 1, r2: MAX_ROWS, c2: MAX_COLS })).toBe(false);
  });

  it("is kept in the saved workbook and checked when it is loaded", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.setLocked("Sheet1", "4:4", false);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.columns).toEqual({ B: { locked: false } });
    expect(back.sheets[0]!.rows).toEqual({ "4": { locked: false } });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].columns.B.locked = "no";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    const bad2 = JSON.parse(serializeWorkbook(s.state));
    bad2.workbook.sheets[0].unlocked = false;
    expect(() => parseWorkbook(JSON.stringify(bad2))).toThrow();
  });
});

describe("locks that columns and rows carry, in XLSX files", () => {
  it("writes column and row styles with the lock and reads them back", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.setLocked("Sheet1", "3:3", false);
    s.setStyle("Sheet1", "B4", { locked: true });
    const xml = sheetXml(s);
    expect(xml).toMatch(/<col min="2" max="2" width="8.43" style="\d+"\/>/);
    expect(xml).toMatch(/<row r="3" s="\d+" customFormat="1">/);
    const styles = strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);
    expect(styles).toMatch(/<protection locked="0"\/>/);
    const read = fromXlsx(toXlsx(s.state));
    expect(read.warnings).toEqual([]);
    const back = read.workbook.sheets[0]!;
    expect(back.columns).toEqual({ B: { locked: false } });
    expect(back.rows).toEqual({ "3": { locked: false } });
    const again = new SheetSession(read.workbook);
    expect(again.isLocked("Sheet1", "B2")).toBe(false);
    expect(again.isLocked("Sheet1", "B4")).toBe(true);
    expect(again.cell("Sheet1", "B4")!.s).toEqual({ locked: true });
    expect(again.isLocked("Sheet1", "A3")).toBe(false);
    expect(again.isLocked("Sheet1", "A4")).toBe(true);
  });

  it("writes the lock a cell has, from its column, in the cell's own style as Excel does", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    const xfs = [...strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!).match(/<cellXfs[^>]*>(.*)<\/cellXfs>/s)![1]!.matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/gs)].map((m) => m[0]!);
    const xml = sheetXml(s);
    const styleOf = (address: string) => Number(new RegExp(`<c r="${address}"(?: s="(\\d+)")?`).exec(xml)![1] ?? 0);
    expect(xfs[styleOf("B2")]).toContain('<protection locked="0"/>');
    expect(xfs[styleOf("A2")] ?? "").not.toContain("locked");
  });

  it("writes an unlocked sheet as styled columns over the whole sheet, and reads it back as the sheet's lock", () => {
    const s = make();
    s.setStyle("Sheet1", `A1:XFD${MAX_ROWS}`, { locked: false });
    s.setLocked("Sheet1", "C:C", true);
    const xml = sheetXml(s);
    expect(xml).toMatch(/<col min="1" max="2" width="8.43" style="\d+"\/><col min="3" max="3" width="8.43"\/><col min="4" max="16384" width="8.43" style="\d+"\/>/);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.unlocked).toBe(true);
    expect(back.columns).toEqual({ C: { locked: true } });
    const again = new SheetSession({ ...fromXlsx(toXlsx(s.state)).workbook });
    expect(again.isLocked("Sheet1", "Z5")).toBe(false);
    expect(again.isLocked("Sheet1", "C5")).toBe(true);
  });

  it("reads what Excel writes: a column style that unlocks, and cells in it that are locked again", () => {
    const s = make();
    s.setLocked("Sheet1", "B:B", false);
    s.setStyle("Sheet1", "B3", { locked: true });
    const read = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(read.cells["B2"]!.s).toBeUndefined();
    expect(read.cells["B3"]!.s).toEqual({ locked: true });
  });
});

describe("ranges that people may edit", () => {
  it("lets anyone edit a locked range that has no password and no permissions", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["b2:b4"] });
    expect(s.editRanges("Sheet1")).toEqual([{ name: "Quantities", ranges: ["B2:B4"] }]);
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B2", 12);
    refused(() => s.setCell("Sheet1", "B5", 1), /locked/);
    refused(() => s.setCell("Sheet1", "A2", "x"));
  });

  it("asks for the password of a range, and remembers it for the session", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Prices", ranges: ["B2:C4"], password: "open" });
    s.protectSheet("Sheet1");
    const why = refused(() => s.setCell("Sheet1", "C3", 5), /password/);
    expect(why.editRange).toEqual({ sheet: s.state.sheets[0]!.id, name: "Prices" });
    expect(s.canEdit("Sheet1", "C3")).toBe(false);
    expect(s.editBlock("Sheet1", "C3")!.editRange?.name).toBe("Prices");
    refused(() => s.unlockEditRange("Sheet1", "Prices", "wrong"), /isn't right/);
    expect(s.editRangeOpen("Sheet1", "Prices")).toBe(false);
    s.unlockEditRange("Sheet1", "prices", "open");
    expect(s.editRangeOpen("Sheet1", "Prices")).toBe(true);
    s.setCell("Sheet1", "C3", 5);
    s.setValues("Sheet1", "B2", [[1, 2], [3, 4]]);
    // Outside the range is still locked, and no password was kept.
    refused(() => s.setCell("Sheet1", "A2", "x"), /locked/);
    expect(JSON.stringify(s.state)).not.toContain("open");
    s.lockEditRanges();
    refused(() => s.setCell("Sheet1", "C3", 6), /password/);
  });

  it("closes a range when its password is changed, and needs unprotecting to change it", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Prices", ranges: ["B2:C4"], password: "open" });
    s.unlockEditRange("Sheet1", "Prices", "open");
    s.updateEditRange("Sheet1", "Prices", { password: "other" });
    s.protectSheet("Sheet1");
    refused(() => s.setCell("Sheet1", "C3", 5), /password/);
    refused(() => s.addEditRange("Sheet1", { name: "More", ranges: ["D1"] }), /protected/);
    refused(() => s.deleteEditRange("Sheet1", "Prices"));
    refused(() => s.updateEditRange("Sheet1", "Prices", { password: null }));
    s.unprotectSheet("Sheet1");
    s.updateEditRange("Sheet1", "Prices", { password: null });
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "C3", 5);
  });

  it("checks titles and ranges, follows inserted rows, and goes with deleted ones", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Qty", ranges: ["B2:B4", "D1"] });
    expect(() => s.addEditRange("Sheet1", { name: "qty", ranges: ["A1"] })).toThrow(/already/);
    expect(() => s.addEditRange("Sheet1", { name: "", ranges: ["A1"] })).toThrow();
    expect(() => s.addEditRange("Sheet1", { name: "Bad", ranges: ["nonsense"] })).toThrow(/isn't a range/);
    expect(() => s.addEditRange("Sheet1", { name: "Empty", ranges: [] })).toThrow();
    s.insertRows("Sheet1", 1, 2);
    expect(s.editRanges("Sheet1")[0]!.ranges).toEqual(["B4:B6", "D3"]);
    s.deleteRows("Sheet1", 4, 3);
    expect(s.editRanges("Sheet1")[0]!.ranges).toEqual(["D3"]);
    s.deleteColumns("Sheet1", 4, 1);
    expect(s.editRanges("Sheet1")).toEqual([]);
    expect(s.state.sheets[0]!.editRanges).toBeUndefined();
    s.undo();
    expect(s.editRanges("Sheet1")).toHaveLength(1);
  });

  it("can't be got round by undo", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Prices", ranges: ["B2:C4"], password: "open" });
    s.unlockEditRange("Sheet1", "Prices", "open");
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "C3", 5);
    expect(s.canUndo).toBe(true);
    // Closing the range forgets the history: undoing could otherwise change cells that are locked again.
    s.lockEditRanges();
    expect(s.canUndo).toBe(false);
    expect(s.cell("Sheet1", "C3")!.v).toBe(5);
    expect(s.undo()).toBe(false);
  });

  it("is saved with the workbook and checked when it is loaded", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Prices", ranges: ["B2:C4"], password: "open", permissions: ["finance"] });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.editRanges).toEqual(s.state.sheets[0]!.editRanges);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].editRanges[0].ranges = ["zz"];
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].editRanges[0] = { name: "x", ranges: ["A1"], extra: 1 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
  });

  it("is written as Excel's protectedRanges, with the password, and read back", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Open", ranges: ["A2:A4"] });
    s.addEditRange("Sheet1", { name: "Prices & more", ranges: ["B2:B4", "C2"], password: "pli" });
    s.protectSheet("Sheet1");
    const xml = sheetXml(s);
    expect(xml).toMatch(/<\/sheetData><sheetProtection[^>]*\/><protectedRanges><protectedRange sqref="A2:A4" name="Open"\/><protectedRange algorithmName="SHA-512" hashValue="[^"]+" saltValue="[^"]+" spinCount="100000" sqref="B2:B4 C2" name="Prices &amp; more"\/><\/protectedRanges>/);
    const read = fromXlsx(toXlsx(s.state));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[0]!.editRanges).toEqual(s.state.sheets[0]!.editRanges);
    const back = new SheetSession(read.workbook);
    back.setCell("Sheet1", "A2", "free");
    refused(() => back.setCell("Sheet1", "B2", 1), /password/);
    back.unlockEditRange("Sheet1", "Prices & more", "pli");
    back.setCell("Sheet1", "B2", 1);
  });

  it("reads an old file's 16-bit password for a range", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/(<sheetProtection[^>]*\/>)/, '$1<protectedRanges><protectedRange password="83AF" sqref="$B$2:$B$4" name="Qty"/></protectedRanges>'));
    const read = fromXlsx(zipSync(files));
    expect(read.workbook.sheets[0]!.editRanges).toEqual([{ name: "Qty", ranges: ["B2:B4"], password: { algorithm: "legacy", hash: "83AF" } }]);
    const back = new SheetSession(read.workbook);
    refused(() => back.unlockEditRange("Sheet1", "Qty", "nope"));
    back.unlockEditRange("Sheet1", "Qty", "password");
    back.setCell("Sheet1", "B3", 1);
  });

  it("says when an Excel range names Windows accounts it can't read, and keeps it closed to all but the password", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/(<sheetProtection[^>]*\/>)/, '$1<protectedRanges><protectedRange sqref="B2:B4" name="Qty" securityDescriptor="O:SYG:SYD:(OA;;CC;guid;;WD)"/></protectedRanges>'));
    const read = fromXlsx(zipSync(files));
    expect(read.warnings.some((w) => /Windows accounts/.test(w))).toBe(true);
    const back = new SheetSession(read.workbook);
    refused(() => back.setCell("Sheet1", "B3", 1), /only some people/);
  });

  it("reads the accounts an Excel range names, and Everyone lets anyone in", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/(<sheetProtection[^>]*\/>)/, '$1<protectedRanges><protectedRange sqref="B2:B4" name="Qty" securityDescriptor="O:SYG:SYD:(A;;CC;;;WD)"/></protectedRanges>'));
    const read = fromXlsx(zipSync(files));
    expect(read.warnings).toEqual([]);
    const back = new SheetSession(read.workbook);
    back.setCell("Sheet1", "B3", 1);
  });
});

describe("who may do what", () => {
  const protectedFor = () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Finance", ranges: ["C2:C4"], permissions: ["finance", "user:ada"] });
    s.addEditRange("Sheet1", { name: "Either", ranges: ["B2:B4"], permissions: ["clerk"], password: "pw" });
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "selectUnlockedCells"], roles: { formatCells: ["designer"], sort: ["analyst", "designer"] }, editLocked: ["owner"] });
    return s;
  };

  it("lets a role edit the range that names it, and refuses everyone else", () => {
    const s = protectedFor();
    refused(() => s.setCell("Sheet1", "C2", 1), /only some people/);
    s.setUser({ id: "u1", roles: ["Finance"] });
    s.setCell("Sheet1", "C2", 1);
    refused(() => s.setCell("Sheet1", "A2", "no"), /locked/);
    s.setUser({ id: "ada" });
    s.setCell("Sheet1", "C3", 2);
    s.setUser({ id: "Ada", roles: [] });
    expect(s.canEdit("Sheet1", "C3")).toBe(true);
    s.setUser({ id: "adam", roles: ["finances"] });
    expect(s.canEdit("Sheet1", "C3")).toBe(false);
    s.setUser({ id: "x", roles: [], role: "finance" });
    expect(s.canEdit("Sheet1", "C3")).toBe(true);
  });

  it("names a person with user: and their id", () => {
    const s = protectedFor();
    s.setUser({ id: "ada" });
    s.setCell("Sheet1", "C3", 2);
    s.setUser({ id: "bob" });
    refused(() => s.setCell("Sheet1", "C3", 3));
  });

  it("lets a range with permissions and a password be opened by a role or by the password", () => {
    const s = protectedFor();
    s.setUser({ id: "c", roles: ["clerk"] });
    s.setCell("Sheet1", "B2", 5);
    s.setUser({ id: "d" });
    refused(() => s.setCell("Sheet1", "B2", 6), /password/);
    s.unlockEditRange("Sheet1", "Either", "pw");
    s.setCell("Sheet1", "B2", 6);
  });

  it("lets some roles do what the protection doesn't allow everyone, and some change locked cells", () => {
    const s = protectedFor();
    refused(() => s.setStyle("Sheet1", "A1", { bold: true }), /format cells/);
    expect(s.can("Sheet1", "formatCells")).toBe(false);
    s.setUser({ id: "d", roles: ["designer", "clerk"] });
    expect(s.can("Sheet1", "formatCells")).toBe(true);
    s.setStyle("Sheet1", "A1", { bold: true });
    s.sort("Sheet1", "B2:B4", { descending: true });
    expect(s.cell("Sheet1", "B2")!.v).toBe(10);
    refused(() => s.insertRows("Sheet1", 2, 1), /insert rows/);
    refused(() => s.setCell("Sheet1", "A1", "x"), /locked/);
    s.setUser({ id: "a", roles: ["analyst", "clerk"] });
    refused(() => s.setStyle("Sheet1", "A1", { italic: true }), /format cells/);
    s.sort("Sheet1", "B2:B4");
    expect(s.cell("Sheet1", "B2")!.v).toBe(2);
    s.setUser({ id: "n", roles: ["analyst"] });
    refused(() => s.sort("Sheet1", "A2:A4"), /locked/);
    s.setUser({ id: "o", roles: ["OWNER"] });
    s.setCell("Sheet1", "A1", "Owner's");
    s.setCell("Sheet1", "F9", "anywhere");
    // Whether cells are locked still needs the sheet unprotected, owner or not.
    refused(() => s.setLocked("Sheet1", "A1", false));
    // Changing locked cells is not every permission: the owner still can't delete rows unless that is allowed.
    refused(() => s.deleteRows("Sheet1", 2, 1), /delete rows/);
  });

  it("applies to the workbook's structure with roles", () => {
    const s = make();
    s.protectWorkbook({ password: "wb", roles: ["admin"] });
    refused(() => s.addSheet("New"));
    s.setUser({ id: "u", roles: ["admin"] });
    s.addSheet("New");
    s.renameSheet("New", "Newer");
    s.setUser(null);
    refused(() => s.deleteSheet("Newer"));
  });

  it("can't be got round by undo when the person changes", () => {
    const s = protectedFor();
    s.setUser({ id: "o", roles: ["owner"] });
    s.setCell("Sheet1", "A1", "Owner's");
    expect(s.canUndo).toBe(true);
    s.setUser({ id: "z" });
    expect(s.canUndo).toBe(false);
    expect(s.cell("Sheet1", "A1")!.v).toBe("Owner's");
    // The same person, described again, changes nothing.
    s.setUser({ id: "o", roles: ["owner"] });
    s.setCell("Sheet1", "A1", "Again");
    s.setUser({ id: "o", roles: ["owner"] });
    expect(s.canUndo).toBe(true);
  });

  it("starts from the user the session is given", () => {
    const s = new SheetSession(make().state, { user: { id: "u", roles: ["owner"] } });
    expect(s.user).toEqual({ id: "u", roles: ["owner"] });
    s.protectSheet("Sheet1", { editLocked: ["owner"] });
    s.setCell("Sheet1", "A1", "yes");
  });

  it("is saved with the workbook and checked when it is loaded", () => {
    const s = protectedFor();
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.protection!.roles).toEqual({ formatCells: ["designer"], sort: ["analyst", "designer"] });
    expect(back.sheets[0]!.protection!.editLocked).toEqual(["owner"]);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].protection.roles = { nonsense: ["x"] };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].protection.roles = { sort: [""] };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].protection.roles = undefined;
    bad.workbook.sheets[0].protection.editLocked = "owner";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
  });

  it("falls back to the password in XLSX files, and keeps the roles as a Pli extension", () => {
    const s = protectedFor();
    s.protectWorkbook({ roles: ["admin"] });
    const xml = sheetXml(s);
    // A range with permissions and a password is written as the password-based range; one with only permissions is left out of Excel's list.
    expect(xml).toMatch(/<protectedRange [^>]*sqref="B2:B4" name="Either"\/>/);
    expect(xml).not.toMatch(/name="Finance"/);
    expect(xml).toMatch(/<extLst><ext uri="\{[^}]+\}" xmlns:pli="urn:pli:sheets"><pli:access>/);
    const read = fromXlsx(toXlsx(s.state));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[0]!.editRanges).toEqual(s.state.sheets[0]!.editRanges?.slice().sort((a, b) => (a.name === "Either" ? -1 : 1) - (b.name === "Either" ? -1 : 1)));
    expect(read.workbook.sheets[0]!.protection!.roles).toEqual(s.state.sheets[0]!.protection!.roles);
    expect(read.workbook.sheets[0]!.protection!.editLocked).toEqual(["owner"]);
    expect(read.workbook.protection!.roles).toEqual(["admin"]);
    const back = new SheetSession(read.workbook, { user: { id: "u", roles: ["finance"] } });
    back.setCell("Sheet1", "C2", 9);
  });

  it("is dropped when Excel saves the file again: a file without the extension is still protected by the password form", () => {
    const s = protectedFor();
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/<extLst>.*<\/extLst>/, ""));
    const back = new SheetSession(fromXlsx(zipSync(files)).workbook);
    expect(back.protection("Sheet1")!.roles).toBeUndefined();
    refused(() => back.setCell("Sheet1", "C2", 1), /locked/);
    refused(() => back.setCell("Sheet1", "B2", 1), /password/);
  });
});

describe("a cell with no entry", () => {
  it("is shaped like the types say", () => {
    const c: Cell = { v: 1, s: { locked: true } };
    expect(c.s?.locked).toBe(true);
  });
});
