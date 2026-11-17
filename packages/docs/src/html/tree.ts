import { decodeEntities } from "./entities";

/** A node of the parsed HTML: an element or a run of text. Comments and doctypes never get this far. */
export type HNode = HElement | HText;

export interface HElement {
  kind: "el";
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}

export interface HText {
  kind: "text";
  text: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Elements whose content is code or data, not text to read. Their text is kept raw and never parsed as markup. */
const RAW = new Set(["script", "style", "textarea", "title", "xmp"]);

const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section",
  "table", "ul",
]);

/** Elements that cannot sit inside a `<p>`: opening one closes it. */
const CLOSES_P = BLOCKS;

/** Cuts off runaway nesting, which would otherwise be a way to overflow the stack of whatever walks the tree. */
const MAX_DEPTH = 256;
const MAX_NODES = 400_000;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
    const name = m[1]!.toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Parses HTML into a tree, tolerantly: unclosed and stray tags, unquoted attributes and the invalid
 * nesting that real editors produce are all accepted. Comments, doctypes, processing instructions and
 * conditional comments are dropped. This is not a full HTML5 parser; it is enough to read a clipboard.
 */
export function parseHtml(html: string): HElement {
  const root: HElement = { kind: "el", tag: "#root", attrs: {}, children: [] };
  const stack: HElement[] = [root];
  let nodes = 0;
  let i = 0;
  const n = html.length;

  const top = () => stack[stack.length - 1]!;
  const addText = (text: string) => {
    if (text === "" || nodes > MAX_NODES) return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (last?.kind === "text") last.text += text;
    else parent.children.push({ kind: "text", text });
    nodes++;
  };

  /** Pops open elements up to and including the nearest one with this name, if any is open. */
  const close = (tag: string) => {
    for (let s = stack.length - 1; s > 0; s--) {
      if (stack[s]!.tag === tag) {
        stack.length = s;
        return;
      }
    }
  };
  const isOpen = (tag: string, stopAt: string[]): boolean => {
    for (let s = stack.length - 1; s > 0; s--) {
      if (stack[s]!.tag === tag) return true;
      if (stopAt.includes(stack[s]!.tag)) return false;
    }
    return false;
  };

  /** Closes elements that a new start tag implies the end of (an `<li>` ends the previous `<li>`, and so on). */
  const impliedEnds = (tag: string) => {
    if (CLOSES_P.has(tag) && isOpen("p", ["div", "td", "th", "li", "blockquote", "table", "body"])) close("p");
    if (tag === "li" && isOpen("li", ["ul", "ol"])) close("li");
    if ((tag === "td" || tag === "th") && (isOpen("td", ["tr", "table"]) || isOpen("th", ["tr", "table"]))) {
      close(isOpen("td", ["tr", "table"]) ? "td" : "th");
    }
    if (tag === "tr") {
      if (isOpen("td", ["table"]) || isOpen("th", ["table"])) close(isOpen("td", ["tr", "table"]) ? "td" : "th");
      if (isOpen("tr", ["table"])) close("tr");
    }
    if (["thead", "tbody", "tfoot"].includes(tag)) {
      for (const section of ["thead", "tbody", "tfoot"]) if (isOpen(section, ["table"])) close(section);
      if (isOpen("tr", ["table"])) close("tr");
    }
    if ((tag === "dt" || tag === "dd") && (isOpen("dt", ["dl"]) || isOpen("dd", ["dl"]))) close(isOpen("dd", ["dl"]) ? "dd" : "dt");
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      addText(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(html.slice(i, lt)));
    i = lt;

    // Comments, including Word's conditional comments, are dropped whole.
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // <!DOCTYPE>, <?xml ?> and Word's <![if !supportLists]> / <![endif]> markers.
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    const closing = html[i + 1] === "/";
    const nameStart = i + (closing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][^\s/>]*/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      // A stray "<" that doesn't start a tag is just text.
      addText("<");
      i++;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    const end = html.indexOf(">", nameStart + nameMatch[0].length);
    if (end < 0) {
      addText(decodeEntities(html.slice(i)));
      break;
    }

    if (closing) {
      close(tag);
      i = end + 1;
      continue;
    }

    // Find the end of the tag, which may contain ">" inside a quoted attribute value.
    let tagEnd = end;
    const attrStart = nameStart + nameMatch[0].length;
    let quote = "";
    for (let k = attrStart; k < n; k++) {
      const ch = html[k]!;
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        tagEnd = k;
        break;
      }
    }
    const rawAttrs = html.slice(attrStart, tagEnd);
    const selfClosing = rawAttrs.trimEnd().endsWith("/");
    i = tagEnd + 1;

    impliedEnds(tag);
    const element: HElement = { kind: "el", tag, attrs: parseAttributes(rawAttrs), children: [] };
    if (nodes++ > MAX_NODES) continue;
    top().children.push(element);

    if (RAW.has(tag)) {
      const closeAt = html.toLowerCase().indexOf(`</${tag}`, i);
      const body = closeAt < 0 ? html.slice(i) : html.slice(i, closeAt);
      if (body) element.children.push({ kind: "text", text: tag === "textarea" || tag === "title" ? decodeEntities(body) : body });
      const after = closeAt < 0 ? -1 : html.indexOf(">", closeAt);
      i = after < 0 ? n : after + 1;
      continue;
    }
    if (VOID.has(tag) || selfClosing) continue;
    if (stack.length < MAX_DEPTH) stack.push(element);
  }
  return root;
}

export function isBlockTag(tag: string): boolean {
  return BLOCKS.has(tag);
}

/** The text of a node and everything inside it, with no formatting. */
export function textOf(node: HNode): string {
  if (node.kind === "text") return node.text;
  if (node.tag === "br") return "\n";
  return node.children.map(textOf).join("");
}
