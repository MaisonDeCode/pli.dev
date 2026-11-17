import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, functionCatalog, functionInfo, functionNames, isError, parseFormula } from "../src";
import { getFunction } from "../src/functions";

describe("the function catalog", () => {
  it("describes every function there is, and only those", () => {
    expect(functionCatalog().map((f) => f.name)).toEqual(functionNames());
  });

  it("has a summary, an example that uses the function, and arguments that match what it accepts", () => {
    const problems: string[] = [];
    for (const f of functionCatalog()) {
      const def = getFunction(f.name)!;
      if (f.summary.length < 8) problems.push(`${f.name}: no summary`);
      if (!f.example.startsWith("=") || !f.example.toUpperCase().includes(f.name + "(") && !f.example.toUpperCase().includes(f.name)) problems.push(`${f.name}: example doesn't use it (${f.example})`);
      if (!f.result) problems.push(`${f.name}: no result`);
      const required = f.params.filter((p) => !p.optional).length;
      const variadic = f.params.some((p) => p.repeats) || f.params.some((p) => /…/.test(p.name));
      const max = variadic ? Infinity : f.params.length;
      // A repeated pair such as "[criteria_range2, criteria2]…" stands for two arguments.
      const pairs = f.params.filter((p) => p.repeats && p.name.includes(",")).length;
      if (required !== def.min && !(pairs && required <= def.min)) problems.push(`${f.name}: ${required} required arguments but the function needs ${def.min}`);
      if (!variadic && max !== def.max) problems.push(`${f.name}: ${max} arguments but the function takes up to ${def.max}`);
      if (variadic && def.max < 20) problems.push(`${f.name}: documented as repeating but takes at most ${def.max}`);
      if (f.params.some((p) => p.description.length < 3)) problems.push(`${f.name}: an argument has no description`);
      if (f.volatile !== !!def.volatile) problems.push(`${f.name}: volatile flag`);
    }
    expect(problems).toEqual([]);
  });

  it("writes the syntax", () => {
    expect(functionInfo("sum")!.syntax).toBe("SUM(number1, [number2], …)");
    expect(functionInfo("IF")!.syntax).toBe("IF(logical_test, value_if_true, [value_if_false])");
    expect(functionInfo("_xlfn.XLOOKUP")!.name).toBe("XLOOKUP");
    expect(functionInfo("NOW")!.syntax).toBe("NOW()");
    expect(functionInfo("NOW")!.volatile).toBe(true);
    expect(functionInfo("NOPE")).toBeUndefined();
  });

  it("has examples that read, and that none of them is an unknown function or a bad reference", () => {
    const s = new SheetSession(createWorkbook(), { now: () => 45000.5, random: () => 0.5 });
    // Numbers and dates where the examples look, so they have something to work on.
    const cells: Record<string, number | string> = {};
    for (let r = 1; r <= 9; r++) for (const c of "ABCDEF") cells[`${c}${r}`] = c === "A" ? r * 10 : r;
    cells["D1"] = "Q2";
    s.setCells("Sheet1", cells);
    const bad: string[] = [];
    for (const f of functionCatalog()) {
      expect(() => parseFormula(f.example.slice(1)), f.example).not.toThrow();
      s.setCell("Sheet1", "H1", f.example);
      const v = s.value("Sheet1", "H1");
      if (isError(v) && (v.error === "#NAME?" || v.error === "#REF!") && f.name !== "INDIRECT" && f.name !== "ISREF" && f.name !== "GETPIVOTDATA") bad.push(`${f.example} → ${v.error}`);
    }
    expect(bad).toEqual([]);
  });
});
