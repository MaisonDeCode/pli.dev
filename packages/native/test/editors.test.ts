import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { makeSamplePdf } from "@pli.dev/pdf";
import { encodeBase64 } from "@pli.dev/core";
import editorsCatalog from "../src/editors.json";
import catalog from "../src/catalog.json";
import { parseSignature } from "../src/signature.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = (name: string) => resolve(here, "../dist", name);

interface Reply<T = unknown> {
  ok: boolean;
  value?: T;
  pending?: number;
  error?: { code: string; message: string };
  events?: Event[];
}
interface Event {
  type: string;
  handle?: number;
  [key: string]: unknown;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * One engine in a JavaScript world with nothing but the language itself (no timers, no TextEncoder, no atob): what JavaScriptCore and
 * QuickJS give. It plays the app too: events come back on replies and are kept in `events`.
 */
class Engine {
  events: Event[] = [];
  private pli: Record<string, (...args: unknown[]) => string>;
  constructor(file: string) {
    this.pli = runInNewContext(`${readFileSync(dist(file), "utf8")}\n;Pli`, Object.create(null)) as Engine["pli"];
  }
  call<T = unknown>(name: string, ...args: unknown[]): Reply<T> {
    const reply = JSON.parse(this.pli[name]!(...args)) as Reply<T>;
    if (reply.events) this.events.push(...reply.events);
    return reply;
  }
  ok<T = unknown>(name: string, ...args: unknown[]): T {
    const reply = this.call<T>(name, ...args);
    if (!reply.ok) throw new Error(`${name}: ${reply.error?.code} ${reply.error?.message}`);
    return reply.value as T;
  }
  /** Calls and waits for work that is still going (a PDF, a host call the test answers). */
  async wait<T = unknown>(reply: Reply<T>): Promise<T> {
    for (let i = 0; i < 200; i++) {
      await tick();
      if (reply.pending === undefined) break;
      reply = this.call<T>("taskResult", reply.pending);
    }
    if (!reply.ok) throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
    return reply.value as T;
  }
  async okAsync<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    return this.wait(this.call<T>(name, ...args));
  }
  take(type: string): Event[] {
    const found = this.events.filter((e) => e.type === type);
    this.events = this.events.filter((e) => e.type !== type);
    return found;
  }
}

const open = (e: Engine, kind: string, format: string, data: string | null, options: object = {}) => e.ok<number>("openEditor", kind, format, data, JSON.stringify(options));
const invoke = <T = unknown>(e: Engine, h: number, name: string, ...args: unknown[]) => e.ok<T>("invoke", h, name, JSON.stringify(args));
const invokeAsync = <T = unknown>(e: Engine, h: number, name: string, ...args: unknown[]) => e.okAsync<T>("invoke", h, name, JSON.stringify(args));
const exportBytes = async (e: Engine, h: number, format: string, options: object = {}) => {
  const base64 = await e.okAsync<string>("exportFile", h, format, JSON.stringify(options));
  return base64;
};
/** A document's JSON with every object's keys in order, so two equal documents are equal text. */
const canon = (json: string): string => {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, sort(x)])) : v);
  return JSON.stringify(sort(JSON.parse(json)));
};
const text = (base64: string) => Buffer.from(base64, "base64").toString("utf8");

beforeAll(() => {
  execFileSync("node", [resolve(here, "../scripts/build.mjs")], { stdio: "pipe" });
});

describe("the catalog of the editors", () => {
  it("has every method implemented, in every editor", () => {
    for (const [name, file] of [["docs", "pli-engine.js"], ["sheets", "pli-sheets.js"], ["decks", "pli-decks.js"], ["pdf", "pli-pdf.js"]] as const) {
      const e = new Engine(file);
      const h = open(e, name, "json", null);
      const entry = editorsCatalog.editors[name];
      const names = [...(name === "docs" ? catalog.commands.map((c) => c.name) : []), ...entry.methods.map((m) => parseSignature(m.sig, entry.enums).name)];
      expect(new Set(names).size, `${name} has a method twice`).toBe(names.length);
      expect(e.ok<string[]>("methods", name).sort()).toEqual([...names].sort());
      for (const method of names) {
        // With no arguments, a method that has parameters says how many it takes; one that is missing says "No command".
        const reply = e.call("invoke", h, method, "[]");
        expect(reply.error?.message ?? "", `${name}.${method}`).not.toMatch(/No command/);
      }
    }
  });

  it("checks arguments against the types", () => {
    const e = new Engine("pli-sheets.js");
    const h = open(e, "sheets", "json", null);
    const fails = (reply: Reply, message: RegExp) => {
      expect(reply.ok).toBe(false);
      expect(reply.error!.code).toBe("invalid_operation");
      expect(reply.error!.message).toMatch(message);
    };
    fails(e.call("invoke", h, "setCell", JSON.stringify(["Sheet1", "A1"])), /takes 3 arguments/);
    fails(e.call("invoke", h, "setCell", JSON.stringify([1, "A1", 5])), /sheet should be string/);
    fails(e.call("invoke", h, "clear", JSON.stringify(["Sheet1", "A1", "everything"])), /one of all, contents, formats/);
    fails(e.call("invoke", h, "setCells", JSON.stringify(["Sheet1", [1, 2]])), /inputs should be map<scalar>/);
    fails(e.call("invoke", h, "insertRows", JSON.stringify(["Sheet1", 1.5, 1])), /at should be int/);
    fails(e.call("invoke", h, "insertRows", "not json"), /JSON/);
    expect(e.call("invoke", h, "setFormat", JSON.stringify(["Sheet1", "A1", null])).ok).toBe(true);
  });

  it("has the documents catalog still, and only the engines it builds", () => {
    const e = new Engine("pli-engine.js");
    expect(e.ok<string[]>("editors")).toEqual(["docs"]);
    expect(e.ok<string[]>("methods", "docs").length).toBe(catalog.commands.length + editorsCatalog.editors.docs.methods.length);
    expect(e.call("openEditor", "sheets", "json", null).error?.code).toBe("unsupported");
  });
});

describe("Pli.Sheets through the bridge", () => {
  const book = (options: object = {}) => {
    const e = new Engine("pli-sheets.js");
    const h = open(e, "sheets", "json", null, { title: "Budget", ...options });
    return { e, h, run: <T = unknown>(name: string, ...args: unknown[]) => invoke<T>(e, h, name, ...args) };
  };

  it("types into cells, calculates and reads them back", () => {
    const { run } = book();
    run("setCells", "Sheet1", { A1: 10, A2: 32, A3: "=SUM(A1:A2)", B1: "Total", B3: "=A3/0" });
    expect(run("cell", "Sheet1", "A3")).toEqual({ address: "A3", value: 42, error: null, text: "42", formula: "=SUM(A1:A2)", format: null });
    expect(run<{ error: string }>("cell", "sheet1", "B3").error).toBe("#DIV/0!");
    expect(run("value", "Sheet1", "B1")).toBe("Total");
    expect(run("value", "Sheet1", "C9")).toBe(null);
    expect(run("values", "Sheet1", "A1:A3")).toEqual([[10], [32], [42]]);
    expect(run("usedRange", "Sheet1")).toBe("A1:B3");
    expect(run("title")).toBe("Budget");
    run("setFormat", "Sheet1", "A3", "0.00");
    expect(run("text", "Sheet1", "A3")).toBe("42.00");
  });

  it("edits like a spreadsheet: rows, sorting, merging, sheets, undo and redo", () => {
    const { run } = book();
    run("setValues", "Sheet1", "A1", [[3, "c"], [1, "a"], [2, "b"]]);
    run("sort", "Sheet1", "A1:B3", 1, false, false);
    expect(run("values", "Sheet1", "A1:B3")).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    run("insertRows", "Sheet1", 2, 1);
    expect(run("value", "Sheet1", "A3")).toBe(2);
    run("setCell", "Sheet1", "D1", "=A1+A3");
    run("deleteRows", "Sheet1", 2, 1);
    expect(run("value", "Sheet1", "D1")).toBe(3);
    run("mergeCells", "Sheet1", "F1:G2");
    expect(run("merges", "Sheet1")).toEqual(["F1:G2"]);
    const sheet = run<{ id: string; name: string }>("addSheet", "Second", null);
    expect(sheet.name).toBe("Second");
    run("renameSheet", "Second", "Totals");
    run("setCell", "Totals", "A1", "=Sheet1!A1*2");
    expect(run("value", "Totals", "A1")).toBe(2);
    expect(run<{ name: string }[]>("sheets").map((s) => s.name)).toEqual(["Sheet1", "Totals"]);
    run("setStyle", "Sheet1", "A1", { bold: true, fill: "#ffeeaa" });
    expect(run("undo")).toBe(true);
    expect(run("redo")).toBe(true);
    expect(run<{ canUndo: boolean }>("usedRange", "Sheet1")).toBeTruthy();
    expect(run<unknown[]>("find", "b", null, null, null).length).toBe(1);
    expect(run<{ cells: number }>("replace", "b", "B", true, true, "Sheet1").cells).toBe(1);
    expect(run("value", "Sheet1", "B2")).toBe("B");
  });

  it("applies the same operations the editor and live editing use, and runs any method by name", () => {
    const { e, h, run } = book();
    const id = run<{ id: string }[]>("sheets")[0]!.id;
    e.ok("apply", h, JSON.stringify([{ type: "set_cells", sheet: id, cells: { A1: { v: 5 }, A2: { f: "A1*2" } } }]));
    expect(run("value", "Sheet1", "A2")).toBe(10);
    expect(JSON.parse(e.ok<string>("call", h, "value", JSON.stringify(["Sheet1", "A2"])) as string)).toBe(10);
    expect(e.ok("call", h, "value", JSON.stringify(["Sheet1", "A2"]))).toBe(10);
    expect(e.call("call", h, "constructor", "[]").error?.code).toBe("not_found");
    expect(e.call("call", h, "nope", "[]").error?.code).toBe("not_found");
    expect(e.call("apply", h, '{"not":"a list"}').ok).toBe(false);
    expect(e.ok<{ canUndo: boolean }>("read", h, "state").canUndo).toBe(true);
    const document = e.ok<string>("read", h, "document");
    const copy = open(e, "sheets", "json", document);
    expect(invoke(e, copy, "value", "Sheet1", "A2")).toBe(10);
  });

  it("tells the app about changes, once asked", () => {
    const { e, h, run } = book();
    run("setCell", "Sheet1", "A1", 1);
    expect(e.take("change")).toEqual([]);
    e.ok("watch", h, "change", true);
    run("setCell", "Sheet1", "A1", 2);
    const [change] = e.take("change");
    expect(change).toMatchObject({ handle: h, origin: "local", canUndo: true, canRedo: false });
    expect((change!.ops as { type: string }[])[0]!.type).toBe("set_cells");
    run("undo");
    expect(e.take("change")[0]).toMatchObject({ origin: "undo", canRedo: true });
    e.ok("watch", h, "change", false);
    run("redo");
    expect(e.take("change")).toEqual([]);
  });

  it("exports and imports XLSX, CSV and PDF", async () => {
    const { e, h, run } = book();
    run("setValues", "Sheet1", "A1", [["Item", "Cost"], ["Pens", 12.5], ["Paper", 30]]);
    run("setCell", "Sheet1", "B4", "=SUM(B2:B3)");
    run("setStyle", "Sheet1", "A1:B1", { bold: true });

    const xlsx = await exportBytes(e, h, "xlsx");
    expect(Buffer.from(xlsx, "base64").subarray(0, 2).toString()).toBe("PK");
    const reopened = open(e, "sheets", "xlsx", xlsx);
    expect(invoke(e, reopened, "value", "Sheet1", "B4")).toBe(42.5);
    expect(invoke(e, reopened, "values", "Sheet1", "A1:B2")).toEqual([["Item", "Cost"], ["Pens", 12.5]]);

    expect(text(await exportBytes(e, h, "csv"))).toBe("Item,Cost\r\nPens,12.5\r\nPaper,30\r\n,42.5\r\n".replace(/\r\n/g, text(await exportBytes(e, h, "csv")).includes("\r\n") ? "\r\n" : "\n"));
    expect(text(await exportBytes(e, h, "csv", { delimiter: ";" }))).toContain("Item;Cost");
    const imported = open(e, "sheets", "csv", "x,y\n1,2\n");
    expect(invoke(e, imported, "values", "Sheet1", "A1:B2")).toEqual([["x", "y"], [1, 2]]);
    e.ok("importFile", h, "csv", "a,b\n3,4\n");
    expect(run("value", "Sheet1", "B2")).toBe(4);
    expect(e.call("importFile", h, "xlsx", "AAAA").error?.code).toBe("invalid_document");

    const pdf = await exportBytes(e, h, "pdf", { sheet: "Sheet1" });
    expect(Buffer.from(pdf, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("opens an XLSX file with warnings reported", () => {
    const e = new Engine("pli-sheets.js");
    expect(e.call("openEditor", "sheets", "xlsx", "AAAA").error?.code).toBe("invalid_document");
  });
});

describe("Pli.Decks through the bridge", () => {
  const deck = () => {
    const e = new Engine("pli-decks.js");
    const h = open(e, "decks", "json", null, { title: "Launch" });
    return { e, h, run: <T = unknown>(name: string, ...args: unknown[]) => invoke<T>(e, h, name, ...args) };
  };

  it("makes slides and fills them", () => {
    const { run } = deck();
    expect(run("title")).toBe("Launch");
    const first = run<{ id: string; layout: string }[]>("slides")[0]!;
    const second = run<{ id: string }>("addSlide", null, first.id);
    expect(run<unknown[]>("slides").length).toBe(2);
    const box = run<string>("addTextBox", second.id, 40, 60, 300, 40, "Hello deck");
    const els = run<{ id: string; type: string; text: string | null; x: number }[]>("elements", second.id);
    expect(els.find((x) => x.id === box)).toMatchObject({ type: "shape", text: "Hello deck", x: 40 });
    run("setText", second.id, box, "Line one\nLine two");
    expect(run<{ id: string; text: string }[]>("elements", second.id).find((x) => x.id === box)!.text).toBe("Line one\nLine two");
    run("formatText", second.id, [box], { bold: true, fontSize: 30 });
    run("setFrame", second.id, box, 10, null, null, null, 15);
    expect(run<{ id: string; x: number; rotation: number }[]>("elements", second.id).find((x) => x.id === box)).toMatchObject({ x: 10, rotation: 15 });
    run("setNotes", second.id, "Say hello");
    expect(run("notes", second.id)).toBe("Say hello");
    const shape = run<string>("addShape", second.id, "ellipse", 200, 120, 100, 100);
    run("setFill", second.id, [shape], "#c00000");
    run("arrange", second.id, [shape], "back");
    expect(run<string[]>("duplicateElements", second.id, [shape]).length).toBe(1);
    run("deleteElements", second.id, [shape]);
    run("addTable", second.id, 2, 3);
    run("addChart", second.id, "pie");
    expect(run<{ text: string }[]>("find", "Line", null, null).length).toBe(2);
    expect(run("replaceAll", "Line", "Row", true, false)).toBe(2);
    run("setSkipped", [second.id], true);
    expect(run<{ skipped: boolean }[]>("slides")[1]!.skipped).toBe(true);
    expect(run("undo")).toBe(true);
    run("duplicateSlides", [second.id]);
    run("moveSlides", [second.id], 0);
    run("deleteSlides", [second.id]);
    expect(run<{ name: string }[]>("layouts").length).toBeGreaterThan(2);
    expect(run("size")).toEqual({ width: 720, height: 405 });
    expect(run<string>("addChart", first.id, "column")).toBeTruthy();
    expect(() => run("addChart", first.id, "radar")).toThrow(/column/);
  });

  it("exports and imports PPTX and PDF", async () => {
    const { e, h, run } = deck();
    const slide = run<{ id: string }[]>("slides")[0]!.id;
    run("addTextBox", slide, 40, 200, 400, 40, "Quarterly review");
    const pptx = await exportBytes(e, h, "pptx");
    expect(Buffer.from(pptx, "base64").subarray(0, 2).toString()).toBe("PK");
    const again = open(e, "decks", "pptx", pptx);
    const slides = invoke<{ id: string }[]>(e, again, "slides");
    expect(slides.length).toBe(1);
    expect(invoke<{ text: string | null }[]>(e, again, "elements", slides[0]!.id).some((x) => x.text === "Quarterly review")).toBe(true);
    const pdf = await exportBytes(e, h, "pdf");
    expect(Buffer.from(pdf, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    e.ok("importFile", h, "pptx", pptx);
    expect(run<unknown[]>("slides").length).toBe(1);
  });
});

describe("Pli.PDF through the bridge", () => {
  const sample = async () => encodeBase64(await makeSamplePdf());
  const viewer = async (options: object = {}) => {
    const e = new Engine("pli-pdf.js");
    const h = open(e, "pdf", "pdf", await sample(), options);
    return { e, h, run: <T = unknown>(name: string, ...args: unknown[]) => invoke<T>(e, h, name, ...args), runAsync: <T = unknown>(name: string, ...args: unknown[]) => invokeAsync<T>(e, h, name, ...args) };
  };

  it("reads pages, text, form fields and metadata", async () => {
    const { run, runAsync } = await viewer();
    const pages = run<{ id: string; number: number; width: number }[]>("pages");
    expect(pages.map((p) => [p.number, p.width])).toEqual([[1, 612], [2, 612]]);
    expect(await runAsync<string>("text", pages[0]!.id)).toContain("Pli.PDF sample");
    const hits = await runAsync<{ page: string; text: string }[]>("search", "sample", false, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.page).toBe(pages[0]!.id);
    expect(run<{ name: string }[]>("fields").map((f) => f.name)).toEqual(["name", "colour", "subscribe", "signature"]);
    expect(run<{ title: string }>("metadata").title).toBe("Pli.PDF sample");
    expect(Array.isArray(run("outline"))).toBe(true);
  });

  it("annotates, fills in forms, rearranges pages and redacts", async () => {
    const { run, runAsync } = await viewer();
    const [one, two] = run<{ id: string }[]>("pages").map((p) => p.id) as [string, string];
    const note = run<string>("addNote", one, 100, 100, "Check this");
    const mark = run<string>("addHighlight", one, [{ x: 72, y: 700, w: 100, h: 12 }], "underline", "#1e88e5", "quote");
    run("addShape", two, "circle", 50, 50, 80, 80, "#ff0000");
    run("addFreeText", two, 50, 200, 200, 30, "Free text");
    run("addLink", two, 50, 300, 100, 20, "https://example.com/");
    expect(run<{ id: string; type: string }[]>("annotations", one).map((a) => a.type)).toEqual(["link", "link", "note", "underline"]);
    run("setAnnotationText", note, "Checked");
    run("moveAnnotations", [note], 5, 5);
    run("removeAnnotations", [mark]);
    expect(run<unknown[]>("annotations", one).length).toBe(3);
    expect(run<string[]>("fillForm", { name: "Ada", colour: "Blue", subscribe: true })).toEqual(["f:name", "f:colour", "f:subscribe"]);
    expect(run<Record<string, unknown>>("formData")).toMatchObject({ name: "Ada", colour: "Blue", subscribe: true });
    const field = run<{ id: string; name: string }[]>("fields")[0]!;
    run("setFieldValue", field.id, "Grace");
    expect(run<{ value: unknown }[]>("fields")[0]!.value).toBe("Grace");
    run("setMetadata", { title: "Renamed" });
    expect(run<{ title: string }>("metadata").title).toBe("Renamed");
    run("rotatePages", [two], 90);
    expect(run<{ rotate: number }[]>("pages")[1]!.rotate).toBe(90);
    expect(() => run("rotatePages", [two], 45)).toThrow(/90/);
    const blank = run<string>("insertBlankPage", one, null, null);
    expect(run<{ id: string }[]>("pages").map((p) => p.id)).toEqual([one, blank, two]);
    run("movePages", [blank], 2);
    run("duplicatePages", [two]);
    expect(run<unknown[]>("pages").length).toBe(4);
    run("deletePages", [blank]);
    const marks = await runAsync<string[]>("markSearchRedactions", "sample");
    expect(marks.length).toBeGreaterThan(0);
    const result = await runAsync<{ rects: number }>("applyRedactions", null);
    expect(result.rects).toBeGreaterThan(0);
    expect(run("undo")).toBe(true);
  });

  it("saves the file with the changes, and opens it again", async () => {
    const { e, h, run } = await viewer();
    const one = run<{ id: string }[]>("pages")[0]!.id;
    run("addNote", one, 100, 100, "Hello from native");
    run("fillForm", { name: "Ada" });
    const saved = await exportBytes(e, h, "pdf");
    expect(Buffer.from(saved, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    const again = open(e, "pdf", "pdf", saved);
    expect(invoke<{ contents: string }[]>(e, again, "annotations", invoke<{ id: string }[]>(e, again, "pages")[0]!.id).some((a) => a.contents === "Hello from native")).toBe(true);
    expect(invoke<Record<string, unknown>>(e, again, "formData").name).toBe("Ada");
    expect(e.ok<{ dirty: boolean }>("read", h, "state").dirty).toBe(false);
    e.ok("importFile", h, "pdf", saved);
    expect(run<unknown[]>("pages").length).toBe(2);
  });

  it("starts from a blank page", () => {
    const e = new Engine("pli-pdf.js");
    const h = open(e, "pdf", "json", null, { width: 300, height: 200 });
    expect(invoke<{ width: number; height: number }[]>(e, h, "pages")).toMatchObject([{ width: 300, height: 200 }]);
  });
});

describe("what every editor shares", () => {
  const ada = { id: "u_ada", name: "Ada" };
  const grace = { id: "u_grace", name: "Grace" };

  it("comments on a cell, a slide, an element and a page, with mentions, roles and events", async () => {
    const e = new Engine("pli-sheets.js");
    const h = open(e, "sheets", "json", null, { user: { ...ada, role: "editor" } });
    e.ok("watch", h, "comments", true);
    invoke(e, h, "setCell", "Sheet1", "B2", 5);
    const thread = invoke<{ id: string; anchor: { sheet: string; range: string }; comments: { author: string; body: string; mentions?: string[] }[] }>(e, h, "commentOnRange", "Sheet1", "B2:C3", "Is this right? @Grace", ["u_grace"]);
    expect(thread.anchor.range).toBe("B2:C3");
    expect(thread.comments[0]).toMatchObject({ author: "u_ada", body: "Is this right? @Grace", mentions: ["u_grace"] });
    expect(invoke<unknown[]>(e, h, "threadsAt", "Sheet1", "C3").length).toBe(1);
    expect(invoke<unknown[]>(e, h, "threadsAt", "Sheet1", "D4").length).toBe(0);
    const reply = e.ok<{ id: string }>("commentsReply", h, thread.id, "Yes", null);
    e.ok("commentsResolve", h, thread.id, true);
    expect(e.ok<{ id: string; resolved?: { by: string } }[]>("comments", h)[0]!.resolved!.by).toBe("u_ada");
    e.ok("commentsResolve", h, thread.id, false);
    e.ok("commentsEdit", h, thread.id, reply.id, "Yes, it is", null);
    expect(e.ok<{ comments: { body: string }[] }[]>("comments", h)[0]!.comments.map((c) => c.body)).toEqual(["Is this right? @Grace", "Yes, it is"]);
    expect(e.take("comments").map((x) => (x.change as { type: string }).type)).toEqual(["thread.create", "comment.add", "thread.resolve", "thread.reopen", "comment.edit"]);
    expect(e.ok("commentsCan", h, "comment", null)).toBe(true);
    e.ok("commentsDelete", h, thread.id, reply.id);
    e.ok("commentsDelete", h, thread.id, null);
    expect(e.ok<unknown[]>("comments", h)).toEqual([]);

    // A viewer may look and not write.
    e.ok("setUser", h, JSON.stringify(grace), "viewer");
    expect(e.ok("commentsCan", h, "comment", null)).toBe(false);
    expect(e.call("commentsCreate", h, "No", null, null).error?.message).toMatch(/Not allowed/);
    expect(e.ok<{ user: { id: string }; role: string }>("currentUser", h)).toMatchObject({ user: { id: "u_grace" }, role: "viewer" });

    const d = new Engine("pli-decks.js");
    const dh = open(d, "decks", "json", null, { user: ada });
    const slide = invoke<{ id: string }[]>(d, dh, "slides")[0]!.id;
    const onSlide = invoke<{ anchor: { slide: string } }>(d, dh, "commentOnSlide", slide, "Title is long", null);
    expect(onSlide.anchor).toEqual({ slide });
    const box = invoke<string>(d, dh, "addTextBox", slide, 0, 0, 10, 10, "x");
    invoke(d, dh, "commentOnElement", slide, box, "Too small", null);
    expect(invoke<unknown[]>(d, dh, "threadsOn", slide, null).length).toBe(2);
    expect(invoke<unknown[]>(d, dh, "threadsOn", slide, box).length).toBe(1);
    expect(d.call("invoke", dh, "commentOnElement", JSON.stringify([slide, "nope", "x", null])).error?.code).toBe("not_found");

    const p = new Engine("pli-pdf.js");
    const ph = open(p, "pdf", "pdf", encodeBase64(await makeSamplePdf()), { user: grace });
    const page = invoke<{ id: string }[]>(p, ph, "pages")[0]!.id;
    const noted = invoke<{ id: string; anchor: { page: string; x: number } }>(p, ph, "addComment", page, 120, 300, "Typo here", null);
    expect(noted.anchor).toMatchObject({ page, x: 120 });
    expect(invoke<{ type: string; thread: string }[]>(p, ph, "annotations", page).some((a) => a.type === "note" && a.thread === noted.id)).toBe(true);
    const hl = invoke<string>(p, ph, "addHighlight", page, [{ x: 72, y: 600, w: 50, h: 10 }], null, null, "quoted");
    expect(invoke<{ anchor: { annot: string } }>(p, ph, "commentOnAnnotation", hl, "Why?", null).anchor.annot).toBe(hl);
    // The PDF keeps its comments in the file.
    const saved = await p.okAsync<string>("exportFile", ph, "pdf", "{}");
    const again = open(p, "pdf", "pdf", saved, { user: ada });
    expect(p.ok<{ comments: { body: string }[] }[]>("comments", again).map((t) => t.comments[0]!.body).sort()).toEqual(["Typo here", "Why?"]);
  });

  it("opens documents with comments, suggestions and comments on the selection", () => {
    const e = new Engine("pli-engine.js");
    const h = open(e, "docs", "json", null, { user: ada });
    invoke(e, h, "typeText", "Hello world");
    const id = (e.ok<{ id: string }[]>("read", h, "blocks") as { id: string }[])[0]!.id;
    invoke(e, h, "select", id, 0, id, 5);
    const thread = e.ok<{ id: string; anchor: { block: string } }>("commentsCreate", h, "Greeting?", null, null);
    expect(thread.id).toBeTruthy();
    expect(e.ok<unknown[]>("comments", h).length).toBe(1);
  });

  it("asks the app for people, comments and files, and waits for the answer", async () => {
    const e = new Engine("pli-engine.js");
    const h = open(e, "docs", "json", null, { user: ada, host: ["directory", "storage", "comments"], storage: { maxBytes: 1000, allowedTypes: ["image/*"] } });
    // The comment store the app gave is asked to load the file's threads.
    e.call("pump");
    const [load] = e.take("host").filter((x) => x.kind === "comments.load");
    expect(load!.payload).toMatchObject({ file: expect.any(String) });
    e.ok("hostResolve", load!.id, "[]");

    // A person the engine doesn't know is asked for.
    e.ok("getUser", h, "u_grace");
    await tick();
    e.call("pump");
    const [lookup] = e.take("host").filter((x) => x.kind === "users.lookup");
    expect(lookup!.payload).toEqual({ ids: ["u_grace"] });
    e.ok("hostResolve", lookup!.id, JSON.stringify([{ id: "u_grace", name: "Grace Hopper" }]));
    await tick();
    expect(e.ok<{ name: string }>("getUser", h, "u_grace").name).toBe("Grace Hopper");

    // Saving a comment goes to the app's store.
    e.ok("commentsCreate", h, "Stored by the app", null, null);
    await tick();
    e.call("pump");
    const [save] = e.take("host").filter((x) => x.kind === "comments.save");
    expect(save!.payload).toMatchObject({ change: { type: "thread.create" } });
    e.ok("hostResolve", save!.id, "null");

    // An upload goes to the app's storage, after the limits are checked.
    const upload = e.call("storageUpload", h, "dot.png", "image/png", encodeBase64(new Uint8Array([1, 2, 3])));
    await tick();
    e.call("pump");
    const [req] = e.take("host").filter((x) => x.kind === "storage.upload");
    expect(req!.payload).toMatchObject({ name: "dot.png", type: "image/png", data: "AQID" });
    e.ok("hostResolve", req!.id, JSON.stringify({ ref: "files/dot.png", url: "https://cdn.example/dot.png" }));
    expect(await e.wait(upload)).toEqual({ ref: "files/dot.png", url: "https://cdn.example/dot.png" });
    await expect(e.wait(e.call("storageUpload", h, "doc.txt", "text/plain", "AQID"))).rejects.toThrow(/aren't allowed/);
    await expect(e.wait(e.call("storageUpload", h, "big.png", "image/png", encodeBase64(new Uint8Array(2000))))).rejects.toThrow(/too large|larger|limit|1000|bytes/i);
    e.call("pump");
    expect(e.take("host").filter((x) => x.kind === "storage.upload").length).toBe(0);

    // The app can fail, and the engine says so.
    const failing = e.call("storageResolve", h, "files/dot.png");
    await tick();
    e.call("pump");
    const [resolveReq] = e.take("host").filter((x) => x.kind === "storage.resolve");
    e.ok("hostResolve", resolveReq!.id, null, JSON.stringify({ code: "storage", message: "offline" }));
    await expect(e.wait(failing)).rejects.toThrow(/offline/);
  });

  it("keeps a PDF's own file in the app's storage when there is one", async () => {
    const e = new Engine("pli-pdf.js");
    const h = open(e, "pdf", "pdf", encodeBase64(await makeSamplePdf()), { user: ada, host: ["storage"] });
    await tick();
    e.call("pump");
    const [source] = e.take("host").filter((x) => x.kind === "storage.upload");
    expect(source!.payload).toMatchObject({ type: "application/pdf" });
    e.ok("hostResolve", source!.id, JSON.stringify({ ref: "pdf/source-1" }));
    await tick();
    const saved = await e.okAsync<string>("exportFile", h, "pdf", "{}");
    expect(Buffer.from(saved, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("puts the engine's timers in the app's hands", () => {
    const e = new Engine("pli-sheets.js");
    expect(e.ok<number>("tick")).toBe(0);
  });
});

// ---- Live editing -------------------------------------------------------------------------------------------------

/**
 * Clients and a sequencer, all in engines of their own, joined by this loop in place of a network: what a client sends goes to the
 * sequencer and the other clients, what the sequencer answers goes to everyone.
 */
class Net {
  clients: { name: string; e: Engine; h: number; sent: number }[] = [];
  authority: { e: Engine; id: number } | null = null;
  private joined = new Set<number>();
  constructor(private readonly kind: string, private readonly file: string, private readonly room: string) {}

  withAuthority(initial: string | null, via: Engine) {
    this.authority = { e: via, id: via.ok<number>("authorityOpen", this.kind, initial) };
    return this;
  }

  client(name: string, e: Engine, h: number) {
    this.clients.push({ name, e, h, sent: 0 });
    return this.clients[this.clients.length - 1]!;
  }

  async flush(rounds = 40): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await tick();
      let moved = false;
      for (const c of this.clients) {
        c.e.call("pump");
        for (const ev of c.e.take("host")) {
          if (ev.kind === "transport.connect") {
            c.e.ok("hostResolve", ev.id, "null");
            this.joined.add(c.h);
            moved = true;
          }
        }
        for (const ev of c.e.take("transport.send")) {
          if (ev.handle !== c.h) continue;
          moved = true;
          c.sent++;
          for (const other of this.clients) if (other !== c) other.e.call("transportReceive", other.h, ev.json);
          if (this.authority) this.authority.e.call("authorityReceive", this.authority.id, this.room, ev.json);
        }
      }
      if (this.authority) {
        this.authority.e.call("pump");
        for (const ev of this.authority.e.take("authority.send")) {
          moved = true;
          for (const c of this.clients) c.e.call("transportReceive", c.h, ev.json);
        }
      }
      if (!moved && i > 2) return;
    }
  }
}

describe("live editing from the app", () => {
  const ada = { id: "u_ada", name: "Ada" };
  const grace = { id: "u_grace", name: "Grace" };

  it("keeps two documents, a sequencer and comments in step, with presence", async () => {
    const shared = new Engine("pli-engine.js");
    const net = new Net("docs", "doc", "room-1");
    const start = shared.ok<number>("openEditor", "docs", "json", null, JSON.stringify({ title: "Shared", user: ada, live: true }));
    const initial = shared.ok<string>("read", start, "document");
    net.withAuthority(initial, shared);

    const a = new Engine("pli-engine.js");
    const b = new Engine("pli-engine.js");
    const ha = open(a, "docs", "json", initial, { user: ada, live: true });
    const hb = open(b, "docs", "json", initial, { user: grace, live: true });
    for (const [e, h] of [[a, ha], [b, hb]] as const) {
      e.ok("watch", h, "sync", true);
      e.ok("watch", h, "peers", true);
      e.ok("syncStart", h, JSON.stringify({ room: "room-1", version: null, verifyEvery: 0 }));
    }
    const ca = net.client("a", a, ha);
    const cb = net.client("b", b, hb);
    await net.flush();
    expect(a.ok<{ status: string; version: number }>("syncStatus", ha)).toMatchObject({ status: "synced", version: 0 });

    invoke(a, ha, "typeText", "Hello from Ada");
    await net.flush();
    expect(b.ok<string>("read", hb, "plainText")).toBe("Hello from Ada");
    expect(a.ok<{ status: string; unsynced: number; version: number }>("syncStatus", ha)).toMatchObject({ status: "synced", unsynced: 0, version: 1 });

    // Both type at once, and both end up with the same document.
    invoke(a, ha, "typeText", "!");
    invoke(b, hb, "select", (b.ok<{ id: string }[]>("read", hb, "blocks"))[0]!.id, 0, (b.ok<{ id: string }[]>("read", hb, "blocks"))[0]!.id, 0);
    invoke(b, hb, "typeText", ">> ");
    await net.flush();
    expect(a.ok<string>("read", ha, "plainText")).toBe(b.ok<string>("read", hb, "plainText"));
    expect(a.ok<string>("read", ha, "plainText")).toBe(">> Hello from Ada!");
    expect(a.ok<string>("read", ha, "document")).toBe(b.ok<string>("read", hb, "document"));

    // Comments travel the same room.
    const thread = a.ok<{ id: string }>("commentsCreate", ha, "Nice", JSON.stringify({ block: "x" }), null);
    await net.flush();
    expect(b.ok<{ id: string }[]>("comments", hb).map((t) => t.id)).toEqual([thread.id]);

    // Presence: Grace shows up for Ada, with a cursor.
    b.ok("setPresence", hb, JSON.stringify({ note: "typing" }));
    await net.flush();
    const peers = a.ok<{ user: { id: string }; state: { note?: string; selection?: unknown } }[]>("peers", ha);
    expect(peers.map((p) => p.user.id)).toEqual(["u_grace"]);
    expect(peers[0]!.state.note).toBe("typing");
    expect(peers[0]!.state.selection).toBeTruthy();
    expect(a.events.some((x) => x.type === "peers")).toBe(true);
    expect(a.events.some((x) => x.type === "sync")).toBe(true);

    // A client that goes offline keeps its changes and sends them when it is back.
    b.ok("syncOnline", hb, false);
    invoke(b, hb, "typeText", "offline ");
    await net.flush();
    expect(b.ok<{ status: string; unsynced: number }>("syncStatus", hb)).toMatchObject({ status: "offline", unsynced: 1 });
    expect(a.ok<string>("read", ha, "plainText")).not.toContain("offline");
    b.ok("syncOnline", hb, true);
    await net.flush();
    expect(a.ok<string>("read", ha, "plainText")).toContain("offline");
    expect(a.ok<string>("read", ha, "document")).toBe(b.ok<string>("read", hb, "document"));

    b.ok("syncStop", hb);
    expect(b.ok<{ room: string }>("syncStatus", hb).room).toBe("idle");
    expect(ca.sent).toBeGreaterThan(0);
    expect(cb.sent).toBeGreaterThan(0);
  });

  it("keeps PDFs in step: annotations and comments reach the other client", async () => {
    const bytes = encodeBase64(await makeSamplePdf());
    const hub = new Engine("pli-pdf.js");
    const seed = open(hub, "pdf", "pdf", bytes, { user: ada });
    const net = new Net("pdf", "pdf", "pdf-room").withAuthority(hub.ok<string>("read", seed, "document"), hub);
    const a = new Engine("pli-pdf.js");
    const b = new Engine("pli-pdf.js");
    const ha = open(a, "pdf", "pdf", bytes, { user: ada });
    const hb = open(b, "pdf", "pdf", bytes, { user: grace });
    for (const [e, h] of [[a, ha], [b, hb]] as const) e.ok("syncStart", h, JSON.stringify({ room: "pdf-room", version: null, verifyEvery: 0 }));
    net.client("a", a, ha);
    net.client("b", b, hb);
    await net.flush();
    const page = invoke<{ id: string }[]>(a, ha, "pages")[0]!.id;
    invoke(a, ha, "addNote", page, 50, 50, "from a");
    invoke(b, hb, "addComment", page, 80, 80, "from b", null);
    await net.flush();
    expect(invoke<unknown[]>(a, ha, "annotations", page).length).toBe(4);
    expect(invoke<unknown[]>(b, hb, "annotations", page).length).toBe(4);
    expect(a.ok<unknown[]>("comments", ha).length).toBe(1);
    expect(a.ok<string>("read", ha, "document")).toBe(b.ok<string>("read", hb, "document"));
  });

  it("keeps workbooks in step: cells, a sort, and comments on a cell", async () => {
    const hub = new Engine("pli-sheets.js");
    const seed = open(hub, "sheets", "json", null, { user: ada });
    const net = new Net("sheets", "sheets", "book-room").withAuthority(hub.ok<string>("read", seed, "document"), hub);
    const a = new Engine("pli-sheets.js");
    const b = new Engine("pli-sheets.js");
    const initial = hub.ok<string>("read", seed, "document");
    const ha = open(a, "sheets", "json", initial, { user: ada });
    const hb = open(b, "sheets", "json", initial, { user: grace });
    for (const [e, h] of [[a, ha], [b, hb]] as const) e.ok("syncStart", h, JSON.stringify({ room: "book-room", version: null, verifyEvery: 0 }));
    net.client("a", a, ha);
    net.client("b", b, hb);
    await net.flush();
    invoke(a, ha, "setCell", "Sheet1", "A1", 10);
    invoke(b, hb, "setCell", "Sheet1", "B1", "=A1*2");
    await net.flush();
    expect(invoke(a, ha, "value", "Sheet1", "B1")).toBe(20);
    expect(invoke(b, hb, "value", "Sheet1", "A1")).toBe(10);
    invoke(a, ha, "commentOnRange", "Sheet1", "A1", "Why ten?", null);
    await net.flush();
    expect(b.ok<unknown[]>("comments", hb).length).toBe(1);
    expect(canon(a.ok<string>("read", ha, "document"))).toBe(canon(b.ok<string>("read", hb, "document")));
  });

  it("keeps decks in step: slides, text and comments", async () => {
    const hub = new Engine("pli-decks.js");
    const seed = open(hub, "decks", "json", null, { user: ada });
    const initial = hub.ok<string>("read", seed, "document");
    const net = new Net("decks", "decks", "deck-room").withAuthority(initial, hub);
    const a = new Engine("pli-decks.js");
    const b = new Engine("pli-decks.js");
    const ha = open(a, "decks", "json", initial, { user: ada });
    const hb = open(b, "decks", "json", initial, { user: grace });
    for (const [e, h] of [[a, ha], [b, hb]] as const) e.ok("syncStart", h, JSON.stringify({ room: "deck-room", version: null, verifyEvery: 0 }));
    net.client("a", a, ha);
    net.client("b", b, hb);
    await net.flush();
    const slide = invoke<{ id: string }[]>(a, ha, "slides")[0]!.id;
    const box = invoke<string>(a, ha, "addTextBox", slide, 10, 10, 100, 30, "Hello");
    invoke(b, hb, "addSlide", null, null);
    await net.flush();
    expect(invoke<unknown[]>(b, hb, "slides").length).toBe(2);
    expect(invoke<{ text: string | null }[]>(b, hb, "elements", slide).some((x) => x.text === "Hello")).toBe(true);
    invoke(b, hb, "commentOnElement", slide, box, "Bigger?", null);
    await net.flush();
    expect(a.ok<unknown[]>("comments", ha).length).toBe(1);
    expect(a.ok<string>("read", ha, "document")).toBe(b.ok<string>("read", hb, "document"));
  });
});

describe("scripts", () => {
  it("run against the file: reading, changing through operations, grants, limits and taking back what failed", () => {
    const e = new Engine("pli-sheets.js");
    const h = open(e, "sheets", "json", null);
    const id = invoke<{ id: string }[]>(e, h, "sheets")[0]!.id;
    const run = (source: string, options: object = {}) => e.call("scriptRun", h, source, JSON.stringify(options));
    const done = run(`ctx.apply([{ type: "set_cells", sheet: "${id}", cells: { A1: { v: 4 }, A2: { f: "A1*10" } } }]); return ctx.state.sheets.length;`);
    expect(done.ok && done.value).toBe(1);
    expect(invoke(e, h, "value", "Sheet1", "A2")).toBe(40);
    // One run is one undo step.
    expect(invoke(e, h, "undo")).toBe(true);
    expect(invoke(e, h, "value", "Sheet1", "A2")).toBe(null);
    // A run that throws is taken back.
    const broken = run(`ctx.apply([{ type: "set_cells", sheet: "${id}", cells: { A1: { v: 1 } } }]); throw new Error("no");`);
    expect(broken.ok).toBe(false);
    expect(invoke(e, h, "value", "Sheet1", "A1")).toBe(null);
    // Grants and limits.
    expect(run("return ctx.state.title", { grants: ["write"] }).error?.message).toMatch(/not allowed to read/);
    expect(run(`ctx.apply([{ type: "set_cells", sheet: "${id}", cells: { A1: { v: 1 } } }])`, { grants: ["read"] }).error?.message).toMatch(/not allowed to write/);
    expect(run(`ctx.apply([{ type: "set_cells", sheet: "${id}", cells: { A1: { v: 1 } } }, { type: "set_cells", sheet: "${id}", cells: { A2: { v: 1 } } }])`, { maxOps: 1 }).error?.message).toMatch(/more than 1/);
    expect(run("this is not javascript").error?.code).toBe("invalid_operation");
    expect(invoke(e, h, "value", "Sheet1", "A1")).toBe(null);
  });

  it("run against documents, decks and PDFs too", async () => {
    const d = new Engine("pli-engine.js");
    const dh = open(d, "docs", "json", null);
    expect(d.ok("scriptRun", dh, "return ctx.state.blocks.length", "{}")).toBe(1);
    const k = new Engine("pli-decks.js");
    expect(k.ok("scriptRun", open(k, "decks", "json", null), "return ctx.state.slides.length", "{}")).toBe(1);
    const p = new Engine("pli-pdf.js");
    expect(p.ok("scriptRun", open(p, "pdf", "json", null), "return ctx.state.pages.length", "{}")).toBe(1);
  });
});
