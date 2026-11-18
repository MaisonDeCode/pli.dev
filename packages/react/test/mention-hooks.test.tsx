// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Users, type Comment, type PliUser } from "@pli.dev/core";
import { CommentBody, Composer } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const BEN: PliUser = { id: "ben", name: "Ben" };
const comment: Comment = { id: "c1", author: "ben", body: "Please look, @Ben", createdAt: 1, mentions: ["ben"] };

describe("a mention in a comment", () => {
  it("is plain text unless the app handles clicks on people", () => {
    act(() => root.render(<CommentBody comment={comment} users={new Users({ id: "me", name: "Me" })} />));
    expect(host.querySelector(".pli-mention")!.tagName).toBe("SPAN");
  });

  it("is a button that tells the app which person was clicked, when the app handles it", () => {
    const open = vi.fn();
    const users = new Users({ current: { id: "me", name: "Me" }, lookup: () => [BEN], open });
    users.add([BEN]);
    act(() => root.render(<CommentBody comment={comment} users={users} />));
    const mention = host.querySelector<HTMLButtonElement>("button.pli-mention")!;
    expect(mention.textContent).toBe("@Ben");
    act(() => mention.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatchObject({ id: "ben", name: "Ben" });
  });
});

describe("typing @ in the comment box", () => {
  it("asks the directory for people, saying which file the comment is for", async () => {
    const search = vi.fn(() => [BEN]);
    const users = new Users({ current: { id: "me", name: "Me" }, search });
    act(() => root.render(<Composer placeholder="Comment" submit="Comment" users={users} file="doc-7" onSubmit={() => {}} />));
    const box = host.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, "hi @B");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.setSelectionRange(5, 5);
      box.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(search).toHaveBeenCalled();
    expect(search.mock.calls[0]).toEqual(["B", { file: "doc-7" }]);
  });
});
