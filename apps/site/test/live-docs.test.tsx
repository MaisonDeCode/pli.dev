// @vitest-environment jsdom
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocsLive from "../src/live/DocsLive";
import type { LiveBodyProps } from "../src/live/types";

// These tests drive React the way a browser does (timers and microtasks), not inside `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

let host: HTMLElement;
let root: Root | null;
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom lays nothing out: give the cursor layer a (zero-sized) box to put the teammate's caret at.
  (Range.prototype as unknown as { getClientRects: () => unknown[] }).getClientRects = () => [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const props = (over: Partial<LiveBodyProps> = {}): LiveBodyProps => ({
  step: 0,
  steps: 3,
  interactive: false,
  reducedMotion: true,
  mode: "story",
  onReady: () => {},
  ...over,
});

const body = () => host.querySelector<HTMLElement>(".pli-editor") ?? host;
const pageText = () => (host.querySelector(".pli-canvas")?.textContent ?? "").replace(/\s+/g, " ").trim();
const blocks = (selector: string) => [...host.querySelectorAll(`.pli-canvas ${selector}`)].map((e) => e.textContent ?? "");

/** What the document shows, without the random ids the editor gives each block, row and cell: the same for the same step. */
function shape(): string {
  const canvas = host.querySelector(".pli-canvas");
  if (!canvas) return "";
  const clone = canvas.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".pli-remote-layer").forEach((e) => e.remove());
  return clone.innerHTML.replace(/ (data-block-id|data-row-id|data-cell-id|data-table-grip|data-comments|id)="[^"]*"/g, "");
}

function mount(p: LiveBodyProps, strict = false) {
  const el = strict ? (
    <StrictMode>
      <DocsLive {...p} />
    </StrictMode>
  ) : (
    <DocsLive {...p} />
  );
  root!.render(el);
  return (next: Partial<LiveBodyProps>) => {
    p = { ...p, ...next };
    root!.render(strict ? <StrictMode><DocsLive {...p} /></StrictMode> : <DocsLive {...p} />);
  };
}

const settled = (what: () => void) => vi.waitFor(what, { timeout: 4000, interval: 20 });

describe("the live Documents editor", () => {
  it("shows the real editor with a compact chrome and calls onReady once it is drawn", async () => {
    const onReady = vi.fn();
    mount(props({ onReady }));
    await settled(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(host.querySelector(".pli-document")).not.toBeNull();
    expect(host.querySelector(".pli-toolbar")).not.toBeNull();
    // No menu bar, ruler or status bar: the box is small.
    expect(host.querySelector(".pli-menubar")).toBeNull();
    expect(host.querySelector(".pli-ruler")).toBeNull();
    expect(body()).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("step 0: the headline and a short intro, plain", async () => {
    const onReady = vi.fn();
    mount(props({ step: 0, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    const text = pageText();
    expect(text).toContain("Compass 2.0 launch plan");
    expect(text).toContain("a faster editor, shared workspaces and a mobile app");
    expect(text).not.toContain("Why now");
    expect(host.querySelector(".pli-canvas h1, .pli-canvas [data-type='title']")).toBeNull();
    expect(host.querySelector(".pli-canvas table")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("step 1: the headline is the Title, key words are formatted, and the body and list are there", async () => {
    const onReady = vi.fn();
    mount(props({ step: 1, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    expect(host.querySelector(".pli-canvas [data-type='title']")?.textContent).toBe("Compass 2.0 launch plan");
    expect(blocks("strong")).toEqual(expect.arrayContaining(["biggest release of the year", "speed, sharing and mobile", "Shared workspaces", "Mobile app", "Faster editor"]));
    expect(blocks("em")).toContain("a mobile app");
    expect(blocks("h2")).toEqual(["Why now", "What ships"]);
    expect(blocks("[data-type='list_item']").length).toBe(3);
    expect(pageText()).toContain("Early testers say pages open twice as fast.");
    expect(host.querySelector(".pli-canvas table")).toBeNull();
    expect(host.querySelector(".pli-comments")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("step 2: a timeline table, a comment from a teammate with her name and avatar, and her cursor", async () => {
    const onReady = vi.fn();
    mount(props({ step: 2, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    const cells = [...host.querySelectorAll(".pli-canvas table td, .pli-canvas table th")].map((c) => c.textContent);
    expect(cells).toEqual(["Milestone", "Team", "Date", "Feature freeze", "Engineering", "Feb 20", "Public beta", "Product", "Mar 10", "Launch event", "Marketing", "Apr 2", "General availability", "Engineering", "Apr 15"]);
    // The commented sentence is highlighted, and the panel has the thread with its author.
    expect(host.querySelector(".pli-canvas .pli-comment")?.textContent).toContain("Early testers say pages open twice as fast.");
    const panel = host.querySelector(".pli-comments");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Maya Chen");
    expect(panel!.textContent).toContain("Can we link the beta survey here?");
    expect(panel!.querySelector(".pli-avatar, [class*='avatar']")).not.toBeNull();
    // Her cursor is drawn in the document, with her name.
    await settled(() => expect(host.querySelector(".pli-remote-layer")?.textContent).toContain("Maya Chen"));
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("step 2 then 0 then 2 ends in the same document", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 2, onReady }));
    await settled(() => expect(host.querySelector(".pli-comments")).not.toBeNull());
    await settled(() => expect(host.querySelector(".pli-remote-layer")?.textContent).toContain("Maya Chen"));
    const first = shape();
    expect(first).toContain("Timeline");

    update({ step: 0 });
    await settled(() => expect(pageText()).not.toContain("Timeline"));
    await settled(() => expect(host.querySelector(".pli-comments")).toBeNull());
    expect(pageText()).toContain("a faster editor, shared workspaces and a mobile app");
    expect(pageText()).not.toContain("Why now");
    expect(host.querySelector(".pli-canvas table")).toBeNull();
    expect(host.querySelector(".pli-remote-layer")?.textContent ?? "").not.toContain("Maya Chen");

    update({ step: 2 });
    await settled(() => expect(host.querySelector(".pli-comments")).not.toBeNull());
    await settled(() => expect(host.querySelector(".pli-remote-layer")?.textContent).toContain("Maya Chen"));
    expect(shape()).toBe(first);
    expect(host.querySelectorAll(".pli-comments .pli-thread, .pli-comments [data-thread]").length).toBeLessThanOrEqual(1);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("plays a step with typing when motion is allowed, and ends in the same document as the instant one", async () => {
    // The reference: step 1 applied at once.
    const onReady = vi.fn();
    mount(props({ step: 1, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    const instant = shape();
    root!.unmount();
    root = createRoot(host);

    const onReady2 = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady: onReady2 }));
    await settled(() => expect(onReady2).toHaveBeenCalled());
    update({ step: 1 });
    // Part-way through, the body is being typed.
    await settled(() => expect(pageText()).toContain("Customers keep"));
    expect(pageText().length).toBeGreaterThan(0);
    await settled(() => expect(blocks("[data-type='list_item']").length).toBe(3));
    await settled(() => expect(blocks("strong")).toContain("Faster editor"));
    await new Promise((r) => setTimeout(r, 300));
    expect(shape()).toBe(instant);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  }, 30_000);

  it("a step change while a step is playing finishes it and plays the next", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    update({ step: 1 });
    await settled(() => expect(pageText()).toContain("Why now"));
    update({ step: 2 });
    await settled(() => expect(host.querySelector(".pli-canvas table")).not.toBeNull());
    await vi.waitFor(() => expect(host.querySelector(".pli-comments")).not.toBeNull(), { timeout: 20_000, interval: 50 });
    expect(pageText()).toContain("What ships");
    expect(blocks("[data-type='list_item']").length).toBe(3);
    expect(errors).not.toHaveBeenCalled();
  }, 30_000);

  it("stops scripting when the visitor takes over, and leaves the document as it is", async () => {
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    update({ step: 1 });
    await settled(() => expect(pageText()).toContain("Why now"));
    update({ interactive: true });
    await new Promise((r) => setTimeout(r, 120)); // the last typed key reaches the page
    const frozen = pageText();
    await new Promise((r) => setTimeout(r, 400));
    expect(pageText()).toBe(frozen);
    // Even if the step were to change, nothing more is scripted.
    update({ step: 2 });
    await new Promise((r) => setTimeout(r, 300));
    expect(pageText()).toBe(frozen);
    expect(errors).not.toHaveBeenCalled();
  }, 30_000);

  it("is safe in StrictMode, and leaves no timers behind when it unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const onReady = vi.fn();
    const update = mount(props({ step: 0, reducedMotion: false, onReady }), true);
    await vi.advanceTimersByTimeAsync(300);
    update({ step: 1 });
    // Part-way through typing, with timers pending:
    await vi.advanceTimersByTimeAsync(700);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    root!.unmount();
    root = createRoot(host);
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("works without any network or storage", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    const onReady = vi.fn();
    mount(props({ step: 2, onReady }));
    await settled(() => expect(onReady).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(pageText()).toContain("Timeline");
    expect(errors).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
