import { ActivityFeed, ShareClient, VersionHistory } from "@pli.dev/core";
import { CollabRoom, DocumentSession, SyncClient, Users, createDoc, docSyncModel, docVersionSupport, socketTransport, type DocAnchor, type Doc, type DocOp, type PliUser, type Selection } from "@pli.dev/docs";
import { Teammate } from "./bots";
import { openSocket, serverCommentStore, serverSharingStore, serverVersionStorage } from "./connection";
import { ME, TEAM, GUESTS, directory } from "./people";
import { routePath } from "../router";
import { WireLog, loggedStore, loggedTransport } from "./wire";

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(list: readonly T[]): T => list[rand(list.length)]!;

/**
 * Everything the collaboration lab is made of. It is all real: a connection to the playground's collaboration server,
 * your own copy of the document kept in step by a `SyncClient`, and simulated teammates who each have a connection,
 * a copy and a sync client of their own. The URL carries the room (`?room=`), and `?guest=1&user=mia` makes a tab someone
 * you invited, which has no teammates of its own: it meets the ones in the tab that invited it.
 */
export class Lab {
  readonly guest: boolean;
  readonly me: PliUser;
  readonly roomName: string;
  readonly wire = new WireLog();
  readonly socket = openSocket();
  readonly session: DocumentSession;
  readonly room: CollabRoom<DocAnchor>;
  readonly sync: SyncClient<Doc, DocOp, Selection | null>;
  /** Who the document is shared with, kept by the server like the comments. */
  readonly share: ShareClient;
  /** Named versions of the document, kept by the server. */
  readonly history: VersionHistory<Doc, DocOp>;
  /** What happened in the document: comments, mentions, edits. */
  readonly activity: ActivityFeed;
  readonly teammates: Teammate[] = [];
  #autopilot = true;
  #pace = 1;
  #network: "connecting" | "online" | "offline" | "unreachable" = "connecting";
  #everConnected = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<() => void>();
  #snapshot: { autopilot: boolean; pace: number; network: Lab["network"] } = { autopilot: true, pace: 1, network: "connecting" };

  constructor() {
    const params = new URLSearchParams(location.search);
    this.guest = params.get("guest") === "1";
    const wanted = params.get("user")?.toLowerCase();
    this.me = this.guest ? (GUESTS.find((g) => g.id === `u_${wanted}` || g.name.toLowerCase().startsWith(wanted ?? "\0")) ?? GUESTS[0]!) : ME;
    this.roomName = params.get("room") ?? `lab-${Math.random().toString(36).slice(2, 7)}`;
    if (!params.get("room")) {
      const url = new URL(location.href);
      url.searchParams.set("room", this.roomName);
      history.replaceState(null, "", url);
    }

    const users = new Users(directory(this.me));
    // Comments live in the server's "database", and the log shows what it is asked to save, as your own store would be.
    const store = loggedStore(serverCommentStore(this.socket, this.roomName), this.wire);
    // The document is a placeholder until the server's copy arrives.
    this.session = new DocumentSession(createDoc("", []), { comments: { users, store, synced: true } });
    this.room = new CollabRoom<DocAnchor>({ room: this.roomName, transport: loggedTransport(socketTransport(this.socket), this.wire), users });
    this.sync = new SyncClient<Doc, DocOp, Selection | null>({ session: this.session, room: this.room, model: docSyncModel, verifyEvery: 30_000 });

    this.share = new ShareClient({
      file: this.roomName,
      users,
      store: serverSharingStore(this.socket, this.roomName),
      // The person who opened the lab owns the document; a guest is given a role by whoever shared it.
      initial: { owner: this.guest ? undefined : this.me.id, grants: [], link: { enabled: false, role: "viewer" } },
      linkUrl: () => this.invitationLink(),
    });
    this.history = new VersionHistory<Doc, DocOp>({
      file: this.roomName,
      session: this.session,
      storage: serverVersionStorage<Doc>(this.socket, this.roomName),
      users,
      support: docVersionSupport,
      hash: docSyncModel.hash,
      version: () => this.sync.version,
    });
    this.activity = new ActivityFeed({ file: this.roomName, users });
    this.activity.trackComments(this.session.comments!);

    this.socket.on("connect", () => {
      this.#everConnected = true;
      this.sync.setOnline(true);
      this.#setNetwork("online");
    });
    this.socket.on("disconnect", (reason) => {
      this.sync.setOnline(false);
      this.#setNetwork(reason === "io client disconnect" ? "offline" : this.#everConnected ? "offline" : "unreachable");
    });
    this.socket.on("connect_error", () => this.#setNetwork(this.#everConnected ? "offline" : "unreachable"));

    if (!this.guest) {
      for (const user of TEAM) this.teammates.push(new Teammate(user, this.roomName, (socket) => serverCommentStore(socket, this.roomName)));
      // When you comment, someone answers.
      this.session.comments!.onChange((change, origin) => {
        if (origin !== "local") return;
        const thread = change.type === "thread.create" ? change.thread.id : change.type === "comment.add" ? change.threadId : null;
        if (!thread) return;
        const here = this.teammates.filter((t) => t.here);
        if (here.length > 0) setTimeout(() => void pick(here).reply(thread), 1400 + rand(1600));
      });
    }
  }

  get snapshot() {
    return this.#snapshot;
  }

  get network() {
    return this.#network;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  /** Connects, brings the first teammates in a moment apart, and starts them doing things. */
  start(): void {
    this.socket.connect();
    this.teammates[0] && void this.teammates[0].join();
    setTimeout(() => this.teammates[1] && void this.teammates[1].join(), 1500);
    this.#schedule();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const t of this.teammates) t.leave();
    this.socket.disconnect();
  }

  /** Cuts your connection, or restores it. Changes you make while cut off are kept and merged when you are back. */
  setNetwork(up: boolean): void {
    if (up) this.socket.connect();
    else this.socket.disconnect();
  }

  setAutopilot(on: boolean): void {
    this.#autopilot = on;
    this.#publish();
  }

  setPace(pace: number): void {
    this.#pace = pace;
    this.#publish();
  }

  /** Something for each teammate to do, one at a time, now and then. */
  #schedule(): void {
    const tick = () => {
      if (this.#autopilot) {
        const free = this.teammates.filter((t) => t.here && !t.busy);
        if (free.length > 0) {
          const who = pick(free);
          const roll = rand(100);
          if (roll < 40) void who.type();
          else if (roll < 65) void who.comment();
          else if (roll < 80) void who.editYourText();
        }
      }
      this.#timer = setTimeout(tick, (4500 + rand(4500)) / this.#pace);
    };
    this.#timer = setTimeout(tick, 2500);
  }

  /** A link to the same room, as someone else. It opens as a guest, in any tab or window of this browser. */
  invitationLink(): string {
    const url = new URL(location.href);
    url.search = "";
    url.hash = routePath("collaboration");
    url.searchParams.set("room", this.roomName);
    url.searchParams.set("guest", "1");
    url.searchParams.set("user", pick(GUESTS).name.split(" ")[0]!.toLowerCase());
    return url.toString();
  }

  #setNetwork(next: Lab["network"]): void {
    this.#network = next;
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = { autopilot: this.#autopilot, pace: this.#pace, network: this.#network };
    for (const listener of this.#listeners) listener();
  }
}
