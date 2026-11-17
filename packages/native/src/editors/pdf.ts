import { PliError, type CommentClient } from "@pli.dev/core";
import {
  Overlay,
  PdfDict,
  PdfName,
  PdfSession,
  createPdf,
  memorySourceStore,
  pdfEditorSession,
  pdfSyncModel,
  readPdf,
  savePdf,
  setPages,
  storageSources,
  type PdfDoc,
  type Rect,
} from "@pli.dev/pdf";
import { methodsFor } from "../catalogs";
import { utf8Text, type Ctx, type EditorDef } from "../runtime";

const pdf = (ctx: Ctx) => ctx.session as PdfSession;
const nil = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);
const mentionsOf = (value: unknown) => (value as string[] | null | undefined) ?? undefined;

/** A file with one blank page, for a PDF that starts empty. */
function blankPdf(width = 612, height = 792): Uint8Array {
  const o: Overlay = createPdf();
  const page = o.add(new PdfDict({ Type: PdfName.of("Page"), MediaBox: [0, 0, width, height] }));
  setPages(o, [page]);
  return o.rewrite({ gc: true });
}

const rectOf = (x: unknown, y: unknown, w: unknown, h: unknown): Rect => ({ x: x as number, y: y as number, w: w as number, h: h as number });

function annotInfo(page: string, a: { id: string; type: string; contents?: string; author?: string; thread?: string }) {
  return { id: a.id, type: a.type, page, contents: a.contents ?? null, author: a.author ?? null, thread: a.thread ?? null };
}

const run: EditorDef["run"] = {
  pages: (c) => pdf(c).doc.pages.map((p, i) => ({ id: p.id, number: i + 1, width: p.width, height: p.height, rotate: p.rotate, label: p.label ?? null, annotations: p.annots.length })),
  annotations: (c, [page]) => pdf(c).annots.list(page as string).map((a) => annotInfo(page as string, a)),
  fields: (c) => pdf(c).forms.list().map((f) => ({ id: f.id, name: f.name, type: f.type, value: f.value })),
  formData: (c) => pdf(c).forms.exportData(),
  metadata: (c) => pdf(c).doc.meta,
  outline: (c) => pdf(c).doc.outline,
  text: async (c, [page]) => (await pdf(c).content.text(page as string)).text,
  search: async (c, [query, caseSensitive, wholeWord]) => {
    const hits = await pdf(c).content.search(query as string, { caseSensitive: nil(caseSensitive as boolean | null), wholeWord: nil(wholeWord as boolean | null) });
    return hits.map((h) => ({ page: h.pageId ?? String(h.page), text: h.text, rects: h.rects }));
  },
  setMetadata: (c, [patch]) => pdf(c).transact([{ type: "set_meta", patch: patch as never }]),
  rotatePages: (c, [ids, degrees]) => {
    if (![90, -90, 180].includes(degrees as number)) throw new PliError("invalid_operation", "Pages turn by 90, -90 or 180 degrees");
    pdf(c).pages.rotate(ids as string[], degrees as 90 | -90 | 180);
  },
  deletePages: (c, [ids]) => pdf(c).pages.remove(ids as string[]),
  movePages: (c, [ids, index]) => pdf(c).pages.move(ids as string[], index as number),
  duplicatePages: (c, [ids]) => pdf(c).pages.duplicate(ids as string[]),
  insertBlankPage: (c, [after, width, height]) =>
    pdf(c).pages.insertBlank(nil(after as string | null), width !== null && width !== undefined && height !== null && height !== undefined ? { width: width as number, height: height as number } : undefined),
  addHighlight: (c, [page, rects, kind, color, quote]) =>
    pdf(c).annots.addHighlight(page as string, rects as Rect[], { type: nil(kind as never), color: nil(color as string | null), quote: nil(quote as string | null) }),
  addNote: (c, [page, x, y, text]) => pdf(c).annots.addNote(page as string, x as number, y as number, text as string),
  addShape: (c, [page, kind, x, y, w, h, color]) => pdf(c).annots.addShape(page as string, kind as "square" | "circle", rectOf(x, y, w, h), { color: nil(color as string | null) }),
  addFreeText: (c, [page, x, y, w, h, text]) => pdf(c).annots.addFreeText(page as string, rectOf(x, y, w, h), text as string),
  addLink: (c, [page, x, y, w, h, uri]) => pdf(c).annots.addLink(page as string, rectOf(x, y, w, h), { uri: uri as string }),
  setAnnotationText: (c, [id, text]) => pdf(c).annots.setText(id as string, text as string),
  moveAnnotations: (c, [ids, dx, dy]) => pdf(c).annots.moveBy(ids as string[], dx as number, dy as number),
  removeAnnotations: (c, [ids]) => pdf(c).annots.remove(ids as string[]),
  setFieldValue: (c, [id, value]) => pdf(c).forms.setValue(id as string, value as never),
  fillForm: (c, [values]) => pdf(c).forms.fill(values as Record<string, unknown>),
  markRedaction: (c, [page, rects]) => pdf(c).content.markRedaction(page as string, rects as Rect[]),
  markSearchRedactions: (c, [query]) => pdf(c).content.markSearch(query as string),
  applyRedactions: (c, [pages]) => pdf(c).content.applyRedactions((pages as string[] | null) ?? undefined),
  addComment: (c, [page, x, y, body, mentions]) => pdf(c).comments.addNote(page as string, x as number, y as number, body as string, mentionsOf(mentions)),
  commentOnAnnotation: (c, [annotation, body, mentions]) => pdf(c).comments.commentOn(annotation as string, body as string, mentionsOf(mentions)),
  undo: (c) => pdf(c).undo(),
  redo: (c) => pdf(c).redo(),
};

export const pdfEditor: EditorDef = {
  kind: "pdf",
  methods: methodsFor("pdf"),
  run,

  open(ctx, input, options) {
    const user = ctx.users.current;
    const sessionOptions = {
      ...(user ? { user: { id: user.id, name: user.name } } : {}),
      ...(ctx.storage ? { sources: storageSources(ctx.storage) } : { sources: memorySourceStore() }),
      ...(options.password ? { password: options.password } : {}),
    };
    if (input.format === "json" && input.text) {
      const session = new PdfSession(JSON.parse(input.text) as PdfDoc, sessionOptions);
      ctx.session = session;
      ctx.file = session.doc.id;
    } else {
      const bytes = input.format === "pdf" && input.bytes ? input.bytes : blankPdf(options.width, options.height);
      const { doc } = readPdf(bytes, { name: options.name, id: options.id, password: options.password });
      const session = new PdfSession(doc, sessionOptions);
      // The memory store keeps the bytes at once; a store of the app's finishes in the background, and a save waits for it.
      void session.sources.put(doc.sources[0]!, bytes);
      session.saver = savePdf;
      ctx.session = session;
      ctx.file = doc.id;
    }
    ctx.core = pdf(ctx).core;
  },

  comments(ctx, _options, store) {
    return pdf(ctx).comments.enable({ users: ctx.users, store: store ?? "document" }) as CommentClient<any>;
  },
  userChanged(ctx) {
    const user = ctx.users.current;
    if (ctx.session) (pdf(ctx).options as { user?: { id: string; name?: string } }).user = user ? { id: user.id, name: user.name } : undefined;
  },

  serialize: (ctx) => JSON.stringify(pdf(ctx).doc),
  parse: (text) => JSON.parse(text) as PdfDoc,
  create: () => readPdf(blankPdf()).doc,
  model: () => pdfSyncModel,
  editorSession: (ctx) => pdfEditorSession(pdf(ctx)),
  presence: (ctx) => ({ page: pdf(ctx).selection.page }),
  state: (ctx) => ({ pages: pdf(ctx).doc.pages.length, dirty: pdf(ctx).dirty }),

  exportFile(ctx, format, options) {
    const s = pdf(ctx);
    switch (format) {
      case "pdf":
        return s.saveDetailed(options).then((r) => {
          s.markSaved();
          return r.bytes;
        });
      case "json":
        return JSON.stringify(s.doc);
      default:
        throw new PliError("unsupported", `PDFs export as pdf or json, not ${format}`);
    }
  },

  importFile(ctx, format, input) {
    const s = pdf(ctx);
    if (format === "pdf") {
      const { doc } = readPdf(input.bytes!);
      void s.sources.put(doc.sources[0]!, input.bytes!);
      s.reset(doc);
      s.saver = savePdf;
      ctx.file = doc.id;
      return { warnings: [] };
    }
    if (format === "json") {
      s.reset(JSON.parse(input.text ?? utf8Text(input.bytes!)) as PdfDoc);
      return { warnings: [] };
    }
    throw new PliError("unsupported", `PDFs import pdf or json, not ${format}`);
  },
};
