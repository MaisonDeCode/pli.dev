// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Users, type CommentNotice } from "@pli.dev/core";
import { PliDeck } from "../src";
import { click, menuItem, newSession, pointer, q, render, runAsync, setValue, useHost } from "./harness";

useHost();

const wait = (ms = 5) => runAsync(() => new Promise((r) => setTimeout(r, ms)));
const openMenu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));

describe("PliDeck: comments={{ onNotify }}", () => {
  it("hands a comment written in the panel to the app's own notifications", async () => {
    const seen: CommentNotice[] = [];
    render(<PliDeck session={newSession()} users={new Users({ id: "a", name: "Ana" })} comments={{ onNotify: (n) => void seen.push(n) }} />);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup");
    openMenu("Insert");
    click(menuItem("Comment"));
    setValue(q<HTMLTextAreaElement>(".pli-deck-comment-draft textarea"), "Is this the right title?");
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-comment-draft button")].find((b) => b.textContent === "Comment"));
    await wait(20);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "comment.created", actor: { id: "a" } });
    expect(seen[0]!.thread.comments[0]!.body).toBe("Is this the right title?");
  });
});
