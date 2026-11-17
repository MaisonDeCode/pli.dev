import { describe, expect, it } from "vitest";
import { DocumentSession, Users, createDoc, paragraph, parseDoc, plainText, serializeDoc, stripSuggestions, suggestionsIn, text, type Block, type Doc, type PliUser } from "../src";

const ana: PliUser = { id: "ana", name: "Ana" };
const ben: PliUser = { id: "ben", name: "Ben" };

const session = (body: string, who: PliUser = ana, role: "viewer" | "commenter" | "editor" = "editor") => {
  const s = new DocumentSession(createDoc("T", [paragraph(body)]), { suggestions: { users: new Users({ current: who, role }) } });
  const id = s.state.blocks[0]!.id;
  return { s, id, at: (offset: number) => s.select({ anchor: { block: id, offset }, focus: { block: id, offset } }), range: (a: number, b: number) => s.select({ anchor: { block: id, offset: a }, focus: { block: id, offset: b } }) };
};

const runs = (s: DocumentSession, i = 0) => (s.state.blocks[i] as unknown as { runs: { text: string; marks?: { suggest?: { kind: string; by: string } } }[] }).runs.map((r) => [r.text, r.marks?.suggest?.kind ?? "", r.marks?.suggest?.by ?? ""]);
const body = (s: DocumentSession, i = 0) => plainText((s.state.blocks[i] as unknown as { runs: never[] }).runs);

describe("suggesting", () => {
  it("is off until turned on, and needs someone who may suggest", () => {
    const { s } = session("Hello");
    expect(s.suggesting).toBe(false);
    expect(s.setSuggesting(true)).toBe(true);
    expect(s.suggesting).toBe(true);
    const viewer = session("Hello", ana, "viewer");
    expect(viewer.s.canSuggest).toBe(false);
    expect(viewer.s.setSuggesting(true)).toBe(false);
    const none = new DocumentSession(createDoc("T", [paragraph("x")]));
    expect(none.canSuggest).toBe(false);
    expect(none.setSuggesting(true)).toBe(false);
  });

  it("marks typed text as an addition, and keeps typing in one suggestion", () => {
    const { s, at } = session("Hello world");
    s.setSuggesting(true);
    at(5);
    s.typeText(",");
    s.typeText(" dear");
    expect(runs(s)).toEqual([["Hello", "", ""], [", dear", "insert", "ana"], [" world", "", ""]]);
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestions[0]).toMatchObject({ kind: "insert", by: "ana", text: ", dear" });
  });

  it("starts a new suggestion for someone else's, or after a gap", () => {
    const { s, at } = session("Hello");
    s.setSuggesting(true);
    at(5);
    s.typeText("!");
    const other = new DocumentSession(s.state, { suggestions: { users: new Users({ current: ben, role: "editor" }) } });
    other.setSuggesting(true);
    other.select({ anchor: { block: s.state.blocks[0]!.id, offset: 6 }, focus: { block: s.state.blocks[0]!.id, offset: 6 } });
    other.typeText("?");
    expect(other.suggestions.map((x) => [x.by, x.text])).toEqual([["ana", "!"], ["ben", "?"]]);
  });

  it("proposes a selection for deletion instead of removing it", () => {
    const { s, range } = session("Hello big world");
    s.setSuggesting(true);
    range(5, 9);
    s.deleteSelection();
    expect(body(s)).toBe("Hello big world");
    expect(runs(s)).toEqual([["Hello", "", ""], [" big", "delete", "ana"], [" world", "", ""]]);
    expect(s.selection?.focus.offset).toBe(9);
  });

  it("replaces a selection by proposing its deletion and adding the new text after it", () => {
    const { s, range } = session("Hello world");
    s.setSuggesting(true);
    range(6, 11);
    s.typeText("there");
    expect(runs(s)).toEqual([["Hello ", "", ""], ["world", "delete", "ana"], ["there", "insert", "ana"]]);
    expect(s.selection?.focus.offset).toBe(16);
  });

  it("walks backspace and delete over text already proposed for deletion", () => {
    const { s, at } = session("abcd");
    s.setSuggesting(true);
    at(3);
    s.backspace();
    expect(runs(s)).toEqual([["ab", "", ""], ["c", "delete", "ana"], ["d", "", ""]]);
    expect(s.selection?.focus.offset).toBe(2);
    s.backspace();
    expect(runs(s)).toEqual([["a", "", ""], ["bc", "delete", "ana"], ["d", "", ""]]);
    at(0);
    s.deleteForward();
    expect(runs(s)[0]).toEqual(["a", "delete", "ana"]);
    // Delete walks past the struck "bc" to the next character that is left.
    s.deleteForward();
    expect(runs(s).every((r) => r[1] === "delete")).toBe(true);
    expect(runs(s).map((r) => r[0]).join("")).toBe("abcd");
    expect(s.selection?.focus.offset).toBe(4);
  });

  it("takes back your own addition for real when you delete it", () => {
    const { s, at } = session("Hello");
    s.setSuggesting(true);
    at(5);
    s.typeText("abc");
    s.backspace();
    expect(body(s)).toBe("Helloab");
    expect(runs(s)[1]).toEqual(["ab", "insert", "ana"]);
    s.backspace();
    s.backspace();
    expect(runs(s)).toEqual([["Hello", "", ""]]);
    expect(s.suggestions).toEqual([]);
  });

  it("deletes other people's additions as a suggestion, not for real", () => {
    const { s, at } = session("Hello");
    s.setSuggesting(true);
    at(5);
    s.typeText("!!");
    const other = new DocumentSession(s.state, { suggestions: { users: new Users({ current: ben, role: "editor" }) } });
    other.setSuggesting(true);
    other.select({ anchor: { block: s.state.blocks[0]!.id, offset: 7 }, focus: { block: s.state.blocks[0]!.id, offset: 7 } });
    other.backspace();
    expect(body(other)).toBe("Hello!!");
    expect(runs(other).at(-1)).toEqual(["!", "delete", "ben"]);
  });

  it("joins paragraphs at the edge as it always did, and says nothing about it", () => {
    const s = new DocumentSession({ ...createDoc("T", [paragraph("one"), paragraph("two")]) }, { suggestions: { users: new Users({ current: ana, role: "editor" }) } });
    s.setSuggesting(true);
    s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 0 }, focus: { block: s.state.blocks[1]!.id, offset: 0 } });
    s.backspace();
    expect(s.state.blocks).toHaveLength(1);
    expect(body(s)).toBe("onetwo");
  });

  it("proposes the deletion across paragraphs without joining them", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("first line"), paragraph("second line")]), { suggestions: { users: new Users({ current: ana, role: "editor" }) } });
    const [a, b] = s.state.blocks.map((x) => x.id);
    s.setSuggesting(true);
    s.select({ anchor: { block: a!, offset: 6 }, focus: { block: b!, offset: 6 } });
    s.deleteSelection();
    expect(s.state.blocks).toHaveLength(2);
    expect(runs(s, 0)).toEqual([["first ", "", ""], ["line", "delete", "ana"]]);
    expect(runs(s, 1)).toEqual([["second", "delete", "ana"], [" line", "", ""]]);
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestions[0]!.text).toBe("linesecond");
  });

  it("is one undo step for each action", () => {
    const { s, range } = session("Hello world");
    s.setSuggesting(true);
    range(0, 5);
    s.typeText("Howdy");
    expect(s.suggestions).toHaveLength(2);
    s.undo();
    expect(body(s)).toBe("Hello world");
    expect(s.suggestions).toEqual([]);
  });

  it("makes typing in a code block ordinary typing", () => {
    const s = new DocumentSession(createDoc("T", [{ id: "c", type: "code_block", runs: [{ text: "x" }] }]), { suggestions: { users: new Users({ current: ana, role: "editor" }) } });
    s.setSuggesting(true);
    s.select({ anchor: { block: "c", offset: 1 }, focus: { block: "c", offset: 1 } });
    s.typeText("y");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "xy" }] });
  });
});

describe("accepting and rejecting", () => {
  const withBoth = () => {
    const { s, range, at } = session("Hello big world");
    s.setSuggesting(true);
    range(5, 9);
    s.deleteSelection();
    at(15);
    s.typeText("!");
    return s;
  };

  it("accepts: additions become text and proposed deletions go", () => {
    const s = withBoth();
    const [del, add] = s.suggestions;
    expect(s.acceptSuggestion(del!.id)).toBe(true);
    expect(body(s)).toBe("Hello world!");
    expect(s.suggestions.map((x) => x.id)).toEqual([add!.id]);
    expect(s.acceptSuggestion(add!.id)).toBe(true);
    expect(runs(s)).toEqual([["Hello world!", "", ""]]);
  });

  it("rejects: additions go and proposed deletions stay", () => {
    const s = withBoth();
    expect(s.rejectAllSuggestions()).toBe(true);
    expect(runs(s)).toEqual([["Hello big world", "", ""]]);
  });

  it("is one undo step, which brings the suggestions back", () => {
    const s = withBoth();
    s.acceptAllSuggestions();
    expect(s.suggestions).toEqual([]);
    s.undo();
    expect(s.suggestions).toHaveLength(2);
    expect(body(s)).toBe("Hello big world!");
  });

  it("returns false when there is nothing to do", () => {
    const { s } = session("plain");
    expect(s.acceptAllSuggestions()).toBe(false);
    expect(s.rejectSuggestion("nope")).toBe(false);
  });

  it("lets an editor resolve anyone's, a commenter only withdraw their own, and a viewer nothing", () => {
    const base = withBoth();
    const doc: Doc = base.state;
    const open = (who: PliUser, role: "viewer" | "commenter" | "editor") => new DocumentSession(doc, { suggestions: { users: new Users({ current: who, role }) } });
    const commenter = open(ben, "commenter");
    expect(commenter.acceptSuggestion(commenter.suggestions[0]!.id)).toBe(false);
    expect(commenter.rejectSuggestion(commenter.suggestions[0]!.id)).toBe(false);
    const own = open(ana, "commenter");
    expect(own.acceptSuggestion(own.suggestions[0]!.id)).toBe(false);
    expect(own.rejectSuggestion(own.suggestions[0]!.id)).toBe(true);
    expect(open(ben, "viewer").rejectAllSuggestions()).toBe(false);
    expect(open(ben, "editor").acceptAllSuggestions()).toBe(true);
  });

  it("works across paragraphs and inside table cells", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("first line"), paragraph("second line")]), { suggestions: { users: new Users({ current: ana, role: "editor" }) } });
    const [a, b] = s.state.blocks.map((x) => x.id);
    s.setSuggesting(true);
    s.select({ anchor: { block: a!, offset: 6 }, focus: { block: b!, offset: 6 } });
    s.deleteSelection();
    s.acceptAllSuggestions();
    expect(s.state.blocks.map((x) => plainText((x as unknown as { runs: never[] }).runs))).toEqual(["first ", " line"]);
  });
});

describe("saved and copied", () => {
  it("round-trips through the file format, which refuses a bad suggestion", () => {
    const { s, at } = session("Hello");
    s.setSuggesting(true);
    at(5);
    s.typeText("!");
    expect(parseDoc(serializeDoc(s.state))).toEqual(s.state);
    const bad = JSON.parse(serializeDoc(s.state));
    bad.doc.blocks[0].runs[1].marks.suggest.kind = "maybe";
    expect(() => parseDoc(JSON.stringify(bad))).toThrowError(/kind/);
  });

  it("is taken off text that is pasted, which stays as text", () => {
    const blocks: Block[] = [{ id: "a", type: "paragraph", runs: [{ text: "x", marks: { suggest: { id: "g", kind: "insert", by: "ana", at: 1 }, bold: true } }] }];
    expect(stripSuggestions(blocks)[0]).toEqual({ id: "a", type: "paragraph", runs: [{ text: "x", marks: { bold: true } }] });
    const into = new DocumentSession(createDoc("T", [paragraph("")]));
    into.select({ anchor: { block: into.state.blocks[0]!.id, offset: 0 }, focus: { block: into.state.blocks[0]!.id, offset: 0 } });
    into.paste({ fragment: JSON.stringify({ format: "pli.document", version: 1, doc: { id: "f", type: "document", title: "", blocks } }) });
    expect(suggestionsIn(into.state)).toEqual([]);
  });

  it("lists suggestions in the order they appear", () => {
    const doc: Doc = createDoc("T", [{ id: "a", type: "paragraph", runs: [text("x", { suggest: { id: "two", kind: "delete", by: "a", at: 1 } }), text("y", { suggest: { id: "one", kind: "insert", by: "a", at: 1 } })] }]);
    expect(suggestionsIn(doc).map((s) => s.id)).toEqual(["two", "one"]);
  });

  it("is pasted as text in suggesting mode", () => {
    const { s, at } = session("Hello");
    s.setSuggesting(true);
    at(5);
    s.paste({ text: " there\nfriend" });
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestions[0]!.text).toBe(" there\nfriend");
  });
});
