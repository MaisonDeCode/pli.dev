import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";
import { SOFFICE, inLibreOffice, makeDir, removeDir } from "./libreoffice-formulas";

/**
 * The complex-number functions against LibreOffice, part by part. LibreOffice does not have `IMTAN`, `IMSEC`, `IMCSC`,
 * `IMCOT`, `IMSINH`, `IMCOSH`, `IMSECH` and `IMCSCH`, so those are compared with the same thing built from the functions
 * it has (`IMSEC(z)` is `IMDIV(1, IMCOS(z))`, `IMSINH(z)` is `IMPRODUCT(-i, IMSIN(IMPRODUCT(i, z)))`…). Runs only where
 * LibreOffice is installed.
 */
const dir = makeDir("complex");
afterAll(() => removeDir(dir));

const INPUTS = ['"3+4i"', '"1-2i"', '"-0.5+0.25i"', '"2"', '"i"', '"-i"', '"0"', '"4j"', '"-3-4j"', '"1E-3+2i"', "5", '"0.7i"', '"10+0.0001i"', '"1+i"', '"-2.5"', '"0.3-0.9i"'];
const DIRECT = ["IMEXP", "IMLN", "IMLOG10", "IMLOG2", "IMSQRT", "IMSIN", "IMCOS"];
/** Functions LibreOffice lacks, and what they are in terms of the ones it has. */
const BUILT: Record<string, (z: string) => string> = {
  IMTAN: (z) => `IMDIV(IMSIN(${z}),IMCOS(${z}))`,
  IMSEC: (z) => `IMDIV(1,IMCOS(${z}))`,
  IMCSC: (z) => `IMDIV(1,IMSIN(${z}))`,
  IMCOT: (z) => `IMDIV(IMCOS(${z}),IMSIN(${z}))`,
  IMSINH: (z) => `IMPRODUCT("-i",IMSIN(IMPRODUCT("i",${z})))`,
  IMCOSH: (z) => `IMCOS(IMPRODUCT("i",${z}))`,
  IMSECH: (z) => `IMDIV(1,IMCOS(IMPRODUCT("i",${z})))`,
  IMCSCH: (z) => `IMDIV("i",IMSIN(IMPRODUCT("i",${z})))`,
};

const parts = (t: string): [number, number] | null => {
  const pure = /^([+-]?(?:[\d.]+(?:[eE][+-]?\d+)?)?)[ij]$/.exec(t);
  if (pure) return [0, pure[1] === "" || pure[1] === "+" ? 1 : pure[1] === "-" ? -1 : Number(pure[1])];
  const m = /^([+-]?[\d.]+(?:[eE][+-]?\d+)?)?(?:([+-]?(?:[\d.]+(?:[eE][+-]?\d+)?)?)([ij]))?$/.exec(t.replace(/\s/g, ""));
  if (!m || (m[1] === undefined && m[3] === undefined)) return null;
  const im = m[3] === undefined ? 0 : m[2] === "" || m[2] === "+" ? 1 : m[2] === "-" ? -1 : Number(m[2]);
  return [m[1] === undefined ? 0 : Number(m[1]), im];
};

describe.skipIf(!SOFFICE)("complex functions against LibreOffice", () => {
  it("agrees on every function for many numbers, and on IMPOWER for many powers", () => {
    const mine: string[] = [];
    const theirs: string[] = [];
    for (const f of DIRECT) for (const z of INPUTS) (mine.push(`${f}(${z})`), theirs.push(`${f}(${z})`));
    for (const [f, build] of Object.entries(BUILT)) for (const z of INPUTS) (mine.push(`${f}(${z})`), theirs.push(build(z)));
    for (const z of INPUTS) for (const n of ["2", "0.5", "-1", "0", "3", "1.5", "-0.5", "10"]) (mine.push(`IMPOWER(${z},${n})`), theirs.push(`IMPOWER(${z},${n})`));
    for (const f of ["IMPOWER(0,0)", 'IMPOWER("0",-1)', 'IMPOWER("0",2)', 'IMSIN("abc")', 'IMLN("0")', 'IMCSC("0")', 'IMCOT("0")', "IMLOG2(0)"]) (mine.push(f), theirs.push(f));
    const lo = inLibreOffice(dir, theirs);
    const s = new SheetSession(createWorkbook("p"));
    mine.forEach((f, i) => s.setCell("Sheet1", `A${i + 1}`, "=" + f));
    const bad: string[] = [];
    mine.forEach((f, i) => {
      const v = s.value("Sheet1", `A${i + 1}`);
      const l = lo[i]!;
      let ok: boolean;
      if (typeof v === "object" && v !== null) ok = /^(#|Err)/.test(l);
      else {
        const a = parts(String(v));
        const b = parts(l);
        // Both give a number, to nine digits of the larger part (a part that is nearly 0 may differ in the last digits).
        const scale = a && b ? Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs)) : 1;
        ok = !!a && !!b && a.every((x, k) => Math.abs(x - b[k]!) <= 1e-9 * scale);
      }
      if (!ok) bad.push(`${f}: Pli ${JSON.stringify(v)}, LibreOffice ${l}`);
    });
    expect(bad).toEqual([]);
  }, 300_000);
});
