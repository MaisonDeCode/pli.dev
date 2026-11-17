import { describe, expect, it } from "vitest";
import { applyListOp, transformListOp, type ListOp } from "../src/listot";

const base = ["A", "B", "C", "D"];

/** Every change that can be made to a list of four, with `tag` naming the item an insert makes. */
function all(list: readonly string[], tag: string): ListOp[] {
  const out: ListOp[] = [];
  for (let i = 0; i <= list.length; i++) out.push({ k: "ins", i, x: tag });
  list.forEach((x, i) => {
    out.push({ k: "del", i, x });
    for (let j = 0; j < list.length; j++) out.push({ k: "mov", i, j, x });
  });
  return out;
}

const run = (list: string[], ops: readonly ListOp[]) => ops.reduce(applyListOp, list);

describe("list merging", () => {
  it("converges for every pair of changes to a list of four", () => {
    let n = 0;
    for (const l of all(base, "L")) {
      for (const e of all(base, "E")) {
        const [l2, e2] = transformListOp(l, e);
        const a = run(run(base, [e]), l2);
        const b = run(run(base, [l]), e2);
        expect(a, `${JSON.stringify(l)} later than ${JSON.stringify(e)}`).toEqual(b);
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
  });

  it("puts two items inserted at one place in the order they were accepted", () => {
    const [l2] = transformListOp({ k: "ins", i: 2, x: "L" }, { k: "ins", i: 2, x: "E" });
    expect(run(run(base, [{ k: "ins", i: 2, x: "E" }]), l2)).toEqual(["A", "B", "E", "L", "C", "D"]);
  });

  it("lets the later of two moves of the same item win", () => {
    const e: ListOp = { k: "mov", i: 0, j: 3, x: "A" };
    const l: ListOp = { k: "mov", i: 0, j: 1, x: "A" };
    const [l2, e2] = transformListOp(l, e);
    expect(run(run(base, [e]), l2)).toEqual(["B", "A", "C", "D"]);
    expect(e2).toEqual([]);
  });
});
