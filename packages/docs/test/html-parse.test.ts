import { describe, expect, it } from "vitest";
import { decodeEntities } from "../src/html/entities";
import { parseHtml, textOf, type HElement } from "../src/html/tree";
import { parseColor, parseDeclarations, parseLengthPt, parseStylesheet, ruleMatches } from "../src/html/css";

/** The tree as compact text, so structure is easy to assert: <p>text<b>bold</b></p>. */
function show(node: HElement | HElement["children"][number]): string {
  if (node.kind === "text") return node.text;
  const inner = node.children.map(show).join("");
  return node.tag === "#root" ? inner : `<${node.tag}>${inner}</${node.tag}>`;
}

describe("entities", () => {
  it("decodes named, decimal and hex references", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#38; &#x26; &#8212; &mdash; &copy; &nbsp;")).toBe('a & b <c> "d" & & — — ©  ');
  });

  it("leaves unknown names and bare ampersands alone, and refuses invalid code points", () => {
    expect(decodeEntities("AT&T &nope; & &#xD800; &#0; &#99999999;")).toBe("AT&T &nope; & � � �");
  });

  it("needs the semicolon on named references, except the ones browsers forgive", () => {
    expect(decodeEntities("&amp b &mdash &hellip;")).toBe("& b &mdash …");
  });
});

describe("parseHtml", () => {
  it("builds a tree from ordinary markup", () => {
    expect(show(parseHtml("<p>Hello <b>big</b> world</p>"))).toBe("<p>Hello <b>big</b> world</p>");
  });

  it("reads quoted, single-quoted and bare attributes, and decodes entities in them", () => {
    const [p] = parseHtml(`<a href="x?a=1&amp;b=2" title='t' data-x=y disabled>l</a>`).children as HElement[];
    expect(p!.attrs).toEqual({ href: "x?a=1&b=2", title: "t", "data-x": "y", disabled: "" });
  });

  it("allows > inside a quoted attribute value", () => {
    expect(show(parseHtml(`<a title="a > b">text</a>`))).toBe("<a>text</a>");
  });

  it("treats void elements as having no children, and self-closing syntax too", () => {
    expect(show(parseHtml("a<br>b<img src=x>c<hr/>d"))).toBe("a<br></br>b<img></img>c<hr></hr>d");
  });

  it("closes implied elements: list items, paragraphs, table cells and rows", () => {
    expect(show(parseHtml("<ul><li>a<li>b</ul>"))).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(show(parseHtml("<p>one<p>two<div>three</div>"))).toBe("<p>one</p><p>two</p><div>three</div>");
    expect(show(parseHtml("<table><tr><td>a<td>b<tr><td>c</table>"))).toBe("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>");
  });

  it("closes unclosed elements when an outer one ends, and ignores stray end tags", () => {
    expect(show(parseHtml("<div><b>bold<i>both</div>after</i></b>"))).toBe("<div><b>bold<i>both</i></b></div>after");
    expect(show(parseHtml("a</p>b</nothing>c"))).toBe("abc");
  });

  it("drops comments, doctypes, processing instructions and Word's conditional markup", () => {
    const html = `<!DOCTYPE html><?xml version="1.0"?><!--[if gte mso 9]><xml><o:x>junk</o:x></xml><![endif]--><p>kept<![if !supportLists]><span>bullet</span><![endif]></p><!-- c -->`;
    expect(show(parseHtml(html))).toBe("<p>kept<span>bullet</span></p>");
  });

  it("keeps style and script content raw, and never parses it as markup", () => {
    const root = parseHtml(`<style>p > b { color: red }</style><script>if (a<b) { x = "<p>" }</script><p>after</p>`);
    const [style, script, p] = root.children as HElement[];
    expect(textOf(style!)).toBe("p > b { color: red }");
    expect(textOf(script!)).toBe('if (a<b) { x = "<p>" }');
    expect(show(p!)).toBe("<p>after</p>");
  });

  it("keeps a stray < as text, and survives an unfinished tag", () => {
    expect(show(parseHtml("1 < 2 and 3<4"))).toBe("1 < 2 and 3<4");
    expect(show(parseHtml("<p>fine</p><div cla"))).toBe("<p>fine</p><div cla");
  });

  it("lowercases tag and attribute names", () => {
    const [el] = parseHtml(`<DIV CLASS="X">y</DIV>`).children as HElement[];
    expect(el!.tag).toBe("div");
    expect(el!.attrs.class).toBe("X");
  });

  it("copes with absurd nesting and huge input without overflowing the stack", () => {
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    expect(() => textOf(parseHtml(deep))).not.toThrow();
    expect(textOf(parseHtml(deep))).toBe("x");
    const wide = "<p>x</p>".repeat(50_000);
    expect(textOf(parseHtml(wide)).length).toBe(50_000);
  });
});

describe("CSS", () => {
  it("parses declarations, with !important, quotes and parentheses handled", () => {
    expect(parseDeclarations(`Color: Red !important; font-family: "A;B", serif; background: url(data:image/png;base64,AA); `)).toEqual({
      color: "Red",
      "font-family": '"A;B", serif',
      background: "url(data:image/png;base64,AA)",
    });
  });

  it("parses simple rules and matches them", () => {
    const rules = parseStylesheet(`/* c */ p.MsoNormal, .xl65 { font-size: 11pt } @page { margin: 1in } td { color: red } a:hover { color: blue }`);
    expect(rules.map((r) => r.selector)).toEqual([
      { tag: "p", classes: ["MsoNormal"], id: undefined },
      { tag: undefined, classes: ["xl65"], id: undefined },
      { tag: "td", classes: [], id: undefined },
    ]);
    expect(ruleMatches(rules[0]!, "p", ["MsoNormal"], undefined)).toBe(true);
    expect(ruleMatches(rules[0]!, "div", ["MsoNormal"], undefined)).toBe(false);
    expect(ruleMatches(rules[1]!, "td", ["a", "xl65"], undefined)).toBe(true);
    expect(rules[0]!.specificity).toBeGreaterThan(rules[2]!.specificity);
  });

  it("normalizes colors, and returns null for transparent and unknown ones", () => {
    expect(parseColor("#F00")).toBe("#ff0000");
    expect(parseColor("rgb(255, 128, 0)")).toBe("#ff8000");
    expect(parseColor("rgba(0,0,0,0)")).toBeNull();
    expect(parseColor("rgba(10 20 30 / 50%)")).toBe("#0a141e");
    expect(parseColor("Red")).toBe("#ff0000");
    expect(parseColor("windowtext")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("inherit")).toBeNull();
  });

  it("converts absolute lengths to points and ignores relative ones", () => {
    expect(parseLengthPt("12pt")).toBe(12);
    expect(parseLengthPt("16px")).toBe(12);
    expect(parseLengthPt("1in")).toBe(72);
    expect(parseLengthPt("1.5em")).toBeNull();
    expect(parseLengthPt("120%")).toBeNull();
    expect(parseLengthPt("auto")).toBeNull();
  });
});
