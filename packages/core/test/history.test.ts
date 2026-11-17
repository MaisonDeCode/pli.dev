import { describe, expect, it } from "vitest";
import { Session } from "../src";
import { reducer, transform, type Op } from "./toy";

const ins = (at: number, s: string): Op => ({ t: "ins", at, s });
const del = (at: number, n: number): Op => ({ t: "del", at, n });

/** The session's meta is a caret position, which moves with inserts and deletes before it. */
const mapMeta = (caret: number, ops: readonly Op[]) =>
  ops.reduce((c, op) => (op.t === "ins" ? (op.at < c ? c + op.s.length : c) : op.at >= c ? c : op.at + op.n <= c ? c - op.n : op.at), caret);
const algebra = { transform, mapMeta };

function start(text: string) {
  return new Session<string, Op, number>(text, reducer);
}

/** Someone else's change arrives: it is applied, and the history catches up. */
function remote(session: Session<string, Op, number>, ...ops: Op[]) {
  session.transact(ops, { origin: "remote" });
  session.rebaseHistory(ops, algebra);
}

describe("rebasing the undo history", () => {
  it("undoes your change and leaves theirs, when they typed before it", () => {
    const s = start("Hello");
    s.transact([ins(5, "X")], { before: 5, after: 6 });
    remote(s, ins(0, ">> "));
    expect(s.state).toBe(">> HelloX");
    s.undo();
    expect(s.state).toBe(">> Hello");
  });

  it("works down a stack of steps, each one past what happened since", () => {
    const s = start("Hello");
    s.transact([ins(5, "X")], { before: 5, after: 6 });
    s.transact([ins(6, "Y")], { before: 6, after: 7 });
    remote(s, ins(0, ">> "));
    remote(s, ins(3, "!"));
    expect(s.state).toBe(">> !HelloXY");
    s.undo();
    expect(s.state).toBe(">> !HelloX");
    s.undo();
    expect(s.state).toBe(">> !Hello");
    expect(s.canUndo).toBe(false);
  });

  it("keeps the redo history right too", () => {
    const s = start("Hello");
    s.transact([ins(5, "X")], { before: 5, after: 6 });
    s.undo();
    remote(s, ins(0, ">> "));
    expect(s.state).toBe(">> Hello");
    s.redo();
    expect(s.state).toBe(">> HelloX");
  });

  it("puts back deleted text after what someone typed in the same place", () => {
    const s = start("Hello world");
    s.transact([del(2, 3)], { before: 2, after: 2 });
    remote(s, ins(2, "ZZ"));
    expect(s.state).toBe("HeZZ world");
    s.undo();
    expect(s.state).toBe("HeZZllo world");
  });

  it("forgets a step whose text someone else deleted", () => {
    const s = start("abcdef");
    s.transact([ins(3, "X")], { before: 3, after: 4 });
    remote(s, del(0, 7));
    expect(s.state).toBe("");
    expect(s.canUndo).toBe(false);
    expect(s.undo()).toBe(false);
  });

  it("moves the selection kept with a step", () => {
    const s = start("Hello");
    const seen: (number | undefined)[] = [];
    s.subscribe((e) => void seen.push(e.meta));
    s.transact([ins(5, "X")], { before: 5, after: 6 });
    remote(s, ins(0, ">> "));
    s.undo();
    // The caret was at 5 before the change, and is at 8 now that three characters came in front.
    expect(seen.at(-1)).toBe(8);
  });

  it("does nothing when there is nothing to merge, or no history", () => {
    const s = start("Hello");
    s.rebaseHistory([], algebra);
    remote(s, ins(0, "a"));
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });
});

describe("a step that no longer fits", () => {
  it("is forgotten when undone, leaving the document as it was", () => {
    const s = start("Hello");
    s.transact([ins(5, "X")]);
    // Someone deletes the text and the history isn't told (it would have dropped the step).
    s.transact([del(0, 6)], { origin: "remote" });
    expect(s.undo()).toBe(false);
    expect(s.state).toBe("");
    expect(s.canUndo).toBe(false);
  });
});

describe("reset", () => {
  it("replaces the state and forgets the history", () => {
    const s = start("Hello");
    s.transact([ins(5, "!")]);
    const heard: boolean[] = [];
    s.subscribe((e) => void heard.push(!!e.reset));
    s.reset("Elsewhere");
    expect(s.state).toBe("Elsewhere");
    expect(s.canUndo).toBe(false);
    expect(heard).toEqual([true]);
  });
});

describe("a change that isn't an undo step", () => {
  it("is applied as a local change but leaves the history alone", () => {
    const s = start("Hello");
    const origins: string[] = [];
    s.subscribe((e) => void origins.push(e.origin));
    s.transact([ins(5, "!")], { history: false });
    expect(origins).toEqual(["local"]);
    expect(s.state).toBe("Hello!");
    expect(s.canUndo).toBe(false);
    s.transact([ins(6, "?")]);
    expect(s.canUndo).toBe(true);
  });
});
