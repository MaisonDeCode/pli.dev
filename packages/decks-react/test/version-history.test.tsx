// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { memoryVersionStorage, Users } from "@pli.dev/core";
import { deckVersionHistory, paragraphsFromText, type Deck } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { byLabel, click, key, menuItem, newSession, openMenu, q, qa, render, run, runAsync, useHost } from "./harness";

useHost();

const editor = (role: "editor" | "viewer" = "editor") => new Users({ current: { id: "u1", name: "Ada" }, role });
const titleOf = (s: ReturnType<typeof newSession>, i: number) => s.deck.slides[i]!.elements[0]!.id;
const settle = () => runAsync(() => new Promise<void>((r) => setTimeout(r, 20)));
const panel = () => document.querySelector(".pli-versions");
const row = (name: string) => qa(".pli-version").find((li) => li.querySelector(".pli-version-name-text")?.textContent === name)!;
const rowButton = (name: string) => row(name).querySelector<HTMLElement>(".pli-version-main")!;
const text = () => document.body.textContent ?? "";

/** A deck saved as "First", then edited: slide 1 says "Edited title" and a slide was added. */
async function setup(storage = memoryVersionStorage<Deck>()) {
  const s = newSession();
  const history = deckVersionHistory(s, { storage, users: editor() });
  await history.ready;
  await history.save("First");
  s.setText(s.deck.slides[0]!.id, titleOf(s, 0), paragraphsFromText("Edited title"));
  s.addSlide();
  return { s, history, storage };
}

describe("version history in the View menu", () => {
  it("has no Version history item without a history", () => {
    render(<PliDeck session={newSession()} />);
    openMenu("View");
    expect(menuItem("Version history")).toBeUndefined();
  });

  it("makes its own history from `versions` and `users`, and opens the panel from View", async () => {
    const s = newSession();
    render(<PliDeck session={s} versions={memoryVersionStorage<Deck>()} users={editor()} autoSaveVersions={false} />);
    await settle();
    openMenu("View");
    const item = menuItem("Version history");
    expect(item).toBeTruthy();
    click(item);
    expect(panel()).toBeTruthy();
    expect(panel()!.textContent).toContain("Current version");
    openMenu("View");
    expect(menuItem("Version history").getAttribute("aria-checked")).toBe("true");
    // the panel is where the side panels go, and only one is open at a time
    click(byLabel("Theme"));
    expect(panel()).toBeNull();
  });

  it("autosaves an Original version when there is none yet", async () => {
    const s = newSession();
    const storage = memoryVersionStorage<Deck>();
    render(<PliDeck session={s} versions={storage} users={editor()} />);
    await settle();
    expect(storage.count(s.deck.id)).toBe(1);
  });
});

describe("previewing and restoring a version", () => {
  it("shows the older deck read only while the real deck stays as it is, and goes back", async () => {
    const { s, history } = await setup();
    render(<PliDeck session={s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    const edited = s.deck;
    expect(text()).toContain("Edited title");
    click(rowButton("First"));
    // the version's slides are on show: the first slide still has its old title, and there is one slide fewer
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
    expect(text()).not.toContain("Edited title");
    expect(qa(".pli-deck-film-item").length).toBe(s.deck.slides.length - 1);
    expect(s.deck).toBe(edited);
    expect(byLabel("Slideshow") ?? document.querySelector(".pli-deck-slideshow")).toBeTruthy();
    expect((document.querySelector(".pli-deck-slideshow") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
    // the panel marks it, and "Current version" brings the editor back
    expect(rowButton("First").getAttribute("aria-pressed")).toBe("true");
    click(qa(".pli-version-current .pli-version-main")[0]);
    expect(document.querySelector(".pli-version-bar")).toBeNull();
    expect(text()).toContain("Edited title");
    expect(s.deck).toBe(edited);
  });

  it("Escape goes back to the current deck", async () => {
    const { s, history } = await setup();
    render(<PliDeck session={s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    click(rowButton("First"));
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
    key(q(".pli-deck-root"), "Escape");
    expect(document.querySelector(".pli-version-bar")).toBeNull();
  });

  it("restores from the bar: the deck changes, a Restored entry is added, earlier versions stay, and undo brings the edit back", async () => {
    const { s, history } = await setup();
    render(<PliDeck session={s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    click(rowButton("First"));
    const before = s.deck.slides.length;
    await runAsync(async () => {
      click([...document.querySelectorAll<HTMLElement>(".pli-version-bar button")].find((b) => b.textContent === "Restore this version"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(s.deck.slides.length).toBe(before - 1);
    expect(s.deck.slides[0]!.elements[0]!.type === "shape" && JSON.stringify(s.deck.slides[0]!.elements[0])).toContain("Hello world");
    // the preview is over and the list shows the new version above the old ones
    expect(document.querySelector(".pli-version-bar")).toBeNull();
    expect(row('Restored "First"')).toBeTruthy();
    expect(row("First")).toBeTruthy();
    expect(row('Before restoring "First"')).toBeTruthy();
    // one undo takes the restore back
    expect(run(() => s.undo())).toBe(true);
    expect(s.deck.slides.length).toBe(before);
  });

  it("restores from the panel too", async () => {
    const { s, history } = await setup();
    render(<PliDeck session={s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    const before = s.deck.slides.length;
    await runAsync(async () => {
      click([...row("First").querySelectorAll<HTMLElement>("button")].find((b) => b.textContent!.includes("Restore this version")));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(s.deck.slides.length).toBe(before - 1);
  });

  it("has no restore button for a viewer", async () => {
    const owner = await setup();
    // the same versions, opened by someone who may only look
    const history = deckVersionHistory(owner.s, { storage: owner.storage, users: editor("viewer") });
    await history.ready;
    render(<PliDeck session={owner.s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    expect(row("First")).toBeTruthy();
    expect(qa(".pli-version-actions").length).toBe(0);
    click(rowButton("First"));
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
    expect(document.querySelector(".pli-version-bar button")?.textContent).toBe("Back to current");
    expect(text()).not.toContain("Restore this version");
  });

  it("keeps the preview when the host passes a new but equal `autoSaveVersions` object on each render", async () => {
    const s = newSession();
    const storage = memoryVersionStorage<Deck>();
    const history = deckVersionHistory(s, { storage, users: editor() });
    await history.ready;
    await history.save("First");
    s.setText(s.deck.slides[0]!.id, titleOf(s, 0), paragraphsFromText("Edited title"));
    const users = editor();
    const view = () => <PliDeck session={s} versions={storage} users={users} autoSaveVersions={{ every: 60_000, baseline: false }} />;
    render(view());
    await settle();
    openMenu("View");
    click(menuItem("Version history"));
    await settle();
    click(rowButton("First"));
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
    render(view());
    await settle();
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
  });

  it("does not break when the history is swapped for one that lacks the version on show", async () => {
    const { s, history } = await setup();
    render(<PliDeck session={s} history={history} />);
    openMenu("View");
    click(menuItem("Version history"));
    click(rowButton("First"));
    expect(document.querySelector(".pli-version-bar")).toBeTruthy();
    const other = deckVersionHistory(s, { storage: memoryVersionStorage<Deck>(), users: editor() });
    render(<PliDeck session={s} history={other} />);
    await settle();
    expect(document.querySelector(".pli-version-bar")).toBeNull();
    expect(document.querySelector(".pli-deck-root")).toBeTruthy();
  });

  it("keeps saving versions by itself in a strict-mode development build (which mounts everything twice)", async () => {
    const s = newSession();
    const storage = memoryVersionStorage<Deck>();
    render(
      <StrictMode>
        <PliDeck session={s} versions={storage} users={editor()} autoSaveVersions={{ every: 30 }} />
      </StrictMode>,
    );
    await settle();
    expect(storage.count(s.deck.id)).toBe(1);
    run(() => s.setText(s.deck.slides[0]!.id, titleOf(s, 0), paragraphsFromText("Changed")));
    await runAsync(() => new Promise<void>((r) => setTimeout(r, 120)));
    expect(storage.count(s.deck.id)).toBe(2);
    const names = (await storage.list(s.deck.id)).map((v) => v.name).sort();
    expect(names).toEqual(["Autosaved", "Original"]);
  });
});
