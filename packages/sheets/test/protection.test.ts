import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ProtectionError, SheetSession, checkPassword, createWorkbook, fromXlsx, hashPassword, legacyPasswordHash, parseWorkbook, serializeWorkbook, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

const make = () => {
  const s = new SheetSession(createWorkbook("Protect", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null], ["Ink", 2, null]]);
  s.setCell("Sheet1", "C2", "=B2*2");
  s.setStyle("Sheet1", "B2:B4", { locked: false });
  return s;
};
const refused = (fn: () => void, pattern?: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProtectionError);
    if (pattern) expect((e as Error).message).toMatch(pattern);
    return;
  }
  throw new Error("expected the edit to be refused");
};

describe("passwords", () => {
  it("hash the way Excel's old 16-bit check does", () => {
    expect(legacyPasswordHash("password")).toBe("83AF");
    expect(legacyPasswordHash("")).toBe("CE4B");
  });

  it("hash as Excel's salted SHA-512 does: the salt and password, then the result and a counter, spun", () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1);
    const utf16 = Buffer.from("pässword", "utf16le");
    let h = createHash("sha512").update(Buffer.concat([salt, utf16])).digest();
    for (let i = 0; i < 25; i++) {
      const counter = Buffer.alloc(4);
      counter.writeUInt32LE(i);
      h = createHash("sha512").update(Buffer.concat([h, counter])).digest();
    }
    const mine = hashPassword("pässword", salt, 25);
    expect(mine).toEqual({ algorithm: "SHA-512", salt: Buffer.from(salt).toString("base64"), hash: h.toString("base64"), spins: 25 });
    expect(checkPassword(mine, "pässword")).toBe(true);
    expect(checkPassword(mine, "password")).toBe(false);
    expect(checkPassword({ algorithm: "legacy", hash: "83AF" }, "password")).toBe(true);
    expect(checkPassword({ algorithm: "legacy", hash: "83af" }, "Password")).toBe(false);
  });

  it("are made with a different salt each time, and fast enough to check on the spot", () => {
    const t = Date.now();
    const a = hashPassword("secret");
    const b = hashPassword("secret");
    expect(a).not.toEqual(b);
    expect(checkPassword(a, "secret")).toBe(true);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("a protected sheet", () => {
  it("refuses to change a locked cell and lets an unlocked one be changed", () => {
    const s = make();
    s.setCell("Sheet1", "A2", "free before"); // not protected yet
    s.protectSheet("Sheet1");
    refused(() => s.setCell("Sheet1", "A2", "no"), /locked/);
    refused(() => s.setCell("Sheet1", "D9", 1), /locked/); // an empty cell is locked too
    refused(() => s.clear("Sheet1", "A2", "contents"));
    s.setCell("Sheet1", "B2", 11);
    expect(s.value("Sheet1", "B2")).toBe(11);
    expect(s.value("Sheet1", "C2")).toBe(22); // formulas still work
    expect(s.value("Sheet1", "A2")).toBe("free before");
    // One locked cell in a batch refuses the whole batch.
    refused(() => s.setCells("Sheet1", { B3: 5, A3: "no" }));
    expect(s.value("Sheet1", "B3")).toBe(4);
    refused(() => s.batch(() => { s.setCell("Sheet1", "B3", 6); s.setCell("Sheet1", "A4", "no"); }));
    expect(s.value("Sheet1", "B3")).toBe(4);
  });

  it("is not looked at on other sheets, or when it isn't protected", () => {
    const s = make();
    s.protectSheet("Sheet1");
    s.setCell("Other", "A1", "fine");
    s.unprotectSheet("Sheet1");
    s.setCell("Sheet1", "A2", "fine too");
    expect(s.value("Sheet1", "A2")).toBe("fine too");
  });

  it("forgets the undo history when protected or unprotected, so undo can't get round it", () => {
    const s = make();
    s.setCell("Sheet1", "A2", "was changed");
    expect(s.canUndo).toBe(true);
    s.protectSheet("Sheet1");
    expect(s.canUndo).toBe(false);
    s.setCell("Sheet1", "B2", 11);
    s.undo();
    expect(s.value("Sheet1", "B2")).toBe(10);
    expect(s.value("Sheet1", "A2")).toBe("was changed");
  });

  it("can be set aside by the application, and only for as long as it says", () => {
    const s = make();
    s.protectSheet("Sheet1");
    s.bypassProtection(() => s.setCell("Sheet1", "A2", "the app wrote this"));
    expect(s.value("Sheet1", "A2")).toBe("the app wrote this");
    refused(() => s.setCell("Sheet1", "A2", "no"));
    expect(() => s.bypassProtection(() => { throw new Error("x"); })).toThrow("x");
    refused(() => s.setCell("Sheet1", "A2", "still no"));
  });

  it("takes the protection off with the password, and not without or with a wrong one", () => {
    const s = make();
    s.protectSheet("Sheet1", { password: "open sesame" });
    expect(s.isProtected("Sheet1")).toBe(true);
    refused(() => s.unprotectSheet("Sheet1"), /password/);
    refused(() => s.unprotectSheet("Sheet1", "wrong"), /password/);
    expect(s.isProtected("Sheet1")).toBe(true);
    s.unprotectSheet("Sheet1", "open sesame");
    expect(s.isProtected("Sheet1")).toBe(false);
    s.protectSheet("Sheet1");
    s.unprotectSheet("Sheet1"); // no password: anyone can
    expect(() => s.protectSheet("Sheet1", { password: "a" })).not.toThrow();
    expect(() => s.protectSheet("Sheet1")).toThrow(/already/);
  });

  it("keeps locking and hidden formulas to the unprotected sheet", () => {
    const s = make();
    s.setStyle("Sheet1", "C2", { hideFormula: true });
    expect(s.formulaHidden("Sheet1", "C2")).toBe(false); // only while protected
    s.protectSheet("Sheet1");
    expect(s.formulaHidden("Sheet1", "C2")).toBe(true);
    expect(s.formulaHidden("Sheet1", "B2")).toBe(false);
    expect(s.isLocked("Sheet1", "A1")).toBe(true);
    expect(s.isLocked("Sheet1", "B2")).toBe(false);
    expect(s.canEdit("Sheet1", "B2")).toBe(true);
    expect(s.canEdit("Sheet1", "A1")).toBe(false);
    // The flags themselves can't be changed on a protected sheet.
    refused(() => s.setStyle("Sheet1", "B2", { locked: true }), /locked, or their formulas hidden/);
    refused(() => s.setStyle("Sheet1", "A1", { locked: false }));
    expect(s.canEdit("Sheet1", "A1")).toBe(false);
  });

  it("stores only what a cell isn't by default", () => {
    const s = make();
    s.setStyle("Sheet1", "B2", { locked: true, hideFormula: false });
    expect(s.cell("Sheet1", "B2")?.s).toBeUndefined();
    s.setStyle("Sheet1", "B2", { locked: false });
    expect(s.cell("Sheet1", "B2")?.s).toEqual({ locked: false });
    s.setStyle("Sheet1", "B2", { locked: null });
    expect(s.cell("Sheet1", "B2")?.s).toBeUndefined();
  });
});

describe("what a protected sheet allows", () => {
  it("formatting needs formatCells, for locked cells and unlocked ones", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.setStyle("Sheet1", "B2", { bold: true }), /format cells/);
    refused(() => s.setFormat("Sheet1", "B2", "0.00"));
    refused(() => s.mergeCells("Sheet1", "A1:B1"));
    refused(() => s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["1"], ranges: ["B2:B4"], style: { bold: true } }));
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "selectUnlockedCells", "formatCells"] });
    s.setStyle("Sheet1", "A1:C1", { bold: true });
    s.setFormat("Sheet1", "B2:B4", "0.00");
    s.mergeCells("Sheet1", "E1:F1");
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["1"], ranges: ["B2:B4"], style: { bold: true } });
    refused(() => s.setCell("Sheet1", "A1", "still locked"));
  });

  it("sizes need formatColumns and formatRows", () => {
    const s = make();
    s.protectSheet("Sheet1", { allow: ["formatRows"] });
    s.setRowHeight("Sheet1", 2, 30);
    refused(() => s.setColumnWidth("Sheet1", 1, 20), /column/);
    s.setFrozen("Sheet1", 1, 0); // viewing is never refused
    s.setTabColor("Sheet1", "#ff0000");
  });

  it("rows and columns need their permission, and deleting also needs the cells in them unlocked", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.insertRows("Sheet1", 2, 1), /insert rows/);
    refused(() => s.insertColumns("Sheet1", 2, 1), /insert columns/);
    refused(() => s.deleteRows("Sheet1", 2, 1));
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["insertRows", "deleteRows", "deleteColumns"] });
    s.insertRows("Sheet1", 6, 1);
    // As in Excel, a row that was inserted can't be deleted again while its (empty) cells are locked.
    refused(() => s.deleteRows("Sheet1", 6, 1), /protected sheet/);
    refused(() => s.deleteRows("Sheet1", 2, 1), /protected sheet/); // A2 is locked
    refused(() => s.deleteColumns("Sheet1", 1, 1), /protected sheet/);
  });

  it("links and notes need their permissions", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.setLink("Sheet1", "B2", { to: "https://pli.dev" }), /links/);
    refused(() => s.setNote("Sheet1", "B2", "n"), /charts, pictures, slicers and notes/);
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["insertHyperlinks", "objects"] });
    s.setLink("Sheet1", "B2", { to: "https://pli.dev" }); // B2 is unlocked
    refused(() => s.setLink("Sheet1", "A2", { to: "https://pli.dev" }), /locked/);
    s.setNote("Sheet1", "A2", "notes are objects, not cell contents");
    expect(s.note("Sheet1", "A2")).toBe("notes are objects, not cell contents");
  });

  it("charts, pictures and slicers need the objects permission", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.addChart("Sheet1", { series: [{ values: "B2:B4" }] }));
    refused(() => s.addImage("Sheet1", { src: pngUri(20, 20) }));
    s.unprotectSheet("Sheet1");
    const chart = s.addChart("Sheet1", { series: [{ values: "B2:B4" }] });
    const image = s.addImage("Sheet1", { src: pngUri(20, 20) });
    s.protectSheet("Sheet1");
    refused(() => s.updateChart("Sheet1", chart.id, { title: "x" }));
    refused(() => s.updateImage("Sheet1", image.id, { alt: "x" }));
    refused(() => s.deleteChart("Sheet1", chart.id));
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["objects"] });
    s.updateChart("Sheet1", chart.id, { title: "fine" });
    s.deleteImage("Sheet1", image.id);
  });

  it("sorting needs the sort permission and unlocked cells", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.sort("Sheet1", "B2:B4"), /sort/);
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["sort"] });
    s.sort("Sheet1", "B2:B4", { by: 1 });
    expect([2, 3, 4].map((r) => s.value("Sheet1", `B${r}`))).toEqual([2, 4, 10]);
    refused(() => s.sort("Sheet1", "A2:C4"), /locked/);
  });

  it("filters can be used with autoFilter, but not made or taken off; data validation and tables can't be changed", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C4");
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "100"], ranges: ["B2:B4"] });
    s.protectSheet("Sheet1");
    refused(() => s.filterColumn("Sheet1", 2, ["10"]), /filtering|filters/);
    refused(() => s.setFilter("Sheet1", null));
    refused(() => s.addValidation("Sheet1", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["B2"] }), /validation/i);
    refused(() => s.clearValidation("Sheet1", "B2:B4"));
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["autoFilter"] });
    s.filterColumn("Sheet1", 2, ["10"]);
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBe(true);
    refused(() => s.setFilter("Sheet1", null));
    s.unprotectSheet("Sheet1");

    const t = make();
    t.createTable("Sheet1", "A1:C4", { name: "Sales" });
    t.protectSheet("Sheet1", { allow: ["autoFilter", "sort"] });
    t.filterTable("Sales", "Name", ["Pens"]);
    refused(() => t.createTable("Sheet1", "E1:F3", { name: "Other" }));
    refused(() => t.renameTable("Sales", "Renamed"));
    refused(() => t.deleteTable("Sales"));
    refused(() => t.setTableOptions("Sales", { bandedRows: false }));
  });

  it("moving cells needs the cells they leave and land on unlocked", () => {
    const s = make();
    s.protectSheet("Sheet1");
    s.move({ sheet: "Sheet1", range: "B2" }, { sheet: "Sheet1", at: "B4" }); // both are unlocked
    refused(() => s.move({ sheet: "Sheet1", range: "B3" }, { sheet: "Sheet1", at: "A9" }), /locked/);
    refused(() => s.move({ sheet: "Sheet1", range: "A2" }, { sheet: "Sheet1", at: "B3" }), /locked/);
    s.unprotectSheet("Sheet1");
    s.setStyle("Sheet1", "E2:E3", { locked: false });
    s.protectSheet("Sheet1");
    s.move({ sheet: "Sheet1", range: "B4" }, { sheet: "Sheet1", at: "E2" }); // B4 holds the 10 moved there above
    expect(s.value("Sheet1", "E2")).toBe(10);
    expect(s.isLocked("Sheet1", "B4")).toBe(false); // the cell it left is still an input cell
    expect(s.isLocked("Sheet1", "E2")).toBe(false);
    refused(() => s.move({ sheet: "Sheet1", range: "E2" }, { sheet: "Sheet1", at: "A9" }));
  });

  it("pasting into locked cells is refused, and copying out is fine", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.pasteHtml("Sheet1", "A2", "<table><tr><td>x</td></tr></table>"));
    s.pasteHtml("Sheet1", "B2", "<table><tr><td>7</td></tr></table>");
    expect(s.value("Sheet1", "B2")).toBe(7);
    expect(s.isLocked("Sheet1", "B2")).toBe(false); // what is pasted doesn't lock it
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "B3" }); // a locked cell copied onto an unlocked one
    expect(s.value("Sheet1", "B3")).toBe("Name");
    expect(s.isLocked("Sheet1", "B3")).toBe(false);
    s.clear("Sheet1", "B4", "contents");
    expect(s.isLocked("Sheet1", "B4")).toBe(false);
    expect(s.toHtml("Sheet1", "A1:C2")).toContain("<table>");
  });
});

describe("a workbook with its structure protected", () => {
  it("refuses to add, delete, rename, move or hide sheets, until it is unprotected", () => {
    const s = make();
    s.protectWorkbook({ password: "pw" });
    expect(s.workbookProtected).toBe(true);
    refused(() => s.addSheet("New"), /structure/);
    refused(() => s.deleteSheet("Other"));
    refused(() => s.renameSheet("Other", "Renamed"));
    refused(() => s.moveSheet("Other", 0));
    refused(() => s.hideSheets(["Other"]));
    s.setCell("Other", "A1", "cells are free"); // only the sheets are held
    refused(() => s.unprotectWorkbook("nope"), /password/);
    s.unprotectWorkbook("pw");
    expect(s.addSheet("New").name).toBe("New");
  });
});

describe("saving", () => {
  it("keeps protection, permissions, passwords and cell flags, and checks them", () => {
    const s = make();
    s.setStyle("Sheet1", "C2", { hideFormula: true });
    s.protectSheet("Sheet1", { password: "pw", allow: ["sort", "formatCells", "selectLockedCells"] });
    s.protectWorkbook();
    const text = serializeWorkbook(s.state);
    const back = parseWorkbook(text);
    expect(back.sheets[0]!.protection).toEqual(s.protection("Sheet1"));
    expect(back.sheets[0]!.protection!.allow).toEqual(["selectLockedCells", "formatCells", "sort"]);
    expect(back.protection).toEqual({ structure: true });
    expect(back.sheets[0]!.cells["B2"]!.s).toEqual({ locked: false });
    const reopened = new SheetSession(back);
    refused(() => reopened.setCell("Sheet1", "A2", "no"));
    reopened.setCell("Sheet1", "B2", 3);
    reopened.workbookProtected && expect(() => reopened.unprotectSheet("Sheet1", "pw")).not.toThrow();

    const bad = JSON.parse(text);
    bad.workbook.sheets[0].protection.allow.push("everything");
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/everything/);
    bad.workbook.sheets[0].protection.allow = [];
    bad.workbook.sheets[0].protection.password = { algorithm: "MD5", hash: "x" };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].protection = { allow: [], extra: 1 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
    bad.workbook.sheets[0].protection = undefined;
    bad.workbook.protection = { structure: false };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
  });
});

describe("in XLSX files", () => {
  const sheetXml = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);

  it("writes cell locks as protection in the style, and reads them back", () => {
    const s = make();
    s.setStyle("Sheet1", "C2", { hideFormula: true });
    const files = unzipSync(toXlsx(s.state));
    const styles = strFromU8(files["xl/styles.xml"]!);
    expect(styles).toMatch(/<xf [^>]*applyProtection="1"><protection locked="0"\/><\/xf>/);
    expect(styles).toMatch(/<protection hidden="1"\/>/);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.cells["B2"]!.s).toEqual({ locked: false });
    expect(back.cells["C2"]!.s).toEqual({ hideFormula: true });
    expect(back.cells["A1"]!.s).toBeUndefined();
    s.setStyle("Sheet1", "D2", { locked: false, hideFormula: true, bold: true });
    const both = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.cells["D2"]!.s;
    expect(both).toEqual({ locked: false, hideFormula: true, bold: true });
  });

  it("writes a sheet's protection with only what is allowed unlocked, after the data and before the filter", () => {
    const s = make();
    s.setFilter("Sheet1", "A1:C4");
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "formatCells", "sort", "objects"] });
    const xml = sheetXml(s);
    expect(xml).toMatch(/<sheetProtection sheet="1" formatCells="0" sort="0" scenarios="1" selectUnlockedCells="1"\/>/);
    expect(xml.indexOf("</sheetData>")).toBeLessThan(xml.indexOf("<sheetProtection"));
    expect(xml.indexOf("<sheetProtection")).toBeLessThan(xml.indexOf("<autoFilter"));
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.protection).toEqual({ allow: ["selectLockedCells", "formatCells", "sort", "objects"] });
    // A default protection locks objects and scenarios and lets people select cells, as Excel's own does.
    const t = make();
    t.protectSheet("Sheet1");
    expect(sheetXml(t)).toMatch(/<sheetProtection sheet="1" objects="1" scenarios="1"\/>/);
    expect(fromXlsx(toXlsx(t.state)).workbook.sheets[0]!.protection!.allow).toEqual(["selectLockedCells", "selectUnlockedCells"]);
  });

  it("writes the password the way Excel does and reads it back so it still opens the sheet", () => {
    const s = make();
    s.protectSheet("Sheet1", { password: "pli" });
    const xml = sheetXml(s);
    expect(xml).toMatch(/algorithmName="SHA-512" hashValue="[A-Za-z0-9+/=]+" saltValue="[A-Za-z0-9+/=]+" spinCount="100000"/);
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.isProtected("Sheet1")).toBe(true);
    refused(() => back.unprotectSheet("Sheet1", "no"), /password/);
    back.unprotectSheet("Sheet1", "pli");
    expect(back.isProtected("Sheet1")).toBe(false);
  });

  it("reads an old file's 16-bit password, and says when a password can't be checked", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    const legacy = { ...files, "xl/worksheets/sheet1.xml": strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('<sheetProtection sheet="1"', '<sheetProtection password="83AF" sheet="1"')) };
    const read = fromXlsx(zipSync(legacy));
    expect(read.workbook.sheets[0]!.protection!.password).toEqual({ algorithm: "legacy", hash: "83AF" });
    const opened = new SheetSession(read.workbook);
    refused(() => opened.unprotectSheet("Sheet1", "nope"));
    opened.unprotectSheet("Sheet1", "password");
    const md5 = { ...files, "xl/worksheets/sheet1.xml": strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('<sheetProtection sheet="1"', '<sheetProtection algorithmName="SHA-256" hashValue="AAAA" saltValue="AAAA" spinCount="100" sheet="1"')) };
    const odd = fromXlsx(zipSync(md5));
    expect(odd.workbook.sheets[0]!.protection!.password).toBeUndefined();
    expect(odd.warnings.some((w) => /can't check/.test(w))).toBe(true);
  });

  it("does not protect a sheet whose protection element says sheet=0, and reads what the file allows", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    const edit = (text: (t: string) => string) => fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(text(strFromU8(files["xl/worksheets/sheet1.xml"]!))) })).workbook.sheets[0]!;
    expect(edit((t) => t.replace('sheet="1"', 'sheet="0"')).protection).toBeUndefined();
    // As Excel writes it: only what is not allowed is marked, and `objects` missing means they can be edited.
    expect(edit((t) => t.replace(' objects="1"', "").replace('<sheetProtection sheet="1"', '<sheetProtection sheet="1" insertRows="0" deleteRows="0"')).protection!.allow).toEqual(["selectLockedCells", "selectUnlockedCells", "insertRows", "deleteRows", "objects"]);
  });

  it("writes the workbook's structure protection, with its password, before the book views", () => {
    const s = make();
    s.protectWorkbook({ password: "wb" });
    const xml = strFromU8(unzipSync(toXlsx(s.state))["xl/workbook.xml"]!);
    expect(xml).toMatch(/<workbookProtection workbookAlgorithmName="SHA-512" workbookHashValue="[^"]+" workbookSaltValue="[^"]+" workbookSpinCount="100000" lockStructure="1"\/><bookViews>/);
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.workbookProtected).toBe(true);
    refused(() => back.addSheet("x"));
    back.unprotectWorkbook("wb");
    back.addSheet("x");
    const legacy = unzipSync(toXlsx(make().state));
    legacy["xl/workbook.xml"] = strToU8(strFromU8(legacy["xl/workbook.xml"]!).replace("<bookViews>", '<workbookProtection workbookPassword="83AF" lockStructure="1"/><bookViews>'));
    expect(fromXlsx(zipSync(legacy)).workbook.protection).toEqual({ structure: true, password: { algorithm: "legacy", hash: "83AF" } });
  });

  it("reads ranges that people may edit, without a warning, and they open the cells for editing", () => {
    const s = make();
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/(<sheetProtection[^>]*\/>)/, '$1<protectedRanges><protectedRange sqref="A2:A4" name="Inputs"/></protectedRanges>'));
    const read = fromXlsx(zipSync(files));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[0]!.editRanges).toEqual([{ name: "Inputs", ranges: ["A2:A4"] }]);
    const back = new SheetSession(read.workbook);
    back.setCell("Sheet1", "A2", "Pencils");
    refused(() => back.setCell("Sheet1", "A1", "x"));
  });
});
