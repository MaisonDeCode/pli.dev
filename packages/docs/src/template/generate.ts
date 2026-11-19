import { PliError, createId } from "@pli.dev/core";
import { stripComments } from "../comments";
import { stripFootnoteRefs } from "../footnotes";
import { REGION_NAMES } from "../regions";
import { cloneBlocks } from "../paste";
import { marksAt, normalizeRuns, plainText, sliceRuns, textLength } from "../runs";
import { isTextBlock, type Block, type CellBlock, type Doc, type Marks, type RegionName, type Run, type TableBlock, type TableCell, type TableRow } from "../model";
import { TemplateError, evaluate, truthy, type Environment, type Expr, type FilterContext, type Scope, type TemplateFilter } from "./expression";
import { BUILT_IN_FILTERS, display } from "./filters";
import { hasTags, nest, scan, type Flat, type Node, type Tag, type Where } from "./tags";

/** The answers a document is made from: any plain data. Names in the template are looked up in it. */
export type Answers = Record<string, unknown>;

export interface GenerateOptions {
  /**
   * What to put where the answers have nothing for a placeholder:
   * - `"mark"` (default): the placeholder stays as it was written, highlighted, so a reader sees what is still to fill in.
   * - `"keep"`: the placeholder stays as it was written.
   * - `"blank"`: nothing.
   */
  missing?: "mark" | "keep" | "blank";
  /** Throw instead of returning a document that has problems (a placeholder with no answer, a mistake in the template). */
  strict?: boolean;
  /** The highlight for `missing: "mark"`. Default a pale yellow. */
  highlight?: string;
  /** Remove a paragraph whose only text was placeholders that came out empty. Default `true`: an optional line leaves no gap. */
  dropEmpty?: boolean;
  /** The language numbers and dates are written in, such as `"en-GB"`. Default: the reader's own. */
  locale?: string;
  /** The currency of `| currency` when it isn't named. Default `"USD"`. */
  currency?: string;
  /** The time zone dates are written in. Default: the reader's own. */
  timeZone?: string;
  /** What `@today` is. Default: now. */
  now?: Date;
  /** Your own filters, or replacements for built-in ones: `{ shout: (value) => String(value).toUpperCase() + "!" }`. */
  filters?: Record<string, TemplateFilter>;
  /** The most blocks a document may grow to, so a list that is too long can't take all the memory. Default 50,000. */
  maxBlocks?: number;
}

/** A problem in the template or the answers, with where it is. */
export interface TemplateIssue {
  /**
   * - `missing`: the answers have nothing for a placeholder.
   * - `syntax`: something in `{{ }}` can't be read, or a condition or list is not closed.
   * - `filter`: a filter doesn't exist, or can't work with the value it was given.
   * - `type`: a value isn't what the template does with it (a group of answers shown as text, text used as a list).
   */
  type: "missing" | "syntax" | "filter" | "type";
  message: string;
  /** The tag as it was written in the template, such as `{{ client.name }}`. */
  tag: string;
  /** The id of the block in the template that holds it. */
  block?: string;
  /** For `missing`: the name that has no answer. */
  path?: string;
}

export interface GenerateResult {
  /** The document. It has new ids throughout, so it can be loaded into a session with `replaceDocument`. */
  doc: Doc;
  /** Everything that wasn't right. Empty when all went well. */
  issues: TemplateIssue[];
  /** The names that were asked for in the text and had no answer, each once, in the order they came. */
  missing: string[];
}

const DEFAULT_HIGHLIGHT = "#ffe08a";
const DEFAULT_MAX_BLOCKS = 50_000;

/** A name for what a placeholder asks for, to say what has no answer: `client.name`. */
export function pathLabel(expr: Expr): string | undefined {
  switch (expr.t) {
    case "path":
      return expr.head + expr.rest.map((s) => (s.k === "key" ? `.${s.name}` : s.expr.t === "lit" ? `[${JSON.stringify(s.expr.v)}]` : "[…]")).join("");
    case "pipe":
      return pathLabel(expr.e);
    case "bin":
      return pathLabel(expr.l) ?? pathLabel(expr.r);
    case "un":
      return pathLabel(expr.e);
    default:
      return undefined;
  }
}

const emptyParagraph = (): CellBlock => ({ id: createId("b_"), type: "paragraph", runs: [] });

function sanitize(marks: Marks | undefined): Marks | undefined {
  if (!marks) return undefined;
  const { field: _f, footnote: _n, comment: _c, suggest: _s, ...rest } = marks;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

type InlineLeaf = { kind: "text"; from: number; to: number } | { kind: "out"; expr: Expr; from: number; raw: string } | { kind: "bad"; from: number; to: number; error: TemplateError; raw: string };
type RowTag = { cell: number; block: number; tag: Tag; raw: string };

const opens = (tag: Tag) => tag.k === "if" || tag.k === "each";

/** Whether the tags, taken in order, open and close each other with nothing left over. */
function balanced(tags: readonly Tag[]): boolean {
  let depth = 0;
  for (const tag of tags) {
    if (opens(tag)) depth++;
    else if (tag.k === "end") depth--;
    else if ((tag.k === "else" || tag.k === "elseif") && depth <= 0) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

class Generator {
  readonly issues: TemplateIssue[] = [];
  readonly missing = new Set<string>();
  readonly env: Environment;
  readonly #options: GenerateOptions;
  readonly #mode: "mark" | "keep" | "blank";
  readonly #highlight: string;
  #budget: number;

  constructor(options: GenerateOptions) {
    this.#options = options;
    this.#mode = options.missing ?? "mark";
    this.#highlight = options.highlight ?? DEFAULT_HIGHLIGHT;
    this.#budget = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    const context: FilterContext = { locale: options.locale, currency: options.currency ?? "USD", timeZone: options.timeZone, now: options.now ?? new Date() };
    this.env = { filters: { ...BUILT_IN_FILTERS, ...options.filters }, context };
  }

  issue(type: TemplateIssue["type"], message: string, at: Where, path?: string): void {
    this.issues.push({ type, message, tag: at.raw, ...(at.block !== undefined && { block: at.block }), ...(path !== undefined && { path }) });
  }

  #spend(n = 1): void {
    this.#budget -= n;
    if (this.#budget < 0) throw new PliError("invalid_operation", `The document would grow past ${this.#options.maxBlocks ?? DEFAULT_MAX_BLOCKS} blocks. Is a list in the answers far longer than expected?`);
  }

  // ---- running expressions ----

  #test(expr: Expr, scope: Scope, at: Where): boolean {
    try {
      return truthy(evaluate(expr, scope, this.env));
    } catch (error) {
      if (error instanceof TemplateError) this.issue(error.kind, error.message, at);
      else throw error;
      return false;
    }
  }

  /** Expands the `if` and `each` nodes of a nested list, giving each leaf to `leaf`. */
  #expand<L, T>(nodes: readonly Node<L>[], scope: Scope, leaf: (leaf: L, scope: Scope) => T[]): T[] {
    const out: T[] = [];
    for (const node of nodes) {
      if (node.k === "leaf") {
        out.push(...leaf(node.leaf, scope));
      } else if (node.k === "if") {
        for (const branch of node.branches) {
          if (branch.cond === null || this.#test(branch.cond, scope, branch.at)) {
            out.push(...this.#expand(branch.body, scope, leaf));
            break;
          }
        }
      } else {
        const list = this.#list(node.expr, scope, node.at);
        list.forEach((item, i) => {
          this.#spend();
          const frame: Record<string, unknown> = {
            ...(node.alias === undefined && item !== null && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {}),
            ...(node.alias !== undefined && { [node.alias]: item }),
            this: item,
            "@index": i,
            "@number": i + 1,
            "@first": i === 0,
            "@last": i === list.length - 1,
            "@count": list.length,
          };
          out.push(...this.#expand(node.body, { frame, parent: scope }, leaf));
        });
      }
    }
    return out;
  }

  #list(expr: Expr, scope: Scope, at: Where): unknown[] {
    let value: unknown;
    try {
      value = evaluate(expr, scope, this.env);
    } catch (error) {
      if (error instanceof TemplateError) this.issue(error.kind, error.message, at);
      else throw error;
      return [];
    }
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;
    this.issue("type", `${at.raw} needs a list, and what the answers have there is ${typeof value === "object" ? "a group of answers" : `"${String(value)}"`}`, at, pathLabel(expr));
    return [];
  }

  // ---- text ----

  /** The runs with their placeholders filled in. */
  #runs(runs: readonly Run[], scope: Scope, block: string | undefined): { runs: Run[]; changed: boolean } {
    const text = plainText(runs);
    if (!hasTags(text)) return { runs: runs.slice(), changed: false };
    const pieces = scan(text);
    if (pieces.every((p) => p.type === "text")) return { runs: runs.slice(), changed: false };
    const flat: Flat<InlineLeaf> = [];
    for (const piece of pieces) {
      if (piece.type === "text") flat.push({ kind: "leaf", leaf: { kind: "text", from: piece.from, to: piece.to } });
      else if (piece.type === "bad") {
        this.issue(piece.error.kind, piece.error.message, { raw: piece.raw, block });
        flat.push({ kind: "leaf", leaf: { kind: "bad", from: piece.from, to: piece.to, error: piece.error, raw: piece.raw } });
      } else if (piece.tag.k === "out") flat.push({ kind: "leaf", leaf: { kind: "out", expr: piece.tag.expr, from: piece.from, raw: piece.raw } });
      else flat.push({ kind: "tag", tag: piece.tag, at: { raw: piece.raw, block } });
    }
    const tree = nest(flat, (message, at) => this.issue("syntax", message, at));
    const out = this.#expand(tree, scope, (leaf, s): Run[] => {
      if (leaf.kind === "text") return sliceRuns(runs, leaf.from, leaf.to);
      const base = sanitize(marksAt(runs, leaf.from));
      const as = (text: string, marks: Marks | undefined): Run[] => (text === "" ? [] : [marks ? { text, marks } : { text }]);
      const literal = (raw: string): Run[] => as(raw, this.#mode === "keep" ? base : { ...base, highlight: this.#highlight });
      if (leaf.kind === "bad") return literal(leaf.raw);
      const at: Where = { raw: leaf.raw, block };
      let shown: string | undefined;
      try {
        shown = display(evaluate(leaf.expr, s, this.env), this.env.context);
      } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        this.issue(error.kind, error.message, at);
        return literal(leaf.raw);
      }
      if (shown === undefined) {
        const path = pathLabel(leaf.expr) ?? leaf.raw;
        this.missing.add(path);
        this.issue("missing", `There is no answer for ${path}`, at, path);
        return this.#mode === "blank" ? [] : literal(leaf.raw);
      }
      return as(shown, base);
    });
    return { runs: normalizeRuns(out), changed: true };
  }

  /** The title of the document with its placeholders filled in. */
  title(value: string, scope: Scope): string {
    return this.#string(value, scope, undefined);
  }

  /** A string with its placeholders filled in (a title, an image address, the target of a link). */
  #string(value: string, scope: Scope, block: string | undefined): string {
    if (!hasTags(value)) return value;
    return plainText(this.#runs([{ text: value }], scope, block).runs);
  }

  // ---- blocks ----

  /** The directive a paragraph is made of, when it holds nothing else: `{{#if x}}` on its own line. */
  #directive(block: Block | CellBlock): { tag: Tag; raw: string } | null {
    if (!isTextBlock(block as Block) || block.type === "code_block") return null;
    const text = plainText((block as { runs: Run[] }).runs);
    if (!hasTags(text)) return null;
    const pieces = scan(text);
    const tags = pieces.filter((p) => p.type !== "text" || text.slice(p.from, p.to).trim() !== "");
    if (tags.length !== 1) return null;
    const only = tags[0]!;
    if (only.type !== "tag" || only.tag.k === "out") return null;
    return { tag: only.tag, raw: only.raw };
  }

  blocks<T extends Block | CellBlock>(blocks: readonly T[], scope: Scope): T[] {
    const flat: Flat<T> = blocks.map((block) => {
      const directive = this.#directive(block);
      return directive ? { kind: "tag" as const, tag: directive.tag, at: { raw: directive.raw, block: block.id } } : { kind: "leaf" as const, leaf: block };
    });
    const tree = nest(flat, (message, at) => this.issue("syntax", message, at));
    return this.#expand(tree, scope, (block, s) => this.#block(block, s) as T[]);
  }

  #block(block: Block | CellBlock, scope: Scope): (Block | CellBlock)[] {
    this.#spend();
    switch (block.type) {
      case "code_block":
        // What is in a code block is left alone, so a template can show a placeholder as an example.
        return [block];
      case "image": {
        const src = this.#string(block.src, scope, block.id);
        const alt = block.alt === undefined ? undefined : this.#string(block.alt, scope, block.id);
        return [src === block.src && alt === block.alt ? block : { ...block, src, ...(alt !== undefined && { alt }) }];
      }
      case "table": {
        const table = this.#table(block, scope);
        return table ? [table] : [];
      }
      case "section_break": {
        if (!block.regions) return [block];
        const regions: NonNullable<typeof block.regions> = {};
        for (const [name, blocks] of Object.entries(block.regions) as [RegionName, Block[]][]) regions[name] = this.#region(blocks, scope);
        return [{ ...block, regions }];
      }
      case "divider":
      case "page_break":
      case "toc":
        return [block];
      default: {
        const runs = block.runs.map((run) => (run.marks?.link && hasTags(run.marks.link) ? { ...run, marks: { ...run.marks, link: this.#string(run.marks.link, scope, block.id) } } : run));
        const result = this.#runs(runs, scope, block.id);
        const linked = runs.some((r, i) => r !== block.runs[i]);
        if (!result.changed && !linked) return [block];
        if (result.changed && result.runs.length === 0 && textLength(block.runs) > 0 && this.#options.dropEmpty !== false) return [];
        return [{ ...block, runs: result.changed ? result.runs : normalizeRuns(runs) }];
      }
    }
  }

  #region(blocks: readonly Block[], scope: Scope): Block[] {
    return stripFootnoteRefs(this.blocks(blocks, scope));
  }

  // ---- tables ----

  /** The tags of a row's cells, in reading order. */
  #rowTags(row: TableRow): RowTag[] {
    const tags: RowTag[] = [];
    row.cells.forEach((cell, c) => cell.blocks.forEach((b, i) => {
      const d = this.#directive(b);
      if (d) tags.push({ cell: c, block: i, tag: d.tag, raw: d.raw });
    }));
    return tags;
  }

  /**
   * A row can be repeated or left out as a whole by putting the opening tag in its first cell and the closing tag in its last:
   * `{{#each items as item}}` and `{{/each}}`, each as its own paragraph. This takes those two out and gives them back.
   */
  #rowWrapper(row: TableRow): { open: RowTag; close: RowTag; row: TableRow } | null {
    const tags = this.#rowTags(row);
    if (tags.length < 2) return null;
    const perCell = row.cells.every((_, c) => balanced(tags.filter((t) => t.cell === c).map((t) => t.tag)));
    if (perCell) return null;
    const open = tags[0]!;
    const close = tags[tags.length - 1]!;
    if (!opens(open.tag) || close.tag.k !== "end" || close.tag.what !== (open.tag.k === "each" ? "each" : "if") || !balanced(tags.map((t) => t.tag))) return null;
    const without = (cell: TableCell, c: number): TableCell => {
      const drop = new Set<number>();
      if (open.cell === c) drop.add(open.block);
      if (close.cell === c) drop.add(close.block);
      if (drop.size === 0) return cell;
      const blocks = cell.blocks.filter((_, i) => !drop.has(i));
      return { ...cell, blocks: blocks.length > 0 ? blocks : [emptyParagraph()] };
    };
    return { open, close, row: { ...row, cells: row.cells.map(without) } };
  }

  #table(table: TableBlock, scope: Scope): TableBlock | null {
    const flat: Flat<TableRow> = [];
    for (const row of table.rows) {
      const wrapper = this.#rowWrapper(row);
      const at = (t: RowTag): Where => ({ raw: t.raw, block: table.id });
      if (wrapper && row.cells.some((c) => c.covered || (c.rowSpan ?? 1) > 1)) {
        this.issue("syntax", "A row with merged cells can't be repeated or left out", at(wrapper.open));
        flat.push({ kind: "leaf", leaf: wrapper.row });
      } else if (wrapper) {
        flat.push({ kind: "tag", tag: wrapper.open.tag, at: at(wrapper.open) }, { kind: "leaf", leaf: wrapper.row }, { kind: "tag", tag: wrapper.close.tag, at: at(wrapper.close) });
      } else flat.push({ kind: "leaf", leaf: row });
    }
    const tree = nest(flat, (message, at) => this.issue("syntax", message, at));
    const rows = this.#expand(tree, scope, (row, s): TableRow[] => {
      this.#spend();
      return [
        {
          ...row,
          cells: row.cells.map((cell) => {
            if (cell.covered) return cell;
            const blocks = this.blocks(cell.blocks, s);
            return { ...cell, blocks: blocks.length > 0 ? blocks : [emptyParagraph()] };
          }),
        },
      ];
    });
    if (rows.length === 0) return null;
    return { ...table, rows };
  }

  /** The runs' footnote references, in order, with each note given a new id of its own so a reference that was repeated has its own note. */
  settleNotes(lists: Block[][], notes: Doc["footnotes"], scope: Scope): Doc["footnotes"] {
    if (!notes) return undefined;
    const rendered = new Map<string, Block[]>();
    const used = new Set<string>();
    const out: Record<string, Block[]> = {};
    const note = (id: string): Block[] => {
      let blocks = rendered.get(id);
      if (!blocks) {
        blocks = stripFootnoteRefs(this.blocks(notes[id] ?? [], scope));
        rendered.set(id, blocks);
      }
      return cloneBlocks(blocks.length > 0 ? blocks : [emptyParagraph() as Block]);
    };
    const run = (r: Run): Run => {
      const id = r.marks?.footnote;
      if (id === undefined || !(id in notes)) return r;
      const next = used.has(id) ? createId("fn_") : id;
      used.add(id);
      out[next] = note(id);
      return next === id ? r : { ...r, marks: { ...r.marks, footnote: next } };
    };
    const visit = <B extends Block | CellBlock>(block: B): B => {
      if (isTextBlock(block as Block)) {
        const runs = (block as { runs: Run[] }).runs;
        return runs.some((r) => r.marks?.footnote !== undefined) ? ({ ...block, runs: runs.map(run) } as B) : block;
      }
      if (block.type === "table") return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as B;
      return block;
    };
    lists.forEach((list, i) => (lists[i] = list.map(visit)));
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

/**
 * Makes a document from a template and some answers. The template is an ordinary document with `{{ placeholders }}` in its
 * text, and parts that appear only when something is true, or repeat for each item in a list:
 *
 * ```
 * Dear {{ client.name }},
 * {{#if plan == "pro"}}
 * Thank you for choosing Pro, at {{ price | currency }} a month.
 * {{else}}
 * Thank you for choosing {{ plan | title }}.
 * {{/if}}
 * {{#each services as service}}
 * {{ service.name }}: {{ service.fee | currency }}
 * {{/each}}
 * ```
 *
 * The answers can come from anywhere: a form, a questionnaire from another product, a database row, a model's reply. They are
 * plain data (`{ client: { name: "Ana" }, plan: "pro" }`). Formatting is kept: a placeholder takes the look of the text where it
 * is written. Nothing in `template` or `answers` is changed.
 */
export function generateDocument(template: Doc, answers: Answers, options: GenerateOptions = {}): GenerateResult {
  const g = new Generator(options);
  const globals: Scope = { frame: { "@today": g.env.context.now }, parent: null };
  const scope: Scope = { frame: answers && typeof answers === "object" ? answers : {}, parent: globals };

  const blocks = stripComments(g.blocks(template.blocks, scope));
  const regions: Partial<Record<RegionName, Block[]>> = {};
  for (const name of REGION_NAMES) {
    const region = template[name];
    if (region) regions[name] = stripComments(stripFootnoteRefs(g.blocks(region, scope)));
  }

  const lists: Block[][] = [blocks];
  const footnotes = g.settleNotes(lists, template.footnotes, scope);
  const doc: Doc = {
    id: createId("doc_"),
    type: "document",
    title: g.title(template.title, scope),
    blocks: cloneBlocks(lists[0]!.length > 0 ? lists[0]! : [emptyParagraph() as Block]),
    ...(template.page && { page: template.page }),
    ...(template.styles && { styles: template.styles }),
    ...(footnotes && { footnotes }),
  };
  for (const name of REGION_NAMES) if (regions[name]) (doc as unknown as Record<string, Block[]>)[name] = cloneBlocks(regions[name]!);

  const { issues } = g;
  if (options.strict && issues.length > 0) {
    const shown = issues.slice(0, 5).map((i) => `${i.tag}: ${i.message}`);
    throw new PliError("invalid_operation", `The document has ${issues.length} problem${issues.length === 1 ? "" : "s"}: ${shown.join("; ")}${issues.length > 5 ? "; …" : ""}`, { cause: issues });
  }
  return { doc, issues, missing: [...g.missing] };
}
