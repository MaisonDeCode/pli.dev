// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSession, Users, createDoc, paragraph, text, type PliUser } from "@pli.dev/docs";
import { DocumentView } from "../src/render";
import { PliDocument } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ana: PliUser = { id: "ana", name: "Ana Reyes" };
const ben: PliUser = { id: "ben", name: "Ben Ito" };

describe("drawing suggestions", () => {
  const doc = createDoc("T", [paragraph([text("keep "), text("added", { suggest: { id: "a", kind: "insert", by: "ana", at: 1 } }), text(" gone", { suggest: { id: "b", kind: "delete", by: "ben", at: 2 } })])]);
  const html = renderToStaticMarkup(<DocumentView doc={doc} />);

  it("underlines an addition and strikes a deletion, in the author's color", () => {
    expect(html).toMatch(/<ins class="pli-suggest" data-suggest="a" data-kind="insert" data-by="ana" style="--pli-suggest:#[0-9a-f]{6}">added<\/ins>/);
    expect(html).toMatch(/<del class="pli-suggest" data-suggest="b" data-kind="delete" data-by="ben" style="--pli-suggest:#[0-9a-f]{6}"> gone<\/del>/);
  });

  it("keeps the model's text, so selections line up", () => {
    expect(html.replace(/<[^>]*>/g, "")).toBe("keep added gone");
  });

  it("gives different people different colors", () => {
    const colors = [...html.matchAll(/--pli-suggest:(#[0-9a-f]{6})/g)].map((m) => m[1]);
    expect(new Set(colors).size).toBe(2);
  });
});

describe("the editor's suggestion controls", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const button = (label: RegExp) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test(b.textContent ?? ""))!;
  const click = (el: Element) => act(() => void (el as HTMLElement).click());

  const setup = (role: "viewer" | "commenter" | "editor" = "editor") => {
    const users = new Users({ current: ana, role, lookup: (ids) => [ana, ben].filter((u) => ids.includes(u.id)) });
    const session = new DocumentSession(createDoc("T", [paragraph("Hello world")]), { suggestions: { users } });
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 5 }, focus: { block: id, offset: 5 } });
    act(() => root.render(<PliDocument session={session} />));
    return session;
  };

  it("has nothing about suggestions when the session doesn't have them", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    act(() => root.render(<PliDocument session={session} />));
    expect(button(/Suggestions|Editing|Suggesting/)).toBeUndefined();
  });

  it("switches between editing and suggesting, and marks the document while suggesting", () => {
    const session = setup();
    expect(button(/^Editing$/)).toBeDefined();
    click(button(/^Editing$/));
    expect(session.suggesting).toBe(true);
    expect(button(/^Suggesting$/).getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".pli-document")?.hasAttribute("data-suggesting")).toBe(true);
    act(() => void session.typeText("!"));
    expect(session.suggestions).toHaveLength(1);
    click(button(/^Suggesting$/));
    expect(session.suggesting).toBe(false);
  });

  it("shows the suggestions with who made them, and accepts or rejects from the panel", async () => {
    const session = setup();
    act(() => {
      session.setSuggesting(true);
      session.typeText("!");
    });
    click(button(/^Suggestions \(1\)$/));
    const panel = host.querySelector(".pli-suggestions")!;
    expect(panel.textContent).toContain("Add");
    expect(panel.textContent).toContain("!");
    expect(panel.textContent).toContain("Ana Reyes");
    click([...panel.querySelectorAll("button")].find((b) => b.textContent === "Accept")!);
    expect(session.suggestions).toEqual([]);
    expect(host.querySelector(".pli-suggestions")!.textContent).toContain("Turn on Suggesting");
    click(button(/^Suggesting$/));
  });

  it("rejects a suggestion and puts the text back", () => {
    const session = setup();
    act(() => {
      session.setSuggesting(true);
      session.select({ anchor: { block: session.state.blocks[0]!.id, offset: 0 }, focus: { block: session.state.blocks[0]!.id, offset: 5 } });
      session.deleteSelection();
    });
    click(button(/^Suggestions \(1\)$/));
    click([...host.querySelectorAll(".pli-suggestions button")].find((b) => b.textContent === "Reject")!);
    expect(session.suggestions).toEqual([]);
    expect((session.state.blocks[0] as unknown as { runs: { text: string }[] }).runs).toEqual([{ text: "Hello world" }]);
  });

  it("offers a commenter no Accept, and a viewer neither the mode nor any button", () => {
    const commenter = setup("commenter");
    act(() => {
      commenter.setSuggesting(true);
      commenter.typeText("!");
    });
    click(button(/^Suggestions \(1\)$/));
    const labels = [...host.querySelectorAll(".pli-suggestions button")].map((b) => b.textContent);
    expect(labels).toContain("Reject");
    expect(labels).not.toContain("Accept");
    act(() => root.unmount());
    root = createRoot(host);
    setup("viewer");
    expect(button(/^Editing$/)).toBeUndefined();
    expect(button(/^Suggestions$/)).toBeDefined();
  });

  it("is in the View menu", () => {
    setup();
    const view = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "View")!;
    act(() => void view.click());
    const labels = [...host.querySelectorAll(".pli-menu-list .pli-menu-label")].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Show suggestions", "Suggest edits"]));
  });
});
