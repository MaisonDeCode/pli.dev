import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTracker, PRESENCE_PALETTE, bindActivity, peerActivity, presenceColors, presencePublisher, presentUsers, throttle, userColor, type Peer, type PliUser } from "../src";

const user = (id: string, extra: Partial<PliUser> = {}): PliUser => ({ id, name: id, ...extra });
const peer = (u: PliUser, extra: Partial<Peer> = {}): Peer => ({ client: `c_${u.id}`, user: u, state: {}, seen: 1_000_000, ...extra });

describe("colours", () => {
  it("gives everyone a different colour while the palette lasts, the same ones every time", () => {
    const people = Array.from({ length: PRESENCE_PALETTE.length }, (_, i) => user(`person-${i}`));
    const colors = presenceColors(people);
    expect(new Set(colors.values()).size).toBe(people.length);
    expect([...presenceColors(people).entries()]).toEqual([...colors.entries()]);
  });

  it("keeps a colour the directory chose, and swaps one that is only the default", () => {
    const chosen = user("a", { color: "#123456" });
    const defaulted = user("b", { color: userColor("b") });
    const colors = presenceColors([chosen, defaulted]);
    expect(colors.get("a")).toBe("#123456");
    expect(PRESENCE_PALETTE).toContain(colors.get("b"));
  });

  it("gives you yours first so nobody else takes it", () => {
    const you = user("you");
    const others = Array.from({ length: 6 }, (_, i) => peer(user(`o${i}`)));
    const mine = presenceColors([you]).get("you");
    expect(presentUsers(others, you).every((p) => p.color !== mine)).toBe(true);
  });
});

describe("people", () => {
  it("merges tabs, leaves you out, and takes the most active tab", () => {
    const ben = user("ben");
    const peers = [peer(user("you")), peer(ben, { client: "t1", state: { activity: "away" } }), peer(ben, { client: "t2", state: {} })];
    const people = presentUsers(peers, user("you"), 1_000_500);
    expect(people.map((p) => p.user.id)).toEqual(["ben"]);
    expect(people[0]!.peers).toHaveLength(2);
    expect(people[0]!.activity).toBe("active");
  });

  it("works out activity from what the peer says, or from when we last heard", () => {
    const now = 2_000_000;
    expect(peerActivity({ state: {}, seen: now - 1000 }, now)).toBe("active");
    expect(peerActivity({ state: { lastActive: now - 90_000 }, seen: now - 1000 }, now)).toBe("idle");
    expect(peerActivity({ state: {}, seen: now - 400_000 }, now)).toBe("away");
    expect(peerActivity({ state: { activity: "idle" }, seen: now }, now)).toBe("idle");
    expect(peerActivity({ state: { lastActive: now - 10 }, seen: now - 400_000 }, now)).toBe("away");
  });
});

describe("timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("notices when someone goes idle, then away, and comes back on a touch", () => {
    const seen: string[] = [];
    const tracker = new IdleTracker({ idleAfter: 1000, awayAfter: 5000, onChange: (a) => seen.push(a) });
    vi.advanceTimersByTime(1100);
    expect(tracker.activity).toBe("idle");
    vi.advanceTimersByTime(4000);
    expect(tracker.activity).toBe("away");
    tracker.touch();
    expect(tracker.activity).toBe("active");
    expect(seen).toEqual(["idle", "away", "active"]);
    tracker.dispose();
  });

  it("is touched by the events it is bound to", () => {
    const listeners = new Map<string, () => void>();
    const target = { addEventListener: (t: string, l: () => void) => listeners.set(t, l), removeEventListener: (t: string) => listeners.delete(t) };
    const tracker = new IdleTracker({ idleAfter: 1000, awayAfter: 5000 });
    const stop = bindActivity(tracker, target);
    vi.advanceTimersByTime(1500);
    expect(tracker.activity).toBe("idle");
    listeners.get("keydown")!();
    expect(tracker.activity).toBe("active");
    stop();
    expect(listeners.size).toBe(0);
    tracker.dispose();
  });

  it("throttles: the first goes at once and the last of a burst goes when the time is up", () => {
    const calls: number[] = [];
    let n = 0;
    const t = throttle(() => calls.push(n), 100, () => Date.now());
    n = 1;
    t.call();
    n = 2;
    t.call();
    n = 3;
    t.call();
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1, 3]);
  });

  it("publishes merged presence, drops repeats, and limits how often", () => {
    const sent: unknown[] = [];
    const room = { setPresence: (s: unknown) => void sent.push(s) };
    const presence = presencePublisher(room, { ms: 100 });
    presence.update({ cursor: { x: 1, y: 1 } });
    presence.update({ cursor: { x: 2, y: 2 } });
    presence.update({ editing: "B2" });
    expect(sent).toEqual([{ cursor: { x: 1, y: 1 } }]);
    vi.advanceTimersByTime(100);
    expect(sent[1]).toEqual({ cursor: { x: 2, y: 2 }, editing: "B2" });
    presence.update({ editing: "B2" });
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(2);
    presence.update({ editing: undefined });
    vi.advanceTimersByTime(500);
    expect(sent[2]).toEqual({ cursor: { x: 2, y: 2 } });
  });

  it("adds activity from an idle tracker and says so when it changes", () => {
    const sent: any[] = [];
    const idle = new IdleTracker({ idleAfter: 1000, awayAfter: 5000, onChange: () => presence.refresh() });
    const presence = presencePublisher({ setPresence: (s) => void sent.push(s) }, { idle, ms: 10 });
    presence.update({ surface: "s1" });
    expect(sent[0]).toMatchObject({ surface: "s1", activity: "active" });
    vi.advanceTimersByTime(1100);
    expect(sent.at(-1)).toMatchObject({ activity: "idle" });
    idle.dispose();
  });
});
