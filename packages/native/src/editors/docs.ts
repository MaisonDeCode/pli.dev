import {
  DocumentSession,
  PliError,
  createDoc,
  divider,
  docSyncModel,
  documentEditorSession,
  documentStats,
  flattenBlocks,
  fromDocx,
  image,
  isTextBlock,
  listLabels,
  selectionState,
  selectionToPlainText,
  sliceSelection,
  type ListMarker,
  pageBreak,
  parseDoc,
  plainText,
  serializeDoc,
  toDocx,
  toHtml,
  toMarkdown,
  type Block,
  type Doc,
  commentRanges,
  commentsAt,
} from "@pli.dev/docs";
import { type CommentClient } from "@pli.dev/core";
import catalog from "../catalog.json";
import { methodsFor } from "../catalogs";
import { utf8Bytes, utf8Text, type Ctx, type EditorDef, type Method } from "../runtime";

/** A block of the document by id, in a table cell too. */
function findBlock(doc: Doc, id: string): Block | undefined {
  const visit = (blocks: readonly Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.id === id) return b;
      if (b.type === "table") for (const row of b.rows) for (const cell of row.cells) { const found = visit(cell.blocks as Block[]); if (found) return found; }
    }
    return undefined;
  };
  return visit(doc.blocks);
}

// ---- Commands ---------------------------------------------------------------------------------------------------

type Args = unknown[];
type Run = (s: DocumentSession, a: Args) => unknown;

const toggle = (key: "bold" | "italic" | "underline" | "strike" | "code" | "superscript" | "subscript"): Run => (s) => s.toggleMark(key);
const setMark = (key: string): Run => (s, [value]) => s.setMarks({ [key]: value ?? null });
const block = (spec: Parameters<DocumentSession["setBlockType"]>[0]): Run => (s) => s.setBlockType(spec);


const RUN: Record<string, Run> = {
  typeText: (s, [text]) => s.typeText(text as string),
  paste: (s, [html, rtf, text]) => s.paste({ html: (html as string | null) ?? undefined, rtf: (rtf as string | null) ?? undefined, text: (text as string | null) ?? undefined }).applied,
  pasteText: (s, [text]) => s.paste({ text: text as string, plain: true }).applied,
  splitBlock: (s) => s.splitBlock(),
  backspace: (s) => s.backspace(),
  deleteForward: (s) => s.deleteForward(),
  deleteSelection: (s) => s.deleteSelection(),
  undo: (s) => s.undo(),
  redo: (s) => s.redo(),
  toggleBold: toggle("bold"),
  toggleItalic: toggle("italic"),
  toggleUnderline: toggle("underline"),
  toggleStrikethrough: toggle("strike"),
  toggleCode: toggle("code"),
  toggleSuperscript: toggle("superscript"),
  toggleSubscript: toggle("subscript"),
  setTextColor: setMark("color"),
  setHighlight: setMark("highlight"),
  setFontFamily: setMark("fontFamily"),
  setFontSize: setMark("fontSize"),
  setLink: (s, [url]) => s.setLink((url as string | null) ?? null),
  clearFormatting: (s) => s.clearFormatting(),
  setParagraph: block({ type: "paragraph" }),
  setTitle: block({ type: "title" }),
  setSubtitle: block({ type: "subtitle" }),
  setHeading: (s, [level]) => {
    if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6) throw new PliError("invalid_operation", "A heading level is 1 to 6");
    return s.setBlockType({ type: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6 });
  },
  setQuote: block({ type: "quote" }),
  setCodeBlock: block({ type: "code_block" }),
  toggleBulletedList: (s) => s.toggleBlockType({ type: "list_item", list: "bullet" }),
  toggleNumberedList: (s) => s.toggleBlockType({ type: "list_item", list: "ordered" }),
  setAlignment: (s, [alignment]) => s.setAlign(alignment as "left" | "center" | "right" | "justify"),
  indent: (s) => s.indent(),
  outdent: (s) => s.outdent(),
  setListMarker: (s, [marker]) => s.setListMarker(marker as ListMarker | null),
  setListStart: (s, [start]) => s.setListStart(start as number),
  continueNumbering: (s) => s.continueNumbering(),
  setLineSpacing: (s, [multiple]) => s.setParagraphFormat({ lineHeight: (multiple as number | null) ?? null }),
  setSpaceBefore: (s, [points]) => s.setParagraphFormat({ spaceBefore: (points as number | null) ?? null }),
  setSpaceAfter: (s, [points]) => s.setParagraphFormat({ spaceAfter: (points as number | null) ?? null }),
  insertTable: (s, [rows, columns]) => s.insertTable(rows as number, columns as number),
  addRowAbove: (s) => s.addRow("above"),
  addRowBelow: (s) => s.addRow("below"),
  addColumnLeft: (s) => s.addColumn("left"),
  addColumnRight: (s) => s.addColumn("right"),
  deleteRow: (s) => s.deleteRow(),
  deleteColumn: (s) => s.deleteColumn(),
  deleteTable: (s) => s.deleteTable(),
  mergeCells: (s) => s.mergeCells(),
  splitCells: (s) => s.splitCells(),
  setHeaderRow: (s, [on]) => s.setHeaderRow(on as boolean),
  setColumnEdge: (s, [tableId, column, position, merge]) => {
    const table = s.state.blocks.find((b) => b.id === tableId && b.type === "table");
    if (!table || table.type !== "table") throw new PliError("not_found", "No table has that id");
    const i = column as number;
    if (i < 0 || i >= table.columns.length - 1) throw new PliError("invalid_operation", "A table has an edge after each column but the last");
    const total = table.columns.reduce((a, b) => a + b, 0);
    const widths = [...table.columns];
    const before = widths.slice(0, i).reduce((a, b) => a + b, 0);
    const pair = widths[i]! + widths[i + 1]!;
    const least = total * 0.05;
    const left = Math.min(Math.max((position as number) * total - before, least), pair - least);
    widths[i] = left;
    widths[i + 1] = pair - left;
    s.updateBlock(tableId as string, { columns: widths.map((w) => w / total) }, { merge: merge as boolean });
    return true;
  },
  setRowHeight: (s, [tableId, row, points, merge]) => {
    const table = findBlock(s.state, tableId as string);
    if (!table || table.type !== "table") throw new PliError("not_found", "No table has that id");
    if (!Number.isInteger(row) || (row as number) < 0 || (row as number) >= table.rows.length) throw new PliError("invalid_operation", "That table has no such row");
    const rows = table.rows.map((r, i) => {
      if (i !== row) return r;
      const { height: _old, ...rest } = r;
      return points === null || points === undefined ? rest : { ...rest, height: Math.max(points as number, 8) };
    });
    s.updateBlock(table.id, { rows }, { merge: merge as boolean });
    return true;
  },
  setCellShade: (s, [color]) => s.setCellShade((color as string | null) ?? null),
  insertPageBreak: (s) => s.insertBlockAtCaret(pageBreak()),
  insertDivider: (s) => s.insertBlockAtCaret(divider()),
  setImageSize: (s, [imageId, width, height, merge]) => {
    const picture = findBlock(s.state, imageId as string);
    if (!picture || picture.type !== "image") throw new PliError("not_found", "No picture has that id");
    s.updateBlock(picture.id, { width: Math.max(width as number, 16), height: Math.max(height as number, 16) }, { merge: merge as boolean });
    return true;
  },
  setImageCrop: (s, [imageId, top, right, bottom, left, merge]) => {
    const picture = findBlock(s.state, imageId as string);
    if (!picture || picture.type !== "image") throw new PliError("not_found", "No picture has that id");
    const next = { top: top as number, right: right as number, bottom: bottom as number, left: left as number };
    for (const [side, value] of Object.entries(next)) if (!(value >= 0 && value <= 0.9)) throw new PliError("invalid_operation", `The ${side} crop is 0 to 0.9`);
    if (next.left + next.right > 0.95 || next.top + next.bottom > 0.95) throw new PliError("invalid_operation", "That crops away too much of the picture");
    // The picture keeps its scale: its size on the page follows what is left of it.
    s.cropImage(picture.id, next, { merge: merge as boolean, rescale: true });
    return true;
  },
  setImageWrap: (s, [imageId, wrap]) => {
    const picture = findBlock(s.state, imageId as string);
    if (!picture || picture.type !== "image") throw new PliError("not_found", "No picture has that id");
    s.select({ anchor: { block: picture.id, offset: 0 }, focus: { block: picture.id, offset: 0 } });
    return s.setImageWrap((wrap as "left" | "right" | null) ?? null);
  },
  deleteImage: (s, [imageId]) => {
    const picture = findBlock(s.state, imageId as string);
    if (!picture || picture.type !== "image") throw new PliError("not_found", "No picture has that id");
    s.deleteBlock(picture.id);
    return true;
  },
  insertImage: (s, [source, width, height, description]) =>
    s.insertBlockAtCaret(image(source as string, { width: width as number, height: height as number }, description ? { alt: description as string } : {})),
  setDocumentTitle: (s, [title]) => s.setTitle(title as string),
  applyParagraphStyle: (s, [id]) => s.applyParagraphStyle((id as string | null) ?? null),
  applyCharacterStyle: (s, [id]) => s.applyCharacterStyle((id as string | null) ?? null),
  createStyle: (s, [name, kind]) => s.createStyle(name as string, kind as "paragraph" | "character"),
  deleteStyle: (s, [id]) => s.deleteStyle(id as string),
  select: (s, [ab, ao, fb, fo]) => s.select({ anchor: { block: ab as string, offset: ao as number }, focus: { block: fb as string, offset: fo as number } }),
  selectAll: (s) => s.selectAll(),
  setSuggesting: (s, [on]) => s.setSuggesting(on as boolean),
  acceptSuggestion: (s, [id]) => s.acceptSuggestion(id as string),
  rejectSuggestion: (s, [id]) => s.rejectSuggestion(id as string),
  acceptAllSuggestions: (s) => s.acceptAllSuggestions(),
  rejectAllSuggestions: (s) => s.rejectAllSuggestions(),
};

/** Checks arguments against the catalog, so a wrapper that is out of date fails clearly instead of doing something odd. */

// ---- What a document looks like from outside --------------------------------------------------------------------

/** What each list item shows as its marker ("3.", "iv.", "•"), by block id, counting each list where it is: the page's or a table cell's. */
function markerLabels(blocks: readonly Block[], out = new Map<string, { text: string; marker: string }>()): Map<string, { text: string; marker: string }> {
  listLabels(blocks).forEach((label, i) => {
    if (label) out.set(blocks[i]!.id, label);
  });
  for (const b of blocks) if (b.type === "table") for (const row of b.rows) for (const cell of row.cells) markerLabels(cell.blocks, out);
  return out;
}

function blocksView(doc: Doc): unknown[] {
  const labels = markerLabels(doc.blocks);
  return flattenBlocks(doc.blocks).map((b) => {
    const base: Record<string, unknown> = { id: b.id, type: b.type };
    if (isTextBlock(b)) {
      base.text = plainText(b.runs);
      if ("level" in b) base.level = b.level;
      if ("list" in b) {
        base.list = b.list;
        base.depth = b.depth;
        const label = labels.get(b.id);
        if (label) {
          base.marker = label.marker;
          base.label = label.text;
        }
      }
      if ("align" in b && b.align) base.align = b.align;
      if ("style" in b && b.style) base.style = b.style;
    } else if (b.type === "table") {
      base.rows = b.rows.length;
      base.columns = b.columns.length;
    } else if (b.type === "image") {
      base.width = b.width;
      base.height = b.height;
      if (b.alt) base.description = b.alt;
    }
    return base;
  });
}

/**
 * The document's content for drawing: the blocks as the model has them (text in runs with their marks, tables with their cells,
 * pictures with their source), with each list item's marker as it is shown ("3.", "iv.", "•") added as `label`.
 */
function contentView(doc: Doc): unknown[] {
  const labels = markerLabels(doc.blocks);
  const withLabels = (blocks: readonly Block[]): unknown[] =>
    blocks.map((b) => {
      if (b.type === "table") {
        return { ...b, rows: b.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: withLabels(cell.blocks as Block[]) })) })) };
      }
      const label = b.type === "list_item" ? labels.get(b.id) : undefined;
      return label ? { ...b, label: label.text } : b;
    });
  return withLabels(doc.blocks);
}

/** What a toolbar needs to know about the selection: which marks are on, the kind of block, the alignment, the list, undo and redo. */
function formatView(session: DocumentSession): unknown {
  const state = selectionState(session.state, session.selection, session.pendingMarks);
  const value = (v: { value: unknown; mixed: boolean }) => ({ value: v.value ?? null, mixed: v.mixed });
  return {
    marks: state.marks,
    fontFamily: value(state.fontFamily),
    fontSize: value(state.fontSize),
    color: value(state.color),
    highlight: value(state.highlight),
    link: value(state.link),
    block: state.block,
    align: state.align,
    paragraphStyle: state.paragraphStyle,
    list: state.list,
    image: state.image ? { id: state.image.id, wrap: state.image.wrap ?? null } : null,
    table: state.table
      ? { id: state.table.id, rows: state.table.rows, columns: state.table.columns, row: state.table.row, column: state.table.column, selectedRows: state.table.selectedRows, selectedColumns: state.table.selectedColumns, headerRow: state.table.headerRow, shade: state.table.shade ?? null, canMerge: state.table.canMerge, canSplit: state.table.canSplit }
      : null,
    canIndent: state.canIndent,
    canOutdent: state.canOutdent,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
  };
}


function outline(doc: Doc): unknown[] {
  return doc.blocks.flatMap((b) => (b.type === "heading" ? [{ id: b.id, level: b.level, text: plainText(b.runs) }] : []));
}


/** What the app can read about a document, by name. */
function read(session: DocumentSession, what: string): unknown {
  const doc = session.state;
  switch (what) {
    case "title":
      return doc.title;
    case "plainText":
      return flattenBlocks(doc.blocks).filter(isTextBlock).map((b) => plainText(b.runs)).join("\n");
    case "markdown":
      return toMarkdown(doc);
    case "html":
      return toHtml(doc);
    case "blocks":
      return blocksView(doc);
    case "content":
      return contentView(doc);
    case "format":
      return formatView(session);
    case "selectedText":
      return session.selection ? selectionToPlainText(doc, session.selection) : "";
    case "clipboard":
      return session.selection ? { text: selectionToPlainText(doc, session.selection), html: toHtml(sliceSelection(doc, session.selection)) } : { text: "", html: "" };
    case "outline":
      return outline(doc);
    case "statistics":
      return documentStats(doc);
    case "selection":
      return session.selection;
    case "suggestions":
      return session.suggestions;
    case "styles":
      return session.styles;
    default:
      throw new PliError("not_found", `Nothing called "${what}" can be read`);
  }
}

let counter = 0;

export const docsEditor: EditorDef = {
  kind: "docs",
  methods: [...(catalog.commands as Method[]), ...methodsFor("docs")],
  run: {
    ...Object.fromEntries(Object.entries(RUN).map(([name, fn]) => [name, (ctx: Ctx, args: unknown[]) => fn(ctx.session as DocumentSession, args)])),
    commentOnSelection: (ctx, [body, mentions]) => (ctx.session as DocumentSession).comment(body as string, (ctx.session as DocumentSession).selection, (mentions as string[] | null) ?? undefined),
    commentRanges: (ctx, [thread]) => commentRanges((ctx.session as DocumentSession).state, thread as string),
    threadsAtSelection: (ctx) => {
      const s = ctx.session as DocumentSession;
      const ids = new Set(commentsAt(s.state, s.selection));
      return ctx.comments!.threads.filter((t) => ids.has(t.id));
    },
  },

  open(ctx, input, options) {
    const user = ctx.users.current;
    const doc = input.format === "docx" ? fromDocx(input.bytes!, { trackedChanges: "accept", title: options.title }).doc : input.text ? parseDoc(input.text) : createDoc(options.title ?? "Untitled", [{ id: `b_${++counter}_0`, type: "paragraph", runs: [] }]);
    const session = new DocumentSession(doc, {
      comments: { users: ctx.users, store: (ctx.extra.commentStore as never) ?? "document", synced: options.live === true },
      ...(ctx.storage ? { storage: ctx.storage } : {}),
      ...(user && options.suggestions !== false ? { suggestions: { users: ctx.users } } : {}),
    });
    const first = session.state.blocks.find(isTextBlock);
    if (first) session.select({ anchor: { block: first.id, offset: 0 }, focus: { block: first.id, offset: 0 } });
    ctx.session = session;
    ctx.core = session;
    ctx.file = doc.id;
  },

  comments: (ctx) => (ctx.session as DocumentSession).comments! as CommentClient<any>,

  serialize: (ctx) => serializeDoc((ctx.session as DocumentSession).state),
  parse: (text) => parseDoc(text),
  create: () => createDoc("Untitled", [{ id: "b_0", type: "paragraph", runs: [] }]),
  model: () => docSyncModel,
  editorSession: (ctx) => documentEditorSession(ctx.session as DocumentSession),
  presence: (ctx) => ({ selection: (ctx.session as DocumentSession).selection }),

  state(ctx) {
    const s = ctx.session as DocumentSession;
    return { selection: s.selection, suggesting: s.suggesting, canSuggest: s.canSuggest };
  },

  read: (ctx, what) => read(ctx.session as DocumentSession, what),

  exportFile(ctx, format) {
    const doc = (ctx.session as DocumentSession).state;
    switch (format) {
      case "docx":
        return toDocx(doc);
      case "json":
        return serializeDoc(doc);
      case "markdown":
      case "md":
        return toMarkdown(doc);
      case "html":
        return toHtml(doc);
      default:
        throw new PliError("unsupported", `Documents export as docx, json, markdown or html, not ${format}`);
    }
  },

  importFile(ctx, format, input, options) {
    const session = ctx.session as DocumentSession;
    if (format === "docx") {
      const result = fromDocx(input.bytes!, { trackedChanges: options.trackedChanges ?? (session.suggestionsEnabled ? "keep" : "accept"), title: options.title });
      session.replaceDocument(result.doc);
      session.suggestionUsers?.add(result.authors);
      return { warnings: result.warnings, authors: result.authors };
    }
    if (format === "json") {
      session.replaceDocument(parseDoc(input.text ?? utf8Text(input.bytes!)));
      return { warnings: [], authors: [] };
    }
    throw new PliError("unsupported", `Documents import docx or json, not ${format}`);
  },
};

void utf8Bytes;
