import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { MAX_COLS, MAX_ROWS, ProtectionError, SheetSession, anyFormulaHidden, createWorkbook, fromXlsx, parseSddl, parseWorkbook, serializeWorkbook, toXlsx, writeSddl, type Bounds } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Rest", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null], ["Ink", 2, null]]);
  s.setCell("Sheet1", "C2", "=B2*2");
  s.setCell("Sheet1", "C3", "=B3*2");
  s.setCell("Sheet1", "C4", "=B4*2");
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
const roundTrip = (s: SheetSession) => {
  const back = fromXlsx(toXlsx(s.state));
  expect(back.warnings).toEqual([]);
  return new SheetSession(back.workbook, { now: () => 45_000.5 });
};

describe("hidden formulas that columns, rows and the sheet carry", () => {
  it("a whole column hides the formulas of the cells in it and of cells made in it later", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    expect(s.state.sheets[0]!.columns).toEqual({ C: { hideFormula: true } });
    // The cells that exist take it from the column and need nothing of their own.
    expect(s.cell("Sheet1", "C2")!.s).toBeUndefined();
    s.setCell("Sheet1", "C900", "=1+1");
    expect(s.formulaHidden("Sheet1", "C2")).toBe(false); // nothing is hidden before the sheet is protected
    s.protectSheet("Sheet1");
    expect(s.formulaHidden("Sheet1", "C2")).toBe(true);
    expect(s.formulaHidden("Sheet1", "C900")).toBe(true);
    expect(s.formulaHidden("Sheet1", "B2")).toBe(false);
    expect(s.hidesFormula("Sheet1", "C5000")).toBe(true);
    expect(s.hidesFormula("Sheet1", "B5000")).toBe(false);
  });

  it("whole rows win over columns, a cell's own setting wins over both, and the last set wins at a crossing", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.setFormulaHidden("Sheet1", "3:3", true);
    s.setFormulaHidden("Sheet1", "2:2", false);
    expect(s.hidesFormula("Sheet1", "C2")).toBe(false); // the row shows what the column hides
    expect(s.hidesFormula("Sheet1", "A3")).toBe(true);
    expect(s.hidesFormula("Sheet1", "C4")).toBe(true);
    s.setStyle("Sheet1", "C4", { hideFormula: false });
    expect(s.hidesFormula("Sheet1", "C4")).toBe(false);
    expect(s.cell("Sheet1", "C4")!.s).toEqual({ hideFormula: false }); // kept only because the column hides
    s.setStyle("Sheet1", "C4", { hideFormula: true });
    expect(s.cell("Sheet1", "C4")!.s).toBeUndefined();
    s.setStyle("Sheet1", "A1", { hideFormula: true });
    expect(s.cell("Sheet1", "A1")!.s).toEqual({ hideFormula: true });
  });

  it("the whole sheet, and selecting all then undoing", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", `A1:${"XFD"}${MAX_ROWS}`, true);
    expect(s.state.sheets[0]!.hiddenFormulas).toBe(true);
    expect(s.hidesFormula("Sheet1", "Z99")).toBe(true);
    s.setFormulaHidden("Sheet1", "B:B", false);
    expect(s.hidesFormula("Sheet1", "B2")).toBe(false);
    expect(s.state.sheets[0]!.columns).toEqual({ B: { hideFormula: false } });
    s.undo();
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    s.undo();
    expect(s.state.sheets[0]!.hiddenFormulas).toBeUndefined();
    s.redo();
    expect(s.state.sheets[0]!.hiddenFormulas).toBe(true);
  });

  it("is set with setStyle on whole columns and rows, in one undo step", () => {
    const s = make();
    s.setStyle("Sheet1", "C:C", { hideFormula: true });
    expect(s.state.sheets[0]!.columns!["C"]!.hideFormula).toBe(true);
    expect(s.cell("Sheet1", "C2")!.s).toBeUndefined();
    s.setStyle("Sheet1", "2:2", { hideFormula: true });
    expect(s.state.sheets[0]!.rows!["2"]!.hideFormula).toBe(true);
  });

  it("can't be changed while the sheet is protected", () => {
    const s = make();
    s.protectSheet("Sheet1");
    refused(() => s.setFormulaHidden("Sheet1", "C:C", true), /hidden/);
    refused(() => s.setStyle("Sheet1", "C:C", { hideFormula: true }), /hidden/);
    s.bypassProtection(() => s.setFormulaHidden("Sheet1", "C:C", true));
    expect(s.formulaHidden("Sheet1", "C2")).toBe(true);
  });

  it("new rows and columns take the setting of the one before them", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.insertColumns("Sheet1", 4, 1);
    expect(s.state.sheets[0]!.columns).toEqual({ C: { hideFormula: true }, D: { hideFormula: true } });
    s.setFormulaHidden("Sheet1", "3:3", true);
    s.insertRows("Sheet1", 4, 2);
    expect(s.hidesFormula("Sheet1", "A4")).toBe(true);
    expect(s.hidesFormula("Sheet1", "A5")).toBe(true);
    expect(s.hidesFormula("Sheet1", "A6")).toBe(false);
  });

  it("anyFormulaHidden is exact, and quick for whole columns and rows", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.protectSheet("Sheet1");
    const t0 = performance.now();
    expect(s.anyFormulaHidden("Sheet1", "C:C")).toBe(true);
    expect(s.anyFormulaHidden("Sheet1", "A:A")).toBe(false);
    expect(s.anyFormulaHidden("Sheet1", "A1:XFD1048576")).toBe(true);
    expect(s.anyFormulaHidden("Sheet1", "2:2")).toBe(true);
    expect(s.anyFormulaHidden("Sheet1", "1:1")).toBe(false);
    expect(s.anyFormulaHidden("Sheet1", "D1:XFD1048576")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
    // A column that hides formulas holds a value cell: a value has no formula to hide.
    s.bypassProtection(() => s.setCell("Sheet1", "D2", 5));
    expect(anyFormulaHidden(s.state.sheets[0]!, { r1: 1, c1: 4, r2: MAX_ROWS, c2: 4 } satisfies Bounds)).toBe(false);
    // And an unprotected sheet hides nothing.
    const u = make();
    u.setFormulaHidden("Sheet1", "C:C", true);
    expect(u.anyFormulaHidden("Sheet1", "C:C")).toBe(false);
  });

  it("is shown nowhere: not by FORMULATEXT, not by find in formulas", () => {
    const s = make();
    s.setCell("Sheet1", "E1", "=FORMULATEXT(C2)");
    s.setCell("Sheet1", "E2", "=FORMULATEXT(B2)");
    s.setFormulaHidden("Sheet1", "C:C", true);
    expect(s.display("Sheet1", "E1").text).toBe("=B2*2");
    expect(s.find({ text: "B2*2", lookIn: "formulas" }).map((h) => h.address)).toEqual(["C2"]);
    s.protectSheet("Sheet1");
    expect(s.display("Sheet1", "E1").text).toBe("#N/A");
    expect(s.find({ text: "B2*2", lookIn: "formulas" })).toEqual([]);
    // Values are still found.
    expect(s.find({ text: "20" }).map((h) => h.address)).toEqual(["C2"]);
    s.unprotectSheet("Sheet1");
    expect(s.display("Sheet1", "E1").text).toBe("=B2*2");
  });

  it("keeps cells that can be changed from showing their formulas by being pasted over", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.setLocked("Sheet1", "C:C", false);
    s.protectSheet("Sheet1");
    // Typing a formula in a hidden column's cell keeps it hidden; clearing and typing again too.
    s.setCell("Sheet1", "C2", "=B2+1");
    expect(s.formulaHidden("Sheet1", "C2")).toBe(true);
    s.clear("Sheet1", "C2", "all");
    s.setCell("Sheet1", "C2", "=B2+2");
    expect(s.formulaHidden("Sheet1", "C2")).toBe(true);
    // A paste of cells that say they show their formulas can't unhide the cell.
    s.copy({ sheet: "Sheet1", range: "A2" }, { sheet: "Sheet1", at: "C3" });
    expect(s.formulaHidden("Sheet1", "C3")).toBe(false); // a value, so nothing to hide
    s.setCell("Sheet1", "C3", "=B3+1");
    expect(s.formulaHidden("Sheet1", "C3")).toBe(true);
  });

  it("is saved in the workbook JSON and checked when loading", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.setFormulaHidden("Sheet1", "5:5", true);
    s.setFormulaHidden("Other", "A1:XFD1048576", true);
    const json = serializeWorkbook(s.state);
    const back = parseWorkbook(json);
    expect(back.sheets[0]!.columns!["C"]!.hideFormula).toBe(true);
    expect(back.sheets[0]!.rows!["5"]!.hideFormula).toBe(true);
    expect(back.sheets[1]!.hiddenFormulas).toBe(true);
    const bad = JSON.parse(json);
    bad.workbook.sheets[0].columns.C.hideFormula = "yes";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/true or false/);
    const bad2 = JSON.parse(json);
    bad2.workbook.sheets[1].hiddenFormulas = false;
    expect(() => parseWorkbook(JSON.stringify(bad2))).toThrow(/true/);
  });

  it("is written as the hidden flag of the style of a column, a row and the cells in them, and read back", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.setFormulaHidden("Sheet1", "4:4", true);
    s.setLocked("Sheet1", "B:B", false);
    s.protectSheet("Sheet1");
    const xml = sheetXml(s);
    const styles = strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);
    expect(styles).toContain('<protection hidden="1"/>');
    expect(xml).toMatch(/<col min="3" max="3"[^>]* style="\d+"/);
    expect(xml).toMatch(/<row r="4"[^>]* s="\d+" customFormat="1"/);
    const back = roundTrip(s);
    const sheet = back.state.sheets[0]!;
    expect(sheet.columns!["C"]).toEqual({ hideFormula: true });
    expect(sheet.columns!["B"]).toEqual({ locked: false });
    // (The row crosses a column of its own lock, so the row says its lock too: a row's style is one for all its cells.)
    expect(sheet.rows!["4"]).toEqual({ locked: true, hideFormula: true });
    // The cells in the column carry nothing of their own: the column says it.
    expect(sheet.cells["C2"]!.s).toBeUndefined();
    expect(back.formulaHidden("Sheet1", "C2")).toBe(true);
    expect(back.formulaHidden("Sheet1", "C900")).toBe(false); // (an empty cell has no formula)
    expect(back.hidesFormula("Sheet1", "C900")).toBe(true);
    expect(back.hidesFormula("Sheet1", "D4")).toBe(true);
    expect(back.hidesFormula("Sheet1", "D3")).toBe(false);
  });

  it("a hidden sheet is written as columns 1 to 16384 and read back as the sheet's own setting", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", `A1:XFD${MAX_ROWS}`, true);
    s.setFormulaHidden("Sheet1", "B:B", false);
    const xml = sheetXml(s);
    expect(xml).toMatch(/<col min="3" max="16384"[^>]* style="\d+"/);
    const back = roundTrip(s);
    expect(back.state.sheets[0]!.hiddenFormulas).toBe(true);
    expect(back.state.sheets[0]!.columns).toEqual({ B: { hideFormula: false } });
    expect(MAX_COLS).toBe(16384);
  });

  it("a row that hides formulas and sits in a column that shows them is read with both", () => {
    const s = make();
    s.setFormulaHidden("Sheet1", "3:3", true);
    s.setLocked("Sheet1", "3:3", false);
    const back = roundTrip(s);
    expect(back.state.sheets[0]!.rows!["3"]).toEqual({ hideFormula: true, locked: false });
    expect(back.hidesFormula("Sheet1", "Z3")).toBe(true);
    expect(back.isLocked("Sheet1", "Z3")).toBe(false);
  });
});

describe("strict delete rules, as in Excel", () => {
  const protectedWith = (allow: ("deleteRows" | "deleteColumns" | "insertRows")[]) => {
    const s = make();
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "selectUnlockedCells", ...allow] });
    return s;
  };

  it("refuses to delete a row with a locked cell, empty cells included, with Excel's wording", () => {
    const s = protectedWith(["deleteRows", "deleteColumns", "insertRows"]);
    refused(() => s.deleteRows("Sheet1", 20, 1), /cell or chart you're trying to change is on a protected sheet/);
    refused(() => s.deleteColumns("Sheet1", 20, 1), /protected sheet/);
    s.insertRows("Sheet1", 6, 1);
    refused(() => s.deleteRows("Sheet1", 6, 1), /protected sheet/); // Excel lets people insert rows they can't delete
    expect(s.state.sheets[0]!.cells["A1"]).toBeTruthy();
  });

  it("needs the permission first, and unlocked cells only for the whole row or column", () => {
    const s = make();
    s.setLocked("Sheet1", "3:3", false);
    s.setLocked("Sheet1", "D:D", false);
    s.protectSheet("Sheet1");
    refused(() => s.deleteRows("Sheet1", 3, 1), /delete rows/);
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["deleteRows", "deleteColumns"] });
    s.deleteRows("Sheet1", 3, 1);
    expect(s.cell("Sheet1", "A3")?.v).toBe("Ink");
    s.deleteColumns("Sheet1", 4, 1);
    // A column of which only the cells that exist are unlocked is still locked for Excel.
    s.bypassProtection(() => s.setStyle("Sheet1", "A1:A2", { locked: false }));
    refused(() => s.deleteColumns("Sheet1", 1, 1), /protected sheet/);
  });

  it("allows it when the whole row or column is unlocked, and deleting many at once needs all of them", () => {
    const s = make();
    s.setLocked("Sheet1", "2:3", false);
    s.protectSheet("Sheet1", { allow: ["deleteRows"] });
    refused(() => s.deleteRows("Sheet1", 3, 2), /protected sheet/); // row 4 is locked
    s.deleteRows("Sheet1", 2, 2);
    expect(s.cell("Sheet1", "A2")?.v).toBe("Ink");
  });

  it("a role that may change locked cells is held to the same rule only by what it may delete", () => {
    const s = make();
    s.protectSheet("Sheet1", { allow: ["deleteRows"], editLocked: ["owner"] });
    refused(() => s.deleteRows("Sheet1", 2, 1), /protected sheet/);
    s.setUser({ id: "o", roles: ["owner"] });
    s.deleteRows("Sheet1", 2, 1);
    expect(s.cell("Sheet1", "A2")?.v).toBe("Paper");
  });

  it("a range of whole rows that this person may edit lets them delete those rows", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Rows", ranges: ["3:3"], permissions: ["clerk"] });
    s.protectSheet("Sheet1", { allow: ["deleteRows"] });
    refused(() => s.deleteRows("Sheet1", 3, 1), /(range|protected sheet)/);
    s.setUser({ id: "c", roles: ["clerk"] });
    s.deleteRows("Sheet1", 3, 1);
    expect(s.cell("Sheet1", "A3")?.v).toBe("Ink");
    // A range of a few cells doesn't open the whole row.
    const t = make();
    t.addEditRange("Sheet1", { name: "Some", ranges: ["A2:C2"], permissions: ["clerk"] });
    t.protectSheet("Sheet1", { allow: ["deleteRows"] });
    t.setUser({ id: "c", roles: ["clerk"] });
    refused(() => t.deleteRows("Sheet1", 2, 1), /protected sheet/);
  });

  it("a range with a password asks for it when it holds the whole row", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Rows", ranges: ["3:3"], password: "pw" });
    s.protectSheet("Sheet1", { allow: ["deleteRows"] });
    const error = refused(() => s.deleteRows("Sheet1", 3, 1), /password/);
    expect(error.editRange).toEqual({ sheet: s.state.sheets[0]!.id, name: "Rows" });
    s.unlockEditRange("Sheet1", "Rows", "pw");
    s.deleteRows("Sheet1", 3, 1);
  });

  it("merged cells count by their cells: the covered ones must be unlocked too", () => {
    const s = make();
    s.mergeCells("Sheet1", "A5:B5");
    s.setLocked("Sheet1", "5:5", false);
    s.protectSheet("Sheet1", { allow: ["deleteRows"] });
    s.deleteRows("Sheet1", 5, 1);
    expect(s.state.sheets[0]!.merges ?? []).toEqual([]);
    const t = make();
    t.mergeCells("Sheet1", "A5:A6");
    t.setLocked("Sheet1", "5:5", false);
    t.protectSheet("Sheet1", { allow: ["deleteRows"] });
    t.deleteRows("Sheet1", 5, 1); // row 5 is wholly unlocked; the merge shrinks to the one row left
    refused(() => t.deleteRows("Sheet1", 5, 1), /protected sheet/); // what moved up is locked
  });

  it("never goes through a table, which a protected sheet can't resize", () => {
    const s = make();
    s.createTable("Sheet1", "A1:C4", { name: "Sales" });
    s.setLocked("Sheet1", "3:3", false);
    s.setLocked("Sheet1", "10:10", false);
    s.setLocked("Sheet1", "E:E", false);
    s.protectSheet("Sheet1", { allow: ["deleteRows", "deleteColumns"], editLocked: ["owner"] });
    refused(() => s.deleteRows("Sheet1", 3, 1), /table/);
    refused(() => s.deleteColumns("Sheet1", 2, 1), /table/);
    s.setUser({ id: "o", roles: ["owner"] });
    refused(() => s.deleteRows("Sheet1", 3, 1), /table/); // not even the owner
    // Outside the table it is only the locks that count.
    s.deleteRows("Sheet1", 10, 1);
    s.deleteColumns("Sheet1", 5, 1);
  });

  it("is checked when the sheet is protected by the order of an undo too", () => {
    const s = make();
    s.setLocked("Sheet1", "3:3", false);
    s.protectSheet("Sheet1", { allow: ["deleteRows"] });
    s.deleteRows("Sheet1", 3, 1);
    expect(() => s.undo()).not.toThrow();
  });
});

describe("Windows-account permissions on ranges that people may edit", () => {
  const SID1 = "S-1-5-21-1004336348-1177238915-682003330-1001";
  const SID2 = "S-1-5-21-1004336348-1177238915-682003330-1002";
  const GROUP = "S-1-5-21-1004336348-1177238915-682003330-513";

  it("reads and writes the simple allow and deny entries of SDDL", () => {
    expect(parseSddl(`O:WDG:WDD:(A;;CC;;;${SID1})(A;;CC;;;${SID2})`)).toEqual({ allow: [`sid:${SID1}`, `sid:${SID2}`], deny: [] });
    expect(parseSddl(`O:WDG:WDD:(D;;CC;;;${SID2})(A;;CC;;;WD)`)).toEqual({ allow: ["sid:S-1-1-0"], deny: [`sid:${SID2}`] });
    // Entries Pli can't read are left alone: conditions, object entries, other kinds.
    expect(parseSddl("O:WDG:WDD:(XA;;CC;;;WD;(@User.x==1))(A;;CC;guid;;WD)(AU;;CC;;;WD)(A;;CC;;;ZZ)")).toEqual({ allow: [], deny: [] });
    expect(writeSddl([`sid:${SID1.toLowerCase()}`], [`sid:${SID2}`])).toBe(`O:WDG:WDD:(D;;CC;;;${SID2})(A;;CC;;;${SID1})`);
    expect(writeSddl(["finance"], [])).toBe("");
  });

  it("lets the person with that account edit without a password, and nobody else", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2:B4"], permissions: [`sid:${SID1}`] });
    s.protectSheet("Sheet1");
    refused(() => s.setCell("Sheet1", "B2", 1), /only some people/);
    s.setUser({ id: "ada", accounts: [SID1] });
    s.setCell("Sheet1", "B2", 1);
    s.setUser({ id: "bob", accounts: [SID2] });
    refused(() => s.setCell("Sheet1", "B2", 2), /only some people/);
    // A group the person belongs to counts, and so does the account written in lower case.
    s.setUser({ id: "cy", accounts: [SID2, GROUP.toLowerCase()] });
    s.unprotectSheet("Sheet1");
    s.updateEditRange("Sheet1", "Mine", { permissions: [`sid:${GROUP}`] });
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B3", 3);
  });

  it("Everyone and the groups SDDL names work for anyone with that group", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "All", ranges: ["B2"], permissions: ["sid:S-1-1-0"] });
    s.addEditRange("Sheet1", { name: "Admins", ranges: ["B3"], permissions: ["sid:S-1-5-32-544"] });
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B2", 1); // nobody signed in
    refused(() => s.setCell("Sheet1", "B3", 1));
    s.setUser({ id: "ada", accounts: ["BA"] }); // SDDL's name for Administrators
    s.setCell("Sheet1", "B3", 1);
  });

  it("deny wins, and leaves the password", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2:B4"], permissions: [`sid:${SID1}`, `sid:${SID2}`], denied: [`sid:${SID2}`], password: "pw" });
    s.protectSheet("Sheet1");
    s.setUser({ id: "ada", accounts: [SID1] });
    s.setCell("Sheet1", "B2", 1);
    s.setUser({ id: "bob", accounts: [SID1, SID2] });
    const e = refused(() => s.setCell("Sheet1", "B2", 2), /password/);
    expect(e.editRange?.name).toBe("Mine");
    s.unlockEditRange("Sheet1", "Mine", "pw");
    s.setCell("Sheet1", "B2", 2);
    // Without a password the denied are simply out.
    const t = make();
    t.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], denied: [`sid:${SID2}`] });
    t.protectSheet("Sheet1");
    t.setUser({ id: "ada", accounts: [SID1] });
    t.setCell("Sheet1", "B2", 1); // no list of who may: everyone but the denied
    t.setUser({ id: "bob", accounts: [SID2] });
    refused(() => t.setCell("Sheet1", "B2", 2), /only some people/);
  });

  it("names are accounts too, matched as written", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], permissions: ["account:CORP\\ada"] });
    s.protectSheet("Sheet1");
    s.setUser({ id: "ada", accounts: ["corp\\ADA"] });
    s.setCell("Sheet1", "B2", 1);
  });

  it("changing the accounts of the person forgets the undo history, as changing roles does", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], permissions: [`sid:${SID1}`] });
    s.setUser({ id: "ada", accounts: [SID1] });
    s.protectSheet("Sheet1");
    s.setCell("Sheet1", "B2", 5);
    expect(s.canUndo).toBe(true);
    s.setUser({ id: "ada", accounts: [SID1, SID2] });
    expect(s.canUndo).toBe(false);
  });

  it("is written as the protected range's securityDescriptor and read back as the same accounts", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2:B4"], permissions: [`sid:${SID1}`, `sid:${SID2}`], denied: [`sid:${GROUP}`] });
    s.protectSheet("Sheet1");
    const xml = sheetXml(s);
    expect(xml).toContain(`securityDescriptor="O:WDG:WDD:(D;;CC;;;${GROUP})(A;;CC;;;${SID1})(A;;CC;;;${SID2})"`);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const range = back.workbook.sheets[0]!.editRanges![0]!;
    expect(range.permissions).toEqual([`sid:${SID1}`, `sid:${SID2}`]);
    expect(range.denied).toEqual([`sid:${GROUP}`]);
    expect(range.securityDescriptor).toBe(`O:WDG:WDD:(D;;CC;;;${GROUP})(A;;CC;;;${SID1})(A;;CC;;;${SID2})`);
    const again = new SheetSession(back.workbook);
    again.setUser({ id: "ada", accounts: [SID2] });
    again.setCell("Sheet1", "B2", 7);
    again.setUser({ id: "bob", accounts: [GROUP, SID2] });
    refused(() => again.setCell("Sheet1", "B2", 8));
  });

  it("keeps a descriptor from Excel exactly as it was, whatever else it holds, until the accounts change", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2:B4"], permissions: [`sid:${SID1}`] });
    s.protectSheet("Sheet1");
    // What Excel writes for one allowed account, plus an entry of a kind Pli doesn't read (an audit entry).
    const excel = `O:S-1-5-21-1-2-3-500G:S-1-5-21-1-2-3-513D:(A;;CC;;;${SID1})S:(AU;SA;CC;;;WD)`;
    const w = fromXlsx(toXlsx(s.state)).workbook;
    w.sheets[0]!.editRanges![0]!.securityDescriptor = excel;
    expect(strFromU8(unzipSync(toXlsx(w))["xl/worksheets/sheet1.xml"]!)).toContain(`securityDescriptor="${excel}"`);
    // When the accounts change in Pli, the descriptor is made again from them.
    w.sheets[0]!.editRanges![0]!.permissions = [`sid:${SID2}`];
    expect(strFromU8(unzipSync(toXlsx(w))["xl/worksheets/sheet1.xml"]!)).toContain(`securityDescriptor="O:WDG:WDD:(A;;CC;;;${SID2})"`);
  });

  it("a descriptor it can't read leaves the range closed with a warning, and is kept", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], password: "pw" });
    s.protectSheet("Sheet1");
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('name="Mine"', 'name="Mine" securityDescriptor="O:WDG:WDD:(OA;;CC;guid;;WD)"');
    files["xl/worksheets/sheet1.xml"] = new TextEncoder().encode(xml);
    // (zip again with the changed sheet)
    return import("fflate").then(({ zipSync }) => {
      const back = fromXlsx(zipSync(files));
      expect(back.warnings.join(" ")).toMatch(/names Windows accounts in a way Pli can't read/);
      const range = back.workbook.sheets[0]!.editRanges![0]!;
      expect(range.permissions).toEqual([]);
      expect(range.securityDescriptor).toBe("O:WDG:WDD:(OA;;CC;guid;;WD)");
      expect(range.password).toBeTruthy();
    });
  });

  it("roles of Pli's own and accounts live together: the roles in the extension, the accounts in Excel's list", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Both", ranges: ["B2"], permissions: ["finance", `sid:${SID1}`] });
    s.addEditRange("Sheet1", { name: "Roles", ranges: ["B3"], permissions: ["finance"] });
    s.protectSheet("Sheet1");
    const xml = sheetXml(s);
    expect(xml).toContain('name="Both"');
    expect(xml).not.toContain('name="Roles"'); // left out of Excel's list, so its cells stay locked there
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.editRanges!;
    expect(back.map((r) => [r.name, r.permissions])).toEqual([["Both", ["finance", `sid:${SID1}`]], ["Roles", ["finance"]]]);
  });

  it("is checked when loading, and an unsafe descriptor is refused", () => {
    const s = make();
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], permissions: [`sid:${SID1}`] });
    const json = serializeWorkbook(s.state);
    const bad = JSON.parse(json);
    bad.workbook.sheets[0].editRanges[0].securityDescriptor = "<script>";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/SDDL/);
    const bad2 = JSON.parse(json);
    bad2.workbook.sheets[0].editRanges[0].denied = [""];
    expect(() => parseWorkbook(JSON.stringify(bad2))).toThrow();
    const ok = JSON.parse(json);
    ok.workbook.sheets[0].editRanges[0].securityDescriptor = `O:WDG:WDD:(A;;CC;;;${SID1})`;
    ok.workbook.sheets[0].editRanges[0].denied = [`sid:${SID2}`];
    expect(parseWorkbook(JSON.stringify(ok)).sheets[0]!.editRanges![0]!.denied).toEqual([`sid:${SID2}`]);
  });
});
