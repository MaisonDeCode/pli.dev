/**
 * A debugging tool, not a test. When a sync fuzz run fails, run it with `SHRINK=1` and it writes the failing
 * schedule of edits, undos and deliveries to /tmp/script.json. This replays that schedule, removes steps that aren't
 * needed to make it fail, and prints the smallest one it finds with the server's log. It does nothing without the file.
 *
 *     SHRINK=1 pnpm vitest run packages/docs/test/sync.test.ts
 *     pnpm vitest run packages/docs/test/shrink.tool.test.ts
 */
import { it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DocumentSession, type Doc, type DocOp } from "../src";
import { canon, firstDiff, same } from "./fuzz-helpers";
import { rig, serverDoc } from "./sync-net";

type Action = { k: "edit"; i: number; ops: DocOp[] } | { k: "undo" | "redo" | "deliver"; i: number } | { k: "serve"; which: number };

async function failure(clients: number, start: Doc, actions: Action[]): Promise<string | null> {
  const w = await rig(clients, start);
  try {
    for (const a of actions) {
      if (a.k === "edit") { try { w.sessions[a.i]!.transact(a.ops); } catch { /* skipped */ } }
      else if (a.k === "undo") w.sessions[a.i]!.undo();
      else if (a.k === "redo") w.sessions[a.i]!.redo();
      else if (a.k === "serve") await w.net.serve(a.which);
      else w.net.deliver(a.i);
    }
    await w.net.settle();
  } catch (e) { return `threw ${(e as Error).message}\n${(e as Error).stack?.split("\n").slice(1, 9).join("\n")}`; }
  const server = await serverDoc(w.store);
  for (const [i, s] of w.sessions.entries()) if (!same(s.state, server)) return `client ${i}: ${firstDiff(canon(server), canon(s.state))}`;
  if (w.resyncs.length > 0) return `resync: ${JSON.stringify(w.resyncs)}`;
  return null;
}

it.skipIf(!existsSync("/tmp/script.json"))("shrinks a failing schedule", async () => {
  const { clients, start, script } = JSON.parse(readFileSync("/tmp/script.json", "utf8")) as { clients: number; start: Doc; script: Action[] };
  let current = script;
  const first = await failure(clients, start, current);
  console.log("initial:", first);
  if (!first) return;
  let chunk = Math.floor(current.length / 2);
  while (chunk >= 1) {
    let progress = false;
    for (let i = 0; i + chunk <= current.length; ) {
      const trial = [...current.slice(0, i), ...current.slice(i + chunk)];
      if (await failure(clients, start, trial)) { current = trial; progress = true; } else i += chunk;
    }
    if (!progress) chunk = Math.floor(chunk / 2);
  }
  console.log("MINIMAL", await failure(clients, start, current));
  {
    const w = await rig(clients, start);
    const brief = (ops: DocOp[]) =>
      ops
        .map((o) =>
          JSON.stringify(o, (k, v) => {
            if (k === "rows") return `rows(${(v as { cells: { id: string; blocks: { id: string }[] }[] }[]).map((r) => r.cells.map((c) => c.id.slice(-5) + ":" + c.blocks.map((b) => b.id.slice(-5)).join("+")).join(",")).join(";")})`;
            if (k === "within") return (v as string[]).map((x) => x.slice(-5)).join(",");
            if (k === "runs") return "…";
            if (k === "block" && typeof v === "object") return (v as { id: string }).id.slice(-6);
            return typeof v === "string" && v.length > 8 ? v.slice(-6) : v;
          }),
        )
        .join(" | ");
    for (const a of current) {
      if (a.k === "edit") { try { w.sessions[a.i]!.transact(a.ops); console.log(`c${a.i} edit`, brief(a.ops)); } catch { /* skipped */ } }
      else if (a.k === "undo") { try { console.log("BEFORE UNDO has 4898:", JSON.stringify(w.sessions[a.i]!.state).includes("b_c1_4898"), "has 4897:", JSON.stringify(w.sessions[a.i]!.state).includes("b_c1_4897"), "status", w.syncs[a.i]!.status, "unsynced", w.syncs[a.i]!.unsynced); w.sessions[a.i]!.undo(); console.log(`c${a.i} undo`); } catch (e) { console.log(`c${a.i} undo THREW`, (e as Error).message); } }
      else if (a.k === "redo") { try { w.sessions[a.i]!.redo(); console.log(`c${a.i} redo`); } catch (e) { console.log(`c${a.i} redo THREW`, (e as Error).message); } }
      else if (a.k === "serve") { const q = w.net.up[0]; await w.net.serve(a.which); console.log("serve", q ? `from c${q.from}` : "(nothing)"); }
      else w.net.deliver(a.i);
    }
    await w.net.settle();
    for (const e of (await w.store.entries("room", 0)) ?? []) console.log(`ENTRY v${e.version} from ${e.client.slice(-4)}${e.dropped ? " DROPPED" : ""}`, brief(e.ops));
  }
  console.log(JSON.stringify(current.map((a) => (a.k === "edit" ? { ...a, ops: a.ops.map((o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "rows" ? `rows(${(v as unknown[]).length})` : v)))) } : a)), null, 1));
});
