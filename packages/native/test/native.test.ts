import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import catalog from "../src/catalog.json";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist/pli-engine.js");

interface Reply<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}
type Pli = Record<string, (...args: never[]) => string>;

/**
 * A fresh JavaScript world with nothing but the language itself: no `window`, no `process`, no `setTimeout`, no `atob`.
 * What runs in JavaScriptCore on an iPhone or QuickJS on Android has no more than this.
 */
function engine(): { call: <T = unknown>(name: string, ...args: unknown[]) => Reply<T>; ok: <T = unknown>(name: string, ...args: unknown[]) => T } {
  const pli = runInNewContext(`${readFileSync(dist, "utf8")}\n;Pli`, Object.create(null)) as Pli;
  const call = <T = unknown>(name: string, ...args: unknown[]): Reply<T> => JSON.parse((pli[name] as unknown as (...a: unknown[]) => string)(...args)) as Reply<T>;
  return {
    call,
    ok: <T = unknown>(name: string, ...args: unknown[]): T => {
      const reply = call<T>(name, ...args);
      if (!reply.ok) throw new Error(`${name}: ${reply.error?.message}`);
      return reply.value as T;
    },
  };
}

beforeAll(() => {
  // Build the script the tests run, so they always test what ships.
  execFileSync("node", [resolve(here, "../scripts/build.mjs")], { stdio: "pipe" });
});

describe("the engine as one script", () => {
  it("runs with nothing around it but the language", () => {
    const e = engine();
    expect(e.ok<string[]>("commands").length).toBe(catalog.commands.length);
    const h = e.ok<number>("open", null, JSON.stringify({ title: "Plain" }));
    expect(e.ok<string>("read", h, "title")).toBe("Plain");
  });

  it("is small enough to ship in an app", () => {
    expect(readFileSync(dist).length).toBeLessThan(400 * 1024);
  });
});

describe("a document through the bridge", () => {
  const open = (json: string | null = null, options: object = {}) => {
    const e = engine();
    const h = e.ok<number>("open", json, JSON.stringify(options));
    const run = <T = boolean>(name: string, ...args: unknown[]) => e.ok<T>("invoke", h, name, JSON.stringify(args));
    const read = <T = unknown>(what: string) => e.ok<T>("read", h, what);
    return { e, h, run, read };
  };

  it("starts empty, with the caret in the first paragraph", () => {
    const { read } = open();
    expect(read<{ type: string }[]>("blocks").map((b) => b.type)).toEqual(["paragraph"]);
    expect(read<{ anchor: { offset: number } }>("selection").anchor.offset).toBe(0);
  });

  it("edits like the editor: typing, Enter, formatting, headings, lists, undo", () => {
    const { run, read } = open();
    run("typeText", "Title here");
    run("setHeading", 1);
    run("splitBlock");
    run("typeText", "Some ");
    run("toggleBold");
    run("typeText", "bold");
    run("toggleBold");
    run("typeText", " text");
    run("splitBlock");
    run("typeText", "item");
    run("toggleBulletedList");
    const blocks = read<{ type: string; text: string; level?: number; list?: string }[]>("blocks");
    expect(blocks.map((b) => [b.type, b.text])).toEqual([["heading", "Title here"], ["paragraph", "Some bold text"], ["list_item", "item"]]);
    expect(blocks[0]!.level).toBe(1);
    expect(blocks[2]!.list).toBe("bullet");
    expect(read<string>("markdown")).toBe("# Title here\n\nSome **bold** text\n\n- item\n");
    expect(read<string>("html")).toContain("<strong>bold</strong>");
    expect(run("undo")).toBe(true);
    expect(read<{ type: string }[]>("blocks")[2]!.type).toBe("paragraph");
    expect(run("redo")).toBe(true);
    expect(read<{ canUndo: boolean }>("state").canUndo).toBe(true);
  });

  it("selects by block and offset, and formats the selection", () => {
    const { run, read } = open();
    run("typeText", "Hello world");
    const id = read<{ id: string }[]>("blocks")[0]!.id;
    run("select", id, 6, id, 11);
    run("setTextColor", "#b91c1c");
    run("setFontSize", 18);
    expect(read<string>("html")).toContain("color:#b91c1c");
    run("setTextColor", null);
    expect(read<string>("html")).not.toContain("color:#b91c1c");
    run("selectAll");
    run("setAlignment", "center");
    expect(read<{ align?: string }[]>("blocks")[0]!.align).toBe("center");
  });

  it("makes tables, images, breaks and named styles", () => {
    const { run, read } = open();
    run("typeText", "Intro");
    run("splitBlock");
    expect(run("insertImage", "data:image/png;base64,iVBORw0KGgo=", 40, 20, "A picture")).toBe(true);
    expect(run("insertPageBreak")).toBe(true);
    // A page break can't go in a table, and a table's cells are where the caret lands.
    expect(run("insertTable", 2, 3)).toBe(true);
    expect(run("insertPageBreak")).toBe(false);
    const types = read<{ type: string; rows?: number; columns?: number }[]>("blocks");
    expect(types.some((b) => b.type === "table" && b.rows === 2 && b.columns === 3)).toBe(true);
    expect(types.map((b) => b.type)).toEqual(expect.arrayContaining(["image", "page_break"]));
    const doc = open();
    doc.run("typeText", "Careful");
    doc.run("selectAll");
    doc.run("toggleItalic");
    const style = doc.run<string | null>("createStyle", "Warning", "paragraph");
    expect(style).toBe("warning");
    expect(Object.keys(doc.read<object>("styles"))).toEqual(["warning"]);
    expect(doc.read<{ style?: string }[]>("blocks")[0]!.style).toBe("warning");
  });

  it("round-trips through its own JSON and through DOCX", () => {
    const a = open();
    a.run("typeText", "Saved");
    a.run("setHeading", 2);
    const json = a.read<string>("document");
    const b = open(json);
    expect(b.read<{ text: string; level?: number }[]>("blocks")[0]).toMatchObject({ text: "Saved", level: 2 });

    const base64 = a.e.ok<string>("exportDocx", a.h);
    expect(base64.length).toBeGreaterThan(1000);
    const c = open();
    const result = c.e.ok<{ warnings: string[] }>("importDocx", c.h, base64);
    expect(result.warnings).toEqual([]);
    expect(c.read<{ text: string; type: string }[]>("blocks")[0]).toMatchObject({ text: "Saved", type: "heading" });
  });

  it("numbers lists: style, start and continue", () => {
    const { run, read } = open();
    run("typeText", "one");
    run("toggleNumberedList");
    run("splitBlock");
    run("typeText", "two");
    run("splitBlock");
    run("typeText", "three");
    const labels = () => read<{ label?: string; marker?: string }[]>("blocks").map((b) => b.label);
    expect(labels()).toEqual(["1.", "2.", "3."]);
    expect(run("setListStart", 1)).toBe(true);
    expect(labels()).toEqual(["1.", "2.", "1."]);
    expect(run("continueNumbering")).toBe(true);
    expect(run("setListMarker", "upper-roman")).toBe(true);
    expect(labels()).toEqual(["I.", "II.", "III."]);
    expect(read<{ marker?: string }[]>("blocks")[0]!.marker).toBe("upper-roman");
    expect(run("setListMarker", null)).toBe(true);
    expect(labels()).toEqual(["1.", "2.", "3."]);
  });

  it("reads the content with marks and list markers, and what a toolbar needs to know", () => {
    const { run, read } = open();
    run("typeText", "Plain ");
    run("toggleBold");
    run("typeText", "bold");
    run("toggleBold");
    run("splitBlock");
    run("typeText", "item");
    run("toggleNumberedList");
    const content = read<{ id: string; type: string; label?: string; runs: { text: string; marks?: { bold?: boolean } }[] }[]>("content");
    expect(content[0]!.runs).toEqual([{ text: "Plain " }, { text: "bold", marks: { bold: true } }]);
    expect(content[1]).toMatchObject({ type: "list_item", label: "1." });
    const format = read<{ block: { type: string; list?: string }; marks: { bold: boolean }; canUndo: boolean; list: { kind: string; number: number } }>("format");
    expect(format.block).toEqual({ type: "list_item", list: "ordered" });
    expect(format.list).toMatchObject({ kind: "ordered", number: 1 });
    expect(format.canUndo).toBe(true);
    run("select", content[0]!.id, 6, content[0]!.id, 10);
    expect(read<{ marks: { bold: boolean } }>("format").marks.bold).toBe(true);
  });

  it("edits tables, merges cells across a selection, and reads the selected text", () => {
    const { run, read } = open();
    run("typeText", "Intro");
    run("splitBlock");
    run("insertTable", 2, 2);
    const cells = () => read<{ type: string; rows?: { cells: { id: string; blocks: { id: string }[]; covered?: boolean }[] }[] }[]>("content").find((b) => b.type === "table")!;
    expect(cells().rows).toHaveLength(2);
    expect(read<{ table: { rows: number; columns: number } }>("format").table).toMatchObject({ rows: 2, columns: 2 });
    run("addRowBelow");
    run("addColumnRight");
    expect(cells().rows).toHaveLength(3);
    expect(cells().rows![0]!.cells).toHaveLength(3);
    const first = cells().rows![0]!.cells[0]!.blocks[0]!.id;
    run("select", first, 0, first, 0);
    run("typeText", "A");
    const second = cells().rows![0]!.cells[1]!.blocks[0]!.id;
    run("select", second, 0, second, 0);
    run("typeText", "B");
    // From one cell to the next: the selection spans cells, so they can be merged and the text read back.
    run("select", first, 0, second, 1);
    expect(read<string>("selectedText")).toContain("A");
    expect(read<{ table: { canMerge: boolean } }>("format").table.canMerge).toBe(true);
    expect(run("mergeCells")).toBe(true);
    expect(cells().rows![0]!.cells.some((cell) => cell.covered)).toBe(true);
    run("deleteTable");
    expect(read<{ type: string }[]>("content").some((b) => b.type === "table")).toBe(false);
  });

  it("copies and pastes with formatting, and moves a table's column edges", () => {
    const { run, read } = open();
    run("typeText", "Plain ");
    run("toggleBold");
    run("typeText", "bold");
    const [only] = read<{ id: string }[]>("content");
    run("select", only!.id, 0, only!.id, 10);
    const clip = read<{ text: string; html: string }>("clipboard");
    expect(clip.text).toBe("Plain bold");
    expect(clip.html).toMatch(/<(b|strong)>bold<\/(b|strong)>/);
    run("select", only!.id, 10, only!.id, 10);
    run("splitBlock");
    expect(run("paste", clip.html, null, clip.text)).toBe(true);
    const runs = read<{ runs: { text: string; marks?: { bold?: boolean } }[] }[]>("content")[1]!.runs;
    expect(runs.some((r) => r.marks?.bold && r.text.includes("bold"))).toBe(true);

    run("insertTable", 1, 3);
    const table = () => read<{ type: string; id: string; columns: number[] }[]>("content").find((b) => b.type === "table")!;
    const id = table().id;
    expect(run("setColumnEdge", id, 0, 0.5, false)).toBe(true);
    const [a, b, c] = table().columns as [number, number, number];
    expect(a).toBeCloseTo(0.5, 2);
    expect(a + b + c).toBeCloseTo(1, 3);
    expect(c).toBeCloseTo(1 / 3, 2);
  });

  it("resizes rows and pictures, and deletes a picture", () => {
    const { run, read } = open();
    run("insertTable", 2, 2);
    const table = () => read<{ type: string; id: string; rows: { height?: number }[] }[]>("content").find((b) => b.type === "table")!;
    expect(run("setRowHeight", table().id, 1, 60, false)).toBe(true);
    expect(table().rows[1]!.height).toBe(60);
    expect(run("setRowHeight", table().id, 1, null, false)).toBe(true);
    expect(table().rows[1]!.height).toBeUndefined();

    const second = open();
    second.run("insertImage", "data:image/png;base64,AAAA", 200, 100, "a picture");
    const picture = () => second.read<{ type: string; id: string; width: number; height: number }[]>("content").find((b) => b.type === "image")!;
    expect(second.run("setImageSize", picture().id, 120, 60, false)).toBe(true);
    expect(second.run("setImageSize", picture().id, 100, 50, true)).toBe(true);
    expect([picture().width, picture().height]).toEqual([100, 50]);
    second.run("undo");
    expect([picture().width, picture().height]).toEqual([200, 100]);
    expect(second.run("deleteImage", picture().id)).toBe(true);
    expect(second.read<{ type: string }[]>("content").some((b) => b.type === "image")).toBe(false);
  });

  it("wraps text around a picture inside a table cell", () => {
    const { run, read } = open();
    run("insertTable", 1, 1);
    const cellBlock = () => read<{ type: string; rows: { cells: { blocks: { id: string; type: string; wrap?: string }[] }[] }[] }[]>("content").find((b) => b.type === "table")!.rows[0]!.cells[0]!.blocks;
    const paragraph = cellBlock()[0]!.id;
    run("select", paragraph, 0, paragraph, 0);
    run("typeText", "Beside the picture");
    run("select", paragraph, 0, paragraph, 0);
    run("insertImage", "data:image/png;base64,AAAA", 60, 30, "in a cell");
    const picture = cellBlock().find((b) => b.type === "image")!;
    expect(run("setImageWrap", picture.id, "left")).toBe(true);
    expect(cellBlock().find((b) => b.type === "image")).toMatchObject({ wrap: "left" });
  });

  it("refuses a list marker it doesn't know", () => {
    const e = engine();
    const h = e.ok<number>("open");
    expect(e.call("invoke", h, "setListMarker", '["roman"]').error?.message).toMatch(/one of decimal/);
  });

  it("suggests, and accepts or rejects, for the user it was opened with", () => {
    const { run, read } = open(null, { user: { id: "u1", name: "Ana", role: "editor" } });
    run("typeText", "Hello");
    expect(run("setSuggesting", true)).toBe(true);
    run("typeText", " there");
    const [one] = read<{ id: string; kind: string; text: string; by: string }[]>("suggestions");
    expect(one).toMatchObject({ kind: "insert", text: " there", by: "u1" });
    expect(read<{ suggesting: boolean }>("state").suggesting).toBe(true);
    expect(run("rejectSuggestion", one!.id)).toBe(true);
    expect(read<string>("plainText")).toBe("Hello");
  });

  it("can't suggest without a user", () => {
    const { run } = open();
    expect(run("setSuggesting", true)).toBe(false);
  });

  it("reports statistics and an outline", () => {
    const { run, read } = open();
    run("typeText", "One two three");
    run("setHeading", 1);
    expect(read<{ words: number }>("statistics").words).toBe(3);
    expect(read<{ level: number; text: string }[]>("outline")).toEqual([expect.objectContaining({ level: 1, text: "One two three" })]);
  });
});

describe("what goes wrong, comes back as an answer", () => {
  const e = engine();
  const h = e.ok<number>("open");
  const fails = (reply: Reply, code: string, message: RegExp) => {
    expect(reply.ok).toBe(false);
    expect(reply.error!.code).toBe(code);
    expect(reply.error!.message).toMatch(message);
  };

  it("never throws across the bridge", () => {
    fails(e.call("invoke", 999, "typeText", '["x"]'), "not_found", /No open document/);
    fails(e.call("invoke", h, "nope", "[]"), "not_found", /No command/);
    fails(e.call("read", h, "nope"), "not_found", /Nothing called/);
    fails(e.call("invoke", h, "typeText", "not json"), "invalid_operation", /JSON/);
    fails(e.call("open", "{not a document}"), "invalid_document", /JSON|document/i);
    fails(e.call("importDocx", h, "AAAA"), "invalid_document", /zip|docx/i);
  });

  it("checks the arguments against the catalog", () => {
    fails(e.call("invoke", h, "typeText", "[]"), "invalid_operation", /takes 1 argument/);
    fails(e.call("invoke", h, "typeText", "[5]"), "invalid_operation", /text should be string/);
    fails(e.call("invoke", h, "setHeading", "[7]"), "invalid_operation", /1 to 6/);
    fails(e.call("invoke", h, "setAlignment", '["middle"]'), "invalid_operation", /one of left, center/);
    fails(e.call("invoke", h, "insertTable", "[2, null]"), "invalid_operation", /columns is required/);
    expect(e.call("invoke", h, "setTextColor", "[null]").ok).toBe(true);
  });

  it("has an implementation for every command in the catalog, and nothing else", () => {
    // Every name in the catalog answers; a name with no implementation would say "No command".
    for (const command of catalog.commands) {
      const args = command.params.map((p) => (p.oneOf ? p.oneOf[0] : p.type.startsWith("string") ? "x" : p.type === "bool" ? false : 1));
      const reply = e.call("invoke", h, command.name, JSON.stringify(args));
      expect(reply.error?.code, command.name).not.toBe("not_found" === reply.error?.code && /No command/.test(reply.error.message) ? "not_found" : "never");
    }
    expect(e.ok<string[]>("commands").sort()).toEqual(catalog.commands.map((c) => c.name).sort());
  });

  it("closes a document", () => {
    const x = engine();
    const id = x.ok<number>("open");
    expect(x.ok<boolean>("close", id)).toBe(true);
    expect(x.call("read", id, "title").ok).toBe(false);
  });
});

describe("the Swift and Kotlin packages", () => {
  it("have the commands and the engine this catalog and this build describe", async () => {
    const generate = (await import("../scripts/generate.mjs")) as { outputs: Record<string, { path: string; text: string }> };
    for (const { path, text } of Object.values(generate.outputs)) {
      expect(readFileSync(path, "utf8") === text, `${path} is out of date: run \`pnpm native\``).toBe(true);
    }
    for (const file of ["pli-engine.js", "pli-sheets.js", "pli-decks.js", "pli-pdf.js"]) {
      const engine = readFileSync(resolve(here, "../dist", file), "utf8");
      for (const copy of [`../../swift/Sources/Pli/Resources/${file}`, `../../kotlin/src/main/resources/${file}`]) {
        expect(readFileSync(resolve(here, copy), "utf8") === engine, `${copy} is out of date: run \`pnpm native\``).toBe(true);
      }
    }
  });

  it("have a method for each command, with the types the catalog gives", async () => {
    const generate = (await import("../scripts/generate.mjs")) as { outputs: Record<string, { path: string; text: string }> };
    for (const command of catalog.commands) {
      expect(generate.outputs.swift!.text).toContain(`func ${command.name}(`);
      expect(generate.outputs.kotlin!.text).toContain(`fun ${command.name}(`);
    }
  });
});
