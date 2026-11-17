import { describe, expect, it } from "vitest";
import { BAR_COLORS, SheetSession, createWorkbook, layoutBarSparkline, sparklineSvg } from "../src";
import { COLOR_NAMES } from "../src/functions/color-names";

const make = () => {
  const s = new SheetSession(createWorkbook("Spark", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [[20, 30, 50]]);
  return s;
};
const shape = (s: SheetSession, a = "H1", w = 100, h = 20) => s.sparklineShape("Sheet1", a, w, h);
const bars = (s: SheetSession, a = "H1") => {
  const sh = shape(s, a);
  if (sh?.kind !== "bars") throw new Error("not bars");
  return sh.bars;
};

describe("SPARKLINE colour names", () => {
  it("knows the 148 names CSS has, in any case, and #rgb", () => {
    expect(Object.keys(COLOR_NAMES)).toHaveLength(148);
    const s = make();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:C1,{"charttype","column";"color","RebeccaPurple"})');
    expect(bars(s)[0]!.color).toBe("#663399");
    s.setCell("Sheet1", "H2", '=SPARKLINE(A1:C1,{"charttype","column";"color","cornflowerblue"})');
    expect(bars(s, "H2")[0]!.color).toBe("#6495ed");
    s.setCell("Sheet1", "H3", '=SPARKLINE(A1:C1,{"charttype","column";"color","#0f8"})');
    expect(bars(s, "H3")[0]!.color).toBe("#00ff88");
    s.setCell("Sheet1", "H4", '=SPARKLINE(A1:C1,{"charttype","column";"color","grey"})');
    expect(bars(s, "H4")[0]!.color).toBe("#808080");
    s.setCell("Sheet1", "H5", '=SPARKLINE(A1:C1,{"charttype","column";"color","greenish"})');
    expect(s.value("Sheet1", "H5")).toEqual({ error: "#VALUE!" });
  });
});

describe("SPARKLINE bar charts", () => {
  it("draws one stacked bar, a segment for each number, in color1, color2, color3…", () => {
    const s = make();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:C1,{"charttype","bar";"color1","red";"color2","blue";"color3","green"})');
    expect(s.value("Sheet1", "H1")).toBe("");
    const b = bars(s);
    expect(b.map((x) => x.color)).toEqual(["#ff0000", "#0000ff", "#008000"]);
    // The whole width (less the padding) is the total, 100: the segments are 20, 30 and 50 of it.
    const span = b.reduce((n, x) => n + x.w, 0);
    expect(b.map((x) => Math.round((x.w / span) * 100))).toEqual([20, 30, 50]);
    expect(b[0]!.x).toBeLessThan(b[1]!.x);
    expect(b[1]!.x).toBeCloseTo(b[0]!.x + b[0]!.w, 6);
    expect(sparklineSvg(shape(s)!)).toContain("<rect");
  });

  it("scales to max when it is more than the total, and ignores it when it is less", () => {
    const s = make();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:C1,{"charttype","bar";"max",200})');
    const wide = bars(s);
    expect(wide.reduce((n, x) => n + x.w, 0)).toBeCloseTo(((100 - 2 * 2.5) * 100) / 200, 6); // half the room
    s.setCell("Sheet1", "H2", '=SPARKLINE(A1:C1,{"charttype","bar";"max",10})');
    const full = bars(s, "H2");
    expect(full.reduce((n, x) => n + x.w, 0)).toBeCloseTo(100 - 2 * 2.5, 6);
  });

  it("starts with the default colours, skips negative and empty numbers, and can run right to left", () => {
    const s = make();
    s.setValues("Sheet1", "A2", [[10, -5, null, 30]]);
    s.setCell("Sheet1", "H1", '=SPARKLINE(A2:D2,{"charttype","bar"})');
    const b = bars(s);
    expect(b).toHaveLength(2);
    expect(b.map((x) => x.color)).toEqual([BAR_COLORS[0], BAR_COLORS[3]]);
    s.setCell("Sheet1", "H2", '=SPARKLINE(A2:D2,{"charttype","bar";"rtl",TRUE})');
    const r = bars(s, "H2");
    expect(r[0]!.x).toBeGreaterThan(r[1]!.x);
    // A row of nothing positive draws nothing.
    s.setValues("Sheet1", "A3", [[0, -1]]);
    s.setCell("Sheet1", "H3", '=SPARKLINE(A3:B3,{"charttype","bar"})');
    expect(bars(s, "H3")).toEqual([]);
    expect(layoutBarSparkline([], { colors: [] }, 50, 10)).toMatchObject({ kind: "bars", bars: [] });
  });
});

describe("SPARKLINE x values, xmin and xmax", () => {
  const withXs = () => {
    const s = new SheetSession(createWorkbook("Spark", ["Sheet1"]));
    // x in the first column, y in the second: an uneven spacing.
    s.setValues("Sheet1", "A1", [[0, 5], [1, 7], [2, 6], [10, 9]]);
    return s;
  };
  const xsOf = (s: SheetSession, a: string) => {
    const sh = shape(s, a, 104, 20);
    if (sh?.kind !== "line") throw new Error("not a line");
    return sh.lines.flat().map(([x]) => Math.round(x));
  };

  it("places the points of a two-column range by their x, not evenly", () => {
    const s = withXs();
    s.setCell("Sheet1", "H1", "=SPARKLINE(A1:B4)");
    const x = xsOf(s, "H1");
    expect(x).toHaveLength(4);
    // 0, 1, 2 and 10 over the room from 2 to 102: the first three are bunched at the left.
    expect(x[0]).toBe(3); // 2.5 of padding
    expect(x[1]! - x[0]!).toBeLessThan(11); // a tenth of the way
    expect(x[3]).toBe(102);
    s.setCell("Sheet1", "H2", "=SPARKLINE(A1:A4)");
    expect(xsOf(s, "H2")).toEqual([3, 36, 69, 102]); // one column: y only, evenly
  });

  it("clips to xmin and xmax, and the axis runs between them", () => {
    const s = withXs();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:B4,{"xmin",1;"xmax",11})');
    const x = xsOf(s, "H1");
    // The point at 0 is outside; 1 is the left edge, 10 sits at nine tenths of the way.
    expect(x).toHaveLength(3);
    expect(x[0]).toBe(3);
    expect(x[2]).toBe(92);
    s.setCell("Sheet1", "H2", '=SPARKLINE(A1:B4,{"xmax",20})');
    const y = xsOf(s, "H2");
    expect(y[0]).toBe(3);
    expect(y[3]).toBe(52);
    s.setCell("Sheet1", "H3", '=SPARKLINE(A1:B4,{"xmin",5;"xmax",5})');
    expect(s.value("Sheet1", "H3")).toEqual({ error: "#VALUE!" });
    s.setCell("Sheet1", "H4", '=SPARKLINE(A1:B4,{"xmin","a"})');
    expect(s.value("Sheet1", "H4")).toEqual({ error: "#VALUE!" });
  });

  it("works for columns too", () => {
    const s = withXs();
    s.setCell("Sheet1", "H1", '=SPARKLINE(A1:B4,{"charttype","column"})');
    const b = bars(s);
    expect(b).toHaveLength(4);
    expect(b[3]!.x).toBeGreaterThan(b[2]!.x + 40);
  });
});

describe("SPARKLINE nan", () => {
  it("leaves text out of a line (a gap), or counts it as zero with \"nan\",\"convert\"", () => {
    const s = new SheetSession(createWorkbook("Spark", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [[4, "n/a", 6, null, 8]]);
    const runs = (a: string) => {
      const sh = shape(s, a);
      if (sh?.kind !== "line") throw new Error("not a line");
      return sh.lines.map((r) => r.length);
    };
    s.setCell("Sheet1", "H1", "=SPARKLINE(A1:E1)");
    expect(runs("H1")).toEqual([1, 1, 1]);
    s.setCell("Sheet1", "H2", '=SPARKLINE(A1:E1,{"nan","convert"})');
    // The text is a point at zero; the empty cell is still a gap.
    expect(runs("H2")).toEqual([3, 1]);
    s.setCell("Sheet1", "H3", '=SPARKLINE(A1:E1,{"nan","convert";"empty","zero"})');
    expect(runs("H3")).toEqual([5]);
    s.setCell("Sheet1", "H4", '=SPARKLINE(A1:E1,{"nan","ignore"})');
    expect(runs("H4")).toEqual([1, 1, 1]);
  });
});
