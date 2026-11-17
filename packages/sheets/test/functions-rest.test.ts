import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type Value } from "../src";

function value(formula: string, cells: Record<string, string | number> = {}): Value {
  const s = new SheetSession(createWorkbook("f"), { now: () => 45000.5 });
  s.setCells("Sheet1", cells);
  s.setCell("Sheet1", "Z1", "=" + formula);
  return s.value("Sheet1", "Z1");
}
const err = (e: string) => ({ error: e });

/** The two parts of a complex number written as text. */
function parts(v: Value): [number, number] {
  const t = String(v);
  const pure = /^([+-]?[\d.]*(?:E[+-]?\d+)?)[ij]$/.exec(t);
  if (pure) return [0, pure[1] === "" || pure[1] === "+" ? 1 : pure[1] === "-" ? -1 : Number(pure[1])];
  const m = /^([+-]?[\d.]+(?:E[+-]?\d+)?)(?:([+-][\d.]*(?:E[+-]?\d+)?)[ij])?$/.exec(t)!;
  return [Number(m[1]), m[2] === undefined ? 0 : m[2] === "+" ? 1 : m[2] === "-" ? -1 : Number(m[2])];
}

describe("complex numbers", () => {
  it("reproduces the examples in Excel's help", () => {
    // Excel's help says -46+9i; Excel itself works it out in polar form and shows the noise.
    expect(value('IMPOWER("2+3i",3)')).toBe("-46+9.00000000000001i");
    expect(value('IMSQRT("1+i")')).toBe("1.09868411346781+0.455089860562227i");
    expect(value('IMSIN("3+4i")')).toBe("3.85373803791938-27.0168132580039i");
    expect(value('IMCOS("1+i")')).toBe("0.833730025131149-0.988897705762865i");
    expect(value('IMEXP("1+i")')).toBe("1.46869393991589+2.28735528717884i");
    expect(value('IMLN("3+4i")')).toBe("1.6094379124341+0.927295218001612i");
    expect(value('IMLOG10("3+4i")')).toBe("0.698970004336019+0.402719196273373i");
    expect(value('IMLOG2("3+4i")')).toBe("2.32192809488736+1.33780421245098i");
  });

  it("keeps the suffix of its arguments and reads a lone imaginary part", () => {
    expect(value('IMSQRT("-4")')).toBe("2i");
    expect(value('IMSQRT("-4j")')).toBe("1.4142135623731+1.4142135623731j".replace("1.4142135623731+", "1.4142135623731-").replace("-1.4142135623731j", "-1.4142135623731j"));
    expect(value('IMEXP("4j")')).toBe("-0.653643620863612-0.756802495307928j");
    expect(value('IMSIN("2j")')).toBe("3.62686040784702j");
    expect(value('IMREAL("4i")')).toBe(0);
    expect(value('IMAGINARY("4i")')).toBe(4);
    expect(value('IMABS("4j")')).toBe(4);
    expect(value("IMCOSH(0)")).toBe("1");
    expect(value('IMSUM(1,"2j")')).toBe("1+2j");
  });

  it("sees the identities between the functions", () => {
    for (const z of ['"1+i"', '"3-2i"', '"0.5+0.25i"', "2"]) {
      const sec = parts(value(`IMSEC(${z})`));
      const cos = parts(value(`IMDIV(1,IMCOS(${z}))`));
      expect(sec[0]).toBeCloseTo(cos[0], 9);
      expect(sec[1]).toBeCloseTo(cos[1], 9);
      // sin² + cos² = 1
      const sq = parts(value(`IMSUM(IMPOWER(IMSIN(${z}),2),IMPOWER(IMCOS(${z}),2))`));
      expect(sq[0]).toBeCloseTo(1, 9);
      expect(sq[1]).toBeCloseTo(0, 9);
      // cosh² - sinh² = 1
      const h = parts(value(`IMSUB(IMPOWER(IMCOSH(${z}),2),IMPOWER(IMSINH(${z}),2))`));
      expect(h[0]).toBeCloseTo(1, 9);
      expect(h[1]).toBeCloseTo(0, 9);
      // exp of the log and the square of the root
      const e = parts(value(`IMEXP(IMLN(${z}))`));
      const original = parts(value(`IMSUM(${z})`));
      expect(e[0]).toBeCloseTo(original[0], 9);
      expect(e[1]).toBeCloseTo(original[1], 9);
      const root = parts(value(`IMPRODUCT(IMSQRT(${z}),IMSQRT(${z}))`));
      expect(root[0]).toBeCloseTo(original[0], 9);
      expect(root[1]).toBeCloseTo(original[1], 9);
      // tan = sin/cos, cot = 1/tan, csc = 1/sin
      const tan = parts(value(`IMTAN(${z})`));
      const quot = parts(value(`IMDIV(IMSIN(${z}),IMCOS(${z}))`));
      expect(tan[0]).toBeCloseTo(quot[0], 9);
      expect(tan[1]).toBeCloseTo(quot[1], 9);
    }
  });

  it("takes spaces around the sign (Excel does), and works in polar form for IMPOWER, with Excel's own digits", () => {
    expect(value('IMSIN("3 + 4i")')).toBe("3.85373803791938-27.0168132580039i");
    expect(value('IMSIN("3 +4i")')).toBe("3.85373803791938-27.0168132580039i");
    expect(value('IMSIN("3 4i")')).toEqual(err("#NUM!"));
    expect(value('IMSIN("3 + 4 i")')).toEqual(err("#NUM!"));
    // Excel's answers (excel-check/back/42-functions-rest.xlsx), noise in the last digits and all.
    expect(value('IMPOWER("2+3i",3)')).toBe("-46+9.00000000000001i");
    expect(value('IMPOWER("4j",-1)')).toBe("1.53080849893419E-17-0.25j");
    expect(value('IMPOWER("1+i",0.5)')).toBe("1.09868411346781+0.455089860562227i");
  });

  it("is #NUM! for text that isn't a complex number, #VALUE! for mixed suffixes, #NUM! where there is no answer", () => {
    expect(value('IMSIN("abc")')).toEqual(err("#NUM!"));
    expect(value('IMPOWER("0",-1)')).toEqual(err("#NUM!"));
    expect(value('IMSUM("1+i","1+j")')).toEqual(err("#VALUE!"));
    expect(value('IMPRODUCT("2i","3j")')).toEqual(err("#VALUE!"));
    expect(value('IMLN("0")')).toEqual(err("#NUM!"));
    expect(value('IMLOG10("0")')).toEqual(err("#NUM!"));
    expect(value('IMLOG2("0")')).toEqual(err("#NUM!"));
    expect(value('IMCSC("0")')).toEqual(err("#NUM!"));
    expect(value('IMCOT("0")')).toEqual(err("#NUM!"));
    expect(value('IMCSCH("0")')).toEqual(err("#NUM!"));
    expect(value('IMPOWER("0",0)')).toEqual(err("#NUM!"));
    expect(value('IMPOWER("0",-1)')).toEqual(err("#NUM!"));
    expect(value('IMPOWER("0",2)')).toBe("0");
    expect(value('IMPOWER("1+i","x")')).toEqual(err("#VALUE!"));
    expect(value('IMEXP("1000")')).toEqual(err("#NUM!"));
    expect(value("IMSIN(1/0)")).toEqual(err("#DIV/0!"));
  });

  it("works over arrays and writes very small numbers the way Excel does", () => {
    expect(value('SUM(IMABS(IMEXP({"i","2i"})))') as number).toBeCloseTo(2, 12);
    expect(value('IMEXP("3.14159265358979i")')).toBe("-1+3.23108914886517E-15i");
  });

  it("is written to XLSX with the prefix Excel gives the newer ones and read back", () => {
    const s = new SheetSession(createWorkbook("c"));
    s.setCell("Sheet1", "A1", '=IMTAN("1+i")');
    s.setCell("Sheet1", "A2", '=IMSIN("1+i")');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.cell("Sheet1", "A1")?.f).toBe('IMTAN("1+i")');
    expect(back.value("Sheet1", "A1")).toBe("0.271752585319512+1.08392332733869i");
  });
});

describe("LAMBDA optional parameters and ISOMITTED", () => {
  const f = (call: string) => value(`LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),${call})`);

  it("tells whether an optional parameter was given", () => {
    expect(f("f(5)")).toBe(5);
    expect(f("f(5,2)")).toBe(7);
    expect(f("f(5,)")).toBe(5);
    expect(value("LET(g,LAMBDA([a],[b],IF(ISOMITTED(a),100,a)+IF(ISOMITTED(b),1000,b)),g(,5))")).toBe(105);
    expect(value("LET(g,LAMBDA([a],[b],IF(ISOMITTED(a),100,a)+IF(ISOMITTED(b),1000,b)),g())")).toBe(1100);
  });

  it("calls a LAMBDA where it stands, and writes and reads it back the way Excel's file has it", () => {
    expect(value("LAMBDA(x,x+1)(5)")).toBe(6);
    expect(value("LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(5)")).toBe(5);
    expect(value("LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(5,2)")).toBe(7);
    expect(value("(LAMBDA(x,x+1))(5)+1")).toBe(7);
    expect(value("LAMBDA(x,LAMBDA(y,x+y))(2)(3)")).toBe(5);
    expect(value("LAMBDA(x,x+1)()")).toEqual(err("#VALUE!"));
    expect(value("LAMBDA(x,x+1)(1,2)")).toEqual(err("#VALUE!"));
    expect(value("SUM(1)(2)")).toEqual(err("#VALUE!"));
    const s = new SheetSession(createWorkbook("f"));
    s.setCell("Sheet1", "A1", "=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(5,2)");
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.cell("Sheet1", "A1")?.f).toBe("LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(5,2)");
    expect(back.value("Sheet1", "A1")).toBe(7);
  });

  it("reads an omitted parameter as empty, and a given empty one is not omitted", () => {
    expect(value("LET(g,LAMBDA(x,[y],x+y),g(1))")).toBe(1);
    expect(value("LET(g,LAMBDA(x,[y],y&\"!\"),g(1))")).toBe("!");
    expect(value("LET(g,LAMBDA(x,[y],ISOMITTED(y)),g(1,A5))")).toBe(false);
    expect(value("LET(g,LAMBDA(x,[y],ISOMITTED(y)),g(1,\"\"))")).toBe(false);
  });

  it("is #VALUE! with too few or too many arguments, a required parameter after an optional one, or a bad ISOMITTED", () => {
    expect(value("LET(g,LAMBDA(x,[y],x),g())")).toEqual(err("#VALUE!"));
    expect(value("LET(g,LAMBDA(x,[y],x),g(1,2,3))")).toEqual(err("#VALUE!"));
    expect(value("LET(g,LAMBDA(x,x),g(1,2))")).toEqual(err("#VALUE!"));
    expect(value("LET(g,LAMBDA([x],y,x),g(1,2))")).toEqual(err("#VALUE!"));
    expect(value("ISOMITTED(A1)")).toEqual(err("#VALUE!"));
    expect(value("ISOMITTED(1)")).toEqual(err("#VALUE!"));
    expect(value("LET(g,LAMBDA(x,ISOMITTED(x)),g(1))")).toBe(false);
  });

  it("works when the LAMBDA is given to MAP, REDUCE and the like", () => {
    expect(value("LET(g,LAMBDA(a,[b],IF(ISOMITTED(b),a,a*b)),SUM(MAP({1,2,3},LAMBDA(v,g(v)))))")).toBe(6);
    expect(value("LET(g,LAMBDA(a,[b],IF(ISOMITTED(b),a,a*b)),SUM(MAP({1,2,3},{4,5,6},LAMBDA(v,w,g(v,w)))))")).toBe(32);
    expect(value("REDUCE(0,{1,2,3},LAMBDA(acc,[v],acc+v))")).toBe(6);
    expect(value("MAP({1,2},LAMBDA(a,[b],ISOMITTED(b)))")).toBe(true);
  });

  it("round-trips through XLSX with _xlop.y and _xlfn.ISOMITTED, as Excel writes them", () => {
    const s = new SheetSession(createWorkbook("l"));
    s.setCell("Sheet1", "A1", "=LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(1))");
    s.setCell("Sheet1", "A2", "=LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(1,2))");
    const bytes = toXlsx(s.state);
    const xml = new TextDecoder().decode(require("fflate").unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
    expect(xml).toContain("_xlfn.LAMBDA(_xlpm.x,_xlop.y,IF(_xlfn.ISOMITTED(_xlpm.y),_xlpm.x,_xlpm.x+_xlpm.y))");
    const back = new SheetSession(fromXlsx(bytes).workbook);
    expect(back.cell("Sheet1", "A1")?.f).toBe("LET(f,LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y)),f(1))");
    expect(back.value("Sheet1", "A1")).toBe(1);
    expect(back.value("Sheet1", "A2")).toBe(3);
  });
});

describe("FORECAST.ETS", () => {
  const rows = (ys: number[], ts?: number[]) => {
    const cells: Record<string, number> = {};
    ys.forEach((y, i) => ((cells[`A${i + 1}`] = y), (cells[`B${i + 1}`] = ts ? ts[i]! : i + 1)));
    return cells;
  };
  const LINE = rows([3, 5, 7, 9, 11, 13, 15, 17]);
  const PATTERN = rows([10, 20, 30, 20, 10, 20, 30, 20, 10, 20, 30, 20]);

  it("carries a straight line on", () => {
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8)", LINE) as number).toBeCloseTo(19, 9);
    expect(value("FORECAST.ETS(12,A1:A8,B1:B8)", LINE) as number).toBeCloseTo(25, 9);
    expect(value("FORECAST.ETS(5,A1:A8,B1:B8)", LINE) as number).toBeCloseTo(11, 9); // inside the data: the fitted value
    expect(value("FORECAST.ETS(9.5,A1:A8,B1:B8)", LINE) as number).toBeCloseTo(20, 9); // between steps
    expect(value("FORECAST.ETS.SEASONALITY(A1:A8,B1:B8)", LINE)).toBe(1);
  });

  it("finds a repeating pattern and carries it on", () => {
    expect(value("FORECAST.ETS.SEASONALITY(A1:A12,B1:B12)", PATTERN)).toBe(4);
    expect(value("FORECAST.ETS(13,A1:A12,B1:B12)", PATTERN) as number).toBeCloseTo(10, 6);
    expect(value("FORECAST.ETS(15,A1:A12,B1:B12)", PATTERN) as number).toBeCloseTo(30, 6);
    expect(value("FORECAST.ETS(15,A1:A12,B1:B12,4)", PATTERN) as number).toBeCloseTo(30, 6);
    expect(value("FORECAST.ETS.SEASONALITY(A1:A12,B1:B12)", PATTERN)).toBe(4);
    // No pattern wanted: the forecast is a straight continuation and can't follow it.
    expect(Math.abs((value("FORECAST.ETS(15,A1:A12,B1:B12,0)", PATTERN) as number) - 30)).toBeGreaterThan(3);
  });

  it("takes an array of targets and spills", () => {
    const s = new SheetSession(createWorkbook("f"));
    s.setCells("Sheet1", LINE);
    s.setCell("Sheet1", "D1", "=FORECAST.ETS({9;10;11},A1:A8,B1:B8)");
    expect([s.value("Sheet1", "D1"), s.value("Sheet1", "D2"), s.value("Sheet1", "D3")].map((v) => Math.round(v as number))).toEqual([19, 21, 23]);
  });

  it("has a confidence interval that is 0 for a perfect line, widens with the target and with the level", () => {
    expect(value("FORECAST.ETS.CONFINT(9,A1:A8,B1:B8)", LINE) as number).toBeCloseTo(0, 6);
    const noisy = rows([10, 12, 9, 13, 11, 14, 10, 15, 12, 16, 11, 17]);
    const near = value("FORECAST.ETS.CONFINT(13,A1:A12,B1:B12,0.95,0)", noisy) as number;
    const far = value("FORECAST.ETS.CONFINT(20,A1:A12,B1:B12,0.95,0)", noisy) as number;
    const wide = value("FORECAST.ETS.CONFINT(13,A1:A12,B1:B12,0.99,0)", noisy) as number;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(wide).toBeGreaterThan(near);
    // One standard error is z(0.975) = 1.95996 standard errors at 95%: the next step's interval is z * RMSE.
    expect(near).toBeCloseTo(1.959963984540054 * (value("FORECAST.ETS.STAT(A1:A12,B1:B12,7,0)", noisy) as number), 9);
  });

  it("gives the eight statistics", () => {
    const noisy = rows([10, 12, 9, 13, 11, 14, 10, 15, 12, 16, 11, 17]);
    const stat = (k: number) => value(`FORECAST.ETS.STAT(A1:A12,B1:B12,${k},0)`, noisy) as number;
    for (let k = 1; k <= 8; k++) expect(Number.isFinite(stat(k))).toBe(true);
    expect(stat(1)).toBeGreaterThanOrEqual(0);
    expect(stat(1)).toBeLessThanOrEqual(1);
    expect(stat(3)).toBe(0); // no seasonality: no gamma
    expect(stat(7)).toBeGreaterThanOrEqual(stat(6)); // RMSE is never below MAE
    expect(stat(8)).toBe(1);
    expect(value("FORECAST.ETS.STAT(A1:A12,B1:B12,8)", rows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v) => v * v), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]))).toBe(10);
  });

  it("works with dates: months, quarters, years and days", () => {
    const serial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    const ys = [10, 12, 14, 16, 18, 20, 22, 24];
    const monthly = rows(ys, ys.map((_, i) => serial(2023, 1 + i, 1)));
    expect(value(`FORECAST.ETS(${serial(2023, 10, 1)},A1:A8,B1:B8,0)`, monthly) as number).toBeCloseTo(28, 9);
    expect(value("FORECAST.ETS.STAT(A1:A8,B1:B8,8)", monthly)).toBe(31); // one month, as the days most months have (Excel shows 31 for the 1st of each month)
    const quarterly = rows(ys, ys.map((_, i) => serial(2020 + Math.floor((i * 3) / 12), 1 + ((i * 3) % 12), 1)));
    expect(value(`FORECAST.ETS(${serial(2022, 4, 1)},A1:A8,B1:B8,0)`, quarterly) as number).toBeCloseTo(28, 9);
    expect(value("FORECAST.ETS.STAT(A1:A8,B1:B8,8)", quarterly)).toBe(92); // three months: the commonest gap in days
    const yearly = rows(ys, ys.map((_, i) => serial(2010 + i, 6, 15)));
    expect(value(`FORECAST.ETS(${serial(2019, 6, 15)},A1:A8,B1:B8,0)`, yearly) as number).toBeCloseTo(28, 9);
    const monthEnds = rows(ys, ys.map((_, i) => serial(2023, 2 + i, 0)));
    expect(value(`FORECAST.ETS(${serial(2023, 11, 0)},A1:A8,B1:B8,0)`, monthEnds) as number).toBeCloseTo(28, 9);
    const daily = rows(ys, ys.map((_, i) => 45000 + i));
    expect(value("FORECAST.ETS(45010,A1:A8,B1:B8,0)", daily) as number).toBeCloseTo(30, 9);
  });

  it("fills gaps by interpolating (or with zeros), and combines repeated times", () => {
    // A line with the points at 3 and 6 missing.
    const gaps = rows([1, 2, 4, 5, 7, 8, 9], [1, 2, 4, 5, 7, 8, 9]);
    expect(value("FORECAST.ETS(10,A1:A7,B1:B7,0)", gaps) as number).toBeCloseTo(10, 9);
    expect(value("FORECAST.ETS(10,A1:A7,B1:B7,0,1)", gaps) as number).toBeCloseTo(10, 9);
    expect(value("FORECAST.ETS(10,A1:A7,B1:B7,0,0)", gaps) as number).not.toBeCloseTo(10, 1);
    // Times that repeat: 1 AVERAGE, 2 COUNT, 3 COUNTA, 4 MAX, 5 MEDIAN, 6 MIN, 7 SUM.
    const dup = rows([1, 3, 3, 3, 5, 7, 9, 11], [1, 2, 2, 2, 3, 4, 5, 6]);
    const at = (a: number) => value(`FORECAST.ETS.STAT(A1:A8,B1:B8,7,0,1,${a})`, dup) as number;
    for (let a = 1; a <= 7; a++) expect(Number.isFinite(at(a))).toBe(true);
    expect(value("FORECAST.ETS(7,A1:A8,B1:B8,0,1,1)", dup) as number).toBeCloseTo(13, 9); // the three 3s are 3 (average): a line 1,3,5,7,9,11
    expect(at(7)).not.toBeCloseTo(at(1), 3); // their sum is 9, and the average 3
    // The order of the points does not matter.
    const mixed = rows([9, 3, 7, 1, 5], [5, 2, 4, 1, 3]);
    expect(value("FORECAST.ETS(6,A1:A5,B1:B5,0)", mixed) as number).toBeCloseTo(11, 9);
  });

  it("is an error for bad arguments, as Excel documents", () => {
    expect(value("FORECAST.ETS(9,A1:A8,B1:B7)", LINE)).toEqual(err("#N/A")); // different lengths
    expect(value("FORECAST.ETS(0,A1:A8,B1:B8)", LINE)).toEqual(err("#NUM!")); // before the start
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8,-1)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8,9000)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8,1,2)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8,1,1,8)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS(9,A1:A8,B1:B8,8)", LINE)).toEqual(err("#NUM!")); // a pattern of 8 in 8 points
    expect(value("FORECAST.ETS.CONFINT(9,A1:A8,B1:B8,1)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS.CONFINT(9,A1:A8,B1:B8,0)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS.STAT(A1:A8,B1:B8,0)", LINE)).toEqual(err("#NUM!"));
    expect(value("FORECAST.ETS.STAT(A1:A8,B1:B8,9)", LINE)).toEqual(err("#NUM!"));
    // The steps are not whole multiples of the smallest, and no months either.
    expect(value("FORECAST.ETS(9,A1:A4,B1:B4)", rows([1, 2, 3, 4], [1, 2, 3.5, 5]))).toEqual(err("#NUM!"));
    // Text in the values, a single point, errors passed on.
    expect(value("FORECAST.ETS(9,A1:A4,B1:B4)", { ...rows([1, 2, 3, 4]), A2: "x" })).toEqual(err("#VALUE!"));
    expect(value("FORECAST.ETS(3,A1:A1,B1:B1)", rows([1]))).toEqual(err("#VALUE!"));
    const s = new SheetSession(createWorkbook("e"));
    s.setCells("Sheet1", LINE);
    s.setCell("Sheet1", "A3", "=1/0");
    s.setCell("Sheet1", "D1", "=FORECAST.ETS(9,A1:A8,B1:B8)");
    expect(s.value("Sheet1", "D1")).toEqual(err("#DIV/0!"));
  });

  it("is written to XLSX with the _xlfn. prefix and read back", () => {
    const s = new SheetSession(createWorkbook("x"));
    s.setCells("Sheet1", LINE);
    s.setCell("Sheet1", "D1", "=FORECAST.ETS(9,A1:A8,B1:B8)");
    s.setCell("Sheet1", "D2", "=FORECAST.ETS.STAT(A1:A8,B1:B8,8)");
    const bytes = toXlsx(s.state);
    const xml = new TextDecoder().decode(require("fflate").unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
    expect(xml).toContain("_xlfn.FORECAST.ETS(9,A1:A8,B1:B8)");
    expect(xml).toContain("_xlfn.FORECAST.ETS.STAT(A1:A8,B1:B8,8)");
    const back = new SheetSession(fromXlsx(bytes).workbook);
    expect(back.cell("Sheet1", "D1")?.f).toBe("FORECAST.ETS(9,A1:A8,B1:B8)");
    expect(back.value("Sheet1", "D1") as number).toBeCloseTo(19, 9);
  });
});

describe("FORECAST.ETS on the excel-check sample (file 42), against what Excel computed", () => {
  // Excel's answers for this series (excel-check/back/42-functions-rest.xlsx): a pattern of 4 with noise, steps 1..20, and the 1st of each month.
  const Y = [11.2, 14.9, 8.7, 12.6, 13.4, 15.1, 11.9, 13.2, 15.8, 18.4, 12.1, 16.5, 16.2, 20.7, 14.9, 17.1, 19.6, 21.3, 17.8, 20.2];
  const MONTHS = [44562, 44593, 44621, 44652, 44682, 44713, 44743, 44774, 44805, 44835, 44866, 44896, 44927, 44958, 44986, 45017, 45047, 45078, 45108, 45139];
  const cells: Record<string, number> = {};
  Y.forEach((y, i) => ((cells[`B${i + 1}`] = y), (cells[`A${i + 1}`] = i + 1), (cells[`C${i + 1}`] = MONTHS[i]!)));
  const f = (formula: string) => value(formula, cells) as number;
  // Excel's search for the smoothing constants and starting states is not published, so its numbers are close to Pli's, not equal.
  const EXCEL = { f21: 21.046083123864435, f24: 21.979444414265608, f24Linear: 21.779175046778757, dateTarget: 22.998075280690902, conf95: 1.3982601582164429, conf80: 0.9142731748825681, mase: 0.19937722586566178, smape: 0.03624033203352401, mae: 0.66519492629725341, rmse: 0.74732368922552062 };

  it("finds the pattern of 4 and the steps, exactly as Excel does", () => {
    expect(f("FORECAST.ETS.SEASONALITY(B1:B20,A1:A20)")).toBe(4);
    expect(f("FORECAST.ETS.STAT(B1:B20,A1:A20,8)")).toBe(1);
    expect(f("FORECAST.ETS.STAT(B1:B20,C1:C20,8)")).toBe(31); // the 1st of each month: 31 days, the gap most months have
    expect(f("FORECAST.ETS.SEASONALITY(B1:B20,C1:C20)")).toBe(4);
  });

  it("gives forecasts, intervals and statistics near Excel's (within 0.2, or 0.05 for the unit-free ones)", () => {
    const near = (got: number, want: number, tol = 0.2) => expect(Math.abs(got - want)).toBeLessThan(tol);
    near(f("FORECAST.ETS(21,B1:B20,A1:A20)"), EXCEL.f21);
    near(f("FORECAST.ETS(24,B1:B20,A1:A20)"), EXCEL.f24);
    near(f("FORECAST.ETS(24,B1:B20,A1:A20,0)"), EXCEL.f24Linear, 0.05);
    near(f("FORECAST.ETS(45292,B1:B20,C1:C20)"), EXCEL.dateTarget);
    near(f("FORECAST.ETS.CONFINT(21,B1:B20,A1:A20)"), EXCEL.conf95, 0.2);
    near(f("FORECAST.ETS.CONFINT(21,B1:B20,A1:A20,0.8)"), EXCEL.conf80, 0.2);
    near(f("FORECAST.ETS.STAT(B1:B20,A1:A20,4)"), EXCEL.mase, 0.05);
    near(f("FORECAST.ETS.STAT(B1:B20,A1:A20,5)"), EXCEL.smape, 0.01);
    near(f("FORECAST.ETS.STAT(B1:B20,A1:A20,6)"), EXCEL.mae, 0.1);
    near(f("FORECAST.ETS.STAT(B1:B20,A1:A20,7)"), EXCEL.rmse, 0.1);
  });

  it("reports the smoothing constants in steps of 0.001, none of them 0", () => {
    for (const k of [1, 2, 3]) {
      const v = f(`FORECAST.ETS.STAT(B1:B20,A1:A20,${k})`);
      expect(v).toBeGreaterThanOrEqual(0.001);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v * 1000 - Math.round(v * 1000))).toBeLessThan(1e-9);
    }
  });
});
