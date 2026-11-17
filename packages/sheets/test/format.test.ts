import { describe, expect, it } from "vitest";
import { formatValue } from "../src/format";
import { dateSerial } from "../src/values";

const f = (v: number | string, fmt?: string) => formatValue(v, fmt).text;

describe("number formats", () => {
  it("General", () => {
    expect(f(1234.5)).toBe("1234.5");
    expect(f(0.1 + 0.2)).toBe("0.3");
    expect(f(1e21)).toBe("1E+21");
    expect(f("text")).toBe("text");
  });

  it("fixed decimals round half away from zero on 15 digits", () => {
    expect(f(1.005, "0.00")).toBe("1.01");
    expect(f(2.5, "0")).toBe("3");
    expect(f(-2.5, "0")).toBe("-3");
    expect(f(0.5, "#.00")).toBe(".50");
    expect(f(5, "0.00")).toBe("5.00");
    expect(f(5.1, "0.##")).toBe("5.1");
    expect(f(5, "0.##")).toBe("5.");
    expect(f(7, "000")).toBe("007");
    expect(f(0, "#")).toBe("");
  });

  it("thousands, scaling, percent, currency", () => {
    expect(f(1234567.891, "#,##0.00")).toBe("1,234,567.89");
    expect(f(999, "#,##0")).toBe("999");
    expect(f(1234567, "#,##0,")).toBe("1,235");
    expect(f(1234567, "0.0,,")).toBe("1.2");
    expect(f(0.256, "0%")).toBe("26%");
    expect(f(0.256, "0.0%")).toBe("25.6%");
    expect(f(-1234.5, '"$"#,##0.00')).toBe("-$1,234.50");
    expect(f(5, "$0.00")).toBe("$5.00");
    expect(f(12345, "000,000")).toBe("012,345");
  });

  it("sections for negative, zero and text", () => {
    expect(f(-5, "0;(0)")).toBe("(5)");
    expect(f(0, "0;-0;zero")).toBe("zero");
    expect(f("hi", '0;0;0;"text: "@')).toBe("text: hi");
    expect(formatValue(-5, "0;[Red]-0").color).toBe("Red");
    expect(f(150, "[>100]\"big\";\"small\"")).toBe("big");
    expect(f(50, "[>100]\"big\";\"small\"")).toBe("small");
  });

  it("scientific", () => {
    expect(f(12345.678, "0.00E+00")).toBe("1.23E+04");
    expect(f(0.00012, "0.0E+0")).toBe("1.2E-4");
  });

  it("dates and times", () => {
    const d = dateSerial(2024, 3, 5)!;
    expect(f(d, "yyyy-mm-dd")).toBe("2024-03-05");
    expect(f(d, "m/d/yy")).toBe("3/5/24");
    expect(f(d, "dddd, mmmm d, yyyy")).toBe("Tuesday, March 5, 2024");
    expect(f(d, "ddd d mmm")).toBe("Tue 5 Mar");
    expect(f(d + 0.5 + 15 / 1440, "h:mm AM/PM")).toBe("12:15 PM");
    expect(f(d + 0.75, "hh:mm:ss")).toBe("18:00:00");
    expect(f(1.5, "[h]:mm")).toBe("36:00");
    expect(f(d + 0.25, "yyyy-mm-dd hh:mm")).toBe("2024-03-05 06:00");
  });
});
