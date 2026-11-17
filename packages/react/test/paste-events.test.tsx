// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DocumentSession,
  FRAGMENT_MIME,
  caret,
  createDoc,
  paragraph,
  plainText,
  table,
  type Block,
  type TableBlock,
} from "@pli.dev/docs";
import { attachEditorEvents } from "../src/events";
import { DocumentView } from "../src/render";

let root: HTMLElement;
let detach: (() => void) | null = null;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  detach?.();
  detach = null;
  root.remove();
});

function setup(blocks: Block[], options: { insertImages?: (f: File[]) => void; pastedImages?: (ids: string[]) => void } = {}) {
  const session = new DocumentSession(createDoc("T", blocks));
  root.innerHTML = renderToStaticMarkup(<DocumentView doc={session.state} />);
  detach = attachEditorEvents(root, session, { isReadOnly: () => false, remount: () => {}, ...options });
  return session;
}

type Payload = Record<string, string>;

function clipboard(payload: Payload, files: File[] = []) {
  return { getData: (type: string) => payload[type] ?? "", setData: vi.fn(), files };
}

function fire(type: "paste" | "copy" | "cut", data: ReturnType<typeof clipboard>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  root.dispatchEvent(event);
  return event;
}

const lines = (s: DocumentSession) => s.state.blocks.map((b) => ("runs" in b ? plainText(b.runs) : `<${b.type}>`));

describe("paste event", () => {
  it("pastes HTML with its formatting and cancels the browser's own paste", () => {
    const s = setup([paragraph("ab")]);
    s.select(caret(s.state.blocks[0]!.id, 1));
    const event = fire("paste", clipboard({ "text/html": "<b>X</b>", "text/plain": "X" }));
    expect(event.defaultPrevented).toBe(true);
    const runs = (s.state.blocks[0] as { runs: { text: string; marks?: object }[] }).runs;
    expect(runs.map((r) => r.text)).toEqual(["a", "X", "b"]);
    expect(runs[1]!.marks).toEqual({ bold: true });
  });

  it("pastes a spreadsheet range from plain text as a table", () => {
    const s = setup([paragraph("")]);
    s.select(caret(s.state.blocks[0]!.id, 0));
    fire("paste", clipboard({ "text/plain": "a\tb\nc\td\n" }));
    expect(s.state.blocks.map((b) => b.type)).toContain("table");
  });

  it("pastes Pli's own format ahead of HTML", () => {
    const a = setup([paragraph("one")]);
    a.select({ anchor: { block: a.state.blocks[0]!.id, offset: 0 }, focus: { block: a.state.blocks[0]!.id, offset: 3 } });
    const out = clipboard({});
    fire("copy", out);
    const written = Object.fromEntries(out.setData.mock.calls) as Payload;
    expect(Object.keys(written).sort()).toEqual([FRAGMENT_MIME, "text/html", "text/plain"].sort());

    a.select(caret(a.state.blocks[0]!.id, 3));
    fire("paste", clipboard({ [FRAGMENT_MIME]: written[FRAGMENT_MIME]!, "text/html": "<p>WRONG</p>", "text/plain": "WRONG" }));
    expect(lines(a)).toEqual(["oneone"]);
  });

  it("copies cells as a table in every format", () => {
    const t = table([["a", "b"], ["c", "d"]]);
    const s = setup([t]);
    const cells = s.state.blocks[0] as TableBlock;
    s.select({ anchor: { block: cells.rows[0]!.cells[0]!.blocks[0]!.id, offset: 0 }, focus: { block: cells.rows[1]!.cells[1]!.blocks[0]!.id, offset: 0 } });
    const out = clipboard({});
    fire("copy", out);
    const written = Object.fromEntries(out.setData.mock.calls) as Payload;
    expect(written["text/plain"]).toBe("a\tb\nc\td");
    expect(written["text/html"]).toContain("<table");
    expect(written[FRAGMENT_MIME]).toContain('"table"');
  });

  it("Ctrl+Shift+V pastes as plain text", () => {
    const s = setup([paragraph("")]);
    s.select(caret(s.state.blocks[0]!.id, 0));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, bubbles: true }));
    fire("paste", clipboard({ "text/html": "<h1>Big</h1>", "text/plain": "Big" }));
    expect(s.state.blocks[0]!.type).toBe("paragraph");
    expect(lines(s)).toEqual(["Big"]);
    // The next ordinary paste is rich again.
    s.select(caret(s.state.blocks[0]!.id, 3));
    fire("paste", clipboard({ "text/html": "<h1>Big</h1>", "text/plain": "Big" }));
    expect(lines(s)).toEqual(["BigBig"]);
  });

  it("inserts a lone image file, but prefers the text when there is some", () => {
    const insertImages = vi.fn();
    const s = setup([paragraph("")], { insertImages });
    s.select(caret(s.state.blocks[0]!.id, 0));
    const png = new File(["x"], "a.png", { type: "image/png" });
    fire("paste", clipboard({}, [png]));
    expect(insertImages).toHaveBeenCalledWith([png]);

    insertImages.mockClear();
    fire("paste", clipboard({ "text/plain": "a\tb\nc\td", "text/html": "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>" }, [png]));
    expect(insertImages).not.toHaveBeenCalled();
    expect(s.state.blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("reports pasted images that need sizing", () => {
    const pastedImages = vi.fn();
    const s = setup([paragraph("")], { pastedImages });
    s.select(caret(s.state.blocks[0]!.id, 0));
    fire("paste", clipboard({ "text/html": '<img src="https://x.dev/a.png">' }));
    const image = s.state.blocks.find((b) => b.type === "image")!;
    expect(pastedImages).toHaveBeenCalledWith([image.id]);
  });

  it("does nothing when read-only", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("ab")]));
    root.innerHTML = renderToStaticMarkup(<DocumentView doc={session.state} />);
    detach = attachEditorEvents(root, session, { isReadOnly: () => true, remount: () => {} });
    session.select(caret(session.state.blocks[0]!.id, 1));
    const event = fire("paste", clipboard({ "text/plain": "X" }));
    expect(event.defaultPrevented).toBe(true);
    expect(lines(session)).toEqual(["ab"]);
  });
});
