// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { caret } from "@pli.dev/docs";
import { applySelectionToDom, namedTagStart, pointFromDom, withinNode } from "../src/dom";

// A browser can report a position past the end of a node that has just changed (Safari does while a tag shown by name is removed).
// A range or selection built from it throws "index is not in the allowed range"; it has to be kept inside the node instead.
afterEach(() => void (document.body.innerHTML = ""));

function editor(): { root: HTMLElement; block: HTMLElement; text: Text } {
  const root = document.createElement("div");
  root.innerHTML = '<p data-block-id="a" data-type="paragraph">Hello</p>';
  document.body.append(root);
  const block = root.firstElementChild as HTMLElement;
  return { root, block, text: block.firstChild as Text };
}

describe("positions past the end of a node", () => {
  it("keeps an offset inside its node", () => {
    const { block, text } = editor();
    expect(withinNode(text, 99)).toBe(5);
    expect(withinNode(text, -3)).toBe(0);
    expect(withinNode(block, 99)).toBe(1);
    expect(withinNode(text, Number.NaN)).toBe(0);
  });

  it("reads a point past the end as the end, without throwing", () => {
    const { root, text } = editor();
    expect(pointFromDom(root, text, 99)).toEqual({ block: "a", offset: 5 });
  });

  it("sets a selection past the end as the end, without throwing", () => {
    const { root, text } = editor();
    expect(() => applySelectionToDom(root, caret("a", 99), true)).not.toThrow();
    expect(document.getSelection()?.focusOffset).toBe(text.data.length);
  });

  it("does not throw for a node that has left the page", () => {
    const { root, block, text } = editor();
    block.remove();
    expect(() => pointFromDom(root, text, 2)).not.toThrow();
    expect(namedTagStart(root, text)).toBeNull();
  });
});
