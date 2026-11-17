import { createId } from "./ids";
import type { CommentChange, CommentClient } from "./comments";
import type { PliUser, Users } from "./users";

/**
 * A pipe to the other people in a room. That is all Pli asks of your realtime stack: carry this JSON to
 * everyone else who joined the same `room`. Socket.io, a WebSocket server, Redis pub/sub behind either of
 * them, Ably, Pusher, a BroadcastChannel between tabs: each is a few lines (see the ones below).
 *
 * A transport never has to understand the messages, order them or keep them. It may deliver a message back
 * to its sender; the room ignores its own.
 */
export interface Transport {
  /** Joins `room` and starts calling `receive` with everything other people send to it. */
  connect(room: string, receive: (data: unknown) => void): void | Promise<void>;
  /** Sends to everyone else in the room. */
  send(data: unknown): void;
  /** Leaves the room. */
  disconnect(): void;
}

/** What a person is doing right now. Each editor decides what goes in `state`: a document puts its selection there. */
export type PresenceState = Record<string, unknown>;

/** Everything a room sends. The wire format is JSON, and `v` is its version. */
export type RoomMessage<Anchor = unknown> =
  | { type: "presence"; user: PliUser; state: PresenceState | null }
  /** Asks everyone to announce themselves again; sent when joining. */
  | { type: "hello" }
  | { type: "comment"; change: CommentChange<Anchor> }
  /** Something another editor module needs to send: its `kind` says who reads it. */
  | { type: "custom"; kind: string; data: unknown };

/** What actually crosses the pipe. */
export interface Envelope<Anchor = unknown> {
  v: 1;
  /** The sender's id for this connection (not a user id: one user may have several tabs). */
  client: string;
  message: RoomMessage<Anchor>;
}

export interface Peer {
  /** This connection's id. */
  client: string;
  user: PliUser;
  state: PresenceState;
  /** When we last heard from them, in milliseconds since 1970. */
  seen: number;
}

export type RoomStatus = "idle" | "connecting" | "connected";

export interface CollabRoomOptions<A = unknown> {
  /** Everyone in the same room sees each other. Usually the file's id. */
  room: string;
  transport: Transport;
  users: Users;
  /**
   * Comments to share: local changes are sent to the room, and changes from the room are applied. Optional
   * here because an editor that has comments (`PliDocument`) attaches its own with `attachComments`.
   */
  comments?: CommentClient<A>;
  /** How often to say we are still here, in milliseconds. Default 10 seconds. */
  heartbeat?: number;
  /** How long without a message before someone is taken to have gone. Default 3 times the heartbeat. */
  timeout?: number;
}

type Listener = () => void;

/**
 * Presence and comment sync over a `Transport`. Connect it, tell it what you are doing with `setPresence`,
 * and read `peers` to see who else is here. Another editor module (a sheet, a board) can send its own
 * messages with `sendCustom` and listen with `onCustom`.
 */
export class CollabRoom<A = unknown> {
  readonly client = createId("c_");
  #options: CollabRoomOptions<A>;
  #peers = new Map<string, Peer>();
  #state: PresenceState = {};
  #status: RoomStatus = "idle";
  #listeners = new Set<Listener>();
  #custom = new Map<string, Set<(data: unknown, from: Peer | null) => void>>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #comments: CommentClient<A> | null = null;
  #unwatchComments: (() => void) | null = null;
  #snapshot: readonly Peer[] = [];
  /** Counts connects and disconnects, so one that was undone while it waited doesn't carry on. */
  #turn = 0;

  constructor(options: CollabRoomOptions<A>) {
    this.#options = options;
    if (options.comments) this.attachComments(options.comments);
  }

  /** Shares a file's comments through this room, in place of any attached before. Pass null to stop. */
  attachComments(comments: CommentClient<A> | null): void {
    this.#unwatchComments?.();
    this.#comments = comments;
    this.#unwatchComments = comments?.onOutgoing((change) => this.#status === "connected" && this.#send({ type: "comment", change })) ?? null;
  }

  get status(): RoomStatus {
    return this.#status;
  }

  /** The other people here, oldest arrival first. Not including you. */
  get peers(): readonly Peer[] {
    return this.#snapshot;
  }

  async connect(): Promise<void> {
    if (this.#status !== "idle") return;
    this.#status = "connecting";
    this.#emit();
    const turn = ++this.#turn;
    const { transport, room } = this.#options;
    await transport.connect(room, (data) => this.#receive(data));
    // Disconnected (and maybe connected again) while the transport was getting ready: that other call owns the room now.
    if (turn !== this.#turn) return;
    this.#status = "connected";
    this.#send({ type: "hello" });
    this.#announce();
    const beat = this.#options.heartbeat ?? 10_000;
    this.#timer = setInterval(() => {
      this.#announce();
      this.#expire();
    }, beat);
    this.#emit();
  }

  disconnect(): void {
    if (this.#status === "idle") return;
    this.#turn++;
    if (this.#status === "connected") this.#send({ type: "presence", user: this.#me() ?? { id: "", name: "" }, state: null });
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#options.transport.disconnect();
    this.#peers.clear();
    this.#snapshot = [];
    this.#status = "idle";
    this.#emit();
  }

  /** Tells everyone what you are doing now. Replaces what you said before. */
  setPresence(state: PresenceState): void {
    this.#state = state;
    if (this.#status === "connected") this.#announce();
  }

  /** Rewrites what each peer has said about themselves (their cursor), for when the document changed under it. */
  mapPresence(fn: (state: PresenceState) => PresenceState): void {
    let changed = false;
    for (const peer of this.#peers.values()) {
      const next = fn(peer.state);
      if (next !== peer.state) {
        peer.state = next;
        changed = true;
      }
    }
    if (changed) this.#refresh();
  }

  /** Sends a message for another module to read, such as a sheet sending the cell being edited. */
  sendCustom(kind: string, data: unknown): void {
    this.#send({ type: "custom", kind, data });
  }

  /** Listens for messages of one `kind` from `sendCustom`. */
  onCustom(kind: string, listener: (data: unknown, from: Peer | null) => void): () => void {
    const set = this.#custom.get(kind) ?? new Set();
    this.#custom.set(kind, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #me(): PliUser | null {
    return this.#options.users.current;
  }

  #send(message: RoomMessage<A>): void {
    this.#options.transport.send({ v: 1, client: this.client, message } satisfies Envelope<A>);
  }

  #announce(): void {
    const user = this.#me();
    if (user) this.#send({ type: "presence", user, state: this.#state });
  }

  #receive(data: unknown): void {
    const envelope = data as Partial<Envelope<A>> | null;
    if (!envelope || envelope.v !== 1 || typeof envelope.client !== "string" || !envelope.message) return;
    if (envelope.client === this.client) return;
    const { client, message } = envelope as Envelope<A>;
    switch (message.type) {
      case "hello":
        this.#announce();
        break;
      case "presence":
        if (message.state === null) {
          if (this.#peers.delete(client)) this.#refresh();
        } else if (message.user?.id) {
          this.#options.users.add([message.user]);
          this.#peers.set(client, { client, user: message.user, state: message.state, seen: Date.now() });
          this.#refresh();
        }
        break;
      case "comment":
        this.#comments?.receive(message.change);
        break;
      case "custom": {
        const from = this.#peers.get(client) ?? null;
        for (const listener of this.#custom.get(message.kind) ?? []) listener(message.data, from);
        break;
      }
    }
  }

  #expire(): void {
    const timeout = this.#options.timeout ?? (this.#options.heartbeat ?? 10_000) * 3;
    const now = Date.now();
    let removed = false;
    for (const [client, peer] of this.#peers) {
      if (now - peer.seen > timeout) {
        this.#peers.delete(client);
        removed = true;
      }
    }
    if (removed) this.#refresh();
  }

  #refresh(): void {
    this.#snapshot = [...this.#peers.values()];
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

// ---- Ready-made transports ------------------------------------------------------------------------

/** An in-process hub, for tests and demos: every transport made from the same hub is in the same rooms. */
export function memoryHub(): { transport(): Transport } {
  const rooms = new Map<string, Set<{ receive: (data: unknown) => void }>>();
  return {
    transport() {
      let joined: { room: string; member: { receive: (data: unknown) => void } } | null = null;
      return {
        connect(room, receive) {
          const member = { receive };
          const members = rooms.get(room) ?? new Set();
          rooms.set(room, members);
          members.add(member);
          joined = { room, member };
        },
        send(data) {
          if (!joined) return;
          // A copy, as if it had crossed a wire.
          const copy = JSON.parse(JSON.stringify(data)) as unknown;
          for (const member of rooms.get(joined.room) ?? []) if (member !== joined.member) member.receive(copy);
        },
        disconnect() {
          if (joined) rooms.get(joined.room)?.delete(joined.member);
          joined = null;
        },
      };
    },
  };
}

/** Same-origin tabs and windows, with no server. Good for a demo, and for an app that only runs on one machine. */
export function broadcastChannelTransport(prefix = "pli:"): Transport {
  let channel: { postMessage(data: unknown): void; close(): void; onmessage: ((event: { data: unknown }) => void) | null } | null = null;
  return {
    connect(room, receive) {
      const Channel = (globalThis as unknown as { BroadcastChannel?: new (name: string) => NonNullable<typeof channel> }).BroadcastChannel;
      if (!Channel) throw new Error("BroadcastChannel isn't available here");
      channel = new Channel(prefix + room);
      channel.onmessage = (event) => receive(event.data);
    },
    send: (data) => channel?.postMessage(data),
    disconnect() {
      channel?.close();
      channel = null;
    },
  };
}

/** The part of a socket.io client (or anything shaped like one) that `socketTransport` uses. */
export interface SocketLike {
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
}

export interface SocketTransportOptions {
  /** The event messages travel on. Default `"pli"`. */
  event?: string;
  /** The event that asks the server to put this socket in a room. Default `"pli:join"`. */
  joinEvent?: string;
  /** The event that takes it out again. Default `"pli:leave"`. */
  leaveEvent?: string;
}

/**
 * Socket.io, or any client with `emit` and `on`. Your server puts the socket in the room on `pli:join` and
 * passes `pli` messages on to the rest of the room; the docs show the few lines it takes, with a Redis
 * adapter behind it if you run more than one server.
 */
export function socketTransport(socket: SocketLike, options: SocketTransportOptions = {}): Transport {
  const event = options.event ?? "pli";
  const joinEvent = options.joinEvent ?? "pli:join";
  const leaveEvent = options.leaveEvent ?? "pli:leave";
  let room: string | null = null;
  let listener: ((room: string, data: unknown) => void) | null = null;
  let rejoin: (() => void) | null = null;
  return {
    connect(name, receive) {
      room = name;
      listener = (from, data) => {
        if (from === room) receive(data);
      };
      socket.on(event, listener);
      // A socket that reconnects is a new connection to the server, which has to be told again which room it is in.
      rejoin = () => void socket.emit(joinEvent, name);
      socket.on("connect", rejoin);
      socket.emit(joinEvent, name);
    },
    send(data) {
      if (room) socket.emit(event, room, data);
    },
    disconnect() {
      if (listener) socket.off?.(event, listener);
      if (rejoin) socket.off?.("connect", rejoin);
      if (room) socket.emit(leaveEvent, room);
      room = null;
      listener = null;
      rejoin = null;
    },
  };
}

/** The part of a browser WebSocket that `webSocketTransport` uses. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * A plain WebSocket. Every message is the JSON text `{"room": ..., "data": ...}`, and a message with
 * `"join": true` asks the server to put the socket in that room. The server passes the rest to the room.
 */
export function webSocketTransport(socket: WebSocketLike): Transport {
  let room: string | null = null;
  let handler: ((event: { data: unknown }) => void) | null = null;
  const write = (payload: unknown) => socket.readyState === 1 && socket.send(JSON.stringify(payload));
  return {
    connect(name, receive) {
      room = name;
      handler = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as { room?: string; data?: unknown };
          if (parsed.room === room) receive(parsed.data);
        } catch {
          // Not ours.
        }
      };
      socket.addEventListener("message", handler);
      write({ room: name, join: true });
    },
    send: (data) => room && write({ room, data }),
    disconnect() {
      if (handler) socket.removeEventListener("message", handler);
      if (room) write({ room, leave: true });
      room = null;
      handler = null;
    },
  };
}
