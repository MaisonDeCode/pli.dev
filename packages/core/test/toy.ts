import { PliError, type Reducer, type SyncModel } from "../src";

// ---- A tiny text model: a string, with insert and delete -------------------------------------------------------

export type Op = { t: "ins"; at: number; s: string } | { t: "del"; at: number; n: number };

export const reducer: Reducer<string, Op> = {
  apply(text, op) {
    if (op.t === "ins") {
      if (op.at < 0 || op.at > text.length) throw new PliError("out_of_range", "bad insert");
      return { state: text.slice(0, op.at) + op.s + text.slice(op.at), inverse: { t: "del", at: op.at, n: op.s.length } };
    }
    if (op.at < 0 || op.at + op.n > text.length) throw new PliError("not_found", "text is gone");
    return { state: text.slice(0, op.at) + text.slice(op.at + op.n), inverse: { t: "ins", at: op.at, s: text.slice(op.at, op.at + op.n) } };
  },
};

const through = (x: number, at: number, n: number) => (x <= at ? x : x >= at + n ? x - n : at);

function pair(a: Op, b: Op): [Op[], Op[]] {
  if (a.t === "ins" && b.t === "ins") return [[{ ...a, at: b.at <= a.at ? a.at + b.s.length : a.at }], [{ ...b, at: a.at < b.at ? b.at + a.s.length : b.at }]];
  if (a.t === "ins" && b.t === "del") return [[{ ...a, at: through(a.at, b.at, b.n) }], splitDel(b, a)];
  if (a.t === "del" && b.t === "ins") return [splitDel(a, b), [{ ...b, at: through(b.at, a.at, a.n) }]];
  const d = (x: Extract<Op, { t: "del" }>, y: Extract<Op, { t: "del" }>): Op[] => {
    const from = through(x.at, y.at, y.n);
    const to = through(x.at + x.n, y.at, y.n);
    return to > from ? [{ t: "del", at: from, n: to - from }] : [];
  };
  return [d(a as never, b as never), d(b as never, a as never)];
}

function splitDel(del: Extract<Op, { t: "del" }>, ins: Extract<Op, { t: "ins" }>): Op[] {
  const n = ins.s.length;
  if (ins.at <= del.at) return [{ ...del, at: del.at + n }];
  if (ins.at >= del.at + del.n) return [del];
  return [
    { t: "del", at: ins.at + n, n: del.at + del.n - ins.at },
    { t: "del", at: del.at, n: ins.at - del.at },
  ];
}

export function transform(a: readonly Op[], b: readonly Op[]): [Op[], Op[]] {
  if (a.length === 0 || b.length === 0) return [[...a], [...b]];
  if (a.length === 1 && b.length === 1) return pair(a[0]!, b[0]!);
  if (a.length > 1) {
    const [first, ...rest] = a;
    const [f, bb] = transform([first!], b);
    const [r, b2] = transform(rest, bb);
    return [[...f, ...r], b2];
  }
  const [first, ...rest] = b;
  const [aa, f] = transform(a, [first!]);
  const [a2, r] = transform(aa, rest);
  return [a2, [...f, ...r]];
}

export const model: SyncModel<string, Op> = {
  apply: (text, op) => reducer.apply(text, op).state,
  transform,
  hash: (text) => `${text.length}:${text}`,
};

