import { describe, expect, it } from "vitest";
import {
  DocumentSession,
  PliError,
  createDoc,
  describePlaceholder,
  fromDocx,
  generateDocument,
  heading,
  image,
  paragraph,
  parseDoc,
  placeholderSnippet,
  placeholdersIn,
  plainText,
  serializeDoc,
  table,
  templateFields,
  text,
  toDocx,
  validateDoc,
  type Block,
  type Doc,
  type GenerateOptions,
  type Run,
  type TableBlock,
} from "../src";

const txt = (block: unknown): string => plainText((block as { runs: Run[] }).runs);
const make = (...lines: (string | Block)[]): Doc => createDoc("T", lines.map((l) => (typeof l === "string" ? paragraph(l) : l)));
const lines = (doc: Doc): string[] => doc.blocks.map((b) => ("runs" in b ? plainText(b.runs) : `<${b.type}>`));
const run = (template: Doc, answers: Record<string, unknown>, options?: GenerateOptions) => generateDocument(template, answers, options);
const out = (template: Doc, answers: Record<string, unknown>, options?: GenerateOptions) => lines(run(template, answers, options).doc);

describe("placeholders", () => {
  it("fills in names, paths and list positions", () => {
    const t = make("Dear {{ client.name }}, your first contact is {{ contacts[0].email }} / {{ contacts.1.email }}.");
    const answers = { client: { name: "Ana" }, contacts: [{ email: "a@x.com" }, { email: "b@x.com" }] };
    expect(out(t, answers)).toEqual(["Dear Ana, your first contact is a@x.com / b@x.com."]);
  });

  it("does not change the template or the answers", () => {
    const t = make("{{ a }}");
    const before = JSON.stringify(t);
    const answers = { a: "x" };
    run(t, answers);
    expect(JSON.stringify(t)).toBe(before);
    expect(answers).toEqual({ a: "x" });
  });

  it("shows numbers, yes and no, dates and lists the plain way", () => {
    const t = make("{{ n }} | {{ yes }} | {{ no }} | {{ tags }}");
    expect(out(t, { n: 3.5, yes: true, no: false, tags: ["a", "b"] })).toEqual(["3.5 | Yes | No | a, b"]);
  });

  it("keeps the look of the text where the placeholder is", () => {
    const t = make(paragraph([text("Name: "), text("{{ name }}", { bold: true, color: "#c00" }), text(".")]));
    const [block] = run(t, { name: "Ana" }).doc.blocks;
    expect(block).toMatchObject({ runs: [{ text: "Name: " }, { text: "Ana", marks: { bold: true, color: "#c00" } }, { text: "." }] });
  });

  it("finds a placeholder that the editor split across runs", () => {
    const t = make(paragraph([text("{{ na", { bold: true }), text("me }}", { italic: true })]));
    const [block] = run(t, { name: "Ana" }).doc.blocks;
    expect(txt(block)).toBe("Ana");
    expect(block).toMatchObject({ runs: [{ text: "Ana", marks: { bold: true } }] });
  });

  it("looks inside headings, tables, headers, footers, footnotes, titles and links", () => {
    const base = createDoc("{{ client }} agreement", [
      heading(1, "For {{ client }}"),
      table([["Client", "{{ client }}"]]),
      paragraph([text("mail", { link: "mailto:{{ email }}" })]),
      paragraph([text("A note", {}), text("​", { footnote: "n1" })]),
    ]);
    const doc: Doc = { ...base, header: [paragraph("Header {{ client }}")], footer: [paragraph("Page for {{ client }}")], footnotes: { n1: [paragraph("About {{ client }}")] } };
    const result = run(doc, { client: "Acme", email: "a@acme.com" }).doc;
    expect(result.title).toBe("Acme agreement");
    expect(lines(result)[0]).toBe("For Acme");
    const t = result.blocks[1] as TableBlock;
    expect(txt(t.rows[0]!.cells[1]!.blocks[0])).toBe("Acme");
    expect((result.blocks[2] as { runs: { marks?: { link?: string } }[] }).runs[0]!.marks!.link).toBe("mailto:a@acme.com");
    expect(txt(result.header![0])).toBe("Header Acme");
    expect(txt(result.footer![0])).toBe("Page for Acme");
    const ref = (result.blocks[3] as { runs: { marks?: { footnote?: string } }[] }).runs.find((r) => r.marks?.footnote)!.marks!.footnote!;
    expect(txt(result.footnotes![ref]![0])).toBe("About Acme");
  });

  it("fills in an image's address and description", () => {
    const t = make(image("{{ logo }}", { width: 10, height: 10 }, { alt: "{{ client }} logo" }) as never);
    const [block] = run(t, { logo: "https://x/y.png", client: "Acme" }).doc.blocks;
    expect(block).toMatchObject({ src: "https://x/y.png", alt: "Acme logo" });
  });

  it("leaves a code block exactly as it is", () => {
    const t = createDoc("T", [{ id: "c", type: "code_block", runs: [{ text: "{{ name }}" }] }]);
    expect(out(t, { name: "x" })).toEqual(["{{ name }}"]);
  });

  it("reads curly quotes, which Word types in place of straight ones", () => {
    const t = make("{{#if plan == \u201cpro\u201d}}", "Pro", "{{/if}}", "{{ n | default:\u2018none\u2019 }}");
    expect(out(t, { plan: "pro" })).toEqual(["Pro", "none"]);
  });

  it("writes {{ in the text with a quoted string", () => {
    expect(out(make('Use {{ "{{ name }}" }} to name it'), {})).toEqual(["Use {{ name }} to name it"]);
  });

  it("gives the result new ids throughout, so it can replace a session's document", () => {
    const t = make("{{ a }}", "b");
    const first = run(t, { a: "1" }).doc;
    const second = run(t, { a: "2" }).doc;
    const ids = (d: Doc) => d.blocks.map((b) => b.id);
    expect(ids(first).some((id) => ids(t).includes(id))).toBe(false);
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    const session = new DocumentSession(first);
    expect(() => session.replaceDocument(second)).not.toThrow();
  });

  it("makes a valid document that saves, loads and exports", () => {
    const t = make("{{ a }}", heading(2, "H"));
    const { doc } = run(t, { a: "x" });
    expect(() => validateDoc(doc)).not.toThrow();
    expect(parseDoc(serializeDoc(doc)).blocks).toHaveLength(2);
    expect(toDocx(doc)).toBeInstanceOf(Uint8Array);
  });
});

describe("a template that came from a DOCX file", () => {
  it("makes the same document as the one it was saved from", () => {
    const tbl = table([["Item", "Cost"], ["x", "y"]], { headerRow: true });
    tbl.rows[1]!.cells[0]!.blocks = [paragraph("{{#each items as i}}") as never, paragraph("{{ i.name }}") as never];
    tbl.rows[1]!.cells[1]!.blocks = [paragraph("{{ i.cost | currency }}") as never, paragraph("{{/each}}") as never];
    const original = createDoc("Order for {{ who }}", [heading(1, "Hello {{ who }}"), paragraph("{{#if vip}}"), paragraph("Thanks, VIP."), paragraph("{{/if}}"), tbl]);
    const viaWord = fromDocx(toDocx(original)).doc;
    const answers = { who: "Ana", vip: true, items: [{ name: "A", cost: 2 }, { name: "B", cost: 3 }] };
    const shape = (d: Doc) => JSON.stringify({ title: d.title, text: lines(d), table: (d.blocks.at(-1) as TableBlock).rows.map((r) => r.cells.map((c) => c.blocks.map((b) => txt(b)))) });
    expect(shape(run(viaWord, answers).doc)).toBe(shape(run(original, answers).doc));
    expect(run(viaWord, answers).issues).toEqual([]);
  });
});

describe("values that are missing", () => {
  const t = make("Hello {{ name }}!");

  it("highlights the placeholder and reports it, by default", () => {
    const r = run(t, {});
    expect(lines(r.doc)).toEqual(["Hello {{ name }}!"]);
    expect(r.doc.blocks[0]).toMatchObject({ runs: [{ text: "Hello " }, { text: "{{ name }}", marks: { highlight: "#ffe08a" } }, { text: "!" }] });
    expect(r.missing).toEqual(["name"]);
    expect(r.issues).toEqual([expect.objectContaining({ type: "missing", path: "name", tag: "{{ name }}", block: t.blocks[0]!.id })]);
  });

  it("can leave it without a highlight, or blank", () => {
    expect(run(t, {}, { missing: "keep" }).doc.blocks[0]).toMatchObject({ runs: [{ text: "Hello {{ name }}!" }] });
    expect(out(t, {}, { missing: "blank" })).toEqual(["Hello !"]);
  });

  it("treats null and an unknown name alike, and names each once", () => {
    const r = run(make("{{ a }} {{ a }} {{ b.c }}"), { a: null });
    expect(r.missing).toEqual(["a", "b.c"]);
  });

  it("removes a paragraph that was only placeholders and came out empty", () => {
    const t2 = make("Name: x", "{{ line2 }}", "End");
    expect(out(t2, { line2: "" })).toEqual(["Name: x", "End"]);
    expect(out(t2, { line2: "" }, { dropEmpty: false })).toEqual(["Name: x", "", "End"]);
  });

  it("keeps a paragraph that was empty to begin with", () => {
    expect(out(make("a", "", "b"), {})).toEqual(["a", "", "b"]);
  });

  it("throws when asked to be strict", () => {
    expect(() => run(t, {}, { strict: true })).toThrow(PliError);
    expect(() => run(t, { name: "x" }, { strict: true })).not.toThrow();
  });
});

describe("conditions", () => {
  const t = make("{{#if plan == \"pro\"}}", "Pro text", "{{#elseif plan == \"team\"}}", "Team text", "{{else}}", "Free text", "{{/if}}", "After");

  it("picks the first branch that is true", () => {
    expect(out(t, { plan: "pro" })).toEqual(["Pro text", "After"]);
    expect(out(t, { plan: "team" })).toEqual(["Team text", "After"]);
    expect(out(t, { plan: "free" })).toEqual(["Free text", "After"]);
    expect(out(t, {})).toEqual(["Free text", "After"]);
  });

  it("reports nothing for a question left unanswered", () => {
    expect(run(t, {}).issues).toEqual([]);
  });

  it("has unless", () => {
    const u = make("{{#unless paid}}", "Payment due", "{{/unless}}");
    expect(out(u, { paid: false })).toEqual(["Payment due"]);
    // A document always has a block.
    expect(out(u, { paid: true })).toEqual([""]);
  });

  it("nests", () => {
    const n = make("{{#if a}}", "A", "{{#if b}}", "B", "{{/if}}", "{{/if}}");
    expect(out(n, { a: true, b: true })).toEqual(["A", "B"]);
    expect(out(n, { a: true })).toEqual(["A"]);
    expect(out(n, { b: true })).toEqual([""]);
  });

  it("works inside a line", () => {
    const l = make("Dear {{#if title}}{{ title }} {{/if}}{{ name }}{{#if vip}} (VIP){{else}}!{{/if}}");
    expect(out(l, { title: "Dr", name: "Ana", vip: true })).toEqual(["Dear Dr Ana (VIP)"]);
    expect(out(l, { name: "Ana" })).toEqual(["Dear Ana!"]);
  });

  it("works inside table cells", () => {
    const tbl = table([["{{#if a}}", "x"]]) as TableBlock;
    tbl.rows[0]!.cells[0]!.blocks = [paragraph("{{#if a}}") as never, paragraph("A text") as never, paragraph("{{/if}}") as never];
    const doc = createDoc("T", [tbl]);
    const cell = (answers: Record<string, unknown>) => ((run(doc, answers).doc.blocks[0] as TableBlock).rows[0]!.cells[0]!.blocks.map((b) => txt(b)));
    expect(cell({ a: true })).toEqual(["A text"]);
    expect(cell({ a: false })).toEqual([""]);
  });

  describe("expressions", () => {
    const test = (expr: string, answers: Record<string, unknown> = {}) => out(make(`{{#if ${expr}}}`, "yes", "{{else}}", "no", "{{/if}}"), answers)[0] === "yes";

    it("compares", () => {
      expect(test("n > 2", { n: 3 })).toBe(true);
      expect(test("n >= 3 and n < 4", { n: 3 })).toBe(true);
      expect(test("n < 2 or m == 'x'", { n: 3, m: "x" })).toBe(true);
      expect(test("n != 3", { n: 3 })).toBe(false);
      expect(test("not paid", { paid: false })).toBe(true);
      expect(test("!(a && b)", { a: true, b: false })).toBe(true);
    });

    it("takes a number and the same number written as text as equal", () => {
      expect(test("n == 3", { n: "3" })).toBe(true);
      expect(test("n > 2", { n: "10" })).toBe(true);
      expect(test("n == 3", { n: "x" })).toBe(false);
    });

    it("compares dates", () => {
      expect(test("start < end", { start: "2026-01-09", end: "2026-01-10" })).toBe(true);
      expect(test("start > @today", { start: "2999-01-01" })).toBe(true);
    });

    it("tests membership", () => {
      expect(test("'b' in tags", { tags: ["a", "b"] })).toBe(true);
      expect(test("'c' in tags", { tags: ["a", "b"] })).toBe(false);
      expect(test("'c' not in tags", { tags: ["a", "b"] })).toBe(true);
      expect(test("'ell' in word", { word: "hello" })).toBe(true);
    });

    it("counts nothing, zero, empty text and an empty list as no", () => {
      for (const value of [undefined, null, false, 0, "", []]) expect(test("x", { x: value })).toBe(false);
      for (const value of [true, 1, "a", ["a"], {}]) expect(test("x", { x: value })).toBe(true);
    });

    it("uses the length of a list", () => {
      expect(test("items.length > 1", { items: [1, 2] })).toBe(true);
      expect(test("(items | length) == 0", { items: [] })).toBe(true);
    });

    it("never reaches what the answers don't own", () => {
      expect(test("constructor", {})).toBe(false);
      expect(test("a.__proto__", { a: {} })).toBe(false);
      expect(test("toString", {})).toBe(false);
    });
  });
});

describe("lists", () => {
  it("repeats blocks for each item", () => {
    const t = make("Services:", "{{#each services as s}}", "- {{ s.name }} ({{ @number }} of {{ @count }})", "{{/each}}", "Done");
    expect(out(t, { services: [{ name: "Audit" }, { name: "Build" }] })).toEqual(["Services:", "- Audit (1 of 2)", "- Build (2 of 2)", "Done"]);
    expect(out(t, { services: [] })).toEqual(["Services:", "Done"]);
    expect(out(t, {})).toEqual(["Services:", "Done"]);
  });

  it("lets an item's fields be used by name when there is no alias, and the item as this", () => {
    const t = make("{{#each people}}", "{{ name }} / {{ this.name }}", "{{/each}}", "{{#each words}}", "{{ this | upper }}", "{{/each}}");
    expect(out(t, { people: [{ name: "Ana" }], words: ["a", "b"] })).toEqual(["Ana / Ana", "A", "B"]);
  });

  it("can see the outside answers inside a loop", () => {
    const t = make("{{#each items as i}}", "{{ company }}: {{ i }}", "{{/each}}");
    expect(out(t, { company: "Acme", items: ["x"] })).toEqual(["Acme: x"]);
  });

  it("has first and last, and nests", () => {
    const t = make("{{#each groups as g}}", "{{ g.name }}", "{{#each g.members as m}}", "{{#if @first}}[{{/if}}{{ m }}{{#if @last}}]{{/if}}", "{{/each}}", "{{/each}}");
    expect(out(t, { groups: [{ name: "A", members: ["x", "y"] }, { name: "B", members: ["z"] }] })).toEqual(["A", "[x", "y]", "B", "[z]"]);
  });

  it("repeats inside a line", () => {
    const t = make("Parties: {{#each p as x}}{{ x }}{{#unless @last}}, {{/unless}}{{/each}}.");
    expect(out(t, { p: ["A", "B", "C"] })).toEqual(["Parties: A, B, C."]);
  });

  it("gives every repeated block its own id", () => {
    const r = run(make("{{#each xs as x}}", "{{ x }}", "{{/each}}"), { xs: [1, 2, 3] }).doc;
    expect(new Set(r.blocks.map((b) => b.id)).size).toBe(3);
  });

  it("says when something that is not a list is looped over", () => {
    const r = run(make("{{#each a}}", "x", "{{/each}}"), { a: "text" });
    expect(r.issues).toEqual([expect.objectContaining({ type: "type" })]);
    expect(lines(r.doc)).toEqual([""]);
  });

  it("stops a list that would grow the document too much", () => {
    const t = make("{{#each xs as x}}", "{{ x }}", "{{/each}}");
    expect(() => run(t, { xs: Array.from({ length: 100 }, (_, i) => i) }, { maxBlocks: 50 })).toThrow(PliError);
  });
});

describe("table rows", () => {
  const rowTemplate = (): Doc => {
    const tbl = table([["Item", "Cost"], ["x", "y"], ["Total", "{{ total }}"]], { headerRow: true });
    tbl.rows[1]!.cells[0]!.blocks = [paragraph("{{#each items as i}}") as never, paragraph("{{ i.name }}") as never];
    tbl.rows[1]!.cells[1]!.blocks = [paragraph("{{ i.cost | currency }}") as never, paragraph("{{/each}}") as never];
    return createDoc("T", [tbl]);
  };
  const cells = (doc: Doc) => (doc.blocks[0] as TableBlock).rows.map((row) => row.cells.map((c) => c.blocks.map((b) => txt(b)).join("|")));

  it("repeats a row that opens in its first cell and closes in its last", () => {
    const r = run(rowTemplate(), { items: [{ name: "A", cost: 5 }, { name: "B", cost: 7.5 }], total: "$12.50" }, { locale: "en-US" });
    expect(cells(r.doc)).toEqual([["Item", "Cost"], ["A", "$5.00"], ["B", "$7.50"], ["Total", "$12.50"]]);
    expect(r.issues).toEqual([]);
    const ids = (r.doc.blocks[0] as TableBlock).rows.map((x) => x.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("drops the row for an empty list, and the table when no rows are left", () => {
    expect(cells(run(rowTemplate(), { items: [], total: "0" }).doc)).toEqual([["Item", "Cost"], ["Total", "0"]]);
    const only = table([["x", "y"]]);
    only.rows[0]!.cells[0]!.blocks = [paragraph("{{#if show}}") as never, paragraph("shown") as never];
    only.rows[0]!.cells[1]!.blocks = [paragraph("{{/if}}") as never];
    const doc = createDoc("T", [only, paragraph("after")]);
    expect(lines(run(doc, { show: false }).doc)).toEqual(["after"]);
    expect(lines(run(doc, { show: true }).doc)).toEqual(["<table>", "after"]);
  });
});

describe("filters", () => {
  const f = (expr: string, answers: Record<string, unknown> = {}, options?: GenerateOptions) => out(make(`{{ ${expr} }}`), answers, { locale: "en-US", ...options })[0];

  it("changes text", () => {
    expect(f("n | upper", { n: "ana" })).toBe("ANA");
    expect(f("n | lower", { n: "ANA" })).toBe("ana");
    expect(f("n | title", { n: "ana maria o'neil-smith" })).toBe("Ana Maria O'neil-Smith");
    expect(f("n | capitalize", { n: "hello world" })).toBe("Hello world");
    expect(f("n | trim", { n: "  x " })).toBe("x");
    expect(f("n | truncate:5", { n: "abcdefghij" })).toBe("abcd…");
    expect(f("n | replace:'-',' '", { n: "a-b-c" })).toBe("a b c");
    expect(f("n | initials", { n: "ana maria lopez" })).toBe("AML");
  });

  it("falls back", () => {
    expect(f("n | default:'N/A'")).toBe("N/A");
    expect(f("n | default:'N/A'", { n: "" })).toBe("N/A");
    expect(f("n | default:'N/A'", { n: "x" })).toBe("x");
    expect(f("n ?? 'none'", { n: null })).toBe("none");
    expect(f("nick || name", { nick: "", name: "Ana" })).toBe("Ana");
  });

  it("writes numbers, money and percentages", () => {
    expect(f("n | number", { n: 1234567.891 })).toBe("1,234,567.891");
    expect(f("n | number:2", { n: 1234.5 })).toBe("1,234.50");
    expect(f("n | currency", { n: 1234.5 })).toBe("$1,234.50");
    expect(f("n | currency:'EUR'", { n: 5 }, { locale: "de-DE" })).toBe("5,00\u00a0€");
    expect(f("n | currency:'USD',0", { n: 1234.5 })).toBe("$1,235");
    expect(f("n | currency", { n: "10" }, { currency: "GBP" })).toBe("£10.00");
    expect(f("n | percent", { n: 0.256 })).toBe("26%");
    expect(f("n | percent:1", { n: 0.256 })).toBe("25.6%");
    expect(f("n | round:1", { n: 2.345 })).toBe("2.3");
    expect(f("n | ordinal", { n: 22 })).toBe("22nd");
    expect(f("n | ordinal", { n: 13 })).toBe("13th");
  });

  it("does arithmetic", () => {
    expect(f("price * qty", { price: 2.5, qty: 4 })).toBe("10");
    expect(f("(a + b) * 2 | number:1", { a: 1, b: 2 })).toBe("6.0");
    expect(f("items | sum:'cost' | currency", { items: [{ cost: 1.5 }, { cost: 2 }, {}] })).toBe("$3.50");
    expect(f("a + ' ' + b", { a: "x", b: "y" })).toBe("x y");
  });

  it("writes dates", () => {
    expect(f("d | date", { d: "2026-11-18" })).toBe("November 18, 2026");
    expect(f("d | date:'short'", { d: "2026-11-18" })).toBe("11/18/26");
    expect(f("d | date:'iso'", { d: new Date(2026, 10, 18) })).toBe("2026-11-18");
    expect(f("d | date:'monthYear'", { d: "2026-11-18" })).toBe("November 2026");
    expect(f("d | date:'weekday'", { d: "2026-11-18" })).toBe("Wednesday");
    expect(f("d | date", { d: "2026-11-18" }, { locale: "fr-FR" })).toBe("18 novembre 2026");
    expect(f("@today | date:'year'", {}, { now: new Date(2031, 5, 1) })).toBe("2031");
  });

  it("works on lists", () => {
    const xs = { xs: ["a", "b", "c"] };
    expect(f("xs | join:' / '", xs)).toBe("a / b / c");
    expect(f("xs | sentence", xs)).toBe("a, b, and c");
    expect(f("xs | sentence:'or'", { xs: ["a", "b"] })).toBe("a or b");
    expect(f("xs | first", xs)).toBe("a");
    expect(f("xs | last", xs)).toBe("c");
    expect(f("xs | length", xs)).toBe("3");
    expect(f("people | pluck:'name' | sentence", { people: [{ name: "A" }, { name: "B" }] })).toBe("A and B");
    expect(f("people | sort:'age' | pluck:'name' | join", { people: [{ name: "A", age: 30 }, { name: "B", age: 20 }] })).toBe("B, A");
    expect(f("xs | reverse | join", xs)).toBe("c, b, a");
  });

  it("chooses words", () => {
    expect(f("n | plural:'item','items'", { n: 1 })).toBe("item");
    expect(f("n | plural:'item','items'", { n: 2 })).toBe("items");
    expect(f("xs | plural:'file'", { xs: [1, 2] })).toBe("files");
    expect(f("ok | yesno", { ok: true })).toBe("Yes");
    expect(f("ok | yesno:'Signed','Unsigned'", { ok: false })).toBe("Unsigned");
  });

  it("takes filters of your own, and lets them replace the built-in ones", () => {
    expect(f("n | shout", { n: "hi" }, { filters: { shout: (v) => `${String(v).toUpperCase()}!` } })).toBe("HI!");
    expect(f("n | upper", { n: "hi" }, { filters: { upper: () => "mine" } })).toBe("mine");
    expect(f("n | join:'+'", { n: [1, 2] }, { filters: { join: (v, [sep]) => (v as number[]).join(String(sep)) } })).toBe("1+2");
  });

  it("leaves the placeholder and says why when a filter fails", () => {
    const t = make("a {{ x | nope }} b {{ d | date }} c {{ n | currency:'ZZZZ' }}");
    const r = run(t, { x: 1, d: "soon", n: 5 }, { missing: "keep" });
    expect(lines(r.doc)).toEqual(["a {{ x | nope }} b {{ d | date }} c {{ n | currency:'ZZZZ' }}"]);
    expect(r.issues.map((i) => i.type)).toEqual(["filter", "type", "filter"]);
    expect(r.issues[0]!.message).toContain("nope");
  });
});

describe("mistakes in the template", () => {
  const issues = (t: Doc, answers = {}) => run(t, answers, { missing: "keep" }).issues;

  it("reports text that can't be read, and leaves it", () => {
    const r = run(make("a {{ b + }} c {{ 'open }} d"), {}, { missing: "keep" });
    expect(lines(r.doc)).toEqual(["a {{ b + }} c {{ 'open }} d"]);
    expect(r.issues.map((i) => i.type)).toEqual(["syntax", "syntax"]);
  });

  it("leaves a {{ that never ends alone", () => {
    const r = run(make("price is {{ not closed"), {}, { missing: "keep" });
    expect(lines(r.doc)).toEqual(["price is {{ not closed"]);
    expect(r.issues).toEqual([expect.objectContaining({ type: "syntax", tag: "{{" })]);
  });

  it("reports a condition that is never closed, and carries on to the end", () => {
    const r = run(make("{{#if a}}", "inside", "outside"), { a: true });
    expect(lines(r.doc)).toEqual(["inside", "outside"]);
    expect(r.issues).toEqual([expect.objectContaining({ type: "syntax", tag: "{{#if a}}" })]);
  });

  it("reports a closing tag with nothing to close, and an else after an else", () => {
    expect(issues(make("a", "{{/if}}", "b")).map((i) => i.tag)).toEqual(["{{/if}}"]);
    expect(issues(make("{{#if a}}", "x", "{{else}}", "y", "{{else}}", "z", "{{/if}}")).map((i) => i.tag)).toEqual(["{{else}}"]);
    expect(issues(make("{{#each a}}", "x", "{{/if}}", "{{/each}}"), { a: [] }).map((i) => i.tag)).toEqual(["{{/if}}"]);
  });

  it("reports an unknown directive", () => {
    expect(issues(make("{{#loop a}}")).map((i) => i.type)).toEqual(["syntax"]);
  });

  it("says a group of answers can't be shown as text", () => {
    const r = run(make("{{ client }}"), { client: { name: "x" } }, { missing: "keep" });
    expect(r.issues).toEqual([expect.objectContaining({ type: "type" })]);
  });
});

describe("footnotes and comments", () => {
  it("keeps the note of a reference that stays and drops the note of one that goes", () => {
    const doc: Doc = {
      ...createDoc("T", [
        paragraph("{{#if a}}"),
        paragraph([text("A"), text("​", { footnote: "na" })]),
        paragraph("{{/if}}"),
        paragraph([text("B"), text("​", { footnote: "nb" })]),
      ]),
      footnotes: { na: [paragraph("Note A")], nb: [paragraph("Note B")] },
    };
    const r = run(doc, { a: false }).doc;
    expect(Object.values(r.footnotes!).map((b) => txt(b[0]))).toEqual(["Note B"]);
  });

  it("gives each repeated reference a note of its own", () => {
    const doc: Doc = {
      ...createDoc("T", [paragraph("{{#each xs as x}}"), paragraph([text("{{ x }}"), text("​", { footnote: "n" })]), paragraph("{{/each}}")]),
      footnotes: { n: [paragraph("The note")] },
    };
    const r = run(doc, { xs: ["a", "b"] }).doc;
    const refs = r.blocks.map((b) => (b as { runs: { marks?: { footnote?: string } }[] }).runs.find((x) => x.marks?.footnote)!.marks!.footnote!);
    expect(new Set(refs).size).toBe(2);
    expect(Object.keys(r.footnotes!).sort()).toEqual([...refs].sort());
  });

  it("leaves the template's comments behind", () => {
    const doc: Doc = {
      ...createDoc("T", [paragraph([text("{{ a }}", { comment: ["t1"] })])]),
      comments: { t1: { id: "t1", anchor: { block: "x", from: 0, to: 1, quote: "q" }, comments: [], resolved: false } as never },
    };
    const r = run(doc, { a: "x" }).doc;
    expect(r.comments).toBeUndefined();
    expect((r.blocks[0] as { runs: { marks?: unknown }[] }).runs[0]!.marks).toBeUndefined();
  });
});

describe("what a template asks for", () => {
  it("lists the answers, how they are used and the choices the conditions know", () => {
    const t = make(
      "Dear {{ client.name }}, today is {{ @today | date }}.",
      "{{#if plan == \"pro\"}}",
      "Pro for {{ price | currency }}",
      "{{#elseif plan == \"team\"}}",
      "Team",
      "{{/if}}",
      "{{#if vip}}VIP{{/if}}",
      "{{#if seats > 5}}Large{{/if}}",
      "{{#each services as s}}",
      "{{ s.name }} {{ s.fee | currency }} {{ s.due | date }}",
      "{{#each s.notes as n}}{{ n }}{{/each}}",
      "{{/each}}",
      "{{ start | date }}",
    );
    const { fields, issues } = templateFields(t);
    expect(issues).toEqual([]);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
    expect(Object.keys(byPath)).toEqual(["client.name", "plan", "price", "vip", "seats", "services", "start"]);
    expect(byPath["client.name"]).toMatchObject({ type: "text", uses: ["value"] });
    expect(byPath.plan).toMatchObject({ uses: ["condition"], options: ["pro", "team"], type: "text" });
    expect(byPath.price).toMatchObject({ type: "number" });
    expect(byPath.vip).toMatchObject({ type: "boolean", uses: ["condition"] });
    expect(byPath.seats).toMatchObject({ type: "number", uses: ["condition"] });
    expect(byPath.start).toMatchObject({ type: "date" });
    expect(byPath.services).toMatchObject({ type: "list", uses: ["list"] });
    expect(byPath.services!.fields!.map((f) => [f.path, f.type])).toEqual([["name", "text"], ["fee", "number"], ["due", "date"], ["notes", "list"]]);
    expect(byPath.services!.fields![3]!.fields!.map((f) => f.path)).toEqual([]);
  });

  it("treats names in a list without an alias as the item's", () => {
    const { fields } = templateFields(make("{{#each people}}", "{{ name }} {{ this.email }}", "{{/each}}"));
    expect(fields.map((f) => f.path)).toEqual(["people"]);
    expect(fields[0]!.fields!.map((f) => f.path)).toEqual(["name", "email"]);
  });

  it("looks in tables, regions and notes, and sees a repeated table row", () => {
    const tbl = table([["{{ a }}", "x"]]);
    tbl.rows[0]!.cells[0]!.blocks = [paragraph("{{#each rows as r}}") as never, paragraph("{{ r.v }}") as never];
    tbl.rows[0]!.cells[1]!.blocks = [paragraph("{{/each}}") as never];
    const doc: Doc = { ...createDoc("{{ t }}", [tbl]), header: [paragraph("{{ h }}")], footnotes: { n: [paragraph("{{ f }}")] } };
    expect(templateFields(doc).fields.map((f) => f.path)).toEqual(["t", "rows", "h", "f"]);
  });

  it("reports mistakes without any answers", () => {
    const { issues } = templateFields(make("{{#if a}}", "{{ b + }}", "{{/each}}"));
    expect(issues.map((i) => i.tag).sort()).toEqual(["{{#if a}}", "{{ b + }}", "{{/each}}"].sort());
  });

  it("agrees with what generation reports as missing", () => {
    const t = make("{{ a }} {{ b.c }}", "{{#each xs as x}}", "{{ x.y }}", "{{/each}}");
    const names = templateFields(t).fields.map((f) => f.path);
    expect(run(t, {}).missing.sort()).toEqual(["a", "b.c"]);
    expect(names).toEqual(["a", "b.c", "xs"]);
  });
});

describe("placeholdersIn and placeholderSnippet", () => {
  it("finds values, block tags and tags that can't be read, with where they are", () => {
    const t = "A {{ a }} b {{#if x}}c{{/if}} d {{ 1 + }} e {{";
    const found = placeholdersIn(t);
    expect(found.map((p) => [p.kind, t.slice(p.from, p.to)])).toEqual([
      ["value", "{{ a }}"],
      ["block", "{{#if x}}"],
      ["block", "{{/if}}"],
      ["error", "{{ 1 + }}"],
      ["error", "{{"],
    ]);
    expect(found[3]!.message).toBeTruthy();
  });

  it("finds nothing in text with no braces", () => {
    expect(placeholdersIn("plain text")).toEqual([]);
  });

  it("reads curly quotes the way generation does", () => {
    expect(placeholdersIn("{{ plan == “pro” }}")[0]!.kind).toBe("value");
  });

  it("gives the lines of a condition or list to insert", () => {
    expect(placeholderSnippet("if", "nda")).toEqual({ lines: ["{{#if nda}}", "", "{{/if}}"], caret: 1 });
    expect(placeholderSnippet("each").lines[0]).toBe("{{#each list as item}}");
  });
});

describe("describePlaceholder", () => {
  const names = { "client.name": "Client name", start: "Start date", services: "Services", name: "Service" };
  const d = (tag: string) => describePlaceholder(tag, names);

  it("names an answer the way it was given, or makes a name from the answer's own", () => {
    expect(d("{{ client.name }}")).toBe("Client name");
    expect(d("{{ clientCity }}")).toBe("Client city");
    expect(d("{{ billing_address.zip_code }}")).toBe("Billing address zip code");
  });

  it("ignores filters, which change how an answer is written and not which it is", () => {
    expect(d("{{ start | date:\"long\" }}")).toBe("Start date");
    expect(d("{{ services | sum:\"fee\" | currency }}")).toBe("Services");
  });

  it("says a count-dependent word as both words", () => {
    expect(d("{{ seats | plural:\"seat\",\"seats\" }}")).toBe("Seat/seats");
  });

  it("says the item of a list by its own name", () => {
    expect(d("{{ s.name }}")).toBe("Service");
    expect(d("{{ item.fee }}")).toBe("Fee");
    expect(d("{{ @number }}")).toBe("The item's number");
    expect(d("{{ @today | date }}")).toBe("Today's date");
  });

  it("says conditions and lists in words", () => {
    expect(d("{{#if nda}}")).toBe("Only if Nda");
    expect(d("{{#unless nda}}")).toBe("Only if not Nda");
    expect(d("{{#if plan == \"team\"}}")).toBe("Only if Plan is team");
    expect(d("{{#elseif seats >= 5 and nda}}")).toBe("Otherwise, if Seats is at least 5 and Nda");
    expect(d("{{else}}")).toBe("Otherwise");
    expect(d("{{/if}}")).toBe("End");
    expect(d("{{#each services as s}}")).toBe("For each item in Services");
    expect(d("{{/each}}")).toBe("End of list");
  });

  it("gives nothing for a tag that can't be read, so it is shown as written", () => {
    expect(d("{{ 1 + }}")).toBeUndefined();
    expect(d("plain text")).toBeUndefined();
  });
});
