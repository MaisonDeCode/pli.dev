// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bold,
  caret,
  codeBlock,
  createDoc,
  divider,
  heading,
  image,
  italic,
  link,
  listItem,
  pageBreak,
  paragraph,
  plainText,
  toc,
  type Doc,
} from "@pli.dev/docs";
import { applySelectionToDom, domPointFromPoint, pointFromDom, selectionFromDom } from "../src/dom";
import { DocumentView } from "../src/render";

let root: HTMLElement;

function mount(doc: Doc, layout?: Parameters<typeof DocumentView>[0]["layout"]): HTMLElement {
  root.innerHTML = renderToStaticMarkup(<DocumentView doc={doc} layout={layout} />);
  return root;
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.getSelection()?.removeAllRanges();
});

const sample = () =>
  createDoc("T", [
    heading(1, "Title"),
    paragraph(["plain ", bold("bold"), " ", italic("it"), " ", link("link", "https://pli.dev"), " end"]),
    paragraph(""),
    listItem("bullet", "item one"),
    listItem("ordered", "item two", 1),
    divider(),
    codeBlock("line1\nline2"),
    paragraph("a😀b"),
  ]);

describe("DOM <-> document points", () => {
  it("round-trips every offset of every text block", () => {
    const doc = sample();
    mount(doc);
    for (const block of doc.blocks) {
      if (!("runs" in block)) continue;
      const length = "runs" in block ? plainText(block.runs).length : 0;
      for (let offset = 0; offset <= length; offset++) {
        const dom = domPointFromPoint(root, { block: block.id, offset });
        expect(dom, `${block.type} @${offset}`).not.toBeNull();
        expect(pointFromDom(root, dom!.node, dom!.offset)).toEqual({ block: block.id, offset });
      }
    }
  });

  it("maps list markers to nothing: they are CSS, not DOM text", () => {
    const doc = createDoc("T", [listItem("bullet", "abc")]);
    mount(doc);
    expect(root.textContent).toBe("abc");
  });

  it("puts the caret of an empty block inside the block", () => {
    const doc = createDoc("T", [paragraph("")]);
    mount(doc);
    const dom = domPointFromPoint(root, { block: doc.blocks[0]!.id, offset: 0 })!;
    expect((dom.node as HTMLElement).dataset.blockId).toBe(doc.blocks[0]!.id);
    expect(pointFromDom(root, dom.node, dom.offset)).toEqual({ block: doc.blocks[0]!.id, offset: 0 });
  });

  it("snaps positions between blocks to the nearest block", () => {
    const doc = createDoc("T", [paragraph("one"), paragraph("two")]);
    mount(doc);
    const [a, b] = doc.blocks;
    expect(pointFromDom(root, root, 0)).toEqual({ block: a!.id, offset: 0 });
    expect(pointFromDom(root, root, 1)).toEqual({ block: b!.id, offset: 0 });
    expect(pointFromDom(root, root, 2)).toEqual({ block: b!.id, offset: 3 });
  });

  it("maps a position across list wrappers", () => {
    const doc = createDoc("T", [listItem("bullet", "a"), listItem("bullet", "b"), paragraph("c")]);
    mount(doc);
    const list = root.firstElementChild!;
    expect(pointFromDom(root, list, 0)).toEqual({ block: doc.blocks[0]!.id, offset: 0 });
    expect(pointFromDom(root, list, 2)).toEqual({ block: doc.blocks[2]!.id, offset: 0 });
  });
});

describe("selection sync", () => {
  it("writes a model selection to the DOM and reads it back, including backwards ones", () => {
    const doc = sample();
    mount(doc);
    const [h, p] = doc.blocks;
    const selection = { anchor: { block: p!.id, offset: 8 }, focus: { block: h!.id, offset: 2 } };
    expect(applySelectionToDom(root, selection)).toBe(true);
    expect(selectionFromDom(root)).toEqual(selection);
    // Already in sync: nothing to do.
    expect(applySelectionToDom(root, selection)).toBe(false);
  });

  it("selects across a divider", () => {
    const doc = sample();
    mount(doc);
    const divider = doc.blocks.find((b) => b.type === "divider")!;
    expect(applySelectionToDom(root, caret(divider.id, 0))).toBe(true);
    expect(selectionFromDom(root)).toEqual(caret(divider.id, 0));
  });

  it("ignores a selection outside the editor", () => {
    mount(sample());
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    document.getSelection()!.setBaseAndExtent(outside.firstChild!, 1, outside.firstChild!, 3);
    expect(selectionFromDom(root)).toBeNull();
    outside.remove();
  });
});

describe("with page gaps and non-text blocks", () => {
  it("maps every offset across gaps that sit inside a paragraph", () => {
    const p = paragraph(["Hello ", bold("brave new"), " world, long enough to wrap"]);
    const doc = createDoc("T", [p]);
    mount(doc, { before: new Map(), splits: new Map([[p.id, [{ offset: 9, height: 100 }, { offset: 20, height: 100 }]]]), pageOf: new Map() });
    expect(root.querySelectorAll("[data-pli-spacer]")).toHaveLength(2);
    const length = plainText(p.type === "paragraph" ? p.runs : []).length;
    for (let offset = 0; offset <= length; offset++) {
      const dom = domPointFromPoint(root, { block: p.id, offset })!;
      expect(pointFromDom(root, dom.node, dom.offset), `offset ${offset}`).toEqual({ block: p.id, offset });
    }
  });

  it("treats images, page breaks and tables of contents as holding no text", () => {
    const img = image("data:image/png;base64,AAAA", { width: 10, height: 10 });
    const brk = pageBreak();
    const contents = toc();
    const doc = createDoc("T", [heading(1, "Heading"), contents, img, brk, paragraph("after")]);
    mount(doc);
    for (const block of [contents, img, brk]) {
      const el = root.querySelector(`[data-block-id="${block.id}"]`)!;
      // Whatever the browser puts inside them, a position is offset 0 of that block.
      const inner = el.querySelector("*") ?? el;
      expect(pointFromDom(root, inner, 0)).toEqual({ block: block.id, offset: 0 });
      expect(pointFromDom(root, el, el.childNodes.length)).toEqual({ block: block.id, offset: 0 });
    }
    expect(applySelectionToDom(root, caret(img.id, 0))).toBe(true);
    expect(selectionFromDom(root)).toEqual(caret(img.id, 0));
  });
});
