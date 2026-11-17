import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Sort", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty"],
    ["West", "Pens", 10],
    ["East", "Paper", 4],
    ["West", "Ink", 2],
    ["North", "Pens", 7],
    ["East", "Ink", 9],
  ]);
  s.createTable("Sheet1", "A1:C6", { name: "Sales" });
  return s;
};
const col = (s: SheetSession, c: string) => [2, 3, 4, 5, 6].map((r) => s.value("Sheet1", `${c}${r}`));

describe("sorting a table by more than one column", () => {
  it("sorts by the first level, then the next for ties, and keeps the levels", () => {
    const s = make();
    s.sortTableBy("Sales", [{ column: "Region" }, { column: "Qty", descending: true }]);
    expect(col(s, "A")).toEqual(["East", "East", "North", "West", "West"]);
    expect(col(s, "C")).toEqual([9, 4, 7, 10, 2]);
    const t = s.tables("Sheet1")[0]!;
    expect(t.sort).toEqual({ column: "Region", then: [{ column: "Qty", descending: true }] });
    expect(s.tableSort("Sales")).toEqual([{ column: "Region" }, { column: "Qty", descending: true }]);
  });

  it("is one undo step, and rows no level tells apart keep their order", () => {
    const s = make();
    s.sortTableBy("Sales", [{ column: "Item" }]);
    expect(col(s, "B")).toEqual(["Ink", "Ink", "Paper", "Pens", "Pens"]);
    expect(col(s, "C")).toEqual([2, 9, 4, 10, 7]); // Ink: West 2 then East 9, as they were
    s.undo();
    expect(col(s, "A")).toEqual(["West", "East", "West", "North", "East"]);
    expect(s.tables("Sheet1")[0]!.sort).toBeUndefined();
  });

  it("sortTable keeps working as one level and replaces a longer sort", () => {
    const s = make();
    s.sortTableBy("Sales", [{ column: "Region" }, { column: "Qty" }]);
    s.sortTable("Sales", "Qty", "descending");
    expect(s.tables("Sheet1")[0]!.sort).toEqual({ column: "Qty", descending: true });
    expect(col(s, "C")).toEqual([10, 9, 7, 4, 2]);
  });

  it("refuses a sort that names no column, a column twice, or something that isn't a colour", () => {
    const s = make();
    expect(() => s.sortTableBy("Sales", [])).toThrow(/at least one level/);
    expect(() => s.sortTableBy("Sales", [{ column: "Nope" }])).toThrow();
    expect(() => s.sortTableBy("Sales", [{ column: "Qty" }, { column: "qty", descending: true }])).toThrow(/twice/);
    expect(() => s.sortTableBy("Sales", [{ column: "Qty", by: "cellColor", color: "red" }])).toThrow(/colour/);
    expect(() => s.sortTableBy("Sales", [{ column: "Qty", by: "icon" }])).toThrow(/icon/);
    expect(() => s.sortTableBy("Sales", [{ column: "Qty", by: "icon", icon: { set: "3Arrows", index: 3 } }])).toThrow(/icon/);
    expect(() => s.sortTableBy("Sales", [{ column: "Qty", by: "fontColor", color: "none" }])).toThrow();
  });

  it("follows a renamed column and forgets the levels of a deleted one", () => {
    const s = make();
    s.sortTableBy("Sales", [{ column: "Region" }, { column: "Item" }, { column: "Qty" }]);
    s.setValues("Sheet1", "B1", [["Product"]]);
    expect(s.tableSort("Sales").map((l) => l.column)).toEqual(["Region", "Product", "Qty"]);
    s.deleteColumns("Sheet1", 1, 1);
    expect(s.tableSort("Sales").map((l) => l.column)).toEqual(["Product", "Qty"]);
  });

  it("keeps rows the filters hide hidden after a sort", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["West"]);
    s.sortTableBy("Sales", [{ column: "Qty" }]);
    const hidden = Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r));
    const shown = [2, 3, 4, 5, 6].filter((r) => !hidden.includes(r)).map((r) => s.value("Sheet1", `A${r}`));
    expect(shown).toEqual(["West", "West"]);
  });

  it("round-trips through the workbook JSON and rejects a bad sort there", () => {
    const s = make();
    s.sortTableBy("Sales", [{ column: "Region", by: "cellColor", color: "#FFC7CE", descending: true }, { column: "Qty" }]);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.tables![0]!.sort).toEqual({ column: "Region", by: "cellColor", color: "#ffc7ce", descending: true, then: [{ column: "Qty" }] });
    const json = JSON.parse(serializeWorkbook(s.state));
    json.workbook.sheets[0].tables[0].sort.then[0].by = "bogus";
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow(/sort/);
    json.workbook.sheets[0].tables[0].sort.then[0] = { column: "Nope" };
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow();
  });
});

describe("sorting by colour and icon", () => {
  const red = "#ffc7ce";
  const green = "#c6efce";
  const colored = () => {
    const s = make();
    s.setStyle("Sheet1", "C3", { fill: red }); // East 4
    s.setStyle("Sheet1", "C5", { fill: green }); // North 7
    s.setStyle("Sheet1", "C6", { fill: red }); // East 9
    s.setStyle("Sheet1", "B2", { color: "#ff0000" }); // Pens (West 10)
    s.setStyle("Sheet1", "B5", { color: "#ff0000" }); // Pens (North 7)
    return s;
  };

  it("puts one fill colour on top and leaves the rest in order", () => {
    const s = colored();
    s.sortTableBy("Sales", [{ column: "Qty", by: "cellColor", color: red }]);
    expect(col(s, "C")).toEqual([4, 9, 10, 2, 7]);
  });

  it("descending puts the colour at the bottom", () => {
    const s = colored();
    s.sortTableBy("Sales", [{ column: "Qty", by: "cellColor", color: red, descending: true }]);
    expect(col(s, "C")).toEqual([10, 2, 7, 4, 9]);
  });

  it("puts the cells with no fill on top with `none`, and sorts by font colour with `auto` for the default", () => {
    const s = colored();
    s.sortTableBy("Sales", [{ column: "Qty", by: "cellColor", color: "none" }]);
    expect(col(s, "C")).toEqual([10, 2, 4, 7, 9]);
    const t = colored();
    t.sortTableBy("Sales", [{ column: "Item", by: "fontColor", color: "#ff0000" }]);
    expect(col(t, "B").slice(0, 2)).toEqual(["Pens", "Pens"]);
    t.sortTableBy("Sales", [{ column: "Item", by: "fontColor", color: "auto", descending: true }]);
    expect(col(t, "B").slice(0, 2)).toEqual(["Pens", "Pens"]); // the default colour goes to the bottom
  });

  it("chains colours with other levels: each colour in turn, then the value", () => {
    const s = colored();
    s.sortTableBy("Sales", [
      { column: "Qty", by: "cellColor", color: red },
      { column: "Qty", by: "cellColor", color: green },
      { column: "Qty", descending: true },
    ]);
    expect(col(s, "C")).toEqual([9, 4, 7, 10, 2]);
  });

  it("lists the colours and icons a column can be sorted by", () => {
    const s = colored();
    expect(s.tableSortChoices("Sales", "Qty")).toEqual({ fills: ["none", green, red], fonts: ["auto"], icons: [null] });
    expect(s.tableSortChoices("Sales", "Item").fonts).toEqual(["auto", "#ff0000"]);
    expect(s.sortChoices("Sheet1", "A1:C6", 3, { header: true }).fills).toEqual(["none", green, red]);
  });

  it("counts a conditional format's colour and its icons", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["8"], ranges: ["C2:C6"], style: { fill: "#ff0000" } } as never);
    s.sortTableBy("Sales", [{ column: "Qty", by: "cellColor", color: "#ff0000" }]);
    expect(col(s, "C").slice(0, 2)).toEqual([10, 9]);
    const t = make();
    t.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["C2:C6"], thresholds: [{ type: "num", value: 5 }, { type: "num", value: 9 }] } as never);
    expect(t.tableSortChoices("Sales", "Qty").icons).toEqual([{ set: "3Arrows", index: 0 }, { set: "3Arrows", index: 1 }, { set: "3Arrows", index: 2 }]);
    t.sortTableBy("Sales", [{ column: "Qty", by: "icon", icon: { set: "3Arrows", index: 2 } }, { column: "Qty" }]);
    expect(col(t, "C")).toEqual([9, 10, 2, 4, 7]);
    t.sortTableBy("Sales", [{ column: "Qty", by: "icon", icon: { set: "3Arrows", index: 0 }, descending: true }, { column: "Qty", descending: true }]);
    expect(col(t, "C")).toEqual([10, 9, 7, 4, 2]);
  });

  it("sorts a plain range by several levels, and by colour", () => {
    const s = make();
    s.setStyle("Sheet1", "A4", { fill: red });
    s.sort("Sheet1", "A1:C6", { header: true, levels: [{ column: 1 }, { column: 3, descending: true }] });
    expect([2, 3, 4, 5, 6].map((r) => s.value("Sheet1", `C${r}`))).toEqual([9, 4, 7, 10, 2]);
    s.sort("Sheet1", "A1:C6", { header: true, levels: [{ column: 1, by: "cellColor", color: red }] });
    expect(s.value("Sheet1", "C2")).toBe(2);
    expect(() => s.sort("Sheet1", "A1:C6", { levels: [{ column: 4 }] })).toThrow(/outside/);
    expect(() => s.sort("Sheet1", "A1:C6", { levels: [] })).toThrow();
  });
});

describe("a table's sort in an XLSX file", () => {
  const sortState = (bytes: Uint8Array) => {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /xl\/tables\/table\d+\.xml/.test(n))!;
    return strFromU8(files[name]!).match(/<sortState[\s\S]*?<\/sortState>/)?.[0] ?? "";
  };

  it("writes a condition for each level and reads them back", () => {
    const s = make();
    s.setStyle("Sheet1", "C3", { fill: "#ffc7ce" });
    s.setStyle("Sheet1", "B2", { color: "#ff0000" });
    s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["C2:C6"], thresholds: [{ type: "num", value: 5 }, { type: "num", value: 9 }] } as never);
    s.sortTableBy("Sales", [
      { column: "Region", descending: true },
      { column: "Qty", by: "cellColor", color: "#ffc7ce" },
      { column: "Item", by: "fontColor", color: "auto", descending: true },
      { column: "Qty", by: "icon", icon: { set: "3Arrows", index: 2 } },
    ]);
    const bytes = toXlsx(s.state);
    const xml = sortState(bytes);
    expect(xml).toContain('<sortState ref="A2:C6">');
    expect(xml).toContain('<sortCondition descending="1" ref="A2:A6"/>');
    expect(xml).toMatch(/<sortCondition ref="C2:C6" sortBy="cellColor" dxfId="\d+"\/>/);
    expect(xml).toMatch(/<sortCondition descending="1" ref="B2:B6" sortBy="fontColor" dxfId="\d+"\/>/);
    expect(xml).toContain('<sortCondition ref="C2:C6" sortBy="icon" iconSet="3Arrows" iconId="2"/>');
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.tables![0]!.sort).toEqual({
      column: "Region",
      descending: true,
      then: [
        { column: "Qty", by: "cellColor", color: "#ffc7ce" },
        { column: "Item", by: "fontColor", color: "auto", descending: true },
        { column: "Qty", by: "icon", icon: { set: "3Arrows", index: 2 } },
      ],
    });
  });

  it("leaves out an icon level the file has no place for, and says nothing wrong about the rest", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "iconSet", set: "3Stars", ranges: ["C2:C6"], thresholds: [{ type: "num", value: 5 }, { type: "num", value: 9 }] } as never);
    s.sortTableBy("Sales", [{ column: "Qty", by: "icon", icon: { set: "3Stars", index: 1 } }, { column: "Region" }]);
    const xml = sortState(toXlsx(s.state));
    expect(xml).not.toContain("icon");
    expect(xml).toContain('ref="A2:A6"');
  });
});
