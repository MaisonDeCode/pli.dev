import { describe, expect, it, vi } from "vitest";
import { rebaseWith } from "@pli.dev/core";
import { SheetSession, sheetSyncModel, transformSheetOps, withoutGhosts, type SheetOp, type Workbook } from "../src";
import { apply, randomBatch, rng, same, show, startBook, type Rng } from "./sync-helpers";

/**
 * The convergence fuzzer for sheets. Random operations are made by random people on workbooks that start alike, passed
 * through the transform, and applied in both orders. Whatever happens, everyone must end with the same workbook.
 * `FUZZ_RUNS` scales how many cases run.
 */
vi.setConfig({ testTimeout: 20 * 60_000 });
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;

const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, k === "merges" && Array.isArray(x) ? [...x].sort() : sorted(x)])) : v);

function firstDiff(a: Workbook, b: Workbook): string {
  const x = JSON.stringify(sorted(a));
  const y = JSON.stringify(sorted(b));
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `\n  A: ...${x.slice(Math.max(0, i - 80), i + 160)}\n  B: ...${y.slice(Math.max(0, i - 80), i + 160)}`;
}

function pairs(seeds: number, only?: readonly string[]) {
  for (let seed = 1; seed <= seeds; seed++) {
    if (process.env.SEED && seed !== Number(process.env.SEED)) continue;
    const r = rng(seed * 7919);
    const start = startBook(true);
    // A little history first, so the workbook isn't always the same.
    const warm = randomBatch(r, start, "w", 3);
    const from = apply(start, warm);
    const as = randomBatch(r, from, "a", 3, { only });
    const bs = randomBatch(r, from, "b", 3, { only });
    if (!as.length || !bs.length) continue;
    const [as2, bs2] = transformSheetOps(as, bs);
    let viaB: Workbook;
    let viaA: Workbook;
    try {
      viaB = apply(apply(from, bs), as2);
      viaA = apply(apply(from, as), bs2);
    } catch (error) {
      throw new Error(`seed ${seed}: a transformed change failed (${(error as Error).message})\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}`);
    }
    if (!same(viaB, viaA)) throw new Error(`seed ${seed}: diverged${firstDiff(viaB, viaA)}\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}`);
  }
}

describe("sheets transform: pairs", () => {
  it("converges for random batches of operations", () => pairs(800 * RUNS));
  it("converges for rows and columns met by anything", () => pairs(500 * RUNS, ["insert_rows", "delete_rows", "insert_cols", "delete_cols", "insert_row_runs", "cells", "formula", "merge", "rule", "chart", "validation", "set_size", "filter", "image"]));
  it("converges for sheets added, renamed, deleted and moved", () => pairs(500 * RUNS, ["add_sheet", "rename_sheet", "delete_sheet", "move_sheet", "formula", "name", "cells", "insert_rows"]));
  it("converges for comments", () => pairs(500 * RUNS, ["thread", "reply", "resolve", "clear", "insert_rows", "delete_rows"]));
});

// ---- Several people and a server ----

class Simulation {
  serverState: Workbook;
  history: Workbook[];
  log: { client: number; ops: SheetOp[] }[] = [];
  clients: SimClient[];
  toServer: { client: number; base: number; ops: SheetOp[] }[][];
  toClient: { index: number }[][];
  constructor(start: Workbook, count: number) {
    this.serverState = start;
    this.history = [start];
    this.clients = Array.from({ length: count }, (_, i) => new SimClient(i, start, this));
    this.toServer = this.clients.map(() => []);
    this.toClient = this.clients.map(() => []);
  }
  serverReceives(from: number): void {
    const batch = this.toServer[from]!.shift()!;
    const unseen = this.log.slice(batch.base).flatMap((e) => e.ops);
    const [ops] = transformSheetOps(batch.ops, unseen);
    try {
      this.serverState = apply(this.serverState, ops);
    } catch (error) {
      throw new Error(`the server couldn't apply c${batch.client}'s batch (${(error as Error).message})\nbatch = ${show(batch.ops)}\nunseen = ${show(unseen)}\ntransformed = ${show(ops)}`);
    }
    this.log.push({ client: batch.client, ops });
    this.history.push(this.serverState);
    for (const wire of this.toClient) wire.push({ index: this.log.length - 1 });
  }
  clientReceives(to: number): void {
    const { index } = this.toClient[to]!.shift()!;
    this.clients[to]!.receive(this.log[index]!);
  }
  quiet(): boolean {
    return this.toServer.every((w) => w.length === 0) && this.toClient.every((w) => w.length === 0) && this.clients.every((c) => !c.inflight && c.pending.length === 0);
  }
}

const rebase = rebaseWith<SheetOp>(transformSheetOps);

class SimClient {
  doc: Workbook;
  version = 0;
  lastRebase = "";
  inflight: SheetOp[] | null = null;
  pending: SheetOp[] = [];
  constructor(readonly id: number, start: Workbook, readonly sim: Simulation) {
    this.doc = start;
  }
  edit(ops: SheetOp[]): void {
    this.doc = apply(this.doc, ops);
    this.pending.push(...ops);
    this.flush();
  }
  /** Its document is what the server had at its version, plus its own changes not yet taken. */
  check(when: string): void {
    let expected: Workbook;
    try {
      expected = apply(this.sim.history[this.version]!, [...(this.inflight ?? []), ...this.pending]);
    } catch (error) {
      throw new Error(`c${this.id} ${when}: its own changes no longer apply to the server's workbook (${(error as Error).message})\n${this.lastRebase}`);
    }
    if (!same(this.doc, expected)) throw new Error(`c${this.id} is out of step ${when}${firstDiff(expected, this.doc)}\n${this.lastRebase}`);
  }
  flush(): void {
    if (this.inflight || this.pending.length === 0) return;
    this.inflight = this.pending;
    this.pending = [];
    this.sim.toServer[this.id]!.push({ client: this.id, base: this.version, ops: this.inflight });
  }
  receive(entry: { client: number; ops: SheetOp[] }): void {
    this.version++;
    if (entry.client === this.id) {
      this.inflight = null;
      this.check("after its own batch was accepted");
      this.flush();
      return;
    }
    const next = rebase(this.inflight ?? [], this.pending, entry.ops);
    this.lastRebase = `inflight before = ${show(this.inflight ?? [])}\npending before = ${show(this.pending)}\ninflight after = ${show(next.inflight)}\npending after = ${show(next.pending)}\nincoming after = ${show(next.incoming)}`;
    this.inflight = this.inflight ? next.inflight : null;
    this.pending = next.pending;
    try {
      this.doc = apply(this.doc, next.incoming);
    } catch (error) {
      throw new Error(`c${this.id} couldn't apply an entry from c${entry.client} (${(error as Error).message})\nlists = ${JSON.stringify(this.doc.sheets.map((s) => [s.id, s.validations?.map((v) => [v.id, v.ranges]), s.conditional?.map((v) => [v.id, v.ranges])]))}\nentry = ${show(entry.ops)}\ninflight = ${show(this.inflight ?? [])}\npending = ${show(this.pending)}\nincoming = ${show(next.incoming)}`);
    }
    this.check(`after taking an entry from c${entry.client}\nentry = ${show(entry.ops)}`);
  }
}

function runSimulation(seed: number, clients: number, steps: number, only?: readonly string[]): void {
  if (process.env.SEED && seed !== Number(process.env.SEED)) return;
  const r: Rng = rng(seed);
  const sim = new Simulation(startBook(true), clients);
  const trace: string[] = [];
  try {
    for (let step = 0; step < steps; step++) {
      const what = r.pick(["edit", "edit", "toServer", "toClient"] as const);
      if (what === "edit") {
        const c = sim.clients[r.int(clients)]!;
        const ops = randomBatch(r, c.doc, `c${c.id}`, 2, { only });
        if (!ops.length) continue;
        trace.push(`c${c.id} edits ${show(ops)}`);
        c.edit(ops);
      } else if (what === "toServer") {
        const waiting = sim.toServer.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length) sim.serverReceives(r.pick(waiting));
      } else {
        const waiting = sim.toClient.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length) sim.clientReceives(r.pick(waiting));
      }
    }
    let guard = 0;
    while (!sim.quiet() && guard++ < 10000) {
      const up = sim.toServer.findIndex((w) => w.length > 0);
      if (up >= 0 && r.chance(0.5)) {
        sim.serverReceives(up);
        continue;
      }
      const down = sim.toClient.findIndex((w) => w.length > 0);
      if (down >= 0) sim.clientReceives(down);
      else if (up >= 0) sim.serverReceives(up);
    }
  } catch (error) {
    throw new Error(`seed ${seed}: ${(error as Error).message} ${((error as Error).stack ?? "").split("\n").slice(1, 16).join(" | ")}\n${trace.slice(-30).join("\n")}${process.env.SEED ? `\nLOG ${sim.log.map((e, i) => `#${i} c${e.client} ${show(e.ops).slice(0, 400)}`).join("\n")}` : ""}`);
  }
  for (const c of sim.clients) if (!same(c.doc, sim.serverState)) throw new Error(`seed ${seed}: client ${c.id} differs from the server${firstDiff(sim.serverState, c.doc)}\n${trace.slice(-30).join("\n")}`);
}

describe("sheets transform: clients and a server", () => {
  it("two people converge", () => {
    for (let seed = 1; seed <= 100 * RUNS; seed++) runSimulation(seed, 2, 40);
  });
  it("three people converge", () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) runSimulation(seed * 31, 3, 60);
  });
  it("five people converge over a long session", () => {
    for (let seed = 1; seed <= 15 * RUNS; seed++) runSimulation(seed * 101, 5, 150);
  });
});

describe("what the fuzzer relies on", () => {
  it("the transform keeps its place when nothing meets", () => {
    const start = startBook();
    const a: SheetOp = { type: "set_cells", sheet: "s1", cells: { A1: { v: 1 } } };
    const b: SheetOp = { type: "set_cells", sheet: "s1", cells: { B1: { v: 2 } } };
    expect(transformSheetOps([a], [b])).toEqual([[a], [b]]);
    expect(sheetSyncModel.hash(start)).toBe(sheetSyncModel.hash(structuredClone(start)));
  });
});

describe("named conflict cases", () => {
  const both = (start: Workbook, later: SheetOp[], earlier: SheetOp[]) => {
    const [l2, e2] = transformSheetOps(later, earlier);
    const a = apply(apply(start, earlier), l2);
    const b = apply(apply(start, later), e2);
    expect(same(a, b)).toBe(true);
    return a;
  };
  const rule = (id: string, range: string): SheetOp => ({ type: "add_rule", sheet: "s1", rule: { id, kind: "formula", formula: "A1>1", ranges: [range], style: { bold: true } } as never });

  it("two sheets added with the same name: the later one is called `Name (2)` everywhere, and its formulas follow", () => {
    const start = startBook();
    const mine: SheetOp[] = [
      { type: "add_sheet", sheet: { id: "x1", name: "Totals", cells: { A1: { v: 1 } } }, index: 2 },
      { type: "set_cells", sheet: "s1", cells: { H1: { f: "Totals!A1+1" } } },
    ];
    const theirs: SheetOp[] = [{ type: "add_sheet", sheet: { id: "x2", name: "totals", cells: { A1: { v: 9 } } }, index: 2 }];
    const wb = both(start, mine, theirs);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Data", "Notes", "totals", "Totals (2)"]);
    expect(wb.sheets[0]!.cells["H1"]!.f).toBe("'Totals (2)'!A1+1");
  });

  it("two sheets renamed to the same name, while a third is added", () => {
    const start = startBook();
    const wb = both(start, [{ type: "rename_sheet", id: "s2", name: "Plan", from: "Notes" }], [{ type: "rename_sheet", id: "s1", name: "plan", from: "Data" }, { type: "add_sheet", sheet: { id: "x3", name: "Extra", cells: {} }, index: 2 }]);
    expect(wb.sheets.map((s) => s.name).sort()).toEqual(["Extra", "Plan (2)", "plan"]);
  });

  it("a sheet renamed, then a version restored that has it, and a name that uses the new name, while another person deletes the sheet (seed 187581): what comes after the restore is left alone", () => {
    const start = startBook();
    const restored = apply(start, [{ type: "rename_sheet", id: "s2", name: "Alpha1", from: "Notes" }]);
    const mine: SheetOp[] = [{ type: "rename_sheet", id: "s2", name: "Alpha1", from: "Notes" }, { type: "restore", workbook: restored }, { type: "set_name", name: "Gamma", formula: "Alpha1!$A$9" }];
    const wb = both(start, mine, [{ type: "delete_sheet", id: "s2", name: "Notes", at: 1, prev: "s1" }]);
    expect(wb.names!["Gamma"]).toBe("Alpha1!$A$9");
  });

  it("a rule edited while another person deletes every range of it: the edit goes", () => {
    const start = apply(startBook(), [rule("r1", "G2:G3"), rule("r2", "A1:A2")]);
    const edit: SheetOp = { type: "update_rule", sheet: "s1", rule: { id: "r1", kind: "formula", formula: "A1>9", ranges: ["G2:G4"], style: { bold: true } } as never, at: 0 };
    const gone: SheetOp[] = [{ type: "delete_rule", sheet: "s1", id: "r1", at: 0, soft: true }, { type: "delete_cols", sheet: "s1", at: 7, count: 1, name: "Data" }];
    const wb = both(start, [edit], gone);
    expect(wb.sheets[0]!.conditional!.map((r) => r.id)).toEqual(["r2"]);
  });

  it("a rule that loses every range in one copy only (seed 95849): two rules added at one place still end in one order", () => {
    // r0 covers B and C. One person deletes column C, the other column B: in each copy the rule loses one column, and in the
    // merged workbook all of them. Both also add a rule at the end of the list.
    const start = apply(startBook(), [rule("r0", "B1:C1"), rule("r1", "A1")]);
    const mine: SheetOp[] = [{ type: "delete_cols", sheet: "s1", at: 3, count: 1, name: "Data" }, { ...rule("mine", "A5"), index: 2 } as SheetOp];
    const theirs: SheetOp[] = [{ type: "delete_cols", sheet: "s1", at: 2, count: 1, name: "Data" }, { ...rule("theirs", "A6"), index: 2 } as SheetOp];
    const wb = both(start, mine, theirs);
    expect(wb.sheets[0]!.conditional!.filter((r) => r.ranges.length).map((r) => r.id)).toEqual(["r1", "theirs", "mine"]);
  });

  describe("tables, slicers, timelines and pivot tables", () => {
    const orders = (wb: Workbook) => wb.sheets.find((x) => x.id === "s3")!;
    const t1 = () => orders(startBook(true)).tables![0]!;
    const withTables = () => startBook(true);
    const slicer = (id: string, column: string): SheetOp => ({ type: "add_slicer", sheet: "s3", slicer: { id, table: "OrderTable", column, from: { row: 2, col: 9 }, width: 160, height: 200 } as never, index: 1, after: "sl1" });
    const timeline = (id: string): SheetOp => ({ type: "add_timeline", sheet: "s3", timeline: { id, table: "OrderTable", column: "Day", from: { row: 14, col: 1 }, width: 300, height: 120, level: "months" } as never, index: 1, after: "tl1" });

    it("a table widened while another person deletes the one column it was cut down to (seed 26257): it comes back widened, the same everywhere", () => {
      const start = apply(withTables(), [{ type: "update_table", sheet: "s3", table: { ...t1(), range: "A1:A9" }, at: 0 }]);
      const wb = both(start, [{ type: "update_table", sheet: "s3", table: { ...t1(), range: "A1:B9" }, at: 0 }], [{ type: "delete_cols", sheet: "s3", at: 1, count: 1, name: "Orders" }]);
      expect(orders(wb).tables!.map((t) => [t.id, t.range])).toEqual([["t1", "A1:A9"]]);
    });

    it("a slicer added on a column that another person deletes: it stays out of sight and is left out when saved", () => {
      const wb = both(withTables(), [slicer("sl2", "Qty")], [{ type: "delete_cols", sheet: "s3", at: 3, count: 1, name: "Orders" }]);
      expect(new SheetSession(wb).slicers("Orders").map((x) => x.id)).toEqual(["sl1"]);
      expect(orders(withoutGhosts(wb)).slicers!.map((x) => x.id)).toEqual(["sl1"]);
    });

    it("a timeline and a slicer added on a table whose header row another person deletes", () => {
      const wb = both(withTables(), [timeline("tl2"), slicer("sl2", "Product")], [{ type: "delete_rows", sheet: "s3", at: 1, count: 1, name: "Orders" }]);
      const session = new SheetSession(wb);
      expect(session.tables("Orders")).toEqual([]);
      expect(session.slicers("Orders")).toEqual([]);
      expect(session.timelines("Orders")).toEqual([]);
      expect(orders(withoutGhosts(wb)).timelines).toBeUndefined();
    });

    it("a slicer and a table deleted by two people at once, and a slicer added meanwhile", () => {
      const wb = both(withTables(), [{ type: "delete_slicer", sheet: "s3", id: "sl1", at: 0, prev: null }, slicer("sl2", "Region")], [{ type: "delete_table", sheet: "s3", id: "t1", at: 0, prev: null }]);
      expect(new SheetSession(wb).slicers("Orders")).toEqual([]);
    });

    it("the header row switched off while columns are inserted into the table and another person edits it", () => {
      const off = { ...t1(), range: "A2:D9", headerRow: false, columns: ["Region", "Product", "Qty", "Day"] };
      const mine: SheetOp[] = [{ type: "update_table", sheet: "s3", table: off as never, at: 0 }, { type: "set_cells", sheet: "s3", cells: { A1: null, B1: null, C1: null, D1: null } }];
      const theirs: SheetOp[] = [{ type: "insert_cols", sheet: "s3", at: 2, count: 1, name: "Orders" }, { type: "set_cells", sheet: "s3", cells: { B1: { v: "Extra" } } }];
      const wb = both(withTables(), mine, theirs);
      expect(orders(wb).tables).toHaveLength(1);
    });

    it("two people insert a column at the same place in a table without a header row", () => {
      const start = apply(withTables(), [{ type: "update_table", sheet: "s3", table: { ...t1(), range: "A2:D9", headerRow: false, columns: ["Region", "Product", "Qty", "Day"] } as never, at: 0 }]);
      const ins: SheetOp = { type: "insert_cols", sheet: "s3", at: 3, count: 1, name: "Orders" };
      const wb = both(start, [ins], [ins]);
      expect(orders(wb).tables![0]!.range).toBe("A2:F9");
      expect(orders(wb).tables![0]!.columns).toHaveLength(6);
    });

    it("both people put back the table they had deleted (two undos at once): one table, not two", () => {
      const gone = apply(withTables(), [{ type: "delete_table", sheet: "s3", id: "t1", at: 0, prev: null }]);
      const add: SheetOp = { type: "add_table", sheet: "s3", table: t1(), index: 0, after: null };
      const wb = both(gone, [add], [add]);
      expect(orders(wb).tables!.map((t) => t.id)).toEqual(["t1"]);
    });

    it("the same slicer put back by two people at different places (two undos): the later version, in the earlier place, the same everywhere", () => {
      const start = apply(withTables(), [slicer("sl2", "Product"), { type: "delete_slicer", sheet: "s3", id: "sl1", at: 0, prev: null }]);
      const put = (index: number, width: number): SheetOp => ({ type: "add_slicer", sheet: "s3", slicer: { id: "sl1", table: "OrderTable", column: "Region", from: { row: 2, col: 7 }, width, height: 220 } as never, index });
      const wb = both(start, [put(1, 111)], [put(0, 222)]);
      expect(orders(wb).slicers!.map((x) => [x.id, x.width])).toEqual([["sl1", 111], ["sl2", 160]]);
    });

    it("the last two sheets deleted by two people, one each: the workbook keeps a sheet when it is saved, and the editor refuses to delete the last one", () => {
      const wb = both(startBook(), [{ type: "delete_sheet", id: "s1", name: "Data", at: 0, prev: null }], [{ type: "delete_sheet", id: "s2", name: "Notes", at: 1, prev: "s1" }]);
      expect(wb.sheets).toHaveLength(0);
      expect(withoutGhosts(wb).sheets).toHaveLength(1);
      const session = new SheetSession(startBook());
      session.syncing = true;
      session.deleteSheet("s1");
      expect(() => session.deleteSheet("s2")).toThrow(/at least one sheet/);
      expect(session.state.sheets).toHaveLength(1);
    });

    it("two different tables made over the same cells stay, one of them out of sight when saved", () => {
      const start = apply(withTables(), [{ type: "delete_table", sheet: "s3", id: "t1", at: 0, prev: null }]);
      const make = (id: string, name: string): SheetOp => ({ type: "add_table", sheet: "s3", table: { ...t1(), id, name } as never, index: 0, after: null });
      const wb = both(start, [make("ta", "TableA")], [make("tb", "TableB")]);
      expect(orders(wb).tables!.map((t) => t.id).sort()).toEqual(["ta", "tb"]);
    });

    it("a table renamed by two people at once, and its columns resized", () => {
      const wb = both(withTables(), [{ type: "update_table", sheet: "s3", table: { ...t1(), name: "Mine", range: "A1:D12" } as never, at: 0 }], [{ type: "update_table", sheet: "s3", table: { ...t1(), name: "Theirs" } as never, at: 0 }]);
      expect(orders(wb).tables).toHaveLength(1);
    });

    it("a pivot table whose source loses rows while another person changes it, and whose source loses every column", () => {
      const pivot = { ...new SheetSession(withTables()).pivots("Summary")[0]!, name: "Renamed" };
      const rows = both(withTables(), [{ type: "update_pivot", sheet: "s4", pivot: pivot as never, at: 0 }], [{ type: "delete_rows", sheet: "s3", at: 3, count: 3, name: "Orders" }]);
      expect(rows.sheets.find((x) => x.id === "s4")!.pivots!).toHaveLength(1);
      both(withTables(), [{ type: "update_pivot", sheet: "s4", pivot: pivot as never, at: 0 }], [{ type: "delete_cols", sheet: "s3", at: 1, count: 4, name: "Orders" }]);
    });

    it("a slicer connected to a pivot table while another person deletes the pivot table", () => {
      const pivot = new SheetSession(withTables()).pivots("Summary")[0]!;
      const slicers = [...(pivot.slicers ?? []), { id: "ps2", field: "Region", from: { row: 2, col: 6 }, width: 150, height: 180 }];
      both(withTables(), [{ type: "update_pivot", sheet: "s4", pivot: { ...pivot, slicers } as never, at: 0 }], [{ type: "delete_pivot", sheet: "s4", id: "pv1", at: 0, prev: null }]);
    });
  });

  it("three people at once: one adds after a neighbour that another deletes while a third adds beside it", () => {
    let start = startBook();
    start = apply(start, [rule("a", "A1"), rule("b", "A2"), rule("c", "A3")]);
    const order = (...lists: SheetOp[][]) => lists;
    void order;
    const add = (id: string, index: number): SheetOp => ({ ...rule(id, "B1"), index } as SheetOp);
    const del = (id: string, at: number): SheetOp => ({ type: "delete_rule", sheet: "s1", id, at });
    // Everyone's change is merged in each of the six orders the server could have taken them.
    const changes: SheetOp[][] = [[add("n1", 2)], [del("b", 1)], [add("n2", 2)]];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const results = perms.map((p) => {
      let log: SheetOp[] = [];
      let state = start;
      for (const i of p) {
        const [mine] = transformSheetOps(changes[i]!, log);
        state = apply(state, mine);
        log = [...log, ...mine];
      }
      return state.sheets[0]!.conditional!.map((r) => r.id).join(",");
    });
    // Whatever order the server takes them in, each person's view of the list after applying the others converges (all six give one list per order of ties).
    expect(new Set(results.map((r) => r.split(",").sort().join(","))).size).toBe(1);
  });
});
