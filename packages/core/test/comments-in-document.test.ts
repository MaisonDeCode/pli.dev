import { describe, expect, it, vi } from "vitest";
import { CommentClient, Session, Users, commentStoreInFile, reloadCommentsOnHistory, type Thread } from "../src";

type State = { threads: Record<string, Thread<{ at: string }>>; n: number };
type Op = { type: "set_thread"; id: string; thread: Thread<{ at: string }> | null } | { type: "bump" };

const reducer = {
  apply(state: State, op: Op) {
    if (op.type === "bump") return { state: { ...state, n: state.n + 1 }, inverse: { type: "bump" } as Op };
    const old = state.threads[op.id] ?? null;
    const threads = { ...state.threads };
    if (op.thread) threads[op.id] = op.thread;
    else delete threads[op.id];
    return { state: { ...state, threads }, inverse: { type: "set_thread", id: op.id, thread: old } as Op };
  },
};

describe("comments kept in the file", () => {
  function setup() {
    const session = new Session<State, Op>({ threads: {}, n: 0 }, reducer);
    const store = commentStoreInFile<{ at: string }>({
      threads: () => Object.values(session.state.threads),
      write: (id, thread) => session.transact([{ type: "set_thread", id, thread }], { history: false }),
    });
    const client = new CommentClient<{ at: string }>({ file: "f", users: new Users({ id: "u", name: "U" }), store, initial: [] });
    return { session, client };
  }

  it("writes each change as that thread's entry, and removes a deleted one", async () => {
    const { session, client } = setup();
    await client.ready;
    const thread = client.createThread("Hi", { at: "A1" });
    await vi.waitFor(() => expect(Object.keys(session.state.threads)).toEqual([thread.id]));
    client.reply(thread.id, "Again");
    await vi.waitFor(() => expect(session.state.threads[thread.id]!.comments).toHaveLength(2));
    client.deleteThread(thread.id);
    await vi.waitFor(() => expect(session.state.threads).toEqual({}));
  });

  it("reloads the threads when the file is replaced or undo changes one, and not for other changes", async () => {
    const { session, client } = setup();
    const reload = vi.spyOn(client, "reload");
    reloadCommentsOnHistory(client, session, (op) => op.type === "set_thread");
    session.transact([{ type: "bump" }]);
    expect(reload).not.toHaveBeenCalled();
    session.transact([{ type: "set_thread", id: "t", thread: { id: "t", comments: [], createdAt: 1 } }]);
    session.undo();
    expect(reload).toHaveBeenCalledTimes(1);
    session.reset({ threads: {}, n: 0 });
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
