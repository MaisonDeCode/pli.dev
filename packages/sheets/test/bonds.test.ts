import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";

const d = (y: number, m: number, day: number) => `DATE(${y},${m},${day})`;
const value = (formula: string) => {
  const s = new SheetSession(createWorkbook("b"));
  s.setCell("Sheet1", "A1", "=" + formula);
  return s.value("Sheet1", "A1");
};

// The examples in Excel's help for each function.
const EXAMPLES: [string, number, number][] = [
  [`ACCRINT(${d(2008, 3, 1)},${d(2008, 8, 31)},${d(2008, 5, 1)},0.1,1000,2,0)`, 16.66667, 5],
  [`ACCRINTM(${d(2008, 4, 1)},${d(2008, 6, 15)},0.1,1000,3)`, 20.54795, 5],
  [`AMORDEGRC(2400,${d(2008, 8, 19)},${d(2008, 12, 31)},300,1,0.15,1)`, 776, 9],
  [`AMORLINC(2400,${d(2008, 8, 19)},${d(2008, 12, 31)},300,1,0.15,1)`, 360, 9],
  [`COUPDAYBS(${d(2011, 1, 25)},${d(2011, 11, 15)},2,1)`, 71, 9],
  [`COUPDAYS(${d(2011, 1, 25)},${d(2011, 11, 15)},2,1)`, 181, 9],
  [`COUPDAYSNC(${d(2011, 1, 25)},${d(2011, 11, 15)},2,1)`, 110, 9],
  [`COUPNCD(${d(2011, 1, 25)},${d(2011, 11, 15)},2,1)`, 40678, 9],
  [`COUPNUM(${d(2007, 1, 25)},${d(2008, 11, 15)},2,1)`, 4, 9],
  [`COUPPCD(${d(2011, 1, 25)},${d(2011, 11, 15)},2,1)`, 40497, 9],
  [`DISC(${d(2007, 1, 25)},${d(2007, 6, 15)},97.975,100,1)`, 0.052420, 5],
  [`DURATION(${d(2008, 1, 1)},${d(2016, 1, 1)},0.08,0.09,2,1)`, 5.993775, 5],
  [`MDURATION(${d(2008, 1, 1)},${d(2016, 1, 1)},0.08,0.09,2,1)`, 5.73567, 4],
  [`INTRATE(${d(2008, 2, 15)},${d(2008, 5, 15)},1000000,1014420,2)`, 0.05768, 5],
  [`ODDFPRICE(${d(2008, 11, 11)},${d(2021, 3, 1)},${d(2008, 10, 15)},${d(2009, 3, 1)},0.0785,0.0625,100,2,1)`, 113.597717, 5],
  [`ODDFYIELD(${d(2008, 11, 11)},${d(2021, 3, 1)},${d(2008, 10, 15)},${d(2009, 3, 1)},0.0575,84.5,100,2,0)`, 0.0772455, 6],
  [`ODDLPRICE(${d(2008, 2, 7)},${d(2008, 6, 15)},${d(2007, 10, 15)},0.0375,0.0405,100,2,0)`, 99.87829, 4],
  [`ODDLYIELD(${d(2008, 4, 20)},${d(2008, 6, 15)},${d(2007, 12, 24)},0.0375,99.875,100,2,0)`, 0.045192, 5],
  [`PRICE(${d(2008, 2, 15)},${d(2017, 11, 15)},0.0575,0.065,100,2,0)`, 94.63436, 4],
  [`PRICEDISC(${d(2008, 2, 16)},${d(2008, 3, 1)},0.0525,100,2)`, 99.79583, 4],
  [`PRICEMAT(${d(2008, 2, 15)},${d(2008, 4, 13)},${d(2007, 11, 11)},0.061,0.061,0)`, 99.98449888, 6],
  [`RECEIVED(${d(2008, 2, 15)},${d(2008, 5, 15)},1000000,0.0575,2)`, 1014584.654, 2],
  [`TBILLEQ(${d(2008, 3, 31)},${d(2008, 6, 1)},0.0914)`, 0.094151, 5],
  [`TBILLPRICE(${d(2008, 3, 31)},${d(2008, 6, 1)},0.09)`, 98.45, 5],
  [`TBILLYIELD(${d(2008, 3, 31)},${d(2008, 6, 1)},98.45)`, 0.0914, 4],
  [`YIELD(${d(2008, 2, 15)},${d(2016, 11, 15)},0.0575,95.04287,100,2,0)`, 0.065, 6],
  [`YIELDDISC(${d(2008, 2, 16)},${d(2008, 3, 1)},99.795,100,2)`, 0.052823, 5],
  [`YIELDMAT(${d(2008, 3, 15)},${d(2008, 11, 3)},${d(2007, 11, 8)},0.0625,100.0123,0)`, 0.060954, 5],
  ["VDB(2400,300,10*365,0,1)", 1.31506849, 6],
  ["VDB(2400,300,10*12,0,1)", 40, 9],
  ["VDB(2400,300,10,0,1)", 480, 9],
  ["VDB(2400,300,10*12,6,18)", 396.306, 3],
  ["VDB(2400,300,10*12,6,18,1.5)", 311.809, 3],
  ["VDB(2400,300,10,0,0.875,1.5)", 315, 9],
];

describe("bond and security functions", () => {
  it.each(EXAMPLES)("%s is %d", (formula, want, digits) => {
    expect(value(formula) as number).toBeCloseTo(want, digits);
  });

  it("gives #NUM! for dates out of order, a bad frequency or basis, and the sign errors Excel names", () => {
    const bad = [
      `PRICE(${d(2010, 1, 1)},${d(2009, 1, 1)},0.05,0.05,100,2)`,
      `PRICE(${d(2008, 1, 1)},${d(2010, 1, 1)},0.05,0.05,100,3)`,
      `PRICE(${d(2008, 1, 1)},${d(2010, 1, 1)},0.05,0.05,100,2,5)`,
      `PRICE(${d(2008, 1, 1)},${d(2010, 1, 1)},-0.05,0.05,100,2)`,
      `PRICE(${d(2008, 1, 1)},${d(2010, 1, 1)},0.05,-0.05,100,2)`,
      `PRICE(${d(2008, 1, 1)},${d(2010, 1, 1)},0.05,0.05,0,2)`,
      `YIELD(${d(2008, 1, 1)},${d(2010, 1, 1)},0.05,0,100,2)`,
      `COUPNUM(${d(2008, 1, 1)},${d(2008, 1, 1)},2)`,
      `DISC(${d(2008, 1, 1)},${d(2008, 6, 1)},0,100)`,
      `TBILLPRICE(${d(2008, 1, 1)},${d(2009, 1, 2)},0.05)`,
      `TBILLYIELD(${d(2008, 1, 1)},${d(2008, 1, 1)},98)`,
      `ACCRINT(${d(2008, 3, 1)},${d(2008, 8, 31)},${d(2008, 2, 1)},0.1,1000,2)`,
      `ODDFPRICE(${d(2008, 11, 11)},${d(2021, 3, 1)},${d(2008, 12, 15)},${d(2009, 3, 1)},0.0785,0.0625,100,2,1)`,
      `ODDLPRICE(${d(2008, 2, 7)},${d(2008, 6, 15)},${d(2008, 3, 15)},0.0375,0.0405,100,2,0)`,
      "VDB(2400,300,10,5,3)",
      "VDB(2400,300,10,0,11)",
      "VDB(-1,300,10,0,1)",
    ];
    for (const f of bad) expect(value(f), f).toEqual({ error: "#NUM!" });
    expect(value('PRICE("x",1,1,1,1,1)')).toEqual({ error: "#VALUE!" });
  });

  it("uses the last day of the month for every coupon date when the maturity is on one", () => {
    // Maturity 28 Feb 2010 (a month end): coupons on 31 Aug and 28 Feb; with 28 Feb 2012 (not a month end in a leap year) on 28 Aug.
    expect(value(`COUPPCD(${d(2009, 11, 1)},${d(2010, 2, 28)},2,0)`)).toBe(value(d(2009, 8, 31)));
    expect(value(`COUPPCD(${d(2011, 11, 1)},${d(2012, 2, 28)},2,0)`)).toBe(value(d(2011, 8, 28)));
    expect(value(`COUPNCD(${d(2011, 3, 1)},${d(2012, 8, 31)},4,0)`)).toBe(value(d(2011, 5, 31)));
  });

  it("puts a settlement on a coupon date at the start of its period", () => {
    expect(value(`COUPPCD(${d(2011, 5, 15)},${d(2011, 11, 15)},2,1)`)).toBe(value(d(2011, 5, 15)));
    expect(value(`COUPDAYBS(${d(2011, 5, 15)},${d(2011, 11, 15)},2,1)`)).toBe(0);
  });

  it("takes the yield back to the price", () => {
    for (const basis of [0, 1, 2, 3, 4]) {
      const price = value(`PRICE(${d(2008, 2, 15)},${d(2017, 11, 15)},0.0575,0.0712,100,2,${basis})`) as number;
      expect(value(`YIELD(${d(2008, 2, 15)},${d(2017, 11, 15)},0.0575,${price},100,2,${basis})`) as number).toBeCloseTo(0.0712, 10);
      const odd = value(`ODDFPRICE(${d(2008, 11, 11)},${d(2021, 3, 1)},${d(2008, 10, 15)},${d(2009, 3, 1)},0.0785,0.0625,100,2,${basis})`) as number;
      expect(value(`ODDFYIELD(${d(2008, 11, 11)},${d(2021, 3, 1)},${d(2008, 10, 15)},${d(2009, 3, 1)},0.0785,${odd},100,2,${basis})`) as number).toBeCloseTo(0.0625, 10);
      const last = value(`ODDLPRICE(${d(2008, 2, 7)},${d(2008, 6, 15)},${d(2007, 10, 15)},0.0375,0.0405,100,2,${basis})`) as number;
      expect(value(`ODDLYIELD(${d(2008, 2, 7)},${d(2008, 6, 15)},${d(2007, 10, 15)},0.0375,${last},100,2,${basis})`) as number).toBeCloseTo(0.0405, 10);
    }
  });

  it("keeps the treasury bill yield continuous across half a year", () => {
    const at = (days: number) => value(`TBILLEQ(${d(2009, 1, 1)},${d(2009, 1, 1)}+${days},0.0914)`) as number;
    expect(Math.abs(at(183) - at(182))).toBeLessThan(0.0005);
    expect(Math.abs(at(184) - at(183))).toBeLessThan(0.0005);
    const leapHalf = value(`TBILLEQ(${d(2008, 3, 31)},${d(2008, 9, 30)},0.0914)`) as number; // 183 days in a 366-day year
    expect(leapHalf).toBeGreaterThan(0.097);
    expect(leapHalf).toBeLessThan(0.0975);
  });

  it("accrues interest from the first interest date when asked, and defaults par to 1000", () => {
    expect(value(`ACCRINT(${d(2008, 3, 1)},${d(2008, 8, 31)},${d(2008, 5, 1)},0.1,,2,0)`)).toBeCloseTo(16.666667, 5);
    // From 31 Aug to 30 Nov at 10% on 1000: 3 months, half-yearly coupons of 50, 90 of 180 days.
    expect(value(`ACCRINT(${d(2008, 3, 1)},${d(2008, 8, 31)},${d(2008, 11, 30)},0.1,1000,2,0,FALSE)`)).toBeCloseTo(25, 6);
    expect(value(`ACCRINT(${d(2008, 3, 1)},${d(2008, 8, 31)},${d(2008, 11, 30)},0.1,1000,2,0,TRUE)`)).toBeCloseTo(((1000 * 0.1) / 2) * (180 / 180) + 25, 6);
  });
});
