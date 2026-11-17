// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { PdfFile, extractText, openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor, type PdfEditorProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { byLabel, chooseMenu, click, flush, host, key, menuButton, q, qa, render, run, setValue, useHost } from "./harness";
import { stubDialogs, viewport } from "./pagesSupport";
import { editPdf } from "./editHarness";

useHost();
stubDialogs();

const CONTENT = [
  "BT /F1 12 Tf 72 700 Td (The cat sat on the cat) Tj ET",
  "BT /F1 12 Tf 72 680 Td (Concatenate) Tj ET",
  "BT /F1 12 Tf 72 640 Td (The sat) Tj 80 0 Td (on it) Tj ET",
].join("\n");

/** The editor on a file whose text the fake renderer reports exactly as the engine reads it, so the find bar and the engine agree. */
async function mount(props: Partial<PdfEditorProps> = {}, content = CONTENT) {
  const session = await openPdf(editPdf({ content }), { name: "words.pdf", user: { id: "u1", name: "Ana Reyes" } });
  const runs = await session.content.runs(session.doc.pages[0]!.id);
  const renderer = fakeRenderer({ pages: 1, text: () => runs.map((r) => ({ str: r.text, x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h })) });
  await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} defaultZoom={1} annotations={{ storageKey: "" }} {...props} />);
  await flush();
  return session;
}

const findInput = () => byLabel("Find", q(".pli-pdf-find")) as HTMLInputElement;
const replaceInput = () => byLabel("Replace with", q(".pli-pdf-find")) as HTMLInputElement;
const message = () => document.querySelector(".pli-pdf-replace-message")?.textContent ?? "";
const dialogButton = (text: string) => qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent!.trim().startsWith(text))!;
const search = async (query: string) => {
  await setValue(findInput(), query);
  await flush(8);
};
const textOf = async (session: PdfSession) => extractText(PdfFile.open(await session.save()), 0).text;

describe("find and replace", () => {
  it("opens with Ctrl+H, or from the Edit menu and the replace button of the find bar", async () => {
    await mount();
    expect(document.querySelector(".pli-pdf-find")).toBeNull();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    expect(document.querySelector(".pli-pdf-find")).not.toBeNull();
    expect(replaceInput()).not.toBeNull();
    await click(byLabel("Show replace", q(".pli-pdf-find")));
    expect(document.querySelector("[aria-label='Replace with']")).toBeNull();
    await click(byLabel("Close find", q(".pli-pdf-find")));
    await chooseMenu("Edit", "Find and replace…");
    expect(replaceInput()).not.toBeNull();
    // the row stays the way it was left when the find bar is closed and opened again
    await click(byLabel("Close find", q(".pli-pdf-find")));
    await chooseMenu("Edit", "Find…");
    expect(replaceInput()).not.toBeNull();
    await click(byLabel("Show replace", q(".pli-pdf-find")));
    expect(document.querySelector("[aria-label='Replace with']")).toBeNull();
  });

  it("replaces every match in one step of undo, after saying how many", async () => {
    const session = await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("cat");
    expect(q(".pli-pdf-find-count").textContent).toBe("1 of 3");
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace all", q(".pli-pdf-find")));
    // nothing yet: it asks first, with the count
    expect(session.doc.pages[0]!.edits).toBeUndefined();
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Replace all?");
    expect(q("dialog[open]").textContent).toContain("Replace 3 matches of “cat” with “dog” on 1 page");
    await click(dialogButton("Replace 3 matches"));
    await flush();
    expect(session.doc.pages[0]!.edits!.filter((e) => e.type === "text")).toHaveLength(2);
    expect(message()).toBe("Replaced 3 matches on 1 page.");
    expect(document.querySelector(".pli-pdf-toast")!.textContent).toContain("Replaced 3 matches");
    // the saved file has the new words and not the old
    const text = await textOf(session);
    expect(text).toContain("The dog sat on the dog");
    expect(text).toContain("Condogenate");
    expect(text).not.toContain("cat");
    // the Edits tab lists them
    await click(q("#pli-pdf-tab-edits"));
    await flush(4);
    expect(qa(".pli-edit-item")).toHaveLength(2);
    // the toast's Undo takes them all back at once
    await click(qa<HTMLButtonElement>(".pli-pdf-toast-action")[0]);
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
  });

  it("gives up when the person says no", async () => {
    const session = await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("cat");
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace all", q(".pli-pdf-find")));
    await click(dialogButton("Cancel"));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(session.dirty).toBe(false);
  });

  it("follows match case and whole words", async () => {
    const session = await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("cat");
    await click(byLabel("Whole words", q(".pli-pdf-find")));
    await flush(6);
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace all", q(".pli-pdf-find")));
    expect(q("dialog[open]").textContent).toContain("Replace 2 matches");
    await click(dialogButton("Cancel"));
    await click(byLabel("Match case", q(".pli-pdf-find")));
    await setValue(findInput(), "CAT");
    await flush(8);
    expect(q(".pli-pdf-find-count").textContent).toBe("No results");
    expect(session.dirty).toBe(false);
  });

  it("replaces the match the find bar is on, then goes to the next", async () => {
    const session = await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("cat");
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace", q(".pli-pdf-replace")));
    await flush();
    expect(message()).toBe("Replaced 1 match.");
    expect(q(".pli-pdf-find-count").textContent).toBe("2 of 3");
    expect(await textOf(session)).toContain("The dog sat on the cat");
    // the next one: the second cat of the same line, written on top of the first change
    await click(byLabel("Replace", q(".pli-pdf-replace")));
    await flush();
    expect(await textOf(session)).toContain("The dog sat on the dog");
    // one undo step for each
    await run(() => session.undo());
    expect(await textOf(session)).toContain("The dog sat on the cat");
  });

  it("says what it could not replace: a match across two pieces of text is reported, not replaced", async () => {
    const session = await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("sat on");
    expect(q(".pli-pdf-find-count").textContent).toBe("1 of 2");
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace all", q(".pli-pdf-find")));
    await flush();
    // "sat on" is whole in the first line and across two runs in the third: only the first is replaced
    expect(q("dialog[open]").textContent).toContain("Replace 1 match");
    expect(q("dialog[open]").textContent).toContain("Left as they are: 1 match runs across two pieces of text.");
    await click(dialogButton("Replace 1 match"));
    await flush();
    expect(message()).toContain("Left as they are: 1 match runs across two pieces of text.");
    expect(await textOf(session)).toContain("The cat dog the cat");
    expect(await textOf(session)).toContain("The sat on it");
  });

  it("says so when nothing can be replaced, and changes nothing", async () => {
    const session = await mount({}, "BT /F1 12 Tf 72 700 Td (The sat) Tj 80 0 Td (on it) Tj ET");
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    await search("sat on");
    await setValue(replaceInput(), "dog");
    await click(byLabel("Replace all", q(".pli-pdf-find")));
    await flush();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(message()).toBe("Nothing to replace. Left as they are: 1 match runs across two pieces of text.");
    await click(byLabel("Replace", q(".pli-pdf-replace")));
    await flush();
    expect(message()).toContain("cannot be replaced");
    expect(session.dirty).toBe(false);
  });

  it("is not there in a read-only editor, or when the Edit tool is left out", async () => {
    await mount({ readOnly: true });
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    expect(document.querySelector("[aria-label='Replace with']")).toBeNull();
    expect(document.querySelector("[aria-label='Show replace']")).toBeNull();
    await render(<div />);
    await mount({ edit: false });
    await click(menuButton("Edit"));
    const item = qa<HTMLButtonElement>("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith("Find and replace"))!;
    expect(item.disabled).toBe(true);
  });

  it("keeps Redact all matches in the find bar", async () => {
    await mount();
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    expect(byLabel("Redact all matches", q(".pli-pdf-find"))).not.toBeNull();
    void host;
    void act;
  });
});
