import { describe, expect, it } from "vitest";
import { SheetSession, isError, type Value } from "@pli.dev/sheets";
import { fillSample, sampleWorkbook } from "../src/sheets/SheetsDemo";

const session = () => {
  const s = new SheetSession(sampleWorkbook());
  fillSample(s);
  return s;
};

describe("the Lambda sheet in the sample", () => {
  const s = session();
  // Each example's live formula is in column B on the row after the one that shows its text.
  const examples = Object.entries(s.state.sheets.find((x) => x.name === "Lambda")!.cells)
    .filter(([, c]) => c.f?.startsWith("FORMULATEXT(B"))
    .map(([a, c]) => ({ shows: a, at: Number(/B(\d+)/.exec(c.f!)![1]) }))
    .sort((a, b) => a.at - b.at);
  const col = (from: number, n: number, colLetter = "B") => s.values("Lambda", `${colLetter}${from}:${colLetter}${from + n - 1}`).map((r) => r[0]);
  const num = (v: Value | undefined) => (typeof v === "number" ? Number(v.toFixed(6)) : v);

  it("has twelve examples and none of them is an error", () => {
    expect(examples).toHaveLength(12);
    for (const e of examples) {
      const v = s.value("Lambda", `B${e.at}`);
      expect(isError(v) ? v.error : "ok", `B${e.at}`).toBe("ok");
    }
  });

  it("shows each formula, so what is written is what runs", () => {
    expect(s.value("Lambda", `A${examples[0]!.at - 1}`)).toBe("=LET(price, I2, rate, 0.08, price * (1 + rate))");
    expect(s.value("Lambda", `A${examples[3]!.at - 1}`)).toBe("=MAP(I2:I7, LAMBDA(p, p * 1.08))");
  });

  it("works out what each one says it does", () => {
    const at = (i: number) => examples[i]!.at;
    expect(num(s.value("Lambda", `B${at(0)}`))).toBe(528.12);
    expect(num(s.value("Lambda", `B${at(1)}`))).toBe(884.5092);
    expect(s.value("Lambda", `B${at(2)}`)).toBe(12);
    expect(col(at(3), 6).map(num)).toEqual([528.12, 356.3892, 280.26, 85.32, 129.546, 156.6]);
    expect(col(at(4), 6).map(num)).toEqual([1956, 1979.94, 1038, 474, 959.6, 290]);
    expect(num(s.value("Lambda", `B${at(5)}`))).toBe(1422.44);
    expect(s.value("Lambda", `B${at(6)}`)).toBe("Standing desk, Monitor, Ergonomic chair, Webcam, Headset, Whiteboard");
    expect(col(at(7), 6).map(num)).toEqual([489, 818.99, 1078.49, 1157.49, 1277.44, 1422.44]);
    expect(col(at(8), 4)).toEqual([91, 70, 99, 80]);
    expect(s.values("Lambda", `B${at(9)}:D${at(9)}`)[0]!.map(num)).toEqual([70.5, 83, 81.25]);
    expect(s.values("Lambda", `B${at(10)}:F${at(10) + 4}`)).toEqual([1, 2, 3, 4, 5].map((r) => [1, 2, 3, 4, 5].map((c) => r * c)));
    expect(col(at(11), 6).map(num)).toEqual([440.1, 296.991, 233.55, 79, 107.955, 130.5]);
  });

  it("leaves room for what spills, so nothing is in the way", () => {
    for (const e of examples) expect(s.calculator.spillRange("Lambda", e.at, 2) ?? { r2: e.at }).toBeDefined();
    const blocked = s.values("Lambda", "B1:F120").flat().filter((v) => isError(v) && v.error === "#SPILL!");
    expect(blocked).toEqual([]);
  });
});
