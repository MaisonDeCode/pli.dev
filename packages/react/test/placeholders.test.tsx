// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, caret, createDoc, paragraph, plainText, text } from "@pli.dev/docs";
import { PliDocument, insertSnippet, insertValue } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const make = (...lines: Parameters<typeof paragraph>[0][]) => new DocumentSession(createDoc("T", lines.map((l) => paragraph(l))));
const texts = (s: DocumentSession) => s.state.blocks.map((b) => ("runs" in b ? plainText(b.runs) : ""));
const chips = () => [...host.querySelectorAll<HTMLElement>(".pli-ph")];

describe("placeholder chips", () => {
  it("draws each tag as a chip and leaves the text exactly as it was", () => {
    const s = make("Dear {{ client.name }}, {{#if nda}}see below{{/if}} {{ oops");
    act(() => root.render(<PliDocument session={s} placeholders />));
    const p = host.querySelector<HTMLElement>('[data-type="paragraph"]')!;
    expect(p.textContent).toBe("Dear {{ client.name }}, {{#if nda}}see below{{/if}} {{ oops");
    const found = chips().map((c) => [c.dataset.kind, c.textContent]);
    expect(found).toEqual([
      ["value", "{{ client.name }}"],
      ["block", "{{#if nda}}"],
      ["block", "{{/if}}"],
      ["error", "{{"],
    ]);
    expect(chips()[3]!.title).toMatch(/never closed/);
  });

  it("is off unless asked for", () => {
    const s = make("Dear {{ name }}");
    act(() => root.render(<PliDocument session={s} />));
    expect(chips()).toHaveLength(0);
  });

  it("marks a tag that runs over differently formatted text, piece by piece", () => {
    const s = new DocumentSession(createDoc("T", [paragraph([text("Hi {{ cli"), text("ent.na", { bold: true }), text("me }}!")])]));
    act(() => root.render(<PliDocument session={s} placeholders />));
    const pieces = chips();
    expect(pieces.map((c) => c.textContent).join("")).toBe("{{ client.name }}");
    expect(pieces.map((c) => c.dataset.edge)).toEqual(["start", "mid", "end"]);
    expect(host.querySelector<HTMLElement>('[data-type="paragraph"]')!.textContent).toBe("Hi {{ client.name }}!");
  });

  it("does not touch code blocks", () => {
    const s = new DocumentSession(createDoc("T", [{ id: "c1", type: "code_block", runs: [{ text: "{{ name }}" }] }]));
    act(() => root.render(<PliDocument session={s} placeholders />));
    expect(chips()).toHaveLength(0);
  });
});

describe("inserting fields", () => {
  it("puts an answer at the caret", () => {
    const s = make("Dear ,");
    s.select(caret(s.state.blocks[0]!.id, 5));
    insertValue(s, "client.name");
    expect(texts(s)).toEqual(["Dear {{ client.name }},"]);
  });

  it("puts a condition on lines of its own, splitting the paragraph at the caret", () => {
    const s = make("Before after");
    s.select(caret(s.state.blocks[0]!.id, 7));
    insertSnippet(s, "if", "nda");
    expect(texts(s)).toEqual(["Before ", "{{#if nda}}", "", "{{/if}}", "after"]);
  });

  it("does not leave empty paragraphs around a condition put in an empty one", () => {
    const s = make("");
    s.select(caret(s.state.blocks[0]!.id, 0));
    insertSnippet(s, "each", "services");
    expect(texts(s)).toEqual(["{{#each services as item}}", "", "{{/each}}"]);
  });

  it("is in the Insert menu when placeholders are on, with the answers by their label", () => {
    const s = make("x");
    act(() => root.render(<PliDocument session={s} placeholders={{ fields: [{ path: "client.name", label: "Client name" }, "start"] }} />));
    act(() => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert")!.click());
    const labels = [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")].map((i) => i.textContent ?? "");
    expect(labels.some((l) => l.includes("Field"))).toBe(true);
    expect(labels.some((l) => l.includes("Only if"))).toBe(true);
    expect(labels.some((l) => l.includes("Repeat for each"))).toBe(true);
  });

  it("is not in the Insert menu otherwise", () => {
    const s = make("x");
    act(() => root.render(<PliDocument session={s} />));
    act(() => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert")!.click());
    const labels = [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")].map((i) => i.textContent ?? "");
    expect(labels.some((l) => l.includes("Only if"))).toBe(false);
  });
});

describe("tags shown by name", () => {
  const fields = [{ path: "client.name", label: "Client name" }, "start", { path: "plan", label: "Plan", options: [{ value: "team", label: "Team" }, "pro"] }];
  const named = (s: DocumentSession) => act(() => root.render(<PliDocument session={s} placeholders={{ fields, labels: true }} />));
  const labels = () => [...host.querySelectorAll<HTMLElement>(".pli-ph-label")].map((l) => l.dataset.label);

  it("shows each tag as its name and keeps the text exactly as it is", () => {
    const s = make("Dear {{ client.name }}, {{#if plan == \"team\"}}the Team plan{{else}}another{{/if}} from {{ start | date }}.");
    named(s);
    expect(labels()).toEqual(["Client name", "Only if Plan is team", "Otherwise", "End", "Start"]);
    expect(host.querySelector<HTMLElement>('[data-type="paragraph"]')!.textContent).toBe("Dear {{ client.name }}, {{#if plan == \"team\"}}the Team plan{{else}}another{{/if}} from {{ start | date }}.");
    expect(texts(s)[0]).toContain("{{ client.name }}");
  });

  it("shows a tag that can't be read as written, in red", () => {
    named(make("Hi {{ 1 + }}"));
    expect(labels()).toEqual([]);
    expect(chips().map((c) => [c.dataset.kind, c.dataset.friendly])).toEqual([["error", undefined]]);
  });

  it("names a tag that runs over differently formatted text once", () => {
    const s = new DocumentSession(createDoc("T", [paragraph([text("{{ cli"), text("ent.na", { bold: true }), text("me }}")])]));
    named(s);
    expect(labels()).toEqual(["Client name"]);
    expect(host.querySelector<HTMLElement>('[data-type="paragraph"]')!.textContent).toBe("{{ client.name }}");
  });

  it("removes a whole tag with one Backspace, and one Delete", () => {
    const s = make("Dear {{ client.name }}, hello");
    named(s);
    const editor = host.querySelector<HTMLElement>("[data-pli-editor]")!;
    const p = host.querySelector<HTMLElement>('[data-type="paragraph"]')!;
    const press = (inputType: string) => act(() => void editor.dispatchEvent(new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true })));
    // Where the editor puts the caret next to a tag: in the paragraph, outside the hidden text.
    const afterTag = () => {
      act(() => s.select(caret(s.state.blocks[0]!.id, 5 + 17)));
      document.getSelection()!.setBaseAndExtent(p, 2, p, 2);
    };
    afterTag();
    press("deleteContentBackward");
    expect(texts(s)).toEqual(["Dear , hello"]);

    const t = make("Dear {{ client.name }}, hello");
    act(() => root.render(<PliDocument session={t} placeholders={{ fields, labels: true }} />));
    const e2 = host.querySelector<HTMLElement>("[data-pli-editor]")!;
    const p2 = host.querySelector<HTMLElement>('[data-type="paragraph"]')!;
    act(() => t.select(caret(t.state.blocks[0]!.id, 5)));
    const first = p2.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(first, 5, first, 5);
    act(() => void e2.dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentForward", bubbles: true, cancelable: true })));
    expect(texts(t)).toEqual(["Dear , hello"]);
  });

  it("offers the choices of an answer under Only if…", () => {
    named(make("x"));
    act(() => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert")!.click());
    const menuitems = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")];
    act(() => menuitems().find((i) => i.textContent?.startsWith("Only if"))!.click());
    expect(menuitems().map((i) => i.textContent).join("|")).toContain("Client name");
    act(() => menuitems().find((i) => i.textContent?.startsWith("Plan"))!.click());
    const found = menuitems().map((i) => i.textContent);
    expect(found).toContain("is Team");
    expect(found).toContain("is pro");
  });
});
