import { describe, expect, it } from "vitest";
import { SheetSession, SpellChecker, changeAllMisspellings, changeMisspelling, checkAccessibility, contrastRatio, createWorkbook, findMisspellings, fixAccessibility, fixAllAccessibility, wordList, wordsIn } from "../src";

const make = (rows: (string | number)[][]) => {
  const s = new SheetSession(createWorkbook("r", ["Data"]));
  s.setValues("Data", "A1", rows.map((r) => r.map((v) => (typeof v === "string" ? "'" + v : v))));
  return s;
};

describe("the spelling checker", () => {
  const checker = () => new SpellChecker(["the", "cat", "sat", "on", "mat", "hello", "world", "plan", "make"]);
  it("finds words in a text, with apostrophes inside a word and the places of each", () => {
    expect(wordsIn("Don't panic, ok?")).toEqual([
      { word: "Don't", start: 0, end: 5 },
      { word: "panic", start: 6, end: 11 },
      { word: "ok", start: 13, end: 15 },
    ]);
  });
  it("accepts a host's own words, inflections of them, capitals, and the words skipped by the rules", () => {
    const c = checker();
    expect(c.isCorrect("The")).toBe(true);
    expect(c.isCorrect("cats")).toBe(true);
    expect(c.isCorrect("planned")).toBe(true);
    expect(c.isCorrect("planning")).toBe(true);
    expect(c.isCorrect("making")).toBe(true);
    expect(c.isCorrect("cat's")).toBe(true);
    expect(c.isCorrect("NASA")).toBe(true);
    expect(c.isCorrect("B2B")).toBe(true);
    expect(c.isCorrect("teh")).toBe(false);
    expect(new SpellChecker(["a"], { ignoreUppercase: false }).isCorrect("NASA")).toBe(false);
    expect(c.check("the cat saat on teh mat at https://teh.example.com or me@teh.example.com").map((w) => w.word)).toEqual(["saat", "teh", "at", "or"]);
  });
  it("takes a dictionary that is an object, keeps the person's added words and ignored words", () => {
    const c = new SpellChecker({ has: (w) => w.toLowerCase() === "ok" });
    expect(c.isCorrect("zorp")).toBe(false);
    c.addWord("Zorp");
    expect(c.isCorrect("zorp")).toBe(true);
    expect(c.customWords).toEqual(["zorp"]);
    c.ignoreAll("quux");
    expect(c.isCorrect("Quux")).toBe(true);
    c.resetIgnored();
    expect(c.isCorrect("Quux")).toBe(false);
    c.removeWord("zorp");
    expect(c.isCorrect("zorp")).toBe(false);
  });
  it("suggests close words in the capitals of the misspelling, and from a dictionary's own suggest", () => {
    const c = checker();
    expect(c.suggest("teh")[0]).toBe("the");
    expect(c.suggest("Teh")[0]).toBe("The");
    expect(c.suggest("HELO")[0]).toBe("HELLO");
    expect(new SpellChecker({ has: () => false, suggest: () => ["x", "y"] }).suggest("z")).toEqual(["x", "y"]);
    expect(c.suggest("qqqqqqqq")).toEqual([]);
  });
  it("comes with a small English word list", () => {
    const c = new SpellChecker();
    expect(c.check("The quarterly report shows revenue growing").map((w) => w.word)).toEqual([]);
    expect(c.check("Teh quartrely report").map((w) => w.word)).toEqual(["Teh", "quartrely"]);
  });
});

describe("the spelling check over cells", () => {
  const words = wordList(["the", "cat", "sat", "on", "mat", "hello", "world"]);
  it("lists the misspellings of a range or of every sheet in reading order, skipping formulas, numbers and pivot cells", () => {
    const s = make([["the cat saat", "hello wrold"], ["teh", 42]]);
    s.setCell("Data", "C1", '="teh"');
    const c = new SpellChecker(words);
    const all = findMisspellings(s, c);
    expect(all.map((m) => `${m.address}:${m.word}@${m.start}`)).toEqual(["A1:saat@8", "B1:wrold@6", "A2:teh@0"]);
    expect(findMisspellings(s, c, { sheet: "Data", range: "A2:B2" }).map((m) => m.word)).toEqual(["teh"]);
    expect(findMisspellings(s, c, { sheet: "Data", range: "B1" }).map((m) => m.word)).toEqual(["wrold"]);
  });
  it("changes one word as one undo step, refuses a cell that changed since, and changes all of a word at once", () => {
    const s = make([["the cat saat on the saat", "saat"], ["saat", "x"]]);
    const c = new SpellChecker(words);
    const list = findMisspellings(s, c);
    expect(list).toHaveLength(4);
    changeMisspelling(s, list[0]!, "sat");
    expect(s.value("Data", "A1")).toBe("the cat sat on the saat");
    s.undo();
    expect(s.value("Data", "A1")).toBe("the cat saat on the saat");
    s.setCell("Data", "A1", "'something else");
    expect(() => changeMisspelling(s, list[0]!, "sat")).toThrow(/changed since/);
    s.undo();
    expect(changeAllMisspellings(s, list, "saat", "sat")).toBe(4);
    expect([s.value("Data", "A1"), s.value("Data", "B1"), s.value("Data", "A2")]).toEqual(["the cat sat on the sat", "sat", "sat"]);
    s.undo();
    expect(s.value("Data", "B1")).toBe("saat");
  });
});

describe("the accessibility check", () => {
  it("measures contrast like WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")).toBeGreaterThan(4);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
    expect(contrastRatio("red", "#fff")).toBeNull();
  });
  it("finds merged cells, a table with no header, blank rows and columns, light text, a default sheet name; and fixes the ones that can be", () => {
    const s = new SheetSession(createWorkbook("a", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Name", "Qty"], ["Ink", 3], [null, null], ["Pen", 4]]);
    s.setCell("Sheet1", "D1", "'Total");
    s.setCell("Sheet1", "F1", "'Far");
    s.mergeCells("Sheet1", "H1:I1");
    s.setValues("Sheet1", "A8", [["x", 1], ["y", 2]]);
    const t = s.createTable("Sheet1", "A8:B10");
    s.setTableHeader(t.name, false);
    s.setStyle("Sheet1", "A2", { color: "#eeeeee", fill: "#ffffff" });
    s.setStyle("Sheet1", "A4", { color: "#eeeeee", fill: "#ffffff" });
    const issues = checkAccessibility(s);
    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(["blankColumns", "blankColumns", "blankRows", "blankRows", "defaultSheetName", "lowContrast", "mergedCells", "noHeaderRow"].sort());
    expect(issues[0]!.severity).toBe("error");
    expect(issues.find((i) => i.kind === "lowContrast")!.message).toContain("A2, A4");
    expect(issues.find((i) => i.kind === "defaultSheetName")!.fix).toBeUndefined();
    expect(() => fixAccessibility(s, issues.find((i) => i.kind === "defaultSheetName")!)).toThrow(/by hand/);

    fixAccessibility(s, issues.find((i) => i.kind === "mergedCells")!);
    expect(s.sheet("Sheet1").merges).toBeUndefined();
    fixAccessibility(s, issues.find((i) => i.kind === "lowContrast")!);
    expect(s.cell("Sheet1", "A2")?.s?.color).toBeUndefined();
    expect(s.cell("Sheet1", "A4")?.s?.color).toBeUndefined();
    fixAccessibility(s, issues.find((i) => i.kind === "noHeaderRow")!);
    expect(checkAccessibility(s).some((i) => i.kind === "noHeaderRow" || i.kind === "mergedCells" || i.kind === "lowContrast")).toBe(false);
    const n = fixAllAccessibility(s, checkAccessibility(s));
    expect(n).toBeGreaterThan(0);
    expect(checkAccessibility(s).filter((i) => i.kind === "blankRows" || i.kind === "blankColumns")).toEqual([]);
  });
  it("asks for alternative text on pictures and charts", () => {
    const s = new SheetSession(createWorkbook("a", ["Sales"]));
    s.setValues("Sales", "A1", [["x", 1], ["y", 2]]);
    const chart = s.addChart("Sales", { series: [{ values: "Sales!B1:B2" }] });
    let found = checkAccessibility(s).filter((i) => i.kind === "missingAlt");
    expect(found).toHaveLength(1);
    expect(found[0]!.object).toEqual({ kind: "chart", id: chart.id });
    s.updateChart("Sales", chart.id, { alt: "Two bars" });
    found = checkAccessibility(s).filter((i) => i.kind === "missingAlt");
    expect(found).toEqual([]);
  });
});
