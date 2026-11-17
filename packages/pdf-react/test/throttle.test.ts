import { afterEach, describe, expect, it, vi } from "vitest";
import { throttle } from "../src/collab";

afterEach(() => vi.useRealTimers());

describe("throttle", () => {
  it("sends the first call at once, folds the ones that follow into one when the time is up, and the last wins", () => {
    vi.useFakeTimers();
    let now = 0;
    const sent: number[] = [];
    let value = 0;
    const t = throttle(() => sent.push(value), 50, () => now);
    value = 1;
    t.call();
    expect(sent).toEqual([1]);
    for (let n = 2; n <= 10; n++) {
      value = n;
      now += 2;
      t.call();
    }
    expect(sent).toEqual([1]);
    now = 50;
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([1, 10]);
    // after a quiet while the next call goes at once again
    now = 500;
    value = 11;
    t.call();
    expect(sent).toEqual([1, 10, 11]);
  });

  it("can send what is waiting now, or drop it", () => {
    vi.useFakeTimers();
    let now = 0;
    const sent: string[] = [];
    let value = "a";
    const t = throttle(() => sent.push(value), 50, () => now);
    t.call();
    value = "b";
    now = 10;
    t.call();
    t.flush();
    expect(sent).toEqual(["a", "b"]);
    value = "c";
    now = 20;
    t.call();
    t.cancel();
    now = 200;
    vi.advanceTimersByTime(200);
    expect(sent).toEqual(["a", "b"]);
  });
});
