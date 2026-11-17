import { describe, expect, it } from "vitest";
import { Session, type Reducer } from "../src";

type Op = { type: "add"; n: number };
const counter: Reducer<number, Op> = {
  apply: (state, op) => ({ state: state + op.n, inverse: { type: "add", n: -op.n } }),
};

describe("Session history metadata", () => {
  it("hands back the before-meta on undo and the after-meta on redo", () => {
    const s = new Session<number, Op, string>(0, counter);
    s.transact([{ type: "add", n: 1 }], { before: "A", after: "B" });
    s.transact([{ type: "add", n: 2 }], { before: "B", after: "C" });

    const seen: (string | undefined)[] = [];
    s.subscribe((e) => seen.push(e.meta));

    s.undo();
    s.undo();
    s.redo();
    s.redo();
    expect(seen).toEqual(["B", "A", "B", "C"]);
    expect(s.state).toBe(3);
  });

  it("reports the after-meta for a local change", () => {
    const s = new Session<number, Op, string>(0, counter);
    let meta: string | undefined;
    s.subscribe((e) => (meta = e.meta));
    s.transact([{ type: "add", n: 1 }], { before: "A", after: "B" });
    expect(meta).toBe("B");
  });

  it("keeps remote changes out of the undo history", () => {
    const s = new Session<number, Op>(0, counter);
    s.transact([{ type: "add", n: 5 }], { origin: "remote" });
    expect(s.state).toBe(5);
    expect(s.canUndo).toBe(false);
  });
});

describe("Session merge", () => {
  it("folds a change into the previous undo step", () => {
    const s = new Session<number, Op, string>(0, counter);
    s.transact([{ type: "add", n: 1 }], { before: "A", after: "B" });
    s.transact([{ type: "add", n: 2 }], { before: "B", after: "C", merge: true });
    s.transact([{ type: "add", n: 4 }], { before: "C", after: "D", merge: true });
    expect(s.state).toBe(7);

    let restored: string | undefined;
    s.subscribe((e) => (restored = e.meta));
    s.undo();
    expect(s.state).toBe(0);
    expect(restored).toBe("A");
    expect(s.canUndo).toBe(false);

    s.redo();
    expect(s.state).toBe(7);
    expect(restored).toBe("D");
  });

  it("starts a new step when there is nothing to merge into", () => {
    const s = new Session<number, Op>(0, counter);
    s.transact([{ type: "add", n: 1 }], { merge: true });
    s.undo();
    expect(s.state).toBe(0);
  });
});
