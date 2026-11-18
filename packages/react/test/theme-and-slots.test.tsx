// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, createDoc, paragraph, text } from "@pli.dev/docs";
import { PliDocument } from "../src";

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
});

const session = () => new DocumentSession(createDoc("Quarterly plan", [paragraph([text("Hello")])]));

describe("PliDocument: the theme prop", () => {
  it("writes nothing for auto, so the editor follows the page or the system", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(host.querySelector(".pli-document")!.hasAttribute("data-theme")).toBe(false);
    act(() => root.render(<PliDocument session={session()} theme="auto" />));
    expect(host.querySelector(".pli-document")!.hasAttribute("data-theme")).toBe(false);
  });

  it("forces light or dark on the editor itself", () => {
    act(() => root.render(<PliDocument session={session()} theme="dark" />));
    expect(host.querySelector(".pli-document")!.getAttribute("data-theme")).toBe("dark");
    act(() => root.render(<PliDocument session={session()} theme="light" />));
    expect(host.querySelector(".pli-document")!.getAttribute("data-theme")).toBe("light");
  });

  it("follows a change of the prop", () => {
    const s = session();
    act(() => root.render(<PliDocument session={s} theme="light" />));
    act(() => root.render(<PliDocument session={s} theme="dark" />));
    expect(host.querySelector(".pli-document")!.getAttribute("data-theme")).toBe("dark");
  });

  it("carries the theme to a dropdown panel and a dialog", () => {
    act(() => root.render(<PliDocument session={session()} theme="dark" />));
    for (const dialog of host.querySelectorAll("dialog")) expect(dialog.getAttribute("data-theme")).toBe("dark");
    expect(host.querySelectorAll("dialog").length).toBeGreaterThan(0);
  });
});

describe("PliDocument: slots in the title row", () => {
  it("puts startActions before the title and endActions after everything else", () => {
    act(() =>
      root.render(
        <PliDocument session={session()} startActions={<button id="back">Back</button>} actions={<button id="mid">Export</button>} endActions={<button id="end">Account</button>} />,
      ),
    );
    const bar = host.querySelector(".pli-titlebar")!;
    const order = [...bar.querySelectorAll("#back, .pli-doc-title, #mid, #end")].map((el) => el.id || el.className);
    expect(order).toEqual(["back", "pli-doc-title", "mid", "end"]);
    expect(bar.firstElementChild!.classList.contains("pli-actions-start")).toBe(true);
  });

  it("adds nothing when the slots are not given", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(host.querySelector(".pli-actions-start")).toBeNull();
  });
});
