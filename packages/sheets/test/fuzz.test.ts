import { describe, expect, it } from "vitest";
import { Calculator, SheetSession, cellAddress, createWorkbook, isError, type Value } from "../src";

/** A small deterministic random generator, so a failure can be reproduced from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const norm = (v: Value) => (isError(v) ? v.error : v);

/** A formula for column C (reads A and B) or D (reads A, B and C), so there are no circular references to make the answer depend on order. */
function formula(r: () => number, col: number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const cols = col === 3 ? ["A", "B"] : ["A", "B", "C"];
  const cell = () => `${pick(cols)}${1 + Math.floor(r() * 12)}`;
  const range = () => `${pick(cols)}${1 + Math.floor(r() * 12)}:${pick(cols)}${1 + Math.floor(r() * 12)}`;
  const sheet = () => (r() < 0.2 ? "Other!" : "");
  const sheetCell = () => `${sheet()}${cell()}`;
  const whole = col === 3 ? "A:B" : "A:C";
  switch (Math.floor(r() * 9)) {
    case 0: return `${cell()}+${sheetCell()}`;
    case 1: return `SUM(${sheet()}${range()})`;
    case 2: return `IF(${cell()}>5,${cell()},${sheetCell()})`;
    case 3: return `COUNT(${range()})+MAX(${range()})`;
    case 4: return `INDEX(${range()},1,1)`;
    case 5: return `SUM(${sheet()}${pick(cols)}:${pick(cols)})`;
    case 6: return `VLOOKUP(${cell()},${whole.replace(":", "1:") + "12"},2,FALSE)`;
    case 7: return `INDIRECT("${pick(cols)}"&${cell()})`;
    default: return `${cell()}*2-${sheetCell()}`;
  }
}

describe("incremental recalculation agrees with starting over", () => {
  for (const seed of Array.from({ length: 60 }, (_, i) => i + 1)) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const s = new SheetSession(createWorkbook("fuzz", ["Main", "Other"]));
      const names = ["Main", "Other"];
      const fill = () => {
        for (const n of names) {
          const batch: Record<string, string | number> = {};
          for (let i = 0; i < 25; i++) {
            const col = 1 + Math.floor(r() * 4);
            const addr = cellAddress(1 + Math.floor(r() * 14), col);
            batch[addr] = col <= 2 || r() < 0.3 ? Math.floor(r() * 10) : "=" + formula(r, col);
          }
          s.setCells(n, batch);
        }
      };
      fill();
      const check = (step: string) => {
        const fresh = new Calculator(s.state, { now: () => 1, random: () => 0.5 });
        for (const sheet of s.state.sheets)
          for (const address of Object.keys(sheet.cells)) {
            expect(norm(s.value(sheet.name, address)), `${step} ${sheet.name}!${address} =${sheet.cells[address]!.f}`).toEqual(norm(fresh.value(sheet.id, address)));
          }
      };
      check("initial");
      for (let step = 0; step < 60; step++) {
        const roll = r();
        const sheet = names[Math.floor(r() * 2)]!;
        const col = 1 + Math.floor(r() * 4);
        const addr = cellAddress(1 + Math.floor(r() * 14), col);
        let what: string;
        if (roll < 0.4) { s.setCell(sheet, addr, Math.floor(r() * 10)); what = `set ${sheet}!${addr}`; }
        else if (roll < 0.65) { s.setCell(sheet, addr, col <= 2 ? Math.floor(r() * 10) : "=" + formula(r, col)); what = `formula ${sheet}!${addr}`; }
        else if (roll < 0.72) { s.setCell(sheet, addr, null); what = `clear ${sheet}!${addr}`; }
        else if (roll < 0.8) { s.insertRows(sheet, 1 + Math.floor(r() * 10)); what = "insert row"; }
        else if (roll < 0.86) { s.deleteRows(sheet, 1 + Math.floor(r() * 10)); what = "delete row"; }
        else if (roll < 0.87) { s.insertColumns(sheet, 1 + Math.floor(r() * 4)); what = "insert col"; }
        else if (roll < 0.9) { s.deleteColumns(sheet, 1 + Math.floor(r() * 4)); what = "delete col"; }
        else if (roll < 0.97) { s.undo(); what = "undo"; }
        else { s.redo(); what = "redo"; }
        check(`step ${step} (${what})`);
      }
    });
  }
});

describe("size", () => {
  it("handles tens of thousands of formulas", () => {
    const s = new SheetSession(createWorkbook("big"));
    const inputs: Record<string, string | number> = {};
    const N = 20000;
    for (let i = 1; i <= N; i++) {
      inputs[`A${i}`] = i;
      inputs[`B${i}`] = `=A${i}*2`;
      inputs[`C${i}`] = i === 1 ? "=B1" : `=C${i - 1}+B${i}`;
    }
    inputs["E1"] = `=SUM(B1:B${N})`;
    inputs["E2"] = `=SUMIF(A1:A${N},">10000",B1:B${N})`;
    inputs["E3"] = `=VLOOKUP(15000,A1:C${N},3,FALSE)`;
    const t0 = Date.now();
    s.setCells("Sheet1", inputs);
    expect(s.value("Sheet1", `C${N}`)).toBe(N * (N + 1));
    expect(s.value("Sheet1", "E1")).toBe(N * (N + 1));
    expect(s.value("Sheet1", "E2")).toBe(2 * ((N * (N + 1)) / 2 - (10000 * 10001) / 2));
    expect(s.value("Sheet1", "E3")).toBe(15000 * 15001);
    const full = Date.now() - t0;
    const t1 = Date.now();
    s.setCell("Sheet1", "A1", 100);
    expect(s.value("Sheet1", `C${N}`)).toBe(N * (N + 1) + 198);
    expect(s.value("Sheet1", "E1")).toBe(N * (N + 1) + 198);
    const edit = Date.now() - t1;
    console.log(`60k cells: first calculation ${full} ms, one edit ${edit} ms`);
    expect(full).toBeLessThan(10000);
  });
});
