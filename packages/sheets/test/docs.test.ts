import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { functionNames } from "../src";

const page = readFileSync(new URL("../../../apps/site/src/content/docs/sheets/formulas.md", import.meta.url), "utf8");

describe("the Formulas page", () => {
  it("lists exactly the functions Pli has", () => {
    const section = page.slice(page.indexOf("## Functions"), page.indexOf("## Not there yet"));
    const listed = new Set([...section.matchAll(/`([A-Z][A-Z0-9.]*)`/g)].map((m) => m[1]!));
    const have = new Set(functionNames());
    expect([...have].filter((n) => !listed.has(n))).toEqual([]);
    expect([...listed].filter((n) => !have.has(n) && !["NOW", "TODAY", "RAND", "RANDBETWEEN", "IF"].includes(n))).toEqual([]);
    expect(page).toContain(`There are ${have.size} functions`);
  });
});
