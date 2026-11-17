import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  documentStats,
  flattenBlocks,
  fromDocx,
  fromMarkdown,
  parseDoc,
  plainText,
  serializeDoc,
  toDocx,
  toHtml,
  toMarkdown,
  type Block,
  type Doc,
} from "@pli.dev/docs";
import { applySetup, prepare, type Setup } from "./prepare";

const HELP = `pli: make Pli documents from Markdown or JSON, check them, and export them.

  node pli.mjs build <input> [outputs] [setup]
  node pli.mjs validate <document.pli.json>
  node pli.mjs outline <input>

build reads an input and writes what you ask for. The input is one of:
  .md      Markdown (headings, lists, tables, quotes, code, pictures, [TOC], <!-- pagebreak -->)
  .json    a document, or just its content: {"title":"…","blocks":[…]} (ids are filled in)
  .docx    a Word file (read into a document so it can be changed or exported again)

outputs (any of them):
  --docx <file>      a Word file
  --json <file>      the Pli document, to open in the editor or to build on
  --html <file>      a complete web page
  --md <file>        Markdown
  With none, the document is only checked and summarised.

setup (applies to what you build):
  --title "Quarterly report"   the document's title (otherwise the first heading)
  --title-block                make the first # heading the title block (Markdown input)
  --page a4|letter|legal|a5    page size (default letter)
  --landscape                  landscape pages
  --accept-changes             reading a .docx: take tracked changes as accepted (otherwise they stay suggestions)
  --margins 0.75               margins in inches
  --header "Acme Inc."         a line at the top of every page
  --footer "Page {page} of {pages}"   a line at the bottom of every page; {page} and {pages} are numbers

validate checks a saved document and says where a mistake is. outline lists the headings and counts what the document holds.
`;

function flags(args: string[]): { positional: string[]; flag: Map<string, string | true> } {
  const positional: string[] = [];
  const flag = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) flag.set(name, true);
      else {
        flag.set(name, next);
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flag };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function read(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch {
    return fail(`Can't read ${file}`);
  }
}

function load(file: string, setup: Setup): Doc {
  const ext = extname(file).toLowerCase();
  let doc: Doc;
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    doc = fromMarkdown(read(file).toString("utf8"), { firstHeadingAsTitle: !!setup.titleBlock });
  } else if (ext === ".docx") {
    const result = fromDocx(new Uint8Array(read(file)), { trackedChanges: setup.acceptChanges ? "accept" : "keep" });
    for (const warning of result.warnings ?? []) console.warn(`warning: ${typeof warning === "string" ? warning : JSON.stringify(warning)}`);
    doc = result.doc;
  } else if (ext === ".json") {
    let json: unknown;
    try {
      json = JSON.parse(read(file).toString("utf8"));
    } catch (e) {
      return fail(`${file} isn't valid JSON: ${(e as Error).message}`);
    }
    doc = prepare(json);
  } else {
    return fail(`Don't know how to read ${file}: use .md, .json or .docx`);
  }
  return applySetup(doc, setup);
}

function describe(doc: Doc): string[] {
  const all = Array.from(flattenBlocks(doc.blocks) as Iterable<Block>);
  const count = (type: string) => all.filter((b) => b.type === type).length;
  const stats = documentStats(doc);
  return [
    `"${doc.title}": ${stats.words} words, ${doc.blocks.length} blocks`,
    `  ${count("heading") + count("title")} headings, ${count("table")} tables, ${count("image")} pictures, ${count("list_item")} list items, ${count("toc")} contents`,
    `  page: ${doc.page ? `${doc.page.size} ${doc.page.orientation}` : "letter portrait (default)"}${doc.header ? ", header" : ""}${doc.footer ? ", footer" : ""}`,
  ];
}

function outline(doc: Doc): string[] {
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "title") lines.push(`TITLE ${plainText(block.runs)}`);
    else if (block.type === "heading") lines.push(`${"  ".repeat(block.level - 1)}${"#".repeat(block.level)} ${plainText(block.runs)}`);
    else if (block.type === "toc") lines.push("[table of contents]");
    else if (block.type === "page_break") lines.push("--- page break ---");
  }
  return lines;
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  const { positional, flag } = flags(rest);
  const string = (name: string): string | undefined => {
    const v = flag.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const setup: Setup = {
    title: string("title"),
    titleBlock: flag.has("title-block"),
    page: string("page"),
    landscape: flag.has("landscape"),
    acceptChanges: flag.has("accept-changes"),
    margins: string("margins") !== undefined ? Number(string("margins")) : undefined,
    header: string("header"),
    footer: string("footer"),
  };
  if (setup.margins !== undefined && !(setup.margins >= 0.25 && setup.margins <= 4)) fail("--margins is in inches, from 0.25 to 4");

  const input = positional[0];
  if (!input) fail(`${command} needs a file. Run "node pli.mjs help".`);

  if (command === "validate") {
    // A saved document is checked as it is, without filling anything in.
    try {
      const doc = parseDoc(read(input).toString("utf8"));
      console.log(`OK. ${describe(doc).join("\n")}`);
    } catch (e) {
      fail(`Not valid: ${(e as Error).message}`);
    }
    return;
  }

  let doc: Doc;
  try {
    doc = load(input, setup);
  } catch (e) {
    return fail(`Couldn't read ${basename(input)}: ${(e as Error).message}`);
  }

  if (command === "outline") {
    console.log([...describe(doc), "", ...outline(doc)].join("\n"));
    return;
  }
  if (command !== "build") return fail(`Unknown command "${command}". Run "node pli.mjs help".`);

  const wrote: string[] = [];
  const target = (name: string) => string(name);
  try {
    if (target("json")) {
      writeFileSync(target("json")!, serializeDoc(doc));
      wrote.push(target("json")!);
    }
    if (target("docx")) {
      writeFileSync(target("docx")!, toDocx(doc));
      wrote.push(target("docx")!);
    }
    if (target("html")) {
      writeFileSync(target("html")!, toHtml(doc, { fullDocument: true }));
      wrote.push(target("html")!);
    }
    if (target("md")) {
      writeFileSync(target("md")!, toMarkdown(doc));
      wrote.push(target("md")!);
    }
  } catch (e) {
    return fail(`Couldn't write the output: ${(e as Error).message}`);
  }
  // The saved file is read back, so what was written is known to open.
  if (target("json")) parseDoc(readFileSync(target("json")!, "utf8"));
  console.log(describe(doc).join("\n"));
  console.log(wrote.length > 0 ? `Wrote ${wrote.join(", ")}` : "Checked only: add --docx, --json, --html or --md to write a file.");
}

try {
  main(process.argv.slice(2));
} catch (e) {
  fail(`${(e as Error).message}`);
}
