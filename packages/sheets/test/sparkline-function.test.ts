import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, sparklineSvg, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Spark", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [[1, 3, 2, 5, -1]]);
  return s;
};
const shape = (s: SheetSession, a = "H1") => s.sparklineShape("Sheet1", a, 60, 20);

describe("SPARKLINE", () => {
  it("draws a line of a row of numbers in its cell, which is empty text", () => {
    const s = make();
    s.setCell("Sheet1", "H1", "=SPARKLINE(A1:E1)");
    expect(s.value("Sheet1", "H1")).toBe("");
    const sh = shape(s)!;
    expect(sh).toMatchObject({ kind: "line", width: 60, height: 20 });
    if (sh.kind !== "line") throw new Error();
    expect(sh.lines[0]).toHaveLength(5);
    expect(sparklineSvg(sh)).toContain("<polyline");
    expect(shape(s, "A1")).toBeNull();
  });

  it("takes options as an array of pairs or as cells: the kind, colours, points, the axis and its limits", () => {
    const s = make();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:E1,{"charttype","column";"color","red";"negcolor","#00f";"highcolor","green";"axis",TRUE;"axiscolor","gray";"ymax",10})');
    const sh = shape(s)!;
    if (sh.kind !== "bars") throw new Error("expected bars");
    expect(sh.bars).toHaveLength(5);
    expect(sh.bars.map((b) => b.color)).toEqual(["#ff0000", "#ff0000", "#ff0000", "#008000", "#0000ff"]);
    expect(sh.axisColor).toBe("#808080");
    s.setValues("Sheet1", "J1", [["charttype", "winloss"], ["color", "navy"], ["rtl", true]]);
    s.setCell("Sheet1", "H2", "=SPARKLINE(A1:E1,J1:K3)");
    const win = shape(s, "H2")!;
    if (win.kind !== "bars") throw new Error();
    expect(win.bars.map((b) => b.color)).toContain("#000080");
    const one = make();
    one.setCell("Sheet1", "H1", '=SPARKLINE(A1:E1,{"charttype","line","linewidth",2,"empty","zero","highcolor","#0a0"})');
    const line = shape(one)!;
    if (line.kind !== "line") throw new Error();
    expect(line.weight).toBe(2);
    expect(line.dots.map((d) => d.color)).toEqual(["#00aa00"]);
  });

  it("follows its data, and is an error for options it can't read", () => {
    const s = make();
    s.setCell("Sheet1", "H1", "=SPARKLINE(A1:E1)");
    const before = JSON.stringify(shape(s));
    s.setCell("Sheet1", "A1", 20);
    expect(JSON.stringify(shape(s))).not.toBe(before);
    s.setCell("Sheet1", "H3", '=SPARKLINE(A1:E1,{"charttype","pie"})');
    expect(s.value("Sheet1", "H3")).toEqual({ error: "#VALUE!" });
    expect(shape(s, "H3")).toBeNull();
    s.setCell("Sheet1", "H4", '=SPARKLINE(A1:E1,{"color","notacolour"})');
    expect(s.value("Sheet1", "H4")).toEqual({ error: "#VALUE!" });
    s.setCell("Sheet1", "H5", '=SPARKLINE(A1:E1,{"ymin",5,"ymax",1})');
    expect(s.value("Sheet1", "H5")).toEqual({ error: "#VALUE!" });
    s.setCell("Sheet1", "H6", '=SPARKLINE(A1:E1,{"xmin",1,"nan","ignore"})');
    expect(shape(s, "H6")).toMatchObject({ kind: "line" });
    // It stops when the formula is changed or cleared.
    s.setCell("Sheet1", "H1", "x");
    expect(shape(s)).toBeNull();
  });

  it("is kept in files as the formula, and Excel, which has no such function, will not draw it", () => {
    const s = make();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:E1,{"charttype","column"})');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.cell("Sheet1", "H1")!.f).toBe('SPARKLINE(A1:E1,{"charttype","column"})');
    expect(back.sparklineShape("Sheet1", "H1", 60, 20)).toMatchObject({ kind: "bars" });
  });
});
