import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_VERSION_NAME, ORIGINAL_VERSION_NAME, Session, Users, VersionHistory, memoryVersionStorage, type VersionSupport } from "../src";

type State = { text: string };
type Op = { type: "set"; text: string };
const reducer = {
  apply(state: State, op: Op) {
    return { state: { text: op.text }, inverse: { type: "set", text: state.text } as Op };
  },
};
const support: VersionSupport<State, Op> = { restoreOps: (current, target) => (current.text === target.text ? [] : [{ type: "set", text: target.text }]) };
const hash = (s: State) => s.text;
const editor = () => new Users({ id: "ana", name: "Ana" });

function setup(options: Partial<ConstructorParameters<typeof VersionHistory<State, Op>>[0]> = {}) {
  const session = new Session<State, Op>({ text: "one" }, reducer);
  const storage = memoryVersionStorage<State>();
  const history = new VersionHistory<State, Op>({ file: "f", session, storage, users: editor(), support, hash, ...options });
  return { session, storage, history };
}

describe("restoring a version", () => {
  it("keeps the version, what was there before, and the restore as a version of its own", async () => {
    const { session, history } = setup();
    await history.ready;
    const first = await history.save("First");
    session.transact([{ type: "set", text: "two" }]);
    await history.restore(first.id);
    expect(session.state.text).toBe("one");
    const names = history.versions.map((v) => v.name).sort();
    expect(names).toEqual(['Before restoring "First"', "First", 'Restored "First"']);
    const restored = history.versions.find((v) => v.name.startsWith("Restored"))!;
    expect(restored.automatic).toBe(true);
    expect(restored.state).toEqual({ text: "one" });
    expect(history.versions.find((v) => v.name.startsWith("Before"))!.state).toEqual({ text: "two" });
  });

  it("makes no new version when the file already is that version", async () => {
    const { history } = setup();
    await history.ready;
    const v = await history.save("Same");
    await history.restore(v.id);
    expect(history.versions).toHaveLength(1);
  });

  it("can leave the restore out of the list", async () => {
    const { session, history } = setup({ keepAfterRestore: false });
    await history.ready;
    const first = await history.save("First");
    session.transact([{ type: "set", text: "two" }]);
    await history.restore(first.id);
    expect(history.versions.map((v) => v.name).sort()).toEqual(['Before restoring "First"', "First"]);
  });

  it("is still one undo step", async () => {
    const { session, history } = setup();
    await history.ready;
    const first = await history.save("First");
    session.transact([{ type: "set", text: "two" }]);
    await history.restore(first.id);
    session.undo();
    expect(session.state.text).toBe("two");
  });
});

describe("autoSave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the file as it was first opened, once", async () => {
    const { history } = setup({ autoSave: { every: 1000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(history.versions.map((v) => v.name)).toEqual([ORIGINAL_VERSION_NAME]);
    expect(history.versions[0]!.automatic).toBe(true);
    history.dispose();
  });

  it("keeps a version once changes have been quiet for the time asked, with everything done in between", async () => {
    const { session, history } = setup({ autoSave: { every: 1000, baseline: false } });
    await vi.advanceTimersByTimeAsync(0);
    session.transact([{ type: "set", text: "two" }]);
    await vi.advanceTimersByTimeAsync(500);
    session.transact([{ type: "set", text: "three" }]);
    expect(history.versions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]).toMatchObject({ name: AUTO_VERSION_NAME, automatic: true, by: "ana", state: { text: "three" } });
    history.dispose();
  });

  it("does not keep the same file twice, and keeps nothing when nothing changed", async () => {
    const { session, history } = setup({ autoSave: { every: 1000, baseline: false } });
    await vi.advanceTimersByTimeAsync(0);
    session.transact([{ type: "set", text: "two" }]);
    await vi.advanceTimersByTimeAsync(1100);
    session.transact([{ type: "set", text: "three" }]);
    session.transact([{ type: "set", text: "two" }]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(history.versions).toHaveLength(1);
    history.dispose();
  });

  it("keeps only the newest few, and never removes versions people named", async () => {
    const { session, history } = setup({ autoSave: { every: 100, keep: 2, baseline: false } });
    await vi.advanceTimersByTimeAsync(0);
    await history.save("Named");
    for (const text of ["a", "b", "c", "d"]) {
      session.transact([{ type: "set", text }]);
      await vi.advanceTimersByTimeAsync(150);
    }
    const autos = history.versions.filter((v) => v.name === AUTO_VERSION_NAME);
    expect(autos.map((v) => v.state.text)).toEqual(["d", "c"]);
    expect(history.versions.some((v) => v.name === "Named")).toBe(true);
    history.dispose();
  });

  it("does nothing for someone who may not save versions", async () => {
    const viewer = new Users({ current: { id: "v", name: "V" }, role: "viewer" });
    const { session, history } = setup({ users: viewer, autoSave: { every: 100 } });
    await vi.advanceTimersByTimeAsync(0);
    session.transact([{ type: "set", text: "two" }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(history.versions).toHaveLength(0);
    history.dispose();
  });

  it("stops when disposed", async () => {
    const { session, history } = setup({ autoSave: { every: 100, baseline: false } });
    await vi.advanceTimersByTimeAsync(0);
    history.dispose();
    session.transact([{ type: "set", text: "two" }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(history.versions).toHaveLength(0);
  });
});
