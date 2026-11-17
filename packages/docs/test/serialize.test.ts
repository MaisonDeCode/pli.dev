import { describe, expect, it } from "vitest";
import { PliError } from "@pli.dev/core";
import {
  bold,
  codeBlock,
  createDoc,
  divider,
  heading,
  link,
  listItem,
  paragraph,
  parseDoc,
  quote,
  serializeDoc,
  validateDoc,
} from "../src";

const sample = () =>
  createDoc("Round trip", [
    heading(1, "Title", "center"),
    paragraph(["a ", bold("b"), " ", link("c", "https://pli.dev")]),
    listItem("ordered", "x", 1),
    quote("q"),
    codeBlock("let a = 1", "ts"),
    divider(),
  ]);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof PliError ? error.code : "other";
  }
  return undefined;
}

describe("serializeDoc / parseDoc", () => {
  it("round-trips a document exactly", () => {
    const doc = sample();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("writes a versioned envelope", () => {
    const json = JSON.parse(serializeDoc(sample()));
    expect(json.format).toBe("pli.doc");
    expect(json.version).toBe(1);
  });

  it("rejects text that isn't JSON or isn't a Pli document", () => {
    expect(codeOf(() => parseDoc("{nope"))).toBe("invalid_document");
    expect(codeOf(() => parseDoc('{"hello":1}'))).toBe("invalid_document");
  });

  it("reports documents from a newer version as unsupported", () => {
    const json = JSON.stringify({ format: "pli.doc", version: 2, doc: sample() });
    expect(codeOf(() => parseDoc(json))).toBe("unsupported");
  });
});

describe("validateDoc", () => {
  const withBlock = (block: unknown) => ({ id: "d", type: "document", title: "T", blocks: [block] });

  it("accepts a valid document", () => {
    expect(() => validateDoc(sample())).not.toThrow();
  });

  it.each([
    ["duplicate ids", { id: "d", type: "document", title: "T", blocks: [{ id: "a", type: "divider" }, { id: "a", type: "divider" }] }, /duplicate id/],
    ["unknown block type", withBlock({ id: "a", type: "chart" }), /unknown block type/],
    ["bad heading level", withBlock({ id: "a", type: "heading", level: 7, runs: [] }), /doc\.blocks\[0\]\.level/],
    ["negative list depth", withBlock({ id: "a", type: "list_item", list: "bullet", depth: -1, runs: [] }), /depth/],
    ["unknown field", withBlock({ id: "a", type: "paragraph", runs: [], foo: "x" }), /unknown field "foo"/],
    ["non-string run text", withBlock({ id: "a", type: "paragraph", runs: [{ text: 5 }] }), /runs\[0\]\.text/],
    ["unknown mark", withBlock({ id: "a", type: "paragraph", runs: [{ text: "x", marks: { sparkle: true } }] }), /unknown mark "sparkle"/],
    ["non-boolean mark", withBlock({ id: "a", type: "paragraph", runs: [{ text: "x", marks: { bold: "yes" } }] }), /marks\.bold/],
    ["bad alignment", withBlock({ id: "a", type: "paragraph", align: "middle", runs: [] }), /align/],
    ["missing blocks", { id: "d", type: "document", title: "T" }, /doc\.blocks/],
  ])("rejects %s", (_name, value, message) => {
    expect(codeOf(() => validateDoc(value))).toBe("invalid_document");
    expect(() => validateDoc(value)).toThrowError(message);
  });
});
