import { PliError, type CommentClient } from "@pli.dev/core";
import {
  SheetSession,
  sheetEditorSession,
  sheetSyncModel,
  createWorkbook,
  fromCsv,
  fromXlsx,
  isError,
  cellAddress,
  parseCell,
  parseRange,
  parseWorkbook,
  printToPdf,
  serializeWorkbook,
  toCsv,
  toXlsx,
  type CellAnchor,
  type Sheet,
  type SheetUser,
  type Workbook,
} from "@pli.dev/sheets";
import { methodsFor } from "../catalogs";
import { genericComments, utf8Bytes, utf8Text, type Ctx, type EditorDef } from "../runtime";

const book = (ctx: Ctx) => ctx.session as SheetSession;
const nil = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

/** A sheet by name or id, as the sheet's id. */
const idOf = (s: SheetSession, sheet: string): string => s.sheet(sheet).id;

function info(s: SheetSession, sheet: Sheet) {
  return { id: sheet.id, name: sheet.name, hidden: !!(sheet as { hidden?: boolean }).hidden, usedRange: s.usedRange(sheet.id), tabColor: sheet.tabColor ?? null };
}

function cellInfo(s: SheetSession, sheet: string, address: string) {
  const cell = s.cell(sheet, address);
  const value = s.value(sheet, address);
  const typed = cell?.f;
  return {
    address,
    value: isError(value) ? null : (value as unknown),
    error: isError(value) ? value.error : null,
    text: s.display(sheet, address).text,
    formula: typed ? (typed.startsWith("=") ? typed : `=${typed}`) : null,
    format: cell?.fmt ?? null,
  };
}

const run: EditorDef["run"] = {
  title: (c) => book(c).state.title,
  setTitle: (c, [title]) => book(c).setTitle(title as string),
  sheets: (c) => book(c).state.sheets.map((sh) => info(book(c), sh)),
  usedRange: (c, [sheet]) => book(c).usedRange(sheet as string),
  cell: (c, [sheet, address]) => cellInfo(book(c), sheet as string, address as string),
  value: (c, [sheet, address]) => book(c).value(sheet as string, address as string),
  text: (c, [sheet, address]) => book(c).display(sheet as string, address as string).text,
  values: (c, [sheet, range]) => book(c).values(sheet as string, range as string),
  toText: (c, [sheet, range]) => book(c).toText(sheet as string, range as string),
  toHtml: (c, [sheet, range]) => book(c).toHtml(sheet as string, range as string),
  merges: (c, [sheet]) => book(c).merges(sheet as string),
  find: (c, [text, matchCase, wholeCell, sheet]) =>
    book(c).find({ text: text as string, matchCase: nil(matchCase as boolean | null), wholeCell: nil(wholeCell as boolean | null), scope: sheet ? { sheet: sheet as string } : "workbook" }),
  replace: (c, [text, replacement, matchCase, wholeCell, sheet]) =>
    book(c).replace({ text: text as string, matchCase: nil(matchCase as boolean | null), wholeCell: nil(wholeCell as boolean | null), scope: sheet ? { sheet: sheet as string } : "workbook" }, replacement as string),
  setCell: (c, [sheet, address, value]) => book(c).setCell(sheet as string, address as string, value as string | number | boolean | null),
  setCells: (c, [sheet, inputs]) => book(c).setCells(sheet as string, inputs as Record<string, string | number | boolean | null>),
  setValues: (c, [sheet, at, rows]) => book(c).setValues(sheet as string, at as string, rows as (string | number | boolean | null)[][]),
  clear: (c, [sheet, range, what]) => book(c).clear(sheet as string, range as string, what as "all" | "contents" | "formats"),
  setFormat: (c, [sheet, range, format]) => book(c).setFormat(sheet as string, range as string, (format as string | null) ?? null),
  setStyle: (c, [sheet, range, style]) => book(c).setStyle(sheet as string, range as string, style as Record<string, never>),
  fill: (c, [sheet, range, direction]) => book(c).fill(sheet as string, range as string, direction as "down" | "right"),
  autofill: (c, [sheet, source, target]) => book(c).autofill(sheet as string, source as string, target as string),
  copy: (c, [sheet, range, toSheet, at, cut]) => book(c).copy({ sheet: sheet as string, range: range as string }, { sheet: toSheet as string, at: at as string }, { cut: cut as boolean }),
  sort: (c, [sheet, range, by, descending, header]) => book(c).sort(sheet as string, range as string, { by: nil(by as number | null), descending: nil(descending as boolean | null), header: nil(header as boolean | null) }),
  insertRows: (c, [sheet, at, count]) => book(c).insertRows(sheet as string, at as number, count as number),
  deleteRows: (c, [sheet, at, count]) => book(c).deleteRows(sheet as string, at as number, count as number),
  insertColumns: (c, [sheet, at, count]) => book(c).insertColumns(sheet as string, at as number, count as number),
  deleteColumns: (c, [sheet, at, count]) => book(c).deleteColumns(sheet as string, at as number, count as number),
  setColumnWidth: (c, [sheet, column, width]) => book(c).setColumnWidth(sheet as string, column as number, (width as number | null) ?? null),
  setRowHeight: (c, [sheet, row, height]) => book(c).setRowHeight(sheet as string, row as number, (height as number | null) ?? null),
  setFrozen: (c, [sheet, rows, cols]) => book(c).setFrozen(sheet as string, rows as number, cols as number),
  mergeCells: (c, [sheet, range]) => book(c).mergeCells(sheet as string, range as string),
  unmergeCells: (c, [sheet, range]) => book(c).unmergeCells(sheet as string, range as string),
  setNote: (c, [sheet, address, text]) => book(c).setNote(sheet as string, address as string, (text as string | null) ?? null),
  setFilter: (c, [sheet, range]) => book(c).setFilter(sheet as string, (range as string | null) ?? null),
  defineName: (c, [name, formula]) => book(c).defineName(name as string, (formula as string | null) ?? null),
  addSheet: (c, [name, index]) => info(book(c), book(c).addSheet(nil(name as string | null), nil(index as number | null))),
  deleteSheet: (c, [sheet]) => book(c).deleteSheet(sheet as string),
  renameSheet: (c, [sheet, name]) => book(c).renameSheet(sheet as string, name as string),
  moveSheet: (c, [sheet, index]) => book(c).moveSheet(sheet as string, index as number),
  setTabColor: (c, [sheet, color]) => book(c).setTabColor(sheet as string, (color as string | null) ?? null),
  insertChart: (c, [sheet, range, type]) => book(c).insertChart(sheet as string, range as string, type ? { type: type as never } : {}),

  commentOnRange(c, [sheet, range, body, mentions]) {
    // The thread sits on the range's top left cell, so it follows the cell when rows and columns change.
    return book(c).comments.commentOnRange(sheet as string, range as string, body as string, (mentions as string[] | null) ?? undefined);
  },
  threadsAt(c, [sheet, address]) {
    const s = book(c);
    const at = parseCell(address as string);
    if (!at) throw new PliError("out_of_range", `"${address as string}" is not a cell address`);
    const id = idOf(s, sheet as string);
    return (c.comments?.threads ?? []).filter((t) => {
      const place = s.comments.placeOf(t.id);
      const b = place ? parseRange(place.range ?? place.cell) : null;
      return place?.sheet === id && b !== null && at.row >= b.r1 && at.row <= b.r2 && at.col >= b.c1 && at.col <= b.c2;
    });
  },

  undo: (c) => book(c).undo(),
  redo: (c) => book(c).redo(),
};

/** The sheet to export when none is named: the first that isn't hidden. */
function sheetToExport(s: SheetSession, named: unknown): string {
  if (typeof named === "string") return idOf(s, named);
  const visible = s.state.sheets.find((sh) => !(sh as { hidden?: boolean }).hidden) ?? s.state.sheets[0];
  if (!visible) throw new PliError("not_found", "The workbook has no sheets");
  return visible.id;
}

const sheetUser = (ctx: Ctx): SheetUser | null => {
  const u = ctx.users.current;
  return u ? { id: u.id, role: ctx.users.role } : null;
};

export const sheetsEditor: EditorDef = {
  kind: "sheets",
  methods: methodsFor("sheets"),
  run,

  open(ctx, input, options) {
    let workbook: Workbook;
    if (input.format === "xlsx") {
      const result = fromXlsx(input.bytes!);
      workbook = result.workbook;
      ctx.extra.warnings = result.warnings;
    } else if (input.format === "csv") workbook = fromCsv(input.text ?? "");
    else if (input.text) workbook = parseWorkbook(input.text);
    else workbook = createWorkbook(options.title ?? "Untitled", options.sheets ?? ["Sheet1"]);
    if (options.title && input.format !== "json" && input.text === null) workbook = { ...workbook, title: options.title };
    const session = new SheetSession(workbook, { user: sheetUser(ctx), author: options.author ?? ctx.users.current?.name });
    ctx.session = session;
    ctx.core = (session as unknown as { session: never }).session;
    ctx.file = workbook.id;
  },

  comments(ctx, options, store) {
    // A build whose sheet session keeps its comments in the workbook turns them on itself; before that they are the generic ones.
    const own = (ctx.session as { comments?: { enable?: (o: unknown) => CommentClient<any> } }).comments;
    if (own?.enable) return own.enable({ users: ctx.users, store: store ?? "document" });
    return genericComments(ctx, options, store) as CommentClient<any>;
  },
  userChanged: (ctx) => {
    if (ctx.session) {
      (ctx.session as SheetSession).setUser(sheetUser(ctx));
      (ctx.session as SheetSession).author = ctx.users.current?.name;
    }
  },

  serialize: (ctx) => serializeWorkbook(book(ctx).state),
  parse: (text) => parseWorkbook(text),
  create: () => createWorkbook("Untitled"),
  model: () => sheetSyncModel,
  editorSession: (ctx) => sheetEditorSession(book(ctx)),
  state: (ctx) => ({ sheets: book(ctx).state.sheets.length, warnings: (ctx.extra.warnings as string[] | undefined) ?? [] }),

  exportFile(ctx, format, options) {
    const s = book(ctx);
    switch (format) {
      case "xlsx":
        return toXlsx(s.state);
      case "json":
        return serializeWorkbook(s.state);
      case "csv":
        return toCsv(s.calculator, sheetToExport(s, options.sheet), { delimiter: options.delimiter ?? undefined });
      case "pdf":
        return printToPdf(s, sheetToExport(s, options.sheet)).then((r) => r.bytes);
      default:
        throw new PliError("unsupported", `Workbooks export as xlsx, csv, pdf or json, not ${format}`);
    }
  },

  importFile(ctx, format, input, options) {
    const s = book(ctx);
    let warnings: string[] = [];
    if (format === "xlsx") {
      const result = fromXlsx(input.bytes!);
      warnings = result.warnings;
      s.load(result.workbook);
    } else if (format === "csv") s.load(fromCsv(input.text ?? utf8Text(input.bytes!), { delimiter: options.delimiter ?? undefined }));
    else if (format === "json") s.load(parseWorkbook(input.text ?? utf8Text(input.bytes!)));
    else throw new PliError("unsupported", `Workbooks import xlsx, csv or json, not ${format}`);
    ctx.file = s.state.id;
    return { warnings };
  },
};

void utf8Bytes;
