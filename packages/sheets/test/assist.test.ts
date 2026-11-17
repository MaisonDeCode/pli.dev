import { describe, expect, it } from "vitest";
import { acceptSuggestion, assistFormula, currentParam, functionInfo, syntaxParts } from "../src";

const at = (text: string, caret = text.length, names: string[] = []) => assistFormula(text, caret, names);
const names = (text: string, caret?: number, defined: string[] = []) => at(text, caret, defined).completing?.items.map((i) => i.name);

describe("completing a function name", () => {
  it("offers popular functions after a bare =, and nothing for other text", () => {
    expect(names("=")).toEqual(["SUM", "AVERAGE", "IF", "COUNT", "MAX", "MIN", "VLOOKUP", "XLOOKUP", "SUMIF", "COUNTIF"]);
    expect(at("hello").completing).toBeUndefined();
    expect(at("").completing).toBeUndefined();
  });

  it("matches what is typed, names that start with it first", () => {
    expect(names("=su")?.slice(0, 5)).toEqual(["SUBSTITUTE", "SUBTOTAL", "SUM", "SUMIF", "SUMIFS"]);
    expect(names("=vlo")).toEqual(["VLOOKUP"]);
    expect(names("=Count")?.slice(0, 5)).toEqual(["COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS"]);
    expect(names("=xyzzy")).toBeUndefined();
    // Names that merely contain it follow, for two letters or more.
    expect(names("=IFE")).toEqual(["IFERROR"]);
    expect(names("=ound")).toEqual(["MROUND", "ROUND", "ROUNDDOWN", "ROUNDUP"]); // nothing starts with it: names that contain it
    expect(names("=roun")).toEqual(["ROUND", "ROUNDDOWN", "ROUNDUP", "MROUND"]); // starts with it first, then contains
  });

  it("works in the middle of a formula, after operators and inside calls, and for the word at the caret", () => {
    expect(names("=A1+su")).toEqual(expect.arrayContaining(["SUM"]));
    expect(names("=IF(A1>1,ro")?.slice(0, 6)).toEqual(["ROMAN", "ROUND", "ROUNDDOWN", "ROUNDUP", "ROW", "ROWS"]);
    const t = "=SU+5";
    const a = at(t, 3);
    expect(a.completing?.query).toBe("SU");
    expect([a.completing?.start, a.completing?.end]).toEqual([1, 3]);
  });

  it("stays quiet for references, text in quotes, sheet names and numbers", () => {
    expect(at("=A1").completing).toBeUndefined();
    expect(at("=$B$12").completing).toBeUndefined();
    expect(at('=CONCAT("su').completing).toBeUndefined();
    expect(at("=Sheet2!A").completing).toBeUndefined();
    expect(at("=A:B").completing).toBeUndefined();
    expect(at("=1e5").completing).toBeUndefined();
    expect(at("=SUM(A1:A3)").completing).toBeUndefined();
  });

  it("includes defined names", () => {
    expect(names("=ta", undefined, ["TaxRate", "Total"])?.slice(0, 4)).toEqual(["TAKE", "TAN", "TANH", "TaxRate"]); // a name sits after the functions that start the same way
    expect(at("=ta", 3, ["TaxRate"]).completing?.items.find((i) => i.kind === "name")).toEqual({ kind: "name", name: "TaxRate" });
  });

  it("accepting puts the name and a bracket in, once", () => {
    const a = at("=1+su", 5);
    const pick = a.completing!.items.find((i) => i.name === "SUM")!;
    expect(acceptSuggestion("=1+su", a.completing!, pick)).toEqual({ text: "=1+SUM(", caret: 7 });
    const mid = at("=su(A1)", 3);
    expect(mid.completing?.hasParen).toBe(true);
    expect(acceptSuggestion("=su(A1)", mid.completing!, mid.completing!.items.find((i) => i.name === "SUM")!)).toEqual({ text: "=SUM(A1)", caret: 5 }); // inside the bracket that was already there
    const n = at("=ta", 3, ["TaxRate"]);
    expect(acceptSuggestion("=ta", n.completing!, n.completing!.items.find((i) => i.kind === "name")!)).toEqual({ text: "=TaxRate", caret: 8 });
  });
});

describe("the function being called", () => {
  const arg = (text: string) => {
    const call = at(text).call;
    return call && [call.info.name, call.argIndex];
  };

  it("finds the call and the argument the caret is in", () => {
    expect(arg("=SUM(")).toEqual(["SUM", 0]);
    expect(arg("=SUM(A1,")).toEqual(["SUM", 1]);
    expect(arg("=IF(A1>1,\"a,b\",")).toEqual(["IF", 2]);
    expect(arg("=IF(SUM(A1,B1),")).toEqual(["IF", 1]);
    expect(arg("=IF(SUM(A1,")).toEqual(["SUM", 1]);
    expect(arg("=SUM(A1)+")).toBeUndefined();
    expect(arg("=SUM((1+2),")).toEqual(["SUM", 1]); // a grouping bracket belongs to the call around it
    expect(arg("=SUM((1+")).toEqual(["SUM", 0]);
    expect(arg("=SUM({1,2,3},")).toEqual(["SUM", 1]); // commas in an array constant aren't arguments
    expect(arg("=NOSUCH(1,")).toBeUndefined();
  });

  it("knows which argument is current, repeating the last one", () => {
    const sum = functionInfo("SUM")!;
    expect(currentParam(sum, 0)).toBe(0);
    expect(currentParam(sum, 1)).toBe(1);
    expect(currentParam(sum, 7)).toBe(1);
    const ifs = functionInfo("IF")!;
    expect(currentParam(ifs, 2)).toBe(2);
    expect(currentParam(ifs, 3)).toBeUndefined();
    expect(currentParam(functionInfo("NOW")!, 0)).toBeUndefined();
    expect(syntaxParts(sum).map((p) => p.text).join("")).toBe("SUM(number1, [number2], …)");
    expect(syntaxParts(sum).filter((p) => p.param !== undefined).map((p) => p.text)).toEqual(["number1", "[number2]"]);
  });
});
