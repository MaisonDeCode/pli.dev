import { PliError } from "@pli.dev/core";

/**
 * A small XML reader for the parts of an Office file. It runs anywhere JavaScript does (no `DOMParser`), keeps the
 * order of children and text, and refuses what a Word file never needs: it ignores `<!DOCTYPE>` and defines no
 * entities of its own, so a file can't make it expand a name into something huge.
 */
export interface XmlElement {
  /** The name without its prefix: `w:p` is `p`. */
  name: string;
  /** Attributes by their full name (`w:val`). Use `attr` to read one without caring about the prefix. */
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

const MAX_DEPTH = 256;
const MAX_NODES = 5_000_000;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED[body] ?? whole;
  });
}

const local = (name: string): string => name.slice(name.indexOf(":") + 1);

/** Reads one XML document and returns its root element. Throws a `PliError` for anything that isn't well-formed. */
export function parseXml(source: string): XmlElement {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string): never => {
    throw new PliError("invalid_document", `Not valid XML: ${message} (at ${at})`);
  };
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];
  let nodes = 0;

  while (at < source.length) {
    const lt = source.indexOf("<", at);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > at) {
      const text = source.slice(at, textEnd);
      const top = stack[stack.length - 1];
      if (top) top.children.push(decode(text));
      else if (text.trim() !== "") fail("text outside the root element");
      at = textEnd;
    }
    if (lt < 0) break;

    if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      if (end < 0) fail("unclosed comment");
      at = end + 3;
    } else if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at + 9);
      if (end < 0) fail("unclosed CDATA");
      stack[stack.length - 1]?.children.push(source.slice(at + 9, end));
      at = end + 3;
    } else if (source.startsWith("<?", at)) {
      const end = source.indexOf("?>", at + 2);
      if (end < 0) fail("unclosed declaration");
      at = end + 2;
    } else if (source.startsWith("<!", at)) {
      // A doctype, possibly with an internal subset in brackets. Skipped, and its entities are not defined.
      let depth = 0;
      let i = at + 2;
      for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        else if (ch === ">" && depth <= 0) break;
      }
      if (i >= source.length) fail("unclosed declaration");
      at = i + 1;
    } else if (source.startsWith("</", at)) {
      const end = source.indexOf(">", at + 2);
      if (end < 0) fail("unclosed end tag");
      const name = local(source.slice(at + 2, end).trim());
      const open = stack.pop();
      if (!open || open.name !== name) fail(`unexpected </${name}>`);
      at = end + 1;
    } else {
      // A start tag. Attribute values may hold ">", so read them rather than searching for the end.
      let i = at + 1;
      const nameStart = i;
      while (i < source.length && !/[\s/>]/.test(source[i]!)) i++;
      const element: XmlElement = { name: local(source.slice(nameStart, i)), attrs: {}, children: [] };
      if (element.name === "") fail("a tag with no name");
      for (;;) {
        while (i < source.length && /\s/.test(source[i]!)) i++;
        const ch = source[i];
        if (ch === undefined) fail("unclosed tag");
        if (ch === ">" || ch === "/") break;
        const keyStart = i;
        while (i < source.length && !/[\s=/>]/.test(source[i]!)) i++;
        const key = source.slice(keyStart, i);
        while (i < source.length && /\s/.test(source[i]!)) i++;
        if (source[i] !== "=") fail(`attribute "${key}" has no value`);
        i++;
        while (i < source.length && /\s/.test(source[i]!)) i++;
        const quote = source[i];
        if (quote !== '"' && quote !== "'") fail(`attribute "${key}" isn't quoted`);
        const close = source.indexOf(quote!, i + 1);
        if (close < 0) fail("unclosed attribute value");
        element.attrs[key] = decode(source.slice(i + 1, close));
        i = close + 1;
      }
      const selfClosing = source[i] === "/";
      if (selfClosing) i++;
      if (source[i] !== ">") fail("a tag that doesn't end");
      at = i + 1;
      if (++nodes > MAX_NODES) fail("too many elements");
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else if (root) fail("more than one root element");
      else root = element;
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > MAX_DEPTH) fail("elements nested too deeply");
      }
    }
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1]!.name}> was never closed`);
  if (!root) fail("no root element");
  return root!;
}

/** The child elements, without the text between them. */
export function elements(node: XmlElement | undefined): XmlElement[] {
  return node ? (node.children.filter((c) => typeof c !== "string") as XmlElement[]) : [];
}

/** The first child element with this name. */
export function child(node: XmlElement | undefined, name: string): XmlElement | undefined {
  return node?.children.find((c): c is XmlElement => typeof c !== "string" && c.name === name);
}

/** Every child element with this name. */
export function childrenNamed(node: XmlElement | undefined, name: string): XmlElement[] {
  return node ? (node.children.filter((c) => typeof c !== "string" && c.name === name) as XmlElement[]) : [];
}

/**
 * An attribute by its name without the prefix. When more than one prefix has one (`w:id` and `r:id`) pass the
 * prefix wanted, or the one on the `w` namespace is preferred.
 */
export function attr(node: XmlElement | undefined, name: string, prefix?: string): string | undefined {
  if (!node) return undefined;
  const wanted = prefix ? `${prefix}:${name}` : undefined;
  if (wanted && wanted in node.attrs) return node.attrs[wanted];
  if (!prefix) {
    if (`w:${name}` in node.attrs) return node.attrs[`w:${name}`];
    if (name in node.attrs) return node.attrs[name];
  }
  for (const [key, value] of Object.entries(node.attrs)) if (local(key) === name && (!prefix || key.startsWith(`${prefix}:`))) return value;
  return undefined;
}

/** All the text inside an element, in order. */
export function textOf(node: XmlElement | undefined): string {
  if (!node) return "";
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}
