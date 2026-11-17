import { applyCommentChange, changeThreadId, type CommentChange, type CommentClient, type CommentStore, type Thread } from "./comments";
import type { ChangeEvent } from "./session";

/**
 * Keeping comment threads inside the file itself, which every editor that stores them there does the same way: the file has
 * a map of threads by id, a change to a thread rewrites that one entry, and undoing or reloading the file reloads the
 * comments. These are the two pieces; each editor says only how it reads and writes its own map (a document's `set_thread`
 * operation, a PDF's) and what a deleted thread takes with it.
 */

/**
 * A `CommentStore` over a file's own thread map. `threads()` reads them, and `write(id, thread)` replaces one (`null`
 * removes it); how that is written (usually an operation that is not an undo step) is the editor's choice.
 */
export function commentStoreInFile<A>(source: { threads(): readonly Thread<A>[]; write(id: string, thread: Thread<A> | null): void }): CommentStore<A> {
  const all = () => [...source.threads()].sort((a, b) => a.createdAt - b.createdAt);
  return {
    load: () => all(),
    save(_file, change: CommentChange<A>) {
      const id = changeThreadId(change);
      source.write(id, applyCommentChange(all(), change).find((t) => t.id === id) ?? null);
    },
  };
}

/**
 * Reloads a client's threads from the file when the file was replaced (opened, or reloaded from a server) or when undo or
 * redo changed a thread that is saved in it. `touchesThread` says which operations are the editor's thread operations.
 * Returns a function that stops.
 */
export function reloadCommentsOnHistory<State, Op>(
  client: Pick<CommentClient<any>, "reload">,
  session: { subscribe(listener: (event: ChangeEvent<State, Op, any>) => void): () => void },
  touchesThread: (op: Op) => boolean,
): () => void {
  return session.subscribe((event) => {
    if (event.reset || ((event.origin === "undo" || event.origin === "redo") && event.ops.some(touchesThread))) void client.reload();
  });
}
