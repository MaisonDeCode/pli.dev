import type { CollabRoom, Peer, PresenceState } from "./collab";
import type { PliUser } from "./users";
import { userColor } from "./users";

/**
 * Helpers for presence: who is here, in what colour, how active, and what they are pointing at. They sit on top of
 * `CollabRoom.setPresence` and `CollabRoom.peers`, which every editor already shares; an editor decides what goes in the
 * presence state, and these types are what the shared interface (avatars, cursors, outlines) reads when it is there.
 */

// ---- Payloads -------------------------------------------------------------------------------------------------

/** A pointer: where a person's mouse is. The surface is the page, sheet or slide it is on, so it can be drawn on that one only. */
export interface PresenceCursor {
  /** The id of the page, sheet or slide, when the editor has more than one surface. */
  surface?: string;
  /** Coordinates in the editor's own space (page points, cell grid units, slide units), not screen pixels. */
  x: number;
  y: number;
}

/** What a person has selected, in terms the editor's own interface can draw: ids of things, or a range. */
export interface PresenceSelection {
  surface?: string;
  /** Ids of selected objects (annotations, slide elements, form fields). */
  ids?: string[];
  /** A range, in the editor's own addressing (a text range `{ anchor, focus }`, a cell range `"B2:C5"`). */
  range?: unknown;
}

export type PresenceActivity = "active" | "idle" | "away";

/**
 * The shape the shared interface understands. Every field is optional and an editor may add its own beside them: the
 * presence state is a free-form JSON object, and an editor that has its own fields (`selection` for a document, `page`
 * and `tool` for a PDF) keeps them.
 */
export interface PresencePayload extends PresenceState {
  /** The surface the person is looking at: a page, a sheet, a slide. */
  surface?: string | null;
  cursor?: PresenceCursor | null;
  selection?: unknown;
  /** The thing being edited right now (a cell address, a text box id): shown as an outline in the person's colour. */
  editing?: string | null;
  /** What `IdleTracker` says. */
  activity?: PresenceActivity;
  /** When they last did something, in milliseconds since 1970. */
  lastActive?: number;
}

// ---- Colours --------------------------------------------------------------------------------------------------

/** Colours that are easy to tell apart on white and dark backgrounds, in the order they are handed out. */
export const PRESENCE_PALETTE: readonly string[] = [
  "#1a73e8", "#d93025", "#188038", "#e37400", "#a142f4", "#12b5cb", "#e52592", "#7baa00", "#5f6368", "#c26401", "#1967d2", "#b80672",
];

/**
 * A colour for each person in a room, such that no two people share one while the palette lasts. A person whose user has
 * its own `color` keeps it; the others are given the colour their id points at, or the next free one if another person
 * has it. The same people always get the same colours: `order` (oldest arrival first) decides who gets the contested one.
 */
export function presenceColors(users: readonly PliUser[], palette: readonly string[] = PRESENCE_PALETTE): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  // A colour the directory chose is kept. One that is only what `Users` fills in for a user with none is not: it can be swapped.
  for (const user of users) {
    if (user.color && user.color !== userColor(user.id) && !out.has(user.id)) {
      out.set(user.id, user.color);
      taken.add(user.color.toLowerCase());
    }
  }
  for (const user of users) {
    if (out.has(user.id)) continue;
    const start = hashIndex(user.id, palette.length);
    let pick = palette[start]!;
    for (let step = 0; step < palette.length; step++) {
      const candidate = palette[(start + step) % palette.length]!;
      if (!taken.has(candidate.toLowerCase())) {
        pick = candidate;
        break;
      }
    }
    out.set(user.id, pick);
    taken.add(pick.toLowerCase());
  }
  return out;
}

function hashIndex(id: string, n: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

// ---- People ---------------------------------------------------------------------------------------------------

/** One person in the room, who may have the file open in several tabs. */
export interface PresentUser {
  user: PliUser;
  /** The colour to draw them in (see `presenceColors`). */
  color: string;
  /** Their connections, oldest first. */
  peers: Peer[];
  activity: PresenceActivity;
}

export interface ActivityThresholds {
  /** Without doing anything for this long (ms) a person is idle. Default 1 minute. */
  idleAfter?: number;
  /** ...and away after this long. Default 5 minutes. */
  awayAfter?: number;
}

/** How active a connection is: from `state.activity` and `state.lastActive` if it sends them, otherwise from when we last heard from it. */
export function peerActivity(peer: Pick<Peer, "state" | "seen">, now: number = Date.now(), thresholds: ActivityThresholds = {}): PresenceActivity {
  const idleAfter = thresholds.idleAfter ?? 60_000;
  const awayAfter = thresholds.awayAfter ?? 300_000;
  const state = peer.state as PresencePayload;
  const since = typeof state.lastActive === "number" ? now - state.lastActive : now - peer.seen;
  // A connection that has stopped saying anything at all is away, whatever it last said about itself.
  const silent = now - peer.seen;
  const reported = state.activity;
  if (reported === "away" || since >= awayAfter || silent >= awayAfter) return "away";
  if (reported === "idle" || since >= idleAfter) return "idle";
  return "active";
}

const rank: Record<PresenceActivity, number> = { active: 0, idle: 1, away: 2 };

/**
 * The distinct people in a room, you left out, one entry for several tabs, in the order they arrived. Their activity is
 * that of their most active tab.
 */
export function presentUsers(peers: readonly Peer[], you?: PliUser | null, now: number = Date.now(), thresholds?: ActivityThresholds): PresentUser[] {
  const byUser = new Map<string, Peer[]>();
  for (const peer of peers) {
    if (peer.user.id === you?.id) continue;
    const list = byUser.get(peer.user.id) ?? [];
    byUser.set(peer.user.id, list);
    list.push(peer);
  }
  // You come first, so nobody else is given your colour.
  const colors = presenceColors([...(you ? [you] : []), ...[...byUser.values()].map((list) => list[0]!.user)]);
  return [...byUser.values()].map((list) => ({
    user: list[0]!.user,
    color: colors.get(list[0]!.user.id) ?? userColor(list[0]!.user.id),
    peers: list,
    activity: list.map((p) => peerActivity(p, now, thresholds)).sort((a, b) => rank[a] - rank[b])[0]!,
  }));
}

// ---- Being idle -----------------------------------------------------------------------------------------------

export interface IdleTrackerOptions extends ActivityThresholds {
  /** Called when the activity changes. */
  onChange?: (activity: PresenceActivity, lastActive: number) => void;
  now?: () => number;
}

/**
 * Watches for the person doing something. Call `touch()` on key presses, pointer moves and edits; it says `idle` and then
 * `away` when nothing has happened for a while, and `active` again at the next touch. Framework-free: the editor wires
 * `touch` to its own events (`bindActivity` does it for DOM events).
 */
export class IdleTracker {
  #options: IdleTrackerOptions;
  #activity: PresenceActivity = "active";
  #last: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #now: () => number;

  constructor(options: IdleTrackerOptions = {}) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#last = this.#now();
    this.#arm();
  }

  get activity(): PresenceActivity {
    return this.#activity;
  }

  get lastActive(): number {
    return this.#last;
  }

  /** The person did something. */
  touch(): void {
    this.#last = this.#now();
    if (this.#activity !== "active") {
      this.#activity = "active";
      this.#options.onChange?.("active", this.#last);
    }
    this.#arm();
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #arm(): void {
    if (this.#timer) clearTimeout(this.#timer);
    const idleAfter = this.#options.idleAfter ?? 60_000;
    const awayAfter = this.#options.awayAfter ?? 300_000;
    const next = this.#activity === "active" ? idleAfter : this.#activity === "idle" ? awayAfter - idleAfter : null;
    if (next === null) return;
    this.#timer = setTimeout(() => {
      this.#activity = this.#activity === "active" ? "idle" : "away";
      this.#options.onChange?.(this.#activity, this.#last);
      this.#arm();
    }, Math.max(0, next - (this.#now() - this.#last)));
  }
}

/** The part of a DOM element or window that `bindActivity` uses. */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void, options?: unknown): void;
}

/** Calls `tracker.touch` on the events that mean someone is there (keys, pointer, scroll, touch). Returns a function that stops. */
export function bindActivity(tracker: IdleTracker, target: EventSourceLike, events: readonly string[] = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]): () => void {
  const touch = () => tracker.touch();
  for (const type of events) target.addEventListener(type, touch, { passive: true });
  return () => {
    for (const type of events) target.removeEventListener(type, touch);
  };
}

// ---- Sending --------------------------------------------------------------------------------------------------

/**
 * Runs `send` at most once every `ms`, with the last request winning: the first call goes at once, calls that come while
 * waiting are folded into one that goes when the time is up. `flush` sends now what is waiting; `cancel` drops it.
 */
export function throttle(send: () => void, ms: number, now: () => number = Date.now): { call(): void; flush(): void; cancel(): void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    last = now();
    send();
  };
  return {
    call() {
      if (timer) return;
      const wait = last + ms - now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export interface PresencePublisherOptions {
  /** The shortest time between two sends, in milliseconds. Default 50, which is smooth for a pointer and kind to a server. */
  ms?: number;
  /** Adds `activity` and `lastActive` to what is sent, and sends again when the person goes idle or comes back. */
  idle?: IdleTracker;
  now?: () => number;
}

/**
 * Says what this person is doing to the room, politely: updates are merged, repeated identical ones are dropped, and no
 * more than one is sent per interval, so a pointer that moves every frame doesn't flood the transport.
 *
 *     const presence = presencePublisher(room, { idle });
 *     presence.update({ cursor: { surface: page.id, x, y } });
 *     presence.update({ selection: { ids } });
 */
export function presencePublisher(room: Pick<CollabRoom<any>, "setPresence">, options: PresencePublisherOptions = {}) {
  let state: PresencePayload = {};
  let sent = "";
  const now = options.now ?? Date.now;
  const push = () => {
    const next: PresencePayload = options.idle ? { ...state, activity: options.idle.activity, lastActive: options.idle.lastActive } : state;
    // `lastActive` changes on every touch; it is only worth sending when something else did, or the person came back.
    const key = JSON.stringify({ ...next, lastActive: undefined });
    if (key === sent) return;
    sent = key;
    room.setPresence({ ...next });
  };
  const limited = throttle(push, options.ms ?? 50, now);
  return {
    /** Merges `patch` into what is said (a key set to `undefined` is taken out) and sends it, soon. */
    update(patch: PresencePayload): void {
      const next: PresencePayload = { ...state, ...patch };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      state = next;
      limited.call();
    },
    /** Replaces everything that is said. */
    set(next: PresencePayload): void {
      state = { ...next };
      limited.call();
    },
    /** What is said now. */
    get state(): PresencePayload {
      return state;
    },
    /** Sends what is waiting, now. */
    flush(): void {
      limited.flush();
    },
    /** Another module's tracker has changed: tell the room. */
    refresh(): void {
      limited.call();
    },
    dispose(): void {
      limited.cancel();
    },
  };
}
