import {
  mentionText,
  CollabRoom,
  DocumentSession,
  SyncClient,
  Users,
  createDoc,
  docSyncModel,
  socketTransport,
  textLength,
  type Block,
  type CommentClient,
  type CommentStore,
  type Doc,
  type DocAnchor,
  type DocOp,
  type PliUser,
  type Run,
  type Selection,
} from "@pli.dev/docs";
import type { Socket } from "socket.io-client";
import { openSocket } from "./connection";
import { ME, directory } from "./people";
import { NOTES } from "./starter";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(list: readonly T[]): T => list[rand(list.length)]!;

const SENTENCES: Record<string, string[]> = {
  u_ben: ["The export API is mostly a matter of choosing formats.", "I can size it by Thursday if we drop the PDF option.", "Worth asking support what customers actually export today."],
  u_cleo: ["Settings feedback so far: people can't find the billing page.", "Three users asked for a dark mode toggle.", "I'll book interviews for next week."],
  u_dev: ["The editor is fast enough; layout is the part to profile.", "A public API means versioning from day one.", "I'd like one owner per project, not two."],
};

const PHRASES = ["really ", "(as discussed) ", "in practice ", "for now ", "— to be clear — "];

const COMMENTS = [
  "Can we make this more specific?",
  "Nice. Maybe add an example here?",
  "Is this still accurate?",
  "Love this line.",
  "Could we link a source for this?",
  "Should this be a decision or a question?",
];

const REPLIES = {
  question: ["Good question. I think so, yes.", "Not sure. Let's check with the team.", "Short answer: yes. I'll add the detail."],
  fix: ["Fixed, thanks!", "Good catch. Updated.", "Done."],
  other: ["Agreed.", "Makes sense to me.", "I'll pick this up.", "Thanks, added to my list."],
};

/** Words of a text block, as [start, end) offsets. */
function words(text: string): [number, number][] {
  return [...text.matchAll(/\S+/g)].map((m) => [m.index!, m.index! + m[0].length]);
}

const textOf = (runs: readonly Run[]) => runs.map((r) => r.text).join("");

/**
 * A simulated person. It is a real participant: its own connection to the server, its own copy of the document, its own
 * sync client, comment client and cursor. When it types, edits or comments, it does so in its own copy, and the changes
 * reach you through the server like anyone else's, merged with whatever you are typing at the same time.
 */
export class Teammate {
  readonly session: DocumentSession;
  readonly room: CollabRoom<DocAnchor>;
  readonly sync: SyncClient<Doc, DocOp, Selection | null>;
  readonly socket: Socket;
  here = false;
  status = "Away";
  #busy = false;
  #wanderTimer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<() => void>();
  #snapshot = { here: false, status: "Away" };

  constructor(readonly user: PliUser, roomName: string, makeStore: (socket: Socket) => CommentStore<DocAnchor>) {
    const users = new Users(directory(user));
    this.socket = openSocket();
    this.session = new DocumentSession(createDoc("", []), { comments: { users, store: makeStore(this.socket), synced: true } });
    this.room = new CollabRoom<DocAnchor>({ room: roomName, transport: socketTransport(this.socket), users, comments: this.session.comments! });
    this.sync = new SyncClient<Doc, DocOp, Selection | null>({ session: this.session, room: this.room, model: docSyncModel, verifyEvery: 30_000 });
    this.socket.on("disconnect", () => this.sync.setOnline(false));
    this.socket.on("connect", () => this.sync.setOnline(true));
  }

  get comments(): CommentClient<DocAnchor> {
    return this.session.comments!;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  async join(): Promise<void> {
    if (this.here) return;
    this.here = true;
    this.#set("Looking around");
    this.socket.connect();
    await this.room.connect();
    this.sync.start();
    this.#wander();
  }

  leave(): void {
    if (!this.here) return;
    this.here = false;
    if (this.#wanderTimer) clearTimeout(this.#wanderTimer);
    this.#wanderTimer = null;
    this.sync.stop();
    this.room.disconnect();
    this.socket.disconnect();
    this.#set("Away");
  }

  /** Types a sentence into this teammate's own paragraph in the notes, a letter at a time, with the odd typo. */
  async type(sentence = pick(SENTENCES[this.user.id] ?? ["Noted."])): Promise<void> {
    const id = NOTES[this.user.id];
    if (!this.here || this.#busy || !id) return;
    this.#busy = true;
    this.#set("Typing…");
    try {
      // The paragraph is a notebook, not a novel: start over once it gets long.
      const block = this.#block(id);
      const label = block ? textOf(block.runs).indexOf(": ") + 2 : 0;
      if (block && textLength(block.runs) > 320 && label > 1) this.#apply({ type: "delete_text", block: id, from: label, to: textLength(block.runs) });
      const prefix = block && textLength(block.runs) > label ? " " : "";
      for (const [i, letter] of [...(prefix + sentence)].entries()) {
        if (!this.here) return;
        if (i > 4 && rand(30) === 0) {
          this.#append(id, pick([..."qwxz"]));
          await sleep(220);
          this.#backspace(id);
          await sleep(120);
        }
        this.#append(id, letter);
        await sleep(30 + rand(70));
      }
    } finally {
      this.#busy = false;
      if (this.here) this.#set("Looking around");
    }
  }

  /** Puts a short phrase into the middle of one of your paragraphs. Your caret stays with your text. */
  async editYourText(): Promise<void> {
    const target = this.#pickParagraph();
    if (!this.here || this.#busy || !target) return;
    this.#busy = true;
    try {
      const text = textOf(target.runs);
      const at = pick(words(text))[0];
      this.#set("Editing a paragraph…");
      this.#show(target.id, at);
      await sleep(900);
      let position = at;
      for (const letter of pick(PHRASES)) {
        if (!this.here) return;
        const live = this.#block(target.id);
        if (!live) return;
        position = Math.min(position, textLength(live.runs));
        this.#apply({ type: "insert_text", block: target.id, offset: position, runs: [{ text: letter }] });
        position++;
        this.#show(target.id, position);
        await sleep(45 + rand(60));
      }
    } finally {
      this.#busy = false;
      if (this.here) this.#set("Looking around");
    }
  }

  /** Selects a few words, then starts a comment thread on them. */
  async comment(): Promise<void> {
    const target = this.#pickParagraph();
    if (!this.here || this.#busy || !target) return;
    this.#busy = true;
    try {
      const text = textOf(target.runs);
      const all = words(text);
      const first = rand(Math.max(1, all.length - 3));
      const span = all.slice(first, first + 1 + rand(3));
      const from = span[0]![0];
      const to = span[span.length - 1]![1];
      this.#set("Reading closely…");
      this.#show(target.id, from, to);
      await sleep(1400);
      if (!this.here || !this.#block(target.id)) return;
      this.#set("Commenting…");
      this.session.comment(pick(COMMENTS), { anchor: { block: target.id, offset: from }, focus: { block: target.id, offset: to } });
      await sleep(600);
    } finally {
      this.#busy = false;
      if (this.here) this.#set("Looking around");
    }
  }

  /** Replies to a thread, and sometimes resolves it. */
  async reply(threadId: string): Promise<void> {
    if (!this.here) return;
    const thread = this.comments.thread(threadId);
    if (!thread || thread.resolved) return;
    const last = thread.comments[thread.comments.length - 1]!;
    if (last.author === this.user.id) return;
    this.#set("Replying…");
    await sleep(900 + rand(900));
    const body = last.body;
    const kind = /\b(typo|fix|wrong|change|update)\b/i.test(body) ? "fix" : /\?/.test(body) ? "question" : "other";
    try {
      const answer = pick(REPLIES[kind]);
      // When the person who wrote last is the one at the keyboard, answer them by name now and then.
      const to = this.comments.users.get(last.author);
      if (last.author === ME.id && rand(10) < 6) this.comments.reply(threadId, `${mentionText(to)} ${answer}`, [to.id]);
      else this.comments.reply(threadId, answer);
      if (kind === "fix" && rand(10) < 7) {
        await sleep(1200);
        this.comments.resolve(threadId);
      }
    } catch {
      // The thread went away while we were typing.
    }
    if (this.here) this.#set("Looking around");
  }

  // ---- Helpers -------------------------------------------------------------------------------------------

  get busy(): boolean {
    return this.#busy;
  }

  #block(id: string): Extract<Block, { runs: Run[] }> | undefined {
    const b = this.session.state.blocks.find((x) => x.id === id);
    return b && "runs" in b ? (b as Extract<Block, { runs: Run[] }>) : undefined;
  }

  /** One of the document's real paragraphs: not the notes, with enough text to be worth talking about. */
  #pickParagraph(): Extract<Block, { runs: Run[] }> | undefined {
    const notes = new Set(Object.values(NOTES));
    const options = this.session.state.blocks.filter((b): b is Extract<Block, { runs: Run[] }> => b.type === "paragraph" && !notes.has(b.id) && textLength(b.runs) > 60);
    return options.length > 0 ? pick(options) : undefined;
  }

  #apply(op: Parameters<DocumentSession["transact"]>[0][number]): void {
    this.session.transact([op]);
  }

  #append(id: string, letter: string): void {
    const block = this.#block(id);
    if (!block) return;
    const at = textLength(block.runs);
    this.#apply({ type: "insert_text", block: id, offset: at, runs: [{ text: letter }] });
    this.#show(id, at + 1);
  }

  #backspace(id: string): void {
    const block = this.#block(id);
    const length = block ? textLength(block.runs) : 0;
    if (length === 0) return;
    this.#apply({ type: "delete_text", block: id, from: length - 1, to: length });
    this.#show(id, length - 1);
  }

  /** Shows this teammate's cursor (or selection) in a block. */
  #show(block: string, from: number, to = from): void {
    const selection: Selection = { anchor: { block, offset: from }, focus: { block, offset: to } };
    this.room.setPresence({ selection });
  }

  /** Between actions, the cursor drifts around the page now and then. */
  #wander(): void {
    const tick = () => {
      if (!this.here) return;
      if (!this.#busy) {
        const target = this.#pickParagraph();
        if (target) {
          const all = words(textOf(target.runs));
          const span = pick(all);
          this.#show(target.id, span[0], rand(3) === 0 ? span[1] : span[0]);
        }
      }
      this.#wanderTimer = setTimeout(tick, 1800 + rand(2600));
    };
    this.#wanderTimer = setTimeout(tick, 400);
  }

  #set(status: string): void {
    this.status = status;
    this.#snapshot = { here: this.here, status };
    for (const listener of this.#listeners) listener();
  }
}
