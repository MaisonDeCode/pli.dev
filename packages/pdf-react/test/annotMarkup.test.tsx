// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { annots, byLabel, click, fire, flush, host, key, mount, openProperties, q, qa, run, tool, useAnnotHost } from "./annotHarness";

useAnnotHost();

const scroller = () => q(".pli-pdf-scroller");
const spans = (page = 0) => qa("span[data-run]", qa(".pli-pdf-text-layer")[page]!);

/** Selects text the way a person drags over it: from an offset in one run to an offset in another (maybe on another page). */
async function selectText(from: [number, number, number?], to: [number, number, number?]) {
  const a = spans(from[2] ?? 0)[from[0]]!.firstChild!;
  const b = spans(to[2] ?? 0)[to[0]]!.firstChild!;
  const range = document.createRange();
  range.setStart(a, from[1]);
  range.setEnd(b, to[1]);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

const release = async (target: Element = spans()[1]!) => {
  await fire(target, new MouseEvent("pointerup", { bubbles: true }));
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
};

describe.each([0, 1, 2, 3])("markup from selected text with the view turned %i quarter turns", (turns) => {
  it.each([
    ["Highlight", "highlight", "#ffe14d"],
    ["Underline", "underline", "#1e88e5"],
    ["Strikethrough", "strikeout", "#e53935"],
    ["Squiggly underline", "squiggly", "#e53935"],
  ] as const)("%s: the selection becomes one annotation per page, in page space", async (label, type, color) => {
    const m = await mount({ turns });
    await tool(label);
    await selectText([1, 2], [2, 3]);
    await release();
    expect(annots(m.session)).toHaveLength(1);
    expect(annots(m.session)[0]).toMatchObject({ type, color, quote: "llo wor", rects: [{ x: 84, y: 110, w: 42, h: 12 }] });
    // the tool stays on (sticky) and nothing is left selected
    expect(m.c().toolId).toBe(type);
    expect(m.session.selection.annots).toEqual([]);
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(q(".pli-pdf-sr", host).textContent).toContain("added on page 1");
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(0);
  });
});

describe("text markup", () => {
  it("makes one annotation for each page a selection reaches, as one undo step", async () => {
    const m = await mount({ zoom: 0.5 });
    await tool("Highlight");
    await selectText([3, 6], [0, 4, 1]);
    await release(spans(0)[3]!);
    expect(annots(m.session, 0)).toHaveLength(1);
    expect(annots(m.session, 1)).toHaveLength(1);
    expect((annots(m.session, 0)[0] as any).rects).toHaveLength(2);
    await run(() => m.session.undo());
    expect(annots(m.session, 0)).toHaveLength(0);
    expect(annots(m.session, 1)).toHaveLength(0);
  });

  it("uses the colour chosen for the tool, and the tool can be set to turn off after one use", async () => {
    const m = await mount();
    await tool("Highlight");
    await openProperties();
    await click(q("button[aria-label='Colour #7cdc5b']", host));
    await click(q("input[aria-label='Keep this tool selected']", host));
    await selectText([3, 0], [3, 5]);
    await release(spans()[3]!);
    expect(annots(m.session)[0]).toMatchObject({ type: "highlight", color: "#7cdc5b", quote: "Alpha" });
    expect(m.c().toolId).toBe("select");
    // the new highlight is selected, with its bar over it
    expect(m.session.selection.annots).toHaveLength(1);
  });

  it("does nothing for a selection outside the text", async () => {
    const m = await mount();
    await tool("Highlight");
    window.getSelection()!.removeAllRanges();
    await release();
    expect(annots(m.session)).toHaveLength(0);
  });

  it("shows a small bar over selected text when no tool is active, with colours, underline, strikethrough, comment and copy", async () => {
    const m = await mount();
    await selectText([3, 0], [3, 10]);
    await release(spans()[3]!);
    const bar = q("[role=toolbar][aria-label='Text selection']", host);
    expect(bar).toBeTruthy();
    expect(qa("button", bar).map((b) => b.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["Highlight #ffe14d", "Highlight #7cdc5b", "Highlight #4cc9f0", "Highlight #ff7aa2", "Underline", "Strikethrough", "Squiggly underline", "Highlight and comment", "Mark for redaction", "Copy"]),
    );
    await click(byLabel("Highlight #4cc9f0", bar));
    expect(annots(m.session)[0]).toMatchObject({ type: "highlight", color: "#4cc9f0", quote: "Alpha beta" });
    expect(document.querySelector("[aria-label='Text selection']")).toBeNull();
    await run(() => m.session.undo());
    await selectText([3, 0], [3, 10]);
    await release(spans()[3]!);
    await click(byLabel("Strikethrough", q("[aria-label='Text selection']", host)));
    expect(annots(m.session)[0]).toMatchObject({ type: "strikeout" });
  });

  it("highlights and opens the comment box in one go, and marks a selection for redaction", async () => {
    const m = await mount();
    await selectText([4, 0], [4, 9]);
    await release(spans()[4]!);
    await click(byLabel("Highlight and comment", q("[aria-label='Text selection']", host)));
    const [h] = annots(m.session) as any[];
    expect(h).toMatchObject({ type: "highlight", quote: "The quick" });
    expect(m.c().popover).toEqual({ kind: "comment", annot: h.id });
    await run(() => m.c().closePopover());
    await selectText([1, 0], [1, 5]);
    await release(spans()[1]!);
    await click(byLabel("Mark for redaction", q("[aria-label='Text selection']", host)));
    expect((annots(m.session)[1] as any)).toMatchObject({ type: "redact", rects: [{ x: 72, y: 110 }] });
  });

  it("closes the bar when the selection goes, and Escape closes it too", async () => {
    await mount();
    await selectText([3, 0], [3, 10]);
    await release(spans()[3]!);
    expect(document.querySelector("[aria-label='Text selection']")).toBeTruthy();
    await run(() => window.getSelection()!.removeAllRanges());
    await act(async () => void document.dispatchEvent(new Event("selectionchange")));
    expect(document.querySelector("[aria-label='Text selection']")).toBeNull();
    await selectText([3, 0], [3, 10]);
    await release(spans()[3]!);
    await key(scroller(), "Escape");
    expect(document.querySelector("[aria-label='Text selection']")).toBeNull();
  });

  it("offers no bar in a viewer that cannot edit, and a tool's own selection does not show it", async () => {
    await mount({ kit: { readOnly: true }, props: { readOnly: true } });
    await selectText([3, 0], [3, 10]);
    await release(spans()[3]!);
    expect(document.querySelector("[aria-label='Text selection']")).toBeNull();
    await flush();
  });
});
